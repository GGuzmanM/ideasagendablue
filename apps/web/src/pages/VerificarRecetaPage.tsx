// Página PÚBLICA de verificación (la abre el QR del PDF, sin login): recetas, indicaciones,
// constancias de atención y descansos médicos. Muestra si el documento es auténtico y está vigente,
// con lo mínimo: número, fechas, emisor y su registro, sede y (en recetas) los ítems. Del paciente
// solo las iniciales.
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { verificarDocumento, TIPO_DOC_LABEL, TIPO_ITEM_LABEL } from '../api/recetas';

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'long', year: 'numeric' });
const dia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const LABEL_CONSTANCIA = { constancia_atencion: 'Constancia de atención', descanso_medico: 'Certificado de descanso médico' } as const;

export function VerificarRecetaPage() {
  const { codigo = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['verificar-documento', codigo],
    queryFn: () => verificarDocumento(codigo),
    retry: false,
  });
  const v = data && 'receta' in data ? data.receta : null;
  const c = data && 'constancia' in data ? data.constancia : null;
  const doc = v ?? c;

  const estado = !doc ? null
    : doc.estado === 'anulada' ? { texto: 'Documento ANULADO', detalle: v ? 'No debe dispensarse.' : 'No tiene validez.', color: 'bg-rose-600', icono: 'block' }
    : doc.vigente ? { texto: 'Documento auténtico y vigente', detalle: v?.vence ? `Válido hasta el ${fecha(v.vence)}.` : 'Emitido por la clínica.', color: 'bg-emerald-600', icono: 'verified' }
    : { texto: 'Documento auténtico, pero VENCIDO', detalle: v?.vence ? `Venció el ${fecha(v.vence)}.` : '', color: 'bg-amber-600', icono: 'schedule' };

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

        {error && ((error as { statusCode?: number }).statusCode === 404 || (error as { statusCode?: number }).statusCode === 400 ? (
          <div className="p-8 text-center space-y-2">
            <span className="material-symbols-outlined text-5xl text-rose-600">gpp_bad</span>
            <p className="font-bold text-slate-800">No encontramos un documento con ese código</p>
            <p className="text-sm text-slate-500">Revise que el código esté bien escrito. Si lo escaneó del QR y no aparece, el documento no fue emitido por esta clínica.</p>
          </div>
        ) : (
          // Sin conexión o falla del servidor: NO significa que el documento sea falso.
          <div className="p-8 text-center space-y-2">
            <span className="material-symbols-outlined text-5xl text-amber-600">wifi_off</span>
            <p className="font-bold text-slate-800">No pudimos conectar con la clínica</p>
            <p className="text-sm text-slate-500">Revise la conexión a internet e inténtelo de nuevo en un momento.</p>
          </div>
        ))}

        {doc && estado && (
          <>
            <div className={`${estado.color} text-white px-6 py-4 flex items-center gap-3`}>
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>{estado.icono}</span>
              <div>
                <p className="font-bold">{estado.texto}</p>
                {estado.detalle && <p className="text-sm text-white/90">{estado.detalle}</p>}
              </div>
            </div>
            <dl className="px-6 py-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="col-span-2"><dt className="text-[11px] uppercase text-slate-500 font-semibold">Documento</dt><dd className="font-semibold text-slate-800">{v ? `${TIPO_DOC_LABEL[v.tipoDocumento]} N° ${String(v.numero).padStart(6, '0')}` : `${LABEL_CONSTANCIA[c!.tipoDocumento]} N° ${String(c!.numero).padStart(5, '0')}`}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Emitido</dt><dd className="text-slate-800">{fecha(doc.fechaEmision)}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Paciente</dt><dd className="text-slate-800">{doc.paciente || '—'}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Emitido por</dt><dd className="text-slate-800">{doc.emisor.nombre}{doc.emisor.registro ? ` · ${doc.emisor.registro}` : ''}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Sede</dt><dd className="text-slate-800">{doc.sede}</dd></div>
              {c?.tipoDocumento === 'descanso_medico' && c.desde && c.hasta && (
                <div className="col-span-2"><dt className="text-[11px] uppercase text-slate-500 font-semibold">Descanso</dt><dd className="text-slate-800 font-semibold">{c.dias} día(s): del {dia(c.desde)} al {dia(c.hasta)} inclusive</dd></div>
              )}
            </dl>
            {v && (
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
              </div>
            )}
            <p className="px-6 pb-6 text-[11px] text-slate-400">Por privacidad no se muestran los datos del paciente. Esta consulta queda registrada.</p>
          </>
        )}
      </div>
    </div>
  );
}
