// Fechas en la historia clínica. Dos casos distintos que NO se deben mezclar:
//  · Una FECHA de calendario (columna @db.Date: fecha de la atención, control sugerido, cita) llega como
//    «2026-09-15…» anclada a mediodía UTC → se muestra tal cual con `fmtFechaDia`.
//  · Un MOMENTO (timestamp: foto tomada, nota creada, receta emitida) llega en UTC → hay que pasarlo a
//    la hora de Lima antes de sacar el día, si no una foto de las 19:30 sale con la fecha de mañana.
const LIMA = 'America/Lima';

export const fmtFechaDia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export const fmtFechaLima = (iso: string) =>
  new Date(iso).toLocaleDateString('es-PE', { timeZone: LIMA, day: '2-digit', month: '2-digit', year: 'numeric' });

export const fmtFechaHoraLima = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: LIMA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Día de Lima («2026-09-15») de un momento, para agrupar o comparar. */
export const diaLima = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: LIMA }).format(new Date(iso));
