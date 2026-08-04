import { api } from './client';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  creadoEn: string;
}

export interface CrearUsuarioPayload {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  activo?: boolean;
}

export interface EditarUsuarioPayload {
  nombre?: string;
  email?: string;
  password?: string;
  rol?: string;
  activo?: boolean;
}

export const usersApi = {
  listar: () => api.get<Usuario[]>('/users'),

  obtenerPorId: (id: string) => api.get<Usuario>(`/users/${id}`),

  crear: (data: CrearUsuarioPayload) => api.post<Usuario>('/users', data),

  actualizar: (id: string, data: EditarUsuarioPayload) => api.put<Usuario>(`/users/${id}`, data),

  eliminar: (id: string) => api.delete<{ success: boolean }>(`/users/${id}`),
};
