import { useState } from 'react';
import { useMiFirma } from '../../services/miFirmaService';

/** Botón «Mi firma y sello» (solo médicos) que abre el diálogo para subirla, verla o quitarla. */
export function MiFirmaBoton() {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} data-testid="mi-firma"
        className="min-h-[44px] lg:min-h-0 px-4 py-2.5 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high flex items-center gap-2">
        <span className="material-symbols-outlined text-base">signature</span>Mi firma y sello
      </button>
      {abierto && <MiFirmaDialog onClose={() => setAbierto(false)} />}
    </>
  );
}

/**
 * Firma y sello digitalizados. Es opcional: sin ella la receta sale con la línea para firmar a
 * mano. Si la sube, al imprimir SUS recetas tendrá «Imprimir con mi firma». Nadie más la usa.
 */
export function MiFirmaDialog({ onClose }: { onClose: () => void }) {
  const f = useMiFirma();
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-surface rounded-3xl shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()} data-testid="dialogo-firma">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-on-surface">Mi firma y sello</h3>
            <p className="text-xs text-on-surface-variant mt-1">
              Una foto o escaneo de tu firma con tu sello, sobre fondo blanco (PNG o JPG, máx. 500 KB). Solo tú la puedes usar,
              y solo en recetas a tu nombre. Si no la subes, la receta sale con la línea para firmar a mano.
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface" aria-label="Cerrar"><span className="material-symbols-outlined">close</span></button>
        </div>

        <div className="rounded-2xl border border-dashed border-outline-variant/60 bg-white min-h-[120px] flex items-center justify-center p-3">
          {f.cargando ? <p className="text-xs text-on-surface-variant">Cargando…</p>
            : f.previa ? <img src={f.previa} alt="Tu firma y sello" className="max-h-28 object-contain" data-testid="firma-previa" />
              : <p className="text-xs text-on-surface-variant">Aún no subiste tu firma.</p>}
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          {f.tieneFirma && (
            <button type="button" onClick={f.quitar} disabled={f.pendiente} className="px-4 py-2 text-rose-700 text-sm font-semibold hover:underline disabled:opacity-50">Quitar mi firma</button>
          )}
          <label className={`px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold cursor-pointer flex items-center gap-2 ${f.pendiente ? 'opacity-50 pointer-events-none' : 'hover:opacity-90'}`}>
            <span className="material-symbols-outlined text-base">upload</span>{f.tieneFirma ? 'Reemplazar' : 'Subir firma'}
            <input type="file" accept="image/png,image/jpeg" className="hidden" data-testid="firma-archivo"
              onChange={(e) => { const x = e.target.files?.[0]; if (x) f.subir(x); e.target.value = ''; }} />
          </label>
        </div>
      </div>
    </div>
  );
}
