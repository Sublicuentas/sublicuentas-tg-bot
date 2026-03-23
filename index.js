/* ✅ SUBLICUENTAS TG BOT — PARTE 1/6
   CORE / ARRANQUE / FIREBASE / POLLING / CONSTANTES
   -------------------------------------------------
   Este archivo contiene:
   - require principales
   - ENV
   - Firebase
   - bot base
   - restart seguro polling
   - listener Netflix
   - arranque inicial
   - constantes globales
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

// ===============================
// ENV
// ===============================
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
console.log("✅ FIREBASE PROJECT:", FIREBASE_PROJECT_ID);

// ===============================
// ESTADO CORE
// ===============================
const CORE_STATE = {
  HAS_RUNTIME_LOCK: true,
  BOT_IS_STARTING: false,
  BOT_POLLING_ACTIVE: false,
  BOT_LAST_START_AT: 0,
  BOT_START_TIMEOUT: null,
  NETFLIX_LISTENER_STARTED: false,
};

// ===============================
// COMPATIBILIDAD
// ===============================
async function releaseRuntimeLock() {
  return true;
}

// ===============================
// BOT BASE
// ===============================
const bot = new TelegramBot(BOT_TOKEN, {
  polling: false,
});

bot.on("polling_error", async (err) => {
  const msg = String(err?.message || err || "");
  console.error("❌ polling_error:", msg);

  CORE_STATE.BOT_POLLING_ACTIVE = false;

  if (
    msg.includes("409") ||
    msg.toLowerCase().includes("terminated by other getupdates request")
  ) {
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

// ===============================
// HARD STOP / RESTART
// ===============================
async function hardStopBot() {
  try {
    await bot.stopPolling();
  } catch (_) {}

  try {
    await bot.deleteWebHook();
  } catch (_) {}

  CORE_STATE.BOT_POLLING_ACTIVE = false;
}

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
}

async function startBotSafe(force = false) {
  const now = Date.now();

  if (CORE_STATE.BOT_IS_STARTING && !force) {
    console.log("ℹ️ Bot ya está iniciando, se evita start duplicado");
    return;
  }

  if (CORE_STATE.BOT_POLLING_ACTIVE && !force) {
    console.log("ℹ️ Bot ya activo");
    return;
  }

  if (!force && now - CORE_STATE.BOT_LAST_START_AT < 7000) {
    console.log("ℹ️ Ventana anti-restart activa");
    return;
  }

  CORE_STATE.BOT_IS_STARTING = true;
  CORE_STATE.BOT_LAST_START_AT = now;

  try {
    console.log("🔄 Arrancando bot limpio...");

    clearScheduledRestart();

    await hardStopBot();
    await new Promise((r) => setTimeout(r, 2500));

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

// ===============================
// LISTENER NETFLIX
// ===============================
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

// ===============================
// ARRANQUE INICIAL
// ===============================
async function bootCore() {
  try {
    await hardStopBot();
  } catch (_) {}

  startNetflixListenerIfLeader();

  setTimeout(() => {
    startBotSafe().catch((e) => {
      console.error("❌ Error en arranque inicial:", e?.message || e);
    });
  }, 6000);
}

bootCore().catch((e) => {
  console.error("❌ bootCore error:", e?.message || e);
});

// ===============================
// CONSTANTES
// ===============================
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
  "youtube",
  "spotify",
  "canva",
  "oleadatv1",
  "oleadatv3",
  "iptv1",
  "iptv3",
  "iptv4",
];

const PAGE_SIZE = 10;

// ===============================
// FINANZAS CONFIG GLOBAL
// ===============================
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

// Se mantiene por compatibilidad con el código actual
global.FIN_BANCOS = FIN_BANCOS;
global.FIN_MOTIVOS_EGRESO = FIN_MOTIVOS_EGRESO;

// ===============================
// HEALTH CORE
// ===============================
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

// ===============================
// EXPORTS
// ===============================
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
const {
  bot,
  admin,
  db,
  TZ,
  SUPER_ADMIN,
  PLATAFORMAS,
} = require("./index_01_core");

// ===============================
// HELPERS GENERALES
// ===============================
function stripAcentos(str = "") {
  return String(str).normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function normTxt(str = "") {
  return stripAcentos(String(str || ""))
    .toLowerCase()
    .trim()
    .replace(/s+/g, " ");
}
function onlyDigits(str = "") {
  return String(str || "").replace(/D/g, "");
}
function normalizarPlataforma(txt = "") {
  return String(txt || "")
    .toLowerCase()
    .trim()
    .replace(/s+/g, "")
    .replace(/[.-_/]+/g, "");
}
function esPlataformaValida(p = "") {
  return PLATAFORMAS.includes(normalizarPlataforma(p));
}
function safeMail(correo = "") {
  return String(correo || "")
    .trim()
    .toLowerCase()
    .replace(/[/#?&s]+/g, "_");
}
function docIdInventario(correo, plataforma) {
  return `${normalizarPlataforma(plataforma)}__${safeMail(correo)}`;
}
function fmtEstado(estado = "") {
  const e = String(estado || "").toLowerCase();
  if (e === "bloqueada" || e === "llena") return "LLENA";
  return "ACTIVA";
}
function isFechaDMY(s = "") {
  return /^d{2}/d{2}/d{4}$/.test(String(s || "").trim());
}
function hoyDMY() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("es-HN", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const obj = {};
  fmt.forEach((p) => {
    if (p.type !== "literal") obj[p.type] = p.value;
  });
  return `${obj.day}/${obj.month}/${obj.year}`;
}
function esTelefono(txt = "") {
  const t = onlyDigits(String(txt || "").trim());
  return /^[0-9]{7,15}$/.test(t);
}
function limpiarQuery(txt = "") {
  return String(txt || "")
    .trim()
    .replace(/^/+/, "")
    .replace(/s+/g, " ")
    .toLowerCase();
}
function isEmailLike(s = "") {
  const x = String(s || "").trim().toLowerCase();
  return /^[^s@]+@[^s@]+.[^s@]+$/.test(x);
}
function parseDMYtoTS(dmy = "") {
  const s = String(dmy || "").trim();
  const m = s.match(/^(d{2})/(d{2})/(d{4})$/);
  if (!m) return Number.POSITIVE_INFINITY;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}
function addDaysDMY(dmy, days) {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = String(dmy).split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd);
  dt.setDate(dt.getDate() + Number(days || 0));
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}
function escMD(text = "") {
  return String(text || "").replace(/([_*[]()~`>#+-=|{}!\\])/g, "\\$1");
}
async function enviarTxtComoArchivo(chatId, contenido, filename = "reporte.txt") {
  const limpio = stripAcentos(String(contenido || "")).replace(/[^-]/g, "");
  const buffer = Buffer.from(limpio, "utf8");
  return bot.sendDocument(chatId, buffer, {}, { filename, contentType: "text/plain" });
}
function logInfo(...args) {
  console.log("ℹ️", ...args);
}
function logErr(...args) {
  console.log("❌", ...args);
}
function safeBtnLabel(txt = "", max = 56) {
  const s = String(txt || "").replace(/s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

// ===============================
// HELPERS FECHA / MES / DINERO
// ===============================
function isMonthInputMMYYYY(txt = "") {
  return /^(0[1-9]|1[0-2])/d{4}$/.test(String(txt || "").trim());
}
function getMonthKeyFromDMY(dmy = "") {
  if (!isFechaDMY(dmy)) return "";
  const [, mm, yyyy] = String(dmy).split("/").map(Number);
  return `${yyyy}-${String(mm).padStart(2, "0")}`;
}
function parseMonthInputToKey(txt = "") {
  const s = String(txt || "").trim();
  if (!isMonthInputMMYYYY(s)) return null;
  const [mm, yyyy] = s.split("/");
  return `${yyyy}-${mm}`;
}
function getMonthLabelFromKey(monthKey = "") {
  const m = String(monthKey || "").match(/^(d{4})-(d{2})$/);
  if (!m) return monthKey || "-";
  return `${m[2]}/${m[1]}`;
}
function startOfDayTS(dmy = "") {
  return parseDMYtoTS(dmy);
}
function endOfDayTS(dmy = "") {
  const ts = parseDMYtoTS(dmy);
  if (!Number.isFinite(ts)) return ts;
  return ts + 86399999;
}
function ymdFromDMY(dmy = "") {
  if (!isFechaDMY(dmy)) return "";
  const [dd, mm, yyyy] = String(dmy).split("/");
  return `${yyyy}-${mm}-${dd}`;
}
function parseFechaFinanceInput(txt = "") {
  const s = String(txt || "").trim().toLowerCase();
  if (s === "hoy") {
    const fecha = hoyDMY();
    return {
      ok: true,
      fecha,
      fechaTS: parseDMYtoTS(fecha),
      mesKey: getMonthKeyFromDMY(fecha),
    };
  }
  if (!isFechaDMY(s)) return { ok: false };
  return {
    ok: true,
    fecha: s,
    fechaTS: parseDMYtoTS(s),
    mesKey: getMonthKeyFromDMY(s),
  };
}
function parseMontoNumber(v) {
  const raw = String(v || "").trim().replace(/[^d.,-]/g, "");
  if (!raw) return NaN;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;
  if (hasComma && hasDot) {
    if (raw.lastIndexOf(".") > raw.lastIndexOf(",")) {
      normalized = raw.replace(/,/g, "");
    } else {
      normalized = raw.replace(/./g, "").replace(",", ".");
    }
  } else if (hasComma && !hasDot) {
    const parts = raw.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = raw.replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}
function moneyLps(v) {
  const n = Number(v || 0);
  return `${n.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Lps`;
}
function moneyNumber(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Number(n);
}

// ===============================
// RATE LIMIT
// ===============================
const rate = new Map();
function allowMsg(chatId, userId, limit = 10, windowMs = 5000) {
  const k = `${chatId}:${userId}`;
  const now = Date.now();
  const cur = rate.get(k) || { t: now, count: 0 };
  if (now - cur.t > windowMs) {
    cur.t = now;
    cur.count = 0;
  }
  cur.count++;
  rate.set(k, cur);
  return cur.count <= limit;
}

// ===============================
// HELPERS REVENDEDORES
// ===============================
function getSafeRevNombre(r = {}, fallbackId = "") {
  return String(r.nombre || r.Nombre || fallbackId || "").trim();
}
function getSafeRevActivo(r = {}) {
  return r.activo === true || r.Activo === true;
}
function getSafeRevTelegramId(r = {}) {
  return String(r.telegramId ?? r.TelegramId ?? "").trim();
}
function normalizeRevendedorDoc(doc) {
  const data = doc.data() || {};
  const nombre = getSafeRevNombre(data, doc.id);
  const activo = getSafeRevActivo(data);
  const telegramId = getSafeRevTelegramId(data);
  return {
    id: doc.id,
    ...data,
    nombre,
    activo,
    telegramId,
    nombre_norm: normTxt(nombre),
  };
}

// ===============================
// CONFIG TOTALES
// ===============================
async function getTotalPorPlataforma(plataforma) {
  const cfg = await db.collection("config").doc("totales_plataforma").get();
  const p = normalizarPlataforma(plataforma);
  if (!cfg.exists) return null;
  return cfg.data()?.[p] ?? null;
}
async function asegurarTotalesDefault() {
  const ref = db.collection("config").doc("totales_plataforma");
  const doc = await ref.get();
  const defaults = {
    netflix: 5,
    vipnetflix: 1,
    disneyp: 6,
    disneys: 3,
    hbomax: 5,
    primevideo: 5,
    paramount: 5,
    crunchyroll: 5,
    vix: 4,
    appletv: 4,
    universal: 4,
    youtube: 1,
    spotify: 1,
    canva: 1,
    oleadatv1: 1,
    oleadatv3: 3,
    iptv1: 1,
    iptv3: 3,
    iptv4: 4,
  };
  if (!doc.exists) {
    await ref.set(defaults);
    logInfo("✅ Totales default creados");
    return;
  }
  await ref.set(defaults, { merge: true });
}
asegurarTotalesDefault().catch(logErr);

// ===============================
// ROLES
// ===============================
async function isSuperAdmin(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  if (SUPER_ADMIN && uid === String(SUPER_ADMIN).trim()) {
    return true;
  }
  try {
    const doc = await db.collection("admins").doc(uid).get();
    if (!doc.exists) return false;
    const data = doc.data() || {};
    return data.activo === true && data.superAdmin === true;
  } catch (e) {
    logErr("isSuperAdmin:", e?.message || e);
    return false;
  }
}
async function isAdmin(userId) {
  if (await isSuperAdmin(userId)) return true;
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data()?.activo === true;
}
async function getRevendedorPorTelegramId(userId) {
  const uid = String(userId || "").trim();
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return null;
  let found = null;
  snap.forEach((doc) => {
    const r = normalizeRevendedorDoc(doc);
    if (r.telegramId === uid && r.activo === true) found = r;
  });
  return found;
}
async function setTelegramIdToRevendedor(nombre, userId) {
  const nombreNorm = normTxt(nombre);
  const snap = await db.collection("revendedores").get();
  if (snap.empty) {
    return { ok: false, msg: "⚠️ No hay revendedores en la colección." };
  }
  let found = null;
  snap.forEach((doc) => {
    const r = normalizeRevendedorDoc(doc);
    if (r.nombre_norm === nombreNorm) found = { ref: doc.ref, data: r };
  });
  if (!found) {
    return { ok: false, msg: "⚠️ No encontré ese revendedor por nombre." };
  }
  await found.ref.set(
    {
      nombre: found.data.nombre,
      nombre_norm: normTxt(found.data.nombre),
      telegramId: String(userId),
      activo: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return {
    ok: true,
    msg: `✅ Vinculado: ${found.data.nombre} => telegramId ${String(userId)}`,
  };
}
async function isVendedor(userId) {
  if (await isAdmin(userId)) return false;
  const rev = await getRevendedorPorTelegramId(userId);
  return !!(rev && rev.nombre && rev.telegramId === String(userId));
}

// ===============================
// PANEL BLINDADO
// ===============================
const panelMsgId = new Map();
function bindPanelFromCallback(q) {
  const chatId = q.message?.chat?.id;
  const mid = q.message?.message_id;
  if (chatId && mid) panelMsgId.set(String(chatId), mid);
}
async function sendFreshPanel(chatId, text, replyMarkup, parseMode = "Markdown", extraOpts = {}) {
  const sent = await bot.sendMessage(chatId, text, {
    parse_mode: parseMode,
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
    ...extraOpts,
  });
  panelMsgId.set(String(chatId), sent.message_id);
  return sent;
}
async function upsertPanel(chatId, text, replyMarkup, parseMode = "Markdown") {
  const key = String(chatId);
  const mid = panelMsgId.get(key);
  if (mid) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: mid,
        parse_mode: parseMode,
        reply_markup: replyMarkup,
        disable_web_page_preview: true,
      });
      return;
    } catch (e) {
      const msg = String(e?.message || "").toLowerCase();
      if (
        msg.includes("message is not modified") ||
        msg.includes("message to edit not found") ||
        msg.includes("message can't be edited") ||
        msg.includes("message_id_invalid") ||
        msg.includes("400") ||
        msg.includes("409")
      ) {
        panelMsgId.delete(key);
        return sendFreshPanel(chatId, text, replyMarkup, parseMode);
      }
      throw e;
    }
  }
  return sendFreshPanel(chatId, text, replyMarkup, parseMode);
}
async function sendCommandAnchoredPanel(msg, text, replyMarkup, parseMode = "Markdown", extraOpts = {}) {
  const chatId = msg.chat.id;
  const sent = await bot.sendMessage(chatId, text, {
    parse_mode: parseMode,
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
    reply_to_message_id: msg.message_id,
    ...extraOpts,
  });
  panelMsgId.set(String(chatId), sent.message_id);
  return sent;
}

// ===============================
// MEMORIAS DE FLUJO
// ===============================
const wizard = new Map();
const pending = new Map();
function w(chatId) {
  return wizard.get(String(chatId));
}
function wset(chatId, state) {
  wizard.set(String(chatId), state);
}
function wclear(chatId) {
  wizard.delete(String(chatId));
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  stripAcentos,
  normTxt,
  onlyDigits,
  normalizarPlataforma,
  esPlataformaValida,
  safeMail,
  docIdInventario,
  fmtEstado,
  isFechaDMY,
  hoyDMY,
  esTelefono,
  limpiarQuery,
  isEmailLike,
  parseDMYtoTS,
  addDaysDMY,
  escMD,
  enviarTxtComoArchivo,
  logInfo,
  logErr,
  safeBtnLabel,
  isMonthInputMMYYYY,
  getMonthKeyFromDMY,
  parseMonthInputToKey,
  getMonthLabelFromKey,
  startOfDayTS,
  endOfDayTS,
  ymdFromDMY,
  parseFechaFinanceInput,
  parseMontoNumber,
  moneyLps,
  moneyNumber,
  allowMsg,
  getSafeRevNombre,
  getSafeRevActivo,
  getSafeRevTelegramId,
  normalizeRevendedorDoc,
  getTotalPorPlataforma,
  asegurarTotalesDefault,
  isSuperAdmin,
  isAdmin,
  getRevendedorPorTelegramId,
  setTelegramIdToRevendedor,
  isVendedor,
  panelMsgId,
  bindPanelFromCallback,
  sendFreshPanel,
  upsertPanel,
  sendCommandAnchoredPanel,
  wizard,
  pending,
  w,
  wset,
  wclear,
};/* ✅ SUBLICUENTAS TG BOT — PARTE 3/6
   CLIENTES / CRM / HISTORIAL / BÚSQUEDAS / TXT / RENOVACIONES
   -----------------------------------------------------------
*/

const { bot, admin, db, PLATAFORMAS } = require("./index_01_core");
const {
  stripAcentos,
  normTxt,
  onlyDigits,
  normalizarPlataforma,
  esPlataformaValida,
  docIdInventario,
  isFechaDMY,
  hoyDMY,
  esTelefono,
  isEmailLike,
  parseDMYtoTS,
  addDaysDMY,
  escMD,
  enviarTxtComoArchivo,
  logErr,
  safeBtnLabel,
  normalizeRevendedorDoc,
  upsertPanel,
  w,
  wset,
  wclear,
} = require("./index_02_utils_roles");

// ===============================
// HELPERS SERVICIOS / CRM
// ===============================
function serviciosConIndiceOriginal(servicios = []) {
  const arr = Array.isArray(servicios)
    ? servicios.map((s, idxOriginal) => ({
        ...(s || {}),
        idxOriginal,
      }))
    : [];

  arr.sort((a, b) => parseDMYtoTS(a.fechaRenovacion) - parseDMYtoTS(b.fechaRenovacion));
  return arr;
}

function serviciosOrdenados(servicios = []) {
  return serviciosConIndiceOriginal(servicios).map((x) => {
    const c = { ...x };
    delete c.idxOriginal;
    return c;
  });
}

function daysUntilDMY(dmy) {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = String(dmy).split("/").map(Number);
  const target = new Date(yyyy, mm - 1, dd);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function estadoServicioLabel(fechaRenovacion) {
  const d = daysUntilDMY(fechaRenovacion);
  if (d === null) return "⚪ Sin fecha";
  if (d < 0) return "⚫ Vencido";
  if (d === 0) return "🔴 Vence hoy";
  if (d >= 1 && d <= 3) return "🟡 Próximo";
  return "🟢 Activo";
}

function emojiPlataforma(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const map = {
    netflix: "📺",
    vipnetflix: "🔥",
    disneyp: "🏰",
    disneys: "🎞️",
    hbomax: "🍿",
    primevideo: "🎥",
    paramount: "📀",
    crunchyroll: "🍥",
    vix: "🎬",
    appletv: "🍎",
    universal: "🌎",
    youtube: "▶️",
    spotify: "🎵",
    canva: "🎨",
    oleadatv1: "🌊",
    oleadatv3: "🌊",
    iptv1: "📡",
    iptv3: "📡",
    iptv4: "📡",
  };
  return map[p] || "📦";
}

function humanPlataforma(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const map = {
    netflix: "Netflix",
    vipnetflix: "VIP Netflix",
    disneyp: "Disney Premium",
    disneys: "Disney Standard",
    hbomax: "HBO Max",
    primevideo: "Prime Video",
    paramount: "Paramount+",
    crunchyroll: "Crunchyroll",
    vix: "Vix",
    appletv: "Apple TV",
    universal: "Universal+",
    youtube: "YouTube",
    spotify: "Spotify",
    canva: "Canva",
    oleadatv1: "OleadaTV (1)",
    oleadatv3: "OleadaTV (3)",
    iptv1: "IPTV (1)",
    iptv3: "IPTV (3)",
    iptv4: "IPTV (4)",
  };
  return map[p] || p || "-";
}

function labelPlataforma(plataforma = "") {
  return `${emojiPlataforma(plataforma)} ${humanPlataforma(plataforma)}`;
}

function getEstadoGeneralCliente(cliente = {}) {
  const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
  if (!servicios.length) return "⚪ Sin cuentas";

  const hayVencido = servicios.some((s) => {
    if (!isFechaDMY(s?.fechaRenovacion)) return false;
    const d = daysUntilDMY(s.fechaRenovacion);
    return d !== null && d < 0;
  });

  if (hayVencido) return "🔴 Vencido";
  return "🟢 Vigente";
}

function getProximaRenovacionCliente(cliente = {}) {
  const servicios = serviciosOrdenados(Array.isArray(cliente.servicios) ? cliente.servicios : []);
  const conFecha = servicios.filter((s) => isFechaDMY(s.fechaRenovacion));
  if (!conFecha.length) return "-";
  return conFecha[0].fechaRenovacion || "-";
}

function getTotalMensualCliente(cliente = {}) {
  const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
  return servicios.reduce((acc, s) => acc + Number(s?.precio || 0), 0);
}

function getCapacidadBasePorPlataformaLocal(plataforma = "") {
  const plat = normalizarPlataforma(plataforma);
  const mapa = {
    netflix: 5,
    vipnetflix: 1,
    disney: 6,
    disneyp: 6,
    disneyplus: 6,
    disneys: 3,
    max: 5,
    hbomax: 5,
    primevideo: 5,
    prime: 5,
    paramount: 5,
    vix: 4,
    crunchyroll: 5,
    spotify: 1,
    youtube: 1,
    canva: 1,
    appletv: 4,
    universal: 4,
    oleadatv1: 1,
    oleadatv3: 3,
    iptv1: 1,
    iptv3: 3,
    iptv4: 4,
  };

  return mapa[plat] || 1;
}

// ===============================
// HELPERS CLIENTES
// ===============================
function dedupeClientes(arr = []) {
  const map = new Map();

  for (const c of Array.isArray(arr) ? arr : []) {
    const tel = String(c.telefono_norm || onlyDigits(c.telefono || "") || "").trim();
    const nom = String(c.nombre_norm || normTxt(c.nombrePerfil || "") || "").trim();
    const key = `${tel}__${nom}`;
    if (!map.has(key)) map.set(key, c);
  }

  return Array.from(map.values());
}

async function clienteDuplicado(nombre, telefono, excludeId = "") {
  const nombreN = normTxt(nombre);
  const telN = onlyDigits(telefono);
  if (!nombreN || !telN) return null;

  const snap = await db.collection("clientes").limit(5000).get();
  let duplicado = null;

  snap.forEach((doc) => {
    if (excludeId && String(doc.id) === String(excludeId)) return;

    const c = doc.data() || {};
    const dbNombre = normTxt(c.nombrePerfil || "");
    const dbTel = onlyDigits(c.telefono || "");

    if (dbNombre === nombreN && dbTel === telN && !duplicado) {
      duplicado = { id: doc.id, ...c };
    }
  });

  return duplicado;
}

async function getCliente(clientId) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() || {}) };
}

async function patchServicio(clientId, idx, patch) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return false;

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return false;

  servicios[idx] = { ...(servicios[idx] || {}), ...patch };

  await ref.set(
    {
      servicios,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}

// ===============================
// HISTORIAL CLIENTE
// ===============================
async function getHistorialCliente(clientId) {
  try {
    const snap = await db
      .collection("clientes")
      .doc(String(clientId))
      .collection("historial")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    if (snap.empty) return [];
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (e) {
    return [];
  }
}

async function registrarHistorialCliente(clientId, payload = {}) {
  try {
    await db
      .collection("clientes")
      .doc(String(clientId))
      .collection("historial")
      .add({
        ...payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    logErr("registrarHistorialCliente:", e?.message || e);
  }
}

async function construirHistorialClienteTXT(cliente = {}, clientId = "") {
  const nombre = stripAcentos(cliente.nombrePerfil || "-");
  const telefono = onlyDigits(cliente.telefono || "") || "-";
  const vendedor = stripAcentos(cliente.vendedor || "-");
  const servicios = serviciosOrdenados(Array.isArray(cliente.servicios) ? cliente.servicios : []);
  const historial = clientId ? await getHistorialCliente(clientId) : [];

  let body = "";
  body += "HISTORIAL DEL CLIENTE\n\n";
  body += `NOMBRE: ${nombre}\n`;
  body += `TELEFONO: ${telefono}\n`;
  body += `VENDEDOR ACTUAL: ${vendedor}\n`;
  body += `ESTADO: ${stripAcentos(getEstadoGeneralCliente(cliente))}\n`;
  body += `TOTAL MENSUAL: ${getTotalMensualCliente(cliente)} Lps\n`;
  body += `PROXIMA RENOVACION: ${getProximaRenovacionCliente(cliente)}\n\n`;

  body += "SERVICIOS ACTIVOS\n\n";

  if (!servicios.length) {
    body += "SIN CUENTAS REGISTRADAS\n";
  } else {
    servicios.forEach((s, i) => {
      body += `${String(i + 1).padStart(2, "0")}) `;
      body += `${stripAcentos(humanPlataforma(s.plataforma || "-"))} | `;
      body += `${stripAcentos(String(s.correo || "-"))} | `;
      body += `${Number(s.precio || 0)} Lps | `;
      body += `${s.fechaRenovacion || "-"} | `;
      body += `ESTADO: ${stripAcentos(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }

  body += "\n--------------------\n";
  body += `TOTAL SERVICIOS: ${servicios.length}\n\n`;

  body += "MOVIMIENTOS / HISTORIAL\n\n";

  if (!historial.length) {
    body += "SIN MOVIMIENTOS REGISTRADOS\n";
  } else {
    historial.forEach((h, i) => {
      const fecha =
        h.fecha ||
        h.fechaRenovacion ||
        h.createdAt?.toDate?.()?.toLocaleString?.("es-HN", { hour12: false }) ||
        "-";

      body += `${String(i + 1).padStart(2, "0")}) `;
      body += `${stripAcentos(h.tipo || "movimiento")} | `;
      body += `${stripAcentos(humanPlataforma(h.plataforma || "-"))} | `;
      body += `${stripAcentos(String(h.correo || "-"))} | `;
      body += `${Number(h.precio || 0)} Lps | `;
      body += `${stripAcentos(String(fecha))} | `;
      body += `VENDEDOR: ${stripAcentos(h.vendedor || vendedor || "-")}\n`;
    });
  }

  return body;
}

function clienteResumenTXT(c = {}) {
  const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);
  const estadoGeneral = getEstadoGeneralCliente(c);
  const totalMensual = getTotalMensualCliente(c);
  const proxFecha = getProximaRenovacionCliente(c);

  let body = "";
  body += "CLIENTE CRM\n\n";
  body += `NOMBRE: ${stripAcentos(c.nombrePerfil || "-")}\n`;
  body += `TELEFONO: ${onlyDigits(c.telefono || "") || "-"}\n`;
  body += `VENDEDOR: ${stripAcentos(c.vendedor || "-")}\n\n`;
  body += `SERVICIOS ACTIVOS: ${servicios.length}\n`;
  body += `TOTAL MENSUAL: ${totalMensual} Lps\n`;
  body += `PROXIMA RENOVACION: ${proxFecha}\n`;
  body += `ESTADO GENERAL: ${stripAcentos(estadoGeneral)}\n\n`;
  body += "SERVICIOS\n\n";

  if (!servicios.length) {
    body += "SIN SERVICIOS\n";
  } else {
    servicios.forEach((s, i) => {
      body += `${i + 1}) ${stripAcentos(humanPlataforma(s.plataforma || "-"))} | ${s.correo || "-"} | ${Number(s.precio || 0)} Lps | ${s.fechaRenovacion || "-"} | ${stripAcentos(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }

  return body;
}

async function enviarHistorialClienteTXT(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const body = await construirHistorialClienteTXT(c, clientId);
  const nombreSafe =
    stripAcentos(c.nombrePerfil || "cliente").replace(/[^\w\-]+/g, "_").slice(0, 40) || "cliente";

  return enviarTxtComoArchivo(chatId, body, `historial_${nombreSafe}_${Date.now()}.txt`);
}

// ===============================
// FICHA / MENÚS CRM
// ===============================
async function enviarFichaCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);
  const estadoGeneral = getEstadoGeneralCliente(c);
  const totalMensual = getTotalMensualCliente(c);
  const proxFecha = getProximaRenovacionCliente(c);

  let txt = "👤 *CRM CLIENTE*\n\n";
  txt += `🧑 *Nombre:* ${escMD(c.nombrePerfil || "-")}\n`;
  txt += `📱 *Teléfono:* ${escMD(c.telefono || "-")}\n`;
  txt += `🧾 *Vendedor:* ${escMD(c.vendedor || "-")}\n`;
  txt += `📊 *Estado general:* ${escMD(estadoGeneral)}\n`;
  txt += `💰 *Total mensual:* ${totalMensual} Lps\n`;
  txt += `📅 *Próxima renovación:* ${escMD(proxFecha)}\n`;
  txt += `🧩 *Servicios activos:* ${servicios.length}\n\n`;

  txt += "*SERVICIOS*\n";
  if (!servicios.length) {
    txt += "— Sin servicios —\n";
  } else {
    servicios.forEach((s, i) => {
      txt += `\n*${i + 1})* ${escMD(labelPlataforma(s.plataforma || "-"))}\n`;
      txt += `📧 ${escMD(s.correo || "-")}\n`;
      txt += `🔐 ${escMD(s.pin || "-")}\n`;
      txt += `💵 ${Number(s.precio || 0)} Lps\n`;
      txt += `📆 ${escMD(s.fechaRenovacion || "-")} — ${escMD(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }

  const kb = [];
  kb.push([{ text: "✏️ Editar cliente", callback_data: `cli:edit:menu:${clientId}` }]);

  if (servicios.length > 0) {
    kb.push([{ text: "🧩 Editar servicios", callback_data: `cli:serv:list:${clientId}` }]);
    kb.push([{ text: "🔄 Renovar servicio", callback_data: `cli:ren:list:${clientId}` }]);
    kb.push([{ text: "⏫ Renovar TODOS +30 días", callback_data: `cli:ren:all:ask:${clientId}` }]);
  }

  kb.push([{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }]);
  kb.push([{ text: "📄 TXT de este cliente", callback_data: `cli:txt:one:${clientId}` }]);
  kb.push([{ text: "📜 Historial TXT", callback_data: `cli:txt:hist:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

async function menuEditarCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const t =
    `✏️ *EDITAR CLIENTE*\n\n` +
    `👤 Nombre: *${escMD(c.nombrePerfil || "-")}*\n` +
    `📱 Tel: *${escMD(c.telefono || "-")}*\n` +
    `🧑‍💼 Vendedor: *${escMD(c.vendedor || "-")}*`;

  return upsertPanel(
    chatId,
    t,
    {
      inline_keyboard: [
        [{ text: "👤 Editar nombre", callback_data: `cli:edit:nombre:${clientId}` }],
        [{ text: "📱 Editar teléfono", callback_data: `cli:edit:tel:${clientId}` }],
        [{ text: "🧑‍💼 Editar vendedor", callback_data: `cli:edit:vend:${clientId}` }],
        [{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

async function menuListaServicios(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = serviciosConIndiceOriginal(Array.isArray(c.servicios) ? c.servicios : []);
  if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

  const kb = servicios.map((s, i) => [
    {
      text: safeBtnLabel(`${i + 1}) ${labelPlataforma(s.plataforma)} — ${s.correo}`),
      callback_data: `cli:serv:menu:${clientId}:${s.idxOriginal}`,
    },
  ]);

  kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(
    chatId,
    "🧩 *EDITAR SERVICIOS*\nSeleccione un servicio:",
    { inline_keyboard: kb },
    "Markdown"
  );
}

async function menuServicio(chatId, clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

  const s = servicios[idx] || {};
  const t =
    `🧩 *SERVICIO #${idx + 1}*\n\n` +
    `📌 Plataforma: *${escMD(labelPlataforma(s.plataforma || "-"))}*\n` +
    `📧 Correo: *${escMD(s.correo || "-")}*\n` +
    `🔐 Pin: *${escMD(s.pin || "-")}*\n` +
    `💰 Precio: *${Number(s.precio || 0)}* Lps\n` +
    `📅 Renovación: *${escMD(s.fechaRenovacion || "-")}*\n` +
    `📊 Estado: *${escMD(estadoServicioLabel(s.fechaRenovacion))}*`;

  return upsertPanel(
    chatId,
    t,
    {
      inline_keyboard: [
        [{ text: "📌 Cambiar plataforma", callback_data: `cli:serv:edit:plat:${clientId}:${idx}` }],
        [{ text: "📧 Cambiar correo", callback_data: `cli:serv:edit:mail:${clientId}:${idx}` }],
        [{ text: "🔐 Cambiar pin", callback_data: `cli:serv:edit:pin:${clientId}:${idx}` }],
        [{ text: "💰 Cambiar precio", callback_data: `cli:serv:edit:precio:${clientId}:${idx}` }],
        [{ text: "📅 Cambiar fecha", callback_data: `cli:serv:edit:fecha:${clientId}:${idx}` }],
        [{ text: "🗑️ Eliminar perfil", callback_data: `cli:serv:del:ask:${clientId}:${idx}` }],
        [{ text: "⬅️ Volver lista", callback_data: `cli:serv:list:${clientId}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

// ===============================
// ADD SERVICIO TX CON ESPEJO
// ===============================
async function addServicioTx(clientId, servicio) {
  const refCliente = db.collection("clientes").doc(String(clientId));
  const plat = normalizarPlataforma(servicio.plataforma);
  const mail = String(servicio.correo || "").trim().toLowerCase();
  const refInv = db.collection("inventario").doc(docIdInventario(mail, plat));

  return db.runTransaction(async (tx) => {
    const docCli = await tx.get(refCliente);
    if (!docCli.exists) throw new Error("Cliente no existe en TX");

    const curCli = docCli.data() || {};
    const docInv = await tx.get(refInv);

    const arrServ = Array.isArray(curCli.servicios) ? curCli.servicios.slice() : [];
    arrServ.push(servicio);

    tx.set(
      refCliente,
      {
        servicios: arrServ,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (docInv.exists) {
      const invData = docInv.data() || {};
      let clientesInv = Array.isArray(invData.clientes) ? invData.clientes.slice() : [];
      const capacidad = Number(
        invData.capacidad ||
          invData.total ||
          getCapacidadBasePorPlataformaLocal(plat) ||
          0
      );

      const yaExiste = clientesInv.some(
        (c) => c.nombre === curCli.nombrePerfil && c.pin === servicio.pin
      );

      if (!yaExiste) {
        clientesInv.push({
          nombre: curCli.nombrePerfil || "Sin Nombre",
          pin: servicio.pin || "0000",
          slot: clientesInv.length + 1,
        });

        const ocupados = clientesInv.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "llena" : "activa";

        tx.set(
          refInv,
          {
            clientes: clientesInv,
            capacidad,
            ocupados,
            disponibles,
            disp: disponibles,
            estado,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    return {
      cliente: { id: docCli.id, ...curCli },
      servicios: arrServ,
    };
  });
}

// ===============================
// WIZARD PLATAFORMAS
// ===============================
function kbPlataformasWiz(prefix, clientId, idxOpt) {
  const cb = (plat) =>
    idxOpt !== undefined ? `${prefix}:${plat}:${clientId}:${idxOpt}` : `${prefix}:${plat}:${clientId}`;

  return [
    [
      { text: "📺 netflix", callback_data: cb("netflix") },
      { text: "🔥 vipnetflix", callback_data: cb("vipnetflix") },
    ],
    [
      { text: "🏰 disneyp", callback_data: cb("disneyp") },
      { text: "🎞️ disneys", callback_data: cb("disneys") },
    ],
    [
      { text: "🍿 hbomax", callback_data: cb("hbomax") },
      { text: "🎥 primevideo", callback_data: cb("primevideo") },
    ],
    [
      { text: "📀 paramount", callback_data: cb("paramount") },
      { text: "🍥 crunchyroll", callback_data: cb("crunchyroll") },
    ],
    [
      { text: "🎬 vix", callback_data: cb("vix") },
      { text: "🍎 appletv", callback_data: cb("appletv") },
    ],
    [
      { text: "🌎 universal", callback_data: cb("universal") },
      { text: "▶️ youtube", callback_data: cb("youtube") },
    ],
    [
      { text: "🎵 spotify", callback_data: cb("spotify") },
      { text: "🎨 canva", callback_data: cb("canva") },
    ],
    [
      { text: "🌊 oleadatv (1)", callback_data: cb("oleadatv1") },
      { text: "🌊 oleadatv (3)", callback_data: cb("oleadatv3") },
    ],
    [
      { text: "📡 iptv (1)", callback_data: cb("iptv1") },
      { text: "📡 iptv (3)", callback_data: cb("iptv3") },
    ],
    [{ text: "📡 iptv (4)", callback_data: cb("iptv4") }],
  ];
}

// ===============================
// WIZARD NUEVO CLIENTE
// ===============================
async function wizardStart(chatId) {
  wset(chatId, {
    step: 1,
    data: {},
    clientId: null,
    servStep: 0,
    servicio: {},
  });

  return bot.sendMessage(chatId, "👥 *NUEVO CLIENTE*\n\n(1/3) Escriba *Nombre*:", {
    parse_mode: "Markdown",
  });
}

async function wizardNext(chatId, text) {
  const st = w(chatId);
  if (!st) return;

  const t = String(text || "").trim();
  const d = st.data || {};

  if (st.step === 1) {
    if (!t) return bot.sendMessage(chatId, "⚠️ Nombre vacío. Escriba el nombre:");
    d.nombrePerfil = t;
    st.data = d;
    st.step = 2;
    wset(chatId, st);
    return bot.sendMessage(chatId, "(2/3) Escriba *Teléfono*:", { parse_mode: "Markdown" });
  }

  if (st.step === 2) {
    if (!esTelefono(t)) {
      return bot.sendMessage(chatId, "⚠️ Teléfono inválido. Escriba solo números válidos:");
    }
    d.telefono = t;
    st.data = d;
    st.step = 3;
    wset(chatId, st);
    return bot.sendMessage(chatId, "(3/3) Escriba *Vendedor*:", { parse_mode: "Markdown" });
  }

  if (st.step === 3) {
    if (!t) return bot.sendMessage(chatId, "⚠️ Vendedor vacío. Escríbalo:");
    d.vendedor = t;

    const dup = await clienteDuplicado(d.nombrePerfil || "", d.telefono || "");
    if (dup) {
      wclear(chatId);
      return bot.sendMessage(
        chatId,
        `⚠️ Cliente duplicado detectado.\nYa existe:\n${dup.nombrePerfil || "-"} | ${dup.telefono || "-"}`
      );
    }

    const clientRef = db.collection("clientes").doc();
    st.clientId = clientRef.id;

    await clientRef.set(
      {
        nombrePerfil: d.nombrePerfil,
        telefono: String(d.telefono || "").trim(),
        vendedor: d.vendedor,
        servicios: [],
        nombre_norm: normTxt(d.nombrePerfil),
        telefono_norm: onlyDigits(d.telefono),
        vendedor_norm: normTxt(d.vendedor),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await registrarHistorialCliente(st.clientId, {
      tipo: "cliente_creado",
      nombrePerfil: d.nombrePerfil || "",
      telefono: String(d.telefono || "").trim(),
      vendedor: d.vendedor || "",
      fecha: hoyDMY(),
    });

    st.step = 4;
    st.servStep = 1;
    st.servicio = {};
    st.data = d;
    wset(chatId, st);

    return bot.sendMessage(
      chatId,
      "✅ Cliente creado.\n\n📌 Ahora agreguemos el servicio.\n(Servicio 1/5) Plataforma:",
      { reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", st.clientId) } }
    );
  }

  if (st.step === 4) {
    const s = st.servicio || {};

    if (st.servStep === 1) {
      return bot.sendMessage(chatId, "📌 Seleccione la plataforma con los botones.");
    }

    if (st.servStep === 2) {
      if (!isEmailLike(t)) {
        return bot.sendMessage(chatId, "⚠️ Correo inválido. Escriba el correo completo:");
      }
      s.correo = t.toLowerCase();
      st.servStep = 3;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 3/5) Pin/Clave:");
    }

    if (st.servStep === 3) {
      if (!t) return bot.sendMessage(chatId, "⚠️ Pin/clave vacío. Escríbalo:");
      s.pin = t;
      st.servStep = 4;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 4/5) Precio (solo número, Lps):");
    }

    if (st.servStep === 4) {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) {
        return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
      }
      s.precio = n;
      st.servStep = 5;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 5/5) Fecha renovación (dd/mm/yyyy):");
    }

    if (st.servStep === 5) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");

      s.fechaRenovacion = String(t).trim();

      const { cliente, servicios } = await addServicioTx(String(st.clientId), {
        plataforma: String(s.plataforma || "").trim(),
        correo: String(s.correo || "").trim().toLowerCase(),
        pin: String(s.pin || "").trim(),
        precio: Number(s.precio || 0),
        fechaRenovacion: s.fechaRenovacion,
      });

      await registrarHistorialCliente(st.clientId, {
        tipo: "servicio_agregado",
        plataforma: String(s.plataforma || "").trim(),
        correo: String(s.correo || "").trim().toLowerCase(),
        pin: String(s.pin || "").trim(),
        precio: Number(s.precio || 0),
        fechaRenovacion: s.fechaRenovacion,
        vendedor: cliente?.vendedor || st.data?.vendedor || "",
        fecha: hoyDMY(),
      });

      st.servicio = {};
      st.servStep = 1;
      st.step = 4;
      wset(chatId, st);

      const ordenados = serviciosOrdenados(servicios);

      const resumen =
        "✅ Servicio agregado.\n¿Desea agregar otra plataforma a este cliente?\n\n" +
        `Cliente:\n${cliente?.nombrePerfil || st.data?.nombrePerfil || "-"}\n` +
        `${cliente?.telefono || st.data?.telefono || "-"}\n` +
        `${cliente?.vendedor || st.data?.vendedor || "-"}\n\n` +
        "SERVICIOS (ordenados por fecha):\n" +
        ordenados
          .map((x, i) => `${i + 1}) ${x.plataforma} — ${x.correo} — ${x.precio} Lps — Renueva: ${x.fechaRenovacion}`)
          .join("\n");

      const kb = {
        inline_keyboard: [
          [{ text: "➕ Agregar otra", callback_data: `wiz:addmore:${st.clientId}` }],
          [{ text: "✅ Finalizar", callback_data: `wiz:finish:${st.clientId}` }],
        ],
      };

      if (resumen.length > 3800) {
        await enviarTxtComoArchivo(chatId, resumen, `resumen_servicios_${Date.now()}.txt`);
        return bot.sendMessage(chatId, "📄 Te mandé el resumen en TXT.\n¿Deseas agregar otra plataforma?", {
          reply_markup: kb,
        });
      }

      return bot.sendMessage(chatId, resumen, { reply_markup: kb });
    }
  }
}

// ===============================
// BÚSQUEDA CLIENTES
// ===============================
async function buscarPorTelefonoTodos(telInput) {
  const tnorm = onlyDigits(telInput);
  if (!tnorm) return [];

  const all = [];
  const seen = new Set();

  const snapNorm = await db.collection("clientes").where("telefono_norm", "==", tnorm).limit(50).get();
  snapNorm.forEach((d) => {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      all.push({ id: d.id, ...d.data() });
    }
  });

  const snapTel = await db.collection("clientes").where("telefono", "==", tnorm).limit(50).get();
  snapTel.forEach((d) => {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      all.push({ id: d.id, ...d.data() });
    }
  });

  const legacy = await db.collection("clientes").doc(tnorm).get();
  if (legacy.exists && !seen.has(legacy.id)) {
    all.push({ id: legacy.id, ...legacy.data() });
  }

  if (all.length) return all;

  const scan = await db.collection("clientes").limit(5000).get();
  scan.forEach((doc) => {
    const c = doc.data() || {};
    const tel = onlyDigits(c.telefono || "");
    if (tel.includes(tnorm) && !seen.has(doc.id)) {
      seen.add(doc.id);
      all.push({ id: doc.id, ...c });
    }
  });

  return all.slice(0, 50);
}

async function buscarClienteRobusto(queryLower) {
  const qRaw = String(queryLower || "").trim();
  const q = normTxt(qRaw);
  const qTel = onlyDigits(qRaw);

  if (qTel && qTel.length >= 7) return await buscarPorTelefonoTodos(qTel);

  try {
    const snapName = await db
      .collection("clientes")
      .orderBy("nombre_norm")
      .startAt(q)
      .endAt(q + "\uf8ff")
      .limit(25)
      .get();

    if (!snapName.empty) return snapName.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) {}

  const snap = await db.collection("clientes").limit(5000).get();
  const encontrados = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const nombre = normTxt(c.nombrePerfil || "");
    const vendedor = normTxt(c.vendedor || "");
    const tel = onlyDigits(c.telefono || "");

    if (nombre.includes(q) || vendedor.includes(q) || (qTel && tel.includes(qTel))) {
      encontrados.push({ id: doc.id, ...c });
    }
  });

  return encontrados.slice(0, 50);
}

async function enviarListaResultadosClientes(chatId, resultados) {
  const dedup = dedupeClientes(resultados);

  let txt = `📱 *RESULTADOS*\nSe encontraron *${dedup.length}* clientes.\n\n`;

  dedup.forEach((c, i) => {
    txt += `*${i + 1})* ${escMD(c.nombrePerfil || "-")} | ${escMD(c.telefono || "-")} | ${escMD(c.vendedor || "-")}\n`;
  });

  if (txt.length > 3800) {
    return enviarTxtComoArchivo(chatId, txt, `clientes_resultados_${Date.now()}.txt`);
  }

  const kb = dedup.map((c, i) => [
    {
      text: safeBtnLabel(`👤 ${i + 1}) ${c.nombrePerfil || "-"} (${c.telefono || "-"})`, 58),
      callback_data: `cli:view:${c.id}`,
    },
  ]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

// ===============================
// TXT CLIENTES
// ===============================
async function reporteClientesTXTGeneral(chatId) {
  const snap = await db.collection("clientes").limit(5000).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay clientes.");

  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  arr.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));

  let body = "CLIENTES (NOMBRE | TELEFONO)\n\n";
  arr.forEach((c, i) => {
    body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")}\n`;
  });

  body += `\n--------------------\nTOTAL CLIENTES: ${arr.length}\n`;
  return enviarTxtComoArchivo(chatId, body, `clientes_${Date.now()}.txt`);
}

async function reporteClientesSplitPorVendedorTXT(chatId) {
  const snap = await db.collection("clientes").limit(5000).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay clientes.");

  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const map = new Map();

  for (const c of arr) {
    const vend = String(c.vendedor || "SIN VENDEDOR").trim() || "SIN VENDEDOR";
    if (!map.has(vend)) map.set(vend, []);
    map.get(vend).push(c);
  }

  const vendedores = Array.from(map.keys()).sort((a, b) => normTxt(a).localeCompare(normTxt(b)));
  await bot.sendMessage(chatId, `📄 Generando ${vendedores.length} TXT (1 por vendedor)...`);

  for (const vend of vendedores) {
    const lista = map.get(vend) || [];
    lista.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));

    let body = `VENDEDOR: ${stripAcentos(vend)}\n`;
    body += `TOTAL CLIENTES: ${lista.length}\n\n`;
    body += "CLIENTES (NOMBRE | TELEFONO)\n\n";

    lista.forEach((c, i) => {
      body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")}\n`;
    });

    const fileSafe = stripAcentos(vend).replace(/[^\w\-]+/g, "_").slice(0, 40) || "VENDEDOR";
    await enviarTxtComoArchivo(chatId, body, `clientes_${fileSafe}_${Date.now()}.txt`);
  }

  return bot.sendMessage(chatId, "✅ Listo: enviados los TXT por vendedor.");
}

async function obtenerClientesPorVendedor(vendedorNombre) {
  const snap = await db.collection("clientes").limit(5000).get();
  const out = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    if (normTxt(c.vendedor || "") === normTxt(vendedorNombre || "")) {
      out.push({ id: doc.id, ...c });
    }
  });

  out.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));
  return out;
}

async function enviarMisClientes(chatId, vendedorNombre) {
  const arr = await obtenerClientesPorVendedor(vendedorNombre);

  if (!arr.length) {
    return bot.sendMessage(chatId, `⚠️ No hay clientes para ${vendedorNombre}.`);
  }

  let txt = `👥 *MIS CLIENTES — ${escMD(vendedorNombre)}*\n\n`;
  arr.forEach((c, i) => {
    const servicios = Array.isArray(c.servicios) ? c.servicios.length : 0;
    txt += `${i + 1}) ${escMD(c.nombrePerfil || "-")} | ${escMD(c.telefono || "-")} | Servicios: ${servicios}\n`;
  });

  if (txt.length > 3800) {
    return enviarTxtComoArchivo(chatId, txt, `mis_clientes_${Date.now()}.txt`);
  }

  return bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
}

async function enviarMisClientesTXT(chatId, vendedorNombre) {
  const arr = await obtenerClientesPorVendedor(vendedorNombre);

  let body = `MIS CLIENTES - ${stripAcentos(vendedorNombre)}\n\n`;
  if (!arr.length) {
    body += "SIN CLIENTES\n";
  } else {
    arr.forEach((c, i) => {
      const servicios = Array.isArray(c.servicios) ? c.servicios.length : 0;
      body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")} | SERVICIOS: ${servicios}\n`;
    });
    body += `\n--------------------\nTOTAL CLIENTES: ${arr.length}\n`;
  }

  return enviarTxtComoArchivo(chatId, body, `mis_clientes_${Date.now()}.txt`);
}

// ===============================
// RENOVACIONES
// ===============================
async function obtenerRenovacionesPorFecha(fechaDMY, vendedorOpt) {
  const snap = await db.collection("clientes").limit(5000).get();
  const out = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const vendedor = String(c.vendedor || "").trim();
    const servicios = Array.isArray(c.servicios) ? c.servicios : [];

    for (const s of servicios) {
      if (String(s.fechaRenovacion || "") === fechaDMY) {
        const okVend = !vendedorOpt || normTxt(vendedor) === normTxt(vendedorOpt);
        if (okVend) {
          out.push({
            nombrePerfil: c.nombrePerfil || "-",
            plataforma: s.plataforma || "-",
            precio: Number(s.precio || 0),
            telefono: c.telefono || "-",
            vendedor: vendedor || "-",
            fechaRenovacion: fechaDMY,
          });
        }
      }
    }
  });

  out.sort((a, b) => {
    const va = normTxt(a.vendedor);
    const vb = normTxt(b.vendedor);
    if (va !== vb) return va.localeCompare(vb);
    return normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil));
  });

  return out;
}

function renovacionesTexto(list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt
    ? `RENOVACIONES ${fechaDMY} — ${vendedorOpt}`
    : `RENOVACIONES ${fechaDMY} — GENERAL`;

  let t = `📅 *${escMD(titulo)}*\n\n`;

  if (!list || list.length === 0) {
    t += "⚠️ No hay renovaciones.\n";
    return t;
  }

  let suma = 0;
  list.forEach((x, i) => {
    suma += Number(x.precio || 0);
    t += `${i + 1}) ${escMD(x.nombrePerfil)} — ${escMD(x.plataforma)} — ${x.precio} Lps — ${escMD(x.telefono)} — ${escMD(x.vendedor)}\n`;
  });

  t += "\n━━━━━━━━━━━━━━\n";
  t += `Clientes: ${list.length}\n`;
  t += `Total a cobrar: ${suma} Lps\n`;
  return t;
}

async function enviarTXT(chatId, list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt
    ? `renovaciones_${stripAcentos(vendedorOpt)}_${fechaDMY}`
    : `renovaciones_general_${fechaDMY}`;

  const fileSafe = titulo.replace(/[^\w\-]+/g, "_");

  let body = vendedorOpt
    ? `RENOVACIONES ${fechaDMY} - ${stripAcentos(vendedorOpt)}\n\n`
    : `RENOVACIONES ${fechaDMY} - GENERAL\n\n`;

  if (!list || list.length === 0) {
    body += "SIN RENOVACIONES\n";
  } else {
    let suma = 0;
    list.forEach((x, i) => {
      suma += Number(x.precio || 0);
      body += `${String(i + 1).padStart(2, "0")}) ${stripAcentos(x.nombrePerfil)} | ${x.plataforma} | ${x.precio} Lps | ${x.telefono} | ${stripAcentos(x.vendedor)}\n`;
    });
    body += `\n--------------------\nCLIENTES: ${list.length}\nTOTAL: ${suma} Lps\n`;
  }

  return enviarTxtComoArchivo(chatId, body, `${fileSafe}.txt`);
}

async function enviarTXTATodosHoy(superChatId) {
  const fecha = hoyDMY();
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(superChatId, "⚠️ No hay revendedores.");

  let enviados = 0;
  let saltados = 0;

  for (const d of snap.docs) {
    const rev = normalizeRevendedorDoc(d);

    if (!rev.activo || !rev.telegramId || !rev.nombre) {
      saltados++;
      continue;
    }

    const list = await obtenerRenovacionesPorFecha(fecha, rev.nombre);
    await enviarTXT(rev.telegramId, list, fecha, rev.nombre);
    enviados++;
  }

  return bot.sendMessage(
    superChatId,
    `✅ Enviado TXT HOY (${fecha})\n• Revendedores enviados: ${enviados}\n• Saltados: ${saltados}`
  );
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  serviciosConIndiceOriginal,
  serviciosOrdenados,
  daysUntilDMY,
  estadoServicioLabel,
  emojiPlataforma,
  humanPlataforma,
  labelPlataforma,
  getEstadoGeneralCliente,
  getProximaRenovacionCliente,
  getTotalMensualCliente,

  dedupeClientes,
  clienteDuplicado,
  getCliente,
  patchServicio,
  addServicioTx,

  getHistorialCliente,
  registrarHistorialCliente,
  construirHistorialClienteTXT,
  clienteResumenTXT,
  enviarHistorialClienteTXT,

  enviarFichaCliente,
  menuEditarCliente,
  menuListaServicios,
  menuServicio,

  kbPlataformasWiz,
  wizardStart,
  wizardNext,

  buscarPorTelefonoTodos,
  buscarClienteRobusto,
  enviarListaResultadosClientes,

  reporteClientesTXTGeneral,
  reporteClientesSplitPorVendedorTXT,
  obtenerClientesPorVendedor,
  enviarMisClientes,
  enviarMisClientesTXT,

  obtenerRenovacionesPorFecha,
  renovacionesTexto,
  enviarTXT,
  enviarTXTATodosHoy,
};
/* ✅ SUBLICUENTAS TG BOT — PARTE 4/6
   INVENTARIO / CORREOS / PANEL CORREO / CÓDIGOS NETFLIX
   -----------------------------------------------------
*/

const { bot, admin, db, TZ, PAGE_SIZE, PLATAFORMAS } = require("./index_01_core");
const {
  normalizarPlataforma,
  esPlataformaValida,
  docIdInventario,
  fmtEstado,
  escMD,
  safeBtnLabel,
  logErr,
  upsertPanel,
  getTotalPorPlataforma,
} = require("./index_02_utils_roles");
const { humanPlataforma } = require("./index_03_clientes_crm");

// ===============================
// HELPERS INVENTARIO
// ===============================
async function buscarInventarioPorCorreo(correo) {
  const mail = String(correo || "").trim().toLowerCase();
  const snap = await db.collection("inventario").where("correo", "==", mail).limit(50).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function getCapacidadCorreo(data = {}, plataforma = "") {
  const desdeData = Number(data.capacidad || data.total || 0);
  if (Number.isFinite(desdeData) && desdeData > 0) return desdeData;

  const plat = normalizarPlataforma(plataforma);
  const mapa = {
    netflix: 5,
    vipnetflix: 1,
    disney: 6,
    disneyp: 6,
    disneyplus: 6,
    disneys: 3,
    max: 5,
    hbomax: 5,
    primevideo: 5,
    prime: 5,
    paramount: 5,
    vix: 4,
    crunchyroll: 5,
    spotify: 1,
    youtube: 1,
    canva: 1,
    appletv: 4,
    universal: 4,
    oleadatv1: 1,
    oleadatv3: 3,
    iptv1: 1,
    iptv3: 3,
    iptv4: 4,
  };

  return mapa[plat] || 1;
}

async function aplicarAutoLleno(chatId, ref, dataAntes, dataDespues) {
  const antes = Number(dataAntes?.disp ?? 0);
  const despues = Number(dataDespues?.disp ?? 0);

  if (despues <= 0) {
    await ref.set(
      {
        disp: 0,
        estado: "llena",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (antes > 0) {
      return bot.sendMessage(
        chatId,
        `🚨 *ALERTA STOCK*\n${String(dataDespues.plataforma).toUpperCase()} quedó en *0*.\n📧 ${dataDespues.correo}\n✅ Estado: *LLENA*`,
        { parse_mode: "Markdown" }
      );
    }
  }
}

async function inventarioPlataformaTexto(plataforma, page) {
  const p = normalizarPlataforma(plataforma);
  const totalDefault = await getTotalPorPlataforma(p);

  const snap = await db.collection("inventario").where("plataforma", "==", p).limit(500).get();

  const docs = snap.docs
    .map((d) => {
      const data = d.data() || {};
      const clientes = Array.isArray(data.clientes) ? data.clientes : [];
      const capacidad = Number(data.capacidad || data.total || totalDefault || getCapacidadCorreo(data, p) || 0);
      const ocupados = clientes.length;
      const disponibles = Math.max(0, capacidad - ocupados);
      const estado = disponibles === 0 ? "llena" : "activa";

      return {
        id: d.id,
        ...data,
        capacidad,
        ocupados,
        disp: disponibles,
        disponibles,
        estado,
      };
    })
    .filter((x) => Number(x.disp || 0) > 0)
    .sort((a, b) => {
      if (Number(b.disp || 0) !== Number(a.disp || 0)) {
        return Number(b.disp || 0) - Number(a.disp || 0);
      }
      return String(a.correo || "").localeCompare(String(b.correo || ""));
    });

  const totalItems = docs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, totalItems);
  const slice = docs.slice(start, end);

  let texto = `📌 *${p.toUpperCase()} — INVENTARIO DISPONIBLE*\n`;
  texto += `Mostrando ${totalItems === 0 ? 0 : start + 1}-${end} de ${totalItems}\n\n`;

  if (slice.length === 0) {
    texto += "⚠️ No hay correos con espacio disponible.\n";
  } else {
    let i = start + 1;
    for (const d of slice) {
      texto += `${i}) ${d.correo} — 🔑 ${d?.clave ? d.clave : "Sin clave"} — ${d.ocupados}/${d.capacidad} — ${fmtEstado(d.estado)}\n`;
      i++;
    }

    texto += "\n━━━━━━━━━━━━━━\n";
    texto += "📌 Para abrir correo: escriba /correo\n";
  }

  texto += `\n📄 Página: ${safePage + 1}/${totalPages}`;
  return { texto, safePage, totalPages };
}

async function enviarInventarioPlataforma(chatId, plataforma, page) {
  const p = normalizarPlataforma(plataforma);

  if (!esPlataformaValida(p)) {
    return upsertPanel(
      chatId,
      "⚠️ Plataforma inválida.",
      { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
      "Markdown"
    );
  }

  const { texto, safePage, totalPages } = await inventarioPlataformaTexto(p, page);
  const canBack = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return upsertPanel(
    chatId,
    texto,
    {
      inline_keyboard: [
        [
          { text: "⬅️ Atrás", callback_data: canBack ? `inv:${p}:${safePage - 1}` : "noop" },
          { text: "🏠 Inicio", callback_data: "go:inicio" },
          { text: "➡️ Siguiente", callback_data: canNext ? `inv:${p}:${safePage + 1}` : "noop" },
        ],
        [{ text: "🔄 Actualizar", callback_data: `inv:${p}:${safePage}` }],
        [{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }],
      ],
    },
    "Markdown"
  );
}

async function mostrarStockGeneral(chatId) {
  const lines = [];

  for (const p of PLATAFORMAS) {
    const snap = await db.collection("inventario").where("plataforma", "==", p).limit(500).get();
    let libres = 0;

    snap.forEach((d) => {
      const data = d.data() || {};
      const clientes = Array.isArray(data.clientes) ? data.clientes : [];
      const capacidad = Number(data.capacidad || data.total || getCapacidadCorreo(data, p) || 0);
      libres += Math.max(0, capacidad - clientes.length);
    });

    lines.push(`✅ *${humanPlataforma(p)}*: ${libres} libres`);
  }

  const texto = `📦 *STOCK GENERAL*\n\n${lines.join("\n")}`;
  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
}

async function enviarSubmenuInventario(chatId, plataforma, correo) {
  return mostrarPanelCorreo(chatId, plataforma, correo);
}

// ===============================
// CORREO / PANEL / CLIENTES EN CORREO
// ===============================
async function buscarCorreoInventarioPorPlatCorreo(plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  const directRef = db.collection("inventario").doc(docIdInventario(mail, plat));
  const directSnap = await directRef.get();

  if (directSnap.exists) {
    return {
      id: directSnap.id,
      ref: directRef,
      data: directSnap.data() || {},
    };
  }

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", plat)
    .where("correo", "==", mail)
    .limit(1)
    .get();

  if (!snap.empty) {
    const d = snap.docs[0];
    return {
      id: d.id,
      ref: d.ref,
      data: d.data() || {},
    };
  }

  return null;
}

async function mostrarListaCorreosPlataforma(chatId, plataforma) {
  const plat = normalizarPlataforma(plataforma);

  const snap = await db.collection("inventario").where("plataforma", "==", plat).limit(500).get();

  if (snap.empty) {
    return upsertPanel(
      chatId,
      `📭 *${escMD(String(plat).toUpperCase())}*\n\nNo hay correos registrados en esta plataforma.`,
      {
        inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]],
      },
      "Markdown"
    );
  }

  const docs = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() || {}),
  }));

  docs.sort((a, b) => {
    const aCorreo = String(a.correo || "").toLowerCase();
    const bCorreo = String(b.correo || "").toLowerCase();
    return aCorreo.localeCompare(bCorreo);
  });

  let txt = `📂 *${escMD(String(plat).toUpperCase())}*\n\n`;
  txt += "Seleccione un correo:\n";

  const kb = docs.map((item) => {
    const clientes = Array.isArray(item.clientes) ? item.clientes : [];
    const capacidad = getCapacidadCorreo(item, plat);
    const ocupados = clientes.length;
    const disponibles = Math.max(0, capacidad - ocupados);
    const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

    return [
      {
        text: safeBtnLabel(`${item.correo || "correo"} | ${ocupados}/${capacidad} | ${estado}`, 60),
        callback_data: `mail_panel|${plat}|${encodeURIComponent(item.correo || "")}`,
      },
    ];
  });

  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

async function mostrarMenuClientesCorreo(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  return upsertPanel(
    chatId,
    "👥 *CLIENTES*\n\nSeleccione una opción:",
    {
      inline_keyboard: [
        [{ text: "👥 Ver clientes", callback_data: `mail_ver_clientes|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "➕ Agregar cliente", callback_data: `mail_add_cliente|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "➖ Quitar cliente", callback_data: `mail_del_cliente|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🔐 Editar PIN", callback_data: `mail_edit_pin|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "✏️ Editar clave del correo", callback_data: `mail_edit_clave|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "⬅️ Volver al correo", callback_data: `mail_panel|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

async function mostrarMenuCodigosNetflix(chatId, plataforma, correo) {
  return responderMenuCodigosNetflix(chatId, plataforma, correo);
}

async function mostrarPanelCorreo(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  const found = await buscarCorreoInventarioPorPlatCorreo(plat, mail);
  if (!found) {
    return bot.sendMessage(chatId, "❌ Este correo no existe.");
  }

  const data = found.data || {};
  const clientes = Array.isArray(data.clientes) ? data.clientes : [];
  const capacidad = getCapacidadCorreo(data, plat);

  const ocupados = clientes.length;
  const disponibles = Math.max(0, capacidad - ocupados);
  const estadoDb = disponibles === 0 ? "llena" : "activa";
  const estadoView = disponibles === 0 ? "LLENA" : "CON ESPACIO";

  if (
    Number(data.disp || 0) !== disponibles ||
    String(data.estado || "") !== estadoDb ||
    Number(data.ocupados || 0) !== ocupados ||
    Number(data.disponibles || 0) !== disponibles ||
    Number(data.capacidad || 0) !== capacidad
  ) {
    await found.ref.set(
      {
        ocupados,
        disponibles,
        disp: disponibles,
        estado: estadoDb,
        capacidad,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  let txt = "";
  txt += `📧 *${escMD(mail)}*\n`;
  txt += `${escMD(String(plat).toUpperCase())}\n\n`;
  txt += `👤 *Ocupados:* ${ocupados}/${capacidad}\n`;
  txt += `✅ *Disponibles:* ${disponibles}\n`;
  txt += `📊 *Estado:* ${escMD(estadoView)}`;

  const kb = [
    [{ text: "👥 CLIENTES", callback_data: `mail_menu_clientes|${plat}|${encodeURIComponent(mail)}` }],
  ];

  if (plat === "netflix" || plat === "vipnetflix") {
    kb.push([{ text: "🎬 CÓDIGOS NETFLIX", callback_data: `mail_menu_codigos|${plat}|${encodeURIComponent(mail)}` }]);
  }

  kb.push([{ text: "🗑️ Borrar correo", callback_data: `mail_delete|${plat}|${encodeURIComponent(mail)}` }]);
  kb.push([{ text: "⬅️ Volver Inventario", callback_data: `inv:${plat}:0` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

// ===============================
// HELPERS CÓDIGOS NETFLIX
// ===============================
function tsToMillisNetflix(v) {
  try {
    if (!v) return 0;
    if (typeof v?.toDate === "function") return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch (_) {
    return 0;
  }
}

async function obtenerUltimoCodigoNetflix(correo, tipo) {
  const mail = String(correo || "").trim().toLowerCase();
  if (!mail || !tipo) return null;

  let snap = null;

  try {
    snap = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .where("tipo", "==", tipo)
      .orderBy("fecha", "desc")
      .limit(1)
      .get();
  } catch (_) {
    const alt = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .where("tipo", "==", tipo)
      .limit(50)
      .get();

    const docs = alt.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => {
        const fa = tsToMillisNetflix(a.fecha || a.createdAt || a.updatedAt);
        const fb = tsToMillisNetflix(b.fecha || b.createdAt || b.updatedAt);
        return fb - fa;
      });

    return docs.length ? docs[0] : null;
  }

  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() || {}) };
}

async function obtenerUltimoCodigoNetflixGeneral(correo) {
  const mail = String(correo || "").trim().toLowerCase();
  if (!mail) return null;

  let snap = null;

  try {
    snap = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .orderBy("fecha", "desc")
      .limit(1)
      .get();
  } catch (_) {
    const alt = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .limit(50)
      .get();

    const docs = alt.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => {
        const fa = tsToMillisNetflix(a.fecha || a.createdAt || a.updatedAt);
        const fb = tsToMillisNetflix(b.fecha || b.createdAt || b.updatedAt);
        return fb - fa;
      });

    return docs.length ? docs[0] : null;
  }

  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() || {}) };
}

function labelTipoCodigoNetflix(tipo = "") {
  const t = String(tipo || "").toLowerCase();
  if (t === "signin") return "🔐 Inicio sesión";
  if (t === "temporal") return "⏳ Código temporal";
  if (t === "hogar") return "🏠 Código hogar";
  if (t === "verification") return "✅ Verificación";
  return "📩 Código";
}

function fmtFechaCodigoNetflix(fecha) {
  if (!fecha) return "-";

  try {
    let dt = null;

    if (typeof fecha?.toDate === "function") {
      dt = fecha.toDate();
    } else if (fecha instanceof Date) {
      dt = fecha;
    } else {
      dt = new Date(fecha);
    }

    if (isNaN(dt.getTime())) return String(fecha);

    return new Intl.DateTimeFormat("es-HN", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(dt);
  } catch (_) {
    return String(fecha);
  }
}

async function marcarCodigoNetflixUsado(docId) {
  if (!docId) return;
  try {
    await db.collection("codigos_netflix").doc(String(docId)).set(
      {
        usado: true,
        usadoAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    logErr("Error marcando codigo usado:", e?.message || e);
  }
}

async function responderCodigoNetflix(chatId, correo, tipo) {
  const mail = String(correo || "").trim().toLowerCase();

  let data = null;
  if (tipo === "ultimo") {
    data = await obtenerUltimoCodigoNetflixGeneral(mail);
  } else {
    data = await obtenerUltimoCodigoNetflix(mail, tipo);
  }

  if (!data) {
    return bot.sendMessage(
      chatId,
      `🎬 *CÓDIGOS NETFLIX*\n\n📧 *${escMD(mail)}*\n🧩 *Tipo:* ${escMD(
        tipo === "ultimo" ? "último disponible" : tipo
      )}\n\n⚠️ No encontré códigos disponibles.`,
      { parse_mode: "Markdown" }
    );
  }

  const tipoReal = String(data.tipo || tipo || "ultimo").toLowerCase();
  const codigo = String(data.codigo || "").trim();
  const fuente = String(data.fuente || "-").trim();
  const fechaFmt = fmtFechaCodigoNetflix(data.fecha || data.createdAt || data.updatedAt);
  const usado = data.usado === true ? "Sí" : "No";

  let txt = "🎬 *CÓDIGOS NETFLIX*\n\n";
  txt += `📧 *${escMD(mail)}*\n`;
  txt += `🧩 *Tipo:* ${escMD(labelTipoCodigoNetflix(tipoReal))}\n`;
  txt += `🔢 *Código:* \`${codigo || "-"}\`\n`;
  txt += `🕒 *Fecha:* ${escMD(fechaFmt)}\n`;
  txt += `📥 *Fuente:* ${escMD(fuente || "-")}\n`;
  txt += `✅ *Usado:* ${escMD(usado)}`;

  await bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });

  if (data.id) {
    await marcarCodigoNetflixUsado(data.id);
  }
}

async function responderMenuCodigosNetflix(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  if (plat !== "netflix" && plat !== "vipnetflix") {
    return bot.sendMessage(chatId, "⚠️ Este menú de códigos solo aplica para Netflix.");
  }

  return upsertPanel(
    chatId,
    "🎬 *CÓDIGOS NETFLIX*\n\nSeleccione una opción:",
    {
      inline_keyboard: [
        [{ text: "📩 Último código", callback_data: `nf_code|ultimo|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "🔐 Inicio sesión", callback_data: `nf_code|signin|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "⏳ Código temporal", callback_data: `nf_code|temporal|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "🏠 Código hogar", callback_data: `nf_code|hogar|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "✅ Verificación", callback_data: `nf_code|verification|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "⬅️ Volver al correo", callback_data: `mail_panel|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  buscarInventarioPorCorreo,
  getCapacidadCorreo,
  aplicarAutoLleno,
  inventarioPlataformaTexto,
  enviarInventarioPlataforma,
  mostrarStockGeneral,
  enviarSubmenuInventario,

  buscarCorreoInventarioPorPlatCorreo,
  mostrarListaCorreosPlataforma,
  mostrarMenuClientesCorreo,
  mostrarMenuCodigosNetflix,
  mostrarPanelCorreo,

  tsToMillisNetflix,
  obtenerUltimoCodigoNetflix,
  obtenerUltimoCodigoNetflixGeneral,
  labelTipoCodigoNetflix,
  fmtFechaCodigoNetflix,
  marcarCodigoNetflixUsado,
  responderCodigoNetflix,
  responderMenuCodigosNetflix,
};
/* ✅ SUBLICUENTAS TG BOT — PARTE 5/6
   FINANZAS / REPORTES / EXCEL / MENÚS
   -----------------------------------
*/

const {
  bot,
  admin,
  db,
  ExcelJS,
  PLATAFORMAS,
  FINANZAS_COLLECTION,
  FIN_BANCOS,
  FIN_MOTIVOS_EGRESO,
} = require("./index_01_core");

const {
  escMD,
  upsertPanel,
  sendCommandAnchoredPanel,
  parseFechaFinanceInput,
  parseMontoNumber,
  parseMonthInputToKey,
  getMonthLabelFromKey,
  getMonthKeyFromDMY,
  startOfDayTS,
  endOfDayTS,
  ymdFromDMY,
  isFechaDMY,
  hoyDMY,
  moneyLps,
  moneyNumber,
  logErr,
  isSuperAdmin,
} = require("./index_02_utils_roles");

const { humanPlataforma } = require("./index_03_clientes_crm");

// ===============================
// MENÚS PRINCIPALES
// ===============================
async function menuPrincipal(chatId) {
  return upsertPanel(chatId, "📌 *MENÚ PRINCIPAL*", {
    inline_keyboard: [
      [{ text: "📦 Inventario", callback_data: "menu:inventario" }],
      [{ text: "👥 Clientes", callback_data: "menu:clientes" }],
      [{ text: "💳 Pagos", callback_data: "menu:pagos" }],
      [{ text: "📅 Renovaciones", callback_data: "menu:renovaciones" }],
      [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
    ],
  });
}

async function menuPrincipalFromCommand(msg) {
  return sendCommandAnchoredPanel(
    msg,
    "📌 *MENÚ PRINCIPAL*",
    {
      inline_keyboard: [
        [{ text: "📦 Inventario", callback_data: "menu:inventario" }],
        [{ text: "👥 Clientes", callback_data: "menu:clientes" }],
        [{ text: "💳 Pagos", callback_data: "menu:pagos" }],
        [{ text: "📅 Renovaciones", callback_data: "menu:renovaciones" }],
        [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
      ],
    },
    "Markdown"
  );
}

async function menuVendedor(chatId) {
  return upsertPanel(
    chatId,
    "👤 *MENÚ VENDEDOR*\n\nFunciones disponibles:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
    {
      inline_keyboard: [
        [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
        [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
        [{ text: "👥 Mis clientes", callback_data: "vend:clientes" }],
        [{ text: "📄 TXT Mis clientes", callback_data: "vend:clientes:txt" }],
      ],
    }
  );
}

async function menuVendedorFromCommand(msg) {
  return sendCommandAnchoredPanel(
    msg,
    "👤 *MENÚ VENDEDOR*\n\nFunciones disponibles:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
    {
      inline_keyboard: [
        [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
        [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
        [{ text: "👥 Mis clientes", callback_data: "vend:clientes" }],
        [{ text: "📄 TXT Mis clientes", callback_data: "vend:clientes:txt" }],
      ],
    },
    "Markdown"
  );
}

async function menuInventario(chatId) {
  return upsertPanel(chatId, "📦 *INVENTARIO* (elija plataforma)", {
    inline_keyboard: [
      [
        { text: "📺 Netflix", callback_data: "inv:netflix:0" },
        { text: "🔥 VIP Netflix", callback_data: "inv:vipnetflix:0" },
      ],
      [
        { text: "🏰 Disney Premium", callback_data: "inv:disneyp:0" },
        { text: "🎞️ Disney Standard", callback_data: "inv:disneys:0" },
      ],
      [
        { text: "🍿 HBO Max", callback_data: "inv:hbomax:0" },
        { text: "🎥 Prime Video", callback_data: "inv:primevideo:0" },
      ],
      [
        { text: "📀 Paramount+", callback_data: "inv:paramount:0" },
        { text: "🍥 Crunchyroll", callback_data: "inv:crunchyroll:0" },
      ],
      [
        { text: "🎬 Vix", callback_data: "inv:vix:0" },
        { text: "🍎 Apple TV", callback_data: "inv:appletv:0" },
      ],
      [
        { text: "🌎 Universal", callback_data: "inv:universal:0" },
        { text: "▶️ YouTube", callback_data: "inv:youtube:0" },
      ],
      [
        { text: "🎵 Spotify", callback_data: "inv:spotify:0" },
        { text: "🎨 Canva", callback_data: "inv:canva:0" },
      ],
      [
        { text: "🌊 OleadaTV (1)", callback_data: "inv:oleadatv1:0" },
        { text: "🌊 OleadaTV (3)", callback_data: "inv:oleadatv3:0" },
      ],
      [
        { text: "📡 IPTV (1)", callback_data: "inv:iptv1:0" },
        { text: "📡 IPTV (3)", callback_data: "inv:iptv3:0" },
      ],
      [{ text: "📡 IPTV (4)", callback_data: "inv:iptv4:0" }],
      [{ text: "📦 Stock General", callback_data: "inv:general" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  });
}

async function menuClientes(chatId) {
  return upsertPanel(
    chatId,
    "👥 *CLIENTES*\n\n• Nuevo cliente (wizard)\n• Buscar (abre ficha)\n• TXT General (Nombre | Tel)\n• TXT 1 por vendedor\n\n💡 Tip:\nEscriba: */NOMBRE* o */TELEFONO* para abrir listado.",
    {
      inline_keyboard: [
        [{ text: "➕ Nuevo cliente", callback_data: "cli:wiz:start" }],
        [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
        [{ text: "📄 TXT General", callback_data: "cli:txt:general" }],
        [{ text: "📄 TXT 1 por vendedor", callback_data: "cli:txt:vendedores_split" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    }
  );
}

async function menuRenovaciones(chatId, userIdOpt) {
  const isSA = userIdOpt ? await isSuperAdmin(userIdOpt) : false;

  const kb = [
    [{ text: "📅 Renovaciones hoy", callback_data: "ren:hoy" }],
    [{ text: "📄 TXT hoy", callback_data: "txt:hoy" }],
    [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
    [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
    [{ text: "👤 Revendedores (lista)", callback_data: "rev:lista" }],
  ];

  if (isSA) kb.push([{ text: "📬 Enviar TXT a TODOS (HOY)", callback_data: "txt:todos:hoy" }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(
    chatId,
    "📅 *RENOVACIONES*\n\nComandos:\n• /renovaciones hoy\n• /renovaciones dd/mm/yyyy\n• /renovaciones VENDEDOR dd/mm/yyyy\n\nTXT:\n• /txt hoy\n• /txt dd/mm/yyyy\n• /txt VENDEDOR dd/mm/yyyy\n\n✅ Nota:\n• *Enviar TXT a TODOS (HOY)* solo SUPERADMIN.\n",
    { inline_keyboard: kb }
  );
}

// ===============================
// MENÚS FINANZAS
// ===============================
async function menuPagos(chatId) {
  return upsertPanel(
    chatId,
    "💳 *FINANZAS V13 PRO*\n\nSeleccione una opción:",
    {
      inline_keyboard: [
        [{ text: "📝 Registro", callback_data: "fin:menu:registro" }],
        [{ text: "📊 Reportes", callback_data: "fin:menu:reportes" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

async function menuFinRegistro(chatId) {
  return upsertPanel(
    chatId,
    "📝 *REGISTRO FINANCIERO*\n\nSeleccione una opción:",
    {
      inline_keyboard: [
        [{ text: "➕ Registrar ingreso", callback_data: "fin:menu:ingreso" }],
        [{ text: "➖ Registrar egreso", callback_data: "fin:menu:egreso" }],
        [{ text: "🗑️ Eliminar movimiento específico", callback_data: "fin:menu:eliminar" }],
        [{ text: "🧾 Cierre de caja", callback_data: "fin:menu:cierre" }],
        [{ text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

async function menuFinEliminarTipo(chatId) {
  return upsertPanel(
    chatId,
    "🗑️ *ELIMINAR MOVIMIENTO ESPECÍFICO*\n\nSeleccione qué desea listar para eliminar.\nLuego podrá escoger *un solo registro exacto* por fecha:",
    {
      inline_keyboard: [
        [{ text: "➕ Ver ingresos", callback_data: "fin:menu:eliminar:ingreso" }],
        [{ text: "➖ Ver egresos", callback_data: "fin:menu:eliminar:egreso" }],
        [{ text: "⬅️ Volver Registro", callback_data: "fin:menu:registro" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

async function menuFinReportes(chatId) {
  return upsertPanel(
    chatId,
    "📊 *REPORTES FINANCIEROS*\n\nSeleccione una opción:",
    {
      inline_keyboard: [
        [{ text: "📊 Resumen por fecha", callback_data: "fin:menu:resumen_fecha" }],
        [{ text: "🏦 Resumen por banco del mes", callback_data: "fin:menu:bancos_mes" }],
        [{ text: "🏆 Top plataformas del mes", callback_data: "fin:menu:top_plataformas" }],
        [{ text: "📤 Exportar Excel PRO", callback_data: "fin:menu:excel_rango" }],
        [{ text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

// ===============================
// HELPERS FINANZAS BASE
// ===============================
function getFinBancos() {
  return Array.isArray(global.FIN_BANCOS) && global.FIN_BANCOS.length
    ? global.FIN_BANCOS
    : FIN_BANCOS;
}

function getFinMotivosEgreso() {
  return Array.isArray(global.FIN_MOTIVOS_EGRESO) && global.FIN_MOTIVOS_EGRESO.length
    ? global.FIN_MOTIVOS_EGRESO
    : FIN_MOTIVOS_EGRESO;
}

function getFinPlataformasIngreso() {
  return PLATAFORMAS.slice();
}

function kbBancosFinanzas() {
  const bancos = getFinBancos();
  const rows = [];
  for (let i = 0; i < bancos.length; i += 2) {
    const row = [];
    row.push({ text: bancos[i], callback_data: `fin:ing:banco:${encodeURIComponent(bancos[i])}` });
    if (bancos[i + 1]) {
      row.push({ text: bancos[i + 1], callback_data: `fin:ing:banco:${encodeURIComponent(bancos[i + 1])}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return { inline_keyboard: rows };
}

function kbMotivosFinanzas() {
  const motivos = getFinMotivosEgreso();
  const rows = [];
  for (let i = 0; i < motivos.length; i += 2) {
    const row = [];
    row.push({ text: motivos[i], callback_data: `fin:egr:motivo:${encodeURIComponent(motivos[i])}` });
    if (motivos[i + 1]) {
      row.push({ text: motivos[i + 1], callback_data: `fin:egr:motivo:${encodeURIComponent(motivos[i + 1])}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return { inline_keyboard: rows };
}

// ===============================
// HELPERS PLATAFORMAS MANUALES
// ===============================
function splitPlataformasManual(input = "") {
  return String(input || "")
    .split(/\n|,|;|\+|\/|\|/g)
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function normalizarCategoriaPlataforma(txt = "") {
  const s = String(txt || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

  if (!s) return "";
  if (s.includes("netflix")) return "netflix";
  if (s.includes("disney")) return "disney";
  if (s.includes("hbo") || s.includes("max")) return "hbomax";
  if (s.includes("prime")) return "primevideo";
  if (s.includes("oleada")) return "oleada";
  if (s.includes("spotify")) return "spotify";
  if (s.includes("vix")) return "vix";
  if (s.includes("crunchy")) return "crunchyroll";
  if (s.includes("paramount")) return "paramount";
  if (s.includes("apple")) return "appletv";
  if (s.includes("youtube")) return "youtube";
  if (s.includes("universal")) return "universal";
  if (s.includes("canva")) return "canva";
  if (s.includes("iptv")) return "iptv";
  return s;
}

function humanCategoriaPlataforma(cat = "") {
  const c = String(cat || "").trim();
  const map = {
    netflix: "Netflix",
    disney: "Disney",
    hbomax: "HBO Max",
    primevideo: "Prime Video",
    oleada: "Oleada",
    spotify: "Spotify",
    vix: "Vix",
    crunchyroll: "Crunchyroll",
    paramount: "Paramount+",
    appletv: "Apple TV",
    youtube: "YouTube",
    universal: "Universal+",
    canva: "Canva",
    iptv: "IPTV",
  };
  return map[c] || c || "-";
}

function getCategoriasPlataformasDesdeTexto(plataformaRaw = "") {
  const items = splitPlataformasManual(plataformaRaw);
  const cats = items
    .map((x) => normalizarCategoriaPlataforma(x))
    .filter(Boolean);

  return Array.from(new Set(cats));
}

// ===============================
// REGISTROS FINANZAS
// ===============================
async function registrarIngresoTx({
  monto,
  banco,
  fecha,
  userId,
  userName = "",
  plataforma = "",
  detalle = "",
  vendedor = "",
  cliente = "",
}) {
  const parsed = parseFechaFinanceInput(fecha);
  if (!parsed.ok) throw new Error("Fecha inválida");

  const nMonto = parseMontoNumber(monto);
  if (!Number.isFinite(nMonto) || nMonto <= 0) throw new Error("Monto inválido");

  const plataformasArray = getCategoriasPlataformasDesdeTexto(plataforma);
  const ref = db.collection(FINANZAS_COLLECTION).doc();

  await ref.set({
    tipo: "ingreso",
    monto: Number(nMonto),
    banco: String(banco || "Otro").trim(),
    motivo: "",
    detalle: String(detalle || "").trim(),
    plataforma: String(plataforma || "").trim(),
    plataformas: plataformasArray,
    vendedor: String(vendedor || "").trim(),
    cliente: String(cliente || "").trim(),
    fecha: parsed.fecha,
    fechaTS: parsed.fechaTS,
    mesKey: parsed.mesKey,
    createdBy: String(userId),
    createdByName: String(userName || "").trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    id: ref.id,
    fecha: parsed.fecha,
    monto: nMonto,
    banco: banco || "Otro",
    plataforma: String(plataforma || "").trim(),
    plataformas: plataformasArray,
    detalle: String(detalle || "").trim(),
  };
}

async function registrarEgresoTx({
  monto,
  motivo,
  fecha,
  userId,
  userName = "",
  detalle = "",
  vendedor = "",
  cliente = "",
}) {
  const parsed = parseFechaFinanceInput(fecha);
  if (!parsed.ok) throw new Error("Fecha inválida");

  const nMonto = parseMontoNumber(monto);
  if (!Number.isFinite(nMonto) || nMonto <= 0) throw new Error("Monto inválido");

  const ref = db.collection(FINANZAS_COLLECTION).doc();

  await ref.set({
    tipo: "egreso",
    monto: Number(nMonto),
    banco: "",
    motivo: String(motivo || "Otros").trim(),
    detalle: String(detalle || "").trim(),
    plataforma: "",
    plataformas: [],
    vendedor: String(vendedor || "").trim(),
    cliente: String(cliente || "").trim(),
    fecha: parsed.fecha,
    fechaTS: parsed.fechaTS,
    mesKey: parsed.mesKey,
    createdBy: String(userId),
    createdByName: String(userName || "").trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    id: ref.id,
    fecha: parsed.fecha,
    monto: nMonto,
    motivo: motivo || "Otros",
    detalle: String(detalle || "").trim(),
  };
}

// ===============================
// CONSULTAS FINANZAS
// ===============================
async function getMovimientosPorFecha(fechaDMY, userId, isSA = false) {
  const ini = startOfDayTS(fechaDMY);
  const fin = endOfDayTS(fechaDMY);

  const snap = await db
    .collection(FINANZAS_COLLECTION)
    .where("fechaTS", ">=", ini)
    .where("fechaTS", "<=", fin)
    .get();

  const movs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  movs.sort((a, b) => {
    const ta = Number(a.fechaTS || 0);
    const tb = Number(b.fechaTS || 0);
    if (ta !== tb) return ta - tb;
    return String(a.tipo || "").localeCompare(String(b.tipo || ""));
  });

  return movs;
}

async function getMovimientosPorMes(monthKey, userId, isSA = false) {
  const snap = await db.collection(FINANZAS_COLLECTION).where("mesKey", "==", monthKey).get();

  const movs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  movs.sort((a, b) => Number(a.fechaTS || 0) - Number(b.fechaTS || 0));
  return movs;
}

function agruparIngresosPorBanco(movs = []) {
  const map = new Map();
  for (const m of movs) {
    if (String(m.tipo || "") !== "ingreso") continue;
    const banco = String(m.banco || "Otro").trim() || "Otro";
    map.set(banco, Number(map.get(banco) || 0) + Number(m.monto || 0));
  }
  return Array.from(map.entries())
    .map(([banco, monto]) => ({ banco, monto }))
    .sort((a, b) => b.monto - a.monto);
}

function agruparIngresosPorPlataforma(movs = []) {
  const map = new Map();

  for (const m of movs) {
    if (String(m.tipo || "") !== "ingreso") continue;

    let cats = Array.isArray(m.plataformas) ? m.plataformas.filter(Boolean) : [];
    if (!cats.length && m.plataforma) {
      cats = getCategoriasPlataformasDesdeTexto(m.plataforma);
    }
    if (!cats.length) continue;

    const monto = Number(m.monto || 0);
    const reparto = cats.length > 0 ? monto / cats.length : 0;

    for (const cat of cats) {
      map.set(cat, Number(map.get(cat) || 0) + reparto);
    }
  }

  return Array.from(map.entries())
    .map(([plataforma, monto]) => ({ plataforma, monto }))
    .sort((a, b) => b.monto - a.monto);
}

function agruparEgresosPorMotivo(movs = []) {
  const map = new Map();
  for (const m of movs) {
    if (String(m.tipo || "") !== "egreso") continue;
    const motivo = String(m.motivo || "Otros").trim() || "Otros";
    map.set(motivo, Number(map.get(motivo) || 0) + Number(m.monto || 0));
  }
  return Array.from(map.entries())
    .map(([motivo, monto]) => ({ motivo, monto }))
    .sort((a, b) => b.monto - a.monto);
}

function calcularTotalesMovimientos(movs = []) {
  let ingresos = 0;
  let egresos = 0;
  for (const m of movs) {
    if (String(m.tipo || "") === "ingreso") ingresos += Number(m.monto || 0);
    if (String(m.tipo || "") === "egreso") egresos += Number(m.monto || 0);
  }
  const neta = ingresos - egresos;
  return { ingresos, egresos, neta };
}

// ===============================
// TEXTOS FINANZAS
// ===============================
function resumenFinanzasTextoPorFecha(fechaDMY, movs = []) {
  const { ingresos, egresos, neta } = calcularTotalesMovimientos(movs);

  let txt = `📊 *ESTADO DE RESULTADOS (${escMD(fechaDMY)})*\n\n`;

  if (!movs.length) {
    txt += "⚠️ No hay movimientos registrados.\n\n";
    txt += `💰 *INGRESOS:* ${moneyLps(0)}\n`;
    txt += `💸 *EGRESOS:* ${moneyLps(0)}\n`;
    txt += `📈 *GANANCIA NETA:* ${moneyLps(0)}\n`;
    return txt;
  }

  txt += "*MOVIMIENTOS DEL DÍA*\n\n";

  movs.forEach((m, i) => {
    const esIngreso = String(m.tipo || "") === "ingreso";
    const signo = esIngreso ? "+" : "-";
    const bancoOMotivo = esIngreso
      ? String(m.banco || "Sin banco")
      : String(m.motivo || "Sin motivo");

    const concepto = esIngreso
      ? String(m.plataforma || m.detalle || "-")
      : String(m.detalle || m.motivo || "-");

    const usuario = String(m.createdByName || m.createdBy || "Admin");

    txt += `${i + 1}) ${signo} *Lps ${Number(m.monto || 0)}* ${escMD(concepto)} — ${escMD(usuario)} — ${escMD(bancoOMotivo)}\n`;
  });

  txt += "\n━━━━━━━━━━━━━━\n";
  txt += `💰 *INGRESOS:* ${moneyLps(ingresos)}\n`;
  txt += `💸 *EGRESOS:* ${moneyLps(egresos)}\n`;
  txt += `📈 *GANANCIA NETA:* ${neta >= 0 ? "+" : ""}${moneyLps(neta)} ${neta >= 0 ? "🟢" : "🔴"}\n`;
  txt += `🧾 *Movimientos:* ${movs.length}`;

  return txt;
}

function resumenBancosMesTexto(monthKey, movs = []) {
  const bancos = agruparIngresosPorBanco(movs);
  const total = bancos.reduce((a, b) => a + Number(b.monto || 0), 0);

  let txt = `🏦 *RESUMEN POR BANCO DEL MES ${escMD(getMonthLabelFromKey(monthKey))}*\n\n`;

  if (!bancos.length) {
    txt += "⚠️ No hay ingresos registrados en ese mes.";
    return txt;
  }

  const top = bancos[0];
  txt += `🥇 *BANCO CON MÁS DINERO:* ${escMD(top.banco)} — ${moneyLps(top.monto)}\n\n`;

  bancos.forEach((x, i) => {
    txt += `${i + 1}) *${escMD(x.banco)}* — ${moneyLps(x.monto)}\n`;
  });

  txt += "\n━━━━━━━━━━━━━━\n";
  txt += `💰 *Total ingresos del mes:* ${moneyLps(total)}`;
  return txt;
}

function resumenTopPlataformasTexto(monthKey, movs = []) {
  const plataformas = agruparIngresosPorPlataforma(movs).slice(0, 10);

  let txt = `🏆 *TOP 10 PLATAFORMAS VENDIDAS — ${escMD(getMonthLabelFromKey(monthKey))}*\n\n`;

  if (!plataformas.length) {
    txt += "⚠️ No hay ingresos con plataforma registrada en ese mes.";
    return txt;
  }

  plataformas.forEach((x, i) => {
    txt += `${i + 1}) ${escMD(humanCategoriaPlataforma(x.plataforma))} — ${moneyLps(x.monto)}\n`;
  });

  return txt;
}

function cierreCajaTexto(fechaDMY, movs = []) {
  const { ingresos, egresos, neta } = calcularTotalesMovimientos(movs);
  let txt = `🧾 *CIERRE DE CAJA (${escMD(fechaDMY)})*\n\n`;
  txt += `💰 Entradas: ${moneyLps(ingresos)}\n`;
  txt += `💸 Salidas: ${moneyLps(egresos)}\n`;
  txt += `📦 Caja final: ${neta >= 0 ? "+" : ""}${moneyLps(neta)} ${neta >= 0 ? "🟢" : "🔴"}\n`;
  txt += `🧮 Movimientos: ${movs.length}`;
  return txt;
}

async function eliminarMovimientoFinanzas(id, userId, isSA = false) {
  const ref = db.collection(FINANZAS_COLLECTION).doc(String(id));
  const doc = await ref.get();

  if (!doc.exists) throw new Error("Movimiento no encontrado");

  const data = doc.data() || {};
  await ref.delete();

  return {
    id: doc.id,
    ...data,
  };
}

// ===============================
// EXPORTAR EXCEL PRO
// ===============================
async function exportarFinanzasRangoExcel(chatId, fechaInicio, fechaFin, userId, isSA = false) {
  if (!ExcelJS) {
    return bot.sendMessage(chatId, "⚠️ ExcelJS no está instalado en el servidor.");
  }

  if (!isFechaDMY(fechaInicio) || !isFechaDMY(fechaFin)) {
    return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");
  }

  const ini = startOfDayTS(fechaInicio);
  const fin = endOfDayTS(fechaFin);

  if (ini > fin) {
    return bot.sendMessage(chatId, "⚠️ El rango es inválido.");
  }

  const snap = await db
    .collection(FINANZAS_COLLECTION)
    .where("fechaTS", ">=", ini)
    .where("fechaTS", "<=", fin)
    .get();

  const movs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  movs.sort((a, b) => Number(a.fechaTS || 0) - Number(b.fechaTS || 0));

  if (!movs.length) {
    return bot.sendMessage(chatId, "⚠️ No hay movimientos en ese rango.");
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sublicuentas Bot";
  workbook.created = new Date();
  workbook.modified = new Date();

  const wsMov = workbook.addWorksheet("Movimientos", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  wsMov.columns = [
    { header: "Fecha", key: "fecha", width: 14 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Monto", key: "monto", width: 14 },
    { header: "Banco", key: "banco", width: 18 },
    { header: "Motivo", key: "motivo", width: 22 },
    { header: "Plataforma", key: "plataforma", width: 24 },
    { header: "Detalle", key: "detalle", width: 36 },
    { header: "Usuario", key: "usuario", width: 18 },
    { header: "Cliente", key: "cliente", width: 22 },
    { header: "ID", key: "id", width: 28 },
  ];

  wsMov.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  wsMov.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };
  wsMov.getRow(1).alignment = { horizontal: "center", vertical: "middle" };

  movs.forEach((m) => {
    const row = wsMov.addRow({
      fecha: m.fecha || "",
      tipo: String(m.tipo || "").toUpperCase(),
      monto: Number(m.monto || 0),
      banco: m.banco || "",
      motivo: m.motivo || "",
      plataforma: m.plataforma || "",
      detalle: m.detalle || "",
      usuario: m.createdByName || m.createdBy || "",
      cliente: m.cliente || "",
      id: m.id || "",
    });

    row.getCell("monto").numFmt = "#,##0.00";

    if (String(m.tipo || "") === "ingreso") {
      row.getCell("tipo").font = { bold: true, color: { argb: "FF008000" } };
    } else {
      row.getCell("tipo").font = { bold: true, color: { argb: "FFFF0000" } };
    }
  });

  const { ingresos, egresos, neta } = calcularTotalesMovimientos(movs);

  const wsRes = workbook.addWorksheet("Resumen", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  wsRes.columns = [
    { header: "Concepto", key: "concepto", width: 28 },
    { header: "Monto", key: "monto", width: 18 },
  ];

  wsRes.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  wsRes.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };

  wsRes.addRow({ concepto: "Ingresos", monto: ingresos });
  wsRes.addRow({ concepto: "Egresos", monto: egresos });
  wsRes.addRow({ concepto: "Ganancia neta", monto: neta });
  wsRes.getColumn("monto").numFmt = "#,##0.00";

  const wsBancos = workbook.addWorksheet("Bancos", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  wsBancos.columns = [
    { header: "Banco", key: "banco", width: 24 },
    { header: "Monto", key: "monto", width: 18 },
  ];

  wsBancos.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  wsBancos.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };

  const bancos = agruparIngresosPorBanco(movs);
  bancos.forEach((x) => {
    wsBancos.addRow({
      banco: x.banco,
      monto: Number(x.monto || 0),
    });
  });
  wsBancos.getColumn("monto").numFmt = "#,##0.00";

  const wsTop = workbook.addWorksheet("Top Plataformas", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  wsTop.columns = [
    { header: "Plataforma", key: "plataforma", width: 26 },
    { header: "Monto", key: "monto", width: 18 },
  ];

  wsTop.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  wsTop.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };

  const topPlats = agruparIngresosPorPlataforma(movs);
  topPlats.forEach((x) => {
    wsTop.addRow({
      plataforma: humanCategoriaPlataforma(x.plataforma),
      monto: Number(x.monto || 0),
    });
  });
  wsTop.getColumn("monto").numFmt = "#,##0.00";

  const wsEgr = workbook.addWorksheet("Egresos por Motivo", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  wsEgr.columns = [
    { header: "Motivo", key: "motivo", width: 28 },
    { header: "Monto", key: "monto", width: 18 },
  ];

  wsEgr.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  wsEgr.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };

  const egresosMot = agruparEgresosPorMotivo(movs);
  egresosMot.forEach((x) => {
    wsEgr.addRow({
      motivo: x.motivo,
      monto: Number(x.monto || 0),
    });
  });
  wsEgr.getColumn("monto").numFmt = "#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();

  return bot.sendDocument(chatId, Buffer.from(buffer), {}, {
    filename: `finanzas_pro_${ymdFromDMY(fechaInicio)}_a_${ymdFromDMY(fechaFin)}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  menuPrincipal,
  menuPrincipalFromCommand,
  menuVendedor,
  menuVendedorFromCommand,
  menuInventario,
  menuClientes,
  menuRenovaciones,

  menuPagos,
  menuFinRegistro,
  menuFinEliminarTipo,
  menuFinReportes,

  getFinBancos,
  getFinMotivosEgreso,
  getFinPlataformasIngreso,
  kbBancosFinanzas,
  kbMotivosFinanzas,

  splitPlataformasManual,
  normalizarCategoriaPlataforma,
  humanCategoriaPlataforma,
  getCategoriasPlataformasDesdeTexto,

  registrarIngresoTx,
  registrarEgresoTx,

  getMovimientosPorFecha,
  getMovimientosPorMes,
  agruparIngresosPorBanco,
  agruparIngresosPorPlataforma,
  agruparEgresosPorMotivo,
  calcularTotalesMovimientos,

  resumenFinanzasTextoPorFecha,
  resumenBancosMesTexto,
  resumenTopPlataformasTexto,
  cierreCajaTexto,
  eliminarMovimientoFinanzas,

  exportarFinanzasRangoExcel,
};
/* ✅ SUBLICUENTAS TG BOT — PARTE 6/6
   HANDLERS / COMANDOS / CALLBACKS / MESSAGE / AUTOTXT / HARDEN / HTTP
   -------------------------------------------------------------------
   Este archivo registra:
   - comandos
   - callback_query
   - message handler
   - auto TXT 7AM
   - harden de proceso
   - servidor HTTP /health
*/

const http = require("http");

const {
  bot,
  admin,
  db,
  TZ,
  PLATAFORMAS,
  FINANZAS_COLLECTION,
  CORE_STATE,
  hardStopBot,
  releaseRuntimeLock,
  getCoreHealth,
} = require("./index_01_core");

const {
  allowMsg,
  isAdmin,
  isSuperAdmin,
  isVendedor,
  getRevendedorPorTelegramId,
  setTelegramIdToRevendedor,
  normalizeRevendedorDoc,
  panelMsgId,
  bindPanelFromCallback,
  upsertPanel,
  wizard,
  pending,
  limpiarQuery,
  normalizarPlataforma,
  esPlataformaValida,
  isEmailLike,
  onlyDigits,
  docIdInventario,
  safeBtnLabel,
  escMD,
  isFechaDMY,
  parseMontoNumber,
  parseMonthInputToKey,
  parseFechaFinanceInput,
  getMonthKeyFromDMY,
  parseDMYtoTS,
  moneyLps,
  moneyNumber,
  hoyDMY,
  addDaysDMY,
  logErr,
} = require("./index_02_utils_roles");

const {
  dedupeClientes,
  buscarPorTelefonoTodos,
  buscarClienteRobusto,
  enviarFichaCliente,
  enviarListaResultadosClientes,
  reporteClientesTXTGeneral,
  reporteClientesSplitPorVendedorTXT,
  obtenerRenovacionesPorFecha,
  renovacionesTexto,
  enviarTXT,
  enviarTXTATodosHoy,
  wizardStart,
  wizardNext,
  getCliente,
  clienteResumenTXT,
  enviarHistorialClienteTXT,
  kbPlataformasWiz,
  menuEditarCliente,
  menuListaServicios,
  menuServicio,
  patchServicio,
  addServicioTx,
  serviciosConIndiceOriginal,
  clienteDuplicado,
} = require("./index_03_clientes_crm");

const {
  buscarInventarioPorCorreo,
  enviarInventarioPlataforma,
  mostrarStockGeneral,
  enviarSubmenuInventario,
  buscarCorreoInventarioPorPlatCorreo,
  mostrarMenuClientesCorreo,
  mostrarListaCorreosPlataforma,
  mostrarPanelCorreo,
  responderMenuCodigosNetflix,
  responderCodigoNetflix,
  getCapacidadCorreo,
  aplicarAutoLleno,
} = require("./index_04_inventario_correos");

const {
  menuPrincipal,
  menuPrincipalFromCommand,
  menuVendedor,
  menuVendedorFromCommand,
  menuInventario,
  menuClientes,
  menuPagos,
  menuRenovaciones,
  menuFinRegistro,
  menuFinEliminarTipo,
  menuFinReportes,
  kbBancosFinanzas,
  kbMotivosFinanzas,
  registrarIngresoTx,
  registrarEgresoTx,
  getMovimientosPorFecha,
  getMovimientosPorMes,
  resumenFinanzasTextoPorFecha,
  resumenBancosMesTexto,
  resumenTopPlataformasTexto,
  cierreCajaTexto,
  exportarFinanzasRangoExcel,
  eliminarMovimientoFinanzas,
} = require("./index_05_finanzas_menus");

// ===============================
// HELPERS LOCALES
// ===============================
function hasRuntimeLock() {
  return CORE_STATE.HAS_RUNTIME_LOCK === true;
}

async function listarRevendedores(chatId) {
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay revendedores.");

  const all = snap.docs.map((d) => normalizeRevendedorDoc(d));
  all.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" }));

  let t = "👤 *REVENDEDORES*\n\n";
  all.forEach((x) => {
    t += `• ${escMD(x.nombre || x.id)} — ${x.activo ? "✅ activo" : "⛔ inactivo"}${x.telegramId ? ` | 🆔 ${escMD(x.telegramId)}` : ""}\n`;
  });

  if (t.length > 3800) {
    const { enviarTxtComoArchivo } = require("./index_02_utils_roles");
    return enviarTxtComoArchivo(chatId, t, `revendedores_${Date.now()}.txt`);
  }

  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
}

// ===============================
// COMANDOS CLIENTES
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  if (onlyDigits(q).length >= 7) {
    const resultados = await buscarPorTelefonoTodos(q);
    const dedup = dedupeClientes(resultados);
    if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
    if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
    return enviarListaResultadosClientes(chatId, dedup);
  }

  const resultados = await buscarClienteRobusto(q);
  const dedup = dedupeClientes(resultados);

  if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
  if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

  return enviarListaResultadosClientes(chatId, dedup);
});

bot.onText(/\/cliente\s+(\S+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const tel = String(match[1] || "").trim();
  const resultados = await buscarPorTelefonoTodos(tel);
  const dedup = dedupeClientes(resultados);

  if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

  return enviarListaResultadosClientes(chatId, dedup);
});

bot.onText(/\/clientes_txt/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return reporteClientesTXTGeneral(chatId);
});

bot.onText(/\/vendedores_txt_split/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return reporteClientesSplitPorVendedorTXT(chatId);
});

bot.onText(/\/sincronizar_todo/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isSuperAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo el SUPER ADMIN puede sincronizar la base de datos.");
  }

  await bot.sendMessage(
    chatId,
    "🔄 *Iniciando sincronización masiva...*",
    { parse_mode: "Markdown" }
  );

  let perfilesEmparejados = 0;
  const cuentasAfectadas = new Set();

  try {
    const snapClientes = await db.collection("clientes").get();

    for (const docCli of snapClientes.docs) {
      const c = docCli.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      const nombreCliente = c.nombrePerfil || "Sin Nombre";

      for (const s of servicios) {
        if (!s.correo || !s.plataforma) continue;

        const plat = normalizarPlataforma(s.plataforma);
        const mail = String(s.correo).trim().toLowerCase();
        const docId = docIdInventario(mail, plat);

        const refInv = db.collection("inventario").doc(docId);
        const docInv = await refInv.get();

        if (!docInv.exists) continue;

        const invData = docInv.data() || {};
        let clientesInv = Array.isArray(invData.clientes) ? invData.clientes.slice() : [];
        const pinCliente = s.pin || "0000";

        const yaExiste = clientesInv.some(
          (x) => x.nombre === nombreCliente && x.pin === pinCliente
        );
        if (yaExiste) continue;

        clientesInv.push({
          nombre: nombreCliente,
          pin: pinCliente,
          slot: clientesInv.length + 1,
        });

        const capacidad = Number(invData.capacidad || invData.total || 0);
        const ocupados = clientesInv.length;
        const disponibles = capacidad > 0
          ? Math.max(0, capacidad - ocupados)
          : Math.max(0, Number(invData.disp || 0) - 1);
        const estado = disponibles === 0 ? "llena" : "activa";

        await refInv.set(
          {
            clientes: clientesInv,
            ocupados,
            disponibles,
            disp: disponibles,
            estado,
            capacidad,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        perfilesEmparejados++;
        cuentasAfectadas.add(docId);
      }
    }

    let reporte = "✅ *Sincronización Completada con Éxito*\n\n";
    reporte += `👤 PERFILES emparejados: *${perfilesEmparejados}*\n`;
    reporte += `📧 CUENTAS actualizadas: *${cuentasAfectadas.size}*\n\n`;
    reporte += "💡 _Su base de datos ahora está 100% conectada._";

    return bot.sendMessage(chatId, reporte, { parse_mode: "Markdown" });
  } catch (error) {
    logErr("Error en sincronización:", error);
    return bot.sendMessage(chatId, "⚠️ Ocurrió un error al sincronizar. Revise los logs del servidor.");
  }
});

// ===============================
// COMANDOS RENOVACIONES
// ===============================
bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await isAdmin(userId);
  const vend = await getRevendedorPorTelegramId(userId);

  if (!adminOk && !(vend && vend.nombre)) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

  const arg = String(match[1] || "").trim();
  let fecha = "";
  let vendedor = "";

  if (!arg || arg.toLowerCase() === "hoy") {
    fecha = hoyDMY();
  } else {
    const parts = arg.split(/\s+/);
    if (parts.length === 1 && isFechaDMY(parts[0])) {
      fecha = parts[0];
    } else if (parts.length >= 2 && isFechaDMY(parts[parts.length - 1])) {
      fecha = parts[parts.length - 1];
      vendedor = parts.slice(0, -1).join(" ");
    } else {
      return bot.sendMessage(
        chatId,
        "⚠️ Uso:\n/renovaciones hoy\n/renovaciones dd/mm/yyyy\n/renovaciones VENDEDOR dd/mm/yyyy"
      );
    }
  }

  if (!adminOk && vend?.nombre) vendedor = vend.nombre;

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  const texto = renovacionesTexto(list, fecha, vendedor || null);
  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

bot.onText(/\/txt(?:\s+(.+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await isAdmin(userId);
  const vend = await getRevendedorPorTelegramId(userId);

  if (!adminOk && !(vend && vend.nombre)) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

  const arg = String(match[1] || "").trim();
  let fecha = "";
  let vendedor = "";

  if (!arg || arg.toLowerCase() === "hoy") {
    fecha = hoyDMY();
  } else {
    const parts = arg.split(/\s+/);
    if (parts.length === 1 && isFechaDMY(parts[0])) {
      fecha = parts[0];
    } else if (parts.length >= 2 && isFechaDMY(parts[parts.length - 1])) {
      fecha = parts[parts.length - 1];
      vendedor = parts.slice(0, -1).join(" ");
    } else {
      return bot.sendMessage(
        chatId,
        "⚠️ Uso:\n/txt hoy\n/txt dd/mm/yyyy\n/txt VENDEDOR dd/mm/yyyy"
      );
    }
  }

  if (!adminOk && vend?.nombre) vendedor = vend.nombre;

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  return enviarTXT(chatId, list, fecha, vendedor || null);
});

// ===============================
// COMANDOS FINANZAS
// ===============================
bot.onText(/\/finanzas/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return menuPagos(chatId);
});

bot.onText(/\/resumen_fecha\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const fecha =
    String(match[1] || "").trim().toLowerCase() === "hoy"
      ? hoyDMY()
      : String(match[1] || "").trim();

  if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Uso: /resumen_fecha dd/mm/yyyy");

  const list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));
  return bot.sendMessage(chatId, resumenFinanzasTextoPorFecha(fecha, list), {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/bancos_mes\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const key = parseMonthInputToKey(String(match[1] || "").trim());
  if (!key) return bot.sendMessage(chatId, "⚠️ Uso: /bancos_mes mm/yyyy");

  const list = await getMovimientosPorMes(key, userId, await isSuperAdmin(userId));
  return bot.sendMessage(chatId, resumenBancosMesTexto(key, list), {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/top_plataformas_mes\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const key = parseMonthInputToKey(String(match[1] || "").trim());
  if (!key) return bot.sendMessage(chatId, "⚠️ Uso: /top_plataformas_mes mm/yyyy");

  const list = await getMovimientosPorMes(key, userId, await isSuperAdmin(userId));
  return bot.sendMessage(chatId, resumenTopPlataformasTexto(key, list), {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/cierre_caja\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const fecha =
    String(match[1] || "").trim().toLowerCase() === "hoy"
      ? hoyDMY()
      : String(match[1] || "").trim();

  if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Uso: /cierre_caja dd/mm/yyyy");

  const list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));
  return bot.sendMessage(chatId, cierreCajaTexto(fecha, list), {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/excel_finanzas\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const fechaInicio = String(match[1] || "").trim();
  const fechaFin = String(match[2] || "").trim();

  return exportarFinanzasRangoExcel(
    chatId,
    fechaInicio,
    fechaFin,
    userId,
    await isSuperAdmin(userId)
  );
});

bot.onText(/\/editar_movimiento\s+([A-Za-z0-9_-]+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const id = String(match[1] || "").trim();
  const ref = db.collection(FINANZAS_COLLECTION).doc(id);
  const doc = await ref.get();

  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Movimiento no encontrado.");

  const m = doc.data() || {};

  const txt =
    `✏️ *EDITAR MOVIMIENTO*\n\n` +
    `🆔 ID: \`${id}\`\n` +
    `🗂️ Tipo: ${escMD(m.tipo || "-")}\n` +
    `💰 Monto: ${moneyLps(m.monto || 0)}\n` +
    `🏦 Banco: ${escMD(m.banco || "-")}\n` +
    `🧾 Motivo: ${escMD(m.motivo || "-")}\n` +
    `📦 Plataforma: ${escMD(m.plataforma || "-")}\n` +
    `📝 Detalle: ${escMD(m.detalle || "-")}\n` +
    `📅 Fecha: ${escMD(m.fecha || "-")}\n\n` +
    `Seleccione qué desea editar:`;

  return bot.sendMessage(chatId, txt, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Editar monto", callback_data: `fin:edit:monto:${id}` }],
        [{ text: "🏦 Editar banco", callback_data: `fin:edit:banco:${id}` }],
        [{ text: "🧾 Editar motivo", callback_data: `fin:edit:motivo:${id}` }],
        [{ text: "📦 Editar plataforma", callback_data: `fin:edit:plataforma:${id}` }],
        [{ text: "📝 Editar detalle", callback_data: `fin:edit:detalle:${id}` }],
        [{ text: "📅 Editar fecha", callback_data: `fin:edit:fecha:${id}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
});

// ===============================
// IDS / VINCULACIÓN
// ===============================
bot.onText(/\/id/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(
    chatId,
    `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`
  );
});

bot.onText(/\/miid/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(
    chatId,
    `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`
  );
});

bot.onText(/\/vincular_vendedor\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso: /vincular_vendedor NOMBRE");

  const r = await setTelegramIdToRevendedor(nombre, userId);
  return bot.sendMessage(chatId, r.msg);
});

// ===============================
// REVENDEDORES ADMIN
// ===============================
bot.onText(/\/addvendedor\s+(\d+)\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");

  const telegramId = String(match[1] || "").trim();
  const nombre = String(match[2] || "").trim();

  if (!telegramId || !nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/addvendedor ID Nombre");

  const docId = String(nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ") || String(Date.now());

  await db.collection("revendedores").doc(docId).set(
    {
      nombre,
      nombre_norm: docId,
      telegramId: String(telegramId),
      activo: true,
      autoLastSent: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ Revendedor agregado\n\n👤 ${nombre}\n🆔 ${telegramId}\n📌 DocID: ${docId}`
  );
});

bot.onText(/\/delvendedor\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/delvendedor Nombre");

  const nombreNorm = String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");

  const snap = await db.collection("revendedores").get();

  let found = null;
  snap.forEach((d) => {
    const rev = normalizeRevendedorDoc(d);
    if (rev.nombre_norm === nombreNorm) found = { ref: d.ref, nombre: rev.nombre };
  });

  if (!found) return bot.sendMessage(chatId, "⚠️ No encontré ese revendedor.");

  await found.ref.delete();
  return bot.sendMessage(chatId, `🗑️ Revendedor eliminado:\n${found.nombre}`);
});

// ===============================
// ADMINS
// ===============================
bot.onText(/\/adminadd\s+(\d+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isSuperAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede agregar admins.");
  }

  const id = String(match[1] || "").trim();

  await db.collection("admins").doc(id).set(
    {
      activo: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      creadoPor: String(userId),
    },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Admin agregado: ${id}`);
});

bot.onText(/\/admindel\s+(\d+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isSuperAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede eliminar admins.");
  }

  const id = String(match[1] || "").trim();

  await db.collection("admins").doc(id).set(
    {
      activo: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      desactivadoPor: String(userId),
    },
    { merge: true }
  );

  return bot.sendMessage(chatId, `🗑️ Admin desactivado: ${id}`);
});

bot.onText(/\/adminlist/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isSuperAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN.");

  const snap = await db.collection("admins").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay admins en colección.");

  const { SUPER_ADMIN } = require("./index_01_core");
  let t = `👑 *ADMINS*\nSUPER_ADMIN: ${SUPER_ADMIN || "(no seteado)"}\n\n`;

  snap.forEach((d) => {
    const x = d.data() || {};
    t += `• ${d.id} — ${x.activo ? "✅ activo" : "⛔ inactivo"}\n`;
  });

  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
});

// ===============================
// START / MENU BLINDADO
// ===============================
bot.onText(/\/start/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (await isAdmin(userId)) return menuPrincipalFromCommand(msg);
  if (await isVendedor(userId)) return menuVendedorFromCommand(msg);

  return bot.sendMessage(chatId, "⛔ Acceso denegado");
});

bot.onText(/\/menu/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    panelMsgId.delete(String(chatId));

    if (await isAdmin(userId)) return menuPrincipalFromCommand(msg);
    if (await isVendedor(userId)) return menuVendedorFromCommand(msg);

    return bot.sendMessage(chatId, "⛔ Acceso denegado", {
      reply_to_message_id: msg.message_id,
    });
  } catch (_) {
    return bot.sendMessage(chatId, "⚠️ Error interno.");
  }
});

// ===============================
// ATAJOS INVENTARIO
// ===============================
PLATAFORMAS.forEach((p) => {
  bot.onText(new RegExp("^\\/" + p + "(?:@\\w+)?(?:\\s+.*)?$", "i"), async (msg) => {
    if (!hasRuntimeLock()) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

    return enviarInventarioPlataforma(chatId, p, 0);
  });
});

bot.onText(/\/stock/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return mostrarStockGeneral(chatId);
});

// ===============================
// AGREGAR CORREO INVENTARIO
// ===============================
bot.onText(/\/addcorreo\s+(\S+)\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado. Solo admins pueden agregar inventario.");
  }

  const platRaw = match[1];
  const correoRaw = match[2];
  const capacidadRaw = match[3];

  const plat = normalizarPlataforma(platRaw);
  if (!esPlataformaValida(plat)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Plataforma no válida.*\nEjemplos válidos: netflix, disneyp, hbomax...",
      { parse_mode: "Markdown" }
    );
  }

  const mail = String(correoRaw).toLowerCase().trim();
  if (!isEmailLike(mail)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Formato de correo inválido.* Asegúrese de que lleve el @.",
      { parse_mode: "Markdown" }
    );
  }

  const idInv = docIdInventario(mail, plat);
  const ref = db.collection("inventario").doc(idInv);
  const doc = await ref.get();

  if (doc.exists) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Este correo ya existe* en el inventario para esta plataforma.",
      { parse_mode: "Markdown" }
    );
  }

  let capacidad = Number(capacidadRaw);
  if (!capacidadRaw || isNaN(capacidad) || capacidad <= 0) {
    const { getTotalPorPlataforma } = require("./index_02_utils_roles");
    const total = await getTotalPorPlataforma(plat);
    capacidad = total || 5;
  }

  await ref.set({
    plataforma: plat,
    correo: mail,
    capacidad,
    clientes: [],
    ocupados: 0,
    disponibles: capacidad,
    disp: capacidad,
    estado: "activa",
    clave: "Sin clave",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return bot.sendMessage(
    chatId,
    `✅ *NUEVA CUENTA AGREGADA AL INVENTARIO*\n\n📌 *Plataforma:* ${plat.toUpperCase()}\n📧 *Correo:* ${mail}\n👥 *Pantallas totales:* ${capacidad}\n\n_💡 Ya puede asignarle clientes a este correo desde el Wizard._`,
    { parse_mode: "Markdown" }
  );
});

// ===============================
// CALLBACKS
// ===============================
bot.on("callback_query", async (q) => {
  if (!hasRuntimeLock()) return;

  const chatId = q.message?.chat?.id;
  const userId = q.from?.id;
  const data = q.data || "";

  try {
    try {
      await bot.answerCallbackQuery(q.id);
    } catch (_) {}

    if (!chatId) return;
    if (!allowMsg(chatId, userId)) return;

    bindPanelFromCallback(q);

    const adminOk = await isAdmin(userId);
    const vend = await getRevendedorPorTelegramId(userId);
    const vendOk = !!(vend && vend.nombre);

    if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    if (data === "go:inicio") {
      pending.delete(String(chatId));
      if (adminOk) return menuPrincipal(chatId);
      return menuVendedor(chatId);
    }

    const vendedorOnlyAllowed = new Set([
      "ren:mis",
      "txt:mis",
      "vend:clientes",
      "vend:clientes:txt",
      "go:inicio",
    ]);

    if (!adminOk) {
      if (!vendedorOnlyAllowed.has(data)) {
        return upsertPanel(
          chatId,
          "⛔ Modo vendedor.\n\nUsa:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
          { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
          "Markdown"
        );
      }
    }

    if (adminOk) {
      if (data === "menu:inventario") return menuInventario(chatId);
      if (data === "menu:clientes") return menuClientes(chatId);
      if (data === "menu:pagos") return menuPagos(chatId);
      if (data === "menu:renovaciones") return menuRenovaciones(chatId, userId);

      if (data === "fin:menu:registro") return menuFinRegistro(chatId);
      if (data === "fin:menu:reportes") return menuFinReportes(chatId);
      if (data === "fin:menu:eliminar") return menuFinEliminarTipo(chatId);

      if (data === "fin:menu:eliminar:ingreso") {
        pending.set(String(chatId), { mode: "finEliminarFechaAsk", tipoFiltro: "ingreso" });
        return upsertPanel(
          chatId,
          "🗑️ *ELIMINAR INGRESO*\n\nEscriba la fecha en formato *dd/mm/yyyy* para listar ingresos.",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Eliminar", callback_data: "fin:menu:eliminar" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:eliminar:egreso") {
        pending.set(String(chatId), { mode: "finEliminarFechaAsk", tipoFiltro: "egreso" });
        return upsertPanel(
          chatId,
          "🗑️ *ELIMINAR EGRESO*\n\nEscriba la fecha en formato *dd/mm/yyyy* para listar egresos.",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Eliminar", callback_data: "fin:menu:eliminar" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:ingreso") {
        pending.set(String(chatId), { mode: "finIngresoMonto" });
        return upsertPanel(
          chatId,
          "➕ *REGISTRAR INGRESO*\n\n💰 Escriba el monto del ingreso en Lps:",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:egreso") {
        pending.set(String(chatId), { mode: "finEgresoMonto" });
        return upsertPanel(
          chatId,
          "➖ *REGISTRAR EGRESO*\n\n💸 Escriba el monto del gasto en Lps:",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:resumen_fecha") {
        pending.set(String(chatId), { mode: "finResumenFechaAsk" });
        return upsertPanel(
          chatId,
          "📊 *VER RESUMEN POR FECHA*\n\nEscriba la fecha en formato *dd/mm/yyyy* o escriba *hoy*.",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:bancos_mes") {
        pending.set(String(chatId), { mode: "finResumenBancoMesAsk" });
        return upsertPanel(
          chatId,
          "🏦 *RESUMEN POR BANCO DEL MES*\n\nEscriba el mes en formato *mm/yyyy*.\nEjemplo: *01/2026*",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:top_plataformas") {
        pending.set(String(chatId), { mode: "finTopPlataformasMesAsk" });
        return upsertPanel(
          chatId,
          "🏆 *TOP PLATAFORMAS DEL MES*\n\nEscriba el mes en formato *mm/yyyy*.\nEjemplo: *01/2026*",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:cierre") {
        pending.set(String(chatId), { mode: "finCierreCajaAsk" });
        return upsertPanel(
          chatId,
          "🧾 *CIERRE DE CAJA*\n\nEscriba la fecha en formato *dd/mm/yyyy* o escriba *hoy*.",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:excel_rango") {
        pending.set(String(chatId), { mode: "finExcelRangoInicio" });
        return upsertPanel(
          chatId,
          "📤 *EXPORTAR EXCEL POR RANGO*\n\nEscriba la fecha inicial en formato *dd/mm/yyyy*.",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("fin:ing:banco:")) {
        const banco = decodeURIComponent(data.split(":").slice(3).join(":") || "");
        const p = pending.get(String(chatId));
        if (!p || p.mode !== "finIngresoBancoPick") {
          return bot.sendMessage(chatId, "⚠️ Flujo de ingreso no activo.");
        }

        pending.set(String(chatId), {
          mode: "finIngresoPlataformaManual",
          monto: p.monto,
          banco,
        });

        return upsertPanel(
          chatId,
          `➕ *REGISTRAR INGRESO*\n\n🏦 Banco: *${escMD(banco)}*\n\n📦 Escriba manualmente la plataforma o plataformas.\nEjemplo:\nNetflix\nDisney\nHBO Max\nPrime Video`,
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("fin:egr:motivo:")) {
        const motivo = decodeURIComponent(data.split(":").slice(3).join(":") || "");
        const p = pending.get(String(chatId));
        if (!p || p.mode !== "finEgresoMotivoPick") {
          return bot.sendMessage(chatId, "⚠️ Flujo de egreso no activo.");
        }

        pending.set(String(chatId), {
          mode: "finEgresoDetalle",
          monto: p.monto,
          motivo,
        });

        return upsertPanel(
          chatId,
          `➖ *REGISTRAR EGRESO*\n\n🧾 Motivo: *${escMD(motivo)}*\n\n📝 Escriba el detalle del egreso:`,
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("fin:del:one:")) {
        const id = String(data.split(":")[3] || "").trim();
        try {
          const eliminado = await eliminarMovimientoFinanzas(
            id,
            userId,
            await isSuperAdmin(userId)
          );
          return bot.sendMessage(
            chatId,
            `✅ Movimiento eliminado.\n\n🗂️ Tipo: ${eliminado.tipo}\n💰 Monto: ${moneyLps(eliminado.monto)}\n📅 Fecha: ${eliminado.fecha}`,
            { parse_mode: "Markdown" }
          );
        } catch (e) {
          return bot.sendMessage(
            chatId,
            `⚠️ ${e.message || "No se pudo eliminar el movimiento."}`
          );
        }
      }

      if (data === "fin:otro:ingreso") {
        pending.set(String(chatId), { mode: "finIngresoMonto" });
        return bot.sendMessage(chatId, "💰 Escriba el monto del nuevo ingreso:");
      }

      if (data === "fin:otro:egreso") {
        pending.set(String(chatId), { mode: "finEgresoMonto" });
        return bot.sendMessage(chatId, "💸 Escriba el monto del nuevo egreso:");
      }

      if (data === "fin:otro:no") {
        pending.delete(String(chatId));
        return menuPagos(chatId);
      }

      if (data.startsWith("fin:edit:monto:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditMonto", id });
        return bot.sendMessage(chatId, "💰 Escriba el nuevo monto:");
      }

      if (data.startsWith("fin:edit:banco:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditBanco", id });
        return bot.sendMessage(chatId, "🏦 Escriba el nuevo banco:");
      }

      if (data.startsWith("fin:edit:motivo:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditMotivo", id });
        return bot.sendMessage(chatId, "🧾 Escriba el nuevo motivo:");
      }

      if (data.startsWith("fin:edit:plataforma:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditPlataforma", id });
        return bot.sendMessage(chatId, "📦 Escriba la nueva plataforma o plataformas:");
      }

      if (data.startsWith("fin:edit:detalle:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditDetalle", id });
        return bot.sendMessage(chatId, "📝 Escriba el nuevo detalle:");
      }

      if (data.startsWith("fin:edit:fecha:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditFecha", id });
        return bot.sendMessage(chatId, "📅 Escriba la nueva fecha en formato dd/mm/yyyy:");
      }

      if (data === "menu:buscar") {
        return upsertPanel(
          chatId,
          "🔎 *BUSCAR*\n\nUse:\n• /buscar NOMBRE\n• /buscar TELEFONO\n\nO directo:\n• /NOMBRE\n• /TELEFONO",
          { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
          "Markdown"
        );
      }

      if (data === "inv:general") return mostrarStockGeneral(chatId);

      if (data.startsWith("inv:") && !data.startsWith("inv:open:") && !data.startsWith("inv:menu:")) {
        const [, plat, pageStr] = data.split(":");
        return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
      }

      if (data.startsWith("inv:open:")) {
        const [, , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.set(String(chatId), {
          mode: "invSubmenuCtx",
          plat: normalizarPlataforma(plat),
          correo: String(correo).toLowerCase(),
        });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (data.startsWith("inv:menu:sumar:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.set(String(chatId), { mode: "invSumarQty", plat, correo });
        return upsertPanel(
          chatId,
          `➕ *Agregar perfil*\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}\n\nEscriba cantidad a *SUMAR* (ej: 1):`,
          {
            inline_keyboard: [[{
              text: "↩️ Cancelar",
              callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}`,
            }]],
          },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:restar:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.set(String(chatId), { mode: "invRestarQty", plat, correo });
        return upsertPanel(
          chatId,
          `➖ *Quitar perfil*\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}\n\nEscriba cantidad a *RESTAR* (ej: 1):`,
          {
            inline_keyboard: [[{
              text: "↩️ Cancelar",
              callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}`,
            }]],
          },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:clave:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.set(String(chatId), { mode: "invEditClave", plat, correo });
        return upsertPanel(
          chatId,
          `✏️ *Editar clave*\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}\n\nEscriba la nueva clave:`,
          {
            inline_keyboard: [[{
              text: "↩️ Cancelar",
              callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}`,
            }]],
          },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:cancel:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.delete(String(chatId));
        pending.set(String(chatId), {
          mode: "invSubmenuCtx",
          plat: normalizarPlataforma(plat),
          correo: String(correo).toLowerCase(),
        });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (data.startsWith("inv:menu:borrar:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        return upsertPanel(
          chatId,
          `🗑️ Confirmar *borrar correo*?\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}`,
          {
            inline_keyboard: [
              [{
                text: "✅ Confirmar",
                callback_data: `inv:menu:borrarok:${normalizarPlataforma(plat)}:${encodeURIComponent(String(correo).toLowerCase())}`,
              }],
              [{
                text: "⬅️ Cancelar",
                callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}`,
              }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:borrarok:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ No existe ese correo en inventario.");
        await ref.delete();
        pending.delete(String(chatId));
        return enviarInventarioPlataforma(chatId, plat, 0);
      }

      if (data.startsWith("mail_panel|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        return mostrarPanelCorreo(chatId, plataforma, correo);
      }

      if (data.startsWith("mail_menu_clientes|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        return mostrarMenuClientesCorreo(chatId, plataforma, correo);
      }

      if (data.startsWith("mail_menu_codigos|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        return responderMenuCodigosNetflix(chatId, plataforma, correo);
      }

      if (data.startsWith("nf_code|")) {
        const parts = data.split("|");
        const tipo = parts[1] || "";
        const correo = decodeURIComponent(parts[2] || "");
        return responderCodigoNetflix(chatId, correo, tipo);
      }

      if (data.startsWith("mail_ver_clientes|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        let txt = "👥 *Clientes en este correo*\n\n";
        txt += `📧 *${escMD(correo)}*\n`;
        txt += `📌 *${escMD(String(plataforma).toUpperCase())}*\n\n`;

        if (!clientes.length) {
          txt += "_No hay clientes asignados._\n\n";
        } else {
          clientes.forEach((c, i) => {
            txt += `${i + 1}. ${escMD(c.nombre || "Sin nombre")} — PIN ${escMD(c.pin || "----")}\n`;
          });
          txt += "\n";
        }

        txt += `👤 *Ocupados:* ${ocupados}/${capacidad}\n`;
        txt += `✅ *Disponibles:* ${disponibles}\n`;
        txt += `📊 *Estado:* ${escMD(estado)}`;

        return upsertPanel(
          chatId,
          txt,
          {
            inline_keyboard: [
              [{
                text: "⬅️ Volver al correo",
                callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}`,
              }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("mail_add_cliente|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);

        if (disponibles <= 0) {
          return bot.sendMessage(
            chatId,
            `❌ Esta cuenta ya está llena.\n\n👤 Ocupados: ${ocupados}/${capacidad}\n✅ Disponibles: 0\n📊 Estado: LLENA`
          );
        }

        pending.set(String(chatId), {
          mode: "mailAddClienteNombre",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(correo).toLowerCase(),
        });

        return bot.sendMessage(chatId, "👤 *Agregar cliente*\n\nEscriba el nombre del cliente:", {
          parse_mode: "Markdown",
        });
      }

      if (data.startsWith("mail_del_cliente|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) {
          return bot.sendMessage(chatId, "⚠️ Este correo no tiene clientes.");
        }

        const kb = clientes.map((c, i) => [
          {
            text: `${i + 1}. ${c.nombre || "Sin nombre"} — PIN ${c.pin || "----"}`,
            callback_data: `mail_del_cliente_ok|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}|${i}`,
          },
        ]);

        kb.push([{
          text: "⬅️ Volver",
          callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}`,
        }]);

        return upsertPanel(
          chatId,
          `➖ *Quitar cliente*\n\n📧 *${escMD(correo)}*\n\nSeleccione el cliente que desea quitar:`,
          { inline_keyboard: kb },
          "Markdown"
        );
      }

      if (data.startsWith("mail_del_cliente_ok|")) {
        const [, plataforma, correoEnc, indexStr] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        const index = Number(indexStr);

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Este correo ya no tiene clientes.");
        if (isNaN(index) || index < 0 || index >= clientes.length) {
          return bot.sendMessage(chatId, "❌ Cliente inválido.");
        }

        const cliente = clientes[index];
        clientes.splice(index, 1);

        clientes = clientes.map((c, i) => ({
          ...c,
          slot: i + 1,
        }));

        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        await ref.set(
          {
            clientes,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            capacidad,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(
          chatId,
          "✅ *Cliente quitado correctamente*\n\n" +
            `👤 *Nombre:* ${escMD(cliente.nombre || "Sin nombre")}\n` +
            `🔐 *PIN:* ${escMD(cliente.pin || "----")}\n\n` +
            `👤 *Ocupados:* ${ocupados}/${capacidad}\n` +
            `✅ *Disponibles:* ${disponibles}\n` +
            `📊 *Estado:* ${escMD(estado)}`,
          { parse_mode: "Markdown" }
        );

        return mostrarPanelCorreo(chatId, plataforma, correo);
      }

      if (data.startsWith("mail_edit_pin|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Este correo no tiene clientes.");

        const kb = clientes.map((c, i) => [
          {
            text: `${i + 1}. ${c.nombre || "Sin nombre"} — PIN ${c.pin || "----"}`,
            callback_data: `mail_edit_pin_sel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}|${i}`,
          },
        ]);

        kb.push([{
          text: "⬅️ Volver",
          callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}`,
        }]);

        return upsertPanel(
          chatId,
          `🔐 *Editar PIN*\n\n📧 *${escMD(correo)}*\n\nSeleccione el cliente:`,
          { inline_keyboard: kb },
          "Markdown"
        );
      }

      if (data.startsWith("mail_edit_pin_sel|")) {
        const [, plataforma, correoEnc, indexStr] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        const clienteIndex = Number(indexStr);

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Este correo no tiene clientes.");
        if (isNaN(clienteIndex) || clienteIndex < 0 || clienteIndex >= clientes.length) {
          return bot.sendMessage(chatId, "❌ Cliente inválido.");
        }

        const cliente = clientes[clienteIndex];

        pending.set(String(chatId), {
          mode: "mailEditPin",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(correo).toLowerCase(),
          clienteIndex,
        });

        return bot.sendMessage(
          chatId,
          "🔐 *Editar PIN*\n\n" +
            `👤 *Cliente:* ${escMD(cliente.nombre || "Sin nombre")}\n` +
            `🔑 *PIN actual:* ${escMD(cliente.pin || "----")}\n\n` +
            "Escriba el nuevo PIN de 4 dígitos:",
          { parse_mode: "Markdown" }
        );
      }

      if (data.startsWith("mail_edit_clave|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const claveActual = correoData.clave || "Sin clave";

        pending.set(String(chatId), {
          mode: "mailEditClaveCorreo",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(correo).toLowerCase(),
        });

        return bot.sendMessage(
          chatId,
          "✏️ *Editar clave del correo*\n\n" +
            `📧 *Correo:* ${escMD(correo)}\n` +
            `🔑 *Clave actual:* ${escMD(claveActual)}\n\n` +
            "Escriba la nueva clave del correo:",
          { parse_mode: "Markdown" }
        );
      }

      if (data.startsWith("mail_delete|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ Este correo ya no existe.");

        return upsertPanel(
          chatId,
          "⚠️ *Confirmar eliminación*\n\n" +
            `📧 *Correo:* ${escMD(correo)}\n\n` +
            "Esta acción eliminará la cuenta del inventario.\n\n¿Está seguro que desea borrarla?",
          {
            inline_keyboard: [
              [{
                text: "✅ Sí borrar",
                callback_data: `mail_delete_confirm|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}`,
              }],
              [{
                text: "❌ Cancelar",
                callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}`,
              }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("mail_delete_confirm|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return mostrarListaCorreosPlataforma(chatId, plataforma);

        const ref = found.ref;
        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (clientes.length > 0) {
          await bot.sendMessage(
            chatId,
            "⚠️ Este correo tenía clientes asignados. Se eliminará igualmente del inventario."
          );
        }

        await ref.delete();
        return enviarInventarioPlataforma(chatId, plataforma, 0);
      }

      if (data === "cli:txt:general") return reporteClientesTXTGeneral(chatId);
      if (data === "cli:txt:vendedores_split") return reporteClientesSplitPorVendedorTXT(chatId);

      if (data.startsWith("cli:txt:hist:")) {
        const clientId = data.split(":")[3];
        return enviarHistorialClienteTXT(chatId, clientId);
      }

      if (data.startsWith("cli:txt:one:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const { enviarTxtComoArchivo } = require("./index_02_utils_roles");
        return enviarTxtComoArchivo(
          chatId,
          clienteResumenTXT(c),
          `cliente_${onlyDigits(c.telefono || "") || clientId}.txt`
        );
      }

      if (data.startsWith("cli:view:")) return enviarFichaCliente(chatId, data.split(":")[2]);
      if (data === "cli:wiz:start") return wizardStart(chatId);

      if (data.startsWith("wiz:plat:")) {
        const parts = data.split(":");
        const platRaw = parts[2] || "";
        const clientId = parts[3] || null;

        const plat = normalizarPlataforma(platRaw);
        if (!esPlataformaValida(plat)) {
          return bot.sendMessage(chatId, `⚠️ Plataforma inválida en wizard: ${platRaw}`);
        }

        let st = wizard.get(String(chatId));
        if (!st) {
          st = {
            step: 4,
            clientId,
            nombre: "",
            telefono: "",
            vendedor: "",
            servicio: {},
            servStep: 1,
          };
        }

        st.clientId = clientId || st.clientId;
        st.servicio = st.servicio || {};
        st.servicio.plataforma = plat;
        st.servStep = 2;
        st.step = 4;

        wizard.set(String(chatId), st);
        return bot.sendMessage(chatId, "(Servicio 2/5) Correo de la cuenta:");
      }

      if (data.startsWith("wiz:addmore:")) {
        const clientId = data.split(":")[2];

        const nuevoState = {
          step: 4,
          clientId,
          nombre: "",
          telefono: "",
          vendedor: "",
          servicio: {},
          servStep: 1,
        };

        wizard.set(String(chatId), nuevoState);

        return bot.sendMessage(chatId, "📌 Agregar otro servicio\nSeleccione plataforma:", {
          reply_markup: {
            inline_keyboard: kbPlataformasWiz("wiz:plat", clientId),
          },
        });
      }

      if (data.startsWith("wiz:finish:")) {
        const clientId = data.split(":")[2];
        wizard.delete(String(chatId));
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:edit:menu:")) return menuEditarCliente(chatId, data.split(":")[3]);

      if (data.startsWith("cli:edit:nombre:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditNombre", clientId });
        return upsertPanel(
          chatId,
          "👤 *Editar nombre*\nEscriba el nuevo nombre:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:edit:tel:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditTel", clientId });
        return upsertPanel(
          chatId,
          "📱 *Editar teléfono*\nEscriba el nuevo teléfono:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:edit:vend:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditVendedor", clientId });
        return upsertPanel(
          chatId,
          "🧑‍💼 *Editar vendedor*\nEscriba el nuevo vendedor:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:list:")) return menuListaServicios(chatId, data.split(":")[3]);
      if (data.startsWith("cli:serv:menu:")) return menuServicio(chatId, data.split(":")[3], Number(data.split(":")[4]));

      if (data.startsWith("cli:serv:add:")) {
        const clientId = data.split(":")[3];
        return upsertPanel(
          chatId,
          "➕ *AGREGAR SERVICIO*\nSeleccione plataforma:",
          {
            inline_keyboard: [
              ...kbPlataformasWiz("cli:add:plat", clientId),
              [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:add:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[3]);
        const clientId = parts[4];

        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

        pending.set(String(chatId), { mode: "cliAddServMail", clientId, plat });

        return upsertPanel(
          chatId,
          `📧 *Correo* (${plat})\nEscriba el correo:`,
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:edit:")) {
        const parts = data.split(":");
        const field = parts[3];
        const clientId = parts[4];
        const idx = Number(parts[5]);

        if (field === "plat") {
          return upsertPanel(
            chatId,
            "📌 *Cambiar plataforma*\nSeleccione:",
            {
              inline_keyboard: [
                ...kbPlataformasWiz("cli:serv:set:plat", clientId, idx),
                [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
              ],
            },
            "Markdown"
          );
        }

        if (field === "mail") pending.set(String(chatId), { mode: "cliServEditMail", clientId, idx });
        if (field === "pin") pending.set(String(chatId), { mode: "cliServEditPin", clientId, idx });
        if (field === "precio") pending.set(String(chatId), { mode: "cliServEditPrecio", clientId, idx });
        if (field === "fecha") pending.set(String(chatId), { mode: "cliServEditFecha", clientId, idx });

        const titulo =
          field === "mail" ? "📧 *Cambiar correo*" :
          field === "pin" ? "🔐 *Cambiar pin*" :
          field === "precio" ? "💰 *Cambiar precio*" :
          "📅 *Cambiar fecha*";

        const hint =
          field === "precio" ? "Escriba el precio (solo número):" :
          field === "fecha" ? "Escriba dd/mm/yyyy:" :
          "Escriba el nuevo valor:";

        return upsertPanel(
          chatId,
          `${titulo}\n${hint}`,
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:set:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[4]);
        const clientId = parts[5];
        const idx = Number(parts[6]);

        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        servicios[idx] = { ...(servicios[idx] || {}), plataforma: plat };
        await ref.set(
          {
            servicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuServicio(chatId, clientId, idx);
      }

      if (data.startsWith("cli:serv:del:ask:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const idx = Number(parts[5]);

        return upsertPanel(
          chatId,
          "🗑️ *Eliminar perfil*\nConfirmar borrado de este servicio?",
          {
            inline_keyboard: [
              [{ text: "✅ Confirmar", callback_data: `cli:serv:del:ok:${clientId}:${idx}` }],
              [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:del:ok:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const idx = Number(parts[5]);

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        const servicioABorrar = servicios[idx];
        const plat = normalizarPlataforma(servicioABorrar.plataforma);
        const mail = String(servicioABorrar.correo || "").trim().toLowerCase();
        const nombreCliente = c.nombrePerfil || "";

        const refInv = db.collection("inventario").doc(docIdInventario(mail, plat));
        const docInv = await refInv.get();

        if (docInv.exists) {
          const invData = docInv.data() || {};
          let clientesInv = Array.isArray(invData.clientes) ? invData.clientes.slice() : [];

          const indexInv = clientesInv.findIndex(
            (cl) => cl.nombre === nombreCliente && cl.pin === servicioABorrar.pin
          );

          if (indexInv !== -1) {
            clientesInv.splice(indexInv, 1);
            clientesInv = clientesInv.map((cl, i) => ({ ...cl, slot: i + 1 }));

            const capacidad = Number(invData.capacidad || invData.total || 0);
            const ocupados = clientesInv.length;
            const disponibles = capacidad > 0
              ? Math.max(0, capacidad - ocupados)
              : Number(invData.disp || 0) + 1;
            const estado = disponibles === 0 ? "llena" : "activa";

            await refInv.set(
              {
                clientes: clientesInv,
                ocupados,
                disponibles,
                disp: disponibles,
                estado,
                capacidad,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }

        servicios.splice(idx, 1);
        await ref.set(
          {
            servicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (servicios.length) return menuListaServicios(chatId, clientId);
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:ren:list:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const servicios = serviciosConIndiceOriginal(Array.isArray(c.servicios) ? c.servicios : []);
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

        const kb = servicios.map((s, i) => [
          {
            text: safeBtnLabel(
              `🔄 ${i + 1}) ${s.plataforma} — ${s.correo} (Ren: ${s.fechaRenovacion || "-"})`,
              60
            ),
            callback_data: `cli:ren:menu:${clientId}:${s.idxOriginal}`,
          },
        ]);
        kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

        return upsertPanel(
          chatId,
          "🔄 *RENOVAR SERVICIO*\nSeleccione cuál renovar:",
          { inline_keyboard: kb },
          "Markdown"
        );
      }

      if (data.startsWith("cli:ren:menu:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        const s = servicios[idx] || {};
        const texto =
          `🔄 *RENOVAR SERVICIO #${idx + 1}*\n` +
          `📌 ${escMD(s.plataforma || "-")}\n` +
          `📧 ${escMD(s.correo || "-")}\n` +
          `📅 Actual: *${escMD(s.fechaRenovacion || "-")}*`;

        return upsertPanel(
          chatId,
          texto,
          {
            inline_keyboard: [
              [{ text: "➕ +30 días", callback_data: `cli:ren:+30:${clientId}:${idx}` }],
              [{ text: "📅 Poner fecha manual", callback_data: `cli:ren:fecha:${clientId}:${idx}` }],
              [{ text: "⬅️ Volver lista", callback_data: `cli:ren:list:${clientId}` }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:ren:+30:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        const actual = String(servicios[idx].fechaRenovacion || hoyDMY());
        const base = isFechaDMY(actual) ? actual : hoyDMY();
        const nueva = addDaysDMY(base, 30);

        servicios[idx] = { ...(servicios[idx] || {}), fechaRenovacion: nueva };
        await ref.set(
          {
            servicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuServicio(chatId, clientId, idx);
      }

      if (data.startsWith("cli:ren:all:ask:")) {
        const clientId = data.split(":")[4];
        return upsertPanel(
          chatId,
          "🔄 *Renovar todos +30 días*\n\n¿Desea renovar todos los servicios de este cliente?",
          {
            inline_keyboard: [
              [{ text: "✅ Confirmar", callback_data: `cli:ren:all:ok:${clientId}` }],
              [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:ren:all:ok:")) {
        const clientId = data.split(":")[4];

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

        const nuevos = servicios.map((s) => {
          const actual = String(s.fechaRenovacion || hoyDMY());
          const base = isFechaDMY(actual) ? actual : hoyDMY();
          return {
            ...s,
            fechaRenovacion: addDaysDMY(base, 30),
          };
        });

        await ref.set(
          {
            servicios: nuevos,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:ren:fecha:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        pending.set(String(chatId), { mode: "cliRenovarFechaManual", clientId, idx });

        return upsertPanel(
          chatId,
          "📅 *Renovar (fecha manual)*\nEscriba la nueva fecha en formato dd/mm/yyyy:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:ren:menu:${clientId}:${idx}` }]] },
          "Markdown"
        );
      }

      if (data === "txt:todos:hoy") {
        if (!(await isSuperAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPERADMIN.");
        return enviarTXTATodosHoy(chatId);
      }
    }

    if (data === "ren:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      const texto = renovacionesTexto(list, fecha, adminOk ? null : vend?.nombre);
      return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
    }

    if (data === "txt:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      return enviarTXT(chatId, list, fecha, adminOk ? null : vend?.nombre);
    }

    if (data === "ren:mis") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      const texto = renovacionesTexto(list, fecha, vend.nombre);
      return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
    }

    if (data === "txt:mis") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      return enviarTXT(chatId, list, fecha, vend.nombre);
    }

    if (data === "vend:clientes") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const { enviarMisClientes } = require("./index_03_clientes_crm");
      return enviarMisClientes(chatId, vend.nombre);
    }

    if (data === "vend:clientes:txt") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const { enviarMisClientesTXT } = require("./index_03_clientes_crm");
      return enviarMisClientesTXT(chatId, vend.nombre);
    }

    if (data === "rev:lista") return listarRevendedores(chatId);

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    logErr("callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// MESSAGE HANDLER
// ===============================
bot.on("message", async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";
  if (!chatId) return;

  try {
    if (!allowMsg(chatId, userId)) return;

    const adminOk = await isAdmin(userId);
    const vendOk = await isVendedor(userId);

    if (wizard.has(String(chatId)) && text.startsWith("/")) {
      const cmd = limpiarQuery(text).split(" ")[0];

      if (cmd !== "menu" && cmd !== "start") {
        return bot.sendMessage(
          chatId,
          "⚠️ Está en creación de cliente.\nPrimero toque *➕ Agregar otra* o *✅ Finalizar*.",
          { parse_mode: "Markdown" }
        );
      }
    }

    if (text.startsWith("/")) {
      if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");

      const rawText = String(text || "").trim();

      if (adminOk) {
        const posibleCorreo = rawText.slice(1).trim().toLowerCase();

        if (isEmailLike(posibleCorreo)) {
          const hits = await buscarInventarioPorCorreo(posibleCorreo);

          if (hits.length === 1) {
            pending.set(String(chatId), {
              mode: "invSubmenuCtx",
              plat: normalizarPlataforma(hits[0].plataforma),
              correo: posibleCorreo,
            });
            return enviarSubmenuInventario(chatId, hits[0].plataforma, posibleCorreo);
          }

          if (hits.length > 1) {
            const kb = hits.map((x) => [
              {
                text: `📌 ${String(x.plataforma).toUpperCase()}`,
                callback_data: `inv:open:${normalizarPlataforma(x.plataforma)}:${encodeURIComponent(posibleCorreo)}`,
              },
            ]);
            kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

            return bot.sendMessage(
              chatId,
              `📧 ${escMD(posibleCorreo)}\nSeleccione plataforma:`,
              {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: kb },
              }
            );
          }

          return bot.sendMessage(chatId, "⚠️ Correo no encontrado en inventario.");
        }
      }

      const cmd = limpiarQuery(text);
      const first = cmd.split(" ")[0];

      const vendedorCmd = new Set([
        "menu",
        "start",
        "miid",
        "id",
        "vincular_vendedor",
        "renovaciones",
        "txt",
      ]);

      if (!adminOk && vendOk && !vendedorCmd.has(first)) return;

      const comandosReservados = new Set([
        "start",
        "menu",
        "stock",
        "buscar",
        "cliente",
        "renovaciones",
        "txt",
        "clientes_txt",
        "vendedores_txt_split",
        "reindex_clientes",
        "fix_duplicados",
        "add",
        "del",
        "editclave",
        "adminadd",
        "admindel",
        "adminlist",
        "addvendedor",
        "delvendedor",
        "id",
        "miid",
        "vincular_vendedor",
        "sincronizar_todo",
        "addcorreo",
        "finanzas",
        "resumen_fecha",
        "bancos_mes",
        "top_plataformas_mes",
        "cierre_caja",
        "excel_finanzas",
        "editar_movimiento",
        ...PLATAFORMAS,
      ]);

      if (adminOk && !comandosReservados.has(first)) {
        const query = cmd.trim();

        if (onlyDigits(query).length >= 7) {
          const resultados = await buscarPorTelefonoTodos(query);
          const dedup = dedupeClientes(resultados);
          if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
          if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
          return enviarListaResultadosClientes(chatId, dedup);
        }

        const resultados = await buscarClienteRobusto(query);
        const dedup = dedupeClientes(resultados);

        if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
        if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

        return enviarListaResultadosClientes(chatId, dedup);
      }

      return;
    }

    if (wizard.has(String(chatId))) {
      if (!(await isAdmin(userId))) return;
      return wizardNext(chatId, text);
    }

    if (pending.has(String(chatId))) {
      if (!(await isAdmin(userId))) return;

      const p = pending.get(String(chatId));
      const t = String(text || "").trim();

      if (p.mode === "finIngresoMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) {
          return bot.sendMessage(chatId, "⚠️ Monto inválido. Escriba solo número.");
        }

        pending.set(String(chatId), { mode: "finIngresoBancoPick", monto });
        return bot.sendMessage(chatId, "🏦 Seleccione el banco:", {
          reply_markup: kbBancosFinanzas(),
        });
      }

      if (p.mode === "finIngresoPlataformaManual") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la plataforma o plataformas manualmente.");

        pending.set(String(chatId), {
          mode: "finIngresoDetalle",
          monto: p.monto,
          banco: p.banco,
          plataforma: t,
        });

        return bot.sendMessage(chatId, "📝 Escriba el detalle del ingreso:");
      }

      if (p.mode === "finIngresoDetalle") {
        pending.set(String(chatId), {
          mode: "finIngresoFecha",
          monto: p.monto,
          banco: p.banco,
          plataforma: p.plataforma,
          detalle: t,
        });

        return bot.sendMessage(chatId, "📅 Escriba la fecha del ingreso en formato dd/mm/yyyy o escriba hoy:");
      }

      if (p.mode === "finIngresoFecha") {
        const parsed = parseFechaFinanceInput(t);
        if (!parsed.ok) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");

        pending.delete(String(chatId));
        const ok = await registrarIngresoTx({
          monto: p.monto,
          banco: p.banco,
          plataforma: p.plataforma,
          detalle: p.detalle || "",
          fecha: parsed.fecha,
          userId,
          userName: msg.from?.first_name || "",
        });

        return bot.sendMessage(
          chatId,
          `✅ *Ingreso registrado*\n\n💰 Monto: ${moneyLps(ok.monto)}\n🏦 Banco: ${escMD(ok.banco)}\n📦 Plataforma(s): ${escMD(ok.plataforma || "-")}\n📝 Detalle: ${escMD(ok.detalle || "-")}\n📅 Fecha: ${escMD(ok.fecha)}\n🆔 ID: \`${ok.id}\``,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➕ Registrar otro ingreso", callback_data: "fin:otro:ingreso" }],
                [{ text: "⬅️ Volver a Finanzas", callback_data: "menu:pagos" }],
                [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
              ],
            },
          }
        );
      }

      if (p.mode === "finEgresoMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) {
          return bot.sendMessage(chatId, "⚠️ Monto inválido. Escriba solo número.");
        }

        pending.set(String(chatId), { mode: "finEgresoMotivoPick", monto });
        return bot.sendMessage(chatId, "🧾 Seleccione el motivo del egreso:", {
          reply_markup: kbMotivosFinanzas(),
        });
      }

      if (p.mode === "finEgresoDetalle") {
        pending.set(String(chatId), {
          mode: "finEgresoFecha",
          monto: p.monto,
          motivo: p.motivo,
          detalle: t,
        });

        return bot.sendMessage(chatId, "📅 Escriba la fecha del egreso en formato dd/mm/yyyy o escriba hoy:");
      }

      if (p.mode === "finEgresoFecha") {
        const parsed = parseFechaFinanceInput(t);
        if (!parsed.ok) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");

        pending.delete(String(chatId));
        const ok = await registrarEgresoTx({
          monto: p.monto,
          motivo: p.motivo,
          detalle: p.detalle || "",
          fecha: parsed.fecha,
          userId,
          userName: msg.from?.first_name || "",
        });

        return bot.sendMessage(
          chatId,
          `✅ *Egreso registrado*\n\n💸 Monto: ${moneyLps(ok.monto)}\n🧾 Motivo: ${escMD(ok.motivo)}\n📝 Detalle: ${escMD(ok.detalle || "-")}\n📅 Fecha: ${escMD(ok.fecha)}\n🆔 ID: \`${ok.id}\``,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➕ Registrar otro egreso", callback_data: "fin:otro:egreso" }],
                [{ text: "⬅️ Volver a Finanzas", callback_data: "menu:pagos" }],
                [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
              ],
            },
          }
        );
      }

      if (p.mode === "finResumenFechaAsk") {
        const fecha = String(t || "").trim().toLowerCase() === "hoy" ? hoyDMY() : String(t || "").trim();
        if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");

        pending.delete(String(chatId));
        const list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));
        return bot.sendMessage(chatId, resumenFinanzasTextoPorFecha(fecha, list), {
          parse_mode: "Markdown",
        });
      }

      if (p.mode === "finResumenBancoMesAsk") {
        const key = parseMonthInputToKey(t);
        if (!key) return bot.sendMessage(chatId, "⚠️ Mes inválido. Use mm/yyyy");

        pending.delete(String(chatId));
        const list = await getMovimientosPorMes(key, userId, await isSuperAdmin(userId));
        return bot.sendMessage(chatId, resumenBancosMesTexto(key, list), {
          parse_mode: "Markdown",
        });
      }

      if (p.mode === "finTopPlataformasMesAsk") {
        const key = parseMonthInputToKey(t);
        if (!key) return bot.sendMessage(chatId, "⚠️ Mes inválido. Use mm/yyyy");

        pending.delete(String(chatId));
        const list = await getMovimientosPorMes(key, userId, await isSuperAdmin(userId));
        return bot.sendMessage(chatId, resumenTopPlataformasTexto(key, list), {
          parse_mode: "Markdown",
        });
      }

      if (p.mode === "finCierreCajaAsk") {
        const fecha = String(t || "").trim().toLowerCase() === "hoy" ? hoyDMY() : String(t || "").trim();
        if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");

        pending.delete(String(chatId));
        const list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));
        return bot.sendMessage(chatId, cierreCajaTexto(fecha, list), {
          parse_mode: "Markdown",
        });
      }

      if (p.mode === "finEliminarFechaAsk") {
        const fecha = String(t || "").trim();
        if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");

        pending.delete(String(chatId));
        let list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));

        if (p.tipoFiltro) {
          list = list.filter((m) => String(m.tipo || "").toLowerCase() === String(p.tipoFiltro).toLowerCase());
        }

        if (!list.length) {
          return bot.sendMessage(
            chatId,
            p.tipoFiltro
              ? `⚠️ No hay ${p.tipoFiltro === "ingreso" ? "ingresos" : "egresos"} en esa fecha.`
              : "⚠️ No hay movimientos en esa fecha."
          );
        }

        const kb = list.slice(0, 20).map((m, i) => {
          const tipo = String(m.tipo || "").toLowerCase();
          const bancoOMotivo = tipo === "ingreso"
            ? `🏦 ${m.banco || "-"}`
            : `🧾 ${m.motivo || "-"}`;
          const detalle = m.detalle ? ` | ${m.detalle}` : "";
          const label = `${i + 1}) ${tipo === "ingreso" ? "+" : "-"} ${moneyNumber(m.monto || 0)} | ${bancoOMotivo}${detalle}`;

          return [{ text: safeBtnLabel(label, 60), callback_data: `fin:del:one:${m.id}` }];
        });

        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

        return bot.sendMessage(
          chatId,
          `🗑️ *${p.tipoFiltro === "ingreso" ? "INGRESOS" : p.tipoFiltro === "egreso" ? "EGRESOS" : "MOVIMIENTOS"} del ${escMD(fecha)}*\nSeleccione cuál eliminar:`,
          {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: kb },
          }
        );
      }

      if (p.mode === "finExcelRangoInicio") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");

        pending.set(String(chatId), {
          mode: "finExcelRangoFin",
          fechaInicio: t,
        });

        return bot.sendMessage(chatId, "📅 Escriba la fecha final en formato dd/mm/yyyy:");
      }

      if (p.mode === "finExcelRangoFin") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");

        pending.delete(String(chatId));
        return exportarFinanzasRangoExcel(
          chatId,
          p.fechaInicio,
          t,
          userId,
          await isSuperAdmin(userId)
        );
      }

      if (p.mode === "finEditMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) {
          return bot.sendMessage(chatId, "⚠️ Monto inválido.");
        }

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            monto: Number(monto),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Monto actualizado correctamente.");
      }

      if (p.mode === "finEditBanco") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el banco.");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            banco: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Banco actualizado correctamente.");
      }

      if (p.mode === "finEditMotivo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el motivo.");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            motivo: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Motivo actualizado correctamente.");
      }

      if (p.mode === "finEditPlataforma") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la plataforma.");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            plataforma: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Plataforma actualizada correctamente.");
      }

      if (p.mode === "finEditDetalle") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el detalle.");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            detalle: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Detalle actualizado correctamente.");
      }

      if (p.mode === "finEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            fecha: t,
            fechaTS: parseDMYtoTS(t),
            mesKey: getMonthKeyFromDMY(t),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Fecha actualizada correctamente.");
      }

      if (p.mode === "mailAddClienteNombre") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nombre del cliente.");

        pending.set(String(chatId), {
          mode: "mailAddClientePin",
          plataforma: p.plataforma,
          correo: p.correo,
          nombre: t,
        });

        return bot.sendMessage(chatId, "🔐 Escriba el PIN del cliente:");
      }

      if (p.mode === "mailAddClientePin") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el PIN.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        const capacidad = getCapacidadCorreo(correoData, p.plataforma);
        const ocupadosActual = clientes.length;
        const disponiblesActual = Math.max(0, capacidad - ocupadosActual);

        if (disponiblesActual <= 0) {
          return bot.sendMessage(chatId, "❌ Esta cuenta ya está llena.");
        }

        clientes.push({
          nombre: p.nombre,
          pin: t,
          slot: clientes.length + 1,
        });

        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        await ref.set(
          {
            clientes,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            capacidad,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(
          chatId,
          "✅ *Cliente agregado correctamente*\n\n" +
            `👤 *Nombre:* ${escMD(p.nombre)}\n` +
            `🔐 *PIN:* ${escMD(t)}\n\n` +
            `👤 *Ocupados:* ${ocupados}/${capacidad}\n` +
            `✅ *Disponibles:* ${disponibles}\n` +
            `📊 *Estado:* ${escMD(estado)}`,
          { parse_mode: "Markdown" }
        );

        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditPin") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nuevo PIN.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        if (p.clienteIndex < 0 || p.clienteIndex >= clientes.length) {
          return bot.sendMessage(chatId, "❌ Cliente inválido.");
        }

        clientes[p.clienteIndex] = {
          ...clientes[p.clienteIndex],
          pin: t,
        };

        await ref.set(
          {
            clientes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(chatId, "✅ PIN actualizado correctamente.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditClaveCorreo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la nueva clave.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        await found.ref.set(
          {
            clave: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(chatId, "✅ Clave del correo actualizada.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "invSumarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) {
          return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");
        }

        pending.delete(String(chatId));

        const correo = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

        const d = doc.data() || {};
        const capacidad = Number(d.capacidad || d.total || getCapacidadCorreo(d, plat) || 0);
        const clientes = Array.isArray(d.clientes) ? d.clientes : [];
        const ocupados = clientes.length;
        const nuevaCapacidad = Math.max(capacidad, ocupados + qty);
        const disponibles = Math.max(0, nuevaCapacidad - ocupados);

        await ref.set(
          {
            capacidad: nuevaCapacidad,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (p.mode === "invRestarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) {
          return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");
        }

        pending.delete(String(chatId));

        const correo = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

        const d = doc.data() || {};
        const clientes = Array.isArray(d.clientes) ? d.clientes : [];
        const ocupados = clientes.length;
        const capacidadActual = Number(d.capacidad || d.total || getCapacidadCorreo(d, plat) || 0);
        const nuevaCapacidad = Math.max(ocupados, capacidadActual - qty);
        const disponibles = Math.max(0, nuevaCapacidad - ocupados);

        const antes = {
          ...d,
          disp: Math.max(0, capacidadActual - ocupados),
          capacidad: capacidadActual,
        };

        await ref.set(
          {
            capacidad: nuevaCapacidad,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        const despues = {
          ...d,
          disp: disponibles,
          plataforma: plat,
          correo,
          capacidad: nuevaCapacidad,
        };

        await aplicarAutoLleno(chatId, ref, antes, despues);

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (p.mode === "invEditClave") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Clave vacía.");

        pending.delete(String(chatId));

        const correo = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

        await ref.set(
          {
            clave: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (p.mode === "cliRenovarFechaManual") {
        const fecha = String(t || "").trim();
        if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");

        pending.delete(String(chatId));

        const ref = db.collection("clientes").doc(String(p.clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (p.idx < 0 || p.idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        servicios[p.idx] = { ...(servicios[p.idx] || {}), fechaRenovacion: fecha };
        await ref.set(
          {
            servicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliEditNombre") {
        const actual = await getCliente(p.clientId);
        if (!actual) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        }

        const dup = await clienteDuplicado(t, actual.telefono || "", p.clientId);
        if (dup) {
          return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        }

        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          {
            nombrePerfil: t,
            nombre_norm: String(t || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim()
              .replace(/\s+/g, " "),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditTel") {
        const actual = await getCliente(p.clientId);
        if (!actual) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        }

        const dup = await clienteDuplicado(actual.nombrePerfil || "", t, p.clientId);
        if (dup) {
          return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        }

        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          {
            telefono: t,
            telefono_norm: onlyDigits(t),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditVendedor") {
        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          {
            vendedor: t,
            vendedor_norm: String(t || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim()
              .replace(/\s+/g, " "),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliAddServMail") {
        if (!t.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido. Escriba el correo:");

        pending.set(String(chatId), {
          mode: "cliAddServPin",
          clientId: p.clientId,
          plat: p.plat,
          mail: t.toLowerCase(),
        });

        return bot.sendMessage(chatId, "🔐 Escriba el pin/clave:");
      }

      if (p.mode === "cliAddServPin") {
        pending.set(String(chatId), {
          mode: "cliAddServPrecio",
          clientId: p.clientId,
          plat: p.plat,
          mail: p.mail,
          pin: t,
        });

        return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
      }

      if (p.mode === "cliAddServPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) {
          return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
        }

        pending.set(String(chatId), {
          mode: "cliAddServFecha",
          clientId: p.clientId,
          plat: p.plat,
          mail: p.mail,
          pin: p.pin,
          precio: n,
        });

        return bot.sendMessage(chatId, "📅 Fecha renovación (dd/mm/yyyy):");
      }

      if (p.mode === "cliAddServFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");

        pending.delete(String(chatId));

        await addServicioTx(String(p.clientId), {
          plataforma: p.plat,
          correo: p.mail,
          pin: p.pin,
          precio: p.precio,
          fechaRenovacion: t,
        });

        return enviarFichaCliente(chatId, p.clientId);
      }

      if (p.mode === "cliServEditMail") {
        if (!t.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido.");

        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { correo: t.toLowerCase() });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPin") {
        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { pin: t });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido.");

        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { precio: n });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");

        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { fechaRenovacion: t });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      return;
    }
  } catch (err) {
    logErr("message handler error:", err?.message || err);
    if (chatId) {
      try {
        await bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
      } catch (_) {}
    }
  }
});

// ===============================
// AUTO TXT 7AM
// ===============================
let _lastDailyRun = "";

async function getLastRunDB() {
  const ref = db.collection("config").doc("dailyRun");
  const doc = await ref.get();
  return doc.exists ? String(doc.data()?.lastRun || "") : "";
}

async function setLastRunDB(dmy) {
  const ref = db.collection("config").doc("dailyRun");
  await ref.set(
    {
      lastRun: String(dmy),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function getTimePartsNow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("es-HN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const obj = {};
  fmt.forEach((p) => {
    if (p.type !== "literal") obj[p.type] = p.value;
  });

  return {
    dmy: `${obj.day}/${obj.month}/${obj.year}`,
    hh: Number(obj.hour),
    mm: Number(obj.minute),
  };
}

async function enviarTxtRenovacionesDiariasPorVendedor() {
  if (!hasRuntimeLock()) return;

  const { dmy } = getTimePartsNow();

  const snap = await db.collection("revendedores").get();
  if (snap.empty) return;

  for (const doc of snap.docs) {
    const rev = normalizeRevendedorDoc(doc);

    if (!rev.activo || !rev.nombre || !rev.telegramId) continue;

    const list = await obtenerRenovacionesPorFecha(dmy, rev.nombre);
    await enviarTXT(rev.telegramId, list, dmy, rev.nombre);

    await doc.ref.set(
      {
        autoLastSent: dmy,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

setInterval(async () => {
  if (!hasRuntimeLock()) return;

  try {
    const { dmy, hh, mm } = getTimePartsNow();

    if (hh === 7 && mm === 0) {
      const dbLast = await getLastRunDB();
      if (_lastDailyRun === dmy || dbLast === dmy) return;

      _lastDailyRun = dmy;
      await setLastRunDB(dmy);
      await enviarTxtRenovacionesDiariasPorVendedor();

      console.log(`ℹ️ ✅ AutoTXT 7AM enviado (${dmy}) TZ=${TZ}`);
    }
  } catch (e) {
    logErr("AutoTXT error:", e?.message || e);
  }
}, 30 * 1000);

// ===============================
// HARDEN
// ===============================
process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
});

process.on("SIGINT", async () => {
  console.log("⚠️ SIGINT recibido, cerrando polling...");
  try {
    await hardStopBot().catch(() => {});
    await releaseRuntimeLock().catch(() => {});
  } catch (_) {}
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("⚠️ SIGTERM recibido, cerrando polling...");
  try {
    await hardStopBot().catch(() => {});
    await releaseRuntimeLock().catch(() => {});
  } catch (_) {}
  process.exit(0);
});

// ===============================
// HTTP KEEPALIVE FINAL
// ===============================
const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(getCoreHealth()));
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, () => {
    console.log("🌐 HTTP KEEPALIVE activo en puerto", PORT);
  });
