// Constancias y descansos médicos (5.4) — LÓGICA del bloque «Constancias» de la pestaña Receta.
// Constancia de atención: quien tiene hc.registrar (la firma quien atendió). Descanso médico: solo el
// médico con CMP que tiene sesión. Documentos inmutables: se anulan con motivo (quien lo emitió o hc.anular).
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { historiaClinicaApi, useInvalidarHistoriaClinica, MAX_DIAS_DESCANSO, type AtencionCompleta, type Constancia, type TipoConstancia } from '../api/historiaClinica';
import { abrirPdfEnPestana } from '../api/recetas';
import { useAuthStore } from '../stores/authStore';
import { diaLima } from '../utils/fechas';

const hoyLima = () => diaLima(new Date().toISOString());

export function useConstancias(atencion: AtencionCompleta, puedeRegistrar: boolean, esMedicoPrescriptor: boolean) {
  const invalidar = useInvalidarHistoriaClinica();
  const usuario = useAuthStore((s) => s.usuario);
  const tiene = useAuthStore((s) => s.tiene);
  const [tipo, setTipo] = useState<TipoConstancia | null>(null); // null = formulario cerrado
  const [desde, setDesde] = useState(hoyLima());
  const [dias, setDias] = useState('1');
  const [dxCodigo, setDxCodigo] = useState('');
  const [observacion, setObservacion] = useState('');
  const [anulando, setAnulando] = useState<string | null>(null);
  const [emitida, setEmitida] = useState<{ id: string; numero: number; tipo: TipoConstancia } | null>(null);

  const diagnosticos = atencion.diagnosticos;
  const dxPrincipal = diagnosticos.find((d) => d.principal) ?? diagnosticos[0] ?? null;
  const abrir = (t: TipoConstancia) => { setTipo(t); setDesde(hoyLima()); setDias('1'); setDxCodigo(dxPrincipal?.cie10Codigo ?? ''); setObservacion(''); setEmitida(null); };
  const cerrar = () => setTipo(null);
  const diasNum = Number(dias);
  const diasOk = Number.isInteger(diasNum) && diasNum >= 1 && diasNum <= MAX_DIAS_DESCANSO;
  const hasta = (() => { if (!diasOk) return null; const x = new Date(`${desde}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + diasNum - 1); return x.toISOString().slice(0, 10); })();
  const faltantes: string[] = [];
  if (tipo === 'descanso_medico') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) faltantes.push('la fecha de inicio');
    if (!diasOk) faltantes.push(`los días (1 a ${MAX_DIAS_DESCANSO})`);
    if (!dxCodigo) faltantes.push('un diagnóstico registrado en la atención');
  }
  const puedeEmitir = !!tipo && faltantes.length === 0;

  const emitirMut = useMutation({
    mutationFn: () => historiaClinicaApi.emitirConstancia(atencion.id, {
      tipo: tipo!, ...(tipo === 'descanso_medico' ? { desde, dias: diasNum, diagnosticoCie10Codigo: dxCodigo || null } : {}), observacion: observacion.trim() || null,
    }),
    onSuccess: (c) => {
      invalidar({ pacienteId: atencion.pacienteId, atencionId: atencion.id, citaId: atencion.citaId });
      setEmitida(c); setTipo(null);
      toast.success(`${c.tipo === 'descanso_medico' ? 'Descanso médico' : 'Constancia'} N° ${String(c.numero).padStart(5, '0')} emitida`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const anularMut = useMutation({
    mutationFn: (p: { id: string; motivo: string }) => historiaClinicaApi.anularConstancia(p.id, p.motivo),
    onSuccess: () => { invalidar({ pacienteId: atencion.pacienteId, atencionId: atencion.id, citaId: atencion.citaId }); setAnulando(null); toast.success('Documento anulado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ver = async (id: string) => { try { await abrirPdfEnPestana(() => historiaClinicaApi.blobConstanciaPdf(id)); } catch (e) { toast.error((e as Error).message); } };
  const puedeAnular = (c: Constancia) => c.estado === 'emitida' && (tiene('hc.anular') || (!!usuario && c.emisorUsuarioId === usuario.id));

  return {
    lista: atencion.constancias ?? [], puedeConstancia: puedeRegistrar, puedeDescanso: puedeRegistrar && esMedicoPrescriptor,
    tipo, abrir, cerrar, desde, setDesde, dias, setDias, hasta, dxCodigo, setDxCodigo, diagnosticos, observacion, setObservacion,
    faltantes, puedeEmitir, emitirMut, emitida, ver, anulando, setAnulando, anularMut, puedeAnular,
  };
}
