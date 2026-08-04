import { useState } from 'react';
import { AdminHeaderNav } from './AdminHeaderNav';
import {
  useRolesData,
  type FormRolState,
} from '../../services/rolesService';
import { cn } from '../../utils/cn';
import { type Rol, type GruposPermisos } from '../../api';

// ── Apariencia por rol (franja + ícono) ──────────────────────────────────────
// Roles del sistema con identidad fija; personalizados toman un color determinista.
const ROL_APARIENCIA: Record<string, { stripe: string; iconBg: string; iconColor: string; icon: string }> = {
  admin:              { stripe: 'bg-primary',     iconBg: 'bg-primary/10',  iconColor: 'text-primary',    icon: 'local_police' },
  coordinadora_sedes: { stripe: 'bg-emerald-500', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-700', icon: 'supervisor_account' },
  recepcionista:      { stripe: 'bg-sky-500',     iconBg: 'bg-sky-100',     iconColor: 'text-sky-700',     icon: 'support_agent' },
};

const PALETA_CUSTOM = [
  { stripe: 'bg-violet-500', iconBg: 'bg-violet-100', iconColor: 'text-violet-700', icon: 'headset_mic' },
  { stripe: 'bg-rose-500',   iconBg: 'bg-rose-100',   iconColor: 'text-rose-700',   icon: 'badge' },
  { stripe: 'bg-orange-500', iconBg: 'bg-orange-100', iconColor: 'text-orange-700', icon: 'workspace_premium' },
  { stripe: 'bg-teal-500',   iconBg: 'bg-teal-100',   iconColor: 'text-teal-700',   icon: 'diversity_3' },
];

function aparienciaDeRol(nombre: string) {
  if (ROL_APARIENCIA[nombre]) return ROL_APARIENCIA[nombre];
  const hash = [...nombre].reduce((h, c) => h + c.charCodeAt(0), 0);
  return PALETA_CUSTOM[hash % PALETA_CUSTOM.length];
}

// ── Íconos + etiqueta corta por grupo de permisos ────────────────────────────
const GRUPO_META: Record<string, { icon: string; corto: string }> = {
  'Agenda':           { icon: 'calendar_today',       corto: 'Agenda' },
  'Pacientes':        { icon: 'groups',               corto: 'Pacientes' },
  'Herramientas':     { icon: 'home_repair_service',  corto: 'Herram.' },
  'Movimientos':      { icon: 'sync_alt',             corto: 'Movim.' },
  'Administración':   { icon: 'admin_panel_settings', corto: 'Admin' },
  'Usuarios y Roles': { icon: 'manage_accounts',      corto: 'Usuarios' },
};

function metaDeGrupo(grupo: string) {
  return GRUPO_META[grupo] ?? { icon: 'category', corto: grupo.slice(0, 8) };
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, tint, iconColor }: {
  icon: string; label: string; value: number | string; tint: string; iconColor: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200/80 shadow-sm">
      <div className={cn('w-9 h-9 rounded-lg grid place-items-center shrink-0', tint)}>
        <span className={cn('material-symbols-outlined text-xl', iconColor)}>{icon}</span>
      </div>
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-lg font-bold text-slate-900 leading-none mt-0.5">{value}</p>
      </div>
    </div>
  );
}

// ── Toggle switch (Tailwind puro, sin CSS extra) ─────────────────────────────
function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <span className="relative inline-flex items-center shrink-0">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only peer" />
      <span
        className={cn(
          'w-9 h-5 rounded-full transition-colors cursor-pointer',
          "after:content-[''] after:absolute after:left-0.5 after:top-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:shadow after:transition-transform",
          checked ? 'bg-primary after:translate-x-4' : 'bg-slate-300',
        )}
        onClick={onChange}
      />
    </span>
  );
}

// ── Matriz de módulos de una card ────────────────────────────────────────────
function MatrizModulos({ rol, gruposPermisos }: { rol: Rol; gruposPermisos: GruposPermisos }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Object.entries(gruposPermisos).map(([grupo, items]) => {
        const meta = metaDeGrupo(grupo);
        const activos = items.filter(i => rol.permisos.includes(i.id)).length;
        const estado = activos === 0 ? 'none' : activos === items.length ? 'full' : 'partial';
        const detalle = items
          .map(i => `${rol.permisos.includes(i.id) ? '✓' : '✕'} ${i.label}`)
          .join('\n');
        return (
          <div
            key={grupo}
            title={`${grupo} (${activos}/${items.length})\n${detalle}`}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-colors',
              estado === 'full' && 'bg-primary/10 border-primary/25',
              estado === 'partial' && 'bg-amber-50 border-amber-300/60',
              estado === 'none' && 'bg-surface-container-low border-outline-variant/40 opacity-60',
            )}
          >
            <span
              className={cn(
                'material-symbols-outlined text-base shrink-0',
                estado === 'full' && 'text-primary',
                estado === 'partial' && 'text-amber-700',
                estado === 'none' && 'text-on-surface-variant',
              )}
            >
              {meta.icon}
            </span>
            <span
              className={cn(
                'text-[10px] font-bold truncate',
                estado === 'full' && 'text-primary',
                estado === 'partial' && 'text-amber-800',
                estado === 'none' && 'text-on-surface-variant',
              )}
            >
              {meta.corto}{estado === 'partial' ? ' ½' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Modal Crear / Editar Rol ──────────────────────────────────────────────────
function FormularioRolModal({ editing, gruposPermisos, totalPermisosCount, onSave, onCancel, isPending }: {
  editing: Rol | null;
  gruposPermisos: GruposPermisos;
  totalPermisosCount: number;
  onSave: (form: FormRolState) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<FormRolState>({
    nombre: editing?.nombre ?? '',
    label: editing?.label ?? '',
    descripcion: editing?.descripcion ?? '',
    permisos: editing?.permisos ?? [],
  });

  const togglePermiso = (id: string) => {
    setForm(f => ({
      ...f,
      permisos: f.permisos.includes(id)
        ? f.permisos.filter(p => p !== id)
        : [...f.permisos, id],
    }));
  };

  const toggleGrupo = (grupoItems: { id: string }[]) => {
    const idsGrupo = grupoItems.map(item => item.id);
    const todosSeleccionados = idsGrupo.every(id => form.permisos.includes(id));
    if (todosSeleccionados) {
      setForm(f => ({ ...f, permisos: f.permisos.filter(id => !idsGrupo.includes(id)) }));
    } else {
      setForm(f => ({ ...f, permisos: Array.from(new Set([...f.permisos, ...idsGrupo])) }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  const pct = totalPermisosCount > 0 ? Math.round((form.permisos.length / totalPermisosCount) * 100) : 0;

  return (
    <div
      className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onCancel}
    >
      <div
        className="bg-surface-container-lowest w-full max-w-2xl max-h-[88vh] rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header azul */}
        <div className="bg-[#0044ab] text-white p-5 flex items-start justify-between gap-4 shrink-0 shadow-md">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined">{editing ? 'edit' : 'shield'}</span>
              <h2 className="text-lg font-bold tracking-tight truncate">
                {editing ? `Editar rol · ${editing.label}` : 'Nuevo rol'}
              </h2>
            </div>
            <p className="text-sm text-white/85 mt-1">Define las capacidades y permisos asociados a este rol</p>
          </div>
          <button type="button" onClick={onCancel} className="p-2 hover:bg-white/20 rounded-xl transition-colors shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">

            {/* Datos básicos */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Nombre visible *
                </label>
                <input
                  type="text"
                  required
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="ej: Recepcionista de Sede"
                  className="input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Clave interna {editing ? '' : '*'}
                </label>
                {editing ? (
                  <input className="input w-full text-sm font-mono bg-surface-container-low" value={editing.nombre} disabled />
                ) : (
                  <input
                    type="text"
                    required
                    value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                    placeholder="ej: recep_sede"
                    className="input w-full text-sm font-mono"
                  />
                )}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Descripción <span className="text-on-surface-variant/60 font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="text"
                value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="ej: Atención en recepción, agendamiento presencial y cobros"
                className="input w-full text-sm"
              />
            </div>

            {/* Contador de permisos */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">tune</span>
                <span className="text-sm font-bold text-on-surface">
                  {form.permisos.length} de {totalPermisosCount} permisos activos
                </span>
              </div>
              <div className="w-32 h-2 bg-surface-container rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>

            {/* Grupos de permisos con switches */}
            <div className="space-y-3">
              {Object.entries(gruposPermisos).map(([grupo, items]) => {
                const meta = metaDeGrupo(grupo);
                const activos = items.filter(i => form.permisos.includes(i.id)).length;
                const todos = activos === items.length && items.length > 0;
                const chipCls = todos
                  ? 'text-primary bg-primary/10'
                  : activos > 0
                  ? 'text-amber-800 bg-amber-100'
                  : 'text-on-surface-variant bg-surface-container';

                return (
                  <div key={grupo} className="border border-outline-variant/40 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-surface-container-low border-b border-outline-variant/30">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-lg">{meta.icon}</span>
                        <span className="text-sm font-bold text-on-surface">{grupo}</span>
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', chipCls)}>
                          {activos}/{items.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleGrupo(items)}
                        className={cn(
                          'text-[11px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider transition',
                          todos
                            ? 'text-red-700 bg-red-50 border-red-200/70 hover:bg-red-100'
                            : 'text-primary bg-primary/10 border-primary/30 hover:bg-primary/20',
                        )}
                      >
                        {todos ? 'Quitar todos' : 'Marcar todos'}
                      </button>
                    </div>
                    <div className="divide-y divide-outline-variant/20">
                      {items.map(item => {
                        const checked = form.permisos.includes(item.id);
                        return (
                          <div
                            key={item.id}
                            onClick={() => togglePermiso(item.id)}
                            className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-container-low/60 cursor-pointer transition select-none"
                          >
                            <div className="pr-4 min-w-0">
                              <p className="text-[13px] font-semibold text-on-surface leading-tight">{item.label}</p>
                              <p className="text-[11px] text-on-surface-variant font-mono mt-0.5">{item.id}</p>
                            </div>
                            <Switch checked={checked} onChange={() => togglePermiso(item.id)} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-outline-variant/30 flex items-center justify-end gap-2 shrink-0 bg-surface-container-low">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-outline-variant/60 text-on-surface font-bold text-sm hover:bg-surface-container transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              {isPending ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <span className="material-symbols-outlined text-lg">save</span>
              )}
              {editing ? 'Guardar cambios' : 'Crear rol'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Card de rol ───────────────────────────────────────────────────────────────
function RolCard({ rol, gruposPermisos, totalPermisosCount, onEditar, onEliminar }: {
  rol: Rol;
  gruposPermisos: GruposPermisos;
  totalPermisosCount: number;
  onEditar: () => void;
  onEliminar: () => void;
}) {
  const ap = aparienciaDeRol(rol.nombre);
  const tieneTodos = rol.permisos.length === totalPermisosCount && totalPermisosCount > 0;
  const pct = totalPermisosCount > 0 ? Math.round((rol.permisos.length / totalPermisosCount) * 100) : 0;
  const usuarios = rol.usuariosCount ?? 0;

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl shadow-sm overflow-hidden flex flex-col hover:shadow-md hover:border-outline-variant transition-all">
      <div className={cn('h-1.5', ap.stripe)} />
      <div className="p-5 flex-1 flex flex-col gap-4">
        {/* Título + acciones */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn('w-11 h-11 rounded-xl grid place-items-center shrink-0', ap.iconBg)}>
              <span
                className={cn('material-symbols-outlined text-2xl', ap.iconColor)}
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {ap.icon}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-on-surface">{rol.label}</h3>
                {rol.esSistema ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider">
                    <span className="material-symbols-outlined text-xs">verified</span> Sistema
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider">
                    <span className="material-symbols-outlined text-xs">extension</span> Personalizado
                  </span>
                )}
              </div>
              <code className="text-[11px] font-mono text-on-surface-variant">{rol.nombre}</code>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onEditar}
              className="w-8 h-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-primary/10 hover:text-primary transition"
              title="Editar rol"
            >
              <span className="material-symbols-outlined text-lg">edit</span>
            </button>
            {!rol.esSistema && (
              <button
                onClick={onEliminar}
                className="w-8 h-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-red-50 hover:text-red-600 transition"
                title="Eliminar rol"
              >
                <span className="material-symbols-outlined text-lg">delete</span>
              </button>
            )}
          </div>
        </div>

        {rol.descripcion && <p className="text-xs text-on-surface-variant">{rol.descripcion}</p>}

        {/* Cobertura */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Permisos</span>
            {tieneTodos ? (
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                Acceso total · {rol.permisos.length}/{totalPermisosCount}
              </span>
            ) : (
              <span className="text-[11px] font-bold text-on-surface-variant">
                {rol.permisos.length}/{totalPermisosCount}
              </span>
            )}
          </div>
          <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', tieneTodos ? 'bg-emerald-500' : 'bg-primary')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Matriz de módulos */}
        <MatrizModulos rol={rol} gruposPermisos={gruposPermisos} />
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-outline-variant/30 bg-surface-container-low/50 flex items-center justify-between">
        {rol.esSistema ? (
          <span className="text-[11px] text-on-surface-variant flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">lock</span> Protegido por el sistema
          </span>
        ) : (
          <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">edit_note</span> Rol personalizado
          </span>
        )}
        <span className="text-[11px] font-semibold text-on-surface-variant flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">group</span>
          {usuarios === 1 ? '1 usuario' : `${usuarios} usuarios`}
        </span>
      </div>
    </div>
  );
}

// ── Página Principal de Roles ────────────────────────────────────────────────
export function RolesPage() {
  const {
    roles,
    gruposPermisos,
    totalPermisosCount,
    isLoading,
    stats,
    q, setQ,
    modalOpen,
    rolEditando,
    abrirModalCrear,
    abrirModalEditar,
    cerrarModal,
    crearMut,
    editarMut,
    eliminarMut,
  } = useRolesData();

  const [rolAEliminar, setRolAEliminar] = useState<Rol | null>(null);

  const handleSaveRole = (formData: FormRolState) => {
    if (rolEditando) {
      editarMut.mutate({
        id: rolEditando.id,
        data: {
          label: formData.label,
          descripcion: formData.descripcion,
          permisos: formData.permisos,
        },
      });
    } else {
      crearMut.mutate(formData);
    }
  };

  const isSaving = crearMut.isPending || editarMut.isPending;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">

        {/* Header + KPIs */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Gestión de Roles y Permisos</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Configura los perfiles de acceso por módulo. Cada rol define qué puede ver y hacer un usuario.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <KpiCard icon="key" label="Total roles" value={stats.total} tint="bg-primary/10" iconColor="text-primary" />
            <KpiCard icon="verified_user" label="Del sistema" value={stats.delSistema} tint="bg-amber-100" iconColor="text-amber-700" />
            <KpiCard icon="extension" label="Personalizados" value={stats.personalizados} tint="bg-emerald-100" iconColor="text-emerald-700" />
          </div>
        </div>

        {/* Barra de control */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar por nombre, clave o descripción…"
              className="input pl-10 pr-8 text-sm w-full"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 w-5 h-5 grid place-items-center"
                aria-label="Limpiar búsqueda"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
          </div>
          <button
            onClick={abrirModalCrear}
            className="bg-primary text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">add_moderator</span>
            Nuevo rol
          </button>
        </div>

        {/* Grid de roles */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-xs text-slate-500 font-medium">Cargando roles del sistema…</p>
          </div>
        ) : roles.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-container-low grid place-items-center mx-auto mb-3">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant">vpn_key_off</span>
            </div>
            <p className="text-base font-bold text-on-surface">No se encontraron roles</p>
            <p className="text-sm text-on-surface-variant mt-1">Prueba modificando el término de búsqueda.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {roles.map(r => (
                <RolCard
                  key={r.id}
                  rol={r}
                  gruposPermisos={gruposPermisos}
                  totalPermisosCount={totalPermisosCount}
                  onEditar={() => abrirModalEditar(r)}
                  onEliminar={() => setRolAEliminar(r)}
                />
              ))}
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">info</span>
              Azul = acceso completo al módulo · Ámbar ½ = acceso parcial · Gris = sin acceso. Pasa el mouse sobre cada módulo para ver el detalle.
            </p>
          </>
        )}
      </div>

      {/* Modal crear / editar */}
      {modalOpen && (
        <FormularioRolModal
          editing={rolEditando}
          gruposPermisos={gruposPermisos}
          totalPermisosCount={totalPermisosCount}
          onSave={handleSaveRole}
          onCancel={cerrarModal}
          isPending={isSaving}
        />
      )}

      {/* Modal eliminar */}
      {rolAEliminar && (
        <div
          className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setRolAEliminar(null)}
        >
          <div
            className="bg-surface-container-lowest w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4 text-center animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 grid place-items-center mx-auto">
              <span className="material-symbols-outlined text-3xl">warning</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-on-surface">¿Eliminar rol?</h3>
              <p className="text-xs text-on-surface-variant mt-1.5">
                ¿Seguro que deseas eliminar <strong>"{rolAEliminar.label}"</strong>?
                {(rolAEliminar.usuariosCount ?? 0) > 0 && (
                  <>
                    {' '}Hay <strong>{rolAEliminar.usuariosCount} usuario(s)</strong> con este rol — deberás reasignarlos
                    primero.
                  </>
                )}{' '}
                Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setRolAEliminar(null)}
                className="flex-1 px-4 py-2 rounded-xl border border-outline-variant/60 text-on-surface font-bold text-sm hover:bg-surface-container transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  eliminarMut.mutate(rolAEliminar.id);
                  setRolAEliminar(null);
                }}
                className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white font-bold text-sm shadow-md shadow-red-600/20 hover:opacity-90 transition"
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
