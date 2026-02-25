/**
 * ✅ SUBLICUENTAS TG BOT — INDEX FINAL COMPLETO
 * MENU: Inventario | Clientes | Pagos | Renovaciones | Buscar
 * Inventario paginado 10 en 10 (Atrás | Inicio | Siguiente)
 * Clientes: ficha + botones + multi-plataforma
 * Renovaciones + TXT
 * Reporte TXT general de clientes
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

// ===============================
// EMOJIS BLINDADOS (no se corrompen)
// ===============================
const EMOJI = {
  box: "\u{1F4E6}",        // 📦
  people: "\u{1F465}",     // 👥
  card: "\u{1F4B3}",       // 💳
  cal: "\u{1F4C5}",        // 📅
  search: "\u{1F50E}",     // 🔎
  tv: "\u{1F4FA}",         // 📺
  clap: "\u{1F3AC}",       // 🎬
  popcorn: "\u{1F37F}",    // 🍿
  key: "\u{1F511}",        // 🔑
  ok: "\u{2705}",          // ✅
  warn: "\u{26A0}\u{FE0F}",// ⚠️
  back: "\u{2B05}\u{FE0F}",// ⬅️
  home: "\u{1F3E0}",       // 🏠
  next: "\u{27A1}\u{FE0F}",// ➡️
  refresh: "\u{1F504}",    // 🔄
  trash: "\u{1F5D1}\u{FE0F}",// 🗑️
  plus: "\u{2795}",        // ➕
  doc: "\u{1F4C4}",        // 📄
};

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
  return doc.exists && doc.data()?.activo !== false; // si existe, ok; si activo=false, no
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
// MENUS
// ===============================
async function menuPrincipal(chatId) {
  return bot.sendMessage(chatId, `${EMOJI.ok} MENU PRINCIPAL`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `${EMOJI.box} Inventario`, callback_data: "menu:inventario" }],
        [{ text: `${EMOJI.people} Clientes`, callback_data: "menu:clientes" }],
        [{ text: `${EMOJI.card} Pagos`, callback_data: "menu:pagos" }],
        [{ text: `${EMOJI.cal} Renovaciones`, callback_data: "menu:renovaciones" }],
        [{ text: `${EMOJI.search} Buscar`, callback_data: "menu:buscar" }],
      ],
    },
  });
}

async function menuInventario(chatId) {
  return bot.sendMessage(chatId, `${EMOJI.box} INVENTARIO (elige plataforma)`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `${EMOJI.tv} Netflix`, callback_data: "inv:netflix:0" },
          { text: `${EMOJI.clap} Disney Premium`, callback_data: "inv:disneyp:0" },
        ],
        [
          { text: `Disney Standard`, callback_data: "inv:disneys:0" },
          { text: `${EMOJI.popcorn} HBO Max`, callback_data: "inv:hbomax:0" },
        ],
        [
          { text: `Prime Video`, callback_data: "inv:primevideo:0" },
          { text: `Paramount+`, callback_data: "inv:paramount:0" },
        ],
        [{ text: `Crunchyroll`, callback_data: "inv:crunchyroll:0" }],
        [{ text: `Stock General`, callback_data: "inv:general" }],
        [{ text: `${EMOJI.home} Inicio`, callback_data: "go:inicio" }],
      ],
    },
  });
}

async function menuClientes(chatId) {
  return bot.sendMessage(
    chatId,
    `${EMOJI.people} CLIENTES\n\n` +
      `• Nuevo cliente (wizard)\n` +
      `• Ver ficha: /cliente TELEFONO\n` +
      `• Eliminar servicio: /delsub TELEFONO plataforma correo\n` +
      `• Reporte general TXT: /clientes_txt`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `${EMOJI.plus} Nuevo cliente`, callback_data: "cli:nuevo" }],
          [{ text: `${EMOJI.search} Ver ficha`, callback_data: "cli:ver" }],
          [{ text: `${EMOJI.doc} Reporte TXT`, callback_data: "cli:txt" }],
          [{ text: `${EMOJI.home} Inicio`, callback_data: "go:inicio" }],
        ],
      },
    }
  );
}

async function menuPagos(chatId) {
  return bot.sendMessage(
    chatId,
    `${EMOJI.card} PAGOS\n\n` +
      `Por ahora los pagos se registran con el boton: "${EMOJI.ok} RENOVO" dentro de la ficha del cliente.`,
    { reply_markup: { inline_keyboard: [[{ text: `${EMOJI.home} Inicio`, callback_data: "go:inicio" }]] } }
  );
}

async function menuRenovaciones(chatId) {
  return bot.sendMessage(
    chatId,
    `${EMOJI.cal} RENOVACIONES\n\n` +
      `• /renovaciones hoy\n` +
      `• /renovaciones dd/mm/yyyy\n` +
      `• /renovaciones NOMBRE dd/mm/yyyy\n\n` +
      `TXT:\n` +
      `• /txt hoy\n` +
      `• /txt dd/mm/yyyy\n` +
      `• /txt NOMBRE dd/mm/yyyy`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `Renovaciones hoy`, callback_data: "ren:hoy" }],
          [{ text: `${EMOJI.doc} TXT hoy`, callback_data: "txt:hoy" }],
          [{ text: `${EMOJI.home} Inicio`, callback_data: "go:inicio" }],
        ],
      },
    }
  );
}

// ===============================
// INVENTARIO: LISTA + PAGINACION (10)
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

  let texto = `📌 ${p.toUpperCase()} — STOCK DISPONIBLE\n`;
  texto += `Mostrando ${totalItems === 0 ? 0 : start + 1}-${end} de ${totalItems}\n\n`;

  if (slice.length === 0) {
    texto += `${EMOJI.warn} SIN PERFILES DISPONIBLES\n`;
  } else {
    let i = start + 1;
    let libresTotal = 0;
    docs.forEach((x) => (libresTotal += Number(x.disp || 0)));

    for (const d of slice) {
      const clave = d?.clave ? String(d.clave) : "-";
      texto += `${i}) ${d.correo} — ${EMOJI.key} ${clave} — ${d.disp}/${total ?? "-"}\n`;
      i++;
    }

    texto += `\n━━━━━━━━━━━━━━\n`;
    texto += `Cuentas con stock: ${totalItems}\n`;
    texto += `Perfiles libres totales: ${libresTotal}\n`;
  }

  texto += `\nPagina: ${safePage + 1}/${totalPages}`;

  return { texto, safePage, totalPages };
}

async function enviarInventarioPlataforma(chatId, plataforma, page) {
  const p = normalizarPlataforma(plataforma);
  if (!esPlataformaValida(p)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida.`);

  const { texto, safePage, totalPages } = await inventarioPlataformaTexto(p, page);

  const canBack = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return bot.sendMessage(chatId, texto, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `${EMOJI.back} Atras`, callback_data: canBack ? `inv:${p}:${safePage - 1}` : "noop" },
          { text: `${EMOJI.home} Inicio`, callback_data: "go:inicio" },
          { text: `${EMOJI.next} Siguiente`, callback_data: canNext ? `inv:${p}:${safePage + 1}` : "noop" },
        ],
        [{ text: `${EMOJI.refresh} Actualizar`, callback_data: `inv:${p}:${safePage}` }],
        [{ text: `${EMOJI.back} Volver Inventario`, callback_data: "menu:inventario" }],
      ],
    },
  });
}

async function mostrarStockGeneral(chatId) {
  const cfg = await db.collection("config").doc("totales_plataforma").get();
  const totals = cfg.exists ? cfg.data() : {};
  let texto = `${EMOJI.box} STOCK GENERAL\n\n`;

  for (const p of PLATAFORMAS) {
    const snap = await db
      .collection("inventario")
      .where("plataforma", "==", p)
      .where("disp", ">=", 1)
      .where("estado", "==", "activa")
      .get();

    let libres = 0;
    snap.forEach((d) => (libres += Number(d.data().disp || 0)));
    texto += `• ${p}: ${libres} libres (/${totals?.[p] ?? "-"})\n`;
  }

  return bot.sendMessage(chatId, texto);
}

// ===============================
// AUTOLLENO: si disp llega a 0 => estado "llena"
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
        `🚨 ALERTA STOCK\n${String(dataDespues.plataforma).toUpperCase()} quedo en 0 perfiles.\n${dataDespues.correo}\nEstado: LLENA`
      );
    }
  }
}

// ===============================
// INVENTARIO — COMANDOS
// ===============================

// /add correo CLAVE plataforma disp [activa|llena]
// (soporta formato viejo: /add correo plataforma disp [estado])
bot.onText(/\/add\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const raw = String(match[1] || "").trim();
  const parts = raw.split(/\s+/);
  if (parts.length < 3) return bot.sendMessage(chatId, `${EMOJI.warn} Uso: /add correo CLAVE plataforma disp [activa|llena]`);

  let correo = "";
  let clave = "";
  let plataforma = "";
  let dispStr = "";
  let estadoInput = "";

  // viejo: correo plataforma disp
  if (parts.length >= 3 && /^\d+$/.test(parts[2])) {
    correo = parts[0];
    plataforma = parts[1];
    dispStr = parts[2];
    estadoInput = parts[3] || "activa";
    clave = "";
  } else {
    // nuevo: correo clave plataforma disp
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

  if (!correo.includes("@")) return bot.sendMessage(chatId, `${EMOJI.warn} Correo invalido.`);
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida.`);
  if (!Number.isFinite(disp) || disp < 0) return bot.sendMessage(chatId, `${EMOJI.warn} disp invalido.`);

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
    `${EMOJI.ok} Agregada\n${plataforma.toUpperCase()}\n${correo}\n${EMOJI.key} ${claveOut}\nDisponibles: ${disp}/${total ?? "-"}\nEstado: ${fmtEstado(data.estado)}`
  );
});

// /del correo plataforma
bot.onText(/\/del\s+(\S+)\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");

  if (!correo.includes("@")) return bot.sendMessage(chatId, `${EMOJI.warn} Uso: /del correo plataforma`);
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida.`);

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, `${EMOJI.warn} Cuenta no encontrada.`);

  await ref.delete();
  return bot.sendMessage(chatId, `${EMOJI.trash} Eliminada: ${plataforma.toUpperCase()} — ${correo}`);
});

// /editclave correo plataforma NUEVA_CLAVE
bot.onText(/\/editclave\s+(\S+)\s+(\S+)\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = normalizarPlataforma(match[2] || "");
  const nueva = String(match[3] || "").trim();

  if (!correo.includes("@")) return bot.sendMessage(chatId, `${EMOJI.warn} Uso: /editclave correo plataforma NUEVA_CLAVE`);
  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida.`);
  if (!nueva) return bot.sendMessage(chatId, `${EMOJI.warn} Falta la clave.`);

  const ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, `${EMOJI.warn} Cuenta no encontrada.`);

  await ref.set({ clave: nueva, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return bot.sendMessage(chatId, `${EMOJI.ok} Clave actualizada\n${plataforma.toUpperCase()}\n${correo}\n${EMOJI.key} ${nueva}`);
});

// /addp correo [cantidad]   OR   /addp correo plataforma cantidad
bot.onText(/\/addp\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const parts = String(match[1] || "").trim().split(/\s+/);
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

  if (!correo.includes("@")) return bot.sendMessage(chatId, `${EMOJI.warn} Uso: /addp correo [cantidad]  o  /addp correo plataforma cantidad`);
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, `${EMOJI.warn} Cantidad invalida.`);
  if (plataforma && !esPlataformaValida(plataforma)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida.`);

  let ref, d;

  if (plataforma) {
    ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
    const doc = await ref.get();
    if (!doc.exists) return bot.sendMessage(chatId, `${EMOJI.warn} Cuenta no encontrada.`);
    d = doc.data();
  } else {
    const snap = await db.collection("inventario").where("correo", "==", correo).limit(2).get();
    if (snap.empty) return bot.sendMessage(chatId, `${EMOJI.warn} No encontrado.`);
    if (snap.size > 1) return bot.sendMessage(chatId, `${EMOJI.warn} Ese correo esta en varias plataformas. Usa: /addp correo plataforma cantidad`);
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
    `${EMOJI.ok} Actualizado\n${String(d.plataforma).toUpperCase()}\n${correo}\nDisponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: ${fmtEstado(estadoFinal)}`
  );
});

// /delp correo [cantidad]   OR   /delp correo plataforma cantidad
bot.onText(/\/delp\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const parts = String(match[1] || "").trim().split(/\s+/);
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

  if (!correo.includes("@")) return bot.sendMessage(chatId, `${EMOJI.warn} Uso: /delp correo [cantidad]  o  /delp correo plataforma cantidad`);
  if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, `${EMOJI.warn} Cantidad invalida.`);
  if (plataforma && !esPlataformaValida(plataforma)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida.`);

  let ref, d;

  if (plataforma) {
    ref = db.collection("inventario").doc(docIdInventario(correo, plataforma));
    const doc = await ref.get();
    if (!doc.exists) return bot.sendMessage(chatId, `${EMOJI.warn} Cuenta no encontrada.`);
    d = doc.data();
  } else {
    const snap = await db.collection("inventario").where("correo", "==", correo).limit(2).get();
    if (snap.empty) return bot.sendMessage(chatId, `${EMOJI.warn} No encontrado.`);
    if (snap.size > 1) return bot.sendMessage(chatId, `${EMOJI.warn} Ese correo esta en varias plataformas. Usa: /delp correo plataforma cantidad`);
    ref = snap.docs[0].ref;
    d = snap.docs[0].data();
  }

  const total = await getTotalPorPlataforma(d.plataforma);
  const nuevoDisp = Number(d.disp || 0) + qty;

  await ref.set(
    { disp: nuevoDisp, estado: nuevoDisp > 0 ? "activa" : d.estado || "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `${EMOJI.ok} Actualizado\n${String(d.plataforma).toUpperCase()}\n${correo}\nDisponibles: ${nuevoDisp}/${total ?? "-"}\nEstado: ${fmtEstado(nuevoDisp > 0 ? "activa" : d.estado)}`
  );
});

// ===============================
// BUSQUEDA GENERAL: /buscar texto
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim().toLowerCase();
  if (!q) return bot.sendMessage(chatId, `${EMOJI.warn} Uso: /buscar texto`);

  const invSnap = await db.collection("inventario").where("correo", "==", q).get();

  const cliSnap = await db.collection("clientes").limit(3000).get();
  const clientes = cliSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((c) => {
      const nombre = String(c.nombrePerfil || "").toLowerCase();
      const tel = String(c.telefono || "").toLowerCase();
      const correo = String(c.correo || "").toLowerCase();
      return nombre.includes(q) || tel.includes(q) || correo.includes(q);
    })
    .slice(0, 10);

  let texto = `${EMOJI.search} BUSQUEDA GENERAL\nConsulta: ${q}\n\n`;

  if (invSnap.empty && clientes.length === 0) return bot.sendMessage(chatId, `${EMOJI.warn} Sin resultados.`);

  if (!invSnap.empty) {
    texto += `INVENTARIO:\n`;
    invSnap.forEach((d) => {
      const x = d.data();
      texto += `• ${String(x.plataforma).toUpperCase()} — ${x.correo} — ${x.disp} — ${fmtEstado(x.estado)}\n`;
    });
    texto += `\n`;
  }

  if (clientes.length > 0) {
    texto += `CLIENTES (top 10):\n`;
    for (const c of clientes) {
      texto += `• ${c.nombrePerfil || "-"} — ${c.telefono || "-"} — ${c.vendedor || "-"}\n`;
      // botón ver ficha (SIN mostrar ID al usuario)
      await bot.sendMessage(chatId, `👤 ${c.nombrePerfil}\n📱 ${c.telefono}`, {
        reply_markup: { inline_keyboard: [[{ text: `📄 Ver ficha`, callback_data: `cli:view:${c.id}` }]] },
      });
    }
    texto += `\nVer ficha directo: /cliente TELEFONO`;
  }

  return bot.sendMessage(chatId, texto);
});

// ===============================
// CLIENTES — Wizard multi-plataforma + Ficha con botones
// ===============================
const wizard = new Map(); // chatId -> state

function botonesFichaCliente(clienteDocId) {
  return {
    inline_keyboard: [
      [{ text: `${EMOJI.plus} Agregar plataforma`, callback_data: `cli:add:${clienteDocId}` }],
      [{ text: `${EMOJI.trash} Eliminar servicio`, callback_data: `cli:del:${clienteDocId}` }],
      [{ text: `${EMOJI.home} Inicio`, callback_data: "go:inicio" }],
      [{ text: `${EMOJI.back} Volver`, callback_data: "menu:clientes" }],
    ],
  };
}

async function enviarFichaCliente(chatId, doc) {
  const c = doc.data() || {};
  const servicios = Array.isArray(c.suscripciones) ? c.suscripciones : [];

  let txt = `CLIENTE AGREGADO / DATOS DEL CLIENTE\n\n`;
  txt += `Nombre: ${c.nombrePerfil || "-"}\n`;
  txt += `Telefono: ${c.telefono || "-"}\n`;
  txt += `Vendedor: ${c.vendedor || "-"}\n\n`;
  txt += `SERVICIOS:\n`;

  if (servicios.length === 0) {
    txt += `${EMOJI.warn} Sin servicios.\n`;
  } else {
    servicios.forEach((s, i) => {
      txt += `${i + 1}) ${s.plataforma} — ${s.correo} — ${s.precio} Lps — Renueva: ${s.fechaRenovacion}\n`;
    });
  }

  // Botón extra: renovar por cada servicio
  const renRows = [];
  servicios.forEach((s, i) => {
    renRows.push([{ text: `${EMOJI.ok} RENOVO ${String(s.plataforma).toUpperCase()}`, callback_data: `cli:ren:${doc.id}:${i}` }]);
  });

  const baseButtons = botonesFichaCliente(doc.id).inline_keyboard;
  const finalKeyboard = [...renRows, ...baseButtons];

  return bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: finalKeyboard } });
}

// Wizard: nuevo cliente
async function wizardStartNuevoCliente(chatId) {
  wizard.set(String(chatId), { mode: "nuevo", step: 1, base: {}, sub: {}, subs: [] });
  return bot.sendMessage(chatId, `${EMOJI.people} NUEVO CLIENTE\nEscribe: Nombre perfil`);
}
async function wizardStartAgregarServicio(chatId, clienteId) {
  wizard.set(String(chatId), { mode: "addserv", step: 1, clienteId, sub: {} });
  return bot.sendMessage(chatId, `${EMOJI.plus} AGREGAR PLATAFORMA\nEscribe: plataforma (netflix/disneyp/disneys/hbomax/primevideo/paramount/crunchyroll)`);
}

async function wizardHandle(chatId, text) {
  const st = wizard.get(String(chatId));
  if (!st) return;
  const t = String(text || "").trim();

  // ---- NUEVO CLIENTE ----
  if (st.mode === "nuevo") {
    if (st.step === 1) {
      st.base.nombrePerfil = t;
      st.step = 2;
      return bot.sendMessage(chatId, "Telefono:");
    }
    if (st.step === 2) {
      st.base.telefono = t;
      st.step = 3;
      return bot.sendMessage(chatId, "Vendedor:");
    }
    if (st.step === 3) {
      st.base.vendedor = t;
      st.step = 10; // empezar servicio 1
      st.sub = {};
      return bot.sendMessage(chatId, "Plataforma:");
    }

    // Servicio (5 pasos)
    if (st.step === 10) {
      const p = normalizarPlataforma(t);
      if (!esPlataformaValida(p)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida. Escribe otra:`);
      st.sub.plataforma = p;
      st.step = 11;
      return bot.sendMessage(chatId, "Correo:");
    }
    if (st.step === 11) {
      if (!t.includes("@")) return bot.sendMessage(chatId, `${EMOJI.warn} Correo invalido. Escribe otra:`);
      st.sub.correo = t.toLowerCase();
      st.step = 12;
      return bot.sendMessage(chatId, "Pin:");
    }
    if (st.step === 12) {
      st.sub.pin = t;
      st.step = 13;
      return bot.sendMessage(chatId, "Precio (solo numero en Lps):");
    }
    if (st.step === 13) {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, `${EMOJI.warn} Precio invalido. Escribe numero:`);
      st.sub.precio = n;
      st.step = 14;
      return bot.sendMessage(chatId, "Fecha renovacion (dd/mm/yyyy):");
    }
    if (st.step === 14) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, `${EMOJI.warn} Formato invalido. Usa dd/mm/yyyy:`);
      st.sub.fechaRenovacion = t;
      st.subs.push({ ...st.sub });

      // preguntar si agrega otra
      return bot.sendMessage(chatId, "Servicio agregado. Agregar otra plataforma?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: `${EMOJI.plus} Agregar otra`, callback_data: "wiz:otra" }],
            [{ text: `${EMOJI.ok} Finalizar`, callback_data: "wiz:fin" }],
          ],
        },
      });
    }
  }

  // ---- AGREGAR SERVICIO A CLIENTE EXISTENTE ----
  if (st.mode === "addserv") {
    if (st.step === 1) {
      const p = normalizarPlataforma(t);
      if (!esPlataformaValida(p)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida. Escribe otra:`);
      st.sub.plataforma = p;
      st.step = 2;
      return bot.sendMessage(chatId, "Correo:");
    }
    if (st.step === 2) {
      if (!t.includes("@")) return bot.sendMessage(chatId, `${EMOJI.warn} Correo invalido. Escribe otra:`);
      st.sub.correo = t.toLowerCase();
      st.step = 3;
      return bot.sendMessage(chatId, "Pin:");
    }
    if (st.step === 3) {
      st.sub.pin = t;
      st.step = 4;
      return bot.sendMessage(chatId, "Precio (solo numero en Lps):");
    }
    if (st.step === 4) {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, `${EMOJI.warn} Precio invalido. Escribe numero:`);
      st.sub.precio = n;
      st.step = 5;
      return bot.sendMessage(chatId, "Fecha renovacion (dd/mm/yyyy):");
    }
    if (st.step === 5) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, `${EMOJI.warn} Formato invalido. Usa dd/mm/yyyy:`);
      st.sub.fechaRenovacion = t;

      const ref = db.collection("clientes").doc(st.clienteId);
      const doc = await ref.get();
      if (!doc.exists) {
        wizard.delete(String(chatId));
        return bot.sendMessage(chatId, `${EMOJI.warn} Cliente no encontrado.`);
      }

      const data = doc.data() || {};
      const sus = Array.isArray(data.suscripciones) ? data.suscripciones : [];
      sus.push({ ...st.sub });

      await ref.set({ suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      wizard.delete(String(chatId));
      const doc2 = await ref.get();
      return enviarFichaCliente(chatId, doc2);
    }
  }
}

// Finalizar nuevo cliente
async function wizardFinalizarNuevo(chatId) {
  const st = wizard.get(String(chatId));
  if (!st || st.mode !== "nuevo") return;

  if (!st.subs || st.subs.length === 0) {
    wizard.delete(String(chatId));
    return bot.sendMessage(chatId, `${EMOJI.warn} Sin servicios. Cancelado.`);
  }

  const first = st.subs[0];
  const payload = {
    nombrePerfil: st.base.nombrePerfil || "-",
    telefono: st.base.telefono || "-",
    vendedor: st.base.vendedor || "-",
    moneda: "Lps",
    plataforma: first.plataforma,
    correo: first.correo,
    pin: first.pin,
    precio: first.precio,
    fechaRenovacion: first.fechaRenovacion,
    suscripciones: st.subs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const ref = await db.collection("clientes").add(payload);
  wizard.delete(String(chatId));

  const doc = await db.collection("clientes").doc(ref.id).get();
  return enviarFichaCliente(chatId, doc);
}

// /cliente TELEFONO
bot.onText(/\/cliente\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const telefono = String(match[1] || "").trim();
  const snap = await db.collection("clientes").where("telefono", "==", telefono).limit(1).get();
  if (snap.empty) return bot.sendMessage(chatId, `${EMOJI.warn} Cliente no encontrado.`);

  return enviarFichaCliente(chatId, snap.docs[0]);
});

// /delsub TELEFONO PLATAFORMA CORREO  (elimina por plataforma + correo)
bot.onText(/\/delsub\s+(\S+)\s+(\S+)\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const telefono = String(match[1] || "").trim();
  const plataforma = normalizarPlataforma(match[2] || "");
  const correo = String(match[3] || "").trim().toLowerCase();

  if (!esPlataformaValida(plataforma)) return bot.sendMessage(chatId, `${EMOJI.warn} Plataforma invalida.`);
  if (!correo.includes("@")) return bot.sendMessage(chatId, `${EMOJI.warn} Correo invalido.`);

  const snap = await db.collection("clientes").where("telefono", "==", telefono).limit(1).get();
  if (snap.empty) return bot.sendMessage(chatId, `${EMOJI.warn} Cliente no encontrado.`);

  const ref = snap.docs[0].ref;
  const data = snap.docs[0].data() || {};
  let sus = Array.isArray(data.suscripciones) ? data.suscripciones : [];

  const before = sus.length;
  sus = sus.filter(
    (s) => !(normalizarPlataforma(s.plataforma) === plataforma && String(s.correo || "").toLowerCase() === correo)
  );

  if (sus.length === before) return bot.sendMessage(chatId, `${EMOJI.warn} Servicio no encontrado.`);

  await ref.set({ suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  const doc2 = await ref.get();
  await bot.sendMessage(chatId, `${EMOJI.ok} Servicio eliminado`);
  return enviarFichaCliente(chatId, doc2);
});

// /clientes_txt  (TXT general numerado)
bot.onText(/\/clientes_txt/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const snap = await db.collection("clientes").limit(5000).get();
  const rows = snap.docs
    .map((d) => d.data() || {})
    .map((c) => ({ nombre: String(c.nombrePerfil || "-").trim(), tel: String(c.telefono || "-").trim() }))
    .sort((a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase()));

  const fecha = hoyDMY();
  const filePath = path.join(__dirname, `clientes_general_${fecha.replaceAll("/", "_")}.txt`);

  let body = `CLIENTES - GENERAL (${fecha})\n\n`;
  rows.forEach((r, i) => {
    const n = String(i + 1).padStart(2, "0");
    body += `${n}) ${r.nombre} | ${r.tel}\n`;
  });
  body += `\n--------------------\nTOTAL CLIENTES: ${rows.length}\n`;

  fs.writeFileSync(filePath, body, "utf8");
  await bot.sendDocument(chatId, filePath);
  try { fs.unlinkSync(filePath); } catch (e) {}
});

// ===============================
// RENOVACIONES + TXT
// ===============================
async function obtenerRenovacionesPorFecha(fechaDMY, vendedorOpt) {
  const snap = await db.collection("clientes").limit(5000).get();
  const out = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const vendedor = String(c.vendedor || "").trim();

    const sus = Array.isArray(c.suscripciones) ? c.suscripciones : [];
    for (const s of sus) {
      if (String(s.fechaRenovacion || "") === fechaDMY) {
        const vendOk = !vendedorOpt || vendedor.toLowerCase() === vendedorOpt.toLowerCase();
        if (vendOk) {
          out.push({
            nombrePerfil: c.nombrePerfil || "-",
            plataforma: s.plataforma || "-",
            precio: Number(s.precio || 0),
            telefono: c.telefono || "-",
            vendedor: vendedor || "-",
          });
        }
      }
    }
  });

  out.sort((a, b) => String(a.vendedor).toLowerCase().localeCompare(String(b.vendedor).toLowerCase()));
  return out;
}

function renovacionesTexto(list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt ? `RENOVACIONES ${fechaDMY} — ${vendedorOpt}` : `RENOVACIONES ${fechaDMY} — GENERAL`;
  let t = `${EMOJI.cal} ${titulo}\n\n`;

  if (!list || list.length === 0) return `${t}${EMOJI.warn} No hay renovaciones.`;

  let suma = 0;
  list.forEach((x, i) => {
    suma += Number(x.precio || 0);
    // sin palabra "vendedor", solo el nombre al final
    t += `${i + 1}) ${x.nombrePerfil} — ${x.plataforma} — ${x.precio} Lps — ${x.telefono} — ${x.vendedor}\n`;
  });

  t += `\n--------------------\nClientes: ${list.length}\nTotal a cobrar: ${suma} Lps\n`;
  return t;
}

async function enviarTXT(chatId, list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt ? `renovaciones_${vendedorOpt}_${fechaDMY}` : `renovaciones_general_${fechaDMY}`;
  const fileSafe = titulo.replace(/[^\w\-]+/g, "_");
  const filePath = path.join(__dirname, `${fileSafe}.txt`);

  let body = vendedorOpt ? `RENOVACIONES ${fechaDMY} - ${vendedorOpt}\n\n` : `RENOVACIONES ${fechaDMY} - GENERAL\n\n`;

  if (!list || list.length === 0) {
    body += "SIN RENOVACIONES\n";
  } else {
    let suma = 0;
    list.forEach((x, i) => {
      suma += Number(x.precio || 0);
      body += `${i + 1}) ${x.nombrePerfil} | ${x.plataforma} | ${x.precio} Lps | ${x.telefono} | ${x.vendedor}\n`;
    });
    body += `\n--------------------\nCLIENTES: ${list.length}\nTOTAL: ${suma} Lps\n`;
  }

  fs.writeFileSync(filePath, body, "utf8");
  await bot.sendDocument(chatId, filePath);
  try { fs.unlinkSync(filePath); } catch (e) {}
}

// /renovaciones hoy | dd/mm/yyyy | NOMBRE dd/mm/yyyy
bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

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
      return bot.sendMessage(chatId, `${EMOJI.warn} Uso:\n/renovaciones hoy\n/renovaciones dd/mm/yyyy\n/renovaciones NOMBRE dd/mm/yyyy`);
    }
  }

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  return bot.sendMessage(chatId, renovacionesTexto(list, fecha, vendedor || null));
});

// /txt hoy | dd/mm/yyyy | NOMBRE dd/mm/yyyy
bot.onText(/\/txt(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

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
      return bot.sendMessage(chatId, `${EMOJI.warn} Uso:\n/txt hoy\n/txt dd/mm/yyyy\n/txt NOMBRE dd/mm/yyyy`);
    }
  }

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  return enviarTXT(chatId, list, fecha, vendedor || null);
});

// ===============================
// START / MENU
// ===============================
bot.onText(/\/start|\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return menuPrincipal(chatId);
});

// Acceso rapido por /netflix etc
PLATAFORMAS.forEach((p) => {
  bot.onText(new RegExp("^\\/" + p + "$", "i"), async (msg) => {
    const chatId = msg.chat.id;
    if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return enviarInventarioPlataforma(chatId, p, 0);
  });
});

// /stock
bot.onText(/\/stock/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarStockGeneral(chatId);
});

// ===============================
// CALLBACKS (BOTONES) — incluye los 3 que pediste
// ===============================
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const data = q.data || "";

  try {
    await bot.answerCallbackQuery(q.id);

    if (!chatId) return;
    if (!(await isAdmin(q.from.id))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    // Inicio
    if (data === "go:inicio") return menuPrincipal(chatId);

    // Menus
    if (data === "menu:inventario") return menuInventario(chatId);
    if (data === "menu:clientes") return menuClientes(chatId);
    if (data === "menu:pagos") return menuPagos(chatId);
    if (data === "menu:renovaciones") return menuRenovaciones(chatId);
    if (data === "menu:buscar") return bot.sendMessage(chatId, `Usa: /buscar texto`);

    // Inventario
    if (data === "inv:general") return mostrarStockGeneral(chatId);
    if (data.startsWith("inv:")) {
      const [, plat, pageStr] = data.split(":");
      return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
    }

    // Renovaciones rápidas
    if (data === "ren:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, null);
      return bot.sendMessage(chatId, renovacionesTexto(list, fecha, null));
    }
    if (data === "txt:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, null);
      return enviarTXT(chatId, list, fecha, null);
    }

    // Clientes menú
    if (data === "cli:nuevo") return wizardStartNuevoCliente(chatId);
    if (data === "cli:ver") return bot.sendMessage(chatId, `Usa: /cliente TELEFONO`);
    if (data === "cli:txt") return bot.sendMessage(chatId, `Usa: /clientes_txt`);

    // WIZ callbacks
    if (data === "wiz:otra") {
      const st = wizard.get(String(chatId));
      if (!st || st.mode !== "nuevo") return;
      st.step = 10;
      st.sub = {};
      return bot.sendMessage(chatId, "Plataforma:");
    }
    if (data === "wiz:fin") return wizardFinalizarNuevo(chatId);

    // ===============================
    // ✅ 3 CALLBACKS IMPORTANTES (LOS ULTIMOS)
    // ===============================

    // 1) VER FICHA (desde buscar)
    if (data.startsWith("cli:view:")) {
      const id = data.split(":")[2];
      const doc = await db.collection("clientes").doc(id).get();
      if (!doc.exists) return bot.sendMessage(chatId, `${EMOJI.warn} Cliente no encontrado.`);
      return enviarFichaCliente(chatId, doc);
    }

    // 2) AGREGAR PLATAFORMA al mismo cliente
    if (data.startsWith("cli:add:")) {
      const id = data.split(":")[2];
      return wizardStartAgregarServicio(chatId, id);
    }

    // 3) ELIMINAR SERVICIO escogiendo plataforma/correo
    if (data.startsWith("cli:del:")) {
      const id = data.split(":")[2];
      const doc = await db.collection("clientes").doc(id).get();
      if (!doc.exists) return bot.sendMessage(chatId, `${EMOJI.warn} Cliente no encontrado.`);

      const c = doc.data() || {};
      const sus = Array.isArray(c.suscripciones) ? c.suscripciones : [];
      if (sus.length === 0) return bot.sendMessage(chatId, `${EMOJI.warn} No hay servicios para eliminar.`);

      const botones = sus.map((s, i) => [
        { text: `${EMOJI.trash} ${s.plataforma} — ${s.correo}`, callback_data: `cli:delserv:${id}:${i}` },
      ]);

      botones.push([{ text: `${EMOJI.back} Volver`, callback_data: `cli:view:${id}` }]);

      return bot.sendMessage(chatId, "Selecciona el servicio a eliminar:", { reply_markup: { inline_keyboard: botones } });
    }

    if (data.startsWith("cli:delserv:")) {
      const [, , id, idxStr] = data.split(":");
      const index = Number(idxStr);

      const ref = db.collection("clientes").doc(id);
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, `${EMOJI.warn} Cliente no encontrado.`);

      const c = doc.data() || {};
      const sus = Array.isArray(c.suscripciones) ? [...c.suscripciones] : [];
      if (!sus[index]) return bot.sendMessage(chatId, `${EMOJI.warn} Servicio no encontrado.`);

      const eliminado = sus.splice(index, 1)[0];
      await ref.set({ suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      await bot.sendMessage(chatId, `${EMOJI.ok} Servicio eliminado:\n${eliminado.plataforma}\n${eliminado.correo}`);
      const doc2 = await ref.get();
      return enviarFichaCliente(chatId, doc2);
    }

    // Renovar servicio (botón por servicio)
    if (data.startsWith("cli:ren:")) {
      const [, , id, idxStr] = data.split(":");
      const index = Number(idxStr);

      const ref = db.collection("clientes").doc(id);
      const doc = await ref.get();
      if (!doc.exists) return bot.sendMessage(chatId, `${EMOJI.warn} Cliente no encontrado.`);

      const c = doc.data() || {};
      const sus = Array.isArray(c.suscripciones) ? [...c.suscripciones] : [];
      if (!sus[index]) return bot.sendMessage(chatId, `${EMOJI.warn} Servicio no encontrado.`);

      const s = sus[index];
      const nuevaFecha = addDaysDMY(String(s.fechaRenovacion || hoyDMY()), 30);

      // Confirmación rápida
      sus[index] = { ...s, fechaRenovacion: nuevaFecha };
      await ref.set({ suscripciones: sus, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      // Guardar pago
      await db.collection("pagos").add({
        nombrePerfil: c.nombrePerfil || "-",
        telefono: c.telefono || "-",
        vendedor: c.vendedor || "-",
        plataforma: s.plataforma || "-",
        correo: s.correo || "-",
        monto: Number(s.precio || 0),
        moneda: "Lps",
        fechaNueva: nuevaFecha,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await bot.sendMessage(chatId, `${EMOJI.ok} RENOVADO\nNueva fecha: ${nuevaFecha}\nPago guardado.`);
      const doc2 = await ref.get();
      return enviarFichaCliente(chatId, doc2);
    }

    return bot.sendMessage(chatId, `${EMOJI.warn} Accion no reconocida.`);
  } catch (err) {
    console.log("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, `${EMOJI.warn} Error interno (revise logs).`);
  }
});

// ===============================
// MENSAJES (wizard)
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const text = msg.text || "";
  if (!chatId) return;
  if (text.startsWith("/")) return;

  // solo si wizard activo
  if (wizard.has(String(chatId))) {
    if (!(await isAdmin(msg.from.id))) return;
    return wizardHandle(chatId, text);
  }
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

setInterval(() => console.log("🟢 Bot activo..."), 60000);
