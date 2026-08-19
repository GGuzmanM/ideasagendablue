import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { AdminHeaderNav } from './AdminHeaderNav';
import {
  useUsersData,
  getRolBadgeStyle,
  getRolAvatarBg,
  type FormUsuarioState,
} from '../../services/usersService';
import { cn } from '../../utils/cn';
import { sedesApi, type Usuario } from '../../api';
import { composicionSedeApi } from '../../api/composicionSede';

// ── Componente Tarjeta KPI ───────────────────────────────────────────────────
function KpiCard({
  icon,
  label,
  value,
  tint,
  iconColor,
}: {
  icon: string;
  label: string;
  value: number | string;
  tint: string;
  iconColor: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200/80 shadow-xs">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', tint)}>
        <span className={cn('material-symbols-outlined text-xl', iconColor)}>{icon}</span>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-lg font-bold text-slate-900 leading-none mt-0.5">{value}</p>
      </div>
    </div>
  );
}

// ── Modal Crear / Editar Usuario ──────────────────────────────────────────────
function FormularioUsuarioModal({
  editing,
  roles,
  sedes,
  recepcionistas,
  onSave,
  onCancel,
  isPending,
}: {
  editing: Usuario | null;
  roles: { nombre: string; label: string }[];
  sedes: { id: string; nombre: string }[];
  recepcionistas: { id: string; nombre: string }[];
  onSave: (form: FormUsuarioState) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<FormUsuarioState>({
    nombre: editing?.nombre ?? '',
    email: editing?.email ?? '',
    password: '',
    rol: editing?.rol ?? (roles[0]?.nombre || ''),
    activo: editing?.activo ?? true,
    sedeIds: editing?.sedes.map(s => s.id) ?? [],
    recepcionistaId: editing?.recepcionistaId ?? null,
  });

  const toggleSede = (id: string) =>
    setForm(f => ({ ...f, sedeIds: f.sedeIds.includes(id) ? f.sedeIds.filter(x => x !== id) : [...f.sedeIds, id] }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">{editing ? 'edit' : 'person_add'}</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {editing ? 'Editar usuario' : 'Nuevo usuario'}
              </h3>
              <p className="text-xs text-slate-500">
                {editing ? 'Modifica los datos del usuario' : 'Completa la información para dar de alta un usuario'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre completo *</label>
            <input
              type="text"
              required
              value={form.nombre}
              onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder="Ej: María García"
              className="input w-full text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Correo electrónico *</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="ejemplo@limablue.pe"
              className="input w-full text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Contraseña {editing && <span className="text-slate-400 font-normal">(dejar vacío para mantener)</span>} {!editing && '*'}
            </label>
            <input
              type="password"
              required={!editing}
              minLength={6}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder={editing ? '••••••••' : 'Mínimo 6 caracteres'}
              className="input w-full text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Rol en el sistema *</label>
            <select
              required
              value={form.rol}
              onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}
              className="input w-full text-sm"
            >
              <option value="" disabled>Selecciona un rol…</option>
              {roles.map(r => (
                <option key={r.nombre} value={r.nombre}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Vínculo con la ficha del roster (Movimientos) */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Vincular a ficha de recepción (Movimientos)
              <span className="text-slate-400 font-normal"> — opcional</span>
            </label>
            <select
              value={form.recepcionistaId ?? ''}
              onChange={e => setForm(f => ({ ...f, recepcionistaId: e.target.value || null }))}
              className="input w-full text-sm"
            >
              <option value="">Sin vincular (acceso por sedes manuales)</option>
              {recepcionistas.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1 leading-snug">
              Si la vinculas, su acceso a la agenda se toma solo de la sede donde esté en Movimientos
              (al moverla de sede, su acceso cambia al instante).
            </p>
          </div>

          {form.recepcionistaId ? (
            <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs text-primary flex items-start gap-2">
              <span className="material-symbols-outlined text-base shrink-0">link</span>
              <span>Sus sedes de acceso vienen de <b>Movimientos</b> (ficha vinculada). No hace falta elegirlas aquí.</span>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Sedes de acceso
                <span className="text-slate-400 font-normal"> — a qué sedes puede entrar (agenda)</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {sedes.map(s => {
                  const marcada = form.sedeIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSede(s.id)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-left',
                        marcada
                          ? 'bg-primary/10 border-primary/40 text-primary'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      <span className="material-symbols-outlined text-base">{marcada ? 'check_box' : 'check_box_outline_blank'}</span>
                      {s.nombre}
                    </button>
                  );
                })}
              </div>
              {form.sedeIds.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">warning</span>
                  Sin sedes no podrá ver ninguna agenda. (admin/coordinación ven todas igual.)
                </p>
              )}
            </div>
          )}

          <div className="pt-2">
            <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100/70 transition-colors">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))}
                className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300"
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">Usuario activo</p>
                <p className="text-xs text-slate-500">Permite el acceso e inicio de sesión a la plataforma</p>
              </div>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary btn-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn btn-primary btn-sm flex items-center gap-1.5"
            >
              {isPending && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {editing ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Página Principal de Usuarios ──────────────────────────────────────────────
export function UsersPage() {
  const { usuario: currentUser } = useAuthStore();
  const {
    usuarios,
    todosLosUsuarios,
    roles,
    isLoading,
    stats,
    q, setQ,
    rolFiltro, setRolFiltro,
    estadoFiltro, setEstadoFiltro,
    resetFiltros,
    hayFiltrosActivos,
    modalOpen,
    usuarioEditando,
    abrirModalCrear,
    abrirModalEditar,
    cerrarModal,
    crearMut,
    editarMut,
    toggleActivoMut,
    eliminarMut,
    obtenerLabelRol,
  } = useUsersData();

  const [usuarioAEliminar, setUsuarioAEliminar] = useState<Usuario | null>(null);
  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data: recepcionistas = [] } = useQuery({ queryKey: ['recepcionistas-todas'], queryFn: composicionSedeApi.recepcionistas });

  const handleSaveUser = (formData: FormUsuarioState) => {
    if (usuarioEditando) {
      const payload: { nombre: string; email: string; rol: string; activo: boolean; password?: string; sedeIds: string[]; recepcionistaId: string | null } = {
        nombre: formData.nombre,
        email: formData.email,
        rol: formData.rol,
        activo: formData.activo,
        sedeIds: formData.sedeIds,
        recepcionistaId: formData.recepcionistaId,
      };
      if (formData.password) payload.password = formData.password;
      editarMut.mutate({ id: usuarioEditando.id, data: payload });
    } else {
      crearMut.mutate(formData);
    }
  };

  const isSaving = crearMut.isPending || editarMut.isPending;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">

        {/* Dynamic Header with KPIs */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Gestión de Usuarios</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Administra las cuentas de acceso, roles asignados y estados de los usuarios del sistema.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <KpiCard icon="group" label="Total" value={stats.total} tint="bg-primary/10" iconColor="text-primary" />
            <KpiCard icon="check_circle" label="Activos" value={stats.activos} tint="bg-emerald-100" iconColor="text-emerald-700" />
            <KpiCard icon="block" label="Inactivos" value={stats.inactivos} tint="bg-rose-100" iconColor="text-rose-700" />
            <KpiCard icon="badge" label="Roles activos" value={stats.rolesUnicos} tint="bg-amber-100" iconColor="text-amber-700" />
          </div>
        </div>

        {/* Controls & Action Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-[280px]">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
                  search
                </span>
                <input
                  type="text"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Buscar por nombre o correo electrónico…"
                  className="input pl-9 pr-8 text-sm w-full"
                />
                {q && (
                  <button
                    onClick={() => setQ('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Role Filter */}
              <select
                value={rolFiltro}
                onChange={e => setRolFiltro(e.target.value)}
                className="input text-sm w-auto min-w-[150px]"
              >
                <option value="">Todos los roles</option>
                {roles.map(r => (
                  <option key={r.nombre} value={r.nombre}>{r.label}</option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={estadoFiltro}
                onChange={e => setEstadoFiltro(e.target.value as 'todos' | 'activos' | 'inactivos')}
                className="input text-sm w-auto min-w-[130px]"
              >
                <option value="todos">Todos los estados</option>
                <option value="activos">Solo activos</option>
                <option value="inactivos">Solo inactivos</option>
              </select>

              {/* Reset Filters button */}
              {hayFiltrosActivos && (
                <button
                  onClick={resetFiltros}
                  className="btn btn-ghost btn-sm text-slate-500 hover:text-slate-800"
                  title="Limpiar filtros"
                >
                  <span className="material-symbols-outlined text-base">filter_alt_off</span>
                  Limpiar
                </button>
              )}
            </div>

            {/* Create New User Button */}
            <button
              onClick={abrirModalCrear}
              className="btn btn-primary btn-sm flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-lg">person_add</span>
              Nuevo usuario
            </button>
          </div>
        </div>

        {/* Users Table List */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <div className="w-8 h-8 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-xs text-slate-500 font-medium">Cargando usuarios del sistema…</p>
            </div>
          ) : usuarios.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                <span className="material-symbols-outlined text-2xl">person_off</span>
              </div>
              <h3 className="text-base font-semibold text-slate-800">No se encontraron usuarios</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                {hayFiltrosActivos
                  ? 'Prueba ajustando o limpiando los filtros de búsqueda.'
                  : 'Aún no hay usuarios registrados en la plataforma.'}
              </p>
              {hayFiltrosActivos && (
                <button onClick={resetFiltros} className="btn btn-secondary btn-sm mt-4">
                  Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3.5 px-4 pl-6">Usuario</th>
                    <th className="py-3.5 px-4">Correo electrónico</th>
                    <th className="py-3.5 px-4">Rol</th>
                    <th className="py-3.5 px-4">Estado</th>
                    <th className="py-3.5 px-4 pr-6 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {usuarios.map(u => {
                    const esYo = u.id === currentUser?.id;
                    const initials = u.nombre
                      .split(' ')
                      .filter(Boolean)
                      .map(n => n[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase();

                    const avatarColor = getRolAvatarBg(u.rol, roles);
                    const badgeStyle = getRolBadgeStyle(u.rol, roles);
                    const nombreRol = obtenerLabelRol(u.rol);

                    return (
                      <tr
                        key={u.id}
                        className={cn(
                          'hover:bg-slate-50/70 transition-colors',
                          esYo && 'bg-blue-50/30 hover:bg-blue-50/50'
                        )}
                      >
                        {/* Usuario / Avatar */}
                        <td className="py-3.5 px-4 pl-6">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-xs"
                              style={{ backgroundColor: avatarColor }}
                            >
                              {initials}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-900">{u.nombre}</span>
                                {esYo && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                                    Tú
                                  </span>
                                )}
                              </div>
                              {/* Sedes de acceso (login) o vínculo con el roster */}
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                {u.recepcionista ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                    <span className="material-symbols-outlined text-[11px]">link</span>
                                    Sedes vía Movimientos ({u.recepcionista.nombre})
                                  </span>
                                ) : u.sedes.length > 0 ? (
                                  u.sedes.map(s => (
                                    <span key={s.id} className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                      <span className="material-symbols-outlined text-[11px]">location_on</span>
                                      {s.nombre}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[10px] font-medium text-amber-600">Sin sedes</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Correo */}
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-xs">
                          {u.email}
                        </td>

                        {/* Rol */}
                        <td className="py-3.5 px-4">
                          <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border', badgeStyle)}>
                            {nombreRol}
                          </span>
                        </td>

                        {/* Estado */}
                        <td className="py-3.5 px-4">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
                              u.activo
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            )}
                          >
                            <span className={cn('w-1.5 h-1.5 rounded-full', u.activo ? 'bg-emerald-500' : 'bg-rose-500')} />
                            {u.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>

                        {/* Acciones */}
                        <td className="py-3.5 px-4 pr-6 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => abrirModalEditar(u)}
                              className="p-1.5 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors"
                              title="Editar usuario"
                            >
                              <span className="material-symbols-outlined text-lg">edit</span>
                            </button>

                            {!esYo && (
                              <button
                                onClick={() => toggleActivoMut.mutate({ id: u.id, activo: !u.activo })}
                                className={cn(
                                  'p-1.5 rounded-lg transition-colors',
                                  u.activo
                                    ? 'text-slate-500 hover:text-amber-600 hover:bg-amber-50'
                                    : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50'
                                )}
                                title={u.activo ? 'Desactivar usuario' : 'Activar usuario'}
                              >
                                <span className="material-symbols-outlined text-lg">
                                  {u.activo ? 'do_not_disturb_on' : 'check_circle'}
                                </span>
                              </button>
                            )}

                            {!esYo && (
                              <button
                                onClick={() => setUsuarioAEliminar(u)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Eliminar usuario"
                              >
                                <span className="material-symbols-outlined text-lg">delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer count */}
          <div className="px-6 py-3 bg-slate-50/60 border-t border-slate-200/80 text-xs text-slate-500 flex items-center justify-between">
            <span>
              Mostrando <strong>{usuarios.length}</strong> de <strong>{todosLosUsuarios.length}</strong> usuarios
            </span>
          </div>
        </div>
      </div>

      {/* Modal Formulario Crear / Editar */}
      {modalOpen && (
        <FormularioUsuarioModal
          editing={usuarioEditando}
          roles={roles}
          sedes={sedes.map(s => ({ id: s.id, nombre: s.nombre }))}
          recepcionistas={recepcionistas.map(r => ({ id: r.id, nombre: r.nombre }))}
          onSave={handleSaveUser}
          onCancel={cerrarModal}
          isPending={isSaving}
        />
      )}

      {/* Modal de confirmación de eliminación */}
      {usuarioAEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-2xl">warning</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">¿Eliminar usuario?</h3>
              <p className="text-xs text-slate-500 mt-1">
                ¿Estás seguro de que deseas eliminar a <strong>{usuarioAEliminar.nombre}</strong>? El usuario perderá el acceso inmediatamente.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setUsuarioAEliminar(null)}
                className="btn btn-secondary btn-sm flex-1"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  eliminarMut.mutate(usuarioAEliminar.id);
                  setUsuarioAEliminar(null);
                }}
                className="btn btn-danger btn-sm flex-1"
              >
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
