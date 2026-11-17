import type { MetaProvider } from '@builderbot/provider-meta'
import { BOTONES_OTRA_CONSULTA, MSG } from './mensajes'

/**
 * Menús tipo lista de WhatsApp.
 * Límites de Meta: encabezado 60, cuerpo 1024, pie 60, botón 20,
 * título de fila 24, descripción de fila 72 caracteres, MÁXIMO 10 FILAS por lista.
 *
 * Los "id" de cada fila llegan de vuelta en ctx.id_list_reply cuando el usuario
 * la elige (ver opciones.ts → atenderSeleccion). No cambiarlos sin actualizar opciones.ts.
 */

// ── Menú principal ──────────────────────────────────────────────────────────
export const OPCIONES_MENU = [
  { id: 'comprobante', title: 'Comprobante de pago', description: 'Descarga tu comprobante de nómina en PDF' },
  { id: 'dias_vacaciones', title: 'Días de vacaciones', description: 'Consulta tus días pendientes por disfrutar' },
  { id: 'solicitar_vacaciones', title: 'Solicitar vacaciones', description: 'Pide tus días de descanso' },
  { id: 'certificado', title: 'Certificado laboral', description: 'Descarga tu certificado en PDF' },
  { id: 'agente', title: 'Hablar con agente', description: 'Te atiende un asesor de Recursos Humanos' },
] as const

export type IdOpcion = (typeof OPCIONES_MENU)[number]['id']

export function esOpcionMenu(id: unknown): id is IdOpcion {
  return OPCIONES_MENU.some((o) => o.id === id)
}

export function enviarMenu(provider: MetaProvider, to: string) {
  const m = MSG.menu
  return enviarLista(provider, to, {
    encabezado: m.encabezado,
    cuerpo: m.cuerpo,
    boton: m.boton,
    seccion: m.seccion,
    filas: OPCIONES_MENU.map((o) => ({ ...o })),
  })
}

// ── Comprobante de pago: año y mes ─────────────────────────────────────────
export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/** Cuántos años hacia atrás se ofrecen (incluye el actual). */
export const ANIOS_COMPROBANTE = 3

/** Fila que se agrega al final de todas las listas secundarias para volver al menú principal. */
export const ID_VOLVER_MENU = 'volver_menu'
export const filaVolverMenu = () => ({ id: ID_VOLVER_MENU, title: MSG.volverMenu.titulo, description: MSG.volverMenu.descripcion })

/** Ids de las filas del comprobante. */
export const ID = {
  anio: (anio: number) => `anio_${anio}`,
  mes: (anio: number, mes: number) => `mes_${anio}_${mes}`,
  pagina: (anio: number, pagina: number) => `meses_${anio}_${pagina}`,
}

/** Interpreta un id de fila del comprobante. */
export function leerIdComprobante(
  id: string,
): { tipo: 'anio'; anio: number } | { tipo: 'mes'; anio: number; mes: number } | { tipo: 'pagina'; anio: number; pagina: number } | null {
  let m = /^anio_(\d{4})$/.exec(id)
  if (m) return { tipo: 'anio', anio: Number(m[1]) }
  m = /^mes_(\d{4})_(\d{1,2})$/.exec(id)
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { tipo: 'mes', anio: Number(m[1]), mes: Number(m[2]) }
  m = /^meses_(\d{4})_([12])$/.exec(id)
  if (m) return { tipo: 'pagina', anio: Number(m[1]), pagina: Number(m[2]) }
  return null
}

/** Años ofrecidos: el actual y los anteriores (ANIOS_COMPROBANTE en total). */
export function aniosDisponibles(hoy = new Date()): number[] {
  return Array.from({ length: ANIOS_COMPROBANTE }, (_, i) => hoy.getFullYear() - i)
}

/** Meses de un año, del más reciente al más antiguo. En el año actual, solo hasta el mes actual. */
export function mesesDisponibles(anio: number, hoy = new Date()): number[] {
  const ultimo = anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12
  return Array.from({ length: ultimo }, (_, i) => ultimo - i)
}

/**
 * Filas de la lista de meses, respetando el máximo de 10 filas de Meta.
 * La última fila SIEMPRE es "🏠 Menú principal".
 *  - 9 meses o menos: todos + Menú principal.
 *  - Más de 9: página 1 = 8 meses más recientes + "Más meses" + Menú principal;
 *              página 2 = meses restantes + "Meses recientes" + Menú principal.
 */
export function filasMeses(anio: number, pagina: 1 | 2, hoy = new Date()) {
  const meses = mesesDisponibles(anio, hoy)
  const fila = (mes: number) => ({ id: ID.mes(anio, mes), title: MESES[mes - 1], description: String(anio) })
  if (meses.length <= 9) return [...meses.map(fila), filaVolverMenu()]
  if (pagina === 1) {
    return [
      ...meses.slice(0, 8).map(fila),
      { id: ID.pagina(anio, 2), title: MSG.comprobante.masMeses, description: MSG.comprobante.masMesesDesc },
      filaVolverMenu(),
    ]
  }
  return [
    ...meses.slice(8).map(fila),
    { id: ID.pagina(anio, 1), title: MSG.comprobante.mesesRecientes, description: MSG.comprobante.mesesRecientesDesc },
    filaVolverMenu(),
  ]
}

export function enviarAnios(provider: MetaProvider, to: string) {
  const c = MSG.comprobante
  return enviarLista(provider, to, {
    encabezado: c.encabezado,
    cuerpo: c.preguntaAnio,
    boton: c.botonAnios,
    seccion: c.seccionAnios,
    filas: [...aniosDisponibles().map((anio) => ({ id: ID.anio(anio), title: String(anio), description: c.descAnio })), filaVolverMenu()],
  })
}

export function enviarMeses(provider: MetaProvider, to: string, anio: number, pagina: 1 | 2 = 1) {
  const c = MSG.comprobante
  return enviarLista(provider, to, {
    encabezado: c.encabezado,
    cuerpo: c.preguntaMes(anio),
    boton: c.botonMeses,
    seccion: String(anio),
    filas: filasMeses(anio, pagina),
  })
}

// ── "¿Deseas realizar otra consulta?" (3 botones) ──────────────────────────
/**
 * Se envía al terminar CUALQUIER proceso del menú (no solo archivos). Se arma a mano (no provider.sendButtons)
 * porque el provider recorta los títulos a 16 caracteres y "Hablar con agente" tiene 17.
 * La respuesta llega como ctx.title_button_reply con el TÍTULO del botón
 * (el provider no expone el id); la atiende opciones.ts → atenderOtraConsulta.
 */
export function enviarOtraConsulta(provider: MetaProvider, to: string, queSeEntrego?: string): Promise<void> {
  const b = BOTONES_OTRA_CONSULTA
  return enviarBotones(provider, to, MSG.otraConsulta(queSeEntrego), [
    { id: 'otra_si', titulo: b.si },
    { id: 'otra_finalizar', titulo: b.finalizar },
    { id: 'otra_agente', titulo: b.agente },
  ])
}

/**
 * Mensaje con hasta 3 botones de respuesta (título ≤ 20 caracteres, cuerpo ≤ 1024).
 * Se arma a mano porque provider.sendButtons recorta los títulos a 16 caracteres.
 * OJO: la respuesta llega como ctx.title_button_reply con el TÍTULO (el provider no expone el id).
 */
export async function enviarBotones(
  provider: MetaProvider,
  to: string,
  cuerpo: string,
  botones: { id: string; titulo: string }[],
): Promise<void> {
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: cuerpo.slice(0, 1024) },
      footer: { text: MSG.menu.pie },
      action: {
        buttons: botones.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.titulo.slice(0, 20) } })),
      },
    },
  }
  const respuesta = await provider.sendMessageMeta(body as unknown as Parameters<MetaProvider['sendMessageMeta']>[0])
  const error = respuesta?.error ?? respuesta?.response?.data?.error
  if (error) {
    console.error('[menu] Meta rechazó el envío de botones:', JSON.stringify(error))
  }
}

// ── Paginación genérica de listas ───────────────────────────────────────────
/**
 * Reparte filas en páginas de máximo 10 filas, con "🏠 Menú principal" siempre al final:
 *  - 9 filas o menos: una sola página.
 *  - Más: página 1 = 8 filas + "siguiente" + Menú; intermedias = "anterior" + 7 + "siguiente" + Menú;
 *         última = "anterior" + hasta 8 + Menú.
 * `idPagina(p)` arma el id de la fila que lleva a la página p (1, 2, 3...).
 */
export function paginarFilas(
  filas: FilaLista[],
  pagina: number,
  idPagina: (p: number) => string,
  textos: { siguiente: string; siguienteDesc: string; anterior: string; anteriorDesc: string },
): FilaLista[] {
  if (filas.length <= 9) return [...filas, filaVolverMenu()]
  const paginas: FilaLista[][] = [filas.slice(0, 8)]
  let i = 8
  while (filas.length - i > 8) {
    paginas.push(filas.slice(i, i + 7))
    i += 7
  }
  paginas.push(filas.slice(i))

  const p = Math.min(Math.max(1, pagina), paginas.length)
  const salida: FilaLista[] = []
  if (p > 1) salida.push({ id: idPagina(p - 1), title: textos.anterior, description: textos.anteriorDesc })
  salida.push(...paginas[p - 1])
  if (p < paginas.length) salida.push({ id: idPagina(p + 1), title: textos.siguiente, description: textos.siguienteDesc })
  salida.push(filaVolverMenu())
  return salida
}

// ── Envío genérico de una lista ─────────────────────────────────────────────
export type FilaLista = { id: string; title: string; description: string }

export async function enviarLista(
  provider: MetaProvider,
  to: string,
  lista: { encabezado: string; cuerpo: string; boton: string; seccion: string; filas: FilaLista[] },
): Promise<void> {
  const respuesta = await provider.sendList(to, {
    header: { type: 'text', text: lista.encabezado },
    body: { text: lista.cuerpo },
    footer: { text: MSG.menu.pie },
    action: { button: lista.boton, sections: [{ title: lista.seccion, rows: lista.filas.slice(0, 10) }] },
  })
  const error = respuesta?.error ?? respuesta?.response?.data?.error
  if (error) {
    console.error('[menu] Meta rechazó el envío de una lista:', JSON.stringify(error))
  }
}
