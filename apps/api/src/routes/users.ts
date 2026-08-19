import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const soloAdmins = [requireAuth, requirePermiso('usuarios.ver')];
const editarAdmins = [requireAuth, requirePermiso('usuarios.editar')];

const crearSchema = z.object({
  nombre: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  rol: z.string().min(1),
  activo: z.boolean().optional().default(true),
  sedeIds: z.array(z.string().uuid()).optional(), // sedes de LOGIN (a qué sedes puede acceder)
  recepcionistaId: z.string().uuid().nullable().optional(), // vínculo con ficha del roster (Movimientos)
});

const editarSchema = z.object({
  nombre: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  rol: z.string().min(1).optional(),
  activo: z.boolean().optional(),
  sedeIds: z.array(z.string().uuid()).optional(),
  recepcionistaId: z.string().uuid().nullable().optional(),
});

// Selección estándar de un usuario (incluye sedes de login + vínculo con el roster).
const usuarioSelect = {
  id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true, recepcionistaId: true,
  sedes: { select: { sede: { select: { id: true, nombre: true } } } },
  recepcionista: { select: { id: true, nombre: true } },
} as const;
// Aplana `sedes: [{ sede: {...} }]` → `sedes: [{ id, nombre }]`.
const serializarUsuario = (u: { sedes: { sede: { id: string; nombre: string } }[] } & Record<string, unknown>) => ({
  ...u, sedes: u.sedes.map((s) => s.sede),
});

// Valida que todos los sedeIds existan; devuelve el arreglo saneado.
async function validarSedes(sedeIds?: string[]): Promise<string[]> {
  if (!sedeIds || sedeIds.length === 0) return [];
  const unicos = [...new Set(sedeIds)];
  const existentes = await prisma.sede.count({ where: { id: { in: unicos }, deletedAt: null } });
  if (existentes !== unicos.length) throw new AppError('Una o más sedes no existen', 400, 'SEDE_INVALIDA');
  return unicos;
}

// Valida el vínculo con el roster: la ficha existe y no está tomada por OTRO usuario (1:1).
async function validarRecepcionistaLink(recepcionistaId: string, excluirUsuarioId?: string): Promise<void> {
  const rec = await prisma.recepcionista.findFirst({ where: { id: recepcionistaId, deletedAt: null }, select: { id: true } });
  if (!rec) throw new AppError('La ficha de recepción (roster) no existe', 400, 'RECEPCIONISTA_INVALIDA');
  const tomada = await prisma.usuario.findFirst({
    where: { recepcionistaId, deletedAt: null, ...(excluirUsuarioId ? { id: { not: excluirUsuarioId } } : {}) },
    select: { id: true, nombre: true },
  });
  if (tomada) throw new AppError(`Esa ficha ya está vinculada a ${tomada.nombre}`, 409, 'RECEPCIONISTA_YA_VINCULADA');
}

// GET /api/v1/users — lista todos los usuarios (con sus sedes de login)
router.get('/', ...soloAdmins, async (_req, res) => {
  const usuarios = await prisma.usuario.findMany({
    where: { deletedAt: null },
    select: usuarioSelect,
    orderBy: { creadoEn: 'asc' },
  });
  res.json(usuarios.map(serializarUsuario));
});

// GET /api/v1/users/:id
router.get('/:id', ...soloAdmins, async (req, res) => {
  const usuario = await prisma.usuario.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: usuarioSelect,
  });
  if (!usuario) throw new AppError('Usuario no encontrado', 404);
  res.json(serializarUsuario(usuario));
});

// POST /api/v1/users
router.post('/', ...editarAdmins, async (req, res) => {
  const data = crearSchema.parse(req.body);
  // Whitelist: el rol debe existir en la tabla Rol (evita fijar un rol inexistente → usuario sin permisos).
  if (!(await prisma.rol.findFirst({ where: { nombre: data.rol } }))) {
    throw new AppError(`Rol inválido: "${data.rol}"`, 400, 'ROL_INVALIDO');
  }
  const existe = await prisma.usuario.findFirst({ where: { email: data.email.toLowerCase(), deletedAt: null } });
  if (existe) throw new AppError('Ya existe un usuario con ese email', 409);
  const sedeIds = await validarSedes(data.sedeIds);
  if (data.recepcionistaId) await validarRecepcionistaLink(data.recepcionistaId);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const usuario = await prisma.usuario.create({
    data: {
      nombre: data.nombre,
      email: data.email.toLowerCase(),
      passwordHash,
      rol: data.rol,
      activo: data.activo,
      creadoPor: req.user?.userId,
      recepcionistaId: data.recepcionistaId ?? null,
      sedes: { create: sedeIds.map((sedeId) => ({ sedeId })) },
    },
    select: usuarioSelect,
  });
  res.status(201).json(serializarUsuario(usuario));
});

// PUT /api/v1/users/:id
router.put('/:id', ...editarAdmins, async (req, res) => {
  const caller = req.user as AuthPayload;
  const { id } = req.params;
  const data = editarSchema.parse(req.body);

  if (data.activo === false && id === caller.userId) {
    throw new AppError('No puedes desactivarte a ti mismo', 400);
  }

  if (data.rol && !(await prisma.rol.findFirst({ where: { nombre: data.rol } }))) {
    throw new AppError(`Rol inválido: "${data.rol}"`, 400, 'ROL_INVALIDO');
  }

  const update: Record<string, unknown> = {};
  if (data.nombre) update.nombre = data.nombre;
  if (data.email) update.email = data.email.toLowerCase();
  if (data.rol) update.rol = data.rol;
  if (typeof data.activo === 'boolean') update.activo = data.activo;
  if (data.password) update.passwordHash = await bcrypt.hash(data.password, 12);

  // Sedes de login: si vienen en el payload, se SINCRONIZAN (reemplaza el set completo). Si NO
  // vienen (undefined), no se tocan. Un arreglo vacío deja al usuario sin sedes a propósito.
  if (data.sedeIds !== undefined) {
    const sedeIds = await validarSedes(data.sedeIds);
    update.sedes = { deleteMany: {}, create: sedeIds.map((sedeId) => ({ sedeId })) };
  }

  // Vínculo con el roster: null = desvincular; un id = vincular (valida 1:1). undefined = no tocar.
  if (data.recepcionistaId !== undefined) {
    if (data.recepcionistaId) await validarRecepcionistaLink(data.recepcionistaId, id);
    update.recepcionistaId = data.recepcionistaId;
  }

  const usuario = await prisma.usuario.update({
    where: { id },
    data: update,
    select: usuarioSelect,
  });
  res.json(serializarUsuario(usuario));
});

// DELETE /api/v1/users/:id — soft delete
router.delete('/:id', ...editarAdmins, async (req, res) => {
  const caller = req.user as AuthPayload;
  const { id } = req.params;
  if (id === caller.userId) throw new AppError('No puedes desactivarte a ti mismo', 400);
  await prisma.usuario.update({ where: { id }, data: { activo: false, deletedAt: new Date() } });
  res.json({ success: true });
});

export default router;
