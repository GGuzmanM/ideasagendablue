/**
 * Almuerzo y sede (24-sep-2026, caso Raysa): tenía un almuerzo en One (14–15) estando asignada a Lince. La agenda de
 * Lince no lo mostraba, pero bloqueaba agendar de 2 a 3. Reglas que quedan blindadas:
 *  - No se registra un almuerzo en una sede donde la profesional NO está ese día (si está asignada a otra).
 *  - Sin ninguna asignación (caso raro), se sigue permitiendo como antes.
 */
const asignacionFindFirst = jest.fn();
const citaFindMany = jest.fn();
const bloqueoFindMany = jest.fn();
const bloqueoCreate = jest.fn();
jest.mock('../src/db', () => ({
  prisma: {
    asignacionSede: { findFirst: (...a: unknown[]) => asignacionFindFirst(...a) },
    cita: { findMany: (...a: unknown[]) => citaFindMany(...a) },
    bloqueoAgenda: { findMany: (...a: unknown[]) => bloqueoFindMany(...a), update: jest.fn(), create: (...a: unknown[]) => bloqueoCreate(...a) },
  },
}));

import { crearAlmuerzo } from '../src/services/almuerzoService';

const base = { profesionalId: 'raysa', sedeId: 'one', horaInicio: '14:00', creadoPor: 'u1', fecha: '2026-09-25' };

beforeEach(() => {
  jest.clearAllMocks();
  citaFindMany.mockResolvedValue([]);
  bloqueoFindMany.mockResolvedValue([]);
  bloqueoCreate.mockResolvedValue({});
});

describe('Almuerzo solo en la sede donde está la profesional', () => {
  it('asignada a OTRA sede ese día → se rechaza y dice dónde registrarlo', async () => {
    asignacionFindFirst
      .mockResolvedValueOnce(null) // no está en One
      .mockResolvedValueOnce({ sede: { nombre: 'Lince' }, profesional: { nombres: 'Raysa Alessandra' } });
    await expect(crearAlmuerzo(base)).rejects.toMatchObject({ statusCode: 422, code: 'ALMUERZO_OTRA_SEDE' });
    expect(bloqueoCreate).not.toHaveBeenCalled();
  });

  it('asignada a ESA sede → se crea en esa sede', async () => {
    asignacionFindFirst.mockResolvedValueOnce({ fechaFin: null });
    await crearAlmuerzo({ ...base, sedeId: 'lince' });
    expect(bloqueoCreate).toHaveBeenCalledTimes(1);
    expect(bloqueoCreate.mock.calls[0][0].data).toMatchObject({ sedeId: 'lince', horaInicio: '14:00', horaFin: '15:00', esRecurrente: true });
  });

  it('sin ninguna asignación → se permite como antes', async () => {
    asignacionFindFirst.mockResolvedValue(null);
    await crearAlmuerzo(base);
    expect(bloqueoCreate).toHaveBeenCalledTimes(1);
  });
});

// 30-sep-2026 (caso Doris Marquina): el break del mes no rige sábado ni domingo, así que una cita del SÁBADO a esa
// hora no frena el almuerzo; una de lunes a viernes sí.
describe('Almuerzo del mes: sábado y domingo no cuentan como choque', () => {
  const cita = (fecha: string, horaInicio: string) => ({ fecha: new Date(`${fecha}T00:00:00.000Z`), horaInicio, duracionMinutos: 60, paciente: { nombres: 'Eileen', apellidoPaterno: 'SOTO' } });
  const doris = { profesionalId: 'doris', sedeId: 'one', horaInicio: '13:00', creadoPor: 'u1', fecha: '2026-10-01' };

  it('cita el sábado 03/10 a las 13:00 → el break de 13:00 se asigna igual', async () => {
    asignacionFindFirst.mockResolvedValueOnce({ fechaFin: null });
    citaFindMany.mockResolvedValue([cita('2026-10-03', '13:00')]);
    await crearAlmuerzo(doris);
    expect(bloqueoCreate).toHaveBeenCalledTimes(1);
  });

  it('cita el domingo a las 13:00 → tampoco frena', async () => {
    asignacionFindFirst.mockResolvedValueOnce({ fechaFin: null });
    citaFindMany.mockResolvedValue([cita('2026-10-04', '13:00')]);
    await crearAlmuerzo(doris);
    expect(bloqueoCreate).toHaveBeenCalledTimes(1);
  });

  it('cita un viernes a las 13:00 → sí frena (tapa a un paciente)', async () => {
    asignacionFindFirst.mockResolvedValueOnce({ fechaFin: null });
    citaFindMany.mockResolvedValue([cita('2026-10-02', '13:00')]);
    await expect(crearAlmuerzo(doris)).rejects.toMatchObject({ statusCode: 409, code: 'CITAS_EN_RANGO' });
    expect(bloqueoCreate).not.toHaveBeenCalled();
  });
});
