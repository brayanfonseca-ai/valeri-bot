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

/**
 * Botones de "¿Deseas realizar otra consulta?" (después de entregar un archivo).
 * Se envían a mano (menu.ts → enviarOtraConsulta), así que el límite es el de Meta: 20 caracteres.
 */
export const BOTONES_OTRA_CONSULTA = {
  si: 'Sí, gracias', // 11 -> menú principal
  finalizar: 'No, finalizar', // 13 -> despedida y fin de la sesión
  agente: 'Hablar con agente', // 17 -> opción 5 del menú ("agente")
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
      'Toca el botón e ingresa tu cédula y tu número celular.',
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
    ['📋 *Revisa tus datos:*', '', `• Cédula: *${cedula}*`, `• Celular registrado: *${telefono}*`].join('\n'),

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

  /** Última fila de todas las listas secundarias (años, meses). */
  volverMenu: {
    titulo: '🏠 Menú principal',
    descripcion: 'Volver al inicio',
  },

  /** Después de entregar un archivo: pregunta con 3 botones (BOTONES_OTRA_CONSULTA). Cuerpo ≤ 1024. */
  /**
   * Cierre de TODO proceso (comprobante, vacaciones, opciones en construcción...).
   * Con texto (archivo entregado): "✅ ¡Listo! <texto>" + pregunta. Sin texto: solo la pregunta.
   */
  otraConsulta: (queSeEntrego?: string) =>
    queSeEntrego ? `✅ ¡Listo! ${queSeEntrego}\n\n¿Deseas realizar otra consulta?` : '¿Deseas realizar otra consulta? 😊',

  /** "No, finalizar": despedida. La sesión se cierra; el registro se conserva. */
  despedida: [
    '¡Gracias por usar Valeri! 👋',
    'Cuando necesites algo más, escríbeme y con gusto te ayudo.',
  ].join('\n'),

  /** Respuesta temporal mientras una opción del menú no está desarrollada. */
  opcionEnConstruccion: (titulo: string) => `🚧 *${titulo}* estará disponible muy pronto.`,

  /** Falla al consultar ETL (sin API Key, ETL caído, error 5xx). No es culpa del usuario. */
  errorConsulta: [
    'Tuve un problema para consultar tu información en este momento 🙏',
    'Por favor intenta de nuevo en unos minutos.',
  ].join('\n'),

  /** Comprobante de pago (nómina). Títulos de fila ≤ 24, botones de lista ≤ 20 caracteres. */
  comprobante: {
    encabezado: '📄 Comprobante de pago',
    preguntaAnio: '¿De qué año necesitas tu comprobante de pago?',
    botonAnios: 'Ver años', // 8
    seccionAnios: 'Años',
    descAnio: 'Comprobantes de este año',
    preguntaMes: (anio: number) => `Elige el mes de *${anio}*:`,
    botonMeses: 'Ver meses', // 9
    masMeses: 'Más meses ➡️',
    masMesesDesc: 'Ver los meses anteriores',
    mesesRecientes: '⬅️ Meses recientes',
    mesesRecientesDesc: 'Volver a los meses más recientes',
    buscando: (mes: string, anio: number) => `⏳ Estoy buscando tu comprobante de pago de *${mes} ${anio}*, dame un momento...`,
    /** Texto que acompaña al PDF. */
    pie: (mes: string, anio: number) => `📄 Tu comprobante de pago de *${mes} ${anio}*.`,
    /** Va dentro de MSG.otraConsulta después del PDF. */
    entregado: 'Tu comprobante de pago se generó correctamente.',
    noEncontrado: (mes: string, anio: number) =>
      [
        `No encontré tu comprobante de pago de *${mes} ${anio}* 🔎`,
        'Es posible que ese mes aún no esté liquidado. Prueba con otro mes o comunícate con *Recursos Humanos*.',
      ].join('\n'),
  },

  /** Solicitar vacaciones. Títulos de fila ≤ 24, botón de lista ≤ 20, encabezado ≤ 60. */
  solicitud: {
    encabezado: '🏖️ Solicitar vacaciones',
    cuerpo: (disponibles: number) =>
      `Tienes *${disponibles} ${disponibles === 1 ? 'día' : 'días'}* disponibles para disfrutar.\n¿Cuántos días quieres solicitar?`,
    boton: 'Ver días', // 8
    seccion: (desde: number, hasta: number) => `Días ${desde} a ${hasta}`,
    fila: (dias: number) => (dias === 1 ? '1 día' : `${dias} días`),
    descFila: (disponibles: number) => `De ${disponibles} disponibles`,
    masDias: 'Más días ➡️',
    masDiasDesc: 'Ver más cantidades de días',
    diasAnteriores: '⬅️ Días anteriores',
    diasAnterioresDesc: 'Ver cantidades menores',
    sinDias: [
      'Por ahora no tienes días de vacaciones disponibles para solicitar 🌴',
      'Si crees que hay un error, comunícate con *Recursos Humanos*.',
    ].join('\n'),
    /** El saldo cambió y ya no alcanza para lo elegido. */
    excedeSaldo: (pedidos: number, disponibles: number) =>
      `No puedes solicitar *${pedidos} días*: hoy tienes *${disponibles}* disponibles. Elige de nuevo, por favor.`,

    // ── Fecha de inicio (año -> mes -> día) ──
    encabezadoFecha: '📅 Fecha de inicio',
    preguntaAnio: (dias: number) => `¿En qué año quieres iniciar tus *${dias === 1 ? '1 día' : `${dias} días`}* de vacaciones?`,
    botonAnios: 'Ver años', // 8
    seccionAnios: 'Años',
    descAnio: 'Iniciar en este año',
    preguntaMes: (anio: number) => `Elige el *mes* en que inicias (${anio}):`,
    botonMeses: 'Ver meses', // 9
    descMes: (anio: number) => `Iniciar en ${anio}`,
    preguntaDia: (mes: string, anio: number) =>
      `Elige el *día* en que inicias (${mes} ${anio}).\nLos domingos y festivos no aparecen porque no son días hábiles.`,
    botonDias: 'Ver fechas', // 10
    masMeses: 'Más meses ➡️',
    masMesesDesc: 'Ver los meses siguientes',
    mesesAnteriores: '⬅️ Meses anteriores',
    mesesAnterioresDesc: 'Ver los meses anteriores',
    masFechas: 'Más fechas ➡️',
    masFechasDesc: 'Ver los días siguientes del mes',
    fechasAnteriores: '⬅️ Fechas anteriores',
    fechasAnterioresDesc: 'Ver los días anteriores del mes',

    // ── Resumen y confirmación ──
    /**
     * Antes de confirmar: SOLO lo que eligió el empleado (días y fecha de inicio). Todavía no se ha
     * enviado nada a Buk; la fecha fin, los días calendario y el regreso se muestran DESPUÉS, con
     * los datos que devuelve Buk (MSG.solicitud.enviada).
     */
    resumen: (r: { dias: number; inicio: string }) =>
      [
        '📋 *Revisa tu solicitud de vacaciones:*',
        '',
        `• Días hábiles a solicitar: *${r.dias}*`,
        `• Fecha de inicio: *${r.inicio}*`,
        '',
        '_Los domingos y festivos no se cuentan como días de vacaciones._',
        '',
        '¿Confirmas tu solicitud?',
      ].join('\n'),
    /** Tocó un botón del resumen, pero ya no hay solicitud en curso (pasó el tiempo o se reinició el bot). */
    vencida: 'Esa solicitud ya no está activa ⏱️. Empecemos de nuevo desde *Solicitar vacaciones* en el menú.',
    cancelada: 'Listo, cancelé la solicitud. No se envió nada a Recursos Humanos.',
    /** Buk registró la vacación. Se muestran los datos QUE DEVOLVIÓ BUK (no los calculados por el bot). */
    enviada: (r: { habiles: string; calendario: string; inicio: string; fin: string; regreso: string }) =>
      [
        '✅ *¡Tu solicitud de vacaciones ha sido exitosa!*',
        '',
        `• Días hábiles: *${r.habiles}*`,
        `• Días calendario: *${r.calendario}*`,
        `• Inicias: *${r.inicio}*`,
        `• Terminas: *${r.fin}*`,
        `• Regresas a trabajar: *${r.regreso}*`,
      ].join('\n'),
    /** Buk registró algo distinto de lo que el bot le mostró al empleado (días o fechas). */
    diferencia: (detalle: string) =>
      [
        `⚠️ Buk registró tus vacaciones con una diferencia frente a lo que solicitaste: ${detalle}.`,
        'Los datos de arriba son los que quedaron en Buk. Si necesitas ajustarlos, comunícate con *Recursos Humanos*.',
      ].join('\n'),
    /** Buk o ETL rechazaron los datos (400 / 422). */
    rechazada: (motivo: string | null) =>
      [
        '❌ Buk no aceptó tu solicitud de vacaciones.',
        ...(motivo ? [`Motivo: _${motivo}_`] : []),
        '',
        'No se registró nada. Puedes intentarlo con otra fecha o comunicarte con *Recursos Humanos*.',
      ].join('\n'),
    /** ETL aún no publica el endpoint: la solicitud se armó pero no se envió. */
    sinEnvio: [
      '📝 Tu solicitud quedó lista.',
      '',
      '🚧 El envío a Recursos Humanos estará disponible muy pronto. Por ahora no se registró en Buk.',
    ].join('\n'),
  },

  /** Calendario de fecha de inicio (WhatsApp Flow). Encabezado ≤ 60, botón ≤ 20. */
  calendario: {
    encabezado: '📅 Fecha de inicio',
    cuerpo: (dias: number) =>
      `Vas a solicitar *${dias === 1 ? '1 día' : `${dias} días`}* de vacaciones.\nToca el botón y elige en el calendario el día en que inicias.`,
    boton: 'Elegir fecha', // 12
    /** Texto dentro de la ventana del calendario. */
    texto: (dias: number) =>
      `Elige el día en que inicias tus ${dias === 1 ? '1 día' : `${dias} días`} de vacaciones. Puedes elegir desde hoy hasta un año adelante. Los domingos y festivos están bloqueados.`,
    /** La fecha elegida no es válida (domingo, festivo, fuera de la ventana o ilegible). */
    fechaNoValida:
      'Esa fecha no se puede usar para iniciar vacaciones 📅 (debe ser un día hábil: de lunes a sábado, sin festivos, desde hoy y hasta un año adelante). Elige otra, por favor.',
  },

  /** Botones del resumen de la solicitud (≤ 20 caracteres; distintos de todos los demás botones). */
  botonesSolicitud: {
    confirmar: 'Confirmar', // 9
    editar: 'Editar fecha', // 12
    cancelar: 'Cancelar', // 8
  },

  /** Certificado laboral (PDF sin salario). */
  certificado: {
    buscando: '⏳ Estoy generando tu certificado laboral, dame un momento...',
    /** Texto que acompaña al PDF. */
    pie: '📄 Tu certificado laboral de Transportes Vigía.',
    /** Va dentro de MSG.otraConsulta después del PDF. */
    entregado: 'Tu certificado laboral se generó correctamente.',
    /** 422: Buk no tiene cargo, fecha de inicio, tipo de contrato o fecha de retiro. */
    datosIncompletos: [
      'No pude generar tu certificado laboral porque en Buk faltan algunos de tus datos (cargo, fecha de ingreso o tipo de contrato) 📋',
      'Por favor comunícate con *Recursos Humanos* para que los completen.',
    ].join('\n'),
    /** 404: la cédula no corresponde a un empleado en Buk. */
    noEncontrado: [
      'No encontré tu información en Buk para generar el certificado 🔎',
      'Por favor comunícate con *Recursos Humanos*.',
    ].join('\n'),
  },

  vacaciones: {
    buscando: '⏳ Estoy consultando tus días de vacaciones...',
    /** Solo el número de días pendientes por disfrutar (campo stock de ETL). */
    resultado: (dias: string) => `🌴 Tienes *${dias} días* de vacaciones pendientes por disfrutar.`,
  },
} as const
