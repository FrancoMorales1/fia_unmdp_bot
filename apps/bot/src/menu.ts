import type { MensajeEntrante, OpcionMenu, RespuestaSalida } from '@fi/core';

import {
  DEFINICIONES_OPCIONES as DEFINICIONES,
  TEXTO_ELEGIR_CARRERA,
  TEXTO_ELEGIR_PLAN,
  TEXTO_MATERIAS_ENCONTRADAS,
  textoMenuInicial,
  textoPedidoDeConsulta,
  type DefinicionOpcion,
} from './textos.js';

export type NumeroOpcion = 1 | 2 | 3 | 4 | 5;

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
  return OPCIONES.map((o) => ({
    id: idDeOpcion(o.numero),
    etiqueta: o.etiqueta,
    atajo: String(o.numero),
  }));
}

// ── Mensajes que manda el bot ────────────────────────────────────────────────

/** El menú: botones en Telegram, lista numerada en WhatsApp. */
export function menuInicial(nombre?: string): RespuestaSalida {
  return {
    texto: textoMenuInicial(nombre),
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
  const { etiqueta, pedido, placeholder, pista } = DEFINICIONES[numero];

  return {
    texto: textoPedidoDeConsulta(etiqueta, pedido, pista),
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
    texto: TEXTO_ELEGIR_CARRERA,
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
    texto: TEXTO_ELEGIR_PLAN,
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
    texto: TEXTO_MATERIAS_ENCONTRADAS,
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
  // Forma consistente de "no era esto, volvé al menú" en cualquier opción.
  '-',
]);

export function pideMenu(texto: string): boolean {
  return PALABRAS_DE_MENU.has(texto.trim().toLowerCase());
}

/**
 * "todo" pide la información completa sin pasar por la IA. Solo tiene efecto
 * en las opciones que lo soportan (Información de la facultad e Ingreso a
 * Ingeniería); en el resto se trata como texto de búsqueda normal.
 */
export function esPedidoDeTodo(consulta: string): boolean {
  return consulta.trim().toLowerCase() === 'todo';
}

export function normalizarConsulta(texto: string): string {
  return texto.trim();
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
 * 2. Pidió el menú explícitamente (incluye "-", la forma consistente de
 *    volver desde cualquier opción) → siempre gana, es la salida de
 *    emergencia. Por eso corta acá y nunca llega a interpretarse como parte
 *    de una consulta.
 * 3. Respondió a un pedido → el hilo dice el tema y el texto es la consulta.
 * 4. Escribió "2 algo" → protocolo de texto, solo en canales sin botones
 *    (WhatsApp). En Telegram la selección va siempre por menú.
 * 5. Ya había elegido tema hace poco → se sigue conversando sobre eso.
 * 6. Nada de lo anterior → menú.
 */
export function interpretar(
  mensaje: MensajeEntrante,
  opcionRecordada: NumeroOpcion | null,
  { protocoloDeTexto = true }: { protocoloDeTexto?: boolean } = {},
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

  if (protocoloDeTexto) {
    const porTexto = parsearOpcion(mensaje.texto);
    if (porTexto) return { tipo: 'consultar', ...porTexto };
  }

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
