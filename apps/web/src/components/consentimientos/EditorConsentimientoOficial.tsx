// Editor del consentimiento OFICIAL por secciones (el formato que envía la clínica). Cada lista se
// escribe una línea por punto; **así** queda en negrita. Aquí también se elige a qué TRATAMIENTOS
// aplica: al agendar uno de ellos, la agenda avisa si falta firmarlo. Vista pura.
import type { ContenidoConsentimiento } from '../../api/consentimientos';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';

/** Lista ↔ texto (una línea por punto). Las líneas vacías se quitan al guardar. */
const Lineas = ({ label, valor, onChange, filas = 4, ayuda }: { label: string; valor: string[]; onChange: (v: string[]) => void; filas?: number; ayuda?: string }) => (
  <div>
    <label className={LBL}>{label}</label>
    <textarea value={valor.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} rows={filas} className={INPUT + ' leading-relaxed'} />
    {ayuda && <p className="text-[11px] text-on-surface-variant mt-0.5">{ayuda}</p>}
  </div>
);

export function EditorConsentimientoOficial({ valor, onChange, servicios }: {
  valor: ContenidoConsentimiento; onChange: (c: ContenidoConsentimiento) => void;
  servicios: { id: string; nombre: string; unidad: string }[];
}) {
  const set = <K extends keyof ContenidoConsentimiento>(k: K, v: ContenidoConsentimiento[K]) => onChange({ ...valor, [k]: v });
  const porUnidad = servicios.reduce<Record<string, typeof servicios>>((m, s) => ({ ...m, [s.unidad]: [...(m[s.unidad] ?? []), s] }), {});
  return (
    <div className="space-y-3" data-testid="editor-consentimiento-oficial">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
        <p className="text-xs font-bold text-amber-900">¿Para qué tratamientos es? (la agenda avisa si falta firmarlo)</p>
        {Object.entries(porUnidad).map(([u, xs]) => (
          <div key={u}>
            <p className="text-[10px] font-semibold uppercase text-amber-800">{u}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {xs.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm text-on-surface cursor-pointer">
                  <input type="checkbox" checked={valor.servicioIds.includes(s.id)} data-testid="servicio-consentimiento"
                    onChange={() => set('servicioIds', valor.servicioIds.includes(s.id) ? valor.servicioIds.filter((x) => x !== s.id) : [...valor.servicioIds, s.id])} />
                  {s.nombre}
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
          <span className="whitespace-nowrap">Una firma vale por</span>
          <input type="number" min={1} max={3650} value={valor.vigenciaDias} onChange={(e) => set('vigenciaDias', Number(e.target.value) || 180)}
            className="w-20 bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1 text-sm text-on-surface" />
          <span className="whitespace-nowrap">días para el mismo tratamiento</span>
        </div>
      </div>

      <div><label className={LBL}>Título (debajo de «Consentimiento informado»)</label><input value={valor.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ej. Matricectomía química con fenol de uña del pie (tratamiento definitivo del uñero)" className={INPUT} /></div>
      <div><label className={LBL}>Cómo se nombra en la declaración</label><input value={valor.nombreCorto} onChange={(e) => set('nombreCorto', e.target.value)} placeholder="«…en qué consiste el procedimiento de ___»" className={INPUT} /></div>
      <div><label className={LBL}>II · Nombre del procedimiento</label><textarea value={valor.procedimiento} onChange={(e) => set('procedimiento', e.target.value)} rows={2} className={INPUT} /></div>
      <div className="space-y-2">
        <label className={LBL}>II · Explicaciones (título en negrita + texto)</label>
        {valor.explicaciones.map((e, i) => (
          <div key={i} className="rounded-lg border border-outline-variant/30 p-2 space-y-1.5">
            <div className="flex gap-2">
              <input value={e.titulo} onChange={(ev) => set('explicaciones', valor.explicaciones.map((x, j) => (j === i ? { ...x, titulo: ev.target.value } : x)))} placeholder="Ej. Qué es la matriz de la uña" className={INPUT} />
              <button type="button" onClick={() => set('explicaciones', valor.explicaciones.filter((_, j) => j !== i))} className="material-symbols-outlined text-on-surface-variant hover:text-rose-600">delete</button>
            </div>
            <textarea value={e.texto} onChange={(ev) => set('explicaciones', valor.explicaciones.map((x, j) => (j === i ? { ...x, texto: ev.target.value } : x)))} rows={3} className={INPUT} />
          </div>
        ))}
        <button type="button" onClick={() => set('explicaciones', [...valor.explicaciones, { titulo: '', texto: '' }])} className="text-xs text-primary font-semibold hover:underline">+ Agregar explicación</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2">
        <div><label className={LBL}>Aclaración importante (título)</label><input value={valor.aclaracion?.titulo ?? ''} onChange={(e) => set('aclaracion', { titulo: e.target.value, parrafos: valor.aclaracion?.parrafos ?? [] })} className={INPUT} /></div>
        <Lineas label="Aclaración (un párrafo por línea; vacío = sin recuadro)" valor={valor.aclaracion?.parrafos ?? []} onChange={(v) => set('aclaracion', { titulo: valor.aclaracion?.titulo || 'Aclaración importante sobre el alcance de este procedimiento', parrafos: v })} filas={3} />
      </div>
      <Lineas label="III · Beneficios (uno por línea)" valor={valor.beneficios} onChange={(v) => set('beneficios', v)} />
      <div><label className={LBL}>III · Nota bajo los beneficios</label><textarea value={valor.notaBeneficios} onChange={(e) => set('notaBeneficios', e.target.value)} rows={2} className={INPUT} /></div>
      <Lineas label="IV-A · Efectos esperables y frecuentes" valor={valor.riesgos.frecuentes} onChange={(v) => set('riesgos', { ...valor.riesgos, frecuentes: v })} />
      <Lineas label="IV-B · Complicaciones poco frecuentes" valor={valor.riesgos.pocoFrecuentes} onChange={(v) => set('riesgos', { ...valor.riesgos, pocoFrecuentes: v })} />
      <Lineas label="IV-C · Complicaciones raras, pero graves" valor={valor.riesgos.raros} onChange={(v) => set('riesgos', { ...valor.riesgos, raros: v })} />
      <Lineas label="V · Riesgos particulares (casillas)" valor={valor.riesgosParticulares} onChange={(v) => set('riesgosParticulares', v)} filas={5} ayuda="Diabetes, anticoagulante, circulación, neuropatía, alergia, úlcera, embarazo, defensas, tabaquismo y queloide se premarcan solos si la historia los registra." />
      <Lineas label="VI · Medicamentos y materiales (un párrafo por línea)" valor={valor.medicamentos} onChange={(v) => set('medicamentos', v)} filas={3} />
      <Lineas label="VII · Alternativas (una por línea)" valor={valor.alternativas} onChange={(v) => set('alternativas', v)} />
      <Lineas label="VIII · Cuidados posteriores (uno por línea)" valor={valor.cuidados} onChange={(v) => set('cuidados', v)} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-sm text-on-surface"><input type="checkbox" checked={valor.campos.dedos} onChange={(e) => set('campos', { ...valor.campos, dedos: e.target.checked })} />Pedir «dedo o dedos a intervenir»</label>
        <Lineas label="Opciones de alcance (vacío = no se pide)" valor={valor.campos.alcance} onChange={(v) => set('campos', { ...valor.campos, alcance: v })} filas={3} />
      </div>
      <p className="text-[11px] text-on-surface-variant">Los datos del paciente, la declaración de conformidad, las firmas, la revocatoria y el marco normativo los pone el sistema. Lo ya firmado no cambia si editas esta plantilla.</p>
    </div>
  );
}

