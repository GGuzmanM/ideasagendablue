import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { profesionalesApi, sedesApi, type Profesional } from '../api';

export const AVATAR_COLORES = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#EF4444', '#06B6D4', '#84CC16', '#F97316', '#6B7280',
];

export const TIPO_LABELS: Record<string, string> = {
  podologa: 'Podóloga',
  medico: 'Médico',
  fisioterapeuta: 'Fisioterapeuta',
};

export interface FormProfesional {
  nombres: string;
  apellidos: string;
  tipo: string;
  unidadNegocioId: string;
  colorAvatar: string;
}

export function usePodologasData() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<'todos' | 'activos' | 'inactivos'>('activos');
  const [busqueda, setBusqueda] = useState('');
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const { data: profesionales, isLoading } = useQuery({
    queryKey: ['profesionales-admin'],
    queryFn: () => profesionalesApi.listar({}),
  });

  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });

  const unidades = [...new Map(
    (sedes ?? []).flatMap(s => s.unidadesNegocio).map(u => [u.id, u])
  ).values()];

  const crearMut = useMutation({
    mutationFn: (data: FormProfesional) => profesionalesApi.crear(data),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['profesionales'] });
      qc.invalidateQueries({ queryKey: ['profesionales-admin'] });
      qc.invalidateQueries({ queryKey: ['profesionales-todos'] });
      setCreando(false);
      toast.success(`${p.nombres} ${p.apellidos} agregada al sistema`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormProfesional & { activo: boolean }> }) =>
      profesionalesApi.editar(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profesionales'] });
      qc.invalidateQueries({ queryKey: ['profesionales-admin'] });
      qc.invalidateQueries({ queryKey: ['profesionales-todos'] });
      setEditandoId(null);
      toast.success('Profesional actualizada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActivo = (prof: Profesional) => {
    const msg = prof.activo
      ? `¿Desactivar a ${prof.nombres} ${prof.apellidos}? Dejará de aparecer en la agenda.`
      : `¿Reactivar a ${prof.nombres} ${prof.apellidos}?`;
    if (!confirm(msg)) return;
    editarMut.mutate({ id: prof.id, data: { activo: !prof.activo } });
    toast.success(prof.activo ? 'Profesional desactivada' : 'Profesional reactivada', { duration: 2000 });
  };

  const profsFiltrados = (profesionales ?? [])
    .filter(p => filtro === 'todos' ? true : filtro === 'activos' ? p.activo : !p.activo)
    .filter(p => busqueda === '' || `${p.nombres} ${p.apellidos}`.toLowerCase().includes(busqueda.toLowerCase()));

  return {
    profesionales,
    isLoading,
    sedes,
    unidades,
    filtro,
    setFiltro,
    busqueda,
    setBusqueda,
    creando,
    setCreando,
    editandoId,
    setEditandoId,
    profsFiltrados,
    crearMut,
    editarMut,
    toggleActivo,
  };
}
