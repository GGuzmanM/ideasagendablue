// Administración › Consultorios: cuántos consultorios numerados (C1..CN) tiene cada sede. Ese número es el que ofrece
// el selector «Consultorio» del detalle de la cita y el que usan los aparatos INICIO/FIN. Se agregan o quitan por sede;
// no se puede quitar uno que tenga citas de hoy en adelante o un aparato activo.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AdminHeaderNav } from './AdminHeaderNav';
import { sedesApi, type SedeConsultorios } from '../../api';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../utils/cn';

const MAX_CONSULTORIOS = 30;

function TarjetaSede({ sede, puedeEditar, onCambiar, guardando }: {
  sede: SedeConsultorios; puedeEditar: boolean; onCambiar: (n: number) => void; guardando: boolean;
}) {
  const [editandoNumero, setEditandoNumero] = useState(false);
  const [valor, setValor] = useState(String(sede.consultorios));
  const quitarBloqueado = sede.consultorios <= sede.enUsoHasta;
  const confirmarNumero = () => {
    const n = Number(valor);
    setEditandoNumero(false);
    if (!Number.isInteger(n) || n < 0 || n > MAX_CONSULTORIOS) { toast.error(`Indica un número entre 0 y ${MAX_CONSULTORIOS}`); setValor(String(sede.consultorios)); return; }
    if (n !== sede.consultorios) onCambiar(n);
  };

  return (
    <div className={cn('bg-white rounded-2xl border border-slate-200 shadow-sm p-5', !sede.activa && 'opacity-60')} data-testid={`sede-consultorios-${sede.nombre}`}>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-2 h-7 rounded-full shrink-0" style={{ backgroundColor: sede.color }} />
        <h4 className="font-bold text-slate-900 text-base flex-1 truncate">{sede.nombre}{!sede.activa && <span className="ml-2 text-xs font-medium text-slate-400">(inactiva)</span>}</h4>
        {editandoNumero && puedeEditar ? (
          <input
            type="number" min={0} max={MAX_CONSULTORIOS} autoFocus value={valor}
            onChange={(e) => setValor(e.target.value)} onBlur={confirmarNumero}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmarNumero(); if (e.key === 'Escape') { setValor(String(sede.consultorios)); setEditandoNumero(false); } }}
            className="input w-20 text-sm text-center font-bold" data-testid="input-numero"
          />
        ) : (
          <button
            type="button" disabled={!puedeEditar} onClick={() => { setValor(String(sede.consultorios)); setEditandoNumero(true); }}
            title={puedeEditar ? 'Escribir la cantidad directamente' : undefined}
            className="text-sm font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-3 py-1 hover:bg-slate-200 disabled:hover:bg-slate-100 transition-colors"
            data-testid="total-consultorios"
          >
            {sede.consultorios} {sede.consultorios === 1 ? 'consultorio' : 'consultorios'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {Array.from({ length: sede.consultorios }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={cn(
              'w-11 h-9 grid place-items-center rounded-lg border text-xs font-bold',
              n <= sede.enUsoHasta ? 'bg-primary-fixed/40 border-primary/40 text-primary' : 'bg-white border-slate-200 text-slate-700',
            )}
            title={n <= sede.enUsoHasta ? 'En uso (citas futuras o aparato)' : 'Libre'}
          >
            C{n}
          </span>
        ))}
        {sede.consultorios === 0 && <span className="text-xs text-slate-400 italic py-2">Esta sede no numera consultorios: el detalle de la cita no muestra el selector.</span>}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11px] text-slate-500">
          {sede.enUsoHasta > 0
            ? <>En uso hasta el <strong>C{sede.enUsoHasta}</strong> · {sede.citasFuturasConConsultorio} cita(s) futuras con consultorio · {sede.aparatosActivos} aparato(s)</>
            : 'Ningún consultorio con citas futuras ni aparatos.'}
        </p>
        {puedeEditar && (
          <div className="flex gap-2">
            <button
              type="button" disabled={guardando || sede.consultorios === 0 || quitarBloqueado}
              onClick={() => onCambiar(sede.consultorios - 1)}
              title={quitarBloqueado && sede.consultorios > 0 ? `El C${sede.consultorios} tiene citas futuras o un aparato: reasígnalas antes de quitarlo` : `Quitar el C${sede.consultorios}`}
              className="btn btn-secondary btn-sm disabled:opacity-50" data-testid="quitar-consultorio"
            >
              <span className="material-symbols-outlined text-[16px]">remove</span> Quitar C{sede.consultorios || ''}
            </button>
            <button
              type="button" disabled={guardando || sede.consultorios >= MAX_CONSULTORIOS}
              onClick={() => onCambiar(sede.consultorios + 1)}
              className="btn btn-primary btn-sm disabled:opacity-50" data-testid="agregar-consultorio"
            >
              <span className="material-symbols-outlined text-[16px]">add</span> Agregar C{sede.consultorios + 1}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ConsultoriosPage() {
  const qc = useQueryClient();
  const { usuario } = useAuthStore();
  const puedeEditar = (usuario?.permisos ?? []).includes('horarios.editar');
  const { data: sedes = [], isLoading } = useQuery({ queryKey: ['sedes-consultorios'], queryFn: sedesApi.consultorios });

  const cambiar = useMutation({
    mutationFn: ({ id, n }: { id: string; n: number }) => sedesApi.setConsultorios(id, n),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sedes-consultorios'] });
      qc.invalidateQueries({ queryKey: ['sedes'] }); // el selector del detalle de la cita lee Sede.consultorios
      qc.invalidateQueries({ queryKey: ['citas'] });
      toast.success(`${r.nombre}: ${r.consultorios} ${r.consultorios === 1 ? 'consultorio' : 'consultorios'}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const total = sedes.reduce((a, s) => a + s.consultorios, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <AdminHeaderNav />
      <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Consultorios por sede</h3>
            <p className="text-xs text-slate-500 max-w-2xl">
              Cuántos consultorios numerados tiene cada sede. Son los que ofrece el botón «Consultorio» (C1, C2…) al abrir
              una cita y los que usan los aparatos INICIO/FIN. Para quitar uno, no debe tener citas de hoy en adelante ni un
              aparato activo.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1">
            {total} consultorios en {sedes.length} sedes
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 max-w-5xl">
            {sedes.map((s) => (
              <TarjetaSede key={s.id} sede={s} puedeEditar={puedeEditar} guardando={cambiar.isPending} onCambiar={(n) => cambiar.mutate({ id: s.id, n })} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
