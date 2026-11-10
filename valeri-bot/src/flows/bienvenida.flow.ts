import { addKeyword, EVENTS, MemoryDB } from '@builderbot/bot'
import type { MetaProvider } from '@builderbot/provider-meta'
import { enviarFormulario, leerFormulario } from '../formulario'
import { MSG } from '../mensajes'
import { enviarMenu, esOpcionMenu, OPCIONES_MENU } from '../menu'
import { obtenerRegistro } from '../registros'
import { formatearCedula, formatearTelefono } from '../validadores'
import { confirmacionFlow } from './registro.flow'

/**
 * Punto de entrada: todo mensaje que no responde a una pregunta en curso.
 *
 * Usuario YA autorizado (está en data/registros.json):
 *  - si eligió una opción del menú -> se atiende la opción (por ahora: "en construcción" + menú);
 *  - cualquier otro mensaje -> menú principal (sin saludo).
 *
 * Usuario NO autorizado:
 *  - si el mensaje es la respuesta de la ventana -> se validan los datos y se pasa a la confirmación;
 *  - en cualquier otro caso -> mensaje con saludo y botón que abre la ventana.
 */
export const bienvenidaFlow = addKeyword<MetaProvider, MemoryDB>(EVENTS.WELCOME).addAction(
  async (ctx, { provider, state, flowDynamic, gotoFlow }) => {
    console.log(`[bienvenida] mensaje entrante de ******${(ctx.from ?? '').slice(-4)}`)

    // ── Usuario autorizado: menú ───────────────────────────────────────────
    if (obtenerRegistro(ctx.from)) {
      const idOpcion = (ctx as unknown as { id_list_reply?: string }).id_list_reply
      if (esOpcionMenu(idOpcion)) {
        const opcion = OPCIONES_MENU.find((o) => o.id === idOpcion)!
        console.log(`[menu] opción "${opcion.id}" elegida por ******${(ctx.from ?? '').slice(-4)}`)
        // TODO: conectar cada opción con su endpoint de ETL.
        await flowDynamic(MSG.opcionEnConstruccion(opcion.title))
      }
      await enviarMenu(provider, ctx.from)
      return
    }

    // ── Usuario sin registrar: ventana de datos ────────────────────────────
    const datos = leerFormulario(ctx)

    if (datos === null) {
      await flowDynamic(MSG.datosNoValidos)
      await enviarFormulario(provider, ctx.from)
      return
    }

    if (datos) {
      await state.update({ cedula: datos.cedula, telefono: datos.telefono })
      await flowDynamic(MSG.resumenDatos(formatearCedula(datos.cedula), formatearTelefono(datos.telefono)))
      return gotoFlow(confirmacionFlow)
    }

    // El saludo va dentro del mensaje de la ventana (un solo mensaje).
    await enviarFormulario(provider, ctx.from)
  },
)
