import { api } from './client';

export interface Rol {
  id: string;
  nombre: string;
  label: string;
  descripcion: string | null;
  permisos: string[];
  esSistema: boolean;
  creadoEn?: string;
  /** Usuarios activos que tienen este rol (lo adjunta GET /roles). */
  usuariosCount?: number;
}

export type PermisoItem = { id: string; label: string };
export type GruposPermisos = Record<string, PermisoItem[]>;

export interface CrearRolPayload {
  nombre: string;
  label: string;
  descripcion?: string;
  permisos: string[];
}

export interface EditarRolPayload {
  label: string;
  descripcion?: string;
  permisos: string[];
}

export const rolesApi = {
  listar: () => api.get<Rol[]>('/roles'),

  obtenerPermisos: () => api.get<GruposPermisos>('/roles/permisos'),

  crear: (data: CrearRolPayload) => api.post<Rol>('/roles', data),

  actualizar: (id: string, data: EditarRolPayload) => api.put<Rol>(`/roles/${id}`, data),

  eliminar: (id: string) => api.delete<{ success: boolean }>(`/roles/${id}`),
};
