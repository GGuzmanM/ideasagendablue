/**
 * Piezas comunes de los PDF clínicos (receta, historia clínica, consentimiento): A4, paleta, logo,
 * datos de la clínica, fechas en hora de Lima, la cabecera azul con la franja de la sede y el QR
 * de verificación.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

export type Doc = InstanceType<typeof PDFDocument>;

export const W = 595.28, H = 841.89, M = 40;
export const CONTENT_W = W - 2 * M;
export const AZUL = '#003366', AZUL_C = '#0A4B8C', GRIS = '#55617A', INK = '#1F2A3D', ROJO = '#B42318', ROJO_F = '#FDECEC',
  LINEA = '#CBD6E8', SUAVE = '#EAF1FC', FRANJA = '#EDF1F7';
export const LOGO = path.join(process.cwd(), 'assets', 'logo-limablue.png');

// Nombre legal para los textos («…fue atendido en Limablue Centro de Podología Médica…») y el rótulo
// que va junto al logo en la cabecera (el logo ya dice «limablue»). Nunca «Clínica del pie».
export const CLINICA = {
  nombre: process.env.CLINICA_NOMBRE || 'Limablue Centro de Podología Médica',
  encabezado: process.env.CLINICA_ENCABEZADO || 'Centro de Podología Médica',
  ruc: process.env.CLINICA_RUC || '',
  tel: process.env.CLINICA_TELEFONO || '',
};

export const SEXO: Record<string, string> = { masculino: 'Masculino', femenino: 'Femenino', otro: 'Otro' };

/** Documento A4 sin márgenes automáticos (cada PDF pagina a mano, midiendo). */
export function nuevoPdf(titulo: string): Doc {
  return new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: titulo, Author: CLINICA.nombre } });
}

/**
 * Recoge el PDF en memoria en vez de mandarlo a la respuesta HTTP. Hace falta para ADJUNTARLO a un
 * correo (el resto de PDFs se transmiten con `doc.pipe(res)` y no se guardan en ningún lado).
 * `escribir` recibe el documento ya creado; esta función lo cierra y devuelve los bytes.
 */
export function pdfABuffer(titulo: string, escribir: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = nuevoPdf(titulo);
      const trozos: Buffer[] = [];
      doc.on('data', (t: Buffer) => trozos.push(t));
      doc.on('end', () => resolve(Buffer.concat(trozos)));
      doc.on('error', reject);
      escribir(doc);
      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** «dd/mm/aaaa · hh:mm» en hora de Lima. */
export function fechaLima(d: Date): string {
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(d).replace(',', ' ·');
}

/** Fecha de una columna @db.Date (anclada a mediodía UTC) como «dd/mm/aaaa». */
export function soloFecha(d: Date): string {
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function edadDe(fn: Date | null): string {
  if (!fn) return '—';
  const hoy = new Date(); let e = hoy.getUTCFullYear() - fn.getUTCFullYear();
  const m = hoy.getUTCMonth() - fn.getUTCMonth();
  if (m < 0 || (m === 0 && hoy.getUTCDate() < fn.getUTCDate())) e--;
  return `${e} años`;
}

/**
 * Cabecera: banda azul (logo + clínica a la izquierda; documento, N° y subtítulo a la derecha) y la
 * franja con los datos de la sede a todo el ancho. Devuelve la Y donde empieza el contenido.
 */
export function dibujarCabecera(doc: Doc, p: { titulo: string; numero: string; subtitulo: string; sede: { nombre: string; direccion: string | null } }): number {
  const BAND = 60;
  doc.rect(0, 0, W, BAND).fill(AZUL);
  // Caja del logo como la marca: el trazo «limablue» y debajo, en pequeño, CENTRO DE PODOLOGÍA MÉDICA.
  doc.roundedRect(M, 7, 132, 46, 7).fill('#FFFFFF');
  if (fs.existsSync(LOGO)) doc.image(LOGO, M + 14, 10, { fit: [104, 26], align: 'center', valign: 'center' });
  else doc.font('Helvetica-Bold').fontSize(14).fillColor(AZUL).text('limablue', M + 12, 16);
  doc.font('Helvetica-Bold').fontSize(5.4).fillColor(AZUL).text(CLINICA.encabezado.toUpperCase(), M, 41, { width: 132, align: 'center', lineBreak: false, characterSpacing: 0.4 });
  // Rótulo junto al logo (en dos líneas para no pisar el título del documento, a la derecha).
  const RW = 250, RX = W - M - RW;
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text(CLINICA.encabezado, M + 144, 16, { width: RX - (M + 144) - 8, lineGap: 1 });
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#FFFFFF').text(p.titulo, RX, 13, { width: RW, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#DCE6F5').text(p.numero, RX, 31, { width: RW, align: 'right', lineBreak: false });
  doc.fontSize(8.5).fillColor('#C7D6EC').text(p.subtitulo, RX, 43, { width: RW, align: 'right', lineBreak: false, ellipsis: true });
  const datos = [p.sede.nombre, p.sede.direccion, CLINICA.ruc ? `RUC ${CLINICA.ruc}` : null, CLINICA.tel ? `Tel. ${CLINICA.tel}` : null].filter(Boolean).join('  ·  ');
  doc.font('Helvetica').fontSize(8.5);
  const stripH = Math.max(18, doc.heightOfString(datos, { width: CONTENT_W }) + 8);
  doc.rect(0, BAND, W, stripH).fill(FRANJA);
  doc.fillColor(GRIS).text(datos, M, BAND + 5, { width: CONTENT_W });
  return BAND + stripH + 10;
}

/** Etiqueta pequeña (rótulo + valor) usada en los bloques de datos. */
export function campo(doc: Doc, label: string, valor: string, x: number, y: number, w: number): void {
  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(label.toUpperCase(), x, y, { width: w, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(valor, x, y + 10, { width: w, lineBreak: false, ellipsis: true });
}

// ─── Verificación pública (QR) ────────────────────────────────────────────────
/** Dirección pública de la web (la que abre el QR). En el servidor: VERIFICACION_BASE_URL. */
export const BASE_VERIFICACION = (process.env.VERIFICACION_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:5180').replace(/\/+$/, '');
export const urlVerificacionReceta = (codigo: string) => `${BASE_VERIFICACION}/verificar/${codigo}`;

/** PNG del QR (se genera antes de escribir el PDF: pdfkit dibuja de forma síncrona). */
export function qrPng(texto: string): Promise<Buffer> {
  return QRCode.toBuffer(texto, { type: 'png', margin: 1, width: 240, errorCorrectionLevel: 'M' });
}
