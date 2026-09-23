/**
 * LIMPIEZA PARA LA SALIDA A PRODUCCIÓN (21-sep-2026): borra las CITAS de prueba y la historia clínica
 * que cuelga de ellas, para empezar con datos reales. TODO lo demás queda intacto: pacientes (e historial
 * Genexis), profesionales, médicos, usuarios (recepción, contact center…), sedes, servicios, competencias,
 * horarios, almuerzos, movimientos, vacaciones/permisos, promociones, membresías y plantillas.
 *
 *   npx ts-node --transpile-only scripts/limpiar-citas-y-hc.ts                 → SIMULA: solo cuenta
 *   npx ts-node --transpile-only scripts/limpiar-citas-y-hc.ts --aplicar       → borra (una sola transacción)
 *   Opciones al aplicar:
 *     --con-auditoria     también borra del historial de auditoría lo que habla de esas citas / HC
 *   Las MEMBRESÍAS SON REALES (dicho por el usuario, 21-sep): no se borran, NO se tocan sus sesiones usadas ni su
 *   estado, y el registro de consumos se conserva (solo pierde el enlace a la cita borrada: la llave es SET NULL).
 *
 * Es un borrado DEFINITIVO (no «soft delete»): antes de aplicarlo se saca un respaldo con pg_dump.
 * Si algo falla a la mitad, la transacción se deshace entera y la base queda como estaba.
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';

const APLICAR = process.argv.includes('--aplicar');
const CON_AUDITORIA = process.argv.includes('--con-auditoria');

// Orden de borrado = de las hojas hacia la raíz (las llaves foráneas son RESTRICT).
const TABLAS_HC = [
  'receta_items', 'recetas', 'notas_evolucion_versiones', 'notas_evolucion', 'consentimientos_informados',
  'constancias_clinicas', 'controles_sugeridos', 'diagnosticos_atencion', 'procedimientos_atencion', 'fotos_clinicas',
  'escalas_clinicas', 'imagenes_podograma', 'marcas_podograma', 'dibujos_silueta', 'dictados_consulta', 'atenciones_clinicas',
];
const TABLAS_CITA = ['eventos_dispositivo', 'tiempos_tratamiento', 'comentarios_cita', 'recordatorios_cita', 'tokens_accion_cita', 'video_envio_logs', 'citas'];
const TABLAS_DERIVADAS = ['agregados_diarios']; // analítica calculada desde las citas: se recalcula sola
const ENTIDADES_AUDIT = ['cita', 'atencion_clinica', 'atencion', 'receta', 'consentimiento', 'constancia', 'nota_evolucion', 'diagnostico', 'procedimiento', 'foto_clinica', 'escala', 'podograma', 'tiempo_tratamiento', 'consumo_sesion'];

// Lo que NO se toca: se cuenta antes y después para demostrarlo.
const INTACTAS = ['pacientes', 'historial_genexis', 'profesionales', 'usuarios', 'sedes', 'servicios', 'competencias_profesional', 'horarios_profesional', 'asignaciones_sede', 'asignaciones_administrativas', 'baro_medico_sede', 'bloqueos_agenda', 'promociones', 'paquetes_paciente', 'consumos_sesion', 'roles'];

const contar = async (t: string, db: { $queryRawUnsafe: typeof prisma.$queryRawUnsafe } = prisma) =>
  Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}"`))[0]!.n); // nombres de tabla fijos de este archivo

async function main() {
  const base = (process.env.DATABASE_URL ?? '').split('/').pop();
  console.log(`${APLICAR ? 'APLICANDO (borrado definitivo)' : 'SIMULACIÓN (no borra nada)'} en «${base}»\n`);

  console.log('Se BORRA:');
  let total = 0;
  for (const t of [...TABLAS_HC, ...TABLAS_CITA, ...TABLAS_DERIVADAS]) { const n = await contar(t); total += n; if (n) console.log(`  ${String(n).padStart(6)}  ${t}`); }
  const nAudit = await prisma.auditLog.count({ where: { OR: [{ citaId: { not: null } }, { entidad: { in: ENTIDADES_AUDIT } }] } });
  console.log(`  ${String(nAudit).padStart(6)}  registros de auditoría sobre citas / HC  → ${CON_AUDITORIA ? 'SE BORRAN' : 'se conservan (usa --con-auditoria para borrarlos)'}`);
  const sesiones = async (db: { paquetePaciente: typeof prisma.paquetePaciente } = prisma) => (await db.paquetePaciente.aggregate({ _sum: { sesionesUsadas: true } }))._sum.sesionesUsadas ?? 0;
  const usadasAntes = await sesiones();
  console.log(`  (las membresías NO se tocan: ${usadasAntes} sesiones usadas se quedan como están; los consumos se conservan sin enlace a la cita)`);

  console.log('\nQueda INTACTO:');
  const antes: Record<string, number> = {};
  for (const t of INTACTAS) { antes[t] = await contar(t); console.log(`  ${String(antes[t]).padStart(6)}  ${t}`); }

  if (!APLICAR) { console.log(`\nTotal a borrar: ${total} filas. Nada se tocó. Para borrar: agrega --aplicar`); return; }

  await prisma.$transaction(async (tx) => {
    for (const t of [...TABLAS_HC, ...TABLAS_CITA, ...TABLAS_DERIVADAS]) await tx.$executeRawUnsafe(`DELETE FROM "${t}"`); // nombres fijos
    if (CON_AUDITORIA) await tx.auditLog.deleteMany({ where: { OR: [{ citaId: { not: null } }, { entidad: { in: ENTIDADES_AUDIT } }] } });
    if ((await sesiones(tx as never)) !== usadasAntes) throw new Error('cambiaron las sesiones usadas de las membresías: se deshace todo');
    // Comprobación DENTRO de la transacción: si algo «intacto» cambió, se deshace todo.
    for (const t of INTACTAS) {
      const n = await contar(t, tx as never);
      if (n !== antes[t]) throw new Error(`«${t}» cambió (${antes[t]} → ${n}): se deshace todo`);
    }
  }, { timeout: 120_000 });

  console.log('\n✔ Borrado. Comprobación:');
  for (const t of ['citas', 'atenciones_clinicas', 'recetas']) console.log(`  ${t}: ${await contar(t)}`);
  console.log(`  membresías: ${await contar('paquetes_paciente')} · consumos conservados: ${await contar('consumos_sesion')} · sesiones usadas: ${await sesiones()} (igual que antes: ${usadasAntes})`);
  for (const t of INTACTAS) { const n = await contar(t); if (n !== antes[t]) console.log(`  ⚠ ${t}: ${antes[t]} → ${n}`); }
  console.log('  Lo demás quedó con las mismas cantidades que antes.');
}
main().catch((e) => { console.error('✘', e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
