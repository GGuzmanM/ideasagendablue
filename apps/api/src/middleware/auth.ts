import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { esRolMedico } from '../utils/rolesMedico';
import { prisma } from '../db';
import { AppError } from './errorHandler';

export interface AuthPayload {
  userId: string;
  rol: string;
  sedes: string[];
  permisos: string[];
  // Historia clínica: ficha de Profesional vinculada (médico con login). Se refresca en cada
  // request desde la BD, igual que permisos y sedes. null/undefined = sin vínculo.
  profesionalId?: string | null;
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

// Sedes donde MOVIMIENTOS tiene a esta podóloga HOY (su asignación de sede vigente).
export async function sedesVigentesDePodologa(profesionalId: string): Promise<string[]> {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const hoyD = new Date(hoy);
  const asigs = await prisma.asignacionSede.findMany({
    where: { profesionalId, fechaInicio: { lte: hoyD }, OR: [{ fechaFin: null }, { fechaFin: { gte: hoyD } }] },
    select: { sedeId: true },
  });
  return [...new Set(asigs.map((a) => a.sedeId))];
}

// Sedes donde MOVIMIENTOS tiene HOY a este médico (27-sep-2026): su tarjeta en Movimientos › Doctores
// (`baro_medico_sede`) y, si tiene columna propia en la agenda (p. ej. el dermatólogo), su asignación de sede.
// Antes el médico solo veía las sedes marcadas a mano al crear su usuario: la Dra. Chigne se movió de Lince a
// Paz Soldán en Movimientos y el Visor seguía mostrándole solo Lince.
export async function sedesVigentesDeMedico(profesionalId: string): Promise<string[]> {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const inicio = new Date(`${hoy}T00:00:00.000Z`);
  const fin = new Date(`${hoy}T23:59:59.999Z`);
  const [baro, columna] = await Promise.all([
    prisma.baroMedicoSede.findMany({
      where: { profesionalId, activa: true, fechaInicio: { lte: fin }, OR: [{ fechaFin: null }, { fechaFin: { gte: inicio } }] },
      select: { sedeId: true },
    }),
    sedesVigentesDePodologa(profesionalId),
  ]);
  return [...new Set([...baro.map((b) => b.sedeId), ...columna])];
}

/**
 * Sedes que salen de la FICHA de la persona (una sola fuente de verdad: Movimientos), o `null` si
 * este usuario usa sus sedes marcadas a mano. Recepcionista vinculada → su roster; podóloga con
 * ficha → su asignación de sede; médico con ficha → donde lo tiene Movimientos hoy (si no figura en
 * ninguna, sus sedes marcadas a mano). Moverlos en Movimientos cambia su acceso al instante.
 */
export async function sedesDerivadasDeFicha(u: { rol: string; recepcionistaId: string | null; profesionalId: string | null }): Promise<string[] | null> {
  if (u.recepcionistaId) return sedesVigentesDeRecepcionista(u.recepcionistaId);
  if (u.rol === 'podologa' && u.profesionalId) return sedesVigentesDePodologa(u.profesionalId);
  if (esRolMedico(u.rol) && u.profesionalId) {
    const sedes = await sedesVigentesDeMedico(u.profesionalId);
    return sedes.length ? sedes : null;
  }
  return null;
}

// ─── Autorización por SEDE ─────────────────────────────────────────────────────
// Roles que VEN/OPERAN TODAS las sedes (coordinación general + contact center, que atiende
// llamadas de todas las sedes). Es SOLO acceso a sedes — NO otorga poderes de gestión (eso va
// por `permisos`/requireRol; contact_center NO es coordinadora). Espeja authStore.puedeAccederSede.
// 24-sep-2026: RECEPCIÓN también ve y agenda en todas las sedes; su sede asignada (Movimientos, en
// `user.sedes`) sigue siendo con la que la agenda abre por defecto.
// 28-oct-2026: el MÉDICO AUDITOR también (revisa historias y recetas de todas las sedes; sigue sin gestionar nada: sus
// poderes salen de `permisos`). El médico común sigue limitado a su sede.
const ROLES_TODAS_SEDES = ['admin', 'coordinadora_sedes', 'contact_center', 'especial_contact', 'recursos_humanos', 'recepcionista', 'medico_auditor'];

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
      select: { rol: true, activo: true, deletedAt: true, recepcionistaId: true, profesionalId: true, sedes: { select: { sedeId: true } } },
    });
    if (!usuario || usuario.deletedAt || !usuario.activo) {
      throw new AppError('Sesión revocada: usuario inactivo o eliminado', 401, 'SESION_REVOCADA');
    }
    // Rol, permisos Y SEDES SIEMPRE frescos desde la BD: si el admin cambia los permisos del rol, le CAMBIA EL ROL al
    // usuario o le reasigna/quita sedes, aplica al instante sin cerrar sesión (no esperar al token, que dura hasta 30 días).
    // 11-nov-2026: antes se usaba el rol del TOKEN (el de cuando inició sesión) y `/auth/me` el de la BD: a un usuario
    // pasado a admin (o a un rol con «ver auditoría») la pantalla le mostraba la Auditoría pero el API le respondía 403 y la
    // lista salía vacía. Y al revés: a quien se le bajaba el rol, el API le seguía dando los permisos del rol anterior.
    payload.rol = usuario.rol;
    payload.permisos = await getPermisosRol(usuario.rol);
    payload.profesionalId = usuario.profesionalId ?? null;
    // Acceso a sedes: si el usuario está VINCULADO a una ficha del roster (Movimientos), su acceso se
    // DERIVA EN VIVO de la sede donde el roster lo tiene HOY (una sola fuente de verdad → moverlo en
    // Movimientos cambia su acceso al instante). Si no está vinculado, usa sus UsuarioSede.
    payload.sedes = (await sedesDerivadasDeFicha(usuario)) ?? usuario.sedes.map((s) => s.sedeId);
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

/** Pasa si el usuario tiene AL MENOS UNO de los permisos (p. ej. ausencias: `horarios.editar` o `ausencias.gestionar`). */
export function requireAlgunPermiso(...permisos: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError('No autenticado', 401, 'UNAUTHORIZED');
    if (!permisos.some((p) => req.user!.permisos?.includes(p))) throw new AppError('Sin permisos para esta acción', 403, 'FORBIDDEN');
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
