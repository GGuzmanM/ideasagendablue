import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { composicionSedeApi, type Composicion, type PersonaRoster } from '../../api/composicionSede';
import { baroSolicitudApi, type BaroSolicitudData } from '../../api/baroSolicitud';
import { movimientosApi } from '../../api/movimientos';
import { esProfesionalNoMovible } from '../../services/movimientosService';
import { useAuthStore } from '../../stores/authStore';

// Documento imprimible de los CAMBIOS DE PERSONAL de un mes, comparando contra el mes anterior.
// Por cada tipo (Recepción / Doctores / Podología / Fisioterapia) y persona indica si CAMBIÓ de
// sede, es NUEVO, se mantiene SIN CAMBIOS, o fue BAJA. Reutiliza el patrón de impresión (masthead
// + botón "Imprimir → Guardar PDF"). Se abre con window.open('/imprimir/movimientos?mes=…').
// Las máquinas de baro no aparecen (no forman parte de estos 4 cargos y no se mueven).

const CARGOS = [
  { key: 'recepcionistas',  label: 'Recepción',    role: '#3F7A5E' },
  { key: 'doctores',        label: 'Doctores',     role: '#9A6B2F' },
  { key: 'podologas',       label: 'Podología',    role: '#1E6E9E' },
  { key: 'fisioterapeutas', label: 'Fisioterapia', role: '#4B4E8A' },
] as const;

type CargoKey = typeof CARGOS[number]['key'];

function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function mesAnteriorISO(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y!, m! - 2, 1); // m es 1-based → mes anterior = índice m-2
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function ultimoDiaDe(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  const dd = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${mes}-${String(dd).padStart(2, '0')}`;
}
// `desde` interno = 'YYYY-MM-DD' (ordenable como string). Mostrar como "13 de ago".
function diaCorto(ymd: string) {
  try { return format(parseISO(ymd), "d 'de' MMM", { locale: es }); } catch { return ymd; }
}
function ddmmyyyyAYmd(s: string) { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; }

interface EntradaMes { id: string; nombre: string; sedeId: string; sedeNombre: string; desde: string; motivo?: string | null }
type Estado = 'cambio' | 'nuevo' | 'igual' | 'baja';
interface Fila extends EntradaMes { estado: Estado; sedeAnterior?: string }

// Compara dos "fotos" (mapas id→sede) y produce las filas con estado. Genérico: sirve para
// composición (podólogas/fisios/recepción) y para el roster de baro (doctores).
const ORDEN_ESTADO: Record<Estado, number> = { cambio: 0, nuevo: 1, igual: 2, baja: 3 };
function compararFotos(act: Map<string, EntradaMes>, prev: Map<string, EntradaMes>): Fila[] {
  const filas: Fila[] = [];
  for (const [id, cur] of act) {
    const antes = prev.get(id);
    if (!antes) filas.push({ ...cur, estado: 'nuevo' });
    else if (antes.sedeId !== cur.sedeId) filas.push({ ...cur, estado: 'cambio', sedeAnterior: antes.sedeNombre });
    else filas.push({ ...cur, estado: 'igual' });
  }
  for (const [id, antes] of prev) if (!act.has(id)) filas.push({ ...antes, estado: 'baja' });
  return filas.sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.nombre.localeCompare(b.nombre));
}

// Foto de un cargo desde la composición (sede "final" del mes = mayor `desde`).
function rosterPorCargo(comp: Composicion | undefined, cargo: CargoKey): Map<string, EntradaMes> {
  const map = new Map<string, EntradaMes>();
  for (const sede of comp?.sedes ?? []) {
    for (const p of sede[cargo] as PersonaRoster[]) {
      const desde = ddmmyyyyAYmd(p.desde);
      const cur: EntradaMes = { id: p.id, nombre: p.nombre, sedeId: sede.sedeId, sedeNombre: sede.nombre, desde, motivo: p.motivo };
      const prev = map.get(p.id);
      if (!prev || desde > prev.desde) map.set(p.id, cur);
    }
  }
  return map;
}

// Foto de los DOCTORES DE BARO desde baroMedicoSede (roster vigente a esa fecha). Fuente única,
// la misma que alimenta el combo de médico en Nueva Cita.
function rosterBaro(data: BaroSolicitudData | undefined): Map<string, EntradaMes> {
  const map = new Map<string, EntradaMes>();
  for (const p of data?.porSolicitud ?? []) {
    if (!p.sedeId) continue;
    // Solo DOCTORES REALES (tipo=medico). Una podóloga habilitada para baro "por solicitud"
    // (p.ej. Erika, Daniel) sigue en el combo, pero NO es doctora → no va en esta sección;
    // aparece en Podología, que es su rol real.
    if (p.tipo !== 'medico') continue;
    const desde = p.fechaInicio ?? '';
    const cur: EntradaMes = { id: p.id, nombre: p.nombre, sedeId: p.sedeId, sedeNombre: p.sedeNombre ?? '—', desde, motivo: p.motivo ?? null };
    const prev = map.get(p.id);
    if (!prev || desde > prev.desde) map.set(p.id, cur);
  }
  return map;
}

const CSS = `
:root {
  --paper:#E9EEF3; --doc:#FFFFFF;
  --ink:#0E2233; --ink-2:#31465A; --body:#283A49;
  --muted:#788894; --faint:#A9B5C0;
  --line:#E4EAEF; --line-2:#EEF2F6;
  --jade:#0E9C88; --jade-deep:#0A7D6E; --jade-tint:#E6F5F1; --jade-soft:#63C7B7;
}
@page { size: A4 portrait; margin: 12mm; }

.mp-shell { background: var(--paper); min-height: 100vh; padding: 26px 18px 56px;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--body); -webkit-font-smoothing: antialiased; }

.mp-toolbar { max-width: 820px; margin: 0 auto 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mp-hint { font-size: 12.5px; color: var(--muted); }
.mp-hint b { color: var(--ink-2); font-weight: 600; }
.mp-btns { display: flex; gap: 8px; }
.mp-btn { border: 1px solid #CBD5DE; background: #fff; border-radius: 9px; padding: 9px 17px; font-size: 12.5px; font-weight: 500; cursor: pointer; color: #3A4C5C; transition: background .12s, border-color .12s; }
.mp-btn:hover { background: #F4F7F9; }
.mp-btn-primary { background: var(--ink); border-color: var(--ink); color: #fff; }
.mp-btn-primary:hover { background: #163247; }

.mp-doc { max-width: 820px; margin: 0 auto; background: var(--doc); border-radius: 5px;
  box-shadow: 0 18px 48px rgba(14,34,51,.14), 0 2px 6px rgba(14,34,51,.06); overflow: hidden;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }

.mp-mast { position: relative; background: var(--ink); color: #fff; padding: 15px 28px;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.mp-mast::after { content:''; position:absolute; left:0; right:0; bottom:0; height:3px;
  background: linear-gradient(90deg, var(--jade) 0%, var(--jade) 34%, var(--jade-soft) 100%); }
.mp-mast-l { display: flex; align-items: center; gap: 16px; }
.mp-logo { width: 98px; height: 56px; overflow: hidden; flex-shrink: 0; }
.mp-logo img { width: 116px; height: 116px; max-width: none; margin: -28.9px 0 0 -8.9px; display: block; }
.mp-title { margin: 0; font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto;
  font-weight: 500; font-size: 26px; line-height: 1.02; letter-spacing: -.01em; color: #fff; }
.mp-mast-r { text-align: right; flex-shrink: 0; }
.mp-period-lbl { font-size: 8.5px; letter-spacing: .26em; text-transform: uppercase; color: #7E93A5; }
.mp-period-val { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 21px; line-height: 1.05; color: #fff; text-transform: capitalize; margin-top: 1px; }
.mp-summary { margin-top: 5px; font-size: 10px; color: #A6B8C6; }
.mp-summary b { color: #fff; font-weight: 600; }

.mp-body { padding: 8px 24px 4px; }
/* Las secciones grandes (p.ej. 33 podólogas) DEBEN poder partirse entre páginas A4; solo
   evitamos cortar una fila o dejar un encabezado huérfano al final de la página. */
.mp-cargo { margin-top: 14px; break-inside: auto; }
.mp-cargo:first-child { margin-top: 6px; }
.mp-cargo-head { display: flex; align-items: center; gap: 8px; padding: 5px 2px 6px; border-bottom: 2px solid var(--role); margin-bottom: 4px; break-inside: avoid; break-after: avoid; }
.mp-cargo-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--role); }
.mp-cargo-nom { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink); }
.mp-cargo-cnt { font-size: 9px; font-weight: 600; color: var(--muted); background: #F1F5F8; border-radius: 20px; padding: 1px 8px; }
.mp-cargo-cnt.changes { color: var(--jade-deep); background: var(--jade-tint); }

.mp-row { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 10px; padding: 4px 2px; border-bottom: 1px solid var(--line-2); break-inside: avoid; }
.mp-row:last-child { border-bottom: 0; }
.mp-name { font-size: 11.5px; font-weight: 600; color: var(--ink); }
.mp-name.baja { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--faint); }
.mp-status { font-size: 10.5px; text-align: right; }
.mp-arrow { font-weight: 700; color: var(--jade-deep); }
.mp-sede { font-weight: 600; color: var(--body); }
.mp-desde { color: var(--muted); }
.mp-antes { color: var(--faint); }
.mp-igual { color: var(--faint); }
.mp-igual .mp-sede { color: var(--muted); font-weight: 500; }
.mp-nuevo { color: #1E5E96; font-weight: 600; }
.mp-baja { color: #B44; }
.mp-badge { display: inline-block; margin-left: 5px; padding: .5px 6px 1px; border-radius: 20px; font-size: 7.5px; font-weight: 700;
  letter-spacing: .04em; text-transform: uppercase; background: var(--jade-tint); color: var(--jade-deep); white-space: nowrap; }
.mp-empty { font-size: 10px; color: var(--faint); padding: 4px 2px; }

.mp-foot { padding: 10px 28px; border-top: 1px solid var(--line-2); font-size: 8.5px; color: var(--faint);
  display: flex; justify-content: space-between; gap: 12px; }
.mp-legend { display: flex; gap: 12px; flex-wrap: wrap; }
.mp-state { max-width: 640px; margin: 90px auto; text-align: center; color: var(--muted); font-size: 15px; }

@media print {
  /* La app pone overflow:hidden en el body (SPA), lo que RECORTA la impresión a una sola hoja.
     Aquí se anula en cadena (html/body/#root) para que el documento fluya en varias páginas A4. */
  html, body, #root { height: auto !important; overflow: visible !important; }
  .mp-shell { background: #fff; padding: 0; min-height: 0; overflow: visible; }
  .mp-toolbar { display: none; }
  /* overflow visible = el contenido FLUYE a las páginas siguientes (con overflow:hidden se
     recortaba a una sola hoja A4). */
  .mp-doc { max-width: none; margin: 0; border-radius: 0; box-shadow: none; overflow: visible; }
  html, body { background: #fff; }
  .mp-doc, .mp-mast, .mp-badge, .mp-cargo-dot, .mp-mast::after, .mp-cargo-head { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

function EstadoTexto({ f }: { f: Fila }) {
  if (f.estado === 'cambio') return (
    <span>
      {f.sedeAnterior && <span className="mp-antes">de {f.sedeAnterior} </span>}
      <span className="mp-arrow">cambia a </span><span className="mp-sede">{f.sedeNombre}</span>
      <span className="mp-desde"> desde el {diaCorto(f.desde)}</span>
      {/* "OTRO" es el motivo genérico → no se muestra; solo motivos reales (Cobertura, Vacaciones…). */}
      {f.motivo && !/^otro$/i.test(f.motivo.trim()) && <span className="mp-badge">{f.motivo}</span>}
    </span>
  );
  if (f.estado === 'nuevo') return (
    <span className="mp-nuevo">Nuevo · {f.sedeNombre}<span className="mp-desde" style={{ fontWeight: 400 }}> · desde el {diaCorto(f.desde)}</span></span>
  );
  if (f.estado === 'baja') return <span className="mp-baja">Ya no figura · antes {f.sedeNombre}</span>;
  return <span className="mp-igual"><span className="mp-sede">{f.sedeNombre}</span> · Sin cambios</span>;
}

export function MovimientosImprimirPage() {
  const [params] = useSearchParams();
  const mes = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : mesActualISO();
  const mesPrev = mesAnteriorISO(mes);
  const token = useAuthStore(s => s.token);

  // MODO "desde": con ?desde=YYYY-MM-DD el PDF lista los cambios que ARRANCAN entre el día
  // SIGUIENTE y el fin de ese mes (planificación "de hoy hasta que cambie el mes"). Sin `desde`,
  // el modo normal compara el mes vs el anterior.
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(params.get('desde') ?? '') ? params.get('desde')! : null;
  // El tope es el 1° del mes SIGUIENTE (incluido): los cambios suelen entrar en el cambio de mes.
  const finMesDesde = desde ? (() => {
    const [y, m] = desde.slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(y!, m!, 1)); // m es 1-based → índice m = mes siguiente, día 1
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  })() : '';
  const aYmdRango = (s: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.split('/').reverse().join('-') : s);
  const enRangoDesde = (ymd: string) => !!ymd && !!desde && ymd > desde && ymd <= finMesDesde;

  const { data: compAct, isLoading: l1, isError: e1 } = useQuery({
    queryKey: ['composicion-imprimir', mes], queryFn: () => composicionSedeApi.composicion(mes), enabled: !!token && !desde,
  });
  const { data: compPrev, isLoading: l2 } = useQuery({
    queryKey: ['composicion-imprimir', mesPrev], queryFn: () => composicionSedeApi.composicion(mesPrev), enabled: !!token && !desde,
  });
  const finMes = ultimoDiaDe(mes);
  const finMesPrev = ultimoDiaDe(mesPrev);
  const { data: baroAct } = useQuery({
    queryKey: ['baro-roster-pdf', finMes], queryFn: () => baroSolicitudApi.obtener(undefined, finMes), enabled: !!token && !desde,
  });
  const { data: baroPrev } = useQuery({
    queryKey: ['baro-roster-pdf', finMesPrev], queryFn: () => baroSolicitudApi.obtener(undefined, finMesPrev), enabled: !!token && !desde,
  });

  // Fuentes del modo "desde": movimientos (podología/fisio) + recepción + baro que INICIEN en rango.
  const { data: movsDesde } = useQuery({ queryKey: ['mov-desde'], queryFn: () => movimientosApi.listar({}), enabled: !!token && !!desde });
  const { data: recepDesde } = useQuery({ queryKey: ['recep-desde'], queryFn: () => composicionSedeApi.asignaciones(), enabled: !!token && !!desde });
  const { data: baroDesde } = useQuery({ queryKey: ['baro-desde'], queryFn: () => baroSolicitudApi.obtener(), enabled: !!token && !!desde });

  const seccionesComparacion = useMemo(
    () => CARGOS.map(c => c.key === 'doctores'
      ? { ...c, filas: compararFotos(rosterBaro(baroAct), rosterBaro(baroPrev)) }
      : { ...c, filas: compararFotos(rosterPorCargo(compAct, c.key), rosterPorCargo(compPrev, c.key)) }),
    [compAct, compPrev, baroAct, baroPrev],
  );

  const seccionesDesde = useMemo(() => {
    const porCargo: Record<CargoKey, Fila[]> = { recepcionistas: [], doctores: [], podologas: [], fisioterapeutas: [] };
    // Sede ACTUAL (vigente el día marcado) por persona → para mostrar el ORIGEN del cambio.
    const actual = new Map<string, { sede: string; ini: string }>();
    const setActual = (key: string, sede: string, ini: string) => { const p = actual.get(key); if (!p || ini > p.ini) actual.set(key, { sede, ini }); };
    const vigenteEnDesde = (ini: string, fin: string | null) => !!desde && ini <= desde && (!fin || fin >= desde);
    for (const m of movsDesde ?? []) {
      const ini = m.fechaInicio.slice(0, 10); const fin = m.fechaFin ? m.fechaFin.slice(0, 10) : null;
      if (vigenteEnDesde(ini, fin)) setActual(`p:${m.profesionalId}`, m.sede.nombre, ini);
    }
    for (const a of recepDesde ?? []) {
      if (a.cargo !== 'recepcionista' || !a.personaId) continue;
      const ini = aYmdRango(a.fechaInicio); const fin = a.fechaFin ? aYmdRango(a.fechaFin) : null;
      if (vigenteEnDesde(ini, fin)) setActual(`r:${a.personaId}`, a.sedeNombre, ini);
    }
    for (const p of baroDesde?.porSolicitud ?? []) {
      if (p.tipo !== 'medico' || !p.sedeId) continue;
      const ini = p.fechaInicio ?? ''; const fin = p.fechaFin ?? null;
      if (vigenteEnDesde(ini, fin)) setActual(`b:${p.id}`, p.sedeNombre ?? '', ini);
    }
    const origen = (key: string, destino: string) => { const a = actual.get(key)?.sede; return a && a !== destino ? a : undefined; };

    for (const m of movsDesde ?? []) {
      if (esProfesionalNoMovible(m.profesional)) continue; // baro/"Adicional" no van en Podología/Fisio
      const ymd = m.fechaInicio.slice(0, 10);
      if (!enRangoDesde(ymd)) continue;
      const fila: Fila = { id: m.id, nombre: `${m.profesional.nombres} ${m.profesional.apellidos}`, sedeId: m.sedeId, sedeNombre: m.sede.nombre, desde: ymd, motivo: m.motivoLabel ?? m.motivo, estado: 'cambio', sedeAnterior: origen(`p:${m.profesionalId}`, m.sede.nombre) };
      (m.profesional.tipo === 'fisioterapeuta' ? porCargo.fisioterapeutas : porCargo.podologas).push(fila);
    }
    for (const a of recepDesde ?? []) {
      if (a.cargo !== 'recepcionista') continue;
      const ymd = aYmdRango(a.fechaInicio);
      if (!enRangoDesde(ymd)) continue;
      porCargo.recepcionistas.push({ id: a.id, nombre: a.personaNombre, sedeId: a.sedeId, sedeNombre: a.sedeNombre, desde: ymd, motivo: null, estado: 'cambio', sedeAnterior: a.personaId ? origen(`r:${a.personaId}`, a.sedeNombre) : undefined });
    }
    for (const p of baroDesde?.porSolicitud ?? []) {
      if (p.tipo !== 'medico' || !p.sedeId) continue;
      const ymd = p.fechaInicio ?? '';
      if (!enRangoDesde(ymd)) continue;
      porCargo.doctores.push({ id: `${p.id}-${p.sedeId}-${ymd}`, nombre: p.nombre, sedeId: p.sedeId, sedeNombre: p.sedeNombre ?? '', desde: ymd, motivo: p.motivo ?? null, estado: 'cambio', sedeAnterior: origen(`b:${p.id}`, p.sedeNombre ?? '') });
    }
    return CARGOS.map(c => ({ ...c, filas: porCargo[c.key].sort((a, b) => a.desde.localeCompare(b.desde)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movsDesde, recepDesde, baroDesde, desde]);

  const secciones = desde ? seccionesDesde : seccionesComparacion;
  const cargandoDesde = !!desde && (movsDesde === undefined || recepDesde === undefined || baroDesde === undefined);

  const resumen = useMemo(() => {
    const todas = secciones.flatMap(s => s.filas);
    return {
      cambios: todas.filter(f => f.estado === 'cambio').length,
      nuevos: todas.filter(f => f.estado === 'nuevo').length,
      bajas: todas.filter(f => f.estado === 'baja').length,
    };
  }, [secciones]);

  const mesLabel = useMemo(() => format(parseISO(`${mes}-01`), 'MMMM yyyy', { locale: es }), [mes]);
  const mesPrevLabel = useMemo(() => format(parseISO(`${mesPrev}-01`), 'MMMM', { locale: es }), [mesPrev]);

  if (!token) return <div className="mp-shell"><div className="mp-state">Inicia sesión en el sistema para ver este documento.</div></div>;

  return (
    <div className="mp-shell">
      <style>{CSS}</style>

      <div className="mp-toolbar">
        <span className="mp-hint">Vista de impresión — usa <b>Imprimir → Guardar como PDF</b>.</span>
        <div className="mp-btns">
          <button className="mp-btn" onClick={() => window.close()}>Cerrar</button>
          <button className="mp-btn mp-btn-primary" onClick={() => window.print()}>Imprimir / Guardar PDF</button>
        </div>
      </div>

      {(l1 || l2 || cargandoDesde) ? (
        <div className="mp-state">{desde ? 'Buscando cambios próximos…' : `Comparando ${mesLabel} con ${mesPrevLabel}…`}</div>
      ) : (!desde && (e1 || !compAct)) ? (
        <div className="mp-state">No se pudo cargar la composición. Reintenta desde la herramienta.</div>
      ) : (
        <div className="mp-doc">
          <div className="mp-mast">
            <div className="mp-mast-l">
              <div className="mp-logo"><img src="/logo-login.png" alt="Limablue" /></div>
              <h1 className="mp-title">{desde ? 'Cambios próximos' : 'Cambios de personal'}</h1>
            </div>
            <div className="mp-mast-r">
              <div className="mp-period-lbl">{desde ? `Hasta el 1° de ${format(parseISO(finMesDesde), 'MMMM', { locale: es })}` : `Periodo · vs ${mesPrevLabel}`}</div>
              <div className="mp-period-val">{desde ? format(parseISO(`${desde.slice(0, 7)}-01`), 'MMMM yyyy', { locale: es }) : mesLabel}</div>
              <div className="mp-summary">
                {desde
                  ? <><b>{resumen.cambios}</b> cambios · posteriores al {diaCorto(desde)}</>
                  : <><b>{resumen.cambios}</b> cambios · <b>{resumen.nuevos}</b> nuevos · <b>{resumen.bajas}</b> bajas</>}
              </div>
            </div>
          </div>

          <div className="mp-body">
            {secciones.map(s => {
              // Solo los que CAMBIAN (cambio / nuevo / baja); se omiten los "Sin cambios".
              const cambiadas = s.filas.filter(f => f.estado !== 'igual');
              return (
                <div key={s.key} className="mp-cargo" style={{ ['--role' as string]: s.role }}>
                  <div className="mp-cargo-head">
                    <span className="mp-cargo-dot" />
                    <span className="mp-cargo-nom">{s.label}</span>
                    <span className={`mp-cargo-cnt${cambiadas.length ? ' changes' : ''}`}>
                      {cambiadas.length ? `${cambiadas.length} ${cambiadas.length === 1 ? 'cambio' : 'cambios'}` : 'sin cambios'}
                    </span>
                  </div>
                  {cambiadas.length === 0 ? (
                    <div className="mp-empty">{desde ? 'Sin cambios próximos.' : 'Sin cambios este mes.'}</div>
                  ) : (
                    cambiadas.map(f => (
                      <div key={`${f.id}-${f.estado}`} className="mp-row">
                        <span className={`mp-name${f.estado === 'baja' ? ' baja' : ''}`}>{f.nombre}</span>
                        <span className="mp-status"><EstadoTexto f={f} /></span>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>

          <div className="mp-foot">
            <span className="mp-legend">
              {desde
                ? <span>Cambios que arrancan después del {diaCorto(desde)} hasta el 1° de {format(parseISO(finMesDesde), 'MMMM', { locale: es })}</span>
                : <span>Solo cambios vs {mesPrevLabel}</span>}
              <span><b style={{ color: 'var(--jade-deep)' }}>cambia a</b> = cambia de sede</span>
              {!desde && <span>Nuevo = ingresó · Ya no figura = baja</span>}
            </span>
            <span>Generado el {format(new Date(), "d 'de' MMM yyyy, HH:mm", { locale: es })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
