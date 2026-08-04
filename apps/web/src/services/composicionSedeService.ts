import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { sedesApi } from '../api';
import { composicionSedeApi, type PersonaRoster, type SedeComposicion } from '../api/composicionSede';
import { MOTIVO_LABELS } from '../api/movimientos';
import { useAuthStore } from '../stores/authStore';

// ── Helpers de mes ───────────────────────────────────────────────────────────

export function mesActualISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function rangoMesISO(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return { inicio: `${mes}-01`, fin };
}

export function diasDelMes(mes: string): number {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Suma delta meses a un YYYY-MM. */
export function sumarMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y!, (m! - 1) + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return `${MESES_ES[(m! - 1)]} ${y}`;
}

// ── Helpers de timeline (gantt) ──────────────────────────────────────────────

/** Día del mes de una fecha DD/MM/YYYY (formato del backend, ya recortada al mes). */
function diaDe(ddmmyyyy: string): number {
  return parseInt(ddmmyyyy.split('/')[0] ?? '1', 10) || 1;
}

/** Posición y ancho (en %) de la barra de una persona sobre los días del mes. */
export function barraGantt(p: PersonaRoster, dias: number): { leftPct: number; widthPct: number; diaDesde: number; diaHasta: number; completo: boolean } {
  const diaDesde = diaDe(p.desde);
  const diaHasta = diaDe(p.hasta);
  const leftPct = ((diaDesde - 1) / dias) * 100;
  const widthPct = ((diaHasta - diaDesde + 1) / dias) * 100;
  return { leftPct, widthPct, diaDesde, diaHasta, completo: diaDesde === 1 && diaHasta === dias };
}

/** Marcas de la escala de días (1, 7, 14, 21, 28, último). */
export function marcasEscala(dias: number): { dia: number; leftPct: number }[] {
  const dset = [1, 7, 14, 21, 28].filter(d => d < dias);
  dset.push(dias);
  return dset.map(d => ({ dia: d, leftPct: ((d - 1) / dias) * 100 }));
}

/** Cobertura = movimiento temporal con motivo específico (misma regla que Movimientos). */
export function esCoberturaPersona(p: PersonaRoster): boolean {
  return !!p.motivo && p.motivo !== 'OTRO';
}

export function etiquetaMotivo(motivo?: string | null): string {
  if (!motivo) return '';
  return (MOTIVO_LABELS as Record<string, string>)[motivo] ?? motivo;
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase();
}

const AVATAR_COLORES = ['#e11d48', '#7c3aed', '#0891b2', '#65a30d', '#db2777', '#ea580c', '#0d9488', '#8b5cf6', '#0284c7'];
export function colorAvatar(nombre: string): string {
  const hash = [...nombre].reduce((h, c) => h + c.charCodeAt(0), 0);
  return AVATAR_COLORES[hash % AVATAR_COLORES.length]!;
}

// ── Metadata visual por cargo ────────────────────────────────────────────────

export interface CargoMeta {
  key: keyof Pick<SedeComposicion, 'podologas' | 'fisioterapeutas' | 'doctores' | 'recepcionistas'>;
  titulo: string;
  subtitulo: string;
  fuente: string;
  icon: string;
  text: string;      // clase texto del encabezado
  chipBg: string;    // fondo del contador
  barFull: string;   // barra mes completo
  barPart: string;   // barra parcial
  barPartText: string;
}

export const CARGOS: CargoMeta[] = [
  { key: 'podologas', titulo: 'Podólogas', subtitulo: 'Titular', fuente: 'desde Movimientos', icon: 'medical_services', text: 'text-primary', chipBg: 'bg-primary/10 text-primary', barFull: 'bg-primary', barPart: 'bg-primary/40 border border-primary/50', barPartText: 'text-primary' },
  { key: 'fisioterapeutas', titulo: 'Fisioterapeutas', subtitulo: 'Fisioterapeuta', fuente: 'desde Movimientos', icon: 'fitness_center', text: 'text-cyan-700', chipBg: 'bg-cyan-50 text-cyan-700', barFull: 'bg-cyan-600', barPart: 'bg-cyan-600/40 border border-cyan-600/50', barPartText: 'text-cyan-800' },
  { key: 'doctores', titulo: 'Doctores (baro)', subtitulo: 'Doctor', fuente: 'desde el Roster', icon: 'monitor_heart', text: 'text-teal-700', chipBg: 'bg-teal-50 text-teal-700', barFull: 'bg-teal-600', barPart: 'bg-teal-600/40 border border-teal-600/50', barPartText: 'text-teal-800' },
  { key: 'recepcionistas', titulo: 'Recepcionistas', subtitulo: 'Recepción', fuente: 'desde el Roster', icon: 'support_agent', text: 'text-violet-700', chipBg: 'bg-violet-50 text-violet-700', barFull: 'bg-violet-500', barPart: 'bg-violet-500/40 border border-violet-500/50', barPartText: 'text-violet-800' },
];

export function totalPersonasSede(s: SedeComposicion): number {
  return s.podologas.length + s.fisioterapeutas.length + s.doctores.length + s.recepcionistas.length;
}

export function coberturasSede(s: SedeComposicion): number {
  return [...s.podologas, ...s.fisioterapeutas].filter(esCoberturaPersona).length;
}

// ── Hook principal ───────────────────────────────────────────────────────────

export function useComposicionSede() {
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora()); // admin + coordinadora_sedes

  const [mes, setMes] = useState(mesActualISO());
  const [vista, setVista] = useState<'ver' | 'roster'>('ver');
  const [sedeSelId, setSedeSelId] = useState<string | null>(null);
  const [modalAsignarOpen, setModalAsignarOpen] = useState(false);
  const [modalRecepOpen, setModalRecepOpen] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: comp, isLoading } = useQuery({
    queryKey: ['composicion', mes],
    queryFn: () => composicionSedeApi.composicion(mes),
    enabled: puedeGestionar,
  });
  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar, enabled: puedeGestionar });
  const { data: doctores = [] } = useQuery({ queryKey: ['comp-doctores'], queryFn: composicionSedeApi.doctores, enabled: puedeGestionar });
  const { data: recepcionistas = [] } = useQuery({ queryKey: ['comp-recepcionistas'], queryFn: composicionSedeApi.recepcionistas, enabled: puedeGestionar });
  const { data: asignaciones = [] } = useQuery({ queryKey: ['comp-asignaciones', mes], queryFn: () => composicionSedeApi.asignaciones(mes), enabled: puedeGestionar });

  const invalidarTodo = () => {
    qc.invalidateQueries({ queryKey: ['composicion'] });
    qc.invalidateQueries({ queryKey: ['comp-asignaciones'] });
    qc.invalidateQueries({ queryKey: ['comp-recepcionistas'] });
  };

  // ── Derivados: sedes con color + conteos, sede seleccionada, totales ───────
  const colorPorSede = useMemo(() => new Map(sedes.map(s => [s.id, s.color])), [sedes]);

  const sedesComp = comp?.sedes ?? [];
  const sedeSeleccionada = sedesComp.find(s => s.sedeId === sedeSelId) ?? sedesComp[0] ?? null;

  const totales = useMemo(() => {
    const t = { personas: 0, podologas: 0, fisioterapeutas: 0, doctores: 0, recepcionistas: 0 };
    for (const s of sedesComp) {
      t.podologas += s.podologas.length;
      t.fisioterapeutas += s.fisioterapeutas.length;
      t.doctores += s.doctores.length;
      t.recepcionistas += s.recepcionistas.length;
    }
    t.personas = t.podologas + t.fisioterapeutas + t.doctores + t.recepcionistas;
    return t;
  }, [sedesComp]);

  // Recepcionista → sede asignada este mes (para el badge de la ficha).
  const sedeDeRecepcionista = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of asignaciones) {
      if (a.cargo === 'recepcionista' && a.personaId && !map.has(a.personaId)) map.set(a.personaId, a.sedeNombre);
    }
    return map;
  }, [asignaciones]);

  // ── Recepcionistas (crear / eliminar) ──────────────────────────────────────
  const [nuevoNombre, setNuevoNombre] = useState('');
  const crearRecMut = useMutation({
    mutationFn: () => composicionSedeApi.crearRecepcionista(nuevoNombre.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comp-recepcionistas'] });
      setNuevoNombre('');
      setModalRecepOpen(false);
      toast.success('Recepcionista creada');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarRecMut = useMutation({
    mutationFn: (id: string) => composicionSedeApi.eliminarRecepcionista(id),
    onSuccess: () => { invalidarTodo(); toast.success('Recepcionista eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Asignar a sede ─────────────────────────────────────────────────────────
  const { inicio: mesIni } = rangoMesISO(mes);
  const [cargo, setCargo] = useState<'doctor' | 'recepcionista'>('doctor');
  const [personaId, setPersonaId] = useState('');
  const [sedeAsig, setSedeAsig] = useState('');
  const [desde, setDesde] = useState(mesIni);
  const [hasta, setHasta] = useState('');
  const [notas, setNotas] = useState('');

  const opciones = cargo === 'doctor'
    ? doctores.map(d => ({ id: d.id, nombre: d.nombre }))
    : recepcionistas.filter(r => r.activo).map(r => ({ id: r.id, nombre: r.nombre }));

  const crearAsigMut = useMutation({
    mutationFn: () => composicionSedeApi.crearAsignacion({
      sedeId: sedeAsig,
      fechaInicio: desde,
      fechaFin: hasta || null,
      profesionalId: cargo === 'doctor' ? personaId : null,
      recepcionistaId: cargo === 'recepcionista' ? personaId : null,
      notas: notas.trim() || undefined,
    }),
    onSuccess: () => {
      invalidarTodo();
      setPersonaId(''); setNotas(''); setHasta('');
      setModalAsignarOpen(false);
      toast.success('Asignación creada');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarAsigMut = useMutation({
    mutationFn: (id: string) => composicionSedeApi.eliminarAsignacion(id),
    onSuccess: () => { invalidarTodo(); toast.success('Asignación eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const asignacionValida = !!sedeAsig && !!personaId && !!desde && (!hasta || hasta >= desde);

  // Vista de impresión (matriz A4) en pestaña nueva → el usuario imprime a PDF.
  const abrirImprimible = () => window.open(`/imprimir/composicion-sede?mes=${mes}`, '_blank', 'noopener');

  return {
    puedeGestionar,
    // Mes
    mes, setMes,
    mesAnterior: () => setMes(m => sumarMes(m, -1)),
    mesSiguiente: () => setMes(m => sumarMes(m, 1)),
    etiquetaMesActual: etiquetaMes(mes),
    dias: diasDelMes(mes),
    // Vista / selección
    vista, setVista,
    sedeSelId, setSedeSelId,
    sedeSeleccionada,
    // Data
    comp, sedesComp, isLoading,
    sedes, colorPorSede,
    doctores, recepcionistas, asignaciones,
    totales,
    sedeDeRecepcionista,
    // Modales
    modalAsignarOpen, setModalAsignarOpen,
    modalRecepOpen, setModalRecepOpen,
    // Recepcionistas
    nuevoNombre, setNuevoNombre, crearRecMut, eliminarRecMut,
    // Asignación
    cargo, setCargo, personaId, setPersonaId, sedeAsig, setSedeAsig,
    desde, setDesde, hasta, setHasta, notas, setNotas,
    opciones, asignacionValida, crearAsigMut, eliminarAsigMut,
    // PDF
    abrirImprimible,
  };
}
