/**
 * index.js — Sublicuentas Inventario (FINAL)
 * Cambios pedidos:
 * ✅ Muestra la clave (no "guardada")
 * ✅ Listados ordenados por más perfiles libres primero
 * ✅ Estado "llena" en vez de "bloqueada"
 * ✅ /add ahora: /add correo clave plataforma disp [activa|llena]
 * ✅ /addm lote: correo clave plataforma disp [activa|llena]
 */

const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const http = require("http");

// ===============================
// VARIABLES DE ENTORNO (Render)
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

// Estado interno: "activa" | "llena"
function normalizarEstado(txt = "") {
  const e = String(txt).toLowerCase();
  if (e === "bloqueada") return "llena"; // por si alguien escribe "bloqueada"
  if (e === "llena") return "llena";
  return "activa";
}

function labelEstado(estado) {
  return String(estado) === "llena" ? "LLENA" : "ACTIVA";
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
    "📦 *LISTADOS (ordenados por más libres):*\n" +
    "/netflix /disneyp /disneys\n" +
    "/hbomax /primevideo /paramount\n" +
    "/crunchyroll\n\n" +
    "📊 *GENERAL:*\n" +
    "/stock\n" +
    "/menu\n\n" +
    "⚡ *AUTO (toma 1 perfil del que más tenga):*\n" +
    "/auto netflix\n" +
    "/auto disneyp\n" +
    "/auto disneys\n" +
    "/auto hbomax\n" +
    "/auto primevideo\n" +
    "/auto paramount\n" +
    "/auto crunchyroll\n\n" +
    "💸 *VENTA (toma 1 perfil del primero disponible):*\n" +
    "/venta netflix\n\n" +
    "⚙️ *ADMIN:*\n" +
    "/add correo clave plataforma disp [activa|llena]\n" +
    "/addm (lote)\n" +
    "/buscar correo\n" +
    "/addp correo (resta 1)\n" +
    "/delp correo (suma 1)\n"
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

// Responder callback SIEMPRE para evitar "Error" en Telegram
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const userId = q.from?.id;
  const data = q.data || "";

  try {
    await bot.answerCallbackQuery(q.id);

    if (!chatId) return;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

    if (data === "stockgeneral") return mostrarStockGeneral(chatId);

    if (data.startsWith("stock:")) {
      const plat = data.split(":")[1];
      return mostrarStockPlataforma(chatId, plat);
    }

    if (data.startsWith("auto:")) {
      const plat = data.split(":")[1];
      return ejecutarAuto(chatId, plat);
    }

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno en botón (revise logs).");
  }
});

// ===============================
// STOCK POR PLATAFORMA (ordenado)
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

  // ✅ Ordenar en memoria: más libres primero
  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => Number(b.disp || 0) - Number(a.disp || 0));

  let texto = `📌 ${p.toUpperCase()} — STOCK DISPONIBLE (ordenado)\n\n`;
  let suma = 0;

  docs.forEach((d, idx) => {
    suma += Number(d.disp || 0);
    texto += `${idx + 1}) ${d.correo} — 🔑 ${d.clave || "-"} — ${d.disp}/${total ?? "-"}\n`;
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
// AUTOBLOQUEO + ALERTA
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
// VENTA: toma 1 perfil del PRIMERO disponible (sin ordenar)
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

  if (snap.empty) return bot.sendMessage(chatId, `⚠️ ${p.toUpperCase()} SIN PERFILES PARA VENDER`);

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

  return bot.sendMessage(
    chatId,
    `✅ *VENTA REGISTRADA*\n📌 ${p.toUpperCase()}\n📧 ${d.correo}\n🔑 ${d.clave || "-"}\n👤 Disp: ${nuevoDisp}/${total ?? "-"}\nEstado: *${labelEstado(nuevoDisp <= 0 ? "llena" : d.estado)}*`,
    { parse_mode: "Markdown" }
  );
}

// ===============================
// AUTO: toma 1 perfil de la cuenta con MÁS libres (ordenado)
// /auto netflix
// ===============================
async function ejecutarAuto(chatId, plataforma) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", p)
    .where("estado", "==", "activa")
    .where("disp", ">=", 1)
    .get();

  if (snap.empty) return bot.sendMessage(chatId, `⚠️ ${p.toUpperCase()} SIN PERFILES PARA AUTO`);

  // ✅ escoger el mayor disp (en memoria)
  let best = snap.docs[0];
  for (const d of snap.docs) {
    if (Number(d.data().disp || 0) > Number(best.data().disp || 0)) best = d;
  }

  const ref = best.ref;
  const data = best.data();
  const total = await getTotalPorPlataforma(p);

  const antes = { ...data };
  const nuevoDisp = Math.max(0, Number(data.disp || 0) - 1);

  await ref.set(
    { disp: nuevoDisp, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const despues = { ...data, disp: nuevoDisp };
  await aplicarAutoLlenoYAlerta(chatId, ref, antes, despues);

  return bot.sendMessage(
    chatId,
    `⚡ *AUTO APLICADO (mayor stock)*\n📌 ${p.toUpperCase()}\n📧 ${data.correo}\n🔑 ${data.clave || "-"}\n👤 Disp: ${nuevoDisp}/${total ?? "-"}\nEstado: *${labelEstado(nuevoDisp <= 0 ? "llena" : data.estado)}*`,
    { parse_mode: "Markdown" }
  );
}

// ===============================
// COMANDOS
// ===============================
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return bot.sendMessage(chatId, panelTexto(), { parse_mode: "Markdown" });
});

bot.onText(/\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarMenu(chatId);
});

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
    texto += `✅ ${String(x.plataforma).toUpperCase()} — ${x.disp} — ${labelEstado(x.estado)} — 🔑 ${x.clave || "-"}\n`;
  });

  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

// ✅ /add correo clave plataforma disp [estado]
bot.onText(/\/add\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)(?:\s+(\S+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1]).trim().toLowerCase();
  const clave = String(match[2]).trim(); // 👈 clave
  const plataforma = normalizarPlataforma(match[3]);
  const disp = Number(match[4]);
  const estado = normalizarEstado(match[5] || "activa");

  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido.");
  if (!clave) return bot.sendMessage(chatId, "⚠️ Falta clave.");
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
  if (!Number.isFinite(disp) || disp < 0) return bot.sendMessage(chatId, "⚠️ disp inválido.");

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const now = admin.firestore.FieldValue.serverTimestamp();

  const finalEstado = disp <= 0 ? "llena" : estado;

  const data = {
    correo,
    clave,
    plataforma,
    disp,
    estado: finalEstado,
    updatedAt: now,
  };

  const prev = await ref.get();
  if (!prev.exists) data.createdAt = now;

  await ref.set(data, { merge: true });

  const total = await getTotalPorPlataforma(plataforma);

  return bot.sendMessage(
    chatId,
    `✅ *Agregada*\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n🔑 ${clave}\n👤 Disponibles: ${disp}/${total ?? "-"}\nEstado: *${labelEstado(finalEstado)}*`,
    { parse_mode: "Markdown" }
  );
});

// /addm (lote)
bot.onText(/\/addm/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return bot.sendMessage(
    chatId,
    "📌 *PEGUE EL LOTE* (una cuenta por línea)\nFormato:\n`correo clave plataforma disp [activa|llena]`\n\nEj:\n`a@gmail.com pass123 netflix 5 activa`\n`b@gmail.com pass999 disneyp 5`\n",
    { parse_mode: "Markdown" }
  );
});

// Procesar lotes pegados (multi-línea)
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";

  if (!text.includes("\n")) return;
  if (text.startsWith("/")) return;
  if (!(await isAdmin(userId))) return;

  const lines = text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const candidato = lines.filter((l) => l.includes("@") && /\s+\d+(\s+|$)/.test(l));
  if (candidato.length < 2) return;

  let ok = 0;
  let fail = 0;

  for (const line of lines) {
    const parts = line.split(/\s+/);

    // correo clave plataforma disp [estado]
    if (parts.length < 4) {
      fail++;
      continue;
    }

    const correo = String(parts[0]).toLowerCase();
    const clave = String(parts[1] || "").trim();
    const plataforma = normalizarPlataforma(parts[2]);
    const disp = Number(parts[3]);
    const estado = normalizarEstado(parts[4] || "activa");

    if (!correo.includes("@") || !clave || !esPlataformaValida(plataforma) || !Number.isFinite(disp)) {
      fail++;
      continue;
    }

    const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
    const now = admin.firestore.FieldValue.serverTimestamp();

    const prev = await ref.get();
    await ref.set(
      {
        correo,
        clave,
        plataforma,
        disp: Math.max(0, disp),
        estado: disp <= 0 ? "llena" : estado,
        createdAt: prev.exists ? prev.data().createdAt : now,
        updatedAt: now,
      },
      { merge: true }
    );

    ok++;
  }

  return bot.sendMessage(chatId, `✅ Lote procesado.\nOK: ${ok}\nFallos: ${fail}`);
});

// /addp correo  (resta 1)
bot.onText(/\/addp\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const correo = String(match[1] || "").trim().toLowerCase();

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /addp correo");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  if (snap.size > 1) {
    return bot.sendMessage(chatId, "⚠️ Ese correo aparece en varias plataformas. Use /buscar.");
  }

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(d.plataforma);

  const antes = { ...d };
  const nuevoDisp = Math.max(0, Number(d.disp || 0) - 1);

  await ref.set(
    {
      disp: nuevoDisp,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const despues = { ...d, disp: nuevoDisp };
  await aplicarAutoLlenoYAlerta(chatId, ref, antes, despues);

  const estadoFinal = nuevoDisp <= 0 ? "llena" : (d.estado || "activa");

  return bot.sendMessage(
    chatId,
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n🔑 ${d.clave || "-"}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${labelEstado(estadoFinal)}*`,
    { parse_mode: "Markdown" }
  );
});

// /delp correo  (suma 1) + reactiva si sube de 0
bot.onText(/\/delp\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const correo = String(match[1] || "").trim().toLowerCase();

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  if (!correo.includes("@")) return bot.sendMessage(chatId, "⚠️ Uso: /delp correo");

  const snap = await db.collection("inventario").where("correo", "==", correo).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No encontrado.");

  if (snap.size > 1) {
    return bot.sendMessage(chatId, "⚠️ Ese correo aparece en varias plataformas. Use /buscar.");
  }

  const doc = snap.docs[0];
  const ref = doc.ref;
  const d = doc.data();
  const total = await getTotalPorPlataforma(d.plataforma);

  const nuevoDisp = Number(d.disp || 0) + 1;

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
    `✅ *Actualizado*\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n🔑 ${d.clave || "-"}\n👤 Disponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: *${labelEstado(nuevoDisp > 0 ? "activa" : d.estado)}*`,
    { parse_mode: "Markdown" }
  );
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
  return ejecutarAuto(chatId, plataforma);
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
