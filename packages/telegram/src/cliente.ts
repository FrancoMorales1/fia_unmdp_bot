import { createLogger, env, TelegramError } from '@fi/core';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { Bot, InputFile } from 'grammy';

import type { ClienteMensajeria, ManejadorMensaje, MensajeEntrante, Salida } from '@fi/core';

import { marcadoDeRespuesta } from './teclado.js';

const log = createLogger('telegram');

/** Un comando del menú azul de Telegram (el botón "/" al lado del campo de texto). */
export interface ComandoTelegram {
  comando: string;
  descripcion: string;
}

export interface OpcionesCliente {
  onMensaje: ManejadorMensaje;
  /** Token del bot de Telegram. Si se omite se usa TELEGRAM_BOT_TOKEN del entorno. */
  token?: string;
  /** Si es true responde mensajes de grupos. Por defecto solo chats privados. */
  responderGrupos?: boolean;
  /** Se publican con setMyCommands al conectar. */
  comandos?: ComandoTelegram[];
}

export function crearClienteTelegram(opciones: OpcionesCliente): ClienteMensajeria {
  const token = opciones.token ?? env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new TelegramError('TELEGRAM_BOT_TOKEN no está configurado');
  }

  const responderGrupos = opciones.responderGrupos ?? false;
  const bot = new Bot(token);
  let runner: RunnerHandle | undefined;

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

  return {
    async conectar(): Promise<void> {
      if (opciones.comandos && opciones.comandos.length > 0) {
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

      // bot.start() procesa los updates de a uno (secuencial): con varios
      // alumnos usando el bot a la vez, el segundo espera a que termine de
      // responderle al primero (incluye la ida y vuelta a Gemini). El runner
      // los procesa en paralelo — así de a uno tarda lo mismo, pero no se
      // pisan entre usuarios distintos.
      await bot.init();
      runner = run(bot, {
        runner: { fetch: { allowed_updates: ['message', 'callback_query'] } },
      });
      log.info({ username: bot.botInfo.username }, 'Conectado a Telegram');
    },

    async enviar(jid: string, salida: Salida): Promise<void> {
      try {
        await enviarMensaje(jid, salida);
      } catch (error) {
        throw new TelegramError('No se pudo enviar el mensaje de Telegram', error);
      }
    },

    async desconectar(): Promise<void> {
      if (runner?.isRunning()) {
        await runner.stop();
      }
      log.info('Cliente de Telegram desconectado');
    },
  };
}
