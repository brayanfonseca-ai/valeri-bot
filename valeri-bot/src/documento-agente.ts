/**
 * Entrega de documentos que pide el agente de IA (herramienta enviar_documento_whatsapp).
 * Módulo aparte para no crear una dependencia circular entre opciones.ts y modo-agente.ts.
 */
import type { MetaProvider } from '@builderbot/provider-meta'
import { oculto } from './db'
import { descargarPdf, obtenerCertificado, obtenerComprobante } from './etl'
import { enviarPdf } from './media'
import { MSG } from './mensajes'
import { MESES } from './menu'

export type MotivoDocumento = 'no_encontrado' | 'datos_incompletos' | 'error_tecnico' | 'pedido_invalido'

/**
 * Entrega por WhatsApp el PDF que pidió el agente. La cédula es SIEMPRE la del registro
 * (quien llama la pasa desde obtenerRegistro), nunca la que diga el agente. Sin mensajes de
 * "buscando…" ni "¿otra consulta?": el agente redacta la respuesta al colaborador.
 */
export async function entregarDocumentoAgente(
  pedido: { tipo: string; year?: number; month?: number },
  cedula: string,
  waId: string,
  provider: MetaProvider,
): Promise<{ enviado: true } | { enviado: false; motivo: MotivoDocumento }> {
  const entero = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
  const { tipo, year, month } = pedido
  if (tipo !== 'comprobante' && tipo !== 'certificado') return { enviado: false, motivo: 'pedido_invalido' }
  if (year !== undefined && !entero(year, 2000, 2100)) return { enviado: false, motivo: 'pedido_invalido' }
  if (month !== undefined && !entero(month, 1, 12)) return { enviado: false, motivo: 'pedido_invalido' }

  try {
    const r = tipo === 'certificado' ? await obtenerCertificado(cedula) : await obtenerComprobante(cedula, year, month)
    if (!r.ok) {
      if (r.estado === 404) return { enviado: false, motivo: 'no_encontrado' }
      if (r.estado === 422) return { enviado: false, motivo: 'datos_incompletos' }
      console.error(`[agente] ${tipo} falló para ${oculto(waId)}: estado ${r.estado}`)
      return { enviado: false, motivo: 'error_tecnico' }
    }
    if (!r.datos.found || !r.datos.download_url) return { enviado: false, motivo: 'no_encontrado' }

    const pdf = await descargarPdf(r.datos.download_url)
    if (!pdf.ok) return { enviado: false, motivo: 'error_tecnico' }

    let nombre = 'Certificado_laboral.pdf'
    let pie: string = MSG.certificado.pie
    if (tipo === 'comprobante') {
      const d = r.datos as { year?: number; month?: number }
      const a = d.year ?? year
      const m = d.month ?? month
      nombre = a && m ? `Comprobante_de_pago_${a}-${String(m).padStart(2, '0')}.pdf` : 'Comprobante_de_pago.pdf'
      pie = a && m ? MSG.comprobante.pie(MESES[m - 1], a) : '📄 Tu comprobante de pago.'
    }
    const envio = await enviarPdf(provider, waId, { contenido: pdf.contenido, nombre, pie })
    if (!envio.ok) return { enviado: false, motivo: 'error_tecnico' }
    console.log(`[agente] ${tipo} enviado a ${oculto(waId)}`)
    return { enviado: true }
  } catch (error) {
    console.error(`[agente] error entregando ${tipo} a ${oculto(waId)}:`, error instanceof Error ? error.message : error)
    return { enviado: false, motivo: 'error_tecnico' }
  }
}
