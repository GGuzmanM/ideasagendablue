import { api } from './client';

export interface ServicioCombinable {
  id: string;
  nombre: string;
  color: string;
  duracionMinutos: number;
  unidadNegocioId: string;
  activo: boolean;
}

export interface Combinacion {
  id: string;
  servicioAnclaId?: string | null;
  servicioExtraId: string;
  activo?: boolean;
  servicio: ServicioCombinable;
}

// Lectura para el popover (cualquier usuario): ancla configurada + extras activos.
export interface ConfigCombinacion {
  servicioAnclaId: string | null;
  combinables: Combinacion[];
}

export const combinacionesApi = {
  // Popover: ancla + combinables ACTIVOS.
  config: () => api.get<ConfigCombinacion>('/combinaciones/config'),

  // Herramientas (admin): lista de servicios que funcionan como ancla.
  listarAnclas: () => api.get<ServicioCombinable[]>('/combinaciones/anclas'),

  // Herramientas (admin): lista completa incl. inactivos. Filtrada por ancla si se pasa anclaId.
  listarAdmin: (anclaId?: string) =>
    api.get<Combinacion[]>('/combinaciones/admin', anclaId ? { anclaId } : undefined),

  // Alias sin parámetros para compatibilidad con código existente
  listarAdminTodos: () => api.get<Combinacion[]>('/combinaciones/admin'),

  setAncla: (servicioAnclaId: string | null) =>
    api.put<{ servicioAnclaId: string | null }>('/combinaciones/ancla', { servicioAnclaId }),

  agregar: (servicioExtraId: string, servicioAnclaId?: string | null) =>
    api.post<Combinacion>('/combinaciones', { servicioExtraId, servicioAnclaId }),

  setActivo: (id: string, activo: boolean) =>
    api.patch<Combinacion>(`/combinaciones/${id}`, { activo }),

  quitar: (id: string) => api.delete<{ ok: boolean }>(`/combinaciones/${id}`),
};
