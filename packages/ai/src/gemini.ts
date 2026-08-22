import { AiError, createLogger, env } from '@fi/core';
import { GoogleGenAI, Type } from '@google/genai';

import { EMBEDDING_DIMENSIONES, extraerVectores } from './embeddings.js';
import {
  construirPrompt,
  construirPromptDeMateria,
  extraerFuentes,
  INSTRUCCION_MATERIA,
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
      const prompt = construirPrompt(consulta);

      try {
        const respuesta = await cliente.models.generateContent({
          model: modelo,
          contents: prompt,
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

    async embeber(textos: string[]): Promise<number[][]> {
      if (textos.length === 0) return [];

      try {
        const respuesta = await cliente.models.embedContent({
          model: env.GEMINI_EMBEDDING_MODEL,
          contents: textos,
          config: {
            outputDimensionality: EMBEDDING_DIMENSIONES,
            taskType: 'RETRIEVAL_QUERY',
          },
        });

        const vectores = extraerVectores(respuesta);
        if (vectores.length !== textos.length) {
          throw new AiError(
            `Gemini devolvió ${String(vectores.length)} embeddings para ${String(textos.length)} textos`,
          );
        }

        log.debug(
          { modelo: env.GEMINI_EMBEDDING_MODEL, textos: textos.length },
          'Embeddings generados',
        );
        return vectores;
      } catch (error) {
        if (error instanceof AiError) throw error;
        throw new AiError('Falló el embedding de la consulta', error);
      }
    },
  };
}
