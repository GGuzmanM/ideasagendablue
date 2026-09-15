/**
 * PDF COMPLETO de la historia clínica (7.6): datos del paciente, alergias y antecedentes, y cada
 * atención en orden cronológico con su motivo, diagnósticos, notas de evolución (S/O/A/P),
 * procedimientos, escalas, recetas e indicaciones con sus ítems, consentimientos y (opcional) fotos.
 * Todas las alturas se MIDEN antes de escribir para paginar con la cabecera en cada hoja; el pie
 * con «página N de M» se escribe al final (bufferPages). Documento confidencial: su descarga queda
 * auditada como `exportar_hc`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { UPLOADS_ROOT } from '../middleware/uploadPodograma';
import type { HistoriaParaPdf } from './historiaClinicaService';
import {
  Doc, W, H, M, CONTENT_W, AZUL, AZUL_C, GRIS, INK, ROJO, ROJO_F, LINEA, SUAVE, SEXO, CLINICA,
  fechaLima, soloFecha, edadDe, dibujarCabecera, campo,
} from './pdfComun';

type Atencion = HistoriaParaPdf['historia']['atenciones'][number];

const ESCALA: Record<string, string> = {
  eva: 'EVA (dolor)', wagner: 'Wagner', texas: 'Texas', iwgdf: 'Riesgo IWGDF', monofilamento: 'Monofilamento',
  termometria: 'Termometría', ulcera: 'Úlcera', itb: 'Índice tobillo-brazo', osi: 'OSI onicomicosis',
  manchester: 'Manchester (hallux valgus)', examen: 'Examen del pie',
};
const ANTECEDENTE: Record<string, string> = {
  patologico: 'Patológicos', quirurgico: 'Quirúrgicos', familiar: 'Familiares', farmacologico: 'Farmacológicos', habito: 'Hábitos', otro: 'Otros',
};
const NOTA: Record<string, string> = { evolucion: 'Nota de evolución', procedimiento: 'Nota de procedimiento', indicacion: 'Indicación', observacion: 'Observación' };
const PROFESION: Record<string, string> = { podologa: 'Podóloga', medico: 'Médico', fisioterapeuta: 'Fisioterapeuta' };
const PIE_LABEL: Record<string, string> = { izquierdo: 'pie izquierdo', derecho: 'pie derecho', ambos: 'ambos pies' };
const DOC_RECETA: Record<string, string> = { RECETA_MEDICA: 'Receta médica', INDICACIONES_PODOLOGICAS: 'Indicaciones podológicas' };
// pdfkit incrusta el archivo ENTERO (no lo achica): las fotos de más de MAX_FOTO_PDF quedan como
// recuadro con aviso para que el PDF no pese decenas de MB ni bloquee el servidor; tope por atención.
const MAX_FOTO_PDF = 4 * 1024 * 1024, MAX_FOTOS_ATENCION = 24;

export function escribirHistoriaPdf(doc: Doc, h: HistoriaParaPdf, opts: { fotos?: boolean } = {}): void {
  const { paciente: pac, historia } = h;
  const atenciones = historia.atenciones;
  const ultima = atenciones[atenciones.length - 1];
  const sede = ultima ? ultima.sede : { nombre: CLINICA.nombre, direccion: null };
  const numeroHc = `HC N° ${String(historia.numero).padStart(6, '0')}`;
  const nombrePaciente = `${pac.apellidoPaterno} ${pac.apellidoMaterno}, ${pac.nombres}`.toUpperCase();

  const PIE = 28;
  const LIMITE = H - PIE - 14;
  const X = M + 10;              // sangría del contenido de una atención
  const ANCHO = CONTENT_W - 10;
  let y = 0;

  const cabecera = () => {
    y = dibujarCabecera(doc, {
      titulo: 'HISTORIA CLÍNICA', numero: numeroHc,
      subtitulo: `Copia completa · ${atenciones.length} atención${atenciones.length === 1 ? '' : 'es'}`, sede,
    });
  };
  const asegurar = (alto: number) => { if (y + alto > LIMITE) { doc.addPage(); cabecera(); } };

  /** Barra de título de sección. Exige espacio para la barra + un poco de contenido. */
  const barra = (texto: string, color = AZUL_C) => {
    asegurar(48);
    doc.rect(M, y, CONTENT_W, 20).fill(color);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF').text(texto, M + 8, y + 6, { width: CONTENT_W - 16, lineBreak: false, ellipsis: true });
    y += 26;
  };
  const subtitulo = (texto: string) => {
    asegurar(28);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(AZUL).text(texto.toUpperCase(), X, y, { width: ANCHO, lineBreak: false });
    y += 12;
  };
  /**
   * Párrafo con rótulo opcional en negrita («Subjetivo: …»). Los textos largos se parten por renglón
   * para que un bloque nunca pase del final de la hoja (así la cabecera se repite en cada página).
   */
  const parrafo = (texto: string, rotulo?: string, o: { tam?: number; color?: string; x?: number; ancho?: number } = {}) => {
    const tam = o.tam ?? 9, x = o.x ?? X, ancho = o.ancho ?? ANCHO;
    const lineas = String(texto).replace(/\r/g, '').split('\n').flatMap((l) => (l.length > 900 ? l.match(/[\s\S]{1,900}(\s|$)/g) ?? [l] : [l]));
    lineas.forEach((linea, i) => {
      const conRotulo = i === 0 && rotulo;
      const completo = conRotulo ? `${rotulo}: ${linea}` : linea || ' ';
      doc.font('Helvetica').fontSize(tam);
      const alto = doc.heightOfString(completo, { width: ancho, lineGap: 1.2 }) + 2;
      asegurar(alto);
      if (conRotulo) {
        doc.font('Helvetica-Bold').fontSize(tam).fillColor(INK).text(`${rotulo}: `, x, y, { width: ancho, lineGap: 1.2, continued: true });
        doc.font('Helvetica').fillColor(o.color ?? INK).text(linea, { lineGap: 1.2 });
      } else {
        doc.font('Helvetica').fontSize(tam).fillColor(o.color ?? INK).text(linea || ' ', x, y, { width: ancho, lineGap: 1.2 });
      }
      y += alto;
    });
  };
  const separador = () => { asegurar(8); doc.moveTo(X, y + 2).lineTo(W - M, y + 2).lineWidth(0.4).strokeColor(LINEA).stroke(); y += 8; };

  // ── Paciente ──
  cabecera();
  doc.roundedRect(M, y, CONTENT_W, 60, 6).fillAndStroke(SUAVE, LINEA);
  campo(doc, 'Paciente', nombrePaciente, M + 12, y + 9, 206);
  campo(doc, pac.tipoDocumento, pac.numeroDocumento, M + 228, y + 9, 62);
  campo(doc, 'Edad', edadDe(pac.fechaNacimiento), M + 298, y + 9, 50);
  campo(doc, 'Sexo', pac.sexo ? SEXO[pac.sexo] ?? pac.sexo : '—', M + 356, y + 9, 60);
  campo(doc, 'Historia', numeroHc, M + 422, y + 9, 82);
  campo(doc, 'Apertura', soloFecha(historia.fechaApertura), M + 12, y + 33, 100);
  campo(doc, 'Estado', historia.estado === 'pasiva' ? 'Pasiva' : 'Activa', M + 122, y + 33, 60);
  campo(doc, 'Teléfono', pac.telefono || '—', M + 228, y + 33, 120);
  y += 70;

  // ── Alergias ──
  const alergias = historia.alergias;
  const txtAlergias = alergias.length
    ? alergias.map((a) => `${a.sustancia}${a.reaccion ? ` (${a.reaccion})` : ''}${a.severidad === 'severa' ? ' · SEVERA' : ''}${a.activa ? '' : ' · inactiva'}`).join('; ')
    : 'NIEGA / sin alergias registradas';
  doc.font('Helvetica-Bold').fontSize(9);
  const altoAl = Math.max(22, doc.heightOfString('ALERGIAS / RAM:  ' + txtAlergias, { width: CONTENT_W - 20 }) + 12);
  asegurar(altoAl + 8);
  doc.roundedRect(M, y, CONTENT_W, altoAl, 4).fillAndStroke(ROJO_F, '#F3B9B4');
  doc.fillColor(ROJO).text('ALERGIAS / RAM:  ' + txtAlergias, M + 10, y + 6, { width: CONTENT_W - 20 });
  y += altoAl + 10;

  // ── Antecedentes ──
  barra('ANTECEDENTES');
  if (!historia.antecedentes.length) parrafo('Sin antecedentes registrados.', undefined, { color: GRIS });
  const porTipo = new Map<string, string[]>();
  for (const a of historia.antecedentes) {
    if (!porTipo.has(a.tipo)) porTipo.set(a.tipo, []);
    porTipo.get(a.tipo)!.push(`${a.descripcion}${a.activo ? '' : ' (inactivo)'}`);
  }
  for (const [tipo, lista] of porTipo) parrafo(lista.join('; '), ANTECEDENTE[tipo] ?? tipo);
  y += 6;

  // ── Atenciones ──
  if (!atenciones.length) { barra('ATENCIONES'); parrafo('Aún no hay atenciones registradas.', undefined, { color: GRIS }); }
  atenciones.forEach((a, i) => escribirAtencion(a, i + 1));

  function escribirAtencion(a: Atencion, n: number) {
    barra(`${n}. ${soloFecha(a.fecha)}  ·  ${a.servicio.nombre}  ·  ${a.sede.nombre}`, AZUL);
    const prof = `${a.profesional.nombres} ${a.profesional.apellidos}`.trim();
    const estado = a.estado === 'cerrada' ? `cerrada${a.cerradaEn ? ` el ${fechaLima(a.cerradaEn)}` : ''}` : 'abierta';
    parrafo(`${prof} (${PROFESION[a.profesional.tipo] ?? a.profesional.tipo}) · Atención ${estado}`, 'Profesional', { tam: 8.5, color: GRIS });
    parrafo(a.motivoConsulta, 'Motivo de consulta');

    if (a.diagnosticos.length) {
      subtitulo('Diagnósticos');
      for (const d of a.diagnosticos) {
        parrafo(`${d.cie10.codigo} · ${d.cie10.descripcion} — ${d.tipo}${d.principal ? ' (principal)' : ''}${d.observacion ? `. ${d.observacion}` : ''}`);
      }
    }
    if (a.notas.length) {
      subtitulo('Evolución');
      a.notas.forEach((nota, k) => {
        if (k > 0) separador();
        parrafo(`${NOTA[nota.tipo] ?? 'Nota'} · ${nota.autorEtiqueta} · ${fechaLima(nota.creadoEn)}${nota.version > 1 ? ` · editada (v${nota.version})` : ''}`, undefined, { tam: 8, color: GRIS });
        if (nota.subjetivo) parrafo(nota.subjetivo, 'Subjetivo');
        if (nota.objetivo) parrafo(nota.objetivo, 'Objetivo');
        if (nota.apreciacion) parrafo(nota.apreciacion, 'Apreciación');
        if (nota.plan) parrafo(nota.plan, 'Plan');
        if (nota.texto) parrafo(nota.texto, 'Observaciones');
      });
    }
    if (a.procedimientos.length) {
      subtitulo('Procedimientos');
      for (const p of a.procedimientos) {
        const partes = [p.nombre, p.pie ? PIE_LABEL[p.pie] ?? p.pie : null, p.ubicacion, p.anestesia ? `anestesia: ${p.anestesia}` : null,
          p.sesionNumero ? `sesión ${p.sesionNumero}${p.sesionesTotales ? `/${p.sesionesTotales}` : ''}` : null].filter(Boolean).join(' · ');
        parrafo(`${partes}${p.detalle ? `. ${p.detalle}` : ''}`);
      }
    }
    if (a.escalas.length) {
      subtitulo('Escalas y mediciones');
      for (const e of a.escalas) parrafo(e.resultado || '—', `${ESCALA[e.tipo] ?? e.tipo}${e.pie ? ` (${PIE_LABEL[e.pie] ?? e.pie})` : ''}`);
    }
    if (a.recetas.length) {
      subtitulo('Recetas e indicaciones');
      for (const r of a.recetas) {
        asegurar(34); // el título de la receta no queda solo al pie: baja con su primer ítem
        parrafo(`${DOC_RECETA[r.tipoDocumento]} N° ${String(r.numero).padStart(6, '0')} · ${fechaLima(r.fechaEmision)} · ${r.emisorNombre}${r.estado === 'anulada' ? ' · ANULADA' : ''}`, undefined, { tam: 8.5, color: r.estado === 'anulada' ? ROJO : GRIS });
        for (const it of r.items) {
          const nombre = [it.nombre, it.concentracionSnapshot, it.formaSnapshot].filter(Boolean).join(' ') + (it.marcaImpresa ? ` (${it.marcaImpresa})` : '');
          const poso = [it.dosis, it.via, it.frecuencia, it.duracion, it.cantidad ? `cantidad ${it.cantidad}` : null].filter(Boolean).join(' · ');
          parrafo(`• ${nombre}${poso ? ` — ${poso}` : ''}`, undefined, { x: X + 8, ancho: ANCHO - 8 });
        }
      }
    }
    if (a.constancias.length) {
      subtitulo('Constancias y descansos médicos');
      for (const c of a.constancias) {
        const tipo = c.tipo === 'descanso_medico' ? 'Descanso médico' : 'Constancia de atención';
        const rango = c.tipo === 'descanso_medico' && c.desde && c.hasta ? ` · ${c.dias} día(s), del ${soloFecha(c.desde)} al ${soloFecha(c.hasta)}` : '';
        parrafo(`${tipo} N° ${String(c.numero).padStart(5, '0')} · ${soloFecha(c.fechaEmision)} · ${c.emisorNombre}${c.diagnosticoCie10Codigo ? ` · ${c.diagnosticoCie10Codigo}` : ''}${rango}${c.estado === 'anulada' ? ' · ANULADA' : ''}`, undefined, { tam: 9 });
      }
    }
    if (a.consentimientos.length) {
      subtitulo('Consentimientos informados');
      for (const c of a.consentimientos) {
        parrafo(`N° ${String(c.numero).padStart(5, '0')} · ${c.procedimiento} · firmado por ${c.firmanteNombre} (${c.firmanteRelacion}) el ${fechaLima(c.firmadoEn)}${c.estado === 'revocado' ? ' · REVOCADO' : ''}`);
      }
    }
    if (a.fotos.length) {
      subtitulo(`Fotos clínicas (${a.fotos.length})`);
      if (!opts.fotos) parrafo('No incluidas en esta copia (se pueden incluir al generar el PDF).', undefined, { tam: 8.5, color: GRIS });
      else fotos(a);
    }
    y += 8;
  }

  // Miniaturas de las fotos (solo JPEG/PNG: pdfkit no incrusta WebP), 4 por fila con su leyenda.
  function fotos(a: Atencion) {
    const COL = 4, GAP = 8;
    const cw = (ANCHO - GAP * (COL - 1)) / COL, ch = cw * 0.75;
    let col = 0;
    for (const f of a.fotos.slice(0, MAX_FOTOS_ATENCION)) {
      const abs = path.resolve(UPLOADS_ROOT, f.ruta);
      const valida = abs.startsWith(UPLOADS_ROOT + path.sep) && fs.existsSync(abs) && /image\/(jpe?g|png)/.test(f.mime);
      const pesada = valida && f.tamano > MAX_FOTO_PDF;
      if (col === 0) asegurar(ch + 22);
      const x = X + col * (cw + GAP);
      doc.rect(x, y, cw, ch).fillAndStroke('#F4F6FA', LINEA);
      if (valida && !pesada) {
        try { doc.image(abs, x + 2, y + 2, { fit: [cw - 4, ch - 4], align: 'center', valign: 'center' }); } catch { /* imagen dañada: queda el recuadro */ }
      } else {
        doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(pesada ? 'Foto muy pesada: verla en el sistema' : 'Formato no imprimible', x + 2, y + ch / 2 - 4, { width: cw - 4, align: 'center' });
      }
      const leyenda = [f.zona, f.pie ? PIE_LABEL[f.pie] ?? f.pie : null, fechaLima(f.tomadaEn).split(' ·')[0]].filter(Boolean).join(' · ');
      doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(leyenda, x, y + ch + 2, { width: cw, lineBreak: false, ellipsis: true });
      col++;
      if (col === COL) { col = 0; y += ch + 14; }
    }
    if (col) y += ch + 14;
    if (a.fotos.length > MAX_FOTOS_ATENCION) parrafo(`… y ${a.fotos.length - MAX_FOTOS_ATENCION} foto(s) más en el sistema.`, undefined, { tam: 8, color: GRIS });
  }

  // ── Cierre y pie de cada hoja («página N de M») ──
  asegurar(24);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIS).text('— Fin de la historia clínica —', M, y + 6, { width: CONTENT_W, align: 'center' });
  const rango = doc.bufferedPageRange();
  const generado = fechaLima(new Date());
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    doc.rect(0, H - PIE, W, PIE).fill('#F2F4F6');
    doc.font('Helvetica').fontSize(7).fillColor(GRIS)
      .text(`${nombrePaciente} · ${numeroHc} · Documento confidencial (Ley 29733) · Generado el ${generado}`, M, H - PIE + 10, { width: CONTENT_W - 80, lineBreak: false, ellipsis: true })
      .text(`Página ${i - rango.start + 1} de ${rango.count}`, W - M - 80, H - PIE + 10, { width: 80, align: 'right', lineBreak: false });
  }
}

