// Piezas de la HC v2 (02-oct-2026), en validación: solo se ven con ?hc=v2 en la vista de una sola pestaña.
//  · NiegaChecks: «Niega alergias» / «Niega antecedentes <tipo>» (se preguntó y el paciente niega).
//  · PanelNotasMedico: notas internas para los próximos médicos del paciente (solo médicos, admin y coordinación).
//  · SubirConsentimientoFoto: foto del formato en papel firmado (cámara del equipo o archivo).
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  historiaClinicaApi, useInvalidarHistoriaClinica, TIPO_ANTECEDENTE_LABEL,
  type AtencionCompleta, type CategoriaNiega, type NegacionHc, type TipoAntecedente,
} from '../../api/historiaClinica';
import { useAuthStore } from '../../stores/authStore';
import { esRolMedico } from '../../utils/rolesMedico';
import { useCamaraEnVivo } from '../../hooks/useCamaraEnVivo';
import { consentimientosApi } from '../../api/consentimientos';

const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';

// ─── «Niega» ──────────────────────────────────────────────────────────────────
export function useNegaciones(pacienteId: string | undefined) {
  const invalidar = useInvalidarHistoriaClinica();
  return useMutation({
    mutationFn: (p: { categoria: CategoriaNiega; activa: boolean }) => historiaClinicaApi.marcarNegacion(pacienteId!, p),
    onSuccess: () => invalidar({ pacienteId }),
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Checks «Niega …». Una categoría que ya tiene registros activos no se ofrece (no se puede negar lo registrado).
 * Marcado = el paciente niega; queda quién y cuándo lo marcó.
 */
export function NiegaChecks({ pacienteId, negaciones, categorias, conRegistros, editable, titulo }: {
  pacienteId: string | undefined;
  negaciones: NegacionHc[];
  categorias: { id: CategoriaNiega; label: string }[];
  conRegistros: Set<CategoriaNiega>;
  editable: boolean;
  titulo?: string;
}) {
  const mut = useNegaciones(pacienteId);
  const visibles = categorias.filter((c) => !conRegistros.has(c.id));
  if (visibles.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-surface-container-low/60 px-3 py-2" data-testid="niega-checks">
      {titulo && <span className="text-xs font-semibold text-on-surface-variant">{titulo}</span>}
      {visibles.map((c) => {
        const neg = negaciones.find((n) => n.categoria === c.id);
        return (
          <label key={c.id} className={`flex items-center gap-1.5 text-sm ${editable ? 'cursor-pointer' : ''}`} title={neg ? `Marcado por ${neg.registradoEtiqueta ?? '—'} · ${fmtFechaHora(neg.actualizadoEn)}` : 'Marca si se le preguntó y el paciente lo niega'}>
            <input type="checkbox" checked={!!neg} disabled={!editable || mut.isPending} data-testid={`niega-${c.id}`}
              onChange={(e) => mut.mutate({ categoria: c.id, activa: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
            <span className={neg ? 'font-semibold text-emerald-800' : 'text-on-surface'}>{c.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export const CATEGORIAS_ANTECEDENTE_NIEGA: { id: TipoAntecedente; label: string }[] =
  (Object.keys(TIPO_ANTECEDENTE_LABEL) as TipoAntecedente[]).map((t) => ({ id: t, label: TIPO_ANTECEDENTE_LABEL[t] }));

// ─── Notas para doctores ──────────────────────────────────────────────────────
export function puedeVerNotasMedico(rol: string | null | undefined): boolean {
  return esRolMedico(rol) || rol === 'admin' || rol === 'coordinadora_sedes';
}

export function PanelNotasMedico({ pacienteId, puedeEscribir }: { pacienteId: string; puedeEscribir: boolean }) {
  const qc = useQueryClient();
  const usuario = useAuthStore((s) => s.usuario);
  const [texto, setTexto] = useState('');
  const visible = puedeVerNotasMedico(usuario?.rol);
  const clave = ['notas-medico', pacienteId];
  const { data: notas = [], isLoading } = useQuery({ queryKey: clave, queryFn: () => historiaClinicaApi.notasMedico(pacienteId), enabled: visible, staleTime: 30_000 });
  const crearMut = useMutation({
    mutationFn: () => historiaClinicaApi.crearNotaMedico(pacienteId, texto.trim()),
    onSuccess: (lista) => { qc.setQueryData(clave, lista); setTexto(''); toast.success('Nota guardada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const quitarMut = useMutation({
    mutationFn: (id: string) => historiaClinicaApi.eliminarNotaMedico(id),
    onSuccess: (lista) => { qc.setQueryData(clave, lista); toast.success('Nota quitada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!visible) return null;
  const puedeQuitar = (autorId: string | null) => autorId === usuario?.id || usuario?.rol === 'admin' || usuario?.rol === 'coordinadora_sedes';
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3" data-testid="notas-medico">
      <p className="text-xs text-indigo-900">Recomendaciones para los próximos médicos que atiendan a este paciente. Solo las ve el equipo médico, aquí en la historia.</p>
      {isLoading ? <p className="text-sm text-on-surface-variant">Cargando…</p> : notas.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Aún no hay notas.</p>
      ) : (
        <ul className="space-y-2">
          {notas.map((n) => (
            <li key={n.id} className="rounded-xl bg-white border border-indigo-100 px-3 py-2">
              <p className="text-sm text-on-surface whitespace-pre-wrap">{n.texto}</p>
              <p className="text-[11px] text-on-surface-variant mt-1 flex items-center gap-2">
                <span>{n.autorEtiqueta} · {fmtFechaHora(n.creadoEn)}</span>
                {puedeQuitar(n.autorUsuarioId) && (
                  <button onClick={() => { if (window.confirm('¿Quitar esta nota? Queda en la auditoría.')) quitarMut.mutate(n.id); }} className="text-rose-600 font-semibold hover:underline">Quitar</button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {puedeEscribir && (
        <div className="space-y-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={2000} data-testid="nota-medico-texto"
            placeholder="Ej. Paciente diabético: revisar sensibilidad antes de cualquier corte. Prefiere ser atendido en la mañana." className={INPUT} />
          <div className="flex justify-end">
            <button onClick={() => crearMut.mutate()} disabled={texto.trim().length < 3 || crearMut.isPending} data-testid="nota-medico-guardar"
              className="px-4 py-2 bg-indigo-700 text-white rounded-xl text-sm font-bold hover:bg-indigo-800 disabled:opacity-50">
              {crearMut.isPending ? 'Guardando…' : 'Agregar nota'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Consentimiento por foto ──────────────────────────────────────────────────
export function SubirConsentimientoFoto({ a, pendientes }: { a: AtencionCompleta; pendientes: { id: string; nombre: string }[] }) {
  const qc = useQueryClient();
  const invalidar = useInvalidarHistoriaClinica();
  const [abierto, setAbierto] = useState(false);
  const [plantillaId, setPlantillaId] = useState<string>('');
  const [procedimiento, setProcedimiento] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [camara, setCamara] = useState(false);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const cam = useCamaraEnVivo(camara);
  // Todas las plantillas de consentimiento (las mismas de «Nuevo consentimiento»), no solo las pendientes de la cita.
  const { data: ctx } = useQuery({
    queryKey: ['consentimiento-contexto', 'atencion', a.id],
    queryFn: () => consentimientosApi.contexto({ atencionId: a.id }),
    enabled: abierto,
    staleTime: 60_000,
  });
  const idsPendientes = new Set(pendientes.map((p) => p.id));
  const opciones = [
    ...pendientes.map((p) => ({ id: p.id, nombre: `${p.nombre} (pendiente)` })),
    ...(ctx?.plantillas ?? []).filter((p) => !idsPendientes.has(p.id)).map((p) => ({
      id: p.id, nombre: `${p.nombre}${p.firmado ? ` (ya firmado N° ${String(p.firmado.numero).padStart(5, '0')})` : ''}`,
    })),
  ];

  useEffect(() => { if (!archivo) { setVista(null); return; } const u = URL.createObjectURL(archivo); setVista(u); return () => URL.revokeObjectURL(u); }, [archivo]);
  useEffect(() => { if (!plantillaId && pendientes.length === 1) setPlantillaId(pendientes[0]!.id); }, [pendientes, plantillaId]);

  const reiniciar = () => { setAbierto(false); setArchivo(null); setProcedimiento(''); setPlantillaId(''); setCamara(false); };
  const subirMut = useMutation({
    mutationFn: () => historiaClinicaApi.subirConsentimientoFoto(a.id, archivo!, { plantillaId: plantillaId && plantillaId !== 'otro' ? plantillaId : null, procedimiento: plantillaId === 'otro' || !plantillaId ? procedimiento : undefined }),
    onSuccess: (r) => {
      toast.success(`Consentimiento N° ${String(r.numero).padStart(5, '0')} guardado con su foto`);
      for (const k of ['consentimientos-paciente', 'consentimientos-pendientes', 'citas', 'idea1-citas']) qc.invalidateQueries({ queryKey: [k] });
      invalidar({ pacienteId: a.pacienteId, atencionId: a.id, citaId: a.citaId });
      reiniciar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const capturar = async () => { const f = await cam.capturar(); if (f) { setArchivo(f); setCamara(false); } else toast.error('La cámara aún no está lista'); };
  const conProcedimiento = (plantillaId && plantillaId !== 'otro') || procedimiento.trim().length >= 3;

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} data-testid="consentimiento-foto"
        className="px-5 py-2.5 border border-primary/40 text-primary bg-primary/5 rounded-xl text-sm font-bold hover:bg-primary/10 flex items-center gap-2">
        <span className="material-symbols-outlined text-base">photo_camera</span>Foto del consentimiento en papel
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="consentimiento-foto-form">
      <p className="text-sm font-semibold text-on-surface">Consentimiento firmado en papel (foto)</p>
      <p className="text-xs text-on-surface-variant">Toma una foto clara del formato firmado por el paciente. Queda guardado como un consentimiento más y cuenta como firmado.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={LBL}>¿De qué procedimiento es?</label>
          <select value={plantillaId} onChange={(e) => setPlantillaId(e.target.value)} className={INPUT} data-testid="consentimiento-foto-plantilla">
            <option value="">Elige…</option>
            {opciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            <option value="otro">Otro (escribirlo)</option>
          </select>
        </div>
        {(plantillaId === 'otro' || !plantillaId) && (
          <div><label className={LBL}>Procedimiento</label><input value={procedimiento} onChange={(e) => setProcedimiento(e.target.value)} maxLength={200} placeholder="Ej. Matricectomía parcial del hallux derecho" className={INPUT} data-testid="consentimiento-foto-procedimiento" /></div>
        )}
      </div>

      {camara ? (
        <div className="space-y-2">
          {cam.error ? <p className="text-xs text-rose-700">{cam.error}</p> : (
            <video ref={cam.videoRef} playsInline muted onLoadedData={() => cam.setLista(true)} className="w-full max-h-[50vh] rounded-xl bg-black object-contain" />
          )}
          <div className="flex gap-2">
            {!cam.error && <button onClick={capturar} className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold">Capturar</button>}
            <button onClick={() => setCamara(false)} className="px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold">Cancelar cámara</button>
          </div>
        </div>
      ) : vista ? (
        <div className="space-y-2">
          <img src={vista} alt="Vista previa del consentimiento" className="max-h-[50vh] rounded-xl border border-outline-variant/40 object-contain" />
          <button onClick={() => setArchivo(null)} className="text-xs text-primary font-semibold hover:underline">Tomar otra</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCamara(true)} className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold flex items-center gap-1"><span className="material-symbols-outlined text-base">photo_camera</span>Abrir cámara</button>
          <button onClick={() => inputArchivo.current?.click()} className="px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold flex items-center gap-1"><span className="material-symbols-outlined text-base">upload_file</span>Elegir foto o escaneo</button>
          <input ref={inputArchivo} type="file" accept="image/*" capture="environment" className="hidden" data-testid="consentimiento-foto-archivo"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setArchivo(f); e.target.value = ''; }} />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={reiniciar} className="px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold">Cancelar</button>
        <button onClick={() => subirMut.mutate()} disabled={!archivo || !conProcedimiento || subirMut.isPending} data-testid="consentimiento-foto-guardar"
          className="px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">
          {subirMut.isPending ? 'Guardando…' : 'Guardar consentimiento'}
        </button>
      </div>
    </div>
  );
}

/** Abre la foto de un consentimiento por foto en otra pestaña. */
export async function verConsentimientoFoto(id: string) {
  try {
    const url = URL.createObjectURL(await historiaClinicaApi.blobConsentimientoFoto(id));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
