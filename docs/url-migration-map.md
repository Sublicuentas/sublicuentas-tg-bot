# Mapa de URLs y consumidores (Fase 0)

| URL hoy | URL destino | Quién la usa | Dónde está escrita | Estado |
|---|---|---|---|---|
| `https://sublicuentas-panel-api.onrender.com/rev/*` | URL del servicio unificado (bot) → luego `api.sublicuentas.com` | Web de Socios, Sublichat HQ (`/api/revendedores-admin`, `/api/tickets`, Excel de finanzas), bot | socios `index.html` (`apiBase`); HQ `REV_API_BASE` (variable, con este valor por defecto); bot `index_06_handlers.js` (texto) | Cambiar `REV_API_BASE` y `apiBase` cuando el unificado esté probado. La URL vieja deja de existir al retirar el servicio: **antes** apuntar todos los consumidores |
| `https://sublicuentas-panel-api.onrender.com/health` | `/health` del unificado | keepalive del bot | `index.js` (`PANEL_API_HEALTH_URL`) | Se apaga solo con `UNIFICAR_PANEL_API=1` |
| `https://sublichat.capuchino.lat/*` (Vercel) | mismo dominio apuntado a Render #2 (`server.mjs`) → luego `app.sublicuentas.com` | Web Sublichat, **APK** (`src/api.js`, `src/main.js`), enlaces `/c/<token>` ya enviados a clientes | APK compilada; mensajes de WhatsApp ya enviados | Mover el **dominio** (DNS), no la URL: la APK y los enlaces viejos siguen funcionando |
| `https://sublichat-hq.vercel.app` | — | origen permitido en `api/login.js` | código | Se queda como origen permitido hasta retirar Vercel |
| `https://sublichat.capuchino.lat/c/<token>` | igual | clientes (enlaces enviados), bot (`rev_entregas_api.js` → `PORTAL_CLIENTE_BASE`, por defecto ese dominio) | variable con valor por defecto | Al pasar a `app.sublicuentas.com`, cambiar `PORTAL_CLIENTE_BASE` y dejar el dominio viejo redirigiendo |
| `https://sublicuentas.com` | igual | Web de Socios (`PANEL_URL` en `core.js`), CORS del bot y de `api/login.js` | código | Confirmar en Namecheap qué lo sirve |
| `*.capuchino.lat`, `*.imitatiko.lat` | — | CORS por defecto del bot (`index_25_api_security.js`) | código | Mantener hasta retirar los dominios (Fase 4) |
| `b-hosting.com` (cPanel) IMAP | otro proveedor de correo (pendiente) | `/code`, `/link`, `/hogar`, Códigos de la APK | variables `EMAIL_IMAP_*`, `IMAP_*_N` | No tocar hasta decidir el correo |

## Funciones de Sublichat HQ (`api/*.js`) y quién las llama

Todas pasan a Render #2 **sin cambios** con `server.mjs` (mismo archivo, misma ruta `/api/<nombre>`).

| Función | Web | APK | Otro |
|---|---|---|---|
| academia | | ✔ | |
| acceso | ✔ (`/c/<token>`) | | clientes |
| auditoria | ✔ | | |
| catalogo-relojes | ✔ | ✔ | |
| chat | ✔ | ✔ | |
| codigos | | ✔ | lee IMAP del hosting |
| finanzas | ✔ | ✔ | |
| importar | ✔ | | cuerpo hasta 25 MB |
| inventario | ✔ | | |
| juegos | | ✔ | |
| login | ✔ | ✔ | |
| migraciones | ✔ | | |
| mobile-core | ✔ | ✔ | |
| partidos | ✔ | ✔ | ESPN (hasta 30 s) |
| perfil | ✔ | ✔ | |
| portal-cliente | ✔ | | |
| precios-publicos | ✔ | | |
| recordatorios | | ✔ | |
| recuperacion | ✔ | | |
| renovar | ✔ | ✔ | |
| revendedores-admin | ✔ | ✔ | llama a la Panel API |
| sorteos | ✔ | ✔ | 1769 MB en Vercel: medir en Render |
| tickets | ✔ | ✔ | llama a la Panel API |
| tmdb | ✔ | ✔ | |

Rewrites de `vercel.json` que `server.mjs` replica: `/c/(.*)` → `/acceso.html?token=$1`,
`/precios-mayoristas` y `/revendedores` → `/precios-revendedores.html`. Headers de caché: iguales.
