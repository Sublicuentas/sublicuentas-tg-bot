const { startBotPollingSafe, db, admin } = require("./index_01_core");
const { startTelegramOutboxWorker } = require("./index_22_telegram_outbox");
const { startDurableScheduler } = require("./index_24_durable_scheduler");

require("./index_02_utils_roles");
require("./index_03_clientes_crm");
require("./index_04_inventario_correos");
const finanzasMenus = require("./index_05_finanzas_menus");
const handlers = require("./index_06_handlers");
require("./index_07_imap");
require("./index_09_api_auth");  // ✅ NUEVO: Módulo compartido de auth
require("./index_08_api");
require("./index_10_reportes_excel");  // ✅ NUEVO: Generador de reportes Excel
require("./index_11_clientes_excel");  // ✅ NUEVO: Generador de clientes Excel

// Render puede dormir el servicio web después de varios minutos sin tráfico;
// por eso el primer login llegaba a tardar más de 20 segundos. Mientras este
// proceso esté activo, una petición pública cada 8 minutos mantiene caliente
// la API. La URL se puede cambiar desde PANEL_API_HEALTH_URL sin tocar código.
const PANEL_API_HEALTH_URL = String(
  process.env.PANEL_API_HEALTH_URL || "https://sublicuentas-panel-api.onrender.com/health"
).trim();

async function keepPanelApiAwake() {
  if (!PANEL_API_HEALTH_URL || typeof fetch !== "function") return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    await fetch(PANEL_API_HEALTH_URL, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "SublicuentasBot-KeepAlive/1.0" },
    });
  } catch (_) {
    // El keepalive nunca debe interrumpir el bot ni llenar el registro.
  } finally {
    clearTimeout(timeout);
  }
}

const keepAliveInicial = setTimeout(keepPanelApiAwake, 5_000);
const keepAliveRecurrente = setInterval(keepPanelApiAwake, 8 * 60 * 1000);
keepAliveInicial.unref?.();
keepAliveRecurrente.unref?.();

(async () => {
  startTelegramOutboxWorker();

  // Las migraciones dejaron de ejecutarse durante cada arranque. Si se
  // necesitan, se lanzan explícitamente con: npm run maintenance:migrations.
  startDurableScheduler([
    {
      id: "auto_txt_7am",
      type: "daily",
      hour: 7,
      minute: 0,
      run: async ({ scheduledDateDMY }) => {
        // Compatibilidad con el scheduler anterior: si hoy ya fue marcado en
        // config/dailyRun, no duplicar el envío durante el primer despliegue.
        try {
          const legacy = await db.collection("config").doc("dailyRun").get();
          if (legacy.exists && String(legacy.data()?.lastRun || "") === scheduledDateDMY) {
            return { ok: true, skippedLegacy: true };
          }
        } catch (_) {}
        const result = await handlers.enviarTxtRenovacionesDiarias7AM();
        if (result?.ok !== false) {
          await db.collection("config").doc("dailyRun").set({
            lastRun: scheduledDateDMY,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        return result;
      },
    },
    {
      id: "recordatorios_11am",
      type: "daily",
      hour: 11,
      minute: 0,
      run: ({ scheduledDateDMY }) => finanzasMenus.enviarRecordatorios11AM(scheduledDateDMY),
    },
    {
      id: "backup_dominical_21",
      type: "weekly",
      weekday: 0,
      hour: 21,
      minute: 0,
      maxCatchupDays: 6,
      run: ({ scheduledDateDMY }) => finanzasMenus.ejecutarBackupDominical(scheduledDateDMY),
    },
  ]);

  await startBotPollingSafe();
})();
