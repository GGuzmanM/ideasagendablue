/**
 * Reglas puras del aparato del consultorio: pantalla 16x2, hora real del botón, qué cita le toca
 * a un INICIO y formato de la clave del aparato.
 */
import {
  textoLcd, nombreCorto, formatoDuracion, horaLima, resolverHoraBoton, elegirCita, numeroTratamiento, PANTALLA, CitaCandidata,
} from '../src/services/tiempoReglas';
import { generarTokenDispositivo, leerTokenDispositivo, tokenCoincide } from '../src/middleware/authDispositivo';

jest.mock('../src/db', () => ({ prisma: {} }));

describe('Pantalla 16x2', () => {
  it('mayúsculas, sin tildes ni ñ y 16 caracteres como máximo', () => {
    expect(textoLcd('José Peña Ñuñez')).toBe('JOSE PENA NUNEZ');
    expect(textoLcd('Consultorio con nombre larguísimo').length).toBe(16);
    expect(textoLcd('  a\tb  ')).toBe('A B');
  });
  it('nombre corto = nombre de pila + inicial del apellido', () => {
    expect(nombreCorto('Rosa María', 'Mendoza')).toBe('ROSA M.');
    expect(nombreCorto('Maximiliano', 'Ñique')).toBe('MAXIMI N.');
    expect(nombreCorto('Ana', null)).toBe('ANA');
  });
  it('todas las pantallas entran en 2 líneas de 16', () => {
    const pantallas = [
      PANTALLA.disponible(3), PANTALLA.iniciado(nombreCorto('Maximiliano', 'Ñique'), '10:30', 2), PANTALLA.sinCita(),
      PANTALLA.sinLlegada(), PANTALLA.yaEnCurso('10:32'), PANTALLA.enCurso('ROSA M.'), PANTALLA.finalizado(99 * 3600 + 59 * 60 + 59),
      PANTALLA.finalizadoBloque(1, 1805, 2), PANTALLA.anulado(), PANTALLA.sinInicio(),
    ];
    expect(PANTALLA.sinCita()).toEqual(['SIN CITA ASIGN.', 'NO SE INICIO']);
    // Reposo: quién sigue (nombre corto de hasta 9 → «SIGUE: » + 9 = 16).
    const largo = nombreCorto('Maximiliano Andrés', 'Ñique');
    for (const [a, b] of [PANTALLA.siguiente(largo, null), PANTALLA.siguiente(largo, 2), PANTALLA.porLlegar(largo)]) {
      expect(a.length).toBeLessThanOrEqual(16); expect(b.length).toBeLessThanOrEqual(16);
    }
    expect(PANTALLA.siguiente('ROSA M.', null)).toEqual(['SIGUE: ROSA M.', 'PULSE INICIO']);
    expect(PANTALLA.siguiente('ROSA M.', 2)).toEqual(['SIGUE: ROSA M.', 'TRAT.2 > INICIO']);
    expect(PANTALLA.porLlegar('ROSA M.')).toEqual(['SIGUE: ROSA M.', 'FALTA "LLEGO"']);
    expect(PANTALLA.sinLlegada()).toEqual(['CITA SIN LLEGADA', 'MARCAR "LLEGO"']);
    for (const [a, b] of pantallas) { expect(a.length).toBeLessThanOrEqual(16); expect(b.length).toBeLessThanOrEqual(16); }
    expect(PANTALLA.disponible(3)).toEqual(['CONSULTORIO 03', 'DISPONIBLE']);
    expect(PANTALLA.finalizado(2530)).toEqual(['FIN 00:42:10', 'GUARDADO']);
    expect(PANTALLA.finalizadoBloque(1, 1805, 2)).toEqual(['TRAT.1 00:30:05', 'INICIO=TRAT.2']);
    expect(PANTALLA.iniciado('ROSA M.', '10:30', null)).toEqual(['INICIADO', 'ROSA M. 10:30']);
  });
  it('duración HH:MM:SS y hora de Lima', () => {
    expect(formatoDuracion(0)).toBe('00:00:00');
    expect(formatoDuracion(3725)).toBe('01:02:05');
    expect(horaLima(new Date('2026-09-14T15:07:00Z'))).toBe('10:07');
  });
});

describe('Hora real del botón', () => {
  const recibido = new Date('2026-09-14T15:00:00.000Z');
  it('usa la edad del evento (cola sin red) aunque el reloj del aparato esté mal', () => {
    const r = resolverHoraBoton({ recibidoEn: recibido, edadMs: 5 * 60_000, presionadoEn: '2020-01-01T00:00:00Z', ntp: true });
    expect(r).toEqual({ hora: new Date('2026-09-14T14:55:00.000Z'), aproximada: false });
  });
  it('sin edad, usa el reloj NTP del aparato si es creíble', () => {
    const r = resolverHoraBoton({ recibidoEn: recibido, presionadoEn: '2026-09-14T14:58:00Z', ntp: true });
    expect(r).toEqual({ hora: new Date('2026-09-14T14:58:00.000Z'), aproximada: false });
  });
  it('reloj sin NTP, del futuro o absurdo → hora del servidor, marcada aproximada', () => {
    expect(resolverHoraBoton({ recibidoEn: recibido, presionadoEn: '2026-09-14T14:58:00Z', ntp: false }).aproximada).toBe(true);
    expect(resolverHoraBoton({ recibidoEn: recibido, presionadoEn: '2026-09-14T16:00:00Z', ntp: true }).aproximada).toBe(true);
    expect(resolverHoraBoton({ recibidoEn: recibido, edadMs: -5 }).aproximada).toBe(true);
    expect(resolverHoraBoton({ recibidoEn: recibido }).hora).toEqual(recibido);
  });
});

describe('Qué cita le toca a un INICIO', () => {
  const c = (id: string, extra: Partial<CitaCandidata>): CitaCandidata => ({ id, estado: 'llego', horaInicio: '10:00', slotRol: null, tieneTiempo: false, ...extra });
  const diez = 10 * 60;
  it('primero la que recepción ya puso «En atención»', () => {
    expect(elegirCita([c('a', { horaInicio: '10:00' }), c('b', { estado: 'en_atencion', horaInicio: '11:00' })], diez)?.id).toBe('b');
  });
  it('luego la de hora más cercana', () => {
    expect(elegirCita([c('a', { horaInicio: '09:00' }), c('b', { horaInicio: '10:30' })], diez)?.id).toBe('b');
  });
  it('en un bloque, el 1º tratamiento antes que el 2º; con el 1º medido, el 2º', () => {
    const p = c('p', { slotRol: 'PRINCIPAL' }); const s = c('s', { slotRol: 'SECUNDARIO' });
    expect(elegirCita([s, p], diez)?.id).toBe('p');
    expect(elegirCita([s, { ...p, tieneTiempo: true }], diez)?.id).toBe('s');
  });
  it('ignora las ya medidas y las que no están en llegó/en atención; sin candidata → null (sin cita)', () => {
    expect(elegirCita([c('a', { tieneTiempo: true }), c('b', { estado: 'agendada' }), c('d', { estado: 'completada' })], diez)).toBeNull();
    expect(elegirCita([], diez)).toBeNull();
  });
  it('número de tratamiento del bloque', () => {
    expect(numeroTratamiento({ slotGrupoId: null, slotRol: null })).toBeNull();
    expect(numeroTratamiento({ slotGrupoId: 'g', slotRol: 'PRINCIPAL' })).toBe(1);
    expect(numeroTratamiento({ slotGrupoId: 'g', slotRol: 'SECUNDARIO' })).toBe(2);
  });
});

describe('Clave del aparato', () => {
  it('se genera, se lee del header y se valida contra su hash', () => {
    const { token, prefijo, hash } = generarTokenDispositivo();
    expect(token).toMatch(/^lbd_[a-f0-9]{12}\.[A-Za-z0-9_-]{32}$/);
    expect(leerTokenDispositivo(`Dispositivo ${token}`)).toEqual({ token, prefijo });
    expect(tokenCoincide(token, hash)).toBe(true);
    expect(tokenCoincide(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), hash)).toBe(false);
  });
  it('rechaza otros esquemas o formatos', () => {
    expect(leerTokenDispositivo('Bearer abc')).toBeNull();
    expect(leerTokenDispositivo('Dispositivo lbd_xyz.corto')).toBeNull();
    expect(leerTokenDispositivo(undefined)).toBeNull();
  });
});
