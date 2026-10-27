// Limablue Agenda — arranque en el SERVIDOR (lo ejecuta la tarea de Windows «Limablue Agenda»).
// Un solo proceso que:
//  · levanta el API (app/api.js) como proceso hijo en el puerto interno y lo vuelve a levantar si se cae;
//  · sirve las pantallas (app/web) por HTTPS en el puerto de la clínica y pasa /api, /socket.io y /uploads al API.
// La configuración vive FUERA del programa: <datos>\config\agenda.env (por defecto C:\ProgramData\Limablue Agenda).
// Se empaqueta con tools/servidor/empaquetar.mjs.
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const dotenv = require('dotenv');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const APP = __dirname; // <programa>\app
const DATOS = process.env.LIMABLUE_DATOS || path.join(process.env.ProgramData || 'C:\\ProgramData', 'Limablue Agenda');
const ENV_FILE = path.join(DATOS, 'config', 'agenda.env');
const DIR_LOGS = path.join(DATOS, 'logs');
fs.mkdirSync(DIR_LOGS, { recursive: true });

function log(origen, texto) {
  const ahora = new Date();
  const lima = new Date(ahora.getTime() - 5 * 3600_000).toISOString();
  const linea = `${lima.slice(0, 19).replace('T', ' ')} [${origen}] ${String(texto).trimEnd()}\n`;
  try { fs.appendFileSync(path.join(DIR_LOGS, `agenda-${lima.slice(0, 10)}.log`), linea); } catch { /* sin disco: solo consola */ }
  process.stdout.write(linea);
}

if (!fs.existsSync(ENV_FILE)) {
  log('servidor', `No existe ${ENV_FILE}. Corre «Instalar o actualizar.bat» primero.`);
  process.exit(1);
}
const cfg = dotenv.parse(fs.readFileSync(ENV_FILE));
const API_PUERTO = Number(cfg.PORT) || 3002;
const WEB_PUERTO = Number(cfg.WEB_PUERTO) || 5180;
const API = `http://127.0.0.1:${API_PUERTO}`;
const enConfig = (p) => (p && !path.isAbsolute(p) ? path.join(DATOS, 'config', p) : p);

// ─── API (proceso hijo) ──────────────────────────────────────────────────────────
// Si la tarea se detuvo de golpe, un API viejo de ESTE programa pudo quedar vivo ocupando el puerto: se cierra.
function cerrarApiHuerfano() {
  const api = path.join(APP, 'api.js').replace(/'/g, "''");
  spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${api}*' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ], { windowsHide: true, timeout: 20_000 });
}
cerrarApiHuerfano();

let hijo = null;
let saliendo = false;
let fallosSeguidos = 0;
function levantarApi() {
  const inicio = Date.now();
  hijo = spawn(process.execPath, [path.join(APP, 'api.js')], {
    cwd: APP, // assets (logos de PDF y correo) viajan con el programa
    env: {
      ...process.env, ...cfg,
      ENV_FILE, NODE_ENV: cfg.NODE_ENV || 'production', PORT: String(API_PUERTO),
      UPLOADS_DIR: cfg.UPLOADS_DIR || path.join(DATOS, 'uploads'),
      TRUST_PROXY: cfg.TRUST_PROXY || 'loopback',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  hijo.stdout.on('data', (d) => log('api', d));
  hijo.stderr.on('data', (d) => log('api', d));
  hijo.on('exit', (code) => {
    if (saliendo) return;
    fallosSeguidos = Date.now() - inicio < 60_000 ? fallosSeguidos + 1 : 0;
    const espera = Math.min(60_000, 3_000 * 2 ** Math.min(fallosSeguidos, 5));
    log('servidor', `El API se detuvo (código ${code}). Se vuelve a levantar en ${Math.round(espera / 1000)} s.`);
    setTimeout(levantarApi, espera);
  });
}
levantarApi();

// ─── Pantallas + paso al API ─────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
// Cabeceras de seguridad de las pantallas (el API ya trae las suyas con helmet).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
  if (tls) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
// xfwd: el API ve la IP real de cada PC (auditoría y límites por IP).
const aApi = (filtro, extra = {}) => createProxyMiddleware({ target: API, changeOrigin: true, xfwd: true, pathFilter: filtro, ...extra });
const proxyApi = aApi((p) => p.startsWith('/api') || p === '/health');
const proxyWs = aApi((p) => p.startsWith('/socket.io'), { ws: true });
const proxyUploads = aApi((p) => p.startsWith('/uploads'));
app.use(proxyApi);
app.use(proxyWs);
app.use(proxyUploads);

// ─── Reserva web: página del paciente en /reserva (15-oct-2026) ─────────────────────
// Solo con RESERVA_WEB_HABILITADA=1 (la activa «Reserva web de prueba.bat»). La página llama al API por la misma
// dirección (/api/v1/publico/reservas). Con la pasarela «simulada», POST /reserva/pagar-prueba hace de pasarela:
// el secreto vive aquí, nunca en el navegador. Con una pasarela real esa ruta no existe.
const RESERVA = path.join(APP, 'reserva');
const PREFIJO_RESERVA = '/api/v1/publico/reservas';
async function pagarPrueba(req, res) {
  const { codigo, token, aprobado } = req.body || {};
  if (!codigo || !token) return res.status(400).json({ error: 'DATOS', message: 'Falta el código de la reserva' });
  try {
    // Vitrina (RESERVA_WEB_MODO=vitrina): demostración, no se cobra ni se crea la cita.
    if (cfg.RESERVA_WEB_MODO === 'vitrina') {
      await new Promise((ok) => setTimeout(ok, 1200));
      const r = await fetch(`${API}${PREFIJO_RESERVA}/${encodeURIComponent(codigo)}/confirmar-demo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      return res.status(r.status).json(await r.json().catch(() => ({})));
    }
    // Solo quien tiene el token de la reserva puede «pagarla».
    const est = await fetch(`${API}${PREFIJO_RESERVA}/${encodeURIComponent(codigo)}?token=${encodeURIComponent(token)}`);
    const e = await est.json().catch(() => ({}));
    if (!est.ok) return res.status(est.status).json(e);
    if (e.estado !== 'esperando_pago') {
      return res.status(409).json({ error: 'RESERVA_NO_PAGABLE', message: e.estado === 'expirada' ? 'Se venció el tiempo para pagar. Vuelve a elegir tu horario.' : 'Esta reserva ya no está esperando pago.' });
    }
    await new Promise((ok) => setTimeout(ok, 1200)); // lo que tarda una pasarela de verdad
    const r = await fetch(`${API}${PREFIJO_RESERVA}/pagos/webhook/simulada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-simulada-secreto': cfg.RESERVA_WEB_SIMULADA_SECRETO || '' },
      body: JSON.stringify({ codigo, aprobado: aprobado !== false }),
    });
    res.status(r.status).json(await r.json().catch(() => ({})));
  } catch {
    res.status(502).json({ error: 'API_NO_RESPONDE', message: 'El sistema no responde. Intenta en un momento.' });
  }
}
if (cfg.RESERVA_WEB_HABILITADA === '1' && fs.existsSync(RESERVA)) {
  if (cfg.RESERVA_WEB_MODO === 'vitrina' || cfg.RESERVA_WEB_PASARELA === 'simulada') app.post('/reserva/pagar-prueba', express.json({ limit: '10kb' }), pagarPrueba);
  // Con «/» final para que el logo (ruta relativa) cargue. Express trata /reserva y /reserva/ igual en app.get: se compara exacto.
  app.use((req, res, next) => (req.path === '/reserva' ? res.redirect(301, '/reserva/') : next()));
  app.use('/reserva', express.static(RESERVA, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  log('servidor', cfg.RESERVA_WEB_MODO === 'vitrina'
    ? 'Reserva web en /reserva en MODO VITRINA (solo se ve: no aparta horarios ni crea citas).'
    : `Reserva web activa en /reserva (pasarela: ${cfg.RESERVA_WEB_PASARELA || 'sin definir'}).`);
}

// ─── Pantallas: TODA la web cuelga de /acceso_agenda_lb (login en /acceso_agenda_lb/login) ───────────────────────
// Debe coincidir con `base` de apps/web/vite.config.ts (el build ya trae los enlaces con este prefijo). Se puede cambiar
// con PREFIJO_WEB en agenda.env, pero entonces hay que recompilar la web con el mismo prefijo.
const PREFIJO = `/${(cfg.PREFIJO_WEB || 'acceso_agenda_lb').replace(/^\/+|\/+$/g, '')}`;
const WEB = path.join(APP, 'web');
const noEncontrado = (_req, res) => res.status(404).type('text/plain').send('Not Found');
// Los QR de las recetas ya impresas apuntan a /verificar/<código> (sin prefijo): se les lleva a la dirección nueva.
app.get('/verificar/:codigo', (req, res) => res.redirect(302, `${PREFIJO}/verificar/${encodeURIComponent(req.params.codigo)}`));
// index.html sin caché (para que una actualización se vea con F5); los archivos con hash, un año.
app.use(PREFIJO, express.static(WEB, {
  index: false,
  setHeaders: (res, ruta) => res.setHeader('Cache-Control', ruta.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
}));
// Ventanas de la aplicación (rutas del navegador) → index.html. Un archivo que no existe (con extensión) es 404, no la página.
app.use(PREFIJO, (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (path.extname(req.path)) return noEncontrado(req, res);
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(WEB, 'index.html'));
});
// Cualquier otra dirección (la raíz, /login, /admin…) no revela nada: 404 neutro. Quien no conoce la dirección de acceso no ve el sistema.
app.use(noEncontrado);

function opcionesHttps() {
  try {
    if (cfg.HTTPS_PFX) return { pfx: fs.readFileSync(enConfig(cfg.HTTPS_PFX)), passphrase: cfg.HTTPS_PFX_CLAVE || '' };
    if (cfg.HTTPS_CERT && cfg.HTTPS_KEY) return { cert: fs.readFileSync(enConfig(cfg.HTTPS_CERT)), key: fs.readFileSync(enConfig(cfg.HTTPS_KEY)) };
  } catch (e) {
    log('servidor', `No se pudo leer el certificado HTTPS (${e.message}). Se sirve por HTTP: el dictado por voz no funcionará.`);
  }
  return null;
}
const tls = opcionesHttps();
const servidor = tls ? https.createServer(tls, app) : http.createServer(app);
servidor.on('upgrade', proxyWs.upgrade);
servidor.listen(WEB_PUERTO, '0.0.0.0', () => {
  const sufijoPuerto = (tls && WEB_PUERTO === 443) || (!tls && WEB_PUERTO === 80) ? '' : `:${WEB_PUERTO}`;
  log('servidor', `Limablue Agenda en ${tls ? 'https' : 'http'}://<ip-del-servidor>${sufijoPuerto}${PREFIJO}/login (API interno ${API}). Datos: ${DATOS}`);
});

function salir() {
  saliendo = true;
  log('servidor', 'Deteniendo…');
  try { hijo?.kill(); } catch { /* ya terminó */ }
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', salir);
process.on('SIGINT', salir);
