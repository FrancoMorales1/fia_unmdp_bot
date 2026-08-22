import { planesDeEstudio } from '@fi/contexto';

export async function GET(request: Request): Promise<Response> {
  const carrera = new URL(request.url).searchParams.get('carrera');
  if (!carrera) return Response.json({ error: 'Falta el parámetro carrera' }, { status: 400 });

  const planes = await planesDeEstudio(carrera);
  return Response.json({ planes });
}
