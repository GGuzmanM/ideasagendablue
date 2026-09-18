import { api } from './client';
import type { CitaResumen } from './citas';

export interface MedicoAsignable { id: string; nombre: string; colegiatura: string | null; enEstaSede: boolean }

// Médico de la cita: el médico se toma / suelta; admin y coordinación asignan a cualquiera.
export const medicoCitaApi = {
  tomar: (citaId: string) => api.patch<CitaResumen>(`/medico-cita/${citaId}`, { accion: 'tomar' }),
  soltar: (citaId: string) => api.patch<CitaResumen>(`/medico-cita/${citaId}`, { accion: 'soltar' }),
  asignar: (citaId: string, medicoId: string | null) => api.patch<CitaResumen>(`/medico-cita/${citaId}`, { accion: 'asignar', medicoId }),
  asignables: (sedeId: string) => api.get<MedicoAsignable[]>(`/medico-cita/asignables?sedeId=${sedeId}`),
};

export const nombreMedico = (m: { nombres: string; apellidos: string } | null | undefined) =>
  m ? `Dr(a). ${m.nombres.split(' ')[0]} ${m.apellidos.split(' ')[0]}`.trim() : null;
