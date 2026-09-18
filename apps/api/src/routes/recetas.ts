import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import * as hc from '../services/historiaClinicaService';
import * as rx from '../services/recetaService';
import { escribirRecetaPdf } from '../services/recetaPdf';
import { nuevoPdf, qrPng, urlVerificacionReceta } from '../services/pdfComun';
import { filtroRecetaMedica, puedeVerRecetaMedica } from '../services/recetaVisibilidad';
import { registrarAudit } from '../services/audit';

// ─── Recetas e indicaciones (Fase 2) ──────────────────────────────────────────
// Permisos por TIPO de documento:
//  · RECETA_MEDICA → `receta.emitir` (solo rol médico) + candado de médico en el servicio.
//  · INDICACIONES_PODOLOGICAS → `hc.registrar` (recepción las registra a nombre de la podóloga).
//  · Anular: quien lo emitió (con el permiso del tipo) o `hc.anular`.
//  · Leer y PDF → `receta.ver` (auditado como ver_receta); la RECETA MÉDICA además `receta_medica.ver`
//    (solo admin, coordinación y médico — recepción ve las indicaciones, no la receta).
const router = Router();
router.use(filtroRecetaMedica);

const ver = [requireAuth, requirePermiso('receta.ver')];

const ctx = (req: Request) => ({ usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
const user = (req: Request) => req.user as AuthPayload;
const permisoParaTipo = (tipo: string) => (tipo === 'RECETA_MEDICA' ? 'receta.emitir' : 'hc.registrar');
function exigirPermiso(req: Request, permiso: string): void {
  if (!user(req).permisos?.includes(permiso)) {
    const que = permiso === 'receta.emitir' ? 'Solo un médico colegiado puede hacer esto con una receta médica' : 'No tienes permiso para esta acción';
    throw new AppError(que, 403, 'SIN_PERMISO');
  }
}
const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();

const itemSchema = z.object({
  tipo: z.enum(['MEDICAMENTO_RX', 'MEDICAMENTO_OTC', 'PRODUCTO', 'SERVICIO']).optional(),
  diagnosticoCie10Codigo: z.string().trim().max(10).nullable().optional(),
  medicamentoId: z.string().trim().max(120).nullable().optional(),
  servicioId: uuid.nullable().optional(),
  nombre: texto(200),
  marcaImpresa: texto(120),
  concentracion: texto(60),
  formaFarmaceutica: texto(60),
  dosis: texto(120), via: texto(60), frecuencia: texto(120), duracion: texto(120), cantidad: texto(60), indicaciones: texto(800),
});
const emitirSchema = z.object({
  atencionId: uuid,
  tipoDocumento: z.enum(['RECETA_MEDICA', 'INDICACIONES_PODOLOGICAS']).default('RECETA_MEDICA'),
  emisorProfesionalId: uuid.nullable().optional(),
  indicacionesGenerales: texto(1500),
  vigenciaDias: z.number().int().min(1).max(365).nullable().optional(),
  items: z.array(itemSchema).min(1).max(30),
});
const anularSchema = z.object({ motivo: z.string().trim().min(5).max(500) });

async function recetaMeta(id: string, req: Request) {
  const r = await prisma.receta.findUnique({ where: { id }, select: { id: true, sedeId: true, pacienteId: true, tipoDocumento: true, emisorProfesionalId: true } });
  if (!r) throw new AppError('Receta no encontrada', 404);
  if (r.tipoDocumento === 'RECETA_MEDICA' && !puedeVerRecetaMedica(req)) {
    throw new AppError('La receta médica solo la ven e imprimen el médico, coordinación y administración', 403, 'RECETA_RESERVADA');
  }
  return r;
}

// POST /recetas — emitir receta médica (receta.emitir) o indicaciones podológicas (hc.registrar)
router.post('/', requireAuth, async (req, res) => {
  const data = emitirSchema.parse(req.body);
  exigirPermiso(req, permisoParaTipo(data.tipoDocumento));
  const at = await prisma.atencionClinica.findUnique({ where: { id: data.atencionId }, select: { sedeId: true } });
  if (!at) throw new AppError('Atención no encontrada', 404);
  assertSede(req, at.sedeId);
  const receta = await rx.emitirReceta({ ...ctx(req), user: user(req), ...data });
  const advertencias = rx.advertenciasAlergia(receta.historiaClinica.alergias, receta.items);
  res.status(201).json({ ...receta, advertencias });
});

// POST /recetas/advertencias — cruce alergias vs ítems ANTES de emitir (3.1); basta hc.registrar
// También interacciones entre los ítems (3.2) y contraindicaciones por condición del paciente (3.3).
router.post('/advertencias', requireAuth, requirePermiso('hc.registrar'), async (req, res) => {
  const data = z.object({
    atencionId: uuid,
    items: z.array(z.object({
      nombre: z.string().trim().min(1), marcaImpresa: z.string().nullable().optional(), medicamentoId: z.string().trim().max(120).nullable().optional(),
      via: z.string().nullable().optional(), formaFarmaceutica: z.string().nullable().optional(),
    })).max(30),
  }).parse(req.body);
  const at = await prisma.atencionClinica.findUnique({
    where: { id: data.atencionId },
    select: { sedeId: true, pacienteId: true, historiaClinica: { select: { alergias: { where: { deletedAt: null, activa: true }, select: { sustancia: true, severidad: true } } } } },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  assertSede(req, at.sedeId);
  res.json(await rx.avisosReceta({ pacienteId: at.pacienteId, alergias: at.historiaClinica.alergias, items: data.items }));
});

// ─── Favoritas (3.5) — ANTES de /:id para que «favoritas» no se tome como un id ───
const TIPO_DOC = z.enum(['RECETA_MEDICA', 'INDICACIONES_PODOLOGICAS']);
const favoritaSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  tipoDocumento: TIPO_DOC,
  items: z.array(itemSchema).min(1).max(30),
  indicacionesGenerales: texto(1500),
  vigenciaDias: z.number().int().min(1).max(365).nullable().optional(),
});

// GET /recetas/favoritas?tipo= — quien puede emitir ese tipo de documento
router.get('/favoritas', requireAuth, async (req, res) => {
  const { tipo } = z.object({ tipo: TIPO_DOC }).parse(req.query);
  exigirPermiso(req, permisoParaTipo(tipo));
  res.json(await rx.listarFavoritas(tipo));
});

router.post('/favoritas', requireAuth, async (req, res) => {
  const data = favoritaSchema.parse(req.body);
  exigirPermiso(req, permisoParaTipo(data.tipoDocumento));
  res.status(201).json(await rx.crearFavorita({ ...ctx(req), ...data }));
});

router.delete('/favoritas/:id', requireAuth, async (req, res) => {
  res.json(await rx.eliminarFavorita({ ...ctx(req), user: user(req), id: uuid.parse(req.params.id) }));
});

// GET /recetas/paciente/:pacienteId — historial de recetas del paciente
router.get('/paciente/:pacienteId', ...ver, async (req, res) => {
  await hc.assertAccesoPaciente(user(req), req.params.pacienteId);
  const lista = await rx.listarRecetasPaciente(req.params.pacienteId);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId: req.params.pacienteId, origen: 'receta' });
  res.json(lista);
});

// GET /recetas/:id
router.get('/:id', ...ver, async (req, res) => {
  const meta = await recetaMeta(req.params.id, req);
  assertSede(req, meta.sedeId);
  const receta = await rx.getRecetaCompleta(meta.id);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId: meta.pacienteId, origen: 'receta', recetaId: meta.id, sedeId: meta.sedeId });
  res.json(receta);
});

// GET /recetas/:id/pdf — PDF en streaming (inline), con QR de verificación.
// La receta médica sale con ORIGINAL (paciente) + COPIA (farmacia) en páginas separadas; ?copias=1
// imprime solo el original. Las indicaciones salen en una sola copia.
router.get('/:id/pdf', ...ver, async (req, res) => {
  const meta = await recetaMeta(req.params.id, req);
  assertSede(req, meta.sedeId);
  const receta = await rx.getRecetaCompleta(meta.id);
  await hc.auditarLecturaHC({ ...ctx(req), pacienteId: meta.pacienteId, origen: 'pdf', recetaId: meta.id, sedeId: meta.sedeId });
  const conCopia = receta.tipoDocumento === 'RECETA_MEDICA' && req.query.copias !== '1';
  // ?firma=1 — estampar la firma digitalizada. SOLO el médico a cuyo nombre salió la receta, con la
  // SUYA; nadie más puede ponerle la firma de otro. Sin ?firma=1 sale la línea para firmar a mano.
  let firma: Buffer | null = null;
  if (req.query.firma === '1') {
    if (receta.tipoDocumento !== 'RECETA_MEDICA') throw new AppError('La firma digitalizada es solo para la receta médica', 400, 'FIRMA_SOLO_RECETA');
    if (receta.estado !== 'emitida') throw new AppError('La receta está anulada: no se firma', 409, 'YA_ANULADA');
    if (!user(req).profesionalId || user(req).profesionalId !== receta.emisorProfesionalId) {
      throw new AppError('Solo el médico a cuyo nombre está la receta puede estampar su firma', 403, 'FIRMA_AJENA');
    }
    const f = await prisma.firmaProfesional.findUnique({ where: { profesionalId: receta.emisorProfesionalId } });
    if (!f) throw new AppError('Aún no subiste tu firma: hazlo en «Mi firma y sello»', 409, 'SIN_FIRMA');
    firma = Buffer.from(f.imagen);
    await registrarAudit({ ...ctx(req), citaId: receta.atencion.citaId, accion: 'estampar_firma', entidad: 'receta', entidadId: receta.id, sedeId: meta.sedeId, despues: { numero: receta.numero } });
  }
  const qr = await qrPng(urlVerificacionReceta(receta.codigoVerificacion));
  const doc = nuevoPdf(`Receta ${receta.numero}`);
  const prefijo = receta.tipoDocumento === 'RECETA_MEDICA' ? 'receta' : 'indicaciones';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${prefijo}-${String(receta.numero).padStart(6, '0')}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);
  escribirRecetaPdf(doc, receta, { qr, firma, copias: conCopia ? ['original', 'farmacia'] : [null] });
  doc.end();
});

// PATCH /recetas/:id/anular — hc.anular, o quien lo emitió con el permiso de su tipo
router.patch('/:id/anular', requireAuth, async (req, res) => {
  const { motivo } = anularSchema.parse(req.body);
  const r = await prisma.receta.findUnique({ where: { id: req.params.id }, select: { id: true, sedeId: true, tipoDocumento: true } });
  if (!r) throw new AppError('Receta no encontrada', 404);
  const u = user(req);
  if (!u.permisos?.includes('hc.anular')) exigirPermiso(req, permisoParaTipo(r.tipoDocumento));
  assertSede(req, r.sedeId);
  res.json(await rx.anularReceta({ ...ctx(req), user: u, recetaId: r.id, motivo }));
});

export default router;
