/**
 * API PÚBLICA de la reserva web (05-oct-2026) — /api/v1/publico/reservas
 * Sin login. Apagada (404) salvo RESERVA_WEB_HABILITADA=1. Solo acepta llamadas del navegador desde los
 * dominios de RESERVA_WEB_ORIGENES (p. ej. https://www.limablue.com). Ver services/reservaWeb/.
 *
 *  GET  /catalogo                               sedes, servicios reservables, variantes y precios
 *  GET  /dias?sedeId&servicioId&desde&hasta      días con horas libres (calendario)
 *  GET  /horas?sedeId&servicioId&fecha           horas libres de un día
 *  POST /intentos                                primer «Continuar»: guarda los datos y arranca los 10 min
 *  PATCH /intentos/:id   { token, paso, … }      guarda el avance (sede, servicio, fecha, hora)
 *  POST /                                        crea la reserva y aparta el horario
 *  POST /:codigo/pago      { token }             inicia el pago en la pasarela
 *  GET  /:codigo?token=                          estado (página de «gracias»)
 *  POST /pagos/webhook/:pasarela                 aviso de pago de la pasarela → crea la cita
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import {
  reservaWebHabilitada, catalogo, horasLibres, diasDisponibles, crearReserva, iniciarPago, estadoReserva, procesarAvisoPago,
} from '../services/reservaWeb/reservaWebService';
import { pasarelaPorNombre } from '../services/reservaWeb/pasarelas';
import { crearIntento, actualizarIntento, PASOS_INTENTO } from '../services/reservaWeb/intentos';

const router = Router();

// Apagada por defecto: 404 como si no existiera.
router.use((_req: Request, _res: Response, next: NextFunction) => {
  if (!reservaWebHabilitada()) return next(new AppError('No encontrado', 404, 'NOT_FOUND'));
  next();
});

// CORS propio: el sitio público de la clínica (el CORS global es solo para la Agenda).
const origenes = () => (process.env.RESERVA_WEB_ORIGENES || '').split(',').map((s) => s.trim()).filter(Boolean);
router.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (origenes().includes(origin)) return cb(null, true);
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PATCH'],
}));

const limite = (limit: number, windowMs: number, message: string) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: 'DEMASIADOS_INTENTOS', message, statusCode: 429 }); },
});
const limiteConsultas = limite(120, 60_000, 'Demasiadas consultas. Espera un minuto.');
const limiteReservas = limite(10, 15 * 60_000, 'Demasiados intentos de reserva desde esta conexión. Espera unos minutos.');

const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida');

/** Verificación anti robots (Cloudflare Turnstile). Si TURNSTILE_SECRET no está configurado, no se exige. */
async function verificarCaptcha(token: string | undefined, ip?: string) {
  const secreto = process.env.TURNSTILE_SECRET;
  if (!secreto) return;
  if (!token) throw new AppError('Confirma que no eres un robot', 400, 'CAPTCHA_REQUERIDO');
  const form = new URLSearchParams({ secret: secreto, response: token, ...(ip ? { remoteip: ip } : {}) });
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({})) as { success?: boolean };
  if (!j.success) throw new AppError('No pudimos verificar que no eres un robot. Intenta de nuevo.', 400, 'CAPTCHA_INVALIDO');
}

router.get('/catalogo', limiteConsultas, async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await catalogo());
});

router.get('/dias', limiteConsultas, async (req, res) => {
  const q = z.object({ sedeId: uuid, servicioId: uuid, desde: fecha, hasta: fecha }).parse(req.query);
  res.json({ dias: await diasDisponibles(q.sedeId, q.servicioId, q.desde, q.hasta) });
});

router.get('/horas', limiteConsultas, async (req, res) => {
  const q = z.object({ sedeId: uuid, servicioId: uuid, fecha }).parse(req.query);
  res.json({ fecha: q.fecha, horas: await horasLibres(q.sedeId, q.servicioId, q.fecha) });
});

const datosPacienteSchema = z.object({
  numeroDocumento: z.string().regex(/^\d{8}$/, 'El DNI tiene 8 dígitos'),
  nombres: z.string().trim().min(2).max(80),
  apellidoPaterno: z.string().trim().min(2).max(60),
  apellidoMaterno: z.string().trim().max(60).optional().nullable(),
  telefono: z.string().regex(/^9\d{8}$/, 'Celular de 9 dígitos'),
  email: z.string().trim().email('Correo inválido').max(120),
});
const aceptaDatos = z.literal(true, { errorMap: () => ({ message: 'Debes aceptar el tratamiento de datos personales' }) });
const crearSchema = datosPacienteSchema.extend({
  sedeId: uuid, servicioId: uuid, subcategoriaId: uuid.optional().nullable(),
  fecha, horaInicio: hora,
  aceptaDatos,
  captcha: z.string().max(4000).optional(),
  // 06-oct-2026: intento de la página (el apartado vence cuando vence el intento)
  intentoId: uuid.optional().nullable(),
  intentoToken: z.string().min(10).max(100).optional().nullable(),
});

// ─── Intentos (06-oct-2026): avance del paciente desde el primer «Continuar» ──
const limiteIntentos = limite(60, 15 * 60_000, 'Demasiados intentos desde esta conexión. Espera unos minutos.');
router.post('/intentos', limiteIntentos, async (req, res) => {
  const d = datosPacienteSchema.extend({ aceptaDatos, captcha: z.string().max(4000).optional() }).parse(req.body);
  await verificarCaptcha(d.captcha, req.ip);
  res.status(201).json(await crearIntento(d, { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined }));
});

router.patch('/intentos/:id', limiteConsultas, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const c = datosPacienteSchema.partial().extend({
    token: z.string().min(10).max(100),
    paso: z.enum(PASOS_INTENTO).optional(),
    sedeId: uuid.nullable().optional(), servicioId: uuid.nullable().optional(), subcategoriaId: uuid.nullable().optional(),
    fecha: fecha.nullable().optional(), horaInicio: hora.nullable().optional(),
  }).parse(req.body);
  const { token, ...cambios } = c;
  res.json(await actualizarIntento(id, token, cambios));
});

router.post('/', limiteReservas, async (req, res) => {
  const d = crearSchema.parse(req.body);
  await verificarCaptcha(d.captcha, req.ip);
  const r = await crearReserva(d, { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
  res.status(201).json({
    codigo: r.codigo, token: r.tokenConsulta, estado: r.estado, monto: Number(r.monto), moneda: r.moneda,
    fecha: d.fecha, horaInicio: r.horaInicio, expiraEn: r.expiraEn,
  });
});

router.post('/:codigo/pago', limiteReservas, async (req, res) => {
  const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.body);
  res.json(await iniciarPago(req.params.codigo, token));
});

// Avisos de la pasarela: sin CORS de navegador (servidor a servidor); la firma la valida cada pasarela.
router.post('/pagos/webhook/:pasarela', async (req, res) => {
  const p = pasarelaPorNombre(req.params.pasarela);
  if (!p) throw new AppError('Pasarela desconocida', 404, 'NOT_FOUND');
  const aviso = await p.leerAviso(req);
  if (!aviso) { res.json({ ok: true, ignorado: true }); return; }
  res.json(await procesarAvisoPago(aviso, p.nombre));
});

router.get('/:codigo', limiteConsultas, async (req, res) => {
  const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.query);
  res.json(await estadoReserva(req.params.codigo, token));
});

export default router;
