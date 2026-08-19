import { Router } from 'express';
import { MotivoMovimiento } from '@prisma/client';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';

const MOTIVOS = Object.values(MotivoMovimiento) as string[];

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
  // `fecha` (opcional): filtra el roster a los doctores cuya asignación de baro RIGE ese día
  // (fechaInicio ≤ fecha ≤ fechaFin|indefinido). Lo usa el combo de médico de Nueva Cita para
  // listar solo a los disponibles en la sede ESA fecha. Sin `fecha` → todos los activos.
  const fecha = typeof req.query.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha) ? req.query.fecha : null;
  const ventana = fecha
    ? { fechaInicio: { lte: new Date(`${fecha}T23:59:59`) }, OR: [{ fechaFin: null }, { fechaFin: { gte: new Date(`${fecha}T00:00:00`) } }] }
    : {};
  const { unidad, servicios } = await baroContexto();

  // Registros de baro por sede (activos + vigentes en la fecha), con datos del médico y la sede.
  const registros = await prisma.baroMedicoSede.findMany({
    where: { activa: true, ...(sedeId ? { sedeId } : {}), profesional: { deletedAt: null }, ...ventana },
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
    // Vigencia temporal de la asignación (para la sección "Baro" de movimientos).
    fechaInicio: r.fechaInicio.toISOString().slice(0, 10),
    fechaFin: r.fechaFin ? r.fechaFin.toISOString().slice(0, 10) : null,
    motivo: r.motivo,
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

  // Citas de baro HOY por médico (solicitado) — solo en la vista GLOBAL (matriz/resumen).
  // El médico de una cita de baro vive en `solicitadoProfesionalId` (la columna es la máquina).
  const citasHoyPorMedico: Record<string, number> = {};
  let citasHoyTotal = 0;
  if (!sedeId) {
    const hoyStr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })).toISOString().slice(0, 10);
    const grp = await prisma.cita.groupBy({
      by: ['solicitadoProfesionalId'],
      where: {
        unidadNegocioId: unidad.id,
        fecha: new Date(`${hoyStr}T00:00:00.000Z`),
        deletedAt: null,
        estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] },
        solicitadoProfesionalId: { not: null },
      },
      _count: { _all: true },
    });
    for (const g of grp) {
      if (g.solicitadoProfesionalId) { citasHoyPorMedico[g.solicitadoProfesionalId] = g._count._all; citasHoyTotal += g._count._all; }
    }
  }

  res.json({ servicios, porSolicitud, disponibles, citasHoyPorMedico, citasHoyTotal });
});

// ─── POST /baro-solicitud/:profesionalId ─── registrar en una sede ───
router.post('/:profesionalId', requireAuth, requirePermiso('movimientos.editar'), async (req, res) => {
  const { servicioIds } = await baroContexto();
  const profesionalId = req.params.profesionalId;
  const sedeId: string | undefined = req.body?.sedeId;
  if (!sedeId) throw new AppError('Se requiere la sede para registrar el médico de baro', 400, 'SEDE_REQUERIDA');

  const prof = await prisma.profesional.findUnique({ where: { id: profesionalId, deletedAt: null }, select: { id: true } });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  const sede = await prisma.sede.findUnique({ where: { id: sedeId }, select: { id: true, nombre: true } });
  if (!sede) throw new AppError('Sede no encontrada', 404);

  // Asignación temporal (opcional): fechaInicio (default hoy), fechaFin (null = indefinido), motivo.
  const b = req.body ?? {};
  const fechaInicio = typeof b.fechaInicio === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.fechaInicio) ? new Date(`${b.fechaInicio}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
  const fechaFin = typeof b.fechaFin === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.fechaFin) ? new Date(`${b.fechaFin}T00:00:00`) : null;
  const motivo = (typeof b.motivo === 'string' && MOTIVOS.includes(b.motivo) ? b.motivo : null) as MotivoMovimiento | null;
  if (fechaFin && fechaFin < fechaInicio) throw new AppError('La fecha de fin no puede ser anterior a la de inicio', 400);

  const DIA = 24 * 60 * 60 * 1000;
  const diaAntes = (d: Date) => new Date(d.getTime() - DIA);

  // REGLA "1 sede por día": un doctor NUNCA está en 2 sedes el mismo día. Al crear el periodo
  // nuevo [fechaInicio, fechaFin] resolvemos solapes con sus OTROS periodos activos (cualquier sede):
  //  · el periodo que lo cubre el día de inicio → se CIERRA el día anterior (deja esa sede ese día).
  //  · una asignación FUTURA dentro del rango → RECORTA el fin del nuevo hasta el día anterior a ella.
  await prisma.$transaction(async (tx) => {
    const activos = await tx.baroMedicoSede.findMany({
      where: { profesionalId, activa: true },
      select: { id: true, sedeId: true, fechaInicio: true, fechaFin: true },
    });

    // 1) Recortar el fin del nuevo si hay una asignación futura que empieza dentro del rango.
    let finEfectivo = fechaFin;
    for (const o of activos) {
      const empiezaDentro = o.fechaInicio > fechaInicio && (fechaFin === null || o.fechaInicio <= fechaFin);
      if (empiezaDentro) {
        const cap = diaAntes(o.fechaInicio);
        if (finEfectivo === null || cap < finEfectivo) finEfectivo = cap;
      }
    }

    // 2) Cerrar (o desactivar) el periodo que cubre el día de inicio del nuevo.
    for (const o of activos) {
      const cubreInicio = o.fechaInicio <= fechaInicio && (o.fechaFin === null || o.fechaFin >= fechaInicio);
      if (!cubreInicio) continue;
      const cierre = diaAntes(fechaInicio);
      if (cierre < o.fechaInicio) {
        // El periodo viejo quedaría vacío (empezaba el mismo día) → lo reemplaza el nuevo.
        await tx.baroMedicoSede.update({ where: { id: o.id }, data: { activa: false } });
      } else {
        await tx.baroMedicoSede.update({ where: { id: o.id }, data: { fechaFin: cierre } });
      }
    }

    // 3) Crear el periodo nuevo.
    await tx.baroMedicoSede.create({
      data: { profesionalId, sedeId, activa: true, fechaInicio, fechaFin: finEfectivo, motivo, creadoPor: req.user?.userId },
    });

    // 4) Competencia "por solicitud" en TODOS los servicios de baro (habilita agendarle).
    for (const servicioId of servicioIds) {
      await tx.competenciaProfesional.upsert({
        where: { profesionalId_servicioId: { profesionalId, servicioId } },
        update: { activa: true, soloPorSolicitud: true },
        create: { profesionalId, servicioId, habilitadoDesde: new Date(), activa: true, soloPorSolicitud: true, creadoPor: req.user?.userId },
      });
    }
  });
  await registrarAudit({
    usuarioId: req.user?.userId, accion: 'baro_solicitud_agregar', entidad: 'profesional', entidadId: profesionalId,
    despues: { soloPorSolicitud: true, sede: sede.nombre }, sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json({ ok: true });
});

// ─── DELETE /baro-solicitud/:profesionalId?sedeId= ─── quitar de una sede ───
router.delete('/:profesionalId', requireAuth, requirePermiso('movimientos.editar'), async (req, res) => {
  const { servicioIds } = await baroContexto();
  const profesionalId = req.params.profesionalId;
  const sedeId = typeof req.query.sedeId === 'string' && req.query.sedeId ? req.query.sedeId : undefined;
  if (!sedeId) throw new AppError('Se requiere la sede para quitar el médico de baro', 400, 'SEDE_REQUERIDA');
  // `hasta` (opcional): CIERRA la asignación en esa fecha (conserva el historial fechaInicio..hasta)
  // en vez de desactivarla. Lo usa MOVER: al cambiar de sede el día X, la sede vieja se cierra en X
  // sin borrar el pasado. Sin `hasta` (la ✕) → se desactiva por completo.
  const hasta = typeof req.query.hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta) ? req.query.hasta : null;

  const hoyCero = new Date(); hoyCero.setHours(0, 0, 0, 0);
  if (hasta) {
    // MOVER: cierra en `hasta` SOLO el/los periodo(s) de esa sede que están vigentes ese día y se
    // extienden más allá (fin null o > hasta). No toca periodos pasados ya cerrados ni futuros.
    const hastaDate = new Date(`${hasta}T00:00:00`);
    await prisma.baroMedicoSede.updateMany({
      where: { profesionalId, sedeId, activa: true, fechaInicio: { lte: hastaDate }, OR: [{ fechaFin: null }, { fechaFin: { gt: hastaDate } }] },
      data: { fechaFin: hastaDate },
    });
  } else {
    // ✕ QUITAR: desactiva los periodos vigentes/futuros de esa sede (fin null o ≥ hoy). Los periodos
    // pasados ya cerrados quedan intactos como historial.
    await prisma.baroMedicoSede.updateMany({
      where: { profesionalId, sedeId, activa: true, OR: [{ fechaFin: null }, { fechaFin: { gte: hoyCero } }] },
      data: { activa: false },
    });
  }

  // Si ya no atiende baro en NINGUNA sede VIGENTE, desactiva también sus competencias por-solicitud.
  // Cuenta solo filas activas y NO cerradas en el pasado (una fila cerrada con `hasta` sigue
  // activa=true, pero si su fechaFin ya pasó no cuenta como sede vigente).
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const quedanSedes = await prisma.baroMedicoSede.count({
    where: { profesionalId, activa: true, OR: [{ fechaFin: null }, { fechaFin: { gte: hoy } }] },
  });
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
