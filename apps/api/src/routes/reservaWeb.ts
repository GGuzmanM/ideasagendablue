/**
 * API PÚBLICA de la reserva web (05-oct-2026; sin pasarela de pago desde el 29-oct-2026) — /api/v1/publico/reservas
 * Sin login. Apagada (404) salvo RESERVA_WEB_HABILITADA=1. Solo acepta llamadas del navegador desde los
 * dominios de RESERVA_WEB_ORIGENES (p. ej. https://www.limablue.com). Ver services/reservaWeb/.
 * Es la que usa la página /reserva. El chat de WhatsApp usa otra, con llave: routes/reservaChat.ts.
 *
 *  GET  /catalogo                               sedes, servicios reservables, variantes y precios (se pagan en la sede)
 *  GET  /dias?sedeId&servicioId&desde&hasta      días con horas libres (calendario)
 *  GET  /horas?sedeId&servicioId&fecha           horas libres de un día
 *  POST /intentos                                primer «Continuar»: guarda los datos (seguimiento de quién empezó)
 *  PATCH /intentos/:id   { token, paso, … }      guarda el avance (sede, servicio, fecha, hora)
 *  POST /                                        confirma: registra al paciente y CREA LA CITA (pago pendiente: se paga en la sede)
 *  POST /pago/iniciar                            pago en línea (Niubiz): aparta el horario y devuelve lo que necesita el botón de pago
 *  POST /pago/retorno/:codigo                    a donde vuelve Niubiz con el resultado: cobra, crea la cita y redirige a la página
 *  GET  /:codigo?token=                          estado (al volver con su código)
 */
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { reservaWebHabilitada, catalogo, horasLibres, diasDisponibles, reservar, estadoReserva } from '../services/reservaWeb/reservaWebService';
import { crearIntento, actualizarIntento, PASOS_INTENTO } from '../services/reservaWeb/intentos';
import { niubizHabilitado, modoPago } from '../services/reservaWeb/niubiz';
import { iniciarPago, procesarRetorno } from '../services/reservaWeb/pago';
import { modoVitrina, intentoDemo, avanceDemo, reservaDemo, estadoDemo } from '../services/reservaWeb/vitrina';
import { camposPaciente, revisarDocumento, normalizarPaciente, normalizarCelular, normalizarDocumento, datosPacienteSchema } from '../services/reservaWeb/validaciones';

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
  // Sin caché: lo que la clínica activa o desactiva en Administración › Reserva web debe verse de inmediato.
  res.set('Cache-Control', 'no-cache');
  // `pago`: si la página debe ofrecer el pago en línea (y si es obligatorio u opcional). El chat de WhatsApp no lo usa.
  res.json({ ...(await catalogo()), pago: { habilitado: niubizHabilitado() && !modoVitrina(), modo: modoPago() } });
});

router.get('/dias', limiteConsultas, async (req, res) => {
  const q = z.object({ sedeId: uuid, servicioId: uuid, desde: fecha, hasta: fecha }).parse(req.query);
  res.json({ dias: await diasDisponibles(q.sedeId, q.servicioId, q.desde, q.hasta) });
});

router.get('/horas', limiteConsultas, async (req, res) => {
  const q = z.object({ sedeId: uuid, servicioId: uuid, fecha }).parse(req.query);
  res.json({ fecha: q.fecha, horas: await horasLibres(q.sedeId, q.servicioId, q.fecha) });
});

// En la página el correo es obligatorio (ahí le llega la confirmación). Documento: DNI o CE.
const aceptaDatos = z.literal(true, { errorMap: () => ({ message: 'Debes aceptar el tratamiento de datos personales' }) });
const datosPaciente = datosPacienteSchema({ emailObligatorio: true });
const crearBase = camposPaciente({ emailObligatorio: true }).extend({
  sedeId: uuid, servicioId: uuid, subcategoriaId: uuid.optional().nullable(),
  fecha, horaInicio: hora,
  aceptaDatos,
  captcha: z.string().max(4000).optional(),
  // intento de la página (seguimiento de quién empezó y hasta dónde llegó)
  intentoId: uuid.optional().nullable(),
  intentoToken: z.string().min(10).max(100).optional().nullable(),
});
const crearSchema = crearBase.superRefine(revisarDocumento);
const crearPagoSchema = crearBase.extend({ retornoUrl: z.string().url().max(500) }).superRefine(revisarDocumento);

// ─── Intentos (06-oct-2026): avance del paciente desde el primer «Continuar» ──
const limiteIntentos = limite(60, 15 * 60_000, 'Demasiados intentos desde esta conexión. Espera unos minutos.');
router.post('/intentos', limiteIntentos, async (req, res) => {
  const { captcha, aceptaDatos: _acepta, ...resto } = (req.body ?? {}) as Record<string, unknown>;
  const d = datosPaciente.parse(resto);
  z.object({ aceptaDatos }).parse({ aceptaDatos: _acepta });
  await verificarCaptcha(typeof captcha === 'string' ? captcha : undefined, req.ip);
  if (modoVitrina()) { res.status(201).json(intentoDemo()); return; } // vitrina: no se guarda nada
  res.status(201).json(await crearIntento(d, { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined }));
});

router.patch('/intentos/:id', limiteConsultas, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const c = camposPaciente({ emailObligatorio: true }).partial().extend({
    token: z.string().min(10).max(100),
    paso: z.enum(PASOS_INTENTO).optional(),
    sedeId: uuid.nullable().optional(), servicioId: uuid.nullable().optional(), subcategoriaId: uuid.nullable().optional(),
    fecha: fecha.nullable().optional(), horaInicio: hora.nullable().optional(),
  }).parse(req.body);
  const { token, ...cambios } = c;
  if (cambios.numeroDocumento !== undefined) cambios.numeroDocumento = normalizarDocumento(cambios.numeroDocumento);
  if (cambios.telefono !== undefined) cambios.telefono = normalizarCelular(cambios.telefono) ?? cambios.telefono;
  if (modoVitrina()) { res.json(avanceDemo(id, cambios.paso)); return; }
  res.json(await actualizarIntento(id, token, cambios));
});

router.post('/', limiteReservas, async (req, res) => {
  // Con el pago en línea obligatorio, la reserva web ya no se confirma sin pagar (el chat de WhatsApp tiene su propia API).
  if (niubizHabilitado() && modoPago() === 'obligatorio' && !modoVitrina()) throw new AppError('Esta reserva requiere pagar en línea', 400, 'PAGO_REQUERIDO');
  const { captcha, intentoId, intentoToken, aceptaDatos: _acepta, sedeId, servicioId, subcategoriaId, fecha: f, horaInicio, ...paciente } = crearSchema.parse(req.body);
  void _acepta;
  const p = normalizarPaciente(paciente);
  await verificarCaptcha(captcha, req.ip);
  const datos = { ...p, sedeId, servicioId, subcategoriaId, fecha: f, horaInicio };
  // Vitrina: valida servicio y hora con la disponibilidad real, pero no registra nada.
  if (modoVitrina()) { res.status(201).json(await reservaDemo(datos)); return; }
  res.status(201).json(await reservar(datos, { canal: 'web', ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined, intentoId, intentoToken }));
});


// ─── Pago en línea (Niubiz) ───────────────────────────────────────────────────
const PAGINA_RESERVA = () => process.env.RUTA_RESERVA_WEB || '/agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva/';
/** Dirección pública de la Agenda, para armar la URL de retorno que Niubiz recibe. */
const urlPublica = (req: Request) => (process.env.RESERVA_WEB_URL_PUBLICA || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
/** La página a la que se vuelve debe ser de un origen permitido (nunca una dirección cualquiera: sería una redirección abierta). */
function paginaDeRetorno(url: string, req: Request): string {
  let u: URL;
  try { u = new URL(url); } catch { throw new AppError('Dirección de retorno inválida', 400, 'RETORNO_INVALIDO'); }
  const permitido = origenes().includes(u.origin) || u.origin === urlPublica(req)
    || (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.origin));
  if (!permitido) throw new AppError('Dirección de retorno no permitida', 400, 'RETORNO_INVALIDO');
  return u.origin + u.pathname;
}
const limitePagos = limite(10, 15 * 60_000, 'Demasiados intentos de pago desde esta conexión. Espera unos minutos.');
// El retorno lo dispara Niubiz desde el navegador del paciente una vez por pago (y se puede refrescar): tope más holgado que el de iniciar.
const limiteRetorno = limite(40, 15 * 60_000, 'Demasiadas solicitudes desde esta conexión. Espera unos minutos.');

router.post('/pago/iniciar', limitePagos, async (req, res) => {
  if (!niubizHabilitado() || modoVitrina()) throw new AppError('El pago en línea no está disponible', 404, 'PAGO_NO_DISPONIBLE');
  const { captcha, intentoId, intentoToken, aceptaDatos: _acepta, sedeId, servicioId, subcategoriaId, fecha: f, horaInicio, retornoUrl, ...paciente } = crearPagoSchema.parse(req.body);
  void _acepta;
  const p = normalizarPaciente(paciente);
  await verificarCaptcha(captcha, req.ip);
  res.set('Cache-Control', 'no-store');
  res.status(201).json(await iniciarPago(
    { ...p, sedeId, servicioId, subcategoriaId, fecha: f, horaInicio },
    { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined, intentoId, intentoToken, retornoUrl: paginaDeRetorno(retornoUrl, req), baseUrl: urlPublica(req) },
  ));
});

// Niubiz (el navegador del paciente) hace POST aquí como formulario (transactionToken, channel, customerEmail). Se responde con una
// redirección a la página de la reserva: ahí se ve el resultado. Nunca devuelve JSON ni datos del paciente.
router.post('/pago/retorno/:codigo', limiteRetorno, express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let resultado: Awaited<ReturnType<typeof procesarRetorno>>;
  try {
    const form = (req.body ?? {}) as Record<string, unknown>;
    resultado = await procesarRetorno(String(req.params.codigo), {
      transactionToken: typeof form.transactionToken === 'string' ? form.transactionToken : undefined,
      channel: typeof form.channel === 'string' ? form.channel : undefined,
    }, { ip: req.ip });
  } catch (e) {
    console.error('[pago] error inesperado en el retorno:', (e as Error).message);
    resultado = { destino: 'error' };
  }
  const u = new URL(resultado.retornoUrl || PAGINA_RESERVA(), urlPublica(req));
  u.searchParams.set('pago', resultado.destino);
  if (resultado.codigo) u.searchParams.set('codigo', resultado.codigo);
  if (resultado.token) u.searchParams.set('t', resultado.token);
  if (resultado.motivo) u.searchParams.set('motivo', resultado.motivo.slice(0, 200));
  res.redirect(303, u.toString());
});

router.get('/:codigo', limiteConsultas, async (req, res) => {
  const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.query);
  res.json(modoVitrina() ? await estadoDemo(req.params.codigo, token) : await estadoReserva(req.params.codigo, token));
});

export default router;
