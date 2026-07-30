import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  HORAS_SLOT,
  PRESETS_CIERRE,
  proximasFechas,
  useHorarioSede,
  useFormExcepcion,
} from '../../services/horarioSedeService';
import type { Excepcion } from '../../api';

interface Props {
  sedeId: string;
  sedeName: string;
  onClose: () => void;
}

const INP =
  'w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'text-xs font-bold text-on-surface-variant block mb-1.5';

export function Idea1ModalExcepciones({ sedeId, sedeName, onClose }: Props) {
  const { excepciones, guardarExcepcion, eliminarExcepcion, isGuardando } = useHorarioSede(sedeId);
  const form = useFormExcepcion();

  const fechasRapidas = proximasFechas().slice(0, 14);
  const hoyStr = format(new Date().setHours(0, 0, 0, 0), 'yyyy-MM-dd');

  const handleGuardar = () => {
    if (form.rangoInvalido) return;
    guardarExcepcion(form.toPayload(), {
      onSuccess: () => form.reset(),
    } as never);
  };

  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-surface-container-lowest w-full max-w-[640px] max-h-[90vh] rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="bg-[#0044ab] text-white p-6 flex justify-between items-start shrink-0 shadow-md">
          <div>
            <h2 className="font-headline-md text-headline-md font-bold text-white tracking-tight">
              Excepciones de horario
            </h2>
            <p className="font-body-md text-body-md text-white/90 mt-1 flex items-center gap-2 text-sm font-medium">
              <span className="material-symbols-outlined text-base">event_repeat</span>
              <span>{sedeName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-xl transition-colors text-white cursor-pointer"
            title="Cerrar (Esc)"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

          {/* ── Formulario nueva excepción ── */}
          <section className="border border-outline-variant/40 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">add_circle</span>
              <h3 className="text-sm font-bold text-on-surface">Añadir excepción</h3>
            </div>

            {/* Fecha */}
            <div>
              <label className={LBL}>FECHA</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {fechasRapidas.map((d) => {
                  const str = format(d, 'yyyy-MM-dd');
                  const sel = str === form.fecha;
                  const esHoy = str === hoyStr;
                  return (
                    <button
                      key={str}
                      type="button"
                      onClick={() => form.setFecha(str)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                        sel
                          ? 'bg-primary text-white border-primary shadow-sm'
                          : 'bg-white text-on-surface-variant border-outline-variant/60 hover:border-primary/60 hover:text-on-surface'
                      }`}
                    >
                      {esHoy ? 'Hoy' : format(d, 'EEE d', { locale: es })}
                    </button>
                  );
                })}
              </div>
              <input
                type="date"
                value={form.fecha}
                onChange={(e) => form.setFecha(e.target.value)}
                className={INP}
              />
              {form.fecha && (
                <p className="text-[11px] text-on-surface-variant mt-1.5 capitalize">
                  {format(parseISO(form.fecha), "EEEE d 'de' MMMM", { locale: es })}
                </p>
              )}
            </div>

            {/* Abierto / Cerrado */}
            <div>
              <label className={LBL}>ESTADO DEL DÍA</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => form.setAbierto(true)}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                    form.abierto
                      ? 'bg-green-500 text-white border-green-500 shadow-sm'
                      : 'bg-white text-on-surface-variant border-outline-variant/60 hover:border-green-400'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">event_available</span>
                  Abierto
                </button>
                <button
                  type="button"
                  onClick={() => form.setAbierto(false)}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                    !form.abierto
                      ? 'bg-red-500 text-white border-red-500 shadow-sm'
                      : 'bg-white text-on-surface-variant border-outline-variant/60 hover:border-red-400'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">event_busy</span>
                  Cerrado
                </button>
              </div>
            </div>

            {/* Horas si abierto */}
            {form.abierto && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LBL}>APERTURA</label>
                    <select
                      value={form.apertura}
                      onChange={(e) => form.setApertura(e.target.value)}
                      className={INP}
                    >
                      {HORAS_SLOT.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>CIERRE</label>
                    <select
                      value={form.cierre}
                      onChange={(e) => form.setCierre(e.target.value)}
                      className={INP}
                    >
                      {HORAS_SLOT.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Presets rápidos de cierre */}
                <div>
                  <p className="text-[11px] font-bold text-on-surface-variant mb-1.5 uppercase tracking-wider">
                    Cierre rápido
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS_CIERRE.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => form.setCierre(h)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                          form.cierre === h
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-on-surface-variant border-outline-variant/60 hover:border-primary/50'
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Nota */}
            <div>
              <label className={LBL}>NOTA (opcional)</label>
              <input
                className={INP}
                placeholder="Ej: Feriado, capacitación, cierre anticipado…"
                value={form.nota}
                onChange={(e) => form.setNota(e.target.value)}
              />
            </div>

            {form.rangoInvalido && (
              <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-xl">
                <span className="material-symbols-outlined text-red-600 text-lg">warning</span>
                <p className="text-xs font-semibold text-red-800">
                  La hora de apertura debe ser anterior a la de cierre.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleGuardar}
              disabled={isGuardando || form.rangoInvalido}
              className="w-full bg-primary text-white py-2.5 rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50"
            >
              {isGuardando ? 'Guardando…' : 'Guardar excepción'}
            </button>
          </section>

          {/* ── Lista de excepciones futuras ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-label-caps text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
                Próximas excepciones
              </h3>
              {excepciones.length > 0 && (
                <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[10px] font-bold">
                  {excepciones.length}
                </span>
              )}
            </div>

            {excepciones.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-outline-variant/40 rounded-2xl">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant/60">
                  event_available
                </span>
                <p className="text-sm text-on-surface-variant mt-2">Sin excepciones programadas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {excepciones.map((exc: Excepcion) => (
                  <div
                    key={exc.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest hover:border-outline-variant transition-colors"
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        exc.abierto ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-on-surface capitalize">
                        {format(parseISO(exc.fecha), "EEEE d 'de' MMMM", { locale: es })}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        {exc.abierto ? (
                          <span className="font-mono font-semibold">
                            {exc.horaApertura} <span className="opacity-60">→</span> {exc.horaCierre}
                          </span>
                        ) : (
                          <span className="text-red-600 font-semibold">Cerrado</span>
                        )}
                        {exc.nota && <span className="ml-2">· {exc.nota}</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => eliminarExcepcion(exc.fecha)}
                      className="p-1.5 text-on-surface-variant hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Eliminar excepción"
                    >
                      <span className="material-symbols-outlined text-lg">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
