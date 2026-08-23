import { describe, expect, it } from 'vitest';

import type { MensajeEntrante } from '@fi/core';

import {
  esPedidoDeTodo,
  interpretar,
  carreraElegida,
  mensajeParaIA,
  materiaElegida,
  menuInicial,
  normalizarConsulta,
  opcionesDeMaterias,
  opcionesDeCarreras,
  opcionesDePlanes,
  opcionDesdePedido,
  parsearOpcion,
  planElegido,
  pedidoDeConsulta,
} from './menu.js';

function entrante(parcial: Partial<MensajeEntrante> = {}): MensajeEntrante {
  return {
    jid: '123',
    nombre: 'Franco',
    texto: '',
    esGrupo: false,
    recibidoEn: new Date(),
    ...parcial,
  };
}

describe('parsearOpcion', () => {
  it('acepta el número solo', () => {
    expect(parsearOpcion('2')).toEqual({ numero: 2, consulta: '' });
  });

  it('acepta número + consulta', () => {
    expect(parsearOpcion('1 seguridad informatica')).toEqual({
      numero: 1,
      consulta: 'seguridad informatica',
    });
  });

  it('acepta la opción de ingreso 2027', () => {
    expect(parsearOpcion('5 inscripción al SIFI')).toEqual({
      numero: 5,
      consulta: 'inscripción al SIFI',
    });
  });

  it('tolera un separador entre el número y la consulta', () => {
    expect(parsearOpcion('3. ingeniería química')).toEqual({
      numero: 3,
      consulta: 'ingeniería química',
    });
  });

  it('no confunde un año o una cátedra con una opción', () => {
    expect(parsearOpcion('2026')).toBeNull();
    expect(parsearOpcion('1er año')).toBeNull();
  });

  it('devuelve null para texto libre', () => {
    expect(parsearOpcion('hola, ¿hay clases hoy?')).toBeNull();
  });
});

describe('normalizarConsulta', () => {
  it('solo recorta espacios, no interpreta nada', () => {
    expect(normalizarConsulta('  álgebra  ')).toBe('álgebra');
    expect(normalizarConsulta('  Todo ')).toBe('Todo');
    // "-" se resuelve como "menu" en interpretar(), antes de llegar acá.
    expect(normalizarConsulta('-')).toBe('-');
  });
});

describe('esPedidoDeTodo', () => {
  it('reconoce "todo" sin importar mayúsculas ni espacios', () => {
    expect(esPedidoDeTodo('todo')).toBe(true);
    expect(esPedidoDeTodo('  Todo ')).toBe(true);
    expect(esPedidoDeTodo('TODO')).toBe(true);
  });

  it('no confunde una consulta real con el pedido de todo', () => {
    expect(esPedidoDeTodo('todo sobre finales')).toBe(false);
    expect(esPedidoDeTodo('')).toBe(false);
    expect(esPedidoDeTodo('-')).toBe(false);
  });
});

describe('opcionDesdePedido', () => {
  it('reconoce la opción desde el mensaje que abrió la celda de texto', () => {
    for (const numero of [1, 2, 3, 4] as const) {
      expect(opcionDesdePedido(pedidoDeConsulta(numero).texto)).toBe(numero);
    }
  });

  it('devuelve null si el mensaje respondido no es un pedido del bot', () => {
    expect(opcionDesdePedido('cualquier otra cosa')).toBeNull();
  });
});

describe('interpretar', () => {
  it('abre la celda de texto cuando se aprieta un botón', () => {
    expect(interpretar(entrante({ opcionElegida: 'opcion:1' }), null)).toEqual({
      tipo: 'pedir',
      numero: 1,
    });
  });

  it('vuelve al menú si el callback no se entiende', () => {
    expect(interpretar(entrante({ opcionElegida: 'basura' }), null)).toEqual({ tipo: 'menu' });
  });

  it('busca con lo que se escribió en la celda de texto', () => {
    const pedido = pedidoDeConsulta(1).texto;

    expect(interpretar(entrante({ texto: 'álgebra', respondeA: pedido }), null)).toEqual({
      tipo: 'consultar',
      numero: 1,
      consulta: 'álgebra',
    });
  });

  it('"-" siempre vuelve al menú, sin importar qué pedido se esté respondiendo', () => {
    const pedido = pedidoDeConsulta(2).texto;

    expect(interpretar(entrante({ texto: '-', respondeA: pedido }), null)).toEqual({
      tipo: 'menu',
    });
    expect(interpretar(entrante({ texto: '-' }), 1)).toEqual({ tipo: 'menu' });
  });

  it('"todo" no es un atajo de menú: llega como consulta normal', () => {
    const pedido = pedidoDeConsulta(4).texto;

    expect(interpretar(entrante({ texto: 'todo', respondeA: pedido }), null)).toEqual({
      tipo: 'consultar',
      numero: 4,
      consulta: 'todo',
    });
  });

  it('/menu escapa aunque se esté respondiendo un pedido', () => {
    const pedido = pedidoDeConsulta(1).texto;

    expect(interpretar(entrante({ texto: '/menu', respondeA: pedido }), 1)).toEqual({
      tipo: 'menu',
    });
  });

  it('sigue aceptando el protocolo de texto de WhatsApp', () => {
    expect(interpretar(entrante({ texto: '4 biblioteca' }), null)).toEqual({
      tipo: 'consultar',
      numero: 4,
      consulta: 'biblioteca',
    });
  });

  it('en Telegram no interpreta números sueltos: la selección va por menú', () => {
    expect(
      interpretar(entrante({ texto: '4 biblioteca' }), null, { protocoloDeTexto: false }),
    ).toEqual({ tipo: 'menu' });
  });

  it('usa el último tema elegido cuando el mensaje llega suelto', () => {
    expect(interpretar(entrante({ texto: 'física A' }), 1)).toEqual({
      tipo: 'consultar',
      numero: 1,
      consulta: 'física A',
    });
  });

  it('muestra el menú si no hay tema previo ni forma de deducirlo', () => {
    expect(interpretar(entrante({ texto: 'buenas' }), null)).toEqual({ tipo: 'menu' });
  });
});

describe('menuInicial', () => {
  it('ofrece las cinco opciones como botones', () => {
    const menu = menuInicial('Franco');

    expect(menu.texto).toContain('Franco');
    expect(menu.opciones).toHaveLength(5);
    expect(menu.opciones?.map((o) => o.id)).toEqual([
      'opcion:1',
      'opcion:2',
      'opcion:3',
      'opcion:4',
      'opcion:5',
    ]);
  });
});

describe('opcionesDeMaterias', () => {
  it('publica los nombres exactos y permite elegir por botón o número', () => {
    const materias = ['gest. de seg. informatica y seg. en sist', 'principios de seg. informatica'];
    const salida = opcionesDeMaterias(materias);

    expect(salida.opciones?.map((opcion) => opcion.etiqueta)).toEqual(materias);
    expect(materiaElegida(entrante({ opcionElegida: 'materia:2' }), materias)).toBe(materias[1]);
    expect(materiaElegida(entrante({ texto: '1' }), materias)).toBe(materias[0]);
  });
});

describe('selección de planes de estudio', () => {
  it('muestra una carrera por botón y luego sus planes', () => {
    const carreras = ['COMPUTACIÓN', 'INFORMÁTICA'];
    const planes = ['COMPUTACIÓN (Plan 2010)', 'Computacion (Plan 2024)'];

    expect(opcionesDeCarreras(carreras).opciones?.map((opcion) => opcion.id)).toEqual([
      'carrera:1',
      'carrera:2',
    ]);
    expect(carreraElegida(entrante({ opcionElegida: 'carrera:1' }), carreras)).toBe(carreras[0]);

    expect(opcionesDePlanes(planes).opciones?.map((opcion) => opcion.etiqueta)).toEqual(planes);
    expect(planElegido(entrante({ opcionElegida: 'plan:2' }), planes)).toBe(planes[1]);
  });
});

describe('pedidoDeConsulta', () => {
  it('pide texto libre con un placeholder para la celda', () => {
    const pedido = pedidoDeConsulta(1);

    expect(pedido.pedirTexto?.placeholder).toBeTruthy();
    // Botones y force_reply son excluyentes en la API de Telegram.
    expect(pedido.opciones).toBeUndefined();
  });
});

describe('mensajeParaIA', () => {
  it('arma una pregunta natural con la consulta', () => {
    expect(mensajeParaIA({ numero: 1, consulta: 'álgebra' })).toContain('álgebra');
  });

  it('pregunta en general cuando no hay consulta', () => {
    expect(mensajeParaIA({ numero: 3, consulta: '' })).toContain('carreras');
  });
});
