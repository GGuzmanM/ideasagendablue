/**
 * Extras del chat de Ana para el servidor MCP (17-nov-2026; los pidió el equipo del chat, adaptados a esta Agenda):
 *  - infoSedes        dirección y horario por día de las sedes de la reserva en línea («¿dónde queda?», «¿a qué hora abren?»);
 *  - agregarNotaCita  el paciente deja una nota para recepción en su cita (se suma al hilo de comentarios, con auditoría y tiempo real);
 *  - extenderPago     MINUTOS_PAGO más para pagar una reserva de fin de semana, UNA sola vez, mientras siga esperando el pago.
 * La identidad es el DOCUMENTO del paciente, igual que al cancelar o reprogramar (gestion.ts): una cita o reserva que no es suya
 * responde 404 como si no existiera.
 */
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { registrarAudit } from '../audit';
import { crearComentarioEnTx, getCitaCompleta } from '../citaCompleta';
import { emitirEventoCita } from '../../socket';
import { fechaAStr } from '../../utils/fechaLima';
import { citaDelPaciente, evaluarCambio, type DocumentoPaciente, type Meta } from './gestion';
import { estadoReservaPorCodigo, PASARELA_WOO } from './reservaWebService';
import { MINUTOS_PAGO } from './woocommerce';
import { normalizarDocumento } from './validaciones';

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Sedes visibles en la reserva en línea, con dirección y horario por día (los días cerrados no salen). */
export async function infoSedes() {
  const sedes = await prisma.sede.findMany({
    where: { activa: true, deletedAt: null, reservaWeb: true },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], select: { id: true, nombre: true, direccion: true, horario: true },
  });
  return {
    sedes: sedes.map((s) => {
      const h = (s.horario ?? {}) as Record<string, { apertura?: string; cierre?: string } | null>;
      const horario = Object.entries(h)
        .filter(([, v]) => v && v.apertura && v.cierre)
        .map(([dia, v]) => ({ dia, apertura: v!.apertura!, cierre: v!.cierre! }))
        .sort((a, b) => DIAS.indexOf(sinTildes(a.dia)) - DIAS.indexOf(sinTildes(b.dia)));
      return { id: s.id, nombre: s.nombre, direccion: s.direccion, horario };
    }),
  };
}

/** Nota del paciente para recepción en su cita vigente (`codigo` = «LB-…», «C-…» o id de la cita). */
export async function agregarNotaCita(codigo: string, d: DocumentoPaciente, texto: string, meta: Meta = {}) {
  let cita: Awaited<ReturnType<typeof citaDelPaciente>>;
  try { cita = await citaDelPaciente(codigo, d); } catch (e) {
    if (e instanceof AppError && e.code === 'CITA_NO_ENCONTRADA') throw new AppError('Reserva no encontrada', 404, 'RESERVA_NO_ENCONTRADA');
    throw e;
  }
  const reservas = await prisma.reservaWeb.findMany({ where: { citaId: cita.id }, select: { pagoEstado: true, pasarela: true, estado: true } });
  const ev = evaluarCambio(cita, reservas);
  if (ev.yaCancelada || ev.bloqueo?.codigo === 'NO_SE_PUEDE_CANCELAR') throw new AppError('Esa cita ya no está vigente.', 409, 'NO_VIGENTE');
  const limpio = texto.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (limpio.length < 3) throw new AppError('Escribe la nota', 400, 'NOTA_VACIA');
  await prisma.$transaction((tx) => crearComentarioEnTx(tx, {
    citaId: cita.id, sedeId: cita.sedeId, autorId: null, autorEtiqueta: 'Paciente (WhatsApp · Ana)', texto: limpio, ip: meta.ip, userAgent: meta.userAgent,
  }));
  void registrarAudit({ citaId: cita.id, accion: 'chat_nota_cita', entidad: 'cita', entidadId: cita.id, sedeId: cita.sedeId, ip: meta.ip, userAgent: meta.userAgent, despues: { codigo } });
  try {
    emitirEventoCita({ tipo: 'cita:actualizada', sedeId: cita.sedeId, fecha: fechaAStr(cita.fecha), cita: await getCitaCompleta(cita.id) as never, cambiadoPor: 'paciente' });
  } catch (e) { console.error('[reserva-chat] no se pudo avisar la nota a la agenda:', (e as Error).message); }
  return { codigo, ok: true };
}

/** MINUTOS_PAGO más para pagar, una sola vez, mientras la reserva (de ESTE canal y de ese documento) siga esperando el pago. */
export async function extenderPago(codigo: string, numeroDocumento: string, canal: string) {
  const doc = normalizarDocumento(numeroDocumento);
  const r = await prisma.reservaWeb.findFirst({ where: { codigo: codigo.trim().toUpperCase(), canal, numeroDocumento: doc } });
  if (!r) throw new AppError('Reserva no encontrada', 404, 'RESERVA_NO_ENCONTRADA');
  if (r.estado !== 'esperando_pago' || r.pasarela !== PASARELA_WOO) throw new AppError('Esta reserva no está esperando un pago.', 409, 'NO_ESPERA_PAGO');
  if (r.expiraEn <= new Date()) throw new AppError('El plazo de pago ya venció: hay que reservar de nuevo.', 409, 'PAGO_VENCIDO');
  const det = (r.pagoDetalle ?? {}) as Record<string, unknown>;
  if (det.extendido) throw new AppError('El plazo ya se extendió una vez.', 409, 'YA_EXTENDIDO');
  // Condicionado: si justo venció (o el mantenimiento la cerró) no se extiende.
  const u = await prisma.reservaWeb.updateMany({
    where: { id: r.id, estado: 'esperando_pago', expiraEn: { gt: new Date() } },
    data: { expiraEn: new Date(r.expiraEn.getTime() + MINUTOS_PAGO * 60_000), pagoDetalle: { ...det, extendido: true } as never },
  });
  if (!u.count) throw new AppError('El plazo de pago ya venció: hay que reservar de nuevo.', 409, 'PAGO_VENCIDO');
  void registrarAudit({ citaId: r.citaId ?? undefined, accion: 'reserva_web_pago_extendido', entidad: 'reserva_web', entidadId: r.id, sedeId: r.sedeId, despues: { codigo: r.codigo, minutos: MINUTOS_PAGO } });
  return estadoReservaPorCodigo(r.codigo, canal);
}
