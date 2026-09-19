// Firmar un consentimiento informado EN CUALQUIER MOMENTO (desde la cita en la agenda, la atención o
// la historia). Con plantilla OFICIAL (formato por secciones) se llenan dedos, alcance y riesgos
// particulares (premarcados con lo que la historia ya sabe), el representante si firma otra persona,
// y las firmas del paciente/representante, del profesional (opcional) y del testigo (opcional).
// Con una plantilla antigua (texto libre) se firma el texto, como antes.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { consentimientosApi, pendientesCitaKey, type OrigenFirma, type PendienteConsentimiento } from '../api/consentimientos';
import type { PlantillaClinica, RelacionFirmante, TrazoFirma } from '../api/historiaClinica';
import { textoConsentimiento } from '../utils/consentimientoTexto';
import { ASPECTO_FIRMA } from '../components/historiaClinica/FirmaPad';

const MIN_PUNTOS_FIRMA = 12; // igual que el API (FIRMA_VACIA)
const puntos = (t: TrazoFirma[]) => t.reduce((n, x) => n + x.puntos.length, 0);

export function useFirmarConsentimiento(origen: OrigenFirma, opts: { plantillaInicial?: string | null; onListo?: (r: { id: string; numero: number }) => void } = {}) {
  const qc = useQueryClient();
  const ctxQ = useQuery({
    queryKey: ['consentimiento-contexto', origen.citaId ?? null, origen.atencionId ?? null, origen.pacienteId ?? null, origen.sedeId ?? null],
    queryFn: () => consentimientosApi.contexto(origen),
    staleTime: 0,
  });
  const ctx = ctxQ.data ?? null;
  const pac = ctx?.paciente;
  const nombrePaciente = pac ? `${pac.nombres} ${pac.apellidoPaterno} ${pac.apellidoMaterno}`.trim() : '';

  const [plantillaId, setPlantillaIdRaw] = useState<string | null>(opts.plantillaInicial ?? null);
  const [relacion, setRelacion] = useState<RelacionFirmante>('paciente');
  const [repNombre, setRepNombre] = useState('');
  const [repDocumento, setRepDocumento] = useState('');
  const [repParentesco, setRepParentesco] = useState('');
  const [domicilio, setDomicilio] = useState('');
  const [telefono, setTelefono] = useState('');
  const [dedos, setDedos] = useState('');
  const [alcance, setAlcance] = useState<string | null>(null);
  const [riesgos, setRiesgos] = useState<string[]>([]);
  const [otraCondicion, setOtraCondicion] = useState('');
  const [procedimientoLibre, setProcedimientoLibre] = useState('');
  const [textoEditado, setTextoEditado] = useState<string | null>(null);
  const [firma, setFirma] = useState<TrazoFirma[]>([]);
  const [firmaProfesional, setFirmaProfesional] = useState<TrazoFirma[]>([]);
  const [conTestigo, setConTestigo] = useState(false);
  const [testigoNombre, setTestigoNombre] = useState('');
  const [testigoDocumento, setTestigoDocumento] = useState('');
  const [firmaTestigo, setFirmaTestigo] = useState<TrazoFirma[]>([]);

  const plantilla = ctx?.plantillas.find((p) => p.id === plantillaId) ?? null;
  const oficial = !!plantilla?.contenido;

  // Al elegir la plantilla: los riesgos que la historia ya conoce van premarcados (se pueden desmarcar).
  const setPlantillaId = (id: string | null) => {
    setPlantillaIdRaw(id);
    const p = ctx?.plantillas.find((x) => x.id === id);
    setRiesgos(p?.riesgosSugeridos ?? []);
    setAlcance(null);
    setTextoEditado(null);
    setProcedimientoLibre(p && !p.contenido ? p.nombre : '');
  };
  // Primera carga: la que exige el tratamiento y aún no está firmada (o la pedida).
  useEffect(() => {
    if (!ctx) return;
    setTelefono((t) => t || ctx.paciente.telefono || '');
    if (plantillaId && ctx.plantillas.some((p) => p.id === plantillaId)) { setPlantillaId(plantillaId); return; }
    const sugerida = ctx.plantillas.find((p) => p.requerida && !p.firmado) ?? ctx.plantillas.find((p) => p.requerida) ?? null;
    if (sugerida) setPlantillaId(sugerida.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // Plantilla antigua (texto libre): encabezado del sistema + cuerpo de la plantilla, editable.
  const textoLibreBase = useMemo(() => {
    if (!ctx || !plantilla || oficial) return '';
    const firmante = relacion === 'paciente' ? nombrePaciente : repNombre.trim();
    const documento = relacion === 'paciente' ? `${pac?.tipoDocumento ?? ''} ${pac?.numeroDocumento ?? ''}`.trim() : repDocumento.trim();
    const pl = { id: plantilla.id, nombre: plantilla.nombre, clave: plantilla.clave, tipo: 'consentimiento', contenido: { texto: plantilla.textoLibre ?? '' } } as unknown as PlantillaClinica;
    return textoConsentimiento({ firmante, documento, relacion, paciente: nombrePaciente, profesional: ctx.profesional?.nombre ?? 'el profesional tratante', procedimiento: procedimientoLibre, sede: ctx.sede?.nombre }, pl);
  }, [ctx, plantilla, oficial, relacion, nombrePaciente, repNombre, repDocumento, pac, procedimientoLibre]);
  const textoLibre = textoEditado ?? textoLibreBase;

  const faltantes: string[] = [];
  if (!plantilla) faltantes.push('elegir el consentimiento');
  if (relacion === 'apoderado') {
    if (repNombre.trim().length < 3) faltantes.push('el nombre del representante');
    if (!repDocumento.trim()) faltantes.push('el documento del representante');
    if (oficial && !repParentesco.trim()) faltantes.push('el parentesco o vínculo');
  }
  if (plantilla && !oficial) {
    if (procedimientoLibre.trim().length < 3) faltantes.push('el procedimiento');
    if (textoLibre.trim().length < 40) faltantes.push('el texto (quedó muy corto)');
  }
  if (oficial && plantilla?.contenido?.campos.dedos && !dedos.trim()) faltantes.push('el dedo o los dedos');
  if (oficial && plantilla?.contenido?.campos.alcance.length && !alcance) faltantes.push('el alcance');
  if (puntos(firma) < MIN_PUNTOS_FIRMA) faltantes.push(relacion === 'paciente' ? 'la firma del paciente' : 'la firma del representante');
  if (conTestigo && testigoNombre.trim().length < 3) faltantes.push('el nombre del testigo');
  const firmaProfOk = firmaProfesional.length === 0 || puntos(firmaProfesional) >= MIN_PUNTOS_FIRMA;
  const firmaTestOk = !conTestigo || firmaTestigo.length === 0 || puntos(firmaTestigo) >= MIN_PUNTOS_FIRMA;
  if (!firmaProfOk) faltantes.push('completar la firma del profesional (o borrarla)');
  if (!firmaTestOk) faltantes.push('completar la firma del testigo (o borrarla)');

  const firmarMut = useMutation({
    mutationFn: () => {
      if (!ctx || !plantilla) throw new Error('Elige el consentimiento');
      const firmante = relacion === 'paciente' ? nombrePaciente : repNombre.trim();
      const documento = relacion === 'paciente' ? `${pac?.tipoDocumento ?? ''} ${pac?.numeroDocumento ?? ''}`.trim() : repDocumento.trim();
      return consentimientosApi.crear({
        citaId: ctx.origen.citaId, atencionId: ctx.origen.atencionId, pacienteId: ctx.origen.pacienteId, sedeId: ctx.origen.sedeId,
        plantillaId: plantilla.id,
        procedimiento: oficial ? null : procedimientoLibre.trim(),
        texto: oficial ? null : textoLibre.trim(),
        firmanteNombre: firmante, firmanteDocumento: documento || null, firmanteRelacion: relacion,
        firma, firmaAspecto: ASPECTO_FIRMA,
        datos: oficial ? {
          dedos: dedos.trim() || null, alcance, riesgos, otraCondicion: otraCondicion.trim() || null,
          domicilio: domicilio.trim() || null, telefono: telefono.trim() || null,
          representante: relacion === 'apoderado' ? { nombre: repNombre.trim(), documento: repDocumento.trim(), parentesco: repParentesco.trim() } : null,
          testigo: conTestigo ? { nombre: testigoNombre.trim(), documento: testigoDocumento.trim() || null } : null,
        } : null,
        firmaProfesional: firmaProfesional.length ? firmaProfesional : null,
        firmaTestigo: conTestigo && firmaTestigo.length ? firmaTestigo : null,
      });
    },
    onSuccess: (r) => {
      toast.success(`Consentimiento N° ${String(r.numero).padStart(5, '0')} registrado`);
      for (const k of ['consentimientos-paciente', 'consentimientos-pendientes', 'consentimiento-contexto', 'citas', 'idea1-citas', 'atencion-clinica', 'historia-clinica']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      opts.onListo?.(r);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternarRiesgo = (r: string) => setRiesgos((xs) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]));

  return {
    cargando: ctxQ.isLoading, error: ctxQ.error as Error | null, ctx, nombrePaciente,
    plantilla, oficial, setPlantillaId,
    relacion, setRelacion, repNombre, setRepNombre, repDocumento, setRepDocumento, repParentesco, setRepParentesco,
    domicilio, setDomicilio, telefono, setTelefono, dedos, setDedos, alcance, setAlcance,
    riesgos, alternarRiesgo, otraCondicion, setOtraCondicion,
    procedimientoLibre, setProcedimientoLibre, textoLibre, textoEditado, setTextoEditado,
    firma, setFirma, firmaProfesional, setFirmaProfesional,
    conTestigo, setConTestigo, testigoNombre, setTestigoNombre, testigoDocumento, setTestigoDocumento, firmaTestigo, setFirmaTestigo,
    faltantes, firmarMut,
  };
}

/** Abre el PDF del consentimiento en otra pestaña (por duplicado: historia clínica y paciente). */
export async function verConsentimientoPdf(id: string, copias?: 1 | 2) {
  const ventana = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await consentimientosApi.pdfBlob(id, copias));
    if (ventana) ventana.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    ventana?.close();
    toast.error((e as Error).message);
  }
}

/** Consentimientos que el tratamiento de la cita exige y aún no están firmados. */
export function usePendientesConsentimiento(citaId: string | null | undefined): PendienteConsentimiento[] {
  const { data = [] } = useQuery({ queryKey: pendientesCitaKey(citaId ?? ''), queryFn: () => consentimientosApi.pendientesDeCita(citaId!), enabled: !!citaId, staleTime: 30_000 });
  return data;
}
