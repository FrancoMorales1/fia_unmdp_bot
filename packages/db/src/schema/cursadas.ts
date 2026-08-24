import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** MRBS marca el tipo entre paréntesis en el título: (T), (P), (TP). */
export const tipoClase = pgEnum('tipo_clase', ['teoria', 'practica', 'teorico_practica', 'otro']);

/**
 * Una clase concreta en una fecha concreta, tal como figura en el sistema de
 * salas de la Facultad (MRBS). Es la única base de conocimiento del bot.
 */
export const cursadas = pgTable(
  'cursadas',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Id de la reserva en MRBS. Junto con la fecha identifica la clase. */
    entryId: text('entry_id').notNull(),

    fecha: date('fecha').notNull(),
    /** 0 = domingo … 6 = sábado. Redundante con `fecha`, pero evita EXTRACT en cada consulta. */
    diaSemana: smallint('dia_semana').notNull(),
    horaInicio: time('hora_inicio').notNull(),
    horaFin: time('hora_fin').notNull(),

    /** Materia ya normalizada, sin el tipo ni la comisión: "analisis matematico i". */
    materia: text('materia').notNull(),
    /** El título crudo de MRBS, por si la normalización se comió algo. */
    tituloCrudo: text('titulo_crudo').notNull(),
    /**
     * Nombre de la cursada tal como lo ve el alumno en el campus virtual
     * (mapeo estático en @fi/scrapper, ver mapping/README.md). Nulo cuando
     * `materia` no matcheó contra ese catálogo.
     */
    nombreCampus: text('nombre_campus'),
    tipo: tipoClase('tipo').notNull(),
    /** Comisión declarada en el título: "A1", "A2", "TM"… */
    comision: text('comision'),

    aula: text('aula').notNull(),
    capacidad: integer('capacidad'),

    scrapeadoEn: timestamp('scrapeado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Una misma reserva puede repetirse en varias fechas (es una serie semanal),
    // pero nunca dos veces en la misma fecha.
    uniqueIndex('cursadas_entry_fecha_idx').on(table.entryId, table.fecha),
    index('cursadas_fecha_idx').on(table.fecha, table.horaInicio),
    // Búsqueda insensible a acentos (config creada en la migración 0002) sobre
    // materia + título crudo: MRBS abrevia, y el crudo conserva lo abreviado.
    index('cursadas_busqueda_idx').using(
      'gin',
      sql`to_tsvector('public.espanol_sin_acentos', ${table.materia} || ' ' || ${table.tituloCrudo})`,
    ),
  ],
);

export type Cursada = typeof cursadas.$inferSelect;
export type NuevaCursada = typeof cursadas.$inferInsert;
