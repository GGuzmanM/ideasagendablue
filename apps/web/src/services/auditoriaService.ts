import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../api/client';

export interface AuditLogItem {
  id: string;
  creadoEn: string;
  accion: string;
  entidad: string;
  entidadId: string;
  usuario: { nombre: string } | null;
}

export const ACCION_ICON: Record<string, string> = {
  crear: '➕',
  mover: '↕️',
  cambiar_estado: '🔄',
  cancelar: '❌',
  redistribuir: '🔀',
};

export function useAuditoriaData() {
  const hoy = format(new Date(), 'yyyy-MM-dd');
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);

  const { data, isLoading } = useQuery<{ data: AuditLogItem[] }>({
    queryKey: ['audit', desde, hasta],
    queryFn: () => api.get<{ data: AuditLogItem[] }>('/audit', { desde, hasta, limit: '100' }),
  });

  return {
    desde,
    setDesde,
    hasta,
    setHasta,
    logs: data?.data ?? [],
    isLoading,
  };
}
