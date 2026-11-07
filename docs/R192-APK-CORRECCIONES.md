# R192 · Correcciones APK (PDF «Sublichat APK correcciones», 07/11/2026)

Estado: **listo para staging, NO publicado.** Sin datos reales, sin pedidos de venta, sin cambiar credenciales. Navbar de la APK intacto (Inicio · Clientes · Cobros · Tickets · Más) y categorías de Más sin cambios.

## Archivos por proyecto

| Proyecto | Archivo | Cambio |
|---|---|---|
| **Sublichat HQ (Vercel)** | `api/_baul-apks.js` | `mensajeCliente()` y `pasosInstalacion()`: el mensaje para el cliente se arma en el servidor desde el mismo registro del Baúl. |
| | `api/_finanzas-mes.js` | `cobrosPorPlataforma`: lo cobrado del mes por plataforma, un pago = una vez; «Pago combinado» aparte. La suma da exacto lo cobrado. |
| | `sala-juntas.js` + `index.html` (solo `?v=…r192`) | `/?sala=personaje` y `/?sala=escenarios` abren «Mi avatar» y «Escenarios» de la misma sala web. Los ids de reunión siguen validados. |
| | `tests/r192-apk-correcciones.test.mjs` | Nuevo. |
| **sublicuentas-tg-bot (Render)** | `index_31_finanzas_libro.js` | **🔒 Cierre del ciclo** en Finanzas › Libro: vista previa → confirmar. Usa el mismo documento y la misma transacción que la Web (`finanzas_ciclos` + `libro_mayor`). Es idempotente: cerrar dos veces no duplica. Queda auditado. |
| | `index_05_finanzas_menus.js` | «🧾 Cierre de caja» ahora avisa: *es un reporte, NO cierra el ciclo*. |
| | `index_37_baul_apks.js`, `lib_baul_apks.js` | Botón «📋 Mensaje para el cliente» con el mismo texto que la APK. El archivo `lib_baul_apks.js` es copia fiel. |
| | `tests/r192-cierre-ciclo-baul.test.js` | Nuevo. |
| **APK** | `src/app/sala-juntas.js` | Detalle con la sala 3D real, avatares de las participantes, «Entrar a Sala 3D», «⏳ Esperando autorización» (vía `solicitud_estado`) y tarjeta «Mi avatar y escenarios». |
| | `src/app/baul-apks.js` | Tres niveles: logo de la plataforma → dispositivos → apps. Incluye «Copiar instrucciones completas» y «Enviar al cliente» (abre Compartir; usted elige WhatsApp y confirma). La URL técnica solo la ven los editores. Aviso en iPhone y nota L85 de SmartOne. |
| | `src/app/finanzas-libro.js` | Resumen = solo el mes actual (hora de Honduras). Cierre = ciclo vigente, alerta de conciliación y cierre guiado. La edición de movimientos ya no salta. |
| | `src/screens.js`, `src/styles.css` | Tarjetas de Más con relieve 3D suave y estilos nuevos de Baúl, Sala y filas del mes. |
| | `public/assets/sala/sala-escenario-c.webp` | Imagen de la sala, la misma de la Web. |
| | tests | `r192-apk-correcciones` nuevo. `r104`, `r106` y `r187` ajustados al nuevo diseño. Stub de intent que registra las URL abiertas. |

## Qué se corrigió

1. **Sala de Juntas.** Es la misma sala 3D de Sublichat Web.
   - «Entrar a Sala 3D» abre `/?sala=<id>` en Chrome, después de confirmar. El micrófono y la cámara solo los pide la web.
   - Si la reunión está en curso y usted no es la anfitriona: «Esperando autorización».
   - «Mi avatar» y «Ver salas» siempre están disponibles y no se saltan la autorización.
   - No lleva claves de LiveKit.
   - Un WebView dentro de la APK no se puede verificar aquí, así que se usa el navegador.
2. **Baúl.** Paso 1 de 3: plataforma (logos de la app; Lion y Nanotech llevan su inicial porque todavía no tienen logo). Paso 2: dispositivos. Paso 3: apps con «Opción N».
   - El mensaje sale del servidor: es el mismo que da el bot.
   - El código aparece solo si existe y el enlace solo si aplica.
   - En Smart TV con tienda no se inventan URL.
   - **Nunca se envía solo.**
3. **Finanzas.**
   - Resumen: cobrado, egresos, planilla, resultado, ventas generadas y pendiente, por separado. Debajo, los cobros por plataforma en filas legibles (ya no se montan).
   - **Causa del «Ciclo abierto desde 01/10»:** el «Cierre de caja» de Telegram es solo un reporte y nunca guardó un cierre de ciclo. Por eso no existe un cierre al 31/10.
   - Ahora la pestaña Cierre muestra esa diferencia con el botón «Revisar cierre al 31/10/2026». No se cierra nada solo y no se editan saldos.
   - El cierre lo hace usted desde la APK, la Web o el bot, y queda igual en los tres.
4. **Movimientos.** Corregir, Fecha, Anular o Cancelar guardan el ancla de la fila, los filtros y el foco. Recarga sin vaciar la lista, y si hay error la lista se queda.
5. **Más.** Las tarjetas llevan un relieve consistente.

## Pruebas (datos ficticios)

| Proyecto | Resultado |
|---|---|
| APK | **421/421**. `vite build` OK. `main.js` tiene 1998 líneas. |
| Sublichat HQ | 270 pasan y 3 fallan. Las 3 fallas ya existían y no tienen relación (finanzas-libro-api, juegos-puntos, Prueba H). |
| Bot | **180/180** |

- **Cierre del bot:** octubre queda cerrado con saldo L1,400, noviembre arranca el 01/11 y el ingreso de noviembre no entra. Cerrar de nuevo no duplica. No se crean ni se borran movimientos. Una fecha futura se rechaza.
- **Capturas** (zip 84): Más, detalle de la Sala, Baúl en sus 3 niveles, Lion › Smart TV con la nota L85, Resumen del mes y Cierre con la alerta.

## Para cuadrar octubre (después de publicar, lo hace usted)

1. Entre a Finanzas › Cierre y verá «No hay cierre registrado al 31/10/2026».
2. Toque «Revisar cierre al 31/10/2026».
3. Revise los totales y confirme. También puede hacerlo desde el bot: 💼 Finanzas › Libro › 🔒 Cierre del ciclo.

## Rollback

- **Sublichat HQ:** volver a subir los 4 archivos del zip 75 / R189 o de la versión anterior.
- **Bot:** volver a subir los 4 archivos anteriores.
- **APK:** recompilar con la fuente del zip 76.
- Si ya se hizo un cierre de ciclo, el rollback de código no lo borra. No hay migraciones.

**Pendiente en teléfono real:** que Compartir abra WhatsApp, que Chrome abra la sala y que el scroll al corregir movimientos no salte.
