// Toda la web vive bajo un prefijo: https://<servidor>/acceso_agenda_lb/<ventana>. El prefijo se define UNA vez, en `base`
// de vite.config.ts (y el servidor lo lee de PREFIJO_WEB, ver tools/servidor/lanzador.js). El router usa BASE_WEB como
// `basename`, así que navigate('/pacientes') y <Link to> ya lo llevan puesto; esta función es para lo que NO pasa por el
// router: window.open, window.location, imágenes de /public.
export const BASE_WEB = import.meta.env.BASE_URL.replace(/\/+$/, '');

export const rutaWeb = (ruta: string) => `${BASE_WEB}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
