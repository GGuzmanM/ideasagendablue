import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';
import { fechaDb, hoyLimaStr } from '../utils/fechaLima';

const router = Router();

// ─── Consultorios por sede (Administración › Consultorios) ────────────────────
// `Sede.consultorios` es la cantidad de consultorios numerados (C1..CN) que ofrece el detalle de la cita y que usan los
// aparatos INICIO/FIN. Se administra desde aquí; no hay filas por consultorio, solo el número.
const MAX_CONSULTORIOS = 30;

/** Hasta qué número de consultorio se está usando en cada sede (citas de hoy en adelante y aparatos activos). */
async function usoConsultorios() {
  const hoy = fechaDb(hoyLimaStr());
  const [citas, aparatos] = await Promise.all([
    prisma.cita.groupBy({ by: ['sedeId'], _max: { consultorioNumero: true }, _count: { _all: true }, where: { deletedAt: null, consultorioNumero: { not: null }, fecha: { gte: hoy }, estado: { notIn: ['cancelada', 'reprogramada'] } } }),
    prisma.dispositivoConsultorio.groupBy({ by: ['sedeId'], _max: { consultorioNumero: true }, _count: { _all: true }, where: { deletedAt: null, activo: true } }),
  ]);
  const uso = new Map<string, { maxCitas: number; citas: number; maxAparatos: number; aparatos: number }>();
  for (const c of citas) uso.set(c.sedeId, { maxCitas: c._max.consultorioNumero ?? 0, citas: c._count._all, maxAparatos: 0, aparatos: 0 });
  for (const a of aparatos) { const u = uso.get(a.sedeId) ?? { maxCitas: 0, citas: 0, maxAparatos: 0, aparatos: 0 }; u.maxAparatos = a._max.consultorioNumero ?? 0; u.aparatos = a._count._all; uso.set(a.sedeId, u); }
  return uso;
}

// GET /sedes/consultorios — cada sede con su nº de consultorios y hasta cuál está en uso (para no quitar uno ocupado).
router.get('/consultorios', requireAuth, requirePermiso('horarios.ver'), async (_req, res) => {
  const [sedes, uso] = await Promise.all([
    prisma.sede.findMany({ where: { deletedAt: null }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], select: { id: true, nombre: true, color: true, activa: true, consultorios: true } }),
    usoConsultorios(),
  ]);
  res.json(sedes.map((s) => { const u = uso.get(s.id); return { ...s, enUsoHasta: Math.max(u?.maxCitas ?? 0, u?.maxAparatos ?? 0), citasFuturasConConsultorio: u?.citas ?? 0, aparatosActivos: u?.aparatos ?? 0 }; }));
});

// PATCH /sedes/:id/consultorios — cambia la cantidad. No se puede bajar por debajo de un consultorio que tenga citas
// futuras o un aparato activo: primero se reasignan esas citas / se retira el aparato.
router.patch('/:id/consultorios', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { consultorios } = z.object({ consultorios: z.number().int().min(0).max(MAX_CONSULTORIOS) }).parse(req.body);
  const sede = await prisma.sede.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true, nombre: true, consultorios: true } });
  if (!sede) throw new AppError('Sede no encontrada', 404, 'SEDE_INVALIDA');
  if (consultorios < sede.consultorios) {
    const u = (await usoConsultorios()).get(sede.id);
    const hasta = Math.max(u?.maxCitas ?? 0, u?.maxAparatos ?? 0);
    if (hasta > consultorios) {
      const motivos = [u && u.maxCitas > consultorios ? `citas de hoy en adelante en el C${u.maxCitas}` : '', u && u.maxAparatos > consultorios ? `un aparato activo en el C${u.maxAparatos}` : ''].filter(Boolean).join(' y ');
      throw new AppError(`${sede.nombre} tiene ${motivos}. Reasigna esas citas o retira el aparato antes de quitar consultorios.`, 409, 'CONSULTORIOS_EN_USO');
    }
  }
  const upd = await prisma.sede.update({ where: { id: sede.id }, data: { consultorios }, select: { id: true, nombre: true, consultorios: true } });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar', entidad: 'sede', entidadId: sede.id, sedeId: sede.id,
    antes: { consultorios: sede.consultorios }, despues: { consultorios },
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json(upd);
});

router.get('/', requireAuth, async (_req, res) => {
  const sedes = await prisma.sede.findMany({
    where: { deletedAt: null },
    include: {
      unidadesNegocio: {
        include: { unidadNegocio: { select: { id: true, nombre: true, modoReserva: true, color: true } } },
      },
    },
    // `orden` manual primero (pestañas de agenda en secuencia elegida); orden=0 → alfabético.
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
  });

  res.json(sedes.map((s: typeof sedes[number]) => ({
    id: s.id,
    nombre: s.nombre,
    direccion: s.direccion,
    color: s.color,
    activa: s.activa,
    consultorios: s.consultorios, // nº de consultorios (selector de la cita y registro de aparatos)
    horario: s.horario,
    unidadesNegocio: s.unidadesNegocio.map((u: { unidadNegocio: unknown }) => u.unidadNegocio),
  })));
});

router.get('/:id', requireAuth, async (req, res) => {
  const sede = await prisma.sede.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: {
      unidadesNegocio: {
        include: { unidadNegocio: true },
      },
    },
  });
  if (!sede) throw new AppError('Sede no encontrada', 404);
  res.json(sede);
});

export default router;
