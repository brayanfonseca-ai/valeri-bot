import { addKeyword, MemoryDB, utils } from '@builderbot/bot'
import type { MetaProvider } from '@builderbot/provider-meta'
import { config } from '../config'
import { consumirCierrePorInactividad, registrarIntento } from '../sesiones'
import { enviarFormulario } from '../formulario'
import { BOTONES, MSG } from '../mensajes'
import { enviarMenu } from '../menu'
import { buscarNumeroPorCedula, guardarRegistro } from '../registros'
import { validarEmpleado } from '../validacion'
import { esBoton } from '../validadores'

/**
 * Registro (validación única): confirmación y validación.
 *
 * Se llega aquí desde bienvenida.flow.ts cuando la ventana (WhatsApp Flow)
 * devolvió cédula y celular válidos, ya guardados en el estado.
 *
 *   "Sí, correctos":
 *     1. Regla "un empleado, un número": si la cédula ya está vinculada a OTRO
 *        número -> MSG.cedulaYaVinculada (no se registra).
 *     2. validarEmpleado() (ver validacion.ts, modo VALERI_VALIDACION):
 *        - autorizado    -> se guarda en registros.json, MSG.autorizado + menú.
 *        - no_autorizado -> MSG.noAutorizado (contactar a Recursos Humanos). No se guarda.
 *        - error         -> MSG.errorValidacion (intentar más tarde). No se guarda.
 *   "No, corregir": se vuelve a enviar la ventana.
 *
 * Pendiente: código de verificación por SMS antes de guardar el registro.
 */
export const confirmacionFlow = addKeyword<MetaProvider, MemoryDB>(utils.setEvent('VALERI_CONFIRMACION')).addAnswer(
  MSG.preguntaConfirmacion,
  { capture: true, buttons: [{ body: BOTONES.datosCorrectos }, { body: BOTONES.corregir }] },
  async (ctx, { state, provider, fallBack, flowDynamic, endFlow }) => {
    const waId = ctx.from
    const oculto = `******${(waId ?? '').slice(-4)}`

    // La sesión se cerró por inactividad mientras esperaba esta confirmación:
    // se descarta lo ingresado y se vuelve a pedir el registro desde el inicio.
    if (consumirCierrePorInactividad(waId)) {
      await state.clear()
      await enviarFormulario(provider, waId)
      return endFlow()
    }

    if (esBoton(ctx.body, BOTONES.datosCorrectos)) {
      const cedula: string | undefined = state.get('cedula')
      const telefono: string | undefined = state.get('telefono')
      if (!cedula || !telefono) {
        // Se perdió el estado (por ejemplo, el bot se reinició): se piden los datos de nuevo.
        await flowDynamic(MSG.corregirDatos)
        await enviarFormulario(provider, waId)
        return endFlow()
      }

      // 1. Un empleado, un número.
      let numeroVinculado: string | undefined
      try {
        numeroVinculado = await buscarNumeroPorCedula(cedula)
      } catch (error) {
        console.error(`[registro] error consultando vínculos de ${oculto}:`, error instanceof Error ? error.message : error)
        void registrarIntento(waId, { documento: cedula, telefono, resultado: 'ERROR', detalle: 'consulta de vínculo' })
        return endFlow(MSG.errorValidacion)
      }
      if (numeroVinculado && numeroVinculado !== waId) {
        console.log(`[registro] cédula ya vinculada a otro número; rechazado ${oculto}`)
        void registrarIntento(waId, { documento: cedula, telefono, resultado: 'CEDULA_EN_OTRO_NUMERO' })
        return endFlow(MSG.cedulaYaVinculada)
      }

      // 2. Validación: tabla users (modo "bd"), ETL (modo "etl") o abierta (pruebas).
      const resultado = await validarEmpleado(cedula, telefono)

      if (resultado.estado === 'error') {
        console.error(`[registro] error validando a ${oculto}: ${resultado.detalle}`)
        void registrarIntento(waId, { documento: cedula, telefono, resultado: 'ERROR', detalle: resultado.detalle.slice(0, 300) })
        return endFlow(MSG.errorValidacion)
      }

      if (resultado.estado === 'no_autorizado') {
        console.log(`[registro] no autorizado ${oculto} (motivo: ${resultado.motivo})`)
        void registrarIntento(waId, { documento: cedula, telefono, resultado: 'NO_REGISTRADO', detalle: resultado.motivo })
        return endFlow(MSG.noAutorizado)
      }

      const origen = config.validacion.modo === 'etl' ? 'BUK' : config.validacion.modo === 'abierta' ? 'MANUAL' : 'CSV_TEMPORAL'
      try {
        await guardarRegistro(waId, { cedula, telefono, confirmadoEn: new Date().toISOString(), idBuk: resultado.idBuk }, origen)
      } catch (error) {
        console.error(`[registro] no se pudo guardar el registro de ${oculto}:`, error instanceof Error ? error.message : error)
        void registrarIntento(waId, { documento: cedula, telefono, resultado: 'ERROR', detalle: 'guardar registro' })
        return endFlow(MSG.errorValidacion)
      }
      void registrarIntento(waId, { documento: cedula, telefono, resultado: 'AUTORIZADO' })
      await state.update({ cedula: undefined, telefono: undefined })
      console.log(`[registro] autorizado ${oculto}`)
      await flowDynamic(MSG.autorizado)
      await enviarMenu(provider, waId)
      return endFlow()
    }

    if (esBoton(ctx.body, BOTONES.corregir)) {
      await state.update({ cedula: undefined, telefono: undefined })
      await flowDynamic(MSG.corregirDatos)
      await enviarFormulario(provider, waId)
      return endFlow()
    }

    // Escribió texto en vez de tocar un botón: se reenvía la pregunta con los mismos botones.
    return fallBack(MSG.usaLosBotones)
  },
)
