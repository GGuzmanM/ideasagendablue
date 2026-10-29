/**
 * Precio de la reserva web (30-oct-2026: por SEDE). Función pura, sin base de datos: la usan el catálogo público/chat,
 * la reserva (el monto que se cobrará en la sede) y la pantalla de administración, para que los tres den el mismo número.
 *
 * Orden (gana el primero que exista y sea > 0; vacío/0 = «no hay»):
 *   1. precio de ESA sede para el tipo        (subcategoria_precio_web_sede)
 *   2. precio web general del tipo            (subcategorias_servicio.precioOnline)
 *   3. precio de la clínica del tipo          (subcategorias_servicio.precioReferencial)
 *   4. precio de ESA sede para el servicio    (servicio_precio_web_sede)
 *   5. precio web general del servicio        (servicios.precioOnline)
 *   6. precio de la clínica del servicio      (servicios.precioReferencial)
 * Un servicio sin tipos solo usa 4–6. Sin ningún precio → null (no se ofrece: el paciente debe saber cuánto pagará).
 */
export interface PreciosServicioWeb {
  /** servicios.precioOnline / precioReferencial */
  servicioWeb: number | null; servicioReferencial: number | null;
  /** servicio_precio_web_sede de la sede consultada */
  servicioSede: number | null;
}
export interface PreciosTipoWeb {
  tipoWeb: number | null; tipoReferencial: number | null;
  /** subcategoria_precio_web_sede de la sede consultada */
  tipoSede: number | null;
}

const valido = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0;

export function precioWebEnSede(s: PreciosServicioWeb, tipo?: PreciosTipoWeb | null): number | null {
  const orden = [tipo?.tipoSede, tipo?.tipoWeb, tipo?.tipoReferencial, s.servicioSede, s.servicioWeb, s.servicioReferencial];
  for (const p of orden) if (valido(p)) return p;
  return null;
}

/** Decimal de Prisma (o null) → número. */
export const aNumero = (v: unknown): number | null => (v == null ? null : Number(v));
