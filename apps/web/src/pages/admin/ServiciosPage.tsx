import { useState } from 'react';
import toast from 'react-hot-toast';
import { useServiciosAdminData, useSubcategoriasData, FormServicio } from '../../services/serviciosAdminService';
import { AdminHeaderNav } from './AdminHeaderNav';
import { cn } from '../../utils/cn';

function FormularioServicio({
  inicial,
  unidades,
  onGuardar,
  onCancelar,
  guardando,
}: {
  inicial?: Partial<FormServicio>;
  unidades: { id: string; nombre: string }[];
  onGuardar: (data: FormServicio) => void;
  onCancelar: () => void;
  guardando: boolean;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '');
  const [duracionMinutos, setDuracionMinutos] = useState(inicial?.duracionMinutos ?? '30');
  const [color, setColor] = useState(inicial?.color ?? '#6B7F9E');
  const [precioReferencial, setPrecioReferencial] = useState(inicial?.precioReferencial ?? '');
  const [unidadNegocioId, setUnidadNegocioId] = useState(inicial?.unidadNegocioId ?? '');

  const submit = () => {
    if (!nombre.trim() || !unidadNegocioId || !duracionMinutos) {
      toast.error('Completa nombre, área y duración');
      return;
    }
    onGuardar({ nombre: nombre.trim(), codigo: codigo.trim(), duracionMinutos, color, precioReferencial, unidadNegocioId });
  };

  const DURACIONES = [30, 60];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <h3 className="text-base font-bold text-slate-900">{inicial?.nombre ? 'Editar servicio' : 'Nuevo servicio'}</h3>
          <button
            type="button"
            onClick={onCancelar}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nombre del servicio *</label>
              <input
                className="input w-full text-sm"
                placeholder="Ej: Láser Alta Intensidad"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Código</label>
              <input
                className="input w-full text-sm font-mono bg-slate-100 text-slate-500 cursor-not-allowed"
                value={codigo || 'Automático (POD-/BAR-/FIS-…)'}
                readOnly
                disabled
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Área *</label>
              <select className="input w-full text-sm" value={unidadNegocioId} onChange={e => setUnidadNegocioId(e.target.value)}>
                <option value="">Seleccionar área…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Duración (min) *</label>
              <input
                className="input w-full text-sm"
                type="number" min="5" max="240"
                value={duracionMinutos}
                onChange={e => setDuracionMinutos(e.target.value)}
              />
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {DURACIONES.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuracionMinutos(String(d))}
                    className={cn(
                      'text-xxs px-2 py-0.5 rounded-full border transition-all',
                      String(d) === duracionMinutos
                        ? 'bg-limablue-600 text-white border-limablue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400'
                    )}
                  >{d}m</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Precio ref. S/ (opcional)</label>
              <input
                className="input w-full text-sm"
                type="number" min="0" step="0.01" placeholder="0.00"
                value={precioReferencial}
                onChange={e => setPrecioReferencial(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Color en agenda</label>
              <div className="flex items-center gap-3">
                <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-slate-200" />
                <div className="flex gap-2 flex-wrap">
                  {['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#EF4444','#06B6D4','#F97316'].map(c => (
                    <button key={c} type="button" onClick={() => setColor(c)}
                      className={cn('w-6 h-6 rounded-full border-2 transition-all', color === c ? 'border-slate-800 scale-110' : 'border-transparent')}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <span className="text-xs px-2 py-0.5 rounded font-medium text-white" style={{ backgroundColor: color }}>{nombre || 'Vista previa'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onCancelar} className="btn btn-secondary btn-sm">Cancelar</button>
          <button onClick={submit} disabled={guardando} className="btn btn-primary btn-sm">
            {guardando ? 'Guardando…' : (inicial?.nombre ? 'Guardar cambios' : 'Crear servicio')}
          </button>
        </div>
      </div>
    </div>
  );
}

function GestionSubcategorias({ servicioId, servicioNombre }: { servicioId: string; servicioNombre: string }) {
  const { subs, isLoading, crearMut, editarMut, eliminarMut } = useSubcategoriasData(servicioId);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');

  const handleAgregar = () => {
    crearMut.mutate(
      { nombre: nuevoNombre, precio: nuevoPrecio },
      { onSuccess: () => { setNuevoNombre(''); setNuevoPrecio(''); } }
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-violet-800">Subcategorías de {servicioNombre}</p>
      {isLoading ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-1.5">
          {(subs ?? []).map(sc => (
            <FilaSubcategoria
              key={sc.id}
              sub={sc}
              onGuardar={(data) => editarMut.mutate({ id: sc.id, data })}
              onToggle={() => editarMut.mutate({ id: sc.id, data: { activo: !sc.activo } })}
              onEliminar={() => { if (confirm(`¿Eliminar la subcategoría "${sc.nombre}"?`)) eliminarMut.mutate(sc.id); }}
              guardando={editarMut.isPending}
            />
          ))}
          {(subs ?? []).length === 0 && <p className="text-xs text-slate-400">Sin subcategorías. Agrega la primera abajo.</p>}
        </div>
      )}
      {/* Alta */}
      <div className="flex items-center gap-2 pt-1">
        <input className="input text-xs flex-1" placeholder="Nombre (ej. Premium)" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} />
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400">S/</span>
          <input className="input text-xs w-20" type="number" min="0" step="0.5" placeholder="Precio" value={nuevoPrecio} onChange={e => setNuevoPrecio(e.target.value)} />
        </div>
        <button
          onClick={handleAgregar}
          disabled={crearMut.isPending || nuevoNombre.trim().length < 2}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          + Agregar
        </button>
      </div>
    </div>
  );
}

function FilaSubcategoria({ sub, onGuardar, onToggle, onEliminar, guardando }: {
  sub: { id: string; nombre: string; precioReferencial: number | null; activo?: boolean };
  onGuardar: (data: { nombre?: string; precioReferencial?: number | null }) => void;
  onToggle: () => void;
  onEliminar: () => void;
  guardando: boolean;
}) {
  const [nombre, setNombre] = useState(sub.nombre);
  const [precio, setPrecio] = useState(sub.precioReferencial != null ? String(Number(sub.precioReferencial)) : '');
  const cambiado = nombre.trim() !== sub.nombre || precio !== (sub.precioReferencial != null ? String(Number(sub.precioReferencial)) : '');
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-white', sub.activo === false ? 'opacity-50 border-slate-200' : 'border-violet-200')}>
      <input className="input text-xs flex-1" value={nombre} onChange={e => setNombre(e.target.value)} />
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-400">S/</span>
        <input className="input text-xs w-20" type="number" min="0" step="0.5" value={precio} onChange={e => setPrecio(e.target.value)} />
      </div>
      <button
        onClick={() => onGuardar({ nombre: nombre.trim(), precioReferencial: parseFloat(precio) > 0 ? parseFloat(precio) : null })}
        disabled={guardando || !cambiado || nombre.trim().length < 2}
        className="text-xs px-2.5 py-1 rounded-lg border border-limablue-200 text-limablue-600 hover:bg-limablue-50 disabled:opacity-40"
      >
        Guardar
      </button>
      <button onClick={onToggle} className={cn('text-xs px-2.5 py-1 rounded-lg border', sub.activo === false ? 'border-green-200 text-green-600 hover:bg-green-50' : 'border-amber-200 text-amber-600 hover:bg-amber-50')}>
        {sub.activo === false ? 'Activar' : 'Desactivar'}
      </button>
      <button onClick={onEliminar} className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">Eliminar</button>
    </div>
  );
}

export function ServiciosPage() {
  const {
    servicios,
    isLoading,
    unidades,
    creando,
    setCreando,
    editandoId,
    setEditandoId,
    subcatDe,
    setSubcatDe,
    mostrarInactivos,
    setMostrarInactivos,
    crearMut,
    editarMut,
    toggleActivoMut,
    serviciosPorUnidad,
  } = useServiciosAdminData();

  const srvEditando = editandoId ? servicios?.find(s => s.id === editandoId) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-6 space-y-5 max-w-4xl">
        {/* Controles */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setMostrarInactivos(false)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
                !mostrarInactivos ? 'bg-limablue-600 text-white border-limablue-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
            >
              Activos ({(servicios ?? []).filter(s => s.activo).length})
            </button>
            <button
              onClick={() => setMostrarInactivos(true)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
                mostrarInactivos ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
            >
              Inactivos ({(servicios ?? []).filter(s => !s.activo).length})
            </button>
          </div>
          <button
            onClick={() => { setCreando(true); setEditandoId(null); }}
            className="btn btn-primary btn-sm"
          >
            + Nuevo servicio
          </button>
        </div>

        {/* Tabla por área */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : Object.entries(serviciosPorUnidad).length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="font-medium">Sin servicios {mostrarInactivos ? 'inactivos' : 'activos'}</p>
          </div>
        ) : (
          Object.entries(serviciosPorUnidad).map(([unidad, lista]) => (
            <div key={unidad} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                <h3 className="font-semibold text-slate-800">{unidad}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-100">
                    <th className="px-5 py-2 text-left font-semibold">Servicio</th>
                    <th className="px-4 py-2 text-left font-semibold">Código</th>
                    <th className="px-4 py-2 text-left font-semibold">Duración</th>
                    <th className="px-4 py-2 text-left font-semibold">Precio ref.</th>
                    <th className="px-4 py-2 text-left font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(s => (
                    <>
                      <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/70">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="font-medium text-slate-800">{s.nombre}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{s.codigo}</td>
                        <td className="px-4 py-2.5 text-slate-600">{s.duracionMinutos} min</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {s.precioReferencial ? `S/ ${Number(s.precioReferencial).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setEditandoId(s.id); setCreando(false); }}
                              className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => setSubcatDe(prev => prev === s.id ? null : s.id)}
                              className={cn('text-xs px-2.5 py-1 rounded-lg border transition-colors',
                                subcatDe === s.id ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                              title="Subcategorías (ej. Profilaxis → Regular/Premium/…)"
                            >
                              Tipos{(s.subcategorias?.length ?? 0) > 0 ? ` (${s.subcategorias!.length})` : ''}
                            </button>
                            <button
                              onClick={() => toggleActivoMut.mutate({ id: s.id, activo: !s.activo })}
                              disabled={toggleActivoMut.isPending}
                              className={cn(
                                'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                                s.activo
                                  ? 'border-red-200 text-red-500 hover:bg-red-50'
                                  : 'border-green-200 text-green-600 hover:bg-green-50'
                              )}
                            >
                              {s.activo ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {subcatDe === s.id && (
                        <tr key={`${s.id}-subcat`} className="bg-violet-50/40">
                          <td colSpan={5} className="px-5 py-4">
                            <GestionSubcategorias servicioId={s.id} servicioNombre={s.nombre} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      {/* Modal a nivel raíz del componente */}
      {(creando || srvEditando) && (
        <FormularioServicio
          inicial={srvEditando ? {
            nombre: srvEditando.nombre,
            codigo: srvEditando.codigo,
            duracionMinutos: String(srvEditando.duracionMinutos),
            color: srvEditando.color,
            precioReferencial: srvEditando.precioReferencial ? String(Number(srvEditando.precioReferencial)) : '',
            unidadNegocioId: srvEditando.unidadNegocioId,
          } : undefined}
          unidades={unidades}
          onGuardar={(data) => {
            if (srvEditando) {
              editarMut.mutate({ id: srvEditando.id, data });
            } else {
              crearMut.mutate(data);
            }
          }}
          onCancelar={() => { setCreando(false); setEditandoId(null); }}
          guardando={crearMut.isPending || editarMut.isPending}
        />
      )}
    </div>
  );
}
