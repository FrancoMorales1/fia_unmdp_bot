import { createLogger, env } from '@fi/core';
import { crearCola, crearWorker, NOMBRES_COLA, type JobScraping } from '@fi/queue';
import { actualizarHorarios } from '@fi/scrapper';
import { type Queue, type Worker } from 'bullmq';

const log = createLogger('bot:scraping');

const ID_PROGRAMADO = 'horarios-diario';

/**
 * Deja andando el refresco diario de horarios.
 *
 * `upsertJobScheduler` es idempotente: si el bot se reinicia diez veces, el cron
 * sigue siendo uno solo. Si cambia `SCRAPPER_CRON`, se reemplaza el anterior.
 */
export async function iniciarScraping(): Promise<{ cola: Queue<JobScraping>; worker: Worker }> {
  const cola = crearCola(NOMBRES_COLA.scraping);

  const worker = crearWorker(
    NOMBRES_COLA.scraping,
    async (job) => {
      log.info({ jobId: job.id }, 'Actualizando horarios');

      const resultado = await actualizarHorarios({
        ...(job.data.dias === undefined ? {} : { dias: job.data.dias }),
        ...(job.data.area === undefined ? {} : { area: job.data.area }),
      });

      if (resultado.fallidas.length > 0) {
        log.warn({ fallidas: resultado.fallidas }, 'Quedaron días sin actualizar');
      }

      log.info(resultado, 'Horarios actualizados');
      return resultado;
    },
    // `guardarHorarios` borra e inserta en una sola transacción por fechas:
    // dos corridas en paralelo pisan la misma ventana de fechas y chocan con
    // la unique de (entry_id, fecha). Nunca tiene sentido scrapear en paralelo
    // con uno mismo, así que va serializado.
    { concurrency: 1 },
  );

  await cola.upsertJobScheduler(
    ID_PROGRAMADO,
    { pattern: env.SCRAPPER_CRON, tz: env.SCRAPPER_TZ },
    { name: 'refrescar-horarios', data: {} },
  );

  log.info({ cron: env.SCRAPPER_CRON, tz: env.SCRAPPER_TZ }, 'Scraping diario programado');

  if (env.SCRAPPER_AL_INICIAR) {
    log.info('SCRAPPER_AL_INICIAR activo: se encola una corrida ahora');
    await cola.add('refrescar-horarios', {});
  }

  return { cola, worker };
}
