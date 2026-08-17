# Activar el calendario rápido de los doctores (Microsoft Graph)

Objetivo: que las citas de los doctores con buzón `@limablue.com` (Daniel, prueba IT, y
futuros) aparezcan en su calendario de Outlook **en 1–3 segundos**, en vez del correo `.ics`
que tarda.

Esto se hace **una sola vez** para toda la clínica. Sacas **3 datos** ("keys") y los pegas en
`apps/api/.env`. Necesitas entrar con la **cuenta de administrador de Microsoft 365** de la
clínica (la que administra los correos `@limablue.com`).

---

## Parte A — Registrar la aplicación

1. Entra a **https://entra.microsoft.com** e inicia sesión con el **admin de M365**.
2. En la barra de búsqueda de arriba escribe **"Registros de aplicaciones"**
   (o menú izquierdo: **Identidad → Aplicaciones → Registros de aplicaciones**).
3. Click en **➕ Nuevo registro**.
4. **Nombre:** `Limablue Agenda - Calendario`
5. **Tipos de cuenta compatibles:** selecciona
   **"Solo las cuentas de este directorio organizativo (inquilino único)"**.
6. **URI de redirección:** déjalo **vacío**.
7. Click en **Registrar**.

➡️ Te lleva a la página **"Información general" (Overview)** de la app. Ahí ves dos datos —
cópialos:

- **Id. de aplicación (cliente)** → este es tu **`AZURE_CLIENT_ID`**
- **Id. de directorio (inquilino)** → este es tu **`AZURE_TENANT_ID`**

---

## Parte B — Crear el secreto (la 3ª key)

8. En el menú izquierdo de la app, click en **"Certificados y secretos"**.
9. Pestaña **"Secretos de cliente"** → click en **➕ Nuevo secreto de cliente**.
10. **Descripción:** `Limablue Agenda`. **Expira:** elige **24 meses** (recomendado).
11. Click en **Agregar**.
12. ⚠️ **IMPORTANTE:** copia de inmediato el texto de la columna **"Valor"** →
    este es tu **`AZURE_CLIENT_SECRET`**.
    - Solo se muestra **una vez**. Si sales de la pantalla ya no lo puedes ver (tendrías que
      crear otro).
    - **NO** copies el "Id. de secreto" — ese no sirve. Es el **"Valor"**.
    - 📅 Anota la fecha de expiración: cuando venza (24 meses), hay que crear un secreto nuevo
      o el calendario rápido deja de funcionar.

---

## Parte C — Dar el permiso de calendario

13. Menú izquierdo de la app → **"Permisos de API"**.
14. Click en **➕ Agregar un permiso** → elige **"Microsoft Graph"**.
15. Elige **"Permisos de aplicación"** (⚠️ NO "Permisos delegados").
16. En el buscador escribe **`Calendars.ReadWrite`** → marca la casilla →
    click en **Agregar permisos**.
17. De vuelta en la lista, click en el botón
    **"Conceder consentimiento de administrador para [tu organización]"** → **Sí**.
18. Verifica que la fila de `Calendars.ReadWrite` quede con el **✅ verde "Concedido para…"**.

> Si el botón "Conceder consentimiento de administrador" está **gris/deshabilitado**, tu
> cuenta no tiene el rol para aprobarlo. Lo debe hacer un **Administrador global** (o
> "Administrador de aplicaciones en la nube"). Pídeselo a quien tenga ese rol.

---

## Parte D — Pegar las 3 keys y probar

19. Abre **`apps/api/.env`** y pega las 3 (quita el `#` del inicio si lo tienen):

    ```
    AZURE_TENANT_ID="el-Id-de-directorio-de-la-Parte-A"
    AZURE_CLIENT_ID="el-Id-de-aplicacion-de-la-Parte-A"
    AZURE_CLIENT_SECRET="el-Valor-del-secreto-de-la-Parte-B"
    ```

20. **Reinicia el API.**
21. Comprueba que quedó bien (desde `apps/api`):

    ```
    npx tsx scripts/test-graph.ts
    ```

    - **✅ 3/3 Graph está LISTO** → funciona. Agenda una cita de Daniel y aparecerá en su
      calendario en segundos.
    - **❌** en algún paso → el script te dice exactamente qué corregir (token malo,
      falta consentimiento admin, o buzón sin licencia).

---

## Resumen de las 3 keys

| Key en `.env`         | De dónde sale                                                    |
| --------------------- | ---------------------------------------------------------------- |
| `AZURE_TENANT_ID`     | Parte A → Overview → **Id. de directorio (inquilino)**           |
| `AZURE_CLIENT_ID`     | Parte A → Overview → **Id. de aplicación (cliente)**             |
| `AZURE_CLIENT_SECRET` | Parte B → **Valor** del secreto (solo se ve una vez)             |

## Sincronización BIDIRECCIONAL (se activa con las mismas 3 keys)

El permiso `Calendars.ReadWrite` incluye **leer y escribir**, así que al encender Azure quedan
activas las **dos** direcciones, sin permisos extra:

1. **Limablue → Outlook** (rápido): cada cita que agendes aparece en el calendario del doctor en
   1–3 s.
2. **Outlook → Limablue** (inverso): si el doctor marca un evento **"Ocupado" / "Fuera de
   oficina"** en su propio calendario `@limablue.com`, se refleja como un **bloqueo de agenda**
   en Limablue (se pinta y frena reservas a esa hora). Corre solo cada 5 min. Reglas: solo
   cuentan los buzones `@limablue.com` (un Hotmail/Gmail externo no se puede leer); nunca
   re-importa las citas que Limablue empujó; si el doctor borra el evento, el bloqueo se quita.

**Probar el inverso** (tras encender Azure): marca un evento "Ocupado" en el Outlook de Daniel y
fuerza la lectura a demanda (como admin):

```
POST /api/v1/citas/outlook/importar-ocupacion
```

Responde `{ profesionales, creados, actualizados, borrados }`. Con `creados ≥ 1`, revisa la
agenda de ese doctor: debe salir el bloqueo "Ocupado (Outlook): …" a esa hora.

## Notas

- **Es una sola app para toda la clínica.** Cubre todos los buzones `@limablue.com`. No se
  registra nada por doctor.
- **Yasica (hotmail) NO entra por aquí** — buzón externo. Sigue en el correo `.ics`, salvo que
  se le dé un buzón `@limablue.com`.
- **Seguridad (opcional, recomendado):** por defecto esta app puede escribir en *todos* los
  calendarios del tenant. Para restringirla solo a los buzones de la agenda, un admin puede
  crear una *Application Access Policy* en Exchange Online PowerShell. Pídeme el comando cuando
  quieras.
