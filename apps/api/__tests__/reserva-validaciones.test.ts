/**
 * Reserva web sin pasarela (29-oct-2026): lo que aceptan por igual la página /reserva y la API del chat de WhatsApp
 * para el paciente: documento DNI o CE, celular peruano en varios formatos y correo opcional en el chat.
 */
import { datosPacienteSchema, documentoValido, normalizarCelular, normalizarDocumento } from '../src/services/reservaWeb/validaciones';

const base = { nombres: 'Ana', apellidoPaterno: 'Quispe', telefono: '987654321' };

describe('Documento: DNI o CE', () => {
  it('DNI: 8 dígitos', () => {
    expect(documentoValido('DNI', '75010274')).toBe(true);
    expect(documentoValido('DNI', '7501027')).toBe(false);
    expect(documentoValido('DNI', '7501027A')).toBe(false);
  });
  it('CE: 8 a 12 letras o números (sin espacios ni guiones)', () => {
    expect(documentoValido('CE', '001234567')).toBe(true);
    expect(documentoValido('CE', 'ce-0012 34567'.replace(/^ce-/i, ''))).toBe(true);
    expect(documentoValido('CE', '1234567')).toBe(false);
    expect(documentoValido('CE', '1234567890123')).toBe(false);
  });
  it('se guarda sin espacios, guiones ni minúsculas', () => {
    expect(normalizarDocumento(' ab-123 456 ')).toBe('AB123456');
  });
});

describe('Celular peruano', () => {
  it.each(['987654321', '+51 987 654 321', '51987654321', '987-654-321', '0051987654321'])('acepta %s', (t) => {
    expect(normalizarCelular(t)).toBe('987654321');
  });
  it.each(['87654321', '887654321', '9876543210', 'abc', ''])('rechaza «%s»', (t) => {
    expect(normalizarCelular(t)).toBeNull();
  });
});

describe('Datos del paciente', () => {
  const chat = datosPacienteSchema({ emailObligatorio: false });
  const pagina = datosPacienteSchema({ emailObligatorio: true });

  it('el tipo de documento es DNI si no se indica', () => {
    expect(chat.parse({ ...base, numeroDocumento: '75010274' }).tipoDocumento).toBe('DNI');
  });
  it('acepta un CE y lo deja normalizado', () => {
    const r = chat.parse({ ...base, tipoDocumento: 'CE', numeroDocumento: '001-234-567', telefono: '+51 987 654 321' });
    expect(r).toMatchObject({ tipoDocumento: 'CE', numeroDocumento: '001234567', telefono: '987654321', email: null });
  });
  it('rechaza un DNI mal escrito y explica por qué', () => {
    const r = chat.safeParse({ ...base, tipoDocumento: 'DNI', numeroDocumento: '1234' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['numeroDocumento'], message: 'El DNI tiene 8 dígitos' });
  });
  it('rechaza un tipo de documento que no sea DNI ni CE', () => {
    expect(chat.safeParse({ ...base, tipoDocumento: 'PASAPORTE', numeroDocumento: '12345678' }).success).toBe(false);
  });
  it('el chat puede omitir el correo; la página no', () => {
    expect(chat.safeParse({ ...base, numeroDocumento: '75010274' }).success).toBe(true);
    expect(chat.safeParse({ ...base, numeroDocumento: '75010274', email: '' }).success).toBe(true);
    expect(pagina.safeParse({ ...base, numeroDocumento: '75010274' }).success).toBe(false);
    expect(pagina.parse({ ...base, numeroDocumento: '75010274', email: ' Ana@Correo.PE ' }).email).toBe('ana@correo.pe');
  });
  it('rechaza un correo mal escrito y un celular que no es peruano', () => {
    expect(chat.safeParse({ ...base, numeroDocumento: '75010274', email: 'ana@' }).success).toBe(false);
    expect(chat.safeParse({ ...base, numeroDocumento: '75010274', telefono: '12345' }).success).toBe(false);
  });
});
