import { useQuery } from '@tanstack/react-query';
import { canalesApi } from '../api/canales';

// Lista dinámica de canales de reserva activos (administrable desde Herramientas).
export function useCanales() {
  const { data } = useQuery({
    queryKey: ['canales-activos'],
    queryFn: canalesApi.activos,
    staleTime: 5 * 60_000,
  });
  const canales = (data ?? []).map(c => ({ value: c.id, label: c.etiqueta }));
  const map = new Map((data ?? []).map(c => [c.id, c.etiqueta]));
  const labelCanal = (v: string | null | undefined) => (v ? map.get(v) ?? v : '—');
  return { canales, labelCanal, rawCanales: data ?? [] };
}
