import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serviciosApi, sedesApi } from '../../api';
import { useCanales } from '../../hooks/useCanales';
import { promocionesApi, type Promocion, type TipoPromocion } from '../../api/promociones';

const TIPOS: { value: TipoPromocion; label: string }[] = [
  { value: 'PORCENTAJE', label: '% de descuento' },
  { value: 'MONTO_DESCUENTO', label: 'Monto fijo de descuento (S/)' },
  { value: 'PRECIO_FIJO', label: 'Precio final fijo (S/)' },
  { value: 'OTRO', label: 'Otro (sin valor)' },
];
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
const nn = (arr: any[]): any[] | null => (arr.length ? arr : null); // vacío = sin restricción (null)

interface Props {
  promo: Promocion | null; // null = crear
  onClose: () => void;
  onSaved: () => void;
}

/** Editor de promoción con TODAS las restricciones (Fase 2). Vacío = sin restricción (aplica a todo). */
export function PromocionEditorModal({ promo, onClose, onSaved }: Props) {
  const editando = !!promo;
  const [nombre, setNombre] = useState(promo?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoPromocion>(promo?.tipo ?? 'PORCENTAJE');
  const [valor, setValor] = useState(promo?.valor == null ? '' : String(promo.valor));
  const [serviciosIds, setServiciosIds] = useState<string[]>(promo?.serviciosIds ?? []);
  const [sedesIds, setSedesIds] = useState<string[]>(promo?.sedesIds ?? []);
  const [canales, setCanales] = useState<string[]>(promo?.canales ?? []);
  const [vigenciaInicio, setVigenciaInicio] = useState(promo?.vigenciaInicio?.slice(0, 10) ?? '');
  const [vigenciaFin, setVigenciaFin] = useState(promo?.vigenciaFin?.slice(0, 10) ?? '');
  const [diasSemana, setDiasSemana] = useState<number[]>(promo?.diasSemana ?? []);
  const [codigo, setCodigo] = useState(promo?.codigo ?? '');
  const [soloNuevos, setSoloNuevos] = useState(!!promo?.soloPacientesNuevos);
  const [cupoTotal, setCupoTotal] = useState(promo?.cupoTotal == null ? '' : String(promo.cupoTotal));
  const [limitePac, setLimitePac] = useState(promo?.limitePorPaciente == null ? '' : String(promo.limitePorPaciente));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: servicios = [] } = useQuery({ queryKey: ['servicios-todos'], queryFn: () => serviciosApi.listar({ activo: true }) });
  const { data: sedes = [] } = useQuery({ queryKey: ['sedes-todas'], queryFn: () => sedesApi.listar() });
  const { canales: canalesOpt } = useCanales();

  const serviciosOrden = useMemo(
    () => [...(servicios as any[])].sort((a, b) => `${a.unidadNegocio?.nombre ?? ''}${a.nombre}`.localeCompare(`${b.unidadNegocio?.nombre ?? ''}${b.nombre}`)),
    [servicios],
  );

  const requiereValor = tipo !== 'OTRO';

  const guardar = async () => {
    setError(null);
    if (nombre.trim().length < 2) { setError('El nombre es muy corto'); return; }
    if (requiereValor && valor.trim() === '') { setError('Indica el valor de la promoción'); return; }
    if (vigenciaInicio && vigenciaFin && vigenciaFin < vigenciaInicio) { setError('La fecha fin no puede ser anterior a la de inicio'); return; }
    const payload = {
      nombre: nombre.trim(),
      tipo,
      valor: requiereValor ? Number(valor) : null,
      serviciosIds: nn(serviciosIds),
      sedesIds: nn(sedesIds),
      canales: nn(canales),
      vigenciaInicio: vigenciaInicio || null,
      vigenciaFin: vigenciaFin || null,
      diasSemana: nn(diasSemana),
      codigo: codigo.trim() || null,
      soloPacientesNuevos: soloNuevos,
      cupoTotal: cupoTotal.trim() === '' ? null : Number(cupoTotal),
      limitePorPaciente: limitePac.trim() === '' ? null : Number(limitePac),
    };
    setGuardando(true);
    try {
      if (editando) await promocionesApi.actualizar(promo!.id, payload);
      else await promocionesApi.crear(payload);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar');
      setGuardando(false);
    }
  };

  const chip = (activo: boolean) =>
    'text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ' +
    (activo ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-slate-600 border-slate-300 hover:border-pink-400');

  return (
    <div className="fixed inset-0 bg-black/40 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl flex flex-col overflow-hidden shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold text-slate-900">{editando ? 'Editar promoción' : 'Nueva promoción'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Nombre + tipo + valor */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Datos</label>
            <input className="input text-sm w-full" placeholder="Nombre de la promoción" value={nombre} maxLength={160} onChange={e => setNombre(e.target.value)} />
            <div className="flex gap-2">
              <select className="input text-sm flex-1" value={tipo} onChange={e => setTipo(e.target.value as TipoPromocion)}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input className="input text-sm w-32" type="number" min="0" step="0.01"
                placeholder={tipo === 'PORCENTAJE' ? '%' : 'S/'} value={valor} disabled={!requiereValor}
                onChange={e => setValor(e.target.value)} />
            </div>
          </div>

          {/* Servicios */}
          <Bloque titulo="Servicios" hint="Vacío = aplica a todos los servicios">
            <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1.5 p-1">
              {serviciosOrden.map((s: any) => (
                <button key={s.id} type="button" className={chip(serviciosIds.includes(s.id))} onClick={() => setServiciosIds(v => toggle(v, s.id))}>
                  {s.nombre}
                </button>
              ))}
            </div>
          </Bloque>

          {/* Sedes */}
          <Bloque titulo="Sedes" hint="Vacío = todas las sedes">
            <div className="flex flex-wrap gap-1.5">
              {(sedes as any[]).map((s: any) => (
                <button key={s.id} type="button" className={chip(sedesIds.includes(s.id))} onClick={() => setSedesIds(v => toggle(v, s.id))}>
                  {s.nombre}
                </button>
              ))}
            </div>
          </Bloque>

          {/* Canales */}
          <Bloque titulo="Canales de reserva" hint="Vacío = todos los canales">
            <div className="flex flex-wrap gap-1.5">
              {canalesOpt.map((c: any) => (
                <button key={c.value} type="button" className={chip(canales.includes(c.value))} onClick={() => setCanales(v => toggle(v, c.value))}>
                  {c.label}
                </button>
              ))}
            </div>
          </Bloque>

          {/* Días de la semana */}
          <Bloque titulo="Días de la semana" hint="Vacío = todos los días">
            <div className="flex flex-wrap gap-1.5">
              {DIAS.map((d, i) => (
                <button key={i} type="button" className={chip(diasSemana.includes(i))} onClick={() => setDiasSemana(v => toggle(v, i))}>
                  {d}
                </button>
              ))}
            </div>
          </Bloque>

          {/* Vigencia */}
          <Bloque titulo="Vigencia" hint="Según la fecha de la cita. Vacío = sin límite">
            <div className="flex gap-2 items-center">
              <input type="date" className="input text-sm" value={vigenciaInicio} onChange={e => setVigenciaInicio(e.target.value)} />
              <span className="text-slate-400 text-sm">→</span>
              <input type="date" className="input text-sm" value={vigenciaFin} onChange={e => setVigenciaFin(e.target.value)} />
            </div>
          </Bloque>

          {/* Código + cupos */}
          <Bloque titulo="Cupón / límites" hint="Vacío = sin código ni límite">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">Código / convenio
                <input className="input text-sm w-full mt-1" placeholder="Ej. BBVA (opcional)" value={codigo} onChange={e => setCodigo(e.target.value)} />
              </label>
              <label className="text-xs text-slate-500">Cupo total
                <input type="number" min="1" className="input text-sm w-full mt-1" placeholder="Ilimitado" value={cupoTotal} onChange={e => setCupoTotal(e.target.value)} />
              </label>
              <label className="text-xs text-slate-500">Máx por paciente
                <input type="number" min="1" className="input text-sm w-full mt-1" placeholder="Ilimitado" value={limitePac} onChange={e => setLimitePac(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600 mt-5">
                <input type="checkbox" checked={soloNuevos} onChange={e => setSoloNuevos(e.target.checked)} />
                Solo pacientes nuevos
              </label>
            </div>
          </Bloque>

          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 border border-slate-300 hover:bg-slate-50">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-pink-600 hover:bg-pink-700 disabled:opacity-50">
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear promoción'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Bloque({ titulo, hint, children }: { titulo: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">{titulo}</label>
        <span className="text-[11px] text-slate-400">{hint}</span>
      </div>
      {children}
    </div>
  );
}
