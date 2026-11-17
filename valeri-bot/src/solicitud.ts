import type { MetaProvider } from '@builderbot/provider-meta'
import { aniosInicio, diaCorto, diasInicio, fecha, fechaFin, fechaIso, fechaLarga, inicioPermitido, MESES_LARGOS, mesesInicio, siguienteHabil } from './fechas'
import { MSG } from './mensajes'
import { enviarBotones, enviarLista, filaVolverMenu, MESES, paginarFilas, type FilaLista } from './menu'
import { esBoton } from './validadores'

/**
 * SOLICITAR VACACIONES — flujo completo:
 *   1. Cantidad de días (1..N, N = disponibles)          -> vac_dias_{n}
 *   2. Año -> mes -> día de inicio (hoy .. hoy + 1 año, sin domingos) -> vi_*
 *   3. Resumen: fin calculado contando N días hábiles (domingos no cuentan)
 *      con [Confirmar] [Editar fecha] [Cancelar]
 *   4. Confirmar -> cuerpo Buk POST /vacations -> ETL (si ETL_SOLICITUD_VACACIONES_RUTA está definida)
 *
 * Paso 1: lista de cantidades de días (1..N), donde N son los días
 * disponibles del empleado (ETL /vacaciones, parte entera del stock). Nunca se ofrece
 * más de lo disponible, y al elegir se vuelve a consultar el saldo (opciones.ts).
 *
 * Meta permite MÁXIMO 10 filas por lista, y la última siempre es "🏠 Menú principal".
 *  - N ≤ 9: una sola lista con 1..N + Menú.
 *  - N > 9: páginas.
 *      Página 1:        8 días                      + "Más días"  + Menú  (10 filas)
 *      Intermedias:     "Días anteriores" + 7 días  + "Más días"  + Menú  (10 filas)
 *      Última:          "Días anteriores" + ≤ 8 días              + Menú  (≤ 10 filas)
 *
 * Ids:
 *  - vac_dias_{n}            -> eligió n días.
 *  - vac_pag_{inicio}_{max}  -> mostrar la página que empieza en "inicio" con máximo "max"
 *                               (se lleva el máximo en el id para no consultar ETL en cada página).
 */

export const ID_SOLICITUD = {
  dias: (n: number) => `vac_dias_${n}`,
  pagina: (inicio: number, max: number) => `vac_pag_${inicio}_${max}`,
}

export function leerIdSolicitud(id: string): { tipo: 'dias'; dias: number } | { tipo: 'pagina'; inicio: number; max: number } | null {
  let m = /^vac_dias_(\d{1,3})$/.exec(id)
  if (m && Number(m[1]) >= 1) return { tipo: 'dias', dias: Number(m[1]) }
  m = /^vac_pag_(\d{1,3})_(\d{1,3})$/.exec(id)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2])) return { tipo: 'pagina', inicio: Number(m[1]), max: Number(m[2]) }
  return null
}

/** Días que se pueden solicitar: parte entera del saldo (2,08 -> 2). Nunca negativo. */
export function diasSolicitables(stock: number): number {
  return Number.isFinite(stock) && stock > 0 ? Math.floor(stock) : 0
}

/** Inicio de cada página para un máximo dado (1, 9, 16, 23, ...). */
export function iniciosPaginas(max: number): number[] {
  if (max <= 9) return [1]
  const inicios = [1]
  let inicio = 9 // la página 1 muestra 1..8
  while (true) {
    inicios.push(inicio)
    const restantes = max - inicio + 1
    if (restantes <= 8) break // última página: cabe todo
    inicio += 7
  }
  return inicios
}

/** Filas de la página que empieza en "inicio". Siempre ≤ 10 y la última es Menú principal. */
export function filasDias(inicio: number, max: number): FilaLista[] {
  const s = MSG.solicitud
  const fila = (n: number): FilaLista => ({ id: ID_SOLICITUD.dias(n), title: s.fila(n), description: s.descFila(max) })
  const rango = (desde: number, hasta: number) => Array.from({ length: hasta - desde + 1 }, (_, i) => fila(desde + i))

  if (max <= 9) return [...rango(1, max), filaVolverMenu()]

  const inicios = iniciosPaginas(max)
  // Un inicio que no corresponde a ninguna página (id viejo) se lleva a la página 1.
  const pos = Math.max(0, inicios.indexOf(inicio))
  const desde = inicios[pos]
  const anterior = pos > 0 ? inicios[pos - 1] : null
  const siguiente = pos < inicios.length - 1 ? inicios[pos + 1] : null
  const hasta = siguiente ? siguiente - 1 : max

  const filas: FilaLista[] = []
  if (anterior) filas.push({ id: ID_SOLICITUD.pagina(anterior, max), title: s.diasAnteriores, description: s.diasAnterioresDesc })
  filas.push(...rango(desde, hasta))
  if (siguiente) filas.push({ id: ID_SOLICITUD.pagina(siguiente, max), title: s.masDias, description: s.masDiasDesc })
  filas.push(filaVolverMenu())
  return filas
}

/** Rango de días que muestra la página (para el título de la sección). */
function rangoPagina(inicio: number, max: number): [number, number] {
  if (max <= 9) return [1, max]
  const inicios = iniciosPaginas(max)
  const pos = Math.max(0, inicios.indexOf(inicio))
  const siguiente = inicios[pos + 1]
  return [inicios[pos], siguiente ? siguiente - 1 : max]
}

export function enviarDias(provider: MetaProvider, to: string, max: number, inicio = 1) {
  const s = MSG.solicitud
  const [desde, hasta] = rangoPagina(inicio, max)
  return enviarLista(provider, to, {
    encabezado: s.encabezado,
    cuerpo: s.cuerpo(max),
    boton: s.boton,
    seccion: s.seccion(desde, hasta),
    filas: filasDias(inicio, max),
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Fecha de inicio: año -> mes -> día (ventana: hoy .. hoy + 1 año, sin domingos)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Ids (n = días elegidos; viaja en todos los ids para no depender de memoria):
 *  - vi_a_{n}_{AAAA}             -> eligió el año      -> lista de meses
 *  - vi_mp_{n}_{AAAA}_{p}        -> página p de meses
 *  - vi_m_{n}_{AAAA}_{M}         -> eligió el mes      -> lista de días
 *  - vi_dp_{n}_{AAAA}_{M}_{p}    -> página p de días
 *  - vi_d_{n}_{AAAA}_{M}_{D}     -> eligió el día      -> resumen con [Confirmar] [Editar fecha] [Cancelar]
 */
export const ID_INICIO = {
  anio: (n: number, a: number) => `vi_a_${n}_${a}`,
  paginaMeses: (n: number, a: number, p: number) => `vi_mp_${n}_${a}_${p}`,
  mes: (n: number, a: number, m: number) => `vi_m_${n}_${a}_${m}`,
  paginaDias: (n: number, a: number, m: number, p: number) => `vi_dp_${n}_${a}_${m}_${p}`,
  dia: (n: number, a: number, m: number, d: number) => `vi_d_${n}_${a}_${m}_${d}`,
}

export type SeleccionInicio =
  | { tipo: 'anio'; dias: number; anio: number }
  | { tipo: 'paginaMeses'; dias: number; anio: number; pagina: number }
  | { tipo: 'mes'; dias: number; anio: number; mes: number }
  | { tipo: 'paginaDias'; dias: number; anio: number; mes: number; pagina: number }
  | { tipo: 'dia'; dias: number; anio: number; mes: number; dia: number }

export function leerIdInicio(id: string): SeleccionInicio | null {
  const m = /^vi_(a|mp|m|dp|d)_(\d{1,3})_(\d{4})(?:_(\d{1,2}))?(?:_(\d{1,2}))?$/.exec(id)
  if (!m) return null
  const [, tipo, n, a, x, y] = m
  const dias = Number(n)
  const anio = Number(a)
  if (dias < 1) return null
  const mesOk = (v: string | undefined) => v !== undefined && Number(v) >= 1 && Number(v) <= 12
  switch (tipo) {
    case 'a':
      return x === undefined ? { tipo: 'anio', dias, anio } : null
    case 'mp':
      return x !== undefined && y === undefined ? { tipo: 'paginaMeses', dias, anio, pagina: Number(x) } : null
    case 'm':
      return mesOk(x) && y === undefined ? { tipo: 'mes', dias, anio, mes: Number(x) } : null
    case 'dp':
      return mesOk(x) && y !== undefined ? { tipo: 'paginaDias', dias, anio, mes: Number(x), pagina: Number(y) } : null
    case 'd':
      return mesOk(x) && y !== undefined ? { tipo: 'dia', dias, anio, mes: Number(x), dia: Number(y) } : null
  }
  return null
}

export function enviarAniosInicio(provider: MetaProvider, to: string, dias: number) {
  const s = MSG.solicitud
  return enviarLista(provider, to, {
    encabezado: s.encabezadoFecha,
    cuerpo: s.preguntaAnio(dias),
    boton: s.botonAnios,
    seccion: s.seccionAnios,
    filas: [...aniosInicio().map((a) => ({ id: ID_INICIO.anio(dias, a), title: String(a), description: s.descAnio })), filaVolverMenu()],
  })
}

export function filasMesesInicio(dias: number, anio: number, pagina: number, ahora = new Date()): FilaLista[] {
  const s = MSG.solicitud
  const filas = mesesInicio(anio, ahora).map((m) => ({ id: ID_INICIO.mes(dias, anio, m), title: MESES[m - 1], description: s.descMes(anio) }))
  return paginarFilas(filas, pagina, (p) => ID_INICIO.paginaMeses(dias, anio, p), {
    siguiente: s.masMeses,
    siguienteDesc: s.masMesesDesc,
    anterior: s.mesesAnteriores,
    anteriorDesc: s.mesesAnterioresDesc,
  })
}

export function enviarMesesInicio(provider: MetaProvider, to: string, dias: number, anio: number, pagina = 1) {
  const s = MSG.solicitud
  return enviarLista(provider, to, {
    encabezado: s.encabezadoFecha,
    cuerpo: s.preguntaMes(anio),
    boton: s.botonMeses,
    seccion: String(anio),
    filas: filasMesesInicio(dias, anio, pagina),
  })
}

export function filasDiasInicio(dias: number, anio: number, mes: number, pagina: number, ahora = new Date()): FilaLista[] {
  const s = MSG.solicitud
  const filas = diasInicio(anio, mes, ahora).map((d) => {
    const f = fecha(anio, mes, d)
    return { id: ID_INICIO.dia(dias, anio, mes, d), title: diaCorto(f), description: fechaLarga(f) }
  })
  return paginarFilas(filas, pagina, (p) => ID_INICIO.paginaDias(dias, anio, mes, p), {
    siguiente: s.masFechas,
    siguienteDesc: s.masFechasDesc,
    anterior: s.fechasAnteriores,
    anteriorDesc: s.fechasAnterioresDesc,
  })
}

export function enviarDiasInicio(provider: MetaProvider, to: string, dias: number, anio: number, mes: number, pagina = 1) {
  const s = MSG.solicitud
  return enviarLista(provider, to, {
    encabezado: s.encabezadoFecha,
    cuerpo: s.preguntaDia(MESES[mes - 1], anio),
    boton: s.botonDias,
    seccion: `${MESES[mes - 1]} ${anio}`.slice(0, 24),
    filas: filasDiasInicio(dias, anio, mes, pagina),
  })
}

/** true si el año/mes/día elegido sigue siendo un inicio válido (dentro de la ventana y no domingo). */
export function inicioValido(anio: number, mes: number, dia: number, ahora = new Date()): boolean {
  return MESES_LARGOS[mes - 1] !== undefined && diasInicio(anio, mes, ahora).includes(dia) && inicioPermitido(fecha(anio, mes, dia), ahora)
}

// ═══════════════════════════════════════════════════════════════════════════
// Solicitud en curso (entre el resumen y la confirmación)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Los botones del resumen llegan solo con su TÍTULO (el provider no entrega el id),
 * así que la solicitud que se está confirmando se guarda en memoria por wa_id.
 * Vence a los 30 minutos o si el bot se reinicia (entonces se responde MSG.solicitud.vencida).
 */
export type SolicitudEnCurso = { dias: number; inicio: string; fin: string; creada: number }

const VIGENCIA_MS = 30 * 60 * 1000
const enCurso = new Map<string, SolicitudEnCurso>()

export function guardarEnCurso(waId: string, s: Omit<SolicitudEnCurso, 'creada'>) {
  enCurso.set(waId, { ...s, creada: Date.now() })
}

export function obtenerEnCurso(waId: string): SolicitudEnCurso | null {
  const s = enCurso.get(waId)
  if (!s) return null
  if (Date.now() - s.creada > VIGENCIA_MS) {
    enCurso.delete(waId)
    return null
  }
  return s
}

export function borrarEnCurso(waId: string) {
  enCurso.delete(waId)
}

/** Calcula fin y regreso, guarda la solicitud en curso y envía el resumen con 3 botones. */
export async function enviarResumen(provider: MetaProvider, to: string, dias: number, anio: number, mes: number, dia: number) {
  const inicio = fecha(anio, mes, dia)
  const fin = fechaFin(inicio, dias)
  guardarEnCurso(to, { dias, inicio: fechaIso(inicio), fin: fechaIso(fin) })
  const b = MSG.botonesSolicitud
  await enviarBotones(provider, to, MSG.solicitud.resumen(dias, fechaLarga(inicio), fechaLarga(fin), fechaLarga(siguienteHabil(fin))), [
    { id: 'sol_confirmar', titulo: b.confirmar },
    { id: 'sol_editar', titulo: b.editar },
    { id: 'sol_cancelar', titulo: b.cancelar },
  ])
}

export type RespuestaResumen = 'confirmar' | 'editar' | 'cancelar'

/** Reconoce los botones del resumen por su título (ctx.title_button_reply). */
export function leerBotonResumen(titulo: unknown): RespuestaResumen | null {
  if (typeof titulo !== 'string') return null
  const b = MSG.botonesSolicitud
  if (esBoton(titulo, b.confirmar)) return 'confirmar'
  if (esBoton(titulo, b.editar)) return 'editar'
  if (esBoton(titulo, b.cancelar)) return 'cancelar'
  return null
}
