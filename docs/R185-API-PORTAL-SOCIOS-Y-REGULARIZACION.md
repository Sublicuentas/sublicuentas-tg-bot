# sublicuentas-tg-bot · R185 — API del Portal de Socios (opcional) + regularización de pedidos antiguos

Estado: **NO publicado**. Opcional: el Portal de Socios R185 funciona sin esto, con menos historial.
Solo afecta el servicio Render de la **API del panel** (`server_api.js` → `sublicuentas-panel-api.onrender.com`).
**No cambia handlers del bot de Telegram** (index_06…), ni pagos, ni permisos, ni el CRM.

## 1 · Cambios de solo lectura en `server_api.js`

| Ruta | Antes | Ahora |
|---|---|---|
| `GET /rev/compras/mias?limit=` | máx. 100 | máx. **500** (historial completo del socio) |
| `GET /rev/avisos?periodo=AAAA-MM` | siempre los 10 más recientes | con `periodo`: avisos de ese mes (hora de Honduras), hasta 200. **Sin `periodo`: igual que antes.** Mismo filtro por destinatario. |
| `GET /rev/metricas?periodo=AAAA-MM` | solo mes actual | también otros meses, misma fórmula y misma convención de fechas. Sin `periodo`: igual. |
| `GET /rev/me` | — | agrega `metas` y `metaMensual` **solo si** existen en `revendedores/{id}` (números > 0). |

Nuevo archivo: `lib_portal_socios.js` (validación de periodo, rangos, límites, metas). Consulta de avisos por rango sobre `createdAt`
con orden por el mismo campo: **no requiere índice compuesto**.

## 2 · Regularizar pedidos antiguos entregados (`migrar_pedidos_entregados_r185.js`)

Nada se ejecutó. Lo corre Sublicuentas a mano con las mismas credenciales de los otros scripts de migración.

```
node migrar_pedidos_entregados_r185.js --preview --corte=2026-10-30
node migrar_pedidos_entregados_r185.js --apply --preview-file=r185_preview_XXXX.json
node migrar_pedidos_entregados_r185.js --revert --lote=r185_XXXX
```

| Categoría | Evidencia | ¿Se marca? |
|---|---|---|
| `entregas_publicadas` | todas las entregas del pedido publicadas en el panel | sí (por defecto) |
| `ficha_armada` | el pago del pedido en Finanzas ya tiene ficha de cliente (`fichaPendiente:false`) | sí (por defecto) |
| `cliente_con_servicio` | el cliente tiene ese servicio con ese socio después de la compra | solo con `--ids` aprobados |
| `historial_entregado` | el historial dice Entregado pero el estado volvió atrás | solo con `--ids` aprobados |
| `sin_evidencia` | nada lo prueba | **nunca** (se lista para revisión) |
| `posterior_al_corte` | pedido nuevo | nunca (sigue con su estado real) |

Qué escribe por pedido: `estado: entregado`, `detalleEstado`, `estadoUpdatedAt`, una línea en `estadoHistorial` y `normalizacionR185`
(lote, motivo, evidencia, **estado anterior**, actor, fecha) + un evento en `auditoria_eventos`.
**No toca** monto, banco, comprobante, productos, `createdAt` ni Finanzas. **No manda avisos** a los socios.
Idempotente (repetir no duplica), omite pedidos cuyo estado cambió después del preview, guarda respaldo y conteo antes/después.

## Pruebas

`npm test` → **163/163** (159 de antes + 4 de R185: periodo/rangos/límites, metas, preview sin escribir, aplicar/idempotencia/visto
bueno/reversión).

## Rollback

- API: volver a subir el `server_api.js` anterior (zip del repo actual); `lib_portal_socios.js` queda sin uso. El portal sigue funcionando.
- Pedidos: `--revert --lote=…` devuelve cada pedido a su estado anterior (deja constancia en el historial).
