/* ✅ SUBLICUENTAS TG BOT — PARTE 3/6 OPTIMIZADA v5
   CLIENTES / CRM / WIZARD / TXT / RENOVACIONES / HISTORIAL REAL
   -----------------------------------------------
   ✅ NUEVO v5 — FIX BÚSQUEDA TELEFÓNICA:
   - buscarPorTelefonoTodos: ahora busca EXACTO primero, luego parcial
   - Elimina bug donde escribía 87945442 pero devolvía 87989267
   - Búsqueda exacta post-procesada (no depende de telefono_norm en Firestore)
   
   ✅ PREVIO v4 — HISTORIAL REAL:
   - registrarEventoHistorial: guarda cada cambio en colección historial_clientes
   - getHistorialCliente: lee todos los eventos de un cliente
   - generarHistorialTXT: genera TXT con servicios actuales + línea de tiempo de eventos
   - enviarHistorialClienteTXTReal: envía el TXT real al chat
   - Registro automático en: addServicioTx, patchServicio, eliminarServicioTx,
     renovaciones (+30, +31, manual), cambio de servicio, no renovó
*/

const fs = require("fs");
const path = require("path");

const core = require("./index_01_core");
const utils = require("./index_02_utils_roles");

const { bot, admin, db, PLATAFORMAS } = core;

const cacheGet           = typeof core.cacheGet            === "function" ? core.cacheGet            : () => null;
const cacheSet           = typeof core.cacheSet            === "function" ? core.cacheSet            : () => {};
const cacheInvalidatePrefix = typeof core.cacheInvalidatePrefix === "function" ? core.cacheInvalidatePrefix : () => {};

const escMD = typeof utils.escMD === "function"
  ? utils.escMD
  : (v = "") => String(v || "").replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");

const upsertPanel = typeof utils.upsertPanel === "function"
  ? utils.upsertPanel
  : async (chatId, text, keyboard = [], parseMode = "Markdown") =>
      bot.sendMessage(chatId, text, { parse_mode: parseMode, reply_markup: { inline_keyboard: keyboard } });

const wizard  = utils.wizard  instanceof Map ? utils.wizard  : new Map();
const pending = utils.pending instanceof Map ? utils.pending : new Map();

const onlyDigits          = typeof utils.onlyDigits          === "function" ? utils.onlyDigits          : (v = "") => String(v || "").replace(/\D+/g, "");
const logErr              = typeof utils.logErr              === "function" ? utils.logErr              : (...a) => console.error(...a);
const isFechaDMY          = typeof utils.isFechaDMY          === "function" ? utils.isFechaDMY          : (v = "") => /^\d{2}\/\d{2}\/\d{4}$/.test(String(v || "").trim());
const parseMontoNumber    = typeof utils.parseMontoNumber    === "function" ? utils.parseMontoNumber    : (v = "") => { const n = Number(String(v||"").replace(/,/g,"").trim()); return Number.isFinite(n) ? n : NaN; };
const hoyDMY              = typeof utils.hoyDMY              === "function" ? utils.hoyDMY              : () => { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
const normalizarPlataforma= typeof utils.normalizarPlataforma=== "function" ? utils.normalizarPlataforma: (v = "") => String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"").trim();
const esPlataformaValida  = typeof utils.esPlataformaValida  === "function" ? utils.esPlataformaValida  : (v = "") => PLATFORM_KEYS.includes(normalizarPlataforma(v));
const isEmailLike         = typeof utils.isEmailLike         === "function" ? utils.isEmailLike         : (v = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim());

const PLATFORM_KEYS = Array.isArray(PLATAFORMAS) ? PLATAFORMAS.map((x) => String(x||"").trim().toLowerCase()) : Object.keys(PLATAFORMAS || {}).map((x) => String(x||"").trim().toLowerCase());

const CLIENTES_COLLECTION    = "clientes";
const INVENTARIO_COLLECTION  = "inventario";
const REVENDEDORES_COLLECTION= "revendedores";
const HISTORIAL_COLLECTION   = "historial_clientes";

// ===============================
// HELPERS GENERALES
// ===============================
function normTxt(v = "") {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function humanPlataforma(key = "") {
  const k = normalizarPlataforma(key);
  const map = {
    netflix:"Netflix Premium", vipnetflix:"Netflix VIP", disneyp:"Disney Premium", disneys:"Disney Standard",
    hbomax:"HBO Max", primevideo:"Prime Video", paramount:"Paramount+", crunchyroll:"Crunchyroll",
    vix:"Vix", appletv:"Apple TV", universal:"Universal+", spotify:"Spotify", youtube:"YouTube",
    deezer:"Deezer", canva:"Canva", gemini:"Gemini", chatgpt:"ChatGPT", duolingo:"Duolingo",
    oleadatv1:"Oleada TV (1)", oleadatv3:"Oleada TV (3)", iptv1:"IPTV (1)", iptv3:"IPTV (3)", iptv4:"IPTV (4)",
  };
  return map[k] || String(key || "");
}

function iconPlataforma(key = "") {
  const k = normalizarPlataforma(key);
  const map = { netflix:"📺", vipnetflix:"🔥", disneyp:"🏰", disneys:"🎬", hbomax:"🎞️", primevideo:"🎥", paramount:"💿", crunchyroll:"🍥", vix:"📱", appletv:"🍎", universal:"🌍", spotify:"🎵", youtube:"▶️", deezer:"🎧", canva:"🎨", gemini:"✨", chatgpt:"🤖", duolingo:"🦉", oleadatv1:"🌊", oleadatv3:"🌊", iptv1:"📡", iptv3:"📡", iptv4:"📡" };
  return map[k] || "📦";
}

function getIdentLabelLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  return ["oleadatv1","oleadatv3","iptv1","iptv3","iptv4"].includes(p) ? "Usuario" : "Correo";
}

function platformConfigLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (!p) return {};
  if (!Array.isArray(PLATAFORMAS) && PLATAFORMAS && PLATAFORMAS[p]) return PLATAFORMAS[p] || {};
  return {};
}

function requiereClaveLocal(plataforma = "") {
  const cfg = platformConfigLocal(plataforma);
  if (Object.prototype.hasOwnProperty.call(cfg, "requiereClave")) return cfg.requiereClave === true;
  const p = normalizarPlataforma(plataforma);
  return !["canva", "gemini", "chatgpt", "duolingo"].includes(p);
}

function requierePinLocal(plataforma = "") {
  const cfg = platformConfigLocal(plataforma);
  if (Object.prototype.hasOwnProperty.call(cfg, "requierePin")) return cfg.requierePin === true;
  return ["netflix","vipnetflix","disneyp","disneys","hbomax","primevideo","crunchyroll","universal"].includes(normalizarPlataforma(plataforma));
}

function esSoloCorreoLocal(plataforma = "") {
  return !requiereClaveLocal(plataforma) && !requierePinLocal(plataforma);
}

function getAccessTypeLabelLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (esSoloCorreoLocal(p)) return "Solo correo";
  if (["oleadatv1","oleadatv3","iptv1","iptv3","iptv4"].includes(p)) return "Usuario + clave";
  if (requiereClaveLocal(p) && requierePinLocal(p)) return "Correo + clave + PIN";
  if (requiereClaveLocal(p)) return "Correo + clave";
  if (requierePinLocal(p)) return "Correo + PIN";
  return "Correo";
}

function getClaveServicioLocal(servicio = {}, plataforma = "") {
  const p = normalizarPlataforma(plataforma || servicio.plataforma || "");
  const directa = String(servicio.clave || servicio.password || servicio.pass || "").trim();
  if (directa) return directa;
  if (requiereClaveLocal(p) && !requierePinLocal(p)) return String(servicio.pin || "").trim();
  return "";
}

function getPinServicioLocal(servicio = {}, plataforma = "") {
  const p = normalizarPlataforma(plataforma || servicio.plataforma || "");
  if (!requierePinLocal(p)) return "";
  return String(servicio.pin || "").trim();
}

function renderCredencialesServicioLocal(servicio = {}, markdown = true, indent = "") {
  const p = normalizarPlataforma(servicio.plataforma || "");
  const esc = markdown ? escMD : (v = "") => String(v ?? "");
  const identLabel = getIdentLabelLocal(p);
  const identIcon = identLabel === "Usuario" ? "👤" : "📧";
  let out = "";
  out += `${indent}${identIcon} ${markdown ? `*${esc(identLabel)}:*` : `${identLabel}:`} ${esc(servicio.correo || "-")}\n`;
  if (requiereClaveLocal(p)) out += `${indent}🔑 ${markdown ? "*Clave:*" : "Clave:"} ${esc(getClaveServicioLocal(servicio, p) || "-")}\n`;
  if (requierePinLocal(p)) out += `${indent}🔐 ${markdown ? "*PIN:*" : "PIN:"} ${esc(getPinServicioLocal(servicio, p) || "-")}\n`;
  return out;
}

function validateIdentByPlatformLocal(plataforma = "", ident = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(ident || "").trim();
  if (!v) return false;
  if (["oleadatv1","oleadatv3","iptv1","iptv3","iptv4"].includes(p)) return v.length >= 3 && !/\s/.test(v);
  return isEmailLike(v);
}

function normalizeIdentByPlatformLocal(plataforma = "", ident = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(ident || "").trim();
  return ["oleadatv1","oleadatv3","iptv1","iptv3","iptv4"].includes(p) ? v : v.toLowerCase();
}

function docIdInventarioLocal(ident = "", plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const i = normalizeIdentByPlatformLocal(p, ident).toLowerCase().replace(/[.#$/\[\]\s]+/g, "_");
  return `${p}__${i}`;
}

function getTotalPorPlataformaLocal(plat = "") {
  const p = normalizarPlataforma(plat);
  const map = { netflix:5, vipnetflix:1, disneyp:6, disneys:3, hbomax:5, primevideo:5, paramount:5, crunchyroll:5, vix:4, appletv:4, universal:4, spotify:1, youtube:1, deezer:1, oleadatv1:1, oleadatv3:3, iptv1:1, iptv3:3, iptv4:4, canva:1, gemini:1, chatgpt:1, duolingo:1 };
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
  return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}`;
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
  let total = 0, proxima = "", proximaTS = Infinity;
  let worst = { emoji: "⚪", texto: "Sin fecha", orden: 99 };

  for (const s of rows) {
    total += Number(s.precio || 0);
    const fecha = String(s.fechaRenovacion || "").trim();
    const ts = parseDMYtoTS(fecha);
    if (ts && ts < proximaTS) { proximaTS = ts; proxima = fecha; }
    const est = getEstadoServicio(fecha);
    if (est.orden < worst.orden) worst = est;
  }

  return {
    total, proxima: proxima || "Sin fecha",
    estadoEmoji: worst.emoji, estadoTexto: rows.length ? worst.texto : "Sin servicios",
    activos: rows.length,
  };
}

function fileSafeName(v = "", fallback = "archivo") {
  let s = String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  if (!s) s = fallback;
  if (!/\.txt$/i.test(s)) s += ".txt";
  return s;
}

const enviarTxtComoArchivo = typeof utils.enviarTxtComoArchivo === "function"
  ? utils.enviarTxtComoArchivo
  : async (chatId, contenido = "", fileName = "reporte.txt") => {
      const safeName = fileSafeName(fileName, "reporte.txt");
      const tempPath = path.join("/tmp", safeName);
      fs.writeFileSync(tempPath, String(contenido || ""), "utf8");
      try { return await bot.sendDocument(chatId, tempPath, {}, { filename: safeName, contentType: "text/plain" }); }
      finally { try { fs.unlinkSync(tempPath); } catch (_) {} }
    };

function serviciosConIndiceOriginal(servicios = []) {
  return (Array.isArray(servicios) ? servicios : []).map((s, idxOriginal) => ({ ...(s || {}), idxOriginal }));
}

function dedupeClientes(rows = []) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = String(r?.id || "").trim();
    if (id && !map.has(id)) map.set(id, r);
  }
  return Array.from(map.values());
}

function kbPlataformasWiz(prefix = "wiz:plat", clientId = null, idx = null) {
  const rows = [];
  const items = PLATFORM_KEYS.map((k) => {
    let cb = `${prefix}:${k}`;
    if (clientId !== null && clientId !== undefined) cb += `:${clientId}`;
    if (idx !== null && idx !== undefined) cb += `:${idx}`;
    return { text: `${iconPlataforma(k)} ${humanPlataforma(k)}`, callback_data: cb };
  });
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
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

  const snap = await db.collection(INVENTARIO_COLLECTION).where("plataforma", "==", plat).where("correo", "==", ident).limit(1).get();
  if (!snap.empty) { const d = snap.docs[0]; return { ref: d.ref, data: d.data() || {} }; }
  return null;
}

async function syncServicioEnInventario({ clienteNombre = "", plataforma = "", correo = "", clave = "", pin = "" }) {
  const plat = normalizarPlataforma(plataforma);
  const acceso = normalizeIdentByPlatformLocal(plat, correo);
  const found = await getInventarioDoc(plat, acceso);
  if (!found) return { ok: false, reason: "not_found" };

  const { ref, data } = found;
  let clientes = Array.isArray(data.clientes) ? data.clientes.slice() : [];

  const pinNorm = String(pin || "").trim();
  const yaExiste = clientes.some((x) => normTxt(x?.nombre || "") === normTxt(clienteNombre) && String(x?.pin || "") === pinNorm);
  if (yaExiste) {
    const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    const claveNorm = String(clave || "").trim();
    if (claveNorm && requiereClaveLocal(plat) && (!data.clave || String(data.clave || "").toLowerCase() === "sin clave")) patch.clave = claveNorm;
    if (Object.keys(patch).length > 1) await ref.set(patch, { merge: true });
    return { ok: true, synced: true, added: false };
  }

  const capacidad = Number(data.capacidad || data.total || getTotalPorPlataformaLocal(plat) || 1);
  if (clientes.length >= capacidad) return { ok: false, reason: "full" };

  clientes.push({ nombre: String(clienteNombre || "").trim(), pin: pinNorm, slot: clientes.length + 1 });
  clientes = clientes.map((x, i) => ({ ...x, slot: i + 1 }));
  const ocupados = clientes.length;
  const disponibles = Math.max(0, capacidad - ocupados);

  const patch = { clientes, ocupados, disponibles, disp: disponibles, capacidad, estado: disponibles === 0 ? "llena" : "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  const claveNorm = String(clave || "").trim();
  if (claveNorm && requiereClaveLocal(plat) && (!data.clave || String(data.clave || "").toLowerCase() === "sin clave")) patch.clave = claveNorm;

  await ref.set(patch, { merge: true });
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

  await ref.set({ clientes, ocupados, disponibles, disp: disponibles, capacidad, estado: disponibles === 0 ? "llena" : "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, removed: true };
}

// ===============================
// ✅ HISTORIAL REAL DE CLIENTE
// ===============================

/**
 * Registra un evento en la colección historial_clientes.
 * Se llama automáticamente desde addServicioTx, patchServicio,
 * eliminarServicioTx y acciones de renovación.
 */
async function registrarEventoHistorial(clientId, evento = {}) {
  try {
    const ref = db.collection(HISTORIAL_COLLECTION).doc();
    await ref.set({
      clientId: String(clientId || ""),
      fecha: hoyDMY(),
      fechaTS: admin.firestore.FieldValue.serverTimestamp(),
      ...evento,
    });
  } catch (e) {
    logErr("registrarEventoHistorial", e);
  }
}

/**
 * Lee todos los eventos históricos de un cliente, ordenados por fecha.
 */
async function getHistorialCliente(clientId) {
  try {
    const snap = await db.collection(HISTORIAL_COLLECTION)
      .where("clientId", "==", String(clientId || ""))
      .get();

    const eventos = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => {
        const ta = a.fechaTS?.toMillis?.() || parseDMYtoTS(a.fecha || "") || 0;
        const tb = b.fechaTS?.toMillis?.() || parseDMYtoTS(b.fecha || "") || 0;
        return ta - tb;
      });

    return eventos;
  } catch (e) {
    logErr("getHistorialCliente", e);
    return [];
  }
}

/**
 * Genera el TXT completo de historial:
 * - Datos del cliente
 * - Servicios actuales
 * - Línea de tiempo de eventos (correos que ha tenido, cambios, pagos, renovaciones)
 */
async function generarHistorialTXT(clientId) {
  const c = await getCliente(clientId);
  if (!c) return null;

  const eventos = await getHistorialCliente(clientId);
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const resumen = resumenGeneralCliente(servicios);

  let txt = "============================\n";
  txt += "HISTORIAL DEL CLIENTE\n";
  txt += "============================\n\n";

  txt += `Nombre: ${c.nombrePerfil || "Sin nombre"}\n`;
  txt += `Telefono: ${c.telefono || "-"}\n`;
  txt += `Vendedor: ${c.vendedor || "-"}\n`;
  txt += `Estado actual: ${resumen.estadoTexto}\n`;
  txt += `Total mensual actual: ${Number(resumen.total || 0).toFixed(2)} Lps\n`;
  txt += `Proxima renovacion: ${resumen.proxima}\n`;
  txt += `Servicios activos: ${servicios.length}\n\n`;

  txt += "============================\n";
  txt += "SERVICIOS ACTUALES\n";
  txt += "============================\n";

  if (!servicios.length) {
    txt += "(sin servicios)\n";
  } else {
    servicios.forEach((s, i) => {
      const est = getEstadoServicio(s.fechaRenovacion || "");
      txt += `\n${i + 1}) ${humanPlataforma(s.plataforma || "")}\n`;
      txt += renderCredencialesServicioLocal(s, false, "");
      txt += `Precio: ${Number(s.precio || 0).toFixed(2)} Lps\n`;
      txt += `Renovacion: ${s.fechaRenovacion || "-"}\n`;
      txt += `Estado: ${est.texto}\n`;
    });
  }

  txt += "\n============================\n";
  txt += "HISTORIAL DE EVENTOS\n";
  txt += "============================\n\n";

  if (!eventos.length) {
    txt += "(Sin historial de eventos registrados aun)\n";
  } else {
    eventos.forEach((ev, i) => {
      txt += `${i + 1}) [${ev.fecha || "-"}] ${ev.tipo || "evento"}\n`;
      if (ev.descripcion)         txt += `   Detalle: ${ev.descripcion}\n`;
      if (ev.plataforma)          txt += `   Plataforma: ${humanPlataforma(ev.plataforma)}\n`;
      if (ev.correo)              txt += `   Correo/Usuario: ${ev.correo}\n`;
      if (ev.correoAnterior)      txt += `   Correo anterior: ${ev.correoAnterior}\n`;
      if (ev.clave)               txt += `   Clave: ${ev.clave}\n`;
      if (ev.pin)                 txt += `   PIN: ${ev.pin}\n`;
      if (ev.precio !== undefined && ev.precio !== null)
                                  txt += `   Precio: ${Number(ev.precio || 0).toFixed(2)} Lps\n`;
      if (ev.precioAnterior !== undefined && ev.precioAnterior !== null)
                                  txt += `   Precio anterior: ${Number(ev.precioAnterior || 0).toFixed(2)} Lps\n`;
      if (ev.fechaRenovacion)     txt += `   Fecha renovacion: ${ev.fechaRenovacion}\n`;
      if (ev.fechaAnterior)       txt += `   Fecha anterior: ${ev.fechaAnterior}\n`;
      txt += "\n";
    });
  }

  return txt;
}

/**
 * Envía el historial real al chat como archivo TXT.
 */
async function enviarHistorialClienteTXTReal(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const contenido = await generarHistorialTXT(clientId);
  if (!contenido) return bot.sendMessage(chatId, "⚠️ No se pudo generar el historial.");

  return enviarTxtComoArchivo(
    chatId,
    contenido,
    `historial_${fileSafeName(c.nombrePerfil || clientId, "cliente").replace(/\.txt$/i, "")}.txt`
  );
}

// ===============================
// ✅ LECTURAS OPTIMIZADAS
// ===============================

async function getCliente(clientId) {
  const id = String(clientId || "").trim();
  if (!id) return null;

  const cacheKey = `clientes:doc:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached === "__null__" ? null : cached;

  const doc = await db.collection(CLIENTES_COLLECTION).doc(id).get();
  if (!doc.exists) { cacheSet(cacheKey, "__null__"); return null; }

  const result = { id: doc.id, ...(doc.data() || {}) };
  cacheSet(cacheKey, result);
  return result;
}

async function clienteDuplicado(nombre = "", telefono = "", excludeId = null) {
  const nombreNorm = normTxt(nombre);
  const telefonoNorm = onlyDigits(telefono);
  if (!nombreNorm || !telefonoNorm) return false;

  try {
    const snap = await db.collection(CLIENTES_COLLECTION)
      .where("nombre_norm", "==", nombreNorm)
      .where("telefono_norm", "==", telefonoNorm)
      .limit(2)
      .get();

    for (const d of snap.docs) {
      if (excludeId && String(d.id) === String(excludeId)) continue;
      return true;
    }
    return false;
  } catch (_) {
    const snap = await db.collection(CLIENTES_COLLECTION).get();
    for (const d of snap.docs) {
      if (excludeId && String(d.id) === String(excludeId)) continue;
      const x = d.data() || {};
      if (normTxt(x.nombrePerfil || "") === nombreNorm && onlyDigits(x.telefono || "") === telefonoNorm) return true;
    }
    return false;
  }
}

async function buscarPorTelefonoTodos(query = "") {
  const q = onlyDigits(query);
  if (!q) return [];

  const out = new Map();

  // ✅ PASO 1: Búsqueda exacta post-procesada (SIN depender de telefono_norm en Firestore)
  // Esto garantiza que encuentra EXACTAMENTE lo que escribiste
  try {
    const snap = await db.collection(CLIENTES_COLLECTION).get();
    snap.forEach((d) => {
      const tel = onlyDigits((d.data()?.telefono || "")).trim();
      // ✅ EXACTO: el teléfono normalizado DEBE SER IGUAL al query
      if (tel === q && !out.has(d.id)) {
        out.set(d.id, { id: d.id, ...(d.data() || {}) });
      }
    });
  } catch (_) {}

  // ✅ Si encontró exacto, retornar inmediatamente
  if (out.size > 0) {
    return Array.from(out.values()).slice(0, 20);
  }

  // ❌ SOLO si no encuentra exacto, fallback a búsqueda parcial
  // Pero limitar a que el query esté CONTENIDO en el teléfono
  // (no al revés, que causaba el bug)
  try {
    const snap = await db.collection(CLIENTES_COLLECTION).get();
    snap.forEach((d) => {
      const x = d.data() || {};
      const tel = onlyDigits(x.telefono || "").trim();
      // ❌ PARCIAL: Solo si el query está DENTRO del teléfono
      // Ej: si escribes "945", encuentra "87945442" pero no "87989267"
      if (tel.includes(q) && !out.has(d.id)) {
        out.set(d.id, { id: d.id, ...x });
      }
    });
  } catch (_) {}

  return Array.from(out.values()).slice(0, 20);
}

async function buscarClienteRobusto(query = "") {
  const q = String(query || "").trim();
  const qNorm = normTxt(q);
  const qDigits = onlyDigits(q);
  if (!qNorm && !qDigits) return [];

  const out = new Map();

  const jobs = [];

  if (qDigits && qDigits.length >= 7) {
    jobs.push(
      db.collection(CLIENTES_COLLECTION).where("telefono_norm", "==", qDigits).limit(10).get(),
    );
  }

  if (qNorm && qNorm.length >= 2) {
    jobs.push(
      db.collection(CLIENTES_COLLECTION).where("nombre_norm", "==", qNorm).limit(10).get(),
      db.collection(CLIENTES_COLLECTION).where("vendedor_norm", "==", qNorm).limit(10).get(),
    );
  }

  const settled = await Promise.allSettled(jobs);
  for (const item of settled) {
    if (item.status === "fulfilled") {
      item.value.forEach((d) => { if (!out.has(d.id)) out.set(d.id, { id: d.id, ...(d.data() || {}) }); });
    }
  }

  if (out.size > 0) return Array.from(out.values()).slice(0, 30);

  const snap = await db.collection(CLIENTES_COLLECTION).get();

  snap.forEach((d) => {
    const x = d.data() || {};
    const nombre = normTxt(x.nombrePerfil || "");
    const vendedor = normTxt(x.vendedor || "");
    const telefono = onlyDigits(x.telefono || "");
    const servicios = Array.isArray(x.servicios) ? x.servicios : [];

    const bolsas = [
      nombre, normTxt(x.nombre_norm || ""), telefono,
      vendedor, normTxt(x.vendedor_norm || ""),
      ...servicios.flatMap((s) => [
        normTxt(s?.correo || ""), normTxt(s?.plataforma || ""),
        normTxt(humanPlataforma(s?.plataforma || "")), String(s?.clave || "").trim().toLowerCase(), String(s?.pin || "").trim().toLowerCase(),
      ]),
    ];

    let ok = false;
    if (qDigits && qDigits.length >= 4 && bolsas.some((b) => String(b).includes(qDigits))) ok = true;
    if (!ok && qNorm && bolsas.some((b) => String(b).includes(qNorm))) ok = true;

    if (ok && !out.has(d.id)) out.set(d.id, { id: d.id, ...x });
  });

  return Array.from(out.values()).slice(0, 30);
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
  txt += `Nombre: ${nombre}\nTelefono: ${telefono}\nVendedor: ${vendedor}\n`;
  txt += `Estado general: ${resumen.estadoTexto}\nTotal mensual: ${Number(resumen.total || 0).toFixed(2)} Lps\n`;
  txt += `Proxima renovacion: ${resumen.proxima}\nServicios activos: ${servicios.length}\n\nSERVICIOS\n`;

  if (!servicios.length) {
    txt += "(sin servicios)\n";
  } else {
    servicios.forEach((s, i) => {
      const est = getEstadoServicio(s.fechaRenovacion || "");
      txt += `\n${i + 1}) ${humanPlataforma(s.plataforma || "")}\n`;
      txt += renderCredencialesServicioLocal(s, false, "");
      txt += `Precio: ${Number(s.precio || 0).toFixed(2)} Lps\n`;
      txt += `Renovacion: ${s.fechaRenovacion || "-"}\nEstado: ${est.texto}\n`;
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
  txt += `🙍 *Nombre:* ${escMD(nombre)}\n📱 *Teléfono:* ${escMD(telefono)}\n🧾 *Vendedor:* ${escMD(vendedor)}\n`;
  txt += `📊 *Estado general:* ${resumen.estadoEmoji} ${escMD(resumen.estadoTexto)}\n`;
  txt += `💰 *Total mensual:* ${escMD(`${Number(resumen.total || 0).toFixed(2)} Lps`)}\n`;
  txt += `📅 *Próxima renovación:* ${escMD(resumen.proxima)}\n`;
  txt += `🧩 *Servicios activos:* ${escMD(String(servicios.length))}\n\n*SERVICIOS*\n`;

  if (!servicios.length) {
    txt += `\n_Sin servicios registrados._`;
  } else {
    servicios.forEach((s, i) => {
      const est = getEstadoServicio(s.fechaRenovacion || "");
      txt += `\n\n${i + 1}) ${iconPlataforma(s.plataforma || "")} *${escMD(humanPlataforma(s.plataforma || ""))}*\n`;
      txt += renderCredencialesServicioLocal(s, true, "");
      txt += `💵 *Precio:* ${escMD(`${Number(s.precio || 0).toFixed(2)} Lps`)}\n`;
      txt += `📅 *Renovación:* ${escMD(s.fechaRenovacion || "-")} — ${est.emoji} ${escMD(est.texto)}`;
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

  return upsertPanel(chatId, renderFichaClienteMarkdown(c), [
    [{ text: "✏️ Editar cliente", callback_data: `cli:edit:menu:${c.id}` }],
    [{ text: "🧩 Editar servicios", callback_data: `cli:serv:list:${c.id}` }],
    [{ text: "🔄 Gestionar renovaciones", callback_data: `cli:ren:list:${c.id}` }],
    [{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${c.id}` }],
    [{ text: "📜 Historial TXT", callback_data: `cli:txt:hist:${c.id}` }, { text: "📄 TXT Cliente", callback_data: `cli:txt:one:${c.id}` }],
    [{ text: "🗑️ Borrar cliente", callback_data: `cli:del:ask:${c.id}` }],
    [{ text: "🏠 Inicio",         callback_data: "go:inicio" }],
  ]);
}

// ✅ Ficha completa para revendedores — cuentas, claves, fecha, monto
async function enviarFichaClienteVendedor(chatId, clientId, backCb = "vend:clientes") {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  let total = 0;
  servicios.forEach(s => { total += Number(s.precio || 0); });

  let txt = `👤 *${escMD(c.nombrePerfil || "Sin nombre")}*\n`;
  txt += `📱 ${escMD(c.telefono || "-")}\n`;
  if (total > 0) txt += `💰 *Total mensual: ${escMD(total.toFixed(2))} Lps*\n`;
  txt += `\n`;

  if (!servicios.length) {
    txt += "_Sin servicios._";
  } else {
    servicios.forEach((s, i) => {
      const est = getEstadoServicio(s.fechaRenovacion || "");
      txt += `*${i + 1}.* *${escMD(humanPlataforma(s.plataforma || ""))}*\n`;
      txt += renderCredencialesServicioLocal(s, true, "   ");
      txt += `   📅 ${escMD(s.fechaRenovacion || "-")} ${est.emoji}\n`;
      txt += `   💵 ${escMD(Number(s.precio || 0).toFixed(2))} Lps\n\n`;
    });
  }

  return upsertPanel(chatId, txt, [
    [{ text: "⬅️ Volver", callback_data: backCb }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function enviarListaResultadosClientes(chatId, rows = []) {
  const items = dedupeClientes(rows);
  if (!items.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");

  const keyboard = items.slice(0, 30).map((c) => [{
    text: safeBtnLabel(`${c.nombrePerfil || "Sin nombre"} • ${c.telefono || "sin teléfono"}`),
    callback_data: `cli:view:${c.id}`,
  }]);
  keyboard.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, "🔎 *RESULTADOS DE BÚSQUEDA*\n\nSeleccione un cliente:", keyboard);
}

async function menuEditarCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  return upsertPanel(chatId,
    `✏️ *EDITAR CLIENTE*\n\n👤 *Nombre:* ${escMD(c.nombrePerfil || "-")}\n📱 *Teléfono:* ${escMD(c.telefono || "-")}\n🧾 *Vendedor:* ${escMD(c.vendedor || "-")}\n\nSeleccione qué desea editar:`,
    [
      [{ text: "👤 Cambiar nombre", callback_data: `cli:edit:nombre:${clientId}` }],
      [{ text: "📱 Cambiar teléfono", callback_data: `cli:edit:tel:${clientId}` }],
      [{ text: "🧾 Cambiar vendedor", callback_data: `cli:edit:vend:${clientId}` }],
      [{ text: "⬅️ Volver Ficha",   callback_data: `cli:view:${clientId}` }],
      [{ text: "🏠 Inicio",          callback_data: "go:inicio" }],
    ]
  );
}

async function menuListaServicios(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = serviciosConIndiceOriginal(Array.isArray(c.servicios) ? c.servicios : []);
  if (!servicios.length) {
    return upsertPanel(chatId, "🧩 *SERVICIOS*\n\nEste cliente no tiene servicios.", [
      [{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }],
      [{ text: "⬅️ Volver Ficha",   callback_data: `cli:view:${clientId}` }],
      [{ text: "🏠 Inicio",          callback_data: "go:inicio" }],
    ]);
  }

  const kb = servicios.map((s, i) => [{ text: safeBtnLabel(`${i + 1}) ${humanPlataforma(s.plataforma || "")} • ${s.correo || "-"}`), callback_data: `cli:serv:menu:${clientId}:${s.idxOriginal}` }]);
  kb.push([{ text: "🔄 Sincronizar claves vigentes", callback_data: "sync:claves:ask" }]);
  kb.push([{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }]);
  kb.push([{ text: "⬅️ Volver Ficha",   callback_data: `cli:view:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio",          callback_data: "go:inicio" }]);

  return upsertPanel(chatId, `🧩 *SERVICIOS DE ${escMD(c.nombrePerfil || "CLIENTE")}*\n\nSeleccione uno:`, kb);
}

async function menuServicio(chatId, clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

  const s = servicios[idx] || {};
  const est = getEstadoServicio(s.fechaRenovacion || "");
  let txt =
    `🧩 *SERVICIO #${idx + 1}*\n\n` +
    `${iconPlataforma(s.plataforma || "")} *Plataforma:* ${escMD(humanPlataforma(s.plataforma || ""))}\n`;

  txt += renderCredencialesServicioLocal(s, true, "");
  txt += `💰 *Precio:* ${escMD(`${Number(s.precio || 0).toFixed(2)} Lps`)}\n`;
  txt += `📅 *Renovación:* ${escMD(s.fechaRenovacion || "-")}\n📊 *Estado:* ${est.emoji} ${escMD(est.texto)}`;

  const kb = [
    [{ text: "📌 Cambiar plataforma", callback_data: `cli:serv:edit:plat:${clientId}:${idx}` }],
    [{ text: `${getIdentLabelLocal(s.plataforma || "") === "Usuario" ? "👤" : "📧"} Cambiar ${getIdentLabelLocal(s.plataforma || "").toLowerCase()}`, callback_data: `cli:serv:edit:mail:${clientId}:${idx}` }],
  ];

  const credBtns = [];
  if (requiereClaveLocal(s.plataforma || "")) credBtns.push({ text: "🔑 Cambiar clave", callback_data: `cli:serv:edit:clave:${clientId}:${idx}` });
  if (requierePinLocal(s.plataforma || "")) credBtns.push({ text: "🔐 Cambiar PIN", callback_data: `cli:serv:edit:pin:${clientId}:${idx}` });
  if (credBtns.length) kb.push(credBtns);
  kb.push([{ text: "🔄 Sincronizar claves vigentes", callback_data: "sync:claves:ask" }]);
  kb.push([{ text: "💰 Cambiar precio", callback_data: `cli:serv:edit:precio:${clientId}:${idx}` }]);
  kb.push([{ text: "📅 Cambiar fecha renovación", callback_data: `cli:serv:edit:fecha:${clientId}:${idx}` }]);
  kb.push([{ text: "🗑️ Eliminar servicio", callback_data: `cli:serv:del:ask:${clientId}:${idx}` }]);
  kb.push([{ text: "⬅️ Volver Servicios", callback_data: `cli:serv:list:${clientId}` }, { text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, kb);
}

// ===============================
// ESCRITURAS CRM (invalidan caché + registran historial)
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
  if (!validateIdentByPlatformLocal(plat, ident)) throw new Error(`${getIdentLabelLocal(plat)} inválido.`);

  let clave = String(servicio.clave || servicio.password || servicio.pass || "").trim();
  let pin = String(servicio.pin || "").trim();
  if (!clave && requiereClaveLocal(plat) && !requierePinLocal(plat) && pin) { clave = pin; pin = ""; }

  const precio = Number(servicio.precio || 0);
  const fechaRenovacion = String(servicio.fechaRenovacion || "").trim();

  if (requiereClaveLocal(plat) && !clave) throw new Error("Clave inválida.");
  if (requierePinLocal(plat) && !pin) throw new Error("PIN inválido.");
  if (!Number.isFinite(precio) || precio <= 0) throw new Error("Precio inválido.");
  if (!isFechaDMY(fechaRenovacion)) throw new Error("Fecha de renovación inválida.");

  const sync = await syncServicioEnInventario({ clienteNombre: c.nombrePerfil || "", plataforma: plat, correo: ident, clave, pin });
  if (sync.reason === "full") throw new Error("La cuenta en inventario ya está llena.");

  servicios.push({ plataforma: plat, correo: ident, clave, pin, precio, fechaRenovacion });
  await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  cacheInvalidatePrefix(`clientes:doc:${id}`);

  // ✅ Registrar en historial
  await registrarEventoHistorial(id, {
    tipo: "servicio_agregado",
    descripcion: `Se agregó ${humanPlataforma(plat)}`,
    plataforma: plat,
    correo: ident,
    clave,
    pin,
    precio,
    fechaRenovacion,
  });

  return { ok: true, servicio: { plataforma: plat, correo: ident, clave, pin, precio, fechaRenovacion }, sync };
}

async function patchServicio(clientId, idx, patch = {}) {
  const ref = db.collection(CLIENTES_COLLECTION).doc(String(clientId || ""));
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios.slice() : [];
  if (idx < 0 || idx >= servicios.length) throw new Error("Servicio inválido.");

  const actual = servicios[idx] || {};
  const previo = { plataforma: actual.plataforma, correo: actual.correo, clave: actual.clave, pin: actual.pin };
  const siguiente = { ...actual, ...patch };
  siguiente.plataforma = normalizarPlataforma(siguiente.plataforma || actual.plataforma || "");

  if (!esPlataformaValida(siguiente.plataforma)) throw new Error("Plataforma inválida.");

  if (Object.prototype.hasOwnProperty.call(siguiente, "correo")) {
    siguiente.correo = normalizeIdentByPlatformLocal(siguiente.plataforma, siguiente.correo || "");
    if (!validateIdentByPlatformLocal(siguiente.plataforma, siguiente.correo)) throw new Error(`${getIdentLabelLocal(siguiente.plataforma)} inválido.`);
  }

  if (Object.prototype.hasOwnProperty.call(siguiente, "clave")) siguiente.clave = String(siguiente.clave || "").trim();
  if (Object.prototype.hasOwnProperty.call(siguiente, "pin")) siguiente.pin = String(siguiente.pin || "").trim();

  const credencialesTocadas =
    Object.prototype.hasOwnProperty.call(patch, "plataforma") ||
    Object.prototype.hasOwnProperty.call(patch, "correo") ||
    Object.prototype.hasOwnProperty.call(patch, "clave") ||
    Object.prototype.hasOwnProperty.call(patch, "pin");

  if (credencialesTocadas && requiereClaveLocal(siguiente.plataforma) && !getClaveServicioLocal(siguiente, siguiente.plataforma)) throw new Error("Clave inválida.");
  if (credencialesTocadas && requierePinLocal(siguiente.plataforma) && !getPinServicioLocal(siguiente, siguiente.plataforma)) throw new Error("PIN inválido.");
  if (esSoloCorreoLocal(siguiente.plataforma)) { siguiente.clave = ""; siguiente.pin = ""; }

  if (Object.prototype.hasOwnProperty.call(siguiente, "precio")) {
    const n = Number(siguiente.precio || 0);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Precio inválido.");
    siguiente.precio = n;
  }

  if (Object.prototype.hasOwnProperty.call(siguiente, "fechaRenovacion")) {
    if (!isFechaDMY(String(siguiente.fechaRenovacion || ""))) throw new Error("Fecha inválida.");
  }

  servicios[idx] = siguiente;
  await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  cacheInvalidatePrefix(`clientes:doc:${String(clientId)}`);

  // ✅ Registrar cambios relevantes en historial
  const cambios = [];
  if (patch.correo && patch.correo !== actual.correo)
    cambios.push(`Correo: ${actual.correo || "-"} → ${patch.correo}`);
  if (patch.clave !== undefined && patch.clave !== actual.clave)
    cambios.push(`Clave cambiada`);
  if (patch.pin !== undefined && patch.pin !== actual.pin)
    cambios.push(`PIN cambiado`);
  if (patch.precio !== undefined && patch.precio !== actual.precio)
    cambios.push(`Precio: ${Number(actual.precio || 0).toFixed(2)} → ${Number(patch.precio || 0).toFixed(2)} Lps`);
  if (patch.fechaRenovacion && patch.fechaRenovacion !== actual.fechaRenovacion)
    cambios.push(`Fecha: ${actual.fechaRenovacion || "-"} → ${patch.fechaRenovacion}`);
  if (patch.plataforma && normalizarPlataforma(patch.plataforma) !== normalizarPlataforma(actual.plataforma || ""))
    cambios.push(`Plataforma: ${humanPlataforma(actual.plataforma)} → ${humanPlataforma(patch.plataforma)}`);

  if (cambios.length) {
    await registrarEventoHistorial(String(clientId), {
      tipo: "servicio_editado",
      descripcion: cambios.join(" | "),
      plataforma: siguiente.plataforma,
      correo: siguiente.correo,
      correoAnterior: actual.correo,
      clave: getClaveServicioLocal(siguiente, siguiente.plataforma),
      pin: getPinServicioLocal(siguiente, siguiente.plataforma),
      precioAnterior: actual.precio,
      fechaAnterior: actual.fechaRenovacion,
    });
  }

  const cambioInventario =
    normalizarPlataforma(previo.plataforma || "") !== normalizarPlataforma(siguiente.plataforma || "") ||
    String(previo.correo || "") !== String(siguiente.correo || "") ||
    String(previo.pin || "") !== String(siguiente.pin || "") ||
    String(previo.clave || "") !== String(siguiente.clave || "");

  if (cambioInventario) {
    try { await removeServicioDeInventario({ clienteNombre: c.nombrePerfil || "", ...previo }); } catch (e) { logErr("patchServicio.removeInventario", e); }
    try { await syncServicioEnInventario({ clienteNombre: c.nombrePerfil || "", plataforma: siguiente.plataforma, correo: siguiente.correo, clave: getClaveServicioLocal(siguiente, siguiente.plataforma), pin: getPinServicioLocal(siguiente, siguiente.plataforma) }); } catch (e) { logErr("patchServicio.addInventario", e); }
  }

  return { ok: true, servicio: siguiente };
}

// ===============================
// ✅ ELIMINAR SERVICIO (con limpieza de inventario + historial)
// ===============================
async function eliminarServicioTx(clientId, idx) {
  const id = String(clientId || "").trim();
  const ref = db.collection(CLIENTES_COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Cliente no encontrado.");

  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios.slice() : [];
  if (idx < 0 || idx >= servicios.length) throw new Error("Servicio inválido.");

  const eliminado = servicios[idx];
  servicios.splice(idx, 1);

  await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  cacheInvalidatePrefix(`clientes:doc:${id}`);

  // Liberar slot en inventario
  try {
    await removeServicioDeInventario({
      clienteNombre: c.nombrePerfil || "",
      plataforma: eliminado.plataforma || "",
      correo: eliminado.correo || "",
      pin: eliminado.pin || "",
    });
  } catch (e) { logErr("eliminarServicioTx.removeInventario", e); }

  // ✅ Registrar en historial
  await registrarEventoHistorial(id, {
    tipo: "servicio_eliminado",
    descripcion: `Se eliminó ${humanPlataforma(eliminado.plataforma || "")}`,
    plataforma: eliminado.plataforma || "",
    correo: eliminado.correo || "",
    clave: getClaveServicioLocal(eliminado, eliminado.plataforma || ""),
    pin: getPinServicioLocal(eliminado, eliminado.plataforma || ""),
    precio: eliminado.precio || 0,
    fechaRenovacion: eliminado.fechaRenovacion || "",
  });

  return { ok: true, eliminado, nombreCliente: c.nombrePerfil || "" };
}

// ===============================
// ✅ MENÚ DE LISTA RENOVACIÓN
// ===============================
async function menuListaRenovacion(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = serviciosConIndiceOriginal(Array.isArray(c.servicios) ? c.servicios : []);
  if (!servicios.length) {
    return upsertPanel(chatId, "🔄 *RENOVACIONES*\n\nEste cliente no tiene servicios.", [
      [{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }],
      [{ text: "⬅️ Volver Ficha",   callback_data: `cli:view:${clientId}` }],
      [{ text: "🏠 Inicio",          callback_data: "go:inicio" }],
    ]);
  }

  const kb = servicios.map((s) => [{
    text: safeBtnLabel(`${iconPlataforma(s.plataforma || "")} ${humanPlataforma(s.plataforma || "")} — ${s.fechaRenovacion || "sin fecha"}`),
    callback_data: `cli:ren:one:${clientId}:${s.idxOriginal}`,
  }]);
  kb.push([
    { text: "⏫ Todos +30 días", callback_data: `cli:ren:all:ask:${clientId}` },
    { text: "⏫ Todos +31 días", callback_data: `cli:ren:all31:ask:${clientId}` },
  ]);
  kb.push([{ text: "📅 Todos — fecha personalizada", callback_data: `cli:ren:allcustom:ask:${clientId}` }]);
  kb.push([{ text: "🗑️ Baja masiva de servicios", callback_data: `cli:baja:menu:${clientId}` }]);
  kb.push([{ text: "⬅️ Volver Ficha", callback_data: `cli:view:${clientId}` }, { text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId,
    `🔄 *RENOVAR SERVICIO*\n👤 *${escMD(c.nombrePerfil || "Cliente")}*\n\nSeleccione el servicio a gestionar:`,
    kb
  );
}

// ===============================
// ✅ MENÚ ACCIÓN DE RENOVACIÓN — 4 opciones por servicio
// ===============================
async function menuRenovacionServicio(chatId, clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

  const s = servicios[idx];
  const est = getEstadoServicio(s.fechaRenovacion || "");

  const txt =
    `🔄 *GESTIONAR RENOVACIÓN*\n\n` +
    `👤 *${escMD(c.nombrePerfil || "Cliente")}*\n` +
    `${iconPlataforma(s.plataforma || "")} *${escMD(humanPlataforma(s.plataforma || ""))}*\n` +
    `${getIdentLabelLocal(s.plataforma || "") === "Usuario" ? "👤" : "📧"} ${escMD(s.correo || "-")}\n` +
    `💰 ${escMD(`${Number(s.precio || 0).toFixed(2)} Lps`)}\n` +
    `📅 Vence: ${escMD(s.fechaRenovacion || "-")} — ${est.emoji} ${escMD(est.texto)}\n\n` +
    `¿Qué pasó con este servicio?`;

  return upsertPanel(chatId, txt, [
    [
      { text: "✅ +30 días", callback_data: `cli:ren:auto:${clientId}:${idx}` },
      { text: "✅ +31 días", callback_data: `cli:ren:auto31:${clientId}:${idx}` },
    ],
    [{ text: "📅 Renovó — otra fecha", callback_data: `cli:ren:manual:${clientId}:${idx}` }],
    [{ text: "🔄 Cambió de servicio", callback_data: `cli:ren:cambio:${clientId}:${idx}` }],
    [{ text: "❌ No renovó — eliminar", callback_data: `cli:ren:noren:ask:${clientId}:${idx}` }],
    [{ text: "⬅️ Volver",                    callback_data: `cli:ren:list:${clientId}` }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

// ===============================
// ✅ PANEL DE RENOVACIONES DEL DÍA CON BOTONES
// ===============================
async function enviarPanelRenovacionesConAcciones(chatId, fecha, rows = []) {
  if (!rows.length) {
    return bot.sendMessage(chatId, `📅 *Renovaciones del ${escMD(fecha)}*\n\n_No hay renovaciones para esta fecha._`, { parse_mode: "Markdown" });
  }

  let total = 0;
  rows.forEach((x) => { total += Number(x.precio || 0); });

  let txt =
    `📅 *RENOVACIONES DEL ${escMD(fecha)}*\n\n` +
    `*Total perfiles:* ${rows.length}\n` +
    `*Total esperado:* ${escMD(`${total.toFixed(2)} Lps`)}\n\n` +
    `Seleccione un perfil para gestionar su renovación:`;

  const kb = rows.slice(0, 20).map((x, i) => [{
    text: safeBtnLabel(`${i + 1}. ${iconPlataforma(x.plataforma || "")} ${x.nombrePerfil || "Sin nombre"} — ${humanPlataforma(x.plataforma || "")}`),
    callback_data: `ren:accion:${x.clientId}:${x.idx}`,
  }]);

  if (rows.length > 20) {
    kb.push([{ text: `📄 Ver los ${rows.length - 20} restantes como TXT`, callback_data: `txt:hoy` }]);
  }

  kb.push([{ text: "📄 TXT de todas",  callback_data: "txt:hoy" }]);
  kb.push([{ text: "⬅️ Volver",        callback_data: "menu:renovaciones" }]);
  kb.push([{ text: "🏠 Inicio",         callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, kb);
}

async function wizardStart(chatId) {
  wizard.set(String(chatId), { step: 1, clientId: null, nombre: "", telefono: "", vendedor: "", servicio: {}, servStep: 1 });
  return upsertPanel(chatId, "👤 *NUEVO CLIENTE*\n\n(1/3) Escriba el *nombre del cliente*: ", [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]);
}

async function wizardNext(chatId, rawText = "") {
  const st = wizard.get(String(chatId));
  if (!st) return;

  const t = String(rawText || "").trim();
  if (!t) return bot.sendMessage(chatId, "⚠️ Escriba un valor válido.");

  if (st.step === 1) {
    st.nombre = t; st.step = 2; wizard.set(String(chatId), st);
    return bot.sendMessage(chatId, "(2/3) Teléfono del cliente:");
  }

  if (st.step === 2) {
    const tel = onlyDigits(t);
    if (tel.length < 7) return bot.sendMessage(chatId, "⚠️ Teléfono inválido. Escriba al menos 7 dígitos.");
    st.telefono = t; st.step = 3; wizard.set(String(chatId), st);
    return bot.sendMessage(chatId, "(3/3) Vendedor responsable:");
  }

  if (st.step === 3) {
    st.vendedor = t; st.step = 4; st.servStep = 1; st.servicio = {};
    wizard.set(String(chatId), st);
    return bot.sendMessage(chatId, "📌 Seleccione plataforma del servicio:", { reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", st.clientId) } });
  }

  if (st.step === 4) {
    const plat = normalizarPlataforma(st?.servicio?.plataforma || "");
    if (!plat) return bot.sendMessage(chatId, "⚠️ Primero seleccione la plataforma.");

    if (st.servStep === 2) {
      if (!validateIdentByPlatformLocal(plat, t)) return bot.sendMessage(chatId, `⚠️ ${getIdentLabelLocal(plat)} inválido.`);
      st.servicio.correo = normalizeIdentByPlatformLocal(plat, t);

      if (requiereClaveLocal(plat)) {
        st.servStep = 3; wizard.set(String(chatId), st);
        return bot.sendMessage(chatId, "(Servicio 3/6) Clave de la cuenta:");
      }

      if (requierePinLocal(plat)) {
        st.servStep = 4; wizard.set(String(chatId), st);
        return bot.sendMessage(chatId, "(Servicio 4/6) PIN del perfil:");
      }

      st.servStep = 5; wizard.set(String(chatId), st);
      return bot.sendMessage(chatId, "(Servicio 5/6) Precio (solo número, Lps):");
    }

    if (st.servStep === 3) {
      st.servicio.clave = t;
      if (requierePinLocal(plat)) {
        st.servStep = 4; wizard.set(String(chatId), st);
        return bot.sendMessage(chatId, "(Servicio 4/6) PIN del perfil:");
      }

      st.servStep = 5; wizard.set(String(chatId), st);
      return bot.sendMessage(chatId, "(Servicio 5/6) Precio (solo número, Lps):");
    }

    if (st.servStep === 4) {
      st.servicio.pin = t;
      st.servStep = 5; wizard.set(String(chatId), st);
      return bot.sendMessage(chatId, "(Servicio 5/6) Precio (solo número, Lps):");
    }

    if (st.servStep === 5) {
      const precio = parseMontoNumber(t);
      if (!Number.isFinite(precio) || precio <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número.");
      st.servicio.precio = precio; st.servStep = 6; wizard.set(String(chatId), st);
      return bot.sendMessage(chatId, "(Servicio 6/6) Fecha renovación (dd/mm/yyyy):");
    }

    if (st.servStep === 6) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy.");
      st.servicio.fechaRenovacion = t;

      let clientId = st.clientId;
      if (!clientId) {
        const dup = await clienteDuplicado(st.nombre, st.telefono);
        if (dup) return bot.sendMessage(chatId, "⚠️ Ya existe un cliente con ese nombre y teléfono.");

        const ref = db.collection(CLIENTES_COLLECTION).doc();
        clientId = ref.id;
        await ref.set({
          nombrePerfil: st.nombre, nombre_norm: normTxt(st.nombre),
          telefono: st.telefono, telefono_norm: onlyDigits(st.telefono),
          vendedor: st.vendedor, vendedor_norm: normTxt(st.vendedor),
          servicios: [],
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await registrarEventoHistorial(clientId, {
          tipo: "cliente_creado",
          descripcion: `Cliente creado por vendedor: ${st.vendedor}`,
        });
      }

      await addServicioTx(clientId, {
        plataforma: plat,
        correo: st.servicio.correo,
        clave: st.servicio.clave || "",
        pin: st.servicio.pin || "",
        precio: st.servicio.precio,
        fechaRenovacion: st.servicio.fechaRenovacion,
      });

      wizard.set(String(chatId), { step: 4, clientId, nombre: st.nombre, telefono: st.telefono, vendedor: st.vendedor, servicio: {}, servStep: 1 });

      return bot.sendMessage(chatId, "✅ *Servicio guardado correctamente*\n\nSeleccione qué desea hacer ahora:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "➕ Agregar otra", callback_data: `wiz:addmore:${clientId}` }],
          [{ text: "✅ Finalizar",    callback_data: `wiz:finish:${clientId}` }],
          [{ text: "🏠 Inicio",       callback_data: "go:inicio" }],
        ]},
      });
    }
  }
}

// ===============================
// ✅ RENOVACIONES OPTIMIZADAS
// ===============================
async function obtenerRenovacionesPorFecha(fechaDMY, vendedor = null) {
  const fecha = String(fechaDMY || "").trim();
  if (!isFechaDMY(fecha)) return [];
  const vendedorNorm = vendedor ? normTxt(vendedor) : "";

  const snap = await db.collection(CLIENTES_COLLECTION).get();
  const out = [];

  snap.forEach((d) => {
    const c = d.data() || {};
    const vendedorCliente = String(c.vendedor || "").trim();

    if (vendedorNorm && normTxt(vendedorCliente) !== vendedorNorm) return;

    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    servicios.forEach((s, idx) => {
      if (String(s?.fechaRenovacion || "").trim() !== fecha) return;
      out.push({
        clientId: d.id, idx,
        nombrePerfil: c.nombrePerfil || "Sin nombre",
        telefono: c.telefono || "-",
        vendedor: vendedorCliente || "-",
        plataforma: s.plataforma || "",
        correo: s.correo || "",
        clave: getClaveServicioLocal(s, s.plataforma || ""),
        pin: getPinServicioLocal(s, s.plataforma || ""),
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

  if (!items.length) { txt += `_No hay renovaciones para esta fecha._`; return txt; }

  let total = 0;
  items.forEach((x) => { total += Number(x.precio || 0); });

  txt += `*Total perfiles:* ${escMD(String(items.length))}\n`;
  txt += `*Total esperado:* ${escMD(`${total.toFixed(2)} Lps`)}\n\n`;

  items.forEach((x, i) => {
    txt += `${i + 1}. ${iconPlataforma(x.plataforma || "")} *${escMD(x.nombrePerfil || "Sin nombre")}*\n`;
    txt += `   📱 ${escMD(x.telefono || "-")}\n`;
    txt += `   📦 ${escMD(humanPlataforma(x.plataforma || ""))}\n`;
    txt += renderCredencialesServicioLocal(x, true, "   ");
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

  txt += `Total perfiles: ${items.length}\nTotal esperado: ${total.toFixed(2)} Lps\n\n`;

  items.forEach((x, i) => {
    txt += `${i + 1}) ${x.nombrePerfil || "Sin nombre"}\n`;
    txt += `Telefono: ${x.telefono || "-"}\nPlataforma: ${humanPlataforma(x.plataforma || "")}\n`;
    txt += renderCredencialesServicioLocal(x, false, "");
    txt += `Precio: ${Number(x.precio || 0).toFixed(2)} Lps\nVendedor: ${x.vendedor || "-"}\n\n`;
  });

  return txt;
}

async function enviarTXT(chatId, rows = [], fecha = "", vendedor = null) {
  const contenido = renovacionesTextoPlano(rows, fecha, vendedor);
  const nombre = vendedor
    ? `renovaciones_${fileSafeName(vendedor, "vendedor").replace(/\.txt$/i, "")}_${String(fecha || "").replace(/\//g, "-")}.txt`
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
  rows.forEach((c, i) => { txt += `========================================\n${i + 1}) ${clienteResumenTXT(c)}\n`; });

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
    clientes.forEach((c, i) => { txt += `========================================\n${i + 1}) ${clienteResumenTXT(c)}\n`; });
    await enviarTxtComoArchivo(chatId, txt, `${fileSafeName(vend, "vendedor").replace(/\.txt$/i, "")}_${Date.now()}.txt`);
    enviados++;
  }

  return bot.sendMessage(chatId, `✅ TXT por vendedor generados: ${enviados}`);
}

// ✅ Mantiene compatibilidad — ahora llama a enviarHistorialClienteTXTReal
async function enviarHistorialClienteTXT(chatId, clientId) {
  return enviarHistorialClienteTXTReal(chatId, clientId);
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
  rows.forEach((c, i) => { txt += `========================================\n${i + 1}) ${clienteResumenTXT(c)}\n`; });

  return enviarTxtComoArchivo(chatId, txt, `mis_clientes_${fileSafeName(vendedorNombre, "vendedor").replace(/\.txt$/i, "")}.txt`);
}

// ===============================
// COMANDOS TELEGRAM — DESCARGAR EXCEL CLIENTES
// ===============================
const { generarExcelClientesGeneral } = require("./index_11_clientes_excel");

// ✅ Comando: /clientes_excel
bot.onText(/^\/clientes_excel$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Solo admin
  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, "❌ Solo admin puede descargar listado de clientes");
  }

  try {
    await bot.sendMessage(chatId, "⏳ Generando Excel de clientes... espera");
    const buffer = await generarExcelClientesGeneral();

    if (!buffer || buffer.length === 0) {
      return bot.sendMessage(chatId, "❌ Error al generar el archivo");
    }

    await bot.sendDocument(chatId, buffer, {}, {
      filename: `clientes_${Date.now()}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await bot.sendMessage(chatId, `✅ Excel de clientes generado\n👥 Incluye:\n- Resumen general\n- Listado completo (con filtros)\n- Análisis por vendedor`);
  } catch (e) {
    logErr("clientes_excel", e);
    bot.sendMessage(chatId, `❌ Error: ${e.message}`);
  }
});

module.exports = {
  humanPlataforma, renderFichaClienteMarkdown, serviciosConIndiceOriginal, dedupeClientes, clienteDuplicado,
  getCliente, buscarPorTelefonoTodos, buscarClienteRobusto,
  enviarFichaCliente, enviarFichaClienteVendedor, enviarListaResultadosClientes, menuEditarCliente,
  menuListaServicios, menuServicio,
  patchServicio, addServicioTx, eliminarServicioTx, removeServicioDeInventario,
  menuListaRenovacion, menuRenovacionServicio, enviarPanelRenovacionesConAcciones,
  kbPlataformasWiz, wizardStart, wizardNext,
  clienteResumenTXT, reporteClientesTXTGeneral, reporteClientesSplitPorVendedorTXT,
  enviarHistorialClienteTXT, enviarHistorialClienteTXTReal,
  generarHistorialTXT, getHistorialCliente, registrarEventoHistorial,
  enviarMisClientes, enviarMisClientesTXT,
  obtenerRenovacionesPorFecha, renovacionesTexto, enviarTXT, enviarTXTATodosHoy,
};
