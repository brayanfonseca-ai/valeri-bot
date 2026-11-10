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
