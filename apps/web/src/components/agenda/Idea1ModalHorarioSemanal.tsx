import { useState } from 'react';
import { DIAS_ABREV, DIAS_FULL, useHorarioSede } from '../../services/horarioSedeService';
import type { HorarioDia } from '../../api';
import { Idea1ModalExcepciones } from './Idea1ModalExcepciones';

interface Props {
  sedeId: string;
  sedeName: string;
  onClose: () => void;
}

export function Idea1ModalHorarioSemanal({ sedeId, sedeName, onClose }: Props) {
  const { horarioDefault, excepciones } = useHorarioSede(sedeId);
  const [excepcionesOpen, setExcepcionesOpen] = useState(false);

  return (
    <>
      <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-surface-container-lowest w-full max-w-[560px] max-h-[90vh] rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200">

          {/* Header */}
          <div className="bg-[#0044ab] text-white p-6 flex justify-between items-start shrink-0 shadow-md">
            <div>
              <h2 className="font-headline-md text-headline-md font-bold text-white tracking-tight">
                Horario semanal
              </h2>
              <p className="font-body-md text-body-md text-white/90 mt-1 flex items-center gap-2 text-sm font-medium">
                <span className="material-symbols-outlined text-base">location_on</span>
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
          <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            <p className="text-sm text-on-surface-variant">
              Horario base por defecto. Para cambios de un día específico usá{' '}
              <button
                type="button"
                onClick={() => setExcepcionesOpen(true)}
                className="text-primary font-semibold hover:underline"
              >
                Excepciones
              </button>
              .
            </p>

            {/* Grilla de 7 días */}
            <div className="border border-outline-variant/40 rounded-2xl overflow-hidden">
              {DIAS_ABREV.map((dia, i) => {
                const turno = horarioDefault[String(i)] as HorarioDia | undefined;
                const abierto = turno?.abierto !== false;
                const isToday = new Date().getDay() === i;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-4 py-3 border-b border-outline-variant/30 last:border-b-0 transition-colors ${
                      isToday ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="w-12 flex items-center justify-center">
                      <span
                        className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold ${
                          isToday
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-on-surface-variant'
                        }`}
                      >
                        {dia}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-on-surface">{DIAS_FULL[i]}</p>
                      {isToday && (
                        <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Hoy</p>
                      )}
                    </div>
                    {abierto && turno && 'apertura' in turno ? (
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span className="text-sm text-on-surface font-mono tabular-nums font-semibold">
                          {turno.apertura} <span className="text-on-surface-variant">→</span> {turno.cierre}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-semibold text-red-500 italic">Cerrado</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Acceso a excepciones */}
            <button
              type="button"
              onClick={() => setExcepcionesOpen(true)}
              className="w-full flex items-center justify-between gap-3 p-4 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-2xl transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="material-symbols-outlined text-primary">event_repeat</span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-on-surface">Gestionar excepciones</p>
                  <p className="text-xs text-on-surface-variant">
                    Feriados, cierres anticipados o aperturas puntuales
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {excepciones.length > 0 && (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold">
                    {excepciones.length}
                  </span>
                )}
                <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {excepcionesOpen && (
        <Idea1ModalExcepciones
          sedeId={sedeId}
          sedeName={sedeName}
          onClose={() => setExcepcionesOpen(false)}
        />
      )}
    </>
  );
}
