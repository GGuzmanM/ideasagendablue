// Arma el INSTALABLE del servidor (12-oct-2026): una carpeta con la Agenda ya compilada, sin código fuente.
//   node tools/servidor/empaquetar.mjs ["C:\ruta\de\salida"]
// Por defecto deja  C:\Users\<usuario>\Documents\Agenda Servidor\AgendaLB\Release  (reemplaza la anterior)
// Contenido:
//   app\api.js        API compilado en UN archivo (minificado; sin .ts, sin comentarios)
//   app\servidor.js   arranque: sirve las pantallas por https y pasa /api al API (ver lanzador.js)
//   app\web\          pantallas compiladas (vite build)
//   app\assets\       logos de PDF y correo · app\prisma\ schema + migraciones (para «migrate deploy»)
//   node\node.exe     Node incluido · node_modules\ librerías de terceros (solo producción) + cliente Prisma
//   *.bat, herramientas\instalar.ps1, LEEME.txt
// No toca el servidor de desarrollo: no recompila packages/shared (se toma de su código), no regenera el Prisma del repo.
import { build } from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ahora = new Date(Date.now() - 5 * 3600_000).toISOString(); // hora Lima
const VERSION = `${ahora.slice(0, 10).replace(/-/g, '.')}-${ahora.slice(11, 16).replace(':', '')}`;
// Misma ruta siempre (como AdminPad en el NAS: «AgendaLB\Release»); la versión va en version.txt.
const BASE = process.argv[2] || path.join(os.homedir(), 'Documents', 'Agenda Servidor', 'AgendaLB');
const OUT = path.join(BASE, 'Release');
const APP = path.join(OUT, 'app');
const API = path.join(REPO, 'apps', 'api');
const WEB = path.join(REPO, 'apps', 'web');
const PLANTILLA = path.join(REPO, 'tools', 'servidor', 'plantilla');

const paso = (t) => console.log(`\n▶ ${t}`);
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
// Versión instalada en el repo (se lee del disco: algunos paquetes no exportan su package.json).
const versionDe = (pkg) => {
  for (const base of [path.join(REPO, 'apps', 'api', 'node_modules'), path.join(REPO, 'apps', 'web', 'node_modules'), path.join(REPO, 'node_modules')]) {
    const f = path.join(base, ...pkg.split('/'), 'package.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).version;
  }
  throw new Error(`No se encontró ${pkg} en node_modules`);
};

paso(`Salida: ${OUT}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

// ── 1. API en un solo archivo ────────────────────────────────────────────────────
paso('Compilando el API (esbuild, minificado)');
const pkgApi = JSON.parse(fs.readFileSync(path.join(API, 'package.json'), 'utf8'));
const externas = Object.keys(pkgApi.dependencies).filter((d) => d !== '@limablue/shared' && !d.startsWith('@types/'));
await build({
  entryPoints: [path.join(API, 'src', 'index.ts')],
  outfile: path.join(APP, 'api.js'),
  bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  minify: true, keepNames: true, legalComments: 'none', sourcemap: false,
  external: externas,
  alias: { '@limablue/shared': path.join(REPO, 'packages', 'shared', 'src', 'index.ts') },
  tsconfig: path.join(API, 'tsconfig.json'),
  logLevel: 'warning',
});
await build({
  entryPoints: [path.join(REPO, 'tools', 'servidor', 'lanzador.js')],
  outfile: path.join(APP, 'servidor.js'),
  bundle: true, platform: 'node', target: 'node20', format: 'cjs', minify: true, legalComments: 'none',
  external: ['express', 'http-proxy-middleware', 'dotenv'],
  logLevel: 'warning',
});

// ── 2. Pantallas ────────────────────────────────────────────────────────────────
paso('Compilando las pantallas (vite build)');
run(`npx vite build --outDir "${path.join(APP, 'web')}" --emptyOutDir --logLevel warn`, WEB);

// ── 3. Archivos que el API lee al correr + Prisma ───────────────────────────────
paso('Copiando assets, schema y migraciones');
fs.cpSync(path.join(API, 'assets'), path.join(APP, 'assets'), { recursive: true });
fs.cpSync(path.join(REPO, 'tools', 'servidor', 'reserva'), path.join(APP, 'reserva'), { recursive: true }); // página de reserva web (/agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva)
fs.mkdirSync(path.join(APP, 'prisma'), { recursive: true });
fs.copyFileSync(path.join(API, 'prisma', 'schema.prisma'), path.join(APP, 'prisma', 'schema.prisma'));
fs.cpSync(path.join(API, 'prisma', 'migrations'), path.join(APP, 'prisma', 'migrations'), { recursive: true });

// ── 4. Librerías de producción (mismas versiones que las del repo) ──────────────
paso('Instalando librerías de producción');
const deps = Object.fromEntries([...externas, 'prisma', 'dotenv', 'express', 'http-proxy-middleware'].map((d) => [d, versionDe(d)]));
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({
  name: 'limablue-agenda-servidor', version: VERSION, private: true, description: 'Limablue Agenda (compilado)',
  dependencies: deps, overrides: { ws: versionDe('ws') },
}, null, 2));
run('npm install --omit=dev --no-audit --no-fund --prefer-offline --loglevel=error', OUT);
paso('Generando el cliente de Prisma');
run(`node node_modules/prisma/build/index.js generate --schema app/prisma/schema.prisma`, OUT);

// ── 5. Node incluido ────────────────────────────────────────────────────────────
paso(`Copiando Node ${process.version}`);
fs.mkdirSync(path.join(OUT, 'node'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(OUT, 'node', 'node.exe'));

// ── 6. Instalador, .bat y LEEME ─────────────────────────────────────────────────
paso('Copiando instalador y scripts');
const BOM = '\uFEFF';
for (const rel of fs.readdirSync(PLANTILLA, { recursive: true })) {
  const origen = path.join(PLANTILLA, rel);
  if (fs.statSync(origen).isDirectory()) continue;
  const destino = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  let texto = fs.readFileSync(origen, 'utf8').replace(/\r?\n/g, '\r\n').replace(/\{\{VERSION\}\}/g, VERSION);
  if (rel.endsWith('.ps1')) texto = BOM + texto; // PowerShell 5.1 necesita BOM para leer tildes
  fs.writeFileSync(destino, texto);
}
fs.writeFileSync(path.join(OUT, 'version.txt'), `Limablue Agenda ${VERSION}\r\nNode ${process.version}\r\n`);

// ── Resumen ─────────────────────────────────────────────────────────────────────
const tamano = (dir) => fs.readdirSync(dir, { recursive: true }).reduce((s, f) => { const p = path.join(dir, f); const st = fs.statSync(p); return s + (st.isFile() ? st.size : 0); }, 0);
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
console.log(`\n✔ Listo: ${OUT}`);
console.log(`  API: ${mb(fs.statSync(path.join(APP, 'api.js')).size)} · pantallas: ${mb(tamano(path.join(APP, 'web')))} · total: ${mb(tamano(OUT))}`);
