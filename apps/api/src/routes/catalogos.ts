import { Router, Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { busquedaLimiter } from '../middleware/rateLimits';
import { auditEnTx } from '../services/audit';

// ─── Catálogos clínicos de referencia (base de la receta — Fase 2 del plan HCE) ──
// Solo LECTURA. Data de referencia (no data de paciente), por eso basta con estar
// autenticado; los permisos clínicos finos (hc.ver / receta.emitir) llegan con la
// Fase 1/2. Búsqueda difusa por nombre con pg_trgm (similarity + ILIKE).
const router = Router();

const buscarSchema = z.object({
  q: z.string().trim().max(80).optional().default(''),
  grupo: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

// ─── GET /catalogos/cie10?q=&limit= ───────────────────────────────────────────
// Diagnósticos CIE-10 (subset curado de la clínica del pie). Busca por código o por
// descripción; ordena por prefijo de código exacto y luego por similitud.
router.get('/cie10', requireAuth, busquedaLimiter, async (req, res) => {
  const { q, limit } = buscarSchema.parse(req.query);

  let filas;
  if (!q) {
    filas = await prisma.cie10.findMany({
      where: { activo: true },
      orderBy: [{ categoria: 'asc' }, { codigo: 'asc' }],
      take: limit,
    });
  } else {
    filas = await prisma.$queryRaw<
      { codigo: string; descripcion: string; categoria: string | null }[]
    >`
      SELECT codigo, descripcion, categoria
      FROM cie10
      WHERE activo = true
        AND (codigo ILIKE ${q + '%'} OR descripcion ILIKE ${'%' + q + '%'})
      ORDER BY
        (codigo ILIKE ${q + '%'}) DESC,
        similarity(descripcion, ${q}) DESC,
        codigo ASC
      LIMIT ${limit}
    `;
  }
  res.json(filas);
});

// ─── GET /catalogos/medicamentos?q=&grupo=&limit= ─────────────────────────────
// Vademécum curado. Busca por DCI (principio activo), código ATC o nombre comercial
// (marca → genérico). `grupo` filtra por categoría. Ordena por similitud de nombre.
router.get('/medicamentos', requireAuth, busquedaLimiter, async (req, res) => {
  const { q, grupo, limit } = buscarSchema.parse(req.query);

  let filas;
  if (!q) {
    filas = await prisma.medicamento.findMany({
      where: { activo: true, ...(grupo ? { grupo } : {}) },
      orderBy: [{ grupo: 'asc' }, { dci: 'asc' }],
      take: limit,
    });
  } else {
    const like = '%' + q + '%';
    filas = await prisma.$queryRaw<
      {
        id: string;
        dci: string;
        codigoAtc: string | null;
        codigoDigemid: string | null;
        concentracion: string | null;
        formaFarmaceutica: string | null;
        viaAdministracion: string | null;
        nombresComerciales: string | null;
        grupo: string | null;
        requiereReceta: boolean;
        esProducto: boolean;
        posologiaSugerida: string | null;
      }[]
    >`
      SELECT id, dci, "codigoAtc", "codigoDigemid", concentracion,
             "formaFarmaceutica", "viaAdministracion", "nombresComerciales", grupo,
             "requiereReceta", "esProducto", "posologiaSugerida"
      FROM medicamentos
      WHERE activo = true
        ${grupo ? Prisma.sql`AND grupo = ${grupo}` : Prisma.empty}
        AND (
          dci ILIKE ${like}
          OR "codigoAtc" ILIKE ${like}
          OR "nombresComerciales" ILIKE ${like}
          OR concentracion ILIKE ${like}
        )
      ORDER BY
        similarity(dci || ' ' || COALESCE("nombresComerciales", ''), ${q}) DESC,
        dci ASC
      LIMIT ${limit}
    `;
  }
  res.json(filas);
});

// ─── Gestión del catálogo CIE-10 (D3) ─────────────────────────────────────────
// Administración, coordinación y médicos agregan códigos y los activan / desactivan. Nada se borra:
// un código ya usado en diagnósticos solo se desactiva (deja de salir en la búsqueda). Auditado.
const ROLES_CATALOGO = ['admin', 'coordinadora_sedes', 'medico'];
const RE_CIE10 = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;
function gestionaCatalogo(req: Request, _res: Response, next: NextFunction) {
  if (!ROLES_CATALOGO.includes(req.user?.rol ?? '')) throw new AppError('Solo administración, coordinación o médicos gestionan el catálogo CIE-10', 403, 'SIN_PERMISO');
  next();
}
/** AuditLog.entidadId es uuid: se deriva uno ESTABLE del código (mismo código → mismo id, agrupa su historial). */
function uuidDeTexto(texto: string): string {
  const h = createHash('sha1').update(texto).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const cie10Select = { codigo: true, descripcion: true, categoria: true, activo: true, _count: { select: { diagnosticos: true } } } as const;
const aCie10Admin = (r: { codigo: string; descripcion: string; categoria: string | null; activo: boolean; _count: { diagnosticos: number } }) =>
  ({ codigo: r.codigo, descripcion: r.descripcion, categoria: r.categoria, activo: r.activo, usos: r._count.diagnosticos });
const cie10CrearSchema = z.object({
  codigo: z.string().trim().toUpperCase().regex(RE_CIE10, 'Código CIE-10 no válido (ej. L84 o B35.1)'),
  descripcion: z.string().trim().min(3).max(300),
  categoria: z.string().trim().max(120).nullable().optional(),
});
const cie10EditarSchema = z.object({
  descripcion: z.string().trim().min(3).max(300).optional(),
  categoria: z.string().trim().max(120).nullable().optional(),
  activo: z.boolean().optional(),
});

// GET /catalogos/cie10/admin?q=&inactivos=1 — todo el catálogo (incluye inactivos si se pide) + categorías
router.get('/cie10/admin', requireAuth, requirePermiso('hc.ver'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const inactivos = req.query.inactivos === '1';
  const [filas, cats] = await Promise.all([
    prisma.cie10.findMany({
      where: {
        ...(inactivos ? {} : { activo: true }),
        ...(q ? { OR: [{ codigo: { startsWith: q.toUpperCase() } }, { descripcion: { contains: q, mode: 'insensitive' as const } }] } : {}),
      },
      orderBy: [{ categoria: 'asc' }, { codigo: 'asc' }],
      take: 500,
      select: cie10Select,
    }),
    prisma.cie10.findMany({ where: { categoria: { not: null } }, distinct: ['categoria'], select: { categoria: true }, orderBy: { categoria: 'asc' } }),
  ]);
  res.json({ items: filas.map(aCie10Admin), categorias: cats.map((c) => c.categoria).filter(Boolean) });
});

router.post('/cie10', requireAuth, requirePermiso('hc.registrar'), gestionaCatalogo, async (req, res) => {
  const d = cie10CrearSchema.parse(req.body);
  const ya = await prisma.cie10.findUnique({ where: { codigo: d.codigo }, select: { activo: true } });
  if (ya) throw new AppError(ya.activo ? `El código ${d.codigo} ya está en el catálogo` : `El código ${d.codigo} ya existe pero está inactivo: actívalo en la lista`, 409, 'CIE10_DUPLICADO');
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.cie10.create({ data: { codigo: d.codigo, descripcion: d.descripcion, categoria: d.categoria || null }, select: cie10Select });
    await auditEnTx(tx, { usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined, accion: 'crear_cie10', entidad: 'cie10', entidadId: uuidDeTexto(`cie10:${d.codigo}`), despues: { codigo: r.codigo, descripcion: r.descripcion, categoria: r.categoria } });
    return r;
  });
  res.status(201).json(aCie10Admin(row));
});

router.patch('/cie10/:codigo', requireAuth, requirePermiso('hc.registrar'), gestionaCatalogo, async (req, res) => {
  const codigo = String(req.params.codigo).trim().toUpperCase();
  const d = cie10EditarSchema.parse(req.body);
  const antes = await prisma.cie10.findUnique({ where: { codigo }, select: { descripcion: true, categoria: true, activo: true } });
  if (!antes) throw new AppError('Código CIE-10 no encontrado', 404);
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.cie10.update({
      where: { codigo },
      data: { ...(d.descripcion !== undefined ? { descripcion: d.descripcion } : {}), ...(d.categoria !== undefined ? { categoria: d.categoria || null } : {}), ...(d.activo !== undefined ? { activo: d.activo } : {}) },
      select: cie10Select,
    });
    await auditEnTx(tx, { usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined, accion: 'editar_cie10', entidad: 'cie10', entidadId: uuidDeTexto(`cie10:${codigo}`), antes: { codigo, ...antes }, despues: { codigo, descripcion: r.descripcion, categoria: r.categoria, activo: r.activo } });
    return r;
  });
  res.json(aCie10Admin(row));
});

export default router;
