import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';

const router = Router();

// Unidad de baropodometría + sus servicios.
async function baroContexto() {
  const unidad = await prisma.unidadNegocio.findFirst({
    where: { nombre: { startsWith: 'Baropodometr' }, deletedAt: null },
    select: { id: true, nombre: true },
  });
  if (!unidad) throw new AppError('No existe la unidad de Baropodometría', 404);
  const servicios = await prisma.servicio.findMany({
    where: { unidadNegocioId: unidad.id, deletedAt: null },
    select: { id: true, nombre: true },
  });
  return { unidad, servicios, servicioIds: servicios.map((s) => s.id) };
}

const esSlotGenerico = (p: { nombres: string; apellidos: string }) =>
  /^baro\s*\d+$/i.test(`${p.nombres} ${p.apellidos}`.trim());

// ─── GET /baro-solicitud?sedeId= ─── roster por-sede + profesionales de esa sede ───
// El registro de "médico de baro" es POR SEDE (tabla baro_medico_sede), independiente de la
// asignación normal de podología. Con `sedeId`: lista solo los médicos registrados en esa
// sede y, para agregar, solo profesionales que trabajan (están asignados) en esa sede.
// Sin `sedeId` (página global): lista todos los registros con su sede.
router.get('/', requireAuth, async (req, res) => {
  const sedeId = typeof req.query.sedeId === 'string' && req.query.sedeId ? req.query.sedeId : null;
  const { servicios } = await baroContexto();

  // Registros de baro por sede (activos), con datos del médico y la sede.
  const registros = await prisma.baroMedicoSede.findMany({
    where: { activa: true, ...(sedeId ? { sedeId } : {}), profesional: { deletedAt: null } },
    include: {
      profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true, activo: true } },
      sede: { select: { id: true, nombre: true } },
    },
    orderBy: [{ profesional: { apellidos: 'asc' } }],
  });

  const porSolicitud = registros.map((r) => ({
    id: r.profesional.id,
    nombre: `${r.profesional.nombres} ${r.profesional.apellidos}`,
    tipo: r.profesional.tipo,
    activo: r.profesional.activo,
    sedeId: r.sede.id,
    sedeNombre: r.sede.nombre,
  }));
  const yaEnSede = new Set(registros.filter((r) => !sedeId || r.sedeId === sedeId).map((r) => r.profesionalId));

  // Profesionales que se pueden AGREGAR: si hay sede, solo los que trabajan (asignados) en
  // ella; si no, todos los activos. Excluye máquinas y los ya registrados en esa sede.
  const todos = await prisma.profesional.findMany({
    where: {
      activo: true,
      deletedAt: null,
      ...(sedeId ? { asignaciones: { some: { sedeId, activa: true } } } : {}),
    },
    select: { id: true, nombres: true, apellidos: true, tipo: true },
    orderBy: [{ apellidos: 'asc' }],
  });
  const disponibles = todos
    .filter((p) => !yaEnSede.has(p.id) && !esSlotGenerico(p))
    .map((p) => ({ id: p.id, nombre: `${p.nombres} ${p.apellidos}`, tipo: p.tipo }));

  res.json({ servicios, porSolicitud, disponibles });
});

// ─── POST /baro-solicitud/:profesionalId ─── registrar en una sede ───
router.post('/:profesionalId', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { servicioIds } = await baroContexto();
  const profesionalId = req.params.profesionalId;
  const sedeId: string | undefined = req.body?.sedeId;
  if (!sedeId) throw new AppError('Se requiere la sede para registrar el médico de baro', 400, 'SEDE_REQUERIDA');

  const prof = await prisma.profesional.findUnique({ where: { id: profesionalId, deletedAt: null }, select: { id: true } });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  const sede = await prisma.sede.findUnique({ where: { id: sedeId }, select: { id: true, nombre: true } });
  if (!sede) throw new AppError('Sede no encontrada', 404);

  // 1) Registro por sede (baro_medico_sede).
  await prisma.baroMedicoSede.upsert({
    where: { profesionalId_sedeId: { profesionalId, sedeId } },
    update: { activa: true },
    create: { profesionalId, sedeId, activa: true, creadoPor: req.user?.userId },
  });
  // 2) Competencia "por solicitud" en TODOS los servicios de baro (habilita agendarle).
  for (const servicioId of servicioIds) {
    await prisma.competenciaProfesional.upsert({
      where: { profesionalId_servicioId: { profesionalId, servicioId } },
      update: { activa: true, soloPorSolicitud: true },
      create: { profesionalId, servicioId, habilitadoDesde: new Date(), activa: true, soloPorSolicitud: true, creadoPor: req.user?.userId },
    });
  }
  await registrarAudit({
    usuarioId: req.user?.userId, accion: 'baro_solicitud_agregar', entidad: 'profesional', entidadId: profesionalId,
    despues: { soloPorSolicitud: true, sede: sede.nombre }, sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json({ ok: true });
});

// ─── DELETE /baro-solicitud/:profesionalId?sedeId= ─── quitar de una sede ───
router.delete('/:profesionalId', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { servicioIds } = await baroContexto();
  const profesionalId = req.params.profesionalId;
  const sedeId = typeof req.query.sedeId === 'string' && req.query.sedeId ? req.query.sedeId : undefined;
  if (!sedeId) throw new AppError('Se requiere la sede para quitar el médico de baro', 400, 'SEDE_REQUERIDA');

  // Desactiva el registro de ESA sede.
  await prisma.baroMedicoSede.updateMany({ where: { profesionalId, sedeId }, data: { activa: false } });

  // Si ya no atiende baro en NINGUNA sede, desactiva también sus competencias por-solicitud.
  const quedanSedes = await prisma.baroMedicoSede.count({ where: { profesionalId, activa: true } });
  let competenciasDesactivadas = 0;
  if (quedanSedes === 0) {
    const r = await prisma.competenciaProfesional.updateMany({
      where: { profesionalId, servicioId: { in: servicioIds }, soloPorSolicitud: true },
      data: { activa: false },
    });
    competenciasDesactivadas = r.count;
  }
  await registrarAudit({
    usuarioId: req.user?.userId, accion: 'baro_solicitud_quitar', entidad: 'profesional', entidadId: profesionalId,
    despues: { sedeId, competenciasDesactivadas, quedanSedes }, sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json({ ok: true });
});

export default router;
