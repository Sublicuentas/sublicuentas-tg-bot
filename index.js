/**
 * ✅ SUBLICUENTAS TG BOT — INDEX FINAL (ACTUALIZADO + CERRADO)
 *
 * ✅ NUEVAS ACTUALIZACIONES (las 2 últimas que pidió):
 * 1) ✏️ EDITAR CLIENTE (submenú visual en ficha):
 *    - 🧑 Cambiar nombre
 *    - 📱 Cambiar teléfono
 *    - 👨‍💼 Cambiar vendedor
 *    - ⬅️ Volver
 *    Al tocar una opción, el bot pide el nuevo valor y actualiza.
 *
 * 2) ↩️ ANULAR RENOVACIÓN (submenú visual en ficha):
 *    - Muestra lista de servicios del cliente
 *    - Usted elige servicio (plataforma)
 *    - Si ese servicio tiene lastRenew, revierte fecha a fechaAntes y borra lastRenew
 *    - Si NO hay lastRenew, avisa que no se puede anular
 *
 * ✅ RECORDATORIO IMPORTANTE (para que NO se arruinen emojis):
 * - Guarde este archivo como UTF-8 (NO ANSI / NO Latin1).
 *   En VSCode: abajo a la derecha “UTF-8” -> “Save with encoding” -> “UTF-8”
 *
 * ✅ MENU PRINCIPAL:
 * Inventario | Clientes | Pagos | Renovaciones | Buscar
 *
 * ✅ Inventario por plataforma con paginación 10 en 10:
 * ⬅️ Atrás | 🏠 Inicio | ➡️ Siguiente
 * (Inicio = vuelve a menú principal)
 *
 * ✅ Disney Premium = 6 perfiles (config en Firestore)
 * ✅ /addp correo 3 (cantidad opcional)
 * ✅ /txt hoy | /txt dd/mm/yyyy | /txt NOMBRE dd/mm/yyyy (sin palabra "vendedor")
 * ✅ /renovaciones hoy | /renovaciones dd/mm/yyyy | /renovaciones NOMBRE dd/mm/yyyy
 * ✅ /editclave correo plataforma NUEVA_CLAVE
 * ✅ /del correo plataforma  (borrar cuenta del inventario)
 * ✅ Búsqueda general: /buscar texto (cliente o cuenta)
 *
 * ✅ FICHA CLIENTE (visual):
 * /cliente TELEFONO
 * - Muestra: Cliente agregado / Datos del cliente / Servicios (sin ID)
 * - Botones: ➕ Agregar plataforma | 🔄 Renovar | ↩️ Anular | ❌ Eliminar perfil | ✏️ Editar cliente
 *
 * ✅ REPORTE TXT GENERAL DE CLIENTES:
 * /clientes_txt
 * - Genera TXT: 01) Nombre | Telefono
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
// ESTADOS EN MEMORIA (UX)
// ===============================
// Wizard cliente + capturas de edición/renovar/anular
const wizard = new Map(); // chatId -> { step, data }
const pending = new Map(); // chatId -> { type, clientId, platform? }

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
    "👥 *CLIENTES*\n\n" +
      "• ➕ Nuevo cliente\n" +
      "• 📄 TXT clientes (general)\n" +
      "• 📌 Ver ficha: /cliente TELEFONO\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Nuevo cliente", callback_data: "cli:nuevo" }],
          [{ text: "📄 Clientes TXT", callback_data: "cli:txt" }],
          [{ text: "🔎 Buscar", callback_data: "cli:buscar" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ],
      },
    }
  );
}

async function menuPagos(chatId) {
  return bot.sendMessage(chatId, "💳 *PAGOS*\n\n(Se arma despues si quiere con wizard)", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]],
    },
  });
}

async function menuRenovaciones(chatId) {
  return bot.sendMessage(
    chatId,
    "📅 *RENOVACIONES*\n\n" +
      "Comandos:\n" +
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
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
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
// COMANDOS INVENTARIO (CRUD)
// ===============================
bot.onText(/\/add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/);

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
    clave = "";
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

  const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);
  await ref.set(
    {
      disp: nuevoDisp,
      estado: nuevoDisp <= 0 ? "llena" : "activa",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(nuevoDisp <= 0 ? "llena" : "activa")}*`,
    { parse_mode: "Markdown" }
  );
});

// /buscar texto
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim().toLowerCase();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  const invSnap = await db.collection("inventario").where("correo", "==", q).get();

  const cliSnap = await db.collection("clientes").limit(1500).get();
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
    texto += `\n📌 Para ver ficha: /cliente TELEFONO`;
  }

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

// ===============================
// CLIENTES (MULTI SERVICIOS)
// ===============================
function wizardReset(chatId) {
  wizard.delete(String(chatId));
}

async function wizardStart(chatId) {
  wizard.set(String(chatId), { step: 1, data: { servicios: [] } });
  return bot.sendMessage(chatId, "👥 NUEVO CLIENTE (1/4)\nEscriba: *Nombre*", { parse_mode: "Markdown" });
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
      return bot.sendMessage(chatId, "👥 (2/4) Telefono:");
    case 2:
      d.telefono = t;
      st.step = 3;
      return bot.sendMessage(chatId, "👥 (3/4) Vendedor (ej: Sublicuentas, Relojes, Geissel...):");
    case 3:
      d.vendedor = t;
      st.step = 4;
      return bot.sendMessage(
        chatId,
        "👥 (4/4) Primer servicio en 1 linea:\nplataforma correo pin precio dd/mm/yyyy\nEj:\nnetflix correo@outlook.com 1234 150 24/03/2026"
      );
    case 4: {
      const parts = t.split(/\s+/);
      if (parts.length < 5) return bot.sendMessage(chatId, "⚠️ Formato invalido. Intente otra vez (5 datos).");

      const plataforma = normalizarPlataforma(parts[0]);
      const correo = String(parts[1] || "").toLowerCase();
      const pin = String(parts[2] || "");
      const precio = Number(parts[3] || 0);
      const fecha = String(parts[4] || "");

      if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
      if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");
      if (!Number.isFinite(precio) || precio <= 0) return bot.sendMessage(chatId, "⚠️ Precio invalido.");
      if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Fecha invalida (dd/mm/yyyy).");

      const servicios = [
        { plataforma, correo, pin, precio, fechaRenovacion: fecha, lastRenew: null },
      ];

      const ref = await db.collection("clientes").add({
        nombrePerfil: d.nombrePerfil,
        telefono: d.telefono,
        vendedor: d.vendedor,
        // campos “rapidos” (primer servicio)
        plataforma,
        correo,
        pin,
        precio,
        fechaRenovacion: fecha,
        servicios,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      wizardReset(chatId);
      return enviarFichaCliente(chatId, ref.id);
    }
    default:
      wizardReset(chatId);
      return;
  }
}

// /cliente TELEFONO  -> abre ficha visual
bot.onText(/\/cliente\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const tel = String(match[1] || "").trim();
  const snap = await db.collection("clientes").where("telefono", "==", tel).limit(1).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado con ese telefono.");

  return enviarFichaCliente(chatId, snap.docs[0].id);
});

async function enviarFichaCliente(chatId, clientId) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];

  let t = "✅ *CLIENTE AGREGADO*\n\n";
  t += "*DATOS DEL CLIENTE*\n";
  t += `• Nombre: ${c.nombrePerfil || "-"}\n`;
  t += `• Telefono: ${c.telefono || "-"}\n`;
  t += `• Vendedor: ${c.vendedor || "-"}\n\n`;

  t += "*SERVICIOS:*\n";
  if (servicios.length === 0) {
    t += "• (Sin servicios)\n";
  } else {
    servicios.forEach((s, i) => {
      t += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`;
    });
  }

  return bot.sendMessage(chatId, t, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Agregar plataforma", callback_data: `cli:addsvc:${clientId}` }],
        [
          { text: "🔄 Renovar", callback_data: `cli:ren:${clientId}` },
          { text: "↩️ Anular", callback_data: `cli:anular:${clientId}` },
        ],
        [{ text: "❌ Eliminar perfil", callback_data: `cli:delsvc:${clientId}` }],
        [{ text: "✏️ Editar cliente", callback_data: `cli:edit:${clientId}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
}

// /addsub TELEFONO plataforma correo pin precio dd/mm/yyyy
bot.onText(
  /\/addsub\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{2}\/\d{2}\/\d{4})/i,
  async (msg, match) => {
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

    const snap = await db.collection("clientes").where("telefono", "==", telefono).limit(1).get();
    if (snap.empty) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado por telefono.");

    const ref = snap.docs[0].ref;
    const d = snap.docs[0].data();
    const servicios = Array.isArray(d.servicios) ? d.servicios : [];

    servicios.push({ plataforma, correo, pin, precio, fechaRenovacion: fecha, lastRenew: null });

    await ref.set(
      { servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return enviarFichaCliente(chatId, snap.docs[0].id);
  }
);

// ===============================
// RENOVAR / ANULAR (por ficha)
// ===============================
// Renovar: pide nueva fecha dd/mm/yyyy y guarda lastRenew
async function renovarServicio(clientId, plataforma, nuevaFecha) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return { ok: false, msg: "Cliente no encontrado." };

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const idx = servicios.findIndex((s) => normalizarPlataforma(s.plataforma) === normalizarPlataforma(plataforma));
  if (idx === -1) return { ok: false, msg: "Servicio no encontrado." };

  const antes = String(servicios[idx].fechaRenovacion || "");
  servicios[idx].lastRenew = {
    fechaAntes: antes,
    fechaDespues: nuevaFecha,
    at: new Date().toISOString(),
  };
  servicios[idx].fechaRenovacion = nuevaFecha;

  // también reflejamos campos rápidos si coincide con el primer servicio
  await ref.set(
    {
      servicios,
      // sync “rápidos” al primer servicio siempre
      plataforma: servicios[0]?.plataforma || c.plataforma || "",
      correo: servicios[0]?.correo || c.correo || "",
      pin: servicios[0]?.pin || c.pin || "",
      precio: servicios[0]?.precio || c.precio || 0,
      fechaRenovacion: servicios[0]?.fechaRenovacion || c.fechaRenovacion || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, antes, despues: nuevaFecha };
}

// Anular: revierte si existe lastRenew
async function anularRenovacionServicio(clientId, plataforma) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return { ok: false, msg: "Cliente no encontrado." };

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const idx = servicios.findIndex((s) => normalizarPlataforma(s.plataforma) === normalizarPlataforma(plataforma));
  if (idx === -1) return { ok: false, msg: "Servicio no encontrado." };

  const lr = servicios[idx].lastRenew;
  if (!lr || !lr.fechaAntes) return { ok: false, msg: "Ese servicio no tiene una renovacion reciente para anular." };

  const volverA = lr.fechaAntes;
  servicios[idx].fechaRenovacion = volverA;
  servicios[idx].lastRenew = null;

  await ref.set(
    {
      servicios,
      plataforma: servicios[0]?.plataforma || c.plataforma || "",
      correo: servicios[0]?.correo || c.correo || "",
      pin: servicios[0]?.pin || c.pin || "",
      precio: servicios[0]?.precio || c.precio || 0,
      fechaRenovacion: servicios[0]?.fechaRenovacion || c.fechaRenovacion || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, volverA };
}

// ===============================
// ELIMINAR SERVICIO (por ficha)
// ===============================
async function eliminarServicio(clientId, plataforma) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return { ok: false, msg: "Cliente no encontrado." };

  const c = doc.data() || {};
  let servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const before = servicios.length;

  servicios = servicios.filter((s) => normalizarPlataforma(s.plataforma) !== normalizarPlataforma(plataforma));
  if (servicios.length === before) return { ok: false, msg: "Servicio no encontrado." };

  await ref.set(
    {
      servicios,
      plataforma: servicios[0]?.plataforma || "",
      correo: servicios[0]?.correo || "",
      pin: servicios[0]?.pin || "",
      precio: servicios[0]?.precio || 0,
      fechaRenovacion: servicios[0]?.fechaRenovacion || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
}

// ===============================
// TXT GENERAL CLIENTES
// ===============================
async function enviarClientesTXT(chatId) {
  const snap = await db.collection("clientes").limit(5000).get();
  const list = snap.docs.map((d) => d.data() || {}).filter((x) => x.telefono);

  // orden por nombre
  list.sort((a, b) =>
    String(a.nombrePerfil || "").toLowerCase().localeCompare(String(b.nombrePerfil || "").toLowerCase())
  );

  let body = "REPORTE GENERAL CLIENTES\n\n";
  body += `TOTAL: ${list.length}\n\n`;

  list.forEach((c, i) => {
    const n = String(i + 1).padStart(2, "0");
    body += `${n}) ${c.nombrePerfil || "-"} | ${c.telefono || "-"}\n`;
  });

  const filePath = path.join(__dirname, `clientes_general_${hoyDMY().replaceAll("/", "-")}.txt`);
  fs.writeFileSync(filePath, body, "utf8");
  await bot.sendDocument(chatId, filePath);
  try {
    fs.unlinkSync(filePath);
  } catch (e) {}
}

// /clientes_txt
bot.onText(/\/clientes_txt/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return enviarClientesTXT(chatId);
});

// ===============================
// RENOVACIONES + TXT (GENERAL / POR NOMBRE)
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
        const vendOk = !vendedorOpt || vendedor.toLowerCase() === vendedorOpt.toLowerCase();
        if (vendOk) {
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

// /renovaciones hoy | /renovaciones dd/mm/yyyy | /renovaciones NOMBRE dd/mm/yyyy
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

// /txt hoy | /txt dd/mm/yyyy | /txt NOMBRE dd/mm/yyyy
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
    await bot.answerCallbackQuery(q.id);
    if (!chatId) return;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    // Inicio
    if (data === "go:inicio") return menuPrincipal(chatId);

    // Menus
    if (data === "menu:inventario") return menuInventario(chatId);
    if (data === "menu:clientes") return menuClientes(chatId);
    if (data === "menu:pagos") return menuPagos(chatId);
    if (data === "menu:renovaciones") return menuRenovaciones(chatId);
    if (data === "menu:buscar") return bot.sendMessage(chatId, "🔎 Use: /buscar texto");

    // Inventario
    if (data === "inv:general") return mostrarStockGeneral(chatId);
    if (data.startsWith("inv:")) {
      const [, plat, pageStr] = data.split(":");
      return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
    }

    // Clientes menu
    if (data === "cli:nuevo") return wizardStart(chatId);
    if (data === "cli:buscar") return bot.sendMessage(chatId, "🔎 Use: /buscar nombre o telefono\n📌 Ficha: /cliente TELEFONO");
    if (data === "cli:txt") return enviarClientesTXT(chatId);

    // Renovaciones quick
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

    // Revendedores lista
    if (data === "rev:lista") return listarRevendedores(chatId);

    // ============ FICHA CLIENTE (acciones) ============
    // cli:addsvc:<id>
    if (data.startsWith("cli:addsvc:")) {
      const clientId = data.split(":")[2];
      pending.set(String(chatId), { type: "addsvc", clientId });
      return bot.sendMessage(
        chatId,
        "➕ AGREGAR PLATAFORMA\nEscriba en 1 linea:\nplataforma correo pin precio dd/mm/yyyy\nEj:\ncrunchyroll correo@x.com 1234 120 10/03/2026"
      );
    }

    // cli:edit:<id> => submenu editar
    if (data.startsWith("cli:edit:")) {
      const clientId = data.split(":")[2];
      return bot.sendMessage(chatId, "✏️ *EDITAR CLIENTE*", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧑 Cambiar nombre", callback_data: `cli:editname:${clientId}` }],
            [{ text: "📱 Cambiar teléfono", callback_data: `cli:edittel:${clientId}` }],
            [{ text: "👨‍💼 Cambiar vendedor", callback_data: `cli:editvend:${clientId}` }],
            [{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }],
          ],
        },
      });
    }

    if (data.startsWith("cli:view:")) {
      const clientId = data.split(":")[2];
      return enviarFichaCliente(chatId, clientId);
    }

    if (data.startsWith("cli:editname:")) {
      const clientId = data.split(":")[2];
      pending.set(String(chatId), { type: "editname", clientId });
      return bot.sendMessage(chatId, "🧑 Escriba el *nuevo nombre*:", { parse_mode: "Markdown" });
    }

    if (data.startsWith("cli:edittel:")) {
      const clientId = data.split(":")[2];
      pending.set(String(chatId), { type: "edittel", clientId });
      return bot.sendMessage(chatId, "📱 Escriba el *nuevo teléfono*:", { parse_mode: "Markdown" });
    }

    if (data.startsWith("cli:editvend:")) {
      const clientId = data.split(":")[2];
      pending.set(String(chatId), { type: "editvend", clientId });
      return bot.sendMessage(chatId, "👨‍💼 Escriba el *nuevo vendedor*:", { parse_mode: "Markdown" });
    }

    // Renovar: elegir servicio
    if (data.startsWith("cli:ren:")) {
      const clientId = data.split(":")[2];
      const doc = await db.collection("clientes").doc(String(clientId)).get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      if (servicios.length === 0) return bot.sendMessage(chatId, "⚠️ Ese cliente no tiene servicios.");

      const kb = servicios.map((s) => [{ text: `🔄 Renovar ${s.plataforma}`, callback_data: `cli:renpick:${clientId}:${normalizarPlataforma(s.plataforma)}` }]);
      kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);

      return bot.sendMessage(chatId, "🔄 *RENOVAR SERVICIO*\nSeleccione plataforma:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: kb },
      });
    }

    // renovar pick -> pedir fecha
    if (data.startsWith("cli:renpick:")) {
      const [, , clientId, plat] = data.split(":");
      pending.set(String(chatId), { type: "renovar", clientId, platform: plat });
      return bot.sendMessage(chatId, `🔄 Renovar *${plat}*\nEscriba nueva fecha (dd/mm/yyyy):`, { parse_mode: "Markdown" });
    }

    // ANULAR: elegir servicio
    if (data.startsWith("cli:anular:")) {
      const clientId = data.split(":")[2];
      const doc = await db.collection("clientes").doc(String(clientId)).get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      if (servicios.length === 0) return bot.sendMessage(chatId, "⚠️ Ese cliente no tiene servicios.");

      const kb = servicios.map((s) => [
        { text: `↩️ Anular ${s.plataforma}`, callback_data: `cli:anularpick:${clientId}:${normalizarPlataforma(s.plataforma)}` },
      ]);
      kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);

      let txt = "↩️ *ANULAR RENOVACION*\nSeleccione el servicio a deshacer:\n\n";
      servicios.forEach((s, i) => {
        txt += `${i + 1}) ${s.plataforma} — Renueva: ${s.fechaRenovacion}\n`;
      });

      return bot.sendMessage(chatId, txt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: kb } });
    }

    // anular pick -> ejecutar
    if (data.startsWith("cli:anularpick:")) {
      const [, , clientId, plat] = data.split(":");
      const r = await anularRenovacionServicio(clientId, plat);
      if (!r.ok) return bot.sendMessage(chatId, `⚠️ ${r.msg}`);
      await bot.sendMessage(chatId, `✅ Listo.\n${plat} volvio a: *${r.volverA}*`, { parse_mode: "Markdown" });
      return enviarFichaCliente(chatId, clientId);
    }

    // Eliminar perfil: elegir servicio
    if (data.startsWith("cli:delsvc:")) {
      const clientId = data.split(":")[2];
      const doc = await db.collection("clientes").doc(String(clientId)).get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      if (servicios.length === 0) return bot.sendMessage(chatId, "⚠️ Ese cliente no tiene servicios.");

      const kb = servicios.map((s) => [
        { text: `❌ Eliminar ${s.plataforma}`, callback_data: `cli:delpick:${clientId}:${normalizarPlataforma(s.plataforma)}` },
      ]);
      kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);

      return bot.sendMessage(chatId, "❌ *ELIMINAR PERFIL*\nSeleccione plataforma:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: kb },
      });
    }

    if (data.startsWith("cli:delpick:")) {
      const [, , clientId, plat] = data.split(":");
      const r = await eliminarServicio(clientId, plat);
      if (!r.ok) return bot.sendMessage(chatId, `⚠️ ${r.msg}`);
      await bot.sendMessage(chatId, `🗑️ Eliminado: ${plat}`);
      return enviarFichaCliente(chatId, clientId);
    }

    return bot.sendMessage(chatId, "⚠️ Accion no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// CAPTURA TEXTO (wizard + pending)
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";
  if (!chatId) return;

  // ignorar comandos
  if (text.startsWith("/")) return;

  // wizard
  if (wizard.has(String(chatId))) {
    if (!(await isAdmin(userId))) return;
    return wizardNext(chatId, text);
  }

  // pending actions
  const p = pending.get(String(chatId));
  if (!p) return;

  if (!(await isAdmin(userId))) return;

  const clientId = p.clientId;
  const ref = db.collection("clientes").doc(String(clientId));

  if (p.type === "addsvc") {
    const parts = String(text).trim().split(/\s+/);
    if (parts.length < 5) return bot.sendMessage(chatId, "⚠️ Formato invalido. Debe ser 5 datos.");

    const plataforma = normalizarPlataforma(parts[0]);
    const correo = String(parts[1] || "").toLowerCase();
    const pin = String(parts[2] || "");
    const precio = Number(parts[3] || 0);
    const fecha = String(parts[4] || "");

    if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma invalida.");
    if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo invalido.");
    if (!Number.isFinite(precio) || precio <= 0) return bot.sendMessage(chatId, "⚠️ Precio invalido.");
    if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Fecha invalida (dd/mm/yyyy).");

    const doc = await ref.get();
    if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

    const c = doc.data() || {};
    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    servicios.push({ plataforma, correo, pin, precio, fechaRenovacion: fecha, lastRenew: null });

    await ref.set(
      {
        servicios,
        plataforma: servicios[0]?.plataforma || "",
        correo: servicios[0]?.correo || "",
        pin: servicios[0]?.pin || "",
        precio: servicios[0]?.precio || 0,
        fechaRenovacion: servicios[0]?.fechaRenovacion || "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    pending.delete(String(chatId));
    return enviarFichaCliente(chatId, clientId);
  }

  if (p.type === "editname") {
    const nuevo = String(text).trim();
    if (!nuevo) return bot.sendMessage(chatId, "⚠️ Nombre invalido.");
    await ref.set({ nombrePerfil: nuevo, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    pending.delete(String(chatId));
    return enviarFichaCliente(chatId, clientId);
  }

  if (p.type === "edittel") {
    const nuevo = String(text).trim();
    if (!nuevo) return bot.sendMessage(chatId, "⚠️ Telefono invalido.");
    await ref.set({ telefono: nuevo, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    pending.delete(String(chatId));
    return enviarFichaCliente(chatId, clientId);
  }

  if (p.type === "editvend") {
    const nuevo = String(text).trim();
    if (!nuevo) return bot.sendMessage(chatId, "⚠️ Vendedor invalido.");
    await ref.set({ vendedor: nuevo, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    pending.delete(String(chatId));
    return enviarFichaCliente(chatId, clientId);
  }

  if (p.type === "renovar") {
    const nuevaFecha = String(text).trim();
    if (!isFechaDMY(nuevaFecha)) return bot.sendMessage(chatId, "⚠️ Formato invalido. Use dd/mm/yyyy.");
    const r = await renovarServicio(clientId, p.platform, nuevaFecha);
    if (!r.ok) return bot.sendMessage(chatId, `⚠️ ${r.msg}`);
    pending.delete(String(chatId));
    await bot.sendMessage(chatId, `✅ Renovado.\n${p.platform}: *${r.antes}* -> *${r.despues}*`, { parse_mode: "Markdown" });
    return enviarFichaCliente(chatId, clientId);
  }
});

// ===============================
// SERVIDOR HTTP (Render requiere puerto abierto)
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

// ===============================
// KEEP ALIVE LOG
// ===============================
setInterval(() => console.log("🟢 Bot activo..."), 60000);
