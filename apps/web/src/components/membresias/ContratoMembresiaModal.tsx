import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { membresiasApi, verContratoMembresia, type CampoContrato, type PosicionCampo } from '../../api/membresias';
import { useAuthStore } from '../../stores/authStore';

const CAMPOS: { key: CampoContrato; label: string; color: string }[] = [
  { key: 'nombre', label: 'Nombre', color: '#0044ab' },
  { key: 'dni', label: 'DNI', color: '#7c3aed' },
  { key: 'fecha', label: 'Fecha', color: '#047857' },
];
const DEFAULTS: Record<CampoContrato, { xPct: number; yPct: number }> = {
  nombre: { xPct: 0.15, yPct: 0.20 },
  dni: { xPct: 0.15, yPct: 0.26 },
  fecha: { xPct: 0.15, yPct: 0.85 },
};

/**
 * Configurador del contrato de una membresía: subir el PDF y marcar UNA vez dónde van los
 * datos. La plantilla se muestra en un <iframe> nativo (el navegador renderiza el PDF), con
 * los chips arrastrables encima. Las posiciones se guardan en % de la página.
 */
export function ContratoMembresiaModal({ promoId, nombre, onCerrar }: { promoId: string; nombre: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [caja, setCaja] = useState<{ w: number; h: number } | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<CampoContrato, PosicionCampo>>(() =>
    Object.fromEntries(CAMPOS.map((c) => [c.key, { campo: c.key, pagina: 0, ...DEFAULTS[c.key], tamanio: 12, anchoPct: 0.4 }])) as Record<CampoContrato, PosicionCampo>,
  );
  const [subiendo, setSubiendo] = useState(false);

  const { data: config, isLoading } = useQuery({ queryKey: ['contrato-config', promoId], queryFn: () => membresiasApi.contratoConfig(promoId) });

  // Cargar posiciones guardadas.
  useEffect(() => {
    if (!config?.contratoCampos?.length) return;
    setCampos((prev) => {
      const next = { ...prev };
      for (const c of config.contratoCampos) if (next[c.campo]) next[c.campo] = { ...next[c.campo], ...c };
      return next;
    });
  }, [config?.contratoCampos]);

  // Dimensionar la caja (aspecto de la página) y cargar el PDF como blob (autenticado).
  useEffect(() => {
    if (!config?.contratoPlantillaUrl) return;
    const ANCHO = 440;
    const ratio = config.pagina && config.pagina.width ? config.pagina.height / config.pagina.width : 1.4142;
    setCaja({ w: ANCHO, h: Math.round(ANCHO * ratio) });
    let url: string | null = null;
    (async () => {
      try {
        const token = useAuthStore.getState().token;
        const res = await fetch(`/api/v1/membresias/${promoId}/contrato-plantilla-archivo`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('No se pudo cargar la plantilla');
        url = URL.createObjectURL(await res.blob());
        setBlobUrl(url);
      } catch (e) { toast.error((e as Error).message); }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [config?.contratoPlantillaUrl, config?.pagina, promoId]);

  const subir = async (file: File) => {
    setSubiendo(true);
    try {
      await membresiasApi.subirPlantilla(promoId, file);
      await qc.invalidateQueries({ queryKey: ['contrato-config', promoId] });
      qc.invalidateQueries({ queryKey: ['membresias'] });
      toast.success('Contrato subido — ahora marca dónde van los datos');
    } catch (e) { toast.error((e as Error).message); }
    finally { setSubiendo(false); }
  };

  const guardar = useMutation({
    mutationFn: () => membresiasApi.guardarCampos(promoId, CAMPOS.map((c) => campos[c.key])),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['membresias'] }); toast.success('Posiciones guardadas'); onCerrar(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Arrastre de un chip.
  const dragRef = useRef<{ key: CampoContrato; offX: number; offY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent, key: CampoContrato) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = { key, offX: e.clientX - r.left, offY: e.clientY - r.top };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d || !caja || !overlayRef.current) return;
    const cont = overlayRef.current.getBoundingClientRect();
    let x = e.clientX - cont.left - d.offX, y = e.clientY - cont.top - d.offY;
    x = Math.max(0, Math.min(x, caja.w - 20));
    y = Math.max(0, Math.min(y, caja.h - 10));
    setCampos((prev) => ({ ...prev, [d.key]: { ...prev[d.key], xPct: x / caja.w, yPct: y / caja.h } }));
  };
  const onPointerUp = () => { dragRef.current = null; };

  // Ver cómo queda: guarda las posiciones actuales y abre el PDF con datos de ejemplo.
  const [viendo, setViendo] = useState(false);
  const verEjemplo = async () => {
    setViendo(true);
    try {
      await membresiasApi.guardarCampos(promoId, CAMPOS.map((c) => campos[c.key]));
      await verContratoMembresia(promoId, { muestra: true });
    } catch (e) { toast.error((e as Error).message); }
    finally { setViendo(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/40" onClick={onCerrar} />
      <div className="fixed z-[95] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-w-[95vw] max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200" role="dialog">
        <div className="bg-[#0044ab] px-5 py-3.5 flex items-center gap-2.5 sticky top-0 z-10">
          <span className="material-symbols-outlined text-white/90" style={{ fontVariationSettings: "'FILL' 1" }}>contract_edit</span>
          <div className="flex-1 min-w-0"><h2 className="text-white font-bold text-sm leading-tight">Contrato · {nombre}</h2><p className="text-white/70 text-[11px]">Se configura una vez; todos los clientes salen pre-llenados</p></div>
          <button onClick={onCerrar} className="material-symbols-outlined text-white/80 hover:text-white">close</button>
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="py-10 text-center text-slate-400 text-sm">Cargando…</div>
          ) : !config?.contratoPlantillaUrl ? (
            <label className="block border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-[#0044ab]/50 hover:bg-[#0044ab]/[.03] transition">
              <input type="file" accept="application/pdf" className="hidden" disabled={subiendo}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} />
              <span className="material-symbols-outlined text-slate-400 text-4xl">upload_file</span>
              <p className="text-sm font-semibold text-slate-700 mt-2">{subiendo ? 'Subiendo…' : 'Sube el PDF del contrato'}</p>
              <p className="text-xs text-slate-400 mt-1">El área de contratos lo entrega como siempre (con el espacio en blanco).</p>
            </label>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-3">Arrastra cada dato al lugar donde debe imprimirse en el contrato:</p>
              <div className="flex justify-center">
                <div ref={overlayRef} className="relative shadow-md border border-slate-200 bg-slate-100"
                  style={{ width: caja?.w, height: caja?.h, touchAction: 'none' }}
                  onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                  {blobUrl && (
                    <iframe title="Contrato" src={`${blobUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} className="absolute inset-0 w-full h-full border-0" style={{ pointerEvents: 'none' }} />
                  )}
                  {caja && CAMPOS.map((c) => {
                    const p = campos[c.key];
                    return (
                      <div key={c.key} onPointerDown={(e) => onPointerDown(e, c.key)}
                        className="absolute text-[11px] font-bold px-2 py-0.5 rounded-md cursor-grab active:cursor-grabbing select-none whitespace-nowrap shadow-sm"
                        style={{ left: p.xPct * caja.w, top: p.yPct * caja.h, border: `2px dashed ${c.color}`, background: `${c.color}22`, color: c.color, touchAction: 'none' }}>
                        ◇ {c.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <label className="text-xs text-[#0044ab] font-semibold cursor-pointer hover:underline">
                  <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} />
                  Cambiar PDF
                </label>
                <div className="flex gap-2">
                  <button onClick={verEjemplo} disabled={viendo} className="btn-sm border border-[#0044ab]/40 text-[#0044ab] rounded-lg px-3 hover:bg-[#0044ab]/5 disabled:opacity-50 flex items-center gap-1">
                    <span className="material-symbols-outlined text-base">visibility</span>{viendo ? 'Abriendo…' : 'Ver ejemplo'}
                  </button>
                  <button onClick={onCerrar} className="btn-secondary btn-sm">Cancelar</button>
                  <button onClick={() => guardar.mutate()} disabled={guardar.isPending} className="btn-primary btn-sm disabled:opacity-50">
                    {guardar.isPending ? 'Guardando…' : 'Guardar posiciones'}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Al imprimir, el texto se ajusta de tamaño para que un nombre largo nunca se desborde.</p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
