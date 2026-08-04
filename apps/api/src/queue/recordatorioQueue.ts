import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

// El worker/cola se puede apagar con RECORDATORIOS_ACTIVOS="false".
export const RECORDATORIOS_ACTIVOS = process.env.RECORDATORIOS_ACTIVOS !== 'false';
export const QUEUE_NAME = 'recordatorios-cita';
export const JOB_ENVIAR = 'enviar-recordatorio';
export const JOB_RESERVA = 'enviar-reserva';

// BullMQ exige una conexión con maxRetriesPerRequest = null.
// OJO: la offline queue queda HABILITADA (default): con enableOfflineQueue:false, el
// primer encolado tras el arranque llegaba mientras la conexión aún se establecía y
// explotaba ("Stream isn't writeable") → el catch lo tragaba → recordatorio huérfano
// (fila PROGRAMADO con jobId null que jamás dispara). Con la cola offline, el comando
// espera a que la conexión esté lista.
export function crearConexionBull(): ConnectionOptions {
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5_000), // reintenta siempre (Redis puede tardar en subir)
  }) as unknown as ConnectionOptions;
}

let queue: Queue | null = null;

export function getRecordatorioQueue(): Queue | null {
  if (!RECORDATORIOS_ACTIVOS) return null;
  if (!queue) {
    try {
      queue = new Queue(QUEUE_NAME, { connection: crearConexionBull() });
    } catch {
      queue = null;
    }
  }
  return queue;
}

export function jobIdDeCita(citaId: string): string {
  return `recordatorio-${citaId}`;
}

export async function programarJobRecordatorio(citaId: string, programadoPara: Date, tipo: 'auto' | 'manual' = 'auto'): Promise<string | null> {
  try {
    const q = getRecordatorioQueue();
    if (!q) return null;

    const jobId = jobIdDeCita(citaId);
    const previo = await q.getJob(jobId).catch(() => null);
    if (previo) await previo.remove().catch(() => {});

    const delay = Math.max(0, programadoPara.getTime() - Date.now());
    await q.add(
      JOB_ENVIAR,
      { citaId, tipo },
      {
        jobId,
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: false,
      },
    );
    return jobId;
  } catch (e) {
    return null;
  }
}

export async function programarJobReserva(citaId: string, cuando: Date): Promise<string | null> {
  try {
    const q = getRecordatorioQueue();
    if (!q) return null;
    const jobId = `reserva-${citaId}`;
    const previo = await q.getJob(jobId).catch(() => null);
    if (previo) await previo.remove().catch(() => {});
    await q.add(
      JOB_RESERVA,
      { citaId },
      { jobId, delay: Math.max(0, cuando.getTime() - Date.now()), attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: false },
    );
    return jobId;
  } catch (e) {
    return null;
  }
}

export async function cancelarJobRecordatorio(citaId: string): Promise<void> {
  try {
    const q = getRecordatorioQueue();
    if (!q) return;
    const job = await q.getJob(jobIdDeCita(citaId)).catch(() => null);
    if (job) await job.remove().catch(() => {});
  } catch (e) {}
}
