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
  const [colegiatura, setColegiatura] = useState(inicial?.colegiatura ?? '');
  const [colorAvatar, setColorAvatar] = useState(inicial?.colorAvatar ?? AVATAR_COLORES[0]);

  const submit = () => {
    if (!nombres.trim() || !apellidos.trim() || !unidadNegocioId) {
      toast.error('Completa nombres, apellidos y área');
      return;
    }
    onGuardar({
      nombres: nombres.trim(),
      apellidos: apellidos.trim(),
      tipo,
      unidadNegocioId,
      colegiatura: colegiatura.trim() || undefined,
      colorAvatar,
    });
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
              <label className="block text-xs font-semibold text-slate-500 mb-1">N° Colegiatura (Opcional)</label>
              <input
                className="input w-full text-sm font-mono"
                value={colegiatura}
                onChange={e => setColegiatura(e.target.value)}
                placeholder="Ej: CMP 12345, COP 9876, CTMP 4567..."
              />
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
    <div className="flex flex-col h-full overflow-hidden relative bg-background">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Controles superiores */}
        <div className="flex flex-wrap gap-3 items-end justify-between">
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Estado</label>
              <select className="input text-xs py-1.5" value={filtro} onChange={e => setFiltro(e.target.value as typeof filtro)}>
                <option value="activos">Solo activas</option>
                <option value="inactivos">Solo inactivas</option>
                <option value="todos">Todas</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Buscar</label>
              <input
                className="input text-xs py-1.5 w-52"
                placeholder="Nombre o apellido…"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
              />
            </div>
          </div>
          <button
            onClick={() => { setCreando(true); setEditandoId(null); }}
            className="bg-primary-container text-white font-label-md px-3.5 py-1.5 rounded-lg hover:bg-primary transition-colors shadow-sm flex items-center gap-1.5 text-xs font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Nueva podóloga
          </button>
        </div>

        {/* Lista en formato Cards compactas */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : profsFiltrados.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl border border-dashed border-outline-variant p-10 text-center text-on-surface-variant max-w-5xl">
            <p className="text-3xl mb-2">👤</p>
            <p className="font-medium text-slate-800 text-sm">Sin resultados</p>
            <p className="text-xs mt-1 text-slate-500">Ajusta los filtros o crea una nueva profesional</p>
          </div>
        ) : (
          <div className="space-y-2.5 max-w-5xl">
            {profsFiltrados.map(prof => (
              <div
                key={prof.id}
                className={cn(
                  'bg-surface-container-lowest rounded-xl px-4 py-2.5 shadow-2xs border border-slate-200 flex items-center justify-between hover:border-slate-300 transition-colors group',
                  !prof.activo && 'opacity-60 bg-slate-50/50'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar iniciales={prof.iniciales} color={prof.colorAvatar} size="sm" />
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-slate-800 text-[13px] truncate leading-tight">
                      {prof.nombres} {prof.apellidos}
                    </h4>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xxs text-slate-500">
                      <span className="font-medium text-slate-700">{TIPO_LABELS[prof.tipo] ?? prof.tipo}</span>
                      {prof.colegiatura && (
                        <>
                          <span className="text-slate-300">•</span>
                          <span className="bg-slate-100 text-slate-700 font-mono px-1.5 py-0.5 rounded text-[10px] font-semibold border border-slate-200/80">
                            Col: {prof.colegiatura}
                          </span>
                        </>
                      )}
                      <span className="text-slate-300">•</span>
                      <span>{prof.unidadNegocio.nombre}</span>
                      <span className="text-slate-300">•</span>
                      {prof.sedeActual ? (
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: prof.sedeActual.color }} />
                          <span className="font-medium text-slate-700">{prof.sedeActual.nombre}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Sin sede asignada</span>
                      )}
                      <span className="text-slate-300">•</span>
                      <span className={cn(
                        'px-1.5 py-0.2 rounded-full font-medium',
                        prof.activo ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'
                      )}>
                        {prof.activo ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 opacity-90 group-hover:opacity-100 transition-opacity ml-3">
                  <button
                    onClick={() => { setEditandoId(prof.id); setCreando(false); }}
                    className="px-2.5 py-1 border border-slate-200 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => toggleActivo(prof)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                      prof.activo
                        ? 'border-red-200 text-red-600 hover:bg-red-50'
                        : 'border-green-200 text-green-600 hover:bg-green-50'
                    )}
                  >
                    {prof.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-400 max-w-5xl pt-1">
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
            colegiatura: profEditando.colegiatura ?? '',
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
