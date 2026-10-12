/**
 * Fusionar dos fichas de la MISMA persona (12-oct-2026). Caso: «Laura Kelly Escalante Mendoza» (ficha vieja, inactiva) y
 * «Laura Escalante» (creada de nuevo el 22-sep porque no encontraron la vieja). Todo en UNA transacción y auditado:
 *  · HISTORIAL a la ficha que queda: citas (profesional, «Solo X», «Atendió», médico), atenciones, notas y recetas.
 *  · CONFIGURACIÓN: se suman las competencias que le falten; horarios, entradas y bloqueos de la vieja no se copian
 *    (la que queda ya tiene los suyos); sus asignaciones de sede abiertas se cierran para que salga de Movimientos.
 *  · La ficha vieja queda dada de baja (deletedAt, inactiva). No se borra nada.
 * Antes de escribir revisa que las citas FUTURAS que pasan no choquen con la agenda de la ficha que queda.
 */
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { fechaDb, hoyLimaStr } from '../utils/fechaLima';

type Ctx = { usuarioId?: string; ip?: string; userAgent?: string };
const ESTADOS_VIVOS_EXCLUIDOS = ['cancelada', 'reprogramada', 'no_show'] as const;
const aMin = (h: string) => { const [hh, mm] = h.split(':').map(Number); return (hh ?? 0) * 60 + (mm ?? 0); };

export async function fusionarProfesionales(p: Ctx & { origenId: string; destinoId: string }) {
  if (p.origenId === p.destinoId) throw new AppError('Elige dos fichas distintas', 400, 'MISMA_FICHA');
  const [origen, destino] = await Promise.all([
    prisma.profesional.findFirst({ where: { id: p.origenId, deletedAt: null }, include: { usuario: { select: { id: true } } } }),
    prisma.profesional.findFirst({ where: { id: p.destinoId, deletedAt: null }, include: { usuario: { select: { id: true } } } }),
  ]);
  if (!origen) throw new AppError('La ficha a quitar no existe o ya fue dada de baja', 404);
  if (!destino) throw new AppError('La ficha que se queda no existe', 404);
  if (origen.esEquipo || destino.esEquipo) throw new AppError('Las máquinas no se fusionan', 400, 'ES_EQUIPO');
  if (origen.tipo !== destino.tipo) throw new AppError('Las dos fichas deben ser del mismo tipo (podóloga, fisioterapeuta o médico)', 400, 'TIPO_DISTINTO');
  if (origen.usuario && destino.usuario) {
    throw new AppError('Las dos fichas tienen usuario: desvincula uno en Administración › Usuarios antes de fusionar', 409, 'DOS_USUARIOS');
  }

  // Citas futuras vivas de la ficha que se va: no pueden chocar con la agenda de la que queda.
  const hoy = fechaDb(hoyLimaStr());
  const futuras = await prisma.cita.findMany({
    where: { profesionalId: origen.id, deletedAt: null, fecha: { gte: hoy }, estado: { notIn: [...ESTADOS_VIVOS_EXCLUIDOS] } },
    select: { id: true, fecha: true, horaInicio: true, duracionMinutos: true, sedeId: true, slotRol: true },
  });
  const choques: string[] = [];
  for (const c of futuras) {
    const otras = await prisma.cita.findMany({
      where: { profesionalId: destino.id, deletedAt: null, fecha: c.fecha, estado: { notIn: [...ESTADOS_VIVOS_EXCLUIDOS] } },
      select: { horaInicio: true, duracionMinutos: true, slotRol: true },
    });
    const ini = aMin(c.horaInicio), fin = ini + c.duracionMinutos;
    if (otras.some((o) => aMin(o.horaInicio) < fin && ini < aMin(o.horaInicio) + o.duracionMinutos && (o.slotRol ?? 'PRINCIPAL') === (c.slotRol ?? 'PRINCIPAL'))) {
      choques.push(`${c.fecha.toISOString().slice(0, 10).split('-').reverse().join('/')} ${c.horaInicio}`);
    }
  }
  if (choques.length) {
    throw new AppError(`No se puede fusionar: ${destino.nombres} ${destino.apellidos} ya tiene cita a esa hora (${choques.join(', ')}). Mueve esas citas primero.`, 409, 'CHOQUE_DE_CITAS');
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const de = origen.id, a = destino.id;
    const n = {
      citas: (await tx.cita.updateMany({ where: { profesionalId: de }, data: { profesionalId: a } })).count,
      citasSoloX: (await tx.cita.updateMany({ where: { solicitadoProfesionalId: de }, data: { solicitadoProfesionalId: a } })).count,
      citasAtendio: (await tx.cita.updateMany({ where: { atendidoPorId: de }, data: { atendidoPorId: a } })).count,
      citasMedico: (await tx.cita.updateMany({ where: { medicoId: de }, data: { medicoId: a } })).count,
      atenciones: (await tx.atencionClinica.updateMany({ where: { profesionalId: de }, data: { profesionalId: a } })).count,
      notas: (await tx.notaEvolucion.updateMany({ where: { profesionalId: de }, data: { profesionalId: a } })).count,
      recetas: (await tx.receta.updateMany({ where: { emisorProfesionalId: de }, data: { emisorProfesionalId: a } })).count,
      competenciasSumadas: 0,
      asignacionesCerradas: 0,
      usuarioMovido: false,
    };
    // Competencias: las activas de la vieja que la otra no tenga.
    const yaTiene = new Set((await tx.competenciaProfesional.findMany({ where: { profesionalId: a, activa: true }, select: { servicioId: true } })).map((c) => c.servicioId));
    const faltan = (await tx.competenciaProfesional.findMany({ where: { profesionalId: de, activa: true }, select: { servicioId: true, soloPorSolicitud: true } }))
      .filter((c) => !yaTiene.has(c.servicioId));
    for (const c of faltan) {
      await tx.competenciaProfesional.upsert({
        where: { profesionalId_servicioId: { profesionalId: a, servicioId: c.servicioId } },
        update: { activa: true },
        create: { profesionalId: a, servicioId: c.servicioId, activa: true, soloPorSolicitud: c.soloPorSolicitud, habilitadoDesde: new Date(), creadoPor: p.usuarioId },
      });
    }
    n.competenciasSumadas = faltan.length;
    // Asignaciones de sede vigentes o futuras de la vieja: se apagan (dejan de salir en Movimientos y en la agenda).
    n.asignacionesCerradas = (await tx.asignacionSede.updateMany({
      where: { profesionalId: de, activa: true, OR: [{ fechaFin: null }, { fechaFin: { gte: hoy } }] },
      data: { activa: false },
    })).count;
    // El usuario (si solo la vieja tenía) pasa a la que queda.
    if (origen.usuario && !destino.usuario) {
      await tx.usuario.update({ where: { id: origen.usuario.id }, data: { profesionalId: a } });
      n.usuarioMovido = true;
    }
    await tx.profesional.update({ where: { id: de }, data: { activo: false, deletedAt: new Date() } });
    await auditEnTx(tx, {
      usuarioId: p.usuarioId, ip: p.ip, userAgent: p.userAgent,
      accion: 'fusionar_profesional', entidad: 'profesional', entidadId: a,
      antes: { fichaQuitada: de, nombreQuitado: `${origen.nombres} ${origen.apellidos}`.trim() },
      despues: { fichaQueQueda: a, nombre: `${destino.nombres} ${destino.apellidos}`.trim(), ...n },
    });
    return n;
  });
  return { fichaQueQueda: destino.id, fichaQuitada: origen.id, ...resultado };
}

/** Normaliza para comparar nombres: minúsculas, sin tildes, sin espacios extra. */
export const normalizarNombre = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * ¿Ya existe una ficha que parece la misma persona? Mismo tipo, mismo PRIMER nombre y mismo PRIMER apellido (sin tildes),
 * activa o inactiva. Las «Adicional» no cuentan (son fichas de capacidad, no personas).
 */
export async function posiblesDuplicados(p: { nombres: string; apellidos: string; tipo: string; excluirId?: string }) {
  const n1 = normalizarNombre(p.nombres).split(' ')[0] ?? '';
  const a1 = normalizarNombre(p.apellidos).split(' ')[0] ?? '';
  if (!n1 || !a1 || n1 === 'adicional') return [];
  const candidatas = await prisma.profesional.findMany({
    where: { deletedAt: null, esEquipo: false, tipo: p.tipo as never, ...(p.excluirId ? { id: { not: p.excluirId } } : {}) },
    select: { id: true, nombres: true, apellidos: true, activo: true },
  });
  return candidatas.filter((c) => normalizarNombre(c.nombres).split(' ')[0] === n1 && normalizarNombre(c.apellidos).split(' ')[0] === a1);
}
