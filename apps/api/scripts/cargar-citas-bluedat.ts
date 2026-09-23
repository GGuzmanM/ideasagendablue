/**
 * CARGA DE CITAS DESDE EL RESPALDO DE LA BASE BLUEDAT (SQL Server del sistema anterior) — 22-sep-2026.
 *
 * 1) El respaldo (.bak) se restaura en el SQL Server local y se exporta con `sqlcmd` (ver Documentacion Agenda ›
 *    Carga de citas › export-bluedat.sql): una fila por cita de ATENCION_MEDICA con el paciente (ANALITICA), la
 *    podóloga (ANALITICA «1 Pod Apellido , Nombre»), el servicio (ARTICULO), el canal y la observación.
 * 2) Este script cruza cada fila con el sistema y crea la cita POR EL API (mismas reglas que recepción):
 *
 *   npx ts-node --transpile-only scripts/cargar-citas-bluedat.ts --archivo="…tsv" [--desde=AAAA-MM-DD] [--hasta=…]       → ANALIZA
 *   ENV_FILE=…carga.env npx ts-node … --archivo=… --aplicar --api=http://localhost:3005 [--informe="…txt"]              → CARGA
 *
 * El API de carga debe correr con MAIL_DRY_RUN=true y RECORDATORIOS/VIDEOS apagados (ningún paciente recibe correos).
 *
 * Reglas (las mismas de la carga del 21-sep, más el documento):
 *  · Paciente: primero por DOCUMENTO (el ERP lo trae); si no está, por nombre; si tampoco, se CREA con los datos reales
 *    del ERP (documento, teléfono, correo, nacimiento). Si el que coincide por nombre es un «PEND-…» de la carga anterior,
 *    se le completan el documento y el teléfono en vez de duplicarlo.
 *  · Sede = número con que empieza la podóloga (1 Paz Soldán · 2 Lince · 3 Los Olivos · 4 San Miguel · 5 One); la
 *    observación «CITA EN <sede>» manda. Si la sede del ERP no coincide con el prefijo, se anota como decisión.
 *  · «Baropodometría [N] <sede>» = máquina Baro N de esa sede. Anuladas no se cargan. Si el paciente ya tiene una cita
 *    a esa hora en la agenda, se omite (ya la registró recepción). Re-ejecutable: llave de idempotencia = folio del ERP.
 */
import '../src/cargarEnv';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/db';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ARCHIVO = arg('archivo'); const DESDE = arg('desde') ?? new Date().toISOString().slice(0, 10); const HASTA = arg('hasta') ?? '2099-12-31';
const API = arg('api'); const INFORME = arg('informe'); const APLICAR = process.argv.includes('--aplicar');
if (!ARCHIVO || !/^\d{4}-\d{2}-\d{2}$/.test(DESDE) || (APLICAR && !API)) { console.error('Uso: --archivo="ruta.tsv" [--desde=AAAA-MM-DD] [--hasta=AAAA-MM-DD] [--aplicar --api=http://localhost:3005] [--informe="ruta.txt"]'); process.exit(2); }

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-zñ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const titulo = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
const SEDE_POR_PREFIJO: Record<string, string> = { '1': 'Paz Soldán', '2': 'Lince', '3': 'Los Olivos', '4': 'San Miguel', '5': 'One' };
const SEDE_ERP: Record<string, string> = { 'lince': 'Lince', 'san isidro': 'Paz Soldán', 'los olivos': 'Los Olivos', 'san miguel': 'San Miguel', 'san borja': 'One' };
const CANAL: Record<string, string> = { 'recepcion': 'recepcion', 'central telefonica': 'central_telefonica', 'whatsapp': 'whatsapp', 'administracion directo': 'administracion_directo', 'chat web': 'web', 'facebook': 'facebook', 'instagram': 'instagram', 'tiktok': 'tiktok', 'radio rpp': 'radio_rpp', 'rpp dd': 'rpp_dd', 'expo maraton': 'expo_maraton' };
const TIPO_DOC: Record<string, 'DNI' | 'CE' | 'PASAPORTE' | 'RUC' | 'OTRO'> = { '01': 'DNI', '04': 'CE', '07': 'PASAPORTE', '06': 'RUC' };

type Fila = { folio: string; sedeErp: string; fecha: string; hora: string; pacId: string; pacTipoDoc: string; pacDoc: string; apePat: string; apeMat: string; nombres: string; tel: string; email: string; nac: string; profesional: string; profDoc: string; servicio: string; servicioId: string; canal: string; observacion: string; sesion: string; creadoPor: string; creadoEn: string; estado: string };
const leer = (l: string): Fila => { const c = l.split('\t').map((x) => (x ?? '').trim()); return { folio: c[0]!, sedeErp: c[1]!, fecha: c[2]!, hora: c[3]!, pacId: c[4]!, pacTipoDoc: c[5]!, pacDoc: c[6]!, apePat: c[7]!, apeMat: c[8]!, nombres: c[9]!, tel: c[10]!, email: c[11]!, nac: c[12]!, profesional: c[13]!, profDoc: c[14]!, servicio: c[15]!, servicioId: c[16]!, canal: c[17]!, observacion: c[18]!, sesion: c[19]!, creadoPor: c[20]!, creadoEn: c[21]!, estado: c[22]! }; };

/** Servicio del ERP → código + subcategoría del sistema (+ nota para el comentario). `sesionErp` = columna ID_SESION_MEDICA. */
function mapearServicio(t: string, sesionErp: string): { codigo: string; sub?: string; nota?: string } | null {
  const n = norm(t); let m: RegExpExecArray | null;
  const ses = (m = /sesion (\d+)/.exec(n)) ? m[1] : (/^\d+$/.test(sesionErp) ? String(Number(sesionErp)) : undefined);
  if (/^limpieza clinica del pie/.test(n)) return { codigo: 'POD-PRO', sub: /adulto mayor/.test(n) ? 'Adulto mayor' : /premium/.test(n) ? 'Premium' : /infantil/.test(n) ? 'Infantil' : /diabet/.test(n) ? 'Pie Diabético' : 'Regular', nota: /trifit/.test(n) ? 'TRIFIT' : undefined };
  if (/^limpieza clinica de manos/.test(n)) return { codigo: 'POD-HEL-SIM' };
  if (/^membresia.*evaluacion de la pisada/.test(n)) return { codigo: 'BAR-COMP', nota: `MEMBRESÍA: ${t}` };
  if (/^membresia.*consulta dermatolog/.test(n)) return { codigo: 'FIS-04', sub: 'Consulta 1', nota: `MEMBRESÍA: ${t}` };
  if (/^membresia.*sesion de fisioterapia/.test(n)) return { codigo: 'FIS-01', nota: `MEMBRESÍA: ${t}` };
  if (/^membresia.*profi premium/.test(n) || /^membresias .*premium/.test(n)) return { codigo: 'POD-PRO', sub: 'Premium', nota: `MEMBRESÍA: ${t}` };
  if (/^membresia/.test(n)) return { codigo: 'POD-PRO', sub: 'Regular', nota: `MEMBRESÍA: ${t}` };
  if (/profilaxis/.test(n)) return { codigo: 'POD-PRO', sub: 'Regular', nota: `Convenio: ${t}` };
  if (/laserterapia p12 onicomicosis|laser para hongos p12/.test(n)) return { codigo: 'LASER_DE_ALTA_HONGOS', sub: ses ? `Sesión ${ses}` : undefined };
  if (/laserterapia p6 onicomicosis/.test(n)) return { codigo: 'POD-01', nota: ses ? `Sesión ${ses}` : undefined };
  if (/laserterapia sesion individual/.test(n)) return { codigo: 'POD-LASER' };
  if (/^matricectomia/.test(n)) return { codigo: 'MATRISECTOMIA', sub: (m = /curacion (\d+)/.exec(n)) ? `Curación ${m[1]}` : 'Base' };
  if (/^extraccion de una/.test(n)) return { codigo: 'POD-LCP-PRE', sub: (m = /curacion (\d+)/.exec(n)) ? `Curación ${m[1]}` : 'Extracción de Uña' };
  if (/^curacion de herida/.test(n)) return { codigo: 'CURACION_DE_EXTRACCION_DE_UNERO', sub: 'Herida' };
  if (/evaluacion de la pisada|evaluacion de baropodometria/.test(n)) return { codigo: 'BAR-COMP', nota: /promocion/.test(n) ? t : undefined };
  if (/^fisioterapia p12/.test(n)) return { codigo: 'FIS-03', sub: ses ? `Sesión ${ses}` : undefined };
  if (/^fisioterapia p6/.test(n)) return { codigo: 'FIS-02', sub: ses ? `Sesión ${ses}` : undefined };
  if (/^fisioterapia$/.test(n)) return { codigo: 'FIS-01' };
  if (/evaluacion de fisioterapia/.test(n)) return { codigo: 'FIS-SES' };
  if (n === 'evaluacion') return { codigo: 'POD-CPO' };
  if (/toma de muestra ucbl/.test(n)) return { codigo: 'POD-05' };
  return null;
}

type Pac = { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string | null; numeroDocumento: string | null };
/** Por nombre: exacto → el más cercano (todas las palabras del nombre y el 1er apellido coinciden) → null. */
async function buscarPorNombre(apeCrudo: string, nomCrudo: string): Promise<{ pac?: Pac; como: string }> {
  const ape = norm(apeCrudo).split(' ').filter(Boolean); const nom = norm(nomCrudo).split(' ').filter(Boolean);
  if (!ape.length || !nom.length) return { como: 'nombre ilegible' };
  const pliega = (col: string) => `translate(lower(${col}), 'áéíóúüàèìòù', 'aeiouuaeiou')`;
  const filas = await prisma.$queryRawUnsafe<Pac[]>(
    `SELECT id, nombres, "apellidoPaterno", "apellidoMaterno", "numeroDocumento" FROM pacientes WHERE "deletedAt" IS NULL AND ${pliega('"apellidoPaterno"')} LIKE $1 AND ${pliega('nombres')} LIKE $2 LIMIT 80`,
    `${ape[0]}%`, `%${nom[0]}%`);
  const tokA = (p: Pac) => norm(`${p.apellidoPaterno} ${p.apellidoMaterno ?? ''}`).split(' '); const tokN = (p: Pac) => norm(p.nombres).split(' ');
  const exactos = filas.filter((p) => ape.every((w) => tokA(p).includes(w)) && nom.every((w) => tokN(p).includes(w)));
  if (exactos.length === 1) return { pac: exactos[0], como: 'coincide por nombre' };
  const cerca = (exactos.length ? exactos : filas.filter((p) => tokA(p)[0] === ape[0] && nom.every((w) => tokN(p).includes(w)) && (ape.length < 2 || tokA(p).includes(ape[1]!))))
    .map((p) => ({ p, pts: ape.filter((w) => tokA(p).includes(w)).length * 3 - Math.abs(tokN(p).length - nom.length) - Math.abs(tokA(p).length - ape.length) }))
    .sort((a, b) => b.pts - a.pts);
  if (cerca.length && (cerca.length === 1 || cerca[0]!.pts > cerca[1]!.pts)) return { pac: cerca[0]!.p, como: `el más cercano de ${cerca.length} (${cerca[0]!.p.apellidoPaterno} ${cerca[0]!.p.apellidoMaterno ?? ''}, ${cerca[0]!.p.nombres} · doc. ${cerca[0]!.p.numeroDocumento ?? '-'})` };
  return { como: cerca.length ? `${cerca.length} parecidos sin uno claramente más cercano` : 'no existe' };
}

async function main() {
  const out: string[] = []; const log = (s = '') => { console.log(s); out.push(s); };
  log(`${APLICAR ? 'CARGANDO' : 'ANÁLISIS (no escribe)'} · del ${DESDE} al ${HASTA} · base «${(process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0]}»${APLICAR ? ` · API ${API}` : ''}\n`);
  const filas = fs.readFileSync(ARCHIVO!, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map(leer).filter((f) => f.fecha >= DESDE && f.fecha <= HASTA);
  const sedes = await prisma.sede.findMany({ select: { id: true, nombre: true } });
  const admin = await prisma.usuario.findFirst({ where: { email: 'admin@limablue.pe' }, select: { id: true } });
  const H = () => ({ Authorization: 'Bearer ' + jwt.sign({ userId: admin!.id, rol: 'admin', sedes: [], permisos: [] }, process.env.JWT_SECRET!, { expiresIn: '2h' }), 'Content-Type': 'application/json' });
  if (APLICAR) { const hc = await fetch(new URL(API!).origin + '/health').catch(() => null); if (!hc?.ok) throw new Error(`El API de carga no responde en ${API}`); }
  // La fisioterapeuta de Paz Soldán (Cisneros) quedó con los códigos viejos de fisioterapia; el ERP le agenda P12/P6 e
  // individual. Se le habilitan los servicios vigentes, igual que se hizo con Valdez el 21-sep.
  if (APLICAR) for (const [apellido, codigos] of [['Cisneros Mija', ['FIS-01', 'FIS-02', 'FIS-03', 'FIS-SES']]] as [string, string[]][]) {
    const pr = await prisma.profesional.findFirst({ where: { apellidos: apellido, deletedAt: null }, select: { id: true } }); if (!pr) continue;
    for (const sv of await prisma.servicio.findMany({ where: { codigo: { in: codigos }, deletedAt: null }, select: { id: true, nombre: true } })) {
      const k = await prisma.competenciaProfesional.findUnique({ where: { profesionalId_servicioId: { profesionalId: pr.id, servicioId: sv.id } }, select: { activa: true } });
      if (k?.activa) continue;
      if (k) await prisma.competenciaProfesional.update({ where: { profesionalId_servicioId: { profesionalId: pr.id, servicioId: sv.id } }, data: { activa: true } });
      else await prisma.competenciaProfesional.create({ data: { profesionalId: pr.id, servicioId: sv.id, activa: true, habilitadoDesde: new Date() } });
      log(`  + ${apellido}: habilitado «${sv.nombre}»`);
    }
  }
  const servicios = await prisma.servicio.findMany({ where: { activo: true, deletedAt: null }, select: { id: true, codigo: true, nombre: true, unidadNegocioId: true, subcategorias: { where: { activo: true, deletedAt: null }, select: { id: true, nombre: true } } } });
  const profs = await prisma.profesional.findMany({ where: { deletedAt: null, activo: true }, select: { id: true, nombres: true, apellidos: true, esEquipo: true } });
  const cuenta = { cargadas: 0, yaEstaban: 0, rechazadas: 0, omitidas: 0, pacientesCreados: 0, pacientesCompletados: 0, listas: 0, anuladas: 0 };
  const rechazos: string[] = []; const decisiones: string[] = []; const porMotivo = new Map<string, number>(); const porDia = new Map<string, { ok: number; no: number }>(); const creadas: string[] = [];
  const motivo = (m: string) => porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);

  for (const f of filas) {
    const dia = porDia.get(f.fecha) ?? { ok: 0, no: 0 }; porDia.set(f.fecha, dia);
    const pacCrudo = `${f.apePat} ${f.apeMat}`.trim() + ', ' + f.nombres;
    const et = `${f.fecha} ${f.hora} ${pacCrudo} · ${f.profesional.replace(/\s+/g, ' ')} · ${f.servicio}`;
    if (f.estado !== '11') { cuenta.anuladas++; continue; }
    const errs: string[] = [];

    // Sede: prefijo de la podóloga; «CITA EN <SEDE>» manda; si el ERP la tiene en otra sede, se anota.
    const pref = /^(\d)\s/.exec(f.profesional)?.[1]; let sede = sedes.find((s) => s.nombre === (pref ? SEDE_POR_PREFIJO[pref] : ''));
    const enOtra = /cita en ([a-zñ ]+)/i.exec(norm(f.observacion)); const sedeComentario = enOtra ? sedes.find((s) => norm(s.nombre) === enOtra[1]!.trim() || norm(s.nombre).startsWith(enOtra[1]!.trim().split(' ')[0]!)) : undefined;
    if (sedeComentario && sedeComentario.id !== sede?.id) { decisiones.push(`${et}: la observación dice «${f.observacion}» → se cita en ${sedeComentario.nombre}`); sede = sedeComentario; }
    const sedeErp = SEDE_ERP[norm(f.sedeErp.split('-')[0]!)]; // «San Isidro» agrupa Paz Soldán y One en el ERP
    if (sede && sedeErp && sedeErp !== sede.nombre && !(sedeErp === 'Paz Soldán' && sede.nombre === 'One')) decisiones.push(`${et}: el ERP la tiene en «${f.sedeErp}» pero la podóloga es de ${sede.nombre} → ${sede.nombre}`);
    if (!sede) errs.push(`sede no reconocida (${f.sedeErp} / «${f.profesional}»)`);

    // Profesional por NOMBRE (sin «1 Pod», «Asis.», «Ft»…)
    const pn = norm(f.profesional.replace(/^\d\s+/, '').replace(/\b(asis|asist|pod|podologa|ft|doctor)\b\.?/gi, ' '));
    let prof: (typeof profs)[number] | undefined;
    if (/baropodometr/.test(pn)) {
      const n = /baropodometria (\d)/.exec(pn)?.[1] ?? '1';
      const asig = sede ? await prisma.asignacionSede.findMany({ where: { sedeId: sede.id, fechaInicio: { lte: new Date(`${f.fecha}T12:00:00.000Z`) }, OR: [{ fechaFin: null }, { fechaFin: { gte: new Date(`${f.fecha}T12:00:00.000Z`) } }], profesional: { esEquipo: true, activo: true, deletedAt: null } }, select: { profesional: { select: { id: true, nombres: true, apellidos: true, esEquipo: true } } } }) : [];
      const maquinas = [...new Map(asig.map((a) => [a.profesional.id, a.profesional])).values()].sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`));
      prof = maquinas.find((m) => m.apellidos.trim() === n) ?? maquinas[0];
      if (!prof) errs.push(`no hay máquina de baro asignada a ${sede?.nombre}`);
    } else if (/^sede |adicional|^citas /.test(pn) || !pn) errs.push(`«${f.profesional.replace(/\s+/g, ' ')}» no es una persona: no dice quién atiende`);
    else {
      const w = pn.split(' ').filter((x) => x.length > 1);
      const igual = (x: string, y: string) => y === x || (x === 'jessica' && y === 'yeccijca') || (x === 'machi' && y === 'maximina') || (x === 'selene' && y === 'selenne');
      const tok = (p: (typeof profs)[number]) => norm(`${p.apellidos} ${p.nombres}`).split(' ');
      let cand = profs.filter((p) => !p.esEquipo && w.every((x) => tok(p).some((y) => igual(x, y))));
      if (!cand.length) cand = profs.filter((p) => !p.esEquipo && tok(p).length >= 2 && tok(p).every((y) => w.some((x) => igual(x, y))));
      if (cand.length === 1) prof = cand[0]; else errs.push(cand.length ? `profesional ambiguo (${cand.map((c) => `${c.apellidos} ${c.nombres}`).join(' / ')})` : `«${pn}» no está registrada en el sistema`);
    }

    // Servicio y subcategoría
    const ms = mapearServicio(f.servicio, f.sesion);
    if (ms?.codigo === 'POD-CPO' && /\bft\b/i.test(f.profesional)) ms.codigo = 'FIS-SES'; // «Evaluacion» con una fisioterapeuta = Evaluación FI
    const srv = ms ? servicios.find((s) => s.codigo === ms.codigo) : undefined;
    const sub = srv && ms?.sub ? srv.subcategorias.find((x) => norm(x.nombre) === norm(ms.sub!)) : undefined;
    if (!srv) errs.push(`tratamiento sin equivalente: «${f.servicio}»`);
    else if (srv.subcategorias.length && !sub) errs.push(ms?.sub ? `«${srv.nombre}» no tiene la subcategoría «${ms.sub}»` : `«${srv.nombre}» exige elegir sesión y el ERP no la indica`);

    const canal = CANAL[norm(f.canal)] ?? (f.canal ? undefined : 'recepcion'); if (!canal) errs.push(`canal desconocido «${f.canal}»`);

    // Paciente: documento → nombre → se crea con los datos del ERP
    let pacienteId: string | undefined; let comoPac = ''; const doc = f.pacDoc.replace(/\s+/g, '');
    if (doc && doc !== '-' && doc !== '0') {
      const p = await prisma.paciente.findFirst({ where: { numeroDocumento: doc, deletedAt: null }, select: { id: true } });
      if (p) { pacienteId = p.id; comoPac = 'por documento'; }
    }
    // Por nombre solo vale si el ERP no trae documento o si el que coincide es un provisional «PEND-…» (se completa).
    // Mismo nombre con OTRO documento real = se crea aparte con el documento del ERP (no se cuelga la cita a otra persona).
    let porNombre: { pac?: Pac; como: string } | undefined;
    if (!pacienteId) {
      porNombre = await buscarPorNombre(`${f.apePat} ${f.apeMat}`, f.nombres);
      const docSistema = porNombre.pac?.numeroDocumento ?? '';
      if (porNombre.pac && (!doc || !docSistema || docSistema.startsWith('PEND-'))) { pacienteId = porNombre.pac.id; comoPac = porNombre.como; }
      else if (porNombre.pac) { decisiones.push(`${et}: hay un paciente con el mismo nombre pero otro documento (ERP ${doc}, sistema ${docSistema}) → se crea aparte con el documento del ERP`); porNombre = { como: 'mismo nombre con otro documento' }; }
      else if (porNombre.como === 'nombre ilegible') errs.push('nombre del paciente ilegible');
    }
    if (pacienteId && comoPac !== 'por documento') decisiones.push(`${et}: paciente → ${comoPac}`);

    if (errs.length) { cuenta.rechazadas++; dia.no++; errs.forEach((e) => motivo(e.replace(/«[^»]*»/g, '«…»').replace(/\(.*\)/, ''))); rechazos.push(`${et}\n        ${errs.join('\n        ')}`); continue; }
    if (!APLICAR) { cuenta.listas++; dia.ok++; if (!pacienteId) decisiones.push(`${et}: paciente ${porNombre?.como} → se CREARÍA con los datos del ERP (doc. ${doc || 'sin documento'})`); continue; }

    if (!pacienteId) {
      const tipo = TIPO_DOC[f.pacTipoDoc] ?? 'OTRO';
      const numero = doc && doc !== '-' && doc !== '0' ? doc : `PEND-${f.fecha.replace(/-/g, '')}-${f.folio.replace(/\W/g, '')}`;
      const ya = await prisma.paciente.findFirst({ where: { numeroDocumento: numero, deletedAt: null }, select: { id: true } });
      const tel = f.tel.replace(/\D/g, '') || '000000000'; const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) ? f.email.toLowerCase() : null;
      pacienteId = ya?.id ?? (await prisma.paciente.create({ data: { nombres: titulo(f.nombres) || '-', apellidoPaterno: titulo(f.apePat) || '-', apellidoMaterno: titulo(f.apeMat) || '-', tipoDocumento: tipo, numeroDocumento: numero, telefono: tel, email, fechaNacimiento: /^\d{4}-\d{2}-\d{2}$/.test(f.nac) && f.nac > '1900-01-01' ? new Date(`${f.nac}T12:00:00.000Z`) : null, requiereActualizacionDatos: !doc || tel === '000000000', origenImportacion: 'ERP_AGENDA', notas: `Creado al cargar la agenda desde el respaldo del sistema anterior (código ERP ${f.pacId}).`, creadoPor: admin?.id }, select: { id: true } })).id;
      if (!ya) { cuenta.pacientesCreados++; decisiones.push(`${et}: paciente ${porNombre?.como} → CREADO con los datos del ERP (doc. ${numero})`); }
    } else if (porNombre?.pac && doc && porNombre.pac.numeroDocumento?.startsWith('PEND-')) {
      // Provisional de la carga del 21-sep: ahora el ERP trae su documento real → se completa en vez de duplicar.
      const choque = await prisma.paciente.findFirst({ where: { numeroDocumento: doc, deletedAt: null, NOT: { id: pacienteId } }, select: { id: true } });
      if (!choque) { await prisma.paciente.update({ where: { id: pacienteId }, data: { tipoDocumento: TIPO_DOC[f.pacTipoDoc] ?? 'OTRO', numeroDocumento: doc, telefono: f.tel.replace(/\D/g, '') || undefined, requiereActualizacionDatos: false } }); cuenta.pacientesCompletados++; decisiones.push(`${et}: al paciente provisional ${porNombre.pac.numeroDocumento} se le puso su documento real ${doc}`); }
    }

    // ¿Recepción ya la registró en la agenda nueva? (mismo paciente, día y hora)
    const yaAgendada = await prisma.cita.findFirst({ where: { pacienteId, fecha: new Date(`${f.fecha}T00:00:00.000Z`), horaInicio: f.hora, deletedAt: null, estado: { notIn: ['cancelada', 'reprogramada'] } }, select: { id: true, comentarios: { select: { texto: true }, take: 1 } } });
    if (yaAgendada && !yaAgendada.comentarios.some((c) => c.texto.includes(`[ERP ${f.folio}]`))) { cuenta.yaEstaban++; dia.ok++; log(`  = ${et} → ya estaba en la agenda nueva (la registró recepción)`); continue; }

    const nota = [f.observacion, ms?.nota, f.creadoPor ? `agendó ${f.creadoPor.toLowerCase()} el ${f.creadoEn}` : ''].filter(Boolean).join(' · ');
    const cuerpo = { pacienteId, sedeId: sede!.id, unidadNegocioId: srv!.unidadNegocioId, servicioId: srv!.id, subcategoriaId: sub?.id ?? null, profesionalId: prof!.id, fecha: f.fecha, horaInicio: f.hora, canal,
      comentarioRecepcion: `[ERP ${f.folio}] ${nota}`.slice(0, 1900) };
    const r = await fetch(`${API}/citas`, { method: 'POST', headers: { ...H(), 'Idempotency-Key': `bluedat-${f.folio}` }, body: JSON.stringify(cuerpo) });
    const j = (await r.json().catch(() => ({}))) as { id?: string; code?: string; error?: string; message?: string };
    if (r.status === 201) { cuenta.cargadas++; dia.ok++; if (j.id) creadas.push(j.id); log(`  ✔ ${et} → ${srv!.nombre}${sub ? ' · ' + sub.nombre : ''} · ${sede!.nombre}`); }
    else if (r.status === 200) { cuenta.yaEstaban++; dia.ok++; log(`  = ${et} → ya estaba cargada`); }
    else { cuenta.rechazadas++; dia.no++; motivo(`el sistema la rechazó: ${j.code ?? j.error ?? r.status}`); rechazos.push(`${et}\n        el sistema la rechazó: ${j.message ?? j.error ?? r.status} (${j.code ?? j.error ?? ''})`); }
  }

  // Los pacientes ya fueron avisados por el sistema anterior: los recordatorios y videos que el API programó para estas
  // citas se cancelan (con --con-avisos se dejan programados y saldrán a su hora desde el API principal).
  if (APLICAR && creadas.length && !process.argv.includes('--con-avisos')) {
    const rc = await prisma.recordatorioCita.updateMany({ where: { citaId: { in: creadas }, estado: 'PROGRAMADO' }, data: { estado: 'CANCELADO' } });
    const vd = await prisma.videoEnvioLog.updateMany({ where: { citaId: { in: creadas }, estado: 'PENDIENTE' }, data: { estado: 'CANCELADO', errorDetalle: 'Cancelado: cita cargada desde el sistema anterior' } });
    log(`\nAvisos cancelados para las citas cargadas: ${rc.count} recordatorios · ${vd.count} videos`);
  }
  log(APLICAR ? `\nCARGADAS: ${cuenta.cargadas} · ya estaban: ${cuenta.yaEstaban} · NO entraron: ${cuenta.rechazadas} · anuladas omitidas: ${cuenta.anuladas} · pacientes creados: ${cuenta.pacientesCreados} · provisionales completados: ${cuenta.pacientesCompletados}`
    : `\nListas: ${cuenta.listas} · con problema: ${cuenta.rechazadas} · anuladas: ${cuenta.anuladas}`);
  log('\nPOR DÍA (bien / con problema):\n  ' + [...porDia.entries()].sort().map(([d, v]) => `${d}: ${v.ok} / ${v.no}`).join('\n  '));
  if (porMotivo.size) log('\nMOTIVOS DE RECHAZO:\n  ' + [...porMotivo.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${String(n).padStart(3)}  ${m}`).join('\n  '));
  if (decisiones.length) log('\nDECISIONES TOMADAS:\n  ' + decisiones.join('\n  '));
  if (rechazos.length) log('\nNO ENTRARON:\n  ' + rechazos.join('\n  '));
  if (INFORME) { fs.writeFileSync(INFORME, out.join('\n'), 'utf8'); console.log(`\nInforme: ${INFORME}`); }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
