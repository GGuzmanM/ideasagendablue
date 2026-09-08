import type { Alergia } from '../../api/historiaClinica';

// Franja roja de alergias (RAM): se repite en HC, atención y receta — seguridad al prescribir.
export function AlergiasBanner({ alergias, compacto = false }: { alergias: Pick<Alergia, 'sustancia' | 'severidad' | 'reaccion' | 'activa'>[]; compacto?: boolean }) {
  const activas = alergias.filter((a) => a.activa !== false);
  if (activas.length === 0) {
    return (
      <div className={`rounded-xl border border-outline-variant/30 bg-surface-container-low/40 text-on-surface-variant flex items-center gap-2 ${compacto ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2 text-xs'}`}>
        <span className="material-symbols-outlined text-base">verified_user</span>
        <span><b>Alergias / RAM:</b> ninguna registrada</span>
      </div>
    );
  }
  return (
    <div className={`rounded-xl border border-error/30 bg-error-container text-on-error-container flex items-start gap-2 ${compacto ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2.5 text-xs'}`}>
      <span className="material-symbols-outlined text-base shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
      <div className="min-w-0">
        <b className="uppercase tracking-wide">Alergias / RAM:</b>{' '}
        {activas.map((a, i) => (
          <span key={i} className="font-semibold">
            {a.sustancia}{a.severidad === 'severa' ? ' (SEVERA)' : ''}{a.reaccion ? ` · ${a.reaccion}` : ''}{i < activas.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
