import { useQuery } from '@tanstack/react-query';
import { canalesApi } from '../api/canales';

// Lista dinámica de canales de reserva activos (administrable desde Herramientas).
//
// OJO: hay dos usos con semántica distinta:
//  - `canales`         → para `Cita.canal` (guardado como `valor`/slug, ej. "recepcion").
//  - `canalesPaciente` → para `Paciente.canalId` (FK al `id` del canal).
// Enviar el id donde se espera el valor hace que el backend rechace con
// "Canal de reserva inválido o inactivo" (visto en /idea1 al elegir cualquier
// canal distinto al inicial por defecto).
export function useCanales() {
  const { data } = useQuery({
    queryKey: ['canales-activos'],
    queryFn: canalesApi.activos,
    staleTime: 5 * 60_000,
  });
  const canales = (data ?? []).map(c => ({ value: c.valor, label: c.etiqueta }));
  const canalesPaciente = (data ?? []).map(c => ({ value: c.id, label: c.etiqueta }));
  const mapValor = new Map((data ?? []).map(c => [c.valor, c.etiqueta]));
  const mapId = new Map((data ?? []).map(c => [c.id, c.etiqueta]));
  const labelCanal = (v: string | null | undefined) => (v ? mapValor.get(v) ?? v : '—');
  const labelCanalPorId = (id: string | null | undefined) => (id ? mapId.get(id) ?? id : '—');
  return { canales, canalesPaciente, labelCanal, labelCanalPorId, rawCanales: data ?? [] };
}
