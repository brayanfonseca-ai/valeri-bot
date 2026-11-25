/**
 * Atención de lo que el usuario elige en las listas (ctx.id_list_reply).
 *
 * | Selección                   | Qué hace                                                        |
 * |-----------------------------|-----------------------------------------------------------------|
 * | comprobante                 | Lista de años                                                   |
 * | anio_AAAA                   | Lista de meses de ese año (paginada si son más de 10)           |
 * | meses_AAAA_N                | Página N (1 o 2) de la lista de meses                           |
 * | mes_AAAA_M                  | ETL /extracto/{cédula}?year&month -> descarga PDF -> Meta media -> documento -> "¿otra consulta?" (3 botones) |
 * | dias_vacaciones             | ETL /vacaciones/{cédula}?date=hoy -> número de días -> "¿otra consulta?" |
 * | solicitar_vacaciones        | ETL /vacaciones -> lista de 1..N días (paginada, solicitud.ts)  |
 * | vac_pag_{inicio}_{max}      | Otra página de la lista de días                                 |
 * | vac_dias_{n}                | Re-consulta el saldo; si n <= disponibles -> lista de años de inicio |
 * | (calendario, nfm_reply)     | Fecha de inicio elegida en el calendario -> resumen (atenderCalendario) |
 * | vi_a / vi_mp / vi_m / vi_dp | RESPALDO del calendario: año, páginas y mes de inicio            |
 * | vi_d_{n}_{AAAA}_{M}_{D}     | Día de inicio -> resumen con fin calculado (sin domingos) + [Confirmar] [Editar fecha] [Cancelar] (atenderResumen) |
 * | certificado                 | ETL POST /certificado-laboral {cedula} -> PDF -> Meta media -> documento -> "¿otra consulta?" |
 * | agente                      | Modo agente de IA (modo-agente.ts) si está disponible para el número; si no, "en construcción" -> "¿otra consulta?" |
 * | volver_menu                 | Última fila de toda lista secundaria: vuelve al menú principal  |
 *
 * REGLA: todo proceso que termina (comprobante entregado o no, vacaciones, opciones
 * en construcción) cierra con "¿Deseas realizar otra consulta?" + 3 botones
 * (enviarOtraConsulta). Nunca vuelve directo al menú.
 *
 * Devuelve "menu" solo para "🏠 Menú principal" (volver_menu), y "nada" cuando ya se
 * envió algo que el usuario debe responder (lista de años/meses o los 3 botones).
 */
import type { MetaProvider } from '@builderbot/provider-meta'
import { agenteDisponiblePara } from './agente'
import { entrarModoAgente } from './modo-agente'
import {
  armarSolicitudVacaciones,
  crearSolicitudVacaciones,
  leerMotivoRechazo,
  leerVacacionRegistrada,
  type VacacionRegistrada,
  descargarPdf,
  obtenerCertificado,
  obtenerComprobante,
  obtenerVacaciones,
  solicitudVacacionesHabilitada,
  type ErrorEtl,
} from './etl'
import { enviarPdf } from './media'
import { BOTONES_OTRA_CONSULTA, MSG } from './mensajes'
import {
  aniosDisponibles,
  enviarAnios,
  enviarMeses,
  enviarOtraConsulta,
  esOpcionMenu,
  ID_VOLVER_MENU,
  leerIdComprobante,
  MESES,
  mesesDisponibles,
  OPCIONES_MENU,
} from './menu'
import { obtenerRegistro } from './registros'
import {
  aniosInicio,
  diasCalendario,
  fechaIso,
  fechaLarga,
  festivosEntre,
  inicioPermitido,
  leerFechaIso,
  mesesInicio,
  siguienteHabil,
  ventanaInicio,
} from './fechas'
import { enviarCalendario } from './formulario'
import {
  borrarEnCurso,
  diasSolicitables,
  enviarAniosInicio,
  enviarDias,
  enviarDiasInicio,
  enviarMesesInicio,
  enviarResumen,
  inicioValido,
  leerIdInicio,
  leerIdSolicitud,
  obtenerEnCurso,
  type RespuestaResumen,
  type SeleccionInicio,
  type SolicitudEnCurso,
} from './solicitud'
import { esBoton } from './validadores'

type Enviar = (texto: string) => Promise<void>
export type Siguiente = 'menu' | 'nada'

const oculto = (waId: string) => `******${(waId ?? '').slice(-4)}`

/** true si el id corresponde a algo que este módulo sabe atender. */
export function esSeleccionConocida(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    (id === ID_VOLVER_MENU ||
      esOpcionMenu(id) ||
      leerIdComprobante(id) !== null ||
      leerIdSolicitud(id) !== null ||
      leerIdInicio(id) !== null)
  )
}

export async function atenderSeleccion(id: string, waId: string, provider: MetaProvider, enviar: Enviar): Promise<Siguiente> {
  const registro = await obtenerRegistro(waId)
  if (!registro) return 'nada'

  // "🏠 Menú principal" desde cualquier lista: solo se muestra el menú.
  if (id === ID_VOLVER_MENU) return 'menu'

  // ── "Solicitar vacaciones": fecha de inicio (año, mes, día) ──
  const ini = leerIdInicio(id)
  if (ini) {
    await atenderInicio(ini, waId, provider)
    return 'nada'
  }

  // ── Selecciones de "Solicitar vacaciones" (página de días, cantidad de días) ──
  const sol = leerIdSolicitud(id)
  if (sol) {
    if (sol.tipo === 'pagina') {
      await enviarDias(provider, waId, sol.max, sol.inicio)
      return 'nada'
    }
    if (!(await elegirDias(sol.dias, registro.cedula, waId, provider, enviar))) await enviarOtraConsulta(provider, waId)
    return 'nada'
  }

  // ── Selecciones del comprobante de pago (año, página de meses, mes) ──
  const comp = leerIdComprobante(id)
  if (comp) {
    if (!aniosDisponibles().includes(comp.anio)) {
      await enviarAnios(provider, waId)
      return 'nada'
    }
    if (comp.tipo === 'anio') {
      await enviarMeses(provider, waId, comp.anio, 1)
      return 'nada'
    }
    if (comp.tipo === 'pagina') {
      await enviarMeses(provider, waId, comp.anio, comp.pagina as 1 | 2)
      return 'nada'
    }
    if (!mesesDisponibles(comp.anio).includes(comp.mes)) {
      await enviarMeses(provider, waId, comp.anio, 1)
      return 'nada'
    }
    const entregado = await atenderComprobante(registro.cedula, comp.anio, comp.mes, waId, provider, enviar)
    // Regla: TODO proceso termina con "¿Deseas realizar otra consulta?" (nunca directo al menú).
    await enviarOtraConsulta(provider, waId, entregado ? MSG.comprobante.entregado : undefined)
    return 'nada'
  }

  // ── Opciones del menú principal ──
  switch (id) {
    case 'comprobante':
      await enviarAnios(provider, waId)
      return 'nada'
    case 'dias_vacaciones':
      await atenderVacaciones(registro.cedula, waId, enviar)
      await enviarOtraConsulta(provider, waId)
      return 'nada'
    case 'certificado': {
      const entregado = await atenderCertificado(registro.cedula, waId, provider, enviar)
      await enviarOtraConsulta(provider, waId, entregado ? MSG.certificado.entregado : undefined)
      return 'nada'
    }
    case 'solicitar_vacaciones':
      if (!(await iniciarSolicitud(registro.cedula, waId, provider, enviar))) await enviarOtraConsulta(provider, waId)
      return 'nada'
    case 'agente': {
      // Agente de IA de AWS. Cerrado (en construcción) mientras no esté configurado o
      // falte el control de identidad, salvo para los números de prueba.
      if (agenteDisponiblePara(waId)) {
        if (await entrarModoAgente(waId, provider)) return 'nada'
        await enviar(MSG.agente.error)
        await enviarOtraConsulta(provider, waId)
        return 'nada'
      }
      const opcion = OPCIONES_MENU.find((o) => o.id === id)
      await enviar(MSG.opcionEnConstruccion(opcion?.title ?? 'Hablar con agente'))
      await enviarOtraConsulta(provider, waId)
      return 'nada'
    }
    default: {
      // solicitar_vacaciones, certificado, agente: aún en construcción.
      const opcion = OPCIONES_MENU.find((o) => o.id === id)
      if (!opcion) return 'menu'
      await enviar(MSG.opcionEnConstruccion(opcion.title))
      await enviarOtraConsulta(provider, waId)
      return 'nada'
    }
  }
}

/** Registra el error técnico en consola (sin datos personales) y avisa al usuario. */
async function falla(operacion: string, waId: string, error: Pick<ErrorEtl, 'estado' | 'detalle'>, enviar: Enviar) {
  // El detalle de ETL puede traer la URL de Buk con la cédula: se enmascaran los números largos.
  const detalle = String(error.detalle ?? '').replace(/\d{5,}/g, (n) => `***${n.slice(-3)}`)
  console.error(`[etl] ${operacion} falló para ${oculto(waId)}: estado ${error.estado} ${detalle}`)
  await enviar(MSG.errorConsulta)
}

/**
 * Comprobante de pago: ETL entrega una URL prefirmada de S3 que el usuario NUNCA ve.
 * El bot descarga el PDF, lo sube a Meta y lo envía como documento (media.ts).
 */
async function atenderComprobante(
  cedula: string,
  anio: number,
  mes: number,
  waId: string,
  provider: MetaProvider,
  enviar: Enviar,
): Promise<boolean> {
  const nombreMes = MESES[mes - 1]
  await enviar(MSG.comprobante.buscando(nombreMes, anio))

  const r = await obtenerComprobante(cedula, anio, mes)
  if (!r.ok) {
    if (r.estado === 404) await enviar(MSG.comprobante.noEncontrado(nombreMes, anio))
    else await falla('comprobante', waId, r, enviar)
    return false
  }
  if (!r.datos.found || !r.datos.download_url) {
    await enviar(MSG.comprobante.noEncontrado(nombreMes, anio))
    return false
  }

  const pdf = await descargarPdf(r.datos.download_url)
  if (!pdf.ok) {
    await falla('descarga del comprobante', waId, pdf, enviar)
    return false
  }

  const envio = await enviarPdf(provider, waId, {
    contenido: pdf.contenido,
    nombre: `Comprobante_de_pago_${anio}-${String(mes).padStart(2, '0')}.pdf`,
    pie: MSG.comprobante.pie(nombreMes, anio),
  })
  if (!envio.ok) {
    await falla('envío del comprobante a Meta', waId, { estado: 0, detalle: envio.detalle }, enviar)
    return false
  }

  console.log(`[comprobante] enviado ${anio}-${mes} a ${oculto(waId)}`)
  return true
}

// ── "¿Deseas realizar otra consulta?" ───────────────────────────────────────

export type RespuestaOtraConsulta = 'si' | 'finalizar' | 'agente'

/** Reconoce el botón tocado por su título (ctx.title_button_reply). */
export function leerOtraConsulta(titulo: unknown): RespuestaOtraConsulta | null {
  if (typeof titulo !== 'string') return null
  if (esBoton(titulo, BOTONES_OTRA_CONSULTA.si)) return 'si'
  if (esBoton(titulo, BOTONES_OTRA_CONSULTA.finalizar)) return 'finalizar'
  if (esBoton(titulo, BOTONES_OTRA_CONSULTA.agente)) return 'agente'
  return null
}

/**
 * - "Sí, gracias"       -> menú principal.
 * - "No, finalizar"     -> despedida; quien llama cierra la sesión (state.clear) y NO envía menú.
 * - "Hablar con agente" -> igual que la opción 5 del menú ("agente"). Hoy: "en construcción" + los 3 botones.
 */
export async function atenderOtraConsulta(
  respuesta: RespuestaOtraConsulta,
  waId: string,
  provider: MetaProvider,
  enviar: Enviar,
): Promise<Siguiente | 'fin'> {
  if (respuesta === 'si') return 'menu'
  if (respuesta === 'finalizar') {
    await enviar(MSG.despedida)
    return 'fin'
  }
  return atenderSeleccion('agente', waId, provider, enviar)
}

/**
 * Saldo de vacaciones a HOY (ETL /vacaciones/{cédula}?date=hoy). Si Buk devuelve
 * varios tipos (legales, progresivas...), se suman. Si falla, avisa al usuario y devuelve null.
 */
async function consultarSaldo(cedula: string, waId: string, enviar: Enviar): Promise<number | null> {
  return (await consultarSaldoEId(cedula, waId, enviar))?.saldo ?? null
}

/**
 * Saldo de vacaciones y el ID DEL EMPLEADO EN BUK (employee_id de la respuesta de /vacaciones/{cédula}).
 * El POST de la solicitud necesita el id de Buk: con la cédula Buk responde 404 "No encontrado: Employee"
 * (verificado en vivo). idBuk es null si ETL no lo devuelve.
 */
async function consultarSaldoEId(cedula: string, waId: string, enviar: Enviar): Promise<{ saldo: number; idBuk: number | null } | null> {
  const r = await obtenerVacaciones(cedula, new Date())
  if (!r.ok) {
    await falla('vacaciones', waId, r, enviar)
    return null
  }
  const saldo = (r.datos.vacations ?? []).reduce((total, v) => total + (typeof v.stock === 'number' ? v.stock : 0), 0)
  const id = Number(r.datos.employee_id)
  return { saldo, idBuk: Number.isInteger(id) && id > 0 ? id : null }
}

/**
 * Certificado laboral: ETL POST /certificado-laboral {cedula} entrega una URL de S3 que el
 * usuario NUNCA ve. El bot descarga el PDF, lo sube a Meta y lo envía como documento.
 * Devuelve true si se entregó el PDF.
 */
async function atenderCertificado(cedula: string, waId: string, provider: MetaProvider, enviar: Enviar): Promise<boolean> {
  await enviar(MSG.certificado.buscando)

  const r = await obtenerCertificado(cedula)
  if (!r.ok) {
    if (r.estado === 404) await enviar(MSG.certificado.noEncontrado)
    else if (r.estado === 422) {
      console.error(`[certificado] ${oculto(waId)}: Buk sin datos suficientes: ${leerMotivoRechazo(r.detalle) ?? r.detalle}`)
      await enviar(MSG.certificado.datosIncompletos)
    } else await falla('certificado', waId, r, enviar)
    return false
  }
  if (!r.datos.found || !r.datos.download_url) {
    await enviar(MSG.certificado.noEncontrado)
    return false
  }

  const pdf = await descargarPdf(r.datos.download_url)
  if (!pdf.ok) {
    await falla('descarga del certificado', waId, pdf, enviar)
    return false
  }

  const envio = await enviarPdf(provider, waId, {
    contenido: pdf.contenido,
    nombre: 'Certificado_laboral.pdf',
    pie: MSG.certificado.pie,
  })
  if (!envio.ok) {
    await falla('envío del certificado a Meta', waId, { estado: 0, detalle: envio.detalle }, enviar)
    return false
  }

  console.log(`[certificado] enviado a ${oculto(waId)}`)
  return true
}

/** Días de vacaciones pendientes a la fecha de HOY. Se muestra solo el número (stock). */
async function atenderVacaciones(cedula: string, waId: string, enviar: Enviar) {
  await enviar(MSG.vacaciones.buscando)
  const dias = await consultarSaldo(cedula, waId, enviar)
  if (dias !== null) await enviar(MSG.vacaciones.resultado(formatearDias(dias)))
}

/**
 * Solicitar vacaciones, paso 1: consulta el saldo y muestra la lista de 1..N días.
 * Devuelve true si se envió la lista (el usuario debe responder); false si el proceso terminó.
 */
async function iniciarSolicitud(cedula: string, waId: string, provider: MetaProvider, enviar: Enviar): Promise<boolean> {
  await enviar(MSG.vacaciones.buscando)
  const saldo = await consultarSaldo(cedula, waId, enviar)
  if (saldo === null) return false
  const max = diasSolicitables(saldo)
  if (max === 0) {
    await enviar(MSG.solicitud.sinDias)
    return false
  }
  await enviarDias(provider, waId, max, 1)
  return true
}

/**
 * Solicitar vacaciones, paso 2: eligió N días. Se vuelve a consultar el saldo para que
 * NUNCA se acepte más de lo disponible (la lista pudo quedar vieja).
 * Devuelve true si se volvió a enviar la lista; false si el proceso terminó.
 */
async function elegirDias(dias: number, cedula: string, waId: string, provider: MetaProvider, enviar: Enviar): Promise<boolean> {
  const saldo = await consultarSaldo(cedula, waId, enviar)
  if (saldo === null) return false
  const max = diasSolicitables(saldo)
  if (max === 0) {
    await enviar(MSG.solicitud.sinDias)
    return false
  }
  if (dias > max) {
    await enviar(MSG.solicitud.excedeSaldo(dias, max))
    await enviarDias(provider, waId, max, 1)
    return true
  }
  // Paso 3: fecha de inicio (calendario; respaldo: listas año -> mes -> día).
  console.log(`[solicitud] ${oculto(waId)} eligió ${dias} de ${max} días`)
  await pedirFechaInicio(dias, waId, provider)
  return true
}

/**
 * Pide la fecha de inicio con el CALENDARIO (WhatsApp Flow). Si no hay Flow configurado
 * (META_FLOW_CALENDARIO_ID) o Meta rechaza el envío, usa las listas año -> mes -> día.
 */
async function pedirFechaInicio(dias: number, waId: string, provider: MetaProvider) {
  const { desde, hasta } = ventanaInicio()
  const enviado = await enviarCalendario(provider, waId, {
    dias,
    minFecha: fechaIso(desde),
    maxFecha: fechaIso(hasta),
    // Festivos bloqueados en el calendario (los domingos los bloquea include-days).
    festivos: festivosEntre(desde, hasta),
  })
  if (!enviado) await enviarAniosInicio(provider, waId, dias)
}

/**
 * Respuesta del calendario. Se vuelve a validar la fecha en el bot (no se confía solo
 * en el calendario): dentro de hoy .. hoy + 1 año y que no sea domingo.
 */
export async function atenderCalendario(
  respuesta: { dias: number; fecha: string } | null,
  waId: string,
  provider: MetaProvider,
  enviar: Enviar,
): Promise<void> {
  if (!(await obtenerRegistro(waId))) return
  const inicio = respuesta ? leerFechaIso(respuesta.fecha) : null
  if (!respuesta || !inicio || !inicioPermitido(inicio)) {
    console.log(`[calendario] fecha no válida de ${oculto(waId)}: ${respuesta?.fecha ?? '(ilegible)'}`)
    await enviar(MSG.calendario.fechaNoValida)
    if (respuesta) await pedirFechaInicio(respuesta.dias, waId, provider)
    else await enviarOtraConsulta(provider, waId)
    return
  }
  console.log(`[calendario] ${oculto(waId)} eligió inicio ${respuesta.fecha} para ${respuesta.dias} días`)
  await enviarResumen(provider, waId, respuesta.dias, inicio.getFullYear(), inicio.getMonth() + 1, inicio.getDate())
}

/**
 * Solicitar vacaciones, pasos 3 y 4: año, mes y día de inicio; luego el resumen.
 * Una fecha fuera de la ventana (hoy .. hoy + 1 año), en domingo o de un id viejo
 * vuelve a mostrar la lista de años.
 */
async function atenderInicio(sel: SeleccionInicio, waId: string, provider: MetaProvider) {
  const anios = aniosInicio()
  if (!anios.includes(sel.anio)) return enviarAniosInicio(provider, waId, sel.dias)

  switch (sel.tipo) {
    case 'anio':
      return enviarMesesInicio(provider, waId, sel.dias, sel.anio, 1)
    case 'paginaMeses':
      return enviarMesesInicio(provider, waId, sel.dias, sel.anio, sel.pagina)
    case 'mes':
    case 'paginaDias':
      if (!mesesInicio(sel.anio).includes(sel.mes)) return enviarMesesInicio(provider, waId, sel.dias, sel.anio, 1)
      return enviarDiasInicio(provider, waId, sel.dias, sel.anio, sel.mes, sel.tipo === 'paginaDias' ? sel.pagina : 1)
    case 'dia':
      if (!inicioValido(sel.anio, sel.mes, sel.dia)) return enviarAniosInicio(provider, waId, sel.dias)
      return enviarResumen(provider, waId, sel.dias, sel.anio, sel.mes, sel.dia)
  }
}

/**
 * Botones del resumen: [Confirmar] [Editar fecha] [Cancelar].
 * Confirmar vuelve a validar el saldo y arma el cuerpo para ETL (modelo Buk POST /vacations).
 * Si ETL aún no publica la ruta (ETL_SOLICITUD_VACACIONES_RUTA vacía), NO se envía nada.
 */
export async function atenderResumen(
  respuesta: RespuestaResumen,
  waId: string,
  provider: MetaProvider,
  enviar: Enviar,
): Promise<Siguiente> {
  const registro = await obtenerRegistro(waId)
  if (!registro) return 'nada'
  const sol = obtenerEnCurso(waId)
  if (!sol) {
    await enviar(MSG.solicitud.vencida)
    await enviarOtraConsulta(provider, waId)
    return 'nada'
  }

  if (respuesta === 'editar') {
    // Mismos días; se vuelve a elegir la fecha (calendario o listas).
    borrarEnCurso(waId)
    await pedirFechaInicio(sol.dias, waId, provider)
    return 'nada'
  }

  if (respuesta === 'cancelar') {
    borrarEnCurso(waId)
    console.log(`[solicitud] ${oculto(waId)} canceló`)
    await enviar(MSG.solicitud.cancelada)
    await enviarOtraConsulta(provider, waId)
    return 'nada'
  }

  // Confirmar: el saldo pudo cambiar desde que eligió los días.
  const consulta = await consultarSaldoEId(registro.cedula, waId, enviar)
  if (consulta === null) {
    await enviarOtraConsulta(provider, waId)
    return 'nada'
  }
  const max = diasSolicitables(consulta.saldo)
  if (sol.dias > max) {
    borrarEnCurso(waId)
    if (max === 0) {
      await enviar(MSG.solicitud.sinDias)
      await enviarOtraConsulta(provider, waId)
    } else {
      await enviar(MSG.solicitud.excedeSaldo(sol.dias, max))
      await enviarDias(provider, waId, max, 1)
    }
    return 'nada'
  }

  const cuerpo = armarSolicitudVacaciones(registro.cedula, sol.inicio, sol.fin)
  borrarEnCurso(waId)
  // Log sin la cédula.
  const traza = `${sol.dias} días ${cuerpo.start_date} -> ${cuerpo.end_date} (${cuerpo.type}, ${cuerpo.percent_day}, ${cuerpo.workday_stage})`

  if (!solicitudVacacionesHabilitada()) {
    console.log(`[solicitud] ${oculto(waId)} confirmó ${traza}. NO enviada: falta ETL_SOLICITUD_VACACIONES_RUTA`)
    await enviar(MSG.solicitud.sinEnvio)
    await enviarOtraConsulta(provider, waId)
    return 'nada'
  }

  // La solicitud en curso ya se borró: un segundo toque en "Confirmar" responde "ya no está activa"
  // y no crea una segunda vacación.
  const r = await crearSolicitudVacaciones(cuerpo)
  if (!r.ok) {
    if (r.estado === 400 || r.estado === 422) {
      // Buk (o ETL) rechazó los datos: se muestra el motivo, que viene de Buk.
      const motivo = leerMotivoRechazo(r.detalle)
      console.error(`[solicitud] ${oculto(waId)} rechazada (estado ${r.estado}): ${traza}. Motivo: ${motivo ?? r.detalle}`)
      await enviar(MSG.solicitud.rechazada(motivo))
    } else {
      await falla('solicitud de vacaciones', waId, r, enviar)
    }
    await enviarOtraConsulta(provider, waId)
    return 'nada'
  }

  console.log(`[solicitud] ${oculto(waId)} registrada en Buk: ${traza}`)
  await informarRegistrada(sol, r.datos, waId, enviar)
  await enviarOtraConsulta(provider, waId)
  return 'nada'
}

/**
 * Muestra lo que REGISTRÓ Buk (respuesta de POST /vacations: working_days, calendar_days,
 * start_date, end_date) y lo compara con lo que se le mostró al empleado en el resumen.
 * Si algo no coincide, se le avisa y se deja en el log para revisarlo.
 */
async function informarRegistrada(sol: SolicitudEnCurso, datos: unknown, waId: string, enviar: Enviar) {
  const buk = leerVacacionRegistrada(datos)
  if (!buk) {
    // 2xx sin el formato esperado: quedó creada, se informa con lo calculado por el bot.
    console.error(`[solicitud] ${oculto(waId)}: respuesta 2xx sin "vacation" reconocible: ${JSON.stringify(datos).slice(0, 300)}`)
  }

  const inicio = leerFechaIso(buk?.start_date ?? sol.inicio)
  const fin = leerFechaIso(buk?.end_date ?? sol.fin)
  const habiles = buk?.working_days ?? sol.dias
  const calendario = buk?.calendar_days ?? (inicio && fin ? diasCalendario(inicio, fin) : sol.calendario)
  const formato = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })

  await enviar(
    MSG.solicitud.enviada({
      habiles: formato(habiles),
      calendario: formato(calendario),
      inicio: inicio ? fechaLarga(inicio) : (buk?.start_date ?? sol.inicio),
      fin: fin ? fechaLarga(fin) : (buk?.end_date ?? sol.fin),
      regreso: fin ? fechaLarga(siguienteHabil(fin)) : '—',
    }),
  )

  if (!buk) return
  const diferencias = compararConBuk(sol, buk)
  if (diferencias.length) {
    console.error(`[solicitud] ${oculto(waId)}: Buk registró distinto a lo calculado: ${diferencias.join('; ')}`)
    await enviar(MSG.solicitud.diferencia(diferencias.join('; ')))
  }
  if (buk.id !== null || buk.status) {
    console.log(`[solicitud] ${oculto(waId)}: vacación Buk id ${buk.id ?? '?'} estado ${buk.status ?? '?'}`)
  }
}

/** Diferencias entre lo mostrado en el resumen y lo que registró Buk (texto para el empleado). */
export function compararConBuk(sol: Pick<SolicitudEnCurso, 'dias' | 'calendario' | 'inicio' | 'fin'>, buk: VacacionRegistrada): string[] {
  const d: string[] = []
  const fechaTexto = (iso: string) => {
    const f = leerFechaIso(iso)
    return f ? fechaLarga(f) : iso
  }
  if (buk.working_days !== null && buk.working_days !== sol.dias) d.push(`días hábiles ${buk.working_days} (pediste ${sol.dias})`)
  if (buk.calendar_days !== null && buk.calendar_days !== sol.calendario) d.push(`días calendario ${buk.calendar_days} (calculé ${sol.calendario})`)
  if (buk.start_date !== sol.inicio) d.push(`inicio ${fechaTexto(buk.start_date)} (elegiste ${fechaTexto(sol.inicio)})`)
  if (buk.end_date !== sol.fin) d.push(`fin ${fechaTexto(buk.end_date)} (calculé ${fechaTexto(sol.fin)})`)
  return d
}

/** 2.08 -> "2,08"; 4 -> "4"; 0 -> "0". */
function formatearDias(dias: number): string {
  return dias.toLocaleString('es-CO', { maximumFractionDigits: 2 })
}
