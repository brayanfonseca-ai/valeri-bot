/**
 * Normalización permisiva de los datos que el usuario escribe a mano.
 * El objetivo es aceptar las formas comunes de escribir una cédula o un
 * celular en Colombia y convertirlas a un formato único antes de validar.
 */

export type Resultado = { ok: true; valor: string } | { ok: false }

/** Deja solo los dígitos de un texto. */
const soloDigitos = (texto: string): string => (texto ?? '').replace(/\D/g, '')

/**
 * Cédula de ciudadanía.
 * Acepta: "1023456789", "1.023.456.789", "1 023 456 789", "CC 1023456789", "C.C. 12.345.678".
 * Devuelve solo dígitos. Rango aceptado: 5 a 10 dígitos.
 */
export function normalizarCedula(texto: string): Resultado {
  const digitos = soloDigitos(texto)
  if (digitos.length < 5 || digitos.length > 10) return { ok: false }
  if (/^0+$/.test(digitos)) return { ok: false }
  return { ok: true, valor: digitos.replace(/^0+/, '') }
}

/**
 * Celular colombiano.
 * Acepta: "3001234567", "300 123 4567", "300-123-4567", "(300) 1234567",
 * "+57 300 123 4567", "57 3001234567", "0057 3001234567".
 * Devuelve 10 dígitos que empiezan por 3 (sin indicativo).
 */
export function normalizarTelefono(texto: string): Resultado {
  let digitos = soloDigitos(texto)
  if (digitos.startsWith('0057')) digitos = digitos.slice(4)
  else if (digitos.length === 12 && digitos.startsWith('57')) digitos = digitos.slice(2)
  if (!/^3\d{9}$/.test(digitos)) return { ok: false }
  return { ok: true, valor: digitos }
}

/** "1023456789" -> "1.023.456.789" (solo para mostrar). */
export function formatearCedula(cedula: string): string {
  return cedula.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** "3001234567" -> "300 123 4567" (solo para mostrar). */
export function formatearTelefono(telefono: string): string {
  return telefono.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3')
}

/** Compara la respuesta del usuario con el título de un botón, sin tildes ni mayúsculas. */
export function esBoton(respuesta: string, tituloBoton: string): boolean {
  const limpiar = (s: string) =>
    (s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
  return limpiar(respuesta) === limpiar(tituloBoton)
}
