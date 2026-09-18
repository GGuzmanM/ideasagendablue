/**
 * Catálogo de permisos (44) y la matriz de los roles del sistema. ÚNICA fuente: la usan
 * `routes/roles.ts` (validación al crear/editar roles) y `prisma/seed.ts` (base nueva). Cada permiso
 * es una acción cableada a su candado (`requirePermiso`): si agregas uno, cablea su endpoint o no
 * hace nada. Los permisos nuevos se otorgan a los roles existentes por MIGRACIÓN de datos (p. ej.
 * 20260908120100_permisos_hc_rol_medico, 20260914120100_consultorios_permiso_dispositivos).
 */
export const PERMISOS_VALIDOS = [
  // Historia clínica y receta
  // receta.ver = indicaciones podológicas y el listado; receta_medica.ver = ver e imprimir la RECETA MÉDICA.
  'hc.ver', 'hc.registrar', 'hc.anular', 'receta.ver', 'receta_medica.ver', 'receta.emitir',
  // Médico de la cita: autoasignar = el médico se toma / suelta a sí mismo; asignar = a cualquiera.
  'medico.autoasignar', 'medico.asignar',
  // Citas
  'citas.ver', 'citas.crear', 'citas.reprogramar', 'citas.cancelar', 'citas.estado', 'citas.revertir',
  // Pacientes
  'pacientes.ver', 'pacientes.crear', 'pacientes.editar',
  // Membresías
  'membresias.ver', 'membresias.vender', 'membresias.consumir', 'membresias.gestionar',
  // Promociones
  'promociones.ver', 'promociones.gestionar',
  // Movimientos
  'movimientos.ver', 'movimientos.editar',
  // Horarios / almuerzos
  'horarios.ver', 'horarios.editar',
  // Profesionales y servicios
  'profesionales.ver', 'profesionales.editar', 'competencias.editar', 'servicios.ver', 'servicios.editar',
  // Analítica y exportaciones
  'analytics.ver', 'analytics.agentes', 'exportar.usar',
  // Comunicaciones
  'comunicaciones.gestionar', 'canales.gestionar',
  // Sistema
  'usuarios.ver', 'usuarios.editar', 'roles.editar', 'auditoria.ver', 'notificaciones.ver', 'config.editar',
  // Aparatos de consultorio
  'dispositivos.gestionar',
] as const;

export type Permiso = (typeof PERMISOS_VALIDOS)[number];

const CITAS = ['citas.ver', 'citas.crear', 'citas.reprogramar', 'citas.cancelar', 'citas.estado'] as const;
const PACIENTES = ['pacientes.ver', 'pacientes.crear', 'pacientes.editar'] as const;
const CLINICA = ['hc.ver', 'hc.registrar', 'receta.ver'] as const;

/**
 * Matriz real de los roles (la misma que tiene la base en producción).
 * Receta médica (decisión 18-sep-2026): la VEN e IMPRIMEN solo admin, coordinación y médico; recepción
 * se queda con las indicaciones podológicas. La EMITEN también admin y coordinación, pero siempre a
 * nombre del médico de la cita (su CMP): el candado está en recetaService.emitirReceta.
 */
export const ROLES_SISTEMA: { nombre: string; label: string; descripcion: string; esSistema: boolean; permisos: Permiso[] }[] = [
  {
    nombre: 'admin', label: 'Administrador', descripcion: 'Acceso total al sistema', esSistema: true,
    permisos: PERMISOS_VALIDOS.filter((p) => p !== 'medico.autoasignar'),
  },
  {
    nombre: 'coordinadora_sedes', label: 'Coordinadora de Sedes', descripcion: 'Gestión de agenda, pacientes y reportes', esSistema: true,
    permisos: [
      ...CITAS, 'citas.revertir', ...PACIENTES, 'membresias.ver', 'membresias.vender', 'membresias.consumir', 'membresias.gestionar',
      'promociones.ver', 'promociones.gestionar', 'movimientos.ver', 'movimientos.editar', 'horarios.ver', 'horarios.editar',
      'profesionales.ver', 'profesionales.editar', 'competencias.editar', 'servicios.ver', 'servicios.editar',
      'analytics.ver', 'analytics.agentes', 'exportar.usar', 'comunicaciones.gestionar', 'canales.gestionar', 'notificaciones.ver', 'auditoria.ver',
      ...CLINICA, 'hc.anular', 'receta_medica.ver', 'receta.emitir', 'medico.asignar', 'dispositivos.gestionar',
    ],
  },
  {
    // Recepción registra la historia a nombre de la podóloga (hc.registrar) y vende membresías en su sede.
    nombre: 'recepcionista', label: 'Recepcionista', descripcion: 'Agenda, pacientes y venta de membresías (su sede)', esSistema: true,
    permisos: [...CITAS, ...PACIENTES, 'membresias.ver', 'membresias.vender', 'membresias.consumir', 'exportar.usar', 'comunicaciones.gestionar', ...CLINICA],
  },
  {
    // Contact center ve TODAS las sedes (ROLES_TODAS_SEDES) y NO tiene acceso clínico.
    nombre: 'contact_center', label: 'Contact Center', descripcion: 'Agenda, pacientes y venta de membresías (todas las sedes)', esSistema: false,
    permisos: [...CITAS, ...PACIENTES, 'membresias.ver', 'membresias.vender'],
  },
  {
    // Médico colegiado: agenda y pacientes solo lectura, historia clínica completa, receta y se asigna a las citas.
    nombre: 'medico', label: 'Médico', descripcion: 'Médico colegiado: registra historia clínica y emite recetas', esSistema: false,
    permisos: ['citas.ver', 'pacientes.ver', 'membresias.ver', ...CLINICA, 'receta_medica.ver', 'receta.emitir', 'medico.autoasignar'],
  },
];
