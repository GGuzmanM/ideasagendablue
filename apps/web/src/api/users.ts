import { api } from './client';

export interface UsuarioSede {
  id: string;
  nombre: string;
}

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  creadoEn: string;
  sedes: UsuarioSede[]; // sedes de login (a qué sedes puede acceder) — ignoradas si está vinculado al roster
  recepcionistaId: string | null;                       // vínculo con la ficha del roster (Movimientos)
  recepcionista: { id: string; nombre: string } | null; // datos de la ficha vinculada
}

export interface CrearUsuarioPayload {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  activo?: boolean;
  sedeIds?: string[];
  recepcionistaId?: string | null;
}

export interface EditarUsuarioPayload {
  nombre?: string;
  email?: string;
  password?: string;
  rol?: string;
  activo?: boolean;
  sedeIds?: string[];
  recepcionistaId?: string | null;
}

export const usersApi = {
  listar: () => api.get<Usuario[]>('/users'),

  obtenerPorId: (id: string) => api.get<Usuario>(`/users/${id}`),

  crear: (data: CrearUsuarioPayload) => api.post<Usuario>('/users', data),

  actualizar: (id: string, data: EditarUsuarioPayload) => api.put<Usuario>(`/users/${id}`, data),

  eliminar: (id: string) => api.delete<{ success: boolean }>(`/users/${id}`),
};
