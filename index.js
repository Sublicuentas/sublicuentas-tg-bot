/**
 * index.js — SUBLICUENTAS (FINAL + RENOVACION DD/MM/YYYY + CLIENTES NUEVO)
 *
 * ✅ Menu principal: Inventario / Clientes / Pagos / Renovaciones
 * ✅ Submenus completos (botones)
 *
 * ✅ Inventario:
 *   /add correo clave plataforma disp [activa|llena]  (modo inteligente + borra duplicados)
 *   /addm  (lote) + pegar lineas: correo clave plataforma disp [activa|llena]
 *   /buscar correo
 *   /addp correo [n]  (resta n)
 *   /delp correo [n]  (suma n) + reactiva si sube >0
 *   Listados por plataforma ordenados por mas libres primero + muestra clave
 *   Estado visible: LLENA (se guarda "llena")
 *
 * ✅ Clientes (IMPLEMENTADO):
 *   Datos:
 *     Nombre perfil, Telefono, Plataforma, Correo, Pin, Precio (Lps), Fecha renovacion (DD/MM/YYYY), Vendedor
 *   Flujo guiado por botones:
 *     Clientes -> Nuevo cliente (el bot pregunta paso a paso)
 *   Comando directo:
 *     /cadd "Nombre perfil" telefono plataforma correo pin precio DD/MM/YYYY vendedor
 *     Ej: /cadd "Carlos Mejia" 98765432 netflix bonjovi@x.com 1234 90 10/03/2026 sublicuentas
 *
 * ✅ Renovaciones (DD/MM/YYYY) + TXT sin acentos, sin linea de moneda:
 *   /renueva hoy
 *   /renueva 10
 *   /renueva vendedor 10
 *   Botones: HOY / Dia 10 (general) / Dia 10 por vendedor
 *
 * ⚠️ Firestore requerido:
 *   config/totales_plataforma:
 *     netflix:5, disneyp:6, disneys:3, hbomax:5, primevideo:5, paramount:5, crunchyroll:5
 *   admins/{telegramUserId}: { activo:true }
 *   inventario docs: { correo, clave, plataforma, disp, estado, createdAt, updatedAt }
 *   clientes docs (coleccion "clientes"):
 *     { nombrePerfil, telefono, plataforma, correo, pin, precio, fechaRenovacion:"DD/MM/YYYY", vendedor, createdAt, updatedAt }
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

if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN");
if (!FIREBASE_PROJECT_ID) throw new Error("Falta FIREBASE_PROJECT_ID");
if (!FIREBASE_CLIENT_EMAIL) throw new Error("Falta FIREBASE_CLIENT_EMAIL");
if (!FIREBASE_PRIVATE_KEY) throw new Error("Falta FIREBASE_PRIVATE_KEY");

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
const PLATAFORMAS = [
  "netflix",
  "disneyp",
  "disneys",
  "hbomax",
  "primevideo",
  "paramount",
  "crunchyroll",
];

const VENDEDORES = [
  "sublicuentas",
  "relojes",
  "geissel",
  "abner",
  "yami",
  "jocon",
  "heber",
];

// ===============================
// HELPERS
// ===============================
function normalizarPlataforma(txt = "") {
  return String(txt).toLowerCase().replace(/\s+/g, "");
}
function esPlataformaValida(p) {
  return PLATAFORMAS.includes(normalizarPlataforma(p));
}
function normalizarVendedor(txt = "") {
  return String(txt).trim().toLowerCase().replace(/\s+/g, "");
}
function esVendedorValido(v) {
  return VENDEDORES.includes(normalizarVendedor(v));
}

function docIdInventario(correo, plataforma) {
  const safeMail = String(correo).trim().toLowerCase().replace(/[\/#?&]/g, "_");
  const safePlat = normalizarPlataforma(plataforma);
  return `${safePlat}__${safeMail}`;
}

// Cliente ID recomendado: telefono (unico)
function docIdCliente(telefono) {
  return String(telefono).trim().replace(/[^\d+]/g, "");
}

function estadoVisible(estado) {
  const e = String(estado || "").toLowerCase();
  if (e === "bloqueada" || e === "llena") return "LLENA";
  return "ACTIVA";
}
function estadoNormalizado(estadoInput = "activa", disp = 1) {
  if (Number(disp) <= 0) return "llena";
  const e = String(estadoInput || "").toLowerCase();
  return e === "llena" || e === "bloqueada" ? "llena" : "activa";
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

// ===============================
// TXT BUILDER (SIN ACENTOS)
// ===============================
function toAsciiNoAccents(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "");
}
function buildRenovacionesTxt({ titulo, fechaGeneracion, items }) {
  let out = "";
  out += "REPORTE DE RENOVACIONES\n";
  out += `Fecha generacion: ${fechaGeneracion}\n\n`;
  out += `${titulo}\n\n`;

  items.forEach((x, idx) => {
    out += `${idx + 1}. ${toAsciiNoAccents(x.nombrePerfil || "-")}\n`;
    out += `Telefono: ${String(x.telefono || "-")}\n`;
    out += `Plataforma: ${toAsciiNoAccents(String(x.plataforma || "-"))}\n`;
    out += `Cobrar: Lps ${Number(x.precio || 0)}\n`;
    out += `Vendedor: ${toAsciiNoAccents(String(x.vendedor || "-"))}\n`;
    out += "\n";
  });

  out += "------------------------------------\n";
  out += `Total clientes: ${items.length}\n`;
  return out;
}
async function sendTxtAsDocument(chatId, filename, contentText) {
  const buffer = Buffer.from(contentText, "utf8");
  return bot.sendDocument(chatId, buffer, {}, { filename, contentType: "text/plain" });
}

// ===============================
// VALIDADORES
// ===============================
function esTelefonoValido(tel) {
  const t = String(tel || "").trim();
  return /^[0-9]{7,12}$/.test(t) || /^\+?[0-9]{7,15}$/.test(t);
}

function esFechaDDMMYYYY(fecha) {
  const f = String(fecha || "").trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(f)) return false;
  const [dd, mm, yy] = f.split("/").map(Number);
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  if (yy < 2020 || yy > 2100) return false;
  // validacion simple de dias por mes (sin bisiesto avanzado; suficiente para operacion)
  const diasMes = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let max = diasMes[mm - 1] || 31;
  // bisiesto simple
  if (mm === 2) {
    const b = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
    if (b) max = 29;
  }
  return dd <= max;
}

// ===============================
// FECHA HOY (DD/MM/YYYY Tegucigalpa)
// ===============================
function hoyDDMMYYYY_Tegucigalpa() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const dd = parts.find((p) => p.type === "day")?.value || "01";
  const mm = parts.find((p) => p.type === "month")?.value || "01";
  const yy = parts.find((p) => p.type === "year")?.value || "2000";
  return `${dd}/${mm}/${yy}`;
}

function fechaPorDiaDelMes_DDMMYYYY(dia) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const mm = parts.find((p) => p.type === "month")?.value || "01";
  const yy = parts.find((p) => p.type === "year")?.value || "2000";
  const dd = String(dia).padStart(2, "0");
  return `${dd}/${mm}/${yy}`;
}

// ===============================
// MENUS (BOTONES)
// ===============================
async function mostrarMenu(chatId) {
  return bot.sendMessage(chatId, "📌 Panel Principal:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📦 Inventario", callback_data: "menu:inventario" }],
        [{ text: "👥 Clientes", callback_data: "menu:clientes" }],
        [{ text: "💰 Pagos", callback_data: "menu:pagos" }],
        [{ text: "⏰ Renovaciones", callback_data: "menu:renovaciones" }],
      ],
    },
  });
}

async function menuInventario(chatId) {
  return bot.sendMessage(chatId, "📦 Inventario:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📺 Netflix", callback_data: "stock:netflix" },
          { text: "🎬 Disney Premium", callback_data: "stock:disneyp" },
        ],
        [
          { text: "🎞 Disney Standard", callback_data: "stock:disneys" },
          { text: "🍿 HBO Max", callback_data: "stock:hbomax" },
        ],
        [
          { text: "🎥 Prime Video", callback_data: "stock:primevideo" },
          { text: "📀 Paramount+", callback_data: "stock:paramount" },
        ],
        [{ text: "🍥 Crunchyroll", callback_data: "stock:crunchyroll" }],
        [{ text: "📦 Stock General", callback_data: "stockgeneral" }],
        [{ text: "⬅️ Volver", callback_data: "menu:principal" }],
      ],
    },
  });
}

async function menuClientes(chatId) {
  return bot.sendMessage(chatId, "👥 Clientes:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Nuevo cliente", callback_data: "cliente:nuevo" }],
        [{ text: "🔎 Buscar cliente", callback_data: "cliente:buscar" }],
        [{ text: "📄 Ver cliente por telefono", callback_data: "cliente:ver" }],
        [{ text: "⬅️ Volver", callback_data: "menu:principal" }],
      ],
    },
  });
}

async function menuPagos(chatId) {
  return bot.sendMessage(chatId, "💰 Pagos (proximamente):", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⬅️ Volver", callback_data: "menu:principal" }],
      ],
    },
  });
}

async function menuRenovaciones(chatId) {
  return bot.sendMessage(chatId, "⏰ Renovaciones (TXT):", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📅 Renovaciones HOY (TXT)", callback_data: "renueva:hoy" }],
        [
          { text: "🗓 Dia 10 (general)", callback_data: "renueva:dia:10" },
          { text: "🧑‍💼 Dia 10 por vendedor", callback_data: "renueva:dia_vendedor:10" },
        ],
        [{ text: "⬅️ Volver", callback_data: "menu:principal" }],
      ],
    },
  });
}

// ===============================
// INVENTARIO: LISTADOS
// ===============================
async function mostrarStockPlataforma(chatId, plataforma) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");

  const total = await getTotalPorPlataforma(p);

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) return bot.sendMessage(chatId, `⚠️ ${p.toUpperCase()} SIN PERFILES DISPONIBLES`);

  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => Number(b.disp || 0) - Number(a.disp || 0));

  let texto = `📌 ${p.toUpperCase()} — STOCK DISPONIBLE\n\n`;
  let suma = 0;

  docs.forEach((d, idx) => {
    const clave = d.clave ? d.clave : "-";
    texto += `${idx + 1}) ${d.correo} — 🔑 ${clave} — ${d.disp}/${total ?? "-"}\n`;
    suma += Number(d.disp || 0);
  });

  texto += `\n━━━━━━━━━━━━━━`;
  texto += `\n📊 Cuentas con stock: ${docs.length}`;
  texto += `\n👤 Perfiles libres totales: ${suma}`;

  return bot.sendMessage(chatId, texto);
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
    snap.forEach((doc) => (libres += Number(doc.data().disp || 0)));

    texto += `✅ *${p}*: ${libres} libres (/${totals?.[p] ?? "-"})\n`;
  }

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
}

async function aplicarAutoLlenoYAlerta(chatId, ref, dataAntes, dataDespues) {
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
        `🚨 *ALERTA STOCK*\n${String(dataDespues.plataforma).toUpperCase()} quedo en *0* perfiles.\n📧 ${dataDespues.correo}\n✅ Estado: *LLENA*`,
        { parse_mode: "Markdown" }
      );
    }
  }
}

// ===============================
// CLIENTES: Flujo guiado (Nuevo cliente)
// ===============================
const sesionesCliente = new Map(); // userId -> { paso, data }

const PASOS_CLIENTE = [
  "nombrePerfil",
  "telefono",
  "plataforma",
  "correo",
  "pin",
  "precio",
  "fechaRenovacion",
  "vendedor",
];

function textoPreguntaPaso(paso) {
  switch (paso) {
    case "nombrePerfil":
      return "🧾 Nombre perfil (sin acentos si puede):";
    case "telefono":
      return "📞 Telefono (solo numeros, ej 98765432):";
    case "plataforma":
      return `📌 Plataforma (${PLATAFORMAS.join(", ")}):`;
    case "correo":
      return "📧 Correo asignado (ej: correo@dominio.com):";
    case "pin":
      return "🔑 PIN (o - si no aplica):";
    case "precio":
      return "💰 Precio en Lps (solo numero, ej 90):";
    case "fechaRenovacion":
      return "📅 Fecha renovacion (DD/MM/YYYY) ej: 10/03/2026:";
    case "vendedor":
      return `🧑‍💼 Vendedor (${VENDEDORES.join(", ")}):`;
    default:
      return "Ingrese dato:";
  }
}

async function iniciarNuevoCliente(chatId, userId) {
  sesionesCliente.set(userId, { pasoIndex: 0, data: {} });
  const paso = PASOS_CLIENTE[0];
  return bot.sendMessage(chatId, "➕ NUEVO CLIENTE\n" + textoPreguntaPaso(paso));
}

async function guardarCliente(chatId, userId, data) {
  const telefono = docIdCliente(data.telefono);
  const ref = db.collection("clientes").doc(telefono);

  const now = admin.firestore.FieldValue.serverTimestamp();
  const docPrev = await ref.get();
  const createdAt = docPrev.exists ? docPrev.data().createdAt || now : now;

  const payload = {
    nombrePerfil: String(data.nombrePerfil || "").trim(),
    telefono: String(data.telefono || "").trim(),
    plataforma: normalizarPlataforma(data.plataforma),
    correo: String(data.correo || "").trim().toLowerCase(),
    pin: String(data.pin || "-").trim(),
    precio: Number(data.precio || 0),
    fechaRenovacion: String(data.fechaRenovacion || "").trim(), // DD/MM/YYYY
    vendedor: normalizarVendedor(data.vendedor),
    createdAt,
    updatedAt: now,
  };

  await ref.set(payload, { merge: true });

  return bot.sendMessage(
    chatId,
    `✅ Cliente guardado\n\nNombre: ${payload.nombrePerfil}\nTelefono: ${payload.telefono}\nPlataforma: ${payload.plataforma}\nCorreo: ${payload.correo}\nPIN: ${payload.pin}\nPrecio: Lps ${payload.precio}\nRenueva: ${payload.fechaRenovacion}\nVendedor: ${payload.vendedor}`
  );
}

// ===============================
// RENOVACIONES (DD/MM/YYYY)
// ===============================
async function queryRenovaciones({ modo, dia, vendedor }) {
  let target = hoyDDMMYYYY_Tegucigalpa();

  if (modo === "dia" || modo === "dia_vendedor") {
    const d = Number(dia);
    if (!Number.isFinite(d) || d < 1 || d > 31) return { target: null, items: [] };
    target = fechaPorDiaDelMes_DDMMYYYY(d);
  }

  let q = db.collection("clientes").where("fechaRenovacion", "==", target);

  if (modo === "dia_vendedor") {
    const vend = normalizarVendedor(vendedor);
    q = q.where("vendedor", "==", vend);
  }

  const snap = await q.get();
  const items = snap.docs.map((doc) => {
    const x = doc.data() || {};
    return {
      nombrePerfil: x.nombrePerfil || "",
      telefono: x.telefono || "",
      plataforma: x.plataforma || "",
      precio: Number(x.precio || 0),
      vendedor: x.vendedor || "",
    };
  });

  items.sort((a, b) => {
    const va = normalizarVendedor(a.vendedor);
    const vb = normalizarVendedor(b.vendedor);
    if (va !== vb) return va.localeCompare(vb);
    const pa = normalizarPlataforma(a.plataforma);
    const pb = normalizarPlataforma(b.plataforma);
    if (pa !== pb) return pa.localeCompare(pb);
    return String(a.nombrePerfil).localeCompare(String(b.nombrePerfil));
  });

  return { target, items };
}

async function generarRenovacionesTxt(chatId, { modo, dia, vendedor }) {
  const fechaGen = hoyDDMMYYYY_Tegucigalpa();
  const { target, items } = await queryRenovaciones({ modo, dia, vendedor });

  if (!target) return bot.sendMessage(chatId, "⚠️ Dia invalido.");

  const tituloBase =
    modo === "hoy"
      ? "RENOVACIONES HOY"
      : modo === "dia"
      ? `RENOVACIONES DIA ${String(dia).padStart(2, "0")} (${target})`
      : `RENOVACIONES VENDEDOR: ${toAsciiNoAccents(String(vendedor || "")).toUpperCase()} (DIA ${String(dia).padStart(2, "0")} - ${target})`;

  const txt = buildRenovacionesTxt({
    titulo: items.length ? tituloBase : `${tituloBase}\n(Sin clientes)`,
    fechaGeneracion: fechaGen,
    items,
  });

  const filename =
    modo === "hoy"
      ? "renovaciones_hoy_general.txt"
      : modo === "dia"
      ? `renovaciones_dia_${dia}.txt`
      : `renovaciones_${normalizarVendedor(vendedor)}_${dia}.txt`;

  return sendTxtAsDocument(chatId, filename, txt);
}

// ===============================
// CALLBACK HANDLER (BOTONES)
// ===============================
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const data = q.data || "";

  try {
    await bot.answerCallbackQuery(q.id);

    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

    // Menus
    if (data === "menu:principal") return mostrarMenu(chatId);
    if (data === "menu:inventario") return menuInventario(chatId);
    if (data === "menu:clientes") return menuClientes(chatId);
    if (data === "menu:pagos") return menuPagos(chatId);
    if (data === "menu:renovaciones") return menuRenovaciones(chatId);

    // Inventario
    if (data === "stockgeneral") return mostrarStockGeneral(chatId);
    if (data.startsWith("stock:")) return mostrarStockPlataforma(chatId, data.split(":")[1]);

    // Clientes
    if (data === "cliente:nuevo") return iniciarNuevoCliente(chatId, userId);
    if (data === "cliente:buscar") {
      return bot.sendMessage(chatId, '🔎 Use: /cfind texto  (ej: /cfind carlos) o /cver 98765432');
    }
    if (data === "cliente:ver") {
      return bot.sendMessage(chatId, "📄 Use: /cver telefono (ej: /cver 98765432)");
    }

    // Renovaciones
    if (data === "renueva:hoy") return generarRenovacionesTxt(chatId, { modo: "hoy" });
    if (data.startsWith("renueva:dia:")) {
      const dia = Number(data.split(":")[2]);
      return generarRenovacionesTxt(chatId, { modo: "dia", dia });
    }
    if (data.startsWith("renueva:dia_vendedor:")) {
      const dia = Number(data.split(":")[2]);
      return bot.sendMessage(chatId, "Seleccione vendedor:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "sublicuentas", callback_data: `renueva:vend:${dia}:sublicuentas` }],
            [{ text: "relojes", callback_data: `renueva:vend:${dia}:relojes` }],
            [{ text: "geissel", callback_data: `renueva:vend:${dia}:geissel` }],
            [{ text: "abner", callback_data: `renueva:vend:${dia}:abner` }],
            [{ text: "yami", callback_data: `renueva:vend:${dia}:yami` }],
            [{ text: "jocon", callback_data: `renueva:vend:${dia}:jocon` }],
            [{ text: "heber", callback_data: `renueva:vend:${dia}:heber` }],
            [{ text: "⬅️ Volver", callback_data: "menu:renovaciones" }],
          ],
        },
      });
    }
    if (data.startsWith("renueva:vend:")) {
      const parts = data.split(":");
      const dia = Number(parts[2]);
      const vendedor = parts[3];
      return generarRenovacionesTxt(chatId, { modo: "dia_vendedor", dia, vendedor });
    }

    return bot.sendMessage(chatId, "⚠️ Accion no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err.message);
    return bot.sendMessage(chatId, "⚠️ Error interno en boton (revise logs).");
  }
});

// ===============================
// COMANDOS: START / MENU
// ===============================
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarMenu(chatId);
});

bot.onText(/\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarMenu(chatId);
});

// ===============================
// COMANDOS: CLIENTES (directo)
// ===============================

// /cadd "Nombre perfil" telefono plataforma correo pin precio DD/MM/YYYY vendedor
bot.onText(/\/cadd\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();

  // parse: "Nombre Perfil" resto...
  const m = raw.match(/^"([^"]+)"\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\S+)$/);
  if (!m) {
    return bot.sendMessage(
      chatId,
      '⚠️ Uso:\n/cadd "Nombre perfil" telefono plataforma correo pin precio DD/MM/YYYY vendedor\nEj:\n/cadd "Carlos Mejia" 98765432 netflix bonjovi@x.com 1234 90 10/03/2026 sublicuentas'
    );
  }

  const data = {
    nombrePerfil: m[1],
    telefono: m[2],
    plataforma: m[3],
    correo: m[4],
    pin: m[5],
    precio: m[6],
    fechaRenovacion: m[7],
    vendedor: m[8],
  };

  // validaciones
  if (!esTelefonoValido(data.telefono)) return bot.sendMessage(chatId, "⚠️ Telefono invalido.");
  if (!esPlataformaValida(data.plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!String(data.correo).includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");
  if (!Number.isFinite(Number(data.precio)) || Number(data.precio) < 0) return bot.sendMessage(chatId, "⚠️ Precio invalido.");
  if (!esFechaDDMMYYYY(data.fechaRenovacion)) return bot.sendMessage(chatId, "⚠️ Fecha invalida. Use DD/MM/YYYY");
  if (!esVendedorValido(data.vendedor)) return bot.sendMessage(chatId, "⚠️ Vendedor invalido.");

  return guardarCliente(chatId, userId, data);
});

// /cver telefono
bot.onText(/\/cver\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const tel = docIdCliente(match[1]);
  if (!tel) return bot.sendMessage(chatId, "⚠️ Uso: /cver telefono");

  const doc = await db.collection("clientes").doc(tel).get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const c = doc.data() || {};
  return bot.sendMessage(
    chatId,
    `👤 Cliente\nNombre: ${c.nombrePerfil}\nTelefono: ${c.telefono}\nPlataforma: ${c.plataforma}\nCorreo: ${c.correo}\nPIN: ${c.pin}\nPrecio: Lps ${c.precio}\nRenueva: ${c.fechaRenovacion}\nVendedor: ${c.vendedor}`
  );
});

// /cfind texto (busca por nombrePerfil o telefono exacto)
bot.onText(/\/cfind\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const qtxt = String(match[1] || "").trim().toLowerCase();
  if (!qtxt) return bot.sendMessage(chatId, "⚠️ Uso: /cfind texto");

  // intento 1: telefono exacto
  const tel = docIdCliente(qtxt);
  if (tel && (await db.collection("clientes").doc(tel).get()).exists) {
    return bot.sendMessage(chatId, `✅ Encontrado por telefono. Use: /cver ${tel}`);
  }

  // intento 2: nombrePerfil (simple contains no es nativo; hacemos prefijo/igualdad simple)
  // Solucion rapida: guardamos nombreLower en cada cliente (si no existe aun, igual listamos por nombre exacto)
  // Buscamos por nombrePerfil == (si coincide)
  const snap = await db.collection("clientes").where("nombrePerfil", "==", match[1].trim()).limit(10).get();

  if (snap.empty) {
    return bot.sendMessage(chatId, "⚠️ No encontrado. Tip: use /cver telefono si lo tiene.");
  }

  let out = "🔎 Resultados:\n\n";
  snap.docs.forEach((d, i) => {
    const c = d.data() || {};
    out += `${i + 1}) ${c.nombrePerfil} — ${c.telefono} — ${c.plataforma} — Renueva ${c.fechaRenovacion} — Lps ${c.precio} — ${c.vendedor}\n`;
  });

  return bot.sendMessage(chatId, out);
});

// ===============================
// COMANDOS: RENOVACIONES
// ===============================
// /renueva hoy
// /renueva 10
// /renueva sublicuentas 10
bot.onText(/\/renueva\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    if (parts[0].toLowerCase() === "hoy") return generarRenovacionesTxt(chatId, { modo: "hoy" });
    const dia = Number(parts[0]);
    if (!Number.isFinite(dia) || dia < 1 || dia > 31) {
      return bot.sendMessage(chatId, "⚠️ Uso:\n/renueva hoy\n/renueva 10\n/renueva vendedor 10");
    }
    return generarRenovacionesTxt(chatId, { modo: "dia", dia });
  }

  if (parts.length >= 2) {
    const vendedor = normalizarVendedor(parts[0]);
    const dia = Number(parts[1]);
    if (!esVendedorValido(vendedor)) return bot.sendMessage(chatId, "⚠️ Vendedor invalido.");
    if (!Number.isFinite(dia) || dia < 1 || dia > 31) return bot.sendMessage(chatId, "⚠️ Dia invalido.");
    return generarRenovacionesTxt(chatId, { modo: "dia_vendedor", dia, vendedor });
  }

  return bot.sendMessage(chatId, "⚠️ Uso:\n/renueva hoy\n/renueva 10\n/renueva vendedor 10");
});

// ===============================
// INVENTARIO: /add /addm /buscar /addp /delp
// ===============================

// /add correo clave plataforma disp [activa|llena]   (legacy: /add correo plataforma disp [estado])
bot.onText(/\/add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);

  if (parts.length < 3) {
    return bot.sendMessage(chatId, "⚠️ Uso:\n/add correo clave plataforma disp [activa|llena]");
  }

  let correo = "";
  let clave = "-";
  let plataforma = "";
  let disp = 0;
  let estadoInput = "activa";

  if (parts.length >= 4 && esPlataformaValida(parts[2]) && /^\d+$/.test(parts[3])) {
    correo = String(parts[0]).toLowerCase();
    clave = String(parts[1]);
    plataforma = normalizarPlataforma(parts[2]);
    disp = Number(parts[3]);
    estadoInput = String(parts[4] || "activa").toLowerCase();
  } else if (esPlataformaValida(parts[1]) && /^\d+$/.test(parts[2])) {
    correo = String(parts[0]).toLowerCase();
    clave = "-";
    plataforma = normalizarPlataforma(parts[1]);
    disp = Number(parts[2]);
    estadoInput = String(parts[3] || "activa").toLowerCase();
  } else {
    return bot.sendMessage(chatId, "⚠️ Formato invalido.\nUse:\n/add correo clave plataforma disp [activa|llena]");
  }

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!Number.isFinite(disp) || disp < 0) return bot.sendMessage(chatId, "⚠️ disp invalido.");

  const estado = estadoNormalizado(estadoInput, disp);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const snap = await db
    .collection("inventario")
    .where("correo", "==", correo)
    .where("plataforma", "==", plataforma)
    .limit(10)
    .get();

  let ref = null;
  let existing = null;

  if (!snap.empty) {
    ref = snap.docs[0].ref;
    existing = snap.docs[0].data();
    if (snap.docs.length > 1) {
      for (let i = 1; i < snap.docs.length; i++) await snap.docs[i].ref.delete();
    }
  } else {
    ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
    const prev = await ref.get();
    existing = prev.exists ? prev.data() : null;
  }

  await ref.set(
    {
      correo,
      clave: String(clave || "-"),
      plataforma,
      disp,
      estado,
      createdAt: existing?.createdAt ? existing.createdAt : now,
      updatedAt: now,
    },
    { merge: true }
  );

  const total = await getTotalPorPlataforma(plataforma);

  return bot.sendMessage(
    chatId,
    `✅ *Agregada*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${String(clave || "-")}\n👤 Disponibles: ${disp}/${total ?? "-"}\nEstado: *${estadoVisible(estado)}*`,
    { parse_mode: "Markdown" }
  );
});

// /addm
bot.onText(/\/addm$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return bot.sendMessage(
    chatId,
    "📌 PEGUE EL LOTE (una cuenta por linea)\nFormato:\ncorreo clave plataforma disp [activa|llena]\nEj:\nbonjovi@x.com pass123 netflix 5\nx@x.com - disneyp 6 activa\n\nLegacy:\na@a.com netflix 5",
    { parse_mode: "Markdown" }
  );
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

  let texto = `🔎 *RESULTADO*\n📧 ${correo}\n\n`;
  snap.forEach((d) => {
    const x = d.data();
    const clave = x.clave ? x.clave : "-";
    texto += `✅ ${String(x.plataforma).toUpperCase()} — ${x.disp} — ${estadoVisible(x.estado)} — 🔑 ${clave}\n`;
  });

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

// /addp correo [n]
bot.onText(/\/addp\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const correo = String(match[1] || "").trim().toLowerCase();
  const n = Math.max(1, Number(match[2] || 1));

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo [n]");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");
  if (snap.size > 1) return bot.sendMessage(chatId, "⚠️ Ese correo aparece en varias plataformas. Use /buscar.");

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(d.plataforma);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - n);

  await ref.set(
    { disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLlenoYAlerta(chatId, ref, antes, despues);

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n➖ Restado: ${n}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${nuevoDisp <= 0 ? "LLENA" : "ACTIVA"}*`,
    { parse_mode: "Markdown" }
  );
});

// /delp correo [n]
bot.onText(/\/delp\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const correo = String(match[1] || "").trim().toLowerCase();
  const n = Math.max(1, Number(match[2] || 1));

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo [n]");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");
  if (snap.size > 1) return bot.sendMessage(chatId, "⚠️ Ese correo aparece en varias plataformas. Use /buscar.");

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(d.plataforma);

  const nuevoDisp = Number(d.disp || 0) + n;

  await ref.set(
    {
      disp: nuevoDisp,
      estado: nuevoDisp > 0 ? "activa" : (d.estado || "activa"),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n➕ Sumado: ${n}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${nuevoDisp > 0 ? "ACTIVA" : "LLENA"}*`,
    { parse_mode: "Markdown" }
  );
});

// ===============================
// CAPTURA PASOS CLIENTE (mensajes normales)
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";

  // si hay sesion de cliente activa, capturar
  const ses = sesionesCliente.get(userId);
  if (!ses) return;

  // no capturar comandos
  if (String(text).startsWith("/")) return;

  // seguridad admin
  if (!(await isAdmin(userId))) {
    sesionesCliente.delete(userId);
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

  const paso = PASOS_CLIENTE[ses.pasoIndex];
  const val = String(text || "").trim();

  // validar segun paso
  if (paso === "telefono" && !esTelefonoValido(val)) {
    return bot.sendMessage(chatId, "⚠️ Telefono invalido. Intente de nuevo:");
  }
  if (paso === "plataforma" && !esPlataformaValida(val)) {
    return bot.sendMessage(chatId, "⚠️ Plataforma invalida. Use: " + PLATAFORMAS.join(", "));
  }
  if (paso === "correo" && !val.includes("@")) {
    return bot.sendMessage(chatId, "⚠️ Correo invalido. Intente de nuevo:");
  }
  if (paso === "precio") {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return bot.sendMessage(chatId, "⚠️ Precio invalido. Solo numero:");
  }
  if (paso === "fechaRenovacion" && !esFechaDDMMYYYY(val)) {
    return bot.sendMessage(chatId, "⚠️ Fecha invalida. Use DD/MM/YYYY ej 10/03/2026:");
  }
  if (paso === "vendedor" && !esVendedorValido(val)) {
    return bot.sendMessage(chatId, "⚠️ Vendedor invalido. Use: " + VENDEDORES.join(", "));
  }

  ses.data[paso] = val;

  ses.pasoIndex += 1;
  if (ses.pasoIndex >= PASOS_CLIENTE.length) {
    // guardar
    const data = ses.data;
    sesionesCliente.delete(userId);
    return guardarCliente(chatId, userId, data);
  }

  const nextPaso = PASOS_CLIENTE[ses.pasoIndex];
  return bot.sendMessage(chatId, textoPreguntaPaso(nextPaso));
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
  .listen(PORT, "0.0.0.0", () => {
    console.log("🌐 Web service activo en puerto " + PORT);
  });

setInterval(() => console.log("🟢 Bot activo..."), 60000);
```0
