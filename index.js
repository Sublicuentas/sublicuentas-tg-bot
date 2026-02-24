/**
 * ✅ SUBLICUENTAS TG BOT — INDEX FINAL (ACTUALIZADO)
 * ✅ Nuevo Cliente con WIZARD MULTI-PLATAFORMA (varias suscripciones)
 * ✅ Eliminar perfil/servicio del cliente: /delperf (por telefono o por ID)
 * ✅ Ver cliente (suscripciones numeradas): /cliente (por telefono o por ID)
 *
 * Menus: Inventario | Clientes | Pagos | Renovaciones | Buscar
 * Inventario paginado (10): Atras | Inicio | Siguiente (Inicio = menu principal)
 * Estado: "LLENA" en vez de "BLOQUEADA"
 * Disney Premium = 6
 * /addp correo 3 (cantidad opcional)
 * /txt ...  /renovaciones ...
 * /editclave correo plataforma NUEVA_CLAVE
 * /del correo plataforma  (borrar cuenta inventario)
 * /buscar texto (cliente o cuenta)
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
      "🔎 Buscar cliente: /cliente telefono_o_id\n" +
      "🗑️ Eliminar perfil: /delperf telefono_o_id N\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Nuevo cliente", callback_data: "cli:nuevo" }],
          [{ text: "🔎 Ver/Buscar cliente", callback_data: "cli:buscar" }],
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
      "• Registrar pago (pendiente)\n" +
      "• Ultimos pagos (pendiente)\n",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
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
// AUTOLlENO (cuando llega a 0)
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
// INVENTARIO CRUD
// ===============================
bot.onText(/\/add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/);
  if (parts.length < 3) return bot.sendMessage(chatId, "⚠️ Uso: /add correo CLAVE plataforma disp [activa|llena]");

  let correo = "", clave = "", plataforma = "", dispStr = "", estadoInput = "";

  if (parts.length >= 4 && parts[2] && /\d+/.test(parts[3])) {
    // viejo: correo plataforma disp [estado]
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

// ===============================
// BUSQUEDA GENERAL
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim().toLowerCase();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  const invSnap = await db.collection("inventario").where("correo", "==", q).get();

  const cliSnap = await db.collection("clientes").limit(1200).get();
  const clientes = cliSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => {
      const nombre = String(c.nombrePerfil || "").toLowerCase();
      const tel = String(c.telefono || "").toLowerCase();
      const correo = String(c.correo || "").toLowerCase();
      return nombre.includes(q) || tel.includes(q) || correo.includes(q) || String(c.id).toLowerCase() === q;
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
      texto += `• ID: ${c.id}\n  ${c.nombrePerfil || "-"} — ${c.telefono || "-"} — ${c.vendedor || "-"}\n`;
    }
  }

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

// ===============================
// ADDP / DELP (cantidad opcional)
// ===============================
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

  await ref.set({ disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLleno(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : (d.estado || "activa");

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${fmtEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

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
// CLIENTES — WIZARD MULTI-PLATAFORMA
// ===============================
// clientes doc:
// nombrePerfil, telefono, vendedor, moneda:"Lps"
// suscripciones: [{ plataforma, correo, pin, precio, fechaRenovacion }]
// (y dejamos campos base espejo del primer perfil para compatibilidad: plataforma/correo/pin/precio/fechaRenovacion)
const wizard = new Map(); // chatId -> state

function wizardReset(chatId) {
  wizard.delete(String(chatId));
}

async function wizardStart(chatId) {
  wizard.set(String(chatId), {
    mode: "cliente_multi",
    step: 1,       // 1 nombre, 2 tel, 3 vendedor, luego subStep
    subStep: 0,    // 1 plat,2 correo,3 pin,4 precio,5 fecha
    data: {},
    suscripciones: [],
    pendingDecision: false,
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

async function wizardNext(chatId, text) {
  const st = wizard.get(String(chatId));
  if (!st) return;
  if (st.pendingDecision) return; // esperando boton

  const t = String(text || "").trim();

  // Datos base
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
    // arrancar primera suscripcion
    st.step = 4;
    return wizardPromptSuscripcion(chatId);
  }

  // Suscripcion
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

        // Guardar suscripcion en memoria
        st.suscripciones.push({ ...sub });

        // preguntar si agrega otra
        return wizardAskAddMore(chatId);

      default:
        return;
    }
  }
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

    // espejo del primero (compatibilidad con reportes)
    plataforma: first.plataforma,
    correo: first.correo,
    pin: first.pin,
    precio: first.precio,
    fechaRenovacion: first.fechaRenovacion,

    suscripciones: st.suscripciones,

    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const ref = await db.collection("clientes").add(payload);

  wizardReset(chatId);

  let resumen = `✅ Cliente agregado\nID: ${ref.id}\n${payload.nombrePerfil}\n${payload.telefono}\n${payload.vendedor}\n\nSERVICIOS:\n`;
  payload.suscripciones.forEach((s, i) => {
    resumen += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`;
  });

  return bot.sendMessage(chatId, resumen);
}

// ===============================
// COMANDOS CLIENTES
// ===============================

// /cliente telefono_o_id
bot.onText(/\/cliente\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim();

  // 1) por ID exacto
  const byId = await db.collection("clientes").doc(q).get();
  if (byId.exists) {
    const c = byId.data() || {};
    const sus = Array.isArray(c.suscripciones) ? c.suscripciones : [];
    let t = `👤 CLIENTE\nID: ${byId.id}\n${c.nombrePerfil || "-"}\n${c.telefono || "-"}\n${c.vendedor || "-"}\n\nSERVICIOS:\n`;
    if (sus.length === 0) t += "⚠️ Sin servicios.\n";
    else sus.forEach((s, i) => (t += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`));
    t += `\n🗑️ Eliminar: /delperf ${byId.id} N`;
    return bot.sendMessage(chatId, t);
  }

  // 2) por telefono exacto
  const snap = await db.collection("clientes").where("telefono", "==", q).limit(1).get();
  if (snap.empty) {
    return bot.sendMessage(chatId, "⚠️ No encontrado. Usa ID o telefono exacto.");
  }

  const doc = snap.docs[0];
  const c = doc.data() || {};
  const sus = Array.isArray(c.suscripciones) ? c.suscripciones : [];

  let t = `👤 CLIENTE\nID: ${doc.id}\n${c.nombrePerfil || "-"}\n${c.telefono || "-"}\n${c.vendedor || "-"}\n\nSERVICIOS:\n`;
  if (sus.length === 0) t += "⚠️ Sin servicios.\n";
  else sus.forEach((s, i) => (t += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`));
  t += `\n🗑️ Eliminar: /delperf ${doc.id} N`;
  return bot.sendMessage(chatId, t);
});

// /delperf telefono_o_id N
bot.onText(/\/delperf\s+(\S+)\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim();
  const n = Number(match[2] || 0);

  if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Uso: /delperf telefono_o_id N");

  // buscar cliente por id o telefono
  let ref = db.collection("clientes").doc(q);
  let doc = await ref.get();

  if (!doc.exists) {
    const snap = await db.collection("clientes").where("telefono", "==", q).limit(1).get();
    if (snap.empty) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
    doc = snap.docs[0];
    ref = doc.ref;
  }

  const c = doc.data() || {};
  const sus = Array.isArray(c.suscripciones) ? c.suscripciones : [];
  if (sus.length === 0) return bot.sendMessage(chatId, "⚠️ Ese cliente no tiene servicios.");
  if (n > sus.length) return bot.sendMessage(chatId, `⚠️ Numero invalido. Max: ${sus.length}`);

  const eliminado = sus.splice(n - 1, 1)[0];

  // Si quedan servicios, actualizamos espejo al primero
  const update = {
    suscripciones: sus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (sus.length > 0) {
    const first = sus[0];
    update.plataforma = first.plataforma;
    update.correo = first.correo;
    update.pin = first.pin;
    update.precio = first.precio;
    update.fechaRenovacion = first.fechaRenovacion;
  } else {
    // si queda 0, dejamos campos base vacios (no borramos el cliente)
    update.plataforma = "";
    update.correo = "";
    update.pin = "";
    update.precio = 0;
    update.fechaRenovacion = "";
  }

  await ref.set(update, { merge: true });

  return bot.sendMessage(
    chatId,
    `🗑️ Servicio eliminado\nID: ${ref.id}\n${eliminado.plataforma} — ${eliminado.correo}\n\nVer: /cliente ${ref.id}`
  );
});

// ===============================
// ADD SUB desde comando (opcional, lo dejamos)
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
    const sus = Array.isArray(d.suscripciones) ? d.suscripciones : [];
    sus.push({ plataforma, correo, pin, precio, fechaRenovacion: fecha });

    await ref.set({ suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    return bot.sendMessage(chatId, `✅ Servicio agregado\n${telefono}\n${plataforma}\n${correo}\nRenueva: ${fecha}\n${precio} Lps`);
  }
);

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

// ===============================
// START + MENU + ACCESOS RAPIDOS
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
    if (data === "cli:buscar") return bot.sendMessage(chatId, "🔎 Ver cliente: /cliente telefono_o_id\n🗑️ Eliminar perfil: /delperf telefono_o_id N");

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

    // ✅ Wizard decision buttons
    if (data === "wiz:addmore") {
      const st = wizard.get(String(chatId));
      if (!st) return;
      st.pendingDecision = false;
      return wizardPromptSuscripcion(chatId);
    }
    if (data === "wiz:finish") {
      return wizardFinalizar(chatId);
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
  .listen(PORT, "0.0.0.0", () => {
    console.log("🌐 Web service activo en puerto " + PORT);
  });

setInterval(() => console.log("🟢 Bot activo..."), 60000);
