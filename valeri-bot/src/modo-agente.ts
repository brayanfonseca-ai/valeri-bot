/**
 * Modo agente ("Hablar con agente"): el colaborador conversa en lenguaje natural con el
 * agente de IA de AWS. Guía: docs/guia-integracion-app.md (+ correcciones de la validación).
 *
 *  - El estado (agent_mode, agent_session_id) vive en la tabla sessions: sobrevive a reinicios.
 *  - Un mensaje a la vez por número, con una cola PROPIA (no la de escrituras de sesiones.ts:
 *    una invocación de hasta 90 s no debe frenar el registro de la conversación).
 *  - Máximo MAX_VUELTAS entregas de documento por mensaje (evita ciclos con el agente).
 *  - Textos largos se parten (WhatsApp admite 4.096 caracteres por mensaje).
 *  - Auditoría en audit_events (AGENT_MODE_STARTED/ENDED, AGENT_TOOL, AGENT_DOCUMENT, AGENT_ERROR), sin cédula.
 */
import type { MetaProvider } from '@builderbot/provider-meta'
import {
  cerrarSesionAgente,
  codigoErrorAgente,
  devolverResultadosDocumento,
  enviarMensajeAgente,
  nuevaSesionAgente,
  registrarSesionAgente,
  type RespuestaAgente,
} from './agente'
import { oculto } from './db'
import { MSG } from './mensajes'
import { entregarDocumentoAgente } from './documento-agente'
import { obtenerRegistro } from './registros'
import { auditar, estadoAgente, marcarModoAgente } from './sesiones'

const MAX_VUELTAS = 3
const MAX_CARACTERES = 4000
/** Si el agente tarda más que esto, se envía "Un momento… 💭". */
const AVISO_ESPERA_MS = 5000

// ── Cola propia por número ─────────────────────────────────────────────────
const colas = new Map<string, Promise<unknown>>()
const ocupados = new Set<string>()

function enColaAgente(waId: string, tarea: () => Promise<void>): Promise<void> {
  const anterior = colas.get(waId) ?? Promise.resolve()
  const actual = anterior.catch(() => undefined).then(tarea)
  colas.set(waId, actual)
  void actual
    .catch(() => undefined)
    .finally(() => {
      if (colas.get(waId) === actual) colas.delete(waId)
    })
  return actual
}

/** Pasa el formato del agente (Markdown) al de WhatsApp: **negrita** → *negrita*, títulos "# " → texto. */
function formatoWhatsApp(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+/gm, '')
}

/** Envía texto partiéndolo si supera el límite de WhatsApp. */
async function enviarTexto(provider: MetaProvider, waId: string, texto: string): Promise<void> {
  let resto = formatoWhatsApp(texto).trim()
  while (resto) {
    let corte = resto.length <= MAX_CARACTERES ? resto.length : resto.lastIndexOf('\n', MAX_CARACTERES)
    if (corte < MAX_CARACTERES / 2) corte = Math.min(resto.length, MAX_CARACTERES)
    await provider.sendText(waId, resto.slice(0, corte).trim())
    resto = resto.slice(corte).trim()
  }
}

/** Reintenta UNA vez a los 2 s si AWS limita las llamadas (ThrottlingException). */
async function conReintento(fn: () => Promise<RespuestaAgente>): Promise<RespuestaAgente> {
  try {
    return await fn()
  } catch (error) {
    if (codigoErrorAgente(error) !== 'ThrottlingException') throw error
    await new Promise((r) => setTimeout(r, 2000))
    return fn()
  }
}

/** Entra al modo agente. Devuelve false si no se pudo (sin registro o falla técnica). */
export async function entrarModoAgente(waId: string, provider: MetaProvider): Promise<boolean> {
  const registro = await obtenerRegistro(waId)
  if (!registro?.cedula) return false
  const agentSessionId = nuevaSesionAgente()
  try {
    await registrarSesionAgente(agentSessionId, registro.cedula)
  } catch (error) {
    console.error(`[agente] no se pudo registrar la sesión en DynamoDB (${oculto(waId)}):`, error instanceof Error ? error.message : error)
    void auditar('AGENT_ERROR', waId, { codigo: codigoErrorAgente(error), etapa: 'registrar_sesion' })
    return false
  }
  const sessionId = await marcarModoAgente(waId, true, agentSessionId)
  void auditar('AGENT_MODE_STARTED', waId, { agent_session_id: agentSessionId }, sessionId)
  console.log(`[agente] modo agente activado para ${oculto(waId)}`)
  await provider.sendText(waId, MSG.agente.saludo)
  return true
}

/** Sale del modo agente (no envía mensajes: quien llama decide qué mostrar). */
export async function salirModoAgente(waId: string, motivo: string): Promise<void> {
  const estado = await estadoAgente(waId)
  if (!estado?.agentMode) return
  await marcarModoAgente(waId, false)
  if (estado.agentSessionId) {
    try {
      await cerrarSesionAgente(estado.agentSessionId)
    } catch (error) {
      console.error(`[agente] no se pudo cerrar la sesión en DynamoDB (${oculto(waId)}):`, error instanceof Error ? error.message : error)
    }
  }
  void auditar('AGENT_MODE_ENDED', waId, { agent_session_id: estado.agentSessionId, motivo }, estado.sessionId)
  console.log(`[agente] modo agente terminado para ${oculto(waId)} (${motivo})`)
}

/** Atiende un mensaje de texto libre en modo agente (en orden, uno a la vez por número). */
export function atenderConAgente(waId: string, texto: string, provider: MetaProvider): Promise<void> {
  if (ocupados.has(waId)) void provider.sendText(waId, MSG.agente.ocupado).catch(() => undefined)
  return enColaAgente(waId, async () => {
    ocupados.add(waId)
    try {
      await turno(waId, texto, provider)
    } finally {
      ocupados.delete(waId)
    }
  })
}

async function turno(waId: string, texto: string, provider: MetaProvider): Promise<void> {
  const estado = await estadoAgente(waId)
  if (!estado?.agentMode || !estado.agentSessionId) return
  const agentSessionId = estado.agentSessionId

  // Regla obligatoria: nunca invocar sin la cédula del REGISTRO.
  const registro = await obtenerRegistro(waId)
  if (!registro?.cedula) {
    await provider.sendText(waId, MSG.agente.error)
    return
  }

  let avisoEspera: NodeJS.Timeout | undefined
  try {
    await registrarSesionAgente(agentSessionId, registro.cedula) // renueva el vencimiento
    avisoEspera = setTimeout(() => void provider.sendText(waId, MSG.agente.espera).catch(() => undefined), AVISO_ESPERA_MS)

    let r = await conReintento(() => enviarMensajeAgente(agentSessionId, waId, registro.cedula, texto))
    const herramientas = [...r.herramientas]
    let vueltas = 0
    while (r.pedidosDocumento?.length && vueltas < MAX_VUELTAS) {
      vueltas++
      clearTimeout(avisoEspera)
      if (r.texto) await enviarTexto(provider, waId, r.texto)
      // El agente puede pedir varios documentos en la misma vuelta (p. ej. comprobante y certificado).
      const resultados: { toolUseId: string; enviado: boolean; motivo?: string }[] = []
      for (const pedido of r.pedidosDocumento) {
        const resultado = await entregarDocumentoAgente(pedido, registro.cedula, waId, provider)
        void auditar('AGENT_DOCUMENT', waId, {
          tipo: pedido.tipo,
          year: pedido.year,
          month: pedido.month,
          enviado: resultado.enviado,
          motivo: resultado.enviado ? undefined : resultado.motivo,
        }, estado.sessionId)
        resultados.push({ toolUseId: pedido.toolUseId, enviado: resultado.enviado, motivo: resultado.enviado ? undefined : resultado.motivo })
      }
      r = await conReintento(() => devolverResultadosDocumento(agentSessionId, waId, resultados))
      herramientas.push(...r.herramientas)
    }
    clearTimeout(avisoEspera)
    if (r.pedidosDocumento?.length) {
      void auditar('AGENT_ERROR', waId, { codigo: 'max_vueltas', vueltas }, estado.sessionId)
    }

    if (r.texto) await enviarTexto(provider, waId, r.texto)
    else if (!vueltas) await provider.sendText(waId, MSG.agente.error)

    for (const h of herramientas) {
      void auditar('AGENT_TOOL', waId, { herramienta: h, duracion_ms: r.duracionMs, stop_reason: r.stopReason }, estado.sessionId)
    }
  } catch (error) {
    clearTimeout(avisoEspera)
    const codigo = codigoErrorAgente(error)
    console.error(`[agente] error con ${oculto(waId)}: ${codigo}`)
    void auditar('AGENT_ERROR', waId, { codigo }, estado.sessionId)
    await provider.sendText(waId, MSG.agente.error)
  }
}
