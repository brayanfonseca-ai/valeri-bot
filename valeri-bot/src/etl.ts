/**
 * Cliente de la API de ETL (services_buk TV).
 *
 * Swagger: http://etl-integracion.s3-website.us-east-2.amazonaws.com/swagger/tv-prd-services-buk/
 * Especificación: .../tv-prd-services-buk/openapi.yaml (OpenAPI 3.0.3, versión 1.1.0)
 * Base:  ETL_BASE_URL  (https://ibs9x7piq3.execute-api.us-east-2.amazonaws.com/Prod)
 * Auth:  cabecera  x-api-key: ETL_TOKEN   (403 si falta o es inválida)
 *
 * Endpoints (verificados en vivo el 2026-11-10, ambos se consultan por CÉDULA):
 *   GET /extracto/{cedula}?year&month&format=pdf  -> comprobante de pago: URL prefirmada (60 min) del PDF en S3
 *   GET /vacaciones/{cedula}?date=DD-MM-YYYY      -> días de vacaciones pendientes a esa fecha
 *
 * Nota: el Swagger documenta /vacaciones/{employee_id}, pero ETL confirmó (y se verificó)
 * que se consulta con la cédula.
 */
import { config } from './config'

export type ErrorEtl = {
  ok: false
  /** Código HTTP, o 0 si no hubo respuesta (sin configuración, red caída, tiempo agotado). */
  estado: number
  detalle: string
}
export type RespuestaEtl<T> = { ok: true; datos: T } | ErrorEtl

export interface ComprobanteEtl {
  cedula: string
  employee_id: number
  full_name: string
  status: string
  found: boolean
  year: number
  month: number
  filename: string
  content_type: string
  size_bytes: number
  s3_key?: string
  /** URL prefirmada de S3, válida `expires_in` segundos (3600). Solo para uso interno del bot. */
  download_url: string
  expires_in: number
}

export interface VacacionesEtl {
  employee_id: number
  full_name: string
  vacations: { name: string; stock: number }[]
}

/** true si hay URL base y API Key configuradas. */
export function etlConfigurado(): boolean {
  return Boolean(config.etl.baseUrl && config.etl.apiKey)
}

async function llamarEtl<T>(
  ruta: string,
  params?: Record<string, string | number | undefined>,
  cuerpo?: unknown,
): Promise<RespuestaEtl<T>> {
  if (!config.etl.baseUrl) return { ok: false, estado: 0, detalle: 'ETL_BASE_URL no está definido' }
  if (!config.etl.apiKey) return { ok: false, estado: 0, detalle: 'ETL_TOKEN (x-api-key) no está definido' }

  const url = new URL(config.etl.baseUrl + ruta)
  for (const [clave, valor] of Object.entries(params ?? {})) {
    if (valor !== undefined && valor !== '') url.searchParams.set(clave, String(valor))
  }

  try {
    const respuesta = await fetch(url, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: {
        'x-api-key': config.etl.apiKey,
        Accept: 'application/json',
        ...(cuerpo !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(cuerpo !== undefined && { body: JSON.stringify(cuerpo) }),
      signal: AbortSignal.timeout(config.etl.timeoutMs),
    })
    const texto = await respuesta.text()
    if (!respuesta.ok) {
      return { ok: false, estado: respuesta.status, detalle: texto.slice(0, 300) }
    }
    return { ok: true, datos: (texto ? JSON.parse(texto) : {}) as T }
  } catch (error) {
    return { ok: false, estado: 0, detalle: error instanceof Error ? error.message : String(error) }
  }
}

/** Fecha en el formato que espera Buk/ETL: DD-MM-YYYY (con guiones). */
export function fechaEtl(fecha = new Date()): string {
  const dd = String(fecha.getDate()).padStart(2, '0')
  const mm = String(fecha.getMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${fecha.getFullYear()}`
}

/** Comprobante de pago (nómina) de un año y mes. 404 = no existe para ese periodo. */
export function obtenerComprobante(cedula: string, year: number, month: number) {
  return llamarEtl<ComprobanteEtl>(`/extracto/${encodeURIComponent(cedula)}`, { year, month, format: 'pdf' })
}

/** Días de vacaciones pendientes por disfrutar, calculados a la fecha indicada (por defecto, hoy). */
export function obtenerVacaciones(cedula: string, fecha = new Date()) {
  return llamarEtl<VacacionesEtl>(`/vacaciones/${encodeURIComponent(cedula)}`, { date: fechaEtl(fecha) })
}

/**
 * Cuerpo de la solicitud de vacaciones. Mismo modelo que Buk POST /vacations
 * (ETL lo está construyendo; se ajusta cuando publique su contrato).
 */
export interface SolicitudVacacionesEtl {
  /** La CÉDULA del empleado (ETL la traduce al id de Buk). */
  employee_id: number
  /** Siempre "legales" por ahora (config.solicitudVacaciones.tipo). */
  type: string
  /** Primer día de vacaciones, YYYY-MM-DD. */
  start_date: string
  /** Último día de vacaciones, YYYY-MM-DD (calculado: N días hábiles, sin domingos). */
  end_date: string
  /** Porcentaje de la jornada: 100 = día completo. NO es la cantidad de días. */
  percent_day: number
  /** "full_working_day" = jornada completa. */
  workday_stage: string
}

export function armarSolicitudVacaciones(cedula: string, inicioIso: string, finIso: string): SolicitudVacacionesEtl {
  const s = config.solicitudVacaciones
  return {
    employee_id: Number(cedula),
    type: s.tipo,
    start_date: inicioIso,
    end_date: finIso,
    percent_day: s.porcentajeDia,
    workday_stage: s.jornada,
  }
}

/** true si ETL ya publicó la ruta para registrar solicitudes (ETL_SOLICITUD_VACACIONES_RUTA). */
export function solicitudVacacionesHabilitada(): boolean {
  return Boolean(config.etl.rutaSolicitudVacaciones)
}

/** POST de la solicitud de vacaciones a ETL. Solo llamar si solicitudVacacionesHabilitada(). */
export function crearSolicitudVacaciones(solicitud: SolicitudVacacionesEtl) {
  return llamarEtl<unknown>(config.etl.rutaSolicitudVacaciones ?? '', undefined, solicitud)
}

/**
 * Descarga el PDF desde la URL prefirmada de S3 que entrega ETL.
 * Valida que realmente sea un PDF (empieza por %PDF).
 */
export async function descargarPdf(url: string): Promise<{ ok: true; contenido: Buffer } | ErrorEtl> {
  try {
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(config.etl.timeoutMs) })
    if (!respuesta.ok) return { ok: false, estado: respuesta.status, detalle: 'descarga del PDF falló' }
    const contenido = Buffer.from(await respuesta.arrayBuffer())
    if (contenido.subarray(0, 4).toString('latin1') !== '%PDF') {
      return { ok: false, estado: 0, detalle: 'el archivo descargado no es un PDF' }
    }
    return { ok: true, contenido }
  } catch (error) {
    return { ok: false, estado: 0, detalle: error instanceof Error ? error.message : String(error) }
  }
}
