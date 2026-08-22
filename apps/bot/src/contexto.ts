import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RAIZ_MONOREPO } from '@fi/core';
import { db, FTS } from '@fi/db';
import { fechaEnZona, nombreDiaSemana, sumarDias } from '@fi/scrapper';
import { sql } from 'drizzle-orm';

import type { FragmentoContexto, ProveedorIA } from '@fi/ai';

import { validarContraCatalogo } from './materias.js';

/** Ventana de la agenda: es lo que trae el scrapeo diario. */
const DIAS_AGENDA = 7;
/** Cuántos días se vuelcan cuando el alumno no nombra ninguna materia. */
const DIAS_AGENDA_SIN_FILTRO = 2;

const MAX_CLASES_MATERIA = 60;
const MAX_CLASES_AGENDA = 200;
/**
 * Tope de seguridad, no un recorte esperado: son ~300 materias por semana y el
 * catálogo tiene que ir entero, porque es lo único con lo que el modelo elige.
 * Recortarlo sería volver a esconderle materias que sí se dictan.
 */
const MAX_MATERIAS_CATALOGO = 1_000;

export async function carrerasDePlanes(): Promise<string[]> {
  const { rows } = await db.execute<{ carrera: string }>(sql`
    SELECT DISTINCT carrera FROM planes_estudio ORDER BY carrera
  `);
  return rows.map((fila) => fila.carrera);
}

export async function planesDeEstudio(carrera: string): Promise<string[]> {
  const { rows } = await db.execute<{ etiqueta: string }>(sql`
    SELECT etiqueta FROM planes_estudio WHERE carrera = ${carrera} ORDER BY anio
  `);
  return rows.map((fila) => fila.etiqueta);
}

function arregloTexto(valores: string[]) {
  return sql`ARRAY[${sql.join(
    valores.map((valor) => sql`${valor}`),
    sql`, `,
  )}]::text[]`;
}

const FUENTE_SALAS = 'https://salas.fi.mdp.edu.ar/';
const FUENTE_FACULTAD = 'https://www.fi.mdp.edu.ar/';

// ── Horarios ─────────────────────────────────────────────────────────────────

interface FilaCursada extends Record<string, unknown> {
  fecha: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  materia: string;
  titulo_crudo: string;
  tipo: string;
  comision: string | null;
  aula: string;
}

export interface SeleccionDeMaterias {
  tipo: 'seleccion-materias';
  materias: string[];
}

const ETIQUETA_TIPO: Record<string, string> = {
  teoria: 'teoría',
  practica: 'práctica',
  teorico_practica: 'teórico-práctica',
  otro: '',
};

function describir(fila: FilaCursada): string {
  const dia = nombreDiaSemana(fila.dia_semana);
  const tipo = ETIQUETA_TIPO[fila.tipo] ?? '';
  const detalle = [tipo, fila.comision ? `comisión ${fila.comision}` : '']
    .filter(Boolean)
    .join(', ');

  return (
    `${fila.titulo_crudo} — ${dia} ${fila.fecha}, de ${fila.hora_inicio.slice(0, 5)} ` +
    `a ${fila.hora_fin.slice(0, 5)}, en ${fila.aula}${detalle ? ` (${detalle})` : ''}`
  );
}

const COLUMNAS = sql`fecha, dia_semana, hora_inicio, hora_fin, materia, titulo_crudo, tipo, comision, aula`;
/** Materia + título crudo: MRBS abrevia, y el crudo conserva lo que la normalización pierde. */
const TEXTO_BUSCABLE = sql`(materia || ' ' || titulo_crudo)`;

async function contarClases(desde: string, hasta: string): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql`
    SELECT count(*)::text AS total FROM cursadas WHERE fecha >= ${desde} AND fecha <= ${hasta}
  `);
  return Number(rows[0]?.total ?? 0);
}

async function agenda(desde: string, hasta: string): Promise<FilaCursada[]> {
  const { rows } = await db.execute<FilaCursada>(sql`
    SELECT ${COLUMNAS} FROM cursadas
    WHERE fecha >= ${desde} AND fecha <= ${hasta}
    ORDER BY fecha, hora_inicio
    LIMIT ${MAX_CLASES_AGENDA}
  `);
  return rows;
}

/**
 * Red de contención: busca el texto literal de la consulta, exigiendo todas sus
 * palabras. Solo corre si el modelo no reconoció ninguna materia, para que un
 * pedido que nombra la materia tal cual no dependa de que la IA acierte.
 */
async function porTodasLasPalabras(
  desde: string,
  hasta: string,
  consulta: string,
): Promise<FilaCursada[]> {
  const { rows } = await db.execute<FilaCursada>(sql`
    SELECT ${COLUMNAS} FROM cursadas
    WHERE fecha >= ${desde} AND fecha <= ${hasta}
      AND to_tsvector(${FTS}, ${TEXTO_BUSCABLE}) @@ plainto_tsquery(${FTS}, ${consulta})
    ORDER BY fecha, hora_inicio
    LIMIT ${MAX_CLASES_MATERIA}
  `);
  return rows;
}

/** Trae las clases de materias ya elegidas, por nombre exacto del catálogo. */
async function clasesDeMaterias(
  desde: string,
  hasta: string,
  materias: string[],
): Promise<FilaCursada[]> {
  const { rows } = await db.execute<FilaCursada>(sql`
    SELECT ${COLUMNAS} FROM cursadas
    WHERE fecha >= ${desde} AND fecha <= ${hasta}
      AND materia = ANY(${arregloTexto(materias)})
    ORDER BY fecha, hora_inicio
    LIMIT ${MAX_CLASES_MATERIA}
  `);
  return rows;
}

/** Los nombres de materia que sí tienen clases, para poder sugerir alternativas. */
async function catalogoDeMaterias(desde: string, hasta: string): Promise<string[]> {
  const { rows } = await db.execute<{ materia: string }>(sql`
    SELECT DISTINCT materia FROM cursadas
    WHERE fecha >= ${desde} AND fecha <= ${hasta}
    ORDER BY materia
    LIMIT ${MAX_MATERIAS_CATALOGO}
  `);
  return rows.map((fila) => fila.materia);
}

/**
 * Busca horarios en dos pasos, porque emparejar lo que escribe un alumno con el
 * nombre real de una materia es un problema de significado, no de texto:
 *
 * 1. Se le pasa al modelo el catálogo entero de materias con clases cargadas
 *    —solo los nombres, sin horarios— y elige cuál pidió. Así "seguridad
 *    informatica" cae en "gestion de seguridad informatica y seguridad en
 *    sistemas", que no comparte casi ninguna palabra con la consulta y que
 *    ninguna búsqueda por texto iba a encontrar.
 * 2. Recién con ese nombre exacto se van a buscar las clases a la base, y esas
 *    clases son el contexto con el que se arma la respuesta final.
 *
 * El fragmento **dice siempre qué encontró**: un contexto sin etiqueta se lee
 * como "esto es todo lo que hay" y termina en un "no tengo esa información"
 * que no ayuda a nadie.
 */
async function buscarHorarios(
  consulta: string,
  ia: ProveedorIA,
): Promise<FragmentoContexto[] | SeleccionDeMaterias> {
  const hoy = fechaEnZona(new Date());
  const hasta = sumarDias(hoy, DIAS_AGENDA);

  if ((await contarClases(hoy, hasta)) === 0) {
    return [
      {
        titulo: 'Horarios de cursadas: sin datos cargados',
        url: FUENTE_SALAS,
        contenido:
          `La base no tiene ninguna clase entre el ${hoy} y el ${hasta}. No es que la ` +
          'materia no exista: todavía no se cargaron los horarios de esas fechas.',
      },
    ];
  }

  if (consulta.length === 0) {
    const hastaCorto = sumarDias(hoy, DIAS_AGENDA_SIN_FILTRO);
    const filas = await agenda(hoy, hastaCorto);

    return [
      {
        titulo: `Agenda de clases del ${hoy} al ${hastaCorto}`,
        url: FUENTE_SALAS,
        contenido:
          'Clases de los próximos días. Hay más adelante en la semana: para verlas ' +
          `hay que nombrar la materia.\n\n${filas.map(describir).join('\n')}`,
      },
    ];
  }

  // Paso 1: el modelo elige, con el catálogo entero como única referencia.
  const catalogo = await catalogoDeMaterias(hoy, hasta);
  const propuestas = await ia.identificarMaterias({ consulta, catalogo });
  const elegidas = validarContraCatalogo(propuestas, catalogo);

  if (elegidas.length > 1) {
    return { tipo: 'seleccion-materias', materias: elegidas };
  }

  // Paso 2: recién ahora se van a buscar las clases.
  const filas =
    elegidas.length > 0
      ? await clasesDeMaterias(hoy, hasta, elegidas)
      : await porTodasLasPalabras(hoy, hasta, consulta);

  if (filas.length > 0) {
    // Sale de las filas y no de `elegidas` para que también sirva cuando la que
    // encontró la materia fue la red de contención.
    const materias = [...new Set(filas.map((fila) => fila.materia))];

    return [
      {
        titulo: `Horarios de ${materias.map((m) => `"${m}"`).join(', ')}`,
        url: FUENTE_SALAS,
        contenido:
          `El alumno escribió "${consulta}". En el sistema esa materia figura como ` +
          `${materias.map((m) => `"${m}"`).join(' y ')}. Si el nombre no es el que usó ` +
          `él, nombrásela completa al responder para que sepa cuál es.\n\n` +
          filas.map(describir).join('\n'),
      },
    ];
  }

  // Ninguna materia elegida: puede que no exista, o que el modelo no la haya
  // reconocido. Va el catálogo entero para que la respuesta final igual pueda
  // ofrecer lo más parecido en vez de cortar la conversación.
  return [
    {
      titulo: `SIN COINCIDENCIAS para "${consulta}"`,
      url: FUENTE_SALAS,
      contenido:
        `Ninguna materia con clases entre el ${hoy} y el ${hasta} corresponde a ` +
        `"${consulta}". Estas son todas las que sí se dictan en ese rango; si alguna se ` +
        `parece a lo que buscaba, sugerísela.\n\n${catalogo.map((m) => `- ${m}`).join('\n')}`,
    },
  ];
}

// ── Material: archivos leídos directo del disco ─────────────────────────────────

const MATERIAL_DIR = resolve(RAIZ_MONOREPO, 'material');

const MIME_PDF = 'application/pdf';

/**
 * PDF en base64, cacheado en memoria por ruta absoluta: los archivos de
 * material/ no cambian mientras el proceso corre, así que no tiene sentido
 * volver a leerlos en cada pregunta. Se cachea la promesa, no el resultado,
 * para que dos pedidos concurrentes al mismo archivo no disparen dos lecturas
 * en paralelo.
 *
 * Se manda el PDF entero, no el texto extraído: Gemini lo lee nativo (tablas,
 * columnas, layout) en vez de depender de una extracción de texto plano que
 * aplana justo lo que hace falta —créditos y correlativas en una tabla— para
 * responder bien.
 */
const cachePdf = new Map<string, Promise<string>>();

function pdfBase64(rutaAbsoluta: string): Promise<string> {
  let promesa = cachePdf.get(rutaAbsoluta);
  if (!promesa) {
    promesa = readFile(rutaAbsoluta).then((datos) => datos.toString('base64'));
    cachePdf.set(rutaAbsoluta, promesa);
  }
  return promesa;
}

export async function obtenerPlanDeEstudio(etiqueta: string): Promise<FragmentoContexto[]> {
  const { rows } = await db.execute<{ archivo: string }>(sql`
    SELECT archivo FROM planes_estudio WHERE etiqueta = ${etiqueta} LIMIT 1
  `);
  const fila = rows[0];
  if (!fila) return [];

  const ruta = resolve(MATERIAL_DIR, 'Plan de estudios', fila.archivo);
  const datos = await pdfBase64(ruta);

  return [
    {
      titulo: etiqueta,
      url: FUENTE_FACULTAD,
      contenido: etiqueta,
      archivo: { ruta, nombre: fila.archivo },
      archivoPdf: { datos, mimeType: MIME_PDF },
    },
  ];
}

const CALENDARIO_ARCHIVO = 'CALENDARIO ACADEMICO 2026.pdf';
const FACULTAD_ARCHIVO = 'Información de la facultad.txt';

let calendarioCache: Promise<FragmentoContexto> | undefined;

export function obtenerContenidoCalendario(): Promise<FragmentoContexto> {
  calendarioCache ??= (async () => {
    const ruta = resolve(MATERIAL_DIR, CALENDARIO_ARCHIVO);
    return {
      titulo: 'Calendario académico 2026',
      url: FUENTE_FACULTAD,
      contenido: 'Calendario académico 2026',
      archivo: { ruta, nombre: CALENDARIO_ARCHIVO },
      archivoPdf: { datos: await pdfBase64(ruta), mimeType: MIME_PDF },
    };
  })();
  return calendarioCache;
}

let facultadCache: Promise<FragmentoContexto> | undefined;

export function obtenerContenidoFacultad(): Promise<FragmentoContexto> {
  facultadCache ??= (async () => {
    const ruta = resolve(MATERIAL_DIR, FACULTAD_ARCHIVO);
    const contenido = await readFile(ruta, 'utf8');
    return { titulo: 'Información de la facultad', url: FUENTE_FACULTAD, contenido };
  })();
  return facultadCache;
}

// ── Router por opción de menú ─────────────────────────────────────────────────
//
// La opción 3 (plan de estudios) no pasa por acá: necesita el plan activo en
// sesión (qué carrera y versión eligió el alumno), y ese estado vive en
// main.ts junto con el resto de la sesión.

export async function obtenerContextoDeOpcion(
  opcion: 1 | 2 | 4,
  consulta: string,
  ia: ProveedorIA,
): Promise<FragmentoContexto[] | SeleccionDeMaterias> {
  switch (opcion) {
    case 1:
      return buscarHorarios(consulta, ia);
    case 2:
      return [await obtenerContenidoCalendario()];
    case 4:
      return [await obtenerContenidoFacultad()];
  }
}
