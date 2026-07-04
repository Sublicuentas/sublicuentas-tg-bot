/* ✅ SUBLICUENTAS TG BOT — INDEX 01 CORE v2
   CORE / ENV / FIREBASE / BOT SINGLETON / CONSTANTES / POLLING SAFE / CACHÉ
   --------------------------------------------------------------------------
   ✅ OPTIMIZACIONES v2:
   - Sistema de caché en memoria para admins, revendedores y config
   - TTL configurable por tipo de dato
   - Helpers de caché exportados para uso en otras partes
   - Sin cambios en polling ni Firebase init
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
  try { return JSON.parse(input); } catch (_) { return fallback; }
}

function toBool(v, defaultValue = false) {
  if (typeof v === "boolean") return v;
  const s = String(v || "").trim().toLowerCase();
  if (["1", "true", "yes", "si", "sí", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return defaultValue;
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Number(ms || 0)));
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
try { db.settings({ ignoreUndefinedProperties: true }); } catch (_) {}

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
  "Efectivo", "BAC", "Ficohsa", "Banpaís", "Atlántida", "Lafise",
  "Occidente", "Davivienda", "PayPal", "Binance", "Tigo Money",
  "Transferencia", "Otro",
];

const FIN_MOTIVOS_EGRESO = [
  "Compra de cuentas", "Pago proveedor", "Publicidad", "Diseño",
  "Comisión vendedor", "Internet", "Herramientas", "Reposición",
  "Reembolso", "Otros",
];

// ===============================
// PLATAFORMAS
// ===============================
const PLATAFORMAS = {
  netflix:     { key: "netflix",     nombre: "Netflix Premium", categoria: "video",     acceso: "correo_clave_pin", capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  vipnetflix:  { key: "vipnetflix",  nombre: "Netflix VIP",     categoria: "video",     acceso: "correo_clave_pin", capacidadDefault: 1,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  disneyp:     { key: "disneyp",     nombre: "Disney Premium",  categoria: "video",     acceso: "correo_clave_pin", capacidadDefault: 6,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  disneys:     { key: "disneys",     nombre: "Disney Standard", categoria: "video",     acceso: "correo_clave_pin", capacidadDefault: 3,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  hbomax:      { key: "hbomax",      nombre: "HBO Max",         categoria: "video",     acceso: "correo_clave_pin", capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  primevideo:  { key: "primevideo",  nombre: "Prime Video",     categoria: "video",     acceso: "correo_clave_pin", capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  paramount:   { key: "paramount",   nombre: "Paramount+",      categoria: "video",     acceso: "correo_clave",     capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  crunchyroll: { key: "crunchyroll", nombre: "Crunchyroll",     categoria: "video",     acceso: "correo_clave_pin", capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  vix:         { key: "vix",         nombre: "Vix",             categoria: "video",     acceso: "correo_clave",     capacidadDefault: 4,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  appletv:     { key: "appletv",     nombre: "Apple TV",        categoria: "video",     acceso: "correo_clave",     capacidadDefault: 4,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  universal:   { key: "universal",   nombre: "Universal+",      categoria: "video",     acceso: "correo_clave_pin", capacidadDefault: 4,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  spotify:     { key: "spotify",     nombre: "Spotify",         categoria: "musica",    acceso: "correo_clave",     capacidadDefault: 1,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  youtube:     { key: "youtube",     nombre: "YouTube",         categoria: "musica",    acceso: "correo_clave",     capacidadDefault: 1,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  deezer:      { key: "deezer",      nombre: "Deezer",          categoria: "musica",    acceso: "correo_clave",     capacidadDefault: 1,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  oleadatv1:   { key: "oleadatv1",   nombre: "Oleada 1",        categoria: "iptv",      acceso: "usuario_clave",    capacidadDefault: 1,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  oleadatv3:   { key: "oleadatv3",   nombre: "Oleada 3",        categoria: "iptv",      acceso: "usuario_clave",    capacidadDefault: 3,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  iptv1:       { key: "iptv1",       nombre: "IPTV 1",          categoria: "iptv",      acceso: "usuario_clave",    capacidadDefault: 1,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  iptv3:       { key: "iptv3",       nombre: "IPTV 3",          categoria: "iptv",      acceso: "usuario_clave",    capacidadDefault: 3,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  iptv4:       { key: "iptv4",       nombre: "IPTV 4",          categoria: "iptv",      acceso: "usuario_clave",    capacidadDefault: 4,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  canva:       { key: "canva",       nombre: "Canva",           categoria: "diseno_ia", acceso: "solo_correo",      capacidadDefault: 1,  requiereCorreo: true,  requiereClave: false, requierePin: false, permiteUsuario: false },
  gemini:      { key: "gemini",      nombre: "Gemini",          categoria: "diseno_ia", acceso: "solo_correo",      capacidadDefault: 1,  requiereCorreo: true,  requiereClave: false, requierePin: false, permiteUsuario: false },
  chatgpt:     { key: "chatgpt",     nombre: "ChatGPT",         categoria: "diseno_ia", acceso: "solo_correo",      capacidadDefault: 1,  requiereCorreo: true,  requiereClave: false, requierePin: false, permiteUsuario: false },
  duolingo:    { key: "duolingo",    nombre: "Duolingo",        categoria: "diseno_ia", acceso: "solo_correo",      capacidadDefault: 1,  requiereCorreo: true,  requiereClave: false, requierePin: false, permiteUsuario: false },
};

const DEFAULT_TOTALS = Object.fromEntries(
  Object.entries(PLATAFORMAS).map(([k, v]) => [k, Number(v.capacidadDefault || 1)])
);

// ===============================
// IMAP ACCOUNTS
// ===============================
const EMAIL_ACCOUNTS = Array.isArray(safeJsonParse(IMAP_ACCOUNTS_JSON, []))
  ? safeJsonParse(IMAP_ACCOUNTS_JSON, [])
      .map(normalizeImapAccount)
      .filter((x) => x.enabled && (x.user || x.name))
  : [];

// ===============================
// BOT SINGLETON
// ===============================
if (!global.__SUBLICUENTAS_BOT__) {
  global.__SUBLICUENTAS_BOT__ = new TelegramBot(BOT_TOKEN, { polling: false });
}

const bot = global.__SUBLICUENTAS_BOT__;
const INSTANCE_ID =
  global.__SUBLICUENTAS_INSTANCE_ID__ ||
  `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
global.__SUBLICUENTAS_INSTANCE_ID__ = INSTANCE_ID;

// ===============================
// CORE STATE GLOBAL
// ===============================
if (!global.__SUBLICUENTAS_CORE_STATE__) {
  global.__SUBLICUENTAS_CORE_STATE__ = {
    runtimeLock: true,
    isBooting: false,
    isPolling: false,
    isStopping: false,
    isRestarting409: false,
    bootCount: 0,
    conflict409Count: 0,
    lastConflictAt: 0,
    lastPollingErrorAt: 0,
    lastPollingError: null,
    lastStartAt: 0,
    startedAt: Date.now(),
  };
}

const CORE_STATE = global.__SUBLICUENTAS_CORE_STATE__;

// ===============================
// ✅ CACHÉ EN MEMORIA
// TTL en milisegundos por tipo de dato:
//   - admins / revendedores: 90 segundos (cambian poco)
//   - clientes resumen: 120 segundos (800+ docs, costoso leer)
//   - config / dailyRun: 60 segundos
// ===============================
if (!global.__SUBLICUENTAS_CACHE__) {
  global.__SUBLICUENTAS_CACHE__ = new Map();
}

const CACHE = global.__SUBLICUENTAS_CACHE__;

// TTL por prefijo de clave
const CACHE_TTL = {
  admins:       600 * 1000,  // 10 minutos — cambian muy poco
  revendedores: 600 * 1000,  // 10 minutos — cambian muy poco
  clientes:     300 * 1000,  // 5 minutos
  inventario:   120 * 1000,  // 2 minutos
  config:       120 * 1000,  // 2 minutos
  default:      120 * 1000,  // 2 minutos
};

function getCacheTTL(key = "") {
  const prefix = String(key || "").split(":")[0];
  return CACHE_TTL[prefix] || CACHE_TTL.default;
}

/**
 * Lee del caché. Devuelve null si no existe o expiró.
 */
function cacheGet(key = "") {
  const entry = CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(String(key));
    return null;
  }
  return entry.value;
}

/**
 * Escribe en el caché con TTL automático por prefijo.
 */
function cacheSet(key = "", value, ttlMs = null) {
  const ttl = ttlMs != null ? Number(ttlMs) : getCacheTTL(key);
  CACHE.set(String(key), {
    value,
    expiresAt: Date.now() + ttl,
    setAt: Date.now(),
  });
}

/**
 * Invalida todas las entradas cuya clave empiece con prefix.
 */
function cacheInvalidatePrefix(prefix = "") {
  const p = String(prefix);
  for (const key of CACHE.keys()) {
    if (key.startsWith(p)) CACHE.delete(key);
  }
}

/**
 * Invalida una clave exacta.
 */
function cacheDelete(key = "") {
  CACHE.delete(String(key));
}

/**
 * Limpia todas las entradas expiradas (llamar periódicamente).
 */
function cachePurgeExpired() {
  const now = Date.now();
  for (const [key, entry] of CACHE.entries()) {
    if (now > entry.expiresAt) CACHE.delete(key);
  }
}

// Limpieza automática cada 5 minutos
if (!global.__SUBLICUENTAS_CACHE_PURGE__) {
  global.__SUBLICUENTAS_CACHE_PURGE__ = true;
  setInterval(cachePurgeExpired, 5 * 60 * 1000);
}

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
    try { await stopBotPollingSafe("SIGINT"); } catch (_) {}
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    try { await stopBotPollingSafe("SIGTERM"); } catch (_) {}
    process.exit(0);
  });
}

// ===============================
// RUNTIME HELPERS
// ===============================
function hardStopBot() { CORE_STATE.runtimeLock = false; }
function releaseRuntimeLock() { CORE_STATE.runtimeLock = true; }

function getCoreHealth() {
  return {
    ok: true,
    instanceId: INSTANCE_ID,
    runtimeLock: CORE_STATE.runtimeLock,
    isBooting: CORE_STATE.isBooting,
    isPolling: CORE_STATE.isPolling,
    isStopping: CORE_STATE.isStopping,
    isRestarting409: CORE_STATE.isRestarting409,
    bootCount: CORE_STATE.bootCount,
    conflict409Count: CORE_STATE.conflict409Count,
    lastConflictAt: CORE_STATE.lastConflictAt,
    lastPollingErrorAt: CORE_STATE.lastPollingErrorAt,
    lastPollingError: CORE_STATE.lastPollingError,
    lastStartAt: CORE_STATE.lastStartAt,
    startedAt: CORE_STATE.startedAt,
    uptimeSec: Math.floor((Date.now() - CORE_STATE.startedAt) / 1000),
    firebaseProject: FIREBASE_PROJECT_ID,
    tz: TZ,
    imapAccounts: EMAIL_ACCOUNTS.length,
    netflixListener: ENABLE_NETFLIX_LISTENER,
    cacheEntries: CACHE.size,
  };
}

// ===============================
// POLLING SAFE
// ===============================
async function stopBotPollingSafe(reason = "manual") {
  if (CORE_STATE.isStopping) return;
  CORE_STATE.isStopping = true;
  try {
    try { await bot.stopPolling(); } catch (_) {}
  } finally {
    CORE_STATE.isPolling = false;
    CORE_STATE.isStopping = false;
    console.log(`🛑 Polling detenido (${reason}) [${INSTANCE_ID}]`);
  }
}

async function startBotPollingSafe(reason = "manual") {
  if (!CORE_STATE.runtimeLock) {
    console.log(`⛔ runtimeLock=false, no se inicia polling (${reason}) [${INSTANCE_ID}]`);
    return;
  }

  if (global.__SUBLICUENTAS_POLLING_START_PROMISE__) {
    return global.__SUBLICUENTAS_POLLING_START_PROMISE__;
  }

  global.__SUBLICUENTAS_POLLING_START_PROMISE__ = (async () => {
    if (CORE_STATE.isBooting) return;
    CORE_STATE.isBooting = true;
    CORE_STATE.bootCount += 1;

    try {
      await stopBotPollingSafe(`pre-start:${reason}`);
      try { await bot.deleteWebHook({ drop_pending_updates: true }); } catch (_) {}
      await sleep(1200);
      await bot.startPolling({ restart: false, params: { timeout: 30, allowed_updates: ["message","callback_query"] } });
      CORE_STATE.isPolling = true;
      CORE_STATE.lastStartAt = Date.now();
      CORE_STATE.lastPollingError = null;
      console.log(`✅ Bot iniciado correctamente (${reason}) [${INSTANCE_ID}]`);
    } catch (err) {
      CORE_STATE.isPolling = false;
      CORE_STATE.lastPollingErrorAt = Date.now();
      CORE_STATE.lastPollingError = String(err?.message || err || "");
      console.error(`❌ Error iniciando polling (${reason}) [${INSTANCE_ID}]:`, err?.stack || err);
    } finally {
      CORE_STATE.isBooting = false;
      global.__SUBLICUENTAS_POLLING_START_PROMISE__ = null;
    }
  })();

  return global.__SUBLICUENTAS_POLLING_START_PROMISE__;
}

async function restartBotPollingSafe(reason = "manual", waitMs = 4000) {
  if (CORE_STATE.isRestarting409) return;
  CORE_STATE.isRestarting409 = true;
  try {
    await stopBotPollingSafe(`restart:${reason}`);
    await sleep(waitMs);
    await startBotPollingSafe(`restart:${reason}`);
  } finally {
    CORE_STATE.isRestarting409 = false;
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
    console.error(`❌ polling_error [${INSTANCE_ID}]:`, err?.stack || err);

    if (msg.includes("409")) {
      const now = Date.now();
      const elapsed = now - Number(CORE_STATE.lastConflictAt || 0);
      if (elapsed > 60000) CORE_STATE.conflict409Count = 0;
      CORE_STATE.lastConflictAt = now;
      CORE_STATE.conflict409Count += 1;
      const waitMs = CORE_STATE.conflict409Count >= 3 ? 30000 : 15000;
      console.error(`⚠️ Detectado 409 Conflict. Intento ${CORE_STATE.conflict409Count}. Reintento en ${waitMs}ms [${INSTANCE_ID}]`);
      try { await restartBotPollingSafe("409-conflict", waitMs); } catch (e) {
        console.error(`❌ Error reintentando polling [${INSTANCE_ID}]:`, e?.stack || e);
      }
    }
  });

  bot.on("webhook_error", (err) => { console.error(`❌ webhook_error [${INSTANCE_ID}]:`, err?.stack || err); });
  bot.on("error", (err) => { console.error(`❌ bot_error [${INSTANCE_ID}]:`, err?.stack || err); });
}

// ===============================
// LOGS DE ARRANQUE
// ===============================
console.log("✅ ExcelJS cargado");
console.log(`✅ FIREBASE PROJECT: ${FIREBASE_PROJECT_ID}`);
console.log(`🌐 HTTP KEEPALIVE activo en puerto ${PORT}`);
console.log(`📩 Cuentas IMAP cargadas: ${EMAIL_ACCOUNTS.length}`);
console.log(`🧠 CORE INSTANCE: ${INSTANCE_ID}`);
console.log(`🗄️ Caché en memoria activo (admins:90s, revendedores:90s, clientes:120s)`);

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
  bot, admin, db, ExcelJS,

  // env
  TZ, PORT, SUPER_ADMIN, ENABLE_NETFLIX_LISTENER,

  // constants
  INVENTARIO_COLLECTION, CLIENTES_COLLECTION, REVENDEDORES_COLLECTION,
  ADMINS_COLLECTION, CONFIG_COLLECTION, FINANZAS_COLLECTION,
  FIN_BANCOS, FIN_MOTIVOS_EGRESO, PLATAFORMAS, DEFAULT_TOTALS, EMAIL_ACCOUNTS,

  // runtime
  CORE_STATE, hardStopBot, releaseRuntimeLock, getCoreHealth,
  startBotPollingSafe, stopBotPollingSafe, restartBotPollingSafe,

  // ✅ caché
  cacheGet, cacheSet, cacheDelete, cacheInvalidatePrefix, cachePurgeExpired,

  // utils
  safeJsonParse, normalizeImapAccount, sleep,
};
