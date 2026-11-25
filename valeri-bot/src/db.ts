/**
 * Cliente Prisma (singleton) de la base `valeri_bot`.
 * La conexión sale de DATABASE_URL (archivo .env, cargado con `node --env-file=.env`).
 */
import { PrismaClient } from '@prisma/client'

const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma: PrismaClient =
  globalParaPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalParaPrisma.prisma = prisma

/** Enmascara un número largo (wa_id, cédula, teléfono) para los logs: deja los últimos 4. */
export const oculto = (valor: string | undefined | null): string => `******${(valor ?? '').slice(-4)}`
