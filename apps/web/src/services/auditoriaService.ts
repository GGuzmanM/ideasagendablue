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

/** Resumen humano de la acción sobre la cita (una línea). */
export function resumenLog(log: AuditLog): { titulo: string; subtitulo?: string } {
  // Cita
  if (log.entidad === 'cita' && log.cita) {
    const p = log.cita.paciente;
    const nombrePac = `${p.nombres} ${p.apellidoPaterno}`;
    const hora = log.cita.horaInicio;
    const prof = log.cita.profesional ? `${log.cita.profesional.nombres.split(' ')[0]}` : null;
    const servicio = log.cita.servicio?.nombre;
    const subtitulo = [servicio, prof].filter(Boolean).join(' · ');
    return { titulo: `Cita de ${nombrePac} · ${hora}`, subtitulo };
  }
  // Otros — recurro al despues/antes si trae "nombre"
  const contexto = (log.despues || log.antes || {}) as Record<string, unknown>;
  const nombre = (contexto.nombre as string) || (contexto.titulo as string) || null;
  if (nombre) return { titulo: `${log.entidad} · ${nombre}` };
  return { titulo: `${log.entidad} · ${log.entidadId.slice(0, 8)}…` };
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

// ── Diff antes/después ───────────────────────────────────────────────────────
export interface DiffRow {
  campo: string;
  antes: unknown;
  despues: unknown;
  tipo: 'add' | 'remove' | 'change';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renderiza un valor del diff. Si es un UUID conocido (está en `nombresPorId`),
 * reemplaza por el nombre humano. Si no, devuelve el JSON del valor. Placeholder
 * '—' para valores ausentes.
 */
export function renderValor(v: unknown, nombresPorId: Record<string, string>): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string' && UUID_RE.test(v)) {
    return nombresPorId[v] ?? v;
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
    const jsonA = JSON.stringify(a);
    const jsonD = JSON.stringify(d);
    if (jsonA === jsonD) continue;
    if (a === undefined) rows.push({ campo: k, antes: undefined, despues: d, tipo: 'add' });
    else if (d === undefined) rows.push({ campo: k, antes: a, despues: undefined, tipo: 'remove' });
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
