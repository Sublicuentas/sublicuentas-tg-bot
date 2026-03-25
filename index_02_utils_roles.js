/* ✅ SUBLICUENTAS TG BOT — PARTE 2/6 ACTUALIZADA
   UTILS / ROLES / HELPERS / FORMATOS / PANEL STATE
   ------------------------------------------------
   Compatible con partes 3, 4, 5 y 6 finales
   Incluye:
   - admins / vendedores
   - helpers de texto y fechas
   - parseos de finanzas
   - paneles anclados
   - maps globales (wizard, pending, panelMsgId)
   - fix global de escMD sin plecas raras
*/

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  bot,
  admin,
  db,
  SUPER_ADMIN,
  PLATAFORMAS,
  ADMINS_COLLECTION,
  REVENDEDORES_COLLECTION,
} = require("./index_01_core");

// ===============================
// STATE GLOBAL
// ===============================
if (!global.__SUBLICUENTAS_PANEL_MSG_ID__) global.__SUBLICUENTAS_PANEL_MSG_ID__ = new Map();
if (!global.__SUBLICUENTAS_PENDING__) global.__SUBLICUENTAS_PENDING__ = new Map();
if (!global.__SUBLICUENTAS_WIZARD__) global.__SUBLICUENTAS_WIZARD__ = new Map();

const panelMsgId = global.__SUBLICUENTAS_PANEL_MSG_ID__;
const pending = global.__SUBLICUENTAS_PENDING__;
const wizard = global.__SUBLICUENTAS_WIZARD__;

// ===============================
// LOG
// ===============================
function logErr(label = "", err = null) {
  try {
    console.error(`❌ ${label}:`, err?.stack || err?.message || err);
  } catch (_) {
    console.error(`❌ ${label}:`, err);
  }
}

// ===============================
// TEXTO
// ===============================
function stripAcentos(text = "") {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normTxt(text = "") {
  return stripAcentos(String(text || ""))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function limpiarQuery(text = "") {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function onlyDigits(text = "") {
  return String(text || "").replace(/\D+/g, "");
}

function isEmailLike(text = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(text || "").trim());
}

function esTelefono(text = "") {
  const d = onlyDigits(text);
  return d.length >= 7 && d.length <= 15;
}

function safeBtnLabel(text = "", max = 58) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trim()}…`;
}

// FIX GLOBAL: no escapar . + - @ / etc para Markdown simple
function escMD(text = "") {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[");
}

// ===============================
// FECHAS
// ===============================
function isFechaDMY(text = "") {
  const s = String(text || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  return (
    dt.getFullYear() === yyyy &&
    dt.getMonth() === mm - 1 &&
    dt.getDate() === dd
  );
}

function normalizeDMY(text = "") {
  if (!isFechaDMY(text)) return "";
  const [dd, mm, yyyy] = String(text || "").trim().split("/").map(Number);
  return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
}

function hoyDMY() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function parseFechaFinanceInput(raw = "") {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "hoy") return hoyDMY();

  const clean = s.replace(/[-.]/g, "/");
  const m = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;

  const dd = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  const yyyy = String(m[3]);
  const out = `${dd}/${mm}/${yyyy}`;
  return isFechaDMY(out) ? out : null;
}

function ymdFromDMY(dmy = "") {
  const f = normalizeDMY(dmy);
  if (!f) return "";
  const [dd, mm, yyyy] = f.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDMYtoTS(dmy = "") {
  const f = normalizeDMY(dmy);
  if (!f) return 0;
  const [dd, mm, yyyy] = f.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0).getTime();
}

function startOfDayTS(dmy = "") {
  const f = normalizeDMY(dmy);
  if (!f) return 0;
  const [dd, mm, yyyy] = f.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, 0, 0, 0, 0).getTime();
}

function endOfDayTS(dmy = "") {
  const f = normalizeDMY(dmy);
  if (!f) return 0;
  const [dd, mm, yyyy] = f.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, 23, 59, 59, 999).getTime();
}

function addDaysDMY(dmy = "", days = 0) {
  const f = normalizeDMY(dmy || hoyDMY());
  if (!f) return hoyDMY();
  const [dd, mm, yyyy] = f.split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + Number(days || 0));
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getFullYear())}`;
}

function getMonthKeyFromDMY(dmy = "") {
  const f = normalizeDMY(dmy);
  if (!f) return "";
  const [, mm, yyyy] = f.split("/");
  return `${yyyy}-${mm}`;
}

function parseMonthInputToKey(raw = "") {
  const s = String(raw || "").trim().replace(/[-.]/g, "/");
  const m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = String(Number(m[1])).padStart(2, "0");
  const yyyy = String(m[2]);
  return `${yyyy}-${mm}`;
}

function getMonthLabelFromKey(key = "") {
  const s = String(key || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return s || "-";
  const yyyy = m[1];
  const mm = m[2];
  const meses = {
    "01": "Enero",
    "02": "Febrero",
    "03": "Marzo",
    "04": "Abril",
    "05": "Mayo",
    "06": "Junio",
    "07": "Julio",
    "08": "Agosto",
    "09": "Septiembre",
    "10": "Octubre",
    "11": "Noviembre",
    "12": "Diciembre",
  };
  return `${meses[mm] || mm} ${yyyy}`;
}

// ===============================
// DINERO
// ===============================
function parseMontoNumber(raw = "") {
  const s = String(raw || "").trim().replace(/,/g, ".");
  const clean = s.replace(/[^\d.-]/g, "");
  const n = Number(clean);
  return Number.isFinite(n) ? n : NaN;
}

function moneyNumber(raw = 0) {
  const n = Number(raw || 0);
  return Number.isFinite(n) ? n : 0;
}

function moneyLps(raw = 0) {
  const n = moneyNumber(raw);
  return `${n.toFixed(2)} Lps`;
}

// ===============================
// PLATAFORMAS / INVENTARIO
// ===============================
const PLATFORM_KEYS = Array.isArray(PLATAFORMAS)
  ? PLATAFORMAS.map((x) => String(x || "").trim().toLowerCase())
  : Object.keys(PLATAFORMAS || {}).map((x) => String(x || "").trim().toLowerCase());

function normalizarPlataforma(text = "") {
  const k = normTxt(text).replace(/\s+/g, "");
  const map = {
    "netflix": "netflix",
    "vipnetflix": "vipnetflix",
    "vip netflix": "vipnetflix",
    "disneyp": "disneyp",
    "disneypremium": "disneyp",
    "disney premium": "disneyp",
    "disneys": "disneys",
    "disneystandard": "disneys",
    "disney standard": "disneys",
    "hbomax": "hbomax",
    "hbo max": "hbomax",
    "primevideo": "primevideo",
    "prime video": "primevideo",
    "paramount": "paramount",
    "paramount+": "paramount",
    "crunchyroll": "crunchyroll",
    "vix": "vix",
    "appletv": "appletv",
    "apple tv": "appletv",
    "universal": "universal",
    "universal+": "universal",
    "spotify": "spotify",
    "youtube": "youtube",
    "deezer": "deezer",
    "oleada1": "oleadatv1",
    "oleadatv1": "oleadatv1",
    "oleada 1": "oleadatv1",
    "oleada3": "oleadatv3",
    "oleadatv3": "oleadatv3",
    "oleada 3": "oleadatv3",
    "iptv1": "iptv1",
    "iptv 1": "iptv1",
    "iptv3": "iptv3",
    "iptv 3": "iptv3",
    "iptv4": "iptv4",
    "iptv 4": "iptv4",
    "canva": "canva",
    "gemini": "gemini",
    "chatgpt": "chatgpt",
  };
  return map[k] || k;
}

function esPlataformaValida(text = "") {
  return PLATFORM_KEYS.includes(normalizarPlataforma(text));
}

function getIdentLabel(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) return "Usuario";
  return "Correo";
}

function normalizeIdentByPlatform(plataforma = "", ident = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(ident || "").trim();
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) {
    return v;
  }
  return v.toLowerCase();
}

function validateIdentByPlatform(plataforma = "", ident = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(ident || "").trim();
  if (!v) return false;
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) {
    return v.length >= 3 && !/\s/.test(v);
  }
  return isEmailLike(v);
}

function docIdInventario(ident = "", plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const i = normalizeIdentByPlatform(p, ident)
    .toLowerCase()
    .replace(/[.#$/\[\]\s]+/g, "_");
  return `${p}__${i}`;
}

// ===============================
// ROLES
// ===============================
function normalizeRevendedorDoc(docOrData = {}) {
  const data = typeof docOrData.data === "function" ? (docOrData.data() || {}) : (docOrData || {});
  const id = typeof docOrData.id !== "undefined" ? docOrData.id : data.id;
  return {
    id: String(id || "").trim(),
    nombre: String(data.nombre || "").trim(),
    nombre_norm: normTxt(data.nombre || data.nombre_norm || ""),
    telegramId: String(data.telegramId || "").trim(),
    activo: data.activo !== false,
    autoLastSent: String(data.autoLastSent || "").trim(),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

async function isSuperAdmin(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return false;

  if (uid === String(SUPER_ADMIN || "").trim()) return true;

  try {
    const doc = await db.collection(ADMINS_COLLECTION || "admins").doc(uid).get();
    if (!doc.exists) return false;

    const data = doc.data() || {};
    return (
      data.superAdmin === true ||
      data.superadmin === true ||
      String(data.rol || "").toLowerCase() === "superadmin" ||
      String(data.role || "").toLowerCase() === "superadmin"
    );
  } catch (e) {
    logErr("isSuperAdmin", e);
    return false;
  }
}

async function isAdmin(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  if (await isSuperAdmin(uid)) return true;

  try {
    const doc = await db.collection(ADMINS_COLLECTION || "admins").doc(uid).get();
    if (doc.exists) {
      const data = doc.data() || {};
      return data.activo !== false;
    }
  } catch (e) {
    logErr("isAdmin", e);
  }
  return false;
}

async function getRevendedorPorTelegramId(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  try {
    const snap = await db.collection(REVENDEDORES_COLLECTION || "revendedores")
      .where("telegramId", "==", uid)
      .limit(1)
      .get();

    if (!snap.empty) {
      const row = normalizeRevendedorDoc(snap.docs[0]);
      if (row.activo) return row;
    }
  } catch (_) {}

  try {
    const snap = await db.collection(REVENDEDORES_COLLECTION || "revendedores").get();
    for (const d of snap.docs) {
      const row = normalizeRevendedorDoc(d);
      if (String(row.telegramId) === uid && row.activo) return row;
    }
  } catch (e) {
    logErr("getRevendedorPorTelegramId", e);
  }

  return null;
}

async function isVendedor(userId) {
  const row = await getRevendedorPorTelegramId(userId);
  return !!(row && row.activo);
}

async function setTelegramIdToRevendedor(docId, telegramId) {
  const id = String(docId || "").trim();
  const tg = String(telegramId || "").trim();
  if (!id || !tg) throw new Error("DocId o telegramId inválido");

  await db.collection(REVENDEDORES_COLLECTION || "revendedores").doc(id).set(
    {
      telegramId: tg,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}

// ===============================
// TXT / DOCUMENTOS
// ===============================
async function enviarTxtComoArchivo(chatId, text = "", filename = "archivo.txt") {
  const safeName = String(filename || "archivo.txt").replace(/[^\w.\-]+/g, "_");
  const tempPath = path.join(os.tmpdir(), `${Date.now()}_${safeName}`);

  try {
    fs.writeFileSync(tempPath, String(text || ""), "utf8");
    await bot.sendDocument(chatId, tempPath);
  } finally {
    try { fs.unlinkSync(tempPath); } catch (_) {}
  }
}

async function sendCommandAnchoredPanel(chatId, text, keyboardArg = [], parseMode = "Markdown") {
  return upsertPanel(chatId, text, keyboardArg, parseMode);
}

// ===============================
// PANEL ANCLADO
// ===============================
function buildReplyMarkup(keyboardArg) {
  if (Array.isArray(keyboardArg)) {
    return { inline_keyboard: keyboardArg };
  }
  if (keyboardArg && keyboardArg.inline_keyboard) {
    return keyboardArg;
  }
  if (keyboardArg && keyboardArg.reply_markup) {
    return keyboardArg.reply_markup;
  }
  return { inline_keyboard: [] };
}

async function upsertPanel(chatId, text, keyboardArg = [], parseMode = "Markdown") {
  const reply_markup = buildReplyMarkup(keyboardArg);
  const key = String(chatId);

  const payload = {
    parse_mode: parseMode,
    reply_markup,
    disable_web_page_preview: true,
  };

  const oldMsgId = panelMsgId.get(key);

  if (oldMsgId) {
    try {
      await bot.editMessageText(String(text || ""), {
        chat_id: chatId,
        message_id: oldMsgId,
        ...payload,
      });
      try {
        await bot.editMessageReplyMarkup(reply_markup, {
          chat_id: chatId,
          message_id: oldMsgId,
        });
      } catch (_) {}
      return { chat: { id: chatId }, message_id: oldMsgId };
    } catch (_) {}
  }

  const sent = await bot.sendMessage(chatId, String(text || ""), payload);
  panelMsgId.set(key, sent.message_id);
  return sent;
}

function bindPanelFromCallback(query = {}) {
  try {
    const chatId = query?.message?.chat?.id;
    const messageId = query?.message?.message_id;
    if (chatId && messageId) panelMsgId.set(String(chatId), messageId);
  } catch (_) {}
}

// ===============================
// WIZARD HELPERS
// ===============================
function w(chatId) {
  return wizard.get(String(chatId));
}

function wset(chatId, value) {
  wizard.set(String(chatId), value);
  return value;
}

function wclear(chatId) {
  wizard.delete(String(chatId));
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  // core refs
  bot,
  admin,
  db,

  // state maps
  panelMsgId,
  pending,
  wizard,

  // log
  logErr,

  // texto
  stripAcentos,
  normTxt,
  limpiarQuery,
  onlyDigits,
  isEmailLike,
  esTelefono,
  safeBtnLabel,
  escMD,

  // fechas
  isFechaDMY,
  normalizeDMY,
  hoyDMY,
  parseFechaFinanceInput,
  ymdFromDMY,
  parseDMYtoTS,
  startOfDayTS,
  endOfDayTS,
  addDaysDMY,
  getMonthKeyFromDMY,
  parseMonthInputToKey,
  getMonthLabelFromKey,

  // dinero
  parseMontoNumber,
  moneyNumber,
  moneyLps,

  // plataformas / inventario
  normalizarPlataforma,
  esPlataformaValida,
  getIdentLabel,
  normalizeIdentByPlatform,
  validateIdentByPlatform,
  docIdInventario,

  // roles
  normalizeRevendedorDoc,
  isSuperAdmin,
  isAdmin,
  isVendedor,
  getRevendedorPorTelegramId,
  setTelegramIdToRevendedor,

  // panel / archivos
  enviarTxtComoArchivo,
  sendCommandAnchoredPanel,
  upsertPanel,
  bindPanelFromCallback,

  // wizard
  w,
  wset,
  wclear,
};
