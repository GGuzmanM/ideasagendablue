import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Idea1NuevaCitaModal } from '../components/agenda/Idea1NuevaCitaModal';
import { useAgendaStore } from '../stores/agendaStore';
import { RomboAlerta } from '../components/pacientes/RomboAlerta';
import { CuadroFamiliares } from '../components/pacientes/CuadroFamiliares';
import { ToggleDatosPaciente } from '../components/pacientes/ToggleDatosPaciente';
import { BotonHistorialGenexis } from '../components/pacientes/HistorialGenexis';
import { SaldoPaquetes } from '../components/pacientes/SaldoPaquetes';
import { Idea1NuevoPacienteModal } from '../components/pacientes/Idea1NuevoPacienteModal';
import { Skeleton } from '../components/ui/Skeleton';
import { cn } from '../utils/cn';
import { DistritoAutocomplete, PaisAutocomplete } from '../components/ui/DistritoAutocomplete';
import { etiquetaDistrito } from '../data/ubigeo';
import { UBIGEO_EXTRANJERO, nombrePais } from '@limablue/shared';
import { usePacientesBusqueda, useFichaPaciente } from '../services/pacientesService';
import { useCanales } from '../hooks/useCanales';

// ─── Lista/búsqueda ───────────────────────────────────────────────────────────

export function PacientesPage() {
  const navigate = useNavigate();
  const { q, setQ, resultados, isLoading } = usePacientesBusqueda();
  const [nuevoOpen, setNuevoOpen] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-slate-900">Pacientes</h1>
            <div className="mt-3 max-w-lg">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  className="input pl-9"
                  placeholder="Buscar por nombre, DNI o teléfono..."
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          </div>
          <button
            onClick={() => setNuevoOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg shadow-sm hover:opacity-90 active:scale-95 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Nuevo paciente
          </button>
        </div>
      </header>

      {nuevoOpen && (
        <Idea1NuevoPacienteModal
          onClose={() => setNuevoOpen(false)}
          onCreated={(p) => navigate(`/pacientes/${p.id}`)}
        />
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {q.length < 2 && (
          <div className="text-center py-16 text-slate-400">
            <p className="text-4xl mb-3">👤</p>
            <p className="text-sm">Escribe al menos 2 caracteres para buscar</p>
          </div>
        )}

        {isLoading && q.length >= 2 && (
          <div className="space-y-2">
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        )}

        {resultados && resultados.length === 0 && q.length >= 2 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No se encontraron pacientes para "{q}"</p>
          </div>
        )}

        {resultados && resultados.length > 0 && (
          <div className="space-y-1">
            {resultados.map(p => (
              <button
                key={p.id}
                onClick={() => navigate(`/pacientes/${p.id}`)}
                className="w-full text-left bg-white rounded-lg border border-slate-200 px-4 py-3 hover:border-limablue-300 hover:bg-limablue-50 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <RomboAlerta alerta={p.alerta} size={12} />
                      <span>{p.nombreCompleto}</span>
                    </p>
                    <p className="text-sm text-slate-500 flex items-center gap-2">
                      <span>{p.tipoDocumento} {p.numeroDocumento} · {p.telefono}</span>
                      {p.requiereActualizacionDatos !== undefined && (
                        <ToggleDatosPaciente encendido={p.requiereActualizacionDatos} contacto={p} compacto />
                      )}
                      <SaldoPaquetes pacienteId={p.id} variante="compact" />
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Ficha de paciente (Perfil — diseño idea1) ────────────────────────────────

// `fecha` viene como medianoche UTC ("2026-06-24T00:00:00.000Z"). `new Date()` directo
// la corre un día hacia atrás en zonas con offset negativo (Lima UTC-5). Anclamos al
// mediodía local sobre la parte de fecha para mostrar SIEMPRE el día correcto.
const parseFechaLocal = (f: string) => new Date(f.slice(0, 10) + 'T12:00:00');

// Colores de estado — MISMA paleta que el agenda idea1 (tarjetas de cita).
const ESTADO_ESTILO: Record<string, { pill: string; dot: string; label: string }> = {
  agendada:     { pill: 'bg-secondary-container text-on-secondary-container', dot: 'bg-secondary-fixed-dim', label: 'Agendada' },
  confirmada:   { pill: 'bg-primary-fixed text-on-primary-fixed-variant', dot: 'bg-primary-container', label: 'Confirmada' },
  llego:        { pill: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-600', label: 'Llegó' },
  en_atencion:  { pill: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', dot: 'bg-tertiary-container', label: 'En atención' },
  completada:   { pill: 'bg-surface-variant text-on-surface-variant', dot: 'bg-outline', label: 'Completada' },
  no_show:      { pill: 'bg-error-container text-on-error-container', dot: 'bg-error', label: 'No show' },
  cancelada:    { pill: 'bg-error-container text-on-error-container', dot: 'bg-error', label: 'Cancelada' },
  reprogramada: { pill: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', dot: 'bg-tertiary-container', label: 'Reprogramada' },
};

function EstadoPill({ estado }: { estado: string }) {
  const key = (estado ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const e = ESTADO_ESTILO[key] ?? { pill: 'bg-secondary-container text-on-secondary-container', dot: 'bg-secondary-fixed-dim', label: estado };
  return (
    <span className={cn('inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider', e.pill)}>
      <span className={cn('w-1.5 h-1.5 rounded-full mr-1.5 shrink-0', e.dot)} />
      {e.label}
    </span>
  );
}

export function FichaPacientePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sede/Especialidad de arranque para "Agendar cita": si el usuario ya usó la agenda,
  // reusamos su última selección; si no, el modal elige la primera sede por defecto.
  const agendaSedeId = useAgendaStore(s => s.sedeId);
  const agendaUnidadId = useAgendaStore(s => s.unidadNegocioId);
  const [agendarOpen, setAgendarOpen] = useState(false);

  const {
    paciente,
    isLoading,
    historial,
    proximas,
    totalAtenciones,
    faltantes,
    editando,
    setEditando,
    notas,
    setNotas,
    actualizarMutation,
    editandoDatos,
    setEditandoDatos,
    form,
    setForm,
    dniConsultando,
    abrirEdicionDatos,
    guardarDatosMutation,
  } = useFichaPaciente(id);

  const { canalesPaciente, labelCanalPorId } = useCanales();

  // Estilo de inputs (diseño idea1) + resaltado ámbar para campos faltantes.
  const INPUT_CLS = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
  const claseFaltante = (campo: string) =>
    cn(INPUT_CLS, faltantes.includes(campo) && 'border-amber-400 ring-1 ring-amber-300 bg-amber-50');

  if (isLoading) {
    return (
      <div className="p-8 space-y-4 bg-background h-full">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!paciente) return <div className="p-8 text-on-surface-variant">Paciente no encontrado</div>;

  const nombreCompleto = `${paciente.nombres} ${paciente.apellidoPaterno} ${paciente.apellidoMaterno}`.trim();
  const iniciales = `${paciente.nombres?.[0] ?? ''}${paciente.apellidoPaterno?.[0] ?? ''}`.toUpperCase();

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-on-surface">
      {/* Top App Bar */}
      <header className="glass-header sticky top-0 z-40 bg-surface/80 border-b border-outline-variant/30 px-grid-gutter h-16 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate('/pacientes')}
            className="flex items-center text-on-surface-variant hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined mr-2">arrow_back</span>
            <span className="font-body-md font-medium">Volver</span>
          </button>
          <div className="h-6 w-px bg-outline-variant/30" />
          <span className="font-headline-sm text-headline-sm font-semibold text-on-surface truncate max-w-[280px]">
            Perfil del paciente
          </span>
        </div>
      </header>

      {/* Content Canvas */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-container-padding space-y-8 max-w-[1440px] mx-auto w-full">
          {/* Patient Profile Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-outline-variant/20">
            <div className="flex items-start gap-5">
              <div className="w-24 h-24 rounded-2xl bg-primary-fixed flex items-center justify-center text-primary font-bold text-headline-md shrink-0">
                {iniciales || '—'}
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-headline-md text-headline-md text-on-surface font-black flex items-center gap-2">
                    <RomboAlerta alerta={paciente.alerta} size={16} />
                    <span>{nombreCompleto}</span>
                  </h2>
                </div>
                {paciente.alerta?.alerta && (
                  <p className="text-xs font-semibold text-amber-700 mt-1">
                    {paciente.alerta.frecuenteInasistente && `⚠ No asiste con frecuencia (${paciente.alerta.noShows} inasistencias). `}
                    {paciente.alerta.frecuenteReprogramador && `⚠ Reprograma con frecuencia (${paciente.alerta.reprogramaciones} veces).`}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2 text-on-surface-variant font-body-md">
                  <span className="flex items-center"><span className="material-symbols-outlined text-sm mr-2">id_card</span>{paciente.tipoDocumento} {paciente.numeroDocumento}</span>
                  <span className="flex items-center"><span className="material-symbols-outlined text-sm mr-2">call</span>{paciente.telefono}</span>
                  {paciente.email && (
                    <span className="flex items-center"><span className="material-symbols-outlined text-sm mr-2">mail</span>{paciente.email}</span>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <ToggleDatosPaciente
                    encendido={paciente.requiereActualizacionDatos ?? faltantes.length > 0}
                    faltantes={faltantes}
                    onEditar={abrirEdicionDatos}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 shrink-0">
              {/* Estético por ahora (sin acción): más adelante abrirá la ficha técnica */}
              <button
                type="button"
                className="px-6 py-3 bg-surface-container-lowest border border-outline-variant text-on-surface font-semibold rounded-xl hover:bg-surface-container-low transition-all flex items-center"
                title="Próximamente"
              >
                <span className="material-symbols-outlined mr-2">print</span>
                Ficha técnica
              </button>
              <BotonHistorialGenexis
                pacienteId={paciente.id}
                nombrePaciente={nombreCompleto}
                documento={`${paciente.tipoDocumento} ${paciente.numeroDocumento}`}
              />
              <button
                onClick={() => setAgendarOpen(true)}
                className="px-8 py-3 bg-primary text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center"
              >
                <span className="material-symbols-outlined mr-2">add_circle</span>
                Agendar cita
              </button>
            </div>
          </div>

          {/* Bento Grid: Datos + Notas */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-grid-gutter">
            {/* Datos del paciente (span 2) */}
            <div className="lg:col-span-2 bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-8 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center">
                  <span className="material-symbols-outlined mr-3 text-primary">person</span>
                  Datos del paciente
                </h3>
                {!editandoDatos && (
                  <button onClick={abrirEdicionDatos} className="text-primary font-semibold hover:underline text-body-md">Editar</button>
                )}
              </div>

              {editandoDatos ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">Nombres *</span>
                      <input className={INPUT_CLS} value={form.nombres} onChange={e => setForm(f => ({ ...f, nombres: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">Apellido paterno *</span>
                      <input className={INPUT_CLS} value={form.apellidoPaterno} onChange={e => setForm(f => ({ ...f, apellidoPaterno: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">Apellido materno *</span>
                      <input className={INPUT_CLS} value={form.apellidoMaterno} onChange={e => setForm(f => ({ ...f, apellidoMaterno: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">Tipo de documento</span>
                      <select className={INPUT_CLS} value={form.tipoDocumento} onChange={e => setForm(f => ({ ...f, tipoDocumento: e.target.value }))}>
                        {['DNI', 'CE', 'PASAPORTE', 'RUC'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">N° documento *</span>
                      <input
                        className={INPUT_CLS}
                        value={form.numeroDocumento}
                        onChange={e => setForm(f => ({ ...f, numeroDocumento: f.tipoDocumento === 'DNI' ? e.target.value.replace(/\D/g, '') : e.target.value }))}
                        maxLength={form.tipoDocumento === 'DNI' ? 8 : 20}
                        inputMode={form.tipoDocumento === 'DNI' ? 'numeric' : 'text'}
                      />
                      {form.tipoDocumento === 'DNI' && dniConsultando && (
                        <span className="text-[10px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                          </svg>
                          Consultando RENIEC…
                        </span>
                      )}
                    </label>
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">Teléfono *</span>
                      <input className={claseFaltante('teléfono')} value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">Email</span>
                      <input type="email" className={claseFaltante('correo')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">Fecha nac.</span>
                      <input type="date" className={claseFaltante('fecha de nacimiento')} value={form.fechaNacimiento} onChange={e => setForm(f => ({ ...f, fechaNacimiento: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-on-surface-variant">Sexo</span>
                      <select className={INPUT_CLS} value={form.sexo} onChange={e => setForm(f => ({ ...f, sexo: e.target.value }))}>
                        <option value="">—</option>
                        <option value="masculino">Masculino</option>
                        <option value="femenino">Femenino</option>
                        <option value="otro">Otro</option>
                      </select>
                    </label>
                    <div className="col-span-2">
                      <span className="text-xs text-on-surface-variant block mb-0.5">Distrito de residencia</span>
                      <DistritoAutocomplete
                        value={form.ubigeoId}
                        onChange={(id) => setForm(f => ({ ...f, ubigeoId: id, paisResidencia: id === UBIGEO_EXTRANJERO ? f.paisResidencia : null }))}
                      />
                    </div>
                    {form.ubigeoId === UBIGEO_EXTRANJERO && (
                      <div className="col-span-2">
                        <span className="text-xs text-on-surface-variant block mb-0.5">País de residencia *</span>
                        <PaisAutocomplete value={form.paisResidencia} onChange={(c) => setForm(f => ({ ...f, paisResidencia: c }))} />
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-xs text-on-surface-variant block mb-0.5">Canal de captación</span>
                      <select
                        className={INPUT_CLS}
                        value={form.canalId ?? ''}
                        onChange={e => setForm(f => ({ ...f, canalId: e.target.value || null }))}
                      >
                        <option value="">— Sin especificar —</option>
                        {canalesPaciente.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => guardarDatosMutation.mutate()}
                      disabled={guardarDatosMutation.isPending || !form.nombres.trim() || !form.apellidoPaterno.trim() || !form.numeroDocumento.trim() || !form.telefono.trim() || (form.ubigeoId === UBIGEO_EXTRANJERO && !form.paisResidencia)}
                      className="px-5 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {guardarDatosMutation.isPending ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button onClick={() => setEditandoDatos(false)} className="px-5 py-2.5 border border-outline-variant text-on-surface font-semibold rounded-xl text-sm hover:bg-surface-container-high transition-all">Cancelar</button>
                  </div>
                  <p className="text-[11px] text-on-surface-variant">Al guardar, el cambio se refleja en toda la agenda (el paciente se guarda una sola vez).</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-12 gap-y-3">
                  {[
                    ['Nombres', `${paciente.nombres}`],
                    ['Apellido paterno', paciente.apellidoPaterno],
                    ['Apellido materno', paciente.apellidoMaterno],
                    ['Documento', `${paciente.tipoDocumento} ${paciente.numeroDocumento}`],
                    ['Teléfono', paciente.telefono],
                    ['Email', paciente.email ?? '—'],
                    ['Fecha nac.', paciente.fechaNacimiento ? format(new Date(paciente.fechaNacimiento as string), 'd/MM/yyyy') : '—'],
                    ['Distrito', paciente.ubigeoId
                      ? `${etiquetaDistrito(paciente.ubigeoId)}${paciente.ubigeoId === UBIGEO_EXTRANJERO && paciente.paisResidencia ? ` · ${nombrePais(paciente.paisResidencia)}` : ''}`
                      : '—'],
                    ['Canal de captación', paciente.canalId ? labelCanalPorId(paciente.canalId) : '—'],
                  ].map(([label, val]) => (
                    <div key={label} className="space-y-0">
                      <p className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant/80">{label}</p>
                      <p className="font-body-lg text-body-lg text-on-surface font-semibold">{val}</p>
                    </div>
                  ))}
                </div>
              )}

              {paciente.familiares && paciente.familiares.length > 0 && (
                <div className="mt-6 pt-6 border-t border-outline-variant/20">
                  <CuadroFamiliares familiares={paciente.familiares} />
                </div>
              )}
            </div>

            {/* Notas generales */}
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-8 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center">
                  <span className="material-symbols-outlined mr-3 text-primary">description</span>
                  Notas generales
                </h3>
                {!editando && (
                  <button
                    onClick={() => { setNotas(paciente.notas ?? ''); setEditando(true); }}
                    className="text-primary font-semibold hover:underline text-body-md"
                  >
                    Editar
                  </button>
                )}
              </div>
              {editando ? (
                <div className="space-y-3">
                  <textarea
                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none"
                    rows={6}
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                    placeholder="Escribe una nota interna sobre el paciente…"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => actualizarMutation.mutate({ notas })} className="px-5 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all">Guardar</button>
                    <button onClick={() => setEditando(false)} className="px-5 py-2.5 border border-outline-variant text-on-surface font-semibold rounded-xl text-sm hover:bg-surface-container-high transition-all">Cancelar</button>
                  </div>
                </div>
              ) : paciente.notas ? (
                <div className="flex-grow rounded-xl bg-surface-container-low/60 border border-outline-variant/40 p-4">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-primary text-xl shrink-0">sticky_note_2</span>
                    <p className="text-body-md text-on-surface whitespace-pre-wrap">{paciente.notas}</p>
                  </div>
                </div>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center border-2 border-dashed border-outline-variant/50 rounded-xl p-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center">
                    <span className="material-symbols-outlined text-outline text-3xl">sticky_note_2</span>
                  </div>
                  <p className="text-on-surface-variant italic font-body-md">Sin notas registradas para este paciente.</p>
                  <button
                    onClick={() => { setNotas(''); setEditando(true); }}
                    className="text-primary font-bold text-body-md"
                  >
                    + Agregar primera nota
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Paquetes y membresías — SaldoPaquetes (variante detalle, rediseñada):
              banner cuando no hay plan activo; tarjeta con composición cuando sí. */}
          <SaldoPaquetes
            pacienteId={paciente.id}
            variante="detalle"
            nombrePaciente={nombreCompleto}
            documento={`${paciente.tipoDocumento} ${paciente.numeroDocumento}`}
          />

          {/* Próximas citas */}
          {proximas.length > 0 && (
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
              <div className="px-8 py-6 flex justify-between items-center border-b border-outline-variant/20 bg-surface-container-low/30">
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center">
                  <span className="material-symbols-outlined mr-3 text-primary">event_upcoming</span>
                  Próximas citas ({proximas.length})
                </h3>
              </div>
              <div className="divide-y divide-outline-variant/10">
                {proximas.map(c => (
                  <div key={c.id} className="flex items-center gap-4 px-8 py-4 hover:bg-primary/5 transition-colors">
                    <div className="text-center min-w-[56px]">
                      <p className="text-[11px] uppercase text-on-surface-variant">{format(parseFechaLocal(c.fecha), 'EEE', { locale: es })}</p>
                      <p className="font-bold text-on-surface">{format(parseFechaLocal(c.fecha), 'd MMM', { locale: es })}</p>
                      <p className="text-xs text-primary font-semibold">{c.horaInicio}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-on-surface truncate">{c.servicio.nombre}{c.subcategoria ? ` · ${c.subcategoria.nombre}` : ''}</p>
                      <p className="text-xs text-on-surface-variant truncate">
                        {c.profesional ? `${c.profesional.nombres} ${c.profesional.apellidos}` : 'Por asignar'} · {c.sede.nombre}
                      </p>
                    </div>
                    <EstadoPill estado={c.estado} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Historial de atenciones */}
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
            <div className="px-8 py-6 flex justify-between items-center border-b border-outline-variant/20 bg-surface-container-low/30">
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center">
                <span className="material-symbols-outlined mr-3 text-primary">history</span>
                Historial de atenciones ({totalAtenciones})
                {totalAtenciones > historial.length && (
                  <span className="ml-2 font-normal text-on-surface-variant text-body-md">· mostrando las {historial.length} más recientes</span>
                )}
              </h3>
            </div>
            {historial.length === 0 ? (
              <p className="text-on-surface-variant text-center py-10 font-body-md">Sin atenciones registradas</p>
            ) : (
              <div className="overflow-x-auto max-h-[36rem] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-container-low">
                      <th className="px-8 py-4 font-label-caps text-label-caps text-on-surface-variant border-b border-outline-variant/10">Fecha</th>
                      <th className="px-8 py-4 font-label-caps text-label-caps text-on-surface-variant border-b border-outline-variant/10">Servicio</th>
                      <th className="px-8 py-4 font-label-caps text-label-caps text-on-surface-variant border-b border-outline-variant/10">Profesional</th>
                      <th className="px-8 py-4 font-label-caps text-label-caps text-on-surface-variant border-b border-outline-variant/10">Sede</th>
                      <th className="px-4 py-4 font-label-caps text-label-caps text-on-surface-variant border-b border-outline-variant/10">Consultorio</th>
                      <th className="px-4 py-4 font-label-caps text-label-caps text-on-surface-variant border-b border-outline-variant/10">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {historial.map(c => (
                      <tr key={c.id} className="hover:bg-primary/5 transition-colors">
                        <td className="px-8 py-5">
                          <div className="flex flex-col">
                            <span className="font-semibold text-on-surface whitespace-nowrap">{format(parseFechaLocal(c.fecha), 'd MMM yyyy', { locale: es })}</span>
                            <span className="text-xs text-on-surface-variant">{c.horaInicio}</span>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="flex items-center">
                            <div className="w-1 h-8 mr-4 rounded-full shrink-0" style={{ backgroundColor: c.servicio.color || '#0044ab' }} />
                            <div className="min-w-0">
                              <span className="font-medium text-body-md text-on-surface leading-tight">
                                {c.servicio.nombre}{c.subcategoria ? ` · ${c.subcategoria.nombre}` : ''}
                              </span>
                              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                {c.sesionNumero != null && c.paquetePaciente && (
                                  <span
                                    title={c.paquetePaciente.paquete.nombre}
                                    className="inline-flex items-center px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-full text-[10px] font-bold"
                                  >
                                    Sesión {c.sesionNumero}/{c.paquetePaciente.sesionesTotal}
                                  </span>
                                )}
                                {c.slotGrupoId && (
                                  <span
                                    title={`Turno combinado · ${c.slotRol === 'PRINCIPAL' ? 'profilaxis (ancla)' : 'servicio extra'}`}
                                    className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-semibold"
                                  >
                                    🔗 {c.slotRol === 'PRINCIPAL' ? 'Combo' : 'Combo·extra'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          {c.profesional ? (
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div className="w-8 h-8 rounded-full bg-primary-fixed text-primary flex items-center justify-center text-[11px] font-bold shrink-0">
                                {`${c.profesional.nombres?.[0] ?? ''}${c.profesional.apellidos?.[0] ?? ''}`.toUpperCase()}
                              </div>
                              <span className="text-on-surface truncate">{c.profesional.nombres} {c.profesional.apellidos}</span>
                            </div>
                          ) : (
                            <span className="text-on-surface-variant">—</span>
                          )}
                        </td>
                        <td className="px-8 py-5"><span className="text-on-surface">{c.sede.nombre}</span></td>
                        <td className="px-4 py-5">
                          {c.consultorioNumero != null
                            ? <span className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded-md bg-surface-container-high text-on-surface font-semibold text-xs">{c.consultorioNumero}</span>
                            : <span className="text-on-surface-variant/50">—</span>}
                        </td>
                        <td className="px-4 py-5"><EstadoPill estado={c.estado} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Nueva cita con el paciente ya cargado (mismo modal de la agenda idea1) */}
      {agendarOpen && (
        <Idea1NuevaCitaModal
          sedeId={agendaSedeId ?? ''}
          unidadNegocioId={agendaUnidadId ?? ''}
          fecha={new Date()}
          permitirCambiarSede
          pacienteInicial={{
            id: paciente.id,
            nombres: paciente.nombres,
            apellidoPaterno: paciente.apellidoPaterno,
            apellidoMaterno: paciente.apellidoMaterno,
            nombreCompleto,
            telefono: paciente.telefono,
            numeroDocumento: paciente.numeroDocumento,
            alerta: paciente.alerta ?? undefined,
            familiares: paciente.familiares ?? undefined,
          }}
          onClose={() => setAgendarOpen(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['paciente', id] })}
        />
      )}
    </div>
  );
}
