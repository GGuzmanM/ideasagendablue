import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { esRolConFicha, resolverFichaEnTx, FichaResuelta, nombreDeUsuarioAFichaEnTx } from '../services/fichaUsuarioService';
import { auditEnTx } from '../services/audit';

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
  profesionalId: z.string().uuid().nullable().optional(), // vínculo con ficha de Profesional (médico con login → HC/receta)
  // Alta en UN paso (recepcionista, médico, podóloga): crea su ficha con la sede donde empieza —o
  // vincula la que ya existía con ese nombre— y deja el usuario enlazado. Ver fichaUsuarioService.
  crearFicha: z.object({ sedeId: z.string().uuid(), colegiatura: z.string().trim().max(30).nullable().optional() }).optional(),
});

const editarSchema = z.object({
  nombre: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  rol: z.string().min(1).optional(),
  activo: z.boolean().optional(),
  sedeIds: z.array(z.string().uuid()).optional(),
  recepcionistaId: z.string().uuid().nullable().optional(),
  profesionalId: z.string().uuid().nullable().optional(),
  crearFicha: z.object({ sedeId: z.string().uuid(), colegiatura: z.string().trim().max(30).nullable().optional() }).optional(),
  // CMP del médico: se guarda en SU ficha de profesional (la receta lo toma de ahí). '' o null = quitarlo.
  colegiatura: z.string().trim().max(30).nullable().optional(),
});

// Selección estándar de un usuario (incluye sedes de login + vínculos con roster y profesional).
const usuarioSelect = {
  id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true, recepcionistaId: true, profesionalId: true,
  sedes: { select: { sede: { select: { id: true, nombre: true } } } },
  recepcionista: { select: { id: true, nombre: true } },
  profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true, colegiatura: true, esEquipo: true } },
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

// Valida el vínculo con la ficha de PROFESIONAL (Historia clínica): existe, no es un equipo (Baro) y
// no está tomada por OTRO usuario (1:1). La colegiatura NO se exige aquí (se exige al emitir receta).
async function validarProfesionalLink(profesionalId: string, excluirUsuarioId?: string): Promise<void> {
  const prof = await prisma.profesional.findFirst({ where: { id: profesionalId, deletedAt: null }, select: { id: true, esEquipo: true } });
  if (!prof) throw new AppError('La ficha de profesional no existe', 400, 'PROFESIONAL_INVALIDO');
  if (prof.esEquipo) throw new AppError('No se puede vincular un usuario a un equipo (Baro)', 400, 'PROFESIONAL_ES_EQUIPO');
  const tomada = await prisma.usuario.findFirst({
    where: { profesionalId, deletedAt: null, ...(excluirUsuarioId ? { id: { not: excluirUsuarioId } } : {}) },
    select: { id: true, nombre: true },
  });
  if (tomada) throw new AppError(`Ese profesional ya está vinculado a ${tomada.nombre}`, 409, 'PROFESIONAL_YA_VINCULADO');
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

/**
 * Un usuario con rol MÉDICO debe estar vinculado a su ficha de Profesional (persona, tipo médico):
 * sin ese vínculo no hay a nombre de quién registrar la historia clínica ni emitir recetas (el
 * candado de receta exige Usuario.profesionalId → tipo=medico, !esEquipo, colegiatura cargada).
 */
async function validarRolMedico(rol: string | undefined, profesionalId: string | null | undefined, creaFicha = false): Promise<void> {
  if (rol !== 'medico' && rol !== 'podologa') return;
  if (creaFicha) return; // la ficha se crea (o se vincula por nombre) en este mismo guardado
  if (!profesionalId) {
    if (rol === 'podologa') return; // una podóloga puede quedar sin ficha (no ve ninguna agenda hasta tenerla)
    throw new AppError('Un usuario con rol médico necesita su ficha de médico: indica la sede donde empieza para crearla', 400, 'MEDICO_REQUIERE_PROFESIONAL');
  }
  const prof = await prisma.profesional.findFirst({ where: { id: profesionalId, deletedAt: null }, select: { tipo: true } });
  if (rol === 'medico' && prof?.tipo !== 'medico') {
    throw new AppError('El profesional vinculado a un usuario médico debe ser de tipo médico', 400, 'MEDICO_REQUIERE_PROFESIONAL_MEDICO');
  }
  if (rol === 'podologa' && prof?.tipo === 'medico') {
    throw new AppError('El profesional vinculado a un usuario podóloga no puede ser un médico', 400, 'PODOLOGA_REQUIERE_PROFESIONAL_PODOLOGA');
  }
}

// POST /api/v1/users
router.post('/', ...editarAdmins, async (req, res) => {
  const data = crearSchema.parse(req.body);
  if (data.crearFicha && !esRolConFicha(data.rol)) throw new AppError('Ese rol no lleva ficha: su acceso lo da el rol', 400, 'ROL_SIN_FICHA');
  if (data.crearFicha && (data.recepcionistaId || data.profesionalId)) throw new AppError('Elige vincular una ficha existente O crearla, no ambas', 400, 'FICHA_AMBIGUA');
  await validarRolMedico(data.rol, data.profesionalId ?? null, !!data.crearFicha);
  // #7 · Solo un admin puede CREAR una cuenta admin (cierra la escalada: un rol con
  // `usuarios.editar` que no sea admin no puede fabricarse un admin nuevo).
  if (data.rol === 'admin' && (req.user as AuthPayload).rol !== 'admin') {
    throw new AppError('Solo un administrador puede crear una cuenta admin', 403, 'ROL_ADMIN_PROTEGIDO');
  }
  // Whitelist: el rol debe existir en la tabla Rol (evita fijar un rol inexistente → usuario sin permisos).
  if (!(await prisma.rol.findFirst({ where: { nombre: data.rol } }))) {
    throw new AppError(`Rol inválido: "${data.rol}"`, 400, 'ROL_INVALIDO');
  }
  const existe = await prisma.usuario.findFirst({ where: { email: data.email.toLowerCase(), deletedAt: null } });
  if (existe) throw new AppError('Ya existe un usuario con ese email', 409);
  const sedeIds = await validarSedes(data.sedeIds);
  if (data.recepcionistaId) await validarRecepcionistaLink(data.recepcionistaId);
  if (data.profesionalId) await validarProfesionalLink(data.profesionalId);
  const passwordHash = await bcrypt.hash(data.password, 12);
  // Usuario + ficha en UNA transacción: o quedan los dos, o ninguno.
  let ficha = null as FichaResuelta | null;
  const usuario = await prisma.$transaction(async (tx) => {
    ficha = data.crearFicha && esRolConFicha(data.rol)
      ? await resolverFichaEnTx(tx, { rol: data.rol, nombre: data.nombre, sedeId: data.crearFicha.sedeId, colegiatura: data.crearFicha.colegiatura, creadoPor: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined })
      : null;
    return tx.usuario.create({
      data: {
        nombre: data.nombre,
        email: data.email.toLowerCase(),
        passwordHash,
        rol: data.rol,
        activo: data.activo,
        creadoPor: req.user?.userId,
        recepcionistaId: ficha?.recepcionistaId ?? data.recepcionistaId ?? null,
        profesionalId: ficha?.profesionalId ?? data.profesionalId ?? null,
        sedes: { create: sedeIds.map((sedeId) => ({ sedeId })) },
      },
      select: usuarioSelect,
    });
  });
  res.status(201).json({ ...serializarUsuario(usuario), ficha });
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

  // ── #7 · Anti escalada de privilegios y anti lockout del admin ───────────────
  const callerEsAdmin = caller.rol === 'admin';
  // Estado actual del objetivo — SIEMPRE (no solo cuando el payload trae rol/activo). CLAVE: sin
  // esto, un payload que solo cambia `password`/`email` de un admin se saltaba las guardas y
  // permitía RESETEAR la contraseña del admin → tomar su cuenta.
  const objetivo = await prisma.usuario.findFirst({ where: { id, deletedAt: null }, select: { rol: true, profesionalId: true } });
  // Rol médico: se valida con los valores EFECTIVOS (lo que trae el payload o lo que ya tiene el usuario).
  await validarRolMedico(data.rol ?? objetivo?.rol, data.profesionalId !== undefined ? data.profesionalId : objetivo?.profesionalId, !!data.crearFicha);

  // (a) Un NO-admin NO puede tocar a un usuario admin por NINGUNA vía (password/email/rol/sedes/…),
  //     ni asignar el rol admin a nadie. Solo un admin gestiona cuentas admin.
  if (!callerEsAdmin && (objetivo?.rol === 'admin' || data.rol === 'admin')) {
    throw new AppError('Solo un administrador puede modificar o asignar cuentas admin', 403, 'ROL_ADMIN_PROTEGIDO');
  }

  // (b) No dejar el sistema SIN admins: si a un admin se le cambia el rol o se le desactiva, debe
  //     quedar ≥1 admin activo (evita el lockout, incluido el auto-degradarse el único admin).
  const quitaCondicionAdmin =
    objetivo?.rol === 'admin' &&
    ((data.rol !== undefined && data.rol !== 'admin') || data.activo === false);
  if (quitaCondicionAdmin) {
    const otrosAdmins = await prisma.usuario.count({
      where: { rol: 'admin', activo: true, deletedAt: null, id: { not: id } },
    });
    if (otrosAdmins === 0) {
      throw new AppError('No puedes quitar el rol ni desactivar al último administrador (dejaría el sistema sin admins)', 400, 'ULTIMO_ADMIN');
    }
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
  // Vínculo con la ficha de profesional (HC): null = desvincular; un id = vincular (1:1). undefined = no tocar.
  if (data.profesionalId !== undefined) {
    if (data.profesionalId) await validarProfesionalLink(data.profesionalId, id);
    update.profesionalId = data.profesionalId;
  }

  // Usuario que ya existía sin ficha: se le crea (o se le vincula la que coincide) en este guardado.
  let ficha = null as FichaResuelta | null;
  const rolFinal = data.rol ?? objetivo?.rol;
  if (data.crearFicha) {
    if (!esRolConFicha(rolFinal)) throw new AppError('Ese rol no lleva ficha: su acceso lo da el rol', 400, 'ROL_SIN_FICHA');
    const actual = await prisma.usuario.findFirst({ where: { id, deletedAt: null }, select: { recepcionistaId: true, profesionalId: true } });
    if (!actual) throw new AppError('Usuario no encontrado', 404);
    const yaTiene = rolFinal === 'recepcionista' ? actual.recepcionistaId && data.recepcionistaId !== null : actual.profesionalId && data.profesionalId !== null;
    if (yaTiene) throw new AppError('Este usuario ya tiene su ficha vinculada', 409, 'FICHA_YA_VINCULADA');
  }
  const usuario = await prisma.$transaction(async (tx) => {
    if (data.crearFicha && esRolConFicha(rolFinal)) {
      const nombre = data.nombre ?? (await tx.usuario.findUniqueOrThrow({ where: { id }, select: { nombre: true } })).nombre;
      ficha = await resolverFichaEnTx(tx, { rol: rolFinal, nombre, sedeId: data.crearFicha.sedeId, colegiatura: data.crearFicha.colegiatura, creadoPor: caller.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
      if (ficha.recepcionistaId) update.recepcionistaId = ficha.recepcionistaId;
      if (ficha.profesionalId) update.profesionalId = ficha.profesionalId;
    }
    // Un solo nombre por persona: si cambió el del usuario, su ficha (recepción / profesional) lo toma
    // también → Movimientos, agenda y reportes la muestran igual. No aplica si en este mismo guardado
    // se creó o vinculó la ficha (ya nace con el nombre, o se respeta el de la ficha encontrada).
    if (data.nombre && !ficha) {
      const v = await tx.usuario.findUnique({ where: { id }, select: { nombre: true, recepcionistaId: true, profesionalId: true } });
      if (v && v.nombre.trim() !== data.nombre.trim()) {
        await nombreDeUsuarioAFichaEnTx(tx, {
          nombre: data.nombre,
          recepcionistaId: data.recepcionistaId !== undefined ? data.recepcionistaId : v.recepcionistaId,
          profesionalId: data.profesionalId !== undefined ? data.profesionalId : v.profesionalId,
          usuarioId: caller.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
        });
      }
    }
    // CMP desde «Editar usuario»: va a la ficha del médico vinculada (auditado con antes/después).
    if (data.colegiatura !== undefined) {
      const profId = (update.profesionalId as string | null | undefined) ?? objetivo?.profesionalId ?? null;
      const prof = profId ? await tx.profesional.findFirst({ where: { id: profId, deletedAt: null }, select: { id: true, tipo: true, colegiatura: true } }) : null;
      if (!prof || prof.tipo !== 'medico') throw new AppError('El CMP solo se registra en un usuario con ficha de médico', 400, 'CMP_SIN_FICHA_MEDICO');
      const nuevo = data.colegiatura?.trim() || null;
      if (nuevo !== (prof.colegiatura ?? null)) {
        await tx.profesional.update({ where: { id: prof.id }, data: { colegiatura: nuevo } });
        await auditEnTx(tx, { usuarioId: caller.userId, accion: 'editar_cmp', entidad: 'profesional', entidadId: prof.id, antes: { colegiatura: prof.colegiatura ?? null }, despues: { colegiatura: nuevo }, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
      }
    }
    return tx.usuario.update({ where: { id }, data: update, select: usuarioSelect });
  });
  res.json({ ...serializarUsuario(usuario), ficha });
});

// DELETE /api/v1/users/:id — soft delete
router.delete('/:id', ...editarAdmins, async (req, res) => {
  const caller = req.user as AuthPayload;
  const { id } = req.params;
  if (id === caller.userId) throw new AppError('No puedes desactivarte a ti mismo', 400);

  // #7 — Al eliminar (soft delete) a un admin: solo otro admin puede hacerlo, y nunca al último.
  const objetivo = await prisma.usuario.findFirst({ where: { id, deletedAt: null }, select: { rol: true } });
  if (objetivo?.rol === 'admin') {
    if (caller.rol !== 'admin') {
      throw new AppError('Solo un administrador puede eliminar a otro admin', 403, 'ROL_ADMIN_PROTEGIDO');
    }
    const otrosAdmins = await prisma.usuario.count({ where: { rol: 'admin', activo: true, deletedAt: null, id: { not: id } } });
    if (otrosAdmins === 0) {
      throw new AppError('No puedes eliminar al último administrador', 400, 'ULTIMO_ADMIN');
    }
  }

  await prisma.usuario.update({ where: { id }, data: { activo: false, deletedAt: new Date() } });
  res.json({ success: true });
});

export default router;
