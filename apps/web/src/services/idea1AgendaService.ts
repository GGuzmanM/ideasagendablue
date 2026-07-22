export interface SlotHorario {
  hora: string; // "09:00", "10:00", etc.
  label: string;
}

export interface SedeAgenda {
  id: string;
  nombre: string;
  activa: boolean;
}

export interface DoctorAgenda {
  id: string;
  nombres: string;
  apellidos: string;
  especialidad: string;
  activo: boolean;
  sedeId: string;
  avatarUrl?: string;
}

export interface CitaAgenda {
  id: string;
  doctorId: string;
  horaInicio: string; // "09:00"
  horaFin: string; // "10:15"
  duracionMinutos?: number;
  paciente: string;
  motivo: string;
  servicioNombre?: string;
  subcategoriaNombre?: string;
  etiquetaAsignacion?: string;
  estado: 'AGENDADA' | 'CONFIRMADA' | 'EN ATENCIÓN' | 'COMPLETADA' | 'NO SHOW';
}

/**
 * Formatea una fecha al formato "D de Mes, YYYY" (ej: "20 de Julio, 2026")
 */
export function formatearFechaAgenda(fecha: Date): string {
  const dia = fecha.getDate();
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const mes = meses[fecha.getMonth()];
  const anio = fecha.getFullYear();
  return `${dia} de ${mes}, ${anio}`;
}

/**
 * 1. Genera dinámicamente el rango de horarios para la agenda (por defecto de 9am a 6pm / 18:00)
 */
export function obtenerHorariosAgenda(inicio = 9, fin = 18): SlotHorario[] {
  const slots: SlotHorario[] = [];
  for (let h = inicio; h <= fin; h++) {
    const horaStr = `${h.toString().padStart(2, '0')}:00`;
    slots.push({
      hora: horaStr,
      label: horaStr,
    });
  }
  return slots;
}

/**
 * Avatar por defecto limpio (SVG Data URI) si no hay foto de perfil
 */
export function getDefaultAvatar(nombre: string = 'Doctor'): string {
  const inicial = nombre.trim().charAt(0).toUpperCase() || 'D';
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%234537cd" rx="50"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-size="40" font-weight="bold">${inicial}</text></svg>`;
}


