/**
 * CUPO POR SERVICIO (09-oct-2026): servicios que usan una sala o equipo único en la sede, como «Evaluación postural -
 * Motiphysio» (una sola sala). `servicios.cupoSimultaneo` = cuántas citas de ese servicio pueden CRUZARSE a la vez en
 * la misma sede, sin importar el profesional. null = sin límite (solo cuenta que el profesional esté libre).
 *
 * Se valida en los mismos puntos que «el profesional está libre» (crear, bloque, mover, mover bloque, intercambiar,
 * cambiar tratamiento), dentro de la transacción Serializable, y la disponibilidad deja de ofrecer esas horas.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { fechaDb } from '../utils/fechaLima';
import { timeToMinutes } from '@limablue/shared';

type Cliente = Prisma.TransactionClient | typeof prisma;
const INACTIVOS = ['cancelada', 'no_show', 'reprogramada'] as const;

/** Intervalos [inicio, fin) en minutos de las citas ACTIVAS de un servicio con cupo, en una sede y día. null = sin cupo. */
export async function ocupacionServicio(
  client: Cliente, servicioId: string, sedeId: string, fecha: string, excluirCitaIds: string[] = [],
): Promise<{ cupo: number; nombre: string; intervalos: { ini: number; fin: number; hora: string }[] } | null> {
  const sv = await client.servicio.findUnique({ where: { id: servicioId }, select: { nombre: true, cupoSimultaneo: true } });
  if (!sv?.cupoSimultaneo || sv.cupoSimultaneo < 1) return null;
  const citas = await client.cita.findMany({
    where: {
      servicioId, sedeId, fecha: fechaDb(fecha), deletedAt: null, estado: { notIn: [...INACTIVOS] },
      ...(excluirCitaIds.length ? { id: { notIn: excluirCitaIds } } : {}),
    },
    select: { horaInicio: true, duracionMinutos: true },
  });
  return {
    cupo: sv.cupoSimultaneo, nombre: sv.nombre,
    intervalos: citas.map((c) => { const ini = timeToMinutes(c.horaInicio); return { ini, fin: ini + c.duracionMinutos, hora: c.horaInicio }; }),
  };
}

/** Cuántas citas ya ocupan el servicio en ese tramo. */
export function choques(oc: { intervalos: { ini: number; fin: number }[] }, horaInicio: string, duracionMin: number): number {
  const s = timeToMinutes(horaInicio), e = s + duracionMin;
  return oc.intervalos.filter((x) => x.ini < e && x.fin > s).length;
}

/** 409 SALA_OCUPADA si el servicio ya llenó su cupo en ese horario y sede. */
export async function validarCupoServicio(
  client: Cliente,
  p: { servicioId: string; sedeId: string; fecha: string; horaInicio: string; duracionMin: number; excluirCitaIds?: string[] },
): Promise<void> {
  const oc = await ocupacionServicio(client, p.servicioId, p.sedeId, p.fecha, p.excluirCitaIds ?? []);
  if (!oc) return;
  const s = timeToMinutes(p.horaInicio), e = s + p.duracionMin;
  const cruces = oc.intervalos.filter((x) => x.ini < e && x.fin > s);
  if (cruces.length >= oc.cupo) {
    const horas = [...new Set(cruces.map((x) => x.hora))].sort().join(', ');
    throw new AppError(
      oc.cupo === 1
        ? `«${oc.nombre}» tiene una sola sala en esta sede y ya hay una cita a las ${horas}. Elige otro horario.`
        : `«${oc.nombre}» ya tiene ${cruces.length} citas a esa hora en esta sede (máximo ${oc.cupo}). Elige otro horario.`,
      409, 'SALA_OCUPADA',
    );
  }
}
