import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { rolesApi, type Rol, type GruposPermisos, type CrearRolPayload, type EditarRolPayload } from '../api';

export interface FormRolState {
  nombre: string;
  label: string;
  descripcion: string;
  permisos: string[];
}

export function useRolesData() {
  const qc = useQueryClient();

  // Search state
  const [q, setQ] = useState('');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [rolEditando, setRolEditando] = useState<Rol | null>(null);

  // Queries
  const { data: roles = [], isLoading: cargandoRoles, refetch: recargarRoles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => rolesApi.listar(),
  });

  const { data: gruposPermisos = {}, isLoading: cargandoPermisos } = useQuery({
    queryKey: ['roles-permisos'],
    queryFn: () => rolesApi.obtenerPermisos(),
  });

  // Mutations
  const crearMut = useMutation({
    mutationFn: (data: CrearRolPayload) => rolesApi.crear(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Rol creado exitosamente');
      cerrarModal();
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Error al crear el rol');
    },
  });

  const editarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EditarRolPayload }) =>
      rolesApi.actualizar(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Rol actualizado exitosamente');
      cerrarModal();
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Error al actualizar el rol');
    },
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => rolesApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Rol eliminado exitosamente');
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Error al eliminar el rol');
    },
  });

  // Derived list of all available permission keys
  const todosLosPermisos = useMemo(() => {
    return Object.values(gruposPermisos).flat();
  }, [gruposPermisos]);

  const totalPermisosCount = todosLosPermisos.length;

  // Filtered List
  const rolesFiltrados = useMemo(() => {
    const termino = q.trim().toLowerCase();
    if (!termino) return roles;
    return roles.filter(r =>
      r.label.toLowerCase().includes(termino) ||
      r.nombre.toLowerCase().includes(termino) ||
      (r.descripcion && r.descripcion.toLowerCase().includes(termino))
    );
  }, [roles, q]);

  // Statistics
  const stats = useMemo(() => {
    const total = roles.length;
    const delSistema = roles.filter(r => r.esSistema).length;
    const personalizados = total - delSistema;

    return { total, delSistema, personalizados, totalPermisosCount };
  }, [roles, totalPermisosCount]);

  // Modal Handlers
  const abrirModalCrear = () => {
    setRolEditando(null);
    setModalOpen(true);
  };

  const abrirModalEditar = (r: Rol) => {
    setRolEditando(r);
    setModalOpen(true);
  };

  const cerrarModal = () => {
    setRolEditando(null);
    setModalOpen(false);
  };

  return {
    roles: rolesFiltrados,
    todosLosRoles: roles,
    gruposPermisos,
    todosLosPermisos,
    totalPermisosCount,
    isLoading: cargandoRoles || cargandoPermisos,
    stats,
    // Search
    q, setQ,
    // Modal
    modalOpen,
    rolEditando,
    abrirModalCrear,
    abrirModalEditar,
    cerrarModal,
    // Mutations
    crearMut,
    editarMut,
    eliminarMut,
    recargarRoles,
  };
}
