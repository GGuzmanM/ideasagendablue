/**
 * REBOTE (30-sep-2026): el paciente avisa que no puede venir y la cita sale de la agenda a una
 * bandeja para volver a llamarlo y reagendarlo.
 *
 * - Entran citas agendadas, confirmadas o «no vino» (no_show). Mientras están en rebote quedan en
 *   estado 'reprogramada' (el hueco se libera: disponibilidad e índices únicos ya la excluyen).
 * - Rebote ACTIVO = reboteDesde != null, reboteCerradoEn == null y estado 'reprogramada'.
 * - Se cierra: al reagendarla con el mover de siempre (routes/citas.ts, resultado 'reagendada'), al
 *   descartarla (→ cancelada) o sola a los DIAS_REBOTE días (→ cancelada, resultado 'vencida').
 * - Un bloque combinado entra y sale entero (las dos citas).
 * - Sin correo al paciente.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { assertSinAtencionClinica } from './historiaClinicaService';
import { sincronizarSesionPaquete } from './paqueteSesionService';
import { cancelarRecordatoriosDeCita } from './recordatorioService';
import { cancelarVideosDeCita } from './videoEnvioService';
import { sincronizarCitaOutlook } from './outlookCalendarService';
import { emitirEventoCita } from '../socket';
import { invalidateDisponibilidadCache } from '../redis';
import { fechaAStr, fechaDb } from '../utils/fechaLima';

export const DIAS_REBOTE = 30;
export const ESTADOS_ORIGEN_REBOTE = ['agendada', 'confirmada', 'no_show'] as const;
export const TURNOS_REBOTE = ['manana', 'tarde', 'cualquiera'] as const;
export const RESULTADOS_LLAMADA = ['contesto', 'no_contesto', 'pidio_llamar_luego', 'otro'] as const;
const DIA_MS = 24 * 60 * 60_000;

/** Filtro de rebote activo (para findMany/updateMany). */
export const REBOTE_ACTIVO: Prisma.CitaWhereInput = {
  reboteDesde: { not: null },
  reboteCerradoEn: null,
  estado: 'reprogramada',
  deletedAt: null,
};

export function reboteAbierto(c: { reboteDesde: Date | null; reboteCerradoEn: Date | null }): boolean {
  return !!c.reboteDesde && !c.reboteCerradoEn;
}

/** El rebote se habilita por entorno (REBOTE_HABILITADO=1). Apagado → las rutas responden 404. */
export function reboteHabilitado(): boolean {
  return process.env.REBOTE_HABILITADO === '1';
}

interface Actor {
  usuarioId?: string;
  ip?: string;
  userAgent?: string;
}

/** Cita (y su hermana de bloque, si la hay) que entran o salen juntas del rebote. */
async function grupoDe(citaId: string) {
  const cita = await prisma.cita.findUnique({ where: { id: citaId, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  const grupo = cita.slotGrupoId
    ? await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, deletedAt: null }, orderBy: { slotRol: 'asc' } })
    : [cita];
  return { cita, grupo };
}

/** Efectos fuera de la transacción al sacar una cita de la agenda (rebote, descarte o vencimiento). */
async function efectosSalidaAgenda(c: { id: string; sedeId: string; fecha: Date }, estado: string, usuarioId?: string) {
  await sincronizarSesionPaquete(c.id); // si había descontado sesión, vuelve
  void cancelarRecordatoriosDeCita(c.id);
  void cancelarVideosDeCita(c.id);
  void sincronizarCitaOutlook('cancelar', c.id);
  emitirEventoCita({
    tipo: 'cita:cancelada',
    sedeId: c.sedeId,
    fecha: fechaAStr(c.fecha),
    cita: { id: c.id, estado } as never,
    cambiadoPor: usuarioId ?? 'sistema',
  });
}

// ─── Enviar a rebote ──────────────────────────────────────────────────────────
export async function enviarARebote(
  citaId: string,
  datos: { motivo: string; turno?: (typeof TURNOS_REBOTE)[number] | null; llamarDesde?: string | null },
  actor: Actor,
): Promise<string[]> {
  const { cita, grupo } = await grupoDe(citaId);
  const aMover = grupo.filter((c) => !['cancelada', 'completada'].includes(c.estado));
  if (aMover.some(reboteAbierto)) throw new AppError('La cita ya está en rebote', 409, 'YA_EN_REBOTE');
  const invalida = aMover.find((c) => !(ESTADOS_ORIGEN_REBOTE as readonly string[]).includes(c.estado));
  if (invalida || aMover.length === 0) {
    throw new AppError('Solo pasan a rebote las citas agendadas, confirmadas o que no vinieron', 400, 'ESTADO_NO_REBOTE');
  }
  for (const c of aMover) await assertSinAtencionClinica(c.id);

  const ahora = new Date();
  const vence = new Date(ahora.getTime() + DIAS_REBOTE * DIA_MS);
  await prisma.$transaction(async (tx) => {
    for (const c of aMover) {
      // Escritura con guarda: si otro cambió el estado mientras tanto, no se pisa.
      const r = await tx.cita.updateMany({
        where: { id: c.id, estado: c.estado, deletedAt: null },
        data: {
          estado: 'reprogramada',
          reboteDesde: ahora,
          reboteVenceEl: vence,
          reboteMotivo: datos.motivo,
          rebotePorId: actor.usuarioId ?? null,
          reboteEstadoOrigen: c.estado,
          reboteTurno: datos.turno ?? null,
          reboteLlamarDesde: datos.llamarDesde ? fechaDb(datos.llamarDesde) : null,
          reboteProfesionalId: c.profesionalId,
          reboteCerradoEn: null,
          reboteResultado: null,
          llegoEn: null,
          enAtencionEn: null,
        },
      });
      if (r.count === 0) throw new AppError('La cita cambió de estado mientras tanto. Actualiza la agenda y vuelve a intentar.', 409, 'ESTADO_CAMBIADO');
      await auditEnTx(tx, {
        citaId: c.id, usuarioId: actor.usuarioId, accion: 'enviar_rebote', entidad: 'cita', entidadId: c.id,
        antes: { estado: c.estado, fecha: fechaAStr(c.fecha), horaInicio: c.horaInicio, profesionalId: c.profesionalId },
        despues: { estado: 'reprogramada', motivo: datos.motivo, turno: datos.turno ?? null, llamarDesde: datos.llamarDesde ?? null, venceEl: vence, ...(c.id !== cita.id ? { slotGrupoId: cita.slotGrupoId, cascada: true } : {}) },
        sedeId: c.sedeId, ip: actor.ip, userAgent: actor.userAgent,
      });
    }
  });

  for (const c of aMover) await efectosSalidaAgenda(c, 'reprogramada', actor.usuarioId);
  await invalidateDisponibilidadCache(cita.sedeId, fechaAStr(cita.fecha));
  return aMover.map((c) => c.id);
}

// ─── Bandeja ──────────────────────────────────────────────────────────────────
/** Rebotes activos. `sedeIds` null = todas; en un bloque solo sale la cita PRINCIPAL. */
export async function listarRebotes(filtro: { sedeIds: string[] | null; sedeId?: string }) {
  const sedeWhere: Prisma.CitaWhereInput = filtro.sedeId
    ? { sedeId: filtro.sedeId }
    : filtro.sedeIds ? { sedeId: { in: filtro.sedeIds } } : {};
  const citas = await prisma.cita.findMany({
    where: { ...REBOTE_ACTIVO, ...sedeWhere, OR: [{ slotRol: null }, { slotRol: 'PRINCIPAL' }] },
    orderBy: [{ reboteVenceEl: 'asc' }],
    select: {
      id: true, fecha: true, horaInicio: true, duracionMinutos: true, slotGrupoId: true, canal: true, estadoPago: true,
      reboteDesde: true, reboteVenceEl: true, reboteMotivo: true, reboteEstadoOrigen: true, reboteTurno: true,
      reboteLlamarDesde: true, reboteProfesionalId: true,
      paciente: { select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, numeroDocumento: true, telefono: true, email: true } },
      servicio: { select: { id: true, nombre: true } },
      sede: { select: { id: true, nombre: true } },
      rebotePor: { select: { id: true, nombre: true } },
      reboteLlamadas: { orderBy: { creadoEn: 'desc' }, take: 1, select: { resultado: true, nota: true, creadoEn: true, usuario: { select: { nombre: true } } } },
      _count: { select: { reboteLlamadas: true } },
    },
  });

  const profIds = [...new Set(citas.map((c) => c.reboteProfesionalId).filter((x): x is string => !!x))];
  const profs = profIds.length
    ? await prisma.profesional.findMany({ where: { id: { in: profIds } }, select: { id: true, nombres: true, apellidos: true } })
    : [];
  const nombreProf = new Map(profs.map((p) => [p.id, `${p.nombres} ${p.apellidos}`.trim()]));

  // Servicio extra del bloque (para mostrar «Profilaxis + Láser»).
  const grupos = citas.map((c) => c.slotGrupoId).filter((x): x is string => !!x);
  const secundarias = grupos.length
    ? await prisma.cita.findMany({ where: { slotGrupoId: { in: grupos }, slotRol: 'SECUNDARIO', deletedAt: null }, select: { slotGrupoId: true, servicio: { select: { nombre: true } } } })
    : [];
  const extraDe = new Map(secundarias.map((s) => [s.slotGrupoId!, s.servicio.nombre]));

  const ahora = Date.now();
  return citas.map(({ _count, reboteLlamadas, ...c }) => ({
    ...c,
    fecha: fechaAStr(c.fecha),
    reboteLlamarDesde: c.reboteLlamarDesde ? fechaAStr(c.reboteLlamarDesde) : null,
    servicioExtra: c.slotGrupoId ? extraDe.get(c.slotGrupoId) ?? null : null,
    profesionalNombre: c.reboteProfesionalId ? nombreProf.get(c.reboteProfesionalId) ?? null : null,
    diasEnEspera: Math.floor((ahora - c.reboteDesde!.getTime()) / DIA_MS),
    diasParaVencer: Math.max(0, Math.ceil((c.reboteVenceEl!.getTime() - ahora) / DIA_MS)),
    llamadas: _count.reboteLlamadas,
    ultimaLlamada: reboteLlamadas[0] ?? null,
  }));
}

/** Cita en rebote activo o 404 (para llamadas y descarte). */
async function citaEnRebote(citaId: string) {
  const cita = await prisma.cita.findFirst({ where: { id: citaId, ...REBOTE_ACTIVO } });
  if (!cita) throw new AppError('La cita no está en rebote', 404, 'NO_EN_REBOTE');
  return cita;
}

// ─── Llamadas ─────────────────────────────────────────────────────────────────
export async function registrarLlamada(
  citaId: string,
  datos: { resultado: (typeof RESULTADOS_LLAMADA)[number]; nota?: string | null; llamarDesde?: string | null },
  actor: Actor,
) {
  const cita = await citaEnRebote(citaId);
  return prisma.$transaction(async (tx) => {
    const ll = await tx.reboteLlamada.create({
      data: { citaId: cita.id, usuarioId: actor.usuarioId ?? null, resultado: datos.resultado, nota: datos.nota || null },
    });
    if (datos.llamarDesde !== undefined) {
      await tx.cita.update({ where: { id: cita.id }, data: { reboteLlamarDesde: datos.llamarDesde ? fechaDb(datos.llamarDesde) : null } });
    }
    await auditEnTx(tx, {
      citaId: cita.id, usuarioId: actor.usuarioId, accion: 'rebote_llamada', entidad: 'cita', entidadId: cita.id,
      despues: { resultado: datos.resultado, nota: datos.nota || null, ...(datos.llamarDesde !== undefined ? { llamarDesde: datos.llamarDesde } : {}) },
      sedeId: cita.sedeId, ip: actor.ip, userAgent: actor.userAgent,
    });
    return ll;
  });
}

export async function listarLlamadas(citaId: string) {
  return prisma.reboteLlamada.findMany({
    where: { citaId },
    orderBy: { creadoEn: 'desc' },
    select: { id: true, resultado: true, nota: true, creadoEn: true, usuario: { select: { id: true, nombre: true } } },
  });
}

// ─── Cerrar sin reagendar (descartar / vencer) ────────────────────────────────
async function cancelarRebote(
  citaId: string,
  resultado: 'descartada' | 'vencida',
  motivoCancelacion: string,
  actor: Actor,
): Promise<string[]> {
  const cita = await citaEnRebote(citaId);
  const grupo = cita.slotGrupoId
    ? await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, ...REBOTE_ACTIVO } })
    : [cita];
  const ahora = new Date();
  const cerradas: typeof grupo = [];
  await prisma.$transaction(async (tx) => {
    for (const c of grupo) {
      const r = await tx.cita.updateMany({
        where: { id: c.id, ...REBOTE_ACTIVO },
        data: { estado: 'cancelada', motivoCancelacion, reboteCerradoEn: ahora, reboteResultado: resultado },
      });
      if (r.count === 0) continue; // ya la cerró otro (reagendada o descartada a la vez)
      cerradas.push(c);
      await auditEnTx(tx, {
        citaId: c.id, usuarioId: actor.usuarioId, accion: resultado === 'vencida' ? 'rebote_vencido' : 'rebote_descartado',
        entidad: 'cita', entidadId: c.id,
        antes: { estado: 'reprogramada', reboteDesde: c.reboteDesde },
        despues: { estado: 'cancelada', motivoCancelacion },
        sedeId: c.sedeId, ip: actor.ip, userAgent: actor.userAgent,
      });
    }
  });
  for (const c of cerradas) await efectosSalidaAgenda(c, 'cancelada', actor.usuarioId);
  return cerradas.map((c) => c.id);
}

export async function descartarRebote(citaId: string, motivo: string, actor: Actor): Promise<string[]> {
  return cancelarRebote(citaId, 'descartada', `Rebote descartado: ${motivo}`, actor);
}

/**
 * Tarea periódica (cada 5 min, index.ts):
 *  1. Rebotes activos con más de DIAS_REBOTE días → cancelada («Rebote vencido»).
 *  2. Rebotes abiertos cuya cita ya salió de 'reprogramada' por otra vía (cancelada desde la agenda,
 *     movida por otra ruta) → se cierran con el resultado que corresponde, para no quedar colgados.
 */
export async function vencerRebotes(): Promise<number> {
  const ahora = new Date();
  const vencidas = await prisma.cita.findMany({
    where: { ...REBOTE_ACTIVO, reboteVenceEl: { lt: ahora }, OR: [{ slotRol: null }, { slotRol: 'PRINCIPAL' }] },
    select: { id: true },
  });
  let n = 0;
  for (const v of vencidas) {
    try {
      n += (await cancelarRebote(v.id, 'vencida', `Rebote vencido (${DIAS_REBOTE} días sin reagendar)`, {})).length;
    } catch (e) {
      if (!(e instanceof AppError && e.statusCode === 404)) console.error(`[rebote] no se pudo vencer la cita ${v.id}:`, e);
    }
  }

  const colgadas = await prisma.cita.findMany({
    where: { reboteDesde: { not: null }, reboteCerradoEn: null, NOT: { estado: 'reprogramada' } },
    select: { id: true, estado: true },
  });
  for (const c of colgadas) {
    await prisma.cita.updateMany({
      where: { id: c.id, reboteCerradoEn: null },
      data: { reboteCerradoEn: ahora, reboteResultado: c.estado === 'cancelada' ? 'descartada' : 'reagendada' },
    });
  }
  if (n) console.log(`[rebote] ${n} cita(s) canceladas por vencer el rebote`);
  return n;
}
