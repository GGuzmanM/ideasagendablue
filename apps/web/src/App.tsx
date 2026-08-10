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
import { VideosServicioPage } from './pages/herramientas/VideosServicioPage';
import { Idea1AgendaPage } from './pages/Idea1AgendaPage';
import { HorariosRestriccionesPage } from './pages/HorariosRestriccionesPage';

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
      <Route path="/AgendaPrincipal" element={<Idea1AgendaPage />} />
      {/* Compatibilidad: la URL anterior /idea1 redirige a la nueva (bookmarks) */}
      <Route path="/idea1" element={<Navigate to="/AgendaPrincipal" replace />} />
      {/* Vista de impresión (sin Layout/sidebar) — matriz A4 horizontal para PDF */}
      <Route path="/imprimir/composicion-sede" element={<ComposicionImprimirPage />} />
      {/* Comprobantes del día en una sola hoja (cierre) */}
      <Route path="/imprimir/comprobantes" element={<ComprobantesImprimirPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/AgendaPrincipal" replace />} />
        <Route path="/agenda-vieja" element={<AgendaPage />} />
        <Route path="/pacientes" element={<RequirePermiso permiso="pacientes.ver"><PacientesPage /></RequirePermiso>} />
        <Route path="/pacientes/:id" element={<RequirePermiso permiso="pacientes.ver"><FichaPacientePage /></RequirePermiso>} />
        <Route path="/horarios" element={<RequirePermiso permiso="horarios.ver"><HorariosRestriccionesPage /></RequirePermiso>} />
        <Route path="/herramientas" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><HerramientasPage /></RequirePermiso>} />
        <Route path="/herramientas/almuerzos" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><AlmuerzosPage /></RequirePermiso>} />
        <Route path="/herramientas/confirmacion-mail" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><ConfirmacionMailPage /></RequirePermiso>} />
        <Route path="/herramientas/horarios" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><HorariosPage /></RequirePermiso>} />
        {/* Rutas viejas → herramienta unificada (enlaces guardados siguen funcionando) */}
        <Route path="/herramientas/horarios-entrada" element={<Navigate to="/herramientas/horarios?tab=fechas" replace />} />
        <Route path="/herramientas/permisos" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><PermisosPage /></RequirePermiso>} />
        <Route path="/herramientas/canales" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><CanalesPage /></RequirePermiso>} />
        <Route path="/herramientas/promociones" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><PromocionesPage /></RequirePermiso>} />
        <Route path="/herramientas/membresias" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><MembresiasPage /></RequirePermiso>} />
        <Route path="/herramientas/membresias-vendidas" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><MembresiasVendidasPage /></RequirePermiso>} />
        <Route path="/herramientas/dias-especiales" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><DiasEspecialesPage /></RequirePermiso>} />
        <Route path="/herramientas/conciliacion" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><ConciliacionPage /></RequirePermiso>} />
        <Route path="/herramientas/recordatorios" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><RecordatoriosPanel /></RequirePermiso>} />
        <Route path="/herramientas/baro-solicitud" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><BaroSolicitudPage /></RequirePermiso>} />
        <Route path="/herramientas/combinaciones" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><CombinacionesPage /></RequirePermiso>} />
        <Route path="/herramientas/videos-servicio" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><VideosServicioPage /></RequirePermiso>} />
        <Route path="/herramientas/reportes-rrhh" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><ReportesRrhhPage /></RequirePermiso>} />
        <Route path="/herramientas/composicion-sede" element={<RequirePermiso permiso={['herramientas.operativas', 'herramientas.estrategicas']}><ComposicionSedePage /></RequirePermiso>} />
        <Route path="/herramientas/horarios-personal" element={<Navigate to="/herramientas/horarios?tab=semana" replace />} />
        <Route path="/movimientos" element={<RequirePermiso permiso="movimientos.ver"><MovimientosPage /></RequirePermiso>} />
        <Route path="/admin" element={<RequirePermiso permiso={['admin.ver', 'usuarios.ver', 'roles.editar', 'notificaciones.ver']}><AdminPage /></RequirePermiso>} />
        <Route path="/admin/competencias" element={<RequirePermiso permiso="admin.ver"><CompetenciasPage /></RequirePermiso>} />
        <Route path="/admin/paquetes" element={<RequirePermiso permiso="admin.ver"><PaquetesPage /></RequirePermiso>} />
        <Route path="/admin/podologas" element={<RequirePermiso permiso="admin.ver"><PodologasPage /></RequirePermiso>} />
        <Route path="/admin/servicios" element={<RequirePermiso permiso="admin.ver"><ServiciosPage /></RequirePermiso>} />
        <Route path="/admin/auditoria" element={<RequirePermiso permiso="admin.ver"><AuditoriaPage /></RequirePermiso>} />
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
