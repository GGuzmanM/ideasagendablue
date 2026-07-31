import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { serviciosApi, sedesApi, type Servicio } from '../api';

export interface FormServicio {
  nombre: string;
  codigo: string;
  duracionMinutos: string;
  color: string;
  precioReferencial: string;
  unidadNegocioId: string;
}

export function useServiciosAdminData() {
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [subcatDe, setSubcatDe] = useState<string | null>(null);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);

  const { data: servicios, isLoading } = useQuery({
    queryKey: ['servicios-admin'],
    queryFn: () => serviciosApi.listar(),
  });

  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });

  const unidades = [...new Map(
    (sedes ?? []).flatMap(s => s.unidadesNegocio).map(u => [u.id, u])
  ).values()];

  const crearMut = useMutation({
    mutationFn: (data: FormServicio) => serviciosApi.crear({
      nombre: data.nombre,
      ...(data.codigo.trim() ? { codigo: data.codigo.trim() } : {}),
      duracionMinutos: parseInt(data.duracionMinutos),
      color: data.color,
      unidadNegocioId: data.unidadNegocioId,
      ...(parseFloat(data.precioReferencial) > 0 ? { precioReferencial: parseFloat(data.precioReferencial) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servicios'] });
      qc.invalidateQueries({ queryKey: ['servicios-admin'] });
      qc.invalidateQueries({ queryKey: ['servicios-todos'] });
      setCreando(false);
      toast.success('Servicio creado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormServicio }) => serviciosApi.editar(id, {
      nombre: data.nombre,
      ...(data.codigo.trim() ? { codigo: data.codigo.trim() } : {}),
      duracionMinutos: parseInt(data.duracionMinutos),
      color: data.color,
      unidadNegocioId: data.unidadNegocioId,
      ...(parseFloat(data.precioReferencial) > 0 ? { precioReferencial: parseFloat(data.precioReferencial) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servicios'] });
      qc.invalidateQueries({ queryKey: ['servicios-admin'] });
      qc.invalidateQueries({ queryKey: ['servicios-todos'] });
      setEditandoId(null);
      toast.success('Servicio actualizado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActivoMut = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) => serviciosApi.editar(id, { activo }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['servicios'] });
      qc.invalidateQueries({ queryKey: ['servicios-admin'] });
      qc.invalidateQueries({ queryKey: ['servicios-todos'] });
      toast.success(vars.activo ? 'Servicio activado' : 'Servicio desactivado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const listaFiltrada = (servicios ?? []).filter(s => mostrarInactivos ? !s.activo : s.activo);

  const serviciosPorUnidad = listaFiltrada.reduce((acc, s) => {
    const nombre = s.unidadNegocio.nombre;
    if (!acc[nombre]) acc[nombre] = [];
    acc[nombre].push(s);
    return acc;
  }, {} as Record<string, Servicio[]>);

  return {
    servicios,
    isLoading,
    unidades,
    creando,
    setCreando,
    editandoId,
    setEditandoId,
    subcatDe,
    setSubcatDe,
    mostrarInactivos,
    setMostrarInactivos,
    crearMut,
    editarMut,
    toggleActivoMut,
    serviciosPorUnidad,
  };
}

export function useSubcategoriasData(servicioId: string) {
  const qc = useQueryClient();
  const KEY = ['subcategorias', servicioId];
  const invalidarTodo = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ['servicios'] });
    qc.invalidateQueries({ queryKey: ['servicios-admin'] });
    qc.invalidateQueries({ queryKey: ['servicios-todos'] });
    qc.invalidateQueries({ queryKey: ['servicios-all'] });
  };

  const { data: subs, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: () => serviciosApi.listarSubcategorias(servicioId),
  });

  const crearMut = useMutation({
    mutationFn: ({ nombre, precio }: { nombre: string; precio: string }) => serviciosApi.crearSubcategoria(servicioId, {
      nombre: nombre.trim(),
      ...(parseFloat(precio) > 0 ? { precioReferencial: parseFloat(precio) } : {}),
      orden: (subs?.length ?? 0) + 1,
    }),
    onSuccess: () => {
      invalidarTodo();
      toast.success('Subcategoría creada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { nombre?: string; precioReferencial?: number | null; activo?: boolean } }) =>
      serviciosApi.editarSubcategoria(id, data),
    onSuccess: () => {
      invalidarTodo();
      toast.success('Subcategoría actualizada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => serviciosApi.eliminarSubcategoria(id),
    onSuccess: () => {
      invalidarTodo();
      toast.success('Subcategoría eliminada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    subs,
    isLoading,
    crearMut,
    editarMut,
    eliminarMut,
  };
}
