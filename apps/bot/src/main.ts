import { crearProveedorGemini, extraerBloqueLiteral, instruccionParaOpcion } from '@fi/ai';
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
  esPedidoDeTodo,
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
import { formatearRespuesta } from './respuesta.js';
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
import {
  MENSAJE_ERROR,
  MENSAJE_RATE_LIMIT,
  MENSAJE_SIN_CARRERAS,
  MENSAJE_SIN_PLANES_DE_CARRERA,
  PLACEHOLDER_CALENDARIO,
  PLACEHOLDER_CONSULTA_PLAN,
  RESUMEN_FACULTAD,
  TEXTO_CALENDARIO_SIN_FILTRO,
  TEXTO_PEDIDO_CALENDARIO,
  textoPlanElegido,
  textoPlanSinFiltro,
} from './textos.js';

const log = createLogger('bot');

const ia = crearProveedorGemini();

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

/**
 * Un doble tap manda dos callback_query casi simultáneos para el mismo
 * botón — con updates procesándose en paralelo (ver @fi/telegram), cada uno
 * dispara su propia ida y vuelta a Gemini y el alumno recibe la misma
 * respuesta dos veces. Solo aplica a botones (no a texto libre: repetir la
 * misma pregunta escrita puede ser intencional).
 */
const DEBOUNCE_BOTON_MS = 2_000;
const ultimoBotonPorJid = new Map<string, { opcion: string; en: number }>();

function esBotonDuplicado(mensaje: MensajeEntrante): boolean {
  if (!mensaje.opcionElegida) return false;

  const ahora = Date.now();
  const anterior = ultimoBotonPorJid.get(mensaje.jid);
  ultimoBotonPorJid.set(mensaje.jid, { opcion: mensaje.opcionElegida, en: ahora });

  return anterior?.opcion === mensaje.opcionElegida && ahora - anterior.en < DEBOUNCE_BOTON_MS;
}

async function responder(mensaje: MensajeEntrante, plataforma: string): Promise<Salida> {
  if (excedeLimite(mensaje.jid)) {
    log.warn({ jid: mensaje.jid }, 'Rate limit alcanzado');
    return MENSAJE_RATE_LIMIT;
  }

  const materia = materiaElegida(mensaje, materiasVigentes(mensaje.jid));
  const plan = planElegido(mensaje, planesVigentes(mensaje.jid));
  const carrera = carreraElegida(mensaje, carrerasVigentes(mensaje.jid));

  if (carrera) {
    const planes = await planesDeEstudio(carrera);
    if (planes.length === 0) return { texto: MENSAJE_SIN_PLANES_DE_CARRERA };
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
      texto: textoPlanElegido(plan),
      archivos: documentos.flatMap((documento) => (documento.archivo ? [documento.archivo] : [])),
      pedirTexto: { placeholder: PLACEHOLDER_CONSULTA_PLAN },
    };
  }

  // En Telegram la selección va siempre por menú (botones); el protocolo de
  // texto ("2 algo") solo hace falta en WhatsApp, que no tiene botones.
  const intencion = materia
    ? { tipo: 'consultar' as const, numero: 1 as const, consulta: materia }
    : interpretar(mensaje, opcionVigente(mensaje.jid), {
        protocoloDeTexto: plataforma !== 'telegram',
      });

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
        texto: TEXTO_PEDIDO_CALENDARIO,
        archivos: documento.archivo ? [documento.archivo] : [],
        pedirTexto: { placeholder: PLACEHOLDER_CALENDARIO },
      };
    }

    if (intencion.numero === 3) {
      const carreras = await carrerasDePlanes();
      if (carreras.length === 0) return { texto: MENSAJE_SIN_CARRERAS };
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
      if (carreras.length === 0) return { texto: MENSAJE_SIN_CARRERAS };
      recordarCarreras(mensaje.jid, carreras);
      return opcionesDeCarreras(carreras);
    }

    recordarPlanActivo(mensaje.jid, activo); // renueva el TTL mientras siga preguntando

    // Consulta vacía (p. ej. WhatsApp con solo "3", sin protocolo de botones):
    // el PDF completo ya se mandó al elegir el plan, no hace falta gastar una
    // consulta a la IA para repetir lo mismo. "-" no llega hasta acá: ya
    // resolvió a "menu" en interpretar().
    if (intencion.consulta === '') {
      return {
        texto: textoPlanSinFiltro(activo),
        opciones: botonesDeSeguimiento(),
        opcionesSoloEnBotones: true,
      };
    }

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

  // Consulta vacía en Calendario (p. ej. WhatsApp con solo "2"): el PDF
  // completo ya se mandó al elegir la opción, no hace falta gastar una
  // consulta a la IA para repetir lo mismo. "-" no llega hasta acá: ya
  // resolvió a "menu" en interpretar().
  if (intencion.numero === 2 && intencion.consulta === '') {
    olvidarMaterias(mensaje.jid);
    olvidarCarreras(mensaje.jid);
    olvidarPlanes(mensaje.jid);
    olvidarPlanActivo(mensaje.jid);
    return {
      texto: TEXTO_CALENDARIO_SIN_FILTRO,
      opciones: botonesDeSeguimiento(),
      opcionesSoloEnBotones: true,
    };
  }

  // "todo" en Información de la facultad: se responde directo con lo más
  // pedido, sin gastar una consulta a la IA. Es la única opción donde "todo"
  // no necesita ni siquiera leer el documento completo.
  if (intencion.numero === 4 && esPedidoDeTodo(intencion.consulta)) {
    olvidarMaterias(mensaje.jid);
    olvidarCarreras(mensaje.jid);
    olvidarPlanes(mensaje.jid);
    olvidarPlanActivo(mensaje.jid);
    return {
      texto: RESUMEN_FACULTAD,
      opciones: botonesDeSeguimiento(),
      opcionesSoloEnBotones: true,
    };
  }

  const documentos = await obtenerContextoDeOpcion(intencion.numero, intencion.consulta, ia);
  if (!Array.isArray(documentos)) {
    recordarMaterias(mensaje.jid, documentos.materias);
    return opcionesDeMaterias(documentos.materias, documentos.etiquetas);
  }
  olvidarMaterias(mensaje.jid);
  olvidarCarreras(mensaje.jid);
  olvidarPlanes(mensaje.jid);
  olvidarPlanActivo(mensaje.jid);

  // "todo" en Ingreso a Ingeniería: sí pasa por la IA (a diferencia de
  // Información de la facultad), pero con la pregunta genérica de siempre en
  // vez de preguntarle a Gemini "¿qué dice la guía sobre todo?".
  const intencionParaIA =
    intencion.numero === 5 && esPedidoDeTodo(intencion.consulta)
      ? { ...intencion, consulta: '' }
      : intencion;

  const respuesta = await ia.responder({
    mensaje: mensajeParaIA(intencionParaIA),
    documentos,
    instruccionSistema: instruccionParaOpcion(intencion.numero),
  });

  log.info(
    { jid: mensaje.jid, opcion: intencion.numero, contexto: documentos.length },
    'Consulta respondida',
  );

  return {
    texto: formatearRespuesta(respuesta, extraerBloqueLiteral(documentos)),
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

    if (esBotonDuplicado(mensaje)) {
      log.warn(
        { jid: mensaje.jid, plataforma, opcion: mensaje.opcionElegida },
        'Botón duplicado ignorado (doble tap)',
      );
      return undefined;
    }

    try {
      return await responder(mensaje, plataforma);
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
