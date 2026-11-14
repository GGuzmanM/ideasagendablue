import { urlArchivo } from '../../utils/urlArchivo';
import { ESTADOS_PAGO } from '../../utils/estadoPago';
import { calcularEdad } from '../../services/pacientesService';
import { formatoNumeroCita } from '@limablue/shared';
import React from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  useIdea1DetalleCita,
  type UseIdea1DetalleCitaProps,
  estadosPermitidos,
  esCambioEspecial,
} from '../../services/idea1DetalleCitaService';
import { DialogoConsumo, SaldoPaquetes } from '../pacientes/SaldoPaquetes';
import { BotonHistorialGenexis } from '../pacientes/HistorialGenexis';
import { RomboAlerta } from '../pacientes/RomboAlerta';
import { CuadroFamiliares } from '../pacientes/CuadroFamiliares';
import { ToggleDatosPaciente } from '../pacientes/ToggleDatosPaciente';
import { BadgeAsistencia } from '../pacientes/BadgeAsistencia';
import { FichaPreviaCard } from '../historiaClinica/FichaPrevia';
import { MedicoDeLaCita } from './MedicoDeLaCita';
import { ReboteDeLaCita } from './ReboteDeLaCita';
import { CambiarProfesionalCita } from './CambiarProfesionalCita';
import { ComentarioCitaItem } from './ComentarioCitaItem';
import { citaEnRebote } from '../../api/rebote';
import { ConsentimientoDeLaCita } from '../consentimientos/ConsentimientoDeLaCita';
import { formatPromoValor } from '../../api/promociones';
import { horaLima, fmtMinutos } from '../../api/tiemposTratamiento';
import { horaInicioValidaParaDuracion } from '@limablue/shared';
import { cn } from '../../utils/cn';
import { useAuthStore } from '../../stores/authStore';
import type { HistorialCita, Profesional } from '../../api';

// Etiquetas legibles del estado para el display de solo-lectura.
const ESTADO_LABEL: Record<string, string> = {
  agendada: 'AGENDADA',
  confirmada: 'CONFIRMADA',
  llego: 'LLEGÓ',
  en_atencion: 'EN ATENCIÓN',
  completada: 'COMPLETADA',
  no_show: 'NO SHOW',
  cancelada: 'CANCELADA',
};

export function Idea1DetalleCitaModal(props: UseIdea1DetalleCitaProps) {
  const {
    cita,
    seleccionarCitaPorId,
    estadoNorm,
    onClose,
    navigate,
    comentarios,
    nuevoComentario,
    setNuevoComentario,
    editandoComentario,
    setEditandoComentario,
    cancelando,
    setCancelando,
    motivoCancelacion,
    setMotivoCancelacion,
    verHistorial,
    setVerHistorial,
    consultorio,
    setConsultorioLocal,
    reprogramando,
    setReprogramando,
    fechaSel,
    setFechaSel,
    horaSel,
    setHoraSel,
    profSel,
    setProfSel,
    esBaro,
    maquinasBaro,
    elegirMaquina,
    bloqueReprogramable,
    duracionBloque,
    esAdicional,
    atendioOpciones,
    atendidoPorMutation,
    puedeCambiarTratamiento,
    puedeCambiarTratamientoDe,
    tratObjetivo,
    tratEtiqueta,
    cambiandoTratamiento,
    setCambiandoTratamiento,
    abrirCambioTratamiento,
    opcionesTratamiento,
    subcategoriasTrat,
    tratServicioId,
    elegirTratServicio,
    tratSubcategoriaId,
    setTratSubcategoriaId,
    puedeGuardarTratamiento,
    tratamientoMutation,
    fechaSelStr,
    profesionales,
    datosPaciente,
    loadingHistorial,
    paquetesPac,
    elegiblesConsumo,
    paquetesOtras,
    dialogoConsumo,
    setDialogoConsumo,
    esCombo,
    bloquePrincipal,
    bloqueSecundaria,
    citaExon,
    estadoMutation,
    exonerarMut,
    canalesOpts,
    canalSel,
    setCanalSel,
    canalMutation,
    puedeMarcarPagada,
    estadoPagoSel,
    setEstadoPagoSel,
    estadoPagoMutation,
    subiendoComprobante,
    subirComprobante,
    comprobanteMutation,
    promociones,
    esSecundariaBloque,
    promoCita,
    promoHeredada,
    promoSel,
    setPromoSel,
    promoMutation,
    comentarioMutation,
    fmtComentario,
    moverMutation,
    consultorioMutation,
    confirmarMailMutation,
    esFinal,
    nombrePaciente,
    iniciales,
    slotsOcupados,
    dispoReprogCargando,
    slotsAgendables,
    diasRapidos,
    profActual,
    equipoBaro,
    totalConsultorios,
    SLOTS,
    resumenAtencion,
    fichaPrevia,
    cargandoFicha,
    puedeVerHc,
    puedeRegistrarHc,
    irAHistoriaClinica,
  } = useIdea1DetalleCita(props);

  // "No descontar sesión" es genérico, pero la redacción "(láser no aplicado)" solo aplica a
  // láser/combo. En una Profilaxis suelta el texto de láser confunde → wording context-aware.
  const esLaserOCombo = esCombo || /l[áa]ser/i.test(cita.servicio?.nombre ?? '');

  // Una vez registrada la cita, Estado/Canal/Promoción quedan de SOLO LECTURA en el modal:
  // el estado solo avanza con los botones de flujo (Llegó/En atención/Completar). Únicamente
  // quien puede REVERTIR (permiso citas.revertir → admin/coordinadora) conserva los desplegables
  // para corregir errores. Recepción/contact center los ven bloqueados.
  const permisos = useAuthStore((s) => s.usuario?.permisos ?? []);
  // Roles de solo lectura en la agenda (p. ej. médico): ven la cita y abren la historia clínica,
  // pero no gestionan el flujo. El backend igual lo exige (403); aquí se OCULTAN los botones para
  // no ofrecer acciones que el rol no puede ejecutar.
  const puedeEstado = permisos.includes('citas.estado');
  const puedeReprogramar = permisos.includes('citas.reprogramar');
  // Lápiz junto a «Profesional»: pasar la cita a otra profesional (o intercambiar) en el mismo día y hora.
  const [cambiandoProf, setCambiandoProf] = React.useState(false);
  const puedeCancelar = permisos.includes('citas.cancelar');
  const puedeCorregir = permisos.includes('citas.revertir');
  // Solo el CANAL (05-oct-2026): permiso «citas.canal» (p. ej. contact especial), sin desbloquear estado ni promoción.
  const puedeCambiarCanal = puedeCorregir || permisos.includes('citas.canal');
  // 11-nov-2026: `citas.estado_libre` da a cualquier rol el desplegable de estado con TODOS los estados (antes solo el rol admin).
  // Se lee el rol sin hook para no cambiar los hooks de este modal.
  const cambioLibreEstado = permisos.includes('citas.estado_libre') || useAuthStore.getState().usuario?.rol === 'admin';
  const puedeDesplegableEstado = puedeCorregir || cambioLibreEstado;
  // Rescate de «No show» (botones sueltos, sin desplegable): recepción → «Llegó», contact center → «Agendada».
  const puedeNoShowLlego = !cambioLibreEstado && permisos.includes('citas.noshow_llego');
  const puedeNoShowAgendada = !cambioLibreEstado && permisos.includes('citas.noshow_agendada');
  // Rebote (solo admin por ahora): la cita salió de la agenda para volver a llamar al paciente.
  const enRebote = citaEnRebote(cita);

  return (
    <>
      <div
        className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        <div
          data-testid="popover-cita"
          className="bg-surface-container-lowest w-full max-w-[540px] max-h-[90vh] rounded-2xl flex flex-col overflow-hidden custom-shadow border border-outline-variant/30 animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* HEADER */}
          <div className="p-6 border-b border-outline-variant/20 flex flex-col gap-4 bg-surface-container-lowest">
            <div className="flex justify-between items-start">
              <div className="flex gap-4 items-center">
                <div
                  className="w-13 h-13 rounded-full flex items-center justify-center text-white font-bold text-headline-sm shadow-md shrink-0"
                  style={{
                    backgroundColor: cita.profesional?.colorAvatar || '#0044ab',
                  }}
                >
                  {iniciales || 'PA'}
                </div>
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface leading-tight font-bold flex items-center gap-2">
                    <RomboAlerta alerta={cita.paciente.alerta ?? datosPaciente?.alerta} size={15} />
                    <span data-testid="popover-cita-nombre" className="truncate max-w-[280px]" title={nombrePaciente}>
                      {nombrePaciente}
                    </span>
                    {/* Edad (29-sep-2026): solo si tiene fecha de nacimiento registrada. */}
                    {(() => {
                      const edad = calcularEdad(cita.paciente.fechaNacimiento ?? datosPaciente?.fechaNacimiento ?? '');
                      return edad != null ? (
                        <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary" data-testid="detalle-edad-paciente">{edad} años</span>
                      ) : null;
                    })()}
                  </h2>
                  <div className="font-body-md text-on-surface-variant flex items-center gap-2 mt-1 flex-wrap text-xs">
                    {cita.numero != null && (
                      <span data-testid="detalle-numero-cita" title="N.º de cita: dáselo al paciente para ubicar su cita"
                        className="font-mono font-bold text-primary bg-primary/10 rounded px-1.5 py-0.5 select-all">
                        {formatoNumeroCita(cita.numero)}
                      </span>
                    )}
                    <span>{cita.paciente.telefono || 'Sin teléfono'}</span>
                    {cita.paciente.numeroDocumento && (
                      <span className="flex items-center gap-1" data-campo="documento-paciente">
                        <span className="text-on-surface-variant/40">·</span>
                        <span className="font-semibold text-on-surface-variant/80">{cita.paciente.tipoDocumento || 'DNI'}</span>
                        <span className="font-mono">{cita.paciente.numeroDocumento}</span>
                      </span>
                    )}
                    <ToggleDatosPaciente
                      encendido={cita.paciente.requiereActualizacionDatos ?? false}
                      contacto={cita.paciente}
                      onEditar={() => navigate(`/pacientes/${cita.paciente.id}?editar=datos`)}
                    />
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="material-symbols-outlined text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-variant/10 p-2 rounded-full transition-all"
              >
                close
              </button>
            </div>

            {/* Badges de Estado y Asistencia */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-3 py-1 rounded-lg text-label-caps font-bold tracking-wider uppercase border ${
                  estadoNorm === 'en_atencion' || estadoNorm === 'en atención'
                    ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-container/30'
                    : estadoNorm === 'confirmada' || estadoNorm === 'llego'
                    ? 'bg-primary-fixed text-on-primary-fixed-variant border-primary/20'
                    : estadoNorm === 'completada'
                    ? 'bg-surface-variant text-on-surface-variant border-outline-variant/30'
                    : estadoNorm === 'no_show'
                    ? 'bg-error-container text-on-error-container border-error/30'
                    : 'bg-primary/10 text-primary border-primary/20'
                }`}
              >
                {enRebote ? 'En rebote' : (ESTADO_LABEL[estadoNorm] ?? cita.estado)}
              </span>

              {/* En bloque combinado, la llegada se marca en el flujo secuencial de abajo (no aquí). */}
              {puedeEstado && !esCombo && (estadoNorm === 'agendada' || estadoNorm === 'confirmada') && (
                <button
                  type="button"
                  data-testid="popover-cita-btn-llego"
                  onClick={() => estadoMutation.mutate({ estado: 'llego' })}
                  disabled={estadoMutation.isPending}
                  className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs cursor-pointer flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  <span>Marcar Llegó</span>
                </button>
              )}

              <BadgeAsistencia alerta={cita.paciente.alerta ?? datosPaciente?.alerta} />

              {cita.paquetePaciente && cita.sesionNumero && (
                <span className="bg-surface-container-high text-on-surface-variant px-2.5 py-1 rounded-lg text-label-caps border border-outline-variant/10 font-bold">
                  Sesión #{cita.sesionNumero} de {cita.paquetePaciente.sesionesTotal}
                </span>
              )}

              {cita.comprobanteUrl && (
                <a
                  href={urlArchivo(cita.comprobanteUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Ver comprobante de pago anticipado"
                >
                  <span className="material-symbols-outlined text-sm">payments</span>
                  <span>Ver Pago Anticipado</span>
                </a>
              )}
            </div>
          </div>

          {/* SCROLLABLE CONTENT */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
            {/* Banner de reprogramación (solo lectura): de qué día/hora a cuál y por quién */}
            {cita.reprogramacion && (
              <div className="flex items-start gap-2.5 rounded-xl bg-indigo-50 border border-indigo-200 px-3.5 py-2.5">
                <span className="material-symbols-outlined text-indigo-600 text-lg shrink-0">event_repeat</span>
                <div className="text-xs text-indigo-900 min-w-0">
                  <p className="font-bold">Cita reprogramada</p>
                  {cita.reprogramacion.deFecha === cita.reprogramacion.aFecha ? (
                    <p className="text-indigo-700 mt-0.5">
                      El <b>{format(new Date(cita.reprogramacion.aFecha + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}</b>: de las <b>{cita.reprogramacion.deHora}</b> a las <b>{cita.reprogramacion.aHora}</b>
                    </p>
                  ) : (
                    <p className="text-indigo-700 mt-0.5">
                      Del <b>{format(new Date(cita.reprogramacion.deFecha + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}</b>
                      {cita.reprogramacion.deHora ? ` · ${cita.reprogramacion.deHora}` : ''} al{' '}
                      <b>{format(new Date(cita.reprogramacion.aFecha + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}</b>
                      {cita.reprogramacion.aHora ? ` · ${cita.reprogramacion.aHora}` : ''}
                    </p>
                  )}
                  <p className="text-[11px] text-indigo-500 mt-0.5">
                    Reprogramada por {cita.reprogramacion.por} · {fmtComentario(cita.reprogramacion.en)}
                  </p>
                </div>
              </div>
            )}

            {/* Chip RETROACTIVA (solo lectura): la cita se registró para una fecha anterior a su día
                de creación. Se DERIVA de fecha < día(creadoEn); el motivo (si existe) se muestra debajo.
                (Si además fue reprogramada al pasado, el banner de arriba da el contexto del movimiento.) */}
            {(() => {
              const fechaCitaStr = (cita.fecha ?? '').slice(0, 10);
              const creadoDia = cita.creadoEn ? format(new Date(cita.creadoEn), 'yyyy-MM-dd') : '';
              if (!fechaCitaStr || !creadoDia || fechaCitaStr >= creadoDia) return null;
              return (
                <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-300 px-3.5 py-2.5">
                  <span className="material-symbols-outlined text-amber-600 text-lg shrink-0">history</span>
                  <div className="text-xs text-amber-900 min-w-0">
                    <p className="font-bold flex items-center gap-1.5">
                      Cita retroactiva
                      <span className="inline-block rounded-full bg-amber-200 text-amber-800 text-[10px] font-bold px-2 py-0.5">registrada en el pasado</span>
                    </p>
                    <p className="text-amber-700 mt-0.5">
                      Registrada el <b>{format(new Date(cita.creadoEn), "d 'de' MMMM yyyy · HH:mm", { locale: es })}</b>
                      {' '}para el <b>{format(new Date(fechaCitaStr + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}</b>
                      {cita.creadoPorUsuario ? ` · por ${cita.creadoPorUsuario.nombre}` : ''}
                    </p>
                    {cita.motivoRetroactivo && (
                      <p className="text-[11px] text-amber-800 mt-1">
                        <span className="font-semibold">Motivo:</span> {cita.motivoRetroactivo}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Paquetes y Membresías Activas */}
            {paquetesPac && paquetesPac.some((p) => p.estado === 'ACTIVO') && (
              <div className="bg-surface-container-low/60 rounded-xl p-3 border border-outline-variant/20 space-y-1">
                <SaldoPaquetes
                  pacienteId={cita.paciente.id}
                  variante="chip"
                  servicioActualId={cita.servicioId}
                  sedeActualId={cita.sedeId}
                  onChipClick={() => navigate(`/pacientes/${cita.paciente.id}`)}
                />
                {elegiblesConsumo.length === 0 && paquetesOtras.length > 0 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 mt-1">
                    ⚠️ El paquete de este paciente pertenece a <b>{paquetesOtras[0].sede?.nombre}</b>.
                  </p>
                )}
              </div>
            )}

            {/* Exoneración / "No descontar sesión" */}
            {(citaExon.sesionExonerada || cita.sesionConsumida || elegiblesConsumo.length > 0 || esCombo) && (
              <div className="bg-surface-container-low/40 rounded-xl p-3 border border-outline-variant/20">
                {citaExon.sesionExonerada ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-rose-50 border border-rose-200 p-2.5">
                    <div className="text-xs text-rose-800 min-w-0">
                      <span className="font-bold">🚫 {esLaserOCombo ? 'Sesión de láser no descontada' : 'Sesión no descontada'}</span>
                      {citaExon.sesionExoneradaMotivo && <span className="text-rose-600"> · {citaExon.sesionExoneradaMotivo}</span>}
                      <span className="block text-[11px] text-rose-500 mt-0.5">
                        {esLaserOCombo ? 'Láser no aplicado — el paciente conserva la sesión.' : 'El paciente conserva la sesión.'}
                      </span>
                    </div>
                    <button
                      onClick={() => exonerarMut.mutate({ exonerar: false })}
                      disabled={exonerarMut.isPending}
                      className="text-xs font-bold text-rose-700 bg-white hover:bg-rose-100 border border-rose-300 rounded-lg px-3 py-1 shrink-0 disabled:opacity-50 transition-colors"
                    >
                      Quitar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const ejemplo = esLaserOCombo
                        ? 'Motivo (opcional) — ej. el médico indicó no aplicar el láser:'
                        : 'Motivo (opcional) — ej. el servicio no se aplicó:';
                      const motivo = window.prompt(ejemplo, esLaserOCombo ? 'Láser no aplicado' : '');
                      if (motivo === null) return;
                      exonerarMut.mutate({ exonerar: true, motivo: motivo.trim() || undefined });
                    }}
                    disabled={exonerarMut.isPending}
                    className="w-full text-xs font-semibold text-on-surface-variant bg-surface-container-lowest border border-outline-variant/40 rounded-xl py-2 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-base">block</span>
                    {esLaserOCombo ? 'No descontar sesión (láser no aplicado)' : 'No descontar sesión'}
                  </button>
                )}
              </div>
            )}

            {/* INFO GRID */}
            <div className="grid grid-cols-[110px_1fr] gap-y-4 items-center bg-surface-container-low/30 p-4 rounded-2xl border border-outline-variant/20">
              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">
                {esCombo && bloquePrincipal && bloqueSecundaria ? 'Servicios' : 'Servicio'}
              </div>
              {cambiandoTratamiento ? (
                // Cambiar tratamiento / subcategoría (agendada → llegó; admin siempre). En una cita doble, de UNA mitad y solo
                // entre los servicios que permite el bloque. El servidor valida el resto.
                <div className="flex flex-col gap-2" data-campo="cambiar-tratamiento">
                  {tratEtiqueta && (
                    <div className="text-xs text-on-surface-variant">
                      Cambiando el <b className="text-on-surface">{tratEtiqueta}</b> de la cita doble ({tratObjetivo.servicio?.nombre}).
                      {tratObjetivo.slotRol === 'PRINCIPAL' && ' Solo se puede elegir el servicio ancla y su tipo.'}
                    </div>
                  )}
                  <select value={tratServicioId} onChange={(e) => elegirTratServicio(e.target.value)} aria-label="Nuevo tratamiento" data-testid="select-tratamiento"
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-2 text-sm font-semibold text-on-surface outline-none focus:ring-2 focus:ring-primary/20">
                    {opcionesTratamiento.length === 0 && <option value={tratServicioId}>Cargando tratamientos…</option>}
                    {opcionesTratamiento.map((s) => <option key={s.id} value={s.id}>{s.nombre} · {s.duracionMinutos} min</option>)}
                  </select>
                  {subcategoriasTrat.length > 0 && (
                    <select value={tratSubcategoriaId} onChange={(e) => setTratSubcategoriaId(e.target.value)} aria-label="Subcategoría" data-testid="select-subcategoria-tratamiento"
                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20">
                      <option value="">Elige la subcategoría…</option>
                      {subcategoriasTrat.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => tratamientoMutation.mutate()} disabled={!puedeGuardarTratamiento || tratamientoMutation.isPending}
                      data-testid="btn-guardar-tratamiento"
                      className="flex-1 min-h-[36px] rounded-xl bg-primary text-on-primary text-xs font-bold disabled:opacity-50">
                      {tratamientoMutation.isPending ? 'Guardando…' : 'Guardar cambio'}
                    </button>
                    <button type="button" onClick={() => setCambiandoTratamiento(false)} disabled={tratamientoMutation.isPending}
                      className="min-h-[36px] px-3 rounded-xl border border-outline-variant/40 text-xs font-semibold text-on-surface hover:bg-surface-container">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : esCombo && bloquePrincipal && bloqueSecundaria ? (
                // Bloque combinado: ambos servicios apilados (1º arriba, 2º abajo) con su estado.
                <div className="flex flex-col gap-1.5">
                  {[{ c: bloquePrincipal, n: '1º' }, { c: bloqueSecundaria, n: '2º' }].map(({ c, n }) => {
                    const e = (c.estado || '').toLowerCase().replace(/\s+/g, '_');
                    return (
                      <div key={c.id} className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold text-primary bg-primary/10 rounded px-1.5 py-0.5 leading-none">{n}</span>
                        <span className="font-body-lg text-on-surface font-bold tracking-tight uppercase">{c.servicio?.nombre}</span>
                        {c.subcategoria && (
                          <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold normal-case">{c.subcategoria.nombre}</span>
                        )}
                        <span className={cn(
                          'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded leading-none',
                          e === 'completada' ? 'bg-emerald-100 text-emerald-700'
                            : e === 'en_atencion' ? 'bg-amber-100 text-amber-700'
                            : e === 'cancelada' || e === 'no_show' ? 'bg-rose-100 text-rose-700'
                            : e === 'llego' ? 'bg-primary/10 text-primary'
                            : 'bg-surface-container text-on-surface-variant',
                        )}>
                          {ESTADO_LABEL[e] ?? c.estado}
                        </span>
                        {/* 13-nov-2026: cambiar el tratamiento de ESTE servicio (solo los que permite la cita doble). */}
                        {puedeCambiarTratamientoDe(c) && (
                          <button type="button" onClick={() => abrirCambioTratamiento(c)} data-testid={`btn-cambiar-tratamiento-${n}`}
                            title={`Cambiar el tratamiento o el tipo del ${n} servicio`}
                            className="normal-case text-xs font-semibold text-primary hover:underline flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-sm">edit</span>Cambiar
                          </button>
                        )}
                        {/* 31-oct-2026: quien puede corregir estados cambia CADA servicio por separado (solo ese). El desplegable de
                            «Estado» de abajo mueve la cita abierta y arrastra a su pareja; este toca solo el servicio de esta fila. */}
                        {puedeDesplegableEstado && (
                          <select
                            value={e} disabled={estadoMutation.isPending} data-testid={`estado-servicio-${n}`}
                            aria-label={`Estado de ${c.servicio?.nombre ?? 'este servicio'} (solo este servicio)`} title="Cambiar el estado solo de este servicio"
                            onChange={(ev) => {
                              const destino = ev.target.value;
                              if (destino === e) return;
                              if (esCambioEspecial(e, destino) && !window.confirm(
                                `Cambio especial de administrador, solo en «${c.servicio?.nombre ?? 'este servicio'}»: ${ESTADO_LABEL[e] ?? e} → ${ESTADO_LABEL[destino] ?? destino}.

El otro servicio de la cita doble no cambia.

¿Continuar?`)) return;
                              estadoMutation.mutate({ estado: destino, citaId: c.id, soloEsta: true });
                            }}
                            className="ml-auto text-[10px] font-bold uppercase rounded-md border border-outline-variant/40 bg-surface-container-lowest px-1 py-0.5 outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                          >
                            {estadosPermitidos(e, cambioLibreEstado).map((op) => (
                              <option key={op} value={op}>{(ESTADO_LABEL[op] ?? op).toUpperCase()}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="font-body-lg text-on-surface font-bold tracking-tight uppercase flex items-center gap-2 flex-wrap">
                  <span>{cita.servicio?.nombre}</span>
                  {cita.subcategoria && (
                    <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold normal-case">
                      {cita.subcategoria.nombre}
                    </span>
                  )}
                  {puedeCambiarTratamiento && (
                    <button type="button" onClick={() => abrirCambioTratamiento()} data-testid="btn-cambiar-tratamiento"
                      title="Cambiar el tratamiento o la subcategoría de esta cita"
                      className="ml-auto normal-case text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">edit</span>Cambiar
                    </button>
                  )}
                </div>
              )}

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Hora</div>
              <div className="font-body-lg text-on-surface font-semibold">
                {cita.horaInicio} · {cita.duracionMinutos} min
              </div>

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Estado</div>
              {puedeDesplegableEstado ? (
                <div>
                <div className="relative">
                  <select
                    value={estadoNorm}
                    onChange={(e) => {
                      const destino = e.target.value;
                      // Admin: un salto fuera del flujo normal (p. ej. En atención → Cancelada) se confirma antes.
                      if (esCambioEspecial(estadoNorm, destino) && !window.confirm(
                        `Cambio especial de administrador: ${ESTADO_LABEL[estadoNorm] ?? estadoNorm} → ${ESTADO_LABEL[destino] ?? destino}.\n\n` +
                        (['cancelada', 'no_show'].includes(destino) ? 'Si la cita tiene una atención clínica VACÍA, se retira. Si tiene registros, se te pide confirmar otra vez y la atención se conserva.\n\n' : '') +
                        '¿Continuar?')) return;
                      estadoMutation.mutate({ estado: destino });
                    }}
                    disabled={estadoMutation.isPending}
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-1.5 text-xs font-bold text-on-surface outline-none focus:ring-2 focus:ring-primary/20 appearance-none hover:border-primary/40 transition-colors uppercase"
                  >
                    {/* Solo los pasos que el servidor acepta desde el estado actual (nada de «Transición inválida»).
                        El admin ve TODOS (06-oct-2026); se lee el rol sin hook para no cambiar los hooks de este modal. */}
                    {estadosPermitidos(estadoNorm, cambioLibreEstado).map((e) => (
                      <option key={e} value={e}>{(ESTADO_LABEL[e] ?? e).toUpperCase()}</option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant/60 text-base">
                    expand_more
                  </span>
                </div>
                {esCombo && bloquePrincipal && bloqueSecundaria && (
                  <p className="text-[10px] leading-tight text-on-surface-variant mt-1">Cambia los dos servicios juntos. Para uno solo, usa el estado de cada servicio (arriba).</p>
                )}
                </div>
              ) : (
                // Solo lectura: el estado se mueve con los botones de flujo, no editando este campo.
                <div className="text-xs font-bold text-on-surface uppercase px-3 py-1.5 rounded-xl bg-surface-container border border-outline-variant/20">
                  {ESTADO_LABEL[estadoNorm] ?? cita.estado}
                </div>
              )}

              {(() => {
                // Tiempos de la cita, calculados de los timestamps del flujo (solo si existen).
                const dur = (a?: string | null, b?: string | null) => {
                  if (!a || !b) return null;
                  const ms = new Date(b).getTime() - new Date(a).getTime();
                  if (!(ms >= 0)) return null;
                  const min = Math.round(ms / 60000);
                  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}min` : `${min} min`;
                };
                const espera = dur(cita.llegoEn, cita.enAtencionEn);
                const atencion = dur(cita.enAtencionEn, cita.completadaEn);
                const total = dur(cita.llegoEn, cita.completadaEn);
                // Tiempo REAL medido con el aparato del consultorio (botones INICIO / FIN).
                const tt = cita.tiemposTratamiento?.[0];
                const tratamiento = !tt ? null
                  : tt.estado === 'en_curso' ? `en curso desde ${horaLima(tt.inicioEn)} · C${tt.consultorioNumero}`
                  : tt.estado === 'sin_fin' ? `sin FIN (desde ${horaLima(tt.inicioEn)}) · C${tt.consultorioNumero}`
                  : `${fmtMinutos(tt.duracionSegundos)} · C${tt.consultorioNumero}`;
                if (!espera && !atencion && !total && !tratamiento) return null;
                const Chip = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-on-surface-variant bg-surface-container border border-outline-variant/30 rounded-lg px-2 py-1">
                    <span className="material-symbols-outlined text-sm text-primary">{icon}</span>
                    {label} <b className="text-on-surface">{value}</b>
                  </span>
                );
                return (
                  <>
                    <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Tiempos</div>
                    <div className="flex flex-wrap gap-1.5">
                      {tratamiento && <Chip icon="timer" label="Tratamiento" value={tratamiento} />}
                      {espera && <Chip icon="hourglass_empty" label="Espera" value={espera} />}
                      {atencion && <Chip icon="medical_services" label="Atención" value={atencion} />}
                      {total && <Chip icon="schedule" label="Total" value={total} />}
                    </div>
                  </>
                );
              })()}

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Profesional</div>
              <div className="flex items-center gap-2 font-body-lg text-primary font-semibold">
                <span>{profActual}</span>
                {/* 30-oct-2026: el lápiz vuelve, ahora para pasar la cita a otra profesional o columna «Adicional» (mismo día y hora),
                    o INTERCAMBIAR si está ocupada. Mismas reglas que arrastrar en la agenda; baro va en máquina (se cambia al reprogramar). */}
                {puedeReprogramar && !['completada', 'cancelada', 'no_show', 'reprogramada'].includes(estadoNorm) && !equipoBaro && !/baropodometr/i.test(cita.unidadNegocio?.nombre ?? '') && (
                  <button
                    type="button" onClick={() => setCambiandoProf((v) => !v)} data-testid="btn-cambiar-profesional"
                    title="Pasar a otra profesional o intercambiar" aria-label="Cambiar de profesional" aria-expanded={cambiandoProf}
                    className={cn('inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors cursor-pointer',
                      cambiandoProf ? 'bg-primary text-white' : 'text-primary/70 hover:bg-primary/10 hover:text-primary')}
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                )}
              </div>
              {/* Las filas de este bloque son una grilla de 2 columnas (etiqueta | valor): el panel ocupa las dos. */}
              {cambiandoProf && <div className="col-span-2"><CambiarProfesionalCita cita={cita} onCerrar={() => setCambiandoProf(false)} /></div>}

              {/* Columna «Adicional»: qué podóloga la atendió de verdad (informativo; no ocupa su agenda). */}
              {esAdicional && (
                <>
                  <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Atendió</div>
                  <div className="relative" data-campo="atendido-por">
                    <select
                      value={cita.atendidoPor?.id ?? ''}
                      disabled={atendidoPorMutation.isPending || estadoNorm === 'cancelada'}
                      onChange={(e) => atendidoPorMutation.mutate(e.target.value || null)}
                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-1.5 text-xs font-medium text-on-surface outline-none focus:ring-2 focus:ring-primary/20 appearance-none hover:border-primary/40 transition-colors"
                    >
                      <option value="">— Sin especificar (¿quién la atendió?) —</option>
                      {/* La ya elegida siempre aparece, aunque ya no esté en la lista. */}
                      {cita.atendidoPor && ![...atendioOpciones.deLaSede, ...atendioOpciones.otras].some((p) => p.id === cita.atendidoPor!.id) && (
                        <option value={cita.atendidoPor.id}>{cita.atendidoPor.nombres} {cita.atendidoPor.apellidos}</option>
                      )}
                      {atendioOpciones.deLaSede.length > 0 && (
                        <optgroup label="Hoy en esta sede">
                          {atendioOpciones.deLaSede.map((p) => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
                        </optgroup>
                      )}
                      {atendioOpciones.otras.length > 0 && (
                        <optgroup label="De otras sedes (hacen este servicio)">
                          {atendioOpciones.otras.map((p) => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
                        </optgroup>
                      )}
                    </select>
                    <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant/60 text-base">expand_more</span>
                  </div>
                </>
              )}

              {equipoBaro && (
                <>
                  <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Equipo</div>
                  <div className="text-xs font-bold text-on-surface-variant bg-surface-container border border-outline-variant/30 rounded-lg px-2.5 py-1 inline-flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-primary">monitor_heart</span>
                    <span>{equipoBaro}</span>
                  </div>
                </>
              )}

              {cita.origenAsignacion && !cita.solicitadoProfesional && (
                <>
                  <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Origen</div>
                  <div className="flex items-center gap-2 font-body-md text-on-surface-variant text-xs font-medium">
                    <span className="material-symbols-outlined text-primary text-lg">
                      {cita.origenAsignacion === 'elegida_por_paciente' ? 'person_check' : 'smart_toy'}
                    </span>
                    <span>
                      {cita.origenAsignacion === 'elegida_por_paciente'
                        ? 'Eligió la profesional'
                        : 'Asignación automática'}
                    </span>
                  </div>
                </>
              )}

              <div className="font-label-caps text-label-caps text-amber-800 uppercase tracking-wider font-bold">Canal</div>
              {puedeCambiarCanal ? (
                <div className="relative">
                  <select
                    value={canalSel}
                    onChange={(e) => {
                      setCanalSel(e.target.value);
                      canalMutation.mutate(e.target.value);
                    }}
                    disabled={canalMutation.isPending}
                    className="w-full bg-amber-50 border border-amber-400 ring-1 ring-amber-400 rounded-xl px-3 py-1.5 text-xs font-semibold text-amber-900 outline-none focus:ring-2 focus:ring-amber-400 appearance-none hover:border-amber-500 transition-colors"
                  >
                    {!canalesOpts.some((c) => c.value === canalSel) && (
                      <option value={canalSel}>{canalSel}</option>
                    )}
                    {canalesOpts.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-amber-600 text-base">
                    expand_more
                  </span>
                </div>
              ) : (
                // Solo lectura: el canal se fija al registrar la cita.
                <div className="text-xs font-semibold text-amber-900 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-400 ring-1 ring-amber-400">
                  {canalesOpts.find((c) => c.value === canalSel)?.label ?? canalSel ?? '—'}
                </div>
              )}

              {/* ESTADO DE PAGO (29-sep-2026): se cambia en cualquier momento; queda quién y cuándo. */}
              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Pago</div>
              <div data-testid="detalle-estado-pago" className="space-y-1">
                <div className="grid grid-cols-3 gap-1">
                  {ESTADOS_PAGO.map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      disabled={!puedeMarcarPagada || estadoPagoMutation.isPending}
                      onClick={() => { if (e.value === estadoPagoSel) return; setEstadoPagoSel(e.value); estadoPagoMutation.mutate(e.value); }}
                      data-testid={`detalle-pago-${e.value}`}
                      className={`flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-bold leading-tight transition-colors disabled:cursor-default ${estadoPagoSel === e.value ? e.activo : 'bg-surface-container border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high'}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">{e.icono}</span>{e.label}
                    </button>
                  ))}
                </div>
                {/* Comprobante: con pago incompleto / completo se adjunta, se ve o se reemplaza (un comprobante por cita). */}
                {estadoPagoSel !== 'pendiente' && (
                  <div className="flex items-center gap-2 text-[11px]" data-testid="detalle-comprobante">
                    <span className="material-symbols-outlined text-[15px] text-emerald-700">{cita.comprobanteUrl ? 'task' : 'attach_file'}</span>
                    {cita.comprobanteUrl ? (
                      <>
                        <a href={urlArchivo(cita.comprobanteUrl)} target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 hover:underline truncate max-w-[130px]" title={cita.comprobanteNombre ?? undefined}>
                          {cita.comprobanteNombre || 'Ver comprobante'}
                        </a>
                        {puedeMarcarPagada && (
                          <>
                            <label className="font-semibold text-primary hover:underline cursor-pointer">
                              {subiendoComprobante ? 'Subiendo…' : 'Reemplazar'}
                              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={subiendoComprobante}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirComprobante(f); e.target.value = ''; }} />
                            </label>
                            <button type="button" disabled={comprobanteMutation.isPending} onClick={() => { if (window.confirm('¿Quitar el comprobante de esta cita?')) comprobanteMutation.mutate(null); }} className="font-semibold text-red-600 hover:underline">Quitar</button>
                          </>
                        )}
                      </>
                    ) : puedeMarcarPagada ? (
                      <label className="font-semibold text-primary hover:underline cursor-pointer" data-testid="detalle-comprobante-subir">
                        {subiendoComprobante ? 'Subiendo comprobante…' : 'Adjuntar comprobante (opcional)'}
                        <input type="file" accept="image/*,application/pdf" className="hidden" disabled={subiendoComprobante}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirComprobante(f); e.target.value = ''; }} />
                      </label>
                    ) : (
                      <span className="text-on-surface-variant">Sin comprobante</span>
                    )}
                  </div>
                )}
                {cita.pagadaEn && cita.pagadaPor && (
                  <p className="text-[10px] text-on-surface-variant" data-testid="detalle-pagada-hora">
                    Registrado por {cita.pagadaPor.nombre} · {(() => {
                      const p = Object.fromEntries(new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
                        .formatToParts(new Date(cita.pagadaEn)).map((x) => [x.type, x.value]));
                      return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')} ${p.hour}:${p.minute}`;
                    })()}
                  </p>
                )}
              </div>

              {/* Quién registró la cita (usuario del sistema). Sin usuario = reserva en línea del paciente o carga masiva. */}
              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Agendó</div>
              <div className="flex items-center gap-2 text-xs font-medium text-on-surface px-3 py-1.5 rounded-xl bg-surface-container border border-outline-variant/20" data-campo="agendo">
                <span className="material-symbols-outlined text-primary text-base">badge</span>
                <span className="truncate">{cita.creadoPorUsuario?.nombre ?? 'Sin usuario registrado'}</span>
              </div>

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Promoción</div>
              <div className="relative">
                {esSecundariaBloque ? (
                  <span className="text-xs text-on-surface-variant font-medium">
                    {promoHeredada
                      ? `🎁 ${promoHeredada.nombre} (del bloque)`
                      : '— Ninguna (del bloque)'}
                  </span>
                ) : !puedeCorregir ? (
                  // Solo lectura: la promoción se fija al registrar la cita.
                  <span className="text-xs text-on-surface-variant font-medium">
                    {promoCita ? `🎁 ${promoCita.nombre}` : '— Ninguna —'}
                  </span>
                ) : (
                  <>
                    <select
                      value={promoSel}
                      onChange={(e) => {
                        setPromoSel(e.target.value);
                        promoMutation.mutate(e.target.value || null);
                      }}
                      disabled={promoMutation.isPending}
                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-1.5 text-xs font-medium text-on-surface outline-none focus:ring-2 focus:ring-primary/20 appearance-none hover:border-primary/40 transition-colors"
                    >
                      <option value="">— Ninguna —</option>
                      {promoCita && !promociones.some((p) => p.id === promoCita.id) && (
                        <option value={promoCita.id}>{promoCita.nombre} (inactiva)</option>
                      )}
                      {promociones.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                          {p.tipo !== 'OTRO' ? ` · ${formatPromoValor(p.tipo, p.valor)}` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant/60 text-base">
                      expand_more
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* CORREO DE CONFIRMACIÓN DE CITA */}
            {!esFinal && (
              <div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/30 flex items-center justify-between gap-3">
                <div>
                  <p className="font-label-caps text-label-caps text-primary font-bold">
                    Confirmación por correo
                  </p>
                  <p className="text-xs text-on-surface-variant/70 mt-0.5 font-medium">
                    {!cita.paciente.email?.trim()
                      ? '⚠️ Paciente sin correo registrado'
                      : cita.estadoConfirmacion === 'confirmada'
                      ? `✓ Confirmada por paciente`
                      : cita.confirmacionEnviadaEn
                      ? `Correo enviado`
                      : 'Aún no se ha enviado'}
                  </p>
                </div>
                <button
                  onClick={() => confirmarMailMutation.mutate()}
                  disabled={confirmarMailMutation.isPending || !cita.paciente.email?.trim()}
                  title={!cita.paciente.email?.trim() ? 'El paciente no tiene correo electrónico registrado' : undefined}
                  className="bg-surface-container-lowest hover:bg-primary hover:text-white text-primary border border-primary/20 px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-base">mail</span>
                  {confirmarMailMutation.isPending
                    ? 'Enviando...'
                    : !cita.paciente.email?.trim()
                    ? 'Sin correo'
                    : 'Reenviar correo'}
                </button>
              </div>
            )}

            {/* BOTONES DE ASISTENCIA ("¿Vino el paciente?") — cita suelta (no bloque combinado) */}
            {!esCombo && !esFinal && (estadoNorm === 'agendada' || estadoNorm === 'confirmada' || estadoNorm === 'llego' || estadoNorm === 'en_atencion') && (
              <div className="space-y-3">
                <p className="font-headline-sm text-headline-sm text-on-surface text-sm font-bold">
                  ¿Vino el paciente?
                </p>
                {puedeEstado && (estadoNorm === 'agendada' || estadoNorm === 'confirmada') && (
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => estadoMutation.mutate({ estado: 'llego' })}
                      disabled={estadoMutation.isPending}
                      className="flex items-center justify-center gap-2.5 p-3.5 border border-emerald-300 bg-emerald-50/50 hover:bg-emerald-100 text-emerald-800 rounded-2xl transition-all font-bold text-sm shadow-xs cursor-pointer group"
                    >
                      <span className="material-symbols-outlined text-xl text-emerald-600 group-hover:scale-110 transition-transform">
                        check_circle
                      </span>
                      <span>Llegó</span>
                    </button>
                    <button
                      onClick={() => estadoMutation.mutate({ estado: 'no_show' })}
                      disabled={estadoMutation.isPending}
                      className="flex items-center justify-center gap-2.5 p-3.5 border border-rose-300 bg-rose-50/50 hover:bg-rose-100 text-rose-800 rounded-2xl transition-all font-bold text-sm shadow-xs cursor-pointer group"
                    >
                      <span className="material-symbols-outlined text-xl text-rose-600 group-hover:scale-110 transition-transform">
                        cancel
                      </span>
                      <span>No vino</span>
                    </button>
                  </div>
                )}
                {puedeEstado && estadoNorm === 'llego' && (
                  <button
                    onClick={() => estadoMutation.mutate({ estado: 'en_atencion' })}
                    disabled={estadoMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 p-3.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-2xl transition-all font-bold text-sm cursor-pointer shadow-xs"
                  >
                    <span className="material-symbols-outlined text-lg">play_arrow</span>
                    En atención
                  </button>
                )}
                {puedeEstado && estadoNorm === 'en_atencion' && (
                  <button
                    onClick={() => estadoMutation.mutate({ estado: 'completada' })}
                    disabled={estadoMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 p-3.5 border border-emerald-400 bg-emerald-600 text-white rounded-2xl transition-all font-bold text-sm cursor-pointer shadow-md shadow-emerald-600/20 hover:bg-emerald-700"
                  >
                    <span className="material-symbols-outlined text-lg">task_alt</span>
                    Completar atención
                  </button>
                )}
              </div>
            )}

            {/* RESCATE DE «NO SHOW» (11-nov-2026): el paciente sí vino / sí se reagenda. Recepción solo ve «Llegó»; contact center solo «Agendada».
                Cita doble: cada servicio en «No show» tiene sus propios botones y se mueve solo él. Quien tiene el cambio libre usa el desplegable. */}
            {(puedeNoShowLlego || puedeNoShowAgendada) && (() => {
              const norm = (e?: string) => (e || '').toLowerCase().replace(/\s+/g, '_');
              const dobles = esCombo && bloquePrincipal && bloqueSecundaria;
              const items = dobles
                ? [{ c: bloquePrincipal!, n: '1º' }, { c: bloqueSecundaria!, n: '2º' }].filter(({ c }) => norm(c.estado) === 'no_show')
                : estadoNorm === 'no_show' ? [{ c: cita, n: '' }] : [];
              if (items.length === 0) return null;
              return (
                <div className="space-y-2.5" data-testid="rescate-no-show">
                  {items.map(({ c, n }) => (
                    <div key={c.id} className="space-y-2">
                      <p className="font-headline-sm text-headline-sm text-on-surface text-sm font-bold">
                        {dobles ? `${n} ${c.servicio?.nombre ?? 'servicio'} · ` : ''}Marcada como «No show»
                      </p>
                      <div className={cn('grid gap-3', puedeNoShowLlego && puedeNoShowAgendada ? 'grid-cols-2' : 'grid-cols-1')}>
                        {puedeNoShowLlego && (
                          <button
                            data-testid="noshow-a-llego"
                            disabled={estadoMutation.isPending}
                            onClick={() => {
                              if (window.confirm('El paciente SÍ llegó: la cita pasa de «No show» a «Llegó». ¿Continuar?')) {
                                estadoMutation.mutate({ estado: 'llego', ...(dobles ? { citaId: c.id, soloEsta: true } : {}) });
                              }
                            }}
                            className="flex items-center justify-center gap-2.5 p-3.5 border border-emerald-300 bg-emerald-50/50 hover:bg-emerald-100 text-emerald-800 rounded-2xl transition-all font-bold text-sm shadow-xs cursor-pointer disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-xl text-emerald-600">check_circle</span>
                            <span>Llegó</span>
                          </button>
                        )}
                        {puedeNoShowAgendada && (
                          <button
                            data-testid="noshow-a-agendada"
                            disabled={estadoMutation.isPending}
                            onClick={() => {
                              if (window.confirm('La cita vuelve de «No show» a «Agendada». ¿Continuar?')) {
                                estadoMutation.mutate({ estado: 'agendada', ...(dobles ? { citaId: c.id, soloEsta: true } : {}) });
                              }
                            }}
                            className="flex items-center justify-center gap-2.5 p-3.5 border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary rounded-2xl transition-all font-bold text-sm shadow-xs cursor-pointer disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-xl">event_available</span>
                            <span>Agendada</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* FLUJO SECUENCIAL DEL BLOQUE COMBINADO: 1º tratamiento → (continuar/cancelar) → 2º tratamiento */}
            {puedeEstado && esCombo && bloquePrincipal && bloqueSecundaria && (() => {
              if (!bloquePrincipal || !bloqueSecundaria) return null;
              const norm = (e?: string) => (e || '').toLowerCase().replace(/\s+/g, '_');
              const pE = norm(bloquePrincipal.estado);
              const sE = norm(bloqueSecundaria.estado);
              const P = bloquePrincipal.id;
              const S = bloqueSecundaria.id;
              const pend = estadoMutation.isPending;
              const finales = ['completada', 'no_show', 'cancelada'];
              // «2º cancelado» o 2º completado por error: admin / coordinación lo devuelven (solo el 2º; el 1º no se toca).
              const devolver2 = useAuthStore.getState().tiene('citas.revertir')
                && ['llego', 'en_atencion', 'completada'].includes(pE) && (sE === 'cancelada' || sE === 'completada');
              if (finales.includes(pE) && finales.includes(sE) && !devolver2) return null; // bloque cerrado
              const s1 = bloquePrincipal.servicio?.nombre ?? '1º tratamiento';
              const s2 = bloqueSecundaria.servicio?.nombre ?? '2º tratamiento';
              const btnFull = 'w-full flex items-center justify-center gap-2 p-3.5 rounded-2xl transition-all font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
              return (
                <div className="space-y-3 p-3.5 rounded-2xl border border-primary/20 bg-primary/5">
                  <p className="font-label-caps text-label-caps text-primary font-bold uppercase tracking-wider">Bloque combinado · 2 tratamientos</p>

                  {(pE === 'agendada' || pE === 'confirmada') && (
                    <>
                      <p className="font-headline-sm text-headline-sm text-on-surface text-sm font-bold">¿Vino el paciente?</p>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          disabled={pend}
                          onClick={() => estadoMutation.mutate({ estado: 'llego', citaId: P })}
                          className="flex items-center justify-center gap-2.5 p-3.5 border border-emerald-300 bg-emerald-50/50 hover:bg-emerald-100 text-emerald-800 rounded-2xl transition-all font-bold text-sm shadow-xs cursor-pointer disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-xl text-emerald-600">check_circle</span>
                          <span>Llegó</span>
                        </button>
                        <button
                          disabled={pend}
                          onClick={() => estadoMutation.mutate({ estado: 'no_show', citaId: P })}
                          className="flex items-center justify-center gap-2.5 p-3.5 border border-rose-300 bg-rose-50/50 hover:bg-rose-100 text-rose-800 rounded-2xl transition-all font-bold text-sm shadow-xs cursor-pointer disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-xl text-rose-600">cancel</span>
                          <span>No vino</span>
                        </button>
                      </div>
                    </>
                  )}

                  {pE === 'llego' && (
                    <button disabled={pend} onClick={() => estadoMutation.mutate({ estado: 'en_atencion', citaId: P, soloEsta: true })}
                      className={cn(btnFull, 'border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 shadow-xs')}>
                      <span className="material-symbols-outlined text-lg">play_arrow</span>
                      Iniciar 1º tratamiento · {s1}
                    </button>
                  )}

                  {pE === 'en_atencion' && (
                    <button disabled={pend} onClick={() => estadoMutation.mutate({ estado: 'completada', citaId: P, soloEsta: true })}
                      className={cn(btnFull, 'border border-emerald-400 bg-emerald-600 text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700')}>
                      <span className="material-symbols-outlined text-lg">task_alt</span>
                      Completar 1º tratamiento · {s1}
                    </button>
                  )}

                  {pE === 'completada' && (sE === 'llego' || sE === 'agendada' || sE === 'confirmada') && (
                    <>
                      <p className="font-headline-sm text-headline-sm text-on-surface text-sm font-bold">
                        ✅ 1º tratamiento completado. ¿Continuar con el 2º?
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <button disabled={pend} onClick={async () => {
                          // El 2º tratamiento solo entra «En atención» desde «Llegó»: si la secundaria quedó
                          // en agendada/confirmada (p. ej. el 1º se marcó solo), primero se marca su llegada.
                          if (sE !== 'llego') {
                            try { await estadoMutation.mutateAsync({ estado: 'llego', citaId: S, soloEsta: true }); } catch { return; }
                          }
                          estadoMutation.mutate({ estado: 'en_atencion', citaId: S, soloEsta: true });
                        }}
                          className="flex items-center justify-center gap-2.5 p-3.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-2xl transition-all font-bold text-sm shadow-xs cursor-pointer disabled:opacity-50">
                          <span className="material-symbols-outlined text-xl">play_arrow</span>
                          <span>Continuar con 2º</span>
                        </button>
                        <button disabled={pend} onClick={() => estadoMutation.mutate({ estado: 'cancelada', citaId: S, soloEsta: true })}
                          className="flex items-center justify-center gap-2.5 p-3.5 border border-rose-300 bg-rose-50/50 hover:bg-rose-100 text-rose-800 rounded-2xl transition-all font-bold text-sm shadow-xs cursor-pointer disabled:opacity-50">
                          <span className="material-symbols-outlined text-xl text-rose-600">cancel</span>
                          <span>2º cancelado</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-on-surface-variant/70">2º tratamiento: {s2}</p>
                    </>
                  )}

                  {sE === 'en_atencion' && (
                    <button disabled={pend} onClick={() => estadoMutation.mutate({ estado: 'completada', citaId: S, soloEsta: true })}
                      className={cn(btnFull, 'border border-emerald-400 bg-emerald-600 text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700')}>
                      <span className="material-symbols-outlined text-lg">task_alt</span>
                      Completar 2º tratamiento · {s2}
                    </button>
                  )}

                  {devolver2 && (
                    <button disabled={pend}
                      onClick={() => {
                        const a = sE === 'cancelada' ? 'Llegó' : 'En atención';
                        if (window.confirm(`El 2º tratamiento (${s2}) vuelve a «${a}». El 1º no cambia. ¿Continuar?`)) {
                          estadoMutation.mutate({ estado: sE === 'cancelada' ? 'llego' : 'en_atencion', citaId: S, soloEsta: true });
                        }
                      }}
                      className={cn(btnFull, 'border border-outline-variant/40 bg-white hover:bg-surface-container text-on-surface')}>
                      <span className="material-symbols-outlined text-lg">undo</span>
                      {sE === 'cancelada' ? 'Devolver 2º tratamiento' : 'Reabrir 2º tratamiento'} · {s2}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* REPROGRAMAR — solo AGENDADAS: enviar a otro día/hora con validación de disponibilidad.
                Cita doble (bloque): se reprograma el bloque COMPLETO, si ninguna de las dos mitades avanzó. */}
            {puedeReprogramar && (esCombo ? bloqueReprogramable : (estadoNorm === 'agendada' || enRebote)) && !reprogramando && (
              <button
                onClick={() => setReprogramando(true)}
                data-testid="btn-reprogramar"
                className="w-full flex items-center justify-center gap-2 p-3 border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 rounded-2xl transition-all font-bold text-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">event_repeat</span>
                {enRebote
                  ? (esCombo ? 'Reagendar cita doble (sale del rebote)' : 'Reagendar (sale del rebote)')
                  : esCombo ? 'Reprogramar cita doble (otro día)' : 'Reprogramar cita (otro día)'}
              </button>
            )}

            {/* REBOTE — solo admin: enviar a rebote, o llamadas/descartar si ya está en rebote */}
            <ReboteDeLaCita
              cita={cita}
              grupo={esCombo ? [bloquePrincipal, bloqueSecundaria].filter((c): c is NonNullable<typeof c> => !!c) : []}
              onListo={onClose}
            />

            {/* MÉDICO DE LA CITA — el médico se la toma; admin/coordinación asignan */}
            <MedicoDeLaCita cita={cita} />

            {/* CONSENTIMIENTO — avisa antes del tratamiento y se firma aquí mismo */}
            <ConsentimientoDeLaCita cita={cita} />

            {/* SELECCIÓN DE CONSULTORIO (no aplica a citas canceladas o no asistidas) */}
            {totalConsultorios > 0 && estadoNorm !== 'cancelada' && estadoNorm !== 'no_show' && (
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <p className="font-headline-sm text-headline-sm text-on-surface text-sm font-bold">
                    Consultorio
                  </p>
                  <p className="text-xs text-on-surface-variant font-medium">
                    {cita.sede?.nombre || 'Sede'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: totalConsultorios }, (_, i) => i + 1).map((n) => {
                    const isSelected = consultorio === n;
                    return (
                      <button
                        key={n}
                        onClick={() => {
                          const nuevo = consultorio === n ? null : n;
                          setConsultorioLocal(nuevo);
                          consultorioMutation.mutate(nuevo);
                        }}
                        className={`w-11 h-10 rounded-xl text-xs font-bold transition-all flex items-center justify-center cursor-pointer ${
                          isSelected
                            ? 'bg-primary text-white border-2 border-primary shadow-md shadow-primary/20'
                            : 'bg-surface-container-lowest border border-outline-variant/30 text-on-surface hover:border-primary hover:text-primary'
                        }`}
                      >
                        C{n}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* PANEL DE REPROGRAMAR */}
            {reprogramando && (
              <div className="p-4 bg-primary/5 rounded-2xl border border-primary/20 space-y-4 animate-in fade-in duration-200">
                <p className="font-label-caps text-label-caps text-primary font-bold uppercase tracking-wider">
                  Reprogramar Cita
                </p>

                <div>
                  <p className="text-xs font-bold text-on-surface mb-2">Fecha</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {diasRapidos.map((d, i) => {
                      // «Hoy» solo si ES hoy: cuando la cita es de otra semana su propio día va primero y antes salía rotulado «Hoy».
                      const isHoy = format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                      const sel = format(d, 'yyyy-MM-dd') === fechaSelStr;
                      return (
                        <button
                          key={i}
                          onClick={() => setFechaSel(d)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                            sel
                              ? 'bg-primary text-white border-primary shadow-xs'
                              : 'bg-surface-container-lowest text-on-surface border-outline-variant/30 hover:border-primary'
                          }`}
                        >
                          {isHoy ? 'Hoy' : format(d, 'EEE d', { locale: es })}
                        </button>
                      );
                    })}
                    {/* Cualquier otra fecha (los atajos son solo los días cercanos) */}
                    <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      !diasRapidos.some((d) => format(d, 'yyyy-MM-dd') === fechaSelStr)
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-surface-container-lowest text-on-surface border-outline-variant/30 hover:border-primary'
                    }`} title="Elegir otra fecha">
                      <span className="material-symbols-outlined text-[15px]">calendar_month</span>
                      <input
                        type="date"
                        value={fechaSelStr}
                        min={format(new Date(), 'yyyy-MM-dd')}
                        onChange={(e) => { if (e.target.value) setFechaSel(new Date(e.target.value + 'T12:00:00')); }}
                        data-testid="reprogramar-fecha"
                        className="bg-transparent outline-none text-xs font-semibold w-[118px] [color-scheme:light] text-inherit"
                      />
                    </label>
                  </div>
                </div>

                {/* Baropodometría con 2+ máquinas en la sede: se elige la MÁQUINA (Baro 1 / Baro 2), no un profesional. */}
                {elegirMaquina && (
                  <div data-testid="reprogramar-maquina-baro">
                    <p className="text-xs font-bold text-on-surface mb-2">Baro (máquina)</p>
                    <div className="grid grid-cols-2 gap-2">
                      {maquinasBaro.map((m) => {
                        const sel = profSel === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => setProfSel(m.id)}
                            data-maquina={`${m.nombres} ${m.apellidos}`.trim()}
                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all text-left ${
                              sel
                                ? 'bg-primary text-white border-primary shadow-xs'
                                : 'bg-surface-container-lowest text-on-surface border-outline-variant/30 hover:border-primary'
                            }`}
                          >
                            <span className={`material-symbols-outlined text-base ${sel ? 'text-white' : 'text-primary'}`}>monitor_heart</span>
                            <span className="truncate">{`${m.nombres} ${m.apellidos}`.trim()}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* En baro con una sola máquina no hay nada que elegir: el servidor la pone como siempre. */}
                {!esBaro && (
                <div>
                  <p className="text-xs font-bold text-on-surface mb-2">Profesional</p>
                  {profesionales ? (
                    <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                      {profesionales
                        .filter((p) => p.tipo !== 'medico' || !p.nombres.startsWith('Baro'))
                        .map((p: Profesional) => {
                          const nombre = `${p.nombres.split(' ')[0]} ${p.apellidos.split(' ')[0]}`;
                          const sel = profSel === p.id;
                          return (
                            <button
                              key={p.id}
                              onClick={() => setProfSel(p.id)}
                              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all text-left truncate ${
                                sel
                                  ? 'bg-primary text-white border-primary shadow-xs'
                                  : 'bg-surface-container-lowest text-on-surface border-outline-variant/30 hover:border-primary'
                              }`}
                            >
                              <span
                                className="w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0 font-mono text-[9px] font-bold"
                                style={{ backgroundColor: p.colorAvatar || '#0044ab' }}
                              >
                                {p.nombres[0]}
                                {p.apellidos[0]}
                              </span>
                              <span className="truncate">{nombre}</span>
                            </button>
                          );
                        })}
                    </div>
                  ) : (
                    <p className="text-xs text-on-surface-variant">Cargando profesionales...</p>
                  )}
                </div>
                )}

                <div>
                  <p className="text-xs font-bold text-on-surface mb-2">Hora</p>
                  <div className="grid grid-cols-5 gap-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                    {SLOTS.filter((slot) => horaInicioValidaParaDuracion(slot, duracionBloque)).map((slot) => {
                      const ocupado = slotsOcupados.has(slot) || dispoReprogCargando || !slotsAgendables.has(slot);
                      const sel = horaSel === slot;
                      return (
                        <button
                          key={slot}
                          disabled={ocupado}
                          onClick={() => setHoraSel(slot)}
                          className={`py-1.5 rounded-lg text-xs font-mono font-semibold transition-all border ${
                            sel
                              ? 'bg-primary text-white border-primary shadow-xs'
                              : ocupado
                              ? 'bg-surface-container-high text-on-surface-variant/40 border-transparent cursor-not-allowed line-through'
                              : 'bg-surface-container-lowest text-on-surface border-outline-variant/30 hover:border-primary'
                          }`}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => moverMutation.mutate()}
                    // La hora elegida debe seguir LIBRE para el día y profesional marcados: al cambiar de día la hora
                    // anterior quedaba seleccionada aunque saliera tachada, y se enviaba igual.
                    disabled={moverMutation.isPending || !profSel || !horaSel || dispoReprogCargando || slotsOcupados.has(horaSel) || !slotsAgendables.has(horaSel)}
                    title={!dispoReprogCargando && horaSel && (slotsOcupados.has(horaSel) || !slotsAgendables.has(horaSel)) ? 'Esa hora no está libre ese día: elige otra' : undefined}
                    className="flex-1 bg-primary text-white py-2 rounded-xl text-xs font-bold shadow-md shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    {moverMutation.isPending ? 'Guardando...' : 'Confirmar cambio'}
                  </button>
                  <button
                    onClick={() => setReprogramando(false)}
                    className="px-4 py-2 bg-surface-container border border-outline-variant/30 text-on-surface rounded-xl text-xs font-bold hover:bg-surface-container-high transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* COMPROBANTE DE PAGO */}
            {cita.comprobanteUrl && (
              <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base">receipt_long</span>
                  Comprobante de pago
                </p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-emerald-800 truncate font-medium">
                    {cita.comprobanteNombre || 'Comprobante adjuntado'}
                  </span>
                  <button
                    onClick={() => window.open(urlArchivo(cita.comprobanteUrl!), '_blank')}
                    className="text-xs font-bold text-primary hover:underline shrink-0 flex items-center gap-1"
                  >
                    <span>Abrir</span>
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                  </button>
                </div>
              </div>
            )}

            {/* SECCIÓN DE COMENTARIOS */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <p className="font-headline-sm text-headline-sm text-on-surface text-sm font-bold">
                  Comentarios
                </p>
                {!editandoComentario && (
                  <button
                    onClick={() => setEditandoComentario(true)}
                    className="text-primary font-bold text-xs hover:underline transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    Agregar
                  </button>
                )}
              </div>

              {comentarios.length > 0 ? (
                <div className="space-y-2">
                  {/* Del más nuevo al más viejo (29-sep-2026). */}
                  {[...comentarios].sort((a, b) => (b.creadoEn ?? '').localeCompare(a.creadoEn ?? '')).map((c) => (
                    // Editable (30-sep-2026): el autor los suyos, admin cualquiera.
                    <ComentarioCitaItem key={c.id} citaId={cita.id} c={c} fmt={fmtComentario} variante="detalle" />
                  ))}
                </div>
              ) : (
                !editandoComentario && (
                  <p className="text-xs text-on-surface-variant/60 italic bg-surface-container-low/40 p-3 rounded-xl border border-outline-variant/15 text-center">
                    Sin comentarios asignados
                  </p>
                )
              )}

              {editandoComentario && (
                <div className="space-y-2 animate-in fade-in duration-150">
                  <textarea
                    className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                    rows={3}
                    placeholder="Escribe un comentario interno..."
                    value={nuevoComentario}
                    onChange={(e) => setNuevoComentario(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => comentarioMutation.mutate(nuevoComentario)}
                      disabled={comentarioMutation.isPending || !nuevoComentario.trim()}
                      className="bg-primary text-white px-4 py-1.5 rounded-xl text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {comentarioMutation.isPending ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button
                      onClick={() => {
                        setNuevoComentario('');
                        setEditandoComentario(false);
                      }}
                      className="bg-surface-container border border-outline-variant/30 text-on-surface px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-surface-container-high transition-all cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Ficha previa de 10 segundos (2.8): lo que hay que saber antes de entrar (solo con hc.ver) */}
            {puedeVerHc && <FichaPreviaCard ficha={fichaPrevia} cargando={cargandoFicha} />}

            {/* HISTORIA CLÍNICA: único toque de la agenda al módulo clínico. Solo visible con hc.ver y
                cuando el paciente ya fue atendido (llegó / en atención / completada). */}
            {puedeVerHc && ['llego', 'en_atencion', 'completada'].includes(estadoNorm) && (
              resumenAtencion?.atencionId ? (
                <button
                  onClick={irAHistoriaClinica}
                  className="w-full flex items-center justify-center gap-2 p-3 border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-2xl transition-all font-bold text-sm cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">clinical_notes</span>
                  Ver atención clínica
                  <span className="text-[11px] font-semibold text-emerald-700/80">· {resumenAtencion.totalNotas ?? 0} nota(s) · {resumenAtencion.totalDiagnosticos ?? 0} dx{resumenAtencion.totalRecetas ? ` · ${resumenAtencion.totalRecetas} receta(s)` : ''}</span>
                </button>
              ) : puedeRegistrarHc ? (
                <button
                  onClick={irAHistoriaClinica}
                  className="w-full flex items-center justify-center gap-2 p-3 border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 rounded-2xl transition-all font-bold text-sm cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">clinical_notes</span>
                  Registrar atención clínica
                </button>
              ) : null
            )}

            {/* Antes de «Llegó» no había NINGÚN acceso a la historia desde la cita: el médico (que no cambia estados)
                abría una cita «Agendada» y creía que no tenía acceso, mientras recepción sí lo veía al marcar «Llegó».
                Ver la historia del paciente no depende del estado; REGISTRAR la atención sí (el paciente debe haber llegado). */}
            {puedeVerHc && !['llego', 'en_atencion', 'completada'].includes(estadoNorm) && (
              <div>
                <button
                  onClick={() => { onClose(); navigate(`/historia-clinica/${cita.pacienteId}`); }}
                  data-testid="ver-hc-paciente"
                  className="w-full flex items-center justify-center gap-2 p-3 border border-outline-variant text-on-surface bg-surface-container-low hover:bg-surface-container rounded-2xl transition-all font-bold text-sm cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">clinical_notes</span>
                  Ver historia clínica del paciente
                </button>
                {puedeRegistrarHc && !['cancelada', 'no_show', 'reprogramada'].includes(estadoNorm) && (
                  <p className="text-[11px] text-on-surface-variant text-center mt-1.5">Para registrar la atención de esta cita, recepción debe marcar primero «Llegó».</p>
                )}
              </div>
            )}

            {/* BOTÓN GENEXIS (SI APLICA) */}
            <div className="empty:hidden">
              <BotonHistorialGenexis
                pacienteId={cita.paciente.id}
                nombrePaciente={nombrePaciente}
                documento={`${cita.paciente.tipoDocumento ?? ''} ${cita.paciente.numeroDocumento ?? ''}`.trim()}
              />
            </div>

            {/* HISTORIAL COLLAPSIBLE */}
            <div className="border border-outline-variant/20 rounded-2xl overflow-hidden">
              <button
                onClick={() => setVerHistorial((prev) => !prev)}
                className="w-full p-4 flex justify-between items-center hover:bg-surface-container-low transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-on-surface-variant/60">history</span>
                  <span className="font-headline-sm text-headline-sm text-sm font-bold text-on-surface">
                    Historial del paciente
                  </span>
                  {datosPaciente && (
                    <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-full">
                      {datosPaciente.totalCitas} atenciones
                    </span>
                  )}
                </div>
                <span
                  className={`material-symbols-outlined text-on-surface-variant transition-transform duration-300 ${
                    verHistorial ? 'rotate-180' : ''
                  }`}
                >
                  expand_more
                </span>
              </button>

              {verHistorial && (
                <div className="p-4 border-t border-outline-variant/15 bg-surface-container-low/30 space-y-3 animate-in fade-in duration-200">
                  {loadingHistorial ? (
                    <p className="text-xs text-on-surface-variant text-center py-2">
                      Cargando historial...
                    </p>
                  ) : datosPaciente?.historial.length === 0 ? (
                    <p className="text-xs text-on-surface-variant/60 italic text-center py-2">
                      Sin atenciones previas
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                      {datosPaciente?.historial.map((h: HistorialCita) => {
                        const esCitaActual = h.id === cita.id;
                        const fecha = new Date(h.fecha.slice(0, 10) + 'T12:00:00');
                        return (
                          <React.Fragment key={h.id}>
                            <div
                              onClick={() => seleccionarCitaPorId(h.id)}
                              title="Haz clic para seleccionar esta cita y gestionar su estado"
                              className={`p-3 rounded-xl border text-xs space-y-1 transition-all cursor-pointer hover:border-primary ${
                                esCitaActual
                                  ? 'bg-primary/5 border-primary/30 shadow-xs'
                                  : 'bg-surface-container-lowest border-outline-variant/20 hover:bg-surface-container-low'
                              }`}
                            >
                              <div className="flex justify-between items-center gap-2">
                                <span className="font-bold text-on-surface truncate flex items-center gap-1">
                                  <span>{h.servicio.nombre}</span>
                                  {esCitaActual && (
                                    <span className="text-[10px] text-primary font-bold">(Seleccionada)</span>
                                  )}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-surface-container text-on-surface-variant uppercase">
                                  {h.estado}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
                                <span>{format(fecha, "d 'de' MMM, yyyy", { locale: es })}</span>
                                <span>·</span>
                                <span>{h.horaInicio}</span>
                                <span>·</span>
                                <span>{h.sede.nombre}</span>
                              </div>
                            </div>
                            {/* Registro de reprogramación (solo lectura): el slot ORIGINAL de donde salió */}
                            {h.reprogramada && (
                              <div className="p-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 text-xs space-y-1">
                                <div className="flex justify-between items-center gap-2">
                                  <span className="font-bold text-indigo-900 truncate flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[13px]">event_repeat</span>
                                    <span>{h.servicio.nombre}</span>
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-700 uppercase">
                                    Reprogramada
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-indigo-500">
                                  <span>{h.reprogramadaDe ? format(new Date(h.reprogramadaDe + 'T12:00:00'), "d 'de' MMM, yyyy", { locale: es }) : format(fecha, "d 'de' MMM, yyyy", { locale: es })}</span>
                                  {h.reprogramadaDeHora && (<><span>·</span><span>{h.reprogramadaDeHora}</span></>)}
                                  <span>·</span>
                                  <span>{h.sede.nombre}</span>
                                </div>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* FOOTER ACTION */}
          <div className="p-6 border-t border-outline-variant/20 space-y-3 bg-surface-container-lowest rounded-b-2xl">
            {/* Cancelar solo mientras el servidor lo acepta (agendada, confirmada o llegó); en atención ya no.
                El admin cancela en cualquier estado (14-oct-2026); se lee el rol sin hook. */}
            {puedeCancelar && (['agendada', 'confirmada', 'llego'].includes(estadoNorm) ||
              (useAuthStore.getState().usuario?.rol === 'admin' && !['cancelada', 'reprogramada'].includes(estadoNorm))) && (
              <>
                {!cancelando ? (
                  <button
                    onClick={() => setCancelando(true)}
                    className="w-full border border-rose-200 text-rose-600 font-bold py-3 rounded-xl hover:bg-rose-50 transition-all flex items-center justify-center gap-2 cursor-pointer text-xs"
                  >
                    <span className="material-symbols-outlined text-base">delete</span>
                    Cancelar cita
                  </button>
                ) : (
                  <div className="space-y-2 p-3 bg-rose-50 rounded-xl border border-rose-200 animate-in fade-in duration-150">
                    <input
                      className="w-full bg-white border border-rose-300 rounded-lg px-3 py-2 text-xs text-on-surface outline-none focus:ring-2 focus:ring-rose-400"
                      placeholder="Motivo de cancelación..."
                      value={motivoCancelacion}
                      onChange={(e) => setMotivoCancelacion(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => estadoMutation.mutate({ estado: 'cancelada' })}
                        disabled={estadoMutation.isPending}
                        className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 rounded-lg text-xs transition-all cursor-pointer disabled:opacity-50"
                      >
                        Confirmar cancelación
                      </button>
                      <button
                        onClick={() => setCancelando(false)}
                        className="px-4 bg-white border border-outline-variant/30 text-on-surface font-bold py-2 rounded-lg text-xs hover:bg-surface-container transition-all cursor-pointer"
                      >
                        Volver
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* En negro y negrita para que se lea (antes era gris muy tenue). */}
            <p className="text-center font-mono text-[11px] uppercase tracking-tight text-on-surface font-semibold" data-campo="creada-por">
              Creada: {format(new Date(cita.creadoEn ?? Date.now()), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
              {cita.creadoPorUsuario && <> · por <b className="font-extrabold">{cita.creadoPorUsuario.nombre}</b></>}
            </p>
          </div>
        </div>
      </div>

      {/* Diálogo de consumo de un clic tras marcar llegada */}
      {dialogoConsumo && (
        <DialogoConsumo
          citaId={cita.id}
          pacienteId={cita.paciente.id}
          elegibles={elegiblesConsumo}
          onCerrar={() => {
            setDialogoConsumo(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
