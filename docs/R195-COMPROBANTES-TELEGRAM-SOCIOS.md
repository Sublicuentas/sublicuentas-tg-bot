# R195 · Comprobantes del Portal de Socios → Telegram (PDF 08/11/2026)

Estado: **listo para staging, NO publicado.** Se probó con datos, chats y token ficticios. No se tocaron precios, carrito, pedidos, pagos, entregas, la Web administrativa ni la APK.

## Causa raíz (encontrada en el código)

1. **El selector no desapareció del código, pero quedó escondido y ya venía marcado.** «Enviar a» estaba al **final** del paso Pago, después del comentario, debajo de la barra fija del celular. Además venía **marcado en Sublicuentas por defecto**: el socio nunca elegía y no lo veía.
2. **Sublicuentas leía una variable distinta.** El módulo de comprobantes (`lib_destinos_tg.js`) solo leía `SUBLICUENTAS_CHAT_ID`. El resto del sistema (Tickets, Sala de Juntas, accesos) usa `TELEGRAM_CHAT_ID_SUBLICUENTAS`.
   - Sin la variable vieja, el comprobante de Sublicuentas se iba al **primer id de `SUPER_ADMIN`**. Si ese id no es el chat de Sublicuentas, llegaba a otro chat o a ninguno.
   - Relojes caía a un id fijo escrito en el código, por eso seguía llegando.
3. **Éxito falso.**
   - Ante un 401, el envío se contaba como «enviado».
   - Si fallaban la foto y el texto, el error solo quedaba en el registro de Render y no se guardaba nada.
   - La confirmación al socio decía «avisó a Sublicuentas» sin saberlo.
4. **Markdown.** Un `_` (por ejemplo en un correo) hacía que Telegram rechazara el aviso completo («can't parse entities»).

**Falta confirmar con los registros de producción** cuál de las causas 2–4 pegó en cada pedido. Eso lo muestran el nuevo **Diagnóstico de rutas** y la lista de intentos (abajo). Las causas 1–4 están corregidas.

## Archivos

| Proyecto | Archivo | Cambio |
|---|---|---|
| **sublicuentas-tg-bot (Render)** | `lib_destinos_tg.js` | Orden para encontrar el chat: 1) `TELEGRAM_CHAT_ID_<DESTINO>` (la de Tickets), 2) `<DESTINO>_CHAT_ID`, 3) `SUPER_ADMIN` (solo Sublicuentas), 4) respaldo histórico. Cada comprobante registra qué fuente usó. |
| | `lib_voucher_tg.js` (nuevo) | Destino como enum `SUBLICUENTAS` o `RELOJES`. Outbox durable. **«Enviado» solo con `message_id` de Telegram.** Sin Markdown. Si Telegram no acepta la foto, va como documento. Errores con código y descripción, y reintentos con espera (1, 5, 15, 60 y 180 min). Si se cortó la red queda «incierto» y **no se reintenta solo**. Cada intento queda en `voucher_intentos` (solo se agrega). Incluye diagnóstico y reporte. |
| | `server_api.js` | `/rev/compra`: el destino es **obligatorio** (pedido v2). La notificación nace **en la misma escritura del pedido**. La respuesta trae el estado real. Los pedidos repetidos devuelven su estado. `/rev/renovacion`: mismo envío verificable. Rutas admin nuevas: reporte, diagnóstico y **reenvío verificado**. Reintento automático cada 2 min. |
| | `lib_compra_socios.js` | «Mis pedidos» muestra el estado del comprobante. |
| | `tests/r195-comprobantes-telegram.test.js` | Nuevo (9 casos). |
| **Panel de Socios (revendedoreschat)** | `assets/socios-2026.js` | **«¿A quién enviar el comprobante?»** va antes de adjuntar el comprobante: Sublicuentas o Relojes, ninguna marcada y obligatoria. Un borrador viejo no trae destino marcado. La confirmación y el detalle del pedido muestran el estado real: Recibido / Pendiente de envío / Error de envío. |
| | `assets/core.js` | Panel Dios › Compras: estado de Telegram en cada compra. Recuadro «Comprobantes sin confirmar en Telegram» con lista, **Diagnóstico de rutas** y **Reenviar** (solo después de confirmar que no llegó). |
| | `assets/socios-guia.css`, `index.html`, `service-worker.js` | Estilos y versión `r195`. |
| | `tests/socios-rediseno.e2e.mjs` | 2 casos nuevos (R195). Los flujos de compra ahora eligen el destino. |

## Datos por comprobante (en el pedido, campo `notificacion`)

`voucherId` (= id del pedido), `destino` (SUBLICUENTAS o RELOJES), `estado`, `intentos`, `lastError`, `lastErrorCode`, `telegramChatRef` (solo los últimos 4 dígitos), `fuente`, `telegramMessageId`, `entregadoAt`, `idempotencyKey`, `creadoAt` y `proximoIntentoAt`.

Por pedido ya existían `orderId`/`paymentId` (el id del pedido y su movimiento `socio_compra_<id>`), el socio, el archivo y la fecha. **No se guarda el token** ni el id completo del chat.

## Lo que usted hace al publicar (en este orden)

1. **Respaldo:** exporte las colecciones `compras` y `renovaciones` y guarde una copia de las variables de Render.
2. **Render → servicio de la Panel API** (`sublicuentas-panel-api`, y también el del bot si están separados):
   - Confirme que existan `TELEGRAM_CHAT_ID_SUBLICUENTAS` y `TELEGRAM_CHAT_ID_RELOJES` con el chat correcto de cada uno (el mismo donde le llegan los Tickets).
   - Los valores no se mandan por el chat.
3. Suba los archivos y abra Panel Dios › Compras › **Diagnóstico de rutas**. Cada destino debe decir «✅ el bot puede escribir» con la fuente `TELEGRAM_CHAT_ID_…`.
4. **Dos envíos de prueba reales** con un socio de prueba: uno a Sublicuentas y otro a Relojes. En cada uno, revise que llegue la foto con el número de pedido y que el pedido diga «Comprobante recibido en Telegram».
   - **No cierre la incidencia sin la prueba a Sublicuentas.**
   - Después, anule los pedidos de prueba con el flujo normal.
5. **Pendientes de antes:** el recuadro «Comprobantes sin confirmar» lista los pedidos de los últimos 45 días que no constan como entregados.
   - Los pedidos anteriores a R195 salen como «sin registro», porque antes no se guardaba si Telegram los entregó.
   - **Revise el chat de Sublicuentas** y toque **Reenviar** solo en los que no llegaron. El sistema pide confirmación y nunca reenvía uno que ya tiene `message_id`.

## Pruebas

| Proyecto | Resultado |
|---|---|
| Bot | **189/189** (incluye los 9 casos nuevos). |
| Panel de Socios | `socios-rediseno` **17/17** y `socios-guia-r185` **21/21**. |

Qué cubren:
- Prioridad del chat (causa raíz).
- Destino obligatorio y como enum.
- Sublicuentas y Relojes, cada uno llega solo a su chat.
- «Enviado» solo con `message_id`; doble clic o reintento no reenvía.
- «Chat not found» y 401 quedan como error, con el pago y el voucher intactos.
- Reintento con espera; una red cortada queda «incierto» y espera al admin.
- Si la foto falla, va como documento.
- Diagnóstico sin token ni ids.
- En el portal: selector antes del comprobante, ninguno marcado, sin destino no se envía, la elección se conserva al recargar, la confirmación es honesta cuando Telegram falla y un borrador viejo pide elegir.

**Capturas** (zip 92): selector obligatorio, recibido en Relojes y error de Telegram.

**No verificado aquí:** los registros reales de Render, el envío real a Telegram y Android/Chrome con un socio real. Son los pasos 3 y 4.

## Rollback

- **Bot:** volver a subir `lib_destinos_tg.js`, `server_api.js` y `lib_compra_socios.js` de la versión anterior, y quitar `lib_voucher_tg.js`.
- **Portal:** los 5 archivos de R191 (zip 79).
- **Datos:** no hay migraciones. El campo `notificacion` y la colección `voucher_intentos` quedan sin uso si se vuelve atrás.
