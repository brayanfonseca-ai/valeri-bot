// Debe ir de primero: añade la CA corporativa antes de crear cualquier cliente HTTP.
import './tls-setup'

import { appendFileSync, mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { createBot, createFlow, createProvider, MemoryDB } from '@builderbot/bot'
import { MetaProvider } from '@builderbot/provider-meta'
import { config } from './config'
import { bienvenidaFlow } from './flows/bienvenida.flow'
import { confirmacionFlow } from './flows/registro.flow'

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

  // Estado de la conversación en curso: en memoria. Los datos confirmados van a data/registros.json.
  const adapterDB = new MemoryDB()

  const { httpServer } = await createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  })

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
  console.log(`[valeri-bot] escuchando en el puerto ${config.port} (webhook: /webhook, health: /health)`)
  console.log(`[valeri-bot] validación de empleados: modo "${config.validacion.modo}"`)
  if (config.validacion.modo === 'abierta') {
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
