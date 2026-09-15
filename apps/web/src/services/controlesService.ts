// Controles sugeridos (4.1) y su alerta (4.2): diálogo de cierre de la atención, sección de la
// bandeja clínica y contador del menú. Vista pura en los componentes; la lógica vive aquí.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { historiaClinicaApi, type AtencionCompleta, type ControlEntrada, type SugerenciaControl } from '../api/historiaClinica';
import { useAuthStore } from '../stores/authStore';

export const controlesKey = ['hc-controles'] as const;
export const contadorControlesKey = ['hc-controles-contador'] as const;

const hoyLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
const sumarDias = (f: string, d: number) => { const x = new Date(`${f}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

export interface FilaControl extends SugerenciaControl { clave: string; incluir: boolean }

/** Tras cerrar o resolver: refresca la bandeja y el contador del menú. */
export function useInvalidarControles() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: controlesKey });
    void qc.invalidateQueries({ queryKey: contadorControlesKey });
  };
}

/** Diálogo de cierre: sugerencias (IWGDF + servicios indicados) editables, más controles manuales. */
export function useCierreConControles(a: AtencionCompleta) {
  const q = useQuery({ queryKey: ['hc-controles-sugeridos', a.id], queryFn: () => historiaClinicaApi.sugerenciasControl(a.id), staleTime: 0, gcTime: 0 });
  const [filas, setFilas] = useState<FilaControl[] | null>(null);
  useEffect(() => {
    if (q.data && filas === null) setFilas(q.data.sugerencias.map((s, i) => ({ ...s, clave: `${s.origen}-${i}`, incluir: true })));
  }, [q.data, filas]);
  const hoy = q.data?.hoy ?? hoyLima();
  const lista = filas ?? [];
  const cambiar = (clave: string, cambios: Partial<FilaControl>) => setFilas((fs) => (fs ?? []).map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));
  const agregarManual = () => setFilas((fs) => [...(fs ?? []), {
    clave: `manual-${Date.now()}`, incluir: true, origen: 'manual', fechaSugerida: sumarDias(hoy, 30), motivo: '',
    servicioId: a.servicioId, servicioNombre: a.servicio.nombre, riesgo: null,
  }]);
  const quitar = (clave: string) => setFilas((fs) => (fs ?? []).filter((f) => f.clave !== clave));
  const elegidas = lista.filter((f) => f.incluir);
  const invalidas = elegidas.filter((f) => f.motivo.trim().length < 3 || !f.fechaSugerida || f.fechaSugerida < hoy).length;
  const controles: ControlEntrada[] = elegidas.map((f) => ({ fechaSugerida: f.fechaSugerida, motivo: f.motivo.trim(), origen: f.origen, servicioId: f.servicioId ?? null }));
  return {
    cargando: q.isLoading, error: q.error as Error | null, hoy, filas: lista, cambiar, agregarManual, quitar,
    controles, invalidas, pendientes: q.data?.pendientes ?? [],
  };
}

/** Sección «Controles por agendar» de la bandeja clínica. */
export function useControlesBandeja() {
  const navigate = useNavigate();
  const invalidar = useInvalidarControles();
  const [dias, setDias] = useState(14);
  const q = useQuery({ queryKey: [...controlesKey, dias], queryFn: () => historiaClinicaApi.controles(dias), staleTime: 60_000 });
  const [descartando, setDescartando] = useState<string | null>(null);
  const resolverMut = useMutation({
    mutationFn: (v: { id: string; accion: 'agendar' | 'descartar'; citaId?: string | null; motivo?: string | null }) => historiaClinicaApi.resolverControl(v.id, v),
    onSuccess: (r) => {
      toast.success(r.estado === 'agendado' ? 'Control marcado como agendado' : 'Control descartado');
      invalidar();
      setDescartando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return {
    dias, setDias, datos: q.data, cargando: q.isLoading, error: q.error as Error | null,
    resolverMut, descartando, setDescartando, abrirPaciente: (id: string) => navigate(`/historia-clinica/${id}`),
  };
}

/** Contador del menú: controles vencidos + los que vencen en 7 días (se refresca cada 5 min). */
export function useContadorControles() {
  const puede = useAuthStore((s) => s.tiene('hc.ver'));
  const q = useQuery({ queryKey: contadorControlesKey, queryFn: historiaClinicaApi.contadorControles, enabled: puede, refetchInterval: 300_000, staleTime: 60_000 });
  return q.data ?? { vencidos: 0, proximos: 0, total: 0 };
}
