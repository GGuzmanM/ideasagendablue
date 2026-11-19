// Modo navideño (12-nov-2026): decoración opcional (guirnalda, gorrito en el logo y nieve suave).
// Cada persona lo prende o apaga con su switch; se guarda en SU navegador (no toca la base).
// Solo existe en temporada: del 1 de diciembre al 6 de enero (hora de Lima). En desarrollo se ve siempre,
// para poder probarlo en cualquier fecha. Las cuentas de USUARIOS_ANTICIPADOS lo ven desde ya (para revisarlo antes).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from './authStore';

export type PersonajeNavidad = 'stitch' | 'dino' | 'capibara' | 'harry' | 'bob' | 'crash' | 'arbol';

interface NavidadState {
  activo: boolean;
  personaje: PersonajeNavidad | null;
  modalSelectorAbierto: boolean;
  alternar: () => void;
  setPersonaje: (p: PersonajeNavidad | null) => void;
  abrirModalSelector: () => void;
  cerrarModalSelector: () => void;
}

export const useNavidadStore = create<NavidadState>()(
  persist(
    (set) => ({
      activo: false,
      personaje: null,
      modalSelectorAbierto: false,
      alternar: () =>
        set((s) => {
          const nuevo = !s.activo;
          return {
            activo: nuevo,
            // Al encender el modo navideño, abrimos el selector para que la persona elija o confirme su mascota:
            modalSelectorAbierto: nuevo,
          };
        }),
      setPersonaje: (p) => set({ personaje: p, modalSelectorAbierto: false }),
      abrirModalSelector: () => set({ modalSelectorAbierto: true }),
      cerrarModalSelector: () => set({ modalSelectorAbierto: false }),
    }),
    {
      name: 'limablue-navidad',
      partialize: (s) => ({ activo: s.activo, personaje: s.personaje }),
    },
  ),
);

/** Cuentas que ven el modo navideño ANTES del 1 de diciembre (13-nov-2026). Es solo decoración: no da ningún permiso. */
const USUARIOS_ANTICIPADOS = [
  'de.chigne@limablue.com',
  'dechigne@limablue.com',
  'al.leyva@limablue.com',
  'alleyva@limablue.com',
  'da.santos@limablue.com',
  'dasantos@limablue.com',
  'ga.mancilla@limablue.com',
  'gamancilla@limablue.com',
  'ja.ruiz@limablue.com',
  'jaruiz@limablue.com',
  'institucional@limablue.com',
  'da.sirvas@limablue.com',
  'dasirvas@limablue.com',
];
/** TEMPORAL (17-nov-2026): el rol admin también lo ve antes, para revisar la capibara. Poner en false para quitarlo. */
const ADMIN_ANTICIPADO = true;

/** Modo navideño habilitado para todas las cuentas (18-nov-2026) para que todo el equipo pueda disfrutarlo y escoger su mascota. */
export function esTemporadaNavidad(_ahora: Date = new Date(), _email?: string | null, _rol?: string | null): boolean {
  return true;
}

/** ¿Es temporada para la persona que inició sesión? (el switch solo aparece si sí). */
export function useEnTemporadaNavidad(): boolean {
  const email = useAuthStore((s) => s.usuario?.email);
  const rol = useAuthStore((s) => s.usuario?.rol);
  return esTemporadaNavidad(new Date(), email, rol);
}

/** La decoración se muestra: es temporada (para esta persona) y la prendió. */
export function useNavidadVisible(): boolean {
  const activo = useNavidadStore((s) => s.activo);
  return useEnTemporadaNavidad() && activo;
}
