// Fotos clínicas tomadas o elegidas que AÚN NO se guardan: quedan aquí (por atención) hasta que se pulse
// «Guardar», así se completa zona, lado y tipo antes de que pasen a «Fotos de esta atención».
// En memoria: sobreviven al cambio de pestaña (el panel de fotos se desmonta) pero no a una recarga
// (la página avisa antes de salir). Se vacía al cerrar sesión: son fotos de pacientes.
import { create } from 'zustand';
import type { CategoriaFoto, Pie } from '../api/historiaClinica';

export interface FotoPendiente {
  id: string; archivo: File; url: string; tomadaEn: string;
  zona: string; pie: Pie | ''; categoria: CategoriaFoto; descripcion: string;
}
export type CamposPendiente = Pick<FotoPendiente, 'zona' | 'pie' | 'categoria' | 'descripcion'>;

interface FotosPendientesState {
  porAtencion: Record<string, FotoPendiente[]>;
  agregar: (atencionId: string, fotos: FotoPendiente[]) => void;
  actualizar: (atencionId: string, id: string, cambios: Partial<CamposPendiente>) => void;
  quitar: (atencionId: string, id: string) => void;
  vaciar: () => void;
}

const SIN_FOTOS: FotoPendiente[] = [];

export const useFotosPendientesStore = create<FotosPendientesState>()((set) => ({
  porAtencion: {},
  agregar: (atencionId, fotos) => set((s) => ({ porAtencion: { ...s.porAtencion, [atencionId]: [...(s.porAtencion[atencionId] ?? []), ...fotos] } })),
  actualizar: (atencionId, id, cambios) => set((s) => ({
    porAtencion: { ...s.porAtencion, [atencionId]: (s.porAtencion[atencionId] ?? []).map((f) => (f.id === id ? { ...f, ...cambios } : f)) },
  })),
  quitar: (atencionId, id) => set((s) => {
    const lista = s.porAtencion[atencionId] ?? [];
    const foto = lista.find((f) => f.id === id);
    if (foto) URL.revokeObjectURL(foto.url);
    return { porAtencion: { ...s.porAtencion, [atencionId]: lista.filter((f) => f.id !== id) } };
  }),
  vaciar: () => set((s) => {
    Object.values(s.porAtencion).flat().forEach((f) => URL.revokeObjectURL(f.url));
    return { porAtencion: {} };
  }),
}));

/** Fotos sin guardar de una atención (misma lista vacía si no hay, para no re-renderizar). */
export const usePendientesDe = (atencionId: string | null | undefined) =>
  useFotosPendientesStore((s) => (atencionId ? s.porAtencion[atencionId] ?? SIN_FOTOS : SIN_FOTOS));

/** Total de fotos sin guardar en todas las atenciones: para avisar antes de salir de la página. */
export const useTotalPendientes = () => useFotosPendientesStore((s) => Object.values(s.porAtencion).reduce((n, l) => n + l.length, 0));
