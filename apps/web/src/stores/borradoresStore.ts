// Borradores sin guardar de la atención abierta en pantalla (nota escrita o dictada, procedimiento a
// medio llenar, escala elegida, dibujo o anotación del podograma). Cada formulario marca si tiene algo;
// la página pregunta antes de cambiar de atención o de salir, para que 5 minutos de dictado no se pierdan
// por rozar otra tarjeta en la tablet. Las fotos «por guardar» tienen su propio store.
import { create } from 'zustand';
import { useEffect } from 'react';

interface BorradoresState {
  activos: Record<string, boolean>;
  marcar: (clave: string, activo: boolean) => void;
  limpiar: () => void;
}

export const useBorradoresStore = create<BorradoresState>((set) => ({
  activos: {},
  marcar: (clave, activo) => set((s) => (s.activos[clave] === activo ? s : { activos: { ...s.activos, [clave]: activo } })),
  limpiar: () => set({ activos: {} }),
}));

/** Cada hook de formulario informa si tiene un borrador (y lo retira al desmontar). */
export function useMarcarBorrador(clave: string, activo: boolean) {
  const marcar = useBorradoresStore((s) => s.marcar);
  useEffect(() => { marcar(clave, activo); }, [clave, activo, marcar]);
  useEffect(() => () => marcar(clave, false), [clave, marcar]);
}

export const hayBorradores = () => Object.values(useBorradoresStore.getState().activos).some(Boolean);
