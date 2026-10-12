// Carpetas de archivos del API (12-oct-2026, instalable del servidor). En el servidor el programa y los DATOS van en
// carpetas distintas para que una actualización nunca toque lo que subieron los usuarios:
//  · UPLOADS_DIR: comprobantes, contratos, fotos clínicas, podogramas, consentimientos… (por defecto <cwd>/uploads).
//  · Los logos y fondos de PDF/correo (assets) viajan con el programa: <cwd>/assets.
import path from 'path';

export const DIR_UPLOADS = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(process.cwd(), 'uploads');
export const DIR_ASSETS = path.join(process.cwd(), 'assets');
