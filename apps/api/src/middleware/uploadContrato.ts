import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { guardarArchivo } from '../services/almacenArchivos';

// Plantilla del contrato de membresía: solo PDF (se estampan los datos sobre él).
// Se recibe en memoria y se guarda en la tabla `archivos` bajo contratos/<nombre>.
export const uploadContrato = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('El contrato debe ser un archivo PDF'));
  },
});

/**
 * Tras multer: comprueba que empiece por «%PDF-» (un .html/.svg con mimetype falso responde 400,
 * igual que en el comprobante de pago) y lo guarda en la base.
 */
export function validarContratoReal(req: Request, _res: Response, next: NextFunction): void {
  const f = req.file;
  if (!f) return next();
  if (f.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return next(new AppError('El contrato debe ser un archivo PDF real', 400, 'CONTRATO_NO_PDF'));
  }
  const nombre = `contrato_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
  guardarArchivo(`contratos/${nombre}`, f.buffer, 'application/pdf')
    .then(() => { f.filename = nombre; next(); })
    .catch(next);
}
