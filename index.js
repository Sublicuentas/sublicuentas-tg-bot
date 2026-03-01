/*
 ✅ SUBLICUENTAS TG BOT — INDEX FINAL (CORREGIDO)

 ✅ CAMBIOS APLICADOS:
 1) INVENTARIO:
    - ❌ Eliminados botones “Cuenta 1..8” (y cualquier botón por correo)
    - ❌ Quitado botón “Actualizar”
    - ✅ Se mantiene el listado 10 por página con:
      correo + clave + disp/total
      y botones: Atrás / Inicio / Siguiente / Volver Inventario

 2) CLIENTES (FICHA):
    - ✅ Servicios ordenados por fechaRenovacion (ascendente)

 3) BÚSQUEDA RÁPIDA:
    - ✅ /nombre  (ej: /nicole)
    - ✅ /telefono (ej: /33242506)
    - ✅ Si el teléfono está repetido: muestra LISTA (no solo 1)
    - ✅ La lista muestra: plataformas + próxima renovación + total Lps (1 línea) + semáforo

 4) ADMINS:
    - ✅ /adminadd TELEGRAM_ID NombreOpcional
    - ✅ /admindel TELEGRAM_ID
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
function stripAcentos(str = "") {
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function esTelefono(txt) {
  const t = String(txt || "").trim();
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

function parseDMYtoDate(fechaDMY) {
  const m = String(fechaDMY || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
  const dt = new Date(yy, mm - 1, dd);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function diasPara(fechaDMY) {
  const dt = parseDMYtoDate(fechaDMY);
  if (!dt) return null;
  const hoy = startOfDay(new Date());
  const f = startOfDay(dt);
  const diffMs = f.getTime() - hoy.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
function semaforoRenovacion(servicios) {
  const arr = Array.isArray(servicios) ? servicios : [];
  let prox = null;
  for (const s of arr) {
    const f = String(s?.fechaRenovacion || "").trim();
    const dt = parseDMYtoDate(f);
    if (!dt) continue;
    if (!prox || dt < prox.dt) prox = { fecha: f, dt };
  }
  if (!prox) return { emoji: "⚪", tag: "SIN FECHA", dias: null, fecha: "--/--/----" };
  const d = diasPara(prox.fecha);
  if (d === null) return { emoji: "⚪", tag: "SIN FECHA", dias: null, fecha: prox.fecha };
  if (d <= 0) return { emoji: "🔴", tag: d < 0 ? `VENCIDO ${Math.abs(d)}d` : "HOY", dias: d, fecha: prox.fecha };
  if (d <= 3) return { emoji: "🟠", tag: `${d}d`, dias: d, fecha: prox.fecha };
  if (d <= 7) return { emoji: "🟡", tag: `${d}d`, dias: d, fecha: prox.fecha };
  return { emoji: "🟢", tag: `${d}d`, dias: d, fecha: prox.fecha };
}
function resumenServicios1Linea(servicios) {
  const arr = Array.isArray(servicios) ? servicios : [];
  const plats = [...new Set(arr.map(s => String(s?.plataforma || "").toLowerCase().trim()).filter(Boolean))];

  let total = 0;
  for (const s of arr) {
    const precio = Number(s?.precio || 0);
    if (!Number.isNaN(precio)) total += precio;
  }

  const sem = semaforoRenovacion(arr);
  const platsTxt = plats.length ? plats.join(",") : "sin-serv";
  return `${sem.emoji} ${sem.tag} | 🧾${arr.length} | 🎬 ${platsTxt} | ⏳ ${sem.fecha} | 💰 Lps ${total}`;
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
// MEMORIAS DE FLUJO
// ===============================
const wizard = new Map();  // chatId -> state
const pending = new Map(); // chatId -> { mode, ... }

// ===============================
// MENUS (INLINE)
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
    "👥 *CLIENTES*\n\n• Nuevo cliente (wizard)\n• Buscar (abre ficha)\n• Reporte TXT (lista general)\n\n💡 Tip rápido:\nEscriba: */NOMBRE* o */TELEFONO* y le abre lista directo (con servicios).",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Nuevo cliente", callback_data: "cli:wiz:start" }],
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
      reply_markup: {
        inline_keyboard: [
          [{ text: "📅 Renovaciones hoy", callback_data: "ren:hoy" }],
          [{ text: "📄 TXT hoy", callback_data: "txt:hoy" }],
          [{ text: "👤 Revendedores (lista)", callback_data: "rev:lista" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ],
      },
    }
  );
}

// ===============================
// INVENTARIO: LISTA + PAGINACION (SIN BOTONES "CUENTA")
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
// AUTOBLOQUEO
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
        `🚨 *ALERTA STOCK*\n${String(dataDespues.plataforma).toUpperCase()} quedó en *0* perfiles.\n📧 ${dataDespues.correo}\n✅ Estado: *LLENA*`,
        { parse_mode: "Markdown" }
      );
    }
  }
}

// ===============================
// INVENTARIO: SUBMENU SOLO POR /CORREO
// ===============================
async function buscarInventarioPorCorreo(correo) {
  const mail = String(correo || "").trim().toLowerCase();
  const snap = await db.collection("inventario").where("correo", "==", mail).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function enviarSubmenuInventario(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  const ref = db.collection("inventario").doc(docIdInventario(mail, plat));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

  const item = doc.data() || {};
  const total = await getTotalPorPlataforma(plat);

  const t =
    `📧 *${mail}*\n` +
    `📌 *${plat.toUpperCase()}*\n` +
    `🔑 *${item?.clave ? item.clave : "-"}*\n` +
    `👤 Disp: *${Number(item.disp || 0)}*/${total ?? "-"}\n` +
    `Estado: *${fmtEstado(item.estado)}*`;

  return bot.sendMessage(chatId, t, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Agregar perfil", callback_data: `inv:menu:sumar:${plat}:${mail}` }],
        [{ text: "➖ Quitar perfil", callback_data: `inv:menu:restar:${plat}:${mail}` }],
        [{ text: "✏️ Editar clave", callback_data: `inv:menu:clave:${plat}:${mail}` }],
        [{ text: "🗑️ Borrar correo", callback_data: `inv:menu:borrar:${plat}:${mail}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
}

// ===============================
// INVENTARIO (CRUD)
// ===============================
bot.onText(/\/add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/);

  if (parts.length < 3) return bot.sendMessage(chatId, "⚠️ Uso: /add correo CLAVE plataforma disp [activa|llena]");

  let correo = "";
  let clave = "";
  let plataforma = "";
  let dispStr = "";
  let estadoInput = "";

  // viejo: correo plataforma disp [estado]
  if (parts.length >= 3 && parts[0].includes("@") && esPlataformaValida(parts[1]) && /^\d+$/.test(parts[2])) {
    correo = parts[0];
    plataforma = parts[1];
    dispStr = parts[2];
    estadoInput = parts[3] || "activa";
    clave = "";
  } else {
    // nuevo: correo clave plataforma disp [estado]
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
  return bot.sendMessage(chatId, `✅ Clave actualizada\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${nueva}`);
});

// /addp = RESTAR DISP (consumir perfil)
bot.onText(/^\/addp\s+(\S+)\s+(\S+)\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const qty = Number(match[3] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo plataforma cantidad");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  const d = doc.data() || {};
  const total = await getTotalPorPlataforma(plataforma);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);

  await ref.set({ disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const despues = { ...d, disp: nuevoDisp, plataforma, correo };
  await aplicarAutoLleno(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : d.estado || "activa";

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/addp\s+(\S+)(?:\s+(\d+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const qty = Number(match[2] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo [cantidad]");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida.");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  if (snap.size > 1) {
    let t = "⚠️ Ese correo aparece en varias plataformas.\nUse:\n/addp correo plataforma cantidad\n\nOpciones:\n";
    snap.forEach((d) => (t += `• ${String(d.data().plataforma).toUpperCase()}\n`));
    return bot.sendMessage(chatId, t);
  }

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data() || {};
  const total = await getTotalPorPlataforma(d.plataforma);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);

  await ref.set({ disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const despues = { ...d, disp: nuevoDisp, plataforma: d.plataforma, correo };
  await aplicarAutoLleno(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : d.estado || "activa";

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

// /delp = SUMAR DISP (liberar perfil)
bot.onText(/^\/delp\s+(\S+)\s+(\S+)\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const qty = Number(match[3] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo plataforma cantidad");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  const d = doc.data() || {};
  const total = await getTotalPorPlataforma(plataforma);

  const nuevoDisp = Number(d.disp || 0) + qty;
  await ref.set(
    { disp: nuevoDisp, estado: "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *ACTIVA*`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/delp\s+(\S+)(?:\s+(\d+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const qty = Number(match[2] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo [cantidad]");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida.");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  if (snap.size > 1) {
    let t = "⚠️ Ese correo aparece en varias plataformas.\nUse:\n/delp correo plataforma cantidad\n\nOpciones:\n";
    snap.forEach((d) => (t += `• ${String(d.data().plataforma).toUpperCase()}\n`));
    return bot.sendMessage(chatId, t);
  }

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data() || {};
  const total = await getTotalPorPlataforma(d.plataforma);

  const nuevoDisp = Number(d.disp || 0) + qty;
  await ref.set(
    { disp: nuevoDisp, estado: "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *ACTIVA*`,
    { parse_mode: "Markdown" }
  );
});

// ===============================
// CLIENTES (WIZARD + FICHA)
// ===============================
function w(chatId) { return wizard.get(String(chatId)); }
function wset(chatId, state) { wizard.set(String(chatId), state); }
function wclear(chatId) { wizard.delete(String(chatId)); }

async function wizardStart(chatId) {
  wset(chatId, { step: 1, data: {}, clientId: null });
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
    return bot.sendMessage(chatId, "(2/3) Escriba *Teléfono*:", { parse_mode: "Markdown" });
  }

  if (st.step === 2) {
    d.telefono = t;
    st.clientId = String(t).trim(); // docId = telefono
    st.step = 3;
    return bot.sendMessage(chatId, "(3/3) Escriba *Vendedor*:", { parse_mode: "Markdown" });
  }

  if (st.step === 3) {
    d.vendedor = t;

    const clientRef = db.collection("clientes").doc(st.clientId);
    await clientRef.set(
      {
        nombrePerfil: d.nombrePerfil,
        telefono: d.telefono,
        vendedor: d.vendedor,
        servicios: [],
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
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📺 netflix", callback_data: `wiz:plat:netflix:${st.clientId}` },
            { text: "🏰 disneyp", callback_data: `wiz:plat:disneyp:${st.clientId}` },
          ],
          [
            { text: "🎞️ disneys", callback_data: `wiz:plat:disneys:${st.clientId}` },
            { text: "🍿 hbomax", callback_data: `wiz:plat:hbomax:${st.clientId}` },
          ],
          [
            { text: "🎥 primevideo", callback_data: `wiz:plat:primevideo:${st.clientId}` },
            { text: "📀 paramount", callback_data: `wiz:plat:paramount:${st.clientId}` },
          ],
          [{ text: "🍥 crunchyroll", callback_data: `wiz:plat:crunchyroll:${st.clientId}` }],
        ],
      },
    });
  }

  if (st.step === 4) {
    const s = st.servicio || {};

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
      s.fechaRenovacion = t;

      const clientRef = db.collection("clientes").doc(st.clientId);
      const doc = await clientRef.get();
      const cur = doc.exists ? doc.data() : {};
      const arr = Array.isArray(cur.servicios) ? cur.servicios : [];

      arr.push({
        plataforma: s.plataforma,
        correo: s.correo,
        pin: s.pin,
        precio: s.precio,
        fechaRenovacion: s.fechaRenovacion,
      });

      await clientRef.set({ servicios: arr, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      st.servicio = {};
      st.servStep = 1;
      st.step = 4;
      wset(chatId, st);

      const resumen =
        `✅ *Servicio agregado.*\n¿Desea agregar otra plataforma a este cliente?\n\n` +
        `Cliente:\n${cur?.nombrePerfil || st.data.nombrePerfil}\n${cur?.telefono || st.clientId}\n${cur?.vendedor || st.data.vendedor}\n\n` +
        `SERVICIOS:\n` +
        arr
          .map((x, i) => `${i + 1}) ${x.plataforma} — ${x.correo} — ${x.precio} Lps — Renueva: ${x.fechaRenovacion}`)
          .join("\n");

      return bot.sendMessage(chatId, resumen, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Agregar otra", callback_data: `wiz:addmore:${st.clientId}` }],
            [{ text: "✅ Finalizar", callback_data: `wiz:finish:${st.clientId}` }],
          ],
        },
      });
    }
  }
}

function ordenarServiciosPorFecha(servicios) {
  const arr = Array.isArray(servicios) ? [...servicios] : [];
  arr.sort((a, b) => {
    const da = parseDMYtoDate(a?.fechaRenovacion);
    const dbb = parseDMYtoDate(b?.fechaRenovacion);
    if (da && dbb) return da.getTime() - dbb.getTime();
    if (da && !dbb) return -1;
    if (!da && dbb) return 1;
    return 0;
  });
  return arr;
}

async function enviarFichaCliente(chatId, clientId) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = ordenarServiciosPorFecha(c.servicios);

  let txt = `✅ *Cliente*\n`;
  txt += `Datos del cliente:\n`;
  txt += `${c.nombrePerfil || "-"}\n`;
  txt += `${c.telefono || "-"}\n`;
  txt += `${c.vendedor || "-"}\n\n`;

  txt += `SERVICIOS (ordenados por fecha):\n`;
  if (servicios.length === 0) {
    txt += "— Sin servicios —\n";
  } else {
    servicios.forEach((s, i) => {
      txt += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`;
    });
  }

  return bot.sendMessage(chatId, txt, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Agregar plataforma", callback_data: `cli:addsvc:${clientId}` }],
        [
          { text: "🔄 Renovar", callback_data: `cli:ren:pick:${clientId}` },
          { text: "❌ Eliminar perfil", callback_data: `cli:del:pick:${clientId}` },
        ],
        [{ text: "✏️ Editar cliente", callback_data: `cli:edit:menu:${clientId}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
}

// ===============================
// BUSQUEDA CLIENTE (robusta + telefono repetido)
// ===============================
async function buscarClienteRobusto(queryLower) {
  const q = String(queryLower || "").trim().toLowerCase();

  // 1) teléfono exacto -> TRAE HASTA 50 (repetidos)
  if (esTelefono(q)) {
    const snapTel = await db.collection("clientes").where("telefono", "==", q).limit(50).get();
    if (!snapTel.empty) return snapTel.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // 2) scan nombre/telefono/vendedor/correos
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

  encontrados.sort((a, b) => {
    const an = String(a.nombrePerfil || "").toLowerCase();
    const bn = String(b.nombrePerfil || "").toLowerCase();
    const aExact = an === q ? 1 : 0;
    const bExact = bn === q ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return an.localeCompare(bn);
  });

  return encontrados.slice(0, 30);
}

async function enviarListaResultadosClientes(chatId, resultados) {
  const kb = resultados.map((c) => [
    {
      text: `👤 ${String(c.nombrePerfil || "-").trim()} | 📱 ${String(c.telefono || "-").trim()} | ${resumenServicios1Linea(c.servicios)}`,
      callback_data: `cli:view:${c.id}`,
    },
  ]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, "🔎 Resultados (toque para abrir ficha):", {
    reply_markup: { inline_keyboard: kb },
  });
}

// /buscar
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  const resultados = await buscarClienteRobusto(q);
  if (resultados.length === 0) return bot.sendMessage(chatId, "⚠️ Sin resultados.");

  // si hay 1, abre ficha; si hay varios, lista (con 1 línea)
  if (resultados.length === 1) return enviarFichaCliente(chatId, resultados[0].id);
  return enviarListaResultadosClientes(chatId, resultados);
});

// /cliente TELEFONO
bot.onText(/\/cliente\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  const tel = String(match[1] || "").trim();
  return enviarFichaCliente(chatId, tel);
});

// ===============================
// EDITAR CLIENTE MENU
// ===============================
async function menuEditarCliente(chatId, clientId) {
  return bot.sendMessage(chatId, "✏️ *EDITAR CLIENTE*\n\nSeleccione qué desea cambiar:", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🧑 Cambiar nombre", callback_data: `cli:edit:name:${clientId}` }],
        [{ text: "📱 Cambiar teléfono", callback_data: `cli:edit:phone:${clientId}` }],
        [{ text: "👨‍💼 Cambiar vendedor", callback_data: `cli:edit:seller:${clientId}` }],
        [{ text: "📅 Cambiar fecha renovación", callback_data: `cli:edit:fecha:pick:${clientId}` }],
        [{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }],
      ],
    },
  });
}

async function menuPickServicioFecha(chatId, clientId) {
  const doc = await db.collection("clientes").doc(String(clientId)).get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = ordenarServiciosPorFecha(c.servicios);
  if (servicios.length === 0) return bot.sendMessage(chatId, "⚠️ Cliente sin servicios.");

  const kb = servicios.map((s, idx) => [
    { text: `📅 ${s.plataforma} (actual: ${s.fechaRenovacion || "-"})`, callback_data: `cli:edit:fecha:set:${clientId}:${idx}` },
  ]);
  kb.push([{ text: "⬅️ Volver", callback_data: `cli:edit:menu:${clientId}` }]);

  return bot.sendMessage(chatId, "📅 Seleccione el servicio para cambiar fecha:", { reply_markup: { inline_keyboard: kb } });
}

// ===============================
// RENOVAR
// ===============================
async function menuPickServicio(chatId, clientId, mode) {
  const doc = await db.collection("clientes").doc(String(clientId)).get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = ordenarServiciosPorFecha(c.servicios);
  if (servicios.length === 0) return bot.sendMessage(chatId, "⚠️ Cliente sin servicios.");

  const kb = servicios.map((s, idx) => [
    {
      text: `${mode === "ren" ? "🔄 Renovar" : "❌ Eliminar"} ${s.plataforma}`,
      callback_data: `cli:${mode}:svc:${clientId}:${idx}`,
    },
  ]);
  kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);

  return bot.sendMessage(
    chatId,
    mode === "ren" ? "🔄 RENOVAR SERVICIO\nSeleccione plataforma:" : "❌ ELIMINAR PERFIL\nSeleccione plataforma:",
    { reply_markup: { inline_keyboard: kb } }
  );
}

// ===============================
// TXT RENOVACIONES
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
        const okVend = !vendedorOpt || vendedor.toLowerCase() === vendedorOpt.toLowerCase();
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
    const va = String(a.vendedor).toLowerCase();
    const vb = String(b.vendedor).toLowerCase();
    if (va !== vb) return va.localeCompare(vb);
    return String(a.nombrePerfil).toLowerCase().localeCompare(String(b.nombrePerfil).toLowerCase());
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
  const titulo = vendedorOpt ? `renovaciones_${vendedorOpt}_${fechaDMY}` : `renovaciones_general_${fechaDMY}`;
  const fileSafe = titulo.replace(/[^\w\-]+/g, "_");
  const filePath = path.join(__dirname, `${fileSafe}.txt`);

  let body = "";
  body += vendedorOpt ? `RENOVACIONES ${fechaDMY} - ${stripAcentos(vendedorOpt)}\n\n` : `RENOVACIONES ${fechaDMY} - GENERAL\n\n`;

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

  fs.writeFileSync(filePath, body, "utf8");
  await bot.sendDocument(chatId, filePath);
  try { fs.unlinkSync(filePath); } catch (e) {}
}

bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

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
      return bot.sendMessage(chatId, "⚠️ Uso:\n/renovaciones hoy\n/renovaciones dd/mm/yyyy\n/renovaciones NOMBRE dd/mm/yyyy");
    }
  }

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  const texto = renovacionesTexto(list, fecha, vendedor || null);
  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

bot.onText(/\/txt(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

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
      return bot.sendMessage(chatId, "⚠️ Uso:\n/txt hoy\n/txt dd/mm/yyyy\n/txt NOMBRE dd/mm/yyyy");
    }
  }

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  return enviarTXT(chatId, list, fecha, vendedor || null);
});

// /clientes_txt
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
// REVENDEDORES
// ===============================
async function listarRevendedores(chatId) {
  const snap = await db.collection("revendedores").where("activo", "==", true).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay revendedores.");

  let t = "👤 *REVENDEDORES*\n\n";
  snap.forEach((d) => {
    const x = d.data();
    t += `• ${x.nombre}\n`;
  });

  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
}

bot.onText(/\/revadd\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso: /revadd NOMBRE");
  await db.collection("revendedores").doc(nombre.toLowerCase()).set({ nombre, activo: true }, { merge: true });
  return bot.sendMessage(chatId, `✅ Revendedor agregado: ${nombre}`);
});

bot.onText(/\/revdel\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso: /revdel NOMBRE");
  await db.collection("revendedores").doc(nombre.toLowerCase()).set({ activo: false }, { merge: true });
  return bot.sendMessage(chatId, `🗑️ Revendedor desactivado: ${nombre}`);
});

// ===============================
// ADMINS
// ===============================
bot.onText(/\/adminadd\s+(\d+)(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const newId = String(match[1] || "").trim();
  const nombre = String(match[2] || "").trim();

  await db.collection("admins").doc(newId).set(
    { activo: true, nombre: nombre || null, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Admin agregado/activado: ${newId}${nombre ? " — " + nombre : ""}`);
});

bot.onText(/\/admindel\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const id = String(match[1] || "").trim();
  await db.collection("admins").doc(id).set(
    { activo: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return bot.sendMessage(chatId, `🗑️ Admin desactivado: ${id}`);
});

// ===============================
// START + MENU
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

// Comandos rápidos por plataforma
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

    // navegación principal
    if (data === "go:inicio") return menuPrincipal(chatId);
    if (data === "menu:inventario") return menuInventario(chatId);
    if (data === "menu:clientes") return menuClientes(chatId);
    if (data === "menu:pagos") return menuPagos(chatId);
    if (data === "menu:renovaciones") return menuRenovaciones(chatId);
    if (data === "menu:buscar") return bot.sendMessage(chatId, "🔎 Use: /buscar NOMBRE o /TELEFONO. (O escriba /NOMBRE o /TELEFONO)");

    // inventario
    if (data === "inv:general") return mostrarStockGeneral(chatId);
    if (data.startsWith("inv:")) {
      const [, plat, pageStr] = data.split(":");
      if (!plat) return;
      return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
    }

    // inventario submenu acciones
    if (data.startsWith("inv:menu:sumar:")) {
      const [, , , plat, correo] = data.split(":");
      pending.set(String(chatId), { mode: "invSumarQty", plat, correo });
      return bot.sendMessage(chatId, "➕ Agregar perfil\nEscriba cantidad a SUMAR (ej: 1):");
    }
    if (data.startsWith("inv:menu:restar:")) {
      const [, , , plat, correo] = data.split(":");
      pending.set(String(chatId), { mode: "invRestarQty", plat, correo });
      return bot.sendMessage(chatId, "➖ Quitar perfil\nEscriba cantidad a RESTAR (ej: 1):");
    }
    if (data.startsWith("inv:menu:clave:")) {
      const [, , , plat, correo] = data.split(":");
      pending.set(String(chatId), { mode: "invEditClave", plat, correo });
      return bot.sendMessage(chatId, "✏️ Editar clave\nEscriba la nueva clave:");
    }
    if (data.startsWith("inv:menu:borrar:")) {
      const [, , , plat, correo] = data.split(":");
      return bot.sendMessage(chatId, `🗑️ Confirmar *borrar correo*?\n📌 ${String(plat).toUpperCase()}\n📧 ${correo}`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Confirmar", callback_data: `inv:menu:borrarok:${normalizarPlataforma(plat)}:${String(correo).toLowerCase()}` }],
            [{ text: "⬅️ Cancelar", callback_data: "go:inicio" }],
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
      return bot.sendMessage(chatId, `🗑️ Borrado:\n📌 ${String(plat).toUpperCase()}\n📧 ${correo}`);
    }

    // renovaciones
    if (data === "ren:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, null);
      const texto = renovacionesTexto(list, fecha, null);
      return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
    }
    if (data === "txt:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, null);
      return enviarTXT(chatId, list, fecha, null);
    }
    if (data === "rev:lista") return listarRevendedores(chatId);

    // clientes: abrir ficha
    if (data.startsWith("cli:view:")) {
      const clientId = data.split(":")[2];
      return enviarFichaCliente(chatId, clientId);
    }

    // wizard iniciar
    if (data === "cli:wiz:start") return wizardStart(chatId);

    // wizard: elegir plataforma
    if (data.startsWith("wiz:plat:")) {
      const [, , plat] = data.split(":");
      const st = w(chatId);
      if (!st) return bot.sendMessage(chatId, "⚠️ Wizard no activo. Toque ➕ Nuevo cliente.");

      if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
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
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📺 netflix", callback_data: `wiz:plat:netflix:${clientId}` },
              { text: "🏰 disneyp", callback_data: `wiz:plat:disneyp:${clientId}` },
            ],
            [
              { text: "🎞️ disneys", callback_data: `wiz:plat:disneys:${clientId}` },
              { text: "🍿 hbomax", callback_data: `wiz:plat:hbomax:${clientId}` },
            ],
            [
              { text: "🎥 primevideo", callback_data: `wiz:plat:primevideo:${clientId}` },
              { text: "📀 paramount", callback_data: `wiz:plat:paramount:${clientId}` },
            ],
            [{ text: "🍥 crunchyroll", callback_data: `wiz:plat:crunchyroll:${clientId}` }],
          ],
        },
      });
    }

    if (data.startsWith("wiz:finish:")) {
      const clientId = data.split(":")[2];
      wclear(chatId);
      return enviarFichaCliente(chatId, clientId);
    }

    // ficha: agregar plataforma desde ficha
    if (data.startsWith("cli:addsvc:")) {
      const clientId = data.split(":")[2];
      wset(chatId, { step: 4, servStep: 1, servicio: {}, clientId, data: {} });
      return bot.sendMessage(chatId, "➕ Agregar plataforma\nSeleccione plataforma:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📺 netflix", callback_data: `wiz:plat:netflix:${clientId}` },
              { text: "🏰 disneyp", callback_data: `wiz:plat:disneyp:${clientId}` },
            ],
            [
              { text: "🎞️ disneys", callback_data: `wiz:plat:disneys:${clientId}` },
              { text: "🍿 hbomax", callback_data: `wiz:plat:hbomax:${clientId}` },
            ],
            [
              { text: "🎥 primevideo", callback_data: `wiz:plat:primevideo:${clientId}` },
              { text: "📀 paramount", callback_data: `wiz:plat:paramount:${clientId}` },
            ],
            [{ text: "🍥 crunchyroll", callback_data: `wiz:plat:crunchyroll:${clientId}` }],
            [{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }],
          ],
        },
      });
    }

    // ficha: renovar / eliminar
    if (data.startsWith("cli:ren:pick:")) {
      const clientId = data.split(":")[3] || data.split(":")[2];
      return menuPickServicio(chatId, clientId, "ren");
    }
    if (data.startsWith("cli:ren:svc:")) {
      const [, , , clientId, idxStr] = data.split(":");
      const idx = Number(idxStr);
      pending.set(String(chatId), { mode: "renFecha", clientId, servicioIndex: idx });
      return bot.sendMessage(chatId, "🔄 Renovar\nEscriba nueva fecha (dd/mm/yyyy):");
    }

    if (data.startsWith("cli:del:pick:")) {
      const clientId = data.split(":")[3] || data.split(":")[2];
      return menuPickServicio(chatId, clientId, "del");
    }
    if (data.startsWith("cli:del:svc:")) {
      const [, , , clientId, idxStr] = data.split(":");
      const idx = Number(idxStr);
      pending.set(String(chatId), { mode: "delConfirm", clientId, servicioIndex: idx });
      return bot.sendMessage(chatId, "❌ Confirmar eliminación del servicio?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Confirmar", callback_data: `cli:del:confirm:${clientId}:${idx}` }],
            [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
          ],
        },
      });
    }
    if (data.startsWith("cli:del:confirm:")) {
      const [, , , clientId, idxStr] = data.split(":");
      const idx = Number(idxStr);

      const ref = db.collection("clientes").doc(String(clientId));
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

      servicios.splice(idx, 1);
      await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      pending.delete(String(chatId));

      await bot.sendMessage(chatId, "✅ Servicio eliminado.");
      return enviarFichaCliente(chatId, clientId);
    }

    // editar cliente
    if (data.startsWith("cli:edit:menu:")) {
      const clientId = data.split(":")[3] || data.split(":")[2];
      return menuEditarCliente(chatId, clientId);
    }
    if (data.startsWith("cli:edit:name:")) {
      const clientId = data.split(":")[3] || data.split(":")[2];
      pending.set(String(chatId), { mode: "editNombre", clientId });
      return bot.sendMessage(chatId, "🧑 Escriba el nuevo nombre:");
    }
    if (data.startsWith("cli:edit:phone:")) {
      const clientId = data.split(":")[3] || data.split(":")[2];
      pending.set(String(chatId), { mode: "editTelefono", clientId });
      return bot.sendMessage(chatId, "📱 Escriba el nuevo teléfono:");
    }
    if (data.startsWith("cli:edit:seller:")) {
      const clientId = data.split(":")[3] || data.split(":")[2];
      pending.set(String(chatId), { mode: "editVendedor", clientId });
      return bot.sendMessage(chatId, "👨‍💼 Escriba el nuevo vendedor:");
    }
    if (data.startsWith("cli:edit:fecha:pick:")) {
      const clientId = data.split(":").pop();
      return menuPickServicioFecha(chatId, clientId);
    }
    if (data.startsWith("cli:edit:fecha:set:")) {
      const parts = data.split(":");
      const clientId = parts[4];
      const idx = Number(parts[5]);
      pending.set(String(chatId), { mode: "editFechaServicio", clientId, servicioIndex: idx });
      return bot.sendMessage(chatId, "📅 Escriba la nueva fecha (dd/mm/yyyy):");
    }

    // confirmar renovar final
    if (data.startsWith("cli:ren:confirm:")) {
      const [, , , clientId, idxStr, fecha] = data.split(":");
      const idx = Number(idxStr);

      const ref = db.collection("clientes").doc(String(clientId));
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

      servicios[idx].fechaRenovacion = fecha;
      await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      pending.delete(String(chatId));

      await bot.sendMessage(chatId, "✅ Renovación aplicada.");
      return enviarFichaCliente(chatId, clientId);
    }
    if (data.startsWith("cli:ren:cancel:")) {
      const clientId = data.split(":")[3] || data.split(":")[2];
      pending.delete(String(chatId));
      return enviarFichaCliente(chatId, clientId);
    }

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// MENSAJES (wizard + pendientes + /correo + /nombre + /telefono)
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";
  if (!chatId) return;

  // comandos directos: /correo /nombre /telefono
  if (text.startsWith("/")) {
    if (!(await isAdmin(userId))) return;

    const cmd = limpiarQuery(text);
    const first = cmd.split(" ")[0];

    // 1) si es email => submenu inventario (solo por /correo)
    if (isEmailLike(first)) {
      const correo = first;
      const hits = await buscarInventarioPorCorreo(correo);

      if (hits.length === 1) return enviarSubmenuInventario(chatId, hits[0].plataforma, correo);

      if (hits.length > 1) {
        const kb = hits.map((x) => [
          { text: `📌 ${String(x.plataforma).toUpperCase()}`, callback_data: `inv:menu:open:${normalizarPlataforma(x.plataforma)}:${correo}` },
        ]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
        // usamos callback "inv:menu:open" abajo:
        return bot.sendMessage(chatId, `📧 ${correo}\nSeleccione plataforma:`, { reply_markup: { inline_keyboard: kb } });
      }
      // si no existe en inventario, cae a búsqueda de clientes (abajo)
    }

    // 2) búsqueda rápida de clientes por /nombre o /telefono
    // (pero evitamos comandos reales)
    const reservados = new Set([
      "start","menu","stock","buscar","cliente","renovaciones","txt","clientes_txt",
      "add","addp","delp","del","editclave","revadd","revdel","adminadd","admindel",
      ...PLATAFORMAS
    ]);
    if (reservados.has(first)) return; // ya lo maneja su handler

    const resultados = await buscarClienteRobusto(first);
    if (resultados.length === 0) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
    if (resultados.length === 1) return enviarFichaCliente(chatId, resultados[0].id);
    return enviarListaResultadosClientes(chatId, resultados);
  }

  // wizard activo
  if (wizard.has(String(chatId))) {
    if (!(await isAdmin(userId))) return;
    return wizardNext(chatId, text);
  }

  // pendientes (inventario submenu + ediciones + renovar)
  if (pending.has(String(chatId))) {
    if (!(await isAdmin(userId))) return;

    const p = pending.get(String(chatId));
    const t = String(text || "").trim();

    // INVENTARIO: sumar (refresca submenu)
    if (p.mode === "invSumarQty") {
      const qty = Number(t);
      if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. (ej: 1)");
      pending.delete(String(chatId));

      const correo = String(p.correo).toLowerCase();
      const plat = normalizarPlataforma(p.plat);

      const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

      const d = doc.data() || {};
      const nuevoDisp = Number(d.disp || 0) + qty;

      await ref.set({ disp: nuevoDisp, estado: "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return enviarSubmenuInventario(chatId, plat, correo);
    }

    // INVENTARIO: restar (refresca submenu)
    if (p.mode === "invRestarQty") {
      const qty = Number(t);
      if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. (ej: 1)");
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

      return enviarSubmenuInventario(chatId, plat, correo);
    }

    // INVENTARIO: editar clave (refresca submenu)
    if (p.mode === "invEditClave") {
      const nueva = t;
      if (!nueva) return bot.sendMessage(chatId, "⚠️ Clave vacía. Escriba la nueva clave:");
      pending.delete(String(chatId));

      const correo = String(p.correo).toLowerCase();
      const plat = normalizarPlataforma(p.plat);

      const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

      await ref.set({ clave: nueva, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return enviarSubmenuInventario(chatId, plat, correo);
    }

    // editar nombre
    if (p.mode === "editNombre") {
      await db.collection("clientes").doc(String(p.clientId)).set(
        { nombrePerfil: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      pending.delete(String(chatId));
      await bot.sendMessage(chatId, "✅ Nombre actualizado.");
      return enviarFichaCliente(chatId, p.clientId);
    }

    // editar vendedor
    if (p.mode === "editVendedor") {
      await db.collection("clientes").doc(String(p.clientId)).set(
        { vendedor: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      pending.delete(String(chatId));
      await bot.sendMessage(chatId, "✅ Vendedor actualizado.");
      return enviarFichaCliente(chatId, p.clientId);
    }

    // editar teléfono (docId = teléfono: mover)
    if (p.mode === "editTelefono") {
      const newTel = t;
      if (!newTel) return bot.sendMessage(chatId, "⚠️ Teléfono inválido, escriba de nuevo:");

      const oldRef = db.collection("clientes").doc(String(p.clientId));
      const oldDoc = await oldRef.get();
      if (!oldDoc.exists) {
        pending.delete(String(chatId));
        return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
      }

      const data = oldDoc.data() || {};
      const newRef = db.collection("clientes").doc(String(newTel));

      await newRef.set(
        { ...data, telefono: newTel, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      await oldRef.delete();

      pending.delete(String(chatId));
      await bot.sendMessage(chatId, "✅ Teléfono actualizado.");
      return enviarFichaCliente(chatId, newTel);
    }

    // editar fecha servicio
    if (p.mode === "editFechaServicio") {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");
      const ref = db.collection("clientes").doc(String(p.clientId));
      const doc = await ref.get();
      if (!doc.exists) {
        pending.delete(String(chatId));
        return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
      }
      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      if (p.servicioIndex < 0 || p.servicioIndex >= servicios.length) {
        pending.delete(String(chatId));
        return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
      }
      servicios[p.servicioIndex].fechaRenovacion = t;
      await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      pending.delete(String(chatId));
      await bot.sendMessage(chatId, "✅ Fecha actualizada.");
      return enviarFichaCliente(chatId, p.clientId);
    }

    // renovar: pedir fecha y luego confirmar
    if (p.mode === "renFecha") {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");
      pending.delete(String(chatId));
      return bot.sendMessage(chatId, `🔄 Confirmar renovación a fecha: *${t}* ?`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Confirmar", callback_data: `cli:ren:confirm:${p.clientId}:${p.servicioIndex}:${t}` }],
            [{ text: "⬅️ Cancelar", callback_data: `cli:ren:cancel:${p.clientId}` }],
          ],
        },
      });
    }
  }
});

// callback extra para abrir submenu inventario cuando hay multi-plataforma
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const userId = q.from?.id;
  const data = q.data || "";
  try {
    await bot.answerCallbackQuery(q.id);
    if (!chatId) return;
    if (!(await isAdmin(userId))) return;
    if (data.startsWith("inv:menu:open:")) {
      const parts = data.split(":");
      const plat = parts[3];
      const correo = parts[4];
      return enviarSubmenuInventario(chatId, plat, correo);
    }
  } catch (e) {}
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

// Keep alive
setInterval(() => console.log("🟢 Bot activo..."), 60000);
