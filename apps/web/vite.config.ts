import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import fs from 'fs';

// HTTPS con certificado autofirmado (VITE_HTTPS=true en apps/web/.env). Necesario para que el
// navegador habilite el MICRÓFONO (dictado por voz de la historia clínica) cuando se entra por la
// IP de la red (http://192.168.x.x:5180 no es "contexto seguro"; solo localhost o https lo son).
// Aplica al dev server y a `vite preview`. Cada dispositivo acepta el certificado una sola vez.
const httpsHabilitado = (mode: string) => loadEnv(mode, __dirname, '').VITE_HTTPS === 'true';

// Certificado PROPIO de confianza (22-sep-2026): si VITE_HTTPS_CERT y VITE_HTTPS_KEY apuntan a un certificado firmado
// por la autoridad local de la clínica (Documentacion Agenda › Certificado HTTPS), se usa ese en vez del autofirmado de
// basicSsl. Con la autoridad instalada en cada PC, Chrome deja de marcar «No es seguro» y vuelve a ofrecer guardar la
// contraseña. Si las rutas no existen, se sigue con el autofirmado (no se rompe nada).
const certificadoPropio = (mode: string): { key: Buffer; cert: Buffer } | null => {
  const env = loadEnv(mode, __dirname, '');
  const cert = env.VITE_HTTPS_CERT, key = env.VITE_HTTPS_KEY;
  if (!cert || !key || !fs.existsSync(cert) || !fs.existsSync(key)) return null;
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
};

// Página pública de reserva web (tools/servidor/reserva). En producción la sirve el lanzador en /reserva/;
// este plugin hace lo mismo en dev/preview para poder probarla en localhost.
const reservaPublica = (): Plugin => {
  const carpeta = path.resolve(__dirname, '../../tools/servidor/reserva');
  const tipos: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css' };
  const middleware = (req: { url?: string }, res: any, next: () => void) => {
    const ruta = (req.url || '').split('?')[0];
    if (ruta === '/reserva') { res.statusCode = 301; res.setHeader('Location', '/reserva/'); res.end(); return; }
    if (!ruta.startsWith('/reserva/')) return next();
    const rel = decodeURIComponent(ruta.slice('/reserva/'.length)) || 'index.html';
    const archivo = path.resolve(carpeta, rel);
    if (!archivo.startsWith(carpeta) || !fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) return next();
    res.setHeader('Content-Type', tipos[path.extname(archivo)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(archivo).pipe(res);
  };
  return {
    name: 'limablue-reserva-publica',
    configureServer: (s) => { s.middlewares.use(middleware); },
    configurePreviewServer: (s) => { s.middlewares.use(middleware); },
  };
};

export default defineConfig(({ mode }) => {
  const https = httpsHabilitado(mode) ? certificadoPropio(mode) : null;
  return {
  plugins: [react(), reservaPublica(), ...(httpsHabilitado(mode) && !https ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@limablue/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // host: true → escucha en TODAS las interfaces (0.0.0.0), sin esto otras PCs
    // de la LAN no pueden acceder a http://192.168.0.55:5180
    host: true,
    port: Number(process.env.PORT) || 5180,
    strictPort: false,
    ...(https ? { https } : {}),
    proxy: {
      // Target configurable (VITE_PROXY_TARGET) para apuntar el dev server a otra API
      // (staging u otra instancia); por defecto la API local en :3002.
      // `xfwd: true` propaga X-Forwarded-For/Host/Proto al backend con la IP REAL del
      // cliente que hizo la request al Vite — sin esto el backend siempre ve ::1
      // (la IP de Vite localmente) y todos los audit_logs salen con la misma IP.
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3002', changeOrigin: true, xfwd: true },
      '/socket.io': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3002', ws: true, xfwd: true },
      '/uploads': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3002', changeOrigin: true, xfwd: true },
    },
  },
  // Serving de PRODUCCIÓN del build estático (`vite preview`). Reusa el mismo proxy que
  // el dev server para que el frontend siga hablando por rutas relativas (/api, /socket.io)
  // con la API en :3002 — sin cambios en el frontend y conservando la URL :5180 de la clínica.
  preview: {
    host: true,
    port: Number(process.env.PORT) || 5180,
    strictPort: true,
    ...(https ? { https } : {}),
    proxy: {
      '/api': { target: 'http://localhost:3002', changeOrigin: true, xfwd: true },
      '/socket.io': { target: 'http://localhost:3002', ws: true, xfwd: true },
    },
  },
  };
});
