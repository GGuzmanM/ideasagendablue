# Runbook de despliegue — Limablue Agenda en **Windows** (servidor nuevo)

Guía para poner el sistema en producción en un **servidor Windows** desde cero, migrando la
BD real (`Agendav2`) y la historia de Genexis. Adapta el runbook original (`DEPLOY.md`, escrito
para macOS/launchd) a Windows.x

> **Fuente de verdad de los datos:** la BD `Agendav2` (PostgreSQL local del equipo de desarrollo,
> puerto 5433). La BD vieja del puerto 5432 (`limablue_agenda`) **NO se usa**.

---

## 0. Arquitectura recomendada

| Pieza | Cómo corre | Puerto |
|---|---|---|
| **Postgres** | Docker (`docker compose`) — base `Agendav2`, usuario `postgres` | 5432 |
| **Redis** | Docker (`docker compose`) — necesario para correos, videos, locks | 6379 |
| **API** (Node, incluye worker de correos) | `pm2` (build de `dist`) | 3002 |
| **Web** (build estático + proxy `/api` y `/socket.io`) | `pm2` (`serve-prod.cjs`) | 5180 |

La clínica sigue entrando por **http://localhost:5180** (o la IP del server). El frontend usa
rutas relativas, así que **no se cambia nada de frontend** al migrar.

---

## 1. Requisitos en el servidor Windows

- **Docker Desktop** (para Postgres + Redis).
- **Node.js 20 LTS** + `npm`.
- **pm2**: `npm i -g pm2` (y para arranque en boot: `npm i -g pm2-windows-startup`).
- **Cliente PostgreSQL 18** (trae `pg_dump.exe`/`pg_restore.exe`) — para restaurar el dump.
  Ya está en `C:\Program Files\PostgreSQL\18\bin` en el equipo actual.

## 2. Traer el código

Copia/clona el repo al servidor (ej. `C:\limablue\Agenda-lb`). **No copies** `node_modules`,
`dist`, ni `apps/api/.env` (los secretos se ponen aparte en el paso 4).

```bash
npm ci            # instala dependencias con el lockfile
```

## 3. Levantar Postgres + Redis (Docker)

Crea un archivo `.env` en la RAÍZ del repo (lo lee docker-compose) con la clave real:

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=UNA_CLAVE_FUERTE_AQUI
POSTGRES_DB=Agendav2
POSTGRES_PORT=5432
REDIS_PORT=6379
```

```bash
docker compose up -d
docker compose ps        # ambos "healthy"
```

## 4. Configurar el `.env` de la API

Copia la plantilla y ajusta los valores de producción:

```bash
copy apps\api\.env.example apps\api\.env
```

Valores CRÍTICOS a cambiar en `apps/api/.env`:

| Variable | Valor en el server |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:UNA_CLAVE_FUERTE_AQUI@localhost:5432/Agendav2` |
| `REDIS_URL` | `redis://localhost:6379` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | **uno nuevo, largo y aleatorio** (obligatorio en prod) |
| `CONFIRM_TOKEN_SECRET` | **otro secreto largo** (enlaces de correo) |
| `ARCHIVO_FIRMA_SECRET` | secreto para las URLs firmadas de `/uploads` (o hereda de JWT_SECRET) |
| `API_BASE_URL` / `APP_BASE_URL` | la URL/IP real del server (ej. `http://192.168.0.X:3002` / `:5180`) |
| `CORS_ORIGIN` | la URL del frontend (ej. `http://192.168.0.X:5180`) |
| `RESEND_API_KEY` | la key real de Resend |

> Genera un secreto fuerte: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## 5. Crear la ESTRUCTURA (migraciones) — recrea TODO lo nuevo

Esto crea todas las tablas, campos nuevos e índices únicos parciales a partir de las migraciones
versionadas del repo. **Nunca `migrate dev` en producción.**

```bash
npm run build                              # compila shared → api → web (orden importa)
npm run db:migrate:prod  -w apps/api       # = prisma migrate deploy
```

## 6. Migrar los DATOS reales (dump → restore)

En el equipo ACTUAL ya tienes un dump verificado en `apps/api/backups/manual/` (o genera uno
fresco con `apps\api\scripts\backup-db-windows.ps1`). Cópialo al server y restáuralo **dentro**
del Postgres de Docker:

```bash
# El dump se hizo con --no-owner --no-privileges, así que restaura limpio.
# Como las migraciones (paso 5) ya crearon la estructura, restaura SOLO los datos:
docker cp Agendav2-XXXX.dump limablue_postgres:/tmp/agenda.dump
docker exec -i limablue_postgres pg_restore --data-only --disable-triggers --no-owner \
  -U postgres -d Agendav2 /tmp/agenda.dump
```

> Si prefieres una copia idéntica (estructura+datos) en vez de migraciones+data-only: restaura
> el dump COMPLETO sobre una BD vacía **omitiendo el paso 5**. Recomendado: migraciones + data-only,
> porque deja el historial de migraciones de Prisma consistente (`prisma migrate status` "up to date").

Verifica: `docker exec -it limablue_postgres psql -U postgres -d Agendav2 -c "select count(*) from citas;"`

## 7. Cargar la historia de Genexis (solo lectura)

Con los CSV exportados de Genexis (pacientes + historial). El import es idempotente y NO crea
citas reales — solo llena el archivo congelado `HistorialGenexis`.

```bash
npm run import:genexis -w apps/api -- --pacientes ruta\PACIENTES.csv --historial ruta\HISTORIAL.csv --tipo INICIAL --usuario DDOY
```

> ⚠️ Primero en STAGING, con backup del día, y corriéndolo **dos veces** para confirmar que la
> segunda pasada inserta 0 (idempotencia). Para actualizaciones posteriores usa `--tipo DELTA`.

## 8. Arrancar la app (pm2)

```bash
pm2 start ecosystem.config.cjs      # levanta limablue-api (:3002) y limablue-web (:5180)
pm2 save
```

Arranque automático tras reiniciar el server (Windows):

```bash
pm2-startup install                 # registra pm2 para que resucite en boot
pm2 save
```

Verificación:
```bash
pm2 status
curl -s -o NUL -w "%{http_code}\n" -X POST http://localhost:3002/api/v1/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@limablue.pe\",\"password\":\"Admin1234!\"}"
```

## 9. Backups automáticos (¡no saltarse!)

Programa el backup diario con Task Scheduler (una vez, como administrador):

```powershell
$acc = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -File "C:\limablue\Agenda-lb\apps\api\scripts\backup-db-windows.ps1"'
$trg = New-ScheduledTaskTrigger -Daily -At 2:30am
Register-ScheduledTask -TaskName 'LimablueBackupDB' -Action $acc -Trigger $trg -Description 'Backup diario BD Limablue' -RunLevel Highest
```

Genera 7 diarios + 4 semanales + 3 mensuales verificados en `apps/api/backups/postgres/`.
**Pendiente (recomendado):** copia off-site (nube/disco externo), cifrada con `age`/`gpg`.

## 10. Aparatos de consultorio (botones INICIO / FIN)

Cada consultorio puede tener un aparato ESP32 que mide el tiempo real del tratamiento (programa y
cableado en `hardware/esp32-consultorio/README.md`). Para instalarlos:

1. **Cómo llega cada sede al servidor.** El aparato llama a `POST /api/v1/dispositivo/*` desde la
   WiFi de la sede. Elige por sede:
   - red privada o VPN hasta el servidor → `API_BASE = http://<ip-del-servidor>:3002/api/v1`
     (abre el puerto 3002 del firewall de Windows solo para esa red);
   - dominio con HTTPS → `API_BASE = https://<dominio>/api/v1` y el certificado raíz en `CERT_RAIZ`.
2. **IP real detrás del proxy.** Agrega `xfwd: true` al proxy de `serve-prod.cjs`, para que el API vea
   la IP de cada aparato (sin eso ve a todos como 127.0.0.1; afecta la IP que muestra
   Administración › Aparatos y el límite por IP del login). El límite de los aparatos va por aparato,
   no por IP.
3. **Consultorios por sede.** `Sede.consultorios` ya viene cargado (Los Olivos 6, San Miguel 4,
   Lince 9, Paz Soldán 11, One 5). Si una sede cambia, actualízalo en la BD: el selector del detalle
   de la cita y el registro de aparatos usan ese número.
4. **Registrar cada aparato.** Administración › **Aparatos** › «Registrar aparato» (sede, unidad y
   consultorio). La clave se muestra **una sola vez** junto con el bloque para `config.h`. Permiso
   `dispositivos.gestionar` (admin y coordinación).
5. **Cargar el programa** con su `config.h` (red WiFi, `API_BASE`, clave y número de consultorio) y
   comprobar que en Administración › Aparatos aparece **En línea** en menos de un minuto.
6. **Prueba en el consultorio:** una cita de hoy con ese consultorio y en «Llegó» → INICIO → la cita
   pasa a «En atención» → FIN → «Completada» y el chip «Tratamiento» en el detalle de la cita.

Si un aparato se pierde o se cambia: «Revocar» (su clave deja de servir al instante) y registrar el
nuevo, o «Clave nueva» para el mismo aparato.

---

## Checklist final

- [ ] `docker compose ps` → postgres y redis **healthy**
- [ ] `prisma migrate status` → **up to date**
- [ ] `select count(*) from citas` coincide con el origen
- [ ] Historia de Genexis cargada (import idempotente confirmado)
- [ ] Login 200 · web 200 · `/socket.io` responde
- [ ] Tarea `LimablueBackupDB` creada y probada (corre el .ps1 a mano una vez)
- [ ] Prueba de RESTORE en una BD desechable (que el dump de verdad restaura)
- [ ] Aparatos de consultorio: `xfwd: true` en `serve-prod.cjs`, cada aparato **En línea** en
      Administración › Aparatos y una prueba INICIO / FIN por sede
