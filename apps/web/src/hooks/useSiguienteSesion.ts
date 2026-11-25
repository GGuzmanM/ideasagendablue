import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

/** Respuesta de GET /pacientes/:id/siguiente-sesion (ver apps/api/src/services/siguienteSesion.ts). */
export interface SiguienteSesion {
  sugerida: { id: string; nombre: string } | null;
  motivo: 'inicio' | 'siguiente' | 'paquete_completo' | 'sin_dato' | 'sin_serie';
  ultima: { fecha: string; horaInicio: string; estado: string; opcion: string | null } | null;
}

const ESTADO_TXT: Record<string, string> = {
  agendada: 'agendada', confirmada: 'confirmada', llego: 'llegó', en_atencion: 'en atención', completada: 'completada',
};
const fechaCorta = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };

/**
 * Seguimiento automático de sesiones (24-nov-2026): al elegir un servicio con opciones en serie (Sesión 1…N, Curación 1…N),
 * PRESELECCIONA la que sigue según la última cita viva del paciente. Solo rellena si la opción está vacía o la había puesto
 * él mismo (si recepción eligió otra a mano, no la pisa). Devuelve el texto de ayuda para mostrar bajo el selector.
 */
export function useSiguienteSesion(p: {
  pacienteId: string | null | undefined;
  servicioId: string;
  opciones: { id: string }[];
  valor: string;
  setValor: (id: string) => void;
  habilitado?: boolean;
}): string | null {
  const activo = Boolean(p.pacienteId && p.servicioId && p.opciones.length > 0 && p.habilitado !== false);
  const { data } = useQuery({
    queryKey: ['siguiente-sesion', p.pacienteId, p.servicioId],
    queryFn: () => api.get<SiguienteSesion>(`/pacientes/${p.pacienteId}/siguiente-sesion?servicioId=${encodeURIComponent(p.servicioId)}`),
    enabled: activo,
    staleTime: 30_000,
  });
  const puestaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activo || !data?.sugerida) return;
    if (!p.opciones.some((o) => o.id === data.sugerida!.id)) return;
    if (p.valor && p.valor !== puestaRef.current) return; // la eligió recepción: se respeta
    if (p.valor === data.sugerida.id) return;
    puestaRef.current = data.sugerida.id;
    p.setValor(data.sugerida.id);
  }, [activo, data, p.opciones, p.valor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activo || !data) return null;
  const u = data.ultima;
  const previa = u ? `${u.opcion ?? 'sin opción'} (${ESTADO_TXT[u.estado] ?? u.estado}, ${fechaCorta(u.fecha)})` : '';
  if (data.motivo === 'siguiente' && data.sugerida) {
    return data.sugerida.id === p.valor ? `Sigue ${data.sugerida.nombre}: la anterior fue ${previa}.` : `Le tocaría ${data.sugerida.nombre}: la anterior fue ${previa}.`;
  }
  if (data.motivo === 'inicio' && data.sugerida) return data.sugerida.id === p.valor ? `Primera del tratamiento: ${data.sugerida.nombre}.` : null;
  if (data.motivo === 'paquete_completo') return `Ya llegó a la última: ${previa}. Elige la opción si empieza otro tratamiento.`;
  return null;
}
