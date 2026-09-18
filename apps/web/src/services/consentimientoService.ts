// Consentimiento informado (5.1 + 5.2) — lógica de la pestaña «Consentimientos» de la HC.
// El texto se arma en utils/consentimientoTexto.ts: el encabezado legal lo pone el sistema y el
// cuerpo sale de la PLANTILLA del procedimiento que se está autorizando (matricectomía, láser,
// curación…) o, si no hay ninguna, del texto general. Se puede ajustar antes de firmar y lo que se
// firma queda como copia fija (inmutable): cambiar la plantilla después no toca lo ya firmado.
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { historiaClinicaApi, atencionKey, usePlantillas, TIPO_PROCEDIMIENTO_LABEL, type AtencionCompleta, type RelacionFirmante, type TipoProcedimiento, type TrazoFirma } from '../api/historiaClinica';
import { plantillaParaProcedimiento, textoConsentimiento, type DatosConsentimiento } from '../utils/consentimientoTexto';
import { ASPECTO_FIRMA } from '../components/historiaClinica/FirmaPad';

const MIN_PUNTOS_FIRMA = 12; // igual que el API (FIRMA_VACIA)

export function useConsentimientos(a: AtencionCompleta, puedeRegistrar: boolean) {
  const qc = useQueryClient();
  const pac = a.paciente;
  const nombrePaciente = `${pac.nombres} ${pac.apellidoPaterno} ${pac.apellidoMaterno}`.trim();
  const docPaciente = `${pac.tipoDocumento} ${pac.numeroDocumento}`.trim();
  const profesional = `${a.profesional.nombres} ${a.profesional.apellidos}`.trim();
  const cerrada = a.estado === 'cerrada';
  const puedeFirmar = puedeRegistrar && !cerrada;

  const [abierto, setAbierto] = useState(false);
  const [procedimiento, setProcedimiento] = useState('');
  /** Tipo del procedimiento elegido de las sugerencias: es lo que casa con la plantilla. */
  const [tipoProcedimiento, setTipoProcedimiento] = useState<TipoProcedimiento | null>(null);
  /** El profesional puede decidir usar el texto general aunque exista plantilla. */
  const [sinPlantilla, setSinPlantilla] = useState(false);
  const [relacion, setRelacion] = useState<RelacionFirmante>('paciente');
  const [firmanteNombre, setFirmanteNombre] = useState(nombrePaciente);
  const [firmanteDocumento, setFirmanteDocumento] = useState(docPaciente);
  const [textoEditado, setTextoEditado] = useState<string | null>(null);
  const [firma, setFirma] = useState<TrazoFirma[]>([]);
  const [revocando, setRevocando] = useState<string | null>(null);

  // Sugerencias: procedimientos ya registrados en esta atención y el servicio de la cita. Cada una
  // lleva su tipo cuando viene de un procedimiento registrado, para encontrar su plantilla.
  const sugerencias = useMemo(() => {
    const out: { texto: string; tipo: TipoProcedimiento | null }[] = [];
    for (const p of a.procedimientos) {
      const texto = p.nombre || TIPO_PROCEDIMIENTO_LABEL[p.tipo];
      if (texto && !out.some((x) => x.texto === texto)) out.push({ texto, tipo: p.tipo });
    }
    if (a.servicio.nombre && !out.some((x) => x.texto === a.servicio.nombre)) out.push({ texto: a.servicio.nombre, tipo: null });
    return out;
  }, [a.procedimientos, a.servicio.nombre]);

  // Plantillas de consentimiento (5.2). Se buscan por el tipo del procedimiento y, si no, por nombre.
  const { data: plantillas = [] } = usePlantillas('consentimiento');
  const datos: DatosConsentimiento = {
    firmante: firmanteNombre.trim(), documento: firmanteDocumento.trim(), relacion,
    paciente: nombrePaciente, profesional, procedimiento, sede: a.sede?.nombre,
  };
  const plantilla = useMemo(
    () => (sinPlantilla ? null : plantillaParaProcedimiento(plantillas, { tipo: tipoProcedimiento, texto: procedimiento })),
    [plantillas, tipoProcedimiento, procedimiento, sinPlantilla],
  );
  const textoBase = textoConsentimiento(datos, plantilla);
  const texto = textoEditado ?? textoBase;

  const puntosFirma = firma.reduce((n, t) => n + t.puntos.length, 0);
  const faltantes: string[] = [];
  if (procedimiento.trim().length < 3) faltantes.push('el procedimiento');
  if (firmanteNombre.trim().length < 3) faltantes.push('el nombre de quien firma');
  if (relacion === 'apoderado' && !firmanteDocumento.trim()) faltantes.push('el documento del apoderado');
  if (texto.trim().length < 40) faltantes.push('el texto (quedó muy corto)');
  if (puntosFirma < MIN_PUNTOS_FIRMA) faltantes.push('la firma');

  const cambiarRelacion = (r: RelacionFirmante) => {
    setRelacion(r);
    setFirmanteNombre(r === 'paciente' ? nombrePaciente : '');
    setFirmanteDocumento(r === 'paciente' ? docPaciente : '');
  };
  const reiniciar = () => {
    setAbierto(false); setProcedimiento(''); setTipoProcedimiento(null); setSinPlantilla(false);
    setRelacion('paciente'); setFirmanteNombre(nombrePaciente);
    setFirmanteDocumento(docPaciente); setTextoEditado(null); setFirma([]);
  };
  /** Al escribir o elegir el procedimiento: si coincide con una sugerencia, se toma su tipo. */
  const cambiarProcedimiento = (texto: string) => {
    setProcedimiento(texto);
    const s = sugerencias.find((x) => x.texto === texto);
    setTipoProcedimiento(s?.tipo ?? null);
    setTextoEditado(null); // el texto se vuelve a armar con la plantilla que corresponda
  };

  const firmarMut = useMutation({
    mutationFn: () => historiaClinicaApi.crearConsentimiento(a.id, {
      procedimiento: procedimiento.trim(), texto: texto.trim(), firmanteNombre: firmanteNombre.trim(),
      firmanteDocumento: firmanteDocumento.trim() || null, firmanteRelacion: relacion, firma, firmaAspecto: ASPECTO_FIRMA,
    }),
    onSuccess: (r) => {
      toast.success(`Consentimiento N° ${String(r.numero).padStart(5, '0')} registrado`);
      qc.invalidateQueries({ queryKey: atencionKey(a.id) });
      reiniciar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revocarMut = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => historiaClinicaApi.revocarConsentimiento(id, motivo),
    onSuccess: () => {
      toast.success('Consentimiento revocado');
      qc.invalidateQueries({ queryKey: atencionKey(a.id) });
      setRevocando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const verPdf = async (id: string) => {
    try {
      const url = URL.createObjectURL(await historiaClinicaApi.blobConsentimientoPdf(id));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return {
    lista: a.consentimientos ?? [], cerrada, puedeFirmar, nombrePaciente,
    abierto, setAbierto, reiniciar, procedimiento, setProcedimiento: cambiarProcedimiento, sugerencias,
    plantilla, sinPlantilla, setSinPlantilla,
    relacion, cambiarRelacion, firmanteNombre, setFirmanteNombre, firmanteDocumento, setFirmanteDocumento,
    texto, textoEditado, setTextoEditado, textoBase, firma, setFirma, faltantes,
    firmarMut, revocando, setRevocando, revocarMut, verPdf,
  };
}
