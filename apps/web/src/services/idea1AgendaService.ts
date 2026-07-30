import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { sedesApi, profesionalesApi, citasApi, horariosApi } from '../api';
import { almuerzosApi } from '../api/almuerzos';
import { permisosApi } from '../api/permisos';
import { useAgendaStore } from '../stores/agendaStore';
import { useAuthStore } from '../stores/authStore';

export interface SlotHorario {
  hora: string; // "09:00", "09:30", etc.
  label: string;
  esMediaHora?: boolean;
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
  enVacaciones?: boolean;
  citasCount?: number;
  estadiaLabel?: string;
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
  estado: 'AGENDADA' | 'CONFIRMADA' | 'LLEGÓ' | 'EN ATENCIÓN' | 'COMPLETADA' | 'NO SHOW';
  raw?: any;
  esCombinada?: boolean;
  extraServicioNombre?: string;
  extraSubcategoriaNombre?: string;
  secundarioRaw?: any;
}

/* ==========================================================================
   1. HELPERS DE FECHA, HORA Y FORMATO DE NOMBRES
   ========================================================================== */

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
 * Formatea el nombre completo del doctor a "Primer Nombre + Primer Apellido"
 * Ej: "Glenda Milagritos" "Paredes Salinas" -> "Glenda Paredes"
 */
export function formatearNombreDoctor(nombres = '', apellidos = ''): string {
  const primerNombre = nombres.trim().split(/\s+/)[0] || '';
  const primerApellido = apellidos.trim().split(/\s+/)[0] || '';
  return `${primerNombre} ${primerApellido}`.trim() || 'Doctor';
}

/**
 * Convierte una hora HH:MM a minutos totales desde las 00:00
 */
export function timeToMinutes(timeStr = '00:00'): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Compara si dos fechas corresponden al mismo día (año, mes y día)
 */
export function esMismoDia(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Genera dinámicamente el rango de slots horarios para la agenda (cada 30 minutos)
 */
export function obtenerHorariosAgenda(inicio = 9, fin = 18): SlotHorario[] {
  const slots: SlotHorario[] = [];
  const finEfectivo = Math.max(inicio + 1, fin);
  for (let h = inicio; h < finEfectivo; h++) {
    const horaStr = `${h.toString().padStart(2, '0')}:00`;
    slots.push({
      hora: horaStr,
      label: horaStr,
      esMediaHora: false,
    });
    const horaMediaStr = `${h.toString().padStart(2, '0')}:30`;
    slots.push({
      hora: horaMediaStr,
      label: horaMediaStr,
      esMediaHora: true,
    });
  }
  return slots;
}

/**
 * Avatar por defecto limpio (SVG Data URI) si no hay foto de perfil
 */
export function getDefaultAvatar(nombre = 'Doctor'): string {
  const inicial = nombre.trim().charAt(0).toUpperCase() || 'D';
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%234537cd" rx="50"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-size="40" font-weight="bold">${inicial}</text></svg>`;
}

/* ==========================================================================
   2. TRANSFORMACIÓN Y MAPEO DE DATOS (CITAS Y ESTADÍAS)
   ========================================================================== */

/**
 * Transforma el listado de citas provenientes de la BD al modelo `CitaAgenda[]`
 */
export function mapearCitasDbACitaAgenda(citasDb: any[] = []): CitaAgenda[] {
  const mapped = citasDb.map((c) => {
    const hInicio = c.horaInicio || '09:00';
    const duracion = c.duracionMinutos || 30;
    const [h, m] = hInicio.split(':').map(Number);
    const totalMin = (h || 0) * 60 + (m || 0) + duracion;
    const endH = Math.floor(totalMin / 60);
    const endM = totalMin % 60;
    const hFin = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

    let estadoNormalizado: CitaAgenda['estado'] = 'AGENDADA';
    const st = (c.estado || '').toLowerCase();
    if (st === 'en_atencion' || st === 'en atencion' || st === 'en atención') estadoNormalizado = 'EN ATENCIÓN';
    else if (st === 'llego' || st === 'llegó') estadoNormalizado = 'LLEGÓ';
    else if (st === 'confirmada') estadoNormalizado = 'CONFIRMADA';
    else if (st === 'completada') estadoNormalizado = 'COMPLETADA';
    else if (st === 'no_show' || st === 'no show') estadoNormalizado = 'NO SHOW';

    let etiquetaAsignacion = '';
    if (c.origenAsignacion === 'elegida_por_paciente' || c.solicitadoProfesional) {
      const primerNombre =
        c.solicitadoProfesional?.nombres?.split(' ')[0] ||
        c.profesional?.nombres?.split(' ')[0] ||
        '';
      if (primerNombre) etiquetaAsignacion = `Solo ${primerNombre}`;
    }

    const pacienteNombre = c.paciente
      ? `${c.paciente.nombres} ${c.paciente.apellidoPaterno || ''} ${c.paciente.apellidoMaterno || ''}`.trim()
      : 'Paciente';

    const targetDoctorId = c.profesionalId || (c as any).solicitadoProfesionalId || c.solicitadoProfesional?.id || '';

    return {
      id: c.id,
      doctorId: targetDoctorId,
      horaInicio: hInicio,
      horaFin: hFin,
      duracionMinutos: duracion,
      paciente: pacienteNombre,
      motivo: c.servicio?.nombre || 'Consulta Médica',
      servicioNombre: c.servicio?.nombre,
      subcategoriaNombre: c.subcategoria?.nombre,
      etiquetaAsignacion,
      estado: estadoNormalizado,
      raw: c,
    };
  });

  // Agrupar citas combinadas (slotGrupoId) por doctor
  const result: CitaAgenda[] = [];
  const procesadosGrupo = new Set<string>();

  const grupos = new Map<string, CitaAgenda[]>();
  mapped.forEach((item) => {
    if (item.raw?.slotGrupoId) {
      const arr = grupos.get(item.raw.slotGrupoId) || [];
      arr.push(item);
      grupos.set(item.raw.slotGrupoId, arr);
    }
  });

  mapped.forEach((item) => {
    const grupoId = item.raw?.slotGrupoId;
    if (!grupoId) {
      result.push(item);
      return;
    }

    if (procesadosGrupo.has(grupoId)) return;

    const mitades = grupos.get(grupoId) || [];
    if (mitades.length >= 2) {
      const principal = mitades.find((m) => m.raw?.slotRol === 'PRINCIPAL') || mitades[0];
      const secundario = mitades.find((m) => m.raw?.slotRol === 'SECUNDARIO') || mitades.find((m) => m.id !== principal.id) || mitades[1];

      if (principal.doctorId === secundario.doctorId) {
        procesadosGrupo.add(grupoId);

        const duracionTotal = principal.duracionMinutos || 60;
        const [h, m] = principal.horaInicio.split(':').map(Number);
        const totalMin = (h || 0) * 60 + (m || 0) + duracionTotal;
        const endH = Math.floor(totalMin / 60);
        const endM = totalMin % 60;
        const hFinCombined = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

        result.push({
          ...principal,
          duracionMinutos: duracionTotal,
          horaFin: hFinCombined,
          esCombinada: true,
          extraServicioNombre: secundario.servicioNombre || secundario.motivo,
          extraSubcategoriaNombre: secundario.subcategoriaNombre,
          secundarioRaw: secundario.raw,
        });
        return;
      }
    }

    result.push(item);
  });

  // NO SHOW visible salvo que otra cita ACTIVA del mismo profesional se solape
  // en tiempo con ella. Se usa el estado real de DB (`raw.estado`) para no
  // depender del mapping visual; cancelada/reprogramada/no_show NO son activas.
  const inactivos = new Set(['cancelada', 'reprogramada', 'no_show']);
  const esActivaEnDb = (c: CitaAgenda) => !inactivos.has(String(c.raw?.estado || '').toLowerCase());
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const rangosActivosPorDoctor = new Map<string, { ini: number; fin: number }[]>();
  result.forEach((c) => {
    if (!esActivaEnDb(c)) return;
    const ini = toMin(c.horaInicio);
    const fin = ini + (c.duracionMinutos || 30);
    const arr = rangosActivosPorDoctor.get(c.doctorId) || [];
    arr.push({ ini, fin });
    rangosActivosPorDoctor.set(c.doctorId, arr);
  });
  return result.filter((c) => {
    if (String(c.raw?.estado || '').toLowerCase() !== 'no_show') return true;
    const ini = toMin(c.horaInicio);
    const fin = ini + (c.duracionMinutos || 30);
    const activas = rangosActivosPorDoctor.get(c.doctorId) || [];
    const seSolapa = activas.some((a) => ini < a.fin && a.ini < fin);
    return !seSolapa;
  });
}

/**
 * Formatea la fecha de fin de asignación/préstamo al formato "Hasta el D de MMM" (ej: "Hasta el 31 de jul")
 */
export function formatearEstadiaFin(fechaFinInput?: any): string | null {
  if (!fechaFinInput) return null;
  let str = '';
  if (fechaFinInput instanceof Date) {
    str = fechaFinInput.toISOString().split('T')[0];
  } else if (typeof fechaFinInput === 'string') {
    str = fechaFinInput.split('T')[0].trim();
  } else {
    str = String(fechaFinInput).split('T')[0].trim();
  }

  const parts = str.split(/[-/]/);
  if (parts.length !== 3) return null;

  let day = 0;
  let monthIdx = 0;

  if (parts[0].length === 4) {
    // YYYY-MM-DD
    day = parseInt(parts[2], 10);
    monthIdx = parseInt(parts[1], 10) - 1;
  } else {
    // DD-MM-YYYY
    day = parseInt(parts[0], 10);
    monthIdx = parseInt(parts[1], 10) - 1;
  }

  const mesesAbrev = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  const mes = mesesAbrev[monthIdx];
  if (!mes || isNaN(day) || day < 1 || day > 31) return null;
  return `Hasta el ${day} de ${mes}`;
}

/**
 * Extrae la etiqueta de estadía/préstamo a partir del objeto de profesional o sus asignaciones
 */
export function extraerEstadiaLabel(p: any): string | undefined {
  if (!p) return undefined;

  const asgDirecta = p.asignacionActual || p.asignacion;

  // 1. Si es un préstamo explícito de otra sede solo por un día
  const esPrestamo = asgDirecta?.esPrestamo ?? p?.esPrestamo;
  if (esPrestamo) {
    const origen = asgDirecta?.sedeOrigen || p?.sedeOrigen || '';
    return `Préstamo ${origen}`.trim();
  }

  // 2. Buscar fechaFin en asignacionActual, asignacion, o directamente en p
  const fechaFinDirecta = asgDirecta?.fechaFin ?? asgDirecta?.fecha_fin ?? p?.fechaFin ?? p?.fecha_fin;
  if (fechaFinDirecta) {
    const fmt = formatearEstadiaFin(fechaFinDirecta);
    if (fmt) return fmt;
  }

  // 3. Buscar cualquier asignación en p.asignaciones que tenga fechaFin
  if (Array.isArray(p.asignaciones)) {
    const asgConFecha = p.asignaciones.find((a: any) => a && (a.fechaFin || a.fecha_fin));
    if (asgConFecha) {
      const fmt = formatearEstadiaFin(asgConFecha.fechaFin || asgConFecha.fecha_fin);
      if (fmt) return fmt;
    }
  }

  // 4. Movimiento o refuerzo sin fechaFin
  const esMovimiento = asgDirecta?.esMovimiento ?? p?.esMovimiento;
  if (esMovimiento) {
    const motivoLabel = asgDirecta?.motivo || p?.motivo || 'Refuerzo';
    return motivoLabel;
  }

  return undefined;
}

/* ==========================================================================
   3. PROCESAMIENTO Y ORDENAMIENTO DE DOCTORES
   ========================================================================== */

/**
 * Procesa y ordena el listado de doctores para la grilla de agenda:
 * 1º Doctores con vacaciones pasan al FINAL (derecha)
 * 2º Los demás mantienen el orden de llegada en la lista original (sin prioridad por citas)
 */
export function procesarYOrdenarDoctores(params: {
  profesionalesDb?: any[];
  citasDb?: any[];
  citasAgenda: CitaAgenda[];
  seleccionablesDb?: any[];
  activeUnidadName: string;
  sedeId?: string | null;
}): DoctorAgenda[] {
  const {
    profesionalesDb = [],
    citasDb = [],
    citasAgenda = [],
    seleccionablesDb = [],
    activeUnidadName,
    sedeId = '',
  } = params;

  const doctoresMap = new Map<string, DoctorAgenda>();

  profesionalesDb.forEach((p) => {
    const estadiaLabel = extraerEstadiaLabel(p);

    doctoresMap.set(p.id, {
      id: p.id,
      nombres: p.nombres,
      apellidos: p.apellidos,
      especialidad: p.tipo || activeUnidadName,
      activo: p.activo,
      sedeId: p.sedeActual?.id || sedeId || '',
      avatarUrl: undefined,
      estadiaLabel,
    });
  });

  citasDb.forEach((c) => {
    const p = c.profesional || c.solicitadoProfesional;
    const pId = c.profesionalId || (c as any).solicitadoProfesionalId || c.solicitadoProfesional?.id;
    if (pId) {
      const estadia = extraerEstadiaLabel(p);
      if (!doctoresMap.has(pId)) {
        doctoresMap.set(pId, {
          id: pId,
          nombres: p?.nombres || 'Doctor',
          apellidos: p?.apellidos || '',
          especialidad: activeUnidadName,
          activo: true,
          sedeId: sedeId || '',
          estadiaLabel: estadia,
        });
      } else if (estadia && !doctoresMap.get(pId)!.estadiaLabel) {
        doctoresMap.get(pId)!.estadiaLabel = estadia;
      }
    }
  });

  return Array.from(doctoresMap.values())
    .map((doc) => {
      const sel = seleccionablesDb.find((s) => s.id === doc.id);
      const tieneVacaciones =
        sel?.bloqueos?.some((b: any) => {
          if (b.esVacaciones) return true;
          const m = (b.motivo || '').toLowerCase();
          const t = (b.tipo || '').toLowerCase();
          return m.includes('vacac') || t.includes('vacac') || m.includes('licencia');
        }) || false;

      const count = citasAgenda.filter((c) => c.doctorId === doc.id).length;

      return {
        ...doc,
        enVacaciones: tieneVacaciones,
        citasCount: count,
      };
    })
    .sort((a, b) => {
      // Regla 1: Doctores en vacaciones pasan AL FINAL (derecha)
      if (a.enVacaciones && !b.enVacaciones) return 1;
      if (!a.enVacaciones && b.enVacaciones) return -1;

      // Regla 2: Mantener el orden original de llegada de la lista (sin orden por citas)
      return 0;
    });
}

/* ==========================================================================
   4. CÁLCULOS DE CÁLCULO DE LAYOUT Y HORARIOS
   ========================================================================== */

/**
 * Extrae el horario comercial base de apertura/cierre de la sede
 */
export function extraerHorarioBaseEfectivo(horarioData: any): { baseHoraInicioInt: number; baseHoraFinInt: number } {
  let baseHoraInicioInt = 8;
  let baseHoraFinInt = 20;

  if (horarioData?.efectivo?.abierto && horarioData.efectivo.apertura && horarioData.efectivo.cierre) {
    const aperturaH = parseInt(horarioData.efectivo.apertura.split(':')[0], 10);
    const cierreH = parseInt(horarioData.efectivo.cierre.split(':')[0], 10);
    if (!isNaN(aperturaH) && !isNaN(cierreH) && aperturaH < cierreH) {
      baseHoraInicioInt = aperturaH;
      baseHoraFinInt = cierreH;
    }
  }

  return { baseHoraInicioInt, baseHoraFinInt };
}

/**
 * Calcula el rango horario dinámico de la grilla si existen citas agendadas fuera del horario comercial regular
 */
export function calcularRangoHorarioAgenda(
  horaInicioBase: number,
  horaFinBase: number,
  citas: CitaAgenda[]
): { horaInicioInt: number; horaFinInt: number } {
  let hInicio = horaInicioBase;
  let hFin = horaFinBase;

  if (citas.length > 0) {
    citas.forEach((c) => {
      const startH = parseInt(c.horaInicio.split(':')[0], 10);
      if (!isNaN(startH)) {
        if (startH < hInicio) hInicio = startH;
        const [h, m] = c.horaInicio.split(':').map(Number);
        const endMin = (h || 0) * 60 + (m || 0) + (c.duracionMinutos || 30);
        const endH = Math.ceil(endMin / 60);
        if (endH > hFin) hFin = endH;
      }
    });
  }

  return { horaInicioInt: hInicio, horaFinInt: hFin };
}

/**
 * Genera la propiedad CSS gridTemplateColumns dinámicamente para la grilla de doctores.
 * Los pixeles de columna de hora y ancho mínimo del doctor son parametrizables para
 * poder compactarlos en pantallas chicas (móvil/tablet).
 */
export function calcularGridTemplateColsCss(
  numDoctores: number,
  opts: { maxVisible?: number; timeColPx?: number; minDoctorColPx?: number } = {},
): string {
  const { maxVisible = 6, timeColPx = 80, minDoctorColPx = 180 } = opts;
  const count = Math.max(numDoctores, 1);
  const visibleCols = Math.min(count, maxVisible);
  const doctorColWidthCss = `calc(max(${minDoctorColPx}px, (100% - ${timeColPx}px) / ${visibleCols}))`;
  return `${timeColPx}px repeat(${count}, ${doctorColWidthCss})`;
}

/**
 * Extrae y formatea las métricas agregadas del día para las tarjetas superiores
 */
export function extraerMetricasCitas(
  statsDb: any,
  citas: CitaAgenda[]
): {
  totalCitas: number;
  llegadasCitas: number;
  completadasCitas: number;
  noShowCitas: number;
} {
  const totalCitas = statsDb?.total ?? citas.length;
  const llegadasCitas = (statsDb?.llegaron ?? 0) + (statsDb?.confirmadas ?? 0);
  const completadasCitas = statsDb?.completadas ?? 0;
  const noShowCitas = statsDb?.noShows ?? 0;

  return { totalCitas, llegadasCitas, completadasCitas, noShowCitas };
}

/**
 * Genera dinámicamente los atajos rápidos de fecha ("Hoy", "Mañana", "Sábado")
 */
export function obtenerAtajosFechaRapidos(referenciaDate: Date = new Date()): { label: string; date: Date }[] {
  const today = new Date(referenciaDate.getFullYear(), referenciaDate.getMonth(), referenciaDate.getDate());

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayOfWeek = today.getDay();
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
  const nextSaturday = new Date(today);
  if (daysUntilSaturday === 0) {
    nextSaturday.setDate(nextSaturday.getDate() + 7);
  } else {
    nextSaturday.setDate(nextSaturday.getDate() + daysUntilSaturday);
  }

  const isTomorrowSaturday = tomorrow.getTime() === nextSaturday.getTime();

  if (isTomorrowSaturday) {
    return [
      { label: 'Hoy', date: today },
      { label: 'Sábado', date: tomorrow },
    ];
  }

  return [
    { label: 'Hoy', date: today },
    { label: 'Mañana', date: tomorrow },
    { label: 'Sábado', date: nextSaturday },
  ];
}

/**
 * Calcula la posición top en pixeles de la línea de hora actual en la grilla
 */
export function calcularTopPxLineaActual(horaInicioInt: number, rowHeight = 100): number {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startGridMinutes = horaInicioInt * 60;
  return ((currentMinutes - startGridMinutes) / 60) * rowHeight;
}

/* ==========================================================================
   5. HOOK PERSONALIZADO DE INTEGRACIÓN CON REACT (DATOS + ESTADO)
   ========================================================================== */

/**
 * Custom Hook que encapsula toda la carga de datos, estados de UI, queries y
 * sincronización de scrollbars para Idea1AgendaPage
 */
export function useIdea1AgendaData() {
  const { sedeId, setSedeId, fecha, setFecha, unidadNegocioId, setUnidadNegocioId, fechaStr } = useAgendaStore();

  // Estado y ref para el desplegable de Sedes y Paleta de Comandos
  const [isSedeOpen, setIsSedeOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const sedeDropdownRef = useRef<HTMLDivElement>(null);

  // Cerrar desplegable de sede al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sedeDropdownRef.current && !sedeDropdownRef.current.contains(event.target as Node)) {
        setIsSedeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { usuario, puedeAccederSede } = useAuthStore();

  // 1. Cargar sedes desde la Base de Datos
  const { data: sedesDbRaw } = useQuery({
    queryKey: ['sedes'],
    queryFn: sedesApi.listar,
  });

  // Filtrar las sedes según los permisos del usuario (si es recepcionista, solo sus sedes asignadas)
  const sedesDb = useMemo(() => {
    if (!sedesDbRaw) return [];
    if (!usuario) return sedesDbRaw;
    if (usuario.permisos?.includes('admin.ver') || ['admin', 'coordinadora_sedes'].includes(usuario.rol)) {
      return sedesDbRaw;
    }
    return sedesDbRaw.filter((s) => puedeAccederSede(s.id));
  }, [sedesDbRaw, usuario, puedeAccederSede]);

  // Auto-seleccionar sede permitida (si no hay seleccionada o la actual no está permitida)
  useEffect(() => {
    if (sedesDb && sedesDb.length > 0) {
      const esValida = sedesDb.some((s) => s.id === sedeId);
      if (!sedeId || !esValida) {
        setSedeId(sedesDb[0].id);
      }
    }
  }, [sedesDb, sedeId, setSedeId]);

  const activeSedeDb = sedesDb?.find((s) => s.id === sedeId);
  const unidadesDisponibles = activeSedeDb?.unidadesNegocio || [];

  // Auto-seleccionar por defecto el área de Podología
  useEffect(() => {
    if (unidadesDisponibles.length > 0) {
      if (!unidadNegocioId || !unidadesDisponibles.find((u) => u.id === unidadNegocioId)) {
        const podologia = unidadesDisponibles.find((u) =>
          u.nombre.toLowerCase().includes('podolog')
        );
        setUnidadNegocioId(podologia ? podologia.id : unidadesDisponibles[0].id);
      }
    }
  }, [unidadesDisponibles, unidadNegocioId, setUnidadNegocioId]);

  const activeSedeName = activeSedeDb?.nombre || 'Seleccionar Sede';
  const activeUnidad = unidadesDisponibles.find((u) => u.id === unidadNegocioId) || unidadesDisponibles[0];
  const activeUnidadName = activeUnidad?.nombre || 'Podología';

  // 2. Horario efectivo de la sede en la fecha seleccionada
  const { data: horarioData } = useQuery({
    queryKey: ['horario', sedeId, fechaStr()],
    queryFn: () => horariosApi.efectivo(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });

  const { baseHoraInicioInt, baseHoraFinInt } = extraerHorarioBaseEfectivo(horarioData);

  // 3. Citas desde la Base de Datos
  const { data: citasDb } = useQuery({
    queryKey: ['citas', 'idea1', sedeId, unidadNegocioId, fechaStr()],
    queryFn: () =>
      citasApi.listar({
        sedeId: sedeId!,
        unidadNegocioId: unidadNegocioId!,
        fecha: fechaStr(),
      }),
    enabled: !!sedeId && !!unidadNegocioId,
    refetchInterval: 5_000,
  });

  // 4. Doctores/Profesionales desde la Base de Datos
  const { data: profesionalesDb } = useQuery({
    queryKey: ['profesionales-sede', sedeId, unidadNegocioId, fechaStr()],
    queryFn: () =>
      profesionalesApi.listar({
        sedeId: sedeId!,
        unidadNegocioId: unidadNegocioId!,
        fecha: fechaStr(),
        activo: true,
      }),
    enabled: !!sedeId && !!unidadNegocioId,
  });

  // 5. Query de seleccionables para detectar bloqueos y vacaciones
  const { data: seleccionablesDb } = useQuery({
    queryKey: ['seleccionables', sedeId, unidadNegocioId, fechaStr()],
    queryFn: async () => {
      try {
        if (!sedeId || !unidadNegocioId) return [];
        return await profesionalesApi.seleccionables({
          sedeId,
          unidadNegocioId,
          fecha: fechaStr(),
        });
      } catch (err) {
        console.warn('Error al cargar seleccionables/bloqueos:', err);
        return [];
      }
    },
    enabled: !!sedeId && !!unidadNegocioId,
  });

  // 5b. Bloqueos de almuerzo de la sede en la fecha actual
  const { data: bloqueosAlmuerzo = [] } = useQuery({
    queryKey: ['bloqueos-almuerzo', sedeId, fechaStr()],
    queryFn: () => almuerzosApi.listarPorFecha(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });

  // 5c. Permisos / bloqueos manuales de la sede en la fecha actual
  const { data: permisosAgenda = [] } = useQuery({
    queryKey: ['permisos-agenda', sedeId, fechaStr()],
    queryFn: () => permisosApi.listarPorFecha(sedeId!, fechaStr()),
    enabled: !!sedeId,
    staleTime: 60 * 1000,
  });

  // 5d. Turnos efectivos de cada profesional en la fecha
  const { data: turnosProfesionales = {} } = useQuery<Record<string, { horaInicio: string; horaFin: string } | null>>({
    queryKey: ['turnos-profesionales', sedeId, fechaStr()],
    queryFn: () => horariosApi.turnosProfesionales(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });

  // 6. Transformación y ordenamiento con el módulo de servicios
  const citas: CitaAgenda[] = mapearCitasDbACitaAgenda(citasDb || []);

  const doctores: DoctorAgenda[] = procesarYOrdenarDoctores({
    profesionalesDb,
    citasDb,
    citasAgenda: citas,
    seleccionablesDb,
    activeUnidadName,
    sedeId,
  });

  const { horaInicioInt, horaFinInt } = calcularRangoHorarioAgenda(baseHoraInicioInt, baseHoraFinInt, citas);
  const horarios: SlotHorario[] = obtenerHorariosAgenda(horaInicioInt, horaFinInt);

  // 7. Estadísticas de citas del día desde la BD
  const { data: statsDb } = useQuery({
    queryKey: ['stats', sedeId, fechaStr()],
    queryFn: () => citasApi.stats(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });

  const { totalCitas, llegadasCitas, completadasCitas, noShowCitas } = extraerMetricasCitas(statsDb, citas);

  // Sincronización y manejo del scroll superior/inferior
  const topScrollRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);
  const [scrollContentWidth, setScrollContentWidth] = useState(0);
  const [hasHorizontalScroll, setHasHorizontalScroll] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;

    const checkOverflow = () => {
      if (el) {
        setScrollContentWidth(el.scrollWidth);
        setContainerWidth(el.clientWidth);
        const hasOverflow = el.scrollWidth > el.clientWidth + 2;
        setHasHorizontalScroll(hasOverflow);
      }
    };

    checkOverflow();
    const timer = setTimeout(checkOverflow, 300);

    const ro = new ResizeObserver(() => {
      checkOverflow();
    });
    ro.observe(el);
    // Respaldo: algunos entornos no propagan cambios de viewport al RO del hijo
    // hasta el próximo layout. Escuchar `resize` garantiza el ajuste inmediato.
    window.addEventListener('resize', checkOverflow);

    return () => {
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener('resize', checkOverflow);
    };
  }, [doctores.length, sedeId, unidadNegocioId]);

  const handleTopScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (topScrollRef.current && mainScrollRef.current) {
      mainScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  };

  const handleMainScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (topScrollRef.current && mainScrollRef.current) {
      topScrollRef.current.scrollLeft = mainScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 8. Atajos de fecha y calculadores de renderizado de la grilla
  const quickShortcuts = obtenerAtajosFechaRapidos();
  const ROW_HEIGHT = 100;
  const now = new Date();
  const currentTimeTopPx = calcularTopPxLineaActual(horaInicioInt, ROW_HEIGHT);
  const isCurrentDayActive = esMismoDia(fecha, now);
  // Adapta el ancho de la columna de hora y el mínimo de cada doctor al ancho real
  // del contenedor. En pantallas chicas: hora más angosta (56px) y doctor más compacto
  // (140px), de modo que quepan más columnas sin apilarse y con menos scroll horizontal.
  const isMobileGrid = containerWidth < 768;
  const gridTemplateColsCss = calcularGridTemplateColsCss(doctores.length, {
    maxVisible: 6,
    timeColPx: isMobileGrid ? 56 : 80,
    minDoctorColPx: isMobileGrid ? 140 : 180,
  });

  const qc = useQueryClient();

  const moverMutation = useMutation({
    mutationFn: ({
      citaId,
      slotGrupoId,
      profesionalId,
      fecha,
      horaInicio,
      origenAsignacion,
    }: {
      citaId: string;
      slotGrupoId?: string | null;
      profesionalId: string;
      fecha: string;
      horaInicio: string;
      origenAsignacion?: string;
    }) =>
      slotGrupoId
        ? citasApi.moverGrupo(slotGrupoId, { profesionalId, fecha, horaInicio, origenAsignacion })
        : citasApi.mover(citaId, { profesionalId, fecha, horaInicio, origenAsignacion }),
    onSuccess: (citaActualizada) => {
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      qc.invalidateQueries({ queryKey: ['citas'] });
      const pNombre = citaActualizada.paciente
        ? `${citaActualizada.paciente.nombres} ${citaActualizada.paciente.apellidoPaterno || ''}`
        : 'Cita';
      toast.success(`Cita de ${pNombre.trim()} movida correctamente a las ${citaActualizada.horaInicio}`, { duration: 3000 });
    },
    onError: (e: any) => toast.error(e?.message || 'Error al mover la cita'),
  });

  return {
    // Store
    sedeId,
    setSedeId,
    fecha,
    setFecha,
    unidadNegocioId,
    setUnidadNegocioId,
    fechaStr,
    // Sedes y Unidades
    sedesDb,
    activeSedeDb,
    unidadesDisponibles,
    activeSedeName,
    activeUnidad,
    activeUnidadName,
    isSedeOpen,
    setIsSedeOpen,
    sedeDropdownRef,
    isPaletteOpen,
    setIsPaletteOpen,
    // Datos transformados
    citas,
    doctores,
    bloqueosAlmuerzo,
    permisosAgenda,
    turnosProfesionales,
    horarioEfectivo: horarioData?.efectivo,
    horarios,
    horaInicioInt,
    horaFinInt,
    // Métricas
    totalCitas,
    llegadasCitas,
    completadasCitas,
    noShowCitas,
    // Scroll refs & sync
    topScrollRef,
    mainScrollRef,
    handleTopScroll,
    handleMainScroll,
    scrollContentWidth,
    hasHorizontalScroll,
    ROW_HEIGHT,
    now,
    // Render helpers
    quickShortcuts,
    currentTimeTopPx,
    isCurrentDayActive,
    gridTemplateColsCss,
    // Acciones
    handleMoverCita: moverMutation.mutateAsync,
    isMoving: moverMutation.isPending,
  };
}
