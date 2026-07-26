import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, addDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { citasApi, type CitaResumen } from '../api/citas';
import { profesionalesApi, pacientesApi, disponibilidadApi, type Profesional, type HistorialCita } from '../api';
import { useCanales } from '../hooks/useCanales';
import { usePromociones } from '../hooks/usePromociones';
import { usePaquetesPaciente, paquetesElegibles, paquetesOtraSede, paquetesSesionesApi } from '../api/paquetesSesiones';
import { useAgendaStore } from '../stores/agendaStore';
import { generarSlotsDelDia, horaInicioValidaParaDuracion, esCitaInactiva } from '@limablue/shared';

const SLOTS = generarSlotsDelDia('08:00', '20:00', 30);
const ESTADOS_FINALES = ['completada', 'no_show', 'cancelada'];

export const CONSULTORIOS_POR_SEDE: Record<string, number> = {
  'Los Olivos': 6,
  'San Miguel': 4,
  'Lince': 9,
  'Paz Soldán': 11,
  'One': 5,
};

function formatFechaCorta(d: Date) {
  return format(d, 'yyyy-MM-dd');
}

export interface UseIdea1DetalleCitaProps {
  cita: CitaResumen;
  onClose: () => void;
}

export function useIdea1DetalleCita({ cita: citaProp, onClose }: UseIdea1DetalleCitaProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { sedeId, unidadNegocioId } = useAgendaStore();

  const [citaActiva, setCitaActiva] = useState<CitaResumen>(citaProp);

  useEffect(() => {
    setCitaActiva(citaProp);
  }, [citaProp.id]);

  const cita = citaActiva;
  const estadoNorm = (cita.estado || '').toLowerCase().replace(/\s+/g, '_');

  const comentarios = cita.comentarios ?? [];
  const [nuevoComentario, setNuevoComentario] = useState('');
  const [editandoComentario, setEditandoComentario] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [verHistorial, setVerHistorial] = useState(false);
  const [consultorio, setConsultorioLocal] = useState<number | null>(cita.consultorioNumero ?? null);

  useEffect(() => {
    setConsultorioLocal(cita.consultorioNumero ?? null);
  }, [cita.id, cita.consultorioNumero]);

  // Panel reprogramar
  const [reprogramando, setReprogramando] = useState(false);
  const [fechaSel, setFechaSel] = useState<Date>(
    new Date((cita.fecha?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)) + 'T12:00:00')
  );
  const [horaSel, setHoraSel] = useState<string>(cita.horaInicio);
  const [profSel, setProfSel] = useState<string>(cita.profesionalId ?? '');

  const fechaSelStr = formatFechaCorta(fechaSel);

  // Queries
  const { data: profesionales } = useQuery({
    queryKey: ['profesionales-sede', sedeId, unidadNegocioId, fechaSelStr],
    queryFn: () =>
      profesionalesApi.listar({
        sedeId: sedeId!,
        unidadNegocioId: unidadNegocioId!,
        fecha: fechaSelStr,
        activo: true,
      }),
    enabled: reprogramando && !!sedeId && !!unidadNegocioId,
  });

  const { data: citasDia } = useQuery({
    queryKey: ['citas-reprog', sedeId, fechaSelStr, unidadNegocioId],
    queryFn: () => citasApi.listar({ sedeId: sedeId!, fecha: fechaSelStr, unidadNegocioId: unidadNegocioId! }),
    enabled: reprogramando && !!sedeId && !!unidadNegocioId,
  });

  const { data: datosPaciente, isLoading: loadingHistorial } = useQuery({
    queryKey: ['paciente-historial', cita.paciente.id],
    queryFn: () => pacientesApi.obtener(cita.paciente.id),
    enabled: verHistorial,
    staleTime: 60_000,
  });

  const { data: paquetesPac } = usePaquetesPaciente(cita.paciente.id);

  const elegiblesConsumo = paquetesElegibles(
    paquetesPac,
    cita.servicioId,
    cita.sedeId,
    cita.subcategoriaId ?? null,
    cita.fecha?.slice(0, 10) ?? null
  ).filter((p) => p.origen !== 'GENEXIS_APERTURA');

  const paquetesOtras = paquetesOtraSede(
    paquetesPac,
    cita.servicioId,
    cita.sedeId,
    cita.subcategoriaId ?? null,
    cita.fecha?.slice(0, 10) ?? null
  );

  const [dialogoConsumo, setDialogoConsumo] = useState(false);

  const esCombo = !!cita.slotGrupoId;
  const { data: citasComboDia } = useQuery({
    queryKey: ['combo-sibling', cita.sedeId, cita.fecha?.slice(0, 10), cita.slotGrupoId],
    queryFn: () => citasApi.listar({ sedeId: cita.sedeId, fecha: (cita.fecha ?? '').slice(0, 10) }),
    enabled: esCombo && cita.slotRol === 'PRINCIPAL' && !!cita.fecha,
    staleTime: 15_000,
  });

  const citaExon =
    (esCombo && cita.slotRol === 'PRINCIPAL'
      ? (citasComboDia ?? []).find((c) => c.slotGrupoId === cita.slotGrupoId && c.slotRol === 'SECUNDARIO')
      : null) ?? cita;

  // Mutations
  const estadoMutation = useMutation({
    mutationFn: ({ estado, comentario }: { estado: string; comentario?: string }) =>
      citasApi.cambiarEstado(cita.id, estado, comentario, motivoCancelacion || undefined),
    onSuccess: (updatedCita, variables) => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      qc.invalidateQueries({ queryKey: ['paciente-historial', cita.paciente.id] });
      toast.success('Estado actualizado');
      if (updatedCita) {
        setCitaActiva((prev) => ({ ...prev, estado: updatedCita.estado }));
      } else {
        setCitaActiva((prev) => ({ ...prev, estado: variables.estado }));
      }
      if (variables.estado === 'llego' && elegiblesConsumo.length > 0) {
        setDialogoConsumo(true);
      } else if (variables.estado === 'cancelada') {
        onClose();
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exonerarMut = useMutation({
    mutationFn: ({ exonerar, motivo }: { exonerar: boolean; motivo?: string }) =>
      paquetesSesionesApi.exonerarSesion(cita.id, exonerar, motivo),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      qc.invalidateQueries({ queryKey: ['combo-sibling'] });
      qc.invalidateQueries({ queryKey: ['paquetes-sesiones', cita.paciente.id] });
      toast.success(
        r.exonerada
          ? r.devolvioConsumo
            ? 'Sesión no descontada — devuelta al paquete'
            : 'Marcada: esta cita no descuenta sesión'
          : 'Marca quitada: vuelve a descontar normalmente'
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { canales: canalesOpts } = useCanales();
  const [canalSel, setCanalSel] = useState(cita.canal);
  const canalMutation = useMutation({
    mutationFn: (canal: string) => citasApi.actualizarCanal(cita.id, canal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      toast.success('Canal actualizado');
    },
    onError: (e: Error) => {
      setCanalSel(cita.canal);
      toast.error(e.message);
    },
  });

  const { promociones } = usePromociones();
  const esSecundariaBloque = cita.slotRol === 'SECUNDARIO';
  const promoCita = cita.promocion ?? null;
  const promoHeredada = cita.promocionHeredada ?? null;
  const [promoSel, setPromoSel] = useState(promoCita?.id ?? '');
  const promoMutation = useMutation({
    mutationFn: (promocionId: string | null) => citasApi.actualizarPromocion(cita.id, promocionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      toast.success('Promoción actualizada');
    },
    onError: (e: Error) => {
      setPromoSel(promoCita?.id ?? '');
      toast.error(e.message);
    },
  });

  const comentarioMutation = useMutation({
    mutationFn: (texto: string) => citasApi.actualizarComentario(cita.id, texto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      setEditandoComentario(false);
      setNuevoComentario('');
      toast.success('Comentario agregado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fmtComentario = (creadoEn: string) =>
    new Date(creadoEn).toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const moverMutation = useMutation({
    mutationFn: () =>
      citasApi.mover(cita.id, {
        profesionalId: profSel,
        fecha: fechaSelStr,
        horaInicio: horaSel,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      toast.success('Cita reprogramada');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const consultorioMutation = useMutation({
    mutationFn: (num: number | null) => citasApi.actualizarConsultorio(cita.id, num),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      toast.success('Consultorio actualizado');
    },
    onError: (e: Error) => {
      setConsultorioLocal(cita.consultorioNumero ?? null);
      toast.error(e.message);
    },
  });

  const confirmarMailMutation = useMutation({
    mutationFn: () => citasApi.confirmarPorCorreo(cita.id),
    onSuccess: ({ to }) => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      toast.success(`Correo de confirmación enviado a ${to}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const esFinal = ESTADOS_FINALES.includes(estadoNorm);
  const nombrePaciente = `${cita.paciente.nombres} ${cita.paciente.apellidoPaterno} ${cita.paciente.apellidoMaterno || ''}`.trim();
  const iniciales = `${cita.paciente.nombres?.[0] ?? ''}${cita.paciente.apellidoPaterno?.[0] ?? ''}`.toUpperCase();

  const slotsOcupados = new Set<string>();
  if (citasDia && profSel) {
    for (const c of citasDia) {
      if (c.profesionalId === profSel && c.id !== cita.id && !esCitaInactiva(c.estado)) {
        const [hh, mm] = c.horaInicio.split(':').map(Number);
        const start = (hh ?? 0) * 60 + (mm ?? 0);
        for (let m = start; m < start + c.duracionMinutos; m += 30) {
          const slot = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          slotsOcupados.add(slot);
        }
      }
    }
  }

  const { data: dispoReprog, isFetching: dispoReprogCargando } = useQuery({
    queryKey: ['disponibilidad', cita.sedeId, cita.unidadNegocio?.id, cita.servicio?.id, fechaSelStr, profSel],
    queryFn: () =>
      disponibilidadApi.consultar({
        sede: cita.sedeId,
        unidadNegocio: cita.unidadNegocio!.id,
        servicio: cita.servicio!.id,
        fecha: fechaSelStr,
        profesional: profSel || undefined,
      }),
    enabled: reprogramando && !!profSel && !!cita.unidadNegocio?.id && !!cita.servicio?.id,
  });

  const slotsAgendables = new Set((dispoReprog?.slots ?? []).filter((s) => s.disponible).map((s) => s.horaInicio));
  if (fechaSelStr === cita.fecha?.slice(0, 10) && profSel === cita.profesionalId) {
    slotsAgendables.add(cita.horaInicio);
  }

  const diasRapidos = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));

  const profActual = cita.profesional
    ? `${cita.profesional.nombres.split(' ')[0]} ${cita.profesional.apellidos.split(' ')[0]}`
    : 'Sin asignar';

  const totalConsultorios = CONSULTORIOS_POR_SEDE[cita.sede?.nombre || ''] ?? 6;

  const seleccionarCitaPorId = async (historialCitaId: string) => {
    try {
      const fullCita = await citasApi.obtener(historialCitaId);
      if (fullCita) setCitaActiva(fullCita);
    } catch (err) {
      console.warn('No se pudo cargar cita del historial:', err);
    }
  };

  return {
    cita,
    setCitaActiva,
    seleccionarCitaPorId,
    estadoNorm,
    onClose,
    navigate,
    comentarios,
    nuevoComentario,
    setNuevoComentario,
    editandoComentario,
    setEditandoComentario,
    cancelando,
    setCancelando,
    motivoCancelacion,
    setMotivoCancelacion,
    verHistorial,
    setVerHistorial,
    consultorio,
    setConsultorioLocal,
    reprogramando,
    setReprogramando,
    fechaSel,
    setFechaSel,
    horaSel,
    setHoraSel,
    profSel,
    setProfSel,
    fechaSelStr,
    profesionales,
    datosPaciente,
    loadingHistorial,
    paquetesPac,
    elegiblesConsumo,
    paquetesOtras,
    dialogoConsumo,
    setDialogoConsumo,
    esCombo,
    citaExon,
    estadoMutation,
    exonerarMut,
    canalesOpts,
    canalSel,
    setCanalSel,
    canalMutation,
    promociones,
    esSecundariaBloque,
    promoCita,
    promoHeredada,
    promoSel,
    setPromoSel,
    promoMutation,
    comentarioMutation,
    fmtComentario,
    moverMutation,
    consultorioMutation,
    confirmarMailMutation,
    esFinal,
    nombrePaciente,
    iniciales,
    slotsOcupados,
    dispoReprogCargando,
    slotsAgendables,
    diasRapidos,
    profActual,
    totalConsultorios,
    SLOTS,
  };
}
