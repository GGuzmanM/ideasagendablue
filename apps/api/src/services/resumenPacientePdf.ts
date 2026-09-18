/**
 * PDF del resumen de la atención PARA EL PACIENTE (4.4). Es el papel que se lleva a casa, así que
 * está pensado para leerse sin esfuerzo: letra grande, una idea por línea, secciones con título y
 * la caja de «Vuelve antes si…» destacada en rojo al final. Sin siglas ni códigos.
 */
import type { Resumen } from './resumenPaciente';
import { Doc, W, H, M, CONTENT_W, AZUL, GRIS, INK, ROJO, LINEA, SUAVE, CLINICA, dibujarCabecera } from './pdfComun';

const PIE_ALTO = 46;

/** Espacio que hace falta para seguir escribiendo; si no cabe, página nueva. */
function asegurarEspacio(doc: Doc, y: number, alto: number): number {
  if (y + alto <= H - PIE_ALTO - 10) return y;
  doc.addPage();
  return M;
}

export function escribirResumenPacientePdf(doc: Doc, r: Resumen): void {
  let y = dibujarCabecera(doc, {
    titulo: r.titulo.toUpperCase(),
    numero: '',
    subtitulo: r.fecha ? `Atención del ${r.fecha}` : '',
    sede: { nombre: r.sede, direccion: null },
  });

  // Para quién es y quién lo atendió.
  doc.roundedRect(M, y, CONTENT_W, 44, 6).fillAndStroke(SUAVE, LINEA);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(r.paciente.toUpperCase(), M + 14, y + 10, { width: CONTENT_W - 28, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(`Te atendió ${r.profesional}${r.sede ? ` · Sede ${r.sede}` : ''}`, M + 14, y + 27, { width: CONTENT_W - 28, lineBreak: false, ellipsis: true });
  y += 60;

  for (const sec of r.secciones) {
    const alarma = sec.titulo.startsWith('Vuelve antes');
    y = asegurarEspacio(doc, y, 70);

    // Título de la sección, con una barra de color a la izquierda.
    doc.rect(M, y + 1, 3.5, 14).fill(alarma ? ROJO : AZUL);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(alarma ? ROJO : AZUL).text(sec.titulo, M + 12, y, { width: CONTENT_W - 12 });
    y = doc.y + 8;

    if (alarma) {
      // La caja de alarma se dibuja entera: primero se mide, para no partirla entre dos páginas.
      const alto = sec.items.reduce((h, it) => h + doc.font('Helvetica').fontSize(11).heightOfString(it, { width: CONTENT_W - 44, lineGap: 2 }) + 9, 18);
      y = asegurarEspacio(doc, y, alto + 12);
      doc.roundedRect(M, y, CONTENT_W, alto, 8).fillAndStroke('#FEF3F2', '#FDA29B');
      let yy = y + 10;
      for (const it of sec.items) {
        doc.circle(M + 16, yy + 6, 2.6).fill(ROJO);
        doc.font('Helvetica').fontSize(11).fillColor(INK).text(it, M + 26, yy, { width: CONTENT_W - 44, lineGap: 2 });
        yy = doc.y + 9;
      }
      y = y + alto + 6;
      continue;
    }

    for (const it of sec.items) {
      const alto = doc.font('Helvetica').fontSize(11.5).heightOfString(it, { width: CONTENT_W - 30, lineGap: 2.5 });
      y = asegurarEspacio(doc, y, alto + 10);
      doc.circle(M + 8, y + 6.5, 2.8).fill(AZUL);
      doc.font('Helvetica').fontSize(11.5).fillColor(INK).text(it, M + 18, y, { width: CONTENT_W - 30, lineGap: 2.5 });
      y = doc.y + 8;
    }
    if (sec.nota) {
      y = asegurarEspacio(doc, y, 22);
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(GRIS).text(sec.nota, M + 18, y, { width: CONTENT_W - 30 });
      y = doc.y + 6;
    }
    y += 8;
  }

  // Pie en todas las páginas.
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    doc.rect(0, H - PIE_ALTO, W, PIE_ALTO).fill('#F2F4F6');
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(r.pie, M, H - PIE_ALTO + 10, { width: CONTENT_W - 90, lineGap: 1.5 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(CLINICA.nombre, M, H - PIE_ALTO + 32, { width: CONTENT_W - 90, lineBreak: false, ellipsis: true });
    if (CLINICA.tel) doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(CLINICA.tel, W - M - 200, H - PIE_ALTO + 32, { width: 200, align: 'right' });
    if (rango.count > 1) doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(`Página ${i - rango.start + 1} de ${rango.count}`, W - M - 200, H - PIE_ALTO + 10, { width: 200, align: 'right' });
  }
}
