import { addKeyword, EVENTS, MemoryDB } from '@builderbot/bot'
import type { MetaProvider } from '@builderbot/provider-meta'
import { enviarFormulario, leerCalendario, leerFormulario } from '../formulario'
import { MSG } from '../mensajes'
import { enviarMenu } from '../menu'
import { atenderCalendario, atenderOtraConsulta, atenderResumen, atenderSeleccion, esSeleccionConocida, leerOtraConsulta } from '../opciones'
import { leerBotonResumen } from '../solicitud'
import { obtenerRegistro } from '../registros'
import { consumirCierrePorInactividad, estadoAgente, finalizarSesion } from '../sesiones'
import { agenteDisponiblePara } from '../agente'
import { atenderConAgente, salirModoAgente } from '../modo-agente'
import { esBoton, formatearCedula, formatearTelefono } from '../validadores'
import { confirmacionFlow } from './registro.flow'

/**
 * Punto de entrada: todo mensaje que no responde a una pregunta en curso.
 *
 * Usuario YA autorizado (está en data/registros.json):
 *  - si eligió algo de una lista (menú, año, mes) -> opciones.ts lo atiende; luego menú,
 *    salvo que se haya enviado otra lista (años o meses) que el usuario debe responder;
 *  - si eligió una fecha en el calendario de vacaciones -> se valida y se muestra el resumen;
 *  - si tocó un botón del resumen de vacaciones -> Confirmar / Editar fecha / Cancelar (opciones.ts);
 *  - si tocó un botón de "¿otra consulta?" -> Sí: menú; No, finalizar: despedida y fin
 *    de la sesión (sin menú); Hablar con agente: opción 5 del menú;
 *  - cualquier otro mensaje -> menú principal (sin saludo).
 *
 * Usuario NO autorizado:
 *  - si el mensaje es la respuesta de la ventana -> se validan los datos y se pasa a la confirmación;
 *  - en cualquier otro caso -> mensaje con saludo y botón que abre la ventana.
 */
export const bienvenidaFlow = addKeyword<MetaProvider, MemoryDB>(EVENTS.WELCOME).addAction(
  async (ctx, { provider, state, flowDynamic, gotoFlow }) => {
    console.log(`[bienvenida] mensaje entrante de ******${(ctx.from ?? '').slice(-4)}`)

    // La sesión anterior se cerró por inactividad: se empieza de cero. El registro
    // (contacts/users) es permanente, así que un empleado ya validado va directo al menú.
    if (consumirCierrePorInactividad(ctx.from)) await state.clear()

    // ── Usuario autorizado: menú ───────────────────────────────────────────
    if (await obtenerRegistro(ctx.from)) {
      // ── Modo agente de IA ("Hablar con agente") ──────────────────────────
      const estado = await estadoAgente(ctx.from)
      if (estado?.agentMode) {
        const c = ctx as unknown as { id_list_reply?: string; title_button_reply?: string; nfm_reply?: unknown; body?: string }
        const interactivo = Boolean(c.id_list_reply || c.title_button_reply || c.nfm_reply)
        const texto = String(c.body ?? '').trim()
        const pideMenu = !interactivo && ['menú', 'menu', 'salir', 'volver'].some((p) => esBoton(texto, p))
        if (pideMenu || !agenteDisponiblePara(ctx.from)) {
          await salirModoAgente(ctx.from, pideMenu ? 'usuario' : 'agente_no_disponible')
          if (pideMenu) await flowDynamic(MSG.agente.salida)
          await enviarMenu(provider, ctx.from)
          return
        }
        if (interactivo) {
          // Eligió algo de una lista, un botón o una ventana: sale del agente y se atiende como siempre.
          await salirModoAgente(ctx.from, 'interaccion')
        } else if (!texto || texto.startsWith('_event_')) {
          await flowDynamic(MSG.agente.soloTexto)
          return
        } else {
          // Sin await: la cola propia del agente mantiene el orden y el flujo no queda bloqueado.
          void atenderConAgente(ctx.from, texto, provider)
          return
        }
      }

      // Respuesta del calendario de fecha de inicio de vacaciones (ventana).
      const calendario = leerCalendario(ctx)
      if (calendario !== undefined) {
        await atenderCalendario(calendario, ctx.from, provider, async (texto) => {
          await flowDynamic(texto)
        })
        return
      }

      const tituloBoton = (ctx as unknown as { title_button_reply?: string }).title_button_reply

      // Botones del resumen de la solicitud de vacaciones: [Confirmar] [Editar fecha] [Cancelar].
      const resumen = leerBotonResumen(tituloBoton)
      if (resumen) {
        console.log(`[solicitud] botón "${resumen}" de ******${(ctx.from ?? '').slice(-4)}`)
        await atenderResumen(resumen, ctx.from, provider, async (texto) => {
          await flowDynamic(texto)
        })
        return
      }

      // Botones de "¿Deseas realizar otra consulta?" (llegan por título, no por id).
      const otra = leerOtraConsulta(tituloBoton)
      if (otra) {
        console.log(`[otra-consulta] "${otra}" de ******${(ctx.from ?? '').slice(-4)}`)
        const siguiente = await atenderOtraConsulta(otra, ctx.from, provider, async (texto) => {
          await flowDynamic(texto)
        })
        if (siguiente === 'fin') {
          // "No, finalizar": se cierra la sesión (estado en memoria). El registro se conserva:
          // el próximo mensaje muestra el menú sin pedir datos otra vez.
          await state.clear()
          void finalizarSesion(ctx.from)
          return
        }
        if (siguiente === 'nada') return
        await enviarMenu(provider, ctx.from)
        return
      }

      const seleccion = (ctx as unknown as { id_list_reply?: string }).id_list_reply
      if (esSeleccionConocida(seleccion)) {
        console.log(`[menu] selección "${seleccion}" de ******${(ctx.from ?? '').slice(-4)}`)
        const siguiente = await atenderSeleccion(seleccion, ctx.from, provider, async (texto) => {
          await flowDynamic(texto)
        })
        // "nada": ya se envió otra lista (años o meses) que el usuario debe responder.
        if (siguiente === 'nada') return
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
