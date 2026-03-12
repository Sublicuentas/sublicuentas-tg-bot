/*
 ✅ SUBLICUENTAS TG BOT — INDEX FINAL (BLINDADO v12)
 ✅ FIX 409 menú / editMessageText
 ✅ FIX crash por archivo cortado
 ✅ FIX http duplicado
 ✅ /menu visible en punto actual
 ✅ Admin/SuperAdmin completo
 ✅ Vendedor: renovaciones + TXT + clientes propios
 ✅ Auto TXT 7:00 AM
 ✅ Inventario + Clientes + Renovaciones + Revendedores
 ✅ CRM CLIENTE
 ✅ BLOQUEO DUPLICADOS
 ✅ FIX MARKDOWN EN CORREOS / NOMBRES
 ✅ FIX WIZARD FINALIZAR
 ✅ RENOVAR TODOS +30
 ✅ INVENTARIO REAL POR CLIENTES EN CADA CORREO
 ✅ FIX CORREOS SIN \\.COM
 ✅ FIX CORREOS CON _ Y SUBDOMINIOS
 ✅ BOT ULTRA BLINDADO CONTRA 409
 ✅ LOCK GLOBAL FIRESTORE CONTRA DOBLE INSTANCIA
 ✅ REINTENTO AUTOMÁTICO DE LIDERAZGO
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
const SUPER_ADMIN = String(process.env.SUPER_ADMIN || "").trim();
const TZ = process.env.TZ || "America/Tegucigalpa";

if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN");

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error("Faltan variables Firebase");
}

// ===============================
// FIREBASE
// ===============================
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();
console.log("✅ FIREBASE PROJECT:", FIREBASE_PROJECT_ID);

// ===============================
// LOCK GLOBAL DE INSTANCIA
// ===============================
const INSTANCE_ID = `${process.env.RENDER_INSTANCE_ID || "inst"}_${process.pid}_${Date.now()}`;
const LOCK_DOC_REF = db.collection("config").doc("bot_runtime_lock");
const LOCK_TTL_MS = 90 * 1000;

let LOCK_HEARTBEAT = null;
let LEADER_RETRY_TIMEOUT = null;
let HAS_RUNTIME_LOCK = false;
let NETFLIX_LISTENER_STARTED = false;

// ===============================
// LOCK ACQUIRE
// ===============================
async function acquireRuntimeLock() {
  try {

    const now = Date.now();

    const ok = await db.runTransaction(async (tx) => {

      const snap = await tx.get(LOCK_DOC_REF);
      const data = snap.exists ? snap.data() || {} : {};

      const holder = String(data.holder || "");
      const expiresAt = Number(data.expiresAt || 0);

      const libre =
        !holder ||
        expiresAt < now ||
        holder === INSTANCE_ID;

      if (!libre) return false;

      tx.set(
        LOCK_DOC_REF,
        {
          holder: INSTANCE_ID,
          pid: process.pid,
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          heartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: now + LOCK_TTL_MS,
        },
        { merge: true }
      );

      return true;
    });

    HAS_RUNTIME_LOCK = !!ok;

    if (HAS_RUNTIME_LOCK) {
      console.log(`🔒 Lock tomado por ${INSTANCE_ID}`);
    } else {
      console.log(`⛔ Lock ocupado por otra instancia. Esta instancia queda pasiva por ahora.`);
    }

    return HAS_RUNTIME_LOCK;

  } catch (e) {

    console.error("❌ Error acquireRuntimeLock:", e?.message || e);
    HAS_RUNTIME_LOCK = false;
    return false;

  }
}

// ===============================
// REFRESH LOCK
// ===============================
async function refreshRuntimeLock() {

  if (!HAS_RUNTIME_LOCK) return false;

  try {

    const now = Date.now();

    await db.runTransaction(async (tx) => {

      const snap = await tx.get(LOCK_DOC_REF);
      const data = snap.exists ? snap.data() || {} : {};

      if (String(data.holder || "") !== INSTANCE_ID) {
        throw new Error("Lock perdido");
      }

      tx.set(
        LOCK_DOC_REF,
        {
          heartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: now + LOCK_TTL_MS,
        },
        { merge: true }
      );
    });

    return true;

  } catch (e) {

    console.error("❌ Error refreshRuntimeLock:", e?.message || e);

    HAS_RUNTIME_LOCK = false;

    startLeaderRetryLoop(15000);

    return false;

  }
}

// ===============================
// RELEASE LOCK
// ===============================
async function releaseRuntimeLock() {

  try {

    if (LOCK_HEARTBEAT) {
      clearInterval(LOCK_HEARTBEAT);
      LOCK_HEARTBEAT = null;
    }

    if (LEADER_RETRY_TIMEOUT) {
      clearTimeout(LEADER_RETRY_TIMEOUT);
      LEADER_RETRY_TIMEOUT = null;
    }

    const snap = await LOCK_DOC_REF.get();
    const data = snap.exists ? snap.data() || {} : {};

    if (String(data.holder || "") === INSTANCE_ID) {

      await LOCK_DOC_REF.set(
        {
          holder: "",
          expiresAt: 0,
          releasedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      console.log(`🔓 Lock liberado por ${INSTANCE_ID}`);
    }

    HAS_RUNTIME_LOCK = false;

  } catch (e) {

    console.error("❌ Error releaseRuntimeLock:", e?.message || e);

  }
}

// ===============================
// HEARTBEAT
// ===============================
function startRuntimeHeartbeat() {

  if (LOCK_HEARTBEAT) clearInterval(LOCK_HEARTBEAT);

  LOCK_HEARTBEAT = setInterval(async () => {

    await refreshRuntimeLock();

  }, 30000);
}

// ===============================
// REINTENTO DE LIDERAZGO
// ===============================
function startLeaderRetryLoop(delay = 15000) {

  if (LEADER_RETRY_TIMEOUT) return;

  LEADER_RETRY_TIMEOUT = setTimeout(async () => {

    LEADER_RETRY_TIMEOUT = null;

    const ok = await acquireRuntimeLock();

    if (ok) {

      await onBecameLeader();

    } else {

      startLeaderRetryLoop(delay);

    }

  }, delay);
}

// ===============================
// AL TOMAR LIDERAZGO
// ===============================
async function onBecameLeader() {

  console.log(`👑 Esta instancia ahora es líder: ${INSTANCE_ID}`);

  startRuntimeHeartbeat();

  startNetflixListenerIfLeader();

  scheduleBotRestart(6000);

}

// ===============================
// BOT ULTRA BLINDADO
// ===============================
const bot = new TelegramBot(BOT_TOKEN, {
  polling: false,
});

let BOT_IS_STARTING = false;
let BOT_POLLING_ACTIVE = false;
let BOT_LAST_START_AT = 0;
let BOT_START_TIMEOUT = null;

bot.on("polling_error", async (err) => {

  const msg = String(err?.message || err || "");
  console.error("❌ polling_error:", msg);

  if (!HAS_RUNTIME_LOCK) return;

  if (msg.includes("409")) {

    BOT_POLLING_ACTIVE = false;
    scheduleBotRestart(15000);
    return;

  }

  BOT_POLLING_ACTIVE = false;
  scheduleBotRestart(10000);

});

async function hardStopBot() {

  try {
    await bot.stopPolling().catch(() => {});
  } catch (_) {}

  try {
    await bot.deleteWebHook().catch(() => {});
  } catch (_) {}

  BOT_POLLING_ACTIVE = false;

}

// ===============================
// START BOT SEGURO
// ===============================
async function startBotSafe(force = false) {

  if (!HAS_RUNTIME_LOCK) return;

  const now = Date.now();

  if (BOT_IS_STARTING && !force) return;

  if (!force && BOT_POLLING_ACTIVE) return;

  if (!force && now - BOT_LAST_START_AT < 8000) return;

  BOT_IS_STARTING = true;
  BOT_LAST_START_AT = now;

  try {

    console.log("🔄 Iniciando bot limpio...");

    await hardStopBot();

    await new Promise((r) => setTimeout(r, 3000));

    await bot.startPolling({
      restart: true,
      interval: 300,
      params: { timeout: 10 },
    });

    BOT_POLLING_ACTIVE = true;

    console.log("✅ Bot iniciado (polling ultra blindado)");

  } catch (err) {

    BOT_POLLING_ACTIVE = false;

    console.error("❌ Error iniciando polling:", err?.message || err);

    scheduleBotRestart(15000);

  } finally {

    BOT_IS_STARTING = false;

  }
}

// ===============================
// REINICIO PROGRAMADO
// ===============================
function scheduleBotRestart(delayMs = 15000) {

  if (!HAS_RUNTIME_LOCK) return;

  if (BOT_START_TIMEOUT) {

    clearTimeout(BOT_START_TIMEOUT);
    BOT_START_TIMEOUT = null;

  }

  BOT_START_TIMEOUT = setTimeout(() => {

    startBotSafe(true).catch(() => {});

  }, delayMs);
}

// ===============================
// LISTENER NETFLIX
// ===============================
function startNetflixListenerIfLeader() {

  if (!HAS_RUNTIME_LOCK) return;

  if (NETFLIX_LISTENER_STARTED) return;

  if (process.env.ENABLE_NETFLIX_LISTENER === "true") {

    try {

      require("./netflix_codes_listener");

      NETFLIX_LISTENER_STARTED = true;

      console.log("🎬 Netflix listener activo");

    } catch (e) {

      console.error("❌ No se pudo iniciar netflix listener:", e);

    }
  }
}

// ===============================
// ARRANQUE
// ===============================
(async () => {

  try {
    await hardStopBot();
  } catch (_) {}

  const lockOk = await acquireRuntimeLock();

  if (lockOk) {

    await onBecameLeader();

  } else {

    console.log("⏳ Instancia pasiva por ahora. Reintentará tomar lock.");

    startLeaderRetryLoop(15000);

  }

})();

// ===============================
// FICHA CLIENTE / CRM / EDICIÓN
// ===============================
async function enviarFichaCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const r = resumenClienteCRM(c);
  const servicios = r.servicios;

  let txt = `👤 *CRM CLIENTE*\n\n`;
  txt += `🧑 *Nombre:* ${escMD(c.nombrePerfil || "-")}\n`;
  txt += `📱 *Teléfono:* ${escMD(c.telefono || "-")}\n`;
  txt += `🧾 *Vendedor:* ${escMD(c.vendedor || "-")}\n`;
  txt += `📊 *Estado general:* ${escMD(r.estadoGeneral)}\n`;
  txt += `💰 *Total mensual:* ${r.totalMensual} Lps\n`;
  txt += `📅 *Próxima renovación:* ${escMD(r.proxFecha)}\n`;
  txt += `🧩 *Servicios activos:* ${servicios.length}\n`;
  txt += `🔴 *Vence hoy:* ${r.venceHoy}   ⚫ *Vencidos:* ${r.vencidos}   🟡 *Próximos:* ${r.proximos}\n\n`;

  txt += `*SERVICIOS*\n`;
  if (!servicios.length) {
    txt += `— Sin servicios —\n`;
  } else {
    servicios.forEach((s, i) => {
      txt += `\n*${i + 1})* ${escMD(labelPlataforma(s.plataforma))}\n`;
      txt += `📧 ${escMD(s.correo || "-")}\n`;
      txt += `🔐 ${escMD(s.pin || "-")}\n`;
      txt += `💵 ${Number(s.precio || 0)} Lps\n`;
      txt += `📆 ${escMD(s.fechaRenovacion || "-")} — ${escMD(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }

  const kb = [];
  kb.push([{ text: "✏️ Editar cliente", callback_data: `cli:edit:menu:${clientId}` }]);

  if (servicios.length > 0) {
    kb.push([{ text: "🧩 Editar servicios", callback_data: `cli:serv:list:${clientId}` }]);
    kb.push([{ text: "🔄 Renovar servicio", callback_data: `cli:ren:list:${clientId}` }]);
    kb.push([{ text: "⏫ Renovar TODOS +30 días", callback_data: `cli:ren:all:ask:${clientId}` }]);
  }

  kb.push([{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }]);
  kb.push([{ text: "📄 TXT de este cliente", callback_data: `cli:txt:one:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, txt, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: kb },
  });
}

async function menuEditarCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const t =
    `✏️ *EDITAR CLIENTE*\n\n` +
    `👤 Nombre: *${escMD(c.nombrePerfil || "-")}*\n` +
    `📱 Tel: *${escMD(c.telefono || "-")}*\n` +
    `🧑‍💼 Vendedor: *${escMD(c.vendedor || "-")}*`;

  return upsertPanel(
    chatId,
    t,
    {
      inline_keyboard: [
        [{ text: "👤 Editar nombre", callback_data: `cli:edit:nombre:${clientId}` }],
        [{ text: "📱 Editar teléfono", callback_data: `cli:edit:tel:${clientId}` }],
        [{ text: "🧑‍💼 Editar vendedor", callback_data: `cli:edit:vend:${clientId}` }],
        [{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

async function menuListaServicios(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);
  if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

  const kb = servicios.map((s, i) => [
    {
      text: `${i + 1}) ${labelPlataforma(s.plataforma)} — ${s.correo}`,
      callback_data: `cli:serv:menu:${clientId}:${i}`,
    },
  ]);

  kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(
    chatId,
    "🧩 *EDITAR SERVICIOS*\nSeleccione un servicio:",
    { inline_keyboard: kb },
    "Markdown"
  );
}

async function menuServicio(chatId, clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

  const s = servicios[idx] || {};
  const t =
    `🧩 *SERVICIO #${idx + 1}*\n\n` +
    `📌 Plataforma: *${escMD(labelPlataforma(s.plataforma || "-"))}*\n` +
    `📧 Correo: *${escMD(s.correo || "-")}*\n` +
    `🔐 Pin: *${escMD(s.pin || "-")}*\n` +
    `💰 Precio: *${Number(s.precio || 0)}* Lps\n` +
    `📅 Renovación: *${escMD(s.fechaRenovacion || "-")}*\n` +
    `📊 Estado: *${escMD(estadoServicioLabel(s.fechaRenovacion))}*`;

  return upsertPanel(
    chatId,
    t,
    {
      inline_keyboard: [
        [{ text: "📌 Cambiar plataforma", callback_data: `cli:serv:edit:plat:${clientId}:${idx}` }],
        [{ text: "📧 Cambiar correo", callback_data: `cli:serv:edit:mail:${clientId}:${idx}` }],
        [{ text: "🔐 Cambiar pin", callback_data: `cli:serv:edit:pin:${clientId}:${idx}` }],
        [{ text: "💰 Cambiar precio", callback_data: `cli:serv:edit:precio:${clientId}:${idx}` }],
        [{ text: "📅 Cambiar fecha", callback_data: `cli:serv:edit:fecha:${clientId}:${idx}` }],
        [{ text: "🗑️ Eliminar perfil", callback_data: `cli:serv:del:ask:${clientId}:${idx}` }],
        [{ text: "⬅️ Volver lista", callback_data: `cli:serv:list:${clientId}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

// ===============================
// WIZARD CORREO / CLIENTES EN CORREO
// ===============================
function escapeMarkdown(text = "") {
  return String(text || "").replace(/([_*\[\]()~`>#+\-=|{}!\\])/g, "\\$1");
}

async function buscarCorreoInventarioPorPlatCorreo(plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  const directRef = db.collection("inventario").doc(docIdInventario(mail, plat));
  const directSnap = await directRef.get();

  if (directSnap.exists) {
    return {
      id: directSnap.id,
      ref: directRef,
      data: directSnap.data() || {},
    };
  }

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", plat)
    .where("correo", "==", mail)
    .limit(1)
    .get();

  if (!snap.empty) {
    const d = snap.docs[0];
    return {
      id: d.id,
      ref: d.ref,
      data: d.data() || {},
    };
  }

  return null;
}

function getCapacidadCorreo(data = {}, plataforma = "") {
  const desdeData = Number(data.capacidad || data.total || 0);
  if (Number.isFinite(desdeData) && desdeData > 0) return desdeData;

  const plat = normalizarPlataforma(plataforma);
  const mapa = {
    netflix: 5,
    vipnetflix: 1,
    disney: 6,
    disneyp: 6,
    disneyplus: 6,
    disneys: 5,
    max: 5,
    hbomax: 5,
    primevideo: 5,
    prime: 5,
    paramount: 5,
    vix: 4,
    crunchyroll: 5,
    spotify: 1,
    youtube: 1,
    canva: 1,
    appletv: 4,
    universal: 4,
    oleadatv1: 1,
    oleadatv3: 3,
    iptv1: 1,
    iptv3: 3,
    iptv4: 4,
  };

  return mapa[plat] || 1;
}

async function mostrarListaCorreosPlataforma(chatId, plataforma) {
  const plat = normalizarPlataforma(plataforma);

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", plat)
    .limit(500)
    .get();

  if (snap.empty) {
    return bot.sendMessage(
      chatId,
      `📭 *${escMD(String(plat).toUpperCase())}*\n\nNo hay correos registrados en esta plataforma.`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]],
        },
      }
    );
  }

  const docs = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() || {}),
  }));

  docs.sort((a, b) => {
    const aCorreo = String(a.correo || "").toLowerCase();
    const bCorreo = String(b.correo || "").toLowerCase();
    return aCorreo.localeCompare(bCorreo);
  });

  let txt = `📂 *${escMD(String(plat).toUpperCase())}*\n\n`;
  txt += `Seleccione un correo:\n`;

  const kb = docs.map((item) => {
    const clientes = Array.isArray(item.clientes) ? item.clientes : [];
    const capacidad = getCapacidadCorreo(item, plat);
    const ocupados = clientes.length;
    const disponibles = Math.max(0, capacidad - ocupados);
    const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

    return [
      {
        text: `${item.correo || "correo"} | ${ocupados}/${capacidad} | ${estado}`,
        callback_data: `mail_panel|${plat}|${encodeURIComponent(item.correo || "")}`,
      },
    ];
  });

  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, txt, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: kb,
    },
  });
}

async function mostrarMenuClientesCorreo(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  return bot.sendMessage(chatId, "👥 *CLIENTES*\n\nSeleccione una opción:", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "👥 Ver clientes", callback_data: `mail_ver_clientes|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "➕ Agregar cliente", callback_data: `mail_add_cliente|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "➖ Quitar cliente", callback_data: `mail_del_cliente|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🔐 Editar PIN", callback_data: `mail_edit_pin|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "✏️ Editar clave del correo", callback_data: `mail_edit_clave|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "⬅️ Volver al correo", callback_data: `mail_panel|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
}

async function mostrarMenuCodigosNetflix(chatId, plataforma, correo) {
  return responderMenuCodigosNetflix(chatId, plataforma, correo);
}

async function mostrarPanelCorreo(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  const found = await buscarCorreoInventarioPorPlatCorreo(plat, mail);
  if (!found) {
    return bot.sendMessage(chatId, "❌ Este correo no existe.");
  }

  const data = found.data || {};
  const clientes = Array.isArray(data.clientes) ? data.clientes : [];
  const capacidad = getCapacidadCorreo(data, plat);

  const ocupados = clientes.length;
  const disponibles = Math.max(0, capacidad - ocupados);
  const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

  if (
    Number(data.disp || 0) !== disponibles ||
    String(data.estado || "") !== (disponibles === 0 ? "llena" : "activa") ||
    Number(data.ocupados || 0) !== ocupados ||
    Number(data.disponibles || 0) !== disponibles ||
    Number(data.capacidad || 0) !== capacidad
  ) {
    await found.ref.set(
      {
        ocupados,
        disponibles,
        disp: disponibles,
        estado: disponibles === 0 ? "llena" : "activa",
        capacidad,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  let txt = "";
  txt += `📧 *${escMD(mail)}*\n`;
  txt += `${escMD(String(plat).toUpperCase())}\n\n`;
  txt += `👤 *Ocupados:* ${ocupados}/${capacidad}\n`;
  txt += `✅ *Disponibles:* ${disponibles}\n`;
  txt += `📊 *Estado:* ${escMD(estado)}`;

  const kb = [
    [{ text: "👥 CLIENTES", callback_data: `mail_menu_clientes|${plat}|${encodeURIComponent(mail)}` }],
  ];

  if (plat === "netflix" || plat === "vipnetflix") {
    kb.push([{ text: "🎬 CÓDIGOS NETFLIX", callback_data: `mail_menu_codigos|${plat}|${encodeURIComponent(mail)}` }]);
  }

  kb.push([{ text: "🗑️ Borrar correo", callback_data: `mail_delete|${plat}|${encodeURIComponent(mail)}` }]);
  kb.push([{ text: "⬅️ Volver Inventario", callback_data: `inv:${plat}:0` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, txt, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: kb,
    },
  });
}

// ===============================
// WIZARD NUEVO CLIENTE
// ===============================
async function wizardStart(chatId) {
  wset(chatId, {
    step: 1,
    data: {},
    clientId: null,
    servStep: 0,
    servicio: {},
  });

  return bot.sendMessage(chatId, "👥 *NUEVO CLIENTE*\n\n(1/3) Escriba *Nombre*:", {
    parse_mode: "Markdown",
  });
}

async function wizardNext(chatId, text) {
  const st = w(chatId);
  if (!st) return;

  const t = String(text || "").trim();
  const d = st.data || {};

  if (st.step === 1) {
    d.nombrePerfil = t;
    st.data = d;
    st.step = 2;
    wset(chatId, st);
    return bot.sendMessage(chatId, "(2/3) Escriba *Teléfono*:", { parse_mode: "Markdown" });
  }

  if (st.step === 2) {
    d.telefono = t;
    st.data = d;
    st.step = 3;
    wset(chatId, st);
    return bot.sendMessage(chatId, "(3/3) Escriba *Vendedor*:", { parse_mode: "Markdown" });
  }

  if (st.step === 3) {
    d.vendedor = t;

    const dup = await clienteDuplicado(d.nombrePerfil || "", d.telefono || "");
    if (dup) {
      wclear(chatId);
      return bot.sendMessage(
        chatId,
        `⚠️ Cliente duplicado detectado.\nYa existe:\n${dup.nombrePerfil || "-"} | ${dup.telefono || "-"}`
      );
    }

    const clientRef = db.collection("clientes").doc();
    st.clientId = clientRef.id;

    await clientRef.set(
      {
        nombrePerfil: d.nombrePerfil,
        telefono: String(d.telefono || "").trim(),
        vendedor: d.vendedor,
        servicios: [],
        nombre_norm: normTxt(d.nombrePerfil),
        telefono_norm: onlyDigits(d.telefono),
        vendedor_norm: normTxt(d.vendedor),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    st.step = 4;
    st.servStep = 1;
    st.servicio = {};
    st.data = d;
    wset(chatId, st);

    return bot.sendMessage(
      chatId,
      "✅ Cliente creado.\n\n📌 Ahora agreguemos el servicio.\n(Servicio 1/5) Plataforma:",
      { reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", st.clientId) } }
    );
  }

  if (st.step === 4) {
    const s = st.servicio || {};

    if (st.servStep === 1) {
      return bot.sendMessage(chatId, "📌 Seleccione la plataforma con los botones.");
    }

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
      if (!Number.isFinite(n) || n <= 0) {
        return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
      }
      s.precio = n;
      st.servStep = 5;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 5/5) Fecha renovación (dd/mm/yyyy):");
    }

    if (st.servStep === 5) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");

      s.fechaRenovacion = String(t).trim();

      const { cliente, servicios } = await addServicioTx(String(st.clientId), {
        plataforma: String(s.plataforma || "").trim(),
        correo: String(s.correo || "").trim().toLowerCase(),
        pin: String(s.pin || "").trim(),
        precio: Number(s.precio || 0),
        fechaRenovacion: s.fechaRenovacion,
      });

      st.servicio = {};
      st.servStep = 1;
      st.step = 4;
      wset(chatId, st);

      const ordenados = serviciosOrdenados(servicios);

      let resumen =
        `✅ Servicio agregado.\n¿Desea agregar otra plataforma a este cliente?\n\n` +
        `Cliente:\n${cliente?.nombrePerfil || st.data?.nombrePerfil || "-"}\n` +
        `${cliente?.telefono || st.data?.telefono || "-"}\n` +
        `${cliente?.vendedor || st.data?.vendedor || "-"}\n\n` +
        `SERVICIOS (ordenados por fecha):\n` +
        ordenados
          .map((x, i) => `${i + 1}) ${x.plataforma} — ${x.correo} — ${x.precio} Lps — Renueva: ${x.fechaRenovacion}`)
          .join("\n");

      const kb = {
        inline_keyboard: [
          [{ text: "➕ Agregar otra", callback_data: `wiz:addmore:${st.clientId}` }],
          [{ text: "✅ Finalizar", callback_data: `wiz:finish:${st.clientId}` }],
        ],
      };

      if (resumen.length > 3800) {
        await enviarTxtComoArchivo(chatId, resumen, `resumen_servicios_${Date.now()}.txt`);
        return bot.sendMessage(chatId, "📄 Te mandé el resumen en TXT.\n¿Deseas agregar otra plataforma?", {
          reply_markup: kb,
        });
      }

      return bot.sendMessage(chatId, resumen, { reply_markup: kb });
    }
  }
}

// ===============================
// BÚSQUEDA CLIENTES
// ===============================
async function buscarPorTelefonoTodos(telInput) {
  const tnorm = onlyDigits(telInput);
  if (!tnorm) return [];

  const all = [];
  const seen = new Set();

  const snapNorm = await db.collection("clientes").where("telefono_norm", "==", tnorm).limit(50).get();
  snapNorm.forEach((d) => {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      all.push({ id: d.id, ...d.data() });
    }
  });

  const snapTel = await db.collection("clientes").where("telefono", "==", tnorm).limit(50).get();
  snapTel.forEach((d) => {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      all.push({ id: d.id, ...d.data() });
    }
  });

  const legacy = await db.collection("clientes").doc(tnorm).get();
  if (legacy.exists && !seen.has(legacy.id)) {
    all.push({ id: legacy.id, ...legacy.data() });
  }

  if (all.length) return all;

  const scan = await db.collection("clientes").limit(5000).get();
  scan.forEach((doc) => {
    const c = doc.data() || {};
    const tel = onlyDigits(c.telefono || "");
    if (tel.includes(tnorm) && !seen.has(doc.id)) {
      seen.add(doc.id);
      all.push({ id: doc.id, ...c });
    }
  });

  return all.slice(0, 50);
}

async function buscarClienteRobusto(queryLower) {
  const qRaw = String(queryLower || "").trim();
  const q = normTxt(qRaw);
  const qTel = onlyDigits(qRaw);

  if (qTel && qTel.length >= 7) return await buscarPorTelefonoTodos(qTel);

  try {
    const snapName = await db
      .collection("clientes")
      .orderBy("nombre_norm")
      .startAt(q)
      .endAt(q + "\uf8ff")
      .limit(25)
      .get();

    if (!snapName.empty) return snapName.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {}

  const snap = await db.collection("clientes").limit(5000).get();
  const encontrados = [];
  snap.forEach((doc) => {
    const c = doc.data() || {};
    const nombre = normTxt(c.nombrePerfil || "");
    const vendedor = normTxt(c.vendedor || "");
    const tel = onlyDigits(c.telefono || "");

    if (nombre.includes(q) || vendedor.includes(q) || (qTel && tel.includes(qTel))) {
      encontrados.push({ id: doc.id, ...c });
    }
  });

  return encontrados.slice(0, 50);
}

async function enviarListaResultadosClientes(chatId, resultados) {
  const dedup = dedupeClientes(resultados);

  let txt = `📱 *RESULTADOS*\nSe encontraron *${dedup.length}* clientes.\n\n`;

  dedup.forEach((c, i) => {
    txt += `*${i + 1})* ${escMD(c.nombrePerfil || "-")} | ${escMD(c.telefono || "-")} | ${escMD(c.vendedor || "-")}\n`;
  });

  if (txt.length > 3800) {
    return enviarTxtComoArchivo(chatId, txt, `clientes_resultados_${Date.now()}.txt`);
  }

  const kb = dedup.map((c, i) => [
    { text: `👤 ${i + 1}) ${c.nombrePerfil || "-"} (${c.telefono || "-"})`, callback_data: `cli:view:${c.id}` },
  ]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return bot.sendMessage(chatId, txt, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: kb },
  });
}

// ===============================
// TXT CLIENTES
// ===============================
async function reporteClientesTXTGeneral(chatId) {
  const snap = await db.collection("clientes").limit(5000).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay clientes.");

  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  arr.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));

  let body = "CLIENTES (NOMBRE | TELEFONO)\n\n";
  arr.forEach((c, i) => {
    body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")}\n`;
  });

  body += `\n--------------------\nTOTAL CLIENTES: ${arr.length}\n`;
  return enviarTxtComoArchivo(chatId, body, `clientes_${Date.now()}.txt`);
}

async function reporteClientesSplitPorVendedorTXT(chatId) {
  const snap = await db.collection("clientes").limit(5000).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay clientes.");

  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const map = new Map();

  for (const c of arr) {
    const vend = String(c.vendedor || "SIN VENDEDOR").trim() || "SIN VENDEDOR";
    if (!map.has(vend)) map.set(vend, []);
    map.get(vend).push(c);
  }

  const vendedores = Array.from(map.keys()).sort((a, b) => normTxt(a).localeCompare(normTxt(b)));
  await bot.sendMessage(chatId, `📄 Generando ${vendedores.length} TXT (1 por vendedor)...`);

  for (const vend of vendedores) {
    const lista = map.get(vend) || [];
    lista.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));

    let body = `VENDEDOR: ${stripAcentos(vend)}\n`;
    body += `TOTAL CLIENTES: ${lista.length}\n\n`;
    body += "CLIENTES (NOMBRE | TELEFONO)\n\n";

    lista.forEach((c, i) => {
      body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")}\n`;
    });

    const fileSafe = stripAcentos(vend).replace(/[^\w\-]+/g, "_").slice(0, 40) || "VENDEDOR";
    await enviarTxtComoArchivo(chatId, body, `clientes_${fileSafe}_${Date.now()}.txt`);
  }

  return bot.sendMessage(chatId, "✅ Listo: enviados los TXT por vendedor.");
}

async function obtenerClientesPorVendedor(vendedorNombre) {
  const snap = await db.collection("clientes").limit(5000).get();
  const out = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    if (normTxt(c.vendedor || "") === normTxt(vendedorNombre || "")) out.push({ id: doc.id, ...c });
  });

  out.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));
  return out;
}

async function enviarMisClientes(chatId, vendedorNombre) {
  const arr = await obtenerClientesPorVendedor(vendedorNombre);

  if (!arr.length) {
    return bot.sendMessage(chatId, `⚠️ No hay clientes para ${vendedorNombre}.`);
  }

  let txt = `👥 *MIS CLIENTES — ${escMD(vendedorNombre)}*\n\n`;
  arr.forEach((c, i) => {
    const servicios = Array.isArray(c.servicios) ? c.servicios.length : 0;
    txt += `${i + 1}) ${escMD(c.nombrePerfil || "-")} | ${escMD(c.telefono || "-")} | Servicios: ${servicios}\n`;
  });

  if (txt.length > 3800) {
    return enviarTxtComoArchivo(chatId, txt, `mis_clientes_${Date.now()}.txt`);
  }

  return bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
}

async function enviarMisClientesTXT(chatId, vendedorNombre) {
  const arr = await obtenerClientesPorVendedor(vendedorNombre);

  let body = `MIS CLIENTES - ${stripAcentos(vendedorNombre)}\n\n`;
  if (!arr.length) {
    body += "SIN CLIENTES\n";
  } else {
    arr.forEach((c, i) => {
      const servicios = Array.isArray(c.servicios) ? c.servicios.length : 0;
      body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")} | SERVICIOS: ${servicios}\n`;
    });
    body += `\n--------------------\nTOTAL CLIENTES: ${arr.length}\n`;
  }

  return enviarTxtComoArchivo(chatId, body, `mis_clientes_${Date.now()}.txt`);
}

// ===============================
// RENOVACIONES
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
        const okVend = !vendedorOpt || normTxt(vendedor) === normTxt(vendedorOpt);
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
    const va = normTxt(a.vendedor);
    const vb = normTxt(b.vendedor);
    if (va !== vb) return va.localeCompare(vb);
    return normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil));
  });

  return out;
}

function renovacionesTexto(list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt
    ? `RENOVACIONES ${fechaDMY} — ${vendedorOpt}`
    : `RENOVACIONES ${fechaDMY} — GENERAL`;

  let t = `📅 *${escMD(titulo)}*\n\n`;

  if (!list || list.length === 0) {
    t += "⚠️ No hay renovaciones.\n";
    return t;
  }

  let suma = 0;
  list.forEach((x, i) => {
    suma += Number(x.precio || 0);
    t += `${i + 1}) ${escMD(x.nombrePerfil)} — ${escMD(x.plataforma)} — ${x.precio} Lps — ${escMD(x.telefono)} — ${escMD(x.vendedor)}\n`;
  });

  t += `\n━━━━━━━━━━━━━━\n`;
  t += `Clientes: ${list.length}\n`;
  t += `Total a cobrar: ${suma} Lps\n`;
  return t;
}

async function enviarTXT(chatId, list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt
    ? `renovaciones_${stripAcentos(vendedorOpt)}_${fechaDMY}`
    : `renovaciones_general_${fechaDMY}`;

  const fileSafe = titulo.replace(/[^\w\-]+/g, "_");

  let body = vendedorOpt
    ? `RENOVACIONES ${fechaDMY} - ${stripAcentos(vendedorOpt)}\n\n`
    : `RENOVACIONES ${fechaDMY} - GENERAL\n\n`;

  if (!list || list.length === 0) {
    body += "SIN RENOVACIONES\n";
  } else {
    let suma = 0;
    list.forEach((x, i) => {
      suma += Number(x.precio || 0);
      body += `${String(i + 1).padStart(2, "0")}) ${stripAcentos(x.nombrePerfil)} | ${x.plataforma} | ${x.precio} Lps | ${x.telefono} | ${stripAcentos(x.vendedor)}\n`;
    });
    body += `\n--------------------\nCLIENTES: ${list.length}\nTOTAL: ${suma} Lps\n`;
  }

  return enviarTxtComoArchivo(chatId, body, `${fileSafe}.txt`);
}

async function enviarTXTATodosHoy(superChatId) {
  const fecha = hoyDMY();
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(superChatId, "⚠️ No hay revendedores.");

  let enviados = 0;
  let saltados = 0;

  for (const d of snap.docs) {
    const rev = normalizeRevendedorDoc(d);

    if (!rev.activo || !rev.telegramId || !rev.nombre) {
      saltados++;
      continue;
    }

    const list = await obtenerRenovacionesPorFecha(fecha, rev.nombre);
    await enviarTXT(rev.telegramId, list, fecha, rev.nombre);
    enviados++;
  }

  return bot.sendMessage(
    superChatId,
    `✅ Enviado TXT HOY (${fecha})\n• Revendedores enviados: ${enviados}\n• Saltados: ${saltados}`
  );
}

// ===============================
// HELPERS CODIGOS NETFLIX
// ===============================
function tsToMillisNetflix(v) {
  try {
    if (!v) return 0;
    if (typeof v?.toDate === "function") return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch (_) {
    return 0;
  }
}

async function obtenerUltimoCodigoNetflix(correo, tipo) {
  const mail = String(correo || "").trim().toLowerCase();
  if (!mail || !tipo) return null;

  let snap = null;

  try {
    snap = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .where("tipo", "==", tipo)
      .orderBy("fecha", "desc")
      .limit(1)
      .get();
  } catch (e) {
    const alt = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .where("tipo", "==", tipo)
      .limit(50)
      .get();

    const docs = alt.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => {
        const fa = tsToMillisNetflix(a.fecha || a.createdAt || a.updatedAt);
        const fb = tsToMillisNetflix(b.fecha || b.createdAt || b.updatedAt);
        return fb - fa;
      });

    return docs.length ? docs[0] : null;
  }

  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() || {}) };
}

async function obtenerUltimoCodigoNetflixGeneral(correo) {
  const mail = String(correo || "").trim().toLowerCase();
  if (!mail) return null;

  let snap = null;

  try {
    snap = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .orderBy("fecha", "desc")
      .limit(1)
      .get();
  } catch (e) {
    const alt = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .limit(50)
      .get();

    const docs = alt.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => {
        const fa = tsToMillisNetflix(a.fecha || a.createdAt || a.updatedAt);
        const fb = tsToMillisNetflix(b.fecha || b.createdAt || b.updatedAt);
        return fb - fa;
      });

    return docs.length ? docs[0] : null;
  }

  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() || {}) };
}

function labelTipoCodigoNetflix(tipo = "") {
  const t = String(tipo || "").toLowerCase();
  if (t === "signin") return "🔐 Inicio sesión";
  if (t === "temporal") return "⏳ Código temporal";
  if (t === "hogar") return "🏠 Código hogar";
  if (t === "verification") return "✅ Verificación";
  return "📩 Código";
}

function fmtFechaCodigoNetflix(fecha) {
  if (!fecha) return "-";

  try {
    let dt = null;

    if (typeof fecha?.toDate === "function") {
      dt = fecha.toDate();
    } else if (fecha instanceof Date) {
      dt = fecha;
    } else {
      dt = new Date(fecha);
    }

    if (isNaN(dt.getTime())) return String(fecha);

    return new Intl.DateTimeFormat("es-HN", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(dt);
  } catch (e) {
    return String(fecha);
  }
}

async function marcarCodigoNetflixUsado(docId) {
  if (!docId) return;
  try {
    await db.collection("codigos_netflix").doc(String(docId)).set(
      {
        usado: true,
        usadoAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    logErr("❌ Error marcando codigo usado:", e?.message || e);
  }
}

async function responderCodigoNetflix(chatId, correo, tipo) {
  const mail = String(correo || "").trim().toLowerCase();

  let data = null;
  if (tipo === "ultimo") {
    data = await obtenerUltimoCodigoNetflixGeneral(mail);
  } else {
    data = await obtenerUltimoCodigoNetflix(mail, tipo);
  }

  if (!data) {
    return bot.sendMessage(
      chatId,
      `🎬 *CÓDIGOS NETFLIX*\n\n📧 *${escMD(mail)}*\n🧩 *Tipo:* ${escMD(tipo === "ultimo" ? "último disponible" : tipo)}\n\n⚠️ No encontré códigos disponibles.`,
      { parse_mode: "Markdown" }
    );
  }

  const tipoReal = String(data.tipo || tipo || "ultimo").toLowerCase();
  const codigo = String(data.codigo || "").trim();
  const fuente = String(data.fuente || "-").trim();
  const fechaFmt = fmtFechaCodigoNetflix(data.fecha || data.createdAt || data.updatedAt);
  const usado = data.usado === true ? "Sí" : "No";

  let txt = `🎬 *CÓDIGOS NETFLIX*\n\n`;
  txt += `📧 *${escMD(mail)}*\n`;
  txt += `🧩 *Tipo:* ${escMD(labelTipoCodigoNetflix(tipoReal))}\n`;
  txt += `🔢 *Código:* \`${codigo || "-"}\`\n`;
  txt += `🕒 *Fecha:* ${escMD(fechaFmt)}\n`;
  txt += `📥 *Fuente:* ${escMD(fuente || "-")}\n`;
  txt += `✅ *Usado:* ${escMD(usado)}`;

  await bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });

  if (data.id) {
    await marcarCodigoNetflixUsado(data.id);
  }
}

async function responderMenuCodigosNetflix(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  if (plat !== "netflix" && plat !== "vipnetflix") {
    return bot.sendMessage(chatId, "⚠️ Este menú de códigos solo aplica para Netflix.");
  }

  return bot.sendMessage(chatId, "🎬 *CÓDIGOS NETFLIX*\n\nSeleccione una opción:", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📩 Último código", callback_data: `nf_code|ultimo|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "🔐 Inicio sesión", callback_data: `nf_code|signin|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "⏳ Código temporal", callback_data: `nf_code|temporal|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "🏠 Código hogar", callback_data: `nf_code|hogar|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "✅ Verificación", callback_data: `nf_code|verification|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "⬅️ Volver al correo", callback_data: `mail_panel|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
}

// ===============================
// COMANDOS CLIENTES
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  if (onlyDigits(q).length >= 7) {
    const resultados = await buscarPorTelefonoTodos(q);
    const dedup = dedupeClientes(resultados);
    if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
    if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
    return enviarListaResultadosClientes(chatId, dedup);
  }

  const resultados = await buscarClienteRobusto(q);
  const dedup = dedupeClientes(resultados);

  if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
  if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

  return enviarListaResultadosClientes(chatId, dedup);
});

bot.onText(/\/cliente\s+(\S+)/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const tel = String(match[1] || "").trim();
  const resultados = await buscarPorTelefonoTodos(tel);
  const dedup = dedupeClientes(resultados);

  if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
  return enviarListaResultadosClientes(chatId, dedup);
});

bot.onText(/\/clientes_txt/i, async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return reporteClientesTXTGeneral(chatId);
});

bot.onText(/\/vendedores_txt_split/i, async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return reporteClientesSplitPorVendedorTXT(chatId);
});

// ===============================
// COMANDOS RENOVACIONES
// ===============================
bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await isAdmin(userId);
  const vend = await getRevendedorPorTelegramId(userId);

  if (!adminOk && !(vend && vend.nombre)) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

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
      return bot.sendMessage(chatId, "⚠️ Uso:\n/renovaciones hoy\n/renovaciones dd/mm/yyyy\n/renovaciones VENDEDOR dd/mm/yyyy");
    }
  }

  if (!adminOk && vend?.nombre) vendedor = vend.nombre;

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  const texto = renovacionesTexto(list, fecha, vendedor || null);
  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

bot.onText(/\/txt(?:\s+(.+))?/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await isAdmin(userId);
  const vend = await getRevendedorPorTelegramId(userId);

  if (!adminOk && !(vend && vend.nombre)) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

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
      return bot.sendMessage(chatId, "⚠️ Uso:\n/txt hoy\n/txt dd/mm/yyyy\n/txt VENDEDOR dd/mm/yyyy");
    }
  }

  if (!adminOk && vend?.nombre) vendedor = vend.nombre;

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  return enviarTXT(chatId, list, fecha, vendedor || null);
});

// ===============================
// IDS / VINCULACIÓN
// ===============================
bot.onText(/\/id/i, async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(chatId, `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`);
});

bot.onText(/\/miid/i, async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(chatId, `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`);
});

bot.onText(/\/vincular_vendedor\s+(.+)/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso: /vincular_vendedor NOMBRE");

  const r = await setTelegramIdToRevendedor(nombre, userId);
  return bot.sendMessage(chatId, r.msg);
});

// ===============================
// REVENDEDORES ADMIN
// ===============================
bot.onText(/\/addvendedor\s+(\d+)\s+(.+)/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");

  const telegramId = String(match[1] || "").trim();
  const nombre = String(match[2] || "").trim();

  if (!telegramId || !nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/addvendedor ID Nombre");

  const docId = normTxt(nombre) || String(Date.now());

  await db.collection("revendedores").doc(docId).set(
    {
      nombre,
      nombre_norm: normTxt(nombre),
      telegramId: String(telegramId),
      activo: true,
      autoLastSent: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Revendedor agregado\n\n👤 ${nombre}\n🆔 ${telegramId}\n📌 DocID: ${docId}`);
});

bot.onText(/\/delvendedor\s+(.+)/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/delvendedor Nombre");

  const nombreNorm = normTxt(nombre);
  const snap = await db.collection("revendedores").get();

  let found = null;
  snap.forEach((d) => {
    const rev = normalizeRevendedorDoc(d);
    if (rev.nombre_norm === nombreNorm) found = { ref: d.ref, nombre: rev.nombre };
  });

  if (!found) return bot.sendMessage(chatId, "⚠️ No encontré ese revendedor.");

  await found.ref.delete();
  return bot.sendMessage(chatId, `🗑️ Revendedor eliminado:\n${found.nombre}`);
});

async function listarRevendedores(chatId) {
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay revendedores.");

  const all = snap.docs.map((d) => normalizeRevendedorDoc(d));
  all.sort((a, b) => normTxt(a.nombre).localeCompare(normTxt(b.nombre)));

  let t = "👤 *REVENDEDORES*\n\n";
  all.forEach((x) => {
    t += `• ${escMD(x.nombre || x.id)} — ${x.activo ? "✅ activo" : "⛔ inactivo"}${x.telegramId ? ` | 🆔 ${escMD(x.telegramId)}` : ""}\n`;
  });

  if (t.length > 3800) return enviarTxtComoArchivo(chatId, t, `revendedores_${Date.now()}.txt`);
  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
}

// ===============================
// ADMINS
// ===============================
bot.onText(/\/adminadd\s+(\d+)/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede agregar admins.");

  const id = String(match[1] || "").trim();

  await db.collection("admins").doc(id).set(
    {
      activo: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      creadoPor: String(userId),
    },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Admin agregado: ${id}`);
});

bot.onText(/\/admindel\s+(\d+)/i, async (msg, match) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede eliminar admins.");

  const id = String(match[1] || "").trim();

  await db.collection("admins").doc(id).set(
    {
      activo: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      desactivadoPor: String(userId),
    },
    { merge: true }
  );

  return bot.sendMessage(chatId, `🗑️ Admin desactivado: ${id}`);
});

bot.onText(/\/adminlist/i, async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN.");

  const snap = await db.collection("admins").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay admins en colección.");

  let t = `👑 *ADMINS*\nSUPER_ADMIN: ${SUPER_ADMIN || "(no seteado)"}\n\n`;
  snap.forEach((d) => {
    const x = d.data() || {};
    t += `• ${d.id} — ${x.activo ? "✅ activo" : "⛔ inactivo"}\n`;
  });

  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
});

// ===============================
// START / MENU BLINDADO
// ===============================
bot.onText(/\/start/i, async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (await isAdmin(userId)) {
    const sent = await bot.sendMessage(chatId, "📌 *MENÚ PRINCIPAL*", {
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
    panelMsgId.set(String(chatId), sent.message_id);
    return;
  }

  if (await isVendedor(userId)) {
    const sent = await bot.sendMessage(
      chatId,
      "👤 *MENÚ VENDEDOR*\n\nFunciones disponibles:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
            [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
            [{ text: "👥 Mis clientes", callback_data: "vend:clientes" }],
            [{ text: "📄 TXT Mis clientes", callback_data: "vend:clientes:txt" }],
          ],
        },
      }
    );
    panelMsgId.set(String(chatId), sent.message_id);
    return;
  }

  return bot.sendMessage(chatId, "⛔ Acceso denegado");
});

bot.onText(/\/menu/i, async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    if (await isAdmin(userId)) {
      const sent = await bot.sendMessage(chatId, "📌 *MENÚ PRINCIPAL*", {
        parse_mode: "Markdown",
        reply_to_message_id: msg.message_id,
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
      panelMsgId.set(String(chatId), sent.message_id);
      return;
    }

    if (await isVendedor(userId)) {
      const sent = await bot.sendMessage(
        chatId,
        "👤 *MENÚ VENDEDOR*\n\nFunciones disponibles:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
        {
          parse_mode: "Markdown",
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
              [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
              [{ text: "👥 Mis clientes", callback_data: "vend:clientes" }],
              [{ text: "📄 TXT Mis clientes", callback_data: "vend:clientes:txt" }],
            ],
          },
        }
      );
      panelMsgId.set(String(chatId), sent.message_id);
      return;
    }

    return bot.sendMessage(chatId, "⛔ Acceso denegado", {
      reply_to_message_id: msg.message_id,
    });
  } catch (err) {
    return bot.sendMessage(chatId, "⚠️ Error interno.");
  }
});

// ===============================
// ATAJOS INVENTARIO
// ===============================
PLATAFORMAS.forEach((p) => {
  bot.onText(new RegExp("^\\/" + p + "(?:@\\w+)?(?:\\s+.*)?$", "i"), async (msg) => {
    if (!HAS_RUNTIME_LOCK) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return enviarInventarioPlataforma(chatId, p, 0);
  });
});

bot.onText(/\/stock/i, async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarStockGeneral(chatId);
});

// ===============================
// CALLBACKS
// ===============================
bot.on("callback_query", async (q) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = q.message?.chat?.id;
  const userId = q.from?.id;
  const data = q.data || "";

  try {
    try {
      await bot.answerCallbackQuery(q.id);
    } catch (_) {}

    if (!chatId) return;
    if (!allowMsg(chatId, userId)) return;

    bindPanelFromCallback(q);

    const adminOk = await isAdmin(userId);
    const vend = await getRevendedorPorTelegramId(userId);
    const vendOk = !!(vend && vend.nombre);

    if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    if (data === "go:inicio") {
      if (adminOk) return menuPrincipal(chatId);
      return menuVendedor(chatId);
    }

    const vendedorOnlyAllowed = new Set([
      "ren:mis",
      "txt:mis",
      "vend:clientes",
      "vend:clientes:txt",
      "go:inicio",
    ]);

    if (!adminOk) {
      if (!vendedorOnlyAllowed.has(data)) {
        return upsertPanel(
          chatId,
          "⛔ Modo vendedor.\n\nUsa:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
          { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
          "Markdown"
        );
      }
    }

    if (adminOk) {
      if (data === "menu:inventario") return menuInventario(chatId);
      if (data === "menu:clientes") return menuClientes(chatId);
      if (data === "menu:pagos") return menuPagos(chatId);
      if (data === "menu:renovaciones") return menuRenovaciones(chatId, userId);

      if (data === "menu:buscar") {
        return upsertPanel(
          chatId,
          "🔎 *BUSCAR*\n\nUse:\n• /buscar NOMBRE\n• /buscar TELEFONO\n\nO directo:\n• /NOMBRE\n• /TELEFONO",
          { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
          "Markdown"
        );
      }

      if (data === "inv:general") return mostrarStockGeneral(chatId);

      if (data.startsWith("inv:") && !data.startsWith("inv:open:") && !data.startsWith("inv:menu:")) {
        const [, plat, pageStr] = data.split(":");
        return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
      }

      if (data.startsWith("inv:open:")) {
        const [, , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.set(String(chatId), {
          mode: "invSubmenuCtx",
          plat: normalizarPlataforma(plat),
          correo: String(correo).toLowerCase(),
        });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (data.startsWith("inv:menu:sumar:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.set(String(chatId), { mode: "invSumarQty", plat, correo });
        return upsertPanel(
          chatId,
          `➕ *Agregar perfil*\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}\n\nEscriba cantidad a *SUMAR* (ej: 1):`,
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:restar:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.set(String(chatId), { mode: "invRestarQty", plat, correo });
        return upsertPanel(
          chatId,
          `➖ *Quitar perfil*\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}\n\nEscriba cantidad a *RESTAR* (ej: 1):`,
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:clave:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.set(String(chatId), { mode: "invEditClave", plat, correo });
        return upsertPanel(
          chatId,
          `✏️ *Editar clave*\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}\n\nEscriba la nueva clave:`,
          { inline_keyboard: [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:cancel:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        pending.delete(String(chatId));
        pending.set(String(chatId), {
          mode: "invSubmenuCtx",
          plat: normalizarPlataforma(plat),
          correo: String(correo).toLowerCase(),
        });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (data.startsWith("inv:menu:borrar:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        return bot.sendMessage(
          chatId,
          `🗑️ Confirmar *borrar correo*?\n📌 ${String(plat).toUpperCase()}\n📧 ${escMD(correo)}`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Confirmar", callback_data: `inv:menu:borrarok:${normalizarPlataforma(plat)}:${encodeURIComponent(String(correo).toLowerCase())}` }],
                [{ text: "⬅️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(correo)}` }],
              ],
            },
          }
        );
      }

      if (data.startsWith("inv:menu:borrarok:")) {
        const [, , , plat, correoEnc] = data.split(":");
        const correo = decodeURIComponent(correoEnc || "");
        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ No existe ese correo en inventario.");
        await ref.delete();
        pending.delete(String(chatId));
        return enviarInventarioPlataforma(chatId, plat, 0);
      }

      if (data.startsWith("mail_panel|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        return mostrarPanelCorreo(chatId, plataforma, correo);
      }

      if (data.startsWith("mail_menu_clientes|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        return mostrarMenuClientesCorreo(chatId, plataforma, correo);
      }

      if (data.startsWith("mail_menu_codigos|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        return responderMenuCodigosNetflix(chatId, plataforma, correo);
      }

      if (data.startsWith("nf_code|")) {
        const parts = data.split("|");
        const tipo = parts[1] || "";
        const correo = decodeURIComponent(parts[2] || "");
        return responderCodigoNetflix(chatId, correo, tipo);
      }

      if (data.startsWith("mail_ver_clientes|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        let txt = "👥 *Clientes en este correo*\n\n";
        txt += `📧 *${escMD(correo)}*\n`;
        txt += `📌 *${escMD(String(plataforma).toUpperCase())}*\n\n`;

        if (!clientes.length) {
          txt += "_No hay clientes asignados._\n\n";
        } else {
          clientes.forEach((c, i) => {
            txt += `${i + 1}. ${escMD(c.nombre || "Sin nombre")} — PIN ${escMD(c.pin || "----")}\n`;
          });
          txt += "\n";
        }

        txt += `👤 *Ocupados:* ${ocupados}/${capacidad}\n`;
        txt += `✅ *Disponibles:* ${disponibles}\n`;
        txt += `📊 *Estado:* ${escMD(estado)}`;

        return bot.sendMessage(chatId, txt, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Volver al correo", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
        });
      }

      if (data.startsWith("mail_add_cliente|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);

        if (disponibles <= 0) {
          return bot.sendMessage(
            chatId,
            `❌ Esta cuenta ya está llena.\n\n👤 Ocupados: ${ocupados}/${capacidad}\n✅ Disponibles: 0\n📊 Estado: LLENA`
          );
        }

        pending.set(String(chatId), {
          mode: "mailAddClienteNombre",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(correo).toLowerCase(),
        });

        return bot.sendMessage(chatId, "👤 *Agregar cliente*\n\nEscriba el nombre del cliente:", {
          parse_mode: "Markdown",
        });
      }

      if (data.startsWith("mail_del_cliente|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) {
          return bot.sendMessage(chatId, "⚠️ Este correo no tiene clientes.");
        }

        const kb = clientes.map((c, i) => [
          {
            text: `${i + 1}. ${c.nombre || "Sin nombre"} — PIN ${c.pin || "----"}`,
            callback_data: `mail_del_cliente_ok|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}|${i}`,
          },
        ]);

        kb.push([{ text: "⬅️ Volver", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }]);

        return bot.sendMessage(
          chatId,
          `➖ *Quitar cliente*\n\n📧 *${escMD(correo)}*\n\nSeleccione el cliente que desea quitar:`,
          {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: kb },
          }
        );
      }

      if (data.startsWith("mail_del_cliente_ok|")) {
        const [, plataforma, correoEnc, indexStr] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        const index = Number(indexStr);

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Este correo ya no tiene clientes.");
        if (isNaN(index) || index < 0 || index >= clientes.length) return bot.sendMessage(chatId, "❌ Cliente inválido.");

        const cliente = clientes[index];
        clientes.splice(index, 1);

        clientes = clientes.map((c, i) => ({
          ...c,
          slot: i + 1,
        }));

        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        await ref.set(
          {
            clientes,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            capacidad,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(
          chatId,
          "✅ *Cliente quitado correctamente*\n\n" +
            `👤 *Nombre:* ${escMD(cliente.nombre || "Sin nombre")}\n` +
            `🔐 *PIN:* ${escMD(cliente.pin || "----")}\n\n` +
            `👤 *Ocupados:* ${ocupados}/${capacidad}\n` +
            `✅ *Disponibles:* ${disponibles}\n` +
            `📊 *Estado:* ${escMD(estado)}`,
          { parse_mode: "Markdown" }
        );

        return mostrarPanelCorreo(chatId, plataforma, correo);
      }

      if (data.startsWith("mail_edit_pin|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Este correo no tiene clientes.");

        const kb = clientes.map((c, i) => [
          {
            text: `${i + 1}. ${c.nombre || "Sin nombre"} — PIN ${c.pin || "----"}`,
            callback_data: `mail_edit_pin_sel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}|${i}`,
          },
        ]);

        kb.push([{ text: "⬅️ Volver", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }]);

        return bot.sendMessage(
          chatId,
          `🔐 *Editar PIN*\n\n📧 *${escMD(correo)}*\n\nSeleccione el cliente:`,
          {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: kb },
          }
        );
      }

      if (data.startsWith("mail_edit_pin_sel|")) {
        const [, plataforma, correoEnc, indexStr] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");
        const clienteIndex = Number(indexStr);

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Este correo no tiene clientes.");
        if (isNaN(clienteIndex) || clienteIndex < 0 || clienteIndex >= clientes.length) {
          return bot.sendMessage(chatId, "❌ Cliente inválido.");
        }

        const cliente = clientes[clienteIndex];

        pending.set(String(chatId), {
          mode: "mailEditPin",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(correo).toLowerCase(),
          clienteIndex,
        });

        return bot.sendMessage(
          chatId,
          "🔐 *Editar PIN*\n\n" +
            `👤 *Cliente:* ${escMD(cliente.nombre || "Sin nombre")}\n` +
            `🔑 *PIN actual:* ${escMD(cliente.pin || "----")}\n\n` +
            "Escriba el nuevo PIN de 4 dígitos:",
          { parse_mode: "Markdown" }
        );
      }

      if (data.startsWith("mail_edit_clave|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const correoData = found.data || {};
        const claveActual = correoData.clave || "Sin clave";

        pending.set(String(chatId), {
          mode: "mailEditClaveCorreo",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(correo).toLowerCase(),
        });

        return bot.sendMessage(
          chatId,
          "✏️ *Editar clave del correo*\n\n" +
            `📧 *Correo:* ${escMD(correo)}\n` +
            `🔑 *Clave actual:* ${escMD(claveActual)}\n\n` +
            "Escriba la nueva clave del correo:",
          { parse_mode: "Markdown" }
        );
      }

      if (data.startsWith("mail_delete|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return bot.sendMessage(chatId, "❌ Este correo ya no existe.");

        return bot.sendMessage(
          chatId,
          "⚠️ *Confirmar eliminación*\n\n" +
            `📧 *Correo:* ${escMD(correo)}\n\n` +
            "Esta acción eliminará la cuenta del inventario.\n\n¿Está seguro que desea borrarla?",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Sí borrar", callback_data: `mail_delete_confirm|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }],
                [{ text: "❌ Cancelar", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(correo)}` }],
              ],
            },
          }
        );
      }

      if (data.startsWith("mail_delete_confirm|")) {
        const [, plataforma, correoEnc] = data.split("|");
        const correo = decodeURIComponent(correoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, correo);
        if (!found) return mostrarListaCorreosPlataforma(chatId, plataforma);

        const ref = found.ref;
        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (clientes.length > 0) {
          await bot.sendMessage(chatId, "⚠️ Este correo tenía clientes asignados. Se eliminará igualmente del inventario.");
        }

        await ref.delete();
        return enviarInventarioPlataforma(chatId, plataforma, 0);
      }

      if (data === "cli:txt:general") return reporteClientesTXTGeneral(chatId);
      if (data === "cli:txt:vendedores_split") return reporteClientesSplitPorVendedorTXT(chatId);

      if (data.startsWith("cli:txt:one:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        return enviarTxtComoArchivo(chatId, clienteResumenTXT(c), `cliente_${onlyDigits(c.telefono || "") || clientId}.txt`);
      }

      if (data.startsWith("cli:view:")) return enviarFichaCliente(chatId, data.split(":")[2]);
      if (data === "cli:wiz:start") return wizardStart(chatId);

      if (data.startsWith("wiz:plat:")) {
        const parts = data.split(":");
        const platRaw = parts[2] || "";
        const clientId = parts[3] || null;

        const plat = normalizarPlataforma(platRaw);
        if (!esPlataformaValida(plat)) {
          return bot.sendMessage(chatId, `⚠️ Plataforma inválida en wizard: ${platRaw}`);
        }

        let st = w(chatId);

        if (!st) {
          st = {
            step: 4,
            clientId,
            nombre: "",
            telefono: "",
            vendedor: "",
            servicio: {},
            servStep: 1,
          };
        }

        st.clientId = clientId || st.clientId;
        st.servicio = st.servicio || {};
        st.servicio.plataforma = plat;
        st.servStep = 2;
        st.step = 4;

        wset(chatId, st);

        return bot.sendMessage(chatId, "(Servicio 2/5) Correo de la cuenta:");
      }

      if (data.startsWith("wiz:addmore:")) {
        const clientId = data.split(":")[2];

        const nuevoState = {
          step: 4,
          clientId,
          nombre: "",
          telefono: "",
          vendedor: "",
          servicio: {},
          servStep: 1,
        };

        wset(chatId, nuevoState);

        return bot.sendMessage(chatId, "📌 Agregar otro servicio\nSeleccione plataforma:", {
          reply_markup: {
            inline_keyboard: kbPlataformasWiz("wiz:plat", clientId),
          },
        });
      }

      if (data.startsWith("wiz:finish:")) {
        const clientId = data.split(":")[2];
        wclear(chatId);
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:edit:menu:")) return menuEditarCliente(chatId, data.split(":")[3]);

      if (data.startsWith("cli:edit:nombre:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditNombre", clientId });
        return upsertPanel(
          chatId,
          "👤 *Editar nombre*\nEscriba el nuevo nombre:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:edit:tel:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditTel", clientId });
        return upsertPanel(
          chatId,
          "📱 *Editar teléfono*\nEscriba el nuevo teléfono:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:edit:vend:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditVendedor", clientId });
        return upsertPanel(
          chatId,
          "🧑‍💼 *Editar vendedor*\nEscriba el nuevo vendedor:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:list:")) return menuListaServicios(chatId, data.split(":")[3]);
      if (data.startsWith("cli:serv:menu:")) return menuServicio(chatId, data.split(":")[3], Number(data.split(":")[4]));

      if (data.startsWith("cli:serv:add:")) {
        const clientId = data.split(":")[3];
        return upsertPanel(
          chatId,
          "➕ *AGREGAR SERVICIO*\nSeleccione plataforma:",
          {
            inline_keyboard: [
              ...kbPlataformasWiz("cli:add:plat", clientId),
              [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:add:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[3]);
        const clientId = parts[4];

        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
        pending.set(String(chatId), { mode: "cliAddServMail", clientId, plat });

        return upsertPanel(
          chatId,
          `📧 *Correo* (${plat})\nEscriba el correo:`,
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:edit:")) {
        const parts = data.split(":");
        const field = parts[3];
        const clientId = parts[4];
        const idx = Number(parts[5]);

        if (field === "plat") {
          return upsertPanel(
            chatId,
            "📌 *Cambiar plataforma*\nSeleccione:",
            {
              inline_keyboard: [
                ...kbPlataformasWiz("cli:serv:set:plat", clientId, idx),
                [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
              ],
            },
            "Markdown"
          );
        }

        if (field === "mail") pending.set(String(chatId), { mode: "cliServEditMail", clientId, idx });
        if (field === "pin") pending.set(String(chatId), { mode: "cliServEditPin", clientId, idx });
        if (field === "precio") pending.set(String(chatId), { mode: "cliServEditPrecio", clientId, idx });
        if (field === "fecha") pending.set(String(chatId), { mode: "cliServEditFecha", clientId, idx });

        const titulo =
          field === "mail" ? "📧 *Cambiar correo*" :
          field === "pin" ? "🔐 *Cambiar pin*" :
          field === "precio" ? "💰 *Cambiar precio*" :
          "📅 *Cambiar fecha*";

        const hint =
          field === "precio" ? "Escriba el precio (solo número):" :
          field === "fecha" ? "Escriba dd/mm/yyyy:" :
          "Escriba el nuevo valor:";

        return upsertPanel(
          chatId,
          `${titulo}\n${hint}`,
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:set:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[4]);
        const clientId = parts[5];
        const idx = Number(parts[6]);

        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        servicios[idx] = { ...(servicios[idx] || {}), plataforma: plat };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuServicio(chatId, clientId, idx);
      }

      if (data.startsWith("cli:serv:del:ask:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const idx = Number(parts[5]);

        return upsertPanel(
          chatId,
          "🗑️ *Eliminar perfil*\nConfirmar borrado de este servicio?",
          {
            inline_keyboard: [
              [{ text: "✅ Confirmar", callback_data: `cli:serv:del:ok:${clientId}:${idx}` }],
              [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:del:ok:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const idx = Number(parts[5]);

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        servicios.splice(idx, 1);
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        if (servicios.length) return menuListaServicios(chatId, clientId);
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:ren:list:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

        const kb = servicios.map((s, i) => [
          { text: `🔄 ${i + 1}) ${s.plataforma} — ${s.correo} (Ren: ${s.fechaRenovacion || "-"})`, callback_data: `cli:ren:menu:${clientId}:${i}` },
        ]);
        kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

        return upsertPanel(chatId, "🔄 *RENOVAR SERVICIO*\nSeleccione cuál renovar:", { inline_keyboard: kb }, "Markdown");
      }

      if (data.startsWith("cli:ren:menu:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        const s = servicios[idx] || {};
        const texto = `🔄 *RENOVAR SERVICIO #${idx + 1}*\n📌 ${escMD(s.plataforma || "-")}\n📧 ${escMD(s.correo || "-")}\n📅 Actual: *${escMD(s.fechaRenovacion || "-")}*`;

        return upsertPanel(
          chatId,
          texto,
          {
            inline_keyboard: [
              [{ text: "➕ +30 días", callback_data: `cli:ren:+30:${clientId}:${idx}` }],
              [{ text: "📅 Poner fecha manual", callback_data: `cli:ren:fecha:${clientId}:${idx}` }],
              [{ text: "⬅️ Volver lista", callback_data: `cli:ren:list:${clientId}` }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:ren:+30:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        const actual = String(servicios[idx].fechaRenovacion || hoyDMY());
        const base = isFechaDMY(actual) ? actual : hoyDMY();
        const nueva = addDaysDMY(base, 30);

        servicios[idx] = { ...(servicios[idx] || {}), fechaRenovacion: nueva };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        return menuServicio(chatId, clientId, idx);
      }

      if (data.startsWith("cli:ren:all:ask:")) {
        const clientId = data.split(":")[4];
        return upsertPanel(
          chatId,
          "🔄 *Renovar todos +30 días*\n\n¿Desea renovar todos los servicios de este cliente?",
          {
            inline_keyboard: [
              [{ text: "✅ Confirmar", callback_data: `cli:ren:all:ok:${clientId}` }],
              [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:ren:all:ok:")) {
        const clientId = data.split(":")[4];

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

        const nuevos = servicios.map((s) => {
          const actual = String(s.fechaRenovacion || hoyDMY());
          const base = isFechaDMY(actual) ? actual : hoyDMY();
          return {
            ...s,
            fechaRenovacion: addDaysDMY(base, 30),
          };
        });

        await ref.set(
          {
            servicios: nuevos,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:ren:fecha:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        pending.set(String(chatId), { mode: "cliRenovarFechaManual", clientId, idx });

        return upsertPanel(
          chatId,
          "📅 *Renovar (fecha manual)*\nEscriba la nueva fecha en formato dd/mm/yyyy:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:ren:menu:${clientId}:${idx}` }]] },
          "Markdown"
        );
      }

      if (data === "txt:todos:hoy") {
        if (!isSuperAdmin(userId)) return bot.sendMessage(chatId, "⛔ Solo SUPERADMIN.");
        return enviarTXTATodosHoy(chatId);
      }
    }

    if (data === "ren:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      const texto = renovacionesTexto(list, fecha, adminOk ? null : vend?.nombre);
      return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
    }

    if (data === "txt:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      return enviarTXT(chatId, list, fecha, adminOk ? null : vend?.nombre);
    }

    if (data === "ren:mis") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      const texto = renovacionesTexto(list, fecha, vend.nombre);
      return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
    }

    if (data === "txt:mis") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      return enviarTXT(chatId, list, fecha, vend.nombre);
    }

    if (data === "vend:clientes") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      return enviarMisClientes(chatId, vend.nombre);
    }

    if (data === "vend:clientes:txt") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      return enviarMisClientesTXT(chatId, vend.nombre);
    }

    if (data === "rev:lista") return listarRevendedores(chatId);

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    logErr("❌ callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// MESSAGE HANDLER
// ===============================
bot.on("message", async (msg) => {
  if (!HAS_RUNTIME_LOCK) return;

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";
  if (!chatId) return;

  try {
    if (!allowMsg(chatId, userId)) return;

    const adminOk = await isAdmin(userId);
    const vendOk = await isVendedor(userId);

    if (wizard.has(String(chatId)) && text.startsWith("/")) {
      const cmd = limpiarQuery(text).split(" ")[0];

      if (cmd !== "menu" && cmd !== "start") {
        return bot.sendMessage(
          chatId,
          "⚠️ Está en creación de cliente.\nPrimero toque *➕ Agregar otra* o *✅ Finalizar*.",
          { parse_mode: "Markdown" }
        );
      }
    }

    if (text.startsWith("/")) {
      if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");

      const rawText = String(text || "").trim();

      if (adminOk) {
        const posibleCorreo = rawText.slice(1).trim().toLowerCase();

        if (isEmailLike(posibleCorreo)) {
          const hits = await buscarInventarioPorCorreo(posibleCorreo);

          if (hits.length === 1) {
            pending.set(String(chatId), {
              mode: "invSubmenuCtx",
              plat: normalizarPlataforma(hits[0].plataforma),
              correo: posibleCorreo,
            });
            return enviarSubmenuInventario(chatId, hits[0].plataforma, posibleCorreo);
          }

          if (hits.length > 1) {
            const kb = hits.map((x) => [
              {
                text: `📌 ${String(x.plataforma).toUpperCase()}`,
                callback_data: `inv:open:${normalizarPlataforma(x.plataforma)}:${encodeURIComponent(posibleCorreo)}`,
              },
            ]);
            kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

            return bot.sendMessage(chatId, `📧 ${escMD(posibleCorreo)}\nSeleccione plataforma:`, {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: kb },
            });
          }

          return bot.sendMessage(chatId, "⚠️ Correo no encontrado en inventario.");
        }
      }

      const cmd = limpiarQuery(text);
      const first = cmd.split(" ")[0];

      const vendedorCmd = new Set(["menu", "start", "miid", "id", "vincular_vendedor", "renovaciones", "txt"]);
      if (!adminOk && vendOk && !vendedorCmd.has(first)) return;

      const comandosReservados = new Set([
        "start",
        "menu",
        "stock",
        "buscar",
        "cliente",
        "renovaciones",
        "txt",
        "clientes_txt",
        "vendedores_txt_split",
        "reindex_clientes",
        "fix_duplicados",
        "add",
        "del",
        "editclave",
        "adminadd",
        "admindel",
        "adminlist",
        "addvendedor",
        "delvendedor",
        "id",
        "miid",
        "vincular_vendedor",
        ...PLATAFORMAS,
      ]);

      if (adminOk && !comandosReservados.has(first)) {
        const query = cmd.trim();

        if (onlyDigits(query).length >= 7) {
          const resultados = await buscarPorTelefonoTodos(query);
          const dedup = dedupeClientes(resultados);
          if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
          if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
          return enviarListaResultadosClientes(chatId, dedup);
        }

        const resultados = await buscarClienteRobusto(query);
        const dedup = dedupeClientes(resultados);

        if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
        if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

        return enviarListaResultadosClientes(chatId, dedup);
      }

      return;
    }

    if (wizard.has(String(chatId))) {
      if (!(await isAdmin(userId))) return;
      return wizardNext(chatId, text);
    }

    if (pending.has(String(chatId))) {
      if (!(await isAdmin(userId))) return;

      const p = pending.get(String(chatId));
      const t = String(text || "").trim();

      if (p.mode === "mailAddClienteNombre") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nombre del cliente.");

        pending.set(String(chatId), {
          mode: "mailAddClientePin",
          plataforma: p.plataforma,
          correo: p.correo,
          nombre: t,
        });

        return bot.sendMessage(chatId, "🔐 Escriba el PIN del cliente:");
      }

      if (p.mode === "mailAddClientePin") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el PIN.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        const capacidad = getCapacidadCorreo(correoData, p.plataforma);
        const ocupadosActual = clientes.length;
        const disponiblesActual = Math.max(0, capacidad - ocupadosActual);

        if (disponiblesActual <= 0) {
          return bot.sendMessage(chatId, "❌ Esta cuenta ya está llena.");
        }

        clientes.push({
          nombre: p.nombre,
          pin: t,
          slot: clientes.length + 1,
        });

        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        await ref.set(
          {
            clientes,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            capacidad,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(
          chatId,
          "✅ *Cliente agregado correctamente*\n\n" +
            `👤 *Nombre:* ${escMD(p.nombre)}\n` +
            `🔐 *PIN:* ${escMD(t)}\n\n` +
            `👤 *Ocupados:* ${ocupados}/${capacidad}\n` +
            `✅ *Disponibles:* ${disponibles}\n` +
            `📊 *Estado:* ${escMD(estado)}`,
          { parse_mode: "Markdown" }
        );

        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditPin") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nuevo PIN.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        if (p.clienteIndex < 0 || p.clienteIndex >= clientes.length) {
          return bot.sendMessage(chatId, "❌ Cliente inválido.");
        }

        clientes[p.clienteIndex] = {
          ...clientes[p.clienteIndex],
          pin: t,
        };

        await ref.set(
          {
            clientes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(chatId, "✅ PIN actualizado correctamente.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditClaveCorreo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la nueva clave.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ El correo no existe.");

        await found.ref.set(
          {
            clave: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(chatId, "✅ Clave del correo actualizada.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "invSumarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");

        pending.delete(String(chatId));

        const correo = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

        const d = doc.data() || {};
        const nuevoDisp = Number(d.disp || 0) + qty;

        await ref.set(
          { disp: nuevoDisp, estado: "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (p.mode === "invRestarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");

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

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (p.mode === "invEditClave") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Clave vacía.");

        pending.delete(String(chatId));

        const correo = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(correo, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Ese correo no existe en inventario.");

        await ref.set({ clave: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo });
        return enviarSubmenuInventario(chatId, plat, correo);
      }

      if (p.mode === "cliRenovarFechaManual") {
        const fecha = String(t || "").trim();
        if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");

        pending.delete(String(chatId));

        const ref = db.collection("clientes").doc(String(p.clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (p.idx < 0 || p.idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

        servicios[p.idx] = { ...(servicios[p.idx] || {}), fechaRenovacion: fecha };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliEditNombre") {
        const actual = await getCliente(p.clientId);
        if (!actual) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        }

        const dup = await clienteDuplicado(t, actual.telefono || "", p.clientId);
        if (dup) {
          return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        }

        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          { nombrePerfil: t, nombre_norm: normTxt(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditTel") {
        const actual = await getCliente(p.clientId);
        if (!actual) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        }

        const dup = await clienteDuplicado(actual.nombrePerfil || "", t, p.clientId);
        if (dup) {
          return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        }

        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          { telefono: t, telefono_norm: onlyDigits(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditVendedor") {
        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          { vendedor: t, vendedor_norm: normTxt(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliAddServMail") {
        if (!t.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido. Escriba el correo:");
        pending.set(String(chatId), {
          mode: "cliAddServPin",
          clientId: p.clientId,
          plat: p.plat,
          mail: t.toLowerCase(),
        });
        return bot.sendMessage(chatId, "🔐 Escriba el pin/clave:");
      }

      if (p.mode === "cliAddServPin") {
        pending.set(String(chatId), {
          mode: "cliAddServPrecio",
          clientId: p.clientId,
          plat: p.plat,
          mail: p.mail,
          pin: t,
        });
        return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
      }

      if (p.mode === "cliAddServPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
        pending.set(String(chatId), {
          mode: "cliAddServFecha",
          clientId: p.clientId,
          plat: p.plat,
          mail: p.mail,
          pin: p.pin,
          precio: n,
        });
        return bot.sendMessage(chatId, "📅 Fecha renovación (dd/mm/yyyy):");
      }

      if (p.mode === "cliAddServFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");

        pending.delete(String(chatId));

        await addServicioTx(String(p.clientId), {
          plataforma: p.plat,
          correo: p.mail,
          pin: p.pin,
          precio: p.precio,
          fechaRenovacion: t,
        });

        return enviarFichaCliente(chatId, p.clientId);
      }

      if (p.mode === "cliServEditMail") {
        if (!t.includes("@")) return bot.sendMessage(chatId, "⚠️ Correo inválido.");
        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { correo: t.toLowerCase() });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPin") {
        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { pin: t });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido.");
        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { precio: n });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");
        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { fechaRenovacion: t });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      return;
    }
  } catch (err) {
    logErr("❌ message handler error:", err?.message || err);
    if (chatId) {
      try {
        await bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
      } catch (_) {}
    }
  }
});

// ===============================
// AUTO TXT 7AM
// ===============================
let _lastDailyRun = "";

async function getLastRunDB() {
  const ref = db.collection("config").doc("dailyRun");
  const doc = await ref.get();
  return doc.exists ? String(doc.data()?.lastRun || "") : "";
}

async function setLastRunDB(dmy) {
  const ref = db.collection("config").doc("dailyRun");
  await ref.set(
    { lastRun: String(dmy), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

function getTimePartsNow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("es-HN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const obj = {};
  fmt.forEach((p) => {
    if (p.type !== "literal") obj[p.type] = p.value;
  });

  return {
    dmy: `${obj.day}/${obj.month}/${obj.year}`,
    hh: Number(obj.hour),
    mm: Number(obj.minute),
  };
}

async function enviarTxtRenovacionesDiariasPorVendedor() {
  if (!HAS_RUNTIME_LOCK) return;

  const { dmy } = getTimePartsNow();

  const snap = await db.collection("revendedores").get();
  if (snap.empty) return;

  for (const doc of snap.docs) {
    const rev = normalizeRevendedorDoc(doc);

    if (!rev.activo || !rev.nombre || !rev.telegramId) continue;

    const list = await obtenerRenovacionesPorFecha(dmy, rev.nombre);
    await enviarTXT(rev.telegramId, list, dmy, rev.nombre);

    await doc.ref.set(
      {
        autoLastSent: dmy,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

setInterval(async () => {
  if (!HAS_RUNTIME_LOCK) return;

  try {
    const { dmy, hh, mm } = getTimePartsNow();

    if (hh === 7 && mm === 0) {
      const dbLast = await getLastRunDB();
      if (_lastDailyRun === dmy || dbLast === dmy) return;

      _lastDailyRun = dmy;
      await setLastRunDB(dmy);
      await enviarTxtRenovacionesDiariasPorVendedor();

      logInfo(`✅ AutoTXT 7AM enviado (${dmy}) TZ=${TZ}`);
    }
  } catch (e) {
    logErr("❌ AutoTXT error:", e?.message || e);
  }
}, 30 * 1000);

// ===============================
// HARDEN
// ===============================
process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
});

process.on("SIGINT", async () => {
  console.log("⚠️ SIGINT recibido, cerrando polling...");
  try {
    await hardStopBot().catch(() => {});
    await releaseRuntimeLock().catch(() => {});
  } catch (_) {}
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("⚠️ SIGTERM recibido, cerrando polling...");
  try {
    await hardStopBot().catch(() => {});
    await releaseRuntimeLock().catch(() => {});
  } catch (_) {}
  process.exit(0);
});

// ===============================
// HTTP KEEPALIVE FINAL
// ===============================
const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: true,
          botPollingActive: BOT_POLLING_ACTIVE,
          botIsStarting: BOT_IS_STARTING,
          hasRuntimeLock: HAS_RUNTIME_LOCK,
          tz: TZ,
          ts: new Date().toISOString(),
        })
      );
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, () => {
    console.log("🌐 HTTP KEEPALIVE activo en puerto", PORT);
  });
