import { DistritoAutocomplete, PaisAutocomplete } from '../ui/DistritoAutocomplete';
import { UBIGEO_EXTRANJERO } from '@limablue/shared';
import { useNuevoPacienteForm, type UseNuevoPacienteFormProps } from '../../services/pacientesService';

// Estilos base de inputs (mismo lenguaje que el modal de Nueva Cita).
const INP =
  'w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'text-xs font-bold text-on-surface-variant block mb-1';

export function Idea1NuevoPacienteModal(props: UseNuevoPacienteFormProps) {
  const {
    tipoDocumento, setTipoDocumento,
    numeroDocumento, setNumeroDocumento,
    nombres, setNombres,
    apellidoPaterno, setApellidoPaterno,
    apellidoMaterno, setApellidoMaterno,
    fechaNacimiento, setFechaNacimiento,
    sexo, setSexo,
    telefono, setTelefono,
    email, setEmail,
    ubigeoId, setUbigeoId,
    paisResidencia, setPaisResidencia,
    categoria, setCategoria,
    edad,
    puedeBuscar,
    buscando,
    buscarPorDocumento,
    crearMutation,
    puedeGuardar,
  } = useNuevoPacienteForm(props);

  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-surface-container-lowest w-full max-w-[640px] max-h-[90vh] rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="bg-[#3525cd] text-white p-6 flex justify-between items-start shrink-0 shadow-md">
          <div>
            <h2 className="font-headline-md text-headline-md font-bold text-white tracking-tight">Nuevo paciente</h2>
            <p className="font-body-md text-body-md text-white/90 mt-1 flex items-center gap-2 text-sm font-medium">
              <span className="material-symbols-outlined text-base">person_add</span>
              <span>Registrar los datos del paciente</span>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">

          {/* Documento + Buscar */}
          <div>
            <label className="font-label-caps text-label-caps text-on-surface-variant flex items-center gap-1 text-[11px] font-bold mb-2">
              DOCUMENTO <span className="text-error font-bold">*</span>
            </label>
            <div className="grid grid-cols-[130px_1fr_auto] gap-3">
              <select
                value={tipoDocumento}
                onChange={(e) => setTipoDocumento(e.target.value as never)}
                className={INP + ' font-medium'}
              >
                <option value="DNI">DNI</option>
                <option value="CE">Carné Ext. (CE)</option>
                <option value="PASAPORTE">Pasaporte</option>
                <option value="RUC">RUC</option>
              </select>
              <input
                type="text"
                value={numeroDocumento}
                onChange={(e) => setNumeroDocumento(tipoDocumento === 'DNI' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                maxLength={tipoDocumento === 'DNI' ? 8 : 20}
                inputMode={tipoDocumento === 'DNI' ? 'numeric' : 'text'}
                placeholder={tipoDocumento === 'DNI' ? '8 dígitos' : 'N° de documento'}
                className={INP + ' font-mono'}
              />
              <button
                type="button"
                onClick={buscarPorDocumento}
                disabled={!puedeBuscar || buscando}
                title={tipoDocumento === 'DNI' ? 'Buscar datos por DNI' : 'La búsqueda solo aplica a DNI'}
                className="px-4 rounded-lg bg-primary text-on-primary font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5 whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-lg">{buscando ? 'progress_activity' : 'search'}</span>
                {buscando ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
            <p className="text-[11px] text-on-surface-variant/70 mt-1.5">
              La búsqueda por DNI autocompleta nombres, apellidos {/* y fecha de nacimiento cuando la API esté activa */}
              (y fecha de nacimiento, próximamente).
            </p>
          </div>

          {/* Nombres / Apellidos */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LBL}>Nombres *</label>
              <input value={nombres} onChange={(e) => setNombres(e.target.value)} className={INP} placeholder="Ej. Juan Carlos" />
            </div>
            <div>
              <label className={LBL}>Apellido paterno *</label>
              <input value={apellidoPaterno} onChange={(e) => setApellidoPaterno(e.target.value)} className={INP} placeholder="Ej. Pérez" />
            </div>
            <div>
              <label className={LBL}>Apellido materno *</label>
              <input value={apellidoMaterno} onChange={(e) => setApellidoMaterno(e.target.value)} className={INP} placeholder="Ej. García" />
            </div>
            <div>
              <label className={LBL}>Sexo</label>
              <select value={sexo} onChange={(e) => setSexo(e.target.value)} className={INP + ' font-medium'}>
                <option value="">—</option>
                <option value="masculino">Masculino</option>
                <option value="femenino">Femenino</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>

          {/* Fecha nac. + Edad */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LBL}>Fecha de nacimiento</label>
              <input type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} className={INP + ' font-mono'} />
            </div>
            <div>
              <label className={LBL}>Edad</label>
              <input
                readOnly
                value={edad != null ? `${edad} años` : '—'}
                className={INP + ' bg-surface-container-low text-on-surface-variant cursor-default'}
                title="Se calcula automáticamente con la fecha de nacimiento"
              />
            </div>
          </div>

          {/* Teléfono / Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LBL}>Teléfono / WhatsApp *</label>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={INP + ' font-mono'} placeholder="Ej. 987654321" />
            </div>
            <div>
              <label className={LBL}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INP} placeholder="correo@ejemplo.com" />
            </div>
          </div>

          {/* Dirección (distrito) */}
          <div>
            <label className={LBL}>Dirección — Distrito de residencia</label>
            <DistritoAutocomplete
              value={ubigeoId}
              onChange={(id) => { setUbigeoId(id); if (id !== UBIGEO_EXTRANJERO) setPaisResidencia(null); }}
            />
          </div>
          {ubigeoId === UBIGEO_EXTRANJERO && (
            <div>
              <label className={LBL}>País de residencia *</label>
              <PaisAutocomplete value={paisResidencia} onChange={setPaisResidencia} />
            </div>
          )}

          {/* Categoría (aún no persiste — futura para historial médico) */}
          <div>
            <label className={LBL}>Categoría</label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              disabled
              className={INP + ' font-medium opacity-60 cursor-not-allowed'}
              title="Se habilitará con el módulo de historial médico"
            >
              <option value="">— Próximamente —</option>
            </select>
            <p className="text-[11px] text-on-surface-variant/70 mt-1">
              Aún no se guarda: requiere una columna en la base de datos (será para el historial médico).
            </p>
          </div>
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
            onClick={() => crearMutation.mutate()}
            disabled={!puedeGuardar || crearMutation.isPending}
            className="flex-1 px-5 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            {crearMutation.isPending ? 'Guardando…' : 'Registrar paciente'}
          </button>
        </div>
      </div>
    </div>
  );
}
