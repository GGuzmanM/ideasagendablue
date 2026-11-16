/**
 * APIs de RESERVAS PARA INTEGRACIONES (server a server, con llave: `Authorization: ApiKey <llave>`). Desde el 12-nov-2026 son DOS,
 * iguales en rutas y respuestas pero con llave y canal propios (crearApiReservas):
 *   - WEB       /api/v1/integraciones/reservas   llave con permiso «reservas:write» (la que ya existía)  → canal «web»
 *   - WHATSAPP  /api/v1/integraciones/whatsapp   llave con permiso «reservas:whatsapp»                  → canal «whatsapp»
 * Las llaves las genera Sistemas con «Llaves API (web y WhatsApp).bat»; solo se guarda su huella, no se pueden recuperar.
 * El canal lo fija la LLAVE (lo que mande el cliente en `canal` se ignora): por código LB cada API solo ve y cambia las reservas
 * de su canal; las rutas por DOCUMENTO muestran todas las citas próximas del paciente en ambas. Documentación: docs/API-RESERVAS-WHATSAPP.md.
 *
 * Sin pasarela de pago: la cita se crea al confirmar (pago pendiente: se paga en la sede). Excepción (13-nov-2026): por WHATSAPP, los
 * sábados y domingos se pagan antes por la tienda en línea si está conectada (estado «esperando_pago» + enlace; services/reservaWeb/pagoPrevio.ts). Solo se ofrecen los servicios
 * marcados «reserva en línea» (los mismos de la página /reserva) y con la misma disponibilidad real de la Agenda.
 *
 *  GET  /catalogo                                  sedes y servicios reservables, con variantes y precios
 *  GET  /dias?sedeId&servicioId&desde&hasta        días con horas libres
 *  GET  /horas?sedeId&servicioId&fecha             horas libres de un día y cupos (cuántos pacientes caben en cada hora)
 *  POST /                                          registra al paciente (DNI o CE) y CREA LA CITA
 *  GET  /:codigo                                   estado de una reserva hecha por este canal
 *  POST /:codigo/cancelar      {motivo?}            cancela la cita de la reserva (11-nov-2026)
 *  POST /:codigo/reprogramar   {fecha, horaInicio}  la mueve a otra hora de GET /horas (misma sede y servicio)
 *  POST /pacientes/citas       {tipoDocumento?, numeroDocumento}             citas próximas del paciente (todas)
 *  POST /citas/:numeroCita/cancelar     {tipoDocumento?, numeroDocumento, motivo?}
 *  POST /citas/:numeroCita/reprogramar  {tipoDocumento?, numeroDocumento, fecha, horaInicio}
 * Contrato de la nota de Ana (14-nov-2026), sobre lo mismo:
 *  GET  /citas-paciente?numeroDocumento=          = POST /pacientes/citas (cada cita trae `codigo`, `puedeCambiar` y `motivo`)
 *  POST /:codigo/cancelar|reprogramar con { numeroDocumento, … }: `codigo` = «LB-…», id de la cita o «C-…» (cualquier cita del paciente)
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { catalogo, horasConCupos, diasDisponibles, reservar, estadoReservaPorCodigo } from '../services/reservaWeb/reservaWebService';
import { camposPaciente, revisarDocumento, normalizarPaciente, normalizarDocumento, TIPOS_DOCUMENTO_RESERVA } from '../services/reservaWeb/validaciones';
import { cancelarReserva, reprogramarReserva, citasProximas, cancelarCitaPaciente, reprogramarCitaPaciente, cancelarCompat, reprogramarCompat } from '../services/reservaWeb/gestion';

/** Permiso de la llave de la API WEB (es el de la llave que existía antes de separar las APIs). */
export const SCOPE_RESERVAS = 'reservas:write';
/** Permiso de la llave de la API de WHATSAPP. */
export const SCOPE_RESERVAS_WHATSAPP = 'reservas:whatsapp';

const uuid = z.string().uuid('Debe ser un id (uuid) tomado del catálogo');
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM, 24 h)');

// Correo opcional (en el chat a veces no lo tienen). aceptaDatos: el cliente debe haber pedido el consentimiento.
const crearSchema = camposPaciente({ emailObligatorio: false }).extend({
  sedeId: uuid, servicioId: uuid, subcategoriaId: uuid.optional().nullable(),
  fecha, horaInicio: hora,
  aceptaDatos: z.literal(true, { errorMap: () => ({ message: 'El paciente debe aceptar el tratamiento de sus datos personales (aceptaDatos: true)' }) }),
  referencia: z.string().trim().min(6).max(100).optional().nullable(),
}).superRefine(revisarDocumento);

// Citas del PACIENTE por su documento (11-nov-2026): todas sus citas próximas, también las de recepción, para cancelar o
// reprogramar por N.º de cita. POST (no GET) para que el documento no quede en la URL ni en los registros de acceso.
const zDocumento = z.object({
  tipoDocumento: z.enum(TIPOS_DOCUMENTO_RESERVA).default('DNI'),
  numeroDocumento: z.string().trim().min(1, 'Indica el número de documento').max(20),
}).superRefine((d, ctx) => revisarDocumento({ tipoDocumento: d.tipoDocumento, numeroDocumento: normalizarDocumento(d.numeroDocumento) }, ctx));

// Contrato de la NOTA DE ANA (14-nov-2026): el documento llega SIN tipo (solo el número) en GET /citas-paciente y en el cuerpo de
// /:codigo/cancelar|reprogramar. Sin tipo, vale cualquier documento de 8 a 12 letras o números; con tipo, se valida como siempre.
const zDocumentoLibre = z.object({
  tipoDocumento: z.enum(TIPOS_DOCUMENTO_RESERVA).optional().nullable(),
  numeroDocumento: z.string().trim().min(1, 'Indica el número de documento').max(20),
}).superRefine((d, ctx) => {
  const n = normalizarDocumento(d.numeroDocumento);
  if (d.tipoDocumento) revisarDocumento({ tipoDocumento: d.tipoDocumento, numeroDocumento: n }, ctx);
  else if (!/^[A-Z0-9]{8,12}$/.test(n)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numeroDocumento'], message: 'Documento inválido (8 a 12 letras o números)' });
});
/** Del cuerpo de /:codigo/cancelar|reprogramar: el documento si vino (contrato de Ana), o null (camino por código LB del canal). */
const documentoOpcional = (body: unknown) => {
  const b = (body ?? {}) as { numeroDocumento?: unknown };
  return b.numeroDocumento == null || b.numeroDocumento === '' ? null : zDocumentoLibre.parse(body);
};

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });

export function crearApiReservas(o: { scope: string; canal: 'web' | 'whatsapp' }): Router {
  const router = Router();
  const { canal } = o;

  // Solo llaves con el permiso de ESTA API (un usuario con sesión de la Agenda, o la llave de la otra API, no entra por aquí).
  const exigirLlave = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.apiKey) throw new AppError('Esta API se usa con una llave (Authorization: ApiKey …)', 401, 'UNAUTHORIZED');
    if (!req.apiKey.scopes.includes(o.scope)) throw new AppError(`La llave no tiene el permiso «${o.scope}»`, 403, 'FORBIDDEN');
    next();
  };

  // Límite por llave (no por IP: el cliente sale desde pocos servidores). Consultas amplias; reservas más cortas.
  // Cada API tiene sus propios contadores.
  const porLlave = (req: Request) => req.apiKey?.id ?? req.ip ?? 'sin-llave';
  const limite = (limit: number, message: string) => rateLimit({
    windowMs: 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: porLlave,
    handler: (_req, res) => { res.status(429).json({ error: 'DEMASIADOS_INTENTOS', message, statusCode: 429 }); },
  });
  const limiteConsultas = limite(240, 'Demasiadas consultas. Espera un minuto.');
  const limiteReservas = limite(30, 'Demasiadas reservas en un minuto. Espera un momento.');

  router.use(requireAuth, exigirLlave);

  router.get('/catalogo', limiteConsultas, async (_req, res) => {
    res.json(await catalogo());
  });

  router.get('/dias', limiteConsultas, async (req, res) => {
    const q = z.object({ sedeId: uuid, servicioId: uuid, desde: fecha, hasta: fecha }).parse(req.query);
    res.json({ dias: await diasDisponibles(q.sedeId, q.servicioId, q.desde, q.hasta) });
  });

  router.get('/horas', limiteConsultas, async (req, res) => {
    const q = z.object({ sedeId: uuid, servicioId: uuid, fecha }).parse(req.query);
    const hc = await horasConCupos(q.sedeId, q.servicioId, q.fecha);
    // horas como siempre; cupos (13-nov-2026) = cuántos pacientes caben a la vez en cada hora (no ofrecer una hora a más personas).
    res.json({ fecha: q.fecha, horas: hc.map((h) => h.hora), cupos: Object.fromEntries(hc.map((h) => [h.hora, h.cupos])) });
  });

  router.post('/', limiteReservas, async (req, res) => {
    const { aceptaDatos: _acepta, referencia, sedeId, servicioId, subcategoriaId, fecha: f, horaInicio, ...paciente } = crearSchema.parse(req.body);
    void _acepta;
    const refHeader = req.header('Idempotency-Key')?.trim();
    const r = await reservar(
      { ...normalizarPaciente(paciente), sedeId, servicioId, subcategoriaId, fecha: f, horaInicio },
      { canal, conLlave: true, referencia: referencia ?? (refHeader && refHeader.length >= 6 ? refHeader.slice(0, 100) : null), ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
    const { token: _token, ...publico } = r;
    res.status(r.repetida ? 200 : 201).json(publico);
  });

  router.post('/pacientes/citas', limiteConsultas, async (req, res) => {
    res.json({ citas: await citasProximas(zDocumento.parse(req.body ?? {})) });
  });

  router.post('/citas/:numeroCita/cancelar', limiteReservas, async (req, res) => {
    const b = zDocumento.and(z.object({ motivo: z.string().trim().max(300).optional().nullable() })).parse(req.body ?? {});
    res.json(await cancelarCitaPaciente(String(req.params.numeroCita), b, canal, b.motivo || null, meta(req)));
  });

  router.post('/citas/:numeroCita/reprogramar', limiteReservas, async (req, res) => {
    const b = zDocumento.and(z.object({ fecha, horaInicio: hora })).parse(req.body ?? {});
    res.json(await reprogramarCitaPaciente(String(req.params.numeroCita), b, canal, b.fecha, b.horaInicio, meta(req)));
  });

  // Contrato de la nota de Ana (14-nov-2026): lo mismo que POST /pacientes/citas, con el documento en la URL (va ANTES de /:codigo).
  router.get('/citas-paciente', limiteConsultas, async (req, res) => {
    res.json({ citas: await citasProximas(zDocumentoLibre.parse(req.query)) });
  });

  router.get('/:codigo', limiteConsultas, async (req, res) => {
    res.json(await estadoReservaPorCodigo(String(req.params.codigo), canal));
  });

  // Cancelar y reprogramar (11-nov-2026). Las reglas de negocio (anticipación, cuántas veces…) las pone el cliente; ver services/reservaWeb/gestion.ts.
  // Sin documento: `codigo` = «LB-…» de una reserva de ESTE canal. Con `numeroDocumento` (contrato de la nota de Ana, 14-nov-2026):
  // `codigo` = «LB-…», id de la cita o «C-…», de cualquier cita del dueño de ese documento; reprogramar responde 201.
  router.post('/:codigo/cancelar', limiteReservas, async (req, res) => {
    const { motivo } = z.object({ motivo: z.string().trim().max(300).optional().nullable() }).parse(req.body ?? {});
    const doc = documentoOpcional(req.body);
    const codigo = String(req.params.codigo);
    if (doc) { res.json(await cancelarCompat(codigo, doc, canal, motivo || null, meta(req))); return; }
    const r = await cancelarReserva(codigo, canal, motivo || null, meta(req));
    res.json({ ...r, repetida: r.sinCambios });
  });

  router.post('/:codigo/reprogramar', limiteReservas, async (req, res) => {
    const { fecha: f, horaInicio } = z.object({ fecha, horaInicio: hora }).parse(req.body ?? {});
    const doc = documentoOpcional(req.body);
    const codigo = String(req.params.codigo);
    if (doc) { res.status(201).json(await reprogramarCompat(codigo, doc, canal, f, horaInicio, meta(req))); return; }
    const r = await reprogramarReserva(codigo, canal, f, horaInicio, meta(req));
    res.json({ ...r, repetida: r.sinCambios, codigoAnterior: codigo });
  });

  return router;
}
