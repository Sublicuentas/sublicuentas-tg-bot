# Actualización de precios de socios · agosto 2026

La tarifa `propietarios_2026` corresponde a Sublicuentas, Sublicuentas 2, Relojes y Geisell. La tarifa general permanece separada.

## Orden de despliegue

1. Desplegar este proyecto (en especial el servicio que inicia `server_api.js`).
2. Desplegar Sublichat HQ y RevendedoresChat.
3. En Sublichat: **Revendedores → Precios → Sublicuentas · Relojes · Geisell → Revisar cambios → Aplicar actualización**.
4. Guardar el PIN de configuración que se muestra si `Sublicuentas 2` fue creado en ese momento.

También puede ejecutarse desde la consola del servicio:

```bash
npm run migracion:precios:preview
npm run migracion:precios:apply
```

## Seguridad de la migración

- Es idempotente: no vuelve a aplicarse accidentalmente.
- Antes de modificar datos guarda copias en `migraciones_backups/precios_socios_20260828_v1`.
- Consolida los registros `Geissel`/`Geisell` en `Geisell` y reasigna sus clientes.
- No adivina la marca de un IPTV antiguo guardado solo como `IPTV`: esos casos aparecen como pendientes para elegir manualmente entre LatinTV y LionTV.
- `Sublicuentas 2` se crea con WhatsApp `89464328`. Su ID de Telegram queda vacío hasta que se conozca; el acceso web funciona con el PIN generado.
