import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { leerArchivo } from '../services/almacenArchivos';

// ─── Firma de URLs de archivos privados (/uploads) ─────────────────────────────
// Los comprobantes de pago y los contratos de membresía llevan datos personales
// (nombre, DNI, montos). Antes se servían por `express.static` SIN autenticación:
// cualquiera con la URL —o adivinándola— bajaba el archivo. Como el front los pinta
// con <img src> / window.open (que NO pueden mandar el header Authorization), la
// autorización viaja FIRMADA en la propia URL, con caducidad corta.
//
// Flujo: el API firma toda URL de /uploads/(comprobantes|contratos) al devolverla
// (punto único: `firmarUrlsRespuesta`), y la ruta de servido valida esa firma antes
// de entregar el archivo (`servirUploadFirmado`).

const SECRET = process.env.ARCHIVO_FIRMA_SECRET || process.env.JWT_SECRET || 'limablue-dev-secret-only';
const TTL_MS = 2 * 60 * 60 * 1000; // 2h — sobra para ver/imprimir; se regenera en cada carga de datos.
const MIME_SEGUROS = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

// Solo estos subdirectorios se firman y se sirven; el resto de /uploads queda cerrado.
const PROTEGIDO_RE = /\/uploads\/(comprobantes|contratos)\//;

function calcularFirma(pathname: string, exp: number): string {
  return createHmac('sha256', SECRET).update(`${pathname}:${exp}`).digest('base64url');
}

/** Quita `exp`/`sig` de una URL de archivo (para PERSISTIRLA limpia en BD). */
export function limpiarUrlArchivo(url: string): string {
  try {
    const u = new URL(url, 'http://x');
    u.searchParams.delete('exp');
    u.searchParams.delete('sig');
    const q = u.searchParams.toString();
    const base = /^https?:\/\//i.test(url) ? `${u.origin}${u.pathname}` : u.pathname;
    return q ? `${base}?${q}` : base;
  } catch {
    return url;
  }
}

/**
 * Devuelve la misma URL con `?exp=&sig=` frescos (acceso firmado de corta vida).
 * Idempotente: descarta cualquier firma previa antes de re-firmar, así una URL que
 * el front reenvió firmada no acumula parámetros.
 */
export function firmarUrlArchivo(url: string): string {
  try {
    const u = new URL(url, 'http://x');
    u.searchParams.delete('exp');
    u.searchParams.delete('sig');
    const exp = Date.now() + TTL_MS;
    u.searchParams.set('exp', String(exp));
    u.searchParams.set('sig', calcularFirma(u.pathname, exp));
    return /^https?:\/\//i.test(url) ? u.toString() : `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function esUrlProtegida(s: string): boolean {
  return s.length < 2048 && PROTEGIDO_RE.test(s);
}

// Recorre el cuerpo de la respuesta y firma toda URL de archivo protegido que encuentre.
function firmarEnProfundidad(v: unknown): unknown {
  if (typeof v === 'string') return esUrlProtegida(v) ? firmarUrlArchivo(v) : v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = firmarEnProfundidad(v[i]);
    return v;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = firmarEnProfundidad(o[k]);
    return v;
  }
  return v;
}

/** Middleware global: firma las URLs de archivos privados en TODA respuesta JSON (punto único). */
export function firmarUrlsRespuesta(_req: Request, res: Response, next: NextFunction): void {
  const orig = res.json.bind(res);
  res.json = ((body: unknown) => orig(firmarEnProfundidad(body))) as Response['json'];
  next();
}

/** Sirve un archivo de /uploads (desde la base) SOLO si trae una firma válida y vigente. */
export function servirUploadFirmado(req: Request, res: Response): void {
  const pathname = req.baseUrl + req.path; // montado en /uploads → /uploads/comprobantes/x.jpg
  if (!PROTEGIDO_RE.test(pathname)) {
    res.status(404).end();
    return;
  }
  const exp = Number(req.query.exp);
  const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
  if (!exp || !Number.isFinite(exp) || exp < Date.now()) {
    res.status(403).json({ error: 'ENLACE_EXPIRADO', message: 'El enlace del archivo expiró. Recarga la página.', statusCode: 403 });
    return;
  }
  const esperada = calcularFirma(pathname, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'FIRMA_INVALIDA', message: 'Enlace de archivo inválido.', statusCode: 403 });
    return;
  }
  // El archivo vive en la tabla `archivos` (clave = ruta bajo uploads/; claveArchivo bloquea «..»).
  const rel = decodeURIComponent(req.path).replace(/^[/\\]+/, '');
  leerArchivo(rel)
    .then((archivo) => {
      if (!archivo) { res.status(404).end(); return; }
      // Defensa en profundidad contra XSS almacenado: nunca dejar que el navegador EJECUTE el archivo.
      // - `nosniff`: el navegador no adivina un tipo peligroso (p.ej. text/html) por el contenido.
      // - Imagen/PDF → se pueden ver inline. Cualquier otro tipo se fuerza a DESCARGA con tipo neutro.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (MIME_SEGUROS.has(archivo.mime)) res.type(archivo.mime);
      else {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment');
      }
      res.send(archivo.datos);
    })
    .catch(() => { if (!res.headersSent) res.status(500).end(); });
}
