import { crearProveedorGemini, instruccionParaOpcion, type NumeroOpcionIA } from '@fi/ai';
import { obtenerContextoDeOpcion, obtenerPlanDeEstudio } from '@fi/contexto';

import { autenticar } from '@/lib/auth';

interface CuerpoConsulta {
  opcion: NumeroOpcionIA;
  consulta: string;
  /** Solo para opción 3 (plan de estudios): la etiqueta exacta ya elegida. */
  plan?: string;
}

function leerCuerpo(datos: unknown): CuerpoConsulta | null {
  if (typeof datos !== 'object' || datos === null) return null;
  const { opcion, consulta, plan } = datos as Record<string, unknown>;

  if (opcion !== 1 && opcion !== 2 && opcion !== 3 && opcion !== 4) return null;
  if (typeof consulta !== 'string') return null;
  if (plan !== undefined && typeof plan !== 'string') return null;

  return { opcion, consulta, plan };
}

const ia = crearProveedorGemini();

export async function POST(request: Request): Promise<Response> {
  const auth = autenticar(request);
  if ('error' in auth) return Response.json({ error: auth.error }, { status: 401 });

  const cuerpo = leerCuerpo(await request.json());
  if (!cuerpo) return Response.json({ error: 'Body inválido' }, { status: 400 });

  if (cuerpo.opcion === 3) {
    if (!cuerpo.plan) return Response.json({ error: 'Falta el plan elegido' }, { status: 400 });

    const documentos = await obtenerPlanDeEstudio(cuerpo.plan);
    if (documentos.length === 0) {
      return Response.json({ error: 'No encontré ese plan de estudios' }, { status: 404 });
    }

    const respuesta = await ia.responder({
      mensaje: `¿Cómo es el plan de estudios de ${cuerpo.plan}? Consulta puntual: ${cuerpo.consulta}`,
      documentos,
      instruccionSistema: instruccionParaOpcion(3),
    });
    return Response.json({ texto: respuesta.texto, fuentes: respuesta.fuentes });
  }

  const documentos = await obtenerContextoDeOpcion(cuerpo.opcion, cuerpo.consulta, ia);
  if (!Array.isArray(documentos)) {
    return Response.json({
      texto: `Encontré varias materias posibles: ${documentos.materias.join(', ')}. Escribí el nombre completo de la que te interese.`,
      fuentes: [],
    });
  }

  const respuesta = await ia.responder({
    mensaje: cuerpo.consulta,
    documentos,
    instruccionSistema: instruccionParaOpcion(cuerpo.opcion),
  });
  return Response.json({ texto: respuesta.texto, fuentes: respuesta.fuentes });
}
