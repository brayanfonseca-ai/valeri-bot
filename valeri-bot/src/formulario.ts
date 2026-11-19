import type { MetaProvider } from '@builderbot/provider-meta'
import { config } from './config'
import { MSG } from './mensajes'
import { normalizarCedula, normalizarTelefono } from './validadores'

/**
 * Ventana de registro (WhatsApp Flow). Definición en meta/registro.flow.json.
 * Envía el mensaje con el botón que abre la ventana y registra si Meta lo rechaza.
 */
export async function enviarFormulario(provider: MetaProvider, to: string): Promise<void> {
  const f = MSG.formulario
  // Se arma el mensaje a mano: provider.sendFlow siempre incluye flow_action_payload.data,
  // y Meta rechaza un objeto vacío. Este formulario no necesita datos iniciales.
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'flow',
      header: { type: 'text', text: f.encabezado },
      body: { text: f.cuerpo },
      footer: { text: f.pie },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: 'valeri-registro',
          flow_id: config.flowRegistro.id,
          flow_cta: f.boton,
          flow_action: 'navigate',
          flow_action_payload: { screen: config.flowRegistro.pantalla },
          ...(config.flowRegistro.borrador && { mode: 'draft' }),
        },
      },
    },
  }
  const respuesta = await provider.sendMessageMeta(body as unknown as Parameters<MetaProvider['sendMessageMeta']>[0])
  const error = respuesta?.error ?? respuesta?.response?.data?.error
  if (error) {
    console.error('[formulario] Meta rechazó el envío de la ventana:', JSON.stringify(error))
  }
}

export type DatosFormulario = { cedula: string; telefono: string }

/**
 * Lee la respuesta de la ventana (ctx.nfm_reply). Devuelve:
 *  - undefined si el mensaje no viene de la ventana,
 *  - null si viene de la ventana pero los datos no son válidos,
 *  - los datos normalizados si son válidos.
 */
export function leerFormulario(ctx: unknown): DatosFormulario | null | undefined {
  const r = (ctx as { nfm_reply?: { cedula?: unknown; telefono?: unknown } })?.nfm_reply
  if (!r || typeof r !== 'object') return undefined
  const cedula = normalizarCedula(String(r.cedula ?? ''))
  const telefono = normalizarTelefono(String(r.telefono ?? ''))
  if (!cedula.ok || !telefono.ok) return null
  return { cedula: cedula.valor, telefono: telefono.valor }
}

// ═══════════════════════════════════════════════════════════════════════════
// Calendario de fecha de inicio de vacaciones (meta/calendario.flow.json)
// ═══════════════════════════════════════════════════════════════════════════

/** Valor de "tipo" que devuelve el calendario; distingue su respuesta de la del registro. */
export const TIPO_CALENDARIO = 'vacaciones_inicio'

/**
 * Envía el botón que abre el calendario. Fecha mínima, máxima, días y festivos van en
 * flow_action_payload.data. El calendario bloquea domingos (include-days) y festivos (unavailable-dates).
 * Devuelve false si no hay Flow configurado o Meta rechazó el envío: quien llama
 * debe usar las listas año -> mes -> día como respaldo.
 */
export async function enviarCalendario(
  provider: MetaProvider,
  to: string,
  datos: { dias: number; minFecha: string; maxFecha: string; festivos: string[] },
): Promise<boolean> {
  if (!config.flowCalendario.id) return false
  const c = MSG.calendario
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'flow',
      header: { type: 'text', text: c.encabezado },
      body: { text: c.cuerpo(datos.dias) },
      footer: { text: MSG.menu.pie },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: `valeri-vacaciones-${datos.dias}`,
          flow_id: config.flowCalendario.id,
          flow_cta: c.boton,
          flow_action: 'navigate',
          flow_action_payload: {
            screen: config.flowCalendario.pantalla,
            data: {
              dias: String(datos.dias),
              texto: c.texto(datos.dias),
              min_fecha: datos.minFecha,
              max_fecha: datos.maxFecha,
              // Festivos de Colombia en la ventana: el calendario los muestra bloqueados.
              festivos: datos.festivos,
            },
          },
        },
      },
    },
  }
  const respuesta = await provider.sendMessageMeta(body as unknown as Parameters<MetaProvider['sendMessageMeta']>[0])
  const error = respuesta?.error ?? respuesta?.response?.data?.error
  if (error) {
    console.error('[calendario] Meta rechazó el envío del calendario; se usan las listas:', JSON.stringify(error))
    return false
  }
  return true
}

/**
 * Lee la respuesta del calendario (ctx.nfm_reply con tipo "vacaciones_inicio").
 *  - undefined: el mensaje no viene del calendario;
 *  - null: viene del calendario pero la fecha o los días no se entienden;
 *  - { dias, fecha }: fecha "YYYY-MM-DD".
 * Acepta también la fecha en milisegundos, por si Meta la entrega así.
 */
export function leerCalendario(ctx: unknown): { dias: number; fecha: string } | null | undefined {
  const r = (ctx as { nfm_reply?: { tipo?: unknown; fecha?: unknown; dias?: unknown } })?.nfm_reply
  if (!r || typeof r !== 'object' || r.tipo !== TIPO_CALENDARIO) return undefined
  const dias = Number(r.dias)
  if (!Number.isInteger(dias) || dias < 1) return null
  let fecha = String(r.fecha ?? '').trim()
  if (/^\d{10,14}$/.test(fecha)) {
    const f = new Date(Number(fecha))
    fecha = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  return { dias, fecha }
}
