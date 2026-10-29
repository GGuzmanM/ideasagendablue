import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { serviciosApi, type ServicioReservaWeb } from '../api';
import { useAuthStore } from '../stores/authStore';

export type FiltroReservaWeb = 'todos' | 'web' | 'sin_web';

/**
 * Administración › Reserva web (29-oct-2026): qué servicios se ofrecen en la reserva web (página /reserva y chat de
 * WhatsApp) y a qué precio. Espeja los campos de la base: servicios.reservaOnline + precioOnline y, por tipo,
 * subcategorias_servicio.reservaOnline + precioOnline. Precio vacío = se usa el precio de la clínica.
 */
export function useReservaWebServicios() {
  const qc = useQueryClient();
  const puedeEditar = useAuthStore((s) => s.tiene('servicios.editar'));
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<FiltroReservaWeb>('todos');

  const { data, isLoading } = useQuery({ queryKey: ['reserva-web-servicios'], queryFn: serviciosApi.reservaWeb });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['reserva-web-servicios'] });
    qc.invalidateQueries({ queryKey: ['servicios'] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const servicioMut = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: { reservaOnline?: boolean; precioOnline?: number | null } }) => serviciosApi.editarReservaWeb(id, cambios),
    onSuccess: (_r, v) => { refrescar(); toast.success(v.cambios.reservaOnline === undefined ? 'Precio web guardado' : v.cambios.reservaOnline ? 'Se ofrece en la reserva web' : 'Quitado de la reserva web'); },
    onError,
  });
  const tipoMut = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: { reservaOnline?: boolean; precioOnline?: number | null } }) => serviciosApi.editarTipoReservaWeb(id, cambios),
    onSuccess: (_r, v) => { refrescar(); toast.success(v.cambios.reservaOnline === undefined ? 'Precio web guardado' : v.cambios.reservaOnline ? 'Tipo activado para la web' : 'Tipo quitado de la web'); },
    onError,
  });

  // Precio propio de una sede (precio null = quitarlo). `tipo` distingue servicio / tipo del servicio.
  const precioSedeMut = useMutation({
    mutationFn: ({ id, tipo, sedeId, precio }: { id: string; tipo: boolean; sedeId: string; precio: number | null }) =>
      tipo ? serviciosApi.precioWebSedeTipo(id, sedeId, precio) : serviciosApi.precioWebSedeServicio(id, sedeId, precio),
    onSuccess: (_r, v) => { refrescar(); toast.success(v.precio === null ? 'Esa sede vuelve al precio general' : 'Precio de la sede guardado'); },
    onError,
  });

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data ?? []).filter((s) => {
      if (filtro === 'web' && !s.reservaOnline) return false;
      if (filtro === 'sin_web' && s.reservaOnline) return false;
      return !q || s.nombre.toLowerCase().includes(q) || s.codigo.toLowerCase().includes(q);
    });
  }, [data, busqueda, filtro]);

  const porUnidad = useMemo(() => {
    const m = new Map<string, ServicioReservaWeb[]>();
    for (const s of filtrados) m.set(s.unidad.nombre, [...(m.get(s.unidad.nombre) ?? []), s]);
    return [...m.entries()];
  }, [filtrados]);

  return {
    isLoading, puedeEditar, busqueda, setBusqueda, filtro, setFiltro, porUnidad,
    total: data?.length ?? 0,
    conWeb: (data ?? []).filter((s) => s.reservaOnline).length,
    ofrecidos: (data ?? []).filter((s) => s.ofrecido).length,
    /** Cuántos servicios tiene cada filtro (para mostrarlo en los botones, sin importar la búsqueda). */
    conteos: {
      todos: data?.length ?? 0,
      web: (data ?? []).filter((s) => s.reservaOnline).length,
      sin_web: (data ?? []).filter((s) => !s.reservaOnline).length,
    } satisfies Record<FiltroReservaWeb, number>,
    /** Servicios y tipos que cobran distinto en alguna sede. */
    conPrecioPorSede: (data ?? []).filter((s) => Object.keys(s.preciosSede).length > 0 || s.subcategorias.some((t) => Object.keys(t.preciosSede).length > 0)).length,
    servicioMut, tipoMut, precioSedeMut,
  };
}
