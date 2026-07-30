import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { combinacionesApi, type Combinacion } from '../../api/combinaciones';
import { serviciosApi } from '../../api';
import { useAuthStore } from '../../stores/authStore';

// ─── Estilos base (lenguaje idea1 / design system) ───────────────────────────
const INP =
  'w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-3 text-body-lg text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors appearance-none cursor-pointer';
const INP_SM =
  'w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-body-md text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors appearance-none cursor-pointer';

export function CombinacionesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const esAdmin = useAuthStore((s) => s.isAdmin());

  // ── Estado local: ancla en edición (NO se guarda hasta presionar "Guardar") ──
  const [anclaSeleccionada, setAnclaSeleccionada] = useState('');
  // Nuevo extra a agregar a la ancla seleccionada
  const [nuevoExtra, setNuevoExtra] = useState('');
  // Modo: "existente" (elegir ancla ya configurada) o "nueva" (configurar ancla global)
  const [modoCrearAncla, setModoCrearAncla] = useState(false);

  // ── Datos ────────────────────────────────────────────────────────────────────
  const { data: config } = useQuery({
    queryKey: ['combinaciones-config'],
    queryFn: combinacionesApi.config,
    enabled: esAdmin,
  });

  // Servicios que ya tienen bloques de combinación configurados
  const { data: anclas = [], isLoading: cargandoAnclas } = useQuery({
    queryKey: ['combinaciones-anclas'],
    queryFn: combinacionesApi.listarAnclas,
    enabled: esAdmin,
  });

  // Todos los servicios activos (para el selector de nueva ancla y extras)
  const { data: servicios = [] } = useQuery({
    queryKey: ['servicios-todos'],
    queryFn: () => serviciosApi.listar({ activo: true }),
    enabled: esAdmin,
  });

  // Combinables de la ancla seleccionada actualmente
  const { data: combinaciones = [], isLoading: cargandoCombinables } = useQuery({
    queryKey: ['combinaciones-admin', anclaSeleccionada],
    queryFn: () => combinacionesApi.listarAdmin(anclaSeleccionada || undefined),
    enabled: esAdmin && !!anclaSeleccionada,
  });

  // Inicializar ancla seleccionada con la configurada globalmente
  useEffect(() => {
    if (config?.servicioAnclaId && !anclaSeleccionada) {
      setAnclaSeleccionada(config.servicioAnclaId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.servicioAnclaId]);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['combinaciones-admin', anclaSeleccionada] });
    qc.invalidateQueries({ queryKey: ['combinaciones-config'] });
    qc.invalidateQueries({ queryKey: ['combinaciones-anclas'] });
  };

  // Guardar ancla global (ConfiguracionSistema)
  const anclaMut = useMutation({
    mutationFn: (anclaId: string | null) => combinacionesApi.setAncla(anclaId),
    onSuccess: () => {
      invalidar();
      toast.success('Servicio ancla guardado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const agregarMut = useMutation({
    mutationFn: (servicioExtraId: string) =>
      combinacionesApi.agregar(servicioExtraId, anclaSeleccionada || null),
    onSuccess: () => {
      invalidar();
      setNuevoExtra('');
      toast.success('Servicio combinable agregado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      combinacionesApi.setActivo(id, activo),
    onSuccess: () => invalidar(),
    onError: (e: Error) => toast.error(e.message),
  });

  const quitarMut = useMutation({
    mutationFn: (id: string) => combinacionesApi.quitar(id),
    onSuccess: () => {
      invalidar();
      toast.success('Servicio quitado de la lista');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!esAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background text-on-surface-variant text-sm">
        Solo el administrador puede configurar las combinaciones.
      </div>
    );
  }

  // Servicios que YA están en la lista de combinables de la ancla actual
  const yaCombinables = new Set(combinaciones.map((c: Combinacion) => c.servicioExtraId));
  // Candidatos para agregar: activos, no son la ancla, no están ya en la lista
  const candidatos = servicios.filter(
    (s) => s.id !== anclaSeleccionada && !yaCombinables.has(s.id),
  );
  // Candidatos para nueva ancla: activos, aún no configurados como ancla
  const anclaIds = new Set(anclas.map((a) => a.id));
  const candidatosAncla = servicios.filter((s) => !anclaIds.has(s.id));

  const anclaActualEsLaGlobal = anclaSeleccionada === (config?.servicioAnclaId ?? '');
  const anclaInfo = servicios.find((s) => s.id === anclaSeleccionada);

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {/* Header */}
      <div className="bg-surface/80 backdrop-blur-sm border-b border-outline-variant/30 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate('/herramientas')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all"
          title="Volver a Herramientas"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>
        <div className="w-9 h-9 rounded-xl bg-primary-container/20 border border-primary-container/30 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-primary text-[20px]">link</span>
        </div>
        <div>
          <h1 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Bloques combinados
          </h1>
          <p className="text-[12px] text-on-surface-variant">
            Configura qué servicios extras pueden combinarse con cada ancla en el mismo turno.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* ── Selector de ancla ─────────────────────────────────────────── */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-6 shadow-sm">
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-1">
            Servicio ancla para combinaciones
          </h2>
          <p className="text-body-md text-on-surface-variant mb-5">
            El toggle "Combinar" solo aparece al agendar el servicio ancla. La ancla marcada
            como <span className="font-semibold text-primary">principal</span> es la que usa la agenda.
          </p>

          {/* Tabs de anclas configuradas */}
          {anclas.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {anclas.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { setAnclaSeleccionada(a.id); setModoCrearAncla(false); setNuevoExtra(''); }}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                    anclaSeleccionada === a.id && !modoCrearAncla
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'bg-surface-container-low text-on-surface border-outline-variant hover:bg-surface-container-high'
                  }`}
                >
                  {a.nombre}
                  {a.id === (config?.servicioAnclaId ?? '') && (
                    <span className="ml-1.5 text-[10px] font-bold opacity-70">●</span>
                  )}
                </button>
              ))}
              <button
                onClick={() => { setModoCrearAncla(true); setAnclaSeleccionada(''); setNuevoExtra(''); }}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all flex items-center gap-1.5 ${
                  modoCrearAncla
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface-container-low text-on-surface-variant border-outline-variant hover:bg-surface-container-high'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Nueva ancla
              </button>
            </div>
          )}

          {/* Selector para nueva ancla */}
          {(modoCrearAncla || anclas.length === 0) && (
            <div className="space-y-3">
              <div className="relative">
                <select
                  value={anclaSeleccionada}
                  onChange={(e) => setAnclaSeleccionada(e.target.value)}
                  className={INP}
                >
                  <option value="">— Sin ancla (selecciona un servicio) —</option>
                  {candidatosAncla.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre} ({s.duracionMinutos} min)
                    </option>
                  ))}
                  {/* También permitir seleccionar las ya configuradas */}
                  {anclas.length > 0 && (
                    <optgroup label="Ya configuradas">
                      {anclas.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nombre} ({s.duracionMinutos} min)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-on-surface-variant">
                  <span className="material-symbols-outlined">expand_more</span>
                </div>
              </div>
            </div>
          )}

          {/* Botón guardar como ancla principal */}
          {anclaSeleccionada && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-outline-variant/30">
              <div className="text-sm text-on-surface-variant">
                {anclaActualEsLaGlobal ? (
                  <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    Esta es la ancla principal de la agenda
                  </span>
                ) : (
                  <span>Esta ancla no es la principal de la agenda</span>
                )}
              </div>
              <button
                onClick={() => anclaMut.mutate(anclaSeleccionada)}
                disabled={anclaMut.isPending || anclaActualEsLaGlobal}
                className="px-5 py-2 bg-primary text-on-primary rounded-xl font-semibold text-sm shadow-sm shadow-primary/20 hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none transition-all"
              >
                {anclaMut.isPending ? 'Guardando…' : 'Usar como ancla principal'}
              </button>
            </div>
          )}
        </div>

        {/* ── Servicios combinables de la ancla seleccionada ────────────── */}
        {anclaSeleccionada && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-1">
                Servicios combinables con{' '}
                <span className="text-primary">{anclaInfo?.nombre ?? '…'}</span>
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Estos aparecen como "servicio extra" al combinar. Desactiva para ocultarlos sin perderlos.
              </p>
            </div>

            {/* Agregar */}
            <div className="flex gap-3 mb-6">
              <div className="relative flex-1">
                <select
                  value={nuevoExtra}
                  onChange={(e) => setNuevoExtra(e.target.value)}
                  className={INP_SM}
                >
                  <option value="">— Agregar servicio combinable —</option>
                  {candidatos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre} ({s.duracionMinutos} min)
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-on-surface-variant">
                  <span className="material-symbols-outlined">expand_more</span>
                </div>
              </div>
              <button
                onClick={() => agregarMut.mutate(nuevoExtra)}
                disabled={!nuevoExtra || agregarMut.isPending}
                className="px-6 py-2.5 bg-primary text-on-primary rounded-xl font-semibold text-sm shadow-sm shadow-primary/20 hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none transition-all"
              >
                {agregarMut.isPending ? '…' : 'Agregar'}
              </button>
            </div>

            {/* Lista */}
            {cargandoCombinables ? (
              <div className="text-body-md text-on-surface-variant py-4">Cargando…</div>
            ) : combinaciones.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-on-surface-variant/60 gap-2">
                <span className="material-symbols-outlined text-[40px] opacity-40">link_off</span>
                <p className="text-sm">Aún no hay servicios combinables. Agrega uno arriba.</p>
              </div>
            ) : (
              <ul className="divide-y divide-outline-variant/30">
                {combinaciones.map((c: Combinacion) => (
                  <li key={c.id} className="flex items-center justify-between py-4 group">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: c.servicio.color }}
                      />
                      <span
                        className={`text-body-md font-semibold truncate uppercase tracking-wide ${
                          c.activo ? 'text-on-surface' : 'text-on-surface-variant/50 line-through'
                        }`}
                      >
                        {c.servicio.nombre}
                      </span>
                      <span className="text-xs text-on-surface-variant/60 font-mono shrink-0">
                        {c.servicio.duracionMinutos} min
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <button
                        onClick={() => toggleMut.mutate({ id: c.id, activo: !c.activo })}
                        disabled={toggleMut.isPending}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                          c.activo
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-surface-container-low text-on-surface-variant border-outline-variant hover:bg-surface-container-high'
                        }`}
                      >
                        {c.activo ? (
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block" />
                            Activo
                          </span>
                        ) : (
                          'Inactivo'
                        )}
                      </button>
                      <button
                        onClick={() => quitarMut.mutate(c.id)}
                        disabled={quitarMut.isPending}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-error/30 text-error hover:bg-error-container/40 transition-all"
                        title="Quitar de la lista"
                      >
                        Quitar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Estado vacío: sin ancla seleccionada */}
        {!anclaSeleccionada && !cargandoAnclas && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-10 flex flex-col items-center justify-center gap-3 text-on-surface-variant/60">
            <span className="material-symbols-outlined text-[48px] opacity-30">link</span>
            <p className="text-sm font-medium">Selecciona o crea una ancla para ver sus combinables.</p>
          </div>
        )}
      </div>
    </div>
  );
}
