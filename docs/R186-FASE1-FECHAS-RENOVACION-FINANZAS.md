# R186 · Fase 1 de 5 — Fechas de renovación + renovación por lote + Finanzas del mes + Excel (PDF «Sublichat 5 puntos», 07/11/2026)

Estado: **listo para staging, NO publicado**. Pruebas con Firestore en memoria y datos FICTICIOS. No se creó ninguna venta real.
Regla aprobada por Sublicuentas (07/11): **1 mes = 30 días · +31 días = 31 días · 2, 3, 6, 12 meses = meses calendario**.

## Auditoría (lo que había)

| Punto | Hallazgo |
|---|---|
| Fuente de datos | Firestore único. Web y APK escriben por `api/renovar.js` y `api/finanzas.js` (Vercel). El bot escribe directo en Firestore con sus propias funciones. |
| Fechas en la **APK instalada** | **Causa principal del error.** La APK calcula la fecha en el teléfono (`renewalDateForPick`): meses calendario también para «1 mes» y, si el servicio ya venció, **cuenta desde HOY** (vencía 04, pagó 07 → contaba desde el 07). Luego manda esa fecha fija al servidor. |
| Fechas en Web / servidor / bot | Desde el vencimiento, pero «3 meses» = 90 días (04/11 → 02/02), no 04/02. |
| Renovar varios en la Web | Un pedido por servicio y luego el cobro aparte: si fallaba uno quedaban renovados a medias, y el cobro podía no registrarse. |
| Renovar varios en la APK | Un pedido por servicio; el cobro viajaba en el último. Sin monto por servicio. |
| Renovar varios en el bot | Ya era una sola transacción con un solo cobro. |
| Reintentos | Si el mismo cobro llegaba dos veces, el cobro no se duplicaba pero **la fecha sí se volvía a sumar**. |
| Finanzas en la APK | La pestaña Resumen muestra el **ciclo abierto** (desde el último cierre), no el mes: si el ciclo empezó en octubre, se veía octubre + noviembre. |
| Excel en la APK | Se guardaba en Documentos y luego preguntaba si «Compartir». |

## Lo que se hizo

1. **Motor único de fechas** `api/_renovacion-motor.js` (copias fieles en el bot `lib_renovacion_motor.js` y en la APK
   `src/app/renovacion-motor.js`). Las tres pasan los **mismos 16 vectores** (`_renovacion-vectores.json`):
   04/11 + 30 d = 04/12 · + 31 d = 05/12 · + 3 m = 04/02/2027 · 30/11 + 3 m = 28/02 y luego vuelve al 30 (día ancla `diaAncla` por servicio).
2. **El servidor manda también para la APK vieja**: si la APK manda la duración elegida, el servidor ignora la fecha calculada
   en el teléfono y usa el motor. → La regla nueva funciona **hoy mismo** con la APK instalada (sin esperar la nueva).
3. **`renovar_lote`** (api/renovar.js): N servicios del mismo cliente + **1 pago** en **una sola transacción**:
   - cada servicio desde **su** vencimiento;
   - si falla uno, no se renueva ninguno y no se cobra;
   - el pago tiene una cabecera con N asignaciones (monto por servicio, fecha anterior y nueva) que deben sumar el total exacto, en centavos;
   - con el mismo operationId devuelve la misma operación y no cobra ni mueve fechas otra vez;
   - si después de renovar el servicio sigue vencido, **pide confirmar cuántos periodos** (nunca adelanta al día del pago);
   - tiene vista previa sin escribir.
   - Web y APK lo usan.
4. **Reintento del mismo cobro** (renovar uno, Web/APK/bot): si el pago ya existe, **no se vuelve a sumar la fecha**.
5. **`finanzas_mes`**: el mes calendario de Honduras (01 → 01 siguiente) sobre la fecha real del pago.
   - Montos en centavos.
   - Un pago = una operación (si entró por 2 bancos sigue siendo 1 pago).
   - Sin anulados.
   - Desglose por plataforma desde las asignaciones (no se suma 3 veces).
   - Conciliación pagos ↔ bancos.
6. **`diagnostico_duplicados`**: solo lectura. Lista cobros sospechosos (mismo cliente, monto y día en operaciones distintas) para revisión supervisada. No borra ni anula nada.
7. **APK** (requiere APK nueva):
   - Finanzas → Resumen muestra primero **«Este mes · Noviembre 2026 (hora de Honduras)»** con el botón **«⬇️ Descargar Excel del mes»**.
   - Todos los «Descargar Excel» van **directo a Descargas** (MediaStore, Android 10+). Ya no se abre «Compartir».
   - Renovar varios: vista previa con las fechas del servidor, **un monto por servicio**, una sola operación.
   - Sin conexión: la cola usa el mismo motor.

## Qué se publica dónde

| Proyecto | Cambio | ¿APK nueva? |
|---|---|---|
| **Sublichat HQ (Vercel)** | motor, renovar_lote, reintentos, finanzas_mes, diagnóstico, Web con renovación por lote | No |
| **sublicuentas-tg-bot (Render)** | motor (+3m = 3 meses calendario), día ancla, reintento no duplica fecha | No |
| **APK** (`SUBLICUENTAS_ANDROID_SOURCE_1_0.zip`, rama `android-v1-r13-limpio`) | tarjeta del mes, Excel a Descargas (código nativo nuevo), renovación por lote | **Sí** |

Con solo subir Sublichat HQ, la APK instalada ya renueva con la regla nueva (punto 2). Lo que **sí necesita APK nueva**:
el Excel a Descargas, la tarjeta del mes y el monto por servicio.

## Pruebas

- Sublichat HQ: 248 de 251 pasan.
  - Nuevas: `r186-renovacion-lote` (10) y `r186-finanzas-mes` (4).
  - Las 3 que fallan ya fallaban antes de este cambio: 2 por librerías que no están en este entorno y la Prueba H del 01/11 (tablero del mes).
- Bot: **166/166** (nuevas r186 + r163/r151/r104 actualizadas a la regla nueva).
- APK: **405/405** (nuevas r186). `vite build` compila. El Java nuevo no se pudo compilar aquí (no hay Android SDK). Lo compila GitHub Actions.
- **Pendiente real (Sublicuentas):**
  - Samsung real: «Descargar Excel» debe aparecer en Descargas y abrirse.
  - Renovar 3 servicios con un pago en staging.
  - Correr `diagnostico_duplicados` (solo lectura) y revisar la lista.

## Riesgos

- «2/3/6/12 meses» ahora dan fechas distintas a antes (04/02 en vez de 02/02). Es la regla aprobada.
- La APK vieja: si el usuario elige **fecha personalizada**, se respeta esa fecha (como antes).
- `renovar_lote` exige que todos los servicios sean del mismo cliente (mismo documento).

## Rollback

- Sublichat HQ: volver a subir los archivos anteriores. Los campos nuevos quedan sin efecto y no hay migraciones:
  - `diaAncla`
  - `asignaciones` en la venta
  - `ultimaRenovacion.regla`
- Bot: volver a subir `index_03_clientes_crm.js` e `index_06_handlers.js` anteriores. `lib_renovacion_motor.js` queda sin uso.
- APK: volver a subir el zip anterior a la rama, o reinstalar la APK anterior.
