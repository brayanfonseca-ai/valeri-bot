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
    etlToken: process.env.ETL_TOKEN?.trim() || undefined,
  },
  flowRegistro: {
    id: requerida('META_FLOW_ID'),
    /** Mientras el flow esté en borrador se envía con mode: 'draft'. */
    borrador: process.env.META_FLOW_DRAFT?.trim() !== 'false',
    pantalla: 'REGISTRO',
  },
} as const
