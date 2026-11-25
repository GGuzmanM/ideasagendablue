# Modelos del mapa corporal 3D (Fisioterapia)

Herramienta para regenerar los dos modelos de la pestaña «Cuerpo 3D» de la historia clínica. No forma parte de la app:
la app solo descarga los archivos ya hechos de `apps/web/src/assets/`.

Las dos capas son **el mismo cuerpo** (misma pose y tamaño), las dos de BodyParts3D 4.0:

| Capa | Archivo que usa la app | Qué es |
|---|---|---|
| Piel | `cuerpo3d.bin` (1,4 MB) | La superficie corporal («Skin») hecha simétrica, suavizada y neutra |
| Músculos | `cuerpo3d-musculos.lbcz` (2,5 MB, gzip) | ~730 piezas: músculos, tendones, huesos, cartílagos, ligamentos y dientes |

Un solo script hace las dos: `cd tools/cuerpo3d && npm install && node construir.mjs` (≈ 90 s).

## Atribución (obligatoria)

La pantalla la muestra bajo el modelo en las dos capas (va dentro de cada archivo, campo `credito`):

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International

No quitarla. Fuente: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/> (licencia en `lic.html`, actualizada el 25-feb-2025;
copia del README oficial en `fuente-bp3d/README_e.html`).

Nota: los `.obj` originales son de 2013 y por dentro todavía dicen «CC Attribution-Share Alike 2.1 Japan», la licencia
anterior. La distribución oficial actual declara CC BY 4.0 para toda la base. Con cualquiera de las dos se cumple mostrando
la atribución; la versión antigua pediría además que los modelos derivados (los dos archivos, no la aplicación) se compartan
bajo la misma licencia. No es asesoría legal: ante la duda, escribir a DBCLS (dirección en el README).

## Regenerar

El original pesa 136 MB y **no va al repositorio** (`.gitignore`):

1. Bajar `https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip` a `fuente-bp3d/`.
2. Descomprimir sus 2 234 `.obj` en `fuente-bp3d/obj/`.
3. `npm install` (meshoptimizer) y `node construir.mjs`.

Qué hace con la piel: el original es el escaneo de un hombre real, así que no es simétrico y trae genitales. El script toma
la mitad izquierda, la refleja (cuerpo simétrico), alisa la zona genital (cuerpo neutro, como un maniquí) y suaviza el grano.

A BodyParts3D 4.0 le faltan algunos músculos (recto del abdomen, dorsal ancho, masetero, músculos de la cara).

## Lo que no se debe cambiar

- Los **ids de zona** (`cabeza`, `lumbar`, `muslo_ant_izq`…): se guardan en la historia clínica.
- La **forma o escala** de un modelo ya en uso: lo pintado con el pincel se guarda como puntos de ese modelo (en milímetros)
  y se desplazaría.
