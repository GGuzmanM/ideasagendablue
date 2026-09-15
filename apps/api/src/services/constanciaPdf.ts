/**
 * PDF de la constancia de atención / descanso médico (5.4): cabecera de la clínica, datos del
 * paciente, el texto tal como se emitió, firma del emisor con su registro, y la barra de
 * verificación con QR (misma página pública que la receta). Marca de agua «ANULADA».
 */
import type { ConstanciaParaPdf } from './constanciaService';
import { TIPO_CONSTANCIA_LABEL, type TipoConstancia } from './constanciaService';
import { Doc, W, H, M, CONTENT_W, GRIS, INK, LINEA, SUAVE, SEXO, fechaLima, edadDe, dibujarCabecera, campo, urlVerificacionReceta } from './pdfComun';

export function escribirConstanciaPdf(doc: Doc, c: ConstanciaParaPdf, qr: Buffer | null): void {
  const at = c.atencion;
  const pac = at.paciente;
  const tipo = c.tipo as TipoConstancia;
  const titulo = tipo === 'descanso_medico' ? 'CERTIFICADO DE DESCANSO MÉDICO' : 'CONSTANCIA DE ATENCIÓN';
  const numero = `N° ${String(c.numero).padStart(5, '0')}`;
  const BARRA = 64;
  let y = dibujarCabecera(doc, { titulo, numero, subtitulo: `Emitido el ${fechaLima(c.fechaEmision)}`, sede: at.sede });

  // Paciente
  doc.roundedRect(M, y, CONTENT_W, 58, 6).fillAndStroke(SUAVE, LINEA);
  campo(doc, 'Paciente', `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase(), M + 12, y + 9, 206);
  campo(doc, pac.tipoDocumento, pac.numeroDocumento, M + 228, y + 9, 62);
  campo(doc, 'Edad', edadDe(pac.fechaNacimiento), M + 298, y + 9, 50);
  campo(doc, 'Sexo', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '—', M + 356, y + 9, 60);
  campo(doc, 'Historia', `HC N° ${String(at.historiaClinica.numero).padStart(6, '0')}`, M + 422, y + 9, 82);
  campo(doc, 'Servicio', at.servicio.nombre, M + 12, y + 33, 206);
  if (tipo === 'descanso_medico') {
    campo(doc, 'Descanso', c.desde && c.hasta ? `${c.dias} día(s) · ${fmtDia(c.desde)} al ${fmtDia(c.hasta)}` : '—', M + 228, y + 33, 180);
    campo(doc, 'Diagnóstico', c.diagnosticoCie10Codigo ?? '—', M + 422, y + 33, 82);
  } else campo(doc, 'Fecha de atención', fmtDia(at.fecha), M + 228, y + 33, 180);
  y += 74;

  // Título del documento y cuerpo
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(TIPO_CONSTANCIA_LABEL[tipo].toUpperCase(), M, y, { width: CONTENT_W, align: 'center' });
  y += 34;
  doc.font('Helvetica').fontSize(11).fillColor(INK).text(c.texto, M + 10, y, { width: CONTENT_W - 20, align: 'justify', lineGap: 4, paragraphGap: 10 });
  y = doc.y + 24;
  doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(`${at.sede.nombre}, ${fechaLima(c.fechaEmision)}`, M + 10, y, { width: CONTENT_W - 20 });

  // Firma del emisor
  const yF = Math.max(doc.y + 70, H - BARRA - 120);
  const xS = W - M - 220;
  doc.moveTo(xS, yF).lineTo(W - M, yF).lineWidth(0.7).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(c.emisorNombre, xS, yF + 5, { width: 220, align: 'center', lineBreak: false, ellipsis: true });
  const regRaw = (c.emisorRegistro ?? '').trim();
  const tienePrefijo = /^(CMP|COP|CTMP|CEP|RNE|REG\.?)\b/i.test(regRaw);
  const reg = regRaw ? (tienePrefijo ? regRaw : (tipo === 'descanso_medico' ? `CMP ${regRaw}` : `Reg. ${regRaw}`)) : '';
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(tipo === 'descanso_medico' ? 'Médico cirujano' : 'Profesional que atendió', xS, yF + 18, { width: 220, align: 'center' }).text(reg, xS, yF + 29, { width: 220, align: 'center' });

  // Barra de verificación con QR
  doc.rect(0, H - BARRA, W, BARRA).fill('#F2F4F6');
  const QR = 52, txtW = W - 2 * M - QR - 16;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text('Verifique la autenticidad de este documento', M, H - BARRA + 12, { width: txtW });
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS)
    .text(`Escanee el código QR o ingrese a ${urlVerificacionReceta(c.codigoVerificacion)}`, M, H - BARRA + 25, { width: txtW })
    .text(`Código de verificación: ${c.codigoVerificacion}  ·  Generado por Limablue Agenda`, M, H - BARRA + 38, { width: txtW });
  if (qr) doc.image(qr, W - M - QR, H - BARRA + 6, { width: QR, height: QR });
  if (c.estado === 'anulada') {
    doc.save().rotate(-30, { origin: [W / 2, H / 2] }).font('Helvetica-Bold').fontSize(64).fillColor('#B42318').fillOpacity(0.18)
      .text('ANULADA', 0, H / 2 - 40, { width: W, align: 'center' }).restore();
    doc.fillOpacity(1);
    if (c.motivoAnulacion) doc.font('Helvetica').fontSize(8).fillColor('#B42318').text(`Anulada${c.anuladaEn ? ` el ${fechaLima(c.anuladaEn)}` : ''}: ${c.motivoAnulacion}`, M, H - BARRA - 14, { width: CONTENT_W, lineBreak: false, ellipsis: true });
  }
}

const fmtDia = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
