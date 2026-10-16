// «¿Quisiste decir …?» debajo del correo del paciente: un clic lo corrige (ver utils/sugerenciaCorreo.ts).
import { sugerirCorreo } from '../../utils/sugerenciaCorreo';

export function SugerenciaCorreo({ valor, onUsar }: { valor: string | null | undefined; onUsar: (correo: string) => void }) {
  const sugerido = valor ? sugerirCorreo(valor) : null;
  if (!sugerido) return null;
  return (
    <p className="mt-1 text-xs text-amber-700 flex items-center gap-1.5 flex-wrap" data-testid="sugerencia-correo">
      <span className="material-symbols-outlined text-sm">help</span>
      ¿Quisiste decir <b className="font-semibold">{sugerido}</b>?
      <button type="button" onClick={() => onUsar(sugerido)} className="font-semibold text-primary underline underline-offset-2 hover:opacity-80">Usar</button>
    </p>
  );
}
