import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { useAuthStore } from '../../stores/authStore';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  permiso?: string | string[];
}

export const idea1NavItems: NavItem[] = [
  { to: '/idea1', label: 'Agenda', icon: 'calendar_today', permiso: 'agenda.ver' },
  { to: '/pacientes', label: 'Pacientes', icon: 'groups', permiso: 'pacientes.ver' },
  { to: '/herramientas', label: 'Herramientas', icon: 'home_repair_service', permiso: ['herramientas.operativas', 'herramientas.estrategicas'] },
  { to: '/movimientos', label: 'Movimientos', icon: 'sync_alt', permiso: 'movimientos.ver' },
  { to: '/admin', label: 'Administración', icon: 'admin_panel_settings', permiso: 'admin.ver' },
  { to: '/admin/usuarios', label: 'Usuarios', icon: 'manage_accounts', permiso: 'usuarios.ver' },
  { to: '/admin/roles', label: 'Roles', icon: 'shield', permiso: 'roles.editar' },
  { to: '/admin/notificaciones', label: 'Notificaciones', icon: 'notifications', permiso: 'notificaciones.ver' },
  { to: '/analytics', label: 'Analytics', icon: 'analytics', permiso: 'analytics.ver' },
];

export function Idea1Sidebar() {
  const location = useLocation();
  const { usuario, logout } = useAuthStore();

  const perms = usuario?.permisos ?? [];

  // Si hay permisos en el usuario, filtramos por ellos; si no hay objeto usuario cargado aún, mostramos los items
  const items = perms.length > 0
    ? idea1NavItems.filter(n => {
        if (!n.permiso) return true;
        return Array.isArray(n.permiso)
          ? n.permiso.some(p => perms.includes(p))
          : perms.includes(n.permiso);
      })
    : idea1NavItems;

  return (
    <aside className="h-full sticky top-0 left-0 w-sidebar-expanded bg-[#0e4f9f] border-r border-outline-variant/20 flex flex-col py-6 px-4 z-50 shrink-0 select-none">
      {/* Header / Logo */}
      <div className="mb-6 px-3">
        <Link to="/idea1" className="flex items-center gap-3 group">
          <div className="w-12 h-12 flex items-center justify-center group-hover:scale-105 transition-transform" title="Limablue Agenda">
            <img src="/logo-login.png" alt="Limablue" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="font-headline-md text-headline-md font-bold text-white leading-none tracking-tight">
              Agenda
            </h1>
            <p className="font-label-caps text-label-caps text-secondary-fixed-dim mt-1 text-[11px] font-medium tracking-wide">
              Gestión Médica
            </p>
          </div>
        </Link>
      </div>

      {/* Navigation items */}
      <nav className="idea1-sidebar-nav flex-1 space-y-1 overflow-y-auto custom-scrollbar pr-1">
        {items.map((item) => {
          const isActive = item.to === '/idea1' || item.to === '/'
            ? (location.pathname === '/idea1' || location.pathname === '/')
            : (location.pathname === item.to || (item.to !== '/admin' && location.pathname.startsWith(item.to)));

          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3.5 py-2.5 px-3.5 rounded-xl transition-all duration-200 group text-sm font-medium",
                isActive
                  ? "bg-white/15 text-white font-bold border-l-4 border-white pl-3 shadow-sm"
                  : "text-blue-100/75 hover:bg-white/10 hover:text-white"
              )}
            >
              <span
                className={cn(
                  "material-symbols-outlined text-xl transition-transform duration-200 group-hover:scale-110",
                  isActive ? "text-white" : "text-blue-200/80 group-hover:text-white"
                )}
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer / Shortcuts & User profile */}
      <div className="mt-auto pt-4 border-t border-white/10 space-y-3 shrink-0">
        <button
          type="button"
          title="Atajos de teclado (?)"
          onClick={() => {
            const ev = new KeyboardEvent('keydown', { key: '?', bubbles: true });
            document.dispatchEvent(ev);
          }}
          className="w-full flex items-center gap-3 py-2 px-3 text-[13px] text-blue-100/70 hover:text-white hover:bg-white/10 rounded-xl transition-all duration-200"
        >
          <span className="material-symbols-outlined text-lg">help</span>
          <span className="font-medium">Atajos (?)</span>
        </button>

        <div className="p-3 bg-white/10 rounded-2xl flex items-center justify-between gap-2 border border-white/15 shadow-sm">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-9 h-9 rounded-xl border border-white/20 bg-white/15 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-inner">
              {usuario?.nombre ? usuario.nombre.split(' ').map(n => n[0]).slice(0, 2).join('') : 'AD'}
            </div>
            <div className="overflow-hidden min-w-0">
              <p className="text-white font-semibold text-xs truncate leading-snug">
                {usuario?.nombre ?? 'Administrador'}
              </p>
              <p className="text-blue-200/70 text-[10px] truncate capitalize leading-tight mt-0.5">
                {usuario?.rol ?? 'admin'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            title="Cerrar sesión"
            className="p-1.5 rounded-lg text-blue-100/70 hover:text-red-300 hover:bg-red-500/20 transition-all shrink-0"
          >
            <span className="material-symbols-outlined text-lg">logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
