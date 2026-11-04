# Sublicuentas · Infraestructura actual y destino (Fase 0 del plan maestro)

Auditoría de código del 1/11/2026. Se basa en los tres repositorios (sublicuentas-tg-bot, sublichat-hq,
revendedoreschat). Lo que solo se ve en los paneles de Render, Vercel o Namecheap (planes, dominios, variables)
está marcado **[confirmar en panel]**.

## 1. Lo que corre hoy

| Servicio | Proveedor | Arranque | Qué hace | Costo |
|---|---|---|---|---|
| Bot Telegram + API del bot | Render (servicio "BOTG") | `npm start` → `node index.js` | Polling de Telegram, outbox, programador (7 AM, 11 AM, 7 PM, 11 PM, domingo 9 PM), espejos de Firestore, escucha IMAP (R159), consolidación de fichas, API Express con `/health`, `/api/*` y **parte** de `/rev/*` | ~US$7/mes [confirmar en panel] |
| Panel API (`sublicuentas-panel-api.onrender.com`) | Render | `node server_api.js` | Toda la API del Panel de Socios: `/rev/*` (55 rutas: compras, pedidos, entregas, buzón, Telegram, comprobantes, admin, Excel de finanzas…), sin polling | US$7/mes (0.5 CPU / 512 MB) |
| Sublichat HQ (`sublichat.capuchino.lat`, `sublichat-hq.vercel.app`) | Vercel Pro | estático + 24 funciones `api/*.js` | Web de Sublichat, URL del cliente `/c/<token>`, y **todo el backend de la APK** (`/api/mobile-core`, `/api/renovar`, `/api/finanzas`, `/api/codigos`…) | US$20/mes |
| Web de Socios (revendedoreschat) | [confirmar en panel: Vercel] | estático | Panel de Socios; llama a la Panel API de Render | — |
| Hosting Stellar Plus | Namecheap (cPanel `b-hosting.com`) | — | **Buzones de correo** de las cuentas de streaming (`…@sublicuentas.com`) que leen los códigos por IMAP (bot y APK). Posible `sublicuentas.com` | US$85.44/año |
| Firebase / Google Cloud | Google | — | Firestore (fuente de verdad), Storage (comprobantes, imágenes) | por consumo |

### Hallazgos que cambian el plan
1. **El bot y la Panel API NO están unificados todavía.** `index.js` solo trae 10 rutas `/rev` (login, clientes,
   precios, admin básico); las otras 45 (compras, entregas, buzón, comprobantes, Excel…) solo existen en
   `server_api.js`. Por eso hoy hacen falta los dos servicios. La Fase 1 (este cambio) permite montarlas en el
   mismo proceso con `UNIFICAR_PANEL_API=1`.
2. **Las 10 rutas repetidas son distintas**: las de `server_api.js` son las vigentes (perfil vivo del socio,
   permisos, verificación por `servicios[]`). Al unificar se usan esas y las viejas de `index_08_api.js` se apagan.
3. **El hosting Stellar Plus SÍ se usa**: ahí viven los buzones que leen `/code`, `/link`, `/hogar` y la sección
   Códigos de la APK. **No se puede cancelar** hasta mover esos correos a otro proveedor (ver §5).
4. **La APK depende de Vercel** (`https://sublichat.capuchino.lat/api/...` escrito en `src/api.js`). Si el
   dominio `sublichat.capuchino.lat` se apunta a Render con el mismo contenido, la APK sigue funcionando
   **sin publicar otra APK**.
5. Las funciones de Vercel no hace falta reescribirlas: `server.mjs` (nuevo, en sublichat-hq) las ejecuta tal
   cual en Express, con los mismos rewrites y headers de `vercel.json` (Fases 2 y 3).
6. `api/sorteos.js` tiene 1769 MB de memoria configurados en Vercel. En Render 512 MB hay que **medir** antes de
   juntar Sublichat con el bot.
7. Keepalive: `index.js` hace ping a la Panel API cada 8 min. En planes pagados de Render no se duerme; ahora se
   puede apagar con `ENABLE_PANEL_KEEPALIVE=0` (y se apaga solo al unificar).

## 2. Arquitectura destino recomendada

```
 APK · Web Sublichat · Portal /c/<token>          Web de Socios          Telegram
              │                                        │                     │
   sublichat.capuchino.lat  (luego app.sublicuentas.com)│                     │
              │                                        │                     │
   RENDER #2  Sublichat HQ: server.mjs                 │                     │
   (estático + 24 funciones /api, sin reescribir)      │                     │
              │                                        ▼                     ▼
              │                         RENDER #1  index.js con UNIFICAR_PANEL_API=1
              │                         (bot + Panel API + programador, un solo puerto)
              └────────────────────┬───────────────────┘
                                   ▼
                     Firebase / Firestore (sin cambios)
```

Por qué dos servicios de Render y no uno: Sublichat HQ y el bot están en repositorios distintos y Sublichat
carga sus propias dependencias (firebase-admin 11, IMAP, sorteos con mucha memoria). Juntarlo todo en 512 MB
arriesga reinicios por memoria. Con dos servicios de US$7 se cumple la meta del plan (US$7–15 fijos) y se elimina
Vercel Pro. Si las métricas muestran memoria de sobra, `server.mjs` se puede montar dentro del bot más adelante.

## 3. Ahorro esperado

| Concepto | Hoy | Después | Ahorro/mes |
|---|---|---|---|
| Vercel Pro | US$20 | US$0 (Fase 5) | US$20 |
| Render bot | ~US$7 | US$7 (bot + Panel API) | — |
| Render Panel API | US$7 | US$0 (se retira tras Fase 1) | US$7 |
| Render Sublichat HQ | — | US$7 | −US$7 |
| Stellar Plus | US$7.12 (85.44/año) | se mantiene hasta mover correos | 0 por ahora |
| **Total fijo** | **~US$41/mes** | **~US$21/mes** con hosting · **~US$14/mes** sin hosting | **US$20–27/mes** |

## 4. Variables de entorno
Lista completa (solo nombres) en `docs/.env.example` de cada repositorio. Nunca copiar valores a GitHub, al chat ni a PDFs.

## 5. Opciones para el correo (Stellar Plus)
El hosting solo puede cancelarse cuando los buzones `…@sublicuentas.com` estén en otro lado y el IMAP del bot
y de Sublichat apunte allí (variables `EMAIL_IMAP_*` / `IMAP_*_N`, sin tocar código). Opciones a evaluar con el
dueño: correo de Namecheap (Private Email), Zoho Mail o reenvío (Cloudflare Email Routing) hacia un buzón IMAP.
Decisión pendiente; no se hace nada hasta que el dueño elija.

## 6. Pendiente de confirmar en paneles (acción del dueño)
- Render: nombre, plan, comando de arranque y región de cada servicio; si "BOTG" es Web Service o Worker.
- Vercel: proyectos (sublichat-hq y revendedoreschat), dominios asignados, si hay cron jobs (en código no hay).
- Namecheap: qué sirve `sublicuentas.com` (Vercel, cPanel u otro), DNS, auto-renew de capuchino.lat e imitatiko.lat.
- Firebase: alertas de presupuesto (US$5 / US$10 / US$20).
