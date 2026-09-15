import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

const dir = path.join(process.cwd(), 'uploads', 'contratos');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => {
    cb(null, `contrato_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  },
});

// Plantilla del contrato de membresía: solo PDF (se estampan los datos sobre él).
export const uploadContrato = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('El contrato debe ser un archivo PDF'));
  },
});

/**
 * Tras multer: comprueba que el archivo guardado empiece por «%PDF-». Un .html/.svg renombrado como
 * PDF (con mimetype falso) se borra y responde 400, igual que en el comprobante de pago.
 */
export function validarContratoReal(req: Request, _res: Response, next: NextFunction): void {
  const f = req.file;
  if (!f) return next();
  try {
    const fd = fs.openSync(f.path, 'r');
    const cab = Buffer.alloc(5);
    fs.readSync(fd, cab, 0, 5, 0);
    fs.closeSync(fd);
    if (cab.toString('latin1') !== '%PDF-') {
      fs.unlinkSync(f.path);
      return next(new AppError('El contrato debe ser un archivo PDF real', 400, 'CONTRATO_NO_PDF'));
    }
    next();
  } catch (e) { next(e); }
}
