/**
 * ✅ SUBLICUENTAS TG BOT — INDEX FINAL (ACTUALIZADO + SIN ERRORES)
 *
 * ✅ MENÚ PRINCIPAL (INLINE):
 *   📦 Inventario | 👥 Clientes | 📅 Renovaciones | 🔎 Buscar | (Pagos queda para luego)
 *
 * ✅ INVENTARIO:
 *   - Por plataforma con paginación 10 en 10
 *   - Ordenado por MÁS perfiles libres primero
 *   - Botones: ⬅️ Atrás | 🏠 Inicio | ➡️ Siguiente
 *   - Stock General
 *   - Estado: "LLENA" (en vez de "BLOQUEADA")
 *   - Disney Premium (disneyp) = 6 perfiles (configurable en Firestore)
 *   - /add correo CLAVE plataforma disp [activa|llena]
 *   - /add viejo: correo plataforma disp [activa|llena]
 *   - /addp correo plataforma cantidad  (resta perfiles)
 *   - /addp correo cantidad             (si correo existe solo en 1 plataforma)
 *   - /delp correo plataforma cantidad  (suma perfiles)  (reactiva si sube >0)
 *   - /delp correo cantidad             (si correo existe solo en 1 plataforma)
 *   - /del  correo plataforma           (borra cuenta inventario)
 *   - /editclave correo plataforma NUEVA
 *   - ✅ FIX DISNEYP: búsqueda/addp/delp robusta (fallback scan) para correos “invisibles”
 *
 * ✅ CLIENTES:
 *   - Wizard nuevo cliente: Nombre → Teléfono → Vendedor → Servicio(s)
 *   - Un cliente puede tener VARIOS servicios (hasta 4 o más): array "servicios"
 *   - FICHA del cliente (sin ID visible):
 *     ➕ Agregar plataforma | 🔄 Renovar | ❌ Eliminar perfil | ✏️ Editar cliente | 🏠 Inicio
 *   - ✏️ Editar cliente:
 *     🧑 Cambiar nombre | 📱 Cambiar teléfono | 👨‍💼 Cambiar vendedor | 📅 Cambiar fecha (por plataforma)
 *   - Renovar servicio con confirmación final
 *   - Eliminar perfil por plataforma con confirmación
 *
 * ✅ RENOVACIONES + TXT:
 *   - /renovaciones hoy | /renovaciones dd/mm/yyyy | /renovaciones NOMBRE dd/mm/yyyy
 *   - /txt hoy | /txt dd/mm/yyyy | /txt NOMBRE dd/mm/yyyy
 *   - TXT sin acentos (limpio)
 *
 * ✅ REPORTE GENERAL CLIENTES TXT:
 *   - /clientes_txt   => 01) Nombre | Telefono
 *
 * ✅ BÚSQUEDA SIN ESCRIBIR /buscar:
 *   - Escribe SOLO el nombre / teléfono / correo (sin comando) y te abre ficha si hay 1 cliente
 *   - Si hay varios, te muestra botones para escoger
 *   - También se puede “/juan” o “/99999999” como búsqueda rápida (slash-search)
 *   - /buscar texto sigue existiendo como respaldo
 *
 * ✅ BOTONES “EDITAR CLAVE” EN INVENTARIO:
 *   - En cada página (10) salen botones “✏️ Clave 1…10”
 *   - Tocás y escribís la nueva clave → se guarda en ese correo+plataforma
 *
 * ⚠️ Render:
 *   - Este archivo debe llamarse EXACTO: index.js (raíz del repo) o ajusta Start Command.
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
  const e = String(estado || "").toLowerCase().trim();
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
function limpiarTexto(txt = "") {
  return String(txt || "").trim().replace(/\s+/g, " ");
}
function limpiarQuery(txt = "") {
  return limpiarTexto(txt).replace(/^\/+/, "").toLowerCase();
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

// Disney Premium = 6
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
// MAPS DE ESTADO (wizard / pending)
// ===============================
const wizard = new Map();   // chatId -> wizardState
const pending = new Map();  // chatId -> { mode, ... }

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
    "👥 *CLIENTES*\n\n" +
      "• ➕ Nuevo cliente\n" +
      "• 🔎 Buscar (escriba nombre/teléfono/correo)\n" +
      "• 📄 Reporte TXT general\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Nuevo cliente", callback_data: "cli:wiz:start" }],
          [{ text: "📄 Reporte TXT", callback_data: "cli:txt:general" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ],
      },
    }
  );
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
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ],
      },
    }
  );
}

// ===============================
// INVENTARIO — BÚSQUEDA ROBUSTA (FIX DISNEYP)
// ===============================
async function scanInventario(limit = 5000) {
  const snap = await db.collection("inventario").limit(limit).get();
  const out = [];
  snap.forEach((doc) => out.push({ id: doc.id, ...doc.data(), _ref: doc.ref }));
  return out;
}

async function findInventarioDocsRobusto({ correo, plataforma }) {
  const c = String(correo || "").trim().toLowerCase();
  const p = plataforma ? normalizarPlataforma(plataforma) : null;

  // 1) intento por docId (si plataforma viene)
  if (p) {
    const ref = db.collection("inventario").doc(docIdInventario(c, p));
    const doc = await ref.get();
    if (doc.exists) return [{ id: doc.id, ...doc.data(), _ref: ref }];
  }

  // 2) intento where exacto (rápido)
  try {
    let q = db.collection("inventario").where("correo", "==", c).limit(50);
    if (p) q = q.where("plataforma", "==", p);
    const exact = await q.get();
    if (!exact.empty) {
      return exact.docs.map((d) => ({ id: d.id, ...d.data(), _ref: d.ref }));
    }
  } catch (e) {
    // si falla por índices, seguimos con scan
  }

  // 3) fallback scan (evita “no me encuentra Disney aunque esté”)
  const all = await scanInventario(5000);
  return all.filter((x) => {
    const xc = String(x.correo || "").trim().toLowerCase();
    const xp = normalizarPlataforma(x.plataforma || "");
    if (p) return xc === c && xp === p;
    return xc === c;
  });
}

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

  return { texto, safePage, totalPages, slice, start };
}

async function enviarInventarioPlataforma(chatId, plataforma, page) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

  const { texto, safePage, totalPages, slice, start } = await inventarioPlataformaTexto(p, page);
  const canBack = safePage > 0;
  const canNext = safePage < totalPages - 1;

  // Botones: Atrás | Inicio | Siguiente
  const kb = [
    [
      { text: "⬅️ Atrás", callback_data: canBack ? `inv:${p}:${safePage - 1}` : "noop" },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
      { text: "➡️ Siguiente", callback_data: canNext ? `inv:${p}:${safePage + 1}` : "noop" },
    ],
    [{ text: "🔄 Actualizar", callback_data: `inv:${p}:${safePage}` }],
  ];

  // Botones para editar clave por cada item mostrado (máx 10)
  // callback_data: inv:editclave:<plataforma>:<indexLocal>
  // guardamos el "contexto de página" en pending por chat (para saber qué correo es cada #)
  pending.set(String(chatId), { mode: "invPageCtx", plataforma: p, page: safePage, slice });

  const editRow = [];
  for (let i = 0; i < slice.length; i++) {
    editRow.push({ text: `✏️ Clave ${i + 1}`, callback_data: `inv:editclave:${p}:${i}` });
    if (editRow.length === 3) {
      kb.push([...editRow]);
      editRow.length = 0;
    }
  }
  if (editRow.length) kb.push([...editRow]);

  kb.push([{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }]);

  return bot.sendMessage(chatId, texto, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: kb },
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
// INVENTARIO (CRUD)
// ===============================

// /add correo CLAVE plataforma disp [activa|llena]
// /add viejo: correo plataforma disp [activa|llena]
bot.onText(/\/add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = limpiarTexto(match[1] || "");
  const parts = raw.split(/\s+/);

  if (parts.length < 3) {
    return bot.sendMessage(chatId, "⚠️ Uso: /add correo CLAVE plataforma disp [activa|llena]\nO viejo: /add correo plataforma disp [activa|llena]");
  }

  let correo = "";
  let clave = "";
  let plataforma = "";
  let dispStr = "";
  let estadoInput = "";

  // Detectar formato viejo: correo plataforma disp [estado]
  if (parts[0]?.includes("@") && esPlataformaValida(parts[1]) && /^\d+$/.test(parts[2])) {
    correo = parts[0];
    plataforma = parts[1];
    dispStr = parts[2];
    estadoInput = parts[3] || "activa";
    clave = "";
  } else {
    // Nuevo: correo clave plataforma disp [estado]
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
  const estado = (estadoInput === "llena" || estadoInput === "bloqueada") ? "llena" : "activa";

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
    clave: clave ? String(clave) : (prev.exists ? String(prev.data()?.clave || "") : ""),
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
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  await ref.delete();
  return bot.sendMessage(chatId, `🗑️ Eliminada: ${plataforma.toUpperCase()} — ${correo}`);
});

// /editclave correo plataforma NUEVA
bot.onText(/\/editclave\s+(\S+)\s+(\S+)\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const nueva = limpiarTexto(match[3] || "");

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /editclave correo plataforma NUEVA_CLAVE");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!nueva) return bot.sendMessage(chatId, "⚠️ Falta la clave.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  await ref.set({ clave: nueva, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return bot.sendMessage(chatId, `✅ Clave actualizada\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${nueva}`);
});

// /addp correo plataforma cantidad   (RESTAR)
bot.onText(/\/addp\s+(\S+)\s+(\S+)\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const qty = Number(match[3] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo plataforma cantidad");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida.");

  // ✅ robust: encontrar aunque “where” no lo vea
  const found = await findInventarioDocsRobusto({ correo, plataforma });
  if (!found.length) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  const x = found[0];
  const ref = x._ref || db.collection("inventario").doc(x.id);
  const d = x;
  const total = await getTotalPorPlataforma(plataforma);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - qty);

  await ref.set({ disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLleno(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : (d.estado || "activa");

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

// /addp correo [cantidad]  (si existe solo en 1 plataforma)
bot.onText(/\/addp\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const qty = Number(match[2] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo [cantidad]");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida.");

  const found = await findInventarioDocsRobusto({ correo, plataforma: null });
  if (!found.length) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  // si hay varias plataformas
  const uniquePlats = [...new Set(found.map((x) => normalizarPlataforma(x.plataforma || "")))];
  if (uniquePlats.length > 1) {
    let t = "⚠️ Ese correo aparece en varias plataformas.\nUse:\n/addp correo plataforma cantidad\n\nOpciones:\n";
    uniquePlats.forEach((p) => (t += `• ${p.toUpperCase()}\n`));
    return bot.sendMessage(chatId, t);
  }

  const x = found[0];
  const plataforma = normalizarPlataforma(x.plataforma || "");
  const ref = x._ref || db.collection("inventario").doc(x.id);
  const total = await getTotalPorPlataforma(plataforma);

  const antes = { ...x };
  const nuevoDisp = Math.max(0, Number(x.disp || 0) - qty);

  await ref.set({ disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const despues = { ...x, disp: nuevoDisp };
  await aplicarAutoLleno(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : (x.estado || "activa");

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

// /delp correo plataforma cantidad  (SUMAR)
bot.onText(/\/delp\s+(\S+)\s+(\S+)\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const qty = Number(match[3] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo plataforma cantidad");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida.");

  const found = await findInventarioDocsRobusto({ correo, plataforma });
  if (!found.length) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  const x = found[0];
  const ref = x._ref || db.collection("inventario").doc(x.id);
  const total = await getTotalPorPlataforma(plataforma);

  const nuevoDisp = Number(x.disp || 0) + qty;

  await ref.set(
    {
      disp: nuevoDisp,
      estado: nuevoDisp > 0 ? "activa" : (x.estado || "activa"),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(nuevoDisp > 0 ? "activa" : x.estado)}*`,
    { parse_mode: "Markdown" }
  );
});

// /delp correo [cantidad]  (si existe solo en 1 plataforma)
bot.onText(/\/delp\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const qty = Number(match[2] || 1);

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo [cantidad]");
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida.");

  const found = await findInventarioDocsRobusto({ correo, plataforma: null });
  if (!found.length) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  const uniquePlats = [...new Set(found.map((x) => normalizarPlataforma(x.plataforma || "")))];
  if (uniquePlats.length > 1) {
    let t = "⚠️ Ese correo aparece en varias plataformas.\nUse:\n/delp correo plataforma cantidad\n\nOpciones:\n";
    uniquePlats.forEach((p) => (t += `• ${p.toUpperCase()}\n`));
    return bot.sendMessage(chatId, t);
  }

  const x = found[0];
  const plataforma = normalizarPlataforma(x.plataforma || "");
  const ref = x._ref || db.collection("inventario").doc(x.id);
  const total = await getTotalPorPlataforma(plataforma);

  const nuevoDisp = Number(x.disp || 0) + qty;
  await ref.set(
    {
      disp: nuevoDisp,
      estado: nuevoDisp > 0 ? "activa" : (x.estado || "activa"),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(nuevoDisp > 0 ? "activa" : x.estado)}*`,
    { parse_mode: "Markdown" }
  );
});

// ===============================
// CLIENTES — ESTRUCTURA + WIZARD
// ===============================
// Colección: clientes (docId = telefono) para que sea fácil.
// Campos: nombrePerfil, telefono, vendedor, servicios[]
// servicios: [{ plataforma, correo, pin, precio, fechaRenovacion }]

function wGet(chatId) { return wizard.get(String(chatId)); }
function wSet(chatId, st) { wizard.set(String(chatId), st); }
function wClear(chatId) { wizard.delete(String(chatId)); }

async function wizardStart(chatId) {
  wSet(chatId, { step: 1, data: {}, clientId: null, servStep: 0, servicio: null });
  return bot.sendMessage(chatId, "👥 *NUEVO CLIENTE*\n\n(1/3) Escriba *Nombre*:", { parse_mode: "Markdown" });
}

async function pedirPlataformaServicio(chatId, clientId) {
  return bot.sendMessage(chatId, "📌 Servicio (1/5)\nSeleccione plataforma:", {
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
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
}

async function wizardNext(chatId, text) {
  const st = wGet(chatId);
  if (!st) return;

  const t = limpiarTexto(text);

  // Nombre
  if (st.step === 1) {
    st.data.nombrePerfil = t;
    st.step = 2;
    wSet(chatId, st);
    return bot.sendMessage(chatId, "(2/3) Escriba *Teléfono*:", { parse_mode: "Markdown" });
  }

  // Teléfono
  if (st.step === 2) {
    st.data.telefono = t;
    st.clientId = String(t).trim(); // docId = teléfono
    st.step = 3;
    wSet(chatId, st);
    return bot.sendMessage(chatId, "(3/3) Escriba *Vendedor*:", { parse_mode: "Markdown" });
  }

  // Vendedor -> crea cliente base y pasa a servicio
  if (st.step === 3) {
    st.data.vendedor = t;

    const ref = db.collection("clientes").doc(st.clientId);
    await ref.set(
      {
        nombrePerfil: st.data.nombrePerfil,
        telefono: st.data.telefono,
        vendedor: st.data.vendedor,
        servicios: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    st.step = 4;
    st.servStep = 1;
    st.servicio = {};
    wSet(chatId, st);

    await bot.sendMessage(chatId, "✅ Cliente creado.\n\nAhora agreguemos el servicio.");
    return pedirPlataformaServicio(chatId, st.clientId);
  }

  // Servicio por texto (correo, pin, precio, fecha)
  if (st.step === 4) {
    const s = st.servicio || {};

    // correo
    if (st.servStep === 2) {
      if (!t.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido. Escriba el correo:");
      s.correo = t.toLowerCase().trim();
      st.servStep = 3;
      st.servicio = s;
      wSet(chatId, st);
      return bot.sendMessage(chatId, "📌 Servicio (3/5) Pin/Clave del perfil:");
    }

    // pin
    if (st.servStep === 3) {
      s.pin = t;
      st.servStep = 4;
      st.servicio = s;
      wSet(chatId, st);
      return bot.sendMessage(chatId, "📌 Servicio (4/5) Precio (solo número, Lps):");
    }

    // precio
    if (st.servStep === 4) {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
      s.precio = n;
      st.servStep = 5;
      st.servicio = s;
      wSet(chatId, st);
      return bot.sendMessage(chatId, "📌 Servicio (5/5) Fecha renovación (dd/mm/yyyy):");
    }

    // fecha -> guarda servicio, muestra resumen y opciones
    if (st.servStep === 5) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");
      s.fechaRenovacion = t;

      const ref = db.collection("clientes").doc(st.clientId);
      const doc = await ref.get();
      const cur = doc.exists ? (doc.data() || {}) : {};
      const arr = Array.isArray(cur.servicios) ? cur.servicios : [];

      arr.push({
        plataforma: s.plataforma,
        correo: s.correo,
        pin: s.pin,
        precio: s.precio,
        fechaRenovacion: s.fechaRenovacion,
      });

      await ref.set({ servicios: arr, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      // preparar para agregar otro servicio
      st.servicio = {};
      st.servStep = 1;
      wSet(chatId, st);

      let resumen = `✅ *Cliente agregado*\n\n`;
      resumen += `*Datos del cliente:*\n`;
      resumen += `${cur.nombrePerfil || st.data.nombrePerfil}\n${cur.telefono || st.clientId}\n${cur.vendedor || st.data.vendedor}\n\n`;
      resumen += `*SERVICIOS:*\n`;
      resumen += arr
        .map((x, i) => `${i + 1}) ${x.plataforma} — ${x.correo} — ${x.precio} Lps — Renueva: ${x.fechaRenovacion}`)
        .join("\n");

      return bot.sendMessage(chatId, resumen, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Agregar otra plataforma", callback_data: `wiz:addmore:${st.clientId}` }],
            [{ text: "✅ Finalizar", callback_data: `wiz:finish:${st.clientId}` }],
          ],
        },
      });
    }
  }
}

// ===============================
// CLIENTES — FICHA (SIN ID VISIBLE)
// ===============================
async function obtenerCliente(clientId) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function enviarFichaCliente(chatId, clientId) {
  const c = await obtenerCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];

  let txt = `✅ *Cliente*\n`;
  txt += `*Datos del cliente:*\n`;
  txt += `${c.nombrePerfil || "-"}\n`;
  txt += `${c.telefono || "-"}\n`;
  txt += `${c.vendedor || "-"}\n\n`;
  txt += `*SERVICIOS:*\n`;

  if (!servicios.length) {
    txt += `— Sin servicios —\n`;
  } else {
    servicios.forEach((s, i) => {
      txt += `${i + 1}) ${s.plataforma} — ${s.correo} — ${Number(s.precio || 0)} Lps — Renueva: ${s.fechaRenovacion}\n`;
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
// CLIENTES — MENÚS: Renovar / Eliminar / Editar
// ===============================
async function menuPickServicio(chatId, clientId, mode) {
  const c = await obtenerCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Cliente sin servicios.");

  const kb = servicios.map((s, idx) => [
    {
      text: `${mode === "ren" ? "🔄 Renovar" : "❌ Eliminar"} ${s.plataforma}`,
      callback_data: `cli:${mode}:svc:${clientId}:${idx}`,
    },
  ]);
  kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);

  return bot.sendMessage(
    chatId,
    mode === "ren" ? "🔄 *RENOVAR SERVICIO*\nSeleccione plataforma:" : "❌ *ELIMINAR PERFIL*\nSeleccione plataforma:",
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: kb } }
  );
}

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
  const c = await obtenerCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Cliente sin servicios.");

  const kb = servicios.map((s, idx) => [
    { text: `📅 ${s.plataforma} (actual: ${s.fechaRenovacion || "-"})`, callback_data: `cli:edit:fecha:set:${clientId}:${idx}` },
  ]);
  kb.push([{ text: "⬅️ Volver", callback_data: `cli:edit:menu:${clientId}` }]);

  return bot.sendMessage(chatId, "📅 Seleccione el servicio para cambiar fecha:", {
    reply_markup: { inline_keyboard: kb },
  });
}

// ===============================
// RENOVACIONES + TXT
// ===============================
async function obtenerRenovacionesPorFecha(fechaDMY, vendedorOpt) {
  const snap = await db.collection("clientes").limit(8000).get();
  const out = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const vendedor = String(c.vendedor || "").trim();
    const servicios = Array.isArray(c.servicios) ? c.servicios : [];

    for (const s of servicios) {
      if (String(s.fechaRenovacion || "").trim() === fechaDMY) {
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

  if (!list || !list.length) {
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
  body += vendedorOpt
    ? `RENOVACIONES ${fechaDMY} - ${stripAcentos(vendedorOpt)}\n\n`
    : `RENOVACIONES ${fechaDMY} - GENERAL\n\n`;

  if (!list || !list.length) {
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

// /renovaciones hoy | dd/mm/yyyy | NOMBRE dd/mm/yyyy
bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const arg = limpiarTexto(match[1] || "");
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

// /txt hoy | dd/mm/yyyy | NOMBRE dd/mm/yyyy
bot.onText(/\/txt(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const arg = limpiarTexto(match[1] || "");
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
// REPORTE GENERAL CLIENTES TXT
// ===============================
bot.onText(/\/clientes_txt/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const snap = await db.collection("clientes").limit(8000).get();
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
// BÚSQUEDA CLIENTES (robusta)
// ===============================
async function buscarClientesRobusto(queryLower) {
  const q = String(queryLower || "").trim().toLowerCase();
  if (!q) return [];

  // 1) teléfono exacto
  if (esTelefono(q)) {
    const doc = await db.collection("clientes").doc(q).get();
    if (doc.exists) return [{ id: doc.id, ...doc.data() }];

    const snapTel = await db.collection("clientes").where("telefono", "==", q).limit(10).get();
    if (!snapTel.empty) return snapTel.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // 2) scan por nombre / vendedor / correo en servicios
  const snap = await db.collection("clientes").limit(8000).get();
  const out = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const nombre = String(c.nombrePerfil || "").toLowerCase();
    const tel = String(c.telefono || "").toLowerCase();
    const vend = String(c.vendedor || "").toLowerCase();

    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    const hitServicio = servicios.some((s) => {
      const sc = String(s.correo || "").toLowerCase();
      const sp = String(s.plataforma || "").toLowerCase();
      return sc.includes(q) || sp.includes(q);
    });

    if (nombre.includes(q) || tel.includes(q) || vend.includes(q) || hitServicio) {
      out.push({ id: doc.id, ...c });
    }
  });

  // ordenar (exacto primero)
  out.sort((a, b) => {
    const an = String(a.nombrePerfil || "").toLowerCase();
    const bn = String(b.nombrePerfil || "").toLowerCase();
    const aExact = an === q ? 1 : 0;
    const bExact = bn === q ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return an.localeCompare(bn);
  });

  return out.slice(0, 10);
}

async function resolverBusqueda(chatId, userId, rawQuery) {
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = limpiarQuery(rawQuery);
  if (!q) return;

  // correo => inventario
  if (q.includes("@")) {
    const inv = await findInventarioDocsRobusto({ correo: q, plataforma: null });
    if (!inv.length) {
      // también intentamos cliente por correo
      const clis = await buscarClientesRobusto(q);
      if (!clis.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
      if (clis.length === 1) return enviarFichaCliente(chatId, clis[0].id);
      const kb = clis.map((c) => [{ text: `👤 ${c.nombrePerfil || "-"} (${c.telefono || "-"})`, callback_data: `cli:view:${c.id}` }]);
      kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
      return bot.sendMessage(chatId, "🔎 Seleccione el cliente:", { reply_markup: { inline_keyboard: kb } });
    }

    let t = `🔎 *RESULTADO INVENTARIO*\n\n`;
    inv.slice(0, 10).forEach((x, i) => {
      t += `${i + 1}) ${String(x.plataforma || "").toUpperCase()} — ${x.correo} — 🔑 ${x.clave || "-"} — disp: ${x.disp} — ${fmtEstado(x.estado)}\n`;
    });

    return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
  }

  // teléfono o nombre => cliente
  const clis = await buscarClientesRobusto(q);
  if (!clis.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");

  if (clis.length === 1) return enviarFichaCliente(chatId, clis[0].id);

  const kb = clis.map((c) => [
    { text: `👤 ${c.nombrePerfil || "-"} (${c.telefono || "-"})`, callback_data: `cli:view:${c.id}` },
  ]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, "🔎 Seleccione el cliente:", { reply_markup: { inline_keyboard: kb } });
}

// /buscar texto (respaldo)
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  return resolverBusqueda(msg.chat.id, msg.from.id, match[1] || "");
});

// “/juan” o “/99999999” como búsqueda rápida (sin escribir /buscar)
// (excluye comandos reales)
bot.onText(
  /^\/(?!start|menu|stock|add|del|addp|delp|editclave|renovaciones|txt|clientes_txt|revadd|revdel|netflix|disneyp|disneys|hbomax|primevideo|paramount|crunchyroll)(.+)$/i,
  async (msg, match) => {
    return resolverBusqueda(msg.chat.id, msg.from.id, match[1] || "");
  }
);

// Escribir “solo texto” (sin comando) => búsqueda automática (si no está wizard/pending)
bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";
  if (!chatId) return;

  // si es comando, no
  if (text.startsWith("/")) return;

  // wizard activo
  if (wizard.has(String(chatId))) {
    if (!(await isAdmin(userId))) return;
    return wizardNext(chatId, text);
  }

  // pending: editar/renovar/etc
  if (pending.has(String(chatId))) {
    if (!(await isAdmin(userId))) return;

    const p = pending.get(String(chatId));
    const t = limpiarTexto(text);

    // inventario: esperando clave nueva
    if (p.mode === "invEditClave") {
      const { correo, plataforma } = p;
      pending.delete(String(chatId));

      const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

      await ref.set({ clave: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return bot.sendMessage(chatId, `✅ Clave actualizada\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${t}`);
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

    // editar teléfono (mover docId)
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

    // renovar: capturar fecha y pedir confirmación
    if (p.mode === "renFecha") {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");

      pending.delete(String(chatId));
      return bot.sendMessage(chatId, `🔄 Confirmar renovación a fecha: *${t}* ?`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Confirmar", callback_data: `cli:ren:confirm:${p.clientId}:${p.servicioIndex}:${t}` }],
            [{ text: "⬅️ Cancelar", callback_data: `cli:view:${p.clientId}` }],
          ],
        },
      });
    }
  }

  // Si no wizard/pending, búsqueda automática
  return resolverBusqueda(chatId, userId, text);
});

// ===============================
// START + MENÚ
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

// Atajos por plataforma (ej /netflix)
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
    await bot.answerCallbackQuery(q.id); // ✅ evita “Error” al presionar botones
    if (!chatId) return;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    // navegación principal
    if (data === "go:inicio") return menuPrincipal(chatId);
    if (data === "menu:inventario") return menuInventario(chatId);
    if (data === "menu:clientes") return menuClientes(chatId);
    if (data === "menu:renovaciones") return menuRenovaciones(chatId);
    if (data === "menu:buscar") return bot.sendMessage(chatId, "🔎 Escriba nombre / teléfono / correo (o /nombre).");

    // inventario
    if (data === "inv:general") return mostrarStockGeneral(chatId);
    if (data.startsWith("inv:") && !data.startsWith("inv:editclave:")) {
      const [, plat, pageStr] = data.split(":");
      return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
    }

    // inventario: editar clave por botón "Clave N"
    if (data.startsWith("inv:editclave:")) {
      const [, , plat, idxStr] = data.split(":");
      const idx = Number(idxStr);

      const ctx = pending.get(String(chatId));
      if (!ctx || ctx.mode !== "invPageCtx" || normalizarPlataforma(ctx.plataforma) !== normalizarPlataforma(plat)) {
        return bot.sendMessage(chatId, "⚠️ Contexto de página perdido. Presione 🔄 Actualizar.");
      }

      const slice = Array.isArray(ctx.slice) ? ctx.slice : [];
      if (idx < 0 || idx >= slice.length) return bot.sendMessage(chatId, "⚠️ Opción inválida.");

      const item = slice[idx];
      const correo = String(item.correo || "").trim().toLowerCase();
      const plataforma = normalizarPlataforma(plat);

      pending.set(String(chatId), { mode: "invEditClave", correo, plataforma });
      return bot.sendMessage(chatId, `✏️ Editar clave\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n\nEscriba la nueva clave:`);
    }

    // clientes: wizard iniciar
    if (data === "cli:wiz:start") return wizardStart(chatId);

    // clientes: reporte txt desde botón
    if (data === "cli:txt:general") {
      // llamar el comando directo
      const fakeMsg = { chat: { id: chatId }, from: { id: userId } };
      // invoca manual: copiamos lógica del comando
      const snap = await db.collection("clientes").limit(8000).get();
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
      return;
    }

    // wizard: elegir plataforma
    if (data.startsWith("wiz:plat:")) {
      const [, , plat, clientId] = data.split(":");
      const st = wGet(chatId);
      if (!st) return bot.sendMessage(chatId, "⚠️ Wizard no activo. Toque ➕ Nuevo cliente.");

      if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

      st.clientId = clientId;
      st.step = 4;
      st.servStep = 2; // ahora correo
      st.servicio = st.servicio || {};
      st.servicio.plataforma = normalizarPlataforma(plat);
      wSet(chatId, st);

      return bot.sendMessage(chatId, "📌 Servicio (2/5) Correo de la cuenta:");
    }

    if (data.startsWith("wiz:addmore:")) {
      const clientId = data.split(":")[2];
      const st = wGet(chatId);
      if (!st) return bot.sendMessage(chatId, "⚠️ Wizard no activo.");

      st.clientId = clientId;
      st.step = 4;
      st.servStep = 1;
      st.servicio = {};
      wSet(chatId, st);

      return pedirPlataformaServicio(chatId, clientId);
    }

    if (data.startsWith("wiz:finish:")) {
      const clientId = data.split(":")[2];
      wClear(chatId);
      return enviarFichaCliente(chatId, clientId);
    }

    // clientes: abrir ficha desde selección
    if (data.startsWith("cli:view:")) {
      const clientId = data.split(":")[2];
      return enviarFichaCliente(chatId, clientId);
    }

    // ficha: agregar servicio
    if (data.startsWith("cli:addsvc:")) {
      const clientId = data.split(":")[2];
      // mini wizard para solo servicio
      wSet(chatId, { step: 4, data: {}, clientId, servStep: 1, servicio: {} });
      return pedirPlataformaServicio(chatId, clientId);
    }

    // ficha: renovar
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

      await bot.sendMessage(chatId, "✅ Renovación aplicada.");
      return enviarFichaCliente(chatId, clientId);
    }

    // ficha: eliminar servicio
    if (data.startsWith("cli:del:pick:")) {
      const clientId = data.split(":")[3] || data.split(":")[2];
      return menuPickServicio(chatId, clientId, "del");
    }

    if (data.startsWith("cli:del:svc:")) {
      const [, , , clientId, idxStr] = data.split(":");
      const idx = Number(idxStr);

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

      await bot.sendMessage(chatId, "✅ Servicio eliminado.");
      return enviarFichaCliente(chatId, clientId);
    }

    // ficha: editar cliente
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
      const clientId = data.split(":")[4] || data.split(":")[3] || data.split(":")[2];
      return menuPickServicioFecha(chatId, clientId);
    }
    if (data.startsWith("cli:edit:fecha:set:")) {
      const parts = data.split(":");
      const clientId = parts[4];
      const idx = Number(parts[5]);
      pending.set(String(chatId), { mode: "editFechaServicio", clientId, servicioIndex: idx });
      return bot.sendMessage(chatId, "📅 Escriba la nueva fecha (dd/mm/yyyy):");
    }

    // renovaciones
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

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
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
