// Resumen de la atención PARA EL PACIENTE (4.4): lo que se lleva a casa. Muestra la vista previa
// tal como saldrá en el PDF, permite imprimirlo o descargarlo y enviarlo por correo con el PDF
// adjunto. Vista pura: la lógica vive en services/resumenPacienteService.ts.
import { useResumenPaciente } from '../../services/resumenPacienteService';

const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ResumenPacienteDialog({ atencionId, puedeRegistrar, onClose }: { atencionId: string; puedeRegistrar: boolean; onClose: () => void }) {
  const r = useResumenPaciente(atencionId);
  const d = r.datos;
  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(ev) => ev.stopPropagation()} data-testid="resumen-paciente">
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div>
            <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">summarize</span>Resumen para el paciente
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">Lo que se lleva a casa, en palabras simples: qué se hizo, qué debe hacer y cuándo volver.</p>
          </div>
          <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant hover:text-on-surface">close</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-2">
          {r.cargando && <p className="text-sm text-on-surface-variant py-10 text-center">Preparando el resumen…</p>}
          {r.error && <p className="text-sm text-rose-700 py-6">{r.error}</p>}
          {d && (
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 p-5 space-y-4" data-testid="resumen-vista">
              <div>
                <p className="text-base font-bold text-on-surface">{d.resumen.paciente}</p>
                <p className="text-xs text-on-surface-variant">Atención del {d.resumen.fecha}{d.resumen.profesional ? ` · ${d.resumen.profesional}` : ''}{d.resumen.sede ? ` · ${d.resumen.sede}` : ''}</p>
              </div>
              {d.resumen.secciones.map((s) => {
                const alarma = s.titulo.startsWith('Vuelve antes');
                return (
                  <section key={s.titulo} className={alarma ? 'rounded-xl border border-rose-200 bg-rose-50/60 p-3' : ''}>
                    <h4 className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${alarma ? 'text-rose-700' : 'text-primary'}`}>{s.titulo}</h4>
                    <ul className="space-y-1">
                      {s.items.map((it, i) => (
                        <li key={i} className="text-sm text-on-surface flex gap-2">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${alarma ? 'bg-rose-500' : 'bg-primary'}`} />
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                    {s.nota && <p className="text-[11px] italic text-on-surface-variant mt-1.5">{s.nota}</p>}
                  </section>
                );
              })}
              <p className="text-[11px] text-on-surface-variant border-t border-outline-variant/30 pt-3">{d.resumen.pie}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-outline-variant/20 flex flex-wrap items-center gap-3">
          {d && (
            // Primero el problema, si lo hay: que ya se haya enviado antes no quita que HOY el correo
            // no sirva. El historial va debajo, como dato.
            <span className="text-[11px] text-on-surface-variant flex-1 min-w-[200px] flex flex-col gap-0.5">
              {d.motivoNoEnviable
                ? <span className="text-amber-700 font-semibold">{d.motivoNoEnviable}</span>
                : <span>Se enviará a <b className="text-on-surface">{d.correo}</b> con el PDF adjunto.</span>}
              {d.ultimoEnvio && <span>Ya se envió el {fmtFechaHora(d.ultimoEnvio.enviadoEn)}{d.correo && !d.motivoNoEnviable ? ` a ${d.correo}` : ''}.</span>}
            </span>
          )}
          <button type="button" onClick={r.verPdf} disabled={!d} data-testid="resumen-pdf"
            className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5 disabled:opacity-50">
            <span className="material-symbols-outlined text-base">picture_as_pdf</span>Ver o imprimir
          </button>
          {puedeRegistrar && (
            <button type="button" onClick={() => r.enviarMut.mutate()} data-testid="resumen-enviar"
              disabled={!d || !!d.motivoNoEnviable || r.enviarMut.isPending}
              className="min-h-[44px] lg:min-h-0 px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold flex items-center gap-1.5 disabled:opacity-50">
              <span className="material-symbols-outlined text-base">send</span>
              {r.enviarMut.isPending ? 'Enviando…' : d?.ultimoEnvio ? 'Enviar de nuevo' : 'Enviar por correo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
