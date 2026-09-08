import { useState } from 'react';

// Pequeño diálogo reutilizable para pedir un MOTIVO (anular receta, etc.). Mín. 5 caracteres.
export function DialogoMotivo({ titulo, descripcion, confirmar = 'Confirmar', pending, onConfirmar, onClose }: {
  titulo: string; descripcion?: string; confirmar?: string; pending?: boolean; onConfirmar: (motivo: string) => void; onClose: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const ok = motivo.trim().length >= 5;
  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[130] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-surface-container-lowest w-full max-w-[440px] rounded-2xl overflow-hidden custom-shadow animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-3">
          <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">{titulo}</h3>
          {descripcion && <p className="text-sm text-on-surface-variant">{descripcion}</p>}
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} autoFocus maxLength={500} placeholder="Motivo (mínimo 5 caracteres)"
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
        </div>
        <div className="p-4 border-t border-outline-variant/30 flex gap-3 bg-surface-container-low/40">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-outline-variant rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors">Cancelar</button>
          <button type="button" disabled={!ok || pending} onClick={() => onConfirmar(motivo.trim())}
            className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none">{pending ? 'Procesando…' : confirmar}</button>
        </div>
      </div>
    </div>
  );
}
