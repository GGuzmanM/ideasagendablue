import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

// ─── Subida de imágenes del podograma (HC) ─────────────────────────────────────
// Mismo enfoque que uploadComprobante.ts (extensión desde allowlist de mimetype + validación
// del CONTENIDO real por magic bytes), pero:
//  · solo imágenes (JPG/PNG/WEBP), sin PDF;
//  · se guardan en uploads/podogramas/<atencionId>/ — ese subdirectorio NO lo sirve la ruta
//    firmada de /uploads (solo abre comprobantes|contratos), así que el archivo se entrega
//    ÚNICAMENTE por el endpoint autenticado de historia clínica (hc.ver + sede).
export const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');
const SUBDIR = 'podogramas';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXT_POR_MIME: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const EXT_POR_TIPO = { jpeg: '.jpg', png: '.png', webp: '.webp' } as const;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const atencionId = String(req.params.id ?? '');
    if (!UUID_RE.test(atencionId)) { cb(new AppError('Atención inválida', 400), ''); return; }
    const dir = path.join(UPLOADS_ROOT, SUBDIR, atencionId.toLowerCase());
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Extensión desde el mimetype declarado (allowlist), NUNCA desde el nombre del cliente.
    const ext = EXT_POR_MIME[file.mimetype] ?? '.bin';
    cb(null, `podo_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const uploader = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (EXT_POR_MIME[file.mimetype]) cb(null, true);
    else cb(new AppError('Solo se permiten imágenes JPG, PNG o WEBP', 400, 'ARCHIVO_TIPO_INVALIDO'));
  },
});

/** multer.single('imagen') con los errores de multer traducidos a AppError (400). */
export function subirImagenPodograma(req: Request, res: Response, next: NextFunction): void {
  uploader.single('imagen')(req, res, (err: unknown) => {
    if (!err) { next(); return; }
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera los 10 MB' : `No se pudo subir la imagen (${err.code})`;
      next(new AppError(msg, 400, 'ARCHIVO_INVALIDO'));
      return;
    }
    next(err);
  });
}

function detectarTipoReal(buf: Buffer): keyof typeof EXT_POR_TIPO | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) return 'webp';
  return null;
}

/** Post-subida: valida el contenido REAL (magic bytes); si no es imagen, borra y rechaza. */
export function validarImagenPodogramaReal(req: Request, _res: Response, next: NextFunction): void {
  if (!req.file) { next(); return; }
  let buf: Buffer;
  try {
    const fd = fs.openSync(req.file.path, 'r');
    buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
  } catch {
    next(new AppError('No se pudo validar la imagen subida', 400, 'ARCHIVO_INVALIDO'));
    return;
  }
  const real = detectarTipoReal(buf);
  if (!real) {
    fs.unlink(req.file.path, () => { /* limpieza best-effort */ });
    next(new AppError('El archivo no es una imagen JPG, PNG o WEBP válida', 400, 'ARCHIVO_CONTENIDO_INVALIDO'));
    return;
  }
  const extReal = EXT_POR_TIPO[real];
  if (path.extname(req.file.path).toLowerCase() !== extReal) {
    const nuevoPath = req.file.path.replace(/\.[^.]*$/, '') + extReal;
    try {
      fs.renameSync(req.file.path, nuevoPath);
      req.file.path = nuevoPath;
      req.file.filename = path.basename(nuevoPath);
    } catch { /* si falla el rename, la extensión de la allowlist sigue siendo segura */ }
  }
  req.file.mimetype = `image/${real}`;
  next();
}

/** Ruta relativa a uploads/ (con "/"), que es lo que se persiste en BD. */
export function rutaRelativaUpload(absPath: string): string {
  return path.relative(UPLOADS_ROOT, absPath).split(path.sep).join('/');
}

// ─── Fotos clínicas (1.8): mismo mecanismo, otro subdirectorio, campo "foto", 15 MB ──────────
// (las fotos de celular pesan más que una captura de la Baro). Tampoco las sirve /uploads.
const storageFotos = multer.diskStorage({
  destination: (req, _file, cb) => {
    const atencionId = String(req.params.id ?? '');
    if (!UUID_RE.test(atencionId)) { cb(new AppError('Atención inválida', 400), ''); return; }
    const dir = path.join(UPLOADS_ROOT, 'fotos-clinicas', atencionId.toLowerCase());
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, `foto_${Date.now()}_${Math.random().toString(36).slice(2)}${EXT_POR_MIME[file.mimetype] ?? '.bin'}`),
});
const uploaderFotos = multer({
  storage: storageFotos,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (EXT_POR_MIME[file.mimetype]) cb(null, true);
    else cb(new AppError('Solo se permiten fotos JPG, PNG o WEBP', 400, 'ARCHIVO_TIPO_INVALIDO'));
  },
});
export function subirFotoClinica(req: Request, res: Response, next: NextFunction): void {
  uploaderFotos.single('foto')(req, res, (err: unknown) => {
    if (!err) { next(); return; }
    if (err instanceof multer.MulterError) {
      next(new AppError(err.code === 'LIMIT_FILE_SIZE' ? 'La foto supera los 15 MB' : `No se pudo subir la foto (${err.code})`, 400, 'ARCHIVO_INVALIDO'));
      return;
    }
    next(err);
  });
}
/** Misma validación de contenido real (magic bytes) que el podograma. */
export const validarFotoClinicaReal = validarImagenPodogramaReal;
