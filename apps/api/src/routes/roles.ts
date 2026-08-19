import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';

const router = Router();

// Catálogo GRANULAR (35). Cada permiso = una acción cableada a su candado. Espeja el seed y la
// matriz aprobada. Si agregas uno, cablea su `requirePermiso` en el/los endpoint(s) o no hace nada.
const PERMISOS_VALIDOS = [
  // Citas
  'citas.ver', 'citas.crear', 'citas.reprogramar', 'citas.cancelar', 'citas.estado', 'citas.revertir',
  // Pacientes
  'pacientes.ver', 'pacientes.crear', 'pacientes.editar',
  // Membresías
  'membresias.ver', 'membresias.vender', 'membresias.consumir', 'membresias.gestionar',
  // Promociones
  'promociones.ver', 'promociones.gestionar',
  // Movimientos
  'movimientos.ver', 'movimientos.editar',
  // Horarios / almuerzos
  'horarios.ver', 'horarios.editar',
  // Profesionales y servicios
  'profesionales.ver', 'profesionales.editar', 'competencias.editar', 'servicios.ver', 'servicios.editar',
  // Analítica y exportaciones
  'analytics.ver', 'analytics.agentes', 'exportar.usar',
  // Comunicaciones
  'comunicaciones.gestionar', 'canales.gestionar',
  // Sistema
  'usuarios.ver', 'usuarios.editar', 'roles.editar', 'auditoria.ver', 'notificaciones.ver', 'config.editar',
];

const rolSchema = z.object({
  label: z.string().min(2),
  descripcion: z.string().optional(),
  permisos: z.array(z.enum(PERMISOS_VALIDOS as [string, ...string[]])),
});

const crearSchema = rolSchema.extend({
  nombre: z.string().min(2).regex(/^[a-z0-9_]+$/, 'Solo minúsculas, números y guiones bajos'),
});

// GET /api/v1/roles — lista todos los roles (cualquier usuario autenticado puede verlos para el formulario)
// Incluye `usuariosCount`: cuántos usuarios activos tienen cada rol (footer de las cards).
router.get('/', requireAuth, async (_req, res) => {
  const [roles, conteos] = await Promise.all([
    prisma.rol.findMany({ orderBy: { creadoEn: 'asc' } }),
    prisma.usuario.groupBy({
      by: ['rol'],
      where: { deletedAt: null, activo: true },
      _count: { _all: true },
    }),
  ]);
  const countMap = new Map(conteos.map(c => [c.rol, c._count._all]));
  res.json(roles.map(r => ({ ...r, usuariosCount: countMap.get(r.nombre) ?? 0 })));
});

// GET /api/v1/roles/permisos — lista de permisos disponibles
router.get('/permisos', requireAuth, async (_req, res) => {
  const grupos: Record<string, { id: string; label: string }[]> = {
    'Citas': [
      { id: 'citas.ver', label: 'Ver agenda y citas' },
      { id: 'citas.crear', label: 'Registrar / agendar citas' },
      { id: 'citas.reprogramar', label: 'Reprogramar / mover citas' },
      { id: 'citas.cancelar', label: 'Cancelar citas' },
      { id: 'citas.estado', label: 'Cambiar estado (llegó / en atención / completar / no-show)' },
      { id: 'citas.revertir', label: 'Revertir una cita ya atendida' },
    ],
    'Pacientes': [
      { id: 'pacientes.ver', label: 'Ver pacientes' },
      { id: 'pacientes.crear', label: 'Crear pacientes' },
      { id: 'pacientes.editar', label: 'Editar pacientes' },
    ],
    'Membresías': [
      { id: 'membresias.ver', label: 'Ver catálogo vendible' },
      { id: 'membresias.vender', label: 'Vender membresías a pacientes' },
      { id: 'membresias.consumir', label: 'Descontar / consumir sesiones' },
      { id: 'membresias.gestionar', label: 'Gestionar tipos de membresía y contratos' },
    ],
    'Promociones': [
      { id: 'promociones.ver', label: 'Ver el catálogo de promociones' },
      { id: 'promociones.gestionar', label: 'Crear / editar / eliminar promociones y ver su reporte' },
    ],
    'Movimientos': [
      { id: 'movimientos.ver', label: 'Ver movimientos de personal' },
      { id: 'movimientos.editar', label: 'Crear / editar / eliminar movimientos' },
    ],
    'Horarios y almuerzos': [
      { id: 'horarios.ver', label: 'Ver horarios de sede, ausencias y restricciones' },
      { id: 'horarios.editar', label: 'Gestionar horarios base, excepciones, almuerzos y permisos/ausencias' },
    ],
    'Profesionales y servicios': [
      { id: 'profesionales.ver', label: 'Ver profesionales' },
      { id: 'profesionales.editar', label: 'Crear / editar / activar profesionales' },
      { id: 'competencias.editar', label: 'Editar la matriz de competencias' },
      { id: 'servicios.ver', label: 'Ver el catálogo de servicios' },
      { id: 'servicios.editar', label: 'Crear / editar servicios' },
    ],
    'Analítica y exportaciones': [
      { id: 'analytics.ver', label: 'Ver analytics y reportes' },
      { id: 'analytics.agentes', label: 'Ver desempeño de agentes (Contact Center / Recepción)' },
      { id: 'exportar.usar', label: 'Exportar citas, reactivación e historial' },
    ],
    'Comunicaciones': [
      { id: 'comunicaciones.gestionar', label: 'Recordatorios, confirmación por correo y videos' },
      { id: 'canales.gestionar', label: 'Gestionar canales de reserva' },
    ],
    'Sistema': [
      { id: 'usuarios.ver', label: 'Ver usuarios del sistema' },
      { id: 'usuarios.editar', label: 'Crear / editar / desactivar usuarios' },
      { id: 'roles.editar', label: 'Crear / editar / eliminar roles' },
      { id: 'auditoria.ver', label: 'Ver la auditoría del sistema' },
      { id: 'notificaciones.ver', label: 'Ver / gestionar notificaciones' },
      { id: 'config.editar', label: 'Configuración del sistema (bloques combinados, conciliación, correo)' },
    ],
  };
  res.json(grupos);
});

// POST /api/v1/roles
router.post('/', requireAuth, requirePermiso('roles.editar'), async (req, res) => {
  const data = crearSchema.parse(req.body);
  const existe = await prisma.rol.findUnique({ where: { nombre: data.nombre } });
  if (existe) throw new AppError('Ya existe un rol con ese nombre interno', 409);
  const rol = await prisma.rol.create({ data: { ...data, esSistema: false, creadoPor: req.user?.userId } });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'crear', entidad: 'rol', entidadId: rol.id,
    despues: { nombre: rol.nombre, label: rol.label, descripcion: rol.descripcion, permisos: rol.permisos },
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.status(201).json(rol);
});

// PUT /api/v1/roles/:id
router.put('/:id', requireAuth, requirePermiso('roles.editar'), async (req, res) => {
  const data = rolSchema.parse(req.body);
  const rol = await prisma.rol.findUnique({ where: { id: req.params.id } });
  if (!rol) throw new AppError('Rol no encontrado', 404);
  // BLINDAJE: el rol `admin` es intocable — nadie puede editar/vaciar sus permisos (evita lockout
  // y que un rol con roles.editar se auto-eleve o inutilice al admin). El admin manda por su rol.
  if (rol.nombre === 'admin') throw new AppError('El rol admin está protegido y no se puede editar', 403, 'ROL_ADMIN_PROTEGIDO');
  const actualizado = await prisma.rol.update({ where: { id: req.params.id }, data });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar', entidad: 'rol', entidadId: rol.id,
    antes: { label: rol.label, descripcion: rol.descripcion, permisos: rol.permisos },
    despues: { label: actualizado.label, descripcion: actualizado.descripcion, permisos: actualizado.permisos },
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json(actualizado);
});

// DELETE /api/v1/roles/:id
router.delete('/:id', requireAuth, requirePermiso('roles.editar'), async (req, res) => {
  const rol = await prisma.rol.findUnique({ where: { id: req.params.id } });
  if (!rol) throw new AppError('Rol no encontrado', 404);
  if (rol.esSistema) throw new AppError('No se pueden eliminar roles del sistema', 400);
  const enUso = await prisma.usuario.count({ where: { rol: rol.nombre, deletedAt: null } });
  if (enUso > 0) throw new AppError(`Este rol está asignado a ${enUso} usuario(s). Reasígnalos primero.`, 400);
  await prisma.rol.delete({ where: { id: req.params.id } });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'eliminar', entidad: 'rol', entidadId: rol.id,
    antes: { nombre: rol.nombre, label: rol.label, descripcion: rol.descripcion, permisos: rol.permisos },
    despues: { eliminado: true },
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json({ success: true });
});

export default router;
