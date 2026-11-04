"use strict";
/* ============================================================================================================
   R161 · Plan maestro de reducción de costos — FASE 1 (unificar Bot Telegram + Panel API en un solo Render).
   Interruptores por VARIABLE DE ENTORNO para poder hacer el corte por pasos y volver atrás sin tocar código.
   Sin ninguna variable nueva, el bot se comporta EXACTAMENTE como antes (polling, tareas y keepalive activos;
   la Panel API sigue en su propio servicio con `node server_api.js`).

     UNIFICAR_PANEL_API=1         Monta en este mismo proceso todas las rutas de server_api.js (Panel de Socios,
                                  admin, entregas, buzón, Excel de finanzas). Por defecto: 0.
     TELEGRAM_POLLING_ENABLED=0   No inicia getUpdates (para desplegar el servicio nuevo sin chocar con el viejo).
                                  Por defecto: 1.
     TAREAS_FONDO_ENABLED=0       No arranca outbox, programador (7 AM, 11 AM, 7 PM, 11 PM, domingo), consolidación
                                  ni costeo automático. Por defecto: igual que TELEGRAM_POLLING_ENABLED.
     ENABLE_PANEL_KEEPALIVE=0/1   Ping cada 8 min a PANEL_API_HEALTH_URL. Por defecto: 1 si la Panel API está aparte,
                                  0 si está unificada (no tiene sentido hacerse ping a sí mismo en un plan pagado).
   ============================================================================================================ */
const SI = /^(1|true|si|sí|yes|on)$/i, NO = /^(0|false|no|off)$/i;
function flag(v, porDefecto) {
  const s = String(v ?? "").trim();
  if (!s) return porDefecto;
  if (SI.test(s)) return true;
  if (NO.test(s)) return false;
  return porDefecto;
}
function leerFlags(env = process.env) {
  const panelApiUnificada = flag(env.UNIFICAR_PANEL_API, false);
  const pollingTelegram = flag(env.TELEGRAM_POLLING_ENABLED, true);
  const tareasFondo = flag(env.TAREAS_FONDO_ENABLED, pollingTelegram);
  const keepalivePanel = flag(env.ENABLE_PANEL_KEEPALIVE, !panelApiUnificada);
  return { panelApiUnificada, pollingTelegram, tareasFondo, keepalivePanel };
}
// Variables sin las cuales el servicio no debe considerarse listo. Solo NOMBRES: nunca se leen ni imprimen valores.
function variablesFaltantes(env = process.env, flags = leerFlags(env)) {
  const req = ["BOT_TOKEN", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "JWT_SECRET"];
  if (flags.panelApiUnificada) req.push("ADMIN_USER", "ADMIN_PASSWORD", "CORS_ALLOWED_ORIGINS");
  return req.filter((k) => !String(env[k] ?? "").trim());
}
function resumenArranque(flags, faltan = []) {
  const on = (b) => (b ? "SÍ" : "no");
  return `[arranque] Panel API unificada: ${on(flags.panelApiUnificada)} · Telegram polling: ${on(flags.pollingTelegram)} · ` +
    `tareas de fondo: ${on(flags.tareasFondo)} · keepalive: ${on(flags.keepalivePanel)}` +
    (faltan.length ? ` · ⚠️ faltan variables: ${faltan.join(", ")}` : " · variables críticas: OK");
}
module.exports = { leerFlags, variablesFaltantes, resumenArranque, flag };
