// Tratamientos habituales por diagnóstico — GESTIÓN (23-sep-2026). Se abre desde el catálogo CIE-10 de la historia
// clínica y (06-oct-2026) desde la propia receta con «Gestionar». Desde el 06-oct solo ADMINISTRACIÓN y el MÉDICO
// AUDITOR agregan, corrigen o quitan los tratamientos que la receta ofrece con checks; los demás solo los eligen.
// Nada se borra: «Quitar» lo desactiva (las recetas ya emitidas guardan su propia copia).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { catalogosApi, useTratamientosDiagnostico, type MedicamentoItem, type TipoTratamiento, type TratamientoDiagnostico } from '../api/catalogos';
import { serviciosApi } from '../api';
import { useAuthStore } from '../stores/authStore';

/** Roles que pueden cambiar los tratamientos habituales (el servidor exige lo mismo). */
export const ROLES_TRATAMIENTOS_DX = ['admin', 'medico_auditor'];
export function usePuedeGestionarTratamientosDx(): boolean {
  const rol = useAuthStore((s) => s.usuario?.rol);
  return !!rol && ROLES_TRATAMIENTOS_DX.includes(rol);
}

export interface FormTratamiento {
  id: string | null; // null = nuevo
  tratamiento: string; presentacion: string; aplicacion: string; tipo: TipoTratamiento; marca: string;
  medicamento: { id: string; etiqueta: string } | null; servicioId: string;
  // Posología por defecto (sale llena en la receta)
  dosis: string; via: string; frecuencia: string; duracion: string; indicaciones: string;
}
const VACIO: FormTratamiento = { id: null, tratamiento: '', presentacion: '', aplicacion: '', tipo: 'MEDICAMENTO_OTC', marca: '', medicamento: null, servicioId: '',
  dosis: '', via: '', frecuencia: '', duracion: '', indicaciones: '' };

export function useGestionTratamientosDx(codigo: string) {
  const qc = useQueryClient();
  const [verInactivos, setVerInactivos] = useState(false);
  const lista = useTratamientosDiagnostico(codigo, verInactivos);
  const { data: servicios = [] } = useQuery({ queryKey: ['servicios-todos'], queryFn: () => serviciosApi.listar({ activo: true }), staleTime: 300_000 });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['tratamientos-diagnostico'] });
    void qc.invalidateQueries({ queryKey: ['catalogo-cie10-admin'] });
    void qc.invalidateQueries({ queryKey: ['catalogo-cie10-frecuentes'] });
  };

  const [form, setForm] = useState<FormTratamiento | null>(null);
  const nuevo = () => setForm({ ...VACIO });
  const editar = (t: TratamientoDiagnostico) => setForm({
    id: t.id, tratamiento: t.tratamiento, presentacion: t.presentacion ?? '', aplicacion: t.aplicacion ?? '', tipo: t.tipo, marca: t.marca ?? '',
    medicamento: t.medicamento ? { id: t.medicamento.id, etiqueta: [t.medicamento.dci, t.medicamento.concentracion, t.medicamento.formaFarmaceutica].filter(Boolean).join(' ') } : null,
    servicioId: t.servicio?.id ?? '',
    dosis: t.dosis ?? '', via: t.via ?? '', frecuencia: t.frecuencia ?? '', duracion: t.duracion ?? '', indicaciones: t.indicaciones ?? '',
  });
  const cambiar = (c: Partial<FormTratamiento>) => setForm((f) => (f ? { ...f, ...c } : f));
  /** Vincular al vademécum: el tipo pasa a ser el del catálogo (receta / venta libre / producto). */
  const vincular = (m: MedicamentoItem) => cambiar({
    medicamento: { id: m.id, etiqueta: [m.dci, m.concentracion, m.formaFarmaceutica].filter(Boolean).join(' ') }, servicioId: '',
    tipo: m.esProducto ? 'PRODUCTO' : m.requiereReceta ? 'MEDICAMENTO_RX' : 'MEDICAMENTO_OTC',
  });
  const puedeGuardar = !!form && form.tratamiento.trim().length >= 2;
  /** «Leer de la aplicación»: separa dosis / vía / frecuencia / duración del texto (mismo lector que la carga del ERP). */
  const leerMut = useMutation({
    mutationFn: () => catalogosApi.extraerPosologia(form!.aplicacion, !!form!.medicamento && form!.tipo !== 'PRODUCTO'),
    onSuccess: (p) => {
      cambiar({ dosis: p.dosis ?? '', via: p.via ?? '', frecuencia: p.frecuencia ?? '', duracion: p.duracion ?? '', indicaciones: p.indicaciones ?? '' });
      toast.success(p.dosis || p.frecuencia || p.duracion || p.via ? 'Posología leída: revísala antes de guardar' : 'No se reconoció posología en el texto');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const guardarMut = useMutation({
    mutationFn: async () => {
      const f = form!;
      const datos = {
        tratamiento: f.tratamiento.trim(), presentacion: f.presentacion.trim() || null, aplicacion: f.aplicacion.trim() || null,
        tipo: f.servicioId ? 'SERVICIO' as const : f.tipo, marca: f.marca.trim() || null,
        medicamentoId: f.servicioId ? null : f.medicamento?.id ?? null, servicioId: f.servicioId || null,
        dosis: f.dosis.trim() || null, via: f.via.trim() || null, frecuencia: f.frecuencia.trim() || null, duracion: f.duracion.trim() || null, indicaciones: f.indicaciones.trim() || null,
      };
      return f.id ? catalogosApi.editarTratamientoDiagnostico(f.id, datos) : catalogosApi.crearTratamientoDiagnostico({ cie10Codigo: codigo, ...datos });
    },
    onSuccess: () => { refrescar(); toast.success(form?.id ? 'Tratamiento actualizado' : 'Tratamiento agregado'); setForm(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const activoMut = useMutation({
    mutationFn: (t: TratamientoDiagnostico) => catalogosApi.editarTratamientoDiagnostico(t.id, { activo: !t.activo }),
    onSuccess: (t) => { refrescar(); toast.success(t.activo ? 'Tratamiento activado' : 'Tratamiento desactivado: ya no sale en la receta'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    verInactivos, setVerInactivos, items: lista.data ?? [], cargando: lista.isLoading, servicios,
    form, nuevo, editar, cambiar, vincular, cancelar: () => setForm(null), puedeGuardar, guardarMut, activoMut, leerMut,
  };
}
