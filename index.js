/*
 ✅ SUBLICUENTAS TG BOT — INDEX FINAL (BLINDADO v9)
 ✅ FIX 409 menú / editMessageText
 ✅ FIX crash por archivo cortado
 ✅ FIX http duplicado
 ✅ /menu visible en punto actual
 ✅ Admin/SuperAdmin completo
 ✅ Vendedor: renovaciones + TXT + clientes propios
 ✅ Auto TXT 7:00 AM
 ✅ Inventario + Clientes + Renovaciones + Revendedores
 ✅ CRM CLIENTE
 ✅ BLOQUEO DUPLICADOS
 ✅ FIX MARKDOWN EN CORREOS / NOMBRES
 ✅ FIX WIZARD FINALIZAR
 ✅ RENOVAR TODOS +30
 ✅ INVENTARIO REAL POR CLIENTES EN CADA CORREO
 ✅ FIX CORREOS SIN \\.COM
 ✅ FIX CORREOS CON _ Y SUBDOMINIOS
*/

const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

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
// BOT BLINDADO
// ===============================
const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    autoStart: false,
    interval: 300,
    params: { timeout: 10 },
  },
});

bot.on("polling_error", (err) => {
  console.error("❌ polling_error:", err?.message || err);
});

bot.on("webhook_error", (err) => {
  console.error("❌ webhook_error:", err?.message || err);
});

async function startBotSafe() {
  try {
    await bot.stopPolling().catch(() => {});
    await bot.deleteWebHook().catch(() => {});
    await bot.startPolling();
    console.log("✅ Bot iniciado (polling blindado)");
  } catch (err) {
    console.error("❌ Error iniciando polling:", err?.message || err);
  }
}

if (process.env.ENABLE_NETFLIX_LISTENER === "true") {
  try {
    require("./netflix_codes_listener");
    console.log("🎬 Netflix listener activo");
  } catch (e) {
    console.error("❌ No se pudo iniciar netflix listener:", e);
  }
}

// ===============================
// ARRANQUE BLINDADO
// ===============================
(async () => {
  try {
    await bot.stopPolling().catch(() => {});
    await bot.deleteWebHook().catch(() => {});
  } catch (_) {}

  setTimeout(() => {
    startBotSafe();
  }, 15000);
})();

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
// HELPERS
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
  return String(txt)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "")
    .replace(/[\.\-_/]+/g, "");
}

function esPlataformaValida(p) {
  return PLATAFORMAS.includes(normalizarPlataforma(p));
}

function safeMail(correo) {
  return String(correo || "")
    .trim()
    .toLowerCase()
    .replace(/[\/#?&\s]+/g, "_");
}

function docIdInventario(correo, plataforma) {
  return `${normalizarPlataforma(plataforma)}__${safeMail(correo)}`;
}

function fmtEstado(estado) {
  const e = String(estado || "").toLowerCase();
  if (e === "bloqueada" || e === "llena") return "LLENA";
  return "ACTIVA";
}

function isFechaDMY(s) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(s || "").trim());
}

function hoyDMY() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function esTelefono(txt) {
  const t = onlyDigits(String(txt || "").trim());
  return /^[0-9]{7,15}$/.test(t);
}

function limpiarQuery(txt) {
  return String(txt || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isEmailLike(s) {
  const x = String(s || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}

function parseDMYtoTS(dmy) {
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return Number.POSITIVE_INFINITY;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

function serviciosOrdenados(servicios = []) {
  const arr = Array.isArray(servicios) ? servicios.slice() : [];
  arr.sort((a, b) => parseDMYtoTS(a.fechaRenovacion) - parseDMYtoTS(b.fechaRenovacion));
  return arr;
}

function addDaysDMY(dmy, days) {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = dmy.split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd);
  dt.setDate(dt.getDate() + Number(days || 0));
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

function escMD(text = "") {
  return String(text || "").replace(/([_*\[\]()~`>#+\-=|{}!\\])/g, "\\$1");
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
    disneys: 5,
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
// ADMIN / ROLES
// ===============================
function isSuperAdmin(userId) {
  return !!SUPER_ADMIN && String(userId) === String(SUPER_ADMIN);
}

async function isAdmin(userId) {
  if (isSuperAdmin(userId)) return true;
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data().activo === true;
}

async function getRevendedorPorTelegramId(userId) {
  const uid = String(userId).trim();
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
  if (snap.empty) return { ok: false, msg: "⚠️ No hay revendedores en la colección." };

  let found = null;
  snap.forEach((doc) => {
    const r = normalizeRevendedorDoc(doc);
    if (r.nombre_norm === nombreNorm) found = { ref: doc.ref, data: r };
  });

  if (!found) return { ok: false, msg: "⚠️ No encontré ese revendedor por nombre." };

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

  return { ok: true, msg: `✅ Vinculado: ${found.data.nombre} => telegramId ${String(userId)}` };
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

// ===============================
// MEMORIAS DE FLUJO
// ===============================
const wizard = new Map();
const pending = new Map();

// ===============================
// HELPERS CLIENTES / DUPLICADOS
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

async function borrarDuplicadosClientes() {
  const snap = await db.collection("clientes").limit(5000).get();
  const mapa = new Map();
  const batch = db.batch();
  let borrados = 0;

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const key = `${normTxt(c.nombrePerfil || "")}|${onlyDigits(c.telefono || "")}`;
    if (!key || key === "|") return;

    if (mapa.has(key)) {
      batch.delete(doc.ref);
      borrados++;
    } else {
      mapa.set(key, doc.id);
    }
  });

  if (borrados > 0) await batch.commit();
  return borrados;
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

async function addServicioTx(clientId, servicio) {
  const ref = db.collection("clientes").doc(String(clientId));

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error("Cliente no existe en TX");

    const cur = doc.data() || {};
    const arr = Array.isArray(cur.servicios) ? cur.servicios.slice() : [];
    arr.push(servicio);

    tx.set(
      ref,
      {
        servicios: arr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { cliente: cur, servicios: arr };
  });
}

// ===============================
// HELPERS CRM
// ===============================
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

function labelPlataforma(plataforma = "") {
  return `${emojiPlataforma(plataforma)} ${normalizarPlataforma(plataforma)}`;
}

function resumenClienteCRM(cliente) {
  const servicios = serviciosOrdenados(Array.isArray(cliente?.servicios) ? cliente.servicios : []);
  let totalMensual = 0;
  let proxFecha = "";
  let venceHoy = 0;
  let vencidos = 0;
  let proximos = 0;

  for (const s of servicios) {
    totalMensual += Number(s.precio || 0);
    const d = daysUntilDMY(s.fechaRenovacion);

    if (proxFecha === "" && isFechaDMY(s.fechaRenovacion)) proxFecha = s.fechaRenovacion;
    if (d === 0) venceHoy++;
    if (d !== null && d < 0) vencidos++;
    if (d !== null && d >= 1 && d <= 3) proximos++;
  }

  let estadoGeneral = "🟢 Estable";
  if (vencidos > 0 || venceHoy > 0) estadoGeneral = "🔴 Atención";
  else if (proximos > 0) estadoGeneral = "🟡 Seguimiento";

  return {
    servicios,
    totalMensual,
    proxFecha: proxFecha || "-",
    venceHoy,
    vencidos,
    proximos,
    estadoGeneral,
  };
}

function clienteResumenTXT(c) {
  const r = resumenClienteCRM(c);

  let body = "";
  body += `CLIENTE CRM\n\n`;
  body += `NOMBRE: ${stripAcentos(c.nombrePerfil || "-")}\n`;
  body += `TELEFONO: ${onlyDigits(c.telefono || "") || "-"}\n`;
  body += `VENDEDOR: ${stripAcentos(c.vendedor || "-")}\n\n`;
  body += `SERVICIOS ACTIVOS: ${r.servicios.length}\n`;
  body += `TOTAL MENSUAL: ${r.totalMensual} Lps\n`;
  body += `PROXIMA RENOVACION: ${r.proxFecha}\n`;
  body += `VENCE HOY: ${r.venceHoy}\n`;
  body += `VENCIDOS: ${r.vencidos}\n`;
  body += `PROXIMOS: ${r.proximos}\n`;
  body += `ESTADO GENERAL: ${stripAcentos(r.estadoGeneral)}\n\n`;
  body += `SERVICIOS\n\n`;

  if (!r.servicios.length) {
    body += "SIN SERVICIOS\n";
  } else {
    r.servicios.forEach((s, i) => {
      body += `${i + 1}) ${normalizarPlataforma(s.plataforma)} | ${s.correo || "-"} | ${Number(s.precio || 0)} Lps | ${s.fechaRenovacion || "-"} | ${stripAcentos(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }

  return body;
}

// ===============================
// HELPERS INVENTARIO
// ===============================
async function buscarInventarioPorCorreo(correo) {
  const mail = String(correo || "").trim().toLowerCase();
  const snap = await db.collection("inventario").where("correo", "==", mail).limit(20).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .limit(500)
    .get();

  const docs = snap.docs
    .map((d) => {
      const data = d.data() || {};
      const clientes = Array.isArray(data.clientes) ? data.clientes : [];
      const capacidad = Number(data.capacidad || data.total || totalDefault || 0);
      const ocupados = clientes.length;

      let disponibles = 0;
      if (capacidad > 0) {
        disponibles = Math.max(0, capacidad - ocupados);
      } else {
        disponibles = Number(data.disp || 0);
      }

      let estado = "activa";
      if (disponibles <= 0) estado = "llena";

      return {
        id: d.id,
        ...data,
        capacidad,
        ocupados,
        disp: disponibles,
        estado,
      };
    })
    .filter((x) => Number(x.disp || 0) >= 1)
    .sort((a, b) => Number(b.disp || 0) - Number(a.disp || 0));

  const totalItems = docs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);

  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, totalItems);
  const slice = docs.slice(start, end);

  let texto = `📌 *${p.toUpperCase()} — STOCK DISPONIBLE*\n`;
  texto += `Mostrando ${totalItems === 0 ? 0 : start + 1}-${end} de ${totalItems}\n\n`;

  if (slice.length === 0) {
    texto += `⚠️ ${p.toUpperCase()} SIN PERFILES DISPONIBLES\n`;
  } else {
    let i = start + 1;
    let libresTotal = 0;
    docs.forEach((x) => (libresTotal += Number(x.disp || 0)));

    for (const d of slice) {
      const capacidad = Number(d.capacidad || totalDefault || "-");
      texto += `${i}) ${d.correo} — 🔑 ${d?.clave ? d.clave : "-"} — ${d.disp}/${capacidad}\n`;
      i++;
    }

    texto += `\n━━━━━━━━━━━━━━\n`;
    texto += `📊 Correos con stock: ${totalItems}\n`;
    texto += `👤 Perfiles/Pantallas libres totales: ${libresTotal}\n\n`;
    texto += `👉 Para abrir submenu: escriba /correo (ej: /mail@gmail.com)\n`;
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
  const cfg = await db.collection("config").doc("totales_plataforma").get();
  const totals = cfg.exists ? cfg.data() : {};
  let texto = "📦 *STOCK GENERAL*\n\n";

  for (const p of PLATAFORMAS) {
    const snap = await db
      .collection("inventario")
      .where("plataforma", "==", p)
      .limit(500)
      .get();

    let libres = 0;

    snap.forEach((d) => {
      const data = d.data() || {};
      const clientes = Array.isArray(data.clientes) ? data.clientes : [];
      const capacidad = Number(data.capacidad || data.total || totals?.[p] || 0);

      if (capacidad > 0) {
        libres += Math.max(0, capacidad - clientes.length);
      } else {
        libres += Number(data.disp || 0);
      }
    });

    texto += `✅ *${p}*: ${libres} libres (/${totals?.[p] ?? "-"})\n`;
  }

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
}

async function enviarSubmenuInventario(chatId, plataforma, correo) {
  return mostrarPanelCorreo(chatId, plataforma, correo);
}

// ===============================
// MENÚS
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

async function menuPagos(chatId) {
  return upsertPanel(chatId, "💳 *PAGOS*\n\n(Reservado para wizard después)", {
    inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]],
  });
}

async function menuRenovaciones(chatId, userIdOpt) {
  const isSA = userIdOpt ? isSuperAdmin(userIdOpt) : false;

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

function w(chatId) {
  return wizard.get(String(chatId));
}

function wset(chatId, state) {
  wizard.set(String(chatId), state);
}

function wclear(chatId) {
  wizard.delete(String(chatId));
}

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
// FICHA CLIENTE / CRM / EDICIÓN
// ===============================

async function enviarFichaCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "❌ Cliente no encontrado.");

  const r = resumenClienteCRM(c);

  let txt = "";
  txt += `👤 *${escMD(c.nombrePerfil || "-")}*\n`;
  txt += `📱 ${escMD(c.telefono || "-")}\n`;
  txt += `👨‍💼 ${escMD(c.vendedor || "-")}\n\n`;

  txt += `📊 *SERVICIOS:* ${r.servicios.length}\n`;
  txt += `💰 *TOTAL:* ${r.totalMensual} Lps\n`;
  txt += `📅 *PROX:* ${escMD(r.proxFecha)}\n`;
  txt += `⚠️ *ESTADO:* ${escMD(r.estadoGeneral)}\n\n`;

  if (!r.servicios.length) {
    txt += `⚠️ SIN SERVICIOS\n`;
  } else {
    r.servicios.forEach((s, i) => {
      txt += `${i + 1}) ${labelPlataforma(s.plataforma)} | ${escMD(
        s.correo || "-"
      )} | ${Number(s.precio || 0)} Lps | ${escMD(
        s.fechaRenovacion || "-"
      )} | ${escMD(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }

  return upsertPanel(
    chatId,
    txt,
    {
      inline_keyboard: [
        [{ text: "✏️ Editar cliente", callback_data: `cli:edit:menu:${clientId}` }],
        [{ text: "📦 Servicios", callback_data: `cli:serv:list:${clientId}` }],
        [{ text: "🗑️ Borrar cliente", callback_data: `cli:del:${clientId}` }],
        [{ text: "⬅️ Volver", callback_data: "menu:clientes" }],
      ],
    },
    "Markdown"
  );
}

// ===============================
// LISTA SERVICIOS CLIENTE
// ===============================

async function menuListaServicios(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "❌ Cliente no encontrado.");

  const servicios = serviciosOrdenados(c.servicios || []);

  let txt = `📦 *SERVICIOS*\n\n`;

  if (!servicios.length) txt += "⚠️ SIN SERVICIOS";
  else {
    servicios.forEach((s, i) => {
      txt += `${i + 1}) ${labelPlataforma(s.plataforma)} | ${escMD(
        s.correo || "-"
      )} | ${Number(s.precio || 0)} Lps | ${escMD(
        s.fechaRenovacion || "-"
      )}\n`;
    });
  }

  const kb = [];

  servicios.forEach((s, i) => {
    kb.push([
      {
        text: `${i + 1}) ${normalizarPlataforma(s.plataforma)}`,
        callback_data: `cli:serv:menu:${clientId}:${i}`,
      },
    ]);
  });

  kb.push([{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }]);
  kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

// ===============================
// MENU SERVICIO
// ===============================

async function menuServicio(chatId, clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "❌ Cliente no encontrado.");

  const s = c.servicios?.[idx];
  if (!s) return bot.sendMessage(chatId, "❌ Servicio no encontrado.");

  let txt = "";
  txt += `📦 *${escMD(normalizarPlataforma(s.plataforma))}*\n\n`;
  txt += `📧 ${escMD(s.correo || "-")}\n`;
  txt += `💰 ${Number(s.precio || 0)} Lps\n`;
  txt += `📅 ${escMD(s.fechaRenovacion || "-")}\n`;
  txt += `⚠️ ${escMD(estadoServicioLabel(s.fechaRenovacion))}\n`;

  return upsertPanel(
    chatId,
    txt,
    {
      inline_keyboard: [
        [
          {
            text: "➕ Renovar +30",
            callback_data: `cli:serv:ren30:${clientId}:${idx}`,
          },
        ],
        [
          {
            text: "📅 Cambiar fecha",
            callback_data: `cli:serv:fecha:${clientId}:${idx}`,
          },
        ],
        [
          {
            text: "🗑️ Borrar servicio",
            callback_data: `cli:serv:del:${clientId}:${idx}`,
          },
        ],
        [{ text: "⬅️ Volver", callback_data: `cli:serv:list:${clientId}` }],
      ],
    },
    "Markdown"
  );
}

// ===============================
// BUSCAR CLIENTES ROBUSTO
// ===============================

async function buscarClienteRobusto(query) {
  const q = normTxt(query);
  const tel = onlyDigits(query);

  const snap = await db.collection("clientes").limit(2000).get();

  const res = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};

    const nombre = normTxt(c.nombrePerfil || "");
    const telefono = onlyDigits(c.telefono || "");

    if (
      nombre.includes(q) ||
      telefono.includes(tel)
    ) {
      res.push({ id: doc.id, ...c });
    }
  });

  return res;
}

// ===============================
// LISTA RESULTADOS BUSQUEDA
// ===============================

async function enviarListaResultadosClientes(chatId, arr) {
  if (!arr.length) {
    return bot.sendMessage(chatId, "⚠️ Sin resultados.");
  }

  const kb = arr.slice(0, 20).map((c) => [
    {
      text: `${c.nombrePerfil || "-"} | ${c.telefono || "-"}`,
      callback_data: `cli:view:${c.id}`,
    },
  ]);

  return bot.sendMessage(chatId, "🔎 Resultados:", {
    reply_markup: {
      inline_keyboard: kb,
    },
  });
}

// ===============================
// BUSCAR TELEFONO
// ===============================

async function buscarPorTelefonoTodos(tel) {
  const t = onlyDigits(tel);

  const snap = await db.collection("clientes").limit(2000).get();

  const res = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};

    if (onlyDigits(c.telefono || "") === t) {
      res.push({ id: doc.id, ...c });
    }
  });

  return res;
}

// ===============================
// COMANDOS CLIENTES
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
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
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return reporteClientesTXTGeneral(chatId);
});

bot.onText(/\/vendedores_txt_split/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return reporteClientesSplitPorVendedorTXT(chatId);
});

// ===============================
// COMANDOS RENOVACIONES
// ===============================
bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
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
      return bot.sendMessage(chatId, "⚠️ Uso:\n/renovaciones hoy\n/renovaciones dd/mm/yyyy\n/renovaciones VENDEDOR dd/mm/yyyy");
    }
  }

  if (!adminOk && vend?.nombre) vendedor = vend.nombre;

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  const texto = renovacionesTexto(list, fecha, vendedor || null);
  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

bot.onText(/\/txt(?:\s+(.+))?/i, async (msg, match) => {
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
      return bot.sendMessage(chatId, "⚠️ Uso:\n/txt hoy\n/txt dd/mm/yyyy\n/txt VENDEDOR dd/mm/yyyy");
    }
  }

  if (!adminOk && vend?.nombre) vendedor = vend.nombre;

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  return enviarTXT(chatId, list, fecha, vendedor || null);
});

// ===============================
// IDS / VINCULACIÓN
// ===============================
bot.onText(/\/id/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(chatId, `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`);
});

bot.onText(/\/miid/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(chatId, `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`);
});

bot.onText(/\/vincular_vendedor\s+(.+)/i, async (msg, match) => {
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
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");

  const telegramId = String(match[1] || "").trim();
  const nombre = String(match[2] || "").trim();

  if (!telegramId || !nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/addvendedor ID Nombre");

  const docId = normTxt(nombre) || String(Date.now());

  await db.collection("revendedores").doc(docId).set(
    {
      nombre,
      nombre_norm: normTxt(nombre),
      telegramId: String(telegramId),
      activo: true,
      autoLastSent: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Revendedor agregado\n\n👤 ${nombre}\n🆔 ${telegramId}\n📌 DocID: ${docId}`);
});

bot.onText(/\/delvendedor\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/delvendedor Nombre");

  const nombreNorm = normTxt(nombre);
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

async function listarRevendedores(chatId) {
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay revendedores.");

  const all = snap.docs.map((d) => normalizeRevendedorDoc(d));
  all.sort((a, b) => normTxt(a.nombre).localeCompare(normTxt(b.nombre)));

  let t = "👤 *REVENDEDORES*\n\n";
  all.forEach((x) => {
    t += `• ${escMD(x.nombre || x.id)} — ${x.activo ? "✅ activo" : "⛔ inactivo"}${x.telegramId ? ` | 🆔 ${escMD(x.telegramId)}` : ""}\n`;
  });

  if (t.length > 3800) return enviarTxtComoArchivo(chatId, t, `revendedores_${Date.now()}.txt`);
  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
}

// ===============================
// ADMINS
// ===============================
bot.onText(/\/adminadd\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede agregar admins.");

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
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede eliminar admins.");

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
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN.");

  const snap = await db.collection("admins").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay admins en colección.");

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
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (await isAdmin(userId)) {
    const sent = await bot.sendMessage(chatId, "📌 *MENÚ PRINCIPAL*", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📦 Inventario", callback_data: "menu:inventario" }],
          [{ text: "👥 Clientes", callback_data: "menu:clientes" }],
          [{ text: "💳 Pagos", callback_data: "menu:pagos" }],
          [{ text: "📅 Renovaciones", callback_data: "menu:renovaciones" }],
          [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
        ],
      },
    });
    panelMsgId.set(String(chatId), sent.message_id);
    return;
  }

  if (await isVendedor(userId)) {
    const sent = await bot.sendMessage(
      chatId,
      "👤 *MENÚ VENDEDOR*\n\nFunciones disponibles:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
            [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
            [{ text: "👥 Mis clientes", callback_data: "vend:clientes" }],
            [{ text: "📄 TXT Mis clientes", callback_data: "vend:clientes:txt" }],
          ],
        },
      }
    );
    panelMsgId.set(String(chatId), sent.message_id);
    return;
  }

  return bot.sendMessage(chatId, "⛔ Acceso denegado");
});

bot.onText(/\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    if (await isAdmin(userId)) {
      const sent = await bot.sendMessage(chatId, "📌 *MENÚ PRINCIPAL*", {
        parse_mode: "Markdown",
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: "📦 Inventario", callback_data: "menu:inventario" }],
            [{ text: "👥 Clientes", callback_data: "menu:clientes" }],
            [{ text: "💳 Pagos", callback_data: "menu:pagos" }],
            [{ text: "📅 Renovaciones", callback_data: "menu:renovaciones" }],
            [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
          ],
        },
      });
      panelMsgId.set(String(chatId), sent.message_id);
      return;
    }

    if (await isVendedor(userId)) {
      const sent = await bot.sendMessage(
        chatId,
        "👤 *MENÚ VENDEDOR*\n\nFunciones disponibles:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
        {
          parse_mode: "Markdown",
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
              [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
              [{ text: "👥 Mis clientes", callback_data: "vend:clientes" }],
              [{ text: "📄 TXT Mis clientes", callback_data: "vend:clientes:txt" }],
            ],
          },
        }
      );
      panelMsgId.set(String(chatId), sent.message_id);
      return;
    }

    return bot.sendMessage(chatId, "⛔ Acceso denegado", {
      reply_to_message_id: msg.message_id,
    });
  } catch (err) {
    return bot.sendMessage(chatId, "⚠️ Error interno.");
  }
});

// ===============================
// ATAJOS INVENTARIO
// ===============================
PLATAFORMAS.forEach((p) => {
  bot.onText(new RegExp("^\\/" + p + "(?:@\\w+)?(?:\\s+.*)?$", "i"), async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return enviarInventarioPlataforma(chatId, p, 0);
  });
});

bot.onText(/\/stock/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarStockGeneral(chatId);
});

// ===============================
// CALLBACKS
// ===============================
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const userId = q.from?.id;
  const data = q.data || "";

  try {
    await bot.answerCallbackQuery(q.id);
    if (!chatId) return;
    if (!allowMsg(chatId, userId)) return;

    bindPanelFromCallback(q);

    const adminOk = await isAdmin(userId);
    const vend = await getRevendedorPorTelegramId(userId);
    const vendOk = !!(vend && vend.nombre);

    if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    if (data === "go:inicio") {
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
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}` }]] },
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
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}` }]] },
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
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}` }]] },
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
        return bot.sendMessage(
          chatId,
          `🗑️ Confirmar *borrar correo*?\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Confirmar", callback_data: `inv:menu:borrarok:${normalizarPlataforma(plat)}:${encodeURIComponent(String(correo).toLowerCase())}` }],
                [{ text: "⬅️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}` }],
              ],
            },
          }
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
        const [, tipo, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
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

        return bot.sendMessage(chatId, txt, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Volver al correo", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
        });
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

        kb.push([{ text: "⬅️ Volver", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }]);

        return bot.sendMessage(
          chatId,
          `➖ *Quitar cliente*\n\n📧 *${escMD(correo)}*\n\nSeleccione el cliente que desea quitar:`,
          {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: kb },
          }
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
        if (isNaN(index) || index < 0 || index >= clientes.length) return bot.sendMessage(chatId, "❌ Cliente inválido.");

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

        kb.push([{ text: "⬅️ Volver", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }]);

        return bot.sendMessage(
          chatId,
          `🔐 *Editar PIN*\n\n📧 *${escMD(correo)}*\n\nSeleccione el cliente:`,
          {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: kb },
          }
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

        return bot.sendMessage(
          chatId,
          "⚠️ *Confirmar eliminación*\n\n" +
            `📧 *Correo:* ${escMD(correo)}\n\n` +
            "Esta acción eliminará la cuenta del inventario.\n\n¿Está seguro que desea borrarla?",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Sí borrar", callback_data: `mail_delete_confirm|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }],
                [{ text: "❌ Cancelar", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }],
              ],
            },
          }
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
          await bot.sendMessage(chatId, "⚠️ Este correo tenía clientes asignados. Se eliminará igualmente del inventario.");
        }

        await ref.delete();
        return enviarInventarioPlataforma(chatId, plataforma, 0);
      }

      if (data === "cli:txt:general") return reporteClientesTXTGeneral(chatId);
      if (data === "cli:txt:vendedores_split") return reporteClientesSplitPorVendedorTXT(chatId);

      if (data.startsWith("cli:txt:one:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        return enviarTxtComoArchivo(chatId, clienteResumenTXT(c), `cliente_${onlyDigits(c.telefono || "") || clientId}.txt`);
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

        let st = w(chatId);

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

        wset(chatId, st);

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

        wset(chatId, nuevoState);

        return bot.sendMessage(chatId, "📌 Agregar otro servicio\nSeleccione plataforma:", {
          reply_markup: {
            inline_keyboard: kbPlataformasWiz("wiz:plat", clientId),
          },
        });
      }

      if (data.startsWith("wiz:finish:")) {
        const clientId = data.split(":")[2];
        wclear(chatId);
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
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        servicios[idx] = { ...(servicios[idx] || {}), plataforma: plat };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        servicios.splice(idx, 1);
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        if (servicios.length) return menuListaServicios(chatId, clientId);
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:ren:list:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

        const kb = servicios.map((s, i) => [
          { text: `🔄 ${i + 1}) ${s.plataforma} — ${s.correo} (Ren: ${s.fechaRenovacion || "-"})`, callback_data: `cli:ren:menu:${clientId}:${i}` },
        ]);
        kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

        return upsertPanel(chatId, "🔄 *RENOVAR SERVICIO*\nSeleccione cuál renovar:", { inline_keyboard: kb }, "Markdown");
      }

      if (data.startsWith("cli:ren:menu:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        const s = servicios[idx] || {};
        const texto = `🔄 *RENOVAR SERVICIO #${idx + 1}*\n📌 ${escMD(s.plataforma || "-")}\n📧 ${escMD(s.correo || "-")}\n📅 Actual: *${escMD(s.fechaRenovacion || "-")}*`;

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
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        const actual = String(servicios[idx].fechaRenovacion || hoyDMY());
        const base = isFechaDMY(actual) ? actual : hoyDMY();
        const nueva = addDaysDMY(base, 30);

        servicios[idx] = { ...(servicios[idx] || {}), fechaRenovacion: nueva };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

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
        if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPERADMIN.");
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
      return enviarMisClientes(chatId, vend.nombre);
    }

    if (data === "vend:clientes:txt") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      return enviarMisClientesTXT(chatId, vend.nombre);
    }

    if (data === "rev:lista") return listarRevendedores(chatId);

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    logErr("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// MESSAGE HANDLER
// ===============================
bot.on("message", async (msg) => {
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

            return bot.sendMessage(chatId, `📧 ${escMD(posibleCorreo)}\nSeleccione plataforma:`, {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: kb },
            });
          }

          return bot.sendMessage(chatId, "⚠️ Correo no encontrado en inventario.");
        }
      }

      const cmd = limpiarQuery(text);
      const first = cmd.split(" ")[0];

      const vendedorCmd = new Set(["menu", "start", "miid", "id", "vincular_vendedor", "renovaciones", "txt"]);
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
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

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
        if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");

        pending.delete(String(chatId));

        const correo = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

        const d = doc.data() || {};
        const nuevoDisp = Number(d.disp || 0) + qty;

        await ref.set(
          { disp: nuevoDisp, estado: "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (p.mode === "invRestarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");

        pending.delete(String(chatId));

        const correo = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

        const d = doc.data() || {};
        const antes = { ...d };
        const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);

        await ref.set({ disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        const despues = { ...d, disp: nuevoDisp, plataforma: plat, correo };
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

        await ref.set({ clave: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

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
        if (p.idx < 0 || p.idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        servicios[p.idx] = { ...(servicios[p.idx] || {}), fechaRenovacion: fecha };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

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
          { nombrePerfil: t, nombre_norm: normTxt(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
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
          { telefono: t, telefono_norm: onlyDigits(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditVendedor") {
        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          { vendedor: t, vendedor_norm: normTxt(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
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
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
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
    logErr("❌ message handler error:", err?.message || err);
    bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
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
    { lastRun: String(dmy), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
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
  try {
    const { dmy, hh, mm } = getTimePartsNow();

    if (hh === 7 && mm === 0) {
      const dbLast = await getLastRunDB();
      if (_lastDailyRun === dmy || dbLast === dmy) return;

      _lastDailyRun = dmy;
      await setLastRunDB(dmy);
      await enviarTxtRenovacionesDiariasPorVendedor();

      logInfo(`✅ AutoTXT 7AM enviado (${dmy}) TZ=${TZ}`);
    }
  } catch (e) {
    logErr("❌ AutoTXT error:", e?.message || e);
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

// ===============================
// HTTP KEEPALIVE FINAL
// ===============================
const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  })
  .listen(PORT, () => {
    console.log("🌐 HTTP KEEPALIVE activo en puerto", PORT);
  });
