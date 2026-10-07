import { useQuery } from '@tanstack/react-query';
import { reservasWebApi } from '../api/reservasWeb';

/** ¿La reserva web está encendida en el servidor? (06-oct-2026) Para mostrar o no «Reservas web» en el menú. */
export function useReservaWebHabilitada(puedeVer: boolean): boolean {
  const { data } = useQuery({
    queryKey: ['reservas-web', 'estado'],
    queryFn: reservasWebApi.estado,
    enabled: puedeVer,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return !!data?.habilitada;
}
