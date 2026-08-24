import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAgendaStore } from './agendaStore';
import { queryClient } from '../lib/queryClient';

const API_BASE = '/api/v1';

/**
 * Limpia TODO el estado ligado al usuario que estaba logueado: la selección de agenda in-memory
 * (sede/fecha/unidad) y la caché de datos de TanStack Query. Se llama al iniciar y cerrar sesión
 * para que NADA se herede entre usuarios (el logout no recarga la página, así que sin esto la
 * sede y el día que dejó el usuario anterior seguían vivos para el siguiente).
 */
function limpiarEstadoDeSesion() {
  useAgendaStore.getState().reset();
  queryClient.clear();
}

interface SedeInfo { id: string; nombre: string; color: string }

export interface UsuarioAuth {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  permisos: string[];
  sedes: SedeInfo[];
}

interface AuthState {
  token: string | null;
  usuario: UsuarioAuth | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuth: (token: string, usuario: UsuarioAuth) => void;
  logout: () => void;
  login: (email: string, password: string) => Promise<void>;
  checkAuth: () => Promise<void>;

  tiene: (permiso: string) => boolean;
  isAdmin: () => boolean;
  isCoordinadora: () => boolean;
  puedeAccederSede: (sedeId: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      usuario: null,
      isAuthenticated: false,
      isLoading: true,

      setAuth: (token, usuario) => set({ token, usuario, isAuthenticated: true, isLoading: false }),

      logout: () => {
        limpiarEstadoDeSesion();
        set({ token: null, usuario: null, isAuthenticated: false, isLoading: false });
      },

      login: async (email, password) => {
        const res = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { message?: string }).message || 'Credenciales inválidas');
        }
        const data = await res.json() as { token: string; usuario: UsuarioAuth };
        limpiarEstadoDeSesion(); // arranca en limpio: sin sede/fecha/caché heredadas de otra sesión
        set({ token: data.token, usuario: data.usuario, isAuthenticated: true, isLoading: false });
      },

      checkAuth: async () => {
        const { token } = get();
        if (!token) { set({ isLoading: false, isAuthenticated: false }); return; }
        try {
          const res = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error();
          const usuario = await res.json() as UsuarioAuth;
          set({ usuario, isAuthenticated: true, isLoading: false });
        } catch {
          set({ token: null, usuario: null, isAuthenticated: false, isLoading: false });
        }
      },

      tiene: (permiso: string) => get().usuario?.permisos?.includes(permiso) ?? false,
      isAdmin: () => get().usuario?.rol === 'admin',
      isCoordinadora: () => ['admin', 'coordinadora_sedes'].includes(get().usuario?.rol ?? ''),
      puedeAccederSede: (sedeId: string) => {
        const u = get().usuario;
        if (!u) return false;
        // Roles que ven TODAS las sedes (espeja ROLES_TODAS_SEDES del backend). Es solo acceso a
        // sedes; contact_center NO es coordinadora (no gestiona). Recepción NO entra aquí.
        if (['admin', 'coordinadora_sedes', 'contact_center'].includes(u.rol)) return true;
        return u.sedes.some(s => s.id === sedeId);
      },
    }),
    {
      name: 'limablue-auth',
      partialize: (state) => ({ token: state.token, usuario: state.usuario }),
      onRehydrateStorage: () => (state) => {
        if (state) { state.isAuthenticated = !!state.token; state.isLoading = false; }
      },
    }
  )
);
