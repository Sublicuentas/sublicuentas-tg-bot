/**
 * Sublicuentas Inventario Bot - index.js (FINAL)
 * - Búsqueda directa (sin /buscar)
 * - Ficha cliente + botones + callbacks
 * - Editar cliente (nombre/telefono/vendedor/fecha renovación por plataforma)
 * - Renovar con confirmación final
 * - Eliminar perfil por plataforma
 * - Reporte TXT general de clientes
 * - Inventario DISNEYP arreglado (alias + addp/delp + lista stock paginada)
 */

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

// ===============================
// ✅ ENV
// ===============================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("FALTA BOT_TOKEN en .env");
  process.exit(1);
}

if (!admin.apps.length) {
  // Usa GOOGLE_APPLICATION_CREDENTIALS o serviceAccount JSON (si lo usas así)
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===============================
// ✅ CONFIG COLECCIONES
// ===============================
const COL_CLIENTES = "clientes";
const COL_INVENTARIO = "inventario";

// ===============================
// ✅ UTILIDADES
// ===============================
function isAdmin(userId) {
  if (!ADMIN_IDS.length) return true; // si no configuras ADMIN_IDS, deja pasar
  return ADMIN_IDS.includes(String(userId));
}

function _norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function _isPhone(s) {
  const t = String(s || "").trim();
  return /^[0-9]{7,15}$/.test(t);
}

function _isEmail(s) {
  const t = String(s || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function toPlatformKey(raw) {
  const t = _norm(raw);
  const map = {
    disneyp: "DISNEYP",
    disney: "DISNEYP",
    disp: "DISNEYP",
    netflix: "NETFLIX",
    prime: "PRIME",
    hbo: "HBO",
    hbomax: "HBO",
    crunchyroll: "CRUNCHYROLL",
  };
  return map[t] || raw?.toUpperCase()?.trim();
}

// ===============================
// ✅ ESTADO (WIZARDS / ACCIONES)
// ===============================
/**
 * state[userId] = {
 *   mode: "ADD_CLIENT" | "ADD_SERVICE" | "EDIT_NAME" | "EDIT_PHONE" | "EDIT_SELLER"
 *         | "RENEW_PICK_PLATFORM" | "RENEW_SET_DATE" | "RENEW_CONFIRM"
 *         | "DEL_PICK_PLATFORM" | "EDIT_REN_DATE_PICK_PLATFORM" | "EDIT_REN_DATE_SET"
 *         | "MENU_SEARCH"
 *   payload: {...}
 * }
 */
const state = {};

// ===============================
// ✅ MENUS
// ===============================
function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: "📦 Inventario" }, { text: "👥 Clientes" }],
      [{ text: "📅 Renovaciones" }, { text: "🔎 Buscar" }],
      [{ text: "💳 Pagos" }, { text: "🏠 Inicio" }],
    ],
    resize_keyboard: true,
  };
}

function clientesMenuKeyboard() {
  return {
    keyboard: [
      [{ text: "➕ Nuevo cliente" }],
      [{ text: "🔎 Buscar (abre ficha)" }],
      [{ text: "📄 Reporte TXT" }],
      [{ text: "🏠 Inicio" }],
    ],
    resize_keyboard: true,
  };
}

function inventarioMenuKeyboard() {
  return {
    keyboard: [
      [{ text: "📌 DISNEYP Stock" }],
      [{ text: "🏠 Inicio" }],
    ],
    resize_keyboard: true,
  };
}

// ===============================
// ✅ FICHA CLIENTE
// ===============================
async function getClienteById(id) {
  const doc = await db.collection(COL_CLIENTES).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Estructura esperada cliente:
 * {
 *   nombre: "Nicole Tomas",
 *   telefono: "96073931",
 *   vendedor: "Relojes",
 *   servicios: [
 *     { plataforma:"NETFLIX", correo:"x@x.com", precio:120, renueva:"14/03/2026" },
 *     ...
 *   ]
 * }
 */
function renderServicios(servicios = []) {
  if (!Array.isArray(servicios) || servicios.length === 0) return "— Sin servicios —";
  let out = "";
  servicios.forEach((s, i) => {
    out += `${i + 1}) ${String(s.plataforma || "-").toLowerCase()} — ${s.correo || "-"} — ${s.precio || "-"} Lps — Renueva: ${s.renueva || "-"}\n`;
  });
  return out.trim();
}

async function enviarFichaCliente(chatId, cliente) {
  const nombre = (cliente.nombre || "-").trim();
  const telefono = String(cliente.telefono || "-").trim();
  const vendedor = (cliente.vendedor || "-").trim();

  const texto =
`✅ Cliente
Datos del cliente:
${nombre}
${telefono}
${vendedor}

SERVICIOS:
${renderServicios(cliente.servicios || [])}`;

  const kb = {
    inline_keyboard: [
      [{ text: "➕ Agregar plataforma", callback_data: `cli_add:${cliente.id}` }],
      [
        { text: "🔄 Renovar", callback_data: `cli_ren:${cliente.id}` },
        { text: "❌ Eliminar perfil", callback_data: `cli_del:${cliente.id}` },
      ],
      [{ text: "✏️ Editar cliente", callback_data: `cli_edit:${cliente.id}` }],
      [{ text: "🏠 Inicio", callback_data: `go_home` }],
    ],
  };

  return bot.sendMessage(chatId, texto, { reply_markup: kb });
}

// ===============================
// ✅ BUSQUEDA CLIENTE (nombre / telefono)
// ===============================
async function buscarClientePorTelefono(telefono) {
  const q = String(telefono).trim();
  const snap = await db.collection(COL_CLIENTES).where("telefono", "==", q).limit(5).get();
  if (!snap.empty) return snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // fallback scan (por si tienes números como number o con espacios)
  const all = await db.collection(COL_CLIENTES).limit(3000).get();
  const out = [];
  all.forEach(doc => {
    const c = doc.data() || {};
    if (String(c.telefono || "").trim() === q) out.push({ id: doc.id, ...c });
  });
  return out.slice(0, 5);
}

async function buscarClientesPorNombre(nombre) {
  const q = _norm(nombre);
  const all = await db.collection(COL_CLIENTES).limit(3000).get();
  const out = [];
  all.forEach(doc => {
    const c = doc.data() || {};
    const nom = _norm(c.nombre || "");
    if (nom && nom.includes(q)) out.push({ id: doc.id, ...c });
  });
  return out.slice(0, 10);
}

// ===============================
// ✅ BUSQUEDA INVENTARIO POR CORREO (DISNEYP incluido)
// ===============================
async function buscarInventarioPorCorreo(correoRaw) {
  const q = String(correoRaw || "").trim().toLowerCase();
  const exact = await db.collection(COL_INVENTARIO).where("correo", "==", q).limit(50).get();
  if (!exact.empty) return exact.docs.map(d => ({ id: d.id, ...d.data() }));

  // fallback scan (por si hubo casos raros)
  const all = await db.collection(COL_INVENTARIO).limit(3000).get();
  const out = [];
  all.forEach(doc => {
    const x = doc.data() || {};
    const c = String(x.correo || "").trim().toLowerCase();
    if (c === q) out.push({ id: doc.id, ...x });
  });
  return out.slice(0, 50);
}

// ===============================
// ✅ INVENTARIO DISNEYP (STOCK)
// ===============================
async function getStockByPlatform(platformKey) {
  const plat = toPlatformKey(platformKey);
  const snap = await db.collection(COL_INVENTARIO).where("plataforma", "==", plat).get();
  const out = [];
  snap.forEach(doc => out.push({ id: doc.id, ...doc.data() }));
  // stock = disp > 0
  return out.filter(x => Number(x.disp || 0) > 0);
}

function renderStockPage(platformKey, items, page = 1, perPage = 10) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(totalPages, Math.max(1, page));
  const start = (p - 1) * perPage;
  const slice = items.slice(start, start + perPage);

  let t = `📌 ${platformKey} — STOCK DISPONIBLE\nMostrando ${start + 1}-${start + slice.length} de ${total}\n\n`;
  slice.forEach((x, i) => {
    t += `${start + i + 1}) ${x.correo} — 🔑 ${x.clave || "-"} — ${Number(x.disp || 0)}/${Number(x.total || 0)}\n`;
  });

  t += `\n————————————\n📊 Cuentas con stock: ${total}\n👥 Perfiles libres totales: ${items.reduce((a, b) => a + Number(b.disp || 0), 0)}\n📄 Página: ${p}/${totalPages}`;

  const kb = {
    inline_keyboard: [
      [
        { text: "⬅️ Atrás", callback_data: `stk:${platformKey}:${p - 1}` },
        { text: "🏠 Inicio", callback_data: `go_home` },
        { text: "➡️ Siguiente", callback_data: `stk:${platformKey}:${p + 1}` },
      ],
      [{ text: "🔄 Actualizar", callback_data: `stk:${platformKey}:${p}` }],
      [{ text: "↩️ Volver Inventario", callback_data: `go_inv` }],
    ],
  };

  return { text: t, reply_markup: kb, page: p, totalPages };
}

// ===============================
// ✅ REPORTE TXT CLIENTES
// ===============================
async function generarReporteClientesTXT() {
  const snap = await db.collection(COL_CLIENTES).orderBy("nombre", "asc").get();
  let i = 1;
  let txt = "REPORTE GENERAL DE CLIENTES - SUBLICUENTAS\n\n";
  snap.forEach(doc => {
    const c = doc.data() || {};
    const n = String(c.nombre || "-").trim();
    const t = String(c.telefono || "-").trim();
    txt += `${String(i).padStart(2, "0")}) ${n} — ${t}\n`;
    i++;
  });
  txt += `\nTOTAL CLIENTES: ${i - 1}\n`;
  return txt;
}

async function enviarReporteTXT(chatId) {
  const txt = await generarReporteClientesTXT();
  const buffer = Buffer.from(txt, "utf-8");
  return bot.sendDocument(chatId, buffer, {}, { filename: "reporte_clientes.txt", contentType: "text/plain" });
}

// ===============================
// ✅ COMANDOS BASE
// ===============================
bot.onText(/\/start/i, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id, "🏠 MENU PRINCIPAL", { reply_markup: mainMenuKeyboard() });
});

bot.onText(/\/menu/i, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id, "🏠 MENU PRINCIPAL", { reply_markup: mainMenuKeyboard() });
});

// ===============================
// ✅ ADDP / DELP (inventario)
// Formato recomendado:
// /addp correo clave total plataforma
// ej: /addp fantastico@capuchino.lat subli2 6 disneyp
//
// /delp correo plataforma cantidad
// ej: /delp fantastico@capuchino.lat disneyp 2
// ===============================
bot.onText(/\/addp\s+(.+)/i, async (msg, match) => {
  try {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    const parts = String(match[1] || "").trim().split(/\s+/);

    const correo = (parts[0] || "").toLowerCase();
    const clave = parts[1] || "";
    const total = Number(parts[2] || 0);
    const plataforma = toPlatformKey(parts[3] || "");

    if (!_isEmail(correo) || !clave || !total || !plataforma) {
      return bot.sendMessage(chatId, "⚠️ Uso: /addp correo clave total plataforma\nEj: /addp fantastico@capuchino.lat subli2 6 disneyp");
    }

    // Doc id estable: plataforma__correo
    const docId = `${plataforma}__${correo}`.toLowerCase();
    const ref = db.collection(COL_INVENTARIO).doc(docId);
    const doc = await ref.get();

    if (!doc.exists) {
      await ref.set({
        plataforma,
        correo,
        clave,
        total,
        disp: total,
        estado: total > 0 ? "ACTIVA" : "LLENA",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const d = doc.data() || {};
      const newTotal = total;
      const newDisp = Math.max(0, Number(d.disp || 0) + 1); // si lo quieres distinto me dices
      await ref.update({
        clave,
        total: newTotal,
        disp: newDisp,
        estado: newDisp > 0 ? "ACTIVA" : "LLENA",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return bot.sendMessage(chatId, `✅ Actualizado\n📌 ${plataforma}\n📧 ${correo}\n👥 Disponibles: (revise con /${_norm(plataforma)})`);
  } catch (e) {
    console.error("addp error:", e);
    return bot.sendMessage(msg.chat.id, "❌ Error en /addp (revise logs).");
  }
});

bot.onText(/\/delp\s+(.+)/i, async (msg, match) => {
  try {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    const parts = String(match[1] || "").trim().split(/\s+/);

    const correo = (parts[0] || "").toLowerCase();
    const plataforma = toPlatformKey(parts[1] || "");
    const cantidad = Number(parts[2] || 1);

    if (!_isEmail(correo) || !plataforma || !cantidad) {
      return bot.sendMessage(chatId, "⚠️ Uso: /delp correo plataforma cantidad\nEj: /delp fantastico@capuchino.lat disneyp 2");
    }

    const docId = `${plataforma}__${correo}`.toLowerCase();
    const ref = db.collection(COL_INVENTARIO).doc(docId);
    const doc = await ref.get();

    if (!doc.exists) return bot.sendMessage(chatId, "⚠️ No encontré ese correo en esa plataforma.");

    const d = doc.data() || {};
    const disp = Number(d.disp || 0);
    const newDisp = Math.max(0, disp + cantidad); // delp = liberar perfiles
    await ref.update({
      disp: newDisp,
      estado: newDisp > 0 ? "ACTIVA" : "LLENA",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return bot.sendMessage(chatId, `✅ Actualizado\n📌 ${plataforma}\n📧 ${correo}\n👥 Disponibles: ${newDisp}/${Number(d.total || 0)}`);
  } catch (e) {
    console.error("delp error:", e);
    return bot.sendMessage(msg.chat.id, "❌ Error en /delp (revise logs).");
  }
});

// ===============================
// ✅ LISTA STOCK DISNEYP
// Comando: /disneyp  ó  /disney
// ===============================
async function enviarStock(msg, platformRaw) {
  const chatId = msg.chat.id;
  const platformKey = toPlatformKey(platformRaw);
  const items = await getStockByPlatform(platformKey);
  const page = 1;
  const rendered = renderStockPage(platformKey, items, page, 10);
  return bot.sendMessage(chatId, rendered.text, { reply_markup: rendered.reply_markup });
}

bot.onText(/\/disneyp/i, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  return enviarStock(msg, "DISNEYP");
});
bot.onText(/\/disney/i, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  return enviarStock(msg, "DISNEYP");
});

// ===============================
// ✅ MENÚS POR TEXTO
// ===============================
bot.on("message", async (msg) => {
  try {
    if (!msg.text) return;
    if (!isAdmin(msg.from.id)) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = String(msg.text || "").trim();

    // --- Menú botones
    if (text === "🏠 Inicio") {
      state[userId] = null;
      return bot.sendMessage(chatId, "🏠 MENU PRINCIPAL", { reply_markup: mainMenuKeyboard() });
    }
    if (text === "👥 Clientes") {
      state[userId] = null;
      return bot.sendMessage(chatId, "👥 CLIENTES", { reply_markup: clientesMenuKeyboard() });
    }
    if (text === "📦 Inventario") {
      state[userId] = null;
      return bot.sendMessage(chatId, "📦 INVENTARIO", { reply_markup: inventarioMenuKeyboard() });
    }
    if (text === "📌 DISNEYP Stock") {
      state[userId] = null;
      return enviarStock(msg, "DISNEYP");
    }
    if (text === "📄 Reporte TXT") {
      state[userId] = null;
      return enviarReporteTXT(chatId);
    }
    if (text === "🔎 Buscar" || text === "🔎 Buscar (abre ficha)") {
      state[userId] = { mode: "MENU_SEARCH", payload: {} };
      return bot.sendMessage(chatId, "🔎 Escriba nombre, teléfono o correo y le abro la ficha directo (sin /buscar).");
    }

    // --- Si está en un modo (edición/renovación/etc)
    const st = state[userId];
    if (st?.mode) {
      // EDICIONES
      if (st.mode === "EDIT_NAME") {
        const id = st.payload.clienteId;
        await db.collection(COL_CLIENTES).doc(id).update({ nombre: text });
        state[userId] = null;
        const c = await getClienteById(id);
        return enviarFichaCliente(chatId, c);
      }
      if (st.mode === "EDIT_PHONE") {
        const id = st.payload.clienteId;
        await db.collection(COL_CLIENTES).doc(id).update({ telefono: text });
        state[userId] = null;
        const c = await getClienteById(id);
        return enviarFichaCliente(chatId, c);
      }
      if (st.mode === "EDIT_SELLER") {
        const id = st.payload.clienteId;
        await db.collection(COL_CLIENTES).doc(id).update({ vendedor: text });
        state[userId] = null;
        const c = await getClienteById(id);
        return enviarFichaCliente(chatId, c);
      }

      // Renovar set date
      if (st.mode === "RENEW_SET_DATE") {
        const { clienteId, plataforma } = st.payload;
        const fecha = text;

        // guarda temporal y pide confirmación
        state[userId] = {
          mode: "RENEW_CONFIRM",
          payload: { clienteId, plataforma, fecha },
        };

        const kb = {
          inline_keyboard: [
            [{ text: "✅ Confirmar renovación", callback_data: `ren_ok:${clienteId}:${plataforma}:${fecha}` }],
            [{ text: "❌ Cancelar", callback_data: `ren_cancel:${clienteId}` }],
          ],
        };

        return bot.sendMessage(chatId, `🔄 Renovar ${plataforma}\nNueva fecha: ${fecha}\n\n¿Confirmar?`, { reply_markup: kb });
      }

      // Editar fecha renovación (por plataforma)
      if (st.mode === "EDIT_REN_DATE_SET") {
        const { clienteId, plataforma } = st.payload;
        const fecha = text;

        const c = await getClienteById(clienteId);
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        const nuevos = servicios.map(s =>
          String(s.plataforma || "").toUpperCase() === plataforma ? { ...s, renueva: fecha } : s
        );

        await db.collection(COL_CLIENTES).doc(clienteId).update({ servicios: nuevos });
        state[userId] = null;

        const updated = await getClienteById(clienteId);
        return enviarFichaCliente(chatId, updated);
      }

      // Si está buscando desde menú, deja seguir al buscador directo de abajo
    }

    // ===============================
    // ✅ BUSQUEDA DIRECTA (SIN /buscar)
    // - si es comando conocido, NO tocar
    // ===============================
    const lower = text.toLowerCase();
    const comandosConocidos = [
      "/start", "/menu", "/disneyp", "/disney", "/addp", "/delp",
    ];
    const first = lower.split(" ")[0];
    if (text.startsWith("/") && comandosConocidos.includes(first)) return;

    // Si viene como "/algo" sin comando, úsalo como búsqueda directa
    let q = text;
    if (q.startsWith("/") && !q.includes(" ")) q = q.slice(1).trim();
    if (!q) return;

    // 1) correo => inventario (te muestra dónde está)
    if (_isEmail(q)) {
      const inv = await buscarInventarioPorCorreo(q);
      if (inv.length === 0) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
      let t = `📌 INVENTARIO (correo)\n${q}\n\n`;
      inv.forEach((x, i) => {
        t += `${i + 1}) ${String(x.plataforma || "-").toUpperCase()} — ${x.correo} — ${Number(x.disp || 0)}/${Number(x.total || 0)} — ${String(x.estado || "-")}\n`;
      });
      return bot.sendMessage(chatId, t.trim());
    }

    // 2) teléfono => ficha cliente
    if (_isPhone(q)) {
      const encontrados = await buscarClientePorTelefono(q);
      if (encontrados.length === 0) return bot.sendMessage(chatId, "⚠️ No encontré ese teléfono.");
      if (encontrados.length === 1) return enviarFichaCliente(chatId, encontrados[0]);

      const kb = {
        inline_keyboard: encontrados.slice(0, 5).map(c => ([
          { text: `📌 ${c.nombre || "-"} (${c.telefono || "-"})`, callback_data: `ver_cli:${c.id}` }
        ]))
      };
      return bot.sendMessage(chatId, "🔎 Encontré varios. Elija:", { reply_markup: kb });
    }

    // 3) nombre => ficha si único, si no lista
    const lista = await buscarClientesPorNombre(q);
    if (lista.length === 0) return bot.sendMessage(chatId, "⚠️ No encontré ese nombre.");
    if (lista.length === 1) return enviarFichaCliente(chatId, lista[0]);

    const kb = {
      inline_keyboard: lista.slice(0, 10).map(c => ([
        { text: `✅ ${c.nombre || "-"} — ${c.telefono || "-"}`, callback_data: `ver_cli:${c.id}` }
      ]))
    };
    return bot.sendMessage(chatId, `🔎 Coincidencias para: ${q}\nElija cliente:`, { reply_markup: kb });

  } catch (e) {
    console.error("message handler error:", e);
  }
});

// ===============================
// ✅ CALLBACKS (BOTONES)
// ===============================
bot.on("callback_query", async (q) => {
  try {
    const chatId = q.message.chat.id;
    const userId = q.from.id;
    if (!isAdmin(userId)) return bot.answerCallbackQuery(q.id);

    const data = String(q.data || "");

    // Navegación
    if (data === "go_home") {
      await bot.answerCallbackQuery(q.id);
      state[userId] = null;
      return bot.sendMessage(chatId, "🏠 MENU PRINCIPAL", { reply_markup: mainMenuKeyboard() });
    }
    if (data === "go_inv") {
      await bot.answerCallbackQuery(q.id);
      state[userId] = null;
      return bot.sendMessage(chatId, "📦 INVENTARIO", { reply_markup: inventarioMenuKeyboard() });
    }

    // Stock pagination
    if (data.startsWith("stk:")) {
      const [, platformKey, pageStr] = data.split(":");
      const page = Number(pageStr || 1);
      const items = await getStockByPlatform(platformKey);
      const rendered = renderStockPage(platformKey, items, page, 10);

      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText(rendered.text, {
        chat_id: chatId,
        message_id: q.message.message_id,
        reply_markup: rendered.reply_markup,
      });
    }

    // abrir ficha desde lista
    if (data.startsWith("ver_cli:")) {
      const id = data.split(":")[1];
      const c = await getClienteById(id);
      await bot.answerCallbackQuery(q.id);
      if (!c) return bot.sendMessage(chatId, "⚠️ No existe.");
      return enviarFichaCliente(chatId, c);
    }

    // --- Ficha acciones
    if (data.startsWith("cli_edit:")) {
      const id = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);

      const kb = {
        inline_keyboard: [
          [{ text: "🧑 Cambiar nombre", callback_data: `edit_name:${id}` }],
          [{ text: "📱 Cambiar teléfono", callback_data: `edit_phone:${id}` }],
          [{ text: "👨‍💼 Cambiar vendedor", callback_data: `edit_seller:${id}` }],
          [{ text: "📅 Fecha renovación", callback_data: `edit_ren_pick:${id}` }],
          [{ text: "⬅️ Volver", callback_data: `ver_cli:${id}` }],
        ],
      };

      return bot.sendMessage(chatId, "✏️ EDITAR CLIENTE\n\nSeleccione una opción:", { reply_markup: kb });
    }

    if (data.startsWith("edit_name:")) {
      const id = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);
      state[userId] = { mode: "EDIT_NAME", payload: { clienteId: id } };
      return bot.sendMessage(chatId, "🧑 Escriba el nuevo nombre:");
    }

    if (data.startsWith("edit_phone:")) {
      const id = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);
      state[userId] = { mode: "EDIT_PHONE", payload: { clienteId: id } };
      return bot.sendMessage(chatId, "📱 Escriba el nuevo teléfono (solo números):");
    }

    if (data.startsWith("edit_seller:")) {
      const id = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);
      state[userId] = { mode: "EDIT_SELLER", payload: { clienteId: id } };
      return bot.sendMessage(chatId, "👨‍💼 Escriba el nuevo vendedor:");
    }

    // Editar fecha renovación (elige plataforma del cliente)
    if (data.startsWith("edit_ren_pick:")) {
      const id = data.split(":")[1];
      const c = await getClienteById(id);
      await bot.answerCallbackQuery(q.id);

      const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
      if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

      const kb = {
        inline_keyboard: servicios.map(s => ([
          { text: `📅 ${String(s.plataforma || "-").toLowerCase()}`, callback_data: `edit_ren_set:${id}:${String(s.plataforma || "").toUpperCase()}` }
        ])).concat([[{ text: "⬅️ Volver", callback_data: `cli_edit:${id}` }]])
      };

      return bot.sendMessage(chatId, "📅 Seleccione plataforma para cambiar fecha:", { reply_markup: kb });
    }

    if (data.startsWith("edit_ren_set:")) {
      const [, id, plataforma] = data.split(":");
      await bot.answerCallbackQuery(q.id);
      state[userId] = { mode: "EDIT_REN_DATE_SET", payload: { clienteId: id, plataforma } };
      return bot.sendMessage(chatId, `📅 Escriba nueva fecha para ${plataforma} (dd/mm/yyyy):`);
    }

    // Renovar (elige plataforma) => pide fecha => confirmación final
    if (data.startsWith("cli_ren:")) {
      const id = data.split(":")[1];
      const c = await getClienteById(id);
      await bot.answerCallbackQuery(q.id);

      const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
      if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

      const kb = {
        inline_keyboard: servicios.map(s => ([
          { text: `🔄 Renovar ${String(s.plataforma || "-").toLowerCase()}`, callback_data: `ren_pick:${id}:${String(s.plataforma || "").toUpperCase()}` }
        ])).concat([[{ text: "⬅️ Volver", callback_data: `ver_cli:${id}` }]])
      };

      return bot.sendMessage(chatId, "🔄 RENOVAR SERVICIO\nSeleccione plataforma:", { reply_markup: kb });
    }

    if (data.startsWith("ren_pick:")) {
      const [, id, plataforma] = data.split(":");
      await bot.answerCallbackQuery(q.id);
      state[userId] = { mode: "RENEW_SET_DATE", payload: { clienteId: id, plataforma } };
      return bot.sendMessage(chatId, `🔄 Renovar ${plataforma}\nEscriba nueva fecha (dd/mm/yyyy):`);
    }

    if (data.startsWith("ren_ok:")) {
      const [, id, plataforma, fecha] = data.split(":");
      await bot.answerCallbackQuery(q.id);

      const c = await getClienteById(id);
      const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
      const nuevos = servicios.map(s =>
        String(s.plataforma || "").toUpperCase() === plataforma ? { ...s, renueva: fecha } : s
      );
      await db.collection(COL_CLIENTES).doc(id).update({ servicios: nuevos });
      state[userId] = null;

      const updated = await getClienteById(id);
      return enviarFichaCliente(chatId, updated);
    }

    if (data.startsWith("ren_cancel:")) {
      const id = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);
      state[userId] = null;
      const c = await getClienteById(id);
      return enviarFichaCliente(chatId, c);
    }

    // Eliminar perfil (elige plataforma del cliente)
    if (data.startsWith("cli_del:")) {
      const id = data.split(":")[1];
      const c = await getClienteById(id);
      await bot.answerCallbackQuery(q.id);

      const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
      if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

      const kb = {
        inline_keyboard: servicios.map(s => ([
          { text: `❌ Eliminar ${String(s.plataforma || "-").toLowerCase()}`, callback_data: `del_ok:${id}:${String(s.plataforma || "").toUpperCase()}` }
        ])).concat([[{ text: "⬅️ Volver", callback_data: `ver_cli:${id}` }]])
      };

      return bot.sendMessage(chatId, "❌ ELIMINAR PERFIL\nSeleccione plataforma:", { reply_markup: kb });
    }

    if (data.startsWith("del_ok:")) {
      const [, id, plataforma] = data.split(":");
      await bot.answerCallbackQuery(q.id);

      const c = await getClienteById(id);
      const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
      const nuevos = servicios.filter(s => String(s.plataforma || "").toUpperCase() !== plataforma);

      await db.collection(COL_CLIENTES).doc(id).update({ servicios: nuevos });
      const updated = await getClienteById(id);
      return enviarFichaCliente(chatId, updated);
    }

    return bot.answerCallbackQuery(q.id);

  } catch (e) {
    console.error("callback error:", e);
    try { await bot.answerCallbackQuery(q.id); } catch {}
  }
});

// ===============================
// ✅ LOGS
// ===============================
bot.on("polling_error", (err) => console.error("polling_error:", err));
console.log("✅ Bot activo.");
