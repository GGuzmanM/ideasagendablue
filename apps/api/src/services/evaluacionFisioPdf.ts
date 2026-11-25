/**
 * PDF «Evaluación fisioterapéutica» (25-nov-2026): la hoja de papel de la clínica, llena con lo registrado en la atención.
 *
 * MEDIA HOJA, como la receta: todo entra en la mitad de arriba de una A4 (la hoja de papel de la clínica es así) y debajo va la
 * línea de corte; la mitad de abajo queda en blanco. Nunca pasa a otra página: lo largo (antecedentes, diagnóstico, comentario,
 * puntos del cuerpo) se recorta con «…» a los renglones que le tocan.
 *
 * Lleva: datos del paciente, antecedentes, diagnóstico (CIE-10), la tabla TRATAMIENTO con sus casillas (marcadas las elegidas),
 * UN comentario general de lo que se hará y los puntos marcados en el cuerpo con su escala. Lo que el sistema no tiene (la
 * ocupación, o un dato que aún no se registró) sale como renglón para escribir a mano.
 */
import * as fs from 'fs';
import { Doc, W, H, AZUL, AZUL_C, GRIS, INK, LINEA, SUAVE, LOGO, CLINICA, edadDe, soloFecha, fechaLima } from './pdfComun';
import { TRATAMIENTOS_FISIO, type EvaluacionFisioPdf } from './tratamientoFisio';
import { nombreHallazgo, nombreZonaCuerpo, textoEscalaPunto } from './mapaCorporalTexto';

const MITAD = H / 2;          // hasta aquí llega el documento
const MX = 36;                // margen a los lados
const CW = W - 2 * MX;
const RENGLON = '#8792A8';

export function escribirEvaluacionFisioPdf(doc: Doc, e: EvaluacionFisioPdf): void {
  const numeroHc = `HC N° ${String(e.numeroHc).padStart(6, '0')}`;
  const nombre = `${e.paciente.nombres} ${e.paciente.apellidoPaterno} ${e.paciente.apellidoMaterno}`.replace(/\s+/g, ' ').trim();

  // ── Cabecera compacta: banda azul con el logo y el título ──
  doc.rect(0, 0, W, 36).fill(AZUL);
  doc.roundedRect(MX, 5, 92, 26, 5).fill('#FFFFFF');
  if (fs.existsSync(LOGO)) doc.image(LOGO, MX + 8, 8, { fit: [76, 20], align: 'center', valign: 'center' });
  else doc.font('Helvetica-Bold').fontSize(12).fillColor(AZUL).text('limablue', MX + 10, 12, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF').text(CLINICA.encabezado, MX + 102, 14, { width: 150, height: 10, ellipsis: true });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF').text('EVALUACIÓN FISIOTERAPÉUTICA', W - MX - 270, 7, { width: 270, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor('#DCE6F5').text(`${numeroHc}  ·  ${e.sede.nombre}  ·  ${e.servicio}`, W - MX - 270, 22, { width: 270, height: 9, align: 'right', ellipsis: true });
  let y = 45;

  /** «Rótulo: valor» sobre un renglón, como en la hoja de papel. Sin valor queda el renglón para escribir a mano. */
  const dato = (rotulo: string, valor: string | null, x: number, w: number) => {
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS);
    const lx = x + doc.widthOfString(`${rotulo}:`) + 4;
    doc.text(`${rotulo}:`, x, y + 2, { lineBreak: false });
    if (valor) {
      // Un valor largo (un nombre de cuatro palabras) baja de letra hasta entrar; si ni así entra, se recorta con «…».
      const ancho = x + w - lx;
      let tam = 9;
      doc.font('Helvetica-Bold').fontSize(tam);
      while (tam > 7 && doc.widthOfString(valor) > ancho) { tam -= 0.25; doc.fontSize(tam); }
      doc.fillColor(INK).text(valor, lx, y + 0.5 + (9 - tam) * 0.8, { width: ancho, height: tam + 2, ellipsis: true });
    }
    doc.moveTo(lx, y + 12).lineTo(x + w, y + 12).lineWidth(0.4).strokeColor(RENGLON).stroke();
  };
  /** Igual, a todo el ancho y hasta DOS renglones (antecedentes, diagnóstico). Devuelve lo que ocupó. */
  const datoLargo = (rotulo: string, valor: string | null): number => {
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS);
    const lx = MX + doc.widthOfString(`${rotulo}:`) + 4;
    const ancho = MX + CW - lx;
    doc.text(`${rotulo}:`, MX, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(8.5);
    const dos = !!valor && doc.widthOfString(valor) > ancho;
    if (valor) doc.fillColor(INK).text(valor, lx, y + 1, { width: ancho, height: dos ? 21 : 11, lineGap: 0.5, ellipsis: true });
    const alto = dos ? 26 : 16;
    doc.moveTo(lx, y + alto - 4).lineTo(MX + CW, y + alto - 4).lineWidth(0.4).strokeColor(RENGLON).stroke();
    return alto;
  };

  // ── Datos (los mismos de la hoja de papel) ──
  dato('Nombres y apellidos', nombre.toUpperCase(), MX, 290);
  dato(e.paciente.tipoDocumento, e.paciente.numeroDocumento, MX + 296, 84);
  dato('Edad', edadDe(e.paciente.fechaNacimiento), MX + 384, 58);
  dato('Fecha', soloFecha(e.fecha), MX + 445, CW - 445);
  y += 16;
  dato('Ocupación', null, MX, 330); // el sistema no guarda la ocupación: se escribe a mano
  dato('N.º de sesiones', e.sesiones != null ? String(e.sesiones) : null, MX + 340, CW - 340);
  y += 16;
  y += datoLargo('Antecedentes', e.antecedentes.length ? e.antecedentes.join('; ') : null);
  y += datoLargo('Diagnóstico (CIE-10)', e.diagnosticos.length ? e.diagnosticos.map((d) => `${d.codigo} ${d.descripcion}`).join('; ') : null);
  y += 4;

  // ── Tabla TRATAMIENTO: dos columnas, como en el papel; la casilla va marcada en los elegidos ──
  const FILAS = Math.ceil(TRATAMIENTOS_FISIO.length / 2);
  const ALTO = 14.5, CAJA = 9, COL = CW / 2;
  const marcado = new Set(e.marcados.map((t) => t.clave));
  doc.rect(MX, y, CW, 13).fill(AZUL_C);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF').text('TRATAMIENTO', MX, y + 3.2, { width: CW, align: 'center', lineBreak: false, characterSpacing: 0.6 });
  y += 13;
  TRATAMIENTOS_FISIO.forEach((t, i) => {
    const col = i < FILAS ? 0 : 1, fila = i < FILAS ? i : i - FILAS;
    const x = MX + col * COL, yy = y + fila * ALTO;
    const si = marcado.has(t.clave);
    doc.rect(x, yy, COL, ALTO).lineWidth(0.5).fillAndStroke(si ? SUAVE : '#FFFFFF', LINEA);
    // Un nombre largo («Terapia manual (hands pro, …)») baja de letra hasta entrar en su renglón.
    const anchoTexto = COL - CAJA - 20;
    let tam = 8;
    doc.font(si ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam);
    while (tam > 6 && doc.widthOfString(t.nombre) > anchoTexto) { tam -= 0.25; doc.fontSize(tam); }
    doc.fillColor(si ? AZUL : INK).text(t.nombre, x + 6, yy + (ALTO - tam) / 2 - 0.3, { width: anchoTexto, height: tam + 2, ellipsis: true });
    const cx = x + COL - CAJA - 6, cy = yy + (ALTO - CAJA) / 2;
    doc.rect(cx, cy, CAJA, CAJA).lineWidth(0.7).fillAndStroke('#FFFFFF', si ? AZUL : GRIS);
    if (si) doc.moveTo(cx + 2, cy + 4.8).lineTo(cx + 3.8, cy + 6.8).lineTo(cx + 7.2, cy + 2.2).lineWidth(1.4).strokeColor(AZUL).stroke();
  });
  y += FILAS * ALTO + 6;

  // ── Firma, anclada al final de la media hoja (arriba le queda sitio para firmar) ──
  const yFirma = MITAD - 42;
  const yTope = yFirma - 18; // hasta aquí pueden llegar el comentario y los puntos del cuerpo

  // ── Comentario general del tratamiento (uno solo). Vacío → renglones para escribirlo a mano ──
  const puntos = e.puntos.map((p) => `${nombreZonaCuerpo(p.zona)} · ${nombreHallazgo(p.tipo)}${textoEscalaPunto(p.tipo, p.intensidad) ? ` ${textoEscalaPunto(p.tipo, p.intensidad)}` : ''}`).join('; ');
  const altoPuntos = puntos ? 24 : 0; // rótulo en la misma línea + hasta dos renglones
  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('COMENTARIO DEL TRATAMIENTO', MX, y, { lineBreak: false });
  y += 10;
  if (e.comentario) {
    const maximo = Math.max(11, yTope - altoPuntos - y);
    doc.font('Helvetica').fontSize(9);
    const alto = Math.min(maximo, doc.heightOfString(e.comentario, { width: CW, lineGap: 1.5 }));
    doc.fillColor(INK).text(e.comentario, MX, y, { width: CW, height: maximo, lineGap: 1.5, ellipsis: true });
    y += alto + 5;
  } else {
    const renglones = Math.max(1, Math.min(3, Math.floor((yTope - altoPuntos - y) / 14)));
    for (let i = 0; i < renglones; i++) { doc.moveTo(MX, y + 10).lineTo(MX + CW, y + 10).lineWidth(0.4).strokeColor(RENGLON).stroke(); y += 14; }
    y += 3;
  }

  // ── Puntos marcados en el cuerpo, con su escala (si queda sitio) ──
  if (puntos && yTope - y >= 10) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRIS).text('Puntos marcados en el cuerpo: ', MX, y, { width: CW, height: Math.min(20, yTope - y), lineGap: 0.5, continued: true, ellipsis: true });
    doc.font('Helvetica').fillColor(INK).text(puntos, { lineGap: 0.5, ellipsis: true });
  }

  doc.moveTo(W - MX - 170, yFirma).lineTo(W - MX, yFirma).lineWidth(0.5).strokeColor(GRIS).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(e.profesional, W - MX - 170, yFirma + 3, { width: 170, height: 10, align: 'center', ellipsis: true });
  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('Fisioterapeuta', W - MX - 170, yFirma + 13, { width: 170, align: 'center', lineBreak: false });
  // Pie en un solo renglón, debajo de la firma y a todo el ancho.
  doc.font('Helvetica').fontSize(6.5).fillColor(GRIS)
    .text(`${nombre.toUpperCase()} · ${numeroHc} · Documento confidencial (Ley 29733) · Generado el ${fechaLima(new Date())}`, MX, MITAD - 13, { width: CW, height: 8, ellipsis: true });

  // ── Línea de corte: la mitad de abajo de la A4 queda en blanco ──
  doc.save().moveTo(0, MITAD + 4).lineTo(W, MITAD + 4).lineWidth(0.5).dash(3, { space: 3 }).strokeColor('#9AA5B8').stroke().undash();
  doc.font('Helvetica').fontSize(6).fillColor('#9AA5B8').text('- - -  cortar por la línea  - - -', MX, MITAD + 7, { lineBreak: false }).restore();
}
