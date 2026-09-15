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

// Posología SUGERIDA por presentación (3.4): se precarga en la receta al elegir el fármaco y el
// profesional la ajusta. Redactada para el paciente (sin abreviaturas). Provisional hasta que el
// doctor devuelva el Word «Contenido clínico para completar»; la clave es el slug de `slugMed`.
export const POSOLOGIA: Record<string, string> = {
  'terbinafina-250-mg-tableta': '1 tableta al día con las comidas, por 12 semanas (uñas de los pies)',
  'itraconazol-100-mg-capsula': '2 cápsulas cada 12 horas con las comidas, 1 semana al mes, por 3 meses (pulsos)',
  'fluconazol-150-mg-capsula': '1 cápsula una vez por semana, por 6 a 12 meses (uñas de los pies)',
  'griseofulvina-500-mg-tableta': '1 tableta al día con comida grasa, por 4 a 6 meses',
  'ciclopirox-8-laca-ungueal': 'Aplicar sobre la uña limpia 1 vez al día; retirar con alcohol 1 vez por semana',
  'amorolfina-5-laca-ungueal': 'Aplicar sobre la uña limada 1 a 2 veces por semana, hasta que crezca sana',
  'clotrimazol-1-crema': 'Aplicar una capa fina 2 veces al día por 2 a 4 semanas',
  'ketoconazol-2-crema': 'Aplicar una capa fina 1 vez al día por 2 a 4 semanas',
  'terbinafina-1-crema': 'Aplicar una capa fina 1 vez al día por 1 a 2 semanas',
  'miconazol-2-crema': 'Aplicar una capa fina 2 veces al día por 2 a 4 semanas',
  'tolnaftato-1-crema': 'Aplicar una capa fina 2 veces al día por 2 a 4 semanas',
  'cefalexina-500-mg-capsula': '1 cápsula cada 6 horas por 7 días',
  'amoxicilina-acido-clavulanico-500-125-mg-tableta': '1 tableta cada 8 horas con alimentos por 7 días',
  'clindamicina-300-mg-capsula': '1 cápsula cada 8 horas con un vaso de agua por 7 días',
  'ciprofloxacino-500-mg-tableta': '1 tableta cada 12 horas por 7 días; no tomar con leche ni antiácidos',
  'dicloxacilina-500-mg-capsula': '1 cápsula cada 6 horas, 1 hora antes de las comidas, por 7 días',
  'mupirocina-2-unguento': 'Aplicar sobre la lesión limpia 3 veces al día por 7 días',
  'acido-fusidico-2-crema': 'Aplicar sobre la lesión limpia 3 veces al día por 7 días',
  'ibuprofeno-400-mg-tableta': '1 tableta cada 8 horas después de las comidas, solo si hay dolor, máximo 5 días',
  'naproxeno-550-mg-tableta': '1 tableta cada 12 horas después de las comidas, solo si hay dolor, máximo 5 días',
  'diclofenaco-50-mg-tableta': '1 tableta cada 8 horas después de las comidas, solo si hay dolor, máximo 5 días',
  'diclofenaco-1-gel': 'Aplicar y masajear sobre la zona 3 veces al día',
  'etoricoxib-90-mg-tableta': '1 tableta al día, solo si hay dolor, máximo 5 días',
  'paracetamol-500-mg-tableta': '1 a 2 tabletas cada 8 horas si hay dolor; no pasar de 6 tabletas (3 g) al día',
  'lidocaina-2-solucion-inyectable': 'Uso en consultorio: bloqueo digital, 2 a 4 mL según el procedimiento',
  'lidocaina-10-spray': 'Uso en consultorio: 1 a 3 aplicaciones sobre la zona antes del procedimiento',
  'clorhexidina-2-solucion': 'Lavar la zona 1 a 2 veces al día y secar bien',
  'povidona-yodada-10-solucion': 'Aplicar sobre la herida limpia 1 a 2 veces al día',
  'peroxido-de-hidrogeno-3-solucion': 'Limpiar la herida 1 vez al día y enjuagar con suero o agua hervida fría',
  'nitrato-de-plata-40-aplicador': 'Uso en consultorio: tocar solo el tejido sobrante, 1 vez por sesión',
  'fenol-88-solucion': 'Uso en consultorio: matricectomía química, 3 aplicaciones de 1 minuto',
  'betametasona-0-05-crema': 'Aplicar una capa fina 1 a 2 veces al día por máximo 2 semanas',
  'clobetasol-0-05-crema': 'Aplicar una capa fina 1 vez al día por máximo 2 semanas; no en heridas abiertas',
  'hidrocortisona-1-crema': 'Aplicar una capa fina 2 veces al día por máximo 1 semana',
  'urea-10-crema': 'Aplicar en los pies 2 veces al día, después del baño y antes de dormir',
  'urea-40-unguento': 'Aplicar solo sobre la callosidad o la uña 1 vez al día por la noche, cubrir',
  'acido-salicilico-acido-lactico-16-7-solucion': 'Aplicar 1 gota sobre la verruga 1 vez al día, proteger la piel sana; limar antes',
};

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
          posologiaSugerida: POSOLOGIA[id] ?? null,
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
