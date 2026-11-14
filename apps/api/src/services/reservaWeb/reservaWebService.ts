/**
 * RESERVA WEB (05-oct-2026; sin pasarela de pago desde el 29-oct-2026): reserva de citas desde la página pública
 * (/reserva) y desde el chat de WhatsApp (API con llave, routes/reservaChat.ts).
 *
 * Flujo: catálogo → días/horas libres → confirmar: se registra al paciente (si no existe) y se CREA LA CITA en la
 * Agenda en ese momento (canal «web» o «whatsapp», pago pendiente: paga en la sede) con el MISMO endpoint que usa
 * recepción (POST /citas), así hereda todas sus reglas (anti doble reserva, almuerzos, permisos, correo de reserva,
 * tiempo real, auditoría). Cobro en línea solo en dos casos: Niubiz en la página (pago.ts, apagado por defecto) y el pago previo de
 * sábado y domingo del chat de WhatsApp por la tienda WooCommerce (woocommerce.ts + pagoPrevio.ts, apagado sin WOO_* en agenda.env).
 *
 * Disponibilidad: la de siempre (calcularDisponibilidad) desglosada por profesional. Nunca se exponen nombres de
 * profesionales ni datos de otros pacientes. La página pública queda inerte salvo RESERVA_WEB_HABILITADA=1.
 */
import crypto from 'crypto';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { calcularDisponibilidad } from '../disponibilidad';
import { fechaDb, fechaAStr, hoyLimaStr, LIMA_OFFSET_H } from '../../utils/fechaLima';
import { registrarAudit } from '../audit';
import { timeToMinutes, formatoNumeroCita } from '@limablue/shared';
import { intentoConToken, enlazarReserva } from './intentos';
import type { TipoDocumentoReserva } from './validaciones';
import { precioWebEnSede, aNumero } from './precios';
import { sedesQueOfrecen, claveOculta } from './visibilidad';
import { MINUTOS_PAGO, requierePagoPrevio, crearPedidoWoo, cancelarPedidoWoo, type PedidoWoo } from './woocommerce';

/** `pasarela` de las reservas con pago previo por WooCommerce (sábado y domingo, chat de WhatsApp; ver pagoPrevio.ts). */
export const PASARELA_WOO = 'woocommerce';

const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);
const DIAS_MAX = () => num(process.env.RESERVA_WEB_DIAS_MAX, 30);
const ANTICIPACION_MIN = () => num(process.env.RESERVA_WEB_ANTICIPACION_MIN, 120); // reservar hoy: al menos 2 h antes

export function reservaWebHabilitada(): boolean {
  const v = (process.env.RESERVA_WEB_HABILITADA || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

function sumarDias(fecha: string, dias: number): string {
  const d = fechaDb(fecha); d.setUTCDate(d.getUTCDate() + dias); return fechaAStr(d);
}
export function minutosAhoraLima(ref: Date = new Date()): number {
  return ((ref.getUTCHours() - LIMA_OFFSET_H + 24) % 24) * 60 + ref.getUTCMinutes();
}

// ─── Catálogo ─────────────────────────────────────────────────────────────────
/**
 * `precio` es el precio web GENERAL (el que rige en las sedes sin precio propio; si no hay ninguno, el menor de las sedes).
 * `precios` es el precio en CADA sede donde ese tipo se puede reservar: el que se cobra en una sede es `precios[sedeId]`.
 * Una sede que no aparece en `precios` no ofrece ese tipo.
 */
export interface VarianteWeb { id: string | null; nombre: string; precio: number; precios: Record<string, number> }
export interface ServicioWeb { id: string; nombre: string; duracionMinutos: number; unidad: string; sedes: string[]; variantes: VarianteWeb[] }

export async function catalogo() {
  const [sedes, sedeUnidades, servicios, preciosServicio, preciosTipo, ocultas] = await Promise.all([
    prisma.sede.findMany({ where: { activa: true, deletedAt: null, reservaWeb: true }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], select: { id: true, nombre: true, direccion: true, horario: true, reservaWeb: true } }),
    prisma.sedeUnidadNegocio.findMany({ select: { sedeId: true, unidadNegocioId: true } }),
    prisma.servicio.findMany({
      where: { reservaOnline: true, activo: true, deletedAt: null, unidadNegocio: { activa: true, deletedAt: null, modoReserva: { not: 'preferencia_obligatoria' } } },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      include: {
        unidadNegocio: { select: { id: true, nombre: true } },
        subcategorias: { where: { activo: true, deletedAt: null, reservaOnline: true }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] },
      },
    }),
    prisma.servicioPrecioWebSede.findMany(),
    prisma.subcategoriaPrecioWebSede.findMany(),
    prisma.servicioSedeWebOculto.findMany({ select: { servicioId: true, sedeId: true } }),
  ]);
  const sedesActivas = new Set(sedes.map((s) => s.id));
  const ocultasSet = new Set(ocultas.map((o) => claveOculta(o.servicioId, o.sedeId)));
  const delServicio = new Map(preciosServicio.map((p) => [`${p.servicioId}|${p.sedeId}`, Number(p.precio)]));
  const delTipo = new Map(preciosTipo.map((p) => [`${p.subcategoriaId}|${p.sedeId}`, Number(p.precio)]));
  const out: ServicioWeb[] = [];
  for (const s of servicios) {
    // Solo sedes visibles en la web (el findMany de arriba ya las filtra) donde el servicio no esté oculto.
    const delArea = sedeUnidades.filter((x) => x.unidadNegocioId === s.unidadNegocio.id && sedesActivas.has(x.sedeId)).map((x) => ({ id: x.sedeId, reservaWeb: true }));
    const ocultasDelServicio = new Set(delArea.filter((x) => ocultasSet.has(claveOculta(s.id, x.id))).map((x) => x.id));
    const sedesDelArea = sedesQueOfrecen(delArea, ocultasDelServicio);
    const armar = (id: string | null, nombre: string, tipo: { web: number | null; referencial: number | null } | null): VarianteWeb | null => {
      const calcular = (sedeId: string | null) => precioWebEnSede(
        { servicioWeb: aNumero(s.precioOnline), servicioReferencial: aNumero(s.precioReferencial), servicioSede: sedeId ? delServicio.get(`${s.id}|${sedeId}`) ?? null : null },
        tipo ? { tipoWeb: tipo.web, tipoReferencial: tipo.referencial, tipoSede: sedeId && id ? delTipo.get(`${id}|${sedeId}`) ?? null : null } : null,
      );
      const precios: Record<string, number> = {};
      for (const sedeId of sedesDelArea) { const p = calcular(sedeId); if (p != null) precios[sedeId] = p; }
      const lista = Object.values(precios);
      if (!lista.length) return null; // sin precio en ninguna sede no se muestra (el paciente debe saber cuánto pagará en la sede)
      return { id, nombre, precio: calcular(null) ?? Math.min(...lista), precios };
    };
    const variantes = (s.subcategorias.length
      ? s.subcategorias.map((v) => armar(v.id, v.nombre, { web: aNumero(v.precioOnline), referencial: aNumero(v.precioReferencial) }))
      : [armar(null, s.nombre, null)]
    ).filter((v): v is VarianteWeb => v !== null);
    if (!variantes.length) continue;
    out.push({
      id: s.id, nombre: s.nombre, duracionMinutos: s.duracionMinutos, unidad: s.unidadNegocio.nombre,
      sedes: sedesDelArea.filter((sedeId) => variantes.some((v) => v.precios[sedeId] !== undefined)),
      variantes,
    });
  }
  return {
    sedes: sedes.map((s) => ({ id: s.id, nombre: s.nombre, direccion: s.direccion, horario: s.horario })),
    servicios: out.filter((s) => s.sedes.length > 0),
    reglas: { diasMaximos: DIAS_MAX(), anticipacionMinutosHoy: ANTICIPACION_MIN() },
  };
}

/** Servicio + variante reservables en esa sede, con el precio de ESA sede (el que se pagará allí). */
export async function servicioReservable(sedeId: string, servicioId: string, subcategoriaId?: string | null) {
  const cat = await catalogo();
  const sv = cat.servicios.find((s) => s.id === servicioId);
  if (!sv || !sv.sedes.includes(sedeId)) throw new AppError('Ese servicio no se puede reservar en línea en esta sede', 400, 'SERVICIO_NO_RESERVABLE');
  const enSede = sv.variantes.filter((v) => v.precios[sedeId] !== undefined);
  const variante = enSede.length === 1 && enSede[0]!.id === null
    ? enSede[0]!
    : enSede.find((v) => v.id === (subcategoriaId ?? null));
  if (!variante) throw new AppError(subcategoriaId ? 'Ese tipo de servicio no se puede reservar en línea en esta sede' : 'Elige el tipo de servicio', 400, 'VARIANTE_REQUERIDA');
  const servicio = await prisma.servicio.findUniqueOrThrow({ where: { id: servicioId }, select: { unidadNegocioId: true, duracionMinutos: true, nombre: true } });
  return { servicio, variante, monto: variante.precios[sedeId]! };
}

// ─── Disponibilidad ───────────────────────────────────────────────────────────
function validarVentana(fecha: string) {
  const hoy = hoyLimaStr();
  if (fecha < hoy) throw new AppError('Esa fecha ya pasó', 400, 'FECHA_PASADA');
  if (fecha > sumarDias(hoy, DIAS_MAX())) throw new AppError(`Solo se puede reservar hasta ${DIAS_MAX()} días adelante`, 400, 'FECHA_MUY_LEJANA');
}

/** Horas libres (HH:MM) para ese servicio, juntando a todos los profesionales. */
export async function horasLibres(sedeId: string, servicioId: string, fecha: string): Promise<string[]> {
  return (await horasConCupos(sedeId, servicioId, fecha)).map((h) => h.hora);
}

/** Igual que horasLibres, con `cupos` = cuántos pacientes caben a la vez en esa hora (especialistas libres, menos los apartados). */
export async function horasConCupos(sedeId: string, servicioId: string, fecha: string): Promise<{ hora: string; cupos: number }[]> {
  validarVentana(fecha);
  const servicio = await prisma.servicio.findUnique({ where: { id: servicioId }, select: { unidadNegocioId: true, duracionMinutos: true } });
  if (!servicio) return [];
  const opera = await prisma.sedeUnidadNegocio.findUnique({ where: { sedeId_unidadNegocioId: { sedeId, unidadNegocioId: servicio.unidadNegocioId } } });
  if (!opera) return [];
  // Sede fuera de la web o servicio no ofrecido ahí: no se dan horas (aunque llamen a la API directo).
  const [sede, oculto] = await Promise.all([
    prisma.sede.findUnique({ where: { id: sedeId }, select: { reservaWeb: true, activa: true, deletedAt: true } }),
    prisma.servicioSedeWebOculto.findUnique({ where: { servicioId_sedeId: { servicioId, sedeId } } }),
  ]);
  if (!sede || !sede.reservaWeb || !sede.activa || sede.deletedAt || oculto) return [];

  const slots = await calcularDisponibilidad({ sedeId, unidadNegocioId: servicio.unidadNegocioId, servicioId, fecha, desglosado: true });
  const libresPorHora = new Map<string, number>();
  for (const s of slots) if (s.disponible) libresPorHora.set(s.horaInicio, (libresPorHora.get(s.horaInicio) ?? 0) + 1);

  // Horarios APARTADOS por un pago en línea en curso (services/reservaWeb/pago.ts): mientras el paciente paga, esa hora no se ofrece a otro.
  // Cada apartado ocupa a UN profesional durante la duración de su servicio: se descuenta de las horas que se le cruzan.
  // El pago previo del chat (WooCommerce, pagoPrevio.ts) NO cuenta: esa reserva ya tiene su cita creada, que ya ocupa la hora.
  const apartadas = await prisma.reservaWeb.findMany({
    where: {
      sedeId, fecha: fechaDb(fecha), unidadNegocioId: servicio.unidadNegocioId,
      AND: [
        { OR: [{ estado: 'esperando_pago', expiraEn: { gt: new Date() } }, { estado: 'autorizando' }] },
        { OR: [{ pasarela: null }, { pasarela: { not: PASARELA_WOO } }] },
      ],
    },
    select: { horaInicio: true, duracionMinutos: true },
  });
  const cruzan = (hora: string) => {
    const ini = timeToMinutes(hora), fin = ini + servicio.duracionMinutos;
    return apartadas.filter((a) => { const ai = timeToMinutes(a.horaInicio); return ai < fin && ini < ai + a.duracionMinutos; }).length;
  };
  const corte = fecha === hoyLimaStr() ? minutosAhoraLima(new Date()) + ANTICIPACION_MIN() : -1;
  const out: { hora: string; cupos: number }[] = [];
  for (const [hora, libres] of libresPorHora) {
    const cupos = libres - cruzan(hora);
    if (cupos > 0 && timeToMinutes(hora) >= corte) out.push({ hora, cupos });
  }
  return out.sort((a, b) => timeToMinutes(a.hora) - timeToMinutes(b.hora));
}

const cacheDias = new Map<string, { vence: number; valor: { fecha: string; horas: number }[] }>();
export function limpiarCacheDias() { cacheDias.clear(); }
/** Días con horas libres en un rango (máx. 31 días) para pintar el calendario. Caché de 60 s. */
export async function diasDisponibles(sedeId: string, servicioId: string, desde: string, hasta: string) {
  const hoy = hoyLimaStr();
  const ini = desde < hoy ? hoy : desde;
  const tope = sumarDias(hoy, DIAS_MAX());
  let fin = hasta > tope ? tope : hasta;
  if (fin > sumarDias(ini, 30)) fin = sumarDias(ini, 30);
  const clave = `${sedeId}|${servicioId}|${ini}|${fin}`;
  const c = cacheDias.get(clave);
  if (c && c.vence > Date.now()) return c.valor;
  const valor: { fecha: string; horas: number }[] = [];
  for (let f = ini; f <= fin; f = sumarDias(f, 1)) {
    const n = (await horasLibres(sedeId, servicioId, f)).length;
    if (n > 0) valor.push({ fecha: f, horas: n });
  }
  cacheDias.set(clave, { vence: Date.now() + 60_000, valor });
  if (cacheDias.size > 500) for (const [k, v] of cacheDias) if (v.vence < Date.now()) cacheDias.delete(k);
  return valor;
}

// ─── Reservar (crea la cita) ──────────────────────────────────────────────────
export interface NuevaReservaWeb {
  tipoDocumento: TipoDocumentoReserva; numeroDocumento: string; nombres: string; apellidoPaterno: string; apellidoMaterno?: string | null;
  telefono: string; email?: string | null; sedeId: string; servicioId: string; subcategoriaId?: string | null;
  fecha: string; horaInicio: string;
}
export interface OrigenReserva {
  /** Valor de un canal de la Agenda: «web» (página) o «whatsapp» (chat). */
  canal: string;
  /** true = viene de una API de integración con llave (web o WhatsApp, routes/reservaChat.ts), no de la página pública.
   *  Todas sus peticiones salen del servidor del cliente (misma IP): no aplica el freno por conexión de la página. */
  conLlave?: boolean;
  /** Id que manda el chat para que un reintento de la misma petición no cree otra cita. */
  referencia?: string | null;
  ip?: string; userAgent?: string;
  /** Solo la página: el intento (seguimiento de quién empezó y hasta dónde llegó). */
  intentoId?: string | null; intentoToken?: string | null;
}

export function nuevoCodigo(): string { return 'LB-' + String(crypto.randomInt(100000, 1000000)); }

/** Paciente por documento (si ya existe NO se cambian sus datos) o nuevo con lo que escribió. */
export async function pacienteDeReserva(d: NuevaReservaWeb, origen: string, codigo: string) {
  const donde = { tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento, deletedAt: null } as const;
  const existente = await prisma.paciente.findFirst({ where: donde, select: { id: true } });
  if (existente) return existente.id;
  const canal = await prisma.canal.findFirst({ where: { valor: origen, deletedAt: null }, select: { id: true } });
  try {
    const p = await prisma.paciente.create({
      data: {
        nombres: d.nombres.trim(), apellidoPaterno: d.apellidoPaterno.trim(), apellidoMaterno: d.apellidoMaterno?.trim() ?? '',
        tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento, telefono: d.telefono, email: d.email ?? null,
        canalId: canal?.id ?? null, requiereActualizacionDatos: true, notas: `Registrado desde la reserva ${origen === 'web' ? 'web' : `por ${origen}`} (${codigo}).`,
      },
      select: { id: true },
    });
    void registrarAudit({ accion: 'crear_paciente', entidad: 'paciente', entidadId: p.id, despues: { origen: `reserva_${origen}`, tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento, nombres: d.nombres, apellidoPaterno: d.apellidoPaterno } });
    return p.id;
  } catch {
    // Alta simultánea del mismo documento: el índice único lo frena; se usa el que quedó.
    const otro = await prisma.paciente.findFirst({ where: donde, select: { id: true } });
    if (!otro) throw new AppError('No se pudo registrar al paciente', 500, 'PACIENTE_RESERVA');
    return otro.id;
  }
}

/**
 * Llama a un endpoint de la propia Agenda (/api/v1/…) con la llave INTERNA de la reserva web (scope appointments:write).
 * Así crear, cancelar y mover una cita pasan por exactamente las mismas reglas que en la pantalla.
 */
export async function llamarAgenda(metodo: 'POST' | 'PATCH', ruta: string, cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<Response> {
  const llave = process.env.RESERVA_WEB_API_KEY;
  if (!llave) throw new AppError('La reserva en línea no está disponible por el momento', 503, 'RESERVA_NO_CONFIGURADA');
  const base = process.env.RESERVA_WEB_API_INTERNA || `http://127.0.0.1:${Number(process.env.PORT) || 3001}`;
  try {
    return await fetch(`${base}/api/v1${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${llave}`, ...cabeceras },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new AppError('El sistema no pudo registrar el cambio en este momento. Intenta de nuevo.', 502, 'AGENDA_NO_RESPONDE');
  }
}

/** Crea la cita con el mismo endpoint de la Agenda (POST /citas) usando la llave interna de la reserva web. */
export async function crearCitaEnAgenda(p: { pacienteId: string; unidadNegocioId: string; subcategoriaId: string | null; codigo: string; monto: number; claveIdempotencia: string; pago?: { transaccionId: string }; comentario?: string }, d: NuevaReservaWeb, canal: string) {
  const dondePaga = canal === 'web' ? 'por internet' : `por ${canal}`;
  const resp = await llamarAgenda('POST', '/citas', {
    pacienteId: p.pacienteId, sedeId: d.sedeId, unidadNegocioId: p.unidadNegocioId, servicioId: d.servicioId,
    ...(p.subcategoriaId ? { subcategoriaId: p.subcategoriaId } : {}),
    fecha: d.fecha, horaInicio: d.horaInicio, canal, estadoPago: p.pago ? 'completo' : 'pendiente',
    comentarioRecepcion: p.comentario ?? (p.pago
      ? `Reserva ${p.codigo}: pagó S/ ${p.monto.toFixed(2)} por internet con tarjeta (Niubiz, operación ${p.pago.transaccionId}).`
      : `Reserva ${p.codigo}: reservó ${dondePaga} sin pago en línea; paga S/ ${p.monto.toFixed(2)} en la sede.`),
  }, { 'Idempotency-Key': p.claveIdempotencia });
  const cuerpo = await resp.json().catch(() => ({})) as { id?: string; message?: string; error?: string };
  if (!resp.ok || !cuerpo.id) {
    console.error(`[reserva-web] ${p.codigo}: la Agenda no creó la cita (HTTP ${resp.status}): ${cuerpo.message || cuerpo.error || ''}`);
    if (resp.status >= 500) throw new AppError('El sistema no pudo registrar la cita en este momento. Intenta de nuevo.', 502, 'AGENDA_ERROR');
    // Casi siempre: alguien tomó ese horario justo antes. La Agenda explica el motivo en español.
    throw new AppError(cuerpo.message || 'Esa hora acaba de ocuparse. Elige otra.', 409, 'HORA_NO_DISPONIBLE');
  }
  return cuerpo.id;
}

async function nombreCanalValido(canal: string) {
  const c = await prisma.canal.findFirst({ where: { valor: canal, deletedAt: null }, select: { valor: true } });
  if (!c) throw new AppError(`El canal «${canal}» no existe en la Agenda`, 400, 'CANAL_INVALIDO');
}

/** Pago previo pendiente (sábado y domingo por el chat): enlace de la tienda y hasta cuándo se puede pagar. */
export interface PagoPendiente { url: string; expiraEn: string; minutos: number; monto: number }

export interface ReservaCreada {
  /** `confirmada` = lista. `esperando_pago` = la cita está apartada y falta pagar (enlace en `pago`). Al repetir una `referencia`
   *  vencida o cerrada vuelve su estado tal cual (`expirada`, `reembolsar`): para reservar de nuevo se usa otra referencia. */
  codigo: string; token: string; estado: string; citaId: string; repetida: boolean;
  /** N.º de la CITA que creó esta reserva («C-000123», 11-nov-2026). `codigo` es el de la reserva; este, el de la cita en la agenda. */
  numeroCita: string | null;
  fecha: string; horaInicio: string; duracionMinutos: number; monto: number; moneda: string;
  sede: { nombre: string; direccion: string | null } | null; servicio: string; variante: string | null;
  pago?: PagoPendiente;
}

/** Enlace de pago de una reserva que espera el pago previo y aún no vence (null si no aplica). */
export function pagoPendienteDe(r: { estado: string; pasarela: string | null; pagoDetalle: unknown; expiraEn: Date; monto: unknown }): PagoPendiente | null {
  if (r.estado !== 'esperando_pago' || r.pasarela !== PASARELA_WOO || r.expiraEn <= new Date()) return null;
  const url = (r.pagoDetalle as { url?: string } | null)?.url;
  return url ? { url, expiraEn: r.expiraEn.toISOString(), minutos: MINUTOS_PAGO, monto: Number(r.monto) } : null;
}

type ReservaFila = NonNullable<Awaited<ReturnType<typeof prisma.reservaWeb.findFirst>>>;

async function detalleDe(r: ReservaFila, repetida: boolean): Promise<ReservaCreada> {
  const [sede, servicio, variante, cita] = await Promise.all([
    prisma.sede.findUnique({ where: { id: r.sedeId }, select: { nombre: true, direccion: true } }),
    prisma.servicio.findUnique({ where: { id: r.servicioId }, select: { nombre: true } }),
    r.subcategoriaId ? prisma.subcategoriaServicio.findUnique({ where: { id: r.subcategoriaId }, select: { nombre: true } }) : Promise.resolve(null),
    r.citaId ? prisma.cita.findUnique({ where: { id: r.citaId }, select: { numero: true } }) : Promise.resolve(null),
  ]);
  const pago = pagoPendienteDe(r);
  // Venció el plazo y el mantenimiento (cada minuto) aún no la cerró: ya no se ofrece pagar.
  const estado = r.estado === 'esperando_pago' && r.pasarela === PASARELA_WOO && !pago ? 'expirada' : r.estado;
  return {
    codigo: r.codigo, token: r.tokenConsulta, estado, citaId: r.citaId ?? '', repetida,
    numeroCita: cita ? formatoNumeroCita(cita.numero) : null,
    fecha: fechaAStr(r.fecha), horaInicio: r.horaInicio, duracionMinutos: r.duracionMinutos, monto: Number(r.monto), moneda: r.moneda,
    sede, servicio: servicio?.nombre ?? '', variante: variante?.nombre ?? null,
    ...(pago ? { pago } : {}),
  };
}

export async function reservar(d: NuevaReservaWeb, o: OrigenReserva): Promise<ReservaCreada> {
  await nombreCanalValido(o.canal);
  const intento = o.intentoId && o.intentoToken ? await intentoConToken(o.intentoId, o.intentoToken, false) : null;
  const { servicio, variante, monto } = await servicioReservable(d.sedeId, d.servicioId, d.subcategoriaId);

  // Freno de abuso del canal web: pocas reservas por documento en 24 h y, solo en la página pública, por conexión
  // (la API web con llave sale siempre desde el mismo servidor y ya tiene su propio límite por llave).
  if (o.canal === 'web') {
    const desde = new Date(Date.now() - 24 * 3_600_000);
    const [porDoc, porIp] = await Promise.all([
      prisma.reservaWeb.count({ where: { canal: 'web', tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento, estado: 'confirmada', creadoEn: { gt: desde } } }),
      o.ip && !o.conLlave ? prisma.reservaWeb.count({ where: { canal: 'web', ip: o.ip, estado: 'confirmada', creadoEn: { gt: desde } } }) : Promise.resolve(0),
    ]);
    if (porDoc >= 3 || porIp >= 8) throw new AppError('Ya hiciste varias reservas hoy. Si necesitas otra, comunícate con nosotros.', 429, 'DEMASIADAS_RESERVAS');
  }

  const codigo = nuevoCodigo();
  const hecho = await prisma.$transaction(async (tx) => {
    // Un solo registro a la vez por sede y día: dos personas no pueden tomar el último cupo al mismo tiempo.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reserva-web|${d.sedeId}|${d.fecha}`}))`;
    if (o.referencia) {
      // La misma referencia = la misma petición: se devuelve lo que pasó con ella (confirmada, esperando el pago o ya vencida).
      const previa = await tx.reservaWeb.findFirst({ where: { canal: o.canal, referenciaExterna: o.referencia } });
      if (previa) return { previa };
    }
    const libres = await horasLibres(d.sedeId, d.servicioId, d.fecha);
    if (!libres.includes(d.horaInicio)) throw new AppError('Esa hora acaba de ocuparse. Elige otra.', 409, 'HORA_NO_DISPONIBLE');
    const pacienteId = await pacienteDeReserva(d, o.canal, codigo);

    // PAGO PREVIO (13-nov-2026): sábado y domingo por el chat de WhatsApp, si la tienda está conectada (woocommerce.ts).
    // El pedido se crea ANTES que la cita: si la tienda no responde no se crea nada (502 PAGO_NO_DISPONIBLE) y no queda una
    // cita sin forma de pagarla. La página /reserva y la API web NO cobran (se paga en la sede).
    let pedido: PedidoWoo | null = null;
    if (o.canal === 'whatsapp' && requierePagoPrevio(d.fecha)) {
      const sede = await tx.sede.findUnique({ where: { id: d.sedeId }, select: { nombre: true } });
      pedido = await crearPedidoWoo({
        codigo, monto,
        descripcion: `Cita Limablue · ${servicio.nombre}${variante.id ? ` · ${variante.nombre}` : ''} · ${sede?.nombre ?? ''} · ${d.fecha} ${d.horaInicio} (${codigo})`,
        nombres: d.nombres.trim(), apellidos: `${d.apellidoPaterno.trim()} ${d.apellidoMaterno?.trim() ?? ''}`.trim(),
        telefono: d.telefono, email: d.email,
      });
    }
    let citaId: string;
    try {
      citaId = await crearCitaEnAgenda({
        pacienteId, unidadNegocioId: servicio.unidadNegocioId, subcategoriaId: variante.id, codigo, monto,
        claveIdempotencia: o.referencia ? `reserva-${o.canal}-${crypto.createHash('sha256').update(o.referencia).digest('hex').slice(0, 40)}` : `reserva-web-${codigo}`,
        ...(pedido ? { comentario: `Reserva ${codigo}: PAGO PREVIO de S/ ${monto.toFixed(2)} por la tienda en línea (pedido #${pedido.id}), PENDIENTE. Si no paga en ${MINUTOS_PAGO} minutos, la cita se cancela sola.` } : {}),
      }, d, o.canal);
    } catch (e) {
      if (pedido) await cancelarPedidoWoo(pedido.id).catch(() => undefined);
      throw e;
    }
    return { pacienteId, citaId, pedido };
  }, { timeout: 30_000, maxWait: 10_000 });

  if ('previa' in hecho && hecho.previa) return detalleDe(hecho.previa, true);

  const { pacienteId, citaId, pedido } = hecho as { pacienteId: string; citaId: string; pedido: PedidoWoo | null };
  const tokenConsulta = crypto.randomBytes(24).toString('hex');
  const reserva = await prisma.reservaWeb.create({
    data: {
      codigo, tokenConsulta, estado: pedido ? 'esperando_pago' : 'confirmada', canal: o.canal, referenciaExterna: o.referencia ?? null,
      tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento,
      nombres: d.nombres.trim(), apellidoPaterno: d.apellidoPaterno.trim(), apellidoMaterno: d.apellidoMaterno?.trim() || null,
      telefono: d.telefono, email: d.email ?? '',
      sedeId: d.sedeId, unidadNegocioId: servicio.unidadNegocioId, servicioId: d.servicioId, subcategoriaId: variante.id,
      fecha: fechaDb(d.fecha), horaInicio: d.horaInicio, duracionMinutos: servicio.duracionMinutos,
      monto, expiraEn: pedido ? new Date(Date.now() + MINUTOS_PAGO * 60_000) : new Date(), pacienteId, citaId,
      ...(pedido ? { pasarela: PASARELA_WOO, pagoReferencia: String(pedido.id), pagoEstado: 'pendiente', pagoDetalle: { url: pedido.url, pedido: pedido.id } } : {}),
      ip: o.ip ?? null, userAgent: o.userAgent?.slice(0, 300) ?? null,
    },
  });
  cacheDias.clear();
  if (intento) await enlazarReserva(intento.id, reserva.id, { sedeId: d.sedeId, servicioId: d.servicioId, subcategoriaId: variante.id, fecha: d.fecha, horaInicio: d.horaInicio }).catch(() => undefined);
  void registrarAudit({
    citaId, accion: pedido ? 'reserva_web_esperando_pago' : 'reserva_web_confirmada', entidad: 'reserva_web', entidadId: reserva.id, sedeId: reserva.sedeId, ip: o.ip, userAgent: o.userAgent,
    despues: { codigo, canal: o.canal, citaId, fecha: d.fecha, horaInicio: d.horaInicio, servicio: servicio.nombre, variante: variante.nombre, monto, ...(pedido ? { pedidoWoo: pedido.id } : {}) },
  });
  return detalleDe(reserva, false);
}

// ─── Consultar ────────────────────────────────────────────────────────────────
function tokenIgual(a: string, b: string) {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Estado de una reserva con su token (la página, al volver con su código). */
export async function estadoReserva(codigo: string, token: string) {
  const r = await prisma.reservaWeb.findUnique({ where: { codigo } });
  if (!r || !tokenIgual(r.tokenConsulta, token)) throw new AppError('Reserva no encontrada', 404, 'RESERVA_NO_ENCONTRADA');
  return estadoDe(r);
}

/** Estado de una reserva por su código (el chat, que entra con llave). Solo reservas hechas por ese canal. */
export async function estadoReservaPorCodigo(codigo: string, canal: string) {
  const r = await prisma.reservaWeb.findFirst({ where: { codigo, canal } });
  if (!r) throw new AppError('Reserva no encontrada', 404, 'RESERVA_NO_ENCONTRADA');
  return estadoDe(r);
}

async function estadoDe(r: ReservaFila) {
  const d = await detalleDe(r, false);
  const cita = r.citaId ? await prisma.cita.findUnique({ where: { id: r.citaId }, select: { estado: true, deletedAt: true, fecha: true, horaInicio: true } }) : null;
  const vigente = !!cita && !cita.deletedAt;
  return {
    codigo: r.codigo, numeroCita: d.numeroCita,
    estado: (d.estado === 'confirmada' || d.estado === 'esperando_pago') && cita && (cita.deletedAt || cita.estado === 'cancelada') ? 'cancelada' : d.estado,
    citaVigente: vigente && cita!.estado !== 'cancelada', estadoCita: cita?.estado ?? null,
    // Fecha y hora de la CITA (11-nov-2026): si se reprogramó (por el chat o en la Agenda), manda la cita, no la reserva original.
    nombres: r.nombres, fecha: cita ? fechaAStr(cita.fecha) : d.fecha, horaInicio: cita?.horaInicio ?? d.horaInicio, duracionMinutos: d.duracionMinutos,
    // Ids para pedir horas al reprogramar (GET /horas?sedeId&servicioId&fecha).
    sedeId: r.sedeId, servicioId: r.servicioId, subcategoriaId: r.subcategoriaId,
    sede: d.sede, servicio: d.servicio, variante: d.variante, monto: d.monto, moneda: d.moneda,
    /** true = la reserva se pagó en línea (Niubiz en la página o pago previo del chat); false = se paga en la sede. */
    pagado: r.pagoEstado === 'aprobado',
    // Pago previo del chat (sábado y domingo): pendiente | pagado | rechazado | monto_distinto; `pago` (enlace) solo mientras se puede pagar.
    // En la base se guarda «aprobado» (igual que Niubiz); hacia el chat sale «pagado», como lo definió el equipo de Ana.
    ...(r.pasarela === PASARELA_WOO ? { pagoEstado: r.pagoEstado === 'aprobado' ? 'pagado' : r.pagoEstado, ...(d.pago ? { pago: d.pago } : {}) } : {}),
  };
}

/**
 * Mantenimiento cada minuto:
 *  - un apartado de pago que venció sin que el paciente pagara pasa a «expirada» (la hora vuelve a ofrecerse);
 *  - un pago que quedó «autorizando» más de 5 min (el proceso se reinició o Niubiz no respondió) pasa a «reembolsar» con el pago
 *    «incierto»: no se sabe si se cobró, hay que verificarlo en Niubiz.
 * El pago previo del chat (WooCommerce) NO se cierra aquí: su cita ya existe y hay que cancelarla; lo hace pagoPrevio.ts.
 */
export async function mantenimientoReservasWeb() {
  const u = await prisma.reservaWeb.updateMany({
    where: { estado: 'esperando_pago', expiraEn: { lt: new Date() }, OR: [{ pasarela: null }, { pasarela: { not: PASARELA_WOO } }] },
    data: { estado: 'expirada' },
  });
  const atascadas = await prisma.reservaWeb.updateMany({
    where: { estado: 'autorizando', actualizadoEn: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { estado: 'reembolsar', pagoEstado: 'incierto', error: 'La autorización del pago no terminó (el servidor se reinició o Niubiz no respondió): verifica en Niubiz si se cobró.' },
  });
  if (u.count || atascadas.count) cacheDias.clear();
  return u.count + atascadas.count;
}
