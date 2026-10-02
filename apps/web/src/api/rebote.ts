import { api } from './client';

// Rebote (30-sep-2026): citas que salieron de la agenda para volver a llamar al paciente.
// Por ahora solo el rol admin (el servidor responde 403 al resto). Reagendar = citasApi.mover / moverGrupo.

export type TurnoRebote = 'manana' | 'tarde' | 'cualquiera';
export type ResultadoLlamada = 'contesto' | 'no_contesto' | 'pidio_llamar_luego' | 'otro';

export interface CitaEnRebote {
  id: string;
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  slotGrupoId: string | null;
  canal: string;
  reboteDesde: string;
  reboteVenceEl: string;
  reboteMotivo: string | null;
  reboteEstadoOrigen: string | null;
  reboteTurno: TurnoRebote | null;
  reboteLlamarDesde: string | null;
  paciente: { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string; numeroDocumento: string; telefono: string; email: string | null };
  servicio: { id: string; nombre: string };
  servicioExtra: string | null;
  sede: { id: string; nombre: string };
  unidadNegocio: { id: string; nombre: string; color: string };
  medicoPedidoNombre: string | null; // baro «Solo X»: el médico pedido (la cita va en una máquina)
  rebotePor: { id: string; nombre: string } | null;
  profesionalNombre: string | null;
  diasEnEspera: number;
  diasParaVencer: number;
  llamadas: number;
  ultimaLlamada: { resultado: ResultadoLlamada; nota: string | null; creadoEn: string; usuario: { nombre: string } | null } | null;
}

export interface LlamadaRebote {
  id: string;
  resultado: ResultadoLlamada;
  nota: string | null;
  creadoEn: string;
  usuario: { id: string; nombre: string } | null;
}

/** Rebote ABIERTO: la cita salió de la agenda y espera que la reagenden (misma regla que el servidor). */
export function citaEnRebote(c: { estado?: string | null; reboteDesde?: string | null; reboteCerradoEn?: string | null }): boolean {
  return (c.estado ?? '').toLowerCase() === 'reprogramada' && !!c.reboteDesde && !c.reboteCerradoEn;
}

export const TURNO_LABEL: Record<TurnoRebote, string> = { manana: 'Mañana', tarde: 'Tarde', cualquiera: 'Cualquiera' };
export const RESULTADO_LLAMADA_LABEL: Record<ResultadoLlamada, string> = {
  contesto: 'Contestó',
  no_contesto: 'No contestó',
  pidio_llamar_luego: 'Pidió que lo llamen luego',
  otro: 'Otro',
};

export const reboteApi = {
  listar: (f: { sedeId?: string; unidadNegocioId?: string } = {}) =>
    api.get<{ diasRebote: number; citas: CitaEnRebote[] }>('/rebote', {
      ...(f.sedeId ? { sedeId: f.sedeId } : {}),
      ...(f.unidadNegocioId ? { unidadNegocioId: f.unidadNegocioId } : {}),
    }),
  enviar: (citaId: string, data: { motivo: string; turno?: TurnoRebote | null; llamarDesde?: string | null }) =>
    api.post<{ ok: boolean; citas: string[] }>(`/rebote/${citaId}`, data),
  registrarLlamada: (citaId: string, data: { resultado: ResultadoLlamada; nota?: string | null; llamarDesde?: string | null }) =>
    api.post<LlamadaRebote>(`/rebote/${citaId}/llamada`, data),
  llamadas: (citaId: string) =>
    api.get<LlamadaRebote[]>(`/rebote/${citaId}/llamadas`),
  descartar: (citaId: string, motivo: string) =>
    api.post<{ ok: boolean; citas: string[] }>(`/rebote/${citaId}/descartar`, { motivo }),
};
