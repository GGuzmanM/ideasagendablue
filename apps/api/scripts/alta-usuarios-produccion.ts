/**
 * Alta de usuarios para la salida a producción (18-sep-2026), a partir de la lista del sistema anterior.
 *
 *   ENV_FILE=… npx ts-node --transpile-only scripts/alta-usuarios-produccion.ts            → SIMULA (no escribe)
 *   ENV_FILE=… npx ts-node --transpile-only scripts/alta-usuarios-produccion.ts --aplicar  → aplica
 *
 * Reglas (decididas con el usuario):
 *  · Solo los ACTIVOS de: Recepción, Contact Center y Doctores. La coordinadora sigue siendo Fiorella
 *    Zumary. El admin del usuario (admin@limablue.pe) NO se toca: sigue activo con su contraseña.
 *  · Contraseña = DNI de 8 dígitos. Las que no lo son quedan marcadas para revisar.
 *  · Correo: formato actual (2 letras del nombre + apellido @limablue.com). Si ya tiene usuario, se
 *    mantiene su correo (se reactiva, se actualiza el nombre y la contraseña pasa a su DNI).
 *  · Nada se borra: los usuarios de prueba y los que no están en la lista se DESACTIVAN; las fichas
 *    «Prueba Doctor» también.
 *  · Doctores: ficha de MÉDICO nueva (sin CMP, «solo por solicitud»: no es columna en la agenda) +
 *    usuario médico vinculado. Daniel y Yasica Doy (dueños) siguen como podólogos: usuario de coordinación.
 *  · Recepcionistas vinculadas al roster derivan sus sedes de Movimientos; las nuevas (sin roster) y los
 *    médicos reciben las 5 sedes (coordinación lo ajusta).
 * Al aplicar escribe la RELACIÓN DE USUARIOS en Excel (--excel="ruta.xlsx"; por defecto junto al script).
 * Ese Excel lleva contraseñas: entregarlo en privado y borrarlo después (no se sube al repositorio).
 */
import '../src/cargarEnv';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import ExcelJS from 'exceljs';
import path from 'path';
import { prisma } from '../src/db';

const APLICAR = process.argv.includes('--aplicar');
/** Cuentas que el script no toca nunca (ni las desactiva ni les cambia la contraseña). */
const CONSERVAR = ['admin@limablue.pe'];

type Rol = 'admin' | 'coordinadora_sedes' | 'recepcionista' | 'contact_center' | 'medico';
interface Persona { usuario: string; nombre: string; dni: string; rol: Rol; correo?: string; nota?: string }

// ── La lista (activos), con el nombre ordenado «Nombres Apellidos» ──
const LISTA: Persona[] = [
  // Coordinación
  { usuario: 'FIORELLA.ZUMARY', nombre: 'Fiorella Zumary', dni: '46080507', rol: 'coordinadora_sedes', correo: 'fizumary@limablue.com' },
  { usuario: 'DANIEL.DOY', nombre: 'Daniel Doy', dni: '44416007', rol: 'coordinadora_sedes', nota: 'Dueño: sigue como podólogo; usuario de coordinación' },
  { usuario: 'YASICA.DOY', nombre: 'Yasica Doy', dni: '', rol: 'coordinadora_sedes', nota: 'Dueña: sigue como podóloga; usuario de coordinación' },
  // Recepción
  { usuario: 'CAROLINA.DIAZ', nombre: 'Carolina Diaz', dni: '003387705', rol: 'recepcionista', correo: 'cadiaz@limablue.com' },
  { usuario: 'FRANCHESCA.HUISARAIME', nombre: 'Franchesca Huisaraime', dni: '76603870', rol: 'recepcionista', correo: 'frhuisaraime@limablue.com' },
  { usuario: 'ASSELA.VELASQUEZ', nombre: 'Assela Velasquez', dni: '76514690', rol: 'recepcionista', correo: 'asvelasquez@limablue.com' },
  { usuario: 'DIANA.GARCIA', nombre: 'Diana Garcia', dni: '77669932', rol: 'recepcionista', correo: 'digarcia@limablue.com' },
  { usuario: 'ANAIS.PUESCAS', nombre: 'Anais Puescas', dni: '44642156', rol: 'recepcionista', correo: 'anpuescas@limablue.com' },
  { usuario: 'Daniela.Gonzales', nombre: 'Daniela Gonzales', dni: '720708740', rol: 'recepcionista', correo: 'dagonzales@limablue.com' },
  { usuario: 'kiara.paredes', nombre: 'Kiara Paredes', dni: '72427834', rol: 'recepcionista' },
  { usuario: 'EVELYN.RECUENCO', nombre: 'Evelyn Recuenco', dni: '40673507', rol: 'recepcionista' },
  { usuario: 'ANGELICA.ROJAS', nombre: 'Angelica Rojas Sanchez', dni: '76677667', rol: 'recepcionista' },
  { usuario: 'DANNA.QUISTAN', nombre: 'Danna Judith Quistan Juipa', dni: '72525107', rol: 'recepcionista', nota: 'Venía dos veces (Quistan.Danna y DANNA.QUISTAN): un solo usuario' },
  { usuario: 'Moran.Marie', nombre: 'Marie France Moran Munar', dni: '77499776', rol: 'recepcionista', correo: 'mamoran@limablue.com' },
  { usuario: 'sebastian.zapata', nombre: 'Sebastian Zapata Salcedo', dni: '73246184', rol: 'recepcionista' },
  // Contact center
  { usuario: 'JOAQUIN.OCHOA', nombre: 'Joaquin Ochoa', dni: '72385957', rol: 'contact_center' },
  { usuario: 'JEREMY.TREBEJO', nombre: 'Jeremy Trebejo', dni: '70997654', rol: 'contact_center' },
  { usuario: 'GARY.CALERO', nombre: 'Gary Calero', dni: '46628310', rol: 'contact_center' },
  { usuario: 'ELENA.DOY', nombre: 'Elena Doy', dni: '07840096', rol: 'contact_center' },
  { usuario: 'CARMEN.MAMANI', nombre: 'Carmen Mamani', dni: '27071991', rol: 'contact_center' },
  { usuario: 'Jessenia.Jimenez', nombre: 'Jessenia Jimenez', dni: '73107915', rol: 'contact_center' },
  { usuario: 'Andrea.Gamarra', nombre: 'Andrea Alejandra Gamarra Rodriguez', dni: '72709930', rol: 'contact_center' },
  { usuario: 'ANGELA.SALE', nombre: 'Angela Gabriela Sale Lopez', dni: '73459777', rol: 'contact_center' },
  { usuario: 'ALISON.CASTILLO', nombre: 'Alison Castillo', dni: '74432096', rol: 'contact_center' },
  // Médicos
  { usuario: 'ADRIAN.ROJAS', nombre: 'Adrian Rojas', dni: '75834059', rol: 'medico' },
  { usuario: 'JAIME.TAFUR', nombre: 'Jaime Tafur', dni: '70214001', rol: 'medico' },
  { usuario: 'JAIME.RUIZ', nombre: 'Jaime Ruiz', dni: '72917032', rol: 'medico' },
  { usuario: 'dante.yoplac', nombre: 'Dante Yoplac', dni: '40185551', rol: 'medico' },
  { usuario: 'xiomara.muñoz', nombre: 'Xiomara Muñoz', dni: '72200572', rol: 'medico' },
  { usuario: 'julio.villafuerte', nombre: 'Julio Villafuerte', dni: '75728649', rol: 'medico' },
  { usuario: 'valeria.villavicencio', nombre: 'Valeria Villavicencio', dni: '73650258', rol: 'medico' },
  { usuario: 'rosa.puescas', nombre: 'Rosa Puescas', dni: '44642156', rol: 'medico', nota: 'Mismo DNI que Anais Puescas (recepción): ¿es la misma persona?' },
  { usuario: 'ALEXANDRA.LEYVA', nombre: 'Alexandra Leyva Paulini', dni: '72257555', rol: 'medico' },
  { usuario: 'LIBERTAD.ARRASCO', nombre: 'Libertad Arrasco Galvez', dni: '71566045', rol: 'medico' },
  { usuario: 'CAROLINA.MUNAYLLA', nombre: 'Carolina Ivonne Munaylla Cuadros', dni: '71587214', rol: 'medico' },
  { usuario: 'ADRIAN.SANCHEZ', nombre: 'Adrian Sanchez Ramos', dni: '76321222', rol: 'medico' },
  { usuario: 'MIRTHA.PATRICIA', nombre: 'Mirtha Patricia Ramos Nicoll', dni: '72644346', rol: 'medico', correo: 'miramos@limablue.com' },
  { usuario: 'GABRIELA.MANCILLA', nombre: 'Gabriela Mancilla Chang', dni: '75447108', rol: 'medico' },
  { usuario: 'Rodrigo.Roque', nombre: 'Rodrigo Roque Colqui', dni: '72683812', rol: 'medico' },
  { usuario: 'MARGARITA.MERCEDES', nombre: 'Mercedes Margarita Paz Infante', dni: '75592941', rol: 'medico', correo: 'mepaz@limablue.com' },
  { usuario: 'Alessandra.Rivera', nombre: 'Alessandra Rivera', dni: '75592916', rol: 'medico' },
  { usuario: 'Alejandra.Bernedo', nombre: 'Alejandra Sara Bernedo Zamora', dni: '76427100', rol: 'medico' },
  { usuario: 'DANIELA.SANTOS', nombre: 'Daniela Alessandra Santos Isla', dni: '74137411', rol: 'medico' },
  { usuario: 'DENNISE.MOSCOSO', nombre: 'Dennise Trinidad Chigne Moscoso', dni: '74085314', rol: 'medico', correo: 'dechigne@limablue.com' },
  { usuario: 'XIMENA.BUCHER', nombre: 'Ximena Echegaray Bucher', dni: '71218417', rol: 'medico', correo: 'xiechegaray@limablue.com' },
  { usuario: 'CHRISTOPHER.SIRVAS', nombre: 'Christopher Sirvas', dni: '71376720', rol: 'medico' },
];

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Formato actual: 2 letras del nombre + apellido (del usuario NOMBRE.APELLIDO del sistema anterior). */
function correoDe(p: Persona): string {
  if (p.correo) return p.correo;
  const [nom, ape] = p.usuario.split('.');
  return `${sinTildes(nom!).slice(0, 2)}${sinTildes(ape!).replace(/[^a-z]/g, '')}@limablue.com`;
}
/** DNI de 8 dígitos; si no lo es, se normaliza cuando es evidente y se marca. */
function claveDe(p: Persona): { clave: string; nota?: string } {
  const d = p.dni.trim();
  if (/^\d{8}$/.test(d)) return { clave: d };
  if (/^0\d{8}$/.test(d)) return { clave: d.slice(1), nota: `DNI venía con 9 dígitos (${d}): se quitó el 0 inicial` };
  if (/^\d{9}$/.test(d)) return { clave: d.slice(0, 8), nota: `DNI venía con 9 dígitos (${d}): se tomaron los 8 primeros — VERIFICAR` };
  // Sin DNI (el admin, Yasica): contraseña temporal fuerte.
  const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const clave = Array.from({ length: 12 }, () => alf[randomInt(alf.length)]).join('');
  return { clave, nota: 'Sin DNI en la lista: contraseña temporal (cámbiala al entrar)' };
}

async function main() {
  console.log(APLICAR ? '*** APLICANDO en la base ***' : '(simulación: no se escribe nada)');
  console.log('BD:', (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@'));
  const sedes = await prisma.sede.findMany({ select: { id: true, nombre: true } });
  const baro = await prisma.unidadNegocio.findFirst({ where: { nombre: 'Baropodometría' }, select: { id: true } });
  if (!baro) throw new Error('No existe la unidad Baropodometría');

  const relacion: Record<string, string>[] = [];
  const correos = new Set<string>();
  for (const p of LISTA) {
    const correo = correoDe(p);
    if (correos.has(correo)) throw new Error(`Correo repetido: ${correo}`);
    correos.add(correo);
    const { clave, nota } = claveDe(p);
    const existente = await prisma.usuario.findUnique({ where: { email: correo }, select: { id: true, recepcionistaId: true, profesionalId: true, rol: true } });
    let accion = existente ? 'actualizado' : 'creado';
    let sedesTxt = ['admin', 'coordinadora_sedes', 'contact_center'].includes(p.rol) ? 'Todas (por su rol)' : '';

    if (APLICAR) {
      const hash = await bcrypt.hash(clave, 12);
      let profesionalId: string | null = existente?.profesionalId ?? null;
      if (p.rol === 'medico' && !profesionalId) {
        const [nombres, ...resto] = p.nombre.split(' ');
        const ficha = await prisma.profesional.create({
          data: { nombres: nombres!, apellidos: resto.join(' ') || '-', tipo: 'medico', unidadNegocioId: baro.id, soloPorSolicitud: true, activo: true },
          select: { id: true },
        });
        profesionalId = ficha.id;
      }
      const data = { nombre: p.nombre, rol: p.rol, activo: true, deletedAt: null, passwordHash: hash, ...(p.rol === 'medico' ? { profesionalId } : {}) };
      const u = existente
        ? await prisma.usuario.update({ where: { id: existente.id }, data, select: { id: true, recepcionistaId: true } })
        : await prisma.usuario.create({ data: { ...data, email: correo }, select: { id: true, recepcionistaId: true } });
      // Sedes: recepción vinculada al roster → las deriva de Movimientos; recepción nueva y médicos → las 5.
      if ((p.rol === 'recepcionista' && !u.recepcionistaId) || p.rol === 'medico') {
        for (const s of sedes) {
          await prisma.usuarioSede.upsert({ where: { usuarioId_sedeId: { usuarioId: u.id, sedeId: s.id } }, create: { usuarioId: u.id, sedeId: s.id }, update: {} });
        }
      }
    }
    if (p.rol === 'recepcionista') sedesTxt = existente?.recepcionistaId ? 'Según Movimientos (roster)' : 'Las 5 (ajustar su sede)';
    if (p.rol === 'medico') sedesTxt = 'Las 5';
    if (p.rol === 'medico' && !existente) accion += ' + ficha de médico (sin CMP)';
    relacion.push({
      rol: p.rol, nombre: p.nombre, correo, clave, sedes: sedesTxt, accion,
      usuarioAnterior: p.usuario, observacion: [p.nota, nota].filter(Boolean).join(' · '),
    });
  }

  // Desactivar lo que no está en la lista (usuarios de prueba y antiguos). No se borra nada.
  const aDesactivar = await prisma.usuario.findMany({ where: { activo: true, deletedAt: null, email: { notIn: [...correos, ...CONSERVAR] } }, select: { id: true, email: true, nombre: true, rol: true } });
  const fichasPrueba = await prisma.profesional.findMany({ where: { tipo: 'medico', esEquipo: false, activo: true, apellidos: { contains: 'Prueba' } }, select: { id: true, nombres: true, apellidos: true } });
  if (APLICAR) {
    await prisma.usuario.updateMany({ where: { id: { in: aDesactivar.map((u) => u.id) } }, data: { activo: false } });
    await prisma.profesional.updateMany({ where: { id: { in: fichasPrueba.map((f) => f.id) } }, data: { activo: false } });
  }

  console.log(`\n${relacion.length} usuarios (${relacion.filter((r) => r.accion.startsWith('creado')).length} nuevos, ${relacion.filter((r) => r.accion === 'actualizado').length} ya existían)`);
  for (const r of relacion) console.log(`  ${r.rol.padEnd(18)} ${r.correo.padEnd(28)} ${r.accion}${r.observacion ? `  ⚠ ${r.observacion}` : ''}`);
  console.log(`\nSe desactivan ${aDesactivar.length} usuarios:`);
  for (const u of aDesactivar) console.log(`  ${u.rol.padEnd(18)} ${u.email}  (${u.nombre})`);
  console.log(`Se desactivan ${fichasPrueba.length} fichas de médico de prueba: ${fichasPrueba.map((f) => `${f.nombres} ${f.apellidos}`).join(', ')}`);

  const arg = process.argv.find((a) => a.startsWith('--excel='));
  if (!APLICAR) {
    // Simulación con --excel: la relación sale igual, pero las contraseñas temporales (sin DNI) se
    // generan recién al aplicar, así que no se muestran.
    if (arg) {
      const previa = relacion.map((r) => (r.observacion?.includes('contraseña temporal') ? { ...r, clave: '(se genera al aplicar)' } : r));
      await escribirExcel(arg.slice('--excel='.length), previa, aDesactivar);
      console.log(`\nRelación (SIMULACIÓN, aún no aplicada): ${arg.slice('--excel='.length)}`);
    }
    console.log('\nSimulación: no se escribió nada en la base. Para aplicar, agrega --aplicar');
    return;
  }
  const destino = arg ? arg.slice('--excel='.length) : path.join(__dirname, 'Usuarios produccion.xlsx');
  await escribirExcel(destino, relacion, aDesactivar);
  console.log(`\nRelación de usuarios (con contraseñas, entregar en privado): ${destino}`);
}

const ROL_LABEL: Record<string, string> = { admin: 'Administrador', coordinadora_sedes: 'Coordinación', recepcionista: 'Recepción', contact_center: 'Contact center', medico: 'Médico' };

/** Relación de usuarios en Excel (lleva contraseñas: entregar en privado y borrar después). */
async function escribirExcel(destino: string, relacion: Record<string, string>[], desactivados: { email: string; nombre: string; rol: string }[]) {
  const wb = new ExcelJS.Workbook();
  const f = { name: 'Arial', size: 10 };
  const hoja = (nombre: string, titulo: string, cols: { h: string; w: number }[], filas: string[][]) => {
    const ws = wb.addWorksheet(nombre);
    ws.mergeCells(1, 1, 1, cols.length);
    const t = ws.getCell(1, 1);
    t.value = titulo;
    t.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0044AB' } };
    ws.getRow(1).height = 24;
    ws.addRow(cols.map((c) => c.h)).eachCell((c) => {
      c.font = { ...f, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5FBF' } };
    });
    for (const r of filas) ws.addRow(r).eachCell((c) => { c.font = f; c.alignment = { vertical: 'top', wrapText: true }; });
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
    return ws;
  };
  const orden = ['admin', 'coordinadora_sedes', 'recepcionista', 'contact_center', 'medico'];
  const filas = [...relacion]
    .sort((a, b) => orden.indexOf(a.rol!) - orden.indexOf(b.rol!) || a.nombre!.localeCompare(b.nombre!))
    .map((r) => [ROL_LABEL[r.rol!] ?? r.rol!, r.nombre!, r.correo!, r.clave!, r.sedes!, r.accion!, r.usuarioAnterior!, r.observacion ?? '']);
  const ws = hoja('Usuarios', 'Limablue Agenda · Usuarios de producción (entregar en privado)', [
    { h: 'Rol', w: 15 }, { h: 'Nombre', w: 34 }, { h: 'Usuario (correo)', w: 30 }, { h: 'Contraseña', w: 16 }, { h: 'Sedes', w: 24 },
    { h: 'Qué se hizo', w: 30 }, { h: 'Usuario anterior', w: 22 }, { h: 'Observación', w: 60 },
  ], filas);
  ws.eachRow((row, n) => { if (n > 2 && row.getCell(8).value) row.getCell(8).font = { ...f, bold: true, color: { argb: 'FFB45309' } }; });
  hoja('Desactivados', 'Usuarios desactivados (no se borró nada; se reactivan en Administración › Usuarios)', [
    { h: 'Rol', w: 18 }, { h: 'Usuario (correo)', w: 36 }, { h: 'Nombre', w: 34 },
  ], desactivados.map((u) => [ROL_LABEL[u.rol] ?? u.rol, u.email, u.nombre]));
  await wb.xlsx.writeFile(destino);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
