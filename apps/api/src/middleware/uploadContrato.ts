import multer from 'multer';
import path from 'path';
import fs from 'fs';

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
