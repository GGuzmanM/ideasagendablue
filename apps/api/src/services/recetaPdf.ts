/**
 * PDF de Receta Médica / Indicaciones podológicas (pdfkit, streaming, sin persistir en disco:
 * las filas son inmutables → regenerar es determinista).
 *
 * Formato (22-sep-2026, pedido de la clínica): MEDIA HOJA A4 (A5 vertical, 148 × 210 mm) y UNA sola
 * copia. Antes salía en A4 con ORIGINAL + COPIA PARA FARMACIA (dos páginas iguales), que en la
 * impresora se veía como un duplicado. La copia para farmacia sigue disponible con ?copias=2.
 *
 * Diseño (24-sep-2026): el MODELO de la clínica — banda azul con el logo en blanco, texto en cursiva azul, cajas grises
 * redondeadas (paciente, alergias en rojo, verificación con QR), barra azul por diagnóstico CIE-10, ítems sin etiqueta
 * de tipo, pie con indicaciones generales y firma, y el punteado decorativo abajo a la derecha. Marca de agua "ANULADA".
 * Todas las alturas de los ítems se MIDEN (heightOfString) para paginar bien y no encimar textos.
 */
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import type { RecetaCompleta } from './recetaService';
import { lineaPosologiaCorta, textoCantidad } from './posologiaTexto';
import {
  Doc, AZUL, AZUL_C, GRIS, INK, ROJO, ROJO_F, LINEA, SUAVE, FRANJA, SEXO, LOGO, CLINICA,
  fechaLima, edadDe, urlVerificacionReceta, VERIFICACION_PUBLICA,
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
  const mediaHoja = opts.mediaHoja ?? false;
  // 24-sep-2026: la receta SIEMPRE termina en la mitad de la hoja (pedido de la clínica). Si no entra con la letra
  // normal, se achica letra y espacios por pasos hasta que entre; solo si ni al mínimo entra, sigue en otra media
  // hoja (que también lleva los datos del paciente).
  const ajuste = mediaHoja ? AJUSTES.find((a) => cabeEnMediaHoja(doc, r, copias[0] ?? null, a, opts.qr, opts.firma ?? null)) ?? AJUSTES[AJUSTES.length - 1]! : 1;
  copias.forEach((copia, i) => {
    if (i > 0) doc.addPage();
    escribirCopia(doc, r, copia, opts.qr, opts.firma ?? null, mediaHoja, ajuste);
  });
}

/** Escalas de letra/espacios que se prueban en orden (1 = tamaño normal de media hoja; 0.75 ≈ letra de 6 pt). */
const AJUSTES = [1, 0.93, 0.87, 0.81, 0.75];

/** Ensayo en un documento descartable: ¿la copia entra en UNA media hoja con esta escala? */
function cabeEnMediaHoja(doc: Doc, r: RecetaCompleta, copia: CopiaReceta, ajuste: number, qr?: Buffer, firma: Buffer | null = null): boolean {
  const prueba = new PDFDocument({ size: [doc.page.width, doc.page.height], margin: 0, bufferPages: true });
  escribirCopia(prueba, r, copia, qr, firma, true, ajuste);
  const paginas = prueba.bufferedPageRange().count;
  prueba.end();
  return paginas === 1;
}

// ─── Estilo del MODELO de la clínica (24-sep-2026, «indicaciones.pdf») ───────────────────────────────────────────
// Banda azul de marca con el logo en blanco, todo el texto en cursiva azul, cajas grises redondeadas (paciente,
// alergias en rojo, verificación con QR), barra azul redondeada por diagnóstico y el punteado decorativo abajo a la
// derecha. La fuente del modelo (Geometria) no está disponible: se usa Helvetica en cursiva, la más cercana en pdfkit.
const M_AZUL = '#1B489A', M_GRIS = '#EDEDED', M_ROJO = '#E30613', M_LINEA = '#C9D5EA';
const LOGO_BLANCO = path.join(process.cwd(), 'assets', 'logo-limablue-blanco.png');
const LOGO_SIN_LEMA = path.join(process.cwd(), 'assets', 'logo-limablue-blanco-sin-lema.png'); // 814 × 383 px
const PUNTEADO = path.join(process.cwd(), 'assets', 'receta-punteado.png'); // 803 × 929 px
const FR = 'Helvetica-Oblique', FB = 'Helvetica-BoldOblique';

/**
 * `mediaHoja` (formato de la clínica, 23-sep-2026): hoja A4 normal, pero TODO el documento —cabecera, ítems, firma y
 * QR— ocupa solo la MITAD SUPERIOR (148 mm), con letra más pequeña y una línea de corte punteada en la mitad. Así se
 * imprime en cualquier impresora con papel A4 y se corta como una receta tipo carta. La mitad inferior queda en blanco.
 */
function escribirCopia(doc: Doc, r: RecetaCompleta, copia: CopiaReceta, qr?: Buffer, firma: Buffer | null = null, mediaHoja = false, ajuste = 1): void {
  // Margen superior de 5 mm (las impresoras no imprimen el borde): todo se dibuja 5 mm más abajo (translate por página)
  // y el alto útil se reduce en lo mismo, así en media hoja la línea de corte sigue cayendo justo en la mitad de la A4.
  const TOP = 14.17;
  const W = doc.page.width, H = (mediaHoja ? doc.page.height / 2 : doc.page.height) - TOP;
  const empezarPagina = () => { doc.save(); doc.translate(0, TOP); };
  const compacto = mediaHoja || W < 500;
  const s = compacto ? 0.55 * ajuste : 1;  // alturas y rellenos (media hoja: más compacto; `ajuste` < 1 si no entra)
  const F = compacto ? 0.82 * ajuste : 1;  // letra (media hoja: más pequeña)
  const M = 43;                   // margen lateral del modelo
  const CONTENT_W = W - 2 * M;
  const PAD = 21;                 // sangría del texto dentro de las cajas (como el modelo)

  const esReceta = r.tipoDocumento === 'RECETA_MEDICA';
  // 24-sep-2026 (pedido de la clínica): la receta médica lleva el MISMO encabezado que las indicaciones.
  const titulo = 'INDICACIONES DE TRATAMIENTO';
  const numero = `Podológico · N° ${String(r.numero).padStart(6, '0')}`;
  const subtitulo = 'Tratamiento tópico, productos y servicios indicados';
  const pac = r.paciente;
  const alergias = r.historiaClinica.alergias;

  const xN = M + PAD;             // número del ítem
  const xT = M + PAD + 18;        // contenido del ítem
  const wT = CONTENT_W - PAD - 18 - PAD;

  // Punteado decorativo (debajo de todo), anclado abajo a la derecha como en el modelo.
  const fondo = () => {
    if (!fs.existsSync(PUNTEADO)) return;
    const h = compacto ? H * 0.8 : H * 0.53;
    const w = (h * 803) / 929;
    doc.image(PUNTEADO, W - w, H - h, { width: w, height: h });
  };

  const campo = (label: string, valor: string, x: number, y: number, w: number) => {
    doc.font(FR).fontSize(10 * F).fillColor(M_AZUL).text(label.toUpperCase(), x, y, { width: w, lineBreak: false });
    doc.font(FB).fontSize(12 * F).fillColor(M_AZUL).text(valor, x, y + 13 * F, { width: w, lineBreak: false, ellipsis: true });
  };

  // Cabecera: banda azul con el logo blanco (izq) y documento + N° + subtítulo (der); debajo, la línea de la clínica.
  const cabecera = (): number => {
    fondo();
    const BAND = 113 * s;
    doc.rect(0, 0, W, BAND).fill(M_AZUL);
    const sl = compacto ? 0.68 * ajuste : 1; // el logo no se achica tanto como la banda
    const LW = 98 * sl, LH = 55 * sl;
    if (fs.existsSync(LOGO_SIN_LEMA)) {
      // Logo (sin su lema diminuto) y, debajo, «Siempre un paso adelante» legible; el grupo va centrado en la banda.
      const logoH = (LW * 383) / 814; // proporción del PNG
      const tagF = 7.2 * F;
      const yL = (BAND - (logoH + 3 * s + tagF)) / 2;
      doc.image(LOGO_SIN_LEMA, M, yL, { width: LW });
      const lema = 'Siempre un paso adelante';
      doc.font(FR).fontSize(tagF).fillColor('#FFFFFF');
      doc.text(lema, M + LW / 2 - doc.widthOfString(lema) / 2, yL + logoH + 3 * s, { lineBreak: false });
    } else if (fs.existsSync(LOGO_BLANCO)) doc.image(LOGO_BLANCO, M, (BAND - LH) / 2, { fit: [LW, LH], valign: 'center' });
    else doc.font(FB).fontSize(20 * F).fillColor('#FFFFFF').text('limablue', M, BAND / 2 - 10 * F);
    const RX = M + LW + 20, RW = W - M - RX;
    const yT = BAND / 2 - (19.6 + 11.7 * 2 + 4) * F / 2;
    doc.font(FB).fontSize(19.6 * F).fillColor('#FFFFFF').text(titulo, RX, yT, { width: RW, align: 'right', lineBreak: false });
    doc.font(FB).fontSize(11.7 * F).text(numero, RX, yT + 23 * F, { width: RW, align: 'right', lineBreak: false });
    doc.font(FR).fontSize(11.7 * F).text(subtitulo, RX, yT + 37 * F, { width: RW, align: 'right', lineBreak: false, ellipsis: true });
    // Identificación de la clínica (el logo dice «Siempre un paso adelante»): «LimaBlue Centro de Podología Médica · sede · dirección».
    const datos = [CLINICA.nombre, r.atencion.sede.nombre, r.atencion.sede.direccion, CLINICA.ruc ? `RUC ${CLINICA.ruc}` : null, CLINICA.tel ? `Tel. ${CLINICA.tel}` : null].filter(Boolean).join('  ·  ');
    // Con ?copias=2, el rótulo ORIGINAL / COPIA va en la MISMA línea, a la derecha (no empuja el contenido a otra página).
    let wRot = 0;
    if (copia) {
      const rot = ROTULO_COPIA[copia];
      doc.font(FB).fontSize(7 * F);
      wRot = doc.widthOfString(rot.texto) + 16;
      doc.roundedRect(W - M - wRot, BAND + 5 * s - 2, wRot, 12 * F, 6).fill(rot.fondo);
      doc.fillColor(rot.tinta).text(rot.texto, W - M - wRot, BAND + 5 * s + 1, { width: wRot, align: 'center', lineBreak: false });
    }
    const wDatos = CONTENT_W - (wRot ? wRot + 10 : 0);
    doc.font(FR).fontSize(7.5 * F).fillColor(M_AZUL);
    const hD = doc.heightOfString(datos, { width: wDatos });
    doc.text(datos, M, BAND + 7 * s, { width: wDatos });
    return BAND + 7 * s + hD + 14 * s;
  };

  // Paciente: caja gris redondeada; nombre arriba, y documento · edad · sexo · historia · emisión abajo.
  const bloquePaciente = (y: number) => {
    const fila2 = 13 * s + 25 * F + 8 * s;
    const h = fila2 + 25 * F + 12 * s;
    doc.roundedRect(M, y, CONTENT_W, h, 10 * s).fill(M_GRIS);
    campo('Paciente', `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase(), M + PAD, y + 13 * s, CONTENT_W - 2 * PAD);
    // Columnas desiguales: el documento puede ser largo (CE, pasaporte, provisional «PEND-…»).
    const u = (CONTENT_W - 2 * PAD) / 5.1;
    const cols = [1.4, 0.7, 0.8, 1.05, 1.15].map((f) => f * u);
    let x = M + PAD;
    const valores: [string, string][] = [
      [pac.tipoDocumento, pac.numeroDocumento], ['Edad', edadDe(pac.fechaNacimiento)], ['Sexo', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '—'],
      ['Historia', `HC N° ${String(r.historiaClinica.numero).padStart(6, '0')}`], ['Emisión', fechaLima(r.fechaEmision)],
    ];
    valores.forEach(([l, v], i) => { campo(l, v, x, y + fila2, cols[i]! - 6); x += cols[i]!; });
    return y + h + 11 * s;
  };

  // Alergias (24-sep-2026): franja con borde de color a la izquierda y un ícono redondo. Con alergias: rosado con
  // «!» y texto rojo; si niega: celeste con ✓ y texto azul (no alarma cuando no hay nada).
  const bloqueAlergias = (y: number) => {
    const hay = alergias.length > 0;
    const color = hay ? M_ROJO : M_AZUL;
    const fondoA = hay ? '#FDECEC' : '#EAF0FA';
    const etiqueta = 'ALERGIAS / RAM:  ';
    const txt = hay ? alergias.map((a) => `${a.sustancia}${a.severidad === 'severa' ? ' (SEVERA)' : ''}`).join(', ').toUpperCase() : 'NIEGA ALERGIAS';
    const R = 6.5 * F; // radio del ícono
    const xTx = M + PAD + 2 * R + 8;
    const wTx = W - M - PAD - xTx;
    doc.font(FB).fontSize(12 * F);
    const hT = doc.heightOfString(etiqueta + txt, { width: wTx });
    const h = Math.max(22 * s, hT + 9 * s, 2 * R + 7 * s);
    doc.save();
    doc.roundedRect(M, y, CONTENT_W, h, 6 * s).clip();
    doc.rect(M, y, CONTENT_W, h).fill(fondoA);
    doc.rect(M, y, 4, h).fill(color);
    doc.restore();
    const cx = M + PAD + R, cy = y + h / 2;
    doc.circle(cx, cy, R).fill(color);
    if (hay) {
      doc.font('Helvetica-Bold').fontSize(R * 1.55).fillColor('#FFFFFF').text('!', cx - R, cy - R * 0.55, { width: 2 * R, align: 'center', lineBreak: false });
    } else {
      doc.save().lineWidth(1.2).lineCap('round').lineJoin('round').strokeColor('#FFFFFF')
        .moveTo(cx - R * 0.45, cy + R * 0.02).lineTo(cx - R * 0.1, cy + R * 0.38).lineTo(cx + R * 0.48, cy - R * 0.36).stroke().restore();
    }
    doc.font(FR).fontSize(11 * F).fillColor(color).text(etiqueta, xTx, y + (h - hT) / 2 + 1, { width: wTx, continued: true });
    doc.font(FB).fontSize(12 * F).text(txt);
    return y + h + 9 * s;
  };

  // Diagnóstico: barra azul redondeada con el texto en blanco.
  const tituloDx = (y: number, codigo: string, desc: string) => {
    const h = Math.max(23 * s, 12 * F + 8);
    doc.roundedRect(M, y, CONTENT_W, h, 8 * s).fill(M_AZUL);
    doc.font(FB).fontSize(12 * F).fillColor('#FFFFFF').text(codigo ? `${codigo}  ·  ${desc.toUpperCase()}` : desc.toUpperCase(), M + PAD, y + (h - 12 * F) / 2 + 1, { width: CONTENT_W - 2 * PAD, lineBreak: false, ellipsis: true });
    return y + h + 12 * s;
  };

  // ── Ítem: nombre en negrita (+ marca), cantidad, posología legible e indicaciones; línea celeste debajo ──
  // Posología legible: «Dosis: 1 cápsula · Vía: oral · Frecuencia: cada 12 horas · Duración: 7 días» y, en otra
  // línea, las indicaciones. Los números sueltos que escribe el médico reciben su unidad (ver posologiaTexto.ts).
  // 24-sep-2026: todo el detalle (marca, «Servicio en clínica», cantidad y posología) va AL COSTADO del nombre, en
  // la misma línea; solo si no entra continúa abajo. Las indicaciones libres del médico siguen en su propia línea.
  const FN = 10.5 * F, FD = 10 * F, FI = 10 * F; // nombre, detalle, indicaciones
  const GAP = 5 * s;
  const SEP = '  ·  ';
  const partesItem = (it: Item) => {
    const nombre = [it.nombre, it.concentracionSnapshot, it.formaSnapshot].filter(Boolean).join(' ');
    const marca = it.marcaImpresa ? `(${it.marcaImpresa})` : '';
    const linea = lineaPosologiaCorta({ tipo: it.tipo, formaFarmaceutica: it.formaSnapshot, dosis: it.dosis, via: it.via, frecuencia: it.frecuencia, duracion: it.duracion });
    const detalle = [
      it.tipo === 'SERVICIO' ? 'Servicio en clínica' : null,
      it.cantidad ? `Cantidad: ${textoCantidad(it.cantidad, it.formaSnapshot ?? '', it.tipo)}` : null,
      linea || null,
    ].filter(Boolean).join(SEP);
    const resto = (marca ? '  ' + marca : '') + (detalle ? SEP + detalle : '');
    doc.font(FB).fontSize(FN); const nombreW = doc.widthOfString(nombre);
    doc.font(FR).fontSize(FD); const restoW = resto ? doc.widthOfString(resto) : 0;
    // Alto de la línea principal: 1 renglón si entra todo; si no, se mide en negrita (cota segura para paginar).
    doc.font(FB).fontSize(FN);
    const altoLinea = nombreW + restoW <= wT ? FN + 2 : doc.heightOfString(nombre + resto, { width: wT });
    return { nombre, resto, altoLinea, ind: (it.indicaciones ?? '').trim() };
  };
  const altoItem = (it: Item): number => {
    const p = partesItem(it);
    let h = p.altoLinea;
    if (p.ind) { doc.font(FR).fontSize(FI); h += GAP + doc.heightOfString(p.ind, { width: wT, lineGap: 2 }); }
    return h + 16 * s; // + línea separadora
  };
  const dibujarItem = (y: number, n: number, it: Item): number => {
    const p = partesItem(it);
    doc.font(FB).fontSize(FN).fillColor(M_AZUL).text(String(n), xN, y, { width: 16, lineBreak: false });
    doc.font(FB).fontSize(FN).fillColor(M_AZUL).text(p.nombre, xT, y, { width: wT, continued: !!p.resto });
    if (p.resto) doc.font(FR).fontSize(FD).text(p.resto);
    let yy = y + p.altoLinea;
    if (p.ind) { yy += GAP; doc.font(FR).fontSize(FI).fillColor(M_AZUL).text(p.ind, xT, yy, { width: wT, lineGap: 2 }); yy += doc.heightOfString(p.ind, { width: wT, lineGap: 2 }); }
    const yL = yy + 8 * s;
    doc.moveTo(M, yL).lineTo(W - M, yL).lineWidth(0.8).strokeColor(M_LINEA).stroke();
    return yL + 8 * s;
  };

  // ── Pie: indicaciones generales, firma y caja gris de verificación con el QR ──
  // Media hoja: indicaciones (izq) y firma (der) lado a lado para ahorrar alto; hoja completa: una debajo de otra,
  // con la firma centrada como en el modelo.
  const BARRA = !VERIFICACION_PUBLICA ? 0 : compacto ? 40 : 63; // sin dirección pública: sin cuadro de verificación
  const GAP_INF = compacto ? 3 : 40;           // aire bajo la caja de verificación
  const FIRMA_W = 185;
  const FIRMA_H = compacto ? 38 : 52;
  const IND_H = compacto ? FIRMA_H : 60;
  const PIE_H = compacto ? FIRMA_H + 6 : IND_H + FIRMA_H + 26;
  const yBarra = H - GAP_INF - BARRA;
  const pie = (y: number) => {
    const yF = Math.max(y + 6, yBarra - 8 - PIE_H);
    const nota = r.indicacionesGenerales
      || (esReceta ? 'Siga las indicaciones de cada medicamento. Ante molestias intensas, suspenda y consulte.' : 'Los medicamentos de venta bajo receta se prescriben únicamente en la Receta Médica firmada por médico colegiado.');
    const wInd = compacto ? CONTENT_W - FIRMA_W - 20 : CONTENT_W * 0.62;
    doc.font(FB).fontSize(10 * F).fillColor(M_AZUL).text('INDICACIONES GENERALES', M, yF, { width: wInd, lineBreak: false });
    doc.font(FR).fontSize(10 * F).fillColor(M_AZUL).text(nota, M, yF + 14 * F, { width: wInd, height: IND_H - 14 * F, lineGap: 1.5, ellipsis: true });

    // Firma: a la derecha (media hoja) o centrada debajo (hoja completa).
    const xS = compacto ? W - M - FIRMA_W : (W - FIRMA_W) / 2;
    const yS = compacto ? yF : yF + IND_H + 14;
    if (firma && r.estado !== 'anulada') {
      try { doc.image(firma, xS + 15, yS - 4, { fit: [FIRMA_W - 30, 30 * s + 10], align: 'center', valign: 'bottom' }); } catch { /* imagen ilegible: queda la línea para firmar a mano */ }
    }
    const yL = yS + 28 * s + 6;
    doc.moveTo(xS, yL).lineTo(xS + FIRMA_W, yL).lineWidth(0.7).strokeColor(M_LINEA).stroke();
    doc.font(FB).fontSize(12 * F).fillColor(M_AZUL).text(r.emisorNombre, xS, yL + 4, { width: FIRMA_W, align: 'center', lineBreak: false, ellipsis: true });
    const cargo = esReceta ? 'Médico cirujano' : ({ podologa: 'Podóloga', fisioterapeuta: 'Fisioterapeuta', medico: 'Médico' } as Record<string, string>)[r.emisor.tipo] ?? 'Profesional';
    const regRaw = (r.emisorRegistro ?? '').trim();
    const tienePrefijo = /^(CMP|COP|CTMP|CEP|RNE|REG\.?)\b/i.test(regRaw);
    const reg = regRaw ? (tienePrefijo ? regRaw : (esReceta ? `CMP ${regRaw}` : `Reg. ${regRaw}`)) : '';
    doc.font(FR).fontSize(10 * F).fillColor(M_AZUL).text(reg ? `${cargo} · ${reg}` : cargo, xS, yL + 4 + 14 * F, { width: FIRMA_W, align: 'center', lineBreak: false, ellipsis: true });

    // Verificación: caja gris redondeada; texto a la izquierda y el QR sobre un cuadro blanco a la derecha.
    if (VERIFICACION_PUBLICA) {
    doc.roundedRect(M, yBarra, CONTENT_W, BARRA, 10 * s).fill(M_GRIS);
    const QR = BARRA - 12;
    const xQ = W - M - 10 - QR;
    const txtW = xQ - (M + 10) - 10;
    const yTx = yBarra + (BARRA - 3 * 12.5 * F) / 2;
    doc.font(FB).fontSize(10 * F).fillColor(M_AZUL).text('Verifique la autenticidad y vigencia de este documento', M + 10, yTx, { width: txtW, lineBreak: false, ellipsis: true });
    doc.font(FR).fontSize(10 * F).fillColor(M_AZUL)
      .text(`Escanee el código QR o ingrese a: ${urlVerificacionReceta(r.codigoVerificacion)}`, M + 10, yTx + 12.5 * F, { width: txtW, lineBreak: false, ellipsis: true })
      .text(`Código de verificación: ${r.codigoVerificacion}  ·  Generado por Limablue Agenda`, M + 10, yTx + 25 * F, { width: txtW, lineBreak: false, ellipsis: true });
    doc.roundedRect(xQ - 3, yBarra + 3, QR + 6, QR + 6, 4).fill('#FFFFFF');
    if (qr) doc.image(qr, xQ, yBarra + 6, { width: QR, height: QR });
    else doc.rect(xQ, yBarra + 6, QR, QR).lineWidth(0.6).strokeColor(M_LINEA).stroke();
    }

    // Media hoja: línea de corte punteada justo debajo del documento (la mitad inferior de la A4 queda en blanco).
    if (mediaHoja) {
      doc.save().moveTo(0, H + 6).lineTo(W, H + 6).lineWidth(0.5).dash(3, { space: 3 }).strokeColor('#9AA5B8').stroke().undash();
      doc.font('Helvetica').fontSize(6).fillColor('#9AA5B8').text('- - -  cortar por la línea  - - -', M, H + 9, { lineBreak: false }).restore();
    }
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
  const LIMITE = yBarra - 8 - PIE_H - 4; // reserva para el pie (indicaciones + firma + verificación)
  let n = 1;
  const nuevaPagina = () => { pie(y); doc.addPage(); empezarPagina(); y = bloquePaciente(cabecera()); }; // cada hoja lleva al paciente
  for (const g of grupos.values()) {
    // El encabezado del grupo no debe quedar solo al final de la página: exige espacio para él + 1 ítem.
    if (y + 35 * s + (g.items[0] ? altoItem(g.items[0]) : 30) > LIMITE) nuevaPagina();
    y = tituloDx(y, g.codigo, g.desc);
    for (const it of g.items) {
      if (y + altoItem(it) > LIMITE) { nuevaPagina(); y = tituloDx(y, g.codigo, g.desc); }
      y = dibujarItem(y, n++, it);
    }
  }
  pie(y);
}
