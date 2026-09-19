import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { api } from '../api/client';
import { sedesApi } from '../api';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  citaId: string | null;
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  sedeId: string | null;
  ip: string | null;
  userAgent: string | null;
  creadoEn: string;
  /** El servidor lo marca cuando antes/despues es contenido clínico y el usuario no puede verlo. */
  contenidoReservado?: boolean;
  usuario: { id: string; nombre: string; email: string; rol: string } | null;
  sede: { id: string; nombre: string; color: string } | null;
  cita: {
    id: string;
    horaInicio: string;
    fecha: string;
    paciente: { nombres: string; apellidoPaterno: string };
    servicio: { nombre: string };
    profesional: { nombres: string; apellidos: string } | null;
  } | null;
}

/** Etiquetas de valores configurables (p. ej. canal `whatsapp` → «WhatsApp») que resuelve el servidor. */
export type ValoresLegibles = Record<string, Record<string, string>>;

export interface AuditLogsResponse {
  data: AuditLog[];
  /** Mapa { uuid → "Nombre legible" } — resuelto server-side para reemplazar códigos
   *  como sedeId/pacienteId/profesionalId/etc por nombres humanos en el diff. */
  nombresPorId: Record<string, string>;
  /** { campo → { valor → etiqueta } } para catálogos configurables (canales, roles…). */
  valoresLegibles?: ValoresLegibles;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditStats {
  total: number;
  hoy: number;
  usuariosActivos: number;
}

export interface AuditFacetas {
  entidades: string[];
  acciones: string[];
  usuarios: { id: string; nombre: string; rol: string; activo?: boolean }[];
}

// ── Metadata visual de acciones ──────────────────────────────────────────────
export interface AccionStyle {
  label: string;
  icon: string;
  bg: string; // tailwind bg class
  text: string; // tailwind text class
  border: string; // tailwind border class
  circleBg: string; // ícono redondo para el modal header
}

type Tono = 'verde' | 'azul' | 'ambar' | 'rojo' | 'violeta' | 'cielo' | 'indigo' | 'teal' | 'primario' | 'gris';
const TONOS: Record<Tono, Omit<AccionStyle, 'label' | 'icon'>> = {
  verde:    { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200/70', circleBg: 'bg-emerald-600' },
  azul:     { bg: 'bg-blue-100',    text: 'text-blue-800',    border: 'border-blue-200/70',    circleBg: 'bg-blue-600' },
  ambar:    { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-200/70',   circleBg: 'bg-amber-600' },
  rojo:     { bg: 'bg-red-100',     text: 'text-red-800',     border: 'border-red-200/70',     circleBg: 'bg-red-600' },
  violeta:  { bg: 'bg-violet-100',  text: 'text-violet-800',  border: 'border-violet-200/70',  circleBg: 'bg-violet-600' },
  cielo:    { bg: 'bg-sky-100',     text: 'text-sky-800',     border: 'border-sky-200/70',     circleBg: 'bg-sky-600' },
  indigo:   { bg: 'bg-indigo-100',  text: 'text-indigo-800',  border: 'border-indigo-200/70',  circleBg: 'bg-indigo-600' },
  teal:     { bg: 'bg-teal-100',    text: 'text-teal-800',    border: 'border-teal-200/70',    circleBg: 'bg-teal-600' },
  primario: { bg: 'bg-primary/10',  text: 'text-primary',     border: 'border-primary/30',     circleBg: 'bg-primary' },
  gris:     { bg: 'bg-surface-container', text: 'text-on-surface-variant', border: 'border-outline-variant/50', circleBg: 'bg-slate-500' },
};
const def = (label: string, icon: string, tono: Tono): AccionStyle => ({ label, icon, ...TONOS[tono] });

/**
 * Etiqueta EXACTA en español de cada acción registrada (clave técnica → texto para recepción y
 * coordinación). Lo que no esté aquí cae a los patrones de abajo y, en último caso, a la clave
 * «humanizada» — pero la meta es que TODO lo que se audita tenga su nombre.
 */
export const ACCION_LABEL: Record<string, AccionStyle> = {
  // ── Agenda: citas ──
  crear:                        def('Cita agendada', 'event_available', 'verde'),
  agendar:                      def('Cita agendada', 'event_available', 'verde'),
  crear_retroactiva:            def('Cita agendada en fecha pasada', 'history', 'ambar'),
  cambiar_estado:               def('Cambio de estado', 'autorenew', 'ambar'),
  auto_completar:               def('Completada por tiempo', 'timer', 'ambar'),
  mover:                        def('Cita reprogramada', 'swap_horiz', 'azul'),
  cancelar:                     def('Cita cancelada', 'cancel', 'rojo'),
  cancelar_por_paciente:        def('Cancelada por el paciente', 'person_off', 'rojo'),
  cancelar_por_movimiento:      def('Cancelada por movimiento de personal', 'move_down', 'rojo'),
  reprogramar_por_movimiento:   def('Marcada para reprogramar (movimiento)', 'move_down', 'ambar'),
  cancelar_por_enfermedad:      def('Cancelada por enfermedad del profesional', 'sick', 'rojo'),
  ESTADO_CAMBIADO_POR_MOVIMIENTO: def('Cancelada por movimiento de personal', 'move_down', 'rojo'),
  ENFERMEDAD_CANCELAR_CITA:     def('Cancelada por enfermedad del profesional', 'sick', 'rojo'),
  confirmar_por_paciente:       def('Confirmada por el paciente', 'how_to_reg', 'verde'),
  confirmar_recordatorio:       def('Confirmada por el paciente', 'how_to_reg', 'verde'),
  click_reprogramar:            def('Paciente pidió reprogramar', 'phone_forwarded', 'ambar'),
  cambiar_consultorio:          def('Consultorio asignado', 'meeting_room', 'primario'),
  agregar_comentario:           def('Comentario agregado', 'chat', 'primario'),
  editar_canal:                 def('Canal de reserva cambiado', 'call', 'primario'),
  editar_promocion:             def('Promoción de la cita cambiada', 'sell', 'primario'),
  asignar_medico:               def('Médico asignado', 'stethoscope', 'teal'),
  tomar_cita_medico:            def('Médico tomó la cita', 'stethoscope', 'teal'),
  soltar_cita_medico:           def('Médico soltó la cita', 'person_remove', 'teal'),
  recordatorio_reserva_enviado: def('Correo de reserva enviado', 'mark_email_read', 'violeta'),
  recordatorio_enviado:         def('Recordatorio enviado', 'notifications_active', 'violeta'),
  recordatorio_reenvio_manual:  def('Correo reenviado a mano', 'forward_to_inbox', 'violeta'),
  reenviar_confirmacion_correo: def('Correo reenviado a mano', 'forward_to_inbox', 'violeta'),
  ajustar_hora_atencion:        def('Hora de atención corregida', 'schedule', 'ambar'),
  ajustar_hora_completada:      def('Hora de término corregida', 'schedule', 'ambar'),
  // ── Sesiones de paquete / membresías ──
  consumir_sesion:              def('Sesión descontada', 'confirmation_number', 'primario'),
  devolver_sesion:              def('Sesión devuelta', 'undo', 'ambar'),
  consumo_manual_sesion:        def('Sesión descontada a mano', 'confirmation_number', 'primario'),
  anular_consumo_sesion:        def('Descuento de sesión anulado', 'undo', 'ambar'),
  exonerar_sesion:              def('Cita sin descuento de sesión', 'money_off', 'ambar'),
  revertir_exoneracion_sesion:  def('Vuelve a descontar sesión', 'undo', 'ambar'),
  vender_membresia:             def('Membresía vendida', 'card_membership', 'verde'),
  habilitar_membresia_vendida:  def('Membresía habilitada', 'check_circle', 'verde'),
  deshabilitar_membresia_vendida: def('Membresía deshabilitada', 'block', 'rojo'),
  activar_membresia:            def('Membresía activada', 'check_circle', 'verde'),
  desactivar_membresia:         def('Membresía desactivada', 'block', 'rojo'),
  crear_membresia:              def('Membresía creada', 'add_circle', 'verde'),
  editar_membresia:             def('Membresía editada', 'edit', 'primario'),
  configurar_contrato_membresia: def('Contrato de membresía configurado', 'description', 'primario'),
  subir_contrato_membresia:     def('Contrato de membresía subido', 'upload_file', 'primario'),
  crear_paquete_genexis_recepcion: def('Paquete Genexis registrado', 'inventory_2', 'verde'),
  reanclar_apertura_genexis:    def('Sesión Genexis adjudicada', 'inventory_2', 'primario'),
  aprobar_apertura_genexis:     def('Apertura Genexis aprobada', 'task_alt', 'verde'),
  descartar_apertura_genexis:   def('Apertura Genexis descartada', 'delete', 'rojo'),
  aprobar_bloque_conciliacion:  def('Bloque de conciliación aprobado', 'task_alt', 'verde'),
  cerrar_conciliacion_genexis:  def('Conciliación Genexis cerrada', 'lock', 'primario'),
  corregir_tamano_paquete_manual: def('Tamaño del paquete corregido', 'edit', 'ambar'),
  crear_promocion:              def('Promoción creada', 'add_circle', 'verde'),
  eliminar_promocion:           def('Promoción eliminada', 'delete', 'rojo'),
  // ── Personal, horarios y bloqueos ──
  crear_movimiento:             def('Movimiento de personal creado', 'move_up', 'azul'),
  editar_movimiento:            def('Movimiento de personal editado', 'edit', 'azul'),
  eliminar_movimiento:          def('Movimiento de personal eliminado', 'delete', 'rojo'),
  crear_bloqueo_enfermedad:     def('Día liberado por enfermedad', 'sick', 'ambar'),
  ENFERMEDAD_BLOQUEO_CREADO:    def('Día liberado por enfermedad', 'sick', 'ambar'),
  VACACIONES_EDITADAS:          def('Vacaciones editadas', 'beach_access', 'ambar'),
  VACACIONES_ELIMINADAS:        def('Vacaciones eliminadas', 'beach_access', 'rojo'),
  PERMISO_ELIMINADO:            def('Permiso eliminado', 'event_busy', 'rojo'),
  editar_horario_semanal:       def('Horario semanal editado', 'event_repeat', 'ambar'),
  override_turno_fecha:         def('Turno del día ajustado', 'event_repeat', 'ambar'),
  dia_especial_personal:        def('Personal de día especial', 'event_repeat', 'ambar'),
  presencia_excepcion:          def('Presencia en día de excepción', 'event_repeat', 'ambar'),
  fijar_meta_dias:              def('Meta de días fijada', 'flag', 'primario'),
  baro_solicitud_agregar:       def('Médico habilitado para baro', 'verified', 'teal'),
  baro_solicitud_quitar:        def('Médico retirado de baro', 'do_not_disturb_on', 'rojo'),
  crear_competencia:            def('Competencia habilitada', 'verified', 'primario'),
  habilitar_competencia:        def('Competencia habilitada', 'verified', 'primario'),
  deshabilitar_competencia:     def('Competencia deshabilitada', 'do_not_disturb_on', 'rojo'),
  activar_combinacion:          def('Combinación de servicios activada', 'join_inner', 'verde'),
  desactivar_combinacion:       def('Combinación de servicios desactivada', 'join_inner', 'rojo'),
  eliminar_combinacion:         def('Combinación de servicios eliminada', 'delete', 'rojo'),
  config_ancla_combinacion:     def('Servicio ancla configurado', 'anchor', 'primario'),
  crear_ficha_recepcion:        def('Ficha de recepción creada', 'badge', 'verde'),
  vincular_ficha_recepcion:     def('Ficha de recepción vinculada', 'link', 'primario'),
  crear_ficha_profesional:      def('Ficha de profesional creada', 'badge', 'verde'),
  editar_cmp:                   def('CMP del médico actualizado', 'badge', 'primario'),
  renombrar_ficha:              def('Nombre de la ficha actualizado', 'badge', 'primario'),
  renombrar_usuario:            def('Nombre del usuario actualizado', 'badge', 'primario'),
  vincular_ficha_profesional:   def('Ficha de profesional vinculada', 'link', 'primario'),
  // ── Sesiones y sistema ──
  LOGIN:                        def('Inicio de sesión', 'login', 'verde'),
  LOGIN_FALLIDO:                def('Intento de sesión fallido', 'lock', 'rojo'),
  recalcular_agregados:         def('Reportes recalculados', 'calculate', 'gris'),
  recalcular_agregados_hoy:     def('Reportes de hoy recalculados', 'calculate', 'gris'),
  recalcular_agregados_auto:    def('Reportes recalculados (automático)', 'calculate', 'gris'),
  // ── Aparato del consultorio / tiempos ──
  crear_dispositivo:            def('Aparato registrado', 'devices', 'verde'),
  editar_dispositivo:           def('Aparato editado', 'devices', 'primario'),
  eliminar_dispositivo:         def('Aparato eliminado', 'devices', 'rojo'),
  revocar_dispositivo:          def('Aparato revocado', 'block', 'rojo'),
  regenerar_clave_dispositivo:  def('Clave del aparato regenerada', 'key', 'ambar'),
  iniciar_tiempo_tratamiento:   def('Tratamiento iniciado (aparato)', 'play_circle', 'teal'),
  cerrar_tiempo_sin_fin:        def('Tiempo cerrado sin FIN', 'timer_off', 'ambar'),
  inicio:                       def('Botón INICIO', 'play_circle', 'teal'),
  // ── Videos por servicio ──
  video_enviado:                def('Video enviado', 'smart_display', 'violeta'),
  video_enviado_manual:         def('Video enviado a mano', 'smart_display', 'violeta'),
  crear_servicio_video:         def('Video de servicio creado', 'add_circle', 'verde'),
  editar_servicio_video:        def('Video de servicio editado', 'edit', 'primario'),
  eliminar_servicio_video:      def('Video de servicio eliminado', 'delete', 'rojo'),
  excluir_correo_videos:        def('Correo excluido de videos', 'unsubscribe', 'rojo'),
  reactivar_correo_videos:      def('Correo reactivado para videos', 'mark_email_read', 'verde'),
  // ── Pacientes / usuarios / catálogos ──
  crear_paciente:               def('Paciente registrado', 'person_add', 'verde'),
  editar_paciente:              def('Paciente editado', 'edit', 'primario'),
  crear_subcategoria_servicio:  def('Subcategoría creada', 'add_circle', 'verde'),
  editar_subcategoria_servicio: def('Subcategoría editada', 'edit', 'primario'),
  eliminar_subcategoria_servicio: def('Subcategoría eliminada', 'delete', 'rojo'),
  crear_cie10:                  def('Diagnóstico CIE-10 creado', 'add_circle', 'verde'),
  editar_cie10:                 def('Diagnóstico CIE-10 editado', 'edit', 'primario'),
  // ── Historia clínica ──
  ver_hc:                       def('Lectura de historia', 'visibility', 'cielo'),
  ver_receta:                   def('Lectura de receta', 'visibility', 'cielo'),
  exportar_hc:                  def('Historia exportada', 'download', 'cielo'),
  abrir_historia:               def('Historia abierta', 'folder_open', 'indigo'),
  cambiar_estado_hc:            def('Estado de la historia', 'autorenew', 'indigo'),
  abrir_atencion:               def('Atención abierta', 'clinical_notes', 'indigo'),
  cerrar_atencion:              def('Atención cerrada', 'lock', 'indigo'),
  reabrir_atencion:             def('Atención reabierta', 'lock_open', 'indigo'),
  editar_atencion:              def('Atención editada', 'edit', 'indigo'),
  guardar_dictado:              def('Dictado guardado', 'mic', 'indigo'),
  limpiar_dictado:              def('Dictado limpiado', 'mic_off', 'indigo'),
  agregar_nota:                 def('Nota de evolución', 'note_add', 'indigo'),
  editar_nota:                  def('Nota editada', 'edit_note', 'indigo'),
  eliminar_nota:                def('Nota eliminada', 'delete', 'rojo'),
  agregar_diagnostico:          def('Diagnóstico agregado', 'diagnosis', 'indigo'),
  editar_diagnostico:           def('Diagnóstico editado', 'edit', 'indigo'),
  eliminar_diagnostico:         def('Diagnóstico eliminado', 'delete', 'rojo'),
  agregar_procedimiento:        def('Procedimiento registrado', 'healing', 'indigo'),
  editar_procedimiento:         def('Procedimiento editado', 'edit', 'indigo'),
  eliminar_procedimiento:       def('Procedimiento eliminado', 'delete', 'rojo'),
  registrar_antecedente:        def('Antecedente registrado', 'history_edu', 'indigo'),
  editar_antecedente:           def('Antecedente editado', 'edit', 'indigo'),
  eliminar_antecedente:         def('Antecedente eliminado', 'delete', 'rojo'),
  registrar_alergia:            def('Alergia registrada', 'warning', 'indigo'),
  editar_alergia:               def('Alergia editada', 'edit', 'indigo'),
  eliminar_alergia:             def('Alergia eliminada', 'delete', 'rojo'),
  guardar_escala:               def('Escala clínica guardada', 'monitoring', 'indigo'),
  editar_escala:                def('Escala clínica editada', 'edit', 'indigo'),
  eliminar_escala:              def('Escala clínica eliminada', 'delete', 'rojo'),
  agregar_marca_podograma:      def('Marca en el podograma', 'footprint', 'indigo'),
  editar_marca_podograma:       def('Marca del podograma editada', 'edit', 'indigo'),
  eliminar_marca_podograma:     def('Marca del podograma eliminada', 'delete', 'rojo'),
  anotar_podograma:             def('Anotación en el podograma', 'draw', 'indigo'),
  dibujar_silueta:              def('Dibujo en la silueta', 'draw', 'indigo'),
  subir_imagen_podograma:       def('Imagen del podograma subida', 'add_photo_alternate', 'indigo'),
  reemplazar_imagen_podograma:  def('Imagen del podograma reemplazada', 'photo_library', 'indigo'),
  eliminar_imagen_podograma:    def('Imagen del podograma eliminada', 'delete', 'rojo'),
  subir_foto_clinica:           def('Foto clínica subida', 'add_a_photo', 'indigo'),
  editar_foto_clinica:          def('Foto clínica editada', 'edit', 'indigo'),
  eliminar_foto_clinica:        def('Foto clínica eliminada', 'delete', 'rojo'),
  emitir_receta:                def('Receta emitida', 'prescriptions', 'teal'),
  emitir_indicaciones:          def('Indicaciones emitidas', 'prescriptions', 'teal'),
  anular_receta:                def('Receta anulada', 'block', 'rojo'),
  verificar_receta:             def('Receta verificada (público)', 'verified', 'cielo'),
  crear_receta_favorita:        def('Receta favorita creada', 'star', 'teal'),
  eliminar_receta_favorita:     def('Receta favorita eliminada', 'delete', 'rojo'),
  emitir_constancia:            def('Constancia emitida', 'description', 'teal'),
  anular_constancia:            def('Constancia anulada', 'block', 'rojo'),
  verificar_constancia:         def('Constancia verificada (público)', 'verified', 'cielo'),
  firmar_consentimiento:        def('Consentimiento firmado', 'draw', 'teal'),
  revocar_consentimiento:       def('Consentimiento revocado', 'block', 'rojo'),
  sugerir_control:              def('Control sugerido', 'event_upcoming', 'indigo'),
  aviso_controles_coordinacion: def('Aviso de controles a coordinación', 'mail', 'violeta'),
  disparar_avisos_controles:    def('Avisos de controles disparados', 'mail', 'violeta'),
  enviar_resumen_paciente:      def('Resumen enviado al paciente', 'send', 'violeta'),
  crear_plantilla:              def('Plantilla creada', 'add_circle', 'verde'),
  editar_plantilla:             def('Plantilla editada', 'edit', 'primario'),
  eliminar_plantilla:           def('Plantilla eliminada', 'delete', 'rojo'),
  estampar_firma:               def('Firma digital estampada', 'draw', 'teal'),
  retirar_firma:                def('Firma digital retirada', 'delete', 'rojo'),
  quitar_firma:                 def('Firma digital retirada', 'delete', 'rojo'),
  import_genexis_completado:    def('Importación Genexis completada', 'download_done', 'gris'),
  import_genexis_historial_lote: def('Importación Genexis · historial', 'download', 'gris'),
  import_genexis_pacientes_lote: def('Importación Genexis · pacientes', 'download', 'gris'),
};

// Acciones GENÉRICAS (crear/editar/eliminar) que cambian de nombre según la entidad.
const ACCION_POR_ENTIDAD: Record<string, Record<string, string>> = {
  crear:    { almuerzo: 'Almuerzo creado', excepcion_horario: 'Excepción de horario creada', profesional: 'Profesional registrado', rol: 'Rol creado', usuario: 'Usuario creado', servicio: 'Servicio creado', paciente: 'Paciente registrado', sede: 'Sede creada' },
  editar:   { horario_sede: 'Horario de la sede editado', profesional: 'Profesional editado', rol: 'Rol editado', usuario: 'Usuario editado', servicio: 'Servicio editado', paciente: 'Paciente editado', sede: 'Sede editada' },
  eliminar: { almuerzo: 'Almuerzo eliminado', excepcion_horario: 'Excepción de horario eliminada', profesional: 'Profesional eliminado', rol: 'Rol eliminado', usuario: 'Usuario eliminado', servicio: 'Servicio eliminado', horario_sede: 'Horario de la sede eliminado' },
};

const ACCION_MATCHERS: { match: RegExp; style: AccionStyle }[] = [
  { match: /login|inicio_sesion/i,  style: def('Inicio de sesión', 'login', 'verde') },
  { match: /video_enviado/i,        style: def('Video enviado', 'smart_display', 'violeta') },
  { match: /pausar/i,               style: def('Pausado', 'pause_circle', 'ambar') },
  { match: /reactivar/i,            style: def('Reactivado', 'play_circle', 'verde') },
  { match: /activar/i,              style: def('Activado', 'play_circle', 'verde') },
  { match: /excluir/i,              style: def('Excluido', 'unsubscribe', 'rojo') },
  { match: /ver_|lectura/i,         style: def('Lectura', 'visibility', 'cielo') },
  { match: /emitir/i,               style: def('Emitido', 'description', 'teal') },
  { match: /anular|revocar/i,       style: def('Anulado', 'block', 'rojo') },
  { match: /crear|registrar|agregar|subir/i, style: def('Creado', 'add_circle', 'verde') },
  { match: /mover|reprogramar/i,    style: def('Reprogramado', 'swap_horiz', 'azul') },
  { match: /cambiar_estado/i,       style: def('Cambio de estado', 'autorenew', 'ambar') },
  { match: /cancelar/i,             style: def('Cancelado', 'cancel', 'rojo') },
  { match: /eliminar|borrar|quitar/i, style: def('Eliminado', 'delete', 'rojo') },
  { match: /recordatorio|correo|mail|reenviar|enviar/i, style: def('Correo', 'mail', 'violeta') },
  { match: /competencia/i,          style: def('Competencia', 'verified', 'primario') },
  { match: /excepcion|horario|turno/i, style: def('Horario', 'event_repeat', 'ambar') },
  { match: /editar|actualizar|modificar|configurar|ajustar|corregir/i, style: def('Editado', 'edit', 'primario') },
  { match: /redistribuir/i,         style: def('Redistribuido', 'shuffle', 'azul') },
];

/** «cambiar_consultorio» → «Cambiar consultorio» (último recurso para claves no mapeadas). */
function humanizar(clave: string): string {
  const t = clave.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : clave;
}

/** Devuelve chip + ícono para una acción (con la entidad afina los genéricos crear/editar/eliminar). */
export function estiloDeAccion(accion: string, entidad?: string): AccionStyle {
  const exacta = ACCION_LABEL[accion];
  const porEntidad = entidad ? ACCION_POR_ENTIDAD[accion]?.[entidad] : undefined;
  if (exacta) return porEntidad ? { ...exacta, label: porEntidad } : exacta;
  const m = ACCION_MATCHERS.find(r => r.match.test(accion));
  if (m) return porEntidad ? { ...m.style, label: porEntidad } : { ...m.style, label: humanizar(accion) };
  return def(porEntidad ?? humanizar(accion), 'history', 'gris');
}

/** Solo el texto de la acción (para los desplegables de filtro). */
export function etiquetaAccion(accion: string, entidad?: string): string {
  return estiloDeAccion(accion, entidad).label;
}

// ── Helpers de presentación ──────────────────────────────────────────────────

const INICIALES_COLORES = ['#e11d48', '#7c3aed', '#0891b2', '#65a30d', '#db2777', '#ea580c', '#f59e0b', '#0284c7'];

/** Iniciales del nombre completo + color determinista para el avatar. */
export function avatarDeUsuario(nombre?: string | null): { iniciales: string; color: string } {
  if (!nombre) return { iniciales: 'SYS', color: '#64748b' };
  const partes = nombre.trim().split(/\s+/);
  const iniciales = partes.length >= 2 ? (partes[0][0] + partes[1][0]) : partes[0].slice(0, 2);
  const hash = [...nombre].reduce((h, c) => h + c.charCodeAt(0), 0);
  const color = INICIALES_COLORES[hash % INICIALES_COLORES.length];
  return { iniciales: iniciales.toUpperCase(), color };
}

/** "hace 3 min", "hace 2 h", "ayer", "23 jul". */
export function tiempoRelativo(iso: string, ahora: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const diff = Math.floor((ahora.getTime() - t) / 1000);
  if (diff < 60) return 'hace unos seg';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ayer';
  return format(new Date(iso), 'd MMM', { locale: es });
}

// Etiqueta legible de la ENTIDAD (columna + título del resumen).
export const ENTIDAD_LABEL: Record<string, string> = {
  cita: 'Cita',
  paciente: 'Paciente',
  profesional: 'Profesional',
  servicio: 'Servicio',
  paquete: 'Paquete',
  paquete_paciente: 'Paquete del paciente',
  sede: 'Sede',
  usuario: 'Usuario',
  auth: 'Acceso',
  promocion: 'Promoción',
  canal: 'Canal',
  subcategoria: 'Subcategoría',
  subcategoria_servicio: 'Subcategoría',
  unidad_negocio: 'Unidad de negocio',
  asignacion_sede: 'Movimiento de personal',
  bloqueo_agenda: 'Bloqueo de agenda',
  almuerzo: 'Almuerzo',
  recepcionista: 'Recepcionista',
  competencia: 'Competencia',
  competencia_profesional: 'Competencia',
  combinacion_permitida: 'Combinación de servicios',
  excepcion_horario: 'Excepción de horario',
  horario_sede: 'Horario de sede',
  rol: 'Rol',
  servicio_video: 'Video de servicio',
  video_supresion: 'Correo excluido de videos',
  video_envio_log: 'Envío de video',
  dispositivo: 'Aparato del consultorio',
  tiempo_tratamiento: 'Tiempo de tratamiento',
  conciliacion_apertura: 'Conciliación Genexis',
  import_genexis_lote: 'Importación Genexis',
  analytics: 'Reportes',
  configuracion_sistema: 'Configuración',
  cie10: 'Diagnóstico CIE-10',
  historia_clinica: 'Historia clínica',
  atencion_clinica: 'Atención clínica',
  nota_evolucion: 'Nota de evolución',
  diagnostico_atencion: 'Diagnóstico',
  procedimiento_atencion: 'Procedimiento',
  escala_clinica: 'Escala clínica',
  marca_podograma: 'Marca del podograma',
  imagen_podograma: 'Imagen del podograma',
  dibujo_silueta: 'Dibujo de la silueta',
  foto_clinica: 'Foto clínica',
  receta: 'Receta',
  receta_favorita: 'Receta favorita',
  constancia: 'Constancia',
  consentimiento: 'Consentimiento',
  control_sugerido: 'Control sugerido',
  plantilla_clinica: 'Plantilla clínica',
  firma_profesional: 'Firma digital',
};

/** Etiqueta amigable de la entidad ("Movimiento", "Almuerzo"…) o la clave humanizada si no está mapeada. */
export function etiquetaEntidad(entidad: string): string {
  return ENTIDAD_LABEL[entidad] ?? humanizar(entidad);
}

// ── Valores legibles ─────────────────────────────────────────────────────────
export const ESTADO_CITA_LABEL: Record<string, string> = {
  agendada: 'Agendada', confirmada: 'Confirmada', llego: 'Llegó', en_atencion: 'En atención',
  completada: 'Completada', no_show: 'No vino', cancelada: 'Cancelada', reprogramada: 'Reprogramada',
};

// Valores enum traducidos (independientes del campo).
const VALOR_LABEL: Record<string, string> = {
  ...ESTADO_CITA_LABEL,
  pendiente: 'Pendiente',
  elegida_por_paciente: 'Elegida por el paciente',
  asignada_automaticamente: 'Asignada por recepción',
  PRINCIPAL: 'Principal (1.º tratamiento)', SECUNDARIO: 'Secundario (2.º tratamiento)',
  ANTES: 'Antes', DESPUES: 'Después',
  HORAS: 'Horas', DIAS: 'Días', MESES: 'Meses', ANIOS: 'Años',
  RESERVA: 'Correo de reserva', RECORDATORIO: 'Recordatorio', reserva: 'Correo de reserva', recordatorio: 'Recordatorio',
  PROGRAMADO: 'Programado', ENVIADO: 'Enviado', FALLIDO: 'Falló', CANCELADO: 'Cancelado',
  ALMUERZO: 'Almuerzo', CAPACITACION: 'Capacitación', PERMISO: 'Permiso', OTRO: 'Otro',
  podologa: 'Podóloga', fisioterapeuta: 'Fisioterapeuta', medico: 'Médico',
  admin: 'Administrador', coordinadora_sedes: 'Coordinadora de sedes', recepcionista: 'Recepción', contact_center: 'Contact center',
  ACTIVO: 'Activo', ANULADO: 'Anulado', VENCIDO: 'Vencido', AGOTADO: 'Agotado',
  CITA: 'Por cita', APERTURA: 'Apertura Genexis', MANUAL: 'Manual',
  PRECIO_FIJO: 'Precio fijo', PORCENTAJE: 'Porcentaje', MONTO: 'Monto de descuento',
  VACACIONES: 'Vacaciones', REFUERZO: 'Refuerzo', REEMPLAZO: 'Reemplazo', ROTACION: 'Rotación',
  correo_paciente: 'Enlace del correo (paciente)', token_correo: 'Enlace del correo (paciente)',
  correo_reserva: 'Correo de reserva', correo_recordatorio: 'Correo de recordatorio',
  movimiento_profesional: 'Movimiento de personal', enfermedad_profesional: 'Enfermedad del profesional',
  dispositivo: 'Aparato del consultorio', sistema: 'Sistema',
  usuario_inexistente: 'Correo no registrado', usuario_inactivo: 'Cuenta inactiva', password_incorrecto: 'Contraseña incorrecta',
  en_curso: 'En curso', finalizado: 'Finalizado', sin_fin: 'Sin FIN', descartado: 'Descartado',
};

// Campos cuyo valor es SOLO FECHA (se muestran dd/MM/yyyy aunque lleguen como fecha-hora anclada).
const CAMPOS_SOLO_FECHA = new Set(['fecha', 'fechaNacimiento', 'fechaInicio', 'fechaFin', 'fechaVencimiento', 'fechaCompra', 'vigenciaHasta', 'vigenciaDesde', 'fechaFinRestaurada', 'eliminadoDesde', 'reprogramadaDe']);
// Campos que no le dicen nada a una persona (claves técnicas) → no se listan en los cambios.
const CAMPOS_OCULTOS = new Set(['id', 'idempotencyKey', 'contenidoReservado', 'comentarioId', 'resendEmailId', 'cerroAsignacionId', 'creadoEn', 'actualizadoEn', 'tokenHash', 'tokenPrefijo', 'passwordHash']);
// Campos con un UUID que NO se resuelve a nombre pero significan «sí, forma parte de…».
const CAMPOS_BANDERA = new Set(['slotGrupoId', 'bloque']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function fechaLegible(v: string, soloFecha: boolean): string | null {
  if (!ISO_RE.test(v) || isNaN(Date.parse(v))) return null;
  // "YYYY-MM-DD", o un campo de solo-fecha anclado a mediodía/medianoche UTC (@db.Date) → sin hora.
  if (v.length === 10 || (soloFecha && /T(12|00):00:00(\.000)?Z$/.test(v))) {
    const [y, m, d] = v.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return format(new Date(v), 'dd/MM/yyyy HH:mm');
}

/**
 * Renderiza un valor del diff en palabras: UUID conocido → nombre; fecha → dd/MM/yyyy (con hora si la
 * tiene); enum → etiqueta; booleano → Sí/No; catálogo (canal…) → su etiqueta configurada.
 */
export function renderValor(v: unknown, nombresPorId: Record<string, string>, campo?: string, legibles: ValoresLegibles = {}): string {
  if (v === undefined || v === null || v === '') return '—';
  if (v instanceof Date) return format(v, 'dd/MM/yyyy HH:mm');
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString('es-PE', { maximumFractionDigits: 2 });
  if (typeof v === 'string') {
    const f = fechaLegible(v, !!campo && CAMPOS_SOLO_FECHA.has(campo));
    if (f) return f;
    if (UUID_RE.test(v)) {
      if (campo && CAMPOS_BANDERA.has(campo)) return 'Sí';
      return nombresPorId[v] ?? 'Registro no disponible';
    }
    if (campo && legibles[campo]?.[v]) return legibles[campo][v];
    if (VALOR_LABEL[v]) return VALOR_LABEL[v];
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return 'Ninguno';
    if (v.every((x) => typeof x !== 'object' || x === null)) return v.map((x) => renderValor(x, nombresPorId, campo, legibles)).join(', ');
    return v.map((x) => renderValor(x, nombresPorId, undefined, legibles)).join(' · ');
  }
  if (typeof v === 'object') {
    // Objeto anidado: «campo: valor» separados por " · " (p. ej. composición de una membresía).
    return Object.entries(v as Record<string, unknown>)
      .filter(([k, x]) => !CAMPOS_OCULTOS.has(k) && x !== null && x !== undefined && !(typeof k === 'string' && /Id$/.test(k) && typeof x === 'string' && UUID_RE.test(x) && !nombresPorId[x]))
      .map(([k, x]) => `${etiquetaCampo(k)}: ${renderValor(x, nombresPorId, k, legibles)}`)
      .join(' · ') || '—';
  }
  return String(v);
}

/** Estado de cita → palabra ("llego" → "Llegó"). */
export function etiquetaEstadoCita(estado?: string | null): string {
  if (!estado) return '—';
  return ESTADO_CITA_LABEL[estado] ?? humanizar(estado);
}

// Fecha de la cita (viene como "YYYY-MM-DD" o ISO) → "18 sep".
function fechaCorta(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return format(new Date(y, m - 1, d), "d MMM", { locale: es });
}

const UNIDAD_PALABRA: Record<string, string> = { HORAS: 'h', DIAS: 'días', MESES: 'meses', ANIOS: 'años' };
/** "Antes · 24 h", "Después · 2 días" — para el resumen de un video. */
function etiquetaMomentoAudit(momento?: string, valor?: number, unidad?: string): string | undefined {
  if (!momento) return undefined;
  const m = momento === 'ANTES' ? 'Antes' : 'Después';
  if (valor && unidad) return `${m} · ${valor} ${UNIDAD_PALABRA[unidad] ?? unidad.toLowerCase()}`;
  return m;
}

/** Qué pasó con la CITA, en una frase (según la acción). */
function detalleCita(log: AuditLog, nombresPorId: Record<string, string>, legibles: ValoresLegibles): string | undefined {
  const a = (log.antes || {}) as Record<string, unknown>;
  const d = (log.despues || {}) as Record<string, unknown>;
  const nombre = (id: unknown) => (typeof id === 'string' ? nombresPorId[id] : undefined);
  const val = (campo: string, v: unknown) => renderValor(v, nombresPorId, campo, legibles);
  const motivo = (d.motivoCancelacion ?? d.motivo ?? a.motivo) as string | undefined;
  const cascada = d.cascada ? ' · aplicado al bloque combinado' : '';

  switch (log.accion) {
    case 'crear': case 'agendar': case 'crear_retroactiva': {
      const partes = [
        d.servicioId ? val('servicioId', d.servicioId) : undefined,
        d.subcategoriaId ? val('subcategoriaId', d.subcategoriaId) : undefined,
        nombre(d.profesionalId) ? `con ${nombre(d.profesionalId)}` : undefined,
        d.canal ? `canal ${val('canal', d.canal)}` : undefined,
        d.paquetePacienteId ? `sesión ${d.sesionNumero ?? '?'} de ${val('paquetePacienteId', d.paquetePacienteId)}` : undefined,
        d.promocionId ? `promoción ${val('promocionId', d.promocionId)}` : undefined,
        d.slotRol ? val('slotRol', d.slotRol) : undefined,
      ].filter(Boolean);
      if (log.accion === 'crear_retroactiva') {
        const dias = a.diasAtras as number | undefined;
        partes.push(dias ? `retroactiva · ${dias} día${dias === 1 ? '' : 's'} atrás` : 'retroactiva');
        if (a.motivo) partes.push(String(a.motivo));
      }
      return partes.join(' · ') || undefined;
    }
    case 'cambiar_estado': case 'auto_completar': case 'cancelar': case 'cancelar_por_paciente':
    case 'cancelar_por_movimiento': case 'reprogramar_por_movimiento': case 'cancelar_por_enfermedad':
    case 'ESTADO_CAMBIADO_POR_MOVIMIENTO': case 'ENFERMEDAD_CANCELAR_CITA': case 'confirmar_por_paciente': {
      const paso = a.estado || d.estado ? `${etiquetaEstadoCita(a.estado as string)} → ${etiquetaEstadoCita(d.estado as string)}` : undefined;
      const origen = d.origen ? val('origen', d.origen) : undefined;
      const conf = !paso && d.estadoConfirmacion ? `Confirmación: ${val('estadoConfirmacion', d.estadoConfirmacion)}` : undefined;
      return [paso ?? conf, motivo, origen].filter(Boolean).join(' · ') + cascada || undefined;
    }
    case 'mover': {
      const de = [fechaCorta(a.fecha as string), a.horaInicio].filter(Boolean).join(' ');
      const hasta = [fechaCorta(d.fecha as string), d.horaInicio].filter(Boolean).join(' ');
      const profA = nombre(a.profesionalId), profD = nombre(d.profesionalId);
      const prof = profA && profD && profA !== profD ? `${profA} → ${profD}` : profD;
      const medico = d.medicoSoltado ? `se soltó al médico ${nombre(d.medicoSoltado) ?? ''}`.trim() : undefined;
      return [`${de} → ${hasta}`, prof, medico, d.bloque ? 'bloque combinado' : undefined].filter(Boolean).join(' · ');
    }
    case 'cambiar_consultorio':
      return `Consultorio ${val('consultorioNumero', a.consultorioNumero)} → ${val('consultorioNumero', d.consultorioNumero)}${cascada}`;
    case 'editar_canal':
      return `Canal ${val('canal', a.canal)} → ${val('canal', d.canal)}`;
    case 'editar_promocion':
      return `Promoción ${val('promocionId', a.promocionId)} → ${val('promocionId', d.promocionId)}`;
    case 'agregar_comentario':
      return d.texto ? `«${String(d.texto)}»` : undefined;
    case 'asignar_medico': case 'tomar_cita_medico': case 'soltar_cita_medico': {
      const de = (a.medico as string) || nombre(a.medicoId) || 'sin médico';
      const hasta = (d.medico as string) || nombre(d.medicoId) || 'sin médico';
      return `Médico: ${de} → ${hasta}`;
    }
    case 'recordatorio_enviado': case 'recordatorio_reserva_enviado':
      return d.destinatario ? `a ${d.destinatario}` : undefined;
    case 'recordatorio_reenvio_manual': case 'reenviar_confirmacion_correo':
      return d.to ? `a ${d.to}` : undefined;
    case 'confirmar_recordatorio':
      return 'Confirmó desde el correo de recordatorio';
    case 'click_reprogramar':
      return 'Pidió reprogramar desde el correo (se derivó a WhatsApp)';
    case 'ajustar_hora_atencion': case 'ajustar_hora_completada':
      return [a.hora ?? a.enAtencionEn ?? a.completadaEn, d.hora ?? d.enAtencionEn ?? d.completadaEn].map((x) => val('hora', x)).join(' → ');
    default:
      return undefined;
  }
}

/**
 * Resumen humano de la acción (una línea). Usa `nombresPorId` (resuelto server-side)
 * para mostrar nombres en vez de UUIDs — incluido el entidadId principal del log.
 */
export function resumenLog(log: AuditLog, nombresPorId: Record<string, string> = {}, legibles: ValoresLegibles = {}): { titulo: string; subtitulo?: string } {
  const contexto = (log.despues || log.antes || {}) as Record<string, unknown>;
  const etiqueta = etiquetaEntidad(log.entidad);
  const val = (campo: string, v: unknown) => renderValor(v, nombresPorId, campo, legibles);

  // Intento de sesión FALLIDO (fuerza bruta / credencial equivocada)
  if (log.accion.toUpperCase() === 'LOGIN_FALLIDO') {
    const email = (contexto.email as string) || log.usuario?.email || '—';
    const motivo = VALOR_LABEL[contexto.motivo as string] ?? (contexto.motivo as string) ?? 'credenciales inválidas';
    return { titulo: `Intento de sesión fallido · ${email}`, subtitulo: motivo };
  }

  // Login / Inicio de sesión
  if (log.accion.toLowerCase().includes('login') || (log.entidad === 'usuario' && log.accion.toUpperCase() === 'LOGIN')) {
    const usrNombre = log.usuario?.nombre || (contexto.nombre as string) || 'Usuario';
    const email = log.usuario?.email || (contexto.email as string);
    const rol = log.usuario?.rol || (contexto.rol as string);
    const subtitulo = [email, rol ? val('rol', rol) : undefined].filter(Boolean).join(' · ');
    return { titulo: `Inicio de sesión · ${usrNombre}`, subtitulo: subtitulo || undefined };
  }

  // Cita — se muestra con datos del paciente (join server-side) y una frase de lo que pasó.
  if (log.entidad === 'cita' && log.cita) {
    const p = log.cita.paciente;
    const nombrePac = `${p.nombres.split(' ')[0]} ${p.apellidoPaterno}`;
    const cuando = [fechaCorta(log.cita.fecha), log.cita.horaInicio].filter(Boolean).join(' ');
    const prof = log.cita.profesional ? `${log.cita.profesional.nombres.split(' ')[0]} ${log.cita.profesional.apellidos.split(' ')[0]}` : null;
    const servicio = log.cita.servicio?.nombre;
    const base = [servicio, prof].filter(Boolean).join(' · ');
    const detalle = detalleCita(log, nombresPorId, legibles);
    // Para crear/agendar el detalle ya trae servicio y profesional: no repetir.
    const subtitulo = ['crear', 'agendar', 'crear_retroactiva'].includes(log.accion)
      ? (detalle || base)
      : [base, detalle].filter(Boolean).join(' — ');
    return { titulo: `Cita de ${nombrePac} · ${cuando}`, subtitulo: subtitulo || undefined };
  }
  if (log.entidad === 'cita') {
    // Cita ya borrada de la base (no se pudo unir): igual se muestra lo que pasó.
    return { titulo: 'Cita (ya no existe)', subtitulo: detalleCita(log, nombresPorId, legibles) };
  }

  // Almuerzo / bloqueo — resuelve la profesional del payload y muestra la hora.
  if (log.entidad === 'almuerzo' || log.entidad === 'bloqueo_agenda') {
    const profId = contexto.profesionalId as string | undefined;
    const profNombre = (profId ? nombresPorId[profId] : undefined) ?? nombresPorId[log.entidadId];
    const hora = contexto.horaInicio as string | undefined;
    const fecha = fechaCorta(contexto.fecha as string | undefined);
    const extra = [
      fecha,
      hora ? `${hora}${contexto.horaFin ? ` – ${contexto.horaFin}` : ''}` : undefined,
      contexto.motivo as string | undefined,
      typeof contexto.citasCanceladas === 'number' ? `${contexto.citasCanceladas} cita(s) cancelada(s)` : undefined,
      typeof contexto.dias === 'number' ? `${contexto.dias} día(s)` : undefined,
      contexto.esRecurrente === true ? 'todos los días' : undefined,
    ].filter(Boolean).join(' · ');
    return { titulo: profNombre ? `${etiqueta} de ${profNombre}` : etiqueta, subtitulo: extra || undefined };
  }

  // Excepción de horario — sede + fecha + estado (abierto/cerrado).
  if (log.entidad === 'excepcion_horario') {
    const sedeNombre = log.sede?.nombre;
    const fecha = fechaCorta(contexto.fecha as string | undefined);
    const abierto = contexto.abierto as boolean | undefined;
    const estado = abierto === false ? 'Cerrado' : abierto === true ? `Abierto ${contexto.horaApertura ?? ''}–${contexto.horaCierre ?? ''}` : '';
    return {
      titulo: sedeNombre ? `Excepción · ${sedeNombre}` : 'Excepción de horario',
      subtitulo: [fecha, estado, contexto.nota as string | undefined, contexto.vuelveAlHorarioNormal ? 'vuelve al horario normal' : undefined].filter(Boolean).join(' · ') || undefined,
    };
  }

  // Cambio del horario base de la sede.
  if (log.entidad === 'horario_sede') {
    const sedeNombre = nombresPorId[log.entidadId] || log.sede?.nombre;
    return { titulo: sedeNombre ? `Horario · ${sedeNombre}` : 'Horario de sede', subtitulo: 'Horario semanal actualizado' };
  }

  // Movimiento (asignacion_sede) — profesional + sede destino + fechas.
  if (log.entidad === 'asignacion_sede') {
    const profId = contexto.profesionalId as string | undefined;
    const sedeId = contexto.sedeId as string | undefined;
    const profNombre = (profId ? nombresPorId[profId] : undefined) ?? nombresPorId[log.entidadId];
    const sedeNombre = sedeId ? nombresPorId[sedeId] : undefined;
    const sedeAnt = (log.antes as Record<string, unknown> | null)?.sedeAnterior as string | undefined;
    const rango = [fechaCorta(contexto.fechaInicio as string), fechaCorta(contexto.fechaFin as string)].filter(Boolean).join(' → ');
    const partes = [
      sedeNombre ? `${sedeAnt && nombresPorId[sedeAnt] ? `${nombresPorId[sedeAnt]} → ` : ''}${sedeNombre}` : undefined,
      rango || undefined,
      contexto.motivo ? val('motivo', contexto.motivo) : undefined,
      contexto.eliminado ? 'movimiento eliminado' : undefined,
    ].filter(Boolean);
    return { titulo: profNombre ? `Movimiento de ${profNombre}` : 'Movimiento de personal', subtitulo: partes.join(' · ') || undefined };
  }

  // Profesional: acciones de baro / día especial / presencia.
  if (log.entidad === 'profesional') {
    const nombreProf = nombresPorId[log.entidadId] || [contexto.nombres, contexto.apellidos].filter(Boolean).join(' ') || 'Profesional';
    const partes = [
      contexto.sede as string | undefined,
      contexto.sedeId ? val('sedeId', contexto.sedeId) : undefined,
      fechaCorta(contexto.fecha as string | undefined),
      contexto.horaInicio as string | undefined,
      contexto.viene === true ? 'viene' : contexto.viene === false ? 'no viene' : undefined,
      contexto.presente === true ? 'presente' : contexto.presente === false ? 'ausente' : undefined,
      typeof contexto.quedanSedes === 'number' ? `quedan ${contexto.quedanSedes} sede(s)` : undefined,
    ].filter(Boolean);
    return { titulo: `${nombreProf}`, subtitulo: partes.join(' · ') || undefined };
  }

  // Video de servicio (crear/editar/pausar/activar/eliminar).
  if (log.entidad === 'servicio_video') {
    const titulo = nombresPorId[log.entidadId] || (contexto.tituloVideo as string) || 'Video';
    const servicioNombre = contexto.servicioId ? nombresPorId[contexto.servicioId as string] : undefined;
    const mom = etiquetaMomentoAudit(contexto.momento as string | undefined, contexto.offsetValor as number | undefined, contexto.offsetUnidad as string | undefined);
    return { titulo: `Video · ${titulo}`, subtitulo: [servicioNombre, mom].filter(Boolean).join(' · ') || undefined };
  }

  // Correo excluido / reactivado de la lista de videos.
  if (log.entidad === 'video_supresion') {
    const email = (contexto.email as string) || nombresPorId[log.entidadId] || 'correo';
    const reactivado = log.accion.toLowerCase().includes('reactivar');
    return { titulo: `${reactivado ? 'Correo reactivado' : 'Correo excluido'} · ${email}`, subtitulo: (contexto.motivo as string) || undefined };
  }

  // Envío de video a un paciente (automático o manual).
  if (log.entidad === 'video_envio_log') {
    const nombrePac = log.cita ? `${log.cita.paciente.nombres.split(' ')[0]} ${log.cita.paciente.apellidoPaterno}` : (contexto.destinatario as string) || 'paciente';
    const manual = log.accion.toLowerCase().includes('manual');
    const mom = (contexto.momento as string) === 'ANTES' ? 'Antes' : (contexto.momento as string) === 'DESPUES' ? 'Después' : undefined;
    const veces = contexto.vecesEnviado as number | undefined;
    return {
      titulo: `Video enviado a ${nombrePac}`,
      subtitulo: [mom, manual ? 'envío manual' : 'envío automático', veces ? `${veces}° envío` : undefined].filter(Boolean).join(' · ') || undefined,
    };
  }

  // Paquete del paciente (sesiones / membresías vendidas).
  if (log.entidad === 'paquete_paciente') {
    const paquete = nombresPorId[log.entidadId] || (contexto.membresia as string) || 'Paquete';
    const pac = contexto.pacienteId ? nombresPorId[contexto.pacienteId as string] : undefined;
    const partes = [
      pac ? `de ${pac}` : undefined,
      typeof contexto.numeroSesion === 'number' ? `sesión ${contexto.numeroSesion}` : undefined,
      typeof contexto.saldo === 'number' ? `saldo ${contexto.saldo}` : undefined,
      contexto.vigencia as string | undefined,
      contexto.sedeId ? val('sedeId', contexto.sedeId) : undefined,
    ].filter(Boolean);
    return { titulo: paquete, subtitulo: partes.join(' · ') || undefined };
  }

  // Resto (servicio/paquete/sede/usuario/etc): usa el nombre del entidadId o del payload.
  const nombreEntidad =
    nombresPorId[log.entidadId] ||
    (contexto.nombre as string) ||
    (contexto.titulo as string) ||
    (contexto.label as string) ||
    (contexto.email as string) ||
    null;
  if (nombreEntidad) return { titulo: `${etiqueta} · ${nombreEntidad}` };
  return { titulo: etiqueta };
}

/**
 * Formatea la IP para mostrar. Las loopback (`::1`, `127.0.0.1`, IPv4-mapped)
 * significan "la petición vino desde la propia máquina servidor" → se muestran
 * como "Servidor local" para que no se confundan con una IP real de la LAN.
 */
export function formatIp(ip?: string | null): { texto: string; esLocal: boolean } {
  if (!ip) return { texto: '—', esLocal: false };
  const limpia = ip.replace(/^::ffff:/, '');
  if (limpia === '::1' || limpia === '127.0.0.1' || ip === '::1') {
    return { texto: 'Servidor local', esLocal: true };
  }
  return { texto: limpia, esLocal: false };
}

/** Parsea el userAgent en algo legible (Chrome 141 · macOS). */
export function parseUserAgent(ua?: string | null): string {
  if (!ua) return '—';
  let browser = 'Navegador';
  const chr = ua.match(/Chrome\/(\d+)/);
  const fir = ua.match(/Firefox\/(\d+)/);
  const saf = ua.match(/Version\/(\d+).*Safari/);
  if (chr) browser = `Chrome ${chr[1]}`;
  else if (fir) browser = `Firefox ${fir[1]}`;
  else if (saf) browser = `Safari ${saf[1]}`;

  let os = '';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';

  return os ? `${browser} · ${os}` : browser;
}

export interface DiffRow {
  campo: string;
  antes: unknown;
  despues: unknown;
  tipo: 'add' | 'remove' | 'change';
}

// ── Nombres legibles (Alias) para los campos técnicos ─────────────────────────
export const CAMPO_LABEL: Record<string, string> = {
  id: 'ID',
  sedeId: 'Sede',
  sedeAnterior: 'Sede anterior',
  sedeAnteriorId: 'Sede anterior',
  pacienteId: 'Paciente',
  profesionalId: 'Profesional',
  medicoId: 'Médico de la cita',
  medico: 'Médico de la cita',
  medicoSoltado: 'Médico que se soltó',
  medicoAsignadoPorId: 'Médico asignado por',
  servicioId: 'Servicio',
  subcategoriaId: 'Subcategoría',
  unidadNegocioId: 'Unidad de negocio',
  solicitadoProfesionalId: 'Médico solicitado (baro)',
  creadoPorUsuarioId: 'Creado por',
  creadoPor: 'Creado por',
  createdBy: 'Creado por',
  usuarioId: 'Usuario',
  paqueteId: 'Paquete',
  paquetePacienteId: 'Paquete del paciente',
  promocionId: 'Promoción',
  canalId: 'Canal',
  citaId: 'Cita',
  creadoEn: 'Creado',
  actualizadoEn: 'Actualizado',
  deletedAt: 'Eliminado el',
  fecha: 'Fecha',
  horaInicio: 'Hora de inicio',
  horaFin: 'Hora de fin',
  duracionMinutos: 'Duración (min)',
  estado: 'Estado',
  estadoConfirmacion: 'Confirmación del paciente',
  confirmacionEnviadaEn: 'Confirmación enviada',
  confirmadaEn: 'Confirmado el',
  llegoEn: 'Llegó a las',
  enAtencionEn: 'En atención desde',
  completadaEn: 'Completada a las',
  canal: 'Canal',
  origen: 'Origen',
  origenAsignacion: 'Asignación del profesional',
  slotGrupoId: 'Bloque combinado',
  bloque: 'Bloque combinado',
  slotRol: 'Rol en el bloque',
  cascada: 'Aplicado también a la otra cita del bloque',
  sesionConsumida: 'Sesión consumida',
  sesionExonerada: 'Sesión no descontada',
  sesionExoneradaMotivo: 'Motivo de no descuento',
  sesionNumero: 'N.° de sesión',
  numeroSesion: 'N.° de sesión',
  saldo: 'Saldo de sesiones',
  auto: 'Automático',
  consultorioNumero: 'Consultorio',
  comprobanteUrl: 'Comprobante',
  idempotencyKey: 'Clave de idempotencia',
  observaciones: 'Observaciones',
  comentarios: 'Comentarios',
  texto: 'Texto',
  nota: 'Nota',
  notas: 'Notas',
  motivo: 'Motivo',
  motivoCancelacion: 'Motivo de cancelación',
  motivoRetroactivo: 'Motivo (fecha pasada)',
  retroactiva: 'Agendada en fecha pasada',
  diasAtras: 'Días atrás',
  contexto: 'Contexto',
  monto: 'Monto',
  montoFinal: 'Monto final',
  precioLista: 'Precio de lista',
  precio: 'Precio',
  descuento: 'Descuento',
  precioFinal: 'Precio final',
  activo: 'Activo',
  activa: 'Activa',
  nombre: 'Nombre',
  nombres: 'Nombres',
  apellidos: 'Apellidos',
  apellidoPaterno: 'Apellido paterno',
  apellidoMaterno: 'Apellido materno',
  email: 'Correo electrónico',
  emailAgenda: 'Correo de agenda',
  telefono: 'Teléfono',
  documento: 'N.° de documento',
  tipoDocumento: 'Tipo de documento',
  fechaNacimiento: 'Fecha de nacimiento',
  genero: 'Género',
  direccion: 'Dirección',
  distrito: 'Distrito',
  color: 'Color',
  colorAvatar: 'Color en la agenda',
  rol: 'Rol',
  tipo: 'Tipo',
  orden: 'Orden',
  ordenAgenda: 'Orden en la agenda',
  etiqueta: 'Etiqueta',
  valor: 'Valor',
  fechaInicio: 'Desde',
  fechaFin: 'Hasta',
  esRecurrente: 'Todos los días',
  esVacaciones: 'Vacaciones',
  esEnfermedad: 'Enfermedad',
  esPrestamo: 'Préstamo',
  dias: 'Días',
  citasCanceladas: 'Citas canceladas',
  citasConAtencionNoCanceladas: 'Citas ya atendidas (no canceladas)',
  eliminado: 'Eliminado',
  eliminadoDesde: 'Eliminado desde',
  vuelveAlHorarioNormal: 'Vuelve al horario normal',
  abierto: 'Abierto',
  horaApertura: 'Apertura',
  horaCierre: 'Cierre',
  horario: 'Horario semanal',
  diaSemana: 'Día de la semana',
  viene: 'Viene',
  presente: 'Presente',
  esDeLaSede: 'Es de la sede',
  quedanSedes: 'Sedes en las que queda',
  competenciasDesactivadas: 'Competencias desactivadas',
  sede: 'Sede',
  soloPorSolicitud: 'Solo por solicitud',
  colegiatura: 'Colegiatura (CMP)',
  metaDiasMes: 'Meta de días al mes',
  esEquipo: 'Es un equipo (máquina)',
  unidadNegocio: 'Unidad de negocio',
  destinatario: 'Destinatario',
  to: 'Destinatario',
  enviadaEn: 'Enviado el',
  // Videos por servicio
  servicioVideoId: 'Video',
  youtubeVideoId: 'ID de YouTube',
  youtubeUrl: 'Enlace de YouTube',
  tituloVideo: 'Título del video',
  titulo: 'Título',
  asunto: 'Asunto del correo',
  cuerpoTexto: 'Texto del correo',
  momento: 'Momento',
  offsetValor: 'Tiempo (valor)',
  offsetUnidad: 'Tiempo (unidad)',
  resendEmailId: 'ID de correo (Resend)',
  vecesEnviado: 'Veces enviado',
  enviadoManualPor: 'Enviado manualmente por',
  enviosCancelados: 'Envíos cancelados',
  // Membresías / paquetes
  membresia: 'Membresía',
  composicion: 'Composición',
  cantidad: 'Cantidad',
  vigencia: 'Vigencia',
  sesionesTotal: 'Sesiones en total',
  sesionAdjudicada: 'Sesión adjudicada',
  aperturaConsumidas: 'Sesiones de apertura consumidas',
  campos: 'Campos',
  contrato: 'Archivo del contrato',
  restauradoExacto: 'Restaurado tal cual',
  fechaFinRestaurada: 'Fecha de fin restaurada',
  predecesorRestaurado: 'Movimiento anterior restaurado',
  // Aparato del consultorio
  dispositivo: 'Aparato',
  hora: 'Hora',
};

/** Devuelve la etiqueta amigable del campo (o una versión limpia si no está mapeado). */
export function etiquetaCampo(campo: string): string {
  if (CAMPO_LABEL[campo]) return CAMPO_LABEL[campo];
  return humanizar(campo.replace(/Id$/, ''));
}

/** Compara `antes` vs `despues` y devuelve las filas de la tabla de cambios (sin claves técnicas). */
export function calcularDiff(antes: Record<string, unknown> | null, despues: Record<string, unknown> | null): DiffRow[] {
  const rows: DiffRow[] = [];
  const claves = new Set([...Object.keys(antes ?? {}), ...Object.keys(despues ?? {})]);
  for (const k of claves) {
    if (CAMPOS_OCULTOS.has(k)) continue;
    // «medicoId» sobra si el mismo payload ya trae «medico» con el nombre.
    if (/Id$/.test(k) && claves.has(k.replace(/Id$/, ''))) continue;
    const a = antes?.[k];
    const d = despues?.[k];

    // Omitir si ambos son nulos o indefinidos
    if ((a === null || a === undefined) && (d === null || d === undefined)) continue;

    // Omitir campos que nacen con null en despues (ruido de esquema Prisma al crear registros)
    if (a === undefined && d === null) continue;

    const jsonA = JSON.stringify(a);
    const jsonD = JSON.stringify(d);
    if (jsonA === jsonD) continue;

    // Si ambos valores se renderizan exactamente igual (ej: '—'), omitir la fila
    const renderA = renderValor(a, {}, k);
    const renderD = renderValor(d, {}, k);
    if (renderA === renderD) continue;

    if (a === undefined) rows.push({ campo: k, antes: undefined, despues: d, tipo: 'add' });
    else if (d === undefined || d === null) rows.push({ campo: k, antes: a, despues: d, tipo: 'remove' });
    else rows.push({ campo: k, antes: a, despues: d, tipo: 'change' });
  }
  return rows;
}

// ── Hook principal ───────────────────────────────────────────────────────────
export function useAuditoriaData() {
  const hoy = format(new Date(), 'yyyy-MM-dd');
  const hace7 = format(new Date(Date.now() - 7 * 86_400_000), 'yyyy-MM-dd');

  const [desde, setDesde] = useState(hace7);
  const [hasta, setHasta] = useState(hoy);
  const [entidad, setEntidad] = useState('');
  const [accion, setAccion] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  const params: Record<string, string> = { desde, hasta, page: String(page), limit: String(limit) };
  if (entidad) params.entidad = entidad;
  if (accion) params.accion = accion;
  if (usuarioId) params.usuarioId = usuarioId;
  if (sedeId) params.sedeId = sedeId;
  if (q.trim()) params.q = q.trim();

  const { data: logsResp, isLoading } = useQuery<AuditLogsResponse>({
    queryKey: ['audit', params],
    queryFn: () => api.get<AuditLogsResponse>('/audit', params),
  });

  const { data: stats } = useQuery<AuditStats>({
    queryKey: ['audit-stats'],
    queryFn: () => api.get<AuditStats>('/audit/stats'),
    refetchInterval: 30_000,
  });

  const { data: facetas } = useQuery<AuditFacetas>({
    queryKey: ['audit-facetas'],
    queryFn: () => api.get<AuditFacetas>('/audit/facetas'),
    staleTime: 5 * 60_000,
  });

  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });

  // Reset a página 1 cuando cambia cualquier filtro (excepto page).
  const resetPage = () => setPage(1);

  const nombresPorId = logsResp?.nombresPorId ?? {};
  const valoresLegibles = logsResp?.valoresLegibles ?? {};

  // Opciones de los desplegables, con su NOMBRE en español y ordenadas por ese nombre.
  const opcionesAccion = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const a of facetas?.acciones ?? []) vistos.set(a, etiquetaAccion(a));
    return [...vistos.entries()].map(([valor, label]) => ({ valor, label })).sort((x, y) => x.label.localeCompare(y.label, 'es'));
  }, [facetas]);
  const opcionesEntidad = useMemo(
    () => (facetas?.entidades ?? []).map((e) => ({ valor: e, label: etiquetaEntidad(e) })).sort((x, y) => x.label.localeCompare(y.label, 'es')),
    [facetas],
  );

  return {
    nombresPorId,
    valoresLegibles,
    opcionesAccion,
    opcionesEntidad,
    // Filtros + setters
    desde, setDesde: (v: string) => { setDesde(v); resetPage(); },
    hasta, setHasta: (v: string) => { setHasta(v); resetPage(); },
    entidad, setEntidad: (v: string) => { setEntidad(v); resetPage(); },
    accion, setAccion: (v: string) => { setAccion(v); resetPage(); },
    usuarioId, setUsuarioId: (v: string) => { setUsuarioId(v); resetPage(); },
    sedeId, setSedeId: (v: string) => { setSedeId(v); resetPage(); },
    q, setQ: (v: string) => { setQ(v); resetPage(); },
    page, setPage,
    // Data
    logs: logsResp?.data ?? [],
    total: logsResp?.total ?? 0,
    totalPages: logsResp?.totalPages ?? 0,
    limit,
    isLoading,
    stats,
    facetas,
    sedes: sedes ?? [],
    // Helpers (re-exportados para conveniencia)
    resetFiltros: () => {
      setDesde(hace7); setHasta(hoy); setEntidad(''); setAccion('');
      setUsuarioId(''); setSedeId(''); setQ(''); setPage(1);
    },
    // Estado derivado: hay algún filtro activo (más allá del rango de fechas por defecto)
    hayFiltroActivo: useMemo(
      () => Boolean(entidad || accion || usuarioId || sedeId || q.trim()),
      [entidad, accion, usuarioId, sedeId, q],
    ),
  };
}
