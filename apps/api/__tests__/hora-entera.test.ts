/**
 * Citas de 1 hora solo en hora entera (23-oct-2026): de 9 a 10, de 10 a 11…, nunca de 9:30 a 10:30.
 * Las de 30 min pueden empezar en cualquier media hora. Es la regla única que usan la disponibilidad,
 * crear, bloques combinados, reprogramar, intercambiar, cambiar de servicio y las pantallas.
 */
import { requiereHoraEntera, horaInicioValidaParaDuracion } from '@limablue/shared';

describe('Citas de 1 hora: solo en hora entera', () => {
  it('las de 30 min no la exigen; las de 60 (y múltiplos) sí', () => {
    expect(requiereHoraEntera(30)).toBe(false);
    expect(requiereHoraEntera(60)).toBe(true);
    expect(requiereHoraEntera(120)).toBe(true);
    expect(requiereHoraEntera(90)).toBe(false);
  });

  it('1 hora: 09:00, 10:00, 13:00 sí; 11:30, 12:30, 13:30 no', () => {
    for (const h of ['08:00', '09:00', '10:00', '13:00', '19:00']) expect(horaInicioValidaParaDuracion(h, 60)).toBe(true);
    for (const h of ['08:30', '11:30', '12:30', '13:30']) expect(horaInicioValidaParaDuracion(h, 60)).toBe(false);
  });

  it('30 min: cualquier media hora', () => {
    for (const h of ['09:00', '09:30', '11:30', '13:30']) expect(horaInicioValidaParaDuracion(h, 30)).toBe(true);
  });
});
