// Historia clínica — UN módulo de API + queryKeys + hooks (patrón de paquetesSesiones.ts).
// Las lecturas de HC quedan AUDITADAS en el backend: staleTime alto y sin refetch al enfocar
// la ventana, para no generar "ver_hc" de más. Las escrituras devuelven la entidad completa.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export type EstadoAtencion = 'abierta' | 'cerrada';
export type TipoNota = 'evolucion' | 'procedimiento' | 'indicacion' | 'observacion';
export type TipoDiagnostico = 'presuntivo' | 'definitivo';
export type TipoAntecedente = 'patologico' | 'quirurgico' | 'familiar' | 'farmacologico' | 'habito' | 'otro';
export type SeveridadAlergia = 'leve' | 'moderada' | 'severa';

export const TIPO_ANTECEDENTE_LABEL: Record<TipoAntecedente, string> = {
  patologico: 'Patológico', quirurgico: 'Quirúrgico', familiar: 'Familiar', farmacologico: 'Farmacológico', habito: 'Hábito', otro: 'Otro',
};
export const TIPO_NOTA_LABEL: Record<TipoNota, string> = {
  evolucion: 'Evolución', procedimiento: 'Procedimiento', indicacion: 'Indicación', observacion: 'Observación',
};

export interface ProfesionalMini { id: string; nombres: string; apellidos: string; tipo: string }

export interface PacienteHc {
  id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string;
  tipoDocumento: string; numeroDocumento: string; fechaNacimiento: string | null; sexo: string | null;
  telefono?: string; email?: string | null;
}

export interface NotaEvolucion {
  id: string; atencionId: string; tipo: TipoNota;
  subjetivo: string | null; objetivo: string | null; apreciacion: string | null; plan: string | null; texto: string | null;
  profesionalId: string | null; profesional: ProfesionalMini | null;
  autorUsuarioId: string | null; autorEtiqueta: string; version: number; editadaEn: string | null; creadoEn: string;
}

export interface DiagnosticoAtencion {
  id: string; atencionId: string; cie10Codigo: string; tipo: TipoDiagnostico; principal: boolean; observacion: string | null;
  registradoEtiqueta: string; creadoEn: string;
  cie10: { codigo: string; descripcion: string; categoria: string | null };
}

export interface RecetaResumen {
  id: string; numero: number; tipoDocumento: 'RECETA_MEDICA' | 'INDICACIONES_PODOLOGICAS'; estado: 'emitida' | 'anulada';
  fechaEmision: string; emisorNombre: string; codigoVerificacion: string; _count: { items: number };
}

export interface Alergia {
  id: string; sustancia: string; reaccion: string | null; severidad: SeveridadAlergia; activa: boolean; registradoEtiqueta: string; creadoEn: string;
}
export interface Antecedente {
  id: string; tipo: TipoAntecedente; descripcion: string; activo: boolean; registradoEtiqueta: string; creadoEn: string;
}

export interface AtencionClinica {
  id: string; historiaClinicaId: string; citaId: string; pacienteId: string; profesionalId: string; sedeId: string; servicioId: string;
  subcategoriaId: string | null; fecha: string; motivoConsulta: string; estado: EstadoAtencion;
  abiertaEtiqueta: string | null; cerradaEn: string | null; creadoEn: string;
  cita: { id: string; horaInicio: string; estado: string; duracionMinutos: number };
  profesional: ProfesionalMini; sede: { id: string; nombre: string; color: string }; servicio: { id: string; nombre: string; color: string };
  notas: NotaEvolucion[]; diagnosticos: DiagnosticoAtencion[]; recetas: RecetaResumen[];
}

export interface AtencionCompleta extends AtencionClinica {
  historiaClinica: { id: string; numero: number; pacienteId: string; alergias: Alergia[] };
  paciente: PacienteHc;
}

export interface HistoriaCompleta {
  paciente: PacienteHc;
  historia: {
    id: string; numero: number; estado: 'activa' | 'pasiva'; fechaApertura: string;
    alergias: Alergia[]; antecedentes: Antecedente[]; atenciones: AtencionClinica[];
  } | null;
}

export interface ResumenAtencionCita {
  atencionId: string | null; citaPrincipalId: string; pacienteId: string; estado?: EstadoAtencion;
  totalNotas?: number; totalDiagnosticos?: number; totalRecetas?: number; puedeAbrir?: boolean;
}

export interface Anteriores {
  diagnosticos: { id: string; fecha: string; diagnosticos: DiagnosticoAtencion[] } | null;
  nota: (NotaEvolucion & { atencion: { id: string; fecha: string; servicio: { nombre: string } } }) | null;
}

export interface CamposNota {
  tipo?: TipoNota; subjetivo?: string | null; objetivo?: string | null; apreciacion?: string | null; plan?: string | null; texto?: string | null; profesionalId?: string | null;
}

export const historiaClinicaKey = (pacienteId: string) => ['historia-clinica', pacienteId] as const;
export const atencionKey = (atencionId: string) => ['atencion-clinica', atencionId] as const;
export const atencionPorCitaKey = (citaId: string) => ['atencion-por-cita', citaId] as const;

const B = '/historia-clinica';
export const historiaClinicaApi = {
  dePaciente: (pacienteId: string) => api.get<HistoriaCompleta>(`${B}/paciente/${pacienteId}`),
  atencion: (id: string) => api.get<AtencionCompleta>(`${B}/atenciones/${id}`),
  resumenPorCita: (citaId: string) => api.get<ResumenAtencionCita>(`${B}/atencion/por-cita/${citaId}/resumen`),
  anteriores: (atencionId: string) => api.get<Anteriores>(`${B}/atenciones/${atencionId}/anteriores`),
  abrirAtencion: (data: { citaId: string; motivoConsulta: string; profesionalId?: string | null }) => api.post<AtencionCompleta>(`${B}/atenciones`, data),
  editarAtencion: (id: string, data: { motivoConsulta?: string; profesionalId?: string | null }) => api.patch<AtencionCompleta>(`${B}/atenciones/${id}`, data),
  cerrarAtencion: (id: string) => api.patch<AtencionCompleta>(`${B}/atenciones/${id}/cerrar`, {}),
  reabrirAtencion: (id: string) => api.patch<AtencionCompleta>(`${B}/atenciones/${id}/reabrir`, {}),
  agregarNota: (atencionId: string, data: CamposNota) => api.post<AtencionCompleta>(`${B}/atenciones/${atencionId}/notas`, data),
  editarNota: (notaId: string, data: CamposNota) => api.patch<AtencionCompleta>(`${B}/notas/${notaId}`, data),
  eliminarNota: (notaId: string) => api.delete<AtencionCompleta>(`${B}/notas/${notaId}`),
  agregarDiagnostico: (atencionId: string, data: { cie10Codigo: string; tipo?: TipoDiagnostico; principal?: boolean; observacion?: string | null }) =>
    api.post<AtencionCompleta>(`${B}/atenciones/${atencionId}/diagnosticos`, data),
  editarDiagnostico: (id: string, data: { cie10Codigo?: string; tipo?: TipoDiagnostico; principal?: boolean; observacion?: string | null }) =>
    api.patch<AtencionCompleta>(`${B}/diagnosticos/${id}`, data),
  eliminarDiagnostico: (id: string) => api.delete<AtencionCompleta>(`${B}/diagnosticos/${id}`),
  registrarAntecedente: (pacienteId: string, data: { tipo: TipoAntecedente; descripcion: string; sedeId?: string | null }) =>
    api.post<HistoriaCompleta>(`${B}/paciente/${pacienteId}/antecedentes`, data),
  editarAntecedente: (id: string, data: { tipo?: TipoAntecedente; descripcion?: string; activo?: boolean }) => api.patch<HistoriaCompleta>(`${B}/antecedentes/${id}`, data),
  eliminarAntecedente: (id: string) => api.delete<HistoriaCompleta>(`${B}/antecedentes/${id}`),
  registrarAlergia: (pacienteId: string, data: { sustancia: string; reaccion?: string | null; severidad?: SeveridadAlergia; sedeId?: string | null }) =>
    api.post<HistoriaCompleta>(`${B}/paciente/${pacienteId}/alergias`, data),
  editarAlergia: (id: string, data: { sustancia?: string; reaccion?: string | null; severidad?: SeveridadAlergia; activa?: boolean }) => api.patch<HistoriaCompleta>(`${B}/alergias/${id}`, data),
  eliminarAlergia: (id: string) => api.delete<HistoriaCompleta>(`${B}/alergias/${id}`),
};

const OPCIONES_HC = { staleTime: 300_000, refetchOnWindowFocus: false } as const;

export function useHistoriaClinica(pacienteId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: historiaClinicaKey(pacienteId ?? ''),
    queryFn: () => historiaClinicaApi.dePaciente(pacienteId!),
    enabled: !!pacienteId && enabled,
    ...OPCIONES_HC,
  });
}

export function useAtencionClinica(atencionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: atencionKey(atencionId ?? ''),
    queryFn: () => historiaClinicaApi.atencion(atencionId!),
    enabled: !!atencionId && enabled,
    ...OPCIONES_HC,
  });
}

/** Resumen liviano para el modal de cita (no audita en el backend). */
export function useResumenAtencionCita(citaId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: atencionPorCitaKey(citaId ?? ''),
    queryFn: () => historiaClinicaApi.resumenPorCita(citaId!),
    enabled: !!citaId && enabled,
    ...OPCIONES_HC,
  });
}

/** Invalida HC + atención + resumen de cita + recetas del paciente de una sola vez. */
export function useInvalidarHistoriaClinica() {
  const qc = useQueryClient();
  return (p: { pacienteId?: string; atencionId?: string; citaId?: string }) => {
    if (p.pacienteId) {
      void qc.invalidateQueries({ queryKey: historiaClinicaKey(p.pacienteId) });
      void qc.invalidateQueries({ queryKey: ['recetas-paciente', p.pacienteId] });
    }
    if (p.atencionId) void qc.invalidateQueries({ queryKey: atencionKey(p.atencionId) });
    if (p.citaId) void qc.invalidateQueries({ queryKey: atencionPorCitaKey(p.citaId) });
  };
}

// ── Utilidades de presentación ──
export function nombreProfesional(p: ProfesionalMini | null | undefined): string {
  return p ? `${p.nombres} ${p.apellidos}`.trim() : '—';
}
export function edadDe(fechaNacimiento: string | null | undefined): string {
  if (!fechaNacimiento) return '—';
  const fn = new Date(fechaNacimiento); const hoy = new Date();
  let e = hoy.getUTCFullYear() - fn.getUTCFullYear();
  const m = hoy.getUTCMonth() - fn.getUTCMonth();
  if (m < 0 || (m === 0 && hoy.getUTCDate() < fn.getUTCDate())) e--;
  return `${e} años`;
}
