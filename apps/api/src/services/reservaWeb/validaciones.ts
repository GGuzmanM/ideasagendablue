/**
 * Validaciones de los datos del paciente en la RESERVA WEB (página pública y API del chat de WhatsApp).
 * Funciones puras (sin base de datos), compartidas por las dos entradas para que acepten exactamente lo mismo:
 *  · documento: DNI (8 dígitos) o CE, carné de extranjería (8 a 12 letras o números);
 *  · celular peruano: se acepta como lo escriba quien lo manda («987654321», «+51 987 654 321», «51987654321») y se
 *    guarda siempre como 9 dígitos que empiezan con 9;
 *  · correo: obligatorio en la página (le llega la confirmación); opcional en el chat.
 */
import { z } from 'zod';

export const TIPOS_DOCUMENTO_RESERVA = ['DNI', 'CE'] as const;
export type TipoDocumentoReserva = (typeof TIPOS_DOCUMENTO_RESERVA)[number];

/** Sin espacios ni guiones y en mayúsculas («ce 001-234-567» → «001234567»). */
export function normalizarDocumento(numero: string): string {
  return String(numero ?? '').replace(/[\s.\-]/g, '').toUpperCase();
}

export function documentoValido(tipo: TipoDocumentoReserva, numero: string): boolean {
  const n = normalizarDocumento(numero);
  return tipo === 'DNI' ? /^\d{8}$/.test(n) : /^[A-Z0-9]{8,12}$/.test(n);
}

export function mensajeDocumento(tipo: TipoDocumentoReserva): string {
  return tipo === 'DNI' ? 'El DNI tiene 8 dígitos' : 'El carné de extranjería tiene entre 8 y 12 letras o números';
}

/** Celular peruano a 9 dígitos (empieza con 9), o null si no lo es. */
export function normalizarCelular(texto: string): string | null {
  let d = String(texto ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('51')) d = d.slice(2);
  else if (d.length === 13 && d.startsWith('0051')) d = d.slice(4);
  return /^9\d{8}$/.test(d) ? d : null;
}

/** Campos del paciente (sin reglas cruzadas: sirve también con `.partial()`). `emailObligatorio`: la página lo exige; el chat no. */
export function camposPaciente(opts: { emailObligatorio: boolean }) {
  return z.object({
    tipoDocumento: z.enum(TIPOS_DOCUMENTO_RESERVA).default('DNI'),
    numeroDocumento: z.string().trim().min(1, 'Indica el número de documento').max(20),
    nombres: z.string().trim().min(2, 'Escribe los nombres').max(80),
    apellidoPaterno: z.string().trim().min(2, 'Escribe el apellido paterno').max(60),
    apellidoMaterno: z.string().trim().max(60).optional().nullable(),
    telefono: z.string().trim().min(1, 'Indica el celular').refine((t) => normalizarCelular(t) !== null, 'Celular de 9 dígitos que empiece con 9'),
    email: opts.emailObligatorio
      ? z.string().trim().email('Correo inválido').max(120)
      : z.union([z.literal(''), z.string().trim().email('Correo inválido').max(120)]).optional().nullable(),
  });
}

/** Revisa el documento según su tipo (DNI o CE). */
export function revisarDocumento(d: { tipoDocumento: TipoDocumentoReserva; numeroDocumento: string }, ctx: z.RefinementCtx) {
  if (!documentoValido(d.tipoDocumento, d.numeroDocumento)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numeroDocumento'], message: mensajeDocumento(d.tipoDocumento) });
  }
}

/** Deja los datos como se guardan: documento sin espacios, celular de 9 dígitos, correo en minúsculas o null. */
export function normalizarPaciente<T extends { numeroDocumento: string; telefono: string; email?: string | null; apellidoMaterno?: string | null }>(d: T) {
  return {
    ...d,
    numeroDocumento: normalizarDocumento(d.numeroDocumento),
    telefono: normalizarCelular(d.telefono) as string,
    email: d.email ? d.email.trim().toLowerCase() : null,
    apellidoMaterno: d.apellidoMaterno?.trim() || null,
  };
}

/** Esquema completo de los datos del paciente (ya normalizados). */
export function datosPacienteSchema(opts: { emailObligatorio: boolean }) {
  return camposPaciente(opts).superRefine(revisarDocumento).transform(normalizarPaciente);
}
