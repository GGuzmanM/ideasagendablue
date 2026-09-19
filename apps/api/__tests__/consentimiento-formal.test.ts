/**
 * Consentimiento OFICIAL (18-sep-2026): plantilla por secciones, formulario al firmar, riesgos
 * premarcados desde la historia y aviso de los consentimientos que faltan por tratamiento.
 */
import {
  normalizarContenido, validarDatos, riesgosSugeridos, firmaVigente, consentimientosPendientes, trozosNegrita, textoPlano,
  esFormatoOficial, ErrorConsentimiento, type PlantillaResumen,
} from '../src/services/consentimientoFormal';
import oficial from './fixtures-consentimiento-matricectomia.json';

const UNERO = '3647867e-fd51-4a00-b423-9420c573b23f';
const MATRI = 'fd4e4404-e112-4a3f-ab5b-9ce1c45b546a';
const PROFILAXIS = 'c1328dba-3b96-4f21-96a7-8636a92ce40f';
const contenido = normalizarContenido({ ...oficial, servicioIds: [UNERO, MATRI] });

describe('Plantilla oficial de matricectomía', () => {
  it('se reconoce como formato oficial y conserva todas sus secciones', () => {
    expect(esFormatoOficial(oficial)).toBe(true);
    expect(contenido.beneficios).toHaveLength(6);
    expect(contenido.riesgos.frecuentes).toHaveLength(7);
    expect(contenido.riesgos.pocoFrecuentes).toHaveLength(8);
    expect(contenido.riesgos.raros).toHaveLength(5);
    expect(contenido.riesgosParticulares).toHaveLength(11);
    expect(contenido.alternativas).toHaveLength(6);
    expect(contenido.cuidados).toHaveLength(8);
    expect(contenido.campos.alcance).toEqual(['Parcial, un borde', 'Parcial, ambos bordes', 'Total']);
    expect(contenido.servicioIds).toEqual([UNERO, MATRI]);
  });

  it('una plantilla sin riesgos o sin alternativas no se acepta (no informa lo que exige la ley)', () => {
    expect(() => normalizarContenido({ ...oficial, riesgos: { frecuentes: [], pocoFrecuentes: [], raros: [] } })).toThrow(ErrorConsentimiento);
    expect(() => normalizarContenido({ ...oficial, alternativas: [] })).toThrow(/alternativas/);
  });

  it('descarta ids de servicio que no son ids', () => {
    expect(normalizarContenido({ ...oficial, servicioIds: ['<script>', UNERO, UNERO] }).servicioIds).toEqual([UNERO]);
  });

  it('las negritas se separan en trozos', () => {
    expect(trozosNegrita('se aplica **fenol** sobre la matriz')).toEqual([
      { t: 'se aplica ', b: false }, { t: 'fenol', b: true }, { t: ' sobre la matriz', b: false },
    ]);
  });
});

describe('Lo que se llena al firmar', () => {
  it('acepta dedos, alcance y riesgos de la plantilla', () => {
    const d = validarDatos({ dedos: '1er dedo pie derecho', alcance: 'Total', riesgos: ['Diabetes', 'Tabaquismo'], domicilio: 'Av. Siempre Viva 123' }, contenido, 'paciente');
    expect(d).toMatchObject({ dedos: '1er dedo pie derecho', alcance: 'Total', riesgos: ['Diabetes', 'Tabaquismo'], representante: null });
  });
  it('rechaza un alcance o un riesgo que la plantilla no ofrece', () => {
    expect(() => validarDatos({ alcance: 'Media uña' }, contenido, 'paciente')).toThrow(/alcance/);
    expect(() => validarDatos({ riesgos: ['Inventado'] }, contenido, 'paciente')).toThrow(/Riesgo no listado/);
  });
  it('si firma el representante, exige nombre, documento y parentesco', () => {
    expect(() => validarDatos({ representante: { nombre: 'Ana Pérez', documento: '12345678' } }, contenido, 'apoderado')).toThrow(/parentesco/);
    expect(validarDatos({ representante: { nombre: 'Ana Pérez', documento: '12345678', parentesco: 'Madre' } }, contenido, 'apoderado').representante)
      .toEqual({ nombre: 'Ana Pérez', documento: '12345678', parentesco: 'Madre' });
  });
  it('el testigo es opcional', () => {
    expect(validarDatos({}, contenido, 'paciente').testigo).toBeNull();
    expect(validarDatos({ testigo: { nombre: 'Luis Soto', documento: '87654321' } }, contenido, 'paciente').testigo).toEqual({ nombre: 'Luis Soto', documento: '87654321' });
  });
  it('el texto plano guarda lo marcado y la declaración con el procedimiento', () => {
    const d = validarDatos({ dedos: 'hallux derecho', alcance: 'Parcial, un borde', riesgos: ['Diabetes'] }, contenido, 'paciente');
    const t = textoPlano(contenido, d, { firmante: 'Carlos Guzmán', relacion: 'paciente' });
    expect(t).toContain('Alcance: Parcial, un borde');
    expect(t).toContain('☒ Diabetes');
    expect(t).toContain('matricectomía química con fenol de uña del pie');
    expect(t).not.toContain('**');
  });
});

describe('Riesgos premarcados desde la historia', () => {
  const casillas = contenido.riesgosParticulares;
  it('marca lo que la historia registra y nada más', () => {
    const r = riesgosSugeridos(casillas, { banderas: ['diabetes', 'anticoagulado', 'eap', 'tabaco'], alergiasActivas: 1, antecedentes: '' });
    expect(r).toEqual([
      'Diabetes', 'Tratamiento anticoagulante o antiagregante', 'Mala circulación en las piernas o los pies',
      'Alergia a anestésicos, al fenol o a algún medicamento', 'Tabaquismo',
    ]);
  });
  it('«Trastorno de la coagulación» no se confunde con anticoagulante', () => {
    expect(riesgosSugeridos(casillas, { banderas: ['anticoagulado'], alergiasActivas: 0, antecedentes: '' })).not.toContain('Trastorno de la coagulación');
    expect(riesgosSugeridos(casillas, { banderas: [], alergiasActivas: 0, antecedentes: 'Hemofilia A' })).toEqual(['Trastorno de la coagulación']);
  });
  it('embarazo y queloide salen de los antecedentes escritos (con o sin tildes)', () => {
    expect(riesgosSugeridos(casillas, { banderas: [], alergiasActivas: 0, antecedentes: 'Gestante de 20 semanas · cicatriz QUELOIDE en rodilla' }))
      .toEqual(['Embarazo o lactancia', 'Antecedente de cicatriz queloide o hipertrófica']);
  });
  it('sensibilidad disminuida (monofilamento) marca neuropatía', () => {
    expect(riesgosSugeridos(casillas, { banderas: ['psp'], alergiasActivas: 0, antecedentes: '' })).toEqual(['Pérdida de sensibilidad en los pies (neuropatía)']);
  });
});

describe('Qué consentimiento falta antes del tratamiento', () => {
  const p: PlantillaResumen = { id: 'pl-1', clave: 'matricectomia', nombre: 'Matricectomía', servicioIds: [UNERO, MATRI], vigenciaDias: 180 };
  const cita = new Date('2026-09-20T15:00:00Z');
  const firma = (dias: number, x: Partial<{ estado: string; citaId: string | null; plantillaClave: string | null }> = {}) => ({
    plantillaClave: 'matricectomia', plantillaId: 'pl-1', estado: 'firmado', citaId: null, firmadoEn: new Date(cita.getTime() - dias * 86_400_000), ...x,
  });

  it('una cita de Uñero sin firma → falta', () => {
    expect(consentimientosPendientes([p], [UNERO], [], cita, 'c1').map((x) => x.id)).toEqual(['pl-1']);
  });
  it('una cita de Profilaxis no pide este consentimiento', () => {
    expect(consentimientosPendientes([p], [PROFILAXIS], [], cita, 'c1')).toEqual([]);
  });
  it('en un bloque combinado cuenta el servicio de cualquiera de las dos citas', () => {
    expect(consentimientosPendientes([p], [PROFILAXIS, MATRI], [], cita, 'c1')).toHaveLength(1);
  });
  it('firmado hace 30 días (vigencia 180) → ya no falta', () => {
    expect(consentimientosPendientes([p], [UNERO], [firma(30)], cita, 'c1')).toEqual([]);
  });
  it('firmado hace 200 días → vuelve a faltar', () => {
    expect(consentimientosPendientes([p], [UNERO], [firma(200)], cita, 'c1')).toHaveLength(1);
  });
  it('revocado no cuenta', () => {
    expect(consentimientosPendientes([p], [UNERO], [firma(5, { estado: 'revocado' })], cita, 'c1')).toHaveLength(1);
  });
  it('firmado para ESTA cita cuenta aunque sea viejo', () => {
    expect(firmaVigente(p, [firma(400, { citaId: 'c1' })], cita, 'c1')).not.toBeNull();
  });
  it('firmado el mismo día, un rato después de la hora de la cita, también cuenta', () => {
    expect(firmaVigente(p, [firma(-0.25)], cita, 'c1')).not.toBeNull();
  });
  it('un consentimiento de OTRO procedimiento no cubre este', () => {
    expect(consentimientosPendientes([p], [UNERO], [firma(5, { plantillaClave: 'laser' }) as never].map((f) => ({ ...(f as object), plantillaId: 'otra' })) as never, cita, 'c1')).toHaveLength(1);
  });
});
