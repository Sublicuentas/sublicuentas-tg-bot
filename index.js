/**
 * ✅ SUBLICUENTAS TG BOT — INDEX FINAL (sin errores y cerrado)
 * - Menu principal: Inventario | Clientes | Pagos | Renovaciones | Buscar
 * - Inventario por plataforma con paginacion (10 en 10): Atras | Inicio | Siguiente
 *   - "Inicio" = Menu principal (como pediste)
 * - Estado: "LLENA" en vez de "BLOQUEADA"
 * - Disney Premium = 6 perfiles (configurable en Firestore)
 * - /addp correo 3 (cantidad opcional)
 * - /txt hoy | /txt dd/mm/yyyy | /txt NOMBRE dd/mm/yyyy (sin palabra "vendedor")
 * - /renovaciones hoy | /renovaciones dd/mm/yyyy | /renovaciones NOMBRE dd/mm/yyyy
 * - /editclave correo plataforma NUEVA_CLAVE
 * - /del correo plataforma  (borrar cuenta del inventario)
 * - Busqueda general: /buscar texto (cliente o cuenta)
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

// Firebase (Render/Node)
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
  "disneyp", // Disney Premium (6)
  "disneys", // Disney Standard
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

// DocID estable por (plataforma + correo)
function docIdInventario(correo, plataforma) {
  return `${normalizarPlataforma(plataforma)}__${safeMail(correo)}`;
}

function fmtEstado(estado) {
  const e = String(estado || "").toLowerCase();
  if (e === "bloqueada" || e === "llena") return "LLENA";
  return "ACTIVA";
}

// dd/mm/yyyy (lo que pediste)
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
  // 👇 Ajuste: disneyp = 6 (y las demas 5 por default)
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

  // Si existe pero falta disneyp o esta en 5, lo forzamos a 6
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
      "• Nuevo cliente (wizard)\n" +
      "• Listar clientes (paginado)\n" +
      "• Buscar cliente\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Nuevo cliente", callback_data: "cli:nuevo" }],
          [{ text: "📋 Clientes (lista)", callback_data: "cli:lista:0" }],
          [{ text: "🔎 Buscar", callback_data: "cli:buscar" }],
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
      "• Registrar pago\n" +
      "• Ultimos pagos\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Registrar pago", callback_data: "pay:nuevo" }],
          [{ text: "🧾 Ultimos pagos", callback_data: "pay:lista:0" }],
          [{ text: "⬅️ Inicio", callback_data: "go:inicio" }],
        ],
      },
    }
  );
}

async function menuRenovaciones(chatId) {
  return bot.sendMessage(
    chatId,
    "📅 *RENOVACIONES*\n\n" +
      "Comandos rapidos:\n" +
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
          [{ text: "👤 Revendedores (lista)", callback_data: "rev:lista" }],
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

  // Solo activas y con disp >= 1
  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    // orden por mas libres primero
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
  if (!esPlataformaValida(p)) {
    return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  }

  const { texto, safePage, totalPages } = await inventarioPlataformaTexto(p, page);

  // Botones: Atras | Inicio | Siguiente (Inicio = menu principal)
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
        [
          { text: "🔄 Actualizar", callback_data: `inv:${p}:${safePage}` },
        ],
        [
          { text: "⬅️ Volver Inventario", callback_data: "menu:inventario" },
        ],
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
// AUTOBLOQUEO: si disp llega a 0 => estado "llena"
// ===============================
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

    // alerta solo si antes > 0
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
// COMANDOS INVENTARIO (CRUD)
// ===============================

// /add (compatible)
// Nuevo formato recomendado:
// /add correo CLAVE plataforma disp [activa|llena]
// Ej: /add tristan@sublicuentas.com subli2 netflix 5 activa
//
// Formato viejo aun soportado:
// /add correo plataforma disp [activa|llena]
bot.onText(/\/add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/);

  // Determinar si viene con clave
  // con clave: correo clave plataforma disp [estado] -> min 4
  // viejo: correo plataforma disp [estado] -> min 3
  if (parts.length < 3) {
    return bot.sendMessage(chatId, "⚠️ Uso: /add correo CLAVE plataforma disp [activa|llena]");
  }

  let correo = "";
  let clave = "";
  let plataforma = "";
  let dispStr = "";
  let estadoInput = "";

  if (parts.length >= 4 && parts[2] && /\d+/.test(parts[3])) {
    // viejo: correo plataforma disp ...
    correo = parts[0];
    plataforma = parts[1];
    dispStr = parts[2];
    estadoInput = parts[3] || "activa";
    clave = ""; // sin clave
  } else {
    // nuevo: correo clave plataforma disp ...
    correo = parts[0];
    clave = parts[1];
    plataforma = parts[2];
    dispStr = parts[3] || "0";
    estadoInput = parts[4] || "activa";
  }

  correo = String(correo).trim().toLowerCase();
  plataforma = normalizarPlataforma(plataforma);
  const disp = Number(dispStr);

  // Estado: activa / llena (alias: bloqueada)
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
    clave: clave ? String(clave) : (prev.exists ? prev.data()?.clave || "" : ""),
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

// /del correo plataforma (BORRAR doc)
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

  await ref.set(
    { clave: nueva, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Clave actualizada\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${nueva}`);
});

// /buscar texto (cliente o cuenta)
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim().toLowerCase();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  // Inventario por correo (igual)
  const invSnap = await db.collection("inventario").where("correo", "==", q).get();

  // Clientes: por telefono exacto o por nombre (contiene) -> simple: traemos y filtramos en memoria (para 600 ok)
  const cliSnap = await db.collection("clientes").limit(1000).get();
  const clientes = cliSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => {
      const nombre = String(c.nombrePerfil || "").toLowerCase();
      const tel = String(c.telefono || "").toLowerCase();
      const correo = String(c.correo || "").toLowerCase();
      return nombre.includes(q) || tel.includes(q) || correo.includes(q);
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
      texto += `• ${c.nombrePerfil || "-"} — ${c.plataforma || "-"} — ${c.precio || "-"} Lps — ${c.telefono || "-"} — Renueva: ${c.fechaRenovacion || "-"} — ${c.vendedor || "-"}\n`;
    }
  }

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

// /addp correo [cantidad]
bot.onText(/\/addp\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const qty = Number(match[2] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo [cantidad]");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad invalida.");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  if (snap.size > 1) {
    let t = "⚠️ Ese correo aparece en varias plataformas.\nUse:\n/addp correo plataforma cantidad\n\nOpciones:\n";
    snap.forEach((d) => (t += `• ${String(d.data().plataforma).toUpperCase()}\n`));
    return bot.sendMessage(chatId, t);
  }

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(d.plataforma);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);

  await ref.set(
    { disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLleno(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : (d.estado || "activa");

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

// /addp correo plataforma cantidad  (si hay duplicados)
bot.onText(/\/addp\s+(\S+)\s+(\S+)\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const qty = Number(match[3] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo plataforma cantidad");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad invalida.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  const d = doc.data();
  const total = await getTotalPorPlataforma(plataforma);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);

  await ref.set(
    { disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLleno(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : (d.estado || "activa");

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

// /delp correo [cantidad]  (suma) + reactiva si sube de 0
bot.onText(/\/delp\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const qty = Number(match[2] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo [cantidad]");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad invalida.");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  if (snap.size > 1) {
    let t = "⚠️ Ese correo aparece en varias plataformas.\nUse:\n/delp correo plataforma cantidad\n\nOpciones:\n";
    snap.forEach((d) => (t += `• ${String(d.data().plataforma).toUpperCase()}\n`));
    return bot.sendMessage(chatId, t);
  }

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(d.plataforma);

  const nuevoDisp = Number(d.disp || 0) + qty;

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
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(nuevoDisp > 0 ? "activa" : d.estado)}*`,
    { parse_mode: "Markdown" }
  );
});

// ===============================
// CLIENTES (estructura simple + soporta multiples perfiles)
// ===============================
// Coleccion: clientes
// Doc: autoID
// Campos base (lo que pediste):
// nombrePerfil, telefono, plataforma, correo, pin, precio, fechaRenovacion(dd/mm/yyyy), vendedor
//
// Si un cliente tiene varias plataformas/perfiles:
// guardamos en "suscripciones": [ {plataforma, correo, pin, precio, fechaRenovacion} ... ]
// y el primer registro queda tambien reflejado en campos base para listado rapido.

const wizard = new Map(); // chatId -> { step, data }

function wizardReset(chatId) {
  wizard.delete(String(chatId));
}

async function wizardStart(chatId) {
  wizard.set(String(chatId), { step: 1, data: {} });
  return bot.sendMessage(chatId, "👥 NUEVO CLIENTE (1/8)\nEscribe: *Nombre perfil*", { parse_mode: "Markdown" });
}

async function wizardNext(chatId, text) {
  const st = wizard.get(String(chatId));
  if (!st) return;

  const t = String(text || "").trim();
  const d = st.data;

  switch (st.step) {
    case 1:
      d.nombrePerfil = t;
      st.step = 2;
      return bot.sendMessage(chatId, "👥 (2/8) Telefono:");
    case 2:
      d.telefono = t;
      st.step = 3;
      return bot.sendMessage(chatId, "👥 (3/8) Plataforma (netflix/disneyp/disneys/hbomax/primevideo/paramount/crunchyroll):");
    case 3: {
      const p = normalizarPlataforma(t);
      if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida. Intenta de nuevo:");
      d.plataforma = p;
      st.step = 4;
      return bot.sendMessage(chatId, "👥 (4/8) Correo de la cuenta:");
    }
    case 4:
      d.correo = t.toLowerCase();
      st.step = 5;
      return bot.sendMessage(chatId, "👥 (5/8) Pin/Clave del perfil:");
    case 5:
      d.pin = t;
      st.step = 6;
      return bot.sendMessage(chatId, "👥 (6/8) Precio (solo numero, en Lps):");
    case 6: {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio invalido. Escribe solo numero:");
      d.precio = n;
      st.step = 7;
      return bot.sendMessage(chatId, "👥 (7/8) Fecha renovacion (dd/mm/yyyy):");
    }
    case 7:
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato invalido. Usa dd/mm/yyyy:");
      d.fechaRenovacion = t;
      st.step = 8;
      return bot.sendMessage(chatId, "👥 (8/8) Nombre del vendedor:");
    case 8:
      d.vendedor = t;

      // Guardar cliente
      await db.collection("clientes").add({
        ...d,
        moneda: "Lps",
        suscripciones: [
          {
            plataforma: d.plataforma,
            correo: d.correo,
            pin: d.pin,
            precio: d.precio,
            fechaRenovacion: d.fechaRenovacion,
          },
        ],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      wizardReset(chatId);
      return bot.sendMessage(
        chatId,
        `✅ Cliente agregado\n${d.nombrePerfil}\n${d.telefono}\n${d.plataforma}\n${d.correo}\nRenueva: ${d.fechaRenovacion}\n${d.vendedor}\n${d.precio} Lps`
      );
    default:
      wizardReset(chatId);
      return;
  }
}

// Agregar otra suscripcion a un cliente existente (por telefono o nombre parcial)
// /addsub telefono plataforma correo pin precio dd/mm/yyyy
bot.onText(/\/addsub\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{2}\/\d{2}\/\d{4})/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const telefono = String(match[1] || "").trim();
  const plataforma = normalizarPlataforma(match[2] || "");
  const correo = String(match[3] || "").trim().toLowerCase();
  const pin = String(match[4] || "").trim();
  const precio = Number(match[5] || 0);
  const fecha = String(match[6] || "").trim();

  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");
  if (!Number.isFinite(precio) || precio <= 0) return bot.sendMessage(chatId, "⚠️ Precio invalido.");
  if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Fecha invalida.");

  // Buscar cliente por telefono exacto
  const snap = await db.collection("clientes").where("telefono", "==", telefono).limit(1).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado por telefono.");

  const ref = snap.docs[0].ref;
  const d = snap.docs[0].data();

  const sus = Array.isArray(d.suscripciones) ? d.suscripciones : [];
  sus.push({ plataforma, correo, pin, precio, fechaRenovacion: fecha });

  await ref.set(
    { suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Suscripcion agregada\n${telefono}\n${plataforma}\n${correo}\nRenueva: ${fecha}\n${precio} Lps`);
});

// ===============================
// RENOVACIONES + TXT
// ===============================
async function obtenerRenovacionesPorFecha(fechaDMY, vendedorOpt) {
  const snap = await db.collection("clientes").limit(1500).get();
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

    // Base (primer registro)
    if (base.fechaRenovacion === fechaDMY) {
      if (!vendedorOpt || vendedor.toLowerCase() === vendedorOpt.toLowerCase()) out.push(base);
    }

    // Suscripciones extra
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

  // orden: vendedor, nombre
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
    // ✅ sin palabra "vendedor", solo el nombre al final
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

  // TXT sin acentos (como pediste): texto simple
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
  try {
    fs.unlinkSync(filePath);
  } catch (e) {}
}

// /renovaciones hoy
// /renovaciones dd/mm/yyyy
// /renovaciones NOMBRE dd/mm/yyyy
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
      return bot.sendMessage(
        chatId,
        "⚠️ Uso:\n/renovaciones hoy\n/renovaciones dd/mm/yyyy\n/renovaciones NOMBRE dd/mm/yyyy"
      );
    }
  }

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  const texto = renovacionesTexto(list, fecha, vendedor || null);
  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

// /txt hoy
// /txt dd/mm/yyyy
// /txt NOMBRE dd/mm/yyyy   (sin palabra vendedor)
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
      return bot.sendMessage(
        chatId,
        "⚠️ Uso:\n/txt hoy\n/txt dd/mm/yyyy\n/txt NOMBRE dd/mm/yyyy"
      );
    }
  }

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  return enviarTXT(chatId, list, fecha, vendedor || null);
});

// ===============================
// REVENDEDORES (lista simple)
// ===============================
// Coleccion: revendedores { nombre, activo }
async function listarRevendedores(chatId) {
  const snap = await db.collection("revendedores").where("activo", "==", true).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay revendedores.");

  let t = "👤 *REVENDEDORES*\n\n";
  snap.forEach((d, i) => {
    const x = d.data();
    t += `• ${x.nombre}\n`;
  });

  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
}

// /revadd NOMBRE
bot.onText(/\/revadd\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso: /revadd NOMBRE");

  await db.collection("revendedores").doc(nombre.toLowerCase()).set({ nombre, activo: true }, { merge: true });
  return bot.sendMessage(chatId, `✅ Revendedor agregado: ${nombre}`);
});

// /revdel NOMBRE
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

// Acceso rapido por comando plataforma (ej /netflix)
PLATAFORMAS.forEach((p) => {
  bot.onText(new RegExp("^\\/" + p + "$", "i"), async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return enviarInventarioPlataforma(chatId, p, 0);
  });
});

// /stock -> general
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
    // ✅ siempre responder callback para que no salga "Error"
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

    // Inventario
    if (data === "inv:general") return mostrarStockGeneral(chatId);

    if (data.startsWith("inv:")) {
      const [, plat, pageStr] = data.split(":");
      return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
    }

    // Clientes
    if (data === "cli:nuevo") return wizardStart(chatId);
    if (data.startsWith("cli:lista:")) {
      return bot.sendMessage(chatId, "📋 (Lista clientes pendiente de paginado visual)\nPor ahora usa /buscar o /renovaciones.");
    }
    if (data === "cli:buscar") return bot.sendMessage(chatId, "🔎 Buscar cliente: /buscar nombre o telefono");

    // Pagos
    if (data === "pay:nuevo") return bot.sendMessage(chatId, "💳 Registrar pago: (si quieres lo armamos con wizard igual)");
    if (data.startsWith("pay:lista:")) return bot.sendMessage(chatId, "🧾 Ultimos pagos: (pendiente)");

    // Renovaciones
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

    return bot.sendMessage(chatId, "⚠️ Accion no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// WIZARD CAPTURA (solo si esta activo)
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";

  if (!chatId) return;
  if (text.startsWith("/")) return; // comandos no

  // wizard cliente
  if (wizard.has(String(chatId))) {
    if (!(await isAdmin(userId))) return;
    return wizardNext(chatId, text);
  }
});

// ===============================
// SERVIDOR HTTP (Render requiere puerto abierto)
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

// ===============================
// KEEP ALIVE LOG
// ===============================
setInterval(() => console.log("🟢 Bot activo..."), 60000);
