const http = require("http");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

/**
 * ✅ SUBLICUENTAS TG BOT — INDEX FINAL
 * MENU: Inventario | Clientes | Pagos | Renovaciones | Buscar
 * INVENTARIO: listado por plataforma con paginación (10) + claves visibles
 * ESTADO: "LLENA" (cuando disp llega a 0) en vez de "BLOQUEADA"
 * DISNEYP: 6 perfiles (config en Firestore)
 * /add correo CLAVE plataforma disp [activa|llena]   (formato recomendado)
 * /del correo plataforma
 * /editclave correo plataforma NUEVA_CLAVE
 * /addp correo [plataforma] [cantidad]   (resta disp)
 * /delp correo [plataforma] [cantidad]   (suma disp; si >0 => activa)
 * CLIENTES: Wizard multi-plataforma (suscripciones) + ficha con botones
 * /cliente TELEFONO  -> muestra ficha + botones (Renovó / Eliminar)
 * /delsub TELEFONO PLATAFORMA CORREO -> elimina un servicio por comando
 * RENOVACIONES: /renovaciones ...   TXT: /txt ...
 * BOTON ✅ RENOVÓ: registra pago + mueve fecha +30 días
 * REPORTE CLIENTES: /clientes_txt -> TXT con 01) Nombre | Telefono
 */

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
const PLATAFORMAS = [
  "netflix",
  "disneyp",
  "disneys",
  "hbomax",
  "primevideo",
  "paramount",
  "crunchyroll",
];
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

// +30 días a dd/mm/yyyy
function parseDMY(dmy) {
  const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  return dt;
}
function toDMY(dateObj) {
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yyyy = String(dateObj.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}
function addDaysDMY(dmy, days = 30) {
  const dt = parseDMY(dmy) || new Date();
  dt.setDate(dt.getDate() + days);
  return toDMY(dt);
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
      disneyp: 6, // ✅ Disney Premium 6
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
// MENUS (INLINE)
// ===============================
async function menuPrincipal(chatId) {
  return bot.sendMessage(chatId, "📌 *MENU PRINCIPAL*", {
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
  return bot.sendMessage(chatId, "📦 *INVENTARIO* (elige plataforma)", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📺 Netflix", callback_data: "inv:netflix:0" },
          { text: "🎬 Disney Premium", callback_data: "inv:disneyp:0" },
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
        [{ text: "⬅️ Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
}

async function menuClientes(chatId) {
  return bot.sendMessage(
    chatId,
    "👥 *CLIENTES*\n\n" +
      "➕ Nuevo cliente (wizard multi-plataforma)\n" +
      "📌 Ver cliente: /cliente TELEFONO\n" +
      "🗑 Eliminar servicio: /delsub TELEFONO plataforma correo\n" +
      "📄 Reporte: /clientes_txt\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Nuevo cliente", callback_data: "cli:nuevo" }],
          [{ text: "🔎 Ver cliente", callback_data: "cli:buscar" }],
          [{ text: "⬅️ Inicio", callback_data: "go:inicio" }],
        ],
      },
    }
  );
}

async function menuPagos(chatId) {
  return bot.sendMessage(
    chatId,
    "💳 *PAGOS*\n\n" +
      "Por ahora se registran automaticamente con el boton ✅ RENOVÓ.\n",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Inicio", callback_data: "go:inicio" }]] },
    }
  );
}

async function menuRenovaciones(chatId) {
  return bot.sendMessage(
    chatId,
    "📅 *RENOVACIONES*\n\n" +
      "• /renovaciones hoy\n" +
      "• /renovaciones dd/mm/yyyy\n" +
      "• /renovaciones NOMBRE dd/mm/yyyy\n\n" +
      "TXT:\n" +
      "• /txt hoy\n" +
      "• /txt dd/mm/yyyy\n" +
      "• /txt NOMBRE dd/mm/yyyy\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📅 Renovaciones hoy", callback_data: "ren:hoy" }],
          [{ text: "📄 TXT hoy", callback_data: "txt:hoy" }],
          [{ text: "⬅️ Inicio", callback_data: "go:inicio" }],
        ],
      },
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

  texto += `\n📄 Pagina: ${safePage + 1}/${totalPages}`;
  return { texto, safePage, totalPages };
}

async function enviarInventarioPlataforma(chatId, plataforma, page) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");

  const { texto, safePage, totalPages } = await inventarioPlataformaTexto(p, page);

  const canBack = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return bot.sendMessage(chatId, texto, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⬅️ Atras", callback_data: canBack ? `inv:${p}:${safePage - 1}` : "noop" },
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
// AUTOLlENO: si disp llega a 0 => estado "llena"
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
        `🚨 *ALERTA STOCK*\n${String(dataDespues.plataforma).toUpperCase()} quedo en *0* perfiles.\n📧 ${dataDespues.correo}\n✅ Estado: *LLENA*`,
        { parse_mode: "Markdown" }
      );
    }
  }
}

// ===============================
// INVENTARIO — CRUD
// ===============================

// /add correo CLAVE plataforma disp [activa|llena]
// (soporta formato viejo: /add correo plataforma disp [estado])
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

  if (parts.length >= 3 && /^\d+$/.test(parts[2])) {
    correo = parts[0];
    plataforma = parts[1];
    dispStr = parts[2];
    estadoInput = parts[3] || "activa";
    clave = "";
  } else {
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

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!Number.isFinite(disp) || disp < 0) return bot.sendMessage(chatId, "⚠️ disp invalido.");

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

// /del correo plataforma
bot.onText(/\/del\s+(\S+)\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /del correo plataforma");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  await ref.delete();
  return bot.sendMessage(chatId, `🗑️ Eliminada: ${plataforma.toUpperCase()} — ${correo}`);
});

// /editclave correo plataforma NUEVA_CLAVE
bot.onText(/\/editclave\s+(\S+)\s+(\S+)\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const nueva = String(match[3] || "").trim();

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /editclave correo plataforma NUEVA_CLAVE");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!nueva) return bot.sendMessage(chatId, "⚠️ Falta la clave.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  await ref.set({ clave: nueva, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return bot.sendMessage(chatId, `✅ Clave actualizada\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${nueva}`);
});

// /addp correo [plataforma] [cantidad]
bot.onText(/\/addp\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/);

  const correo = String(parts[0] || "").trim().toLowerCase();
  let plataforma = "";
  let qty = 1;

  if (parts.length === 2) {
    if (/^\d+$/.test(parts[1])) qty = Number(parts[1]);
    else plataforma = normalizarPlataforma(parts[1]);
  } else if (parts.length >= 3) {
    plataforma = normalizarPlataforma(parts[1]);
    qty = Number(parts[2]);
  }

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo [plataforma] [cantidad]");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad invalida.");
  if (plataforma && !esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");

  let ref = null;
  let d = null;

  if (plataforma) {
    ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
    const doc = await ref.get();
    if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
    d = doc.data();
  } else {
    const snap = await db.collection("inventario").where("correo", "==", correo).limit(2).get();
    if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");
    if (snap.size > 1) return bot.sendMessage(chatId, "⚠️ Ese correo está en varias plataformas. Usa: /addp correo plataforma cantidad");
    ref = snap.docs[0].ref;
    d = snap.docs[0].data();
  }

  const total = await getTotalPorPlataforma(d.plataforma);
  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);

  await ref.set({ disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLleno(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : d.estado || "activa";
  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

// /delp correo [plataforma] [cantidad]
bot.onText(/\/delp\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/);

  const correo = String(parts[0] || "").trim().toLowerCase();
  let plataforma = "";
  let qty = 1;

  if (parts.length === 2) {
    if (/^\d+$/.test(parts[1])) qty = Number(parts[1]);
    else plataforma = normalizarPlataforma(parts[1]);
  } else if (parts.length >= 3) {
    plataforma = normalizarPlataforma(parts[1]);
    qty = Number(parts[2]);
  }

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo [plataforma] [cantidad]");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad invalida.");
  if (plataforma && !esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");

  let ref = null;
  let d = null;

  if (plataforma) {
    ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
    const doc = await ref.get();
    if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");
    d = doc.data();
  } else {
    const snap = await db.collection("inventario").where("correo", "==", correo).limit(2).get();
    if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");
    if (snap.size > 1) return bot.sendMessage(chatId, "⚠️ Ese correo está en varias plataformas. Usa: /delp correo plataforma cantidad");
    ref = snap.docs[0].ref;
    d = snap.docs[0].data();
  }

  const total = await getTotalPorPlataforma(d.plataforma);
  const nuevoDisp = Number(d.disp || 0) + qty;

  await ref.set(
    {
      disp: nuevoDisp,
      estado: nuevoDisp > 0 ? "activa" : d.estado || "activa",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(nuevoDisp > 0 ? "activa" : d.estado)}*`,
    { parse_mode: "Markdown" }
  );
});

// ===============================
// BUSQUEDA GENERAL (cliente o cuenta)
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim().toLowerCase();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  const invSnap = await db.collection("inventario").where("correo", "==", q).get();

  const cliSnap = await db.collection("clientes").limit(2000).get();
  const clientes = cliSnap.docs
    .map((d) => d.data() || {})
    .filter((c) => {
      const nombre = String(c.nombrePerfil || "").toLowerCase();
      const tel = String(c.telefono || "").toLowerCase();
      return nombre.includes(q) || tel.includes(q);
    })
    .slice(0, 10);

  let texto = `🔎 *BUSQUEDA GENERAL*\nConsulta: \`${q}\`\n\n`;

  if (invSnap.empty && clientes.length === 0) {
    texto += "⚠️ Sin resultados.";
    return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
  }

  if (!invSnap.empty) {
    texto += "*INVENTARIO:*\n";
    invSnap.forEach((d) => {
      const x = d.data();
      texto += `• ${String(x.plataforma).toUpperCase()} — ${x.correo} — ${x.disp} — ${fmtEstado(x.estado)}\n`;
    });
    texto += "\n";
  }

  if (clientes.length > 0) {
    texto += "*CLIENTES (top 10):*\n";
    for (const c of clientes) {
      texto += `• ${c.nombrePerfil || "-"} — ${c.telefono || "-"} — ${c.vendedor || "-"}\n`;
    }
    texto += `\n📌 Ver ficha: /cliente TELEFONO`;
  }

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

// ===============================
// CLIENTES — WIZARD MULTI-PLATAFORMA + BOTONES
// ===============================
const wizard = new Map();

function wizardReset(chatId) {
  wizard.delete(String(chatId));
}

function botonesServiciosCliente(clienteId, suscripciones = []) {
  const rows = [];
  suscripciones.forEach((s, i) => {
    rows.push([
      { text: `✅ Renovó ${String(s.plataforma).toUpperCase()}`, callback_data: `cli_ren:${clienteId}:${i}` },
      { text: `🗑 Eliminar ${String(s.plataforma).toUpperCase()}`, callback_data: `cli_del:${clienteId}:${i}` },
    ]);
  });
  rows.push([{ text: "⬅️ Volver", callback_data: "menu:clientes" }]);
  return { inline_keyboard: rows };
}

async function wizardStart(chatId) {
  wizard.set(String(chatId), {
    step: 1,
    subStep: 0,
    data: {},
    suscripciones: [],
    pendingDecision: false,
    currentSub: null,
  });
  return bot.sendMessage(chatId, "👥 NUEVO CLIENTE\n(1/3) Escribe: *Nombre perfil*", { parse_mode: "Markdown" });
}

async function wizardPromptSuscripcion(chatId) {
  const st = wizard.get(String(chatId));
  if (!st) return;
  st.subStep = 1;
  st.pendingDecision = false;
  st.currentSub = {};
  return bot.sendMessage(
    chatId,
    "📌 AGREGAR SERVICIO\n(1/5) Plataforma (netflix/disneyp/disneys/hbomax/primevideo/paramount/crunchyroll):"
  );
}

async function wizardAskAddMore(chatId) {
  const st = wizard.get(String(chatId));
  if (!st) return;
  st.pendingDecision = true;

  return bot.sendMessage(chatId, "✅ Servicio agregado.\n¿Deseas agregar *otra plataforma* a este cliente?", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Agregar otra", callback_data: "wiz:addmore" }],
        [{ text: "✅ Finalizar", callback_data: "wiz:finish" }],
      ],
    },
  });
}

async function wizardFinalizar(chatId) {
  const st = wizard.get(String(chatId));
  if (!st) return;

  if (!st.suscripciones || st.suscripciones.length === 0) {
    wizardReset(chatId);
    return bot.sendMessage(chatId, "⚠️ No se agrego ningun servicio. Cancelado.");
  }

  const base = st.data;
  const first = st.suscripciones[0];

  const payload = {
    nombrePerfil: base.nombrePerfil || "-",
    telefono: base.telefono || "-",
    vendedor: base.vendedor || "-",
    moneda: "Lps",
    plataforma: first.plataforma,
    correo: first.correo,
    pin: first.pin,
    precio: first.precio,
    fechaRenovacion: first.fechaRenovacion,
    suscripciones: st.suscripciones,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("clientes").add(payload);
  wizardReset(chatId);

  let t = `✅ Cliente agregado\n\n`;
  t += `📌 Datos del cliente\n`;
  t += `Nombre: ${payload.nombrePerfil}\n`;
  t += `Telefono: ${payload.telefono}\n`;
  t += `Vendedor: ${payload.vendedor}\n\n`;
  t += `📺 Servicios\n`;
  payload.suscripciones.forEach((s, i) => {
    t += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`;
  });

  t += `\n📌 Ver ficha: /cliente ${payload.telefono}`;
  return bot.sendMessage(chatId, t);
}

async function wizardNext(chatId, text) {
  const st = wizard.get(String(chatId));
  if (!st) return;
  if (st.pendingDecision) return;

  const t = String(text || "").trim();

  if (st.step === 1) {
    st.data.nombrePerfil = t;
    st.step = 2;
    return bot.sendMessage(chatId, "(2/3) Telefono:");
  }
  if (st.step === 2) {
    st.data.telefono = t;
    st.step = 3;
    return bot.sendMessage(chatId, "(3/3) Nombre del vendedor:");
  }
  if (st.step === 3) {
    st.data.vendedor = t;
    st.step = 4;
    return wizardPromptSuscripcion(chatId);
  }

  if (st.step === 4) {
    const sub = st.currentSub || {};
    switch (st.subStep) {
      case 1: {
        const p = normalizarPlataforma(t);
        if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida. Intenta de nuevo:");
        sub.plataforma = p;
        st.currentSub = sub;
        st.subStep = 2;
        return bot.sendMessage(chatId, "(2/5) Correo de la cuenta:");
      }
      case 2:
        if (!t.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido. Intenta de nuevo:");
        sub.correo = t.toLowerCase();
        st.currentSub = sub;
        st.subStep = 3;
        return bot.sendMessage(chatId, "(3/5) Pin/Clave del perfil:");
      case 3:
        sub.pin = t;
        st.currentSub = sub;
        st.subStep = 4;
        return bot.sendMessage(chatId, "(4/5) Precio (solo numero, en Lps):");
      case 4: {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio invalido. Escribe solo numero:");
        sub.precio = n;
        st.currentSub = sub;
        st.subStep = 5;
        return bot.sendMessage(chatId, "(5/5) Fecha renovacion (dd/mm/yyyy):");
      }
      case 5:
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato invalido. Usa dd/mm/yyyy:");
        sub.fechaRenovacion = t;
        st.currentSub = sub;
        st.suscripciones.push({ ...sub });
        return wizardAskAddMore(chatId);
      default:
        return;
    }
  }
}

// /cliente TELEFONO
bot.onText(/\/cliente\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const telefono = String(match[1] || "").trim();

  const snap = await db.collection("clientes").where("telefono", "==", telefono).limit(1).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado por telefono.");

  const doc = snap.docs[0];
  const c = doc.data() || {};
  const sus = Array.isArray(c.suscripciones) ? c.suscripciones : [];

  let texto = `👤 *CLIENTE*\n\n`;
  texto += `📌 Datos del cliente\n`;
  texto += `Nombre: ${c.nombrePerfil || "-"}\n`;
  texto += `Telefono: ${c.telefono || "-"}\n`;
  texto += `Vendedor: ${c.vendedor || "-"}\n\n`;

  texto += `📺 *SERVICIOS*\n`;
  if (sus.length === 0) texto += "⚠️ Sin servicios.\n";
  else {
    sus.forEach((s, i) => {
      texto += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`;
    });
  }

  return bot.sendMessage(chatId, texto, {
    parse_mode: "Markdown",
    reply_markup: botonesServiciosCliente(doc.id, sus),
  });
});

// /delsub TELEFONO PLATAFORMA CORREO
bot.onText(/\/delsub\s+(\S+)\s+(\S+)\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const telefono = String(match[1] || "").trim();
  const plataforma = normalizarPlataforma(match[2] || "");
  const correo = String(match[3] || "").trim().toLowerCase();

  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");

  const snap = await db.collection("clientes").where("telefono", "==", telefono).limit(1).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const ref = snap.docs[0].ref;
  const data = snap.docs[0].data() || {};
  let sus = Array.isArray(data.suscripciones) ? data.suscripciones : [];

  const antes = sus.length;
  sus = sus.filter(
    (s) =>
      !(
        normalizarPlataforma(s.plataforma) === plataforma &&
        String(s.correo || "").toLowerCase() === correo
      )
  );

  if (sus.length === antes) return bot.sendMessage(chatId, "⚠️ Servicio no encontrado.");

  await ref.set({ suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  return bot.sendMessage(chatId, `🗑️ Servicio eliminado\n📱 ${telefono}\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}`);
});

// /clientes_txt
bot.onText(/\/clientes_txt/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const snap = await db.collection("clientes").limit(3000).get();

  const rows = snap.docs
    .map((d) => d.data() || {})
    .map((c) => ({
      nombre: String(c.nombrePerfil || "-").trim(),
      tel: String(c.telefono || "-").trim(),
    }))
    .sort((a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase()));

  const fecha = hoyDMY();
  const filePath = path.join(__dirname, `clientes_general_${fecha.replaceAll("/", "_")}.txt`);

  let body = `CLIENTES - GENERAL (${fecha})\n\n`;
  rows.forEach((r, i) => {
    const n = String(i + 1).padStart(2, "0");
    body += `${n}) ${r.nombre} | ${r.tel}\n`;
  });

  body += `\n--------------------\n`;
  body += `TOTAL CLIENTES: ${rows.length}\n`;

  fs.writeFileSync(filePath, body, "utf8");
  await bot.sendDocument(chatId, filePath);
  try { fs.unlinkSync(filePath); } catch (e) {}
});

// ===============================
// RENOVACIONES + TXT
// ===============================
async function obtenerRenovacionesPorFecha(fechaDMY, vendedorOpt) {
  const snap = await db.collection("clientes").limit(2000).get();
  const out = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const vendedor = String(c.vendedor || "").trim();

    const base = {
      nombrePerfil: c.nombrePerfil || "-",
      plataforma: c.plataforma || "-",
      precio: c.precio || 0,
      telefono: c.telefono || "-",
      vendedor: vendedor || "-",
      fechaRenovacion: c.fechaRenovacion || "-",
    };

    if (base.fechaRenovacion === fechaDMY) {
      if (!vendedorOpt || vendedor.toLowerCase() === vendedorOpt.toLowerCase()) out.push(base);
    }

    const sus = Array.isArray(c.suscripciones) ? c.suscripciones : [];
    for (const s of sus) {
      if (String(s.fechaRenovacion || "") === fechaDMY) {
        const vendOk = !vendedorOpt || vendedor.toLowerCase() === vendedorOpt.toLowerCase();
        if (vendOk) {
          out.push({
            nombrePerfil: c.nombrePerfil || "-",
            plataforma: s.plataforma || base.plataforma || "-",
            precio: Number(s.precio || base.precio || 0),
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
  body += vendedorOpt ? `RENOVACIONES ${fechaDMY} - ${vendedorOpt}\n\n` : `RENOVACIONES ${fechaDMY} - GENERAL\n\n`;

  if (!list || list.length === 0) {
    body += "SIN RENOVACIONES\n";
  } else {
    let suma = 0;
    list.forEach((x, i) => {
      suma += Number(x.precio || 0);
      body += `${i + 1}) ${x.nombrePerfil} | ${x.plataforma} | ${x.precio} Lps | ${x.telefono} | ${x.vendedor}\n`;
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
  return bot.sendMessage(chatId, renovacionesTexto(list, fecha, vendedor || null), { parse_mode: "Markdown" });
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

// ===============================
// START + MENU + ACCESOS
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
// CALLBACKS (BOTONES)
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

    if (data === "go:inicio") return menuPrincipal(chatId);

    if (data === "menu:inventario") return menuInventario(chatId);
    if (data === "menu:clientes") return menuClientes(chatId);
    if (data === "menu:pagos") return menuPagos(chatId);
    if (data === "menu:renovaciones") return menuRenovaciones(chatId);
    if (data === "menu:buscar") return bot.sendMessage(chatId, "🔎 Usa: /buscar texto");

    if (data === "inv:general") return mostrarStockGeneral(chatId);
    if (data.startsWith("inv:")) {
      const [, plat, pageStr] = data.split(":");
      return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
    }

    if (data === "cli:nuevo") return wizardStart(chatId);
    if (data === "cli:buscar") return bot.sendMessage(chatId, "🔎 Ver ficha: /cliente TELEFONO");

    if (data === "wiz:addmore") {
      const st = wizard.get(String(chatId));
      if (!st) return;
      st.pendingDecision = false;
      return wizardPromptSuscripcion(chatId);
    }
    if (data === "wiz:finish") return wizardFinalizar(chatId);

    if (data === "ren:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, null);
      return bot.sendMessage(chatId, renovacionesTexto(list, fecha, null), { parse_mode: "Markdown" });
    }
    if (data === "txt:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, null);
      return enviarTXT(chatId, list, fecha, null);
    }

    // cli_del: confirm
    if (data.startsWith("cli_del:")) {
      const [, clienteId, indexStr] = data.split(":");
      const index = Number(indexStr);

      const ref = db.collection("clientes").doc(clienteId);
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no existe.");

      const cliente = doc.data() || {};
      const sus = Array.isArray(cliente.suscripciones) ? cliente.suscripciones : [];
      if (!sus[index]) return bot.sendMessage(chatId, "⚠️ Servicio no existe.");

      const s = sus[index];
      return bot.sendMessage(
        chatId,
        `⚠️ Confirmar eliminar\n\n${cliente.nombrePerfil || "-"}\n${cliente.telefono || "-"}\n\n${s.plataforma}\n${s.correo}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Confirmar", callback_data: `cli_del_ok:${clienteId}:${index}` },
                { text: "❌ Cancelar", callback_data: "noop" },
              ],
            ],
          },
        }
      );
    }

    if (data.startsWith("cli_del_ok:")) {
      const [, clienteId, indexStr] = data.split(":");
      const index = Number(indexStr);

      const ref = db.collection("clientes").doc(clienteId);
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no existe.");

      const cliente = doc.data() || {};
      const sus = Array.isArray(cliente.suscripciones) ? [...cliente.suscripciones] : [];
      if (!sus[index]) return bot.sendMessage(chatId, "⚠️ Servicio no existe.");

      const eliminado = sus.splice(index, 1)[0];

      await ref.set(
        { suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

      return bot.sendMessage(chatId, `🗑 Servicio eliminado\n${eliminado.plataforma} — ${eliminado.correo}\n\n📌 Ver: /cliente ${cliente.telefono}`);
    }

    // cli_ren: confirm
    if (data.startsWith("cli_ren:")) {
      const [, clienteId, indexStr] = data.split(":");
      const index = Number(indexStr);

      const ref = db.collection("clientes").doc(clienteId);
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no existe.");

      const cliente = doc.data() || {};
      const sus = Array.isArray(cliente.suscripciones) ? cliente.suscripciones : [];
      if (!sus[index]) return bot.sendMessage(chatId, "⚠️ Servicio no existe.");

      const s = sus[index];
      const nuevaFecha = addDaysDMY(s.fechaRenovacion, 30);

      return bot.sendMessage(
        chatId,
        `⚠️ Confirmar RENOVACION\n\n${cliente.nombrePerfil || "-"}\n${cliente.telefono || "-"}\n\nServicio: ${s.plataforma}\nCorreo: ${s.correo}\nPrecio: ${s.precio} Lps\n\nFecha actual: ${s.fechaRenovacion}\nNueva fecha: ${nuevaFecha}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Confirmar", callback_data: `cli_ren_ok:${clienteId}:${index}` },
                { text: "❌ Cancelar", callback_data: "noop" },
              ],
            ],
          },
        }
      );
    }

    if (data.startsWith("cli_ren_ok:")) {
      const [, clienteId, indexStr] = data.split(":");
      const index = Number(indexStr);

      const ref = db.collection("clientes").doc(clienteId);
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no existe.");

      const cliente = doc.data() || {};
      const sus = Array.isArray(cliente.suscripciones) ? [...cliente.suscripciones] : [];
      if (!sus[index]) return bot.sendMessage(chatId, "⚠️ Servicio no existe.");

      const s = sus[index];
      const fechaAnterior = s.fechaRenovacion || hoyDMY();
      const fechaNueva = addDaysDMY(fechaAnterior, 30);

      sus[index] = { ...s, fechaRenovacion: fechaNueva };

      await ref.set(
        { suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

      await db.collection("pagos").add({
        nombrePerfil: cliente.nombrePerfil || "-",
        telefono: cliente.telefono || "-",
        vendedor: cliente.vendedor || "-",
        plataforma: s.plataforma || "-",
        correo: s.correo || "-",
        monto: Number(s.precio || 0),
        moneda: "Lps",
        fechaAnterior,
        fechaNueva,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return bot.sendMessage(chatId, `✅ Renovacion registrada\nNueva fecha: ${fechaNueva}\nPago guardado.\n\n📌 Ver: /cliente ${cliente.telefono}`);
    }

    return bot.sendMessage(chatId, "⚠️ Accion no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// WIZARD CAPTURA
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";

  if (!chatId) return;
  if (text.startsWith("/")) return;

  if (wizard.has(String(chatId))) {
    if (!(await isAdmin(userId))) return;
    return wizardNext(chatId, text);
  }
});

// ===============================
// HTTP SERVER (Render)
// ===============================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Sublicuentas bot OK");
  })
  .listen(PORT, "0.0.0.0", () => console.log("🌐 Web service activo en puerto " + PORT));

setInterval(() => console.log("🟢 Bot activo..."), 60000);
