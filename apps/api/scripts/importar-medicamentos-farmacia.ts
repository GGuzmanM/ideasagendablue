/**
 * VADEMÉCUM: carga la lista de la farmacia de la clínica (23-sep-2026) al catálogo `medicamentos` que usan las
 * recetas y las indicaciones podológicas. TSV de dos columnas: descripción del producto · marca/laboratorio.
 *
 *   npx ts-node --transpile-only scripts/importar-medicamentos-farmacia.ts --archivo="…tsv"            → SIMULA
 *   npx ts-node --transpile-only scripts/importar-medicamentos-farmacia.ts --archivo="…tsv" --aplicar  → ESCRIBE
 *   (con ENV_FILE=… apunta a la base de pruebas)
 *
 * Reglas:
 *  · FÁRMACOS: se identifican por principio activo (DCI) + concentración + forma con la tabla FARMACOS de abajo. Si
 *    ya existe en el catálogo (mismo id), solo se le agrega la marca a `nombresComerciales`; si no, se crea con su
 *    grupo, si exige receta y una posología sugerida cuando es de uso podológico habitual.
 *  · PRODUCTOS (plantillas, dedales, medias, gasas, tapes, aceites, talcos…): `esProducto=true`, sin receta. Las
 *    tallas y presentaciones (talla 39, 25 ml, x 10 und) se quitan para no crear 5 filas del mismo producto.
 *  · Se EXCLUYE lo que no se receta ni se indica en la clínica (preservativos, shampoo, pañales, toallas, bebidas,
 *    afeitadoras, pasta dental…). Lo que no se pudo identificar queda listado para revisar a mano.
 *  Re-ejecutable: nunca duplica (id por slug); una segunda corrida solo completa marcas.
 */
import '../src/cargarEnv';
import fs from 'fs';
import { prisma } from '../src/db';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ARCHIVO = arg('archivo'); const APLICAR = process.argv.includes('--aplicar'); const INFORME = arg('informe');
if (!ARCHIVO) { console.error('Uso: --archivo="ruta.tsv" [--aplicar] [--informe="ruta.txt"]'); process.exit(2); }

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9%+./ ]/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titulo = (s: string) => s.toLowerCase().replace(/(^|[\s(\-/"])\p{L}/gu, (c) => c.toUpperCase());

type Farmaco = { re: RegExp; id: string; dci: string; conc?: string; forma?: string; via?: string; grupo: string; receta: boolean; posologia?: string; marca?: string };
// ── Tabla de fármacos (regex sobre la descripción normalizada) ─────────────────────────────────────────────────
const RX = true, OTC = false;
const FARMACOS: Farmaco[] = [
  { re: /loceryl|unesia|amorolfina/, id: 'amorolfina-5-laca-ungueal', dci: 'Amorolfina', grupo: 'Antifúngico tópico', receta: OTC },
  { re: /itramicol|neozol|itraconazol/, id: 'itraconazol-100-mg-capsula', dci: 'Itraconazol', grupo: 'Antifúngico sistémico', receta: RX },
  { re: /hibiclen/, id: 'clorhexidina-2-solucion', dci: 'Clorhexidina', grupo: 'Antiséptico / curación', receta: OTC },
  { re: /ureadin ultra 10|ureadin podos/, id: 'urea-10-crema', dci: 'Urea', grupo: 'Queratolítico / hidratante', receta: OTC },
  { re: /ureadin ultra 30/, id: 'urea-30-crema', dci: 'Urea', conc: '30 %', forma: 'crema', via: 'tópica', grupo: 'Queratolítico / hidratante', receta: OTC, posologia: 'Aplicar sobre talones y zonas de piel gruesa 1 vez al día por la noche' },
  { re: /terbilab.*crema|terbinafina.*1%/, id: 'terbinafina-1-crema', dci: 'Terbinafina', grupo: 'Antifúngico tópico', receta: OTC },
  { re: /terbilab.*250|terbinafina.*250/, id: 'terbinafina-250-mg-tableta', dci: 'Terbinafina', grupo: 'Antifúngico sistémico', receta: RX },
  { re: /drysol|xerac/, id: 'cloruro-de-aluminio-20-solucion', dci: 'Cloruro de aluminio hexahidratado', conc: '20 %', forma: 'solución', via: 'tópica', grupo: 'Antitranspirante (hiperhidrosis)', receta: OTC, posologia: 'Aplicar en los pies limpios y secos por la noche, 2 a 3 veces por semana; lavar por la mañana' },
  { re: /mupibiot|mupirocina/, id: 'mupirocina-2-unguento', dci: 'Mupirocina', grupo: 'Antibiótico tópico', receta: RX },
  { re: /dermodax/, id: 'betametasona-clotrimazol-gentamicina-crema', dci: 'Betametasona + clotrimazol + gentamicina', conc: '0.05 % / 1 % / 0.1 %', forma: 'crema', via: 'tópica', grupo: 'Corticoide + antifúngico + antibiótico tópico', receta: RX, posologia: 'Aplicar una capa fina 2 veces al día por máximo 2 semanas' },
  { re: /trosid|laca tr\b/, id: 'tioconazol-28-solucion-ungueal', dci: 'Tioconazol', conc: '28 %', forma: 'solución ungueal', via: 'tópica', grupo: 'Antifúngico tópico', receta: OTC, posologia: 'Aplicar sobre la uña afectada y el borde 2 veces al día por 6 a 12 meses' },
  { re: /flexoplus|indometacina/, id: 'indometacina-1-solucion', dci: 'Indometacina', conc: '1 %', forma: 'solución tópica', via: 'tópica', grupo: 'AINE / analgésico tópico', receta: OTC, posologia: 'Aplicar sobre la zona dolorosa 3 veces al día' },
  { re: /cloruro de sodio/, id: 'cloruro-de-sodio-0-9-solucion', dci: 'Cloruro de sodio', conc: '0.9 %', forma: 'solución', via: 'tópica / irrigación', grupo: 'Antiséptico / curación', receta: OTC, posologia: 'Irrigar la herida con suero antes de la curación' },
  { re: /athlete s foot|tinactin/, id: 'tolnaftato-1-polvo-spray', dci: 'Tolnaftato', conc: '1 %', forma: 'polvo en spray', via: 'tópica', grupo: 'Antifúngico tópico', receta: OTC, posologia: 'Aplicar en pies y calzado 2 veces al día por 2 a 4 semanas' },
  { re: /neosporin/, id: 'neomicina-polimixina-b-bacitracina-unguento', dci: 'Neomicina + polimixina B + bacitracina', forma: 'ungüento', via: 'tópica', grupo: 'Antibiótico tópico', receta: OTC, posologia: 'Aplicar sobre la herida limpia 1 a 3 veces al día' },
  { re: /mometasona/, id: 'mometasona-0-1-crema', dci: 'Mometasona', conc: '0.1 %', forma: 'crema', via: 'tópica', grupo: 'Corticoide tópico', receta: RX, posologia: 'Aplicar una capa fina 1 vez al día por máximo 2 semanas' },
  { re: /idosafe|povidona yodada 8.5/, id: 'povidona-yodada-8-5-espuma', dci: 'Povidona yodada', conc: '8.5 %', forma: 'espuma', via: 'tópica', grupo: 'Antiséptico / curación', receta: OTC, posologia: 'Lavar la zona con la espuma, dejar actuar 1 minuto y enjuagar' },
  { re: /dolo neurobion/, id: 'diclofenaco-vitaminas-b-capsula', dci: 'Diclofenaco + tiamina + piridoxina + cianocobalamina', conc: '50 mg + complejo B', forma: 'cápsula', via: 'oral', grupo: 'AINE / analgésico', receta: OTC, posologia: '1 cápsula cada 12 horas con alimentos, solo si hay dolor, máximo 5 días' },
  { re: /etoricoxib 120/, id: 'etoricoxib-120-mg-tableta', dci: 'Etoricoxib', conc: '120 mg', forma: 'tableta', via: 'oral', grupo: 'AINE / analgésico', receta: RX, posologia: '1 tableta al día, máximo 8 días' },
  { re: /etoricoxib 90/, id: 'etoricoxib-90-mg-tableta', dci: 'Etoricoxib', grupo: 'AINE / analgésico', receta: RX },
  { re: /biobroncol|cefalexina/, id: 'cefalexina-500-mg-capsula', dci: 'Cefalexina', grupo: 'Antibiótico', receta: RX },
  { re: /panadol antigripal|vitapyrena/, id: 'paracetamol-clorfenamina-fenilefrina-tableta', dci: 'Paracetamol + clorfenamina + fenilefrina', forma: 'tableta / sobre', via: 'oral', grupo: 'Farmacia general (antigripal)', receta: OTC },
  { re: /minoxidil/, id: 'minoxidil-5-solucion-capilar', dci: 'Minoxidil', conc: '5 %', forma: 'solución capilar', via: 'tópica', grupo: 'Farmacia general (dermatológico)', receta: OTC },
  { re: /bonadol migrana|paracetamol 500mg\+cafeina/, id: 'paracetamol-cafeina-500-65-mg-capsula', dci: 'Paracetamol + cafeína', conc: '500 mg + 65 mg', forma: 'cápsula', via: 'oral', grupo: 'AINE / analgésico', receta: OTC },
  { re: /dolocheck|paracetamol 500mg \+ ibuprofeno/, id: 'paracetamol-ibuprofeno-500-200-mg-capsula', dci: 'Paracetamol + ibuprofeno', conc: '500 mg + 200 mg', forma: 'cápsula', via: 'oral', grupo: 'AINE / analgésico', receta: OTC, posologia: '1 cápsula cada 8 horas después de las comidas, solo si hay dolor, máximo 5 días' },
  { re: /bonadol|panadol forte|paracetamol 500/, id: 'paracetamol-500-mg-tableta', dci: 'Paracetamol', grupo: 'AINE / analgésico', receta: OTC },
  { re: /nopramax|naproxeno sodico 500/, id: 'naproxeno-500-mg-tableta', dci: 'Naproxeno sódico', conc: '500 mg', forma: 'tableta', via: 'oral', grupo: 'AINE / analgésico', receta: OTC, posologia: '1 tableta cada 12 horas después de las comidas, solo si hay dolor, máximo 5 días' },
  { re: /naproxeno sodico 550/, id: 'naproxeno-550-mg-tableta', dci: 'Naproxeno', grupo: 'AINE / analgésico', receta: OTC },
  { re: /alcohol puro 96/, id: 'alcohol-etilico-96-solucion', dci: 'Alcohol etílico', conc: '96°', forma: 'solución', via: 'tópica', grupo: 'Antiséptico / curación', receta: OTC },
  { re: /alcohol medicinal 70/, id: 'alcohol-etilico-70-solucion', dci: 'Alcohol etílico', conc: '70°', forma: 'solución', via: 'tópica', grupo: 'Antiséptico / curación', receta: OTC, posologia: 'Desinfectar la piel sana alrededor de la lesión; no aplicar en heridas abiertas' },
  { re: /alcohol yodado/, id: 'alcohol-yodado-solucion', dci: 'Alcohol yodado', forma: 'solución', via: 'tópica', grupo: 'Antiséptico / curación', receta: OTC },
  { re: /agua oxigenada/, id: 'peroxido-de-hidrogeno-3-solucion', dci: 'Peróxido de hidrógeno', grupo: 'Antiséptico / curación', receta: OTC },
  { re: /miodel relax/, id: 'paracetamol-orfenadrina-450-35-mg-tableta', dci: 'Paracetamol + orfenadrina', conc: '450 mg + 35 mg', forma: 'tableta', via: 'oral', grupo: 'Analgésico / relajante muscular', receta: OTC, posologia: '1 tableta cada 8 horas, máximo 5 días; puede dar somnolencia' },
  { re: /uropol forte/, id: 'fenazopiridina-200-mg-tableta', dci: 'Fenazopiridina', conc: '200 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (urinario)', receta: RX },
  { re: /fenazopiridina/, id: 'fenazopiridina-100-mg-tableta', dci: 'Fenazopiridina', conc: '100 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (urinario)', receta: RX },
  { re: /sildex 100|sildenafilo 100/, id: 'sildenafilo-100-mg-tableta', dci: 'Sildenafilo', conc: '100 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general', receta: RX },
  { re: /sildex 50|sildenafilo 50/, id: 'sildenafilo-50-mg-tableta', dci: 'Sildenafilo', conc: '50 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general', receta: RX },
  { re: /anaflex|ibuprofeno 200/, id: 'ibuprofeno-200-mg-capsula', dci: 'Ibuprofeno', conc: '200 mg', forma: 'cápsula', via: 'oral', grupo: 'AINE / analgésico', receta: OTC, posologia: '1 a 2 cápsulas cada 8 horas después de las comidas, solo si hay dolor' },
  { re: /ibuprofeno 400/, id: 'ibuprofeno-400-mg-tableta', dci: 'Ibuprofeno', grupo: 'AINE / analgésico', receta: OTC },
  { re: /bismutol/, id: 'subsalicilato-de-bismuto-262-mg-tableta', dci: 'Subsalicilato de bismuto', conc: '262 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (digestivo)', receta: OTC },
  { re: /coxsciens|celecoxib/, id: 'celecoxib-400-mg-capsula', dci: 'Celecoxib', conc: '400 mg', forma: 'cápsula', via: 'oral', grupo: 'AINE / analgésico', receta: RX, posologia: '1 cápsula al día con alimentos, máximo 5 días' },
  { re: /hepavit|b complex/, id: 'complejo-b-capsula', dci: 'Complejo B (tiamina + piridoxina + cianocobalamina)', forma: 'cápsula', via: 'oral', grupo: 'Vitaminas', receta: OTC },
  { re: /mesigyna/, id: 'noretisterona-estradiol-inyectable', dci: 'Enantato de noretisterona + valerato de estradiol', conc: '50 mg + 5 mg', forma: 'solución inyectable', via: 'intramuscular', grupo: 'Farmacia general (anticonceptivo)', receta: RX },
  { re: /nogestrol|levonorgestrel/, id: 'levonorgestrel-1-5-mg-tableta', dci: 'Levonorgestrel', conc: '1.5 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (anticonceptivo)', receta: OTC },
  { re: /hisaler|cetirizina 10|cetirizina diclorhidrato 10/, id: 'cetirizina-10-mg-tableta', dci: 'Cetirizina', conc: '10 mg', forma: 'tableta', via: 'oral', grupo: 'Antihistamínico', receta: OTC, posologia: '1 tableta al día, de preferencia por la noche' },
  { re: /cetirizina medrock|cetirizina 5 mg\/5 ml/, id: 'cetirizina-5-mg-5-ml-jarabe', dci: 'Cetirizina', conc: '5 mg/5 mL', forma: 'jarabe', via: 'oral', grupo: 'Antihistamínico', receta: OTC },
  { re: /dolocort|diclofenaco 2%/, id: 'diclofenaco-2-gel', dci: 'Diclofenaco', conc: '2 %', forma: 'gel', via: 'tópica', grupo: 'AINE / analgésico tópico', receta: OTC, posologia: 'Aplicar y masajear sobre la zona 2 a 3 veces al día' },
  { re: /donalab|loperamida/, id: 'loperamida-2-mg-tableta', dci: 'Loperamida', conc: '2 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (digestivo)', receta: OTC },
  { re: /omeprazol 20/, id: 'omeprazol-20-mg-capsula', dci: 'Omeprazol', conc: '20 mg', forma: 'cápsula', via: 'oral', grupo: 'Farmacia general (digestivo)', receta: OTC, posologia: '1 cápsula en ayunas, 30 minutos antes del desayuno' },
  { re: /roxtrim pediatrico/, id: 'sulfametoxazol-trimetoprima-suspension', dci: 'Sulfametoxazol + trimetoprima', conc: '200/40 mg por 5 mL', forma: 'suspensión oral', via: 'oral', grupo: 'Antibiótico', receta: RX },
  { re: /roxtrim forte|sulfametoxazol/, id: 'sulfametoxazol-trimetoprima-800-160-mg-tableta', dci: 'Sulfametoxazol + trimetoprima', conc: '800/160 mg', forma: 'tableta', via: 'oral', grupo: 'Antibiótico', receta: RX, posologia: '1 tableta cada 12 horas con abundante agua por 7 días' },
  { re: /aciclovir 800/, id: 'aciclovir-800-mg-tableta', dci: 'Aciclovir', conc: '800 mg', forma: 'tableta', via: 'oral', grupo: 'Antiviral', receta: RX, posologia: '1 tableta 5 veces al día por 7 días' },
  { re: /aciclovir 5%/, id: 'aciclovir-5-crema', dci: 'Aciclovir', conc: '5 %', forma: 'crema', via: 'tópica', grupo: 'Antiviral', receta: OTC, posologia: 'Aplicar sobre la lesión 5 veces al día por 5 días' },
  { re: /lidocaina 5%/, id: 'lidocaina-5-unguento', dci: 'Lidocaína', conc: '5 %', forma: 'ungüento', via: 'tópica', grupo: 'Anestésico local', receta: OTC, posologia: 'Aplicar una capa fina sobre la zona 20 a 30 minutos antes del procedimiento' },
  { re: /levosciens|levocetirizina/, id: 'levocetirizina-5-mg-tableta', dci: 'Levocetirizina', conc: '5 mg', forma: 'tableta', via: 'oral', grupo: 'Antihistamínico', receta: OTC, posologia: '1 tableta al día por la noche' },
  { re: /floril/, id: 'nafazolina-0-03-gotas-oftalmicas', dci: 'Nafazolina', conc: '0.03 %', forma: 'gotas oftálmicas', via: 'oftálmica', grupo: 'Farmacia general (oftálmico)', receta: OTC },
  { re: /clotrimazol 1%/, id: 'clotrimazol-1-crema', dci: 'Clotrimazol', grupo: 'Antifúngico tópico', receta: OTC },
  { re: /acido folico/, id: 'acido-folico-0-5-mg-tableta', dci: 'Ácido fólico', conc: '0.5 mg', forma: 'tableta', via: 'oral', grupo: 'Vitaminas', receta: OTC },
  { re: /ceftrisol|ceftriaxona/, id: 'ceftriaxona-1-g-inyectable', dci: 'Ceftriaxona', conc: '1 g', forma: 'polvo para solución inyectable', via: 'intramuscular / intravenosa', grupo: 'Antibiótico', receta: RX },
  { re: /sal de andrews/, id: 'bicarbonato-acido-citrico-sobre', dci: 'Bicarbonato de sodio + ácido cítrico (sal efervescente)', forma: 'sobre', via: 'oral', grupo: 'Farmacia general (digestivo)', receta: OTC },
  { re: /equalax|bisacodilo|bisacolido/, id: 'bisacodilo-5-mg-tableta', dci: 'Bisacodilo', conc: '5 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (digestivo)', receta: OTC },
  { re: /dolol|paracetamol 160/, id: 'paracetamol-160-mg-5-ml-jarabe', dci: 'Paracetamol', conc: '160 mg/5 mL', forma: 'jarabe', via: 'oral', grupo: 'AINE / analgésico', receta: OTC },
  { re: /amoxicilina \+ ac|amoxicilina\+ac/, id: 'amoxicilina-acido-clavulanico-500-125-mg-tableta', dci: 'Amoxicilina + ácido clavulánico', grupo: 'Antibiótico', receta: RX },
  { re: /dinapen|dicloxacilina/, id: 'dicloxacilina-500-mg-capsula', dci: 'Dicloxacilina', grupo: 'Antibiótico', receta: RX },
  { re: /aerolisin|simeticona 80mg\/ml/, id: 'simeticona-80-mg-ml-gotas', dci: 'Simeticona', conc: '80 mg/mL', forma: 'gotas orales', via: 'oral', grupo: 'Farmacia general (digestivo)', receta: OTC },
  { re: /simeticona/, id: 'simeticona-80-mg-tableta', dci: 'Simeticona', conc: '80 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (digestivo)', receta: OTC },
  { re: /aspirina 100/, id: 'acido-acetilsalicilico-100-mg-tableta', dci: 'Ácido acetilsalicílico', conc: '100 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (antiagregante)', receta: OTC },
  { re: /dobesilato/, id: 'dobesilato-calcico-500-mg-capsula', dci: 'Dobesilato cálcico', conc: '500 mg', forma: 'cápsula', via: 'oral', grupo: 'Venotónico', receta: RX, posologia: '1 cápsula cada 12 horas con las comidas' },
  { re: /betapluss|betametasona.*0.05/, id: 'betametasona-0-05-crema', dci: 'Betametasona', grupo: 'Corticoide tópico', receta: RX },
  { re: /losartan/, id: 'losartan-50-mg-tableta', dci: 'Losartán', conc: '50 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (antihipertensivo)', receta: RX },
  { re: /levotiroxina/, id: 'levotiroxina-100-mcg-tableta', dci: 'Levotiroxina', conc: '100 mcg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (tiroides)', receta: RX },
  { re: /ampicilina/, id: 'ampicilina-500-mg-capsula', dci: 'Ampicilina', conc: '500 mg', forma: 'cápsula', via: 'oral', grupo: 'Antibiótico', receta: RX, posologia: '1 cápsula cada 6 horas, 1 hora antes de las comidas, por 7 días' },
  { re: /bicarbonato de sodio/, id: 'bicarbonato-de-sodio-polvo', dci: 'Bicarbonato de sodio', forma: 'polvo', via: 'oral / tópica', grupo: 'Farmacia general', receta: OTC },
  { re: /clinda c|clindamicina/, id: 'clindamicina-300-mg-capsula', dci: 'Clindamicina', grupo: 'Antibiótico', receta: RX },
  { re: /dexametasona 4/, id: 'dexametasona-4-mg-tableta', dci: 'Dexametasona', conc: '4 mg', forma: 'tableta', via: 'oral', grupo: 'Corticoide sistémico', receta: RX },
  { re: /loratadina/, id: 'loratadina-10-mg-tableta', dci: 'Loratadina', conc: '10 mg', forma: 'tableta', via: 'oral', grupo: 'Antihistamínico', receta: OTC, posologia: '1 tableta al día' },
  { re: /prednisona 5/, id: 'prednisona-5-mg-tableta', dci: 'Prednisona', conc: '5 mg', forma: 'tableta', via: 'oral', grupo: 'Corticoide sistémico', receta: RX },
  { re: /ciprofloxacino/, id: 'ciprofloxacino-500-mg-tableta', dci: 'Ciprofloxacino', grupo: 'Antibiótico', receta: RX },
  { re: /clorfenamina 10mg\/1ml|clorfenamina.*iny/, id: 'clorfenamina-10-mg-ml-inyectable', dci: 'Clorfenamina', conc: '10 mg/mL', forma: 'solución inyectable', via: 'intramuscular', grupo: 'Antihistamínico', receta: RX },
  { re: /esomeprazol/, id: 'esomeprazol-40-mg-tableta', dci: 'Esomeprazol', conc: '40 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (digestivo)', receta: OTC },
  { re: /mentholatum/, id: 'mentol-alcanfor-unguento', dci: 'Mentol + alcanfor', forma: 'ungüento', via: 'tópica', grupo: 'Farmacia general (rubefaciente)', receta: OTC },
  { re: /dimenhidrinato/, id: 'dimenhidrinato-50-mg-tableta', dci: 'Dimenhidrinato', conc: '50 mg', forma: 'tableta', via: 'oral', grupo: 'Farmacia general (antiemético)', receta: OTC },
  { re: /supracalm|paracetamol 1g/, id: 'paracetamol-1-g-tableta', dci: 'Paracetamol', conc: '1 g', forma: 'tableta', via: 'oral', grupo: 'AINE / analgésico', receta: OTC, posologia: '1 tableta cada 8 horas si hay dolor; no pasar de 3 g al día' },
  { re: /supositorio de glicerina/, id: 'glicerina-supositorio-adulto', dci: 'Glicerina', conc: '2.37 g', forma: 'supositorio', via: 'rectal', grupo: 'Farmacia general (digestivo)', receta: OTC },
  { re: /ketorolaco/, id: 'ketorolaco-10-mg-tableta', dci: 'Ketorolaco', conc: '10 mg', forma: 'tableta', via: 'oral', grupo: 'AINE / analgésico', receta: RX, posologia: '1 tableta cada 8 horas solo si hay dolor, máximo 5 días' },
  { re: /buk vitamina c/, id: 'acido-ascorbico-sobre', dci: 'Ácido ascórbico (vitamina C)', forma: 'sobre', via: 'oral', grupo: 'Vitaminas', receta: OTC },
];

// Marca comercial cuando el primer token de la descripción no sirve (compuestos, genéricos).
const MARCA_FARMACO: [RegExp, string][] = [
  [/dolo neurobion/, 'Dolo-Neurobion Forte'], [/sal de andrews/, 'Sal de Andrews'], [/clinda c/, 'Clinda C'], [/laca tr\b|trosid/, 'Trosid'], [/xerac/, 'Xerac AC'], [/drysol/, 'Drysol'],
  [/ureadin ultra 10/, 'Ureadin Ultra 10'], [/ureadin ultra 30/, 'Ureadin Ultra 30'], [/ureadin podos/, 'Ureadin Podos'], [/loceryl/, 'Loceryl'], [/athlete s foot/, "Dr Scholl's Athlete's Foot"], [/tinactin/, 'Tinactin'],
  [/panadol antigripal/, 'Panadol Antigripal'], [/panadol forte/, 'Panadol Forte'], [/vitapyrena/, 'Vitapyrena Forte'], [/bonadol migrana/, 'Bonadol Migraña'], [/bonadol/, 'Bonadol'], [/miodel relax/, 'Miodel Relax NF'], [/uropol/, 'Uropol Forte'],
  [/sildex/, 'Sildex'], [/roxtrim pediatrico/, 'Roxtrim Pediátrico'], [/roxtrim forte/, 'Roxtrim Forte'], [/dolocheck/, 'Dolocheck'], [/dolol/, 'Dolol'], [/aerolisin/, 'Aerolisin'], [/mentholatum/, 'Mentholatum'], [/supracalm/, 'Supracalm'],
  [/^simeticona/, ''], [/^cloruro de sodio/, ''],
];
const GENERICAS = /^(laca|sal|dolo|clinda|simeticona|alcohol|agua|cloruro|acido|acidos)$/i;

// ── Productos: grupo por palabras clave ────────────────────────────────────────────────────────────────────────
const GRUPOS_PRODUCTO: [RegExp, string][] = [
  [/tape|venda|sensi wrap|hypafix|esparadrapo|gasa|jeringa|guantes quirurgicos|algodon|venditas|frasco esteril|botiquin/, 'Insumos de curación'],
  [/plantilla|soporte de arco|pedag|hunter flex|tri comfort|massaging gel|walk longer|plantar fasciitis|bambini/, 'Plantillas y ortesis'],
  [/sandalia|confortina|flip flop/, 'Calzado'],
  [/medias|diabetes.*circulatory/, 'Medias'],
  [/dedal|juanet|bunion|separador|metatarsal|anillo|aductor|talonera|heel cup|moleskin|fieltro|parche|almohadilla|protector|tubo recortable|sleeve|toe cap|guante|cinta|spenco|ankle waterproof/, 'Protección y descarga'],
  [/silicona|reaktol|forro de cuero/, 'Insumos de ortesis'],
  [/tea tree|aceite esencial|gehwol|talco|excinail|removedor|sanytol|loccitane|ikaro|ice spray|bloqueador|faces spf|jabon|laca/, 'Cuidado del pie y la piel'],
];
// Lo que no se receta ni se indica en la clínica (queda fuera, listado en el informe).
const EXCLUIR = /preservativo|shampoo|savital|nutribela|pantene|panal|babysec|tena slip|toalla nosotras|nosotras|papel higienico|agua de mesa|limonada|suerox|electrolight|maquina de afeitar|schick|desodorante|nivea|colgate|kolynos|enjuague bucal|cepillo|hisopos|toallitas|cotton pads|veriprime|prueba de embarazo|johnsons|off family|repelente|crema para peinar|peldanos/;
// Composición no identificada: se listan para revisar a mano (no se inventa el principio activo).
const REVISAR = /flonase|digermin|broncophar|humed|gripacheck|dr\. flu|ciruelax|dolocordralan|frutenzima|plidan|chao nf|bona biotics|frutti pediatrico|portil nf|laca fn/;

const NOMBRE_PRODUCTO: [RegExp, string][] = [
  [/tea tree/, 'Aceite de árbol de té (tea tree)'], [/talco rexona/, 'Talco para pies Rexona Efficient'], [/isana talco/, 'Talco para pies Isana'],
  [/^gasa unidad/, 'Gasa (unidad)'], [/^algodon/, 'Algodón'], [/frasco esteril/, 'Frasco estéril 100 mL'], [/hypafix/, 'Hypafix (esparadrapo de fijación)'],
  [/aktive tape/, 'Aktive Tape (kinesiotape 5 cm x 5 m)'], [/hampton adams/, 'Hampton Adams kinesiology tape'], [/kinesiology tape sportstape/, 'Kinesiology tape Sportstape'],
  [/spenco 2nd skin/, 'Spenco 2nd Skin Squares (apósito de hidrogel)'], [/ankle waterproof/, 'Protector impermeable de tobillo (adulto)'],
  [/jeringa esteril de un solo uso con aguja/, 'Jeringa estéril con aguja 1 mL'], [/jeringa esteril 3ml/, 'Jeringa estéril 3 mL'], [/jeringa descartable/, 'Jeringa descartable (5 / 20 mL)'],
  [/esparadrapo 3m nexcare/, 'Esparadrapo Nexcare Micropore blanco'], [/guantes quirurgicos/, 'Guantes quirúrgicos de látex'], [/bahia bloqueador/, 'Bloqueador solar Bahía SPF 100'], [/bahia faces/, 'Bloqueador facial Bahía Faces SPF 90'],
  [/dr scholls diabetes.*men ankle/, 'Dr Scholls medias Diabetes & Circulatory hombre (ankle)'], [/dr scholls diabetes.*women/, 'Dr Scholls medias Diabetes & Circulatory mujer (low cut)'],
  [/podoks medias/, 'Podoks medias biomecánicas'], [/doctors choice medias/, 'Doctors Choice medias Full Cushion Diabetic Crew (mujer)'],
  [/svorto soporte de arco/, 'Svorto soporte de arco'], [/svorto plantillas de memoria/, 'Svorto plantillas de memoria inteligente contra el mal olor'], [/svorto plantillas sport relax/, 'Svorto plantillas Sport Relax'],
  [/dr scholls tri comfort/, 'Dr Scholls plantillas Tri Comfort Long Lasting (hombre)'], [/dr scholls work massaging/, 'Dr Scholls plantillas Work Massaging Gel (hombre)'], [/dr scholls walk longer/, 'Dr Scholls plantillas Walk Longer (mujer)'], [/dr scholls plantar fasciitis/, 'Dr Scholls plantillas Plantar Fasciitis (hombre)'],
  [/deramed 5th toe/, 'Deramed 5th Toe Gel Bunion Pad (protector de juanete de sastre)'], [/fresco fieltro adhesivo semi duro/, 'Fresco fieltro adhesivo semiduro 10 mm (plancha 45 x 22.5 cm)'], [/fresco fieltro 5 mm/, 'Fresco fieltro 5 mm (plancha 45 x 22.5 cm)'],
  [/fresco tubo recortable/, 'Fresco tubo recortable de gel'], [/fresco banda metatarsal/, 'Fresco banda metatarsal con gel'], [/deramed banda metatarsal/, 'Deramed banda metatarsal con gel'], [/fresco dedal protector/, 'Fresco dedal protector de gel'], [/fresco separador de dedos/, 'Fresco separador de dedos (carrete)'],
  [/fresco parche de moleskin rinon/, 'Fresco parche de moleskin riñón'], [/fresco juanetera/, 'Fresco juanetera de gel con separador de carrete'], [/deramed protective gel toe cap/, 'Deramed dedal de gel (Protective Gel Toe Cap)'], [/suavepie dedal/, 'Suavepie dedal de gel'],
  [/tima.*cinta metatarsal/, 'Tima cinta metatarsal grande (izquierda / derecha)'], [/codeor confortina/, 'Codeor Confortina (calzado) negro'], [/perpedes sandalias hawai/, 'Perpedes sandalias Hawai'], [/perpedes sandalias baleares/, 'Perpedes sandalias Baleares camel'],
  [/pedag bambini/, 'Pedag Bambini (plantilla infantil)'], [/moneta hunter flex/, 'Moneta Hunter Flex (plantilla para pies fríos)'], [/svorto aductor/, 'Svorto aductor diurno/nocturno elástico'], [/ice spray/, 'Ice Spray Nobel (spray frío)'],
  [/jabon liquido antibacterial/, 'Jabón líquido antibacterial Alkofarma'], [/loccitane/, "L'Occitane Amande concentré de lait (hidratante)"], [/sensi wrap/, 'Sensi Wrap (venda cohesiva)'], [/gehwol fluid/, 'Gehwol Fluid'], [/gehwol foot powder/, 'Gehwol Foot Powder (talco)'],
  [/venditas/, 'Venditas estándar Cureband'], [/botiquin/, 'Botiquín de primeros auxilios'], [/gasa absorbente esteril \(10x10/, 'Gasa absorbente estéril 10 x 10 cm'], [/gasa absorbente esteril \(5x5/, 'Gasa absorbente estéril 5 x 5 cm'],
];
const quitarPresentacion = (s: string) => s
  .replace(/\(\s*\d+[\d.,]*\s*(x\s*\d+[\d.,]*\s*)?(ml|gr|g|kg|cm|mm|m|und|unid|oz|par)?\s*\)/gi, ' ')
  .replace(/\b(talla|t\.)\s*[a-z0-9./ -]*$/i, '').replace(/\bt\s*\d[\d./ -]*$/i, '').replace(/\btalla\s*\S+/gi, '')
  .replace(/\b\d+[\d.,]*\s*x\s*\d+[\d.,]*\s*(ml|gr|g|kg|cm|mm|m|und)?\b/gi, ' ')
  .replace(/\b\d+[\d.,]*\s*(ml|gr|g|kg|cm|mm|oz|und|unid)\b\.?/gi, ' ')
  .replace(/\bfco\b|\bx\s*\d+\b|\bpaq\b|\bpar\b|\bund\b|\bunid\b|\bcja\b|\bcaj\b|\bbolsa\b|\ben caja\b|\ben bolsa\b|\bgrande\b|\bcolor piel\b|\bcolores varios\b|\(\s*[smlx/]+\s*\)/gi, ' ')
  .replace(/\(\s*\)/g, ' ').replace(/[\s.,:;\-–]+$/g, '').replace(/\s{2,}/g, ' ').trim();

async function main() {
  const out: string[] = []; const log = (s = '') => { console.log(s); out.push(s); };
  log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no escribe)'} · base «${(process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0]}»\n`);
  const lineas = fs.readFileSync(ARCHIVO!, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split('\t')).filter((c) => c[0]?.trim());
  const existentes = new Map((await prisma.medicamento.findMany()).map((m) => [m.id, m]));
  const cuenta = { farmacosNuevos: 0, marcasAgregadas: 0, productosNuevos: 0, yaEstaban: 0, excluidos: 0, revisar: 0 };
  const listas = { excluidos: [] as string[], revisar: [] as string[], nuevos: [] as string[], marcas: [] as string[], productos: [] as string[] };
  const productosVistos = new Map<string, { nombre: string; marcas: Set<string>; grupo: string; lineas: string[] }>();

  for (const [descRaw, marcaRaw = ''] of lineas) {
    const desc = descRaw.trim(); const n = norm(desc); const marca = marcaRaw.trim();
    if (EXCLUIR.test(n)) { cuenta.excluidos++; listas.excluidos.push(desc); continue; }
    if (REVISAR.test(n)) { cuenta.revisar++; listas.revisar.push(`${desc}${marca ? ` (${marca})` : ''}`); continue; }
    const f = FARMACOS.find((x) => x.re.test(n));
    if (f) {
      // Marca comercial: la del nombre (Terbilab, Dolocort…) si la descripción empieza con ella; si no, el laboratorio.
      const primera = desc.split(/[\s(]/)[0] ?? ''; const marcaNombre = /^[A-ZÑÁÉÍÓÚ0-9+.]{3,}$/i.test(primera) && !/^(acido|alcohol|agua|amoxicilina|cetirizina|cefalexina|clotrimazol|clindamicina|cloruro|ciprofloxacino|dexametasona|dimenhidrinato|etoricoxib|ibuprofeno|ketorolaco|loratadina|losartan|levotiroxina|mometasona|naproxeno|omeprazol|paracetamol|prednisona|simeticona|sulfametoxazol|terbinafina|aciclovir|ampicilina|lidocaina|levonorgestrel|fenazopiridina|sildenafilo|minoxidil|esomeprazol|bicarbonato|dobesilato|supositorio|clorfenamina|itraconazol|mupirocina|povidona|indometacina|tioconazol|amorolfina)$/i.test(primera)
        ? titulo(primera.replace(/\+$/, '')) : '';
      const forzada = MARCA_FARMACO.find(([re]) => re.test(n))?.[1];
      const marcaN = forzada !== undefined ? forzada : (GENERICAS.test(primera) ? '' : marcaNombre);
      const marcas = [...new Set([marcaN, marca && norm(marca) !== norm(marcaN) && !(marcaN && norm(marcaN).startsWith(norm(marca))) ? titulo(marca) : ''].filter(Boolean))];
      const ex = existentes.get(f.id);
      if (ex) {
        const actuales = (ex.nombresComerciales ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        const faltan = marcas.filter((m) => !actuales.some((a) => norm(a) === norm(m)));
        if (!faltan.length) { cuenta.yaEstaban++; continue; }
        const nuevo = [...actuales, ...faltan].join(', ');
        if (APLICAR) await prisma.medicamento.update({ where: { id: f.id }, data: { nombresComerciales: nuevo } });
        ex.nombresComerciales = nuevo; cuenta.marcasAgregadas++; listas.marcas.push(`${ex.dci} ${ex.concentracion ?? ''} ${ex.formaFarmaceutica ?? ''} ← ${faltan.join(', ')}`);
      } else {
        const data = { id: f.id, dci: f.dci, concentracion: f.conc ?? null, formaFarmaceutica: f.forma ?? null, viaAdministracion: f.via ?? null, nombresComerciales: marcas.join(', ') || null, grupo: f.grupo, requiereReceta: f.receta, esProducto: false, posologiaSugerida: f.posologia ?? null, activo: true };
        if (APLICAR) await prisma.medicamento.create({ data });
        existentes.set(f.id, { ...data, codigoAtc: null, codigoDigemid: null, creadoEn: new Date(), actualizadoEn: new Date() });
        cuenta.farmacosNuevos++; listas.nuevos.push(`${f.dci} ${f.conc ?? ''} ${f.forma ?? ''} · ${f.grupo} · ${f.receta ? 'RECETA' : 'venta libre'}${marcas.length ? ` (${marcas.join(', ')})` : ''}`);
      }
      continue;
    }
    // Producto
    const grupo = GRUPOS_PRODUCTO.find(([re]) => re.test(n))?.[1] ?? 'Producto de la clínica';
    const nombre = NOMBRE_PRODUCTO.find(([re]) => re.test(n))?.[1] ?? titulo(quitarPresentacion(desc).replace(/\s+/g, ' ').trim());
    const id = 'prod-' + slug(nombre);
    const v = productosVistos.get(id) ?? { nombre, marcas: new Set<string>(), grupo, lineas: [] };
    if (marca) v.marcas.add(titulo(marca)); v.lineas.push(desc); productosVistos.set(id, v);
  }
  for (const [id, v] of productosVistos) {
    const ex = existentes.get(id);
    const marcas = [...v.marcas].join(', ') || null;
    if (ex) {
      const actuales = (ex.nombresComerciales ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const faltan = [...v.marcas].filter((m) => !actuales.some((a) => norm(a) === norm(m)));
      if (!faltan.length) { cuenta.yaEstaban++; continue; }
      if (APLICAR) await prisma.medicamento.update({ where: { id }, data: { nombresComerciales: [...actuales, ...faltan].join(', ') } });
      cuenta.marcasAgregadas++; listas.marcas.push(`${ex.dci} ← ${faltan.join(', ')}`); continue;
    }
    if (APLICAR) await prisma.medicamento.create({ data: { id, dci: v.nombre, nombresComerciales: marcas, grupo: v.grupo, requiereReceta: false, esProducto: true, activo: true } });
    cuenta.productosNuevos++; listas.productos.push(`${v.nombre}${marcas ? ` (${marcas})` : ''} · ${v.grupo}${v.lineas.length > 1 ? ` · agrupa ${v.lineas.length} presentaciones` : ''}`);
  }

  log(`Fármacos nuevos: ${cuenta.farmacosNuevos} · marcas agregadas a existentes: ${cuenta.marcasAgregadas} · productos nuevos: ${cuenta.productosNuevos} · ya estaban: ${cuenta.yaEstaban} · excluidos: ${cuenta.excluidos} · para revisar: ${cuenta.revisar}`);
  log('\nFÁRMACOS NUEVOS:\n  ' + listas.nuevos.join('\n  '));
  log('\nMARCAS AGREGADAS A LOS QUE YA ESTABAN:\n  ' + listas.marcas.join('\n  '));
  log('\nPRODUCTOS NUEVOS:\n  ' + listas.productos.join('\n  '));
  log('\nPARA REVISAR (composición no identificada, no se cargaron):\n  ' + listas.revisar.join('\n  '));
  log('\nEXCLUIDOS (no se recetan ni se indican en la clínica):\n  ' + listas.excluidos.join('\n  '));
  if (INFORME) { fs.writeFileSync(INFORME, out.join('\n'), 'utf8'); console.log(`\nInforme: ${INFORME}`); }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
