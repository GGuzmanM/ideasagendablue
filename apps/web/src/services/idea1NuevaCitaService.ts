import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import {
  pacientesApi,
  serviciosApi,
  profesionalesApi,
  paquetesApi,
  reniecApi,
  historialGenexisApi,
  disponibilidadApi,
  horariosApi,
  competenciasApi,
  sedesApi,
  api,
} from '../api';
import { citasApi, type CrearCitaInput, type CrearCitaCombinadaInput } from '../api/citas';
import { baroSolicitudApi } from '../api/baroSolicitud';
import { imprimirContratoMembresia } from '../api/membresias';
import { calcularEdad } from './pacientesService';
import { combinacionesApi } from '../api/combinaciones';
import { usePaquetesPaciente } from '../api/paquetesSesiones';
import { useCanales } from '../hooks/useCanales';
import { promocionesApi, calcularConPromo, type PromocionElegible } from '../api/promociones';
import { useAuthStore } from '../stores/authStore';

const toTitleCase = (str: string) =>
  str.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

// Catálogo/config que casi no cambia en una sesión (servicios, subcategorías, competencias,
// combinaciones, membresías vendibles). Con staleTime largo, abrir el modal N veces NO vuelve
// a pedirlos: se sirven de caché. Cualquier edición admin invalida por su propia mutación.
const STALE_CONFIG = 10 * 60_000; // 10 min

export interface MembresiaTpl {
  id: string;
  nombre: string;
  precio: number | string | null;
  duracionMeses: number;
  activo: boolean;
  sedesHabilitadas?: string[];
  composicion: {
    servicioId: string;
    cantidad: number;
    etiqueta?: string;
    subcategoriaId?: string | null;
    subcategoriaEtiqueta?: string;
  }[];
}

export interface UseIdea1NuevaCitaFormProps {
  sedeId: string;
  unidadNegocioId: string;
  fecha: Date;
  horaInicio?: string;
  profesionalId?: string;
  onClose: () => void;
  onSuccess?: () => void;
  // Paciente ya seleccionado (ej. abierto desde la ficha del paciente): se carga
  // automáticamente y NO hace falta buscar/registrar sus datos.
  pacienteInicial?: PacienteSeleccionado;
  // Muestra un selector de Sede + Especialidad dentro del modal. Se usa cuando no hay
  // contexto de agenda (ej. desde la ficha del paciente). En la agenda queda en false.
  permitirCambiarSede?: boolean;
}

export interface ComprobanteInfo {
  url: string;
  nombre: string;
  mimeType: string;
}

export interface PacienteSeleccionado {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  nombreCompleto: string;
  telefono: string;
  numeroDocumento?: string;
  alerta?: any;
  familiares?: any[];
}

export function useIdea1NuevaCitaForm({
  sedeId: sedeIdProp,
  unidadNegocioId: unidadNegocioIdProp,
  fecha,
  horaInicio: horaInicial = '', // sin slot elegido → vacío ("Escoger hora"), evita agendar al 08:30 por descuido
  profesionalId: profInicial = '',
  onClose,
  onSuccess,
  pacienteInicial,
  permitirCambiarSede = false,
}: UseIdea1NuevaCitaFormProps) {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const { canales, canalesPaciente } = useCanales();

  const idempotencyKeyRef = useRef(uuidv4());
  const contratoImprimirRef = useRef<{ promoId: string; pacienteId: string } | null>(null);

  // Sede / Unidad de negocio: estado interno (inicializado desde props). Cuando se abre
  // desde la ficha del paciente (permitirCambiarSede), se pueden cambiar con un selector.
  const [sedeId, setSedeId] = useState(sedeIdProp);
  const [unidadNegocioId, setUnidadNegocioId] = useState(unidadNegocioIdProp);

  // Modo de paciente: 'existente' | 'nuevo'
  const [modoPaciente, setModoPaciente] = useState<'existente' | 'nuevo'>('existente');

  // Búsqueda de paciente existente
  const [pacienteQuery, setPacienteQuery] = useState('');
  // Si viene un paciente preseleccionado (desde la ficha), se carga automáticamente.
  const [pacienteSeleccionado, setPacienteSeleccionado] = useState<PacienteSeleccionado | null>(
    pacienteInicial ?? null,
  );

  // Formulario nuevo paciente
  const [npNombres, setNpNombres] = useState('');
  const [npApellidoPaterno, setNpApellidoPaterno] = useState('');
  const [npApellidoMaterno, setNpApellidoMaterno] = useState('');
  const [npTipoDoc, setNpTipoDoc] = useState<'DNI' | 'CE' | 'PASAPORTE'>('DNI');
  const [npNumDoc, setNpNumDoc] = useState('');
  const [npTelefono, setNpTelefono] = useState('');
  const [npEmail, setNpEmail] = useState('');
  const [npFechaNacimiento, setNpFechaNacimiento] = useState('');
  const [npSexo, setNpSexo] = useState('');
  const [npCanalId, setNpCanalId] = useState<string | null>(null);

  // Estado RENIEC
  const [dniConsultando, setDniConsultando] = useState(false);
  const dniConsultadoRef = useRef('');

  // Datos de la cita
  const [servicioId, setServicioId] = useState('');
  const [subcategoriaId, setSubcategoriaId] = useState('');
  const [paquetePacienteId, setPaquetePacienteId] = useState('');
  const [canal, setCanal] = useState('recepcion');
  const [promocionId, setPromocionId] = useState('');
  const [codigoPromo, setCodigoPromo] = useState(''); // cupón/convenio si la promo lo requiere
  const [profesionalId, setProfesionalId] = useState(profInicial);
  const [fechaCita, setFechaCita] = useState<string>(format(fecha, 'yyyy-MM-dd'));
  const [horaCita, setHoraCita] = useState<string>(horaInicial);
  const [comentarioRecepcion, setComentarioRecepcion] = useState('');
  // Cita RETROACTIVA: la fecha elegida es anterior a HOY. Se permite (registrar algo ya ocurrido),
  // pero exige un motivo. `esRetroactiva` se deriva de la fecha; el backend re-valida el motivo.
  const [motivoRetroactivo, setMotivoRetroactivo] = useState('');
  const esRetroactiva = fechaCita < format(new Date(), 'yyyy-MM-dd');
  const faltaMotivoRetroactivo = esRetroactiva && !motivoRetroactivo.trim();

  // Estado de Membresías ("Membresía (opcional)" / "Activar nueva membresía")
  const [membSel, setMembSel] = useState(''); // 'inst:<id>' | 'tpl:<id>' | ''
  const [membItem, setMembItem] = useState(''); // índice del ítem de la composición
  const [membInicio, setMembInicio] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [membFin, setMembFin] = useState('');

  // Servicios combinados (Profilaxis + Extra)
  const [combinar, setCombinar] = useState(false);
  const [extraServicioId, setExtraServicioId] = useState('');
  const [extraProfesionalId, setExtraProfesionalId] = useState('');

  // Visor Genexis
  const [verVisorGenexis, setVerVisorGenexis] = useState(false);

  // Comprobante de pago
  const [comprobante, setComprobante] = useState<ComprobanteInfo | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const inputFileRef = useRef<HTMLInputElement>(null);

  // Sincronizar estado inicial cuando se abre con nuevos props
  useEffect(() => {
    setProfesionalId(profInicial);
    setHoraCita(horaInicial);
    setFechaCita(format(fecha, 'yyyy-MM-dd'));
  }, [profInicial, horaInicial, fecha]);

  // ── Selector de Sede / Especialidad (solo cuando se abre desde la ficha) ──
  const { data: sedesDisponibles = [] } = useQuery({
    queryKey: ['sedes'],
    queryFn: () => sedesApi.listar(),
    enabled: permitirCambiarSede,
  });

  // Auto-seleccionar la primera sede si no hay ninguna (mismo criterio que la agenda).
  useEffect(() => {
    if (!permitirCambiarSede) return;
    if (sedesDisponibles.length > 0 && !sedeId) {
      setSedeId(sedesDisponibles[0].id);
    }
  }, [permitirCambiarSede, sedesDisponibles, sedeId]);

  const sedeActualSel = sedesDisponibles.find((s) => s.id === sedeId);
  const unidadesDeSede = sedeActualSel?.unidadesNegocio ?? [];

  // ── Baropodometría: la cita ocupa una máquina y el MÉDICO que atiende (por solicitud) se
  // elige aquí. El roster de médicos habilitados se gestiona en /herramientas/baro-solicitud
  // (también desde un modal en este formulario). ──
  const esBaro = /baropodometr/i.test(unidadesDeSede.find((u) => u.id === unidadNegocioId)?.nombre ?? '');
  const puedeGestionarBaro = useAuthStore((s) => s.isCoordinadora()); // admin + coordinadora_sedes
  const { data: baroRoster } = useQuery({
    queryKey: ['baro-solicitud', sedeId, fechaCita],
    // Pasa la FECHA de la cita → el combo lista solo los doctores cuya asignación de baro
    // rige ese día en esa sede.
    queryFn: () => baroSolicitudApi.obtener(sedeId, fechaCita),
    enabled: esBaro && Boolean(sedeId),
  });
  const medicosBaro = baroRoster?.porSolicitud ?? [];
  const [medicoBaroId, setMedicoBaroId] = useState('');
  // Si hay exactamente un médico en el roster, se preselecciona; al salir de baro se limpia.
  useEffect(() => {
    if (!esBaro) { if (medicoBaroId) setMedicoBaroId(''); return; }
    // Si el médico elegido YA NO está en el roster de esta fecha/sede (cambió la fecha y su periodo
    // no rige, o se movió de sede), limpiar la selección obsoleta ANTES de autoseleccionar. Evita
    // agendar a un doctor que ese día no atiende ahí (violaría "1 sede por día").
    if (medicoBaroId && !medicosBaro.some((m) => m.id === medicoBaroId)) { setMedicoBaroId(''); return; }
    if (!medicoBaroId && medicosBaro.length === 1) setMedicoBaroId(medicosBaro[0].id);
  }, [esBaro, medicosBaro, medicoBaroId]);

  // Al cambiar de sede, seleccionar Podología (o la primera unidad) por defecto.
  useEffect(() => {
    if (!permitirCambiarSede) return;
    if (unidadesDeSede.length > 0) {
      if (!unidadNegocioId || !unidadesDeSede.find((u) => u.id === unidadNegocioId)) {
        const podologia = unidadesDeSede.find((u) => u.nombre.toLowerCase().includes('podolog'));
        setUnidadNegocioId(podologia ? podologia.id : unidadesDeSede[0].id);
      }
    }
  }, [permitirCambiarSede, unidadesDeSede, unidadNegocioId]);

  // Edad autocalculada desde la fecha de nacimiento
  const npEdad = useMemo(() => calcularEdad(npFechaNacimiento), [npFechaNacimiento]);

  // Consulta MANUAL por botón para evitar consumo innecesario de API PeruDevs
  const puedeBuscarDni = npTipoDoc === 'DNI' && /^\d{8}$/.test(npNumDoc.trim());

  // Carga un paciente de la BD como "existente" (lo selecciona y cambia el modo). Reusado por la
  // búsqueda manual (botón RENIEC) y por la auto-detección al tipear el DNI.
  const cargarComoExistente = useCallback((yaRegistrado: any, msg?: string) => {
    const nombreComp = `${yaRegistrado.nombres} ${yaRegistrado.apellidoPaterno} ${yaRegistrado.apellidoMaterno || ''}`.trim();
    setPacienteSeleccionado({
      id: yaRegistrado.id,
      nombres: yaRegistrado.nombres,
      apellidoPaterno: yaRegistrado.apellidoPaterno,
      apellidoMaterno: yaRegistrado.apellidoMaterno,
      nombreCompleto: nombreComp,
      telefono: yaRegistrado.telefono,
      numeroDocumento: yaRegistrado.numeroDocumento,
      alerta: yaRegistrado.alerta ?? undefined,
      familiares: yaRegistrado.familiares ?? undefined,
    });
    setModoPaciente('existente');
    toast.success(msg ?? `Paciente ya registrado: ${nombreComp}. Se cargó automáticamente.`);
  }, []);

  const buscarPorDocumento = async () => {
    if (!puedeBuscarDni || dniConsultando) return;
    const doc = npNumDoc.trim();
    setDniConsultando(true);
    try {
      // 1. Verificar si ya existe en la BD local
      const encontrados = await pacientesApi.buscar(doc);
      const yaRegistrado = encontrados.find(
        (p: any) => p.numeroDocumento === doc && p.tipoDocumento === npTipoDoc,
      );
      if (yaRegistrado) {
        cargarComoExistente(yaRegistrado);
        return;
      }

      // 2. Si no existe en la BD, consultar PeruDevs / RENIEC
      const d = await reniecApi.consultarDni(doc);
      setNpNombres(toTitleCase(d.nombres));
      setNpApellidoPaterno(toTitleCase(d.apellidoPaterno));
      setNpApellidoMaterno(toTitleCase(d.apellidoMaterno));
      if (d.fechaNacimiento) setNpFechaNacimiento(d.fechaNacimiento);
      if (d.sexo) setNpSexo(d.sexo);
      toast.success('Datos autocompletados desde RENIEC / PeruDevs');
    } catch (e: any) {
      toast(e?.message || 'No se pudo obtener datos del documento', { icon: 'ℹ️' });
    } finally {
      setDniConsultando(false);
    }
  };

  // AUTO-DETECCIÓN al tipear el DNI en modo "nuevo": si el paciente YA está registrado en la BD
  // local, salta solo a "paciente existente" (lo carga + avisa "ya registrado"), listo para agendar
  // su cita. Si NO está, se queda en "nuevo". NO consulta RENIEC (eso sigue por botón, por costo).
  // Debounce de 500ms para no consultar en cada tecla.
  useEffect(() => {
    if (modoPaciente !== 'nuevo') return;
    const doc = npNumDoc.trim();
    if (npTipoDoc !== 'DNI' || !/^\d{8}$/.test(doc)) return;
    let cancelado = false;
    const t = setTimeout(async () => {
      try {
        const encontrados = await pacientesApi.buscar(doc);
        if (cancelado) return;
        const yaRegistrado = encontrados.find((p: any) => p.numeroDocumento === doc && p.tipoDocumento === npTipoDoc);
        if (yaRegistrado) {
          const nom = `${yaRegistrado.nombres} ${yaRegistrado.apellidoPaterno}`.trim();
          cargarComoExistente(yaRegistrado, `Ya registrado: ${nom}. Te llevamos a agendar su cita.`);
        }
      } catch { /* búsqueda silenciosa: si falla, no interrumpe el registro de un paciente nuevo */ }
    }, 500);
    return () => { cancelado = true; clearTimeout(t); };
  }, [npNumDoc, npTipoDoc, modoPaciente, cargarComoExistente]);

  // Subida de Comprobante
  const handleSubirComprobante = useCallback(
    async (file: File) => {
      if (file.size > 10 * 1024 * 1024) {
        toast.error('El archivo excede los 10MB');
        return;
      }
      setSubiendo(true);
      try {
        const formData = new FormData();
        formData.append('comprobante', file);
        const res = await api.upload<{ url: string; nombre: string; mimeType: string }>('/citas/upload-comprobante', formData);
        setComprobante(res);
        toast.success('Comprobante adjuntado');
      } catch (e: any) {
        toast.error(e?.message || 'Error al subir comprobante');
      } finally {
        setSubiendo(false);
      }
    },
    [],
  );

  // Escuchar pegado desde portapapeles (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imagen = items.find((i) => i.type.startsWith('image/'));
      if (imagen) {
        const file = imagen.getAsFile();
        if (file) handleSubirComprobante(file);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handleSubirComprobante]);

  // Queries base
  const { data: serviciosData = [] } = useQuery({
    queryKey: ['servicios', unidadNegocioId],
    queryFn: () => serviciosApi.listar({ unidadNegocioId, activo: true }),
    enabled: Boolean(unidadNegocioId),
    staleTime: STALE_CONFIG,
  });

  const { data: subcategorias = [] } = useQuery({
    queryKey: ['subcategorias', servicioId],
    queryFn: async () => {
      if (!servicioId) return [];
      const res = await api.get<any[]>(`/servicios/${servicioId}/subcategorias`);
      return res.filter((sc) => sc.activo);
    },
    enabled: Boolean(servicioId),
    staleTime: STALE_CONFIG,
  });

  // Competencias activas entre profesionales y servicios de esta unidad de negocio
  const { data: competencias = [] } = useQuery({
    queryKey: ['competencias', unidadNegocioId],
    queryFn: () => competenciasApi.listar({ unidadNegocioId }),
    enabled: Boolean(unidadNegocioId),
    staleTime: STALE_CONFIG,
  });

  // Profesionales seleccionables que pueden atender ese servicio en esa fecha/sede
  const { data: profesionales = [] } = useQuery({
    queryKey: ['profesionales-seleccionables', sedeId, unidadNegocioId, fechaCita, servicioId],
    queryFn: () => profesionalesApi.seleccionables({ sedeId, unidadNegocioId, fecha: fechaCita, servicioId: servicioId || undefined }),
    enabled: Boolean(sedeId) && Boolean(unidadNegocioId),
  });

  // Ocupación de TODOS los profesionales ese día (todas las unidades). Se usa para
  // avisar en el dropdown si un médico ya está ocupado a la hora elegida — clave para
  // baro: elegir a un médico que ya tiene podología a esa hora (o viceversa).
  const { data: ocupacionDia = [] } = useQuery({
    queryKey: ['ocupacion-dia', sedeId, fechaCita],
    queryFn: () => citasApi.ocupacionDia({ sedeId, fecha: fechaCita }),
    enabled: Boolean(sedeId) && Boolean(fechaCita),
  });

  // Mapa profesionalId → "ocupado en Unidad a las HH:MM" para los que se solapan
  // con el slot elegido (hora + duración del servicio seleccionado).
  const profesionalesOcupados = useMemo(() => {
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const dur = serviciosData.find((s) => s.id === servicioId)?.duracionMinutos ?? 30;
    const ini = toMin(horaCita);
    const fin = ini + dur;
    const map = new Map<string, { unidad: string; hora: string }>();
    for (const o of ocupacionDia) {
      const oIni = toMin(o.horaInicio);
      const oFin = oIni + (o.duracionMinutos || 30);
      if (ini < oFin && oIni < fin) {
        // Solo el primer solape encontrado por profesional (basta para el aviso).
        if (!map.has(o.profesionalId)) map.set(o.profesionalId, { unidad: o.unidad, hora: o.horaInicio });
      }
    }
    return map;
  }, [ocupacionDia, horaCita, servicioId, serviciosData]);

  // Filtro de servicios: si hay un profesional seleccionado (desde el horario o dropdown),
  // filtrar inmediatamente los servicios habilitados por sus competencias.
  const servicios = useMemo(() => {
    if (!profesionalId || competencias.length === 0) return serviciosData;
    const serviciosPermitidos = new Set(
      competencias
        .filter((c: any) => c.profesional?.id === profesionalId && c.activa)
        .map((c: any) => c.servicio?.id)
    );
    if (serviciosPermitidos.size === 0) return serviciosData;
    return serviciosData.filter((s) => serviciosPermitidos.has(s.id));
  }, [serviciosData, profesionalId, competencias]);

  const { data: resultadosPacientes = [], isFetching: buscandoPacientes } = useQuery({
    queryKey: ['pacientes-busqueda', pacienteQuery],
    queryFn: async () => {
      if (!pacienteQuery.trim() || pacienteQuery.trim().length < 2) return [];
      return pacientesApi.buscar(pacienteQuery.trim());
    },
    enabled: pacienteQuery.trim().length >= 2,
  });

  // Paquetes y Saldos del paciente activo
  const { data: saldosPaciente = [] } = usePaquetesPaciente(
    pacienteSeleccionado?.id || '',
    Boolean(pacienteSeleccionado?.id),
  );

  const { data: paquetesPacienteRaw = [] } = useQuery({
    queryKey: ['paquetes-paciente', pacienteSeleccionado?.id],
    queryFn: () => paquetesApi.porPaciente(pacienteSeleccionado!.id),
    enabled: Boolean(pacienteSeleccionado?.id),
  });

  // Membresías / Paquetes ACTIVOS unificados del paciente (con filtro por SEDE: candado de sede)
  const membresiasActivas = useMemo(() => {
    const map = new Map<string, any>();
    const fCitaStr = (fechaCita || '').split('T')[0];

    (saldosPaciente ?? []).forEach((s: any) => {
      if (s.tipo !== 'MEMBRESIA') return; // solo membresías en el selector de membresías
      const sSedeId = s.sede?.id ?? s.sedeId;
      if (sSedeId && sSedeId !== sedeId) return; // candado de sede

      const inicioStr = s.vigenciaInicio ? s.vigenciaInicio.split('T')[0] : null;
      const finStr = s.vigenciaFin ? s.vigenciaFin.split('T')[0] : null;
      if (inicioStr && fCitaStr < inicioStr) return;
      if (finStr && fCitaStr > finStr) return;
      if (s.estado === 'ACTIVO' || (s.saldo && s.saldo > 0) || (s.sesionesTotal && s.sesionesTotal > s.consumidas)) {
        map.set(s.id, {
          id: s.id,
          nombre: s.nombre || s.paquete?.nombre || 'Membresía',
          saldo: s.saldo ?? Math.max((s.sesionesTotal || 0) - (s.consumidas || 0), 0),
          sesionesTotal: s.sesionesTotal || 1,
          consumidas: s.consumidas || 0,
          composicion: s.composicion,
          sedeId: sSedeId,
        });
      }
    });

    (paquetesPacienteRaw ?? []).forEach((p: any) => {
      if (p.tipo !== 'MEMBRESIA') return;
      const pSedeId = p.sede?.id ?? p.sedeId;
      if (pSedeId && pSedeId !== sedeId) return; // candado de sede

      if (!map.has(p.id)) {
        const total = p.sesionesTotal || 1;
        const usadas = p.sesionesUsadas || (p.citas ? p.citas.length : 0);
        const saldo = Math.max(total - usadas, 0);
        if (p.activo !== false && (p.estado === 'ACTIVO' || p.estado === undefined || saldo > 0)) {
          map.set(p.id, {
            id: p.id,
            nombre: p.paquete?.nombre || 'Membresía',
            saldo,
            sesionesTotal: total,
            consumidas: usadas,
            composicion: p.composicion,
            sedeId: pSedeId,
          });
        }
      }
    });

    return Array.from(map.values());
  }, [saldosPaciente, paquetesPacienteRaw, fechaCita, sedeId]);

  const paquetesPaciente = useMemo(() => {
    // Paquetes normales (no membresías) activos del paciente para esta sede
    const map = new Map<string, any>();
    (saldosPaciente ?? []).forEach((s: any) => {
      if (s.tipo === 'MEMBRESIA') return;
      const sSedeId = s.sede?.id ?? s.sedeId;
      if (sSedeId && sSedeId !== sedeId) return;
      if (s.estado === 'ACTIVO' || (s.saldo && s.saldo > 0)) {
        map.set(s.id, {
          id: s.id,
          sesionesTotal: s.sesionesTotal || 1,
          sesionesUsadas: s.consumidas || 0,
          saldo: s.saldo ?? Math.max((s.sesionesTotal || 0) - (s.consumidas || 0), 0),
          paquete: { nombre: s.nombre || 'Paquete' },
        });
      }
    });
    return Array.from(map.values());
  }, [saldosPaciente, sedeId]);

  // Plantillas de Membresías vendibles
  const { data: membresiasTpl = [] } = useQuery({
    queryKey: ['membresias-vendibles'],
    queryFn: () => api.get<MembresiaTpl[]>('/membresias/vendibles'),
    enabled: Boolean(pacienteSeleccionado?.id),
    staleTime: STALE_CONFIG,
  });

  // Historial Genexis existe
  const { data: existeGenexis = false } = useQuery({
    queryKey: ['genexis-existe', pacienteSeleccionado?.id],
    queryFn: () => historialGenexisApi.existe(pacienteSeleccionado!.id),
    enabled: Boolean(pacienteSeleccionado?.id),
  });

  // Plantillas de Membresía Habilitadas en la Sede (para activar)
  const tplsMembresiaActivas = useMemo(() => {
    return (membresiasTpl ?? []).filter(
      (t: any) => t.activo && (!t.sedesHabilitadas?.length || t.sedesHabilitadas.includes(sedeId)),
    );
  }, [membresiasTpl, sedeId]);

  // Servicios que el profesional seleccionado SÍ realiza (por competencia). Vacío/undefined
  // cuando no hay profesional elegido → no se filtra nada.
  const serviciosDelProfesional = useMemo(() => {
    if (!profesionalId || competencias.length === 0) return null;
    return new Set(
      competencias
        .filter((c: any) => c.profesional?.id === profesionalId && c.activa)
        .map((c: any) => c.servicio?.id),
    );
  }, [profesionalId, competencias]);

  // Bloque combinado: profesionales que SÍ realizan el SERVICIO EXTRA (por competencia),
  // para poder indicar en el selector quiénes pueden hacerlo. Deduplicado por id.
  const profesionalesExtra = useMemo(() => {
    if (!extraServicioId || competencias.length === 0) return [] as { id: string; nombres: string; apellidos: string }[];
    const vistos = new Set<string>();
    return competencias
      .filter((c: any) => c.servicio?.id === extraServicioId && c.activa && c.profesional?.activo !== false)
      .map((c: any) => c.profesional)
      .filter((p: any) => p && !vistos.has(p.id) && vistos.add(p.id));
  }, [extraServicioId, competencias]);

  // ¿El profesional del ancla también realiza el servicio extra? null = no aplica
  // (no hay ancla fijo o no hay extra elegido) → no se muestra indicador.
  const anclaHaceExtra = useMemo(() => {
    if (!extraServicioId || !profesionalId || competencias.length === 0) return null;
    return competencias.some(
      (c: any) => c.servicio?.id === extraServicioId && c.profesional?.id === profesionalId && c.activa,
    );
  }, [extraServicioId, profesionalId, competencias]);

  // Total ESTIMADO a pagar (informativo). Precio de LISTA: usa el precio de la subcategoría
  // si el servicio la tiene fijada, si no el del servicio; suma el extra combinado. NO aplica
  // promociones ni membresía por ahora (se abordarán después). null = sin servicio elegido.
  const precioListaEstimado = useMemo(() => {
    if (!servicioId) return null;
    const precio = (servId: string, subcatId?: string | null): number => {
      if (subcatId) {
        const sc = (subcategorias as any[]).find((s) => s.id === subcatId);
        if (sc?.precioReferencial != null) return Number(sc.precioReferencial) || 0;
      }
      const s = (serviciosData as any[]).find((x) => x.id === servId);
      return s?.precioReferencial != null ? Number(s.precioReferencial) || 0 : 0;
    };
    let t = precio(servicioId, subcategoriaId);
    if (combinar && extraServicioId) t += precio(extraServicioId, null);
    return t;
  }, [servicioId, subcategoriaId, combinar, extraServicioId, subcategorias, serviciosData]);

  // ─── Promociones (motor automático) ──────────────────────────────────────────────
  // Una promo NUNCA se combina con una membresía (regla de negocio).
  const usandoMembresia = Boolean(paquetePacienteId) || membSel.startsWith('inst:');

  // Promos que CALIFICAN para esta cita (servicio+sede+fecha+canal+paciente). Se recalcula
  // al cambiar el contexto. El backend revalida estricto al agendar.
  const { data: promocionesElegibles = [] } = useQuery({
    queryKey: ['promos-elegibles', servicioId, sedeId, fechaCita, canal, pacienteSeleccionado?.id],
    queryFn: () => promocionesApi.elegibles({ servicio: servicioId, sede: sedeId, fecha: fechaCita, canal, paciente: pacienteSeleccionado?.id }),
    enabled: Boolean(servicioId) && Boolean(sedeId) && Boolean(fechaCita) && !usandoMembresia,
  });

  const promoSeleccionada = useMemo(
    () => (promocionesElegibles as PromocionElegible[]).find((p) => p.id === promocionId) ?? null,
    [promocionesElegibles, promocionId],
  );

  // Limpia la promo si ya no califica (cambió servicio/sede/fecha/canal) o si se usó membresía.
  useEffect(() => {
    if (usandoMembresia && (promocionId || codigoPromo)) { setPromocionId(''); setCodigoPromo(''); return; }
    if (promocionId && !(promocionesElegibles as PromocionElegible[]).some((p) => p.id === promocionId)) {
      setPromocionId(''); setCodigoPromo('');
    }
  }, [usandoMembresia, promocionId, codigoPromo, promocionesElegibles]);

  // Descuento y total FINAL (precio de lista − promo).
  const descuentoPromo = useMemo(() => {
    if (precioListaEstimado == null || !promoSeleccionada) return 0;
    return calcularConPromo(precioListaEstimado, promoSeleccionada.tipo, promoSeleccionada.valor).descuento;
  }, [precioListaEstimado, promoSeleccionada]);

  const totalEstimado = precioListaEstimado == null
    ? null
    : Math.max(0, Math.round((precioListaEstimado - descuentoPromo) * 100) / 100);

  // Composición de la membresía seleccionada
  const membComposicion = useMemo(() => {
    const serviciosUnidadSet = new Set(serviciosData.map((s) => s.id));
    let items: {
      servicioId: string;
      etiqueta: string;
      subcategoriaId: string | null;
      subcategoriaEtiqueta?: string;
      total: number;
      quedan: number;
      puedeProfesional: boolean; // ¿el profesional elegido realiza este servicio?
    }[] = [];

    const puede = (servicioId: string) => !serviciosDelProfesional || serviciosDelProfesional.has(servicioId);

    if (membSel.startsWith('inst:')) {
      const pp = membresiasActivas.find((p) => `inst:${p.id}` === membSel);
      items = (pp?.composicion ?? []).map((i: any) => ({
        servicioId: i.servicioId,
        etiqueta: i.etiqueta ?? 'Servicio',
        subcategoriaId: i.subcategoriaId ?? null,
        subcategoriaEtiqueta: i.subcategoriaEtiqueta,
        total: i.cantidad,
        quedan: Math.max(0, i.cantidad - i.consumidas),
        puedeProfesional: puede(i.servicioId),
      }));
    } else if (membSel.startsWith('tpl:')) {
      const t = tplsMembresiaActivas.find((x: any) => `tpl:${x.id}` === membSel);
      items = (t?.composicion ?? []).map((i: any) => ({
        servicioId: i.servicioId,
        etiqueta: i.etiqueta ?? 'Servicio',
        subcategoriaId: i.subcategoriaId ?? null,
        subcategoriaEtiqueta: i.subcategoriaEtiqueta,
        total: i.cantidad,
        quedan: i.cantidad,
        puedeProfesional: puede(i.servicioId),
      }));
    }

    return items.filter((i) => serviciosUnidadSet.has(i.servicioId));
  }, [membSel, membresiasActivas, tplsMembresiaActivas, serviciosData, serviciosDelProfesional]);

  // Al elegir un servicio dentro de una membresía, fija servicio y subcategoría automáticamente.
  // Si el ítem seleccionado NO lo realiza el profesional elegido (p.ej. tras cambiar de
  // profesional), se limpia la selección para no arrastrar un servicio en conflicto.
  useEffect(() => {
    if (!membSel || membItem === '') return;
    const item = membComposicion[Number(membItem)];
    if (!item) return;
    if (!item.puedeProfesional) {
      setMembItem('');
      setServicioId('');
      setSubcategoriaId('');
      return;
    }
    setServicioId(item.servicioId);
    setSubcategoriaId(item.subcategoriaId ?? '');
    setPaquetePacienteId(membSel.startsWith('inst:') ? membSel.slice(5) : '');
    setCombinar(false);
  }, [membSel, membItem, membComposicion]);

  // Calcular vigencia por defecto al seleccionar una plantilla de membresía
  useEffect(() => {
    if (!membSel.startsWith('tpl:')) return;
    const t = tplsMembresiaActivas.find((x) => `tpl:${x.id}` === membSel);
    const hoy = format(new Date(), 'yyyy-MM-dd');
    const d = new Date(hoy + 'T12:00:00');
    d.setMonth(d.getMonth() + (t?.duracionMeses ?? 12));
    setMembInicio(hoy);
    setMembFin(format(d, 'yyyy-MM-dd'));
  }, [membSel, tplsMembresiaActivas]);

  // Consultar disponibilidad real
  const { data: dispo } = useQuery({
    queryKey: ['disponibilidad', sedeId, unidadNegocioId, servicioId, fechaCita, profesionalId],
    queryFn: () =>
      disponibilidadApi.consultar({
        sede: sedeId,
        unidadNegocio: unidadNegocioId,
        servicio: servicioId,
        fecha: fechaCita,
        profesional: profesionalId || undefined,
      }),
    enabled: Boolean(sedeId) && Boolean(unidadNegocioId) && Boolean(servicioId),
  });

  // Horario efectivo de la sede (para verificar si está abierta)
  const { data: horarioEf } = useQuery({
    queryKey: ['horario-efectivo', sedeId, fechaCita],
    queryFn: () => horariosApi.efectivo(sedeId, fechaCita),
    enabled: Boolean(sedeId) && Boolean(fechaCita),
  });
  const sedeCerradaEseDia = horarioEf?.efectivo?.abierto === false;

  // Turnos de profesionales en la fecha
  const { data: turnosProfMap } = useQuery({
    queryKey: ['turnos-profesionales', sedeId, fechaCita],
    queryFn: () => horariosApi.turnosProfesionales(sedeId, fechaCita),
    enabled: Boolean(sedeId) && Boolean(fechaCita),
  });

  // Opciones de horas acotadas por apertura/cierre de sede y horario del profesional
  const opcionesHoras = useMemo(() => {
    if (sedeCerradaEseDia) return [];

    const aperturaSede = horarioEf?.efectivo?.apertura || '08:00';
    const cierreSede = horarioEf?.efectivo?.cierre || '20:00';

    let profIni = aperturaSede;
    let profFin = cierreSede;

    if (profesionalId && turnosProfMap) {
      const turno = turnosProfMap[profesionalId];
      if (turno === null) {
        // El profesional no atiende ese día
        return [];
      }
      if (turno) {
        profIni = turno.horaInicio > aperturaSede ? turno.horaInicio : aperturaSede;
        profFin = turno.horaFin < cierreSede ? turno.horaFin : cierreSede;
      }
    }

    if (dispo?.slots && dispo.slots.length > 0) {
      const horasDispo = [...new Set(dispo.slots.map((s: any) => s.horaInicio))]
        .filter((h) => h >= profIni && h < profFin)
        .sort();

      if (horasDispo.length > 0) {
        if (!horasDispo.includes(horaCita) && horaCita >= profIni && horaCita < profFin) {
          return [horaCita, ...horasDispo].sort();
        }
        return horasDispo;
      }
    }

    // Fallback acotado a las horas laborables efectivas
    const horasFallback: string[] = [];
    const iniMin = parseInt(profIni.split(':')[0]!, 10);
    const finMin = parseInt(profFin.split(':')[0]!, 10);

    for (let h = iniMin; h <= finMin; h++) {
      const hh = String(h).padStart(2, '0');
      const h0 = `${hh}:00`;
      const h30 = `${hh}:30`;
      if (h0 >= profIni && h0 < profFin) horasFallback.push(h0);
      if (h30 >= profIni && h30 < profFin) horasFallback.push(h30);
    }

    if (horaCita && !horasFallback.includes(horaCita) && horaCita >= profIni && horaCita < profFin) {
      horasFallback.push(horaCita);
      horasFallback.sort();
    }

    return horasFallback;
  }, [dispo, horaCita, sedeCerradaEseDia, horarioEf, profesionalId, turnosProfMap]);

  // Configuración de combinaciones
  const { data: configCombi } = useQuery({
    queryKey: ['combinaciones-config'],
    queryFn: () => combinacionesApi.config(),
    staleTime: STALE_CONFIG,
  });
  const esServicioAncla = Boolean(configCombi?.servicioAnclaId) && servicioId === configCombi?.servicioAnclaId;
  const combinablesActivos = configCombi?.combinables ?? [];

  useEffect(() => {
    if (!esServicioAncla) {
      setCombinar(false);
      setExtraServicioId('');
      setExtraProfesionalId('');
    }
  }, [esServicioAncla]);

  // Mutation para agendar cita
  const mutationCrear = useMutation({
    mutationFn: async (input: { pacienteId: string }) => {
      const key = idempotencyKeyRef.current;

      // 1) Si se eligió activar una nueva membresía (tpl:). Defensa: solo se vende si el
      // servicio de la cita AÚN coincide con el ítem elegido de la membresía. Así, si el
      // usuario cambió de servicio tras elegir la membresía, NO se vende una membresía que
      // ya no aplica (el front además limpia membSel al cambiar de servicio).
      let finalPaqueteId = paquetePacienteId;
      const itemMemb = membItem !== '' ? membComposicion[Number(membItem)] : undefined;
      const membCoincideServicio = !!itemMemb && itemMemb.servicioId === servicioId;
      if (membSel.startsWith('tpl:') && membCoincideServicio) {
        const promoId = membSel.slice(4);
        const item = itemMemb!;
        const resVenta = await api.post<{ id: string }>(`/membresias/${promoId}/vender`, {
          pacienteId: input.pacienteId,
          sedeId,
          fechaVenta: membInicio,
          fechaFin: membFin,
          ...(item?.subcategoriaId
            ? { subcategorias: [{ servicioId: item.servicioId, subcategoriaId: item.subcategoriaId }] }
            : {}),
        });
        finalPaqueteId = resVenta.id;
        // Si esa membresía tiene contrato, se imprimirá pre-llenado al terminar (onSuccess).
        contratoImprimirRef.current = { promoId, pacienteId: input.pacienteId };
      } else if (!finalPaqueteId && membSel.startsWith('inst:')) {
        finalPaqueteId = membSel.slice(5);
      }

      if (combinar && extraServicioId) {
        const payloadCombinada: CrearCitaCombinadaInput = {
          pacienteId: input.pacienteId,
          sedeId,
          unidadNegocioId,
          servicioId,
          subcategoriaId: subcategoriaId || undefined,
          profesionalId: profesionalId || undefined,
          fecha: fechaCita,
          horaInicio: horaCita,
          canal,
          promocionId: promocionId || undefined,
          codigoPromo: promocionId && codigoPromo.trim() ? codigoPromo.trim() : undefined,
          comentarioRecepcion: comentarioRecepcion.trim() || undefined,
          paquetePacienteId: finalPaqueteId || undefined,
          motivoRetroactivo: esRetroactiva ? motivoRetroactivo.trim() : undefined,
          extra: {
            servicioId: extraServicioId,
            profesionalId: extraProfesionalId || undefined,
            comentarioRecepcion: comentarioRecepcion.trim() || undefined,
          },
        };
        return citasApi.crearCombinada(payloadCombinada);
      } else {
        const crearInput: CrearCitaInput = {
          pacienteId: input.pacienteId,
          sedeId,
          unidadNegocioId,
          servicioId,
          subcategoriaId: subcategoriaId || undefined,
          profesionalId: profesionalId || undefined,
          // Baro: el médico elegido (por solicitud) para esta cita. La máquina la asigna el back.
          solicitadoProfesionalId: esBaro ? (medicoBaroId || undefined) : undefined,
          fecha: fechaCita,
          horaInicio: horaCita,
          canal,
          promocionId: promocionId || undefined,
          codigoPromo: promocionId && codigoPromo.trim() ? codigoPromo.trim() : undefined,
          comentarioRecepcion: comentarioRecepcion.trim() || undefined,
          paquetePacienteId: finalPaqueteId || undefined,
          comprobanteUrl: comprobante?.url,
          comprobanteNombre: comprobante?.nombre,
          comprobanteMimeType: comprobante?.mimeType,
          motivoRetroactivo: esRetroactiva ? motivoRetroactivo.trim() : undefined,
        };
        return citasApi.crear(crearInput, key);
      }
    },
    onSuccess: () => {
      toast.success(
        combinar
          ? 'Bloque combinado agendado exitosamente'
          : membSel
          ? 'Sesión de membresía agendada'
          : 'Cita agendada exitosamente',
      );
      qc.invalidateQueries({ queryKey: ['idea1-citas'] });
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['paquetes-paciente'] });
      qc.invalidateQueries({ queryKey: ['paquetes-sesiones'] });
      // Auto-imprimir el contrato de la membresía recién vendida (si tiene uno configurado).
      const contrato = contratoImprimirRef.current;
      contratoImprimirRef.current = null;
      if (contrato) imprimirContratoMembresia(contrato.promoId, contrato.pacienteId).catch(() => { /* sin contrato o error: silencioso */ });
      if (onSuccess) onSuccess();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Error al agendar la cita');
    },
  });

  const mutationCrearPaciente = useMutation({
    mutationFn: async () => {
      if (!npNombres.trim() || !npApellidoPaterno.trim() || !npTelefono.trim()) {
        throw new Error('Completa los campos obligatorios del paciente (Nombres, Apellidos, Teléfono)');
      }
      return pacientesApi.crear({
        nombres: npNombres.trim(),
        apellidoPaterno: npApellidoPaterno.trim(),
        apellidoMaterno: npApellidoMaterno.trim(),
        tipoDocumento: npTipoDoc,
        numeroDocumento: npNumDoc.trim(),
        telefono: npTelefono.trim(),
        email: npEmail.trim() || undefined,
        fechaNacimiento: npFechaNacimiento || undefined,
        sexo: npSexo || undefined,
        canalId: npCanalId || undefined,
      });
    },
  });

  const handleAgendar = async () => {
    if (!servicioId) {
      toast.error('Selecciona un servicio');
      return;
    }
    if (sedeCerradaEseDia) {
      toast.error('La sede seleccionada se encuentra CERRADA en esta fecha.');
      return;
    }
    if (subcategorias.length > 0 && !subcategoriaId) {
      toast.error('Selecciona una opción/subcategoría del servicio');
      return;
    }
    // Bloque combinado: si activó "servicio extra combinado" pero NO eligió el extra, no dejar
    // que se guarde como cita suelta en silencio (antes se perdía el 2º servicio sin avisar).
    if (combinar && !extraServicioId) {
      toast.error('Marcaste "servicio extra combinado" pero no elegiste el servicio extra: selecciónalo o desmarca la opción.');
      return;
    }
    if (!fechaCita || !horaCita) {
      toast.error('Selecciona fecha y hora');
      return;
    }
    // Retroactiva: fecha en el pasado → exige motivo (el backend también lo re-valida).
    if (faltaMotivoRetroactivo) {
      toast.error('Estás registrando una cita en una fecha pasada: indica el motivo del registro retroactivo.');
      return;
    }
    if (profesionalId && turnosProfMap) {
      const turno = turnosProfMap[profesionalId];
      if (turno === null) {
        toast.error('El profesional seleccionado no labora en la fecha elegida.');
        return;
      }
      if (turno && (horaCita < turno.horaInicio || horaCita >= turno.horaFin)) {
        toast.error(`La hora ${horaCita} está fuera del turno del profesional (${turno.horaInicio}–${turno.horaFin}).`);
        return;
      }
    }
    // Baro: el médico elegido no puede estar ocupado a esa hora (ya tiene cita en podología o baro).
    if (esBaro && medicoBaroId) {
      const ocup = profesionalesOcupados?.get(medicoBaroId);
      if (ocup) {
        const nom = medicosBaro.find((m) => m.id === medicoBaroId)?.nombre ?? 'El médico';
        toast.error(`${nom} ya está ocupado a las ${ocup.hora} en ${ocup.unidad}. Elige otro horario u otro médico.`);
        return;
      }
    }

    try {
      let finalPacienteId = '';

      if (modoPaciente === 'existente') {
        if (!pacienteSeleccionado) {
          toast.error('Selecciona un paciente existente');
          return;
        }
        finalPacienteId = pacienteSeleccionado.id;
      } else {
        const nuevoPac = await mutationCrearPaciente.mutateAsync();
        finalPacienteId = nuevoPac.id;
      }

      mutationCrear.mutate({ pacienteId: finalPacienteId });
    } catch (e: any) {
      toast.error(e?.message || 'Error al procesar la cita');
    }
  };

  // Header fecha
  let fechaHeader = '25 de Julio · 2026';
  try {
    const d = new Date(fechaCita + 'T12:00:00');
    fechaHeader = format(d, "dd 'de' MMMM · yyyy", { locale: es });
  } catch (e) {}

  return {
    // Sede / Especialidad (selector opcional desde la ficha)
    sedeId,
    setSedeId,
    unidadNegocioId,
    setUnidadNegocioId,
    sedesDisponibles,
    unidadesDeSede,
    permitirCambiarSede,

    // Baropodometría: médico por solicitud + gestión del roster
    esBaro,
    medicosBaro,
    medicoBaroId,
    setMedicoBaroId,
    puedeGestionarBaro,

    // Form States
    modoPaciente,
    setModoPaciente,
    pacienteQuery,
    setPacienteQuery,
    pacienteSeleccionado,
    setPacienteSeleccionado,
    npNombres,
    setNpNombres,
    npApellidoPaterno,
    setNpApellidoPaterno,
    npApellidoMaterno,
    setNpApellidoMaterno,
    npTipoDoc,
    setNpTipoDoc,
    npNumDoc,
    setNpNumDoc,
    npTelefono,
    setNpTelefono,
    npEmail,
    setNpEmail,
    npFechaNacimiento,
    setNpFechaNacimiento,
    npSexo,
    setNpSexo,
    npCanalId,
    setNpCanalId,
    npEdad,
    puedeBuscarDni,
    buscarPorDocumento,
    dniConsultando,
    servicioId,
    setServicioId,
    subcategoriaId,
    setSubcategoriaId,
    paquetePacienteId,
    setPaquetePacienteId,
    membSel,
    setMembSel,
    membItem,
    setMembItem,
    membInicio,
    setMembInicio,
    membFin,
    setMembFin,
    canal,
    setCanal,
    promocionId,
    setPromocionId,
    codigoPromo,
    setCodigoPromo,
    promocionesElegibles,
    promoSeleccionada,
    usandoMembresia,
    precioListaEstimado,
    descuentoPromo,
    profesionalId,
    setProfesionalId,
    fechaCita,
    setFechaCita,
    horaCita,
    setHoraCita,
    comentarioRecepcion,
    setComentarioRecepcion,
    // Cita retroactiva (fecha pasada)
    esRetroactiva,
    motivoRetroactivo,
    setMotivoRetroactivo,
    faltaMotivoRetroactivo,
    combinar,
    setCombinar,
    extraServicioId,
    setExtraServicioId,
    extraProfesionalId,
    setExtraProfesionalId,
    verVisorGenexis,
    setVerVisorGenexis,
    comprobante,
    setComprobante,
    subiendo,
    inputFileRef,

    // Loaded Data
    servicios,
    subcategorias,
    profesionales,
    profesionalesOcupados,
    profesionalesExtra,
    anclaHaceExtra,
    totalEstimado,
    resultadosPacientes,
    buscandoPacientes,
    canales,
    canalesPaciente,
    paquetesPaciente,
    membresiasActivas,
    tplsMembresiaActivas,
    membComposicion,
    existeGenexis,
    esServicioAncla,
    combinablesActivos,
    sedeCerradaEseDia,

    // Action Handlers
    handleSubirComprobante,
    handleAgendar,
    isPending: mutationCrear.isPending || mutationCrearPaciente.isPending,
    opcionesHoras,
    fechaHeader,
  };
}
