/**
 * Registro de empleados autorizados por número de WhatsApp (tabla `contacts`
 * enlazada con `users` en la base valeri_bot). Reemplaza al antiguo
 * data/registros.json con la misma interfaz, ahora asíncrona.
 *
 * "Autorizado" = el contacto tiene `verified_at` y un `user_id` vinculado.
 * Regla "un empleado, un número": `contacts.user_id` es único.
 */
import type { UserSource } from '@prisma/client'
import { oculto, prisma } from './db'

export interface Registro {
  cedula: string
  telefono: string
  confirmadoEn: string
  /** id del empleado en Buk, si lo devuelve la validación de ETL. */
  idBuk?: number
}

/** Registro del número, o undefined si aún no está autorizado (o si la BD falla). */
export async function obtenerRegistro(waId: string): Promise<Registro | undefined> {
  try {
    const c = await prisma.contact.findUnique({ where: { waId }, include: { user: true } })
    if (!c?.verifiedAt || !c.user || !c.user.active) return undefined
    return {
      cedula: c.user.document,
      telefono: c.phoneDeclared ?? c.user.phone,
      confirmadoEn: c.verifiedAt.toISOString(),
      idBuk: c.idBuk ?? undefined,
    }
  } catch (error) {
    console.error(`[registros] no se pudo leer el registro de ${oculto(waId)}:`, error instanceof Error ? error.message : error)
    return undefined
  }
}

/** wa_id que ya tiene vinculada esa cédula (validado), si existe. */
export async function buscarNumeroPorCedula(cedula: string): Promise<string | undefined> {
  const c = await prisma.contact.findFirst({
    where: { verifiedAt: { not: null }, user: { document: cedula } },
    select: { waId: true },
  })
  return c?.waId
}

/**
 * Vincula el número con el empleado y lo marca como autorizado.
 * Si el empleado no existe en `users` (modos "etl"/"abierta"), se crea con el origen indicado.
 */
export async function guardarRegistro(
  waId: string,
  registro: Registro,
  origen: UserSource = 'CSV_TEMPORAL',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { document: registro.cedula },
      create: { document: registro.cedula, phone: registro.telefono, source: origen },
      update: {},
    })
    await tx.contact.upsert({
      where: { waId },
      create: {
        waId,
        userId: user.id,
        phoneDeclared: registro.telefono,
        idBuk: registro.idBuk,
        verifiedAt: new Date(registro.confirmadoEn),
      },
      update: {
        userId: user.id,
        phoneDeclared: registro.telefono,
        idBuk: registro.idBuk,
        verifiedAt: new Date(registro.confirmadoEn),
      },
    })
  })
}
