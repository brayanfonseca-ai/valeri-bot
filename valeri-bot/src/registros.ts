/**
 * Almacenamiento PROVISIONAL en un archivo JSON (data/registros.json).
 * Clave: número de WhatsApp (wa_id). Solo se guardan empleados AUTORIZADOS:
 * estar en este archivo significa "validado, puede usar el menú".
 * Se reemplazará por la base de datos valeri_bot (PostgreSQL) en el servidor.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface Registro {
  cedula: string
  telefono: string
  confirmadoEn: string
  /** id del empleado en Buk, si lo devuelve la validación de ETL. */
  idBuk?: number
}

const RUTA = path.resolve('data', 'registros.json')

function leerTodos(): Record<string, Registro> {
  if (!fs.existsSync(RUTA)) return {}
  return JSON.parse(fs.readFileSync(RUTA, 'utf8'))
}

export function obtenerRegistro(waId: string): Registro | undefined {
  return leerTodos()[waId]
}

/** Devuelve el wa_id que ya tiene vinculada esa cédula, si existe. */
export function buscarNumeroPorCedula(cedula: string): string | undefined {
  const todos = leerTodos()
  return Object.keys(todos).find((waId) => todos[waId].cedula === cedula)
}

export function guardarRegistro(waId: string, registro: Registro): void {
  const todos = leerTodos()
  todos[waId] = registro
  fs.mkdirSync(path.dirname(RUTA), { recursive: true })
  fs.writeFileSync(RUTA, JSON.stringify(todos, null, 2), 'utf8')
}
