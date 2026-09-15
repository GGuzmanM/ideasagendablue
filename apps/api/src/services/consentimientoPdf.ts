/**
 * PDF del consentimiento informado (5.1): cabecera de la clínica, datos del paciente, el
 * procedimiento, el texto que se leyó y firmó (paginado y medido) y el bloque de firmas: la firma
 * del paciente o apoderado redibujada como VECTOR (nítida al imprimir) y el profesional que informó.
 * Si fue revocado, marca de agua «REVOCADO» y el motivo.
 */
import type { ConsentimientoParaPdf } from './consentimientoService';
import type { TrazoFirma } from './consentimientoService';
import {
  Doc, W, H, M, CONTENT_W, GRIS, INK, LINEA, SUAVE, ROJO, SEXO, fechaLima, edadDe, dibujarCabecera, campo,
} from './pdfComun';

export function escribirConsentimientoPdf(doc: Doc, c: ConsentimientoParaPdf): void {
  const at = c.atencion;
  const pac = at.paciente;
  const numero = `N° ${String(c.numero).padStart(5, '0')}`;
  const PIE = 28;
  const FIRMAS = 150;                       // alto reservado para el bloque de firmas
  let y = 0;
  const cabecera = () => {
    y = dibujarCabecera(doc, { titulo: 'CONSENTIMIENTO INFORMADO', numero, subtitulo: `Firmado el ${fechaLima(c.firmadoEn)}`, sede: at.sede });
  };
  const pie = () => {
    doc.rect(0, H - PIE, W, PIE).fill('#F2F4F6');
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(
      `Consentimiento ${numero} · HC N° ${String(at.historiaClinica.numero).padStart(6, '0')} · Firmado el ${fechaLima(c.firmadoEn)} · Documento confidencial`,
      M, H - PIE + 10, { width: CONTENT_W, lineBreak: false, ellipsis: true },
    );
  };

  cabecera();
  // Paciente
  doc.roundedRect(M, y, CONTENT_W, 58, 6).fillAndStroke(SUAVE, LINEA);
  campo(doc, 'Paciente', `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase(), M + 12, y + 9, 206);
  campo(doc, pac.tipoDocumento, pac.numeroDocumento, M + 228, y + 9, 62);
  campo(doc, 'Edad', edadDe(pac.fechaNacimiento), M + 298, y + 9, 50);
  campo(doc, 'Sexo', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '—', M + 356, y + 9, 60);
  campo(doc, 'Historia', `HC N° ${String(at.historiaClinica.numero).padStart(6, '0')}`, M + 422, y + 9, 82);
  campo(doc, 'Servicio', at.servicio.nombre, M + 12, y + 33, 206);
  campo(doc, 'Profesional que informa', c.profesionalEtiqueta ?? '—', M + 228, y + 33, 260);
  y += 66;

  // Procedimiento
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS).text('PROCEDIMIENTO QUE SE AUTORIZA', M, y);
  y += 12;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
  const hProc = doc.heightOfString(c.procedimiento, { width: CONTENT_W });
  doc.text(c.procedimiento, M, y, { width: CONTENT_W });
  y += hProc + 10;

  // Texto (por párrafos, medido; la última hoja reserva lugar para las firmas)
  const parrafos = c.texto.replace(/\r/g, '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK);
  for (const par of parrafos) {
    const alto = doc.heightOfString(par, { width: CONTENT_W, lineGap: 1.6, align: 'justify' }) + 6;
    if (y + alto > H - PIE - 16) { pie(); doc.addPage(); cabecera(); doc.font('Helvetica').fontSize(9.5).fillColor(INK); }
    doc.text(par, M, y, { width: CONTENT_W, lineGap: 1.6, align: 'justify' });
    y += alto;
  }
  if (y + FIRMAS > H - PIE - 10) { pie(); doc.addPage(); cabecera(); }

  // Firmas
  const yF = Math.max(y + 12, H - PIE - FIRMAS);
  const anchoCaja = 230;
  const aspecto = c.firmaAspecto > 0 ? c.firmaAspecto : 3;
  const altoCaja = Math.min(86, anchoCaja / aspecto);
  doc.roundedRect(M, yF, anchoCaja, altoCaja, 4).lineWidth(0.5).strokeColor(LINEA).stroke();
  const trazos = (c.firma as unknown as TrazoFirma[]) ?? [];
  doc.save();
  doc.lineCap('round').lineJoin('round').strokeColor('#0B1F44');
  for (const t of trazos) {
    if (!t.puntos?.length) continue;
    const [x0, y0] = t.puntos[0]!;
    doc.lineWidth(Math.max(0.8, (t.grosor ?? 3) * 0.45));
    doc.moveTo(M + x0 * anchoCaja, yF + y0 * altoCaja);
    if (t.puntos.length === 1) doc.lineTo(M + x0 * anchoCaja + 0.5, yF + y0 * altoCaja + 0.5);
    for (const [x, yy] of t.puntos.slice(1)) doc.lineTo(M + x * anchoCaja, yF + yy * altoCaja);
    doc.stroke();
  }
  doc.restore();
  const yT = yF + altoCaja + 6;
  doc.moveTo(M, yT).lineTo(M + anchoCaja, yT).lineWidth(0.7).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(c.firmanteNombre, M, yT + 4, { width: anchoCaja, align: 'center', lineBreak: false, ellipsis: true });
  const rel = c.firmanteRelacion === 'apoderado' ? 'Apoderado / representante' : 'Paciente';
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text(`${rel}${c.firmanteDocumento ? ` · Doc. ${c.firmanteDocumento}` : ''}`, M, yT + 16, { width: anchoCaja, align: 'center' })
    .text(`Firmado el ${fechaLima(c.firmadoEn)}`, M, yT + 27, { width: anchoCaja, align: 'center' });

  const xP = W - M - 220;
  doc.moveTo(xP, yT).lineTo(W - M, yT).lineWidth(0.7).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(c.profesionalEtiqueta ?? '—', xP, yT + 4, { width: 220, align: 'center', lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text('Profesional que informó', xP, yT + 16, { width: 220, align: 'center' })
    .text(c.registradoEtiqueta ? `Registrado por ${c.registradoEtiqueta}` : '', xP, yT + 27, { width: 220, align: 'center' });

  if (c.estado === 'revocado') {
    doc.save().rotate(-30, { origin: [W / 2, H / 2] }).font('Helvetica-Bold').fontSize(64).fillColor(ROJO).fillOpacity(0.16)
      .text('REVOCADO', 0, H / 2 - 40, { width: W, align: 'center' }).restore();
    doc.fillOpacity(1);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ROJO)
      .text(`Revocado el ${c.revocadoEn ? fechaLima(c.revocadoEn) : '—'}${c.motivoRevocacion ? ` · Motivo: ${c.motivoRevocacion}` : ''}`, M, H - PIE - 14, { width: CONTENT_W, lineBreak: false, ellipsis: true });
  }
  pie();
}
