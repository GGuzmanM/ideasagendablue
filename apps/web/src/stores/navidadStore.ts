// Modo navideño (12-nov-2026): decoración opcional (guirnalda, gorrito en el logo y nieve suave).
// Cada persona lo prende o apaga con su switch; se guarda en SU navegador (no toca la base).
// Solo existe en temporada: del 1 de diciembre al 6 de enero (hora de Lima). En desarrollo se ve siempre,
// para poder probarlo en cualquier fecha. Las cuentas de USUARIOS_ANTICIPADOS lo ven desde ya (para revisarlo antes).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from './authStore';

interface NavidadState {
  activo: boolean;
  alternar: () => void;
}

export const useNavidadStore = create<NavidadState>()(
  persist(
    (set) => ({
      activo: false,
      alternar: () => set((s) => ({ activo: !s.activo })),
    }),
    { name: 'limablue-navidad' },
  ),
);

/** Cuentas que ven el modo navideño ANTES del 1 de diciembre (13-nov-2026). Es solo decoración: no da ningún permiso. */
const USUARIOS_ANTICIPADOS = ['de.chigne@limablue.com'];

/** ¿Estamos entre el 1 de diciembre y el 6 de enero (en Lima)? Con `email` de una cuenta anticipada, siempre sí. */
export function esTemporadaNavidad(ahora: Date = new Date(), email?: string | null): boolean {
  if (import.meta.env.DEV) return true;
  if (email && USUARIOS_ANTICIPADOS.includes(email.trim().toLowerCase())) return true;
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', month: 'numeric', day: 'numeric' }).formatToParts(ahora);
  const mes = Number(partes.find((p) => p.type === 'month')?.value);
  const dia = Number(partes.find((p) => p.type === 'day')?.value);
  return mes === 12 || (mes === 1 && dia <= 6);
}

/** ¿Es temporada para la persona que inició sesión? (el switch solo aparece si sí). */
export function useEnTemporadaNavidad(): boolean {
  const email = useAuthStore((s) => s.usuario?.email);
  return esTemporadaNavidad(new Date(), email);
}

/** La decoración se muestra: es temporada (para esta persona) y la prendió. */
export function useNavidadVisible(): boolean {
  const activo = useNavidadStore((s) => s.activo);
  return useEnTemporadaNavidad() && activo;
}
