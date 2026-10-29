import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx, registrarAudit } from '../services/audit';
import { catalogo } from '../services/reservaWeb/reservaWebService';
import { precioWebEnSede } from '../services/reservaWeb/precios';

const router = Router();

// Include de subcategorías ACTIVAS ordenadas — se adjunta a cada servicio para que
// la agenda/membresías sepan si hay que elegir una (Profilaxis → Regular/Premium/…).
const subcategoriasInclude = {
  subcategorias: {
    where: { deletedAt: null, activo: true },
    orderBy: [{ orden: 'asc' as const }, { nombre: 'asc' as const }],
    select: { id: true, nombre: true, precioReferencial: true, orden: true },
  },
};

router.get('/', requireAuth, async (req, res) => {
  const { unidadNegocioId, activo } = req.query as Record<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { deletedAt: null };
  if (unidadNegocioId) where.unidadNegocioId = unidadNegocioId;
  if (activo !== undefined) where.activo = activo === 'true';

  const servicios = await prisma.servicio.findMany({
    where,
    include: { unidadNegocio: { select: { id: true, nombre: true, color: true } }, ...subcategoriasInclude },
    // `orden` manual primero (Promociones mantiene su secuencia); el resto (orden=0) alfabético.
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
  });

  res.json(servicios);
});

// ─── Reserva web (29-oct-2026): qué servicios se ofrecen en línea y a qué precio ──────────────────────────────────
// Los mismos campos que usa la reserva web (página /reserva y API del chat): servicios.reservaOnline + precioOnline y, por
// tipo, subcategorias_servicio.reservaOnline + precioOnline. Precio vacío = se usa el referencial. Lo que se ve en el
// catálogo público sale de reservaWebService.catalogo(): aquí se marca cuáles de verdad se ofrecen y, si no, por qué.
// (Va antes de `/:id` para que «reserva-web» no se tome como un id.)
const precioWeb = z.number().positive('El precio debe ser mayor que 0').max(100000).nullable();
const aNum = (v: unknown) => (v == null ? null : Number(v));

// 30-oct-2026: cada sede puede tener su propio precio web (servicio_precio_web_sede / subcategoria_precio_web_sede). Sin precio
// en una sede rige el general. El orden de precedencia vive en services/reservaWeb/precios.ts.
router.get('/reserva-web', requireAuth, requirePermiso('servicios.ver'), async (_req, res) => {
  const [servicios, cat, sedes, sedeUnidades, preciosServicio, preciosTipo] = await Promise.all([
    prisma.servicio.findMany({
      where: { deletedAt: null, activo: true },
      include: {
        unidadNegocio: { select: { id: true, nombre: true, modoReserva: true, activa: true } },
        subcategorias: { where: { deletedAt: null, activo: true }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] },
      },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    }),
    catalogo(),
    prisma.sede.findMany({ where: { activa: true, deletedAt: null }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], select: { id: true, nombre: true } }),
    prisma.sedeUnidadNegocio.findMany({ select: { sedeId: true, unidadNegocioId: true } }),
    prisma.servicioPrecioWebSede.findMany(),
    prisma.subcategoriaPrecioWebSede.findMany(),
  ]);
  const ofrecidos = new Map(cat.servicios.map((s) => [s.id, s]));
  const delServicio = new Map(preciosServicio.map((p) => [`${p.servicioId}|${p.sedeId}`, Number(p.precio)]));
  const delTipo = new Map(preciosTipo.map((p) => [`${p.subcategoriaId}|${p.sedeId}`, Number(p.precio)]));
  const mapaSedes = (id: string, sedesDelArea: { id: string }[], origen: Map<string, number>) =>
    Object.fromEntries(sedesDelArea.flatMap((x) => { const p = origen.get(`${id}|${x.id}`); return p === undefined ? [] : [[x.id, p]]; }));
  res.json(servicios.map((s) => {
    const ofrecido = ofrecidos.get(s.id);
    const exigeProfesional = s.unidadNegocio.modoReserva === 'preferencia_obligatoria';
    const sedesDelArea = sedes.filter((x) => sedeUnidades.some((su) => su.sedeId === x.id && su.unidadNegocioId === s.unidadNegocio.id));
    // ¿Hay precio en alguna sede (o el general)? Si no, el servicio no se puede mostrar.
    const hayPrecio = (tipo: { id: string; precioOnline: unknown; precioReferencial: unknown } | null) =>
      [null, ...sedesDelArea.map((x) => x.id)].some((sedeId) => precioWebEnSede(
        { servicioWeb: aNum(s.precioOnline), servicioReferencial: aNum(s.precioReferencial), servicioSede: sedeId ? delServicio.get(`${s.id}|${sedeId}`) ?? null : null },
        tipo ? { tipoWeb: aNum(tipo.precioOnline), tipoReferencial: aNum(tipo.precioReferencial), tipoSede: sedeId ? delTipo.get(`${tipo.id}|${sedeId}`) ?? null : null } : null,
      ) !== null);
    const tienePrecio = s.subcategorias.length ? s.subcategorias.some((v) => v.reservaOnline && hayPrecio(v)) : hayPrecio(null);
    let motivo: string | null = null;
    if (s.reservaOnline && !ofrecido) {
      if (exigeProfesional) motivo = 'Esta área exige elegir profesional: no se puede reservar en línea';
      else if (!s.unidadNegocio.activa) motivo = 'El área del servicio está inactiva';
      else if (s.subcategorias.length && !s.subcategorias.some((v) => v.reservaOnline)) motivo = 'Todos sus tipos están desactivados para la web';
      else if (!tienePrecio) motivo = 'Falta el precio';
      else motivo = 'Ninguna sede de su área lo ofrece';
    }
    return {
      id: s.id, codigo: s.codigo, nombre: s.nombre, duracionMinutos: s.duracionMinutos,
      precioReferencial: aNum(s.precioReferencial), precioOnline: aNum(s.precioOnline), reservaOnline: s.reservaOnline,
      unidad: { id: s.unidadNegocio.id, nombre: s.unidadNegocio.nombre }, exigeProfesional,
      ofrecido: !!ofrecido, motivo,
      // Sedes donde opera el área del servicio (las únicas donde puede tener precio propio) y su precio web, por sede.
      sedes: sedesDelArea, preciosSede: mapaSedes(s.id, sedesDelArea, delServicio),
      subcategorias: s.subcategorias.map((v) => ({
        id: v.id, nombre: v.nombre, precioReferencial: aNum(v.precioReferencial), precioOnline: aNum(v.precioOnline), reservaOnline: v.reservaOnline,
        preciosSede: mapaSedes(v.id, sedesDelArea, delTipo),
      })),
    };
  }));
});

// Precio web de UNA sede (null = quitarlo: esa sede vuelve al precio general). Solo en sedes donde opera el área del servicio.
const cuerpoPrecioSede = z.object({ precio: precioWeb });
const uuid = z.string().uuid('Identificador no válido');

async function sedeDelArea(sedeId: string, unidadNegocioId: string) {
  const sede = await prisma.sede.findFirst({ where: { id: sedeId, activa: true, deletedAt: null }, select: { id: true, nombre: true } });
  if (!sede) throw new AppError('Sede no encontrada', 404);
  const opera = await prisma.sedeUnidadNegocio.findUnique({ where: { sedeId_unidadNegocioId: { sedeId, unidadNegocioId } } });
  if (!opera) throw new AppError(`${sede.nombre} no atiende esta área: no puede tener precio web propio`, 409, 'SEDE_NO_OPERA_AREA');
  return sede;
}

router.put('/:id/reserva-web/sedes/:sedeId', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const { precio } = cuerpoPrecioSede.parse(req.body);
  const id = uuid.parse(req.params.id), sedeId = uuid.parse(req.params.sedeId);
  const servicio = await prisma.servicio.findFirst({ where: { id, deletedAt: null }, select: { id: true, nombre: true, unidadNegocioId: true } });
  if (!servicio) throw new AppError('Servicio no encontrado', 404);
  const sede = await sedeDelArea(sedeId, servicio.unidadNegocioId);
  const antes = await prisma.servicioPrecioWebSede.findUnique({ where: { servicioId_sedeId: { servicioId: id, sedeId } } });
  if (precio === null) await prisma.servicioPrecioWebSede.deleteMany({ where: { servicioId: id, sedeId } });
  else await prisma.servicioPrecioWebSede.upsert({ where: { servicioId_sedeId: { servicioId: id, sedeId } }, create: { servicioId: id, sedeId, precio: precio as never }, update: { precio: precio as never } });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar_precio_web_sede_servicio', entidad: 'servicio', entidadId: id, sedeId,
    antes: { precio: aNum(antes?.precio) }, despues: { servicio: servicio.nombre, sede: sede.nombre, precio },
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json({ sedeId, precio });
});

router.put('/subcategorias/:subId/reserva-web/sedes/:sedeId', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const { precio } = cuerpoPrecioSede.parse(req.body);
  const subId = uuid.parse(req.params.subId), sedeId = uuid.parse(req.params.sedeId);
  const sub = await prisma.subcategoriaServicio.findFirst({ where: { id: subId, deletedAt: null }, include: { servicio: { select: { unidadNegocioId: true, nombre: true } } } });
  if (!sub) throw new AppError('Tipo de servicio no encontrado', 404);
  const sede = await sedeDelArea(sedeId, sub.servicio.unidadNegocioId);
  const antes = await prisma.subcategoriaPrecioWebSede.findUnique({ where: { subcategoriaId_sedeId: { subcategoriaId: subId, sedeId } } });
  if (precio === null) await prisma.subcategoriaPrecioWebSede.deleteMany({ where: { subcategoriaId: subId, sedeId } });
  else await prisma.subcategoriaPrecioWebSede.upsert({ where: { subcategoriaId_sedeId: { subcategoriaId: subId, sedeId } }, create: { subcategoriaId: subId, sedeId, precio: precio as never }, update: { precio: precio as never } });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar_precio_web_sede_subcategoria', entidad: 'subcategoria_servicio', entidadId: subId, sedeId,
    antes: { precio: aNum(antes?.precio) }, despues: { servicio: sub.servicio.nombre, tipo: sub.nombre, sede: sede.nombre, precio },
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json({ sedeId, precio });
});

router.patch('/:id/reserva-web', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const data = z.object({ reservaOnline: z.boolean().optional(), precioOnline: precioWeb.optional() })
    .refine((d) => d.reservaOnline !== undefined || d.precioOnline !== undefined, 'Nada que cambiar').parse(req.body);
  const antes = await prisma.servicio.findFirst({ where: { id: req.params.id, deletedAt: null }, include: { unidadNegocio: { select: { modoReserva: true, nombre: true } } } });
  if (!antes) throw new AppError('Servicio no encontrado', 404);
  if (data.reservaOnline && antes.unidadNegocio.modoReserva === 'preferencia_obligatoria') {
    throw new AppError(`${antes.unidadNegocio.nombre} exige elegir profesional: no se puede reservar en línea`, 409, 'AREA_NO_RESERVABLE_WEB');
  }
  const servicio = await prisma.servicio.update({
    where: { id: antes.id },
    data: { ...(data.reservaOnline !== undefined ? { reservaOnline: data.reservaOnline } : {}), ...(data.precioOnline !== undefined ? { precioOnline: data.precioOnline as never } : {}) },
    select: { id: true, nombre: true, reservaOnline: true, precioOnline: true },
  });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar_reserva_web_servicio', entidad: 'servicio', entidadId: servicio.id,
    antes: { reservaOnline: antes.reservaOnline, precioOnline: aNum(antes.precioOnline) },
    despues: { nombre: servicio.nombre, reservaOnline: servicio.reservaOnline, precioOnline: aNum(servicio.precioOnline) },
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json({ id: servicio.id, reservaOnline: servicio.reservaOnline, precioOnline: aNum(servicio.precioOnline) });
});

router.patch('/subcategorias/:subId/reserva-web', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const data = z.object({ reservaOnline: z.boolean().optional(), precioOnline: precioWeb.optional() })
    .refine((d) => d.reservaOnline !== undefined || d.precioOnline !== undefined, 'Nada que cambiar').parse(req.body);
  const antes = await prisma.subcategoriaServicio.findFirst({ where: { id: req.params.subId, deletedAt: null } });
  if (!antes) throw new AppError('Tipo de servicio no encontrado', 404);
  const sub = await prisma.subcategoriaServicio.update({
    where: { id: antes.id },
    data: { ...(data.reservaOnline !== undefined ? { reservaOnline: data.reservaOnline } : {}), ...(data.precioOnline !== undefined ? { precioOnline: data.precioOnline as never } : {}) },
  });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar_reserva_web_subcategoria', entidad: 'subcategoria_servicio', entidadId: sub.id,
    antes: { reservaOnline: antes.reservaOnline, precioOnline: aNum(antes.precioOnline) },
    despues: { nombre: sub.nombre, reservaOnline: sub.reservaOnline, precioOnline: aNum(sub.precioOnline) },
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json({ id: sub.id, reservaOnline: sub.reservaOnline, precioOnline: aNum(sub.precioOnline) });
});

router.get('/:id', requireAuth, async (req, res) => {
  const s = await prisma.servicio.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: { unidadNegocio: true },
  });
  if (!s) throw new (await import('../middleware/errorHandler')).AppError('Servicio no encontrado', 404);
  res.json(s);
});

const servicioSchema = z.object({
  nombre: z.string().min(3),
  codigo: z.string().min(2).optional(), // se genera automáticamente (PREFIJO-NN por unidad)
  duracionMinutos: z.number().int().positive(),
  color: z.string().default('#6B7F9E'),
  precioReferencial: z.number().positive().optional(),
  unidadNegocioId: z.string().uuid(),
  activo: z.boolean().default(true),
  // 09-oct-2026: cuántas citas de este servicio pueden cruzarse a la vez en una sede (salas). null = sin límite.
  cupoSimultaneo: z.number().int().min(1).max(50).nullable().optional(),
});

// Prefijo de código según la unidad (consistente: POD-/BAR-/FIS-, o 3 letras del nombre).
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function prefijoUnidad(nombre: string): string {
  const n = norm(nombre);
  if (n.startsWith('podolog')) return 'POD';
  if (n.startsWith('baropodometr')) return 'BAR';
  if (n.startsWith('fisio')) return 'FIS';
  return n.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase() || 'SRV';
}
async function generarCodigo(unidadNegocioId: string): Promise<string> {
  const unidad = await prisma.unidadNegocio.findUnique({ where: { id: unidadNegocioId }, select: { nombre: true } });
  const prefijo = prefijoUnidad(unidad?.nombre ?? '');
  const existentes = await prisma.servicio.findMany({ where: { codigo: { startsWith: `${prefijo}-` } }, select: { codigo: true } });
  let max = 0;
  for (const e of existentes) {
    const m = e.codigo.match(new RegExp(`^${prefijo}-(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefijo}-${String(max + 1).padStart(2, '0')}`;
}

router.post('/', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const data = servicioSchema.parse(req.body);
  // El código se asigna automáticamente para mantener el formato consistente por unidad.
  const codigo = await generarCodigo(data.unidadNegocioId);
  const servicio = await prisma.servicio.create({ data: { ...data, codigo, precioReferencial: data.precioReferencial as never, creadoPor: req.user?.userId } });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'crear', entidad: 'servicio', entidadId: servicio.id,
    despues: servicio as unknown as Record<string, unknown>,
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.status(201).json(servicio);
});

router.patch('/:id', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const data = servicioSchema.partial().parse(req.body);
  // Capturar el estado ANTES para poder diffear en auditoría.
  const antes = await prisma.servicio.findUnique({
    where: { id: req.params.id, deletedAt: null },
  });
  const servicio = await prisma.servicio.update({
    where: { id: req.params.id, deletedAt: null },
    data: { ...data, precioReferencial: data.precioReferencial as never },
  });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar', entidad: 'servicio', entidadId: servicio.id,
    antes: antes as unknown as Record<string, unknown>,
    despues: servicio as unknown as Record<string, unknown>,
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json(servicio);
});

// ─── Subcategorías de un servicio (ej. Profilaxis → Regular/Premium/…) ────────
// Al agendar o vender/consumir membresías de un servicio con subcategorías activas,
// elegir una es obligatorio (validado en citas.ts / membresias.ts). Soft-delete.
const subcategoriaSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  precioReferencial: z.number().positive().nullable().optional(),
  orden: z.number().int().min(0).optional(),
});

// GET /servicios/:id/subcategorias — lista (incluye inactivas para administración).
router.get('/:id/subcategorias', requireAuth, async (req, res) => {
  const subs = await prisma.subcategoriaServicio.findMany({
    where: { servicioId: req.params.id, deletedAt: null },
    orderBy: [{ activo: 'desc' }, { orden: 'asc' }, { nombre: 'asc' }],
  });
  res.json(subs);
});

// POST /servicios/:id/subcategorias — crear (admin).
router.post('/:id/subcategorias', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const data = subcategoriaSchema.parse(req.body);
  const servicio = await prisma.servicio.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true } });
  if (!servicio) throw new AppError('Servicio no encontrado', 404);
  const existe = await prisma.subcategoriaServicio.findFirst({
    where: { servicioId: servicio.id, nombre: data.nombre, deletedAt: null },
    select: { id: true },
  });
  if (existe) throw new AppError('Ya existe una subcategoría con ese nombre', 409, 'SUBCATEGORIA_DUPLICADA');
  const sub = await prisma.$transaction(async (tx) => {
    const creada = await tx.subcategoriaServicio.create({
      data: { servicioId: servicio.id, nombre: data.nombre, precioReferencial: data.precioReferencial as never, orden: data.orden ?? 0, creadoPor: req.user?.userId },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'crear_subcategoria_servicio',
      entidad: 'subcategoria_servicio',
      entidadId: creada.id,
      despues: { servicioId: servicio.id, nombre: data.nombre, precioReferencial: data.precioReferencial ?? null },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    return creada;
  });
  res.status(201).json(sub);
});

// PATCH /servicios/subcategorias/:subId — editar (admin/coordinadora).
router.patch('/subcategorias/:subId', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const data = subcategoriaSchema.partial().extend({ activo: z.boolean().optional() }).parse(req.body);
  const actual = await prisma.subcategoriaServicio.findFirst({ where: { id: req.params.subId, deletedAt: null } });
  if (!actual) throw new AppError('Subcategoría no encontrada', 404);
  if (data.nombre && data.nombre !== actual.nombre) {
    const dup = await prisma.subcategoriaServicio.findFirst({
      where: { servicioId: actual.servicioId, nombre: data.nombre, deletedAt: null, NOT: { id: actual.id } },
      select: { id: true },
    });
    if (dup) throw new AppError('Ya existe una subcategoría con ese nombre', 409, 'SUBCATEGORIA_DUPLICADA');
  }
  const sub = await prisma.$transaction(async (tx) => {
    const upd = await tx.subcategoriaServicio.update({
      where: { id: actual.id },
      data: {
        ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
        ...(data.precioReferencial !== undefined ? { precioReferencial: data.precioReferencial as never } : {}),
        ...(data.orden !== undefined ? { orden: data.orden } : {}),
        ...(data.activo !== undefined ? { activo: data.activo } : {}),
      },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'editar_subcategoria_servicio',
      entidad: 'subcategoria_servicio',
      entidadId: actual.id,
      antes: { nombre: actual.nombre, precioReferencial: actual.precioReferencial, orden: actual.orden, activo: actual.activo },
      despues: data,
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    return upd;
  });
  res.json(sub);
});

// DELETE /servicios/subcategorias/:subId — desactivar (soft, admin). Las citas
// históricas conservan su subcategoriaId (FK ON DELETE SET NULL nunca se dispara).
router.delete('/subcategorias/:subId', requireAuth, requirePermiso('servicios.editar'), async (req, res) => {
  const actual = await prisma.subcategoriaServicio.findFirst({ where: { id: req.params.subId, deletedAt: null } });
  if (!actual) throw new AppError('Subcategoría no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.subcategoriaServicio.update({ where: { id: actual.id }, data: { deletedAt: new Date(), activo: false } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'eliminar_subcategoria_servicio',
      entidad: 'subcategoria_servicio',
      entidadId: actual.id,
      antes: { nombre: actual.nombre, activo: actual.activo },
      despues: { deletedAt: new Date().toISOString() },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });
  res.json({ ok: true });
});

export default router;
