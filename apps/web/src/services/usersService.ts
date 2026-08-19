import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { usersApi, rolesApi, type Usuario, type Rol, type CrearUsuarioPayload, type EditarUsuarioPayload } from '../api';

export interface FormUsuarioState {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  activo: boolean;
  sedeIds: string[]; // sedes de login
  recepcionistaId: string | null; // vínculo con ficha del roster (Movimientos)
}

export const USER_ROLE_PALETTE = [
  { bg: 'bg-blue-50 text-blue-700 border-blue-200', avatarBg: '#2563eb' },
  { bg: 'bg-purple-50 text-purple-700 border-purple-200', avatarBg: '#7c3aed' },
  { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', avatarBg: '#059669' },
  { bg: 'bg-amber-50 text-amber-700 border-amber-200', avatarBg: '#d97706' },
  { bg: 'bg-rose-50 text-rose-700 border-rose-200', avatarBg: '#e11d48' },
  { bg: 'bg-indigo-50 text-indigo-700 border-indigo-200', avatarBg: '#4f46e5' },
  { bg: 'bg-teal-50 text-teal-700 border-teal-200', avatarBg: '#0d9488' },
];

export function getRolBadgeStyle(rolNombre: string, roles: Rol[]): string {
  const idx = roles.findIndex(r => r.nombre === rolNombre);
  if (idx === -1) return USER_ROLE_PALETTE[0].bg;
  return USER_ROLE_PALETTE[idx % USER_ROLE_PALETTE.length].bg;
}

export function getRolAvatarBg(rolNombre: string, roles: Rol[]): string {
  const idx = roles.findIndex(r => r.nombre === rolNombre);
  if (idx === -1) return USER_ROLE_PALETTE[0].avatarBg;
  return USER_ROLE_PALETTE[idx % USER_ROLE_PALETTE.length].avatarBg;
}

export function useUsersData() {
  const qc = useQueryClient();

  // Search & Filter state
  const [q, setQ] = useState('');
  const [rolFiltro, setRolFiltro] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<'todos' | 'activos' | 'inactivos'>('todos');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | null>(null);

  // Queries
  const { data: usuarios = [], isLoading: cargandoUsuarios, refetch: recargarUsuarios } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.listar(),
  });

  const { data: roles = [], isLoading: cargandoRoles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => rolesApi.listar(),
  });

  // Mutations
  const crearMut = useMutation({
    mutationFn: (data: CrearUsuarioPayload) => usersApi.crear(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuario creado exitosamente');
      cerrarModal();
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Error al crear el usuario');
    },
  });

  const editarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EditarUsuarioPayload }) =>
      usersApi.actualizar(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuario actualizado exitosamente');
      cerrarModal();
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Error al actualizar el usuario');
    },
  });

  const toggleActivoMut = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      usersApi.actualizar(id, { activo }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(vars.activo ? 'Usuario activado' : 'Usuario desactivado');
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Error al cambiar estado del usuario');
    },
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => usersApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuario eliminado');
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Error al eliminar usuario');
    },
  });

  // Filtered List
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter(u => {
      // Búsqueda por texto (nombre / email)
      const termino = q.trim().toLowerCase();
      const coincideTexto = !termino ||
        u.nombre.toLowerCase().includes(termino) ||
        u.email.toLowerCase().includes(termino);

      // Filtro por rol
      const coincideRol = !rolFiltro || u.rol === rolFiltro;

      // Filtro por estado
      const coincideEstado =
        estadoFiltro === 'todos' ||
        (estadoFiltro === 'activos' && u.activo) ||
        (estadoFiltro === 'inactivos' && !u.activo);

      return coincideTexto && coincideRol && coincideEstado;
    });
  }, [usuarios, q, rolFiltro, estadoFiltro]);

  // Statistics
  const stats = useMemo(() => {
    const total = usuarios.length;
    const activos = usuarios.filter(u => u.activo).length;
    const inactivos = total - activos;
    const rolesUnicos = new Set(usuarios.map(u => u.rol)).size;

    return { total, activos, inactivos, rolesUnicos };
  }, [usuarios]);

  // Handlers for modal
  const abrirModalCrear = () => {
    setUsuarioEditando(null);
    setModalOpen(true);
  };

  const abrirModalEditar = (u: Usuario) => {
    setUsuarioEditando(u);
    setModalOpen(true);
  };

  const cerrarModal = () => {
    setUsuarioEditando(null);
    setModalOpen(false);
  };

  const resetFiltros = () => {
    setQ('');
    setRolFiltro('');
    setEstadoFiltro('todos');
  };

  const hayFiltrosActivos = q !== '' || rolFiltro !== '' || estadoFiltro !== 'todos';

  const obtenerLabelRol = (rolNombre: string) => {
    return roles.find(r => r.nombre === rolNombre)?.label ?? rolNombre;
  };

  return {
    usuarios: usuariosFiltrados,
    todosLosUsuarios: usuarios,
    roles,
    isLoading: cargandoUsuarios || cargandoRoles,
    stats,
    // Filters & Search
    q, setQ,
    rolFiltro, setRolFiltro,
    estadoFiltro, setEstadoFiltro,
    resetFiltros,
    hayFiltrosActivos,
    // Modal
    modalOpen,
    usuarioEditando,
    abrirModalCrear,
    abrirModalEditar,
    cerrarModal,
    // Mutations
    crearMut,
    editarMut,
    toggleActivoMut,
    eliminarMut,
    recargarUsuarios,
    // Utilities
    obtenerLabelRol,
  };
}
