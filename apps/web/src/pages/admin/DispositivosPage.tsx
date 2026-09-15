// Administración › Aparatos de consultorio (ESP32 con botones INICIO / FIN).
// Registrar un aparato por consultorio, ver si está en línea (late cada minuto), darle una clave
// nueva, revocarlo o darlo de baja. La clave se muestra UNA sola vez, junto al bloque de
// configuración para copiar en el programa del aparato (hardware/esp32-consultorio/config.h).
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { AdminHeaderNav } from './AdminHeaderNav';
import { sedesApi, type Sede } from '../../api';
import { dispositivosApi, horaLima, type Dispositivo, type DispositivoConClave, type DispositivoInput } from '../../api/tiemposTratamiento';
import { cn } from '../../utils/cn';

type Formulario = DispositivoInput & { id?: string };

export function DispositivosPage() {
  const qc = useQueryClient();
  const [sedeFiltro, setSedeFiltro] = useState('');
  const [form, setForm] = useState<Formulario | null>(null);
  const [clave, setClave] = useState<DispositivoConClave | null>(null);

  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data: lista = [], isLoading } = useQuery({
    queryKey: ['dispositivos', sedeFiltro],
    queryFn: () => dispositivosApi.listar(sedeFiltro || undefined),
    refetchInterval: 30_000, // el punto «en línea» se refresca solo
  });
  const invalidar = () => qc.invalidateQueries({ queryKey: ['dispositivos'] });
  const alFallar = (e: Error) => toast.error(e.message);

  const guardar = useMutation({
    mutationFn: async (f: Formulario): Promise<DispositivoConClave | null> => {
      const { id, ...datos } = f;
      if (id) { await dispositivosApi.editar(id, datos); return null; }
      return dispositivosApi.crear(datos);
    },
    onSuccess: (r) => {
      invalidar();
      setForm(null);
      if (r) setClave(r);
      toast.success(r ? 'Aparato registrado' : 'Aparato actualizado');
    },
    onError: alFallar,
  });
  const regenerar = useMutation({ mutationFn: dispositivosApi.regenerar, onSuccess: (r) => { invalidar(); setClave(r); }, onError: alFallar });
  const revocar = useMutation({ mutationFn: dispositivosApi.revocar, onSuccess: () => { invalidar(); toast.success('Clave revocada: el aparato ya no puede registrar tiempos'); }, onError: alFallar });
  const eliminar = useMutation({ mutationFn: dispositivosApi.eliminar, onSuccess: () => { invalidar(); toast.success('Aparato dado de baja'); }, onError: alFallar });

  const enLinea = lista.filter((d) => d.activo && d.enLinea).length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <AdminHeaderNav />
      <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Aparatos de consultorio</h3>
            <p className="text-xs text-slate-500 max-w-2xl">
              Cada consultorio tiene un aparato con dos botones: INICIO pone la cita «En atención» y FIN la pone «Completada»,
              con la hora exacta del botón. Así se mide cuánto dura de verdad cada tratamiento.
            </p>
          </div>
          <div className="ml-auto flex items-end gap-3">
            <span className="text-xs text-slate-500 pb-2"><b className="text-emerald-700">{enLinea}</b> de {lista.length} en línea</span>
            <label className="text-xs font-semibold text-slate-500">Sede
              <select className="input text-sm mt-1 block min-w-[150px]" value={sedeFiltro} onChange={(e) => setSedeFiltro(e.target.value)}>
                <option value="">Todas</option>
                {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
            <button
              onClick={() => setForm({ nombre: '', sedeId: sedeFiltro || sedes[0]?.id || '', unidadNegocioId: '', consultorioNumero: 1 })}
              className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold shadow-sm hover:opacity-90 flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-lg">add</span> Registrar aparato
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">Aparato</th>
                <th className="text-left px-4 py-2.5">Ubicación</th>
                <th className="text-left px-4 py-2.5">Estado</th>
                <th className="text-left px-4 py-2.5">Tratamiento</th>
                <th className="text-right px-4 py-2.5">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>}
              {!isLoading && lista.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Aún no hay aparatos registrados{sedeFiltro ? ' en esta sede' : ''}.</td></tr>
              )}
              {lista.map((d) => (
                <tr key={d.id} className={cn(!d.activo && 'bg-slate-50/70')}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{d.nombre}</p>
                    <p className="text-[11px] font-mono text-slate-400">lbd_{d.tokenPrefijo}…{d.firmware ? ` · fw ${d.firmware}` : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {d.sede.nombre} · {d.unidadNegocio.nombre} · <b>C{d.consultorioNumero}</b>
                  </td>
                  <td className="px-4 py-3"><EstadoAparato d={d} /></td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {d.tiempoEnCurso ? <span className="text-amber-700 font-semibold">En curso desde {horaLima(d.tiempoEnCurso.inicioEn)}</span> : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonIcono icon="edit" title="Editar nombre o ubicación"
                        onClick={() => setForm({ id: d.id, nombre: d.nombre, sedeId: d.sedeId, unidadNegocioId: d.unidadNegocioId, consultorioNumero: d.consultorioNumero })} />
                      <BotonIcono icon="key" title={d.activo ? 'Clave nueva (la anterior deja de servir)' : 'Reactivar con una clave nueva'}
                        onClick={() => { if (confirm(`¿Generar una clave nueva para «${d.nombre}»? La anterior deja de servir al instante y habrá que cargar la nueva en el aparato.`)) regenerar.mutate(d.id); }} />
                      {d.activo && (
                        <BotonIcono icon="block" title="Revocar la clave" tono="ambar"
                          onClick={() => { if (confirm(`¿Revocar la clave de «${d.nombre}»? El aparato ya no podrá registrar tiempos hasta darle una clave nueva.`)) revocar.mutate(d.id); }} />
                      )}
                      <BotonIcono icon="delete" title="Dar de baja" tono="rojo"
                        onClick={() => { if (confirm(`¿Dar de baja «${d.nombre}»? Se conserva su historial de tiempos.`)) eliminar.mutate(d.id); }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {form && <FormularioAparato form={form} sedes={sedes} guardando={guardar.isPending} onCambiar={setForm} onGuardar={(f) => guardar.mutate(f)} onCerrar={() => setForm(null)} />}
      {clave && <ClaveAparato clave={clave} onCerrar={() => setClave(null)} />}
    </div>
  );
}

function EstadoAparato({ d }: { d: Dispositivo }) {
  if (!d.activo) return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">Revocado</span>;
  const visto = d.ultimoContacto ? formatDistanceToNowStrict(new Date(d.ultimoContacto), { locale: es, addSuffix: true }) : 'nunca';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn('w-2.5 h-2.5 rounded-full', d.enLinea ? 'bg-emerald-500' : 'bg-slate-300')} />
      <span className={cn('font-semibold', d.enLinea ? 'text-emerald-700' : 'text-slate-500')}>{d.enLinea ? 'En línea' : 'Sin conexión'}</span>
      <span className="text-slate-400">· {visto}{d.rssi != null ? ` · WiFi ${d.rssi} dBm` : ''}</span>
    </span>
  );
}

function BotonIcono({ icon, title, onClick, tono }: { icon: string; title: string; onClick: () => void; tono?: 'ambar' | 'rojo' }) {
  return (
    <button onClick={onClick} title={title}
      className={cn('w-8 h-8 rounded-lg grid place-items-center transition-colors',
        tono === 'rojo' ? 'text-red-600 hover:bg-red-50' : tono === 'ambar' ? 'text-amber-600 hover:bg-amber-50' : 'text-slate-500 hover:bg-slate-100')}>
      <span className="material-symbols-outlined text-lg">{icon}</span>
    </button>
  );
}

function FormularioAparato({ form, sedes, guardando, onCambiar, onGuardar, onCerrar }: {
  form: Formulario; sedes: Sede[]; guardando: boolean;
  onCambiar: (f: Formulario) => void; onGuardar: (f: Formulario) => void; onCerrar: () => void;
}) {
  const sede = sedes.find((s) => s.id === form.sedeId);
  const unidades = sede?.unidadesNegocio ?? [];
  const n = sede?.consultorios ?? 0;
  // Unidad por defecto: Podología si la sede la tiene.
  const unidadId = form.unidadNegocioId || unidades.find((u) => /podolog/i.test(u.nombre))?.id || unidades[0]?.id || '';
  const nombreSugerido = useMemo(() => (sede ? `${sede.nombre} C${form.consultorioNumero}` : ''), [sede, form.consultorioNumero]);
  const valido = form.sedeId && unidadId && n > 0 && form.consultorioNumero >= 1 && form.consultorioNumero <= n;

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-start justify-center p-4 pt-[8vh]" onClick={onCerrar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900">{form.id ? 'Editar aparato' : 'Registrar aparato'}</h3>
        <label className="block text-xs font-semibold text-slate-500">Sede
          <select className="input text-sm mt-1 w-full" value={form.sedeId}
            onChange={(e) => onCambiar({ ...form, sedeId: e.target.value, unidadNegocioId: '', consultorioNumero: 1 })}>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-500">Unidad
          <select className="input text-sm mt-1 w-full" value={unidadId} onChange={(e) => onCambiar({ ...form, unidadNegocioId: e.target.value })}>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1.5">Consultorio</p>
          {n === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Esta sede no tiene consultorios configurados.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: n }, (_, i) => i + 1).map((c) => (
                <button key={c} onClick={() => onCambiar({ ...form, consultorioNumero: c })}
                  className={cn('w-11 h-9 rounded-lg text-xs font-bold border', form.consultorioNumero === c ? 'bg-primary text-white border-primary' : 'border-slate-200 text-slate-700 hover:border-primary')}>
                  C{c}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="block text-xs font-semibold text-slate-500">Nombre
          <input className="input text-sm mt-1 w-full" value={form.nombre} placeholder={nombreSugerido} maxLength={40}
            onChange={(e) => onCambiar({ ...form, nombre: e.target.value })} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCerrar} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button disabled={!valido || guardando}
            onClick={() => onGuardar({ ...form, unidadNegocioId: unidadId, nombre: form.nombre.trim() || nombreSugerido })}
            className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-40">
            {guardando ? 'Guardando…' : form.id ? 'Guardar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClaveAparato({ clave, onCerrar }: { clave: DispositivoConClave; onCerrar: () => void }) {
  const d = clave.dispositivo;
  const config = [
    `// config.h del aparato «${d.nombre}» (${d.sede.nombre} · ${d.unidadNegocio.nombre} · C${d.consultorioNumero})`,
    '#define WIFI_SSID          "<red WiFi de la sede>"',
    '#define WIFI_CLAVE         "<clave de la red WiFi>"',
    `#define API_BASE           "${window.location.origin}/api/v1"`,
    `#define CLAVE_APARATO      "${clave.token}"`,
    `#define NUMERO_CONSULTORIO ${d.consultorioNumero}`,
  ].join('\n');
  const copiar = (texto: string, que: string) => navigator.clipboard.writeText(texto).then(() => toast.success(`${que} copiada`), () => toast.error('No se pudo copiar'));
  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-start justify-center p-4 pt-[8vh]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-600">key</span>
          <h3 className="text-base font-bold text-slate-900">Clave del aparato «{d.nombre}»</h3>
        </div>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          Cópiala ahora: <b>no se vuelve a mostrar</b>. Si se pierde, genera una clave nueva.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-xs bg-slate-100 rounded-lg px-3 py-2 break-all">{clave.token}</code>
          <button onClick={() => copiar(clave.token, 'Clave')} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">Copiar</button>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-slate-500">Configuración para el programa del aparato</p>
            <button onClick={() => copiar(config, 'Configuración')} className="text-xs font-bold text-primary hover:underline">Copiar bloque</button>
          </div>
          <pre className="font-mono text-[11px] leading-relaxed bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">{config}</pre>
          <p className="text-[11px] text-slate-500 mt-1">
            API_BASE es la dirección con la que el aparato llega al servidor desde la red de la sede; sistemas la ajusta al instalar
            (ver hardware/esp32-consultorio/README.md).
          </p>
        </div>
        <div className="flex justify-end">
          <button onClick={onCerrar} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold">Ya la copié</button>
        </div>
      </div>
    </div>
  );
}
