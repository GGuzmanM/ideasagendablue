/**
 * Historia clínica del ERP anterior (28-sep-2026): notas clínicas congeladas de solo lectura (`historia_clinica_erp`,
 * se llena con scripts/hc-erp). La HC las muestra dentro de la tarjeta «Sistema anterior» de la visita de Genexis del
 * mismo día, o como tarjeta propia si esa visita no existe.
 *
 * El ERP guardaba la anamnesis como una nota CORRIDA por paciente y la copiaba en cada atención: aquí se marca la que
 * repite el texto de la atención anterior (`anamnesisRepetida`) para que la pantalla no muestre el mismo párrafo 20 veces.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';

export interface NotaErp {
  id: string;
  historialGenexisId: string | null;
  /** La visita de Genexis enlazada es una a la que el paciente ASISTIÓ (la que la HC muestra en su línea de tiempo). */
  enVisitaGenexis: boolean;
  fecha: string; // YYYY-MM-DD
  hora: string | null;
  sede: string | null;
  profesional: string | null; // limpio: «Raysa Rodriguez»
  cargo: string | null; // «Podóloga», «Asistente de podología»…
  profesionalErp: string | null; // tal cual el ERP
  servicio: string | null;
  anamnesis: string | null;
  anamnesisRepetida: boolean; // mismo texto que la atención anterior del paciente
  anamnesisDesde: string | null; // fecha de la primera atención con ese mismo texto
  diagnostico: string | null;
  planTratamiento: string | null;
  notaMedico: string | null;
  examenFisico: string | null;
  idAtencion: string;
}

const CARGOS: [RegExp, string][] = [
  [/^asis\.?\s*pod\.?/i, 'Asistente de podología'],
  [/^pod(ologa|ólogo|ologo|óloga)?\.?/i, 'Podóloga'],
  [/^dr(a)?\.?/i, 'Médico'],
  [/^citas\b\.?/i, 'Citas'],
];

/** «2 Pod Rodriguez . , Raysa» → { cargo: 'Podóloga', nombre: 'Raysa Rodriguez' }. */
export function limpiarProfesionalErp(crudo: string | null): { cargo: string | null; nombre: string | null } {
  if (!crudo) return { cargo: null, nombre: null };
  let t = crudo.replace(/^\s*\d+\s*/, '').trim();
  let cargo: string | null = null;
  for (const [re, etiqueta] of CARGOS) {
    const m = re.exec(t);
    if (m) { cargo = etiqueta; t = t.slice(m[0].length); break; }
  }
  t = t.replace(/^\s*-\s*/, '').replace(/\s+\.\s*(?=,|$)/g, '').replace(/\s{2,}/g, ' ').trim();
  const [apellidos, nombres] = t.split(',').map((x) => x.trim().replace(/\.$/, '').trim());
  const nombre = nombres ? `${nombres} ${apellidos}`.trim() : (apellidos || '').trim();
  return { cargo, nombre: nombre || null };
}

const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Notas del ERP del paciente (las enlazadas y, si aún no se enlazaron, las de su mismo documento), más nuevas primero. */
export async function listarNotasErp(pacienteId: string): Promise<NotaErp[]> {
  const pac = await prisma.paciente.findUnique({ where: { id: pacienteId }, select: { numeroDocumento: true } });
  if (!pac) return [];
  let filas;
  try {
    filas = await prisma.historiaClinicaErp.findMany({
      where: {
        OR: [
          { pacienteId },
          // Paciente registrado DESPUÉS de la carga: se encuentra por su documento sin tener que volver a enlazar.
          ...(pac.numeroDocumento ? [{ pacienteId: null, numeroDocumento: pac.numeroDocumento }] : []),
        ],
      },
      orderBy: [{ fecha: 'asc' }, { hora: 'asc' }],
    });
  } catch (e) {
    // Tabla aún no creada en esta base (antes de aplicar la migración): la HC sigue funcionando, sin notas del ERP.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') return [];
    throw e;
  }
  if (!filas.length) return [];

  const ids = filas.map((f) => f.historialGenexisId).filter((x): x is string => !!x);
  const asistidas = new Set(ids.length
    ? (await prisma.historialGenexis.findMany({ where: { id: { in: ids }, llegoPaciente: 'Sí', deletedAt: null }, select: { id: true } })).map((g) => g.id)
    : []);

  let previa = '';
  let desde: string | null = null;
  const notas = filas.map((f): NotaErp => {
    const fecha = f.fecha.toISOString().slice(0, 10);
    const a = norm(f.anamnesis);
    const repetida = !!a && a === previa;
    if (a && !repetida) { previa = a; desde = fecha; }
    const { cargo, nombre } = limpiarProfesionalErp(f.profesional);
    return {
      id: f.id,
      historialGenexisId: f.historialGenexisId,
      enVisitaGenexis: !!f.historialGenexisId && asistidas.has(f.historialGenexisId),
      fecha, hora: f.hora, sede: f.sede,
      profesional: nombre, cargo, profesionalErp: f.profesional,
      servicio: f.servicio,
      anamnesis: f.anamnesis, anamnesisRepetida: repetida, anamnesisDesde: repetida ? desde : null,
      diagnostico: f.diagnostico, planTratamiento: f.planTratamiento, notaMedico: f.notaMedico, examenFisico: f.examenFisico,
      idAtencion: f.idAtencion,
    };
  });
  return notas.reverse();
}
