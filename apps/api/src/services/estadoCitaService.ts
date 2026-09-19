/**
 * Cambio de ESTADO de una cita — punto ÚNICO.
 *
 * Lo usan la ruta `PATCH /citas/:id/estado` (recepción) y el aparato del consultorio (botones
 * INICIO / FIN), para que ambos apliquen exactamente las mismas reglas:
 *  - máquina de estados (`TRANSICIONES_VALIDAS`) y el candado de revertir una atendida;
 *  - cascada al bloque combinado (salvo `soloEsta`);
 *  - anclas de tiempo (`llegoEn`, `enAtencionEn`, `completadaEn`) con la hora del evento;
 *  - escritura CON GUARDA: solo cambia si la cita sigue en el estado que se leyó. Si otro actor
 *    (recepción, el aparato o el autocompletado) la cambió entre la lectura y la escritura →
 *    409 `ESTADO_CAMBIADO`, así nunca se completa dos veces ni se disparan dos webhooks;
 *  - efectos posteriores (sesión del paquete, tiempo real, webhooks, Outlook, recordatorios,
 *    caché de disponibilidad y KPIs), en el mismo orden que antes.
 *
 * Se divide en `prepararTransicion` → `transicionarEnTx` → `efectosPostTransicion` para que el
 * aparato pueda escribir el estado DENTRO de su propia transacción (junto con el tiempo del
 * tratamiento) y lanzar los efectos después del commit.
 */
import { Cita, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { invalidateDisponibilidadCache } from '../redis';
import { AppError } from '../middleware/errorHandler';
import { emitirEventoCita } from '../socket';
import { auditEnTx } from './audit';
import { dispararWebhooks } from './webhooks';
import { agregarRango } from './agregacion';
import { sincronizarCitaOutlook } from './outlookCalendarService';
import { cancelarRecordatoriosDeCita } from './recordatorioService';
import { cancelarVideosDeCita } from './videoEnvioService';
import { sincronizarSesionPaquete } from './paqueteSesionService';
import { assertSinAtencionClinica } from './historiaClinicaService';
import { getCitaCompleta, crearComentarioEnTx, CitaCompleta } from './citaCompleta';

export const ESTADOS_FINALES = ['completada', 'no_show', 'cancelada'];

// Transiciones válidas: qué estados puede alcanzar cada estado actual
export const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  agendada:    ['confirmada', 'llego', 'no_show', 'cancelada'],
  confirmada:  ['llego', 'no_show', 'cancelada'],
  llego:       ['en_atencion', 'cancelada'],
  en_atencion: ['completada', 'no_show'],
  completada:  ['en_atencion'], // reversa de ATENDIDA (solo admin/coordinadora; reembolsa la sesión)
  no_show:     [],
  cancelada:   [],
  reprogramada: [],
};

export type EstadoDestino = 'agendada' | 'confirmada' | 'llego' | 'en_atencion' | 'completada' | 'no_show' | 'cancelada';

/** Quién pide el cambio. */
export interface ActorCambio {
  usuarioId?: string | null;
  permisos?: string[];
  /** Etiqueta del evento de tiempo real: el id del usuario, 'sistema' o 'dispositivo:<nombre>'. */
  cambiadoPor: string;
  ip?: string;
  userAgent?: string;
  /** Se suma al `despues` del audit (p. ej. `{ origen: 'dispositivo', dispositivo: 'C3 Lince' }`). */
  auditExtra?: Record<string, unknown>;
  /**
   * Acción con la que se audita en vez de `cambiar_estado` (p. ej. `cancelar_por_paciente` desde el
   * enlace del correo): la auditoría distingue el ORIGEN sin duplicar la lógica del cambio.
   */
  accion?: string;
}

export interface SolicitudCambio {
  citaId: string;
  estado: EstadoDestino;
  comentario?: string;
  motivoCancelacion?: string;
  /** Bloque combinado: avanza SOLO esta cita (flujo secuencial de 2 tratamientos). */
  soloEsta?: boolean;
  /** Hora real del evento (botón del aparato). Por defecto, ahora. */
  hora?: Date;
}

export interface PlanTransicion {
  cita: Cita;
  estado: EstadoDestino;
  cambioReal: boolean;
  esCancelacion: boolean;
  /** Re-enviar el mismo estado sin comentario ni motivo nuevo: no se escribe nada. */
  sinCambios: boolean;
  hermanas: Cita[];
  comentario?: string;
  motivoCancelacion?: string;
  hora: Date;
}

/** Valida la transición `actual → destino`. Mismo estado = permitido (solo agrega comentario). */
export function validarTransicion(actual: string, destino: string, permisos?: string[]): void {
  if (destino === actual) return;
  if (!(TRANSICIONES_VALIDAS[actual] ?? []).includes(destino)) {
    throw new AppError(`Transición inválida: ${actual} → ${destino}`, 400, 'TRANSICION_INVALIDA');
  }
  // Revertir una cita ATENDIDA (completada → en_atencion) es una acción sensible:
  // solo admin / coordinadora. El reembolso de la sesión lo hace el service único.
  if (actual === 'completada' && destino === 'en_atencion' && !permisos?.includes('citas.revertir')) {
    throw new AppError('No tienes permiso para revertir una cita ya atendida', 403, 'REVERSA_NO_PERMITIDA');
  }
}

// Bloque combinado: un cambio de estado se PROPAGA a las citas hermanas del grupo (mismo
// slotGrupoId) — son UNA sola visita física de 1 h (profilaxis + extra). Reglas:
//  - Nunca se resucita una hermana ya 'cancelada'.
//  - Al CANCELAR, no se tocan hermanas ya finalizadas (completada/no_show) — se respeta lo hecho.
//  - Para otros estados, la hermana solo se sincroniza si SU transición es válida en la
//    máquina de estados (una hermana en no_show NO se resucita a completada; una desfasada
//    no salta pasos — se queda como está en vez de forzarla).
export function hermanasQueAcompanan<T extends { estado: string }>(hermanas: T[], estado: string): T[] {
  const esCancelacion = estado === 'cancelada';
  return hermanas.filter((c) =>
    c.estado !== estado &&
    c.estado !== 'cancelada' &&
    (esCancelacion
      ? !ESTADOS_FINALES.includes(c.estado)
      : (TRANSICIONES_VALIDAS[c.estado] ?? []).includes(estado)));
}

// Anclas del auto-completado y de la medición de tiempos (solo en cambios REALES; comentar sin
// cambiar no reinicia):
//  • `llegoEn`      → red de seguridad de 90 min para citas que se quedan en 'llego'.
//  • `enAtencionEn` → ancla PRINCIPAL: al entrar (o re-entrar) a 'en_atencion' arranca el reloj
//     de "duración + 15 min" tras el cual la cita pasa sola a 'completada'.
//  • `completadaEn` → se sella al entrar a 'completada'; se limpia si se revierte.
export function anclasDeTiempo(actual: string, estado: string, hora: Date) {
  if (actual === estado) return {};
  const reiniciaLlegoEn = estado === 'llego' || (actual === 'completada' && estado === 'en_atencion');
  return {
    ...(reiniciaLlegoEn ? { llegoEn: hora } : {}),
    ...(estado === 'en_atencion' ? { enAtencionEn: hora } : {}),
    ...(estado === 'completada' ? { completadaEn: hora } : {}),
    ...(actual === 'completada' && estado !== 'completada' ? { completadaEn: null } : {}),
  };
}

/** Lee la cita, valida y arma el plan del cambio (sin escribir). */
export async function prepararTransicion(
  sol: SolicitudCambio,
  actor: Pick<ActorCambio, 'permisos'>,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PlanTransicion> {
  const cita = await client.cita.findUnique({ where: { id: sol.citaId, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  validarTransicion(cita.estado, sol.estado, actor.permisos);

  const esCancelacion = sol.estado === 'cancelada';
  const cambioReal = sol.estado !== cita.estado;
  // Historia clínica: una cita con atención registrada fue atendida de verdad → no se cancela ni se
  // marca "no vino" (409 CITA_CON_ATENCION_CLINICA). Único punto donde la agenda consulta a la HC.
  if (cambioReal && (esCancelacion || sol.estado === 'no_show')) await assertSinAtencionClinica(cita.id);

  // Solo cascadea un CAMBIO REAL (re-enviar el mismo estado para comentar NO mueve a las hermanas
  // ni re-consume sesiones). `soloEsta` desactiva la cascada.
  const hermanas = (cita.slotGrupoId && cambioReal && !sol.soloEsta)
    ? hermanasQueAcompanan(
        await client.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, id: { not: cita.id }, deletedAt: null } }),
        sol.estado,
      )
    : [];

  const comentario = sol.comentario?.trim() || undefined;
  const motivoNuevo = sol.motivoCancelacion != null && sol.motivoCancelacion !== cita.motivoCancelacion;
  return {
    cita,
    estado: sol.estado,
    cambioReal,
    esCancelacion,
    sinCambios: !cambioReal && !comentario && !motivoNuevo,
    hermanas,
    comentario,
    motivoCancelacion: sol.motivoCancelacion,
    hora: sol.hora ?? new Date(),
  };
}

/**
 * Escribe el cambio DENTRO de `tx`: la cita (con guarda de estado), su audit, el comentario y la
 * cascada a las hermanas. Devuelve las hermanas que de verdad cambiaron.
 */
export async function transicionarEnTx(tx: Prisma.TransactionClient, plan: PlanTransicion, actor: ActorCambio): Promise<Cita[]> {
  if (plan.sinCambios) return [];
  const { cita, estado } = plan;
  const anclas = anclasDeTiempo(cita.estado, estado, plan.hora);
  const r = await tx.cita.updateMany({
    where: { id: cita.id, estado: cita.estado, deletedAt: null },
    data: { estado, motivoCancelacion: plan.motivoCancelacion ?? cita.motivoCancelacion, ...anclas },
  });
  if (r.count === 0) {
    throw new AppError('La cita cambió de estado mientras tanto. Actualiza la agenda y vuelve a intentar.', 409, 'ESTADO_CAMBIADO');
  }
  await auditEnTx(tx, {
    citaId: cita.id,
    usuarioId: actor.usuarioId ?? undefined,
    accion: actor.accion ?? 'cambiar_estado',
    entidad: 'cita',
    entidadId: cita.id,
    antes: { estado: cita.estado, ...(plan.esCancelacion && cita.motivoCancelacion ? { motivoCancelacion: cita.motivoCancelacion } : {}) },
    despues: { estado, ...(plan.esCancelacion && plan.motivoCancelacion ? { motivoCancelacion: plan.motivoCancelacion } : {}), ...actor.auditExtra },
    sedeId: cita.sedeId,
    ip: actor.ip, userAgent: actor.userAgent,
  });
  // Comentario opcional del cambio de estado → entrada del hilo append-only.
  if (plan.comentario) {
    await crearComentarioEnTx(tx, { citaId: cita.id, sedeId: cita.sedeId, autorId: actor.usuarioId ?? null, texto: plan.comentario, ip: actor.ip, userAgent: actor.userAgent });
  }
  // Cascada del bloque combinado: aplicar EL MISMO estado a las hermanas del grupo. Si una hermana
  // cambió entre la lectura y ahora, se deja como está (no se pisa lo que hizo otro).
  const aplicadas: Cita[] = [];
  for (const h of plan.hermanas) {
    const rh = await tx.cita.updateMany({
      where: { id: h.id, estado: h.estado, deletedAt: null },
      data: { estado, ...anclas, ...(plan.esCancelacion ? { motivoCancelacion: plan.motivoCancelacion ?? h.motivoCancelacion } : {}) },
    });
    if (rh.count === 0) continue;
    await auditEnTx(tx, {
      citaId: h.id, usuarioId: actor.usuarioId ?? undefined, accion: actor.accion ?? 'cambiar_estado', entidad: 'cita', entidadId: h.id,
      antes: { estado: h.estado }, despues: { estado, ...(plan.esCancelacion && plan.motivoCancelacion ? { motivoCancelacion: plan.motivoCancelacion } : {}), slotGrupoId: cita.slotGrupoId, cascada: true, ...actor.auditExtra },
      sedeId: h.sedeId, ip: actor.ip, userAgent: actor.userAgent,
    });
    aplicadas.push(h);
  }
  return aplicadas;
}

/** Efectos DESPUÉS del commit (mismo orden que antes del refactor). Devuelve la cita completa. */
export async function efectosPostTransicion(plan: PlanTransicion, aplicadas: Cita[], actor: ActorCambio): Promise<CitaCompleta | null> {
  const { cita, estado, esCancelacion, cambioReal } = plan;
  if (plan.sinCambios) return getCitaCompleta(cita.id);

  // Conteo de sesiones: punto ÚNICO e idempotente. Consume 1 sesión solo si quedó
  // en 'completada' (y aún no consumió); reembolsa si se revirtió. no_show/cancelada → 0.
  await sincronizarSesionPaquete(cita.id);

  // Side-effects de las hermanas sincronizadas en cascada. El conteo de sesiones se
  // recalcula SIEMPRE (consume al completar el extra, reembolsa si se revierte). Los
  // webhooks/Outlook siguen las MISMAS reglas que la cita principal — las integraciones
  // externas también deben enterarse del servicio extra del bloque.
  for (const h of aplicadas) {
    await sincronizarSesionPaquete(h.id);
    if (esCancelacion) {
      void sincronizarCitaOutlook('cancelar', h.id);
      void cancelarRecordatoriosDeCita(h.id);
      void cancelarVideosDeCita(h.id);
      await dispararWebhooks('appointment.cancelled', h.sedeId, await getCitaCompleta(h.id));
      emitirEventoCita({
        tipo: 'cita:cancelada', sedeId: h.sedeId, fecha: h.fecha.toISOString().split('T')[0]!,
        cita: { id: h.id, estado: 'cancelada' } as never, cambiadoPor: actor.cambiadoPor,
      });
    } else {
      if (['no_show', 'reprogramada'].includes(estado)) { void cancelarRecordatoriosDeCita(h.id); void cancelarVideosDeCita(h.id); }
      if (estado === 'confirmada') void sincronizarCitaOutlook('crear', h.id);
      const hCompleta = await getCitaCompleta(h.id);
      if (estado === 'completada') await dispararWebhooks('appointment.completed', h.sedeId, hCompleta);
      emitirEventoCita({
        tipo: 'cita:estadoCambiado', sedeId: h.sedeId, fecha: h.fecha.toISOString().split('T')[0]!,
        cita: hCompleta as never, cambiadoPor: actor.cambiadoPor,
      });
    }
  }

  const citaCompleta = await getCitaCompleta(cita.id);
  const fecha = cita.fecha.toISOString().split('T')[0]!;

  emitirEventoCita({
    tipo: 'cita:estadoCambiado',
    sedeId: cita.sedeId,
    fecha,
    cita: citaCompleta as never,
    cambiadoPor: actor.cambiadoPor,
  });

  // Webhooks solo en un cambio REAL: re-enviar "completada" para comentar no re-anuncia la atención.
  if (cambioReal && estado === 'completada') {
    await dispararWebhooks('appointment.completed', cita.sedeId, citaCompleta);
  }
  if (cambioReal && estado === 'cancelada') {
    await dispararWebhooks('appointment.cancelled', cita.sedeId, citaCompleta);
  }

  // Outlook (no bloqueante): cancelada → eliminar evento; confirmada → asegurar/crear evento.
  if (estado === 'cancelada') void sincronizarCitaOutlook('cancelar', cita.id);
  else if (estado === 'confirmada') void sincronizarCitaOutlook('crear', cita.id);

  // Recordatorio: si la cita pasa a un estado inactivo, cancelar el envío programado.
  if (['cancelada', 'no_show', 'reprogramada'].includes(estado)) { void cancelarRecordatoriosDeCita(cita.id); void cancelarVideosDeCita(cita.id); }

  // Un slot LIBERADO (cancelación) debe volver a ofrecerse de inmediato: sin esto, la
  // caché de disponibilidad seguía mostrando la hora como ocupada hasta expirar.
  if (esCancelacion && cambioReal) {
    await invalidateDisponibilidadCache(cita.sedeId, fecha);
  }

  // Reagregar en background sin bloquear la respuesta
  const fechaCita = cita.fecha;
  setImmediate(() => {
    const d = new Date(fechaCita); d.setHours(0, 0, 0, 0);
    const h = new Date(fechaCita); h.setHours(23, 59, 59, 999);
    agregarRango(d, h).catch(() => {/* silencioso */});
  });

  return citaCompleta;
}

/** Cambio de estado completo: prepara, escribe en su transacción y lanza los efectos. */
export async function cambiarEstadoCita(sol: SolicitudCambio, actor: ActorCambio): Promise<CitaCompleta | null> {
  const plan = await prepararTransicion(sol, actor);
  const aplicadas = await prisma.$transaction((tx) => transicionarEnTx(tx, plan, actor));
  return efectosPostTransicion(plan, aplicadas, actor);
}
