import { prisma } from '../db';
import { getServicioAnclaId } from './combinacionService';

/**
 * Cambiar el tratamiento de UNA mitad de una cita doble (bloque combinado, 13-nov-2026).
 * Qué servicio puede ir en cada mitad sale de Herramientas › Combinaciones (`combinaciones_permitidas`):
 *  - 2.º servicio (SECUNDARIO): un «extra» activo permitido para el ancla de la PRINCIPAL. Una fila con
 *    `servicioAnclaId` vale para esa ancla; una fila antigua sin ancla (null) vale para el ancla global.
 *  - 1.er servicio (PRINCIPAL): un servicio ancla con el que el 2.º servicio actual esté permitido. Con una sola
 *    ancla configurada (lo normal: la profilaxis), en la práctica solo se cambia su tipo (Regular ↔ Premium…).
 * Nunca los dos iguales. Lo demás (profesional habilitado, membresía, sala, precio, promo) lo valida la ruta.
 */

export type RolBloque = 'PRINCIPAL' | 'SECUNDARIO';
export interface FilaCombinacion { servicioAnclaId: string | null; servicioExtraId: string }

/** ¿La fila vale para esa ancla? (las filas antiguas sin ancla son de la ancla global). */
const filaDeAncla = (f: FilaCombinacion, anclaId: string, anclaGlobal: string | null) =>
  f.servicioAnclaId === anclaId || (f.servicioAnclaId == null && anclaGlobal != null && anclaId === anclaGlobal);

/**
 * Servicios que pueden ir en la mitad `rol`, dado el servicio de la OTRA mitad. Puro (para pruebas).
 * No incluye el servicio de la otra mitad.
 */
export function serviciosPermitidosEnMitad(
  rol: RolBloque, otroServicioId: string, filas: FilaCombinacion[], anclaGlobal: string | null,
): string[] {
  if (rol === 'SECUNDARIO') {
    const extras = filas.filter((f) => filaDeAncla(f, otroServicioId, anclaGlobal)).map((f) => f.servicioExtraId);
    return [...new Set(extras)].filter((id) => id !== otroServicioId);
  }
  const candidatas = new Set<string>(filas.map((f) => f.servicioAnclaId).filter((x): x is string => !!x));
  if (anclaGlobal) candidatas.add(anclaGlobal);
  return [...candidatas].filter((a) => a !== otroServicioId
    && filas.some((f) => f.servicioExtraId === otroServicioId && filaDeAncla(f, a, anclaGlobal)));
}

/** Lo mismo leyendo la configuración real (solo combinaciones activas). */
export async function serviciosPermitidosBloque(rol: RolBloque, otroServicioId: string): Promise<string[]> {
  const [anclaGlobal, filas] = await Promise.all([
    getServicioAnclaId(),
    prisma.combinacionPermitida.findMany({ where: { activo: true, deletedAt: null }, select: { servicioAnclaId: true, servicioExtraId: true } }),
  ]);
  return serviciosPermitidosEnMitad(rol, otroServicioId, filas, anclaGlobal);
}

/** Precio de lista del bloque: vive entero en la PRINCIPAL (la SECUNDARIO va sin precio), como al crearlo. */
export const precioBloque = (precioPrincipal: number, precioSecundaria: number) => precioPrincipal + precioSecundaria;
