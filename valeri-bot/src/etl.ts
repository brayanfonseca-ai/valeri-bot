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

/** Respuesta de POST /certificado-laboral (Swagger 1.5.0). Misma forma que el comprobante. */
export interface CertificadoEtl {
  cedula: string
  employee_id: number
  full_name?: string
  /** Si no es "activo", el certificado indica desde y hasta. */
  status?: string
  found: boolean
  filename: string
  content_type: string
  size_bytes: number
  s3_key: string
  /** URL prefirmada de S3 (60 min). Solo para uso interno del bot. */
  download_url: string
  expires_in: number
}

/**
 * Certificado laboral SIN salario (PDF). Único parámetro: la cédula.
 * 404 = no existe el empleado; 422 = Buk no tiene cargo, fecha de inicio, tipo de contrato o fecha de retiro.
 */
export function obtenerCertificado(cedula: string) {
  return llamarEtl<CertificadoEtl>('/certificado-laboral', undefined, { cedula })
}

/**
 * Comprobante de pago (nómina) de un año y mes. 404 = no existe para ese periodo.
 * Sin year/month (lo usa el agente para "el último comprobante"), ETL devuelve el más reciente.
 */
export function obtenerComprobante(cedula: string, year?: number, month?: number) {
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
  /**
   * La CÉDULA del empleado, como número. ETL la traduce al id de Buk (una solicitud real con la
   * cédula fue creada). Si la cédula no es de un empleado de Buk, responde 404 "No encontrado: Employee".
   */
  employee_id: number
  /** Siempre "legales" por ahora (config.solicitudVacaciones.tipo). */
  type: string
  /** Primer día de vacaciones, YYYY-MM-DD. */
  start_date: string
  /** Último día de vacaciones, YYYY-MM-DD (calculado: N días hábiles, sin domingos). */
  end_date: string
  /**
   * Fracción del ÚLTIMO día que se toma como vacaciones (día completo). NO es la cantidad de días.
   * Ojo: el contrato de Buk se contradice (texto: 0 < x ≤ 1, 1 = completo; ejemplo y Swagger de ETL: 100).
   * Se envía VACACIONES_PERCENT_DAY (100 por defecto); si Buk lo rechaza, el motivo queda en el log.
   */
  percent_day: number
  /** "full_working_day" = jornada completa. */
  workday_stage: string
}

/** employee_id = la CÉDULA del registro (ETL la traduce al id de Buk; verificado con una solicitud real creada). */
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
 * Vacación que Buk registró. Contrato de Buk POST /vacations, respuesta 201:
 *   { "vacation": { employee_id, type, start_date, end_date, working_days, calendar_days, workday_stage } }
 * ETL la devuelve sin cambios. Por tolerancia también se acepta { data: {...} } o el objeto en la raíz.
 */
export interface VacacionRegistrada {
  start_date: string
  end_date: string
  /** Días hábiles que Buk descontó. */
  working_days: number | null
  /** Días corridos (calendario) entre inicio y fin. */
  calendar_days: number | null
  /** Id de la vacación en Buk, si lo devuelve. */
  id: number | null
  /** Estado (por ejemplo "approved"), si lo devuelve. */
  status: string | null
}

export function leerVacacionRegistrada(datos: unknown): VacacionRegistrada | null {
  const raiz = (datos ?? {}) as Record<string, unknown>
  const v = (raiz.vacation ?? raiz.data ?? raiz) as Record<string, unknown>
  if (!v || typeof v !== 'object') return null
  const texto = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null)
  const numero = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null)
  const inicio = texto(v.start_date)
  const fin = texto(v.end_date)
  if (!inicio || !fin) return null
  return {
    start_date: inicio,
    end_date: fin,
    working_days: numero(v.working_days),
    calendar_days: numero(v.calendar_days),
    id: numero(v.id),
    status: typeof v.status === 'string' ? v.status : null,
  }
}

/**
 * Motivo legible de un rechazo. Buk responde { errors: ["..."] }; ETL puede responder
 * { error: "..." } o { message: "..." }. Devuelve null si no hay un texto útil.
 */
export function leerMotivoRechazo(detalle: string): string | null {
  try {
    const j = JSON.parse(detalle) as { errors?: unknown; error?: unknown; message?: unknown }
    const lista = Array.isArray(j.errors) ? j.errors : j.errors && typeof j.errors === 'object' ? Object.values(j.errors).flat() : []
    const partes = [...lista, j.error, j.message].filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    const motivo = partes.join('. ').replace(/\s+/g, ' ').trim()
    return motivo ? motivo.slice(0, 300) : null
  } catch {
    return null
  }
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
