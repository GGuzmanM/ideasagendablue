// Historia clínica — LÓGICA (hooks). Las vistas (.tsx) son puras y consumen estos hooks.
// Un useState por campo, `puedeGuardar` derivado, useMutation → invalidar + toast (patrón de la casa).
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { pacientesApi, profesionalesApi, serviciosApi, type Profesional } from '../api';
import { citasApi, type CitaResumen } from '../api/citas';
import {
  historiaClinicaApi, useHistoriaClinica, useAtencionClinica, useInvalidarHistoriaClinica,
  type AtencionClinica, type AtencionCompleta, type CamposNota, type TipoNota, type TipoDiagnostico,
  type TipoAntecedente, type SeveridadAlergia, type NotaEvolucion, type DiagnosticoAtencion,
  type TipoProcedimiento, type TipoEscala, type TipoLesion, type Pie, type PiePodograma,
  type VistaPodograma, type ImagenPodograma, VISTAS_PODOGRAMA, VISTA_PODOGRAMA_LABEL,
  usePlantillas, TIPO_LESION_LABEL, PIE_LABEL, type PlantillaClinica, type TipoPlantilla, type CamposMarca,
} from '../api/historiaClinica';
import { recetasApi, verRecetaPdf, imprimirReceta, type ItemEntrada, type TipoDocumentoReceta, type RecetaCompleta, type TipoItemReceta } from '../api/recetas';
import type { Cie10Item, MedicamentoItem } from '../api/catalogos';
import { useDictado, anexarDictado } from '../hooks/useDictado';
import { useDictadoConsulta } from '../hooks/useDictadoConsulta';
import { adivinarTipoProcedimiento, type DiagnosticoDictado } from '../utils/dictadoEstructurado';
import { coordZona } from '../utils/zonasPie';
import { useAutotextoStore } from '../stores/autotextoStore';

export type TabHc = 'evolucion' | 'receta' | 'antecedentes' | 'procedimientos' | 'escalas' | 'podograma' | 'fotos' | 'consentimientos';
const ESTADOS_ATENDIDA = ['llego', 'en_atencion', 'completada'];

const esEquipoNombre = (p: { nombres: string }) => /^baro\b/i.test(p.nombres.trim());

// ─── Página de dos paneles ────────────────────────────────────────────────────
export function useHistoriaClinicaPage() {
  const { pacienteId } = useParams<{ pacienteId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const invalidar = useInvalidarHistoriaClinica();
  const usuario = useAuthStore((s) => s.usuario);
  const tiene = useAuthStore((s) => s.tiene);
  const puedeRegistrar = tiene('hc.registrar');
  const puedeAnular = tiene('hc.anular');
  const puedeVerRecetas = tiene('receta.ver');
  const esMedicoPrescriptor = !!usuario?.esMedicoPrescriptor;

  const historiaQ = useHistoriaClinica(pacienteId);
  const historia = historiaQ.data?.historia ?? null;
  const paciente = historiaQ.data?.paciente ?? null;

  // Ficha del paciente (misma queryKey que la ficha → se comparte la caché): trae el historial de citas.
  const fichaQ = useQuery({ queryKey: ['paciente', pacienteId], queryFn: () => pacientesApi.obtener(pacienteId!), enabled: !!pacienteId });

  const [atencionSel, setAtencionSel] = useState<string | null>(params.get('atencion'));
  const atencionQ = useAtencionClinica(atencionSel ?? undefined);
  const atencion = atencionQ.data ?? null;

  const [tab, setTab] = useState<TabHc>('evolucion');
  const [citaARegistrar, setCitaARegistrar] = useState<CitaResumen | null>(null);
  const [recetaModal, setRecetaModal] = useState<TipoDocumentoReceta | null>(null);
  const [mostrarCandidatas, setMostrarCandidatas] = useState(false);

  // Citas atendidas del paciente que aún NO tienen atención clínica (candidatas para "Nueva atención").
  const citasCandidatas = useMemo(() => {
    const conAtencion = new Set((historia?.atenciones ?? []).map((a) => a.citaId));
    const hist = (fichaQ.data?.historial ?? []) as unknown as CitaResumen[];
    return hist.filter((c) => ESTADOS_ATENDIDA.includes((c.estado || '').toLowerCase()) && !conAtencion.has(c.id)).slice(0, 20);
  }, [historia?.atenciones, fichaQ.data?.historial]);

  // Entrada desde el modal de cita: ?cita=ID → si ya tiene atención la selecciona; si no, abre "Registrar".
  const citaParam = params.get('cita');
  useEffect(() => {
    if (!citaParam) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await historiaClinicaApi.resumenPorCita(citaParam);
        if (cancelado) return;
        if (r.atencionId) { setAtencionSel(r.atencionId); }
        else if (puedeRegistrar && r.puedeAbrir) { const c = await citasApi.obtener(citaParam); if (!cancelado) setCitaARegistrar(c as unknown as CitaResumen); }
        else toast('La cita aún no fue atendida: registra la atención cuando el paciente llegue', { icon: 'ℹ️' });
      } catch (e) { toast.error((e as Error).message); }
      finally { if (!cancelado) { params.delete('cita'); setParams(params, { replace: true }); } }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citaParam]);

  // Sin selección: la atención más reciente.
  useEffect(() => {
    if (!atencionSel && historia?.atenciones?.length) setAtencionSel(historia.atenciones[0]!.id);
  }, [historia?.atenciones, atencionSel]);

  const seleccionarAtencion = (id: string) => { setAtencionSel(id); setTab('evolucion'); };

  const cerrarMut = useMutation({
    mutationFn: () => historiaClinicaApi.cerrarAtencion(atencionSel!),
    onSuccess: () => { invalidar({ pacienteId, atencionId: atencionSel! }); toast.success('Atención cerrada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reabrirMut = useMutation({
    mutationFn: () => historiaClinicaApi.reabrirAtencion(atencionSel!),
    onSuccess: () => { invalidar({ pacienteId, atencionId: atencionSel! }); toast.success('Atención reabierta'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onAtencionCreada = (a: AtencionCompleta) => {
    invalidar({ pacienteId, citaId: a.citaId });
    setCitaARegistrar(null);
    setAtencionSel(a.id);
    setTab('evolucion');
  };

  // Formularios de evolución y procedimientos viven AQUÍ (no en su pestaña) para que un borrador
  // —escrito o dictado— no se pierda al cambiar de pestaña (p. ej. ir a tomar una foto y volver).
  const evolucion = useEvolucionForm(atencion, puedeRegistrar);
  const procedimientos = useProcedimientos(atencion, puedeRegistrar);

  // Dictado por voz: un solo reconocedor para toda la página (mic por campo o "Dictar consulta").
  const dictado = useDictado();
  // Diagnóstico dictado ("diagnóstico definitivo onicomicosis") → precarga el buscador CIE-10.
  const [dxDictado, setDxDictado] = useState<(DiagnosticoDictado & { n: number }) | null>(null);
  const limpiarDxDictado = () => setDxDictado(null);
  // Autotextos (1.2): atajos → store global que leen todos los TextareaDictado de la HC.
  const { data: autotextos } = usePlantillas('autotexto');
  const setAtajos = useAutotextoStore((s) => s.setAtajos);
  useEffect(() => { setAtajos(Object.fromEntries((autotextos ?? []).filter((a) => a.clave).map((a) => [a.clave!.toLowerCase(), a.contenido.texto ?? '']))); }, [autotextos, setAtajos]);
  const gestionaPlantillas = ['admin', 'coordinadora_sedes', 'medico'].includes(usuario?.rol ?? '');
  // Lesión dictada ("lesión heloma quinto dedo izquierdo") → marca del podograma en la zona dicha.
  const marcaDictadoMut = useMutation({
    mutationFn: (d: CamposMarca) => historiaClinicaApi.agregarMarca(atencionSel!, d),
    onSuccess: (_r, d) => { invalidar({ pacienteId, atencionId: atencionSel! }); toast.success(`Podograma: ${TIPO_LESION_LABEL[d.tipoLesion]} · ${PIE_LABEL[d.pie]}${d.zona ? ` · ${d.zona}` : ''}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const consulta = useDictadoConsulta(dictado, {
    setSubjetivo: evolucion.setSubjetivo, setObjetivo: evolucion.setObjetivo, setApreciacion: evolucion.setApreciacion,
    setPlan: evolucion.setPlan, setObservacion: evolucion.setTexto,
    onProcedimiento: (t) => {
      procedimientos.setDetalle((prev) => anexarDictado(prev, t));
      if (!procedimientos.tipo) { const tipo = adivinarTipoProcedimiento(t); if (tipo) procedimientos.setTipo(tipo); }
    },
    onDiagnostico: (d) => {
      if (!d.termino) { if (d.tipo) evolucion.setDxTipo(d.tipo); if (d.principal !== undefined) evolucion.setDxPrincipal(d.principal); return; }
      setDxDictado((prev) => ({ ...d, n: (prev?.n ?? 0) + 1 }));
    },
    onLesion: (l) => {
      if (!l.pie || !l.zona) {
        evolucion.setObjetivo((prev) => anexarDictado(prev, l.texto));
        toast(`Lesión sin ${!l.pie ? 'pie' : 'zona'} clara: el texto fue a Objetivo. Di p. ej. «lesión heloma quinto dedo izquierdo».`, { icon: '⚠️', duration: 6000 });
        return;
      }
      const c = coordZona(l.zona.id, l.pie);
      marcaDictadoMut.mutate({ pie: l.pie, x: c.x, y: c.y, zona: l.zona.etiqueta, tipoLesion: l.tipoLesion ?? 'otro', nota: `${l.texto}${l.grado != null ? ` · grado ${l.grado}` : ''}` });
    },
  });

  return {
    pacienteId, paciente, historia, cargando: historiaQ.isLoading, errorCarga: historiaQ.error as Error | null,
    atencion, atencionSel, seleccionarAtencion, cargandoAtencion: atencionQ.isLoading,
    tab, setTab, navigate,
    puedeRegistrar, puedeAnular, puedeVerRecetas, esMedicoPrescriptor, usuario,
    citasCandidatas, mostrarCandidatas, setMostrarCandidatas,
    citaARegistrar, setCitaARegistrar, onAtencionCreada,
    recetaModal, setRecetaModal,
    cerrarMut, reabrirMut,
    invalidar,
    evolucion, procedimientos, dictado, consulta, dxDictado, limpiarDxDictado, gestionaPlantillas,
  };
}

// ─── Registrar atención (desde una cita atendida) ────────────────────────────
export function useRegistrarAtencionForm(cita: CitaResumen, onCreada: (a: AtencionCompleta) => void) {
  const preselecto = cita.solicitadoProfesional?.id ?? cita.profesionalId ?? '';
  const [motivoConsulta, setMotivoConsulta] = useState('');
  const [profesionalId, setProfesionalId] = useState<string>(preselecto);
  const { data: profesionales = [] } = useQuery({ queryKey: ['profesionales-activos'], queryFn: () => profesionalesApi.listar({ activo: true }), staleTime: 300_000 });
  // Personas (nunca equipos Baro). Si la columna de la cita es un equipo, el backend exige médico.
  const columnaEsEquipo = !!cita.profesional && esEquipoNombre(cita.profesional);
  const opciones = useMemo(() => (profesionales as Profesional[]).filter((p) => !esEquipoNombre(p) && (!columnaEsEquipo || p.tipo === 'medico')), [profesionales, columnaEsEquipo]);
  const puedeGuardar = motivoConsulta.trim().length >= 2 && (!columnaEsEquipo || !!profesionalId);
  const abrirMut = useMutation({
    mutationFn: () => historiaClinicaApi.abrirAtencion({ citaId: cita.id, motivoConsulta: motivoConsulta.trim(), profesionalId: profesionalId || null }),
    onSuccess: (a) => { toast.success('Atención registrada'); onCreada(a); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { motivoConsulta, setMotivoConsulta, profesionalId, setProfesionalId, opciones, columnaEsEquipo, puedeGuardar, abrirMut };
}

// ─── Evolución: notas (editables) + diagnósticos ─────────────────────────────
export function useEvolucionForm(atencion: AtencionCompleta | null, puedeRegistrar: boolean) {
  const invalidar = useInvalidarHistoriaClinica();
  const atencionId = atencion?.id;
  const inval = () => invalidar({ pacienteId: atencion?.pacienteId, atencionId, citaId: atencion?.citaId });

  // Nota S/O/A/P (un useState por campo). `editando` = id de la nota cargada en el formulario.
  const [editando, setEditando] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoNota>('evolucion');
  const [subjetivo, setSubjetivo] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [apreciacion, setApreciacion] = useState('');
  const [plan, setPlan] = useState('');
  const [texto, setTexto] = useState('');
  const [profesionalId, setProfesionalId] = useState<string>('');
  useEffect(() => { setProfesionalId(atencion?.profesionalId ?? ''); limpiarNota(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [atencionId]);

  const cargarNota = (n: NotaEvolucion) => {
    setEditando(n.id); setTipo(n.tipo); setSubjetivo(n.subjetivo ?? ''); setObjetivo(n.objetivo ?? '');
    setApreciacion(n.apreciacion ?? ''); setPlan(n.plan ?? ''); setTexto(n.texto ?? ''); setProfesionalId(n.profesionalId ?? atencion?.profesionalId ?? '');
  };
  const limpiarNota = () => { setEditando(null); setTipo('evolucion'); setSubjetivo(''); setObjetivo(''); setApreciacion(''); setPlan(''); setTexto(''); };
  const campos = (): CamposNota => ({ tipo, subjetivo, objetivo, apreciacion, plan, texto, profesionalId: profesionalId || null });
  const hayContenido = [subjetivo, objetivo, apreciacion, plan, texto].some((s) => s.trim());
  const cerrada = atencion?.estado === 'cerrada';
  const puedeGuardarNota = puedeRegistrar && hayContenido && (!cerrada || tipo === 'observacion' || !!editando);

  const guardarNotaMut = useMutation({
    mutationFn: () => (editando ? historiaClinicaApi.editarNota(editando, campos()) : historiaClinicaApi.agregarNota(atencionId!, campos())),
    onSuccess: () => { inval(); toast.success(editando ? 'Nota actualizada' : 'Nota registrada'); limpiarNota(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarNotaMut = useMutation({
    mutationFn: (notaId: string) => historiaClinicaApi.eliminarNota(notaId),
    onSuccess: () => { inval(); toast.success('Nota eliminada'); if (editando) limpiarNota(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // "Traer última nota" y "Copiar diagnósticos anteriores".
  const { data: anteriores } = useQuery({ queryKey: ['hc-anteriores', atencionId], queryFn: () => historiaClinicaApi.anteriores(atencionId!), enabled: !!atencionId, staleTime: 300_000 });
  const traerUltimaNota = () => {
    const n = anteriores?.nota; if (!n) { toast('No hay una nota previa de este paciente', { icon: 'ℹ️' }); return; }
    setEditando(null); setTipo('evolucion'); setSubjetivo(n.subjetivo ?? ''); setObjetivo(n.objetivo ?? ''); setApreciacion(n.apreciacion ?? ''); setPlan(n.plan ?? ''); setTexto(n.texto ?? '');
    toast('Nota anterior copiada: revísala y actualízala antes de guardar', { icon: '📋' });
  };

  // Diagnósticos
  const [dxSel, setDxSel] = useState<Cie10Item | null>(null);
  const [dxTipo, setDxTipo] = useState<TipoDiagnostico>('presuntivo');
  const [dxPrincipal, setDxPrincipal] = useState(false);
  const [dxObs, setDxObs] = useState('');
  const agregarDxMut = useMutation({
    mutationFn: (d: { cie10Codigo: string; tipo?: TipoDiagnostico; principal?: boolean; observacion?: string | null }) => historiaClinicaApi.agregarDiagnostico(atencionId!, d),
    onSuccess: () => { inval(); setDxSel(null); setDxObs(''); setDxPrincipal(false); toast.success('Diagnóstico agregado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const editarDxMut = useMutation({
    mutationFn: (p: { id: string; data: { tipo?: TipoDiagnostico; principal?: boolean; observacion?: string | null } }) => historiaClinicaApi.editarDiagnostico(p.id, p.data),
    onSuccess: () => inval(),
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarDxMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarDiagnostico(id),
    onSuccess: () => { inval(); toast.success('Diagnóstico eliminado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const copiarDxAnteriores = async () => {
    const prev = anteriores?.diagnosticos?.diagnosticos ?? [];
    const actuales = new Set((atencion?.diagnosticos ?? []).map((d) => d.cie10Codigo));
    const nuevos = prev.filter((d: DiagnosticoAtencion) => !actuales.has(d.cie10Codigo));
    if (!nuevos.length) { toast('No hay diagnósticos anteriores que copiar', { icon: 'ℹ️' }); return; }
    for (const d of nuevos) await historiaClinicaApi.agregarDiagnostico(atencionId!, { cie10Codigo: d.cie10Codigo, tipo: d.tipo, principal: false, observacion: d.observacion });
    inval(); toast.success(`${nuevos.length} diagnóstico(s) copiado(s)`);
  };

  // Plantillas por diagnóstico (1.1): sugeridas por los CIE-10 de la atención; rellenan SOLO campos vacíos.
  const { data: plantillas = [] } = usePlantillas('nota');
  const codigosDx = new Set((atencion?.diagnosticos ?? []).map((d) => d.cie10Codigo));
  const plantillasSugeridas = plantillas.filter((p) => p.clave && codigosDx.has(p.clave));
  const aplicarPlantilla = (id: string) => {
    const p = plantillas.find((x) => x.id === id);
    if (!p) return;
    const campos: [string, string, string, (v: string) => void][] = [
      ['subjetivo', 'Subjetivo', subjetivo, setSubjetivo], ['objetivo', 'Objetivo', objetivo, setObjetivo],
      ['apreciacion', 'Apreciación', apreciacion, setApreciacion], ['plan', 'Plan', plan, setPlan],
    ];
    const puestos: string[] = [], saltados: string[] = [];
    for (const [clave, label, actual, set] of campos) {
      const v = p.contenido[clave];
      if (!v) continue;
      if (actual.trim()) saltados.push(label); else { set(v); puestos.push(label); }
    }
    if (tipo === 'observacion') setTipo('evolucion');
    toast.success(`Plantilla «${p.nombre}»: ${puestos.length ? puestos.join(', ') : 'nada que rellenar'}${saltados.length ? ` · sin tocar (ya tenían texto): ${saltados.join(', ')}` : ''}`, { duration: 5000 });
  };

  return {
    editando, tipo, setTipo, subjetivo, setSubjetivo, objetivo, setObjetivo, apreciacion, setApreciacion, plan, setPlan, texto, setTexto,
    profesionalId, setProfesionalId, cargarNota, limpiarNota, puedeGuardarNota, guardarNotaMut, eliminarNotaMut, traerUltimaNota, tieneNotaAnterior: !!anteriores?.nota,
    dxSel, setDxSel, dxTipo, setDxTipo, dxPrincipal, setDxPrincipal, dxObs, setDxObs, agregarDxMut, editarDxMut, eliminarDxMut, copiarDxAnteriores, tieneDxAnteriores: !!anteriores?.diagnosticos,
    cerrada, plantillas, plantillasSugeridas, aplicarPlantilla,
  };
}

// ─── Antecedentes y alergias (por paciente) ──────────────────────────────────
export function useAntecedentesAlergias(pacienteId: string | undefined) {
  const invalidar = useInvalidarHistoriaClinica();
  const inval = () => invalidar({ pacienteId });
  const [sustancia, setSustancia] = useState(''); const [reaccion, setReaccion] = useState(''); const [severidad, setSeveridad] = useState<SeveridadAlergia>('moderada');
  const [antTipo, setAntTipo] = useState<TipoAntecedente>('patologico'); const [antDesc, setAntDesc] = useState('');
  const alergiaMut = useMutation({
    mutationFn: () => historiaClinicaApi.registrarAlergia(pacienteId!, { sustancia: sustancia.trim(), reaccion: reaccion.trim() || null, severidad }),
    onSuccess: () => { inval(); setSustancia(''); setReaccion(''); setSeveridad('moderada'); toast.success('Alergia registrada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const antecedenteMut = useMutation({
    mutationFn: () => historiaClinicaApi.registrarAntecedente(pacienteId!, { tipo: antTipo, descripcion: antDesc.trim() }),
    onSuccess: () => { inval(); setAntDesc(''); toast.success('Antecedente registrado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarAlergiaMut = useMutation({ mutationFn: (id: string) => historiaClinicaApi.eliminarAlergia(id), onSuccess: () => { inval(); toast.success('Alergia eliminada'); }, onError: (e: Error) => toast.error(e.message) });
  const eliminarAntecedenteMut = useMutation({ mutationFn: (id: string) => historiaClinicaApi.eliminarAntecedente(id), onSuccess: () => { inval(); toast.success('Antecedente eliminado'); }, onError: (e: Error) => toast.error(e.message) });
  const toggleAlergiaMut = useMutation({ mutationFn: (p: { id: string; activa: boolean }) => historiaClinicaApi.editarAlergia(p.id, { activa: p.activa }), onSuccess: () => inval(), onError: (e: Error) => toast.error(e.message) });
  const toggleAntecedenteMut = useMutation({ mutationFn: (p: { id: string; activo: boolean }) => historiaClinicaApi.editarAntecedente(p.id, { activo: p.activo }), onSuccess: () => inval(), onError: (e: Error) => toast.error(e.message) });
  return {
    sustancia, setSustancia, reaccion, setReaccion, severidad, setSeveridad, alergiaMut, puedeGuardarAlergia: sustancia.trim().length >= 2,
    antTipo, setAntTipo, antDesc, setAntDesc, antecedenteMut, puedeGuardarAntecedente: antDesc.trim().length >= 2,
    eliminarAlergiaMut, eliminarAntecedenteMut, toggleAlergiaMut, toggleAntecedenteMut,
  };
}

// ─── Emitir receta médica / indicaciones ─────────────────────────────────────
export interface ItemBorrador extends ItemEntrada { key: string; etiqueta: string; requiereReceta?: boolean }

export function useEmitirRecetaForm(atencion: AtencionCompleta, tipoDocumento: TipoDocumentoReceta) {
  const invalidar = useInvalidarHistoriaClinica();
  const esReceta = tipoDocumento === 'RECETA_MEDICA';
  const dxPrincipal = atencion.diagnosticos.find((d) => d.principal) ?? atencion.diagnosticos[0] ?? null;
  // Diagnósticos de la atención = el "para qué" del documento. Todo lo que se agrega (servicio,
  // medicamento o producto) queda BAJO el diagnóstico activo; en el documento se imprime agrupado.
  const diagnosticos = atencion.diagnosticos;
  const [dxActivo, setDxActivo] = useState<string | null>(dxPrincipal?.cie10Codigo ?? null);
  const [items, setItems] = useState<ItemBorrador[]>([]);
  const [indicacionesGenerales, setIndicacionesGenerales] = useState('');
  const [vigenciaDias, setVigenciaDias] = useState<number>(30);
  const [emisorProfesionalId, setEmisorProfesionalId] = useState<string>(atencion.profesionalId);
  const [emitida, setEmitida] = useState<RecetaCompleta | null>(null);
  const { data: servicios = [] } = useQuery({ queryKey: ['servicios-todos'], queryFn: () => serviciosApi.listar({ activo: true }), staleTime: 300_000 });

  const nuevaKey = () => Math.random().toString(36).slice(2, 9);
  const agregarMedicamento = (m: MedicamentoItem) => {
    if (!esReceta && m.requiereReceta) { toast.error(`"${m.dci}" es de venta bajo receta: solo puede ir en una Receta Médica`); return; }
    const marca = (m.nombresComerciales ?? '').split(',')[0]?.trim() || null;
    setItems((xs) => [...xs, { key: nuevaKey(), etiqueta: [m.dci, m.concentracion, m.formaFarmaceutica].filter(Boolean).join(' '), requiereReceta: !!m.requiereReceta,
      tipo: m.esProducto ? 'PRODUCTO' : m.requiereReceta ? 'MEDICAMENTO_RX' : 'MEDICAMENTO_OTC', medicamentoId: m.id, nombre: m.dci, marcaImpresa: marca,
      concentracion: m.concentracion, formaFarmaceutica: m.formaFarmaceutica, via: m.viaAdministracion, diagnosticoCie10Codigo: dxActivo,
      indicaciones: m.posologiaSugerida ?? null, dosis: null, frecuencia: null, duracion: null, cantidad: null }]);
  };
  const agregarManual = (nombre: string, tipo: TipoItemReceta = esReceta ? 'MEDICAMENTO_RX' : 'MEDICAMENTO_OTC') => {
    const n = nombre.trim(); if (!n) return;
    setItems((xs) => [...xs, { key: nuevaKey(), etiqueta: n, tipo, nombre: n, diagnosticoCie10Codigo: dxActivo }]);
  };
  const agregarServicio = (servicioId: string) => {
    const s = servicios.find((x) => x.id === servicioId); if (!s) return;
    setItems((xs) => [...xs, { key: nuevaKey(), etiqueta: s.nombre, tipo: 'SERVICIO', servicioId: s.id, nombre: s.nombre, diagnosticoCie10Codigo: dxActivo }]);
  };
  const actualizarItem = (key: string, cambios: Partial<ItemBorrador>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...cambios } : x)));
  const quitarItem = (key: string) => setItems((xs) => xs.filter((x) => x.key !== key));

  // Ítems agrupados por diagnóstico (como se imprimen), respetando el orden en que aparecen los dx.
  const grupos = useMemo(() => {
    const porDx = new Map<string, ItemBorrador[]>();
    for (const it of items) { const k = it.diagnosticoCie10Codigo ?? ''; if (!porDx.has(k)) porDx.set(k, []); porDx.get(k)!.push(it); }
    return [...porDx.entries()].map(([codigo, its]) => ({
      codigo, descripcion: diagnosticos.find((d) => d.cie10Codigo === codigo)?.cie10.descripcion ?? (codigo ? codigo : 'Sin diagnóstico'), items: its,
    }));
  }, [items, diagnosticos]);

  const puedeGuardar = items.length > 0 && items.every((i) => (i.nombre ?? '').trim());
  const emitirMut = useMutation({
    mutationFn: () => recetasApi.emitir({
      atencionId: atencion.id, tipoDocumento, emisorProfesionalId: esReceta ? undefined : emisorProfesionalId || null,
      indicacionesGenerales: indicacionesGenerales.trim() || null, vigenciaDias: esReceta ? vigenciaDias : null,
      items: items.map(({ key: _k, etiqueta: _e, requiereReceta: _r, ...it }) => it),
    }),
    onSuccess: (r) => {
      setEmitida(r);
      invalidar({ pacienteId: atencion.pacienteId, atencionId: atencion.id, citaId: atencion.citaId });
      toast.success(esReceta ? `Receta N° ${r.numero} emitida` : `Indicaciones N° ${r.numero} emitidas`);
      if (r.advertencias?.length) r.advertencias.forEach((a) => toast(`⚠️ Alergia registrada a ${a.sustancia} (${a.item})`, { duration: 8000 }));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const abrirPdf = async () => { if (!emitida) return; try { await verRecetaPdf(emitida.id); } catch (e) { toast.error((e as Error).message); } };
  const imprimir = async () => { if (!emitida) return; try { await imprimirReceta(emitida.id); } catch (e) { toast.error((e as Error).message); } };
  const opcionesEmisor = useMemo(() => [atencion.profesional], [atencion.profesional]);

  return {
    esReceta, dxPrincipal, diagnosticos, dxActivo, setDxActivo, grupos, items, agregarMedicamento, agregarManual, agregarServicio, actualizarItem, quitarItem, servicios,
    indicacionesGenerales, setIndicacionesGenerales, vigenciaDias, setVigenciaDias, emisorProfesionalId, setEmisorProfesionalId, opcionesEmisor,
    puedeGuardar, emitirMut, emitida, abrirPdf, imprimir, alergias: atencion.historiaClinica.alergias,
  };
}

// ─── Recetas de una atención (listar / anular / PDF) ─────────────────────────
export function useRecetasAtencion(atencion: AtencionCompleta | null) {
  const invalidar = useInvalidarHistoriaClinica();
  const [anulando, setAnulando] = useState<string | null>(null);
  const anularMut = useMutation({
    mutationFn: (p: { id: string; motivo: string }) => recetasApi.anular(p.id, p.motivo),
    onSuccess: () => { invalidar({ pacienteId: atencion?.pacienteId, atencionId: atencion?.id }); setAnulando(null); toast.success('Documento anulado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ver = async (id: string) => { try { await verRecetaPdf(id); } catch (e) { toast.error((e as Error).message); } };
  const imprimir = async (id: string) => { try { await imprimirReceta(id); } catch (e) { toast.error((e as Error).message); } };
  return { recetas: atencion?.recetas ?? [], anulando, setAnulando, anularMut, ver, imprimir };
}

// ─── Bloque 3 · Procedimientos (1.11 / 1.12) ─────────────────────────────────
export function useProcedimientos(atencion: AtencionCompleta | null, puedeRegistrar: boolean) {
  const invalidar = useInvalidarHistoriaClinica();
  const atencionId = atencion?.id;
  const pacienteId = atencion?.pacienteId;
  const inval = () => invalidar({ pacienteId, atencionId, citaId: atencion?.citaId });

  const [tipo, setTipo] = useState<TipoProcedimiento | ''>('');
  const [pie, setPie] = useState<Pie | ''>('');
  const [ubicacion, setUbicacion] = useState('');
  const [detalle, setDetalle] = useState('');
  const [anestesia, setAnestesia] = useState('');
  const [laserLongitud, setLaserLongitud] = useState('');
  const [laserEnergia, setLaserEnergia] = useState('');
  const [laserDisparos, setLaserDisparos] = useState('');
  const [paqueteId, setPaqueteId] = useState('');
  const [sesionNumero, setSesionNumero] = useState('');
  useEffect(() => { limpiar(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [atencionId]);
  const limpiar = () => { setTipo(''); setPie(''); setUbicacion(''); setDetalle(''); setAnestesia(''); setLaserLongitud(''); setLaserEnergia(''); setLaserDisparos(''); setPaqueteId(''); setSesionNumero(''); };

  const { data: paquetes = [] } = useQuery({
    queryKey: ['paquetes-laser', pacienteId], queryFn: () => historiaClinicaApi.paquetesLaser(pacienteId!),
    enabled: !!pacienteId && puedeRegistrar, staleTime: 300_000,
  });
  const elegirPaquete = (id: string) => {
    setPaqueteId(id);
    const q = paquetes.find((x) => x.id === id);
    if (q) setSesionNumero(String(Math.min(q.sesionesUsadas + 1, q.sesionesTotal)));
  };

  const esLaser = tipo === 'laser';
  const puedeGuardar = puedeRegistrar && !!tipo && atencion?.estado !== 'cerrada';
  const agregarMut = useMutation({
    mutationFn: () => {
      const parametros = esLaser && (laserLongitud || laserEnergia || laserDisparos)
        ? { longitudOnda: laserLongitud || undefined, energia: laserEnergia || undefined, disparos: laserDisparos || undefined }
        : null;
      return historiaClinicaApi.agregarProcedimiento(atencionId!, {
        tipo: tipo as TipoProcedimiento, pie: pie || null, ubicacion: ubicacion.trim() || null, detalle: detalle.trim() || null,
        anestesia: anestesia.trim() || null, parametros, paquetePacienteId: esLaser && paqueteId ? paqueteId : null,
        sesionNumero: sesionNumero ? Number(sesionNumero) : null,
      });
    },
    onSuccess: () => { inval(); limpiar(); toast.success('Procedimiento registrado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarProcedimiento(id),
    onSuccess: () => { inval(); toast.success('Procedimiento eliminado'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    procedimientos: atencion?.procedimientos ?? [], cerrada: atencion?.estado === 'cerrada',
    tipo, setTipo, pie, setPie, ubicacion, setUbicacion, detalle, setDetalle, anestesia, setAnestesia,
    laserLongitud, setLaserLongitud, laserEnergia, setLaserEnergia, laserDisparos, setLaserDisparos,
    esLaser, paquetes, paqueteId, elegirPaquete, sesionNumero, setSesionNumero,
    puedeGuardar, agregarMut, eliminarMut,
  };
}

// ─── Bloque 3 · Escalas clínicas (2.1 EVA · 2.2 Wagner/Texas · 2.3 IWGDF · 2.5 monofilamento) ──
const MF_PUNTOS = 6; // sitios plantares por pie (hallux, 1º/3º/5º metatarsiano, mediopié, talón)
export const MF_ETIQUETAS = ['Hallux', '1er meta', '3er meta', '5º meta', 'Mediopié', 'Talón'];

/** Categoría de riesgo IWGDF 2019 a partir de los factores (misma regla que el backend). */
export function categoriaIwgdf(f: { psp: boolean; eap: boolean; deformidad: boolean; ulceraPrevia: boolean; amputacion: boolean; erc: boolean }): 0 | 1 | 2 | 3 {
  const previa = f.ulceraPrevia || f.amputacion || f.erc;
  if ((f.psp || f.eap) && previa) return 3;
  if ((f.psp && f.eap) || (f.psp && f.deformidad) || (f.eap && f.deformidad)) return 2;
  if (f.psp || f.eap) return 1;
  return 0;
}
export const IWGDF_CONTROL = ['control anual', 'control cada 6 a 12 meses', 'control cada 3 a 6 meses', 'control cada 1 a 3 meses'];

export function useEscalas(atencion: AtencionCompleta | null, puedeRegistrar: boolean) {
  const invalidar = useInvalidarHistoriaClinica();
  const atencionId = atencion?.id;
  const inval = () => invalidar({ pacienteId: atencion?.pacienteId, atencionId, citaId: atencion?.citaId });
  const escalas = atencion?.escalas ?? [];
  const pacienteId = atencion?.pacienteId;
  // Historial del paciente: monofilamento de la visita anterior (comparar sitio a sitio) y mediciones de úlceras (curva).
  const { data: mfHist = [] } = useQuery({ queryKey: ['escalas-paciente', pacienteId, 'monofilamento'], queryFn: () => historiaClinicaApi.escalasPaciente(pacienteId!, 'monofilamento'), enabled: !!pacienteId, staleTime: 60_000 });
  const { data: ulceraHist = [] } = useQuery({ queryKey: ['escalas-paciente', pacienteId, 'ulcera'], queryFn: () => historiaClinicaApi.escalasPaciente(pacienteId!, 'ulcera'), enabled: !!pacienteId, staleTime: 60_000 });
  const mfAnteriorRow = [...mfHist].reverse().find((x) => x.atencionId !== atencionId && (!atencion || x.fecha <= atencion.fecha));
  const mfAnterior = mfAnteriorRow
    ? { fecha: mfAnteriorRow.fecha, izquierdo: (mfAnteriorRow.datos.izquierdo as boolean[] | undefined) ?? [], derecho: (mfAnteriorRow.datos.derecho as boolean[] | undefined) ?? [] }
    : null;
  const seriesUlcera = useMemo(() => {
    const grupos = new Map<string, { nombre: string; puntos: { fecha: string; area: number; largo: number; ancho: number; atencionId: string }[] }>();
    for (const u of ulceraHist) {
      const d = u.datos as Record<string, unknown>;
      const l = Number(d.largo), a = Number(d.ancho);
      if (!Number.isFinite(l) || !Number.isFinite(a)) continue;
      const nombre = [typeof d.pie === 'string' && d.pie ? PIE_LABEL[d.pie as Pie] : null, typeof d.ubicacion === 'string' && d.ubicacion ? d.ubicacion : null].filter(Boolean).join(' · ') || 'Úlcera';
      if (!grupos.has(nombre)) grupos.set(nombre, { nombre, puntos: [] });
      grupos.get(nombre)!.puntos.push({ fecha: u.fecha.slice(0, 10), area: Math.round(l * a * 10) / 10, largo: l, ancho: a, atencionId: u.atencionId });
    }
    return [...grupos.values()];
  }, [ulceraHist]);

  const [tipo, setTipoRaw] = useState<TipoEscala | ''>('');
  const [eva, setEva] = useState(5);
  const [wagner, setWagner] = useState(0);
  // Texas: el ESTADIO se calcula desde los hallazgos (infección / isquemia); el grado es la profundidad.
  const [texasGrado, setTexasGrado] = useState(0);
  const [texasInfeccion, setTexasInfeccion] = useState(false);
  const [texasIsquemia, setTexasIsquemia] = useState(false);
  const texasEstadio: 'A' | 'B' | 'C' | 'D' = texasInfeccion && texasIsquemia ? 'D' : texasIsquemia ? 'C' : texasInfeccion ? 'B' : 'A';
  // IWGDF: la CATEGORÍA se calcula desde los factores; la PSP se sugiere desde el monofilamento de hoy.
  const [iwgdfF, setIwgdfF] = useState({ psp: false, eap: false, deformidad: false, ulceraPrevia: false, amputacion: false, erc: false });
  const setFactorIwgdf = (k: keyof typeof iwgdfF, v: boolean) => setIwgdfF((prev) => ({ ...prev, [k]: v }));
  const iwgdf = categoriaIwgdf(iwgdfF);
  const mfHoy = escalas.find((x) => x.tipo === 'monofilamento');
  const pspSugerida = !!mfHoy && [mfHoy.datos.izquierdo, mfHoy.datos.derecho].some((l) => Array.isArray(l) && l.some((v) => v === false));
  const [mfIzq, setMfIzq] = useState<boolean[]>(() => Array(MF_PUNTOS).fill(true));
  const [mfDer, setMfDer] = useState<boolean[]>(() => Array(MF_PUNTOS).fill(true));
  // Termometría: temperatura por sitio (°C) en ambos pies; se compara sitio a sitio.
  const [tempIzq, setTempIzq] = useState<string[]>(() => Array(MF_PUNTOS).fill(''));
  const [tempDer, setTempDer] = useState<string[]>(() => Array(MF_PUNTOS).fill(''));
  const setTemp = (lado: 'izq' | 'der', i: number, v: string) => (lado === 'izq' ? setTempIzq : setTempDer)((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  const pares = tempIzq.map((a, i) => [Number(a), Number(tempDer[i])] as const).filter(([a, b], i) => tempIzq[i] !== '' && tempDer[i] !== '' && Number.isFinite(a) && Number.isFinite(b));
  const termoDeltaMax = pares.length ? Math.max(...pares.map(([a, b]) => Math.abs(a - b))) : null;
  // Medición de úlceras: largo × ancho (cm) → área; se compara con la medición anterior de la misma ubicación.
  const [ulLargo, setUlLargo] = useState('');
  const [ulAncho, setUlAncho] = useState('');
  const [ulProf, setUlProf] = useState('');
  const [ulPie, setUlPie] = useState<'izquierdo' | 'derecho' | ''>('');
  const [ulUbicacion, setUlUbicacion] = useState('');
  const ulArea = ulLargo !== '' && ulAncho !== '' && Number.isFinite(Number(ulLargo)) && Number.isFinite(Number(ulAncho)) ? Math.round(Number(ulLargo) * Number(ulAncho) * 10) / 10 : null;
  const ulNombre = [ulPie ? PIE_LABEL[ulPie] : null, ulUbicacion.trim() || null].filter(Boolean).join(' · ') || 'Úlcera';
  const ulSerie = seriesUlcera.find((x) => x.nombre === ulNombre);
  const ulAnterior = ulSerie ? [...ulSerie.puntos].reverse().find((x) => x.atencionId !== atencionId) ?? null : null;

  useEffect(() => { limpiar(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [atencionId]);
  const limpiar = () => {
    setTipoRaw(''); setEva(5); setWagner(0); setTexasGrado(0); setTexasInfeccion(false); setTexasIsquemia(false);
    setIwgdfF({ psp: false, eap: false, deformidad: false, ulceraPrevia: false, amputacion: false, erc: false });
    setMfIzq(Array(MF_PUNTOS).fill(true)); setMfDer(Array(MF_PUNTOS).fill(true)); setTempIzq(Array(MF_PUNTOS).fill('')); setTempDer(Array(MF_PUNTOS).fill(''));
    setUlLargo(''); setUlAncho(''); setUlProf(''); setUlPie(''); setUlUbicacion('');
  };
  const setTipo = (t: TipoEscala | '') => { setTipoRaw(t); if (t === 'iwgdf') setIwgdfF((prev) => ({ ...prev, psp: pspSugerida })); };
  const toggleMf = (lado: 'izq' | 'der', i: number) => {
    const set = lado === 'izq' ? setMfIzq : setMfDer;
    set((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  };

  const datos = (): Record<string, unknown> => {
    switch (tipo) {
      case 'eva': return { valor: eva };
      case 'wagner': return { grado: wagner };
      case 'texas': return { grado: texasGrado, estadio: texasEstadio, infeccion: texasInfeccion, isquemia: texasIsquemia };
      case 'iwgdf': return { categoria: iwgdf, ...iwgdfF };
      case 'monofilamento': return { izquierdo: mfIzq, derecho: mfDer };
      case 'termometria': return { izquierdo: tempIzq.map((v) => (v === '' ? null : Number(v))), derecho: tempDer.map((v) => (v === '' ? null : Number(v))) };
      case 'ulcera': return { largo: Number(ulLargo), ancho: Number(ulAncho), profundidad: ulProf === '' ? null : Number(ulProf), pie: ulPie || null, ubicacion: ulUbicacion.trim() || null };
      default: return {};
    }
  };
  const puedeGuardar = puedeRegistrar && !!tipo && atencion?.estado !== 'cerrada' && (tipo !== 'termometria' || pares.length > 0) && (tipo !== 'ulcera' || ulArea != null);
  const guardarMut = useMutation({
    mutationFn: () => historiaClinicaApi.guardarEscala(atencionId!, { tipo: tipo as TipoEscala, datos: datos(), pie: tipo === 'ulcera' && ulPie ? ulPie : undefined }),
    onSuccess: () => { inval(); limpiar(); toast.success('Escala registrada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarEscala(id),
    onSuccess: () => { inval(); toast.success('Escala eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    escalas, cerrada: atencion?.estado === 'cerrada',
    tipo, setTipo, eva, setEva, wagner, setWagner,
    texasGrado, setTexasGrado, texasInfeccion, setTexasInfeccion, texasIsquemia, setTexasIsquemia, texasEstadio,
    iwgdf, iwgdfF, setFactorIwgdf, pspSugerida,
    mfIzq, mfDer, toggleMf,
    tempIzq, tempDer, setTemp, termoDeltaMax,
    mfAnterior, seriesUlcera, ulLargo, setUlLargo, ulAncho, setUlAncho, ulProf, setUlProf, ulPie, setUlPie, ulUbicacion, setUlUbicacion, ulArea, ulAnterior,
    puedeGuardar, guardarMut, eliminarMut,
  };
}

// ─── Bloque 3 · Podograma (1.3 mapa interactivo + 1.3b imagen de la Baro con anotaciones) ──
export type HerramientaPodograma = 'mover' | 'lapiz' | 'texto' | 'borrador';
// En pantallas táctiles (tablet) el editor arranca en "mover": el primer gesto desplaza la página
// en vez de dejar un trazo por accidente; se toca "Lápiz" cuando se quiere dibujar.
const herramientaInicial = (): HerramientaPodograma =>
  (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'mover' : 'lapiz');
type AnotacionPodograma = AtencionCompleta['imagenesPodograma'][number]['anotaciones'][number];
const MAX_IMAGEN_BYTES = 10 * 1024 * 1024;

/** Índice de la anotación que está bajo (x,y) en coordenadas 0..1; la última dibujada gana. */
function indiceAnotacionEn(lista: AnotacionPodograma[], x: number, y: number): number {
  for (let i = lista.length - 1; i >= 0; i--) {
    const a = lista[i];
    if (a.tipo === 'texto') {
      if (x >= a.x - 0.01 && x <= a.x + 0.12 && y >= a.y - 0.035 && y <= a.y + 0.012) return i;
    } else {
      const tol = 0.012 + a.grosor / 2000;
      if (a.puntos.some(([px, py]) => Math.hypot(px - x, py - y) <= tol)) return i;
    }
  }
  return -1;
}

export function usePodograma(atencion: AtencionCompleta | null, puedeRegistrar: boolean) {
  const invalidar = useInvalidarHistoriaClinica();
  const atencionId = atencion?.id;
  const inval = () => invalidar({ pacienteId: atencion?.pacienteId, atencionId, citaId: atencion?.citaId });
  const cerrada = atencion?.estado === 'cerrada';
  const puedeEditar = puedeRegistrar && !cerrada;

  // ── Silueta + marcas tipificadas (cuando no hay imagen de la Baro) ──
  const [pendiente, setPendiente] = useState<{ pie: PiePodograma; x: number; y: number } | null>(null);
  const [tipoLesion, setTipoLesion] = useState<TipoLesion>('hiperqueratosis');
  const [nota, setNota] = useState('');
  const marcarPunto = (pie: PiePodograma, x: number, y: number) => { if (!puedeEditar) return; setPendiente({ pie, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }); };
  const cancelar = () => { setPendiente(null); setNota(''); };
  const agregarMut = useMutation({
    mutationFn: () => historiaClinicaApi.agregarMarca(atencionId!, { pie: pendiente!.pie, x: pendiente!.x, y: pendiente!.y, tipoLesion, nota: nota.trim() || null }),
    onSuccess: () => { inval(); setPendiente(null); setNota(''); toast.success('Marca agregada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarMarca(id),
    onSuccess: () => { inval(); toast.success('Marca eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Imágenes de la Baro: 4 vistas fijas (frontal/posterior × izq/der) + sueltas por compatibilidad ──
  const imagenes = atencion?.imagenesPodograma ?? [];
  const porVista = Object.fromEntries(VISTAS_PODOGRAMA.map((v) => [v, imagenes.find((i) => i.vista === v)])) as Record<VistaPodograma, ImagenPodograma | undefined>;
  const otras = imagenes.filter((i) => !i.vista);
  const [imagenSelId, setImagenSelId] = useState<string | null>(null);
  const [verSilueta, setVerSilueta] = useState(false);
  const primera = VISTAS_PODOGRAMA.map((v) => porVista[v]).find(Boolean) ?? otras[0] ?? null;
  const imagenSel = imagenes.find((i) => i.id === imagenSelId) ?? primera;
  const imagenSelIdReal = imagenSel?.id ?? null;
  useEffect(() => { setImagenSelId(null); setVerSilueta(false); setPendiente(null); setNota(''); }, [atencionId]);

  // Blob autenticado → object URL (se revoca al cambiar de imagen o desmontar).
  const [urlImagen, setUrlImagen] = useState<string | null>(null);
  const [cargandoImagen, setCargandoImagen] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let cancelado = false;
    setUrlImagen(null);
    if (!imagenSelIdReal) return;
    setCargandoImagen(true);
    historiaClinicaApi.blobImagenPodograma(imagenSelIdReal)
      .then((b) => { if (cancelado) return; url = URL.createObjectURL(b); setUrlImagen(url); })
      .catch((e: Error) => { if (!cancelado) toast.error(e.message); })
      .finally(() => { if (!cancelado) setCargandoImagen(false); });
    return () => { cancelado = true; if (url) URL.revokeObjectURL(url); };
  }, [imagenSelIdReal]);

  // ── Editor de anotaciones (capa vectorial local hasta "Guardar") ──
  const [herramienta, setHerramienta] = useState<HerramientaPodograma>(herramientaInicial);
  const [color, setColor] = useState('#ef4444');
  const [grosor, setGrosor] = useState(4);
  const [anotaciones, setAnotaciones] = useState<AnotacionPodograma[]>([]);
  const [guardadas, setGuardadas] = useState<AnotacionPodograma[]>([]);
  useEffect(() => { const a = imagenSel?.anotaciones ?? []; setAnotaciones(a); setGuardadas(a); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [imagenSelIdReal]);
  const sucio = anotaciones !== guardadas;
  const agregarAnotacion = (a: AnotacionPodograma) => { if (puedeEditar) setAnotaciones((prev) => [...prev, a]); };
  const borrarEn = (x: number, y: number) => { if (!puedeEditar) return; setAnotaciones((prev) => { const i = indiceAnotacionEn(prev, x, y); return i < 0 ? prev : prev.filter((_, k) => k !== i); }); };
  const deshacer = () => setAnotaciones((prev) => (prev.length ? prev.slice(0, -1) : prev));
  const limpiarAnotaciones = () => setAnotaciones((prev) => (prev.length ? [] : prev));
  const descartar = () => setAnotaciones(guardadas);
  const guardarAnotacionesMut = useMutation({
    mutationFn: (a: AnotacionPodograma[]) => historiaClinicaApi.guardarAnotacionesPodograma(imagenSel!.id, a),
    onSuccess: (_d, a) => { setGuardadas(a); setAnotaciones(a); inval(); toast.success('Anotaciones guardadas'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const guardarAnotaciones = () => { if (imagenSel && sucio) guardarAnotacionesMut.mutate(anotaciones); };

  // ── Subir / eliminar imagen ──
  const subirMut = useMutation({
    mutationFn: (v: { archivo: File; vista: VistaPodograma | null }) => historiaClinicaApi.subirImagenPodograma(atencionId!, v.archivo, { vista: v.vista }),
    onSuccess: (a, v) => {
      inval();
      const nueva = v.vista ? a.imagenesPodograma?.find((i) => i.vista === v.vista) : a.imagenesPodograma?.[a.imagenesPodograma.length - 1];
      if (nueva) setImagenSelId(nueva.id);
      setVerSilueta(false);
      toast.success(v.vista ? `${VISTA_PODOGRAMA_LABEL[v.vista]}: imagen cargada` : 'Podograma cargado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  /** Sube (o reemplaza) la imagen de una vista. Sin vista = imagen suelta. */
  const subirArchivo = (f: File | null | undefined, vista: VistaPodograma | null = null) => {
    if (!f || !puedeEditar) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast.error('Solo se aceptan imágenes JPG, PNG o WEBP'); return; }
    if (f.size > MAX_IMAGEN_BYTES) { toast.error('La imagen supera los 10 MB'); return; }
    subirMut.mutate({ archivo: f, vista });
  };
  const eliminarImagenMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarImagenPodograma(id),
    onSuccess: () => { inval(); setImagenSelId(null); toast.success('Imagen eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    cerrada, puedeEditar,
    // silueta
    marcas: atencion?.marcasPodograma ?? [], pendiente, marcarPunto, cancelar, tipoLesion, setTipoLesion, nota, setNota, agregarMut, eliminarMut,
    // imágenes
    imagenes, porVista, otras, imagenSel, setImagenSelId, verSilueta, setVerSilueta, urlImagen, cargandoImagen, subirArchivo, subirMut, eliminarImagenMut,
    // editor
    herramienta, setHerramienta, color, setColor, grosor, setGrosor, anotaciones, sucio,
    agregarAnotacion, borrarEn, deshacer, limpiarAnotaciones, descartar, guardarAnotaciones, guardarAnotacionesMut,
  };
}

// ─── Bandeja del día (ronda del médico) ──────────────────────────────────────
export function useBandejaPage() {
  const navigate = useNavigate();
  const invalidar = useInvalidarHistoriaClinica();
  const [dias, setDias] = useState(45);
  const q = useQuery({ queryKey: ['hc-bandeja', dias], queryFn: () => historiaClinicaApi.bandeja(dias), staleTime: 60_000 });
  const cerrarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.cerrarAtencion(id),
    onSuccess: (a) => { invalidar({ pacienteId: a.pacienteId, atencionId: a.id, citaId: a.citaId }); void q.refetch(); toast.success('Atención cerrada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [cerrandoTodas, setCerrandoTodas] = useState(false);
  /** Cierre en lote (firma en lote de la ronda): una por una, sin frenar por un error puntual. */
  const cerrarTodas = async (ids: string[]) => {
    setCerrandoTodas(true);
    let ok = 0;
    for (const id of ids) {
      try { await historiaClinicaApi.cerrarAtencion(id); ok++; } catch (e) { toast.error((e as Error).message); }
    }
    setCerrandoTodas(false);
    void q.refetch();
    toast.success(`${ok} atención(es) cerrada(s)`);
  };
  const abrir = (a: { paciente: { id: string }; citaId: string }) => navigate(`/historia-clinica/${a.paciente.id}?cita=${a.citaId}`);
  const abrirPaciente = (pacienteId: string) => navigate(`/historia-clinica/${pacienteId}`);
  return { dias, setDias, bandeja: q.data, cargando: q.isLoading, error: q.error as Error | null, cerrarMut, cerrarTodas, cerrandoTodas, abrir, abrirPaciente, refrescar: () => void q.refetch() };
}

// ─── 1.8 · Fotos clínicas por atención + 1.9 antes/después por paciente ──────
type FotoClinica = AtencionCompleta['fotos'][number];
type FotoPaciente = Awaited<ReturnType<typeof historiaClinicaApi.fotosDePaciente>>[number];
const MAX_FOTO_BYTES = 15 * 1024 * 1024;

/** URL (blob autenticado) de una foto clínica, cacheada por id. */
export function useFotoUrl(fotoId: string | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['foto-clinica-url', fotoId],
    queryFn: async () => URL.createObjectURL(await historiaClinicaApi.blobFoto(fotoId!)),
    enabled: !!fotoId, staleTime: Infinity, gcTime: 10 * 60_000,
  });
  return { url: data ?? null, cargando: isLoading };
}

export function useFotosClinicas(atencion: AtencionCompleta | null, puedeRegistrar: boolean) {
  const invalidar = useInvalidarHistoriaClinica();
  const atencionId = atencion?.id;
  const pacienteId = atencion?.pacienteId;
  const inval = () => invalidar({ pacienteId, atencionId, citaId: atencion?.citaId });
  const cerrada = atencion?.estado === 'cerrada';
  const puedeEditar = puedeRegistrar && !cerrada;
  const fotos = atencion?.fotos ?? [];

  // Formulario de subida (un useState por campo). La foto viene de la cámara o de la galería.
  const [pie, setPie] = useState<Pie | ''>('');
  const [zona, setZona] = useState('');
  const [categoria, setCategoria] = useState<FotoClinica['categoria']>('lesion');
  const [descripcion, setDescripcion] = useState('');
  useEffect(() => { setPie(''); setZona(''); setCategoria('lesion'); setDescripcion(''); }, [atencionId]);

  const subirMut = useMutation({
    mutationFn: (archivo: File) => historiaClinicaApi.subirFoto(atencionId!, archivo, { pie: pie || null, zona: zona || null, categoria, descripcion: descripcion || null, tomadaEn: new Date(archivo.lastModified || Date.now()).toISOString() }),
    onSuccess: () => { inval(); setDescripcion(''); toast.success('Foto guardada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const subirArchivo = (f: File | null | undefined) => {
    if (!f || !puedeEditar) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast.error('Solo se aceptan fotos JPG, PNG o WEBP'); return; }
    if (f.size > MAX_FOTO_BYTES) { toast.error('La foto supera los 15 MB'); return; }
    subirMut.mutate(f);
  };
  const eliminarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarFoto(id),
    onSuccess: () => { inval(); toast.success('Foto eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const editarMut = useMutation({
    mutationFn: (p: { id: string; campos: { zona?: string | null; pie?: Pie | null; descripcion?: string | null } }) => historiaClinicaApi.editarFoto(p.id, p.campos),
    onSuccess: () => inval(),
    onError: (e: Error) => toast.error(e.message),
  });

  // Antes / después: todas las fotos del paciente; se elige zona y dos fotos (por defecto primera y última).
  const { data: todas = [] } = useQuery({ queryKey: ['fotos-paciente', pacienteId], queryFn: () => historiaClinicaApi.fotosDePaciente(pacienteId!), enabled: !!pacienteId, staleTime: 60_000 });
  const zonas = [...new Set(todas.map((f) => (f.zona ?? '').trim()).filter(Boolean))];
  const [zonaComparar, setZonaComparar] = useState<string>('');
  const enZona: FotoPaciente[] = todas.filter((f) => !zonaComparar || (f.zona ?? '').trim().toLowerCase() === zonaComparar.toLowerCase());
  const [antesId, setAntesId] = useState<string | null>(null);
  const [despuesId, setDespuesId] = useState<string | null>(null);
  const antes = enZona.find((f) => f.id === antesId) ?? enZona[0] ?? null;
  const despues = enZona.find((f) => f.id === despuesId) ?? (enZona.length > 1 ? enZona[enZona.length - 1] : null);
  const elegirZona = (z: string) => { setZonaComparar(z); setAntesId(null); setDespuesId(null); };

  return {
    fotos, cerrada, puedeEditar,
    pie, setPie, zona, setZona, categoria, setCategoria, descripcion, setDescripcion, subirArchivo, subirMut, eliminarMut, editarMut,
    todas, zonas, zonaComparar, elegirZona, enZona, antes, despues, setAntesId, setDespuesId,
  };
}

/** Miniatura de una imagen del podograma: blob autenticado → object URL (cacheado por id). */
export function useMiniaturaPodograma(imagenId: string | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['podograma-miniatura', imagenId],
    queryFn: async () => URL.createObjectURL(await historiaClinicaApi.blobImagenPodograma(imagenId!)),
    enabled: !!imagenId, staleTime: Infinity, gcTime: 10 * 60_000,
  });
  return { url: data ?? null, cargando: isLoading };
}

export type { AtencionClinica };

// ─── Plantillas y autotextos (1.1 / 1.2): gestión ────────────────────────────
export function usePlantillasAdmin() {
  const qc = useQueryClient();
  const { data: plantillas = [], isLoading: cargando } = usePlantillas();
  const [editando, setEditando] = useState<string | null>(null); // id de la plantilla o 'nueva'
  const [tipo, setTipo] = useState<TipoPlantilla>('nota');
  const [clave, setClave] = useState('');
  const [nombre, setNombre] = useState('');
  const [subjetivo, setSubjetivo] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [apreciacion, setApreciacion] = useState('');
  const [plan, setPlan] = useState('');
  const [texto, setTexto] = useState('');
  const limpiar = () => { setClave(''); setNombre(''); setSubjetivo(''); setObjetivo(''); setApreciacion(''); setPlan(''); setTexto(''); };
  const nueva = (t: TipoPlantilla) => { limpiar(); setTipo(t); setEditando('nueva'); };
  const cargar = (p: PlantillaClinica) => {
    limpiar(); setTipo(p.tipo); setEditando(p.id); setClave(p.clave ?? ''); setNombre(p.nombre);
    if (p.tipo === 'nota') { setSubjetivo(p.contenido.subjetivo ?? ''); setObjetivo(p.contenido.objetivo ?? ''); setApreciacion(p.contenido.apreciacion ?? ''); setPlan(p.contenido.plan ?? ''); }
    else setTexto(p.contenido.texto ?? '');
  };
  const cancelar = () => { limpiar(); setEditando(null); };
  const contenido = (): Record<string, string> => (tipo === 'nota' ? { subjetivo, objetivo, apreciacion, plan } : { texto });
  const puedeGuardar = nombre.trim().length >= 2 && (tipo === 'nota' ? [subjetivo, objetivo, apreciacion, plan].some((x) => x.trim()) : !!clave.trim() && !!texto.trim());
  const invalidar = () => qc.invalidateQueries({ queryKey: ['plantillas'] });
  const guardarMut = useMutation({
    mutationFn: () => {
      const data = { tipo, clave: clave.trim() || null, nombre: nombre.trim(), contenido: contenido() };
      return editando && editando !== 'nueva' ? historiaClinicaApi.editarPlantilla(editando, data) : historiaClinicaApi.crearPlantilla(data);
    },
    onSuccess: () => { invalidar(); toast.success(editando === 'nueva' ? 'Plantilla creada' : 'Plantilla actualizada'); cancelar(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarPlantilla(id),
    onSuccess: (_r, id) => { invalidar(); toast.success('Plantilla eliminada'); if (editando === id) cancelar(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return {
    plantillas, cargando, editando, tipo, clave, setClave, nombre, setNombre, subjetivo, setSubjetivo, objetivo, setObjetivo, apreciacion, setApreciacion, plan, setPlan, texto, setTexto,
    nueva, cargar, cancelar, puedeGuardar, guardarMut, eliminarMut,
  };
}
