/**
 * Textos que Valeri envía al usuario. Todo el contenido visible vive aquí para
 * poder ajustarlo sin tocar la lógica de los flujos.
 *
 * Límites de botones de respuesta: Meta permite 3 botones de hasta 20
 * caracteres, pero @builderbot/provider-meta 1.4.4 recorta el título a
 * 16 caracteres. Mantén cada título en 16 o menos.
 */

export const BOTONES = {
  datosCorrectos: 'Sí, correctos', // 13
  corregir: 'No, corregir', // 12
} as const

export const MSG = {
  /**
   * Mensaje con el botón que abre la ventana (WhatsApp Flow). Incluye el saludo:
   * así el usuario recibe un solo mensaje. Límites de Meta: encabezado 60, pie 60,
   * botón 20 caracteres.
   * Nota: mientras el flow esté en borrador, Meta muestra su propio texto de prueba
   * en lugar de este encabezado y cuerpo.
   */
  formulario: {
    encabezado: '¡Hola! Soy Valeri 👋',
    cuerpo: [
      'Soy la asistente de Transportes Vigía. Te ayudo con tus extractos de pago, vacaciones y certificados laborales.',
      '',
      'Antes de empezar necesito verificar tu identidad. Solo lo haremos esta vez.',
      'Toca el botón e ingresa tu cédula y tu celular registrado en Buk.',
    ].join('\n'),
    pie: 'Transportes Vigía',
    boton: 'Ingresar mis datos', // 18
  },

  datosNoValidos: [
    'No pude reconocer esos datos 🤔',
    '• La cédula debe tener solo números, entre 5 y 10 dígitos.',
    '• El celular debe ser colombiano, de 10 dígitos y empezar por 3.',
    'Vuelve a ingresarlos, por favor.',
  ].join('\n'),

  resumenDatos: (cedula: string, telefono: string) =>
    ['📋 *Revisa tus datos:*', '', `• Cédula: *${cedula}*`, `• Celular registrado en Buk: *${telefono}*`].join('\n'),

  preguntaConfirmacion: '¿Estás seguro de que estos son tus datos?',

  usaLosBotones: 'Por favor responde tocando uno de los botones 👇\n¿Estás seguro de que estos son tus datos?',

  corregirDatos: 'Sin problema, volvamos a ingresarlos ✍️',

  /** Validación exitosa: se envía justo antes del menú, solo la primera vez. */
  autorizado: '✅ ¡Listo! Verifiqué tu identidad. Desde ahora puedes usar el menú cada vez que me escribas.',

  /** No aparece en Buk, está inactivo o el celular no coincide. */
  noAutorizado: [
    'Lo siento 😔 no pude verificar tu información en Buk.',
    '',
    'Es posible que tu cédula o tu celular no estén registrados correctamente.',
    'Por favor comunícate con *Recursos Humanos* para que revisen y actualicen tus datos en Buk. Cuando estén corregidos, escríbeme de nuevo y con gusto te ayudo.',
  ].join('\n'),

  /** La cédula ya está vinculada a otro número de WhatsApp (un empleado, un número). */
  cedulaYaVinculada: [
    'Esta cédula ya está vinculada a otro número de WhatsApp 📱',
    '',
    'Por seguridad, cada empleado solo puede usar Valeri desde un número.',
    'Si cambiaste de celular, comunícate con *Recursos Humanos* para actualizarlo.',
  ].join('\n'),

  /** Falla técnica al consultar (ETL caído, sin respuesta, etc.). No es culpa del usuario. */
  errorValidacion: [
    'Tuve un problema para verificar tu información en este momento 🙏',
    'Por favor intenta de nuevo en unos minutos.',
  ].join('\n'),

  /** Menú principal (lista). Ver límites en menu.ts. */
  menu: {
    encabezado: '📋 Menú principal',
    cuerpo: '¿En qué te puedo ayudar hoy? 😊\nElige una opción del menú:',
    pie: 'Transportes Vigía',
    boton: 'Ver opciones', // 12
    seccion: 'Opciones',
  },

  /** Respuesta temporal mientras una opción del menú no está desarrollada. */
  opcionEnConstruccion: (titulo: string) => `🚧 *${titulo}* estará disponible muy pronto.`,
} as const
