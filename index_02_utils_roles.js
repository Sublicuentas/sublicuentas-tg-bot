/* ✅ SUBLICUENTAS TG BOT — INDEX 02 UTILS / ROLES
   HELPERS / ROLES / PARSERS / PANEL STATE / FORMATTERS
   ----------------------------------------------------
   Reconstruido para compatibilidad con index 01, 03, 05 y 06.
   Objetivos:
   - SUPER ADMIN estable por ENV
   - Admins y vendedores con fallback seguro
   - Helpers de fechas, dinero y normalización
   - upsertPanel robusto
   - Sin lanzar errores fatales al bot

   ✅ AJUSTE CLAVE:
   - escMD corregido para Markdown normal (sin barras invertidas en correos)
*/

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  bot,
  admin,
  db,
  TZ,
  SUPER_ADMIN,
  PLATAFORMAS,
} = require("./index_01_core");

// ===============================
// ESTADO GLOBAL / MAPS
// ===============================
if (!global.__SUBLICUENTAS_PANEL_MSG_ID__) {
  global.__SUBLICUENTAS_PANEL_MSG_ID__ = new Map();
}
if (!global.__SUBLICUENTAS_PENDING__) {
  global.__SUBLICUENTAS_PENDING__ = new Map();
}
if (!global.__SUBLICUENTAS_WIZARD__) {
  global.__SUBLICUENTAS_WIZARD__ = new Map();
}

const panelMsgId = global.__SUBLICUENTAS_PANEL_MSG_ID__;
const pending = global.__SUBLICUENTAS_PENDING__;
const wizard = global.__SUBLICUENTAS_WIZARD__;

// ===============================
// LOGS
// ===============================
function logErr(scope = "error", err = "") {
  const msg = err?.stack || err?.message || String(err || "");
  console.error(`❌ [${scope}]`, msg);
}

// ===============================
// NORMALIZADORES
// ===============================
function normTxt(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limpiarQuery(v = "") {
  return String(v || "")
    .replace(/^\/+/, "")
    .replace(/@\w+$/i, "")
    .trim();
}

function onlyDigits(v = "") {
  return String(v || "").replace(/\D+/g, "");
}

function isEmailLike(v = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(v || "").trim());
}

function normalizeRevendedorDoc(data = {}) {
  const nombre = String(data.nombre || data.name || "").trim();
  return {
    ...data,
    nombre,
    nombre_norm: normTxt(data.nombre_norm || nombre),
    telegramId: data.telegramId != null ? String(data.telegramId).trim() : "",
    activo: data.activo !== false,
  };
}

function humanPlataformaFallback(key = "") {
  const p = normalizarPlataforma(key);
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
    universal: "Universal",
    spotify: "Spotify",
    youtube: "YouTube",
    deezer: "Deezer",
    oleadatv1: "OleadaTV (1)",
    oleadatv3: "OleadaTV (3)",
    iptv1: "IPTV (1)",
    iptv3: "IPTV (3)",
    iptv4: "IPTV (4)",
    canva: "Canva",
    gemini: "Gemini",
    chatgpt: "ChatGPT",
  };
  return map[p] || String(key || "");
}

function normalizarPlataforma(v = "") {
  let s = normTxt(v)
    .replace(/[+]/g, "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases = {
    "netflix": "netflix",
    "vip netflix": "vipnetflix",
    "vipnetflix": "vipnetflix",
    "disney premium": "disneyp",
    "disneyp": "disneyp",
    "disney standard": "disneys",
    "disneys": "disneys",
    "hbo": "hbomax",
    "hbo max": "hbomax",
    "hbomax": "hbomax",
    "prime": "primevideo",
    "prime video": "primevideo",
    "primevideo": "primevideo",
    "paramount": "paramount",
    "paramount plus": "paramount",
    "paramount+": "paramount",
    "crunchyroll": "crunchyroll",
    "vix": "vix",
    "apple tv": "appletv",
    "appletv": "appletv",
    "universal": "universal",
    "spotify": "spotify",
    "youtube": "youtube",
    "youtube premium": "youtube",
    "deezer": "deezer",
    "oleada": "oleadatv1",
    "oleadatv": "oleadatv1",
    "oleadatv 1": "oleadatv1",
    "oleada 1": "oleadatv1",
    "oleadatv 3": "oleadatv3",
    "oleada 3": "oleadatv3",
    "iptv": "iptv1",
    "iptv 1": "iptv1",
    "iptv 3": "iptv3",
    "iptv 4": "iptv4",
    "canva": "canva",
    "gemini": "gemini",
    "chatgpt": "chatgpt",
  };

  if (aliases[s]) return aliases[s];

  s = s.replace(/\s+/g, "");
  const aliasesCompact = {
    vipnetflix: "vipnetflix",
    disneypremium: "disneyp",
    disneyp: "disneyp",
    disneystandard: "disneys",
    disneys: "disneys",
    hbomax: "hbomax",
    primevideo: "primevideo",
    paramount: "paramount",
    crunchyroll: "crunchyroll",
    appletv: "appletv",
    oleadatv1: "oleadatv1",
    oleada1: "oleadatv1",
    oleadatv3: "oleadatv3",
    oleada3: "oleadatv3",
    iptv1: "iptv1",
    iptv3: "iptv3",
    iptv4: "iptv4",
  };

  return aliasesCompact[s] || s;
}

function esPlataformaValida(v = "") {
  const p = normalizarPlataforma(v);
  if (!p) return false;
  if (Array.isArray(PLATAFORMAS)) return PLATAFORMAS.includes(p);
  return Object.prototype.hasOwnProperty.call(PLATAFORMAS || {}, p);
}

// ===============================
// MARKDOWN / TEXTO
// ===============================
function escMD(v = "") {
  return String(v ?? "").replace(/([_*`\[])/g, "\\$1");
}

function moneyNumber(v = 0) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function moneyLps(v = 0) {
  return `${moneyNumber(v).toFixed(2)} Lps`;
}

// ===============================
// FECHAS / TZ
// ===============================
function getNowPartsTZ() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("es-HN", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const out = {};
  fmt.forEach((p) => {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  return out;
}

function hoyDMY() {
  const p = getNowPartsTZ();
  return `${p.day}/${p.month}/${p.year}`;
}

function isFechaDMY(v = "") {
  const s = String(v || "").trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return false;
  const [dd, mm, yyyy] = s.split("/").map(Number);
  if (yyyy < 2000 || yyyy > 2100) return false;
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  return (
    dt.getUTCFullYear() === yyyy &&
    dt.getUTCMonth() === mm - 1 &&
    dt.getUTCDate() === dd
  );
}

function parseFechaFinanceInput(v = "") {
  const s0 = String(v || "").trim();
  if (!s0) return null;
  const s = normTxt(s0);
  if (s === "hoy") return hoyDMY();

  if (isFechaDMY(s0)) return s0;

  let m = s0.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    const yyyy = String(m[3]);
    const dmy = `${dd}/${mm}/${yyyy}`;
    return isFechaDMY(dmy) ? dmy : null;
  }

  m = s0.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const yyyy = String(m[1]);
    const mm = String(m[2]).padStart(2, "0");
    const dd = String(m[3]).padStart(2, "0");
    const dmy = `${dd}/${mm}/${yyyy}`;
    return isFechaDMY(dmy) ? dmy : null;
  }

  return null;
}

function ymdFromDMY(dmy = "") {
  if (!isFechaDMY(dmy)) return "";
  const [dd, mm, yyyy] = String(dmy).split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDMYtoTS(dmy = "") {
  if (!isFechaDMY(dmy)) return 0;
  const [dd, mm, yyyy] = String(dmy).split("/").map(Number);
  return Date.UTC(yyyy, mm - 1, dd, 12, 0, 0);
}

function startOfDayTS(dmy = "") {
  if (!isFechaDMY(dmy)) return 0;
  const [dd, mm, yyyy] = String(dmy).split("/").map(Number);
  return Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0);
}

function endOfDayTS(dmy = "") {
  if (!isFechaDMY(dmy)) return 0;
  const [dd, mm, yyyy] = String(dmy).split("/").map(Number);
  return Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999);
}

function getMonthKeyFromDMY(dmy = "") {
  if (!isFechaDMY(dmy)) return "";
  const [, mm, yyyy] = String(dmy).split("/");
  return `${yyyy}-${mm}`;
}

function parseMonthInputToKey(v = "") {
  const s = String(v || "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  return "";
}

function getMonthLabelFromKey(key = "") {
  const m = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(key || "");
  const meses = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  return `${meses[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

function parseMontoNumber(v = "") {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v || "").trim();
  if (!s) return NaN;
  s = s.replace(/Lps\.?/gi, "").replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ===============================
// ROLES / PERMISOS
// ===============================
function getSuperAdminIdSet() {
  const raw = String(SUPER_ADMIN || "").trim();
  const out = new Set();
  if (!raw) return out;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach((x) => {
        const v = String(x || "").trim();
        if (v) out.add(v);
      });
      return out;
    }
  } catch (_) {}

  raw
    .split(/[\s,;|]+/)
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .forEach((x) => out.add(x));

  return out;
}

async function findDocByUidInCollection(collectionName = "", uid = "", fieldNames = []) {
  try {
    const col = String(collectionName || "").trim();
    const id = String(uid || "").trim();
    if (!col || !id) return null;

    try {
      const byId = await db.collection(col).doc(id).get();
      if (byId.exists) return { id: byId.id, ...(byId.data() || {}) };
    } catch (eById) {
      logErr(`findDocByUidInCollection.doc.${col}`, eById);
    }

    for (const field of fieldNames) {
      try {
        const snap = await db.collection(col).where(field, "==", id).limit(1).get();
        if (!snap.empty) {
          const d = snap.docs[0];
          return { id: d.id, ...(d.data() || {}) };
        }
      } catch (eQuery) {
        logErr(`findDocByUidInCollection.query.${col}.${field}`, eQuery);
      }
    }

    try {
      const snapAll = await db.collection(col).get();
      let found = null;
      snapAll.forEach((d) => {
        if (found) return;
        const data = d.data() || {};
        const candidates = [
          d.id,
          data.telegramId,
          data.userId,
          data.uid,
          data.idTelegram,
          data.telegram_id,
          data.chatId,
          data.ownerId,
          data.adminId,
        ]
          .map((x) => String(x || "").trim())
          .filter(Boolean);

        if (candidates.includes(id)) {
          found = { id: d.id, ...data };
        }
      });
      if (found) return found;
    } catch (eScan) {
      logErr(`findDocByUidInCollection.scan.${col}`, eScan);
    }

    return null;
  } catch (e) {
    logErr("findDocByUidInCollection", e);
    return null;
  }
}

async function getAdminDocById(uid = "") {
  try {
    const id = String(uid || "").trim();
    if (!id) return null;

    const collections = ["admins", "admin", "backoffice", "usuarios_admin"];
    const fields = ["telegramId", "userId", "uid", "idTelegram", "telegram_id", "chatId", "ownerId", "adminId"];

    for (const col of collections) {
      const found = await findDocByUidInCollection(col, id, fields);
      if (found) return found;
    }

    return null;
  } catch (e) {
    logErr("getAdminDocById", e);
    return null;
  }
}

async function isSuperAdmin(userId) {
  try {
    const uid = String(userId || "").trim();
    if (!uid) return false;

    const superIds = getSuperAdminIdSet();
    if (superIds.has(uid)) return true;

    const adminDoc = await getAdminDocById(uid);
    if (!adminDoc) return false;

    return (
      adminDoc.superAdmin === true ||
      adminDoc.isSuperAdmin === true ||
      normTxt(adminDoc.rol || "") === "superadmin" ||
      normTxt(adminDoc.role || "") === "superadmin"
    );
  } catch (e) {
    logErr("isSuperAdmin", e);
    return false;
  }
}

async function isAdmin(userId) {
  try {
    const uid = String(userId || "").trim();
    if (!uid) return false;

    if (await isSuperAdmin(uid)) return true;

    const adminDoc = await getAdminDocById(uid);
    if (!adminDoc) return false;

    return adminDoc.activo !== false;
  } catch (e) {
    logErr("isAdmin", e);
    return false;
  }
}

async function getRevendedorPorTelegramId(userId) {
  try {
    const uid = String(userId || "").trim();
    if (!uid) return null;

    if (await isAdmin(uid)) return null;

    const collections = ["revendedores", "vendedores"];
    const fields = ["telegramId", "userId", "uid", "idTelegram", "telegram_id", "chatId"];

    for (const colName of collections) {
      const found = await findDocByUidInCollection(colName, uid, fields);
      if (!found) continue;

      const rev = normalizeRevendedorDoc(found);
      if (rev.activo !== false) return { id: found.id, ...rev };
    }

    return null;
  } catch (e) {
    logErr("getRevendedorPorTelegramId", e);
    return null;
  }
}

async function isVendedor(userId) {
  try {
    if (await isAdmin(userId)) return false;
    const rev = await getRevendedorPorTelegramId(userId);
    return !!(rev && rev.activo !== false);
  } catch (e) {
    logErr("isVendedor", e);
    return false;
  }
}

async function setTelegramIdToRevendedor(revDocId, telegramId) {
  try {
    const docId = String(revDocId || "").trim();
    const tg = String(telegramId || "").trim();
    if (!docId || !tg) throw new Error("Falta revDocId o telegramId");

    const collections = ["revendedores", "vendedores"];
    let updated = false;

    for (const col of collections) {
      try {
        const ref = db.collection(col).doc(docId);
        const doc = await ref.get();
        if (!doc.exists) continue;

        await ref.set(
          {
            telegramId: tg,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        updated = true;
      } catch (eCol) {
        logErr(`setTelegramIdToRevendedor.${col}`, eCol);
      }
    }

    if (!updated) {
      await db.collection("revendedores").doc(docId).set(
        {
          telegramId: tg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return true;
  } catch (e) {
    logErr("setTelegramIdToRevendedor", e);
    return false;
  }
}

async function allowMsg(userId) {
  try {
    if (await isAdmin(userId)) return true;
    if (await isVendedor(userId)) return true;
    return false;
  } catch (e) {
    logErr("allowMsg", e);
    return false;
  }
}

// ===============================
// PANEL / MENSAJES
// ===============================
function bindPanelFromCallback(q) {
  try {
    const chatId = q?.message?.chat?.id;
    const messageId = q?.message?.message_id;
    if (!chatId || !messageId) return false;
    panelMsgId.set(String(chatId), messageId);
    return true;
  } catch (e) {
    logErr("bindPanelFromCallback", e);
    return false;
  }
}

function normalizeInlineKeyboard(keyboard = []) {
  if (!Array.isArray(keyboard)) return [];
  return keyboard
    .filter((row) => Array.isArray(row) && row.length)
    .map((row) =>
      row
        .filter((btn) => btn && typeof btn === "object" && btn.text)
        .map((btn) => ({ ...btn }))
    )
    .filter((row) => row.length);
}

async function upsertPanel(chatId, text, inlineKeyboard = [], parseMode = "Markdown") {
  const chatKey = String(chatId);
  const keyboard = normalizeInlineKeyboard(inlineKeyboard);
  const reply_markup = { inline_keyboard: keyboard };
  const knownMsgId = panelMsgId.get(chatKey);

  if (knownMsgId) {
    try {
      await bot.editMessageText(String(text || ""), {
        chat_id: chatId,
        message_id: knownMsgId,
        parse_mode: parseMode,
        reply_markup,
      });
      return { chat_id: chatId, message_id: knownMsgId, edited: true };
    } catch (e) {
      const msg = String(e?.message || e || "");
      const ignorable =
        msg.includes("message is not modified") ||
        msg.includes("message to edit not found") ||
        msg.includes("message can't be edited") ||
        msg.includes("MESSAGE_NOT_MODIFIED");

      if (!ignorable) {
        logErr("upsertPanel.edit", e);
      }
    }
  }

  try {
    const sent = await bot.sendMessage(chatId, String(text || ""), {
      parse_mode: parseMode,
      reply_markup,
    });
    if (sent?.message_id) panelMsgId.set(chatKey, sent.message_id);
    return sent;
  } catch (e) {
    logErr("upsertPanel.send", e);
    throw e;
  }
}

async function sendCommandAnchoredPanel(chatId, text, inlineKeyboard = [], parseMode = "Markdown") {
  return upsertPanel(chatId, text, inlineKeyboard, parseMode);
}

// ===============================
// TXT / ARCHIVOS
// ===============================
async function enviarTxtComoArchivo(chatId, contenido = "", nombre = `archivo_${Date.now()}.txt`) {
  const safeName = String(nombre || `archivo_${Date.now()}.txt`).replace(/[\\/:*?"<>|]+/g, "_");
  const tmpPath = path.join(os.tmpdir(), safeName);
  fs.writeFileSync(tmpPath, String(contenido || ""), "utf8");
  try {
    return await bot.sendDocument(chatId, tmpPath, {}, {
      filename: safeName,
      contentType: "text/plain",
    });
  } catch (e) {
    logErr("enviarTxtComoArchivo", e);
    return bot.sendMessage(chatId, String(contenido || ""));
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  // state
  panelMsgId,
  pending,
  wizard,

  // logs
  logErr,

  // roles
  allowMsg,
  isSuperAdmin,
  isAdmin,
  isVendedor,
  getRevendedorPorTelegramId,
  setTelegramIdToRevendedor,
  normalizeRevendedorDoc,

  // panel helpers
  bindPanelFromCallback,
  upsertPanel,
  sendCommandAnchoredPanel,

  // text helpers
  escMD,
  normTxt,
  limpiarQuery,
  onlyDigits,
  isEmailLike,
  normalizarPlataforma,
  esPlataformaValida,
  humanPlataforma: humanPlataformaFallback,

  // date helpers
  hoyDMY,
  isFechaDMY,
  parseFechaFinanceInput,
  parseDMYtoTS,
  ymdFromDMY,
  startOfDayTS,
  endOfDayTS,
  parseMonthInputToKey,
  getMonthKeyFromDMY,
  getMonthLabelFromKey,

  // money helpers
  parseMontoNumber,
  moneyNumber,
  moneyLps,

  // file helper
  enviarTxtComoArchivo,
};
