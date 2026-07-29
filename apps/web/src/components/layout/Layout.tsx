import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificacionesStore } from '../../stores/notificacionesStore';
import { Sidebar } from './Sidebar';
import { Idea1Sidebar } from './Idea1Sidebar';
import { CommandPalette } from '../agenda/CommandPalette';
import { NotificacionLoginBanner } from '../NotificacionLoginBanner';

export function Layout() {
  const token = useAuthStore(s => s.token);
  const navigate = useNavigate();
  const location = useLocation();
  const { pendientes, limpiar } = useNotificacionesStore();

  // Solo la agenda antigua (/ y /agenda-vieja) conserva el sidebar viejo (angosto).
  // El resto de las páginas usa el nuevo Idea1Sidebar (diseño idea1).
  const esAgendaVieja = location.pathname === '/' || location.pathname === '/agenda-vieja';

  useEffect(() => {
    if (!token) navigate('/login', { replace: true });
  }, [token, navigate]);

  if (!token) return null;

  return (
    <div className="flex h-screen bg-slate-50" style={{ flexDirection: 'column' }}>
      {/* Banner de notificaciones post-login */}
      {pendientes.length > 0 && (
        <NotificacionLoginBanner
          notificaciones={pendientes}
          onCerrar={limpiar}
        />
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        {esAgendaVieja ? <Sidebar /> : <Idea1Sidebar />}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
