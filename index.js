/**
 * SUBLICUENTAS BOT - INDEX.JS (FINAL + PAGINACION)
 * ✅ Menus + submenus
 * ✅ Inventario con clave visible
 * ✅ Estado: LLENA (cuando disp=0)
 * ✅ /addp correo [n] /delp correo [n]
 * ✅ Disney Premium = 6
 * ✅ Clientes multi-suscripciones
 * ✅ Renovaciones + TXT sin acentos
 * ✅ Paginacion con botones: Atras / Inicio / Siguiente (10 en 10)
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

if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN en .env");
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error("Faltan variables FIREBASE_* en .env");
}

// ===============================
// FIREBASE
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
// CONSTANTES / HELPERS
// ===============================
const TZ = "America/Tegucigalpa";
const PAGE_SIZE = 10;

const PLATAFORMAS = ["netflix", "disneyp", "disneys", "hbomax", "primevideo", "paramount", "crunchyroll"];

const PLATAFORMAS_LABEL = {
  netflix: "Netflix",
  disneyp: "Disney Premium",
  disneys: "Disney Standard",
  hbomax: "HBO Max",
  primevideo: "Prime Video",
  paramount: "Paramount+",
  crunchyroll: "Crunchyroll",
};

function normalizar(txt = "") {
  return String(txt).toLowerCase().trim();
}
function normalizarPlataforma(txt = "") {
  return String(txt).toLowerCase().replace(/\s+/g, "").trim();
}
function esPlataformaValida(p) {
  return PLATAFORMAS.includes(normalizarPlataforma(p));
}
function labelPlat(p) {
  const k = normalizarPlataforma(p);
  return PLATAFORMAS_LABEL[k] || k.toUpperCase();
}
function safeTextNoAcentos(s = "") {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}

function hoyDMY() {
  const d = new Date();
  const parts = d.toLocaleDateString("es-HN", { timeZone: TZ }).split("/");
  const dd = String(parts[0]).padStart(2, "0");
  const mm = String(parts[1]).padStart(2, "0");
  const yyyy = parts[2];
  return `${dd}/${mm}/${yyyy}`;
}
function validarDMY(dmy) {
  const m = String(dmy || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const dd = Number(m[1]),
    mm = Number(m[2]),
    yyyy = Number(m[3]);
  if (dd < 1 || dd > 31) return false;
  if (mm < 1 || mm > 12) return false;
  if (yyyy < 2020 || yyyy > 2100) return false;
  return true;
}

// Inventario DocID (por plataforma+correo)
function docIdInventario(correo, plataforma) {
  const safeMail = String(correo).trim().toLowerCase().replace(/[\/#?&]/g, "_");
  const safePlat = normalizarPlataforma(plataforma);
  return `${safePlat}__${safeMail}`;
}

async function isAdmin(userId) {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data().activo === true;
}

async function getTotalPorPlataforma(plataforma) {
  const cfg = await db.collection("config").doc("totales_plataforma").get();
  if (!cfg.exists) return null;
  const p = normalizarPlataforma(plataforma);
  return cfg.data()?.[p] ?? null;
}

async function asegurarTotalesDefault() {
  const ref = db.collection("config").doc("totales_plataforma");
  const snap = await ref.get();
  if (snap.exists) return;

  await ref.set(
    {
      netflix: 5,
      disneyp: 6, // ✅ Disney Premium 6
      disneys: 5,
      hbomax: 5,
      primevideo: 5,
      paramount: 5,
      crunchyroll: 5,
    },
    { merge: true }
  );
}

// ===============================
// PAGINACION UI
// ===============================
function navRow({ base, page, totalPages }) {
  // base = string callback prefix (sin page)
  // page 0-index
  const prev = page > 0 ? `${base}:${page - 1}` : "noop";
  const next = page < totalPages - 1 ? `${base}:${page + 1}` : "noop";
  const home = page !== 0 ? `${base}:0` : "noop";

  return [
    { text: "⬅️ Atrás", callback_data: prev },
    { text: "🏠 Inicio", callback_data: home },
    { text: "➡️ Siguiente", callback_data: next },
  ];
}

function paginar(items, page) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const start = p * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  return {
    page: p,
    total,
    totalPages,
    slice: items.slice(start, end),
    start,
    end: Math.min(end, total),
  };
}

// ===============================
// MENUS
// ===============================
async function mostrarMenuPrincipal(chatId) {
  return bot.sendMessage(chatId, "📌 MENU PRINCIPAL:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📦 Inventario", callback_data: "menu:inventario" },
          { text: "👥 Clientes", callback_data: "menu:clientes" },
        ],
        [
          { text: "💳 Pagos", callback_data: "menu:pagos" },
          { text: "📅 Renovaciones", callback_data: "menu:renovaciones" },
        ],
      ],
    },
  });
}

async function mostrarMenuInventario(chatId) {
  return bot.sendMessage(chatId, "📦 INVENTARIO:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Netflix", callback_data: "inv:stock:netflix:0" },
          { text: "Disney Premium", callback_data: "inv:stock:disneyp:0" },
        ],
        [
          { text: "Disney Standard", callback_data: "inv:stock:disneys:0" },
          { text: "HBO Max", callback_data: "inv:stock:hbomax:0" },
        ],
        [
          { text: "Prime Video", callback_data: "inv:stock:primevideo:0" },
          { text: "Paramount+", callback_data: "inv:stock:paramount:0" },
        ],
        [{ text: "Crunchyroll", callback_data: "inv:stock:crunchyroll:0" }],
        [{ text: "📦 Stock General", callback_data: "inv:stockgeneral" }],
        [{ text: "⬅️ Volver", callback_data: "menu:main" }],
      ],
    },
  });
}

async function mostrarMenuClientes(chatId) {
  return bot.sendMessage(chatId, "👥 CLIENTES:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "➕ Nuevo cliente", callback_data: "cli:help:nuevo" },
          { text: "🔎 Buscar", callback_data: "cli:help:buscar" },
        ],
        [
          { text: "📋 Listar recientes", callback_data: "cli:list:0" },
          { text: "🧾 Ver por ID", callback_data: "cli:help:ver" },
        ],
        [{ text: "⬅️ Volver", callback_data: "menu:main" }],
      ],
    },
  });
}

async function mostrarMenuPagos(chatId) {
  return bot.sendMessage(chatId, "💳 PAGOS:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "➕ Registrar pago", callback_data: "pay:help:registrar" },
          { text: "📊 Hoy", callback_data: "pay:hoy" },
        ],
        [{ text: "📋 Ultimos 10", callback_data: "pay:ultimos:10" }],
        [{ text: "⬅️ Volver", callback_data: "menu:main" }],
      ],
    },
  });
}

async function mostrarMenuRenovaciones(chatId) {
  return bot.sendMessage(chatId, "📅 RENOVACIONES:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📌 Hoy", callback_data: "ren:list:hoy:0" },
          { text: "📄 TXT Hoy", callback_data: "ren:txt:hoy" },
        ],
        [
          { text: "🧑‍💼 Por vendedor", callback_data: "ren:help:vendedor" },
          { text: "📆 Por fecha", callback_data: "ren:help:fecha" },
        ],
        [
          { text: "🧑‍💼 Vendedores (lista)", callback_data: "vend:list:0" },
          { text: "⬅️ Volver", callback_data: "menu:main" },
        ],
      ],
    },
  });
}

// ===============================
// INVENTARIO - LLENA
// ===============================
async function aplicarAutoLlenaYAlerta(chatId, ref, dataAntes, dataDespues) {
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
        `🚨 ALERTA STOCK\n${labelPlat(dataDespues.plataforma).toUpperCase()} quedo en 0 perfiles.\nCorreo: ${dataDespues.correo}\nEstado: LLENA`
      );
    }
  }
}

// ===============================
// INVENTARIO - LISTADO (PAGINADO)
// ===============================
async function mostrarStockPlataformaPaginado(chatId, plataforma, page) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");

  const total = await getTotalPorPlataforma(p);

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) return bot.sendMessage(chatId, `⚠️ ${labelPlat(p).toUpperCase()} SIN PERFILES DISPONIBLES`);

  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => Number(b.disp || 0) - Number(a.disp || 0));

  const { page: pnum, total: tot, totalPages, slice, start, end } = paginar(docs, page);

  let texto = `📌 ${labelPlat(p).toUpperCase()} — STOCK DISPONIBLE\n`;
  texto += `Mostrando ${start + 1}-${end} de ${tot}\n\n`;

  let suma = 0;
  slice.forEach((d, idx) => {
    const clave = d.clave ? ` — 🔑 ${d.clave}` : "";
    texto += `${start + idx + 1}) ${d.correo}${clave} — ${d.disp}/${total ?? "-"}\n`;
    suma += Number(d.disp || 0);
  });

  texto += `\n━━━━━━━━━━━━━━`;
  texto += `\n📄 Pagina: ${pnum + 1}/${totalPages}`;

  const base = `inv:stock:${p}`;
  return bot.sendMessage(chatId, texto, {
    reply_markup: {
      inline_keyboard: [
        navRow({ base, page: pnum, totalPages }),
        [{ text: "🔄 Actualizar", callback_data: `${base}:${pnum}` }],
        [{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }],
      ],
    },
  });
}

async function mostrarStockGeneral(chatId) {
  const cfg = await db.collection("config").doc("totales_plataforma").get();
  const totals = cfg.exists ? cfg.data() : {};

  let texto = "📦 STOCK GENERAL\n\n";
  for (const p of PLATAFORMAS) {
    const snap = await db
      .collection("inventario")
      .where("plataforma", "==", p)
      .where("disp", ">=", 1)
      .where("estado", "==", "activa")
      .get();

    let libres = 0;
    snap.forEach((doc) => (libres += Number(doc.data().disp || 0)));
    texto += `✅ ${labelPlat(p)}: ${libres} libres (/ ${totals?.[p] ?? "-"})\n`;
  }
  return bot.sendMessage(chatId, texto);
}

// ===============================
// CLIENTES / SUSCRIPCIONES
// ===============================
// /nuevo Nombre|Telefono|Vendedor
bot.onText(/\/nuevo\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "");
  const parts = raw.split("|").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 3) return bot.sendMessage(chatId, "⚠️ Uso: /nuevo Nombre|Telefono|Vendedor");

  const nombre = parts[0];
  const telefono = parts[1];
  const vendedor = parts[2];

  const ref = db.collection("clientes").doc();
  const id = `CLI_${ref.id.slice(-8)}`;

  await db.collection("clientes").doc(id).set({
    nombre,
    telefono,
    vendedor,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection("vendedores").doc(normalizar(vendedor)).set(
    { nombre: vendedor, activo: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ Cliente creado\nID: ${id}\nNombre: ${nombre}\nTelefono: ${telefono}\nVendedor: ${vendedor}\n\nAgrega suscripcion:\n/suscribir ${id}|Plataforma|Correo|Pin|Precio|Renovacion(dd/mm/yyyy)|Perfiles`
  );
});

// /suscribir ClienteID|Plataforma|Correo|Pin|Precio|Renovacion|Perfiles
bot.onText(/\/suscribir\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "");
  const parts = raw.split("|").map((x) => x.trim());
  if (parts.length < 7)
    return bot.sendMessage(chatId, "⚠️ Uso: /suscribir ClienteID|Plataforma|Correo|Pin|Precio|Renovacion(dd/mm/yyyy)|Perfiles");

  const clienteId = parts[0];
  const plataforma = normalizarPlataforma(parts[1]);
  const correo = parts[2].toLowerCase();
  const pin = parts[3];
  const precio = Number(parts[4]);
  const renovacionDMY = parts[5];
  const perfiles = Number(parts[6]);

  if (!clienteId.startsWith("CLI_")) return bot.sendMessage(chatId, "⚠️ ClienteID invalido.");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");
  if (!Number.isFinite(precio) || precio < 0) return bot.sendMessage(chatId, "⚠️ Precio invalido.");
  if (!validarDMY(renovacionDMY)) return bot.sendMessage(chatId, "⚠️ Renovacion invalida. Formato dd/mm/yyyy");
  if (!Number.isFinite(perfiles) || perfiles < 1) return bot.sendMessage(chatId, "⚠️ Perfiles invalido.");

  const cliSnap = await db.collection("clientes").doc(clienteId).get();
  if (!cliSnap.exists) return bot.sendMessage(chatId, "⚠️ Cliente no existe.");

  const cli = cliSnap.data();
  const subRef = db.collection("suscripciones").doc();
  const subId = `SUB_${subRef.id.slice(-10)}`;

  await db.collection("suscripciones").doc(subId).set({
    subId,
    clienteId,
    nombre: cli.nombre,
    telefono: cli.telefono,
    vendedor: cli.vendedor,
    plataforma,
    correo,
    pin,
    precio,
    renovacionDMY,
    perfiles,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return bot.sendMessage(
    chatId,
    `✅ Suscripcion agregada\nCliente: ${cli.nombre} (${clienteId})\nPlataforma: ${labelPlat(plataforma)}\nCorreo: ${correo}\nPin: ${pin}\nPerfiles: ${perfiles}\nPrecio: Lps ${precio}\nRenovacion: ${renovacionDMY}\nVendedor: ${cli.vendedor}\nID Suscripcion: ${subId}`
  );
});

// /cliente CLI_xxx
bot.onText(/\/cliente\s+(CLI_\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const clienteId = String(match[1] || "").trim();
  const cliSnap = await db.collection("clientes").doc(clienteId).get();
  if (!cliSnap.exists) return bot.sendMessage(chatId, "⚠️ Cliente no existe.");

  const cli = cliSnap.data();
  const subs = await db.collection("suscripciones").where("clienteId", "==", clienteId).get();

  let texto = `👤 CLIENTE\nID: ${clienteId}\nNombre: ${cli.nombre}\nTelefono: ${cli.telefono}\nVendedor: ${cli.vendedor}\n\n📌 SUSCRIPCIONES:\n`;

  if (subs.empty) {
    texto += "— Sin suscripciones.\n";
    return bot.sendMessage(chatId, texto);
  }

  subs.docs.forEach((d, idx) => {
    const s = d.data();
    texto += `${idx + 1}) ${labelPlat(s.plataforma)} | ${s.correo} | PIN ${s.pin} | Perfiles ${s.perfiles} | Lps ${s.precio} | Renueva ${s.renovacionDMY} | ${s.subId}\n`;
  });

  return bot.sendMessage(chatId, texto);
});

// /buscarc texto
bot.onText(/\/buscarc\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim().toLowerCase();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscarc texto");

  const byTel = await db.collection("clientes").where("telefono", "==", q).limit(10).get();
  const results = [];

  byTel.docs.forEach((d) => results.push({ id: d.id, ...d.data() }));

  if (results.length === 0) {
    const recent = await db.collection("clientes").orderBy("createdAt", "desc").limit(80).get();
    recent.docs.forEach((d) => {
      const x = d.data();
      const name = String(x.nombre || "").toLowerCase();
      if (name.includes(q)) results.push({ id: d.id, ...x });
    });
  }

  if (results.length === 0) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  let texto = `🔎 RESULTADOS (${results.length})\n\n`;
  results.slice(0, 15).forEach((c, i) => {
    texto += `${i + 1}) ${c.nombre} | ${c.telefono} | ${c.vendedor} | ID: ${c.id}\n`;
  });

  return bot.sendMessage(chatId, texto);
});

async function listarClientesPaginado(chatId, page) {
  const snap = await db.collection("clientes").orderBy("createdAt", "desc").limit(400).get(); // límite razonable
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay clientes.");

  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const { page: pnum, total, totalPages, slice, start, end } = paginar(all, page);

  let texto = `📋 CLIENTES (recientes)\nMostrando ${start + 1}-${end} de ${total}\n\n`;
  slice.forEach((c, idx) => {
    texto += `${start + idx + 1}) ${c.nombre} | ${c.telefono} | ${c.vendedor} | ${c.id}\n`;
  });
  texto += `\n📄 Pagina: ${pnum + 1}/${totalPages}`;

  const base = `cli:list`;
  return bot.sendMessage(chatId, texto, {
    reply_markup: {
      inline_keyboard: [
        navRow({ base, page: pnum, totalPages }),
        [{ text: "🔄 Actualizar", callback_data: `${base}:${pnum}` }],
        [{ text: "⬅️ Volver Clientes", callback_data: "menu:clientes" }],
      ],
    },
  });
}

// ===============================
// PAGOS
// ===============================
bot.onText(/\/pago\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "");
  const parts = raw.split("|").map((x) => x.trim());
  if (parts.length < 3) return bot.sendMessage(chatId, "⚠️ Uso: /pago ClienteID|Monto|Metodo|Nota(opcional)");

  const clienteId = parts[0];
  const monto = Number(parts[1]);
  const metodo = parts[2];
  const nota = parts[3] || "";
  const fecha = hoyDMY();

  const cliSnap = await db.collection("clientes").doc(clienteId).get();
  if (!cliSnap.exists) return bot.sendMessage(chatId, "⚠️ Cliente no existe.");

  const cli = cliSnap.data();
  const ref = db.collection("pagos").doc();
  const payId = `PAY_${ref.id.slice(-10)}`;

  await db.collection("pagos").doc(payId).set({
    payId,
    clienteId,
    nombre: cli.nombre,
    telefono: cli.telefono,
    vendedor: cli.vendedor,
    monto,
    metodo,
    nota,
    fechaDMY: fecha,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return bot.sendMessage(
    chatId,
    `✅ Pago registrado\nCliente: ${cli.nombre} (${clienteId})\nMonto: Lps ${monto}\nMetodo: ${metodo}\nFecha: ${fecha}\nVendedor: ${cli.vendedor}\nNota: ${nota || "-"}\nID Pago: ${payId}`
  );
});

async function pagosHoy(chatId) {
  const fecha = hoyDMY();
  const snap = await db.collection("pagos").where("fechaDMY", "==", fecha).get();
  if (snap.empty) return bot.sendMessage(chatId, `⚠️ No hay pagos hoy (${fecha}).`);

  let total = 0;
  let texto = `💳 PAGOS HOY (${fecha})\n\n`;

  snap.docs.forEach((d, i) => {
    const p = d.data();
    total += Number(p.monto || 0);
    texto += `${i + 1}) ${p.nombre} | Lps ${p.monto} | ${p.metodo} | ${p.vendedor}\n`;
  });

  texto += `\nTOTAL: Lps ${total}`;
  return bot.sendMessage(chatId, texto);
}

async function pagosUltimos(chatId, n = 10) {
  const snap = await db.collection("pagos").orderBy("createdAt", "desc").limit(n).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay pagos.");

  let texto = `💳 ULTIMOS PAGOS (${n})\n\n`;
  snap.docs.forEach((d, i) => {
    const p = d.data();
    texto += `${i + 1}) ${p.fechaDMY} | ${p.nombre} | Lps ${p.monto} | ${p.metodo} | ${p.vendedor}\n`;
  });

  return bot.sendMessage(chatId, texto);
}

// ===============================
// RENOVACIONES + TXT
// ===============================
async function renovacionesListPaginado(chatId, fechaDMY, vendedor, page) {
  if (!validarDMY(fechaDMY)) return bot.sendMessage(chatId, "⚠️ Fecha invalida. Formato: dd/mm/yyyy");

  let q = db.collection("suscripciones").where("renovacionDMY", "==", fechaDMY);
  if (vendedor) q = q.where("vendedor", "==", vendedor);

  const snap = await q.get();
  if (snap.empty) {
    const tag = vendedor ? ` (${vendedor})` : "";
    return bot.sendMessage(chatId, `⚠️ No hay renovaciones para ${fechaDMY}${tag}.`);
  }

  const items = snap.docs.map((d) => d.data());

  // Orden: vendedor, plataforma, nombre
  items.sort((a, b) => {
    const va = String(a.vendedor || "").localeCompare(String(b.vendedor || ""));
    if (va !== 0) return va;
    const pa = String(a.plataforma || "").localeCompare(String(b.plataforma || ""));
    if (pa !== 0) return pa;
    return String(a.nombre || "").localeCompare(String(b.nombre || ""));
  });

  const { page: pnum, total, totalPages, slice, start, end } = paginar(items, page);

  let texto = `📅 RENOVACIONES ${fechaDMY}\n`;
  if (vendedor) texto += `Vendedor: ${vendedor}\n`;
  texto += `Mostrando ${start + 1}-${end} de ${total}\n\n`;

  slice.forEach((it, idx) => {
    texto += `${start + idx + 1}) ${it.nombre} | ${labelPlat(it.plataforma)} | Lps ${it.precio} | ${it.telefono}\n`;
  });

  texto += `\n📄 Pagina: ${pnum + 1}/${totalPages}`;

  const base = vendedor ? `ren:list:${fechaDMY}:${vendedor}` : `ren:list:${fechaDMY}`;
  return bot.sendMessage(chatId, texto, {
    reply_markup: {
      inline_keyboard: [
        navRow({ base, page: pnum, totalPages }),
        [{ text: "📄 TXT de esta fecha", callback_data: vendedor ? `ren:txt:${fechaDMY}:${vendedor}` : `ren:txt:${fechaDMY}` }],
        [{ text: "⬅️ Volver Renovaciones", callback_data: "menu:renovaciones" }],
      ],
    },
  });
}

async function renovacionesTXT(chatId, fechaDMY, vendedor = null) {
  if (!validarDMY(fechaDMY)) return bot.sendMessage(chatId, "⚠️ Fecha invalida. Formato: dd/mm/yyyy");

  let q = db.collection("suscripciones").where("renovacionDMY", "==", fechaDMY);
  if (vendedor) q = q.where("vendedor", "==", vendedor);

  const snap = await q.get();
  if (snap.empty) {
    const tag = vendedor ? ` (${vendedor})` : "";
    return bot.sendMessage(chatId, `⚠️ No hay renovaciones para TXT ${fechaDMY}${tag}.`);
  }

  const items = snap.docs.map((d) => d.data());
  const groups = {};

  for (const it of items) {
    const v = it.vendedor || "sin_vendedor";
    if (!groups[v]) groups[v] = [];
    groups[v].push(it);
  }

  let txt = `RENOVACIONES ${fechaDMY}\n\n`;

  if (vendedor) {
    const list = items;
    txt += `${safeTextNoAcentos(vendedor).toUpperCase()} (${list.length})\n`;
    for (const it of list) {
      txt += `${safeTextNoAcentos(it.nombre)} - ${safeTextNoAcentos(labelPlat(it.plataforma))} - Lps ${it.precio} - ${safeTextNoAcentos(it.telefono)}\n`;
    }
  } else {
    for (const [v, list] of Object.entries(groups)) {
      txt += `${safeTextNoAcentos(v).toUpperCase()} (${list.length})\n`;
      for (const it of list) {
        txt += `${safeTextNoAcentos(it.nombre)} - ${safeTextNoAcentos(labelPlat(it.plataforma))} - Lps ${it.precio} - ${safeTextNoAcentos(it.telefono)}\n`;
      }
      txt += "\n";
    }
  }

  const fileName = vendedor
    ? `renovaciones_${safeTextNoAcentos(vendedor)}_${fechaDMY.replace(/\//g, "-")}.txt`
    : `renovaciones_${fechaDMY.replace(/\//g, "-")}.txt`;

  const buffer = Buffer.from(txt, "utf-8");
  return bot.sendDocument(chatId, buffer, {}, { filename: fileName, contentType: "text/plain" });
}

// ===============================
// VENDEDORES (PAGINADO)
// ===============================
async function vendedoresListPaginado(chatId, page) {
  const snap = await db.collection("vendedores").orderBy("nombre", "asc").limit(500).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay vendedores.");

  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const { page: pnum, total, totalPages, slice, start, end } = paginar(all, page);

  let texto = `🧑‍💼 VENDEDORES\nMostrando ${start + 1}-${end} de ${total}\n\n`;
  slice.forEach((v, idx) => {
    texto += `${start + idx + 1}) ${v.nombre} | ${v.activo ? "ACTIVO" : "INACTIVO"}\n`;
  });
  texto += `\n📄 Pagina: ${pnum + 1}/${totalPages}`;

  const base = `vend:list`;
  return bot.sendMessage(chatId, texto, {
    reply_markup: {
      inline_keyboard: [
        navRow({ base, page: pnum, totalPages }),
        [{ text: "➕ Agregar vendedor", callback_data: "vend:help:add" }],
        [{ text: "⬅️ Volver Renovaciones", callback_data: "menu:renovaciones" }],
      ],
    },
  });
}

// ===============================
// CALLBACKS (BOTONES)
// ===============================
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const data = q.data || "";

  try {
    await bot.answerCallbackQuery(q.id);

    if (data === "noop") return; // botón "deshabilitado"

    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

    // Menus
    if (data === "menu:main") return mostrarMenuPrincipal(chatId);
    if (data === "menu:inventario") return mostrarMenuInventario(chatId);
    if (data === "menu:clientes") return mostrarMenuClientes(chatId);
    if (data === "menu:pagos") return mostrarMenuPagos(chatId);
    if (data === "menu:renovaciones") return mostrarMenuRenovaciones(chatId);

    // Inventario
    if (data === "inv:stockgeneral") return mostrarStockGeneral(chatId);

    // inv:stock:PLAT:PAGE
    if (data.startsWith("inv:stock:")) {
      const parts = data.split(":"); // inv stock plat page
      const plat = parts[2];
      const page = Number(parts[3] || 0);
      return mostrarStockPlataformaPaginado(chatId, plat, page);
    }

    // Clientes list paginado -> cli:list:PAGE
    if (data.startsWith("cli:list:")) {
      const page = Number(data.split(":")[2] || 0);
      return listarClientesPaginado(chatId, page);
    }

    // Pagos
    if (data === "pay:hoy") return pagosHoy(chatId);
    if (data.startsWith("pay:ultimos:")) {
      const n = Number(data.split(":")[2] || 10);
      return pagosUltimos(chatId, n);
    }
    if (data === "pay:help:registrar") {
      return bot.sendMessage(chatId, "Uso:\n/pago ClienteID|Monto|Metodo|Nota(opcional)\nEj:\n/pago CLI_abc123|150|efectivo|renovacion netflix");
    }

    // Clientes help
    if (data === "cli:help:nuevo") {
      return bot.sendMessage(chatId, "Uso:\n/nuevo Nombre|Telefono|Vendedor\nEj:\n/nuevo Juan Perez|98765432|sublicuentas");
    }
    if (data === "cli:help:buscar") {
      return bot.sendMessage(chatId, "Uso:\n/buscarc texto\nEj:\n/buscarc 9876\n/buscarc Juan");
    }
    if (data === "cli:help:ver") {
      return bot.sendMessage(chatId, "Uso:\n/cliente CLI_xxxxxxxx");
    }

    // Renovaciones
    // ren:list:hoy:PAGE
    if (data.startsWith("ren:list:hoy:")) {
      const page = Number(data.split(":")[3] || 0);
      return renovacionesListPaginado(chatId, hoyDMY(), null, page);
    }

    // ren:list:FECHA:PAGE  (sin vendedor)  -> ren:list:10/03/2026:2
    if (data.startsWith("ren:list:") && !data.startsWith("ren:list:hoy:")) {
      const parts = data.split(":");
      // posibles:
      // ren list fecha page
      // ren list fecha vendedor page
      const fecha = parts[2];
      if (parts.length === 4) {
        const page = Number(parts[3] || 0);
        return renovacionesListPaginado(chatId, fecha, null, page);
      }
      if (parts.length >= 5) {
        const vendedor = parts[3];
        const page = Number(parts[4] || 0);
        return renovacionesListPaginado(chatId, fecha, vendedor, page);
      }
    }

    // TXT desde botones
    // ren:txt:hoy
    if (data === "ren:txt:hoy") return renovacionesTXT(chatId, hoyDMY(), null);

    // ren:txt:FECHA  o ren:txt:FECHA:VENDEDOR
    if (data.startsWith("ren:txt:") && data !== "ren:txt:hoy") {
      const parts = data.split(":");
      const fecha = parts[2];
      const vendedor = parts[3] || null;
      return renovacionesTXT(chatId, fecha, vendedor);
    }

    // Renovaciones help
    if (data === "ren:help:vendedor") {
      return bot.sendMessage(chatId, "Uso:\n/renovaciones vendedor NOMBRE dd/mm/yyyy\n/txt vendedor NOMBRE dd/mm/yyyy\nEj:\n/renovaciones vendedor sublicuentas 10/03/2026");
    }
    if (data === "ren:help:fecha") {
      return bot.sendMessage(chatId, "Uso:\n/renovaciones dd/mm/yyyy\n/txt dd/mm/yyyy\nEj:\n/renovaciones 10/03/2026");
    }

    // Vendedores
    if (data.startsWith("vend:list:")) {
      const page = Number(data.split(":")[2] || 0);
      return vendedoresListPaginado(chatId, page);
    }
    if (data === "vend:help:add") {
      return bot.sendMessage(chatId, "Uso:\n/vendedor add Nombre\nEj:\n/vendedor add Maria");
    }

    return bot.sendMessage(chatId, "⚠️ Accion no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// COMANDOS: START / MENU
// ===============================
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  await asegurarTotalesDefault();
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarMenuPrincipal(chatId);
});

bot.onText(/\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarMenuPrincipal(chatId);
});

// ===============================
// COMANDOS: INVENTARIO
// ===============================
bot.onText(/\/stock/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarStockGeneral(chatId);
});

// /buscar correo
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const correo = String(match[1] || "").trim().toLowerCase();

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /buscar correo");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  let texto = `🔎 RESULTADO\nCorreo: ${correo}\n\n`;
  snap.forEach((d) => {
    const x = d.data();
    const clave = x.clave ? ` | 🔑 ${x.clave}` : "";
    texto += `✅ ${labelPlat(x.plataforma)} — ${x.disp} — ${String(x.estado || "").toUpperCase()}${clave}\n`;
  });

  return bot.sendMessage(chatId, texto);
});

// /add correo clave plataforma disp [activa|llena]
bot.onText(/\/add\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)(?:\s+(\S+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1]).trim().toLowerCase();
  const clave = String(match[2]).trim();
  const plataforma = normalizarPlataforma(match[3]);
  const disp = Number(match[4]);
  const estadoInput = normalizar(match[5] || "activa");
  const estado = estadoInput === "llena" ? "llena" : "activa";

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!Number.isFinite(disp) || disp < 0) return bot.sendMessage(chatId, "⚠️ disp invalido.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const now = admin.firestore.FieldValue.serverTimestamp();

  const data = {
    correo,
    clave,
    plataforma,
    disp,
    estado: disp <= 0 ? "llena" : estado,
    updatedAt: now,
  };

  const prev = await ref.get();
  if (!prev.exists) data.createdAt = now;

  await ref.set(data, { merge: true });

  const total = await getTotalPorPlataforma(plataforma);

  return bot.sendMessage(
    chatId,
    `✅ Agregada\n📌 ${labelPlat(plataforma)}\n📧 ${correo}\n🔑 ${clave}\n👤 Disponibles: ${disp}/${total ?? "-"}\nEstado: ${String(data.estado).toUpperCase()}`
  );
});

// /addp correo [cantidad]
bot.onText(/\/addp\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const correo = String(match[1] || "").trim().toLowerCase();
  const qty = Math.max(1, Number(match[2] || 1));

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo 3");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");
  if (snap.size > 1) return bot.sendMessage(chatId, "⚠️ Ese correo aparece en varias plataformas. Use /buscar.");

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(d.plataforma);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);

  await ref.set({ disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLlenaYAlerta(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "LLENA" : String(d.estado || "activa").toUpperCase();

  return bot.sendMessage(
    chatId,
    `✅ Actualizado\n📌 ${labelPlat(d.plataforma)}\n📧 ${correo}\n🔑 ${d.clave || "-"}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: ${estadoFinal}`
  );
});

// /delp correo [cantidad]
bot.onText(/\/delp\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const correo = String(match[1] || "").trim().toLowerCase();
  const qty = Math.max(1, Number(match[2] || 1));

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo 3");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");
  if (snap.size > 1) return bot.sendMessage(chatId, "⚠️ Ese correo aparece en varias plataformas. Use /buscar.");

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(d.plataforma);

  const nuevoDisp = Number(d.disp || 0) + qty;

  await ref.set(
    { disp: nuevoDisp, estado: nuevoDisp > 0 ? "activa" : d.estado, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ Actualizado\n📌 ${labelPlat(d.plataforma)}\n📧 ${correo}\n🔑 ${d.clave || "-"}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: ${(nuevoDisp > 0 ? "ACTIVA" : String(d.estado || "").toUpperCase())}`
  );
});

// ===============================
// RENOVACIONES / TXT (COMANDOS)
// ===============================
bot.onText(/\/renovaciones\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();

  if (raw.toLowerCase() === "hoy") {
    return renovacionesListPaginado(chatId, hoyDMY(), null, 0);
  }

  const m = raw.match(/^vendedor\s+(\S+)\s+(\d{1,2}\/\d{1,2}\/\d{4})$/i);
  if (m) {
    const vendedor = m[1];
    const fecha = m[2];
    return renovacionesListPaginado(chatId, fecha, vendedor, 0);
  }

  if (validarDMY(raw)) {
    return renovacionesListPaginado(chatId, raw, null, 0);
  }

  return bot.sendMessage(chatId, "⚠️ Uso:\n/renovaciones hoy\n/renovaciones dd/mm/yyyy\n/renovaciones vendedor NOMBRE dd/mm/yyyy");
});

bot.onText(/\/txt\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();

  if (raw.toLowerCase() === "hoy") return renovacionesTXT(chatId, hoyDMY(), null);

  const m = raw.match(/^vendedor\s+(\S+)\s+(\d{1,2}\/\d{1,2}\/\d{4})$/i);
  if (m) return renovacionesTXT(chatId, m[2], m[1]);

  if (validarDMY(raw)) return renovacionesTXT(chatId, raw, null);

  return bot.sendMessage(chatId, "⚠️ Uso:\n/txt hoy\n/txt dd/mm/yyyy\n/txt vendedor NOMBRE dd/mm/yyyy");
});

// ===============================
// VENDEDORES (COMANDOS)
// ===============================
bot.onText(/\/vendedor\s+add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso: /vendedor add Nombre");

  await db.collection("vendedores").doc(normalizar(nombre)).set(
    { nombre, activo: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Vendedor agregado: ${nombre}`);
});

bot.onText(/\/vendedor\s+list/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return vendedoresListPaginado(chatId, 0);
});

// ===============================
// CLIENTES LIST (COMANDO)
// ===============================
bot.onText(/\/clientes\s*(\d+)?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  const page = Math.max(0, Number(match?.[1] || 0));
  return listarClientesPaginado(chatId, page);
});

// ===============================
// SERVIDOR HTTP (Render)
// ===============================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Sublicuentas bot OK");
  })
  .listen(PORT, "0.0.0.0", () => console.log("🌐 Web service activo en puerto " + PORT));

// Keep alive log
setInterval(() => console.log("🟢 Bot activo..."), 60000);
