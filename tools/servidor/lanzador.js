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
// xfwd: el API ve la IP real de cada PC (auditoría y límites por IP).
const aApi = (filtro, extra = {}) => createProxyMiddleware({ target: API, changeOrigin: true, xfwd: true, pathFilter: filtro, ...extra });
const proxyApi = aApi((p) => p.startsWith('/api') || p === '/health');
const proxyWs = aApi((p) => p.startsWith('/socket.io'), { ws: true });
const proxyUploads = aApi((p) => p.startsWith('/uploads'));
app.use(proxyApi);
app.use(proxyWs);
app.use(proxyUploads);

const WEB = path.join(APP, 'web');
// index.html sin caché (para que una actualización se vea con F5); los archivos con hash, un año.
app.use(express.static(WEB, {
  index: false,
  setHeaders: (res, ruta) => res.setHeader('Cache-Control', ruta.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
}));
app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(WEB, 'index.html')); });

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
  log('servidor', `Limablue Agenda en ${tls ? 'https' : 'http'}://<ip-del-servidor>:${WEB_PUERTO} (API interno ${API}). Datos: ${DATOS}`);
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
