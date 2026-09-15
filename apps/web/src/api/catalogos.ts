// Catálogos clínicos de referencia (CIE-10 + vademécum) — solo lectura, con búsqueda difusa.
// Hooks con debounce interno (300 ms): el componente pasa el texto crudo del input.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface Cie10Item {
  codigo: string;
  descripcion: string;
  categoria: string | null;
}

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
export interface Cie10Admin extends Cie10Item { activo: boolean; usos: number }

export const catalogosApi = {
  cie10: (q: string, limit = 20) => api.get<Cie10Item[]>('/catalogos/cie10', { q, limit: String(limit) }),
  cie10Admin: (q: string, inactivos: boolean) => api.get<{ items: Cie10Admin[]; categorias: string[] }>('/catalogos/cie10/admin', { q, ...(inactivos ? { inactivos: '1' } : {}) }),
  crearCie10: (data: { codigo: string; descripcion: string; categoria?: string | null }) => api.post<Cie10Admin>('/catalogos/cie10', data),
  editarCie10: (codigo: string, data: { descripcion?: string; categoria?: string | null; activo?: boolean }) => api.patch<Cie10Admin>(`/catalogos/cie10/${encodeURIComponent(codigo)}`, data),
  medicamentos: (q: string, grupo?: string, limit = 20) =>
    api.get<MedicamentoItem[]>('/catalogos/medicamentos', { q, limit: String(limit), ...(grupo ? { grupo } : {}) }),
};

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
