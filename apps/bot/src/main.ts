import { crearProveedorGemini, instruccionParaOpcion } from '@fi/ai';
import {
  createLogger,
  env,
  type ClienteMensajeria,
  type MensajeEntrante,
  type Salida,
} from '@fi/core';
import { cerrarConexion } from '@fi/db';
import { crearClienteTelegram } from '@fi/telegram';
import { crearClienteWhatsapp } from '@fi/whatsapp';

import {
  carrerasDePlanes,
  obtenerContenidoCalendario,
  obtenerContextoDeOpcion,
  obtenerPlanDeEstudio,
  planesDeEstudio,
} from './contexto.js';
import {
  botonesDeSeguimiento,
  carreraElegida,
  COMANDOS,
  interpretar,
  materiaElegida,
  mensajeParaIA,
  menuInicial,
  opcionesDeMaterias,
  opcionesDeCarreras,
  opcionesDePlanes,
  planElegido,
  pedidoDeConsulta,
} from './menu.js';
import { formatearRespuesta, MENSAJE_ERROR } from './respuesta.js';
import { iniciarScraping } from './scraping.js';
import {
  olvidarMaterias,
  olvidarCarreras,
  olvidarPlanes,
  olvidarPlanActivo,
  olvidarOpcion,
  materiasVigentes,
  carrerasVigentes,
  planesVigentes,
  planActivoVigente,
  opcionVigente,
  recordarMaterias,
  recordarCarreras,
  recordarPlanes,
  recordarPlanActivo,
  recordarOpcion,
} from './sesion.js';

const log = createLogger('bot');

const ia = crearProveedorGemini();

const MENSAJE_RATE_LIMIT =
  'Estás enviando muchos mensajes seguidos. Esperá un momento y volvé a consultar.';

// Ventana deslizante en memoria: jid -> timestamps de mensajes recientes.
const marcasPorJid = new Map<string, number[]>();

function excedeLimite(jid: string): boolean {
  const ahora = Date.now();
  const ventanaMs = env.RATE_LIMIT_WINDOW_S * 1000;
  const marcas = (marcasPorJid.get(jid) ?? []).filter((t) => ahora - t < ventanaMs);

  if (marcas.length >= env.RATE_LIMIT_MAX) {
    marcasPorJid.set(jid, marcas);
    return true;
  }

  marcas.push(ahora);
  marcasPorJid.set(jid, marcas);
  return false;
}

async function responder(mensaje: MensajeEntrante): Promise<Salida> {
  if (excedeLimite(mensaje.jid)) {
    log.warn({ jid: mensaje.jid }, 'Rate limit alcanzado');
    return MENSAJE_RATE_LIMIT;
  }

  const materia = materiaElegida(mensaje, materiasVigentes(mensaje.jid));
  const plan = planElegido(mensaje, planesVigentes(mensaje.jid));
  const carrera = carreraElegida(mensaje, carrerasVigentes(mensaje.jid));

  if (carrera) {
    const planes = await planesDeEstudio(carrera);
    if (planes.length === 0) return { texto: 'No encontré planes para esa carrera.' };
    olvidarCarreras(mensaje.jid);
    olvidarPlanActivo(mensaje.jid);
    recordarPlanes(mensaje.jid, planes);
    return opcionesDePlanes(planes);
  }

  // Eligió versión del plan: ahora sí se sabe qué archivo es, se lo manda y se
  // le pide una pregunta real. `plan` queda en sesión como "plan activo" para
  // que esa pregunta (y las que sigan) no pierdan de vista cuál era.
  if (plan) {
    olvidarPlanes(mensaje.jid);
    recordarPlanActivo(mensaje.jid, plan);
    recordarOpcion(mensaje.jid, 3);
    const documentos = await obtenerPlanDeEstudio(plan);
    return {
      texto: `Plan de estudios: ${plan}.\n\n¿Sobre qué querés consultar? (créditos, correlativas, materias…)`,
      archivos: documentos.flatMap((documento) => (documento.archivo ? [documento.archivo] : [])),
      pedirTexto: { placeholder: 'Ej: cuántos créditos vale una materia' },
    };
  }

  const intencion = materia
    ? { tipo: 'consultar' as const, numero: 1 as const, consulta: materia }
    : interpretar(mensaje, opcionVigente(mensaje.jid));

  if (intencion.tipo === 'menu') {
    olvidarMaterias(mensaje.jid);
    olvidarCarreras(mensaje.jid);
    olvidarPlanes(mensaje.jid);
    olvidarPlanActivo(mensaje.jid);
    olvidarOpcion(mensaje.jid);
    return menuInicial(mensaje.nombre);
  }

  recordarOpcion(mensaje.jid, intencion.numero);

  // Eligió tema: se le abre la celda para que agregue contexto antes de buscar.
  if (intencion.tipo === 'pedir') {
    if (intencion.numero === 2) {
      const documento = await obtenerContenidoCalendario();
      return {
        texto:
          '🗓️ Calendario académico 2026\n\n¿Qué fecha o trámite estás buscando? Si querés ' +
          'ver todo, mandá un guión: -',
        archivos: documento.archivo ? [documento.archivo] : [],
        pedirTexto: { placeholder: 'Ej: inscripción a finales' },
      };
    }

    if (intencion.numero === 3) {
      const carreras = await carrerasDePlanes();
      if (carreras.length === 0) return { texto: 'No encontré carreras con planes cargados.' };
      recordarCarreras(mensaje.jid, carreras);
      return opcionesDeCarreras(carreras);
    }
    return pedidoDeConsulta(intencion.numero);
  }

  // Pregunta en texto libre sobre plan de estudios: se responde con el plan
  // activo de la sesión, no con una búsqueda genérica. Si no hay uno vigente
  // (venció el TTL, o alguien tipeó "3 informática" directo sin pasar por los
  // botones), se vuelve a mostrar el selector de carreras.
  if (intencion.numero === 3) {
    const activo = planActivoVigente(mensaje.jid);
    if (!activo) {
      const carreras = await carrerasDePlanes();
      if (carreras.length === 0) return { texto: 'No encontré carreras con planes cargados.' };
      recordarCarreras(mensaje.jid, carreras);
      return opcionesDeCarreras(carreras);
    }

    recordarPlanActivo(mensaje.jid, activo); // renueva el TTL mientras siga preguntando
    const documentos = await obtenerPlanDeEstudio(activo);
    const respuesta = await ia.responder({
      mensaje: mensajeParaIA(intencion),
      documentos,
      instruccionSistema: instruccionParaOpcion(3),
    });

    log.info({ jid: mensaje.jid, opcion: 3, plan: activo }, 'Consulta respondida');

    return {
      texto: formatearRespuesta(respuesta),
      opciones: botonesDeSeguimiento(),
      opcionesSoloEnBotones: true,
    };
  }

  const documentos = await obtenerContextoDeOpcion(intencion.numero, intencion.consulta, ia);
  if (!Array.isArray(documentos)) {
    recordarMaterias(mensaje.jid, documentos.materias);
    return opcionesDeMaterias(documentos.materias);
  }
  olvidarMaterias(mensaje.jid);
  olvidarCarreras(mensaje.jid);
  olvidarPlanes(mensaje.jid);
  olvidarPlanActivo(mensaje.jid);

  const respuesta = await ia.responder({
    mensaje: mensajeParaIA(intencion),
    documentos,
    instruccionSistema: instruccionParaOpcion(intencion.numero),
  });

  log.info(
    { jid: mensaje.jid, opcion: intencion.numero, contexto: documentos.length },
    'Consulta respondida',
  );

  return {
    texto: formatearRespuesta(respuesta),
    // Botones para saltar a otro tema sin volver al menú. En WhatsApp no se
    // muestran: repetir el menú entero abajo de cada respuesta es ruido.
    opciones: botonesDeSeguimiento(),
    opcionesSoloEnBotones: true,
  };
}

function manejadorMensaje(plataforma: string) {
  return async (mensaje: MensajeEntrante): Promise<Salida | undefined> => {
    log.info(
      {
        jid: mensaje.jid,
        plataforma,
        texto: mensaje.texto,
        opcionElegida: mensaje.opcionElegida,
      },
      'Solicitud recibida',
    );

    try {
      return await responder(mensaje);
    } catch (error) {
      log.error({ err: error, jid: mensaje.jid, plataforma }, 'No se pudo responder');
      return MENSAJE_ERROR;
    }
  };
}

const whatsapp = crearClienteWhatsapp({ onMensaje: manejadorMensaje('whatsapp') });

const telegram: ClienteMensajeria | undefined = env.TELEGRAM_BOT_TOKEN
  ? crearClienteTelegram({ onMensaje: manejadorMensaje('telegram'), comandos: COMANDOS })
  : undefined;

const scraping = await iniciarScraping();

async function apagar(senal: string): Promise<void> {
  log.info({ senal }, 'Apagando el bot');
  try {
    await whatsapp.desconectar();
    await telegram?.desconectar();
    await scraping.worker.close();
    await scraping.cola.close();
    await cerrarConexion();
  } catch (error) {
    log.error({ err: error }, 'Error durante el apagado');
  } finally {
    process.exit(0);
  }
}

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => void apagar(senal));
}

log.info({ entorno: env.NODE_ENV, modelo: env.GEMINI_MODEL }, 'Iniciando bot de la FI - UNMdP');

await whatsapp.conectar();

if (telegram) {
  await telegram.conectar();
} else {
  log.warn('TELEGRAM_BOT_TOKEN no configurado: bot de Telegram inactivo');
}
