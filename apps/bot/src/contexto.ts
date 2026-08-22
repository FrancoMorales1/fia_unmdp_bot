import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  db,
  FTS,
  fusionarPorRRF,
  origenDeHallazgo,
  tituloDeHallazgo,
  tsqueryOr,
  vectorALiteral,
} from '@fi/db';
import { fechaEnZona, nombreDiaSemana, sumarDias } from '@fi/scrapper';
import { sql } from 'drizzle-orm';

import type { FragmentoContexto, ProveedorIA } from '@fi/ai';

import { validarContraCatalogo } from './materias.js';

import type { NumeroOpcion } from './menu.js';

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
const MAX_FRAGMENTOS_MATERIAL = 5;
const MAX_CANDIDATOS_RAG = 8;
const MAX_TITULOS_MATERIAL = 50;

function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export async function carrerasDePlanes(): Promise<string[]> {
  const { rows } = await db.execute<{ carrera: string }>(sql`
    SELECT DISTINCT regexp_replace(subcategoria, '\\s+\\(Plan\\s+\\d+\\)$', '', 'i') AS carrera
    FROM material
    WHERE categoria = 'plan_estudios' AND subcategoria IS NOT NULL
    ORDER BY carrera
  `);

  const carreras = new Map<string, string>();
  for (const fila of rows) {
    const clave = normalizarTexto(fila.carrera);
    if (!carreras.has(clave)) carreras.set(clave, fila.carrera);
  }
  return [...carreras.values()];
}

export async function planesDeEstudio(carrera: string): Promise<string[]> {
  const { rows } = await db.execute<{ plan: string }>(sql`
    SELECT DISTINCT subcategoria AS plan
    FROM material
    WHERE categoria = 'plan_estudios'
      AND subcategoria IS NOT NULL
      AND translate(
        lower(regexp_replace(subcategoria, '\\s+\\(Plan\\s+\\d+\\)$', '', 'i')),
        'áéíóúüñ', 'aeiouun'
      ) = translate(lower(${carrera}), 'áéíóúüñ', 'aeiouun')
    ORDER BY plan
  `);
  return rows.map((fila) => fila.plan);
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

// ── Material ──────────────────────────────────────────────────────────────────

interface FilaMaterial extends Record<string, unknown> {
  titulo: string;
  contenido: string;
  categoria: string;
  fuente: string | null;
}

const TEXTO_MATERIAL = sql`(titulo || ' ' || contenido)`;

/**
 * El documento padre (un PDF entero) solo se usa cuando no hay consulta —el
 * alumno mandó "-" y quiere el archivo— o como fallback si todavía no se
 * indexaron tramos. Con una pregunta se buscan `material_chunks`.
 */
function aFragmento(fila: FilaMaterial): FragmentoContexto {
  const esArchivoAdjunto = fila.categoria === 'plan_estudios' || fila.categoria === 'calendario';

  return {
    titulo: fila.titulo,
    url: FUENTE_FACULTAD,
    contenido: fila.contenido,
    ...(esArchivoAdjunto && fila.fuente
      ? {
          archivo: {
            ruta: resolve(
              fileURLToPath(new URL('../../../material/', import.meta.url)),
              fila.fuente,
            ),
            nombre: fila.fuente,
          },
        }
      : {}),
  };
}

interface FilaChunk extends Record<string, unknown> {
  id: string;
  titulo: string;
  contenido: string;
  categoria: string;
  fuente: string | null;
}

function aFragmentoChunk(fila: FilaChunk, titulo: string): FragmentoContexto {
  const esArchivoAdjunto = fila.categoria === 'plan_estudios' || fila.categoria === 'calendario';

  return {
    titulo,
    url: FUENTE_FACULTAD,
    contenido: fila.contenido,
    ...(esArchivoAdjunto && fila.fuente
      ? {
          archivo: {
            ruta: resolve(
              fileURLToPath(new URL('../../../material/', import.meta.url)),
              fila.fuente,
            ),
            nombre: fila.fuente,
          },
        }
      : {}),
  };
}

async function hayTramos(categorias: string[]): Promise<boolean> {
  const { rows } = await db.execute<{ total: string }>(sql`
    SELECT count(*)::text AS total
    FROM material_chunks c
    JOIN material m ON m.id = c.material_id
    WHERE m.categoria = ANY(${arregloTexto(categorias)})
  `);
  return Number(rows[0]?.total ?? 0) > 0;
}

async function buscarChunksFts(
  categorias: string[],
  consulta: string,
  modo: 'exacto' | 'parcial',
): Promise<FilaChunk[]> {
  const texto = sql`(c.titulo || ' ' || c.contenido)`;

  if (modo === 'exacto') {
    const { rows } = await db.execute<FilaChunk>(sql`
      SELECT c.id, c.titulo, c.contenido, m.categoria, m.fuente
      FROM material_chunks c
      JOIN material m ON m.id = c.material_id
      WHERE m.categoria = ANY(${arregloTexto(categorias)})
        AND to_tsvector(${FTS}, ${texto}) @@ plainto_tsquery(${FTS}, ${consulta})
      ORDER BY ts_rank(to_tsvector(${FTS}, ${texto}), plainto_tsquery(${FTS}, ${consulta})) DESC
      LIMIT ${MAX_CANDIDATOS_RAG}
    `);
    return rows;
  }

  const tsq = tsqueryOr(consulta);
  if (!tsq) return [];

  const { rows } = await db.execute<FilaChunk>(sql`
    SELECT c.id, c.titulo, c.contenido, m.categoria, m.fuente
    FROM material_chunks c
    JOIN material m ON m.id = c.material_id
    WHERE m.categoria = ANY(${arregloTexto(categorias)})
      AND to_tsvector(${FTS}, ${texto}) @@ to_tsquery(${FTS}, ${tsq})
    ORDER BY ts_rank(to_tsvector(${FTS}, ${texto}), to_tsquery(${FTS}, ${tsq})) DESC
    LIMIT ${MAX_CANDIDATOS_RAG}
  `);
  return rows;
}

async function buscarChunksVector(categorias: string[], embedding: number[]): Promise<FilaChunk[]> {
  const literal = vectorALiteral(embedding);
  const { rows } = await db.execute<FilaChunk>(sql`
    SELECT c.id, c.titulo, c.contenido, m.categoria, m.fuente
    FROM material_chunks c
    JOIN material m ON m.id = c.material_id
    WHERE m.categoria = ANY(${arregloTexto(categorias)})
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${MAX_CANDIDATOS_RAG}
  `);
  return rows;
}

async function embeddingDeConsulta(
  consulta: string,
  ia: ProveedorIA,
): Promise<number[] | undefined> {
  try {
    const [vector] = await ia.embeber([consulta]);
    return vector;
  } catch {
    return undefined;
  }
}

function sinCoincidenciasMaterial(consulta: string, titulos: string[]): FragmentoContexto[] {
  return [
    {
      titulo: tituloDeHallazgo('', 'ninguno', consulta),
      url: FUENTE_FACULTAD,
      contenido:
        `No hay nada sobre "${consulta}" en esta parte de la base de conocimiento. Los ` +
        'documentos disponibles son estos; si alguno cubre lo que preguntó el alumno, ' +
        'ofrecéselo, y si no, decile que ese dato todavía no está cargado.\n\n' +
        titulos.map((titulo) => `- ${titulo}`).join('\n'),
    },
  ];
}

/**
 * RAG del material: FTS sobre tramos + k-NN de embeddings, fusionados con RRF.
 * Si todavía no hay tramos (seed viejo), cae a la búsqueda por documento entero.
 */
async function buscarEnMaterial(
  categorias: string[],
  consulta: string,
  ia: ProveedorIA,
): Promise<FragmentoContexto[]> {
  if (consulta.length === 0) {
    const { rows } = await db.execute<FilaMaterial>(sql`
      SELECT categoria, titulo, contenido, fuente FROM material
      WHERE categoria = ANY(${arregloTexto(categorias)})
      LIMIT ${MAX_FRAGMENTOS_MATERIAL}
    `);
    return rows.map(aFragmento);
  }

  if (await hayTramos(categorias)) {
    const exactas = await buscarChunksFts(categorias, consulta, 'exacto');
    const parciales =
      exactas.length > 0 ? [] : await buscarChunksFts(categorias, consulta, 'parcial');
    const embedding = await embeddingDeConsulta(consulta, ia);
    const semanticos = embedding ? await buscarChunksVector(categorias, embedding) : [];

    const ids = fusionarPorRRF(
      [exactas.map((f) => f.id), parciales.map((f) => f.id), semanticos.map((f) => f.id)],
      MAX_FRAGMENTOS_MATERIAL,
    );
    const porId = new Map([...exactas, ...parciales, ...semanticos].map((fila) => [fila.id, fila]));
    const idsExactos = new Set(exactas.map((f) => f.id));
    const idsParciales = new Set(parciales.map((f) => f.id));
    const idsSemanticos = new Set(semanticos.map((f) => f.id));

    const fragmentos = ids.flatMap((id) => {
      const fila = porId.get(id);
      if (!fila) return [];
      const origen = origenDeHallazgo({
        exacto: idsExactos.has(id),
        parcial: idsParciales.has(id),
        semantico: idsSemanticos.has(id),
      });
      return [aFragmentoChunk(fila, tituloDeHallazgo(fila.titulo, origen, consulta))];
    });
    if (fragmentos.length > 0) return fragmentos;

    const { rows: titulos } = await db.execute<{ titulo: string }>(sql`
      SELECT titulo FROM material
      WHERE categoria = ANY(${arregloTexto(categorias)})
      ORDER BY titulo
      LIMIT ${MAX_TITULOS_MATERIAL}
    `);
    return sinCoincidenciasMaterial(
      consulta,
      titulos.map((fila) => fila.titulo),
    );
  }

  const exactas = await db.execute<FilaMaterial>(sql`
    SELECT categoria, titulo, contenido, fuente FROM material
    WHERE categoria = ANY(${arregloTexto(categorias)})
      AND to_tsvector(${FTS}, ${TEXTO_MATERIAL}) @@ plainto_tsquery(${FTS}, ${consulta})
    ORDER BY ts_rank(to_tsvector(${FTS}, ${TEXTO_MATERIAL}), plainto_tsquery(${FTS}, ${consulta})) DESC
    LIMIT ${MAX_FRAGMENTOS_MATERIAL}
  `);
  if (exactas.rows.length > 0) return exactas.rows.map(aFragmento);

  const tsq = tsqueryOr(consulta);
  if (tsq) {
    const parciales = await db.execute<FilaMaterial>(sql`
      SELECT categoria, titulo, contenido, fuente FROM material
      WHERE categoria = ANY(${arregloTexto(categorias)})
        AND to_tsvector(${FTS}, ${TEXTO_MATERIAL}) @@ to_tsquery(${FTS}, ${tsq})
      ORDER BY ts_rank(to_tsvector(${FTS}, ${TEXTO_MATERIAL}), to_tsquery(${FTS}, ${tsq})) DESC
      LIMIT ${MAX_FRAGMENTOS_MATERIAL}
    `);
    if (parciales.rows.length > 0) return parciales.rows.map(aFragmento);
  }

  const { rows: titulos } = await db.execute<{ titulo: string }>(sql`
    SELECT titulo FROM material
    WHERE categoria = ANY(${arregloTexto(categorias)})
    ORDER BY titulo
    LIMIT ${MAX_TITULOS_MATERIAL}
  `);

  return sinCoincidenciasMaterial(
    consulta,
    titulos.map((fila) => fila.titulo),
  );
}

export async function obtenerPlanDeEstudio(plan: string): Promise<FragmentoContexto[]> {
  const { rows } = await db.execute<FilaMaterial>(sql`
    SELECT categoria, titulo, contenido, fuente FROM material
    WHERE categoria = 'plan_estudios' AND subcategoria = ${plan}
    LIMIT 1
  `);
  return rows.map(aFragmento);
}

// ── Router por opción de menú ─────────────────────────────────────────────────

export async function obtenerContextoDeOpcion(
  opcion: NumeroOpcion,
  consulta: string,
  ia: ProveedorIA,
): Promise<FragmentoContexto[] | SeleccionDeMaterias> {
  switch (opcion) {
    case 1:
      return buscarHorarios(consulta, ia);
    case 2:
      return buscarEnMaterial(['calendario'], consulta, ia);
    case 3:
      return buscarEnMaterial(['plan_estudios'], consulta, ia);
    case 4:
      return buscarEnMaterial(['infraestructura', 'enlace', 'grupo_wpp'], consulta, ia);
  }
}
