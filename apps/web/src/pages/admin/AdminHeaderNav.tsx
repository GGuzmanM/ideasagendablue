import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { useAuthStore } from '../../stores/authStore';

export interface AdminTabItem {
  to: string;
  label: string;
  icon: string;
  permiso?: string | string[];
}

export const ADMIN_TABS: AdminTabItem[] = [
  { to: '/admin/competencias', label: 'Competencias', icon: 'verified', permiso: 'admin.ver' },
  { to: '/admin/paquetes', label: 'Paquetes', icon: 'package', permiso: 'admin.ver' },
  { to: '/admin/podologas', label: 'Podólogas', icon: 'person', permiso: 'admin.ver' },
  { to: '/admin/servicios', label: 'Servicios', icon: 'medical_services', permiso: 'admin.ver' },
  { to: '/admin/auditoria', label: 'Auditoría', icon: 'receipt_long', permiso: 'admin.ver' },
  { to: '/admin/usuarios', label: 'Usuarios', icon: 'group', permiso: 'usuarios.ver' },
  { to: '/admin/roles', label: 'Roles', icon: 'key', permiso: 'roles.editar' },
  { to: '/admin/notificaciones', label: 'Notificaciones', icon: 'notifications_active', permiso: 'notificaciones.ver' },
];

export function AdminHeaderNav() {
  const location = useLocation();
  const { usuario } = useAuthStore();
  const perms = usuario?.permisos ?? [];

  const visibleTabs = perms.length > 0
    ? ADMIN_TABS.filter(t => {
        if (!t.permiso) return true;
        return Array.isArray(t.permiso)
          ? t.permiso.some(p => perms.includes(p))
          : perms.includes(t.permiso);
      })
    : ADMIN_TABS;

  return (
    <header className="bg-surface-container-lowest border-b border-outline-variant px-8 pt-6 pb-0 shrink-0">
      <h2 className="font-headline-lg text-2xl font-bold text-on-surface mb-6 tracking-tight">Administración</h2>
      <div className="flex flex-wrap gap-2 border-b border-outline-variant pb-px overflow-x-auto custom-scrollbar">
        {visibleTabs.map(t => {
          const isActive = location.pathname === t.to;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                'flex items-center gap-2 px-4 py-2 font-label-md text-sm transition-colors rounded-t-lg shrink-0 select-none',
                isActive
                  ? 'text-primary bg-primary-fixed/40 border-b-2 border-primary font-bold'
                  : 'text-on-surface-variant hover:text-primary hover:bg-slate-100/60'
              )}
            >
              <span
                className="material-symbols-outlined text-[18px]"
                style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
              >
                {t.icon}
              </span>
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </header>
  );
}
