import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ADMIN_TABS } from './admin/AdminHeaderNav';

export function AdminPage() {
  const usuario = useAuthStore(s => s.usuario);
  const perms = usuario?.permisos ?? [];

  const firstTab = perms.length > 0
    ? ADMIN_TABS.find(t => {
        if (!t.permiso) return true;
        return Array.isArray(t.permiso)
          ? t.permiso.some(p => perms.includes(p))
          : perms.includes(t.permiso);
      })
    : ADMIN_TABS[0];

  return <Navigate to={firstTab?.to ?? '/admin/competencias'} replace />;
}
