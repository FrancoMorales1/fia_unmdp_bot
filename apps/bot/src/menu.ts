import { env, type MensajeEntrante, type OpcionMenu, type RespuestaSalida } from '@fi/core';

export type NumeroOpcion = 1 | 2 | 3 | 4 | 5;

interface DefinicionOpcion {
  numero: NumeroOpcion;
  /** Lo que se lee en el botón. También es la primera línea del pedido de texto. */
  etiqueta: string;
  /** Qué se le pide que escriba al alumno después de elegir la opción. */
  pedido: string;
  /** Texto gris dentro de la celda de Telegram. */
  placeholder: string;
}

const DEFINICIONES = {
  1: {
    numero: 1,
    etiqueta: '📅 Horarios de cursadas',
    pedido: '¿De qué materia querés el horario?',
    placeholder: 'Ej: análisis matemático I',
  },
  2: {
    numero: 2,
    etiqueta: '🗓️ Calendario académico 2026',
    pedido: '¿Qué fecha o trámite estás buscando?',
    placeholder: 'Ej: inscripción a finales',
  },
  3: {
    numero: 3,
    etiqueta: '📚 Plan de estudios',
    pedido: '¿De qué carrera o materia?',
    placeholder: 'Ej: ingeniería en informática',
  },
  4: {
    numero: 4,
    etiqueta: 'ℹ️ Información de la facultad',
    pedido: '¿Qué necesitás saber?',
    placeholder: 'Ej: horarios de la biblioteca',
  },
  5: {
    numero: 5,
    etiqueta: '🎓 Ingreso a Ingeniería 2027',
    pedido: '¿Qué necesitás saber sobre el ingreso?',
    placeholder: 'Ej: cómo me inscribo al SIFI',
  },
} as const satisfies Record<NumeroOpcion, DefinicionOpcion>;

export const OPCIONES: readonly DefinicionOpcion[] = Object.values(DEFINICIONES);

const PREFIJO_OPCION = 'opcion:';

function idDeOpcion(numero: NumeroOpcion): string {
  return `${PREFIJO_OPCION}${String(numero)}`;
}

function opcionDesdeId(id: string): NumeroOpcion | null {
  if (!id.startsWith(PREFIJO_OPCION)) return null;
  const numero = Number(id.slice(PREFIJO_OPCION.length));
  return esNumeroDeOpcion(numero) ? numero : null;
}

function esNumeroDeOpcion(valor: number): valor is NumeroOpcion {
  return valor === 1 || valor === 2 || valor === 3 || valor === 4 || valor === 5;
}

function botones(): OpcionMenu[] {
  const deOpciones = OPCIONES.map((o) => ({
    id: idDeOpcion(o.numero),
    etiqueta: o.etiqueta,
    atajo: String(o.numero),
  }));

  // Sin WEB_APP_URL (dev local, o todavía no deployada) no se ofrece un botón roto.
  if (!env.WEB_APP_URL) return deOpciones;

  return [
    ...deOpciones,
    { id: 'opcion:web', etiqueta: '📱 Abrir menú interactivo', abrirWebApp: env.WEB_APP_URL },
  ];
}

// ── Mensajes que manda el bot ────────────────────────────────────────────────

/** El menú: botones en Telegram, lista numerada en WhatsApp. */
export function menuInicial(nombre?: string): RespuestaSalida {
  const saludo = nombre ? `¡Hola, ${nombre}!` : '¡Hola!';

  return {
    texto:
      `${saludo} Soy el asistente de la Facultad de Ingeniería (UNMdP).\n\n` +
      '¿Sobre qué querés consultar?',
    opciones: botones(),
  };
}

/**
 * El segundo paso: ya eligió tema y ahora puede escribir el detalle.
 * `pedirTexto` hace que Telegram abra la celda de respuesta enfocada; la
 * etiqueta va en la primera línea porque es lo que después identifica la opción
 * cuando llega la respuesta.
 */
export function pedidoDeConsulta(numero: NumeroOpcion): RespuestaSalida {
  const { etiqueta, pedido, placeholder } = DEFINICIONES[numero];

  return {
    texto:
      `${etiqueta}\n\n${pedido}\n\n` +
      'Escribilo acá abajo. Si querés ver todo sin filtrar, mandá un guión: -',
    pedirTexto: { placeholder },
  };
}

/** Los botones que acompañan una respuesta, para saltar a otro tema sin escribir. */
export function botonesDeSeguimiento(): OpcionMenu[] {
  return botones();
}

const PREFIJO_MATERIA = 'materia:';
const PREFIJO_CARRERA = 'carrera:';
const PREFIJO_PLAN = 'plan:';

function indiceDeOpcion(mensaje: MensajeEntrante, prefijo: string): number {
  return mensaje.opcionElegida?.startsWith(prefijo)
    ? Number(mensaje.opcionElegida.slice(prefijo.length))
    : Number(/^(\d+)[.)]?$/.exec(mensaje.texto.trim())?.[1]);
}

export function opcionesDeCarreras(carreras: string[]): RespuestaSalida {
  return {
    texto: 'Elegí la carrera:',
    opciones: carreras.map((carrera, indice) => ({
      id: `${PREFIJO_CARRERA}${indice + 1}`,
      etiqueta: carrera,
      atajo: String(indice + 1),
    })),
  };
}

export function carreraElegida(mensaje: MensajeEntrante, carreras: string[] | null): string | null {
  if (!carreras || carreras.length === 0) return null;
  const indice = indiceDeOpcion(mensaje, PREFIJO_CARRERA);
  return Number.isInteger(indice) && indice >= 1 && indice <= carreras.length
    ? (carreras[indice - 1] ?? null)
    : null;
}

export function opcionesDePlanes(planes: string[]): RespuestaSalida {
  return {
    texto: 'Elegí el plan de estudios:',
    opciones: planes.map((plan, indice) => ({
      id: `${PREFIJO_PLAN}${indice + 1}`,
      etiqueta: plan,
      atajo: String(indice + 1),
    })),
  };
}

export function planElegido(mensaje: MensajeEntrante, planes: string[] | null): string | null {
  if (!planes || planes.length === 0) return null;
  const indice = indiceDeOpcion(mensaje, PREFIJO_PLAN);
  return Number.isInteger(indice) && indice >= 1 && indice <= planes.length
    ? (planes[indice - 1] ?? null)
    : null;
}

export function opcionesDeMaterias(materias: string[]): RespuestaSalida {
  return {
    texto: 'Encontré varias materias posibles. Elegí una para ver sus horarios:',
    opciones: materias.map((materia, indice) => ({
      id: `${PREFIJO_MATERIA}${indice + 1}`,
      etiqueta: materia,
      atajo: String(indice + 1),
    })),
  };
}

export function materiaElegida(mensaje: MensajeEntrante, materias: string[] | null): string | null {
  if (!materias || materias.length === 0) return null;

  const indice = mensaje.opcionElegida?.startsWith(PREFIJO_MATERIA)
    ? Number(mensaje.opcionElegida.slice(PREFIJO_MATERIA.length))
    : Number(/^(\d+)[.)]?$/.exec(mensaje.texto.trim())?.[1]);

  return Number.isInteger(indice) && indice >= 1 && indice <= materias.length
    ? (materias[indice - 1] ?? null)
    : null;
}

/** Comandos que se publican en el menú azul de Telegram. */
export const COMANDOS = [
  { comando: 'start', descripcion: 'Empezar y ver el menú' },
  { comando: 'menu', descripcion: 'Volver al menú principal' },
];

// ── Interpretación de lo que llega ───────────────────────────────────────────

const PALABRAS_DE_MENU = new Set([
  '/start',
  '/menu',
  '/ayuda',
  '/help',
  'menu',
  'menú',
  'volver',
  'inicio',
  'ayuda',
]);

/** Formas de decir "no filtres nada, mostrame todo". */
const SIN_FILTRO = new Set(['-', '.', '*', 'todo', 'todos', 'todas', 'ver todo', 'nada']);

export function pideMenu(texto: string): boolean {
  return PALABRAS_DE_MENU.has(texto.trim().toLowerCase());
}

/** Deja la consulta lista para buscar: vacía significa "sin filtro". */
export function normalizarConsulta(texto: string): string {
  const limpio = texto.trim();
  return SIN_FILTRO.has(limpio.toLowerCase()) ? '' : limpio;
}

/**
 * Detecta el protocolo de texto: "1", "2 informatica", "3. ingeniería química".
 * Sigue vivo porque es la única forma de elegir en WhatsApp, que no tiene botones.
 */
export function parsearOpcion(mensaje: string): { numero: NumeroOpcion; consulta: string } | null {
  const match = /^([1-5])\b[\s.:)-]*([\s\S]*)$/.exec(mensaje.trim());
  if (!match) return null;

  const numero = Number(match[1]);
  if (!esNumeroDeOpcion(numero)) return null;

  return { numero, consulta: normalizarConsulta(match[2] ?? '') };
}

/**
 * Recupera la opción a partir del mensaje que el alumno está respondiendo.
 *
 * Evita guardar estado del lado del bot: el pedido lleva su etiqueta en la
 * primera línea, así que el propio hilo de Telegram dice de qué tema se trata,
 * aunque el proceso se haya reiniciado en el medio.
 */
export function opcionDesdePedido(textoDelPedido: string): NumeroOpcion | null {
  const primeraLinea = textoDelPedido.split('\n')[0]?.trim() ?? '';
  return OPCIONES.find((o) => o.etiqueta === primeraLinea)?.numero ?? null;
}

export type Intencion =
  | { tipo: 'menu' }
  | { tipo: 'pedir'; numero: NumeroOpcion }
  | { tipo: 'consultar'; numero: NumeroOpcion; consulta: string };

/**
 * Decide qué quiso hacer el usuario. El orden importa:
 *
 * 1. Apretó un botón → se le abre la celda de texto para que dé más contexto.
 * 2. Pidió el menú explícitamente → siempre gana, es la salida de emergencia.
 * 3. Respondió a un pedido → el hilo dice el tema y el texto es la consulta.
 * 4. Escribió "2 algo" → protocolo de texto (WhatsApp y quien prefiera tipear).
 * 5. Ya había elegido tema hace poco → se sigue conversando sobre eso.
 * 6. Nada de lo anterior → menú.
 */
export function interpretar(
  mensaje: MensajeEntrante,
  opcionRecordada: NumeroOpcion | null,
): Intencion {
  if (mensaje.opcionElegida) {
    const numero = opcionDesdeId(mensaje.opcionElegida);
    if (numero) return { tipo: 'pedir', numero };
    return { tipo: 'menu' };
  }

  if (pideMenu(mensaje.texto)) return { tipo: 'menu' };

  if (mensaje.respondeA) {
    const numero = opcionDesdePedido(mensaje.respondeA);
    if (numero) {
      return { tipo: 'consultar', numero, consulta: normalizarConsulta(mensaje.texto) };
    }
  }

  const porTexto = parsearOpcion(mensaje.texto);
  if (porTexto) return { tipo: 'consultar', ...porTexto };

  if (opcionRecordada && mensaje.texto.trim().length > 0) {
    return {
      tipo: 'consultar',
      numero: opcionRecordada,
      consulta: normalizarConsulta(mensaje.texto),
    };
  }

  return { tipo: 'menu' };
}

/**
 * Convierte la opción + consulta en una pregunta natural para pasarle a la IA.
 * Así Gemini recibe contexto claro sobre qué se está preguntando.
 */
export function mensajeParaIA(opcion: { numero: NumeroOpcion; consulta: string }): string {
  const { numero, consulta } = opcion;

  switch (numero) {
    case 1:
      return consulta
        ? `¿Cuándo son los horarios de ${consulta}?`
        : '¿Cuáles son los horarios de cursadas para los próximos días?';
    case 2:
      return consulta
        ? `¿Qué dice el calendario académico sobre ${consulta}?`
        : '¿Cuáles son las fechas importantes del calendario académico 2026?';
    case 3:
      return consulta
        ? `¿Cómo es el plan de estudios de ${consulta}?`
        : '¿Qué carreras hay y cómo son sus planes de estudio?';
    case 4:
      return consulta
        ? `¿Dónde encuentro información sobre ${consulta}?`
        : '¿Cuáles son los grupos de WhatsApp, enlaces y servicios de la facultad?';
    case 5:
      return consulta
        ? `¿Qué dice la guía de ingreso 2027 sobre ${consulta}?`
        : '¿Qué pasos y requisitos hay para ingresar a Ingeniería en 2027?';
  }
}
