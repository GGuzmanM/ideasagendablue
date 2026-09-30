// Catálogos clínicos de referencia (CIE-10 + vademécum) — solo lectura, con búsqueda difusa.
// Hooks con debounce interno (300 ms): el componente pasa el texto crudo del input.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface Cie10Item {
  codigo: string;
  descripcion: string;
  categoria: string | null;
  /** Diagnóstico frecuente de la clínica (lista del ERP): sale primero y trae tratamientos habituales. */
  frecuente?: boolean;
}

/** Diagnóstico frecuente con cuántos tratamientos habituales tiene. */
export interface Cie10Frecuente extends Cie10Item { tratamientos: number }

export type TipoTratamiento = 'MEDICAMENTO_RX' | 'MEDICAMENTO_OTC' | 'PRODUCTO' | 'SERVICIO';
/** Tratamiento habitual de un diagnóstico (lista del ERP): se ofrece con checks al hacer la receta. */
export interface TratamientoDiagnostico {
  id: string;
  cie10Codigo: string;
  orden: number;
  tratamiento: string;
  presentacion: string | null;
  aplicacion: string | null;
  tipo: TipoTratamiento;
  marca: string | null;
  activo: boolean;
  /** Posología por defecto (sale llena en la receta; el médico valida). null = no se pudo leer de la aplicación. */
  dosis: string | null; via: string | null; frecuencia: string | null; duracion: string | null; indicaciones: string | null;
  medicamento: (Pick<MedicamentoItem, 'id' | 'dci' | 'concentracion' | 'formaFarmaceutica' | 'viaAdministracion' | 'nombresComerciales' | 'posologiaSugerida'> & { requiereReceta: boolean; esProducto: boolean }) | null;
  servicio: { id: string; nombre: string } | null;
}
export interface TratamientoDiagnosticoInput {
  cie10Codigo: string; tratamiento: string; presentacion?: string | null; aplicacion?: string | null; tipo: TipoTratamiento;
  medicamentoId?: string | null; servicioId?: string | null; marca?: string | null; orden?: number; activo?: boolean;
  dosis?: string | null; via?: string | null; frecuencia?: string | null; duracion?: string | null; indicaciones?: string | null;
}
export interface PosologiaExtraida { dosis: string | null; via: string | null; frecuencia: string | null; duracion: string | null; indicaciones: string | null }

export interface MedicamentoItem {
  id: string; // slug estable ("terbinafina-250-mg-tableta")
  dci: string;
  codigoAtc: string | null;
  codigoDigemid: string | null;
  concentracion: string | null;
  formaFarmaceutica: string | null;
  viaAdministracion: string | null;
  nombresComerciales: string | null; // "Lamisil, Terbisil" — solo para buscar por marca
  grupo: string | null;
  requiereReceta?: boolean; // venta bajo receta → solo en Receta Médica
  esProducto?: boolean;
  posologiaSugerida?: string | null;
}

/** Fila del catálogo CIE-10 para gestionarlo (D3): incluye inactivos y cuántos diagnósticos lo usan. */
export interface Cie10Admin extends Cie10Item { activo: boolean; usos: number; frecuente: boolean; tratamientos: number }

export const catalogosApi = {
  cie10: (q: string, limit = 20) => api.get<Cie10Item[]>('/catalogos/cie10', { q, limit: String(limit) }),
  cie10Admin: (q: string, inactivos: boolean) => api.get<{ items: Cie10Admin[]; categorias: string[] }>('/catalogos/cie10/admin', { q, ...(inactivos ? { inactivos: '1' } : {}) }),
  crearCie10: (data: { codigo?: string; descripcion: string; categoria?: string | null }) => api.post<Cie10Admin>('/catalogos/cie10', data),
  editarCie10: (codigo: string, data: { descripcion?: string; categoria?: string | null; activo?: boolean; frecuente?: boolean }) => api.patch<Cie10Admin>(`/catalogos/cie10/${encodeURIComponent(codigo)}`, data),
  medicamentos: (q: string, grupo?: string, limit = 20) =>
    api.get<MedicamentoItem[]>('/catalogos/medicamentos', { q, limit: String(limit), ...(grupo ? { grupo } : {}) }),
  cie10Frecuentes: () => api.get<Cie10Frecuente[]>('/catalogos/cie10/frecuentes'),
  tratamientosDiagnostico: (codigo: string, inactivos = false) =>
    api.get<TratamientoDiagnostico[]>('/catalogos/tratamientos-diagnostico', { codigo, ...(inactivos ? { inactivos: '1' } : {}) }),
  crearTratamientoDiagnostico: (data: TratamientoDiagnosticoInput) => api.post<TratamientoDiagnostico>('/catalogos/tratamientos-diagnostico', data),
  editarTratamientoDiagnostico: (id: string, data: Partial<Omit<TratamientoDiagnosticoInput, 'cie10Codigo'>>) =>
    api.patch<TratamientoDiagnostico>(`/catalogos/tratamientos-diagnostico/${id}`, data),
  /** Separa dosis / vía / frecuencia / duración de un texto libre («01 tab vía oral c/8h por 3 días»). */
  extraerPosologia: (texto: string, conVademecum: boolean) =>
    api.post<PosologiaExtraida>('/catalogos/tratamientos-diagnostico/extraer-posologia', { texto, conVademecum }),
};

/** Diagnósticos frecuentes de la clínica (cambian poco: 10 min de caché). */
export function useCie10Frecuentes(enabled = true) {
  return useQuery({ queryKey: ['catalogo-cie10-frecuentes'], queryFn: catalogosApi.cie10Frecuentes, enabled, staleTime: 600_000 });
}

/** Tratamientos habituales de un diagnóstico. */
export function useTratamientosDiagnostico(codigo: string | null | undefined, inactivos = false) {
  return useQuery({
    queryKey: ['tratamientos-diagnostico', codigo, inactivos],
    queryFn: () => catalogosApi.tratamientosDiagnostico(codigo!, inactivos),
    enabled: !!codigo,
    staleTime: 300_000,
  });
}

/** Valor "retrasado": cambia 300 ms después de que el usuario deja de escribir. */
export function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function useBuscarCie10(q: string, enabled = true) {
  const qd = useDebounce(q.trim());
  return useQuery({
    queryKey: ['catalogo-cie10', qd],
    queryFn: () => catalogosApi.cie10(qd),
    enabled: enabled && qd.length >= 2,
    staleTime: 60_000,
  });
}

export function useBuscarMedicamentos(q: string, enabled = true) {
  const qd = useDebounce(q.trim());
  return useQuery({
    queryKey: ['catalogo-medicamentos', qd],
    queryFn: () => catalogosApi.medicamentos(qd),
    enabled: enabled && qd.length >= 2,
    staleTime: 60_000,
  });
}
