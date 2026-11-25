/**
 * Validación del empleado contra Buk (a través del endpoint de ETL).
 *
 * Modos (variable VALERI_VALIDACION):
 *  - "bd":      (por defecto) tabla `users` de valeri_bot: documento Y teléfono deben coincidir.
 *  - "abierta": PRUEBAS. Todo el que confirma sus datos queda autorizado. No consulta nada.
 *  - "etl":     PRODUCCIÓN. Consulta el endpoint de validación de ETL (ETL_VALIDACION_URL).
 *
 * Contrato PROVISIONAL del endpoint de ETL (confirmar con ETL antes de activar):
 *   GET {ETL_VALIDACION_URL}?cedula=1023456789&telefono=3001234567
 *   Cabecera: x-api-key: {ETL_TOKEN}   (igual que el resto de la API de ETL)
 *   Respuesta 200 JSON:
 *     { "autorizado": true,  "id_buk": 1234 }
 *     { "autorizado": false, "motivo": "no_encontrado" | "inactivo" | "telefono_no_coincide" }
 *   Del lado de ETL: GET /employees/{cédula} en Buk, empleado con status "activo"
 *   y teléfono registrado igual al ingresado (normalizado a 10 dígitos).
 */
import { config } from './config'
import { prisma } from './db'

export type MotivoRechazo = 'no_encontrado' | 'inactivo' | 'telefono_no_coincide' | 'desconocido'

export type ResultadoValidacion =
  | { estado: 'autorizado'; idBuk?: number }
  | { estado: 'no_autorizado'; motivo: MotivoRechazo }
  | { estado: 'error'; detalle: string }

const MOTIVOS: MotivoRechazo[] = ['no_encontrado', 'inactivo', 'telefono_no_coincide']

/**
 * Modo "bd": busca el documento en la tabla `users` (base valeri_bot, cargada
 * desde el CSV temporal). Autorizado SOLO si existe, está activo y el teléfono
 * registrado es IGUAL al ingresado (ambos normalizados a 10 dígitos).
 */
async function validarEnBaseDeDatos(cedula: string, telefono: string): Promise<ResultadoValidacion> {
  try {
    const usuario = await prisma.user.findUnique({ where: { document: cedula } })
    if (!usuario) return { estado: 'no_autorizado', motivo: 'no_encontrado' }
    if (!usuario.active) return { estado: 'no_autorizado', motivo: 'inactivo' }
    if (usuario.phone !== telefono) return { estado: 'no_autorizado', motivo: 'telefono_no_coincide' }
    return { estado: 'autorizado' }
  } catch (error) {
    return { estado: 'error', detalle: error instanceof Error ? error.message : String(error) }
  }
}

export async function validarEmpleado(cedula: string, telefono: string): Promise<ResultadoValidacion> {
  if (config.validacion.modo === 'abierta') {
    return { estado: 'autorizado' }
  }
  if (config.validacion.modo === 'bd') {
    return validarEnBaseDeDatos(cedula, telefono)
  }

  const url = config.validacion.etlUrl
  if (!url) {
    return { estado: 'error', detalle: 'ETL_VALIDACION_URL no está definido' }
  }

  try {
    const destino = new URL(url)
    destino.searchParams.set('cedula', cedula)
    destino.searchParams.set('telefono', telefono)
    // Misma autenticación que el resto de la API de ETL (API Gateway): x-api-key.
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (config.etl.apiKey) headers['x-api-key'] = config.etl.apiKey

    const respuesta = await fetch(destino, { headers, signal: AbortSignal.timeout(15000) })
    if (!respuesta.ok) {
      return { estado: 'error', detalle: `ETL respondió ${respuesta.status}` }
    }
    const cuerpo = (await respuesta.json()) as { autorizado?: unknown; motivo?: unknown; id_buk?: unknown }
    if (cuerpo.autorizado === true) {
      return { estado: 'autorizado', idBuk: typeof cuerpo.id_buk === 'number' ? cuerpo.id_buk : undefined }
    }
    if (cuerpo.autorizado === false) {
      const motivo = MOTIVOS.includes(cuerpo.motivo as MotivoRechazo) ? (cuerpo.motivo as MotivoRechazo) : 'desconocido'
      return { estado: 'no_autorizado', motivo }
    }
    return { estado: 'error', detalle: 'respuesta de ETL sin el campo "autorizado"' }
  } catch (error) {
    return { estado: 'error', detalle: error instanceof Error ? error.message : String(error) }
  }
}
