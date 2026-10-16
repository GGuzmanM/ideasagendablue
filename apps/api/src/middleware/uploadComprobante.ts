import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { detectarImagen } from './uploadPodograma';
import { comprimirImagen, guardarArchivo, EXT_POR_MIME } from '../services/almacenArchivos';

// Comprobante de pago: imagen o PDF. Se recibe en memoria y se guarda en la tabla `archivos`
// bajo comprobantes/<nombre>; se sirve por /uploads/comprobantes/<nombre> con URL firmada.
export const uploadComprobante = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    // Primer filtro (declarado por el cliente): rápido. El filtro REAL por contenido va después.
    if (EXT_POR_MIME[file.mimetype]) cb(null, true);
    else cb(new AppError('Solo se permiten JPG, PNG, WEBP o PDF', 400, 'ARCHIVO_TIPO_INVALIDO'));
  },
});

// Detecta el tipo REAL por los "magic bytes" (no confía en el mimetype/extensión del cliente).
function detectarTipoReal(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return detectarImagen(buf);
}

// Middleware POST-subida: valida el CONTENIDO real (rechaza html/svg/script disfrazado), comprime si
// es imagen y lo guarda en la base. Deja en req.file el nombre, el tipo real y el tamaño final.
export function validarComprobanteReal(req: Request, _res: Response, next: NextFunction): void {
  const f = req.file;
  if (!f) { next(); return; }
  const real = detectarTipoReal(f.buffer);
  if (!real) {
    next(new AppError('El archivo no es una imagen (JPG/PNG/WEBP) ni un PDF válido', 400, 'ARCHIVO_CONTENIDO_INVALIDO'));
    return;
  }
  comprimirImagen(f.buffer, real)
    .then(async ({ datos, mime }) => {
      const nombre = `comp_${Date.now()}_${Math.random().toString(36).slice(2)}${EXT_POR_MIME[mime]}`;
      await guardarArchivo(`comprobantes/${nombre}`, datos, mime, f.size);
      f.filename = nombre;
      f.mimetype = mime;
      f.size = datos.length;
      next();
    })
    .catch(next);
}
