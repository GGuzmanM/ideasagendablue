import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { prisma } from '../db';
import { DIR_UPLOADS } from '../utils/rutasArchivos';

// ─── Archivos en la base (tabla `archivos`) ──────────────────────────────────
// Fotos clínicas, podogramas, consentimientos en foto, comprobantes y contratos viven en la BD, no en
// una carpeta del servidor. La clave es la misma ruta relativa de antes (fotos-clinicas/<id>/foto_x.jpg),
// así las columnas ruta/url de los demás modelos no cambian y un solo pg_dump respalda todo.

const MIME_POR_EXT: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };
export const EXT_POR_MIME: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

/** Clave relativa con «/», sin subir de carpeta. null si no es válida. */
export function claveArchivo(ruta: string): string | null {
  const limpia = ruta.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^uploads\//, '');
  if (!limpia || limpia.split('/').some((p) => p === '..' || p === '.' || p === '')) return null;
  return limpia;
}

/**
 * Achica una imagen para guardarla: corrige la orientación del celular, máx. `ladoMax` px por lado,
 * JPEG calidad 80, sin metadatos (GPS, modelo del equipo). Si no sale más liviana, queda la original.
 * Los PDF y lo que no sea imagen pasan tal cual.
 */
export async function comprimirImagen(datos: Buffer, mime: string, ladoMax = 1600): Promise<{ datos: Buffer; mime: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return { datos, mime };
  try {
    const salida = await sharp(datos, { failOn: 'none' })
      .rotate()
      .resize({ width: ladoMax, height: ladoMax, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    if (salida.length < datos.length) return { datos: salida, mime: 'image/jpeg' };
  } catch { /* imagen que sharp no entiende: se guarda como llegó */ }
  return { datos, mime };
}

export async function guardarArchivo(ruta: string, datos: Buffer, mime: string, tamanoOriginal?: number): Promise<string> {
  const clave = claveArchivo(ruta);
  if (!clave) throw new Error(`Ruta de archivo inválida: ${ruta}`);
  const fila = { datos, mime, tamano: datos.length, tamanoOriginal: tamanoOriginal ?? null };
  await prisma.archivo.upsert({ where: { ruta: clave }, create: { ruta: clave, ...fila }, update: fila });
  return clave;
}

/**
 * Lee un archivo de la base. Si no está (algo que aún no se pasó con scripts/archivos-a-bd.ts),
 * lo busca en la carpeta uploads antigua, si todavía existe.
 */
export async function leerArchivo(ruta: string): Promise<{ datos: Buffer; mime: string } | null> {
  const clave = claveArchivo(ruta);
  if (!clave) return null;
  const fila = await prisma.archivo.findUnique({ where: { ruta: clave }, select: { datos: true, mime: true } });
  if (fila) return { datos: Buffer.from(fila.datos), mime: fila.mime };
  const abs = path.resolve(DIR_UPLOADS, clave);
  if (!abs.startsWith(path.resolve(DIR_UPLOADS) + path.sep) || !fs.existsSync(abs)) return null;
  return { datos: fs.readFileSync(abs), mime: MIME_POR_EXT[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' };
}

/** Quita un archivo recién subido cuyo registro falló (no deja huérfanos). */
export async function borrarArchivo(ruta: string): Promise<void> {
  const clave = claveArchivo(ruta);
  if (clave) await prisma.archivo.deleteMany({ where: { ruta: clave } }).catch(() => undefined);
}
