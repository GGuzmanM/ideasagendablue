import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AdminHeaderNav } from './AdminHeaderNav';
import { cn } from '../../utils/cn';
import { useReservaWebServicios, type FiltroReservaWeb } from '../../services/reservaWebServiciosService';
import type { CambiosReservaWeb, ServicioReservaWeb } from '../../api';

const soles = (n: number | null) => (n == null ? '—' : `S/ ${Number(n).toFixed(2)}`);

/** Interruptor pequeño accesible (sí/no). */
function Interruptor({ activo, onCambiar, deshabilitado, etiqueta }: { activo: boolean; onCambiar: (v: boolean) => void; deshabilitado?: boolean; etiqueta: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={activo} aria-label={etiqueta} disabled={deshabilitado}
      onClick={() => onCambiar(!activo)}
      className={cn('relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        activo ? 'bg-emerald-500' : 'bg-slate-300')}
    >
      <span className={cn('inline-block h-3 w-3 rounded-full bg-white shadow transition-transform', activo ? 'translate-x-[14px]' : 'translate-x-0.5')} />
    </button>
  );
}

/** Precio web: se guarda al salir del campo o con Enter. Vacío = usa el precio de la clínica. */
function PrecioWeb({ valor, referencia, onGuardar, deshabilitado, etiqueta, ancho = 'w-24' }: { valor: number | null; referencia: number | null; onGuardar: (v: number | null) => void; deshabilitado?: boolean; etiqueta: string; ancho?: string }) {
  const [texto, setTexto] = useState(valor == null ? '' : String(valor));
  useEffect(() => { setTexto(valor == null ? '' : String(valor)); }, [valor]);

  const confirmar = () => {
    const limpio = texto.trim().replace(',', '.');
    const nuevo = limpio === '' ? null : Number(limpio);
    if (nuevo !== null && (!Number.isFinite(nuevo) || nuevo <= 0)) {
      toast.error('El precio debe ser un número mayor que 0 (o déjalo vacío para usar el de la clínica)');
      setTexto(valor == null ? '' : String(valor));
      return;
    }
    if (nuevo === valor) return;
    onGuardar(nuevo);
  };

  return (
    <div className={cn('relative', ancho)}>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">S/</span>
      <input
        className={cn('input w-full h-7 py-0 pl-6 pr-2 text-xs text-right tabular-nums', valor != null && 'border-limablue-300 bg-limablue-50/50 font-semibold')}
        inputMode="decimal" aria-label={etiqueta}
        value={texto} disabled={deshabilitado}
        placeholder={referencia != null ? Number(referencia).toFixed(2) : '—'}
        onChange={(e) => setTexto(e.target.value)} onBlur={confirmar}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </div>
  );
}

/**
 * Precio web propio de cada sede (30-oct-2026). Una sede sin precio usa el general (se ve en gris dentro del campo);
 * con precio propio se resalta. Se guarda igual que el general: al salir del campo o con Enter; vacío = quitarlo.
 */
function PreciosPorSede({ sedes, valores, general, onGuardar, deshabilitado, etiqueta }: {
  sedes: { id: string; nombre: string }[]; valores: Record<string, number>; general: number | null;
  onGuardar: (sedeId: string, v: number | null) => void; deshabilitado?: boolean; etiqueta: string;
}) {
  return (
    <div className="mt-1.5 mb-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2" data-testid="precios-por-sede">
      <p className="text-xxs text-slate-500 mb-1.5">
        Pon precio solo en las sedes que cobren distinto; las vacías cobran el general{general != null ? ` (${soles(general)})` : ' (sin precio: no se ofrece ahí)'}.
      </p>
      <div className="grid gap-x-6 gap-y-1 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
        {sedes.map((x) => {
          const propio = valores[x.id] != null;
          return (
            <div key={x.id} className="flex items-center justify-between gap-2">
              <span className={cn('text-xs truncate', propio ? 'font-semibold text-slate-800' : 'text-slate-600')} title={x.nombre}>{x.nombre}</span>
              <div className="flex items-center gap-1">
                <PrecioWeb
                  valor={valores[x.id] ?? null} referencia={general} etiqueta={`${etiqueta} en ${x.nombre}`}
                  deshabilitado={deshabilitado} onGuardar={(v) => onGuardar(x.id, v)}
                />
                <button
                  type="button" onClick={() => onGuardar(x.id, null)} disabled={!propio || deshabilitado}
                  aria-label={`Quitar el precio propio de ${x.nombre}`} title="Volver al precio general"
                  className={cn('w-4 text-xs leading-none', propio && !deshabilitado ? 'text-slate-400 hover:text-slate-700' : 'invisible')}
                >✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Botón que abre/cierra los precios por sede de una fila; muestra cuántas sedes tienen precio propio. */
function BotonSedes({ n, abierto, onClick }: { n: number; abierto: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} aria-expanded={abierto} title="Precios por sede"
      className={cn('text-[11px] leading-none font-semibold h-7 px-2 rounded-md border whitespace-nowrap transition-colors',
        n > 0 ? 'border-limablue-300 bg-limablue-50 text-limablue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
    >
      Sedes{n > 0 ? ` (${n})` : ''} {abierto ? '▴' : '▾'}
    </button>
  );
}

function FilaServicio({ s, puedeEditar, onServicio, onTipo, onSede }: {
  s: ServicioReservaWeb; puedeEditar: boolean;
  onServicio: (id: string, c: CambiosReservaWeb) => void; onTipo: (id: string, c: CambiosReservaWeb) => void;
  /** `tipo` = true cuando `id` es el de un tipo (subcategoría) y no el del servicio. */
  onSede: (id: string, tipo: boolean, sedeId: string, precio: number | null) => void;
}) {
  const tieneTipos = s.subcategorias.length > 0;
  // Qué fila tiene abiertos sus precios por sede: 's' = el servicio, o el id de un tipo.
  const [abierta, setAbierta] = useState<string | null>(null);
  const alternar = (k: string) => setAbierta((a) => (a === k ? null : k));
  const generalServicio = s.precioOnline ?? s.precioReferencial;
  return (
    <div className="px-3 py-1.5" data-testid="fila-reserva-web">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Interruptor
          activo={s.reservaOnline} etiqueta={`Ofrecer ${s.nombre} en la reserva web`}
          deshabilitado={!puedeEditar}
          onCambiar={(v) => onServicio(s.id, { reservaOnline: v })}
        />
        <div className="min-w-0 flex-1 basis-32 flex items-center gap-2">
          <span className={cn('text-[13px] truncate', s.reservaOnline ? 'font-semibold text-slate-900' : 'text-slate-700')} title={s.nombre}>{s.nombre}</span>
          <span className="font-mono text-[10px] px-1 bg-slate-100 text-slate-500 rounded truncate max-w-[7rem] hidden md:inline" title={s.codigo}>{s.codigo}</span>
          {s.reservaOnline && (
            <span
              className={cn('w-1.5 h-1.5 rounded-full shrink-0', s.ofrecido ? 'bg-emerald-500' : 'bg-amber-500')}
              title={s.ofrecido ? 'Visible en la web' : s.motivo ?? 'No se muestra'}
            />
          )}
          {s.reservaOnline && !s.ofrecido && s.motivo && <span className="text-xxs text-amber-700 truncate hidden lg:inline">{s.motivo}</span>}
        </div>
        <span className="text-xxs text-slate-400 w-24 text-right whitespace-nowrap hidden md:block" title="Precio en la clínica">Clínica {soles(s.precioReferencial)}</span>
        <span className="text-xxs text-slate-400 w-12 hidden sm:block">{s.duracionMinutos} min</span>
        <PrecioWeb
          valor={s.precioOnline} referencia={s.precioReferencial} etiqueta={`Precio web de ${s.nombre}`}
          deshabilitado={!puedeEditar}
          onGuardar={(v) => onServicio(s.id, { precioOnline: v })}
        />
        <BotonSedes n={Object.keys(s.preciosSede).length} abierto={abierta === 's'} onClick={() => alternar('s')} />
      </div>
      {abierta === 's' && (
        <PreciosPorSede
          sedes={s.sedes} valores={s.preciosSede} general={generalServicio} deshabilitado={!puedeEditar}
          etiqueta={`Precio web de ${s.nombre}`} onGuardar={(sedeId, v) => onSede(s.id, false, sedeId, v)}
        />
      )}

      {tieneTipos && (
        <div className="mt-1 ml-3 pl-5 border-l border-slate-200">
          {s.subcategorias.map((t) => (
            <div key={t.id} data-testid="fila-tipo-reserva-web" className="py-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Interruptor
                  activo={t.reservaOnline} etiqueta={`Ofrecer ${t.nombre} de ${s.nombre} en la web`}
                  deshabilitado={!puedeEditar}
                  onCambiar={(v) => onTipo(t.id, { reservaOnline: v })}
                />
                <span className="min-w-0 flex-1 basis-24 text-xs text-slate-700 truncate" title={t.nombre}>{t.nombre}</span>
                <span className="text-xxs text-slate-400 w-24 text-right whitespace-nowrap hidden md:block">Clínica {soles(t.precioReferencial)}</span>
                <span className="w-12 hidden sm:block" />
                <PrecioWeb
                  valor={t.precioOnline} referencia={t.precioReferencial ?? s.precioOnline ?? s.precioReferencial} etiqueta={`Precio web de ${t.nombre}`}
                  deshabilitado={!puedeEditar}
                  onGuardar={(v) => onTipo(t.id, { precioOnline: v })}
                />
                <BotonSedes n={Object.keys(t.preciosSede).length} abierto={abierta === t.id} onClick={() => alternar(t.id)} />
              </div>
              {abierta === t.id && (
                <PreciosPorSede
                  sedes={s.sedes} valores={t.preciosSede} general={t.precioOnline ?? t.precioReferencial ?? generalServicio} deshabilitado={!puedeEditar}
                  etiqueta={`Precio web de ${t.nombre}`} onGuardar={(sedeId, v) => onSede(t.id, true, sedeId, v)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const FILTROS: { id: FiltroReservaWeb; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'web', label: 'En la web' },
  { id: 'sin_web', label: 'Sin web' },
];

export function ReservaWebServiciosPage() {
  const { isLoading, puedeEditar, busqueda, setBusqueda, filtro, setFiltro, porUnidad, conWeb, ofrecidos, conteos, conPrecioPorSede, servicioMut, tipoMut, precioSedeMut } = useReservaWebServicios();

  // Las áreas que exigen elegir profesional no se reservan en línea: no se muestran.
  const unidades = porUnidad
    .map(([unidad, lista]) => [unidad, lista.filter((s) => !s.exigeProfesional)] as const)
    .filter(([, lista]) => lista.length > 0);

  return (
    <div className="flex flex-col h-full overflow-hidden relative bg-background">
      <AdminHeaderNav />
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        <div className="max-w-4xl">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h3 className="text-sm font-bold text-slate-900">Reserva web · servicios y precios</h3>
            <span className="text-xxs text-slate-500" data-testid="resumen-reserva-web">
              <b className="text-slate-700">{conWeb}</b> marcados · <b className="text-emerald-700">{ofrecidos}</b> visibles · <b className="text-limablue-700">{conPrecioPorSede}</b> con precio por sede
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Activa los servicios que se pueden reservar por internet (página de reservas y WhatsApp). Precio web vacío = precio de la clínica;
            «Sedes» permite cobrar distinto por sede. El pago se hace en la sede.
          </p>
          {!puedeEditar && <p className="text-xs text-amber-700 mt-1">Solo puedes ver esta lista; para cambiarla necesitas el permiso de editar servicios.</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 max-w-4xl">
          {FILTROS.map((f) => (
            <button
              key={f.id} onClick={() => setFiltro(f.id)}
              className={cn('px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                filtro === f.id ? 'bg-limablue-600 text-white border-limablue-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
            >
              {f.label} <span className={filtro === f.id ? 'text-white/70' : 'text-slate-400'}>{conteos[f.id]}</span>
            </button>
          ))}
          <input className="input text-xs h-7 py-0 w-56 ml-auto" placeholder="Buscar servicio o código…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar servicio" />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : unidades.length === 0 ? (
          <div className="bg-white rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500 text-sm max-w-4xl">No hay servicios con ese filtro</div>
        ) : unidades.map(([unidad, lista]) => (
          <section key={unidad} className="max-w-4xl bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200">
              <h3 className="font-bold text-xxs tracking-wide uppercase text-slate-600">{unidad}</h3>
              <span className="text-xxs text-slate-400">{lista.filter((s) => s.reservaOnline).length} de {lista.length} en la web</span>
            </div>
            <div className="divide-y divide-slate-100">
              {lista.map((s) => (
                <FilaServicio
                  key={s.id} s={s} puedeEditar={puedeEditar}
                  onServicio={(id, cambios) => servicioMut.mutate({ id, cambios })}
                  onTipo={(id, cambios) => tipoMut.mutate({ id, cambios })}
                  onSede={(id, tipo, sedeId, precio) => precioSedeMut.mutate({ id, tipo, sedeId, precio })}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
