/**
 * /api/v1/rebote — bandeja de citas en rebote (ver services/reboteService.ts).
 * Reagendar = el mover de siempre (PATCH /citas/:id/mover o /citas/grupo/:slotGrupoId/mover), que
 * cierra el rebote.
 * 01-oct-2026: abierto a quienes REPROGRAMAN (permiso citas.reprogramar = admin, coordinación, contact center, especial
 * contact y recepción). Bandeja general (hoy todos ellos ven todas las sedes) con filtros de sede y unidad.
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, puedeTodasLasSedes } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { zFechaCita } from '../utils/validacionCita';
import {
  enviarARebote, listarRebotes, registrarLlamada, listarLlamadas, descartarRebote,
  TURNOS_REBOTE, RESULTADOS_LLAMADA, DIAS_REBOTE,
} from '../services/reboteService';

const router = Router();

router.use(requireAuth, requirePermiso('citas.reprogramar'));

function actor(req: Request) {
  return { usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

/** La cita tiene que ser de una sede que el usuario opera. */
async function assertSedeDeCita(req: Request, citaId: string): Promise<void> {
  const c = await prisma.cita.findUnique({ where: { id: citaId }, select: { sedeId: true } });
  if (!c) throw new AppError('Cita no encontrada', 404);
  assertSede(req, c.sedeId);
}

// GET /rebote?sedeId=&unidadNegocioId= — bandeja (general; los combos de sede y unidad son opcionales)
router.get('/', async (req, res) => {
  const sedeId = z.string().uuid().optional().parse(req.query.sedeId || undefined);
  const unidadNegocioId = z.string().uuid().optional().parse(req.query.unidadNegocioId || undefined);
  if (sedeId) assertSede(req, sedeId);
  const sedeIds = puedeTodasLasSedes(req.user!) ? null : req.user!.sedes;
  res.json({ diasRebote: DIAS_REBOTE, citas: await listarRebotes({ sedeIds, sedeId, unidadNegocioId }) });
});

// POST /rebote/:citaId — enviar a rebote
router.post('/:citaId', async (req, res) => {
  const datos = z.object({
    motivo: z.string().trim().min(3, 'Indica el motivo').max(500),
    turno: z.enum(TURNOS_REBOTE).nullable().optional(),
    llamarDesde: zFechaCita.nullable().optional(),
  }).parse(req.body);
  await assertSedeDeCita(req, req.params.citaId);
  const citas = await enviarARebote(req.params.citaId, datos, actor(req));
  res.json({ ok: true, citas });
});

// POST /rebote/:citaId/llamada — registrar un intento de contacto
router.post('/:citaId/llamada', async (req, res) => {
  const datos = z.object({
    resultado: z.enum(RESULTADOS_LLAMADA),
    nota: z.string().trim().max(500).nullable().optional(),
    llamarDesde: zFechaCita.nullable().optional(),
  }).parse(req.body);
  await assertSedeDeCita(req, req.params.citaId);
  res.status(201).json(await registrarLlamada(req.params.citaId, datos, actor(req)));
});

// GET /rebote/:citaId/llamadas — historial de llamadas
router.get('/:citaId/llamadas', async (req, res) => {
  await assertSedeDeCita(req, req.params.citaId);
  res.json(await listarLlamadas(req.params.citaId));
});

// POST /rebote/:citaId/descartar — el paciente ya no quiere reagendar → cancelada
router.post('/:citaId/descartar', async (req, res) => {
  const { motivo } = z.object({ motivo: z.string().trim().min(3, 'Indica el motivo').max(500) }).parse(req.body);
  await assertSedeDeCita(req, req.params.citaId);
  const citas = await descartarRebote(req.params.citaId, motivo, actor(req));
  res.json({ ok: true, citas });
});

export default router;
