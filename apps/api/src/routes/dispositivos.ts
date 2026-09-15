/**
 * Administración de los APARATOS de consultorio (ESP32 con botones INICIO / FIN).
 * Permiso `dispositivos.gestionar` (admin y coordinadora). Todo queda auditado.
 *
 * La clave del aparato (`lbd_<prefijo>.<secreto>`) se muestra UNA sola vez: al crear y al
 * regenerar. En la BD solo queda su sha256 (ver middleware/authDispositivo.ts).
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { generarTokenDispositivo } from '../middleware/authDispositivo';
import { auditEnTx } from '../services/audit';

const router = Router();
router.use(requireAuth, requirePermiso('dispositivos.gestionar'));

// «En línea» = hubo latido o botón hace menos de 150 s (el aparato late cada 60 s).
const EN_LINEA_MS = 150_000;

const seleccion = {
  id: true, nombre: true, sedeId: true, unidadNegocioId: true, consultorioNumero: true, tokenPrefijo: true,
  activo: true, ultimoContacto: true, ultimaIp: true, firmware: true, rssi: true, creadoEn: true,
  sede: { select: { id: true, nombre: true, consultorios: true } },
  unidadNegocio: { select: { id: true, nombre: true } },
} as const;

async function conEstado<T extends { id: string; ultimoContacto: Date | null }>(lista: T[]) {
  const enCurso = lista.length
    ? await prisma.tiempoTratamiento.findMany({
        where: { dispositivoId: { in: lista.map((d) => d.id) }, estado: 'en_curso', deletedAt: null },
        select: { dispositivoId: true, inicioEn: true, citaId: true },
      })
    : [];
  const ahora = Date.now();
  return lista.map((d) => ({
    ...d,
    enLinea: !!d.ultimoContacto && ahora - d.ultimoContacto.getTime() < EN_LINEA_MS,
    tiempoEnCurso: enCurso.find((t) => t.dispositivoId === d.id) ?? null,
  }));
}

const ctx = (req: Request) => ({ usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });

/** Valida que la unidad opere en la sede y que el número exista en la sede. */
async function validarUbicacion(sedeId: string, unidadNegocioId: string, consultorioNumero: number) {
  const sede = await prisma.sede.findFirst({ where: { id: sedeId, deletedAt: null }, select: { consultorios: true, nombre: true } });
  if (!sede) throw new AppError('Sede no encontrada', 404);
  const enlace = await prisma.sedeUnidadNegocio.findUnique({ where: { sedeId_unidadNegocioId: { sedeId, unidadNegocioId } } });
  if (!enlace) throw new AppError('Esa unidad no opera en la sede', 400, 'UNIDAD_NO_EN_SEDE');
  if (sede.consultorios < 1) throw new AppError(`La sede ${sede.nombre} no tiene consultorios configurados`, 400, 'SEDE_SIN_CONSULTORIOS');
  if (consultorioNumero < 1 || consultorioNumero > sede.consultorios) {
    throw new AppError(`La sede ${sede.nombre} tiene consultorios del 1 al ${sede.consultorios}`, 400, 'CONSULTORIO_INVALIDO');
  }
}

// El índice parcial `dispositivos_consultorio_unico` (1 aparato activo por consultorio) llega como
// P2002 con las COLUMNAS como target (no el nombre), así que se traduce aquí, donde no hay ambigüedad.
async function unicoPorConsultorio<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      throw new AppError('Ese consultorio ya tiene un aparato activo. Revócalo antes de registrar otro.', 409, 'CONSULTORIO_CON_APARATO');
    }
    throw e;
  }
}

async function tieneTiempoEnCurso(dispositivoId: string) {
  return !!(await prisma.tiempoTratamiento.findFirst({ where: { dispositivoId, estado: 'en_curso', deletedAt: null }, select: { id: true } }));
}

async function buscar(id: string, req: Request) {
  const d = await prisma.dispositivoConsultorio.findFirst({ where: { id, deletedAt: null } });
  if (!d) throw new AppError('Aparato no encontrado', 404);
  assertSede(req, d.sedeId);
  return d;
}

// GET /dispositivos?sedeId= — lista con «en línea» y el tratamiento en curso.
router.get('/', async (req, res) => {
  const sedeId = typeof req.query.sedeId === 'string' ? req.query.sedeId : undefined;
  if (sedeId) assertSede(req, sedeId);
  const lista = await prisma.dispositivoConsultorio.findMany({
    where: { deletedAt: null, ...(sedeId ? { sedeId } : {}) },
    select: seleccion,
    orderBy: [{ sedeId: 'asc' }, { consultorioNumero: 'asc' }],
  });
  res.json(await conEstado(lista));
});

const crearSchema = z.object({
  nombre: z.string().trim().min(2).max(40),
  sedeId: z.string().uuid(),
  unidadNegocioId: z.string().uuid(),
  consultorioNumero: z.number().int().min(1).max(99),
});

// POST /dispositivos — registra un aparato y devuelve su clave (única vez que se ve).
router.post('/', async (req, res) => {
  const data = crearSchema.parse(req.body);
  assertSede(req, data.sedeId);
  await validarUbicacion(data.sedeId, data.unidadNegocioId, data.consultorioNumero);
  const { token, prefijo, hash } = generarTokenDispositivo();
  const creado = await unicoPorConsultorio(() => prisma.$transaction(async (tx) => {
    const d = await tx.dispositivoConsultorio.create({
      data: { ...data, tokenPrefijo: prefijo, tokenHash: hash, creadoPor: req.user?.userId },
      select: seleccion,
    });
    await auditEnTx(tx, {
      ...ctx(req), accion: 'crear_dispositivo', entidad: 'dispositivo', entidadId: d.id, sedeId: d.sedeId,
      despues: { nombre: d.nombre, consultorioNumero: d.consultorioNumero, unidadNegocioId: d.unidadNegocioId, tokenPrefijo: prefijo },
    });
    return d;
  }));
  res.status(201).json({ dispositivo: (await conEstado([creado]))[0], token });
});

const editarSchema = z.object({
  nombre: z.string().trim().min(2).max(40).optional(),
  sedeId: z.string().uuid().optional(),
  unidadNegocioId: z.string().uuid().optional(),
  consultorioNumero: z.number().int().min(1).max(99).optional(),
});

// PATCH /dispositivos/:id — renombrar o reubicar (no con un tratamiento en curso).
router.patch('/:id', async (req, res) => {
  const data = editarSchema.parse(req.body);
  const d = await buscar(req.params.id, req);
  const sedeId = data.sedeId ?? d.sedeId;
  const unidadNegocioId = data.unidadNegocioId ?? d.unidadNegocioId;
  const consultorioNumero = data.consultorioNumero ?? d.consultorioNumero;
  const reubica = sedeId !== d.sedeId || unidadNegocioId !== d.unidadNegocioId || consultorioNumero !== d.consultorioNumero;
  if (reubica) {
    assertSede(req, sedeId);
    if (await tieneTiempoEnCurso(d.id)) {
      throw new AppError('El aparato tiene un tratamiento en curso. Espera a que termine para moverlo.', 409, 'DISPOSITIVO_EN_USO');
    }
    await validarUbicacion(sedeId, unidadNegocioId, consultorioNumero);
  }
  const actualizado = await unicoPorConsultorio(() => prisma.$transaction(async (tx) => {
    const u = await tx.dispositivoConsultorio.update({
      where: { id: d.id },
      data: { nombre: data.nombre ?? d.nombre, sedeId, unidadNegocioId, consultorioNumero },
      select: seleccion,
    });
    await auditEnTx(tx, {
      ...ctx(req), accion: 'editar_dispositivo', entidad: 'dispositivo', entidadId: d.id, sedeId: u.sedeId,
      antes: { nombre: d.nombre, sedeId: d.sedeId, unidadNegocioId: d.unidadNegocioId, consultorioNumero: d.consultorioNumero },
      despues: { nombre: u.nombre, sedeId, unidadNegocioId, consultorioNumero },
    });
    return u;
  }));
  res.json((await conEstado([actualizado]))[0]);
});

// POST /dispositivos/:id/regenerar — clave nueva (la anterior deja de servir al instante).
// También reactiva un aparato revocado.
router.post('/:id/regenerar', async (req, res) => {
  const d = await buscar(req.params.id, req);
  const { token, prefijo, hash } = generarTokenDispositivo();
  const actualizado = await unicoPorConsultorio(() => prisma.$transaction(async (tx) => {
    const u = await tx.dispositivoConsultorio.update({
      where: { id: d.id }, data: { tokenPrefijo: prefijo, tokenHash: hash, activo: true }, select: seleccion,
    });
    await auditEnTx(tx, {
      ...ctx(req), accion: 'regenerar_clave_dispositivo', entidad: 'dispositivo', entidadId: d.id, sedeId: d.sedeId,
      antes: { tokenPrefijo: d.tokenPrefijo, activo: d.activo }, despues: { tokenPrefijo: prefijo, activo: true },
    });
    return u;
  }));
  res.json({ dispositivo: (await conEstado([actualizado]))[0], token });
});

// POST /dispositivos/:id/revocar — la clave deja de servir; el aparato queda registrado (inactivo).
router.post('/:id/revocar', async (req, res) => {
  const d = await buscar(req.params.id, req);
  const actualizado = await prisma.$transaction(async (tx) => {
    const u = await tx.dispositivoConsultorio.update({ where: { id: d.id }, data: { activo: false }, select: seleccion });
    await auditEnTx(tx, {
      ...ctx(req), accion: 'revocar_dispositivo', entidad: 'dispositivo', entidadId: d.id, sedeId: d.sedeId,
      antes: { activo: d.activo }, despues: { activo: false },
    });
    return u;
  });
  res.json((await conEstado([actualizado]))[0]);
});

// DELETE /dispositivos/:id — baja lógica (se conserva su historial de tiempos y botones).
router.delete('/:id', async (req, res) => {
  const d = await buscar(req.params.id, req);
  if (await tieneTiempoEnCurso(d.id)) {
    throw new AppError('El aparato tiene un tratamiento en curso. Espera a que termine para darlo de baja.', 409, 'DISPOSITIVO_EN_USO');
  }
  await prisma.$transaction(async (tx) => {
    await tx.dispositivoConsultorio.update({ where: { id: d.id }, data: { activo: false, deletedAt: new Date() } });
    await auditEnTx(tx, {
      ...ctx(req), accion: 'eliminar_dispositivo', entidad: 'dispositivo', entidadId: d.id, sedeId: d.sedeId,
      antes: { nombre: d.nombre, consultorioNumero: d.consultorioNumero },
    });
  });
  res.json({ ok: true });
});

export default router;
