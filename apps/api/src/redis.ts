import { Redis } from 'ioredis';
import { USA_REDIS } from './config/colaModo';

/**
 * Stub no-op del cliente Redis para el modo COLA_MODO="db" (sin Redis). Implementa SOLO los
 * métodos que el código usa (get/set/setex/del/keys/eval/call/ping/connect/on/quit), sin abrir
 * ningún socket. Efecto: la caché siempre "falla" (miss → se recalcula) y los locks devuelven
 * "OK" (fail-open — la garantía real de no-doble-booking son los índices únicos de la BD).
 */
function crearRedisStub(): Redis {
  const ok = async () => 'OK';
  const stub: Record<string, unknown> = {
    get: async () => null,
    set: ok,
    setex: ok,
    del: async () => 0,
    keys: async () => [] as string[],
    eval: async () => null,
    call: async () => null,
    ping: async () => 'PONG',
    connect: async () => undefined,
    quit: ok,
    disconnect: () => undefined,
    duplicate: () => stub,
  };
  stub.on = () => stub; // encadenable (redis.on('error', …))
  return stub as unknown as Redis;
}

export const redis: Redis = USA_REDIS
  ? new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 1000)),
    })
  : crearRedisStub();

if (USA_REDIS) {
  redis.on('error', () => {
    // Silencioso en desarrollo si Redis no está corriendo localmente
  });
}

// ─── Helpers de lock (anti doble-booking) ─────────────────────────────────────

const LOCK_TTL = 30; // segundos

export function slotLockKey(sedeId: string, profesionalId: string, fecha: string, hora: string): string {
  return `lock:slot:${sedeId}:${profesionalId}:${fecha}:${hora}`;
}

export async function acquireSlotLock(
  sedeId: string,
  profesionalId: string,
  fecha: string,
  hora: string,
  requestId: string
): Promise<boolean> {
  try {
    const key = slotLockKey(sedeId, profesionalId, fecha, hora);
    const result = await redis.set(key, requestId, 'EX', LOCK_TTL, 'NX');
    return result === 'OK';
  } catch (e) {
    // Si Redis no responde en desarrollo local, permitir la transacción
    return true;
  }
}

export async function releaseSlotLock(
  sedeId: string,
  profesionalId: string,
  fecha: string,
  hora: string,
  requestId: string
): Promise<void> {
  try {
    const key = slotLockKey(sedeId, profesionalId, fecha, hora);
    const current = await redis.get(key);
    if (current === requestId) {
      await redis.del(key);
    }
  } catch (e) {}
}

// ─── Cache de disponibilidad ──────────────────────────────────────────────────

export function disponibilidadCacheKey(sedeId: string, fecha: string, unidadId: string): string {
  return `cache:disponibilidad:${sedeId}:${unidadId}:${fecha}`;
}

export async function invalidateDisponibilidadCache(sedeId: string, fecha: string): Promise<void> {
  try {
    const pattern = `cache:disponibilidad:${sedeId}:*:${fecha}`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (e) {}
}

/** Invalida TODAS las fechas de UNA sede (cambios que afectan muchas fechas de esa sede). */
export async function invalidateDisponibilidadSede(sedeId: string): Promise<void> {
  try {
    const keys = await redis.keys(`cache:disponibilidad:${sedeId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (e) {}
}

/** Invalida una FECHA en TODAS las sedes (para cambios sin sede conocida, ej. override de turno). */
export async function invalidateDisponibilidadFecha(fecha: string): Promise<void> {
  try {
    const keys = await redis.keys(`cache:disponibilidad:*:*:${fecha}`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (e) {}
}

/** Vacía TODA la caché de disponibilidad (cambios que afectan muchas fechas, ej. horario semanal). */
export async function flushDisponibilidadCache(): Promise<void> {
  try {
    const keys = await redis.keys('cache:disponibilidad:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (e) {}
}
