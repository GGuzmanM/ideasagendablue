import { useState } from 'react';
import toast from 'react-hot-toast';
import { usePodologasData, FormProfesional, AVATAR_COLORES, TIPO_LABELS } from '../../services/podologasService';
import { AdminHeaderNav } from './AdminHeaderNav';
import { Avatar } from '../../components/ui/Avatar';
import { cn } from '../../utils/cn';

function FormularioProfesional({
  inicial,
  unidades,
  onGuardar,
  onCancelar,
  guardando,
}: {
  inicial?: Partial<FormProfesional>;
  unidades: { id: string; nombre: string }[];
  onGuardar: (data: FormProfesional) => void;
  onCancelar: () => void;
  guardando: boolean;
}) {
  const [nombres, setNombres] = useState(inicial?.nombres ?? '');
  const [apellidos, setApellidos] = useState(inicial?.apellidos ?? '');
  const [tipo, setTipo] = useState(inicial?.tipo ?? 'podologa');
  const [unidadNegocioId, setUnidadNegocioId] = useState(inicial?.unidadNegocioId ?? '');
  const [colorAvatar, setColorAvatar] = useState(inicial?.colorAvatar ?? AVATAR_COLORES[0]);

  const submit = () => {
    if (!nombres.trim() || !apellidos.trim() || !unidadNegocioId) {
      toast.error('Completa nombres, apellidos y área');
      return;
    }
    onGuardar({ nombres: nombres.trim(), apellidos: apellidos.trim(), tipo, unidadNegocioId, colorAvatar });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <h3 className="text-base font-bold text-slate-900">{inicial?.nombres ? 'Editar podóloga' : 'Nueva podóloga'}</h3>
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
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nombres *</label>
              <input className="input w-full text-sm" value={nombres} onChange={e => setNombres(e.target.value)} placeholder="Ej: Ana María" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Apellidos *</label>
              <input className="input w-full text-sm" value={apellidos} onChange={e => setApellidos(e.target.value)} placeholder="Ej: López Torres" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Tipo</label>
              <select className="input w-full text-sm" value={tipo} onChange={e => setTipo(e.target.value)}>
                {Object.entries(TIPO_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Área *</label>
              <select className="input w-full text-sm" value={unidadNegocioId} onChange={e => setUnidadNegocioId(e.target.value)}>
                <option value="">Seleccionar área…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Color de avatar</label>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLORES.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColorAvatar(c)}
                    className={cn(
                      'w-7 h-7 rounded-full border-2 transition-all',
                      colorAvatar === c ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-105'
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: colorAvatar }}
                >
                  {(nombres[0] ?? '?')}{(apellidos[0] ?? '')}
                </span>
                <span className="text-xs text-slate-500">Vista previa del avatar</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onCancelar} className="btn btn-secondary btn-sm">Cancelar</button>
          <button onClick={submit} disabled={guardando} className="btn btn-primary btn-sm">
            {guardando ? 'Guardando…' : (inicial?.nombres ? 'Guardar cambios' : 'Crear profesional')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PodologasPage() {
  const {
    isLoading,
    unidades,
    filtro,
    setFiltro,
    busqueda,
    setBusqueda,
    creando,
    setCreando,
    editandoId,
    setEditandoId,
    profsFiltrados,
    crearMut,
    editarMut,
    toggleActivo,
  } = usePodologasData();

  const profEditando = editandoId ? profsFiltrados.find(p => p.id === editandoId) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Controles superiores */}
        <div className="flex flex-wrap gap-3 items-end justify-between">
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Estado</label>
              <select className="input text-sm" value={filtro} onChange={e => setFiltro(e.target.value as typeof filtro)}>
                <option value="activos">Solo activas</option>
                <option value="inactivos">Solo inactivas</option>
                <option value="todos">Todas</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Buscar</label>
              <input
                className="input text-sm w-52"
                placeholder="Nombre o apellido…"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
              />
            </div>
          </div>
          <button
            onClick={() => { setCreando(true); setEditandoId(null); }}
            className="btn btn-primary btn-sm"
          >
            + Nueva podóloga
          </button>
        </div>

        {/* Lista */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : profsFiltrados.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
            <p className="text-3xl mb-2">👤</p>
            <p className="font-medium">Sin resultados</p>
            <p className="text-sm mt-1">Ajusta los filtros o crea una nueva profesional</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-2.5 text-left font-semibold">Profesional</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Tipo</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Área</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Sede actual</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Estado</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {profsFiltrados.map(prof => (
                  <tr key={prof.id} className={cn('border-b border-slate-50 hover:bg-slate-50/70', !prof.activo && 'opacity-60')}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar iniciales={prof.iniciales} color={prof.colorAvatar} size="sm" />
                        <div>
                          <p className="font-medium text-slate-800">{prof.nombres} {prof.apellidos}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{TIPO_LABELS[prof.tipo] ?? prof.tipo}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{prof.unidadNegocio.nombre}</td>
                    <td className="px-4 py-3 text-xs">
                      {prof.sedeActual ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: prof.sedeActual.color }} />
                          {prof.sedeActual.nombre}
                        </span>
                      ) : (
                        <span className="text-slate-400">Sin sede</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        prof.activo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      )}>
                        {prof.activo ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditandoId(prof.id); setCreando(false); }}
                          className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => toggleActivo(prof)}
                          className={cn(
                            'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                            prof.activo
                              ? 'border-red-200 text-red-500 hover:bg-red-50'
                              : 'border-green-200 text-green-600 hover:bg-green-50'
                          )}
                        >
                          {prof.activo ? 'Desactivar' : 'Reactivar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-slate-400">
          Las profesionales desactivadas no aparecen en la agenda ni en la lista de movimientos.
          Para asignar una profesional a una sede, usa el módulo de <strong>Movimientos</strong>.
        </p>
      </div>

      {/* Modal a nivel raíz del componente */}
      {(creando || profEditando) && (
        <FormularioProfesional
          inicial={profEditando ? {
            nombres: profEditando.nombres,
            apellidos: profEditando.apellidos,
            tipo: profEditando.tipo,
            unidadNegocioId: profEditando.unidadNegocio.id,
            colorAvatar: profEditando.colorAvatar,
          } : undefined}
          unidades={unidades}
          onGuardar={(data) => {
            if (profEditando) {
              editarMut.mutate({ id: profEditando.id, data });
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
