// Consentimiento informado (5.1) — lógica de la pestaña «Consentimientos» de la HC.
// El texto sale de una plantilla general con los datos del paciente, del profesional y del
// procedimiento; se puede ajustar antes de firmar. Lo que se firma queda como snapshot (inmutable).
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { historiaClinicaApi, atencionKey, TIPO_PROCEDIMIENTO_LABEL, type AtencionCompleta, type RelacionFirmante, type TrazoFirma } from '../api/historiaClinica';
import { ASPECTO_FIRMA } from '../components/historiaClinica/FirmaPad';

const MIN_PUNTOS_FIRMA = 12; // igual que el API (FIRMA_VACIA)

export function textoConsentimiento(p: {
  firmante: string; documento: string; relacion: RelacionFirmante; paciente: string; profesional: string; procedimiento: string;
}): string {
  const quien = p.relacion === 'apoderado'
    ? `Yo, ${p.firmante || '________'}, identificado(a) con ${p.documento || '________'}, en mi calidad de apoderado(a) o representante de ${p.paciente},`
    : `Yo, ${p.firmante || '________'}, identificado(a) con ${p.documento || '________'},`;
  const proc = p.procedimiento.trim() || '________';
  return [
    `${quien} declaro que ${p.profesional} me ha explicado de forma clara y comprensible, y con palabras que entiendo:`,
    `1. En qué consiste el procedimiento «${proc}», su finalidad y cómo se realiza.`,
    '2. Los beneficios que se esperan y las alternativas disponibles, incluida la de no realizarlo y sus consecuencias.',
    '3. Los riesgos y molestias posibles: dolor, sangrado, infección, reacción a la anestesia local o a los productos que se usen, retraso en la cicatrización y que la lesión vuelva a aparecer. En personas con diabetes o mala circulación estos riesgos pueden ser mayores.',
    '4. Los cuidados que debo seguir después y la importancia de acudir a los controles indicados.',
    'He podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención.',
    'Por lo anterior, doy mi consentimiento libre y voluntario para que se me realice el procedimiento indicado (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).',
  ].join('\n');
}

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
  const [relacion, setRelacion] = useState<RelacionFirmante>('paciente');
  const [firmanteNombre, setFirmanteNombre] = useState(nombrePaciente);
  const [firmanteDocumento, setFirmanteDocumento] = useState(docPaciente);
  const [textoEditado, setTextoEditado] = useState<string | null>(null);
  const [firma, setFirma] = useState<TrazoFirma[]>([]);
  const [revocando, setRevocando] = useState<string | null>(null);

  // Sugerencias: procedimientos ya registrados en esta atención y el servicio de la cita.
  const sugerencias = useMemo(
    () => [...new Set([...a.procedimientos.map((p) => p.nombre || TIPO_PROCEDIMIENTO_LABEL[p.tipo]), a.servicio.nombre].filter(Boolean))],
    [a.procedimientos, a.servicio.nombre],
  );
  const textoBase = textoConsentimiento({ firmante: firmanteNombre.trim(), documento: firmanteDocumento.trim(), relacion, paciente: nombrePaciente, profesional, procedimiento });
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
    setAbierto(false); setProcedimiento(''); setRelacion('paciente'); setFirmanteNombre(nombrePaciente);
    setFirmanteDocumento(docPaciente); setTextoEditado(null); setFirma([]);
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
    abierto, setAbierto, reiniciar, procedimiento, setProcedimiento, sugerencias,
    relacion, cambiarRelacion, firmanteNombre, setFirmanteNombre, firmanteDocumento, setFirmanteDocumento,
    texto, textoEditado, setTextoEditado, textoBase, firma, setFirma, faltantes,
    firmarMut, revocando, setRevocando, revocarMut, verPdf,
  };
}
