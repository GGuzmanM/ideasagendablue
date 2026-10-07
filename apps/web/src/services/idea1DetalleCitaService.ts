import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, addDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { citasApi, type CitaResumen } from '../api/citas';
import { api, profesionalesApi, pacientesApi, disponibilidadApi, competenciasApi, serviciosApi, type Profesional, type HistorialCita } from '../api';
import { useCanales } from '../hooks/useCanales';
import { usePromociones } from '../hooks/usePromociones';
import { usePaquetesPaciente, paquetesElegibles, paquetesOtraSede, paquetesSesionesApi } from '../api/paquetesSesiones';
import { generarSlotsDelDia, horaInicioValidaParaDuracion, esCitaInactiva } from '@limablue/shared';
import { useAuthStore } from '../stores/authStore';
import { estadoPagoDe, infoEstadoPago, type EstadoPago } from '../utils/estadoPago';
import { useResumenAtencionCita, useFichaPrevia } from '../api/historiaClinica';
import { citaEnRebote } from '../api/rebote';

const SLOTS = generarSlotsDelDia('08:00', '20:00', 30);
const ROLES_CAMBIAN_TRATAMIENTO = ['admin', 'coordinadora_sedes', 'contact_center', 'especial_contact', 'recepcionista'];
const ESTADOS_FINALES = ['completada', 'no_show', 'cancelada'];

// Máquina de estados de la cita (copia de services/estadoCitaService.ts del API): la pantalla solo
// ofrece los pasos que el servidor acepta, así no salen errores «Transición inválida».
export const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  agendada:    ['confirmada', 'llego', 'no_show', 'cancelada'],
  confirmada:  ['llego', 'no_show', 'cancelada'],
  llego:       ['en_atencion', 'cancelada'],
  en_atencion: ['completada', 'no_show'],
  completada:  ['en_atencion'],
  no_show:     [],
  cancelada:   [],
  reprogramada: [],
};

/** Estados a los que puede pasar una cita desde `estado` (incluido el propio, para comentar). */
export function estadosPermitidos(estado: string, libre = false): string[] {
  // 06-oct-2026: el ADMINISTRADOR puede pasarla a cualquier estado (el servidor lo permite solo a su rol).
  if (libre) return [estado, ...TODOS_LOS_ESTADOS.filter((e) => e !== estado)];
  return [estado, ...(TRANSICIONES_VALIDAS[estado] ?? [])];
}
export const TODOS_LOS_ESTADOS = ['agendada', 'confirmada', 'llego', 'en_atencion', 'completada', 'no_show', 'cancelada'];
/** ¿Es un salto fuera del flujo normal? (solo lo hace el admin; se le pide confirmar) */
export function esCambioEspecial(actual: string, destino: string): boolean {
  return actual !== destino && !(TRANSICIONES_VALIDAS[actual] ?? []).includes(destino);
}

/**
 * Refresca TODO lo que depende de las citas del día tras un cambio hecho desde el modal:
 * la grilla, los contadores de cabecera, la ocupación de otras unidades, la disponibilidad de
 * horas y las listas del propio modal. (Antes se invalidaba `idea1-citas`, una clave que no existe,
 * y los contadores/disponibilidad quedaban viejos hasta el siguiente poll.)
 */
export function invalidarAgenda(qc: ReturnType<typeof useQueryClient>): void {
  for (const k of ['citas', 'stats', 'ocupacion-externa', 'ocupacion-dia', 'disponibilidad', 'citas-reprog', 'seleccionables', 'combo-sibling']) {
    qc.invalidateQueries({ queryKey: [k] });
  }
}

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
  // Reprogramar se hace en la SEDE y la UNIDAD de la CITA, no en las que están abiertas en la agenda (25-sep-2026: una
  // cita de Paz Soldán abierta desde el buscador, con la agenda en One, listaba a las profesionales de One).
  const sedeId = cita.sedeId;
  const unidadNegocioId = cita.unidadNegocio?.id ?? cita.unidadNegocioId;
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

  // Baropodometría: la columna de la cita es una MÁQUINA (Baro 1 / Baro 2). Solo cuando la sede tiene 2 o más
  // máquinas ese día se deja elegir en cuál queda al reprogramar; con una sola, el servidor la pone como siempre.
  const esBaro = /baropodometr/i.test(cita.unidadNegocio?.nombre ?? '');
  const maquinasBaro = esBaro ? (profesionales ?? []).filter((p) => p.tipo === 'medico' && p.nombres.startsWith('Baro')) : [];
  const elegirMaquina = maquinasBaro.length >= 2;
  // Si la máquina marcada no está en la lista de ese día, se marca la primera.
  useEffect(() => {
    if (elegirMaquina && !maquinasBaro.some((m) => m.id === profSel)) setProfSel(maquinasBaro[0]!.id);
  }, [elegirMaquina, maquinasBaro, profSel]);

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

  // Reprogramar un BLOQUE (cita doble): se mueve completo (/citas/grupo/:id/mover). Solo si ninguna de las dos mitades
  // avanzó (ambas «agendada»); ocupa la duración del bloque y su disponibilidad se mide con el servicio principal.
  // En rebote (solo admin) el bloque también se reagenda completo, con las dos mitades en rebote.
  const bloqueReprogramable = esCombo
    && grupoBloque.length >= 2
    && (grupoBloque.every((c) => (c.estado ?? '').toLowerCase() === 'agendada') || grupoBloque.every((c) => citaEnRebote(c)));
  const duracionBloque = esCombo && grupoBloque.length ? Math.max(...grupoBloque.map((c) => c.duracionMinutos)) : cita.duracionMinutos;
  const idsBloque = new Set(esCombo ? grupoBloque.map((c) => c.id) : [cita.id]);
  const servicioReprog = (esCombo ? bloquePrincipal?.servicio?.id : null) ?? cita.servicio?.id;

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
      invalidarAgenda(qc);
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
      // Diálogo de sesión al marcar «Llegó»: también cuando el bloque combinado se marca desde la
      // mitad PRINCIPAL (el modal puede estar abierto en la secundaria y `esActiva` ser false).
      const marcoLlegada = variables.estado === 'llego' && (esActiva || variables.citaId === bloquePrincipal?.id);
      if (marcoLlegada && elegiblesConsumo.length > 0) {
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
      invalidarAgenda(qc);
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
      invalidarAgenda(qc);
      toast.success('Canal actualizado');
    },
    onError: (e: Error) => {
      setCanalSel(cita.canal);
      toast.error(e.message);
    },
  });

  // ESTADO DE PAGO (29-sep-2026): pendiente / incompleto / completo. Editable en cualquier estado por quien gestiona la
  // cita (citas.estado). En un bloque combinado el servidor cambia las dos citas.
  const puedeMarcarPagada = useAuthStore((s) => s.tiene('citas.estado'));
  const [estadoPagoSel, setEstadoPagoSel] = useState<EstadoPago>(estadoPagoDe(cita));
  useEffect(() => { setEstadoPagoSel(estadoPagoDe(cita)); }, [cita.estadoPago, cita.pagada]); // eslint-disable-line react-hooks/exhaustive-deps
  const estadoPagoMutation = useMutation({
    mutationFn: (estado: EstadoPago) => citasApi.cambiarEstadoPago(cita.id, estado),
    onSuccess: (_r, estado) => {
      invalidarAgenda(qc);
      toast.success(`Estado de pago: ${infoEstadoPago(estado).label}`);
    },
    onError: (e: Error) => {
      setEstadoPagoSel(estadoPagoDe(cita));
      toast.error(e.message);
    },
  });

  // Comprobante de pago (29-sep-2026): adjuntar / reemplazar / quitar después de agendar (un comprobante por cita).
  const [subiendoComprobante, setSubiendoComprobante] = useState(false);
  const comprobanteMutation = useMutation({
    mutationFn: (c: { url: string; nombre?: string; mimeType?: string } | null) => citasApi.actualizarComprobante(cita.id, c),
    onSuccess: (_r, c) => { invalidarAgenda(qc); toast.success(c ? 'Comprobante adjuntado' : 'Comprobante quitado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const subirComprobante = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error('El archivo excede los 10MB'); return; }
    setSubiendoComprobante(true);
    try {
      const fd = new FormData();
      fd.append('comprobante', file);
      const r = await api.upload<{ url: string; nombre: string; mimeType: string }>('/citas/upload-comprobante', fd);
      await comprobanteMutation.mutateAsync({ url: r.url, nombre: r.nombre, mimeType: r.mimeType });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo subir el comprobante');
    } finally {
      setSubiendoComprobante(false);
    }
  };

  const { promociones } = usePromociones();
  const esSecundariaBloque = cita.slotRol === 'SECUNDARIO';
  const promoCita = cita.promocion ?? null;
  const promoHeredada = cita.promocionHeredada ?? null;
  const [promoSel, setPromoSel] = useState(promoCita?.id ?? '');
  const promoMutation = useMutation({
    mutationFn: (promocionId: string | null) => citasApi.actualizarPromocion(cita.id, promocionId),
    onSuccess: () => {
      invalidarAgenda(qc);
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
      invalidarAgenda(qc);
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

  // Bloque combinado: se mueve COMPLETO (las dos citas comparten el slot); antes el lápiz del
  // profesional movía solo una mitad y la hermana quedaba huérfana en el horario viejo.
  const moverMutation = useMutation({
    mutationFn: () =>
      cita.slotGrupoId
        ? citasApi.moverGrupo(cita.slotGrupoId, { profesionalId: profSel, fecha: fechaSelStr, horaInicio: horaSel })
        : citasApi.mover(cita.id, { profesionalId: profSel, fecha: fechaSelStr, horaInicio: horaSel, ...(elegirMaquina ? { elegirEquipo: true } : {}) }),
    onSuccess: () => {
      invalidarAgenda(qc);
      toast.success(cita.slotGrupoId ? 'Bloque combinado reprogramado' : 'Cita reprogramada');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Columna «Adicional» (de emergencia, no es una persona): se indica qué podóloga REALMENTE atendió. Informativo:
  // la cita no cambia de columna ni ocupa la agenda de esa podóloga. Opciones = podólogas reales de la sede ese día.
  const esAdicional = /^adicional/i.test((cita.profesional?.nombres ?? '').trim());
  const { data: podologasDia = [] } = useQuery({
    queryKey: ['profesionales-sede', cita.sedeId, cita.unidadNegocio?.id, (cita.fecha ?? '').slice(0, 10), 'atendido-por'],
    queryFn: () => profesionalesApi.listar({ sedeId: cita.sedeId, unidadNegocioId: cita.unidadNegocio!.id, fecha: (cita.fecha ?? '').slice(0, 10), activo: true }),
    enabled: esAdicional && !!cita.unidadNegocio?.id,
    select: (ps) => ps.filter((p) => p.tipo === 'podologa' && !/^(adicional|baro)/i.test(p.nombres.trim())),
  });
  // Solo quienes HACEN el servicio de la cita (competencia activa). Primero las de la sede ese día; luego las de otras
  // sedes (una podóloga de Lince pudo cubrir en Paz Soldán). Si el servicio no tiene competencias cargadas, todas las del día.
  const { data: competenciasUnidad = [] } = useQuery({
    queryKey: ['competencias', cita.unidadNegocio?.id],
    queryFn: () => competenciasApi.listar({ unidadNegocioId: cita.unidadNegocio!.id }),
    enabled: esAdicional && !!cita.unidadNegocio?.id,
    staleTime: 10 * 60_000,
  });
  const atendioOpciones = (() => {
    const hacen = new Map<string, { id: string; nombres: string; apellidos: string }>();
    for (const c of competenciasUnidad) {
      const p = c.profesional;
      if (!c.activa || c.servicio?.id !== cita.servicio?.id || !p || p.tipo !== 'podologa' || p.activo === false) continue;
      if (/^(adicional|baro)/i.test(p.nombres.trim())) continue;
      hacen.set(p.id, { id: p.id, nombres: p.nombres, apellidos: p.apellidos });
    }
    if (hacen.size === 0) return { deLaSede: podologasDia, otras: [] as { id: string; nombres: string; apellidos: string }[] };
    const deLaSede = podologasDia.filter((p) => hacen.has(p.id));
    const otras = [...hacen.values()].filter((p) => !podologasDia.some((d) => d.id === p.id))
      .sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`));
    return { deLaSede, otras };
  })();
  const atendidoPorMutation = useMutation({
    mutationFn: (profesionalId: string | null) => citasApi.asignarAtendidoPor(cita.id, profesionalId),
    onSuccess: (c) => {
      setCitaActiva((prev) => ({ ...prev, atendidoPor: c.atendidoPor ?? null }));
      invalidarAgenda(qc);
      toast.success(c.atendidoPor ? `Atendió: ${c.atendidoPor.nombres} ${c.atendidoPor.apellidos}` : 'Quitado: sin podóloga indicada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cambiar TRATAMIENTO / subcategoría (24-sep-2026): admin en cualquier momento; coordinación, contact center, especial
  // contact y recepción solo mientras la cita está agendada, confirmada o llegó. No en citas dobles. El servidor valida
  // lo demás (profesional habilitado, que quepa si dura más, membresía y promoción).
  const rolSesion = useAuthStore((s) => s.usuario?.rol) ?? '';
  const puedeCambiarTratamiento = ROLES_CAMBIAN_TRATAMIENTO.includes(rolSesion) && !cita.slotGrupoId
    && !['cancelada', 'reprogramada'].includes(estadoNorm)
    && (rolSesion === 'admin' || ['agendada', 'confirmada', 'llego'].includes(estadoNorm));
  const [cambiandoTratamiento, setCambiandoTratamiento] = useState(false);
  const [tratServicioId, setTratServicioId] = useState('');
  const [tratSubcategoriaId, setTratSubcategoriaId] = useState('');
  useEffect(() => { setCambiandoTratamiento(false); }, [cita.id]);
  const { data: serviciosUnidad = [] } = useQuery({
    queryKey: ['servicios', cita.unidadNegocio?.id, 'activos'],
    queryFn: () => serviciosApi.listar({ unidadNegocioId: cita.unidadNegocio!.id, activo: true }),
    enabled: cambiandoTratamiento && !!cita.unidadNegocio?.id,
    staleTime: 5 * 60_000,
  });
  const { data: competenciasTrat = [] } = useQuery({
    queryKey: ['competencias', cita.unidadNegocio?.id],
    queryFn: () => competenciasApi.listar({ unidadNegocioId: cita.unidadNegocio!.id }),
    enabled: cambiandoTratamiento && !!cita.unidadNegocio?.id,
    staleTime: 10 * 60_000,
  });
  // Solo los tratamientos que el profesional de la cita tiene habilitados (el actual siempre aparece).
  const opcionesTratamiento = (() => {
    const habilitados = new Set(competenciasTrat.filter((c) => c.activa && c.profesional?.id === cita.profesionalId).map((c) => c.servicio?.id));
    return serviciosUnidad
      .filter((s) => s.activo !== false && (habilitados.size === 0 || habilitados.has(s.id) || s.id === cita.servicio?.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  })();
  const subcategoriasTrat = serviciosUnidad.find((s) => s.id === tratServicioId)?.subcategorias ?? [];
  const abrirCambioTratamiento = () => {
    setTratServicioId(cita.servicio?.id ?? '');
    setTratSubcategoriaId(cita.subcategoria?.id ?? '');
    setCambiandoTratamiento(true);
  };
  const elegirTratServicio = (id: string) => {
    setTratServicioId(id);
    const subs = serviciosUnidad.find((s) => s.id === id)?.subcategorias ?? [];
    setTratSubcategoriaId(subs.length === 1 ? subs[0]!.id : '');
  };
  const tratamientoSinCambios = tratServicioId === (cita.servicio?.id ?? '') && (tratSubcategoriaId || '') === (cita.subcategoria?.id ?? '');
  const puedeGuardarTratamiento = !!tratServicioId && !tratamientoSinCambios && (subcategoriasTrat.length === 0 || !!tratSubcategoriaId);
  const tratamientoMutation = useMutation({
    mutationFn: () => citasApi.cambiarTratamiento(cita.id, { servicioId: tratServicioId, subcategoriaId: tratSubcategoriaId || null }),
    onSuccess: (c) => {
      setCitaActiva((prev) => ({ ...prev, ...c, paciente: { ...prev.paciente, ...c.paciente } }));
      setCambiandoTratamiento(false);
      invalidarAgenda(qc);
      qc.invalidateQueries({ queryKey: ['cita-detalle', cita.id] });
      toast.success(`Tratamiento cambiado a ${c.servicio?.nombre ?? 'el nuevo servicio'}${c.subcategoria ? ` · ${c.subcategoria.nombre}` : ''}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const consultorioMutation = useMutation({
    mutationFn: (num: number | null) => citasApi.actualizarConsultorio(cita.id, num),
    onSuccess: () => {
      invalidarAgenda(qc);
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
      invalidarAgenda(qc);
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
      // La propia cita (y su hermana del bloque) no ocupan: se van a mover juntas.
      if (c.profesionalId === profSel && !idsBloque.has(c.id) && !esCitaInactiva(c.estado)) {
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
    queryKey: ['disponibilidad', cita.sedeId, cita.unidadNegocio?.id, servicioReprog, fechaSelStr, profSel],
    queryFn: () =>
      disponibilidadApi.consultar({
        sede: cita.sedeId,
        unidadNegocio: cita.unidadNegocio!.id,
        servicio: servicioReprog!,
        fecha: fechaSelStr,
        profesional: profSel || undefined,
      }),
    enabled: reprogramando && !!profSel && !!cita.unidadNegocio?.id && !!servicioReprog,
  });

  const slotsAgendables = new Set((dispoReprog?.slots ?? []).filter((s) => s.disponible).map((s) => s.horaInicio));
  if (fechaSelStr === cita.fecha?.slice(0, 10) && profSel === cita.profesionalId) {
    slotsAgendables.add(cita.horaInicio);
  }

  const diasRapidos = (() => {
    const semana = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));
    const fechaCita = cita.fecha ? new Date(cita.fecha.slice(0, 10) + 'T12:00:00') : null;
    // La fecha de la propia cita siempre aparece (si es de otra semana, va primero) para que el
    // panel no quede sin ningún día marcado al abrirse.
    if (fechaCita && !semana.some((d) => formatFechaCorta(d) === formatFechaCorta(fechaCita))) return [fechaCita, ...semana];
    return semana;
  })();

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

  // Nº de consultorios de la sede: viene de la BD (Sede.consultorios), ya no de un mapa en el front.
  const totalConsultorios = cita.sede?.consultorios ?? 0;

  const seleccionarCitaPorId = async (historialCitaId: string) => {
    try {
      const fullCita = await citasApi.obtener(historialCitaId);
      if (fullCita) setCitaActiva(fullCita);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo abrir esa cita del historial');
    }
  };

  // ── Historia clínica: ÚNICO toque de la agenda al módulo clínico ──
  // Resumen liviano (no audita en el backend) solo si el usuario puede ver HC y la cita ya fue
  // atendida; el botón del modal navega a la página de dos paneles con ?cita= para abrir/registrar.
  const tieneHc = useAuthStore((s) => s.tiene);
  const puedeVerHc = tieneHc('hc.ver');
  const puedeRegistrarHc = tieneHc('hc.registrar');
  const { data: resumenAtencion } = useResumenAtencionCita(cita.id, puedeVerHc && ['llego', 'en_atencion', 'completada'].includes(estadoNorm));
  // Ficha previa "de 10 segundos" (2.8): alergias, banderas de riesgo y lo último del paciente, antes de entrar.
  const { data: fichaPrevia, isLoading: cargandoFicha } = useFichaPrevia(cita.pacienteId, puedeVerHc);
  const irAHistoriaClinica = () => { onClose(); navigate(`/historia-clinica/${cita.pacienteId}?cita=${cita.id}`); };

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
    esBaro,
    maquinasBaro,
    elegirMaquina,
    bloqueReprogramable,
    duracionBloque,
    esAdicional,
    atendioOpciones,
    atendidoPorMutation,
    puedeCambiarTratamiento,
    cambiandoTratamiento,
    setCambiandoTratamiento,
    abrirCambioTratamiento,
    opcionesTratamiento,
    subcategoriasTrat,
    tratServicioId,
    elegirTratServicio,
    tratSubcategoriaId,
    setTratSubcategoriaId,
    puedeGuardarTratamiento,
    tratamientoMutation,
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
    puedeMarcarPagada,
    estadoPagoSel,
    setEstadoPagoSel,
    estadoPagoMutation,
    subiendoComprobante,
    subirComprobante,
    comprobanteMutation,
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
    resumenAtencion,
    fichaPrevia,
    cargandoFicha,
    puedeVerHc,
    puedeRegistrarHc,
    irAHistoriaClinica,
  };
}
