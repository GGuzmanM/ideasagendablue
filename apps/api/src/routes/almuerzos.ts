import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { crearAlmuerzo } from '../services/almuerzoService';
import { registrarAudit } from '../services/audit';

const router = Router();

const NOMBRE_PAZ_SOLDAN = 'Paz Soldán';

// ─── GET /almuerzos?sedeId=X[&fecha=YYYY-MM-DD] ──────────────────────────────
// Devuelve bloqueos de tipo ALMUERZO vigentes en la sede para la fecha especificada (o hoy).
router.get('/', requireAuth, async (req, res) => {
  const { sedeId, fecha } = req.query as { sedeId?: string; fecha?: string };
  if (!sedeId) throw new AppError('sedeId requerido', 400);

  const fechaIso = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha
    : new Date().toISOString().split('T')[0]!;
  const fechaStart = new Date(`${fechaIso}T00:00:00.000Z`);
  const fechaEnd = new Date(`${fechaIso}T23:59:59.999Z`);

  const bloqueos = await prisma.bloqueoAgenda.findMany({
    where: {
      sedeId,
      tipo: 'ALMUERZO',
      deletedAt: null,
      OR: [
        { esRecurrente: true, fechaInicio: { lte: fechaEnd }, fechaFin: { gte: fechaStart } },
        { esRecurrente: false, fechaInicio: { lte: fechaEnd }, fechaFin: { gte: fechaStart } },
      ],
    },
    include: {
      profesional: {
        select: { id: true, nombres: true, apellidos: true, tipo: true, colorAvatar: true },
      },
      creadoPorUsuario: { select: { id: true, nombre: true } },
    },
    orderBy: [{ horaInicio: 'asc' }, { profesional: { nombres: 'asc' } }],
  });

  res.json(bloqueos);
});

// ─── GET /almuerzos/profesional/:profesionalId?sedeId=X[&fecha=YYYY-MM-DD] ──────────────────────
router.get('/profesional/:profesionalId', requireAuth, async (req, res) => {
  const { sedeId, fecha } = req.query as { sedeId?: string; fecha?: string };
  if (!sedeId) throw new AppError('sedeId requerido', 400);

  const fechaIso = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha
    : new Date().toISOString().split('T')[0]!;
  const fechaStart = new Date(`${fechaIso}T00:00:00.000Z`);
  const fechaEnd = new Date(`${fechaIso}T23:59:59.999Z`);

  const bloqueo = await prisma.bloqueoAgenda.findFirst({
    where: {
      profesionalId: req.params.profesionalId,
      sedeId,
      tipo: 'ALMUERZO',
      deletedAt: null,
      OR: [
        { esRecurrente: true, fechaInicio: { lte: fechaEnd }, fechaFin: { gte: fechaStart } },
        { esRecurrente: false, fechaInicio: { lte: fechaEnd }, fechaFin: { gte: fechaStart } },
      ],
    },
    include: {
      creadoPorUsuario: { select: { id: true, nombre: true } },
    },
  });

  res.json(bloqueo ?? null);
});

// ─── POST /almuerzos ──────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { profesionalId, sedeId, horaInicio, fecha, esRecurrente } = z
    .object({
      profesionalId: z.string().uuid(),
      sedeId: z.string().uuid(),
      horaInicio: z.enum(['12:00', '13:00', '14:00']),
      fecha: z.string().optional(),
      esRecurrente: z.boolean().optional(),
    })
    .parse(req.body);

  const profesional = await prisma.profesional.findUnique({
    where: { id: profesionalId },
    include: { unidadNegocio: true },
  });
  if (!profesional || !profesional.activo || profesional.deletedAt) {
    throw new AppError('Profesional no encontrado', 404);
  }

  if (profesional.tipo !== 'podologa' && profesional.tipo !== 'fisioterapeuta') {
    throw new AppError('El almuerzo aplica solo a podólogas y fisioterapeutas.', 400);
  }

  if (profesional.tipo === 'fisioterapeuta') {
    const sede = await prisma.sede.findUnique({ where: { id: sedeId }, select: { nombre: true } });
    if (sede?.nombre !== NOMBRE_PAZ_SOLDAN) {
      throw new AppError('Las fisioterapeutas solo están en Paz Soldán.', 400);
    }
  }

  const usuarioId = req.user?.userId;
  if (!usuarioId) throw new AppError('No autenticado', 401);

  try {
    await crearAlmuerzo({ profesionalId, sedeId, horaInicio, creadoPor: usuarioId, fecha, esRecurrente });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear almuerzo';
    if (msg.includes('ya tiene un horario')) throw new AppError(msg, 409);
    if (msg.includes('no tiene asignación')) throw new AppError(msg, 422);
    throw new AppError(msg, 400);
  }

  const fechaIso = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha
    : new Date().toISOString().split('T')[0]!;
  const fechaStart = new Date(`${fechaIso}T00:00:00.000Z`);
  const fechaEnd = new Date(`${fechaIso}T23:59:59.999Z`);

  const creado = await prisma.bloqueoAgenda.findFirst({
    where: {
      profesionalId,
      sedeId,
      tipo: 'ALMUERZO',
      deletedAt: null,
      OR: [
        { esRecurrente: true, fechaInicio: { lte: fechaEnd }, fechaFin: { gte: fechaStart } },
        { esRecurrente: false, fechaInicio: { lte: fechaEnd }, fechaFin: { gte: fechaStart } },
      ],
    },
    include: {
      profesional: { select: { id: true, nombres: true, apellidos: true } },
      creadoPorUsuario: { select: { id: true, nombre: true } },
    },
    orderBy: { creadoEn: 'desc' },
  });

  if (creado) {
    void registrarAudit({
      usuarioId, accion: 'crear', entidad: 'almuerzo', entidadId: creado.id,
      despues: {
        profesionalId: creado.profesionalId, sedeId: creado.sedeId,
        horaInicio: creado.horaInicio, horaFin: creado.horaFin, esRecurrente: creado.esRecurrente,
      },
      sedeId: creado.sedeId ?? undefined,
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  res.status(201).json(creado);
});

// ─── DELETE /almuerzos/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const bloqueo = await prisma.bloqueoAgenda.findUnique({
    where: { id: req.params.id },
  });
  if (!bloqueo || bloqueo.deletedAt) throw new AppError('Bloqueo no encontrado', 404);
  if (bloqueo.tipo !== 'ALMUERZO') {
    throw new AppError('Solo se pueden eliminar bloqueos de tipo almuerzo aquí.', 400);
  }

  await prisma.bloqueoAgenda.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });

  // Audit en AuditLog
  await prisma.auditLog.create({
    data: {
      usuarioId: req.user?.userId,
      accion: 'eliminar',
      entidad: 'almuerzo',
      entidadId: bloqueo.id,
      antes: {
        profesionalId: bloqueo.profesionalId,
        sedeId: bloqueo.sedeId,
        horaInicio: bloqueo.horaInicio,
        horaFin: bloqueo.horaFin,
      },
      despues: { deletedAt: new Date().toISOString() },
      sedeId: bloqueo.sedeId ?? undefined,
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    },
  });

  res.json({ ok: true });
});

export default router;
