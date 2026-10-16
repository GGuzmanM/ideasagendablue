/**
 * Genera el PDF del contrato de membresía PRE-LLENADO: carga la plantilla subida y estampa
 * los datos del paciente (nombre, DNI, fecha) en las posiciones marcadas una vez en el
 * constructor. Usa pdf-lib (sin navegador). El tamaño de fuente se auto-reduce para que un
 * nombre largo nunca se desborde del ancho disponible.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { leerArchivo, guardarArchivo } from './almacenArchivos';

export type CampoContrato = 'nombre' | 'dni' | 'fecha';

export interface PosicionCampo {
  campo: CampoContrato;
  pagina: number; // 0-based
  xPct: number;   // 0..1 desde la izquierda
  yPct: number;   // 0..1 desde ARRIBA (como se ve en pantalla)
  tamanio?: number; // pt (default 12)
  anchoPct?: number; // ancho disponible en % de la página, para auto-encoger (default 0.5)
}

export interface DatosPacienteContrato {
  nombreCompleto: string;
  documento: string;
  fecha: string; // "dd/MM/yyyy"
}

/** URL del contrato (…/uploads/contratos/x.pdf) → bytes del PDF guardado en la base. */
export async function leerPdfContrato(url: string): Promise<Buffer | null> {
  const idx = url.indexOf('/uploads/');
  const rel = (idx >= 0 ? url.slice(idx + '/uploads/'.length) : url).split('?')[0];
  return (await leerArchivo(rel))?.datos ?? null;
}

const VALOR_POR_CAMPO = (d: DatosPacienteContrato): Record<CampoContrato, string> => ({
  nombre: d.nombreCompleto,
  dni: d.documento,
  fecha: d.fecha,
});

/**
 * Carga la plantilla y estampa los campos. Devuelve los bytes del PDF resultante.
 * `campos` puede venir de `Paquete.contratoCampos` (Json). Ignora entradas mal formadas.
 */
export async function generarContratoPdf(
  plantillaUrl: string,
  campos: PosicionCampo[],
  datos: DatosPacienteContrato,
): Promise<Uint8Array> {
  const plantilla = await leerPdfContrato(plantillaUrl);
  if (!plantilla) throw new Error('No se encontró el archivo de la plantilla del contrato');

  const pdf = await PDFDocument.load(plantilla);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const paginas = pdf.getPages();
  const valores = VALOR_POR_CAMPO(datos);

  for (const c of campos) {
    const texto = valores[c.campo];
    if (!texto) continue;
    const page = paginas[c.pagina ?? 0];
    if (!page) continue;
    const { width, height } = page.getSize();

    let size = c.tamanio ?? 12;
    const anchoMax = (c.anchoPct ?? 0.5) * width;
    // Auto-encoge para que quepa en el ancho disponible (mín. 6pt).
    while (size > 6 && font.widthOfTextAtSize(texto, size) > anchoMax) size -= 0.5;

    const x = (c.xPct ?? 0) * width;
    // yPct viene desde arriba; pdf-lib mide desde abajo. Restamos el alto del texto.
    const y = height - (c.yPct ?? 0) * height - size;

    page.drawText(texto, { x, y, size, font, color: rgb(0.06, 0.09, 0.16) });
  }

  return pdf.save();
}

/** Guarda el contrato generado en la base (contratos/<nombre>) y devuelve su URL. */
export async function guardarContratoGenerado(bytes: Uint8Array, baseUrl: string): Promise<{ url: string; nombre: string }> {
  const nombre = `contrato_gen_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
  await guardarArchivo(`contratos/${nombre}`, Buffer.from(bytes), 'application/pdf');
  return { url: `${baseUrl}/uploads/contratos/${nombre}`, nombre };
}
