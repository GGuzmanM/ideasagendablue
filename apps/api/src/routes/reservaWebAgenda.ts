/**
 * Reservas web EN CURSO para la agenda (05-oct-2026) — /api/v1/reservas-web/en-curso?sedeId&fecha
 * Uso interno (con login): recepción ve los horarios que la web tiene apartados mientras el paciente paga, y las
 * reservas pagadas que no pudieron convertirse en cita (para reubicar o devolver el dinero). Si la reserva web está
 * apagada devuelve una lista vacía (la agenda nunca falla por esto).
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede } from '../middleware/auth';
import { fechaDb } from '../utils/fechaLima';
import { reservaWebHabilitada } from '../services/reservaWeb/reservaWebService';

const router = Router();

router.get('/en-curso', requireAuth, requirePermiso('citas.ver'), async (req, res) => {
  const q = z.object({ sedeId: z.string().uuid(), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  assertSede(req, q.sedeId);
  if (!reservaWebHabilitada()) { res.json([]); return; }
  const ahora = new Date();
  const filas = await prisma.reservaWeb.findMany({
    where: {
      sedeId: q.sedeId, fecha: fechaDb(q.fecha),
      OR: [{ estado: 'esperando_pago', expiraEn: { gt: ahora } }, { estado: { in: ['pagada', 'reembolsar'] } }],
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

export default router;
