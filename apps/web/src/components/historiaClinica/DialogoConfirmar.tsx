// Confirmación simple y uniforme para quitar algo (foto, escala, procedimiento, lesión, alergia…).
// Botones grandes (44 px) para la tablet; el fondo NO cierra (un roce del pulgar no debe cancelar ni confirmar).
import { useState, type ReactNode } from 'react';

/** `pedir(título, descripción, acción)` abre la confirmación; `dialogo` se renderiza en el panel. */
export function useConfirmarQuitar() {
  const [pendiente, setPendiente] = useState<{ titulo: string; descripcion?: string; confirmar?: string; run: () => void } | null>(null);
  const pedir = (titulo: string, descripcion: string | undefined, run: () => void, confirmar?: string) => setPendiente({ titulo, descripcion, run, confirmar });
  const dialogo: ReactNode = pendiente
    ? <DialogoConfirmar titulo={pendiente.titulo} descripcion={pendiente.descripcion} confirmar={pendiente.confirmar} onConfirmar={() => { pendiente.run(); setPendiente(null); }} onClose={() => setPendiente(null)} />
    : null;
  return { pedir, dialogo };
}

export function DialogoConfirmar({ titulo, descripcion, confirmar = 'Quitar', peligro = true, pending, onConfirmar, onClose }: {
  titulo: string; descripcion?: string; confirmar?: string; peligro?: boolean; pending?: boolean; onConfirmar: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[130] flex items-center justify-center p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true">
      <div className="bg-surface-container-lowest w-full max-w-[420px] rounded-2xl overflow-hidden custom-shadow animate-in zoom-in-95 duration-200">
        <div className="p-6 space-y-2">
          <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">{titulo}</h3>
          {descripcion && <p className="text-sm text-on-surface-variant">{descripcion}</p>}
        </div>
        <div className="p-4 border-t border-outline-variant/30 flex gap-3 bg-surface-container-low/40">
          <button type="button" onClick={onClose} disabled={pending} className="flex-1 min-h-[44px] px-4 py-2 border border-outline-variant rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors">Cancelar</button>
          <button type="button" disabled={pending} onClick={onConfirmar} data-testid="confirmar-quitar"
            className={`flex-1 min-h-[44px] px-4 py-2 rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none ${peligro ? 'bg-rose-600 text-white' : 'bg-primary text-on-primary'}`}>
            {pending ? 'Un momento…' : confirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
