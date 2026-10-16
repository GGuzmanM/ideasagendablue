import multer from 'multer';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { DIR_UPLOADS } from '../utils/rutasArchivos';
import { comprimirImagen, guardarArchivo, EXT_POR_MIME } from '../services/almacenArchivos';

// ─── Subida de imágenes de la HC (podograma, fotos clínicas, consentimiento en foto) ───────────
// multer las recibe en memoria; luego se valida el CONTENIDO real (magic bytes), se comprimen y se
// guardan en la tabla `archivos` bajo podogramas/<atencionId>/… o fotos-clinicas/<atencionId>/….
// Solo se entregan por los endpoints autenticados de historia clínica (hc.ver + sede).
// `req.file.path` queda con una ruta bajo uploads/ que no existe en disco: solo sirve para
// rutaRelativaUpload(), que da la clave guardada en BD.
export const UPLOADS_ROOT = DIR_UPLOADS;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_IMAGEN = new Set(['image/jpeg', 'image/png', 'image/webp']);

function uploaderImagen(mb: number, error: string) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: mb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (MIME_IMAGEN.has(file.mimetype)) cb(null, true);
      else cb(new AppError(error, 400, 'ARCHIVO_TIPO_INVALIDO'));
    },
  });
}

function conErrores(mw: ReturnType<ReturnType<typeof multer>['single']>, demasiado: string, noSubio: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    mw(req, res, (err: unknown) => {
      if (!err) { next(); return; }
      if (err instanceof multer.MulterError) {
        next(new AppError(err.code === 'LIMIT_FILE_SIZE' ? demasiado : `${noSubio} (${err.code})`, 400, 'ARCHIVO_INVALIDO'));
        return;
      }
      next(err);
    });
  };
}

/** multer.single('imagen') con los errores de multer traducidos a AppError (400). */
export const subirImagenPodograma = conErrores(uploaderImagen(10, 'Solo se permiten imágenes JPG, PNG o WEBP').single('imagen'), 'La imagen supera los 10 MB', 'No se pudo subir la imagen');
// Las fotos de celular pesan más que una captura de la Baro: 15 MB.
export const subirFotoClinica = conErrores(uploaderImagen(15, 'Solo se permiten fotos JPG, PNG o WEBP').single('foto'), 'La foto supera los 15 MB', 'No se pudo subir la foto');

export function detectarImagen(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) return 'image/webp';
  return null;
}

/** Tras multer: valida que sea imagen de verdad, la comprime y la guarda en la base. */
function validarYGuardar(carpeta: string, prefijo: string, ladoMax: number) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const f = req.file;
    if (!f) { next(); return; }
    const atencionId = String(req.params.id ?? '');
    if (!UUID_RE.test(atencionId)) { next(new AppError('Atención inválida', 400)); return; }
    const real = detectarImagen(f.buffer);
    if (!real) { next(new AppError('El archivo no es una imagen JPG, PNG o WEBP válida', 400, 'ARCHIVO_CONTENIDO_INVALIDO')); return; }
    comprimirImagen(f.buffer, real, ladoMax)
      .then(async ({ datos, mime }) => {
        const nombre = `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2)}${EXT_POR_MIME[mime]}`;
        const ruta = await guardarArchivo(`${carpeta}/${atencionId.toLowerCase()}/${nombre}`, datos, mime, f.size);
        f.path = path.join(UPLOADS_ROOT, ...ruta.split('/'));
        f.filename = nombre;
        f.mimetype = mime;
        f.size = datos.length;
        next();
      })
      .catch(next);
  };
}

export const validarImagenPodogramaReal = validarYGuardar('podogramas', 'podo', 2000);
export const validarFotoClinicaReal = validarYGuardar('fotos-clinicas', 'foto', 1600);

/** Ruta relativa a uploads/ (con "/"), que es lo que se persiste en BD. */
export function rutaRelativaUpload(absPath: string): string {
  return path.relative(UPLOADS_ROOT, absPath).split(path.sep).join('/');
}
