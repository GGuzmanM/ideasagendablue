/**
 * Reserva web — uso INTERNO (con login) (05/06-oct-2026)
 *
 *  GET   /api/v1/reservas-web/estado                  { habilitada } (para mostrar o no el menú)
 *  GET   /api/v1/reservas-web/en-curso?sedeId&fecha   avisos de reservas con problema (ya no hay horarios apartados: sin pasarela la cita se crea al confirmar)
 *  GET   /api/v1/reservas-web/intentos?desde&hasta&pendientes=1   quién empezó a reservar y hasta dónde llegó
 *  PATCH /api/v1/reservas-web/intentos/:id/contacto   { contactado, nota }   marcar que ya se le llamó
 *
 * Si la reserva web está apagada, las listas vienen vacías (la agenda nunca falla por esto).
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede } from '../middleware/auth';
import { fechaDb } from '../utils/fechaLima';
import { reservaWebHabilitada } from '../services/reservaWeb/reservaWebService';
import { listarIntentos, marcarContactado } from '../services/reservaWeb/intentos';

const router = Router();
const fechaQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.get('/estado', requireAuth, (_req, res) => {
  res.json({ habilitada: reservaWebHabilitada() });
});

router.get('/en-curso', requireAuth, requirePermiso('citas.ver'), async (req, res) => {
  const q = z.object({ sedeId: z.string().uuid(), fecha: fechaQ }).parse(req.query);
  assertSede(req, q.sedeId);
  if (!reservaWebHabilitada()) { res.json([]); return; }
  const filas = await prisma.reservaWeb.findMany({
    where: {
      sedeId: q.sedeId, fecha: fechaDb(q.fecha),
      estado: 'reembolsar', // solo las de antes de quitar la pasarela que quedaron pagadas sin cita
    },
    orderBy: [{ horaInicio: 'asc' }, { creadoEn: 'asc' }],
  });
  if (!filas.length) { res.json([]); return; }
  const [servicios, variantes] = await Promise.all([
    prisma.servicio.findMany({ where: { id: { in: [...new Set(filas.map((f) => f.servicioId))] } }, select: { id: true, nombre: true } }),
    prisma.subcategoriaServicio.findMany({ where: { id: { in: filas.map((f) => f.subcategoriaId).filter((x): x is string => !!x) } }, select: { id: true, nombre: true } }),
  ]);
  const nombreServ = new Map(servicios.map((s) => [s.id, s.nombre]));
  const nombreVar = new Map(variantes.map((v) => [v.id, v.nombre]));
  res.json(filas.map((f) => ({
    id: f.id, codigo: f.codigo, estado: f.estado, horaInicio: f.horaInicio, duracionMinutos: f.duracionMinutos,
    servicio: nombreServ.get(f.servicioId) ?? 'Servicio', variante: f.subcategoriaId ? nombreVar.get(f.subcategoriaId) ?? null : null,
    paciente: `${f.nombres} ${f.apellidoPaterno}`.trim(), numeroDocumento: f.numeroDocumento, telefono: f.telefono,
    monto: Number(f.monto), expiraEn: f.expiraEn, error: f.estado === 'reembolsar' ? f.error : null,
  })));
});

// Seguimiento de intentos (06-oct-2026): lo ve quien tenga el permiso «reservas_web.ver» (apagado por defecto; Administración › Roles).
router.get('/intentos', requireAuth, requirePermiso('reservas_web.ver'), async (req, res) => {
  const q = z.object({ desde: fechaQ, hasta: fechaQ, pendientes: z.enum(['0', '1']).optional() }).parse(req.query);
  if (!reservaWebHabilitada()) { res.json([]); return; }
  res.json(await listarIntentos({ desde: q.desde, hasta: q.hasta, soloPendientes: q.pendientes === '1' }));
});

router.patch('/intentos/:id/contacto', requireAuth, requirePermiso('reservas_web.ver'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = z.object({ contactado: z.boolean(), nota: z.string().trim().max(500).optional().nullable() }).parse(req.body);
  res.json(await marcarContactado(id, req.user!.userId, b.nota || null, b.contactado));
});

export default router;
