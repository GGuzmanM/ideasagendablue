// Historia clínica — LÓGICA (hooks). Las vistas (.tsx) son puras y consumen estos hooks.
// Un useState por campo, `puedeGuardar` derivado, useMutation → invalidar + toast (patrón de la casa).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { miFirmaApi } from '../api/miFirma';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { pacientesApi, profesionalesApi, serviciosApi, historialGenexisApi, type Profesional, type HistorialGenexisRegistro } from '../api';
import { citasApi, type CitaResumen } from '../api/citas';
import {
  historiaClinicaApi, useHistoriaClinica, useAtencionClinica, useInvalidarHistoriaClinica,
  type AtencionClinica, type AtencionCompleta, type CamposNota, type TipoNota, type TipoDiagnostico,
  type TipoAntecedente, type SeveridadAlergia, type NotaEvolucion, type DiagnosticoAtencion,
  type TipoProcedimiento, type TipoEscala, type TipoLesion, type Pie, type PiePodograma,
  type VistaPodograma, type ImagenPodograma, VISTAS_PODOGRAMA, VISTA_PODOGRAMA_LABEL,
  usePlantillas, TIPO_LESION_LABEL, PIE_LABEL, type PlantillaClinica, type TipoPlantilla, type CamposMarca, type VistaSilueta, atencionKey, COLOR_LESION, useHistorialPodograma,
  type ControlEntrada,
} from '../api/historiaClinica';
import { recetasApi, verRecetaPdf, imprimirReceta, useRecetasPaciente, favoritasKey, type ItemEntrada, type TipoDocumentoReceta, type RecetaCompleta, type TipoItemReceta } from '../api/recetas';
import type { Cie10Item, MedicamentoItem } from '../api/catalogos';
import { useDictado, anexarDictado } from '../hooks/useDictado';
import { useDictadoConsulta } from '../hooks/useDictadoConsulta';
import {
  adivinarTipoProcedimiento, repartirTranscripcion, anexarDictado as unirTexto, CAMPOS_PROPUESTA,
  type DiagnosticoDictado, type LesionDictada, type PropuestaDictado, type CampoPropuesta,
} from '../utils/dictadoEstructurado';
import { coordZona, zonaMasCercana, ZONAS_PIE } from '../utils/zonasPie';
import {
  ITB_VACIO, PULSOS_VACIOS, CALZADO_VACIO, itbPie, numOrNull, puntajeOsi, combinarLado, eapDeItb, examenSugiereDeformidad, manchesterSugiereDeformidad,
  type CamposItb, type PulsosPie, type EstadoPulso, type CalzadoForm, type ZonaDesgaste,
} from '../utils/escalasPie';
import { eventosPorZona, resumenZonas, claveZona } from '../utils/historialZonas';
import { indiceTrazoEn } from '../utils/trazos';
import { useAutotextoStore } from '../stores/autotextoStore';
import { useFotosPendientesStore, usePendientesDe, useTotalPendientes, type FotoPendiente, type CamposPendiente } from '../stores/fotosPendientesStore';
import { useBorradoresStore, useMarcarBorrador, hayBorradores } from '../stores/borradoresStore';

export type TabHc = 'evolucion' | 'receta' | 'antecedentes' | 'procedimientos' | 'escalas' | 'podograma' | 'fotos' | 'consentimientos';
const ESTADOS_ATENDIDA = ['llego', 'en_atencion', 'completada'];
/** Un renglón de la línea de tiempo: atención nueva o visita del sistema anterior (Genexis). */
export type LineaTiempoItem =
  | { tipo: 'hc'; id: string; fecha: string; atencion: AtencionClinica }
  | { tipo: 'genexis'; id: string; fecha: string; visita: HistorialGenexisRegistro };

// Equipo (Baro): por el flag del servidor cuando viene; si no, por el nombre.
const esEquipoNombre = (p: { nombres: string; esEquipo?: boolean }) => p.esEquipo ?? /^baro\b/i.test(p.nombres.trim());
const ERROR_TIENE_409 = (e: unknown) => (e as { statusCode?: number })?.statusCode === 409;

// ─── Página de dos paneles ────────────────────────────────────────────────────
/**
 * Callback con identidad ESTABLE que siempre ve los valores frescos del render (patrón
 * «useEvent»): sirve para pasar funciones a hooks/efectos sin que cambien sus dependencias.
 */
function useCallbackRef<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

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
  const qc = useQueryClient();
  // Si la atención cambió en otra tablet (p. ej. la cerraron), el servidor responde 409: se recarga sola.
  const refrescarSi409 = (e: Error) => { if (ERROR_TIENE_409(e) && atencionSel) void qc.invalidateQueries({ queryKey: atencionKey(atencionSel) }); toast.error(e.message); };

  const [tab, setTab] = useState<TabHc>('evolucion');
  // La vista del podograma (planta / dorso) y su modo (punto, pintar, historial) viven AQUÍ y no en el
  // panel: al cambiar de atención el panel se desmonta un instante mientras carga (esqueleto), y si el
  // estado viviera ahí se volvería a la planta cada vez. Así, si estás mirando el dorso de una visita y
  // tocas otra, sigues en el dorso (pedido del doctor, 17-sep-2026).
  const [vistaSilueta, setVistaSilueta] = useState<VistaSilueta>('plantar');
  const [modoSilueta, setModoSilueta] = useState<ModoSilueta>('punto');
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

  // Visitas del sistema anterior (Genexis, archivo de solo lectura): las que el paciente asistió, de a
  // 20, para la línea de tiempo unificada (4.3). Se mezclan con las atenciones nuevas por fecha.
  const [genexisSel, setGenexisSel] = useState<string | null>(null);
  const genexisQ = useInfiniteQuery({
    queryKey: ['historial-genexis-hc', pacienteId],
    queryFn: ({ pageParam }) => historialGenexisApi.listar(pacienteId!, { llego: 'si', page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.page * ultima.limit < ultima.total ? ultima.page + 1 : undefined),
    enabled: !!pacienteId,
    staleTime: 5 * 60_000, // el archivo no cambia
  });
  const genexisVisitas = useMemo(() => genexisQ.data?.pages.flatMap((p) => p.data) ?? [], [genexisQ.data]);
  const genexisTotal = genexisQ.data?.pages[0]?.total ?? 0;
  const visitaGenexis = genexisSel ? genexisVisitas.find((v) => v.id === genexisSel) ?? null : null;
  /** Atenciones nuevas y visitas del sistema anterior en una sola lista, de la más reciente a la más antigua. */
  const lineaTiempo = useMemo(() => {
    const items: LineaTiempoItem[] = [
      ...(historia?.atenciones ?? []).map((a) => ({ tipo: 'hc' as const, id: a.id, fecha: a.fecha.slice(0, 10), atencion: a })),
      ...genexisVisitas.map((v) => ({ tipo: 'genexis' as const, id: v.id, fecha: v.fechaCita, visita: v })),
    ];
    return items.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }, [historia?.atenciones, genexisVisitas]);

  // Sin selección: la atención más reciente (si se está mirando una visita del sistema anterior, no).
  useEffect(() => {
    if (!atencionSel && !genexisSel && historia?.atenciones?.length) setAtencionSel(historia.atenciones[0]!.id);
  }, [historia?.atenciones, atencionSel, genexisSel]);

  // Cambiar de atención con un borrador sin guardar (nota dictada, escala a medias, dibujo…) lo perdería:
  // se pregunta antes. Las fotos «por guardar» se conservan (viven por atención), no cuentan aquí.
  const limpiarBorradores = useBorradoresStore((s) => s.limpiar);
  const confirmarCambio = () => {
    if (!hayBorradores()) return true;
    if (!window.confirm('Tienes cambios sin guardar en esta atención (nota, procedimiento, escala o dibujo). ¿Cambiar de atención igual? Se perderán.')) return false;
    limpiarBorradores();
    return true;
  };
  // Al cambiar de atención se MANTIENE la pestaña abierta (pedido del doctor, 17-sep-2026): si está
  // mirando el podograma de una visita y toca otra, sigue en el podograma; igual con la receta, las
  // fotos o cualquier otra. Antes volvía siempre a Evolución y había que navegar de nuevo. Las ocho
  // pestañas existen para toda atención, así que ninguna queda «huérfana» al cambiar.
  const seleccionarAtencion = (id: string) => { if ((id === atencionSel && !genexisSel) || !confirmarCambio()) return; setGenexisSel(null); setAtencionSel(id); };
  // Una visita del sistema anterior se mira en el panel derecho como tarjeta de solo lectura; la
  // pestaña se conserva para volver a ella al elegir de nuevo una atención del sistema actual.
  const seleccionarGenexis = (id: string) => { if (id === genexisSel || !confirmarCambio()) return; setGenexisSel(id); setAtencionSel(null); };

  const cerrarMut = useMutation({
    mutationFn: (controles: ControlEntrada[]) => historiaClinicaApi.cerrarAtencion(atencionSel!, controles),
    onSuccess: () => { invalidar({ pacienteId, atencionId: atencionSel! }); toast.success('Atención cerrada'); },
    onError: refrescarSi409,
  });
  const reabrirMut = useMutation({
    mutationFn: () => historiaClinicaApi.reabrirAtencion(atencionSel!),
    onSuccess: () => { invalidar({ pacienteId, atencionId: atencionSel! }); toast.success('Atención reabierta: ya puedes corregirla'); },
    onError: refrescarSi409,
  });
  // Reabrir: coordinación/administración siempre; el resto solo dentro de las 24 h del cierre (misma regla que el servidor).
  const HORAS_REABRIR = 24;
  const horasDesdeCierre = atencion?.cerradaEn ? (Date.now() - new Date(atencion.cerradaEn).getTime()) / 3_600_000 : null;
  const puedeReabrir = !!atencion && atencion.estado === 'cerrada' && (puedeAnular || (puedeRegistrar && horasDesdeCierre != null && horasDesdeCierre <= HORAS_REABRIR));

  const onAtencionCreada = (a: AtencionCompleta) => {
    invalidar({ pacienteId, citaId: a.citaId });
    setCitaARegistrar(null);
    limpiarBorradores();
    setAtencionSel(a.id);
    setTab('evolucion'); // una atención RECIÉN creada sí empieza por la evolución
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
    onSuccess: (_r, d) => { invalidar({ pacienteId, atencionId: atencionSel! }); toast.success(`Podograma: ${TIPO_LESION_LABEL[d.tipoLesion]} · ${PIE_LABEL[d.pie]}${d.vista === 'dorsal' ? ' · dorso' : ''}${d.zona ? ` · ${d.zona}` : ''}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  // ── Dictado: la transcripción cruda se GUARDA (nada se pierde) y luego se reparte ──
  // Autoguardado con un pequeño retardo: dictar genera una frase cada pocos segundos y no queremos
  // una escritura por frase. Al detener el dictado se guarda lo que quede pendiente.
  const dictadoGuardadoRef = useRef<string>('');
  const timerDictadoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardarDictadoMut = useMutation({
    mutationFn: (p: { texto: string; aplicado?: boolean }) => historiaClinicaApi.guardarDictado(atencionSel!, p.texto, p.aplicado),
    onSuccess: (a) => { qc.setQueryData(atencionKey(a.id), a); dictadoGuardadoRef.current = a.dictado?.texto ?? ''; },
    // Si falla (red, atención cerrada), el texto sigue en pantalla: se avisa y se puede reintentar.
    onError: (e: Error) => toast.error(`No se pudo guardar lo dictado: ${e.message}`),
  });
  const guardarDictadoYa = useCallbackRef((texto: string, aplicado?: boolean) => {
    if (timerDictadoRef.current) { clearTimeout(timerDictadoRef.current); timerDictadoRef.current = null; }
    if (!atencionSel || (texto === dictadoGuardadoRef.current && !aplicado)) return;
    guardarDictadoMut.mutate({ texto, aplicado });
  });
  const programarGuardadoDictado = useCallbackRef((texto: string) => {
    if (timerDictadoRef.current) clearTimeout(timerDictadoRef.current);
    timerDictadoRef.current = setTimeout(() => guardarDictadoYa(texto), 2500);
  });
  useEffect(() => () => { if (timerDictadoRef.current) clearTimeout(timerDictadoRef.current); }, []);
  const textoDictadoGuardado = atencion?.dictado?.texto ?? '';
  useEffect(() => { dictadoGuardadoRef.current = textoDictadoGuardado; }, [textoDictadoGuardado, atencionSel]);

  /** Diagnóstico dictado → precarga el buscador CIE-10 (o solo cambia tipo/principal). */
  const usarDiagnosticoDictado = (d: DiagnosticoDictado) => {
    if (!d.termino) { if (d.tipo) evolucion.setDxTipo(d.tipo); if (d.principal !== undefined) evolucion.setDxPrincipal(d.principal); return; }
    setDxDictado((prev) => ({ ...d, n: (prev?.n ?? 0) + 1 }));
  };
  /** Lesión dictada → marca en el podograma; sin pie o zona clara, su texto va a Objetivo. */
  const usarLesionDictada = (l: LesionDictada) => {
    if (!l.pie || !l.zona) {
      evolucion.setObjetivo((prev) => anexarDictado(prev, l.texto));
      toast(`Lesión sin ${!l.pie ? 'pie' : 'zona'} clara: el texto fue a Objetivo. Di p. ej. «lesión heloma quinto dedo izquierdo».`, { icon: '⚠️', duration: 6000 });
      return;
    }
    const c = coordZona(l.zona.id, l.pie);
    marcaDictadoMut.mutate({ pie: l.pie, vista: c.vista, x: c.x, y: c.y, zona: l.zona.etiqueta, tipoLesion: l.tipoLesion ?? 'otro', nota: `${l.texto}${l.grado != null ? ` · grado ${l.grado}` : ''}` });
  };
  const consulta = useDictadoConsulta(dictado, {
    setSubjetivo: evolucion.setSubjetivo, setObjetivo: evolucion.setObjetivo, setApreciacion: evolucion.setApreciacion,
    setPlan: evolucion.setPlan, setObservacion: evolucion.setTexto,
    setProcedimiento: procedimientos.setDetalle,
    onTextoProcedimiento: (t) => { if (!procedimientos.tipo) { const tipo = adivinarTipoProcedimiento(t); if (tipo) procedimientos.setTipo(tipo); } },
    onDiagnostico: usarDiagnosticoDictado,
    onLesion: usarLesionDictada,
  }, { clave: atencionSel, transcripcionInicial: textoDictadoGuardado, onTranscripcion: programarGuardadoDictado });

  // ── Revisar lo dictado y llenar los campos (previsualización) ──
  const [revisarDictado, setRevisarDictado] = useState(false);
  const propuestaDictado: PropuestaDictado | null = useMemo(
    () => (consulta.transcripcion.trim() ? repartirTranscripcion(consulta.transcripcion) : null),
    [consulta.transcripcion],
  );
  /** Hay dictado guardado que todavía no se repartió a los campos (se avisa antes de cerrar). */
  const dictadoSinAplicar = !!atencion?.dictado?.texto.trim()
    && (!atencion.dictado.aplicadoEn || new Date(atencion.dictado.actualizadoEn).getTime() > new Date(atencion.dictado.aplicadoEn).getTime() + 1000);
  const abrirRevisionDictado = () => { guardarDictadoYa(consulta.transcripcion); setRevisarDictado(true); };
  /** Escribe en los campos lo elegido en la revisión: `reemplazar` pisa lo que hubiera; si no, lo añade al final. */
  const aplicarDictado = (eleccion: Partial<Record<CampoPropuesta, 'reemplazar' | 'anadir'>>) => {
    if (!propuestaDictado) return;
    const setters: Record<CampoPropuesta, (f: (prev: string) => string) => void> = {
      subjetivo: evolucion.setSubjetivo, objetivo: evolucion.setObjetivo, apreciacion: evolucion.setApreciacion,
      plan: evolucion.setPlan, observacion: evolucion.setTexto, procedimiento: procedimientos.setDetalle,
    };
    let n = 0;
    for (const campo of CAMPOS_PROPUESTA) {
      const modo = eleccion[campo];
      const texto = propuestaDictado.campos[campo];
      if (!modo || !texto.trim()) continue;
      setters[campo]((prev) => (modo === 'reemplazar' ? texto : unirTexto(prev, texto)));
      n++;
    }
    if (eleccion.procedimiento && !procedimientos.tipo) {
      const tipo = adivinarTipoProcedimiento(propuestaDictado.campos.procedimiento);
      if (tipo) procedimientos.setTipo(tipo);
    }
    setRevisarDictado(false);
    guardarDictadoYa(consulta.transcripcion, true); // queda marcado como repartido
    toast.success(n ? `Se llenaron ${n} campo${n === 1 ? '' : 's'} con lo dictado` : 'No se eligió ningún campo');
  };
  const limpiarDictadoMut = useMutation({
    mutationFn: () => historiaClinicaApi.limpiarDictado(atencionSel!),
    onSuccess: (a) => { qc.setQueryData(atencionKey(a.id), a); consulta.cambiarTranscripcion(''); dictadoGuardadoRef.current = ''; setRevisarDictado(false); toast.success('Se borró lo dictado'); },
    onError: (e: Error) => toast.error(e.message),
  });

  // A3 · Estado de la HC: pasar a pasiva (archivo) o reactivar. Paso manual de administración / coordinación;
  // al registrar una nueva atención vuelve sola a activa. Se sugiere con más de 5 años sin atenciones.
  const estadoHcMut = useMutation({
    mutationFn: (estado: 'activa' | 'pasiva') => historiaClinicaApi.cambiarEstadoHistoria(pacienteId!, estado),
    onSuccess: (_r, estado) => { invalidar({ pacienteId }); toast.success(estado === 'pasiva' ? 'Historia clínica pasada a archivo pasivo' : 'Historia clínica reactivada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const alternarEstadoHc = () => {
    const nuevo = historia?.estado === 'pasiva' ? 'activa' : 'pasiva';
    if (nuevo === 'pasiva' && !confirm('¿Pasar esta historia clínica a archivo PASIVO?\n\nSe puede reactivar cuando quieras, y vuelve sola a activa si el paciente se atiende de nuevo.')) return;
    estadoHcMut.mutate(nuevo);
  };
  const ultimaAtencionFecha = historia?.atenciones?.[0]?.fecha ?? null;
  const sugerirPasiva = historia?.estado === 'activa' && !!ultimaAtencionFecha && Date.now() - new Date(ultimaAtencionFecha).getTime() > 5 * 365.25 * 86_400_000;

  // Fotos tomadas que aún no se guardan: se cuentan en la pestaña Fotos y en el cierre, y se avisa antes
  // de recargar o cerrar la página (viven en memoria).
  const fotosSinGuardar = usePendientesDe(atencionSel).length;
  const totalFotosSinGuardar = useTotalPendientes();
  const hayBorrador = useBorradoresStore((s) => Object.values(s.activos).some(Boolean));
  useEffect(() => {
    if (!totalFotosSinGuardar && !hayBorrador) return;
    const avisar = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [totalFotosSinGuardar, hayBorrador]);

  return {
    pacienteId, paciente, historia, cargando: historiaQ.isLoading, errorCarga: historiaQ.error as Error | null, fotosSinGuardar,
    estadoHcMut, alternarEstadoHc, sugerirPasiva,
    atencion, atencionSel, seleccionarAtencion, cargandoAtencion: atencionQ.isLoading, errorAtencion: atencionQ.error as Error | null,
    puedeReabrir, horasReabrir: HORAS_REABRIR,
    lineaTiempo, genexisTotal, genexisSel, visitaGenexis, seleccionarGenexis,
    hayMasGenexis: !!genexisQ.hasNextPage, cargarMasGenexis: () => void genexisQ.fetchNextPage(), cargandoGenexis: genexisQ.isFetchingNextPage,
    tab, setTab, navigate,
    vistaSilueta, setVistaSilueta, modoSilueta, setModoSilueta,
    puedeRegistrar, puedeAnular, puedeVerRecetas, esMedicoPrescriptor, usuario,
    citasCandidatas, mostrarCandidatas, setMostrarCandidatas,
    citaARegistrar, setCitaARegistrar, onAtencionCreada,
    recetaModal, setRecetaModal,
    cerrarMut, reabrirMut,
    invalidar,
    evolucion, procedimientos, dictado, consulta, dxDictado, limpiarDxDictado, gestionaPlantillas,
    // Dictado guardado + revisión antes de llenar los campos
    propuestaDictado, revisarDictado, abrirRevisionDictado, cerrarRevisionDictado: () => setRevisarDictado(false),
    aplicarDictado, limpiarDictadoMut, dictadoSinAplicar, guardandoDictado: guardarDictadoMut.isPending,
    guardarDictadoYa, usarDiagnosticoDictado, usarLesionDictada,
  };
}

// ─── Registrar atención (desde una cita atendida) ────────────────────────────
export function useRegistrarAtencionForm(cita: CitaResumen, onCreada: (a: AtencionCompleta) => void) {
  // Personas (nunca equipos Baro). Si la columna de la cita es un equipo, el backend exige médico.
  const columnaEsEquipo = !!cita.profesional && esEquipoNombre(cita.profesional);
  // En una cita de la Baro el profesional de la columna es el EQUIPO: nunca se preselecciona (el servidor
  // lo rechazaría); solo el médico «por solicitud», si lo hay. Si no, se exige elegirlo.
  const preselecto = columnaEsEquipo ? (cita.solicitadoProfesional?.id ?? '') : (cita.solicitadoProfesional?.id ?? cita.profesionalId ?? '');
  const [motivoConsulta, setMotivoConsulta] = useState('');
  const [profesionalId, setProfesionalId] = useState<string>(preselecto);
  const { data: profesionales = [] } = useQuery({ queryKey: ['profesionales-activos'], queryFn: () => profesionalesApi.listar({ activo: true }), staleTime: 300_000 });
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
  const cerrada = atencion?.estado === 'cerrada';
  // Con la atención cerrada solo cabe una observación tardía: el tipo se pone solo.
  useEffect(() => { setProfesionalId(atencion?.profesionalId ?? ''); limpiarNota(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [atencionId, cerrada]);

  const cargarNota = (n: NotaEvolucion) => {
    setEditando(n.id); setTipo(n.tipo); setSubjetivo(n.subjetivo ?? ''); setObjetivo(n.objetivo ?? '');
    setApreciacion(n.apreciacion ?? ''); setPlan(n.plan ?? ''); setTexto(n.texto ?? ''); setProfesionalId(n.profesionalId ?? atencion?.profesionalId ?? '');
  };
  const limpiarNota = () => { setEditando(null); setTipo(cerrada ? 'observacion' : 'evolucion'); setSubjetivo(''); setObjetivo(''); setApreciacion(''); setPlan(''); setTexto(''); };
  const campos = (): CamposNota => ({ tipo, subjetivo, objetivo, apreciacion, plan, texto, profesionalId: profesionalId || null });
  const hayContenido = [subjetivo, objetivo, apreciacion, plan, texto].some((s) => s.trim());
  // Cerrada = solo lectura: solo se agrega una observación; las notas existentes ya no se editan (hay que reabrir).
  const puedeGuardarNota = puedeRegistrar && hayContenido && (!cerrada || (tipo === 'observacion' && !editando));
  useMarcarBorrador('nota', hayContenido);

  const guardarNotaMut = useMutation({
    mutationFn: () => (editando ? historiaClinicaApi.editarNota(editando, campos()) : historiaClinicaApi.agregarNota(atencionId!, campos())),
    onSuccess: () => { inval(); toast.success(editando ? 'Nota actualizada' : 'Nota registrada'); limpiarNota(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarNotaMut = useMutation({
    mutationFn: (p: { notaId: string; motivo?: string }) => historiaClinicaApi.eliminarNota(p.notaId, p.motivo),
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
    mutationFn: (p: { id: string; motivo?: string }) => historiaClinicaApi.eliminarDiagnostico(p.id, p.motivo),
    onSuccess: () => { inval(); toast.success('Diagnóstico eliminado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Copia uno por uno; si un código falla (p. ej. ya no está en el catálogo), avisa y sigue con el resto.
  const copiarDxMut = useMutation({
    mutationFn: async () => {
      const prev = anteriores?.diagnosticos?.diagnosticos ?? [];
      const actuales = new Set((atencion?.diagnosticos ?? []).map((d) => d.cie10Codigo));
      const nuevos = prev.filter((d: DiagnosticoAtencion) => !actuales.has(d.cie10Codigo));
      let ok = 0; const fallidos: string[] = [];
      for (const d of nuevos) {
        try { await historiaClinicaApi.agregarDiagnostico(atencionId!, { cie10Codigo: d.cie10Codigo, tipo: d.tipo, principal: false, observacion: d.observacion }); ok++; }
        catch { fallidos.push(d.cie10Codigo); }
      }
      return { total: nuevos.length, ok, fallidos };
    },
    onSuccess: (r) => {
      inval();
      if (!r.total) toast('No hay diagnósticos anteriores que copiar', { icon: 'ℹ️' });
      else if (r.fallidos.length) toast.error(`${r.ok} copiado(s); no se pudo copiar: ${r.fallidos.join(', ')}`);
      else toast.success(`${r.ok} diagnóstico(s) copiado(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const copiarDxAnteriores = () => { if (!copiarDxMut.isPending) copiarDxMut.mutate(); };

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
    dxSel, setDxSel, dxTipo, setDxTipo, dxPrincipal, setDxPrincipal, dxObs, setDxObs, agregarDxMut, editarDxMut, eliminarDxMut, copiarDxAnteriores, copiandoDx: copiarDxMut.isPending, tieneDxAnteriores: !!anteriores?.diagnosticos,
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
  // El campo se edita como texto (se puede borrar y volver a escribir); al salir se acota a 1–365.
  const [vigenciaTexto, setVigenciaTexto] = useState('30');
  const confirmarVigencia = () => { const n = Math.min(365, Math.max(1, Number(vigenciaTexto) || 30)); setVigenciaDias(n); setVigenciaTexto(String(n)); };
  const [emisorProfesionalId, setEmisorProfesionalId] = useState<string>(atencion.profesionalId);
  const usuario = useAuthStore((s) => s.usuario);
  const puedeAnularHc = useAuthStore((s) => s.tiene('hc.anular'));
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

  // ── Repetir una anterior (3.10) / usar una favorita (3.5): llenan el formulario; se revisa y se emite ──
  const qc = useQueryClient();
  const { data: anterioresTodas = [] } = useRecetasPaciente(atencion.pacienteId);
  const anteriores = useMemo(
    () => anterioresTodas.filter((r) => r.tipoDocumento === tipoDocumento && r.estado === 'emitida'),
    [anterioresTodas, tipoDocumento],
  );
  const { data: favoritas = [] } = useQuery({ queryKey: favoritasKey(tipoDocumento), queryFn: () => recetasApi.favoritas(tipoDocumento), staleTime: 60_000 });
  const cargarItems = (entrada: ItemEntrada[], extra: { indicacionesGenerales?: string | null; vigenciaDias?: number | null }, origen: string): boolean => {
    if (items.length && !window.confirm(`Esto reemplaza los ${items.length} ítem(s) que ya agregaste. ¿Continuar?`)) return false;
    const codigos = new Set(diagnosticos.map((d) => d.cie10Codigo));
    // Una receta anterior puede traer fármacos bajo receta: en indicaciones no van.
    const permitidos = esReceta ? entrada : entrada.filter((it) => it.tipo !== 'MEDICAMENTO_RX');
    if (permitidos.length < entrada.length) toast(`${entrada.length - permitidos.length} ítem(s) de venta bajo receta no van en indicaciones y se omitieron`);
    setItems(permitidos.map((it) => ({
      ...it,
      key: nuevaKey(),
      etiqueta: [it.nombre, it.concentracion, it.formaFarmaceutica].filter(Boolean).join(' ') || 'Ítem',
      requiereReceta: it.tipo === 'MEDICAMENTO_RX',
      // El diagnóstico se conserva si esta atención lo tiene; si no, va bajo el diagnóstico activo.
      diagnosticoCie10Codigo: it.diagnosticoCie10Codigo && codigos.has(it.diagnosticoCie10Codigo) ? it.diagnosticoCie10Codigo : dxActivo,
    })));
    if (extra.indicacionesGenerales) setIndicacionesGenerales(extra.indicacionesGenerales);
    if (esReceta && extra.vigenciaDias) { setVigenciaDias(extra.vigenciaDias); setVigenciaTexto(String(extra.vigenciaDias)); }
    toast.success(`${permitidos.length} ítem(s) cargados de ${origen}: revísalos y emite`);
    return true;
  };
  const repetirMut = useMutation({
    mutationFn: (id: string) => recetasApi.obtener(id),
    onSuccess: (r) => cargarItems(
      r.items.map((it) => ({
        tipo: it.tipo, diagnosticoCie10Codigo: it.diagnosticoCie10Codigo, medicamentoId: it.medicamentoId, servicioId: it.servicioId,
        nombre: it.nombre, marcaImpresa: it.marcaImpresa, concentracion: it.concentracionSnapshot, formaFarmaceutica: it.formaSnapshot,
        dosis: it.dosis, via: it.via, frecuencia: it.frecuencia, duracion: it.duracion, cantidad: it.cantidad, indicaciones: it.indicaciones,
      })),
      { indicacionesGenerales: r.indicacionesGenerales, vigenciaDias: r.vigenciaDias },
      `la N° ${String(r.numero).padStart(6, '0')}`,
    ),
    onError: (e: Error) => toast.error(e.message),
  });
  const usarFavorita = (id: string): boolean => {
    const fav = favoritas.find((x) => x.id === id);
    return !!fav && cargarItems(fav.items, { indicacionesGenerales: fav.indicacionesGenerales, vigenciaDias: fav.vigenciaDias }, `«${fav.nombre}»`);
  };
  // Una favorita la quita quien la creó o quien puede anular (misma regla que el servidor).
  const puedeQuitarFavorita = (id: string) => { const fav = favoritas.find((x) => x.id === id); return !!fav && (puedeAnularHc || (!!usuario && fav.creadoPorUsuarioId === usuario.id)); };
  const guardarFavoritaMut = useMutation({
    mutationFn: (nombre: string) => recetasApi.crearFavorita({
      nombre, tipoDocumento, indicacionesGenerales: indicacionesGenerales.trim() || null, vigenciaDias: esReceta ? vigenciaDias : null,
      items: items.map(({ key: _k, etiqueta: _e, requiereReceta: _r, diagnosticoCie10Codigo: _d, ...it }) => it),
    }),
    onSuccess: (fav) => { qc.invalidateQueries({ queryKey: favoritasKey(tipoDocumento) }); toast.success(`Guardada como favorita: «${fav.nombre}»`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarFavoritaMut = useMutation({
    mutationFn: (id: string) => recetasApi.eliminarFavorita(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: favoritasKey(tipoDocumento) }); toast.success('Favorita quitada'); },
    onError: (e: Error) => toast.error(e.message),
  });

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
  // Chequeo de alergias ANTES de emitir (3.1): el documento es inmutable, así que se pregunta antes, no después.
  const [chequeando, setChequeando] = useState(false);
  const emitir = async () => {
    if (!puedeGuardar || emitirMut.isPending || chequeando) return;
    setChequeando(true);
    try {
      // Alergias (3.1) + contraindicaciones por la condición del paciente (3.3) + interacciones entre ítems (3.2).
      const av = await recetasApi.advertencias(atencion.id, items.map((i) => ({ nombre: i.nombre ?? '', marcaImpresa: i.marcaImpresa ?? null, medicamentoId: i.medicamentoId ?? null, via: i.via ?? null, formaFarmaceutica: i.formaFarmaceutica ?? null })));
      const bloques: string[] = [];
      if (av.advertencias.length) bloques.push('POSIBLE ALERGIA:\n' + av.advertencias.map((a) => `• ${a.item} — alergia registrada a ${a.sustancia}${a.severidad === 'severa' ? ' (SEVERA)' : ''}${a.nota ? ` · ${a.nota}` : ''}`).join('\n'));
      if (av.contraindicaciones.length) bloques.push('POR LA CONDICIÓN DEL PACIENTE:\n' + av.contraindicaciones.map((c) => `• ${c.item} · ${c.condicion}${c.nivel === 'alto' ? ' (IMPORTANTE)' : ''}: ${c.texto}`).join('\n'));
      if (av.interacciones.length) bloques.push('INTERACCIÓN ENTRE LO RECETADO:\n' + av.interacciones.map((x) => `• ${x.itemA} + ${x.itemB}${x.nivel === 'alto' ? ' (IMPORTANTE)' : ''}: ${x.texto}`).join('\n'));
      if (bloques.length && !window.confirm(`Antes de emitir, revisa:\n\n${bloques.join('\n\n')}\n\n¿Emitir de todos modos?`)) return;
    } catch { /* si el chequeo falla se emite igual: el servidor vuelve a avisar tras emitir */ }
    finally { setChequeando(false); }
    emitirMut.mutate();
  };
  const abrirPdf = async () => { if (!emitida) return; try { await verRecetaPdf(emitida.id); } catch (e) { toast.error((e as Error).message); } };
  const imprimir = async () => { if (!emitida) return; try { await imprimirReceta(emitida.id); } catch (e) { toast.error((e as Error).message); } };
  const opcionesEmisor = useMemo(() => [atencion.profesional], [atencion.profesional]);

  return {
    esReceta, dxPrincipal, diagnosticos, dxActivo, setDxActivo, grupos, items, agregarMedicamento, agregarManual, agregarServicio, actualizarItem, quitarItem, servicios,
    indicacionesGenerales, setIndicacionesGenerales, vigenciaDias, setVigenciaDias, vigenciaTexto, setVigenciaTexto, confirmarVigencia, emisorProfesionalId, setEmisorProfesionalId, opcionesEmisor,
    puedeGuardar, emitirMut, emitir, chequeando, emitida, abrirPdf, imprimir, alergias: atencion.historiaClinica.alergias,
    anteriores, repetirMut, favoritas, usarFavorita, puedeQuitarFavorita, guardarFavoritaMut, eliminarFavoritaMut,
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
  const imprimirConFirma = async (id: string) => { try { await imprimirReceta(id, undefined, true); } catch (e) { toast.error((e as Error).message); } };
  // «Anular» solo se muestra a quien el servidor le va a permitir: hc.anular, o quien la emitió con el permiso del tipo.
  const usuario = useAuthStore((s) => s.usuario);
  const tiene = useAuthStore((s) => s.tiene);
  const puedeAnular = (r: { estado: string; emisorUsuarioId: string | null; emisorProfesionalId?: string; tipoDocumento: string; reservada?: boolean }) =>
    r.estado === 'emitida' && !r.reservada && (tiene('hc.anular')
      || (!!usuario && r.emisorUsuarioId === usuario.id && (r.tipoDocumento === 'RECETA_MEDICA' ? tiene('receta.emitir') : tiene('hc.registrar')))
      || (r.tipoDocumento === 'RECETA_MEDICA' && !!usuario?.profesionalId && r.emisorProfesionalId === usuario.profesionalId && tiene('receta.emitir')));

  // ¿Quién emite la RECETA MÉDICA de esta cita? Siempre sale a nombre del MÉDICO DE LA CITA.
  //  · El médico: si la cita no tiene médico, al emitir queda asignada a él; si es de otro, no.
  //  · Admin / coordinación: a nombre del médico asignado (que debe tener CMP).
  const miFicha = usuario?.profesional?.tipo === 'medico' ? usuario.profesionalId ?? null : null;
  const medicoCita = atencion?.cita.medico ?? null;
  const nombreMedicoCita = medicoCita ? `${medicoCita.nombres} ${medicoCita.apellidos}`.trim() : '';
  const emitirReceta: { puede: boolean; aNombreDe: string | null; aviso: string | null } = (() => {
    if (usuario?.esMedicoPrescriptor) {
      if (!medicoCita || medicoCita.id === miFicha) return { puede: true, aNombreDe: null, aviso: !medicoCita ? 'Al emitir, esta cita queda a tu nombre como su médico.' : null };
      return { puede: false, aNombreDe: null, aviso: `Esta cita la tiene ${nombreMedicoCita}: la receta sale a su nombre. Si la atiendes tú, pide a coordinación que te la asigne.` };
    }
    if (tiene('receta.emitir') && tiene('medico.asignar')) {
      if (!medicoCita) return { puede: false, aNombreDe: null, aviso: 'Para emitir la receta, asigna primero el médico de la cita: sale a su nombre y con su CMP.' };
      if (!(medicoCita.colegiatura ?? '').trim()) return { puede: false, aNombreDe: null, aviso: `${nombreMedicoCita} no tiene su CMP cargado: complétalo en Administración › Profesionales.` };
      return { puede: true, aNombreDe: nombreMedicoCita, aviso: null };
    }
    return { puede: false, aNombreDe: null, aviso: null };
  })();

  // Firma digitalizada: solo el médico, en recetas a SU nombre, si ya la subió.
  const { data: miFirma } = useQuery({ queryKey: ['mi-firma'], queryFn: () => miFirmaApi.estado(), enabled: !!miFicha, staleTime: 300_000 });
  const puedeFirmar = (r: { tipoDocumento: string; estado: string; emisorProfesionalId?: string }) =>
    !!miFirma?.tieneFirma && r.tipoDocumento === 'RECETA_MEDICA' && r.estado === 'emitida' && !!miFicha && r.emisorProfesionalId === miFicha;

  return { recetas: atencion?.recetas ?? [], anulando, setAnulando, anularMut, ver, imprimir, imprimirConFirma, puedeAnular, emitirReceta, puedeFirmar, soyMedico: !!miFicha };
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
  useMarcarBorrador('procedimiento', !!tipo || !!detalle.trim());
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
// Mismos textos que el servidor guarda en `resultado` (bloque3Service → iwgdf).
export const IWGDF_CONTROL = ['control anual', 'control 6–12 meses', 'control 3–6 meses', 'control 1–3 meses'];

export function useEscalas(atencion: AtencionCompleta | null, puedeRegistrar: boolean) {
  const invalidar = useInvalidarHistoriaClinica();
  const atencionId = atencion?.id;
  const inval = () => invalidar({ pacienteId: atencion?.pacienteId, atencionId, citaId: atencion?.citaId });
  const escalas = atencion?.escalas ?? [];
  const pacienteId = atencion?.pacienteId;
  // Historial del paciente: monofilamento de la visita anterior (comparar sitio a sitio) y mediciones de úlceras (curva).
  const { data: mfHist = [] } = useQuery({ queryKey: ['escalas-paciente', pacienteId, 'monofilamento'], queryFn: () => historiaClinicaApi.escalasPaciente(pacienteId!, 'monofilamento'), enabled: !!pacienteId, staleTime: 60_000 });
  const { data: ulceraHist = [] } = useQuery({ queryKey: ['escalas-paciente', pacienteId, 'ulcera'], queryFn: () => historiaClinicaApi.escalasPaciente(pacienteId!, 'ulcera'), enabled: !!pacienteId, staleTime: 60_000 });
  const { data: osiHist = [] } = useQuery({ queryKey: ['escalas-paciente', pacienteId, 'osi'], queryFn: () => historiaClinicaApi.escalasPaciente(pacienteId!, 'osi'), enabled: !!pacienteId, staleTime: 60_000 });
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
      grupos.get(nombre)!.puntos.push({ fecha: u.fecha.slice(0, 10), area: Math.round((typeof d.area === 'number' && Number.isFinite(d.area) ? d.area : l * a) * 10) / 10, largo: l, ancho: a, atencionId: u.atencionId });
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
  // ITB y pulsos (2.4): presiones sistólicas por lado; el ITB de cada pie se calcula en vivo.
  const [itb, setItb] = useState<CamposItb>(ITB_VACIO);
  const setCampoItb = (k: keyof CamposItb, v: string) => setItb((prev) => ({ ...prev, [k]: v }));
  const [pulsos, setPulsos] = useState<PulsosPie>(PULSOS_VACIOS);
  const setPulso = (k: keyof PulsosPie, v: EstadoPulso | '') => setPulsos((prev) => ({ ...prev, [k]: v }));
  const braqIzq = numOrNull(itb.braqIzq), braqDer = numOrNull(itb.braqDer);
  const itbIzq = itbPie(numOrNull(itb.pediaIzq), numOrNull(itb.tibialIzq), braqIzq, braqDer);
  const itbDer = itbPie(numOrNull(itb.pediaDer), numOrNull(itb.tibialDer), braqIzq, braqDer);
  // OSI (2.6): una uña por registro; se compara con la última medición de esa misma uña.
  const [osiPie, setOsiPie] = useState<'izquierdo' | 'derecho' | ''>('');
  const [osiUna, setOsiUna] = useState('hallux');
  const [osiArea, setOsiArea] = useState(0);
  const [osiProx, setOsiProx] = useState(1);
  const [osiDerm, setOsiDerm] = useState(false);
  const [osiHiper, setOsiHiper] = useState(false);
  const osiPuntaje = puntajeOsi(osiArea, osiProx, osiDerm, osiHiper);
  const osiAnteriorRow = osiPie
    ? [...osiHist].reverse().find((x) => x.atencionId !== atencionId && (!atencion || x.fecha <= atencion.fecha) && x.datos.pie === osiPie && x.datos.una === osiUna)
    : undefined;
  const osiAnterior = osiAnteriorRow
    ? { fecha: osiAnteriorRow.fecha, puntaje: typeof osiAnteriorRow.datos.puntaje === 'number' ? osiAnteriorRow.datos.puntaje : puntajeOsi(Number(osiAnteriorRow.datos.area) || 0, Number(osiAnteriorRow.datos.proximidad) || 1, osiAnteriorRow.datos.dermatofitoma === true, osiAnteriorRow.datos.hiperqueratosis === true) }
    : null;
  // Manchester (2.7): grado 1–4 por pie.
  const [manIzq, setManIzq] = useState<number | null>(null);
  const [manDer, setManDer] = useState<number | null>(null);
  // Examen del pie (1.5): hallazgos por pie + calzado con la guía de desgaste de la suela.
  const [hallazgos, setHallazgos] = useState<Record<string, { izq: boolean; der: boolean }>>({});
  const toggleHallazgo = (clave: string, lado: 'izq' | 'der') => setHallazgos((prev) => {
    const actual = prev[clave] ?? { izq: false, der: false };
    return { ...prev, [clave]: { ...actual, [lado]: !actual[lado] } };
  });
  const [calzado, setCalzado] = useState<CalzadoForm>(CALZADO_VACIO);
  const setCampoCalzado = (c: Partial<CalzadoForm>) => setCalzado((prev) => ({ ...prev, ...c }));
  const toggleProblema = (k: string) => setCalzado((prev) => ({ ...prev, problemas: prev.problemas.includes(k) ? prev.problemas.filter((x) => x !== k) : [...prev.problemas, k] }));
  const toggleDesgaste = (lado: 'izquierdo' | 'derecho', z: ZonaDesgaste) => setCalzado((prev) => {
    const lista = lado === 'izquierdo' ? prev.desgasteIzq : prev.desgasteDer;
    const nueva = lista.includes(z) ? lista.filter((x) => x !== z) : [...lista, z];
    return lado === 'izquierdo' ? { ...prev, desgasteIzq: nueva } : { ...prev, desgasteDer: nueva };
  });
  const [obsExamen, setObsExamen] = useState('');
  const hallazgosMarcados = Object.values(hallazgos).filter((v) => v.izq || v.der).length;
  // IWGDF: factores SUGERIDOS por lo registrado hoy (el médico los puede desmarcar).
  const eapSugerida = escalas.some((x) => x.tipo === 'itb' && eapDeItb(x.datos));
  const deformidadSugerida = escalas.some((x) => (x.tipo === 'manchester' && manchesterSugiereDeformidad(x.datos)) || (x.tipo === 'examen' && examenSugiereDeformidad(x.datos)));

  useEffect(() => { limpiar(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [atencionId]);
  const limpiar = () => {
    setTipoRaw(''); setEva(5); setWagner(0); setTexasGrado(0); setTexasInfeccion(false); setTexasIsquemia(false);
    setIwgdfF({ psp: false, eap: false, deformidad: false, ulceraPrevia: false, amputacion: false, erc: false });
    setMfIzq(Array(MF_PUNTOS).fill(true)); setMfDer(Array(MF_PUNTOS).fill(true)); setTempIzq(Array(MF_PUNTOS).fill('')); setTempDer(Array(MF_PUNTOS).fill(''));
    setUlLargo(''); setUlAncho(''); setUlProf(''); setUlPie(''); setUlUbicacion('');
    setItb(ITB_VACIO); setPulsos(PULSOS_VACIOS); setOsiPie(''); setOsiUna('hallux'); setOsiArea(0); setOsiProx(1); setOsiDerm(false); setOsiHiper(false);
    setManIzq(null); setManDer(null); setHallazgos({}); setCalzado(CALZADO_VACIO); setObsExamen('');
  };
  const setTipo = (t: TipoEscala | '') => {
    setTipoRaw(t);
    if (t === 'iwgdf') setIwgdfF((prev) => ({ ...prev, psp: pspSugerida, eap: prev.eap || eapSugerida, deformidad: prev.deformidad || deformidadSugerida }));
  };
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
      case 'itb': return {
        braqIzq, braqDer, pediaIzq: numOrNull(itb.pediaIzq), tibialIzq: numOrNull(itb.tibialIzq), pediaDer: numOrNull(itb.pediaDer), tibialDer: numOrNull(itb.tibialDer),
        itbIzq, itbDer, pulsos: Object.fromEntries(Object.entries(pulsos).filter(([, v]) => v)),
      };
      case 'osi': return { pie: osiPie || null, una: osiUna, area: osiArea, proximidad: osiArea ? osiProx : null, dermatofitoma: osiDerm, hiperqueratosis: osiHiper, puntaje: osiPuntaje };
      case 'manchester': return { izquierdo: manIzq, derecho: manDer };
      case 'examen': return {
        hallazgos: Object.fromEntries(Object.entries(hallazgos).map(([k, v]) => [k, combinarLado(v.izq, v.der)] as const).filter(([, v]) => v)),
        calzado: { adecuado: calzado.adecuado, tipo: calzado.tipo || null, problemas: calzado.problemas, plantillas: calzado.plantillas, desgaste: { izquierdo: calzado.desgasteIzq, derecho: calzado.desgasteDer } },
        observacion: obsExamen.trim() || null,
      };
      default: return {};
    }
  };
  const examenConDatos = hallazgosMarcados > 0 || calzado.adecuado != null || calzado.plantillas != null || !!calzado.tipo || calzado.problemas.length > 0
    || calzado.desgasteIzq.length + calzado.desgasteDer.length > 0 || !!obsExamen.trim();
  useMarcarBorrador('escala', !!tipo);
  const puedeGuardar = puedeRegistrar && !!tipo && atencion?.estado !== 'cerrada' && (tipo !== 'termometria' || pares.length > 0) && (tipo !== 'ulcera' || ulArea != null)
    && (tipo !== 'itb' || itbIzq != null || itbDer != null || Object.values(pulsos).some(Boolean))
    && (tipo !== 'osi' || !!osiPie) && (tipo !== 'manchester' || manIzq != null || manDer != null) && (tipo !== 'examen' || examenConDatos);
  const guardarMut = useMutation({
    mutationFn: () => historiaClinicaApi.guardarEscala(atencionId!, { tipo: tipo as TipoEscala, datos: datos(), pie: tipo === 'ulcera' && ulPie ? ulPie : tipo === 'osi' && osiPie ? osiPie : undefined }),
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
    itb, setCampoItb, pulsos, setPulso, itbIzq, itbDer,
    osiPie, setOsiPie, osiUna, setOsiUna, osiArea, setOsiArea, osiProx, setOsiProx, osiDerm, setOsiDerm, osiHiper, setOsiHiper, osiPuntaje, osiAnterior,
    manIzq, setManIzq, manDer, setManDer,
    hallazgos, toggleHallazgo, calzado, setCampoCalzado, toggleProblema, toggleDesgaste, obsExamen, setObsExamen,
    eapSugerida, deformidadSugerida,
    puedeGuardar, guardarMut, eliminarMut,
  };
}

// ─── Bloque 3 · Podograma (1.3 mapa interactivo + 1.3b imagen de la Baro con anotaciones) ──
export type HerramientaPodograma = 'mover' | 'lapiz' | 'texto' | 'borrador' | 'etiquetar';
// En pantallas táctiles (tablet) el editor arranca en "mover": el primer gesto desplaza la página
// en vez de dejar un trazo por accidente; se toca "Lápiz" cuando se quiere dibujar.
const herramientaInicial = (): HerramientaPodograma =>
  (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'mover' : 'lapiz');
type AnotacionPodograma = AtencionCompleta['imagenesPodograma'][number]['anotaciones'][number];
const MAX_IMAGEN_BYTES = 10 * 1024 * 1024;

/** Índice de la anotación que está bajo (x,y) en coordenadas 0..1; la última dibujada gana. */
function indiceAnotacionEn(lista: AnotacionPodograma[], x: number, y: number, saltar?: (a: AnotacionPodograma) => boolean): number {
  for (let i = lista.length - 1; i >= 0; i--) {
    const a = lista[i];
    if (saltar?.(a)) continue;
    if (a.tipo === 'texto') {
      if (x >= a.x - 0.01 && x <= a.x + 0.12 && y >= a.y - 0.035 && y <= a.y + 0.012) return i;
    } else {
      const tol = 0.012 + a.grosor / 2000;
      if (a.puntos.some(([px, py]) => Math.hypot(px - x, py - y) <= tol)) return i;
    }
  }
  return -1;
}

/** Modo de trabajo sobre la silueta. */
export type ModoSilueta = 'punto' | 'pintar' | 'historial';

/**
 * `ui` = vista y modo guardados fuera del panel (en el hook de la página), para que sobrevivan al
 * cambio de atención. Si no se pasan, el hook los lleva por su cuenta.
 */
export function usePodograma(
  atencion: AtencionCompleta | null,
  puedeRegistrar: boolean,
  ui?: { vista: VistaSilueta; setVista: (v: VistaSilueta) => void; modo: ModoSilueta; setModo: (m: ModoSilueta) => void },
) {
  const qc = useQueryClient();
  const invalidar = useInvalidarHistoriaClinica();
  const atencionId = atencion?.id;
  const inval = () => invalidar({ pacienteId: atencion?.pacienteId, atencionId, citaId: atencion?.citaId });
  const cerrada = atencion?.estado === 'cerrada';
  const puedeEditar = puedeRegistrar && !cerrada;

  // ── Silueta + marcas tipificadas (cuando no hay imagen de la Baro) ──
  const [pendiente, setPendiente] = useState<{ pie: PiePodograma; vista: VistaSilueta; x: number; y: number } | null>(null);
  const [tipoLesion, setTipoLesion] = useState<TipoLesion>('hiperqueratosis');
  // Planta o dorso (uñas / empeine). Al pasar al dorso se propone onicocriptosis (lo más común en uñas).
  const [vistaLocal, setVistaLocal] = useState<VistaSilueta>('plantar');
  const vistaSilueta = ui?.vista ?? vistaLocal;
  const setVistaSiluetaRaw = ui?.setVista ?? setVistaLocal;
  const cambiarVistaSilueta = (v: VistaSilueta) => { setVistaSiluetaRaw(v); setPendiente(null); setTrazoSel(null); setZonaHist(null); if (v === 'dorsal' && tipoLesion === 'hiperqueratosis') setTipoLesion('onicocriptosis'); };

  // ── Modo de la silueta: "Punto" (marca tipificada) o "Pintar" (trazos a mano alzada) ──
  const [modoLocal, setModoLocal] = useState<ModoSilueta>('punto');
  const modoSilueta = ui?.modo ?? modoLocal;
  const setModoSiluetaRaw = ui?.setModo ?? setModoLocal;
  const cambiarModoSilueta = (m: ModoSilueta) => { setModoSiluetaRaw(m); setPendiente(null); setTrazoSel(null); };
  // ── Capas: tipos ocultos en el mapa (clave = tipo de lesión o "sin" para trazos sin significado) ──
  const [capasOcultas, setCapasOcultas] = useState<string[]>([]);
  const alternarCapa = (clave: string) => setCapasOcultas((xs) => (xs.includes(clave) ? xs.filter((x) => x !== clave) : [...xs, clave]));
  const mostrarTodasCapas = () => setCapasOcultas([]);
  const capaVisible = (tipo: TipoLesion | null | undefined) => !capasOcultas.includes(tipo ?? 'sin');
  const trazoOculto = (a: AnotacionPodograma) => a.tipo === 'trazo' && !capaVisible(a.tipoLesion);
  // ── Historial por zona: lo registrado en el pie en TODAS las atenciones del paciente ──
  const { data: historial = [], isFetching: cargandoHistorial } = useHistorialPodograma(atencion?.pacienteId, modoSilueta === 'historial');
  const eventosHistorial = useMemo(() => eventosPorZona(historial), [historial]);
  const [zonaHist, setZonaHist] = useState<{ vista: VistaSilueta; pie: PiePodograma; zonaId: string } | null>(null);
  const elegirZonaHistorial = (pie: PiePodograma, x: number, y: number) => { const z = zonaMasCercana(vistaSilueta, pie, x, y); setZonaHist({ vista: vistaSilueta, pie, zonaId: z.id }); };
  const [herrDibujo, setHerrDibujoRaw] = useState<'lapiz' | 'borrador' | 'etiquetar'>('lapiz');
  // Qué se está pintando (callo, uñero, dolor…): define el color del pincel y queda guardado en cada trazo.
  const [tipoDibujo, setTipoDibujo] = useState<TipoLesion>('hiperqueratosis');
  const [grosorDibujo, setGrosorDibujo] = useState(16);
  // "Etiquetar": trazo elegido (pie + índice en su capa) y el significado/detalle que se le va a poner.
  const [trazoSel, setTrazoSel] = useState<{ pie: PiePodograma; indice: number } | null>(null);
  const [selTipo, setSelTipo] = useState<TipoLesion>('otro');
  const [selNota, setSelNota] = useState('');
  const setHerrDibujo = (hh: 'lapiz' | 'borrador' | 'etiquetar') => { setHerrDibujoRaw(hh); setTrazoSel(null); };
  // Capas guardadas por "vista:pie" y borrador local (solo las capas tocadas) hasta "Guardar dibujo".
  const guardadosDibujo = useMemo(() => Object.fromEntries((atencion?.dibujosSilueta ?? []).map((d) => [`${d.vista}:${d.pie}`, d.anotaciones ?? []])) as Record<string, AnotacionPodograma[]>, [atencion?.dibujosSilueta]);
  const borradorDibujoRef = useRef<Record<string, AnotacionPodograma[]>>({});
  const [borradorDibujo, setBorradorDibujo] = useState<Record<string, AnotacionPodograma[]>>({});
  const pilaDibujoRef = useRef<{ clave: string; previa: AnotacionPodograma[] }[]>([]);
  const [pilaDibujoLen, setPilaDibujoLen] = useState(0);
  const capaActual = (clave: string) => borradorDibujoRef.current[clave] ?? guardadosDibujo[clave] ?? [];
  const dibujoDe = (vista: VistaSilueta, pie: PiePodograma) => borradorDibujo[`${vista}:${pie}`] ?? guardadosDibujo[`${vista}:${pie}`] ?? [];
  const aplicarDibujo = (clave: string, nueva: AnotacionPodograma[]) => {
    pilaDibujoRef.current.push({ clave, previa: capaActual(clave) });
    borradorDibujoRef.current = { ...borradorDibujoRef.current, [clave]: nueva };
    setBorradorDibujo(borradorDibujoRef.current);
    setPilaDibujoLen(pilaDibujoRef.current.length);
  };
  const agregarTrazoSilueta = (pie: PiePodograma, t: AnotacionPodograma) => {
    if (!puedeEditar) return;
    const k = `${vistaSilueta}:${pie}`;
    aplicarDibujo(k, [...capaActual(k), t.tipo === 'trazo' ? { ...t, tipoLesion: tipoDibujo } : t]);
  };
  const borrarTrazoSilueta = (pie: PiePodograma, x: number, y: number, aspecto: number) => {
    if (!puedeEditar) return;
    const k = `${vistaSilueta}:${pie}`;
    const lista = capaActual(k);
    const i = indiceTrazoEn(lista, x, y, aspecto, trazoOculto);
    if (i >= 0) aplicarDibujo(k, lista.filter((_, j) => j !== i));
  };
  const seleccionarTrazoSilueta = (pie: PiePodograma, x: number, y: number, aspecto: number) => {
    const lista = capaActual(`${vistaSilueta}:${pie}`);
    const i = indiceTrazoEn(lista, x, y, aspecto, trazoOculto);
    const t = i >= 0 ? lista[i] : null;
    if (!t || t.tipo !== 'trazo') { setTrazoSel(null); return; }
    setTrazoSel({ pie, indice: i }); setSelTipo(t.tipoLesion ?? 'otro'); setSelNota(t.nota ?? '');
  };
  /** Pone al trazo elegido su significado (y el color de ese tipo) y un detalle; queda en borrador hasta guardar. */
  const aplicarEtiquetaTrazo = () => {
    if (!trazoSel || !puedeEditar) return;
    const k = `${vistaSilueta}:${trazoSel.pie}`;
    aplicarDibujo(k, capaActual(k).map((a, j) => (j === trazoSel.indice && a.tipo === 'trazo' ? { ...a, tipoLesion: selTipo, color: COLOR_LESION[selTipo], nota: selNota.trim() || undefined } : a)));
    toast.success('Listo: recuerda «Guardar dibujo»');
  };
  const quitarTrazoSel = () => {
    if (!trazoSel) return;
    const k = `${vistaSilueta}:${trazoSel.pie}`;
    aplicarDibujo(k, capaActual(k).filter((_, j) => j !== trazoSel.indice));
    setTrazoSel(null);
  };
  const deshacerDibujo = () => {
    const u = pilaDibujoRef.current.pop();
    if (!u) return;
    setTrazoSel(null);
    borradorDibujoRef.current = { ...borradorDibujoRef.current, [u.clave]: u.previa };
    setBorradorDibujo(borradorDibujoRef.current);
    setPilaDibujoLen(pilaDibujoRef.current.length);
  };
  /** Vacía los dos pies de la vista actual (queda en borrador hasta guardar). */
  const limpiarDibujo = () => {
    setTrazoSel(null);
    for (const pie of ['izquierdo', 'derecho'] as const) { const k = `${vistaSilueta}:${pie}`; if (capaActual(k).length) aplicarDibujo(k, []); }
  };
  const clavesDibujoSucias = Object.keys(borradorDibujo).filter((k) => JSON.stringify(borradorDibujo[k]) !== JSON.stringify(guardadosDibujo[k] ?? []));
  const descartarDibujo = () => {
    borradorDibujoRef.current = {}; pilaDibujoRef.current = [];
    setBorradorDibujo({}); setPilaDibujoLen(0); setTrazoSel(null);
  };
  const guardarDibujoMut = useMutation({
    mutationFn: async () => {
      let ultima: AtencionCompleta | null = null;
      for (const k of clavesDibujoSucias) {
        const [vista, pie] = k.split(':') as [VistaSilueta, PiePodograma];
        ultima = await historiaClinicaApi.guardarDibujoSilueta(atencionId!, { vista, pie, anotaciones: borradorDibujoRef.current[k] ?? [] });
      }
      return ultima;
    },
    // El borrador se conserva (ya es lo guardado); al volver la atención refrescada deja de estar "sucio".
    // El servidor redondea las coordenadas: se carga la atención que devolvió (ya con lo guardado) y se
    // descarta el borrador, así la capa deja de figurar "sin guardar" sin parpadeos.
    onSuccess: (ultima) => { if (ultima && atencionId) qc.setQueryData(atencionKey(atencionId), ultima); descartarDibujo(); inval(); toast.success('Dibujo guardado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [nota, setNota] = useState('');
  const marcarPunto = (pie: PiePodograma, x: number, y: number) => { if (!puedeEditar) return; setPendiente({ pie, vista: vistaSilueta, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }); };
  const cancelar = () => { setPendiente(null); setNota(''); };
  const agregarMut = useMutation({
    mutationFn: () => historiaClinicaApi.agregarMarca(atencionId!, { pie: pendiente!.pie, vista: pendiente!.vista, x: pendiente!.x, y: pendiente!.y, tipoLesion, nota: nota.trim() || null }),
    onSuccess: () => { inval(); setPendiente(null); setNota(''); toast.success('Marca agregada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarMarca(id),
    onSuccess: () => { inval(); toast.success('Marca eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Editar qué es un punto ya guardado (tipo y detalle).
  const [marcaEdit, setMarcaEdit] = useState<{ id: string; tipo: TipoLesion; nota: string } | null>(null);
  const editarMarcaMut = useMutation({
    mutationFn: (m: { id: string; tipo: TipoLesion; nota: string }) => historiaClinicaApi.editarMarca(m.id, { tipoLesion: m.tipo, nota: m.nota.trim() || null }),
    onSuccess: () => { inval(); setMarcaEdit(null); toast.success('Marca actualizada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Mover un punto ya puesto (arrastrándolo): se guarda la nueva posición y la zona más cercana. La caché
  // se actualiza al instante para que el punto no "salte" de vuelta mientras responde el servidor.
  const moverMarcaMut = useMutation({
    mutationFn: (m: { id: string; x: number; y: number; zona: string }) => historiaClinicaApi.editarMarca(m.id, { x: m.x, y: m.y, zona: m.zona }),
    onSuccess: (_r, m) => { inval(); toast.success(`Punto movido · ${m.zona}`); },
    onError: (e: Error) => { inval(); toast.error(e.message); },
  });
  const moverMarca = (id: string, x: number, y: number) => {
    const m = (atencion?.marcasPodograma ?? []).find((k) => k.id === id);
    if (!m || !puedeEditar || !atencionId) return;
    const zona = zonaMasCercana(m.vista ?? 'plantar', m.pie, x, y).etiqueta;
    qc.setQueryData<AtencionCompleta>(atencionKey(atencionId), (old) => (old ? { ...old, marcasPodograma: old.marcasPodograma.map((k) => (k.id === id ? { ...k, x, y, zona } : k)) } : old));
    moverMarcaMut.mutate({ id, x, y, zona });
  };
  /** Tocar un punto (sin arrastrar) abre su edición: qué es y detalle. */
  const tocarMarca = (id: string) => {
    const m = (atencion?.marcasPodograma ?? []).find((k) => k.id === id);
    if (m) setMarcaEdit({ id, tipo: m.tipoLesion, nota: m.nota ?? '' });
  };

  // ── Imágenes de la Baro: 4 vistas fijas (frontal/posterior × izq/der) + sueltas por compatibilidad ──
  const imagenes = atencion?.imagenesPodograma ?? [];
  const porVista = Object.fromEntries(VISTAS_PODOGRAMA.map((v) => [v, imagenes.find((i) => i.vista === v)])) as Record<VistaPodograma, ImagenPodograma | undefined>;
  const otras = imagenes.filter((i) => !i.vista);
  const [imagenSelId, setImagenSelId] = useState<string | null>(null);
  // Sin imágenes de la Baro se arranca en la SILUETA (lo que se usa para marcar); con imágenes, en ellas.
  const [verSiluetaRaw, setVerSilueta] = useState<boolean | null>(null);
  const verSilueta = verSiluetaRaw ?? imagenes.length === 0;
  const primera = VISTAS_PODOGRAMA.map((v) => porVista[v]).find(Boolean) ?? otras[0] ?? null;
  const imagenSel = imagenes.find((i) => i.id === imagenSelId) ?? primera;
  const imagenSelIdReal = imagenSel?.id ?? null;
  // Al cambiar de atención se limpia lo que pertenece a ESA atención (imagen elegida, marca a medio
  // poner, nota, zona del historial y el borrador de dibujo). La VISTA (planta / dorso) y el MODO no se
  // tocan a propósito: son la forma de mirar, no datos de la atención, y el doctor pidió seguir donde
  // estaba al pasar de una visita a otra (17-sep-2026).
  useEffect(() => { setImagenSelId(null); setVerSilueta(null); setPendiente(null); setNota(''); setZonaHist(null); descartarDibujo(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [atencionId]);

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
  // Qué se marca en la imagen de la Baro (color fijo por tipo) y trazo elegido con "Etiquetar".
  const [tipoBaro, setTipoBaro] = useState<TipoLesion>('hiperqueratosis');
  const [anotSel, setAnotSel] = useState<number | null>(null);
  const [anotSelTipo, setAnotSelTipo] = useState<TipoLesion>('otro');
  const [anotSelNota, setAnotSelNota] = useState('');
  const [anotaciones, setAnotaciones] = useState<AnotacionPodograma[]>([]);
  const [guardadas, setGuardadas] = useState<AnotacionPodograma[]>([]);
  useEffect(() => { const a = imagenSel?.anotaciones ?? []; setAnotaciones(a); setGuardadas(a); setAnotSel(null); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [imagenSelIdReal]);
  const sucio = anotaciones !== guardadas;
  useMarcarBorrador('podograma', sucio || clavesDibujoSucias.length > 0 || !!pendiente);
  const agregarAnotacion = (a: AnotacionPodograma) => {
    if (!puedeEditar) return;
    // Los trazos del lápiz llevan lo que significan (y el color de ese tipo); los textos, su color libre.
    const conSignificado = a.tipo === 'trazo' ? { ...a, tipoLesion: tipoBaro, color: COLOR_LESION[tipoBaro] } : a;
    setAnotaciones((prev) => [...prev, conSignificado]);
  };
  const borrarEn = (x: number, y: number) => { if (!puedeEditar) return; setAnotSel(null); setAnotaciones((prev) => { const i = indiceAnotacionEn(prev, x, y, trazoOculto); return i < 0 ? prev : prev.filter((_, k) => k !== i); }); };
  const deshacer = () => { setAnotSel(null); setAnotaciones((prev) => (prev.length ? prev.slice(0, -1) : prev)); };
  const limpiarAnotaciones = () => { setAnotSel(null); setAnotaciones((prev) => (prev.length ? [] : prev)); };
  const descartar = () => { setAnotSel(null); setAnotaciones(guardadas); };
  const seleccionarEn = (x: number, y: number) => {
    const i = indiceAnotacionEn(anotaciones, x, y, trazoOculto);
    const a = i >= 0 ? anotaciones[i] : null;
    if (!a || a.tipo !== 'trazo') { setAnotSel(null); return; }
    setAnotSel(i); setAnotSelTipo(a.tipoLesion ?? 'otro'); setAnotSelNota(a.nota ?? '');
  };
  const aplicarEtiquetaAnotacion = () => {
    if (anotSel == null || !puedeEditar) return;
    setAnotaciones((prev) => prev.map((a, i) => (i === anotSel && a.tipo === 'trazo' ? { ...a, tipoLesion: anotSelTipo, color: COLOR_LESION[anotSelTipo], nota: anotSelNota.trim() || undefined } : a)));
  };
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
    vistaSilueta, setVistaSilueta: cambiarVistaSilueta,
    // capas
    capasOcultas, alternarCapa, mostrarTodasCapas, capaVisible, trazoOculto,
    // historial por zona
    cargandoHistorial, eventosHistorial, zonaHist, setZonaHist, elegirZonaHistorial,
    puntosHistorial: (pie: PiePodograma) => eventosHistorial.filter((e) => e.vista === vistaSilueta && e.pie === pie),
    zonasHistorial: resumenZonas(eventosHistorial, vistaSilueta),
    eventosZonaHist: zonaHist
      ? eventosHistorial.filter((e) => claveZona(e.vista, e.pie, e.zonaId) === claveZona(zonaHist.vista, zonaHist.pie, zonaHist.zonaId)).sort((x, y) => y.fecha.localeCompare(x.fecha))
      : [],
    // modo pintar
    modoSilueta, setModoSilueta: cambiarModoSilueta, herrDibujo, setHerrDibujo, tipoDibujo, setTipoDibujo, grosorDibujo, setGrosorDibujo,
    trazoSel, selTipo, setSelTipo, selNota, setSelNota, seleccionarTrazoSilueta, aplicarEtiquetaTrazo, quitarTrazoSel,
    marcaEdit, setMarcaEdit, editarMarcaMut, moverMarca, tocarMarca,
    dibujoDe, agregarTrazoSilueta, borrarTrazoSilueta, deshacerDibujo, limpiarDibujo, descartarDibujo, guardarDibujoMut,
    puedeDeshacerDibujo: pilaDibujoLen > 0, dibujoSucio: clavesDibujoSucias.length > 0,
    hayDibujoEnVista: dibujoDe(vistaSilueta, 'izquierdo').length + dibujoDe(vistaSilueta, 'derecho').length > 0,
    dibujosGuardados: (atencion?.dibujosSilueta ?? []).filter((d) => d.anotaciones?.length),
    marcas: atencion?.marcasPodograma ?? [], pendiente, marcarPunto, cancelar, tipoLesion, setTipoLesion, nota, setNota, agregarMut, eliminarMut,
    // imágenes
    imagenes, porVista, otras, imagenSel, setImagenSelId, verSilueta, setVerSilueta, urlImagen, cargandoImagen, subirArchivo, subirMut, eliminarImagenMut,
    // editor
    herramienta, setHerramienta: (hh: HerramientaPodograma) => { setHerramienta(hh); setAnotSel(null); }, color, setColor, grosor, setGrosor, anotaciones, sucio,
    tipoBaro, setTipoBaro, anotSel, anotSelTipo, setAnotSelTipo, anotSelNota, setAnotSelNota, seleccionarEn, aplicarEtiquetaAnotacion,
    agregarAnotacion, borrarEn, deshacer, limpiarAnotaciones, descartar, guardarAnotaciones, guardarAnotacionesMut,
  };
}

// ─── Bandeja del día (ronda del médico) ──────────────────────────────────────
export function useBandejaPage() {
  const navigate = useNavigate();
  const invalidar = useInvalidarHistoriaClinica();
  const [dias, setDias] = useState(45);
  const q = useQuery({ queryKey: ['hc-bandeja', dias], queryFn: () => historiaClinicaApi.bandeja(dias), staleTime: 60_000 });
  // Desde la bandeja se cierra SIN el diálogo de la HC (no se proponen controles): se avisa y se confirma.
  const cerrarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.cerrarAtencion(id),
    onSuccess: (a) => { invalidar({ pacienteId: a.pacienteId, atencionId: a.id, citaId: a.citaId }); void q.refetch(); toast.success('Atención cerrada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cerrarUna = (id: string) => {
    if (window.confirm('¿Cerrar esta atención? Desde aquí no se proponen controles de seguimiento (para eso ciérrala desde la historia).')) cerrarMut.mutate(id);
  };
  const [cerrandoTodas, setCerrandoTodas] = useState(false);
  /** Cierre en lote (firma en lote de la ronda): una por una, sin frenar por un error puntual. */
  const cerrarTodas = async (ids: string[]) => {
    if (!window.confirm(`¿Cerrar ${ids.length} atenciones completas? Desde aquí no se proponen controles de seguimiento.`)) return;
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
  return { dias, setDias, bandeja: q.data, cargando: q.isLoading, error: q.error as Error | null, cerrarMut, cerrarUna, cerrarTodas, cerrandoTodas, abrir, abrirPaciente, refrescar: () => void q.refetch() };
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

  // Fotos tomadas o elegidas que aún NO se guardan (store por atención: sobreviven al cambio de pestaña).
  // Cada una lleva su zona, lado, tipo y descripción; recién con «Guardar» se sube y pasa a la lista.
  const pendientes = usePendientesDe(atencionId);
  const agregarPend = useFotosPendientesStore((s) => s.agregar);
  const actualizarPend = useFotosPendientesStore((s) => s.actualizar);
  const quitarPend = useFotosPendientesStore((s) => s.quitar);
  const [guardando, setGuardando] = useState<string[]>([]);
  const enLoteRef = useRef(false);
  const agregarArchivos = (lista: FileList | File[] | null | undefined, campos?: Partial<CamposPendiente>) => {
    if (!lista?.length || !puedeEditar || !atencionId) return;
    const nuevas: FotoPendiente[] = [];
    for (const archivo of Array.from(lista)) {
      if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) { toast.error(`${archivo.name}: solo se aceptan fotos JPG, PNG o WEBP`); continue; }
      if (archivo.size > MAX_FOTO_BYTES) { toast.error(`${archivo.name}: la foto supera los 15 MB`); continue; }
      nuevas.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, archivo, url: URL.createObjectURL(archivo),
        tomadaEn: new Date(archivo.lastModified || Date.now()).toISOString(), zona: '', pie: '', categoria: 'lesion', descripcion: '', ...campos,
      });
    }
    if (nuevas.length) agregarPend(atencionId, nuevas);
  };
  const actualizarPendiente = (id: string, cambios: Partial<CamposPendiente>) => { if (atencionId) actualizarPend(atencionId, id, cambios); };
  // Foto «fantasma»: cámara en vivo con una foto anterior en transparencia para repetir el encuadre; cada
  // captura va a «Por guardar» con la zona, lado y tipo de la foto de referencia.
  const [fantasmaAbierta, setFantasmaAbierta] = useState(false);
  const capturarFantasma = (archivo: File, ref: FotoPaciente | null) =>
    agregarArchivos([archivo], ref ? { zona: ref.zona ?? '', pie: ref.pie ?? '', categoria: ref.categoria } : undefined);
  // La atención viaja en las variables: si el doctor cambia de atención mientras sube, la foto no se cruza.
  const subirMut = useMutation({
    mutationFn: (v: { p: FotoPendiente; atencionId: string }) => historiaClinicaApi.subirFoto(v.atencionId, v.p.archivo, { pie: v.p.pie || null, zona: v.p.zona || null, categoria: v.p.categoria, descripcion: v.p.descripcion || null, tomadaEn: v.p.tomadaEn }),
    onMutate: (v) => setGuardando((g) => [...g, v.p.id]),
    onSettled: (_r, _e, v) => setGuardando((g) => g.filter((x) => x !== v.p.id)),
    onSuccess: (_r, v) => {
      quitarPend(v.atencionId, v.p.id);
      invalidar({ pacienteId, atencionId: v.atencionId });
      if (!enLoteRef.current) toast.success(`Foto guardada${v.p.zona.trim() ? ` · ${v.p.zona.trim()}` : ''}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const guardarPendiente = (id: string) => {
    const p = pendientes.find((x) => x.id === id);
    if (p && atencionId && !guardando.includes(id)) subirMut.mutate({ p, atencionId });
  };
  const guardarTodas = async () => {
    if (!atencionId) return;
    enLoteRef.current = true;
    let ok = 0;
    for (const p of pendientes.filter((x) => !guardando.includes(x.id))) {
      try { await subirMut.mutateAsync({ p, atencionId }); ok++; } catch { /* el error ya se avisó */ }
    }
    enLoteRef.current = false;
    if (ok) toast.success(ok === 1 ? 'Foto guardada' : `${ok} fotos guardadas`);
  };
  const descartarPendiente = (id: string) => {
    if (atencionId && confirm('¿Descartar esta foto sin guardarla?')) quitarPend(atencionId, id);
  };
  /** Copia zona, lado y tipo de una foto a las demás por guardar (varias fotos de la misma zona). */
  const aplicarATodas = (id: string) => {
    const p = pendientes.find((x) => x.id === id);
    if (!p || !atencionId) return;
    pendientes.forEach((x) => { if (x.id !== id) actualizarPend(atencionId, x.id, { zona: p.zona, pie: p.pie, categoria: p.categoria }); });
    toast.success('Zona, lado y tipo copiados a las demás fotos');
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

  // Medición de úlcera sobre una foto de esta atención (se guarda como escala "Úlcera (medidas)").
  const qcFotos = useQueryClient();
  const [fotoMedir, setFotoMedir] = useState<FotoClinica | null>(null);
  const medirMut = useMutation({
    mutationFn: (m: { foto: FotoClinica; largo: number; ancho: number; area: number; profundidad: number | null; referenciaCm: number }) =>
      historiaClinicaApi.guardarEscala(atencionId!, {
        tipo: 'ulcera', pie: m.foto.pie,
        datos: { largo: m.largo, ancho: m.ancho, area: m.area, profundidad: m.profundidad, pie: m.foto.pie === 'izquierdo' || m.foto.pie === 'derecho' ? m.foto.pie : null, ubicacion: m.foto.zona, fotoId: m.foto.id, metodo: 'foto', referenciaCm: m.referenciaCm },
      }),
    onSuccess: () => { inval(); void qcFotos.invalidateQueries({ queryKey: ['escalas-paciente'] }); setFotoMedir(null); toast.success('Medición guardada en Escalas'); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Pedal Bluetooth / teclado: con el pedal activo, Av Pág o flechas disparan "Tomar foto". Se recuerda en este equipo.
  const [pedalActivo, setPedalActivoRaw] = useState<boolean>(() => { try { return localStorage.getItem('limablue-pedal-fotos') === '1'; } catch { return false; } });
  const setPedalActivo = (v: boolean) => { setPedalActivoRaw(v); try { localStorage.setItem('limablue-pedal-fotos', v ? '1' : '0'); } catch { /* sin almacenamiento */ } };

  // Antes / después: todas las fotos del paciente; se elige zona y dos fotos (por defecto primera y última).
  const { data: todas = [] } = useQuery({ queryKey: ['fotos-paciente', pacienteId], queryFn: () => historiaClinicaApi.fotosDePaciente(pacienteId!), enabled: !!pacienteId, staleTime: 60_000 });
  const zonas = [...new Set(todas.map((f) => (f.zona ?? '').trim()).filter(Boolean))];
  // Sugerencias para la zona: las ya usadas con este paciente y las del podograma (mismos nombres → el
  // historial por zona y el antes/después las encuentran).
  const sugerenciasZona = [...new Set([...zonas, ...ZONAS_PIE.map((z) => z.etiqueta)])];
  const [zonaComparar, setZonaComparar] = useState<string>('');
  const enZona: FotoPaciente[] = todas.filter((f) => !zonaComparar || (f.zona ?? '').trim().toLowerCase() === zonaComparar.toLowerCase());
  const [antesId, setAntesId] = useState<string | null>(null);
  const [despuesId, setDespuesId] = useState<string | null>(null);
  const antes = enZona.find((f) => f.id === antesId) ?? enZona[0] ?? null;
  const despues = enZona.find((f) => f.id === despuesId) ?? (enZona.length > 1 ? enZona[enZona.length - 1] : null);
  const elegirZona = (z: string) => { setZonaComparar(z); setAntesId(null); setDespuesId(null); };

  return {
    fotos, cerrada, puedeEditar,
    fotoMedir, setFotoMedir, medirMut, pedalActivo, setPedalActivo,
    pendientes, agregarArchivos, actualizarPendiente, guardarPendiente, guardarTodas, descartarPendiente, aplicarATodas, guardando,
    fantasmaAbierta, setFantasmaAbierta, capturarFantasma,
    subirMut, eliminarMut, editarMut,
    todas, zonas, sugerenciasZona, zonaComparar, elegirZona, enZona, antes, despues, setAntesId, setDespuesId,
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
  // El consentimiento pide procedimiento (clave) y un texto que de verdad informe: el servidor exige 120.
  const puedeGuardar = nombre.trim().length >= 2 && (
    tipo === 'nota' ? [subjetivo, objetivo, apreciacion, plan].some((x) => x.trim())
      : tipo === 'consentimiento' ? !!clave.trim() && texto.trim().length >= 120
        : !!clave.trim() && !!texto.trim());
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
