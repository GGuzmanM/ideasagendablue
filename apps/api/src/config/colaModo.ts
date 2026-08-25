/**
 * Modo de la cola de trabajos diferidos (recordatorio Correo 2 + barrido de videos).
 *
 *   COLA_MODO="redis" (default) → BullMQ + Redis. El worker corre en proceso (o aparte con
 *                                 RECORDATORIOS_WORKER_INLINE="false"). Requiere Redis en REDIS_URL.
 *   COLA_MODO="db"              → SIN Redis. Un temporizador (`schedulerDb`) revisa la BD cada pocos
 *                                 segundos y envía lo vencido, reusando las MISMAS funciones de envío.
 *                                 El cliente Redis pasa a ser un stub no-op (caché = miss, lock =
 *                                 fail-open; la garantía real de no-doble-booking son los índices
 *                                 únicos de la BD). Ideal para 1 sola instancia sin Docker/Redis.
 *
 * Quien ENVÍA el correo es Resend en ambos modos; Redis solo decidía CUÁNDO dispararlo.
 */
export const COLA_MODO = (process.env.COLA_MODO || 'redis').trim().toLowerCase();

/** true = usar Redis/BullMQ; false = modo 'db' (temporizador en la BD, sin Redis). */
export const USA_REDIS = COLA_MODO !== 'db';
