import { Queue, Worker } from 'bullmq';
import { crearConexionBull } from './recordatorioQueue';
import { procesarBarridoVideos } from '../services/videoEnvioService';
import { USA_REDIS } from '../config/colaModo';

export const VIDEOS_SERVICIO_ACTIVOS = process.env.VIDEOS_SERVICIO_ACTIVOS !== 'false';
export const VIDEO_QUEUE_NAME = 'videos-servicio';
export const JOB_BARRIDO = 'barrido-videos';
const INTERVALO_MS = 5 * 60_000; // cada 5 minutos

let queue: Queue | null = null;
let worker: Worker | null = null;

function getVideoQueue(): Queue | null {
  if (!VIDEOS_SERVICIO_ACTIVOS || !USA_REDIS) return null; // modo 'db': el barrido lo hace schedulerDb
  if (!queue) {
    try {
      queue = new Queue(VIDEO_QUEUE_NAME, { connection: crearConexionBull() });
    } catch {
      queue = null;
    }
  }
  return queue;
}

export async function programarBarridoVideos(): Promise<void> {
  try {
    const q = getVideoQueue();
    if (!q) return;
    const repetibles = await q.getRepeatableJobs().catch(() => []);
    for (const r of repetibles) {
      if (r.name === JOB_BARRIDO) await q.removeRepeatableByKey(r.key).catch(() => {});
    }
    await q.add(
      JOB_BARRIDO,
      {},
      {
        repeat: { every: INTERVALO_MS },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );
  } catch (e) {}
}

export function iniciarVideoWorker(): void {
  if (!VIDEOS_SERVICIO_ACTIVOS || !USA_REDIS || worker) return; // modo 'db': lo maneja schedulerDb
  try {
    worker = new Worker(
      VIDEO_QUEUE_NAME,
      async (job) => {
        if (job.name === JOB_BARRIDO) {
          await procesarBarridoVideos();
        }
      },
      { connection: crearConexionBull(), concurrency: 1 },
    );
    worker.on('error', () => {});
    worker.on('failed', (job, err) => {
      console.error(`[videoWorker] job ${job?.id} falló:`, err.message);
    });
  } catch (e) {}
}

export async function detenerVideoWorker(): Promise<void> {
  if (worker) {
    try {
      await worker.close();
    } catch {}
    worker = null;
  }
}
