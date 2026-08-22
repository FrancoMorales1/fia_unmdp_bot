#!/usr/bin/env node
/**
 * Pobla la tabla `material` con el contenido de /material/.
 *
 * Prerrequisitos:
 *   1. La tabla `material` debe existir (correr pnpm db:migrate primero).
 *   2. pdf-parse debe estar instalado: pnpm add -D pdf-parse
 *
 * Uso:
 *   node scripts/seed-material.mjs
 *
 * El script es idempotente: borra todo lo que haya insertado antes (filas con
 * fuente != null) y vuelve a cargar desde los archivos. No toca filas creadas
 * manualmente (fuente IS NULL).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Cargar .env ──────────────────────────────────────────────────────────────

function cargarEnv(desde) {
  let dir = desde;
  for (;;) {
    const candidato = join(dir, '.env');
    if (existsSync(candidato)) {
      for (const linea of readFileSync(candidato, 'utf8').split('\n')) {
        const t = linea.trim();
        if (!t || t.startsWith('#')) continue;
        const idx = t.indexOf('=');
        if (idx === -1) continue;
        const key = t.slice(0, idx).trim();
        const val = t.slice(idx + 1).trim();
        if (!(key in process.env)) process.env[key] = val;
      }
      return;
    }
    const padre = dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
}

cargarEnv(__dirname);

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL no encontrada. Revisá el .env');
  process.exit(1);
}

// ── pdf-parse ─────────────────────────────────────────────────────────────────

let parsePdf;
try {
  const mod = await import('pdf-parse');
  if (typeof mod.default === 'function') {
    parsePdf = mod.default;
  } else if (mod.PDFParse) {
    parsePdf = async (datos) => {
      const parser = new mod.PDFParse({ data: datos });
      try {
        return await parser.getText();
      } finally {
        await parser.destroy();
      }
    };
  }

  if (!parsePdf) throw new Error('API de pdf-parse no reconocida');
} catch {
  console.error('❌ pdf-parse no está instalado. Corré: pnpm add -D pdf-parse');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const materialDir = resolve(__dirname, '../material');
const planDir = join(materialDir, 'Plan de estudios');
const calendarioPath = join(materialDir, 'CALENDARIO ACADEMICO 2026.pdf');
const calendarioUrl = 'https://owncloud.fi.mdp.edu.ar/index.php/s/Sq92zl0BUtI0IoQ/download';

const PLANES_REMOTOS = [
  ['ELÉCTRICA', 2003, 'zabb37vLwgJ89aN', 'JhbcIS4TolbT6I4'],
  ['ELECTROMECÁNICA', 2003, 'nrqBhqftudFA6oB', '6a1dpoXpgynjUJ5'],
  ['ELECTRÓNICA', 2003, 'AKbUzlWC1Qc5kTd', 'aIiSGA698CG2kWS'],
  ['ALIMENTOS', 2003, 'ZfsFfD1NCAlwGJF', 'LuM4QyXII4JvQeO'],
  ['MATERIALES', 2003, 'yVl2OoorvW9z2b0', 'xE1SIBlA8DqrehB'],
  ['INFORMATICA', 2010, 'U8NrFE7JuW1n9NM', 'KVytzKvEo3kNMxB'],
  ['COMPUTACIÓN', 2010, 'CtlYFYcqC74SYPy', 'Rt0MOBv7HIy6w9K'],
  ['QUÍMICA', 2003, '6mXc6PybYufM1NG', 'jPUWmYJlBPkDHO4'],
  ['MECÁNICA', 2003, 'w61tcaBSm3jtrFa', 'f4Y5j2cLvJkGyYt'],
  ['INDUSTRIAL', 2003, 'kbxNPK3vBcSt7mx', 'nR3AejOgxDrj2bZ'],
];

async function descargarPlan(carrera, anio, token) {
  const respuesta = await fetch(`https://owncloud.fi.mdp.edu.ar/index.php/s/${token}/download`);
  if (!respuesta.ok) {
    throw new Error(`No se pudo descargar ${carrera} ${anio}: HTTP ${respuesta.status}`);
  }

  const archivo = `PLAN ${String(anio)} - ${carrera}.pdf`;
  const ruta = join(planDir, archivo);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(ruta, Buffer.from(await respuesta.arrayBuffer()));
  return { archivo, ruta };
}

async function descargarCalendario() {
  const respuesta = await fetch(calendarioUrl);
  if (!respuesta.ok) {
    throw new Error(`No se pudo descargar el calendario académico: HTTP ${respuesta.status}`);
  }

  writeFileSync(calendarioPath, Buffer.from(await respuesta.arrayBuffer()));
  return calendarioPath;
}

/** Lee un PDF y devuelve su texto plano. */
async function leerPdf(ruta) {
  const data = await parsePdf(readFileSync(ruta));
  return data.text.trim();
}

/**
 * Normaliza el nombre de una carrera a partir del nombre del archivo PDF.
 * "Copia de DIR-ESTUD-Plan de Transición IINF-ANEXO I.pdf" → "IINF"
 * "PLAN 2010 - INGENIERÍA EN INFORMATICA.pdf" → "INGENIERÍA EN INFORMATICA (Plan 2010)"
 */
function nombreCarrera(archivo) {
  const sinExt = archivo.replace(/\.pdf$/i, '').trim();

  // Planes de transición: extraer el código de carrera
  const transicion = sinExt.match(/Plan de Transici[oó]n[- ]+([A-Z]+)/i);
  if (transicion) return transicion[1];

  // Planes 2003/2010/2024: "PLAN YYYY - NOMBRE"
  const planAnio = sinExt.match(/PLAN (\d+)\s*[-–]\s*(.+)/i);
  if (planAnio) return `${planAnio[2].trim()} (Plan ${planAnio[1]})`;

  // Planes con año en el nombre: "Plan de NOMBRE-YYYY-..."
  const planNombre = sinExt.match(/Plan de\s+(.+?)\s*[-–]/i);
  if (planNombre) return planNombre[1].trim();

  return sinExt;
}

// ── Recolectar filas ──────────────────────────────────────────────────────────

const filas = [];

// --- enlaces.txt ---
// Formato de cada línea: "Etiqueta: URL" (ignora TODO y líneas sin URL)
console.log('📄 Leyendo enlaces.txt...');
const enlacesRaw = readFileSync(join(materialDir, 'enlaces.txt'), 'utf8');
for (const linea of enlacesRaw.split('\n')) {
  const t = linea.trim();
  if (!t || t.startsWith('#') || t.toLowerCase().startsWith('todo')) continue;
  const match = t.match(/^(.+?):\s*(https?:\/\/.+)$/);
  if (!match) continue;
  filas.push({
    categoria: 'enlace',
    subcategoria: null,
    titulo: match[1].trim(),
    contenido: match[2].trim(),
    fuente: 'enlaces.txt',
  });
}
console.log(`   → ${filas.filter((f) => f.fuente === 'enlaces.txt').length} enlaces`);

// --- gruposwpp.txt ---
console.log('📄 Leyendo gruposwpp.txt...');
const gruposRaw = readFileSync(join(materialDir, 'gruposwpp.txt'), 'utf8');
for (const linea of gruposRaw.split('\n')) {
  const t = linea.trim();
  if (!t) continue;
  const match = t.match(/^(.+?):\s*(https?:\/\/.+)$/);
  if (!match) continue;
  filas.push({
    categoria: 'grupo_wpp',
    subcategoria: null,
    titulo: match[1].trim(),
    contenido: match[2].trim(),
    fuente: 'gruposwpp.txt',
  });
}
console.log(`   → ${filas.filter((f) => f.fuente === 'gruposwpp.txt').length} grupos`);

// --- infraestructura-facultad.txt ---
console.log('📄 Leyendo infraestructura-facultad.txt...');
const infraRaw = readFileSync(join(materialDir, 'infraestructura-facultad.txt'), 'utf8');
filas.push({
  categoria: 'infraestructura',
  subcategoria: null,
  titulo: 'Infraestructura de la Facultad de Ingeniería - UNMdP',
  contenido: infraRaw.trim(),
  fuente: 'infraestructura-facultad.txt',
});
console.log('   → 1 sección');

// --- Calendario académico PDF ---
console.log('📄 Leyendo calendario académico...');
const calPath = await descargarCalendario();
filas.push({
  categoria: 'calendario',
  subcategoria: '2026',
  titulo: 'Calendario Académico 2026 - Facultad de Ingeniería UNMdP',
  contenido: await leerPdf(calPath),
  fuente: 'OCA 638-25 CALENDARIO ACADEMICO 2026.pdf',
});
console.log('   → 1 documento');

// --- Planes de estudio PDFs ---
console.log('📄 Leyendo planes de estudio...');
let planesLeidos = 0;
for (const [carrera, anioViejo, tokenViejo, tokenNuevo] of PLANES_REMOTOS) {
  for (const [anio, token] of [
    [anioViejo, tokenViejo],
    [2024, tokenNuevo],
  ]) {
    const { archivo, ruta } = await descargarPlan(carrera, anio, token);
    const nombre = nombreCarrera(archivo);
    filas.push({
      categoria: 'plan_estudios',
      subcategoria: nombre,
      titulo: `Plan de estudios: ${nombre}`,
      contenido: await leerPdf(ruta),
      fuente: archivo,
    });
    console.log(`   ✓ ${nombre}`);
    planesLeidos++;
  }
}
console.log(`   → ${planesLeidos} planes`);

// ── RAG: trocear + embeddings ─────────────────────────────────────────────────

const { trocearDocumento } = await import('../packages/db/src/chunking.ts');

const EMBEDDING_DIMENSIONES = 768;
const EMBEDDING_LOTE = 20;

function literalDeVector(valores) {
  if (!Array.isArray(valores) || valores.length !== EMBEDDING_DIMENSIONES) {
    throw new Error(`Embedding inválido (${valores?.length ?? 0} dims)`);
  }
  return `[${valores.join(',')}]`;
}

async function embeberDocumentos(textos, apiKey, modelo) {
  const vectores = [];

  for (let i = 0; i < textos.length; i += EMBEDDING_LOTE) {
    const lote = textos.slice(i, i + EMBEDDING_LOTE);
    const respuesta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:batchEmbedContents?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: lote.map((texto) => ({
            model: `models/${modelo}`,
            content: { parts: [{ text: texto }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBEDDING_DIMENSIONES,
          })),
        }),
      },
    );

    if (!respuesta.ok) {
      throw new Error(`Embeddings HTTP ${respuesta.status}: ${await respuesta.text()}`);
    }

    const json = await respuesta.json();
    const loteVectores = (json.embeddings ?? []).map((e) => e.values);
    if (loteVectores.length !== lote.length) {
      throw new Error(
        `Gemini devolvió ${loteVectores.length} embeddings para ${lote.length} textos`,
      );
    }
    vectores.push(...loteVectores);
    console.log(`   → embeddings ${Math.min(i + lote.length, textos.length)}/${textos.length}`);
  }

  return vectores;
}

async function insertarTramos(client, materialId, titulo, contenido) {
  const tramos = trocearDocumento(titulo, contenido);
  for (const tramo of tramos) {
    await client.query(
      `INSERT INTO material_chunks (material_id, indice, titulo, contenido)
       VALUES ($1, $2, $3, $4)`,
      [materialId, tramo.indice, tramo.titulo, tramo.contenido],
    );
  }
  return tramos.length;
}

// ── Persistir ─────────────────────────────────────────────────────────────────

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Borrar solo filas cargadas por el script (las manuales tienen fuente NULL).
    // Los tramos se van con ON DELETE CASCADE.
    const { rowCount: borradas } = await client.query(
      'DELETE FROM material WHERE fuente IS NOT NULL',
    );
    console.log(`\n🗑  ${borradas ?? 0} filas anteriores eliminadas`);

    let tramosInsertados = 0;
    for (const fila of filas) {
      const insertado = await client.query(
        `INSERT INTO material (categoria, subcategoria, titulo, contenido, fuente)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [fila.categoria, fila.subcategoria, fila.titulo, fila.contenido, fila.fuente],
      );
      tramosInsertados += await insertarTramos(
        client,
        insertado.rows[0].id,
        fila.titulo,
        fila.contenido,
      );
    }

    const huérfanos = await client.query(
      `SELECT id, titulo, contenido FROM material m
       WHERE NOT EXISTS (SELECT 1 FROM material_chunks c WHERE c.material_id = m.id)`,
    );
    for (const fila of huérfanos.rows) {
      tramosInsertados += await insertarTramos(client, fila.id, fila.titulo, fila.contenido);
    }

    await client.query('COMMIT');
    console.log(`✅ ${filas.length} documentos y ${tramosInsertados} tramos insertados`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const modelo = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
  if (!apiKey) {
    console.log('ℹ️  GEMINI_API_KEY ausente: tramos sin embedding (la búsqueda usa solo FTS).');
  } else {
    const pendientes = await pool.query(
      `SELECT id, titulo, contenido FROM material_chunks WHERE embedding IS NULL ORDER BY id`,
    );
    if (pendientes.rows.length === 0) {
      console.log('ℹ️  No hay tramos pendientes de embedding.');
    } else {
      console.log(`\n🔢 Calculando embeddings de ${pendientes.rows.length} tramos...`);
      const textos = pendientes.rows.map((fila) => `${fila.titulo}\n${fila.contenido}`);
      const vectores = await embeberDocumentos(textos, apiKey, modelo);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < pendientes.rows.length; i++) {
          await client.query(`UPDATE material_chunks SET embedding = $1::vector WHERE id = $2`, [
            literalDeVector(vectores[i]),
            pendientes.rows[i].id,
          ]);
        }
        await client.query('COMMIT');
        console.log(`✅ ${pendientes.rows.length} embeddings guardados`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  }
} finally {
  await pool.end();
}
