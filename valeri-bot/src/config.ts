/**
 * Configuración de Valeri. Se lee una sola vez de process.env
 * (cargado con `node --env-file=.env`) y se valida al arrancar.
 */

function requerida(nombre: string): string {
  const valor = process.env[nombre]?.trim()
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}. Revisa el archivo .env (ver .env.example).`)
  }
  return valor
}

function leerModoValidacion(): 'abierta' | 'etl' {
  const valor = process.env.VALERI_VALIDACION?.trim().toLowerCase() || 'etl'
  if (valor !== 'abierta' && valor !== 'etl') {
    throw new Error(`VALERI_VALIDACION debe ser "abierta" o "etl" (llegó "${valor}").`)
  }
  return valor
}

export const config = {
  port: Number(process.env.PORT ?? 3010),
  meta: {
    jwtToken: requerida('META_JWT_TOKEN'),
    numberId: requerida('META_NUMBER_ID'),
    verifyToken: requerida('META_VERIFY_TOKEN'),
    version: process.env.META_VERSION?.trim() || 'v26.0',
    /** Si se define, el provider rechaza (401) webhooks sin firma X-Hub-Signature-256 válida. */
    appSecret: process.env.META_APP_SECRET?.trim() || undefined,
  },
  validacion: {
    /** "abierta" (pruebas: todos autorizados) o "etl" (consulta el endpoint de ETL). */
    modo: leerModoValidacion(),
    etlUrl: process.env.ETL_VALIDACION_URL?.trim() || undefined,
  },
  /** API de ETL hacia Buk (API Gateway). Autenticación: cabecera x-api-key. */
  etl: {
    baseUrl: (process.env.ETL_BASE_URL?.trim() || '').replace(/\/+$/, '') || undefined,
    apiKey: process.env.ETL_TOKEN?.trim() || undefined,
    /** El extracto puede tardar: ETL retrocede hasta 12 meses y sube el PDF a S3. */
    timeoutMs: Number(process.env.ETL_TIMEOUT_MS ?? 60000),
    /**
     * Solicitud de vacaciones (POST). Ruta relativa a ETL_BASE_URL, por ejemplo "/vacaciones".
     * VACÍA = ETL aún no la publica: el bot arma la solicitud pero NO la envía.
     */
    rutaSolicitudVacaciones: process.env.ETL_SOLICITUD_VACACIONES_RUTA?.trim() || undefined,
  },
  /** Valores fijos del cuerpo de la solicitud de vacaciones (modelo de Buk POST /vacations). */
  solicitudVacaciones: {
    /** Tipo de vacaciones. Siempre "legales" por ahora. */
    tipo: process.env.VACACIONES_TIPO?.trim() || 'legales',
    /**
     * percent_day de Buk: porcentaje de la jornada (100 = día completo, 50 = medio día).
     * NO es la cantidad de días: los días salen de start_date y end_date.
     */
    porcentajeDia: Number(process.env.VACACIONES_PERCENT_DAY ?? 100),
    /** workday_stage de Buk: "full_working_day" = jornada completa. */
    jornada: process.env.VACACIONES_WORKDAY_STAGE?.trim() || 'full_working_day',
  },
  /**
   * Calendario para elegir la fecha de inicio de vacaciones (meta/calendario.flow.json).
   * Opcional: si no está definido o Meta rechaza el envío, se usan las listas año -> mes -> día.
   */
  flowCalendario: {
    id: process.env.META_FLOW_CALENDARIO_ID?.trim() || undefined,
    pantalla: 'FECHA_INICIO',
  },
  flowRegistro: {
    id: requerida('META_FLOW_ID'),
    /** Mientras el flow esté en borrador se envía con mode: 'draft'. */
    borrador: process.env.META_FLOW_DRAFT?.trim() !== 'false',
    pantalla: 'REGISTRO',
  },
} as const
