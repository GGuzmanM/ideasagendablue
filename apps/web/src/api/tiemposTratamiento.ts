import { api } from './client';
import { useAuthStore } from '../stores/authStore';

// ─── Aparato del consultorio (ESP32 con botones INICIO / FIN) ────────────────
// La podóloga presiona INICIO y FIN; la cita del consultorio pasa sola a «En atención» y a
// «Completada» y el tiempo real queda guardado. Sin cita asignada el botón no inicia nada.
// Aquí: administrar los aparatos y el reporte de tiempos reales.

export interface Dispositivo {
  id: string;
  nombre: string;
  sedeId: string;
  unidadNegocioId: string;
  consultorioNumero: number;
  tokenPrefijo: string;
  activo: boolean;
  ultimoContacto: string | null;
  ultimaIp: string | null;
  firmware: string | null;
  rssi: number | null;
  creadoEn: string;
  sede: { id: string; nombre: string; consultorios: number };
  unidadNegocio: { id: string; nombre: string };
  enLinea: boolean;
  tiempoEnCurso: { dispositivoId: string; inicioEn: string; citaId: string } | null;
}

/** Respuesta de crear / regenerar: la clave en claro se ve UNA sola vez. */
export interface DispositivoConClave { dispositivo: Dispositivo; token: string }

export interface DispositivoInput {
  nombre: string;
  sedeId: string;
  unidadNegocioId: string;
  consultorioNumero: number;
}

export const dispositivosApi = {
  listar: (sedeId?: string) => api.get<Dispositivo[]>('/dispositivos', sedeId ? { sedeId } : undefined),
  crear: (data: DispositivoInput) => api.post<DispositivoConClave>('/dispositivos', data),
  editar: (id: string, data: Partial<DispositivoInput>) => api.patch<Dispositivo>(`/dispositivos/${id}`, data),
  regenerar: (id: string) => api.post<DispositivoConClave>(`/dispositivos/${id}/regenerar`),
  revocar: (id: string) => api.post<Dispositivo>(`/dispositivos/${id}/revocar`),
  eliminar: (id: string) => api.delete<{ ok: boolean }>(`/dispositivos/${id}`),
};

export interface ResumenTiempos { n: number; promedio: number; mediana: number; p90: number; min: number; max: number }
export interface FilaReporteTiempos extends ResumenTiempos { clave: string; nombre: string; programado: number; desvio: number }
export type AgruparReporte = 'servicio' | 'profesional' | 'sede';
export interface FiltrosReporteTiempos { desde: string; hasta: string; sedeId?: string; agrupar: AgruparReporte }
export interface ReporteTiempos {
  desde: string;
  hasta: string;
  agrupar: AgruparReporte;
  total: ResumenTiempos | null;
  filas: FilaReporteTiempos[];
  fueraDelPromedio: { sinFin: number; descartados: number; enCurso: number };
}

const soloDefinidos = (p: object) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== '')) as Record<string, string>;

export const tiemposApi = {
  reporte: (f: FiltrosReporteTiempos) => api.get<ReporteTiempos>('/tiempos-tratamiento/reporte', soloDefinidos(f)),
  /** El CSV lo arma el servidor (BOM + «;» para Excel); aquí solo se descarga con la sesión. */
  descargarCsv: async (f: FiltrosReporteTiempos) => {
    const token = useAuthStore.getState().token;
    const qs = new URLSearchParams(soloDefinidos(f)).toString();
    const res = await fetch(`/api/v1/tiempos-tratamiento/reporte.csv?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message || 'No se pudo descargar el CSV');
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `tiempos-tratamiento_${f.desde}_${f.hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// ─── Formato ──────────────────────────────────────────────────────────────────
export const horaLima = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' });

export function fmtMinutos(segundos: number | null | undefined): string {
  if (segundos == null) return '—';
  const m = Math.round(segundos / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
