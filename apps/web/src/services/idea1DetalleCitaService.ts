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

  // El prop `cita` es un SNAPSHOT del momento en que se abrió el modal. Los procesos
  // automáticos (correo de confirmación enviado por el worker, confirmación del
  // paciente desde el mail) cambian la cita en el server sin que el modal se entere.
  // Este refetch liviano mantiene el modal al día; se mergea preservando los extras
  // del listado (alerta/familiares) que GET /citas/:id no incluye.
  const { data: citaFresca } = useQuery({
    queryKey: ['cita-detalle', citaProp.id],
    queryFn: () => citasApi.obtener(citaProp.id),
    refetchInterval: 10_000,
  });
  useEffect(() => {
    if (!citaFresca) return;
    // El poll está fijado al id ORIGINAL del modal. Si el usuario navegó a otra cita del historial
    // (seleccionarCitaPorId cambió citaActiva), NO mergear el refetch viejo encima o el modal
    // "saltaría" de vuelta a la cita original. Solo mergear si sigue siendo la misma cita.
    setCitaActiva(prev => prev.id !== citaFresca.id ? prev : ({
      ...prev,
      ...citaFresca,
      paciente: { ...prev.paciente, ...citaFresca.paciente },
    }));
  }, [citaFresca]);

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
  // Cargar las citas del día del bloque para tener AMBAS mitades (principal + secundaria),
  // sin importar cuál se clickeó. Antes solo se cargaba al abrir la PRINCIPAL.
  const { data: citasComboDia } = useQuery({
    queryKey: ['combo-sibling', cita.sedeId, cita.fecha?.slice(0, 10), cita.slotGrupoId],
    queryFn: () => citasApi.listar({ sedeId: cita.sedeId, fecha: (cita.fecha ?? '').slice(0, 10) }),
    enabled: esCombo && !!cita.fecha,
    staleTime: 15_000,
  });

  // Miembros del bloque combinado (principal arriba, secundaria abajo). Se prefiere la copia
  // FRESCA `cita` (citaActiva, con polling) para el rol que coincida; la otra sale del fetch.
  const grupoBloque = esCombo
    ? [cita, ...(citasComboDia ?? []).filter((c) => c.slotGrupoId === cita.slotGrupoId && c.id !== cita.id)]
    : [];
  const bloquePrincipal: CitaResumen | null = esCombo
    ? (grupoBloque.find((c) => c.slotRol === 'PRINCIPAL') ?? (cita.slotRol === 'PRINCIPAL' ? cita : null))
    : null;
  const bloqueSecundaria: CitaResumen | null = esCombo
    ? (grupoBloque.find((c) => c.slotRol === 'SECUNDARIO') ?? (cita.slotRol === 'SECUNDARIO' ? cita : null))
    : null;

  const citaExon = bloqueSecundaria ?? cita;

  // Mutations
  // `citaId` opcional: en un bloque combinado permite avanzar la mitad SECUNDARIA (el 2º
  // tratamiento) sin cerrar el modal ni pisar el estado de la mitad activa. Por defecto = la
  // cita activa (comportamiento intacto para citas sueltas).
  const estadoMutation = useMutation({
    mutationFn: ({ estado, comentario, citaId, soloEsta }: { estado: string; comentario?: string; citaId?: string; soloEsta?: boolean }) =>
      citasApi.cambiarEstado(citaId ?? cita.id, estado, comentario, motivoCancelacion || undefined, soloEsta),
    onSuccess: (updatedCita, variables) => {
      const targetId = variables.citaId ?? cita.id;
      const esActiva = targetId === cita.id;
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      // Refresca la otra mitad del bloque combinado (para que el flujo secuencial vea el nuevo estado).
      qc.invalidateQueries({ queryKey: ['combo-sibling'] });
      // Invalida el detalle cacheado de la cita afectada: sin esto, al reabrir el modal se mergeaba el
      // estado viejo ('agendada') encima del fresco y volvía a ofrecer "llegó" (no avanzaba el flujo).
      qc.invalidateQueries({ queryKey: ['cita-detalle', targetId] });
      if (updatedCita) qc.setQueryData(['cita-detalle', targetId], updatedCita);
      qc.invalidateQueries({ queryKey: ['paciente-historial', cita.paciente.id] });
      // El cambio de estado (llegó/completada/no-show) puede descontar/devolver la sesión
      // en el backend → refrescar saldos y ficha al instante (sin esperar el staleTime).
      qc.invalidateQueries({ queryKey: ['paquetes-sesiones', cita.paciente.id] });
      qc.invalidateQueries({ queryKey: ['paciente', cita.paciente.id] });
      toast.success('Estado actualizado');
      // Solo actualizar la copia local si la cita afectada es la activa (no la hermana del bloque).
      if (esActiva) {
        if (updatedCita) {
          setCitaActiva((prev) => ({ ...prev, estado: updatedCita.estado }));
        } else {
          setCitaActiva((prev) => ({ ...prev, estado: variables.estado }));
        }
      }
      if (esActiva && variables.estado === 'llego' && elegiblesConsumo.length > 0) {
        setDialogoConsumo(true);
      } else if (esActiva && variables.estado === 'cancelada' && !esCombo) {
        // Cita suelta: al cancelar se cierra el modal. En un BLOQUE combinado NO se cierra
        // (cancelar el 2º tratamiento deja ver el estado final del bloque; el usuario cierra manual).
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
      // Marca inmediata en el modal (sin esperar el refetch): el badge pasa a
      // "Correo enviado" al instante.
      setCitaActiva(prev => ({ ...prev, confirmacionEnviadaEn: new Date().toISOString() }));
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      qc.invalidateQueries({ queryKey: ['cita-detalle', cita.id] });
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

  // Baro: la columna de la cita es una MÁQUINA (Baro 1/2) y el médico que atiende va en
  // `solicitadoProfesional`. En ese caso el "Profesional" mostrado debe ser el médico, y la
  // máquina se muestra aparte como "Equipo".
  const nombreCorto = (p: { nombres: string; apellidos: string }) =>
    `${p.nombres.split(' ')[0]} ${p.apellidos.split(' ')[0]}`;
  const profActual = cita.solicitadoProfesional
    ? nombreCorto(cita.solicitadoProfesional)
    : cita.profesional
    ? nombreCorto(cita.profesional)
    : 'Sin asignar';
  // Nombre de la máquina/equipo (solo cuando hay médico solicitado sobre una columna-máquina).
  const equipoBaro = cita.solicitadoProfesional && cita.profesional
    ? `${cita.profesional.nombres} ${cita.profesional.apellidos}`.trim()
    : null;

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
    bloquePrincipal,
    bloqueSecundaria,
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
    equipoBaro,
    totalConsultorios,
    SLOTS,
  };
}
