/**
 * TLS saliente detrás de la inspección SSL corporativa (ver guía 00 §6).
 * Si TLS_EXTRA_CA apunta a un .pem que existe, se AÑADE esa CA a la cadena de
 * confianza de `https` (axios, que usa el provider de Meta).
 * Para `fetch` además hay que poner NODE_EXTRA_CA_CERTS en el .env.
 * Nunca se desactiva la verificación TLS.
 *
 * Este archivo debe importarse de primero en app.ts.
 */
import fs from 'node:fs'
import https from 'node:https'
import tls from 'node:tls'

const rutaCa = process.env.TLS_EXTRA_CA?.trim()

if (rutaCa) {
  if (fs.existsSync(rutaCa)) {
    const caExtra = fs.readFileSync(rutaCa, 'utf8')
    https.globalAgent.options.ca = [...tls.rootCertificates, caExtra]
    console.log(`[tls] CA corporativa añadida desde ${rutaCa}`)
  } else {
    console.warn(`[tls] TLS_EXTRA_CA apunta a ${rutaCa}, pero el archivo no existe. Se continúa sin CA extra.`)
  }
}
