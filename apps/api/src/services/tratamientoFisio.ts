/**
 * Tratamiento de Fisioterapia (25-nov-2026): la tabla «TRATAMIENTO» de la hoja «Evaluación fisioterapéutica» de la clínica.
 * La licenciada marca qué tratamientos se harán, escribe UN comentario general de lo que hará y el N.º de sesiones recomendadas.
 *
 * SIN tablas nuevas: cada tratamiento marcado es una fila de `procedimientos_atencion` con `tipo = 'fisioterapia'` y
 * `parametros.clave` = la clave del catálogo. Lo que es del plan entero va repetido en todas las filas de la atención:
 * `parametros.comentario` (el comentario general; `detalle` queda vacío para que no parezca la nota de UN tratamiento) y
 * `sesionesTotales` (las sesiones recomendadas). Así entran solos en todo lo que ya lee procedimientos: la historia en
 * pantalla, el PDF, los reportes y el aviso «Sin procedimiento» al cerrar.
 *
 * El catálogo se repite en la pantalla (apps/web/src/components/historiaClinica/tratamientoFisio.ts): si se cambia uno,
 * cambiar el otro (lo comprueba el test `tratamiento-fisio`). Las CLAVES se guardan: no cambiarlas; para retirar un
 * tratamiento se quita de la lista (lo ya guardado conserva su nombre).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { Ctx, ctxAudit, etiquetaUsuario, atencionOr404, getAtencionCompleta, exigirAbierta } from './historiaClinicaService';
import { puntosDelMapa } from './mapaCorporalTexto';

export const TIPO_FISIO = 'fisioterapia';

/** En el orden de la hoja de papel: primero la columna izquierda, luego la derecha. */
export const TRATAMIENTOS_FISIO = [
  { clave: 'compresa_caliente', nombre: 'Compresa húmeda caliente' },
  { clave: 'compresa_fria', nombre: 'Compresa fría' },
  { clave: 'terapia_manual', nombre: 'Terapia manual (hands pro, artick pro, tape y punción seca)' },
  { clave: 'ultrasonido', nombre: 'Ultrasonido' },
  { clave: 'terapia_combinada', nombre: 'Terapia combinada' },
  { clave: 'electro_analgesica', nombre: 'Electroterapia analgésica' },
  { clave: 'electro_estimulante', nombre: 'Electroterapia estimulante' },
  { clave: 'tecarterapia', nombre: 'Tecarterapia' },
  { clave: 'laser', nombre: 'Láser de alta gama' },
  { clave: 'ondas_choque', nombre: 'Ondas de choque' },
  { clave: 'magnetoterapia', nombre: 'Magnetoterapia' },
  { clave: 'presoterapia', nombre: 'Presoterapia' },
  { clave: 'pistola_percusora', nombre: 'Pistola percusora' },
  { clave: 'ejercicios', nombre: 'Programa de ejercicios terapéuticos' },
  { clave: 'reeducacion_postural', nombre: 'Reeducación postural' },
  { clave: 'descarga_muscular', nombre: 'Descarga muscular' },
] as const;
export type ClaveTratamientoFisio = (typeof TRATAMIENTOS_FISIO)[number]['clave'];
export const CLAVES_TRATAMIENTO_FISIO = TRATAMIENTOS_FISIO.map((t) => t.clave) as [ClaveTratamientoFisio, ...ClaveTratamientoFisio[]];
const NOMBRE = new Map<string, string>(TRATAMIENTOS_FISIO.map((t) => [t.clave, t.nombre]));
const ORDEN = new Map<string, number>(TRATAMIENTOS_FISIO.map((t, i) => [t.clave, i]));
/** Tope del comentario general: lo que entra en la hoja impresa (media hoja). */
export const MAX_COMENTARIO_FISIO = 500;

/** Clave del catálogo de una fila guardada (null si no es un tratamiento de fisio). */
export function claveDeFila(f: { tipo: string; parametros: unknown }): string | null {
  if (f.tipo !== TIPO_FISIO) return null;
  const c = (f.parametros as { clave?: unknown } | null)?.clave;
  return typeof c === 'string' ? c : null;
}

/** Comentario general guardado en una fila de fisio (null si no tiene). */
export function comentarioDeFila(f: { tipo: string; parametros: unknown }): string | null {
  if (f.tipo !== TIPO_FISIO) return null;
  const c = (f.parametros as { comentario?: unknown } | null)?.comentario;
  return typeof c === 'string' && c.trim() ? c.trim() : null;
}

/**
 * Patologías que salen en la hoja impresa (25-nov-2026). Por defecto son los diagnósticos de la atención; la licenciada puede
 * QUITAR alguno de la hoja (`excluir`: sus códigos CIE-10; el diagnóstico sigue en la historia) y AGREGAR patologías que el
 * paciente ya tiene de otras atenciones, de cualquier servicio (`incluir`: código + descripción, sin copiarlas como diagnóstico
 * de esta atención). Va en `parametros.patologias`, repetido en cada fila como el comentario.
 */
export interface PatologiasHoja { incluir: { codigo: string; descripcion: string }[]; excluir: string[] }
export const MAX_PATOLOGIAS_HOJA = 10;
const sinPatologias = (p: PatologiasHoja | null | undefined) => !p || (p.incluir.length === 0 && p.excluir.length === 0);

/** Lo guardado en una fila → selección limpia (null si no hay nada elegido). Tolera filas viejas o mal formadas. */
export function patologiasDeFila(f: { tipo: string; parametros: unknown }): PatologiasHoja | null {
  if (f.tipo !== TIPO_FISIO) return null;
  const x = (f.parametros as { patologias?: { incluir?: unknown; excluir?: unknown } } | null)?.patologias;
  if (!x || typeof x !== 'object') return null;
  const incluir = (Array.isArray(x.incluir) ? x.incluir : []).flatMap((d) => {
    const y = d as { codigo?: unknown; descripcion?: unknown } | null;
    return y && typeof y.codigo === 'string' && typeof y.descripcion === 'string' ? [{ codigo: y.codigo, descripcion: y.descripcion }] : [];
  });
  const excluir = (Array.isArray(x.excluir) ? x.excluir : []).filter((c): c is string => typeof c === 'string');
  const p = { incluir, excluir };
  return sinPatologias(p) ? null : p;
}

/** Lo que va en el renglón «Diagnóstico (CIE-10)» de la hoja: los de la atención menos los quitados, más los agregados. */
export function diagnosticosDeLaHoja<D extends { codigo: string; descripcion: string }>(deLaAtencion: D[], p: PatologiasHoja | null): { codigo: string; descripcion: string }[] {
  const fuera = new Set(p?.excluir ?? []);
  const lista: { codigo: string; descripcion: string }[] = deLaAtencion.filter((d) => !fuera.has(d.codigo)).map((d) => ({ codigo: d.codigo, descripcion: d.descripcion }));
  for (const d of p?.incluir ?? []) if (!lista.some((x) => x.codigo === d.codigo)) lista.push(d);
  return lista;
}

export interface TratamientoMarcado { clave: string; nombre: string }
type FilaFisio = { tipo: string; nombre: string; parametros: unknown; sesionesTotales: number | null };
/** Lo marcado en una atención, en el orden de la hoja, con el comentario general, las sesiones y las patologías de la hoja. */
export function tratamientoDeFilas(filas: FilaFisio[]): { tratamientos: TratamientoMarcado[]; comentario: string | null; sesiones: number | null; patologias: PatologiasHoja | null } {
  const tratamientos: TratamientoMarcado[] = [];
  let sesiones: number | null = null;
  let comentario: string | null = null;
  let patologias: PatologiasHoja | null = null;
  for (const f of filas) {
    const clave = claveDeFila(f);
    if (!clave) continue;
    tratamientos.push({ clave, nombre: NOMBRE.get(clave) ?? f.nombre });
    if (sesiones == null && f.sesionesTotales != null) sesiones = f.sesionesTotales;
    comentario ??= comentarioDeFila(f);
    patologias ??= patologiasDeFila(f);
  }
  tratamientos.sort((a, b) => (ORDEN.get(a.clave) ?? 999) - (ORDEN.get(b.clave) ?? 999));
  return { tratamientos, comentario, sesiones, patologias };
}

/**
 * Deja la atención con EXACTAMENTE estos tratamientos marcados: crea los nuevos, corrige el comentario o las sesiones de los
 * que siguen y quita (borrado suave) los que ya no están. Una sola entrada de auditoría por guardado. El comentario, las
 * sesiones y las patologías de la hoja viven en las filas: sin ningún tratamiento marcado no se guardan.
 * `patologias.incluir` llega como códigos CIE-10: la descripción se toma del catálogo (un código que no existe → 400).
 */
export async function guardarTratamientoFisio(p: Ctx & {
  atencionId: string; tratamientos: string[]; comentario?: string | null; sesiones?: number | null;
  patologias?: { incluir?: string[]; excluir?: string[] } | null;
}) {
  const at = await atencionOr404(p.atencionId);
  exigirAbierta(at);
  // Una fila por tratamiento (repetidos fuera).
  const pedidos = new Set<string>();
  for (const clave of p.tratamientos) {
    if (!NOMBRE.has(clave)) throw new AppError(`Tratamiento no válido: ${clave}`, 400, 'TRATAMIENTO_FISIO_INVALIDO');
    pedidos.add(clave);
  }
  const comentario = (p.comentario ?? '').trim().slice(0, MAX_COMENTARIO_FISIO) || null;
  const sesiones = p.sesiones ?? null;
  // Patologías de la hoja: códigos sin repetir; las agregadas se leen del catálogo CIE-10 (en el orden en que llegaron).
  const codigosIncluir = [...new Set((p.patologias?.incluir ?? []).map((c) => c.trim()).filter(Boolean))].slice(0, MAX_PATOLOGIAS_HOJA);
  const cie = codigosIncluir.length ? await prisma.cie10.findMany({ where: { codigo: { in: codigosIncluir } }, select: { codigo: true, descripcion: true } }) : [];
  const descripcionDe = new Map(cie.map((c) => [c.codigo, c.descripcion]));
  const desconocido = codigosIncluir.find((c) => !descripcionDe.has(c));
  if (desconocido) throw new AppError(`Código CIE-10 no válido: ${desconocido}`, 400, 'CIE10_INVALIDO');
  const elegidas: PatologiasHoja = {
    incluir: codigosIncluir.map((codigo) => ({ codigo, descripcion: descripcionDe.get(codigo) as string })),
    excluir: [...new Set((p.patologias?.excluir ?? []).map((c) => c.trim()).filter(Boolean))].slice(0, 30),
  };
  const patologias = sinPatologias(elegidas) ? null : elegidas;
  const parametrosDe = (clave: string) => ({ clave, ...(comentario ? { comentario } : {}), ...(patologias ? { patologias } : {}) }) as unknown as Prisma.InputJsonValue;
  const mismas = (a: PatologiasHoja | null, b: PatologiasHoja | null) => JSON.stringify(a) === JSON.stringify(b);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);

  await prisma.$transaction(async (tx) => {
    const filas = await tx.procedimientoAtencion.findMany({ where: { atencionId: at.id, tipo: TIPO_FISIO, deletedAt: null }, orderBy: { creadoEn: 'asc' } });
    const antes = tratamientoDeFilas(filas);
    const vistas = new Set<string>();
    let cambios = 0;
    for (const f of filas) {
      const clave = claveDeFila(f);
      // Sin clave, repetida o ya no pedida → se quita.
      if (!clave || vistas.has(clave) || !pedidos.has(clave)) {
        await tx.procedimientoAtencion.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
        cambios++;
        continue;
      }
      vistas.add(clave);
      if (comentarioDeFila(f) !== comentario || f.detalle !== null || f.sesionesTotales !== sesiones || !mismas(patologiasDeFila(f), patologias)) {
        await tx.procedimientoAtencion.update({ where: { id: f.id }, data: { detalle: null, parametros: parametrosDe(clave), sesionesTotales: sesiones } });
        cambios++;
      }
    }
    for (const clave of pedidos) {
      if (vistas.has(clave)) continue;
      await tx.procedimientoAtencion.create({
        data: {
          atencionId: at.id, tipo: TIPO_FISIO, nombre: NOMBRE.get(clave) as string, parametros: parametrosDe(clave),
          sesionesTotales: sesiones, registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta,
        },
      });
      cambios++;
    }
    if (!cambios) return; // guardar lo mismo no deja rastro
    const claves = [...pedidos].sort((a, b) => (ORDEN.get(a) ?? 0) - (ORDEN.get(b) ?? 0));
    await auditEnTx(tx, {
      ...ctxAudit(p), citaId: at.citaId, accion: 'tratamiento_fisio', entidad: 'atencion_clinica', entidadId: at.id, sedeId: at.sedeId,
      antes: { tratamientos: antes.tratamientos.map((t) => t.nombre), sesiones: antes.sesiones, comentario: antes.comentario },
      despues: {
        tratamientos: claves.map((c) => NOMBRE.get(c)), sesiones, comentario: pedidos.size ? comentario : null,
        ...(pedidos.size && patologias ? { hojaAgrega: patologias.incluir.map((d) => d.codigo), hojaQuita: patologias.excluir } : {}),
      },
    });
  });
  return getAtencionCompleta(at.id);
}

/**
 * El tratamiento marcado en la atención de fisio ANTERIOR del paciente (la más reciente con algo marcado, antes de esta), para
 * ofrecer «usar el mismo»: en la evaluación se decide el plan y en cada sesión se repite. null si no hay.
 */
export async function tratamientoFisioAnterior(atencionId: string) {
  const at = await prisma.atencionClinica.findUnique({ where: { id: atencionId }, select: { id: true, pacienteId: true, fecha: true, creadoEn: true } });
  if (!at) throw new AppError('Atención no encontrada', 404);
  const previa = await prisma.atencionClinica.findFirst({
    where: {
      pacienteId: at.pacienteId, id: { not: at.id },
      OR: [{ fecha: { lt: at.fecha } }, { fecha: at.fecha, creadoEn: { lt: at.creadoEn } }],
      procedimientos: { some: { tipo: TIPO_FISIO, deletedAt: null } },
    },
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    select: {
      id: true, fecha: true, servicio: { select: { nombre: true } },
      procedimientos: { where: { tipo: TIPO_FISIO, deletedAt: null }, orderBy: { creadoEn: 'asc' }, select: { tipo: true, nombre: true, parametros: true, sesionesTotales: true } },
    },
  });
  if (!previa) return null;
  const plan = tratamientoDeFilas(previa.procedimientos);
  // Solo lo que sigue en el catálogo se puede volver a marcar.
  return { atencionId: previa.id, fecha: previa.fecha, servicio: previa.servicio.nombre, sesiones: plan.sesiones, comentario: plan.comentario, patologias: plan.patologias, tratamientos: plan.tratamientos.filter((t) => NOMBRE.has(t.clave)) };
}

/** Todo lo que lleva la hoja imprimible «Evaluación fisioterapéutica» de una atención. */
export async function evaluacionFisioParaPdf(atencionId: string) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id: atencionId },
    select: {
      id: true, pacienteId: true, sedeId: true, fecha: true, motivoConsulta: true,
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, fechaNacimiento: true } },
      profesional: { select: { nombres: true, apellidos: true } },
      sede: { select: { nombre: true, direccion: true } },
      servicio: { select: { nombre: true } },
      diagnosticos: { where: { deletedAt: null }, orderBy: [{ principal: 'desc' }, { creadoEn: 'asc' }], select: { principal: true, observacion: true, cie10: { select: { codigo: true, descripcion: true } } } },
      procedimientos: { where: { tipo: TIPO_FISIO, deletedAt: null }, orderBy: { creadoEn: 'asc' }, select: { tipo: true, nombre: true, parametros: true, sesionesTotales: true } },
      dibujosSilueta: { where: { deletedAt: null, vista: 'cuerpo3d' }, select: { anotaciones: true } },
      historiaClinica: { select: { numero: true, antecedentes: { where: { deletedAt: null, activo: true }, orderBy: { creadoEn: 'asc' }, select: { descripcion: true } } } },
    },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  const plan = tratamientoDeFilas(at.procedimientos);
  return {
    atencionId: at.id, pacienteId: at.pacienteId, sedeId: at.sedeId, fecha: at.fecha, motivoConsulta: at.motivoConsulta,
    paciente: at.paciente, profesional: `${at.profesional.nombres} ${at.profesional.apellidos}`.trim(), sede: at.sede, servicio: at.servicio.nombre,
    numeroHc: at.historiaClinica.numero,
    antecedentes: at.historiaClinica.antecedentes.map((a) => a.descripcion),
    // Las patologías que la licenciada eligió para la hoja (por defecto, los diagnósticos de esta atención).
    diagnosticos: diagnosticosDeLaHoja(at.diagnosticos.map((d) => ({ codigo: d.cie10.codigo, descripcion: d.cie10.descripcion })), plan.patologias),
    sesiones: plan.sesiones,
    comentario: plan.comentario,
    marcados: plan.tratamientos,
    puntos: at.dibujosSilueta.flatMap((d) => puntosDelMapa(d.anotaciones)),
  };
}
export type EvaluacionFisioPdf = Awaited<ReturnType<typeof evaluacionFisioParaPdf>>;
