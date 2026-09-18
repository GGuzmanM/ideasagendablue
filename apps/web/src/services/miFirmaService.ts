import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { miFirmaApi } from '../api/miFirma';

const MAX_BYTES = 500 * 1024;

const aBase64 = (f: File) => new Promise<string>((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => mal(new Error('No se pudo leer la imagen'));
  r.readAsDataURL(f);
});

/** Estado, vista previa, subida y retiro de la firma digitalizada del médico. */
export function useMiFirma() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['mi-firma'], queryFn: () => miFirmaApi.estado(), staleTime: 300_000 });
  const tieneFirma = !!data?.tieneFirma;

  // La imagen se pide autenticada y se muestra como blob (nunca queda una URL pública).
  const [previa, setPrevia] = useState<string | null>(null);
  useEffect(() => {
    if (!tieneFirma) { setPrevia(null); return; }
    let url: string | null = null;
    let vivo = true;
    miFirmaApi.imagenBlob().then((b) => { if (!vivo) return; url = URL.createObjectURL(b); setPrevia(url); }).catch(() => setPrevia(null));
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [tieneFirma, data?.actualizadoEn]);

  const refrescar = () => qc.invalidateQueries({ queryKey: ['mi-firma'] });
  const subirMut = useMutation({
    mutationFn: async (f: File) => {
      if (!/^image\/(png|jpeg)$/.test(f.type)) throw new Error('La firma debe ser una imagen PNG o JPG');
      if (f.size > MAX_BYTES) throw new Error('La imagen pesa más de 500 KB: recórtala o bájale la resolución');
      return miFirmaApi.subir(await aBase64(f));
    },
    onSuccess: () => { refrescar(); toast.success('Firma guardada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const quitarMut = useMutation({
    mutationFn: () => miFirmaApi.quitar(),
    onSuccess: () => { refrescar(); toast.success('Firma quitada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    cargando: isLoading,
    tieneFirma,
    previa,
    subir: (f: File) => subirMut.mutate(f),
    quitar: () => { if (window.confirm('¿Quitar tu firma? Las recetas volverán a salir con la línea para firmar a mano.')) quitarMut.mutate(); },
    pendiente: subirMut.isPending || quitarMut.isPending,
  };
}
