import { api } from './client';
import { useAuthStore } from '../stores/authStore';

export type CampoContrato = 'nombre' | 'dni' | 'fecha';
export interface PosicionCampo {
  campo: CampoContrato;
  pagina: number;
  xPct: number;
  yPct: number;
  tamanio?: number;
  anchoPct?: number;
}
export interface ContratoConfig {
  contratoPlantillaUrl: string | null;
  contratoCampos: PosicionCampo[];
  pagina?: { width: number; height: number } | null;
}

export interface MembresiaVendida {
  id: string;
  paciente: string;
  pacienteId: string;
  documento: string;
  membresia: string;
  promocionId: string | null;
  tieneContrato: boolean;
  estado: string;
  activo: boolean;
  vigenciaInicio: string | null;
  vigenciaFin: string | null;
  sesionesTotal: number;
  sesionesUsadas: number;
  sede: string | null;
  creadoEn: string;
}

export const membresiasApi = {
  // ── Membresías vendidas (gestión por paciente) ──
  vendidas: (params: { q?: string; estado?: string }) =>
    api.get<MembresiaVendida[]>('/membresias/vendidas', params as Record<string, string>),
  setHabilitada: (ppId: string, habilitar: boolean) =>
    api.patch<{ id: string; estado: string; activo: boolean }>(`/membresias/vendidas/${ppId}`, { habilitar }),

  // ── Configuración del contrato (por membresía) ──
  contratoConfig: (promoId: string) => api.get<ContratoConfig>(`/membresias/${promoId}/contrato-config`),
  guardarCampos: (promoId: string, campos: PosicionCampo[]) =>
    api.patch<{ ok: boolean }>(`/membresias/${promoId}/contrato-campos`, { campos }),
  subirPlantilla: async (promoId: string, file: File): Promise<{ contratoPlantillaUrl: string }> => {
    const fd = new FormData();
    fd.append('contrato', file);
    return api.upload<{ contratoPlantillaUrl: string }>(`/membresias/${promoId}/contrato-plantilla`, fd);
  },

  // ── Generación del contrato pre-llenado (blob autenticado, vía proxy) ──
  // `opts.pacienteId` para un paciente real; `opts.muestra` para previsualizar con datos de ejemplo.
  descargarContratoBlob: async (promoId: string, opts: { pacienteId?: string; muestra?: boolean }): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const q = opts.muestra ? 'muestra=1' : `pacienteId=${opts.pacienteId}`;
    const res = await fetch(`/api/v1/membresias/${promoId}/contrato?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || e.error || 'No se pudo generar el contrato');
    }
    return res.blob();
  },
};

/** Abre el contrato en una pestaña nueva para VER cómo queda (no imprime). */
export async function verContratoMembresia(promoId: string, opts: { pacienteId?: string; muestra?: boolean }): Promise<void> {
  const blob = await membresiasApi.descargarContratoBlob(promoId, opts);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Genera el contrato del paciente y abre la ventana de IMPRESIÓN automáticamente.
 * (Fetch autenticado → blob → iframe oculto → print. En Chrome el diálogo sale solo.)
 */
export async function imprimirContratoMembresia(promoId: string, pacienteId: string): Promise<void> {
  const blob = await membresiasApi.descargarContratoBlob(promoId, { pacienteId });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.open(url, '_blank'); // respaldo: abrir en pestaña
    }
    // Libera el objeto tras un tiempo prudente (el print es asíncrono).
    setTimeout(() => { URL.revokeObjectURL(url); iframe.remove(); }, 60_000);
  };
  document.body.appendChild(iframe);
}
