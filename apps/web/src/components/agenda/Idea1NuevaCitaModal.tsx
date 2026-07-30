import React from 'react';
import {
  useIdea1NuevaCitaForm,
  type UseIdea1NuevaCitaFormProps,
} from '../../services/idea1NuevaCitaService';
import { RomboAlerta } from '../pacientes/RomboAlerta';
import { VisorHistorialGenexis } from '../pacientes/HistorialGenexis';

export function Idea1NuevaCitaModal(props: UseIdea1NuevaCitaFormProps) {
  const {
    sedeId,
    setSedeId,
    unidadNegocioId,
    setUnidadNegocioId,
    sedesDisponibles,
    unidadesDeSede,
    permitirCambiarSede,
    modoPaciente,
    setModoPaciente,
    pacienteQuery,
    setPacienteQuery,
    pacienteSeleccionado,
    setPacienteSeleccionado,
    npNombres,
    setNpNombres,
    npApellidoPaterno,
    setNpApellidoPaterno,
    npApellidoMaterno,
    setNpApellidoMaterno,
    npTipoDoc,
    setNpTipoDoc,
    npNumDoc,
    setNpNumDoc,
    npTelefono,
    setNpTelefono,
    npEmail,
    setNpEmail,
    npFechaNacimiento,
    setNpFechaNacimiento,
    npSexo,
    setNpSexo,
    npCanalId,
    setNpCanalId,
    npEdad,
    puedeBuscarDni,
    buscarPorDocumento,
    dniConsultando,
    servicioId,
    setServicioId,
    subcategoriaId,
    setSubcategoriaId,
    paquetePacienteId,
    setPaquetePacienteId,
    membSel,
    setMembSel,
    membItem,
    setMembItem,
    membInicio,
    setMembInicio,
    membFin,
    setMembFin,
    canal,
    setCanal,
    promocionId,
    setPromocionId,
    profesionalId,
    setProfesionalId,
    fechaCita,
    setFechaCita,
    horaCita,
    setHoraCita,
    comentarioRecepcion,
    setComentarioRecepcion,
    combinar,
    setCombinar,
    extraServicioId,
    setExtraServicioId,
    extraProfesionalId,
    setExtraProfesionalId,
    verVisorGenexis,
    setVerVisorGenexis,
    comprobante,
    setComprobante,
    subiendo,
    inputFileRef,

    servicios,
    subcategorias,
    profesionales,
    resultadosPacientes,
    buscandoPacientes,
    canales,
    promociones,
    paquetesPaciente,
    membresiasActivas,
    tplsMembresiaActivas,
    membComposicion,
    existeGenexis,
    esServicioAncla,
    combinablesActivos,
    sedeCerradaEseDia,

    handleSubirComprobante,
    handleAgendar,
    isPending,
    opcionesHoras,
    fechaHeader,
  } = useIdea1NuevaCitaForm(props);

  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-surface-container-lowest w-full max-w-[640px] max-h-[90vh] rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200">
        
        {/* Header con color PÚRPURA/ÍNDIGO vibrante explícito bg-[#3525cd] */}
        <div className="bg-[#3525cd] text-white p-6 flex justify-between items-start shrink-0 shadow-md">
          <div>
            <h2 className="font-headline-md text-headline-md font-bold text-white tracking-tight">Nueva Cita</h2>
            <p className="font-body-md text-body-md text-white/90 mt-1 flex items-center gap-2 text-sm font-medium">
              <span className="material-symbols-outlined text-base">event</span>
              <span className="capitalize">{fechaHeader}</span> · <span className="font-mono font-bold">{horaCita}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="p-2 hover:bg-white/20 rounded-xl transition-colors text-white cursor-pointer"
            title="Cerrar (Esc)"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          
          {/* Advertencia si la Sede está Cerrada ese día */}
          {sedeCerradaEseDia && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-red-800 text-xs font-bold">
              <span className="material-symbols-outlined text-red-600 text-lg">warning</span>
              <span>Atención: La sede está configurada como CERRADA en la fecha seleccionada.</span>
            </div>
          )}

          {/* Selector de Sede / Especialidad (solo al abrir desde la ficha del paciente) */}
          {permitirCambiarSede && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
                  SEDE <span className="text-error">*</span>
                </label>
                <div className="relative">
                  <select
                    value={sedeId}
                    onChange={(e) => setSedeId(e.target.value)}
                    className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-medium text-on-surface"
                  >
                    <option value="">Seleccionar sede...</option>
                    {sedesDisponibles.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">
                    location_on
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
                  ESPECIALIDAD <span className="text-error">*</span>
                </label>
                <div className="relative">
                  <select
                    value={unidadNegocioId}
                    onChange={(e) => setUnidadNegocioId(e.target.value)}
                    className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-medium text-on-surface"
                  >
                    <option value="">Seleccionar especialidad...</option>
                    {unidadesDeSede.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">
                    expand_more
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Selector de Paciente */}
          <div className="space-y-3">
            <label className="font-label-caps text-label-caps text-on-surface-variant flex items-center gap-1 text-[11px] font-bold">
              PACIENTE <span className="text-error font-bold">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setModoPaciente('existente')}
                className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-all duration-200 cursor-pointer ${
                  modoPaciente === 'existente'
                    ? 'border-primary bg-primary/5 text-primary shadow-sm font-bold'
                    : 'border-outline-variant/60 hover:border-primary/50 text-on-surface-variant'
                }`}
              >
                <span className="material-symbols-outlined text-2xl mb-1.5">person</span>
                <span className="font-headline-sm text-sm font-bold">Paciente existente</span>
                <span className="text-xs opacity-75 font-normal">Ya está registrado</span>
              </button>

              <button
                type="button"
                onClick={() => setModoPaciente('nuevo')}
                className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-all duration-200 cursor-pointer ${
                  modoPaciente === 'nuevo'
                    ? 'border-primary bg-primary/5 text-primary shadow-sm font-bold'
                    : 'border-outline-variant/60 hover:border-primary/50 text-on-surface-variant'
                }`}
              >
                <span className="material-symbols-outlined text-2xl mb-1.5">person_add</span>
                <span className="font-headline-sm text-sm font-bold">Paciente nuevo</span>
                <span className="text-xs opacity-75 font-normal">Registrar por primera vez</span>
              </button>
            </div>

            {/* Búsqueda de Paciente Existente */}
            {modoPaciente === 'existente' && (
              <div className="mt-3 space-y-3">
                {pacienteSeleccionado ? (
                  <div className="p-3.5 bg-primary/5 border border-primary/30 rounded-xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                        {pacienteSeleccionado.nombreCompleto.charAt(0)}
                      </div>
                      <div className="overflow-hidden">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-sm text-on-surface truncate">{pacienteSeleccionado.nombreCompleto}</p>
                          {pacienteSeleccionado.alerta && <RomboAlerta alerta={pacienteSeleccionado.alerta} />}
                        </div>
                        <p className="text-xs text-on-surface-variant">
                          Doc: {pacienteSeleccionado.numeroDocumento || 'Sin doc'} · Tel: {pacienteSeleccionado.telefono}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {existeGenexis && (
                        <button
                          type="button"
                          onClick={() => setVerVisorGenexis(true)}
                          className="px-2.5 py-1 bg-amber-500/10 text-amber-800 border border-amber-500/30 rounded-lg text-xs font-bold hover:bg-amber-500/20"
                        >
                          Historial Genexis
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPacienteSeleccionado(null)}
                        className="text-xs font-bold text-error hover:underline px-2 py-1 cursor-pointer"
                      >
                        Cambiar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-outline text-lg">
                      search
                    </span>
                    <input
                      type="text"
                      value={pacienteQuery}
                      onChange={(e) => setPacienteQuery(e.target.value)}
                      placeholder="Buscar por DNI, Nombre o Apellidos..."
                      className="w-full bg-surface-container-low border border-outline-variant rounded-xl pl-10 pr-4 py-3 font-body-md text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                    {buscandoPacientes && (
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-primary font-semibold">
                        Buscando...
                      </span>
                    )}

                    {/* Lista de resultados */}
                    {resultadosPacientes.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-surface-container-lowest border border-outline-variant/50 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto custom-scrollbar p-1">
                        {resultadosPacientes.map((pac: any) => {
                          const nombreComp = `${pac.nombres} ${pac.apellidoPaterno} ${pac.apellidoMaterno || ''}`.trim();
                          return (
                            <button
                              key={pac.id}
                              type="button"
                              onClick={() => {
                                setPacienteSeleccionado({
                                  id: pac.id,
                                  nombres: pac.nombres,
                                  apellidoPaterno: pac.apellidoPaterno,
                                  apellidoMaterno: pac.apellidoMaterno,
                                  nombreCompleto: nombreComp,
                                  telefono: pac.telefono,
                                  numeroDocumento: pac.numeroDocumento,
                                  alerta: pac.alerta,
                                  familiares: pac.familiares,
                                });
                                setPacienteQuery('');
                              }}
                              className="w-full flex items-center justify-between p-2.5 hover:bg-primary/5 rounded-lg text-left transition-colors border-b border-outline-variant/10 last:border-0 cursor-pointer"
                            >
                              <div>
                                <p className="font-bold text-sm text-on-surface">{nombreComp}</p>
                                <p className="text-xs text-on-surface-variant">
                                  DNI/Doc: {pac.numeroDocumento || '-'} · Tel: {pac.telefono}
                                </p>
                              </div>
                              <span className="material-symbols-outlined text-primary text-sm">chevron_right</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Formulario de Nuevo Paciente con RENIEC auto-fill */}
            {modoPaciente === 'nuevo' && (
              <div className="mt-3 p-4 bg-surface-container-low/50 border border-outline-variant/40 rounded-xl space-y-3 animate-in fade-in">
                <div className="grid grid-cols-[120px_1fr_auto] gap-3 items-end">
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Tipo Documento</label>
                    <select
                      value={npTipoDoc}
                      onChange={(e) => setNpTipoDoc(e.target.value as any)}
                      className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm outline-none focus:border-primary font-medium"
                    >
                      <option value="DNI">DNI (Perú)</option>
                      <option value="CE">Carné Ext. (CE)</option>
                      <option value="PASAPORTE">Pasaporte</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">
                      N° Documento {npTipoDoc === 'DNI' && '(RENIEC)'}
                    </label>
                    <input
                      type="text"
                      value={npNumDoc}
                      onChange={(e) => setNpNumDoc(npTipoDoc === 'DNI' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          buscarPorDocumento();
                        }
                      }}
                      maxLength={npTipoDoc === 'DNI' ? 8 : 20}
                      inputMode={npTipoDoc === 'DNI' ? 'numeric' : 'text'}
                      placeholder={npTipoDoc === 'DNI' ? '8 dígitos' : 'Número doc'}
                      className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm outline-none focus:border-primary font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={buscarPorDocumento}
                    disabled={!puedeBuscarDni || dniConsultando}
                    title={npTipoDoc === 'DNI' ? 'Buscar en RENIEC / PeruDevs' : 'La búsqueda solo aplica a DNI'}
                    className="px-4 rounded-lg bg-primary text-on-primary font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5 whitespace-nowrap h-[38px]"
                  >
                    <span className="material-symbols-outlined text-lg">
                      {dniConsultando ? 'progress_activity' : 'search'}
                    </span>
                    {dniConsultando ? 'Buscando…' : 'Buscar'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Nombres *</label>
                    <input
                      type="text"
                      value={npNombres}
                      onChange={(e) => setNpNombres(e.target.value)}
                      placeholder="Ej. Juan Carlos"
                      className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Apellido Paterno *</label>
                    <input
                      type="text"
                      value={npApellidoPaterno}
                      onChange={(e) => setNpApellidoPaterno(e.target.value)}
                      placeholder="Ej. Pérez"
                      className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Apellido Materno</label>
                    <input
                      type="text"
                      value={npApellidoMaterno}
                      onChange={(e) => setNpApellidoMaterno(e.target.value)}
                      placeholder="Ej. García"
                      className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Teléfono / WhatsApp *</label>
                    <input
                      type="text"
                      value={npTelefono}
                      onChange={(e) => setNpTelefono(e.target.value)}
                      placeholder="Ej. 987654321"
                      className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm outline-none focus:border-primary font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Fecha Nacimiento</label>
                    <input
                      type="date"
                      value={npFechaNacimiento}
                      onChange={(e) => setNpFechaNacimiento(e.target.value)}
                      className="w-full bg-white border border-outline-variant rounded-lg px-2.5 py-2 text-xs font-medium outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Edad</label>
                    <input
                      type="text"
                      readOnly
                      value={npEdad != null ? `${npEdad} años` : '—'}
                      className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3 py-2 text-sm text-on-surface-variant font-bold select-none cursor-default"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Sexo / Género</label>
                    <select
                      value={npSexo}
                      onChange={(e) => setNpSexo(e.target.value)}
                      className="w-full bg-white border border-outline-variant rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary font-medium"
                    >
                      <option value="">— Elegir —</option>
                      <option value="femenino">Femenino</option>
                      <option value="masculino">Masculino</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-on-surface-variant block mb-1">Correo Electrónico</label>
                    <input
                      type="email"
                      value={npEmail}
                      onChange={(e) => setNpEmail(e.target.value)}
                      placeholder="correo@ejemplo.com"
                      className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>
                {/* Canal de captación del paciente nuevo */}
                <div>
                  <label className="text-xs font-bold text-on-surface-variant block mb-1">Canal de captación</label>
                  <select
                    value={npCanalId ?? ''}
                    onChange={(e) => setNpCanalId(e.target.value || null)}
                    className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm outline-none focus:border-primary font-medium"
                  >
                    <option value="">— Sin especificar —</option>
                    {canales.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Bloque Membresía (opcional) / Activar nueva membresía */}
          {pacienteSeleccionado && (
            <div className="p-4 bg-purple-50/60 border border-purple-200/80 rounded-xl space-y-3">
              <label className="font-label-caps text-xs font-bold text-purple-900 block">
                MEMBRESÍA (OPCIONAL)
              </label>
              <div className="relative">
                <select
                  value={membSel}
                  onChange={(e) => {
                    setMembSel(e.target.value);
                    setMembItem('');
                  }}
                  className="w-full appearance-none bg-white border border-purple-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-purple-950 outline-none focus:ring-2 focus:ring-purple-400"
                >
                  <option value="">— No usar membresía —</option>

                  {/* Membresías activas del paciente */}
                  {membresiasActivas.length > 0 && (
                    <optgroup label="Membresías del paciente">
                      {membresiasActivas.map((m: any) => (
                        <option key={m.id} value={`inst:${m.id}`}>
                          {m.nombre} (Sesiones disponibles: {m.saldo ?? (m.sesionesTotal - m.consumidas)})
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {/* Plantillas para activar nueva membresía */}
                  {tplsMembresiaActivas.length > 0 && (
                    <optgroup label="Activar nueva membresía">
                      {tplsMembresiaActivas.map((t: any) => (
                        <option key={t.id} value={`tpl:${t.id}`}>
                          + {t.nombre} ({t.duracionMeses} Meses)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-purple-700">
                  expand_more
                </span>
              </div>

              {/* Si se eligió activar una membresía nueva, mostrar vigencia */}
              {membSel.startsWith('tpl:') && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-purple-200/60">
                  <div>
                    <label className="text-[11px] font-bold text-purple-900 block mb-1">Vigencia Inicio</label>
                    <input
                      type="date"
                      value={membInicio}
                      onChange={(e) => setMembInicio(e.target.value)}
                      className="w-full bg-white border border-purple-300 rounded-lg px-3 py-1.5 text-xs font-mono text-purple-950 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-purple-900 block mb-1">Vigencia Fin</label>
                    <input
                      type="date"
                      value={membFin}
                      onChange={(e) => setMembFin(e.target.value)}
                      className="w-full bg-white border border-purple-300 rounded-lg px-3 py-1.5 text-xs font-mono text-purple-950 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Si la membresía tiene ítems/servicios en su composición */}
              {membSel && membComposicion.length > 0 && (
                <div className="space-y-1 pt-1">
                  <label className="text-[11px] font-bold text-purple-900 block">
                    Servicio a consumir de la membresía *
                  </label>
                  <select
                    value={membItem}
                    onChange={(e) => setMembItem(e.target.value)}
                    className="w-full bg-white border border-purple-300 rounded-lg px-3 py-2 text-xs font-bold text-purple-950 outline-none"
                  >
                    <option value="">Seleccionar servicio de membresía...</option>
                    {membComposicion.map((item, idx) => (
                      <option key={idx} value={String(idx)}>
                        {item.etiqueta} {item.subcategoriaEtiqueta ? `(${item.subcategoriaEtiqueta})` : ''} — Quedan {item.quedan} de {item.total}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Selector de Servicio */}
          <div className="space-y-2">
            <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
              SERVICIO <span className="text-error">*</span>
            </label>
            <div className="relative">
              <select
                value={servicioId}
                onChange={(e) => {
                  setServicioId(e.target.value);
                  setSubcategoriaId('');
                }}
                className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 font-body-md text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-medium text-on-surface"
              >
                <option value="">Seleccionar servicio...</option>
                {servicios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} ({s.duracionMinutos} min)
                  </option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">
                expand_more
              </span>
            </div>

            {/* Subcategorías / Variantes */}
            {subcategorias.length > 0 && (
              <div className="mt-2 space-y-1">
                <label className="text-xs font-bold text-primary block">OPCIÓN / SUBCATEGORÍA *</label>
                <div className="relative">
                  <select
                    value={subcategoriaId}
                    onChange={(e) => setSubcategoriaId(e.target.value)}
                    className="w-full appearance-none bg-primary/5 border border-primary/30 rounded-xl px-4 py-2.5 text-sm font-semibold text-primary outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Seleccionar opción...</option>
                    {subcategorias.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.nombre} {sc.precioReferencial ? `(S/ ${sc.precioReferencial})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-primary">
                    expand_more
                  </span>
                </div>
              </div>
            )}

            {/* Paquetes activos del paciente */}
            {paquetesPaciente.length > 0 && !membSel && (
              <div className="mt-2 space-y-1">
                <label className="text-xs font-bold text-emerald-700 block">DESCONTAR DE PAQUETE ACTIVO</label>
                <select
                  value={paquetePacienteId}
                  onChange={(e) => setPaquetePacienteId(e.target.value)}
                  className="w-full bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                >
                  <option value="">— Ninguno (cita suelta normal) —</option>
                  {paquetesPaciente.map((pp: any) => (
                    <option key={pp.id} value={pp.id}>
                      {pp.paquete?.nombre || 'Paquete'} ({pp.sesionesUsadas}/{pp.sesionesTotal} consumidas — {pp.saldo ?? (pp.sesionesTotal - pp.sesionesUsadas)} disponibles)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Toggle de Servicio Combinado (Profilaxis + Extra) */}
          {esServicioAncla && combinablesActivos.length > 0 && (
            <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-indigo-900 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={combinar}
                    onChange={(e) => setCombinar(e.target.checked)}
                    className="rounded text-primary focus:ring-primary"
                  />
                  <span>Agendar servicio extra combinado en el mismo turno</span>
                </label>
                <span className="text-[10px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded-full font-bold">1 Hora</span>
              </div>

              {combinar && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-indigo-200/60">
                  <div>
                    <label className="text-[11px] font-bold text-indigo-900 block mb-1">Servicio Extra *</label>
                    <select
                      value={extraServicioId}
                      onChange={(e) => setExtraServicioId(e.target.value)}
                      className="w-full bg-white border border-indigo-300 rounded-lg px-3 py-2 text-xs font-semibold text-indigo-950 outline-none"
                    >
                      <option value="">Seleccionar extra...</option>
                      {combinablesActivos.map((c: any) => (
                        <option key={c.servicio.id} value={c.servicio.id}>
                          {c.servicio.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-indigo-900 block mb-1">Profesional Extra</label>
                    <select
                      value={extraProfesionalId}
                      onChange={(e) => setExtraProfesionalId(e.target.value)}
                      className="w-full bg-white border border-indigo-300 rounded-lg px-3 py-2 text-xs text-indigo-950 outline-none"
                    >
                      <option value="">Mismo profesional del ancla</option>
                      {profesionales.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombres} {p.apellidos}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Grid Layout for Canal & Promoción */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
                CANAL DE RESERVA
              </label>
              <div className="relative">
                <select
                  value={canal}
                  onChange={(e) => setCanal(e.target.value)}
                  className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-on-surface font-medium"
                >
                  {canales.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">
                  expand_more
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
                PROMOCIÓN (OPCIONAL)
              </label>
              <div className="relative">
                <select
                  value={promocionId}
                  onChange={(e) => setPromocionId(e.target.value)}
                  className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-on-surface font-medium"
                >
                  <option value="">— Ninguna —</option>
                  {promociones.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">
                  expand_more
                </span>
              </div>
            </div>
          </div>

          {/* Selección de Profesional */}
          <div className="space-y-2">
            <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
              PROFESIONAL
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500 text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                  star
                </span>
              </div>
              <select
                value={profesionalId}
                onChange={(e) => setProfesionalId(e.target.value)}
                className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl pl-11 pr-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-medium text-on-surface"
              >
                <option value="">Sin preferencia (asignación automática)</option>
                {profesionales.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombres} {p.apellidos} ({p.tipo})
                  </option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">
                expand_more
              </span>
            </div>
            <p className="font-body-md text-xs text-on-surface-variant/70 italic">
              Por defecto se asigna automáticamente. Elige un médico o especialista solo si el paciente lo pidió expresamente.
            </p>
          </div>

          {/* Fecha y Hora */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
                FECHA <span className="text-error">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={fechaCita}
                  onChange={(e) => setFechaCita(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-medium text-on-surface font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
                HORA <span className="text-error">*</span>
              </label>
              <div className="relative">
                <select
                  value={horaCita}
                  onChange={(e) => setHoraCita(e.target.value)}
                  className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-medium text-on-surface font-mono"
                >
                  {opcionesHoras.map((h) => (
                    <option key={h} value={h}>
                      {h} hs
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">
                  schedule
                </span>
              </div>
            </div>
          </div>

          {/* Comentarios de Recepción */}
          <div className="space-y-2">
            <label className="font-label-caps text-label-caps text-on-surface-variant text-[11px] font-bold">
              COMENTARIO DE RECEPCIÓN
            </label>
            <textarea
              rows={3}
              value={comentarioRecepcion}
              onChange={(e) => setComentarioRecepcion(e.target.value)}
              placeholder="Notas internas opcionales (ej. paciente refiere dolor en el talón derecho)..."
              className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none text-on-surface"
            />
          </div>

          {/* Sección Pago Anticipado */}
          <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#B45309] text-xl">payments</span>
              <span className="font-body-md text-sm font-bold text-[#92400E]">
                Pago anticipado <span className="font-normal opacity-75">(opcional)</span>
              </span>
            </div>

            {comprobante ? (
              <div className="p-3 bg-white rounded-xl border border-[#F59E0B]/40 flex items-center justify-between">
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <span className="material-symbols-outlined text-[#B45309]">description</span>
                  <span className="text-xs font-bold text-[#92400E] truncate">{comprobante.nombre}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setComprobante(null)}
                  className="text-xs font-bold text-red-600 hover:underline cursor-pointer"
                >
                  Quitar
                </button>
              </div>
            ) : (
              <div
                onClick={() => inputFileRef.current?.click()}
                className="border-2 border-dashed border-[#F59E0B]/40 bg-white/60 rounded-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white hover:border-[#F59E0B]/70 transition-all group"
              >
                <span className="material-symbols-outlined text-[#B45309]/50 mb-1 text-2xl group-hover:scale-110 transition-transform">
                  upload_file
                </span>
                <p className="font-body-md text-xs text-[#92400E] font-bold">
                  {subiendo ? 'Subiendo comprobante...' : 'Haz clic, arrastra o pega (Ctrl+V) el comprobante'}
                </p>
                <p className="font-body-md text-[11px] text-[#92400E]/70 mt-0.5">JPG · PNG · PDF (máx. 10MB)</p>
                <input
                  ref={inputFileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleSubirComprobante(e.target.files[0]);
                    }
                  }}
                />
              </div>
            )}
            <p className="text-[11px] text-[#92400E]/70 italic">Sin comprobante la cita igual se crea con normalidad.</p>
          </div>

          {/* Visor Historial Genexis (Modal Secundario) */}
          {verVisorGenexis && pacienteSeleccionado && (
            <VisorHistorialGenexis
              pacienteId={pacienteSeleccionado.id}
              nombrePaciente={pacienteSeleccionado.nombreCompleto}
              documento={pacienteSeleccionado.numeroDocumento || 'Sin doc'}
              onClose={() => setVerVisorGenexis(false)}
            />
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-outline-variant/30 flex gap-3 bg-surface-container-low/40 shrink-0">
          <button
            type="button"
            onClick={props.onClose}
            className="flex-1 px-5 py-2.5 border border-outline-variant rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAgendar}
            disabled={isPending}
            className="flex-1 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
          >
            {isPending ? 'Agendando...' : 'Agendar cita'}
          </button>
        </div>

      </div>
    </div>
  );
}
