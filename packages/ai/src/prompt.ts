import type { ConsultaDeMateria, ConsultaIA, FragmentoContexto } from './types.js';

/** Reglas que aplican a todas las opciones: idioma, tono y formato de chat. */
const INSTRUCCION_BASE = `Sos el asistente virtual de la Facultad de Ingeniería de la Universidad Nacional de Mar del Plata (UNMdP).

Reglas:
1. Respondé ÚNICAMENTE con la información del CONTEXTO. No inventes datos.
2. El título de cada fragmento dice qué encontró la búsqueda. Respetalo:
   - "Horarios de …": eso es lo que pidió, aunque el nombre no sea igual al que escribió. Nombrale la materia completa, tal como figura, y dale los horarios sin dudar.
   - "COINCIDENCIA PARCIAL": lo que pidió el alumno NO existe con ese nombre. Decíselo y ofrecele lo parecido que sí está, nombrándolo.
   - "SIN COINCIDENCIAS": no hay nada de eso. Decilo y sugerile las opciones listadas que más se acerquen a lo que buscaba.
   - "sin datos cargados": el problema es que la información todavía no se cargó, no que no exista. Aclarale la diferencia.
3. Si aun así no podés responder, derivá a la web oficial (fi.mdp.edu.ar) o a la oficina de Alumnos, pero recién después de haber intentado con lo del contexto.
4. Escribí en español rioplatense, cordial y breve. Es un chat, no un informe.
5. Máximo 4 párrafos cortos. Solo *negrita* y _cursiva_, sin markdown pesado.`;

/** Instrucción de dominio específica para cada opción del menú. */
export const INSTRUCCION_POR_OPCION = {
  1: 'Respondés sobre horarios de cursadas. Cuando des un horario, incluí siempre día, hora y aula.',
  2: 'Respondés sobre el calendario académico 2026: fechas de inscripción, períodos de exámenes, feriados y plazos administrativos.',
  3: 'Respondés sobre planes de estudio: asignaturas, correlativas, créditos y requisitos de egreso de cada carrera.',
  4: 'Respondés sobre infraestructura, grupos de WhatsApp, enlaces y contactos de la facultad.',
} as const satisfies Record<1 | 2 | 3 | 4, string>;

export type NumeroOpcionIA = keyof typeof INSTRUCCION_POR_OPCION;

/** Combina la instrucción base con la específica del dominio elegido. */
export function instruccionParaOpcion(opcion: NumeroOpcionIA): string {
  return `${INSTRUCCION_BASE}\n\n${INSTRUCCION_POR_OPCION[opcion]}`;
}

// ── Paso 1 de los horarios: elegir la materia ────────────────────────────────

/**
 * Emparejar "seguridad informatica" con "gestion de seguridad informatica y
 * seguridad en sistemas" es un problema de significado, no de letras en común:
 * ninguna búsqueda por texto lo resuelve bien. Se lo damos al modelo con el
 * catálogo entero (nombres, sin horarios) y después vamos a la base solo por
 * las clases de lo que eligió.
 */
export const INSTRUCCION_MATERIA = `Sos el buscador de materias de la Facultad de Ingeniería (UNMdP).

Te paso el CATÁLOGO de materias que tienen clases cargadas y lo que escribió un alumno. Elegí las del catálogo que correspondan a lo que pidió.

Reglas:
1. Emparejá por significado, no por parecido de letras. Ejemplo: "seguridad informatica" corresponde a "gestion de seguridad informatica y seguridad en sistemas".
2. Ignorá acentos, mayúsculas, abreviaturas y errores de tipeo del alumno.
3. Copiá los nombres EXACTAMENTE como figuran en el catálogo, carácter por carácter. No los corrijas, no los completes, no los reescribas.
4. Si el pedido abarca varias materias del catálogo (por ejemplo pide "análisis matemático" y están I, II y III), devolvelas todas, de la más probable a la menos.
5. Si ninguna materia del catálogo tiene que ver con lo que pidió, devolvé la lista vacía. Devolver una materia equivocada es peor que no devolver ninguna.
6. Como mucho 5 materias.`;

/** Arma el prompt del paso 1. Función pura: testeable sin llamar a la API. */
export function construirPromptDeMateria(consulta: ConsultaDeMateria): string {
  return [
    '## CATÁLOGO DE MATERIAS',
    consulta.catalogo.length > 0
      ? consulta.catalogo.map((materia) => `- ${materia}`).join('\n')
      : '(vacío)',
    '',
    '## LO QUE ESCRIBIÓ EL ALUMNO',
    consulta.consulta,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una agenda de dos días son ~120 líneas de clase. Con el tope viejo de 4.000
 * el listado se cortaba a la mitad y el modelo respondía "no está" sobre
 * materias que sí estaban, más abajo en el fragmento.
 */
export const MAX_CARACTERES_POR_DOCUMENTO = 16_000;

function renderDocumentos(documentos: FragmentoContexto[]): string {
  if (documentos.length === 0) {
    return 'No hay información disponible en la base de conocimiento para esta consulta.';
  }

  return documentos
    .map((doc, i) => {
      if (doc.archivoPdf) {
        return (
          `[${String(i + 1)}] ${doc.titulo}\nFuente: ${doc.url}\n` +
          '(El documento completo va adjunto a este mensaje como PDF: usalo como fuente principal.)'
        );
      }
      const contenido = doc.contenido.slice(0, MAX_CARACTERES_POR_DOCUMENTO);
      return `[${String(i + 1)}] ${doc.titulo}\nFuente: ${doc.url}\n${contenido}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Arma el prompt final. Función pura: testeable sin llamar a la API.
 */
export function construirPrompt(consulta: ConsultaIA): string {
  return [
    '## CONTEXTO (base de conocimiento de la Facultad)',
    renderDocumentos(consulta.documentos),
    '',
    '## CONSULTA ACTUAL',
    consulta.mensaje,
  ].join('\n');
}

/** Una parte de contenido inline (PDF, imagen) para el request a Gemini. */
export interface ParteDeArchivo {
  inlineData: { mimeType: string; data: string };
}

/**
 * Los PDFs que se adjuntan nativos, como partes aparte del prompt de texto.
 * Función pura: no toca disco ni la API, solo mapea lo que ya viene armado en
 * `FragmentoContexto.archivoPdf`.
 */
export function partesDeArchivos(documentos: FragmentoContexto[]): ParteDeArchivo[] {
  const partes: ParteDeArchivo[] = [];
  for (const doc of documentos) {
    if (doc.archivoPdf) {
      partes.push({
        inlineData: { mimeType: doc.archivoPdf.mimeType, data: doc.archivoPdf.datos },
      });
    }
  }
  return partes;
}

export function extraerFuentes(documentos: FragmentoContexto[]): string[] {
  return [...new Set(documentos.map((doc) => doc.url))];
}
