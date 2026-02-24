/**
 * index.js — Sublicuentas Inventario (FINAL ACTUALIZADO)
 * ✅ disneyp total = 6 (se toma de Firestore config/totales_plataforma)
 * ✅ /addp correo [n] resta n (default 1)
 * ✅ /delp correo [n] suma n (default 1) y reactiva si sube >0
 * ✅ Modo inteligente /add (actualiza si existe correo+plataforma, elimina duplicados)
 * ✅ AUTO elige la cuenta con MÁS perfiles libres
 * ✅ Estado visible: “LLENA” (guarda "llena")
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
// HELPERS
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

function normalizarPlataforma(txt = "") {
  return String(txt).toLowerCase().replace(/\s+/g, "");
}

function esPlataformaValida(p) {
  return PLATAFORMAS.includes(normalizarPlataforma(p));
}

function docIdInventario(correo, plataforma) {
  const safeMail = String(correo).trim().toLowerCase().replace(/[\/#?&]/g, "_");
  const safePlat = normalizarPlataforma(plataforma);
  return `${safePlat}__${safeMail}`;
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
// PANEL / MENU (texto)
// ===============================
function panelTexto() {
  return (
    "✅ *PANEL SUBLICUENTAS*\n\n" +
    "📦 *LISTADOS:*\n" +
    "/netflix /disneyp /disneys\n" +
    "/hbomax /primevideo /paramount\n" +
    "/crunchyroll\n\n" +
    "📊 *GENERAL:*\n" +
    "/stock\n" +
    "/menu\n\n" +
    "⚡ *VENTAS:*\n" +
    "/auto netflix\n" +
    "/venta netflix\n\n" +
    "⚙️ *ADMIN:*\n" +
    "/add correo clave plataforma disp [activa|llena]\n" +
    "/addm (lote)\n" +
    "/buscar correo\n" +
    "/addp correo [n] (resta n)\n" +
    "/delp correo [n] (suma n)\n" +
    "/del correo (borra duplicados)\n"
  );
}

// ===============================
// INLINE MENU (botones)
// ===============================
async function mostrarMenu(chatId) {
  return bot.sendMessage(chatId, "📌 Panel rápido:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📺 Netflix", callback_data: "stock:netflix" },
          { text: "🎬 Disney Premium", callback_data: "stock:disneyp" },
        ],
        [
          { text: "🎞️ Disney Standard", callback_data: "stock:disneys" },
          { text: "🍿 HBO Max", callback_data: "stock:hbomax" },
        ],
        [
          { text: "🎥 Prime Video", callback_data: "stock:primevideo" },
          { text: "📀 Paramount+", callback_data: "stock:paramount" },
        ],
        [{ text: "🍥 Crunchyroll", callback_data: "stock:crunchyroll" }],
        [{ text: "📦 Stock General", callback_data: "stockgeneral" }],
        [
          { text: "⚡ Auto Netflix", callback_data: "auto:netflix" },
          { text: "⚡ Auto DisneyP", callback_data: "auto:disneyp" },
        ],
        [
          { text: "⚡ Auto HBO", callback_data: "auto:hbomax" },
          { text: "⚡ Auto Prime", callback_data: "auto:primevideo" },
        ],
      ],
    },
  });
}

// FIX “Error” en botones: responder callback_query siempre
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const data = q.data || "";

  try {
    await bot.answerCallbackQuery(q.id);

    if (!(await isAdmin(userId))) {
      return bot.sendMessage(chatId, "⛔ Acceso denegado");
    }

    if (data === "stockgeneral") return mostrarStockGeneral(chatId);

    if (data.startsWith("stock:")) {
      const plat = data.split(":")[1];
      return mostrarStockPlataforma(chatId, plat);
    }

    if (data.startsWith("auto:")) {
      const plat = data.split(":")[1];
      return ejecutarAutoVenta(chatId, plat);
    }

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err.message);
    return bot.sendMessage(chatId, "⚠️ Error interno en botón (revise logs).");
  }
});

// ===============================
// STOCK POR PLATAFORMA (ordenado por más libres primero)
// ===============================
async function mostrarStockPlataforma(chatId, plataforma) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

  const total = await getTotalPorPlataforma(p);

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) {
    return bot.sendMessage(chatId, `⚠️ ${p.toUpperCase()} SIN PERFILES DISPONIBLES`);
  }

  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => Number(b.disp || 0) - Number(a.disp || 0));

  let texto = `📌 ${p.toUpperCase()} — STOCK DISPONIBLE (ordenado)\n\n`;
  let suma = 0;

  docs.forEach((d, idx) => {
    const clave = d.clave ? `🔑 ${d.clave}` : "🔑 -";
    texto += `${idx + 1}) ${d.correo} — ${clave} — ${d.disp}/${total ?? "-"}\n`;
    suma += Number(d.disp || 0);
  });

  texto += `\n━━━━━━━━━━━━━━`;
  texto += `\n📊 Cuentas con stock: ${docs.length}`;
  texto += `\n👤 Perfiles libres totales: ${suma}`;

  return bot.sendMessage(chatId, texto);
}

// ===============================
// STOCK GENERAL
// ===============================
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

// ===============================
// AUTOLLENA (cuando llega a 0)
// - Si disp queda 0 => estado "llena"
// - Si /delp sube de 0 => estado vuelve "activa"
// ===============================
async function aplicarAutoLlenoYAlerta(chatId, ref, dataAntes, dataDespues) {
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
        `🚨 *ALERTA STOCK*\n${String(dataDespues.plataforma).toUpperCase()} quedó en *0* perfiles.\n📧 ${dataDespues.correo}\n✅ Estado: *LLENA*`,
        { parse_mode: "Markdown" }
      );
    }
  }
}

// ===============================
// VENTA (toma 1 perfil del PRIMERO disponible)
// /venta netflix
// ===============================
async function ejecutarVenta(chatId, plataforma) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .limit(1)
    .get();

  if (snap.empty) {
    return bot.sendMessage(chatId, `⚠️ ${p.toUpperCase()} SIN PERFILES PARA VENDER`);
  }

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(p);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - 1);

  await ref.set(
    { disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLlenoYAlerta(chatId, ref, antes, despues);

  const clave = d.clave ? d.clave : "-";

  return bot.sendMessage(
    chatId,
    `✅ *VENTA REGISTRADA*\n📌 ${p.toUpperCase()}\n📧 ${d.correo}\n🔑 ${clave}\n👤 Disp: ${nuevoDisp}/${total ?? "-"}\nEstado: *${nuevoDisp <= 0 ? "LLENA" : "ACTIVA"}*`,
    { parse_mode: "Markdown" }
  );
}

// ===============================
// AUTO: elige la cuenta con MÁS perfiles libres primero
// /auto netflix
// ===============================
async function ejecutarAutoVenta(chatId, plataforma) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) {
    return bot.sendMessage(chatId, `⚠️ ${p.toUpperCase()} SIN PERFILES PARA VENDER`);
  }

  let best = snap.docs[0];
  snap.docs.forEach((x) => {
    if (Number(x.data().disp || 0) > Number(best.data().disp || 0)) best = x;
  });

  const doc = best;
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(p);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - 1);

  await ref.set(
    { disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLlenoYAlerta(chatId, ref, antes, despues);

  const clave = d.clave ? d.clave : "-";

  return bot.sendMessage(
    chatId,
    `⚡ *AUTO APLICADO (mayor stock)*\n📌 ${p.toUpperCase()}\n📧 ${d.correo}\n🔑 ${clave}\n👤 Disp: ${nuevoDisp}/${total ?? "-"}\nEstado: *${nuevoDisp <= 0 ? "LLENA" : "ACTIVA"}*`,
    { parse_mode: "Markdown" }
  );
}

// ===============================
// COMANDOS
// ===============================

// /start
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return bot.sendMessage(chatId, panelTexto(), { parse_mode: "Markdown" });
});

// /menu
bot.onText(/\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarMenu(chatId);
});

// /stock
bot.onText(/\/stock/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarStockGeneral(chatId);
});

// Listados por plataforma
PLATAFORMAS.forEach((p) => {
  bot.onText(new RegExp("^\\/" + p + "$", "i"), async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return mostrarStockPlataforma(chatId, p);
  });
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

// ===============================
// /add (MODO INTELIGENTE)
// /add correo clave plataforma disp [activa|llena]
// (soporta legacy: /add correo plataforma disp [estado])
// ===============================
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
    // correo clave plataforma disp [estado]
    correo = String(parts[0]).toLowerCase();
    clave = String(parts[1]);
    plataforma = normalizarPlataforma(parts[2]);
    disp = Number(parts[3]);
    estadoInput = String(parts[4] || "activa").toLowerCase();
  } else if (esPlataformaValida(parts[1]) && /^\d+$/.test(parts[2])) {
    // legacy: correo plataforma disp [estado]
    correo = String(parts[0]).toLowerCase();
    clave = "-";
    plataforma = normalizarPlataforma(parts[1]);
    disp = Number(parts[2]);
    estadoInput = String(parts[3] || "activa").toLowerCase();
  } else {
    return bot.sendMessage(chatId, "⚠️ Formato inválido.\nUse:\n/add correo clave plataforma disp [activa|llena]");
  }

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido.");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!Number.isFinite(disp) || disp < 0) return bot.sendMessage(chatId, "⚠️ disp inválido.");

  const estado = estadoNormalizado(estadoInput, disp);
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Buscar doc existente (aunque tenga ID raro)
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

    // borrar duplicados extra
    if (snap.docs.length > 1) {
      for (let i = 1; i < snap.docs.length; i++) {
        await snap.docs[i].ref.delete();
      }
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
bot.onText(/\/addm/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return bot.sendMessage(
    chatId,
    "📌 *PEGUE EL LOTE* (una cuenta por línea)\nFormato:\n`correo clave plataforma disp [activa|llena]`\nEj:\n`a@gmail.com pass123 netflix 5`\n`b@gmail.com - disneyp 6 activa`\n\nLegacy:\n`c@gmail.com netflix 5`",
    { parse_mode: "Markdown" }
  );
});

// Procesar lotes pegados
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";

  if (!text.includes("\n")) return;
  if (text.startsWith("/")) return;
  if (!(await isAdmin(userId))) return;

  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const candidato = lines.filter((l) => l.includes("@") && /\s+\d+(\s+|$)/.test(l));
  if (candidato.length < 2) return;

  let ok = 0;
  let fail = 0;

  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 3) {
      fail++;
      continue;
    }

    let correo = "";
    let clave = "-";
    let plataforma = "";
    let disp = 0;
    let estadoInput = "activa";

    if (parts.length >= 4 && esPlataformaValida(parts[2]) && /^\d+$/.test(parts[3])) {
      // correo clave plataforma disp [estado]
      correo = String(parts[0]).toLowerCase();
      clave = String(parts[1]);
      plataforma = normalizarPlataforma(parts[2]);
      disp = Number(parts[3]);
      estadoInput = String(parts[4] || "activa").toLowerCase();
    } else if (esPlataformaValida(parts[1]) && /^\d+$/.test(parts[2])) {
      // legacy
      correo = String(parts[0]).toLowerCase();
      clave = "-";
      plataforma = normalizarPlataforma(parts[1]);
      disp = Number(parts[2]);
      estadoInput = String(parts[3] || "activa").toLowerCase();
    } else {
      fail++;
      continue;
    }

    if (!correo.includes("@") || !esPlataformaValida(plataforma) || !Number.isFinite(disp)) {
      fail++;
      continue;
    }

    const estado = estadoNormalizado(estadoInput, disp);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // modo inteligente
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

    ok++;
  }

  return bot.sendMessage(chatId, `✅ Lote procesado.\nOK: ${ok}\nFallos: ${fail}`);
});

// ===============================
// /addp correo [n]  (resta n, default 1)
// ===============================
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
  const dispAntes = Number(d.disp || 0);
  const nuevoDisp = Math.max(0, dispAntes - n);

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

// ===============================
// /delp correo [n]  (suma n, default 1) + reactiva si sube de 0
// ===============================
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

  const dispAntes = Number(d.disp || 0);
  const nuevoDisp = dispAntes + n;

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
// /del correo (borra TODAS las filas con ese correo — dupes incluidos)
// ===============================
bot.onText(/\/del\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const correo = String(match[1] || "").trim().toLowerCase();

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /del correo");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ Cuenta no encontrada.");

  let borrados = 0;
  for (const d of snap.docs) {
    await d.ref.delete();
    borrados++;
  }

  return bot.sendMessage(chatId, `🗑️ Eliminadas ${borrados} cuentas\n📧 ${correo}`);
});

// /venta plataforma
bot.onText(/\/venta\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const plataforma = String(match[1] || "").trim();

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return ejecutarVenta(chatId, plataforma);
});

// /auto plataforma
bot.onText(/\/auto\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const plataforma = String(match[1] || "").trim();

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return ejecutarAutoVenta(chatId, plataforma);
});

// ===============================
// SERVIDOR HTTP (Render necesita puerto abierto)
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
// KEEP ALIVE LOG (opcional)
// ===============================
setInterval(() => console.log("🟢 Bot activo..."), 60000);
