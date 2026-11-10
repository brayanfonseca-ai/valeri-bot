import type { MetaProvider } from '@builderbot/provider-meta'
import { MSG } from './mensajes'

/**
 * Menú principal (mensaje interactivo tipo lista de WhatsApp).
 * Límites de Meta: encabezado 60, cuerpo 1024, pie 60, botón 20,
 * título de opción 24, descripción de opción 72 caracteres, máximo 10 opciones.
 *
 * El "id" de cada opción es lo que llega de vuelta en ctx.id_list_reply cuando
 * el usuario la elige. No cambiar los ids sin actualizar bienvenida.flow.ts.
 */
export const OPCIONES_MENU = [
  { id: 'extracto', title: 'Consultar extracto', description: 'Descarga tu comprobante de pago en PDF' },
  { id: 'dias_vacaciones', title: 'Días de vacaciones', description: 'Consulta tus días disponibles' },
  { id: 'solicitar_vacaciones', title: 'Solicitar vacaciones', description: 'Pide tus días de descanso' },
  { id: 'certificado', title: 'Certificado laboral', description: 'Descarga tu certificado en PDF' },
  { id: 'agente', title: 'Hablar con agente', description: 'Te atiende un asesor de Recursos Humanos' },
] as const

export type IdOpcion = (typeof OPCIONES_MENU)[number]['id']

export function esOpcionMenu(id: unknown): id is IdOpcion {
  return OPCIONES_MENU.some((o) => o.id === id)
}

export async function enviarMenu(provider: MetaProvider, to: string): Promise<void> {
  const m = MSG.menu
  const respuesta = await provider.sendList(to, {
    header: { type: 'text', text: m.encabezado },
    body: { text: m.cuerpo },
    footer: { text: m.pie },
    action: {
      button: m.boton,
      sections: [{ title: m.seccion, rows: OPCIONES_MENU.map((o) => ({ ...o })) }],
    },
  })
  const error = respuesta?.error ?? respuesta?.response?.data?.error
  if (error) {
    console.error('[menu] Meta rechazó el envío del menú:', JSON.stringify(error))
  }
}
