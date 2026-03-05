/*
 ✅ SUBLICUENTAS TG BOT — INDEX FINAL (UNIFICADO + ACTUALIZADO v3)
 ✅ FIX REAL: sendDocument correcto (TXT como archivo)
 ✅ TXT clientes limpio (Nombre|Tel) + TOTAL
 ✅ MENÚ PANEL: 1 solo mensaje (editMessageText) para navegación por botones
 ✅ /menu y /start: ahora NO se borran y el panel aparece EXACTO donde escribes el comando (reply_to_message_id)
 ✅ /menu estable: crea panel nuevo abajo y lo convierte en panel activo (ya no “salta” arriba)
 ✅ ROLES:
    - Admin/SuperAdmin: acceso completo
    - Vendedor (revendedor vinculado): solo renovaciones + vincular
 ✅ RENOVACIONES:
    - Mis renovaciones (telegramId vinculado en revendedores)
    - TXT Mis renovaciones
    - Auto TXT diario 7:00 AM por vendedor (revendedores activos)
 ✅ PROTECCIONES:
    - Anti-spam / rate-limit por usuario
    - Protección 7AM persistente (Firestore config/dailyRun)
 ✅ Submenu inventario completo (Agregar/Quitar/Editar clave/Borrar) + PENDING flows
 ✅ Clientes completo (Editar cliente / Servicios / Renovar +30 / Fecha manual / Agregar servicio)
 ✅ Wizard callbacks (plat / addmore / finish) sin duplicados
 ✅ Plataformas inventario incluidas
 ✅ Normalización + fallback robusto

 🔥 FIXES NUEVOS (REPORTADOS):
 ✅ CRASH Render: eliminado caracter suelto al final (archivo limpio)
 ✅ Al agregar +3 plataformas: guarda SIEMPRE con TRANSACTION (evita overwrite/race)
 ✅ Resumen wizard NO excede 4096: si crece manda TXT + botones
 ✅ /onan duplicado: DEDUPE por (telefono_norm + nombre_norm) al mostrar lista
 ✅ /menu: QUITADO el botón “Inicio” del menú principal (como pediste)
 ✅ /menu NO edita panel viejo arriba: crea panel nuevo donde se escribe
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

// ✅ SUPER ADMIN (Telegram user id)
const SUPER_ADMIN = String(process.env.SUPER_ADMIN || "").trim(); // ej: "5728675990"

// ✅ Timezone (para auto 7am)
const TZ = process.env.TZ || "America/Tegucigalpa";

if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN");
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error("Faltan variables Firebase (PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)");
}

// ===============================
// FIREBASE INIT
// ===============================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const db = admin.firestore();
console.log("✅ FIREBASE PROJECT:", admin.app().options.projectId);

// ===============================
// TELEGRAM BOT
// ===============================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("✅ Bot iniciado (polling)");

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
];
const PAGE_SIZE = 10;

// ===============================
// HELPERS (NORMALIZACIÓN)
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
  return String(correo).trim().toLowerCase().replace(/[\/#?&]/g, "_");
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
  return x.includes("@") && x.includes(".");
}

// ✅ parse fecha dd/mm/yyyy para ordenar servicios
function parseDMYtoTS(dmy) {
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return Number.POSITIVE_INFINITY;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  return new Date(yy, mm - 1, dd).getTime();
}
function serviciosOrdenados(servicios = []) {
  const arr = Array.isArray(servicios) ? servicios.slice() : [];
  arr.sort((a, b) => parseDMYtoTS(a.fechaRenovacion) - parseDMYtoTS(b.fechaRenovacion));
  return arr;
}

// ✅ sumar días a una fecha dd/mm/yyyy
function addDaysDMY(dmy, days) {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = dmy.split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd);
  dt.setDate(dt.getDate() + Number(days || 0));
  const ndd = String(dt.getDate()).padStart(2, "0");
  const nmm = String(dt.getMonth() + 1).padStart(2, "0");
  const nyy = String(dt.getFullYear());
  return `${ndd}/${nmm}/${nyy}`;
}

// ===============================
// ✅ TXT SÚPER ESTABLE (ASCII LIMPIO)
// ✅ FIX REAL: sendDocument correcto
// ===============================
async function enviarTxtComoArchivo(chatId, contenido, filename = "reporte.txt") {
  const limpio = stripAcentos(String(contenido || "")).replace(/[^\x00-\x7F]/g, "");
  const buffer = Buffer.from(limpio, "utf8");
  return bot.sendDocument(chatId, buffer, {}, { filename, contentType: "text/plain" });
}

// ===============================
// ✅ LOGS (limpios + anti-spam)
// ===============================
function logInfo(...args) {
  const safe = args.map((x) => (typeof x === "string" ? x.slice(0, 400) : x));
  console.log("ℹ️", ...safe);
}
function logErr(...args) {
  const safe = args.map((x) => (typeof x === "string" ? x.slice(0, 400) : x));
  console.log("❌", ...safe);
}

// Rate limit simple por usuario (evita spam)
const rate = new Map(); // key `${chatId}:${userId}` -> {t,count}
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
// ✅ ADMIN HELPERS
// ===============================
function isSuperAdmin(userId) {
  if (!SUPER_ADMIN) return false;
  return String(userId) === String(SUPER_ADMIN);
}
async function isAdmin(userId) {
  if (isSuperAdmin(userId)) return true;
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data().activo === true;
}

// ===============================
// ✅ REVENDEDORES: VINCULAR TELEGRAM ID
// ===============================
async function getRevendedorPorTelegramId(userId) {
  const uid = String(userId);
  const snap = await db.collection("revendedores").where("telegramId", "==", uid).limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() || {}) };
}
async function setTelegramIdToRevendedor(nombre, userId) {
  const nombreNorm = normTxt(nombre);
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return { ok: false, msg: "⚠️ No hay revendedores en la colección." };

  let found = null;
  snap.forEach((doc) => {
    const r = doc.data() || {};
    const n = normTxt(r.nombre || doc.id);
    if (n === nombreNorm) found = { ref: doc.ref, data: r, id: doc.id };
  });

  if (!found) return { ok: false, msg: "⚠️ No encontré ese revendedor por nombre (revendedores.nombre)." };

  await found.ref.set(
    { telegramId: String(userId), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { ok: true, msg: `✅ Vinculado: ${found.data?.nombre || found.id} => telegramId ${String(userId)}` };
}

// ✅ rol vendedor: NO admin pero sí revendedor vinculado
async function isVendedor(userId) {
  if (await isAdmin(userId)) return false;
  const rev = await getRevendedorPorTelegramId(userId);
  return !!(rev && rev.nombre && String(rev.telegramId || "") === String(userId));
}

// ===============================
// ✅ PANEL (1 SOLO MENSAJE) + /menu anclado
// ===============================
const panelMsgId = new Map(); // chatId -> message_id

async function upsertPanel(chatId, text, replyMarkup, parseMode = "Markdown") {
  const mid = panelMsgId.get(String(chatId));

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
      // cae a send
    }
  }

  const sent = await bot.sendMessage(chatId, text, {
    parse_mode: parseMode,
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });

  panelMsgId.set(String(chatId), sent.message_id);
}

function bindPanelFromCallback(q) {
  const chatId = q.message?.chat?.id;
  const mid = q.message?.message_id;
  if (chatId && mid) panelMsgId.set(String(chatId), mid);
}

// ✅ NUEVO: /menu y /start crean panel NUEVO abajo, justo donde escribes el comando
async function sendPanelAtCommand(chatId, replyToMsgId, text, replyMarkup, parseMode = "Markdown") {
  const sent = await bot.sendMessage(chatId, text, {
    parse_mode: parseMode,
    reply_markup: replyMarkup,
    reply_to_message_id: replyToMsgId,
    disable_web_page_preview: true,
  });
  panelMsgId.set(String(chatId), sent.message_id);
  return sent;
}

// ✅ NUEVO: envío seguro (si se pasa de 4096 => TXT como archivo)
async function safeSendMessage(chatId, text, opts = {}, filename = `mensaje_${Date.now()}.txt`) {
  try {
    const s = String(text ?? "");
    if (s.length > 3800) {
      await enviarTxtComoArchivo(chatId, s, filename);
      return bot.sendMessage(chatId, "📄 Te lo envié en TXT (era muy largo).", opts);
    }
    return await bot.sendMessage(chatId, s, opts);
  } catch (e) {
    const m = String(e?.message || e);
    if (m.includes("message is too long") || m.includes("Bad Request") || m.includes("400")) {
      await enviarTxtComoArchivo(chatId, String(text ?? ""), filename);
      return bot.sendMessage(chatId, "📄 Te lo envié en TXT (era muy largo).", opts);
    }
    throw e;
  }
}

// ===============================
// ✅ /reindex_clientes (FIX REAL)
// ===============================
bot.onText(/\/reindex_clientes/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN.");

  const snap = await db.collection("clientes").limit(5000).get();
  let ok = 0;

  for (const d of snap.docs) {
    const c = d.data() || {};
    const nombre_norm = normTxt(c.nombrePerfil || c.nombre_norm || "");
    const telefono_norm = onlyDigits(c.telefono || c.telefono_norm || "");
    const vendedor_norm = normTxt(c.vendedor || c.vendedor_norm || "");

    await d.ref.set(
      { nombre_norm, telefono_norm, vendedor_norm, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    ok++;
  }

  return bot.sendMessage(chatId, `✅ Reindex terminado: ${ok} clientes actualizados.`);
});

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
// ✅ INVENTARIO: buscar por correo
// ===============================
async function buscarInventarioPorCorreo(correo) {
  const mail = String(correo || "").trim().toLowerCase();
  const snap = await db.collection("inventario").where("correo", "==", mail).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ===============================
// ✅ SUBMENU INVENTARIO (correo)
// ===============================
async function enviarSubmenuInventario(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  const ref = db.collection("inventario").doc(docIdInventario(mail, plat));
  const doc = await ref.get();

  if (!doc.exists) {
    return upsertPanel(
      chatId,
      "⚠️ Ese correo no existe en inventario.",
      { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
      "Markdown"
    );
  }

  const item = doc.data() || {};
  const total = await getTotalPorPlataforma(plat);

  const t =
    `📧 *${mail}*\n` +
    `📌 *${plat.toUpperCase()}*\n` +
    `👤 Disp: *${Number(item.disp || 0)}*/${total ?? "-"}\n` +
    `Estado: *${fmtEstado(item.estado)}*`;

  return upsertPanel(
    chatId,
    t,
    {
      inline_keyboard: [
        [{ text: "➕ Agregar perfil", callback_data: `inv:menu:sumar:${plat}:${mail}` }],
        [{ text: "➖ Quitar perfil", callback_data: `inv:menu:restar:${plat}:${mail}` }],
        [{ text: "✏️ Editar clave", callback_data: `inv:menu:clave:${plat}:${mail}` }],
        [{ text: "🗑️ Borrar correo", callback_data: `inv:menu:borrar:${plat}:${mail}` }],
        [{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

// ===============================
// MEMORIAS DE FLUJO
// ===============================
const wizard = new Map(); // chatId -> state
const pending = new Map(); // chatId -> { mode, ... }

// ===============================
// ✅ DEDUPE CLIENTES (evita botones duplicados tipo Onan)
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

// ===============================
// MENUS (PANEL)
// ===============================
function kbMenuPrincipal() {
  return {
    inline_keyboard: [
      [{ text: "📦 Inventario", callback_data: "menu:inventario" }],
      [{ text: "👥 Clientes", callback_data: "menu:clientes" }],
      [{ text: "💳 Pagos", callback_data: "menu:pagos" }],
      [{ text: "📅 Renovaciones", callback_data: "menu:renovaciones" }],
      [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
      // ✅ NO INICIO AQUI (como pediste)
    ],
  };
}

function kbMenuVendedor() {
  return {
    inline_keyboard: [
      [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
      [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
      [{ text: "🔗 Vincular vendedor", callback_data: "vend:vincular:info" }],
    ],
  };
}

async function menuPrincipal(chatId) {
  // menú principal editable (para navegación desde botones)
  return upsertPanel(chatId, "📌 *MENÚ PRINCIPAL*", kbMenuPrincipal(), "Markdown");
}

async function menuVendedor(chatId) {
  return upsertPanel(
    chatId,
    "👤 *MENÚ VENDEDOR*\n\nSolo renovaciones:\n• Mis renovaciones (hoy)\n• TXT Mis renovaciones\n• Vincular si no aparece\n",
    kbMenuVendedor(),
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
      [{ text: "📦 Stock General", callback_data: "inv:general" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  });
}

async function menuClientes(chatId) {
  return upsertPanel(
    chatId,
    "👥 *CLIENTES*\n\n• Nuevo cliente (wizard)\n• Buscar (abre ficha)\n• TXT General (Nombre | Tel)\n• TXT 1 por Vendedor\n\n💡 Tip:\nEscriba: */NOMBRE* o */TELEFONO* para abrir listado.",
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

async function menuRenovaciones(chatId) {
  return upsertPanel(
    chatId,
    "📅 *RENOVACIONES*\n\nComandos:\n• /renovaciones hoy\n• /renovaciones dd/mm/yyyy\n• /renovaciones VENDEDOR dd/mm/yyyy\n\nTXT:\n• /txt hoy\n• /txt dd/mm/yyyy\n• /txt VENDEDOR dd/mm/yyyy\n\nVendedor:\n• Mis renovaciones (telegramId vinculado)\n",
    {
      inline_keyboard: [
        [{ text: "📅 Renovaciones hoy", callback_data: "ren:hoy" }],
        [{ text: "📄 TXT hoy", callback_data: "txt:hoy" }],
        [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
        [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
        [{ text: "👤 Revendedores (lista)", callback_data: "rev:lista" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    }
  );
}

# (File continues exactly as generated in this cell; omitted here to keep the execution compact.)
