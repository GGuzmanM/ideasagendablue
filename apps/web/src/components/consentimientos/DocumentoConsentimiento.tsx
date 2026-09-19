// El documento OFICIAL del consentimiento tal como lo lee el paciente en la tablet (secciones II a IX).
// Vista pura. En los textos, **así** va en negrita, igual que en el formato de la clínica.
import type { ReactNode } from 'react';
import type { ContenidoConsentimiento } from '../../api/consentimientos';

export function TextoNegrita({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return <>{partes.map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p.replace(/\*\*/g, '')}</span>))}</>;
}

const Seccion = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <section className="space-y-1.5">
    <h4 className="text-[11px] font-bold uppercase tracking-wide text-on-surface bg-surface-container-low px-2 py-1 rounded border-l-4 border-primary">{titulo}</h4>
    <div className="text-[13px] leading-relaxed text-on-surface space-y-1.5">{children}</div>
  </section>
);
const Vinetas = ({ xs }: { xs: string[] }) => <ul className="list-disc pl-5 space-y-1">{xs.map((x, i) => <li key={i}><TextoNegrita texto={x} /></li>)}</ul>;

/** Declaración (IX): igual para todos los procedimientos; la misma que imprime el PDF. */
export const declaracion = (nombreCorto: string) => [
  `Declaro que el profesional tratante me ha explicado, en lenguaje sencillo y comprensible, en qué consiste el procedimiento de **${nombreCorto}**, los beneficios que se esperan, los riesgos y complicaciones específicos descritos en este documento, los riesgos particulares de mi caso, los medicamentos y materiales que se utilizarán y las alternativas existentes, incluida la de no someterme a ningún tratamiento.`,
  'Declaro que he tenido la oportunidad de formular todas las preguntas que consideré necesarias, que estas me han sido respondidas de forma satisfactoria, y que he dispuesto del tiempo suficiente para reflexionar y tomar mi decisión.',
  'Declaro además que he informado con veracidad sobre mi estado de salud, enfermedades, alergias y medicamentos que consumo.',
  'En consecuencia, **autorizo de forma libre y voluntaria** la realización del procedimiento descrito, sabiendo que puedo revocar esta autorización en cualquier momento, antes de su inicio, sin necesidad de expresar el motivo y sin que ello afecte la atención que recibo.',
];

export function DocumentoConsentimiento({ c, riesgosMarcados, otraCondicion, dedos, alcance }: {
  c: ContenidoConsentimiento; riesgosMarcados: string[]; otraCondicion?: string; dedos?: string; alcance?: string | null;
}) {
  return (
    <div className="space-y-4" data-testid="documento-consentimiento">
      <Seccion titulo="II. Procedimiento propuesto">
        <p><b>Nombre del procedimiento:</b> <TextoNegrita texto={c.procedimiento} /></p>
        {(c.campos.dedos || c.campos.alcance.length > 0) && (
          <p className="text-on-surface-variant">
            {c.campos.dedos && <>Dedo o dedos a intervenir: <b className="text-on-surface">{dedos?.trim() || '—'}</b>. </>}
            {c.campos.alcance.length > 0 && <>Alcance: <b className="text-on-surface">{alcance ?? '—'}</b>.</>}
          </p>
        )}
        {c.explicaciones.map((e, i) => <p key={i}><b>{e.titulo}:</b> <TextoNegrita texto={e.texto} /></p>)}
        {c.aclaracion && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary">{c.aclaracion.titulo}</p>
            {c.aclaracion.parrafos.map((p, i) => <p key={i}><TextoNegrita texto={p} /></p>)}
          </div>
        )}
      </Seccion>
      <Seccion titulo="III. Beneficios que se esperan obtener">
        <Vinetas xs={c.beneficios} />
        {c.notaBeneficios && <p className="text-xs italic text-on-surface-variant">{c.notaBeneficios}</p>}
      </Seccion>
      <Seccion titulo="IV. Riesgos y complicaciones del procedimiento">
        {c.riesgos.frecuentes.length > 0 && <><p className="text-[11px] font-bold uppercase">A. Efectos esperables y frecuentes — forman parte de la recuperación normal</p><Vinetas xs={c.riesgos.frecuentes} /></>}
        {c.riesgos.pocoFrecuentes.length > 0 && <><p className="text-[11px] font-bold uppercase">B. Complicaciones poco frecuentes</p><Vinetas xs={c.riesgos.pocoFrecuentes} /></>}
        {c.riesgos.raros.length > 0 && <><p className="text-[11px] font-bold uppercase">C. Complicaciones raras, pero graves</p><Vinetas xs={c.riesgos.raros} /></>}
      </Seccion>
      <Seccion titulo="V. Riesgos particulares en su caso">
        {riesgosMarcados.length || otraCondicion?.trim()
          ? <ul className="pl-1 space-y-0.5">{[...riesgosMarcados, ...(otraCondicion?.trim() ? [`Otra condición: ${otraCondicion.trim()}`] : [])].map((r) => <li key={r}>☑ {r}</li>)}</ul>
          : <p className="text-on-surface-variant">Ninguna condición marcada.</p>}
      </Seccion>
      <Seccion titulo="VI. Medicamentos y materiales que se utilizarán y sus posibles efectos">
        {c.medicamentos.map((p, i) => <p key={i}><TextoNegrita texto={p} /></p>)}
      </Seccion>
      <Seccion titulo="VII. Alternativas al procedimiento propuesto"><Vinetas xs={c.alternativas} /></Seccion>
      {c.cuidados.length > 0 && <Seccion titulo="VIII. Cuidados posteriores y compromisos del paciente"><Vinetas xs={c.cuidados} /></Seccion>}
      <Seccion titulo="IX. Declaración de conformidad"><Vinetas xs={declaracion(c.nombreCorto)} /></Seccion>
    </div>
  );
}
