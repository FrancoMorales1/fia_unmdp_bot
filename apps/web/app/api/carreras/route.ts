import { carrerasDePlanes } from '@fi/contexto';

export async function GET(): Promise<Response> {
  const carreras = await carrerasDePlanes();
  return Response.json({ carreras });
}
