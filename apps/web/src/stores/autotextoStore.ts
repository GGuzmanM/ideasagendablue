// Atajos de autotexto (1.2) cargados desde el catálogo de plantillas; los leen todos los
// TextareaDictado de la historia clínica. En memoria (no persiste): se rellena al abrir la HC.
import { create } from 'zustand';

interface AutotextoState {
  atajos: Record<string, string>;
  setAtajos: (atajos: Record<string, string>) => void;
}

export const useAutotextoStore = create<AutotextoState>()((set) => ({
  atajos: {},
  setAtajos: (atajos) => set({ atajos }),
}));
