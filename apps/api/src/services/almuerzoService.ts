import { prisma } from '../db';
import { TURNOS_ALMUERZO } from '@limablue/shared';

function getFechaIso(fecha?: string): string {
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const hoyLima = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return `${hoyLima.getFullYear()}-${String(hoyLima.getMonth() + 1).padStart(2, '0')}-${String(hoyLima.getDate()).padStart(2, '0')}`;
}

export async function tieneAlmuerzoEnSede(
  profesionalId: string,
  sedeId: string,
  fecha?: string,
): Promise<boolean> {
  const f = getFechaIso(fecha);
  const ini = new Date(`${f}T00:00:00.000Z`);
  const fin = new Date(`${f}T23:59:59.999Z`);

  const existente = await prisma.bloqueoAgenda.findFirst({
    where: {
      profesionalId,
      sedeId,
      tipo: 'ALMUERZO',
      deletedAt: null,
      OR: [
        { esRecurrente: true },
        { fechaInicio: { lte: fin }, fechaFin: { gte: ini } },
      ],
    },
  });
  return !!existente;
}

export async function crearAlmuerzo(data: {
  profesionalId: string;
  sedeId: string;
  horaInicio: string;
  creadoPor: string;
  fecha?: string;
  esRecurrente?: boolean;
}): Promise<void> {
  const turno = TURNOS_ALMUERZO.find((t) => t.horaInicio === data.horaInicio);
  if (!turno) throw new Error('Turno inválido. Debe ser 12:00, 13:00 o 14:00.');

  const fechaStr = getFechaIso(data.fecha);
  const yaExiste = await tieneAlmuerzoEnSede(data.profesionalId, data.sedeId, fechaStr);
  if (yaExiste) {
    throw new Error(
      'Esta profesional ya tiene un horario de almuerzo registrado para esa fecha en esta sede. ' +
        'Elimínalo primero si necesitas cambiarlo.',
    );
  }

  const fechaConsulta = new Date(`${fechaStr}T12:00:00Z`);

  const asignacion = await prisma.asignacionSede.findFirst({
    where: {
      profesionalId: data.profesionalId,
      sedeId: data.sedeId,
      activa: true,
      fechaInicio: { lte: fechaConsulta },
      OR: [{ fechaFin: null }, { fechaFin: { gte: fechaConsulta } }],
    },
    orderBy: { fechaInicio: 'desc' },
  });

  if (!asignacion) {
    throw new Error(
      'La profesional no tiene asignación activa en esta sede para esa fecha. ' +
        'Verifica el módulo de Movimientos antes de registrar el almuerzo.',
    );
  }

  const esRec = data.esRecurrente ?? false;
  const fIni = esRec
    ? asignacion.fechaInicio
    : new Date(`${fechaStr}T${turno.horaInicio}:00.000Z`);
  const fFin = esRec
    ? asignacion.fechaFin ?? new Date('2099-12-31')
    : new Date(`${fechaStr}T${turno.horaFin}:00.000Z`);

  await prisma.bloqueoAgenda.create({
    data: {
      profesionalId: data.profesionalId,
      sedeId: data.sedeId,
      tipo: 'ALMUERZO',
      esRecurrente: esRec,
      horaInicio: turno.horaInicio,
      horaFin: turno.horaFin,
      duracionMin: 60,
      motivo: `Almuerzo ${turno.label}`,
      fechaInicio: fIni,
      fechaFin: fFin,
      creadoPor: data.creadoPor,
    },
  });
}
