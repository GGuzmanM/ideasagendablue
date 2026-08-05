import { api } from './client';

export interface ProfBaro {
  id: string;
  nombre: string;
  tipo: string;
  activo?: boolean;
  servicios?: number;
  sedeId?: string;
  sedeNombre?: string;
}

export interface BaroSolicitudData {
  servicios: { id: string; nombre: string }[];
  porSolicitud: ProfBaro[];
  disponibles: ProfBaro[];
}

export const baroSolicitudApi = {
  // `sedeId` filtra el roster y los candidatos a esa sede (registro de baro es por sede).
  obtener: (sedeId?: string) => api.get<BaroSolicitudData>('/baro-solicitud', sedeId ? { sedeId } : undefined),
  agregar: (profesionalId: string, sedeId: string) => api.post<{ ok: boolean }>(`/baro-solicitud/${profesionalId}`, { sedeId }),
  quitar: (profesionalId: string, sedeId: string) => api.delete<{ ok: boolean }>(`/baro-solicitud/${profesionalId}?sedeId=${encodeURIComponent(sedeId)}`),
};
