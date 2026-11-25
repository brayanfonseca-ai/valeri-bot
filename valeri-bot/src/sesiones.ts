/**
 * Control de sesiones y registro de la conversación en la base valeri_bot.
 *
 *  - Cada mensaje (entrante o saliente) se guarda en `messages` dentro de la
 *    sesión ABIERTA del número. Si no hay una abierta, o la última actividad es
 *    más vieja que VALERI_SESION_TIMEOUT_MIN, se cierra la anterior (TIMEOUT) y
 *    se abre una nueva.
 *  - "No, finalizar" cierra la sesión (USER_FINISHED).
 *  - Un barrido periódico cierra las sesiones inactivas (TIMEOUT). No se le
 *    envía nada al empleado: solo se marca en la base.
 *
 * Todo es "mejor esfuerzo": un fallo de la base se registra en el log y NUNCA
 * interrumpe la conversación. Las escrituras de un mismo número se encadenan
 * (una tras otra) para no abrir dos sesiones a la vez.
 */
import type { AuthResult, CloseReason, MessageDirection, Prisma } from '@prisma/client'
import { cerrarSesionAgente } from './agente'
import { config } from './config'
import { oculto, prisma } from './db'

const TIMEOUT_MS = () => config.sesion.timeoutMin * 60 * 1000

// ── Serialización por número ────────────────────────────────────────────────
const colas = new Map<string, Promise<unknown>>()

function enCola<T>(waId: string, tarea: () => Promise<T>): Promise<T | undefined> {
  const anterior = colas.get(waId) ?? Promise.resolve()
  const actual = anterior
    .catch(() => undefined)
    .then(tarea)
    .catch((error) => {
      console.error(`[sesiones] error de base de datos (${oculto(waId)}):`, error instanceof Error ? error.message : error)
      return undefined
    })
  colas.set(waId, actual)
  void actual.finally(() => {
    if (colas.get(waId) === actual) colas.delete(waId)
  })
  return actual
}

// ── Cierres por inactividad pendientes de "consumir" ────────────────────────
// Cuando el barrido cierra una sesión por inactividad, el número queda marcado:
// el SIGUIENTE mensaje de ese número empieza de cero (se descarta lo que había
// quedado a medias: datos del registro sin confirmar, preguntas pendientes).
const cerradasPorInactividad = new Set<string>()

/** true (una sola vez) si la última sesión del número se cerró por inactividad. */
export function consumirCierrePorInactividad(waId: string): boolean {
  return cerradasPorInactividad.delete(waId)
}

// ── Sesión de un mensaje SALIENTE ───────────────────────────────────────────
// Lo que envía Valeri nunca abre una sesión nueva: va a la sesión activa o, si ya
// se cerró (por ejemplo, el aviso de cierre por inactividad), a la última sesión.
async function sesionParaSaliente(waId: string): Promise<string> {
  const ultima = await prisma.session.findFirst({ where: { waId }, orderBy: { startedAt: 'desc' } })
  if (ultima) return ultima.id
  return sesionAbierta(waId)
}

// ── Sesión abierta del número ───────────────────────────────────────────────
async function sesionAbierta(waId: string, nombrePerfil?: string): Promise<string> {
  const ahora = new Date()
  await prisma.contact.upsert({
    where: { waId },
    create: { waId, profileName: nombrePerfil, lastSeenAt: ahora },
    update: { lastSeenAt: ahora, ...(nombrePerfil ? { profileName: nombrePerfil } : {}) },
  })

  const abierta = await prisma.session.findFirst({
    where: { waId, status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
  })
  if (abierta && ahora.getTime() - abierta.lastActivityAt.getTime() <= TIMEOUT_MS()) return abierta.id

  if (abierta) await cerrar(abierta.id, waId, 'TIMEOUT')
  const nueva = await prisma.session.create({ data: { waId } })
  await evento('SESSION_OPENED', { waId, sessionId: nueva.id })
  return nueva.id
}

async function cerrar(sessionId: string, waId: string, motivo: CloseReason): Promise<void> {
  const s = await prisma.session.update({
    where: { id: sessionId },
    data: { status: 'CLOSED', closedAt: new Date(), closeReason: motivo, agentMode: false },
  })
  await evento('SESSION_CLOSED', { waId, sessionId, detail: { motivo } })
  // Si estaba con el agente de IA: se cierra también la sesión del control de identidad en AWS.
  if (s.agentSessionId) {
    try {
      await cerrarSesionAgente(s.agentSessionId)
    } catch (error) {
      console.error(`[agente] no se pudo cerrar la sesión en DynamoDB (${oculto(waId)}):`, error instanceof Error ? error.message : error)
    }
  }
}

// ── Modo agente (estado en la sesión: sobrevive a reinicios del bot) ───────

export interface EstadoAgente {
  sessionId: string
  agentMode: boolean
  agentSessionId: string | null
}

/**
 * Sesión activa (no vencida) del número y su modo agente. Se lee DENTRO de la cola del
 * número para que el mensaje entrante ya esté registrado (y la sesión abierta).
 */
export function estadoAgente(waId: string): Promise<EstadoAgente | undefined> {
  return enCola(waId, async () => {
    const s = await prisma.session.findFirst({ where: { waId, status: 'ACTIVE' }, orderBy: { startedAt: 'desc' } })
    if (!s || Date.now() - s.lastActivityAt.getTime() > TIMEOUT_MS()) return undefined
    return { sessionId: s.id, agentMode: s.agentMode, agentSessionId: s.agentSessionId }
  })
}

/** Activa o desactiva el modo agente en la sesión activa del número. */
export function marcarModoAgente(waId: string, activo: boolean, agentSessionId?: string): Promise<string | undefined> {
  return enCola(waId, async () => {
    const sessionId = await sesionAbierta(waId)
    await prisma.session.update({
      where: { id: sessionId },
      data: activo ? { agentMode: true, agentSessionId: agentSessionId ?? null } : { agentMode: false },
    })
    return sessionId
  })
}

/** Evento de auditoría (sin cédula ni teléfono en `detail`). Mejor esfuerzo. */
export function auditar(tipo: string, waId: string, detail?: Record<string, unknown>, sessionId?: string): Promise<void | undefined> {
  return enCola(waId, () => evento(tipo, { waId, sessionId, detail }))
}

async function guardarMensaje(
  waId: string,
  direccion: MessageDirection,
  m: { tipo: string; contenido?: string | null; payload?: unknown; externalId?: string | null },
  nombrePerfil?: string,
): Promise<void> {
  const sessionId = direccion === 'INBOUND' ? await sesionAbierta(waId, nombrePerfil) : await sesionParaSaliente(waId)
  const ahora = new Date()
  // Solo la actividad del EMPLEADO (entrantes) y las respuestas dentro de una sesión
  // activa mantienen viva la sesión; un saliente sobre una sesión cerrada no la reabre.
  await prisma.$transaction([
    prisma.message.create({
      data: {
        sessionId,
        waId,
        direction: direccion,
        type: m.tipo,
        content: m.contenido ?? null,
        payload: m.payload === undefined ? undefined : (m.payload as Prisma.InputJsonValue),
        externalMessageId: m.externalId ?? null,
      },
    }),
    prisma.session.update({
      where: { id: sessionId },
      data: { lastActivityAt: ahora, messageCount: { increment: 1 } },
    }),
  ])
}

// ── API pública ─────────────────────────────────────────────────────────────

/** Mensaje entrante (lo que escribe o toca el empleado). */
export function registrarEntrante(ctx: Record<string, unknown>): Promise<void | undefined> {
  const waId = String(ctx.from ?? '')
  if (!waId) return Promise.resolve(undefined)
  const nfm = ctx.nfm_reply
  const lista = ctx.id_list_reply
  const boton = ctx.title_button_reply
  const tipo = nfm ? 'flow' : lista ? 'list' : boton ? 'button' : String(ctx.type ?? 'text')
  const payload: Record<string, unknown> = {}
  if (nfm) payload.respuestaVentana = nfm
  if (lista) payload.idFila = lista
  if (boton) payload.boton = boton
  const nombre = typeof ctx.name === 'string' ? ctx.name : typeof ctx.pushName === 'string' ? ctx.pushName : undefined
  return enCola(waId, () =>
    guardarMensaje(
      waId,
      'INBOUND',
      {
        tipo,
        contenido: typeof boton === 'string' ? boton : typeof ctx.body === 'string' ? ctx.body : null,
        payload: Object.keys(payload).length ? payload : undefined,
        externalId: typeof ctx.message_id === 'string' ? ctx.message_id : typeof ctx.id === 'string' ? ctx.id : null,
      },
      nombre,
    ),
  )
}

/** Mensaje saliente (lo que Valeri le envía al empleado). */
export function registrarSaliente(
  waId: string,
  m: { tipo: string; contenido?: string | null; payload?: unknown; externalId?: string | null },
): Promise<void | undefined> {
  if (!waId) return Promise.resolve(undefined)
  return enCola(waId, () => guardarMensaje(waId, 'OUTBOUND', m))
}

/** "No, finalizar": cierra la sesión abierta del número. */
export function finalizarSesion(waId: string): Promise<void | undefined> {
  return enCola(waId, async () => {
    const abierta = await prisma.session.findFirst({ where: { waId, status: 'ACTIVE' }, orderBy: { startedAt: 'desc' } })
    if (abierta) await cerrar(abierta.id, waId, 'USER_FINISHED')
  })
}

/** Intento de validación de identidad (para soporte y auditoría). */
export function registrarIntento(
  waId: string,
  datos: { documento: string; telefono: string; resultado: AuthResult; detalle?: string },
): Promise<void | undefined> {
  return enCola(waId, async () => {
    await prisma.contact.upsert({ where: { waId }, create: { waId }, update: {} })
    await prisma.authAttempt.create({
      data: { waId, document: datos.documento, phone: datos.telefono, result: datos.resultado, detail: datos.detalle },
    })
    await evento('AUTH_ATTEMPT', { waId, detail: { resultado: datos.resultado } })
  })
}

/**
 * Guarda en la tabla `json` (una sola columna, `contacts`) el fragmento `contacts`
 * del webhook de Meta, tal cual llega: {"contacts":[{profile, wa_id, user_id, country_code}]}.
 * Mejor esfuerzo: un fallo se registra en el log y no afecta la conversación.
 */
export async function guardarJsonContacts(contacts: unknown[]): Promise<void> {
  try {
    const fragmento = JSON.stringify({ contacts })
    await prisma.$executeRaw`INSERT INTO "json" ("contacts") VALUES (${fragmento}::jsonb)`
  } catch (error) {
    console.error('[json] no se pudo guardar el fragmento contacts:', error instanceof Error ? error.message : error)
  }
}

/** Evento de auditoría. */
async function evento(tipo: string, d: { waId?: string; sessionId?: string; detail?: unknown }): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      eventType: tipo,
      waId: d.waId,
      sessionId: d.sessionId,
      detail: d.detail === undefined ? undefined : (d.detail as Prisma.InputJsonValue),
    },
  })
}

/**
 * Barrido periódico (cada 60 s): cierra por inactividad las sesiones abiertas
 * vencidas y, por cada una, llama a `alCerrar(waId)` (en app.ts: limpia lo que
 * quedó a medias y le avisa al empleado que su sesión se cerró).
 */
export function iniciarBarridoSesiones(alCerrar?: (waId: string) => Promise<void>): () => void {
  let corriendo = false
  const ciclo = async () => {
    if (corriendo) return
    corriendo = true
    try {
      const corte = new Date(Date.now() - TIMEOUT_MS())
      const vencidas = await prisma.session.findMany({
        where: { status: 'ACTIVE', lastActivityAt: { lt: corte } },
        select: { id: true, waId: true },
        take: 200,
      })
      let cerradas = 0
      for (const s of vencidas) {
        const cerro = await enCola(s.waId, async () => {
          // Se vuelve a comprobar dentro de la cola: pudo llegar un mensaje mientras tanto.
          const actual = await prisma.session.findUnique({ where: { id: s.id } })
          if (actual?.status !== 'ACTIVE' || actual.lastActivityAt >= corte) return false
          await cerrar(s.id, s.waId, 'TIMEOUT')
          return true
        })
        if (!cerro) continue
        cerradas++
        cerradasPorInactividad.add(s.waId)
        // Fuera de la cola del número: el aviso se registra como saliente en esa misma cola.
        if (alCerrar) {
          try {
            await alCerrar(s.waId)
          } catch (error) {
            console.error(`[sesiones] no se pudo avisar el cierre a ${oculto(s.waId)}:`, error instanceof Error ? error.message : error)
          }
        }
      }
      if (cerradas) console.log(`[sesiones] cerradas por inactividad: ${cerradas}`)
    } catch (error) {
      console.error('[sesiones] error en el barrido:', error instanceof Error ? error.message : error)
    } finally {
      corriendo = false
    }
  }
  const timer = setInterval(ciclo, 60_000)
  void ciclo()
  return () => clearInterval(timer)
}
