import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { cambiarMedicoCita, medicosAsignables } from '../services/medicoCitaService';

// ─── Médico de la cita (18-sep-2026) ──────────────────────────────────────────
//  · PATCH /medico-cita/:citaId { accion: 'tomar' | 'soltar' } → el propio médico (medico.autoasignar)
//  · PATCH /medico-cita/:citaId { accion: 'asignar', medicoId } → admin/coordinación (medico.asignar)
//  · GET   /medico-cita/asignables?sedeId= → médicos para el desplegable (medico.asignar)
// Las reglas finas (no quitarle la cita a otro médico, no soltar con receta emitida…) viven en
// services/medicoCitaReglas.ts; aquí solo el permiso de entrada y la sede.
const router = Router();
const user = (req: Request) => req.user as AuthPayload;
const ctx = (req: Request) => ({ usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });

const cuerpo = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('tomar') }),
  z.object({ accion: z.literal('soltar') }),
  z.object({ accion: z.literal('asignar'), medicoId: z.string().uuid().nullable() }),
]);

router.get('/asignables', requireAuth, requirePermiso('medico.asignar'), async (req, res) => {
  const { sedeId } = z.object({ sedeId: z.string().uuid() }).parse(req.query);
  assertSede(req, sedeId);
  res.json(await medicosAsignables(sedeId));
});

router.patch('/:citaId', requireAuth, async (req, res) => {
  const permisos = user(req).permisos ?? [];
  if (!permisos.includes('medico.autoasignar') && !permisos.includes('medico.asignar')) {
    throw new AppError('No tienes permiso para asignar médicos a las citas', 403, 'SIN_PERMISO');
  }
  const citaId = z.string().uuid().parse(req.params.citaId);
  const accion = cuerpo.parse(req.body);
  const c = await prisma.cita.findFirst({ where: { id: citaId, deletedAt: null }, select: { sedeId: true } });
  if (!c) throw new AppError('Cita no encontrada', 404);
  assertSede(req, c.sedeId);
  res.json(await cambiarMedicoCita({ ...ctx(req), user: user(req), citaId, accion }));
});

export default router;
