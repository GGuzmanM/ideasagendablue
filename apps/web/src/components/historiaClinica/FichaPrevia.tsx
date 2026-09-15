// Ficha previa "de 10 segundos" (2.8): banderas de riesgo, alergias y lo último del paciente, para
// leer antes de entrar al consultorio. Vista pura; los datos vienen de useFichaPrevia (api).
import { TIPO_PROCEDIMIENTO_LABEL, PIE_LABEL, type FichaPrevia, type NivelBandera } from '../../api/historiaClinica';
import { useFotoUrl } from '../../services/historiaClinicaService';
import { fmtFechaDia, fmtFechaLima } from '../../utils/fechas';

const fmt = fmtFechaDia;
const CHIP: Record<NivelBandera, string> = {
  alto: 'bg-rose-100 text-rose-800 border-rose-200',
  medio: 'bg-amber-100 text-amber-800 border-amber-200',
  info: 'bg-sky-100 text-sky-800 border-sky-200',
};

function FotoMini({ id, zona, fecha }: { id: string; zona: string | null; fecha: string }) {
  const { url } = useFotoUrl(id);
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-12 rounded-lg overflow-hidden bg-surface-container-low shrink-0 border border-outline-variant/30">
        {url && <img src={url} alt={zona ?? 'Foto anterior'} className="w-full h-full object-cover" />}
      </div>
      <span className="text-[11px] text-on-surface-variant">Foto anterior{zona ? `: ${zona}` : ''} · {fmtFechaLima(fecha)}</span>
    </div>
  );
}

export function FichaPreviaCard({ ficha, cargando }: { ficha: FichaPrevia | undefined; cargando?: boolean }) {
  if (cargando && !ficha) return <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 text-xs text-on-surface-variant">Cargando ficha previa…</div>;
  if (!ficha) return null;
  const sesiones = ficha.sesionesPendientes.reduce((n, q) => n + q.restantes, 0);
  // Paciente de años en la clínica: lo que quedó del sistema anterior (Genexis) también cuenta.
  const gx = ficha.genexis;
  const lineaGenexis = gx.total > 0 && (
    <p className="text-xs text-on-surface" data-testid="ficha-genexis">
      <span className="text-on-surface-variant">Sistema anterior:</span> {gx.total} {gx.total === 1 ? 'visita' : 'visitas'}
      {gx.ultima && <> · última {fmt(gx.ultima.fecha)}{gx.ultima.servicio ? ` · ${gx.ultima.servicio}` : ''}{gx.ultima.podologo ? ` · ${gx.ultima.podologo}` : ''}</>}
    </p>
  );
  if (!ficha.tieneHistoria) {
    return (
      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 text-xs text-on-surface-variant space-y-1">
        <p className="flex items-center gap-2">
          <span className="material-symbols-outlined text-base">clinical_notes</span>
          {gx.total > 0 ? 'Sin historia clínica nueva todavía' : 'Sin historia clínica todavía'}{sesiones ? ` · ${sesiones} sesión(es) por usar` : ''}
        </p>
        {lineaGenexis}
      </div>
    );
  }
  const banderas = ficha.banderas.filter((b) => !b.clave.startsWith('alergia:'));
  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 space-y-2" data-testid="ficha-previa">
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-on-surface-variant">
        <span className="material-symbols-outlined text-primary text-base">bolt</span>
        <b className="text-on-surface text-xs">Ficha previa</b>
        <span className="font-mono-label">HC N° {String(ficha.numero ?? 0).padStart(6, '0')}</span>
        <span>· {ficha.totalAtenciones} {ficha.totalAtenciones === 1 ? 'atención' : 'atenciones'}</span>
      </div>
      {(ficha.alergias.length > 0 || banderas.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {ficha.alergias.map((a, i) => (
            <span key={`${a.sustancia}-${i}`} className="px-2 py-0.5 rounded-md text-[11px] font-bold border bg-rose-600 text-white border-rose-700 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">warning</span>Alergia: {a.sustancia}{a.severidad === 'severa' ? ' (severa)' : ''}
            </span>
          ))}
          {banderas.map((b) => <span key={b.clave} className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${CHIP[b.nivel]}`}>{b.etiqueta}</span>)}
        </div>
      )}
      {ficha.alergias.length === 0 && banderas.length === 0 && <p className="text-[11px] text-emerald-700 flex items-center gap-1"><span className="material-symbols-outlined text-sm">check_circle</span>Sin alergias ni banderas de riesgo registradas</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-on-surface">
        {ficha.ultimoDx && <p><span className="text-on-surface-variant">Último diagnóstico:</span> <b className="text-primary font-mono-label">{ficha.ultimoDx.codigo}</b> {ficha.ultimoDx.descripcion} <span className="text-on-surface-variant">· {fmt(ficha.ultimoDx.fecha)}</span></p>}
        {ficha.ultimoProcedimiento && <p><span className="text-on-surface-variant">Último procedimiento:</span> {TIPO_PROCEDIMIENTO_LABEL[ficha.ultimoProcedimiento.tipo] ?? ficha.ultimoProcedimiento.nombre}{ficha.ultimoProcedimiento.pie ? ` · ${PIE_LABEL[ficha.ultimoProcedimiento.pie]}` : ''}{ficha.ultimoProcedimiento.ubicacion ? ` · ${ficha.ultimoProcedimiento.ubicacion}` : ''} <span className="text-on-surface-variant">· {fmt(ficha.ultimoProcedimiento.fecha)}</span></p>}
        {/* El riesgo IWGDF ya sale como bandera (arriba); aquí solo la fecha de esa evaluación */}
        {ficha.riesgoIwgdf && <p><span className="text-on-surface-variant">Riesgo del pie evaluado el</span> {fmt(ficha.riesgoIwgdf.fecha)}</p>}
        {ficha.ultimaAtencion && <p><span className="text-on-surface-variant">Última atención:</span> {fmt(ficha.ultimaAtencion.fecha)} · {ficha.ultimaAtencion.profesional} · {ficha.ultimaAtencion.sede}{ficha.ultimaAtencion.estado === 'abierta' ? <> <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">abierta</span></> : null}</p>}
        {ficha.sesionesPendientes.map((q) => <p key={q.nombre}><span className="text-on-surface-variant">Sesiones:</span> {q.nombre} · <b>{q.restantes}</b> de {q.total} por usar</p>)}
        {lineaGenexis}
      </div>
      {ficha.fotoAnterior && <FotoMini id={ficha.fotoAnterior.id} zona={ficha.fotoAnterior.zona} fecha={ficha.fotoAnterior.tomadaEn} />}
    </div>
  );
}
