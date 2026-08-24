import { QueryClient } from '@tanstack/react-query';

/**
 * Singleton del cliente de TanStack Query. Vive en su propio módulo (no en main.tsx) para poder
 * importarlo desde el store de auth sin crear un ciclo con el árbol de React → así el `logout`
 * puede vaciar la caché de datos del usuario que sale (que si no, quedaría en memoria para el
 * siguiente en iniciar sesión, ya que el logout NO recarga la página).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
