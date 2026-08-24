import { create } from 'zustand';
import { format } from 'date-fns';

interface AgendaState {
  sedeId: string | null;
  fecha: Date;
  unidadNegocioId: string | null;
  vistaActiva: 'dia' | 'semana';
  modoRedistribucion: boolean;
  profesionalRedistribucionId: string | null;

  setSedeId: (id: string | null) => void;
  setFecha: (d: Date) => void;
  setUnidadNegocioId: (id: string | null) => void;
  setVistaActiva: (v: 'dia' | 'semana') => void;
  toggleModoRedistribucion: (profesionalId?: string) => void;
  fechaStr: () => string;
  /** Vuelve al estado inicial (sede/fecha/unidad/redistribución). Se llama al login/logout para
   *  que la selección de un usuario NO se herede a la siguiente sesión (este store es in-memory y
   *  el logout NO recarga la página, así que sin esto la sede+fecha del admin quedaban vivas). */
  reset: () => void;
}

const ESTADO_INICIAL = {
  sedeId: null as string | null,
  unidadNegocioId: null as string | null,
  vistaActiva: 'dia' as const,
  modoRedistribucion: false,
  profesionalRedistribucionId: null as string | null,
};

export const useAgendaStore = create<AgendaState>((set, get) => ({
  ...ESTADO_INICIAL,
  fecha: new Date(),

  setSedeId: (id) => set({ sedeId: id }),
  setFecha: (d) => set({ fecha: d }),
  setUnidadNegocioId: (id) => set({ unidadNegocioId: id }),
  setVistaActiva: (v) => set({ vistaActiva: v }),
  toggleModoRedistribucion: (profesionalId) =>
    set(s => ({
      modoRedistribucion: !s.modoRedistribucion || !!profesionalId,
      profesionalRedistribucionId: profesionalId ?? null,
    })),
  fechaStr: () => format(get().fecha, 'yyyy-MM-dd'),
  reset: () => set({ ...ESTADO_INICIAL, fecha: new Date() }),
}));
