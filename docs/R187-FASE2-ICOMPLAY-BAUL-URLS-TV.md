# R187 · Fase 2 de 5 — ICOMPLAY + Baúl de APKs + URLs de conexión de TV Digital (PDF «Sublichat 5 puntos», 07/11/2026)

Estado: **listo para staging, NO publicado**. Pruebas con Firestore en memoria y datos FICTICIOS. No se creó ninguna venta real.

## 1. ICOMPLAY (nombre oficial)

- Ya no dice «ICOMPLAY MAX» en ningún lado: Web, bot, APK, Control Maestro, chat y acceso.
  - Max Player es otro reproductor; no se mezcla.
  - Lo que ya estaba escrito como «icomplay max 3» se sigue entendiendo (alias), así que ningún cliente se rompe.
- **Nuevo: 2 pantallas** (`icomplay2`). Ahora son 1, 2, 3, 5 y 7 pantallas × 1, 3, 6 y 12 meses = **20 tarifas exactas**:

| Pantallas | 1 mes | 3 meses | 6 meses | 12 meses |
|---|---|---|---|---|
| 1 | L179 | L499 | L949 | L1799 |
| 2 | L219 | L599 | L1149 | L2149 |
| 3 | L249 | L699 | L1349 | L2499 |
| 5 | L329 | L929 | L1799 | L3399 |
| 7 | L399 | L1129 | L2199 | L4199 |

- **Catálogo central** en `configuracion_tv_digital/planes`. Web, APK (configuración remota `planesTv`) y bot leen lo mismo.
- Cambiar una tarifa (Web → Bodega → 🧰 Baúl de APKs → Tarifas ICOMPLAY):
  - aplica solo a ventas futuras;
  - la anterior queda archivada con fecha y usuario, y queda en auditoría;
  - las ventas hechas conservan su precio.
- Una combinación que no existe (4 pantallas, 2 meses) da error. Nunca da L0.

## 2. Baúl de APKs

- Es el directorio exacto del PDF, con sus semillas:
  - Sublicuentas 298863, compartida con LionTV, ICOMPLAY, LatinTV y Nanotech;
  - Latv-Gt aparte, sin código;
  - Oleada Fire TV `mgs_pro.apk` 1290332;
  - Oleada móvil `aftv.news/4221609`. **Ese número NO se entrega como código** porque no está confirmado; queda como «por confirmar» y solo lo ve el editor;
  - Stella **sin iPhone ni PC**;
  - Max Player y SmartOne en la tienda del TV, sin URL inventada. SmartOne lleva la nota «L85 por dispositivo».
- **Web**: Bodega → 🧰 Baúl de APKs. Consulta y, para Sublicuentas/Relojes, agregar, editar, desactivar y eliminar.
- **APK**: Más → **Baúl de APKs**. Solo se agregó esta tarjeta; el navbar y las demás tarjetas no cambian. Ahí se puede:
  - copiar la URL y el código;
  - «Abrir» (solo enlaces https);
  - como editor, editar la URL, el código y la nota, y activar o desactivar.
- **Bot**: `/baul` → plataforma → dispositivo → enlaces. Los administradores pueden:
  - editar (`url | código | nota`);
  - desactivar;
  - eliminar con confirmación.

**Reglas del servidor** (ocultar botones no es la seguridad):

- La URL tiene que ser http(s) con dominio.
- El código lleva solo números.
- El mismo código no se reutiliza en otra app.
- Para eliminar un enlace, primero hay que desactivarlo.
- Cada cambio sube la revisión y queda en `auditoria_eventos` con el usuario.

**Quién lo ve:**

- Web y APK: módulo «Baúl de APKs». Por defecto lo tienen Relojes y Geisell, más los editores. Sublicuentas lo activa por usuario en Permisos.
- Bot: administradores, más Relojes y Geisell.

## 3. URLs de conexión de TV Digital (aparte del Baúl)

- Se pueden agregar, editar, desactivar y eliminar:
  - Web: Bodega → URLs TV Digital;
  - bot: `/urltv`, `/urltv_nueva clave | Nombre | http://…`;
  - APK: ver, copiar y activar/desactivar.
- **Desactivar no rompe a nadie**: la URL solo deja de ofrecerse para entregas nuevas. Los clientes que ya la tienen la siguen viendo.
- **Eliminar** solo es posible si se cumplen las tres condiciones:
  - la agregó Sublicuentas (las de fábrica no se eliminan);
  - está desactivada;
  - tiene 0 clientes asignados.
- Historial de cada acción (agregar, editar, activar, desactivar, eliminar) con la URL anterior, el usuario y la fecha.

## Qué se publica dónde

| Proyecto | Archivos | ¿APK nueva? |
|---|---|---|
| **Sublichat HQ (Vercel)** | `api/_baul-apks.js`, `api/_planes-tv.js` (nuevos); `api/_tv-digital.js`, `inventario.js`, `_permisos.js`, `mobile-core.js`, `acceso.js`, `chat.js`, `renovar.js`; `sublichat-app.js`, `index.html`, `control-maestro.js` | No |
| **sublicuentas-tg-bot (Render)** | `index_37_baul_apks.js`, `lib_baul_apks.js`, `lib_planes_tv.js`, `lib_tv_digital.js` (nuevos); `index_01` a `index_06` | No |
| **APK** (`SUBLICUENTAS_ANDROID_SOURCE_1_0.zip`, rama `android-v1-r13-limpio`) | `src/app/baul-apks.js` (nuevo); `operations.js`, `app/core.js`, `data.js`, `screens.js`, `main.js`, `styles.css` | **Sí** (para Más → Baúl e ICOMPLAY 2 pantallas) |

⚠️ `renovar.js`, `sublichat-app.js` (HQ) y `index_03`/`index_06` (bot) **incluyen también lo de R186**: reemplazan la versión R186.
Si R186 todavía no está subido, suba primero el zip R186 completo (66/67) y luego este.

## Pruebas

| Proyecto | Resultado | Detalle |
|---|---|---|
| Sublichat HQ | **254 de 257** | Nueva `r187-tv-digital` (6). Las 3 que fallan ya fallaban antes: 2 por librerías que no hay en este entorno y la Prueba H del 01/11. |
| Bot | **173/173** | Nueva `r187-baul-icomplay` (7). |
| APK | **409/409** | Nueva `r187-baul-icomplay` (4); r37/r39 actualizadas por la tarjeta nueva. `vite build` OK. |

**Pendiente real (Sublicuentas):**

- Revisar en staging que el directorio del Baúl sea el correcto antes de publicar.
- Confirmar si 4221609 es código Downloader. Si lo es, se edita en el Baúl y se marca como código.

## Rollback

No hay migraciones; los documentos nuevos (`planes`, `baul_apks`) quedan sin uso. Para volver atrás:

- **Sublichat HQ:** volver a subir los archivos de R186.
- **Bot:** volver a subir los archivos de R186. `index_37` y las `lib_*` nuevas quedan sin uso.
- **APK:** reinstalar la anterior.
- **Servicios `icomplay2`:** si se vendió alguno antes del rollback, la versión vieja lo muestra con la clave cruda. No se pierde nada.
