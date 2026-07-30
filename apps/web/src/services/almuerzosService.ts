import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { sedesApi, profesionalesApi, citasApi } from '../api';
import { almuerzosApi, type BloqueoAlmuerzo } from '../api/almuerzos';
import { permisosApi } from '../api/permisos';
import { TURNOS_ALMUERZO, horasEnMinutos } from '@limablue/shared';

// ─────────────────────────────────────────────────────────────────────────────
//  SERVICE (BACK) de Horarios de Almuerzo
//  Todo el estado, queries, mutations y reglas de la vista viven aquí; el .tsx
//  (pages/herramientas/AlmuerzosPage.tsx) solo renderiza. Patrón idea1*Service.
// ─────────────────────────────────────────────────────────────────────────────

const NOMBRE_PAZ_SOLDAN = 'Paz Soldán';

export interface ProfesionalConAlmuerzo {
  id: string;
  nombres: string;
  apellidos: string;
  tipo: string;
  colorAvatar: string;
  almuerzo: BloqueoAlmuerzo | null;
  // Turno de HOY resuelto por el backend (para el mini-horario del popover).
  horaEntrada: string | null;
  horaSalida: string | null;
  // Motivo por el que hoy NO está disponible (va al grupo colapsado):
  //   'vacaciones' = permiso de vacaciones cubre el día · 'no_trabaja' = sin turno hoy.
  noDisponibleMotivo: 'vacaciones' | 'no_trabaja' | null;
}

export function useAlmuerzosData() {
  const qc = useQueryClient();
  const [sedeSelId, setSedeSelId] = useState<string>('');
  const [confirmando, setConfirmando] = useState<BloqueoAlmuerzo | null>(null);

  const hoy = format(new Date(), 'yyyy-MM-dd');

  const { data: sedes = [] } = useQuery({
    queryKey: ['sedes'],
    queryFn: sedesApi.listar,
  });

  // Auto-seleccionar primera sede
  const sedeId = sedeSelId || sedes[0]?.id || '';
  const sedeActual = sedes.find((s) => s.id === sedeId);
  const esPazSoldan = sedeActual?.nombre === NOMBRE_PAZ_SOLDAN;

  // Almuerzos vigentes de la sede
  const { data: bloqueos = [], isLoading: loadingBloqueos } = useQuery({
    queryKey: ['almuerzos', sedeId],
    queryFn: () => almuerzosApi.listar(sedeId),
    enabled: !!sedeId,
  });

  // Profesionales de la sede EN LA FECHA DE HOY: con `fecha` el backend resuelve la
  // asignación vigente ese día y el turno (horaEntrada/horaSalida) con el mismo
  // resolvedor del motor de reservas. horaEntrada=null → hoy no trabaja.
  const { data: profesionales = [], isLoading: loadingProfs } = useQuery({
    queryKey: ['profesionales-sede-hoy', sedeId, hoy],
    queryFn: () => profesionalesApi.listar({ sedeId, activo: true, fecha: hoy }),
    enabled: !!sedeId,
  });

  // Permisos del día (para detectar VACACIONES vigentes hoy)
  const { data: permisosHoy = [] } = useQuery({
    queryKey: ['permisos-agenda', sedeId, hoy],
    queryFn: () => permisosApi.listarPorFecha(sedeId, hoy),
    enabled: !!sedeId,
  });

  const idsEnVacaciones = useMemo(
    () => new Set(permisosHoy.filter((p) => p.esVacaciones).map((p) => p.profesionalId)),
    [permisosHoy],
  );

  // Elegibles del módulo: podólogas en todas las sedes; fisioterapeutas solo en Paz Soldán.
  const elegibles = useMemo(
    () => profesionales.filter((p) => p.tipo === 'podologa' || (p.tipo === 'fisioterapeuta' && esPazSoldan)),
    [profesionales, esPazSoldan],
  );

  // Cruce con almuerzos + disponibilidad de HOY (bug fix: vacaciones / sin turno hoy
  // ya no aparecen como asignables; van al grupo "No disponibles hoy").
  const conAlmuerzo: ProfesionalConAlmuerzo[] = useMemo(
    () =>
      elegibles.map((p) => ({
        id: p.id,
        nombres: p.nombres,
        apellidos: p.apellidos,
        tipo: p.tipo,
        colorAvatar: p.colorAvatar,
        almuerzo: bloqueos.find((b) => b.profesionalId === p.id) ?? null,
        horaEntrada: p.horaEntrada ?? null,
        horaSalida: p.horaSalida ?? null,
        noDisponibleMotivo: idsEnVacaciones.has(p.id)
          ? 'vacaciones'
          : p.horaEntrada == null
          ? 'no_trabaja'
          : null,
      })),
    [elegibles, bloqueos, idsEnVacaciones],
  );

  const disponibles = useMemo(() => conAlmuerzo.filter((p) => !p.noDisponibleMotivo), [conAlmuerzo]);
  const noDisponibles = useMemo(() => conAlmuerzo.filter((p) => p.noDisponibleMotivo), [conAlmuerzo]);

  // Distribución por turno (barras): proporcional al total de turnos asignados.
  const conteos = useMemo(() => {
    return TURNOS_ALMUERZO.map((t) => ({
      ...t,
      count: bloqueos.filter((b) => b.horaInicio === t.horaInicio).length,
    }));
  }, [bloqueos]);
  const maxConteo = Math.max(...conteos.map((c) => c.count), 1);

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => almuerzosApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['almuerzos', sedeId] });
      toast.success('Horario de almuerzo eliminado.');
      setConfirmando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    sedes,
    sedeId,
    setSedeSelId,
    sedeActual,
    loading: loadingBloqueos || loadingProfs,
    disponibles,
    noDisponibles,
    bloqueos,
    conteos,
    maxConteo,
    // Eliminación (modal de confirmación)
    confirmando,
    setConfirmando,
    eliminarMutation,
  };
}

// ─── Popover "Asignar": turno + ocupación del especialista HOY ────────────────

export interface OcupacionTurno {
  id: string;
  horaInicio: string;
  horaFin: string;
  label: string;
  citas: number; // citas VIVAS de hoy que tocan la franja (0 = libre para almorzar)
}

// Estados de cita que NO ocupan el horario (liberan la franja).
const ESTADOS_NO_OCUPAN = ['cancelada', 'reprogramada', 'no_show'];

// Bloque pintado en el mini-horario del día (cita del especialista).
export interface BloqueDia {
  iniMin: number;
  finMin: number;
  label: string; // "10:00 · Profilaxis"
}

export function useAsignarAlmuerzo(
  profesional: { id: string; nombres: string; apellidos: string; horaEntrada?: string | null; horaSalida?: string | null },
  sedeId: string,
  onClose: () => void,
) {
  const qc = useQueryClient();
  const [turnoSel, setTurnoSel] = useState<string>('');
  const hoy = format(new Date(), 'yyyy-MM-dd');

  // Citas de HOY del especialista → semáforo de franjas libres/ocupadas en el popover.
  const { data: citasHoy = [], isLoading: cargandoOcupacion } = useQuery({
    queryKey: ['citas-prof-hoy', sedeId, profesional.id, hoy],
    queryFn: () => citasApi.listar({ sedeId, fecha: hoy, profesionalId: profesional.id }),
    enabled: !!sedeId && !!profesional.id,
  });

  const ocupacion: OcupacionTurno[] = useMemo(() => {
    const vivas = (citasHoy ?? []).filter((c) => !ESTADOS_NO_OCUPAN.includes(c.estado));
    return TURNOS_ALMUERZO.map((t) => {
      const ini = horasEnMinutos(t.horaInicio);
      const fin = horasEnMinutos(t.horaFin);
      const citas = vivas.filter((c) => {
        const cIni = horasEnMinutos(c.horaInicio);
        const cFin = cIni + (c.duracionMinutos || 30);
        return cIni < fin && cFin > ini; // solapa la franja
      }).length;
      return { id: t.id, horaInicio: t.horaInicio, horaFin: t.horaFin, label: t.label, citas };
    });
  }, [citasHoy]);

  // ── Mini-horario (visualización del calendario del especialista) ──
  // Rango FIJO 12:00–15:00: es la única franja donde se habilitan almuerzos, así
  // que el horario se enfoca ahí (las citas fuera de la franja no aportan).
  const rangoDia = useMemo(() => ({ iniMin: 12 * 60, finMin: 15 * 60 }), []);

  const bloquesDia: BloqueDia[] = useMemo(() => {
    const vivas = (citasHoy ?? []).filter((c) => !ESTADOS_NO_OCUPAN.includes(c.estado));
    return vivas
      .map((c) => {
        const iniMin = horasEnMinutos(c.horaInicio);
        return {
          iniMin,
          finMin: iniMin + (c.duracionMinutos || 30),
          label: `${c.horaInicio} · ${c.servicio?.nombre ?? 'Cita'}`,
        };
      })
      .filter((b) => b.finMin > rangoDia.iniMin && b.iniMin < rangoDia.finMin)
      .sort((a, b) => a.iniMin - b.iniMin);
  }, [citasHoy, rangoDia]);

  // ── Conflicto: el turno elegido choca con citas YA agendadas hoy ──
  // Si hay choque se muestra el mini-banner y NO se permite registrar el almuerzo.
  const citasEnTurnoSel: BloqueDia[] = useMemo(() => {
    if (!turnoSel) return [];
    const ini = horasEnMinutos(turnoSel);
    const fin = ini + 60;
    return bloquesDia.filter((b) => b.iniMin < fin && b.finMin > ini);
  }, [turnoSel, bloquesDia]);
  const conflicto = citasEnTurnoSel.length > 0;

  const crearMutation = useMutation({
    mutationFn: () => almuerzosApi.crear({ profesionalId: profesional.id, sedeId, horaInicio: turnoSel }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['almuerzos', sedeId] });
      const turno = TURNOS_ALMUERZO.find((t) => t.horaInicio === turnoSel);
      toast.success(
        `Almuerzo de ${profesional.nombres.split(' ')[0]} ${profesional.apellidos.split(' ')[0]} registrado: ${turno?.label}`,
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Confirmación con candado: si el turno elegido tiene citas hoy, NO se registra.
  const confirmar = () => {
    if (!turnoSel || crearMutation.isPending) return;
    if (conflicto) {
      toast.error('Tiene cita agendada en la hora seleccionada — elige otro turno.');
      return;
    }
    crearMutation.mutate();
  };

  return {
    turnoSel,
    setTurnoSel,
    ocupacion,
    cargandoOcupacion,
    crearMutation,
    rangoDia,
    bloquesDia,
    conflicto,
    citasEnTurnoSel,
    confirmar,
  };
}
