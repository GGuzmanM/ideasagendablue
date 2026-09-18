import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { medicoCitaApi } from '../api/medicoCita';
import { useAuthStore } from '../stores/authStore';

/** Lo mínimo de una cita para mostrar / cambiar su médico (sirve la de la agenda y la de la HC). */
export interface CitaConMedico {
  id: string;
  sedeId: string;
  estado: string;
  medicoId?: string | null;
  medico?: { id: string; nombres: string; apellidos: string; colegiatura?: string | null } | null;
  unidadNegocio?: { nombre: string } | null;
}

const SIN_CAMBIO_MEDICO = ['cancelada', 'reprogramada', 'no_show'];

/** Podología lleva médico; en las demás unidades solo se muestra si ya tiene uno. */
export const citaLlevaMedico = (c: Pick<CitaConMedico, 'unidadNegocio' | 'medicoId'>) =>
  /podolog/i.test(c.unidadNegocio?.nombre ?? '') || !!c.medicoId;

/**
 * Médico de la cita en el detalle: el médico se toma / suelta la cita; admin y coordinación
 * eligen a cualquiera. El servidor tiene la última palabra (no quitarle la cita a otro médico,
 * no soltarla con receta emitida…); aquí solo se ofrece lo que va a poder hacer.
 */
export function useMedicoDeLaCita(cita: CitaConMedico) {
  const qc = useQueryClient();
  const usuario = useAuthStore((s) => s.usuario);
  const tiene = useAuthStore((s) => s.tiene);
  const puedeAsignar = tiene('medico.asignar');
  const miFicha = usuario?.profesional?.tipo === 'medico' ? usuario.profesionalId ?? null : null;
  const soyMedico = !!miFicha && tiene('medico.autoasignar');
  const activa = !SIN_CAMBIO_MEDICO.includes((cita.estado || '').toLowerCase());
  const medicoId = cita.medicoId ?? null;
  const esMia = !!miFicha && medicoId === miFicha;

  const { data: asignables = [], isLoading: cargandoAsignables } = useQuery({
    queryKey: ['medicos-asignables', cita.sedeId],
    queryFn: () => medicoCitaApi.asignables(cita.sedeId),
    enabled: puedeAsignar && activa,
    staleTime: 300_000,
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['citas'] });
    qc.invalidateQueries({ queryKey: ['idea1-citas'] });
    qc.invalidateQueries({ queryKey: ['cita-detalle', cita.id] });
    qc.invalidateQueries({ queryKey: ['historia-clinica'] });
    qc.invalidateQueries({ queryKey: ['atencion-clinica'] });
  };
  const mut = useMutation({
    mutationFn: (a: { accion: 'tomar' } | { accion: 'soltar' } | { accion: 'asignar'; medicoId: string | null }) =>
      a.accion === 'tomar' ? medicoCitaApi.tomar(cita.id)
        : a.accion === 'soltar' ? medicoCitaApi.soltar(cita.id)
          : medicoCitaApi.asignar(cita.id, a.medicoId),
    onSuccess: (_r, a) => {
      refrescar();
      toast.success(a.accion === 'tomar' ? 'Tomaste esta cita' : a.accion === 'soltar' ? 'Soltaste la cita' : 'Médico actualizado');
    },
    onError: (e: Error) => { refrescar(); toast.error(e.message); },
  });

  return {
    medico: cita.medico ?? null,
    medicoId,
    activa,
    soyMedico,
    esMia,
    puedeAsignar,
    puedeTomar: activa && soyMedico && !medicoId,
    puedeSoltar: activa && medicoId !== null && (esMia || puedeAsignar),
    asignables,
    cargandoAsignables,
    tomar: () => mut.mutate({ accion: 'tomar' }),
    soltar: () => mut.mutate({ accion: 'soltar' }),
    asignar: (id: string | null) => mut.mutate({ accion: 'asignar', medicoId: id }),
    pendiente: mut.isPending,
  };
}
