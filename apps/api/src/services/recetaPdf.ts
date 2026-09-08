/**
 * PDF de Receta Médica / Indicaciones podológicas (pdfkit, streaming, sin persistir en disco:
 * las filas son inmutables → regenerar es determinista). Diseño:
 *  · Cabecera azul: logo + nombre de la clínica (izq) y documento + N° + subtítulo (der).
 *  · Franja de datos de la sede (dirección · RUC · tel) a todo el ancho, SIN chocar con la cabecera.
 *  · Bloque del paciente, alergias en rojo, ítems agrupados por diagnóstico CIE-10 con etiqueta de
 *    tipo, pie con emisor + registro, firma y código de verificación. Marca de agua "ANULADA".
 * Todas las alturas de los ítems se MIDEN (heightOfString) para paginar bien y no encimar textos
 * cuando un nombre o una posología ocupan varias líneas.
 */
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import type { RecetaCompleta } from './recetaService';

const W = 595.28, H = 841.89, M = 40;
const CONTENT_W = W - 2 * M;
const AZUL = '#003366', AZUL_C = '#0A4B8C', GRIS = '#55617A', INK = '#1F2A3D', ROJO = '#B42318', ROJO_F = '#FDECEC', LINEA = '#CBD6E8', SUAVE = '#EAF1FC', FRANJA = '#EDF1F7';
const LOGO = path.join(process.cwd(), 'assets', 'logo-limablue.png');

const CLINICA = {
  nombre: process.env.CLINICA_NOMBRE || 'Clínica del pie',
  ruc: process.env.CLINICA_RUC || '',
  tel: process.env.CLINICA_TELEFONO || '',
};

type Doc = InstanceType<typeof PDFDocument>;
type Item = RecetaCompleta['items'][number];

const ETIQUETA: Record<string, { texto: string; color: string }> = {
  MEDICAMENTO_RX: { texto: 'RECETA', color: '#B42318' },
  MEDICAMENTO_OTC: { texto: 'VENTA LIBRE', color: '#1F7A55' },
  PRODUCTO: { texto: 'PRODUCTO', color: '#7A5A1F' },
  SERVICIO: { texto: 'SERVICIO', color: '#1F56B0' },
};

function fechaLima(d: Date) {
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(',', ' ·');
}
function edadDe(fn: Date | null): string {
  if (!fn) return '—';
  const hoy = new Date(); let e = hoy.getUTCFullYear() - fn.getUTCFullYear();
  const m = hoy.getUTCMonth() - fn.getUTCMonth();
  if (m < 0 || (m === 0 && hoy.getUTCDate() < fn.getUTCDate())) e--;
  return `${e} años`;
}
const SEXO: Record<string, string> = { masculino: 'Masculino', femenino: 'Femenino', otro: 'Otro' };

export function escribirRecetaPdf(doc: Doc, r: RecetaCompleta): void {
  const esReceta = r.tipoDocumento === 'RECETA_MEDICA';
  const titulo = esReceta ? 'RECETA MÉDICA' : 'INDICACIONES DE TRATAMIENTO';
  const numero = esReceta ? `N° ${String(r.numero).padStart(6, '0')}` : `Podológico · N° ${String(r.numero).padStart(6, '0')}`;
  const subt = esReceta
    ? (r.vigenciaDias ? `Válida por ${r.vigenciaDias} días desde su emisión` : 'Receta médica')
    : 'Tratamiento tópico, productos y servicios indicados';
  const sede = r.atencion.sede;
  const pac = r.paciente;
  const alergias = r.historiaClinica.alergias;

  const xT = M + 26;            // sangría del contenido del ítem (tras el número)
  const wT = CONTENT_W - 26;    // ancho útil del contenido del ítem

  // ── Cabecera (banda azul + franja de datos). Devuelve la Y donde empieza el contenido. ──
  const cabecera = (): number => {
    const BAND = 60;
    doc.rect(0, 0, W, BAND).fill(AZUL);
    // Logo sobre placa blanca
    doc.roundedRect(M, 9, 132, 42, 7).fill('#FFFFFF');
    if (fs.existsSync(LOGO)) doc.image(LOGO, M + 8, 13, { fit: [116, 34], align: 'center', valign: 'center' });
    else doc.font('Helvetica-Bold').fontSize(15).fillColor(AZUL).text('limablue', M + 12, 24);
    // Nombre de la clínica (columna izquierda, corta → no choca con la derecha)
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14).text(CLINICA.nombre, M + 144, 14, { width: 150, lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor('#C7D6EC').text('Podología · Fisioterapia · Baropodometría', M + 144, 34, { width: 160, lineBreak: false });
    // Documento (columna derecha, ancho fijo con separación)
    const RW = 250, RX = W - M - RW;
    doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#FFFFFF').text(titulo, RX, 13, { width: RW, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#DCE6F5').text(numero, RX, 31, { width: RW, align: 'right', lineBreak: false });
    doc.fontSize(8.5).fillColor('#C7D6EC').text(subt, RX, 43, { width: RW, align: 'right', lineBreak: false });
    // Franja de datos de la sede a todo el ancho (dirección + RUC + tel)
    const datos = [sede.nombre, sede.direccion, CLINICA.ruc ? `RUC ${CLINICA.ruc}` : null, CLINICA.tel ? `Tel. ${CLINICA.tel}` : null].filter(Boolean).join('  ·  ');
    doc.font('Helvetica').fontSize(8.5);
    const stripH = Math.max(18, doc.heightOfString(datos, { width: CONTENT_W }) + 8);
    doc.rect(0, BAND, W, stripH).fill(FRANJA);
    doc.fillColor(GRIS).text(datos, M, BAND + 5, { width: CONTENT_W });
    return BAND + stripH + 10;
  };

  const campo = (label: string, valor: string, x: number, y: number, w: number) => {
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(label.toUpperCase(), x, y, { width: w, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(valor, x, y + 10, { width: w, lineBreak: false, ellipsis: true });
  };

  const bloquePaciente = (y: number) => {
    doc.roundedRect(M, y, CONTENT_W, 58, 6).fillAndStroke(SUAVE, LINEA);
    // Columnas dentro de [M+12 .. W-M-12] (≈491 px), con separación, para que ningún campo se corte.
    campo('Paciente', `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase(), M + 12, y + 9, 206);
    campo(pac.tipoDocumento, pac.numeroDocumento, M + 228, y + 9, 62);
    campo('Edad', edadDe(pac.fechaNacimiento), M + 298, y + 9, 50);
    campo('Sexo', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '—', M + 356, y + 9, 60);
    campo('Historia', `HC N° ${String(r.historiaClinica.numero).padStart(6, '0')}`, M + 422, y + 9, 82);
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
    // número
    doc.font('Helvetica-Bold').fontSize(10).fillColor(AZUL).text(String(n), M + 4, y, { width: 18, lineBreak: false });
    // etiqueta de tipo (arriba a la derecha)
    doc.roundedRect(W - M - tagW, y - 1, tagW, 12, 3).fill(et.color);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#FFFFFF').text(et.texto, W - M - tagW, y + 2, { width: tagW, align: 'center', lineBreak: false });
    // nombre (+ marca al lado si cabe)
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

  const pie = (y: number) => {
    const yF = Math.max(y + 10, H - 150);
    doc.moveTo(M, yF).lineTo(W - M, yF).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text('INDICACIONES GENERALES', M, yF + 8);
    const nota = r.indicacionesGenerales
      || (esReceta ? 'Siga las indicaciones de cada medicamento. Ante molestias intensas, suspenda y consulte.' : 'Los medicamentos de venta bajo receta se prescriben únicamente en la Receta Médica firmada por médico colegiado.');
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(nota, M, yF + 19, { width: W - 2 * M - 210, height: 70, lineGap: 1.5, ellipsis: true });
    const xS = W - M - 190;
    doc.moveTo(xS, yF + 62).lineTo(W - M, yF + 62).lineWidth(0.7).strokeColor(INK).stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(r.emisorNombre, xS, yF + 66, { width: 190, align: 'center', lineBreak: false, ellipsis: true });
    const cargo = esReceta ? 'Médico cirujano' : ({ podologa: 'Podóloga', fisioterapeuta: 'Fisioterapeuta', medico: 'Médico' } as Record<string, string>)[r.emisor.tipo] ?? 'Profesional';
    const regRaw = (r.emisorRegistro ?? '').trim();
    const tienePrefijo = /^(CMP|COP|CTMP|CEP|RNE|REG\.?)\b/i.test(regRaw);
    const reg = regRaw ? (tienePrefijo ? regRaw : (esReceta ? `CMP ${regRaw}` : `Reg. ${regRaw}`)) : '';
    doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(cargo, xS, yF + 78, { width: 190, align: 'center' }).text(reg, xS, yF + 88, { width: 190, align: 'center' });
    doc.rect(0, H - 34, W, 34).fill('#F2F4F6');
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(`Generado por Limablue Agenda · Verificación: ${r.codigoVerificacion}`, M, H - 24, { width: W - 2 * M - 120 });
    doc.rect(W - M - 26, H - 30, 26, 26).lineWidth(0.6).strokeColor(GRIS).stroke();
    doc.font('Helvetica').fontSize(5).fillColor(GRIS).text('QR', W - M - 26, H - 20, { width: 26, align: 'center' });
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
  const LIMITE = H - 160; // reserva para el pie
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
