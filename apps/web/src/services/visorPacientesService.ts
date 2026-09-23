// «Pacientes del día» (22-sep-2026): vista rápida para médicos, administración y coordinación con los pacientes
// que YA LLEGARON hoy a la sede donde están, sin pasar por la agenda. Desde aquí el médico se toma la cita,
// entra a la historia clínica (registra/continúa la atención) y emite la receta. La lógica vive aquí; la página es
// vista pura. Los datos son las mismas citas de la agenda (GET /citas?sedeId&fecha), filtradas por estado.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { citasApi, type CitaResumen } from '../api/citas';
import { sedesApi } from '../api';
import { medicoCitaApi } from '../api/medicoCita';
import { citaLlevaMedico } from './medicoCitaService';
import { useAuthStore } from '../stores/authStore';
import { useAgendaStore } from '../stores/agendaStore';

export const ESTADOS_EN_SEDE = ['llego', 'en_atencion'];
const hoyStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const horaDe = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }) : null);

export type FiltroVisor = 'todos' | 'mios' | 'sin_medico';

export function useVisorPacientes() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const usuario = useAuthStore((s) => s.usuario);
  const tiene = useAuthStore((s) => s.tiene);
  const puedeAccederSede = useAuthStore((s) => s.puedeAccederSede);
  const sedeAgenda = useAgendaStore((s) => s.sedeId);

  const miFicha = usuario?.profesional?.tipo === 'medico' ? usuario.profesionalId ?? null : null;
  const soyMedico = !!miFicha && tiene('medico.autoasignar');
  const puedeAsignar = tiene('medico.asignar');
  const puedeVerHc = tiene('hc.ver');

  // Sede: la de la agenda si la puede ver; si no, la primera de las suyas.
  const { data: sedesTodas = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const sedes = useMemo(() => sedesTodas.filter((s) => s.activa && puedeAccederSede(s.id)), [sedesTodas, puedeAccederSede]);
  const [sedeId, setSedeId] = useState<string>('');
  useEffect(() => {
    if (sedeId && sedes.some((s) => s.id === sedeId)) return;
    const preferida = sedeAgenda && sedes.some((s) => s.id === sedeAgenda) ? sedeAgenda : sedes[0]?.id ?? '';
    if (preferida) setSedeId(preferida);
  }, [sedes, sedeAgenda, sedeId]);

  const fecha = hoyStr();
  const citasQ = useQuery({
    // Con el prefijo ['citas'] la agenda y el socket la refrescan solos al cambiar cualquier cita.
    queryKey: ['citas', 'visor', sedeId, fecha],
    queryFn: () => citasApi.listar({ sedeId, fecha }),
    enabled: !!sedeId,
    refetchInterval: 30_000,
  });

  const [filtro, setFiltro] = useState<FiltroVisor>(soyMedico ? 'todos' : 'todos');
  const [busqueda, setBusqueda] = useState('');
  const [verAtendidos, setVerAtendidos] = useState(false);

  const todas = citasQ.data ?? [];
  const coincide = (c: CitaResumen) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno} ${c.paciente.numeroDocumento ?? ''}`.toLowerCase().includes(q);
  };
  const enSede = useMemo(() => todas
    .filter((c) => ESTADOS_EN_SEDE.includes((c.estado || '').toLowerCase()))
    .filter((c) => filtro === 'todos' ? true : filtro === 'mios' ? c.medicoId === miFicha : !c.medicoId && citaLlevaMedico(c))
    .filter(coincide)
    // Primero los que llevan más tiempo esperando (llegó más temprano); En atención después de los que esperan.
    .sort((a, b) => (a.estado === b.estado ? (a.llegoEn ?? a.horaInicio).localeCompare(b.llegoEn ?? b.horaInicio) : a.estado === 'llego' ? -1 : 1)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [todas, filtro, busqueda, miFicha]);
  const atendidos = useMemo(() => todas.filter((c) => (c.estado || '').toLowerCase() === 'completada').filter(coincide)
    .sort((a, b) => (b.completadaEn ?? b.horaInicio).localeCompare(a.completadaEn ?? a.horaInicio)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [todas, busqueda]);
  const porVenir = todas.filter((c) => ['agendada', 'confirmada'].includes((c.estado || '').toLowerCase())).length;

  const refrescar = () => { qc.invalidateQueries({ queryKey: ['citas'] }); qc.invalidateQueries({ queryKey: ['idea1-citas'] }); };
  const medicoMut = useMutation({
    mutationFn: (a: { citaId: string; accion: 'tomar' | 'soltar' } | { citaId: string; accion: 'asignar'; medicoId: string | null }) =>
      a.accion === 'tomar' ? medicoCitaApi.tomar(a.citaId) : a.accion === 'soltar' ? medicoCitaApi.soltar(a.citaId) : a.accion === 'asignar' ? medicoCitaApi.asignar(a.citaId, a.medicoId) : Promise.reject(new Error('Acción desconocida')),
    onSuccess: (_r, a) => { refrescar(); toast.success(a.accion === 'tomar' ? 'Paciente tomado: ya eres su médico' : a.accion === 'soltar' ? 'Soltaste la cita' : 'Médico actualizado'); },
    onError: (e: Error) => { refrescar(); toast.error(e.message); },
  });
  const { data: asignables = [] } = useQuery({
    queryKey: ['medicos-asignables', sedeId],
    queryFn: () => medicoCitaApi.asignables(sedeId),
    enabled: puedeAsignar && !!sedeId,
    staleTime: 300_000,
  });

  // Cada fila: qué puede hacer quien mira.
  const acciones = (c: CitaResumen) => {
    const llevaMedico = citaLlevaMedico(c);
    const esMia = !!miFicha && c.medicoId === miFicha;
    return {
      llevaMedico,
      esMia,
      puedeTomar: soyMedico && llevaMedico && !c.medicoId,
      puedeSoltar: !!c.medicoId && (esMia || puedeAsignar),
      puedeAsignar: puedeAsignar && llevaMedico,
      // El médico atiende a SU paciente (o a uno sin médico, que toma al entrar); administración entra a cualquiera.
      puedeAtender: puedeVerHc && (!soyMedico || esMia || !c.medicoId || puedeAsignar),
      llegoHora: horaDe(c.llegoEn) ?? c.horaInicio,
      enAtencionHora: horaDe(c.enAtencionEn),
      esperaMin: c.llegoEn && c.estado === 'llego' ? Math.max(0, Math.round((Date.now() - new Date(c.llegoEn).getTime()) / 60000)) : null,
    };
  };

  const tomar = (c: CitaResumen) => medicoMut.mutate({ citaId: c.id, accion: 'tomar' });
  const soltar = (c: CitaResumen) => medicoMut.mutate({ citaId: c.id, accion: 'soltar' });
  const asignar = (c: CitaResumen, medicoId: string | null) => medicoMut.mutate({ citaId: c.id, accion: 'asignar', medicoId });
  /** Entra a la historia clínica de esa cita; si soy médico y no tiene médico, me la tomo primero. */
  const atender = async (c: CitaResumen, tab?: 'receta') => {
    if (soyMedico && citaLlevaMedico(c) && !c.medicoId && ESTADOS_EN_SEDE.includes((c.estado || '').toLowerCase())) {
      try { await medicoCitaApi.tomar(c.id); refrescar(); } catch (e) { toast.error((e as Error).message); return; }
    }
    navigate(`/historia-clinica/${c.pacienteId}?cita=${c.id}${tab ? `&tab=${tab}` : ''}`);
  };

  return {
    usuario, soyMedico, puedeAsignar, miFicha,
    sedes, sedeId, setSedeId, sedeNombre: sedes.find((s) => s.id === sedeId)?.nombre ?? '',
    fecha, cargando: citasQ.isLoading, error: citasQ.error as Error | null,
    filtro, setFiltro, busqueda, setBusqueda, verAtendidos, setVerAtendidos,
    enSede, atendidos, porVenir, asignables, acciones,
    tomar, soltar, asignar, atender, pendiente: medicoMut.isPending,
    refrescar: () => void citasQ.refetch(),
  };
}
