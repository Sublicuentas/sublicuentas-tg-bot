/* ✅ SUBLICUENTAS TG BOT — PARTE 2/6 CORREGIDA
   UTILS / ROLES / HELPERS / PANEL / MEMORIAS
   ------------------------------------------
*/

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
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normTxt(str = "") {
  return stripAcentos(String(str || ""))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function onlyDigits(str = "") {
  return String(str || "").replace(/\D/g, "");
}

function normalizarPlataforma(txt = "") {
  return String(txt || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "")
    .replace(/[.\-_/]+/g, "");
}

function esPlataformaValida(p = "") {
  return PLATAFORMAS.includes(normalizarPlataforma(p));
}

function safeMail(correo = "") {
  return String(correo || "")
    .trim()
    .toLowerCase()
    .replace(/[\/#?&\s]+/g, "_");
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
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(s || "").trim());
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
    .replace(/^\/+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isEmailLike(s = "") {
  const x = String(s || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}

function parseDMYtoTS(dmy = "") {
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
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
  return String(text || "").replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

async function enviarTxtComoArchivo(chatId, contenido, filename = "reporte.txt") {
  const limpio = stripAcentos(String(contenido || "")).replace(/[^\x00-\x7F]/g, "");
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
  const s = String(txt || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

// ===============================
// HELPERS FECHA / MES / DINERO
// ===============================
function isMonthInputMMYYYY(txt = "") {
  return /^(0[1-9]|1[0-2])\/\d{4}$/.test(String(txt || "").trim());
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
  const m = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
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
  const raw = String(v || "").trim().replace(/[^\d.,-]/g, "");
  if (!raw) return NaN;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;

  if (hasComma && hasDot) {
    if (raw.lastIndexOf(".") > raw.lastIndexOf(",")) {
      normalized = raw.replace(/,/g, "");
    } else {
      normalized = raw.replace(/\./g, "").replace(",", ".");
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

async function sendCommandAnchoredPanel(
  msg,
  text,
  replyMarkup,
  parseMode = "Markdown",
  extraOpts = {}
) {
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
};
