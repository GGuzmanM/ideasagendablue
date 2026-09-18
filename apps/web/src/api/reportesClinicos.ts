// Reportes clínicos (7.1 diagnósticos, 7.3 productividad, 7.4 calidad del registro). Son CONTEOS:
// no viaja ningún nombre de paciente ni texto de la historia, por eso basta el permiso de reportes.
import { api } from './client';
import { useAuthStore } from '../stores/authStore';

export type AgruparReporte = 'diagnostico' | 'procedimiento' | 'profesional' | 'sede' | 'edad';

export const AGRUPAR_LABEL: Record<AgruparReporte, string> = {
  diagnostico: 'Diagnóstico',
  procedimiento: 'Procedimiento',
  profesional: 'Profesional',
  sede: 'Sede',
  edad: 'Edad',
};

export interface FiltrosReporteClinico { desde: string; hasta: string; sedeId?: string; agrupar: AgruparReporte }

export interface FilaReporteClinico {
  clave: string; etiqueta: string; atenciones: number; pacientes: number; porcentaje: number; procedimientos?: number;
}
export interface FilaCalidadClinica {
  clave: string; etiqueta: string; cerradas: number; conDiagnostico: number; conNota: number;
  conProcedimiento: number; conConsentimiento: number; completas: number;
}
export interface TotalesClinicos {
  atenciones: number; cerradas: number; pacientes: number; conDiagnostico: number; procedimientos: number; completas: number;
}
export interface ReporteClinico {
  desde: string; hasta: string; agrupar: AgruparReporte;
  totales: TotalesClinicos;
  filas: FilaReporteClinico[];
  calidad: FilaCalidadClinica[];
}

const soloDefinidos = (p: object) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== '')) as Record<string, string>;

export const reportesClinicosApi = {
  reporte: (f: FiltrosReporteClinico) => api.get<ReporteClinico>('/reportes-clinicos/reporte', soloDefinidos(f)),
  /** El CSV lo arma el servidor (BOM + «;» para que Excel lo abra bien); aquí solo se descarga. */
  descargarCsv: async (f: FiltrosReporteClinico) => {
    const token = useAuthStore.getState().token;
    const qs = new URLSearchParams(soloDefinidos(f)).toString();
    const res = await fetch(`/api/v1/reportes-clinicos/reporte.csv?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message || 'No se pudo descargar el CSV');
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-clinico-${f.agrupar}_${f.desde}_${f.hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
