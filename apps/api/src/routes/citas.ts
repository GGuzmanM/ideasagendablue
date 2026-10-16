import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { prisma } from '../db';
import { acquireSlotLock, releaseSlotLock, invalidateDisponibilidadCache } from '../redis';
import { seleccionarProfesionalOptimo, turnosDelDia } from '../services/disponibilidad';
import { validarCupoServicio } from '../services/cupoServicio';
import { registrarAudit, auditEnTx } from '../services/audit';
import { esFichaAdicional } from '../utils/fichaAdicional';
import { dispararWebhooks } from '../services/webhooks';
import { emitirEventoCita } from '../socket';
import { requireAuth, requireScope, requireAcceso, requirePermiso, requireRol, assertSede, puedeTodasLasSedes } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { withDeadlockRetry, esDeadlockTransitorio, esConflictoDeSlot } from '../utils/dbRetry';
import { agregarRango } from '../services/agregacion';
import { uploadComprobante, validarComprobanteReal } from '../middleware/uploadComprobante';
import { limpiarUrlArchivo } from '../middleware/firmaArchivos';
import { construirIcsDeCita, logoAdjunto } from '../services/emailTemplates';
import { sincronizarCitaOutlook, reintentarOutlookFallidos } from '../services/outlookCalendarService';
import { importarOcupacionOutlookTodos } from '../services/importarOcupacionOutlook';
import { alertasDePacientes } from '../services/alertaPaciente';
import { familiaresDePacientes } from '../services/familiaresPaciente';
import { programarRecordatoriosDeCita, cancelarRecordatoriosDeCita, reprogramarRecordatorioDeCita, forzarEnvioRecordatorioAhora } from '../services/recordatorioService';
// Historia clínica: la agenda solo CONSULTA (guard de cancelar/no_show/eliminar) y sincroniza la
// fecha de la atención al mover (acción reservada a coordinación/admin). Nunca escribe contenido clínico.
import { assertSinAtencionClinica, sincronizarFechaAtencion, atencionSigueAProfesional } from '../services/historiaClinicaService';
import { pendientesPorCitas } from '../services/consentimientoService';
import { sincronizarVideosDeCita, cancelarVideosDeCita } from '../services/videoEnvioService';
import { consumirTokenAccion } from '../services/tokenAccionCita';
import { sincronizarSesionPaquete } from '../services/paqueteSesionService';
import { recalcularPaquete, validarCupoItemAlAgendar, paqueteCorresponde } from '../services/consumoService';
import { precioListaDe, validarYCalcularPromo, recalcularPromoTrasCambio } from '../services/promocionesService';
import { getServicioAnclaId, esCombinacionPermitida } from '../services/combinacionService';
import { enviarCorreoReserva } from '../services/emailService';
import { verificarTokenConfirmacion } from '../utils/confirmToken';
import { fechaDb, fechaAStr, hoyLimaStr, esFechaPasadaLima, diasEnPasadoLima } from '../utils/fechaLima';
import { filtroFechaVisor } from '../utils/rangoVisor';
import { zFechaCita, zHoraCita, zComentarioCita, assertFechaNoMuyLejana } from '../utils/validacionCita';
import { horaInicioValidaParaDuracion, timeToMinutes, minutesToTime } from '@limablue/shared';
import { getCitaCompleta, promoCitaSelect, comentariosInclude, crearComentarioEnTx } from '../services/citaCompleta';
import { cambiarEstadoCita, ESTADOS_FINALES } from '../services/estadoCitaService';
import { estadoAlMover, citaParaAuditoria } from '../services/agendaReglas';
import { MAX_ABIERTO_MIN } from '../services/tiempoReglas';
import { reboteAbierto } from '../services/reboteService';

const router = Router();

// Valida que el canal exista y esté activo en la tabla configurable `Canal`.
async function validarCanal(valor: string): Promise<string> {
  const canal = await prisma.canal.findFirst({ where: { valor, activo: true, deletedAt: null }, select: { valor: true } });
  if (!canal) throw new AppError('Canal de reserva inválido o inactivo', 400, 'CANAL_INVALIDO');
  return canal.valor;
}

// Resuelve/valida la subcategoría de una cita según su servicio. Si el servicio TIENE
// subcategorías activas, elegir una es OBLIGATORIO y debe pertenecer a ese servicio y
// estar activa. Si NO tiene, se ignora cualquier valor (devuelve null). Ver
// `SubcategoriaServicio` (ej. Profilaxis → Regular/Premium/Infantil/Adulto mayor).
/** El paciente debe existir y no estar eliminado (antes: 500 por llave foránea, o cita a un paciente borrado). */
/** Misma regla que al crear: la cita no puede terminar después del fin de turno (al mover no se revisaba). */
/**
 * Al mover a OTRO día una cita que ya estaba en «Llegó»/«En atención», el estado vuelve a «agendada»
 * (agendaReglas.estadoAlMover). La visita no ocurrió: tampoco deben viajar sus horas de llegada (la cita
 * llegaba al día nuevo con la hora del día viejo y disparaba el autocompletado).
 */
function limpiezaAlMover(c: { estado: string; fecha: Date }, nuevaFecha: string): { llegoEn?: null; enAtencionEn?: null } {
  return estadoAlMover(c as never, nuevaFecha) === 'agendada' && ['llego', 'en_atencion'].includes(c.estado) ? { llegoEn: null, enAtencionEn: null } : {};
}

function assertTerminaEnTurno(horaInicio: string, duracionMinutos: number, finTurno: string): void {
  const fin = timeToMinutes(horaInicio) + duracionMinutos;
  if (fin > timeToMinutes(finTurno)) {
    throw new AppError(`La cita terminaría ${minutesToTime(fin)}, después del fin de turno del profesional (${finTurno}).`, 400, 'SLOT_EXCEDE_TURNO');
  }
}

/** El profesional debe seguir de alta: uno desactivado o eliminado conserva horario y competencias, y se le seguía agendando. */
async function assertProfesionalActivo(profesionalId: string | null | undefined): Promise<void> {
  if (!profesionalId) return;
  const p = await prisma.profesional.findUnique({ where: { id: profesionalId }, select: { activo: true, deletedAt: true } });
  if (!p || !p.activo || p.deletedAt) throw new AppError('Ese profesional ya no está activo: elige a otra persona.', 400, 'PROFESIONAL_INACTIVO');
}

async function assertPacienteAgendable(pacienteId: string): Promise<void> {
  const p = await prisma.paciente.findFirst({ where: { id: pacienteId, deletedAt: null }, select: { id: true } });
  if (!p) throw new AppError('Paciente no encontrado (o fue eliminado)', 404, 'PACIENTE_NO_ENCONTRADO');
}

/**
 * Reprogramar es hacia adelante: no a un día que ya pasó (agendar en pasado existe, pero como cita
 * RETROACTIVA con motivo; mover no pide motivo) ni a más de un año. Se permite quedarse en su mismo
 * día aunque sea pasado: es corregir la hora de una cita retroactiva.
 */
function assertFechaMovible(nuevaFecha: string, fechaActual: Date): void {
  if (esFechaPasadaLima(nuevaFecha) && nuevaFecha !== fechaAStr(fechaActual)) {
    throw new AppError('No se puede mover una cita a un día que ya pasó. Si hay que registrar algo que ya ocurrió, agenda una cita nueva con su motivo.', 400, 'FECHA_PASADA');
  }
  assertFechaNoMuyLejana(nuevaFecha);
}

async function resolverSubcategoria(servicioId: string, subcategoriaId?: string | null): Promise<string | null> {
  const activas = await prisma.subcategoriaServicio.findMany({
    where: { servicioId, deletedAt: null, activo: true },
    select: { id: true },
  });
  if (activas.length === 0) return null; // servicio sin subcategorías
  if (!subcategoriaId) throw new AppError('Este servicio requiere elegir una subcategoría', 400, 'SUBCATEGORIA_REQUERIDA');
  if (!activas.some((s) => s.id === subcategoriaId)) {
    throw new AppError('La subcategoría no corresponde a este servicio o está inactiva', 400, 'SUBCATEGORIA_INVALIDA');
  }
  return subcategoriaId;
}

// ─── Estado de pago (29-sep-2026) ─────────────────────────────────────────────
// Pendiente de pago / Pago incompleto / Pago completo. `pagada` se mantiene sincronizado (= completo) para los reportes
// que ya lo usan; `pagadaEn` / `pagadaPorId` = cuándo y quién registró el último estado de pago.
const zEstadoPago = z.enum(['pendiente', 'incompleto', 'completo']);
type EstadoPagoCita = z.infer<typeof zEstadoPago>;
/** Estado de pago al crear: `estadoPago` manda; el viejo `pagada: true` equivale a pago completo. */
function estadoPagoInicial(d: { estadoPago?: EstadoPagoCita; pagada?: boolean }): EstadoPagoCita {
  return d.estadoPago ?? (d.pagada ? 'completo' : 'pendiente');
}
/** Campos a escribir al REGISTRAR un estado de pago (queda quién y cuándo). */
function camposPago(estado: EstadoPagoCita, usuarioId: string | null | undefined) {
  return { estadoPago: estado, pagada: estado === 'completo', pagadaEn: new Date(), pagadaPorId: usuarioId ?? null };
}

const crearCitaSchema = z.object({
  pacienteId: z.string().uuid(),
  profesionalId: z.string().uuid().nullable().optional(),
  // Baropodometría: médico "por solicitud" que atiende ESTA cita (la columna sigue siendo la
  // máquina Baro 1/2). Si no viene y hay un único médico de baro, se adjunta ese automáticamente.
  solicitadoProfesionalId: z.string().uuid().nullable().optional(),
  sedeId: z.string().uuid(),
  unidadNegocioId: z.string().uuid(),
  servicioId: z.string().uuid(),
  subcategoriaId: z.string().uuid().nullable().optional(), // obligatoria si el servicio tiene subcategorías
  fecha: zFechaCita,
  horaInicio: zHoraCita,
  canal: z.string().default('recepcion'),
  comentarioRecepcion: zComentarioCita.optional(),
  paquetePacienteId: z.string().uuid().optional(),
  // Adjudicación MANUAL del número de sesión (SOLO paquetes origen GENEXIS_APERTURA):
  // recepción/contact mira el visor Genexis y elige del desplegable qué sesión toca.
  sesionNumeroManual: z.number().int().min(1).max(99).optional(),
  promocionId: z.string().uuid().nullable().optional(),
  codigoPromo: z.string().trim().max(60).optional(), // cupón/convenio si la promo lo requiere
  comprobanteUrl: z.string().optional(),
  comprobanteNombre: z.string().optional(),
  comprobanteMimeType: z.string().optional(),
  // Motivo obligatorio SOLO si la cita se agenda en una fecha pasada (retroactiva). Se valida en
  // el handler (aquí es opcional porque para citas normales no aplica). Ver `esFechaPasadaLima`.
  motivoRetroactivo: z.string().trim().max(500).optional(),
  pagada: z.boolean().optional(), // (anterior) true = pago completo
  estadoPago: zEstadoPago.optional(), // 29-sep-2026: pendiente / incompleto / completo
});

// Bloque combinado: ancla (profilaxis) + un servicio extra en el mismo slot de 1 h.
// El ancla replica los campos de crearCitaSchema; el extra trae su servicio y, opcional,
// otra profesional / paquete (default: misma profesional del ancla).
const crearCombinadaSchema = z.object({
  pacienteId: z.string().uuid(),
  profesionalId: z.string().uuid().nullable().optional(), // si no viene → asignación automática
  sedeId: z.string().uuid(),
  unidadNegocioId: z.string().uuid(),
  servicioId: z.string().uuid(), // debe coincidir con el ancla configurada
  subcategoriaId: z.string().uuid().nullable().optional(), // subcategoría del ancla (profilaxis)
  fecha: zFechaCita,
  horaInicio: zHoraCita,
  canal: z.string().default('recepcion'),
  comentarioRecepcion: zComentarioCita.optional(),
  paquetePacienteId: z.string().uuid().optional(),
  promocionId: z.string().uuid().nullable().optional(), // promo del BLOQUE → va en la PRINCIPAL
  codigoPromo: z.string().trim().max(60).optional(),
  motivoRetroactivo: z.string().trim().max(500).optional(), // obligatorio si el bloque es en fecha pasada
  pagada: z.boolean().optional(), // (anterior) true = pago completo
  estadoPago: zEstadoPago.optional(), // el bloque se paga junto: va en las dos citas
  comprobanteUrl: z.string().optional(), // 29-sep-2026: el comprobante del bloque va en la PRINCIPAL
  comprobanteNombre: z.string().optional(),
  comprobanteMimeType: z.string().optional(),
  extra: z.object({
    servicioId: z.string().uuid(),
    profesionalId: z.string().uuid().optional(), // default: profesional del ancla
    paquetePacienteId: z.string().uuid().optional(),
    subcategoriaId: z.string().uuid().optional(), // obligatoria si el servicio extra tiene subcategorías
    comentarioRecepcion: zComentarioCita.optional(),
  }),
});

const moverCitaSchema = z.object({
  profesionalId: z.string().uuid().nullable().optional(),
  fecha: zFechaCita,
  horaInicio: zHoraCita,
  origenAsignacion: z.enum(['elegida_por_paciente', 'asignada_automaticamente']).optional(),
  // Baropodometría en una sede con 2+ máquinas: recepción eligió a mano la máquina (Baro 1 / Baro 2) al
  // reprogramar. Sin este flag el servidor elige una máquina libre como siempre.
  elegirEquipo: z.boolean().optional(),
});

const estadoSchema = z.object({
  estado: z.enum(['agendada', 'confirmada', 'llego', 'en_atencion', 'completada', 'no_show', 'cancelada']),
  comentario: z.string().optional(),
  motivoCancelacion: z.string().optional(),
  // Bloque combinado: si true, el cambio NO cascadea a las citas hermanas del grupo —
  // avanza SOLO esta cita. Lo usa el flujo secuencial de 2 tratamientos (iniciar/completar/
  // cancelar cada tratamiento por separado). Sin el flag, el bloque se mueve junto (default).
  soloEsta: z.boolean().optional(),
  // Solo admin: cancelar / «no vino» aunque la atención clínica tenga registros (se conserva).
  forzar: z.boolean().optional(),
});

// La máquina de estados (TRANSICIONES_VALIDAS / ESTADOS_FINALES) vive en services/estadoCitaService.ts.

// ─── Helper: validar que el slot no choca con un bloqueo del profesional ──────
// Cubre permisos/ausencias (no recurrentes) y almuerzos (recurrentes). Lanza
// SLOT_BLOQUEADO si hay solapamiento con el rango [horaInicio, horaInicio+duración).
async function validarSinBloqueo(profesionalId: string, fecha: string, horaInicio: string, duracionMin: number, sedeId?: string) {
  const slotStart = timeToMinutes(horaInicio);
  const slotEnd = slotStart + duracionMin;
  // Límites del día anclados a UTC (no dependen de la TZ del proceso).
  const dayStart = new Date(`${fecha}T00:00:00.000Z`);
  const dayEnd = new Date(`${fecha}T23:59:59.999Z`);
  const fechaPunto = fechaDb(fecha);

  // Bloqueos puntuales (permisos, reuniones, ausencias). La hora del bloqueo se toma de los
  // campos STRING `horaInicio`/`horaFin` (hora civil "HH:mm", fuente confiable e independiente
  // de la TZ). Fallback a la hora LOCAL del DateTime (así se creó el bloqueo) para filas legacy
  // sin string. NUNCA `getUTCHours` (en TZ ≠ UTC corría el bloqueo y no detectaba el solape).
  const puntuales = await prisma.bloqueoAgenda.findMany({
    where: { profesionalId, deletedAt: null, esRecurrente: false, fechaInicio: { lt: dayEnd }, fechaFin: { gt: dayStart } },
    select: { fechaInicio: true, fechaFin: true, horaInicio: true, horaFin: true, motivo: true },
  });
  for (const b of puntuales) {
    const bStart = b.horaInicio ? timeToMinutes(b.horaInicio) : b.fechaInicio.getHours() * 60 + b.fechaInicio.getMinutes();
    const bEnd = b.horaFin ? timeToMinutes(b.horaFin) : b.fechaFin.getHours() * 60 + b.fechaFin.getMinutes();
    if (slotStart < bEnd && slotEnd > bStart) {
      throw new AppError(`El profesional tiene un bloqueo en ese horario (${b.motivo})`, 409, 'SLOT_BLOQUEADO');
    }
  }

  // Almuerzos vigentes en la fecha (en fin de semana solo aplican los almuerzos puntuales de esa fecha).
  const esFinde = [0, 6].includes(fechaPunto.getUTCDay());
  const almuerzos = await prisma.bloqueoAgenda.findMany({
    where: {
      profesionalId,
      deletedAt: null,
      tipo: 'ALMUERZO',
      fechaInicio: { lte: fechaPunto },
      fechaFin: { gte: fechaPunto },
      ...(esFinde ? { esRecurrente: false } : {}),
      // Almuerzo de OTRA sede (p. ej. uno viejo de la sede anterior) no bloquea: la agenda tampoco lo muestra (24-sep-2026).
      ...(sedeId ? { OR: [{ sedeId: null }, { sedeId }] } : {}),
    },
    select: { horaInicio: true, horaFin: true },
  });
  for (const a of almuerzos) {
    if (!a.horaInicio || !a.horaFin) continue;
    const bStart = timeToMinutes(a.horaInicio);
    const bEnd = timeToMinutes(a.horaFin);
    if (slotStart < bEnd && slotEnd > bStart) {
      throw new AppError('El profesional tiene almuerzo en ese horario', 409, 'SLOT_BLOQUEADO');
    }
  }
}

// ¿El médico está registrado para atender baro en esta sede (y habilitado en el servicio)?
async function medicoAtiendeBaroEnSede(profesionalId: string, servicioId: string, sedeId: string, fecha?: string | Date): Promise<boolean> {
  // Ventana de vigencia del periodo de baro EN LA FECHA de la cita (regla "1 sede por día"): el
  // registro debe cubrir ese día (fechaInicio ≤ fecha ≤ fechaFin|indefinido). Sin fecha → solo activa.
  let ventana = {};
  if (fecha) {
    const f = typeof fecha === 'string' ? fecha.slice(0, 10) : fecha.toISOString().slice(0, 10);
    ventana = { fechaInicio: { lte: new Date(`${f}T23:59:59`) }, OR: [{ fechaFin: null }, { fechaFin: { gte: new Date(`${f}T00:00:00`) } }] };
  }
  const reg = await prisma.baroMedicoSede.findFirst({
    where: {
      profesionalId, sedeId, activa: true, ...ventana,
      profesional: { activo: true, deletedAt: null, competencias: { some: { servicioId, activa: true, soloPorSolicitud: true } } },
    },
    select: { id: true },
  });
  return !!reg;
}

// ─── Middleware: autorización por SEDE de una cita existente ──────────────────
// Para rutas que MODIFICAN una cita por `:id` (o un bloque por `:slotGrupoId`): solo si el
// usuario puede operar la sede de esa cita. admin/coordinadora → todas; recepción → solo sus
// sedes; API keys sin restricción. El permiso (agenda.editar) lo exige `requireAcceso` aparte.
async function guardSedeCita(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.apiKey) return next();
    let sedeId: string | null = null;
    if (req.params.id) {
      const c = await prisma.cita.findUnique({ where: { id: req.params.id }, select: { sedeId: true } });
      sedeId = c?.sedeId ?? null;
    } else if (req.params.slotGrupoId) {
      const c = await prisma.cita.findFirst({ where: { slotGrupoId: req.params.slotGrupoId }, select: { sedeId: true } });
      sedeId = c?.sedeId ?? null;
    }
    if (sedeId) assertSede(req, sedeId);
    next();
  } catch (e) { next(e); }
}

// ─── Médico de la cita al reprogramar ──────────────────────────────────────────
// Si la cita pasa a OTRO DÍA y aún no tiene atención clínica, el médico que la había tomado puede
// no estar ese día: se suelta y la toma el médico de turno. Cambiar solo la hora lo conserva.
const SIN_MEDICO = { medicoId: null, medicoAsignadoEn: null, medicoAsignadoPorId: null } as const;
function sueltaMedico(c: { medicoId: string | null; fecha: Date }, nuevaFecha: string, conAtencion: boolean): boolean {
  return !!c.medicoId && !conAtencion && c.fecha.toISOString().slice(0, 10) !== nuevaFecha;
}

// ─── Helper: el profesional no puede estar en dos lados a la vez ──────────────
// Una persona ocupa su tiempo aunque la cita esté en otra unidad: cuenta tanto las
// citas donde es el profesional de columna (profesionalId) como donde fue pedido
// "Solo X" (solicitadoProfesionalId, baro). Así un cupo de Daniel en Podología se
// anula si ya tiene una cita en Baropodometría a esa hora, y viceversa. Considera
// solape real de duraciones (no solo misma horaInicio). `excluirCitaId` para mover.
async function validarProfesionalLibre(
  profesionalId: string, fecha: string, horaInicio: string, duracionMin: number, excluirCitaId?: string, excluirCitaIds: string[] = [],
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const slotStart = timeToMinutes(horaInicio);
  const slotEnd = slotStart + duracionMin;
  // Citas a excluir del chequeo de solape (la propia al mover; todo el grupo al mover un bloque).
  const excluidos = [...(excluirCitaId ? [excluirCitaId] : []), ...excluirCitaIds];
  const citas = await client.cita.findMany({
    where: {
      OR: [{ profesionalId }, { solicitadoProfesionalId: profesionalId }],
      fecha: fechaDb(fecha),
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] },
      ...(excluidos.length ? { id: { notIn: excluidos } } : {}),
    },
    select: { horaInicio: true, duracionMinutos: true, unidadNegocio: { select: { nombre: true } } },
  });
  for (const c of citas) {
    const s = timeToMinutes(c.horaInicio);
    if (s < slotEnd && s + c.duracionMinutos > slotStart) {
      throw new AppError(
        `El profesional ya tiene una cita a esa hora (${c.horaInicio}, ${c.unidadNegocio.nombre}). No puede atender en dos lugares a la vez.`,
        409, 'PROFESIONAL_OCUPADO',
      );
    }
  }
}

// ─── Helper: serializar cita para respuestas ──────────────────────────────────
// getCitaCompleta, promoCitaSelect, comentariosInclude y crearComentarioEnTx viven en
// services/citaCompleta.ts (los usan también el cambio de estado y el aparato del consultorio).

// FUENTE ÚNICA de la promo en un bloque combinado: la cita PORTADORA = la PRINCIPAL
// (profilaxis). Para una cita individual, la portadora es ella misma. Fallback (grupo sin
// PRINCIPAL, no debería pasar): la de menor `id`. Todo el backend usa este helper.
async function resolverCitaPortadora(cita: { id: string; slotGrupoId: string | null }): Promise<string> {
  if (!cita.slotGrupoId) return cita.id;
  const principal = await prisma.cita.findFirst({
    where: { slotGrupoId: cita.slotGrupoId, slotRol: 'PRINCIPAL', deletedAt: null },
    select: { id: true },
  });
  if (principal) return principal.id;
  const menor = await prisma.cita.findFirst({
    where: { slotGrupoId: cita.slotGrupoId, deletedAt: null },
    orderBy: { id: 'asc' }, select: { id: true },
  });
  return menor?.id ?? cita.id;
}

// ─── POST /citas/upload-comprobante ──────────────────────────────────────────
router.post(
  '/upload-comprobante',
  requireAuth,
  uploadComprobante.single('comprobante'),
  validarComprobanteReal, // valida el CONTENIDO real (magic bytes) — rechaza html/svg/script disfrazado
  (req, res) => {
    if (!req.file) throw new AppError('No se recibió ningún archivo', 400);
    // Ruta RELATIVA: tras el proxy el API siempre se ve como http://localhost:3002, y esa URL absoluta
    // no carga desde otra PC y el navegador la bloquea bajo HTTPS (contenido mixto).
    const url = `/uploads/comprobantes/${req.file.filename}`;
    res.json({
      url,
      nombre: req.file.originalname,
      mimeType: req.file.mimetype,
      tamanioBytes: req.file.size,
    });
  },
);

// ─── GET /citas ───────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { sedeId, fecha, hasta, profesionalId, unidadNegocioId, pacienteId, estado } = req.query as Record<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {
    deletedAt: null,
  };

  // Autorización por sede: si piden una sede concreta, debe estar permitida. Si NO piden sede
  // (y no es admin/coordinadora), se acota a las sedes del usuario para no exponer todas.
  if (sedeId) {
    assertSede(req, sedeId);
    where.sedeId = sedeId;
  } else if (req.user && !puedeTodasLasSedes(req.user)) {
    where.sedeId = { in: req.user.sedes };
  }
  // `hasta` (Visor de Pacientes, 10-oct-2026): rango fecha..hasta, solo admin y auditor de médicos.
  if (fecha) where.fecha = filtroFechaVisor(req, fecha, hasta);
  if (profesionalId) where.profesionalId = profesionalId;
  if (unidadNegocioId) where.unidadNegocioId = unidadNegocioId;
  if (pacienteId) where.pacienteId = pacienteId;
  if (estado) where.estado = estado as never;

  const citas = await prisma.cita.findMany({
    where,
    include: {
      // email/fechaNacimiento/requiereActualizacionDatos alimentan el toggle
      // "Actualizar datos" del PopoverCita (la bandera es la calculada server-side).
      paciente: { select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, telefono: true, email: true, fechaNacimiento: true, requiereActualizacionDatos: true } },
      profesional: { select: { id: true, nombres: true, apellidos: true, colorAvatar: true } },
      solicitadoProfesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } },
      atendidoPor: { select: { id: true, nombres: true, apellidos: true } }, // columna Adicional: quién atendió
      medico: { select: { id: true, nombres: true, apellidos: true, colegiatura: true } },
      sede: { select: { id: true, nombre: true, color: true, consultorios: true } },
      unidadNegocio: { select: { id: true, nombre: true, color: true } },
      servicio: { select: { id: true, nombre: true, duracionMinutos: true, color: true } },
      subcategoria: { select: { id: true, nombre: true } },
      paquetePaciente: { select: { id: true, sesionesTotal: true, sesionesUsadas: true, paquete: { select: { nombre: true } } } },
      promocion: { select: promoCitaSelect },
      comentarios: comentariosInclude,
    },
    orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
  });

  // Promo HEREDADA: para las citas SECUNDARIO de un bloque, su promo es la de la PRINCIPAL
  // (portadora). Se arma un mapa slotGrupoId → promo de la PRINCIPAL y se adjunta. Las
  // PRINCIPAL/individuales llevan su propio `promocion`; ningún conteo suma la heredada.
  const promoPorGrupo = new Map<string, typeof citas[number]['promocion']>();
  for (const c of citas) if (c.slotGrupoId && c.slotRol === 'PRINCIPAL') promoPorGrupo.set(c.slotGrupoId, c.promocion);

  // Alerta de comportamiento (no-show / reprogramador frecuente) y posibles
  // familiares (mismo teléfono) por paciente, para mostrarlos en la agenda/popover.
  const ids = citas.map((c) => c.pacienteId);
  const [alertas, familiares, sinConsentimiento] = await Promise.all([
    alertasDePacientes(ids),
    familiaresDePacientes(ids),
    // Aviso en la tarjeta: el servicio exige un consentimiento que el paciente aún no firmó.
    citas.length <= 2000 ? pendientesPorCitas(citas) : Promise.resolve({} as Awaited<ReturnType<typeof pendientesPorCitas>>),
  ]);
  const conAlerta = citas.map((c) => ({
    ...c,
    consentimientosPendientes: sinConsentimiento[c.id] ?? [],
    promocionHeredada: (c.slotGrupoId && c.slotRol === 'SECUNDARIO') ? (promoPorGrupo.get(c.slotGrupoId) ?? null) : null,
    paciente: {
      ...c.paciente,
      alerta: alertas.get(c.pacienteId) ?? null,
      familiares: familiares.get(c.pacienteId) ?? [],
    },
  }));

  res.json(conAlerta);
});

// Citas del día en OTRAS sedes de los profesionales que tienen asignación en ESTA sede ese día (25-sep-2026). Caso: el
// dermatólogo atiende en Paz Soldán y One a la vez (una sola agenda): su cita en una sede se pinta como bloque en la
// columna de la otra. También sirve para Daniel (su baro en otra sede ocupa su columna de podología). Solo visual.
async function citasDeAsignadosEnOtrasSedes(sedeId: string, fecha: string) {
  const f = fechaDb(fecha);
  const asignados = await prisma.asignacionSede.findMany({
    where: { sedeId, fechaInicio: { lte: f }, OR: [{ fechaFin: null }, { fechaFin: { gte: f } }] },
    select: { profesionalId: true },
  });
  const ids = new Set(asignados.map((a) => a.profesionalId));
  if (ids.size === 0) return { ids, citas: [] };
  const citas = await prisma.cita.findMany({
    where: {
      sedeId: { not: sedeId },
      fecha: f,
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] },
      OR: [{ profesionalId: { in: [...ids] } }, { solicitadoProfesionalId: { in: [...ids] } }],
    },
    select: {
      id: true, horaInicio: true, duracionMinutos: true, estado: true, profesionalId: true, solicitadoProfesionalId: true,
      paciente: { select: { nombres: true, apellidoPaterno: true } },
      servicio: { select: { nombre: true } },
      unidadNegocio: { select: { id: true, nombre: true, color: true } },
      sede: { select: { nombre: true } },
    },
    orderBy: { horaInicio: 'asc' },
  });
  return { ids, citas };
}

// ─── GET /citas/ocupacion-externa ─────────────────────────────────────────────
// Devuelve las citas de OTRAS unidades de negocio (misma sede + fecha) que ocupan
// el tiempo de algún profesional. Sirve para pintar "bloques fantasma" en la agenda:
// p.ej. un médico que hace Baropodometría (guardado como solicitadoProfesional en una
// cita cuya columna es la máquina Baro 1) debe verse OCUPADO también en su columna de
// Podología, y viceversa. Es puramente informativo/visual — la validación anti-doble
// booking ya existe en el backend (validarProfesionalLibre).
router.get('/ocupacion-externa', requireAuth, async (req, res) => {
  const { sedeId, fecha, unidadNegocioId } = req.query as Record<string, string>;
  assertSede(req, sedeId);
  if (!sedeId || !fecha || !unidadNegocioId) {
    throw new AppError('Faltan parámetros: sedeId, fecha, unidadNegocioId', 400);
  }

  // Todas las citas activas de la sede/fecha que NO pertenecen a la unidad actual.
  const citas = await prisma.cita.findMany({
    where: {
      sedeId,
      fecha: fechaDb(fecha),
      unidadNegocioId: { not: unidadNegocioId },
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] },
    },
    select: {
      id: true,
      horaInicio: true,
      duracionMinutos: true,
      estado: true,
      profesionalId: true,
      solicitadoProfesionalId: true,
      paciente: { select: { nombres: true, apellidoPaterno: true } },
      servicio: { select: { nombre: true, color: true } },
      unidadNegocio: { select: { id: true, nombre: true, color: true } },
      profesional: { select: { id: true, nombres: true, apellidos: true } },
      solicitadoProfesional: { select: { id: true, nombres: true, apellidos: true } },
    },
    orderBy: { horaInicio: 'asc' },
  });

  // Para cada cita externa, emitir UNA entrada por cada profesional que ocupa
  // (profesionalId y/o solicitadoProfesionalId). El frontend la pinta como bloque
  // fantasma en la columna de ese profesional si aparece en la vista actual.
  const ocupaciones = citas.flatMap((c) => {
    const ids = new Set<string>();
    if (c.profesionalId) ids.add(c.profesionalId);
    if (c.solicitadoProfesionalId) ids.add(c.solicitadoProfesionalId);
    const pacienteNombre = `${c.paciente.nombres.split(' ')[0]} ${c.paciente.apellidoPaterno}`;
    // Etiqueta de "dónde está realmente" (la columna real de esa cita externa).
    const enColumna = c.profesional ? `${c.profesional.nombres.split(' ')[0]} ${c.profesional.apellidos.split(' ')[0]}` : c.unidadNegocio.nombre;
    return [...ids].map((profesionalOcupadoId) => ({
      citaId: c.id,
      profesionalOcupadoId,
      horaInicio: c.horaInicio,
      duracionMinutos: c.duracionMinutos,
      estado: c.estado,
      pacienteNombre,
      servicioNombre: c.servicio.nombre,
      unidadNegocio: c.unidadNegocio,
      enColumna, // "Baro 1", etc. — dónde ocurre físicamente
    }));
  });

  // + MISMA unidad, pero pedida «Solo X» y la cita está en OTRA columna (una máquina, o una que quedó así de antes):
  //   la columna de X debe verse ocupada a esa hora, igual que ya lo exige la validación (26-sep-2026, caso Sarai).
  const solicitadas = await prisma.cita.findMany({
    where: {
      sedeId, fecha: fechaDb(fecha), unidadNegocioId, deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] },
      solicitadoProfesionalId: { not: null },
    },
    select: {
      id: true, horaInicio: true, duracionMinutos: true, estado: true, profesionalId: true, solicitadoProfesionalId: true,
      paciente: { select: { nombres: true, apellidoPaterno: true } },
      servicio: { select: { nombre: true } },
      unidadNegocio: { select: { id: true, nombre: true, color: true } },
      profesional: { select: { nombres: true, apellidos: true } },
    },
  });
  const enOtraColumna = solicitadas
    .filter((c) => c.solicitadoProfesionalId && c.solicitadoProfesionalId !== c.profesionalId)
    .map((c) => ({
      citaId: c.id,
      profesionalOcupadoId: c.solicitadoProfesionalId!,
      horaInicio: c.horaInicio,
      duracionMinutos: c.duracionMinutos,
      estado: c.estado,
      pacienteNombre: `${c.paciente.nombres.split(' ')[0]} ${c.paciente.apellidoPaterno}`,
      servicioNombre: c.servicio.nombre,
      unidadNegocio: c.unidadNegocio,
      enColumna: c.profesional ? `${c.profesional.nombres.split(' ')[0]} ${c.profesional.apellidos.split(' ')[0] ?? ''}`.trim() : c.unidadNegocio.nombre,
      enOtraColumna: true, // presente = misma unidad, la cita está en la columna `enColumna` («Solo X»)
    }));

  // + su tiempo ocupado en OTRA sede (misma persona, una sola agenda)
  const otras = await citasDeAsignadosEnOtrasSedes(sedeId, fecha);
  const enOtraSede = otras.citas.flatMap((c) => {
    const ids = [c.profesionalId, c.solicitadoProfesionalId].filter((x): x is string => !!x && otras.ids.has(x));
    return [...new Set(ids)].map((profesionalOcupadoId) => ({
      citaId: c.id,
      profesionalOcupadoId,
      horaInicio: c.horaInicio,
      duracionMinutos: c.duracionMinutos,
      estado: c.estado,
      pacienteNombre: `${c.paciente.nombres.split(' ')[0]} ${c.paciente.apellidoPaterno}`,
      servicioNombre: c.servicio.nombre,
      unidadNegocio: c.unidadNegocio,
      enColumna: c.sede.nombre,
      sedeNombre: c.sede.nombre, // presente = la cita es de OTRA sede
    }));
  });

  res.json([...ocupaciones, ...enOtraColumna, ...enOtraSede]);
});

// ─── GET /citas/ocupacion-dia ─────────────────────────────────────────────────
// Ocupación de TODOS los profesionales en una sede/fecha, a través de TODAS las
// unidades. La usa el modal de Nueva Cita para avisar que un médico ya está ocupado
// a la hora elegida (ej. elegir a Daniel para baro cuando ya tiene podología). Cada
// entrada expande profesionalId + solicitadoProfesionalId (un médico ocupa su tiempo
// aunque la cita esté a nombre de una máquina).
router.get('/ocupacion-dia', requireAuth, async (req, res) => {
  const { sedeId, fecha } = req.query as Record<string, string>;
  if (!sedeId || !fecha) throw new AppError('Faltan parámetros: sedeId, fecha', 400);
  assertSede(req, sedeId);

  const citas = await prisma.cita.findMany({
    where: {
      sedeId,
      fecha: fechaDb(fecha),
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] },
    },
    select: {
      id: true, horaInicio: true, duracionMinutos: true,
      profesionalId: true, solicitadoProfesionalId: true,
      unidadNegocio: { select: { nombre: true } },
    },
  });

  const ocupaciones = citas.flatMap((c) => {
    const ids = new Set<string>();
    if (c.profesionalId) ids.add(c.profesionalId);
    if (c.solicitadoProfesionalId) ids.add(c.solicitadoProfesionalId);
    return [...ids].map((profesionalId) => ({
      profesionalId,
      citaId: c.id,
      horaInicio: c.horaInicio,
      duracionMinutos: c.duracionMinutos,
      unidad: c.unidadNegocio.nombre,
    }));
  });

  const otras = await citasDeAsignadosEnOtrasSedes(sedeId, fecha);
  const enOtraSede = otras.citas.flatMap((c) =>
    [...new Set([c.profesionalId, c.solicitadoProfesionalId].filter((x): x is string => !!x && otras.ids.has(x)))].map((profesionalId) => ({
      profesionalId, citaId: c.id, horaInicio: c.horaInicio, duracionMinutos: c.duracionMinutos, unidad: `${c.unidadNegocio.nombre} · ${c.sede.nombre}`,
    })));

  res.json([...ocupaciones, ...enOtraSede]);
});

// ─── Página HTML pública (confirmar/cancelar desde el correo) ─────────────────
// Branding Limablue mínimo y autocontenido (sin assets externos = portable).
function paginaPublica(opts: { ok: boolean; titulo: string; mensaje: string; detalle?: string; pregunta?: boolean; accionHtml?: string }): string {
  const color = opts.pregunta ? '#1e3a8a' : opts.ok ? '#16a34a' : '#dc2626';
  const icono = opts.pregunta ? '❓' : opts.ok ? '✅' : '⚠️';
  const bloqueDetalle = opts.detalle
    ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;margin:0 0 20px;color:#334155;font-size:14px;line-height:1.6;">${opts.detalle}</div>`
    : '';
  // Mismo logo que el correo (assets/correo/logo-correo.png) incrustado como data-URI.
  // La página web no puede usar `cid:`, así que se embebe en base64. Si no hay archivo,
  // cae al recuadro "LB" + nombre (comportamiento previo).
  const logo = logoAdjunto();
  const cabecera = logo
    ? `<img src="data:${logo.mime};base64,${logo.base64}" alt="Limablue · Salud del pie" width="160" style="display:inline-block;max-width:75%;height:auto;">`
    : `<span style="display:inline-block;background:#fff;color:#1e40af;font-weight:800;font-size:16px;width:38px;height:38px;line-height:38px;border-radius:10px;">LB</span>
      <div style="color:#fff;font-weight:700;font-size:16px;margin-top:8px;">Limablue · Salud del pie</div>`;
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Limablue · ${opts.titulo}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#eef2f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;">
  <div style="background:#fff;border-radius:18px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.1);">
    <div style="background:#1e3a8a;padding:22px;text-align:center;">
      ${cabecera}
    </div>
    <div style="padding:32px;text-align:center;">
      <div style="font-size:46px;margin-bottom:10px;">${icono}</div>
      <h1 style="color:${color};font-size:21px;margin:0 0 10px;">${opts.titulo}</h1>
      ${bloqueDetalle}
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0;">${opts.mensaje}</p>
      ${opts.accionHtml ?? ''}
    </div>
  </div>
</body></html>`;
}

function detalleCita(c: { servicio: { nombre: string }; fecha: Date; horaInicio: string; sede: { nombre: string } }): string {
  // fecha es @db.Date (medianoche UTC) → usamos getters UTC para no desfasar el día.
  const f = c.fecha;
  const dd = String(f.getUTCDate()).padStart(2, '0');
  const mm = String(f.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = f.getUTCFullYear();
  return `<strong>${c.servicio.nombre}</strong><br/>${dd}/${mm}/${yyyy} · ${c.horaInicio}<br/>${c.sede.nombre}`;
}

// ─── POST /citas/outlook/reintentar ──── (reprocesa sincronizaciones fallidas) ─
router.post('/outlook/reintentar', requireAuth, requirePermiso('config.editar'), async (_req, res) => {
  const resultado = await reintentarOutlookFallidos();
  res.json(resultado);
});

// ─── POST /citas/outlook/importar-ocupacion ─ (sync INVERSA: Outlook → bloqueos) ─
// Fuerza AHORA la lectura del calendario de los profesionales del tenant y refleja su
// ocupación como bloqueos de agenda. La misma tarea corre sola cada 5 min si Azure está
// configurado; este endpoint es para dispararla a demanda (verificación/ops).
router.post('/outlook/importar-ocupacion', requireAuth, requirePermiso('config.editar'), async (_req, res) => {
  const resultado = await importarOcupacionOutlookTodos();
  res.json(resultado);
});

// ─── POST /citas/:id/confirmar-mail ──── (reenvío manual del recordatorio) ─────
// Reenvía AHORA el Correo 2 (recordatorio con botones confirmar/reprogramar).
router.post('/:id/confirmar-mail', requireAuth, async (req, res) => {
  const cita = await prisma.cita.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: { paciente: { select: { email: true } } },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  if (ESTADOS_FINALES.includes(cita.estado)) {
    throw new AppError('No se puede enviar confirmación de una cita cancelada o finalizada', 400, 'ESTADO_FINAL');
  }
  if (!cita.paciente.email) {
    throw new AppError('El paciente no tiene correo registrado. Agrega un correo en su ficha.', 400, 'SIN_CORREO');
  }

  try {
    const { to, estado } = await forzarEnvioRecordatorioAhora(cita.id);
    if (estado === 'diferido') throw new AppError('Se alcanzó el límite diario de correos. El recordatorio quedó en cola para el día siguiente.', 429, 'CUOTA_DIARIA');
    await registrarAudit({ citaId: cita.id, usuarioId: req.user?.userId, accion: 'recordatorio_reenvio_manual', entidad: 'cita', entidadId: cita.id, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
    res.json({ ok: true, to });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : 'Error al enviar';
    throw new AppError(`No se pudo enviar el correo: ${msg}`, 502, 'ENVIO_FALLIDO');
  }
});

// ─── GET /citas/confirmar?token= ──────────── (público, desde el correo) ───────
// ─── GET /citas/calendario?token= ───────── (público, botón "Agregar a mi agenda") ─
// Entrega el .ics de la cita. Al abrirlo desde el celular, el sistema lo agrega
// al calendario del paciente en cualquier proveedor (Google, Apple, Outlook).
router.get('/calendario', async (req, res) => {
  const token = req.query.token as string | undefined;
  if (!token) { res.status(400).send('Falta el token.'); return; }

  let citaId: string;
  try {
    citaId = verificarTokenConfirmacion(token).citaId;
  } catch {
    res.status(400).send('Enlace inválido o vencido.');
    return;
  }

  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    include: {
      servicio: { select: { nombre: true, duracionMinutos: true } },
      profesional: { select: { nombres: true, apellidos: true } },
      sede: { select: { nombre: true, direccion: true } },
    },
  });
  if (!cita || cita.deletedAt) { res.status(404).send('Cita no encontrada.'); return; }

  const ics = construirIcsDeCita(cita);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8; method=PUBLISH');
  res.setHeader('Content-Disposition', 'attachment; filename="cita-limablue.ics"');
  res.send(ics);
});

// ─── Acciones del PACIENTE desde el correo (sin sesión) ───────────────────────
// Pasan por el MISMO service que recepción (`cambiarEstadoCita`): cascada al bloque combinado,
// sesión de paquete, Outlook, recordatorios, videos, webhooks, caché de disponibilidad y evento en
// vivo. Antes escribían `estado` directo y dejaban todo eso a medias (la hermana del bloque seguía
// activa, la sesión no se devolvía, el recordatorio seguía saliendo). Se auditan como acciones
// propias del paciente (`confirmar_por_paciente` / `cancelar_por_paciente`), sin usuario.
type CitaPublica = { id: string; estado: string; estadoConfirmacion: string; sedeId: string; fecha: Date; slotGrupoId: string | null };
function actorPaciente(req: Request, accion: string, origen: string) {
  return { cambiadoPor: 'paciente', ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined, accion, auditExtra: { origen } };
}

async function confirmarPorPaciente(cita: CitaPublica, origen: 'correo_reserva' | 'correo_recordatorio', req: Request): Promise<void> {
  const ahora = new Date();
  if (cita.estado === 'agendada') {
    await cambiarEstadoCita({ citaId: cita.id, estado: 'confirmada', hora: ahora }, actorPaciente(req, 'confirmar_por_paciente', origen));
  }
  await prisma.cita.update({ where: { id: cita.id }, data: { estadoConfirmacion: 'confirmada', confirmadaEn: ahora } });
  if (cita.estado !== 'agendada') {
    // Ya estaba confirmada por recepción (o llegó): solo se sella la confirmación del paciente.
    await registrarAudit({
      citaId: cita.id, accion: 'confirmar_por_paciente', entidad: 'cita', entidadId: cita.id,
      antes: { estadoConfirmacion: cita.estadoConfirmacion }, despues: { estadoConfirmacion: 'confirmada', origen },
      sedeId: cita.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    emitirEventoCita({ tipo: 'cita:actualizada', sedeId: cita.sedeId, fecha: fechaAStr(cita.fecha), cita: await getCitaCompleta(cita.id) as never, cambiadoPor: 'paciente' });
  }
  // Ya confirmó: detener el recordatorio pendiente y su job (no reenviar "confirma tu asistencia").
  void cancelarRecordatoriosDeCita(cita.id);
}

/** Devuelve `null` si canceló, o el motivo (texto para el paciente) si no se pudo. */
async function cancelarPorPaciente(cita: CitaPublica, req: Request): Promise<string | null> {
  try {
    await cambiarEstadoCita(
      { citaId: cita.id, estado: 'cancelada', motivoCancelacion: 'Cancelada por el paciente desde el correo de confirmación' },
      actorPaciente(req, 'cancelar_por_paciente', 'correo_paciente'),
    );
  } catch (err) {
    if (err instanceof AppError && ['CITA_CON_ATENCION_CLINICA', 'TRANSICION_INVALIDA', 'ESTADO_CAMBIADO'].includes(err.code ?? '')) {
      return 'Esta cita ya está en curso o fue atendida. Comunícate con Limablue.';
    }
    throw err;
  }
  // La confirmación del paciente queda "cancelada" en toda la visita (bloque incluido).
  await prisma.cita.updateMany({
    where: { estado: 'cancelada', deletedAt: null, OR: [{ id: cita.id }, ...(cita.slotGrupoId ? [{ slotGrupoId: cita.slotGrupoId }] : [])] },
    data: { estadoConfirmacion: 'cancelada' },
  });
  return null;
}

router.get('/confirmar', async (req, res) => {
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(400).send(paginaPublica({ ok: false, titulo: 'Enlace inválido', mensaje: 'Falta el token de confirmación.' }));
    return;
  }

  let citaId: string;
  try {
    citaId = verificarTokenConfirmacion(token).citaId;
  } catch {
    res.status(400).send(paginaPublica({ ok: false, titulo: 'Enlace inválido o vencido', mensaje: 'Este enlace ya no es válido. Comunícate con Limablue para confirmar tu cita.' }));
    return;
  }

  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    include: { servicio: { select: { nombre: true } }, sede: { select: { nombre: true } } },
  });
  if (!cita || cita.deletedAt) {
    res.status(404).send(paginaPublica({ ok: false, titulo: 'Cita no encontrada', mensaje: 'No encontramos esta cita.' }));
    return;
  }

  const detalle = detalleCita(cita);

  // Idempotente: confirmar dos veces no rompe nada.
  if (cita.estadoConfirmacion === 'confirmada') {
    res.send(paginaPublica({ ok: true, titulo: 'Tu cita ya estaba confirmada', mensaje: '¡Te esperamos!', detalle }));
    return;
  }
  if (cita.estado === 'cancelada' || cita.estadoConfirmacion === 'cancelada') {
    res.send(paginaPublica({ ok: false, titulo: 'Esta cita fue cancelada', mensaje: 'Si necesitas reagendar, comunícate con Limablue.', detalle }));
    return;
  }

  await confirmarPorPaciente(cita, 'correo_reserva', req);

  res.send(paginaPublica({ ok: true, titulo: '¡Cita confirmada!', mensaje: 'Gracias por confirmar. ¡Te esperamos en Limablue!', detalle }));
});

// ─── GET /citas/cancelar?token= ──────────── (público, desde el correo) ────────
// El enlace «Cancelar» del correo YA NO cancela con solo abrirse (21-sep-2026): los antivirus y los
// filtros de correo (Safe Links, etc.) visitan los enlaces por su cuenta y cancelaban citas sin que el
// paciente hiciera nada; y un correo viejo cancelaba la cita ya reprogramada sin mostrar cuál era.
// GET = muestra la cita y pregunta. POST (el botón) = cancela.
const manejarCancelarPorEnlace = (ejecutar: boolean) => async (req: Request, res: Response): Promise<void> => {
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(400).send(paginaPublica({ ok: false, titulo: 'Enlace inválido', mensaje: 'Falta el token de cancelación.' }));
    return;
  }

  let citaId: string;
  try {
    citaId = verificarTokenConfirmacion(token).citaId;
  } catch {
    res.status(400).send(paginaPublica({ ok: false, titulo: 'Enlace inválido o vencido', mensaje: 'Este enlace ya no es válido. Comunícate con Limablue.' }));
    return;
  }

  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    include: { servicio: { select: { nombre: true } }, sede: { select: { nombre: true } } },
  });
  if (!cita || cita.deletedAt) {
    res.status(404).send(paginaPublica({ ok: false, titulo: 'Cita no encontrada', mensaje: 'No encontramos esta cita.' }));
    return;
  }

  const detalle = detalleCita(cita);

  // Idempotente.
  if (cita.estado === 'cancelada' || cita.estadoConfirmacion === 'cancelada') {
    res.send(paginaPublica({ ok: true, titulo: 'Tu cita ya estaba cancelada', mensaje: 'No se realizó ningún cobro. Comunícate con Limablue si deseas reagendar.', detalle }));
    return;
  }
  if (['completada', 'no_show', 'en_atencion', 'llego'].includes(cita.estado)) {
    res.send(paginaPublica({ ok: false, titulo: 'No se puede cancelar', mensaje: 'Esta cita ya está en curso o fue atendida. Comunícate con Limablue.', detalle }));
    return;
  }

  if (!ejecutar) {
    res.send(paginaPublica({
      ok: true, pregunta: true, titulo: '¿Cancelar esta cita?', detalle,
      mensaje: 'Si la cancelas, tu horario quedará libre para otro paciente.',
      accionHtml: `<form method="POST" action="?token=${encodeURIComponent(token)}" style="margin:22px 0 0;">
        <button type="submit" style="background:#dc2626;color:#fff;border:0;border-radius:12px;padding:14px 22px;font-size:16px;font-weight:700;width:100%;cursor:pointer;">Sí, cancelar mi cita</button>
      </form>
      <p style="color:#64748b;font-size:13px;margin:14px 0 0;">Si no quieres cancelarla, solo cierra esta página.</p>`,
    }));
    return;
  }

  const noSePudo = await cancelarPorPaciente(cita, req);
  if (noSePudo) {
    res.send(paginaPublica({ ok: false, titulo: 'No se puede cancelar', mensaje: noSePudo, detalle }));
    return;
  }

  res.send(paginaPublica({ ok: true, titulo: 'Cita cancelada', mensaje: 'Tu cita fue cancelada. Si deseas reagendar, comunícate con Limablue.', detalle }));
};
router.get('/cancelar', manejarCancelarPorEnlace(false));
router.post('/cancelar', manejarCancelarPorEnlace(true));

// ─── GET /citas/confirmar/:token ─── (público, botón del recordatorio) ─────────
// Token de un solo uso. Cambia el estado de la cita a CONFIRMADO sin login.
router.get('/confirmar/:token', async (req, res) => {
  const r = await consumirTokenAccion(req.params.token, 'confirmar');
  if (!r.ok) {
    const msg = r.motivo === 'ya_usado'
      ? 'Este enlace ya fue utilizado. Tu cita ya estaba confirmada.'
      : r.motivo === 'expirado'
        ? 'Este enlace ya venció. Comunícate con Limablue para confirmar tu cita.'
        : 'Enlace inválido.';
    res.status(r.motivo === 'ya_usado' ? 200 : 400).send(paginaPublica({ ok: r.motivo === 'ya_usado', titulo: r.motivo === 'ya_usado' ? 'Tu cita ya estaba confirmada' : 'Enlace no válido', mensaje: msg }));
    return;
  }

  const cita = await prisma.cita.findUnique({
    where: { id: r.citaId! },
    include: { servicio: { select: { nombre: true } }, sede: { select: { nombre: true } } },
  });
  if (!cita || cita.deletedAt) {
    res.status(404).send(paginaPublica({ ok: false, titulo: 'Cita no encontrada', mensaje: 'No encontramos esta cita.' }));
    return;
  }
  const detalle = detalleCita(cita);
  if (cita.estado === 'cancelada' || cita.estadoConfirmacion === 'cancelada') {
    res.send(paginaPublica({ ok: false, titulo: 'Esta cita fue cancelada', mensaje: 'Comunícate con Limablue para reagendar.', detalle }));
    return;
  }

  const ahora = new Date();
  await prisma.recordatorioCita.updateMany({
    where: { citaId: cita.id, tipo: 'RECORDATORIO', deletedAt: null },
    data: { clickConfirmarAt: ahora, confirmadoAt: ahora },
  });
  await confirmarPorPaciente(cita, 'correo_recordatorio', req);

  res.send(paginaPublica({ ok: true, titulo: '¡Cita confirmada!', mensaje: 'Gracias por confirmar. ¡Te esperamos en Limablue!', detalle }));
});

// ─── GET /citas/reprogramar/:token ─── (público; registra y redirige a WhatsApp) ─
router.get('/reprogramar/:token', async (req, res) => {
  const numero = (process.env.WHATSAPP_NUMERO || '').replace(/\D/g, '');
  const texto = encodeURIComponent('Hola, deseo reprogramar mi cita, por favor.');
  const waUrl = `https://wa.me/${numero}?text=${texto}`;

  const r = await consumirTokenAccion(req.params.token, 'reprogramar');
  if (r.ok && r.citaId) {
    const ahora = new Date();
    await prisma.recordatorioCita.updateMany({
      where: { citaId: r.citaId, tipo: 'RECORDATORIO', deletedAt: null },
      data: { clickReprogramarAt: ahora },
    });
    await registrarAudit({ citaId: r.citaId, accion: 'click_reprogramar', entidad: 'cita', entidadId: r.citaId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
  }
  // Aunque el token sea inválido/expirado, redirigimos igual a WhatsApp (no romper al paciente).
  res.redirect(302, waUrl);
});

// ─── GET /citas/:id ───────────────────────────────────────────────────────────
// NOTA: se dejó CROSS-SEDE a propósito (decisión del equipo, ago-2026): recepción puede leer una
// cita por id de cualquier sede para "verificación por ficha". El listado GET /citas sí filtra por
// sede. Un agente de seguridad marcó esto como posible fuga de PII entre sedes; si se quiere
// restringir, agregar `guardSedeCita` aquí (pendiente de decisión del usuario).
router.get('/:id', requireAuth, async (req, res) => {
  const cita = await getCitaCompleta(req.params.id);
  if (!cita || cita.deletedAt) throw new AppError('Cita no encontrada', 404);
  res.json(cita);
});

// ─── POST /citas (crear cita) ─────────────────────────────────────────────────
router.post('/', requireAuth, requireAcceso('appointments:write', 'citas.crear'), async (req: Request, res) => {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  // Idempotencia: si ya existe una cita con esta key, devolverla
  if (idempotencyKey) {
    const existe = await prisma.cita.findFirst({
      where: { idempotencyKey, deletedAt: null },
    });
    if (existe) {
      // La llave protege del DOBLE CLIC (mismo formulario enviado dos veces). Si llega con OTRA cita
      // (otro paciente, día u hora) no es un reintento: devolver la cita vieja con 200 haría creer a
      // la pantalla que agendó la nueva. Se rechaza para que se note.
      const b = (req.body ?? {}) as { pacienteId?: string; fecha?: string; horaInicio?: string };
      if ((b.pacienteId && b.pacienteId !== existe.pacienteId) || (b.fecha && b.fecha !== fechaAStr(existe.fecha)) || (b.horaInicio && b.horaInicio !== existe.horaInicio)) {
        throw new AppError('Esta solicitud ya se usó para otra cita. Cierra el formulario y vuelve a abrirlo para agendar.', 409, 'IDEMPOTENCY_KEY_REUSADA');
      }
      res.status(200).json(await getCitaCompleta(existe.id));
      return;
    }
  }

  const data = crearCitaSchema.parse(req.body);
  assertSede(req, data.sedeId); // no crear citas en una sede que no te corresponde
  await validarCanal(data.canal);
  const usuarioId = req.user?.userId;
  assertFechaNoMuyLejana(data.fecha);
  await assertPacienteAgendable(data.pacienteId);

  // ── Cita RETROACTIVA: fecha de la cita anterior a HOY (Lima). Se PERMITE a propósito (registrar
  //    algo que ya ocurrió / una cita cancelada), pero exige motivo y queda marcado + auditado.
  //    El flag no se guarda: se deriva de la fecha; aquí solo persistimos el texto del motivo.
  const esRetroactiva = esFechaPasadaLima(data.fecha);
  const motivoRetroactivo = esRetroactiva ? (data.motivoRetroactivo?.trim() || '') : null;
  if (esRetroactiva && !motivoRetroactivo) {
    throw new AppError('Esta cita es para una fecha pasada: indica el motivo del registro retroactivo', 400, 'MOTIVO_RETROACTIVO_REQUERIDO');
  }

  // Verificar que la unidad opera en la sede
  const sedeUnidad = await prisma.sedeUnidadNegocio.findUnique({
    where: { sedeId_unidadNegocioId: { sedeId: data.sedeId, unidadNegocioId: data.unidadNegocioId } },
  });
  if (!sedeUnidad) throw new AppError('La unidad de negocio no opera en esta sede', 400, 'UNIDAD_NO_EN_SEDE');

  // Obtener servicio
  const servicio = await prisma.servicio.findUnique({ where: { id: data.servicioId } });
  if (!servicio || !servicio.activo) throw new AppError('Servicio no encontrado o inactivo', 404);
  if (servicio.unidadNegocioId !== data.unidadNegocioId) {
    throw new AppError('El servicio no pertenece a la unidad de negocio indicada', 400);
  }

  // Servicios de 1 hora solo en hora entera (08:00, 09:00, …)
  if (!horaInicioValidaParaDuracion(data.horaInicio, servicio.duracionMinutos)) {
    throw new AppError('Los servicios de 1 hora solo pueden iniciarse en hora entera (08:00, 09:00, …)', 400, 'SLOT_HORA_INVALIDA');
  }

  // Subcategoría (ej. Profilaxis → Regular/Premium/…): obligatoria si el servicio la tiene.
  const subcategoriaId = await resolverSubcategoria(data.servicioId, data.subcategoriaId);

  // Obtener unidad de negocio
  const unidad = await prisma.unidadNegocio.findUnique({ where: { id: data.unidadNegocioId } });
  if (!unidad) throw new AppError('Unidad de negocio no encontrada', 404);

  // Determinar profesional
  let profesionalId: string | null = data.profesionalId ?? null;
  // Doctor pedido "Solo X" (baro): la cita va en una máquina, este guarda al médico.
  let solicitadoProfesionalId: string | null = null;
  let origenAsignacion: 'elegida_por_paciente' | 'asignada_automaticamente' | null = null;

  if (unidad.modoReserva === 'sin_eleccion') {
    // Baropodometría: la cita ocupa una MÁQUINA libre (Baro 1/2). 06-oct-2026: si recepción hizo clic en la columna
    // de una máquina (llega como profesionalId) y está libre, va en ESA; si no eligió o está ocupada, la más libre.
    const maquinaElegida = data.profesionalId ?? null;
    profesionalId = await seleccionarProfesionalOptimo(
      data.sedeId, data.unidadNegocioId, data.servicioId, data.fecha, data.horaInicio, maquinaElegida
    );
    if (!profesionalId) throw new AppError('No hay máquina disponible para este slot', 409, 'NO_DISPONIBLE');
    origenAsignacion = maquinaElegida && profesionalId === maquinaElegida ? 'elegida_por_paciente' : 'asignada_automaticamente';
    // …y el MÉDICO que atiende (baro es "solo por solicitud": p.ej. Daniel) se guarda en
    // solicitadoProfesionalId para que quede registrado quién atendió y para que su tiempo
    // quede ocupado también en su columna de podología (anti doble-booking bidireccional).
    // Recepción puede ELEGIR el médico (si el roster de la sede tiene varios); si no, se
    // adjunta el único registrado en esa sede. El médico debe atender baro EN ESA SEDE.
    // 24-sep-2026: el médico ya NO es obligatorio ni se adjunta solo. Si recepción no lo elige, la cita queda sin médico
    // y la TOMA el médico que atienda ese día en la sede («Médico de la cita» / Pacientes del día).
    if (data.solicitadoProfesionalId) {
      const ok = await medicoAtiendeBaroEnSede(data.solicitadoProfesionalId, data.servicioId, data.sedeId, data.fecha);
      if (!ok) throw new AppError('El médico elegido no atiende baropodometría en esta sede', 400, 'MEDICO_BARO_INVALIDO');
      solicitadoProfesionalId = data.solicitadoProfesionalId;
    }
  } else if (unidad.modoReserva === 'preferencia_opcional') {
    if (!profesionalId) {
      // Sin preferencia: asignación automática
      profesionalId = await seleccionarProfesionalOptimo(
        data.sedeId, data.unidadNegocioId, data.servicioId, data.fecha, data.horaInicio
      );
      if (!profesionalId) throw new AppError('No hay profesionales disponibles para este slot', 409, 'NO_DISPONIBLE');
      origenAsignacion = 'asignada_automaticamente';
    } else {
      // Elegida a mano: la cita va con ESA persona, aunque su competencia sea «solo por solicitud» (eso solo la saca
      // del automático). 10-oct-2026: antes se mandaba a una máquina libre como el baro «Solo X», y una cita de
      // Ortésicos (Podología) pedida con Carla Castro terminó en «Baro 2» dentro de Podología. Las máquinas solo
      // operan en Baropodometría, que va por la rama de arriba.
      origenAsignacion = 'elegida_por_paciente';
    }
  } else {
    // preferencia_obligatoria (Fisioterapia)
    if (!profesionalId) throw new AppError('Se requiere seleccionar una fisioterapeuta', 400, 'PROFESIONAL_REQUERIDO');
    origenAsignacion = 'elegida_por_paciente';
  }

  // ─── LOCK anti doble-booking ──────────────────────────────────────────────
  const lockId = uuidv4();
  const lockAcquired = await acquireSlotLock(data.sedeId, profesionalId!, data.fecha, data.horaInicio, lockId);
  if (!lockAcquired) {
    throw new AppError('Slot en proceso de reserva, intente nuevamente', 409, 'SLOT_LOCKED');
  }

  try {
    // Verificar que el profesional tiene el servicio habilitado
    const competencia = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: profesionalId!, servicioId: data.servicioId, activa: true },
    });
    if (!competencia) throw new AppError('El profesional no tiene habilitado este servicio', 400, 'SIN_COMPETENCIA');

    // Si la competencia usada es "solo por solicitud" (médicos de baro, Daniel en baro), el
    // profesional atiende en CUALQUIER sede a pedido del paciente, sin asignación fija. Para
    // competencias normales (p.ej. Daniel en podología) sí debe estar asignado a la sede.
    // 10-oct-2026: fuera de Baropodometría la persona elegida SIEMPRE debe estar asignada a la sede ese día,
    // aunque su competencia sea «solo por solicitud» (si no, se le podía agendar en una sede donde no está).
    if (!competencia.soloPorSolicitud || unidad.modoReserva !== 'sin_eleccion') {
      const fechaAsignacion = fechaDb(data.fecha);
      const asignacionSede = await prisma.asignacionSede.findFirst({
        where: {
          // SIN filtro `activa`: una asignación «reemplazada» por un movimiento FUTURO queda activa=false
          // pero sigue siendo su sede hasta ese día. La agenda y la disponibilidad ya deciden por RANGO;
          // exigir activa aquí dejaba a la podóloga visible y con huecos, pero imposible de agendar.
          profesionalId: profesionalId!,
          sedeId: data.sedeId,
          fechaInicio: { lte: fechaAsignacion },
          OR: [{ fechaFin: null }, { fechaFin: { gte: fechaAsignacion } }],
        },
      });
      if (!asignacionSede) throw new AppError('El profesional no está asignado a esta sede en la fecha indicada', 400, 'SIN_ASIGNACION_SEDE');
    }

    const fechaDate = fechaDb(data.fecha);
    // Verificar el TURNO del profesional ese día (normal por HorarioProfesional, o
    // excepcional por excepción-de-sede-abierta + EntradaPodologa — ver turnosDelDia).
    await assertProfesionalActivo(profesionalId);
    const turnos = await turnosDelDia(data.sedeId, data.fecha, [profesionalId!]);
    const horario = turnos.get(profesionalId!);
    if (!horario) throw new AppError('El profesional no atiende este día', 400, 'SIN_HORARIO');

    // Verificar que el slot está dentro del rango horaInicio..horaFin del turno
    if (data.horaInicio < horario.horaInicio || data.horaInicio >= horario.horaFin) {
      throw new AppError(
        `El slot ${data.horaInicio} está fuera del horario del profesional (${horario.horaInicio}–${horario.horaFin})`,
        400,
        'SLOT_FUERA_HORARIO',
      );
    }
    // La cita COMPLETA debe terminar dentro del turno (no pasar la hora de salida). Antes esto
    // lo garantizaba la regla de hora-entera; ahora que las citas de 1h pueden empezar en :30,
    // hay que verificar el fin explícitamente.
    const finSlot = timeToMinutes(data.horaInicio) + servicio.duracionMinutos;
    if (finSlot > timeToMinutes(horario.horaFin)) {
      throw new AppError(
        `La cita terminaría ${minutesToTime(finSlot)}, después del fin de turno del profesional (${horario.horaFin}).`,
        400,
        'SLOT_EXCEDE_TURNO',
      );
    }

    // Verificar que el slot no choca con un bloqueo del profesional (permiso, almuerzo, etc.)
    await validarSinBloqueo(profesionalId!, data.fecha, data.horaInicio, servicio.duracionMinutos, data.sedeId);

    // Anti doble-booking CRUZADO entre unidades: el profesional efectivo y, si la cita
    // es "Solo X" (baro), el médico solicitado, no pueden estar ocupados en otra unidad
    // a esa hora. (El índice de slot solo cubre el mismo profesionalId; esto cubre el
    // caso Daniel en Podología ↔ Baropodometría.)
    await validarProfesionalLibre(profesionalId!, data.fecha, data.horaInicio, servicio.duracionMinutos);
    // Servicio con sala/equipo único en la sede (p. ej. Motiphysio): no puede cruzarse con otra cita del mismo servicio.
    await validarCupoServicio(prisma, { servicioId: data.servicioId, sedeId: data.sedeId, fecha: data.fecha, horaInicio: data.horaInicio, duracionMin: servicio.duracionMinutos });
    if (solicitadoProfesionalId) {
      await validarProfesionalLibre(solicitadoProfesionalId, data.fecha, data.horaInicio, servicio.duracionMinutos);
      // El médico pedido "Solo X" (p.ej. Daniel en baro) también debe estar libre de BLOQUEOS
      // (reunión, permiso, almuerzo): la cita va en una máquina, pero él no puede atenderla si
      // tiene una reunión a esa hora. Sin esto, su reunión bloqueaba podología pero NO baro.
      await validarSinBloqueo(solicitadoProfesionalId, data.fecha, data.horaInicio, servicio.duracionMinutos, data.sedeId);
    }

    // Comentario inicial (opcional): se guarda como primera ENTRADA del hilo
    // append-only (ya no en una columna de la cita).
    const comentarioInicial = data.comentarioRecepcion?.trim() || null;

    // Calcular número de sesión si hay paquete.
    // sesionesUsadas = sesiones ya CONSUMIDAS (solo citas completada; no_show NO consume).
    // citasProgramadas = citas activas (aún no completadas) que ya reservaron una sesión.
    // La nueva cita toma el siguiente número disponible.
    let sesionNumero: number | null = null;
    let reanclajeGenexis: { paqueteId: string; objetivoApertura: number; sesionElegida: number } | null = null;
    if (data.paquetePacienteId) {
      const paquetePac = await prisma.paquetePaciente.findUnique({ where: { id: data.paquetePacienteId } });
      if (paquetePac) {
        // Candado de sede TAMBIÉN al agendar: el paquete se atiende donde se compró.
        if (paquetePac.sedeId && paquetePac.sedeId !== data.sedeId) {
          const sedePaquete = await prisma.sede.findUnique({ where: { id: paquetePac.sedeId }, select: { nombre: true } });
          throw new AppError(
            `El paquete de este paciente pertenece a ${sedePaquete?.nombre ?? 'otra sede'} — agenda la sesión allá o usa consumo manual auditado.`,
            409,
            'PAQUETE_OTRA_SEDE',
          );
        }
        // citasProgramadas = citas activas que reservaron una sesión pero AÚN NO la consumieron.
        // Las ya consumidas viven en `sesionesUsadas`; incluirlas aquí las contaría DOS veces y
        // saltaba la numeración (una 'llego' consumida → la siguiente salía 3 en vez de 2).
        const citasProgramadas = await prisma.cita.count({
          where: {
            paquetePacienteId: data.paquetePacienteId,
            estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] },
            sesionConsumida: false,
            deletedAt: null,
          },
        });
        const citasVivasPaquete = await prisma.cita.count({
          where: { paquetePacienteId: data.paquetePacienteId, deletedAt: null, estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] } },
        });
        const esGenexisSinAnclar = paquetePac.origen === 'GENEXIS_APERTURA' && citasVivasPaquete === 0;
        if (esGenexisSinAnclar) {
          // MIGRACIÓN GENEXIS — ADJUDICACIÓN MANUAL CON REANCLAJE: la primera cita
          // del paquete en la Agenda nueva la numera RECEPCIÓN mirando el visor
          // Genexis (desplegable con TODAS las sesiones). Su elección re-ancla el
          // paquete: sesiones previas = tomadas en Genexis (se ajusta la apertura),
          // y DESDE LA SIGUIENTE la numeración es automática (como paquete nativo).
          if (!data.sesionNumeroManual) {
            throw new AppError(
              'Este paquete viene de Genexis: elige del desplegable qué sesión corresponde (revisa el Historial Genexis).',
              400,
              'SESION_MANUAL_REQUERIDA',
            );
          }
          if (data.sesionNumeroManual > paquetePac.sesionesTotal) {
            throw new AppError(`La sesión ${data.sesionNumeroManual} excede el paquete (${paquetePac.sesionesTotal})`, 400, 'SESION_FUERA_DE_RANGO');
          }
          const otrosVivos = await prisma.consumoSesion.count({
            where: { paqueteId: data.paquetePacienteId, deletedAt: null, origen: { not: 'APERTURA' } },
          });
          const objetivoApertura = data.sesionNumeroManual - 1 - otrosVivos;
          if (objetivoApertura < 0) {
            throw new AppError(
              `Ya hay ${otrosVivos} sesión(es) consumidas en la Agenda — la sesión ${data.sesionNumeroManual} no es posible`,
              409,
              'SESION_INCOMPATIBLE',
            );
          }
          sesionNumero = data.sesionNumeroManual;
          reanclajeGenexis = { paqueteId: data.paquetePacienteId, objetivoApertura, sesionElegida: data.sesionNumeroManual };
        } else {
          // Numeración AUTOMÁTICA: paquetes nacidos en la Agenda y paquetes Genexis
          // YA ANCLADOS por una primera adjudicación manual.
          if (paquetePac.sesionesUsadas + citasProgramadas >= paquetePac.sesionesTotal) {
            throw new AppError(
              `El paquete ya no tiene sesiones disponibles (${paquetePac.sesionesTotal}/${paquetePac.sesionesTotal} usadas o agendadas). Active un paquete nuevo si el paciente lo requiere.`,
              409,
              'PAQUETE_SIN_SESIONES',
            );
          }
          sesionNumero = paquetePac.sesionesUsadas + citasProgramadas + 1;
        }
      }
    }

    // ─── Precio de lista + promoción (snapshot para caja/reportes) ──────────────────
    // La promo NUNCA se combina con una membresía (regla de negocio). Se revalida estricto
    // server-side (la promo debe CALIFICAR por servicio/sede/fecha/canal/cupo).
    const precioLista = await precioListaDe(data.servicioId, subcategoriaId);
    let montoDescuento: number | null = null;
    let montoFinal = precioLista;
    if (data.promocionId) {
      if (data.paquetePacienteId) {
        throw new AppError('Una promoción no se combina con una membresía. Elige una u otra.', 409, 'PROMO_CON_MEMBRESIA');
      }
      const calc = await validarYCalcularPromo(
        data.promocionId,
        { servicioId: data.servicioId, sedeId: data.sedeId, fecha: data.fecha, canal: data.canal, pacienteId: data.pacienteId },
        precioLista,
        data.codigoPromo,
      );
      montoDescuento = calc.descuento;
      montoFinal = calc.final;
    }

    // Creación + audit en la MISMA transacción (historial inmutable y atómico).
    // `withDeadlockRetry` + Serializable: bajo alta concurrencia dos INSERT de citas que
    // referencian filas padre compartidas por FK (profesional/sede/servicio/promoción)
    // pueden deadlockear (Postgres 40P01 → Prisma P2034). El retry reintenta la víctima
    // ya sin contención; el índice único parcial sigue siendo la última defensa real. El
    // retry vive DENTRO del try/finally externo → el lock Redis se sostiene entre intentos
    // y se libera una sola vez al final (nunca huérfano). Igual patrón que /citas/combinada.
    let cita;
    try {
      cita = await withDeadlockRetry(
        () => prisma.$transaction(async (tx) => {
          // REANCLAJE GENEXIS: ajustar la apertura para que las sesiones previas a la
      // elegida queden como tomadas en Genexis (recepción manda sobre la conciliación).
      if (reanclajeGenexis) {
        const aperturaVivos = await tx.consumoSesion.findMany({
          where: { paqueteId: reanclajeGenexis.paqueteId, origen: 'APERTURA', deletedAt: null },
          orderBy: { creadoEn: 'desc' },
          select: { id: true },
        });
        const diff = aperturaVivos.length - reanclajeGenexis.objetivoApertura;
        if (diff > 0) {
          await tx.consumoSesion.updateMany({
            where: { id: { in: aperturaVivos.slice(0, diff).map((k) => k.id) } },
            data: { deletedAt: new Date(), anuladoMotivo: `Reanclaje: recepción adjudicó la sesión ${reanclajeGenexis.sesionElegida} (visor Genexis)` },
          });
        } else if (diff < 0) {
          await tx.consumoSesion.createMany({
            data: Array.from({ length: -diff }, () => ({
              paqueteId: reanclajeGenexis!.paqueteId,
              fecha: new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })).toISOString().slice(0, 10),
              origen: 'APERTURA',
              registradoPor: `Reanclaje: recepción adjudicó la sesión ${reanclajeGenexis.sesionElegida} (visor Genexis)`,
              registradoPorId: usuarioId ?? null,
            })),
          });
        }
        await recalcularPaquete(tx, reanclajeGenexis.paqueteId);
        await auditEnTx(tx, {
          usuarioId,
          accion: 'reanclar_apertura_genexis',
          entidad: 'paquete_paciente',
          entidadId: reanclajeGenexis.paqueteId,
          antes: { aperturaConsumidas: aperturaVivos.length },
          despues: { aperturaConsumidas: reanclajeGenexis.objetivoApertura, sesionAdjudicada: reanclajeGenexis.sesionElegida },
        });
      }
      // Cupo POR-ÍTEM de membresía (Premium ≠ Regular): dentro de la tx Serializable para
      // que dos reservas simultáneas del mismo tipo no se cuelen. Reserva al AGENDAR, no
      // solo al consumir → no deja agendar 2 Premium cuando la membresía incluye 1.
      if (data.paquetePacienteId) {
        await validarCupoItemAlAgendar(tx, data.paquetePacienteId, data.servicioId, subcategoriaId ?? null);
        // CUPO GLOBAL del paquete recalculado DENTRO de la tx Serializable (salvo el flujo Genexis
        // con reanclaje manual, que numera aparte): así dos registros simultáneos del mismo paquete
        // no pueden colarse ambos → no se sobre-agenda → no hay saldo negativo. Cancelar/no-show
        // libera el cupo (la cita sale del conteo). Reusa la misma lógica atómica del bloque combinado.
        if (!reanclajeGenexis) {
          sesionNumero = await calcularSesionNumeroTx(tx, data.paquetePacienteId, data.sedeId);
        }
      }
      // ANTI-DOBLE-BOOKING ATÓMICO: re-chequear el solape DENTRO de la tx Serializable. El índice
      // único parcial solo cubre (prof, fecha, horaInicio) EXACTO; dos citas que se SOLAPAN con
      // distinto horaInicio (p.ej. 08:00 60min y 08:30 30min) no chocan en el índice. Corriendo el
      // SELECT de solape aquí, la serialización (SSI) de Postgres aborta una de dos reservas
      // concurrentes solapadas (40001 → withDeadlockRetry reintenta → ve la otra → 409). Cubre al
      // profesional y al médico de baro (solicitadoProfesionalId).
      await validarProfesionalLibre(profesionalId!, data.fecha, data.horaInicio, servicio.duracionMinutos, undefined, [], tx);
      if (solicitadoProfesionalId && solicitadoProfesionalId !== profesionalId) {
        await validarProfesionalLibre(solicitadoProfesionalId, data.fecha, data.horaInicio, servicio.duracionMinutos, undefined, [], tx);
      }
      await validarCupoServicio(tx, { servicioId: data.servicioId, sedeId: data.sedeId, fecha: data.fecha, horaInicio: data.horaInicio, duracionMin: servicio.duracionMinutos });
      const c = await tx.cita.create({
        data: {
          pacienteId: data.pacienteId,
          profesionalId,
          solicitadoProfesionalId,
          // Baro con médico elegido al agendar: ese médico ES el médico de la cita (mismo dato que cuando lo toma él ese día).
          ...(unidad.modoReserva === 'sin_eleccion' && solicitadoProfesionalId
            ? { medicoId: solicitadoProfesionalId, medicoAsignadoEn: new Date(), medicoAsignadoPorId: usuarioId ?? null }
            : {}),
          sedeId: data.sedeId,
          unidadNegocioId: data.unidadNegocioId,
          servicioId: data.servicioId,
          subcategoriaId,
          fecha: fechaDate,
          horaInicio: data.horaInicio,
          duracionMinutos: servicio.duracionMinutos,
          estado: 'agendada',
          canal: data.canal,
          origenAsignacion,
          creadoPorUsuarioId: usuarioId ?? null, // quién hizo la reserva
          ...(estadoPagoInicial(data) !== 'pendiente' ? camposPago(estadoPagoInicial(data), usuarioId) : {}),
          motivoRetroactivo, // null salvo que se agende en fecha pasada
          idempotencyKey: idempotencyKey ?? null,
          paquetePacienteId: data.paquetePacienteId,
          promocionId: data.promocionId ?? null,
          precioLista,
          montoDescuento,
          montoFinal,
          sesionNumero,
          comprobanteUrl:      data.comprobanteUrl ? limpiarUrlArchivo(data.comprobanteUrl) : null,
          comprobanteNombre:   data.comprobanteNombre   ?? null,
          comprobanteMimeType: data.comprobanteMimeType ?? null,
          comprobanteSubidoPor: data.comprobanteUrl ? usuarioId : null,
          comprobanteSubidoEn:  data.comprobanteUrl ? new Date() : null,
        },
      });
      await auditEnTx(tx, {
        // Retroactiva → acción distinta para que RESALTE y sea filtrable en auditoría.
        citaId: c.id,
        usuarioId,
        accion: esRetroactiva ? 'crear_retroactiva' : 'crear',
        entidad: 'cita',
        entidadId: c.id,
        // `antes` documenta el POR QUÉ y cuántos días atrás (solo en retroactivas).
        antes: esRetroactiva ? { retroactiva: true, diasAtras: diasEnPasadoLima(data.fecha), motivo: motivoRetroactivo } : undefined,
        despues: citaParaAuditoria(c),
        sedeId: data.sedeId,
        ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
      });
      if (comentarioInicial) {
        await crearComentarioEnTx(tx, { citaId: c.id, sedeId: data.sedeId, autorId: usuarioId ?? null, texto: comentarioInicial, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
      }
          return c;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
        {
          onRetry: ({ intento, esperaMs }) =>
            console.warn(`[citas] deadlock al crear cita — reintento ${intento} en ${esperaMs}ms (slot ${data.sedeId}/${profesionalId}/${data.fecha} ${data.horaInicio})`),
        },
      );
    } catch (err) {
      // Unicidad (P2002) o deadlock que agotó los reintentos → 409 limpio, nunca 500. El
      // índice único parcial es la última defensa; un AppError de negocio (slot ocupado,
      // horario inválido…) pasa intacto sin convertirse en SLOT_OCUPADO. `esConflictoDeSlot`
      // cubre tanto el P2034 clasificado por Prisma como el 40P01/40001 CRUDO que Prisma
      // re-lanza como PrismaClientUnknownRequestError (que antes caía al 500, ver Gate 0).
      if (esConflictoDeSlot(err)) {
        throw new AppError('Ese horario acaba de ocuparse. Refresque e intente otra vez.', 409, 'SLOT_OCUPADO');
      }
      throw err;
    }

    // Invalidar cache
    await invalidateDisponibilidadCache(data.sedeId, data.fecha);

    // Obtener cita completa
    const citaCompleta = await getCitaCompleta(cita.id);

    // Emitir evento WebSocket
    emitirEventoCita({
      tipo: 'cita:creada',
      sedeId: data.sedeId,
      fecha: data.fecha,
      cita: citaCompleta as never,
      cambiadoPor: req.user?.userId ?? 'sistema',
    });

    // Disparar webhooks
    await dispararWebhooks('appointment.created', data.sedeId, citaCompleta);

    // RECORDATORIOS: Correo 1 (reserva, inmediato) + programa Correo 2
    // (recordatorio con acciones) según las reglas de tiempo. Fire-and-forget.
    void programarRecordatoriosDeCita(cita.id);
    // VIDEOS POR SERVICIO: registra los envíos programados de los videos del servicio.
    void sincronizarVideosDeCita(cita.id);
    // Replica en Outlook si la cita es de Yasica/Daniel Doy (no bloqueante).
    void sincronizarCitaOutlook('crear', cita.id);

    res.status(201).json(citaCompleta);
  } finally {
    await releaseSlotLock(data.sedeId, profesionalId!, data.fecha, data.horaInicio, lockId);
  }
});

// ─── Helpers para bloques combinados ──────────────────────────────────────────

// Valida una "pata" del bloque (ancla o extra) tratándola como una ocupación
// independiente: competencia, asignación a sede, turno, bloqueos y cruce de horario.
// Reutiliza exactamente los mismos chequeos que el POST individual. `duracionSlot` es
// la duración del SLOT físico (la del ancla, 60 min) — ambas patas comparten inicio/fin.
async function validarLegBloque(opts: {
  profesionalId: string; sedeId: string; servicioId: string; unidadNegocioId: string;
  fecha: string; horaInicio: string; duracionSlot: number;
}) {
  const competencia = await prisma.competenciaProfesional.findFirst({
    where: { profesionalId: opts.profesionalId, servicioId: opts.servicioId, activa: true },
  });
  if (!competencia) throw new AppError('El profesional no tiene habilitado ese servicio', 400, 'SIN_COMPETENCIA');

  const unidadLeg = await prisma.unidadNegocio.findUnique({ where: { id: opts.unidadNegocioId }, select: { modoReserva: true } });
  if (!competencia.soloPorSolicitud || unidadLeg?.modoReserva !== 'sin_eleccion') {
    const fechaAsignacion = fechaDb(opts.fecha);
    const asignacionSede = await prisma.asignacionSede.findFirst({
      where: {
        profesionalId: opts.profesionalId, sedeId: opts.sedeId, // por RANGO, sin `activa` (ver crear cita)
        fechaInicio: { lte: fechaAsignacion },
        OR: [{ fechaFin: null }, { fechaFin: { gte: fechaAsignacion } }],
      },
    });
    if (!asignacionSede) throw new AppError('El profesional no está asignado a esa sede en la fecha', 400, 'SIN_ASIGNACION_SEDE');
  }

  await assertProfesionalActivo(opts.profesionalId);
  const turnos = await turnosDelDia(opts.sedeId, opts.fecha, [opts.profesionalId]);
  const horario = turnos.get(opts.profesionalId);
  if (!horario) throw new AppError('El profesional no atiende ese día', 400, 'SIN_HORARIO');
  if (opts.horaInicio < horario.horaInicio || opts.horaInicio >= horario.horaFin) {
    throw new AppError(`El slot ${opts.horaInicio} está fuera del horario del profesional (${horario.horaInicio}–${horario.horaFin})`, 400, 'SLOT_FUERA_HORARIO');
  }
  // El bloque completo (1 h) debe terminar dentro del turno (no pasar la hora de salida).
  const finSlot = timeToMinutes(opts.horaInicio) + opts.duracionSlot;
  if (finSlot > timeToMinutes(horario.horaFin)) {
    throw new AppError(`El bloque terminaría ${minutesToTime(finSlot)}, después del fin de turno del profesional (${horario.horaFin}).`, 400, 'SLOT_EXCEDE_TURNO');
  }

  await validarSinBloqueo(opts.profesionalId, opts.fecha, opts.horaInicio, opts.duracionSlot, opts.sedeId);
  await validarProfesionalLibre(opts.profesionalId, opts.fecha, opts.horaInicio, opts.duracionSlot);
}

// Calcula el siguiente número de sesión de un paquete DENTRO de una transacción
// (mismo criterio que el POST individual: usadas + programadas + 1, sin pasarse del total).
async function calcularSesionNumeroTx(tx: Prisma.TransactionClient, paquetePacienteId: string, sedeIdCita: string): Promise<number | null> {
  const paquetePac = await tx.paquetePaciente.findUnique({ where: { id: paquetePacienteId } });
  if (!paquetePac) return null;
  // Candado de sede — MISMA regla que el create individual: el paquete se atiende
  // donde se compró. Antes el bloque combinado se saltaba este candado.
  if (paquetePac.sedeId && paquetePac.sedeId !== sedeIdCita) {
    const sedePaquete = await tx.sede.findUnique({ where: { id: paquetePac.sedeId }, select: { nombre: true } });
    throw new AppError(
      `El paquete de este paciente pertenece a ${sedePaquete?.nombre ?? 'otra sede'} — agenda la sesión allá o usa consumo manual auditado.`,
      409,
      'PAQUETE_OTRA_SEDE',
    );
  }
  // Un paquete Genexis SIN ANCLAR exige adjudicación manual de la sesión (desplegable del
  // create individual). El bloque combinado no tiene ese flujo → se pide agendar la
  // PRIMERA sesión como cita individual, en vez de auto-numerar mal.
  const citasVivas = await tx.cita.count({
    where: { paquetePacienteId, deletedAt: null, estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] } },
  });
  if (paquetePac.origen === 'GENEXIS_APERTURA' && citasVivas === 0) {
    throw new AppError(
      'Este paquete viene de Genexis y su primera sesión requiere adjudicación manual: agéndala como cita individual (no en bloque combinado).',
      400, 'SESION_MANUAL_REQUERIDA',
    );
  }
  // Solo las citas activas que AÚN NO consumieron (las consumidas ya están en sesionesUsadas;
  // contarlas aquí las duplicaría y saltaría la numeración).
  const citasProgramadas = await tx.cita.count({
    where: {
      paquetePacienteId, estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] }, sesionConsumida: false, deletedAt: null,
    },
  });
  if (paquetePac.sesionesUsadas + citasProgramadas >= paquetePac.sesionesTotal) {
    throw new AppError(
      `El paquete ya no tiene sesiones disponibles (${paquetePac.sesionesTotal}/${paquetePac.sesionesTotal}).`,
      409, 'PAQUETE_SIN_SESIONES',
    );
  }
  return paquetePac.sesionesUsadas + citasProgramadas + 1;
}

// ─── POST /citas/combinada ────────────────────────────────────────────────────
// Crea ATÓMICAMENTE las 2 citas de un bloque combinado (profilaxis ancla + extra)
// que comparten `slotGrupoId` y el mismo intervalo de 1 h. Anti-doble-booking
// garantizado por los índices parciales `citas_slot_primario/secundario_unique`.
router.post('/combinada', requireAuth, requireAcceso('appointments:write', 'citas.crear'), async (req: Request, res) => {
  const data = crearCombinadaSchema.parse(req.body);
  assertSede(req, data.sedeId); // no crear bloques en una sede que no te corresponde
  const usuarioId = req.user?.userId;
  await validarCanal(data.canal);
  assertFechaNoMuyLejana(data.fecha);
  await assertPacienteAgendable(data.pacienteId);

  // Bloque RETROACTIVO (fecha pasada): mismo criterio que la cita individual — exige motivo, se
  // marca y se audita. El motivo se guarda en AMBAS citas del bloque (para el chip en cada una).
  const esRetroactiva = esFechaPasadaLima(data.fecha);
  const motivoRetroactivo = esRetroactiva ? (data.motivoRetroactivo?.trim() || '') : null;
  if (esRetroactiva && !motivoRetroactivo) {
    throw new AppError('Este bloque es para una fecha pasada: indica el motivo del registro retroactivo', 400, 'MOTIVO_RETROACTIVO_REQUERIDO');
  }

  // 1) El servicio del ancla debe ser el ancla configurado.
  const anclaId = await getServicioAnclaId();
  if (!anclaId) throw new AppError('No hay un servicio ancla configurado para combinaciones', 400, 'SIN_ANCLA');
  if (data.servicioId !== anclaId) throw new AppError('El servicio principal no es el ancla configurada (profilaxis)', 400, 'NO_ES_ANCLA');

  // 2) El extra debe estar en la lista de combinables activos, y no ser el propio ancla.
  if (data.extra.servicioId === anclaId) throw new AppError('El extra no puede ser el mismo servicio ancla', 400, 'EXTRA_ES_ANCLA');
  if (!(await esCombinacionPermitida(data.extra.servicioId))) {
    throw new AppError('Ese servicio no está permitido como combinación', 400, 'COMBINACION_NO_PERMITIDA');
  }

  // 3) Servicios y unidades.
  const [anclaSrv, extraSrv] = await Promise.all([
    prisma.servicio.findUnique({ where: { id: data.servicioId } }),
    prisma.servicio.findUnique({ where: { id: data.extra.servicioId } }),
  ]);
  if (!anclaSrv || !anclaSrv.activo) throw new AppError('Servicio ancla no encontrado o inactivo', 404);
  if (!extraSrv || !extraSrv.activo) throw new AppError('Servicio extra no encontrado o inactivo', 404);
  if (anclaSrv.unidadNegocioId !== data.unidadNegocioId) throw new AppError('El servicio ancla no pertenece a la unidad indicada', 400);

  const duracionSlot = anclaSrv.duracionMinutos; // el bloque ocupa 1 slot (la duración del ancla)
  if (!horaInicioValidaParaDuracion(data.horaInicio, duracionSlot)) {
    throw new AppError('Los bloques combinados solo pueden iniciarse en hora entera (08:00, 09:00, …)', 400, 'SLOT_HORA_INVALIDA');
  }

  // Subcategoría del ANCLA (profilaxis → Regular/Premium/…): obligatoria si la tiene.
  const subcategoriaAncla = await resolverSubcategoria(data.servicioId, data.subcategoriaId);
  // El EXTRA también respeta la obligatoriedad de subcategoría (misma regla que el
  // create individual): si su servicio tiene subcategorías activas, debe venir una.
  const subcategoriaExtra = await resolverSubcategoria(data.extra.servicioId, data.extra.subcategoriaId);

  // Precio de lista del BLOQUE (ancla + extra) + promoción. La promo vive en la PRINCIPAL y
  // NO se combina con membresía. Se revalida estricto (debe calificar por el servicio ancla).
  const precioListaBloque = (await precioListaDe(data.servicioId, subcategoriaAncla)) + (await precioListaDe(data.extra.servicioId, subcategoriaExtra));
  let montoDescuentoBloque: number | null = null;
  let montoFinalBloque = precioListaBloque;
  if (data.promocionId) {
    if (data.paquetePacienteId || data.extra.paquetePacienteId) {
      throw new AppError('Una promoción no se combina con una membresía. Elige una u otra.', 409, 'PROMO_CON_MEMBRESIA');
    }
    const calc = await validarYCalcularPromo(
      data.promocionId,
      { servicioId: data.servicioId, sedeId: data.sedeId, fecha: data.fecha, canal: data.canal, pacienteId: data.pacienteId },
      precioListaBloque,
      data.codigoPromo,
    );
    montoDescuentoBloque = calc.descuento;
    montoFinalBloque = calc.final;
  }

  // Profesional del ANCLA: si la recepción no eligió una, se asigna automáticamente
  // (igual que una profilaxis normal "Sin preferencia"). El extra usa la suya o, por
  // defecto, la misma del ancla.
  let anclaProfesionalId = data.profesionalId ?? null;
  let origenAncla: 'elegida_por_paciente' | 'asignada_automaticamente' = 'elegida_por_paciente';
  if (!anclaProfesionalId) {
    anclaProfesionalId = await seleccionarProfesionalOptimo(data.sedeId, data.unidadNegocioId, data.servicioId, data.fecha, data.horaInicio);
    if (!anclaProfesionalId) throw new AppError('No hay profesionales disponibles para este slot', 409, 'NO_DISPONIBLE');
    origenAncla = 'asignada_automaticamente';
  }
  const extraProfesionalId = data.extra.profesionalId ?? anclaProfesionalId;

  // La sede debe operar ambas unidades.
  for (const unId of new Set([data.unidadNegocioId, extraSrv.unidadNegocioId])) {
    const su = await prisma.sedeUnidadNegocio.findUnique({
      where: { sedeId_unidadNegocioId: { sedeId: data.sedeId, unidadNegocioId: unId } },
    });
    if (!su) throw new AppError('La unidad de negocio no opera en esta sede', 400, 'UNIDAD_NO_EN_SEDE');
  }

  // 4) Validar disponibilidad de cada pata por separado (antes de tomar locks).
  await validarLegBloque({
    profesionalId: anclaProfesionalId, sedeId: data.sedeId, servicioId: data.servicioId,
    unidadNegocioId: data.unidadNegocioId, fecha: data.fecha, horaInicio: data.horaInicio, duracionSlot,
  });
  await validarLegBloque({
    profesionalId: extraProfesionalId, sedeId: data.sedeId, servicioId: data.extra.servicioId,
    unidadNegocioId: extraSrv.unidadNegocioId, fecha: data.fecha, horaInicio: data.horaInicio, duracionSlot,
  });

  // 5) Locks de slot en orden determinista (profesionalId asc) para evitar deadlocks.
  const profesionalesUnicos = [...new Set([anclaProfesionalId, extraProfesionalId])].sort();
  const lockId = uuidv4();
  const adquiridos: string[] = [];
  try {
    for (const pid of profesionalesUnicos) {
      const ok = await acquireSlotLock(data.sedeId, pid, data.fecha, data.horaInicio, lockId);
      if (!ok) throw new AppError('Slot en proceso de reserva, intente nuevamente', 409, 'SLOT_LOCKED');
      adquiridos.push(pid);
    }

    const slotGrupoId = uuidv4();
    const fechaDate = fechaDb(data.fecha);

    // 6) Crear ambas citas + audits en UNA transacción Serializable. Si la DB rechaza
    // por violación de unicidad o conflicto de serialización (carrera) → 409.
    let citas: { anclaId: string; extraId: string };
    try {
      citas = await prisma.$transaction(async (tx) => {
        const sesionAncla = data.paquetePacienteId ? await calcularSesionNumeroTx(tx, data.paquetePacienteId, data.sedeId) : null;
        const sesionExtra = data.extra.paquetePacienteId ? await calcularSesionNumeroTx(tx, data.extra.paquetePacienteId, data.sedeId) : null;
        // Cupo por-ítem de membresía (Premium ≠ Regular) para cada mitad del bloque.
        if (data.paquetePacienteId) await validarCupoItemAlAgendar(tx, data.paquetePacienteId, data.servicioId, subcategoriaAncla ?? null);
        if (data.extra.paquetePacienteId) await validarCupoItemAlAgendar(tx, data.extra.paquetePacienteId, data.extra.servicioId, subcategoriaExtra ?? null);

        // ANTI-DOBLE-BOOKING ATÓMICO dentro de la tx Serializable: el/los profesional(es) del bloque
        // deben estar libres CONTRA CITAS EXISTENTES (las 2 del bloque comparten slot a propósito y
        // aún no existen, por eso se chequea ANTES de crear). Frena bloques concurrentes solapados.
        await validarProfesionalLibre(anclaProfesionalId, data.fecha, data.horaInicio, duracionSlot, undefined, [], tx);
        if (extraProfesionalId !== anclaProfesionalId) {
          await validarProfesionalLibre(extraProfesionalId, data.fecha, data.horaInicio, duracionSlot, undefined, [], tx);
        }
        // Servicios con sala/equipo único en la sede (Motiphysio): ninguna de las dos mitades puede cruzarse con otra cita suya.
        await validarCupoServicio(tx, { servicioId: data.servicioId, sedeId: data.sedeId, fecha: data.fecha, horaInicio: data.horaInicio, duracionMin: duracionSlot });
        await validarCupoServicio(tx, { servicioId: data.extra.servicioId, sedeId: data.sedeId, fecha: data.fecha, horaInicio: data.horaInicio, duracionMin: duracionSlot });

        const ancla = await tx.cita.create({
          data: {
            pacienteId: data.pacienteId, profesionalId: anclaProfesionalId, sedeId: data.sedeId,
            unidadNegocioId: data.unidadNegocioId, servicioId: data.servicioId, subcategoriaId: subcategoriaAncla, fecha: fechaDate,
            horaInicio: data.horaInicio, duracionMinutos: duracionSlot, estado: 'agendada',
            canal: data.canal, origenAsignacion: origenAncla, creadoPorUsuarioId: usuarioId ?? null,
            ...(estadoPagoInicial(data) !== 'pendiente' ? camposPago(estadoPagoInicial(data), usuarioId) : {}),
            motivoRetroactivo,
            paquetePacienteId: data.paquetePacienteId, sesionNumero: sesionAncla,
            // FUENTE ÚNICA: la promo del bloque vive SOLO aquí (PRINCIPAL/profilaxis); la
            // SECUNDARIO va con promocionId null. Así analytics/conteos nunca duplican.
            // Igual el precio del bloque (ancla+extra) y su descuento viven en la PRINCIPAL.
            promocionId: data.promocionId ?? null,
            precioLista: precioListaBloque,
            montoDescuento: montoDescuentoBloque,
            montoFinal: montoFinalBloque,
            ...(data.comprobanteUrl ? {
              comprobanteUrl: limpiarUrlArchivo(data.comprobanteUrl), comprobanteNombre: data.comprobanteNombre ?? null,
              comprobanteMimeType: data.comprobanteMimeType ?? null, comprobanteSubidoPor: usuarioId ?? null, comprobanteSubidoEn: new Date(),
            } : {}),
            slotGrupoId, slotRol: 'PRINCIPAL',
          },
        });
        const extra = await tx.cita.create({
          data: {
            pacienteId: data.pacienteId, profesionalId: extraProfesionalId, sedeId: data.sedeId,
            unidadNegocioId: extraSrv.unidadNegocioId, servicioId: data.extra.servicioId, subcategoriaId: subcategoriaExtra, fecha: fechaDate,
            horaInicio: data.horaInicio, duracionMinutos: duracionSlot, estado: 'agendada',
            canal: data.canal, origenAsignacion: 'elegida_por_paciente', creadoPorUsuarioId: usuarioId ?? null,
            ...(estadoPagoInicial(data) !== 'pendiente' ? camposPago(estadoPagoInicial(data), usuarioId) : {}),
            motivoRetroactivo,
            paquetePacienteId: data.extra.paquetePacienteId, sesionNumero: sesionExtra,
            slotGrupoId, slotRol: 'SECUNDARIO',
          },
        });
        for (const c of [ancla, extra]) {
          await auditEnTx(tx, {
            citaId: c.id, usuarioId, accion: esRetroactiva ? 'crear_retroactiva' : 'crear', entidad: 'cita', entidadId: c.id,
            antes: esRetroactiva ? { retroactiva: true, diasAtras: diasEnPasadoLima(data.fecha), motivo: motivoRetroactivo } : undefined,
            despues: citaParaAuditoria(c), sedeId: data.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
          });
        }
        if (data.comentarioRecepcion?.trim()) {
          await crearComentarioEnTx(tx, { citaId: ancla.id, sedeId: data.sedeId, autorId: usuarioId ?? null, texto: data.comentarioRecepcion, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
        }
        if (data.extra.comentarioRecepcion?.trim()) {
          await crearComentarioEnTx(tx, { citaId: extra.id, sedeId: data.sedeId, autorId: usuarioId ?? null, texto: data.extra.comentarioRecepcion, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
        }
        return { anclaId: ancla.id, extraId: extra.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      // Idéntico a POST /citas: unicidad o deadlock exhausto (incluido el 40P01 crudo) → 409.
      if (esConflictoDeSlot(err)) {
        throw new AppError('Ese horario acaba de ocuparse para una de las citas del bloque. Refresque e intente otra vez.', 409, 'SLOT_OCUPADO');
      }
      throw err;
    }

    await invalidateDisponibilidadCache(data.sedeId, data.fecha);

    const [anclaCompleta, extraCompleta] = await Promise.all([
      getCitaCompleta(citas.anclaId), getCitaCompleta(citas.extraId),
    ]);

    for (const c of [anclaCompleta, extraCompleta]) {
      emitirEventoCita({
        tipo: 'cita:creada', sedeId: data.sedeId, fecha: data.fecha,
        cita: c as never, cambiadoPor: usuarioId ?? 'sistema',
      });
      await dispararWebhooks('appointment.created', data.sedeId, c);
    }
    void programarRecordatoriosDeCita(citas.anclaId);
    void programarRecordatoriosDeCita(citas.extraId);
    void sincronizarVideosDeCita(citas.anclaId);
    void sincronizarVideosDeCita(citas.extraId);
    void sincronizarCitaOutlook('crear', citas.anclaId);
    void sincronizarCitaOutlook('crear', citas.extraId);

    res.status(201).json({ slotGrupoId, ancla: anclaCompleta, extra: extraCompleta });
  } finally {
    for (const pid of adquiridos) {
      await releaseSlotLock(data.sedeId, pid, data.fecha, data.horaInicio, lockId);
    }
  }
});

// ─── PATCH /citas/:id/estado ──────────────────────────────────────────────────
router.patch('/:id/estado', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const { estado, comentario, motivoCancelacion, soloEsta, forzar } = estadoSchema.parse(req.body);
  // Toda la lógica (máquina de estados, cascada del bloque, anclas de tiempo, escritura con guarda
  // y efectos) vive en services/estadoCitaService.ts: la comparte con el aparato del consultorio.
  const citaCompleta = await cambiarEstadoCita(
    { citaId: req.params.id, estado, comentario, motivoCancelacion, soloEsta, forzar: forzar && req.user?.rol === 'admin' },
    {
      usuarioId: req.user?.userId,
      permisos: req.user?.permisos,
      cambiadoPor: req.user?.userId ?? 'sistema',
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      // 06-oct-2026: el ADMINISTRADOR pasa la cita a cualquier estado (el rol admin manda por su rol).
      libre: req.user?.rol === 'admin',
      ...(req.user?.rol === 'admin' ? { auditExtra: { cambioLibreAdmin: true } } : {}),
    },
  );
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/gestionar-movimiento ───────────────────────────────────
// Endpoint exclusivo para gestionar citas bloqueantes previo a un movimiento de podóloga.
// Permite cancelar o marcar como reprogramada desde cualquier estado activo,
// bypassing las transiciones normales de recepción.
router.patch('/:id/gestionar-movimiento', requireAuth, requirePermiso('movimientos.editar'), guardSedeCita, async (req, res) => {
  const { estado, motivo: motivoRaw } = z.object({
    estado: z.enum(['cancelada', 'reprogramada']),
    motivo: z.string().trim().max(300).optional(),
  }).parse(req.body);
  const motivo = motivoRaw || 'Movimiento de profesional a otra sede';
  const accion = estado === 'cancelada' ? 'cancelar_por_movimiento' : 'reprogramar_por_movimiento';

  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  const ESTADOS_ACTIVOS = ['agendada', 'confirmada', 'llego', 'en_atencion'];
  if (!ESTADOS_ACTIVOS.includes(cita.estado)) {
    throw new AppError(`No se puede gestionar una cita en estado "${cita.estado}"`, 400, 'ESTADO_INVALIDO');
  }
  // Historia clínica: una visita con atención registrada fue atendida de verdad → no se cancela ni
  // se marca reprogramada desde Movimientos (misma regla que PATCH /estado y DELETE).
  await assertSinAtencionClinica(cita.id);

  const estadoAnterior = cita.estado;
  // El bloque combinado se gestiona COMPLETO: si se cancela/reprograma la ancla, el
  // servicio extra del mismo slot corre la misma suerte (siguen siendo UNA visita).
  const hermanas = cita.slotGrupoId
    ? (await prisma.cita.findMany({
        where: { slotGrupoId: cita.slotGrupoId, id: { not: cita.id }, deletedAt: null },
      })).filter((c) => ESTADOS_ACTIVOS.includes(c.estado))
    : [];

  await prisma.$transaction(async (tx) => {
    // Escritura con guarda (igual que el service de estado): si recepción la cambió mientras tanto,
    // no se pisa → 409 para que Movimientos refresque.
    const r = await tx.cita.updateMany({
      where: { id: cita.id, estado: cita.estado, deletedAt: null },
      data: { estado, motivoCancelacion: motivo },
    });
    if (r.count === 0) throw new AppError('La cita cambió de estado mientras tanto. Actualiza y vuelve a intentar.', 409, 'ESTADO_CAMBIADO');
    await auditEnTx(tx, {
      citaId: cita.id,
      usuarioId: req.user?.userId,
      accion,
      entidad: 'cita',
      entidadId: cita.id,
      antes: { estado: estadoAnterior },
      despues: { estado, motivoCancelacion: motivo, origen: 'movimiento_profesional' },
      sedeId: cita.sedeId,
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    for (const h of hermanas) {
      const rh = await tx.cita.updateMany({ where: { id: h.id, estado: h.estado, deletedAt: null }, data: { estado, motivoCancelacion: motivo } });
      if (rh.count === 0) continue;
      await auditEnTx(tx, {
        citaId: h.id, usuarioId: req.user?.userId, accion,
        entidad: 'cita', entidadId: h.id,
        antes: { estado: h.estado }, despues: { estado, motivoCancelacion: motivo, origen: 'movimiento_profesional', slotGrupoId: cita.slotGrupoId, cascada: true },
        sedeId: h.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
      });
    }
  });

  const fechaStr = fechaAStr(cita.fecha);
  // Mismos efectos que una cancelación normal: reembolso de sesión, recordatorios y
  // videos cancelados, evento de Outlook eliminado, slot liberado en la caché y
  // webhook a integraciones. Sin esto, el paciente seguía recibiendo el recordatorio
  // de una cita que ya se había cancelado desde Movimientos.
  for (const c of [cita, ...hermanas]) {
    await sincronizarSesionPaquete(c.id);
    void cancelarRecordatoriosDeCita(c.id);
    void cancelarVideosDeCita(c.id);
    void sincronizarCitaOutlook('cancelar', c.id);
    if (estado === 'cancelada') {
      await dispararWebhooks('appointment.cancelled', c.sedeId, await getCitaCompleta(c.id));
    }
    emitirEventoCita({
      tipo: 'cita:estadoCambiado',
      sedeId: c.sedeId,
      fecha: fechaStr,
      cita: { id: c.id, estado } as never,
      cambiadoPor: req.user?.userId ?? 'sistema',
    });
  }
  await invalidateDisponibilidadCache(cita.sedeId, fechaStr);

  setImmediate(() => {
    const d = new Date(`${fechaStr}T00:00:00Z`); const h = new Date(`${fechaStr}T23:59:59Z`);
    agregarRango(d, h).catch(() => {/* silencioso */});
  });

  res.json({ ok: true, id: cita.id, estadoAnterior, estadoNuevo: estado });
});

// ─── POST /citas/reportar-enfermedad ──────────────────────────────────────────
// Acción COMPUESTA (B-2): reporta que un profesional se enfermó/ausenta un día y
// libera su agenda en UN paso. En una sola transacción: (1) cancela en lote sus
// citas ACTIVAS del rango y (2) crea el bloqueo (permiso) del rango. Devuelve la
// lista de pacientes afectados (con teléfono) para que recepción los contacte y
// reagende. Reemplaza el flujo manual de dos pasos (cancelar cita por cita → luego
// bloquear, que además fallaba con 409 CITAS_EN_RANGO mientras quedara una).
router.post('/reportar-enfermedad', requireAuth, requirePermiso('movimientos.editar'), async (req, res) => {
  const data = z.object({
    profesionalId: z.string().uuid(),
    sedeId: z.string().uuid(),
    fecha: zFechaCita,
    // Rango a liberar. Por defecto, el día completo de atención (08:00–20:00).
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
    horaFin: z.string().regex(/^\d{2}:\d{2}$/).default('20:00'),
    motivo: z.string().min(3).max(200).default('Enfermedad'),
    // Varios días (02-oct-2026): el mismo horario cada día desde `fecha` hasta `fechaFin` (inclusive).
    fechaFin: zFechaCita.optional(),
  }).parse(req.body);
  if (data.horaFin <= data.horaInicio) throw new AppError('La hora de fin debe ser mayor que la de inicio', 400);
  const fechaHasta = data.fechaFin ?? data.fecha;
  if (fechaHasta < data.fecha) throw new AppError('La fecha final no puede ser anterior a la inicial', 400);
  const diasRango: string[] = [];
  for (let d = new Date(`${data.fecha}T00:00:00Z`); d <= new Date(`${fechaHasta}T00:00:00Z`) && diasRango.length < 32; d.setUTCDate(d.getUTCDate() + 1)) {
    diasRango.push(d.toISOString().slice(0, 10));
  }
  // Cancela citas: tope de un mes por reporte (para más días, otro reporte).
  if (diasRango.length > 31) throw new AppError('Reporta la enfermedad por un máximo de 31 días a la vez', 400, 'RANGO_DEMASIADO_LARGO');
  assertSede(req, data.sedeId); // era la única escritura de citas sin control de sede (cancela la agenda de un día entero)

  const usuarioId = req.user?.userId;
  const prof = await prisma.profesional.findUnique({
    where: { id: data.profesionalId },
    select: { tipo: true, activo: true, deletedAt: true, nombres: true, apellidos: true },
  });
  if (!prof || !prof.activo || prof.deletedAt) throw new AppError('Profesional no encontrado', 404);
  if (prof.tipo !== 'podologa' && prof.tipo !== 'fisioterapeuta' && prof.tipo !== 'medico') {
    throw new AppError('Solo se puede reportar enfermedad de podólogas, fisioterapeutas o baropodometría', 400, 'TIPO_NO_BLOQUEABLE');
  }

  // Citas ACTIVAS del profesional en el rango (mismo criterio que el bloqueo de permisos:
  // no cuentan canceladas/no-show/reprogramadas ni ya completadas). Se incluye
  // `solicitadoProfesionalId` para el caso baro "Solo X" (la cita ocupa una máquina pero
  // pide a un médico). Un bloque combinado comparte profesional+slot → sus hermanas ya
  // caen en esta consulta.
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h! * 60 + m!; };
  const desdeMin = toMin(data.horaInicio);
  const hastaMin = toMin(data.horaFin);
  const citasDelDia = await prisma.cita.findMany({
    where: {
      OR: [{ profesionalId: data.profesionalId }, { solicitadoProfesionalId: data.profesionalId }],
      sedeId: data.sedeId,
      fecha: { gte: fechaDb(data.fecha), lte: fechaDb(fechaHasta) },
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada', 'completada'] },
    },
    select: {
      id: true, estado: true, fecha: true, horaInicio: true, duracionMinutos: true, sedeId: true, motivoCancelacion: true, slotGrupoId: true,
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true } },
      servicio: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
  });
  const enRangoTodas = citasDelDia.filter((c) => {
    const ini = toMin(c.horaInicio);
    return ini < hastaMin && ini + c.duracionMinutos > desdeMin; // solape [ini, ini+dur) con [desde, hasta)
  });
  // Historia clínica: una visita con atención registrada YA fue atendida → no se cancela por
  // enfermedad (se deja como está y se informa aparte). Aplica a todo su bloque combinado.
  const conAtencion = enRangoTodas.length
    ? await prisma.atencionClinica.findMany({ where: { citaId: { in: enRangoTodas.map((c) => c.id) } }, select: { citaId: true } })
    : [];
  const idsAtendidas = new Set(conAtencion.map((a) => a.citaId));
  const bloquesAtendidos = new Set(enRangoTodas.filter((c) => idsAtendidas.has(c.id) && c.slotGrupoId).map((c) => c.slotGrupoId as string));
  const yaAtendidas = enRangoTodas.filter((c) => idsAtendidas.has(c.id) || (c.slotGrupoId && bloquesAtendidos.has(c.slotGrupoId)));
  const enRango = enRangoTodas.filter((c) => !yaAtendidas.includes(c));

  // Transacción atómica: o quedan canceladas TODAS las citas + creado el bloqueo, o nada.
  // Serializable + retry ante deadlock, coherente con el resto de escrituras de citas.
  const bloqueo = await withDeadlockRetry(() => prisma.$transaction(async (tx) => {
    for (const c of enRango) {
      // Con guarda de estado: si recepción la completó (o la cambió) mientras se confirmaba el diálogo,
      // NO se pisa una atención ya hecha ni se devuelve una sesión usada: se aborta todo y se reintenta.
      const rc = await tx.cita.updateMany({ where: { id: c.id, estado: c.estado, deletedAt: null }, data: { estado: 'cancelada', motivoCancelacion: data.motivo } });
      if (rc.count === 0) throw new AppError('Una de las citas cambió de estado mientras tanto. Actualiza y vuelve a reportar.', 409, 'ESTADO_CAMBIADO');
      await auditEnTx(tx, {
        citaId: c.id, usuarioId, accion: 'cancelar_por_enfermedad', entidad: 'cita', entidadId: c.id,
        antes: { estado: c.estado }, despues: { estado: 'cancelada', motivoCancelacion: data.motivo, origen: 'enfermedad_profesional', profesionalId: data.profesionalId },
        sedeId: c.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
      });
    }

    // Por CADA día del rango: chanca permisos/bloqueos previos que se crucen y crea el bloqueo de enfermedad.
    let primero: { id: string } | null = null;
    for (const dia of diasRango) {
      // Límites del día anclados a UTC (no dependen de la TZ del proceso).
      const dayStart = new Date(`${dia}T00:00:00.000Z`);
      const dayEnd = new Date(`${dia}T23:59:59.999Z`);
      const bloqueosPrevios = await tx.bloqueoAgenda.findMany({
        where: {
          profesionalId: data.profesionalId,
          esRecurrente: false,
          deletedAt: null,
          esEnfermedad: false,
          esVacaciones: false, // una vacación no se borra por una enfermedad: partía el rango de vacaciones en dos
          fechaInicio: { lt: dayEnd },
          fechaFin: { gt: dayStart },
        },
      });
      for (const b of bloqueosPrevios) {
        if (b.horaInicio && b.horaFin) {
          const bIni = toMin(b.horaInicio);
          const bFin = toMin(b.horaFin);
          if (bIni < hastaMin && bFin > desdeMin) {
            await tx.bloqueoAgenda.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
          }
        } else {
          await tx.bloqueoAgenda.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
        }
      }

      const b = await tx.bloqueoAgenda.create({
        data: {
          profesionalId: data.profesionalId, sedeId: data.sedeId, tipo: 'PERMISO', esRecurrente: false,
          esEnfermedad: true,
          fechaInicio: new Date(`${dia}T${data.horaInicio}:00`), fechaFin: new Date(`${dia}T${data.horaFin}:00`),
          horaInicio: data.horaInicio, horaFin: data.horaFin,
          motivo: data.motivo.startsWith('🤒') ? data.motivo : `🤒 ${data.motivo}`, creadoPor: usuarioId,
        },
      });
      primero ??= b;
      const delDia = (cs: typeof enRangoTodas) => cs.filter((c) => fechaAStr(c.fecha) === dia).length;
      await auditEnTx(tx, {
        usuarioId, accion: 'crear_bloqueo_enfermedad', entidad: 'bloqueo_agenda', entidadId: b.id,
        despues: {
          profesionalId: data.profesionalId, fecha: dia, horaInicio: data.horaInicio, horaFin: data.horaFin, motivo: data.motivo,
          citasCanceladas: delDia(enRango), citasConAtencionNoCanceladas: delDia(yaAtendidas),
          ...(diasRango.length > 1 ? { rango: `${data.fecha} → ${fechaHasta}` } : {}),
        },
        sedeId: data.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
      });
    }
    return primero!;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).catch((err) => {
    // A diferencia de reservar un slot, aquí no hay unicidad en juego: un deadlock que agotó
    // los reintentos (P2034 o el 40P01/40001 CRUDO que Prisma no clasifica) es un choque
    // transitorio de locks al cancelar el día. Se mapea a un 409 "reintente" en vez de dejar
    // escapar un 500 opaco al errorHandler. Cualquier otro error se propaga intacto.
    if (esDeadlockTransitorio(err)) {
      throw new AppError('El sistema está ocupado procesando esa agenda. Reintente en unos segundos.', 409, 'CONFLICTO_TRANSITORIO');
    }
    throw err;
  });

  // Side-effects best-effort de cada cita cancelada (idénticos a gestionar-movimiento):
  // reembolso de sesión, recordatorios y videos cancelados, evento Outlook eliminado,
  // webhook a integraciones y evento en tiempo real.
  for (const c of enRango) {
    await sincronizarSesionPaquete(c.id);
    void cancelarRecordatoriosDeCita(c.id);
    void cancelarVideosDeCita(c.id);
    void sincronizarCitaOutlook('cancelar', c.id);
    await dispararWebhooks('appointment.cancelled', c.sedeId, await getCitaCompleta(c.id));
    emitirEventoCita({
      tipo: 'cita:estadoCambiado', sedeId: c.sedeId, fecha: fechaAStr(c.fecha),
      cita: { id: c.id, estado: 'cancelada' } as never, cambiadoPor: usuarioId ?? 'sistema',
    });
  }
  for (const dia of diasRango) await invalidateDisponibilidadCache(data.sedeId, dia);

  setImmediate(() => {
    const d = new Date(`${data.fecha}T00:00:00Z`); const h = new Date(`${fechaHasta}T23:59:59Z`);
    agregarRango(d, h).catch(() => {/* silencioso */});
  });

  // Lista de pacientes afectados para que recepción los contacte y reagende.
  const fila = (c: typeof enRangoTodas[number]) => ({
    ...(diasRango.length > 1 ? { fecha: fechaAStr(c.fecha) } : {}),
    horaInicio: c.horaInicio,
    estado: c.estado as string,
    servicio: c.servicio.nombre,
    paciente: `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.trim(),
    telefono: c.paciente.telefono,
  });

  res.status(201).json({
    ok: true,
    bloqueoId: bloqueo.id,
    profesional: `${prof.nombres.split(' ')[0]} ${prof.apellidos.split(' ')[0]}`.trim(),
    citasCanceladas: enRango.length,
    dias: diasRango.length,
    pacientes: enRango.map(fila),
    // Citas del rango que YA tienen atención clínica: no se cancelaron (fueron atendidas).
    citasConAtencion: yaAtendidas.map(fila),
  });
});

// ─── PATCH /citas/:id/mover ───────────────────────────────────────────────────
router.patch('/:id/mover', requireAuth, requireAcceso('appointments:write', 'citas.reprogramar'), guardSedeCita, async (req, res) => {
  const data = moverCitaSchema.parse(req.body);
  const usuarioId = req.user?.userId;

  const cita = await prisma.cita.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: { profesional: true, unidadNegocio: true },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  if (ESTADOS_FINALES.includes(cita.estado)) {
    throw new AppError('No se puede mover una cita finalizada', 400, 'ESTADO_FINAL');
  }
  assertFechaMovible(data.fecha, cita.fecha);
  // Bloque combinado: las dos citas comparten hueco y profesional. Mover UNA sola (lo hacían el
  // buscador y el popover) las dejaba a horas distintas. Mientras la hermana siga viva se mueve el
  // bloque entero por /citas/grupo/:id/mover; si la hermana ya terminó o se canceló, esta va sola.
  if (cita.slotGrupoId) {
    const hermanaViva = await prisma.cita.findFirst({
      where: {
        slotGrupoId: cita.slotGrupoId, id: { not: cita.id }, deletedAt: null,
        OR: [{ estado: { notIn: [...ESTADOS_FINALES, 'reprogramada'] as never } }, { estado: 'reprogramada', reboteDesde: { not: null }, reboteCerradoEn: null }],
      },
      select: { id: true },
    });
    if (hermanaViva) {
      throw new AppError('Esta cita es parte de un bloque de dos servicios: se mueve el bloque completo, no una sola.', 409, 'CITA_EN_BLOQUE');
    }
  }
  // Historia clínica: mover una cita que YA tiene atención registrada es una acción reservada
  // (no visible) de coordinación/admin; la fecha de la atención acompaña a la cita (ver tx).
  const atencionDeCita = await prisma.atencionClinica.findUnique({ where: { citaId: cita.id }, select: { id: true, estado: true } });
  const tieneAtencion = !!atencionDeCita;
  // 26-sep-2026: con la atención abierta al entrar (sin modal), casi toda cita «en atención» ya tiene atención clínica.
  // Moverla DENTRO DEL MISMO DÍA (otra podóloga u otra hora) lo puede hacer quien reprograma; a OTRO día sigue siendo
  // reservado de coordinación/administración.
  const mismoDia = fechaAStr(cita.fecha) === data.fecha;
  if (tieneAtencion && !mismoDia && !['admin', 'coordinadora_sedes'].includes(req.user?.rol ?? '')) {
    throw new AppError('La cita ya tiene atención clínica registrada: moverla a otro día solo lo hacen coordinación o administración', 403, 'CITA_CON_ATENCION_CLINICA');
  }

  // Servicios de 1 hora solo en hora entera
  if (!horaInicioValidaParaDuracion(data.horaInicio, cita.duracionMinutos)) {
    throw new AppError('Los servicios de 1 hora solo pueden iniciarse en hora entera (08:00, 09:00, …)', 400, 'SLOT_HORA_INVALIDA');
  }

  let nuevoProfesionalId = data.profesionalId !== undefined ? data.profesionalId : cita.profesionalId;

  // Unidad SIN elección (baropodometría): la cita va en una MÁQUINA. Al mover, se ignora el profesional que mande el
  // cliente (el detalle de la cita enviaba la máquina actual y esto respondía 400 «Unidad sin elección», así que un
  // baro no se podía cambiar de día) y se elige una máquina libre en el destino; si ninguna está libre, se intenta
  // con la actual y la validación de solape de abajo decide.
  if (cita.unidadNegocio.modoReserva === 'sin_eleccion') {
    if (data.elegirEquipo && data.profesionalId) {
      // Máquina elegida a mano (sede con 2 baros): tiene que ser una MÁQUINA de esta unidad; la sede, el turno y el
      // solape se validan abajo igual que siempre (si está ocupada a esa hora, 409).
      const equipo = await prisma.profesional.findUnique({ where: { id: data.profesionalId }, select: { esEquipo: true, unidadNegocioId: true } });
      if (!equipo?.esEquipo || equipo.unidadNegocioId !== cita.unidadNegocioId) {
        throw new AppError('Elige una de las máquinas de baropodometría de la sede', 400, 'EQUIPO_INVALIDO');
      }
      nuevoProfesionalId = data.profesionalId;
    } else {
      const libre = await seleccionarProfesionalOptimo(cita.sedeId, cita.unidadNegocioId, cita.servicioId, data.fecha, data.horaInicio);
      nuevoProfesionalId = libre ?? cita.profesionalId;
    }
  }

  // Re-validar competencia del profesional destino
  if (nuevoProfesionalId) {
    const competencia = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: nuevoProfesionalId, servicioId: cita.servicioId, activa: true },
    });
    if (!competencia) {
      throw new AppError('El profesional destino no tiene habilitado el servicio de esta cita', 400, 'SIN_COMPETENCIA');
    }
    // 10-oct-2026: una máquina (Baro 1/2) solo recibe citas de su propia unidad.
    if (cita.unidadNegocio.modoReserva !== 'sin_eleccion' && nuevoProfesionalId !== cita.profesionalId) {
      const destinoEq = await prisma.profesional.findUnique({ where: { id: nuevoProfesionalId }, select: { esEquipo: true, unidadNegocioId: true } });
      if (destinoEq?.esEquipo && destinoEq.unidadNegocioId !== cita.unidadNegocioId) {
        throw new AppError('Esta cita no puede ir a una máquina de baropodometría: elige a una persona', 400, 'EQUIPO_INVALIDO');
      }
    }
  }

  // Re-validar AsignacionSede: el profesional destino debe estar asignado a esta sede en la fecha destino
  if (nuevoProfesionalId) {
    const fechaDestino = fechaDb(data.fecha);
    // Misma regla que el CREATE: si la competencia usada es "solo por solicitud"
    // (médicos de baro, Daniel en baro), el profesional atiende en cualquier sede
    // sin asignación fija — no se le exige asignación al mover.
    const competenciaMover = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: nuevoProfesionalId, servicioId: cita.servicioId, activa: true },
    });
    if (!competenciaMover?.soloPorSolicitud || cita.unidadNegocio.modoReserva !== 'sin_eleccion') {
      const asignacion = await prisma.asignacionSede.findFirst({
        where: {
          profesionalId: nuevoProfesionalId,
          sedeId: cita.sedeId, // por RANGO, sin `activa` (ver crear cita)
          fechaInicio: { lte: fechaDestino },
          OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDestino } }],
        },
      });
      if (!asignacion) {
        throw new AppError('El profesional destino no está asignado a esta sede en la fecha indicada', 400, 'SIN_ASIGNACION_SEDE');
      }
    }

    // TURNO del profesional destino — misma validación que el CREATE. Sin esto se podía
    // reprogramar una cita a una hora en que la profesional ya salió o a un día que no
    // atiende, y la cita quedaba fuera de horario sin que nadie lo notara.
    await assertProfesionalActivo(nuevoProfesionalId);
    const turnosDestino = await turnosDelDia(cita.sedeId, data.fecha, [nuevoProfesionalId]);
    const turnoDestino = turnosDestino.get(nuevoProfesionalId);
    if (!turnoDestino) throw new AppError('El profesional no atiende este día', 400, 'SIN_HORARIO');
    if (data.horaInicio < turnoDestino.horaInicio || data.horaInicio >= turnoDestino.horaFin) {
      throw new AppError(
        `El slot ${data.horaInicio} está fuera del horario del profesional (${turnoDestino.horaInicio}–${turnoDestino.horaFin})`,
        400,
        'SLOT_FUERA_HORARIO',
      );
    }
    assertTerminaEnTurno(data.horaInicio, cita.duracionMinutos, turnoDestino.horaFin);
  }

  // «Solo X» fuera de baro (26-sep-2026): si la cita se mueve a la columna de OTRA PERSONA, la atiende esa persona y la
  // pedida deja de estar en ella. Antes la marca seguía y ocupaba el tiempo de X sin verse en su columna (Sarai quedó
  // «ocupada» a las 12:00 por una cita que ya estaba en «Adicional One»). Si va a una MÁQUINA, la marca se conserva.
  let solicitadoFinal = cita.solicitadoProfesionalId;
  if (cita.solicitadoProfesionalId && cita.unidadNegocio.modoReserva !== 'sin_eleccion' && nuevoProfesionalId && nuevoProfesionalId !== cita.profesionalId) {
    const destino = await prisma.profesional.findUnique({ where: { id: nuevoProfesionalId }, select: { esEquipo: true } });
    if (!destino?.esEquipo) solicitadoFinal = null;
  }

  const lockId = uuidv4();
  const lockAcquired = await acquireSlotLock(
    cita.sedeId, nuevoProfesionalId!, data.fecha, data.horaInicio, lockId
  );
  if (!lockAcquired) {
    throw new AppError('Slot en proceso de reserva, intente nuevamente', 409, 'SLOT_LOCKED');
  }

  try {
    // No permitir mover la cita encima de un bloqueo (permiso/almuerzo) del profesional destino.
    await validarSinBloqueo(nuevoProfesionalId!, data.fecha, data.horaInicio, cita.duracionMinutos, cita.sedeId);

    // Anti doble-booking cruzado entre unidades (excluyendo la propia cita que se mueve).
    await validarProfesionalLibre(nuevoProfesionalId!, data.fecha, data.horaInicio, cita.duracionMinutos, cita.id);
    await validarCupoServicio(prisma, { servicioId: cita.servicioId, sedeId: cita.sedeId, fecha: data.fecha, horaInicio: data.horaInicio, duracionMin: cita.duracionMinutos, excluirCitaIds: [cita.id] });
    if (solicitadoFinal) {
      await validarProfesionalLibre(solicitadoFinal, data.fecha, data.horaInicio, cita.duracionMinutos, cita.id);
      // El médico solicitado ("Solo Daniel") tampoco puede quedar sobre un bloqueo suyo
      // (reunión/permiso) — el CREATE ya lo validaba; el MOVER lo omitía.
      await validarSinBloqueo(solicitadoFinal, data.fecha, data.horaInicio, cita.duracionMinutos, cita.sedeId);
    }

    const antes = {
      profesionalId: cita.profesionalId,
      fecha: cita.fecha,
      horaInicio: cita.horaInicio,
    };

    const updatedCita = await withDeadlockRetry(() => prisma.$transaction(async (tx) => {
      // ANTI-DOBLE-BOOKING ATÓMICO (igual que el CREATE): re-chequear el solape DENTRO de la tx
      // Serializable. El índice único solo cubre horaInicio EXACTO; dos reprogramaciones concurrentes
      // a horas que se pisan (distinto inicio) se colaban. Con el SELECT aquí, SSI aborta una (40001
      // → retry → ve la otra → 409). Cubre profesional y médico de baro.
      await validarProfesionalLibre(nuevoProfesionalId!, data.fecha, data.horaInicio, cita.duracionMinutos, cita.id, [], tx);
      if (solicitadoFinal && solicitadoFinal !== nuevoProfesionalId) {
        await validarProfesionalLibre(solicitadoFinal, data.fecha, data.horaInicio, cita.duracionMinutos, cita.id, [], tx);
      }
      await validarCupoServicio(tx, { servicioId: cita.servicioId, sedeId: cita.sedeId, fecha: data.fecha, horaInicio: data.horaInicio, duracionMin: cita.duracionMinutos, excluirCitaIds: [cita.id] });
      const u = await tx.cita.update({
        where: { id: req.params.id },
        data: {
          profesionalId: nuevoProfesionalId,
          fecha: fechaDb(data.fecha),
          horaInicio: data.horaInicio,
          estado: estadoAlMover(cita, data.fecha) as never,
          ...limpiezaAlMover(cita, data.fecha),
          ...(data.origenAsignacion ? { origenAsignacion: data.origenAsignacion } : {}),
          ...(solicitadoFinal !== cita.solicitadoProfesionalId ? { solicitadoProfesionalId: solicitadoFinal } : {}),
          // Otro DÍA sin atención registrada → se suelta el médico: lo toma el médico de ese día.
          ...(sueltaMedico(cita, data.fecha, tieneAtencion) ? SIN_MEDICO : {}),
          // Rebote: reagendarla la saca de la bandeja.
          ...(reboteAbierto(cita) ? { reboteCerradoEn: new Date(), reboteResultado: 'reagendada' } : {}),
        },
      });
      if (tieneAtencion) await sincronizarFechaAtencion(tx, cita.id, fechaDb(data.fecha));
      // Otra podóloga (persona): la atención (abierta o cerrada) queda a nombre de la última a la que se asignó la cita.
      const atencionDe = atencionDeCita && nuevoProfesionalId ? await atencionSigueAProfesional(tx, cita.id, nuevoProfesionalId) : null;
      await auditEnTx(tx, {
        citaId: cita.id,
        usuarioId,
        accion: 'mover',
        entidad: 'cita',
        entidadId: cita.id,
        antes,
        despues: { profesionalId: nuevoProfesionalId, fecha: data.fecha, horaInicio: data.horaInicio, ...(solicitadoFinal !== cita.solicitadoProfesionalId ? { solicitadoSoltado: cita.solicitadoProfesionalId } : {}), ...(sueltaMedico(cita, data.fecha, tieneAtencion) ? { medicoSoltado: cita.medicoId } : {}), ...(atencionDe ? { atencionPasaDe: atencionDe } : {}), ...(reboteAbierto(cita) ? { rebote: 'reagendada' } : {}) },
        sedeId: cita.sedeId,
        ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
      });
      return u;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    await invalidateDisponibilidadCache(cita.sedeId, cita.fecha.toISOString().split('T')[0]!);
    await invalidateDisponibilidadCache(cita.sedeId, data.fecha);

    const citaCompleta = await getCitaCompleta(updatedCita.id);
    emitirEventoCita({
      tipo: 'cita:movida',
      sedeId: cita.sedeId,
      fecha: data.fecha,
      cita: citaCompleta as never,
      cambiadoPor: usuarioId ?? 'sistema',
    });
    // Otro día: quien mira el día de ORIGEN también debe ver desaparecer la cita al instante.
    if (fechaAStr(cita.fecha) !== data.fecha) {
      emitirEventoCita({ tipo: 'cita:movida', sedeId: cita.sedeId, fecha: fechaAStr(cita.fecha), cita: citaCompleta as never, cambiadoPor: usuarioId ?? 'sistema' });
    }

    await dispararWebhooks('appointment.rescheduled', cita.sedeId, citaCompleta);
    // Si había «Llegó» con sesión de paquete descontada y la cita se fue a otro día, la sesión vuelve.
    if (updatedCita.estado !== cita.estado) await sincronizarSesionPaquete(cita.id);

    // Outlook (no bloqueante): reprogramación → actualizar el evento existente (no duplica).
    void sincronizarCitaOutlook('actualizar', cita.id);

    // Recordatorio: reagendar el envío a la nueva fecha/hora (si aún no se envió).
    void reprogramarRecordatorioDeCita(cita.id);
    // VIDEOS: recalcula los envíos no enviados a la nueva fecha/hora (R2).
    void sincronizarVideosDeCita(cita.id);

    res.json(citaCompleta);
  } finally {
    await releaseSlotLock(cita.sedeId, nuevoProfesionalId!, data.fecha, data.horaInicio, lockId);
  }
});

// ─── PATCH /citas/grupo/:slotGrupoId/mover ────────────────────────────────────
// Mueve un BLOQUE COMBINADO completo (ambas citas comparten slot) a otro horario/profesional,
// de forma atómica. No se puede mover cada mitad por separado: la 2da chocaría con la 1ra ya
// movida al mismo slot. El chequeo de solape EXCLUYE las citas del propio grupo.
router.patch('/grupo/:slotGrupoId/mover', requireAuth, requireAcceso('appointments:write', 'citas.reprogramar'), guardSedeCita, async (req, res) => {
  const data = moverCitaSchema.parse(req.body);
  const usuarioId = req.user?.userId;
  const slotGrupoId = req.params.slotGrupoId;

  const todas = await prisma.cita.findMany({
    where: { slotGrupoId, deletedAt: null },
    include: { unidadNegocio: true, servicio: true },
    orderBy: { slotRol: 'asc' }, // PRINCIPAL antes que SECUNDARIO
  });
  if (todas.length === 0) throw new AppError('Bloque combinado no encontrado', 404);
  // 14-oct-2026: si una mitad ya terminó (1º completado, 2º cancelado…), se mueve solo lo que sigue pendiente;
  // lo terminado se queda donde se hizo. Antes respondía «bloque con citas finalizadas» y no dejaba mover el 2º.
  const citas = todas.filter(c => !ESTADOS_FINALES.includes(c.estado));
  if (citas.length === 0) {
    throw new AppError('No se puede mover un bloque ya finalizado', 400, 'ESTADO_FINAL');
  }
  assertFechaMovible(data.fecha, citas[0]!.fecha);
  // Historia clínica: bloque con atención registrada → mover solo coordinación/admin (acción no visible).
  const bloqueConAtencion = !!(await prisma.atencionClinica.findFirst({ where: { citaId: { in: todas.map(c => c.id) } }, select: { id: true } }));
  if (bloqueConAtencion && !['admin', 'coordinadora_sedes'].includes(req.user?.rol ?? '')) {
    throw new AppError('El bloque ya tiene atención clínica registrada: solo coordinación o administración pueden moverlo', 403, 'CITA_CON_ATENCION_CLINICA');
  }

  const ancla = citas.find(c => c.slotRol === 'PRINCIPAL') ?? citas[0]!;
  const sedeId = ancla.sedeId;
  const nuevoProfesionalId = data.profesionalId !== undefined ? data.profesionalId : ancla.profesionalId;
  const grupoIds = todas.map(c => c.id);

  // La duración del bloque = la del ancla (1 h). Hora entera para servicios de 1 h.
  if (!horaInicioValidaParaDuracion(data.horaInicio, ancla.duracionMinutos)) {
    throw new AppError('Los servicios de 1 hora solo pueden iniciarse en hora entera (08:00, 09:00, …)', 400, 'SLOT_HORA_INVALIDA');
  }

  // El profesional destino debe atender AMBOS servicios del bloque y estar asignado a la sede.
  if (nuevoProfesionalId) {
    for (const c of citas) {
      const comp = await prisma.competenciaProfesional.findFirst({ where: { profesionalId: nuevoProfesionalId, servicioId: c.servicioId, activa: true } });
      if (!comp) throw new AppError(`El profesional destino no tiene habilitado "${c.servicio.nombre}"`, 400, 'SIN_COMPETENCIA');
    }
    const fechaDestino = fechaDb(data.fecha);
    const asignacion = await prisma.asignacionSede.findFirst({
      where: { profesionalId: nuevoProfesionalId, sedeId, fechaInicio: { lte: fechaDestino }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDestino } }] }, // por RANGO, sin `activa`
    });
    if (!asignacion) throw new AppError('El profesional destino no está asignado a esta sede en la fecha indicada', 400, 'SIN_ASIGNACION_SEDE');

    // TURNO del profesional destino — misma validación que el CREATE y que el mover
    // individual: el bloque completo debe caber dentro de su jornada de ese día.
    await assertProfesionalActivo(nuevoProfesionalId);
    const turnosDestino = await turnosDelDia(sedeId, data.fecha, [nuevoProfesionalId]);
    const turnoDestino = turnosDestino.get(nuevoProfesionalId);
    if (!turnoDestino) throw new AppError('El profesional no atiende este día', 400, 'SIN_HORARIO');
    if (data.horaInicio < turnoDestino.horaInicio || data.horaInicio >= turnoDestino.horaFin) {
      throw new AppError(
        `El slot ${data.horaInicio} está fuera del horario del profesional (${turnoDestino.horaInicio}–${turnoDestino.horaFin})`,
        400,
        'SLOT_FUERA_HORARIO',
      );
    }
    assertTerminaEnTurno(data.horaInicio, Math.max(...citas.map((c) => c.duracionMinutos)), turnoDestino.horaFin);
  }

  const lockId = uuidv4();
  const lockAcquired = await acquireSlotLock(sedeId, nuevoProfesionalId!, data.fecha, data.horaInicio, lockId);
  if (!lockAcquired) throw new AppError('Slot en proceso de reserva, intente nuevamente', 409, 'SLOT_LOCKED');

  try {
    await validarSinBloqueo(nuevoProfesionalId!, data.fecha, data.horaInicio, ancla.duracionMinutos, sedeId);
    // Libre EXCLUYENDO las citas del propio grupo (comparten el slot a propósito).
    await validarProfesionalLibre(nuevoProfesionalId!, data.fecha, data.horaInicio, ancla.duracionMinutos, undefined, grupoIds);

    await withDeadlockRetry(() => prisma.$transaction(async (tx) => {
      // Anti-doble-booking atómico dentro de la tx Serializable (excluye el propio grupo, que
      // comparte el slot a propósito). Frena reprogramaciones concurrentes solapadas.
      await validarProfesionalLibre(nuevoProfesionalId!, data.fecha, data.horaInicio, ancla.duracionMinutos, undefined, grupoIds, tx);
      for (const c of citas) {
        await validarCupoServicio(tx, { servicioId: c.servicioId, sedeId, fecha: data.fecha, horaInicio: data.horaInicio, duracionMin: ancla.duracionMinutos, excluirCitaIds: grupoIds });
      }
      for (const c of citas) {
        await tx.cita.update({
          where: { id: c.id },
          data: {
            profesionalId: nuevoProfesionalId,
            fecha: fechaDb(data.fecha),
            horaInicio: data.horaInicio,
            estado: estadoAlMover(c, data.fecha) as never,
            ...limpiezaAlMover(c, data.fecha),
            ...(data.origenAsignacion ? { origenAsignacion: data.origenAsignacion } : {}),
            ...(sueltaMedico(c, data.fecha, bloqueConAtencion) ? SIN_MEDICO : {}),
            ...(reboteAbierto(c) ? { reboteCerradoEn: new Date(), reboteResultado: 'reagendada' } : {}),
          },
        });
        if (bloqueConAtencion) await sincronizarFechaAtencion(tx, c.id, fechaDb(data.fecha));
        const atencionDe = bloqueConAtencion && nuevoProfesionalId ? await atencionSigueAProfesional(tx, c.id, nuevoProfesionalId) : null;
        await auditEnTx(tx, {
          citaId: c.id, usuarioId, accion: 'mover', entidad: 'cita', entidadId: c.id,
          antes: { profesionalId: c.profesionalId, fecha: c.fecha, horaInicio: c.horaInicio },
          despues: { profesionalId: nuevoProfesionalId, fecha: data.fecha, horaInicio: data.horaInicio, bloque: slotGrupoId, ...(sueltaMedico(c, data.fecha, bloqueConAtencion) ? { medicoSoltado: c.medicoId } : {}), ...(atencionDe ? { atencionPasaDe: atencionDe } : {}), ...(reboteAbierto(c) ? { rebote: 'reagendada' } : {}) },
          sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    await invalidateDisponibilidadCache(sedeId, ancla.fecha.toISOString().split('T')[0]!);
    await invalidateDisponibilidadCache(sedeId, data.fecha);

    const fechaOrigen = fechaAStr(ancla.fecha);
    for (const c of citas) {
      const completa = await getCitaCompleta(c.id);
      emitirEventoCita({ tipo: 'cita:movida', sedeId, fecha: data.fecha, cita: completa as never, cambiadoPor: usuarioId ?? 'sistema' });
      if (fechaOrigen !== data.fecha) emitirEventoCita({ tipo: 'cita:movida', sedeId, fecha: fechaOrigen, cita: completa as never, cambiadoPor: usuarioId ?? 'sistema' });
      void sincronizarCitaOutlook('actualizar', c.id);
      void reprogramarRecordatorioDeCita(c.id);
      void sincronizarVideosDeCita(c.id);
    }

    res.json(await getCitaCompleta(ancla.id));
  } finally {
    await releaseSlotLock(sedeId, nuevoProfesionalId!, data.fecha, data.horaInicio, lockId);
  }
});

// ─── DELETE /citas/:id (cancelar — NO pone deletedAt para conservar historial) ─
router.delete('/:id', requireAuth, requireAcceso('appointments:write', 'citas.cancelar'), guardSedeCita, async (req, res) => {
  // Motivo opcional (cuerpo `{ motivo }` o `?motivo=`): queda en la cita y en la auditoría.
  const motivo = z.string().trim().max(500).optional().parse((req.body as { motivo?: unknown } | undefined)?.motivo ?? req.query.motivo) || undefined;
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  if (ESTADOS_FINALES.includes(cita.estado)) {
    throw new AppError('No se puede cancelar una cita finalizada', 400);
  }
  // Historia clínica: con atención registrada no se cancela (409 CITA_CON_ATENCION_CLINICA).
  await assertSinAtencionClinica(cita.id);

  // Bloque combinado: cancelar una mitad cancela TODO el grupo. Si es individual,
  // el grupo es solo esta cita. Solo se cancelan las que aún no están finalizadas.
  const grupo = cita.slotGrupoId
    ? await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, deletedAt: null } })
    : [cita];
  const aCancelar = grupo.filter((c) => !ESTADOS_FINALES.includes(c.estado));

  // Solo cambia el estado a 'cancelada', sin tocar deletedAt (conserva trazabilidad).
  await prisma.$transaction(async (tx) => {
    for (const c of aCancelar) {
      // Escritura con guarda: si otro la cambió entre la lectura y ahora, no se pisa (409).
      const r = await tx.cita.updateMany({ where: { id: c.id, estado: c.estado, deletedAt: null }, data: { estado: 'cancelada', ...(motivo ? { motivoCancelacion: motivo } : {}) } });
      if (r.count === 0) throw new AppError('La cita cambió de estado mientras tanto. Actualiza la agenda y vuelve a intentar.', 409, 'ESTADO_CAMBIADO');
      await auditEnTx(tx, {
        citaId: c.id,
        usuarioId: req.user?.userId,
        accion: 'cancelar',
        entidad: 'cita',
        entidadId: c.id,
        antes: { estado: c.estado },
        despues: { estado: 'cancelada', ...(motivo ? { motivoCancelacion: motivo } : {}), ...(cita.slotGrupoId && c.id !== cita.id ? { slotGrupoId: cita.slotGrupoId, cascada: true } : {}) },
        sedeId: c.sedeId,
        ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
      });
    }
  });

  // Para cada cita cancelada: devolver sesión de paquete (helper canónico idempotente),
  // sincronizar Outlook, cancelar recordatorios y emitir evento. Mismo trato que el
  // DELETE individual, aplicado a ambas mitades del bloque. El reembolso de sesión se
  // AWAITEA (como en PATCH /estado): un fallo debe verse, no perderse en silencio.
  for (const c of aCancelar) {
    await sincronizarSesionPaquete(c.id);
    void sincronizarCitaOutlook('cancelar', c.id);
    void cancelarRecordatoriosDeCita(c.id);
    void cancelarVideosDeCita(c.id);
    emitirEventoCita({
      tipo: 'cita:cancelada',
      sedeId: c.sedeId,
      fecha: c.fecha.toISOString().split('T')[0]!,
      cita: { id: c.id, estado: 'cancelada' } as never,
      cambiadoPor: req.user?.userId ?? 'sistema',
    });
  }
  // El slot liberado vuelve a ofrecerse de inmediato.
  await invalidateDisponibilidadCache(cita.sedeId, cita.fecha.toISOString().split('T')[0]!);

  res.json({ ok: true, canceladas: aCancelar.map((c) => c.id) });
});

// ─── PATCH /citas/:id/consultorio ────────────────────────────────────────────
// Estados que "ocupan" un consultorio en el tiempo (a efectos de conflicto).
// cancelada/reprogramada no ocupan (el paciente no llegó / la cita se movió).
const ESTADOS_OCUPAN_CONSULTORIO: Prisma.EnumEstadoCitaFilter = {
  notIn: ['cancelada', 'reprogramada'],
};

router.patch('/:id/consultorio', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const { consultorioNumero } = z.object({ consultorioNumero: z.number().int().min(1).max(99).nullable() }).parse(req.body);
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null }, include: { sede: { select: { consultorios: true } } } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  if (['cancelada', 'no_show', 'reprogramada'].includes(cita.estado)) {
    throw new AppError('No se asigna consultorio a una cita cancelada, reprogramada o no asistida', 400, 'ESTADO_INVALIDO');
  }
  // El número debe existir en la sede (Sede.consultorios; 0 = la sede no numera consultorios).
  if (consultorioNumero != null && cita.sede.consultorios > 0 && consultorioNumero > cita.sede.consultorios) {
    throw new AppError(`Esta sede tiene consultorios del 1 al ${cita.sede.consultorios}`, 400, 'CONSULTORIO_INVALIDO');
  }
  // Bloque combinado: es UNA visita física → las dos citas van al mismo consultorio (el aparato del
  // consultorio encuentra así el 1º y el 2º tratamiento).
  const hermanas = cita.slotGrupoId
    ? await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, id: { not: cita.id }, deletedAt: null }, select: { id: true, sedeId: true, consultorioNumero: true } })
    : [];

  // Un consultorio físico solo puede tener 1 cita a la vez. Se considera "ocupado" en
  // sede + unidad de negocio + fecha + número; el conflicto es solapamiento horario.
  // Excepción: bloque combinado (mismo slotGrupoId) — profilaxis + extra son del mismo
  // paciente en el mismo consultorio, así que sí pueden coincidir.
  if (consultorioNumero != null) {
    const inicioA = timeToMinutes(cita.horaInicio);
    const finA = inicioA + cita.duracionMinutos;
    const otras = await prisma.cita.findMany({
      where: {
        deletedAt: null,
        id: { not: cita.id },
        sedeId: cita.sedeId,
        unidadNegocioId: cita.unidadNegocioId,
        fecha: cita.fecha,
        consultorioNumero,
        estado: ESTADOS_OCUPAN_CONSULTORIO,
        ...(cita.slotGrupoId ? { slotGrupoId: { not: cita.slotGrupoId } } : {}),
      },
      select: { id: true, horaInicio: true, duracionMinutos: true },
    });
    const conflicto = otras.find((o) => {
      const inicioB = timeToMinutes(o.horaInicio);
      const finB = inicioB + o.duracionMinutos;
      return inicioA < finB && inicioB < finA;
    });
    if (conflicto) {
      throw new AppError(
        `El consultorio ${consultorioNumero} ya está ocupado por otra cita en ese horario`,
        409,
        'CONSULTORIO_OCUPADO',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.cita.update({
      where: { id: req.params.id },
      data: { consultorioNumero: consultorioNumero ?? null },
    });
    await auditEnTx(tx, {
      citaId: cita.id,
      usuarioId: req.user?.userId,
      accion: 'cambiar_consultorio',
      entidad: 'cita',
      entidadId: cita.id,
      antes: { consultorioNumero: cita.consultorioNumero },
      despues: { consultorioNumero: consultorioNumero ?? null },
      sedeId: cita.sedeId,
      ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
    for (const h of hermanas.filter((x) => x.consultorioNumero !== (consultorioNumero ?? null))) {
      await tx.cita.update({ where: { id: h.id }, data: { consultorioNumero: consultorioNumero ?? null } });
      await auditEnTx(tx, {
        citaId: h.id, usuarioId: req.user?.userId, accion: 'cambiar_consultorio', entidad: 'cita', entidadId: h.id,
        antes: { consultorioNumero: h.consultorioNumero }, despues: { consultorioNumero: consultorioNumero ?? null, slotGrupoId: cita.slotGrupoId, cascada: true },
        sedeId: h.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
      });
    }
  });
  for (const h of hermanas) {
    emitirEventoCita({
      tipo: 'cita:actualizada', sedeId: h.sedeId, fecha: cita.fecha.toISOString().split('T')[0]!,
      cita: await getCitaCompleta(h.id) as never, cambiadoPor: req.user?.userId ?? 'sistema',
    });
  }

  const citaCompleta = await getCitaCompleta(req.params.id);
  emitirEventoCita({
    tipo: 'cita:actualizada',
    sedeId: cita.sedeId,
    fecha: cita.fecha.toISOString().split('T')[0]!,
    cita: citaCompleta as never,
    cambiadoPor: req.user?.userId ?? 'sistema',
  });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/atendido-por ────────────────────────────────────────────
// Columna «Adicional» (de emergencia, no es una persona): se registra qué podóloga REALMENTE atendió (23-sep-2026).
// Solo informativo: la cita NO cambia de columna ni ocupa la agenda de esa podóloga (pudo atender a otro a la vez),
// así que no toca disponibilidad ni el anti-doble-booking. `profesionalId: null` = sin especificar.
router.patch('/:id/atendido-por', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const { profesionalId } = z.object({ profesionalId: z.string().uuid().nullable() }).parse(req.body);
  const cita = await prisma.cita.findUnique({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true, sedeId: true, fecha: true, atendidoPorId: true, profesional: { select: { nombres: true } } },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  if (!cita.profesional || !esFichaAdicional(cita.profesional.nombres)) {
    throw new AppError('Solo en citas de una columna «Adicional» se indica quién atendió', 400, 'NO_ES_ADICIONAL');
  }
  let nombre: string | null = null;
  if (profesionalId) {
    const p = await prisma.profesional.findUnique({ where: { id: profesionalId }, select: { nombres: true, apellidos: true, tipo: true, activo: true, deletedAt: true, esEquipo: true } });
    if (!p || !p.activo || p.deletedAt || p.esEquipo || p.tipo !== 'podologa' || esFichaAdicional(p.nombres)) {
      throw new AppError('Elige una podóloga activa (no otra columna Adicional)', 400, 'ATENDIO_INVALIDO');
    }
    nombre = `${p.nombres} ${p.apellidos}`.trim();
  }
  await prisma.$transaction(async (tx) => {
    await tx.cita.update({ where: { id: cita.id }, data: { atendidoPorId: profesionalId } });
    await auditEnTx(tx, {
      citaId: cita.id, usuarioId: req.user?.userId, accion: 'asignar_atendido_por', entidad: 'cita', entidadId: cita.id,
      antes: { atendidoPorId: cita.atendidoPorId }, despues: { atendidoPorId: profesionalId, atendio: nombre },
      sedeId: cita.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });
  const citaCompleta = await getCitaCompleta(cita.id);
  emitirEventoCita({ tipo: 'cita:actualizada', sedeId: cita.sedeId, fecha: fechaAStr(cita.fecha), cita: citaCompleta as never, cambiadoPor: req.user?.userId ?? 'sistema' });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/comentario ──────────────────────────────────────────────
// AGREGA una entrada al hilo append-only (en cualquier estado). YA NO reemplaza:
// dos usuarios comentando a la vez generan dos entradas → imposible pisarse (fin de M2).
// Se mantiene el verbo/ruta para no romper el frontend; internamente es un INSERT.
router.patch('/:id/comentario', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const { comentario } = z.object({ comentario: z.string().max(2000) }).parse(req.body);
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  const texto = comentario.trim();
  if (!texto) throw new AppError('El comentario está vacío', 400, 'COMENTARIO_VACIO');

  await prisma.$transaction(async (tx) => {
    await crearComentarioEnTx(tx, { citaId: cita.id, sedeId: cita.sedeId, autorId: req.user?.userId ?? null, texto, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
  });

  const citaCompleta = await getCitaCompleta(cita.id);
  emitirEventoCita({
    tipo: 'cita:actualizada',
    sedeId: cita.sedeId,
    fecha: cita.fecha.toISOString().split('T')[0]!,
    cita: citaCompleta as never,
    cambiadoPor: req.user?.userId ?? 'sistema',
  });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/comentarios/:comentarioId — corregir un comentario ─────
// 30-sep-2026: cada usuario corrige SOLO los suyos; admin, cualquiera (también los antiguos sin autor).
// El texto anterior queda en la auditoría (editar_comentario) y la entrada muestra «(editado)».
router.patch('/:id/comentarios/:comentarioId', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const { texto: crudo } = z.object({ texto: z.string().max(2000) }).parse(req.body);
  const texto = crudo.trim();
  if (!texto) throw new AppError('El comentario está vacío', 400, 'COMENTARIO_VACIO');
  const usuarioId = req.user?.userId;
  if (!usuarioId) throw new AppError('Solo un usuario puede corregir comentarios', 403, 'FORBIDDEN');

  const com = await prisma.comentarioCita.findFirst({
    where: { id: req.params.comentarioId, citaId: req.params.id, deletedAt: null },
    include: { cita: { select: { id: true, sedeId: true, fecha: true } } },
  });
  if (!com) throw new AppError('Comentario no encontrado', 404);
  if (req.user?.rol !== 'admin' && com.autorId !== usuarioId) {
    throw new AppError('Solo puedes modificar tus propios comentarios', 403, 'COMENTARIO_AJENO');
  }
  if (com.texto === texto) { res.json(await getCitaCompleta(com.citaId)); return; }

  await prisma.$transaction(async (tx) => {
    await tx.comentarioCita.update({ where: { id: com.id }, data: { texto, editadoEn: new Date(), editadoPorId: usuarioId } });
    await auditEnTx(tx, {
      citaId: com.citaId, usuarioId, accion: 'editar_comentario', entidad: 'comentario_cita', entidadId: com.id,
      antes: { texto: com.texto }, despues: { texto, ...(com.autorId !== usuarioId ? { autor: com.autorEtiqueta } : {}) },
      sedeId: com.cita.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });

  const citaCompleta = await getCitaCompleta(com.citaId);
  emitirEventoCita({
    tipo: 'cita:actualizada',
    sedeId: com.cita.sedeId,
    fecha: fechaAStr(com.cita.fecha),
    cita: citaCompleta as never,
    cambiadoPor: usuarioId,
  });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/canal ───────────────────────────────────────────────────
// Canal de reserva (de dónde viene el cliente). Editable en cualquier estado.
router.patch('/:id/canal', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  // 05-oct-2026: cambiar el canal de una cita ya registrada es de quien tiene «citas.canal» o «citas.revertir»
  // (igual que en la pantalla); antes bastaba «citas.estado». Las llaves de API siguen con su scope.
  if (!req.apiKey && !req.user?.permisos?.some((p) => p === 'citas.canal' || p === 'citas.revertir')) {
    throw new AppError('Necesitas el permiso «Cambiar el canal de la cita» para esta acción', 403, 'SIN_PERMISO');
  }
  const { canal } = z.object({ canal: z.string() }).parse(req.body);
  await validarCanal(canal);
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  await prisma.$transaction(async (tx) => {
    await tx.cita.update({ where: { id: cita.id }, data: { canal } });
    await auditEnTx(tx, {
      citaId: cita.id, usuarioId: req.user?.userId, accion: 'editar_canal', entidad: 'cita', entidadId: cita.id,
      antes: { canal: cita.canal }, despues: { canal }, sedeId: cita.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });
  const citaCompleta = await getCitaCompleta(cita.id);
  emitirEventoCita({
    tipo: 'cita:actualizada',
    sedeId: cita.sedeId,
    fecha: cita.fecha.toISOString().split('T')[0]!,
    cita: citaCompleta as never,
    cambiadoPor: req.user?.userId ?? 'sistema',
  });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/pago  (y /pagada, la anterior) ───────────────────────────
// ESTADO DE PAGO (29-sep-2026): pendiente / incompleto / completo. Editable en cualquier estado (como el canal). En un
// bloque combinado se cambia el bloque entero (se paga junto). Queda quién y cuándo, y la auditoría.
async function aplicarEstadoPago(req: Request, res: Response, estado: EstadoPagoCita) {
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  const grupo = cita.slotGrupoId
    ? await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, deletedAt: null }, select: { id: true, estadoPago: true, sedeId: true } })
    : [{ id: cita.id, estadoPago: cita.estadoPago, sedeId: cita.sedeId }];
  const cambian = grupo.filter((c) => c.estadoPago !== estado);
  if (cambian.length) {
    await prisma.$transaction(async (tx) => {
      for (const c of cambian) {
        await tx.cita.update({ where: { id: c.id }, data: camposPago(estado, req.user?.userId) });
        await auditEnTx(tx, {
          citaId: c.id, usuarioId: req.user?.userId, accion: 'cambiar_estado_pago', entidad: 'cita', entidadId: c.id,
          antes: { estadoPago: c.estadoPago }, despues: { estadoPago: estado }, sedeId: c.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
        });
      }
    });
  }
  for (const c of cambian) {
    const completa = await getCitaCompleta(c.id);
    emitirEventoCita({ tipo: 'cita:actualizada', sedeId: c.sedeId, fecha: cita.fecha.toISOString().split('T')[0]!, cita: completa as never, cambiadoPor: req.user?.userId ?? 'sistema' });
  }
  res.json(await getCitaCompleta(cita.id));
}

// ─── PATCH /citas/:id/comprobante ─────────────────────────────────────────────
// Comprobante de pago (29-sep-2026): se adjunta, reemplaza o quita después de agendar (el archivo se sube antes con
// POST /citas/upload-comprobante). Un comprobante por cita; el anterior queda en la auditoría.
router.patch('/:id/comprobante', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const data = z.object({
    url: z.string().regex(/^\/uploads\/comprobantes\/[^/?#]+$/, 'Comprobante inválido').nullable(),
    nombre: z.string().max(255).optional(),
    mimeType: z.string().max(100).optional(),
  }).parse({ ...req.body, url: req.body?.url ? limpiarUrlArchivo(String(req.body.url)) : null });
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.cita.update({
      where: { id: cita.id },
      data: data.url
        ? { comprobanteUrl: data.url, comprobanteNombre: data.nombre ?? null, comprobanteMimeType: data.mimeType ?? null, comprobanteSubidoPor: req.user?.userId ?? null, comprobanteSubidoEn: new Date() }
        : { comprobanteUrl: null, comprobanteNombre: null, comprobanteMimeType: null, comprobanteSubidoPor: null, comprobanteSubidoEn: null },
    });
    await auditEnTx(tx, {
      citaId: cita.id, usuarioId: req.user?.userId, accion: data.url ? 'adjuntar_comprobante' : 'quitar_comprobante', entidad: 'cita', entidadId: cita.id,
      antes: { comprobanteUrl: cita.comprobanteUrl, comprobanteNombre: cita.comprobanteNombre },
      despues: { comprobanteUrl: data.url, comprobanteNombre: data.url ? data.nombre ?? null : null },
      sedeId: cita.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });
  const completa = await getCitaCompleta(cita.id);
  emitirEventoCita({ tipo: 'cita:actualizada', sedeId: cita.sedeId, fecha: cita.fecha.toISOString().split('T')[0]!, cita: completa as never, cambiadoPor: req.user?.userId ?? 'sistema' });
  res.json(completa);
});

router.patch('/:id/pago', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const { estadoPago } = z.object({ estadoPago: zEstadoPago }).parse(req.body);
  await aplicarEstadoPago(req, res, estadoPago);
});

// Anterior (sí/no): true = pago completo, false = pendiente.
router.patch('/:id/pagada', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const { pagada } = z.object({ pagada: z.boolean() }).parse(req.body);
  await aplicarEstadoPago(req, res, pagada ? 'completo' : 'pendiente');
});

// ─── POST /citas/intercambiar ─────────────────────────────────────────────────
// Intercambiar DOS pacientes entre podólogas (26-sep-2026): se arrastra la cita A sobre la cita B y cada una queda en el
// lugar de la otra (profesional + hora) en un solo paso. Mismo día y misma sede. Cada una se valida como un «mover»:
// competencia, hora válida, turno, bloqueos y que no choque con OTRA cita (excluyendo a las dos). Citas dobles y baro no.
router.post('/intercambiar', requireAuth, requireAcceso('appointments:write', 'citas.reprogramar'), async (req, res) => {
  const { citaIdA, citaIdB } = z.object({ citaIdA: z.string().uuid(), citaIdB: z.string().uuid() }).parse(req.body);
  if (citaIdA === citaIdB) throw new AppError('Elige dos citas distintas', 400, 'MISMA_CITA');
  const citas = await prisma.cita.findMany({
    where: { id: { in: [citaIdA, citaIdB] }, deletedAt: null },
    include: { unidadNegocio: true, paciente: { select: { nombres: true, apellidoPaterno: true } } },
  });
  const a = citas.find((c) => c.id === citaIdA);
  const b = citas.find((c) => c.id === citaIdB);
  if (!a || !b) throw new AppError('Cita no encontrada', 404);
  assertSede(req, a.sedeId);
  if (a.sedeId !== b.sedeId || fechaAStr(a.fecha) !== fechaAStr(b.fecha)) {
    throw new AppError('Solo se intercambian citas del mismo día y de la misma sede', 400, 'INTERCAMBIO_INVALIDO');
  }
  for (const c of [a, b]) {
    if ([...ESTADOS_FINALES, 'reprogramada'].includes(c.estado)) throw new AppError('Una de las citas ya terminó, se canceló o no vino: no se intercambia', 400, 'ESTADO_FINAL');
    if (c.slotGrupoId) throw new AppError('Una de las citas es doble (dos servicios): esas se mueven con su bloque, no se intercambian', 400, 'CITA_DOBLE');
    if (c.unidadNegocio.modoReserva === 'sin_eleccion') throw new AppError('Las citas de baropodometría van en máquina: no se intercambian', 400, 'INTERCAMBIO_INVALIDO');
    if (!c.profesionalId) throw new AppError('Una de las citas no tiene profesional', 400, 'SIN_PROFESIONAL');
  }
  if (a.profesionalId === b.profesionalId && a.horaInicio === b.horaInicio) throw new AppError('Las dos citas ya están en el mismo lugar', 400, 'INTERCAMBIO_INVALIDO');
  const fecha = fechaAStr(a.fecha);
  const ids = [a.id, b.id];
  // Cada cita va al lugar de la otra.
  const planes = [
    { cita: a, profesionalId: b.profesionalId!, horaInicio: b.horaInicio },
    { cita: b, profesionalId: a.profesionalId!, horaInicio: a.horaInicio },
  ];
  for (const pl of planes) {
    const comp = await prisma.competenciaProfesional.findFirst({ where: { profesionalId: pl.profesionalId, servicioId: pl.cita.servicioId, activa: true } });
    if (!comp) {
      const p = await prisma.profesional.findUnique({ where: { id: pl.profesionalId }, select: { nombres: true } });
      throw new AppError(`${p?.nombres ?? 'La profesional'} no tiene habilitado el servicio de ${pl.cita.paciente.nombres.split(' ')[0]}`, 400, 'SIN_COMPETENCIA');
    }
    if (!horaInicioValidaParaDuracion(pl.horaInicio, pl.cita.duracionMinutos)) {
      throw new AppError(`La cita de ${pl.cita.paciente.nombres.split(' ')[0]} dura 1 hora y solo empieza en hora entera`, 400, 'SLOT_HORA_INVALIDA');
    }
    await assertProfesionalActivo(pl.profesionalId);
    const turno = (await turnosDelDia(a.sedeId, fecha, [pl.profesionalId])).get(pl.profesionalId);
    if (!turno) throw new AppError('Una de las profesionales no atiende este día', 400, 'SIN_HORARIO');
    if (pl.horaInicio < turno.horaInicio || pl.horaInicio >= turno.horaFin) throw new AppError(`El horario ${pl.horaInicio} está fuera del turno (${turno.horaInicio}–${turno.horaFin})`, 400, 'SLOT_FUERA_HORARIO');
    assertTerminaEnTurno(pl.horaInicio, pl.cita.duracionMinutos, turno.horaFin);
    await validarSinBloqueo(pl.profesionalId, fecha, pl.horaInicio, pl.cita.duracionMinutos, a.sedeId);
  }
  // «Solo X» (fuera de baro): si la cita pasa a la columna de OTRA persona, la atiende esa persona (misma regla que mover).
  const soloFinal = (c: typeof a, destino: string) => (c.solicitadoProfesionalId && destino !== c.profesionalId ? null : c.solicitadoProfesionalId);
  const atenciones = await prisma.atencionClinica.findMany({ where: { citaId: { in: ids } }, select: { id: true, citaId: true, estado: true } });
  try {
    await withDeadlockRetry(() => prisma.$transaction(async (tx) => {
      for (const pl of planes) {
        await validarProfesionalLibre(pl.profesionalId, fecha, pl.horaInicio, pl.cita.duracionMinutos, undefined, ids, tx);
        await validarCupoServicio(tx, { servicioId: pl.cita.servicioId, sedeId: a.sedeId, fecha, horaInicio: pl.horaInicio, duracionMin: pl.cita.duracionMinutos, excluirCitaIds: ids });
      }
      // El índice único (profesional, fecha, hora) no deja poner B en el lugar de A mientras A siga ahí: A se aparta un
      // instante (deletedAt) dentro de la MISMA transacción y vuelve ya en su nuevo lugar.
      await tx.cita.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
      for (const pl of [planes[1]!, planes[0]!]) {
        await tx.cita.update({
          where: { id: pl.cita.id },
          data: {
            profesionalId: pl.profesionalId, horaInicio: pl.horaInicio, deletedAt: null,
            solicitadoProfesionalId: soloFinal(pl.cita, pl.profesionalId),
            // Cambió de profesional: ya no es «la que eligió el paciente».
            ...(pl.profesionalId !== pl.cita.profesionalId && pl.cita.origenAsignacion === 'elegida_por_paciente' ? { origenAsignacion: 'asignada_automaticamente' as const } : {}),
          },
        });
        const at = atenciones.find((x) => x.citaId === pl.cita.id);
        // 10-oct-2026: si la atención clínica pasa a la otra podóloga, queda dicho en la auditoría (antes no).
        const atencionDe = at ? await atencionSigueAProfesional(tx, pl.cita.id, pl.profesionalId) : null;
        await auditEnTx(tx, {
          citaId: pl.cita.id, usuarioId: req.user?.userId, accion: 'intercambiar', entidad: 'cita', entidadId: pl.cita.id,
          antes: { profesionalId: pl.cita.profesionalId, horaInicio: pl.cita.horaInicio },
          despues: { profesionalId: pl.profesionalId, horaInicio: pl.horaInicio, conCita: pl.cita.id === a.id ? b.id : a.id, ...(atencionDe ? { atencionPasaDe: atencionDe } : {}) },
          sedeId: a.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (err) {
    if (esConflictoDeSlot(err)) throw new AppError('Alguien acaba de cambiar esos horarios. Refresque e intente otra vez.', 409, 'SLOT_OCUPADO');
    throw err;
  }
  await invalidateDisponibilidadCache(a.sedeId, fecha);
  const [ca, cb] = await Promise.all([getCitaCompleta(a.id), getCitaCompleta(b.id)]);
  for (const c of [ca, cb]) emitirEventoCita({ tipo: 'cita:actualizada', sedeId: a.sedeId, fecha, cita: c as never, cambiadoPor: req.user?.userId ?? 'sistema' });
  res.json({ a: ca, b: cb });
});

// ─── PATCH /citas/:id/tratamiento ─────────────────────────────────────────────
// Cambiar el TRATAMIENTO (servicio) y/o la subcategoría de una cita (24-sep-2026, pedido de la clínica).
// Quién: admin, coordinación, contact center, especial contact y recepción. Cuándo: agendada / confirmada / llegó; después
// ya no, salvo el ADMIN (en cualquier momento). Mismas reglas que al agendar: misma unidad, el profesional (o la máquina
// de baro y su médico) lo tiene habilitado, subcategoría válida, si dura más debe caber (hora, turno, bloqueos y sin
// cruzarse, dentro de la tx Serializable), membresía que lo cubra y promo que siga aplicando. Cita doble: no.
const ROLES_CAMBIAN_TRATAMIENTO = ['admin', 'coordinadora_sedes', 'contact_center', 'especial_contact', 'recepcionista'];
const ESTADOS_CAMBIO_TRATAMIENTO = ['agendada', 'confirmada', 'llego'];
router.patch('/:id/tratamiento', requireAuth, requireRol(...ROLES_CAMBIAN_TRATAMIENTO), guardSedeCita, async (req, res) => {
  const data = z.object({ servicioId: z.string().uuid(), subcategoriaId: z.string().uuid().nullable().optional() }).parse(req.body);
  const cita = await prisma.cita.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: { servicio: { select: { nombre: true } }, subcategoria: { select: { nombre: true } } },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  const esAdmin = req.user?.rol === 'admin';
  if (['cancelada', 'reprogramada'].includes(cita.estado)) {
    throw new AppError('La cita está cancelada o reprogramada: no se le cambia el tratamiento', 400, 'ESTADO_FINAL');
  }
  if (!esAdmin && !ESTADOS_CAMBIO_TRATAMIENTO.includes(cita.estado)) {
    throw new AppError('El tratamiento solo se cambia mientras la cita está agendada o hasta que el paciente llegó. Después, solo administración.', 403, 'TRATAMIENTO_BLOQUEADO');
  }
  if (cita.slotGrupoId) {
    throw new AppError('Es una cita doble: para cambiar uno de sus tratamientos, cancélala y agéndala de nuevo', 400, 'CITA_DOBLE');
  }
  const profesionalId = cita.profesionalId;
  if (!profesionalId) throw new AppError('La cita no tiene profesional asignado', 400, 'SIN_PROFESIONAL');

  const servicio = await prisma.servicio.findUnique({ where: { id: data.servicioId } });
  if (!servicio || !servicio.activo) throw new AppError('Servicio no encontrado o inactivo', 404);
  if (servicio.unidadNegocioId !== cita.unidadNegocioId) {
    throw new AppError('El nuevo tratamiento debe ser de la misma área de la cita (podología, fisioterapia o baropodometría)', 400, 'OTRA_UNIDAD');
  }
  const subcategoriaId = (await resolverSubcategoria(servicio.id, data.subcategoriaId)) ?? null;
  if (servicio.id === cita.servicioId && subcategoriaId === (cita.subcategoriaId ?? null)) {
    res.json(await getCitaCompleta(cita.id)); // sin cambios
    return;
  }

  // Habilitado: el profesional de la cita (o la máquina de baro) y, en baro, su médico.
  const fecha = fechaAStr(cita.fecha);
  const competencia = await prisma.competenciaProfesional.findFirst({ where: { profesionalId: profesionalId, servicioId: servicio.id, activa: true } });
  if (!competencia) throw new AppError('El profesional de la cita no tiene habilitado ese tratamiento: reprográmala con otro profesional', 400, 'SIN_COMPETENCIA');
  if (cita.solicitadoProfesionalId && !(await medicoAtiendeBaroEnSede(cita.solicitadoProfesionalId, servicio.id, cita.sedeId, fecha))) {
    throw new AppError('El médico de la cita no atiende ese tratamiento en esta sede', 400, 'MEDICO_BARO_INVALIDO');
  }

  // Si el nuevo dura MÁS, tiene que caber en el mismo horario (si dura menos, siempre cabe).
  const duracion = servicio.duracionMinutos;
  const dureMas = duracion > cita.duracionMinutos;
  if (dureMas) {
    if (!horaInicioValidaParaDuracion(cita.horaInicio, duracion)) {
      throw new AppError('Ese tratamiento dura 1 hora y solo empieza en hora entera: reprograma la cita a una hora en punto', 400, 'SLOT_HORA_INVALIDA');
    }
    const turno = (await turnosDelDia(cita.sedeId, fecha, [profesionalId])).get(profesionalId);
    if (turno) assertTerminaEnTurno(cita.horaInicio, duracion, turno.horaFin);
    await validarSinBloqueo(profesionalId, fecha, cita.horaInicio, duracion, cita.sedeId);
    if (cita.solicitadoProfesionalId) await validarSinBloqueo(cita.solicitadoProfesionalId, fecha, cita.horaInicio, duracion, cita.sedeId);
  }

  // Membresía / paquete: debe cubrir el nuevo tratamiento; si la sesión ya se descontó, primero se devuelve.
  if (cita.paquetePacienteId) {
    if (cita.sesionConsumida) {
      throw new AppError('La sesión de la membresía ya se descontó con esta cita: para cambiar el tratamiento, primero hay que devolver la sesión (revertir la llegada)', 409, 'SESION_YA_DESCONTADA');
    }
    const pp = await prisma.paquetePaciente.findUnique({ where: { id: cita.paquetePacienteId }, select: { servicioNuevoId: true, composicion: true } });
    const comp = Array.isArray(pp?.composicion) ? pp!.composicion : [];
    if (pp && (comp.length > 0 || pp.servicioNuevoId) && !paqueteCorresponde(pp, servicio.id, subcategoriaId)) {
      throw new AppError('La membresía o paquete de esta cita no cubre ese tratamiento', 409, 'PAQUETE_NO_CORRESPONDE');
    }
  }

  // Dinero: nuevo precio de lista; la promo (si tiene) debe seguir aplicando y se recalcula.
  const precioLista = await precioListaDe(servicio.id, subcategoriaId);
  let montoDescuento: number | null = null;
  let montoFinal = precioLista;
  if (cita.promocionId) {
    const calc = await recalcularPromoTrasCambio(cita.promocionId, { servicioId: servicio.id, sedeId: cita.sedeId, fecha, canal: cita.canal, pacienteId: cita.pacienteId }, precioLista);
    montoDescuento = calc.descuento;
    montoFinal = calc.final;
  }

  const atencion = await prisma.atencionClinica.findUnique({ where: { citaId: cita.id }, select: { id: true } });
  const subNueva = subcategoriaId ? await prisma.subcategoriaServicio.findUnique({ where: { id: subcategoriaId }, select: { nombre: true } }) : null;
  try {
    await withDeadlockRetry(() => prisma.$transaction(async (tx) => {
      if (dureMas) {
        await validarProfesionalLibre(profesionalId, fecha, cita.horaInicio, duracion, cita.id, [], tx);
        if (cita.solicitadoProfesionalId && cita.solicitadoProfesionalId !== profesionalId) {
          await validarProfesionalLibre(cita.solicitadoProfesionalId, fecha, cita.horaInicio, duracion, cita.id, [], tx);
        }
      }
      if (cita.paquetePacienteId) await validarCupoItemAlAgendar(tx, cita.paquetePacienteId, servicio.id, subcategoriaId, cita.id);
      // Si el nuevo tratamiento usa una sala única (Motiphysio), esa sala debe estar libre a esa hora.
      await validarCupoServicio(tx, { servicioId: servicio.id, sedeId: cita.sedeId, fecha, horaInicio: cita.horaInicio, duracionMin: duracion, excluirCitaIds: [cita.id] });
      await tx.cita.update({
        where: { id: cita.id },
        data: { servicioId: servicio.id, subcategoriaId, duracionMinutos: duracion, precioLista, montoDescuento, montoFinal },
      });
      // La atención clínica (si ya se abrió) copia el servicio de su cita: se corrige igual.
      if (atencion) await tx.atencionClinica.update({ where: { id: atencion.id }, data: { servicioId: servicio.id, subcategoriaId } });
      await auditEnTx(tx, {
        citaId: cita.id, usuarioId: req.user?.userId, accion: 'cambiar_tratamiento', entidad: 'cita', entidadId: cita.id,
        antes: { servicio: cita.servicio.nombre, subcategoria: cita.subcategoria?.nombre ?? null, duracionMinutos: cita.duracionMinutos, montoFinal: cita.montoFinal != null ? Number(cita.montoFinal) : null, estado: cita.estado },
        despues: { servicio: servicio.nombre, subcategoria: subNueva?.nombre ?? null, duracionMinutos: duracion, montoFinal, atencionCorregida: !!atencion },
        sedeId: cita.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (err) {
    if (esConflictoDeSlot(err)) throw new AppError('Ese horario acaba de ocuparse. Refresque e intente otra vez.', 409, 'SLOT_OCUPADO');
    throw err;
  }

  const citaCompleta = await getCitaCompleta(cita.id);
  emitirEventoCita({ tipo: 'cita:actualizada', sedeId: cita.sedeId, fecha, cita: citaCompleta as never, cambiadoPor: req.user?.userId ?? 'sistema' });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/promocion ───────────────────────────────────────────────
// Set/limpiar la promoción de una cita. En un bloque combinado, la promo SIEMPRE se escribe
// en la cita PORTADORA (PRINCIPAL/profilaxis), aunque se edite desde la secundaria. Emite
// evento para AMBAS citas del bloque para que la UI refresque.
router.patch('/:id/promocion', requireAuth, requireAcceso('appointments:write', 'citas.estado'), guardSedeCita, async (req, res) => {
  const { promocionId, codigoPromo } = z.object({ promocionId: z.string().uuid().nullable(), codigoPromo: z.string().trim().max(60).optional() }).parse(req.body);
  const cita = await prisma.cita.findUnique({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true, sedeId: true, fecha: true, slotGrupoId: true },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  if (promocionId) {
    const promo = await prisma.promocion.findFirst({ where: { id: promocionId, deletedAt: null } });
    if (!promo) throw new AppError('Promoción no encontrada', 404);
  }

  const portadoraId = await resolverCitaPortadora(cita);
  const antes = await prisma.cita.findUnique({
    where: { id: portadoraId },
    select: { promocionId: true, estado: true, paquetePacienteId: true, servicioId: true, subcategoriaId: true, sedeId: true, fecha: true, canal: true, pacienteId: true, precioLista: true, montoDescuento: true, montoFinal: true },
  });
  if (!antes) throw new AppError('Cita no encontrada', 404);

  // Mismas reglas que al AGENDAR (antes aquí solo se miraba que la promo existiera): la promo debe
  // CALIFICAR (activa, vigente, de esta sede/servicio/canal, con cupo) y el dinero se recalcula. Sin
  // esto la cita mostraba «50 % off» cobrando el precio completo, o quedaba rebajada sin promo; y se
  // podía pegar una promo vencida, de otra sede o agotada, o sobre una cita cancelada (mueve el cupo).
  if (['cancelada', 'no_show', 'reprogramada'].includes(antes.estado)) {
    throw new AppError('No se cambia la promoción de una cita cancelada, reprogramada o a la que no vino.', 400, 'ESTADO_FINAL');
  }
  if (antes.estado === 'completada' && !req.user?.permisos?.includes('citas.revertir')) {
    throw new AppError('La cita ya fue atendida: solo coordinación o administración cambian su promoción.', 403, 'CITA_COMPLETADA');
  }
  if (promocionId && antes.paquetePacienteId) {
    throw new AppError('Una promoción no se combina con una membresía. Elige una u otra.', 409, 'PROMO_CON_MEMBRESIA');
  }
  const precioLista = antes.precioLista != null ? Number(antes.precioLista) : await precioListaDe(antes.servicioId, antes.subcategoriaId);
  let montoDescuento: number | null = null;
  let montoFinal = precioLista;
  if (promocionId && promocionId === antes.promocionId) {
    montoDescuento = antes.montoDescuento != null ? Number(antes.montoDescuento) : null; // misma promo: no se toca el dinero
    montoFinal = antes.montoFinal != null ? Number(antes.montoFinal) : precioLista;
  } else if (promocionId) {
    const calc = await validarYCalcularPromo(promocionId, { servicioId: antes.servicioId, sedeId: antes.sedeId, fecha: fechaAStr(antes.fecha), canal: antes.canal, pacienteId: antes.pacienteId }, precioLista, codigoPromo);
    montoDescuento = calc.descuento;
    montoFinal = calc.final;
  }

  await prisma.$transaction(async (tx) => {
    await tx.cita.update({ where: { id: portadoraId }, data: { promocionId, precioLista, montoDescuento, montoFinal } });
    await auditEnTx(tx, {
      citaId: portadoraId, usuarioId: req.user?.userId, accion: 'editar_promocion', entidad: 'cita', entidadId: portadoraId,
      antes: { promocionId: antes.promocionId ?? null, montoFinal: antes.montoFinal != null ? Number(antes.montoFinal) : null }, despues: { promocionId, montoDescuento, montoFinal }, sedeId: cita.sedeId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    });
  });

  // Refrescar ambas citas del bloque (o la única).
  const idsBloque = cita.slotGrupoId
    ? (await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, deletedAt: null }, select: { id: true } })).map(c => c.id)
    : [cita.id];
  const fecha = cita.fecha.toISOString().split('T')[0]!;
  for (const cid of idsBloque) {
    emitirEventoCita({ tipo: 'cita:actualizada', sedeId: cita.sedeId, fecha, cita: await getCitaCompleta(cid) as never, cambiadoPor: req.user?.userId ?? 'sistema' });
  }
  res.json(await getCitaCompleta(req.params.id));
});

// ─── GET /citas/sede/:sedeId/stats ─────────────────────────────────────────────
router.get('/sede/:sedeId/stats', requireAuth, async (req, res) => {
  assertSede(req, req.params.sedeId);
  const { fecha } = req.query as { fecha?: string };
  // Día en hora de Lima anclado a mediodía UTC (@db.Date): sin `setHours` local, que en un servidor
  // con otra zona horaria corría el día y el día de la semana (capacidad del día equivocado).
  const fechaStr = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : hoyLimaStr();
  const fechaDate = fechaDb(fechaStr);

  const citas = await prisma.cita.groupBy({
    by: ['estado'],
    where: {
      sedeId: req.params.sedeId,
      fecha: fechaDate,
      deletedAt: null,
      estado: { not: 'cancelada' },
    },
    _count: { estado: true },
  });

  const stats = {
    total: 0, confirmadas: 0, llegaron: 0, noShows: 0, completadas: 0, agendadas: 0, enAtencion: 0,
  };

  for (const g of citas) {
    const count = g._count.estado;
    stats.total += count;
    if (g.estado === 'confirmada') stats.confirmadas += count;
    if (g.estado === 'llego') stats.llegaron += count;
    if (g.estado === 'no_show') stats.noShows += count;
    if (g.estado === 'completada') stats.completadas += count;
    if (g.estado === 'agendada') stats.agendadas += count;
    if (g.estado === 'en_atencion') stats.enAtencion += count;
  }

  // Capacidad real: suma de slots de 30 min disponibles por profesional activo ese día en la sede
  const diaSemana = fechaDate.getUTCDay();
  const horariosDia = await prisma.horarioProfesional.findMany({
    where: {
      diaSemana,
      activo: true,
      profesional: {
        activo: true,
        deletedAt: null,
        asignaciones: { some: { sedeId: req.params.sedeId, activa: true } },
      },
    },
  });
  let capacidadMaxima = horariosDia.reduce((sum, h) => {
    const [hI = 0, mI = 0] = h.horaInicio.split(':').map(Number);
    const [hF = 0, mF = 0] = h.horaFin.split(':').map(Number);
    return sum + Math.floor(((hF * 60 + mF) - (hI * 60 + mI)) / 30);
  }, 0);
  if (capacidadMaxima === 0) capacidadMaxima = 1; // evitar división por cero en días sin horario

  // Ocupación = ocupación FÍSICA de slots: un bloque combinado (ancla + extra) ocupa
  // una sola hora física, así que las mitades SECUNDARIAS no suman a la ocupación (sí
  // a las atenciones/`stats.total`, que cuentan los 2 servicios — ver decisión de KPIs).
  const secundarios = await prisma.cita.count({
    where: { sedeId: req.params.sedeId, fecha: fechaDate, deletedAt: null, estado: { not: 'cancelada' }, slotRol: 'SECUNDARIO' },
  });
  const totalFisico = Math.max(0, stats.total - secundarios);

  res.json({ ...stats, ocupacion: Math.round((totalFisico / capacidadMaxima) * 100) });
});

// ─── Auto-completado por tiempo ───────────────────────────────────────────────
// Una cita marcada "Llegó" pasa SOLA a 'completada' a los N minutos (default 90), por
// cumplimiento de tiempo. Aplica a citas en 'llego'/'en_atencion' cuyo `llegoEn` superó el
// umbral. Idempotente (corre cada pocos minutos). Hace los MISMOS efectos que completar a
// mano (consume sesión de paquete, evento socket, webhook) y audita como 'auto_completar'.
const AUTOCOMPLETAR_MIN = Number(process.env.AUTOCOMPLETAR_MIN) || 90;

export async function autocompletarCitasPorTiempo(): Promise<number> {
  const ahora = Date.now();
  // Todas las 'llego'/'en_atencion' vivas; el UMBRAL se evalúa POR CITA:
  //  • en_atencion → duración + 15 min desde `enAtencionEn` (ancla principal).
  //  • llego       → AUTOCOMPLETAR_MIN (90) desde `llegoEn` (red de seguridad para las que
  //                  se quedan en "llegó" sin pasar a atención).
  const todas = await prisma.cita.findMany({
    where: { estado: { in: ['llego', 'en_atencion'] }, deletedAt: null },
    select: { id: true, sedeId: true, fecha: true, estado: true, duracionMinutos: true, llegoEn: true, enAtencionEn: true },
  });
  const candidatas = todas.filter((c) => {
    if (c.estado === 'en_atencion') {
      // Ancla: enAtencionEn; si es nula (citas puestas en atención ANTES de esta versión), cae a
      // llegoEn para no dejarlas atascadas. Umbral: duración + 15 min.
      const ancla = c.enAtencionEn ?? c.llegoEn;
      return !!ancla && ahora - ancla.getTime() >= (c.duracionMinutos + 15) * 60_000;
    }
    return !!c.llegoEn && ahora - c.llegoEn.getTime() >= AUTOCOMPLETAR_MIN * 60_000;
  });
  // Aparato del consultorio: una cita con su tratamiento EN CURSO (INICIO sin FIN, de menos de 3 h)
  // no se autocompleta — la cierra el FIN del aparato. Pasadas las 3 h, `cerrarTiemposAbandonados`
  // marca ese tiempo «sin fin» y en la siguiente vuelta la cita se completa por tiempo.
  const conTiempoAbierto = new Set(candidatas.length
    ? (await prisma.tiempoTratamiento.findMany({
        where: {
          citaId: { in: candidatas.map((c) => c.id) }, estado: 'en_curso', deletedAt: null,
          inicioEn: { gt: new Date(ahora - MAX_ABIERTO_MIN * 60_000) },
        },
        select: { citaId: true },
      })).map((t) => t.citaId)
    : []);
  const diasAfectados = new Set<string>();
  let completadas = 0;

  for (const c of candidatas.filter((x) => !conTiempoAbierto.has(x.id))) {
    try {
      const cambiada = await prisma.$transaction(async (tx) => {
        // Re-leer DENTRO de la tx y RE-VERIFICAR el umbral contra el estado/ancla ACTUALES.
        // Sin esto había una carrera: una cita en 'llego' (candidata por los 90 min) que justo
        // pasa a 'en_atencion' entre el findMany y la tx se completaba al instante, cuando recién
        // le tocaría a los duración+15 min.
        const actual = await tx.cita.findUnique({ where: { id: c.id }, select: { estado: true, duracionMinutos: true, llegoEn: true, enAtencionEn: true, deletedAt: true } });
        if (!actual || actual.deletedAt) return false; // borrada entre el barrido y la tx → no completar ni disparar side-effects
        const vence = actual.estado === 'en_atencion'
          ? (() => { const ancla = actual.enAtencionEn ?? actual.llegoEn; return !!ancla && ahora - ancla.getTime() >= (actual.duracionMinutos + 15) * 60_000; })()
          : actual.estado === 'llego'
            ? !!actual.llegoEn && ahora - actual.llegoEn.getTime() >= AUTOCOMPLETAR_MIN * 60_000
            : false; // ya cambió a otro estado (completada/cancelada/…) → no tocar
        if (!vence) return false;
        const motivoAuto = actual.estado === 'en_atencion'
          ? `auto por tiempo (${actual.duracionMinutos} + 15 min desde "En atención")`
          : `auto por tiempo (${AUTOCOMPLETAR_MIN} min desde "Llegó")`;
        // Escritura con guarda: si recepción o el aparato la cambiaron entre la lectura y ahora, no se toca.
        const r = await tx.cita.updateMany({ where: { id: c.id, estado: actual.estado, deletedAt: null }, data: { estado: 'completada', completadaEn: new Date() } });
        if (r.count === 0) return false;
        await auditEnTx(tx, {
          citaId: c.id, usuarioId: undefined, accion: 'auto_completar', entidad: 'cita', entidadId: c.id,
          antes: { estado: actual.estado },
          despues: { estado: 'completada', motivo: motivoAuto },
          sedeId: c.sedeId, ip: undefined,
        });
        return true;
      });
      if (!cambiada) continue;

      await sincronizarSesionPaquete(c.id);
      const completa = await getCitaCompleta(c.id);
      const fecha = c.fecha.toISOString().split('T')[0]!;
      emitirEventoCita({ tipo: 'cita:estadoCambiado', sedeId: c.sedeId, fecha, cita: completa as never, cambiadoPor: 'sistema' });
      void dispararWebhooks('appointment.completed', c.sedeId, completa);
      diasAfectados.add(fecha);
      completadas++;
    } catch (e) {
      console.error(`[autocompletar] cita ${c.id} falló:`, e instanceof Error ? e.message : e);
    }
  }

  // Reagregar los KPIs de los días afectados (las completadas cambian los agregados).
  for (const fecha of diasAfectados) {
    // Anclas UTC explícitas (@db.Date vive a medianoche UTC) — no depender de la TZ del proceso.
    const d = new Date(`${fecha}T00:00:00Z`); const h = new Date(`${fecha}T23:59:59Z`);
    agregarRango(d, h).catch(() => {/* silencioso */});
  }
  if (completadas) console.log(`[autocompletar] ${completadas} cita(s) completadas por tiempo (duración+15 / red 90 min)`);
  return completadas;
}

export default router;
