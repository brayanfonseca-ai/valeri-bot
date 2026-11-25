/**
 * Importa la base temporal de empleados autorizados (CSV) a la tabla `users`.
 *
 *   npm run db:importar-usuarios                       -> data/base_auten_tempo.csv
 *   npm run db:importar-usuarios -- otra/ruta.csv
 *
 * Formato: una fila por empleado "documento,telefono" (con o sin encabezado).
 * Idempotente: inserta los nuevos y actualiza el teléfono de los existentes
 * (clave: documento). No borra ni desactiva a nadie. No imprime datos personales.
 *
 * Normalización (la misma que aplica el bot a lo que escribe el empleado):
 *  - documento: solo dígitos, sin ceros a la izquierda;
 *  - teléfono: solo dígitos, sin indicativo 57 / 0057 (10 dígitos).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

const ruta = resolve(process.argv[2] ?? 'data/base_auten_tempo.csv')
const prisma = new PrismaClient()

const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '')
const normalizarDocumento = (t) => soloDigitos(t).replace(/^0+/, '')
function normalizarTelefono(t) {
  let d = soloDigitos(t)
  if (d.startsWith('0057')) d = d.slice(4)
  else if (d.length === 12 && d.startsWith('57')) d = d.slice(2)
  return d
}

async function main() {
  const texto = readFileSync(ruta, 'utf8').replace(/^\uFEFF/, '')
  const filas = texto.split(/\r?\n/).filter((l) => l.trim())

  const porDocumento = new Map()
  const rechazadas = { sinDocumento: 0, documentoLargo: 0, sinTelefono: 0 }
  let advertencias = { telefonoNoCelular: 0, documentoFueraDeVentana: 0 }

  for (const fila of filas) {
    const [a, b] = fila.split(/[;,]/)
    const documento = normalizarDocumento(a)
    const telefono = normalizarTelefono(b)
    if (!documento) {
      rechazadas.sinDocumento++ // encabezado u otra fila sin números
      continue
    }
    if (documento.length > 15) {
      rechazadas.documentoLargo++
      continue
    }
    if (!telefono) {
      rechazadas.sinTelefono++
      continue
    }
    // Mismas reglas que la ventana de registro (valeri_registro_v3) y validadores.ts.
    if (!/^\d{10}$/.test(telefono)) advertencias.telefonoNoCelular++
    if (documento.length < 5 || documento.length > 15) advertencias.documentoFueraDeVentana++
    porDocumento.set(documento, telefono) // si el documento se repite, gana la última fila
  }

  const existentes = new Map(
    (await prisma.user.findMany({ select: { document: true, phone: true } })).map((u) => [u.document, u.phone]),
  )
  const nuevos = []
  const cambios = []
  for (const [document, phone] of porDocumento) {
    if (!existentes.has(document)) nuevos.push({ document, phone, source: 'CSV_TEMPORAL' })
    else if (existentes.get(document) !== phone) cambios.push({ document, phone })
  }

  if (nuevos.length) await prisma.user.createMany({ data: nuevos, skipDuplicates: true })
  for (let i = 0; i < cambios.length; i += 200) {
    await prisma.$transaction(
      cambios.slice(i, i + 200).map((c) => prisma.user.update({ where: { document: c.document }, data: { phone: c.phone } })),
    )
  }

  const total = await prisma.user.count()
  console.log('[importar-usuarios] archivo:', ruta.replace(/.*[\\/]/, ''))
  console.log('[importar-usuarios] filas leídas:', filas.length, '| válidas (únicas):', porDocumento.size)
  console.log('[importar-usuarios] nuevos:', nuevos.length, '| teléfono actualizado:', cambios.length)
  console.log('[importar-usuarios] filas descartadas:', JSON.stringify(rechazadas))
  console.log(
    '[importar-usuarios] advertencias (se importan, pero hoy no pueden validarse por la ventana de registro):',
    JSON.stringify(advertencias),
  )
  console.log('[importar-usuarios] total en la tabla users:', total)
}

main()
  .catch((error) => {
    console.error('[importar-usuarios] error:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
