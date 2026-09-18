/**
 * Médico de la cita — escritura (tomar / soltar / asignar), auditada y protegida contra carreras:
 * si dos médicos tocan «Tomar» a la vez, la escritura lleva de guarda el médico que había, así que
 * el segundo recibe 409 con el nombre de quien se la llevó. Las reglas viven en medicoCitaReglas.ts.
 * En un bloque combinado (profilaxis + extra) el médico es el mismo para las dos citas.
 */
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { AuthPayload } from '../middleware/auth';
import { auditEnTx } from './audit';
import { getCitaCompleta } from './citaCompleta';
import { emitirEventoCita } from '../socket';
import { decidirCambioMedico, type AccionMedico } from './medicoCitaReglas';

type Ctx = { usuarioId?: string; ip?: string; userAgent?: string };

const nombreDe = (p: { nombres: string; apellidos: string } | null | undefined) => (p ? `${p.nombres} ${p.apellidos}`.trim() : null);

/** Ficha de médico PERSONA activa del usuario (o null si no es médico). */
export async function medicoDelUsuario(user: AuthPayload) {
  if (!user.profesionalId) return null;
  const p = await prisma.profesional.findFirst({
    where: { id: user.profesionalId, deletedAt: null, activo: true, esEquipo: false, tipo: 'medico' },
    select: { id: true, nombres: true, apellidos: true, colegiatura: true },
  });
  return p;
}

/** ¿Hay una receta médica vigente en la atención de esta cita (o de su bloque)? */
async function tieneRecetaVigente(citaIds: string[]) {
  const n = await prisma.receta.count({
    where: { tipoDocumento: 'RECETA_MEDICA', estado: 'emitida', atencion: { citaId: { in: citaIds } } },
  });
  return n > 0;
}

/** Médicos que se pueden asignar (para el desplegable de admin/coordinación). */
export async function medicosAsignables(sedeId: string) {
  // Primero los que tienen usuario con acceso a la sede (los que de verdad entran al sistema ahí);
  // luego el resto de médicos activos, por si la ficha aún no tiene usuario.
  const medicos = await prisma.profesional.findMany({
    where: { tipo: 'medico', activo: true, esEquipo: false, deletedAt: null },
    select: { id: true, nombres: true, apellidos: true, colegiatura: true, usuario: { select: { activo: true, sedes: { select: { sedeId: true } } } } },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });
  return medicos
    .map((m) => ({
      id: m.id, nombre: nombreDe(m)!, colegiatura: m.colegiatura,
      enEstaSede: !!m.usuario?.activo && m.usuario.sedes.some((s) => s.sedeId === sedeId),
    }))
    .sort((a, b) => Number(b.enEstaSede) - Number(a.enEstaSede));
}

export async function cambiarMedicoCita(p: Ctx & { user: AuthPayload; citaId: string; accion: AccionMedico }) {
  const cita = await prisma.cita.findFirst({
    where: { id: p.citaId, deletedAt: null },
    select: { id: true, estado: true, sedeId: true, fecha: true, slotGrupoId: true, medicoId: true, medico: { select: { nombres: true, apellidos: true } } },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  const hermanas = cita.slotGrupoId
    ? await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, id: { not: cita.id }, deletedAt: null }, select: { id: true, sedeId: true } })
    : [];
  const ids = [cita.id, ...hermanas.map((h) => h.id)];

  const yo = await medicoDelUsuario(p.user);
  const permisos = p.user.permisos ?? [];
  const decision = decidirCambioMedico(
    { profesionalId: yo?.id ?? null, esMedico: !!yo, puedeAsignar: permisos.includes('medico.asignar'), puedeAutoasignar: permisos.includes('medico.autoasignar') },
    { medicoId: cita.medicoId, estado: cita.estado, tieneRecetaVigente: await tieneRecetaVigente(ids) },
    p.accion,
  );
  if (!decision.ok) {
    const quien = decision.code === 'CITA_TOMADA' ? nombreDe(cita.medico) : null;
    throw new AppError(quien ? `Esta cita ya la tomó ${quien}` : decision.mensaje, decision.status, decision.code);
  }
  if (decision.sinCambio) return getCitaCompleta(cita.id);

  // El médico asignado por admin/coordinación debe ser un médico persona activo.
  let nuevo: { id: string; nombres: string; apellidos: string } | null = null;
  if (decision.medicoId) {
    nuevo = await prisma.profesional.findFirst({
      where: { id: decision.medicoId, tipo: 'medico', activo: true, esEquipo: false, deletedAt: null },
      select: { id: true, nombres: true, apellidos: true },
    });
    if (!nuevo) throw new AppError('Ese profesional no es un médico activo', 400, 'MEDICO_INVALIDO');
  }

  const accionAudit = p.accion.accion === 'tomar' ? 'tomar_cita_medico' : p.accion.accion === 'soltar' ? 'soltar_cita_medico' : 'asignar_medico';
  await prisma.$transaction(async (tx) => {
    // Guarda: solo si el médico sigue siendo el que leímos (dos «Tomar» a la vez → uno gana).
    const u = await tx.cita.updateMany({
      where: { id: cita.id, medicoId: cita.medicoId },
      data: { medicoId: decision.medicoId, medicoAsignadoEn: decision.medicoId ? new Date() : null, medicoAsignadoPorId: decision.medicoId ? p.usuarioId ?? null : null },
    });
    if (u.count === 0) {
      const ahora = await tx.cita.findUnique({ where: { id: cita.id }, select: { medico: { select: { nombres: true, apellidos: true } } } });
      const quien = nombreDe(ahora?.medico);
      throw new AppError(quien ? `Otra persona acaba de cambiar el médico: ahora es ${quien}` : 'Otra persona acaba de cambiar el médico de esta cita', 409, 'CAMBIO_CONCURRENTE');
    }
    if (hermanas.length) {
      await tx.cita.updateMany({
        where: { id: { in: hermanas.map((h) => h.id) } },
        data: { medicoId: decision.medicoId, medicoAsignadoEn: decision.medicoId ? new Date() : null, medicoAsignadoPorId: decision.medicoId ? p.usuarioId ?? null : null },
      });
    }
    for (const id of ids) {
      await auditEnTx(tx, {
        citaId: id, usuarioId: p.usuarioId, accion: accionAudit, entidad: 'cita', entidadId: id, sedeId: cita.sedeId, ip: p.ip, userAgent: p.userAgent,
        antes: { medicoId: cita.medicoId, medico: nombreDe(cita.medico) },
        despues: { medicoId: decision.medicoId, medico: nombreDe(nuevo), ...(id !== cita.id ? { cascada: true, slotGrupoId: cita.slotGrupoId } : {}) },
      });
    }
  });

  const fecha = cita.fecha.toISOString().slice(0, 10);
  for (const id of ids) {
    emitirEventoCita({ tipo: 'cita:actualizada', sedeId: cita.sedeId, fecha, cita: (await getCitaCompleta(id)) as never, cambiadoPor: p.usuarioId ?? 'sistema' });
  }
  return getCitaCompleta(cita.id);
}
