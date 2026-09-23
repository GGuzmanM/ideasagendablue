/**
 * DIAGNÓSTICOS FRECUENTES + TRATAMIENTOS HABITUALES POR DIAGNÓSTICO, desde el ERP (23-sep-2026).
 * Fuente: tablas DIAGNOSTICO_CIE10 y diagnostico_cie10_plan de BLUEDAT, exportadas a TSV con sqlcmd
 * (Documentacion Agenda › Tratamientos por diagnostico › erp-diagnosticos.tsv / erp-tratamientos.tsv):
 *   diagnósticos : código · descripción · estado
 *   tratamientos : diagnóstico · ítem · tratamiento · id artículo ERP · artículo ERP · presentación · aplicación · estado
 *
 *   npx ts-node --transpile-only scripts/importar-tratamientos-diagnostico.ts --carpeta="…"               → SIMULA
 *   npx ts-node --transpile-only scripts/importar-tratamientos-diagnostico.ts --carpeta="…" --aplicar      → ESCRIBE
 *   … --aplicar --actualizar   → además SOBREESCRIBE los que ya estaban con lo del ERP (por defecto no se tocan,
 *                                 para no pisar lo que la clínica haya corregido en el sistema)
 *   (con ENV_FILE=… apunta a la base de pruebas)
 *
 * Reglas:
 *  · Los 32 diagnósticos del ERP quedan marcados «frecuente». Los que no existían en el catálogo CIE-10 se crean con la
 *    descripción del ERP. «000.» (Otros) y «000.1» (Tratamiento preventivo) son códigos propios de la clínica.
 *  · Solo se cargan los tratamientos ACTIVOS del ERP (estado 01). Si uno que ya estaba aparece inactivo, se desactiva.
 *  · Cada tratamiento se vincula al vademécum (receta / venta libre / producto, alergias) o a un servicio cuando se
 *    reconoce; si no, queda como texto libre con el tipo deducido (antibióticos, corticoides y AINE de receta → RECETA).
 *  · «Ketorolaco 10mg tabletas #04 à 01 tab VO…»: lo que va después de «à» / «-->» pasa a la aplicación, y «tabletas #04»
 *    que quedó pegado al nombre pasa a la presentación.
 *  · POSOLOGÍA POR DEFECTO: de la aplicación se separan dosis, vía, frecuencia y duración (services/posologiaDesdeTexto.ts);
 *    lo que queda va a indicaciones. Si la cantidad («Tabletas #08») no cuadra con la posología se avisa en el informe y,
 *    si cuadra con 1 unidad por toma, la dosis se corrige a 1 (tipeo del ERP: «2 tableta c/12h por 4 días» con #08).
 *  Re-ejecutable: la llave es «diagnóstico#ítem» (codigoErp).
 */
import '../src/cargarEnv';
import fs from 'fs';
import path from 'path';
import { TipoItemReceta } from '@prisma/client';
import { prisma } from '../src/db';
import { extraerPosologia, unidadesNecesarias } from '../src/services/posologiaDesdeTexto';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CARPETA = arg('carpeta'); const APLICAR = process.argv.includes('--aplicar'); const ACTUALIZAR = process.argv.includes('--actualizar');
if (!CARPETA) { console.error('Uso: --carpeta="ruta con erp-diagnosticos.tsv y erp-tratamientos.tsv" [--aplicar] [--actualizar]'); process.exit(2); }

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[®©]/g, ' ').replace(/[^a-z0-9%.,/+ ]/g, ' ').replace(/\s+/g, ' ').trim();
const oracion = (s: string) => { const t = s.trim().toLowerCase(); return (t.charAt(0).toUpperCase() + t.slice(1)).replace(/osgood schlatter/i, 'Osgood-Schlatter'); };
const codigoSistema = (erp: string) => erp.trim().replace(/\.$/, ''); // «000.» → «000»
const leer = (f: string) => fs.readFileSync(path.join(CARPETA!, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t').map((c) => (c ?? '').trim()));
const numeros = (s: string) => [...s.replace(/(\d),(\d)/g, '$1.$2').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

// Forma farmacéutica agrupada: si el texto y el vademécum dicen formas distintas (jarabe vs tableta), no es el mismo.
function grupoForma(s: string): string | null {
  const t = norm(s);
  if (/jarabe|gotas|suspensi/.test(t)) return 'oral-liquido';
  if (/tableta|tab\b|comprimido|capsula|cap\b|grageas?/.test(t)) return 'oral-solido';
  if (/ampolla|inyectable|iny\b/.test(t)) return 'inyectable';
  if (/crema|unguento|gel\b|pomada|solucion|locion|spray|laca|esmalte|espuma|polvo|talco/.test(t)) return 'topico';
  return null;
}

// Marcas / nombres de uso que apuntan al principio activo del vademécum.
const SINONIMOS: [RegExp, string][] = [
  [/ureadin|isdin \d+/, 'urea'], [/hibiclen|hibiclean/, 'clorhexidina'], [/momate/, 'mometasona'], [/apronax/, 'naproxeno'],
  [/arcoxia|eterecoxib/, 'etoricoxib'], [/\bnacl\b/, 'cloruro sodio'], [/neosporin|multimycin/, 'neomicina polimixina bacitracina'],
  [/itramicol|neozol|canditral/, 'itraconazol'], [/terbilab|terbifun/, 'terbinafina'], [/loceryl/, 'amorolfina'],
  [/trosyd|trosid/, 'tioconazol'], [/candid\b/, 'clotrimazol'], [/ketroprofeno/, 'ketoprofeno'], [/ac\. clavul|c\/ ac/, 'acido clavulanico'], [/yodo ?povidona|yodopovidona/, 'povidona yodada'],
];
// Sales y calificativos que el ERP no escribe («Naproxeno 500mg» = «Naproxeno sódico 500 mg»).
const STOP = new Set(['acido', 'de', 'y', 'b', 'con', 'al', 'sal', 'sodico', 'sodica', 'potasico', 'potasica', 'calcico', 'furoato', 'clorhidrato', 'monohidrato', 'hexahidratado']);

// Receta obligatoria para lo que no está en el vademécum (antibióticos, corticoides, AINE de receta, antifúngicos orales…).
const RX_TEXTO = /cilina|\bcef[a-z]+|cipro|clinda|amoxi|azitro|doxici|levoflox|ketorolaco|ketoprofeno|ketroprofeno|celecoxib|etoricoxib|eterecoxib|dexametasona|betametasona|mometasona|halobetasol|clobetasol|triamcinolona|prednis|itraconazol|terbinafina 250|fluconazol|bleomicina|mupirocina|dermodax|pridinol|gentamicina|tramadol|codeina/;
const PARECE_FARMACO = /\d+\s*(mg|g|gr|mcg|ml|%|ui)\b|tableta|capsula|comprimido|jarabe|gotas|ampolla|crema|unguento|locion|solucion|espuma/;
const PARECE_SERVICIO = /profilaxis|proclean|laser|extraccion|exceresis|matri[cs]ectom|onyfix|ortonixia|curacion|infiltracion|baropodometr|ortesic|fisioterapia|cauterizacion|nitrogeno liquido|ozonoterapia|cita control|interconsulta|hilo ptf|rodetoplast|acido nitrico|bleomicina/;

async function main() {
  const out: string[] = []; const log = (s = '') => { console.log(s); out.push(s); };
  log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no escribe)'}${ACTUALIZAR ? ' · sobreescribe los existentes' : ''} · base «${(process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0]}»\n`);

  // ── Catálogo CIE-10: los 32 del ERP → frecuentes ───────────────────────────────────────────────────────────────
  const dxErp = leer('erp-diagnosticos.tsv');
  const cie = new Map((await prisma.cie10.findMany()).map((c) => [c.codigo, c]));
  let dxNuevos = 0, dxMarcados = 0;
  for (const [cod, desc, estado] of dxErp) {
    if (!cod || estado !== '01') continue;
    const codigo = codigoSistema(cod);
    const ya = cie.get(codigo);
    if (!ya) {
      dxNuevos++; log(`  + CIE-10 nuevo: ${codigo} · ${oracion(desc!)}`);
      if (APLICAR) await prisma.cie10.create({ data: { codigo, descripcion: oracion(desc!), categoria: codigo.startsWith('000') ? 'Propios de la clínica' : 'Frecuentes de la clínica', frecuente: true } });
    } else if (!ya.frecuente || !ya.activo) {
      dxMarcados++;
      if (APLICAR) await prisma.cie10.update({ where: { codigo }, data: { frecuente: true, activo: true } });
    }
  }
  log(`Diagnósticos: ${dxErp.length} en el ERP · ${dxNuevos} nuevos en el catálogo · ${dxMarcados} ya existían y quedan como frecuentes\n`);

  // ── Vademécum y servicios para vincular ────────────────────────────────────────────────────────────────────────
  const meds = await prisma.medicamento.findMany({ where: { activo: true }, select: { id: true, dci: true, concentracion: true, formaFarmaceutica: true, nombresComerciales: true, requiereReceta: true, esProducto: true } });
  const farmacos = meds.filter((m) => !m.esProducto).map((m) => ({
    ...m, palabras: norm(m.dci).split(/[\s+/,]+/).filter((w) => w.length >= 4 && !STOP.has(w)),
    nums: numeros(m.concentracion ?? ''), grupo: grupoForma(`${m.formaFarmaceutica ?? ''}`),
    // «Dr Scholls» es el fabricante (plantillas, almohadillas…), no la marca de un fármaco: no sirve para vincular.
    marcas: (m.nombresComerciales ?? '').split(',').map((b) => norm(b)).filter((b) => b.length >= 5 && !/^dr\.? ?scholl/.test(b)),
  }));
  const producto = (re: RegExp) => meds.find((m) => m.esProducto && re.test(norm(m.dci)))?.id ?? null;
  const PRODUCTOS: [RegExp, string | null][] = [
    [/sanitol|sanytol/, producto(/sanytol/)], [/tea tree/, producto(/arbol de te|tea tree/)], [/excinail/, producto(/excinail/)],
    [/hypafix|hipafix/, producto(/hypafix/)], [/gehwol fluid/, producto(/gehwol fluid/)], [/gehwol talco/, producto(/gehwol foot powder/)],
    [/kinesiotape/, producto(/kinesiology tape sportstape/)], [/moleskin|molekin/, producto(/moleskin \(recortable|fresco . moleskin/)],
  ];
  const servicios = new Map((await prisma.servicio.findMany({ where: { deletedAt: null }, select: { id: true, codigo: true } })).map((s) => [s.codigo, s.id]));
  const servicioDe = (t: string, dx: string): string | null => {
    const c = (() => {
      if (/profilaxis|proclean|limpieza clinica/.test(t)) return 'POD-PRO';
      if (/laser/.test(t)) return /12|alta/.test(t) ? 'LASER_DE_ALTA_HONGOS' : 'POD-LASER';
      if (/extraccion (total|parcial)|lamina ungueal|exceresis/.test(t)) return 'POD-LCP-PRE';
      if (/matri[cs]ectom/.test(t)) return 'MATRISECTOMIA';
      if (/onyfix/.test(t)) return 'POD-QUI';
      if (/rodetoplast/.test(t)) return 'RODETOPLASTIA';
      if (/curacion/.test(t)) return dx === 'E14.5' ? 'POD-CUR-ULC' : 'CURACION_DE_EXTRACCION_DE_UNERO';
      if (/infiltracion/.test(t) && /^l8[45]/i.test(dx)) return 'INFILTRACION_CALLOS';
      if (/baropodometr|evaluacion de la pisada/.test(t)) return 'BAR-COMP';
      if (/ortesicos? completos/.test(t)) return 'BAR-PLA';
      if (/ortesicos? separador|ortesico de silicona/.test(t)) return 'BAR-BIO';
      if (/fisioterapia/.test(t)) return 'FIS-01';
      if (/acido nitrico/.test(t)) return 'POD-VER';
      if (/bleomicina/.test(t)) return 'POD-02';
      return null;
    })();
    return c ? servicios.get(c) ?? null : null;
  };
  const farmacoDe = (texto: string) => {
    let t = norm(texto);
    for (const [re, add] of SINONIMOS) if (re.test(t)) t += ' ' + add;
    const palabrasT = new Set(t.split(/[\s+/,().]+/));
    // «#01», «x 10» y «3 pulsos» son cantidades, no concentraciones: no cuentan al comparar con el vademécum.
    const numsT = numeros(texto.replace(/#\s*\d+/g, ' ').replace(/x\s*\d+/gi, ' ').replace(/\d+\s*pulsos?/gi, ' ')); const grupoT = grupoForma(texto);
    const cands = farmacos.map((m) => {
      const porMarca = m.marcas.some((b) => t.includes(b));
      const porDci = m.palabras.length > 0 && m.palabras.every((w) => palabrasT.has(w));
      if (!porMarca && !porDci) return null;
      if (m.nums.length && numsT.length && !numsT.includes(m.nums[0]!)) return null; // 250 mg ≠ 500 mg
      if (m.grupo && grupoT && m.grupo !== grupoT) return null;                      // jarabe ≠ tableta
      // «Tramadol + diclofenaco» no es «Diclofenaco»: si el texto nombra un fármaco de receta que el vademécum no tiene, no.
      const rxT = t.match(new RegExp(RX_TEXTO.source, 'g')) ?? [];
      if (rxT.some((w) => !norm(m.dci).includes(w.trim().split(' ')[0]!))) return null;
      // Desempates: la marca más específica («Ureadin Podos» > «Isdin») y la misma forma («espuma») pesan más.
      const marcaMasLarga = Math.max(0, ...m.marcas.filter((b) => t.includes(b)).map((b) => b.length));
      const mismaForma = m.formaFarmaceutica && t.includes(norm(m.formaFarmaceutica).split(' ')[0]!) ? 1 : 0;
      return { m, pts: m.palabras.length * 2 + (porMarca ? 3 : 0) + (m.nums.length && numsT.includes(m.nums[0]!) ? 2 : 0) + marcaMasLarga / 5 + mismaForma };
    }).filter(Boolean) as { m: (typeof farmacos)[number]; pts: number }[];
    cands.sort((a, b) => b.pts - a.pts);
    return cands.length && (cands.length === 1 || cands[0]!.pts > cands[1]!.pts) ? cands[0]!.m : null;
  };

  // ── Tratamientos ───────────────────────────────────────────────────────────────────────────────────────────────
  const filas = leer('erp-tratamientos.tsv');
  const existentes = new Map((await prisma.tratamientoDiagnostico.findMany({ where: { codigoErp: { not: null } }, select: { id: true, codigoErp: true, activo: true } })).map((r) => [r.codigoErp!, r]));
  const cuenta = { nuevos: 0, actualizados: 0, desactivados: 0, sinCambio: 0, omitidos: 0, vademecum: 0, servicio: 0, texto: 0 };
  const porDx = new Map<string, number>(); const revisar: string[] = []; const detalle: string[] = []; const cantidades: string[] = [];
  for (const [dxRaw, item, tratRaw, _idArt, articulo, presRaw, aplRaw, estado] of filas) {
    const dx = codigoSistema(dxRaw ?? ''); const codigoErp = `${dx}#${item}`;
    const ya = existentes.get(codigoErp);
    if (estado !== '01') {
      if (ya?.activo) { cuenta.desactivados++; if (APLICAR) await prisma.tratamientoDiagnostico.update({ where: { id: ya.id }, data: { activo: false } }); }
      continue;
    }
    // «Ketorolaco 10mg tabletas #04 à 01 tab VO condicional al dolor» → nombre + aplicación
    let tratamiento = (tratRaw ?? '').replace(/\s+/g, ' ').trim(); let aplicacion = (aplRaw ?? '').replace(/^\/\s*/, '').replace(/\s+/g, ' ').trim();
    const corte = tratamiento.split(/\s*(?:à|-->|->)(?:\s+|$)/);
    if (corte.length > 1) { tratamiento = corte[0]!.trim(); if (!aplicacion) aplicacion = corte.slice(1).join(' ').trim(); }
    if (!tratamiento || tratamiento.length < 2 || /^[.\-]+$/.test(tratamiento)) { cuenta.omitidos++; continue; }
    let presentacion: string | null = (presRaw ?? '').trim() || null;
    if (presentacion && /^(servicio|procedimiento)$/i.test(presentacion)) presentacion = null;
    if (presentacion && presentacion.length > 60 && !aplicacion) { aplicacion = presentacion; presentacion = null; } // pasos de curación escritos en la presentación
    // Una instrucción escrita en la presentación («Usar sólo al realizar deporte, luego retirar.») va a la aplicación
    if (presentacion && /^(usar|aplicar|colocar|tomar)\b/i.test(presentacion) && !aplicacion) { aplicacion = presentacion; presentacion = null; }
    // «Paracetamol 500mg tabletas #09» / «Ciprofloxacino 500mg Tabletas #10 Vía Oral»: la cantidad pegada al nombre va a la presentación
    const pegada = /\s+((?:tabletas?|c[aá]psulas?|comprimidos?|crema|espuma|jarabe|gotas)\s*(?:#\s*\d+|\d+\s+pulsos?))(?:\s+v[ií]a\s+oral)?\s*$/i.exec(tratamiento);
    if (pegada) {
      const enNombre = pegada[1]!.replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
      tratamiento = tratamiento.slice(0, pegada.index).trim();
      const nN = /#\s*0*(\d+)/.exec(enNombre)?.[1]; const nP = /#\s*0*(\d+)/.exec(presentacion ?? '')?.[1];
      if (!presentacion) presentacion = enNombre;
      else if (nN && nP && nN !== nP) cantidades.push(`${dx}#${item} ${tratamiento}: el nombre decía «${enNombre}» y la presentación «${presentacion}» (queda la presentación)`);
    }

    const t = norm(`${tratamiento} ${presentacion ?? ''}`);
    let tipo: TipoItemReceta; let medicamentoId: string | null = null; let servicioId: string | null = null;
    const esServicio = PARECE_SERVICIO.test(t) || /servicio|procedimiento|sesiones/i.test(presRaw ?? '');
    const farm = esServicio ? null : farmacoDe(`${tratamiento} ${presentacion ?? ''} ${articulo ?? ''}`);
    const prod = !farm && !esServicio ? PRODUCTOS.find(([re]) => re.test(t))?.[1] ?? null : null;
    if (esServicio) { tipo = 'SERVICIO'; servicioId = servicioDe(t, dx); }
    else if (farm) { medicamentoId = farm.id; tipo = farm.requiereReceta ? 'MEDICAMENTO_RX' : 'MEDICAMENTO_OTC'; }
    else if (prod) { medicamentoId = prod; tipo = 'PRODUCTO'; }
    else if (PARECE_FARMACO.test(t)) tipo = RX_TEXTO.test(t) ? 'MEDICAMENTO_RX' : 'MEDICAMENTO_OTC';
    else tipo = 'PRODUCTO';
    // En un servicio la «presentación» del ERP suele ser una nota («Plantillas personalizadas», «Dr. … - Clínica …»): va a la aplicación
    if (tipo === 'SERVICIO' && presentacion && !/#|\d|sesi/i.test(presentacion)) {
      if (!/^(tratamiento|sesiones?)$/i.test(presentacion)) aplicacion = [presentacion, aplicacion].filter(Boolean).join(' · ');
      presentacion = null;
    }
    if (medicamentoId) cuenta.vademecum++; else if (servicioId) cuenta.servicio++; else cuenta.texto++;
    if (!medicamentoId && !servicioId && tipo !== 'PRODUCTO' && tipo !== 'SERVICIO') revisar.push(`${dx} · ${tratamiento}${presentacion ? ` (${presentacion})` : ''} → ${tipo === 'MEDICAMENTO_RX' ? 'RECETA' : 'venta libre'} (texto libre)`);
    // Marca a imprimir: lo que va entre paréntesis con ®, o «Isdin Ureadin 30».
    const marca = /\(([^()®]{2,40})\s*®/.exec(tratamiento)?.[1]?.trim() ?? /([A-Za-zÁÉÍÓÚáéíóú]{3,}[^()]*?)\s*®/.exec(tratamiento)?.[1]?.trim() ?? (/isdin\s+ureadin[\w\s]*/i.exec(tratamiento)?.[0]?.trim() ?? null);

    porDx.set(dx, (porDx.get(dx) ?? 0) + 1);
    detalle.push(`${dx.padEnd(6)} ${String(item).padStart(3)}  ${tipo.padEnd(15)} ${medicamentoId ? `[vademécum ${medicamentoId}]` : servicioId ? '[servicio]' : '[texto]'}  ${tratamiento}${presentacion ? ` · ${presentacion}` : ''}`);
    // Posología por defecto (el médico la valida en la receta). Con vademécum la dosis va solo en número: la unidad la pone su forma.
    const pos = extraerPosologia(aplicacion, !!medicamentoId && tipo !== 'PRODUCTO');
    const necesarias = unidadesNecesarias(pos); const hay = Number(/#\s*0*(\d+)(?!\s*pulsos?)/.exec(presentacion ?? '')?.[1]);
    if (necesarias && hay && necesarias !== hay && tipo !== 'SERVICIO') {
      const n = Number(/^(\d+)/.exec(pos.dosis ?? '')?.[1]);
      if (n > 1 && necesarias / n === hay) {
        cantidades.push(`${dx}#${item} ${tratamiento}: «${aplicacion}» con ${presentacion} → dosis corregida de ${n} a 1 (con ${n} por toma harían falta ${necesarias})`);
        pos.dosis = pos.dosis!.replace(/^\d+/, '1').replace(/(tableta|cápsula|ampolla|sobre)s\b/, '$1');
      } else cantidades.push(`${dx}#${item} ${tratamiento}: «${aplicacion}» necesita ${necesarias} y la presentación dice «${presentacion}» (revisar)`);
    }
    const data = { cie10Codigo: dx, orden: Number(item) || 0, tratamiento, presentacion, aplicacion: aplicacion || null, tipo, medicamentoId, servicioId, marca, activo: true,
      dosis: pos.dosis, via: pos.via, frecuencia: pos.frecuencia, duracion: pos.duracion, indicaciones: pos.indicaciones };
    detalle.push(`         posología: ${[pos.dosis && `dosis ${pos.dosis}`, pos.via && `vía ${pos.via}`, pos.frecuencia, pos.duracion].filter(Boolean).join(' · ') || '—'}${pos.indicaciones ? `  | indicaciones: ${pos.indicaciones}` : ''}`);
    if (!ya) {
      cuenta.nuevos++;
      if (APLICAR) await prisma.tratamientoDiagnostico.create({ data: { ...data, codigoErp } });
    } else if (ACTUALIZAR) {
      cuenta.actualizados++;
      if (APLICAR) await prisma.tratamientoDiagnostico.update({ where: { id: ya.id }, data });
    } else cuenta.sinCambio++;
  }

  log(`Tratamientos activos cargados: nuevos ${cuenta.nuevos} · actualizados ${cuenta.actualizados} · ya estaban ${cuenta.sinCambio} · desactivados ${cuenta.desactivados} · omitidos (vacíos) ${cuenta.omitidos}`);
  log(`Vinculados: ${cuenta.vademecum} al vademécum · ${cuenta.servicio} a un servicio · ${cuenta.texto} quedan como texto libre\n`);
  log('POR DIAGNÓSTICO:\n  ' + [...porDx.entries()].sort().map(([d, n]) => `${d}: ${n}`).join(' · '));
  log(`\nCANTIDAD QUE NO CUADRA CON LA POSOLOGÍA (revisar) — ${cantidades.length}:\n  ` + cantidades.join('\n  '));
  log(`\nFÁRMACOS QUE NO ESTÁN EN EL VADEMÉCUM (van como texto libre; el tipo se dedujo del nombre) — ${revisar.length}:\n  ` + revisar.join('\n  '));
  log('\nDETALLE:\n' + detalle.join('\n'));
  fs.writeFileSync(path.join(CARPETA!, `informe-${APLICAR ? 'carga' : 'simulacion'}.txt`), out.join('\n'), 'utf8');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
