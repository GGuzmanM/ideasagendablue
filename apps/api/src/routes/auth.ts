import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { signToken, requireAuth, getPermisosRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';
import { loginLimiter } from '../middleware/rateLimits';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// entidadId es UUID obligatorio; cuando el intento no corresponde a un usuario real
// se usa este centinela para poder auditar igual sin romper la restricción de tipo.
const UUID_CENTINELA = '00000000-0000-0000-0000-000000000000';

// Barrera anti fuerza bruta: máx 5 intentos fallidos por IP cada 15 min (ver rateLimits.ts).
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  const usuario = await prisma.usuario.findUnique({
    where: { email, deletedAt: null },
    include: { sedes: { include: { sede: { select: { id: true, nombre: true } } } } },
  });

  // Auditar los intentos FALLIDOS también (detección de fuerza bruta / credential stuffing).
  // La respuesta al cliente queda SIEMPRE genérica ("Credenciales inválidas") para no revelar
  // si el correo existe; el motivo detallado solo vive en el audit interno (admin).
  if (!usuario || !usuario.activo) {
    await registrarAudit({
      usuarioId: usuario?.id, accion: 'LOGIN_FALLIDO', entidad: 'auth',
      entidadId: usuario?.id ?? UUID_CENTINELA, ip: clientIp, userAgent,
      despues: { email, motivo: usuario ? 'usuario_inactivo' : 'usuario_inexistente' },
    });
    throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
  }

  const passwordOk = await bcrypt.compare(password, usuario.passwordHash);
  if (!passwordOk) {
    await registrarAudit({
      usuarioId: usuario.id, accion: 'LOGIN_FALLIDO', entidad: 'auth',
      entidadId: usuario.id, ip: clientIp, userAgent,
      despues: { email, motivo: 'password_incorrecto' },
    });
    throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
  }

  const sedeIds = usuario.sedes.map((us: { sedeId: string }) => us.sedeId);
  const permisos = await getPermisosRol(usuario.rol);
  const token = signToken({ userId: usuario.id, rol: usuario.rol, sedes: sedeIds, permisos });

  await registrarAudit({
    usuarioId: usuario.id,
    accion: 'LOGIN',
    entidad: 'usuario',
    entidadId: usuario.id,
    ip: clientIp,
    userAgent,
    despues: { email: usuario.email, nombre: usuario.nombre, rol: usuario.rol },
  });

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      permisos,
      sedes: usuario.sedes.map((us: { sedeId: string; sede: { nombre: string } }) => ({ id: us.sedeId, nombre: us.sede.nombre })),
    },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.user!.userId },
    include: { sedes: { include: { sede: { select: { id: true, nombre: true, color: true } } } } },
  });
  if (!usuario) throw new AppError('Usuario no encontrado', 404);

  const permisos = await getPermisosRol(usuario.rol);

  res.json({
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    permisos,
    sedes: usuario.sedes.map((us: { sedeId: string; sede: { nombre: string; color: string } }) => ({
      id: us.sedeId,
      nombre: us.sede.nombre,
      color: us.sede.color,
    })),
  });
});

export default router;
