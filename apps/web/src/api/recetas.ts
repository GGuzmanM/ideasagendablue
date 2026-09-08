// Recetas médicas e indicaciones podológicas — API + helpers de PDF (blob autenticado → ver / imprimir),
// mismo patrón que membresias.ts (contrato).
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useAuthStore } from '../stores/authStore';
import type { PacienteHc, ProfesionalMini, Alergia } from './historiaClinica';

export type TipoDocumentoReceta = 'RECETA_MEDICA' | 'INDICACIONES_PODOLOGICAS';
export type TipoItemReceta = 'MEDICAMENTO_RX' | 'MEDICAMENTO_OTC' | 'PRODUCTO' | 'SERVICIO';

export const TIPO_ITEM_LABEL: Record<TipoItemReceta, string> = {
  MEDICAMENTO_RX: 'Receta', MEDICAMENTO_OTC: 'Venta libre', PRODUCTO: 'Producto', SERVICIO: 'Servicio',
};
export const TIPO_DOC_LABEL: Record<TipoDocumentoReceta, string> = {
  RECETA_MEDICA: 'Receta médica', INDICACIONES_PODOLOGICAS: 'Indicaciones podológicas',
};

export interface ItemEntrada {
  tipo?: TipoItemReceta;
  diagnosticoCie10Codigo?: string | null;
  medicamentoId?: string | null;
  servicioId?: string | null;
  nombre?: string | null;
  marcaImpresa?: string | null;
  concentracion?: string | null;
  formaFarmaceutica?: string | null;
  dosis?: string | null; via?: string | null; frecuencia?: string | null; duracion?: string | null; cantidad?: string | null; indicaciones?: string | null;
}

export interface RecetaItem {
  id: string; tipo: TipoItemReceta; diagnosticoCie10Codigo: string | null; medicamentoId: string | null; servicioId: string | null;
  nombre: string; marcaImpresa: string | null; concentracionSnapshot: string | null; formaSnapshot: string | null;
  dosis: string | null; via: string | null; frecuencia: string | null; duracion: string | null; cantidad: string | null; indicaciones: string | null; orden: number;
  diagnostico: { codigo: string; descripcion: string } | null;
}

export interface RecetaCompleta {
  id: string; numero: number; tipoDocumento: TipoDocumentoReceta; atencionId: string; historiaClinicaId: string; pacienteId: string; sedeId: string;
  emisorProfesionalId: string; emisorNombre: string; emisorRegistro: string | null; indicacionesGenerales: string | null;
  fechaEmision: string; vigenciaDias: number | null; estado: 'emitida' | 'anulada'; codigoVerificacion: string;
  anuladaEn: string | null; motivoAnulacion: string | null;
  items: RecetaItem[]; paciente: PacienteHc; emisor: ProfesionalMini;
  atencion: { id: string; fecha: string; citaId: string; sede: { id: string; nombre: string; direccion: string | null } };
  historiaClinica: { numero: number; alergias: Pick<Alergia, 'sustancia' | 'severidad' | 'reaccion'>[] };
  advertencias?: Advertencia[];
}

export interface Advertencia { item: string; sustancia: string; severidad: string }

export interface RecetaListado {
  id: string; numero: number; tipoDocumento: TipoDocumentoReceta; estado: 'emitida' | 'anulada'; fechaEmision: string; emisorNombre: string;
  codigoVerificacion: string; atencionId: string; _count: { items: number }; items: { nombre: string; tipo: TipoItemReceta }[];
}

export const recetasPacienteKey = (pacienteId: string) => ['recetas-paciente', pacienteId] as const;

export const recetasApi = {
  emitir: (data: { atencionId: string; tipoDocumento: TipoDocumentoReceta; emisorProfesionalId?: string | null; indicacionesGenerales?: string | null; vigenciaDias?: number | null; items: ItemEntrada[] }) =>
    api.post<RecetaCompleta>('/recetas', data),
  advertencias: (atencionId: string, items: { nombre: string; marcaImpresa?: string | null }[]) =>
    api.post<{ advertencias: Advertencia[] }>('/recetas/advertencias', { atencionId, items }),
  obtener: (id: string) => api.get<RecetaCompleta>(`/recetas/${id}`),
  dePaciente: (pacienteId: string) => api.get<RecetaListado[]>(`/recetas/paciente/${pacienteId}`),
  anular: (id: string, motivo: string) => api.patch<RecetaCompleta>(`/recetas/${id}/anular`, { motivo }),
  // PDF en streaming (blob autenticado): el <iframe>/window.open no puede mandar Authorization.
  descargarPdfBlob: async (id: string): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`/api/v1/recetas/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error((e as { message?: string; error?: string }).message || (e as { error?: string }).error || 'No se pudo generar el PDF');
    }
    return res.blob();
  },
};

export function useRecetasPaciente(pacienteId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: recetasPacienteKey(pacienteId ?? ''),
    queryFn: () => recetasApi.dePaciente(pacienteId!),
    enabled: !!pacienteId && enabled,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

/** Abre el PDF en una pestaña nueva. */
export async function verRecetaPdf(id: string): Promise<void> {
  const blob = await recetasApi.descargarPdfBlob(id);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Genera el PDF y abre la ventana de IMPRESIÓN (iframe oculto → print; respaldo: pestaña). */
export async function imprimirReceta(id: string): Promise<void> {
  const blob = await recetasApi.descargarPdfBlob(id);
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0';
  iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
  iframe.src = url;
  iframe.onload = () => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { window.open(url, '_blank'); }
    setTimeout(() => { URL.revokeObjectURL(url); iframe.remove(); }, 60_000);
  };
  document.body.appendChild(iframe);
}
