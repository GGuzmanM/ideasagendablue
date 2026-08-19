import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { sedesApi, type Sede } from '../api';
import { movimientosApi, type Movimiento } from '../api/movimientos';
import { useAuthStore } from '../stores/authStore';

// ── Tipos / constantes de dominio ────────────────────────────────────────────
export type Vista = 'hoy' | 'proximo' | 'historial';

/** Color de badge + acento por motivo, alineado con la paleta idea1. */
export const MOTIVO_STYLE: Record<string, { badge: string; accent: string }> = {
  VACACIONES:           { badge: 'bg-sky-100 text-sky-800',         accent: 'border-l-sky-400' },
  CAMBIO_POR_TIEMPO:    { badge: 'bg-violet-100 text-violet-800',   accent: 'border-l-violet-400' },
  CERCANIA_A_CASA:      { badge: 'bg-emerald-100 text-emerald-800', accent: 'border-l-emerald-400' },
  PROBLEMAS_INTERNOS:   { badge: 'bg-red-100 text-red-800',         accent: 'border-l-red-400' },
  COBERTURA_EMERGENCIA: { badge: 'bg-amber-100 text-amber-800',     accent: 'border-l-amber-400' },
  OTRO:                 { badge: 'bg-surface-container text-on-surface-variant', accent: 'border-l-outline-variant' },
};

// ── Helpers puros (sin hooks) ────────────────────────────────────────────────

/** Una podóloga es "cobertura" (cambio temporal) si tiene motivo específico o fecha de fin. */
export const esCobertura = (m: Movimiento) => m.motivo !== 'OTRO' || !!m.fechaFin;

/** Los campos son @db.Date (medianoche UTC); parsear solo YYYY-MM-DD evita el desfase −1 día en Lima. */
export const soloFecha = (iso: string) => parseISO(iso.slice(0, 10));

export const rangoFechas = (m: Movimiento) => {
  const ini = format(soloFecha(m.fechaInicio), 'd MMM', { locale: es });
  if (!m.fechaFin) return `Desde ${ini}`;
  return `${ini} → ${format(soloFecha(m.fechaFin), 'd MMM', { locale: es })}`;
};

export const cuentaRegresiva = (m: Movimiento) => {
  const dias = differenceInCalendarDays(soloFecha(m.fechaInicio), new Date());
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  if (dias <= 30) return `En ${dias} días`;
  return null;
};

export const iniciales = (p: { nombres: string; apellidos: string }) =>
  `${p.nombres[0] ?? ''}${p.apellidos[0] ?? ''}`.toUpperCase();

/** Profesionales de Baropodometría son fijos de cada sede y no se mueven. */
export function esProfesionalBaro(p?: { tipo?: string; unidadNegocio?: { nombre: string } | null; nombres?: string; apellidos?: string } | null): boolean {
  if (!p) return false;
  if (p.tipo === 'medico') return true;
  if (p.unidadNegocio?.nombre?.toLowerCase().includes('baro')) return true;
  if (p.nombres?.toLowerCase().includes('baro')) return true;
  if (p.apellidos?.toLowerCase().includes('baro')) return true;
  return false;
}

/** Profesionales que NO se pueden mover ni deben figurar en el tablero de movimientos (Adicional o Baropodometría). */
export const esProfesionalNoMovible = (p?: { tipo?: string; unidadNegocio?: { nombre: string } | null; nombres?: string; apellidos?: string } | null) =>
  !p || !p.nombres || p.nombres.trim().toLowerCase() === 'adicional' || esProfesionalBaro(p);

// ── Hook principal: agrupa data + mutations + filtros + estado de vista ──────
export function useMovimientosData() {
  const qc = useQueryClient();
  const { usuario } = useAuthStore();
  const canWrite = usuario?.rol === 'admin' || usuario?.rol === 'coordinadora_sedes';

  const [vista, setVista] = useState<Vista>('hoy');
  const [busqueda, setBusqueda] = useState('');
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<Movimiento | null>(null);
  const [sedePrefill, setSedePrefill] = useState<string | undefined>();
  const hoyStr = format(new Date(), 'yyyy-MM-dd');
  const [fechaVista, setFechaVista] = useState(hoyStr);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });

  const proximosQ = useQuery({
    queryKey: ['movimientos', 'proximo'],
    queryFn: () => movimientosApi.listar({ estado: 'proximo' }),
  });
  const historialQ = useQuery({
    queryKey: ['movimientos', 'historial'],
    queryFn: () => movimientosApi.listar({ estado: 'historial' }),
    enabled: vista === 'historial',
  });
  // TODAS las asignaciones (sin filtro de estado) — el tablero por día resuelve la sede
  // vigente SOLO por rango de fechas, igual que la agenda (una sola semántica de vigencia).
  // Sin esto, una asignación cerrada cuyo rango aún cubre el día (p.ej. la base que termina
  // hoy) desaparecía del tablero aunque la agenda sí la mostrara.
  const todosQ = useQuery({
    queryKey: ['movimientos', 'todos'],
    queryFn: () => movimientosApi.listar({}),
  });

  // ── Mutation: eliminar con impacto previo ──────────────────────────────────
  const eliminarMutation = useMutation({
    mutationFn: (id: string) => movimientosApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimientos'] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['citas'] });
      toast.success('Movimiento eliminado · la agenda se actualizó');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Confirma con el usuario según el impacto real (si es la asignación BASE, si tiene sede
   * predecesora, cuántas citas quedan huérfanas) y elimina. Mantiene la UX del sistema viejo.
   */
  const handleEliminar = async (mov: Movimiento) => {
    const prof = `${mov.profesional.nombres} ${mov.profesional.apellidos}`;
    let mensaje: string;
    try {
      const imp = await movimientosApi.impacto(mov.id);
      if (!imp.tienePredecesor) {
        mensaje = `⚠ ATENCIÓN: esta es la asignación BASE de ${prof}.\n\nAl eliminarla quedará SIN sede asignada y desaparecerá de la agenda (no hay una sede anterior a la que volver).\n\nSi solo quieres moverla a otra sede, usa "+ Nuevo movimiento".\n\n¿Eliminar de todas formas?`;
      } else {
        mensaje = `¿Eliminar este movimiento?\n\n${prof} volverá a ${imp.sedeAnteriorNombre ?? 'su sede anterior'} y su columna se quitará de ${mov.sede.nombre} en la agenda.`;
        if (imp.citasAfectadas > 0) {
          mensaje += `\n\n⚠ Hay ${imp.citasAfectadas} cita(s) de ${prof} en ${mov.sede.nombre} dentro del periodo. Revísalas o reprográmalas: esa sede dejará de tenerle asignación.`;
        }
      }
    } catch {
      mensaje = `¿Eliminar este movimiento? ${prof} volverá a su asignación anterior.`;
    }
    if (!confirm(mensaje)) return;
    eliminarMutation.mutate(mov.id);
  };

  // ── Controles del modal ────────────────────────────────────────────────────
  const abrirNuevo = (sedeId?: string) => {
    setEditando(null);
    setSedePrefill(sedeId);
    setModalAbierto(true);
  };
  const abrirEditar = (m: Movimiento) => {
    setEditando(m);
    setSedePrefill(undefined);
    setModalAbierto(true);
  };
  const cerrarModal = () => {
    setModalAbierto(false);
    setEditando(null);
    setSedePrefill(undefined);
  };

  // ── Derivados (filtros por vista) ──────────────────────────────────────────
  const query = busqueda.toLowerCase().trim();
  const coincide = (m: Movimiento) =>
    !query || `${m.profesional.nombres} ${m.profesional.apellidos}`.toLowerCase().includes(query);

  const todas = todosQ.data ?? [];

  // Tablero: quién está en cada sede el día elegido. VIGENCIA = el rango de fechas cubre el día.
  // NOTA: NO se filtra por `activa` a secas — una base "reemplazada" por un movimiento FUTURO queda
  // activa=false pero sigue siendo la sede vigente hasta que arranque ese movimiento. En cambio, si
  // dos filas cubren el mismo día (solape: una cerrada que aún cubre + la nueva), la persona NO debe
  // salir en dos sedes → DEDUP por profesional: gana la ACTIVA; si empatan, la de inicio más reciente.
  const enFecha = (m: Movimiento) =>
    m.fechaInicio.slice(0, 10) <= fechaVista &&
    (!m.fechaFin || m.fechaFin.slice(0, 10) >= fechaVista);

  const tableroMovs = useMemo(
    () => {
      const cubren = todas.filter(enFecha).filter(m => !esProfesionalNoMovible(m.profesional)).filter(coincide);
      const porProf = new Map<string, Movimiento>();
      for (const m of cubren) {
        const prev = porProf.get(m.profesionalId);
        const gana = !prev
          || (m.activa !== prev.activa ? m.activa           // la activa gana
              : m.fechaInicio.slice(0, 10) > prev.fechaInicio.slice(0, 10)); // si empatan, la más reciente
        if (gana) porProf.set(m.profesionalId, m);
      }
      return [...porProf.values()];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todas, fechaVista, query],
  );

  // Cambios programados relativos a la fecha vista (arranca después del día elegido).
  const cambiosPorSede = useMemo(
    () =>
      todas
        .filter(m => m.activa && m.fechaInicio.slice(0, 10) > fechaVista && !esProfesionalNoMovible(m.profesional))
        .reduce<Record<string, number>>((acc, m) => {
          acc[m.sedeId] = (acc[m.sedeId] ?? 0) + 1;
          return acc;
        }, {}),
    [todas, fechaVista],
  );

  const proximos = useMemo(
    () => (proximosQ.data ?? []).filter(m => !esProfesionalNoMovible(m.profesional)).filter(coincide).sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proximosQ.data, query],
  );
  const historial = useMemo(
    () => (historialQ.data ?? []).filter(m => !esProfesionalNoMovible(m.profesional)).filter(coincide).sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historialQ.data, query],
  );

  const cargando =
    vista === 'hoy' ? todosQ.isLoading :
    vista === 'proximo' ? proximosQ.isLoading :
    historialQ.isLoading;

  const sedesActivas: Sede[] = (sedes ?? []).filter(s => s.activa);

  return {
    // Permisos / estado global
    canWrite,
    // Estado de vista + búsqueda
    vista, setVista,
    busqueda, setBusqueda,
    query,
    // Estado del modal
    modalAbierto, editando, sedePrefill,
    abrirNuevo, abrirEditar, cerrarModal,
    // Fecha del tablero
    hoyStr, fechaVista, setFechaVista,
    // Data
    sedesActivas,
    tableroMovs,
    cambiosPorSede,
    proximos,
    historial,
    proximosCount: proximos.length, // el badge cuenta lo mismo que se lista (excluye no-movibles y respeta búsqueda)
    cargando,
    // Acciones
    handleEliminar,
  };
}
