/**
 * Seed del catálogo de MEDICAMENTOS — vademécum CURADO para la clínica del pie.
 * IDEMPOTENTE (upsert por `id` = slug estable derivado de DCI+concentración+forma):
 * correrlo N veces no duplica ni falla.
 *
 * Se prescribe por `dci` (Denominación Común Internacional — lo exige DIGEMID).
 * `codigoAtc` es el estándar OMS; `codigoDigemid` queda como hueco para el código
 * nacional/petitorio (PNUME) a futuro. `nombresComerciales` es SOLO para buscar por
 * marca y llegar al genérico — no se imprime en la receta.
 *
 * Ampliar = agregar filas aquí. Fuente ATC: clasificación OMS (whocc.no).
 *
 * Uso standalone:  npx ts-node scripts/seed-medicamentos.ts
 * Desde seed.ts:   await sembrarMedicamentos(prisma)
 */
import { PrismaClient } from '@prisma/client';

interface FilaMed {
  dci: string;
  codigoAtc?: string;
  concentracion?: string;
  formaFarmaceutica?: string;
  viaAdministracion?: string;
  nombresComerciales?: string;
  grupo: string;
}

// slug ASCII estable: "Terbinafina" + "250 mg" + "tableta" -> "terbinafina-250-mg-tableta"
export function slugMed(f: FilaMed): string {
  return [f.dci, f.concentracion, f.formaFarmaceutica]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const VADEMECUM: FilaMed[] = [
  // ── Antifúngicos sistémicos (onicomicosis) ──
  { dci: 'Terbinafina', codigoAtc: 'D01BA02', concentracion: '250 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Lamisil, Terbisil', grupo: 'Antifúngico sistémico' },
  { dci: 'Itraconazol', codigoAtc: 'J02AC02', concentracion: '100 mg', formaFarmaceutica: 'cápsula', viaAdministracion: 'oral', nombresComerciales: 'Sporanox', grupo: 'Antifúngico sistémico' },
  { dci: 'Fluconazol', codigoAtc: 'J02AC01', concentracion: '150 mg', formaFarmaceutica: 'cápsula', viaAdministracion: 'oral', nombresComerciales: 'Diflucan', grupo: 'Antifúngico sistémico' },
  { dci: 'Griseofulvina', codigoAtc: 'D01BA01', concentracion: '500 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Grisovin', grupo: 'Antifúngico sistémico' },

  // ── Antifúngicos tópicos ──
  { dci: 'Ciclopirox', codigoAtc: 'D01AE14', concentracion: '8 %', formaFarmaceutica: 'laca ungueal', viaAdministracion: 'tópica', nombresComerciales: 'Micoxidin, Ciclochem', grupo: 'Antifúngico tópico' },
  { dci: 'Amorolfina', codigoAtc: 'D01AE16', concentracion: '5 %', formaFarmaceutica: 'laca ungueal', viaAdministracion: 'tópica', nombresComerciales: 'Loceryl', grupo: 'Antifúngico tópico' },
  { dci: 'Clotrimazol', codigoAtc: 'D01AC01', concentracion: '1 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Canesten', grupo: 'Antifúngico tópico' },
  { dci: 'Ketoconazol', codigoAtc: 'D01AC08', concentracion: '2 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Nizoral', grupo: 'Antifúngico tópico' },
  { dci: 'Terbinafina', codigoAtc: 'D01AE15', concentracion: '1 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Lamisil crema', grupo: 'Antifúngico tópico' },
  { dci: 'Miconazol', codigoAtc: 'D01AC02', concentracion: '2 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Daktarin', grupo: 'Antifúngico tópico' },
  { dci: 'Tolnaftato', codigoAtc: 'D01AE18', concentracion: '1 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Tinaderm', grupo: 'Antifúngico tópico' },

  // ── Antibióticos (pie diabético infectado, paroniquia, celulitis) ──
  { dci: 'Cefalexina', codigoAtc: 'J01DB01', concentracion: '500 mg', formaFarmaceutica: 'cápsula', viaAdministracion: 'oral', nombresComerciales: 'Keflex', grupo: 'Antibiótico' },
  { dci: 'Amoxicilina + ácido clavulánico', codigoAtc: 'J01CR02', concentracion: '500/125 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Augmentin', grupo: 'Antibiótico' },
  { dci: 'Clindamicina', codigoAtc: 'J01FF01', concentracion: '300 mg', formaFarmaceutica: 'cápsula', viaAdministracion: 'oral', nombresComerciales: 'Dalacin', grupo: 'Antibiótico' },
  { dci: 'Ciprofloxacino', codigoAtc: 'J01MA02', concentracion: '500 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Ciproxina', grupo: 'Antibiótico' },
  { dci: 'Dicloxacilina', codigoAtc: 'J01CF01', concentracion: '500 mg', formaFarmaceutica: 'cápsula', viaAdministracion: 'oral', nombresComerciales: 'Posipen', grupo: 'Antibiótico' },
  { dci: 'Mupirocina', codigoAtc: 'D06AX09', concentracion: '2 %', formaFarmaceutica: 'ungüento', viaAdministracion: 'tópica', nombresComerciales: 'Bactroban', grupo: 'Antibiótico tópico' },
  { dci: 'Ácido fusídico', codigoAtc: 'D06AX01', concentracion: '2 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Fucidin', grupo: 'Antibiótico tópico' },

  // ── AINE / analgésicos ──
  { dci: 'Ibuprofeno', codigoAtc: 'M01AE01', concentracion: '400 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Motrin', grupo: 'AINE / analgésico' },
  { dci: 'Naproxeno', codigoAtc: 'M01AE02', concentracion: '550 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Flanax', grupo: 'AINE / analgésico' },
  { dci: 'Diclofenaco', codigoAtc: 'M01AB05', concentracion: '50 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Voltaren', grupo: 'AINE / analgésico' },
  { dci: 'Diclofenaco', codigoAtc: 'M02AA15', concentracion: '1 %', formaFarmaceutica: 'gel', viaAdministracion: 'tópica', nombresComerciales: 'Voltaren gel', grupo: 'AINE / analgésico' },
  { dci: 'Etoricoxib', codigoAtc: 'M01AH05', concentracion: '90 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Arcoxia', grupo: 'AINE / analgésico' },
  { dci: 'Paracetamol', codigoAtc: 'N02BE01', concentracion: '500 mg', formaFarmaceutica: 'tableta', viaAdministracion: 'oral', nombresComerciales: 'Panadol', grupo: 'AINE / analgésico' },

  // ── Anestésicos locales (uña encarnada, matricectomía) ──
  { dci: 'Lidocaína', codigoAtc: 'N01BB02', concentracion: '2 %', formaFarmaceutica: 'solución inyectable', viaAdministracion: 'infiltración', nombresComerciales: 'Xylocaína', grupo: 'Anestésico local' },
  { dci: 'Lidocaína', codigoAtc: 'N01BB02', concentracion: '10 %', formaFarmaceutica: 'spray', viaAdministracion: 'tópica', nombresComerciales: 'Xylocaína spray', grupo: 'Anestésico local' },

  // ── Antisépticos y curación de heridas ──
  { dci: 'Clorhexidina', codigoAtc: 'D08AC02', concentracion: '2 %', formaFarmaceutica: 'solución', viaAdministracion: 'tópica', nombresComerciales: 'Hibiscrub', grupo: 'Antiséptico / curación' },
  { dci: 'Povidona yodada', codigoAtc: 'D08AG02', concentracion: '10 %', formaFarmaceutica: 'solución', viaAdministracion: 'tópica', nombresComerciales: 'Isodine, Yodopovidona', grupo: 'Antiséptico / curación' },
  { dci: 'Peróxido de hidrógeno', codigoAtc: 'D08AX01', concentracion: '3 %', formaFarmaceutica: 'solución', viaAdministracion: 'tópica', nombresComerciales: 'Agua oxigenada', grupo: 'Antiséptico / curación' },
  { dci: 'Nitrato de plata', codigoAtc: 'D08AL01', concentracion: '40 %', formaFarmaceutica: 'aplicador', viaAdministracion: 'tópica', nombresComerciales: 'Lápiz de plata', grupo: 'Antiséptico / curación' },
  { dci: 'Fenol', concentracion: '88 %', formaFarmaceutica: 'solución', viaAdministracion: 'tópica', nombresComerciales: 'Fenol matricectomía', grupo: 'Antiséptico / procedimiento' },

  // ── Corticoides tópicos ──
  { dci: 'Betametasona', codigoAtc: 'D07AC01', concentracion: '0.05 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Betnovate', grupo: 'Corticoide tópico' },
  { dci: 'Clobetasol', codigoAtc: 'D07AD01', concentracion: '0.05 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Dermovate', grupo: 'Corticoide tópico' },
  { dci: 'Hidrocortisona', codigoAtc: 'D07AA02', concentracion: '1 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Cortaid', grupo: 'Corticoide tópico' },

  // ── Queratolíticos / hidratantes (hiperqueratosis, xerosis, verruga) ──
  { dci: 'Urea', codigoAtc: 'D02AE01', concentracion: '10 %', formaFarmaceutica: 'crema', viaAdministracion: 'tópica', nombresComerciales: 'Ureadin', grupo: 'Queratolítico / hidratante' },
  { dci: 'Urea', codigoAtc: 'D02AE01', concentracion: '40 %', formaFarmaceutica: 'ungüento', viaAdministracion: 'tópica', nombresComerciales: 'Ureadin 40', grupo: 'Queratolítico / hidratante' },
  { dci: 'Ácido salicílico + ácido láctico', concentracion: '16.7 %', formaFarmaceutica: 'solución', viaAdministracion: 'tópica', nombresComerciales: 'Duofilm, Verrutol', grupo: 'Queratolítico / hidratante' },
];

// Venta BAJO RECETA (solo puede ir en una Receta Médica firmada por médico): sistémicos orales,
// antibióticos, anestésicos inyectables y corticoides potentes. El resto es de venta libre (OTC)
// y puede ir en las Indicaciones podológicas. Regla por grupo + excepciones por DCI.
const GRUPOS_RX = new Set(['Antifúngico sistémico', 'Antibiótico', 'Anestésico local']);
const DCI_RX = new Set(['Etoricoxib', 'Clobetasol', 'Betametasona', 'Mupirocina', 'Ácido fusídico']);
export function requiereReceta(f: FilaMed): boolean {
  if (f.dci === 'Lidocaína' && f.formaFarmaceutica === 'spray') return false; // tópico
  return GRUPOS_RX.has(f.grupo) || DCI_RX.has(f.dci);
}

export async function sembrarMedicamentos(db: PrismaClient): Promise<{ total: number }> {
  const filas = VADEMECUM;
  const LOTE = 100;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    await db.$transaction(
      lote.map((f) => {
        const id = slugMed(f);
        const data = {
          dci: f.dci,
          codigoAtc: f.codigoAtc ?? null,
          concentracion: f.concentracion ?? null,
          formaFarmaceutica: f.formaFarmaceutica ?? null,
          viaAdministracion: f.viaAdministracion ?? null,
          nombresComerciales: f.nombresComerciales ?? null,
          grupo: f.grupo,
          requiereReceta: requiereReceta(f),
          activo: true,
        };
        return db.medicamento.upsert({ where: { id }, update: data, create: { id, ...data } });
      }),
    );
  }
  return { total: filas.length };
}

// Ejecución directa
if (require.main === module) {
  const db = new PrismaClient();
  sembrarMedicamentos(db)
    .then((r) => {
      console.log(`✓ Vademécum sembrado: ${r.total} medicamentos`);
      return db.$disconnect();
    })
    .catch(async (e) => {
      console.error('✗ Error sembrando medicamentos:', e);
      await db.$disconnect();
      process.exit(1);
    });
}
