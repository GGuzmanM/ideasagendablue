/**
 * Scheduler en la BD (modo COLA_MODO="db", sin Redis). Reemplaza a BullMQ con dos temporizadores:
 *
 *  - Recordatorios: cada POLL_RECORDATORIOS_MS busca en `recordatorios_cita` los PROGRAMADO cuyo
 *    `programadoPara` ya venció y los envía. Reusa EXACTAMENTE las mismas funciones que usaba el
 *    worker (`procesarEnvioReserva` / `procesarEnvioRecordatorio`), que son idempotentes (saltan si
 *    ya está ENVIADO), difieren por cuota (mueven `programadoPara` al futuro) y cuentan `intentos`.
 *    Cubre el Correo 2 y también los reintentos/diferidos del Correo 1.
 *
 *  - Videos: cada POLL_VIDEOS_MS ejecuta el mismo barrido que corría el job repetible de BullMQ
 *    (`procesarBarridoVideos`).
 *
 * Quien ENVÍA es Resend; esto solo decide CUÁNDO. Pensado para 1 instancia: un guard `corriendo*`
 * evita solapar ticks; el estado en la BD (índice [estado, programadoPara]) es la fuente de verdad.
 */
import { prisma } from '../db';
import { procesarEnvioReserva, procesarEnvioRecordatorio } from '../services/recordatorioService';
import { procesarBarridoVideos } from '../services/videoEnvioService';
import { RECORDATORIOS_ACTIVOS } from './recordatorioQueue';
import { VIDEOS_SERVICIO_ACTIVOS } from './videoQueue';

const POLL_RECORDATORIOS_MS = 30_000;   // revisa correos vencidos cada 30 s
const POLL_VIDEOS_MS = 5 * 60_000;      // barrido de videos cada 5 min (igual que BullMQ)
const LOTE = 50;                        // máx correos por tick (evita ráfagas; el resto va al siguiente)

let tRecord: ReturnType<typeof setInterval> | null = null;
let tVideos: ReturnType<typeof setInterval> | null = null;
let corriendoRecord = false;
let corriendoVideos = false;

async function tickRecordatorios(): Promise<void> {
  if (corriendoRecord) return; // no solapar ticks (un envío lento no dispara dos veces la misma fila)
  corriendoRecord = true;
  try {
    const pendientes = await prisma.recordatorioCita.findMany({
      where: { estado: 'PROGRAMADO', deletedAt: null, programadoPara: { lte: new Date() } },
      orderBy: { programadoPara: 'asc' },
      take: LOTE,
      select: { id: true, citaId: true, tipo: true },
    });
    for (const r of pendientes) {
      try {
        if (r.tipo === 'RESERVA') await procesarEnvioReserva(r.citaId);
        else if (r.tipo === 'RECORDATORIO') await procesarEnvioRecordatorio(r.citaId, 'auto');
      } catch (e) {
        // procesarEnvioRecordatorio relanza en fallo transitorio; ya dejó estado/intentos en la BD,
        // así que el próximo tick reintenta (hasta MAX_INTENTOS → FALLIDO). Solo lo registramos.
        console.warn(`[scheduler] envío ${r.tipo} cita ${r.citaId} falló:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.warn('[scheduler] tick recordatorios falló:', e instanceof Error ? e.message : e);
  } finally {
    corriendoRecord = false;
  }
}

async function tickVideos(): Promise<void> {
  if (corriendoVideos) return;
  corriendoVideos = true;
  try {
    await procesarBarridoVideos();
  } catch (e) {
    console.warn('[scheduler] barrido de videos falló:', e instanceof Error ? e.message : e);
  } finally {
    corriendoVideos = false;
  }
}

/** Arranca los temporizadores (modo 'db'). Idempotente. */
export function iniciarSchedulerDb(): void {
  if (RECORDATORIOS_ACTIVOS && !tRecord) {
    tRecord = setInterval(() => void tickRecordatorios(), POLL_RECORDATORIOS_MS);
    void tickRecordatorios(); // corrida inicial (procesa lo que ya estaba vencido)
    console.log(`🗓️  Scheduler BD (sin Redis): recordatorios cada ${POLL_RECORDATORIOS_MS / 1000}s`);
  }
  if (VIDEOS_SERVICIO_ACTIVOS && !tVideos) {
    tVideos = setInterval(() => void tickVideos(), POLL_VIDEOS_MS);
    void tickVideos();
    console.log(`🗓️  Scheduler BD (sin Redis): barrido de videos cada ${POLL_VIDEOS_MS / 60_000} min`);
  }
}

/** Detiene los temporizadores (para apagado limpio). */
export function detenerSchedulerDb(): void {
  if (tRecord) { clearInterval(tRecord); tRecord = null; }
  if (tVideos) { clearInterval(tVideos); tVideos = null; }
}
