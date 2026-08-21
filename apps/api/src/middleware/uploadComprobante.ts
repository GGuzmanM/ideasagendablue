import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

const dir = path.join(process.cwd(), 'uploads', 'comprobantes');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Tipos permitidos y su extensión SEGURA. La extensión del archivo guardado se deriva de aquí
// (NUNCA del `originalname` del cliente, que podría ser `.html`/`.svg` para forzar ejecución).
const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};
const EXT_POR_TIPO: Record<string, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  pdf: '.pdf',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => {
    // Extensión desde el mimetype declarado (allowlist), no desde el nombre del cliente.
    const ext = EXT_POR_MIME[file.mimetype] ?? '.bin';
    cb(null, `comp_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

export const uploadComprobante = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    // Primer filtro (declarado por el cliente): rápido. El filtro REAL por contenido va después.
    if (EXT_POR_MIME[file.mimetype]) cb(null, true);
    else cb(new AppError('Solo se permiten JPG, PNG, WEBP o PDF', 400, 'ARCHIVO_TIPO_INVALIDO'));
  },
});

// Detecta el tipo REAL por los "magic bytes" (no confía en el mimetype/extensión del cliente).
function detectarTipoReal(buf: Buffer): keyof typeof EXT_POR_TIPO | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) return 'pdf'; // %PDF-
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) return 'webp';
  return null;
}

// Middleware POST-subida: valida el CONTENIDO real del archivo guardado. Si no es una imagen
// (JPG/PNG/WEBP) ni un PDF de verdad → borra el archivo y rechaza. Si el contenido real no
// coincide con la extensión que se le puso (mimetype mentiroso) → renombra a la extensión real.
export function validarComprobanteReal(req: Request, _res: Response, next: NextFunction): void {
  if (!req.file) { next(); return; }
  let buf: Buffer;
  try {
    const fd = fs.openSync(req.file.path, 'r');
    buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
  } catch {
    next(new AppError('No se pudo validar el archivo subido', 400, 'ARCHIVO_INVALIDO'));
    return;
  }
  const real = detectarTipoReal(buf);
  if (!real) {
    fs.unlink(req.file.path, () => { /* limpieza best-effort */ });
    next(new AppError('El archivo no es una imagen (JPG/PNG/WEBP) ni un PDF válido', 400, 'ARCHIVO_CONTENIDO_INVALIDO'));
    return;
  }
  // Forzar la extensión al tipo REAL detectado (por si el mimetype declarado mentía).
  const extReal = EXT_POR_TIPO[real];
  if (path.extname(req.file.path).toLowerCase() !== extReal) {
    const nuevoPath = req.file.path.replace(/\.[^.]*$/, '') + extReal;
    try {
      fs.renameSync(req.file.path, nuevoPath);
      req.file.path = nuevoPath;
      req.file.filename = path.basename(nuevoPath);
    } catch { /* si falla el rename, se queda con la extensión de la allowlist (igual segura) */ }
  }
  req.file.mimetype = real === 'pdf' ? 'application/pdf' : `image/${real}`; // normalizar al real
  next();
}
