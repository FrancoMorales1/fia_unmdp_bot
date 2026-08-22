export interface MensajeEntrante {
  /** Identificador del chat: JID en WhatsApp, chat ID en Telegram. */
  jid: string;
  nombre: string | undefined;
  texto: string;
  esGrupo: boolean;
  recibidoEn: Date;
  /**
   * Id de la opción cuando el usuario apretó un botón en vez de escribir.
   * Solo lo completan los canales con botones (Telegram).
   */
  opcionElegida?: string | undefined;
  /**
   * Texto del mensaje que el usuario está respondiendo. Es lo que permite saber
   * a qué pedido corresponde lo que escribió en la celda de texto, sin guardar
   * estado de conversación.
   */
  respondeA?: string | undefined;
}

/** Un botón. En canales sin botones se renderiza como una línea de texto. */
export interface OpcionMenu {
  /** Identificador estable; vuelve en `MensajeEntrante.opcionElegida`. */
  id: string;
  etiqueta: string;
  /** Qué tiene que escribir el usuario para elegirla donde no hay botones. */
  atajo?: string | undefined;
  /**
   * Si está presente, el botón abre esta URL como Telegram Mini App en vez de
   * mandar `id` como callback. Solo lo soporta Telegram: los canales de texto
   * plano (WhatsApp) descartan esta opción en vez de ofrecerla.
   */
  abrirWebApp?: string | undefined;
}

/** Pedido de texto libre: en Telegram abre una celda de respuesta ya enfocada. */
export interface PedidoDeTexto {
  /** Texto gris dentro de la celda. Telegram lo corta a 64 caracteres. */
  placeholder: string;
}

export interface ArchivoSalida {
  ruta: string;
  nombre: string;
}

/**
 * Respuesta del bot. Describe la *intención* de la interfaz; cada canal decide
 * cómo la dibuja: Telegram con botones y celdas, WhatsApp aplanado a texto.
 */
export interface RespuestaSalida {
  texto: string;
  opciones?: OpcionMenu[] | undefined;
  pedirTexto?: PedidoDeTexto | undefined;
  archivos?: ArchivoSalida[] | undefined;
  /**
   * Cuando es true las opciones son solo un atajo visual (por ejemplo, los
   * botones que acompañan una respuesta ya dada) y los canales de texto plano
   * las omiten en vez de repetir el menú entero abajo de cada mensaje.
   */
  opcionesSoloEnBotones?: boolean | undefined;
}

export type Salida = string | RespuestaSalida;

export type ManejadorMensaje = (mensaje: MensajeEntrante) => Promise<Salida | undefined>;

/** Aplana una salida para los canales que solo mandan texto (WhatsApp). */
export function aTextoPlano(salida: Salida): string {
  if (typeof salida === 'string') return salida;

  const { texto, opcionesSoloEnBotones } = salida;
  // Un link de Mini App de Telegram no sirve por WhatsApp.
  const opciones = salida.opciones?.filter((o) => !o.abrirWebApp);
  if (opcionesSoloEnBotones || !opciones || opciones.length === 0) return texto;

  const lista = opciones.map((o) => `${o.atajo ?? '•'} - ${o.etiqueta}`).join('\n');
  return `${texto}\n\n${lista}`;
}

export interface ClienteMensajeria {
  conectar(): Promise<void>;
  enviar(jid: string, salida: Salida): Promise<void>;
  desconectar(): Promise<void>;
}
