import { api } from './client';

// Reserva web (05-oct-2026): reservas hechas desde la página pública que aún no son cita
// (el paciente está pagando) o que se pagaron pero no pudieron convertirse en cita.
export type EstadoReservaWeb = 'esperando_pago' | 'pagada' | 'reembolsar';

export interface ReservaWebEnCurso {
  id: string;
  codigo: string;
  estado: EstadoReservaWeb;
  horaInicio: string;
  duracionMinutos: number;
  servicio: string;
  variante: string | null;
  paciente: string;
  numeroDocumento: string;
  telefono: string;
  monto: number;
  expiraEn: string;
  error: string | null;
}

export const reservasWebApi = {
  enCurso: (sedeId: string, fecha: string) => api.get<ReservaWebEnCurso[]>('/reservas-web/en-curso', { sedeId, fecha }),
};
