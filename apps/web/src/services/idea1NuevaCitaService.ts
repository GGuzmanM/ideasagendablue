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
import { calcularEdad } from './pacientesService';
import { combinacionesApi } from '../api/combinaciones';
import { usePaquetesPaciente } from '../api/paquetesSesiones';
import { useCanales } from '../hooks/useCanales';
import { usePromociones } from '../hooks/usePromociones';
import { useAuthStore } from '../stores/authStore';

const toTitleCase = (str: string) =>
  str.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

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
  horaInicio: horaInicial = '08:30',
  profesionalId: profInicial = '',
  onClose,
  onSuccess,
  pacienteInicial,
  permitirCambiarSede = false,
}: UseIdea1NuevaCitaFormProps) {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const { canales, canalesPaciente } = useCanales();
  const { promociones } = usePromociones();

  const idempotencyKeyRef = useRef(uuidv4());

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
  const [profesionalId, setProfesionalId] = useState(profInicial);
  const [fechaCita, setFechaCita] = useState<string>(format(fecha, 'yyyy-MM-dd'));
  const [horaCita, setHoraCita] = useState<string>(horaInicial);
  const [comentarioRecepcion, setComentarioRecepcion] = useState('');

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
        toast.success(`Paciente ya registrado: ${nombreComp}. Se cargó automáticamente.`);
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
        formData.append('file', file);
        const res = await api.post<{ url: string; nombre: string; mimeType: string }>('/uploads/comprobante', formData);
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
  });

  const { data: subcategorias = [] } = useQuery({
    queryKey: ['subcategorias', servicioId],
    queryFn: async () => {
      if (!servicioId) return [];
      const res = await api.get<any[]>(`/servicios/${servicioId}/subcategorias`);
      return res.filter((sc) => sc.activo);
    },
    enabled: Boolean(servicioId),
  });

  // Competencias activas entre profesionales y servicios de esta unidad de negocio
  const { data: competencias = [] } = useQuery({
    queryKey: ['competencias', unidadNegocioId],
    queryFn: () => competenciasApi.listar({ unidadNegocioId }),
    enabled: Boolean(unidadNegocioId),
  });

  // Profesionales seleccionables que pueden atender ese servicio en esa fecha/sede
  const { data: profesionales = [] } = useQuery({
    queryKey: ['profesionales-seleccionables', sedeId, unidadNegocioId, fechaCita, servicioId],
    queryFn: () => profesionalesApi.seleccionables({ sedeId, unidadNegocioId, fecha: fechaCita, servicioId: servicioId || undefined }),
    enabled: Boolean(sedeId) && Boolean(unidadNegocioId),
  });

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

  // Membresías / Paquetes ACTIVOS unificados del paciente
  const membresiasActivas = useMemo(() => {
    const map = new Map<string, any>();
    const fCitaStr = (fechaCita || '').split('T')[0];

    (saldosPaciente ?? []).forEach((s: any) => {
      const inicioStr = s.vigenciaInicio ? s.vigenciaInicio.split('T')[0] : null;
      const finStr = s.vigenciaFin ? s.vigenciaFin.split('T')[0] : null;
      if (inicioStr && fCitaStr < inicioStr) return;
      if (finStr && fCitaStr > finStr) return;
      if (s.estado === 'ACTIVO' || (s.saldo && s.saldo > 0) || (s.sesionesTotal && s.sesionesTotal > s.consumidas)) {
        map.set(s.id, {
          id: s.id,
          nombre: s.nombre || s.paquete?.nombre || 'Membresía / Paquete',
          saldo: s.saldo ?? Math.max((s.sesionesTotal || 0) - (s.consumidas || 0), 0),
          sesionesTotal: s.sesionesTotal || 1,
          consumidas: s.consumidas || 0,
          composicion: s.composicion,
        });
      }
    });

    (paquetesPacienteRaw ?? []).forEach((p: any) => {
      if (!map.has(p.id)) {
        const total = p.sesionesTotal || 1;
        const usadas = p.sesionesUsadas || (p.citas ? p.citas.length : 0);
        const saldo = Math.max(total - usadas, 0);
        if (p.activo !== false && (p.estado === 'ACTIVO' || p.estado === undefined || saldo > 0)) {
          map.set(p.id, {
            id: p.id,
            nombre: p.paquete?.nombre || 'Paquete / Membresía',
            saldo,
            sesionesTotal: total,
            consumidas: usadas,
            composicion: p.composicion,
          });
        }
      }
    });

    return Array.from(map.values());
  }, [saldosPaciente, paquetesPacienteRaw, fechaCita]);

  const paquetesPaciente = useMemo(() => {
    return membresiasActivas.map((m: any) => ({
      id: m.id,
      sesionesTotal: m.sesionesTotal,
      sesionesUsadas: m.consumidas,
      saldo: m.saldo,
      paquete: { nombre: m.nombre },
    }));
  }, [membresiasActivas]);

  // Plantillas de Membresías vendibles
  const { data: membresiasTpl = [] } = useQuery({
    queryKey: ['membresias-vendibles'],
    queryFn: () => api.get<MembresiaTpl[]>('/membresias/vendibles'),
    enabled: Boolean(pacienteSeleccionado?.id),
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
    }[] = [];

    if (membSel.startsWith('inst:')) {
      const pp = membresiasActivas.find((p) => `inst:${p.id}` === membSel);
      items = (pp?.composicion ?? []).map((i: any) => ({
        servicioId: i.servicioId,
        etiqueta: i.etiqueta ?? 'Servicio',
        subcategoriaId: i.subcategoriaId ?? null,
        subcategoriaEtiqueta: i.subcategoriaEtiqueta,
        total: i.cantidad,
        quedan: Math.max(0, i.cantidad - i.consumidas),
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
      }));
    }

    return items.filter((i) => serviciosUnidadSet.has(i.servicioId));
  }, [membSel, membresiasActivas, tplsMembresiaActivas, serviciosData]);

  // Al elegir un servicio dentro de una membresía, fija servicio y subcategoría automáticamente
  useEffect(() => {
    if (!membSel || membItem === '') return;
    const item = membComposicion[Number(membItem)];
    if (!item) return;
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

  // Opciones de horas (reales si hay disponibilidad, o fallback completo)
  const opcionesHoras = useMemo(() => {
    if (dispo?.slots && dispo.slots.length > 0) {
      const horasDispo = [...new Set(dispo.slots.map((s: any) => s.horaInicio))].sort();
      if (!horasDispo.includes(horaCita)) {
        // asegurar que la hora inicial seleccionada esté en la lista
        return [horaCita, ...horasDispo].sort();
      }
      return horasDispo;
    }
    const horasFallback: string[] = [];
    for (let h = 8; h <= 20; h++) {
      const hh = String(h).padStart(2, '0');
      horasFallback.push(`${hh}:00`);
      if (h < 20) horasFallback.push(`${hh}:30`);
    }
    return horasFallback;
  }, [dispo, horaCita]);

  // Configuración de combinaciones
  const { data: configCombi } = useQuery({
    queryKey: ['combinaciones-config'],
    queryFn: () => combinacionesApi.config(),
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

      // 1) Si se eligió activar una nueva membresía (tpl:)
      let finalPaqueteId = paquetePacienteId;
      if (membSel.startsWith('tpl:') && membItem !== '') {
        const promoId = membSel.slice(4);
        const item = membComposicion[Number(membItem)];
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
          comentarioRecepcion: comentarioRecepcion.trim() || undefined,
          paquetePacienteId: finalPaqueteId || undefined,
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
          fecha: fechaCita,
          horaInicio: horaCita,
          canal,
          promocionId: promocionId || undefined,
          comentarioRecepcion: comentarioRecepcion.trim() || undefined,
          paquetePacienteId: finalPaqueteId || undefined,
          comprobanteUrl: comprobante?.url,
          comprobanteNombre: comprobante?.nombre,
          comprobanteMimeType: comprobante?.mimeType,
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
    if (subcategorias.length > 0 && !subcategoriaId) {
      toast.error('Selecciona una opción/subcategoría del servicio');
      return;
    }
    if (!fechaCita || !horaCita) {
      toast.error('Selecciona fecha y hora');
      return;
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
    profesionalId,
    setProfesionalId,
    fechaCita,
    setFechaCita,
    horaCita,
    setHoraCita,
    comentarioRecepcion,
    setComentarioRecepcion,
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
    resultadosPacientes,
    buscandoPacientes,
    canales,
    canalesPaciente,
    promociones,
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
