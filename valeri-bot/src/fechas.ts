/**
 * Fechas de vacaciones. Todo se maneja como fecha local (sin hora) del servidor (Colombia).
 *
 * Reglas:
 *  - La fecha de inicio puede ir de HOY hasta HOY + 1 año (VENTANA_MESES).
 *  - Los DOMINGOS no son días hábiles: no se puede iniciar en domingo y no se cuentan.
 *    Lunes a sábado sí cuentan.
 *  - Pendiente: los festivos de Colombia tampoco deberían contarse (Buk los calcula con
 *    GET /vacations/business_days). Hoy NO se descuentan.
 */

export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Cuántos meses hacia adelante se permite iniciar las vacaciones. */
export const VENTANA_MESES = 12

/** Fecha local sin hora. */
export function fecha(anio: number, mes: number, dia: number): Date {
  return new Date(anio, mes - 1, dia)
}

export function hoy(ahora = new Date()): Date {
  return fecha(ahora.getFullYear(), ahora.getMonth() + 1, ahora.getDate())
}

export function sumarDias(f: Date, dias: number): Date {
  return fecha(f.getFullYear(), f.getMonth() + 1, f.getDate() + dias)
}

export function esDomingo(f: Date): boolean {
  return f.getDay() === 0
}

/** true si la fecha existe de verdad (evita 31 de febrero, etc.). */
export function fechaValida(anio: number, mes: number, dia: number): boolean {
  const f = fecha(anio, mes, dia)
  return f.getFullYear() === anio && f.getMonth() === mes - 1 && f.getDate() === dia
}

/** Primer y último día permitidos para iniciar: [hoy, hoy + 1 año]. */
export function ventanaInicio(ahora = new Date()): { desde: Date; hasta: Date } {
  const desde = hoy(ahora)
  const hasta = fecha(desde.getFullYear(), desde.getMonth() + 1 + VENTANA_MESES, desde.getDate())
  return { desde, hasta }
}

/** true si la fecha puede ser inicio de vacaciones: dentro de la ventana y no es domingo. */
export function inicioPermitido(f: Date, ahora = new Date()): boolean {
  const { desde, hasta } = ventanaInicio(ahora)
  return f >= desde && f <= hasta && !esDomingo(f)
}

/** Años en los que se puede iniciar (el actual y el siguiente). */
export function aniosInicio(ahora = new Date()): number[] {
  const { desde, hasta } = ventanaInicio(ahora)
  const anios: number[] = []
  for (let a = desde.getFullYear(); a <= hasta.getFullYear(); a++) anios.push(a)
  return anios.filter((a) => mesesInicio(a, ahora).length > 0)
}

/** Meses (1..12) de un año que tienen al menos un día de inicio permitido, en orden. */
export function mesesInicio(anio: number, ahora = new Date()): number[] {
  return Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => diasInicio(anio, m, ahora).length > 0)
}

/** Días (1..31) de un mes en los que se puede iniciar, en orden. */
export function diasInicio(anio: number, mes: number, ahora = new Date()): number[] {
  const dias: number[] = []
  for (let d = 1; d <= 31; d++) {
    if (fechaValida(anio, mes, d) && inicioPermitido(fecha(anio, mes, d), ahora)) dias.push(d)
  }
  return dias
}

/**
 * Fecha fin: el día en que se completan `dias` días hábiles empezando en `inicio`
 * (el día de inicio cuenta como el primero). Los domingos se saltan.
 * Ej.: inicio jueves, 4 días -> jueves, viernes, sábado, (domingo no), lunes = fin lunes.
 */
export function fechaFin(inicio: Date, dias: number): Date {
  let f = inicio
  let contados = esDomingo(f) ? 0 : 1
  while (contados < dias) {
    f = sumarDias(f, 1)
    if (!esDomingo(f)) contados++
  }
  return f
}

/** Siguiente día hábil después de una fecha (día de regreso al trabajo). */
export function siguienteHabil(f: Date): Date {
  let s = sumarDias(f, 1)
  while (esDomingo(s)) s = sumarDias(s, 1)
  return s
}

/** "2026-11-16" (formato de Buk para start_date / end_date). */
export function fechaIso(f: Date): string {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
}

/** "2026-11-16" -> Date local, o null si no es válida. */
export function leerFechaIso(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
  if (!m || !fechaValida(Number(m[1]), Number(m[2]), Number(m[3]))) return null
  return fecha(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** "lunes 16 de noviembre de 2026". */
export function fechaLarga(f: Date): string {
  return `${DIAS_SEMANA[f.getDay()]} ${f.getDate()} de ${MESES_LARGOS[f.getMonth()]} de ${f.getFullYear()}`
}

/** "Lunes 16" (título de fila, ≤ 24 caracteres). */
export function diaCorto(f: Date): string {
  const nombre = DIAS_SEMANA[f.getDay()]
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} ${f.getDate()}`
}
