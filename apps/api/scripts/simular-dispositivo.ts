/**
 * Simulador del APARATO del consultorio (ESP32 con botones INICIO / FIN), para probar sin la placa.
 * Hace exactamente las mismas llamadas que el programa del aparato y muestra la pantalla 16x2.
 *
 * Uso (desde apps/api):
 *   npx ts-node --transpile-only scripts/simular-dispositivo.ts <inicio|fin|latido> --token lbd_xxx.yyy [opciones]
 *
 * Opciones:
 *   --api <url>        Base del API (default http://localhost:3002). ¡Nunca contra producción!
 *   --token <clave>    Clave del aparato (se ve una sola vez al registrarlo en Administración › Aparatos).
 *   --edad-ms <n>      El botón se presionó hace n ms (simula la cola sin red). Default 0.
 *   --id <idEvento>    Id del evento (default: aleatorio). Repetir el mismo id simula un reenvío.
 *   --repetir          Envía el mismo evento dos veces (el segundo debe devolver lo mismo).
 *   --sin-reloj        No manda edad ni hora: el servidor usa su hora y la marca aproximada.
 */
import crypto from 'crypto';

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const accion = process.argv[2];
const api = (arg('api') ?? 'http://localhost:3002').replace(/\/$/, '');
const token = arg('token');

function pantalla(lcd?: [string, string]) {
  if (!lcd) return;
  const linea = (s: string) => `│${s.padEnd(16).slice(0, 16)}│`;
  console.log(`┌────────────────┐\n${linea(lcd[0])}\n${linea(lcd[1])}\n└────────────────┘`);
}

async function enviar(ruta: string, cuerpo: unknown) {
  const r = await fetch(`${api}/api/v1/dispositivo${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Dispositivo ${token}` },
    body: JSON.stringify(cuerpo),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

(async () => {
  if (!['inicio', 'fin', 'latido'].includes(accion ?? '') || !token) {
    console.log('Uso: simular-dispositivo.ts <inicio|fin|latido> --token lbd_xxx.yyy [--api url] [--edad-ms n] [--id x] [--repetir] [--sin-reloj]');
    process.exit(1);
  }
  if (accion === 'latido') {
    const r = await enviar('/latido', { fw: 'simulador', rssi: -55 });
    console.log(`HTTP ${r.status}`, JSON.stringify(r.json, null, 2));
    pantalla(r.json.lcd);
    return;
  }
  const sinReloj = process.argv.includes('--sin-reloj');
  const evento = {
    idEvento: arg('id') ?? `sim-${crypto.randomBytes(4).toString('hex')}`,
    accion,
    ...(sinReloj ? {} : { edadMs: Number(arg('edad-ms') ?? 0), presionadoEn: new Date().toISOString(), ntp: true }),
    fw: 'simulador',
  };
  const veces = process.argv.includes('--repetir') ? 2 : 1;
  for (let i = 1; i <= veces; i++) {
    const r = await enviar('/eventos', evento);
    console.log(`${veces > 1 ? `envío ${i}: ` : ''}HTTP ${r.status} · ${r.json.resultado ?? r.json.error}`);
    if (r.json.tiempo) console.log(`tiempo ${r.json.tiempo.estado} · inicio ${r.json.tiempo.inicioEn}${r.json.tiempo.duracionSegundos != null ? ` · ${r.json.tiempo.duracionSegundos} s` : ''}`);
    if (r.json.cita) console.log(`cita ${r.json.cita.paciente} ${r.json.cita.hora}${r.json.cita.tratamiento ? ` (tratamiento ${r.json.cita.tratamiento})` : ''}`);
    if (r.status !== 200) console.log(r.json.message ?? '');
    pantalla(r.json.lcd);
  }
})().catch((e) => { console.error('No se pudo conectar:', e instanceof Error ? e.message : e); process.exit(1); });
