// Historia clínica — UN módulo de API + queryKeys + hooks (patrón de paquetesSesiones.ts).
// Las lecturas de HC quedan AUDITADAS en el backend: staleTime alto y sin refetch al enfocar
// la ventana, para no generar "ver_hc" de más. Las escrituras devuelven la entidad completa.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
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
  _count?: { procedimientos: number; escalas: number; marcasPodograma: number };
}

// Consentimiento informado (5.1): inmutable; se corrige revocándolo con motivo.
export type RelacionFirmante = 'paciente' | 'apoderado';
export interface Consentimiento {
  id: string; numero: number; procedimiento: string; firmanteNombre: string; firmanteDocumento: string | null; firmanteRelacion: RelacionFirmante;
  estado: 'firmado' | 'revocado'; firmadoEn: string; revocadoEn: string | null; motivoRevocacion: string | null; registradoEtiqueta: string | null;
}
/** Trazo de la firma: puntos normalizados 0..1 sobre el lienzo (ancho × alto). */
export interface TrazoFirma { puntos: [number, number][]; grosor?: number }
export interface CamposConsentimiento {
  procedimiento: string; texto: string; firmanteNombre: string; firmanteDocumento?: string | null; firmanteRelacion: RelacionFirmante;
  firma: TrazoFirma[]; firmaAspecto: number;
}

// Controles sugeridos al cerrar (4.1) y su alerta en la bandeja y el menú (4.2).
export type OrigenControl = 'iwgdf' | 'indicacion' | 'manual';
export const ORIGEN_CONTROL_LABEL: Record<OrigenControl, string> = { iwgdf: 'IWGDF', indicacion: 'Indicación', manual: 'Manual' };
export const RIESGO_IWGDF_LABEL = ['muy bajo', 'bajo', 'moderado', 'alto'];
export interface ControlEntrada { fechaSugerida: string; motivo: string; origen: OrigenControl; servicioId?: string | null }
export interface SugerenciaControl extends ControlEntrada { riesgo: number | null; servicioNombre: string | null }
export interface SugerenciasControl {
  hoy: string; sugerencias: SugerenciaControl[];
  pendientes: { id: string; fechaSugerida: string; motivo: string; origen: OrigenControl }[];
}
export interface ControlAtencion { id: string; fechaSugerida: string; motivo: string; origen: OrigenControl; estado: 'pendiente' | 'agendado' | 'descartado' }
export interface ControlPendiente {
  id: string; fechaSugerida: string; diasRestantes: number; vencido: boolean; motivo: string; origen: OrigenControl; registradoEtiqueta: string | null;
  servicio: { id: string; nombre: string; color: string } | null;
  atencion: { id: string; fecha: string; citaId: string; sede: string; profesional: { nombres: string; apellidos: string } };
  paciente: { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string; telefono: string | null };
  riesgo: number | null;
  proximaCita: { id: string; fecha: string; horaInicio: string; servicio: string; sede: string } | null;
}
export interface ControlesBandeja { hoy: string; horizonteDias: number; controles: ControlPendiente[] }
export interface ContadorControles { vencidos: number; proximos: number; total: number }

export interface AtencionCompleta extends AtencionClinica {
  procedimientos: Procedimiento[]; escalas: Escala[]; marcasPodograma: MarcaPodograma[]; imagenesPodograma: ImagenPodograma[]; fotos: FotoClinica[]; dibujosSilueta?: DibujoSilueta[];
  consentimientos?: Consentimiento[];
  controles?: ControlAtencion[];
  historiaClinica: { id: string; numero: number; pacienteId: string; alergias: Alergia[] };
  paciente: PacienteHc;
}

// ─── Bloque 3 · procedimientos, escalas y podograma ──────────────────────────
export type TipoProcedimiento = 'matricectomia' | 'laser' | 'curacion' | 'debridacion' | 'onicotomia' | 'quiropodia' | 'infiltracion' | 'otro';
export type TipoEscala = 'eva' | 'wagner' | 'texas' | 'iwgdf' | 'monofilamento' | 'termometria' | 'ulcera' | 'itb' | 'osi' | 'manchester' | 'examen';
export type Pie = 'izquierdo' | 'derecho' | 'ambos';
export type PiePodograma = 'izquierdo' | 'derecho';
/** Silueta sobre la que se marca: planta del pie o dorso (uñas, empeine). */
export type VistaSilueta = 'plantar' | 'dorsal';
export const VISTA_SILUETA_LABEL: Record<VistaSilueta, string> = { plantar: 'Planta', dorsal: 'Dorso' };
export type TipoLesion = 'hiperqueratosis' | 'heloma' | 'onicocriptosis' | 'ulcera' | 'fisura' | 'micosis' | 'ampolla' | 'verruga' | 'dolor' | 'inflamacion' | 'cirugia' | 'riesgo' | 'otro';

export const TIPO_PROCEDIMIENTO_LABEL: Record<TipoProcedimiento, string> = {
  matricectomia: 'Matricectomía', laser: 'Láser', curacion: 'Curación', debridacion: 'Debridación',
  onicotomia: 'Onicotomía', quiropodia: 'Quiropodia', infiltracion: 'Infiltración', otro: 'Otro',
};
export const TIPO_ESCALA_LABEL: Record<TipoEscala, string> = {
  eva: 'EVA (dolor)', wagner: 'Wagner', texas: 'Texas', iwgdf: 'IWGDF (riesgo)', monofilamento: 'Monofilamento', termometria: 'Termometría plantar', ulcera: 'Úlcera (medidas)',
  examen: 'Examen del pie', itb: 'ITB y pulsos', osi: 'OSI (onicomicosis)', manchester: 'Manchester (hallux valgus)',
};
export const TIPO_LESION_LABEL: Record<TipoLesion, string> = {
  hiperqueratosis: 'Hiperqueratosis', heloma: 'Heloma', onicocriptosis: 'Onicocriptosis', ulcera: 'Úlcera',
  fisura: 'Fisura', micosis: 'Micosis', ampolla: 'Ampolla', verruga: 'Verruga', dolor: 'Dolor', inflamacion: 'Inflamación',
  cirugia: 'Cirugía / cicatriz', riesgo: 'Zona de riesgo', otro: 'Otro',
};
/** Nombre común de cada lesión (como lo dice el paciente), para que el significado de la marca sea claro. */
export const TIPO_LESION_AYUDA: Record<TipoLesion, string> = {
  hiperqueratosis: 'callosidad, dureza', heloma: 'callo, ojo de gallo', onicocriptosis: 'uñero, uña encarnada', ulcera: 'herida abierta',
  fisura: 'grieta', micosis: 'hongos en piel o uña', ampolla: 'flictena', verruga: 'mezquino', dolor: 'punto de dolor',
  inflamacion: 'hinchazón, edema', cirugia: 'operación previa, cicatriz', riesgo: 'preúlcera, presión alta, prominencia ósea',
  otro: 'escribe qué es en el detalle',
};
/** Color fijo por tipo de lesión: el mismo en los puntos, los dibujos y la leyenda. */
export const COLOR_LESION: Record<TipoLesion, string> = {
  hiperqueratosis: '#f59e0b', heloma: '#ea580c', onicocriptosis: '#8b5cf6', ulcera: '#dc2626', fisura: '#0891b2',
  micosis: '#65a30d', ampolla: '#f472b6', verruga: '#92400e', dolor: '#2563eb', inflamacion: '#c026d3',
  cirugia: '#0f766e', riesgo: '#111827', otro: '#64748b',
};
/** "Heloma · callo, ojo de gallo" (para desplegables y títulos). */
export const etiquetaLesion = (t: TipoLesion) => `${TIPO_LESION_LABEL[t]} · ${TIPO_LESION_AYUDA[t]}`;
export const PIE_LABEL: Record<Pie, string> = { izquierdo: 'Izquierdo', derecho: 'Derecho', ambos: 'Ambos' };

export interface Procedimiento {
  id: string; atencionId: string; tipo: TipoProcedimiento; nombre: string; pie: Pie | null; ubicacion: string | null;
  detalle: string | null; parametros: Record<string, unknown> | null; anestesia: string | null;
  paquetePacienteId: string | null; sesionNumero: number | null; sesionesTotales: number | null;
  profesionalId: string | null; profesionalEtiqueta: string | null; registradoEtiqueta: string | null; creadoEn: string;
}
export interface Escala {
  id: string; atencionId: string; tipo: TipoEscala; datos: Record<string, unknown>; resultado: string | null;
  pie: Pie | null; registradoEtiqueta: string | null; creadoEn: string;
}
export interface MarcaPodograma {
  id: string; atencionId: string; pie: PiePodograma; vista: VistaSilueta; x: number; y: number; zona: string | null;
  tipoLesion: TipoLesion; nota: string | null; registradoEtiqueta: string | null; creadoEn: string;
}
export interface PaqueteLaser {
  id: string; nombre: string; sesionesTotal: number; sesionesUsadas: number; sesionesRestantes: number; vigenciaFin: string | null;
}
export interface CamposProcedimiento {
  tipo: TipoProcedimiento; nombre?: string; pie?: Pie | null; ubicacion?: string | null; detalle?: string | null;
  parametros?: Record<string, unknown> | null; anestesia?: string | null; paquetePacienteId?: string | null; sesionNumero?: number | null; profesionalId?: string | null;
}
export interface CamposMarca { pie: PiePodograma; vista?: VistaSilueta; x: number; y: number; zona?: string | null; tipoLesion: TipoLesion; nota?: string | null }

// ─── 2.8 Ficha previa · escalas por paciente · plantillas y autotextos (1.1 / 1.2) ───
export type NivelBandera = 'alto' | 'medio' | 'info';
export interface Bandera { clave: string; etiqueta: string; nivel: NivelBandera }
export interface FichaPrevia {
  tieneHistoria: boolean; numero: number | null; totalAtenciones: number;
  alergias: { sustancia: string; reaccion: string | null; severidad: SeveridadAlergia }[];
  banderas: Bandera[];
  riesgoIwgdf: { categoria: number; etiqueta: string | null; fecha: string } | null;
  monofilamentoAlterado: boolean | null;
  ultimoDx: { codigo: string; descripcion: string; tipo: TipoDiagnostico; fecha: string } | null;
  ultimoProcedimiento: { tipo: TipoProcedimiento; nombre: string; pie: Pie | null; ubicacion: string | null; fecha: string } | null;
  ultimaAtencion: { id: string; fecha: string; estado: 'abierta' | 'cerrada'; motivoConsulta: string; profesional: string; sede: string } | null;
  fotoAnterior: { id: string; zona: string | null; pie: Pie | null; tomadaEn: string } | null;
  sesionesPendientes: { nombre: string; restantes: number; total: number; vigenciaFin: string | null }[];
}
/** Escala con la fecha de su atención (lista por paciente, de la más antigua a la más nueva). */
export interface EscalaPaciente extends Escala { fecha: string }
/** Historial del podograma: lo registrado en el pie en cada atención del paciente (para el historial por zona). */
export interface HistorialPodograma {
  atencionId: string; fecha: string; profesional: string;
  marcas: { id: string; pie: PiePodograma; vista: VistaSilueta; x: number; y: number; zona: string | null; tipoLesion: TipoLesion; nota: string | null }[];
  dibujos: { vista: VistaSilueta; pie: PiePodograma; anotaciones: AnotacionPodograma[] }[];
  fotos: { id: string; pie: Pie | null; zona: string | null; categoria: CategoriaFoto; descripcion: string | null; tomadaEn: string }[];
  procedimientos: { id: string; tipo: TipoProcedimiento; nombre: string; pie: Pie | null; ubicacion: string | null; detalle: string | null }[];
  ulceras: { id: string; datos: Record<string, unknown>; resultado: string | null; pie: Pie | null }[];
}
export type TipoPlantilla = 'nota' | 'autotexto';
export interface PlantillaClinica {
  id: string; tipo: TipoPlantilla; clave: string | null; nombre: string; contenido: Record<string, string>;
  activa: boolean; creadoEtiqueta: string | null; creadoEn: string; actualizadoEn: string;
}
export interface CamposPlantilla { tipo: TipoPlantilla; clave?: string | null; nombre: string; contenido: Record<string, string>; activa?: boolean }

// Bandeja del día (ronda del médico): atenciones abiertas con lo que les falta + pacientes que no vuelven.
export interface BandejaAtencion {
  id: string; fecha: string; citaId: string; horaInicio: string; motivoConsulta: string;
  paciente: { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string; numeroDocumento: string };
  servicio: { nombre: string; color: string }; sede: { nombre: string }; profesional: { nombres: string; apellidos: string };
  totales: { notas: number; diagnosticos: number; procedimientos: number; recetas: number };
  faltantes: string[];
}
export interface BandejaSinVolver {
  paquetePacienteId: string; paquete: string; sesionesRestantes: number; ultimaCita: string; diasSinVenir: number;
  paciente: { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string; telefono: string | null };
}
export interface Bandeja { diasSinVolver: number; abiertas: BandejaAtencion[]; sinVolver: BandejaSinVolver[] }

// Imagen del podograma (Baro) + capa de anotaciones vectoriales (coordenadas 0..1 sobre la imagen).
export type AnotacionPodograma =
  | { tipo: 'trazo'; color: string; grosor: number; puntos: [number, number][]; tipoLesion?: TipoLesion; nota?: string }
  | { tipo: 'texto'; x: number; y: number; texto: string; color: string };
// Las 4 vistas fijas que entrega la Baro (frontal / posterior × izquierdo / derecho).
export type VistaPodograma = 'frontal_izquierdo' | 'frontal_derecho' | 'posterior_izquierdo' | 'posterior_derecho';
export const VISTAS_PODOGRAMA: VistaPodograma[] = ['frontal_izquierdo', 'frontal_derecho', 'posterior_izquierdo', 'posterior_derecho'];
export const VISTA_PODOGRAMA_LABEL: Record<VistaPodograma, string> = {
  frontal_izquierdo: 'Frontal izquierdo', frontal_derecho: 'Frontal derecho',
  posterior_izquierdo: 'Posterior izquierdo', posterior_derecho: 'Posterior derecho',
};
/** Dibujo a mano alzada sobre la silueta (modo "Pintar"): una capa de trazos por vista y pie. */
export interface DibujoSilueta {
  id: string; vista: VistaSilueta; pie: PiePodograma; anotaciones: AnotacionPodograma[]; registradoEtiqueta: string | null; actualizadoEn: string;
}
export interface ImagenPodograma {
  id: string; vista: VistaPodograma | null; nombreArchivo: string; mime: string; tamano: number; descripcion: string | null;
  anotaciones: AnotacionPodograma[]; subidoEtiqueta: string | null; creadoEn: string;
}

// Fotos clínicas (1.8) por atención y zona; el antes/después (1.9) cruza atenciones del paciente.
export type CategoriaFoto = 'lesion' | 'calzado' | 'otro';
export const CATEGORIA_FOTO_LABEL: Record<CategoriaFoto, string> = { lesion: 'Lesión', calzado: 'Calzado', otro: 'Otro' };
export interface FotoClinica {
  id: string; atencionId: string; pie: Pie | null; zona: string | null; categoria: CategoriaFoto; descripcion: string | null;
  mime: string; tamano: number; tomadaEn: string; subidoEtiqueta: string | null; creadoEn: string;
}
export interface FotoPaciente extends FotoClinica { atencion: { fecha: string; servicio: { nombre: string } } }
export interface CamposFoto { pie?: Pie | null; zona?: string | null; categoria?: CategoriaFoto; descripcion?: string | null; tomadaEn?: string }

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
  cerrarAtencion: (id: string, controles?: ControlEntrada[]) => api.patch<AtencionCompleta>(`${B}/atenciones/${id}/cerrar`, controles?.length ? { controles } : {}),
  sugerenciasControl: (atencionId: string) => api.get<SugerenciasControl>(`${B}/atenciones/${atencionId}/controles-sugeridos`),
  controles: (dias = 14) => api.get<ControlesBandeja>(`${B}/controles`, { dias: String(dias) }),
  contadorControles: () => api.get<ContadorControles>(`${B}/controles/contador`),
  resolverControl: (id: string, data: { accion: 'agendar' | 'descartar'; citaId?: string | null; motivo?: string | null }) =>
    api.patch<{ ok: boolean; estado: 'agendado' | 'descartado' }>(`${B}/controles/${id}`, data),
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
  cambiarEstadoHistoria: (pacienteId: string, estado: 'activa' | 'pasiva', motivo?: string | null) =>
    api.patch<HistoriaCompleta>(`${B}/paciente/${pacienteId}/estado`, { estado, motivo: motivo ?? null }),
  // Bloque 3
  bandeja: (dias = 45) => api.get<Bandeja>(`${B}/bandeja`, { dias: String(dias) }),
  // 2.8 ficha previa, escalas por paciente y plantillas
  fichaPrevia: (pacienteId: string) => api.get<FichaPrevia>(`${B}/paciente/${pacienteId}/ficha-previa`),
  historialPodograma: (pacienteId: string) => api.get<HistorialPodograma[]>(`${B}/paciente/${pacienteId}/podograma-historial`),
  escalasPaciente: (pacienteId: string, tipo?: TipoEscala) => api.get<EscalaPaciente[]>(`${B}/paciente/${pacienteId}/escalas`, tipo ? { tipo } : undefined),
  plantillas: (tipo?: TipoPlantilla) => api.get<PlantillaClinica[]>(`${B}/plantillas`, tipo ? { tipo } : undefined),
  crearPlantilla: (data: CamposPlantilla) => api.post<PlantillaClinica>(`${B}/plantillas`, data),
  editarPlantilla: (id: string, data: Partial<CamposPlantilla>) => api.put<PlantillaClinica>(`${B}/plantillas/${id}`, data),
  eliminarPlantilla: (id: string) => api.delete<{ ok: boolean }>(`${B}/plantillas/${id}`),
  paquetesLaser: (pacienteId: string) => api.get<PaqueteLaser[]>(`${B}/paciente/${pacienteId}/paquetes-laser`),
  agregarProcedimiento: (atencionId: string, data: CamposProcedimiento) => api.post<AtencionCompleta>(`${B}/atenciones/${atencionId}/procedimientos`, data),
  editarProcedimiento: (id: string, data: Partial<CamposProcedimiento>) => api.patch<AtencionCompleta>(`${B}/procedimientos/${id}`, data),
  eliminarProcedimiento: (id: string) => api.delete<AtencionCompleta>(`${B}/procedimientos/${id}`),
  guardarEscala: (atencionId: string, data: { tipo: TipoEscala; datos: Record<string, unknown>; pie?: Pie | null }) => api.post<AtencionCompleta>(`${B}/atenciones/${atencionId}/escalas`, data),
  editarEscala: (id: string, data: { datos?: Record<string, unknown>; pie?: Pie | null }) => api.patch<AtencionCompleta>(`${B}/escalas/${id}`, data),
  eliminarEscala: (id: string) => api.delete<AtencionCompleta>(`${B}/escalas/${id}`),
  agregarMarca: (atencionId: string, data: CamposMarca) => api.post<AtencionCompleta>(`${B}/atenciones/${atencionId}/marcas`, data),
  editarMarca: (id: string, data: Partial<CamposMarca>) => api.patch<AtencionCompleta>(`${B}/marcas/${id}`, data),
  eliminarMarca: (id: string) => api.delete<AtencionCompleta>(`${B}/marcas/${id}`),
  // Imágenes del podograma
  subirImagenPodograma: (atencionId: string, archivo: File, opts: { vista?: VistaPodograma | null; descripcion?: string } = {}) => {
    const fd = new FormData();
    fd.append('imagen', archivo);
    if (opts.vista) fd.append('vista', opts.vista);
    if (opts.descripcion?.trim()) fd.append('descripcion', opts.descripcion.trim());
    return api.upload<AtencionCompleta>(`${B}/atenciones/${atencionId}/podograma/imagenes`, fd);
  },
  // El <img>/<canvas> no puede mandar Authorization → fetch autenticado a blob (patrón del PDF de receta).
  blobImagenPodograma: async (id: string): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`/api/v1${B}/podograma/imagenes/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'No se pudo cargar la imagen' }));
      throw new Error((err as { message?: string }).message ?? 'No se pudo cargar la imagen');
    }
    return res.blob();
  },
  guardarDibujoSilueta: (atencionId: string, data: { vista: VistaSilueta; pie: PiePodograma; anotaciones: AnotacionPodograma[] }) =>
    api.put<AtencionCompleta>(`${B}/atenciones/${atencionId}/dibujos`, data),
  guardarAnotacionesPodograma: (id: string, anotaciones: AnotacionPodograma[]) => api.patch<AtencionCompleta>(`${B}/podograma/imagenes/${id}/anotaciones`, { anotaciones }),
  eliminarImagenPodograma: (id: string) => api.delete<AtencionCompleta>(`${B}/podograma/imagenes/${id}`),
  // Fotos clínicas
  subirFoto: (atencionId: string, archivo: File, campos: CamposFoto = {}) => {
    const fd = new FormData();
    fd.append('foto', archivo);
    if (campos.pie) fd.append('pie', campos.pie);
    if (campos.zona?.trim()) fd.append('zona', campos.zona.trim());
    if (campos.categoria) fd.append('categoria', campos.categoria);
    if (campos.descripcion?.trim()) fd.append('descripcion', campos.descripcion.trim());
    if (campos.tomadaEn) fd.append('tomadaEn', campos.tomadaEn);
    return api.upload<AtencionCompleta>(`${B}/atenciones/${atencionId}/fotos`, fd);
  },
  blobFoto: async (id: string): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`/api/v1${B}/fotos/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('No se pudo cargar la foto');
    return res.blob();
  },
  // PDF COMPLETO de la historia (7.6): se abre en otra pestaña; su descarga queda auditada.
  descargarHistoriaPdf: async (pacienteId: string, conFotos: boolean): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`/api/v1${B}/paciente/${pacienteId}/pdf${conFotos ? '?fotos=1' : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'No se pudo generar el PDF' }));
      throw new Error((err as { message?: string }).message ?? 'No se pudo generar el PDF');
    }
    return res.blob();
  },
  // Consentimiento informado (5.1)
  crearConsentimiento: (atencionId: string, data: CamposConsentimiento) => api.post<{ id: string; numero: number }>(`${B}/atenciones/${atencionId}/consentimientos`, data),
  revocarConsentimiento: (id: string, motivo: string) => api.patch<{ ok: boolean }>(`${B}/consentimientos/${id}/revocar`, { motivo }),
  blobConsentimientoPdf: async (id: string): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`/api/v1${B}/consentimientos/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'No se pudo generar el PDF' }));
      throw new Error((err as { message?: string }).message ?? 'No se pudo generar el PDF');
    }
    return res.blob();
  },
  editarFoto: (id: string, campos: CamposFoto) => api.patch<AtencionCompleta>(`${B}/fotos/${id}`, campos),
  eliminarFoto: (id: string) => api.delete<AtencionCompleta>(`${B}/fotos/${id}`),
  fotosDePaciente: (pacienteId: string, zona?: string | null) => api.get<FotoPaciente[]>(`${B}/paciente/${pacienteId}/fotos`, zona ? { zona } : undefined),
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

/** Ficha previa "de 10 segundos" del paciente (modal de cita y ficha). Es lectura clínica: el backend la audita. */
export function useFichaPrevia(pacienteId: string | undefined, enabled = true) {
  return useQuery({ queryKey: ['ficha-previa', pacienteId], queryFn: () => historiaClinicaApi.fichaPrevia(pacienteId!), enabled: !!pacienteId && enabled, staleTime: 120_000 });
}
export function usePlantillas(tipo?: TipoPlantilla) {
  return useQuery({ queryKey: ['plantillas', tipo ?? 'todas'], queryFn: () => historiaClinicaApi.plantillas(tipo), staleTime: 300_000 });
}
/** Historial del podograma del paciente (solo mientras se usa el modo Historial; se refresca al volver a él). */
export function useHistorialPodograma(pacienteId: string | undefined, enabled = true) {
  return useQuery({ queryKey: ['podograma-historial', pacienteId], queryFn: () => historiaClinicaApi.historialPodograma(pacienteId!), enabled: !!pacienteId && enabled, staleTime: 0 });
}
