/**
 * Quién pertenece a una sede en cada día de una SEMANA (Horarios del Personal › Ajustes por fecha).
 *
 * Una persona pertenece a la sede en una fecha si alguna de sus asignaciones cubre ese día POR RANGO
 * (fechaInicio ≤ día ≤ fechaFin, fechaFin null = indefinida). NO se filtra por `activa`: al crear un movimiento la
 * asignación anterior queda activa=false con fechaFin = inicio-1, pero sigue siendo su sede hasta esa fecha; la agenda,
 * la disponibilidad y las citas ya deciden así (ver asignacionService.crearMovimiento).
 *
 * Antes esta pantalla miraba solo la asignación `activa` de HOY: con un movimiento futuro la podóloga desaparecía de su
 * sede actual y no aparecía en la nueva en la semana en que llegaba (30-oct-2026).
 */
import { prisma } from '../db';
import { fechaDb } from '../utils/fechaLima';

export interface AsignacionRango {
  sedeId: string;
  sedeNombre: string;
  fechaInicio: Date;
  fechaFin: Date | null;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** ¿La asignación cubre el día `iso` (AAAA-MM-DD)? */
export function cubreDia(a: Pick<AsignacionRango, 'fechaInicio' | 'fechaFin'>, iso: string): boolean {
  return dia(a.fechaInicio) <= iso && (!a.fechaFin || dia(a.fechaFin) >= iso);
}

/** Estado de una persona en un día respecto a una sede: ¿es de esa sede?, y si no, ¿en qué otra sede está? */
export function estadoEnDia(asignaciones: AsignacionRango[], sedeId: string, iso: string): { enSede: boolean; sedeOtra: string | null } {
  const delDia = asignaciones.filter((a) => cubreDia(a, iso));
  if (delDia.some((a) => a.sedeId === sedeId)) return { enSede: true, sedeOtra: null };
  return { enSede: false, sedeOtra: delDia[0]?.sedeNombre ?? null };
}

/**
 * Personas con alguna asignación en `sedeId` durante [desde, hasta] (AAAA-MM-DD) y todas sus asignaciones de esos días
 * (de cualquier sede, para poder decir «ese día está en otra sede»). Devuelve profesionalId → asignaciones.
 */
export async function asignacionesDeLaSemana(sedeId: string, desde: string, hasta: string): Promise<Map<string, AsignacionRango[]>> {
  const ini = fechaDb(desde), fin = fechaDb(hasta);
  const solapa = { fechaInicio: { lte: fin }, OR: [{ fechaFin: null }, { fechaFin: { gte: ini } }] };
  const enSede = await prisma.asignacionSede.findMany({ where: { sedeId, ...solapa }, select: { profesionalId: true } });
  const ids = [...new Set(enSede.map((a) => a.profesionalId))];
  if (ids.length === 0) return new Map();
  const todas = await prisma.asignacionSede.findMany({
    where: { profesionalId: { in: ids }, ...solapa },
    select: { profesionalId: true, sedeId: true, fechaInicio: true, fechaFin: true, sede: { select: { nombre: true } } },
    orderBy: { fechaInicio: 'asc' },
  });
  const m = new Map<string, AsignacionRango[]>();
  for (const a of todas) {
    const lista = m.get(a.profesionalId) ?? [];
    lista.push({ sedeId: a.sedeId, sedeNombre: a.sede.nombre, fechaInicio: a.fechaInicio, fechaFin: a.fechaFin });
    m.set(a.profesionalId, lista);
  }
  return m;
}
