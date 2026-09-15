/**
 * Autenticación del APARATO del consultorio (ESP32 con botones INICIO / FIN).
 *
 * Esquema propio: `Authorization: Dispositivo lbd_<prefijo>.<secreto>`.
 *  - El prefijo es público y único → se busca el aparato por índice (una sola fila).
 *  - Se compara el sha256 del token completo en tiempo constante.
 * No se reutilizan las ApiKey: esas comparan con bcrypt contra TODAS las llaves en cada petición
 * (caro para un aparato que late cada minuto) y además saltan el control de sede. El aparato queda
 * atado a UNA sede, unidad y consultorio: todo lo que hace se limita a eso.
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { AppError } from './errorHandler';

export interface DispositivoAutenticado {
  id: string;
  nombre: string;
  sedeId: string;
  unidadNegocioId: string;
  consultorioNumero: number;
}

declare global {
  namespace Express {
    interface Request {
      dispositivo?: DispositivoAutenticado;
    }
  }
}

const ESQUEMA = 'Dispositivo ';
const FORMATO_TOKEN = /^lbd_([a-f0-9]{12})\.([A-Za-z0-9_-]{32,64})$/;

export function hashTokenDispositivo(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Token nuevo para un aparato. El token en claro se muestra UNA vez; se guarda solo el hash. */
export function generarTokenDispositivo(): { token: string; prefijo: string; hash: string } {
  const prefijo = crypto.randomBytes(6).toString('hex');
  const secreto = crypto.randomBytes(24).toString('base64url'); // 32 caracteres
  const token = `lbd_${prefijo}.${secreto}`;
  return { token, prefijo, hash: hashTokenDispositivo(token) };
}

/** Extrae el token y su prefijo del header. null si falta o no tiene el formato esperado. */
export function leerTokenDispositivo(header: string | undefined): { token: string; prefijo: string } | null {
  if (!header?.startsWith(ESQUEMA)) return null;
  const token = header.slice(ESQUEMA.length).trim();
  const m = FORMATO_TOKEN.exec(token);
  return m ? { token, prefijo: m[1]! } : null;
}

export function tokenCoincide(token: string, hashGuardado: string): boolean {
  const a = Buffer.from(hashTokenDispositivo(token), 'hex');
  const b = Buffer.from(hashGuardado, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function requireDispositivo(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const leido = leerTokenDispositivo(req.headers.authorization);
  if (!leido) throw new AppError('Falta la clave del aparato', 401, 'DISPOSITIVO_NO_AUTENTICADO');
  const d = await prisma.dispositivoConsultorio.findUnique({ where: { tokenPrefijo: leido.prefijo } });
  if (!d || d.deletedAt || !d.activo || !tokenCoincide(leido.token, d.tokenHash)) {
    throw new AppError('Clave del aparato inválida o revocada', 401, 'DISPOSITIVO_INVALIDO');
  }
  req.dispositivo = {
    id: d.id, nombre: d.nombre, sedeId: d.sedeId, unidadNegocioId: d.unidadNegocioId, consultorioNumero: d.consultorioNumero,
  };
  next();
}
