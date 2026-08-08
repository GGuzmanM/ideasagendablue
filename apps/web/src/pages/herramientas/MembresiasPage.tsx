// Constructor de Membresías (Herramientas — admin/dirección).
// Las membresías viven en el módulo Promociones (tipo MEMBRESIA) con contabilidad
// de sesiones. REGLA DE VERSIONADO: editar aquí NO altera las ya vendidas (la
// composición se copia como snapshot al vender).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../../api/client';
import { sedesApi, serviciosApi, pacientesApi } from '../../api';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../utils/cn';
import { ContratoMembresiaModal } from '../../components/membresias/ContratoMembresiaModal';
import { imprimirContratoMembresia, verContratoMembresia } from '../../api/membresias';

interface ItemComp { servicioId: string; cantidad: number; etiqueta?: string; subcategoriaId?: string | null; subcategoriaEtiqueta?: string }
interface Membresia {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number | null;
  activo: boolean;
  duracionMeses: number | null;
  sedesHabilitadas: string[] | null;
  composicion: ItemComp[];
  totalSesiones: number;
  ventas: number;
  tieneContrato?: boolean;
  contratoCampos?: number;
}

const KEY = ['membresias'];

// Fechas civiles YYYY-MM-DD (hora local). Para la vigencia de la membresía al vender.
const hoyISO = () => new Date().toLocaleDateString('en-CA');
function sumarMesesISO(iso: string, meses: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setMonth(d.getMonth() + meses);
  return d.toLocaleDateString('en-CA');
}

export function MembresiasPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: membresias, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api.get<Membresia[]>('/membresias') });
  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data: servicios } = useQuery({ queryKey: ['servicios-todos'], queryFn: () => serviciosApi.listar({ activo: true }) });
  const [editando, setEditando] = useState<Membresia | 'nueva' | null>(null);
  const [vendiendo, setVendiendo] = useState<Membresia | null>(null);
  const [configContrato, setConfigContrato] = useState<Membresia | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const invalidar = () => qc.invalidateQueries({ queryKey: KEY });

  const filtradas = (membresias ?? []).filter((m) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return m.nombre.toLowerCase().includes(q) || m.composicion.some((i) => (i.etiqueta ?? '').toLowerCase().includes(q));
  });

  const desactivarMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/membresias/${id}`),
    onSuccess: () => { invalidar(); toast.success('Membresía desactivada (las vendidas siguen vivas)'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const activarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/membresias/${id}/activar`),
    onSuccess: () => { invalidar(); toast.success('Membresía reactivada — ya se puede vender'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-5 bg-surface-container-lowest border-b border-outline-variant/30 flex items-center gap-4 shrink-0">
        <button
          onClick={() => navigate('/herramientas')}
          className="w-9 h-9 rounded-xl grid place-items-center text-on-surface-variant hover:bg-surface-container transition shrink-0"
          title="Volver a Herramientas"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="w-11 h-11 rounded-xl bg-primary/10 grid place-items-center shrink-0">
          <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>card_membership</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-on-surface tracking-tight">Plantillas de membresías</h1>
          <p className="text-sm text-on-surface-variant hidden lg:block">Editar una plantilla NO altera las ya vendidas (snapshot al vender)</p>
        </div>
        <div className="flex-1" />
        <div className="relative w-64 max-w-[45vw]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">search</span>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar membresía…" className="input text-sm w-full !pl-10" />
        </div>
        <button onClick={() => setEditando('nueva')} className="bg-primary text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-lg">add</span> Nueva membresía
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-2.5 bg-surface">
        {isLoading && [1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
        {!isLoading && filtradas.length === 0 && <p className="text-center text-on-surface-variant/60 py-16 text-sm">{busqueda.trim() ? 'Sin membresías que coincidan con la búsqueda.' : 'Sin membresías — crea la primera'}</p>}
        {filtradas.map((m) => (
          <div key={m.id} className={cn('bg-surface-container-lowest rounded-2xl border px-5 py-3.5 flex items-center gap-3 flex-wrap shadow-sm', m.activo ? 'border-outline-variant/30' : 'border-outline-variant/20 opacity-60')}>
            <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
              <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-on-surface">
                {m.nombre} {!m.activo && <span className="text-[10px] text-on-surface-variant/50 font-normal">(inactiva)</span>}
              </p>
              <p className="text-xs text-on-surface-variant">
                {m.duracionMeses} meses · {m.totalSesiones} sesiones ({m.composicion.map((i) => `${i.cantidad}× ${i.etiqueta}${i.subcategoriaEtiqueta ? ` (${i.subcategoriaEtiqueta})` : ''}`).join(' + ')})
                {m.precio != null && ` · S/ ${m.precio}`}
                · {m.sedesHabilitadas?.length ? `${m.sedesHabilitadas.length} sedes` : 'todas las sedes'}
                · <b className="text-on-surface">{m.ventas} vendidas</b>
              </p>
            </div>
            {m.activo && (
              <button onClick={() => setVendiendo(m)} className="bg-primary text-white px-3.5 py-2 rounded-xl font-bold text-sm shadow-sm hover:opacity-90 active:scale-95 transition flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base">sell</span> Vender
              </button>
            )}
            <button
              onClick={() => setConfigContrato(m)}
              className={cn('px-3 py-2 rounded-xl text-sm font-semibold border flex items-center gap-1.5 transition',
                m.tieneContrato ? 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100' : 'text-on-surface-variant border-outline-variant/50 hover:bg-surface-container')}
              title="Contrato de la membresía"
            >
              <span className="material-symbols-outlined text-base">contract</span>
              {m.tieneContrato ? 'Contrato ✓' : 'Contrato'}
            </button>
            <button onClick={() => setEditando(m)} className="px-3 py-2 rounded-xl text-sm font-semibold border border-outline-variant/50 text-on-surface hover:bg-surface-container transition flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">edit</span> Editar
            </button>
            {m.activo ? (
              <button
                onClick={() => { if (window.confirm(`¿Desactivar "${m.nombre}"? Las vendidas siguen consumibles.`)) desactivarMutation.mutate(m.id); }}
                className="px-3 py-2 rounded-xl text-sm font-semibold text-error border border-error/30 hover:bg-error/10 transition"
              >
                Desactivar
              </button>
            ) : (
              <button
                onClick={() => activarMutation.mutate(m.id)}
                disabled={activarMutation.isPending}
                className="px-3 py-2 rounded-xl text-sm font-semibold text-emerald-700 border border-emerald-200 hover:bg-emerald-50 transition disabled:opacity-50"
              >
                Activar
              </button>
            )}
          </div>
        ))}
      </div>

      {editando && (
        <FormMembresia
          membresia={editando === 'nueva' ? null : editando}
          sedes={sedes ?? []}
          servicios={(servicios ?? []).map((s) => ({ id: s.id, nombre: s.nombre, subcategorias: s.subcategorias ?? [] }))}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { invalidar(); setEditando(null); }}
        />
      )}

      {vendiendo && (
        <VenderMembresia
          membresia={vendiendo}
          sedes={sedes ?? []}
          onCerrar={() => setVendiendo(null)}
          onVendida={() => { invalidar(); setVendiendo(null); }}
        />
      )}

      {configContrato && (
        <ContratoMembresiaModal
          promoId={configContrato.id}
          nombre={configContrato.nombre}
          onCerrar={() => { invalidar(); setConfigContrato(null); }}
        />
      )}
    </div>
  );
}

// ─── Form crear/editar ────────────────────────────────────────────────────────

function FormMembresia({ membresia, sedes, servicios, onCerrar, onGuardado }: {
  membresia: Membresia | null;
  sedes: { id: string; nombre: string }[];
  servicios: { id: string; nombre: string; subcategorias: { id: string; nombre: string; precioReferencial: number | null }[] }[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(membresia?.nombre ?? '');
  const [duracion, setDuracion] = useState(membresia?.duracionMeses ?? 12);
  const [precio, setPrecio] = useState<string>(membresia?.precio != null ? String(membresia.precio) : '');
  const [sedesSel, setSedesSel] = useState<string[]>(membresia?.sedesHabilitadas ?? []);
  const [items, setItems] = useState<ItemComp[]>(membresia?.composicion ?? [{ servicioId: '', cantidad: 12 }]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        nombre: nombre.trim(),
        duracionMeses: duracion,
        precio: precio ? Number(precio) : null,
        // SIEMPRE se envía (aunque sea []): [] = todas las sedes. Con `undefined` el PATCH no
        // actualizaba el campo, así que no se podía "limpiar" para dejarla en todas las sedes.
        sedesHabilitadas: sedesSel,
        composicion: items.filter((i) => i.servicioId && i.cantidad > 0).map((i) => ({ servicioId: i.servicioId, cantidad: i.cantidad, ...(i.subcategoriaId ? { subcategoriaId: i.subcategoriaId } : {}) })),
      };
      return membresia ? api.patch(`/membresias/${membresia.id}`, body) : api.post('/membresias', body);
    },
    onSuccess: () => { toast.success(membresia ? 'Membresía actualizada (ventas previas intactas)' : 'Membresía creada'); onGuardado(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-inverse-surface/40 backdrop-blur-[2px]" onClick={onCerrar} />
      <div className="fixed z-[80] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-w-[95vw] max-h-[88vh] overflow-hidden bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/30 flex flex-col" role="dialog">
        <div className="bg-[#0044ab] px-5 py-3.5 flex items-center gap-2.5 shrink-0">
          <span className="material-symbols-outlined text-white/90" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
          <h2 className="text-white font-bold text-sm flex-1 min-w-0 truncate">{membresia ? `Editar · ${membresia.nombre}` : 'Nueva membresía'}</h2>
          <button onClick={onCerrar} className="material-symbols-outlined text-white/80 hover:text-white">close</button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto custom-scrollbar">
        {membresia && membresia.ventas > 0 && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            ⚠ {membresia.ventas} ya vendidas: NO cambiarán (snapshot). Los cambios aplican a ventas futuras.
          </p>
        )}
        <label className="block text-xs text-on-surface-variant">Nombre
          <input className="input text-sm" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <label className="block text-xs text-on-surface-variant flex-1">Duración (meses)
            <input type="number" min={1} className="input text-sm" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} />
          </label>
          <label className="block text-xs text-on-surface-variant flex-1">Precio S/ (opcional)
            <input type="number" min={0} className="input text-sm" value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </label>
        </div>
        <div>
          <p className="text-xs text-on-surface-variant mb-1">Sedes donde se vende (ninguna marcada = TODAS)</p>
          <div className="flex gap-1.5 flex-wrap">
            {sedes.map((s) => (
              <button key={s.id} type="button"
                onClick={() => setSedesSel((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                className={cn('px-2.5 py-1 rounded-lg text-xs border font-medium', sedesSel.includes(s.id) ? 'bg-primary text-white border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/50')}>
                {s.nombre}
              </button>
            ))}
          </div>
          {/* Aviso claro del alcance real: evita restringir por accidente (ojo: el botón "One" es
              la SEDE One, no el nombre de la membresía). */}
          <p className={cn('text-xxs mt-1 font-medium', sedesSel.length === 0 ? 'text-emerald-600' : 'text-amber-600')}>
            {sedesSel.length === 0
              ? '✓ Se venderá y usará en TODAS las sedes.'
              : `⚠ Solo en: ${sedes.filter(s => sedesSel.includes(s.id)).map(s => s.nombre).join(', ')}. Deselecciona todas para dejarla en todas las sedes.`}
          </p>
        </div>
        <div>
          <p className="text-xs text-on-surface-variant mb-1">Composición (servicio + cantidad)</p>
          <div className="space-y-1.5">
            {items.map((item, i) => {
              const subs = servicios.find((s) => s.id === item.servicioId)?.subcategorias ?? [];
              return (
              <div key={i} className="space-y-1">
                <div className="flex gap-1.5 items-center">
                  <select className="input text-xs flex-1" value={item.servicioId}
                    onChange={(e) => setItems((prev) => prev.map((x, j) => j === i ? { ...x, servicioId: e.target.value, subcategoriaId: null } : x))}>
                    <option value="">— servicio —</option>
                    {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                  <input type="number" min={1} className="input text-xs w-16" value={item.cantidad} onChange={(e) => setItems((prev) => prev.map((x, j) => j === i ? { ...x, cantidad: Number(e.target.value) } : x))} />
                  <button type="button" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 text-xs px-1">✕</button>
                </div>
                {subs.length > 0 && (
                  <select className="input text-xs w-full" value={item.subcategoriaId ?? ''}
                    onChange={(e) => setItems((prev) => prev.map((x, j) => j === i ? { ...x, subcategoriaId: e.target.value || null } : x))}>
                    <option value="">Tipo: elegir al vender</option>
                    {subs.map((sc) => <option key={sc.id} value={sc.id}>Tipo: {sc.nombre}{sc.precioReferencial != null ? ` · S/ ${Number(sc.precioReferencial).toFixed(2)}` : ''}</option>)}
                  </select>
                )}
              </div>
            );})}
          </div>
          <button type="button" onClick={() => setItems((prev) => [...prev, { servicioId: '', cantidad: 1 }])} className="mt-1 text-xs font-semibold text-primary hover:underline">+ Agregar ítem</button>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !nombre.trim() || items.every((i) => !i.servicioId)}
            className="flex-1 bg-primary text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
          >
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={onCerrar} className="px-4 py-2.5 rounded-xl font-bold text-sm border border-outline-variant/50 text-on-surface hover:bg-surface-container transition">Cancelar</button>
        </div>
        </div>
      </div>
    </>
  );
}

// ─── Vender a un paciente ─────────────────────────────────────────────────────

function VenderMembresia({ membresia, sedes, onCerrar, onVendida }: {
  membresia: Membresia;
  sedes: { id: string; nombre: string }[];
  onCerrar: () => void;
  onVendida: () => void;
}) {
  const [q, setQ] = useState('');
  const [pacienteId, setPacienteId] = useState('');
  const [sedeId, setSedeId] = useState('');
  // Vigencia editable (fechas abiertas): inicio + fin. El fin se sugiere por la duración,
  // pero se puede cambiar. La membresía solo sirve para agendar dentro de [inicio, fin].
  const [inicio, setInicio] = useState(hoyISO());
  const [fin, setFin] = useState(() => sumarMesesISO(hoyISO(), membresia.duracionMeses ?? 12));
  // Subcategoría FIJADA al vender: servicioId → subcategoriaId (ej. Profilaxis → Premium).
  const [subcatSel, setSubcatSel] = useState<Record<string, string>>({});
  const rangoInvalido = fin <= inicio;
  const { data: resultados } = useQuery({
    queryKey: ['pacientes-buscar', q],
    queryFn: () => pacientesApi.buscar(q),
    enabled: q.length >= 2,
  });
  // Servicios (con sus subcategorías activas) para saber qué ítems exigen elegir una.
  const { data: servicios } = useQuery({ queryKey: ['servicios-all'], queryFn: () => serviciosApi.listar({ activo: true }) });
  const subcatsPorServicio = new Map((servicios ?? []).map((s) => [s.id, s.subcategorias ?? []]));
  // Ítems que requieren elegir subcategoría AL VENDER: servicio con subcategorías activas y
  // SIN una ya fijada en el constructor (esas se respetan tal cual, no se vuelven a preguntar).
  const itemsConSubcat = membresia.composicion.filter((i) => !i.subcategoriaId && (subcatsPorServicio.get(i.servicioId)?.length ?? 0) > 0);
  const faltanSubcats = itemsConSubcat.some((i) => !subcatSel[i.servicioId]);

  const habilitadas = membresia.sedesHabilitadas?.length ? sedes.filter((s) => membresia.sedesHabilitadas!.includes(s.id)) : sedes;
  const mutation = useMutation({
    mutationFn: () => api.post(`/membresias/${membresia.id}/vender`, {
      pacienteId, sedeId, fechaVenta: inicio, fechaFin: fin,
      subcategorias: Object.entries(subcatSel).map(([servicioId, subcategoriaId]) => ({ servicioId, subcategoriaId })),
    }),
    onSuccess: async () => {
      toast.success('Membresía vendida — paquete activo con snapshot');
      // Si la membresía tiene contrato configurado, se imprime pre-llenado automáticamente.
      if (membresia.tieneContrato && pacienteId) {
        try { await imprimirContratoMembresia(membresia.id, pacienteId); }
        catch (e) { toast.error('Vendida, pero no se pudo imprimir el contrato: ' + (e as Error).message); }
      }
      onVendida();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-inverse-surface/40 backdrop-blur-[2px]" onClick={onCerrar} />
      <div className="fixed z-[80] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[95vw] max-h-[90vh] overflow-hidden bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/30 flex flex-col" role="dialog">
        <div className="bg-[#0044ab] px-5 py-3.5 flex items-center gap-2.5 shrink-0">
          <span className="material-symbols-outlined text-white/90">sell</span>
          <h2 className="text-white font-bold text-sm flex-1 min-w-0 truncate">Vender · {membresia.nombre}</h2>
          <button onClick={onCerrar} className="material-symbols-outlined text-white/80 hover:text-white">close</button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto custom-scrollbar">
        <input className="input text-sm" placeholder="Buscar paciente (nombre o DNI)…" value={q} onChange={(e) => { setQ(e.target.value); setPacienteId(''); }} />
        <div className="max-h-36 overflow-y-auto space-y-1">
          {resultados?.map((p) => (
            <button key={p.id} onClick={() => setPacienteId(p.id)} className={cn('w-full text-left px-2 py-1.5 rounded-lg text-xs border', pacienteId === p.id ? 'border-primary bg-primary/5' : 'border-outline-variant/20 hover:bg-surface-container-low')}>
              {p.nombreCompleto} · {p.numeroDocumento}
            </button>
          ))}
        </div>
        <label className="block text-xs text-on-surface-variant">Sede (donde se vende = donde se atiende)
          <select className="input text-sm" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
            <option value="">— sede —</option>
            {habilitadas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        {/* Vigencia (fechas abiertas): solo se puede agendar/consumir dentro de este rango. */}
        <div className="flex gap-2">
          <label className="block text-xs text-on-surface-variant flex-1">Inicio de vigencia
            <input type="date" className="input text-sm" value={inicio}
              onChange={(e) => { const v = e.target.value; setInicio(v); if (v) setFin(sumarMesesISO(v, membresia.duracionMeses ?? 12)); }} />
          </label>
          <label className="block text-xs text-on-surface-variant flex-1">Fin de vigencia
            <input type="date" className={cn('input text-sm', rangoInvalido && 'border-rose-400')} value={fin} min={inicio} onChange={(e) => setFin(e.target.value)} />
          </label>
        </div>
        {rangoInvalido && <p className="text-xxs text-rose-500">El fin debe ser posterior al inicio.</p>}
        {/* Subcategoría FIJADA al vender: por cada ítem cuyo servicio la requiera (ej. Profilaxis) */}
        {itemsConSubcat.map((item) => (
          <label key={item.servicioId} className="block text-xs text-on-surface-variant">
            Tipo de {item.etiqueta ?? 'servicio'} <span className="text-red-500">*</span>
            <select className="input text-sm" value={subcatSel[item.servicioId] ?? ''} onChange={(e) => setSubcatSel((prev) => ({ ...prev, [item.servicioId]: e.target.value }))}>
              <option value="">— elegir tipo —</option>
              {(subcatsPorServicio.get(item.servicioId) ?? []).map((sc) => (
                <option key={sc.id} value={sc.id}>{sc.nombre}{sc.precioReferencial != null ? ` · S/ ${Number(sc.precioReferencial).toFixed(2)}` : ''}</option>
              ))}
            </select>
          </label>
        ))}
        {/* Ver el contrato pre-llenado con los datos del paciente ANTES de confirmar la venta. */}
        {membresia.tieneContrato && (
          <button
            onClick={() => verContratoMembresia(membresia.id, { pacienteId }).catch((e: Error) => toast.error(e.message))}
            disabled={!pacienteId}
            className="w-full border border-primary/40 text-primary rounded-xl px-3 py-2 text-sm font-semibold hover:bg-primary/5 disabled:opacity-40 flex items-center justify-center gap-1.5 transition"
          >
            <span className="material-symbols-outlined text-base">visibility</span>
            Ver contrato antes de vender
          </button>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !pacienteId || !sedeId || faltanSubcats || rangoInvalido} className="flex-1 bg-primary text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition disabled:opacity-50">
            {mutation.isPending ? 'Vendiendo…' : 'Confirmar venta'}
          </button>
          <button onClick={onCerrar} className="px-4 py-2.5 rounded-xl font-bold text-sm border border-outline-variant/50 text-on-surface hover:bg-surface-container transition">Cancelar</button>
        </div>
        </div>
      </div>
    </>
  );
}
