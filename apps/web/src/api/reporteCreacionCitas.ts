// Reporte de creación de citas (23-oct-2026): quién creó cada cita y el día y la hora en que la creó.
// Las fechas del filtro son días de CREACIÓN (hora Lima), no el día de la cita.
import { api } from './client';
import { useAuthStore } from '../stores/authStore';

export const SIN_USUARIO = 'sin-usuario';

export interface FiltrosCreacionCitas { desde: string; hasta: string; sedeId?: string; usuarioId?: string; canal?: string }

export interface FilaCreacionCita {
  id: string;
  creadoEn: string;
  diaCreacion: string;
  horaCreacion: string;
  usuarioId: string;
  usuario: string;
  rol: string | null;
  paciente: string;
  documento: string;
  sede: string;
  servicio: string;
  profesional: string;
  fechaCita: string;
  horaCita: string;
  anticipacionDias: number;
  retroactiva: boolean;
  canal: string;
  estado: string;
}

export interface ResumenUsuarioCreacion {
  usuarioId: string; usuario: string; rol: string | null; citas: number; primera: string; ultima: string;
  diasConCitas: number; promedioPorDia: number; retroactivas: number;
}

export interface ReporteCreacionCitas {
  desde: string;
  hasta: string;
  totales: { citas: number; usuarios: number; sinUsuario: number; retroactivas: number };
  porUsuario: ResumenUsuarioCreacion[];
  porHora: { hora: number; citas: number }[];
  usuarios: { id: string; nombre: string; citas: number }[];
  detalle: FilaCreacionCita[];
  detalleTotal: number;
  truncado: boolean;
}

const soloDefinidos = (p: object) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== '')) as Record<string, string>;

export const reporteCreacionCitasApi = {
  reporte: (f: FiltrosCreacionCitas) => api.get<ReporteCreacionCitas>('/reporte-creacion-citas', soloDefinidos(f)),
  /** El Excel lo arma el servidor (Resumen por usuario + Detalle); aquí solo se descarga. */
  descargarExcel: async (f: FiltrosCreacionCitas) => {
    const token = useAuthStore.getState().token;
    const qs = new URLSearchParams(soloDefinidos(f)).toString();
    const res = await fetch(`/api/v1/reporte-creacion-citas/excel?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message || 'No se pudo descargar el Excel');
    }
    const disp = res.headers.get('Content-Disposition') ?? '';
    const nombre = decodeURIComponent(disp.match(/filename="?([^";]+)"?/)?.[1] ?? 'creacion-citas.xlsx');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  },
};
