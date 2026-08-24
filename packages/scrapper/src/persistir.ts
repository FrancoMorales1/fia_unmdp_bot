import { createLogger } from '@fi/core';
import { cursadas, db, type NuevaCursada } from '@fi/db';
import { inArray } from 'drizzle-orm';

import { buscarNombreCampus } from './mapeoCampus.js';

import type { ClaseScrapeada } from './types.js';

const log = createLogger('scrapper:db');

function aFila(clase: ClaseScrapeada): NuevaCursada {
  return {
    entryId: clase.entryId,
    fecha: clase.fecha,
    diaSemana: clase.diaSemana,
    horaInicio: clase.horaInicio,
    horaFin: clase.horaFin,
    materia: clase.materia,
    tituloCrudo: clase.tituloCrudo,
    nombreCampus: buscarNombreCampus(clase.materia) ?? null,
    tipo: clase.tipo,
    comision: clase.comision ?? null,
    aula: clase.aula,
    capacidad: clase.capacidad ?? null,
    scrapeadoEn: new Date(),
  };
}

/**
 * Reemplaza los horarios de las fechas scrapeadas.
 *
 * Va en una transacción y borra solo las fechas que se volvieron a traer: si una
 * clase se dio de baja en MRBS tiene que desaparecer, pero las fechas que no se
 * scrapearon (por ejemplo un día que falló) quedan intactas.
 */
export async function guardarHorarios(
  clases: ClaseScrapeada[],
  fechas: string[],
): Promise<{ insertadas: number }> {
  if (fechas.length === 0) return { insertadas: 0 };

  const filas = clases.map(aFila);

  await db.transaction(async (tx) => {
    await tx.delete(cursadas).where(inArray(cursadas.fecha, fechas));

    // Lotes para no armar un INSERT gigante con una semana entera.
    for (let i = 0; i < filas.length; i += 500) {
      await tx.insert(cursadas).values(filas.slice(i, i + 500));
    }
  });

  log.info({ fechas: fechas.length, insertadas: filas.length }, 'Horarios actualizados');
  return { insertadas: filas.length };
}
