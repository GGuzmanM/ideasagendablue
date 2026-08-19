import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { AppError } from './errorHandler';

export interface AuthPayload {
  userId: string;
  rol: string;
  sedes: string[];
  permisos: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      apiKey?: { id: string; scopes: string[] };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  console.warn('⚠️  JWT_SECRET no definido — usando secreto de desarrollo. NO usar en producción.');
}
const JWT_SECRET_VALUE = JWT_SECRET || 'limablue-dev-secret-only';

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload as object, JWT_SECRET_VALUE, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as import('jsonwebtoken').SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET_VALUE) as AuthPayload;
}

export async function getPermisosRol(rolNombre: string): Promise<string[]> {
  const rol = await prisma.rol.findUnique({ where: { nombre: rolNombre } });
  return rol?.permisos ?? [];
}

// Sedes donde el ROSTER (Movimientos) tiene a esta recepcionista HOY (asignaciones vigentes).
// Es la fuente de verdad del acceso para usuarios vinculados: se recalcula en cada request.
export async function sedesVigentesDeRecepcionista(recepcionistaId: string): Promise<string[]> {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const hoyD = new Date(hoy); // medianoche UTC (server TZ=UTC) — @db.Date se compara igual
  const asigs = await prisma.asignacionAdministrativa.findMany({
    where: {
      recepcionistaId, deletedAt: null,
      fechaInicio: { lte: hoyD },
      OR: [{ fechaFin: null }, { fechaFin: { gte: hoyD } }],
    },
    select: { sedeId: true },
  });
  return [...new Set(asigs.map((a) => a.sedeId))];
}

// ─── Autorización por SEDE ─────────────────────────────────────────────────────
// Roles que VEN/OPERAN TODAS las sedes (coordinación general + contact center, que atiende
// llamadas de todas las sedes). Es SOLO acceso a sedes — NO otorga poderes de gestión (eso va
// por `permisos`/requireRol; contact_center NO es coordinadora). El resto (recepción) solo
// opera/lee las sedes de su token. Espeja authStore.puedeAccederSede en el frontend.
const ROLES_TODAS_SEDES = ['admin', 'coordinadora_sedes', 'contact_center'];

export function puedeTodasLasSedes(user: AuthPayload): boolean {
  return ROLES_TODAS_SEDES.includes(user.rol);
}

export function sedeAutorizada(user: AuthPayload, sedeId: string): boolean {
  if (puedeTodasLasSedes(user)) return true;
  return user.sedes.includes(sedeId);
}

/**
 * Exige que el request pueda operar/leer la sede indicada. Las API keys (integraciones) NO
 * se restringen por sede. Los usuarios: admin/coordinadora → todas; resto → solo sus sedes.
 * `sedeId` vacío/undefined → no aplica (ruta sin sede específica).
 */
export function assertSede(req: Request, sedeId: string | null | undefined): void {
  if (req.apiKey) return;
  if (!req.user) throw new AppError('No autenticado', 401, 'UNAUTHORIZED');
  if (!sedeId) return;
  if (!sedeAutorizada(req.user, sedeId)) {
    throw new AppError('No tienes acceso a esa sede', 403, 'SEDE_NO_AUTORIZADA');
  }
}

/**
 * Guard de acceso combinado: las API keys pasan por SCOPE; los usuarios por PERMISO real.
 * Reemplaza a `requireScope` en rutas de escritura, donde `requireScope` dejaba pasar a
 * CUALQUIER usuario logueado (no validaba el permiso).
 */
export function requireAcceso(scope: string, permiso: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.apiKey) {
      if (req.apiKey.scopes.includes(scope)) return next();
      throw new AppError(`Scope requerido: ${scope}`, 403, 'FORBIDDEN');
    }
    if (req.user) {
      if (req.user.permisos?.includes(permiso)) return next();
      throw new AppError(`Necesitas el permiso "${permiso}" para esta acción`, 403, 'SIN_PERMISO');
    }
    throw new AppError('No autenticado', 401, 'UNAUTHORIZED');
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new AppError('Token de autorización requerido', 401, 'UNAUTHORIZED');
  }

  // JWT Bearer
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    // Revalidar el usuario en cada request: si fue eliminado o desactivado, su sesión
    // muere al instante aunque el token siga vigente (no esperar a que caduque).
    const usuario = await prisma.usuario.findUnique({
      where: { id: payload.userId },
      select: { activo: true, deletedAt: true, recepcionistaId: true, sedes: { select: { sedeId: true } } },
    });
    if (!usuario || usuario.deletedAt || !usuario.activo) {
      throw new AppError('Sesión revocada: usuario inactivo o eliminado', 401, 'SESION_REVOCADA');
    }
    // Permisos Y SEDES SIEMPRE frescos desde la BD: si el admin cambia los permisos del rol o
    // reasigna/quita sedes del usuario, aplican al instante sin cerrar sesión (no esperar al token).
    payload.permisos = await getPermisosRol(payload.rol);
    // Acceso a sedes: si el usuario está VINCULADO a una ficha del roster (Movimientos), su acceso se
    // DERIVA EN VIVO de la sede donde el roster lo tiene HOY (una sola fuente de verdad → moverlo en
    // Movimientos cambia su acceso al instante). Si no está vinculado, usa sus UsuarioSede.
    payload.sedes = usuario.recepcionistaId
      ? await sedesVigentesDeRecepcionista(usuario.recepcionistaId)
      : usuario.sedes.map((s) => s.sedeId);
    req.user = payload;
    return next();
  }

  // API Key
  if (authHeader.startsWith('ApiKey ')) {
    const rawKey = authHeader.slice(7);
    const apiKeys = await prisma.apiKey.findMany({ where: { activa: true } });
    for (const ak of apiKeys) {
      if (await bcrypt.compare(rawKey, ak.keyHash)) {
        req.apiKey = { id: ak.id, scopes: ak.scopes };
        await prisma.apiKey.update({ where: { id: ak.id }, data: { ultimoUso: new Date() } });
        return next();
      }
    }
    throw new AppError('API Key inválida', 401, 'INVALID_API_KEY');
  }

  throw new AppError('Formato de autorización inválido', 401, 'UNAUTHORIZED');
}

export function requireScope(scope: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (req.user) return next();
    if (req.apiKey?.scopes.includes(scope)) return next();
    throw new AppError(`Scope requerido: ${scope}`, 403, 'FORBIDDEN');
  };
}

export function requireRol(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError('No autenticado', 401, 'UNAUTHORIZED');
    if (!roles.includes(req.user.rol)) {
      throw new AppError('Sin permisos para esta acción', 403, 'FORBIDDEN');
    }
    next();
  };
}

export function requirePermiso(permiso: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError('No autenticado', 401, 'UNAUTHORIZED');
    if (!req.user.permisos?.includes(permiso)) {
      throw new AppError('Sin permisos para esta acción', 403, 'FORBIDDEN');
    }
    next();
  };
}
