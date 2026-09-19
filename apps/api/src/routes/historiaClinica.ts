import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, puedeTodasLasSedes, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import * as hc from '../services/historiaClinicaService';
import * as b3 from '../services/bloque3Service';
import * as fp from '../services/fichaPreviaService';
import * as pl from '../services/plantillasService';
import fs from 'fs';
import { subirImagenPodograma, validarImagenPodogramaReal, subirFotoClinica, validarFotoClinicaReal } from '../middleware/uploadPodograma';
import { nuevoPdf } from '../services/pdfComun';
import * as resumen from '../services/resumenPacienteService';
import { escribirResumenPacientePdf } from '../services/resumenPacientePdf';
import { escribirHistoriaPdf } from '../services/historiaPdf';
import * as cs from '../services/consentimientoService';
import * as ctl from '../services/controlService';
import { enviarAvisoCoordinacion, enviarRecordatoriosPacientes } from '../services/avisosControles';
import { registrarAudit } from '../services/audit';
import { escribirConsentimientoPdf } from '../services/consentimientoPdf';
import * as cons from '../services/constanciaService';
import { escribirConstanciaPdf } from '../services/constanciaPdf';
import { qrPng, urlVerificacionReceta } from '../services/pdfComun';
import { filtroRecetaMedica, ocultarRecetasMedicas, puedeVerRecetaMedica } from '../services/recetaVisibilidad';

// ─── Historia clínica (Fase 1) ────────────────────────────────────────────────
// Todas las rutas exigen usuario + permiso (`requirePermiso`, nunca `requireAcceso`: las API keys
// no alcanzan datos clínicos). Lecturas de contenido clínico se AUDITAN (`ver_hc`); el
// `resumen` por cita no (no expone contenido). Escrituras devuelven la entidad completa.
const router = Router();
// La receta médica solo la ven admin, coordinación y médico: filtro en TODA respuesta del router.
router.use(filtroRecetaMedica);

const verHc = [requireAuth, requirePermiso('hc.ver')];
const registrar = [requireAuth, requirePermiso('hc.registrar')];
const anular = [requireAuth, requirePermiso('hc.anular')];

const ctx = (req: Request) => ({ usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
const user = (req: Request) => req.user as AuthPayload;

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();

// GET /historia-clinica/paciente/:pacienteId/pdf?fotos=1 — COPIA COMPLETA de la historia (7.6).
// Mismo candado que ver la historia (hc.ver + acceso al paciente); se audita como `exportar_hc`.
router.get('/paciente/:pacienteId/pdf', ...verHc, async (req, res) => {
  const pacienteId = uuid.parse(req.params.pacienteId);
  await hc.assertAccesoPaciente(user(req), pacienteId);
  const crudo = await hc.historiaParaPdf(pacienteId);
  const datos = puedeVerRecetaMedica(req) ? crudo : ocultarRecetasMedicas(crudo);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId, origen: 'hc_pdf' });
  const doc = nuevoPdf(`Historia clínica ${String(datos.historia.numero).padStart(6, '0')}`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="historia-clinica-${String(datos.historia.numero).padStart(6, '0')}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);
  escribirHistoriaPdf(doc, datos, { fotos: req.query.fotos === '1' });
  doc.end();
});

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

// GET /historia-clinica/atenciones/:id — una atención completa (audita ver_hc).
// LECTURA: la historia es una sola por paciente; quien puede abrirla (paciente de sus sedes) lee todas
// sus atenciones, también las de otra sede. ESCRITURA: solo sobre atenciones de la propia sede (assertSede).
router.get('/atenciones/:id', ...verHc, async (req, res) => {
  const at = await hc.getAtencionCompleta(req.params.id);
  await hc.assertAccesoPaciente(user(req), at.pacienteId);
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
  const { sedeId, pacienteId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  const [diagnosticos, nota] = await Promise.all([hc.diagnosticosAnteriores(req.params.id), hc.notaAnterior(req.params.id)]);
  if (nota) await hc.auditarLecturaHC({ ...ctx(req), pacienteId, origen: 'anteriores', atencionId: req.params.id, sedeId });
  res.json({ diagnosticos, nota });
});

// GET /historia-clinica/notas/:id/versiones — historial interno (solo hc.anular)
router.get('/notas/:id/versiones', ...anular, async (req, res) => {
  const n = await prisma.notaEvolucion.findUnique({ where: { id: req.params.id }, select: { atencion: { select: { id: true, sedeId: true, pacienteId: true } } } });
  if (!n) throw new AppError('Nota no encontrada', 404);
  assertSede(req, n.atencion.sedeId);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId: n.atencion.pacienteId, origen: 'versiones', atencionId: n.atencion.id, sedeId: n.atencion.sedeId });
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

// Cerrar: opcionalmente con los controles sugeridos elegidos en el diálogo (4.1).
const controlSchema = z.object({
  fechaSugerida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  motivo: z.string().trim().min(3).max(300),
  origen: z.enum(['iwgdf', 'indicacion', 'manual']),
  servicioId: uuid.nullable().optional(),
});
router.patch('/atenciones/:id/cerrar', ...registrar, async (req, res) => {
  const { controles } = z.object({ controles: z.array(controlSchema).max(6).optional() }).parse(req.body ?? {});
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await hc.cerrarAtencion({ ...ctx(req), atencionId: req.params.id, controles }));
});

// ─── Controles sugeridos (4.1) y su alerta (4.2) ─────────────────────────────
router.get('/atenciones/:id/controles-sugeridos', ...registrar, async (req, res) => {
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await ctl.sugerirControles(req.params.id));
});
// Alcance igual que la bandeja: sedes del usuario; el médico ve los de sus atenciones.
const alcanceControles = (req: Request) => {
  const u = user(req);
  return { sedeIds: puedeTodasLasSedes(u) ? null : u.sedes, profesionalId: u.rol === 'medico' ? u.profesionalId ?? null : null };
};
router.get('/controles', ...verHc, async (req, res) => {
  const horizonteDias = Math.min(90, Math.max(0, Number(req.query.dias) || 14));
  res.json(await ctl.listarControles({ ...alcanceControles(req), horizonteDias }));
});
router.get('/controles/contador', ...verHc, async (req, res) => {
  res.json(await ctl.contarControles(alcanceControles(req)));
});
// Disparo manual de los avisos del día (2.9): coordinación y pacientes. Con `forzar` repite el de
// coordinación aunque ya haya salido hoy; el del paciente nunca se repite por control.
router.post('/controles/avisos', ...anular, async (req, res) => {
  const { forzar } = z.object({ forzar: z.boolean().optional() }).parse(req.body ?? {});
  const [coordinacion, pacientes] = [await enviarAvisoCoordinacion({ forzar }), await enviarRecordatoriosPacientes()];
  await registrarAudit({ ...ctx(req), accion: 'disparar_avisos_controles', entidad: 'control_sugerido', entidadId: '00000000-0000-0000-0000-000000000000', despues: { coordinacion, pacientes } });
  res.json({ coordinacion, pacientes });
});
router.patch('/controles/:id', ...registrar, async (req, res) => {
  const data = z.object({
    accion: z.enum(['agendar', 'descartar']),
    citaId: uuid.nullable().optional(),
    motivo: z.string().trim().max(300).nullable().optional(),
  }).parse(req.body);
  const id = uuid.parse(req.params.id);
  assertSede(req, await ctl.sedeDeControl(id));
  res.json(await ctl.resolverControl({ ...ctx(req), id, ...data }));
});

// Reabrir: hc.anular siempre; hc.registrar solo dentro de las 24 h del cierre (lo decide el servicio).
router.patch('/atenciones/:id/reabrir', ...registrar, async (req, res) => {
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await hc.reabrirAtencion({ ...ctx(req), atencionId: req.params.id, user: user(req) }));
});

// ─── Consentimiento informado (5.1 + formato oficial 18-sep) ─────────────────
// Se firma EN CUALQUIER MOMENTO (desde la cita, la atención o el paciente); inmutable: se corrige
// REVOCANDO, que es un derecho del paciente (sin motivo obligatorio; no hace falta hc.anular).
const consentimientoSchema = z.object({
  plantillaId: uuid.nullable().optional(),
  procedimiento: z.string().trim().max(300).nullable().optional(),
  texto: z.string().trim().max(20000).nullable().optional(),
  firmanteNombre: z.string().trim().min(3).max(200),
  firmanteDocumento: z.string().trim().max(20).nullable().optional(),
  firmanteRelacion: z.enum(['paciente', 'apoderado']),
  firma: z.array(z.unknown()).max(300),
  firmaAspecto: z.number().min(0.5).max(8),
  datos: z.record(z.unknown()).nullable().optional(),
  firmaProfesional: z.array(z.unknown()).max(300).nullable().optional(),
  firmaTestigo: z.array(z.unknown()).max(300).nullable().optional(),
});
const origenSchema = z.object({ citaId: uuid.nullable().optional(), pacienteId: uuid.nullable().optional(), sedeId: uuid.nullable().optional(), atencionId: uuid.nullable().optional() });

/** Sede y paciente del origen (cita, atención o paciente + sede) para el candado de sede. */
async function autorizarOrigen(req: Request, o: z.infer<typeof origenSchema>) {
  if (o.atencionId) { const { sedeId } = await sedeDeAtencion(o.atencionId); assertSede(req, sedeId); return; }
  if (o.citaId) {
    const c = await prisma.cita.findFirst({ where: { id: o.citaId, deletedAt: null }, select: { sedeId: true } });
    if (!c) throw new AppError('Cita no encontrada', 404);
    assertSede(req, c.sedeId); return;
  }
  if (!o.pacienteId || !o.sedeId) throw new AppError('Indica la cita, la atención o el paciente y la sede', 400, 'FALTA_ORIGEN');
  assertSede(req, o.sedeId);
  await hc.assertAccesoPaciente(user(req), o.pacienteId);
}

router.post('/atenciones/:id/consentimientos', ...registrar, async (req, res) => {
  const data = consentimientoSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.status(201).json(await cs.crearConsentimiento({ ...ctx(req), atencionId: req.params.id, ...data }));
});

// Firmar desde la cita (antes de que exista la atención) o solo con paciente + sede.
router.post('/consentimientos', ...registrar, async (req, res) => {
  const data = consentimientoSchema.merge(origenSchema).parse(req.body);
  await autorizarOrigen(req, data);
  res.status(201).json(await cs.crearConsentimiento({ ...ctx(req), ...data }));
});

// Lo que la pantalla necesita para firmar (plantillas que exige el servicio primero, riesgos sugeridos).
router.get('/consentimientos/contexto', ...verHc, async (req, res) => {
  const o = origenSchema.parse(req.query);
  await autorizarOrigen(req, o);
  res.json(await cs.contextoFirma(o));
});

// Consentimientos que FALTAN para una cita (aviso en el detalle de la cita y en la atención).
router.get('/citas/:citaId/consentimientos-pendientes', ...verHc, async (req, res) => {
  const citaId = uuid.parse(req.params.citaId);
  await autorizarOrigen(req, { citaId });
  res.json(await cs.pendientesDeCita(citaId));
});

// Todos los consentimientos del paciente (de cualquier atención o firmados antes de ella).
router.get('/pacientes/:pacienteId/consentimientos', ...verHc, async (req, res) => {
  const pacienteId = uuid.parse(req.params.pacienteId);
  await hc.assertAccesoPaciente(user(req), pacienteId);
  res.json(await cs.consentimientosDelPaciente(pacienteId));
});

// ── Resumen de la atención PARA EL PACIENTE (4.4) ────────────────────────────
// Verlo o descargarlo: `hc.ver` (también con la atención cerrada, que es cuando más se pide).
router.get('/atenciones/:id/resumen-paciente.pdf', ...verHc, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const { resumen: r, at } = await resumen.resumenDeAtencion(id);
  assertSede(req, at.sedeId);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId: at.pacienteId, origen: 'resumen_paciente', atencionId: at.id, sedeId: at.sedeId });
  const doc = nuevoPdf('Resumen de tu atención');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="resumen-atencion-${new Date(at.fecha).toISOString().slice(0, 10)}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);
  escribirResumenPacientePdf(doc, r);
  doc.end();
});

// Qué se le va a mandar y si se puede (para que la pantalla avise ANTES de intentarlo).
router.get('/atenciones/:id/resumen-paciente', ...verHc, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const { resumen: r, at } = await resumen.resumenDeAtencion(id);
  assertSede(req, at.sedeId);
  res.json({
    resumen: r,
    correo: at.paciente.email ?? null,
    motivoNoEnviable: resumen.motivoNoEnviable(at),
    ultimoEnvio: await resumen.ultimoEnvioResumen(id),
  });
});

// Enviarlo por correo con el PDF adjunto: escribe (queda en la auditoría), así que pide `hc.registrar`.
router.post('/atenciones/:id/resumen-paciente/enviar', ...registrar, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const at = await hc.atencionOr404(id);
  assertSede(req, at.sedeId);
  res.json(await resumen.enviarResumenPaciente({ ...ctx(req), atencionId: id }));
});

router.get('/consentimientos/:id/pdf', ...verHc, async (req, res) => {
  const c = await cs.consentimientoParaPdf(uuid.parse(req.params.id));
  assertSede(req, c.sedeId);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId: c.pacienteId, origen: 'consentimiento', atencionId: c.atencionId ?? undefined, sedeId: c.sedeId });
  const doc = nuevoPdf(`Consentimiento informado ${String(c.numero).padStart(5, '0')}`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="consentimiento-${String(c.numero).padStart(5, '0')}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);
  // Formato oficial: por duplicado (historia clínica y paciente); ?copias=1 → solo el de la historia.
  escribirConsentimientoPdf(doc, c, { copias: req.query.copias === '1' ? 1 : 2 });
  doc.end();
});

// ─── Dictado de la consulta (1.6): la transcripción cruda ────────────────────
// El front la autoguarda mientras se dicta (texto completo acumulado) para que nada se pierda si
// se cierra la tablet. `aplicado: true` marca que ya se repartió a los campos.
router.put('/atenciones/:id/dictado', ...registrar, async (req, res) => {
  const { texto, aplicado } = z.object({ texto: z.string().max(50_000), aplicado: z.boolean().optional() }).parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await hc.guardarDictado({ ...ctx(req), atencionId: req.params.id, texto, aplicado }));
});
router.delete('/atenciones/:id/dictado', ...registrar, async (req, res) => {
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await hc.limpiarDictado({ ...ctx(req), atencionId: req.params.id }));
});

// ─── Constancias y descansos médicos (5.4) ───────────────────────────────────
// Constancia de atención: hc.registrar (la firma quien atendió). Descanso médico: además receta.emitir
// y ficha de médico con CMP (lo valida el servicio). Se emiten aunque la atención esté cerrada.
const constanciaSchema = z.object({
  tipo: z.enum(['constancia_atencion', 'descanso_medico']),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dias: z.number().int().min(1).max(cons.MAX_DIAS_DESCANSO).nullable().optional(),
  diagnosticoCie10Codigo: z.string().trim().max(10).nullable().optional(),
  observacion: texto(1000),
});
router.post('/atenciones/:id/constancias', ...registrar, async (req, res) => {
  const data = constanciaSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  if (data.tipo === 'descanso_medico' && !user(req).permisos.includes('receta.emitir')) throw new AppError('El descanso médico lo emite un médico colegiado', 403, 'SOLO_MEDICO');
  res.status(201).json(await cons.emitirConstancia({ ...ctx(req), user: user(req), atencionId: req.params.id, ...data }));
});
router.get('/constancias/:id/pdf', ...verHc, async (req, res) => {
  const meta = await cons.metaConstancia(req.params.id);
  assertSede(req, meta.sedeId);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId: meta.pacienteId, origen: 'constancia', atencionId: meta.atencionId, sedeId: meta.sedeId });
  const c = await cons.constanciaParaPdf(req.params.id);
  const qr = await qrPng(urlVerificacionReceta(c.codigoVerificacion)).catch(() => null);
  const prefijo = c.tipo === 'descanso_medico' ? 'descanso-medico' : 'constancia';
  const doc = nuevoPdf(`${prefijo} ${String(c.numero).padStart(5, '0')}`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${prefijo}-${String(c.numero).padStart(5, '0')}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);
  escribirConstanciaPdf(doc, c, qr);
  doc.end();
});
router.patch('/constancias/:id/anular', ...registrar, async (req, res) => {
  const { motivo } = z.object({ motivo: z.string().trim().min(5).max(500) }).parse(req.body);
  const meta = await cons.metaConstancia(req.params.id);
  assertSede(req, meta.sedeId);
  await cons.anularConstancia({ ...ctx(req), user: user(req), id: req.params.id, motivo });
  res.json({ ok: true });
});

// Revocar: el paciente NO está obligado a expresar el motivo (queda «sin expresar motivo»).
router.patch('/consentimientos/:id/revocar', ...registrar, async (req, res) => {
  const { motivo } = z.object({ motivo: z.string().trim().max(500).nullable().optional() }).parse(req.body ?? {});
  const c = await prisma.consentimientoInformado.findUnique({ where: { id: uuid.parse(req.params.id) }, select: { sedeId: true } });
  if (!c) throw new AppError('Consentimiento no encontrado', 404);
  assertSede(req, c.sedeId);
  await cs.revocarConsentimiento({ ...ctx(req), id: req.params.id, motivo });
  res.json({ ok: true });
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

// Eliminar nota / diagnóstico: el motivo que escribe la pantalla queda en la auditoría.
const motivoOpc = z.object({ motivo: texto(500) }).partial();
router.delete('/notas/:id', ...anular, async (req, res) => {
  const { motivo } = motivoOpc.parse(req.body ?? {});
  assertSede(req, await sedeDeNota(req.params.id));
  res.json(await hc.eliminarNota({ ...ctx(req), notaId: req.params.id, motivo }));
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
  const { motivo } = motivoOpc.parse(req.body ?? {});
  assertSede(req, await sedeDeDx(req.params.id));
  res.json(await hc.eliminarDiagnostico({ ...ctx(req), diagnosticoId: req.params.id, motivo }));
});

// ─── Antecedentes y alergias (por paciente, sin cita) ────────────────────────
// La sede que manda la pantalla (para la auditoría y la apertura de la HC) debe ser una del usuario.
router.post('/paciente/:pacienteId/antecedentes', ...registrar, async (req, res) => {
  const data = antecedenteSchema.parse(req.body);
  await hc.assertAccesoPaciente(user(req), req.params.pacienteId);
  if (data.sedeId) assertSede(req, data.sedeId);
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
  if (data.sedeId) assertSede(req, data.sedeId);
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

// ─── Bloque 3 · Procedimientos, escalas y podograma ──────────────────────────
// Datos de trabajo clínico EDITABLES (decisión médica "editable sin tachones"): añadir,
// editar y quitar van bajo hc.registrar (el borrado es suave + auditado, no una anulación
// legal como en notas/dx). Todo cuelga de la atención → assertSede por su sede.
const pieOpc = z.enum(['izquierdo', 'derecho', 'ambos']).nullable().optional();
const procedimientoSchema = z.object({
  tipo: z.enum(['matricectomia', 'laser', 'curacion', 'debridacion', 'onicotomia', 'quiropodia', 'infiltracion', 'otro']),
  nombre: z.string().trim().max(200).optional(),
  pie: pieOpc,
  ubicacion: texto(200),
  detalle: texto(2000),
  parametros: z.record(z.any()).nullable().optional(),
  anestesia: texto(200),
  paquetePacienteId: uuid.nullable().optional(),
  sesionNumero: z.number().int().min(1).max(200).nullable().optional(),
  profesionalId: uuid.nullable().optional(),
});
const procedimientoEditarSchema = procedimientoSchema.partial();
const escalaSchema = z.object({
  tipo: z.enum(['eva', 'wagner', 'texas', 'iwgdf', 'monofilamento', 'termometria', 'ulcera', 'itb', 'osi', 'manchester', 'examen']),
  datos: z.record(z.any()),
  pie: pieOpc,
});
const escalaEditarSchema = z.object({ datos: z.record(z.any()).optional(), pie: pieOpc });
const marcaSchema = z.object({
  pie: z.enum(['izquierdo', 'derecho']),
  vista: z.enum(['plantar', 'dorsal']).optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zona: texto(120),
  tipoLesion: z.enum(['hiperqueratosis', 'heloma', 'onicocriptosis', 'ulcera', 'fisura', 'micosis', 'ampolla', 'verruga', 'dolor', 'inflamacion', 'cirugia', 'riesgo', 'otro']),
  nota: texto(500),
});
const marcaEditarSchema = marcaSchema.partial();

async function sedeDeProcedimiento(id: string) {
  const r = await prisma.procedimientoAtencion.findUnique({ where: { id }, select: { atencion: { select: { sedeId: true } } } });
  if (!r) throw new AppError('Procedimiento no encontrado', 404);
  return r.atencion.sedeId;
}
async function sedeDeEscala(id: string) {
  const r = await prisma.escalaClinica.findUnique({ where: { id }, select: { atencion: { select: { sedeId: true } } } });
  if (!r) throw new AppError('Escala no encontrada', 404);
  return r.atencion.sedeId;
}
async function sedeDeMarca(id: string) {
  const r = await prisma.marcaPodograma.findUnique({ where: { id }, select: { atencion: { select: { sedeId: true } } } });
  if (!r) throw new AppError('Marca no encontrada', 404);
  return r.atencion.sedeId;
}

// Bandeja del día (ronda del médico): atenciones abiertas con lo que les falta, para revisar y
// cerrar en lote, + pacientes con sesiones pendientes que no vuelven hace N días (abandono).
// Alcance: las sedes del usuario (todas para admin/coordinadora); un médico ve solo las suyas.
router.get('/bandeja', ...verHc, async (req, res) => {
  const u = user(req);
  const dias = Math.min(365, Math.max(7, Number(req.query.dias) || 45));
  res.json(await b3.bandejaDelDia({
    sedeIds: puedeTodasLasSedes(u) ? null : u.sedes,
    profesionalId: u.rol === 'medico' ? u.profesionalId ?? null : null,
    diasSinVolver: dias,
  }));
});

// Ficha previa "de 10 segundos" (2.8): banderas de riesgo + lo último del paciente, para el modal de
// la cita y la ficha. Es contenido clínico → se audita como lectura (origen ficha_previa).
router.get('/paciente/:pacienteId/ficha-previa', ...verHc, async (req, res) => {
  const { pacienteId } = req.params;
  await hc.assertAccesoPaciente(user(req), pacienteId);
  const ficha = await fp.fichaPrevia(pacienteId);
  if (ficha.tieneHistoria) await hc.auditarLecturaHC({ ...ctx(req), pacienteId, origen: 'ficha_previa' });
  res.json(ficha);
});

// Estado de la HC (A3): activa ↔ pasiva (archivo; norma: activa 5 años, pasiva 15). Paso manual de
// administración / coordinación (hc.anular); al registrar una nueva atención vuelve sola a activa.
const estadoHcSchema = z.object({ estado: z.enum(['activa', 'pasiva']), motivo: texto(300) });
router.patch('/paciente/:pacienteId/estado', ...anular, async (req, res) => {
  const data = estadoHcSchema.parse(req.body);
  await hc.assertAccesoPaciente(user(req), req.params.pacienteId);
  res.json(await hc.cambiarEstadoHistoria({ ...ctx(req), pacienteId: req.params.pacienteId, estado: data.estado, motivo: data.motivo ?? null }));
});

// Escalas del paciente a lo largo de sus atenciones (comparar visitas, curva de úlceras)
router.get('/paciente/:pacienteId/escalas', ...verHc, async (req, res) => {
  await hc.assertAccesoPaciente(user(req), req.params.pacienteId);
  const tipo = typeof req.query.tipo === 'string' ? req.query.tipo : undefined;
  const escalas = await fp.escalasDePaciente(req.params.pacienteId, tipo);
  if (escalas.length) await hc.auditarLecturaHC({ ...ctx(req), pacienteId: req.params.pacienteId, origen: 'escalas' });
  res.json(escalas);
});

// Historial del podograma por zona: todo lo registrado en el pie del paciente, atención por atención
router.get('/paciente/:pacienteId/podograma-historial', ...verHc, async (req, res) => {
  const { pacienteId } = req.params;
  await hc.assertAccesoPaciente(user(req), pacienteId);
  const historial = await fp.historialPodograma(pacienteId);
  if (historial.length) await hc.auditarLecturaHC({ ...ctx(req), pacienteId, origen: 'historial_podograma' });
  res.json(historial);
});

// Plantillas de nota por diagnóstico (1.1) y autotextos (1.2): las lee cualquiera con hc.ver;
// las gestionan administración, coordinación y médicos.
const plantillaSchema = z.object({
  tipo: z.enum(['nota', 'autotexto', 'consentimiento']),
  clave: z.string().trim().max(40).nullable().optional(),
  nombre: z.string().trim().min(2).max(120),
  contenido: z.record(z.any()),
  activa: z.boolean().optional(),
});
const ROLES_PLANTILLAS = ['admin', 'coordinadora_sedes', 'medico'];
const gestionaPlantillas = (req: Request, _res: Response, next: NextFunction) => {
  if (!ROLES_PLANTILLAS.includes(user(req).rol)) throw new AppError('Solo administración, coordinación o médicos gestionan plantillas', 403, 'SIN_PERMISO');
  next();
};
router.get('/plantillas', ...verHc, async (req, res) => {
  res.json(await pl.listarPlantillas(typeof req.query.tipo === 'string' ? req.query.tipo : undefined));
});
router.post('/plantillas', ...registrar, gestionaPlantillas, async (req, res) => {
  const data = plantillaSchema.parse(req.body);
  res.status(201).json(await pl.crearPlantilla({ ...ctx(req), ...data }));
});
router.put('/plantillas/:id', ...registrar, gestionaPlantillas, async (req, res) => {
  const data = plantillaSchema.partial().parse(req.body);
  res.json(await pl.editarPlantilla({ ...ctx(req), id: req.params.id, ...data }));
});
router.delete('/plantillas/:id', ...registrar, gestionaPlantillas, async (req, res) => {
  res.json(await pl.eliminarPlantilla({ ...ctx(req), id: req.params.id }));
});

// Membresías/paquetes de láser vivos del paciente (para ligar un procedimiento láser, 1.12)
router.get('/paciente/:pacienteId/paquetes-laser', ...verHc, async (req, res) => {
  await hc.assertAccesoPaciente(user(req), req.params.pacienteId);
  res.json(await b3.paquetesLaserVivos(req.params.pacienteId));
});

// Procedimientos (1.11 / 1.12)
router.post('/atenciones/:id/procedimientos', ...registrar, async (req, res) => {
  const data = procedimientoSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.status(201).json(await b3.agregarProcedimiento({ ...ctx(req), atencionId: req.params.id, ...data }));
});
router.patch('/procedimientos/:id', ...registrar, async (req, res) => {
  const data = procedimientoEditarSchema.parse(req.body);
  assertSede(req, await sedeDeProcedimiento(req.params.id));
  res.json(await b3.editarProcedimiento({ ...ctx(req), procedimientoId: req.params.id, ...data }));
});
router.delete('/procedimientos/:id', ...registrar, async (req, res) => {
  assertSede(req, await sedeDeProcedimiento(req.params.id));
  res.json(await b3.eliminarProcedimiento({ ...ctx(req), procedimientoId: req.params.id }));
});

// Escalas (2.1 EVA · 2.2 Wagner/Texas · 2.3 IWGDF · 2.5 monofilamento)
router.post('/atenciones/:id/escalas', ...registrar, async (req, res) => {
  const data = escalaSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.status(201).json(await b3.guardarEscala({ ...ctx(req), atencionId: req.params.id, ...data }));
});
router.patch('/escalas/:id', ...registrar, async (req, res) => {
  const data = escalaEditarSchema.parse(req.body);
  assertSede(req, await sedeDeEscala(req.params.id));
  res.json(await b3.editarEscala({ ...ctx(req), escalaId: req.params.id, ...data }));
});
router.delete('/escalas/:id', ...registrar, async (req, res) => {
  assertSede(req, await sedeDeEscala(req.params.id));
  res.json(await b3.eliminarEscala({ ...ctx(req), escalaId: req.params.id }));
});

// Podograma (1.3)
router.post('/atenciones/:id/marcas', ...registrar, async (req, res) => {
  const data = marcaSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.status(201).json(await b3.agregarMarca({ ...ctx(req), atencionId: req.params.id, ...data }));
});
router.patch('/marcas/:id', ...registrar, async (req, res) => {
  const data = marcaEditarSchema.parse(req.body);
  assertSede(req, await sedeDeMarca(req.params.id));
  res.json(await b3.editarMarca({ ...ctx(req), marcaId: req.params.id, ...data }));
});
router.delete('/marcas/:id', ...registrar, async (req, res) => {
  assertSede(req, await sedeDeMarca(req.params.id));
  res.json(await b3.eliminarMarca({ ...ctx(req), marcaId: req.params.id }));
});

// ─── Imágenes del podograma (1.3b) ───────────────────────────────────────────
// Subida multipart (campo "imagen"); el archivo se entrega SOLO por GET autenticado con hc.ver
// + sede (nunca por /uploads firmado). Anotaciones = capa vectorial editable, auditada.
const anotacionesSchema = z.object({ anotaciones: z.array(z.unknown()).max(3000) });
const subirImagenSchema = z.object({
  descripcion: z.string().trim().max(300).optional(),
  // Las 4 vistas fijas de la Baro; sin vista = imagen suelta (compatibilidad).
  vista: z.enum(['frontal_izquierdo', 'frontal_derecho', 'posterior_izquierdo', 'posterior_derecho']).optional(),
});

async function sedeDeImagenPodograma(id: string) {
  const r = await prisma.imagenPodograma.findUnique({ where: { id }, select: { atencion: { select: { sedeId: true } } } });
  if (!r) throw new AppError('Imagen no encontrada', 404);
  return r.atencion.sedeId;
}

router.post(
  '/atenciones/:id/podograma/imagenes',
  ...registrar,
  // Autorización ANTES de aceptar bytes: si la sede no corresponde, no se escribe nada en disco.
  async (req, _res, next) => {
    try { const { sedeId } = await sedeDeAtencion(req.params.id); assertSede(req, sedeId); next(); } catch (e) { next(e); }
  },
  subirImagenPodograma,
  validarImagenPodogramaReal,
  async (req, res) => {
    const archivo = req.file;
    if (!archivo) throw new AppError('Adjunta la imagen en el campo "imagen"', 400, 'ARCHIVO_REQUERIDO');
    try {
      const { descripcion, vista } = subirImagenSchema.parse(req.body ?? {});
      res.status(201).json(await b3.registrarImagenPodograma({ ...ctx(req), atencionId: req.params.id, archivo, descripcion, vista }));
    } catch (e) {
      fs.unlink(archivo.path, () => { /* sin huérfanos si falló el registro en BD */ });
      throw e;
    }
  },
);

router.get('/podograma/imagenes/:id', ...verHc, async (req, res) => {
  const img = await b3.archivoImagenPodograma(req.params.id);
  assertSede(req, img.atencion.sedeId);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="${img.nombreArchivo.replace(/[^\w.\-]+/g, '_')}"`);
  res.type(img.mime);
  res.sendFile(img.rutaAbsoluta);
});

// Modo "Pintar" de la silueta: reemplaza la capa de trazos de un pie en una vista
const dibujoSiluetaSchema = z.object({
  vista: z.enum(['plantar', 'dorsal']),
  pie: z.enum(['izquierdo', 'derecho']),
  anotaciones: z.array(z.unknown()).max(3000),
});
router.put('/atenciones/:id/dibujos', ...registrar, async (req, res) => {
  const data = dibujoSiluetaSchema.parse(req.body);
  const { sedeId } = await sedeDeAtencion(req.params.id);
  assertSede(req, sedeId);
  res.json(await b3.guardarDibujoSilueta({ ...ctx(req), atencionId: req.params.id, ...data }));
});

router.patch('/podograma/imagenes/:id/anotaciones', ...registrar, async (req, res) => {
  const { anotaciones } = anotacionesSchema.parse(req.body);
  assertSede(req, await sedeDeImagenPodograma(req.params.id));
  res.json(await b3.guardarAnotacionesPodograma({ ...ctx(req), imagenId: req.params.id, anotaciones }));
});

router.delete('/podograma/imagenes/:id', ...registrar, async (req, res) => {
  assertSede(req, await sedeDeImagenPodograma(req.params.id));
  res.json(await b3.eliminarImagenPodograma({ ...ctx(req), imagenId: req.params.id }));
});

// ─── Fotos clínicas (1.8) + antes/después por paciente (1.9) ─────────────────
// Subida multipart (campo "foto"); el archivo se entrega SOLO por GET autenticado con hc.ver + sede.
const fotoSchema = z.object({
  pie: pieOpc,
  zona: texto(120),
  categoria: z.enum(['lesion', 'calzado', 'otro']).optional(),
  descripcion: texto(300),
  tomadaEn: z.string().datetime({ offset: true }).optional(), // la tablet puede mandar «…-05:00»
});
async function sedeDeFoto(id: string) {
  const r = await prisma.fotoClinica.findUnique({ where: { id }, select: { atencion: { select: { sedeId: true } } } });
  if (!r) throw new AppError('Foto no encontrada', 404);
  return r.atencion.sedeId;
}

router.post(
  '/atenciones/:id/fotos',
  ...registrar,
  async (req, _res, next) => {
    try { const { sedeId } = await sedeDeAtencion(req.params.id); assertSede(req, sedeId); next(); } catch (e) { next(e); }
  },
  subirFotoClinica,
  validarFotoClinicaReal,
  async (req, res) => {
    const archivo = req.file;
    if (!archivo) throw new AppError('Adjunta la foto en el campo "foto"', 400, 'ARCHIVO_REQUERIDO');
    try {
      const data = fotoSchema.parse(req.body ?? {});
      res.status(201).json(await b3.registrarFotoClinica({ ...ctx(req), atencionId: req.params.id, archivo, ...data }));
    } catch (e) {
      fs.unlink(archivo.path, () => { /* sin huérfanos si falló el registro en BD */ });
      throw e;
    }
  },
);

router.get('/fotos/:id', ...verHc, async (req, res) => {
  const f = await b3.archivoFotoClinica(req.params.id);
  assertSede(req, f.atencion.sedeId);
  res.setHeader('Cache-Control', 'private, no-store');
  res.type(f.mime);
  res.sendFile(f.rutaAbsoluta);
});

router.patch('/fotos/:id', ...registrar, async (req, res) => {
  const data = fotoSchema.partial().parse(req.body);
  assertSede(req, await sedeDeFoto(req.params.id));
  res.json(await b3.editarFotoClinica({ ...ctx(req), fotoId: req.params.id, ...data }));
});

router.delete('/fotos/:id', ...registrar, async (req, res) => {
  assertSede(req, await sedeDeFoto(req.params.id));
  res.json(await b3.eliminarFotoClinica({ ...ctx(req), fotoId: req.params.id }));
});

// Todas las fotos del paciente (para el antes/después), opcionalmente por zona
router.get('/paciente/:pacienteId/fotos', ...verHc, async (req, res) => {
  await hc.assertAccesoPaciente(user(req), req.params.pacienteId);
  const fotos = await b3.fotosDePaciente(req.params.pacienteId, (req.query.zona as string | undefined) || null);
  if (fotos.length) await hc.auditarLecturaHC({ ...ctx(req), pacienteId: req.params.pacienteId, origen: 'fotos' });
  res.json(fotos);
});

export default router;
