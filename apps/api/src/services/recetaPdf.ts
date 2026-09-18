/**
 * PDF de Receta Médica / Indicaciones podológicas (pdfkit, streaming, sin persistir en disco:
 * las filas son inmutables → regenerar es determinista). Diseño:
 *  · Cabecera azul: logo + nombre de la clínica (izq) y documento + N° + subtítulo (der).
 *  · Franja de datos de la sede (dirección · RUC · tel) a todo el ancho, SIN chocar con la cabecera.
 *  · Bloque del paciente, alergias en rojo, ítems agrupados por diagnóstico CIE-10 con etiqueta de
 *    tipo, pie con emisor + registro, firma, código de verificación y QR. Marca de agua "ANULADA".
 *  · Copias: la receta médica sale con ORIGINAL (paciente) + COPIA (farmacia); cada copia es el
 *    documento completo en su propia página.
 * Todas las alturas de los ítems se MIDEN (heightOfString) para paginar bien y no encimar textos
 * cuando un nombre o una posología ocupan varias líneas.
 */
import type { RecetaCompleta } from './recetaService';
import {
  Doc, W, H, M, CONTENT_W, AZUL, AZUL_C, GRIS, INK, ROJO, ROJO_F, LINEA, SUAVE, SEXO,
  fechaLima, edadDe, dibujarCabecera, campo, urlVerificacionReceta,
} from './pdfComun';

type Item = RecetaCompleta['items'][number];

const ETIQUETA: Record<string, { texto: string; color: string }> = {
  MEDICAMENTO_RX: { texto: 'RECETA', color: '#B42318' },
  MEDICAMENTO_OTC: { texto: 'VENTA LIBRE', color: '#1F7A55' },
  PRODUCTO: { texto: 'PRODUCTO', color: '#7A5A1F' },
  SERVICIO: { texto: 'SERVICIO', color: '#1F56B0' },
};

export type CopiaReceta = 'original' | 'farmacia' | null;
const ROTULO_COPIA: Record<'original' | 'farmacia', { texto: string; fondo: string; tinta: string }> = {
  original: { texto: 'ORIGINAL · PARA EL PACIENTE', fondo: SUAVE, tinta: AZUL },
  farmacia: { texto: 'COPIA · PARA LA FARMACIA', fondo: '#FFF4E5', tinta: '#8A4B00' },
};

/**
 * Escribe la receta. `copias`: una página por copia (`null` = sin rótulo). `qr`: PNG del código
 * de verificación (se genera antes, con `qrPng`).
 */
export function escribirRecetaPdf(doc: Doc, r: RecetaCompleta, opts: { copias?: CopiaReceta[]; qr?: Buffer; firma?: Buffer | null } = {}): void {
  const copias = opts.copias?.length ? opts.copias : [null];
  copias.forEach((copia, i) => {
    if (i > 0) doc.addPage();
    escribirCopia(doc, r, copia, opts.qr, opts.firma ?? null);
  });
}

function escribirCopia(doc: Doc, r: RecetaCompleta, copia: CopiaReceta, qr?: Buffer, firma: Buffer | null = null): void {
  const esReceta = r.tipoDocumento === 'RECETA_MEDICA';
  const titulo = esReceta ? 'RECETA MÉDICA' : 'INDICACIONES DE TRATAMIENTO';
  const numero = esReceta ? `N° ${String(r.numero).padStart(6, '0')}` : `Podológico · N° ${String(r.numero).padStart(6, '0')}`;
  const subtitulo = esReceta
    ? (r.vigenciaDias ? `Válida por ${r.vigenciaDias} días desde su emisión` : 'Receta médica')
    : 'Tratamiento tópico, productos y servicios indicados';
  const pac = r.paciente;
  const alergias = r.historiaClinica.alergias;

  const xT = M + 26;            // sangría del contenido del ítem (tras el número)
  const wT = CONTENT_W - 26;    // ancho útil del contenido del ítem

  const cabecera = (): number => {
    let y = dibujarCabecera(doc, { titulo, numero, subtitulo, sede: r.atencion.sede });
    if (copia) {
      const rot = ROTULO_COPIA[copia];
      doc.font('Helvetica-Bold').fontSize(8);
      const w = doc.widthOfString(rot.texto) + 20;
      doc.roundedRect(W - M - w, y - 4, w, 15, 4).fill(rot.fondo);
      doc.fillColor(rot.tinta).text(rot.texto, W - M - w, y, { width: w, align: 'center', lineBreak: false });
      y += 16;
    }
    return y;
  };

  const bloquePaciente = (y: number) => {
    doc.roundedRect(M, y, CONTENT_W, 58, 6).fillAndStroke(SUAVE, LINEA);
    // Columnas dentro de [M+12 .. W-M-12] (≈491 px), con separación, para que ningún campo se corte.
    campo(doc, 'Paciente', `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase(), M + 12, y + 9, 206);
    campo(doc, pac.tipoDocumento, pac.numeroDocumento, M + 228, y + 9, 62);
    campo(doc, 'Edad', edadDe(pac.fechaNacimiento), M + 298, y + 9, 50);
    campo(doc, 'Sexo', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '—', M + 356, y + 9, 60);
    campo(doc, 'Historia', `HC N° ${String(r.historiaClinica.numero).padStart(6, '0')}`, M + 422, y + 9, 82);
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('FECHA DE EMISIÓN', M + 12, y + 38);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(fechaLima(r.fechaEmision), M + 92, y + 37);
    return y + 66;
  };

  const bloqueAlergias = (y: number) => {
    const txt = alergias.length ? alergias.map((a) => `${a.sustancia}${a.severidad === 'severa' ? ' (SEVERA)' : ''}`).join(', ') : 'NIEGA';
    doc.font('Helvetica-Bold').fontSize(9);
    const h = Math.max(22, doc.heightOfString('ALERGIAS / RAM:  ' + txt, { width: CONTENT_W - 20 }) + 12);
    doc.roundedRect(M, y, CONTENT_W, h, 4).fillAndStroke(ROJO_F, '#F3B9B4');
    doc.fillColor(ROJO).text('ALERGIAS / RAM:  ' + txt, M + 10, y + 6, { width: CONTENT_W - 20 });
    return y + h + 8;
  };

  const tituloDx = (y: number, codigo: string, desc: string) => {
    doc.rect(M, y, CONTENT_W, 18).fill(AZUL_C);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#FFFFFF').text(`${codigo}  ·  ${desc.toUpperCase()}`, M + 8, y + 5, { width: CONTENT_W - 16, lineBreak: false, ellipsis: true });
    return y + 22;
  };

  // ── Composición de un ítem: partes de texto y ancho del nombre libre del tag ──
  const posologia = (it: Item) => {
    const partes = [it.dosis, it.via, it.frecuencia, it.duracion].filter(Boolean).join(' · ');
    return [partes, it.indicaciones].filter(Boolean).join(partes && it.indicaciones ? '. ' : '');
  };
  const tagWidth = (it: Item) => { doc.font('Helvetica-Bold').fontSize(6.5); return doc.widthOfString((ETIQUETA[it.tipo] ?? ETIQUETA.MEDICAMENTO_OTC).texto) + 12; };
  const partesItem = (it: Item) => {
    const nombre = [it.nombre, it.concentracionSnapshot, it.formaSnapshot].filter(Boolean).join(' ');
    const marca = it.marcaImpresa ? `(${it.marcaImpresa})` : '';
    const nameW = wT - tagWidth(it) - 8;                    // el nombre no invade la etiqueta
    doc.font('Helvetica-Bold').fontSize(10.5); const nombreW = doc.widthOfString(nombre);
    doc.font('Helvetica').fontSize(9.5); const marcaW = marca ? doc.widthOfString('  ' + marca) : 0;
    const marcaJunta = !!marca && nombreW + marcaW <= nameW; // marca al lado solo si cabe en 1 línea
    const detalle = [!marcaJunta && marca ? marca : null, it.tipo === 'SERVICIO' ? 'Servicio en clínica' : null, it.cantidad ? `Cantidad: ${it.cantidad}` : null].filter(Boolean).join('   ·   ');
    const ind = posologia(it);
    return { nombre, marca, nameW, marcaJunta, detalle, ind };
  };
  const altoItem = (it: Item): number => {
    const p = partesItem(it);
    doc.font('Helvetica-Bold').fontSize(10.5);
    let h = p.marcaJunta ? 13 : doc.heightOfString(p.nombre, { width: p.nameW });
    h += 2;
    if (p.detalle) { doc.font('Helvetica').fontSize(9); h += doc.heightOfString(p.detalle, { width: wT }) + 2; }
    if (p.ind) { doc.font('Helvetica').fontSize(9.5); h += doc.heightOfString(p.ind, { width: wT, lineGap: 1.5 }) + 2; }
    return h + 11; // + separador
  };
  const dibujarItem = (y: number, n: number, it: Item): number => {
    const p = partesItem(it);
    const et = ETIQUETA[it.tipo] ?? ETIQUETA.MEDICAMENTO_OTC;
    const tagW = tagWidth(it);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(AZUL).text(String(n), M + 4, y, { width: 18, lineBreak: false });
    doc.roundedRect(W - M - tagW, y - 1, tagW, 12, 3).fill(et.color);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#FFFFFF').text(et.texto, W - M - tagW, y + 2, { width: tagW, align: 'center', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK);
    let yy: number;
    if (p.marcaJunta) {
      doc.text(p.nombre, xT, y, { width: p.nameW, lineBreak: false, continued: true });
      doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text('  ' + p.marca, { lineBreak: false });
      yy = y + 13 + 2;
    } else {
      doc.text(p.nombre, xT, y, { width: p.nameW });
      yy = y + doc.heightOfString(p.nombre, { width: p.nameW }) + 2;
    }
    if (p.detalle) { doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(p.detalle, xT, yy, { width: wT }); yy += doc.heightOfString(p.detalle, { width: wT }) + 2; }
    if (p.ind) { doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(p.ind, xT, yy, { width: wT, lineGap: 1.5 }); yy += doc.heightOfString(p.ind, { width: wT, lineGap: 1.5 }) + 2; }
    doc.moveTo(M, yy + 4).lineTo(W - M, yy + 4).lineWidth(0.5).strokeColor(LINEA).stroke();
    return yy + 11;
  };

  // Pie: indicaciones generales + firma, y la barra de verificación con el QR (56 pt).
  const BARRA = 64;
  const pie = (y: number) => {
    const yF = Math.max(y + 10, H - BARRA - 116);
    doc.moveTo(M, yF).lineTo(W - M, yF).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text('INDICACIONES GENERALES', M, yF + 8);
    const nota = r.indicacionesGenerales
      || (esReceta ? 'Siga las indicaciones de cada medicamento. Ante molestias intensas, suspenda y consulte.' : 'Los medicamentos de venta bajo receta se prescriben únicamente en la Receta Médica firmada por médico colegiado.');
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(nota, M, yF + 19, { width: W - 2 * M - 210, height: 70, lineGap: 1.5, ellipsis: true });
    const xS = W - M - 190;
    // Firma y sello digitalizados: solo si el médico la pidió al imprimir (y nunca en una anulada).
    if (firma && r.estado !== 'anulada') {
      try { doc.image(firma, xS + 20, yF + 6, { fit: [150, 54], align: 'center', valign: 'bottom' }); } catch { /* imagen ilegible: queda la línea para firmar a mano */ }
    }
    doc.moveTo(xS, yF + 62).lineTo(W - M, yF + 62).lineWidth(0.7).strokeColor(INK).stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(r.emisorNombre, xS, yF + 66, { width: 190, align: 'center', lineBreak: false, ellipsis: true });
    const cargo = esReceta ? 'Médico cirujano' : ({ podologa: 'Podóloga', fisioterapeuta: 'Fisioterapeuta', medico: 'Médico' } as Record<string, string>)[r.emisor.tipo] ?? 'Profesional';
    const regRaw = (r.emisorRegistro ?? '').trim();
    const tienePrefijo = /^(CMP|COP|CTMP|CEP|RNE|REG\.?)\b/i.test(regRaw);
    const reg = regRaw ? (tienePrefijo ? regRaw : (esReceta ? `CMP ${regRaw}` : `Reg. ${regRaw}`)) : '';
    doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(cargo, xS, yF + 78, { width: 190, align: 'center' }).text(reg, xS, yF + 88, { width: 190, align: 'center' });
    // Barra de verificación: texto a la izquierda, QR a la derecha.
    doc.rect(0, H - BARRA, W, BARRA).fill('#F2F4F6');
    const QR = 52;
    const txtW = W - 2 * M - QR - 16;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text('Verifique la autenticidad y vigencia de este documento', M, H - BARRA + 12, { width: txtW });
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS)
      .text(`Escanee el código QR o ingrese a ${urlVerificacionReceta(r.codigoVerificacion)}`, M, H - BARRA + 25, { width: txtW })
      .text(`Código de verificación: ${r.codigoVerificacion}  ·  Generado por Limablue Agenda`, M, H - BARRA + 38, { width: txtW });
    if (qr) doc.image(qr, W - M - QR, H - BARRA + 6, { width: QR, height: QR });
    else doc.rect(W - M - QR, H - BARRA + 6, QR, QR).lineWidth(0.6).strokeColor(GRIS).stroke();
    if (r.estado === 'anulada') {
      doc.save().rotate(-30, { origin: [W / 2, H / 2] }).font('Helvetica-Bold').fontSize(64).fillColor('#B42318').fillOpacity(0.18)
        .text('ANULADA', 0, H / 2 - 40, { width: W, align: 'center' }).restore();
      doc.fillOpacity(1);
    }
  };

  // ── Cuerpo con paginación medida ──
  let y = cabecera();
  y = bloquePaciente(y);
  y = bloqueAlergias(y);

  const grupos = new Map<string, { codigo: string; desc: string; items: Item[] }>();
  for (const it of r.items) {
    const key = it.diagnostico?.codigo ?? '';
    if (!grupos.has(key)) grupos.set(key, { codigo: it.diagnostico?.codigo ?? '', desc: it.diagnostico?.descripcion ?? 'Sin diagnóstico asociado', items: [] });
    grupos.get(key)!.items.push(it);
  }
  const LIMITE = H - BARRA - 126; // reserva para el pie (firma + barra de verificación)
  let n = 1;
  const nuevaPagina = () => { pie(y); doc.addPage(); y = cabecera(); };
  for (const g of grupos.values()) {
    // El encabezado del grupo no debe quedar solo al final de la página: exige espacio para él + 1 ítem.
    if (y + 22 + (g.items[0] ? altoItem(g.items[0]) : 40) > LIMITE) nuevaPagina();
    y = tituloDx(y, g.codigo || '—', g.desc);
    for (const it of g.items) {
      if (y + altoItem(it) > LIMITE) { nuevaPagina(); y = tituloDx(y, g.codigo || '—', g.desc); }
      y = dibujarItem(y, n++, it);
    }
  }
  pie(y);
}
