import { api } from './client';

export interface ProfBaro {
  id: string;
  nombre: string;
  tipo: string;
  activo?: boolean;
  servicios?: number;
  sedeId?: string;
  sedeNombre?: string;
  // Vigencia temporal de la asignación de baro (sección "Baro" de movimientos).
  fechaInicio?: string;
  fechaFin?: string | null;
  motivo?: string | null;
}

export interface BaroSolicitudData {
  servicios: { id: string; nombre: string }[];
  porSolicitud: ProfBaro[];
  disponibles: ProfBaro[];
  // Solo en la vista GLOBAL (sin sedeId): citas de baro de hoy por médico + total.
  citasHoyPorMedico?: Record<string, number>;
  citasHoyTotal?: number;
}

export const baroSolicitudApi = {
  // `sedeId` filtra el roster y los candidatos a esa sede (registro de baro es por sede).
  // `fecha` (YYYY-MM-DD) filtra a los doctores cuya asignación de baro rige ese día.
  obtener: (sedeId?: string, fecha?: string) =>
    api.get<BaroSolicitudData>('/baro-solicitud', {
      ...(sedeId ? { sedeId } : {}),
      ...(fecha ? { fecha } : {}),
    }),
  agregar: (profesionalId: string, sedeId: string, opts?: { fechaInicio?: string; fechaFin?: string | null; motivo?: string | null }) =>
    api.post<{ ok: boolean }>(`/baro-solicitud/${profesionalId}`, { sedeId, ...opts }),
  // `hasta` (YYYY-MM-DD): CIERRA la asignación en esa fecha (conserva historial) en vez de
  // desactivarla — se usa al MOVER de sede. Sin `hasta`: quita por completo.
  quitar: (profesionalId: string, sedeId: string, hasta?: string) =>
    api.delete<{ ok: boolean }>(`/baro-solicitud/${profesionalId}?sedeId=${encodeURIComponent(sedeId)}${hasta ? `&hasta=${hasta}` : ''}`),
};
