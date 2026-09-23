import { Router, Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { busquedaLimiter } from '../middleware/rateLimits';
import { auditEnTx } from '../services/audit';
import { extraerPosologia } from '../services/posologiaDesdeTexto';

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
      orderBy: [{ frecuente: 'desc' }, { categoria: 'asc' }, { codigo: 'asc' }],
      take: limit,
    });
  } else {
    filas = await prisma.$queryRaw<
      { codigo: string; descripcion: string; categoria: string | null; frecuente: boolean }[]
    >`
      SELECT codigo, descripcion, categoria, frecuente
      FROM cie10
      WHERE activo = true
        AND (codigo ILIKE ${q + '%'} OR descripcion ILIKE ${'%' + q + '%'})
      ORDER BY
        (codigo ILIKE ${q + '%'}) DESC,
        frecuente DESC,
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
// Códigos CIE-10 y los propios de la clínica que vienen del ERP («000» Otros, «000.1» Tratamiento preventivo).
const RE_CIE10 = /^([A-Z][0-9]{2}|[0-9]{3})(\.[0-9A-Z]{1,4})?$/;
function gestionaCatalogo(req: Request, _res: Response, next: NextFunction) {
  if (!ROLES_CATALOGO.includes(req.user?.rol ?? '')) throw new AppError('Solo administración, coordinación o médicos gestionan el catálogo CIE-10', 403, 'SIN_PERMISO');
  next();
}
/** AuditLog.entidadId es uuid: se deriva uno ESTABLE del código (mismo código → mismo id, agrupa su historial). */
function uuidDeTexto(texto: string): string {
  const h = createHash('sha1').update(texto).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const cie10Select = { codigo: true, descripcion: true, categoria: true, activo: true, frecuente: true, _count: { select: { diagnosticos: true, tratamientos: { where: { activo: true } } } } } as const;
const aCie10Admin = (r: { codigo: string; descripcion: string; categoria: string | null; activo: boolean; frecuente: boolean; _count: { diagnosticos: number; tratamientos: number } }) =>
  ({ codigo: r.codigo, descripcion: r.descripcion, categoria: r.categoria, activo: r.activo, frecuente: r.frecuente, usos: r._count.diagnosticos, tratamientos: r._count.tratamientos });
const cie10CrearSchema = z.object({
  codigo: z.string().trim().toUpperCase().regex(RE_CIE10, 'Código CIE-10 no válido (ej. L84 o B35.1)'),
  descripcion: z.string().trim().min(3).max(300),
  categoria: z.string().trim().max(120).nullable().optional(),
});
const cie10EditarSchema = z.object({
  descripcion: z.string().trim().min(3).max(300).optional(),
  categoria: z.string().trim().max(120).nullable().optional(),
  activo: z.boolean().optional(),
  frecuente: z.boolean().optional(), // sale en la lista rápida de diagnósticos frecuentes
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
  const antes = await prisma.cie10.findUnique({ where: { codigo }, select: { descripcion: true, categoria: true, activo: true, frecuente: true } });
  if (!antes) throw new AppError('Código CIE-10 no encontrado', 404);
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.cie10.update({
      where: { codigo },
      data: { ...(d.descripcion !== undefined ? { descripcion: d.descripcion } : {}), ...(d.categoria !== undefined ? { categoria: d.categoria || null } : {}), ...(d.activo !== undefined ? { activo: d.activo } : {}), ...(d.frecuente !== undefined ? { frecuente: d.frecuente } : {}) },
      select: cie10Select,
    });
    await auditEnTx(tx, { usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined, accion: 'editar_cie10', entidad: 'cie10', entidadId: uuidDeTexto(`cie10:${codigo}`), antes: { codigo, ...antes }, despues: { codigo, descripcion: r.descripcion, categoria: r.categoria, activo: r.activo, frecuente: r.frecuente } });
    return r;
  });
  res.json(aCie10Admin(row));
});

// ─── Diagnósticos frecuentes y tratamientos habituales por diagnóstico (23-sep-2026) ───────────────────────────
// Lista del ERP (DIAGNOSTICO_CIE10 + diagnostico_cie10_plan). Al diagnosticar se elige de la lista de frecuentes; al
// hacer la receta, el diagnóstico elegido ofrece sus tratamientos con checks. Se gestionan como el catálogo CIE-10.

// GET /catalogos/cie10/frecuentes — los diagnósticos más usados, con cuántos tratamientos habituales tiene cada uno
router.get('/cie10/frecuentes', requireAuth, async (_req, res) => {
  const filas = await prisma.cie10.findMany({
    where: { activo: true, frecuente: true },
    orderBy: { codigo: 'asc' },
    select: { codigo: true, descripcion: true, categoria: true, frecuente: true, _count: { select: { tratamientos: { where: { activo: true } } } } },
  });
  res.json(filas.map((f) => ({ codigo: f.codigo, descripcion: f.descripcion, categoria: f.categoria, frecuente: f.frecuente, tratamientos: f._count.tratamientos })));
});

const tratamientoSelect = {
  id: true, cie10Codigo: true, orden: true, tratamiento: true, presentacion: true, aplicacion: true, tipo: true, marca: true, activo: true,
  dosis: true, via: true, frecuencia: true, duracion: true, indicaciones: true,
  medicamento: { select: { id: true, dci: true, concentracion: true, formaFarmaceutica: true, viaAdministracion: true, nombresComerciales: true, requiereReceta: true, esProducto: true, posologiaSugerida: true } },
  servicio: { select: { id: true, nombre: true } },
} as const;

// GET /catalogos/tratamientos-diagnostico?codigo=B35.1[&inactivos=1] — tratamientos habituales de un diagnóstico
router.get('/tratamientos-diagnostico', requireAuth, async (req, res) => {
  const codigo = typeof req.query.codigo === 'string' ? req.query.codigo.trim().toUpperCase() : '';
  if (!codigo) throw new AppError('Indica el código del diagnóstico', 400, 'CODIGO_REQUERIDO');
  const filas = await prisma.tratamientoDiagnostico.findMany({
    where: { cie10Codigo: codigo, ...(req.query.inactivos === '1' ? {} : { activo: true }) },
    orderBy: [{ orden: 'asc' }, { tratamiento: 'asc' }],
    select: tratamientoSelect,
  });
  res.json(filas);
});

const tratamientoSchema = z.object({
  cie10Codigo: z.string().trim().toUpperCase().regex(RE_CIE10, 'Código CIE-10 no válido'),
  tratamiento: z.string().trim().min(2).max(300),
  presentacion: z.string().trim().max(120).nullable().optional(),
  aplicacion: z.string().trim().max(1500).nullable().optional(),
  tipo: z.enum(['MEDICAMENTO_RX', 'MEDICAMENTO_OTC', 'PRODUCTO', 'SERVICIO']),
  medicamentoId: z.string().trim().max(120).nullable().optional(),
  servicioId: z.string().uuid().nullable().optional(),
  marca: z.string().trim().max(80).nullable().optional(),
  // Posología por defecto (la receta sale llena; el médico valida). Si al crear no se manda, se lee de la aplicación.
  dosis: z.string().trim().max(60).nullable().optional(),
  via: z.string().trim().max(40).nullable().optional(),
  frecuencia: z.string().trim().max(80).nullable().optional(),
  duracion: z.string().trim().max(60).nullable().optional(),
  indicaciones: z.string().trim().max(1500).nullable().optional(),
  orden: z.number().int().min(0).max(9999).optional(),
  activo: z.boolean().optional(),
});
type TipoItem = 'MEDICAMENTO_RX' | 'MEDICAMENTO_OTC' | 'PRODUCTO' | 'SERVICIO';
/** El tipo lo manda el vademécum cuando hay vínculo (un fármaco de receta no puede quedar como venta libre). */
async function tipoCoherente(d: { tipo: string; medicamentoId?: string | null; servicioId?: string | null }): Promise<TipoItem> {
  if (d.servicioId) return 'SERVICIO';
  if (d.medicamentoId) {
    const m = await prisma.medicamento.findUnique({ where: { id: d.medicamentoId }, select: { requiereReceta: true, esProducto: true } });
    if (!m) throw new AppError('Ese medicamento no está en el vademécum', 400, 'MEDICAMENTO_INVALIDO');
    return m.esProducto ? 'PRODUCTO' : m.requiereReceta ? 'MEDICAMENTO_RX' : 'MEDICAMENTO_OTC';
  }
  return d.tipo as TipoItem;
}
const CAMPOS_POSOLOGIA = ['dosis', 'via', 'frecuencia', 'duracion', 'indicaciones'] as const;

// POST /catalogos/tratamientos-diagnostico/extraer-posologia { texto, conVademecum } — separa dosis / vía / frecuencia /
// duración de un texto libre («01 tab vía oral c/8h por 3 días»). Lo usa el botón «Leer de la aplicación» del diálogo.
router.post('/tratamientos-diagnostico/extraer-posologia', requireAuth, (req, res) => {
  const d = z.object({ texto: z.string().max(1500).nullable().optional(), conVademecum: z.boolean().optional() }).parse(req.body);
  res.json(extraerPosologia(d.texto, !!d.conVademecum));
});

const ctxAudit = (req: Request) => ({ usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });

router.post('/tratamientos-diagnostico', requireAuth, requirePermiso('hc.registrar'), gestionaCatalogo, async (req, res) => {
  const d = tratamientoSchema.parse(req.body);
  const dx = await prisma.cie10.findUnique({ where: { codigo: d.cie10Codigo }, select: { codigo: true } });
  if (!dx) throw new AppError('Ese diagnóstico no está en el catálogo', 404, 'CIE10_INVALIDO');
  const tipo = await tipoCoherente(d);
  const orden = d.orden ?? ((await prisma.tratamientoDiagnostico.aggregate({ where: { cie10Codigo: d.cie10Codigo }, _max: { orden: true } }))._max.orden ?? 0) + 1;
  // Sin posología explícita → se lee de la aplicación (mismo lector que la importación del ERP)
  const pos = CAMPOS_POSOLOGIA.some((k) => d[k] !== undefined)
    ? { dosis: d.dosis || null, via: d.via || null, frecuencia: d.frecuencia || null, duracion: d.duracion || null, indicaciones: d.indicaciones || null }
    : extraerPosologia(d.aplicacion, !!d.medicamentoId && tipo !== 'PRODUCTO');
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.tratamientoDiagnostico.create({
      data: { cie10Codigo: d.cie10Codigo, tratamiento: d.tratamiento, presentacion: d.presentacion || null, aplicacion: d.aplicacion || null, tipo, medicamentoId: d.medicamentoId || null, servicioId: d.servicioId || null, marca: d.marca || null, orden, activo: d.activo ?? true, ...pos },
      select: tratamientoSelect,
    });
    await auditEnTx(tx, { ...ctxAudit(req), accion: 'crear_tratamiento_dx', entidad: 'tratamiento_diagnostico', entidadId: r.id, despues: { cie10Codigo: r.cie10Codigo, tratamiento: r.tratamiento, presentacion: r.presentacion, aplicacion: r.aplicacion, tipo: r.tipo, dosis: r.dosis, via: r.via, frecuencia: r.frecuencia, duracion: r.duracion, indicaciones: r.indicaciones } });
    return r;
  });
  res.status(201).json(row);
});

router.patch('/tratamientos-diagnostico/:id', requireAuth, requirePermiso('hc.registrar'), gestionaCatalogo, async (req, res) => {
  const d = tratamientoSchema.partial().omit({ cie10Codigo: true }).parse(req.body);
  const antes = await prisma.tratamientoDiagnostico.findUnique({ where: { id: String(req.params.id) } });
  if (!antes) throw new AppError('Tratamiento no encontrado', 404);
  const medicamentoId = d.medicamentoId !== undefined ? d.medicamentoId || null : antes.medicamentoId;
  const servicioId = d.servicioId !== undefined ? d.servicioId || null : antes.servicioId;
  const tipo = await tipoCoherente({ tipo: d.tipo ?? antes.tipo, medicamentoId, servicioId });
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.tratamientoDiagnostico.update({
      where: { id: antes.id },
      data: {
        ...(d.tratamiento !== undefined ? { tratamiento: d.tratamiento } : {}),
        ...(d.presentacion !== undefined ? { presentacion: d.presentacion || null } : {}),
        ...(d.aplicacion !== undefined ? { aplicacion: d.aplicacion || null } : {}),
        ...(d.marca !== undefined ? { marca: d.marca || null } : {}),
        ...Object.fromEntries(CAMPOS_POSOLOGIA.filter((k) => d[k] !== undefined).map((k) => [k, d[k] || null])),
        ...(d.orden !== undefined ? { orden: d.orden } : {}),
        ...(d.activo !== undefined ? { activo: d.activo } : {}),
        medicamentoId, servicioId, tipo,
      },
      select: tratamientoSelect,
    });
    await auditEnTx(tx, { ...ctxAudit(req), accion: 'editar_tratamiento_dx', entidad: 'tratamiento_diagnostico', entidadId: r.id,
      antes: { tratamiento: antes.tratamiento, presentacion: antes.presentacion, aplicacion: antes.aplicacion, tipo: antes.tipo, activo: antes.activo,
        dosis: antes.dosis, via: antes.via, frecuencia: antes.frecuencia, duracion: antes.duracion, indicaciones: antes.indicaciones },
      despues: { tratamiento: r.tratamiento, presentacion: r.presentacion, aplicacion: r.aplicacion, tipo: r.tipo, activo: r.activo,
        dosis: r.dosis, via: r.via, frecuencia: r.frecuencia, duracion: r.duracion, indicaciones: r.indicaciones } });
    return r;
  });
  res.json(row);
});

export default router;
