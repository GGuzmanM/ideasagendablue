// Historia clínica — LÓGICA (hooks). Las vistas (.tsx) son puras y consumen estos hooks.
// Un useState por campo, `puedeGuardar` derivado, useMutation → invalidar + toast (patrón de la casa).
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
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
} from '../api/historiaClinica';
import { recetasApi, verRecetaPdf, imprimirReceta, type ItemEntrada, type TipoDocumentoReceta, type RecetaCompleta, type TipoItemReceta } from '../api/recetas';
import type { Cie10Item, MedicamentoItem } from '../api/catalogos';

export type TabHc = 'evolucion' | 'receta' | 'antecedentes' | 'procedimientos' | 'escalas' | 'podograma' | 'consentimientos';
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

  return {
    editando, tipo, setTipo, subjetivo, setSubjetivo, objetivo, setObjetivo, apreciacion, setApreciacion, plan, setPlan, texto, setTexto,
    profesionalId, setProfesionalId, cargarNota, limpiarNota, puedeGuardarNota, guardarNotaMut, eliminarNotaMut, traerUltimaNota, tieneNotaAnterior: !!anteriores?.nota,
    dxSel, setDxSel, dxTipo, setDxTipo, dxPrincipal, setDxPrincipal, dxObs, setDxObs, agregarDxMut, editarDxMut, eliminarDxMut, copiarDxAnteriores, tieneDxAnteriores: !!anteriores?.diagnosticos,
    cerrada,
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

export function useEscalas(atencion: AtencionCompleta | null, puedeRegistrar: boolean) {
  const invalidar = useInvalidarHistoriaClinica();
  const atencionId = atencion?.id;
  const inval = () => invalidar({ pacienteId: atencion?.pacienteId, atencionId, citaId: atencion?.citaId });

  const [tipo, setTipo] = useState<TipoEscala | ''>('');
  const [eva, setEva] = useState(5);
  const [wagner, setWagner] = useState(0);
  const [texasGrado, setTexasGrado] = useState(0);
  const [texasEstadio, setTexasEstadio] = useState<'A' | 'B' | 'C' | 'D'>('A');
  const [iwgdf, setIwgdf] = useState(0);
  const [mfIzq, setMfIzq] = useState<boolean[]>(() => Array(MF_PUNTOS).fill(true));
  const [mfDer, setMfDer] = useState<boolean[]>(() => Array(MF_PUNTOS).fill(true));
  useEffect(() => { limpiar(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [atencionId]);
  const limpiar = () => { setTipo(''); setEva(5); setWagner(0); setTexasGrado(0); setTexasEstadio('A'); setIwgdf(0); setMfIzq(Array(MF_PUNTOS).fill(true)); setMfDer(Array(MF_PUNTOS).fill(true)); };
  const toggleMf = (lado: 'izq' | 'der', i: number) => {
    const set = lado === 'izq' ? setMfIzq : setMfDer;
    set((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  };

  const datos = (): Record<string, unknown> => {
    switch (tipo) {
      case 'eva': return { valor: eva };
      case 'wagner': return { grado: wagner };
      case 'texas': return { grado: texasGrado, estadio: texasEstadio };
      case 'iwgdf': return { categoria: iwgdf };
      case 'monofilamento': return { izquierdo: mfIzq, derecho: mfDer };
      default: return {};
    }
  };
  const puedeGuardar = puedeRegistrar && !!tipo && atencion?.estado !== 'cerrada';
  const guardarMut = useMutation({
    mutationFn: () => historiaClinicaApi.guardarEscala(atencionId!, { tipo: tipo as TipoEscala, datos: datos() }),
    onSuccess: () => { inval(); limpiar(); toast.success('Escala registrada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarEscala(id),
    onSuccess: () => { inval(); toast.success('Escala eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    escalas: atencion?.escalas ?? [], cerrada: atencion?.estado === 'cerrada',
    tipo, setTipo, eva, setEva, wagner, setWagner, texasGrado, setTexasGrado, texasEstadio, setTexasEstadio, iwgdf, setIwgdf,
    mfIzq, mfDer, toggleMf, puedeGuardar, guardarMut, eliminarMut,
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
