/**
 * Médico de la cita (18-sep-2026): quién puede tomar / soltar / asignar, a nombre de quién sale la
 * receta médica, que recepción no vea su contenido y que la firma sea una imagen de verdad.
 */
import { decidirCambioMedico, firmanteReceta, type ActorMedico, type EstadoCitaMedico } from '../src/services/medicoCitaReglas';
import { ocultarRecetasMedicas } from '../src/services/recetaVisibilidad';

jest.mock('../src/db', () => ({ prisma: {} }));
const { tipoImagenFirma } = require('../src/routes/firmaMedico');

const DRA = 'medico-a';
const DRB = 'medico-b';
const medico = (id = DRA): ActorMedico => ({ profesionalId: id, esMedico: true, puedeAsignar: false, puedeAutoasignar: true });
const coordinacion: ActorMedico = { profesionalId: null, esMedico: false, puedeAsignar: true, puedeAutoasignar: false };
const recepcion: ActorMedico = { profesionalId: null, esMedico: false, puedeAsignar: false, puedeAutoasignar: false };
const cita = (x: Partial<EstadoCitaMedico> = {}): EstadoCitaMedico => ({ medicoId: null, estado: 'agendada', tieneRecetaVigente: false, ...x });

describe('Médico de la cita: tomar, soltar y asignar', () => {
  it('un médico toma una cita libre', () => {
    expect(decidirCambioMedico(medico(), cita(), { accion: 'tomar' })).toEqual({ ok: true, medicoId: DRA, sinCambio: false });
  });

  it('tomar una cita que ya es suya no cambia nada', () => {
    expect(decidirCambioMedico(medico(), cita({ medicoId: DRA }), { accion: 'tomar' })).toMatchObject({ ok: true, sinCambio: true });
  });

  it('NO puede quitarle la cita a otro médico', () => {
    expect(decidirCambioMedico(medico(), cita({ medicoId: DRB }), { accion: 'tomar' })).toMatchObject({ ok: false, status: 409, code: 'CITA_TOMADA' });
  });

  it('recepción no puede tomar ni asignar', () => {
    expect(decidirCambioMedico(recepcion, cita(), { accion: 'tomar' })).toMatchObject({ ok: false, status: 403 });
    expect(decidirCambioMedico(recepcion, cita(), { accion: 'asignar', medicoId: DRA })).toMatchObject({ ok: false, status: 403 });
    expect(decidirCambioMedico(recepcion, cita({ medicoId: DRA }), { accion: 'soltar' })).toMatchObject({ ok: false, status: 403 });
  });

  it('coordinación no se "toma" una cita (no es médico), pero asigna a cualquiera', () => {
    expect(decidirCambioMedico(coordinacion, cita(), { accion: 'tomar' })).toMatchObject({ ok: false, code: 'SOLO_MEDICO' });
    expect(decidirCambioMedico(coordinacion, cita({ medicoId: DRB }), { accion: 'asignar', medicoId: DRA })).toEqual({ ok: true, medicoId: DRA, sinCambio: false });
    expect(decidirCambioMedico(coordinacion, cita({ medicoId: DRB }), { accion: 'asignar', medicoId: null })).toMatchObject({ ok: true, medicoId: null });
  });

  it('un médico no puede asignar a otro médico', () => {
    expect(decidirCambioMedico(medico(), cita(), { accion: 'asignar', medicoId: DRB })).toMatchObject({ ok: false, status: 403 });
  });

  it('el médico suelta SU cita, no la de otro', () => {
    expect(decidirCambioMedico(medico(), cita({ medicoId: DRA }), { accion: 'soltar' })).toEqual({ ok: true, medicoId: null, sinCambio: false });
    expect(decidirCambioMedico(medico(), cita({ medicoId: DRB }), { accion: 'soltar' })).toMatchObject({ ok: false, code: 'NO_ES_TU_CITA' });
  });

  it('con receta médica emitida el médico ya no la suelta; coordinación sí puede cambiarla', () => {
    expect(decidirCambioMedico(medico(), cita({ medicoId: DRA, tieneRecetaVigente: true }), { accion: 'soltar' })).toMatchObject({ ok: false, code: 'TIENE_RECETA' });
    expect(decidirCambioMedico(coordinacion, cita({ medicoId: DRA, tieneRecetaVigente: true }), { accion: 'soltar' })).toMatchObject({ ok: true, medicoId: null });
  });

  it.each(['cancelada', 'reprogramada', 'no_show'])('cita %s: ya no admite cambios de médico', (estado) => {
    expect(decidirCambioMedico(medico(), cita({ estado }), { accion: 'tomar' })).toMatchObject({ ok: false, code: 'CITA_NO_ACTIVA' });
    expect(decidirCambioMedico(coordinacion, cita({ estado }), { accion: 'asignar', medicoId: DRA })).toMatchObject({ ok: false, code: 'CITA_NO_ACTIVA' });
  });

  it('una cita ya atendida (completada) sí admite médico: la receta se hace al final', () => {
    expect(decidirCambioMedico(medico(), cita({ estado: 'completada' }), { accion: 'tomar' })).toMatchObject({ ok: true, medicoId: DRA });
  });
});

describe('A nombre de quién sale la receta médica', () => {
  it('médico en cita sin médico: sale a su nombre y se le asigna la cita', () => {
    expect(firmanteReceta({ actorMedicoId: DRA, medicoCitaId: null })).toEqual({ ok: true, medicoId: DRA, autoasignar: true });
  });
  it('médico en SU cita: a su nombre, sin reasignar', () => {
    expect(firmanteReceta({ actorMedicoId: DRA, medicoCitaId: DRA })).toEqual({ ok: true, medicoId: DRA, autoasignar: false });
  });
  it('médico en la cita de OTRO médico: no puede', () => {
    expect(firmanteReceta({ actorMedicoId: DRA, medicoCitaId: DRB })).toMatchObject({ ok: false, code: 'CITA_DE_OTRO_MEDICO' });
  });
  it('coordinación/admin: a nombre del médico de la cita', () => {
    expect(firmanteReceta({ actorMedicoId: null, medicoCitaId: DRB })).toEqual({ ok: true, medicoId: DRB, autoasignar: false });
  });
  it('coordinación/admin en cita sin médico: primero hay que asignarlo', () => {
    expect(firmanteReceta({ actorMedicoId: null, medicoCitaId: null })).toMatchObject({ ok: false, code: 'SIN_MEDICO_ASIGNADO' });
  });
});

describe('Receta médica reservada (recepción ve que existe, no su contenido)', () => {
  const atencion = {
    id: 'a1',
    fecha: new Date('2026-09-18T00:00:00Z'),
    recetas: [
      { id: 'r1', numero: 12, tipoDocumento: 'RECETA_MEDICA', estado: 'emitida', fechaEmision: new Date('2026-09-18T15:00:00Z'), emisorNombre: 'Dra. A', codigoVerificacion: 'ABCD1234', indicacionesGenerales: 'Reposo', items: [{ nombre: 'Terbinafina' }] },
      { id: 'r2', numero: 13, tipoDocumento: 'INDICACIONES_PODOLOGICAS', estado: 'emitida', fechaEmision: new Date('2026-09-18T15:00:00Z'), emisorNombre: 'Pod. B', codigoVerificacion: 'EFGH5678', items: [{ nombre: 'Crema' }] },
    ],
  };

  it('la receta médica llega sin ítems, sin indicaciones y sin código', () => {
    const r = ocultarRecetasMedicas(atencion);
    expect(r.recetas[0]).toMatchObject({ id: 'r1', numero: 12, emisorNombre: 'Dra. A', items: [], indicacionesGenerales: null, codigoVerificacion: null, reservada: true });
    expect(JSON.stringify(r)).not.toContain('Terbinafina');
    expect(JSON.stringify(r)).not.toContain('ABCD1234');
  });

  it('las indicaciones podológicas llegan completas', () => {
    const r = ocultarRecetasMedicas(atencion);
    expect(r.recetas[1]).toEqual(atencion.recetas[1]);
  });

  it('no toca el original y respeta las fechas', () => {
    const r = ocultarRecetasMedicas(atencion);
    expect(atencion.recetas[0].items).toHaveLength(1);
    expect(r.fecha).toBeInstanceOf(Date);
  });

  it('funciona también en listas anidadas (historia → atenciones → recetas)', () => {
    const r = ocultarRecetasMedicas({ historia: { atenciones: [atencion, atencion] } });
    expect(r.historia.atenciones.every((a) => a.recetas[0].items.length === 0)).toBe(true);
  });

  it('una favorita (sin número) no se confunde con una receta emitida', () => {
    const fav = { id: 'f1', nombre: 'Onicomicosis', tipoDocumento: 'RECETA_MEDICA', items: [{ nombre: 'Terbinafina' }] };
    expect(ocultarRecetasMedicas(fav)).toEqual(fav);
  });
});

describe('Firma digitalizada: solo imágenes reales', () => {
  it('reconoce PNG y JPG por sus bytes', () => {
    expect(tipoImagenFirma(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(tipoImagenFirma(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });
  it('rechaza lo que no es imagen aunque se llame .png', () => {
    expect(tipoImagenFirma(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(tipoImagenFirma(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});
