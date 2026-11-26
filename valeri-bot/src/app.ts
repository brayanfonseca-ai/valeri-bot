// Debe ir de primero: añade la CA corporativa antes de crear cualquier cliente HTTP.
import './tls-setup'

import { appendFileSync, mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { createBot, createFlow, createProvider, MemoryDB } from '@builderbot/bot'
import { MetaProvider } from '@builderbot/provider-meta'
import { agenteConfigurado } from './agente'
import { config } from './config'
import { prisma } from './db'
import { bienvenidaFlow } from './flows/bienvenida.flow'
import { confirmacionFlow } from './flows/registro.flow'
import { MSG } from './mensajes'
import { guardarJsonContacts, iniciarBarridoSesiones, registrarEntrante, registrarSaliente } from './sesiones'
import { borrarEnCurso } from './solicitud'

// Un error en un mensaje no debe tumbar el bot completo: se registra y se sigue.
process.on('unhandledRejection', (error) => console.error('[valeri-bot] error no controlado:', error))
process.on('uncaughtException', (error) => console.error('[valeri-bot] excepción no controlada:', error))

async function main() {
  const adapterFlow = createFlow([bienvenidaFlow, confirmacionFlow])

  const adapterProvider = createProvider(MetaProvider, {
    jwtToken: config.meta.jwtToken,
    numberId: config.meta.numberId,
    verifyToken: config.meta.verifyToken,
    version: config.meta.version,
    appSecret: config.meta.appSecret,
  })

  // La base de datos debe responder antes de atender: registro, validación y conversación viven ahí.
  await prisma.$queryRaw`SELECT 1`
  console.log('[valeri-bot] base de datos valeri_bot: conectada')

  // Registro de la conversación en la base (tablas sessions y messages).
  conectarRegistroConversacion(adapterProvider)

  // Estado temporal entre la ventana y la confirmación: en memoria. Lo permanente va a la base.
  const adapterDB = new MemoryDB()

  const { httpServer } = await createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  })

  // Fragmento `contacts` de cada webhook con mensaje → tabla `json` de valeri_bot.
  conectarJsonContacts(adapterProvider)

  // Captura TEMPORAL del JSON crudo que envía Meta (solo con VALERI_CAPTURA_WEBHOOK=true).
  // Se guarda en data/captura_webhook.jsonl (fuera de git) con números enmascarados.
  if (process.env.VALERI_CAPTURA_WEBHOOK?.trim() === 'true') {
    activarCapturaWebhook(adapterProvider)
    console.warn('[valeri-bot] CAPTURA DE WEBHOOK ACTIVA: data/captura_webhook.jsonl')
  }

  // Health check para monitoreo (guía 01 §1).
  adapterProvider.server.get('/health', (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', servicio: 'valeri-bot' }))
  })

  httpServer(config.port)
  // Cierre por inactividad: se descarta lo que quedó a medias y se avisa al empleado.
  iniciarBarridoSesiones(async (waId) => {
    borrarEnCurso(waId)
    await adapterProvider.sendText(waId, MSG.sesionCerrada)
    console.log(`[sesiones] aviso de cierre por inactividad enviado a ******${waId.slice(-4)}`)
  })
  console.log(`[valeri-bot] escuchando en el puerto ${config.port} (webhook: /webhook, health: /health)`)
  console.log(`[valeri-bot] sesiones: cierre por inactividad a los ${config.sesion.timeoutMin} min`)
  console.log(`[valeri-bot] validación de empleados: modo "${config.validacion.modo}"`)
  // Estado del agente de IA ("Hablar con agente").
  if (!agenteConfigurado()) {
    console.log('[valeri-bot] agente de IA: APAGADO (falta AGENTE_ARN o la credencial de AWS): "en construcción"')
  } else if (config.agente.tablaSesiones || config.agente.abiertoSinControl) {
    console.log(`[valeri-bot] agente de IA: ABIERTO a todos${config.agente.tablaSesiones ? ' (con control de identidad)' : ' (SIN control de identidad)'}`)
  } else {
    console.log(`[valeri-bot] agente de IA: CERRADO salvo ${config.agente.numerosPrueba.length} número(s) de prueba (falta AGENTE_TABLA_SESIONES)`)
  }
  if (agenteConfigurado()) console.log(`[valeri-bot] agente de IA: punto de conexión ${config.agente.qualifier ?? 'DEFAULT'}`)
  if (config.validacion.modo === 'bd') {
    const total = await prisma.user.count({ where: { active: true } })
    console.log(`[valeri-bot] empleados autorizados en la tabla users: ${total}`)
    if (total === 0) console.warn('[valeri-bot] la tabla users está vacía: nadie podrá validarse (npm run db:importar-usuarios).')
  } else if (config.validacion.modo === 'abierta') {
    console.warn('[valeri-bot] MODO PRUEBAS: todo el que confirme sus datos queda autorizado (VALERI_VALIDACION=abierta).')
  } else if (!config.validacion.etlUrl) {
    console.warn('[valeri-bot] VALERI_VALIDACION=etl pero falta ETL_VALIDACION_URL: nadie podrá validarse.')
  }
  if (!config.etl.baseUrl || !config.etl.apiKey) {
    console.warn('[valeri-bot] Falta ETL_BASE_URL o ETL_TOKEN: las opciones del menú conectadas a ETL responderán con error.')
  } else {
    console.log(`[valeri-bot] API de ETL: ${config.etl.baseUrl}`)
  }
  if (!config.meta.appSecret) {
    console.warn('[valeri-bot] META_APP_SECRET no está definido: no se valida la firma de los webhooks.')
  }
}

/**
 * Guarda en la base todo lo que entra y sale, sin tocar los flujos:
 *  - Entrantes: el provider emite 'message' por cada mensaje recibido.
 *  - Salientes: TODOS los envíos del provider (texto, listas, botones, ventanas,
 *    documentos) pasan por provider.sendMessageMeta(body); se envuelve ese método.
 * Si la base falla, se registra en el log y el mensaje se envía igual.
 */
function conectarRegistroConversacion(provider: MetaProvider) {
  const p = provider as unknown as {
    on: (evento: string, fn: (ctx: Record<string, unknown>) => void) => void
    sendMessageMeta: (body: Record<string, unknown>) => Promise<unknown>
  }

  p.on('message', (ctx) => {
    void registrarEntrante(ctx)
  })

  const original = p.sendMessageMeta.bind(provider)
  p.sendMessageMeta = async (body: Record<string, unknown>) => envolverSaliente(original, body)
}

/**
 * Fragmento `contacts` del webhook crudo de Meta → tabla `json`, cada vez que alguien escribe.
 * Se registra DESPUÉS de createBot (el provider ya parsea el body). Solo lee req.body y
 * SIEMPRE llama a next(): no altera el flujo.
 */
function conectarJsonContacts(provider: MetaProvider) {
  const server = provider.server as unknown as {
    use: (fn: (req: IncomingMessage & { body?: any }, res: ServerResponse, next: () => void) => void) => void
  }
  server.use((req, _res, next) => {
    try {
      if (req.method === 'POST' && (req.url ?? '').startsWith('/webhook') && req.body && typeof req.body === 'object') {
        for (const entrada of req.body.entry ?? []) {
          for (const cambio of entrada?.changes ?? []) {
            const valor = cambio?.value
            // Solo mensajes de alguien (no notificaciones de entregado/leído).
            if (Array.isArray(valor?.messages) && valor.messages.length && Array.isArray(valor?.contacts)) {
              void guardarJsonContacts(valor.contacts)
            }
          }
        }
      }
    } catch (error) {
      console.error('[json] error leyendo el webhook:', error instanceof Error ? error.message : error)
    }
    next()
  })
}

/** Envía por Meta y registra el saliente en la base (tabla messages). */
async function envolverSaliente(
  original: (body: Record<string, unknown>) => Promise<unknown>,
  body: Record<string, unknown>,
): Promise<unknown> {
  {
    const respuesta = (await original(body)) as { messages?: { id?: string }[]; error?: unknown } | undefined
    try {
      const waId = String(body.to ?? body.recipient ?? '')
      const tipo = String(body.type ?? 'text')
      let contenido: string | null = null
      let subtipo = tipo
      const b = body as Record<string, any>
      if (tipo === 'text') contenido = b.text?.body ?? null
      else if (tipo === 'interactive') {
        subtipo = b.interactive?.type === 'button' ? 'buttons' : b.interactive?.type ?? 'interactive'
        contenido = b.interactive?.body?.text ?? null
      } else if (tipo === 'document') contenido = b.document?.caption || b.document?.filename || null
      else if (tipo === 'image') contenido = b.image?.caption ?? null
      const error = respuesta?.error ?? (respuesta as any)?.response?.data?.error
      void registrarSaliente(waId, {
        tipo: subtipo,
        contenido,
        payload: error ? { cuerpo: resumirCuerpo(b), error } : { cuerpo: resumirCuerpo(b) },
        externalId: respuesta?.messages?.[0]?.id ?? null,
      })
    } catch (error) {
      console.error('[valeri-bot] no se pudo registrar el saliente:', error instanceof Error ? error.message : error)
    }
    return respuesta
  }
}

/** Datos útiles del mensaje enviado (opciones de listas y botones), sin repetir el texto. */
function resumirCuerpo(b: Record<string, any>): Record<string, unknown> {
  const i = b.interactive
  if (!i) return { type: b.type }
  if (i.type === 'list') {
    return { type: 'list', filas: (i.action?.sections ?? []).flatMap((s: any) => (s.rows ?? []).map((r: any) => ({ id: r.id, titulo: r.title }))) }
  }
  if (i.type === 'button') return { type: 'buttons', botones: (i.action?.buttons ?? []).map((x: any) => x.reply?.title) }
  if (i.type === 'flow') return { type: 'flow', flowId: i.action?.parameters?.flow_id, cta: i.action?.parameters?.flow_cta }
  return { type: i.type }
}

/** Enmascara números largos (cédulas, teléfonos, wa_id): deja solo los últimos 4 dígitos. */
function enmascarar(valor: unknown): unknown {
  if (typeof valor === 'string') {
    // response_json de un Flow viene como texto JSON: se enmascara por dentro y se deja como texto.
    if (valor.trim().startsWith('{')) {
      try {
        return JSON.stringify(enmascarar(JSON.parse(valor)))
      } catch {
        /* no era JSON */
      }
    }
    return valor.replace(/\d{7,}/g, (n) => '*'.repeat(n.length - 4) + n.slice(-4))
  }
  if (Array.isArray(valor)) return valor.map(enmascarar)
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, enmascarar(v)]))
  }
  return valor
}

function activarCapturaWebhook(provider: MetaProvider) {
  const archivo = resolve(process.cwd(), 'data', 'captura_webhook.jsonl')
  mkdirSync(dirname(archivo), { recursive: true })
  const server = provider.server as unknown as {
    use: (fn: (req: IncomingMessage & { body?: unknown }, res: ServerResponse, next: () => void) => void) => void
  }
  server.use((req, _res, next) => {
    try {
      if (req.method === 'POST' && (req.url ?? '').startsWith('/webhook')) {
        const linea = { recibido: new Date().toISOString(), body: req.body === undefined ? '(sin body parseado)' : enmascarar(req.body) }
        appendFileSync(archivo, JSON.stringify(linea) + '\n')
      }
    } catch (error) {
      console.error('[captura] no se pudo guardar:', error instanceof Error ? error.message : error)
    }
    next()
  })
}

main().catch((error) => {
  console.error('[valeri-bot] no pudo arrancar:', error instanceof Error ? error.message : error)
  process.exit(1)
})
