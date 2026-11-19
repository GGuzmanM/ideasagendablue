/**
 * SERVIDOR MCP PARA ANA (agente de GHL) — POST /api/v1/mcp  (17-nov-2026; lo pidió el equipo del chat, adaptado a esta Agenda).
 *
 * GHL deja solo 5 acciones «Llamada a API» por agente y le pasa a Ana solo los campos mapeados; con un servidor MCP Ana ve todas las
 * herramientas y la respuesta completa. Protocolo MCP «Streamable HTTP» SIN sesión (cada petición es independiente, JSON-RPC 2.0:
 * initialize, tools/list, tools/call).
 *
 * Llave: la misma de las APIs de reservas (`Authorization: ApiKey <llave>`). Como en routes/reservaChat.ts, el CANAL lo fija la llave
 * («reservas:whatsapp» → whatsapp, «reservas:write» → web); lo que mande el cliente se ignora.
 * Cada herramienta llama a las MISMAS funciones que las rutas REST (mismas reglas del 16-nov-2026, ver services/reservaWeb/gestion.ts) y
 * con los mismos límites por llave y por minuto: 240 consultas en total, 30 reservas, 20 búsquedas por documento y 10 cambios
 * (cancelar, reprogramar, nota, extender pago). Lo nuevo: `buscar_cupo` (todas las sedes un día) y los extras de reservaWeb/extrasChat.ts.
 * Los errores salen como resultado con `isError: true` y `{ error, code }` (los mismos códigos de la API REST) para que Ana derive.
 * Las rutas REST siguen funcionando igual. Documentación: docs/API-RESERVAS-WHATSAPP.md (sección 3.10).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { catalogo, horasConCupos, diasDisponibles, reservar, estadoReservaPorCodigo } from '../services/reservaWeb/reservaWebService';
import { camposPaciente, revisarDocumento, normalizarPaciente, normalizarDocumento, TIPOS_DOCUMENTO_RESERVA } from '../services/reservaWeb/validaciones';
import { citasProximas, cancelarCompat, reprogramarCompat, type DocumentoPaciente } from '../services/reservaWeb/gestion';
import { infoSedes, agregarNotaCita, extenderPago } from '../services/reservaWeb/extrasChat';
import { hoyLimaStr, fechaDb, fechaAStr } from '../utils/fechaLima';
import { SCOPE_RESERVAS, SCOPE_RESERVAS_WHATSAPP } from './reservaChat';

const router = Router();

// ─── Llave y canal ────────────────────────────────────────────────────────────
const canalDe = (req: Request): 'web' | 'whatsapp' | null => {
  const s = req.apiKey?.scopes ?? [];
  return s.includes(SCOPE_RESERVAS_WHATSAPP) ? 'whatsapp' : s.includes(SCOPE_RESERVAS) ? 'web' : null;
};
const exigirLlave = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.apiKey) throw new AppError('Esta API se usa con una llave (Authorization: ApiKey …)', 401, 'UNAUTHORIZED');
  if (!canalDe(req)) throw new AppError('La llave no tiene el permiso de reservas', 403, 'FORBIDDEN');
  next();
};
// Límite general por LLAVE (después de reconocerla: antes contaría por IP).
const limiteGeneral = rateLimit({
  windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req: Request) => req.apiKey?.id ?? req.ip ?? 'sin-llave',
  handler: (_req, res) => { res.status(429).json({ error: 'DEMASIADOS_INTENTOS', message: 'Demasiadas consultas. Espera un minuto.', statusCode: 429 }); },
});
router.use(requireAuth, exigirLlave, limiteGeneral);

// Límites cortos por herramienta (las herramientas viajan dentro del cuerpo JSON-RPC: se cuentan aquí, por llave y minuto).
const LIMITES = { reservas: 30, busquedas: 20, cambios: 10 } as const;
type Cubeta = keyof typeof LIMITES;
const usos = new Map<string, number[]>();
export function contarUso(llaveId: string, cubeta: Cubeta, ahora = Date.now()) {
  const clave = `${llaveId}|${cubeta}`;
  const recientes = (usos.get(clave) ?? []).filter((t) => t > ahora - 60_000);
  if (recientes.length >= LIMITES[cubeta]) throw new AppError('Demasiados intentos en un minuto. Espera un momento.', 429, 'DEMASIADOS_INTENTOS');
  recientes.push(ahora);
  usos.set(clave, recientes);
  if (usos.size > 2000) for (const [k, v] of usos) if (!v.some((t) => t > ahora - 60_000)) usos.delete(k);
}
/** Solo para las pruebas. */
export const _reiniciarLimites = () => usos.clear();

// ─── Esquemas ─────────────────────────────────────────────────────────────────
const uuid = z.string().uuid('Debe ser un id (uuid) tomado de consultar_catalogo');
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM, 24 h)');
const numeroDocumento = z.string().trim().min(1, 'Indica el número de documento').max(20).describe('DNI o carné de extranjería del paciente');
const tipoDocumento = z.enum(TIPOS_DOCUMENTO_RESERVA).optional().nullable().describe('DNI o CE (opcional)');
const codigo = z.string().trim().min(1, 'Indica el código de la cita').max(60)
  .describe('Código de la cita tal cual lo da mis_citas: «LB-123456», «C-000123» o el id de la cita');

/** Documento sin tipo (el chat a veces solo tiene el número): 8 a 12 letras o números; con tipo, se valida como siempre. */
function documento(d: { tipoDocumento?: string | null; numeroDocumento: string }): DocumentoPaciente {
  const n = normalizarDocumento(d.numeroDocumento);
  if (d.tipoDocumento) {
    z.object({ tipoDocumento: z.enum(TIPOS_DOCUMENTO_RESERVA), numeroDocumento: z.string() }).superRefine(revisarDocumento)
      .parse({ tipoDocumento: d.tipoDocumento, numeroDocumento: n });
  } else if (!/^[A-Z0-9]{8,12}$/.test(n)) {
    throw new AppError('Documento inválido (8 a 12 letras o números)', 400, 'VALIDATION_ERROR');
  }
  return { tipoDocumento: d.tipoDocumento ?? null, numeroDocumento: n };
}

const reservaShape = {
  ...camposPaciente({ emailObligatorio: false }).shape,
  sedeId: uuid, servicioId: uuid, subcategoriaId: uuid.optional().nullable().describe('Tipo (variante) del servicio, si tiene'),
  fecha, horaInicio: hora,
  aceptaDatos: z.literal(true, { errorMap: () => ({ message: 'El paciente debe aceptar el tratamiento de sus datos personales (aceptaDatos: true)' }) }),
  referencia: z.string().trim().min(6).max(100).optional().nullable().describe('Id único de esta petición: si se reintenta con el mismo, no se crea otra cita'),
};
const reservaSchema = z.object(reservaShape).superRefine(revisarDocumento);

// ─── Resultados ───────────────────────────────────────────────────────────────
type Resultado = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): Resultado => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
export function comoError(e: unknown): Resultado {
  const salida = (o: Record<string, unknown>): Resultado => ({ isError: true, content: [{ type: 'text', text: JSON.stringify(o) }] });
  if (e instanceof z.ZodError) return salida({ error: e.issues.map((i) => `${i.path.join('.') || 'datos'}: ${i.message}`).join('; '), code: 'VALIDATION_ERROR' });
  if (e instanceof AppError) return salida({ error: e.message, code: e.code ?? 'ERROR', status: e.statusCode });
  console.error('[mcp] error inesperado', e);
  return salida({ error: 'Error interno', code: 'INTERNAL' });
}
const envolver = <A>(fn: (a: A) => Promise<unknown>) => async (a: A): Promise<Resultado> => {
  try { return ok(await fn(a)); } catch (e) { return comoError(e); }
};

const sumarDias = (f: string, n: number) => { const d = fechaDb(f); d.setUTCDate(d.getUTCDate() + n); return fechaAStr(d); };
const esErrorDeFecha = (e: unknown) => e instanceof AppError && (e.code ?? '').startsWith('FECHA_');

/**
 * Horarios de un servicio un día en TODAS las sedes que lo ofrecen (la preferida primero). Si ninguna tiene cupo, `diaCercano` =
 * el siguiente día con cupo en 14 días (en cualquier sede). Una sede que no ofrece ese tipo no sale.
 */
export async function buscarCupo(a: { servicioId: string; fecha: string; sedeId?: string | null; subcategoriaId?: string | null }) {
  const cat = await catalogo();
  const sv = cat.servicios.find((s) => s.id === a.servicioId);
  if (!sv) throw new AppError('Ese servicio no se puede reservar en línea', 400, 'SERVICIO_NO_RESERVABLE');
  const nombreSede = new Map(cat.sedes.map((s) => [s.id, s.nombre]));
  const variantes = sv.variantes.filter((v) => (a.subcategoriaId ? v.id === a.subcategoriaId : true));
  if (a.subcategoriaId && !variantes.length) throw new AppError('Ese tipo de servicio no se puede reservar en línea', 400, 'VARIANTE_REQUERIDA');
  const precioEn = (sedeId: string) => {
    const ps = variantes.map((v) => v.precios[sedeId]).filter((p): p is number => p !== undefined);
    return ps.length ? Math.min(...ps) : null;
  };
  const orden = sv.sedes.filter((s) => precioEn(s) !== null)
    .sort((x, y) => (x === a.sedeId ? -1 : y === a.sedeId ? 1 : 0));

  const horasDe = async (sedeId: string, f: string) => {
    try { return await horasConCupos(sedeId, a.servicioId, f); } catch (e) {
      if (esErrorDeFecha(e)) throw e; // fecha pasada o muy lejana: se le dice a Ana
      console.error(`[mcp] buscar_cupo ${sedeId} ${f}:`, (e as Error).message);
      return [];
    }
  };
  const sedes = [];
  for (const sedeId of orden) {
    const hc = await horasDe(sedeId, a.fecha);
    sedes.push({
      sedeId, sede: nombreSede.get(sedeId) ?? sedeId, preferida: sedeId === a.sedeId, precio: precioEn(sedeId),
      horas: hc.map((h) => h.hora), cupos: Object.fromEntries(hc.map((h) => [h.hora, h.cupos])),
    });
  }
  const hayCupo = sedes.some((s) => s.horas.length > 0);

  let diaCercano: { fecha: string; sedeId: string; sede: string; horas: string[] } | null = null;
  if (!hayCupo && orden.length) {
    const hoy = hoyLimaStr();
    const desde = sumarDias(a.fecha > hoy ? a.fecha : hoy, a.fecha >= hoy ? 1 : 0);
    const hasta = sumarDias(desde, 13);
    let mejor: { fecha: string; sedeId: string } | null = null;
    for (const sedeId of orden) {
      const dias = await diasDisponibles(sedeId, a.servicioId, desde, hasta).catch(() => []);
      const d = dias[0];
      if (d && (!mejor || d.fecha < mejor.fecha)) mejor = { fecha: d.fecha, sedeId };
    }
    if (mejor) {
      const hc = await horasDe(mejor.sedeId, mejor.fecha);
      diaCercano = { fecha: mejor.fecha, sedeId: mejor.sedeId, sede: nombreSede.get(mejor.sedeId) ?? mejor.sedeId, horas: hc.map((h) => h.hora) };
    }
  }
  return { fecha: a.fecha, servicio: sv.nombre, hayCupo, sedes, diaCercano };
}

// ─── Servidor (uno por petición: sin sesión) ──────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Argumentos = any;
type RegistrarHerramienta = (nombre: string, config: { description: string; inputSchema: z.ZodRawShape }, cb: (a: Argumentos) => Promise<Resultado>) => unknown;

function crearServidor(req: Request) {
  const canal = canalDe(req)!;
  const llaveId = req.apiKey!.id;
  const meta = { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
  const limite = (c: Cubeta) => contarUso(llaveId, c);
  const servidor = new McpServer({ name: 'limablue-agenda', version: '1.0.0' });
  // Los tipos genéricos de registerTool (SDK + zod) dejan a tsc sin memoria: se registra con una firma simple. El SDK igual valida
  // los argumentos contra `inputSchema` antes de llamar a la herramienta (si no cumplen, responde el error sin llegar aquí).
  const s = { registerTool: servidor.registerTool.bind(servidor) as unknown as RegistrarHerramienta };

  s.registerTool('consultar_catalogo', {
    description: 'Lista las sedes (con dirección) y los servicios que se pueden reservar, con sus tipos (variantes) y el precio en cada sede (`precios`: id de sede → precio). Úsala para conocer los ids de sede, servicio y tipo. No inventes precios: usa estos.',
    inputSchema: {},
  }, envolver(async () => catalogo()));

  s.registerTool('info_sede', {
    description: 'Dirección y horario de atención por día de cada sede. Úsala para «¿dónde queda?» o «¿a qué hora abren?». No inventes datos de ubicación ni horarios.',
    inputSchema: {},
  }, envolver(async () => infoSedes()));

  s.registerTool('dias_disponibles', {
    description: 'Días con horarios libres de un servicio en UNA sede dentro de un rango (máximo 31 días). Para comparar varias sedes usa buscar_cupo.',
    inputSchema: { sedeId: uuid, servicioId: uuid, desde: fecha, hasta: fecha },
  }, envolver(async (a) => ({ dias: await diasDisponibles(a.sedeId, a.servicioId, a.desde, a.hasta) })));

  s.registerTool('horas_del_dia', {
    description: 'Horas libres de un servicio en una sede un día, con `cupos` = cuántos pacientes caben a la vez en cada hora. No ofrezcas la misma hora a más pacientes que sus cupos.',
    inputSchema: { sedeId: uuid, servicioId: uuid, fecha },
  }, envolver(async (a) => {
    const hc = await horasConCupos(a.sedeId, a.servicioId, a.fecha);
    return { fecha: a.fecha, horas: hc.map((h) => h.hora), cupos: Object.fromEntries(hc.map((h) => [h.hora, h.cupos])) };
  }));

  s.registerTool('buscar_cupo', {
    description: 'Busca horarios de un servicio un día en TODAS las sedes que lo ofrecen (la sede preferida primero; una sede sin cupo sale con horas vacías). Úsala cuando el paciente pide un día o una sede y no hay cupo, o para recomendar otra sede. Si ninguna sede tiene cupo ese día, devuelve `diaCercano`: el siguiente día con cupo dentro de 14 días.',
    inputSchema: {
      servicioId: uuid, fecha,
      sedeId: uuid.optional().nullable().describe('Sede que prefiere el paciente'),
      subcategoriaId: uuid.optional().nullable().describe('Tipo de servicio, si aplica (filtra las sedes que lo ofrecen y el precio)'),
    },
  }, envolver(async (a) => buscarCupo(a)));

  s.registerTool('reservar_cita', {
    description: 'Registra al paciente (DNI o CE) y CREA la cita. Úsala solo después de confirmar con el paciente servicio, tipo, sede, fecha, hora y sus datos, y de que haya aceptado el tratamiento de sus datos (aceptaDatos: true). La hora debe salir de horas_del_dia o buscar_cupo. Si la respuesta trae `pago` (sábado o domingo), entrega al paciente el enlace de pago tal cual y avísale que tiene `pago.minutos` minutos para pagar.',
    inputSchema: reservaShape,
  }, envolver(async (raw) => {
    limite('reservas');
    const { aceptaDatos: _a, referencia, sedeId, servicioId, subcategoriaId, fecha: f, horaInicio, ...paciente } = reservaSchema.parse(raw);
    void _a;
    const r = await reservar(
      { ...normalizarPaciente(paciente), sedeId, servicioId, subcategoriaId, fecha: f, horaInicio },
      { canal, conLlave: true, referencia: referencia ?? null, ip: meta.ip, userAgent: meta.userAgent },
    );
    const { token: _t, ...publico } = r;
    void _t;
    return publico;
  }));

  s.registerTool('estado_reserva', {
    description: 'Estado de una reserva hecha por el chat, por su código «LB-123456»: confirmada, esperando_pago (con el enlace y hasta cuándo), cancelada, etc. Trae también la fecha y hora ACTUALES de la cita.',
    inputSchema: { codigo: z.string().trim().min(6).max(40).describe('Código «LB-123456» de la reserva') },
  }, envolver(async (a) => estadoReservaPorCodigo(a.codigo.toUpperCase(), canal)));

  s.registerTool('mis_citas', {
    description: 'Citas próximas del paciente buscando por su documento: TODAS (las del chat y las que registró la clínica). Cada una trae `codigo` (úsalo tal cual en cancelar_cita, reprogramar_cita o agregar_nota_cita) y `puedeCambiar`; si es false, `motivo` dice por qué y debes derivar a un asesor. Sin citas: lista vacía.',
    inputSchema: { numeroDocumento, tipoDocumento },
  }, envolver(async (a) => { limite('busquedas'); return { citas: await citasProximas(documento(a)) }; }));

  s.registerTool('cancelar_cita', {
    description: 'Cancela una cita del paciente. Solo tras su confirmación explícita. Si responde REQUIERE_ASESOR, FUERA_DE_PLAZO, ESPERANDO_PAGO o NO_SE_PUEDE_CANCELAR, deriva a un asesor. Cancelar una ya cancelada responde `repetida: true` (no es error).',
    inputSchema: { codigo, numeroDocumento, tipoDocumento, motivo: z.string().trim().max(300).optional().nullable() },
  }, envolver(async (a) => { limite('cambios'); return cancelarCompat(a.codigo, documento(a), canal, a.motivo || null, meta); }));

  s.registerTool('reprogramar_cita', {
    description: 'Cambia la fecha y hora de una cita del paciente (la MISMA cita se mueve: conserva su código). Antes verifica la hora con horas_del_dia o buscar_cupo (misma sede y servicio) y confirma con el paciente. Sábado y domingo no se reprograman por aquí (REQUIERE_ASESOR). Si responde HORA_NO_DISPONIBLE ofrece otra hora; con REQUIERE_ASESOR, FUERA_DE_PLAZO, ESPERANDO_PAGO, NO_SE_PUEDE_CANCELAR o NO_VIGENTE deriva a un asesor.',
    inputSchema: { codigo, numeroDocumento, tipoDocumento, fecha, horaInicio: hora },
  }, envolver(async (a) => { limite('cambios'); return reprogramarCompat(a.codigo, documento(a), canal, a.fecha, a.horaInicio, meta); }));

  s.registerTool('agregar_nota_cita', {
    description: 'Deja una nota para recepción en la cita del paciente (por ejemplo «llegará 10 minutos tarde» o «va con su hijo»). No sirve para cambiar la hora: para eso reprogramar_cita.',
    inputSchema: { codigo, numeroDocumento, tipoDocumento, texto: z.string().trim().min(3).max(500) },
  }, envolver(async (a) => { limite('cambios'); return agregarNotaCita(a.codigo, documento(a), a.texto, meta); }));

  s.registerTool('extender_pago', {
    description: 'Da 10 minutos más para pagar una reserva de sábado o domingo, UNA sola vez, mientras siga en esperando_pago. Si responde PAGO_VENCIDO hay que reservar de nuevo (revisando que la hora siga libre); YA_EXTENDIDO: ya se usó la extensión.',
    inputSchema: { codigo: z.string().trim().min(6).max(40).describe('Código «LB-123456» de la reserva'), numeroDocumento },
  }, envolver(async (a) => { limite('cambios'); return extenderPago(a.codigo, a.numeroDocumento, canal); }));

  return servidor;
}

router.post('/', async (req: Request, res: Response) => {
  const server = crearServidor(req);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Sin sesión: no hay flujo SSE (GET) ni cierre de sesión (DELETE).
const noPermitido = (_req: Request, res: Response) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método no permitido' }, id: null });
};
router.get('/', noPermitido);
router.delete('/', noPermitido);

export default router;
