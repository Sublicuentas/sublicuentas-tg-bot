/* ✅ SUBLICUENTAS TG BOT — INDEX 01 CORE
   CORE / ENV / FIREBASE / BOT SINGLETON / CONSTANTES / POLLING SAFE
   ------------------------------------------------------------------
   Compatible con partes 2, 3, 4, 5 y 6
   Incluye:
   - Firebase init
   - Telegram bot singleton
   - Fix 409 polling conflict
   - ExcelJS
   - Constantes de plataformas
   - Finanzas
   - Estado global runtime

   ✅ AJUSTE CLAVE:
   - FINANZAS_COLLECTION = "finanzas_movimientos"
   - disneys ajustado a capacidad 3
*/

const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");

// ===============================
// ENV
// ===============================
const BOT_TOKEN = String(process.env.BOT_TOKEN || "").trim();
const FIREBASE_PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || "").trim();
const FIREBASE_CLIENT_EMAIL = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
const FIREBASE_PRIVATE_KEY = String(process.env.FIREBASE_PRIVATE_KEY || "");
const SUPER_ADMIN = String(process.env.SUPER_ADMIN || "").trim();
const TZ = String(process.env.TZ || "America/Tegucigalpa").trim();
const PORT = Number(process.env.PORT || 10000);

// IMAP / LISTENER
const ENABLE_NETFLIX_LISTENER =
  String(process.env.ENABLE_NETFLIX_LISTENER || "false").trim().toLowerCase() === "true";

const IMAP_ACCOUNTS_JSON = String(process.env.IMAP_ACCOUNTS_JSON || "[]").trim();

if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN");
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error("Faltan variables Firebase");
}

// ===============================
// HELPERS
// ===============================
function safeJsonParse(input, fallback = null) {
  try {
    return JSON.parse(input);
  } catch (_) {
    return fallback;
  }
}

function toBool(v, defaultValue = false) {
  if (typeof v === "boolean") return v;
  const s = String(v || "").trim().toLowerCase();
  if (["1", "true", "yes", "si", "sí", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return defaultValue;
}

function normalizeImapAccount(row = {}) {
  return {
    name: String(row.name || row.alias || row.id || "").trim(),
    user: String(row.user || row.email || "").trim(),
    password: String(row.password || row.pass || "").trim(),
    host: String(row.host || "imap.gmail.com").trim(),
    port: Number(row.port || 993),
    tls: toBool(row.tls, true),
    label: String(row.label || "").trim(),
    provider: String(row.provider || "gmail").trim(),
    enabled: toBool(row.enabled, true),
  };
}

// ===============================
// FIREBASE
// ===============================
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

try {
  db.settings({ ignoreUndefinedProperties: true });
} catch (_) {}

// ===============================
// COLECCIONES
// ===============================
const INVENTARIO_COLLECTION = "inventario";
const CLIENTES_COLLECTION = "clientes";
const REVENDEDORES_COLLECTION = "revendedores";
const ADMINS_COLLECTION = "admins";
const CONFIG_COLLECTION = "config";
const FINANZAS_COLLECTION = "finanzas_movimientos";

// ===============================
// FINANZAS
// ===============================
const FIN_BANCOS = [
  "Efectivo",
  "BAC",
  "Ficohsa",
  "Banpaís",
  "Atlántida",
  "Lafise",
  "Occidente",
  "Davivienda",
  "PayPal",
  "Binance",
  "Tigo Money",
  "Transferencia",
  "Otro",
];

const FIN_MOTIVOS_EGRESO = [
  "Compra de cuentas",
  "Pago proveedor",
  "Publicidad",
  "Diseño",
  "Comisión vendedor",
  "Internet",
  "Herramientas",
  "Reposición",
  "Reembolso",
  "Otros",
];

// ===============================
// PLATAFORMAS
// ===============================
const PLATAFORMAS = {
  // VIDEO
  netflix: {
    key: "netflix",
    nombre: "Netflix",
    categoria: "video",
    acceso: "correo_clave_pin",
    capacidadDefault: 5,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: true,
    permiteUsuario: false,
  },

  vipnetflix: {
    key: "vipnetflix",
    nombre: "Vipnetflix",
    categoria: "video",
    acceso: "correo_clave",
    capacidadDefault: 1,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },

  disneyp: {
    key: "disneyp",
    nombre: "Disneyp",
    categoria: "video",
    acceso: "correo_clave_pin",
    capacidadDefault: 6,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: true,
    permiteUsuario: false,
  },

  disneys: {
    key: "disneys",
    nombre: "Disneys",
    categoria: "video",
    acceso: "correo_clave_pin",
    capacidadDefault: 3,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: true,
    permiteUsuario: false,
  },

  hbomax: {
    key: "hbomax",
    nombre: "Hbomax",
    categoria: "video",
    acceso: "correo_clave_pin",
    capacidadDefault: 5,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: true,
    permiteUsuario: false,
  },

  primevideo: {
    key: "primevideo",
    nombre: "Prime video",
    categoria: "video",
    acceso: "correo_clave_pin",
    capacidadDefault: 5,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: true,
    permiteUsuario: false,
  },

  paramount: {
    key: "paramount",
    nombre: "Paramount+",
    categoria: "video",
    acceso: "correo_clave_pin",
    capacidadDefault: 5,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: true,
    permiteUsuario: false,
  },

  crunchyroll: {
    key: "crunchyroll",
    nombre: "Crunchyroll",
    categoria: "video",
    acceso: "correo_clave_pin",
    capacidadDefault: 5,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: true,
    permiteUsuario: false,
  },

  vix: {
    key: "vix",
    nombre: "Vix correo y clave",
    categoria: "video",
    acceso: "correo_clave",
    capacidadDefault: 4,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },

  appletv: {
    key: "appletv",
    nombre: "Appletv correo y clave",
    categoria: "video",
    acceso: "correo_clave",
    capacidadDefault: 4,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },

  universal: {
    key: "universal",
    nombre: "Universal correo y clave",
    categoria: "video",
    acceso: "correo_clave",
    capacidadDefault: 4,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },

  // MUSICA
  spotify: {
    key: "spotify",
    nombre: "Spotify correo y clave",
    categoria: "musica",
    acceso: "correo_clave",
    capacidadDefault: 1,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },

  youtube: {
    key: "youtube",
    nombre: "Youtube correo y clave",
    categoria: "musica",
    acceso: "correo_clave",
    capacidadDefault: 1,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },

  deezer: {
    key: "deezer",
    nombre: "Deezer correo y clave",
    categoria: "musica",
    acceso: "correo_clave",
    capacidadDefault: 1,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },

  // IPTV
  oleadatv1: {
    key: "oleadatv1",
    nombre: "Oleada 1",
    categoria: "iptv",
    acceso: "usuario_clave",
    capacidadDefault: 1,
    requiereCorreo: false,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: true,
  },

  oleadatv3: {
    key: "oleadatv3",
    nombre: "Oleada 3",
    categoria: "iptv",
    acceso: "usuario_clave",
    capacidadDefault: 3,
    requiereCorreo: false,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: true,
  },

  iptv1: {
    key: "iptv1",
    nombre: "Iptv 1",
    categoria: "iptv",
    acceso: "usuario_clave",
    capacidadDefault: 1,
    requiereCorreo: false,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: true,
  },

  iptv3: {
    key: "iptv3",
    nombre: "Iptv 3",
    categoria: "iptv",
    acceso: "usuario_clave",
    capacidadDefault: 3,
    requiereCorreo: false,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: true,
  },

  iptv4: {
    key: "iptv4",
    nombre: "Iptv 4",
    categoria: "iptv",
    acceso: "usuario_clave",
    capacidadDefault: 4,
    requiereCorreo: false,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: true,
  },

  // DISEÑO E IA
  canva: {
    key: "canva",
    nombre: "Canva",
    categoria: "diseno_ia",
    acceso: "solo_correo",
    capacidadDefault: 1,
    requiereCorreo: true,
    requiereClave: false,
    requierePin: false,
    permiteUsuario: false,
  },

  gemini: {
    key: "gemini",
    nombre: "Gemini",
    categoria: "diseno_ia",
    acceso: "correo_clave",
    capacidadDefault: 1,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },

  chatgpt: {
    key: "chatgpt",
    nombre: "Chatgpt",
    categoria: "diseno_ia",
    acceso: "correo_clave",
    capacidadDefault: 1,
    requiereCorreo: true,
    requiereClave: true,
    requierePin: false,
    permiteUsuario: false,
  },
};

const DEFAULT_TOTALS = Object.fromEntries(
  Object.entries(PLATAFORMAS).map(([k, v]) => [k, Number(v.capacidadDefault || 1)])
);

// ===============================
// IMAP ACCOUNTS
// ===============================
const EMAIL_ACCOUNTS = Array.isArray(safeJsonParse(IMAP_ACCOUNTS_JSON, []))
  ? safeJsonParse(IMAP_ACCOUNTS_JSON, []).map(normalizeImapAccount).filter((x) => x.enabled && (x.user || x.name))
  : [];

// ===============================
// BOT SINGLETON
// ===============================
if (!global.__SUBLICUENTAS_BOT__) {
  global.__SUBLICUENTAS_BOT__ = new TelegramBot(BOT_TOKEN, {
    polling: false,
  });
}

const bot = global.__SUBLICUENTAS_BOT__;

// ===============================
// CORE STATE GLOBAL
// ===============================
if (!global.__SUBLICUENTAS_CORE_STATE__) {
  global.__SUBLICUENTAS_CORE_STATE__ = {
    runtimeLock: true,
    isBooting: false,
    isPolling: false,
    bootCount: 0,
    lastPollingErrorAt: 0,
    lastPollingError: null,
    startedAt: Date.now(),
  };
}

const CORE_STATE = global.__SUBLICUENTAS_CORE_STATE__;

// ===============================
// PROCESS HOOKS SOLO 1 VEZ
// ===============================
if (!global.__SUBLICUENTAS_PROCESS_HOOKS__) {
  global.__SUBLICUENTAS_PROCESS_HOOKS__ = true;

  process.on("unhandledRejection", (err) => {
    console.error("❌ UNHANDLED_REJECTION:", err?.stack || err);
  });

  process.on("uncaughtException", (err) => {
    console.error("❌ UNCAUGHT_EXCEPTION:", err?.stack || err);
  });

  process.on("SIGINT", async () => {
    try {
      await stopBotPollingSafe();
    } catch (_) {}
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    try {
      await stopBotPollingSafe();
    } catch (_) {}
    process.exit(0);
  });
}

// ===============================
// RUNTIME HELPERS
// ===============================
function hardStopBot() {
  CORE_STATE.runtimeLock = false;
}

function releaseRuntimeLock() {
  CORE_STATE.runtimeLock = true;
}

function getCoreHealth() {
  return {
    ok: true,
    runtimeLock: CORE_STATE.runtimeLock,
    isBooting: CORE_STATE.isBooting,
    isPolling: CORE_STATE.isPolling,
    bootCount: CORE_STATE.bootCount,
    lastPollingErrorAt: CORE_STATE.lastPollingErrorAt,
    lastPollingError: CORE_STATE.lastPollingError,
    startedAt: CORE_STATE.startedAt,
    uptimeSec: Math.floor((Date.now() - CORE_STATE.startedAt) / 1000),
    firebaseProject: FIREBASE_PROJECT_ID,
    tz: TZ,
    imapAccounts: EMAIL_ACCOUNTS.length,
    netflixListener: ENABLE_NETFLIX_LISTENER,
  };
}

// ===============================
// POLLING SAFE
// ===============================
async function stopBotPollingSafe() {
  try {
    await bot.stopPolling();
  } catch (_) {}
  CORE_STATE.isPolling = false;
}

async function startBotPollingSafe() {
  if (CORE_STATE.isBooting) return;
  CORE_STATE.isBooting = true;
  CORE_STATE.bootCount += 1;

  try {
    await bot.deleteWebHook({ drop_pending_updates: false }).catch(() => {});
    await stopBotPollingSafe();

    await bot.startPolling({
      restart: true,
      params: {
        timeout: 10,
      },
    });

    CORE_STATE.isPolling = true;
    console.log("✅ Bot iniciado correctamente");
  } catch (err) {
    CORE_STATE.isPolling = false;
    CORE_STATE.lastPollingErrorAt = Date.now();
    CORE_STATE.lastPollingError = String(err?.message || err || "");
    console.error("❌ Error iniciando polling:", err?.stack || err);
  } finally {
    CORE_STATE.isBooting = false;
  }
}

// ===============================
// BOT EVENTS SOLO 1 VEZ
// ===============================
if (!global.__SUBLICUENTAS_BOT_EVENTS__) {
  global.__SUBLICUENTAS_BOT_EVENTS__ = true;

  bot.on("polling_error", async (err) => {
    const msg = String(err?.message || err || "");
    CORE_STATE.lastPollingErrorAt = Date.now();
    CORE_STATE.lastPollingError = msg;
    CORE_STATE.isPolling = false;

    console.error("❌ polling_error:", err?.stack || err);

    if (msg.includes("409")) {
      console.error("⚠️ Detectado 409 Conflict. Se intentará reinicio limpio del polling...");
      try {
        await stopBotPollingSafe();
      } catch (_) {}

      setTimeout(async () => {
        try {
          await startBotPollingSafe();
        } catch (e) {
          console.error("❌ Error reintentando polling:", e?.stack || e);
        }
      }, 3000);
    }
  });

  bot.on("webhook_error", (err) => {
    console.error("❌ webhook_error:", err?.stack || err);
  });

  bot.on("error", (err) => {
    console.error("❌ bot_error:", err?.stack || err);
  });
}

// ===============================
// LOGS DE ARRANQUE
// ===============================
console.log("✅ ExcelJS cargado");
console.log(`✅ FIREBASE PROJECT: ${FIREBASE_PROJECT_ID}`);
console.log(`🌐 HTTP KEEPALIVE activo en puerto ${PORT}`);
console.log(`📩 Cuentas IMAP cargadas: ${EMAIL_ACCOUNTS.length}`);

if (ENABLE_NETFLIX_LISTENER) {
  console.log("🚀 Netflix Codes Listener iniciado...");
} else {
  console.log("ℹ️ Netflix listener desactivado");
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  // core libs
  bot,
  admin,
  db,
  ExcelJS,

  // env
  TZ,
  PORT,
  SUPER_ADMIN,
  ENABLE_NETFLIX_LISTENER,

  // constants
  INVENTARIO_COLLECTION,
  CLIENTES_COLLECTION,
  REVENDEDORES_COLLECTION,
  ADMINS_COLLECTION,
  CONFIG_COLLECTION,
  FINANZAS_COLLECTION,
  FIN_BANCOS,
  FIN_MOTIVOS_EGRESO,
  PLATAFORMAS,
  DEFAULT_TOTALS,
  EMAIL_ACCOUNTS,

  // runtime
  CORE_STATE,
  hardStopBot,
  releaseRuntimeLock,
  getCoreHealth,
  startBotPollingSafe,
  stopBotPollingSafe,

  // utils
  safeJsonParse,
  normalizeImapAccount,
};
