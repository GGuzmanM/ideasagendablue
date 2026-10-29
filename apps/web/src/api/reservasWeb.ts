import { api } from './client';

// Reserva web (05-oct-2026): avisos de reservas con problema. Sin pasarela (29-oct-2026) la cita se crea al confirmar, así que
// ya no hay horarios «apartados»; solo quedan las de antes que se pagaron y no pudieron convertirse en cita.
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

// Intentos (06-oct-2026): quién empezó a reservar en la web y hasta dónde llegó (para contactarlo).
// 'pago' = intentos anteriores a quitar la pasarela (hoy el último paso es 'confirmar').
export type PasoIntentoWeb = 'datos' | 'sede' | 'servicio' | 'fecha' | 'hora' | 'confirmar' | 'pago';
export type ResultadoIntentoWeb = 'en_curso' | 'abandono' | 'pagando' | 'vencio_pagando' | 'pago_rechazado' | 'reservo' | 'pago_sin_cupo' | 'sin_cupo' | 'retomo';

export interface IntentoReservaWeb {
  id: string;
  creadoEn: string;
  actualizadoEn: string;
  expiraEn: string;
  paciente: string;
  numeroDocumento: string;
  telefono: string;
  email: string;
  pacienteId: string | null;
  pasoAlcanzado: PasoIntentoWeb;
  sede: string | null;
  servicio: string | null;
  variante: string | null;
  fecha: string | null;
  horaInicio: string | null;
  reserva: { codigo: string; estado: string; monto: number; citaId: string | null } | null;
  resultado: ResultadoIntentoWeb;
  contactadoEn: string | null;
  contactadoPor: string | null;
  notaContacto: string | null;
}

export const reservasWebApi = {
  estado: () => api.get<{ habilitada: boolean }>('/reservas-web/estado'),
  enCurso: (sedeId: string, fecha: string) => api.get<ReservaWebEnCurso[]>('/reservas-web/en-curso', { sedeId, fecha }),
  intentos: (desde: string, hasta: string, pendientes: boolean) =>
    api.get<IntentoReservaWeb[]>('/reservas-web/intentos', { desde, hasta, pendientes: pendientes ? '1' : '0' }),
  marcarContacto: (id: string, contactado: boolean, nota: string | null) =>
    api.patch<{ contactadoEn: string | null; notaContacto: string | null }>(`/reservas-web/intentos/${id}/contacto`, { contactado, nota }),
};
