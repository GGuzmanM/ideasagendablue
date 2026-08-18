import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';

const router = Router();

// Categoría de un servicio según su unidad de negocio.
function catDeUnidad(nombre: string): 'podo' | 'baro' | 'fisio' | null {
  const n = (nombre ?? '').toLowerCase();
  if (n.includes('baropodometr')) return 'baro';
  if (n.includes('fisio')) return 'fisio';
  if (n.includes('podolog')) return 'podo';
  return null;
}
// Categoría "propia" de un profesional según su tipo.
function catDeTipo(tipo: string): 'podo' | 'baro' | 'fisio' | null {
  return tipo === 'podologa' ? 'podo' : tipo === 'fisioterapeuta' ? 'fisio' : tipo === 'medico' ? 'baro' : null;
}

// Matriz completa de competencias
router.get('/', requireAuth, async (req, res) => {
  const { unidadNegocioId } = req.query as Record<string, string>;

  const competencias = await prisma.competenciaProfesional.findMany({
    where: {
      activa: true,
      ...(unidadNegocioId && { profesional: { unidadNegocioId } }),
    },
    include: {
      profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true, activo: true } },
      servicio: { select: { id: true, nombre: true, codigo: true, color: true, duracionMinutos: true } },
    },
    orderBy: [{ profesional: { apellidos: 'asc' } }, { servicio: { nombre: 'asc' } }],
  });

  res.json(competencias);
});

// Competencias de un profesional
router.get('/profesional/:profesionalId', requireAuth, async (req, res) => {
  const competencias = await prisma.competenciaProfesional.findMany({
    where: { profesionalId: req.params.profesionalId },
    include: { servicio: true },
  });
  res.json(competencias);
});

// Profesionales que hacen un servicio
router.get('/servicio/:servicioId', requireAuth, async (req, res) => {
  const competencias = await prisma.competenciaProfesional.findMany({
    where: { servicioId: req.params.servicioId, activa: true },
    include: { profesional: { include: { asignaciones: { where: { activa: true }, include: { sede: true }, take: 1 } } } },
  });
  res.json(competencias.map((c: { profesional: unknown }) => c.profesional));
});

const toggleSchema = z.object({
  profesionalId: z.string().uuid(),
  servicioId: z.string().uuid(),
  activa: z.boolean(),
});

// Activar/desactivar competencia
router.post('/toggle', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { profesionalId, servicioId, activa } = toggleSchema.parse(req.body);

  // Guard de CATEGORÍA: al HABILITAR, el servicio debe ser del área del profesional (podóloga→podo,
  // fisio→fisio, médico→baro). El baro "por solicitud" para podólogas se asigna desde Movimientos
  // (baro-solicitud), no por aquí. Desactivar (activa=false) siempre se permite (para limpiar).
  if (activa) {
    const [prof, serv] = await Promise.all([
      prisma.profesional.findUnique({ where: { id: profesionalId }, select: { tipo: true } }),
      prisma.servicio.findUnique({ where: { id: servicioId }, select: { unidadNegocio: { select: { nombre: true } } } }),
    ]);
    const catProf = prof ? catDeTipo(prof.tipo) : null;
    const catServ = serv ? catDeUnidad(serv.unidadNegocio?.nombre ?? '') : null;
    if (catProf && catServ && catProf !== catServ) {
      throw new AppError('Ese servicio no corresponde al área del profesional (cruza categoría). El baro por solicitud se asigna desde Movimientos.', 400, 'CATEGORIA_INVALIDA');
    }
  }

  const existing = await prisma.competenciaProfesional.findUnique({
    where: { profesionalId_servicioId: { profesionalId, servicioId } },
  });

  if (existing) {
    const updated = await prisma.competenciaProfesional.update({
      where: { id: existing.id },
      data: { activa },
    });
    await registrarAudit({
      usuarioId: req.user?.userId,
      accion: activa ? 'habilitar_competencia' : 'deshabilitar_competencia',
      entidad: 'competencia_profesional',
      entidadId: existing.id,
      antes: { activa: existing.activa },
      despues: { activa },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    res.json(updated);
  } else {
    const created = await prisma.competenciaProfesional.create({
      data: { profesionalId, servicioId, habilitadoDesde: new Date(), activa, creadoPor: req.user?.userId },
    });
    await registrarAudit({
      usuarioId: req.user?.userId,
      accion: 'crear_competencia',
      entidad: 'competencia_profesional',
      entidadId: created.id,
      antes: null,
      despues: { profesionalId, servicioId, activa },
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    res.status(201).json(created);
  }
});

export default router;
