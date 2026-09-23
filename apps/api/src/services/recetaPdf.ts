/**
 * PDF de Receta Médica / Indicaciones podológicas (pdfkit, streaming, sin persistir en disco:
 * las filas son inmutables → regenerar es determinista).
 *
 * Formato (22-sep-2026, pedido de la clínica): MEDIA HOJA A4 (A5 vertical, 148 × 210 mm) y UNA sola
 * copia. Antes salía en A4 con ORIGINAL + COPIA PARA FARMACIA (dos páginas iguales), que en la
 * impresora se veía como un duplicado. La copia para farmacia sigue disponible con ?copias=2.
 *
 * Diseño (toda la geometría sale del tamaño de página del documento, así el mismo código sirve para
 * A5 y A4): cabecera azul compacta (logo + documento + N°), franja con la sede, bloque del paciente en
 * dos filas, alergias en rojo, ítems agrupados por diagnóstico CIE-10 con etiqueta de tipo, pie con
 * indicaciones generales, firma, y barra de verificación con QR. Marca de agua "ANULADA".
 * Todas las alturas de los ítems se MIDEN (heightOfString) para paginar bien y no encimar textos.
 */
import * as fs from 'fs';
import type { RecetaCompleta } from './recetaService';
import { lineaPosologia, textoCantidad } from './posologiaTexto';
import {
  Doc, AZUL, AZUL_C, GRIS, INK, ROJO, ROJO_F, LINEA, SUAVE, FRANJA, SEXO, LOGO, CLINICA,
  fechaLima, edadDe, urlVerificacionReceta,
} from './pdfComun';

type Item = RecetaCompleta['items'][number];

export type CopiaReceta = 'original' | 'farmacia' | null;
const ROTULO_COPIA: Record<'original' | 'farmacia', { texto: string; fondo: string; tinta: string }> = {
  original: { texto: 'ORIGINAL · PARA EL PACIENTE', fondo: SUAVE, tinta: AZUL },
  farmacia: { texto: 'COPIA · PARA LA FARMACIA', fondo: '#FFF4E5', tinta: '#8A4B00' },
};

/**
 * Escribe la receta. `copias`: una página por copia (`null` = sin rótulo). `qr`: PNG del código
 * de verificación (se genera antes, con `qrPng`).
 */
export function escribirRecetaPdf(doc: Doc, r: RecetaCompleta, opts: { copias?: CopiaReceta[]; qr?: Buffer; firma?: Buffer | null; mediaHoja?: boolean } = {}): void {
  const copias = opts.copias?.length ? opts.copias : [null];
  copias.forEach((copia, i) => {
    if (i > 0) doc.addPage();
    escribirCopia(doc, r, copia, opts.qr, opts.firma ?? null, opts.mediaHoja ?? false);
  });
}

/**
 * `mediaHoja` (formato de la clínica, 23-sep-2026): hoja A4 normal, pero TODO el documento —cabecera, ítems, firma y
 * QR— ocupa solo la MITAD SUPERIOR (148 mm), con letra más pequeña y una línea de corte punteada en la mitad. Así se
 * imprime en cualquier impresora con papel A4 y se corta como una receta tipo carta. La mitad inferior queda en blanco.
 */
function escribirCopia(doc: Doc, r: RecetaCompleta, copia: CopiaReceta, qr?: Buffer, firma: Buffer | null = null, mediaHoja = false): void {
  // Margen superior de 5 mm (23-sep-2026; primero 1 cm, se veía brusco): las impresoras no imprimen el borde y la banda azul salía cortada. Todo el
  // documento se dibuja 1 cm más abajo (translate por página) y el alto útil se reduce en lo mismo, así en media hoja
  // la línea de corte sigue cayendo justo en la mitad de la A4.
  const TOP = 14.17; // 5 mm en puntos
  // Geometría: ancho de la página; alto ÚTIL = la mitad si es media hoja (A4 → 420.9 pt), o toda la página, menos el margen.
  const W = doc.page.width, H = (mediaHoja ? doc.page.height / 2 : doc.page.height) - TOP;
  const empezarPagina = () => { doc.save(); doc.translate(0, TOP); };
  const compacto = mediaHoja || W < 500;
  const M = compacto ? 28 : 40;
  const CONTENT_W = W - 2 * M;
  const F = compacto ? 0.82 : 1; // factor de las fuentes del cuerpo (media hoja: letra más pequeña)
  const k = compacto ? 0.82 : 1; // factor de las medidas fijas (bandas, bloques, pie)

  const esReceta = r.tipoDocumento === 'RECETA_MEDICA';
  const titulo = esReceta ? 'RECETA MÉDICA' : 'INDICACIONES DE TRATAMIENTO';
  const numero = esReceta ? `N° ${String(r.numero).padStart(6, '0')}` : `Podológico · N° ${String(r.numero).padStart(6, '0')}`;
  const subtitulo = esReceta
    ? (r.vigenciaDias ? `Válida por ${r.vigenciaDias} días desde su emisión` : 'Receta médica')
    : 'Tratamiento tópico, productos y servicios indicados';
  const pac = r.paciente;
  const alergias = r.historiaClinica.alergias;

  const xT = M + 18 * k;        // sangría del contenido del ítem (tras el número)
  const wT = CONTENT_W - 18 * k; // ancho útil del contenido del ítem

  const campo = (label: string, valor: string, x: number, y: number, w: number) => {
    doc.font('Helvetica').fontSize(6.5 * F).fillColor(GRIS).text(label.toUpperCase(), x, y, { width: w, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8.5 * F).fillColor(INK).text(valor, x, y + 9 * k, { width: w, lineBreak: false, ellipsis: true });
  };

  // Cabecera compacta: banda azul con el logo (izq) y documento + N° + subtítulo (der); franja de la sede.
  const cabecera = (): number => {
    const BAND = 48 * k;
    doc.rect(0, 0, W, BAND).fill(AZUL);
    const LW = 104 * k, LH = 36 * k;
    doc.roundedRect(M, 6 * k, LW, LH, 6).fill('#FFFFFF');
    if (fs.existsSync(LOGO)) doc.image(LOGO, M + 10 * k, 8 * k, { fit: [84 * k, 20 * k], align: 'center', valign: 'center' });
    else doc.font('Helvetica-Bold').fontSize(12 * F).fillColor(AZUL).text('limablue', M + 10 * k, 13 * k);
    doc.font('Helvetica-Bold').fontSize(4.4 * F).fillColor(AZUL).text(CLINICA.encabezado.toUpperCase(), M, 32 * k, { width: LW, align: 'center', lineBreak: false, characterSpacing: 0.3 });
    const RX = M + LW + 8, RW = W - M - RX;
    doc.font('Helvetica-Bold').fontSize(11 * F).fillColor('#FFFFFF').text(titulo, RX, 9 * k, { width: RW, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(8 * F).fillColor('#DCE6F5').text(numero, RX, 24 * k, { width: RW, align: 'right', lineBreak: false });
    doc.fontSize(7 * F).fillColor('#C7D6EC').text(subtitulo, RX, 35 * k, { width: RW, align: 'right', lineBreak: false, ellipsis: true });
    const datos = [CLINICA.nombre, r.atencion.sede.nombre, r.atencion.sede.direccion, CLINICA.ruc ? `RUC ${CLINICA.ruc}` : null, CLINICA.tel ? `Tel. ${CLINICA.tel}` : null].filter(Boolean).join('  ·  ');
    doc.font('Helvetica').fontSize(7 * F);
    const stripH = Math.max(14 * k, doc.heightOfString(datos, { width: CONTENT_W }) + 6 * k);
    doc.rect(0, BAND, W, stripH).fill(FRANJA);
    doc.fillColor(GRIS).text(datos, M, BAND + 3 * k, { width: CONTENT_W });
    let y = BAND + stripH + 8 * k;
    if (copia) {
      const rot = ROTULO_COPIA[copia];
      doc.font('Helvetica-Bold').fontSize(7 * F);
      const w = doc.widthOfString(rot.texto) + 16;
      doc.roundedRect(W - M - w, y - 3, w, 13 * k, 3).fill(rot.fondo);
      doc.fillColor(rot.tinta).text(rot.texto, W - M - w, y, { width: w, align: 'center', lineBreak: false });
      y += 14 * k;
    }
    return y;
  };

  // Paciente en dos filas: nombre completo arriba; documento, edad, sexo, historia y fecha abajo.
  const bloquePaciente = (y: number) => {
    const h = 50 * k;
    doc.roundedRect(M, y, CONTENT_W, h, 5).fillAndStroke(SUAVE, LINEA);
    campo('Paciente', `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase(), M + 9, y + 6 * k, CONTENT_W - 18);
    // Columnas desiguales: el documento puede ser largo (CE, pasaporte, provisional «PEND-…»).
    const u = (CONTENT_W - 18) / 5.1;
    const cols = [1.4, 0.7, 0.8, 1.05, 1.15].map((f) => f * u);
    let x = M + 9;
    const valores: [string, string][] = [
      [pac.tipoDocumento, pac.numeroDocumento], ['Edad', edadDe(pac.fechaNacimiento)], ['Sexo', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '—'],
      ['Historia', `HC N° ${String(r.historiaClinica.numero).padStart(6, '0')}`], ['Emisión', fechaLima(r.fechaEmision)],
    ];
    valores.forEach(([l, v], i) => { campo(l, v, x, y + 28 * k, cols[i]! - 4); x += cols[i]!; });
    return y + h + 7 * k;
  };

  const bloqueAlergias = (y: number) => {
    const txt = alergias.length ? alergias.map((a) => `${a.sustancia}${a.severidad === 'severa' ? ' (SEVERA)' : ''}`).join(', ') : 'NIEGA';
    doc.font('Helvetica-Bold').fontSize(8 * F);
    const h = Math.max(18 * k, doc.heightOfString('ALERGIAS / RAM:  ' + txt, { width: CONTENT_W - 16 }) + 9 * k);
    doc.roundedRect(M, y, CONTENT_W, h, 4).fillAndStroke(ROJO_F, '#F3B9B4');
    doc.fillColor(ROJO).text('ALERGIAS / RAM:  ' + txt, M + 8, y + 5 * k, { width: CONTENT_W - 16 });
    return y + h + 7 * k;
  };

  const tituloDx = (y: number, codigo: string, desc: string) => {
    doc.rect(M, y, CONTENT_W, 15 * k).fill(AZUL_C);
    doc.font('Helvetica-Bold').fontSize(8.5 * F).fillColor('#FFFFFF').text(`${codigo}  ·  ${desc.toUpperCase()}`, M + 6, y + 4 * k, { width: CONTENT_W - 12, lineBreak: false, ellipsis: true });
    return y + 19 * k;
  };

  // ── Composición de un ítem: partes de texto y ancho del nombre libre del tag ──
  // Posología legible: «Dosis: 1 cápsula · Vía: oral · Frecuencia: cada 12 horas · Duración: 7 días» y, en otra
  // línea, las indicaciones. Los números sueltos que escribe el médico reciben su unidad (ver posologiaTexto.ts).
  const posologia = (it: Item) => {
    const linea = lineaPosologia({ tipo: it.tipo, formaFarmaceutica: it.formaSnapshot, dosis: it.dosis, via: it.via, frecuencia: it.frecuencia, duracion: it.duracion });
    const ind = (it.indicaciones ?? '').trim();
    return [linea, ind].filter(Boolean).join('\n');
  };
  const FN = 10 * F, FD = 8.5 * F, FI = 9 * F; // nombre, detalle, indicaciones
  // Sin etiqueta de tipo (RECETA / VENTA LIBRE / PRODUCTO / SERVICIO) desde el 23-sep-2026: la clínica pidió quitarla
  // del documento; el nombre usa todo el ancho.
  const partesItem = (it: Item) => {
    const nombre = [it.nombre, it.concentracionSnapshot, it.formaSnapshot].filter(Boolean).join(' ');
    const marca = it.marcaImpresa ? `(${it.marcaImpresa})` : '';
    const nameW = wT;
    doc.font('Helvetica-Bold').fontSize(FN); const nombreW = doc.widthOfString(nombre);
    doc.font('Helvetica').fontSize(FD); const marcaW = marca ? doc.widthOfString('  ' + marca) : 0;
    const marcaJunta = !!marca && nombreW + marcaW <= nameW; // marca al lado solo si cabe en 1 línea
    const detalle = [!marcaJunta && marca ? marca : null, it.tipo === 'SERVICIO' ? 'Servicio en clínica' : null, it.cantidad ? `Cantidad: ${textoCantidad(it.cantidad, it.formaSnapshot ?? '', it.tipo)}` : null].filter(Boolean).join('   ·   ');
    const ind = posologia(it);
    return { nombre, marca, nameW, marcaJunta, detalle, ind };
  };
  const altoItem = (it: Item): number => {
    const p = partesItem(it);
    doc.font('Helvetica-Bold').fontSize(FN);
    let h = p.marcaJunta ? FN + 2 : doc.heightOfString(p.nombre, { width: p.nameW });
    h += 2;
    if (p.detalle) { doc.font('Helvetica').fontSize(FD); h += doc.heightOfString(p.detalle, { width: wT }) + 2; }
    if (p.ind) { doc.font('Helvetica').fontSize(FI); h += doc.heightOfString(p.ind, { width: wT, lineGap: 1.2 }) + 2; }
    return h + 9 * k; // + separador
  };
  const dibujarItem = (y: number, n: number, it: Item): number => {
    const p = partesItem(it);
    doc.font('Helvetica-Bold').fontSize(9.5 * F).fillColor(AZUL).text(String(n), M + 2, y, { width: 16, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(FN).fillColor(INK);
    let yy: number;
    if (p.marcaJunta) {
      doc.text(p.nombre, xT, y, { width: p.nameW, lineBreak: false, continued: true });
      doc.font('Helvetica').fontSize(FD).fillColor(GRIS).text('  ' + p.marca, { lineBreak: false });
      yy = y + FN + 2 + 2;
    } else {
      doc.text(p.nombre, xT, y, { width: p.nameW });
      yy = y + doc.heightOfString(p.nombre, { width: p.nameW }) + 2;
    }
    if (p.detalle) { doc.font('Helvetica').fontSize(FD).fillColor(GRIS).text(p.detalle, xT, yy, { width: wT }); yy += doc.heightOfString(p.detalle, { width: wT }) + 2; }
    if (p.ind) { doc.font('Helvetica').fontSize(FI).fillColor(INK).text(p.ind, xT, yy, { width: wT, lineGap: 1.2 }); yy += doc.heightOfString(p.ind, { width: wT, lineGap: 1.2 }) + 2; }
    doc.moveTo(M, yy + 3).lineTo(W - M, yy + 3).lineWidth(0.5).strokeColor(LINEA).stroke();
    return yy + 9 * k;
  };

  // Pie: indicaciones generales + firma, y la barra de verificación con el QR.
  const BARRA = compacto ? 42 : 64;
  const PIE_H = compacto ? 82 : 116;   // alto del bloque de firma/indicaciones
  const FIRMA_W = compacto ? 150 : 190;
  const pie = (y: number) => {
    const yF = Math.max(y + 8, H - BARRA - PIE_H);
    doc.moveTo(M, yF).lineTo(W - M, yF).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font('Helvetica-Bold').fontSize(7 * F).fillColor(GRIS).text('INDICACIONES GENERALES', M, yF + 6 * k);
    const nota = r.indicacionesGenerales
      || (esReceta ? 'Siga las indicaciones de cada medicamento. Ante molestias intensas, suspenda y consulte.' : 'Los medicamentos de venta bajo receta se prescriben únicamente en la Receta Médica firmada por médico colegiado.');
    doc.font('Helvetica').fontSize(8 * F).fillColor(INK).text(nota, M, yF + 16 * k, { width: W - 2 * M - FIRMA_W - 16, height: PIE_H - 30 * k, lineGap: 1.2, ellipsis: true });
    const xS = W - M - FIRMA_W;
    // Firma y sello digitalizados: solo si el médico la pidió al imprimir (y nunca en una anulada).
    if (firma && r.estado !== 'anulada') {
      try { doc.image(firma, xS + 15, yF + 4, { fit: [FIRMA_W - 30, 46 * k], align: 'center', valign: 'bottom' }); } catch { /* imagen ilegible: queda la línea para firmar a mano */ }
    }
    const yL = yF + 52 * k;
    doc.moveTo(xS, yL).lineTo(W - M, yL).lineWidth(0.7).strokeColor(INK).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5 * F).fillColor(INK).text(r.emisorNombre, xS, yL + 4, { width: FIRMA_W, align: 'center', lineBreak: false, ellipsis: true });
    const cargo = esReceta ? 'Médico cirujano' : ({ podologa: 'Podóloga', fisioterapeuta: 'Fisioterapeuta', medico: 'Médico' } as Record<string, string>)[r.emisor.tipo] ?? 'Profesional';
    const regRaw = (r.emisorRegistro ?? '').trim();
    const tienePrefijo = /^(CMP|COP|CTMP|CEP|RNE|REG\.?)\b/i.test(regRaw);
    const reg = regRaw ? (tienePrefijo ? regRaw : (esReceta ? `CMP ${regRaw}` : `Reg. ${regRaw}`)) : '';
    doc.font('Helvetica').fontSize(7 * F).fillColor(GRIS).text(cargo, xS, yL + 15 * k, { width: FIRMA_W, align: 'center' }).text(reg, xS, yL + 24 * k, { width: FIRMA_W, align: 'center' });
    // Barra de verificación: texto a la izquierda, QR a la derecha.
    doc.rect(0, H - BARRA, W, BARRA).fill('#F2F4F6');
    const QR = BARRA - 10;
    const txtW = W - 2 * M - QR - 12;
    doc.font('Helvetica-Bold').fontSize(7 * F).fillColor(INK).text('Verifique la autenticidad y vigencia de este documento', M, H - BARRA + 7 * k, { width: txtW });
    doc.font('Helvetica').fontSize(6.5 * F).fillColor(GRIS)
      .text(`Escanee el código QR o ingrese a ${urlVerificacionReceta(r.codigoVerificacion)}`, M, H - BARRA + 18 * k, { width: txtW })
      .text(`Código de verificación: ${r.codigoVerificacion}  ·  Generado por Limablue Agenda`, M, H - BARRA + 29 * k, { width: txtW });
    // Media hoja: línea de corte punteada justo debajo del documento (la mitad inferior de la A4 queda en blanco).
    if (mediaHoja) {
      doc.save().moveTo(0, H + 6).lineTo(W, H + 6).lineWidth(0.5).dash(3, { space: 3 }).strokeColor('#9AA5B8').stroke().undash();
      doc.font('Helvetica').fontSize(6).fillColor('#9AA5B8').text('- - -  cortar por la línea  - - -', M, H + 9, { lineBreak: false }).restore();
    }
    if (qr) doc.image(qr, W - M - QR, H - BARRA + 5, { width: QR, height: QR });
    else doc.rect(W - M - QR, H - BARRA + 5, QR, QR).lineWidth(0.6).strokeColor(GRIS).stroke();
    if (r.estado === 'anulada') {
      doc.save().rotate(-30, { origin: [W / 2, H / 2] }).font('Helvetica-Bold').fontSize(compacto ? 48 : 64).fillColor('#B42318').fillOpacity(0.18)
        .text('ANULADA', 0, H / 2 - 30, { width: W, align: 'center' }).restore();
      doc.fillOpacity(1);
    }
    doc.restore(); // fin de la página: se deshace el margen superior
  };

  // ── Cuerpo con paginación medida ──
  empezarPagina();
  let y = cabecera();
  y = bloquePaciente(y);
  y = bloqueAlergias(y);

  const grupos = new Map<string, { codigo: string; desc: string; items: Item[] }>();
  for (const it of r.items) {
    const key = it.diagnostico?.codigo ?? '';
    if (!grupos.has(key)) grupos.set(key, { codigo: it.diagnostico?.codigo ?? '', desc: it.diagnostico?.descripcion ?? 'Sin diagnóstico asociado', items: [] });
    grupos.get(key)!.items.push(it);
  }
  const LIMITE = H - BARRA - PIE_H - 8; // reserva para el pie (firma + barra de verificación)
  let n = 1;
  const nuevaPagina = () => { pie(y); doc.addPage(); empezarPagina(); y = cabecera(); };
  for (const g of grupos.values()) {
    // El encabezado del grupo no debe quedar solo al final de la página: exige espacio para él + 1 ítem.
    if (y + 19 + (g.items[0] ? altoItem(g.items[0]) : 30) > LIMITE) nuevaPagina();
    y = tituloDx(y, g.codigo || '—', g.desc);
    for (const it of g.items) {
      if (y + altoItem(it) > LIMITE) { nuevaPagina(); y = tituloDx(y, g.codigo || '—', g.desc); }
      y = dibujarItem(y, n++, it);
    }
  }
  pie(y);
}
