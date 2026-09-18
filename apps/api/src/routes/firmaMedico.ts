import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';
import { medicoDelUsuario } from '../services/medicoCitaService';

// ─── Firma y sello digitalizados del médico (18-sep-2026) ─────────────────────
// Cada médico sube UNA imagen (PNG o JPG) con su firma y sello. Se guarda en la base (tabla
// firmas_profesional), nunca en /uploads, y solo la usa ÉL: al imprimir una receta a su nombre
// puede elegir «con mi firma». Nadie más puede leerla ni estamparla; administración solo puede
// retirarla (por ejemplo, si el médico deja la clínica).
//  · GET    /mi-firma          → { tieneFirma, actualizadoEn }
//  · GET    /mi-firma/imagen   → la imagen (para que el médico vea lo que subió)
//  · PUT    /mi-firma          → { imagenBase64 } sube o reemplaza
//  · DELETE /mi-firma          → la quita
//  · DELETE /mi-firma/de/:profesionalId → administración la retira (usuarios.editar)
const router = Router();
const user = (req: Request) => req.user as AuthPayload;
const ctx = (req: Request) => ({ usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });

export const MAX_FIRMA_BYTES = 500 * 1024;

/** Tipo real de la imagen por sus primeros bytes (no por lo que diga el navegador). */
export function tipoImagenFirma(b: Buffer): 'image/png' | 'image/jpeg' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

async function yoMedico(req: Request) {
  const yo = await medicoDelUsuario(user(req));
  if (!yo) throw new AppError('Solo un médico con su ficha vinculada puede tener firma digitalizada', 403, 'SOLO_MEDICO');
  return yo;
}

router.get('/', requireAuth, async (req, res) => {
  const yo = await yoMedico(req);
  const f = await prisma.firmaProfesional.findUnique({ where: { profesionalId: yo.id }, select: { actualizadoEn: true } });
  res.json({ tieneFirma: !!f, actualizadoEn: f?.actualizadoEn ?? null });
});

router.get('/imagen', requireAuth, async (req, res) => {
  const yo = await yoMedico(req);
  const f = await prisma.firmaProfesional.findUnique({ where: { profesionalId: yo.id } });
  if (!f) throw new AppError('Aún no subiste tu firma', 404, 'SIN_FIRMA');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(Buffer.from(f.imagen));
});

router.put('/', requireAuth, async (req, res) => {
  const yo = await yoMedico(req);
  const { imagenBase64 } = z.object({ imagenBase64: z.string().min(20).max(Math.ceil(MAX_FIRMA_BYTES * 1.4) + 100) }).parse(req.body);
  const b = Buffer.from(imagenBase64.replace(/^data:image\/[a-z]+;base64,/i, ''), 'base64');
  if (b.length > MAX_FIRMA_BYTES) throw new AppError('La imagen pesa más de 500 KB: recórtala o bájale la resolución', 400, 'FIRMA_PESADA');
  const mime = tipoImagenFirma(b);
  if (!mime) throw new AppError('La firma debe ser una imagen PNG o JPG', 400, 'FIRMA_FORMATO');
  const antes = await prisma.firmaProfesional.findUnique({ where: { profesionalId: yo.id }, select: { actualizadoEn: true } });
  await prisma.firmaProfesional.upsert({
    where: { profesionalId: yo.id },
    create: { profesionalId: yo.id, imagen: b, mime },
    update: { imagen: b, mime },
  });
  // Nunca se audita la imagen: solo que se subió o reemplazó, cuánto pesa y de qué tipo.
  await registrarAudit({ ...ctx(req), accion: antes ? 'reemplazar_firma' : 'subir_firma', entidad: 'profesional', entidadId: yo.id, despues: { mime, bytes: b.length } });
  res.json({ tieneFirma: true, actualizadoEn: new Date() });
});

router.delete('/', requireAuth, async (req, res) => {
  const yo = await yoMedico(req);
  const r = await prisma.firmaProfesional.deleteMany({ where: { profesionalId: yo.id } });
  if (r.count) await registrarAudit({ ...ctx(req), accion: 'quitar_firma', entidad: 'profesional', entidadId: yo.id });
  res.json({ tieneFirma: false, actualizadoEn: null });
});

router.delete('/de/:profesionalId', requireAuth, requirePermiso('usuarios.editar'), async (req, res) => {
  const profesionalId = z.string().uuid().parse(req.params.profesionalId);
  const r = await prisma.firmaProfesional.deleteMany({ where: { profesionalId } });
  if (r.count) await registrarAudit({ ...ctx(req), accion: 'retirar_firma', entidad: 'profesional', entidadId: profesionalId });
  res.json({ retirada: r.count > 0 });
});

export default router;
