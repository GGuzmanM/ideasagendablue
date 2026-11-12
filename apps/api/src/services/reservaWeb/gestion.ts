/**
 * CANCELAR y REPROGRAMAR citas desde la API del chat (11-nov-2026) — /integraciones/reservas.
 *
 * Dos formas de llegar a la cita:
 *  - por la RESERVA del chat/web: POST /:codigo/cancelar|reprogramar (código «LB-…»);
 *  - por el PACIENTE: GET /pacientes/citas?numeroDocumento= lista TODAS sus citas próximas (también las de recepción) y
 *    POST /citas/:numeroCita/cancelar|reprogramar actúa sobre una («C-…»), con el documento del paciente como comprobación.
 *
 * Solo la MECÁNICA: las reglas de negocio (anticipación, cuántas veces, cómo se verifica a la persona) las programa el chat.
 * La Agenda solo pone lo que protege los datos:
 *  - la cita tiene que estar «Agendada» o «Confirmada» y no haber pasado ya su hora;
 *  - una cita PAGADA en línea (Niubiz) no se cancela por aquí (habría que devolver el dinero: eso lo ve la sede);
 *  - reprogramar: misma sede y mismo servicio, a una hora que ofrezca GET /horas; el especialista lo asigna la Agenda.
 * Cancelar y mover pasan por los MISMOS endpoints de la Agenda (PATCH /citas/:id/estado y /mover) con la llave interna,
 * así que valen todas sus reglas (estados, choques de horario, turnos, bloqueos), la auditoría, el tiempo real y los recordatorios.
 */
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { registrarAudit } from '../audit';
import { seleccionarProfesionalOptimo } from '../disponibilidad';
import { fechaAStr, fechaDb, hoyLimaStr } from '../../utils/fechaLima';
import { timeToMinutes, formatoNumeroCita } from '@limablue/shared';
import { estadoReservaPorCodigo, horasLibres, limpiarCacheDias, llamarAgenda, minutosAhoraLima } from './reservaWebService';
import { normalizarDocumento } from './validaciones';

const MODIFICABLES = ['agendada', 'confirmada'];
const NOMBRE_ESTADO: Record<string, string> = {
  llego: 'Llegó', en_atencion: 'En atención', completada: 'Completada', no_show: 'No show', reprogramada: 'Reprogramada', cancelada: 'Cancelada',
};
const SELECT_CITA = {
  id: true, numero: true, estado: true, deletedAt: true, fecha: true, horaInicio: true, duracionMinutos: true,
  sedeId: true, unidadNegocioId: true, servicioId: true, profesionalId: true, pacienteId: true,
} as const;

export interface Meta { ip?: string; userAgent?: string }
interface CitaG {
  id: string; numero: number; estado: string; deletedAt: Date | null; fecha: Date; horaInicio: string; duracionMinutos: number;
  sedeId: string; unidadNegocioId: string; servicioId: string; profesionalId: string | null; pacienteId: string;
}

function yaPaso(fecha: string, hora: string) {
  const hoy = hoyLimaStr();
  return fecha < hoy || (fecha === hoy && timeToMinutes(hora) <= minutosAhoraLima());
}

function exigirModificable(cita: CitaG) {
  if (!MODIFICABLES.includes(cita.estado)) {
    throw new AppError(`La cita está en «${NOMBRE_ESTADO[cita.estado] ?? cita.estado}»: ya no se puede cambiar por aquí.`, 409, 'CITA_NO_MODIFICABLE');
  }
  if (yaPaso(fechaAStr(cita.fecha), cita.horaInicio)) throw new AppError('La hora de la cita ya pasó.', 409, 'CITA_PASADA');
}

/** Respuesta de la Agenda → error con su mismo código y mensaje (en español). Llave mal configurada o 5xx: error del servidor. */
async function exigirOk(resp: Response, ref: string, que: string) {
  if (resp.ok) return;
  const c = await resp.json().catch(() => ({})) as { error?: string; message?: string };
  console.error(`[reserva-chat] ${ref}: la Agenda no pudo ${que} (HTTP ${resp.status}): ${c.message || c.error || ''}`);
  if (resp.status === 401 || resp.status === 403) throw new AppError('La gestión de citas no está disponible por el momento', 503, 'RESERVA_NO_CONFIGURADA');
  if (resp.status >= 500) throw new AppError('El sistema no pudo registrar el cambio en este momento. Intenta de nuevo.', 502, 'AGENDA_ERROR');
  throw new AppError(c.message || 'No se pudo hacer el cambio', resp.status === 404 ? 409 : resp.status, c.error || 'AGENDA_RECHAZO');
}

/** Cancela con PATCH /citas/:id/estado. Devuelve false si ya estaba cancelada (reintento: no es error). */
async function cancelar(cita: CitaG, o: { pagadaEnLinea: boolean; motivoCita: string; ref: string; audit: { entidad: string; entidadId: string; despues: Record<string, unknown> }; meta: Meta }) {
  if (cita.estado === 'cancelada') return false;
  exigirModificable(cita);
  if (o.pagadaEnLinea) {
    throw new AppError('Esta cita se pagó en línea: para cancelarla (y devolver el pago) el paciente debe comunicarse con la sede.', 409, 'PAGADA_EN_LINEA');
  }
  await exigirOk(await llamarAgenda('PATCH', `/citas/${cita.id}/estado`, { estado: 'cancelada', motivoCancelacion: o.motivoCita }), o.ref, 'cancelar la cita');
  limpiarCacheDias();
  void registrarAudit({
    citaId: cita.id, accion: 'chat_cita_cancelada', entidad: o.audit.entidad, entidadId: o.audit.entidadId, sedeId: cita.sedeId, ip: o.meta.ip, userAgent: o.meta.userAgent,
    antes: { estado: cita.estado, fecha: fechaAStr(cita.fecha), horaInicio: cita.horaInicio },
    despues: { ...o.audit.despues, estado: 'cancelada' },
  });
  return true;
}

/** Mueve con PATCH /citas/:id/mover. Devuelve false si ya estaba en ese horario. */
async function mover(cita: CitaG, fecha: string, horaInicio: string, o: { ref: string; audit: { entidad: string; entidadId: string; despues: Record<string, unknown> }; meta: Meta }) {
  exigirModificable(cita);
  const fechaActual = fechaAStr(cita.fecha);
  if (fechaActual === fecha && cita.horaInicio === horaInicio) return false;

  // La hora tiene que ser una de las que ofrece GET /horas. Excepción: el mismo día, a una hora que se cruza con la propia
  // cita (p. ej. 30 min después): /horas la ve «ocupada» por ella misma; ahí decide la Agenda al mover.
  const libres = await horasLibres(cita.sedeId, cita.servicioId, fecha);
  const ini = timeToMinutes(horaInicio), actual = timeToMinutes(cita.horaInicio);
  const seCruzaConsigo = fechaActual === fecha && ini < actual + cita.duracionMinutos && actual < ini + cita.duracionMinutos;
  if (!libres.includes(horaInicio) && !seCruzaConsigo) throw new AppError('Esa hora no está disponible. Elige otra de GET /horas.', 409, 'HORA_NO_DISPONIBLE');

  // Especialista: se queda el mismo si está libre a esa hora; si no, la Agenda elige a otro libre (como al reservar).
  const profesionalId = (await seleccionarProfesionalOptimo(cita.sedeId, cita.unidadNegocioId, cita.servicioId, fecha, horaInicio, cita.profesionalId)) ?? cita.profesionalId;
  await exigirOk(await llamarAgenda('PATCH', `/citas/${cita.id}/mover`, { fecha, horaInicio, profesionalId }), o.ref, 'mover la cita');
  limpiarCacheDias();
  void registrarAudit({
    citaId: cita.id, accion: 'chat_cita_reprogramada', entidad: o.audit.entidad, entidadId: o.audit.entidadId, sedeId: cita.sedeId, ip: o.meta.ip, userAgent: o.meta.userAgent,
    antes: { fecha: fechaActual, horaInicio: cita.horaInicio, profesionalId: cita.profesionalId },
    despues: { ...o.audit.despues, fecha, horaInicio, profesionalId },
  });
  return true;
}

// ─── Por la RESERVA (código LB-…) ─────────────────────────────────────────────
async function reservaConCita(codigo: string, canal: string) {
  const r = await prisma.reservaWeb.findFirst({ where: { codigo, canal } });
  if (!r) throw new AppError('Reserva no encontrada', 404, 'RESERVA_NO_ENCONTRADA');
  const cita = r.estado === 'confirmada' && r.citaId ? await prisma.cita.findUnique({ where: { id: r.citaId }, select: SELECT_CITA }) : null;
  if (!cita || cita.deletedAt) throw new AppError('Esta reserva no tiene una cita vigente en la agenda', 409, 'SIN_CITA');
  return { r, cita };
}

export async function cancelarReserva(codigo: string, canal: string, motivo: string | null, meta: Meta = {}) {
  const { r, cita } = await reservaConCita(codigo, canal);
  const hecho = await cancelar(cita, {
    pagadaEnLinea: r.pagoEstado === 'aprobado',
    motivoCita: `Cancelada por el paciente vía ${canal} (reserva ${codigo})${motivo ? `: ${motivo}` : ''}`,
    ref: codigo, meta, audit: { entidad: 'reserva_web', entidadId: r.id, despues: { codigo, canal, motivo } },
  });
  return { ...(await estadoReservaPorCodigo(codigo, canal)), sinCambios: !hecho };
}

export async function reprogramarReserva(codigo: string, canal: string, fecha: string, horaInicio: string, meta: Meta = {}) {
  const { r, cita } = await reservaConCita(codigo, canal);
  const hecho = await mover(cita, fecha, horaInicio, { ref: codigo, meta, audit: { entidad: 'reserva_web', entidadId: r.id, despues: { codigo, canal } } });
  return { ...(await estadoReservaPorCodigo(codigo, canal)), sinCambios: !hecho };
}

// ─── Por el PACIENTE (documento + N.º de cita C-…) ────────────────────────────
export interface DocumentoPaciente { tipoDocumento: string; numeroDocumento: string }

async function pacienteDe(d: DocumentoPaciente) {
  return prisma.paciente.findFirst({ where: { tipoDocumento: d.tipoDocumento as never, numeroDocumento: normalizarDocumento(d.numeroDocumento), deletedAt: null }, select: { id: true } });
}

/** «C-008323», «c8323» o «8323» → 8323. */
export function leerNumeroCita(texto: string): number | null {
  const m = /^(?:c-?)?0*(\d{1,9})$/i.exec(texto.trim());
  return m ? Number(m[1]) : null;
}

/** Ficha de una cita para el chat (sin datos del paciente ni del profesional). */
async function fichas(citas: CitaG[]) {
  if (!citas.length) return [];
  const ids = citas.map((c) => c.id);
  const [extra, reservas] = await Promise.all([
    prisma.cita.findMany({
      where: { id: { in: ids } },
      select: { id: true, slotGrupoId: true, sede: { select: { nombre: true, direccion: true } }, servicio: { select: { nombre: true } }, subcategoriaId: true, subcategoria: { select: { nombre: true } } },
    }),
    prisma.reservaWeb.findMany({ where: { citaId: { in: ids } }, select: { citaId: true, codigo: true, canal: true, pagoEstado: true } }),
  ]);
  const ex = new Map(extra.map((e) => [e.id, e]));
  return citas.map((c) => {
    const e = ex.get(c.id);
    const rs = reservas.filter((r) => r.citaId === c.id);
    return {
      numeroCita: formatoNumeroCita(c.numero), estado: c.estado,
      fecha: fechaAStr(c.fecha), horaInicio: c.horaInicio, duracionMinutos: c.duracionMinutos,
      sedeId: c.sedeId, sede: e?.sede ?? null, servicioId: c.servicioId, servicio: e?.servicio.nombre ?? null,
      subcategoriaId: e?.subcategoriaId ?? null, variante: e?.subcategoria?.nombre ?? null,
      /** Código «LB-…» si la cita nació de una reserva web o del chat; null si la registró la clínica. */
      codigoReserva: rs[0]?.codigo ?? null, canalReserva: rs[0]?.canal ?? null,
      pagadoEnLinea: rs.some((r) => r.pagoEstado === 'aprobado'),
      /** Parte de una visita de dos servicios a la misma hora: se cancela entera; para reprogramarla, la sede. */
      enBloque: !!e?.slotGrupoId,
    };
  });
}

/** Citas PRÓXIMAS «Agendada» o «Confirmada» del paciente (todas, también las de recepción). Documento desconocido = lista vacía. */
export async function citasProximas(d: DocumentoPaciente) {
  const paciente = await pacienteDe(d);
  if (!paciente) return [];
  const citas = await prisma.cita.findMany({
    where: { pacienteId: paciente.id, deletedAt: null, estado: { in: MODIFICABLES as never }, fecha: { gte: fechaDb(hoyLimaStr()) } },
    select: SELECT_CITA, orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }], take: 50,
  });
  return fichas(citas.filter((c) => !yaPaso(fechaAStr(c.fecha), c.horaInicio)));
}

/** La cita con ese número, solo si es de ese paciente (si no, 404 igual que si no existiera). */
async function citaDelPaciente(numeroTexto: string, d: DocumentoPaciente) {
  const numero = leerNumeroCita(numeroTexto);
  const [cita, paciente] = await Promise.all([
    numero ? prisma.cita.findUnique({ where: { numero }, select: SELECT_CITA }) : Promise.resolve(null),
    pacienteDe(d),
  ]);
  if (!cita || cita.deletedAt || !paciente || cita.pacienteId !== paciente.id) throw new AppError('Cita no encontrada', 404, 'CITA_NO_ENCONTRADA');
  return cita;
}

async function fichaDe(citaId: string) {
  const c = await prisma.cita.findUnique({ where: { id: citaId }, select: SELECT_CITA });
  return (await fichas(c ? [c] : []))[0]!;
}

export async function cancelarCitaPaciente(numeroCita: string, d: DocumentoPaciente, canal: string, motivo: string | null, meta: Meta = {}) {
  const cita = await citaDelPaciente(numeroCita, d);
  const pagada = await prisma.reservaWeb.findFirst({ where: { citaId: cita.id, pagoEstado: 'aprobado' }, select: { id: true } });
  const n = formatoNumeroCita(cita.numero);
  const hecho = await cancelar(cita, {
    pagadaEnLinea: !!pagada,
    motivoCita: `Cancelada por el paciente vía ${canal}${motivo ? `: ${motivo}` : ''}`,
    ref: n, meta, audit: { entidad: 'cita', entidadId: cita.id, despues: { numeroCita: n, canal, motivo } },
  });
  return { ...(await fichaDe(cita.id)), sinCambios: !hecho };
}

export async function reprogramarCitaPaciente(numeroCita: string, d: DocumentoPaciente, canal: string, fecha: string, horaInicio: string, meta: Meta = {}) {
  const cita = await citaDelPaciente(numeroCita, d);
  const n = formatoNumeroCita(cita.numero);
  const hecho = await mover(cita, fecha, horaInicio, { ref: n, meta, audit: { entidad: 'cita', entidadId: cita.id, despues: { numeroCita: n, canal } } });
  return { ...(await fichaDe(cita.id)), sinCambios: !hecho };
}
