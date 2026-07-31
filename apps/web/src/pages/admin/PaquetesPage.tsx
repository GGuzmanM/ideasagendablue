import { useState } from 'react';
import toast from 'react-hot-toast';
import { usePaquetesData } from '../../services/paquetesService';
import { AdminHeaderNav } from './AdminHeaderNav';
import { type Servicio, type PlantillaPaquete } from '../../api';
import { cn } from '../../utils/cn';

export function PaquetesPage() {
  const {
    paquetes,
    servicios,
    isLoading,
    editando,
    setEditando,
    creando,
    setCreando,
    crearMut,
    actualizarMut,
    eliminarMut,
  } = usePaquetesData();

  return (
    <div className="flex flex-col h-full overflow-hidden relative bg-background">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {/* Encabezado del contenido */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-headline-md text-lg font-bold text-on-surface">Paquetes de sesiones</h3>
            <p className="font-body-md text-sm text-on-surface-variant mt-0.5">
              Los paquetes activos aparecen como un círculo numerado en las tarjetas de la agenda.
            </p>
          </div>
          <button
            onClick={() => { setCreando(true); setEditando(null); }}
            className="bg-primary-container text-white font-label-md px-4 py-2 rounded-lg hover:bg-primary transition-colors shadow-sm flex items-center gap-2 text-sm font-semibold"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Nuevo paquete
          </button>
        </div>

        {/* Lista de paquetes */}
        {isLoading ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : (paquetes ?? []).length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl border border-dashed border-outline-variant p-12 text-center text-on-surface-variant max-w-4xl">
            <div className="text-4xl mb-3">📦</div>
            <p className="font-medium text-slate-800">Sin paquetes configurados</p>
            <p className="text-sm mt-1 text-slate-500">Crea el primer paquete con el botón de arriba</p>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl">
            {(paquetes ?? []).map(p => (
              <div
                key={p.id}
                className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-slate-200 flex items-center justify-between hover:border-outline-variant transition-colors group"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-base shadow-sm shrink-0"
                    style={{ backgroundColor: p.servicio.color || '#3538cd' }}
                    title="Así aparece en las tarjetas de agenda"
                  >
                    {p.totalSesiones}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="font-label-md font-semibold text-on-surface text-[14px] truncate">{p.nombre}</h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-on-surface-variant">
                      <span
                        className="w-2 h-2 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: p.servicio.color || '#3538cd' }}
                      />
                      <span className="font-medium text-slate-700">{p.servicio.nombre}</span>
                      <span className="text-slate-400">•</span>
                      <span>{p.totalSesiones} sesiones</span>
                      {p.precio && (
                        <>
                          <span className="text-slate-400">•</span>
                          <span className="font-medium text-slate-700">S/ {Number(p.precio).toFixed(2)}</span>
                        </>
                      )}
                      {p.consumeNoShow && (
                        <span className="text-xxs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">cuenta no-shows</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 opacity-90 group-hover:opacity-100 transition-opacity ml-4">
                  <button
                    onClick={() => { setEditando(p); setCreando(false); }}
                    className="px-3 py-1.5 border border-slate-200 rounded-md font-label-md text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => { if (confirm(`¿Eliminar "${p.nombre}"?`)) eliminarMut.mutate(p.id); }}
                    className="px-3 py-1.5 border border-red-200 rounded-md font-label-md text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-surface-container-low rounded-xl p-4 border border-slate-200 max-w-4xl">
          <p className="text-xs font-semibold text-slate-700 mb-1">¿Cómo funciona?</p>
          <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
            <li>Al crear una cita puedes vincularla a un paquete activo del paciente</li>
            <li>El número de sesión aparece como un círculo numerado en la tarjeta de la agenda</li>
            <li>Al marcar la cita como <strong>completada</strong> se incrementa automáticamente el contador de sesiones usadas</li>
            <li>Puedes elegir si los no-shows cuentan como sesión usada</li>
          </ul>
        </div>
      </div>

      {/* Modal a nivel raíz del componente */}
      {(creando || editando) && (
        <FormularioPaquete
          inicial={editando ?? undefined}
          servicios={servicios ?? []}
          onGuardar={(data) => {
            if (editando) {
              actualizarMut.mutate({ id: editando.id, data });
            } else {
              crearMut.mutate(data);
            }
          }}
          onCancelar={() => { setCreando(false); setEditando(null); }}
          guardando={crearMut.isPending || actualizarMut.isPending}
        />
      )}
    </div>
  );
}

interface FormularioPaqueteProps {
  inicial?: PlantillaPaquete;
  servicios: Servicio[];
  onGuardar: (data: { nombre: string; servicioId: string; totalSesiones: number; consumeNoShow: boolean; precio?: number }) => void;
  onCancelar: () => void;
  guardando: boolean;
}

function FormularioPaquete({ inicial, servicios, onGuardar, onCancelar, guardando }: FormularioPaqueteProps) {
  const [nombre, setNombre]               = useState(inicial?.nombre ?? '');
  const [servicioId, setServicioId]       = useState(inicial?.servicio.id ?? '');
  const [totalSesiones, setTotalSesiones] = useState(String(inicial?.totalSesiones ?? 10));
  const [precio, setPrecio]               = useState(inicial?.precio ? String(Number(inicial.precio)) : '');
  const [consumeNoShow, setConsumeNoShow] = useState(inicial?.consumeNoShow ?? false);

  const submit = () => {
    if (!nombre.trim() || !servicioId || !totalSesiones) { toast.error('Completa los campos obligatorios'); return; }
    onGuardar({
      nombre: nombre.trim(),
      servicioId,
      totalSesiones: parseInt(totalSesiones),
      consumeNoShow,
      ...(precio ? { precio: parseFloat(precio) } : {}),
    });
  };

  const SESIONES_RAPIDAS = [6, 12];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <h3 className="text-base font-bold text-slate-900">{inicial ? 'Editar paquete' : 'Nuevo paquete'}</h3>
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
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nombre del paquete *</label>
              <input
                className="input w-full text-sm"
                placeholder="Ej: Paquete Láser Alta 12 sesiones"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Servicio *</label>
              <select className="input w-full text-sm" value={servicioId} onChange={e => setServicioId(e.target.value)}>
                <option value="">Seleccionar servicio…</option>
                {servicios.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre} ({s.unidadNegocio.nombre})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">N° de sesiones *</label>
              <input
                className="input w-full text-sm"
                type="number"
                min="1"
                max="100"
                value={totalSesiones}
                onChange={e => setTotalSesiones(e.target.value)}
              />
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {SESIONES_RAPIDAS.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTotalSesiones(String(n))}
                    className={cn(
                      'text-xxs px-2 py-0.5 rounded-full border transition-all',
                      String(n) === totalSesiones
                        ? 'bg-limablue-600 text-white border-limablue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400'
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Precio S/ (opcional)</label>
              <input
                className="input w-full text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={precio}
                onChange={e => setPrecio(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 self-end pb-1">
              <input
                id="consume-noshow"
                type="checkbox"
                checked={consumeNoShow}
                onChange={e => setConsumeNoShow(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-limablue-600"
              />
              <label htmlFor="consume-noshow" className="text-xs text-slate-600 cursor-pointer">
                Los no-shows cuentan como sesión
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onCancelar} className="btn btn-secondary btn-sm">Cancelar</button>
          <button onClick={submit} disabled={guardando} className="btn btn-primary btn-sm">
            {guardando ? 'Guardando…' : (inicial ? 'Guardar cambios' : 'Crear paquete')}
          </button>
        </div>
      </div>
    </div>
  );
}
