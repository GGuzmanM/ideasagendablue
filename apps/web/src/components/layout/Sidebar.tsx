import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { useAuthStore } from '../../stores/authStore';
import { useContadorControles } from '../../services/controlesService';

// El menú se guía por PERMISOS del rol (configurables en Administración → Roles).
const navItems = [
  { to: '/', label: 'Agenda', icon: '📅', permiso: 'citas.ver' },
  { to: '/pacientes', label: 'Pacientes', icon: '👤', permiso: 'pacientes.ver' },
  { to: '/historia-clinica/bandeja', label: 'Bandeja clínica', icon: '🩺', permiso: 'hc.ver' },
  { to: '/horarios', label: 'Horarios y Restricciones', icon: '⏰', permiso: 'horarios.ver' },
  { to: '/herramientas', label: 'Herramientas', icon: '🛠️', permiso: ['exportar.usar', 'comunicaciones.gestionar', 'promociones.ver', 'promociones.gestionar', 'canales.gestionar', 'membresias.gestionar', 'config.editar'] },
  { to: '/movimientos', label: 'Movimientos', icon: '⇄', permiso: 'movimientos.ver' },
  { to: '/admin', label: 'Administración', icon: '⚙️', permiso: ['profesionales.ver', 'servicios.ver', 'competencias.editar', 'auditoria.ver', 'membresias.gestionar', 'usuarios.ver', 'roles.editar', 'notificaciones.ver'] },
  { to: '/analytics', label: 'Analytics', icon: '📊', permiso: 'analytics.ver' },
];

export function Sidebar() {
  const location = useLocation();
  const { usuario, logout } = useAuthStore();

  const perms = usuario?.permisos ?? [];
  const items = navItems.filter(n => Array.isArray(n.permiso) ? n.permiso.some(p => perms.includes(p)) : perms.includes(n.permiso));
  // Alerta de controles (4.2): vencidos + los que vencen en 7 días, sobre «Bandeja clínica».
  const controles = useContadorControles();

  return (
    <nav className="w-16 bg-[#0e4f9f] flex flex-col items-center py-3 gap-1 flex-shrink-0">
      {/* Logo */}
      <div className="mb-4">
        <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center p-1.5" title="Limablue Agenda">
          <img src="/logo-login.png" alt="Limablue" className="w-full h-full object-contain" />
        </div>
      </div>

      {/* Nav */}
      {items.map(item => {
        const isExactOrSub = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to + '/'));
        const hasMoreSpecificMatch = items.some(other => other.to !== item.to && other.to.length > item.to.length && (location.pathname === other.to || location.pathname.startsWith(other.to + '/')));
        const active = isExactOrSub && !hasMoreSpecificMatch;
        return (
          <Link
            key={item.to}
            to={item.to}
            title={item.to === '/historia-clinica/bandeja' && controles.total ? `${item.label} · ${controles.vencidos} control(es) vencido(s), ${controles.proximos} en 7 días` : item.label}
            className={cn(
              'relative w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all',
              active
                ? 'bg-limablue-600 text-white shadow-lg shadow-limablue-900/50'
                : 'text-limablue-300 hover:bg-limablue-800 hover:text-white'
            )}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-xxs leading-none">{item.label.split(' ')[0]}</span>
            {item.to === '/historia-clinica/bandeja' && controles.total > 0 && (
              <span data-testid="badge-controles" className={cn('absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white', controles.vencidos ? 'bg-red-500' : 'bg-amber-500')}>
                {controles.total > 99 ? '99+' : controles.total}
              </span>
            )}
          </Link>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Usuario */}
      <button
        onClick={logout}
        title={`${usuario?.nombre} — Cerrar sesión`}
        className="w-11 h-11 rounded-xl bg-limablue-800 flex items-center justify-center text-white hover:bg-red-500 transition-all"
      >
        <span className="text-sm font-bold">
          {usuario?.nombre.split(' ').map(n => n[0]).slice(0, 2).join('')}
        </span>
      </button>
    </nav>
  );
}
