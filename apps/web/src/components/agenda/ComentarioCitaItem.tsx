import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { citasApi, type ComentarioCita } from '../../api/citas';
import { useAuthStore } from '../../stores/authStore';
import { invalidarAgenda } from '../../services/idea1DetalleCitaService';
import { cn } from '../../utils/cn';

/**
 * Un comentario del hilo de la cita, con «Editar» (30-sep-2026): cada usuario corrige SOLO los suyos;
 * admin, cualquiera. El servidor valida lo mismo y guarda el texto anterior en la auditoría.
 * `variante` solo cambia el estilo (detalle de la cita vs. popover de la agenda).
 */
export function ComentarioCitaItem({
  citaId, c, fmt, variante,
}: {
  citaId: string;
  c: ComentarioCita;
  fmt: (iso: string) => string;
  variante: 'detalle' | 'popover';
}) {
  const qc = useQueryClient();
  const usuario = useAuthStore((s) => s.usuario);
  const puedeEditar = !!usuario && (usuario.permisos ?? []).includes('citas.estado')
    && (usuario.rol === 'admin' || (!!c.autor?.id && c.autor.id === usuario.id));
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(c.texto);

  const mut = useMutation({
    mutationFn: () => citasApi.editarComentario(citaId, c.id, texto.trim()),
    onSuccess: () => {
      invalidarAgenda(qc);
      qc.invalidateQueries({ queryKey: ['cita-detalle', citaId] });
      setEditando(false);
      toast.success('Comentario corregido');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const autor = c.autor?.nombre ?? c.autorEtiqueta ?? 'Sistema';
  const editado = c.editadoEn
    ? `editado${c.editadoPor && c.editadoPor.id !== c.autor?.id ? ` por ${c.editadoPor.nombre}` : ''} · ${fmt(c.editadoEn)}`
    : null;
  const detalle = variante === 'detalle';

  const botonEditar = puedeEditar && !editando && (
    <button
      type="button"
      onClick={() => { setTexto(c.texto); setEditando(true); }}
      data-testid="comentario-editar"
      title="Corregir comentario"
      className={cn('inline-flex items-center gap-0.5 font-sans font-bold cursor-pointer', detalle ? 'text-primary hover:underline' : 'text-limablue-600 hover:underline')}
    >
      <span className="material-symbols-outlined text-[13px]">edit</span>Editar
    </button>
  );

  const cuerpo = editando ? (
    <div className="space-y-2" data-testid="comentario-edicion">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        maxLength={2000}
        autoFocus
        className="w-full bg-white border border-outline-variant/40 rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => mut.mutate()}
          disabled={mut.isPending || !texto.trim() || texto.trim() === c.texto}
          data-testid="comentario-guardar"
          className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
        >
          {mut.isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" onClick={() => setEditando(false)}
          className="px-3 py-1.5 rounded-lg border border-outline-variant/40 text-xs font-bold text-on-surface-variant hover:bg-surface-container cursor-pointer">
          Cancelar
        </button>
      </div>
    </div>
  ) : detalle ? (
    <p className="text-xs text-on-surface font-medium whitespace-pre-wrap leading-relaxed">"{c.texto}"</p>
  ) : (
    <p className="text-slate-700 whitespace-pre-wrap break-words">{c.texto}</p>
  );

  if (detalle) {
    return (
      <div className="bg-surface-container-low rounded-xl p-3.5 border border-outline-variant/20 relative" data-testid="comentario">
        {cuerpo}
        <div className="flex items-center justify-between gap-2 text-[10px] text-on-surface-variant/60 font-mono font-medium pt-2.5 mt-2 border-t border-outline-variant/10">
          <span className="flex items-center gap-2">{autor}{botonEditar}</span>
          <span>{fmt(c.creadoEn)}</span>
        </div>
        {editado && <p className="text-[10px] text-on-surface-variant/60 italic mt-1" title="El texto anterior queda en la auditoría">({editado})</p>}
      </div>
    );
  }
  return (
    <li className="text-sm bg-slate-50 border border-slate-100 rounded-lg px-3 py-2" data-testid="comentario">
      {cuerpo}
      <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
        <span>{autor} · {fmt(c.creadoEn)}</span>
        {editado && <span className="italic" title="El texto anterior queda en la auditoría">({editado})</span>}
        {botonEditar}
      </p>
    </li>
  );
}
