// Consentimiento informado: formato OFICIAL por secciones (18-sep-2026), firma en cualquier momento
// (desde la cita, la atención o el paciente) y aviso de los que faltan según el tratamiento.
import { api } from './client';
import { useAuthStore } from '../stores/authStore';
import type { RelacionFirmante, TrazoFirma } from './historiaClinica';

const B = '/historia-clinica';

export interface ContenidoConsentimiento {
  version: 2;
  titulo: string;
  nombreCorto: string;
  procedimiento: string;
  explicaciones: { titulo: string; texto: string }[];
  aclaracion: { titulo: string; parrafos: string[] } | null;
  beneficios: string[];
  notaBeneficios: string;
  riesgos: { frecuentes: string[]; pocoFrecuentes: string[]; raros: string[] };
  riesgosParticulares: string[];
  medicamentos: string[];
  alternativas: string[];
  cuidados: string[];
  campos: { dedos: boolean; alcance: string[] };
  servicioIds: string[];
  vigenciaDias: number;
}

export interface PlantillaParaFirmar {
  id: string; clave: string | null; nombre: string; oficial: boolean;
  contenido: ContenidoConsentimiento | null; textoLibre: string | null;
  /** El servicio de la cita exige este consentimiento. */
  requerida: boolean;
  /** Casillas de «riesgos particulares» que la historia ya conoce (se premarcan). */
  riesgosSugeridos: string[];
  firmado: { id: string; numero: number; firmadoEn: string } | null;
}

export interface ContextoFirma {
  origen: { citaId: string | null; atencionId: string | null; pacienteId: string; sedeId: string };
  paciente: { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string; tipoDocumento: string; numeroDocumento: string; fechaNacimiento: string | null; sexo: string | null; telefono: string };
  sede: { id: string; nombre: string; direccion: string | null } | null;
  historiaNumero: number | null;
  profesional: { id: string; nombre: string; colegiatura: string | null } | null;
  plantillas: PlantillaParaFirmar[];
}

export interface OrigenFirma { citaId?: string | null; atencionId?: string | null; pacienteId?: string | null; sedeId?: string | null }

export interface DatosFirma {
  dedos?: string | null; alcance?: string | null; riesgos: string[]; otraCondicion?: string | null;
  domicilio?: string | null; telefono?: string | null;
  representante?: { nombre: string; documento: string; parentesco: string } | null;
  testigo?: { nombre: string; documento: string | null } | null;
}

export interface NuevoConsentimiento extends OrigenFirma {
  plantillaId?: string | null;
  procedimiento?: string | null; texto?: string | null;
  firmanteNombre: string; firmanteDocumento?: string | null; firmanteRelacion: RelacionFirmante;
  firma: TrazoFirma[]; firmaAspecto: number;
  datos?: DatosFirma | null; firmaProfesional?: TrazoFirma[] | null; firmaTestigo?: TrazoFirma[] | null;
}

export interface ConsentimientoPaciente {
  id: string; numero: number; procedimiento: string; formato: number; plantillaClave: string | null;
  atencionId: string | null; citaId: string | null; sedeId: string;
  firmanteNombre: string; firmanteDocumento: string | null; firmanteRelacion: RelacionFirmante;
  estado: 'firmado' | 'revocado'; firmadoEn: string; revocadoEn: string | null; motivoRevocacion: string | null; registradoEtiqueta: string | null;
}

export interface PendienteConsentimiento { id: string; clave: string | null; nombre: string }

const qs = (o: OrigenFirma) => new URLSearchParams(Object.entries(o).filter(([, v]) => !!v) as [string, string][]).toString();

export const consentimientosApi = {
  contexto: (o: OrigenFirma) => api.get<ContextoFirma>(`${B}/consentimientos/contexto?${qs(o)}`),
  crear: (data: NuevoConsentimiento) => api.post<{ id: string; numero: number }>(`${B}/consentimientos`, data),
  pendientesDeCita: (citaId: string) => api.get<PendienteConsentimiento[]>(`${B}/citas/${citaId}/consentimientos-pendientes`),
  dePaciente: (pacienteId: string) => api.get<ConsentimientoPaciente[]>(`${B}/pacientes/${pacienteId}/consentimientos`),
  revocar: (id: string, motivo: string | null) => api.patch<{ ok: boolean }>(`${B}/consentimientos/${id}/revocar`, { motivo }),
  pdfBlob: async (id: string, copias?: 1 | 2): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`/api/v1${B}/consentimientos/${id}/pdf${copias === 1 ? '?copias=1' : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'No se pudo generar el PDF' }));
      throw new Error((err as { message?: string }).message ?? 'No se pudo generar el PDF');
    }
    return res.blob();
  },
};

export const consentimientosPacienteKey = (pacienteId: string) => ['consentimientos-paciente', pacienteId] as const;
export const pendientesCitaKey = (citaId: string) => ['consentimientos-pendientes', citaId] as const;
