// Catálogo CIE-10 de la clínica (D3) — LÓGICA. Buscar, agregar códigos y activar / desactivar.
// Lo gestionan administración, coordinación y médicos (el backend también lo exige). Nada se borra:
// un código que ya se usó en diagnósticos solo se desactiva (deja de salir en la búsqueda).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { catalogosApi, useDebounce, type Cie10Admin } from '../api/catalogos';

/** Formato CIE-10: letra + 2 dígitos, y opcionalmente punto + subcategoría (L84, B35.1, M20.10). */
export const RE_CIE10 = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

export function useCatalogoCie10() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const qd = useDebounce(q.trim());
  const lista = useQuery({ queryKey: ['catalogo-cie10-admin', qd, verInactivos], queryFn: () => catalogosApi.cie10Admin(qd, verInactivos), staleTime: 30_000 });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['catalogo-cie10-admin'] });
    void qc.invalidateQueries({ queryKey: ['catalogo-cie10'] }); // la búsqueda de diagnósticos
  };

  // Alta de un código
  const [codigo, setCodigo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState('');
  const codigoNorm = codigo.trim().toUpperCase();
  const codigoValido = RE_CIE10.test(codigoNorm);
  const puedeCrear = codigoValido && descripcion.trim().length >= 3;
  const crearMut = useMutation({
    mutationFn: () => catalogosApi.crearCie10({ codigo: codigoNorm, descripcion: descripcion.trim(), categoria: categoria.trim() || null }),
    onSuccess: (c) => { refrescar(); setCodigo(''); setDescripcion(''); toast.success(`${c.codigo} agregado al catálogo`); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Edición en línea (descripción y categoría) y activar / desactivar
  const [editando, setEditando] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editCat, setEditCat] = useState('');
  const empezarEdicion = (c: Cie10Admin) => { setEditando(c.codigo); setEditDesc(c.descripcion); setEditCat(c.categoria ?? ''); };
  const editarMut = useMutation({
    mutationFn: (v: { codigo: string; cambios: { descripcion?: string; categoria?: string | null; activo?: boolean } }) => catalogosApi.editarCie10(v.codigo, v.cambios),
    onSuccess: (c, v) => {
      refrescar(); setEditando(null);
      toast.success(v.cambios.activo === false ? `${c.codigo} desactivado: ya no sale al buscar` : v.cambios.activo === true ? `${c.codigo} activado` : `${c.codigo} actualizado`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const guardarEdicion = () => {
    if (!editando || editDesc.trim().length < 3) return;
    editarMut.mutate({ codigo: editando, cambios: { descripcion: editDesc.trim(), categoria: editCat.trim() || null } });
  };
  const alternarActivo = (c: Cie10Admin) => editarMut.mutate({ codigo: c.codigo, cambios: { activo: !c.activo } });

  return {
    q, setQ, verInactivos, setVerInactivos, items: lista.data?.items ?? [], categorias: lista.data?.categorias ?? [], cargando: lista.isLoading,
    codigo, setCodigo, descripcion, setDescripcion, categoria, setCategoria, codigoNorm, codigoValido, puedeCrear, crearMut,
    editando, setEditando, editDesc, setEditDesc, editCat, setEditCat, empezarEdicion, guardarEdicion, alternarActivo, editarMut,
  };
}
