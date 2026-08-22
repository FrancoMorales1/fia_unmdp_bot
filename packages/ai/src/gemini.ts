import { AiError, createLogger, env } from '@fi/core';
import { GoogleGenAI, Type } from '@google/genai';

import {
  construirPrompt,
  construirPromptDeMateria,
  extraerFuentes,
  INSTRUCCION_MATERIA,
  partesDeArchivos,
} from './prompt.js';

import type { ConsultaDeMateria, ConsultaIA, ProveedorIA, RespuestaIA } from './types.js';

const log = createLogger('ai');

/**
 * El paso 1 devuelve JSON, no prosa: `responseSchema` le saca al modelo la
 * posibilidad de contestar "creo que se refiere a…" y ahorra tener que parsear
 * texto libre.
 */
const ESQUEMA_MATERIAS = {
  type: Type.OBJECT,
  properties: {
    materias: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Nombres del catálogo, copiados tal cual, de más a menos probable.',
    },
  },
  required: ['materias'],
};

/** Solo se aceptan strings: si el modelo devuelve otra cosa, se descarta. */
function leerMaterias(json: string): string[] {
  const datos: unknown = JSON.parse(json);
  if (typeof datos !== 'object' || datos === null) return [];

  const materias = (datos as { materias?: unknown }).materias;
  if (!Array.isArray(materias)) return [];

  return materias.filter((m): m is string => typeof m === 'string');
}

export function crearProveedorGemini(
  opciones: { apiKey?: string; modelo?: string } = {},
): ProveedorIA {
  const modelo = opciones.modelo ?? env.GEMINI_MODEL;
  const cliente = new GoogleGenAI({ apiKey: opciones.apiKey ?? env.GEMINI_API_KEY });

  return {
    async responder(consulta: ConsultaIA): Promise<RespuestaIA> {
      // Los documentos con PDF nativo (calendario, planes de estudio) van como
      // partes aparte del prompt de texto: Gemini los lee directo, con tablas
      // y layout, en vez de depender de texto ya extraído.
      const contents = [construirPrompt(consulta), ...partesDeArchivos(consulta.documentos)];

      try {
        const respuesta = await cliente.models.generateContent({
          model: modelo,
          contents,
          config: {
            systemInstruction: consulta.instruccionSistema,
            temperature: 0.2,
            maxOutputTokens: 1_024,
          },
        });

        const texto = respuesta.text?.trim();
        if (!texto) throw new AiError('Gemini devolvió una respuesta vacía');

        log.debug({ modelo, documentos: consulta.documentos.length }, 'Respuesta generada');

        return { texto, fuentes: extraerFuentes(consulta.documentos), modelo };
      } catch (error) {
        if (error instanceof AiError) throw error;
        throw new AiError('Falló la consulta a Gemini', error);
      }
    },

    async identificarMaterias(consulta: ConsultaDeMateria): Promise<string[]> {
      if (consulta.catalogo.length === 0) return [];

      try {
        const respuesta = await cliente.models.generateContent({
          model: modelo,
          contents: construirPromptDeMateria(consulta),
          config: {
            systemInstruction: INSTRUCCION_MATERIA,
            // Elegir de una lista cerrada no tiene por qué variar entre consultas.
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: ESQUEMA_MATERIAS,
            maxOutputTokens: 2_048,
          },
        });

        const json = respuesta.text?.trim();
        if (!json) throw new AiError('Gemini no devolvió ninguna materia');

        const materias = leerMaterias(json);
        log.debug({ consulta: consulta.consulta, materias }, 'Materias identificadas');

        return materias;
      } catch (error) {
        if (error instanceof AiError) throw error;
        throw new AiError('Falló la identificación de la materia', error);
      }
    },
  };
}
