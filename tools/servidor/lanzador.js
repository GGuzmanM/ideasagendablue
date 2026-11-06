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

// ── registro ────────────────────────────────────────────────────────────────────
// 06-nov-2026 (rendimiento): este proceso atiende TODAS las pantallas y el proxy al API. Antes cada línea se escribía con
// `appendFileSync`: una escritura a disco sincrónica por petición que, con antivirus o disco ocupado, frenaba a todos.
// Ahora las líneas se juntan en memoria y se vuelcan cada segundo con una escritura asíncrona (un archivo por día, Lima).
// Al salir se vuelca lo pendiente de forma sincrónica para no perder las últimas líneas.
const pendientes = new Map(); // archivo -> texto por escribir
let volcando = false;
function volcar() {
  if (volcando || pendientes.size === 0) return;
  volcando = true;
  const lote = [...pendientes];
  pendientes.clear();
  let faltan = lote.length;
  for (const [archivo, texto] of lote) {
    fs.appendFile(archivo, texto, () => { // si falla (sin disco), se pierde esa línea: sigue la consola
      faltan -= 1;
      if (faltan === 0) volcando = false;
    });
  }
}
setInterval(volcar, 1000).unref();
process.on('exit', () => {
  for (const [archivo, texto] of pendientes) { try { fs.appendFileSync(archivo, texto); } catch { /* sin disco */ } }
  pendientes.clear();
});

function log(origen, texto) {
  const ahora = new Date();
  const lima = new Date(ahora.getTime() - 5 * 3600_000).toISOString();
  const linea = `${lima.slice(0, 19).replace('T', ' ')} [${origen}] ${String(texto).trimEnd()}\n`;
  const archivo = path.join(DIR_LOGS, `agenda-${lima.slice(0, 10)}.log`);
  pendientes.set(archivo, (pendientes.get(archivo) ?? '') + linea);
  // Como tarea de Windows nadie lee la consola: solo se escribe ahí cuando hay una terminal (arranque a mano).
  if (process.stdout.isTTY) process.stdout.write(linea);
}
// ── fin del registro ─────────────────────────────────────────────────────────────

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

// ─── Reserva web: página del paciente en /agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva ──────────────────
// (15-oct-2026; sin pasarela de pago desde el 29-oct-2026; dirección con prefijo desde el 30-oct-2026). Se puede cambiar con
// RUTA_RESERVA_WEB en agenda.env. Solo con RESERVA_WEB_HABILITADA=1 (la activa «Reserva web de prueba.bat»). La página llama
// al API por la misma dirección (/api/v1/publico/reservas): al confirmar se crea la cita y el pago se hace en la sede.
const RESERVA = path.join(APP, 'reserva');
const RUTA_RESERVA = `/${(cfg.RUTA_RESERVA_WEB || 'agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva').replace(/^\/+|\/+$/g, '')}`;
if (cfg.RESERVA_WEB_HABILITADA === '1' && fs.existsSync(RESERVA)) {
  // Con «/» final para que el logo (ruta relativa) cargue. Express trata la ruta con y sin «/» igual en app.get: se compara exacto.
  app.use((req, res, next) => (req.path === RUTA_RESERVA ? res.redirect(301, `${RUTA_RESERVA}/`) : next()));
  // La dirección anterior (/reserva) ya pudo compartirse: se lleva a la nueva.
  app.use((req, res, next) => (req.path === '/reserva' || req.path === '/reserva/' ? res.redirect(301, `${RUTA_RESERVA}/`) : next()));
  app.use(RUTA_RESERVA, express.static(RESERVA, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  log('servidor', cfg.RESERVA_WEB_MODO === 'vitrina'
    ? `Reserva web en ${RUTA_RESERVA} en MODO VITRINA (solo se ve: no aparta horarios ni crea citas).`
    : `Reserva web activa en ${RUTA_RESERVA} (la cita se crea al confirmar; se paga en la sede).`);
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
