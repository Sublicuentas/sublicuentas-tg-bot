/* ✅ SUBLICUENTAS TG BOT — PARTE 1/6 CORREGIDA
   CORE / ARRANQUE / FIREBASE / POLLING / CONSTANTES
*/

const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

let ExcelJS = null;
try {
  ExcelJS = require("exceljs");
  console.log("✅ ExcelJS cargado");
} catch (e) {
  console.log("⚠️ ExcelJS no está instalado. El bot iniciará sin exportación Excel.");
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;
const SUPER_ADMIN = String(process.env.SUPER_ADMIN || "").trim();
const TZ = process.env.TZ || "America/Tegucigalpa";

if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN");
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error("Faltan variables Firebase");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: String(FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();
console.log("✅ FIREBASE PROJECT:", FIREBASE_PROJECT_ID);

const CORE_STATE = {
  HAS_RUNTIME_LOCK: true,
  BOT_IS_STARTING: false,
  BOT_POLLING_ACTIVE: false,
  BOT_LAST_START_AT: 0,
  BOT_START_TIMEOUT: null,
  NETFLIX_LISTENER_STARTED: false,
};

async function releaseRuntimeLock() {
  return true;
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

function clearScheduledRestart() {
  if (CORE_STATE.BOT_START_TIMEOUT) {
    clearTimeout(CORE_STATE.BOT_START_TIMEOUT);
    CORE_STATE.BOT_START_TIMEOUT = null;
  }
}

function scheduleBotRestart(delayMs = 10000) {
  clearScheduledRestart();
  CORE_STATE.BOT_START_TIMEOUT = setTimeout(() => {
    startBotSafe(true).catch((e) => {
      console.error("❌ scheduleBotRestart error:", e?.message || e);
    });
  }, delayMs);

  if (typeof CORE_STATE.BOT_START_TIMEOUT?.unref === "function") {
    CORE_STATE.BOT_START_TIMEOUT.unref();
  }
}

bot.on("polling_error", async (err) => {
  const msg = String(err?.message || err || "");
  console.error("❌ polling_error:", msg);
  CORE_STATE.BOT_POLLING_ACTIVE = false;

  if (msg.includes("409") || msg.toLowerCase().includes("terminated by other getupdates request")) {
    scheduleBotRestart(10000);
    return;
  }

  if (
    msg.toLowerCase().includes("etelegram") ||
    msg.toLowerCase().includes("network") ||
    msg.toLowerCase().includes("timeout") ||
    msg.toLowerCase().includes("socket") ||
    msg.toLowerCase().includes("polling")
  ) {
    scheduleBotRestart(8000);
  }
});

bot.on("webhook_error", (err) => {
  console.error("❌ webhook_error:", err?.message || err);
});

async function hardStopBot() {
  clearScheduledRestart();
  try { await bot.stopPolling(); } catch (_) {}
  try { await bot.deleteWebHook(); } catch (_) {}
  CORE_STATE.BOT_POLLING_ACTIVE = false;
}

async function startBotSafe(force = false) {
  const now = Date.now();

  if (CORE_STATE.BOT_IS_STARTING && !force) return;
  if (CORE_STATE.BOT_POLLING_ACTIVE && !force) return;
  if (!force && now - CORE_STATE.BOT_LAST_START_AT < 7000) return;

  CORE_STATE.BOT_IS_STARTING = true;
  CORE_STATE.BOT_LAST_START_AT = now;

  try {
    clearScheduledRestart();
    await hardStopBot();
    await new Promise((r) => setTimeout(r, 2000));

    await bot.startPolling({
      restart: false,
      interval: 300,
      params: { timeout: 10 },
    });

    CORE_STATE.BOT_POLLING_ACTIVE = true;
    console.log("✅ Bot iniciado correctamente");
  } catch (err) {
    CORE_STATE.BOT_POLLING_ACTIVE = false;
    console.error("❌ Error iniciando bot:", err?.message || err);
    scheduleBotRestart(12000);
  } finally {
    CORE_STATE.BOT_IS_STARTING = false;
  }
}

function startNetflixListenerIfLeader() {
  if (CORE_STATE.NETFLIX_LISTENER_STARTED) return;

  if (process.env.ENABLE_NETFLIX_LISTENER === "true") {
    try {
      require("./netflix_codes_listener");
      CORE_STATE.NETFLIX_LISTENER_STARTED = true;
      console.log("🎬 Netflix listener activo");
    } catch (e) {
      console.error("❌ No se pudo iniciar netflix listener:", e?.message || e);
    }
  } else {
    console.log("⏸️ Netflix listener desactivado por ENV");
  }
}

async function bootCore() {
  try { await hardStopBot(); } catch (_) {}
  startNetflixListenerIfLeader();
  await startBotSafe();
}

const PLATAFORMAS = [
  "netflix",
  "vipnetflix",
  "disneyp",
  "disneys",
  "hbomax",
  "primevideo",
  "paramount",
  "crunchyroll",
  "vix",
  "appletv",
  "universal",
  "spotify",
  "youtube",
  "deezer",
  "oleadatv1",
  "oleadatv3",
  "iptv1",
  "iptv3",
  "iptv4",
  "canva",
  "gemini",
  "chatgpt",
];

const PAGE_SIZE = 10;
const FINANZAS_COLLECTION = "finanzas_movimientos";

const FIN_BANCOS = [
  "Bac",
  "Atlántida",
  "Ficohsa",
  "Davivienda",
  "Banpais",
  "Occidente",
  "Lafise",
  "Tigo Money",
  "Efectivo",
  "PayPal",
  "Binance",
  "Otro",
];

const FIN_MOTIVOS_EGRESO = [
  "Renovaciones",
  "Cuentas nuevas",
  "Publicidad",
  "Comisiones Vendedores",
  "Pago de planilla",
  "Otros",
];

global.FIN_BANCOS = FIN_BANCOS;
global.FIN_MOTIVOS_EGRESO = FIN_MOTIVOS_EGRESO;

function getCoreHealth() {
  return {
    ok: true,
    botPollingActive: CORE_STATE.BOT_POLLING_ACTIVE,
    botIsStarting: CORE_STATE.BOT_IS_STARTING,
    hasRuntimeLock: CORE_STATE.HAS_RUNTIME_LOCK,
    tz: TZ,
    ts: new Date().toISOString(),
  };
}

module.exports = {
  bot,
  admin,
  db,
  ExcelJS,
  BOT_TOKEN,
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  SUPER_ADMIN,
  TZ,
  CORE_STATE,
  PLATAFORMAS,
  PAGE_SIZE,
  FINANZAS_COLLECTION,
  FIN_BANCOS,
  FIN_MOTIVOS_EGRESO,
  releaseRuntimeLock,
  hardStopBot,
  startBotSafe,
  scheduleBotRestart,
  startNetflixListenerIfLeader,
  bootCore,
  getCoreHealth,
};
