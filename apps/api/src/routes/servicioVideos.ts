import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from '../services/audit';
import { extraerYoutubeVideoId } from '../utils/youtube';
import { enviarEmail, resendConfigurado } from '../services/emailService';
import { inlineLogoParaPreview } from '../services/emailTemplates';
import {
  backfillVideoNuevo,
  reprogramarVideo,
  cancelarEnviosDeVideo,
  contarPendientesDeVideo,
  construirCorreoVideo,
  muestraDestinatario,
  cancelarVideosPorCorreo,
  enviarVideoManual,
  MOTIVO,
} from '../services/videoEnvioService';

const router = Router();

// Todas las rutas del módulo son SOLO administradores.
router.use(requireAuth, requireRol('admin'));

// ─── Validación ───────────────────────────────────────────────────────────────
const videoSchema = z.object({
  servicioId: z.string().uuid(),
  youtubeUrl: z.string().trim().min(5, 'Pega la URL del video de YouTube'),
  asunto: z.string().trim().min(1, 'El asunto es obligatorio').max(120, 'Máx 120 caracteres'),
  tituloVideo: z.string().trim().min(1, 'El título es obligatorio').max(100, 'Máx 100 caracteres'),
  cuerpoTexto: z.string().trim().min(1, 'El texto es obligatorio').max(300, 'Máx 300 caracteres'),
  momento: z.enum(['ANTES', 'DESPUES']),
  offsetValor: z.number().int().positive('Debe ser mayor a 0').max(999, 'Valor demasiado grande'),
  offsetUnidad: z.enum(['HORAS', 'DIAS', 'MESES', 'ANIOS']),
  orden: z.number().int().min(0).optional(),
});

const videoSelect = {
  id: true, servicioId: true, youtubeVideoId: true, youtubeUrl: true,
  asunto: true, tituloVideo: true, cuerpoTexto: true,
  momento: true, offsetValor: true, offsetUnidad: true,
  orden: true, activo: true, creadoEn: true, actualizadoEn: true,
} as const;

// ─── GET /servicio-videos?servicioId= — videos de un servicio (activos y pausados) ──
router.get('/', async (req, res) => {
  const { servicioId } = req.query as Record<string, string>;
  if (!servicioId) throw new AppError('Falta servicioId', 400);
  const videos = await prisma.servicioVideo.findMany({
    where: { servicioId, deletedAt: null },
    select: videoSelect,
    orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
  });
  res.json(videos);
});

// ─── GET /servicio-videos/resumen — servicios + conteo de videos (badges) ──────
router.get('/resumen', async (_req, res) => {
  const counts = await prisma.servicioVideo.groupBy({
    by: ['servicioId'], where: { deletedAt: null }, _count: { _all: true },
  });
  const mapa = new Map(counts.map((c) => [c.servicioId, c._count._all]));
  const servicios = await prisma.servicio.findMany({
    where: { deletedAt: null, activo: true },
    select: { id: true, nombre: true, color: true, unidadNegocio: { select: { nombre: true } } },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
  });
  res.json(servicios.map((s) => ({
    id: s.id, nombre: s.nombre, color: s.color,
    unidad: s.unidadNegocio?.nombre ?? null,
    videos: mapa.get(s.id) ?? 0,
  })));
});

// ─── GET /servicio-videos/historial — monitoreo (CAPA 4, solo lectura) ─────────
router.get('/historial', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = { deletedAt: null };
  if (q.estado) where.estado = q.estado;
  if (q.servicioId) where.servicioVideo = { servicioId: q.servicioId };
  if (q.desde || q.hasta) {
    where.scheduledFor = {
      ...(q.desde ? { gte: new Date(`${q.desde}T00:00:00.000Z`) } : {}),
      ...(q.hasta ? { lte: new Date(`${q.hasta}T23:59:59.999Z`) } : {}),
    };
  }
  const logs = await prisma.videoEnvioLog.findMany({
    where,
    orderBy: { scheduledFor: 'desc' },
    take: 500,
    select: {
      id: true, estado: true, scheduledFor: true, sentAt: true, errorDetalle: true,
      motivoCancelacion: true, intentos: true, pacienteEmail: true,
      servicioVideo: { select: { tituloVideo: true, servicio: { select: { nombre: true } } } },
      cita: {
        select: {
          fecha: true, horaInicio: true, estado: true,
          paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true } },
          sede: { select: { nombre: true } },
        },
      },
    },
  });
  res.json(logs.map((l) => ({
    id: l.id,
    estado: l.estado,
    scheduledFor: l.scheduledFor,
    sentAt: l.sentAt,
    error: l.errorDetalle,
    motivoCancelacion: l.motivoCancelacion,
    intentos: l.intentos,
    email: l.pacienteEmail,
    video: l.servicioVideo?.tituloVideo ?? null,
    servicio: l.servicioVideo?.servicio.nombre ?? null,
    paciente: l.cita ? `${l.cita.paciente.nombres} ${l.cita.paciente.apellidoPaterno} ${l.cita.paciente.apellidoMaterno}` : null,
    citaFecha: l.cita?.fecha ?? null,
    citaHora: l.cita?.horaInicio ?? null,
    sede: l.cita?.sede.nombre ?? null,
  })));
});

// ─── GET /servicio-videos/tracking — envíos agrupados POR CITA (pestaña tracking) ──
// Una fila por cita, con sus videos "antes" y "después" (estado + veces enviado). Filtros:
// estado, servicioId, sedeId, desde/hasta (por fecha de cita), q (nombre/DNI del paciente).
router.get('/tracking', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const whereCita: Record<string, unknown> = { deletedAt: null };
  if (q.servicioId) whereCita.servicioId = q.servicioId;
  if (q.sedeId) whereCita.sedeId = q.sedeId;
  if (q.desde || q.hasta) {
    whereCita.fecha = {
      ...(q.desde ? { gte: new Date(`${q.desde}T00:00:00.000Z`) } : {}),
      ...(q.hasta ? { lte: new Date(`${q.hasta}T23:59:59.999Z`) } : {}),
    };
  }
  if (q.q) {
    const t = q.q.trim();
    whereCita.paciente = { OR: [
      { nombres: { contains: t, mode: 'insensitive' } },
      { apellidoPaterno: { contains: t, mode: 'insensitive' } },
      { apellidoMaterno: { contains: t, mode: 'insensitive' } },
      { numeroDocumento: { contains: t, mode: 'insensitive' } },
    ] };
  }

  const logs = await prisma.videoEnvioLog.findMany({
    where: { deletedAt: null, ...(q.estado ? { estado: q.estado as never } : {}), cita: whereCita },
    orderBy: [{ cita: { fecha: 'desc' } }, { cita: { horaInicio: 'desc' } }],
    take: 1200,
    select: {
      id: true, estado: true, scheduledFor: true, sentAt: true, errorDetalle: true,
      motivoCancelacion: true, vecesEnviado: true,
      servicioVideo: { select: { id: true, momento: true, tituloVideo: true, youtubeVideoId: true, offsetValor: true, offsetUnidad: true } },
      cita: {
        select: {
          id: true, fecha: true, horaInicio: true,
          paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, email: true } },
          servicio: { select: { nombre: true } },
          sede: { select: { nombre: true } },
        },
      },
    },
  });

  // Agrupa por cita, separando antes/después.
  const porCita = new Map<string, any>();
  for (const l of logs) {
    if (!l.cita || !l.servicioVideo) continue;
    const c = l.cita;
    let row = porCita.get(c.id);
    if (!row) {
      row = {
        citaId: c.id,
        paciente: `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.trim(),
        email: c.paciente.email,
        servicio: c.servicio.nombre,
        fecha: c.fecha, horaInicio: c.horaInicio,
        sede: c.sede.nombre,
        antes: [], despues: [],
      };
      porCita.set(c.id, row);
    }
    const entry = {
      logId: l.id, servicioVideoId: l.servicioVideo.id, titulo: l.servicioVideo.tituloVideo,
      youtubeVideoId: l.servicioVideo.youtubeVideoId,
      offsetValor: l.servicioVideo.offsetValor, offsetUnidad: l.servicioVideo.offsetUnidad,
      estado: l.estado, veces: l.vecesEnviado, sentAt: l.sentAt, scheduledFor: l.scheduledFor,
      error: l.errorDetalle, motivoCancelacion: l.motivoCancelacion,
    };
    if (l.servicioVideo.momento === 'ANTES') row.antes.push(entry);
    else row.despues.push(entry);
  }
  res.json([...porCita.values()]);
});

// ─── POST /servicio-videos/enviar — envío MANUAL a un paciente (antes/después/ambos) ──
const enviarSchema = z.object({
  citaId: z.string().uuid(),
  momentos: z.array(z.enum(['ANTES', 'DESPUES'])).min(1, 'Indica al menos un momento'),
});
router.post('/enviar', async (req, res) => {
  const { citaId, momentos } = enviarSchema.parse(req.body);
  if (!resendConfigurado()) throw new AppError('RESEND_API_KEY ausente en el servidor — no se puede enviar', 400, 'RESEND_NO_CONFIGURADO');
  try {
    const r = await enviarVideoManual({ citaId, momentos: [...new Set(momentos)], usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
    if (r.enviados.length === 0 && r.errores.length === 0) {
      throw new AppError('No hay videos activos configurados para ese momento en este servicio', 404, 'SIN_VIDEOS');
    }
    res.json({ ok: r.errores.length === 0, ...r });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(err instanceof Error ? err.message : 'No se pudo enviar', 502, 'ENVIO_FALLIDO');
  }
});

// ─── POST /servicio-videos/preview — HTML renderizado del correo (mismo motor) ─
const previewSchema = z.object({
  asunto: z.string().max(120).default(''),
  tituloVideo: z.string().max(100).default(''),
  cuerpoTexto: z.string().max(300).default(''),
  youtubeUrl: z.string().trim().min(1),
});
router.post('/preview', (req, res) => {
  const d = previewSchema.parse(req.body);
  const videoId = extraerYoutubeVideoId(d.youtubeUrl);
  if (!videoId) throw new AppError('URL de YouTube inválida', 400, 'YOUTUBE_URL_INVALIDA');
  const destino = muestraDestinatario();
  const { subject, html } = construirCorreoVideo(
    {
      asunto: d.asunto || 'Un video para tu próxima cita en Limablue',
      tituloVideo: d.tituloVideo || 'Título del video',
      cuerpoTexto: d.cuerpoTexto || 'Aquí va el texto corto del correo.',
      youtubeVideoId: videoId, youtubeUrl: d.youtubeUrl,
    },
    destino,
  );
  // El logo va por CID en el envío real; en la vista previa (iframe) lo incrustamos
  // como data-URI para que se vea el logo real en vez de una imagen rota.
  res.json({ subject, html: inlineLogoParaPreview(html), videoId });
});

// ─── POST /servicio-videos — crear ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  const data = videoSchema.parse(req.body);
  const videoId = extraerYoutubeVideoId(data.youtubeUrl);
  if (!videoId) throw new AppError('URL de YouTube inválida', 400, 'YOUTUBE_URL_INVALIDA');

  const servicio = await prisma.servicio.findFirst({ where: { id: data.servicioId, deletedAt: null }, select: { id: true } });
  if (!servicio) throw new AppError('Servicio no encontrado', 404);

  const creado = await prisma.$transaction(async (tx) => {
    const v = await tx.servicioVideo.create({
      data: {
        servicioId: data.servicioId,
        youtubeVideoId: videoId,
        youtubeUrl: data.youtubeUrl,
        asunto: data.asunto,
        tituloVideo: data.tituloVideo,
        cuerpoTexto: data.cuerpoTexto,
        momento: data.momento,
        offsetValor: data.offsetValor,
        offsetUnidad: data.offsetUnidad,
        orden: data.orden ?? 0,
        createdBy: req.user?.userId,
      },
      select: videoSelect,
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: 'crear_servicio_video',
      entidad: 'servicio_video', entidadId: v.id,
      despues: { servicioId: v.servicioId, youtubeVideoId: v.youtubeVideoId, momento: v.momento, offsetValor: v.offsetValor, offsetUnidad: v.offsetUnidad },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    return v;
  });

  // R3 — backfill a citas futuras (segundo plano, no bloquea la respuesta).
  void backfillVideoNuevo(creado.id);
  res.status(201).json(creado);
});

// ─── PUT /servicio-videos/:id — editar ─────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const data = videoSchema.omit({ servicioId: true }).parse(req.body);
  const videoId = extraerYoutubeVideoId(data.youtubeUrl);
  if (!videoId) throw new AppError('URL de YouTube inválida', 400, 'YOUTUBE_URL_INVALIDA');

  const actual = await prisma.servicioVideo.findFirst({ where: { id: req.params.id, deletedAt: null }, select: videoSelect });
  if (!actual) throw new AppError('Video no encontrado', 404);

  const cambioProgramacion =
    actual.momento !== data.momento ||
    actual.offsetValor !== data.offsetValor ||
    actual.offsetUnidad !== data.offsetUnidad;

  const upd = await prisma.$transaction(async (tx) => {
    const v = await tx.servicioVideo.update({
      where: { id: actual.id },
      data: {
        youtubeVideoId: videoId, youtubeUrl: data.youtubeUrl,
        asunto: data.asunto, tituloVideo: data.tituloVideo, cuerpoTexto: data.cuerpoTexto,
        momento: data.momento, offsetValor: data.offsetValor, offsetUnidad: data.offsetUnidad,
        ...(data.orden !== undefined ? { orden: data.orden } : {}),
      },
      select: videoSelect,
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: 'editar_servicio_video',
      entidad: 'servicio_video', entidadId: actual.id,
      antes: { momento: actual.momento, offsetValor: actual.offsetValor, offsetUnidad: actual.offsetUnidad, youtubeVideoId: actual.youtubeVideoId },
      despues: { momento: v.momento, offsetValor: v.offsetValor, offsetUnidad: v.offsetUnidad, youtubeVideoId: v.youtubeVideoId },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    return v;
  });

  // R4 — si cambió momento/offset, recalcular logs y reprogramar (incl. regla "solo la más reciente").
  if (cambioProgramacion) void reprogramarVideo(actual.id);
  res.json(upd);
});

// ─── PATCH /servicio-videos/:id/toggle — activar/pausar ────────────────────────
router.patch('/:id/toggle', async (req, res) => {
  const actual = await prisma.servicioVideo.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true, activo: true } });
  if (!actual) throw new AppError('Video no encontrado', 404);
  const nuevoActivo = !actual.activo;

  const upd = await prisma.$transaction(async (tx) => {
    const v = await tx.servicioVideo.update({ where: { id: actual.id }, data: { activo: nuevoActivo }, select: videoSelect });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: nuevoActivo ? 'activar_servicio_video' : 'pausar_servicio_video',
      entidad: 'servicio_video', entidadId: actual.id,
      antes: { activo: actual.activo }, despues: { activo: nuevoActivo }, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    return v;
  });

  // Activar → backfill a citas futuras; pausar → cancela los PENDIENTES.
  if (nuevoActivo) void backfillVideoNuevo(actual.id);
  else void cancelarEnviosDeVideo(actual.id, MOTIVO.VIDEO_PAUSADO);
  res.json(upd);
});

// ─── DELETE /servicio-videos/:id — soft delete + cancelar pendientes ───────────
router.delete('/:id', async (req, res) => {
  const actual = await prisma.servicioVideo.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true, tituloVideo: true } });
  if (!actual) throw new AppError('Video no encontrado', 404);

  // Cancela los PENDIENTES ANTES del soft-delete (para poder contarlos y auditar).
  const cancelados = await cancelarEnviosDeVideo(actual.id, MOTIVO.VIDEO_ELIMINADO);

  await prisma.$transaction(async (tx) => {
    await tx.servicioVideo.update({ where: { id: actual.id }, data: { deletedAt: new Date(), activo: false } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: 'eliminar_servicio_video',
      entidad: 'servicio_video', entidadId: actual.id,
      antes: { titulo: actual.tituloVideo }, despues: { deletedAt: new Date().toISOString(), enviosCancelados: cancelados }, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });
  res.json({ ok: true, enviosCancelados: cancelados });
});

// ─── POST /servicio-videos/:id/test-envio — correo de prueba al admin logueado ──
router.post('/:id/test-envio', async (req, res) => {
  const video = await prisma.servicioVideo.findFirst({ where: { id: req.params.id, deletedAt: null }, select: videoSelect });
  if (!video) throw new AppError('Video no encontrado', 404);

  const admin = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { email: true, nombre: true } });
  if (!admin?.email) throw new AppError('Tu usuario no tiene correo registrado', 400, 'ADMIN_SIN_EMAIL');
  if (!resendConfigurado()) throw new AppError('RESEND_API_KEY ausente en el servidor — no se puede enviar la prueba', 400, 'RESEND_NO_CONFIGURADO');

  const { subject, html } = construirCorreoVideo(
    { asunto: video.asunto, tituloVideo: video.tituloVideo, cuerpoTexto: video.cuerpoTexto, youtubeVideoId: video.youtubeVideoId, youtubeUrl: video.youtubeUrl },
    muestraDestinatario(admin.nombre || 'María García'),
  );
  try {
    const enviado = await enviarEmail({ to: admin.email, subject: `[PRUEBA] ${subject}`, html });
    res.json({ ok: true, to: admin.email, id: enviado?.id ?? null });
  } catch (err) {
    throw new AppError(`No se pudo enviar la prueba: ${err instanceof Error ? err.message : 'error'}`, 502, 'ENVIO_FALLIDO');
  }
});

// ─── Lista de exclusión de videos educativos (opt-out) ────────────────────────
// Correos que NO reciben los videos del módulo. NO afecta los correos de confirmación.

// GET /servicio-videos/supresiones — lista de correos excluidos (activos).
router.get('/supresiones', async (_req, res) => {
  const rows = await prisma.videoSupresion.findMany({
    where: { deletedAt: null },
    orderBy: { creadoEn: 'desc' },
    select: { id: true, email: true, motivo: true, creadoEn: true },
  });
  res.json(rows);
});

// POST /servicio-videos/supresiones { email, motivo? } — agregar (y cancelar sus pendientes).
router.post('/supresiones', async (req, res) => {
  const { email, motivo } = z.object({
    email: z.string().trim().email('Correo inválido'),
    motivo: z.string().trim().max(200).optional(),
  }).parse(req.body);
  const emailNorm = email.toLowerCase();

  const existente = await prisma.videoSupresion.findFirst({ where: { email: emailNorm, deletedAt: null }, select: { id: true } });
  if (existente) throw new AppError('Ese correo ya está en la lista de exclusión', 409, 'YA_EXCLUIDO');

  const sup = await prisma.$transaction(async (tx) => {
    const s = await tx.videoSupresion.create({
      data: { email: emailNorm, motivo: motivo ?? null, creadoPor: req.user?.userId },
      select: { id: true, email: true, motivo: true, creadoEn: true },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: 'excluir_correo_videos',
      entidad: 'video_supresion', entidadId: s.id, despues: { email: emailNorm, motivo: motivo ?? null }, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    return s;
  });

  // Cancela los envíos de video PENDIENTES de ese correo (segundo plano, no bloquea).
  const cancelados = await cancelarVideosPorCorreo(emailNorm);
  res.status(201).json({ ...sup, enviosCancelados: cancelados });
});

// DELETE /servicio-videos/supresiones/:id — quitar de la lista (re-habilita futuros videos).
router.delete('/supresiones/:id', async (req, res) => {
  const actual = await prisma.videoSupresion.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true, email: true } });
  if (!actual) throw new AppError('Exclusión no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.videoSupresion.update({ where: { id: actual.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: 'reactivar_correo_videos',
      entidad: 'video_supresion', entidadId: actual.id, antes: { email: actual.email }, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });
  res.json({ ok: true });
});

export default router;
