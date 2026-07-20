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
  paciente: string;
  motivo: string;
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
 * 2. Avatar por defecto limpio (SVG Data URI) si no hay foto de perfil
 */
export function getDefaultAvatar(nombre: string = 'Doctor'): string {
  const inicial = nombre.trim().charAt(0).toUpperCase() || 'D';
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%234537cd" rx="50"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-size="40" font-weight="bold">${inicial}</text></svg>`;
}

/**
 * 3. Obtiene el listado de sedes disponibles
 */
export function obtenerSedes(): SedeAgenda[] {
  return [
    { id: 'principal', nombre: 'Sede Principal', activa: true },
    { id: 'centro', nombre: 'Centro Centro', activa: true },
    { id: 'los-olivos', nombre: 'Los Olivos', activa: true },
    { id: 'san-miguel', nombre: 'San Miguel', activa: true },
    { id: 'one', nombre: 'One', activa: true },
  ];
}


export function obtenerDoctoresActivosPorSede(sedeId: string): DoctorAgenda[] {
  const todosLosDoctores: DoctorAgenda[] = [
    // Sede Principal
    { id: 'doc-1', nombres: 'Mirtha', apellidos: 'Chavez', especialidad: 'Podologa', activo: true, sedeId: 'principal' },
    { id: 'doc-2', nombres: 'Laura', apellidos: 'Escalante', especialidad: 'Podologa', activo: true, sedeId: 'principal' },
    { id: 'doc-3', nombres: 'Gissela', apellidos: 'Morote', especialidad: 'Podologa', activo: true, sedeId: 'principal' },
    { id: 'doc-4', nombres: 'Erika', apellidos: 'Saavedra', especialidad: 'Medicina General', activo: true, sedeId: 'principal' },
    { id: 'doc-5', nombres: 'Luz', apellidos: 'Saldaña', especialidad: 'Podologa', activo: true, sedeId: 'principal' },
    { id: 'doc-6', nombres: 'Sonia', apellidos: 'Tejada', especialidad: 'Podologa', activo: true, sedeId: 'principal' },
    { id: 'doc-inactivo', nombres: 'Juan', apellidos: 'Perez', especialidad: 'Dermatología', activo: false, sedeId: 'principal' },

    // Los Olivos
    { id: 'doc-7', nombres: 'Carlos', apellidos: 'Mendoza', especialidad: 'Podologo', activo: true, sedeId: 'los-olivos' },
    { id: 'doc-8', nombres: 'Ana', apellidos: 'Torres', especialidad: 'Medicina General', activo: true, sedeId: 'los-olivos' },

    // San Miguel
    { id: 'doc-9', nombres: 'Roberto', apellidos: 'Vargas', especialidad: 'Podologo', activo: true, sedeId: 'san-miguel' },
    { id: 'doc-10', nombres: 'Elena', apellidos: 'Ramirez', especialidad: 'Podologa', activo: true, sedeId: 'san-miguel' },

    // One
    { id: 'doc-11', nombres: 'Patricia', apellidos: 'Castro', especialidad: 'Medicina General', activo: true, sedeId: 'one' },

    // Centro Centro
    { id: 'doc-12', nombres: 'Diego', apellidos: 'Flores', especialidad: 'Podologo', activo: true, sedeId: 'centro' },
    { id: 'doc-13', nombres: 'Maria', apellidos: 'Gutierrez', especialidad: 'Podologa', activo: true, sedeId: 'centro' },
  ];

  return todosLosDoctores.filter((doc) => doc.activo && doc.sedeId === sedeId);
}

/**
 * Citas de demostración para alimentar la vista por sede
 */
export function obtenerCitasEjemplo(sedeId: string): CitaAgenda[] {
  if (sedeId === 'principal') {
    return [
      { id: 'cita-1', doctorId: 'doc-1', horaInicio: '09:00', horaFin: '10:15', paciente: 'Mateo Ricci', motivo: 'Chequeo General', estado: 'AGENDADA' },
      { id: 'cita-2', doctorId: 'doc-3', horaInicio: '10:00', horaFin: '10:45', paciente: 'Lucia V.', motivo: 'Control Pediatría', estado: 'EN ATENCIÓN' },
      { id: 'cita-3', doctorId: 'doc-2', horaInicio: '11:00', horaFin: '11:30', paciente: 'S. Rojas', motivo: 'Consulta Inicial', estado: 'CONFIRMADA' },
      { id: 'cita-4', doctorId: 'doc-5', horaInicio: '11:00', horaFin: '11:45', paciente: 'Carlos D.', motivo: 'Tratamiento', estado: 'COMPLETADA' },
      { id: 'cita-5', doctorId: 'doc-6', horaInicio: '14:00', horaFin: '14:30', paciente: 'P. Gomez', motivo: 'Evaluación', estado: 'NO SHOW' },
    ];
  }
  return [
    { id: 'cita-6', doctorId: 'doc-7', horaInicio: '09:00', horaFin: '09:45', paciente: 'Jorge Ramos', motivo: 'Sesión Podológica', estado: 'CONFIRMADA' },
    { id: 'cita-7', doctorId: 'doc-9', horaInicio: '11:00', horaFin: '12:00', paciente: 'Andrea M.', motivo: 'Consulta Especializada', estado: 'EN ATENCIÓN' },
  ];
}
