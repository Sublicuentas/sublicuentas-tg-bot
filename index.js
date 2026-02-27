/*
 * ✅ SUBLICUENTAS TG BOT — INDEX FINAL (ACTUALIZADO)
 *
 * ✅ BUSQUEDA UNIVERSAL (SIN /buscar):
 *   - Envíe: nombre | teléfono | correo
 *   - También sirve: /nombre | /teléfono | /correo
 *
 * ✅ INVENTARIO (al buscar un correo):
 *   - Muestra resultados por plataforma
 *   - Botones por plataforma:
 *      🔑 Editar clave
 *      ➖ Restar perfiles
 *      ➕ Sumar perfiles
 *      🗑️ Borrar cuenta (confirmación)
 *
 * ✅ /buscar se mantiene como alias (opcional)
 * ✅ /clientes_txt genera TXT general
 *
 * ✅ FIX: nada de Telegraf mezclado
 * ✅ FIX: reporte txt por botón sin bot.emit raro
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

// ===============================
// ENV
// ===============================
const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;

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

// ===============================
// TELEGRAM BOT
// ===============================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("✅ Bot iniciado");

// ===============================
// CONSTANTES
// ===============================
const PLATAFORMAS = ["netflix", "disneyp", "disneys", "hbomax", "primevideo", "paramount", "crunchyroll"];
const PAGE_SIZE = 10;

// Pendientes (para flows por botones)
const pending = new Map(); // chatId -> { mode, docId, action?, payload? }

// ===============================
// HELPERS
// ===============================
function normalizarPlataforma(txt = "") {
  return String(txt).toLowerCase().replace(/\s+/g, "");
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
function stripAcentos(str = "") {
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
  const t = String(txt || "").trim();
  return /^[0-9]{7,15}$/.test(t);
}
function esCorreo(txt) {
  const t = String(txt || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}
function limpiarQuery(txt) {
  return String(txt || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function isAdmin(userId) {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data().activo === true;
}

async function getTotalPorPlataforma(plataforma) {
  const cfg = await db.collection("config").doc("totales_plataforma").get();
  const p = normalizarPlataforma(plataforma);
  if (!cfg.exists) return null;
  return cfg.data()?.[p] ?? null;
}

async function asegurarTotalesDefault() {
  const ref = db.collection("config").doc("totales_plataforma");
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({
      netflix: 5,
      disneyp: 6,
      disneys: 5,
      hbomax: 5,
      primevideo: 5,
      paramount: 5,
      crunchyroll: 5,
    });
    console.log("✅ Totales default creados");
    return;
  }
  const data = doc.data() || {};
  if (data.disneyp !== 6) {
    await ref.set({ disneyp: 6 }, { merge: true });
    console.log("✅ Total disneyp actualizado a 6");
  }
}
asegurarTotalesDefault().catch(console.log);

// ===============================
// MENUS
// ===============================
async function menuPrincipal(chatId) {
  return bot.sendMessage(chatId, "📌 *MENÚ PRINCIPAL*", {
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
}

async function menuInventario(chatId) {
  return bot.sendMessage(chatId, "📦 *INVENTARIO* (elija plataforma)", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📺 Netflix", callback_data: "inv:netflix:0" },
          { text: "🏰 Disney Premium", callback_data: "inv:disneyp:0" },
        ],
        [
          { text: "🎞️ Disney Standard", callback_data: "inv:disneys:0" },
          { text: "🍿 HBO Max", callback_data: "inv:hbomax:0" },
        ],
        [
          { text: "🎥 Prime Video", callback_data: "inv:primevideo:0" },
          { text: "📀 Paramount+", callback_data: "inv:paramount:0" },
        ],
        [{ text: "🍥 Crunchyroll", callback_data: "inv:crunchyroll:0" }],
        [{ text: "📦 Stock General", callback_data: "inv:general" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
}

async function menuClientes(chatId) {
  return bot.sendMessage(
    chatId,
    "👥 *CLIENTES*\n\n• Buscar (abre ficha)\n• Reporte TXT (lista general)\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
          [{ text: "📄 Reporte TXT", callback_data: "cli:txt:general" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ],
      },
    }
  );
}

async function menuPagos(chatId) {
  return bot.sendMessage(chatId, "💳 *PAGOS*\n\n(Lo dejamos listo para armar wizard después)", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
  });
}

async function menuRenovaciones(chatId) {
  return bot.sendMessage(
    chatId,
    "📅 *RENOVACIONES*\n\nComandos:\n• /renovaciones hoy\n• /renovaciones dd/mm/yyyy\n• /renovaciones NOMBRE dd/mm/yyyy\n\nTXT:\n• /txt hoy\n• /txt dd/mm/yyyy\n• /txt NOMBRE dd/mm/yyyy\n",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
    }
  );
}

// ===============================
// INVENTARIO: LISTA + PAGINACION
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
      const clave = d?.clave ? String(d.clave) : "-";
      texto += `${i}) ${d.correo} — 🔑 ${clave} — ${d.disp}/${total ?? "-"}\n`;
      i++;
    }

    texto += `\n━━━━━━━━━━━━━━\n`;
    texto += `📊 Cuentas con stock: ${totalItems}\n`;
    texto += `👤 Perfiles libres totales: ${libresTotal}\n`;
  }

  texto += `\n📄 Página: ${safePage + 1}/${totalPages}`;
  return { texto, safePage, totalPages };
}

async function enviarInventarioPlataforma(chatId, plataforma, page) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

  const { texto, safePage, totalPages } = await inventarioPlataformaTexto(p, page);

  const canBack = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return bot.sendMessage(chatId, texto, {
    parse_mode: "Markdown",
    reply_markup: {
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
  });
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
// ✅ BUSQUEDA ROBUSTA INVENTARIO (correo)
// ===============================
async function buscarInventarioPorCorreoRobusto(correoLower) {
  const q = String(correoLower || "").trim().toLowerCase();

  const exact = await db.collection("inventario").where("correo", "==", q).limit(50).get();
  if (!exact.empty) return exact.docs.map((d) => ({ id: d.id, ...d.data() }));

  const snap = await db.collection("inventario").limit(5000).get();
  const out = [];
  snap.forEach((doc) => {
    const x = doc.data() || {};
    const c = String(x.correo || "").trim().toLowerCase();
    if (c === q) out.push({ id: doc.id, ...x });
  });
  return out.slice(0, 50);
}

async function responderInventarioPorCorreo(chatId, correo) {
  const res = await buscarInventarioPorCorreoRobusto(correo);
  if (!res.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");

  let t = `📌 *INVENTARIO (correo)*\n${correo}\n\n`;
  const kb = [];

  for (const x of res) {
    const plat = String(x.plataforma || "-").toUpperCase();
    const disp = Number(x.disp || 0);
    const total = await getTotalPorPlataforma(x.plataforma);
    const clave = x.clave ? String(x.clave) : "-";
    const estado = fmtEstado(x.estado || "activa");

    t += `• ${plat} — ${disp}/${total ?? "-"} — ${estado} — 🔑 ${clave}\n`;

    // ✅ Botones por plataforma (por doc)
    kb.push([
      { text: `🔑 Editar clave (${plat})`, callback_data: `inv:editclave:${x.id}` },
      { text: `➖ Restar (${plat})`, callback_data: `inv:restar:${x.id}` },
    ]);
    kb.push([
      { text: `➕ Sumar (${plat})`, callback_data: `inv:sumar:${x.id}` },
      { text: `🗑️ Borrar (${plat})`, callback_data: `inv:delask:${x.id}` },
    ]);
    kb.push([{ text: "────────────", callback_data: "noop" }]);
  }

  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, t, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: kb },
  });
}

// ===============================
// CLIENTES: BUSQUEDA + FICHA (simple)
// ===============================
async function enviarFichaCliente(chatId, clientId) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];

  let txt = `✅ *Cliente*\n`;
  txt += `Datos del cliente:\n`;
  txt += `${c.nombrePerfil || "-"}\n`;
  txt += `${c.telefono || "-"}\n`;
  txt += `${c.vendedor || "-"}\n\n`;

  txt += `SERVICIOS:\n`;
  if (servicios.length === 0) txt += "— Sin servicios —\n";
  else servicios.forEach((s, i) => (txt += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`));

  return bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
}

async function buscarClienteRobusto(queryLower) {
  const q = String(queryLower || "").trim().toLowerCase();

  if (esTelefono(q)) {
    const snapTel = await db.collection("clientes").where("telefono", "==", q).limit(5).get();
    if (!snapTel.empty) return snapTel.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const snap = await db.collection("clientes").limit(5000).get();
  const encontrados = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const nombre = String(c.nombrePerfil || "").toLowerCase();
    const tel = String(c.telefono || "").toLowerCase();
    const vend = String(c.vendedor || "").toLowerCase();

    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    const hitServicio = servicios.some((s) => {
      const pc = String(s.correo || "").toLowerCase();
      const pp = String(s.plataforma || "").toLowerCase();
      return pc.includes(q) || pp.includes(q);
    });

    if (nombre.includes(q) || tel.includes(q) || vend.includes(q) || hitServicio) {
      encontrados.push({ id: doc.id, ...c });
    }
  });

  encontrados.sort((a, b) => String(a.nombrePerfil || "").localeCompare(String(b.nombrePerfil || ""), "es"));
  return encontrados.slice(0, 10);
}

async function responderBusquedaCliente(chatId, q) {
  const resultados = await buscarClienteRobusto(q);
  if (!resultados.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
  if (resultados.length === 1) return enviarFichaCliente(chatId, resultados[0].id);

  const kb = resultados.map((c) => [
    { text: `👤 ${c.nombrePerfil || "-"} (${c.telefono || "-"})`, callback_data: `cli:view:${c.id}` },
  ]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, "🔎 Seleccione el cliente:", { reply_markup: { inline_keyboard: kb } });
}

// ===============================
// ✅ BUSQUEDA UNIVERSAL (SIN /buscar)
// ===============================
async function busquedaUniversal(chatId, qRaw) {
  const q = limpiarQuery(qRaw);
  if (!q) return;

  if (esCorreo(q)) return responderInventarioPorCorreo(chatId, q);
  return responderBusquedaCliente(chatId, q);
}

// ===============================
// /buscar (ALIAS)
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return busquedaUniversal(chatId, match[1]);
});

// ===============================
// /clientes_txt
// ===============================
bot.onText(/\/clientes_txt/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const snap = await db.collection("clientes").limit(5000).get();
  const arr = snap.docs.map((d) => d.data() || {});
  arr.sort((a, b) => String(a.nombrePerfil || "").localeCompare(String(b.nombrePerfil || ""), "es"));

  const filePath = path.join(__dirname, `clientes_general.txt`);
  let body = "REPORTE GENERAL CLIENTES\n\n";
  arr.forEach((c, i) => {
    body += `${String(i + 1).padStart(2, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${c.telefono || "-"}\n`;
  });
  body += `\n--------------------\nTOTAL CLIENTES: ${arr.length}\n`;

  fs.writeFileSync(filePath, body, "utf8");
  await bot.sendDocument(chatId, filePath);
  try { fs.unlinkSync(filePath); } catch (e) {}
});

// ===============================
// START + MENU + comandos plataforma
// ===============================
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return menuPrincipal(chatId);
});
bot.onText(/\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return menuPrincipal(chatId);
});
PLATAFORMAS.forEach((p) => {
  bot.onText(new RegExp("^\\/" + p + "$", "i"), async (msg) => {
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
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    // navegación
    if (data === "go:inicio") return menuPrincipal(chatId);
    if (data === "menu:inventario") return menuInventario(chatId);
    if (data === "menu:clientes") return menuClientes(chatId);
    if (data === "menu:pagos") return menuPagos(chatId);
    if (data === "menu:renovaciones") return menuRenovaciones(chatId);

    if (data === "menu:buscar") {
      return bot.sendMessage(
        chatId,
        "🔎 Envíe *nombre*, *teléfono* o *correo* (sin /buscar). También sirve: /nombre /teléfono /correo",
        { parse_mode: "Markdown" }
      );
    }

    // inventario paginado
    if (data === "inv:general") return mostrarStockGeneral(chatId);
    if (data.startsWith("inv:") && !data.startsWith("inv:editclave:") && !data.startsWith("inv:restar:") && !data.startsWith("inv:sumar:") && !data.startsWith("inv:delask:") && !data.startsWith("inv:delok:")) {
      const [, plat, pageStr] = data.split(":");
      return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
    }

    // abrir ficha cliente desde lista
    if (data.startsWith("cli:view:")) {
      const clientId = data.split(":")[2];
      return enviarFichaCliente(chatId, clientId);
    }

    // Reporte TXT desde botón
    if (data === "cli:txt:general") {
      const fake = { chat: { id: chatId }, from: { id: userId }, text: "/clientes_txt" };
      return bot.emit("message", fake);
    }

    // ✅ INVENTARIO: EDITAR CLAVE
    if (data.startsWith("inv:editclave:")) {
      const docId = data.split(":")[2];
      const doc = await db.collection("inventario").doc(docId).get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
      const d = doc.data() || {};

      pending.set(String(chatId), { mode: "inv_editclave", docId });
      return bot.sendMessage(
        chatId,
        `🔑 *Editar clave*\n📌 ${String(d.plataforma || "-").toUpperCase()}\n📧 ${String(d.correo || "-")}\n\nEscriba la *nueva clave*:`,
        { parse_mode: "Markdown" }
      );
    }

    // ✅ INVENTARIO: RESTAR PERFILES
    if (data.startsWith("inv:restar:")) {
      const docId = data.split(":")[2];
      const doc = await db.collection("inventario").doc(docId).get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
      const d = doc.data() || {};

      pending.set(String(chatId), { mode: "inv_restar", docId });
      return bot.sendMessage(
        chatId,
        `➖ *Restar perfiles*\n📌 ${String(d.plataforma || "-").toUpperCase()}\n📧 ${String(d.correo || "-")}\n\nEscriba cantidad a restar (ej: 1):`,
        { parse_mode: "Markdown" }
      );
    }

    // ✅ INVENTARIO: SUMAR PERFILES
    if (data.startsWith("inv:sumar:")) {
      const docId = data.split(":")[2];
      const doc = await db.collection("inventario").doc(docId).get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
      const d = doc.data() || {};

      pending.set(String(chatId), { mode: "inv_sumar", docId });
      return bot.sendMessage(
        chatId,
        `➕ *Sumar perfiles*\n📌 ${String(d.plataforma || "-").toUpperCase()}\n📧 ${String(d.correo || "-")}\n\nEscriba cantidad a sumar (ej: 1):`,
        { parse_mode: "Markdown" }
      );
    }

    // ✅ INVENTARIO: BORRAR CUENTA (confirmación)
    if (data.startsWith("inv:delask:")) {
      const docId = data.split(":")[2];
      const doc = await db.collection("inventario").doc(docId).get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
      const d = doc.data() || {};

      return bot.sendMessage(chatId, `🗑️ Confirmar borrar?\n📌 ${String(d.plataforma || "-").toUpperCase()}\n📧 ${String(d.correo || "-")}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Confirmar", callback_data: `inv:delok:${docId}` }],
            [{ text: "⬅️ Cancelar", callback_data: "go:inicio" }],
          ],
        },
      });
    }

    if (data.startsWith("inv:delok:")) {
      const docId = data.split(":")[2];
      const ref = db.collection("inventario").doc(docId);
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
      await ref.delete();
      return bot.sendMessage(chatId, "✅ Cuenta eliminada del inventario.");
    }

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// MENSAJES (PENDIENTES + BUSQUEDA DIRECTA)
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";
  if (!chatId) return;
  if (!(await isAdmin(userId))) return;

  // ✅ 1) Flujos pendientes (inventario por botones)
  if (pending.has(String(chatId))) {
    const p = pending.get(String(chatId));
    const t = String(text || "").trim();

    // editar clave
    if (p?.mode === "inv_editclave") {
      if (!t) return bot.sendMessage(chatId, "⚠️ Clave inválida. Escriba la nueva clave:");
      const ref = db.collection("inventario").doc(p.docId);
      const doc = await ref.get();
      if (!doc.exists) {
        pending.delete(String(chatId));
        return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
      }
      const d = doc.data() || {};
      await ref.set({ clave: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      pending.delete(String(chatId));
      return bot.sendMessage(chatId, `✅ Clave actualizada\n📌 ${String(d.plataforma || "-").toUpperCase()}\n📧 ${String(d.correo || "-")}\n🔑 ${t}`);
    }

    // restar perfiles
    if (p?.mode === "inv_restar") {
      const qty = Number(t);
      if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Ej: 1");
      const ref = db.collection("inventario").doc(p.docId);
      const doc = await ref.get();
      if (!doc.exists) {
        pending.delete(String(chatId));
        return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
      }
      const d = doc.data() || {};
      const total = await getTotalPorPlataforma(d.plataforma);
      const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);
      const nuevoEstado = nuevoDisp <= 0 ? "llena" : (d.estado || "activa");

      await ref.set(
        { disp: nuevoDisp, estado: nuevoEstado, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

      pending.delete(String(chatId));
      return bot.sendMessage(
        chatId,
        `✅ Actualizado\n📌 ${String(d.plataforma || "-").toUpperCase()}\n📧 ${String(d.correo || "-")}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: ${fmtEstado(nuevoEstado)}`
      );
    }

    // sumar perfiles
    if (p?.mode === "inv_sumar") {
      const qty = Number(t);
      if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Ej: 1");
      const ref = db.collection("inventario").doc(p.docId);
      const doc = await ref.get();
      if (!doc.exists) {
        pending.delete(String(chatId));
        return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
      }
      const d = doc.data() || {};
      const total = await getTotalPorPlataforma(d.plataforma);
      const nuevoDisp = Number(d.disp || 0) + qty;
      const nuevoEstado = "activa";

      await ref.set(
        { disp: nuevoDisp, estado: nuevoEstado, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

      pending.delete(String(chatId));
      return bot.sendMessage(
        chatId,
        `✅ Actualizado\n📌 ${String(d.plataforma || "-").toUpperCase()}\n📧 ${String(d.correo || "-")}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: ${fmtEstado(nuevoEstado)}`
      );
    }
  }

  // ✅ 2) Ignorar comandos manejados por onText
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  const knownCommands = new Set([
    "/start", "/menu", "/stock",
    "/buscar", "/clientes_txt",
    "/netflix", "/disneyp", "/disneys", "/hbomax", "/primevideo", "/paramount", "/crunchyroll",
  ]);
  if (cmd.startsWith("/") && knownCommands.has(cmd)) return;

  // ✅ 3) Busqueda universal (texto o /texto)
  const q = limpiarQuery(text);
  if (!q) return;
  return busquedaUniversal(chatId, q);
});

// ===============================
// SERVIDOR HTTP (Render)
// ===============================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Sublicuentas bot OK");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log("🌐 Web service activo en puerto " + PORT);
  });

setInterval(() => console.log("🟢 Bot activo..."), 60000);
