# R188 · Fases 3 y 4 de 5 — Fichas (dispositivo, URL, textos, accesos) + Spotify Familiar (PDF «Sublichat 5 puntos», 07/11/2026)

Estado: **listo para staging, NO publicado**. Pruebas con Firestore en memoria y correos ficticios. No se creó ninguna venta ni cuenta real.

## Fase 3 · Fichas: dispositivo, URL personalizada, textos y accesos

### Dispositivo por servicio (D01, D02)

- **Causa encontrada:** al editar el dispositivo de un servicio, el servidor dejaba ganar el dispositivo **viejo** guardado en el perfil. Pasaba cuando la APK o el bot mandaban solo el del servicio. La URL seguía mostrando el anterior.
  - Ahora lo que se elige en esa solicitud manda.
  - Solo cambia **ese** servicio; los demás servicios del cliente no se tocan.
- **TV Digital** (Stella, Oleada, Latin, Lion, Nanotech, ICOMPLAY): campo nuevo **«Dispositivo del cliente (este servicio)»** en la Web y la APK.
  - Opciones: Android TV, Fire TV, celular Android, Smart TV, iPhone y PC, las mismas del Baúl. Stella no ofrece iPhone ni PC.
  - El servidor rechaza cualquier valor fuera de la lista.
- **La URL del cliente** muestra «Dispositivo registrado» tomado del servicio confirmado (nunca del cliente global ni un valor por defecto):
  - TV, TV (Roku), Celular o el dispositivo de TV Digital;
  - si falta: **«Pendiente de seleccionar»**, sin inventar ninguno.
  - ⚠️ Las fichas de TV Digital que ya existen van a mostrar «Pendiente de seleccionar» hasta que el vendedor elija el dispositivo.
- La URL no guarda caché (`no-store`), así que un cambio se ve al recargar.
- Cada guardado sube `fichaVersion`.

### Textos por plataforma (configuración central y versionada: `api/_entrega-plataforma.js`)

| Plataforma | Qué se hizo | Dónde aparece |
|---|---|---|
| Crunchyroll | Ya no dice «solo para Honduras» en ningún lado (se verificó Web, APK y URL). | — |
| HBO Max | Aviso nuevo: el código de hogar puede pedirse en cualquier momento, incluso al iniciar sesión, y le ayudamos a ingresarlo. | Ficha y URL |
| Netflix Premium | Se conserva el aviso de código temporal de unos 15 días. Es distinto del de HBO y no se repite. | Ficha y URL |
| Prime Video | **«Solo disponible para la aplicación Prime Video. Prohibido ingresar en Amazon.»** Va destacado arriba en la URL. | Ficha y URL |

Un aviso se busca por la plataforma exacta, así que no pasa a otra app (Netflix VIP, Disney, etc.).

### Accesos ChatGPT / Gemini / Duolingo (D04, D05)

- **ChatGPT:** correo y contraseña (cuenta entregada).
  - En el bot, ChatGPT pasa a «correo + clave».
  - ⚠️ Una ficha ChatGPT vieja sin contraseña pedirá la clave la próxima vez que se edite.
- **Gemini / Duolingo:** campo nuevo **«Modalidad de acceso»**:
  - **Correo propio del cliente** (es la opción por defecto y como estaban todas las fichas): no se pide, no se guarda y no se muestra contraseña. Si había una guardada, se borra.
  - **Cuenta entregada por Sublicuentas:** correo y contraseña.
- Las contraseñas se manejan como el resto de plataformas que hoy llevan clave:
  - la URL solo las enseña al cliente de ese enlace;
  - no van en la dirección (query), ni en logs, ni en Excel.

## Fase 4 · Spotify Familiar

Cada familia tiene **1 correo madre + hasta 5 invitados** (se puede guardar con menos).

**Dónde se usa:**

- **Web:** Bodega → **🎵 Spotify Familiar**.
- **APK:** Más → Inventario → **🎵 Spotify Familiar**. Más no cambia: no lleva tarjeta nueva.
- **Bot:** `/spotify`.
- **Las tres opciones** son las del mockup: crear familia, agregar invitado, vincular existente y consultar. Además se puede mover y desvincular.

**Reglas (todas en el servidor, dentro de transacción):**

| Regla | Comportamiento |
|---|---|
| Madre duplicada | Si ya hay una madre activa con ese correo, se rechaza. |
| Exclusividad | Un invitado no puede estar activo en 2 familias. |
| Sexto invitado | Se bloquea y los cupos no cambian, aunque entren 2 altas a la vez. |
| Vincular existente | Busca fichas Spotify por correo o ID y usa **la misma ficha e historial**. No duplica cliente ni servicio. |
| Agregar invitado | Si el correo ya tiene ficha, la vincula en lugar de crear otra. |
| Alta de ficha Spotify (Web, APK o bot) | Si el correo ya es invitado, la ficha queda marcada sola con familia, madre y espacio. La ficha Web lo muestra al escribir el correo. |
| Mover | En una sola operación libera el cupo viejo y ocupa el nuevo. Queda en auditoría con quién, cuándo, antes y después. |
| Desvincular | Desactiva la relación. **Nunca borra** al cliente ni su historial, y avisa si el cliente sigue con ficha activa. |

**Permisos y datos:**

- Ven y editan: Sublicuentas, Relojes y Geisell. A otros usuarios Sublicuentas les da el módulo «Spotify Familiar» en Permisos. En el bot: administradores, Relojes y Geisell.
- No se guarda contraseña de Spotify.
- Sublichat no envía invitaciones ni revisa Spotify: solo lleva el control de cupos.

**Colecciones nuevas en Firestore** (no se tocó ninguna existente):

- `spotify_familias`
- `spotify_indice` (candado de exclusividad por correo)
- `spotify_familias_meta`

## Qué se publica dónde

| Proyecto | Archivos | ¿APK nueva? |
|---|---|---|
| **Sublichat HQ (Vercel)** | Nuevos: `api/_entrega-plataforma.js`, `api/_spotify-familias.js`. Cambiados: `api/renovar.js`, `api/acceso.js`, `api/inventario.js`, `api/_permisos.js`, `acceso.html`, `index.html`, `sublichat-app.js` | No |
| **sublicuentas-tg-bot (Render)** | Nuevos: `lib_entrega_plataforma.js`, `lib_spotify_familias.js`, `index_38_spotify_familias.js`. Cambiados: `index_01_core.js`, `index_03_clientes_crm.js`, `index_06_handlers.js` | No |
| **APK** (`SUBLICUENTAS_ANDROID_SOURCE_1_0.zip`, rama `android-v1-r13-limpio`) | Nuevos: `src/app/entrega-plataforma.js`, `crm-r188.js`, `spotify-familias.js`. Cambiados: `operations.js`, `api.js`, `app/core.js`, `main.js`, `styles.css` | **Sí** (campos nuevos en la ficha y Spotify Familiar) |

**Qué funciona sin APK nueva:** con solo subir Sublichat HQ, la URL de los clientes ya muestra el dispositivo, los avisos y la modalidad, y la Web ya tiene todo.

⚠️ **Orden de publicación:** estos archivos incluyen R186 y R187. Suba primero R186 (zips 66–68) y R187 (69–71), y luego este.

## Pruebas

| Proyecto | Resultado | Detalle |
|---|---|---|
| Sublichat HQ | **265 de 268** | Nuevas `r188-fichas-entrega` (D01–D05) y `r188-spotify-familias` (S01–S05). Las 3 que fallan ya fallaban antes. |
| Bot | **178/178** | Nueva `r188-entrega-spotify`. |
| APK | **413/413** | Nueva `r188-fichas-spotify`; `vite build` OK. |

**Pendiente de Sublicuentas (en staging):**

- Elegir el dispositivo en una ficha Oleada y abrir su URL.
- Crear SP-001 con datos de prueba y vincular un correo viejo.

## Rollback

No hay migraciones. Las colecciones nuevas y los campos nuevos (`equipoTv`, `modalidadAcceso`, `fichaVersion`, `spotifyFamilia*`) quedan sin uso. Para volver atrás:

- **Sublichat HQ y bot:** volver a subir los archivos de R187.
- **APK:** reinstalar la anterior.
