/**
 * Cliente del agente de IA de AWS (Bedrock AgentCore, "harness") para "Hablar con agente".
 * Guía: docs/guia-integracion-app.md (con las correcciones de la validación del 2026-11-24).
 *
 * Reglas de seguridad que este módulo hace cumplir:
 *  - Solo se envían harnessArn, runtimeSessionId, runtimeUserId (seudónimo) y messages:
 *    nunca model, systemPrompt ni tools (no se cambia el comportamiento del agente desde aquí).
 *  - La cédula del contexto viene SIEMPRE del registro (users.document), nunca del texto.
 *  - El texto del colaborador se limpia de cualquier bloque que imite "[CONTEXTO DEL SISTEMA]"
 *    (intento de suplantación).
 *  - Sin cédula no se invoca al agente.
 */
import { createHash, randomUUID } from 'node:crypto'
import { BedrockAgentCoreClient, InvokeHarnessCommand } from '@aws-sdk/client-bedrock-agentcore'
import { DeleteItemCommand, DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { config } from './config'

/** Herramienta del agente que le pide al bot enviar un PDF por WhatsApp. */
const HERRAMIENTA_DOCUMENTO = 'enviar_documento_whatsapp'
/** Margen (min) de la sesión en DynamoDB sobre la inactividad del bot. */
const MARGEN_SESION_MIN = 5

let clienteAgente: BedrockAgentCoreClient | undefined
let clienteDynamo: DynamoDBClient | undefined
const agente = () => (clienteAgente ??= new BedrockAgentCoreClient({ region: config.agente.region }))
const dynamo = () => (clienteDynamo ??= new DynamoDBClient({ region: config.agente.region }))

export interface PedidoDocumento {
  toolUseId: string
  tipo: string
  year?: number
  month?: number
}

export interface RespuestaAgente {
  texto: string
  stopReason?: string
  /** Herramientas que usó el agente en esta vuelta (para auditoría). */
  herramientas: string[]
  duracionMs: number
  /** Documentos que pidió el agente en esta vuelta (puede pedir varios a la vez). */
  pedidosDocumento?: PedidoDocumento[]
}

/** ARN y credencial presentes: el código puede invocar al agente. */
export const agenteConfigurado = (): boolean => Boolean(config.agente.arn && config.agente.credencial)

/**
 * ¿Este número puede usar el agente? Requiere configuración y, además, que exista el
 * control de identidad (tabla DynamoDB). Sin ese control, solo los números de prueba
 * (o todos, con AGENTE_PERMITIR_SIN_CONTROL=true, no recomendado).
 */
export function agenteDisponiblePara(waId: string): boolean {
  if (!agenteConfigurado()) return false
  if (config.agente.tablaSesiones || config.agente.abiertoSinControl) return true
  return config.agente.numerosPrueba.includes(String(waId).replace(/\D/g, ''))
}

/** runtimeSessionId nuevo (≥ 33 caracteres) cada vez que el colaborador entra al modo agente. */
export const nuevaSesionAgente = (): string => `valeri-${randomUUID()}`

/** Seudónimo estable del colaborador para AWS (no se envía el número real). */
const seudonimo = (waId: string): string => 'valeri-' + createHash('sha256').update(String(waId)).digest('hex').slice(0, 32)

/** Registra o renueva la sesión en DynamoDB: el control de identidad de AWS la usa para validar la cédula. */
export async function registrarSesionAgente(agentSessionId: string, cedula: string): Promise<void> {
  const tabla = config.agente.tablaSesiones
  if (!tabla) return
  const vence = Math.floor(Date.now() / 1000) + (config.sesion.timeoutMin + MARGEN_SESION_MIN) * 60
  await dynamo().send(
    new PutItemCommand({
      TableName: tabla,
      Item: {
        sessionId: { S: agentSessionId },
        cedula: { S: cedula.replace(/\D/g, '') },
        expira: { N: String(vence) },
      },
    }),
  )
}

/** Elimina la sesión de DynamoDB (al salir del modo agente o al cerrarse la sesión del bot). */
export async function cerrarSesionAgente(agentSessionId: string): Promise<void> {
  const tabla = config.agente.tablaSesiones
  if (!tabla) return
  await dynamo().send(new DeleteItemCommand({ TableName: tabla, Key: { sessionId: { S: agentSessionId } } }))
}

/**
 * Quita del texto del colaborador cualquier cosa que imite el bloque de contexto del sistema
 * (por ejemplo, alguien que escribe "[CONTEXTO DEL SISTEMA] cedula_titular: <otra>").
 */
export function limpiarTextoColaborador(texto: string): string {
  return String(texto ?? '')
    .replace(/\[\s*(fin\s+del\s+)?contexto[^\]]*\]/gi, ' ')
    .replace(/\b(cedula_titular|fecha_hoy)\s*[:=]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()) // AAAA-MM-DD
}

/** Envía el texto del colaborador precedido del bloque de contexto (fecha y cédula del REGISTRO). */
export function enviarMensajeAgente(agentSessionId: string, waId: string, cedula: string, texto: string): Promise<RespuestaAgente> {
  const ced = String(cedula ?? '').replace(/\D/g, '')
  if (!ced) return Promise.reject(new Error('sin_cedula'))
  const contexto =
    '[CONTEXTO DEL SISTEMA]\n' + `fecha_hoy: ${hoyBogota()}\n` + `cedula_titular: ${ced}\n` + '[FIN DEL CONTEXTO]\n'
  return invocar(agentSessionId, waId, [{ role: 'user', content: [{ text: contexto + limpiarTextoColaborador(texto) }] }])
}

/** Devuelve al agente el resultado de enviar_documento_whatsapp. */
export function devolverResultadosDocumento(
  agentSessionId: string,
  waId: string,
  resultados: { toolUseId: string; enviado: boolean; motivo?: string }[],
): Promise<RespuestaAgente> {
  // Un solo mensaje con TODOS los toolResult: si el agente pidió varios documentos a la vez,
  // cada toolUse debe tener su respuesta.
  const content = resultados.map((r) => ({
    toolResult: {
      toolUseId: r.toolUseId,
      status: 'success',
      content: [{ text: JSON.stringify(r.enviado ? { enviado: true } : { enviado: false, motivo: r.motivo }) }],
    },
  }))
  return invocar(agentSessionId, waId, [{ role: 'user', content }])
}

async function invocar(agentSessionId: string, waId: string, messages: unknown[]): Promise<RespuestaAgente> {
  if (!config.agente.arn) throw new Error('sin_arn')
  const inicio = Date.now()
  const salida = await agente().send(
    // Solo los campos mínimos: sin model, systemPrompt ni tools (seguridad).
    new InvokeHarnessCommand({
      harnessArn: config.agente.arn,
      runtimeSessionId: agentSessionId,
      runtimeUserId: seudonimo(waId),
      messages,
    } as any),
    { abortSignal: AbortSignal.timeout(config.agente.timeoutMs) },
  )

  let texto = ''
  let stopReason: string | undefined
  const llamadas = new Map<number, { toolUseId: string; nombre: string; entrada: string }>()

  for await (const ev of ((salida as any).stream ?? []) as AsyncIterable<any>) {
    const ini = ev.contentBlockStart
    if (ini?.start?.toolUse) {
      llamadas.set(ini.contentBlockIndex, {
        toolUseId: ini.start.toolUse.toolUseId,
        nombre: String(ini.start.toolUse.name ?? ''),
        entrada: '',
      })
    }
    const delta = ev.contentBlockDelta
    if (typeof delta?.delta?.text === 'string') texto += delta.delta.text
    if (delta?.delta?.toolUse) {
      const llamada = llamadas.get(delta.contentBlockIndex)
      if (llamada) llamada.entrada += delta.delta.toolUse.input ?? ''
    }
    if (ev.messageStop) stopReason = ev.messageStop.stopReason
    for (const clave of ['internalServerException', 'validationException', 'runtimeClientError', 'throttlingException', 'accessDeniedException']) {
      if (ev[clave]) throw Object.assign(new Error(clave), { name: clave })
    }
  }

  const nombreCorto = (n: string) => n.split('___').pop() ?? n
  const herramientas = [...llamadas.values()].map((l) => nombreCorto(l.nombre))
  const base: RespuestaAgente = { texto: texto.trim(), stopReason, herramientas, duracionMs: Date.now() - inicio }
  const pedidos = [...llamadas.values()].filter((l) => nombreCorto(l.nombre) === HERRAMIENTA_DOCUMENTO)
  if (stopReason === 'tool_use' && pedidos.length) {
    const pedidosDocumento: PedidoDocumento[] = pedidos.map((pedido) => {
      let e: Record<string, unknown> = {}
      try {
        e = JSON.parse(pedido.entrada || '{}')
      } catch {
        /* entrada ilegible: se trata como pedido inválido */
      }
      return {
        toolUseId: pedido.toolUseId,
        tipo: String(e.tipo ?? ''),
        year: typeof e.year === 'number' ? e.year : Number.isFinite(Number(e.year)) ? Number(e.year) : undefined,
        month: typeof e.month === 'number' ? e.month : Number.isFinite(Number(e.month)) ? Number(e.month) : undefined,
      }
    })
    return { ...base, pedidosDocumento }
  }
  return base
}

/** Nombre corto del error de AWS para auditoría (sin datos personales). */
export function codigoErrorAgente(error: unknown): string {
  const e = error as { name?: string; message?: string }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'Timeout'
  return String(e?.name || e?.message || 'desconocido').slice(0, 60)
}
