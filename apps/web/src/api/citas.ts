import { api } from './client';
import type { EstadoPago } from '../utils/estadoPago';
import type { AlertaPaciente } from '../components/pacientes/RomboAlerta';
import type { FamiliarPaciente } from '../components/pacientes/CuadroFamiliares';

// Entrada del hilo append-only de comentarios de una cita.
export interface ComentarioCita {
  id: string;
  texto: string;
  creadoEn: string;
  autorEtiqueta: string | null;
  autor: { id: string; nombre: string } | null;
  // Corrección (30-sep-2026): cuándo y quién lo editó. null = nunca editado.
  editadoEn?: string | null;
  editadoPor?: { id: string; nombre: string } | null;
}

export interface TiempoTratamientoCita {
  id: string;
  estado: 'en_curso' | 'finalizado' | 'sin_fin';
  inicioEn: string;
  finEn: string | null;
  duracionSegundos: number | null;
  consultorioNumero: number;
  horaAproximada: boolean;
  origen: 'dispositivo' | 'manual';
}

export interface CitaResumen {
  id: string;
  pacienteId: string;
  paciente: {
    id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string;
    tipoDocumento?: string; numeroDocumento?: string; telefono: string;
    email?: string | null; fechaNacimiento?: string | null;
    // Bandera "actualizar datos" calculada server-side (toggle del popover).
    requiereActualizacionDatos?: boolean;
    alerta?: AlertaPaciente | null; familiares?: FamiliarPaciente[] | null;
  };
  profesionalId: string | null;
  profesional: { id: string; nombres: string; apellidos: string; colorAvatar: string } | null;
  solicitadoProfesional?: { id: string; nombres: string; apellidos: string; tipo: string } | null;
  // Columna «Adicional»: podóloga que realmente atendió (informativo; no ocupa su agenda).
  atendidoPor?: { id: string; nombres: string; apellidos: string } | null;
  // Médico de la cita (podología): lo toma el propio médico o lo asigna coordinación. La receta
  // médica de la atención sale a su nombre y con su CMP.
  medicoId?: string | null;
  medico?: { id: string; nombres: string; apellidos: string; colegiatura?: string | null } | null;
  medicoAsignadoEn?: string | null;
  // Consentimientos que el tratamiento exige y el paciente aún no firmó (aviso en la tarjeta).
  consentimientosPendientes?: { id: string; clave: string | null; nombre: string }[];
  sedeId: string;
  // `consultorios`: nº de consultorios de la sede (selector C1..CN; 0 = no numera consultorios).
  sede: { id: string; nombre: string; color: string; consultorios?: number };
  unidadNegocioId: string;
  unidadNegocio: { id: string; nombre: string; color: string };
  servicioId: string;
  servicio: { id: string; nombre: string; duracionMinutos: number; color: string };
  // Subcategoría elegida (ej. Profilaxis → Regular/Premium/…). null si el servicio no tiene.
  subcategoriaId?: string | null;
  subcategoria?: { id: string; nombre: string } | null;
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  estado: string;
  // Timestamps del flujo (para medir tiempos): llegó, en atención, completada.
  llegoEn?: string | null;
  enAtencionEn?: string | null;
  completadaEn?: string | null;
  // Aparato del consultorio: el tiempo REAL vigente del tratamiento (máx 1; botones INICIO/FIN).
  tiemposTratamiento?: TiempoTratamientoCita[];
  canal: string;
  origenAsignacion: string | null;
  // Bloque combinado: null = cita individual; si != null pertenece a un bloque de 2
  // citas (profilaxis ancla + extra) que comparten slot. `slotRol` distingue cuál es.
  slotGrupoId: string | null;
  slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null;
  comentarios: ComentarioCita[];
  paquetePaciente: { id: string; sesionesTotal: number; sesionesUsadas: number; paquete: { nombre: string } } | null;
  // Promoción de la cita. En un bloque combinado vive solo en la PRINCIPAL (profilaxis); la
  // SECUNDARIO la recibe como `promocionHeredada` (solo lectura).
  promocion: { id: string; nombre: string; tipo: 'PRECIO_FIJO' | 'PORCENTAJE' | 'OTRO'; valor: number | null } | null;
  promocionHeredada?: { id: string; nombre: string; tipo: 'PRECIO_FIJO' | 'PORCENTAJE' | 'OTRO'; valor: number | null } | null;
  // Última reprogramación a OTRO día (derivada del audit del `mover`), para el banner del modal.
  reprogramacion?: { deFecha: string; deHora: string | null; aFecha: string; aHora: string | null; por: string; en: string } | null;
  sesionNumero: number | null;
  sesionConsumida?: boolean;
  // "No aplicar / no descontar" (ej. láser no aplicado): la cita no consume su sesión.
  sesionExonerada?: boolean;
  sesionExoneradaMotivo?: string | null;
  consultorioNumero: number | null;
  comprobanteUrl: string | null;
  comprobanteNombre: string | null;
  comprobanteMimeType: string | null;
  comprobanteSubidoEn: string | null;
  estadoConfirmacion: 'pendiente' | 'confirmada' | 'cancelada';
  confirmacionEnviadaEn: string | null;
  confirmadaEn: string | null;
  creadoPorUsuario: { id: string; nombre: string } | null;
  creadoEn: string;
  actualizadoEn: string;
  // Motivo si la cita se registró retroactivamente (fecha pasada). null = cita normal. El flag
  // "retroactiva" se DERIVA comparando `fecha` con el día de `creadoEn`.
  motivoRetroactivo?: string | null;
  // PAGADA (29-sep-2026): recepción valida si ya está pagada; quién y cuándo la marcó.
  pagada?: boolean;
  estadoPago?: EstadoPago; // pendiente / incompleto / completo (manda sobre `pagada`)
  pagadaEn?: string | null;
  pagadaPor?: { id: string; nombre: string } | null;
  // REBOTE (30-sep-2026): abierto = estado 'reprogramada' + reboteDesde + sin reboteCerradoEn (ver api/rebote.ts).
  reboteDesde?: string | null;
  reboteVenceEl?: string | null;
  reboteMotivo?: string | null;
  reboteEstadoOrigen?: string | null;
  reboteTurno?: 'manana' | 'tarde' | 'cualquiera' | null;
  reboteLlamarDesde?: string | null;
  reboteCerradoEn?: string | null;
  reboteResultado?: string | null;
  rebotePor?: { id: string; nombre: string } | null;
}

export interface CrearCitaInput {
  pacienteId: string;
  profesionalId?: string | null;
  solicitadoProfesionalId?: string | null; // baro: médico "por solicitud" que atiende esta cita
  sedeId: string;
  unidadNegocioId: string;
  servicioId: string;
  subcategoriaId?: string | null; // obligatoria si el servicio tiene subcategorías
  fecha: string;
  horaInicio: string;
  canal?: string;
  comentarioRecepcion?: string;
  paquetePacienteId?: string;
  // Adjudicación manual de sesión (solo paquetes de origen Genexis)
  sesionNumeroManual?: number;
  promocionId?: string | null;
  codigoPromo?: string;
  comprobanteUrl?: string;
  comprobanteNombre?: string;
  comprobanteMimeType?: string;
  motivoRetroactivo?: string; // obligatorio si `fecha` es anterior a hoy (cita retroactiva)
  pagada?: boolean; // (anterior) ya está pagada al agendar
  estadoPago?: EstadoPago; // estado de pago al agendar (por defecto: pendiente)
}

// Agendamiento de un bloque combinado: ancla (profilaxis) + un servicio extra.
export interface CrearCitaCombinadaInput {
  pacienteId: string;
  profesionalId?: string; // opcional: si no viene, el backend asigna automáticamente
  sedeId: string;
  unidadNegocioId: string;
  servicioId: string; // el ancla configurada (profilaxis)
  subcategoriaId?: string | null; // subcategoría del ancla (profilaxis)
  fecha: string;
  horaInicio: string;
  canal?: string;
  comentarioRecepcion?: string;
  paquetePacienteId?: string;
  promocionId?: string | null; // promo del BLOQUE (la guarda el backend en la PRINCIPAL)
  codigoPromo?: string;
  motivoRetroactivo?: string; // obligatorio si `fecha` es anterior a hoy (bloque retroactivo)
  pagada?: boolean; // (anterior)
  estadoPago?: EstadoPago; // el bloque se paga junto: va en las dos citas
  comprobanteUrl?: string; // comprobante de pago del bloque (se guarda en la principal)
  comprobanteNombre?: string;
  comprobanteMimeType?: string;
  extra: {
    servicioId: string;
    subcategoriaId?: string; // obligatoria si el servicio extra tiene subcategorías (p. ej. Extracción de Uñero)
    profesionalId?: string; // default: misma profesional del ancla
    paquetePacienteId?: string;
    comentarioRecepcion?: string;
  };
}

export interface RespuestaCombinada {
  slotGrupoId: string;
  ancla: CitaResumen;
  extra: CitaResumen;
}

// Bloque "fantasma" de ocupación externa: una cita de OTRA unidad (ej. Baropodometría)
// que ocupa el tiempo de un profesional que sí tiene columna en la vista actual.
export interface OcupacionExterna {
  citaId: string;
  profesionalOcupadoId: string; // el profesional cuyo tiempo se ocupa (→ su columna)
  horaInicio: string;
  duracionMinutos: number;
  estado: string;
  pacienteNombre: string;
  servicioNombre: string;
  unidadNegocio: { id: string; nombre: string; color: string };
  enColumna: string; // dónde ocurre físicamente (ej. "Baro 1")
  sedeNombre?: string; // presente = la cita es de OTRA sede (misma persona en 2 sedes, p. ej. el dermatólogo)
  enOtraColumna?: boolean; // misma unidad: pedida «Solo X», la cita está en la columna `enColumna`
}

// Ocupación de un profesional en la sede/fecha (una entrada por cita que lo ocupa).
export interface OcupacionDia {
  profesionalId: string;
  citaId: string;
  horaInicio: string;
  duracionMinutos: number;
  unidad: string;
}

export const citasApi = {
  // `hasta`: rango fecha..hasta (Visor de Pacientes; solo admin y auditor de médicos).
  // `todas: '1'` (Visor de Pacientes, 23-oct-2026): sin filtro de sede — solo administración y el auditor de médicos.
  listar: (params: { sedeId?: string; fecha?: string; hasta?: string; unidadNegocioId?: string; profesionalId?: string; todas?: '1' }) =>
    api.get<CitaResumen[]>('/citas', params as Record<string, string>),

  // Ocupaciones de otras unidades para pintar bloques fantasma en la agenda.
  ocupacionExterna: (params: { sedeId: string; fecha: string; unidadNegocioId: string }) =>
    api.get<OcupacionExterna[]>('/citas/ocupacion-externa', params as Record<string, string>),

  // Ocupación de todos los profesionales en una sede/fecha (todas las unidades).
  // La usa el modal Nueva Cita para avisar "ya ocupado a las HH:MM".
  ocupacionDia: (params: { sedeId: string; fecha: string }) =>
    api.get<OcupacionDia[]>('/citas/ocupacion-dia', params as Record<string, string>),

  obtener: (id: string) =>
    api.get<CitaResumen>(`/citas/${id}`),

  crear: (data: CrearCitaInput, idempotencyKey?: string) =>
    api.post<CitaResumen>('/citas', data, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),

  // Bloque combinado (profilaxis + extra). SIN optimistic UI: las 2 citas aparecen
  // o fallan juntas; el caller refresca tras la respuesta del server.
  crearCombinada: (data: CrearCitaCombinadaInput) =>
    api.post<RespuestaCombinada>('/citas/combinada', data),

  // `soloEsta`: en un bloque combinado, avanza SOLO esta cita (no cascadea al hermano).
  // Lo usa el flujo secuencial de 2 tratamientos. Sin él, el bloque se mueve junto (default).
  // `forzar` (solo admin): cancelar / «no vino» aunque la atención clínica tenga registros.
  cambiarEstado: (id: string, estado: string, comentario?: string, motivoCancelacion?: string, soloEsta?: boolean, forzar?: boolean) =>
    api.patch<CitaResumen>(`/citas/${id}/estado`, { estado, comentario, motivoCancelacion, soloEsta, forzar }),

  // elegirEquipo: baro en sede con 2+ máquinas → respetar la máquina elegida (si no, el servidor elige una libre).
  mover: (id: string, data: { profesionalId?: string | null; fecha: string; horaInicio: string; origenAsignacion?: string; elegirEquipo?: boolean }) =>
    api.patch<CitaResumen>(`/citas/${id}/mover`, data),

  // Mueve un bloque combinado COMPLETO (ambas citas) atómicamente a otro horario/profesional.
  moverGrupo: (slotGrupoId: string, data: { profesionalId?: string | null; fecha: string; horaInicio: string; origenAsignacion?: string }) =>
    api.patch<CitaResumen>(`/citas/grupo/${slotGrupoId}/mover`, data),

  actualizarConsultorio: (id: string, consultorioNumero: number | null) =>
    api.patch<CitaResumen>(`/citas/${id}/consultorio`, { consultorioNumero }),
  // Solo citas de una columna «Adicional»: qué podóloga la atendió de verdad (null = sin especificar).
  asignarAtendidoPor: (id: string, profesionalId: string | null) =>
    api.patch<CitaResumen>(`/citas/${id}/atendido-por`, { profesionalId }),

  // Intercambiar dos pacientes entre podólogas (mismo día y sede): cada cita queda en el lugar de la otra.
  intercambiar: (citaIdA: string, citaIdB: string) =>
    api.post<{ a: CitaResumen; b: CitaResumen }>('/citas/intercambiar', { citaIdA, citaIdB }),

  // Cambiar tratamiento (servicio) y/o subcategoría: agendada/confirmada/llegó (admin: siempre). El servidor valida todo.
  cambiarTratamiento: (id: string, data: { servicioId: string; subcategoriaId: string | null }) =>
    api.patch<CitaResumen>(`/citas/${id}/tratamiento`, data),

  // Agregar/editar el comentario de recepción en cualquier estado (antes, durante o después).
  actualizarComentario: (id: string, comentario: string) =>
    api.patch<CitaResumen>(`/citas/${id}/comentario`, { comentario }),
  // Corregir un comentario: el autor los suyos, admin cualquiera (el servidor lo exige).
  editarComentario: (citaId: string, comentarioId: string, texto: string) =>
    api.patch<CitaResumen>(`/citas/${citaId}/comentarios/${comentarioId}`, { texto }),

  // Canal de reserva (de dónde viene el cliente).
  actualizarCanal: (id: string, canal: string) =>
    api.patch<CitaResumen>(`/citas/${id}/canal`, { canal }),

  // PAGADA: marcar o desmarcar (en un bloque combinado se marcan las dos).
  marcarPagada: (id: string, pagada: boolean) =>
    api.patch<CitaResumen>(`/citas/${id}/pagada`, { pagada }),
  // Comprobante de pago: adjuntar / reemplazar (el archivo ya subido con /citas/upload-comprobante) o quitar (null).
  actualizarComprobante: (id: string, comprobante: { url: string; nombre?: string; mimeType?: string } | null) =>
    api.patch<CitaResumen>(`/citas/${id}/comprobante`, comprobante ?? { url: null }),
  // Estado de pago: pendiente / incompleto / completo (en un bloque combinado cambian las dos).
  cambiarEstadoPago: (id: string, estadoPago: EstadoPago) =>
    api.patch<CitaResumen>(`/citas/${id}/pago`, { estadoPago }),

  // Promoción de la cita (el backend la escribe en la portadora del bloque si aplica).
  actualizarPromocion: (id: string, promocionId: string | null) =>
    api.patch<CitaResumen>(`/citas/${id}/promocion`, { promocionId }),

  // Envía/reenvía el correo de confirmación de una cita.
  confirmarPorCorreo: (id: string) =>
    api.post<{ ok: boolean; to: string }>(`/citas/${id}/confirmar-mail`),

  // Reporta enfermedad/ausencia de un profesional un día: cancela en lote sus citas
  // activas del rango y crea el bloqueo, en una sola transacción. Devuelve la lista de
  // pacientes afectados para contactarlos.
  // `fechaFin` opcional (02-oct-2026): el mismo horario cada día del rango [fecha, fechaFin], máx 31 días.
  reportarEnfermedad: (data: { profesionalId: string; sedeId: string; fecha: string; fechaFin?: string; horaInicio?: string; horaFin?: string; motivo?: string }) =>
    api.post<{
      ok: boolean;
      bloqueoId: string;
      profesional: string;
      citasCanceladas: number;
      dias?: number;
      pacientes: { fecha?: string; horaInicio: string; estado: string; servicio: string; paciente: string; telefono: string }[];
    }>('/citas/reportar-enfermedad', data),

  stats: (sedeId: string, fecha: string) =>
    api.get<{ total: number; confirmadas: number; llegaron: number; noShows: number; completadas: number; ocupacion: number }>(
      `/citas/sede/${sedeId}/stats`, { fecha }
    ),
};
