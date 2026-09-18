// Resumen de la atención para el paciente (4.4): trae lo que se le va a entregar, abre el PDF y lo
// envía por correo. El texto en lenguaje simple lo arma el servidor (services/resumenPaciente.ts del
// API), así que el PDF que se ve es exactamente el que le llega al paciente.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { historiaClinicaApi } from '../api/historiaClinica';

export interface SeccionResumen { titulo: string; items: string[]; nota?: string }
export interface ResumenPaciente {
  titulo: string; paciente: string; fecha: string; sede: string; profesional: string;
  secciones: SeccionResumen[]; proximoControl: string | null; pie: string;
}
export interface DatosResumenPaciente {
  resumen: ResumenPaciente;
  correo: string | null;
  /** Por qué NO se puede enviar (null = sí se puede). Se muestra antes de intentarlo. */
  motivoNoEnviable: string | null;
  ultimoEnvio: { enviadoEn: string; porUsuarioId: string | null } | null;
}

export const resumenKey = (atencionId: string) => ['resumen-paciente', atencionId];

export function useResumenPaciente(atencionId: string) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: resumenKey(atencionId),
    queryFn: () => api.get<DatosResumenPaciente>(`/historia-clinica/atenciones/${atencionId}/resumen-paciente`),
    staleTime: 30_000,
  });

  const verPdf = async () => {
    try {
      const url = URL.createObjectURL(await historiaClinicaApi.blobResumenPaciente(atencionId));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const enviarMut = useMutation({
    mutationFn: () => api.post<{ enviadoA: string }>(`/historia-clinica/atenciones/${atencionId}/resumen-paciente/enviar`, {}),
    onSuccess: (r) => {
      toast.success(`Resumen enviado a ${r.enviadoA}`);
      qc.invalidateQueries({ queryKey: resumenKey(atencionId) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { datos: data ?? null, cargando: isLoading, error: error ? (error as Error).message : null, verPdf, enviarMut };
}
