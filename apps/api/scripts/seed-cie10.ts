/**
 * Seed del catálogo CIE-10 — subset CURADO para la clínica del pie (podología, fisio,
 * baropodometría y actos médicos). IDEMPOTENTE (upsert por `codigo`): correrlo N veces
 * no duplica ni falla; actualiza descripción/categoría si el catálogo cambia.
 *
 * NO pretende ser el CIE-10 completo (son ~14 000 códigos); es el subconjunto que la
 * clínica realmente diagnostica. Se amplía agregando filas aquí.
 *
 * Uso standalone:  npx ts-node scripts/seed-cie10.ts
 * Desde seed.ts:   await sembrarCie10(prisma)
 */
import { PrismaClient } from '@prisma/client';

interface FilaCie10 {
  codigo: string;
  descripcion: string;
  categoria: string;
}

export const CIE10_PODOLOGIA: FilaCie10[] = [
  // ── Micosis superficiales ──
  { codigo: 'B35.1', descripcion: 'Onicomicosis (tiña de las uñas)', categoria: 'Micosis superficiales' },
  { codigo: 'B35.3', descripcion: 'Tiña del pie (pie de atleta)', categoria: 'Micosis superficiales' },
  { codigo: 'B35.4', descripcion: 'Tiña del cuerpo', categoria: 'Micosis superficiales' },
  { codigo: 'B37.2', descripcion: 'Candidiasis de la piel y de las uñas', categoria: 'Micosis superficiales' },

  // ── Trastornos de las uñas ──
  { codigo: 'L60.0', descripcion: 'Uña encarnada (onicocriptosis)', categoria: 'Trastornos de las uñas' },
  { codigo: 'L60.1', descripcion: 'Onicólisis', categoria: 'Trastornos de las uñas' },
  { codigo: 'L60.2', descripcion: 'Onicogrifosis', categoria: 'Trastornos de las uñas' },
  { codigo: 'L60.3', descripcion: 'Distrofia ungueal', categoria: 'Trastornos de las uñas' },
  { codigo: 'L60.8', descripcion: 'Otros trastornos de las uñas', categoria: 'Trastornos de las uñas' },
  { codigo: 'L60.9', descripcion: 'Trastorno de la uña, no especificado', categoria: 'Trastornos de las uñas' },
  { codigo: 'L03.0', descripcion: 'Celulitis y absceso de dedo del pie (paroniquia)', categoria: 'Trastornos de las uñas' },

  // ── Hiperqueratosis y callosidades ──
  { codigo: 'L84', descripcion: 'Callos y callosidades (helomas)', categoria: 'Hiperqueratosis y callosidades' },
  { codigo: 'L85.1', descripcion: 'Queratodermia adquirida (hiperqueratosis plantar)', categoria: 'Hiperqueratosis y callosidades' },
  { codigo: 'L85.3', descripcion: 'Xerosis cutánea (piel seca)', categoria: 'Hiperqueratosis y callosidades' },
  { codigo: 'B07.9', descripcion: 'Verruga vírica (verruga plantar)', categoria: 'Hiperqueratosis y callosidades' },

  // ── Pie diabético y vascular ──
  { codigo: 'E11.5', descripcion: 'Diabetes mellitus tipo 2 con complicaciones circulatorias periféricas', categoria: 'Pie diabético y vascular' },
  { codigo: 'E11.4', descripcion: 'Diabetes mellitus tipo 2 con complicaciones neurológicas', categoria: 'Pie diabético y vascular' },
  { codigo: 'E10.5', descripcion: 'Diabetes mellitus tipo 1 con complicaciones circulatorias periféricas', categoria: 'Pie diabético y vascular' },
  { codigo: 'L97', descripcion: 'Úlcera del miembro inferior, no clasificada en otra parte', categoria: 'Pie diabético y vascular' },
  { codigo: 'L98.4', descripcion: 'Úlcera crónica de la piel, no clasificada en otra parte', categoria: 'Pie diabético y vascular' },
  { codigo: 'I73.9', descripcion: 'Enfermedad vascular periférica, no especificada', categoria: 'Pie diabético y vascular' },
  { codigo: 'I83.9', descripcion: 'Várices de miembro inferior sin úlcera ni inflamación', categoria: 'Pie diabético y vascular' },
  { codigo: 'G57.6', descripcion: 'Lesión del nervio plantar (neuroma de Morton)', categoria: 'Pie diabético y vascular' },

  // ── Deformidades del pie ──
  { codigo: 'M20.1', descripcion: 'Hallux valgus (juanete) adquirido', categoria: 'Deformidades del pie' },
  { codigo: 'M20.2', descripcion: 'Hallux rigidus', categoria: 'Deformidades del pie' },
  { codigo: 'M20.4', descripcion: 'Otros dedos en martillo adquiridos', categoria: 'Deformidades del pie' },
  { codigo: 'M21.4', descripcion: 'Pie plano (pes planus) adquirido', categoria: 'Deformidades del pie' },
  { codigo: 'M21.5', descripcion: 'Pie en garra adquirido', categoria: 'Deformidades del pie' },
  { codigo: 'M21.6', descripcion: 'Otras deformidades adquiridas del tobillo y del pie', categoria: 'Deformidades del pie' },

  // ── Dolor y tejidos blandos ──
  { codigo: 'M72.2', descripcion: 'Fascitis plantar', categoria: 'Dolor y tejidos blandos' },
  { codigo: 'M77.3', descripcion: 'Espolón calcáneo', categoria: 'Dolor y tejidos blandos' },
  { codigo: 'M76.6', descripcion: 'Tendinitis aquílea', categoria: 'Dolor y tejidos blandos' },
  { codigo: 'M79.6', descripcion: 'Dolor en miembro (pie)', categoria: 'Dolor y tejidos blandos' },
  { codigo: 'M25.5', descripcion: 'Dolor articular', categoria: 'Dolor y tejidos blandos' },
  { codigo: 'R52', descripcion: 'Dolor, no especificado', categoria: 'Dolor y tejidos blandos' },

  // ── Piel y dermatitis ──
  { codigo: 'L30.9', descripcion: 'Dermatitis, no especificada', categoria: 'Piel y dermatitis' },
  { codigo: 'L08.9', descripcion: 'Infección local de la piel y del tejido subcutáneo, no especificada', categoria: 'Piel y dermatitis' },

  // ── Marcha y evaluación (baropodometría) ──
  { codigo: 'R26.8', descripcion: 'Otras alteraciones de la marcha y de la movilidad', categoria: 'Marcha y evaluación' },
  { codigo: 'Z01.8', descripcion: 'Otro examen especial especificado (evaluación baropodométrica)', categoria: 'Marcha y evaluación' },
];

export async function sembrarCie10(db: PrismaClient): Promise<{ total: number }> {
  const filas = CIE10_PODOLOGIA;
  const LOTE = 100;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    await db.$transaction(
      lote.map((f) =>
        db.cie10.upsert({
          where: { codigo: f.codigo },
          update: { descripcion: f.descripcion, categoria: f.categoria, activo: true },
          create: { codigo: f.codigo, descripcion: f.descripcion, categoria: f.categoria },
        }),
      ),
    );
  }
  return { total: filas.length };
}

// Ejecución directa
if (require.main === module) {
  const db = new PrismaClient();
  sembrarCie10(db)
    .then((r) => {
      console.log(`✓ CIE-10 sembrado: ${r.total} códigos`);
      return db.$disconnect();
    })
    .catch(async (e) => {
      console.error('✗ Error sembrando CIE-10:', e);
      await db.$disconnect();
      process.exit(1);
    });
}
