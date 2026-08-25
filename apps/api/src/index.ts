import 'express-async-errors';
import dotenv from 'dotenv';
// Por defecto carga `.env` (producción). Con ENV_FILE=<archivo> carga ese archivo en su lugar
// (útil para instancias aisladas). Prod-neutral: sin ENV_FILE, comportamiento idéntico.
dotenv.config(process.env.ENV_FILE ? { path: process.env.ENV_FILE } : undefined);

// Zona horaria del PROCESO fija a UTC: toda fecha @db.Date se ancla a UTC (mediodía
// para días, ver utils/fechaLima). Así el sistema se comporta IGUAL en cualquier host
// de producción (no depende de la TZ del servidor) y se eliminan los desfases de ±1 día.
process.env.TZ = 'UTC';

import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';

import { prisma } from './db';
import { redis } from './redis';
import { initSocket } from './socket';
import { corsOrigin } from './cors';
import { iniciarRecordatorioWorker } from './queue/recordatorioWorker';
import { recuperarRecordatoriosProgramados } from './services/recordatorioService';
import { iniciarVideoWorker, programarBarridoVideos } from './queue/videoQueue';
import { USA_REDIS } from './config/colaModo';
import { iniciarSchedulerDb } from './queue/schedulerDb';
import { outlookConfigurado, reintentarOutlookFallidos } from './services/outlookCalendarService';
import { importarOcupacionOutlookTodos } from './services/importarOcupacionOutlook';
import { errorHandler } from './middleware/errorHandler';
import { firmarUrlsRespuesta, servirUploadFirmado } from './middleware/firmaArchivos';
import { swaggerSpec } from './swagger';
import { verificarSecretosAlArranque } from './utils/verificarSecretos';
import { globalLimiter, analyticsLimiter } from './middleware/rateLimits';

import citasRouter, { autocompletarCitasPorTiempo } from './routes/citas';
import usersRouter from './routes/users';
import rolesRouter from './routes/roles';
import disponibilidadRouter from './routes/disponibilidad';
import pacientesRouter from './routes/pacientes';
import reniecRouter from './routes/reniec';
import profesionalesRouter from './routes/profesionales';
import sedesRouter from './routes/sedes';
import servicesRouter from './routes/servicios';
import competenciasRouter from './routes/competencias';
import asignacionesRouter from './routes/asignaciones';
import paquetesRouter from './routes/paquetes';
import auditRouter from './routes/audit';
import authRouter from './routes/auth';
import webhooksRouter from './routes/webhooks';
import resendWebhookRouter from './routes/resendWebhook';
import { horariosRouter } from './routes/horarios';
import analyticsRouter, { recalcularAgregadosAuto } from './routes/analytics';
import { iniciarRenovacionMensual } from './services/renovacionMensual';
import analyticsAgentesRouter from './routes/analyticsAgentes';
import exportarRouter from './routes/exportar';
import composicionSedeRouter from './routes/composicionSede';
import movimientosRouter from './routes/movimientos';
import notificacionesRouter from './routes/notificaciones';
import almuerzosRouter from './routes/almuerzos';
import herramientasRouter from './routes/herramientas';
import permisosRouter from './routes/permisos';
import canalesRouter from './routes/canales';
import recordatoriosRouter from './routes/recordatorios';
import baroSolicitudRouter from './routes/baroSolicitud';
import combinacionesRouter from './routes/combinaciones';
import promocionesRouter from './routes/promociones';
import membresiasRouter from './routes/membresias';
import conciliacionRouter from './routes/conciliacion';
import consumosRouter from './routes/consumos';
import reportesRouter from './routes/reportes';
import servicioVideosRouter from './routes/servicioVideos';
import videosPublicoRouter from './routes/videosPublico';

const app = express();
const server = http.createServer(app);

// ─── Trust proxy ──────────────────────────────────────────────────────────────
// Cuando la API queda DETRÁS de un reverse proxy (Nginx, Cloudflare, IIS, ELB…)
// req.ip por defecto muestra la IP del proxy (siempre la misma), no la del cliente.
// `trust proxy` hace que Express lea el header X-Forwarded-For y devuelva la IP
// real. Valores comunes: 'true' (confía en cualquier proxy), 'loopback',
// '10.0.0.0/8', etc. Configurable por env (TRUST_PROXY). Default: 'loopback'
// (funciona en dev y sirve también si el proxy corre en la misma máquina).
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

// ─── Middleware ───────────────────────────────────────────────────────────────
// CSP estricta para las páginas HTML del API (confirmar/cancelar cita, baja de videos): los
// scripts solo pueden ser propios ('self') → un script inyectado NO se ejecuta. Se permiten los
// estilos INLINE (esas páginas usan style="" en cada elemento) — riesgo bajo vs. scripts.
// `upgradeInsecureRequests: null` evita forzar https en dev (http://localhost). Swagger tiene su
// propia CSP relajada más abajo (usa un script inline para arrancar).
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use(compression());
// Webhook de Resend: se monta ANTES de express.json() porque valida la firma svix
// sobre el RAW body (el router usa su propio parser raw). Ruta específica primero.
app.use('/api/v1/webhooks/resend', resendWebhookRouter);
app.use(express.json({ limit: '10mb' }));

// ─── Logging con REDACCIÓN de tokens ─────────────────────────────────────────
// Los enlaces de correo (confirmar/cancelar cita, baja de videos) y las URLs firmadas de
// /uploads llevan tokens/firmas en el query string. morgan loguea la URL completa → esos
// tokens quedarían en los access-logs y serían REUTILIZABLES. Se enmascara el VALOR de los
// params sensibles antes de escribir la línea, tanto en la URL como en el Referer.
const redactarTokens = (s?: string | null): string => {
  if (!s) return s ?? '-';
  return s.replace(/([?&](?:token|sig|access_token|apikey|api_key|key|password|secret)=)[^&#\s]*/gi, '$1***');
};
morgan.token('url-safe', (req: express.Request) => redactarTokens(req.originalUrl || req.url));
morgan.token('ref-safe', (req: express.Request) => redactarTokens(req.headers.referer || '-'));
app.use(morgan(
  ':remote-addr - :remote-user [:date[clf]] ":method :url-safe HTTP/:http-version" :status :res[content-length] ":ref-safe" ":user-agent"',
));

// Firma las URLs de archivos privados (/uploads) en TODA respuesta JSON (punto único).
app.use(firmarUrlsRespuesta);

// ─── Archivos privados (comprobantes de pago, contratos) ──────────────────────
// Ya NO se sirven con express.static público: llevan datos personales. Solo se
// entregan con una firma HMAC válida y vigente en la URL (ver firmaArchivos.ts).
app.use('/uploads', servirUploadFirmado);

// ─── Swagger ──────────────────────────────────────────────────────────────────
// La documentación (Swagger UI) expone el MAPA COMPLETO de la API. No filtra datos ni salta la
// auth (cada endpoint sigue exigiendo token), pero es un plano útil para un atacante → NO debe
// quedar pública en producción. Regla: si SWAGGER_HABILITADO está seteado manda ("true"/"false");
// si no, se habilita solo FUERA de producción. En el servidor (NODE_ENV=production) queda apagada.
const swaggerHabilitado = process.env.SWAGGER_HABILITADO
  ? process.env.SWAGGER_HABILITADO === 'true'
  : process.env.NODE_ENV !== 'production';

if (swaggerHabilitado) {
  // Swagger UI necesita su script/estilos inline (y a veces eval) para arrancar → CSP relajada
  // SOLO en /api/docs. El resto del API queda con la CSP estricta de arriba.
  app.use('/api/docs', helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      upgradeInsecureRequests: null,
    },
  }));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { background-color: #1e40af; }',
    customSiteTitle: 'Limablue Agenda API',
  }));
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: String(err) });
  }
});

// ─── Rutas API ────────────────────────────────────────────────────────────────
const v1 = '/api/v1';
// Backstop global anti-DoS: tope alto por IP para toda la API (no estorba la operación real).
app.use(v1, globalLimiter);
app.use(`${v1}/auth`, authRouter);
app.use(`${v1}/users`, usersRouter);
app.use(`${v1}/roles`, rolesRouter);
app.use(`${v1}/citas`, citasRouter);
app.use(`${v1}/disponibilidad`, disponibilidadRouter);
app.use(`${v1}/pacientes`, pacientesRouter);
app.use(`${v1}/reniec`, reniecRouter);
app.use(`${v1}/profesionales`, profesionalesRouter);
app.use(`${v1}/sedes`, sedesRouter);
app.use(`${v1}/servicios`, servicesRouter);
app.use(`${v1}/competencias`, competenciasRouter);
app.use(`${v1}/asignaciones`, asignacionesRouter);
app.use(`${v1}/paquetes`, paquetesRouter);
app.use(`${v1}/audit`, auditRouter);
app.use(`${v1}/webhooks`, webhooksRouter);
app.use(`${v1}/horarios`, horariosRouter);
app.use(`${v1}/analytics/agentes`, analyticsLimiter, analyticsAgentesRouter); // antes que /analytics (prefijo más específico)
app.use(`${v1}/analytics`, analyticsLimiter, analyticsRouter);
app.use(`${v1}/exportar`, exportarRouter);
app.use(`${v1}/composicion-sede`, composicionSedeRouter);
app.use(`${v1}/movimientos`, movimientosRouter);
app.use(`${v1}/notificaciones`, notificacionesRouter);
app.use(`${v1}/almuerzos`, almuerzosRouter);
app.use(`${v1}/herramientas`, herramientasRouter);
app.use(`${v1}/permisos`, permisosRouter);
app.use(`${v1}/canales`, canalesRouter);
app.use(`${v1}/recordatorios`, recordatoriosRouter);
app.use(`${v1}/baro-solicitud`, baroSolicitudRouter);
app.use(`${v1}/combinaciones`, combinacionesRouter);
app.use(`${v1}/promociones`, promocionesRouter);
app.use(`${v1}/membresias`, membresiasRouter);
app.use(`${v1}/conciliacion`, conciliacionRouter);
app.use(`${v1}/consumos`, consumosRouter);
app.use(`${v1}/reportes`, reportesRouter);
app.use(`${v1}/servicio-videos`, servicioVideosRouter);
app.use(`${v1}/videos`, videosPublicoRouter); // PÚBLICO (sin login): baja/reactivar desde el correo

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Socket.io ────────────────────────────────────────────────────────────────
initSocket(server);

// ─── Recordatorios (Correo 2) + barrido de videos ─────────────────────────────
if (USA_REDIS) {
  // Modo Redis/BullMQ. El worker corre en proceso salvo RECORDATORIOS_WORKER_INLINE="false"
  // (en ese caso arranca `npm run worker` aparte).
  if (process.env.RECORDATORIOS_WORKER_INLINE !== 'false') {
    iniciarRecordatorioWorker();
    iniciarVideoWorker();
    // Self-healing: si Redis estuvo caído, re-encola los recordatorios PROGRAMADO
    // huérfanos (jobId null) para que las confirmaciones pendientes salgan al volver.
    void recuperarRecordatoriosProgramados();
  }
  // Registra el job repetible del barrido de videos (cada 5 min). Idempotente: limpia
  // repeticiones previas. Se registra aunque el worker corra aparte (el worker lo procesa).
  void programarBarridoVideos();
} else {
  // Modo COLA_MODO="db" (sin Redis): un temporizador revisa la BD y envía lo vencido.
  iniciarSchedulerDb();
}

// ─── Reintento periódico de sincronizaciones Outlook fallidas ─────────────────
// Solo si Azure está configurado. Cada 10 min reprocesa las citas con outlookSyncError.
if (outlookConfigurado()) {
  setInterval(() => {
    void reintentarOutlookFallidos().then((r) => { if (r.intentadas) console.log('[outlook] reintento:', r); });
  }, 10 * 60_000).unref();
}

// ─── Sincronización INVERSA: ocupación de Outlook → bloqueos en Limablue ───────
// Solo si Azure está configurado. Cada MINUTO lee el calendario de los profesionales del
// tenant y refleja sus eventos "Ocupado/Fuera de oficina" como bloqueos de agenda. Una
// corrida al arrancar (tras BD/redis listos). No bloqueante. (Sondeo: en red local Graph no
// puede hacer push; 1 min es lo más rápido razonable sin una URL pública para webhooks.)
if (outlookConfigurado()) {
  const importarOcupacion = () => void importarOcupacionOutlookTodos()
    .then((r) => { if (r.creados || r.actualizados || r.borrados) console.log('[outlook-inverso] ocupación importada:', r); })
    .catch((e) => console.error('[outlook-inverso] error:', e));
  setTimeout(importarOcupacion, 15_000);
  setInterval(importarOcupacion, 60_000).unref();
}

// ─── Conexión temprana a Redis ────────────────────────────────────────────────
// Con `lazyConnect: true` el cliente no conecta hasta el primer comando. Como en dev
// nada más toca Redis al arrancar, ese primer comando sería el recálculo de agregados de
// abajo, cuyo SET salía a un socket a medio conectar y —con `enableOfflineQueue: false`—
// fallaba con "Stream isn't writeable" (cosmético: caía en fail-open). Conectando aquí,
// el socket ya está listo cuando corre el recalc. Si Redis no está, se ignora en silencio.
void redis.connect().catch(() => { /* Redis no disponible al arrancar: se opera en fail-open */ });

// ─── Recálculo automático de agregados (Analytics) ───────────────────────────
// agregados_diarios solo se actualizaba al crear/cambiar citas por la API → los datos
// cargados en bloque (seed/importación) o días sin mutaciones quedaban fuera y Analytics
// mostraba "solo algunos días". Recalculamos una ventana móvil (pasado reciente + futuro
// agendado) al arrancar y cada 6 h. Usa el candado del recálculo manual (se salta si hay uno).
const recalcAgregados = () => void recalcularAgregadosAuto().then((n) => { if (n != null) console.log(`[analytics] agregados recalculados: ${n} grupos`); });
setTimeout(recalcAgregados, 20_000); // al arrancar (tras BD/redis listos)
setInterval(recalcAgregados, 6 * 60 * 60_000).unref();

// ─── Auto-completado de citas por tiempo ──────────────────────────────────────
// Una cita marcada "Llegó" pasa sola a "Completada" tras AUTOCOMPLETAR_MIN (default 90) min.
// Barrido cada 5 min + una corrida al arrancar (para citas ya vencidas). No bloqueante.
const autocompletar = () => void autocompletarCitasPorTiempo().catch((e) => console.error('[autocompletar] error:', e));
setTimeout(autocompletar, 15_000); // al arrancar (deja que la BD/redis estén listos)
setInterval(autocompletar, 5 * 60_000).unref();

// ─── Auto-renovación mensual de asignaciones (baro + recepción) ───────────────
// Al cambiar de mes, el personal continúa en su misma sede salvo que lo muevan o den de baja.
// Corre al arrancar (catch-up) y cada 12 h. Idempotente. Ver services/renovacionMensual.ts.
setTimeout(() => iniciarRenovacionMensual(), 25_000);

// ─── Red de seguridad de procesos ─────────────────────────────────────────────
// Las tareas "fire-and-forget" del POST de citas (correo de reserva, sync Outlook,
// webhooks) se lanzan con `void X()`. Si alguna RECHAZA sin que su propio catch la
// atrape, en Node 20 una promesa rechazada sin manejar TUMBA el proceso → la API se
// reinicia y las peticiones en vuelo devuelven "Error interno del servidor" a la
// recepcionista, aunque la cita SÍ se haya creado. Aquí registramos esos errores y
// mantenemos el servidor vivo (nunca dejamos que un fallo de fondo derribe la API).
process.on('unhandledRejection', (motivo) => {
  console.error('[unhandledRejection] tarea de fondo falló (la API sigue viva):', motivo);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] error no atrapado (la API sigue viva):', err);
});

// ─── Start ────────────────────────────────────────────────────────────────────
// Blindaje: si algún secreto de firma es débil/por defecto/duplicado, NO se levanta el
// servidor (process.exit(1)). Imposible desplegar producción con un secreto vulnerable.
verificarSecretosAlArranque();

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Limablue Agenda API corriendo en http://localhost:${PORT}`);
  if (swaggerHabilitado) {
    console.log(`📚 Documentación: http://localhost:${PORT}/api/docs`);
  } else {
    console.log('🔒 Documentación (Swagger) DESHABILITADA (producción / SWAGGER_HABILITADO=false)');
  }
});

export { app, server };
