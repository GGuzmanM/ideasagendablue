import React from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  useIdea1DetalleCita,
  type UseIdea1DetalleCitaProps,
} from '../../services/idea1DetalleCitaService';
import { DialogoConsumo, SaldoPaquetes } from '../pacientes/SaldoPaquetes';
import { BotonHistorialGenexis } from '../pacientes/HistorialGenexis';
import { RomboAlerta } from '../pacientes/RomboAlerta';
import { CuadroFamiliares } from '../pacientes/CuadroFamiliares';
import { ToggleDatosPaciente } from '../pacientes/ToggleDatosPaciente';
import { BadgeAsistencia } from '../pacientes/BadgeAsistencia';
import { formatPromoValor } from '../../api/promociones';
import { horaInicioValidaParaDuracion } from '@limablue/shared';
import { cn } from '../../utils/cn';
import type { HistorialCita, Profesional } from '../../api';

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
    citaExon,
    estadoMutation,
    exonerarMut,
    canalesOpts,
    canalSel,
    setCanalSel,
    canalMutation,
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
    totalConsultorios,
    SLOTS,
  } = useIdea1DetalleCita(props);

  return (
    <>
      <div
        className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        <div
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
                    <span className="truncate max-w-[280px]" title={nombrePaciente}>
                      {nombrePaciente}
                    </span>
                  </h2>
                  <div className="font-body-md text-on-surface-variant flex items-center gap-2 mt-1 flex-wrap text-xs">
                    <span>{cita.paciente.telefono || 'Sin teléfono'}</span>
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
                {estadoNorm === 'llego' ? 'LLEGÓ' : cita.estado}
              </span>

              <BadgeAsistencia alerta={cita.paciente.alerta ?? datosPaciente?.alerta} />

              {cita.paquetePaciente && cita.sesionNumero && (
                <span className="bg-surface-container-high text-on-surface-variant px-2.5 py-1 rounded-lg text-label-caps border border-outline-variant/10 font-bold">
                  Sesión #{cita.sesionNumero} de {cita.paquetePaciente.sesionesTotal}
                </span>
              )}

              {cita.comprobanteUrl && (
                <a
                  href={cita.comprobanteUrl}
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
                      <span className="font-bold">🚫 Sesión de láser no descontada</span>
                      {citaExon.sesionExoneradaMotivo && <span className="text-rose-600"> · {citaExon.sesionExoneradaMotivo}</span>}
                      <span className="block text-[11px] text-rose-500 mt-0.5">Láser no aplicado — el paciente conserva la sesión.</span>
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
                      const motivo = window.prompt('Motivo (opcional) — ej. el médico indicó no aplicar el láser:', 'Láser no aplicado');
                      if (motivo === null) return;
                      exonerarMut.mutate({ exonerar: true, motivo: motivo.trim() || undefined });
                    }}
                    disabled={exonerarMut.isPending}
                    className="w-full text-xs font-semibold text-on-surface-variant bg-surface-container-lowest border border-outline-variant/40 rounded-xl py-2 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-base">block</span>
                    No descontar sesión (láser no aplicado)
                  </button>
                )}
              </div>
            )}

            {/* INFO GRID */}
            <div className="grid grid-cols-[110px_1fr] gap-y-4 items-center bg-surface-container-low/30 p-4 rounded-2xl border border-outline-variant/20">
              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Servicio</div>
              <div className="font-body-lg text-on-surface font-bold tracking-tight uppercase flex items-center gap-2 flex-wrap">
                <span>{cita.servicio?.nombre}</span>
                {cita.subcategoria && (
                  <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold normal-case">
                    {cita.subcategoria.nombre}
                  </span>
                )}
              </div>

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Hora</div>
              <div className="font-body-lg text-on-surface font-semibold">
                {cita.horaInicio} · {cita.duracionMinutos} min
              </div>

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Estado</div>
              <div className="relative">
                <select
                  value={estadoNorm}
                  onChange={(e) => estadoMutation.mutate({ estado: e.target.value })}
                  disabled={estadoMutation.isPending}
                  className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-1.5 text-xs font-bold text-on-surface outline-none focus:ring-2 focus:ring-primary/20 appearance-none hover:border-primary/40 transition-colors uppercase"
                >
                  <option value="agendada">AGENDADA</option>
                  <option value="confirmada">CONFIRMADA</option>
                  <option value="llego">LLEGÓ</option>
                  <option value="en_atencion">EN ATENCIÓN</option>
                  <option value="completada">COMPLETADA</option>
                  <option value="no_show">NO SHOW</option>
                  <option value="cancelada">CANCELADA</option>
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant/60 text-base">
                  expand_more
                </span>
              </div>

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Profesional</div>
              <div className="flex items-center gap-2 font-body-lg text-primary font-semibold">
                {!esFinal ? (
                  <button
                    onClick={() => setReprogramando((prev) => !prev)}
                    className="flex items-center gap-1.5 hover:underline transition-all text-left"
                  >
                    <span>{profActual}</span>
                    <span className="material-symbols-outlined text-sm text-primary">edit</span>
                  </button>
                ) : (
                  <span>{profActual}</span>
                )}
              </div>

              {cita.solicitadoProfesional && (
                <>
                  <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Solicitado</div>
                  <div className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1 inline-flex items-center gap-1">
                    <span>🙋 Solo {cita.solicitadoProfesional.nombres}</span>
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

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Canal</div>
              <div className="relative">
                <select
                  value={canalSel}
                  onChange={(e) => {
                    setCanalSel(e.target.value);
                    canalMutation.mutate(e.target.value);
                  }}
                  disabled={canalMutation.isPending}
                  className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-1.5 text-xs font-medium text-on-surface outline-none focus:ring-2 focus:ring-primary/20 appearance-none hover:border-primary/40 transition-colors"
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
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant/60 text-base">
                  expand_more
                </span>
              </div>

              <div className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">Promoción</div>
              <div className="relative">
                {esSecundariaBloque ? (
                  <span className="text-xs text-on-surface-variant font-medium">
                    {promoHeredada
                      ? `🎁 ${promoHeredada.nombre} (del bloque)`
                      : '— Ninguna (del bloque)'}
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

            {/* CONFIRMACIÓN POR CORREO */}
            {!esFinal && (
              <div className="bg-primary/5 rounded-2xl p-4 flex justify-between items-center border border-primary/10">
                <div>
                  <p className="font-label-caps text-label-caps text-primary font-bold">
                    Confirmación por correo
                  </p>
                  <p className="text-xs text-on-surface-variant/70 mt-0.5 font-medium">
                    {cita.estadoConfirmacion === 'confirmada'
                      ? `✓ Confirmada por paciente`
                      : cita.confirmacionEnviadaEn
                      ? `Correo enviado`
                      : 'Aún no se ha enviado'}
                  </p>
                </div>
                <button
                  onClick={() => confirmarMailMutation.mutate()}
                  disabled={confirmarMailMutation.isPending}
                  className="bg-surface-container-lowest hover:bg-primary hover:text-white text-primary border border-primary/20 px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm font-bold disabled:opacity-50 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">mail</span>
                  {confirmarMailMutation.isPending ? 'Enviando...' : 'Reenviar correo'}
                </button>
              </div>
            )}

            {/* BOTONES DE ASISTENCIA ("¿Vino el paciente?") */}
            {!esFinal && (estadoNorm === 'agendada' || estadoNorm === 'confirmada' || estadoNorm === 'llego' || estadoNorm === 'en_atencion') && (
              <div className="space-y-3">
                <p className="font-headline-sm text-headline-sm text-on-surface text-sm font-bold">
                  ¿Vino el paciente?
                </p>
                {(estadoNorm === 'agendada' || estadoNorm === 'confirmada') && (
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
                {estadoNorm === 'llego' && (
                  <button
                    onClick={() => estadoMutation.mutate({ estado: 'en_atencion' })}
                    disabled={estadoMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 p-3.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-2xl transition-all font-bold text-sm cursor-pointer shadow-xs"
                  >
                    <span className="material-symbols-outlined text-lg">play_arrow</span>
                    En atención
                  </button>
                )}
                {estadoNorm === 'en_atencion' && (
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

            {/* SELECCIÓN DE CONSULTORIO */}
            {totalConsultorios > 0 && (
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
                      const isHoy = i === 0;
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
                  </div>
                </div>

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

                <div>
                  <p className="text-xs font-bold text-on-surface mb-2">Hora</p>
                  <div className="grid grid-cols-5 gap-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                    {SLOTS.filter((slot) => horaInicioValidaParaDuracion(slot, cita.duracionMinutos)).map((slot) => {
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
                    disabled={moverMutation.isPending || !profSel || !horaSel}
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
                    onClick={() => window.open(cita.comprobanteUrl!, '_blank')}
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
                  {comentarios.map((c) => (
                    <div
                      key={c.id}
                      className="bg-surface-container-low rounded-xl p-3.5 border border-outline-variant/20 relative"
                    >
                      <p className="text-xs text-on-surface font-medium whitespace-pre-wrap leading-relaxed">
                        "{c.texto}"
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-on-surface-variant/60 font-mono font-medium pt-2.5 mt-2 border-t border-outline-variant/10">
                        <span>{c.autor?.nombre ?? c.autorEtiqueta ?? 'Sistema'}</span>
                        <span>{fmtComentario(c.creadoEn)}</span>
                      </div>
                    </div>
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
                          <div
                            key={h.id}
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
            {!esFinal && (
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

            <p className="text-center font-mono text-[10px] uppercase tracking-tighter text-on-surface-variant/40">
              Creada: {format(new Date(cita.creadoEn ?? Date.now()), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
              {cita.creadoPorUsuario && ` · por ${cita.creadoPorUsuario.nombre}`}
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
