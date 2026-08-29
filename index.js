const { startBotPollingSafe } = require("./index_01_core");

require("./index_02_utils_roles");
require("./index_03_clientes_crm");
require("./index_04_inventario_correos");
require("./index_05_finanzas_menus");
require("./index_06_handlers");
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
  await startBotPollingSafe();
})();
