import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { pacientesApi, paquetesApi, reniecApi } from '../api';
import type { HistorialCita, ProximaCita, Paciente } from '../api';
import { UBIGEO_EXTRANJERO } from '@limablue/shared';

// ─────────────────────────────────────────────────────────────────────────────
//  SERVICE (BACK) de Pacientes
//  Encapsula todo el estado, queries, mutations, efectos y handlers de la vista
//  de Pacientes (lista + ficha). El .tsx solo consume estos hooks y renderiza.
//  Mismo patrón que los idea1*Service.ts.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Lista / búsqueda ─────────────────────────────────────────────────────────

export function usePacientesBusqueda() {
  const [q, setQ] = useState('');

  const { data: resultados, isLoading } = useQuery({
    queryKey: ['pacientes-buscar', q],
    queryFn: () => pacientesApi.buscar(q),
    enabled: q.length >= 2,
  });

  return { q, setQ, resultados, isLoading };
}

// ─── Ficha de paciente ────────────────────────────────────────────────────────

// El historial que expone GET /pacientes/:id incluye `consultorioNumero` (no está en
// el tipo base HistorialCita). Lo tipamos aquí para que la vista lo consuma sin casts.
export type HistorialFicha = HistorialCita & { consultorioNumero: number | null };

// Las próximas citas del detalle traen `estado` (no está en el tipo base ProximaCita).
export type ProximaFicha = ProximaCita & { estado: string };

export interface DatosPacienteForm {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  tipoDocumento: string;
  numeroDocumento: string;
  telefono: string;
  email: string;
  fechaNacimiento: string;
  sexo: string;
  ubigeoId: string | null;
  paisResidencia: string | null;
  canalId: string | null;
}

export function useFichaPaciente(id: string | undefined) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [notas, setNotas] = useState('');

  const { data: paciente, isLoading } = useQuery({
    queryKey: ['paciente', id],
    queryFn: () => pacientesApi.obtener(id!),
    enabled: !!id,
  });

  // Prefetch de los paquetes del paciente (misma queryKey que consume SaldoPaquetes).
  useQuery({
    queryKey: ['paquetes-paciente', id],
    queryFn: () => paquetesApi.porPaciente(id!),
    enabled: !!id,
  });

  const actualizarMutation = useMutation({
    mutationFn: (data: { notas: string }) => pacientesApi.actualizar(id!, data as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paciente', id] });
      toast.success('Notas actualizadas');
      setEditando(false);
    },
  });

  // ── Edición de los DATOS del paciente (fuente única: el registro Paciente; las
  //    citas lo referencian por FK, así que al guardar se refresca toda la agenda) ──
  const [editandoDatos, setEditandoDatos] = useState(false);
  const [form, setForm] = useState<DatosPacienteForm>({
    nombres: '', apellidoPaterno: '', apellidoMaterno: '', tipoDocumento: 'DNI',
    numeroDocumento: '', telefono: '', email: '', fechaNacimiento: '', sexo: '',
    ubigeoId: null, paisResidencia: null, canalId: null,
  });
  // Autollenado RENIEC (no destructivo: solo rellena campos de nombre vacíos).
  const [dniConsultando, setDniConsultando] = useState(false);
  const dniConsultadoRef = useRef('');

  const abrirEdicionDatos = () => {
    if (!paciente) return;
    setForm({
      nombres: paciente.nombres ?? '', apellidoPaterno: paciente.apellidoPaterno ?? '',
      apellidoMaterno: paciente.apellidoMaterno ?? '', tipoDocumento: paciente.tipoDocumento ?? 'DNI',
      numeroDocumento: paciente.numeroDocumento ?? '', telefono: paciente.telefono ?? '',
      email: paciente.email ?? '', fechaNacimiento: (paciente.fechaNacimiento ?? '').slice(0, 10), sexo: paciente.sexo ?? '',
      // Paciente legado sin distrito → null (el componente queda vacío, sin crash).
      ubigeoId: paciente.ubigeoId ?? null, paisResidencia: paciente.paisResidencia ?? null,
      canalId: paciente.canalId ?? null,
    });
    // Si el registro ya trae los 3 nombres completos, no re-consultamos RENIEC al
    // abrir (solo lo hará si el usuario CAMBIA el DNI). Si faltan nombres, dejamos
    // que el efecto los rellene automáticamente.
    dniConsultadoRef.current =
      paciente.nombres && paciente.apellidoPaterno && paciente.apellidoMaterno
        ? (paciente.numeroDocumento ?? '')
        : '';
    setEditandoDatos(true);
  };

  // Autollenado RENIEC en la edición: al tener un DNI de 8 dígitos (tipo DNI) que no
  // se haya consultado aún, rellena SOLO los campos de nombre vacíos (no destructivo).
  useEffect(() => {
    if (!editandoDatos || form.tipoDocumento !== 'DNI') return;
    const dni = form.numeroDocumento.trim();
    if (!/^\d{8}$/.test(dni) || dniConsultadoRef.current === dni) return;

    dniConsultadoRef.current = dni;
    let cancelado = false;
    const t = setTimeout(async () => {
      setDniConsultando(true);
      try {
        const d = await reniecApi.consultarDni(dni);
        if (cancelado) return;
        const tc = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
        setForm((f) => ({
          ...f,
          nombres: f.nombres.trim() ? f.nombres : tc(d.nombres),
          apellidoPaterno: f.apellidoPaterno.trim() ? f.apellidoPaterno : tc(d.apellidoPaterno),
          apellidoMaterno: f.apellidoMaterno.trim() ? f.apellidoMaterno : tc(d.apellidoMaterno),
        }));
        toast.success('Datos encontrados en RENIEC');
      } catch (e) {
        if (cancelado) return;
        dniConsultadoRef.current = '';
        toast(e instanceof Error ? e.message : 'No se pudo consultar el DNI', { icon: 'ℹ️' });
      } finally {
        if (!cancelado) setDniConsultando(false);
      }
    }, 500);
    return () => { cancelado = true; clearTimeout(t); };
  }, [form.numeroDocumento, form.tipoDocumento, editandoDatos]);

  // Llegada desde el toggle "Actualizar datos" (popover/otras vistas): ?editar=datos
  // abre la edición una sola vez, con los campos faltantes resaltados en ámbar.
  const [searchParams, setSearchParams] = useSearchParams();
  const autoEdicionAbierta = useRef(false);
  useEffect(() => {
    if (paciente && searchParams.get('editar') === 'datos' && !autoEdicionAbierta.current) {
      autoEdicionAbierta.current = true;
      abrirEdicionDatos();
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paciente, searchParams]);

  // Campos faltantes según el server (resalta inputs y alimenta el tooltip del toggle).
  const faltantes = paciente?.datosFaltantes ?? [];

  const guardarDatosMutation = useMutation({
    mutationFn: () => pacientesApi.actualizar(id!, {
      nombres: form.nombres.trim(), apellidoPaterno: form.apellidoPaterno.trim(),
      apellidoMaterno: form.apellidoMaterno.trim(), tipoDocumento: form.tipoDocumento,
      numeroDocumento: form.numeroDocumento.trim(), telefono: form.telefono.trim(),
      email: form.email.trim() || undefined, fechaNacimiento: form.fechaNacimiento || undefined,
      sexo: form.sexo || undefined,
      // Distrito: se envía SIEMPRE el valor del form (string = fijar, null = borrar con la X).
      // El backend hace la regla de país (A4) y solo audita si realmente cambió.
      ubigeoId: form.ubigeoId,
      paisResidencia: form.ubigeoId === UBIGEO_EXTRANJERO ? form.paisResidencia : null,
      canalId: form.canalId,
    } as never),
    onSuccess: () => {
      // Una sola fuente de verdad → refrescar TODO lo que muestra al paciente.
      qc.invalidateQueries({ queryKey: ['paciente', id] });
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['paciente-historial', id] });
      qc.invalidateQueries({ queryKey: ['pacientes-buscar'] });
      toast.success('Datos del paciente actualizados');
      setEditandoDatos(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Derivados del detalle (historial / próximas / total real de atenciones).
  const historial: HistorialFicha[] = (paciente?.historial as HistorialFicha[] | undefined) ?? [];
  const proximas: ProximaFicha[] = (paciente?.proximas as ProximaFicha[] | undefined) ?? [];
  // Total real de atenciones (sobre todas las citas, no acotado a las 200 mostradas).
  const totalAtenciones = paciente?.totalCitas ?? historial.length;

  return {
    // Datos cargados
    paciente,
    isLoading,
    historial,
    proximas,
    totalAtenciones,
    faltantes,

    // Notas generales
    editando,
    setEditando,
    notas,
    setNotas,
    actualizarMutation,

    // Edición de datos del paciente
    editandoDatos,
    setEditandoDatos,
    form,
    setForm,
    dniConsultando,
    abrirEdicionDatos,
    guardarDatosMutation,
  };
}

// ─── Nuevo paciente (registro) ────────────────────────────────────────────────

export type TipoDoc = 'DNI' | 'CE' | 'PASAPORTE' | 'RUC';

// Edad exacta (años cumplidos) a partir de "YYYY-MM-DD". Anclada a mediodía local.
export function calcularEdad(fechaNacimiento: string): number | null {
  if (!fechaNacimiento) return null;
  const d = new Date(fechaNacimiento.slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - d.getFullYear();
  const m = hoy.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < d.getDate())) edad -= 1;
  return edad >= 0 && edad < 130 ? edad : null;
}

const toTitleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export interface UseNuevoPacienteFormProps {
  onClose: () => void;
  onCreated?: (paciente: Paciente) => void;
}

export function useNuevoPacienteForm({ onClose, onCreated }: UseNuevoPacienteFormProps) {
  const qc = useQueryClient();

  const [tipoDocumento, setTipoDocumento] = useState<TipoDoc>('DNI');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidoPaterno, setApellidoPaterno] = useState('');
  const [apellidoMaterno, setApellidoMaterno] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [sexo, setSexo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [ubigeoId, setUbigeoId] = useState<string | null>(null);
  const [paisResidencia, setPaisResidencia] = useState<string | null>(null);
  const [canalId, setCanalId] = useState<string | null>(null);
  // Categoría: reservada para futuro uso adicional
  const [categoria, setCategoria] = useState('');

  const [buscando, setBuscando] = useState(false);
  const dniConsultadoRef = useRef('');

  // Edad autocalculada desde la fecha de nacimiento.
  const edad = useMemo(() => calcularEdad(fechaNacimiento), [fechaNacimiento]);

  // AUTO-CONSULTA RENIEC / PeruDevs y VERIFICACIÓN DE PACIENTE EXISTENTE por DNI
  useEffect(() => {
    const doc = numeroDocumento.trim();
    const esDni = tipoDocumento === 'DNI';
    const docValido = esDni ? /^\d{8}$/.test(doc) : doc.length >= 6;
    if (!docValido) return;

    const clave = `${tipoDocumento}:${doc}`;
    if (dniConsultadoRef.current === clave) return;

    dniConsultadoRef.current = clave;
    let cancelado = false;

    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const encontrados = await pacientesApi.buscar(doc);
        if (cancelado) return;
        const yaRegistrado = encontrados.find(
          (p: any) => p.numeroDocumento === doc && p.tipoDocumento === tipoDocumento,
        );
        if (yaRegistrado) {
          const nombreComp = `${yaRegistrado.nombres} ${yaRegistrado.apellidoPaterno} ${yaRegistrado.apellidoMaterno || ''}`.trim();
          toast.success(`Paciente ya existe en el sistema: ${nombreComp}`, { duration: 4000 });
          setNombres(toTitleCase(yaRegistrado.nombres));
          setApellidoPaterno(toTitleCase(yaRegistrado.apellidoPaterno));
          setApellidoMaterno(toTitleCase(yaRegistrado.apellidoMaterno || ''));
          if (yaRegistrado.telefono) setTelefono(yaRegistrado.telefono);
          if (yaRegistrado.email) setEmail(yaRegistrado.email);
          if (yaRegistrado.fechaNacimiento) setFechaNacimiento(yaRegistrado.fechaNacimiento.slice(0, 10));
          if (yaRegistrado.sexo) setSexo(yaRegistrado.sexo);
          return;
        }

        if (!esDni) return;
        const d = await reniecApi.consultarDni(doc);
        if (cancelado) return;
        setNombres(toTitleCase(d.nombres));
        setApellidoPaterno(toTitleCase(d.apellidoPaterno));
        setApellidoMaterno(toTitleCase(d.apellidoMaterno));
        if (d.fechaNacimiento) setFechaNacimiento(d.fechaNacimiento);
        if (d.sexo) setSexo(d.sexo);
        toast.success('Datos autocompletados desde RENIEC / PeruDevs');
      } catch (e: any) {
        if (cancelado) return;
        dniConsultadoRef.current = '';
        toast(e?.message || 'No se pudo consultar RENIEC', { icon: 'ℹ️' });
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 500);

    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [numeroDocumento, tipoDocumento]);

  // El botón "Buscar" solo aplica a DNI (8 dígitos). Consulta PeruDevs vía el backend
  // (GET /reniec/dni/:dni) y trae nombres, apellidos, fecha de nacimiento y sexo.
  const puedeBuscar = tipoDocumento === 'DNI' && /^\d{8}$/.test(numeroDocumento.trim());

  const buscarPorDocumento = async () => {
    if (!puedeBuscar || buscando) return;
    setBuscando(true);
    try {
      const d = await reniecApi.consultarDni(numeroDocumento.trim());
      // "Buscar" explícito → setea los datos oficiales del documento.
      setNombres(toTitleCase(d.nombres));
      setApellidoPaterno(toTitleCase(d.apellidoPaterno));
      setApellidoMaterno(toTitleCase(d.apellidoMaterno));
      if (d.fechaNacimiento) setFechaNacimiento(d.fechaNacimiento);
      if (d.sexo) setSexo(d.sexo);
      toast.success('Datos encontrados');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron obtener los datos del documento', { icon: 'ℹ️' });
    } finally {
      setBuscando(false);
    }
  };

  const crearMutation = useMutation({
    mutationFn: () =>
      pacientesApi.crear({
        nombres: nombres.trim(),
        apellidoPaterno: apellidoPaterno.trim(),
        apellidoMaterno: apellidoMaterno.trim(),
        tipoDocumento,
        numeroDocumento: numeroDocumento.trim(),
        telefono: telefono.trim(),
        email: email.trim() || undefined,
        fechaNacimiento: fechaNacimiento || undefined,
        sexo: sexo || undefined,
        ubigeoId,
        paisResidencia: ubigeoId === UBIGEO_EXTRANJERO ? paisResidencia : null,
        canalId: canalId || undefined,
      } as never),
    onSuccess: (paciente) => {
      qc.invalidateQueries({ queryKey: ['pacientes-buscar'] });
      toast.success('Paciente registrado');
      onCreated?.(paciente);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Requisitos mínimos del backend (crearPacienteSchema): nombres/apellidos ≥2,
  // documento ≥8, teléfono ≥9, y país obligatorio si el distrito es "Extranjero".
  const puedeGuardar =
    nombres.trim().length >= 2 &&
    apellidoPaterno.trim().length >= 2 &&
    apellidoMaterno.trim().length >= 2 &&
    numeroDocumento.trim().length >= 8 &&
    telefono.trim().length >= 9 &&
    (ubigeoId !== UBIGEO_EXTRANJERO || !!paisResidencia);

  return {
    // Estado del formulario
    tipoDocumento,
    setTipoDocumento,
    numeroDocumento,
    setNumeroDocumento,
    nombres,
    setNombres,
    apellidoPaterno,
    setApellidoPaterno,
    apellidoMaterno,
    setApellidoMaterno,
    fechaNacimiento,
    setFechaNacimiento,
    sexo,
    setSexo,
    telefono,
    setTelefono,
    email,
    setEmail,
    ubigeoId,
    setUbigeoId,
    paisResidencia,
    setPaisResidencia,
    canalId,
    setCanalId,
    categoria,
    setCategoria,

    // Derivados / acciones
    edad,
    puedeBuscar,
    buscando,
    buscarPorDocumento,
    crearMutation,
    puedeGuardar,
  };
}
