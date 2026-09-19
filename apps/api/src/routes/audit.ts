import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';

const router = Router();

// Entidades cuyo antes/despues es contenido clínico (Ley 29733): reservado a quien tiene hc.ver.
const ENTIDADES_CLINICAS = new Set([
  'historia_clinica', 'atencion_clinica', 'nota_evolucion', 'diagnostico_atencion', 'procedimiento_atencion', 'escala_clinica',
  'marca_podograma', 'imagen_podograma', 'dibujo_silueta', 'foto_clinica', 'receta', 'receta_favorita', 'consentimiento', 'control_sugerido',
]);

// ─── GET /audit ───────────────────────────────────────────────────────────────
// Lista paginada de audit_logs con filtros. Incluye usuario, sede (con color)
// y — si la entidad es una cita — el nombre del paciente para el resumen.
router.get('/', requireAuth, requirePermiso('auditoria.ver'), async (req, res) => {
  const {
    sedeId, usuarioId, entidad, accion, q,
    desde, hasta, page = '1', limit = '50',
  } = req.query as Record<string, string>;

  const skip = (Number(page) - 1) * Number(limit);

  const where: Prisma.AuditLogWhereInput = {};
  if (sedeId) where.sedeId = sedeId;
  if (usuarioId === 'sistema') where.usuarioId = null;
  else if (usuarioId) where.usuarioId = usuarioId;
  if (entidad) where.entidad = entidad;
  if (accion) where.accion = { contains: accion, mode: 'insensitive' };
  if (desde || hasta) {
    where.creadoEn = {};
    if (desde) where.creadoEn.gte = new Date(desde + 'T00:00:00');
    if (hasta) where.creadoEn.lte = new Date(hasta + 'T23:59:59');
  }
  if (q) {
    // Busca por lo que una persona escribe: nombre del paciente de la cita, del usuario, la IP o
    // (para quien conoce las claves) la acción/entidad técnica.
    where.OR = [
      { accion: { contains: q, mode: 'insensitive' } },
      { entidad: { contains: q, mode: 'insensitive' } },
      { ip: { contains: q } },
      { usuario: { nombre: { contains: q, mode: 'insensitive' } } },
      { cita: { paciente: { OR: [
        { nombres: { contains: q, mode: 'insensitive' } },
        { apellidoPaterno: { contains: q, mode: 'insensitive' } },
        { apellidoMaterno: { contains: q, mode: 'insensitive' } },
        { numeroDocumento: { contains: q } },
      ] } } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        usuario: { select: { id: true, nombre: true, email: true, rol: true } },
        cita: {
          select: {
            id: true,
            horaInicio: true,
            fecha: true,
            paciente: { select: { nombres: true, apellidoPaterno: true } },
            servicio: { select: { nombre: true } },
            profesional: { select: { nombres: true, apellidos: true } },
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
      skip,
      take: Number(limit),
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Sedes por id (para adjuntar nombre + color sin joins en la consulta principal).
  const sedeIds = [...new Set(logs.map(l => l.sedeId).filter((x): x is string => !!x))];
  const sedes = sedeIds.length
    ? await prisma.sede.findMany({ where: { id: { in: sedeIds } }, select: { id: true, nombre: true, color: true } })
    : [];
  const sedeMap = new Map(sedes.map(s => [s.id, s]));

  // Contenido clínico: los logs de la historia clínica llevan en antes/despues el texto de notas,
  // diagnósticos, ítems de receta… Solo lo ve quien puede ver la historia (hc.ver); el resto ve el
  // rastro (quién, cuándo, qué acción) sin el contenido.
  const veContenidoClinico = (req.user?.permisos ?? []).includes('hc.ver');
  const dataEnriquecida = logs.map(l => ({
    ...l,
    ...(ENTIDADES_CLINICAS.has(l.entidad) && !veContenidoClinico ? { antes: null, despues: null, contenidoReservado: true } : {}),
    sede: l.sedeId ? sedeMap.get(l.sedeId) ?? null : null,
  }));

  // ── Resolver UUIDs en antes/despues a nombres humanos ─────────────────────
  // Recorremos los campos *Id de todos los payloads y resolvemos batch por
  // tipo. El resultado va en `nombresPorId`, un mapa { uuid: "nombre legible" }
  // que el frontend consulta para mostrar nombres en vez de códigos en el diff.
  const nombresPorId = await resolverNombres(logs);
  const valoresLegibles = await resolverValoresLegibles();

  res.json({
    data: dataEnriquecida,
    nombresPorId,
    valoresLegibles,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
  });
});

// Mapa CAMPO → TABLA para saber a qué modelo consultar por cada tipo de id.
type TipoEntidad =
  | 'sede' | 'paciente' | 'profesional' | 'servicio'
  | 'unidadNegocio' | 'usuario' | 'promocion' | 'paquete'
  | 'paquetePaciente' | 'canal' | 'subcategoria' | 'rol' | 'servicioVideo'
  | 'dispositivo' | 'bloqueoAgenda' | 'asignacionSede' | 'cita' | 'competencia' | 'combinacion' | 'excepcionHorario';

const CAMPO_A_MODELO: Record<string, TipoEntidad> = {
  sedeId: 'sede',
  sedeAnterior: 'sede',
  sedeAnteriorId: 'sede',
  sedeOrigenId: 'sede',
  sedeDestinoId: 'sede',
  pacienteId: 'paciente',
  profesionalId: 'profesional',
  solicitadoProfesionalId: 'profesional',
  reemplazaProfesionalId: 'profesional',
  medicoId: 'profesional',
  medicoSoltado: 'profesional',
  medicoAsignadoPorId: 'usuario',
  dispositivoId: 'dispositivo',
  citaId: 'cita',
  citaAnteriorId: 'cita',
  reemplazaA: 'asignacionSede',
  canceladoPorUsuarioId: 'usuario',
  usuarioId: 'usuario',
  autorId: 'usuario',
  creadoPorUsuarioId: 'usuario',
  enviadoManualPor: 'usuario',
  // Historia clínica
  autorUsuarioId: 'usuario',
  abiertaPorUsuarioId: 'usuario',
  registradoPorUsuarioId: 'usuario',
  editadaPorUsuarioId: 'usuario',
  anuladaPorUsuarioId: 'usuario',
  guardadoPorUsuarioId: 'usuario',
  emisorProfesionalId: 'profesional',
  emisorUsuarioId: 'usuario',
  servicioId: 'servicio',
  unidadNegocioId: 'unidadNegocio',
  promocionId: 'promocion',
  paquetePacienteId: 'paquetePaciente',
  paqueteId: 'paquete',
  canalId: 'canal',
  subcategoriaId: 'subcategoria',
  servicioVideoId: 'servicioVideo',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Escanea antes/despues de una tanda de logs, agrupa los UUIDs por tipo y
 * resuelve batch a nombres humanos (una consulta por tabla). Retorna un mapa
 * plano { uuid → "Nombre legible" } que el frontend consume para reemplazar
 * los códigos por sus etiquetas en el diff.
 */
// Mapa ENTIDAD (columna del log) → TABLA, para resolver el entidadId principal.
const ENTIDAD_A_TIPO: Record<string, TipoEntidad> = {
  sede: 'sede',
  horario_sede: 'sede', // el entidadId de un cambio de horario ES el sedeId
  paciente: 'paciente',
  profesional: 'profesional',
  servicio: 'servicio',
  usuario: 'usuario',
  promocion: 'promocion',
  paquete: 'paquete',
  canal: 'canal',
  subcategoria: 'subcategoria',
  unidad_negocio: 'unidadNegocio',
  rol: 'rol',
  servicio_video: 'servicioVideo', // el entidadId de un video ES el servicioVideoId
  historia_clinica: 'paciente', // el entidadId de la HC (ver_hc, antecedentes, alergias) ES el pacienteId
  paquete_paciente: 'paquetePaciente',
  dispositivo: 'dispositivo',
  bloqueo_agenda: 'bloqueoAgenda',
  almuerzo: 'bloqueoAgenda',
  asignacion_sede: 'asignacionSede',
  tiempo_tratamiento: 'cita', // se audita con el citaId cuando existe (si no, el id del tiempo no resuelve)
  competencia_profesional: 'competencia',
  combinacion_permitida: 'combinacion',
  excepcion_horario: 'excepcionHorario',
  subcategoria_servicio: 'subcategoria',
};

// Etiquetas de catálogos CONFIGURABLES (valor técnico → etiqueta) que el front no conoce:
// canal de reserva (tabla Canal) y rol (tabla Rol). Se devuelven por campo.
async function resolverValoresLegibles(): Promise<Record<string, Record<string, string>>> {
  const [canales, roles] = await Promise.all([
    prisma.canal.findMany({ select: { valor: true, etiqueta: true } }),
    prisma.rol.findMany({ select: { nombre: true, label: true } }),
  ]);
  return {
    canal: Object.fromEntries(canales.map((c) => [c.valor, c.etiqueta])),
    rol: Object.fromEntries(roles.map((r) => [r.nombre, r.label])),
  };
}

const fmtFecha = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10).split('-').reverse().join('/') : '');
const nombreCorto = (p: { nombres: string; apellidos: string }) => `${p.nombres.split(' ')[0]} ${p.apellidos.split(' ')[0]}`;

async function resolverNombres(logs: { entidad: string; entidadId: string; antes: unknown; despues: unknown }[]): Promise<Record<string, string>> {
  const idsPorTipo: Record<string, Set<string>> = {};

  const agregar = (tipo: TipoEntidad | undefined, valor: unknown) => {
    if (!tipo || typeof valor !== 'string' || !UUID_RE.test(valor)) return;
    (idsPorTipo[tipo] ??= new Set()).add(valor);
  };

  // UUIDs bajo claves que no están en el mapa (p. ej. un `*Id` nuevo): se intentan resolver contra
  // las tablas más comunes, para que en la pantalla nunca quede un código si el registro existe.
  const desconocidos = new Set<string>();
  for (const log of logs) {
    // 1) El entidadId principal, según el tipo de entidad del log.
    agregar(ENTIDAD_A_TIPO[log.entidad], log.entidadId);
    // 2) Todos los *Id dentro de antes/despues.
    for (const obj of [log.antes, log.despues]) {
      if (!obj || typeof obj !== 'object') continue;
      for (const [campo, valor] of Object.entries(obj as Record<string, unknown>)) {
        const tipo = CAMPO_A_MODELO[campo];
        if (tipo) agregar(tipo, valor);
        else if (typeof valor === 'string' && UUID_RE.test(valor) && !['slotGrupoId', 'bloque', 'idempotencyKey', 'id', 'comentarioId', 'resendEmailId', 'cerroAsignacionId'].includes(campo)) desconocidos.add(valor);
      }
    }
  }
  if (desconocidos.size) {
    const ids = [...desconocidos];
    for (const t of ['usuario', 'profesional', 'paciente', 'sede', 'servicio', 'promocion', 'paquetePaciente'] as const) {
      (idsPorTipo[t] ??= new Set());
      for (const id of ids) idsPorTipo[t].add(id);
    }
  }

  const nombres: Record<string, string> = {};
  const tareas: Promise<void>[] = [];

  const push = <T extends { id: string }>(prom: Promise<T[]>, formatter: (row: T) => string) => {
    tareas.push(prom.then(rows => { for (const r of rows) nombres[r.id] = formatter(r); }));
  };

  if (idsPorTipo.sede)     push(prisma.sede.findMany({ where: { id: { in: [...idsPorTipo.sede] } }, select: { id: true, nombre: true } }), r => r.nombre);
  if (idsPorTipo.paciente) push(prisma.paciente.findMany({ where: { id: { in: [...idsPorTipo.paciente] } }, select: { id: true, nombres: true, apellidoPaterno: true } }), r => `${r.nombres.split(' ')[0]} ${r.apellidoPaterno}`);
  if (idsPorTipo.profesional) push(prisma.profesional.findMany({ where: { id: { in: [...idsPorTipo.profesional] } }, select: { id: true, nombres: true, apellidos: true } }), r => `${r.nombres.split(' ')[0]} ${r.apellidos.split(' ')[0]}`);
  if (idsPorTipo.usuario)  push(prisma.usuario.findMany({ where: { id: { in: [...idsPorTipo.usuario] } }, select: { id: true, nombre: true } }), r => r.nombre);
  if (idsPorTipo.servicio) push(prisma.servicio.findMany({ where: { id: { in: [...idsPorTipo.servicio] } }, select: { id: true, nombre: true } }), r => r.nombre);
  if (idsPorTipo.unidadNegocio) push(prisma.unidadNegocio.findMany({ where: { id: { in: [...idsPorTipo.unidadNegocio] } }, select: { id: true, nombre: true } }), r => r.nombre);
  if (idsPorTipo.promocion) push(prisma.promocion.findMany({ where: { id: { in: [...idsPorTipo.promocion] } }, select: { id: true, nombre: true } }), r => r.nombre);
  if (idsPorTipo.paquete)  push(prisma.paquete.findMany({ where: { id: { in: [...idsPorTipo.paquete] } }, select: { id: true, nombre: true } }), r => r.nombre);
  if (idsPorTipo.paquetePaciente) push(prisma.paquetePaciente.findMany({ where: { id: { in: [...idsPorTipo.paquetePaciente] } }, select: { id: true, paquete: { select: { nombre: true } } } }), r => r.paquete?.nombre ?? 'Paquete');
  if (idsPorTipo.canal)    push(prisma.canal.findMany({ where: { id: { in: [...idsPorTipo.canal] } }, select: { id: true, etiqueta: true } }), r => r.etiqueta);
  if (idsPorTipo.subcategoria) push(prisma.subcategoriaServicio.findMany({ where: { id: { in: [...idsPorTipo.subcategoria] } }, select: { id: true, nombre: true } }), r => r.nombre);
  if (idsPorTipo.rol)      push(prisma.rol.findMany({ where: { id: { in: [...idsPorTipo.rol] } }, select: { id: true, label: true } }), r => r.label);
  if (idsPorTipo.servicioVideo) push(prisma.servicioVideo.findMany({ where: { id: { in: [...idsPorTipo.servicioVideo] } }, select: { id: true, tituloVideo: true } }), r => r.tituloVideo);
  if (idsPorTipo.dispositivo) push(prisma.dispositivoConsultorio.findMany({ where: { id: { in: [...idsPorTipo.dispositivo] } }, select: { id: true, nombre: true } }), r => r.nombre);
  if (idsPorTipo.cita) push(
    prisma.cita.findMany({ where: { id: { in: [...idsPorTipo.cita] } }, select: { id: true, fecha: true, horaInicio: true, paciente: { select: { nombres: true, apellidoPaterno: true } } } }),
    r => `Cita de ${r.paciente.nombres.split(' ')[0]} ${r.paciente.apellidoPaterno} · ${fmtFecha(r.fecha)} ${r.horaInicio}`,
  );
  if (idsPorTipo.bloqueoAgenda) push(
    prisma.bloqueoAgenda.findMany({ where: { id: { in: [...idsPorTipo.bloqueoAgenda] } }, select: { id: true, tipo: true, motivo: true, horaInicio: true, horaFin: true, fechaInicio: true, profesional: { select: { nombres: true, apellidos: true } } } }),
    r => nombreCorto(r.profesional),
  );
  if (idsPorTipo.asignacionSede) push(
    prisma.asignacionSede.findMany({ where: { id: { in: [...idsPorTipo.asignacionSede] } }, select: { id: true, fechaInicio: true, fechaFin: true, profesional: { select: { nombres: true, apellidos: true } }, sede: { select: { nombre: true } } } }),
    r => `${nombreCorto(r.profesional)} en ${r.sede.nombre} (${fmtFecha(r.fechaInicio)}${r.fechaFin ? ` → ${fmtFecha(r.fechaFin)}` : ''})`,
  );
  if (idsPorTipo.competencia) push(
    prisma.competenciaProfesional.findMany({ where: { id: { in: [...idsPorTipo.competencia] } }, select: { id: true, profesional: { select: { nombres: true, apellidos: true } }, servicio: { select: { nombre: true } } } }),
    r => `${nombreCorto(r.profesional)} · ${r.servicio.nombre}`,
  );
  if (idsPorTipo.combinacion) push(
    prisma.combinacionPermitida.findMany({ where: { id: { in: [...idsPorTipo.combinacion] } }, select: { id: true, servicioAncla: { select: { nombre: true } }, servicio: { select: { nombre: true } } } }),
    r => `${r.servicioAncla?.nombre ?? 'Ancla'} + ${r.servicio.nombre}`,
  );
  if (idsPorTipo.excepcionHorario) push(
    prisma.excepcionHorario.findMany({ where: { id: { in: [...idsPorTipo.excepcionHorario] } }, select: { id: true, fecha: true, sede: { select: { nombre: true } } } }),
    r => `${r.sede.nombre} · ${fmtFecha(r.fecha)}`,
  );

  await Promise.all(tareas);
  return nombres;
}

// ─── GET /audit/stats ─────────────────────────────────────────────────────────
// KPIs para el header: total histórico, acciones hoy, usuarios activos hoy.
router.get('/stats', requireAuth, requirePermiso('auditoria.ver'), async (_req, res) => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const [total, hoyCount, usuariosHoy] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.count({ where: { creadoEn: { gte: hoy } } }),
    prisma.auditLog.groupBy({
      by: ['usuarioId'],
      where: { creadoEn: { gte: hoy }, usuarioId: { not: null } },
    }),
  ]);

  res.json({ total, hoy: hoyCount, usuariosActivos: usuariosHoy.length });
});

// ─── GET /audit/facetas ───────────────────────────────────────────────────────
// Devuelve las opciones únicas para poblar los selects de filtros (entidad,
// acción, usuarios que han generado logs). Cacheable en el cliente.
router.get('/facetas', requireAuth, requirePermiso('auditoria.ver'), async (_req, res) => {
  const [entidades, acciones, conLogs, usuarios] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['entidad'], select: { entidad: true }, orderBy: { entidad: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['accion'], select: { accion: true }, orderBy: { accion: 'asc' } }),
    // Quien ALGUNA VEZ dejó rastro, aunque hoy esté desactivado: su historial se sigue pudiendo filtrar.
    prisma.auditLog.findMany({ distinct: ['usuarioId'], where: { usuarioId: { not: null } }, select: { usuarioId: true } }),
    prisma.usuario.findMany({
      where: { deletedAt: null },
      select: { id: true, nombre: true, rol: true, activo: true },
      orderBy: { nombre: 'asc' },
    }),
  ]);
  const idsConLogs = new Set(conLogs.map((l) => l.usuarioId));

  res.json({
    entidades: entidades.map(e => e.entidad),
    acciones: acciones.map(a => a.accion),
    usuarios: usuarios.filter((u) => u.activo || idsConLogs.has(u.id)),
  });
});

export default router;
