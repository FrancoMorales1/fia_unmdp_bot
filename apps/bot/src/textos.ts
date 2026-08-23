import type { NumeroOpcion } from './menu.js';

/**
 * Todos los textos que el bot le manda al alumno, en un solo lugar para poder
 * ajustar la redacción sin tocar la lógica de main.ts/menu.ts.
 */

// ── Menú y opciones ──────────────────────────────────────────────────────────

export interface DefinicionOpcion {
  numero: NumeroOpcion;
  /** Lo que se lee en el botón. También es la primera línea del pedido de texto. */
  etiqueta: string;
  /** Qué se le pide que escriba al alumno después de elegir la opción. */
  pedido: string;
  /** Texto gris dentro de la celda de Telegram. */
  placeholder: string;
  /**
   * Línea final del pedido: qué hace "-" en esta opción puntual. En 4 y 5
   * además menciona "todo", que en esas dos trae la info completa sin pasar
   * por la IA — en el resto "-" es la única palabra especial (vuelve al
   * menú); ver `esPedidoDeTodo` en menu.ts.
   */
  pista: string;
}

const PISTA_VOLVER = 'Si querés volver al menú, mandá un guión: -';
const PISTA_VOLVER_O_TODO = `${PISTA_VOLVER}\nSi querés toda la información, escribí: todo`;

export const DEFINICIONES_OPCIONES = {
  1: {
    numero: 1,
    etiqueta: '📅 Horarios de cursadas',
    pedido: '¿De qué materia querés el horario?',
    placeholder: 'Ej: análisis matemático I',
    pista: 'Si no querés ver horarios de cursadas, mandá un guión: -',
  },
  2: {
    numero: 2,
    etiqueta: '🗓️ Calendario académico 2026',
    pedido: '¿Qué fecha o trámite estás buscando?',
    placeholder: 'Ej: inscripción a finales',
    pista: 'Si solo querías el PDF completo (ya te lo mandé arriba), mandá un guión: -',
  },
  3: {
    numero: 3,
    etiqueta: '📚 Plan de estudios',
    pedido: '¿De qué carrera o materia?',
    placeholder: 'Ej: ingeniería en informática',
    pista: 'Si solo querías el PDF completo (ya te lo mandé arriba), mandá un guión: -',
  },
  4: {
    numero: 4,
    etiqueta: 'ℹ️ Información de la facultad',
    pedido: '¿Qué necesitás saber?',
    placeholder: 'Ej: horarios de la biblioteca',
    pista: PISTA_VOLVER_O_TODO,
  },
  5: {
    numero: 5,
    etiqueta: '🎓 Ingreso a Ingeniería 2027',
    pedido: '¿Qué necesitás saber sobre el ingreso?',
    placeholder: 'Ej: cómo me inscribo al SIFI',
    pista: PISTA_VOLVER_O_TODO,
  },
} as const satisfies Record<NumeroOpcion, DefinicionOpcion>;

export function textoMenuInicial(nombre?: string): string {
  const saludo = nombre ? `¡Hola, ${nombre}!` : '¡Hola!';
  return `${saludo} Soy el asistente de la Facultad de Ingeniería (UNMdP).\n\n¿Sobre qué querés consultar?`;
}

export function textoPedidoDeConsulta(etiqueta: string, pedido: string, pista: string): string {
  return `${etiqueta}\n\n${pedido}\n\nEscribilo acá abajo. ${pista}`;
}

export const TEXTO_ELEGIR_CARRERA = 'Elegí la carrera:';
export const TEXTO_ELEGIR_PLAN = 'Elegí el plan de estudios:';
export const TEXTO_MATERIAS_ENCONTRADAS =
  'Encontré varias materias posibles. Elegí una para ver sus horarios:';

// ── Errores y avisos ─────────────────────────────────────────────────────────

export const MENSAJE_ERROR =
  'Uf, se me complicó procesar tu consulta. Probá de nuevo en un ratito, ' +
  'o escribile directo a Alumnos de la Facultad de Ingeniería.';

export const MENSAJE_RATE_LIMIT =
  'Estás enviando muchos mensajes seguidos. Esperá un momento y volvé a consultar.';

export const MENSAJE_SIN_CARRERAS = 'No encontré carreras con planes cargados.';
export const MENSAJE_SIN_PLANES_DE_CARRERA = 'No encontré planes para esa carrera.';

// ── Plan de estudios ─────────────────────────────────────────────────────────

export function textoPlanElegido(plan: string): string {
  return (
    `Plan de estudios: ${plan}.\n\n¿Sobre qué querés consultar? (créditos, correlativas, materias…)\n\n` +
    `Escribilo acá abajo. ${DEFINICIONES_OPCIONES[3].pista}`
  );
}

export const PLACEHOLDER_CONSULTA_PLAN = 'Ej: cuántos créditos vale una materia';

export function textoPlanSinFiltro(plan: string): string {
  return `📚 Plan de estudios: ${plan}.\n\nAhí arriba tenés el PDF completo.`;
}

// ── Calendario académico ─────────────────────────────────────────────────────

export const TEXTO_PEDIDO_CALENDARIO = textoPedidoDeConsulta(
  DEFINICIONES_OPCIONES[2].etiqueta,
  DEFINICIONES_OPCIONES[2].pedido,
  DEFINICIONES_OPCIONES[2].pista,
);
export const PLACEHOLDER_CALENDARIO = 'Ej: inscripción a finales';
export const TEXTO_CALENDARIO_SIN_FILTRO =
  '🗓️ Ahí arriba tenés el calendario académico 2026 completo.';

// ── Información de la facultad ───────────────────────────────────────────────

/**
 * Subconjunto curado de `material/Información de la facultad.txt`, para
 * responder al toque cuando piden "todo" en esa opción, sin gastar una
 * consulta a la IA. Si cambian estos datos en el archivo, actualizar acá
 * también.
 */
export const RESUMEN_FACULTAD =
  'ℹ️ Información de la facultad\n\n' +
  '📍 Dirección: https://maps.app.goo.gl/hdJCbCKnme3sq2oC7\n\n' +
  '💬 Comunidades de WhatsApp:\n' +
  '- Ciclo básico: https://chat.whatsapp.com/He7U8f96vzR2S7L8E33mwN\n' +
  '- Materias avanzadas: https://chat.whatsapp.com/KwVsyfOF69X0nfXUgBr9hG\n\n' +
  '🌐 Página UNMdP: https://www.mdp.edu.ar/\n' +
  '🌐 Página ING: https://www.fi.mdp.edu.ar/\n' +
  '📷 Instagram CEI: https://www.instagram.com/informatica.fimdp/\n' +
  '🎓 SIU Guaraní: https://portalsiu.mdp.edu.ar/autogestion/\n' +
  '🏢 Departamento Alumnos: alumnos@fi.mdp.edu.ar (9:30 a 12:00)';
