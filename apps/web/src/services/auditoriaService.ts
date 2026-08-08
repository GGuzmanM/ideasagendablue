import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../api/client';
import { sedesApi } from '../api';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  citaId: string | null;
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  sedeId: string | null;
  ip: string | null;
  userAgent: string | null;
  creadoEn: string;
  usuario: { id: string; nombre: string; email: string; rol: string } | null;
  sede: { id: string; nombre: string; color: string } | null;
  cita: {
    id: string;
    horaInicio: string;
    fecha: string;
    paciente: { nombres: string; apellidoPaterno: string };
    servicio: { nombre: string };
    profesional: { nombres: string; apellidos: string } | null;
  } | null;
}

export interface AuditLogsResponse {
  data: AuditLog[];
  /** Mapa { uuid → "Nombre legible" } — resuelto server-side para reemplazar códigos
   *  como sedeId/pacienteId/profesionalId/etc por nombres humanos en el diff. */
  nombresPorId: Record<string, string>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditStats {
  total: number;
  hoy: number;
  usuariosActivos: number;
}

export interface AuditFacetas {
  entidades: string[];
  acciones: string[];
  usuarios: { id: string; nombre: string; rol: string }[];
}

// ── Metadata visual de acciones ──────────────────────────────────────────────
// Empareja substring de la acción con ícono material + colores del pill.
export interface AccionStyle {
  label: string;
  icon: string;
  bg: string; // tailwind bg class
  text: string; // tailwind text class
  border: string; // tailwind border class
  circleBg: string; // ícono redondo para el modal header
}

const ACCION_MATCHERS: { match: RegExp; style: AccionStyle }[] = [
  { match: /login|inicio_sesion/i, style: { label: 'Login',           icon: 'login',        bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200/70', circleBg: 'bg-emerald-600' } },
  // Videos por servicio (van antes de los genéricos crear/editar/correo para ganar el match).
  { match: /video_enviado/i,       style: { label: 'Video enviado',   icon: 'smart_display', bg: 'bg-violet-100', text: 'text-violet-800',  border: 'border-violet-200/70',  circleBg: 'bg-violet-600' } },
  { match: /pausar/i,              style: { label: 'Pausar',          icon: 'pause_circle', bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-200/70',   circleBg: 'bg-amber-600' } },
  { match: /activar/i,             style: { label: 'Activar',         icon: 'play_circle',  bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200/70', circleBg: 'bg-emerald-600' } },
  { match: /excluir/i,             style: { label: 'Excluir correo',  icon: 'unsubscribe',  bg: 'bg-red-100',     text: 'text-red-800',     border: 'border-red-200/70',     circleBg: 'bg-red-600' } },
  { match: /reactivar/i,           style: { label: 'Reactivar correo', icon: 'mark_email_read', bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200/70', circleBg: 'bg-emerald-600' } },
  { match: /crear|registrar/i,     style: { label: 'Crear',           icon: 'add_circle',   bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200/70', circleBg: 'bg-emerald-600' } },
  { match: /mover|reprogramar/i,   style: { label: 'Mover',           icon: 'swap_horiz',   bg: 'bg-blue-100',    text: 'text-blue-800',    border: 'border-blue-200/70',    circleBg: 'bg-blue-600' } },
  { match: /cambiar_estado/i,      style: { label: 'Cambiar estado',  icon: 'autorenew',    bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-200/70',   circleBg: 'bg-amber-600' } },
  { match: /cancelar/i,            style: { label: 'Cancelar',        icon: 'cancel',       bg: 'bg-red-100',     text: 'text-red-800',     border: 'border-red-200/70',     circleBg: 'bg-red-600' } },
  { match: /eliminar|borrar/i,     style: { label: 'Eliminar',        icon: 'delete',       bg: 'bg-red-100',     text: 'text-red-800',     border: 'border-red-300/70',     circleBg: 'bg-red-700' } },
  { match: /recordatorio|correo|mail|reenviar/i, style: { label: 'Correo',    icon: 'mail',    bg: 'bg-violet-100',  text: 'text-violet-800',  border: 'border-violet-200/70',  circleBg: 'bg-violet-600' } },
  { match: /competencia/i,         style: { label: 'Competencia',     icon: 'verified',     bg: 'bg-primary/10',  text: 'text-primary',     border: 'border-primary/30',     circleBg: 'bg-primary' } },
  { match: /excepcion|horario/i,   style: { label: 'Horario',         icon: 'event_repeat', bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-200/70',   circleBg: 'bg-amber-600' } },
  { match: /editar|actualizar|modificar/i, style: { label: 'Editar',  icon: 'edit',         bg: 'bg-primary/10',  text: 'text-primary',     border: 'border-primary/30',     circleBg: 'bg-primary' } },
  { match: /redistribuir/i,        style: { label: 'Redistribuir',    icon: 'shuffle',      bg: 'bg-blue-100',    text: 'text-blue-800',    border: 'border-blue-200/70',    circleBg: 'bg-blue-600' } },
];

/** Devuelve chip + ícono para una acción arbitraria (fallback: neutro). */
export function estiloDeAccion(accion: string): AccionStyle {
  const m = ACCION_MATCHERS.find(r => r.match.test(accion));
  if (m) return m.style;
  return {
    label: accion.replace(/_/g, ' '),
    icon: 'history',
    bg: 'bg-surface-container',
    text: 'text-on-surface-variant',
    border: 'border-outline-variant/50',
    circleBg: 'bg-slate-500',
  };
}

// ── Helpers de presentación ──────────────────────────────────────────────────

const INICIALES_COLORES = ['#e11d48', '#7c3aed', '#0891b2', '#65a30d', '#db2777', '#ea580c', '#f59e0b', '#0284c7'];

/** Iniciales del nombre completo + color determinista para el avatar. */
export function avatarDeUsuario(nombre?: string | null): { iniciales: string; color: string } {
  if (!nombre) return { iniciales: 'SYS', color: '#64748b' };
  const partes = nombre.trim().split(/\s+/);
  const iniciales = partes.length >= 2 ? (partes[0][0] + partes[1][0]) : partes[0].slice(0, 2);
  const hash = [...nombre].reduce((h, c) => h + c.charCodeAt(0), 0);
  const color = INICIALES_COLORES[hash % INICIALES_COLORES.length];
  return { iniciales: iniciales.toUpperCase(), color };
}

/** "hace 3 min", "hace 2 h", "ayer", "23 jul". */
export function tiempoRelativo(iso: string, ahora: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const diff = Math.floor((ahora.getTime() - t) / 1000);
  if (diff < 60) return 'hace unos seg';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ayer';
  return format(new Date(iso), 'd MMM');
}

// Etiqueta legible de la ENTIDAD (columna + título del resumen).
export const ENTIDAD_LABEL: Record<string, string> = {
  cita: 'Cita',
  paciente: 'Paciente',
  profesional: 'Profesional',
  servicio: 'Servicio',
  paquete: 'Paquete',
  paquete_paciente: 'Paquete del paciente',
  sede: 'Sede',
  usuario: 'Usuario',
  promocion: 'Promoción',
  canal: 'Canal',
  subcategoria: 'Subcategoría',
  unidad_negocio: 'Unidad de negocio',
  asignacion_sede: 'Movimiento',
  bloqueo_agenda: 'Bloqueo',
  almuerzo: 'Almuerzo',
  competencia: 'Competencia',
  excepcion_horario: 'Excepción de horario',
  horario_sede: 'Horario de sede',
  rol: 'Rol',
  servicio_video: 'Video de servicio',
  video_supresion: 'Correo excluido de videos',
  video_envio_log: 'Envío de video',
};

/** Etiqueta amigable de la entidad ("Movimiento", "Almuerzo"…) o la cruda si no está mapeada. */
export function etiquetaEntidad(entidad: string): string {
  return ENTIDAD_LABEL[entidad] ?? entidad.replace(/_/g, ' ');
}

// Valores enum traducidos para el diff (momento/unidad de los videos, etc.).
const VALOR_LABEL: Record<string, string> = {
  ANTES: 'Antes', DESPUES: 'Después',
  HORAS: 'Horas', DIAS: 'Días', MESES: 'Meses', ANIOS: 'Años',
};

const UNIDAD_PALABRA: Record<string, string> = { HORAS: 'h', DIAS: 'días', MESES: 'meses', ANIOS: 'años' };
/** "Antes · 24 h", "Después · 2 días" — para el resumen de un video. */
function etiquetaMomentoAudit(momento?: string, valor?: number, unidad?: string): string | undefined {
  if (!momento) return undefined;
  const m = momento === 'ANTES' ? 'Antes' : 'Después';
  if (valor && unidad) return `${m} · ${valor} ${UNIDAD_PALABRA[unidad] ?? unidad.toLowerCase()}`;
  return m;
}

/**
 * Resumen humano de la acción (una línea). Usa `nombresPorId` (resuelto server-side)
 * para mostrar nombres en vez de UUIDs — incluido el entidadId principal del log.
 */
export function resumenLog(log: AuditLog, nombresPorId: Record<string, string> = {}): { titulo: string; subtitulo?: string } {
  const contexto = (log.despues || log.antes || {}) as Record<string, unknown>;
  const etiqueta = etiquetaEntidad(log.entidad);

  // Login / Inicio de sesión
  if (log.accion.toLowerCase().includes('login') || (log.entidad === 'usuario' && log.accion.toUpperCase() === 'LOGIN')) {
    const usrNombre = log.usuario?.nombre || (contexto.nombre as string) || 'Usuario';
    const email = log.usuario?.email || (contexto.email as string);
    const rol = log.usuario?.rol || (contexto.rol as string);
    const subtitulo = [email, rol].filter(Boolean).join(' · ');
    return {
      titulo: `Inicio de sesión · ${usrNombre}`,
      subtitulo: subtitulo || undefined,
    };
  }

  // Cita — se muestra con datos del paciente (join server-side).
  if (log.entidad === 'cita' && log.cita) {
    const p = log.cita.paciente;
    const nombrePac = `${p.nombres} ${p.apellidoPaterno}`;
    const hora = log.cita.horaInicio;
    const prof = log.cita.profesional ? `${log.cita.profesional.nombres.split(' ')[0]}` : null;
    const servicio = log.cita.servicio?.nombre;
    const subtitulo = [servicio, prof].filter(Boolean).join(' · ');
    return { titulo: `Cita de ${nombrePac} · ${hora}`, subtitulo };
  }

  // Almuerzo / bloqueo — resuelve la profesional del payload y muestra la hora.
  if (log.entidad === 'almuerzo' || log.entidad === 'bloqueo_agenda') {
    const profId = contexto.profesionalId as string | undefined;
    const profNombre = profId ? nombresPorId[profId] : undefined;
    const hora = contexto.horaInicio as string | undefined;
    return {
      titulo: profNombre ? `${etiqueta} de ${profNombre}` : etiqueta,
      subtitulo: hora ? `${hora}${contexto.horaFin ? ` – ${contexto.horaFin}` : ''}` : undefined,
    };
  }

  // Excepción de horario — sede + fecha + estado (abierto/cerrado).
  if (log.entidad === 'excepcion_horario') {
    const sedeNombre = log.sede?.nombre;
    const fecha = contexto.fecha as string | undefined;
    const abierto = contexto.abierto as boolean | undefined;
    const estado = abierto === false ? 'Cerrado' : abierto === true ? `${contexto.horaApertura ?? ''}–${contexto.horaCierre ?? ''}` : '';
    return {
      titulo: sedeNombre ? `Excepción · ${sedeNombre}` : 'Excepción de horario',
      subtitulo: [fecha, estado, contexto.nota as string | undefined].filter(Boolean).join(' · ') || undefined,
    };
  }

  // Cambio del horario base de la sede.
  if (log.entidad === 'horario_sede') {
    const sedeNombre = nombresPorId[log.entidadId] || log.sede?.nombre;
    return { titulo: sedeNombre ? `Horario · ${sedeNombre}` : 'Horario de sede', subtitulo: 'Horario semanal actualizado' };
  }

  // Movimiento (asignacion_sede) — profesional + sede destino.
  if (log.entidad === 'asignacion_sede') {
    const profId = contexto.profesionalId as string | undefined;
    const sedeId = contexto.sedeId as string | undefined;
    const profNombre = profId ? nombresPorId[profId] : undefined;
    const sedeNombre = sedeId ? nombresPorId[sedeId] : undefined;
    return {
      titulo: profNombre ? `Movimiento de ${profNombre}` : 'Movimiento',
      subtitulo: sedeNombre ? `→ ${sedeNombre}` : (contexto.motivo as string | undefined),
    };
  }

  // Video de servicio (crear/editar/pausar/activar/eliminar).
  if (log.entidad === 'servicio_video') {
    const titulo = nombresPorId[log.entidadId] || (contexto.tituloVideo as string) || 'Video';
    const servicioNombre = contexto.servicioId ? nombresPorId[contexto.servicioId as string] : undefined;
    const mom = etiquetaMomentoAudit(contexto.momento as string | undefined, contexto.offsetValor as number | undefined, contexto.offsetUnidad as string | undefined);
    return { titulo: `Video · ${titulo}`, subtitulo: [servicioNombre, mom].filter(Boolean).join(' · ') || undefined };
  }

  // Correo excluido / reactivado de la lista de videos.
  if (log.entidad === 'video_supresion') {
    const email = (contexto.email as string) || nombresPorId[log.entidadId] || 'correo';
    const reactivado = log.accion.toLowerCase().includes('reactivar');
    return { titulo: `${reactivado ? 'Correo reactivado' : 'Correo excluido'} · ${email}`, subtitulo: (contexto.motivo as string) || undefined };
  }

  // Envío de video a un paciente (automático o manual).
  if (log.entidad === 'video_envio_log') {
    const nombrePac = log.cita ? `${log.cita.paciente.nombres.split(' ')[0]} ${log.cita.paciente.apellidoPaterno}` : (contexto.destinatario as string) || 'paciente';
    const manual = log.accion.toLowerCase().includes('manual');
    const mom = (contexto.momento as string) === 'ANTES' ? 'Antes' : (contexto.momento as string) === 'DESPUES' ? 'Después' : undefined;
    const veces = contexto.vecesEnviado as number | undefined;
    return {
      titulo: `Video enviado a ${nombrePac}`,
      subtitulo: [mom, manual ? 'envío manual' : 'envío automático', veces ? `${veces}° envío` : undefined].filter(Boolean).join(' · ') || undefined,
    };
  }

  // Resto (profesional/servicio/paquete/sede/etc): usa el nombre del entidadId.
  const nombreEntidad =
    nombresPorId[log.entidadId] ||
    (contexto.nombre as string) ||
    (contexto.titulo as string) ||
    null;
  if (nombreEntidad) return { titulo: `${etiqueta} · ${nombreEntidad}` };
  return { titulo: `${etiqueta} · ${log.entidadId.slice(0, 8)}…` };
}

/**
 * Formatea la IP para mostrar. Las loopback (`::1`, `127.0.0.1`, IPv4-mapped)
 * significan "la petición vino desde la propia máquina servidor" → se muestran
 * como "Servidor local" para que no se confundan con una IP real de la LAN.
 */
export function formatIp(ip?: string | null): { texto: string; esLocal: boolean } {
  if (!ip) return { texto: '—', esLocal: false };
  const limpia = ip.replace(/^::ffff:/, '');
  if (limpia === '::1' || limpia === '127.0.0.1' || ip === '::1') {
    return { texto: 'Servidor local', esLocal: true };
  }
  return { texto: limpia, esLocal: false };
}

/** Parsea el userAgent en algo legible (Chrome 141 · macOS). */
export function parseUserAgent(ua?: string | null): string {
  if (!ua) return '—';
  let browser = 'Navegador';
  const chr = ua.match(/Chrome\/(\d+)/);
  const fir = ua.match(/Firefox\/(\d+)/);
  const saf = ua.match(/Version\/(\d+).*Safari/);
  if (chr) browser = `Chrome ${chr[1]}`;
  else if (fir) browser = `Firefox ${fir[1]}`;
  else if (saf) browser = `Safari ${saf[1]}`;

  let os = '';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';

  return os ? `${browser} · ${os}` : browser;
}

export interface DiffRow {
  campo: string;
  antes: unknown;
  despues: unknown;
  tipo: 'add' | 'remove' | 'change';
}

// ── Nombres legibles (Alias) para los campos técnicos ─────────────────────────
export const CAMPO_LABEL: Record<string, string> = {
  id: 'ID',
  sedeId: 'Sede',
  pacienteId: 'Paciente',
  profesionalId: 'Profesional',
  servicioId: 'Servicio',
  subcategoriaId: 'Subcategoría',
  unidadNegocioId: 'Unidad de negocio',
  solicitadoProfesionalId: 'Profesional solicitado',
  creadoPorUsuarioId: 'Creado por',
  creadoPor: 'Creado por',
  createdBy: 'Creado por',
  usuarioId: 'Usuario',
  paqueteId: 'Paquete',
  paquetePacienteId: 'Paquete del paciente',
  promocionId: 'Promoción',
  canalId: 'Canal',
  citaId: 'Cita',
  creadoEn: 'Creado',
  actualizadoEn: 'Actualizado',
  deletedAt: 'Eliminado',
  fecha: 'Fecha',
  horaInicio: 'Hora de inicio',
  horaFin: 'Hora de fin',
  duracionMinutos: 'Duración (min)',
  estado: 'Estado',
  estadoConfirmacion: 'Estado confirmación',
  confirmacionEnviadaEn: 'Confirmación enviada',
  confirmadaEn: 'Confirmado el',
  canal: 'Canal',
  origenAsignacion: 'Origen de asignación',
  sesionConsumida: 'Sesión consumida',
  sesionExonerada: 'Sesión no descontada',
  sesionExoneradaMotivo: 'Motivo de no descuento',
  sesionNumero: 'N° de sesión',
  consultorioNumero: 'Consultorio',
  comprobanteUrl: 'Comprobante',
  idempotencyKey: 'Clave de idempotencia',
  observaciones: 'Observaciones',
  comentarios: 'Comentarios',
  nota: 'Nota',
  motivo: 'Motivo',
  motivoCancelacion: 'Motivo de cancelación',
  monto: 'Monto',
  precio: 'Precio',
  descuento: 'Descuento',
  precioFinal: 'Precio final',
  activo: 'Activo',
  nombre: 'Nombre',
  nombres: 'Nombres',
  apellidoPaterno: 'Apellido paterno',
  apellidoMaterno: 'Apellido materno',
  email: 'Correo electrónico',
  telefono: 'Teléfono',
  documento: 'N° Documento',
  tipoDocumento: 'Tipo documento',
  fechaNacimiento: 'Fecha de nacimiento',
  genero: 'Género',
  direccion: 'Dirección',
  distrito: 'Distrito',
  color: 'Color',
  rol: 'Rol',
  orden: 'Orden',
  etiqueta: 'Etiqueta',
  valor: 'Valor',
  // Videos por servicio
  servicioVideoId: 'Video',
  youtubeVideoId: 'ID de YouTube',
  youtubeUrl: 'Enlace de YouTube',
  tituloVideo: 'Título del video',
  titulo: 'Título',
  asunto: 'Asunto del correo',
  cuerpoTexto: 'Texto del correo',
  momento: 'Momento',
  offsetValor: 'Tiempo (valor)',
  offsetUnidad: 'Tiempo (unidad)',
  destinatario: 'Destinatario',
  resendEmailId: 'ID de correo (Resend)',
  vecesEnviado: 'Veces enviado',
  enviadoManualPor: 'Enviado manualmente por',
  enviosCancelados: 'Envíos cancelados',
  soloPorSolicitud: 'Solo por solicitud',
};

/** Devuelve la etiqueta amigable del campo (o una versión limpia en Title Case si no está mapeado). */
export function etiquetaCampo(campo: string): string {
  if (CAMPO_LABEL[campo]) return CAMPO_LABEL[campo];

  // Si termina en Id/ID y tiene longitud > 2, limpiar el sufijo Id
  let limpio = campo.replace(/Id$/i, '');

  // Convertir camelCase (ej: origenAsignacion) a separado por espacios: "Origen asignacion"
  limpio = limpio.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

  // Primera letra en mayúscula
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renderiza un valor del diff. Si es un UUID conocido (está en `nombresPorId`),
 * reemplaza por el nombre humano. Si es una fecha ISO, la formatea como dd/MM/yyyy - HH:mm.
 * Si es null o undefined, devuelve '—'.
 */
export function renderValor(v: unknown, nombresPorId: Record<string, string>): string {
  if (v === undefined || v === null) return '—';
  if (v instanceof Date) return format(v, 'dd/MM/yyyy - HH:mm');
  if (typeof v === 'string') {
    // Si coincide con patrón de fecha ISO (ej: 2026-08-03T13:54:47.207Z o 2026-08-03)
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(v) && !isNaN(Date.parse(v))) {
      try {
        const d = new Date(v);
        if (v.includes('T')) {
          return format(d, 'dd/MM/yyyy - HH:mm');
        }
        return format(new Date(v + 'T00:00:00'), 'dd/MM/yyyy');
      } catch {
        // fallback en caso de error de fecha
      }
    }
    // Si es un UUID conocido
    if (UUID_RE.test(v)) {
      return nombresPorId[v] ?? v;
    }
    // Enums conocidos (momento/unidad de videos, etc.) → palabra legible.
    if (VALOR_LABEL[v]) return VALOR_LABEL[v];
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return JSON.stringify(v);
}

/** Compara `antes` vs `despues` y devuelve un array de rows para la tabla diff. */
export function calcularDiff(antes: Record<string, unknown> | null, despues: Record<string, unknown> | null): DiffRow[] {
  const rows: DiffRow[] = [];
  const claves = new Set([...Object.keys(antes ?? {}), ...Object.keys(despues ?? {})]);
  for (const k of claves) {
    const a = antes?.[k];
    const d = despues?.[k];

    // Omitir si ambos son nulos o indefinidos
    if ((a === null || a === undefined) && (d === null || d === undefined)) continue;

    // Omitir campos que nacen con null en despues (ruido de esquema Prisma al crear registros)
    if (a === undefined && d === null) continue;

    const jsonA = JSON.stringify(a);
    const jsonD = JSON.stringify(d);
    if (jsonA === jsonD) continue;

    // Si ambos valores se renderizan exactamente igual (ej: '—'), omitir la fila
    const renderA = renderValor(a, {});
    const renderD = renderValor(d, {});
    if (renderA === renderD) continue;

    if (a === undefined) rows.push({ campo: k, antes: undefined, despues: d, tipo: 'add' });
    else if (d === undefined || d === null) rows.push({ campo: k, antes: a, despues: d, tipo: 'remove' });
    else rows.push({ campo: k, antes: a, despues: d, tipo: 'change' });
  }
  return rows;
}

// ── Hook principal ───────────────────────────────────────────────────────────
export function useAuditoriaData() {
  const hoy = format(new Date(), 'yyyy-MM-dd');
  const hace7 = format(new Date(Date.now() - 7 * 86_400_000), 'yyyy-MM-dd');

  const [desde, setDesde] = useState(hace7);
  const [hasta, setHasta] = useState(hoy);
  const [entidad, setEntidad] = useState('');
  const [accion, setAccion] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  const params: Record<string, string> = { desde, hasta, page: String(page), limit: String(limit) };
  if (entidad) params.entidad = entidad;
  if (accion) params.accion = accion;
  if (usuarioId) params.usuarioId = usuarioId;
  if (sedeId) params.sedeId = sedeId;
  if (q.trim()) params.q = q.trim();

  const { data: logsResp, isLoading } = useQuery<AuditLogsResponse>({
    queryKey: ['audit', params],
    queryFn: () => api.get<AuditLogsResponse>('/audit', params),
  });

  const { data: stats } = useQuery<AuditStats>({
    queryKey: ['audit-stats'],
    queryFn: () => api.get<AuditStats>('/audit/stats'),
    refetchInterval: 30_000,
  });

  const { data: facetas } = useQuery<AuditFacetas>({
    queryKey: ['audit-facetas'],
    queryFn: () => api.get<AuditFacetas>('/audit/facetas'),
    staleTime: 5 * 60_000,
  });

  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });

  // Reset a página 1 cuando cambia cualquier filtro (excepto page).
  const resetPage = () => setPage(1);

  const nombresPorId = logsResp?.nombresPorId ?? {};

  return {
    nombresPorId,
    // Filtros + setters
    desde, setDesde: (v: string) => { setDesde(v); resetPage(); },
    hasta, setHasta: (v: string) => { setHasta(v); resetPage(); },
    entidad, setEntidad: (v: string) => { setEntidad(v); resetPage(); },
    accion, setAccion: (v: string) => { setAccion(v); resetPage(); },
    usuarioId, setUsuarioId: (v: string) => { setUsuarioId(v); resetPage(); },
    sedeId, setSedeId: (v: string) => { setSedeId(v); resetPage(); },
    q, setQ: (v: string) => { setQ(v); resetPage(); },
    page, setPage,
    // Data
    logs: logsResp?.data ?? [],
    total: logsResp?.total ?? 0,
    totalPages: logsResp?.totalPages ?? 0,
    limit,
    isLoading,
    stats,
    facetas,
    sedes: sedes ?? [],
    // Helpers (re-exportados para conveniencia)
    resetFiltros: () => {
      setDesde(hace7); setHasta(hoy); setEntidad(''); setAccion('');
      setUsuarioId(''); setSedeId(''); setQ(''); setPage(1);
    },
    // Estado derivado: hay algún filtro activo (más allá del rango de fechas por defecto)
    hayFiltroActivo: useMemo(
      () => Boolean(entidad || accion || usuarioId || sedeId || q.trim()),
      [entidad, accion, usuarioId, sedeId, q],
    ),
  };
}
