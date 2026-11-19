/**
 * Fechas de vacaciones. Todo se maneja como fecha local (sin hora) del servidor (Colombia).
 *
 * Reglas (las mismas con que Buk cuenta working_days):
 *  - La fecha de inicio puede ir de HOY hasta HOY + 1 año (VENTANA_MESES).
 *  - Día HÁBIL = lunes a sábado que no sea festivo de Colombia.
 *  - DOMINGOS y FESTIVOS no se cuentan y no se puede iniciar en ellos.
 *  - Días calendario = todos los días entre inicio y fin, ambos incluidos.
 *
 * Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani"): se calculan por año, sin tablas a mano.
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

// ── Festivos de Colombia ────────────────────────────────────────────────────

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function domingoDePascua(anio: number): Date {
  const a = anio % 19
  const b = Math.floor(anio / 100)
  const c = anio % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return fecha(anio, mes, dia)
}

/** Ley Emiliani: si no cae en lunes, el festivo se traslada al lunes siguiente. */
function alLunes(f: Date): Date {
  const dia = f.getDay()
  return dia === 1 ? f : sumarDias(f, (8 - dia) % 7)
}

const cacheFestivos = new Map<number, Set<string>>()

/** Festivos de Colombia de un año, como "YYYY-MM-DD". */
export function festivosColombia(anio: number): Set<string> {
  const guardado = cacheFestivos.get(anio)
  if (guardado) return guardado
  const pascua = domingoDePascua(anio)
  const dias: Date[] = [
    // Fijos (no se trasladan)
    fecha(anio, 1, 1), // Año Nuevo
    fecha(anio, 5, 1), // Día del Trabajo
    fecha(anio, 7, 20), // Independencia
    fecha(anio, 8, 7), // Batalla de Boyacá
    fecha(anio, 12, 8), // Inmaculada Concepción
    fecha(anio, 12, 25), // Navidad
    // Se trasladan al lunes
    alLunes(fecha(anio, 1, 6)), // Reyes Magos
    alLunes(fecha(anio, 3, 19)), // San José
    alLunes(fecha(anio, 6, 29)), // San Pedro y San Pablo
    alLunes(fecha(anio, 8, 15)), // Asunción de la Virgen
    alLunes(fecha(anio, 10, 12)), // Día de la Raza
    alLunes(fecha(anio, 11, 1)), // Todos los Santos
    alLunes(fecha(anio, 11, 11)), // Independencia de Cartagena
    // Según la Pascua
    sumarDias(pascua, -3), // Jueves Santo
    sumarDias(pascua, -2), // Viernes Santo
    sumarDias(pascua, 43), // Ascensión del Señor (lunes)
    sumarDias(pascua, 64), // Corpus Christi (lunes)
    sumarDias(pascua, 71), // Sagrado Corazón (lunes)
  ]
  const conjunto = new Set(dias.map(fechaIso))
  cacheFestivos.set(anio, conjunto)
  return conjunto
}

export function esFestivo(f: Date): boolean {
  return festivosColombia(f.getFullYear()).has(fechaIso(f))
}

/** Día hábil para vacaciones: lunes a sábado que no sea festivo. */
export function esHabil(f: Date): boolean {
  return !esDomingo(f) && !esFestivo(f)
}

/** Festivos (YYYY-MM-DD) entre dos fechas, ambas incluidas. */
export function festivosEntre(desde: Date, hasta: Date): string[] {
  const salida: string[] = []
  for (let a = desde.getFullYear(); a <= hasta.getFullYear(); a++) {
    for (const iso of festivosColombia(a)) {
      const f = leerFechaIso(iso)
      if (f && f >= desde && f <= hasta) salida.push(iso)
    }
  }
  return salida.sort()
}

/** Días calendario entre inicio y fin, ambos incluidos. */
export function diasCalendario(inicio: Date, fin: Date): number {
  return Math.round((fin.getTime() - inicio.getTime()) / 86_400_000) + 1
}

/** Días hábiles entre inicio y fin, ambos incluidos (equivalente a Buk business_days). */
export function diasHabilesEntre(inicio: Date, fin: Date): number {
  let n = 0
  for (let f = inicio; f <= fin; f = sumarDias(f, 1)) if (esHabil(f)) n++
  return n
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

/** true si la fecha puede ser inicio de vacaciones: dentro de la ventana y es día hábil (no domingo ni festivo). */
export function inicioPermitido(f: Date, ahora = new Date()): boolean {
  const { desde, hasta } = ventanaInicio(ahora)
  return f >= desde && f <= hasta && esHabil(f)
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
 * (el día de inicio cuenta como el primero). Domingos y festivos se saltan.
 * Ej.: jueves 12-nov-2026, 4 días -> jue 12, vie 13, sáb 14, (dom 15 no, lun 16 festivo no), mar 17 = fin.
 */
export function fechaFin(inicio: Date, dias: number): Date {
  let f = inicio
  let contados = esHabil(f) ? 1 : 0
  while (contados < dias) {
    f = sumarDias(f, 1)
    if (esHabil(f)) contados++
  }
  return f
}

/** Siguiente día hábil después de una fecha (día de regreso al trabajo). */
export function siguienteHabil(f: Date): Date {
  let s = sumarDias(f, 1)
  while (!esHabil(s)) s = sumarDias(s, 1)
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
