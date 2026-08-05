import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { sedesApi, profesionalesApi } from '../api';
import { permisosApi, type Permiso } from '../api/permisos';
import { citasApi } from '../api/citas';
import { useAuthStore } from '../stores/authStore';

// Opciones de hora 08:00 … 20:00 cada 30 min
export const HORAS_PERMISOS: string[] = [];
for (let m = 8 * 60; m <= 20 * 60; m += 30) {
  HORAS_PERMISOS.push(
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
  );
}

export function hoyISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

export const tipoLabel = (t: string) =>
  t === 'podologa'
    ? 'Podóloga'
    : t === 'fisioterapeuta'
    ? 'Fisioterapeuta'
    : t === 'medico'
    ? 'Baropodometría'
    : t;

export function usePermisosData(overrideSedeId?: string) {
  const qc = useQueryClient();
  const { usuario, puedeAccederSede, tiene } = useAuthStore();
  const puedeGestionar = tiene('horarios.editar');

  const [sedeSelId, setSedeSelId] = useState(overrideSedeId ?? '');

  useEffect(() => {
    if (overrideSedeId) {
      setSedeSelId(overrideSedeId);
    }
  }, [overrideSedeId]);
  const [fecha, setFecha] = useState<string>(hoyISO());

  // Formulario — se puede bloquear a uno o VARIOS profesionales a la vez.
  const [profesionalIds, setProfesionalIds] = useState<string[]>([]);
  const [desde, setDesde] = useState('09:00');
  const [hasta, setHasta] = useState('13:00');
  const [motivo, setMotivo] = useState('');

  // Vacaciones: rango de fechas.
  const [vacInicio, setVacInicio] = useState<string>(hoyISO());
  const [vacFin, setVacFin] = useState<string>(hoyISO());

  // Edición inline de una vacación.
  const [editVac, setEditVac] = useState<{ ids: string[]; sedeId: string } | null>(null);
  const [editIni, setEditIni] = useState('');
  const [editFin, setEditFin] = useState('');
  const [editMotivo, setEditMotivo] = useState('');

  // Modo del formulario
  const [modo, setModo] = useState<'individual' | 'reunion' | 'enfermedad' | 'vacaciones'>(
    'individual',
  );

  // Destinatario de la reunión
  const [destinatario, setDestinatario] = useState<'daniel' | 'yasica' | 'ambos'>('ambos');

  // Pacientes en conflicto
  const [citasConflicto, setCitasConflicto] = useState<
    { horaInicio: string; paciente: string; telefono: string; servicio: string; estado: string }[]
  >([]);

  // Pacientes cuyas citas se CANCELARON al reportar enfermedad
  const [pacientesAfectados, setPacientesAfectados] = useState<
    { horaInicio: string; paciente: string; telefono: string; servicio: string; estado: string }[]
    | null
  >(null);

  // Sedes permitidas
  const { data: sedesRaw = [] } = useQuery({
    queryKey: ['sedes'],
    queryFn: sedesApi.listar,
  });

  const sedes = useMemo(() => {
    if (!sedesRaw.length) return [];
    if (!usuario) return sedesRaw;
    if (
      usuario.permisos?.includes('admin.ver') ||
      ['admin', 'coordinadora_sedes'].includes(usuario.rol)
    ) {
      return sedesRaw;
    }
    return sedesRaw.filter((s) => puedeAccederSede(s.id));
  }, [sedesRaw, usuario, puedeAccederSede]);

  const sedeId = sedeSelId || sedes[0]?.id || '';
  const sedeActual = sedes.find((s) => s.id === sedeId);

  // Profesionales elegibles
  const { data: profesionales = [] } = useQuery({
    queryKey: ['profesionales-sede', sedeId, fecha],
    queryFn: () => profesionalesApi.listar({ sedeId, fecha, activo: true }),
    enabled: !!sedeId && puedeGestionar,
  });

  const getOrderWeight = (tipo: string) => {
    if (tipo === 'podologa') return 1;
    if (tipo === 'medico') return 2; // Baropodometría
    if (tipo === 'fisioterapeuta') return 3;
    return 4;
  };

  const elegibles = useMemo(
    () =>
      profesionales
        .filter(
          (p) => p.tipo === 'podologa' || p.tipo === 'fisioterapeuta' || p.tipo === 'medico',
        )
        .sort((a, b) => {
          const wA = getOrderWeight(a.tipo);
          const wB = getOrderWeight(b.tipo);
          if (wA !== wB) return wA - wB;
          return a.nombres.localeCompare(b.nombres);
        }),
    [profesionales],
  );

  // Permisos del día
  const { data: permisos = [], isLoading: loadingPermisos } = useQuery({
    queryKey: ['permisos', sedeId, fecha],
    queryFn: () => permisosApi.listarPorFecha(sedeId, fecha),
    enabled: !!sedeId && puedeGestionar,
  });

  // Vacaciones vigentes
  const vacacionesVigentes = useQuery({
    queryKey: ['vacaciones-vigentes'],
    queryFn: () => permisosApi.listarVacaciones(),
    enabled: puedeGestionar,
  });

  // Vacaciones preview (dry-run)
  const vacRangoOk = !!vacInicio && !!vacFin && vacFin >= vacInicio;
  const vacPreview = useQuery({
    queryKey: [
      'vacaciones-preview',
      sedeId,
      [...profesionalIds].sort().join(','),
      vacInicio,
      vacFin,
    ],
    queryFn: () =>
      permisosApi.previewVacaciones({
        profesionalIds,
        sedeId,
        fechaInicio: vacInicio,
        fechaFin: vacFin,
      }),
    enabled:
      puedeGestionar && modo === 'vacaciones' && !!sedeId && profesionalIds.length > 0 && vacRangoOk,
    staleTime: 20 * 1000,
  });

  const toggleProf = (id: string) => {
    setProfesionalIds((prev) =>
      modo === 'enfermedad'
        ? prev[0] === id
          ? []
          : [id]
        : prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id],
    );
  };

  const selectAllProfs = () => {
    setProfesionalIds(elegibles.map((p) => p.id));
    setCitasConflicto([]);
  };

  const clearSelectedProfs = () => {
    setProfesionalIds([]);
    setCitasConflicto([]);
  };

  const invalidarVacaciones = () => {
    qc.invalidateQueries({ queryKey: ['vacaciones-vigentes'] });
    qc.invalidateQueries({ queryKey: ['permisos'] });
    qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
    qc.invalidateQueries({ queryKey: ['disponibilidad'] });
  };

  const crearMut = useMutation({
    mutationFn: () =>
      permisosApi.crearMultiple({
        profesionalIds,
        sedeId,
        fecha,
        horaInicio: desde,
        horaFin: hasta,
        motivo: motivo.trim(),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['permisos', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
      const conflictos = r.conflictos.flatMap((c) =>
        c.citas.map((x) => ({ ...x, paciente: `${c.nombre}: ${x.paciente}` })),
      );
      setCitasConflicto(conflictos);
      if (r.creados.length > 0) {
        toast.success(
          `Bloqueado(s): ${r.creados.map((c) => c.nombre).join(', ')}` +
            (r.conflictos.length > 0
              ? ` · No se pudo con ${r.conflictos
                  .map((c) => c.nombre)
                  .join(', ')} (tienen pacientes)`
              : ''),
        );
        setProfesionalIds(r.conflictos.map((c) => c.profesionalId));
        if (r.conflictos.length === 0) setMotivo('');
      } else {
        toast.error(
          `Ninguno se bloqueó: ${r.conflictos.map((c) => c.nombre).join(', ')} tienen pacientes en ese rango`,
        );
      }
    },
    onError: (e: Error) => {
      setCitasConflicto([]);
      toast.error(e.message);
    },
  });

  const crearReunionMut = useMutation({
    mutationFn: () =>
      permisosApi.crearReunion({
        fecha,
        horaInicio: desde,
        horaFin: hasta,
        motivo: motivo.trim(),
        destinatario,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['permisos'] });
      qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
      toast.success(`Reunión agendada en ${r.profesionales.join(' y ')}`);
      setMotivo('');
      setCitasConflicto([]);
    },
    onError: (e: Error & { data?: { citas?: typeof citasConflicto } }) => {
      if (e.data?.citas?.length) {
        setCitasConflicto(e.data.citas);
        toast.error('Hay pacientes agendados en ese rango');
      } else {
        setCitasConflicto([]);
        toast.error(e.message);
      }
    },
  });

  const enfermedadMut = useMutation({
    mutationFn: () =>
      citasApi.reportarEnfermedad({
        profesionalId: profesionalIds[0]!,
        sedeId,
        fecha,
        horaInicio: desde,
        horaFin: hasta,
        motivo: motivo.trim() || 'Enfermedad',
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['permisos', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
      qc.invalidateQueries({ queryKey: ['citas'] });
      setPacientesAfectados(r.pacientes);
      setCitasConflicto([]);
      setProfesionalIds([]);
      setMotivo('');
      toast.success(
        r.citasCanceladas > 0
          ? `${r.profesional} marcado enfermo · ${r.citasCanceladas} cita(s) cancelada(s) — contacta a los pacientes`
          : `${r.profesional} marcado enfermo · día bloqueado (no tenía citas)`,
      );
    },
    onError: (e: Error) => {
      setPacientesAfectados(null);
      toast.error(e.message);
    },
  });

  const vacacionesMut = useMutation({
    mutationFn: () =>
      permisosApi.crearVacaciones({
        profesionalIds,
        sedeId,
        fechaInicio: vacInicio,
        fechaFin: vacFin,
        motivo: motivo.trim() || 'Vacaciones',
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['permisos'] });
      qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
      qc.invalidateQueries({ queryKey: ['vacaciones-preview'] });
      toast.success(
        `🌴 Vacaciones bloqueadas: ${r.profesionales.join(', ')} · ${r.dias} día(s)`,
      );
      setProfesionalIds([]);
      setCitasConflicto([]);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ['vacaciones-preview'] });
    },
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => permisosApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['permisos', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
      toast.success('Permiso eliminado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarVacMut = useMutation({
    mutationFn: (ids: string[]) => permisosApi.eliminarVacacion(ids),
    onSuccess: (r) => {
      invalidarVacaciones();
      toast.success(`🌴 Vacación eliminada (${r.eliminados} día(s))`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editarVacMut = useMutation({
    mutationFn: (data: {
      ids: string[];
      sedeId: string;
      fechaInicio: string;
      fechaFin: string;
      motivo: string;
    }) => permisosApi.editarVacacion(data),
    onSuccess: (r) => {
      setEditVac(null);
      invalidarVacaciones();
      toast.success(`🌴 Vacación actualizada · ${r.dias} día(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cambiarModo = (optId: 'individual' | 'reunion' | 'enfermedad' | 'vacaciones') => {
    setModo(optId);
    setCitasConflicto([]);
    setPacientesAfectados(null);
    if (optId === 'enfermedad') {
      setProfesionalIds((prev) => prev.slice(0, 1));
      setDesde('08:00');
      setHasta('20:00');
      if (!motivo.trim()) setMotivo('Enfermedad');
    }
    if (optId === 'reunion') {
      const one = sedes.find((s) => s.nombre === 'One');
      if (one) setSedeSelId(one.id);
    }
    if (optId === 'vacaciones') {
      if (!motivo.trim() || motivo.trim() === 'Enfermedad') setMotivo('Vacaciones');
      setVacInicio(fecha);
      setVacFin(fecha);
    }
  };

  const rangoOk = !!desde && !!hasta && hasta > desde;
  const valido =
    modo === 'vacaciones'
      ? profesionalIds.length > 0 &&
        vacRangoOk &&
        motivo.trim().length >= 3 &&
        vacPreview.data?.ok === true
      : rangoOk &&
        (modo === 'reunion'
          ? motivo.trim().length >= 3
          : modo === 'enfermedad'
          ? profesionalIds.length === 1
          : profesionalIds.length > 0 && motivo.trim().length >= 3);

  const enviando =
    crearMut.isPending ||
    crearReunionMut.isPending ||
    enfermedadMut.isPending ||
    vacacionesMut.isPending;

  const enviar = () => {
    if (modo === 'vacaciones') return vacacionesMut.mutate();
    if (modo === 'reunion') return crearReunionMut.mutate();
    if (modo === 'enfermedad') {
      const prof = elegibles.find((p) => p.id === profesionalIds[0]);
      const nombre = prof
        ? `${prof.nombres.split(' ')[0]} ${prof.apellidos.split(' ')[0]}`
        : 'el profesional';
      const ok = window.confirm(
        `Se CANCELARÁN todas las citas activas de ${nombre} entre ${desde} y ${hasta} del ${fecha} y se bloqueará su agenda ese rango.\n\n` +
          'Los pacientes afectados quedarán listados para que los contactes y reagendes. ¿Continuar?',
      );
      if (ok) enfermedadMut.mutate();
      return;
    }
    return crearMut.mutate();
  };

  return {
    puedeGestionar,
    sedes,
    sedeId,
    setSedeSelId,
    sedeActual,
    fecha,
    setFecha,
    modo,
    cambiarModo,
    profesionalIds,
    setProfesionalIds,
    toggleProf,
    selectAllProfs,
    clearSelectedProfs,
    elegibles,
    desde,
    setDesde,
    hasta,
    setHasta,
    motivo,
    setMotivo,
    vacInicio,
    setVacInicio,
    vacFin,
    setVacFin,
    destinatario,
    setDestinatario,
    citasConflicto,
    pacientesAfectados,
    permisos,
    loadingPermisos,
    vacacionesVigentes,
    vacPreview,
    vacRangoOk,
    valido,
    enviando,
    enviar,
    eliminarMut,
    // Edit & delete vacacion
    editVac,
    setEditVac,
    editIni,
    setEditIni,
    editFin,
    setEditFin,
    editMotivo,
    setEditMotivo,
    eliminarVacMut,
    editarVacMut,
  };
}
