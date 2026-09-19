/**
 * PDF del consentimiento informado.
 *  · Formato 2 (OFICIAL de la clínica, 18-sep-2026): el mismo documento que envió la clínica —
 *    cabecera con logo, sede, N.° de HC, fecha y hora; secciones I a X; casillas marcadas; cuadro
 *    de firmas (paciente, huella, representante, profesional con colegiatura, testigo, lugar/fecha/
 *    hora); revocatoria; marco normativo. Sale POR DUPLICADO (historia clínica y paciente).
 *  · Formato 1 (texto plano, lo firmado antes): cabecera, datos, texto y firmas, como siempre.
 * Las firmas se redibujan como VECTOR (nítidas al imprimir). Revocado → marca de agua en cada hoja.
 */
import fs from 'fs';
import type { ConsentimientoParaPdf, TrazoFirma } from './consentimientoService';
import type { ContenidoConsentimiento, DatosConsentimiento } from './consentimientoFormal';
import { trozosNegrita, declaracion, MARCO_NORMATIVO, EJEMPLARES } from './consentimientoFormal';
import {
  Doc, W, H, M, CONTENT_W, GRIS, INK, LINEA, SUAVE, ROJO, AZUL, SEXO, LOGO, CLINICA, fechaLima, edadDe, dibujarCabecera, campo,
} from './pdfComun';

const AZUL_BARRA = '#1E4E9A';
const FONDO_BARRA = '#EEF2F8';
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const hora = (d: Date) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const fecha = (d: Date) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

/** Dibuja trazos de firma dentro de una caja (x, y, w, h) respetando la proporción del lienzo. */
function dibujarFirma(doc: Doc, trazos: TrazoFirma[] | null | undefined, x: number, y: number, w: number, h: number, aspecto: number) {
  if (!trazos?.length) return;
  // Se encaja el lienzo (ancho/alto = aspecto) dentro de la caja, centrado.
  let fw = w, fh = w / aspecto;
  if (fh > h) { fh = h; fw = h * aspecto; }
  const ox = x + (w - fw) / 2, oy = y + (h - fh) / 2;
  doc.save().lineCap('round').lineJoin('round').strokeColor('#0B1F44');
  for (const t of trazos) {
    if (!t.puntos?.length) continue;
    const [x0, y0] = t.puntos[0]!;
    doc.lineWidth(Math.max(0.7, (t.grosor ?? 3) * 0.4));
    doc.moveTo(ox + x0 * fw, oy + y0 * fh);
    if (t.puntos.length === 1) doc.lineTo(ox + x0 * fw + 0.5, oy + y0 * fh + 0.5);
    for (const [px, py] of t.puntos.slice(1)) doc.lineTo(ox + px * fw, oy + py * fh);
    doc.stroke();
  }
  doc.restore();
}

export function escribirConsentimientoPdf(doc: Doc, c: ConsentimientoParaPdf, opts: { copias?: 1 | 2 } = {}): void {
  if (c.formato === 2 && c.contenido) return escribirFormatoOficial(doc, c, opts);
  return escribirTextoPlano(doc, c);
}

// ═══════════════════════════════ Formato OFICIAL ═══════════════════════════════
function escribirFormatoOficial(doc: Doc, c: ConsentimientoParaPdf, opts: { copias?: 1 | 2 }) {
  const ct = c.contenido as unknown as ContenidoConsentimiento;
  const d = (c.datos ?? {}) as unknown as DatosConsentimiento;
  const pac = c.paciente;
  const numero = `N.° ${pad(c.numero, 5)}`;
  const hc = c.historiaNumero != null ? pad(c.historiaNumero, 6) : '—';
  const ejemplares = opts.copias === 1 ? ['EJEMPLAR PARA LA HISTORIA CLÍNICA'] : ['EJEMPLAR PARA LA HISTORIA CLÍNICA', 'EJEMPLAR PARA EL PACIENTE'];
  const PIE = 26, BOT = H - PIE - 14;
  const X = M, AW = CONTENT_W;
  const paginasDe: string[] = [];           // ejemplar de cada hoja (para el pie)
  let y = 0;
  let ejemplar = '';

  const nuevaHoja = (primera: boolean) => {
    if (doc.bufferedPageRange().count > 0 && (paginasDe.length > 0)) doc.addPage();
    paginasDe.push(ejemplar);
    y = primera ? cabeceraOficial() : cabeceraCont();
  };
  const cabeceraOficial = () => {
    const top = 30, alto = 78, logoW = 92, datosW = 104;
    doc.rect(X, top, AW, alto).lineWidth(0.6).strokeColor(LINEA).stroke();
    doc.moveTo(X + logoW, top).lineTo(X + logoW, top + alto).stroke();
    doc.moveTo(X + AW - datosW, top).lineTo(X + AW - datosW, top + alto).stroke();
    if (fs.existsSync(LOGO)) doc.image(LOGO, X + 10, top + 20, { fit: [logoW - 20, 34], align: 'center', valign: 'center' });
    else doc.font('Helvetica-Bold').fontSize(14).fillColor(AZUL).text('limablue', X + 12, top + 30);
    const tx = X + logoW + 10, tw = AW - logoW - datosW - 20;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('CONSENTIMIENTO INFORMADO', tx, top + 12, { width: tw });
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(ct.titulo, tx, top + 30, { width: tw, lineGap: 0.5 });
    const sedeTxt = `Sede ${c.sede.nombre}${c.sede.direccion ? ` — ${c.sede.direccion}` : ''}`;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(AZUL_BARRA).text(sedeTxt, tx, top + alto - 16, { width: tw, lineBreak: false, ellipsis: true });
    const dx = X + AW - datosW + 8, dw = datosW - 16;
    const dato = (rot: string, val: string, yy: number) => {
      doc.font('Helvetica-Bold').fontSize(6).fillColor(GRIS).text(rot, dx, yy, { width: dw });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(val, dx, yy + 8, { width: dw, lineBreak: false });
    };
    dato('N.° HISTORIA CLÍNICA', hc, top + 6);
    dato('FECHA', fecha(c.firmadoEn), top + 30);
    dato('HORA', hora(c.firmadoEn), top + 54);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(GRIS)
      .text(`${ejemplar}  ·  CONSENTIMIENTO ${numero}`, X, top + alto + 4, { width: AW, align: 'right', characterSpacing: 0.3 });
    return top + alto + 18;
  };
  const cabeceraCont = () => {
    doc.font('Helvetica').fontSize(7).fillColor(GRIS)
      .text(`Consentimiento informado ${numero} · ${ct.titulo}`, X, 24, { width: AW, lineBreak: false, ellipsis: true });
    doc.moveTo(X, 36).lineTo(X + AW, 36).lineWidth(0.4).strokeColor(LINEA).stroke();
    return 46;
  };
  const asegurar = (alto: number) => { if (y + alto > BOT) nuevaHoja(false); };

  // ── Piezas de texto ──
  /** Párrafo con negritas (**…**). Mide con la fuente negrita: nunca se queda corto. */
  const alto = (s: string, w: number, tam: number) => {
    doc.font('Helvetica-Bold').fontSize(tam);
    return doc.heightOfString(s.replace(/\*\*/g, ''), { width: w, lineGap: 1.2 });
  };
  const parrafo = (s: string, o: { x?: number; w?: number; tam?: number; color?: string; italica?: boolean; antes?: string } = {}) => {
    const x = o.x ?? X, w = o.w ?? AW, tam = o.tam ?? 8.6;
    const completo = (o.antes ? `**${o.antes}** ` : '') + s;
    const h = alto(completo, w, tam);
    asegurar(h + 4);
    // Con partes en negrita el texto va alineado a la izquierda: pdfkit, al justificar texto «continuado»,
    // se come los espacios entre partes y abre huecos. Los espacios del borde pasan al trozo anterior.
    const trozos = trozosNegrita(completo);
    for (let i = 1; i < trozos.length; i++) {
      const m = trozos[i]!.t.match(/^\s+/);
      if (m) { trozos[i - 1]!.t += m[0]; trozos[i]!.t = trozos[i]!.t.slice(m[0].length); }
    }
    const align = trozos.length > 1 ? 'left' : 'justify';
    doc.fillColor(o.color ?? INK);
    trozos.forEach((t, i) => {
      doc.font(t.b ? 'Helvetica-Bold' : (o.italica ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(tam);
      const op = { width: w, lineGap: 1.2, align, continued: i < trozos.length - 1 } as const;
      if (i === 0) doc.text(t.t, x, y, op); else doc.text(t.t, op);
    });
    // Altura REAL que ocupó (la estimada con negrita es mayor y dejaba huecos).
    y = Math.max(doc.y, y + 8) + 4;
  };
  const vinetas = (xs: string[]) => xs.forEach((s) => {
    asegurar(alto(s, AW - 12, 8.6) + 6);
    doc.circle(X + 3, y + 4, 1.6).fill(INK);
    parrafo(s, { x: X + 12, w: AW - 12 });
    y -= 1;
  });
  const barra = (t: string) => {
    asegurar(40);
    y += 4;
    doc.rect(X, y, AW, 15).fill(FONDO_BARRA);
    doc.rect(X + 5, y + 4, 2.2, 7).fill(AZUL_BARRA);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(t, X + 12, y + 4, { width: AW - 16, lineBreak: false });
    y += 21;
  };
  const subtitulo = (t: string) => {
    asegurar(24);
    doc.font('Helvetica-Bold').fontSize(7.2).fillColor(INK).text(t, X, y, { width: AW, characterSpacing: 0.2 });
    y += 12;
  };
  /** Campo con rótulo y valor sobre una línea punteada. */
  const linea = (rot: string, val: string, x: number, w: number, yy: number) => {
    doc.font('Helvetica').fontSize(6.3).fillColor(GRIS).text(rot, x, yy, { width: w, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(8.6).fillColor(INK).text(val || ' ', x, yy + 9, { width: w - 4, lineBreak: false, ellipsis: true });
    doc.save().dash(1, { space: 1.5 }).moveTo(x, yy + 21).lineTo(x + w - 8, yy + 21).lineWidth(0.4).strokeColor('#9AA6B8').stroke().undash().restore();
  };
  const casilla = (x: number, yy: number, marcada: boolean) => {
    doc.rect(x, yy, 7, 7).lineWidth(0.6).strokeColor(INK).stroke();
    if (marcada) {
      doc.save().lineWidth(1.1).strokeColor(AZUL_BARRA).moveTo(x + 1.3, yy + 3.8).lineTo(x + 3, yy + 5.8).lineTo(x + 6, yy + 1.2).stroke().restore();
    }
  };

  for (const ej of ejemplares) {
    ejemplar = ej;
    nuevaHoja(true);

    // I. DATOS DEL PACIENTE
    barra('I. DATOS DEL PACIENTE');
    asegurar(120);
    linea('APELLIDOS Y NOMBRES', `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase(), X, AW, y); y += 26;
    linea('DOCUMENTO DE IDENTIDAD (DNI / CE)', `${pac.tipoDocumento} ${pac.numeroDocumento}`, X, AW * 0.38, y);
    linea('EDAD', edadDe(pac.fechaNacimiento), X + AW * 0.38, AW * 0.26, y);
    linea('SEXO', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '', X + AW * 0.64, AW * 0.36, y); y += 26;
    linea('DOMICILIO', d.domicilio ?? '', X, AW * 0.64, y);
    linea('TELÉFONO DE CONTACTO', d.telefono ?? pac.telefono ?? '', X + AW * 0.64, AW * 0.36, y); y += 28;
    doc.font('Helvetica-Bold').fontSize(7).fillColor(INK).text('REPRESENTANTE LEGAL (SOLO SI EL PACIENTE ES MENOR DE EDAD O NO PUEDE DECIDIR POR SÍ MISMO)', X, y, { width: AW }); y += 11;
    linea('APELLIDOS Y NOMBRES DEL REPRESENTANTE', d.representante?.nombre ?? '', X, AW * 0.6, y);
    linea('DOCUMENTO DE IDENTIDAD', d.representante?.documento ?? '', X + AW * 0.6, AW * 0.4, y); y += 26;
    linea('PARENTESCO O VÍNCULO', d.representante?.parentesco ?? '', X, AW, y); y += 28;

    // II. PROCEDIMIENTO PROPUESTO
    barra('II. PROCEDIMIENTO PROPUESTO');
    parrafo(ct.procedimiento, { antes: 'Nombre del procedimiento:' });
    if (ct.campos.dedos || ct.campos.alcance.length) {
      asegurar(32);
      const wIzq = ct.campos.alcance.length ? AW * 0.5 : AW;
      if (ct.campos.dedos) linea('DEDO O DEDOS A INTERVENIR', d.dedos ?? '', X, wIzq, y);
      if (ct.campos.alcance.length) {
        const ax = ct.campos.dedos ? X + AW * 0.52 : X;
        doc.font('Helvetica').fontSize(6.3).fillColor(GRIS).text('ALCANCE — A MARCAR POR EL PROFESIONAL TRATANTE', ax, y, { width: AW * 0.48 });
        let cx = ax;
        doc.font('Helvetica').fontSize(8.2).fillColor(INK);
        for (const op of ct.campos.alcance) {
          casilla(cx, y + 11, d.alcance === op);
          doc.text(op, cx + 10, y + 10.5, { lineBreak: false });
          cx += 10 + doc.widthOfString(op) + 12;
        }
      }
      y += 30;
    }
    for (const e of ct.explicaciones) parrafo(e.texto, { antes: `${e.titulo}:` });
    if (ct.aclaracion) {
      const hs = ct.aclaracion.parrafos.reduce((n, p) => n + alto(p, AW - 20, 8.4) + 6, 0) + 22;
      asegurar(hs + 6);
      doc.rect(X, y, AW, hs).fillAndStroke('#F4F6FA', '#D5DCE7');
      doc.font('Helvetica-Bold').fontSize(7).fillColor(AZUL_BARRA).text(ct.aclaracion.titulo.toUpperCase(), X + 10, y + 8, { width: AW - 20 });
      y += 20;
      for (const p of ct.aclaracion.parrafos) parrafo(p, { x: X + 10, w: AW - 20, tam: 8.4 });
      y += 8;
    }

    // III. BENEFICIOS
    barra('III. BENEFICIOS QUE SE ESPERAN OBTENER');
    vinetas(ct.beneficios);
    if (ct.notaBeneficios) parrafo(ct.notaBeneficios, { tam: 7.2, color: GRIS, italica: true });

    // IV. RIESGOS
    barra('IV. RIESGOS Y COMPLICACIONES DEL PROCEDIMIENTO');
    parrafo('Se le informa de forma específica y detallada de las complicaciones que pueden presentarse, agrupadas según la frecuencia con que ocurren:');
    if (ct.riesgos.frecuentes.length) { subtitulo('A. EFECTOS ESPERABLES Y FRECUENTES — FORMAN PARTE DE LA RECUPERACIÓN NORMAL'); vinetas(ct.riesgos.frecuentes); }
    if (ct.riesgos.pocoFrecuentes.length) { subtitulo('B. COMPLICACIONES POCO FRECUENTES'); vinetas(ct.riesgos.pocoFrecuentes); }
    if (ct.riesgos.raros.length) { subtitulo('C. COMPLICACIONES RARAS, PERO GRAVES'); vinetas(ct.riesgos.raros); }

    // V. RIESGOS PARTICULARES
    barra('V. RIESGOS PARTICULARES EN SU CASO');
    parrafo('Los riesgos anteriores aumentan de forma significativa si usted presenta alguna de las siguientes condiciones. Marque las que correspondan e informe de cualquier otra:');
    {
      const filas = Math.ceil((ct.riesgosParticulares.length + 1) / 2);
      const hBox = 20 + filas * 14 + 6;
      asegurar(hBox + 6);
      doc.rect(X, y, AW, hBox).lineWidth(0.5).strokeColor('#D5DCE7').stroke();
      doc.font('Helvetica-Bold').fontSize(6.3).fillColor(GRIS).text('RIESGOS PERSONALIZADOS ADVERTIDOS AL PACIENTE POR EL PROFESIONAL TRATANTE (A COMPLETAR SEGÚN EL CASO)', X + 8, y + 7, { width: AW - 16 });
      const items = [...ct.riesgosParticulares.map((t) => ({ t, m: (d.riesgos ?? []).includes(t) })), { t: `Otra condición: ${d.otraCondicion ?? '______________________'}`, m: !!d.otraCondicion }];
      items.forEach((it, i) => {
        const col = i < filas ? 0 : 1, fila = i < filas ? i : i - filas;
        const cx = X + 8 + col * (AW / 2), cy = y + 22 + fila * 14;
        casilla(cx, cy, it.m);
        doc.font(it.m ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.2).fillColor(INK).text(it.t, cx + 11, cy - 0.5, { width: AW / 2 - 24, lineBreak: false, ellipsis: true });
      });
      y += hBox + 8;
    }

    // VI a VIII
    barra('VI. MEDICAMENTOS Y MATERIALES QUE SE UTILIZARÁN Y SUS POSIBLES EFECTOS');
    ct.medicamentos.forEach((p) => parrafo(p));
    barra('VII. ALTERNATIVAS AL PROCEDIMIENTO PROPUESTO');
    vinetas(ct.alternativas);
    if (ct.cuidados.length) { barra('VIII. CUIDADOS POSTERIORES Y COMPROMISOS DEL PACIENTE'); vinetas(ct.cuidados); }

    // IX. DECLARACIÓN + FIRMAS
    barra('IX. DECLARACIÓN DE CONFORMIDAD');
    vinetas(declaracion(ct.nombreCorto));
    cuadroFirmas();

    // X. REVOCATORIA (hoja propia si no entra) + marco normativo
    revocatoria();
  }

  function cuadroFirmas() {
    const F1 = 70, F2 = 64, F3 = 26, total = F1 + F2 + F3;
    asegurar(total + 8);
    y += 4;
    const w1 = AW * 0.44, wH = AW * 0.13, w3 = AW - w1 - wH;
    const aspecto = c.firmaAspecto > 0 ? c.firmaAspecto : 3;
    doc.lineWidth(0.5).strokeColor('#C9D3E3');
    doc.rect(X, y, AW, total).stroke();
    doc.moveTo(X, y + F1).lineTo(X + AW, y + F1).stroke();
    doc.moveTo(X, y + F1 + F2).lineTo(X + AW, y + F1 + F2).stroke();
    doc.moveTo(X + w1, y).lineTo(X + w1, y + F1).stroke();
    doc.moveTo(X + w1 + wH, y).lineTo(X + w1 + wH, y + total).stroke();
    const rot = (t: string, x: number, yy: number, w: number, centro = false) =>
      doc.font('Helvetica-Bold').fontSize(6.3).fillColor(INK).text(t, x + 6, yy + 5, { width: w - 12, align: centro ? 'center' : 'left', lineBreak: false });
    const pieDe = (t: string, x: number, yy: number, w: number) =>
      doc.font('Helvetica').fontSize(6.6).fillColor(INK).text(t, x + 6, yy - 12, { width: w - 12, lineBreak: false, ellipsis: true });
    // Fila 1: paciente | huella | representante
    rot('FIRMA DEL PACIENTE', X, y, w1);
    rot('HUELLA DIGITAL', X + w1, y, wH, true);
    rot('FIRMA DEL REPRESENTANTE LEGAL (SI CORRESPONDE)', X + w1 + wH, y, w3);
    const firmante = c.firmanteRelacion === 'apoderado' ? 'rep' : 'pac';
    if (firmante === 'pac') dibujarFirma(doc, c.firma as unknown as TrazoFirma[], X + 10, y + 13, w1 - 20, F1 - 30, aspecto);
    else dibujarFirma(doc, c.firma as unknown as TrazoFirma[], X + w1 + wH + 10, y + 13, w3 - 20, F1 - 30, aspecto);
    pieDe(`NOMBRE: ${`${pac.nombres} ${pac.apellidoPaterno}`.trim()}   DNI: ${pac.numeroDocumento}`, X, y + F1, w1);
    pieDe(d.representante ? `NOMBRE: ${d.representante.nombre}   DNI: ${d.representante.documento}` : 'NOMBRE: ______________   DNI: ________', X + w1 + wH, y + F1, w3);
    // Fila 2: profesional | testigo
    const y2 = y + F1;
    rot('FIRMA Y SELLO DEL PROFESIONAL TRATANTE', X, y2, w1 + wH);
    rot('FIRMA DEL TESTIGO (OPCIONAL)', X + w1 + wH, y2, w3);
    dibujarFirma(doc, c.firmaProfesional as unknown as TrazoFirma[] | null, X + 10, y2 + 13, w1 + wH - 20, F2 - 30, aspecto);
    dibujarFirma(doc, c.firmaTestigo as unknown as TrazoFirma[] | null, X + w1 + wH + 10, y2 + 13, w3 - 20, F2 - 30, aspecto);
    pieDe(`NOMBRE: ${c.profesionalEtiqueta ?? '______________'}   COLEGIATURA N.°: ${c.profesionalRegistro ?? '________'}`, X, y2 + F2, w1 + wH);
    pieDe(d.testigo ? `NOMBRE: ${d.testigo.nombre}   DNI: ${d.testigo.documento ?? '________'}` : 'NOMBRE: ______________   DNI: ________', X + w1 + wH, y2 + F2, w3);
    // Fila 3: lugar | fecha | hora
    const y3 = y2 + F2;
    rot('LUGAR', X, y3, w1);
    doc.font('Helvetica').fontSize(8).fillColor(INK).text(`Lima — Sede ${c.sede.nombre}`, X + 40, y3 + 5, { width: w1 - 46, lineBreak: false, ellipsis: true });
    rot('FECHA', X + w1, y3, wH, true);
    doc.font('Helvetica').fontSize(8).text(fecha(c.firmadoEn), X + w1, y3 + 14, { width: wH, align: 'center', lineBreak: false });
    rot('HORA', X + w1 + wH, y3, w3);
    doc.font('Helvetica').fontSize(8).text(hora(c.firmadoEn), X + w1 + wH + 34, y3 + 5, { width: w3 - 40, lineBreak: false });
    y += total + 8;
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS)
      .text(`Registrado en el sistema por ${c.registradoEtiqueta ?? '—'} el ${fechaLima(c.firmadoEn)}. La huella digital se estampa en el ejemplar impreso.`, X, y, { width: AW });
    y += 12;
  }

  function revocatoria() {
    const hRev = 150;
    asegurar(hRev + 70);
    barra('X. REVOCATORIA DEL CONSENTIMIENTO');
    const rev = c.estado === 'revocado';
    const quien = rev ? (c.firmanteRelacion === 'apoderado' && d.representante ? d.representante.nombre : `${pac.nombres} ${pac.apellidoPaterno} ${pac.apellidoMaterno}`.trim()) : '______________________________';
    const doc_ = rev ? (c.firmanteDocumento ?? pac.numeroDocumento) : '______________';
    parrafo(`Yo, ${rev ? `**${quien}**` : quien}, identificado/a con documento N.° ${rev ? `**${doc_}**` : doc_}, REVOCO el consentimiento otorgado en el presente documento y no autorizo la realización del procedimiento, habiendo sido informado/a de las consecuencias de esta decisión. No estoy obligado/a a expresar el motivo de mi decisión.`);
    if (rev) {
      parrafo(`Revocado el ${c.revocadoEn ? fechaLima(c.revocadoEn) : '—'}${c.motivoRevocacion ? `. Motivo expresado: ${c.motivoRevocacion}` : ' (sin expresar motivo)'}.`, { tam: 8, color: ROJO });
    }
    const hF = 58, w1 = AW * 0.44, wH = AW * 0.13, w3 = AW - w1 - wH;
    asegurar(hF + 30);
    doc.lineWidth(0.5).strokeColor('#C9D3E3').rect(X, y, AW, hF + 24).stroke();
    doc.moveTo(X, y + hF).lineTo(X + AW, y + hF).stroke();
    doc.moveTo(X + w1, y).lineTo(X + w1, y + hF + 24).stroke();
    doc.moveTo(X + w1 + wH, y).lineTo(X + w1 + wH, y + hF + 24).stroke();
    const rot = (t: string, x: number, yy: number, w: number) => doc.font('Helvetica-Bold').fontSize(6.3).fillColor(INK).text(t, x + 6, yy + 5, { width: w - 12, lineBreak: false });
    rot('FIRMA DEL PACIENTE O REPRESENTANTE LEGAL', X, y, w1);
    rot('HUELLA DIGITAL', X + w1, y, wH);
    rot('FIRMA Y SELLO DEL PROFESIONAL · COLEGIATURA N.°', X + w1 + wH, y, w3);
    rot('LUGAR', X, y + hF, w1); rot('FECHA', X + w1, y + hF, wH); rot('HORA', X + w1 + wH, y + hF, w3);
    y += hF + 32;
    doc.font('Helvetica').fontSize(6.2).fillColor(GRIS);
    const hM = doc.heightOfString(MARCO_NORMATIVO, { width: AW }) + doc.heightOfString(EJEMPLARES, { width: AW }) + 10;
    asegurar(hM);
    doc.text(MARCO_NORMATIVO, X, y, { width: AW }); y += doc.heightOfString(MARCO_NORMATIVO, { width: AW }) + 4;
    doc.text(EJEMPLARES, X, y, { width: AW }); y += doc.heightOfString(EJEMPLARES, { width: AW }) + 4;
  }

  // Pie y marca de agua en cada hoja (se dibujan al final: se conoce el total por ejemplar).
  const rango = doc.bufferedPageRange();
  const porEjemplar = new Map<string, number>();
  paginasDe.forEach((e) => porEjemplar.set(e, (porEjemplar.get(e) ?? 0) + 1));
  const vistos = new Map<string, number>();
  for (let i = 0; i < paginasDe.length; i++) {
    doc.switchToPage(rango.start + i);
    const e = paginasDe[i]!;
    const n = (vistos.get(e) ?? 0) + 1; vistos.set(e, n);
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS).text(
      `${CLINICA.nombre} · Consentimiento ${numero} · HC N.° ${hc} · ${e.toLowerCase()} · Página ${n} de ${porEjemplar.get(e)} · Documento confidencial (Ley 29733)`,
      M, H - PIE, { width: CONTENT_W, align: 'center', lineBreak: false, ellipsis: true },
    );
    if (c.estado === 'revocado') {
      doc.save().rotate(-30, { origin: [W / 2, H / 2] }).font('Helvetica-Bold').fontSize(70).fillColor(ROJO).fillOpacity(0.14)
        .text('REVOCADO', 0, H / 2 - 40, { width: W, align: 'center', lineBreak: false }).restore();
      doc.fillOpacity(1);
    }
  }
}

// ═══════════════════════════════ Formato 1 (texto plano) ═══════════════════════════════
function escribirTextoPlano(doc: Doc, c: ConsentimientoParaPdf): void {
  const pac = c.paciente;
  const numero = `N° ${pad(c.numero, 5)}`;
  const hc = c.historiaNumero != null ? `HC N° ${pad(c.historiaNumero, 6)}` : 'HC —';
  const PIE = 28;
  const FIRMAS = 150;
  let y = 0;
  const cabecera = () => {
    y = dibujarCabecera(doc, { titulo: 'CONSENTIMIENTO INFORMADO', numero, subtitulo: `Firmado el ${fechaLima(c.firmadoEn)}`, sede: c.sede });
  };
  const pie = () => {
    doc.rect(0, H - PIE, W, PIE).fill('#F2F4F6');
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(
      `Consentimiento ${numero} · ${hc} · Firmado el ${fechaLima(c.firmadoEn)} · Documento confidencial`,
      M, H - PIE + 10, { width: CONTENT_W, lineBreak: false, ellipsis: true },
    );
  };

  cabecera();
  doc.roundedRect(M, y, CONTENT_W, 58, 6).fillAndStroke(SUAVE, LINEA);
  campo(doc, 'Paciente', `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase(), M + 12, y + 9, 206);
  campo(doc, pac.tipoDocumento, pac.numeroDocumento, M + 228, y + 9, 62);
  campo(doc, 'Edad', edadDe(pac.fechaNacimiento), M + 298, y + 9, 50);
  campo(doc, 'Sexo', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '—', M + 356, y + 9, 60);
  campo(doc, 'Historia', hc, M + 422, y + 9, 82);
  campo(doc, 'Servicio', c.servicioNombre ?? '—', M + 12, y + 33, 206);
  campo(doc, 'Profesional que informa', c.profesionalEtiqueta ?? '—', M + 228, y + 33, 260);
  y += 66;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS).text('PROCEDIMIENTO QUE SE AUTORIZA', M, y);
  y += 12;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
  const hProc = doc.heightOfString(c.procedimiento, { width: CONTENT_W });
  doc.text(c.procedimiento, M, y, { width: CONTENT_W });
  y += hProc + 10;

  const parrafos = c.texto.replace(/\r/g, '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK);
  for (const par of parrafos) {
    const alto = doc.heightOfString(par, { width: CONTENT_W, lineGap: 1.6, align: 'justify' }) + 6;
    if (y + alto > H - PIE - 16) { pie(); doc.addPage(); cabecera(); doc.font('Helvetica').fontSize(9.5).fillColor(INK); }
    doc.text(par, M, y, { width: CONTENT_W, lineGap: 1.6, align: 'justify' });
    y += alto;
  }
  if (y + FIRMAS > H - PIE - 10) { pie(); doc.addPage(); cabecera(); }

  const yF = Math.max(y + 12, H - PIE - FIRMAS);
  const anchoCaja = 230;
  const aspecto = c.firmaAspecto > 0 ? c.firmaAspecto : 3;
  const altoCaja = Math.min(86, anchoCaja / aspecto);
  doc.roundedRect(M, yF, anchoCaja, altoCaja, 4).lineWidth(0.5).strokeColor(LINEA).stroke();
  dibujarFirma(doc, c.firma as unknown as TrazoFirma[], M, yF, anchoCaja, altoCaja, aspecto);
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
      .text(`Revocado el ${c.revocadoEn ? fechaLima(c.revocadoEn) : '—'}${c.motivoRevocacion ? ` · Motivo: ${c.motivoRevocacion}` : ' · sin expresar motivo'}`, M, H - PIE - 14, { width: CONTENT_W, lineBreak: false, ellipsis: true });
  }
  pie();
}
