import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import * as hc from '../services/historiaClinicaService';
import * as b3 from '../services/bloque3Service';
import fs from 'fs';
import { subirImagenPodograma, validarImagenPodogramaReal } from '../middleware/uploadPodograma';

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
  tipo: z.enum(['eva', 'wagner', 'texas', 'iwgdf', 'monofilamento']),
  datos: z.record(z.any()),
  pie: pieOpc,
});
const escalaEditarSchema = z.object({ datos: z.record(z.any()).optional(), pie: pieOpc });
const marcaSchema = z.object({
  pie: z.enum(['izquierdo', 'derecho']),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zona: texto(120),
  tipoLesion: z.enum(['hiperqueratosis', 'heloma', 'onicocriptosis', 'ulcera', 'fisura', 'micosis', 'ampolla', 'verruga', 'otro']),
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
const subirImagenSchema = z.object({ descripcion: z.string().trim().max(300).optional() });

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
      const { descripcion } = subirImagenSchema.parse(req.body ?? {});
      res.status(201).json(await b3.registrarImagenPodograma({ ...ctx(req), atencionId: req.params.id, archivo, descripcion }));
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

router.patch('/podograma/imagenes/:id/anotaciones', ...registrar, async (req, res) => {
  const { anotaciones } = anotacionesSchema.parse(req.body);
  assertSede(req, await sedeDeImagenPodograma(req.params.id));
  res.json(await b3.guardarAnotacionesPodograma({ ...ctx(req), imagenId: req.params.id, anotaciones }));
});

router.delete('/podograma/imagenes/:id', ...registrar, async (req, res) => {
  assertSede(req, await sedeDeImagenPodograma(req.params.id));
  res.json(await b3.eliminarImagenPodograma({ ...ctx(req), imagenId: req.params.id }));
});

export default router;
