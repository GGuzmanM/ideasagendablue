/**
 * Tiempos de tratamiento medidos con el aparato del consultorio — reporte.
 *
 *  GET  /reporte?desde&hasta&sedeId&agrupar=servicio|profesional|sede   (+ /reporte.csv)
 *
 * Permiso `analytics.ver`. Todo tiempo nace con su cita: un INICIO sin cita no crea nada.
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, puedeTodasLasSedes } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { fechaDb, fechaAStr } from '../utils/fechaLima';
import { resumirDuraciones, horaLima } from '../services/tiempoReglas';

const router = Router();
router.use(requireAuth, requirePermiso('analytics.ver'));

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const reporteSchema = z.object({
  desde: z.string().regex(FECHA),
  hasta: z.string().regex(FECHA),
  sedeId: z.string().uuid().optional(),
  agrupar: z.enum(['servicio', 'profesional', 'sede']).default('servicio'),
});

/** Tiempos FINALIZADOS en el rango (los «sin fin» y los anulados no entran al promedio). */
async function tiemposDelRango(req: Request) {
  const q = reporteSchema.parse(req.query);
  if (q.desde > q.hasta) throw new AppError('El rango de fechas está invertido', 400, 'RANGO_INVALIDO');
  if (q.sedeId) assertSede(req, q.sedeId);
  const sedes = q.sedeId ? [q.sedeId] : (req.user && !puedeTodasLasSedes(req.user) ? req.user.sedes : null);
  const whereBase = {
    deletedAt: null,
    fecha: { gte: fechaDb(q.desde), lte: fechaDb(q.hasta) },
    ...(sedes ? { sedeId: { in: sedes } } : {}),
  };
  const [tiempos, conteos] = await Promise.all([
    prisma.tiempoTratamiento.findMany({
      where: { ...whereBase, estado: 'finalizado' },
      orderBy: { inicioEn: 'asc' },
      select: {
        id: true, fecha: true, consultorioNumero: true, inicioEn: true, finEn: true, duracionSegundos: true, origen: true, horaAproximada: true,
        sede: { select: { id: true, nombre: true } },
        cita: {
          select: {
            id: true, duracionMinutos: true,
            servicio: { select: { id: true, nombre: true } },
            profesional: { select: { id: true, nombres: true, apellidos: true } },
          },
        },
      },
    }),
    prisma.tiempoTratamiento.groupBy({ by: ['estado'], where: whereBase, _count: { _all: true } }),
  ]);
  return { q, tiempos, conteos };
}

router.get('/reporte', async (req, res) => {
  const { q, tiempos, conteos } = await tiemposDelRango(req);
  const grupos = new Map<string, { clave: string; nombre: string; minutos: number[]; programados: number[] }>();
  for (const t of tiempos) {
    const c = t.cita;
    const [clave, nombre] =
      q.agrupar === 'sede' ? [t.sede.id, t.sede.nombre]
      : q.agrupar === 'profesional' ? [c.profesional?.id ?? 'sin', c.profesional ? `${c.profesional.nombres} ${c.profesional.apellidos}`.trim() : 'Sin profesional']
      : [c.servicio.id, c.servicio.nombre];
    const g = grupos.get(clave) ?? { clave, nombre, minutos: [], programados: [] };
    g.minutos.push((t.duracionSegundos ?? 0) / 60);
    g.programados.push(c.duracionMinutos);
    grupos.set(clave, g);
  }
  const filas = [...grupos.values()].map((g) => {
    const r = resumirDuraciones(g.minutos)!;
    const programado = Math.round((g.programados.reduce((s, x) => s + x, 0) / g.programados.length) * 10) / 10;
    return { clave: g.clave, nombre: g.nombre, ...r, programado, desvio: Math.round((r.promedio - programado) * 10) / 10 };
  }).sort((a, b) => b.n - a.n);
  const porEstado = Object.fromEntries(conteos.map((c) => [c.estado, c._count._all]));
  res.json({
    desde: q.desde, hasta: q.hasta, agrupar: q.agrupar,
    total: resumirDuraciones(tiempos.map((t) => (t.duracionSegundos ?? 0) / 60)),
    filas,
    fueraDelPromedio: { sinFin: porEstado.sin_fin ?? 0, descartados: porEstado.descartado ?? 0, enCurso: porEstado.en_curso ?? 0 },
  });
});

// CSV de cada tratamiento medido (sin datos del paciente: solo el id de la cita).
router.get('/reporte.csv', async (req, res) => {
  const { q, tiempos } = await tiemposDelRango(req);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const filas = [
    ['Fecha', 'Sede', 'Consultorio', 'Servicio', 'Profesional', 'Inicio', 'Fin', 'Duración (min)', 'Programado (min)', 'Desvío (min)', 'Origen', 'Hora aproximada', 'Cita'],
    ...tiempos.map((t) => {
      const c = t.cita;
      const min = Math.round(((t.duracionSegundos ?? 0) / 60) * 10) / 10;
      return [
        fechaAStr(t.fecha), t.sede.nombre, `C${t.consultorioNumero}`, c.servicio.nombre,
        c.profesional ? `${c.profesional.nombres} ${c.profesional.apellidos}`.trim() : '',
        horaLima(t.inicioEn), t.finEn ? horaLima(t.finEn) : '', min, c.duracionMinutos, Math.round((min - c.duracionMinutos) * 10) / 10,
        t.origen === 'dispositivo' ? 'Aparato' : 'Manual', t.horaAproximada ? 'Sí' : 'No', c.id,
      ];
    }),
  ];
  // BOM + separador «;» → Excel en español lo abre en columnas sin configurar nada.
  const csv = '﻿' + filas.map((f) => f.map(esc).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tiempos-tratamiento_${q.desde}_${q.hasta}.csv"`);
  res.send(csv);
});

export default router;
