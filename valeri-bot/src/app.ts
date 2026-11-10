// Debe ir de primero: añade la CA corporativa antes de crear cualquier cliente HTTP.
import './tls-setup'

import type { IncomingMessage, ServerResponse } from 'node:http'
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
  if (!config.meta.appSecret) {
    console.warn('[valeri-bot] META_APP_SECRET no está definido: no se valida la firma de los webhooks.')
  }
}

main().catch((error) => {
  console.error('[valeri-bot] no pudo arrancar:', error instanceof Error ? error.message : error)
  process.exit(1)
})
