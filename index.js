/*
 ✅ SUBLICUENTAS TG BOT — INDEX FINAL (UNIFICADO + ACTUALIZADO v3)
 ✅ FIX REAL: sendDocument correcto (TXT como archivo)
 ✅ TXT clientes limpio (Nombre|Tel) + TOTAL
 ✅ MENÚ PANEL: 1 solo mensaje (editMessageText)
 ✅ /menu estable: borra comando y refresca panel donde está
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
 ✅ Plataformas inventario incluidas + nuevas:
    - OleadaTV (1 pantalla / 3 pantallas)
    - IPTV (1 pantalla / 3 pantallas / 4 pantallas)
 ✅ Normalización + fallback robusto

 🔥 FIXES NUEVOS:
 ✅ CRASH: eliminado caracter “r” suelto al final del archivo (te estaba botando Render)
 ✅ Al agregar +3 plataformas: ahora se guarda SIEMPRE con TRANSACTION (evita overwrite/race)
 ✅ Resumen del wizard ahora NO excede 4096 (si crece, manda TXT + botones)
 ✅ /onan duplicado: ahora DEDUPE por (telefono_norm + nombre_norm) al mostrar lista
 ✅ /menu: QUITADO el botón “Inicio” del menú principal (como pediste)
 ✅ SOLO SUPERADMIN: botón "Enviar TXT a TODOS (HOY)" en Renovaciones
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
// ✅ NUEVAS plataformas:
// Oleada TV => oleadatv1 / oleadatv3
// IPTV      => iptv1 / iptv3 / iptv4
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
  if (await isAdmin(userId)) return false; // ✅ admins nunca se vuelven "vendedor" en UI
  const rev = await getRevendedorPorTelegramId(userId);
  return !!(rev && rev.nombre && String(rev.telegramId || "") === String(userId));
}

// ===============================
// ✅ PANEL (1 SOLO MENSAJE)
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

// ✅ borra el mensaje del comando (/menu, /start) para que no “salte”
async function tryDeleteMsg(chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (e) {}
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

    // ✅ NUEVOS:
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
async function menuPrincipal(chatId) {
  // ✅ QUITADO: botón Inicio del /menu principal (como pediste)
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
  // ✅ QUITADO: botón Inicio del /menu vendedor también (mantiene limpio)
  return upsertPanel(
    chatId,
    "👤 *MENÚ VENDEDOR*\n\nSolo renovaciones:\n• Mis renovaciones (hoy)\n• TXT Mis renovaciones\n• Vincular si no aparece\n",
    {
      inline_keyboard: [
        [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
        [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
        [{ text: "🔗 Vincular vendedor", callback_data: "vend:vincular:info" }],
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

      // ✅ NUEVOS: OleadaTV e IPTV por pantallas
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

async function menuRenovaciones(chatId, userIdOpt) {
  const isSA = userIdOpt ? isSuperAdmin(userIdOpt) : false;

  const kb = [
    [{ text: "📅 Renovaciones hoy", callback_data: "ren:hoy" }],
    [{ text: "📄 TXT hoy", callback_data: "txt:hoy" }],
    [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
    [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
    [{ text: "👤 Revendedores (lista)", callback_data: "rev:lista" }],
  ];

  // ✅ SOLO SUPERADMIN puede enviar TXT a TODOS (HOY)
  if (isSA) kb.push([{ text: "📬 Enviar TXT a TODOS (HOY)", callback_data: "txt:todos:hoy" }]);

  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(
    chatId,
    "📅 *RENOVACIONES*\n\nComandos:\n• /renovaciones hoy\n• /renovaciones dd/mm/yyyy\n• /renovaciones VENDEDOR dd/mm/yyyy\n\nTXT:\n• /txt hoy\n• /txt dd/mm/yyyy\n• /txt VENDEDOR dd/mm/yyyy\n\nVendedor:\n• Mis renovaciones (telegramId vinculado)\n\n✅ Nota:\n• *Enviar TXT a TODOS (HOY)* solo SUPERADMIN.\n",
    { inline_keyboard: kb }
  );
}

// ===============================
// INVENTARIO: LISTA + PAGINACION (PANEL)
// ===============================
async function inventarioPlataformaTexto(plataforma, page) {
  const p = normalizarPlataforma(plataforma);
  const total = await getTotalPorPlataforma(p);

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
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
      texto += `${i}) ${d.correo} — 🔑 ${d?.clave ? d.clave : "-"} — ${d.disp}/${total ?? "-"}\n`;
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
      .where("disp", ">=", 1)
      .where("estado", "==", "activa")
      .get();

    let libres = 0;
    snap.forEach((d) => (libres += Number(d.data().disp || 0)));
    texto += `✅ *${p}*: ${libres} libres (/${totals?.[p] ?? "-"})\n`;
  }

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
}

// ===============================
// AUTOBLOQUEO: si disp llega a 0 => estado "llena"
// ===============================
async function aplicarAutoLleno(chatId, ref, dataAntes, dataDespues) {
  const antes = Number(dataAntes?.disp ?? 0);
  const despues = Number(dataDespues?.disp ?? 0);

  if (despues <= 0) {
    await ref.set(
      { disp: 0, estado: "llena", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
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

// ===============================
// INVENTARIO (CRUD) — comandos
// ===============================
bot.onText(/\/add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/);

  if (parts.length < 3)
    return bot.sendMessage(chatId, "⚠️ Uso: /add correo CLAVE plataforma disp [activa|llena]\nO: /add correo plataforma disp");

  let correo = "";
  let clave = "";
  let plataforma = "";
  let dispStr = "";
  let estadoInput = "";

  // formato corto: /add correo plataforma disp
  if (parts.length >= 3 && parts[0].includes("@") && esPlataformaValida(parts[1]) && /^\d+$/.test(parts[2])) {
    correo = parts[0];
    plataforma = parts[1];
    dispStr = parts[2];
    estadoInput = parts[3] || "activa";
    clave = "";
  } else {
    // formato largo: /add correo CLAVE plataforma disp [estado]
    correo = parts[0];
    clave = parts[1];
    plataforma = parts[2];
    dispStr = parts[3] || "0";
    estadoInput = parts[4] || "activa";
  }

  correo = String(correo).trim().toLowerCase();
  plataforma = normalizarPlataforma(plataforma);
  const disp = Number(dispStr);

  estadoInput = String(estadoInput || "activa").toLowerCase();
  const estado = estadoInput === "llena" || estadoInput === "bloqueada" ? "llena" : "activa";

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido.");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!Number.isFinite(disp) || disp < 0) return bot.sendMessage(chatId, "⚠️ disp inválido.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const now = admin.firestore.FieldValue.serverTimestamp();

  const prev = await ref.get();
  const data = {
    correo,
    plataforma,
    disp,
    clave: clave ? String(clave) : prev.exists ? prev.data()?.clave || "" : "",
    estado: disp <= 0 ? "llena" : estado,
    updatedAt: now,
  };
  if (!prev.exists) data.createdAt = now;

  await ref.set(data, { merge: true });

  // refrescar submenu si aplica
  try {
    const ctx = pending.get(String(chatId));
    if (ctx?.mode === "invSubmenuCtx" && ctx?.plat === plataforma && ctx?.correo === correo) {
      await enviarSubmenuInventario(chatId, plataforma, correo);
    }
  } catch (e) {}

  const total = await getTotalPorPlataforma(plataforma);
  const claveOut = data.clave ? data.clave : "-";

  return bot.sendMessage(
    chatId,
    `✅ *Agregada*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${claveOut}\n👤 Disponibles: ${disp}/${total ?? "-"}\nEstado: *${fmtEstado(data.estado)}*`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/del\s+(\S+)\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /del correo plataforma");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  await ref.delete();
  return bot.sendMessage(chatId, `🗑️ Eliminada: ${plataforma.toUpperCase()} — ${correo}`);
});

bot.onText(/\/editclave\s+(\S+)\s+(\S+)\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const nueva = String(match[3] || "").trim();

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /editclave correo plataforma NUEVA_CLAVE");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!nueva) return bot.sendMessage(chatId, "⚠️ Falta la clave.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  await ref.set({ clave: nueva, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  // refrescar submenu si aplica
  try {
    const ctx = pending.get(String(chatId));
    if (ctx?.mode === "invSubmenuCtx" && ctx?.plat === plataforma && ctx?.correo === correo) {
      await enviarSubmenuInventario(chatId, plataforma, correo);
    }
  } catch (e) {}

  return bot.sendMessage(chatId, `✅ Clave actualizada\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${nueva}`);
});

// ===============================
// CLIENTES: FICHA + MENÚS
// ===============================
async function getCliente(clientId) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() || {}) };
}

async function enviarFichaCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);

  let txt = `✅ *Cliente*\n`;
  txt += `Datos del cliente:\n`;
  txt += `${c.nombrePerfil || "-"}\n`;
  txt += `${c.telefono || "-"}\n`;
  txt += `${c.vendedor || "-"}\n\n`;

  txt += `SERVICIOS (ordenados por fecha):\n`;
  if (servicios.length === 0) txt += "— Sin servicios —\n";
  else
    servicios.forEach((s, i) => {
      txt += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`;
    });

  const kb = [];
  kb.push([{ text: "✏️ Editar cliente", callback_data: `cli:edit:menu:${clientId}` }]);
  if (servicios.length > 0) {
    kb.push([{ text: "🧩 Editar servicios", callback_data: `cli:serv:list:${clientId}` }]);
    kb.push([{ text: "🔄 Renovar servicio", callback_data: `cli:ren:list:${clientId}` }]);
  }
  kb.push([{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, txt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: kb } });
}

async function menuEditarCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const t =
    `✏️ *EDITAR CLIENTE*\n\n` +
    `👤 Nombre: *${c.nombrePerfil || "-"}*\n` +
    `📱 Tel: *${c.telefono || "-"}*\n` +
    `🧑‍💼 Vendedor: *${c.vendedor || "-"}*`;

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

  const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);
  if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

  const kb = servicios.map((s, i) => [
    { text: `🧩 ${i + 1}) ${s.plataforma} — ${s.correo}`, callback_data: `cli:serv:menu:${clientId}:${i}` },
  ]);
  kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, "🧩 *EDITAR SERVICIOS*\nSeleccione un servicio:", { inline_keyboard: kb }, "Markdown");
}

async function menuServicio(chatId, clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

  const s = servicios[idx] || {};
  const t =
    `🧩 *SERVICIO #${idx + 1}*\n\n` +
    `📌 Plataforma: *${s.plataforma || "-"}*\n` +
    `📧 Correo: *${s.correo || "-"}*\n` +
    `🔐 Pin: *${s.pin || "-"}*\n` +
    `💰 Precio: *${Number(s.precio || 0)}* Lps\n` +
    `📅 Renovación: *${s.fechaRenovacion || "-"}*`;

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
// COMANDO: VER MI TELEGRAM ID
// ===============================
bot.onText(/\/miid/i, async (msg) => {

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await bot.sendMessage(
    chatId,
`🆔 Tu Telegram ID es:

${userId}

📩 Envíalo al administrador para activarte en el sistema.`
  );

});

// ===============================
// CLIENTES: LISTA RESULTADOS / TXT
// ===============================
async function enviarListaResultadosClientes(chatId, resultados) {
  const dedup = dedupeClientes(resultados);

  let txt = `📱 *RESULTADOS*\nSe encontraron *${dedup.length}* clientes.\n\n`;

  dedup.forEach((c, i) => {
    const nombre = c.nombrePerfil || "-";
    const tel = c.telefono || "-";
    const vend = c.vendedor || "-";
    txt += `*${i + 1})* ${nombre} | ${tel} | ${vend}\n`;
  });

  if (txt.length > 3800) {
    return enviarTxtComoArchivo(chatId, txt, `clientes_resultados_${Date.now()}.txt`);
  }

  const kb = dedup.map((c, i) => [
    { text: `👤 ${i + 1}) ${c.nombrePerfil || "-"} (${c.vendedor || "-"})`, callback_data: `cli:view:${c.id}` },
  ]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, txt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: kb } });
}

async function reporteClientesTXTGeneral(chatId) {
  const snap = await db.collection("clientes").limit(5000).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay clientes.");

  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  arr.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));

  let body = "CLIENTES (NOMBRE | TELEFONO)\n\n";
  arr.forEach((c, i) => {
    const nombre = stripAcentos(c.nombrePerfil || "-").replace(/[^\x00-\x7F]/g, "");
    const tel = onlyDigits(c.telefono || "");
    body += `${String(i + 1).padStart(3, "0")}) ${nombre} | ${tel}\n`;
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

    const vendClean = stripAcentos(vend).replace(/[^\x00-\x7F]/g, "");
    let body = `VENDEDOR: ${vendClean}\n`;
    body += `TOTAL CLIENTES: ${lista.length}\n\n`;
    body += "CLIENTES (NOMBRE | TELEFONO)\n\n";

    lista.forEach((c, i) => {
      const nombre = stripAcentos(c.nombrePerfil || "-").replace(/[^\x00-\x7F]/g, "");
      const tel = onlyDigits(c.telefono || "");
      body += `${String(i + 1).padStart(3, "0")}) ${nombre} | ${tel}\n`;
    });

    const fileSafe = vendClean.replace(/[^\w\-]+/g, "_").slice(0, 40) || "VENDEDOR";
    await enviarTxtComoArchivo(chatId, body, `clientes_${fileSafe}_${Date.now()}.txt`);
  }

  return bot.sendMessage(chatId, "✅ Listo: enviados los TXT por vendedor.");
}

// ===============================
// BUSQUEDA CLIENTE (ROBUSTA)
// ===============================
async function buscarPorTelefonoTodos(telInput) {
  const tnorm = onlyDigits(telInput);
  if (!tnorm) return [];

  const snapNorm = await db.collection("clientes").where("telefono_norm", "==", tnorm).limit(50).get();
  if (!snapNorm.empty) return snapNorm.docs.map((d) => ({ id: d.id, ...d.data() }));

  const snapTel = await db.collection("clientes").where("telefono", "==", tnorm).limit(50).get();
  if (!snapTel.empty) return snapTel.docs.map((d) => ({ id: d.id, ...d.data() }));

  const legacy = await db.collection("clientes").doc(tnorm).get();
  if (legacy.exists) return [{ id: legacy.id, ...legacy.data() }];

  return [];
}

async function buscarClienteRobusto(queryLower) {
  const qRaw = String(queryLower || "").trim();
  const q = normTxt(qRaw);
  const qTel = onlyDigits(qRaw);

  if (qTel && qTel.length >= 7) {
    return await buscarPorTelefonoTodos(qTel);
  }

  try {
    const snapName = await db
      .collection("clientes")
      .orderBy("nombre_norm")
      .startAt(q)
      .endAt(q + "\uf8ff")
      .limit(25)
      .get();

    if (!snapName.empty) return snapName.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {}

  const snap = await db.collection("clientes").limit(1000).get();
  const encontrados = [];
  snap.forEach((doc) => {
    const c = doc.data() || {};
    const n = normTxt(c.nombrePerfil || "");
    const v = normTxt(c.vendedor || "");
    if (n.includes(q) || v.includes(q)) encontrados.push({ id: doc.id, ...c });
  });

  return encontrados.slice(0, 25);
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

  if (esTelefono(q)) {
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

  const kb = dedup.map((c) => [
    { text: `👤 ${c.nombrePerfil || "-"} (${c.telefono || "-"})`, callback_data: `cli:view:${c.id}` },
  ]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, "🔎 Seleccione el cliente:", { reply_markup: { inline_keyboard: kb } });
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

// ✅ VINCULACIÓN
bot.onText(/\/miid/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const ok = (await isAdmin(userId)) || (await isVendedor(userId));
  if (!ok) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return bot.sendMessage(chatId, `🆔 Tu Telegram ID es: ${userId}`);
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
// ✅ TRANSACCIONES (FIX: guardar múltiples servicios sin crashear)
// ===============================
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
      { servicios: arr, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { cliente: cur, servicios: arr };
  });
}

// ===============================
// CLIENTES (WIZARD: NUEVO CLIENTE)
// ===============================
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

  const rows = [
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
    // ✅ NUEVOS
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

  return rows;
}

async function wizardStart(chatId) {
  wset(chatId, { step: 1, data: {}, clientId: null, servStep: 0, servicio: {} });
  return bot.sendMessage(chatId, "👥 *NUEVO CLIENTE*\n\n(1/3) Escriba *Nombre*:", { parse_mode: "Markdown" });
}

async function wizardNext(chatId, text) {
  const st = w(chatId);
  if (!st) return;

  const t = String(text || "").trim();
  const d = st.data;

  if (st.step === 1) {
    d.nombrePerfil = t;
    st.step = 2;
    wset(chatId, st);
    return bot.sendMessage(chatId, "(2/3) Escriba *Teléfono*:", { parse_mode: "Markdown" });
  }

  if (st.step === 2) {
    d.telefono = t;
    st.step = 3;
    wset(chatId, st);
    return bot.sendMessage(chatId, "(3/3) Escriba *Vendedor*:", { parse_mode: "Markdown" });
  }

  if (st.step === 3) {
    d.vendedor = t;

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

    st.step = 4;
    st.servStep = 1;
    st.servicio = {};
    wset(chatId, st);

    return bot.sendMessage(chatId, "✅ Cliente creado.\n\n📌 Ahora agreguemos el servicio.\n(Servicio 1/5) Plataforma:", {
      reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", st.clientId) },
    });
  }

  if (st.step === 4) {
    const s = st.servicio || {};

    // servStep 1 espera selección por botón, no texto:
    if (st.servStep === 1) {
      return bot.sendMessage(chatId, "📌 Seleccione la plataforma con los botones.");
    }

    if (st.servStep === 2) {
      if (!t.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido. Escriba el correo:");
      s.correo = t.toLowerCase();
      st.servStep = 3;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 3/5) Pin/Clave:");
    }

    if (st.servStep === 3) {
      s.pin = t;
      st.servStep = 4;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 4/5) Precio (solo número, Lps):");
    }

    if (st.servStep === 4) {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
      s.precio = n;
      st.servStep = 5;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 5/5) Fecha renovación (dd/mm/yyyy):");
    }

    if (st.servStep === 5) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");

      try {
        s.fechaRenovacion = String(t).trim();

        // ✅ FIX: guardar con TX (evita que “no guarde” al agregar varias plataformas)
        const { cliente, servicios } = await addServicioTx(String(st.clientId), {
          plataforma: String(s.plataforma || "").trim(),
          correo: String(s.correo || "").trim().toLowerCase(),
          pin: String(s.pin || "").trim(),
          precio: Number(s.precio || 0),
          fechaRenovacion: s.fechaRenovacion,
        });

        st.servicio = {};
        st.servStep = 1;
        st.step = 4;
        wset(chatId, st);

        const ordenados = serviciosOrdenados(servicios);

        // ✅ FIX: no pasar 4096 chars (si crece, manda TXT)
        let resumen =
          `✅ Servicio agregado.\n¿Desea agregar otra plataforma a este cliente?\n\n` +
          `Cliente:\n${cliente?.nombrePerfil || st.data.nombrePerfil}\n${cliente?.telefono || st.data.telefono}\n${cliente?.vendedor || st.data.vendedor}\n\n` +
          `SERVICIOS (ordenados por fecha):\n` +
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
      } catch (err) {
        logErr("❌ Wizard servStep 5 error:", err?.message || err);
        return bot.sendMessage(chatId, `⚠️ Error guardando servicio.\nDetalle: ${String(err?.message || err).slice(0, 300)}`);
      }
    }
  }
}

// ===============================
// RENOVACIONES + TXT
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
  const titulo = vendedorOpt ? `RENOVACIONES ${fechaDMY} — ${vendedorOpt}` : `RENOVACIONES ${fechaDMY} — GENERAL`;
  let t = `📅 *${titulo}*\n\n`;

  if (!list || list.length === 0) {
    t += "⚠️ No hay renovaciones.\n";
    return t;
  }

  let suma = 0;
  list.forEach((x, i) => {
    suma += Number(x.precio || 0);
    t += `${i + 1}) ${x.nombrePerfil} — ${x.plataforma} — ${x.precio} Lps — ${x.telefono} — ${x.vendedor}\n`;
  });

  t += `\n━━━━━━━━━━━━━━\n`;
  t += `Clientes: ${list.length}\n`;
  t += `Total a cobrar: ${suma} Lps\n`;
  return t;
}

async function enviarTXT(chatId, list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt
    ? `renovaciones_${stripAcentos(vendedorOpt)}_${fechaDMY}`
    : `renovaciones_general_${fechaDMY}`;
  const fileSafe = titulo.replace(/[^\w\-]+/g, "_");
  let body = "";

  body += vendedorOpt
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
    body += `\n--------------------\n`;
    body += `CLIENTES: ${list.length}\n`;
    body += `TOTAL: ${suma} Lps\n`;
  }

  return enviarTxtComoArchivo(chatId, body, `${fileSafe}.txt`);
}

// ✅ SOLO SUPERADMIN: Enviar TXT a todos (HOY) por revendedores activos con telegramId
async function enviarTXTATodosHoy(superChatId) {
  const fecha = hoyDMY();
  const snap = await db.collection("revendedores").where("activo", "==", true).get();
  if (snap.empty) return bot.sendMessage(superChatId, "⚠️ No hay revendedores activos.");

  let enviados = 0;
  let saltados = 0;

  for (const d of snap.docs) {
    const r = d.data() || {};
    const nombre = String(r.nombre || "").trim();
    const telegramId = String(r.telegramId || "").trim();

    if (!telegramId || !nombre) {
      saltados++;
      continue;
    }

    const list = await obtenerRenovacionesPorFecha(fecha, nombre);
    await enviarTXT(telegramId, list, fecha, nombre);
    enviados++;
  }

  return bot.sendMessage(superChatId, `✅ Enviado TXT HOY (${fecha})\n• Revendedores enviados: ${enviados}\n• Saltados (sin telegramId/nombre): ${saltados}`);
}

bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await isAdmin(userId);
  const vend = await getRevendedorPorTelegramId(userId);

  if (!adminOk && !(vend && vend.nombre)) return bot.sendMessage(chatId, "⛔ Acceso denegado");

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

  if (!adminOk && !(vend && vend.nombre)) return bot.sendMessage(chatId, "⛔ Acceso denegado");

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
// REVENDEDORES (simple)
// ===============================
async function listarRevendedores(chatId) {
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay revendedores.");

  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  all.sort((a, b) => normTxt(a.nombre).localeCompare(normTxt(b.nombre)));

  let t = "👤 *REVENDEDORES*\n\n";
  all.forEach((x) => {
    const estado = x.activo === true ? "✅ activo" : "⛔ inactivo";
    const tid = x.telegramId ? ` | 🆔 ${x.telegramId}` : "";
    t += `• ${x.nombre || x.id} — ${estado}${tid}\n`;
  });

  if (t.length > 3800) return enviarTxtComoArchivo(chatId, t, `revendedores_${Date.now()}.txt`);
  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
}

// ===============================
// ADMINS (SUPER_ADMIN)
// ===============================
bot.onText(/\/adminadd\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede agregar admins.");

  const id = String(match[1] || "").trim();
  await db.collection("admins").doc(id).set(
    { activo: true, updatedAt: admin.firestore.FieldValue.serverTimestamp(), creadoPor: String(userId) },
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
    { activo: false, updatedAt: admin.firestore.FieldValue.serverTimestamp(), desactivadoPor: String(userId) },
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
// START + MENU (admin o vendedor)
// ===============================
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await tryDeleteMsg(chatId, msg.message_id);

  if (await isAdmin(userId)) return menuPrincipal(chatId);
  if (await isVendedor(userId)) return menuVendedor(chatId);

  return bot.sendMessage(chatId, "⛔ Acceso denegado");
});

bot.onText(/\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await tryDeleteMsg(chatId, msg.message_id);

  if (await isAdmin(userId)) return menuPrincipal(chatId);
  if (await isVendedor(userId)) return menuVendedor(chatId);

  return bot.sendMessage(chatId, "⛔ Acceso denegado");
});

// ✅ /netflix etc (admin only)
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
      "vend:vincular:info",
      "rev:lista",
      "ren:hoy",
      "txt:hoy",
      "menu:renovaciones",
      "menu:buscar",
    ]);

    if (!adminOk) {
      if (!vendedorOnlyAllowed.has(data)) {
        return upsertPanel(
          chatId,
          "⛔ Modo vendedor: solo renovaciones.\n\nUsa:\n• Mis renovaciones\n• TXT Mis renovaciones\n• /vincular_vendedor TU_NOMBRE (si falta)\n",
          { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
          "Markdown"
        );
      }
    }

    // MENUS (admin)
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

      // INVENTARIO
      if (data === "inv:general") return mostrarStockGeneral(chatId);

      if (data.startsWith("inv:") && !data.startsWith("inv:open:") && !data.startsWith("inv:menu:")) {
        const [, plat, pageStr] = data.split(":");
        return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
      }

      if (data.startsWith("inv:open:")) {
        const [, , plat, correo] = data.split(":");
        pending.set(String(chatId), {
          mode: "invSubmenuCtx",
          plat: normalizarPlataforma(plat),
          correo: String(correo).toLowerCase(),
        });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      // INVENTARIO SUBMENU
      if (data.startsWith("inv:menu:sumar:")) {
        const [, , , plat, correo] = data.split(":");
        pending.set(String(chatId), { mode: "invSumarQty", plat, correo });
        return upsertPanel(
          chatId,
          `➕ *Agregar perfil*\n📌 ${String(plat).toUpperCase()}\n📧 ${correo}\n\nEscriba cantidad a *SUMAR* (ej: 1):`,
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${correo}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:restar:")) {
        const [, , , plat, correo] = data.split(":");
        pending.set(String(chatId), { mode: "invRestarQty", plat, correo });
        return upsertPanel(
          chatId,
          `➖ *Quitar perfil*\n📌 ${String(plat).toUpperCase()}\n📧 ${correo}\n\nEscriba cantidad a *RESTAR* (ej: 1):`,
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${correo}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:clave:")) {
        const [, , , plat, correo] = data.split(":");
        pending.set(String(chatId), { mode: "invEditClave", plat, correo });
        return upsertPanel(
          chatId,
          `✏️ *Editar clave*\n📌 ${String(plat).toUpperCase()}\n📧 ${correo}\n\nEscriba la nueva clave:`,
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${correo}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:cancel:")) {
        const [, , , plat, correo] = data.split(":");
        pending.delete(String(chatId));
        pending.set(String(chatId), {
          mode: "invSubmenuCtx",
          plat: normalizarPlataforma(plat),
          correo: String(correo).toLowerCase(),
        });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (data.startsWith("inv:menu:borrar:")) {
        const [, , , plat, correo] = data.split(":");
        return bot.sendMessage(chatId, `🗑️ Confirmar *borrar correo*?\n📌 ${String(plat).toUpperCase()}\n📧 ${correo}`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Confirmar",
                  callback_data: `inv:menu:borrarok:${normalizarPlataforma(plat)}:${String(correo).toLowerCase()}`,
                },
              ],
              [{ text: "⬅️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${correo}` }],
            ],
          },
        });
      }

      if (data.startsWith("inv:menu:borrarok:")) {
        const [, , , plat, correo] = data.split(":");
        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ No existe ese correo en inventario.");
        await ref.delete();
        pending.delete(String(chatId));
        return bot.sendMessage(chatId, `🗑️ Borrado:\n📌 ${String(plat).toUpperCase()}\n📧 ${correo}`);
      }

      // CLIENTES
      if (data === "cli:txt:general") return reporteClientesTXTGeneral(chatId);
      if (data === "cli:txt:vendedores_split") return reporteClientesSplitPorVendedorTXT(chatId);
      if (data.startsWith("cli:view:")) return enviarFichaCliente(chatId, data.split(":")[2]);
      if (data === "cli:wiz:start") return wizardStart(chatId);

      // WIZARD plataforma
      if (data.startsWith("wiz:plat:")) {
        const parts = data.split(":");
        const platRaw = parts[2] || "";
        const clientId = parts[3] || null;

        const st = w(chatId);
        if (!st) return bot.sendMessage(chatId, "⚠️ Wizard no activo. Toque ➕ Nuevo cliente.");

        const plat = normalizarPlataforma(platRaw);
        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, `⚠️ Plataforma inválida en wizard: ${platRaw}`);

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
        const st = w(chatId);
        if (!st) return bot.sendMessage(chatId, "⚠️ Wizard no activo.");

        st.clientId = clientId;
        st.step = 4;
        st.servStep = 1;
        st.servicio = {};
        wset(chatId, st);

        return bot.sendMessage(chatId, "📌 Agregar otro servicio\nSeleccione plataforma:", {
          reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", clientId) },
        });
      }

      if (data.startsWith("wiz:finish:")) {
        const clientId = data.split(":")[2];
        wclear(chatId);
        return enviarFichaCliente(chatId, clientId);
      }

      // EDITAR CLIENTE
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

      // SERVICIOS
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

      // editar campos de servicio
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
          field === "mail"
            ? "📧 *Cambiar correo*"
            : field === "pin"
            ? "🔐 *Cambiar pin*"
            : field === "precio"
            ? "💰 *Cambiar precio*"
            : "📅 *Cambiar fecha*";

        const hint =
          field === "precio"
            ? "Escriba el precio (solo número):"
            : field === "fecha"
            ? "Escriba dd/mm/yyyy:"
            : "Escriba el nuevo valor:";

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

      // eliminar perfil
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

      // RENOVAR (se mantiene)
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
        const texto = `🔄 *RENOVAR SERVICIO #${idx + 1}*\n📌 ${s.plataforma || "-"}\n📧 ${s.correo || "-"}\n📅 Actual: *${s.fechaRenovacion || "-"}*`;

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

      // ✅ SOLO SUPERADMIN: enviar TXT a todos hoy
      if (data === "txt:todos:hoy") {
        if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPERADMIN.");
        return enviarTXTATodosHoy(chatId);
      }
    } // fin adminOk

    // RENOVACIONES UI (admin y vendedor)
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
      if (!vendOk) {
        return bot.sendMessage(
          chatId,
          "⚠️ No estás vinculado a un vendedor.\nUsa:\n/miid\n/vincular_vendedor TU_NOMBRE_EN_REVENDEDORES"
        );
      }
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      const texto = renovacionesTexto(list, fecha, vend.nombre);
      return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
    }

    if (data === "txt:mis") {
      if (!vendOk) {
        return bot.sendMessage(
          chatId,
          "⚠️ No estás vinculado a un vendedor.\nUsa:\n/miid\n/vincular_vendedor TU_NOMBRE_EN_REVENDEDORES"
        );
      }
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      return enviarTXT(chatId, list, fecha, vend.nombre);
    }

    if (data === "rev:lista") return listarRevendedores(chatId);

    if (data === "vend:vincular:info") {
      return upsertPanel(
        chatId,
        "🔗 *Vincular vendedor*\n\nEscriba:\n`/vincular_vendedor TU_NOMBRE`\n\nEjemplo:\n`/vincular_vendedor Juan Perez`",
        { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
        "Markdown"
      );
    }

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    logErr("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// MENSAJES (wizard + pendientes + /correo inventario + /NOMBRE /TELEFONO)
// ===============================

// helper: patch servicio
async function patchServicio(clientId, idx, patch) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return false;
  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return false;
  servicios[idx] = { ...(servicios[idx] || {}), ...patch };
  await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";
  if (!chatId) return;

  try {
    if (!allowMsg(chatId, userId)) return;

    // COMANDOS
    if (text.startsWith("/")) {
      const adminOk = await isAdmin(userId);
      const vendOk = await isVendedor(userId);

      if (!adminOk && !vendOk) return;

      const cmd = limpiarQuery(text);
      const first = cmd.split(" ")[0];

      // /correo => submenu inventario (admin only)
      if (adminOk && isEmailLike(first)) {
        const correo = first;
        const hits = await buscarInventarioPorCorreo(correo);

        if (hits.length === 1) {
          pending.set(String(chatId), {
            mode: "invSubmenuCtx",
            plat: normalizarPlataforma(hits[0].plataforma),
            correo: String(correo).toLowerCase(),
          });
          return enviarSubmenuInventario(chatId, hits[0].plataforma, correo);
        }

        if (hits.length > 1) {
          const kb = hits.map((x) => [
            { text: `📌 ${String(x.plataforma).toUpperCase()}`, callback_data: `inv:open:${normalizarPlataforma(x.plataforma)}:${correo}` },
          ]);
          kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
          return bot.sendMessage(chatId, `📧 ${correo}\nSeleccione plataforma:`, { reply_markup: { inline_keyboard: kb } });
        }
      }

      // comandos permitidos vendedor
      const vendedorCmd = new Set(["menu", "start", "miid", "vincular_vendedor", "renovaciones", "txt"]);
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
        "add",
        "del",
        "editclave",
        "adminadd",
        "admindel",
        "adminlist",
        "miid",
        "vincular_vendedor",
        ...PLATAFORMAS,
      ]);

      // /algo no reservado => búsqueda rápida (admin only)
      if (adminOk && !comandosReservados.has(first)) {
        const query = cmd;

        if (esTelefono(query)) {
          const resultados = await buscarPorTelefonoTodos(query);
          const dedup = dedupeClientes(resultados);
          if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
          if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
          return enviarListaResultadosClientes(chatId, dedup);
        }

        const resultados = await buscarClienteRobusto(query);
        const dedup = dedupeClientes(resultados);

        if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
        if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

        const kb = dedup.map((c) => [
          { text: `👤 ${c.nombrePerfil || "-"} (${c.telefono || "-"})`, callback_data: `cli:view:${c.id}` },
        ]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
        return bot.sendMessage(chatId, "🔎 Seleccione el cliente:", { reply_markup: { inline_keyboard: kb } });
      }

      return;
    }

    // Wizard activo (admin only)
    if (wizard.has(String(chatId))) {
      if (!(await isAdmin(userId))) return;
      return wizardNext(chatId, text);
    }

    // PENDING FLOWS (admin only)
    if (pending.has(String(chatId))) {
      if (!(await isAdmin(userId))) return;

      const p = pending.get(String(chatId));
      const t = String(text || "").trim();

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

        await ref.set({ disp: nuevoDisp, estado: "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

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
        const nueva = t;
        if (!nueva) return bot.sendMessage(chatId, "⚠️ Clave vacía.");

        pending.delete(String(chatId));

        const correo = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

        await ref.set({ clave: nueva, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

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
        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set({ nombrePerfil: t, nombre_norm: normTxt(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditTel") {
        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set({ telefono: t, telefono_norm: onlyDigits(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditVendedor") {
        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set({ vendedor: t, vendedor_norm: normTxt(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliAddServMail") {
        if (!t.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido. Escriba el correo:");
        pending.set(String(chatId), { mode: "cliAddServPin", clientId: p.clientId, plat: p.plat, mail: t.toLowerCase() });
        return bot.sendMessage(chatId, "🔐 Escriba el pin/clave:");
      }

      if (p.mode === "cliAddServPin") {
        pending.set(String(chatId), { mode: "cliAddServPrecio", clientId: p.clientId, plat: p.plat, mail: p.mail, pin: t });
        return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
      }

      if (p.mode === "cliAddServPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
        pending.set(String(chatId), { mode: "cliAddServFecha", clientId: p.clientId, plat: p.plat, mail: p.mail, pin: p.pin, precio: n });
        return bot.sendMessage(chatId, "📅 Fecha renovación (dd/mm/yyyy):");
      }

      if (p.mode === "cliAddServFecha") {
        try {
          if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");

          pending.delete(String(chatId));

          // ✅ guardar con TX también
          await addServicioTx(String(p.clientId), {
            plataforma: p.plat,
            correo: p.mail,
            pin: p.pin,
            precio: p.precio,
            fechaRenovacion: t,
          });

          return enviarFichaCliente(chatId, p.clientId);
        } catch (err) {
          logErr("❌ cliAddServFecha error:", err?.message || err);
          return bot.sendMessage(chatId, `⚠️ Error guardando servicio.\nDetalle: ${String(err?.message || err).slice(0, 300)}`);
        }
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
// ✅ AUTO TXT 7:00 AM (por vendedor) — renovaciones diarias
// ✅ Protección persistente: config/dailyRun { lastRun: "dd/mm/yyyy" }
// ===============================
let _lastDailyRun = ""; // memory
async function getLastRunDB() {
  const ref = db.collection("config").doc("dailyRun");
  const doc = await ref.get();
  return doc.exists ? String(doc.data()?.lastRun || "") : "";
}
async function setLastRunDB(dmy) {
  const ref = db.collection("config").doc("dailyRun");
  await ref.set({ lastRun: String(dmy), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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

  const dmy = `${obj.day}/${obj.month}/${obj.year}`;
  return { dmy, hh: Number(obj.hour), mm: Number(obj.minute) };
}

async function enviarTxtRenovacionesDiariasPorVendedor() {
  const { dmy } = getTimePartsNow();

  const snap = await db.collection("revendedores").where("activo", "==", true).get();
  if (snap.empty) return;

  for (const doc of snap.docs) {
    const r = doc.data() || {};
    const nombre = String(r.nombre || "").trim();
    const telegramId = String(r.telegramId || "").trim();

    if (!nombre || !telegramId) continue;

    const list = await obtenerRenovacionesPorFecha(dmy, nombre);
    await enviarTXT(telegramId, list, dmy, nombre);
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
// (OPCIONAL) HTTP keepalive para Render
// ===============================
const PORT = process.env.PORT || 10000;
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  })
  .listen(PORT, () => console.log("✅ HTTP OK on", PORT));
