import { env } from '@fi/core';

/**
 * Ventana deslizante en memoria, mismo criterio que `excedeLimite` en
 * apps/bot/src/main.ts. En funciones serverless de Vercel esto es best-effort
 * (la memoria no persiste de forma confiable entre invocaciones/instancias):
 * sirve como primera barrera, no como garantía dura.
 */
const marcasPorUsuario = new Map<number, number[]>();

export function excedeLimite(usuarioId: number): boolean {
  const ahora = Date.now();
  const ventanaMs = env.RATE_LIMIT_WINDOW_S * 1000;
  const marcas = (marcasPorUsuario.get(usuarioId) ?? []).filter((t) => ahora - t < ventanaMs);

  if (marcas.length >= env.RATE_LIMIT_MAX) {
    marcasPorUsuario.set(usuarioId, marcas);
    return true;
  }

  marcas.push(ahora);
  marcasPorUsuario.set(usuarioId, marcas);
  return false;
}
