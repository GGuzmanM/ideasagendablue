/**
 * Pasa a la base (tabla `archivos`) lo que todavía está en la carpeta uploads (14-oct-2026).
 *
 *   npx ts-node --transpile-only scripts/archivos-a-bd.ts            → SIMULA (no escribe)
 *   npx ts-node --transpile-only scripts/archivos-a-bd.ts --aplicar  → guarda
 *
 * · La clave es la misma ruta relativa (fotos-clinicas/<id>/foto_x.jpg), así nada más cambia.
 * · Fotos clínicas, podogramas y comprobantes en imagen se comprimen como al subir; PDF tal cual.
 * · Se actualizan tamaño y tipo en fotos_clinicas, imagenes_podograma y consentimientos.
 * · Lo que ya está en la base se salta: se puede correr varias veces.
 * · NO borra la carpeta: eso se hace a mano cuando todo se vea bien.
 */
import '../src/cargarEnv';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';
import { DIR_UPLOADS } from '../src/utils/rutasArchivos';
import { comprimirImagen, guardarArchivo } from '../src/services/almacenArchivos';
import { detectarImagen } from '../src/middleware/uploadPodograma';

const APLICAR = process.argv.includes('--aplicar');
const LADO_MAX: Record<string, number> = { 'fotos-clinicas': 1600, podogramas: 2000, comprobantes: 1600 };

function archivosDe(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? archivosDe(abs) : e.isFile() ? [abs] : [];
  });
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'} · carpeta ${DIR_UPLOADS}`);
  const todos = archivosDe(DIR_UPLOADS);
  const ya = new Set((await prisma.archivo.findMany({ select: { ruta: true } })).map((a) => a.ruta));
  const porCarpeta = new Map<string, { n: number; antes: number; despues: number }>();
  let saltados = 0, raros = 0;

  for (const abs of todos) {
    const ruta = path.relative(DIR_UPLOADS, abs).split(path.sep).join('/');
    if (ya.has(ruta)) { saltados++; continue; }
    const carpeta = ruta.split('/')[0];
    const crudo = fs.readFileSync(abs);
    const esPdf = crudo.subarray(0, 5).toString('latin1') === '%PDF-';
    const mimeReal = esPdf ? 'application/pdf' : detectarImagen(crudo);
    if (!mimeReal) { raros++; console.log(`  sin tipo reconocible, se deja: ${ruta}`); continue; }
    const { datos, mime } = LADO_MAX[carpeta] ? await comprimirImagen(crudo, mimeReal, LADO_MAX[carpeta]) : { datos: crudo, mime: mimeReal };

    const t = porCarpeta.get(carpeta) ?? { n: 0, antes: 0, despues: 0 };
    t.n++; t.antes += crudo.length; t.despues += datos.length;
    porCarpeta.set(carpeta, t);
    if (!APLICAR) continue;

    await guardarArchivo(ruta, datos, mime, crudo.length);
    await prisma.fotoClinica.updateMany({ where: { ruta }, data: { tamano: datos.length, mime } });
    await prisma.imagenPodograma.updateMany({ where: { ruta }, data: { tamano: datos.length, mime } });
    await prisma.consentimientoInformado.updateMany({ where: { archivoRuta: ruta }, data: { archivoTamano: datos.length, archivoMime: mime } });
  }

  let antes = 0, despues = 0, n = 0;
  for (const [carpeta, t] of porCarpeta) {
    console.log(`  ${carpeta.padEnd(16)} ${String(t.n).padStart(4)} archivos  ${mb(t.antes).padStart(9)} → ${mb(t.despues)}`);
    antes += t.antes; despues += t.despues; n += t.n;
  }
  console.log(`  TOTAL            ${String(n).padStart(4)} archivos  ${mb(antes).padStart(9)} → ${mb(despues)}`);
  console.log(`  ya estaban en la base: ${saltados} · sin tipo reconocible: ${raros}`);
  if (!APLICAR) console.log('Nada se escribió. Para guardar: --aplicar');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
