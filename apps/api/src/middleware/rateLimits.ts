/**
 * Límites de tasa (rate limiting) — barrera anti fuerza bruta / abuso.
 *
 * Se apoya en `express-rate-limit` y en `trust proxy` (ya configurado en index.ts) para
 * contar por IP REAL detrás del proxy. Responde en el formato de error del proyecto
 * ({ error, message, statusCode }) con HTTP 429.
 *
 * NOTA (prod): el conteo por IP depende de que el proxy (Vite/nginx) reenvíe `X-Forwarded-For`
 * (Vite ya usa `xfwd:true`) y de que `TRUST_PROXY` liste el/los proxies. Con `loopback` (default)
 * solo confía en el proxy local. El estado del límite es EN MEMORIA: se reinicia al reiniciar
 * el proceso (aceptable para una sola instancia; multi-instancia usaría un store Redis).
 */
import rateLimit from 'express-rate-limit';

interface LimiterCfg {
  limit: number;
  windowMs: number;
  code: string;
  message: string;
  /** Si true, los requests EXITOSOS (2xx/3xx) no cuentan → solo penaliza los fallidos. */
  skipSuccessful?: boolean;
}

function crearLimiter(cfg: LimiterCfg) {
  return rateLimit({
    windowMs: cfg.windowMs,
    limit: cfg.limit,
    standardHeaders: 'draft-7', // expone RateLimit-* (cuántos quedan / cuándo se resetea)
    legacyHeaders: false,
    skipSuccessfulRequests: cfg.skipSuccessful ?? false,
    handler: (_req, res) => {
      res.status(429).json({ error: cfg.code, message: cfg.message, statusCode: 429 });
    },
  });
}

/**
 * Login: máx 5 intentos FALLIDOS por IP cada 15 min. Un login correcto NO gasta el cupo
 * (skipSuccessfulRequests), así que solo frena la fuerza bruta, no al usuario legítimo.
 */
export const loginLimiter = crearLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1000,
  skipSuccessful: true,
  code: 'DEMASIADOS_INTENTOS',
  message: 'Demasiados intentos de inicio de sesión desde esta IP. Espera 15 minutos e intenta de nuevo.',
});

/**
 * Consultas a RENIEC (API externa por DNI): 30 por IP cada 15 min. Evita que se abuse del
 * lookup externo (costo/límite del proveedor) haciendo barridos de documentos.
 */
export const reniecLimiter = crearLimiter({
  limit: 30,
  windowMs: 15 * 60 * 1000,
  code: 'DEMASIADAS_CONSULTAS',
  message: 'Demasiadas consultas de documento desde esta IP. Espera unos minutos e intenta de nuevo.',
});
