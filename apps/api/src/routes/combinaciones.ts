import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from '../services/audit';

const router = Router();
const requireAdmin = requirePermiso('config.editar');

// Servicio embebido en respuestas de combinación (para selectores del frontend).
const servicioSelect = {
  id: true, nombre: true, color: true, duracionMinutos: true, unidadNegocioId: true, activo: true,
} as const;

// ─── GET /combinaciones/config ────────────────────────────────────────────────
// Lectura para el POPOVER (cualquier usuario autenticado): el servicio ancla
// configurado + los extras ACTIVOS permitidos. Si no hay ancla, el toggle no aparece.
router.get('/config', requireAuth, async (_req, res) => {
  const [servicioAnclaId, combinables] = await Promise.all([
    prisma.configuracionSistema
      .findFirst({ orderBy: { actualizadoEn: 'desc' }, select: { servicioAnclaId: true } })
      .then((c) => c?.servicioAnclaId ?? null),
    prisma.combinacionPermitida.findMany({
      where: { activo: true, deletedAt: null },
      include: { servicio: { select: servicioSelect } },
      orderBy: { creadoEn: 'asc' },
    }),
  ]);
  res.json({
    servicioAnclaId,
    combinables: combinables.map((c) => ({ id: c.id, servicioExtraId: c.servicioExtraId, servicio: c.servicio })),
  });
});

// ─── GET /combinaciones/anclas ─────────────────────────────────────────────────
// Lista de servicios que tienen al menos una combinación configurada (como ancla).
// Incluye la ancla de ConfiguracionSistema aunque no tenga combinables.
router.get('/anclas', requireAuth, requireAdmin, async (_req, res) => {
  // Ancla global configurada
  const cfgAnclaId = await prisma.configuracionSistema
    .findFirst({ orderBy: { actualizadoEn: 'desc' }, select: { servicioAnclaId: true } })
    .then((c) => c?.servicioAnclaId ?? null);

  // IDs de anclas que tienen combinaciones registradas
  const grupos = await prisma.combinacionPermitida.groupBy({
    by: ['servicioAnclaId'],
    where: { deletedAt: null, servicioAnclaId: { not: null } },
  });

  const anclaIds = new Set<string>(grupos.map((g) => g.servicioAnclaId!).filter(Boolean));
  if (cfgAnclaId) anclaIds.add(cfgAnclaId);

  if (anclaIds.size === 0) { res.json([]); return; }

  const servicios = await prisma.servicio.findMany({
    where: { id: { in: Array.from(anclaIds) }, deletedAt: null },
    select: servicioSelect,
    orderBy: { nombre: 'asc' },
  });

  res.json(servicios);
});

// ─── GET /combinaciones/admin ─────────────────────────────────────────────────
// Gestión (admin): incluye inactivos. Acepta ?anclaId= para filtrar por ancla.
// Compatibilidad legada: también incluye registros con servicioAnclaId=null cuando
// el anclaId solicitado coincide con la ancla global (ConfiguracionSistema).
router.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  const { anclaId } = req.query as { anclaId?: string };

  // Determinar si hay registros legados (servicioAnclaId=null) para la ancla global
  let incluirNulos = false;
  if (anclaId) {
    const globalAncla = await prisma.configuracionSistema
      .findFirst({ orderBy: { actualizadoEn: 'desc' }, select: { servicioAnclaId: true } })
      .then((c) => c?.servicioAnclaId ?? null);
    incluirNulos = globalAncla === anclaId;
  }

  const whereClause = anclaId
    ? incluirNulos
      // Para la ancla global: registros de esa ancla + registros legacy null
      ? { deletedAt: null, OR: [{ servicioAnclaId: anclaId }, { servicioAnclaId: null }] }
      // Para otras anclas: solo los de esa ancla
      : { deletedAt: null, servicioAnclaId: anclaId }
    // Sin filtro: todos
    : { deletedAt: null };

  const combinaciones = await prisma.combinacionPermitida.findMany({
    where: whereClause as any,
    include: { servicio: { select: servicioSelect } },
    orderBy: { creadoEn: 'asc' },
  });
  res.json(combinaciones.map((c) => ({
    id: c.id,
    servicioAnclaId: c.servicioAnclaId,
    servicioExtraId: c.servicioExtraId,
    activo: c.activo,
    servicio: c.servicio,
  })));
});

// ─── PUT /combinaciones/ancla ─────────────────────────────────────────────────
// Define (o limpia) el servicio ancla "por defecto" para el popover de la agenda.
router.put('/ancla', requireAuth, requireAdmin, async (req, res) => {
  const { servicioAnclaId } = z
    .object({ servicioAnclaId: z.string().uuid().nullable() })
    .parse(req.body);

  if (servicioAnclaId) {
    const srv = await prisma.servicio.findUnique({ where: { id: servicioAnclaId } });
    if (!srv || srv.deletedAt) throw new AppError('Servicio ancla no encontrado', 404);
  }

  const existente = await prisma.configuracionSistema.findFirst({ orderBy: { actualizadoEn: 'desc' } });

  const guardado = await prisma.$transaction(async (tx) => {
    const cfg = existente
      ? await tx.configuracionSistema.update({ where: { id: existente.id }, data: { servicioAnclaId } })
      : await tx.configuracionSistema.create({ data: { servicioAnclaId } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'config_ancla_combinacion',
      entidad: 'configuracion_sistema',
      entidadId: cfg.id,
      antes: { servicioAnclaId: existente?.servicioAnclaId ?? null },
      despues: { servicioAnclaId },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    return cfg;
  });

  res.json({ servicioAnclaId: guardado.servicioAnclaId });
});

// ─── POST /combinaciones ──────────────────────────────────────────────────────
// Agrega un servicio extra combinable asociado a un ancla específica.
// Si ya existe con soft-delete, lo reactiva.
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { servicioExtraId, servicioAnclaId } = z.object({
    servicioExtraId: z.string().uuid(),
    servicioAnclaId: z.string().uuid().optional().nullable(),
  }).parse(req.body);

  const srv = await prisma.servicio.findUnique({ where: { id: servicioExtraId } });
  if (!srv || srv.deletedAt) throw new AppError('Servicio no encontrado', 404);

  // Validar que el extra no sea el mismo que el ancla
  if (servicioAnclaId && servicioAnclaId === servicioExtraId) {
    throw new AppError('El servicio ancla no puede ser su propio extra combinable', 400, 'ANCLA_NO_ES_EXTRA');
  }

  // Verificar si ya existe un combinable activo para el mismo par ancla+extra
  const existente = await prisma.combinacionPermitida.findFirst({
    where: {
      servicioExtraId,
      servicioAnclaId: servicioAnclaId ?? null,
      deletedAt: null,
    },
  });
  if (existente?.activo) throw new AppError('Ese servicio ya está en la lista de combinables para esta ancla', 409, 'COMBINACION_DUPLICADA');

  const guardado = await prisma.$transaction(async (tx) => {
    const c = existente
      ? await tx.combinacionPermitida.update({ where: { id: existente.id }, data: { activo: true, deletedAt: null } })
      : await tx.combinacionPermitida.create({
          data: {
            servicioExtraId,
            servicioAnclaId: servicioAnclaId ?? null,
            creadoPor: req.user?.userId,
          },
        });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: existente ? 'reactivar_combinacion' : 'crear_combinacion',
      entidad: 'combinacion_permitida',
      entidadId: c.id,
      despues: { servicioAnclaId, servicioExtraId, activo: true },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    return c;
  });

  const conServicio = await prisma.combinacionPermitida.findUnique({
    where: { id: guardado.id }, include: { servicio: { select: servicioSelect } },
  });
  res.status(201).json(conServicio);
});

// ─── PATCH /combinaciones/:id ─────────────────────────────────────────────────
// Activar / desactivar un combinable sin perderlo de la lista.
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
  const existente = await prisma.combinacionPermitida.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existente) throw new AppError('Combinación no encontrada', 404);

  await prisma.$transaction(async (tx) => {
    await tx.combinacionPermitida.update({ where: { id: existente.id }, data: { activo } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: activo ? 'activar_combinacion' : 'desactivar_combinacion',
      entidad: 'combinacion_permitida',
      entidadId: existente.id,
      antes: { activo: existente.activo },
      despues: { activo },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });

  const conServicio = await prisma.combinacionPermitida.findUnique({
    where: { id: existente.id }, include: { servicio: { select: servicioSelect } },
  });
  res.json(conServicio);
});

// ─── DELETE /combinaciones/:id ────────────────────────────────────────────────
// Quita de la lista (soft-delete). No afecta bloques ya creados.
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existente = await prisma.combinacionPermitida.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existente) throw new AppError('Combinación no encontrada', 404);

  await prisma.$transaction(async (tx) => {
    await tx.combinacionPermitida.update({ where: { id: existente.id }, data: { activo: false, deletedAt: new Date() } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'eliminar_combinacion',
      entidad: 'combinacion_permitida',
      entidadId: existente.id,
      antes: { servicioExtraId: existente.servicioExtraId, activo: existente.activo },
      despues: { deletedAt: new Date().toISOString() },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });

  res.json({ ok: true });
});

export default router;
