/**
 * Actualiza el CATÁLOGO de servicios a los que realmente ofrece la clínica (todos en soles).
 *  - REUTILIZA servicios existentes que calzan (renombra/reprecia) → conserva su historial de
 *    citas y competencias.
 *  - CREA los nuevos, copiándoles las competencias de las podólogas (para que sean agendables).
 *  - DESACTIVA (soft-delete) los que ya no están en la lista. Reversible.
 * Ejecutar (desde apps/api): npx tsx scripts/actualizar-catalogo-servicios.ts
 */
import { prisma } from '../src/db';

// [nombreExistente, nombreNuevo, unidad, precio(S/), duración(min)]
const REUSE: [string, string, 'baro' | 'podo' | 'fisio', number, number][] = [
  ['Baropodometría Computarizada', 'Baropodometría', 'baro', 100, 30],
  ['Plantillas Ortopédicas', 'Ortésicos Completos', 'baro', 70, 30],
  ['Evaluación Biomecánica', 'Ortésicos Separador', 'baro', 40, 30],
  ['Profilaxis', 'Profilaxis', 'podo', 87, 60],
  ['Curación de Úlcera', 'Curación de Úlceras', 'podo', 90, 60],
  ['Láser Podológico', 'Láser para Hongos Regular', 'podo', 990, 30],
  ['Verruga Plantar', 'VPH', 'podo', 250, 30],
  ['Onicocriptosis', 'Uñero', 'podo', 200, 30],
  ['Control Post-operatorio', 'Evaluación', 'podo', 50, 30],
  ['Heloma Simple', 'Profilaxis de Mano', 'podo', 50, 30],
  ['Heloma Vascular', 'Curación de Heridas y Extracción de Uñero', 'podo', 50, 30],
  ['Quiropodia', 'Onyfix', 'podo', 280, 30],
  ['Limpieza Clínica del Pie - Premium', 'Extracción de Uña', 'podo', 350, 30],
  ['Limpieza Clínica del Pie - Regular', 'Uña Acrílica', 'podo', 35, 30],
  ['Ondas de Choque', 'Láser de Alta: Fascitis, Juanete, Metatarso, Talón', 'fisio', 810, 30],
];
// [nombreNuevo, unidad, precio, duración]
const CREATE: [string, 'baro' | 'podo' | 'fisio', number, number][] = [
  ['Infiltración: Callos', 'podo', 360, 30],
  ['Láser de Alta: Hongos', 'podo', 1150, 30],
  ['Matrisectomía', 'podo', 1500, 30],
  ['Rodetoplastia', 'podo', 250, 30],
  ['Curación de Extracción de Uña', 'podo', 50, 30],
  ['Curación de Extracción de Uñero', 'podo', 50, 30],
];

function slug(s: string): string {
  return s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

async function main(): Promise<void> {
  const unidades = await prisma.unidadNegocio.findMany({ where: { deletedAt: null }, select: { id: true, nombre: true } });
  const uid = (k: 'baro' | 'podo' | 'fisio') => {
    const re = k === 'baro' ? /baropodometr/i : k === 'podo' ? /podolog/i : /fisio/i;
    const u = unidades.find((x) => re.test(x.nombre));
    if (!u) throw new Error(`No se encontró la unidad ${k}`);
    return u.id;
  };
  const podoId = uid('podo');

  const conservados = new Set<string>();

  // 1) REUSE — renombrar/reprecia (conserva id, código, competencias, citas)
  let reusados = 0;
  for (const [viejo, nuevo, k, precio, dur] of REUSE) {
    const s = await prisma.servicio.findFirst({ where: { nombre: viejo, deletedAt: null }, select: { id: true } });
    if (!s) { console.log(`  ⚠ no existe "${viejo}" (se omite)`); continue; }
    await prisma.servicio.update({
      where: { id: s.id },
      data: { nombre: nuevo, precioReferencial: precio, duracionMinutos: dur, unidadNegocioId: uid(k), activo: true, deletedAt: null },
    });
    conservados.add(s.id); reusados++;
    console.log(`  ↻ ${viejo}  →  ${nuevo}  (S/${precio}, ${dur}m)`);
  }

  // 2) Competencias de referencia = podólogas con competencia NORMAL a algún servicio de podología.
  const refComp = await prisma.competenciaProfesional.findMany({
    where: { activa: true, soloPorSolicitud: false, servicio: { unidadNegocioId: podoId } },
    select: { profesionalId: true }, distinct: ['profesionalId'],
  });
  const refProfIds = [...new Set(refComp.map((c) => c.profesionalId))];

  // 3) CREATE — nuevos + competencias (agendables)
  const codigosUsados = new Set((await prisma.servicio.findMany({ select: { codigo: true } })).map((s) => s.codigo));
  let creados = 0;
  for (const [nombre, k, precio, dur] of CREATE) {
    let codigo = slug(nombre); let i = 1;
    while (codigosUsados.has(codigo)) codigo = `${slug(nombre).slice(0, 36)}_${i++}`;
    codigosUsados.add(codigo);
    const s = await prisma.servicio.create({
      data: { nombre, codigo, precioReferencial: precio, duracionMinutos: dur, unidadNegocioId: uid(k), activo: true },
    });
    conservados.add(s.id);
    for (const profesionalId of refProfIds) {
      await prisma.competenciaProfesional.upsert({
        where: { profesionalId_servicioId: { profesionalId, servicioId: s.id } },
        update: { activa: true, soloPorSolicitud: false },
        create: { profesionalId, servicioId: s.id, habilitadoDesde: new Date(), activa: true, soloPorSolicitud: false },
      });
    }
    creados++;
    console.log(`  + ${nombre}  (S/${precio}, ${dur}m, ${refProfIds.length} competencias)`);
  }

  // 4) DESACTIVAR el resto (soft-delete)
  const restantes = await prisma.servicio.findMany({ where: { deletedAt: null, id: { notIn: [...conservados] } }, select: { id: true, nombre: true } });
  if (restantes.length) {
    await prisma.servicio.updateMany({ where: { id: { in: restantes.map((r) => r.id) } }, data: { activo: false, deletedAt: new Date() } });
  }
  console.log(`\n  ✖ Desactivados (${restantes.length}): ${restantes.map((r) => r.nombre).join(', ') || '—'}`);
  console.log(`\n✅ Catálogo actualizado: ${reusados} reutilizados, ${creados} creados, ${restantes.length} desactivados. Total activos: ${reusados + creados}.`);
  process.exit(0);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
