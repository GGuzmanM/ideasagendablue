# 🚀 Paso a paso — Poner Limablue Agenda en el SERVIDOR (Windows)

Guía para seguir **de corrido** cuando ya estés dentro del servidor de producción (por VPN/RDP).
Al terminar, el sistema queda corriendo con TODOS los datos y con backups automáticos.

> **Regla de oro:** los **datos** viven en un **dump** (`.dump`) y los **secretos** en `apps/api/.env`.
> Ninguno de los dos va por git — se llevan aparte, por un canal privado (USB, chat interno, etc.).
> Las **migraciones crean la estructura vacía**; el **dump mete los datos**. Necesitas AMBOS.

---

## 0. Qué vas a instalar en el servidor (una sola vez)

| Pieza | Para qué | Cómo |
|---|---|---|
| **Node.js 20 LTS** | Correr la API y el web | Instalador de nodejs.org |
| **PostgreSQL 18** | La base de datos (`Agendav2`) | Instalador de postgresql.org (deja `pg_dump.exe`/`pg_restore.exe`) |
| **Redis** | Recordatorios, videos, locks, caché | **Docker Desktop** *o* **Memurai** (ver Paso 4) |
| **pm2** | Mantener API+web vivos y en boot | `npm i -g pm2 pm2-windows-startup` |
| **Git** (opcional) | Traer el código | git-scm.com |

---

## 1. Traer el código al servidor

Copia/clona el repo (ej. a `C:\limablue\Agenda-lb`). **NO** copies `node_modules`, `dist`, ni
`apps/api/.env` (esos se generan/ponen aparte).

```bash
cd C:\limablue\Agenda-lb
npm ci
```

---

## 2. Base de datos — instalar Postgres y crear `Agendav2`

Instala **PostgreSQL 18**. Durante la instalación te pide una clave para el usuario `postgres`
— **anótala**, la usarás en el `.env`.

Crea la base (con la contraseña que pusiste). Desde una consola:

```bash
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE \"Agendav2\";"
```

> Anota el **puerto** de Postgres (por defecto **5432** en una instalación nueva; en tu equipo de
> desarrollo era 5433 porque tenías otro Postgres). Usa el que corresponda en el `.env`.

---

## 3. Configurar `apps/api/.env` (secretos + conexión)

Copia la plantilla y edítala:

```bash
copy apps\api\.env.example apps\api\.env
```

**Genera 3 secretos nuevos y fuertes** (corre esto 3 veces y copia cada resultado):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Valores a poner/ajustar en `apps/api/.env`:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:TU_CLAVE@localhost:5432/Agendav2` |
| `REDIS_URL` | `redis://localhost:6379` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | (secreto 1 generado arriba) — **obligatorio en prod** |
| `CONFIRM_TOKEN_SECRET` | (secreto 2) — enlaces de correo |
| `ARCHIVO_FIRMA_SECRET` | (secreto 3) — URLs firmadas de `/uploads` |
| `API_BASE_URL` | `http://IP_DEL_SERVER:3002` (o `https://agenda.limablue.com`) |
| `APP_BASE_URL` | `http://IP_DEL_SERVER:5180` (o el dominio) |
| `CORS_ORIGIN` | igual que `APP_BASE_URL` |
| `RESEND_API_KEY` | la key real de Resend |
| `MAIL_DRY_RUN` | `false` (para que SÍ mande correos) |

> Los secretos `JWT_SECRET`/`CONFIRM_TOKEN_SECRET` son **obligatorios** con `NODE_ENV=production`
> (la API no arranca sin ellos). Si dejas `MAIL_DRY_RUN=true`, no se envían correos reales.

---

## 4. Redis — elige UNA opción

Redis lo necesitan **recordatorios, videos, locks anti-doble-booking, caché y la cuota de correos**
(ver tabla al final). Sin Redis el sistema NO se cae, pero pierdes esas cosas.

### Opción A — **Memurai** (Redis nativo de Windows, SIN Docker) · *recomendada para servidor corporativo*
1. Descarga e instala **Memurai** (memurai.com) — se instala como **servicio de Windows**, arranca solo.
2. Queda escuchando en `localhost:6379` (igual que Redis). No hay que hacer nada más.

### Opción B — **Docker Desktop**
```bash
docker run -d --name limablue_redis --restart unless-stopped -p 6379:6379 redis:7-alpine
```

Verifica que responde (cualquiera de las dos opciones):
```bash
# Si instalaste redis-cli o Memurai trae memurai-cli:
redis-cli ping    # debe responder: PONG
```

---

## 5. Crear la ESTRUCTURA (migraciones) + compilar

Esto crea TODAS las tablas, campos e índices únicos parciales, y compila el sistema.

```bash
npm run build                          # compila shared → api → web (el orden importa)
npm run db:migrate:prod -w apps/api    # = prisma migrate deploy (NUNCA migrate dev en prod)
```

Confirma que quedó bien:
```bash
npx --workspace apps/api prisma migrate status   # debe decir "up to date"
```

---

## 6. Migrar los DATOS (restaurar el dump)

Lleva al servidor el dump más reciente (está en tu equipo en `apps/api/backups/`, o genera uno
fresco con el script del Paso 9). Cópialo, por ejemplo, a `C:\limablue\Agendav2.dump`.

Restaura **solo los datos** (la estructura ya la crearon las migraciones del Paso 5):

```bash
set PGPASSWORD=TU_CLAVE
"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" --data-only --disable-triggers --no-owner ^
  -U postgres -h localhost -p 5432 -d Agendav2 "C:\limablue\Agendav2.dump"
```

Verifica que llegaron los datos:
```bash
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d Agendav2 -c "SELECT count(*) FROM citas;"
```

> Debe coincidir (aprox.) con lo que tenías en desarrollo. Si sale 0, el dump no se restauró.

---

## 7. Cargar la historia de Genexis (solo lectura)

Con los CSV exportados de Genexis (pacientes + historial). Es idempotente y NO crea citas reales,
solo llena el archivo congelado que se ve en la ficha del paciente.

```bash
npm run import:genexis -w apps/api -- --pacientes RUTA\PACIENTES.csv --historial RUTA\HISTORIAL.csv --tipo INICIAL --usuario DDOY
```

> ⚠️ Córrelo **dos veces**: la segunda debe insertar **0** (así confirmas que es idempotente).
> Para actualizaciones posteriores usa `--tipo DELTA` en vez de `INICIAL`.

---

## 8. Arrancar la app (pm2)

```bash
pm2 start ecosystem.config.cjs     # levanta la API (:3002) y el web (:5180)
pm2 save
```

Que resucite al **reiniciar el servidor**:
```bash
pm2-startup install
pm2 save
```

Verifica:
```bash
pm2 status
curl -s -o NUL -w "%{http_code}\n" -X POST http://localhost:3002/api/v1/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@limablue.pe\",\"password\":\"Admin1234!\"}"
```

La clínica entra por **http://IP_DEL_SERVER:5180** (o el dominio si configuraste HTTPS — ver §11).

---

## 9. Backups automáticos (¡NO saltarse!)

Programa el backup diario con la Tarea Programada de Windows (una vez, como **administrador**):

```powershell
$acc = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -File "C:\limablue\Agenda-lb\apps\api\scripts\backup-db-windows.ps1"'
$trg = New-ScheduledTaskTrigger -Daily -At 2:30am
Register-ScheduledTask -TaskName 'LimablueBackupDB' -Action $acc -Trigger $trg -Description 'Backup diario BD Limablue' -RunLevel Highest
```

Genera 7 diarios + 4 semanales + 3 mensuales verificados en `apps/api/backups/postgres/`.
Corre el script **una vez a mano** para confirmar que funciona:
```powershell
powershell -ExecutionPolicy Bypass -File C:\limablue\Agenda-lb\apps\api\scripts\backup-db-windows.ps1
```

> **Pendiente recomendado:** una copia **off-site** (nube o disco externo), **cifrada** con `age`/`gpg`.
> Un backup en el mismo servidor no protege ante robo/incendio/falla del disco.

---

## 10. (Antes de una actualización grande de datos) — backup manual

Si vas a modificar muchos datos, **toma un backup fresco ANTES** para poder volver atrás:
```powershell
powershell -ExecutionPolicy Bypass -File C:\limablue\Agenda-lb\apps\api\scripts\backup-db-windows.ps1
```

---

## 11. (Opcional) HTTPS con dominio

Si accedes desde varias sedes por internet, **necesitas HTTPS** (van credenciales y datos de
pacientes). Lo más simple: **Caddy** (TLS automático con Let's Encrypt) delante del web:5180.
Ya hay un `Caddyfile` en el repo. Apunta un subdominio `agenda.limablue.com` (registro DNS A) al
servidor, abre los puertos 80/443, y actualiza `API_BASE_URL`/`APP_BASE_URL`/`CORS_ORIGIN` al dominio.

---

## ✅ Checklist final

- [ ] PostgreSQL instalado y base `Agendav2` creada
- [ ] Redis corriendo (Memurai o Docker) — `PONG`
- [ ] `apps/api/.env` con secretos nuevos + `DATABASE_URL`/`REDIS_URL` correctos + `MAIL_DRY_RUN=false`
- [ ] `npm run build` OK
- [ ] `prisma migrate status` → **up to date**
- [ ] `SELECT count(*) FROM citas` coincide con el origen
- [ ] Historia de Genexis cargada (doble corrida → 0 la segunda)
- [ ] `pm2 status` OK · login responde 200 · web abre
- [ ] Arranque en boot (`pm2-startup install`)
- [ ] Tarea `LimablueBackupDB` creada y probada a mano
- [ ] (Prueba) restaurar un dump en una BD desechable para confirmar que sirve

---

## ℹ️ Qué depende de Redis (para no asustarse si un día se cae)

| Función | Sin Redis |
|---|---|
| **Recordatorios por correo (2h antes)** y **Videos** | ❌ Se detienen (se recuperan solos al volver Redis) |
| **Correo de RESERVA** (al agendar) | ✅ Sale igual (va inline, no usa la cola) |
| Locks anti-doble-booking | 🟡 Degrada: la BD igual protege con índices únicos |
| Caché de disponibilidad | 🟡 Degrada: recalcula sin caché (más lento) |
| Candado de recálculo de Analytics | 🟡 Corre sin lock (mensaje informativo, no error grave) |
| Cuota diaria de correos | 🟡 Deja enviar igual (fail-open) |
| Login, agenda, crear/mover/cancelar citas | ✅ Funcionan normal (no usan Redis) |

**Conclusión:** el sistema **no se cae** sin Redis, pero para producción déjalo siempre arriba
(por eso Memurai como servicio, que arranca solo con Windows).

---

## 🆘 Si algo falla

- **La API no arranca** → revisa `pm2 logs limablue-api`. Casi siempre: falta `JWT_SECRET`/
  `CONFIRM_TOKEN_SECRET` en `.env`, o `DATABASE_URL` mal (clave/puerto/base).
- **"Sesión revocada" al entrar** → el usuario admin no existe en la BD restaurada. Verifica el
  restore (paso 6).
- **No llegan recordatorios/videos** → Redis apagado (paso 4) o `MAIL_DRY_RUN=true` / `RESEND_API_KEY` vacía.
- **`prisma migrate status` no dice "up to date"** → falta correr `npm run db:migrate:prod` (paso 5).
- **Restore da errores de permisos/owner** → el dump se generó con `--no-owner`; usa `--no-owner` en
  el `pg_restore` (ya está en el comando del paso 6).
