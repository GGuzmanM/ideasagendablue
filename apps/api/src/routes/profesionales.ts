import { nombreDeFichaAUsuarioEnTx } from '../services/fichaUsuarioService';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, requireRol } from '../middleware/auth';
import { fusionarProfesionales, posiblesDuplicados } from '../services/fusionProfesionalService';
import { AppError } from '../middleware/errorHandler';
import { turnosDelDia } from '../services/disponibilidad';
import { fechaDb, hoyLimaStr } from '../utils/fechaLima';
import { esFichaAdicional, fijarSedeBaseEnTx, notificarCambioMovimiento } from '../services/asignacionService';
import { auditEnTx, registrarAudit } from '../services/audit';
import { asignacionesDeLaSemana, estadoEnDia } from '../services/personalSemana';
import { setOverrideTurnoFecha, setPresenciaExcepcion, setHorarioBase, efectosCambioHorario } from '../services/horarioService';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const { sedeId, unidadNegocioId, fecha, activo } = req.query as Record<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { deletedAt: null };
  if (activo !== undefined) where.activo = activo === 'true';

  // Ids de profesionales con cita ese día (columna "bajo demanda"); se llena dentro del
  // bloque sedeId y se usa luego para filtrar columnas en días con excepción abierta.
  const idsConCita = new Set<string>();
  // Pertenece a la unidad O tiene competencia a un servicio activo de esa unidad
  // (permite que un profesional aparezca en otra unidad, p.ej. Daniel Doy en Baropodometría).
  //
  // ¿La unidad es "por máquina" (sin elección de médico, p.ej. Baropodometría → modoReserva
  // 'sin_eleccion')? Entonces la columna fija es la MÁQUINA (los slots que PERTENECEN a la
  // unidad). Ningún doctor real debe ser columna fija de baro aunque tenga una competencia mal
  // puesta como NORMAL — solo aparece si efectivamente OPERA una cita ese día (bajo demanda).
  let esUnidadMaquina = false;
  if (unidadNegocioId) {
    const uni = await prisma.unidadNegocio.findUnique({ where: { id: unidadNegocioId }, select: { modoReserva: true } });
    esUnidadMaquina = uni?.modoReserva === 'sin_eleccion';
    where.OR = [
      { unidadNegocioId },
      { competencias: { some: { activa: true, servicio: { unidadNegocioId, activo: true, deletedAt: null } } } },
    ];
  }

  // Columnas de la agenda por sede+fecha. Dos fuentes:
  //  (1) Profesionales ASIGNADOS a la sede que NO son "solo por solicitud" (columnas fijas:
  //      podólogas/fisios de la sede + los slots automáticos de baro "1 Baro/2 Baro").
  //  (2) Cualquier profesional que TENGA una cita ese día en la sede (columna "bajo demanda":
  //      así aparecen Daniel o un médico solo el día que efectivamente atienden ahí).
  if (sedeId) {
    const fechaDate = fecha ? new Date(fecha + 'T00:00:00') : new Date();
    fechaDate.setHours(0, 0, 0, 0);

    const asignaciones = await prisma.asignacionSede.findMany({
      where: {
        sedeId,
        fechaInicio: { lte: fechaDate },
        OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDate } }],
        profesional: unidadNegocioId ? (
          esUnidadMaquina
            // Unidad por máquina (baro): la columna fija es SOLO la máquina (los slots que
            // pertenecen a la unidad). Un doctor real nunca es columna fija aquí.
            ? { unidadNegocioId }
            // Resto de unidades: columna fija = competencia NORMAL (no solo-por-solicitud) a la
            // unidad. Así Daniel sale como columna en Podología pero NO en Baro (allí es por-solicitud).
            // Una MÁQUINA (Baro 1, Baro 2…) solo es columna fija en SU unidad: aunque tenga competencia
            // en un servicio que el catálogo puso en otra unidad (Ortésicos figura en Podología), no
            // se cuela como columna de Podología. Si de verdad opera una cita ahí ese día, entra por
            // la vía «bajo demanda» de abajo.
            : { esEquipo: false, competencias: { some: { activa: true, soloPorSolicitud: false, servicio: { unidadNegocioId, activo: true, deletedAt: null } } } }
        ) : {},
      },
      select: { profesionalId: true },
    });

    const citasDelDia = await prisma.cita.findMany({
      where: {
        sedeId,
        fecha: new Date((fecha ?? new Date().toISOString().slice(0, 10)) + 'T12:00:00'),
        deletedAt: null,
        profesionalId: { not: null },
        // Una cita CANCELADA/REPROGRAMADA no es presencia: sin este filtro, un profesional
        // que ya NO está asignado a la sede ese día seguía apareciendo como columna
        // fantasma solo porque le cancelaron una cita (Fiorella "seguía" en Paz Soldán
        // el día que su movimiento la mandaba a Lince).
        estado: { notIn: ['cancelada', 'reprogramada'] },
        ...(unidadNegocioId ? { unidadNegocioId } : {}),
      },
      select: { profesionalId: true },
      distinct: ['profesionalId'],
    });

    for (const c of citasDelDia) if (c.profesionalId) idsConCita.add(c.profesionalId);
    const ids = [...new Set([
      ...asignaciones.map((a: { profesionalId: string }) => a.profesionalId),
      ...[...idsConCita],
    ])];
    where.id = { in: ids };
    delete where.OR; // los ids ya quedaron acotados (asignados a la unidad + con cita en la unidad)
  }

  const fechaParaAsignacion = sedeId && fecha
    ? (() => { const d = new Date(fecha + 'T00:00:00'); d.setHours(0, 0, 0, 0); return d; })()
    : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

  const profesionales = await prisma.profesional.findMany({
    where,
    include: {
      unidadNegocio: { select: { id: true, nombre: true, color: true, modoReserva: true } },
      asignaciones: {
        where: {
          fechaInicio: { lte: fechaParaAsignacion },
          OR: [{ fechaFin: null }, { fechaFin: { gte: fechaParaAsignacion } }],
        },
        include: {
          sede: { select: { id: true, nombre: true, color: true } },
          reemplazaProfesional: { select: { id: true, nombres: true, apellidos: true } },
        },
        orderBy: { fechaInicio: 'desc' },
        take: 5, // varias para detectar préstamo (cobertura aquí + su sede base)
      },
      horarios: { where: { activo: true }, select: { diaSemana: true, horaInicio: true, horaFin: true } },
    },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });

  // Turno efectivo del día — RESOLVEDOR ÚNICO (`turnosDelDia`): base semanal +
  // override por fecha, recortado a la ventana de la sede. La agenda muestra
  // EXACTAMENTE lo que el motor de reservas permite; aquí no se recalcula nada.
  const turnos = (sedeId && fecha)
    ? await turnosDelDia(sedeId, fecha, profesionales.map((p) => p.id))
    : new Map<string, { horaInicio: string; horaFin: string }>();

  // ¿La fecha tiene una EXCEPCIÓN de sede ABIERTA? Si sí, las columnas se limitan a las
  // podólogas marcadas (con turno) o con cita ese día. Los demás días NO se filtra.
  const excep = (sedeId && fecha)
    ? await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaDb(fecha) } } })
    : null;
  const esDiaExcepcionAbierta = !!(excep && excep.abierto && excep.horaApertura && excep.horaCierre);

  // Los MÉDICOS no tienen asignación de sede de podología: su sede vigente es la del roster de baro
  // (Movimientos › Doctores). Se usa como `sedeActual` para poder filtrarlos por sede (Competencias).
  const idsMedicos = profesionales.filter((p) => p.tipo === 'medico' && !p.esEquipo).map((p) => p.id);
  const finDia = new Date(fechaParaAsignacion); finDia.setHours(23, 59, 59, 999);
  const baroVigente = idsMedicos.length
    ? await prisma.baroMedicoSede.findMany({
        where: { profesionalId: { in: idsMedicos }, activa: true, fechaInicio: { lte: finDia }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaParaAsignacion } }] },
        select: { profesionalId: true, sede: { select: { id: true, nombre: true, color: true } } },
        orderBy: { fechaInicio: 'desc' },
      })
    : [];
  const sedeBaroDe = new Map<string, { id: string; nombre: string; color: string }>();
  for (const b of baroVigente) if (!sedeBaroDe.has(b.profesionalId)) sedeBaroDe.set(b.profesionalId, b.sede);

  let lista = profesionales.map((p: typeof profesionales[number]) => {
    const turno = turnos.get(p.id);
    return {
    id: p.id,
    nombres: p.nombres,
    apellidos: p.apellidos,
    tipo: p.tipo,
    esEquipo: p.esEquipo, // máquina (Baro 1, Baro 2…), no una persona
    colegiatura: p.colegiatura ?? null,
    emailAgenda: p.emailAgenda ?? null,
    colorAvatar: p.colorAvatar,
    activo: p.activo,
    asignacionAutomatica: p.asignacionAutomatica,
    unidadNegocio: p.unidadNegocio,
    ...(() => {
      // Asignación relevante para ESTA sede+fecha: la que apunta a la sede vista (si hay).
      // Para una podóloga en PRÉSTAMO (cobertura de un día) esa es la cobertura; su sede
      // ORIGEN es su asignación base (a otra sede, no cobertura).
      const asg = (sedeId ? p.asignaciones.find((a) => a.sedeId === sedeId) : undefined) ?? p.asignaciones[0];
      const esPrestamo = !!asg && esCoberturaUnDia(asg);
      const sedeOrigen = esPrestamo
        ? (p.asignaciones.find((a) => a.sedeId !== asg!.sedeId && !esCoberturaUnDia(a))?.sede.nombre ?? null)
        : null;
      return {
        sedeActual: asg?.sede ?? sedeBaroDe.get(p.id) ?? null,
        asignacionActual: asg
          ? {
              id: asg.id,
              fechaFin: asg.fechaFin?.toISOString().slice(0, 10) ?? null,
              motivo: asg.motivo,
              notas: asg.notas,
              reemplazaProfesional: asg.reemplazaProfesional ?? null,
              // Es un MOVIMIENTO real SOLO si reemplaza/cubre a alguien (`reemplazaA`) o si
              // cerró una asignación previa de ESTE profesional (transferencia entre sedes).
              // Un FICHAJE nuevo (inicio de labores) NO es movimiento.
              esMovimiento: !!(asg.reemplazaA || asg.cierraAsignacionId),
              // Préstamo = cobertura de un día traída de otra sede; se muestra "Préstamo {sedeOrigen}".
              esPrestamo,
              sedeOrigen,
            }
          : null,
      };
    })(),
    asignaciones: p.asignaciones.map((a) => ({
      id: a.id,
      sedeId: a.sedeId,
      fechaInicio: a.fechaInicio?.toISOString().slice(0, 10) ?? null,
      fechaFin: a.fechaFin?.toISOString().slice(0, 10) ?? null,
      motivo: a.motivo,
    })),
    iniciales: `${p.nombres[0] ?? ''}${p.apellidos[0] ?? ''}`.toUpperCase(),
    // Turno del día mostrado, tal cual lo resuelve `turnosDelDia` (la misma verdad
    // que usa el motor de reservas). Sin sede/fecha no hay turno que mostrar.
    horaEntrada: turno?.horaInicio ?? null,
    horaSalida: turno?.horaFin ?? null,
    };
  });

  if (esDiaExcepcionAbierta) {
    lista = lista.filter((row) => turnos.has(row.id) || idsConCita.has(row.id));
  }

  // Orden de columnas (izq → der): normales alfabético, luego "Adicional" (capacidad
  // extra), y al final los marcados con `ordenAgenda` (p.ej. Wenceslao al extremo
  // derecho). El sort de V8 es estable → dentro de cada grupo se conserva el alfabético.
  const ordenMap = new Map(profesionales.map((p) => [p.id, p.ordenAgenda]));
  const peso = (row: { id: string; nombres: string }) =>
    ordenMap.get(row.id) ?? (esFichaAdicional(row.nombres) ? 500 : 0);
  lista.sort((a, b) => peso(a) - peso(b));

  res.json(lista);
});

// ─── GET /profesionales/seleccionables?sedeId&unidadNegocioId&fecha ───────────
// Opciones que la recepción puede ELEGIR explícitamente al reservar:
//  - Profesionales "solo por solicitud" con competencia a la unidad (médicos de baro + Daniel),
//    seleccionables en cualquier sede.
//  - Profesionales reales asignados a la sede (podólogas/fisios), excluyendo los slots
//    automáticos genéricos de baro (tipo medico no-solicitud).
// En Baropodometría: por defecto es automático; esto sólo aplica si el paciente pide a alguien.
router.get('/seleccionables', requireAuth, async (req, res) => {
  const { sedeId, unidadNegocioId, fecha, servicioId } = req.query as Record<string, string>;
  if (!unidadNegocioId) throw new AppError('unidadNegocioId requerido', 400);
  const fechaDate = fecha ? new Date(fecha + 'T12:00:00') : new Date();

  // Si viene servicioId, se filtra por competencia a ESE servicio (solo quienes realmente lo hacen);
  // si no, por cualquier servicio de la unidad (compatibilidad).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compFiltro = (extra: Record<string, any> = {}) => ({
    some: servicioId
      ? { activa: true, servicioId, ...extra }
      : { activa: true, servicio: { unidadNegocioId, activo: true, deletedAt: null }, ...extra },
  });

  // Por solicitud: profesionales con una competencia SOLO-POR-SOLICITUD al servicio/unidad (médicos + Daniel en baro).
  // 23-sep-2026: antes salían los de TODAS las sedes y, en Podología, apenas se abría Nueva Cita (desde el 19-sep los
  // médicos tienen «Ortésicos» por solicitud, que es de Podología). Ahora:
  //  · con sede: solo los registrados en ESA sede y vigentes ESA fecha (Movimientos › Baro, tabla baro_medico_sede);
  //  · fuera de Baropodometría: solo cuando el servicio elegido lo hacen ellos (sin servicio no se listan).
  const unidad = await prisma.unidadNegocio.findUnique({ where: { id: unidadNegocioId }, select: { modoReserva: true } });
  const incluirPorSolicitud = !!servicioId || unidad?.modoReserva === 'sin_eleccion';
  const diaSel = fecha ?? new Date().toISOString().slice(0, 10);
  const porSolicitud = !incluirPorSolicitud ? [] : await prisma.profesional.findMany({
    where: {
      deletedAt: null, activo: true, competencias: compFiltro({ soloPorSolicitud: true }),
      ...(sedeId ? {
        baroSedes: { some: {
          sedeId, activa: true, fechaInicio: { lte: new Date(`${diaSel}T23:59:59`) },
          OR: [{ fechaFin: null }, { fechaFin: { gte: new Date(`${diaSel}T00:00:00`) } }],
        } },
      } : {}),
    },
    select: { id: true, nombres: true, apellidos: true, tipo: true },
    orderBy: [{ apellidos: 'asc' }],
  });

  let asignadosReales: { id: string; nombres: string; apellidos: string; tipo: string }[] = [];
  if (sedeId) {
    const asg = await prisma.asignacionSede.findMany({
      where: {
        sedeId,
        fechaInicio: { lte: fechaDate },
        OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDate } }],
        profesional: { activo: true, deletedAt: null, tipo: { not: 'medico' }, competencias: compFiltro() },
      },
      include: { profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } } },
      orderBy: [{ profesional: { apellidos: 'asc' } }],
    });
    asignadosReales = asg.map(a => a.profesional);
  }

  const map = new Map<string, { id: string; nombres: string; apellidos: string; tipo: string; porSolicitud: boolean }>();
  for (const p of asignadosReales) map.set(p.id, { ...p, porSolicitud: false });
  for (const p of porSolicitud) map.set(p.id, { ...p, porSolicitud: true });

  // BLOQUEOS del día por profesional (permisos puntuales + almuerzos recurrentes), para
  // que el selector de especialista DESACTIVE a quien está bloqueado a la hora elegida
  // (misma fuente que usa la disponibilidad; aquí solo se expone al front).
  const fechaStr = fecha ?? new Date().toISOString().slice(0, 10);
  const dayStart = new Date(`${fechaStr}T00:00:00`);
  const dayEnd = new Date(`${fechaStr}T23:59:59`);
  const ids = [...map.keys()];
  const bloqueosDia = ids.length === 0 ? [] : await prisma.bloqueoAgenda.findMany({
    where: {
      profesionalId: { in: ids },
      deletedAt: null,
      OR: [
        { esRecurrente: false, fechaInicio: { lt: dayEnd }, fechaFin: { gt: dayStart } },
        { esRecurrente: true, fechaInicio: { lte: dayEnd }, fechaFin: { gte: dayStart } },
      ],
    },
    select: { profesionalId: true, horaInicio: true, horaFin: true, motivo: true, tipo: true, esVacaciones: true, fechaInicio: true, fechaFin: true },
  });
  const horaDe = (d: Date) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  // `esVacaciones` es el flag AUTORITATIVO de "vacaciones de día completo" (🌴). La agenda lo usa para
  // marcar la columna del profesional; sin él, caía a adivinar por el TEXTO del motivo y marcaba mal
  // un permiso parcial cuyo motivo decía "Vacaciones" (ej.: se retira 15:00 pero trabaja la mañana).
  const bloqueosPorProf = new Map<string, { horaInicio: string; horaFin: string; motivo: string; tipo: string; esVacaciones: boolean }[]>();
  for (const b of bloqueosDia) {
    const arr = bloqueosPorProf.get(b.profesionalId) ?? [];
    arr.push({
      // Hora desde los campos STRING (TZ-safe); fallback a los DateTime para filas viejas.
      horaInicio: b.horaInicio ?? horaDe(b.fechaInicio),
      horaFin: b.horaFin ?? horaDe(b.fechaFin),
      motivo: b.motivo,
      tipo: b.tipo,
      esVacaciones: b.esVacaciones,
    });
    bloqueosPorProf.set(b.profesionalId, arr);
  }

  res.json([...map.values()].map((p) => ({ ...p, bloqueos: bloqueosPorProf.get(p.id) ?? [] })));
});

const profesionalSchema = z.object({
  nombres: z.string().min(2),
  apellidos: z.string().min(2),
  tipo: z.enum(['podologa', 'medico', 'fisioterapeuta']),
  unidadNegocioId: z.string().uuid(),
  colegiatura: z.string().optional().nullable(),
  // Correo de agenda personal del profesional. Si está definido, sus citas se sincronizan a
  // su calendario (invitación .ics; ver outlookCalendarService). '' se normaliza a null abajo.
  emailAgenda: z.string().email('Correo de agenda inválido').or(z.literal('')).nullable().optional(),
  colorAvatar: z.string().optional(),
  activo: z.boolean().optional(),
  // 09-oct-2026: false = nunca se le asigna una cita sola; solo si la eligen (Daniel y Yasica Doy).
  asignacionAutomatica: z.boolean().optional(),
  // Sede BASE de la ficha (desde hoy, sin fecha de fin). Vacío/null = no cambiar. Es la única vía para dar sede a las
  // fichas fijas («Adicional», Baro), que Movimientos rechaza a propósito; a las demás les aplica las mismas reglas.
  sedeId: z.string().uuid().nullable().optional(),
});

router.post('/', requireAuth, requirePermiso('profesionales.editar'), async (req, res) => {
  const { sedeId, ...data } = profesionalSchema.parse(req.body);
  if (data.emailAgenda === '') data.emailAgenda = null; // vacío = sin sincronización de calendario
  // 12-oct-2026: no crear a la misma persona dos veces («Laura Escalante» se creó de nuevo porque la ficha vieja
  // «Laura Kelly Escalante Mendoza» estaba inactiva). Si parece repetida se avisa; para crearla igual, confirmarDuplicado.
  if ((req.body as { confirmarDuplicado?: unknown })?.confirmarDuplicado !== true) {
    const parecidas = await posiblesDuplicados({ nombres: data.nombres, apellidos: data.apellidos, tipo: data.tipo });
    if (parecidas.length) {
      const lista = parecidas.map((x) => `«${x.nombres} ${x.apellidos}»${x.activo ? '' : ' (inactiva)'}`).join(', ');
      res.status(409).json({
        error: 'POSIBLE_DUPLICADO', statusCode: 409, parecidas,
        message: `Ya existe ${lista}. Si es la misma persona, reactiva o edita esa ficha en vez de crear otra.`,
      });
      return;
    }
  }
  const { profesional, cambioSede } = await prisma.$transaction(async (tx) => {
    const p = await tx.profesional.create({
      data: { ...data, creadoPor: req.user?.userId },
      include: { unidadNegocio: { select: { id: true, nombre: true, color: true, modoReserva: true } } },
    });
    const c = sedeId ? await fijarSedeBaseEnTx(tx, { profesionalId: p.id, sedeId, creadoPor: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined }) : undefined;
    // Una ficha «Adicional» es capacidad extra de la sede, no una persona: acepta cualquier tratamiento de su área.
    // Sin competencias la agenda ni siquiera la muestra como columna, así que se habilita todo su catálogo de una vez.
    if (esFichaAdicional(p.nombres)) {
      const servicios = await tx.servicio.findMany({ where: { unidadNegocioId: p.unidadNegocioId, activo: true, deletedAt: null }, select: { id: true } });
      if (servicios.length) await tx.competenciaProfesional.createMany({ data: servicios.map((s) => ({ profesionalId: p.id, servicioId: s.id, activa: true, habilitadoDesde: new Date() })), skipDuplicates: true });
    }
    return { profesional: p, cambioSede: c };
  });
  if (sedeId && cambioSede) await notificarCambioMovimiento({ profesionalId: profesional.id, sedeId, sedeAnteriorId: cambioSede.sedeAnteriorId, fechaInicio: fechaDb(hoyLimaStr()), fechaFin: null });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'crear', entidad: 'profesional', entidadId: profesional.id,
    despues: profesional as unknown as Record<string, unknown>,
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.status(201).json(profesional);
});

// POST /profesionales/:id/fusionar { destinoId } — la ficha :id (duplicada) pasa todo a destinoId y se da de baja.
// Solo administración. Ver services/fusionProfesionalService.ts.
router.post('/:id/fusionar', requireAuth, requireRol('admin'), async (req, res) => {
  const { destinoId } = z.object({ destinoId: z.string().uuid() }).parse(req.body);
  const r = await fusionarProfesionales({
    origenId: z.string().uuid().parse(req.params.id), destinoId,
    usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json(r);
});

router.patch('/:id', requireAuth, requirePermiso('profesionales.editar'), async (req, res) => {
  const { sedeId, ...data } = profesionalSchema.partial().parse(req.body);
  if (data.emailAgenda === '') data.emailAgenda = null; // vacío = quitar la sincronización
  // Capturar el estado ANTES para diffear en auditoría.
  const antes = await prisma.profesional.findUnique({
    where: { id: req.params.id, deletedAt: null },
  });
  const { profesional, cambioSede } = await prisma.$transaction(async (tx) => {
    const p = await tx.profesional.update({
      where: { id: req.params.id, deletedAt: null },
      data,
      include: { unidadNegocio: { select: { id: true, nombre: true, color: true, modoReserva: true } } },
    });
    // Un solo nombre por persona: si cambió el de la ficha, su usuario (si tiene) toma el mismo.
    if (antes && !p.esEquipo && (antes.nombres !== p.nombres || antes.apellidos !== p.apellidos)) {
      await nombreDeFichaAUsuarioEnTx(tx, { nombre: `${p.nombres} ${p.apellidos}`, profesionalId: p.id, usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
    }
    const c = sedeId ? await fijarSedeBaseEnTx(tx, { profesionalId: p.id, sedeId, creadoPor: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined }) : undefined;
    return { profesional: p, cambioSede: c };
  });
  if (sedeId && cambioSede) await notificarCambioMovimiento({ profesionalId: profesional.id, sedeId, sedeAnteriorId: cambioSede.sedeAnteriorId, fechaInicio: fechaDb(hoyLimaStr()), fechaFin: null });
  void registrarAudit({
    usuarioId: req.user?.userId, accion: 'editar', entidad: 'profesional', entidadId: profesional.id,
    antes: antes as unknown as Record<string, unknown>,
    despues: profesional as unknown as Record<string, unknown>,
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.json(profesional);
});

// ─── Gestión de hora de entrada (8:00 / 9:00) por semana — Coordinadora de Sedes ─
// La Coordinadora de Sedes y el admin deciden, SEMANA A SEMANA, qué podólogas entran
// a las 8:00 o 9:00, con excepciones por día. Se guarda en EntradaPodologa (override
// por fecha); si una fecha no tiene override, se usa la entrada base de HorarioProfesional.
const HORAS_ENTRADA = ['08:00', '09:00'] as const;

// Lunes (00:00 UTC) de la semana que contiene la fecha dada.
function lunesDeLaSemana(fechaISO: string): Date {
  const d = new Date(fechaISO + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Dom..6=Sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
// Las 5 fechas Lun..Vie de la semana que contiene la fecha dada.
// (Los sábados la entrada es SIEMPRE 08:00, no es configurable.)
function fechasSemana(fechaISO: string): { fecha: Date; iso: string; diaSemana: number }[] {
  const lun = lunesDeLaSemana(fechaISO);
  const out: { fecha: Date; iso: string; diaSemana: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(lun); d.setUTCDate(lun.getUTCDate() + i);
    out.push({ fecha: d, iso: d.toISOString().slice(0, 10), diaSemana: d.getUTCDay() });
  }
  return out;
}

// GET /profesionales/horarios-entrada?sedeId=X&semana=YYYY-MM-DD
// Devuelve, por podóloga, la entrada (8/9) de cada día Lun-Sáb de esa semana.
router.get('/horarios-entrada', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { sedeId, semana } = req.query as { sedeId?: string; semana?: string };
  if (!sedeId) throw new AppError('sedeId requerido', 400);
  const semanaRef = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : hoyLimaStr();
  const dias = fechasSemana(semanaRef);

  // Quién es de la sede ESA SEMANA (por rango de fechas, no por la asignación de hoy): una podóloga con un movimiento
  // futuro sigue en su sede hasta el día anterior y aparece en la nueva desde su primer día.
  const asignacionesSemana = await asignacionesDeLaSemana(sedeId, dias[0]!.iso, dias[4]!.iso);
  const ids = [...asignacionesSemana.keys()];

  const profs = await prisma.profesional.findMany({
    where: { id: { in: ids }, tipo: 'podologa', deletedAt: null, activo: true },
    select: {
      id: true, nombres: true, apellidos: true, colorAvatar: true,
      horarios: { where: { activo: true }, select: { diaSemana: true, horaInicio: true } },
    },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });

  // Overrides de la semana (Lun-Vie)
  const overrides = await prisma.entradaPodologa.findMany({
    where: { profesionalId: { in: profs.map(p => p.id) }, fecha: { gte: dias[0]!.fecha, lte: dias[4]!.fecha } },
    select: { profesionalId: true, fecha: true, horaInicio: true },
  });
  const ovMap = new Map<string, string>();
  for (const o of overrides) ovMap.set(`${o.profesionalId}|${o.fecha.toISOString().slice(0, 10)}`, o.horaInicio);

  res.json({
    semana: { lunes: dias[0]!.iso, viernes: dias[4]!.iso },
    podologas: profs.map(p => ({
      id: p.id,
      nombres: p.nombres,
      apellidos: p.apellidos,
      colorAvatar: p.colorAvatar,
      dias: dias.map(d => {
        const baseRow = p.horarios.find(h => h.diaSemana === d.diaSemana);
        const ov = ovMap.get(`${p.id}|${d.iso}`);
        const { enSede, sedeOtra } = estadoEnDia(asignacionesSemana.get(p.id) ?? [], sedeId, d.iso);
        // `trabaja=false` = ese día no está en esta sede (movimiento) o no tiene horario base ese día de la semana:
        // el toggle 8/9 no aplica (el resolvedor lo ignora en días normales) y la UI lo muestra como "Libre"/"Otra sede".
        return { fecha: d.iso, diaSemana: d.diaSemana, horaEntrada: ov ?? baseRow?.horaInicio ?? '08:00', esExcepcion: !!ov, trabaja: enSede && !!baseRow, enSede, sedeOtra };
      }),
    })),
  });
});

// PATCH /profesionales/:id/entrada  { fechas: string[], horaInicio: '08:00'|'09:00', forzar? }
// Fija la entrada de 1 o varias fechas (toda la semana = 5 fechas Lun-Vie; excepción = 1 fecha).
// Es un OVERRIDE DE TURNO por fecha (capa 2): afecta la agenda Y los horarios reservables.
// Si el recorte deja citas fuera del turno responde 409 (repetir con forzar:true para aplicar).
router.patch('/:id/entrada', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { fechas, horaInicio, forzar } = z.object({
    fechas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(7),
    horaInicio: z.enum(HORAS_ENTRADA),
    forzar: z.boolean().optional(),
  }).parse(req.body);

  const resultado = await setOverrideTurnoFecha({
    profesionalId: req.params.id, fechas, horaInicio, forzar,
    actor: { usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
  });
  res.json({ ok: true, id: req.params.id, fechas: resultado.fechas, horaInicio });
});

// ─── Personal de un DÍA EXCEPCIONAL habilitado (domingo/feriado que la sede abre) ──
// Lista las podólogas asignadas a la sede con su estado de PRESENCIA ese día (si tienen
// EntradaPodologa = vienen). Solo tiene sentido en una fecha con excepción de sede abierta.
router.get('/personal-excepcion', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { sedeId, fecha } = req.query as { sedeId?: string; fecha?: string };
  if (!sedeId || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new AppError('sedeId y fecha (YYYY-MM-DD) requeridos', 400);
  const fechaPunto = fechaDb(fecha);

  const exc = await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaPunto } } });
  const abierto = !!(exc && exc.abierto && exc.horaApertura && exc.horaCierre);

  const asigs = await prisma.asignacionSede.findMany({
    where: {
      sedeId, fechaInicio: { lte: fechaPunto }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaPunto } }],
      profesional: { tipo: 'podologa', activo: true, deletedAt: null },
    },
    select: { profesionalId: true },
  });
  const ids = [...new Set(asigs.map((a) => a.profesionalId))];
  const profs = await prisma.profesional.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombres: true, apellidos: true, colorAvatar: true },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });
  const entradas = await prisma.entradaPodologa.findMany({ where: { profesionalId: { in: ids }, fecha: fechaPunto }, select: { profesionalId: true, horaInicio: true } });
  const entMap = new Map(entradas.map((e) => [e.profesionalId, e.horaInicio]));

  res.json({
    fecha, abierto, esExcepcion: !!exc,
    apertura: exc?.horaApertura ?? null, cierre: exc?.horaCierre ?? null,
    podologas: profs.map((p) => ({
      id: p.id, nombres: p.nombres, apellidos: p.apellidos, colorAvatar: p.colorAvatar,
      presente: entMap.has(p.id), horaEntrada: entMap.get(p.id) ?? '08:00',
    })),
  });
});

// PATCH /:id/presencia-excepcion { sedeId, fecha, presente, horaInicio? }
// Marca/desmarca a una podóloga como presente un día excepcional habilitado. Presente =
// crea/actualiza su EntradaPodologa (turno [entrada, cierre de la excepción]); ausente = la borra.
router.patch('/:id/presencia-excepcion', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { sedeId, fecha, presente, horaInicio } = z.object({
    sedeId: z.string().uuid(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    presente: z.boolean(),
    horaInicio: z.enum(HORAS_ENTRADA).optional(),
  }).parse(req.body);

  await setPresenciaExcepcion({
    profesionalId: req.params.id, sedeId, fecha, presente, horaInicio,
    actor: { usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
  });
  res.json({ ok: true, id: req.params.id, fecha, presente });
});

// ─── DÍAS ESPECIALES / EXCEPCIONES — herramienta unificada ───────────────────
// Una "cobertura de día especial" es una AsignacionSede de UN día
// (fechaInicio == fechaFin, motivo COBERTURA_EMERGENCIA): trae a una podóloga de
// OTRA sede a trabajar aquí solo esa fecha, SIN tocar su sede base (su asignación
// normal sigue intacta). Aparece como columna porque el agenda filtra por
// AsignacionSede que cubra la fecha. Presencia de las propias = EntradaPodologa.
function esCoberturaUnDia(a: { fechaInicio: Date; fechaFin: Date | null; motivo: string }): boolean {
  return a.motivo === 'COBERTURA_EMERGENCIA' && !!a.fechaFin && a.fechaInicio.getTime() === a.fechaFin.getTime();
}

// GET /profesionales/dia-especial?sedeId&fecha → quién trabaja en la sede esa fecha,
// con TODAS las podólogas (las de la sede + las traíbles de otras) y su estado.
router.get('/dia-especial', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { sedeId, fecha } = req.query as { sedeId?: string; fecha?: string };
  if (!sedeId || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new AppError('sedeId y fecha (YYYY-MM-DD) requeridos', 400);
  const fechaPunto = fechaDb(fecha);

  const exc = await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaPunto } } });
  const abierto = !!(exc && exc.abierto && exc.horaApertura && exc.horaCierre);

  const podologas = await prisma.profesional.findMany({
    where: { tipo: 'podologa', activo: true, deletedAt: null },
    select: {
      id: true, nombres: true, apellidos: true, colorAvatar: true,
      asignaciones: {
        where: { fechaInicio: { lte: fechaPunto }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaPunto } }] },
        select: { sedeId: true, fechaInicio: true, fechaFin: true, motivo: true, sede: { select: { nombre: true } } },
      },
    },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });
  const entradas = await prisma.entradaPodologa.findMany({ where: { profesionalId: { in: podologas.map((p) => p.id) }, fecha: fechaPunto }, select: { profesionalId: true, horaInicio: true } });
  const entMap = new Map(entradas.map((e) => [e.profesionalId, e.horaInicio]));

  const filas = podologas.map((p) => {
    const base = p.asignaciones.find((a) => !esCoberturaUnDia(a)); // asignación normal (no cobertura de un día)
    const coberturaAqui = p.asignaciones.some((a) => a.sedeId === sedeId && esCoberturaUnDia(a));
    const esDeLaSede = base?.sedeId === sedeId;
    return {
      id: p.id, nombres: p.nombres, apellidos: p.apellidos, colorAvatar: p.colorAvatar,
      sedeBase: base?.sede.nombre ?? null,
      esDeLaSede,
      esCobertura: coberturaAqui,
      viene: esDeLaSede ? entMap.has(p.id) : coberturaAqui,
      horaEntrada: entMap.get(p.id) ?? '08:00',
    };
  }).filter((f) => f.esDeLaSede || f.sedeBase); // debe tener sede base para poder traerla

  res.json({
    fecha, abierto, esExcepcion: !!exc,
    apertura: exc?.horaApertura ?? null, cierre: exc?.horaCierre ?? null, nota: exc?.nota ?? null,
    propias: filas.filter((f) => f.esDeLaSede),
    otras: filas.filter((f) => !f.esDeLaSede),
  });
});

// POST /profesionales/dia-especial/set { profesionalId, sedeId, fechas: string[], viene, horaInicio? }
// Aplica a CADA fecha del array (una fecha o un rango). Propia → EntradaPodologa;
// otra sede → cobertura de un día (asignación + entrada). Todo idempotente y auditado.
router.post('/dia-especial/set', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { profesionalId, sedeId, fechas, viene, horaInicio } = z.object({
    profesionalId: z.string().uuid(),
    sedeId: z.string().uuid(),
    fechas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(31),
    viene: z.boolean(),
    horaInicio: z.enum(HORAS_ENTRADA).optional(),
  }).parse(req.body);

  const prof = await prisma.profesional.findFirst({ where: { id: profesionalId, tipo: 'podologa', activo: true, deletedAt: null }, select: { id: true } });
  if (!prof) throw new AppError('Podóloga no encontrada', 404);

  const resultados: { fecha: string; accion: string }[] = [];
  const errores: { fecha: string; error: string }[] = [];

  for (const fecha of [...new Set(fechas)]) {
    try {
      const fechaPunto = fechaDb(fecha);
      const exc = await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaPunto } } });
      if (!(exc && exc.abierto && exc.horaApertura && exc.horaCierre)) {
        errores.push({ fecha, error: 'Día no habilitado (abre la excepción en Horarios primero)' });
        continue;
      }
      // ¿Es de la sede? (tiene asignación normal a esta sede que cubre la fecha)
      const base = await prisma.asignacionSede.findFirst({
        where: { profesionalId, sedeId, fechaInicio: { lte: fechaPunto }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaPunto } }], NOT: { motivo: 'COBERTURA_EMERGENCIA', fechaFin: fechaPunto } },
      });
      const esDeLaSede = !!base;

      await prisma.$transaction(async (tx) => {
        if (esDeLaSede) {
          if (viene) {
            await tx.entradaPodologa.upsert({
              where: { profesionalId_fecha: { profesionalId, fecha: fechaPunto } },
              create: { profesionalId, fecha: fechaPunto, horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
              update: { horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
            });
          } else {
            await tx.entradaPodologa.deleteMany({ where: { profesionalId, fecha: fechaPunto } });
          }
        } else if (viene) {
          // Traer de otra sede: cobertura de un día (no toca su sede base) + entrada.
          const yaCobertura = await tx.asignacionSede.findFirst({ where: { profesionalId, sedeId, fechaInicio: fechaPunto, fechaFin: fechaPunto, motivo: 'COBERTURA_EMERGENCIA' } });
          if (!yaCobertura) {
            await tx.asignacionSede.create({ data: { profesionalId, sedeId, fechaInicio: fechaPunto, fechaFin: fechaPunto, motivo: 'COBERTURA_EMERGENCIA', creadoPor: req.user?.userId, notas: `Cobertura día especial ${fecha}` } });
          }
          await tx.entradaPodologa.upsert({
            where: { profesionalId_fecha: { profesionalId, fecha: fechaPunto } },
            create: { profesionalId, fecha: fechaPunto, horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
            update: { horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
          });
        } else {
          // Quitar cobertura: borra la asignación de un día + su entrada.
          await tx.asignacionSede.deleteMany({ where: { profesionalId, sedeId, fechaInicio: fechaPunto, fechaFin: fechaPunto, motivo: 'COBERTURA_EMERGENCIA' } });
          await tx.entradaPodologa.deleteMany({ where: { profesionalId, fecha: fechaPunto } });
        }
        await tx.auditLog.create({
          data: {
            usuarioId: req.user?.userId, accion: 'dia_especial_personal', entidad: 'profesional', entidadId: profesionalId,
            despues: { sedeId, fecha, viene, esDeLaSede, horaInicio: horaInicio ?? '08:00' } as never,
          },
        });
      });
      resultados.push({ fecha, accion: esDeLaSede ? (viene ? 'presente' : 'ausente') : (viene ? 'cobertura' : 'quitada') });
    } catch (e) {
      errores.push({ fecha, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // Efectos comunes de todo cambio de horario: invalidar caché de disponibilidad + tiempo real.
  if (resultados.length > 0) {
    await efectosCambioHorario({ profesionalId, sedeId, fechas: resultados.map((r) => r.fecha) });
  }
  res.json({ resultados, errores });
});

router.get('/:id', requireAuth, async (req, res) => {
  const prof = await prisma.profesional.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: {
      unidadNegocio: true,
      asignaciones: {
        include: { sede: true },
        orderBy: { fechaInicio: 'desc' },
      },
      horarios: { where: { activo: true }, orderBy: { diaSemana: 'asc' } },
      bloqueos: { where: { deletedAt: null }, orderBy: { fechaInicio: 'asc' } },
      competencias: {
        where: { activa: true },
        include: { servicio: { select: { id: true, nombre: true, codigo: true, color: true } } },
      },
    },
  });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  res.json(prof);
});

// Horarios del profesional para la semana actual
router.get('/:id/horario', requireAuth, async (req, res) => {
  const horarios = await prisma.horarioProfesional.findMany({
    where: { profesionalId: req.params.id, activo: true },
    orderBy: { diaSemana: 'asc' },
  });

  const bloqueos = await prisma.bloqueoAgenda.findMany({
    where: {
      profesionalId: req.params.id,
      deletedAt: null,
      fechaFin: { gte: new Date() },
    },
    orderBy: { fechaInicio: 'asc' },
  });

  res.json({ horarios, bloqueos });
});

// ─── PUT /profesionales/:id/horario ───────────────────────────────────────────
// Define el HORARIO SEMANAL PERMANENTE (días + rango horario) de un trabajador —
// vigente hasta que se vuelva a editar. `dias` es la lista COMPLETA de días que
// trabaja; los días que NO estén en la lista quedan desactivados (no atiende).
// Additive: reusa el modelo existente `HorarioProfesional` (no cambia la BD).
// Distinto de Permisos/Bloqueos (excepciones puntuales) y de Días especiales.
const horarioDiaSchema = z.object({
  diaSemana: z.number().int().min(0).max(6),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
  horaFin: z.string().regex(/^\d{2}:\d{2}$/),
  turno: z.enum(['manana', 'tarde', 'completo']).optional(),
});
router.put('/:id/horario', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const data = z.object({ dias: z.array(horarioDiaSchema).max(7), forzar: z.boolean().optional() }).parse(req.body);
  const { horarios } = await setHorarioBase({
    profesionalId: req.params.id, dias: data.dias, forzar: data.forzar,
    actor: { usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
  });
  res.json({ ok: true, horarios });
});

// Crear bloqueo de agenda (inhabilita slots reales) → solo gestión (admin/coordinadora).
router.post('/:id/bloqueos', requireAuth, requirePermiso('horarios.editar'), async (req, res) => {
  const { fechaInicio, fechaFin, motivo } = z.object({
    fechaInicio: z.string(),
    fechaFin: z.string(),
    motivo: z.string().min(3),
  }).parse(req.body);

  const ini = new Date(fechaInicio);
  const fin = new Date(fechaFin);
  if (isNaN(ini.getTime()) || isNaN(fin.getTime())) throw new AppError('Fechas inválidas', 400);
  if (fin < ini) throw new AppError('La fecha de fin no puede ser anterior a la de inicio', 400);

  const prof = await prisma.profesional.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true } });
  if (!prof) throw new AppError('Profesional no encontrado', 404);

  // La disponibilidad, la auto-asignación y el alta de citas leen la franja de `horaInicio`/`horaFin`
  // («HH:mm»). Sin ellas el bloqueo quedaba guardado pero NO bloqueaba nada. Fecha sola = día completo.
  const soloFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  if (dia(ini) !== dia(fin)) throw new AppError('Un bloqueo es de un solo día. Para varios días usa Permisos › Vacaciones.', 400, 'BLOQUEO_VARIOS_DIAS');
  const hhmm = (d: Date) => d.toISOString().slice(11, 16);
  const horaInicio = soloFecha(fechaInicio) ? '08:00' : hhmm(ini);
  const horaFin = soloFecha(fechaFin) ? '20:00' : hhmm(fin);
  if (horaFin <= horaInicio) throw new AppError('La hora de fin debe ser posterior a la de inicio', 400);
  const bloqueo = await prisma.bloqueoAgenda.create({
    data: {
      profesionalId: req.params.id, motivo, horaInicio, horaFin, creadoPor: req.user?.userId,
      fechaInicio: new Date(`${dia(ini)}T${horaInicio}:00`), fechaFin: new Date(`${dia(ini)}T${horaFin}:00`),
    },
  });
  res.status(201).json(bloqueo);
});

export default router;
