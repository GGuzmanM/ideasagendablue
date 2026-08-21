import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { fechaDb } from '../utils/fechaLima';
import { timeToMinutes as toMin } from '@limablue/shared';
import { registrarAudit } from '../services/audit';

const router = Router();

// Estructura de un turno
interface Turno { apertura: string; cierre: string; abierto: boolean }
type HorarioJSON = Record<string, Turno | { abierto: false }>

// GET /horarios/:sedeId?fecha=YYYY-MM-DD
// Devuelve el horario efectivo para la fecha indicada (excepción si existe, default si no)
router.get('/:sedeId', requireAuth, async (req, res) => {
  const { sedeId } = req.params;
  const { fecha } = req.query as { fecha?: string };

  const sede = await prisma.sede.findUnique({ where: { id: sedeId } });
  if (!sede) { res.status(404).json({ error: 'Sede no encontrada' }); return; }

  const horarioDefault = sede.horario as HorarioJSON;

  if (!fecha) {
    res.json({ horarioDefault, excepciones: [] });
    return;
  }

  // Día de semana de la fecha pedida (0=dom … 6=sab). Usa getters UTC (fecha @db.Date).
  const diaSemana = fechaDb(fecha).getUTCDay();
  const turnoPorDefecto = horarioDefault[String(diaSemana)] ?? { abierto: false };

  // Buscar excepción para esa fecha
  const exc = await prisma.excepcionHorario.findUnique({
    where: { sedeId_fecha: { sedeId, fecha: fechaDb(fecha) } },
  });

  const efectivo = exc
    ? { abierto: exc.abierto, apertura: exc.horaApertura, cierre: exc.horaCierre, nota: exc.nota, esExcepcion: true }
    : { ...turnoPorDefecto, esExcepcion: false };

  res.json({ horarioDefault, efectivo, diaSemana });
});

// GET /horarios/:sedeId/turnos-profesionales?fecha=YYYY-MM-DD
// Devuelve el turno efectivo (horaInicio y horaFin) de cada profesional en la sede y fecha
router.get('/:sedeId/turnos-profesionales', requireAuth, async (req, res) => {
  const { sedeId } = req.params;
  const { fecha } = req.query as { fecha?: string };
  if (!fecha) throw new AppError('fecha (YYYY-MM-DD) requerida', 400);

  const profs = await prisma.profesional.findMany({
    where: { activo: true, deletedAt: null },
    select: { id: true },
  });

  const { turnosDelDia } = await import('../services/disponibilidad');
  const turnosMap = await turnosDelDia(sedeId, fecha, profs.map((p) => p.id));
  const result: Record<string, { horaInicio: string; horaFin: string } | null> = {};

  for (const p of profs) {
    result[p.id] = turnosMap.get(p.id) ?? null;
  }

  res.json(result);
});

// GET /horarios/:sedeId/excepciones?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
router.get('/:sedeId/excepciones', requireAuth, async (req, res) => {
  const { sedeId } = req.params;
  const { desde, hasta } = req.query as { desde?: string; hasta?: string };

  const where: Record<string, unknown> = { sedeId };
  if (desde || hasta) {
    where.fecha = {
      ...(desde ? { gte: new Date(desde + 'T00:00:00') } : {}),
      ...(hasta ? { lte: new Date(hasta + 'T00:00:00') } : {}),
    };
  }

  const excepciones = await prisma.excepcionHorario.findMany({
    where,
    orderBy: { fecha: 'asc' },
  });

  res.json(excepciones.map(e => ({
    ...e,
    fecha: e.fecha.toISOString().split('T')[0],
  })));
});

// POST /horarios/:sedeId/excepciones  — crea o actualiza excepción para una fecha
const excepcionSchema = z.object({
  fecha:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  abierto:      z.boolean(),
  horaApertura: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  horaCierre:   z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  nota:         z.string().max(200).optional().nullable(),
});

router.post('/:sedeId/excepciones', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { sedeId } = req.params;
  const body = excepcionSchema.parse(req.body);

  // Si está ABIERTO, exige apertura y cierre, y que apertura < cierre. Sin esta
  // validación se podía guardar un rango inválido (p.ej. 18:00→13:00) que dejaba
  // la grilla de la agenda VACÍA (sin franjas) y ocultaba las citas de ese día.
  if (body.abierto) {
    if (!body.horaApertura || !body.horaCierre) {
      throw new AppError('Si la sede está abierta, indica hora de apertura y cierre', 400, 'HORARIO_INCOMPLETO');
    }
    if (toMin(body.horaApertura) >= toMin(body.horaCierre)) {
      throw new AppError('La hora de apertura debe ser anterior a la de cierre', 400, 'RANGO_INVALIDO');
    }
  }

  const fecha = fechaDb(body.fecha);

  // Estado previo (si ya existía la excepción esa fecha) para diffear en auditoría.
  const antes = await prisma.excepcionHorario.findUnique({
    where: { sedeId_fecha: { sedeId, fecha } },
  });

  const exc = await prisma.excepcionHorario.upsert({
    where: { sedeId_fecha: { sedeId, fecha } },
    create: { sedeId, fecha, abierto: body.abierto, horaApertura: body.horaApertura ?? null, horaCierre: body.horaCierre ?? null, nota: body.nota ?? null, creadoPor: req.user?.userId },
    update: { abierto: body.abierto, horaApertura: body.horaApertura ?? null, horaCierre: body.horaCierre ?? null, nota: body.nota ?? null },
  });

  const resumen = (e: { abierto: boolean; horaApertura: string | null; horaCierre: string | null; nota: string | null }) => ({
    fecha: body.fecha, abierto: e.abierto, horaApertura: e.horaApertura, horaCierre: e.horaCierre, nota: e.nota,
  });
  void registrarAudit({
    usuarioId: req.user?.userId,
    accion: antes ? 'editar' : 'crear',
    entidad: 'excepcion_horario', entidadId: exc.id,
    antes: antes ? resumen(antes) : undefined,
    despues: resumen(exc),
    sedeId,
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });

  res.json({ ...exc, fecha: exc.fecha.toISOString().split('T')[0] });
});

// DELETE /horarios/:sedeId/excepciones/:fecha — elimina excepción (vuelve al horario normal)
router.delete('/:sedeId/excepciones/:fecha', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { sedeId, fecha } = req.params;

  // Capturar la excepción antes de borrarla para dejar rastro de qué se quitó.
  const antes = await prisma.excepcionHorario.findUnique({
    where: { sedeId_fecha: { sedeId, fecha: fechaDb(fecha) } },
  });

  await prisma.excepcionHorario.deleteMany({
    where: { sedeId, fecha: fechaDb(fecha) },
  });

  if (antes) {
    void registrarAudit({
      usuarioId: req.user?.userId, accion: 'eliminar', entidad: 'excepcion_horario', entidadId: antes.id,
      antes: { fecha, abierto: antes.abierto, horaApertura: antes.horaApertura, horaCierre: antes.horaCierre, nota: antes.nota },
      despues: { eliminado: true, vuelveAlHorarioNormal: true },
      sedeId,
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  res.json({ ok: true });
});

// PATCH /horarios/:sedeId — actualiza el horario default de la sede
const horarioDefaultSchema = z.record(
  z.string(),
  z.union([
    z.object({ apertura: z.string(), cierre: z.string(), abierto: z.literal(true) }),
    z.object({ abierto: z.literal(false) }),
  ])
);

// Editar el horario de operación (apertura/cierre por día) de una sede: solo admin/coordinadora
// (mismo candado que el resto del módulo). NO afecta cancelar/crear citas — eso es otro permiso.
router.patch('/:sedeId', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { sedeId } = req.params;
  const horario = horarioDefaultSchema.parse(req.body);

  const antes = await prisma.sede.findUnique({ where: { id: sedeId }, select: { horario: true } });

  const sede = await prisma.sede.update({
    where: { id: sedeId },
    data: { horario },
  });

  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar', entidad: 'horario_sede', entidadId: sedeId,
    antes: { horario: antes?.horario ?? null },
    despues: { horario },
    sedeId,
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });

  res.json(sede);
});

export { router as horariosRouter };
