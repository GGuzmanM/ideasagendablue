import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { AgendaPage } from './pages/AgendaPage';
import { PacientesPage, FichaPacientePage } from './pages/PacientesPage';
import { AdminPage } from './pages/AdminPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AnalyticsDetallePage } from './pages/analytics/AnalyticsDetallePage';
import { AgentesResumenPage } from './pages/analytics/agentes/AgentesResumenPage';
import { AgentesComparativaPage } from './pages/analytics/agentes/AgentesComparativaPage';
import { AgenteDetallePage } from './pages/analytics/agentes/AgenteDetallePage';
import { HerramientasPage } from './pages/HerramientasPage';
import { MovimientosPage } from './pages/MovimientosPage';
import { UsersPage } from './pages/admin/UsersPage';
import { RolesPage } from './pages/admin/RolesPage';
import { CompetenciasPage } from './pages/admin/CompetenciasPage';
import { PaquetesPage } from './pages/admin/PaquetesPage';
import { PodologasPage } from './pages/admin/PodologasPage';
import { ServiciosPage } from './pages/admin/ServiciosPage';
import { AuditoriaPage } from './pages/admin/AuditoriaPage';
import { NotificacionesAdminPage } from './pages/NotificacionesAdminPage';
import { AlmuerzosPage } from './pages/herramientas/AlmuerzosPage';
import { ConfirmacionMailPage } from './pages/herramientas/ConfirmacionMailPage';
import { HorariosPage } from './pages/herramientas/HorariosPage';
import { PermisosPage } from './pages/herramientas/PermisosPage';
import { CanalesPage } from './pages/herramientas/CanalesPage';
import { PromocionesPage } from './pages/herramientas/PromocionesPage';
import { MembresiasPage } from './pages/herramientas/MembresiasPage';
import { MembresiasVendidasPage } from './pages/herramientas/MembresiasVendidasPage';
import { DiasEspecialesPage } from './pages/herramientas/DiasEspecialesPage';
import { ConciliacionPage } from './pages/herramientas/ConciliacionPage';
import { RecordatoriosPanel } from './pages/herramientas/RecordatoriosPanel';
import { BaroSolicitudPage } from './pages/herramientas/BaroSolicitudPage';
import { CombinacionesPage } from './pages/herramientas/CombinacionesPage';
import { ReportesRrhhPage } from './pages/herramientas/ReportesRrhhPage';
import { ComposicionSedePage } from './pages/herramientas/ComposicionSedePage';
import { ComposicionImprimirPage } from './pages/herramientas/ComposicionImprimirPage';
import { ComprobantesImprimirPage } from './pages/herramientas/ComprobantesImprimirPage';
import { MovimientosImprimirPage } from './pages/herramientas/MovimientosImprimirPage';
import { VideosServicioPage } from './pages/herramientas/VideosServicioPage';
import { Idea1AgendaPage } from './pages/Idea1AgendaPage';
import { HorariosRestriccionesPage } from './pages/HorariosRestriccionesPage';

// Guard de SESIÓN: sin token → directo a /login. Está suscrito al store, así que al cerrar sesión
// (logout pone token=null) redirige AL INSTANTE — no se queda la vista/sidebar hasta el próximo clic.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequirePermiso({ permiso, children }: { permiso: string | string[]; children: React.ReactNode }) {
  const usuario = useAuthStore(s => s.usuario);
  const perms = usuario?.permisos ?? [];

  if (!usuario) return <>{children}</>;

  const tiene = Array.isArray(permiso)
    ? permiso.some(p => perms.includes(p))
    : perms.includes(permiso);

  if (!tiene) {
    return <Navigate to="/AgendaPrincipal" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const token = useAuthStore(s => s.token);
  const checkAuth = useAuthStore(s => s.checkAuth);

  // Al cargar la app, refrescar el usuario y sus PERMISOS desde el servidor (no usar los
  // guardados de un login anterior). Así un cambio de permisos de rol aplica al recargar.
  useEffect(() => { if (token) void checkAuth(); }, [token, checkAuth]);

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/AgendaPrincipal" replace /> : <LoginPage />} />
      {/* Vista principal de la agenda */}
      <Route path="/AgendaPrincipal" element={<RequireAuth><Idea1AgendaPage /></RequireAuth>} />
      {/* Compatibilidad: la URL anterior /idea1 redirige a la nueva (bookmarks) */}
      <Route path="/idea1" element={<Navigate to="/AgendaPrincipal" replace />} />
      {/* Vista de impresión (sin Layout/sidebar) — matriz A4 horizontal para PDF */}
      <Route path="/imprimir/composicion-sede" element={<ComposicionImprimirPage />} />
      {/* Comprobantes del día en una sola hoja (cierre) */}
      <Route path="/imprimir/comprobantes" element={<ComprobantesImprimirPage />} />
      {/* Cambios de personal del mes (movimientos) — A4 vertical para PDF */}
      <Route path="/imprimir/movimientos" element={<MovimientosImprimirPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Navigate to="/AgendaPrincipal" replace />} />
        <Route path="/agenda-vieja" element={<AgendaPage />} />
        <Route path="/pacientes" element={<RequirePermiso permiso="pacientes.ver"><PacientesPage /></RequirePermiso>} />
        <Route path="/pacientes/:id" element={<RequirePermiso permiso="pacientes.ver"><FichaPacientePage /></RequirePermiso>} />
        <Route path="/horarios" element={<RequirePermiso permiso="horarios.ver"><HorariosRestriccionesPage /></RequirePermiso>} />
        <Route path="/herramientas" element={<RequirePermiso permiso={['exportar.usar', 'comunicaciones.gestionar', 'promociones.ver', 'promociones.gestionar', 'canales.gestionar', 'membresias.gestionar', 'config.editar']}><HerramientasPage /></RequirePermiso>} />
        <Route path="/herramientas/almuerzos" element={<RequirePermiso permiso="horarios.editar"><AlmuerzosPage /></RequirePermiso>} />
        <Route path="/herramientas/confirmacion-mail" element={<RequirePermiso permiso="comunicaciones.gestionar"><ConfirmacionMailPage /></RequirePermiso>} />
        <Route path="/herramientas/horarios" element={<RequirePermiso permiso="horarios.editar"><HorariosPage /></RequirePermiso>} />
        {/* Rutas viejas → herramienta unificada (enlaces guardados siguen funcionando) */}
        <Route path="/herramientas/horarios-entrada" element={<Navigate to="/herramientas/horarios?tab=fechas" replace />} />
        <Route path="/herramientas/permisos" element={<RequirePermiso permiso="horarios.editar"><PermisosPage /></RequirePermiso>} />
        <Route path="/herramientas/canales" element={<RequirePermiso permiso="canales.gestionar"><CanalesPage /></RequirePermiso>} />
        <Route path="/herramientas/promociones" element={<RequirePermiso permiso="promociones.ver"><PromocionesPage /></RequirePermiso>} />
        <Route path="/herramientas/membresias" element={<RequirePermiso permiso="membresias.gestionar"><MembresiasPage /></RequirePermiso>} />
        <Route path="/herramientas/membresias-vendidas" element={<RequirePermiso permiso="membresias.gestionar"><MembresiasVendidasPage /></RequirePermiso>} />
        <Route path="/herramientas/dias-especiales" element={<RequirePermiso permiso="horarios.editar"><DiasEspecialesPage /></RequirePermiso>} />
        <Route path="/herramientas/conciliacion" element={<RequirePermiso permiso="config.editar"><ConciliacionPage /></RequirePermiso>} />
        <Route path="/herramientas/recordatorios" element={<RequirePermiso permiso="comunicaciones.gestionar"><RecordatoriosPanel /></RequirePermiso>} />
        <Route path="/herramientas/baro-solicitud" element={<RequirePermiso permiso="movimientos.editar"><BaroSolicitudPage /></RequirePermiso>} />
        <Route path="/herramientas/combinaciones" element={<RequirePermiso permiso="config.editar"><CombinacionesPage /></RequirePermiso>} />
        <Route path="/herramientas/videos-servicio" element={<RequirePermiso permiso="comunicaciones.gestionar"><VideosServicioPage /></RequirePermiso>} />
        <Route path="/herramientas/reportes-rrhh" element={<RequirePermiso permiso="analytics.ver"><ReportesRrhhPage /></RequirePermiso>} />
        <Route path="/herramientas/composicion-sede" element={<RequirePermiso permiso="movimientos.editar"><ComposicionSedePage /></RequirePermiso>} />
        <Route path="/herramientas/horarios-personal" element={<Navigate to="/herramientas/horarios?tab=semana" replace />} />
        <Route path="/movimientos" element={<RequirePermiso permiso="movimientos.ver"><MovimientosPage /></RequirePermiso>} />
        <Route path="/admin" element={<RequirePermiso permiso={['profesionales.ver', 'servicios.ver', 'competencias.editar', 'auditoria.ver', 'membresias.gestionar', 'usuarios.ver', 'roles.editar', 'notificaciones.ver']}><AdminPage /></RequirePermiso>} />
        <Route path="/admin/competencias" element={<RequirePermiso permiso="competencias.editar"><CompetenciasPage /></RequirePermiso>} />
        <Route path="/admin/paquetes" element={<RequirePermiso permiso="membresias.gestionar"><PaquetesPage /></RequirePermiso>} />
        <Route path="/admin/podologas" element={<RequirePermiso permiso="profesionales.ver"><PodologasPage /></RequirePermiso>} />
        <Route path="/admin/servicios" element={<RequirePermiso permiso="servicios.ver"><ServiciosPage /></RequirePermiso>} />
        <Route path="/admin/auditoria" element={<RequirePermiso permiso="auditoria.ver"><AuditoriaPage /></RequirePermiso>} />
        <Route path="/admin/usuarios" element={<RequirePermiso permiso="usuarios.ver"><UsersPage /></RequirePermiso>} />
        <Route path="/admin/roles" element={<RequirePermiso permiso="roles.editar"><RolesPage /></RequirePermiso>} />
        <Route path="/admin/notificaciones" element={<RequirePermiso permiso="notificaciones.ver"><NotificacionesAdminPage /></RequirePermiso>} />
        <Route path="/analytics" element={<RequirePermiso permiso="analytics.ver"><AnalyticsPage /></RequirePermiso>} />
        {/* Desempeño de Agentes: rutas estáticas ganan sobre /analytics/:kpi */}
        <Route path="/analytics/agentes" element={<RequirePermiso permiso="analytics.ver"><AgentesResumenPage /></RequirePermiso>} />
        <Route path="/analytics/agentes/comparativa" element={<RequirePermiso permiso="analytics.ver"><AgentesComparativaPage /></RequirePermiso>} />
        <Route path="/analytics/agentes/:agenteId" element={<RequirePermiso permiso="analytics.ver"><AgenteDetallePage /></RequirePermiso>} />
        <Route path="/analytics/:kpi" element={<RequirePermiso permiso="analytics.ver"><AnalyticsDetallePage /></RequirePermiso>} />
      </Route>
      <Route path="*" element={<Navigate to="/AgendaPrincipal" replace />} />
    </Routes>
  );
}
