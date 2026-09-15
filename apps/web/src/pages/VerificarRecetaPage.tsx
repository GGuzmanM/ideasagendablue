// Página PÚBLICA de verificación de recetas e indicaciones (la abre el QR del PDF, sin login).
// Muestra si el documento es auténtico y está vigente, con lo mínimo: número, fechas, emisor y su
// registro, sede e ítems. Del paciente solo las iniciales.
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { verificarReceta, TIPO_DOC_LABEL, TIPO_ITEM_LABEL } from '../api/recetas';

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'long', year: 'numeric' });

export function VerificarRecetaPage() {
  const { codigo = '' } = useParams();
  const { data: v, isLoading, error } = useQuery({
    queryKey: ['verificar-receta', codigo],
    queryFn: () => verificarReceta(codigo),
    retry: false,
  });

  const estado = !v ? null
    : v.estado === 'anulada' ? { texto: 'Documento ANULADO', detalle: 'No debe dispensarse.', color: 'bg-rose-600', icono: 'block' }
    : v.vigente ? { texto: 'Documento auténtico y vigente', detalle: v.vence ? `Válido hasta el ${fecha(v.vence)}.` : 'Emitido por la clínica.', color: 'bg-emerald-600', icono: 'verified' }
    : { texto: 'Documento auténtico, pero VENCIDO', detalle: v.vence ? `Venció el ${fecha(v.vence)}.` : '', color: 'bg-amber-600', icono: 'schedule' };

  return (
    <div className="min-h-screen bg-slate-100 flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-[#003366] px-6 py-4 flex items-center gap-3">
          <img src="/LOGO LB.png" alt="Limablue" className="h-8 bg-white rounded-md px-2 py-1" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div className="text-white">
            <p className="font-bold leading-tight">Verificación de documento</p>
            <p className="text-xs text-white/70">Código {codigo.toUpperCase()}</p>
          </div>
        </div>

        {isLoading && <p className="p-8 text-center text-slate-500">Verificando…</p>}

        {error && (
          <div className="p-8 text-center space-y-2">
            <span className="material-symbols-outlined text-5xl text-rose-600">gpp_bad</span>
            <p className="font-bold text-slate-800">No encontramos un documento con ese código</p>
            <p className="text-sm text-slate-500">Revise que el código esté bien escrito. Si lo escaneó del QR y no aparece, el documento no fue emitido por esta clínica.</p>
          </div>
        )}

        {v && estado && (
          <>
            <div className={`${estado.color} text-white px-6 py-4 flex items-center gap-3`}>
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>{estado.icono}</span>
              <div>
                <p className="font-bold">{estado.texto}</p>
                {estado.detalle && <p className="text-sm text-white/90">{estado.detalle}</p>}
              </div>
            </div>
            <dl className="px-6 py-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="col-span-2"><dt className="text-[11px] uppercase text-slate-500 font-semibold">Documento</dt><dd className="font-semibold text-slate-800">{TIPO_DOC_LABEL[v.tipoDocumento]} N° {String(v.numero).padStart(6, '0')}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Emitido</dt><dd className="text-slate-800">{fecha(v.fechaEmision)}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Paciente</dt><dd className="text-slate-800">{v.paciente || '—'}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Emitido por</dt><dd className="text-slate-800">{v.emisor.nombre}{v.emisor.registro ? ` · ${v.emisor.registro}` : ''}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Sede</dt><dd className="text-slate-800">{v.sede}</dd></div>
            </dl>
            <div className="px-6 pb-6">
              <p className="text-[11px] uppercase text-slate-500 font-semibold mb-2">Contenido</p>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {v.items.map((it, i) => (
                  <li key={i} className="px-3 py-2 flex items-start gap-2 text-sm">
                    <span className="text-slate-400 w-5 text-right">{i + 1}</span>
                    <span className="flex-1 text-slate-800">{it.nombre}{it.marca ? <span className="text-slate-500"> ({it.marca})</span> : null}{it.cantidad ? <span className="text-slate-500"> · {it.cantidad}</span> : null}</span>
                    <span className="text-[10px] font-bold uppercase text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">{TIPO_ITEM_LABEL[it.tipo]}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-400 mt-4">Por privacidad no se muestran los datos del paciente. Esta consulta queda registrada.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
