import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { signToken, requireAuth, getPermisosRol, sedesVigentesDeRecepcionista } from '../middleware/auth';
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

// ─── Perfil clínico del usuario (Historia clínica) ────────────────────────────
// Ficha de Profesional vinculada + si puede PRESCRIBIR: médico (no equipo), activo, con colegiatura
// y con el permiso `receta.emitir`. Mismo cálculo que el candado del servicio de recetas, para que
// el frontend muestre/oculte "Emitir receta" con la misma verdad.
const profesionalSelect = { select: { id: true, nombres: true, apellidos: true, tipo: true, colegiatura: true, esEquipo: true, activo: true } } as const;
type ProfesionalPerfil = { id: string; nombres: string; apellidos: string; tipo: string; colegiatura: string | null; esEquipo: boolean; activo: boolean } | null;
function perfilClinico(profesional: ProfesionalPerfil, permisos: string[]) {
  const esMedicoPrescriptor = !!profesional
    && profesional.tipo === 'medico' && !profesional.esEquipo && profesional.activo
    && !!(profesional.colegiatura ?? '').trim() && permisos.includes('receta.emitir');
  return {
    profesionalId: profesional?.id ?? null,
    profesional: profesional ? { id: profesional.id, nombres: profesional.nombres, apellidos: profesional.apellidos, tipo: profesional.tipo, colegiatura: profesional.colegiatura } : null,
    esMedicoPrescriptor,
  };
}

// Barrera anti fuerza bruta: máx 5 intentos fallidos por IP cada 15 min (ver rateLimits.ts).
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  const usuario = await prisma.usuario.findUnique({
    where: { email, deletedAt: null },
    include: { sedes: { include: { sede: { select: { id: true, nombre: true } } } }, profesional: profesionalSelect },
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

  // Acceso a sedes: recepcionista VINCULADA al roster → deriva de Movimientos (sede vigente hoy);
  // si no, sus UsuarioSede. Espeja la lógica de requireAuth para que token y respuesta coincidan.
  let sedesResp: { id: string; nombre: string }[];
  if (usuario.recepcionistaId) {
    const ids = await sedesVigentesDeRecepcionista(usuario.recepcionistaId);
    sedesResp = await prisma.sede.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true } });
  } else {
    sedesResp = usuario.sedes.map((us: { sedeId: string; sede: { nombre: string } }) => ({ id: us.sedeId, nombre: us.sede.nombre }));
  }
  const sedeIds = sedesResp.map((s) => s.id);
  const permisos = await getPermisosRol(usuario.rol);
  const token = signToken({ userId: usuario.id, rol: usuario.rol, sedes: sedeIds, permisos, profesionalId: usuario.profesionalId ?? null });

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
      sedes: sedesResp,
      ...perfilClinico(usuario.profesional, permisos),
    },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.user!.userId },
    include: { sedes: { include: { sede: { select: { id: true, nombre: true, color: true } } } }, profesional: profesionalSelect },
  });
  if (!usuario) throw new AppError('Usuario no encontrado', 404);

  const permisos = await getPermisosRol(usuario.rol);

  // Igual que login: recepcionista vinculada → sedes derivadas del roster (Movimientos).
  const sedes = usuario.recepcionistaId
    ? await prisma.sede.findMany({
        where: { id: { in: await sedesVigentesDeRecepcionista(usuario.recepcionistaId) } },
        select: { id: true, nombre: true, color: true },
      })
    : usuario.sedes.map((us: { sedeId: string; sede: { nombre: string; color: string } }) => ({
        id: us.sedeId, nombre: us.sede.nombre, color: us.sede.color,
      }));

  res.json({
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    permisos,
    sedes,
    ...perfilClinico(usuario.profesional, permisos),
  });
});

export default router;
