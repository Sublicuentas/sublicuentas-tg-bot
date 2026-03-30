/* ✅ SUBLICUENTAS TG BOT — PARTE 3/6 CORREGIDA
   CLIENTES / CRM / WIZARD / TXT / RENOVACIONES
   ------------------------------------------------
   Ajustes aplicados:
   - Wizard de cliente funcional y compatible con index_06_handlers
   - Ficha CRM limpia y entendible
   - Búsqueda robusta por nombre, teléfono, vendedor, correo o usuario
   - Sincronización automática CRM -> inventario al agregar servicios
   - TXT general, por vendedor, historial y renovaciones
   - Renovaciones por fecha con filtro opcional por vendedor
   - Compatible con plataformas de correo o usuario
   - Canva ya no obliga clave/pin
   - Si addServicioTx falla, el wizard devuelve el error real
*/

const fs = require("fs");
const path = require("path");

const core = require("./index_01_core");
const utils = require("./index_02_utils_roles");

const { bot, admin, db, PLATAFORMAS } = core;

const escMD = typeof utils.escMD === "function"
  ? utils.escMD
  : (v = "") => String(v || "").replace(/([_*`\[])/g, "\\$1");

const upsertPanel = typeof utils.upsertPanel === "function"
  ? utils.upsertPanel
  : async (chatId, text, keyboard = [], parseMode = "Markdown") => {
      return bot.sendMessage(chatId, text, {
        parse_mode: parseMode,
        reply_markup: { inline_keyboard: keyboard },
      });
    };

const wizard = utils.wizard instanceof Map ? utils.wizard : new Map();
const pending = utils.pending instanceof Map ? utils.pending : new Map();

const onlyDigits = typeof utils.onlyDigits === "function"
  ? utils.onlyDigits
  : (v = "") => String(v || "").replace(/\D+/g, "");

const logErr = typeof utils.logErr === "function"
  ? utils.logErr
  : (...args) => console.error(...args);

const isFechaDMY = typeof utils.isFechaDMY === "function"
  ? utils.isFechaDMY
  : (v = "") => /^\d{2}\/\d{2}\/\d{4}$/.test(String(v || "").trim());

const parseMontoNumber = typeof utils.parseMontoNumber === "function"
  ? utils.parseMontoNumber
  : (v = "") => {
      const s = String(v || "").replace(/,/g, "").trim();
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    };

const hoyDMY = typeof utils.hoyDMY === "function"
  ? utils.hoyDMY
  : (() => {
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    });

const normalizarPlataforma = typeof utils.normalizarPlataforma === "function"
  ? utils.normalizarPlataforma
  : (v = "") =>
      String(v || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "")
        .trim();

const esPlataformaValida = typeof utils.esPlataformaValida === "function"
  ? utils.esPlataformaValida
  : (v = "") => PLATFORM_KEYS.includes(normalizarPlataforma(v));

const isEmailLike = typeof utils.isEmailLike === "function"
  ? utils.isEmailLike
  : (v = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

const PLATFORM_KEYS = Array.isArray(PLATAFORMAS)
  ? PLATAFORMAS.map((x) => String(x || "").trim().toLowerCase())
  : Object.keys(PLATAFORMAS || {}).map((x) => String(x || "").trim().toLowerCase());

const CLIENTES_COLLECTION = "clientes";
const INVENTARIO_COLLECTION = "inventario";
const REVENDEDORES_COLLECTION = "revendedores";

// ===============================
// HELPERS GENERALES
// ===============================
function normTxt(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function platCfgLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (Array.isArray(PLATAFORMAS)) return {};
  return PLATAFORMAS[p] || {};
}

function requiereClaveOPinLocal(plataforma = "") {
  const cfg = platCfgLocal(plataforma);
  return cfg.requiereClave === true || cfg.requierePin === true;
}

function esSoloCorreoLocal(plataforma = "") {
  const cfg = platCfgLocal(plataforma);
  return cfg.requiereCorreo === true && cfg.requiereClave !== true && cfg.requierePin !== true;
}

function humanPlataforma(key = "") {
  const k = normalizarPlataforma(key);
  const map = {
    netflix: "Netflix",
    vipnetflix: "VIP Netflix",
    disneyp: "Disney Premium",
    disneys: "Disney Standard",
    hbomax: "HBO Max",
    primevideo: "Prime Video",
    paramount: "Paramount+",
    crunchyroll: "Crunchyroll",
    vix: "Vix",
    appletv: "Apple TV",
    universal: "Universal+",
    spotify: "Spotify",
    youtube: "YouTube",
    deezer: "Deezer",
    canva: "Canva",
    gemini: "Gemini",
    chatgpt: "ChatGPT",
    oleadatv1: "Oleada TV (1)",
    oleadatv3: "Oleada TV (3)",
    iptv1: "IPTV (1)",
    iptv3: "IPTV (3)",
    iptv4: "IPTV (4)",
  };
  return map[k] || String(key || "");
}

function iconPlataforma(key = "") {
  const k = normalizarPlataforma(key);
  const map = {
    netflix: "📺",
    vipnetflix: "🔥",
    disneyp: "🏰",
    disneys: "🎬",
    hbomax: "🎞️",
    primevideo: "🎥",
    paramount: "💿",
    crunchyroll: "🍥",
    vix: "📱",
    appletv: "🍎",
    universal: "🌍",
    spotify: "🎵",
    youtube: "▶️",
    deezer: "🎧",
    canva: "🎨",
    gemini: "✨",
    chatgpt: "🤖",
    oleadatv1: "🌊",
    oleadatv3: "🌊",
    iptv1: "📡",
    iptv3: "📡",
    iptv4: "📡",
  };
  return map[k] || "📦";
}

function getIdentLabelLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) return "Usuario";
  return "Correo";
}

function getAccessTypeLabelLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (esSoloCorreoLocal(p)) return "Solo correo";
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) return "Usuario + clave";
  return "Correo + clave";
}

function validateIdentByPlatformLocal(plataforma = "", ident = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(ident || "").trim();
  if (!v) return false;
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) {
    return v.length >= 3 && !/\s/.test(v);
  }
  return isEmailLike(v);
}

function normalizeIdentByPlatformLocal(plataforma = "", ident = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(ident || "").trim();
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) return v;
  return v.toLowerCase();
}

function docIdInventarioLocal(ident = "", plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const i = normalizeIdentByPlatformLocal(p, ident)
    .toLowerCase()
    .replace(/[.#$/\[\]\s]+/g, "_");
  return `${p}__${i}`;
}

function getTotalPorPlataformaLocal(plat = "") {
  const p = normalizarPlataforma(plat);
  const map = {
    netflix: 5,
    vipnetflix: 1,
    disneyp: 6,
    disneys: 3,
    hbomax: 5,
    primevideo: 5,
    paramount: 5,
    crunchyroll: 5,
    vix: 4,
    appletv: 4,
    universal: 4,
    spotify: 1,
    youtube: 1,
    deezer: 1,
    oleadatv1: 1,
    oleadatv3: 3,
    iptv1: 1,
    iptv3: 3,
    iptv4: 4,
    canva: 1,
    gemini: 1,
    chatgpt: 1,
  };
  return map[p] || 1;
}

function parseDMYtoDate(dmy = "") {
  const s = String(dmy || "").trim();
  if (!isFechaDMY(s)) return null;
  const [dd, mm, yyyy] = s.split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  return dt;
}

function parseDMYtoTS(dmy = "") {
  const dt = parseDMYtoDate(dmy);
  return dt ? dt.getTime() : 0;
}

function addDaysDMY(baseDmy = "", days = 0) {
  const dt = parseDMYtoDate(baseDmy) || parseDMYtoDate(hoyDMY());
  dt.setDate(dt.getDate() + Number(days || 0));
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = String(dt.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function safeBtnLabel(txt = "", max = 58) {
  const s = String(txt || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
}

function getEstadoServicio(fechaRenovacion = "") {
  const hoy = parseDMYtoTS(hoyDMY());
  const f = parseDMYtoTS(fechaRenovacion);
  if (!f) return { emoji: "⚪", texto: "Sin fecha", orden: 99 };
  if (f < hoy) return { emoji: "🔴", texto: "Vencido", orden: 0 };
  if (f === hoy) return { emoji: "🟠", texto: "Vence hoy", orden: 1 };
  const diffDays = Math.ceil((f - hoy) / 86400000);
  if (diffDays <= 3) return { emoji: "🟡", texto: "Próximo", orden: 2 };
  return { emoji: "🟢", texto: "Activo", orden: 3 };
}

function resumenGeneralCliente(servicios = []) {
  const rows = Array.isArray(servicios) ? servicios : [];
  let total = 0;
  let proxima = "";
  let proximaTS = Infinity;
  let worst = { emoji: "⚪", texto: "Sin fecha", orden: 99 };

  for (const s of rows) {
    total += Number(s.precio || 0);
    const fecha = String(s.fechaRenovacion || "").trim();
    const ts = parseDMYtoTS(fecha);
    if (ts && ts < proximaTS) {
      proximaTS = ts;
      proxima = fecha;
    }
    const est = getEstadoServicio(fecha);
    if (est.orden < worst.orden) worst = est;
  }

  return {
    total,
    proxima: proxima || "Sin fecha",
    estadoEmoji: worst.emoji,
    estadoTexto: rows.length ? worst.texto : "Sin servicios",
    activos: rows.length,
  };
}

function fileSafeName(v = "", fallback = "archivo") {
  const s = String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return s || fallback;
}

async function enviarTxtComoArchivo(chatId, contenido = "", fileName = "reporte.txt") {
  const tempPath = path.join("/tmp", `${Date.now()}_${fileSafeName(fileName, "reporte")}`);
  fs.writeFileSync(tempPath, String(contenido || ""), "utf8");
  try {
    await bot.sendDocument(chatId, tempPath, {
      caption: fileName,
    });
  } finally {
    try { fs.unlinkSync(tempPath); } catch (_) {}
  }
}

function serviciosConIndiceOriginal(servicios = []) {
  return (Array.isArray(servicios) ? servicios : []).map((s, idxOriginal) => ({
    ...(s || {}),
    idxOriginal,
  }));
}

function dedupeClientes(rows = []) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = String(r?.id || "").trim();
    if (!id) continue;
    if (!map.has(id)) map.set(id, r);
  }
  return Array.from(map.values());
}

function kbPlataformasWiz(prefix = "wiz:plat", clientId = null, idx = null) {
  const rows = [];
  const items = PLATFORM_KEYS.map((k) => {
    let callback_data = `${prefix}:${k}`;
    if (clientId !== null && clientId !== undefined) callback_data += `:${clientId}`;
    if (idx !== null && idx !== undefined) callback_data += `:${idx}`;
    return {
      text: `${iconPlataforma(k)} ${humanPlataforma(k)}`,
      callback_data,
    };
  });

  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}

// ===============================
// INVENTARIO SYNC HELPERS
// ===============================
async function getInventarioDoc(plataforma = "", acceso = "") {
  const plat = normalizarPlataforma(plataforma);
  const ident = normalizeIdentByPlatformLocal(plat, acceso);
  const docId = docIdInventarioLocal(ident, plat);
  const ref = db.collection(INVENTARIO_COLLECTION).doc(docId);
  const doc = await ref.get();
  if (doc.exists) return { ref, data: doc.data() || {} };

  const snap = await db
    .collection(INVENTARIO_COLLECTION)
    .where("plataforma", "==", plat)
    .where("correo", "==", ident)
    .limit(1)
    .get();

  if (!snap.empty) {
    const d = snap.docs[0];
    return { ref: d.ref, data: d.data() || {} };
  }

  return null;
}

async function syncServicioEnInventario({ clienteNombre = "", plataforma = "", correo = "", pin = "" }) {
  const plat = normalizarPlataforma(plataforma);
  const acceso = normalizeIdentByPlatformLocal(plat, correo);
  const found = await getInventarioDoc(plat, acceso);
  if (!found) return { ok: false, reason: "not_found" };

  const { ref, data } = found;
  let clientes = Array.isArray(data.clientes) ? data.clientes.slice() : [];

  const yaExiste = clientes.some((x) => {
    const nom = normTxt(x?.nombre || "");
    const pinX = String(x?.pin || "").trim();
    return nom === normTxt(clienteNombre) && pinX === String(pin || "").trim();
  });

  if (yaExiste) return { ok: true, synced: true, added: false };

  const capacidad = Number(data.capacidad || data.total || getTotalPorPlataformaLocal(plat) || 1);
  const ocupadosAntes = clientes.length;
  const disponiblesAntes = Math.max(0, capacidad - ocupadosAntes);

  if (disponiblesAntes <= 0) {
    return { ok: false, reason: "full" };
  }

  clientes.push({
    nombre: String(clienteNombre || "").trim(),
    pin: String(pin || "").trim(),
    slot: clientes.length + 1,
  });

  clientes = clientes.map((x, i) => ({ ...x, slot: i + 1 }));
  const ocupados = clientes.length;
  const disponibles = Math.max(0, capacidad - ocupados);
  const estado = disponibles === 0 ? "llena" : "activa";

  await ref.set(
    {
      clientes,
      ocupados,
      disponibles,
      disp: disponibles,
      capacidad,
      estado,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, synced: true, added: true, ocupados, disponibles, capacidad };
}

async function removeServicioDeInventario({ clienteNombre = "", plataforma = "", correo = "", pin = "" }) {
  const plat = normalizarPlataforma(plataforma);
  const acceso = normalizeIdentByPlatformLocal(plat, correo);
  const found = await getInventarioDoc(plat, acceso);
  if (!found) return { ok: false, reason: "not_found" };

  const { ref, data } = found;
  let clientes = Array.isArray(data.clientes) ? data.clientes.slice() : [];
  const idx = clientes.findIndex((x) => normTxt(x?.nombre || "") === normTxt(clienteNombre) && String(x?.pin || "") === String(pin || ""));
  if (idx === -1) return { ok: true, removed: false };

  clientes.splice(idx, 1);
  clientes = clientes.map((x, i) => ({ ...x, slot: i + 1 }));

  const capacidad = Number(data.capacidad || data.total || getTotalPorPlataformaLocal(plat) || 1);
  const ocupados = clientes.length;
  const disponibles = Math.max(0, capacidad - ocupados);
  const estado = disponibles === 0 ? "llena" : "activa";

  await ref.set(
    {
      clientes,
      ocupados,
      disponibles,
      disp: disponibles,
      capacidad,
      estado,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, removed: true };
}

// ===============================
// LECTURAS / BÚSQUEDAS
// ===============================
async function getCliente(clientId) {
  const id = String(clientId || "").trim();
  if (!id) return null;
  const doc = await db.collection(CLIENTES_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() || {}) };
}

async function clienteDuplicado(nombre = "", telefono = "", excludeId = null) {
  const nombreNorm = normTxt(nombre);
  const telefonoNorm = onlyDigits(telefono);
  if (!nombreNorm || !telefonoNorm) return false;

  const snap = await db.collection(CLIENTES_COLLECTION).get();
  for (const d of snap.docs) {
    if (excludeId && String(d.id) === String(excludeId)) continue;
    const x = d.data() || {};
    if (normTxt(x.nombrePerfil || "") === nombreNorm && onlyDigits(x.telefono || "") === telefonoNorm) {
      return true;
    }
  }
  return false;
}

async function buscarPorTelefonoTodos(query = "") {
  const q = onlyDigits(query);
  if (!q) return [];
  const snap = await db.collection(CLIENTES_COLLECTION).get();
  const out = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const tel = onlyDigits(x.telefono || "");
    if (tel.includes(q)) out.push({ id: d.id, ...x });
  });
  return out;
}

async function buscarClienteRobusto(query = "") {
  const q = String(query || "").trim();
  const qNorm = normTxt(q);
  const qDigits = onlyDigits(q);
  if (!qNorm && !qDigits) return [];

  const snap = await db.collection(CLIENTES_COLLECTION).get();
  const out = [];

  snap.forEach((d) => {
    const x = d.data() || {};
    const nombre = String(x.nombrePerfil || "");
    const telefono = String(x.telefono || "");
    const vendedor = String(x.vendedor || "");
    const servicios = Array.isArray(x.servicios) ? x.servicios : [];

    const bolsas = [
      normTxt(nombre),
      normTxt(x.nombre_norm || ""),
      onlyDigits(telefono),
      normTxt(vendedor),
      normTxt(x.vendedor_norm || ""),
      ...servicios.flatMap((s) => [
        normTxt(s?.correo || ""),
        normTxt(s?.plataforma || ""),
        normTxt(humanPlataforma(s?.plataforma || "")),
        String(s?.pin || "").trim().toLowerCase(),
      ]),
    ];

    let ok = false;
    if (qDigits && qDigits.length >= 4 && bolsas.some((b) => String(b).includes(qDigits))) ok = true;
    if (!ok && qNorm && bolsas.some((b) => String(b).includes(qNorm))) ok = true;

    if (ok) out.push({ id: d.id, ...x });
  });

  return out;
}

// ===============================
// FORMATO TEXTO / FICHA CRM
// ===============================
function clienteResumenTXT(c = {}) {
  const nombre = String(c.nombrePerfil || "Sin nombre").trim();
  const telefono = String(c.telefono || "-").trim();
  const vendedor = String(c.vendedor || "-").trim();
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const resumen = resumenGeneralCliente(servicios);

  let txt = "CRM CLIENTE\n";
  txt += `Nombre: ${nombre}\n`;
  txt += `Telefono: ${telefono}\n`;
  txt += `Vendedor: ${vendedor}\n`;
  txt += `Estado general: ${resumen.estadoTexto}\n`;
  txt += `Total mensual: ${Number(resumen.total || 0).toFixed(2)} Lps\n`;
  txt += `Proxima renovacion: ${resumen.proxima}\n`;
  txt += `Servicios activos: ${servicios.length}\n\n`;
  txt += "SERVICIOS\n";

  if (!servicios.length) {
    txt += "(sin servicios)\n";
  } else {
    servicios.forEach((s, i) => {
      const est = getEstadoServicio(s.fechaRenovacion || "");
      txt += `\n${i + 1}) ${humanPlataforma(s.plataforma || "")}\n`;
      txt += `${getIdentLabelLocal(s.plataforma || "")}: ${s.correo || "-"}\n`;
      txt += `Clave/PIN: ${s.pin || "-"}\n`;
      txt += `Precio: ${Number(s.precio || 0).toFixed(2)} Lps\n`;
      txt += `Renovacion: ${s.fechaRenovacion || "-"}\n`;
      txt += `Estado: ${est.texto}\n`;
    });
  }

  return txt;
}

function renderFichaClienteMarkdown(c = {}) {
  const nombre = String(c.nombrePerfil || "Sin nombre").trim();
  const telefono = String(c.telefono || "-").trim();
  const vendedor = String(c.vendedor || "-").trim();
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const resumen = resumenGeneralCliente(servicios);

  let txt = `👤 *CRM CLIENTE*\n\n`;
  txt += `🙍 *Nombre:* ${escMD(nombre)}\n`;
  txt += `📱 *Teléfono:* ${escMD(telefono)}\n`;
  txt += `🧾 *Vendedor:* ${escMD(vendedor)}\n`;
  txt += `📊 *Estado general:* ${resumen.estadoEmoji} ${escMD(resumen.estadoTexto)}\n`;
  txt += `💰 *Total mensual:* ${escMD(`${Number(resumen.total || 0).toFixed(2)} Lps`)}\n`;
  txt += `📅 *Próxima renovación:* ${escMD(resumen.proxima)}\n`;
  txt += `🧩 *Servicios activos:* ${escMD(String(servicios.length))}\n\n`;
  txt += `*SERVICIOS*\n`;

  if (!servicios.length) {
    txt += `\n_Sin servicios registrados._`;
  } else {
    servicios.forEach((s, i) => {
      const est = getEstadoServicio(s.fechaRenovacion || "");
      txt += `\n\n${i + 1}) ${iconPlataforma(s.plataforma || "")} *${escMD(humanPlataforma(s.plataforma || ""))}*\n`;
      txt += `${getIdentLabelLocal(s.plataforma || "") === "Usuario" ? "👤" : "📧"} ${escMD(s.correo || "-")}\n`;
      txt += `🔐 ${escMD(s.pin || "-")}\n`;
      txt += `💵 ${escMD(`${Number(s.precio || 0).toFixed(2)} Lps`)}\n`;
      txt += `📅 ${escMD(s.fechaRenovacion || "-")} — ${est.emoji} ${escMD(est.texto)}`;
    });
  }

  return txt;
}

// ===============================
// MENÚS CRM
// ===============================
async function enviarFichaCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const keyboard = [
    [{ text: "✏️ Editar cliente", callback_data: `cli:edit:menu:${c.id}` }],
    [{ text: "🧩 Editar servicios", callback_data: `cli:serv:list:${c.id}` }],
    [{ text: "🔄 Renovar servicio", callback_data: `cli:ren:list:${c.id}` }],
    [{ text: "⏫ Renovar TODOS +30 días", callback_data: `cli:ren:all:ask:${c.id}` }],
    [{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${c.id}` }],
    [
      { text: "📜 Historial TXT", callback_data: `cli:txt:hist:${c.id}` },
      { text: "📄 TXT cliente", callback_data: `cli:txt:one:${c.id}` },
    ],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ];

  return upsertPanel(chatId, renderFichaClienteMarkdown(c), keyboard);
}

async function enviarListaResultadosClientes(chatId, rows = []) {
  const items = dedupeClientes(rows);
  if (!items.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");

  const keyboard = items.slice(0, 30).map((c) => [
    {
      text: safeBtnLabel(`${c.nombrePerfil || "Sin nombre"} • ${c.telefono || "sin teléfono"}`),
      callback_data: `cli:view:${c.id}`,
    },
  ]);
  keyboard.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, "🔎 *RESULTADOS DE BÚSQUEDA*\n\nSeleccione un cliente:", keyboard);
}

async function menuEditarCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const txt =
    `✏️ *EDITAR CLIENTE*\n\n` +
    `👤 *Nombre:* ${escMD(c.nombrePerfil || "-")}\n` +
    `📱 *Teléfono:* ${escMD(c.telefono || "-")}\n` +
    `🧾 *Vendedor:* ${escMD(c.vendedor || "-")}\n\n` +
    `Seleccione qué desea editar:`;

  return upsertPanel(chatId, txt, [
    [{ text: "👤 Editar nombre", callback_data: `cli:edit:nombre:${clientId}` }],
    [{ text: "📱 Editar teléfono", callback_data: `cli:edit:tel:${clientId}` }],
    [{ text: "🧾 Editar vendedor", callback_data: `cli:edit:vend:${clientId}` }],
    [{ text: "⬅️ Volver ficha", callback_data: `cli:view:${clientId}` }],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuListaServicios(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = serviciosConIndiceOriginal(Array.isArray(c.servicios) ? c.servicios : []);
  if (!servicios.length) {
    return upsertPanel(chatId, "🧩 *SERVICIOS*\n\nEste cliente no tiene servicios.", [
      [{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }],
      [{ text: "⬅️ Volver ficha", callback_data: `cli:view:${clientId}` }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ]);
  }

  const kb = servicios.map((s, i) => [{
    text: safeBtnLabel(`${i + 1}) ${humanPlataforma(s.plataforma || "")} • ${s.correo || "-"}`),
    callback_data: `cli:serv:menu:${clientId}:${s.idxOriginal}`,
  }]);

  kb.push([{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }]);
  kb.push([{ text: "⬅️ Volver ficha", callback_data: `cli:view:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, `🧩 *SERVICIOS DE ${escMD(c.nombrePerfil || "CLIENTE")}*\n\nSeleccione uno:`, kb);
}

async function menuServicio(chatId, clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

  const s = servicios[idx] || {};
  const est = getEstadoServicio(s.fechaRenovacion || "");
  const txt =
    `🧩 *SERVICIO #${idx + 1}*\n\n` +
    `${iconPlataforma(s.plataforma || "")} *Plataforma:* ${escMD(humanPlataforma(s.plataforma || ""))}\n` +
    `${getIdentLabelLocal(s.plataforma || "") === "Usuario" ? "👤" : "📧"} *${escMD(getIdentLabelLocal(s.plataforma || ""))}:* ${escMD(s.correo || "-")}\n` +
    `🔐 *Clave/PIN:* ${escMD(s.pin || "-")}\n` +
    `💰 *Precio:* ${escMD(`${Number(s.precio || 0).toFixed(2)} Lps`)}\n` +
    `📅 *Renovación:* ${escMD(s.fechaRenovacion || "-")}\n` +
    `📊 *Estado:* ${est.emoji} ${escMD(est.texto)}`;

  return upsertPanel(chatId, txt, [
    [{ text: "📌 Cambiar plataforma", callback_data: `cli:serv:edit:plat:${clientId}:${idx}` }],
    [{ text: `${getIdentLabelLocal(s.plataforma || "") === "Usuario" ? "👤" : "📧"} Cambiar ${getIdentLabelLocal(s.plataforma || "").toLowerCase()}`, callback_data: `cli:serv:edit:mail:${clientId}:${idx}` }],
    [{ text: "🔐 Cambiar clave/PIN", callback_data: `cli:serv:edit:pin:${clientId}:${idx}` }],
    [{ text: "💰 Cambiar precio", callback_data: `cli:serv:edit:precio:${clientId}:${idx}` }],
    [{ text: "📅 Cambiar fecha", callback_data: `cli:serv:edit:fecha:${clientId}:${idx}` }],
    [{ text: "🗑️ Eliminar servicio", callback_data: `cli:serv:del:ask:${clientId}:${idx}` }],
    [{ text: "⬅️ Volver servicios", callback_data: `cli:serv:list:${clientId}` }],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

// ===============================
// ESCRITURAS CRM
// ===============================
async function addServicioTx(clientId, servicio = {}) {
  const id = String(clientId || "").trim();
  if (!id) throw new Error("Cliente inválido.");

  const ref = db.collection(CLIENTES_COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios.slice() : [];

  const plat = normalizarPlataforma(servicio.plataforma || "");
  if (!esPlataformaValida(plat)) throw new Error("Plataforma inválida.");

  const ident = normalizeIdentByPlatformLocal(plat, servicio.correo || "");
  if (!validateIdentByPlatformLocal(plat, ident)) {
    throw new Error(`${getIdentLabelLocal(plat)} inválido.`);
  }

  const pin = String(servicio.pin || "").trim();
  const precio = Number(servicio.precio || 0);
  const fechaRenovacion = String(servicio.fechaRenovacion || "").trim();

  if (requiereClaveOPinLocal(plat) && !pin) throw new Error("Clave/PIN inválido.");
  if (!Number.isFinite(precio) || precio <= 0) throw new Error("Precio inválido.");
  if (!isFechaDMY(fechaRenovacion)) throw new Error("Fecha de renovación inválida.");

  const sync = await syncServicioEnInventario({
    clienteNombre: c.nombrePerfil || "",
    plataforma: plat,
    correo: ident,
    pin,
  });

  if (sync.reason === "full") {
    throw new Error("La cuenta en inventario ya está llena.");
  }

  const nuevoServicio = {
    plataforma: plat,
    correo: ident,
    pin,
    precio,
    fechaRenovacion,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  servicios.push(nuevoServicio);

  await ref.set(
    {
      servicios,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, servicio: nuevoServicio, sync };
}

async function patchServicio(clientId, idx, patch = {}) {
  const ref = db.collection(CLIENTES_COLLECTION).doc(String(clientId || ""));
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios.slice() : [];
  if (idx < 0 || idx >= servicios.length) throw new Error("Servicio inválido.");

  const actual = servicios[idx] || {};
  const previo = {
    plataforma: actual.plataforma,
    correo: actual.correo,
    pin: actual.pin,
  };

  const siguiente = { ...actual, ...patch };
  siguiente.plataforma = normalizarPlataforma(siguiente.plataforma || actual.plataforma || "");

  if (!esPlataformaValida(siguiente.plataforma)) throw new Error("Plataforma inválida.");

  if (Object.prototype.hasOwnProperty.call(siguiente, "correo")) {
    siguiente.correo = normalizeIdentByPlatformLocal(siguiente.plataforma, siguiente.correo || "");
    if (!validateIdentByPlatformLocal(siguiente.plataforma, siguiente.correo)) {
      throw new Error(`${getIdentLabelLocal(siguiente.plataforma)} inválido.`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(siguiente, "precio")) {
    const n = Number(siguiente.precio || 0);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Precio inválido.");
    siguiente.precio = n;
  }

  if (Object.prototype.hasOwnProperty.call(siguiente, "fechaRenovacion")) {
    if (!isFechaDMY(String(siguiente.fechaRenovacion || ""))) {
      throw new Error("Fecha inválida.");
    }
  }

  servicios[idx] = siguiente;

  await ref.set(
    {
      servicios,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const cambioInventario =
    normalizarPlataforma(previo.plataforma || "") !== normalizarPlataforma(siguiente.plataforma || "") ||
    String(previo.correo || "") !== String(siguiente.correo || "") ||
    String(previo.pin || "") !== String(siguiente.pin || "");

  if (cambioInventario) {
    try {
      await removeServicioDeInventario({
        clienteNombre: c.nombrePerfil || "",
        plataforma: previo.plataforma || "",
        correo: previo.correo || "",
        pin: previo.pin || "",
      });
    } catch (e) {
      logErr("patchServicio.removeInventario", e);
    }

    try {
      await syncServicioEnInventario({
        clienteNombre: c.nombrePerfil || "",
        plataforma: siguiente.plataforma || "",
        correo: siguiente.correo || "",
        pin: siguiente.pin || "",
      });
    } catch (e) {
      logErr("patchServicio.addInventario", e);
    }
  }

  return { ok: true, servicio: siguiente };
}

// ===============================
// WIZARD CLIENTE
// ===============================
async function wizardStart(chatId) {
  wizard.set(String(chatId), {
    step: 1,
    clientId: null,
    nombre: "",
    telefono: "",
    vendedor: "",
    servicio: {},
    servStep: 1,
  });

  return upsertPanel(
    chatId,
    "👤 *NUEVO CLIENTE*\n\n(1/3) Escriba el *nombre del cliente*: ",
    [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]
  );
}

async function wizardNext(chatId, rawText = "") {
  const st = wizard.get(String(chatId));
  if (!st) return;

  const t = String(rawText || "").trim();
  if (!t) return bot.sendMessage(chatId, "⚠️ Escriba un valor válido.");

  if (st.step === 1) {
    st.nombre = t;
    st.step = 2;
    wizard.set(String(chatId), st);
    return bot.sendMessage(chatId, "(2/3) Teléfono del cliente:");
  }

  if (st.step === 2) {
    const tel = onlyDigits(t);
    if (tel.length < 7) return bot.sendMessage(chatId, "⚠️ Teléfono inválido. Escriba al menos 7 dígitos.");
    st.telefono = t;
    st.step = 3;
    wizard.set(String(chatId), st);
    return bot.sendMessage(chatId, "(3/3) Vendedor responsable:");
  }

  if (st.step === 3) {
    st.vendedor = t;
    st.step = 4;
    st.servStep = 1;
    st.servicio = {};
    wizard.set(String(chatId), st);

    return bot.sendMessage(chatId, "📌 Seleccione plataforma del servicio:", {
      reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", st.clientId) },
    });
  }

  if (st.step === 4) {
    const plat = normalizarPlataforma(st?.servicio?.plataforma || "");
    if (!plat) {
      return bot.sendMessage(chatId, "⚠️ Primero seleccione la plataforma.");
    }

    if (st.servStep === 2) {
      if (!validateIdentByPlatformLocal(plat, t)) {
        return bot.sendMessage(chatId, `⚠️ ${getIdentLabelLocal(plat)} inválido.`);
      }
      st.servicio.correo = normalizeIdentByPlatformLocal(plat, t);

      if (esSoloCorreoLocal(plat)) {
        st.servicio.pin = "";
        st.servStep = 4;
        wizard.set(String(chatId), st);
        return bot.sendMessage(chatId, "(Servicio 4/5) Precio (solo número, Lps):");
      }

      st.servStep = 3;
      wizard.set(String(chatId), st);
      return bot.sendMessage(chatId, "(Servicio 3/5) Clave/PIN:");
    }

    if (st.servStep === 3) {
      st.servicio.pin = t;
      st.servStep = 4;
      wizard.set(String(chatId), st);
      return bot.sendMessage(chatId, "(Servicio 4/5) Precio (solo número, Lps):");
    }

    if (st.servStep === 4) {
      const precio = parseMontoNumber(t);
      if (!Number.isFinite(precio) || precio <= 0) {
        return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número.");
      }
      st.servicio.precio = precio;
      st.servStep = 5;
      wizard.set(String(chatId), st);
      return bot.sendMessage(chatId, "(Servicio 5/5) Fecha renovación (dd/mm/yyyy):");
    }

    if (st.servStep === 5) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy.");
      st.servicio.fechaRenovacion = t;

      let clientId = st.clientId;
      let createdNow = false;
      let refNew = null;

      if (!clientId) {
        const dup = await clienteDuplicado(st.nombre, st.telefono);
        if (dup) {
          return bot.sendMessage(chatId, "⚠️ Ya existe un cliente con ese nombre y teléfono.");
        }

        refNew = db.collection(CLIENTES_COLLECTION).doc();
        clientId = refNew.id;
        createdNow = true;

        await refNew.set({
          nombrePerfil: st.nombre,
          nombre_norm: normTxt(st.nombre),
          telefono: st.telefono,
          telefono_norm: onlyDigits(st.telefono),
          vendedor: st.vendedor,
          vendedor_norm: normTxt(st.vendedor),
          servicios: [],
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      try {
        await addServicioTx(clientId, {
          plataforma: plat,
          correo: st.servicio.correo,
          pin: st.servicio.pin,
          precio: st.servicio.precio,
          fechaRenovacion: st.servicio.fechaRenovacion,
        });
      } catch (e) {
        if (createdNow && refNew) {
          try {
            await refNew.delete();
          } catch (_) {}
        }
        return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo guardar el servicio."}`);
      }

      wizard.set(String(chatId), {
        step: 4,
        clientId,
        nombre: st.nombre,
        telefono: st.telefono,
        vendedor: st.vendedor,
        servicio: {},
        servStep: 1,
      });

      return upsertPanel(
        chatId,
        "✅ *Servicio guardado correctamente*\n\nSeleccione qué desea hacer ahora:",
        [
          [{ text: "➕ Agregar otra", callback_data: `wiz:addmore:${clientId}` }],
          [{ text: "✅ Finalizar", callback_data: `wiz:finish:${clientId}` }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]
      );
    }
  }
}

// ===============================
// RENOVACIONES
// ===============================
async function obtenerRenovacionesPorFecha(fechaDMY, vendedor = null) {
  const fecha = String(fechaDMY || "").trim();
  if (!isFechaDMY(fecha)) return [];
  const vendedorNorm = vendedor ? normTxt(vendedor) : "";

  const snap = await db.collection(CLIENTES_COLLECTION).get();
  const out = [];

  snap.forEach((d) => {
    const c = d.data() || {};
    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    const vendedorCliente = String(c.vendedor || "").trim();

    if (vendedorNorm && normTxt(vendedorCliente) !== vendedorNorm) return;

    servicios.forEach((s, idx) => {
      if (String(s?.fechaRenovacion || "").trim() !== fecha) return;
      out.push({
        clientId: d.id,
        idx,
        nombrePerfil: c.nombrePerfil || "Sin nombre",
        telefono: c.telefono || "-",
        vendedor: vendedorCliente || "-",
        plataforma: s.plataforma || "",
        correo: s.correo || "",
        pin: s.pin || "",
        precio: Number(s.precio || 0),
        fechaRenovacion: s.fechaRenovacion || fecha,
      });
    });
  });

  out.sort((a, b) => {
    const va = normTxt(a.vendedor || "");
    const vb = normTxt(b.vendedor || "");
    if (va !== vb) return va.localeCompare(vb, "es");
    return normTxt(a.nombrePerfil || "").localeCompare(normTxt(b.nombrePerfil || ""), "es");
  });

  return out;
}

function renovacionesTexto(rows = [], fecha = "", vendedor = null) {
  const items = Array.isArray(rows) ? rows : [];
  let txt = `📅 *RENOVACIONES DEL ${escMD(fecha)}*`;
  if (vendedor) txt += `\n👤 *Vendedor:* ${escMD(vendedor)}`;
  txt += `\n\n`;

  if (!items.length) {
    txt += `_No hay renovaciones para esta fecha._`;
    return txt;
  }

  let total = 0;
  items.forEach((x) => { total += Number(x.precio || 0); });

  txt += `*Total perfiles:* ${escMD(String(items.length))}\n`;
  txt += `*Total esperado:* ${escMD(`${total.toFixed(2)} Lps`)}\n\n`;

  items.forEach((x, i) => {
    txt += `${i + 1}. ${iconPlataforma(x.plataforma || "")} *${escMD(x.nombrePerfil || "Sin nombre")}*\n`;
    txt += `   📱 ${escMD(x.telefono || "-")}\n`;
    txt += `   📦 ${escMD(humanPlataforma(x.plataforma || ""))}\n`;
    txt += `   ${getIdentLabelLocal(x.plataforma || "") === "Usuario" ? "👤" : "📧"} ${escMD(x.correo || "-")}\n`;
    txt += `   💰 ${escMD(`${Number(x.precio || 0).toFixed(2)} Lps`)}\n`;
    txt += `   🧾 ${escMD(x.vendedor || "-")}\n\n`;
  });

  return txt.trim();
}

function renovacionesTextoPlano(rows = [], fecha = "", vendedor = null) {
  const items = Array.isArray(rows) ? rows : [];
  let txt = `RENOVACIONES DEL ${fecha}\n`;
  if (vendedor) txt += `Vendedor: ${vendedor}\n`;
  txt += `\n`;

  if (!items.length) return `${txt}No hay renovaciones para esta fecha.\n`;

  let total = 0;
  items.forEach((x) => { total += Number(x.precio || 0); });

  txt += `Total perfiles: ${items.length}\n`;
  txt += `Total esperado: ${total.toFixed(2)} Lps\n\n`;

  items.forEach((x, i) => {
    txt += `${i + 1}) ${x.nombrePerfil || "Sin nombre"}\n`;
    txt += `Telefono: ${x.telefono || "-"}\n`;
    txt += `Plataforma: ${humanPlataforma(x.plataforma || "")}\n`;
    txt += `${getIdentLabelLocal(x.plataforma || "")}: ${x.correo || "-"}\n`;
    txt += `Clave/PIN: ${x.pin || "-"}\n`;
    txt += `Precio: ${Number(x.precio || 0).toFixed(2)} Lps\n`;
    txt += `Vendedor: ${x.vendedor || "-"}\n\n`;
  });

  return txt;
}

async function enviarTXT(chatId, rows = [], fecha = "", vendedor = null) {
  const contenido = renovacionesTextoPlano(rows, fecha, vendedor);
  const nombre = vendedor
    ? `renovaciones_${fileSafeName(vendedor, "vendedor")}_${String(fecha || "").replace(/\//g, "-")}.txt`
    : `renovaciones_${String(fecha || "").replace(/\//g, "-")}.txt`;
  return enviarTxtComoArchivo(chatId, contenido, nombre);
}

async function enviarTXTATodosHoy(chatId) {
  const fecha = hoyDMY();
  const snap = await db.collection(REVENDEDORES_COLLECTION).get();
  let enviados = 0;

  for (const d of snap.docs) {
    const rev = d.data() || {};
    if (!rev.activo || !rev.telegramId || !rev.nombre) continue;
    const rows = await obtenerRenovacionesPorFecha(fecha, rev.nombre);
    await enviarTXT(rev.telegramId, rows, fecha, rev.nombre);
    enviados++;
  }

  return bot.sendMessage(chatId, `✅ Listo: enviados los TXT por vendedor.\n\nFecha: ${fecha}\nTotal enviados: ${enviados}`);
}

// ===============================
// TXT / REPORTES CRM
// ===============================
async function reporteClientesTXTGeneral(chatId) {
  const snap = await db.collection(CLIENTES_COLLECTION).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  rows.sort((a, b) => normTxt(a.nombrePerfil || "").localeCompare(normTxt(b.nombrePerfil || ""), "es"));

  let txt = "CLIENTES - REPORTE GENERAL\n\n";
  rows.forEach((c, i) => {
    txt += `========================================\n`;
    txt += `${i + 1}) ${clienteResumenTXT(c)}\n`;
  });

  return enviarTxtComoArchivo(chatId, txt, `clientes_general_${Date.now()}.txt`);
}

async function reporteClientesSplitPorVendedorTXT(chatId) {
  const snap = await db.collection(CLIENTES_COLLECTION).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  const groups = {};
  for (const c of rows) {
    const key = String(c.vendedor || "Sin vendedor").trim() || "Sin vendedor";
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  const vendedores = Object.keys(groups).sort((a, b) => normTxt(a).localeCompare(normTxt(b), "es"));
  let enviados = 0;

  for (const vend of vendedores) {
    const clientes = groups[vend].sort((a, b) => normTxt(a.nombrePerfil || "").localeCompare(normTxt(b.nombrePerfil || ""), "es"));
    let txt = `CLIENTES DEL VENDEDOR: ${vend}\n\n`;
    clientes.forEach((c, i) => {
      txt += `========================================\n`;
      txt += `${i + 1}) ${clienteResumenTXT(c)}\n`;
    });
    await enviarTxtComoArchivo(chatId, txt, `${fileSafeName(vend, "vendedor")}_${Date.now()}.txt`);
    enviados++;
  }

  return bot.sendMessage(chatId, `✅ TXT por vendedor generados: ${enviados}`);
}

async function enviarHistorialClienteTXT(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const contenido = clienteResumenTXT(c);
  const nombre = `historial_${fileSafeName(c.nombrePerfil || clientId, "cliente")}.txt`;
  return enviarTxtComoArchivo(chatId, contenido, nombre);
}

async function enviarMisClientes(chatId, vendedorNombre = "") {
  const snap = await db.collection(CLIENTES_COLLECTION).get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((c) => normTxt(c.vendedor || "") === normTxt(vendedorNombre || ""));

  if (!rows.length) return bot.sendMessage(chatId, "⚠️ No tiene clientes asignados.");
  return enviarListaResultadosClientes(chatId, rows);
}

async function enviarMisClientesTXT(chatId, vendedorNombre = "") {
  const snap = await db.collection(CLIENTES_COLLECTION).get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((c) => normTxt(c.vendedor || "") === normTxt(vendedorNombre || ""));

  let txt = `CLIENTES DEL VENDEDOR: ${vendedorNombre}\n\n`;
  if (!rows.length) txt += "Sin clientes asignados.\n";
  rows.forEach((c, i) => {
    txt += `========================================\n`;
    txt += `${i + 1}) ${clienteResumenTXT(c)}\n`;
  });

  return enviarTxtComoArchivo(chatId, txt, `mis_clientes_${fileSafeName(vendedorNombre, "vendedor")}.txt`);
}

module.exports = {
  // helpers / compatibilidad
  humanPlataforma,
  serviciosConIndiceOriginal,
  dedupeClientes,
  clienteDuplicado,

  // lecturas
  getCliente,
  buscarPorTelefonoTodos,
  buscarClienteRobusto,

  // fichas / menús
  enviarFichaCliente,
  enviarListaResultadosClientes,
  menuEditarCliente,
  menuListaServicios,
  menuServicio,

  // escrituras
  patchServicio,
  addServicioTx,

  // wizard
  kbPlataformasWiz,
  wizardStart,
  wizardNext,

  // txt / crm
  clienteResumenTXT,
  reporteClientesTXTGeneral,
  reporteClientesSplitPorVendedorTXT,
  enviarHistorialClienteTXT,
  enviarMisClientes,
  enviarMisClientesTXT,

  // renovaciones
  obtenerRenovacionesPorFecha,
  renovacionesTexto,
  enviarTXT,
  enviarTXTATodosHoy,
};
