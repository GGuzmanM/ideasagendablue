/**
 * Corrige las competencias de Baropodometría de los DOCTORES REALES.
 *
 * Modelo correcto: en baro la columna es la MÁQUINA; el doctor que la opera se elige por cita
 * (competencia "por solicitud" = soloPorSolicitud:true, como Daniel Doy). Algunas competencias
 * de baro quedaron como NORMAL (soloPorSolicitud:false) para doctores reales (Sarai, Yasica,
 * prueba IT…), lo que los hacía aparecer como columna fija en la agenda de baro.
 *
 * Este script pone soloPorSolicitud:true en TODA competencia a un servicio de baro cuyo
 * profesional NO pertenece a la unidad de baro (o sea, no es una máquina). Idempotente.
 *
 * Ejecutar (desde apps/api):  npx tsx scripts/fix-baro-competencias.ts
 */
import { prisma } from '../src/db';

async function main(): Promise<void> {
  const baro = await prisma.unidadNegocio.findFirst({
    where: { nombre: { startsWith: 'Baropodometr' }, deletedAt: null },
    select: { id: true, nombre: true },
  });
  if (!baro) { console.error('No existe la unidad de Baropodometría.'); process.exit(1); }

  // Competencias a servicios de baro, marcadas como NORMAL, de profesionales que NO son máquina
  // (no pertenecen a la unidad de baro). Esas son las que hay que pasar a "por solicitud".
  const malPuestas = await prisma.competenciaProfesional.findMany({
    where: {
      soloPorSolicitud: false,
      servicio: { unidadNegocioId: baro.id },
      profesional: { unidadNegocioId: { not: baro.id } },
    },
    include: {
      profesional: { select: { id: true, nombres: true, apellidos: true } },
      servicio: { select: { nombre: true } },
    },
  });

  if (malPuestas.length === 0) {
    console.log('✅ Nada que corregir: ningún doctor real tiene competencia NORMAL de baro.');
    process.exit(0);
  }

  console.log(`Corrigiendo ${malPuestas.length} competencia(s) a "por solicitud":`);
  const porDoctor = new Map<string, string>();
  for (const c of malPuestas) porDoctor.set(c.profesional.id, `${c.profesional.nombres} ${c.profesional.apellidos}`);
  for (const nombre of porDoctor.values()) console.log('  · ' + nombre);

  const r = await prisma.competenciaProfesional.updateMany({
    where: { id: { in: malPuestas.map((c) => c.id) } },
    data: { soloPorSolicitud: true },
  });
  console.log(`✅ ${r.count} competencia(s) actualizadas. Los doctores reales ya no serán columna fija en baro.`);
  process.exit(0);
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
