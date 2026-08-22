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
import { archivosDeContexto, formatearRespuesta, MENSAJE_ERROR } from './respuesta.js';
import { iniciarScraping } from './scraping.js';
import {
  olvidarMaterias,
  olvidarCarreras,
  olvidarPlanes,
  olvidarOpcion,
  materiasVigentes,
  carrerasVigentes,
  planesVigentes,
  opcionVigente,
  recordarMaterias,
  recordarCarreras,
  recordarPlanes,
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
    recordarPlanes(mensaje.jid, planes);
    return opcionesDePlanes(planes);
  }

  const intencion = materia
    ? { tipo: 'consultar' as const, numero: 1 as const, consulta: materia }
    : plan
      ? { tipo: 'consultar' as const, numero: 3 as const, consulta: plan }
      : interpretar(mensaje, opcionVigente(mensaje.jid));

  if (intencion.tipo === 'menu') {
    olvidarMaterias(mensaje.jid);
    olvidarCarreras(mensaje.jid);
    olvidarPlanes(mensaje.jid);
    olvidarOpcion(mensaje.jid);
    return menuInicial(mensaje.nombre);
  }

  recordarOpcion(mensaje.jid, intencion.numero);

  // Eligió tema: se le abre la celda para que agregue contexto antes de buscar.
  if (intencion.tipo === 'pedir') {
    if (intencion.numero === 2) {
      const documentos = await obtenerContextoDeOpcion(2, '', ia);
      if (!Array.isArray(documentos)) return MENSAJE_ERROR;
      return {
        texto: 'Acá tenés el calendario académico 2026.',
        archivos: archivosDeContexto(documentos),
        opciones: botonesDeSeguimiento(),
        opcionesSoloEnBotones: true,
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

  const documentos = plan
    ? await obtenerPlanDeEstudio(plan)
    : await obtenerContextoDeOpcion(intencion.numero, intencion.consulta, ia);
  if (!Array.isArray(documentos)) {
    recordarMaterias(mensaje.jid, documentos.materias);
    return opcionesDeMaterias(documentos.materias);
  }
  olvidarMaterias(mensaje.jid);
  olvidarCarreras(mensaje.jid);
  olvidarPlanes(mensaje.jid);

  if (plan) {
    return {
      texto:
        `Acá tenés el plan de estudios. Si querés, preguntame por una materia, ` +
        'correlativa o requisito.',
      archivos: archivosDeContexto(documentos),
      opciones: botonesDeSeguimiento(),
    };
  }

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
    archivos: archivosDeContexto(documentos),
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
