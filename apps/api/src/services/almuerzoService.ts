import { AppError } from '../middleware/errorHandler';
import { prisma } from '../db';
import { TURNOS_ALMUERZO } from '@limablue/shared';

function getFechaIso(fecha?: string): string {
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const hoyLima = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return `${hoyLima.getFullYear()}-${String(hoyLima.getMonth() + 1).padStart(2, '0')}-${String(hoyLima.getDate()).padStart(2, '0')}`;
}

export function esDomingo(fechaStr: string): boolean {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCDay() === 0;
}

/**
 * true si la fecha (YYYY-MM-DD) cae en FIN DE SEMANA (sábado o domingo). Los almuerzos
 * RECURRENTES no aplican en fin de semana: los sábados se trabaja hasta las 14:00 SIN
 * almuerzo, y el domingo la sede está cerrada (salvo excepción). Los consumidores usan
 * esto para que un almuerzo recurrente no se pinte en sábado ni domingo.
 */
export function esFinDeSemana(fechaStr: string): boolean {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return dow === 0 || dow === 6;
}

export async function tieneAlmuerzoEnSede(
  profesionalId: string,
  sedeId: string,
  fecha?: string,
): Promise<boolean> {
  const f = getFechaIso(fecha);
  if (esFinDeSemana(f)) return false; // sábados y domingos no llevan almuerzo recurrente

  const ini = new Date(`${f}T00:00:00.000Z`);
  const fin = new Date(`${f}T23:59:59.999Z`);

  const existente = await prisma.bloqueoAgenda.findFirst({
    where: {
      profesionalId,
      sedeId,
      tipo: 'ALMUERZO',
      deletedAt: null,
      fechaInicio: { lte: fin },
      fechaFin: { gte: ini },
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
  const [year, month, day] = fechaStr.split('-').map(Number);
  const esDom = esDomingo(fechaStr);

  let fIni: Date;
  let fFin: Date;
  let esRec: boolean;

  if (esDom) {
    // Si la fecha es domingo, el almuerzo es PUNTUAL (solo aplica para ese domingo específico)
    fIni = new Date(Date.UTC(year!, month! - 1, day!, 0, 0, 0, 0));
    fFin = new Date(Date.UTC(year!, month! - 1, day!, 23, 59, 59, 999));
    esRec = false;
  } else {
    // Para días normales (Lunes a Sábado), rige hasta fin del MES SIGUIENTE (28-sep-2026, pedido de la clínica: antes
    // era fin de este mes y al mirar el mes que viene la agenda salía sin almuerzos hasta el día 1).
    fIni = new Date(Date.UTC(year!, month! - 1, day!, 0, 0, 0, 0));
    const fFinMes = new Date(Date.UTC(year!, month! + 1, 0, 23, 59, 59, 999));

    const fechaConsulta = new Date(`${fechaStr}T12:00:00Z`);
    const asignacion = await prisma.asignacionSede.findFirst({
      where: {
        profesionalId: data.profesionalId,
        sedeId: data.sedeId, // por RANGO, sin `activa` (una base reemplazada por un movimiento futuro sigue vigente)
        fechaInicio: { lte: fechaConsulta },
        OR: [{ fechaFin: null }, { fechaFin: { gte: fechaConsulta } }],
      },
      orderBy: { fechaInicio: 'desc' },
    });

    // 24-sep-2026: no se pone el almuerzo en una sede donde la profesional NO está ese día (si está asignada a OTRA).
    // Así nació el almuerzo de One de Raysa estando en Lince: la agenda de Lince no lo mostraba, pero bloqueaba 14–15.
    if (!asignacion) {
      const otra = await prisma.asignacionSede.findFirst({
        where: {
          profesionalId: data.profesionalId,
          fechaInicio: { lte: fechaConsulta },
          OR: [{ fechaFin: null }, { fechaFin: { gte: fechaConsulta } }],
        },
        orderBy: { fechaInicio: 'desc' },
        select: { sede: { select: { nombre: true } }, profesional: { select: { nombres: true } } },
      });
      if (otra) {
        throw new AppError(
          `${otra.profesional.nombres.split(' ')[0]} está asignada a ${otra.sede.nombre} en esa fecha, no a esta sede: registra su almuerzo en ${otra.sede.nombre}.`,
          422,
          'ALMUERZO_OTRA_SEDE',
        );
      }
    }

    fFin = fFinMes;
    if (asignacion?.fechaFin && asignacion.fechaFin < fFinMes) {
      fFin = asignacion.fechaFin;
    }
    esRec = true;
  }

  // Regla dura (igual que Permisos y Vacaciones): no se pone un almuerzo ENCIMA de pacientes ya
  // agendados. Antes se creaba sin mirar y las citas quedaban tapadas por la franja, sin aviso.
  const citasTapadas = await prisma.cita.findMany({
    where: {
      OR: [{ profesionalId: data.profesionalId }, { solicitadoProfesionalId: data.profesionalId }],
      deletedAt: null, estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] },
      fecha: { gte: new Date(`${fechaStr}T00:00:00.000Z`), lte: fFin },
    },
    select: { fecha: true, horaInicio: true, duracionMinutos: true, paciente: { select: { nombres: true, apellidoPaterno: true } } },
    orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
  });
  const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const choques = citasTapadas.filter((c) => aMin(c.horaInicio) < aMin(turno.horaFin) && aMin(c.horaInicio) + c.duracionMinutos > aMin(turno.horaInicio));
  if (choques.length > 0) {
    const lista = choques.slice(0, 5).map((c) => `${c.fecha.toISOString().slice(8, 10)}/${c.fecha.toISOString().slice(5, 7)} ${c.horaInicio} ${c.paciente?.nombres?.split(' ')[0] ?? ''} ${c.paciente?.apellidoPaterno ?? ''}`.trim()).join(', ');
    throw new AppError(`Hay ${choques.length} cita(s) agendada(s) en ese horario de almuerzo (${lista}${choques.length > 5 ? '…' : ''}). Muévelas primero o elige otro turno.`, 409, 'CITAS_EN_RANGO');
  }

  // Buscar almuerzos previos activos que se traslapen con la nueva ventana [fIni, fFin]
  const existentes = await prisma.bloqueoAgenda.findMany({
    where: {
      profesionalId: data.profesionalId,
      sedeId: data.sedeId,
      tipo: 'ALMUERZO',
      deletedAt: null,
      fechaInicio: { lte: fFin },
      fechaFin: { gte: fIni },
    },
  });

  const diaAnteriorAIni = new Date(fIni.getTime() - 1);

  for (const b of existentes) {
    if (b.fechaInicio >= fIni) {
      // Si el almuerzo previo inició en o después de la fecha del cambio, se desactiva
      await prisma.bloqueoAgenda.update({
        where: { id: b.id },
        data: { deletedAt: new Date() },
      });
    } else {
      // Si el almuerzo previo viene del pasado (antes de fIni), acortamos su fechaFin al día anterior
      await prisma.bloqueoAgenda.update({
        where: { id: b.id },
        data: { fechaFin: diaAnteriorAIni },
      });
    }
  }

  // Crear el nuevo almuerzo (puntual si es domingo, recurrente mensual si es día normal)
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
