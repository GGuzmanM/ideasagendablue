/**
 * Tiempo REAL de cada tratamiento, medido con el aparato del consultorio (botones INICIO / FIN).
 *
 *  INICIO → busca la cita del consultorio (hoy, «Llegó» o «En atención», ver `elegirCita`), abre un
 *           `TiempoTratamiento` y pasa la cita a «En atención» con la hora del botón. Sin cita que
 *           corresponda NO se inicia nada: la pantalla avisa (sin cita asignada, o falta «Llegó»).
 *  FIN    → cierra el tiempo en curso del consultorio. Menos de 1 minuto = anulado (la cita no se
 *           toca). Si no, la cita pasa a «Completada» con la hora del botón (si ya estaba completada,
 *           se corrige su hora y queda auditado).
 *
 * Todo ocurre en UNA transacción con un candado por consultorio (dos botones seguidos se atienden en
 * orden). El cambio de estado usa el servicio único (estadoCitaService) con escritura con guarda: si
 * recepción cambió la cita en el mismo instante, se reintenta leyendo el estado nuevo. Cada botón
 * queda en `EventoDispositivo` con la respuesta enviada: un reenvío del mismo `idEvento` devuelve lo
 * mismo sin repetir nada.
 */
import { Cita, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { DispositivoAutenticado } from '../middleware/authDispositivo';
import { emitirEventoCita, emitirTiemposActualizados } from '../socket';
import { fechaDb, hoyLimaStr, fechaAStr } from '../utils/fechaLima';
import { auditEnTx } from './audit';
import { getCitaCompleta } from './citaCompleta';
import { prepararTransicion, transicionarEnTx, efectosPostTransicion, PlanTransicion, ActorCambio } from './estadoCitaService';
import {
  MIN_DURACION_S, MAX_ABIERTO_MIN, PANTALLA, ResultadoEvento,
  resolverHoraBoton, elegirCita, nombreCorto, horaLima, minutosLima, numeroTratamiento,
} from './tiempoReglas';

type Tx = Prisma.TransactionClient;

export interface EventoAparato {
  idEvento: string;
  accion: 'inicio' | 'fin';
  edadMs?: number;
  presionadoEn?: string;
  ntp?: boolean;
  fw?: string;
}

export interface TiempoDto {
  id: string; inicioEn: string; finEn: string | null; duracionSegundos: number | null; estado: string;
}

export interface RespuestaAparato {
  resultado: ResultadoEvento;
  lcd: [string, string];
  tiempo: TiempoDto | null;
  cita: { id: string; paciente: string; hora: string; tratamiento: 1 | 2 | null } | null;
  servidorEn: string;
}

interface Procesado {
  respuesta: RespuestaAparato;
  fecha: string;
  plan?: PlanTransicion;
  aplicadas?: Cita[];
  /** Cita a la que solo se le corrigió la hora (sin cambio de estado) → avisar a la agenda. */
  citaAjustadaId?: string;
}

const actorDe = (d: DispositivoAutenticado, fw?: string): ActorCambio => ({
  usuarioId: null,
  permisos: [],
  cambiadoPor: `dispositivo:${d.nombre}`,
  userAgent: fw ? `aparato-consultorio/${fw}` : 'aparato-consultorio',
  auditExtra: { origen: 'dispositivo', dispositivo: d.nombre, dispositivoId: d.id },
});

const tiempoDto = (t: { id: string; inicioEn: Date; finEn: Date | null; duracionSegundos: number | null; estado: string }): TiempoDto => ({
  id: t.id, inicioEn: t.inicioEn.toISOString(), finEn: t.finEn?.toISOString() ?? null, duracionSegundos: t.duracionSegundos, estado: t.estado,
});

const citaSelect = {
  id: true, estado: true, horaInicio: true, slotGrupoId: true, slotRol: true, sedeId: true, fecha: true,
  paciente: { select: { nombres: true, apellidoPaterno: true } },
} as const;
type CitaResumen = Prisma.CitaGetPayload<{ select: typeof citaSelect }>;

const citaDto = (c: CitaResumen) => ({
  id: c.id, paciente: nombreCorto(c.paciente.nombres, c.paciente.apellidoPaterno), hora: c.horaInicio, tratamiento: numeroTratamiento(c),
});

/** Candado por consultorio dentro de la transacción (se libera al commit/rollback). */
async function bloquearConsultorio(tx: Tx, d: DispositivoAutenticado) {
  const clave = `consultorio:${d.sedeId}:${d.unidadNegocioId}:${d.consultorioNumero}`;
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${clave}))) AS candado`;
}

async function tiempoEnCurso(client: Tx | typeof prisma, d: DispositivoAutenticado) {
  return client.tiempoTratamiento.findFirst({
    where: { sedeId: d.sedeId, unidadNegocioId: d.unidadNegocioId, consultorioNumero: d.consultorioNumero, estado: 'en_curso', deletedAt: null },
    include: { cita: { select: citaSelect } },
  });
}

/**
 * Citas de HOY del consultorio del aparato: las que tienen ese consultorio asignado y sus hermanas de
 * bloque (recepción suele marcar el consultorio en una sola de las dos).
 */
async function citasDelConsultorio(tx: Tx | typeof prisma, d: DispositivoAutenticado, fecha: Date) {
  const asignadas = await tx.cita.findMany({
    where: { sedeId: d.sedeId, unidadNegocioId: d.unidadNegocioId, fecha, consultorioNumero: d.consultorioNumero, deletedAt: null },
    select: { id: true, slotGrupoId: true },
  });
  if (!asignadas.length) return [];
  const grupos = [...new Set(asignadas.map((c) => c.slotGrupoId).filter((g): g is string => !!g))];
  const citas = await tx.cita.findMany({
    where: {
      deletedAt: null, estado: { in: ['llego', 'en_atencion'] },
      OR: [{ id: { in: asignadas.map((c) => c.id) } }, ...(grupos.length ? [{ slotGrupoId: { in: grupos } }] : [])],
    },
    select: citaSelect,
  });
  const medidas = await tx.tiempoTratamiento.findMany({
    where: { citaId: { in: citas.map((c) => c.id) }, estado: { not: 'descartado' }, deletedAt: null },
    select: { citaId: true },
  });
  const conTiempo = new Set(medidas.map((m) => m.citaId));
  return citas.map((c) => ({ ...c, tieneTiempo: conTiempo.has(c.id) }));
}

/** Cita de hoy con ese consultorio que aún no llegó (agendada/confirmada), la de hora más cercana. */
async function citaPorLlegar(client: Tx | typeof prisma, d: DispositivoAutenticado, fecha: Date, ahoraMin: number) {
  const citas = await client.cita.findMany({
    where: {
      sedeId: d.sedeId, unidadNegocioId: d.unidadNegocioId, fecha, consultorioNumero: d.consultorioNumero,
      deletedAt: null, estado: { in: ['agendada', 'confirmada'] },
    },
    select: citaSelect,
  });
  const distancia = (h: string) => { const [a, b] = h.split(':').map(Number); return Math.abs((a ?? 0) * 60 + (b ?? 0) - ahoraMin); };
  return citas.sort((x, y) => distancia(x.horaInicio) - distancia(y.horaInicio))[0] ?? null;
}

const nombreDe = (c: CitaResumen) => nombreCorto(c.paciente.nombres, c.paciente.apellidoPaterno);

async function iniciar(tx: Tx, d: DispositivoAutenticado, ev: EventoAparato, hora: Date, aproximada: boolean): Promise<Procesado> {
  const fechaStr = hoyLimaStr(hora);
  const abierto = await tiempoEnCurso(tx, d);
  if (abierto) {
    return {
      fecha: fechaStr,
      respuesta: {
        resultado: 'ya_en_curso', lcd: PANTALLA.yaEnCurso(horaLima(abierto.inicioEn)), tiempo: tiempoDto(abierto),
        cita: abierto.cita ? citaDto(abierto.cita) : null, servidorEn: new Date().toISOString(),
      },
    };
  }

  const fecha = fechaDb(fechaStr);
  const candidatas = await citasDelConsultorio(tx, d, fecha);
  const elegida = elegirCita(candidatas, minutosLima(hora));
  const base = { fecha: fechaStr };
  // Sin cita que corresponda NO se inicia nada: ni tiempo ni cambio de estado (el botón solo queda en
  // la bitácora). La pantalla dice por qué: recepción aún no marcó «Llegó», o no hay cita con ese
  // consultorio. Así un botón apretado por casualidad no deja tiempos sueltos.
  if (!elegida) {
    const porLlegar = await citaPorLlegar(tx, d, fecha, minutosLima(hora));
    return {
      ...base,
      respuesta: {
        resultado: porLlegar ? 'sin_llegada' : 'sin_cita', lcd: porLlegar ? PANTALLA.sinLlegada() : PANTALLA.sinCita(),
        tiempo: null, cita: null, servidorEn: new Date().toISOString(),
      },
    };
  }

  const tiempo = await tx.tiempoTratamiento.create({
    data: {
      dispositivoId: d.id, sedeId: d.sedeId, unidadNegocioId: d.unidadNegocioId, consultorioNumero: d.consultorioNumero,
      fecha, citaId: elegida.id, inicioEn: hora, horaAproximada: aproximada,
    },
  });
  await auditEnTx(tx, {
    citaId: elegida.id, accion: 'iniciar_tiempo_tratamiento', entidad: 'tiempo_tratamiento', entidadId: tiempo.id, sedeId: d.sedeId,
    despues: { inicioEn: hora, consultorioNumero: d.consultorioNumero, horaAproximada: aproximada, ...actorDe(d, ev.fw).auditExtra },
  });

  const respuesta: RespuestaAparato = {
    resultado: 'iniciado',
    lcd: PANTALLA.iniciado(nombreCorto(elegida.paciente.nombres, elegida.paciente.apellidoPaterno), elegida.horaInicio, numeroTratamiento(elegida)),
    tiempo: tiempoDto(tiempo), cita: citaDto(elegida), servidorEn: new Date().toISOString(),
  };
  if (elegida.estado === 'llego') {
    const actor = actorDe(d, ev.fw);
    const plan = await prepararTransicion({ citaId: elegida.id, estado: 'en_atencion', soloEsta: true, hora }, actor, tx);
    const aplicadas = await transicionarEnTx(tx, plan, actor);
    return { ...base, respuesta, plan, aplicadas };
  }
  // Recepción ya la había puesto «En atención»: el tratamiento empieza de verdad con el botón.
  const r = await tx.cita.updateMany({ where: { id: elegida.id, estado: 'en_atencion', deletedAt: null }, data: { enAtencionEn: hora } });
  if (r.count === 0) throw new AppError('La cita cambió de estado mientras tanto', 409, 'ESTADO_CAMBIADO');
  await auditEnTx(tx, {
    citaId: elegida.id, accion: 'ajustar_hora_atencion', entidad: 'cita', entidadId: elegida.id, sedeId: d.sedeId,
    despues: { enAtencionEn: hora, ...actorDe(d, ev.fw).auditExtra },
  });
  return { ...base, respuesta, citaAjustadaId: elegida.id };
}

async function finalizar(tx: Tx, d: DispositivoAutenticado, ev: EventoAparato, hora: Date): Promise<Procesado> {
  const abierto = await tiempoEnCurso(tx, d);
  if (!abierto) {
    return {
      fecha: hoyLimaStr(hora),
      respuesta: { resultado: 'sin_inicio', lcd: PANTALLA.sinInicio(), tiempo: null, cita: null, servidorEn: new Date().toISOString() },
    };
  }
  const fecha = fechaAStr(abierto.fecha);
  const segundos = Math.max(0, Math.round((hora.getTime() - abierto.inicioEn.getTime()) / 1000));
  const anulado = segundos < MIN_DURACION_S;
  const tiempo = await tx.tiempoTratamiento.update({
    where: { id: abierto.id },
    data: anulado
      ? { estado: 'descartado', finEn: hora, duracionSegundos: segundos, motivoDescarte: 'FIN antes de 1 minuto' }
      : { estado: 'finalizado', finEn: hora, duracionSegundos: segundos },
  });
  const extra = actorDe(d, ev.fw).auditExtra;
  await auditEnTx(tx, {
    citaId: abierto.citaId ?? undefined, accion: anulado ? 'anular_tiempo_tratamiento' : 'finalizar_tiempo_tratamiento',
    entidad: 'tiempo_tratamiento', entidadId: abierto.id, sedeId: d.sedeId,
    antes: { estado: 'en_curso' }, despues: { estado: tiempo.estado, finEn: hora, duracionSegundos: segundos, ...extra },
  });
  const cita = abierto.cita;
  const citaResp = citaDto(cita);
  const servidorEn = new Date().toISOString();

  if (anulado) {
    return { fecha, respuesta: { resultado: 'anulado', lcd: PANTALLA.anulado(), tiempo: tiempoDto(tiempo), cita: citaResp, servidorEn } };
  }

  // ¿Queda el otro tratamiento del bloque? → la pantalla lo pide.
  const tratamiento = numeroTratamiento(cita);
  let lcd = PANTALLA.finalizado(segundos);
  if (cita.slotGrupoId && tratamiento) {
    const pendiente = await tx.cita.findFirst({
      where: {
        slotGrupoId: cita.slotGrupoId, id: { not: cita.id }, deletedAt: null, estado: { in: ['llego', 'en_atencion'] },
        tiemposTratamiento: { none: { estado: { not: 'descartado' }, deletedAt: null } },
      },
      select: { slotRol: true },
    });
    if (pendiente) lcd = PANTALLA.finalizadoBloque(tratamiento, segundos, pendiente.slotRol === 'SECUNDARIO' ? 2 : 1);
  }
  const respuesta: RespuestaAparato = { resultado: 'finalizado', lcd, tiempo: tiempoDto(tiempo), cita: citaResp, servidorEn };

  // Estado de la cita AHORA (no el leído al abrir el tiempo).
  const actual = await tx.cita.findUnique({ where: { id: cita.id }, select: { estado: true, completadaEn: true, deletedAt: true } });
  if (!actual || actual.deletedAt) return { fecha, respuesta };
  if (actual.estado === 'en_atencion') {
    const actor = actorDe(d, ev.fw);
    const plan = await prepararTransicion({ citaId: cita.id, estado: 'completada', soloEsta: true, hora }, actor, tx);
    const aplicadas = await transicionarEnTx(tx, plan, actor);
    return { fecha, respuesta, plan, aplicadas };
  }
  if (actual.estado === 'completada') {
    // Recepción o el autocompletado se adelantaron: manda la hora del aparato.
    await tx.cita.update({ where: { id: cita.id }, data: { completadaEn: hora } });
    await auditEnTx(tx, {
      citaId: cita.id, accion: 'ajustar_hora_completada', entidad: 'cita', entidadId: cita.id, sedeId: d.sedeId,
      antes: { completadaEn: actual.completadaEn }, despues: { completadaEn: hora, ...extra },
    });
    return { fecha, respuesta, citaAjustadaId: cita.id };
  }
  // Otro estado (la revirtieron a «Llegó», la cancelaron…): el tiempo queda guardado, la cita no se toca.
  return { fecha, respuesta };
}

function reintentable(e: unknown): boolean {
  if (e instanceof AppError) return e.code === 'ESTADO_CAMBIADO';
  const code = (e as { code?: string })?.code;
  return code === 'P2002' || code === 'P2034'; // choque de unicidad (carrera) o conflicto de serialización
}

/** Procesa un botón del aparato. Siempre devuelve la respuesta para su pantalla. */
export async function procesarEvento(d: DispositivoAutenticado, ev: EventoAparato, meta: { ip?: string }): Promise<RespuestaAparato> {
  const recibidoEn = new Date();
  const { hora, aproximada } = resolverHoraBoton({ recibidoEn, edadMs: ev.edadMs, presionadoEn: ev.presionadoEn, ntp: ev.ntp });

  for (let intento = 1; ; intento++) {
    const previo = await prisma.eventoDispositivo.findUnique({ where: { dispositivoId_idEvento: { dispositivoId: d.id, idEvento: ev.idEvento } } });
    if (previo?.respuesta) return previo.respuesta as unknown as RespuestaAparato;
    try {
      const p = await prisma.$transaction(async (tx) => {
        await bloquearConsultorio(tx, d);
        const r = ev.accion === 'inicio' ? await iniciar(tx, d, ev, hora, aproximada) : await finalizar(tx, d, ev, hora);
        await tx.eventoDispositivo.create({
          data: {
            dispositivoId: d.id, idEvento: ev.idEvento, accion: ev.accion, presionadoEn: hora, recibidoEn, edadMs: ev.edadMs ?? null,
            horaAproximada: aproximada, resultado: r.respuesta.resultado, tiempoId: r.respuesta.tiempo?.id ?? null,
            citaId: r.respuesta.cita?.id ?? null, respuesta: r.respuesta as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.dispositivoConsultorio.update({
          where: { id: d.id }, data: { ultimoContacto: recibidoEn, ultimaIp: meta.ip ?? null, ...(ev.fw ? { firmware: ev.fw } : {}) },
        });
        return r;
      }, { timeout: 15_000 });
      await despuesDelCommit(d, p, ev.fw);
      return p.respuesta;
    } catch (e) {
      if (intento >= 3 || !reintentable(e)) throw e;
    }
  }
}

async function despuesDelCommit(d: DispositivoAutenticado, p: Procesado, fw?: string) {
  try {
    if (p.plan) await efectosPostTransicion(p.plan, p.aplicadas ?? [], actorDe(d, fw));
    if (p.citaAjustadaId) {
      const c = await getCitaCompleta(p.citaAjustadaId);
      if (c) emitirEventoCita({ tipo: 'cita:actualizada', sedeId: c.sedeId, fecha: fechaAStr(c.fecha), cita: c as never, cambiadoPor: `dispositivo:${d.nombre}` });
    }
  } catch (e) {
    // El botón YA quedó guardado; un fallo de un efecto (webhook, KPIs) no debe devolverle error al aparato.
    console.error('[aparato] efecto posterior falló:', e instanceof Error ? e.message : e);
  }
  emitirTiemposActualizados({ sedeId: d.sedeId, fecha: p.fecha, tiempoId: p.respuesta.tiempo?.id ?? null, citaId: p.respuesta.cita?.id ?? null, resultado: p.respuesta.resultado });
}

/**
 * Latido (cada 15 s en reposo, cada 60 s con un tratamiento en curso, y al encender): marca «en línea»
 * y devuelve la pantalla: el tratamiento en curso (para retomar el cronómetro) o quién sigue.
 */
export async function registrarLatido(d: DispositivoAutenticado, datos: { fw?: string; rssi?: number; ip?: string }) {
  const ahora = new Date();
  await prisma.dispositivoConsultorio.update({
    where: { id: d.id },
    data: { ultimoContacto: ahora, ultimaIp: datos.ip ?? null, ...(datos.fw ? { firmware: datos.fw } : {}), ...(datos.rssi != null ? { rssi: datos.rssi } : {}) },
  });
  const abierto = await tiempoEnCurso(prisma, d);
  const base = { servidorEn: ahora.toISOString(), consultorio: d.consultorioNumero };
  if (abierto) {
    return {
      ...base,
      enCurso: {
        tiempo: tiempoDto(abierto),
        transcurridoSegundos: Math.max(0, Math.round((ahora.getTime() - abierto.inicioEn.getTime()) / 1000)),
        cita: citaDto(abierto.cita),
      },
      siguiente: null,
      porLlegar: null,
      lcd: PANTALLA.enCurso(nombreDe(abierto.cita)),
    };
  }
  // En reposo: quién sigue, con la MISMA regla que usará INICIO (`elegirCita`), para que la podóloga
  // vea antes de presionar si la cita ya está lista; o que la cita existe pero falta «Llegó».
  const fecha = fechaDb(hoyLimaStr(ahora));
  const ahoraMin = minutosLima(ahora);
  const siguiente = elegirCita(await citasDelConsultorio(prisma, d, fecha), ahoraMin);
  const porLlegar = siguiente ? null : await citaPorLlegar(prisma, d, fecha, ahoraMin);
  return {
    ...base,
    enCurso: null,
    siguiente: siguiente ? citaDto(siguiente) : null,
    porLlegar: porLlegar ? citaDto(porLlegar) : null,
    lcd: siguiente ? PANTALLA.siguiente(nombreDe(siguiente), numeroTratamiento(siguiente))
      : porLlegar ? PANTALLA.porLlegar(nombreDe(porLlegar))
      : PANTALLA.disponible(d.consultorioNumero),
  };
}

/**
 * Cierra como «sin fin» los tiempos abiertos hace más de 3 h o de días anteriores (nadie presionó
 * FIN). Corre junto al autocompletado (cada 5 min), ANTES que él: así, en esa misma vuelta, la cita
 * vuelve a quedar a cargo del autocompletado por tiempo.
 */
export async function cerrarTiemposAbandonados(ahora: Date = new Date()): Promise<number> {
  const limite = new Date(ahora.getTime() - MAX_ABIERTO_MIN * 60_000);
  const abiertos = await prisma.tiempoTratamiento.findMany({
    where: { estado: 'en_curso', deletedAt: null, OR: [{ inicioEn: { lt: limite } }, { fecha: { lt: fechaDb(hoyLimaStr(ahora)) } }] },
    select: { id: true, sedeId: true, fecha: true, citaId: true, inicioEn: true },
  });
  let cerrados = 0;
  for (const t of abiertos) {
    const ok = await prisma.$transaction(async (tx) => {
      const r = await tx.tiempoTratamiento.updateMany({ where: { id: t.id, estado: 'en_curso' }, data: { estado: 'sin_fin' } });
      if (r.count === 0) return false;
      await auditEnTx(tx, {
        citaId: t.citaId ?? undefined, accion: 'cerrar_tiempo_sin_fin', entidad: 'tiempo_tratamiento', entidadId: t.id, sedeId: t.sedeId,
        antes: { estado: 'en_curso' }, despues: { estado: 'sin_fin', motivo: `sin FIN en ${MAX_ABIERTO_MIN / 60} h o de un día anterior` },
      });
      return true;
    });
    if (!ok) continue;
    cerrados++;
    emitirTiemposActualizados({ sedeId: t.sedeId, fecha: fechaAStr(t.fecha), tiempoId: t.id, citaId: t.citaId, resultado: 'sin_fin' });
  }
  if (cerrados) console.log(`[tiempos] ${cerrados} tratamiento(s) sin FIN cerrados`);
  return cerrados;
}
