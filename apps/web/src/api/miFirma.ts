import { api } from './client';
import { useAuthStore } from '../stores/authStore';

export interface EstadoFirma { tieneFirma: boolean; actualizadoEn: string | null }

// Firma y sello digitalizados del médico: solo él la sube, la ve y la estampa en SUS recetas.
export const miFirmaApi = {
  estado: () => api.get<EstadoFirma>('/mi-firma'),
  subir: (imagenBase64: string) => api.put<EstadoFirma>('/mi-firma', { imagenBase64 }),
  quitar: () => api.delete<EstadoFirma>('/mi-firma'),
  imagenBlob: async (): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const res = await fetch('/api/v1/mi-firma/imagen', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('No se pudo cargar tu firma');
    return res.blob();
  },
};
