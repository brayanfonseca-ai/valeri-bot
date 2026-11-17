/**
 * Envío de documentos (PDF) por WhatsApp sin exponer URLs al usuario.
 *
 * Mismo patrón que Paula (media.ts): el archivo se sube a Meta y se envía por su
 * media_id. El usuario recibe el PDF dentro del chat, nunca un enlace.
 *
 *   1. POST https://graph.facebook.com/{version}/{phone_number_id}/media
 *      multipart: messaging_product=whatsapp, type=application/pdf, file=<pdf>
 *      -> { "id": "<media_id>" }
 *   2. POST /{phone_number_id}/messages  type=document  document={ id, filename, caption }
 */
import type { MetaProvider } from '@builderbot/provider-meta'
import { config } from './config'

type Resultado = { ok: true } | { ok: false; detalle: string }

export async function subirPdf(contenido: Buffer, nombre: string): Promise<{ ok: true; mediaId: string } | { ok: false; detalle: string }> {
  try {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', 'application/pdf')
    form.append('file', new Blob([new Uint8Array(contenido)], { type: 'application/pdf' }), nombre)

    const respuesta = await fetch(`https://graph.facebook.com/${config.meta.version}/${config.meta.numberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.meta.jwtToken}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    })
    const cuerpo = (await respuesta.json().catch(() => ({}))) as { id?: string; error?: unknown }
    if (!respuesta.ok || !cuerpo.id) {
      return { ok: false, detalle: `subida a Meta ${respuesta.status}: ${JSON.stringify(cuerpo.error ?? cuerpo).slice(0, 300)}` }
    }
    return { ok: true, mediaId: cuerpo.id }
  } catch (error) {
    return { ok: false, detalle: error instanceof Error ? error.message : String(error) }
  }
}

export async function enviarPdf(
  provider: MetaProvider,
  to: string,
  pdf: { contenido: Buffer; nombre: string; pie: string },
): Promise<Resultado> {
  const subida = await subirPdf(pdf.contenido, pdf.nombre)
  if (!subida.ok) return subida

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'document',
    document: { id: subida.mediaId, filename: pdf.nombre, caption: pdf.pie },
  }
  const respuesta = await provider.sendMessageMeta(body as unknown as Parameters<MetaProvider['sendMessageMeta']>[0])
  const error = respuesta?.error ?? respuesta?.response?.data?.error
  return error ? { ok: false, detalle: `envío del documento: ${JSON.stringify(error).slice(0, 300)}` } : { ok: true }
}
