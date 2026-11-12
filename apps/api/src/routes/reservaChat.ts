/**
 * API de RESERVAS PARA EL CHAT DE WHATSAPP (29-oct-2026) — /api/v1/integraciones/reservas
 * Server a server, con llave: `Authorization: ApiKey <llave>` (la llave con permiso «reservas:write» la genera Sistemas
 * con «Llave API del chat.bat»; solo se guarda su huella, no se puede recuperar). Documentación: docs/API-RESERVAS-WHATSAPP.md.
 *
 * Sin pasarela de pago: la cita se crea al confirmar (pago pendiente: se paga en la sede). Solo se ofrecen los servicios
 * marcados «reserva en línea» (los mismos de la página /reserva) y con la misma disponibilidad real de la Agenda.
 *
 *  GET  /catalogo                                  sedes y servicios reservables, con variantes y precios
 *  GET  /dias?sedeId&servicioId&desde&hasta        días con horas libres
 *  GET  /horas?sedeId&servicioId&fecha             horas libres de un día
 *  POST /                                          registra al paciente (DNI o CE) y CREA LA CITA
 *  GET  /:codigo                                   estado de una reserva hecha por el chat
 *  POST /:codigo/cancelar      {motivo?}            cancela la cita de la reserva (11-nov-2026)
 *  POST /:codigo/reprogramar   {fecha, horaInicio}  la mueve a otra hora de GET /horas (misma sede y servicio)
 *  POST /pacientes/citas       {tipoDocumento?, numeroDocumento}             citas próximas del paciente (todas)
 *  POST /citas/:numeroCita/cancelar     {tipoDocumento?, numeroDocumento, motivo?}
 *  POST /citas/:numeroCita/reprogramar  {tipoDocumento?, numeroDocumento, fecha, horaInicio}
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { catalogo, horasLibres, diasDisponibles, reservar, estadoReservaPorCodigo } from '../services/reservaWeb/reservaWebService';
import { camposPaciente, revisarDocumento, normalizarPaciente, normalizarDocumento, TIPOS_DOCUMENTO_RESERVA } from '../services/reservaWeb/validaciones';
import { cancelarReserva, reprogramarReserva, citasProximas, cancelarCitaPaciente, reprogramarCitaPaciente } from '../services/reservaWeb/gestion';

const router = Router();
export const SCOPE_RESERVAS = 'reservas:write';

// Solo llaves con el permiso de reservas (un usuario con sesión de la Agenda no entra por aquí).
function exigirLlaveDeReservas(req: Request, _res: Response, next: NextFunction) {
  if (!req.apiKey) throw new AppError('Esta API se usa con una llave (Authorization: ApiKey …)', 401, 'UNAUTHORIZED');
  if (!req.apiKey.scopes.includes(SCOPE_RESERVAS)) throw new AppError(`La llave no tiene el permiso «${SCOPE_RESERVAS}»`, 403, 'FORBIDDEN');
  next();
}

// Límite por llave (no por IP: el chat sale desde pocos servidores). Consultas amplias; reservas más cortas.
const porLlave = (req: Request) => req.apiKey?.id ?? req.ip ?? 'sin-llave';
const limite = (limit: number, message: string) => rateLimit({
  windowMs: 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: porLlave,
  handler: (_req, res) => { res.status(429).json({ error: 'DEMASIADOS_INTENTOS', message, statusCode: 429 }); },
});
const limiteConsultas = limite(240, 'Demasiadas consultas. Espera un minuto.');
const limiteReservas = limite(30, 'Demasiadas reservas en un minuto. Espera un momento.');

router.use(requireAuth, exigirLlaveDeReservas);

const uuid = z.string().uuid('Debe ser un id (uuid) tomado del catálogo');
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM, 24 h)');

router.get('/catalogo', limiteConsultas, async (_req, res) => {
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

// Correo opcional (en el chat a veces no lo tienen). aceptaDatos: el chat debe haber pedido el consentimiento.
const crearSchema = camposPaciente({ emailObligatorio: false }).extend({
  sedeId: uuid, servicioId: uuid, subcategoriaId: uuid.optional().nullable(),
  fecha, horaInicio: hora,
  aceptaDatos: z.literal(true, { errorMap: () => ({ message: 'El paciente debe aceptar el tratamiento de sus datos personales (aceptaDatos: true)' }) }),
  canal: z.string().regex(/^[a-z0-9_]{2,30}$/, 'Canal inválido').refine((c) => c !== 'web', 'El canal «web» es de la página').default('whatsapp'),
  referencia: z.string().trim().min(6).max(100).optional().nullable(),
}).superRefine(revisarDocumento);

router.post('/', limiteReservas, async (req, res) => {
  const { aceptaDatos: _acepta, canal, referencia, sedeId, servicioId, subcategoriaId, fecha: f, horaInicio, ...paciente } = crearSchema.parse(req.body);
  void _acepta;
  const refHeader = req.header('Idempotency-Key')?.trim();
  const r = await reservar(
    { ...normalizarPaciente(paciente), sedeId, servicioId, subcategoriaId, fecha: f, horaInicio },
    { canal, referencia: referencia ?? (refHeader && refHeader.length >= 6 ? refHeader.slice(0, 100) : null), ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
  );
  const { token: _token, ...publico } = r;
  res.status(r.repetida ? 200 : 201).json(publico);
});

const zCanal = z.string().regex(/^[a-z0-9_]{2,30}$/, 'Canal inválido').default('whatsapp');
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });

// Citas del PACIENTE por su documento (11-nov-2026): todas sus citas próximas, también las de recepción, para cancelar o
// reprogramar por N.º de cita. POST (no GET) para que el documento no quede en la URL ni en los registros de acceso.
const zDocumento = z.object({
  tipoDocumento: z.enum(TIPOS_DOCUMENTO_RESERVA).default('DNI'),
  numeroDocumento: z.string().trim().min(1, 'Indica el número de documento').max(20),
}).superRefine((d, ctx) => revisarDocumento({ tipoDocumento: d.tipoDocumento, numeroDocumento: normalizarDocumento(d.numeroDocumento) }, ctx));

router.post('/pacientes/citas', limiteConsultas, async (req, res) => {
  res.json({ citas: await citasProximas(zDocumento.parse(req.body ?? {})) });
});

router.post('/citas/:numeroCita/cancelar', limiteReservas, async (req, res) => {
  const b = zDocumento.and(z.object({ motivo: z.string().trim().max(300).optional().nullable(), canal: zCanal })).parse(req.body ?? {});
  res.json(await cancelarCitaPaciente(String(req.params.numeroCita), b, b.canal, b.motivo || null, meta(req)));
});

router.post('/citas/:numeroCita/reprogramar', limiteReservas, async (req, res) => {
  const b = zDocumento.and(z.object({ fecha, horaInicio: hora, canal: zCanal })).parse(req.body ?? {});
  res.json(await reprogramarCitaPaciente(String(req.params.numeroCita), b, b.canal, b.fecha, b.horaInicio, meta(req)));
});

router.get('/:codigo', limiteConsultas, async (req, res) => {
  const canal = zCanal.parse(req.query.canal ?? undefined);
  res.json(await estadoReservaPorCodigo(String(req.params.codigo), canal));
});

// Cancelar y reprogramar (11-nov-2026). Las reglas de negocio (anticipación, cuántas veces…) las pone el chat; ver services/reservaWeb/gestion.ts.
const canalDe = (req: Request) => zCanal.parse(req.body?.canal ?? req.query.canal ?? undefined);

router.post('/:codigo/cancelar', limiteReservas, async (req, res) => {
  const { motivo } = z.object({ motivo: z.string().trim().max(300).optional().nullable() }).parse(req.body ?? {});
  res.json(await cancelarReserva(String(req.params.codigo), canalDe(req), motivo || null, meta(req)));
});

router.post('/:codigo/reprogramar', limiteReservas, async (req, res) => {
  const { fecha: f, horaInicio } = z.object({ fecha, horaInicio: hora }).parse(req.body ?? {});
  res.json(await reprogramarReserva(String(req.params.codigo), canalDe(req), f, horaInicio, meta(req)));
});

export default router;
