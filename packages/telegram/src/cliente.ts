import { createServer, type Server } from 'node:http';

import { createLogger, env, TelegramError } from '@fi/core';
import { Bot, InputFile, webhookCallback } from 'grammy';

import type { ClienteMensajeria, ManejadorMensaje, MensajeEntrante, Salida } from '@fi/core';

import { marcadoDeRespuesta } from './teclado.js';

const log = createLogger('telegram');

/** Un comando del menú azul de Telegram (el botón "/" al lado del campo de texto). */
export interface ComandoTelegram {
  comando: string;
  descripcion: string;
}

/**
 * Puertos que Telegram acepta para webhooks. No es una limitación nuestra:
 * la API la rechaza directamente si el puerto no es uno de estos.
 * https://core.telegram.org/bots/api#setwebhook
 */
export const PUERTOS_WEBHOOK_VALIDOS = [443, 80, 88, 8443] as const;

export interface OpcionesWebhook {
  /** URL pública HTTPS completa donde Telegram va a mandar los updates. */
  url: string;
  /** Puerto local donde escuchar. Tiene que ser uno de PUERTOS_WEBHOOK_VALIDOS. */
  puerto: number;
  /**
   * Se manda como header `X-Telegram-Bot-Api-Secret-Token` en cada request y
   * se valida contra él: sin esto, cualquiera que adivine la URL puede
   * mandar updates falsos como si fueran de Telegram.
   */
  secretToken?: string;
}

export interface OpcionesCliente {
  onMensaje: ManejadorMensaje;
  /** Token del bot de Telegram. Si se omite se usa TELEGRAM_BOT_TOKEN del entorno. */
  token?: string;
  /** Si es true responde mensajes de grupos. Por defecto solo chats privados. */
  responderGrupos?: boolean;
  /** Se publican con setMyCommands al conectar. */
  comandos?: ComandoTelegram[];
  /** Si se pasa, conecta por webhook. Si no, hace long polling (bot.start()). */
  webhook?: OpcionesWebhook;
}

export function crearClienteTelegram(opciones: OpcionesCliente): ClienteMensajeria {
  const token = opciones.token ?? env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new TelegramError('TELEGRAM_BOT_TOKEN no está configurado');
  }

  const responderGrupos = opciones.responderGrupos ?? false;
  const bot = new Bot(token);
  let servidorHttp: Server | undefined;

  bot.catch = (error) => {
    log.error({ err: error }, 'Error no controlado en Telegram');
  };

  async function enviarMensaje(jid: string, salida: Salida): Promise<void> {
    const texto = typeof salida === 'string' ? salida : salida.texto;
    const marcado = typeof salida === 'string' ? undefined : marcadoDeRespuesta(salida);

    if (typeof salida !== 'string') {
      for (const archivo of salida.archivos ?? []) {
        await bot.api.sendDocument(Number(jid), new InputFile(archivo.ruta), {
          caption: archivo.nombre,
        });
      }
    }

    if (texto.trim()) {
      await bot.api.sendMessage(Number(jid), texto, marcado ? { reply_markup: marcado } : {});
    }
  }

  async function procesar(mensaje: MensajeEntrante): Promise<void> {
    try {
      const respuesta = await opciones.onMensaje(mensaje);
      if (respuesta) await enviarMensaje(mensaje.jid, respuesta);
    } catch (error) {
      log.error({ err: error, jid: mensaje.jid }, 'Falló el procesamiento del mensaje');
    }
  }

  bot.on('message:text', async (ctx) => {
    const enGrupo = ctx.chat.type !== 'private';
    if (enGrupo && !responderGrupos) return;

    await procesar({
      jid: String(ctx.chat.id),
      nombre: ctx.from.first_name,
      texto: ctx.message.text,
      esGrupo: enGrupo,
      recibidoEn: new Date(ctx.message.date * 1000),
      // Lo que el usuario escribió en la celda viene como respuesta al mensaje
      // que la abrió: ese texto es el que dice de qué opción se trata.
      respondeA: ctx.message.reply_to_message?.text,
    });
  });

  bot.on('callback_query:data', async (ctx) => {
    const chat = ctx.chat ?? ctx.from;
    const enGrupo = ctx.chat !== undefined && ctx.chat.type !== 'private';
    if (enGrupo && !responderGrupos) return;

    // Telegram rechaza callbacks vencidos; no deben detener el polling.
    try {
      await ctx.answerCallbackQuery();
    } catch (error) {
      log.warn({ err: error }, 'No se pudo confirmar un botón antiguo de Telegram');
    }

    await procesar({
      jid: String(chat.id),
      nombre: ctx.from.first_name,
      texto: '',
      esGrupo: enGrupo,
      recibidoEn: new Date(),
      opcionElegida: ctx.callbackQuery.data,
    });
  });

  async function registrarComandos(): Promise<void> {
    if (!opciones.comandos || opciones.comandos.length === 0) return;

    try {
      await bot.api.setMyCommands(
        opciones.comandos.map(({ comando, descripcion }) => ({
          command: comando,
          description: descripcion,
        })),
      );
    } catch (error) {
      log.warn({ err: error }, 'No se pudieron registrar los comandos de Telegram');
    }
  }

  async function conectarPorWebhook({ url, puerto, secretToken }: OpcionesWebhook): Promise<void> {
    if (!(PUERTOS_WEBHOOK_VALIDOS as readonly number[]).includes(puerto)) {
      throw new TelegramError(
        `Puerto de webhook inválido: ${String(puerto)}. Telegram solo acepta ${PUERTOS_WEBHOOK_VALIDOS.join(', ')}.`,
      );
    }

    await bot.init(); // webhookCallback no llama a bot.start(), así que nadie más trae bot.botInfo.
    const manejador = webhookCallback(bot, 'http', secretToken ? { secretToken } : undefined);

    servidorHttp = createServer((req, res) => {
      void manejador(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      servidorHttp?.once('error', reject);
      servidorHttp?.listen(puerto, resolve);
    });

    await bot.api.setWebhook(url, {
      allowed_updates: ['message', 'callback_query'],
      ...(secretToken ? { secret_token: secretToken } : {}),
    });

    log.info({ url, puerto, username: bot.botInfo.username }, 'Conectado a Telegram (webhook)');
  }

  async function conectarPorPolling(): Promise<void> {
    // bot.start() es un loop de polling que no resuelve hasta que se llama bot.stop().
    // Usamos onStart para resolver la promesa ni bien el bot está listo y seguir.
    await new Promise<void>((resolve, reject) => {
      bot
        .start({
          allowed_updates: ['message', 'callback_query'],
          onStart: (info) => {
            log.info({ username: info.username }, 'Conectado a Telegram (polling)');
            resolve();
          },
        })
        .catch(reject);
    });
  }

  return {
    async conectar(): Promise<void> {
      await registrarComandos();

      if (opciones.webhook) {
        await conectarPorWebhook(opciones.webhook);
      } else {
        await conectarPorPolling();
      }
    },

    async enviar(jid: string, salida: Salida): Promise<void> {
      try {
        await enviarMensaje(jid, salida);
      } catch (error) {
        throw new TelegramError('No se pudo enviar el mensaje de Telegram', error);
      }
    },

    async desconectar(): Promise<void> {
      if (servidorHttp) {
        await bot.api.deleteWebhook();
        await new Promise<void>((resolve) => servidorHttp?.close(() => resolve()));
      } else {
        await bot.stop();
      }
      log.info('Cliente de Telegram desconectado');
    },
  };
}
