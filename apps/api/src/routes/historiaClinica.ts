import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import * as hc from '../services/historiaClinicaService';

// ─── Historia clínica (Fase 1) ────────────────────────────────────────────────
// Todas las rutas exigen usuario + permiso (`requirePermiso`, nunca `requireAcceso`: las API keys
// no alcanzan datos clínicos). Lecturas de contenido clínico se AUDITAN (`ver_hc`); el
// `resumen` por cita no (no expone contenido). Escrituras devuelven la entidad completa.
const router = Router();

const verHc = [requireAuth, requirePermiso('hc.ver')];
const registrar = [requireAuth, requirePermiso('hc.registrar')];
const anular = [requireAuth, requirePermiso('hc.anular')];

const ctx = (req: Request) => ({ usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
const user = (req: Request) => req.user as AuthPayload;

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();

const abrirSchema = z.object({
  citaId: uuid,
  motivoConsulta: z.string().trim().min(2).max(500),
  profesionalId: uuid.nullable().optional(),
});
const editarAtencionSchema = z.object({
  motivoConsulta: z.string().trim().min(2).max(500).optional(),
  profesionalId: uuid.nullable().optional(),
});
const notaSchema = z.object({
  tipo: z.enum(['evolucion', 'procedimiento', 'indicacion', 'observacion']).optional(),
  subjetivo: texto(5000), objetivo: texto(5000), apreciacion: texto(5000), plan: texto(5000), texto: texto(5000),
  profesionalId: uuid.nullable().optional(),
});
const dxSchema = z.object({
  cie10Codigo: z.string().trim().min(3).max(10),
  tipo: z.enum(['presuntivo', 'definitivo']).optional(),
  principal: z.boolean().optional(),
  observacion: texto(500),
});
const dxEditarSchema = dxSchema.partial();
const antecedenteSchema = z.object({
  tipo: z.enum(['patologico', 'quirurgico', 'familiar', 'farmacologico', 'habito', 'otro']),
  descripcion: z.string().trim().min(2).max(1000),
  sedeId: uuid.nullable().optional(),
});
const antecedenteEditarSchema = z.object({
  tipo: z.enum(['patologico', 'quirurgico', 'familiar', 'farmacologico', 'habito', 'otro']).optional(),
  descripcion: z.string().trim().min(2).max(1000).optional(),
  activo: z.boolean().optional(),
});
const alergiaSchema = z.object({
  sustancia: z.string().trim().min(2).max(200),
  reaccion: texto(500),
  severidad: z.enum(['leve', 'moderada', 'severa']).optional(),
  sedeId: uuid.nullable().optional(),
});
const alergiaEditarSchema = z.object({
  sustancia: z.string().trim().min(2).max(200).optional(),
  reaccion: texto(500),
  severidad: z.enum(['leve', 'moderada', 'severa']).optional(),
  activa: z.boolean().optional(),
});

async function sedeDeAtencion(atencionId: string): Promise<{ sedeId: string; pacienteId: string }> {
  const at = await prisma.atencionClinica.findUnique({ where: { id: atencionId }, select: { sedeId: true, pacienteId: true } });
  if (!at) throw new AppError('Atención no encontrada', 404);
  return at;
}
async function sedeDeNota(notaId: string) {
  const n = await prisma.notaEvolucion.findUnique({ where: { id: notaId }, select: { atencion: { select: { sedeId: true } } } });
  if (!n) throw new AppError('Nota no encontrada', 404);
  return n.atencion.sedeId;
}
async function sedeDeDx(id: string) {
  const d = await prisma.diagnosticoAtencion.findUnique({ where: { id }, select: { atencion: { select: { sedeId: true } } } });
  if (!d) throw new AppError('Diagnóstico no encontrado', 404);
  return d.atencion.sedeId;
}
async function pacienteDeAntecedente(id: string) {
  const a = await prisma.antecedentePaciente.findUnique({ where: { id }, select: { historiaClinica: { select: { pacienteId: true } } } });
  if (!a) throw new AppError('Antecedente no encontrado', 404);
  return a.historiaClinica.pacienteId;
}
async function pacienteDeAlergia(id: string) {
  const a = await prisma.alergiaPaciente.findUnique({ where: { id }, select: { historiaClinica: { select: { pacienteId: true } } } });
  if (!a) throw new AppError('Alergia no encontrada', 404);
  return a.historiaClinica.pacienteId;
}

// ─── Lecturas ─────────────────────────────────────────────────────────────────
// GET /historia-clinica/paciente/:pacienteId — HC completa (audita ver_hc)
router.get('/paciente/:pacienteId', ...verHc, async (req, res) => {
  const { pacienteId } = req.params;
  await hc.assertAccesoPaciente(user(req), pacienteId);
  const data = await hc.getHistoriaCompleta(pacienteId);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId, origen: 'ficha' });
  res.json(data);
});

// GET /historia-clinica/atenciones/:id — una atención completa (audita ver_hc)
router.get('/atenciones/:id', ...verHc, async (req, res) => {
  const at = await hc.getAtencionCompleta(req.params.id);
  assertSede(req, at.sedeId);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId: at.pacienteId, origen: 'atencion', atencionId: at.id, sedeId: at.sedeId });
  res.json(at);
});

// GET /historia-clinica/atencion/por-cita/:citaId/resumen — liviano, SIN auditar (modal de cita)
router.get('/atencion/por-cita/:citaId/resumen', ...verHc, async (req, res) => {
  const cita = await prisma.cita.findFirst({ where: { id: req.params.citaId, deletedAt: null }, select: { sedeId: true } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  assertSede(req, cita.sedeId);
  res.json(await hc.resumenAtencionPorCita(req.params.citaId));
});

// GET /historia-clinica/atenciones/:id/anteriores — dx y nota previos ("copiar anterior" / "traer última nota")
router.get('/atenciones/:id/anteriores', ...verHc, async (req, res) => {
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  const [diagnosticos, nota] = await Promise.all([hc.diagnosticosAnteriores(req.params.id), hc.notaAnterior(req.params.id)]);
  res.json({ diagnosticos, nota });
});

// GET /historia-clinica/notas/:id/versiones — historial interno (solo hc.anular)
router.get('/notas/:id/versiones', ...anular, async (req, res) => {
  assertSede(req, await sedeDeNota(req.params.id));
  res.json(await hc.versionesDeNota(req.params.id));
});

// ─── Atención ─────────────────────────────────────────────────────────────────
// POST /historia-clinica/atenciones — abrir atención desde una cita atendida
router.post('/atenciones', ...registrar, async (req, res) => {
  const data = abrirSchema.parse(req.body);
  const cita = await prisma.cita.findFirst({ where: { id: data.citaId, deletedAt: null }, select: { sedeId: true } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  assertSede(req, cita.sedeId);
  res.status(201).json(await hc.abrirAtencion({ ...ctx(req), ...data }));
});

router.patch('/atenciones/:id', ...registrar, async (req, res) => {
  const data = editarAtencionSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await hc.editarAtencion({ ...ctx(req), atencionId: req.params.id, ...data }));
});

router.patch('/atenciones/:id/cerrar', ...registrar, async (req, res) => {
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await hc.cerrarAtencion({ ...ctx(req), atencionId: req.params.id }));
});

router.patch('/atenciones/:id/reabrir', ...anular, async (req, res) => {
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await hc.reabrirAtencion({ ...ctx(req), atencionId: req.params.id }));
});

// ─── Notas ────────────────────────────────────────────────────────────────────
router.post('/atenciones/:id/notas', ...registrar, async (req, res) => {
  const data = notaSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.status(201).json(await hc.agregarNota({ ...ctx(req), atencionId: req.params.id, ...data }));
});

router.patch('/notas/:id', ...registrar, async (req, res) => {
  const data = notaSchema.parse(req.body);
  assertSede(req, await sedeDeNota(req.params.id));
  res.json(await hc.editarNota({ ...ctx(req), notaId: req.params.id, ...data }));
});

router.delete('/notas/:id', ...anular, async (req, res) => {
  assertSede(req, await sedeDeNota(req.params.id));
  res.json(await hc.eliminarNota({ ...ctx(req), notaId: req.params.id }));
});

// ─── Diagnósticos ─────────────────────────────────────────────────────────────
router.post('/atenciones/:id/diagnosticos', ...registrar, async (req, res) => {
  const data = dxSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.status(201).json(await hc.agregarDiagnostico({ ...ctx(req), atencionId: req.params.id, ...data }));
});

router.patch('/diagnosticos/:id', ...registrar, async (req, res) => {
  const data = dxEditarSchema.parse(req.body);
  assertSede(req, await sedeDeDx(req.params.id));
  res.json(await hc.editarDiagnostico({ ...ctx(req), diagnosticoId: req.params.id, ...data }));
});

router.delete('/diagnosticos/:id', ...registrar, async (req, res) => {
  assertSede(req, await sedeDeDx(req.params.id));
  res.json(await hc.eliminarDiagnostico({ ...ctx(req), diagnosticoId: req.params.id }));
});

// ─── Antecedentes y alergias (por paciente, sin cita) ────────────────────────
router.post('/paciente/:pacienteId/antecedentes', ...registrar, async (req, res) => {
  const data = antecedenteSchema.parse(req.body);
  await hc.assertAccesoPaciente(user(req), req.params.pacienteId);
  res.status(201).json(await hc.registrarAntecedente({ ...ctx(req), pacienteId: req.params.pacienteId, ...data }));
});
router.patch('/antecedentes/:id', ...registrar, async (req, res) => {
  const data = antecedenteEditarSchema.parse(req.body);
  await hc.assertAccesoPaciente(user(req), await pacienteDeAntecedente(req.params.id));
  res.json(await hc.editarAntecedente({ ...ctx(req), antecedenteId: req.params.id, ...data }));
});
router.delete('/antecedentes/:id', ...anular, async (req, res) => {
  await hc.assertAccesoPaciente(user(req), await pacienteDeAntecedente(req.params.id));
  res.json(await hc.eliminarAntecedente({ ...ctx(req), antecedenteId: req.params.id }));
});

router.post('/paciente/:pacienteId/alergias', ...registrar, async (req, res) => {
  const data = alergiaSchema.parse(req.body);
  await hc.assertAccesoPaciente(user(req), req.params.pacienteId);
  res.status(201).json(await hc.registrarAlergia({ ...ctx(req), pacienteId: req.params.pacienteId, ...data }));
});
router.patch('/alergias/:id', ...registrar, async (req, res) => {
  const data = alergiaEditarSchema.parse(req.body);
  await hc.assertAccesoPaciente(user(req), await pacienteDeAlergia(req.params.id));
  res.json(await hc.editarAlergia({ ...ctx(req), alergiaId: req.params.id, ...data }));
});
router.delete('/alergias/:id', ...anular, async (req, res) => {
  await hc.assertAccesoPaciente(user(req), await pacienteDeAlergia(req.params.id));
  res.json(await hc.eliminarAlergia({ ...ctx(req), alergiaId: req.params.id }));
});

export default router;
