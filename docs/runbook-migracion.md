# Runbook de migración y rollback (Fases 1–5)

Regla: **no cancelar ni borrar nada** hasta que yo marque la fase como "FASE APROBADA – SEGURO PARA RETIRAR".
Cada paso se puede deshacer cambiando una variable o un DNS. Firestore no se toca.

## Fase 1 · Bot + Panel API en un solo Render (ahorro US$7/mes)

Código: `lib_infra_flags.js`, `index.js`, `index_08_api.js`, `server_api.js` (zip 17). Sin variables nuevas el
bot y la Panel API funcionan exactamente igual que hoy: se puede subir el código primero, sin riesgo.

| Variable | Valor en el servicio del BOT | Efecto |
|---|---|---|
| `UNIFICAR_PANEL_API` | `1` | Monta las 55 rutas de la Panel API en el mismo puerto del bot |
| `TELEGRAM_POLLING_ENABLED` | (sin poner) = 1 | Polling normal |
| `ENABLE_PANEL_KEEPALIVE` | (sin poner) | Con `UNIFICAR_PANEL_API=1` queda apagado solo |
| `ADMIN_USER`, `ADMIN_PASSWORD`, `RELOJES_*`, `GEISELL_*`, `MAGDIEL_*`, `CORS_ALLOWED_ORIGINS`, `STORAGE_BUCKET`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | copiar del servicio Panel API **desde el panel de Render** (no por chat) | El bot necesita las mismas variables que hoy tiene la Panel API |

Pasos (el bot ya hace polling en su servicio, así que NO hay dos pollings):
1. Subir zip 17 al repo del bot. Ambos servicios se redespliegan y siguen igual (revisar logs: `[arranque] Panel API unificada: no`).
2. En el servicio del BOT: copiar las variables de la Panel API que falten y poner `UNIFICAR_PANEL_API=1`. Guardar (redeploy).
3. Log esperado: `[arranque] Panel API unificada: SÍ · Telegram polling: SÍ · … variables críticas: OK` y `🔗 Panel API montada`.
4. Probar contra la URL del servicio del bot: `GET /health` (200), `GET /rev/ping` (versión del panel), login de un socio de prueba en una copia local de la web de socios con `apiBase` = URL del bot.
5. Cambiar consumidores a la URL del bot: Web de Socios (`apiBase` en `index.html`) y Sublichat HQ (`REV_API_BASE` en Vercel). Volver a probar compras, entregas, buzón y Excel.
6. Suspender (no borrar) el servicio Panel API. Observar 3–7 días: memoria < 80 %, sin reinicios, sin 5xx.
7. Aprobado → borrar el servicio Panel API en Render.

Rollback: quitar `UNIFICAR_PANEL_API` en el bot · reactivar la Panel API · devolver `apiBase` y `REV_API_BASE` a `https://sublicuentas-panel-api.onrender.com`.

Plan B si se prefiere un servicio NUEVO en vez del bot actual: desplegar el mismo repo con
`UNIFICAR_PANEL_API=1` y `TELEGRAM_POLLING_ENABLED=0` (no choca con el bot viejo), probar, apagar el polling del viejo,
poner `TELEGRAM_POLLING_ENABLED=1` en el nuevo y comprobar que no hay error 409.

## Fases 2 y 3 · Sublichat HQ fuera de Vercel (ahorro US$20/mes al final)

Código: `server.mjs`, `package.json`, `package-lock.json` (zip 18). Vercel lo ignora: sigue igual.

1. En Render: **New → Web Service** con el repo `Sublicuentas/sublichat-hq`, rama `main`.
   Build: `npm ci && npm --prefix api ci` · Start: `node server.mjs` · Plan Starter (0.5 CPU / 512 MB) ·
   variable `NODE_VERSION=22`. Health check: `/__salud`.
2. Copiar TODAS las variables del proyecto de Vercel al servicio nuevo (desde los paneles).
3. Probar con la URL `*.onrender.com`: login web, clientes, renovar (servicio de prueba), finanzas, códigos,
   sorteos, `/c/<token>` de un cliente de prueba, Control Maestro, tickets. Revisar memoria con sorteos abierto.
4. Corte sin tocar la APK: en Render agregar el dominio `sublichat.capuchino.lat`; en Namecheap cambiar el DNS
   de ese subdominio por el que indique Render (anotar antes el valor actual). Probar desde datos móviles y Wi-Fi.
5. Observar 7 días (Billing de Vercel sin consumo nuevo, Render sin 5xx ni reinicios).
6. Aprobado → bajar Vercel Pro a nada (Fase 5). El proyecto de la Web de Socios, si está en Vercel, se pasa a
   Render Static Site (gratis) antes.

Rollback: devolver el DNS de `sublichat.capuchino.lat` al valor anotado (Vercel sigue desplegado).

## Fase 4 · Dominios bajo sublicuentas.com (cuando lo anterior esté estable)
`api.sublicuentas.com` → bot · `app.sublicuentas.com` → Sublichat (incluye `/c/<token>` y, si se quiere,
`/socios`). Cambiar `PORTAL_CLIENTE_BASE`, `REV_API_BASE`, `apiBase` y CORS **agregando** los nuevos; los viejos
quedan redirigiendo. La APK actual seguirá usando `sublichat.capuchino.lat`: ese dominio se mantiene hasta que
todos instalen una APK nueva.

## Fase 6 · Hosting Stellar Plus
NO cancelar: tiene los buzones de los códigos. Primero mover el correo (decisión del dueño) y cambiar las
variables `EMAIL_IMAP_*` del bot y de Sublichat.

## Checklist de QA

| Módulo | Prueba | Local (01/11/2026) | Producción |
|---|---|---|---|
| Arranque | sin variables nuevas: polling, programador y keepalive como antes | PASS | pendiente |
| Arranque | `UNIFICAR_PANEL_API=1` + polling apagado: un solo puerto, `/health` del bot, `/rev/ping` del panel, `/rev/entregas` responde 401 sin sesión | PASS | pendiente |
| Arranque | `node server_api.js` sigue funcionando solo (servicio actual) | PASS | pendiente |
| Arranque | un solo `app.listen` y un solo polling por proceso (prueba automática) | PASS | — |
| Rutas | las 10 rutas `/rev` repetidas quedan cubiertas por la versión de `server_api.js` | PASS | pendiente |
| Sublichat | `server.mjs`: `/`, `/c/<token>`, rewrites, headers de caché, `/api/finanzas`, 401 en `/api/codigos` sin sesión | PASS | pendiente |
| Seguridad | no se publican `api/*.js`, `server.mjs`, `package.json`, `tests/`, `lib/`, `.git` | PASS | pendiente |
| Bot Telegram | /start, menús, clientes, renovaciones, finanzas | — | pendiente |
| API Auth | login, me, logout, rol sin permiso | — | pendiente |
| CRM / Renovaciones / Inventario / APK / Socios / Portal / IMAP / Finanzas / Sorteos / Push / Programador / Respaldo / CORS | matriz §14 del plan | — | pendiente |
| Recursos | memoria del bot unificado (en local, sin datos: ~164 MB) | medido | pendiente con datos reales |
