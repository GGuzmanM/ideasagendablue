/**
 * Reportes clínicos (7.1 epidemiológico, 7.3 productividad, 7.4 calidad del registro).
 *
 *   GET /reportes-clinicos/reporte?desde&hasta&sedeId&agrupar=diagnostico|procedimiento|profesional|sede|edad
 *   GET /reportes-clinicos/reporte.csv   (mismos filtros)
 *
 * Permiso `analytics.ver`, como el resto de reportes: son CONTEOS, no contenido clínico. Nunca sale
 * un nombre de paciente ni un texto de la historia; por eso el mapa por sede se puede mirar sin
 * exponer a nadie. El scoping por sede es el de siempre: quien no ve todas las sedes, solo las suyas.
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, puedeTodasLasSedes } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { fechaDb } from '../utils/fechaLima';
import { agrupar, calidadPorProfesional, edadEn, totales, type AtencionPlana, type Agrupar } from '../services/reportesClinicos';

const router = Router();
router.use(requireAuth, requirePermiso('analytics.ver'));

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const reporteSchema = z.object({
  desde: z.string().regex(FECHA),
  hasta: z.string().regex(FECHA),
  sedeId: z.string().uuid().optional(),
  agrupar: z.enum(['diagnostico', 'procedimiento', 'profesional', 'sede', 'edad']).default('diagnostico'),
});

async function atencionesDelRango(req: Request) {
  const q = reporteSchema.parse(req.query);
  if (q.desde > q.hasta) throw new AppError('El rango de fechas está invertido', 400, 'RANGO_INVALIDO');
  if (q.sedeId) assertSede(req, q.sedeId);
  const sedes = q.sedeId ? [q.sedeId] : (req.user && !puedeTodasLasSedes(req.user) ? req.user.sedes : null);

  const filas = await prisma.atencionClinica.findMany({
    where: {
      fecha: { gte: fechaDb(q.desde), lte: fechaDb(q.hasta) },
      ...(sedes ? { sedeId: { in: sedes } } : {}),
    },
    orderBy: { fecha: 'asc' },
    select: {
      id: true, fecha: true, estado: true, sedeId: true, pacienteId: true, profesionalId: true,
      sede: { select: { nombre: true } },
      profesional: { select: { nombres: true, apellidos: true } },
      paciente: { select: { fechaNacimiento: true } },
      diagnosticos: { where: { deletedAt: null }, select: { cie10Codigo: true, principal: true, cie10: { select: { descripcion: true } } } },
      procedimientos: { where: { deletedAt: null }, select: { tipo: true, nombre: true } },
      notas: { where: { deletedAt: null }, select: { subjetivo: true, objetivo: true, apreciacion: true, plan: true, texto: true } },
      recetas: { where: { estado: 'emitida' }, select: { id: true } },
      fotos: { where: { deletedAt: null }, select: { id: true } },
      consentimientos: { where: { estado: 'firmado' }, select: { id: true } },
    },
  });

  const planas: AtencionPlana[] = filas.map((a) => ({
    id: a.id,
    fecha: a.fecha,
    sedeId: a.sedeId,
    sedeNombre: a.sede?.nombre ?? '—',
    profesionalId: a.profesionalId,
    profesionalNombre: `${a.profesional?.nombres ?? ''} ${a.profesional?.apellidos ?? ''}`.trim(),
    pacienteId: a.pacienteId,
    edad: edadEn(a.paciente?.fechaNacimiento, a.fecha),
    cerrada: a.estado === 'cerrada',
    diagnosticos: a.diagnosticos.map((d) => ({ codigo: d.cie10Codigo, descripcion: d.cie10?.descripcion ?? d.cie10Codigo, principal: d.principal })),
    procedimientos: a.procedimientos.map((p) => ({ tipo: p.tipo, nombre: p.nombre })),
    conNota: a.notas.some((n) => [n.subjetivo, n.objetivo, n.apreciacion, n.plan, n.texto].some((x) => (x ?? '').trim().length > 0)),
    conReceta: a.recetas.length > 0,
    conFoto: a.fotos.length > 0,
    conConsentimiento: a.consentimientos.length > 0,
  }));
  return { q, planas };
}

router.get('/reporte', async (req, res) => {
  const { q, planas } = await atencionesDelRango(req);
  res.json({
    desde: q.desde,
    hasta: q.hasta,
    agrupar: q.agrupar,
    totales: totales(planas),
    filas: agrupar(planas, q.agrupar as Agrupar),
    calidad: calidadPorProfesional(planas),
  });
});

router.get('/reporte.csv', async (req, res) => {
  const { q, planas } = await atencionesDelRango(req);
  const filas = agrupar(planas, q.agrupar as Agrupar);
  const t = totales(planas);
  const cab = ['Agrupado por', 'Atenciones', 'Pacientes distintos', '% de las atenciones', 'Procedimientos'];
  const cuerpo = filas.map((f) => [f.etiqueta, f.atenciones, f.pacientes, `${f.porcentaje}%`, f.procedimientos ?? '']);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lineas = [
    [`Reporte clínico · ${q.agrupar}`, `${q.desde} a ${q.hasta}`],
    ['Atenciones', t.atenciones, 'Cerradas', t.cerradas, 'Pacientes', t.pacientes, 'Con diagnóstico', t.conDiagnostico, 'Registro completo', `${t.completas}%`],
    [],
    cab,
    ...cuerpo,
  ];
  const csv = '﻿' + lineas.map((f) => f.map(esc).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-clinico-${q.agrupar}_${q.desde}_${q.hasta}.csv"`);
  res.send(csv);
});

export default router;
