/* ✅ SUBLICUENTAS TG BOT — PARTE 2/6 CORREGIDA
   UTILS / ROLES / PANEL / HELPERS GENERALES
   ------------------------------------------
   ✅ ROLES: admin / super admin / vendedor
   ✅ PANEL ANCLADO + edición segura
   ✅ WIZARD + PENDING STATE
   ✅ HELPERS: fechas, dinero, texto, plataformas
   ✅ NORMALIZACIONES Y VALIDACIONES
*/

const {
  bot,
  admin,
  db,
  TZ,
  PLATAFORMAS,
  SUPER_ADMIN,
} = require("./index_01_core");

// ===============================
// ESTADO EN MEMORIA
// ===============================
const panelMsgId = new Map();      // chatId -> message_id del panel principal
const panelBindings = new Map();   // `${chatId}:${messageId}` -> true
const wizard = new Map();          // userId -> estado wizard
const pending = new Map();         // userId -> estado temporal

// ===============================
// LOG / ERROR
// ===============================
function logErr(tag, err) {
  const msg = err?.response?.body || err?.message || err;
  console.error(`❌ [${tag}]`, msg);
}

function sleep(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===============================
// TEXTO / NORMALIZACIÓN
// ===============================
function normTxt(v = "") {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function onlyDigits(v = "") {
  return String(v || "").replace(/\D+/g, "");
}

function isEmailLike(v = "") {
  const s = String(v || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s);
}

function escMD(s = "") {
  return String(s || "").replace(/([_\*\[\]\(\)~`>#+\-=|{}\.!\\])/g, "\\$1");
}

function toTitleCase(str = "") {
  return String(str || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function chunkArray(arr = [], size = 10) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ===============================
// FECHAS / HORAS
// ===============================
function pad2(n) {
  return String(Number(n) || 0).padStart(2, "0");
}

function getNowParts() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    dd: parts.day,
    mm: parts.month,
    yyyy: parts.year,
    hh: parts.hour,
    min: parts.minute,
    ss: parts.second,
  };
}

function hoyDMY() {
  const p = getNowParts();
  return `${p.dd}/${p.mm}/${p.yyyy}`;
}

function ahoraHM() {
  const p = getNowParts();
  return `${p.hh}:${p.min}`;
}

function isFechaDMY(v = "") {
  const s = String(v || "").trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return false;

  const [dd, mm, yyyy] = s.split("/").map(Number);
  if (yyyy < 2020 || yyyy > 2100) return false;
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;

  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  return (
    dt.getUTCFullYear() === yyyy &&
    dt.getUTCMonth() === mm - 1 &&
    dt.getUTCDate() === dd
  );
}

function parseFechaFinanceInput(raw = "") {
  const s = String(raw || "").trim().replace(/[-.]/g, "/");
  if (!s) return null;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    return isFechaDMY(s) ? s : null;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    let [d, m, y] = s.split("/");
    d = pad2(d);
    m = pad2(m);
    const out = `${d}/${m}/${y}`;
    return isFechaDMY(out) ? out : null;
  }

  if (/^\d{8}$/.test(s)) {
    const out = `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4, 8)}`;
    return isFechaDMY(out) ? out : null;
  }

  return null;
}

function parseDMYtoDate(dmy = "") {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = dmy.split("/").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
}

function parseDMYtoTS(dmy = "") {
  const dt = parseDMYtoDate(dmy);
  if (!dt) return null;
  return admin.firestore.Timestamp.fromDate(dt);
}

function ymdFromDMY(dmy = "") {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = dmy.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDayTS(dmy = "") {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = dmy.split("/").map(Number);
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0));
  return admin.firestore.Timestamp.fromDate(dt);
}

function endOfDayTS(dmy = "") {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = dmy.split("/").map(Number);
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999));
  return admin.firestore.Timestamp.fromDate(dt);
}

function getMonthKeyFromDMY(dmy = "") {
  if (!isFechaDMY(dmy)) return null;
  const [, mm, yyyy] = dmy.split("/");
  return `${yyyy}-${mm}`;
}

function parseMonthInputToKey(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return getMonthKeyFromDMY(hoyDMY());

  if (/^\d{4}-\d{2}$/.test(s)) return s;

  if (/^\d{2}\/\d{4}$/.test(s)) {
    const [mm, yyyy] = s.split("/");
    return `${yyyy}-${mm}`;
  }

  if (/^\d{1,2}\/\d{4}$/.test(s)) {
    let [mm, yyyy] = s.split("/");
    mm = pad2(mm);
    return `${yyyy}-${mm}`;
  }

  const n = normTxt(s);
  const meses = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    setiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };

  for (const [name, mm] of Object.entries(meses)) {
    const rx = new RegExp(`^${name}\\s+(\\d{4})$`, "i");
    const m = n.match(rx);
    if (m) return `${m[1]}-${mm}`;
  }

  return null;
}

function getMonthLabelFromKey(key = "") {
  if (!/^\d{4}-\d{2}$/.test(String(key || ""))) return String(key || "");
  const [yyyy, mm] = String(key).split("-");
  const mapa = {
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
  return `${mapa[mm] || mm} ${yyyy}`;
}

// ===============================
// DINERO / NÚMEROS
// ===============================
function parseMontoNumber(raw = "") {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;

  s = s
    .replace(/lps|lempiras?|hnl|,/gi, "")
    .replace(/\s+/g, "")
    .replace(/[^\d.\-]/g, "");

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function moneyNumber(v = 0) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function moneyLps(v = 0) {
  const n = moneyNumber(v);
  return `${n.toFixed(2)} Lps`;
}

// ===============================
// PLATAFORMAS
// ===============================
function normalizarPlataforma(raw = "") {
  const s = normTxt(raw)
    .replace(/\+/g, "plus")
    .replace(/\./g, "")
    .replace(/\s+/g, "");

  const alias = {
    netflix: "netflix",
    vipnetflix: "vipnetflix",
    disneyp: "disneyp",
    disneypremium: "disneyp",
    disneys: "disneys",
    disneystandard: "disneys",
    hbomax: "hbomax",
    hbo: "hbomax",
    max: "hbomax",
    primevideo: "primevideo",
    prime: "primevideo",
    paramount: "paramount",
    paramountplus: "paramount",
    crunchyroll: "crunchyroll",
    vix: "vix",
    appletv: "appletv",
    appletvplus: "appletv",
    universal: "universal",
    universalplus: "universal",
    spotify: "spotify",
    youtube: "youtube",
    youtubepremium: "youtube",
    deezer: "deezer",
    canva: "canva",
    gemini: "gemini",
    chatgpt: "chatgpt",
    oleada1: "oleadatv1",
    oleada3: "oleadatv3",
    oleadatv1: "oleadatv1",
    oleadatv3: "oleadatv3",
    iptv1: "iptv1",
    iptv3: "iptv3",
    iptv4: "iptv4",
  };

  return alias[s] || s;
}

function esPlataformaValida(raw = "") {
  const p = normalizarPlataforma(raw);
  return Array.isArray(PLATAFORMAS) && PLATAFORMAS.includes(p);
}

function humanPlataformaSimple(raw = "") {
  const p = normalizarPlataforma(raw);
  const map = {
    netflix: "Netflix",
    vipnetflix: "Vipnetflix",
    disneyp: "Disneyp",
    disneys: "Disneys",
    hbomax: "Hbomax",
    primevideo: "Prime video",
    paramount: "Paramount+",
    crunchyroll: "Crunchyroll",
    vix: "Vix correo y clave",
    appletv: "Appletv correo y clave",
    universal: "Universal correo y clave",
    spotify: "Spotify correo y clave",
    youtube: "Youtube correo y clave",
    deezer: "Deezer correo y clave",
    oleadatv1: "Oleada 1",
    oleadatv3: "Oleada 3",
    iptv1: "Iptv 1",
    iptv3: "Iptv 3",
    iptv4: "Iptv 4",
    canva: "Canva",
    gemini: "Gemini",
    chatgpt: "Chatgpt",
  };
  return map[p] || toTitleCase(String(raw || p));
}

function plataformaRequiereCorreo(raw = "") {
  const p = normalizarPlataforma(raw);
  const noCorreo = new Set(["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"]);
  return !noCorreo.has(p);
}

function plataformaRequiereClave(raw = "") {
  const p = normalizarPlataforma(raw);
  return p !== "canva";
}

function plataformaEsUsuarioClave(raw = "") {
  const p = normalizarPlataforma(raw);
  return ["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p);
}

// ===============================
// ROLES / ACCESO
// ===============================
async function isSuperAdmin(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return false;

  if (uid === String(SUPER_ADMIN || "").trim()) return true;

  try {
    const snap = await db.collection("admins").doc(uid).get();
    if (!snap.exists) return false;
    const d = snap.data() || {};
    return d.superAdmin === true || d.role === "superadmin" || d.role === "super_admin";
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
    const snap = await db.collection("admins").doc(uid).get();
    if (!snap.exists) return false;
    const d = snap.data() || {};
    return d.activo !== false;
  } catch (e) {
    logErr("isAdmin", e);
    return false;
  }
}

async function getRevendedorPorTelegramId(telegramId) {
  const tid = String(telegramId || "").trim();
  if (!tid) return null;

  try {
    const snap = await db
      .collection("revendedores")
      .where("telegramId", "==", tid)
      .limit(1)
      .get();

    if (snap.empty) return null;

    const d = snap.docs[0];
    return { id: d.id, ...(d.data() || {}) };
  } catch (e) {
    logErr("getRevendedorPorTelegramId", e);
    return null;
  }
}

async function isVendedor(userId) {
  const r = await getRevendedorPorTelegramId(userId);
  return !!(r && r.activo !== false);
}

function normalizeRevendedorDoc(doc = {}) {
  const nombre = String(doc.nombre || "").trim();
  return {
    nombre,
    nombre_norm: normTxt(nombre),
    telegramId: doc.telegramId ? String(doc.telegramId).trim() : "",
    activo: doc.activo !== false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function setTelegramIdToRevendedor(refOrId, telegramId) {
  const tid = String(telegramId || "").trim();
  if (!tid) throw new Error("Telegram ID inválido");

  const ref = typeof refOrId === "string"
    ? db.collection("revendedores").doc(refOrId)
    : refOrId;

  await ref.set(
    {
      telegramId: tid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const snap = await ref.get();
  return { id: snap.id, ...(snap.data() || {}) };
}

async function allowMsg(msg) {
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  if (!chatId || !userId) return false;

  if (await isAdmin(userId)) return true;
  if (await isVendedor(userId)) return true;

  try {
    await bot.sendMessage(chatId, "⛔ Acceso denegado");
  } catch (e) {
    logErr("allowMsg", e);
  }
  return false;
}

// ===============================
// PANEL / CALLBACK / UX
// ===============================
function bindPanelFromCallback(query) {
  try {
    const chatId = query?.message?.chat?.id;
    const messageId = query?.message?.message_id;
    if (!chatId || !messageId) return;
    panelMsgId.set(chatId, messageId);
    panelBindings.set(`${chatId}:${messageId}`, true);
  } catch (e) {
    logErr("bindPanelFromCallback", e);
  }
}

async function limpiarQuery(botRef, query, opts = {}) {
  try {
    const text = opts?.text || "";
    return await botRef.answerCallbackQuery(query.id, text ? { text } : {});
  } catch (_) {
    return null;
  }
}

async function safeEditMessageText(chatId, messageId, text, extra = {}) {
  try {
    return await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      ...extra,
    });
  } catch (e) {
    const desc = String(e?.response?.body?.description || e?.message || "");

    if (/message is not modified/i.test(desc)) return null;
    if (/message to edit not found/i.test(desc)) return null;
    if (/message can't be edited/i.test(desc)) return null;
    throw e;
  }
}

async function upsertPanel(chatId, text, keyboard = []) {
  const reply_markup = { inline_keyboard: keyboard };
  const knownMessageId = panelMsgId.get(chatId);

  if (knownMessageId) {
    try {
      await safeEditMessageText(chatId, knownMessageId, text, { reply_markup });
      panelBindings.set(`${chatId}:${knownMessageId}`, true);
      return { chat: { id: chatId }, message_id: knownMessageId, reused: true };
    } catch (e) {
      logErr("upsertPanel.edit", e);
    }
  }

  try {
    const sent = await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup,
    });

    panelMsgId.set(chatId, sent.message_id);
    panelBindings.set(`${chatId}:${sent.message_id}`, true);
    return sent;
  } catch (e) {
    logErr("upsertPanel.send", e);
    throw e;
  }
}

async function sendCommandAnchoredPanel(chatId, text, keyboard = []) {
  try {
    const sent = await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });

    panelMsgId.set(chatId, sent.message_id);
    panelBindings.set(`${chatId}:${sent.message_id}`, true);
    return sent;
  } catch (e) {
    logErr("sendCommandAnchoredPanel", e);
    throw e;
  }
}

// ===============================
// DOC HELPERS / FIRESTORE
// ===============================
async function docExists(collectionName, docId) {
  const snap = await db.collection(collectionName).doc(String(docId)).get();
  return snap.exists;
}

async function getDocData(collectionName, docId) {
  const snap = await db.collection(collectionName).doc(String(docId)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

async function deleteDocSafe(collectionName, docId) {
  const ref = db.collection(collectionName).doc(String(docId));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  // estado
  panelMsgId,
  wizard,
  pending,

  // logs / comunes
  logErr,
  sleep,
  escMD,
  normTxt,
  onlyDigits,
  isEmailLike,
  toTitleCase,
  chunkArray,

  // fechas
  hoyDMY,
  ahoraHM,
  isFechaDMY,
  parseFechaFinanceInput,
  parseDMYtoTS,
  ymdFromDMY,
  startOfDayTS,
  endOfDayTS,
  getMonthKeyFromDMY,
  parseMonthInputToKey,
  getMonthLabelFromKey,

  // números / dinero
  parseMontoNumber,
  moneyNumber,
  moneyLps,

  // plataformas
  normalizarPlataforma,
  esPlataformaValida,
  humanPlataformaSimple,
  plataformaRequiereCorreo,
  plataformaRequiereClave,
  plataformaEsUsuarioClave,

  // roles
  allowMsg,
  isAdmin,
  isSuperAdmin,
  isVendedor,
  getRevendedorPorTelegramId,
  setTelegramIdToRevendedor,
  normalizeRevendedorDoc,

  // panel
  bindPanelFromCallback,
  limpiarQuery,
  upsertPanel,
  sendCommandAnchoredPanel,

  // firestore utils
  docExists,
  getDocData,
  deleteDocSafe,
};
