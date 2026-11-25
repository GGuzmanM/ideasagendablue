// 25-nov-2026: tratamiento de Fisioterapia (la tabla de la hoja «Evaluación fisioterapéutica») y su PDF en media hoja.
import { TRATAMIENTOS_FISIO, CLAVES_TRATAMIENTO_FISIO, TIPO_FISIO, MAX_COMENTARIO_FISIO, claveDeFila, comentarioDeFila, patologiasDeFila, diagnosticosDeLaHoja, tratamientoDeFilas, type EvaluacionFisioPdf } from '../src/services/tratamientoFisio';
import { escribirEvaluacionFisioPdf } from '../src/services/evaluacionFisioPdf';
import { pdfABuffer } from '../src/services/pdfComun';
// La pantalla repite el catálogo: esta prueba los mantiene iguales.
import { TRATAMIENTOS_FISIO as EN_PANTALLA, MAX_COMENTARIO_FISIO as MAX_EN_PANTALLA, planDeProcedimientos, planAEnvio, patologiasEnHoja } from '../../web/src/components/historiaClinica/tratamientoFisio';

const fila = (clave: string | null, extra: Partial<{ tipo: string; nombre: string; comentario: string; sesionesTotales: number | null }> = {}) => ({
  tipo: extra.tipo ?? TIPO_FISIO, nombre: extra.nombre ?? 'x', sesionesTotales: extra.sesionesTotales ?? null,
  parametros: clave ? { clave, ...(extra.comentario ? { comentario: extra.comentario } : {}) } : null,
});

describe('catálogo de tratamientos de fisioterapia', () => {
  it('son los 16 de la hoja de papel, en su orden, sin claves repetidas', () => {
    expect(TRATAMIENTOS_FISIO).toHaveLength(16);
    expect(new Set(CLAVES_TRATAMIENTO_FISIO).size).toBe(16);
    expect(TRATAMIENTOS_FISIO[0].nombre).toBe('Compresa húmeda caliente');
    expect(TRATAMIENTOS_FISIO[8].nombre).toBe('Láser de alta gama'); // primera de la columna derecha
    expect(TRATAMIENTOS_FISIO[15].nombre).toBe('Descarga muscular');
  });
  it('la pantalla y el servidor tienen la misma lista y el mismo tope de comentario', () => {
    expect(EN_PANTALLA.map((t) => [t.clave, t.nombre])).toEqual(TRATAMIENTOS_FISIO.map((t) => [t.clave, t.nombre]));
    expect(MAX_EN_PANTALLA).toBe(MAX_COMENTARIO_FISIO);
  });
});

describe('lo marcado en una atención', () => {
  it('solo cuentan las filas de fisio con clave; salen en el orden de la hoja, con UN comentario general', () => {
    const r = tratamientoDeFilas([
      fila('magnetoterapia', { comentario: 'Lumbar, 20 min y ejercicios en casa', sesionesTotales: 10 }),
      fila('ultrasonido', { comentario: 'Lumbar, 20 min y ejercicios en casa', sesionesTotales: 10 }),
      fila(null),                                                  // fila de fisio sin clave: se ignora
      fila('laser', { tipo: 'laser', comentario: 'no cuenta' }),   // un láser de podología no es de esta lista
      { tipo: 'otro', nombre: 'Vendaje', sesionesTotales: null, parametros: null },
    ]);
    expect(r.tratamientos).toEqual([{ clave: 'ultrasonido', nombre: 'Ultrasonido' }, { clave: 'magnetoterapia', nombre: 'Magnetoterapia' }]);
    expect(r.comentario).toBe('Lumbar, 20 min y ejercicios en casa');
    expect(r.sesiones).toBe(10);
    expect(claveDeFila(fila('laser', { tipo: 'laser' }))).toBeNull();
    expect(comentarioDeFila(fila('laser', { tipo: 'laser', comentario: 'x' }))).toBeNull();
    expect(comentarioDeFila({ tipo: TIPO_FISIO, parametros: { clave: 'laser', comentario: '   ' } })).toBeNull();
  });
  it('un tratamiento retirado del catálogo conserva el nombre con que se guardó', () => {
    const r = tratamientoDeFilas([fila('crioterapia_vieja', { nombre: 'Crioterapia' })]);
    expect(r).toEqual({ tratamientos: [{ clave: 'crioterapia_vieja', nombre: 'Crioterapia' }], comentario: null, sesiones: null, patologias: null });
  });
  it('la pantalla lee lo mismo y arma el envío (sin comentario ni sesiones si no hay nada marcado)', () => {
    const procs = [
      { tipo: 'fisioterapia', parametros: { clave: 'tecarterapia', comentario: ' Hombro izquierdo ' }, detalle: null, sesionesTotales: 6 },
      { tipo: 'fisioterapia', parametros: { clave: 'compresa_fria', comentario: ' Hombro izquierdo ' }, detalle: null, sesionesTotales: 6 },
      { tipo: 'curacion', parametros: null, detalle: 'x', sesionesTotales: null },
    ] as never;
    const plan = planDeProcedimientos(procs);
    expect(plan).toEqual({ marcados: ['tecarterapia', 'compresa_fria'], comentario: ' Hombro izquierdo ', sesiones: 6, dxExtra: [], dxFuera: [] });
    expect(planAEnvio(plan)).toEqual({ tratamientos: ['compresa_fria', 'tecarterapia'], comentario: 'Hombro izquierdo', sesiones: 6, patologias: null });
    expect(planAEnvio({ marcados: [], comentario: 'algo', sesiones: 8, dxExtra: [{ codigo: 'M54.5', descripcion: 'Lumbago' }], dxFuera: [] }))
      .toEqual({ tratamientos: [], comentario: null, sesiones: null, patologias: null });
  });
});

describe('patologías que salen en la hoja impresa', () => {
  const deLaAtencion = [{ codigo: 'M54.5', descripcion: 'Lumbago no especificado' }, { codigo: 'M25.5', descripcion: 'Dolor en articulación' }];
  const guardado = { incluir: [{ codigo: 'M20.1', descripcion: 'Hallux valgus (adquirido)' }, { codigo: 'M54.5', descripcion: 'Lumbago no especificado' }], excluir: ['M25.5'] };

  it('sin elegir nada salen los diagnósticos de la atención', () => {
    expect(diagnosticosDeLaHoja(deLaAtencion, null)).toEqual(deLaAtencion);
  });
  it('se quitan los excluidos y se agregan las del historial, sin repetir un código', () => {
    expect(diagnosticosDeLaHoja(deLaAtencion, guardado)).toEqual([
      { codigo: 'M54.5', descripcion: 'Lumbago no especificado' },
      { codigo: 'M20.1', descripcion: 'Hallux valgus (adquirido)' },
    ]);
    // Todo quitado y nada agregado → la hoja queda con el renglón en blanco
    expect(diagnosticosDeLaHoja(deLaAtencion, { incluir: [], excluir: ['M54.5', 'M25.5'] })).toEqual([]);
  });
  it('se lee de la fila (tolerando basura) y la pantalla aplica la misma regla', () => {
    const f = { tipo: TIPO_FISIO, nombre: 'x', sesionesTotales: null, parametros: { clave: 'laser', patologias: { ...guardado, incluir: [...guardado.incluir, { codigo: 7 }, null] } } };
    expect(patologiasDeFila(f)).toEqual(guardado);
    expect(patologiasDeFila({ tipo: TIPO_FISIO, parametros: { clave: 'laser', patologias: { incluir: [], excluir: [] } } })).toBeNull();
    expect(patologiasDeFila({ tipo: 'laser', parametros: { patologias: guardado } })).toBeNull();
    expect(tratamientoDeFilas([f]).patologias).toEqual(guardado);

    const plan = planDeProcedimientos([{ tipo: 'fisioterapia', parametros: f.parametros, detalle: null, sesionesTotales: null }] as never);
    expect(plan.dxExtra).toEqual(guardado.incluir);
    expect(plan.dxFuera).toEqual(['M25.5']);
    expect(planAEnvio(plan).patologias).toEqual({ incluir: ['M20.1', 'M54.5'], excluir: ['M25.5'] });
    expect(patologiasEnHoja(deLaAtencion, plan)).toEqual(diagnosticosDeLaHoja(deLaAtencion, guardado));
  });
});

describe('PDF «Evaluación fisioterapéutica» (media hoja)', () => {
  const base: EvaluacionFisioPdf = {
    atencionId: 'a', pacienteId: 'p', sedeId: 's', fecha: new Date('2026-11-25T12:00:00Z'), motivoConsulta: 'Dolor lumbar',
    paciente: { nombres: 'María', apellidoPaterno: 'Pérez', apellidoMaterno: 'Ñaupari', tipoDocumento: 'DNI', numeroDocumento: '12345678', fechaNacimiento: new Date('1990-05-10T12:00:00Z') },
    profesional: 'Alicia Cisneros', sede: { nombre: 'Paz Soldán', direccion: 'Av. Paz Soldán 235' }, servicio: 'Evaluación FI', numeroHc: 2988,
    antecedentes: [], diagnosticos: [], sesiones: null, comentario: null, marcados: [], puntos: [],
  };
  const paginas = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

  it('se genera vacía (renglones para escribir a mano), en una sola página', async () => {
    const pdf = await pdfABuffer('Evaluación fisioterapéutica', (doc) => escribirEvaluacionFisioPdf(doc, base));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(paginas(pdf)).toBe(1);
  });
  it('llena hasta el tope sigue en UNA página: lo largo se recorta, no pasa a otra hoja', async () => {
    const lleno: EvaluacionFisioPdf = {
      ...base,
      antecedentes: ['Hipertensión arterial', 'Cirugía de rodilla derecha (2019)', 'Diabetes mellitus tipo 2 en tratamiento con metformina', 'Alergia a AINES', 'Fractura de tobillo izquierdo en 2015'],
      diagnosticos: [{ codigo: 'M54.5', descripcion: 'Lumbago no especificado' }, { codigo: 'M25.5', descripcion: 'Dolor en articulación' }, { codigo: 'M79.1', descripcion: 'Mialgia' }, { codigo: 'M20.1', descripcion: 'Hallux valgus (adquirido)' }],
      sesiones: 10,
      comentario: 'Zona lumbar y glúteo derecho, 15 minutos por sesión, intensidad según tolerancia. '.repeat(20).slice(0, MAX_COMENTARIO_FISIO),
      marcados: TRATAMIENTOS_FISIO.map((t) => ({ clave: t.clave, nombre: t.nombre })),
      puntos: Array.from({ length: 30 }, (_, i) => ({ zona: i % 2 ? 'lumbar' : 'muslo_post_der', tipo: 'dolor', intensidad: i % 11, nota: 'al agacharse', musculos: i % 3 === 0, estructuras: i % 3 === 0 ? ['Glúteo mayor der.'] : [] })),
    };
    const pdf = await pdfABuffer('Evaluación fisioterapéutica', (doc) => escribirEvaluacionFisioPdf(doc, lleno));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(paginas(pdf)).toBe(1);
  });
});
