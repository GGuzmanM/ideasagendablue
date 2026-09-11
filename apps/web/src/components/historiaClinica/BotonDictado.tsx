// Botón de micrófono + campo de texto con dictado (vista pura; la lógica vive en hooks/useDictado).
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { anexarDictado, type Dictado } from '../../hooks/useDictado';
import { useAutotextoStore } from '../../stores/autotextoStore';
import { expandirAutotexto } from '../../utils/autotexto';

interface BotonProps {
  campo: string; // id único del campo (para saber cuál está dictando)
  dictado: Dictado;
  onTexto: (t: string) => void;
  disabled?: boolean;
}

export function BotonDictado({ campo, dictado, onTexto, disabled }: BotonProps) {
  if (!dictado.soportado) return null; // Firefox y similares: simplemente no se ofrece
  const activo = dictado.activo === campo;
  const otroActivo = dictado.activo !== null && !activo;
  const titulo = !dictado.contextoSeguro
    ? 'El micrófono solo funciona por HTTPS o en localhost'
    : activo ? 'Detener dictado' : otroActivo ? 'Hay otro campo dictando' : 'Dictar por voz en este campo';
  return (
    <button
      type="button"
      onClick={() => dictado.alternar(campo, onTexto)}
      disabled={disabled || otroActivo}
      title={titulo}
      aria-pressed={activo}
      className={`min-h-[36px] lg:min-h-0 px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition-colors disabled:opacity-40 ${
        activo ? 'bg-rose-600 text-white border-rose-600 animate-pulse' : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high'
      }`}
    >
      <span className="material-symbols-outlined text-base">{activo ? 'stop_circle' : 'mic'}</span>
      {activo ? 'Escuchando…' : 'Dictar'}
    </button>
  );
}

interface TextareaProps {
  label: string;
  campo: string;
  valor: string;
  setValor: Dispatch<SetStateAction<string>>;
  dictado: Dictado;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  labelClass: string;
  inputClass: string;
  disabled?: boolean;
  /** true cuando el "dictado de consulta" está escribiendo en este campo (se resalta igual que con su propio mic). */
  resaltar?: boolean;
}

/** Textarea con etiqueta y botón "Dictar": lo dictado se ANEXA al texto existente (no lo pisa). */
export function TextareaDictado({ label, campo, valor, setValor, dictado, rows = 3, placeholder, maxLength = 5000, labelClass, inputClass, disabled, resaltar }: TextareaProps) {
  const activo = dictado.activo === campo || !!resaltar;
  const atajos = useAutotextoStore((s) => s.atajos);
  // Autotexto (1.2): ".oc" + espacio → "onicocriptosis". El cursor se recoloca tras el reemplazo.
  const onChange = (ev: ChangeEvent<HTMLTextAreaElement>) => {
    const el = ev.target;
    const exp = expandirAutotexto(el.value, el.selectionStart ?? el.value.length, atajos);
    if (!exp) { setValor(el.value); return; }
    setValor(exp.valor);
    requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = exp.cursor; } catch { /* campo desmontado */ } });
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className={`${labelClass} !mb-0`}>{label}</label>
        <BotonDictado campo={campo} dictado={dictado} disabled={disabled} onTexto={(t) => setValor((prev) => anexarDictado(prev, t))} />
      </div>
      <textarea value={valor} onChange={onChange} rows={rows} maxLength={maxLength} placeholder={placeholder} disabled={disabled}
        className={`${inputClass} ${activo ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />
      {activo && dictado.parcial && <p className="text-[11px] italic text-on-surface-variant mt-1 truncate">…{dictado.parcial}</p>}
    </div>
  );
}
