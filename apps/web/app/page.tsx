'use client';

import { useState } from 'react';

import { initData } from '@/lib/webapp';

type NumeroOpcion = 1 | 2 | 3 | 4;

interface DefinicionOpcion {
  numero: NumeroOpcion;
  etiqueta: string;
  placeholder: string;
}

const OPCIONES: DefinicionOpcion[] = [
  { numero: 1, etiqueta: '📅 Horarios de cursadas', placeholder: 'Ej: análisis matemático I' },
  { numero: 2, etiqueta: '🗓️ Calendario académico 2026', placeholder: 'Ej: inscripción a finales' },
  {
    numero: 3,
    etiqueta: '📚 Plan de estudios',
    placeholder: 'Ej: cuántos créditos vale una materia',
  },
  {
    numero: 4,
    etiqueta: 'ℹ️ Información de la facultad',
    placeholder: 'Ej: horarios de la biblioteca',
  },
];

type Vista = 'menu' | 'carrera' | 'version' | 'consulta';

async function pedirJson<T>(url: string, init?: RequestInit): Promise<T> {
  const respuesta = await fetch(url, {
    ...init,
    headers: { ...init?.headers, 'X-Telegram-Init-Data': initData() },
  });
  const datos: unknown = await respuesta.json();
  if (!respuesta.ok) {
    const mensaje = (datos as { error?: string }).error ?? 'Algo falló';
    throw new Error(mensaje);
  }
  return datos as T;
}

export default function Home() {
  const [vista, setVista] = useState<Vista>('menu');
  const [opcion, setOpcion] = useState<DefinicionOpcion | null>(null);
  const [carreras, setCarreras] = useState<string[]>([]);
  const [planes, setPlanes] = useState<string[]>([]);
  const [planElegido, setPlanElegido] = useState<string | null>(null);
  const [consulta, setConsulta] = useState('');
  const [respuesta, setRespuesta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function volverAlMenu() {
    setVista('menu');
    setOpcion(null);
    setCarreras([]);
    setPlanes([]);
    setPlanElegido(null);
    setConsulta('');
    setRespuesta(null);
    setError(null);
  }

  async function elegirOpcion(def: DefinicionOpcion) {
    setOpcion(def);
    setError(null);

    if (def.numero !== 3) {
      setVista('consulta');
      return;
    }

    setCargando(true);
    try {
      const { carreras: lista } = await pedirJson<{ carreras: string[] }>('/api/carreras');
      setCarreras(lista);
      setVista('carrera');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude cargar las carreras');
    } finally {
      setCargando(false);
    }
  }

  async function elegirCarrera(carrera: string) {
    setCargando(true);
    setError(null);
    try {
      const { planes: lista } = await pedirJson<{ planes: string[] }>(
        `/api/planes?carrera=${encodeURIComponent(carrera)}`,
      );
      setPlanes(lista);
      setVista('version');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude cargar los planes');
    } finally {
      setCargando(false);
    }
  }

  function elegirPlan(plan: string) {
    setPlanElegido(plan);
    setVista('consulta');
  }

  async function enviarConsulta() {
    if (!opcion || consulta.trim().length === 0) return;

    setCargando(true);
    setError(null);
    setRespuesta(null);
    try {
      const datos = await pedirJson<{ texto: string }>('/api/consultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opcion: opcion.numero,
          consulta,
          plan: planElegido ?? undefined,
        }),
      });
      setRespuesta(datos.texto);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude consultar');
    } finally {
      setCargando(false);
    }
  }

  if (vista === 'menu') {
    return (
      <main className="pantalla">
        <h1 className="titulo">Asistente FI UNMdP</h1>
        <p className="subtitulo">¿Sobre qué querés consultar?</p>
        <div className="lista">
          {OPCIONES.map((def) => (
            <button key={def.numero} className="tarjeta" onClick={() => void elegirOpcion(def)}>
              {def.etiqueta}
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (vista === 'carrera') {
    return (
      <main className="pantalla">
        <button className="boton-volver" onClick={volverAlMenu}>
          ← Menú
        </button>
        <h1 className="titulo">Elegí la carrera</h1>
        {error && <p className="error">{error}</p>}
        <div className="lista">
          {carreras.map((carrera) => (
            <button key={carrera} className="tarjeta" onClick={() => void elegirCarrera(carrera)}>
              {carrera}
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (vista === 'version') {
    return (
      <main className="pantalla">
        <button className="boton-volver" onClick={volverAlMenu}>
          ← Menú
        </button>
        <h1 className="titulo">Elegí la versión del plan</h1>
        {error && <p className="error">{error}</p>}
        <div className="lista">
          {planes.map((plan) => (
            <button key={plan} className="tarjeta" onClick={() => elegirPlan(plan)}>
              {plan}
            </button>
          ))}
        </div>
      </main>
    );
  }

  // vista === 'consulta'
  return (
    <main className="pantalla">
      <button className="boton-volver" onClick={volverAlMenu}>
        ← Menú
      </button>
      <h1 className="titulo">{opcion?.etiqueta}</h1>
      {planElegido && <p className="subtitulo">Plan: {planElegido}</p>}
      {error && <p className="error">{error}</p>}
      <textarea
        className="input-texto"
        placeholder={opcion?.placeholder}
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
      />
      <button className="boton" disabled={cargando} onClick={() => void enviarConsulta()}>
        {cargando ? 'Consultando…' : 'Preguntar'}
      </button>
      {respuesta && <div className="respuesta">{respuesta}</div>}
    </main>
  );
}
