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
    netflix:"Netflix Premium", vipnetflix:"Netflix VIP", disneyp:"Disney Premium", disneys:"Disney Premium sin ESPN",
    hbomax:"HBO Max", primevideo:"Prime Video", paramount:"Paramount+", crunchyroll:"Crunchyroll",
    vix:"Vix", appletv:"Apple TV", universal:"Universal+", spotify:"Spotify", youtube:"YouTube", office:"Microsoft 365",
    deezer:"Deezer", canva:"Canva", gemini:"Gemini", chatgpt:"ChatGPT", duolingo:"Duolingo",
    oleadatv1:"Oleada TV (1)", oleadatv3:"Oleada TV (3)", iptv1:"IPTV (1)", iptv3:"IPTV (3)", iptv4:"IPTV (4)",
  };
  return map[k] || String(key || "");
}

function iconPlataforma(key = "") {
  const k = normalizarPlataforma(key);
  const map = { netflix:"📺", vipnetflix:"🔥", disneyp:"🏰", disneys:"🎬", hbomax:"🎞️", primevideo:"🎥", paramount:"💿", crunchyroll:"🍥", vix:"📱", appletv:"🍎", universal:"🌍", spotify:"🎵", youtube:"▶️", office:"📎", deezer:"🎧", canva:"🎨", gemini:"✨", chatgpt:"🤖", duolingo:"🦉", oleadatv1:"🌊", oleadatv3:"🌊", iptv1:"📡", iptv3:"📡", iptv4:"📡" };
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
  return ["netflix","disneyp","disneys","hbomax","primevideo","crunchyroll","universal"].includes(normalizarPlataforma(plataforma));
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

function recordIdLocal(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function perfilesServicioLocal(servicio = {}, titular = "") {
  const lista = Array.isArray(servicio.perfiles) && servicio.perfiles.length
    ? servicio.perfiles
    : [{
        perfilId: servicio.perfilId || "",
        nombre: servicio.nombrePerfil || servicio.perfil || titular || "Cliente",
        perfil: servicio.perfil || servicio.nombrePerfil || titular || "",
        correo: servicio.correo || "",
        clave: servicio.clave || servicio.password || servicio.pass || "",
        pin: servicio.pinPerfil || servicio.pin_perfil || servicio.perfilPin || servicio.pin || ""
      }];
  return lista.map((p, index) => {
    const nombre = String(p?.nombre || p?.nombrePerfil || p?.cliente || p?.perfil || titular || `Perfil ${index + 1}`).trim();
    return {
      perfilId: String(p?.perfilId || p?.id || ""),
      nombre,
      perfil: String(p?.perfil || p?.nombrePerfil || p?.nombre || nombre).trim(),
      correo: String(p?.correo ?? servicio.correo ?? "").trim(),
      clave: String(p?.clave ?? p?.password ?? p?.pass ?? servicio.clave ?? servicio.password ?? servicio.pass ?? "").trim(),
      pin: String(p?.pinPerfil ?? p?.pin_perfil ?? p?.perfilPin ?? p?.pin ?? (index === 0 ? (servicio.pinPerfil ?? servicio.pin_perfil ?? servicio.perfilPin ?? servicio.pin ?? "") : "")).trim()
    };
  });
}

function cantidadPerfilesServicioLocal(servicio = {}, titular = "") {
  return perfilesServicioLocal(servicio, titular).length;
}

function servicioParaPerfilLocal(servicio = {}, perfil = {}, titular = "") {
  const p = perfil || {};
  return {
    ...servicio,
    nombrePerfil: p.nombre || titular || servicio.nombrePerfil || "",
    perfil: p.perfil || p.nombre || servicio.perfil || "",
    correo: p.correo ?? servicio.correo ?? "",
    clave: p.clave ?? servicio.clave ?? "",
    pin: p.pin ?? "",
    pinPerfil: p.pin ?? "",
    perfiles: undefined
  };
}

function getClaveServicioLocal(servicio = {}, plataforma = "") {
  const p = normalizarPlataforma(plataforma || servicio.plataforma || "");
  const principal = Array.isArray(servicio.perfiles) && servicio.perfiles.length ? servicio.perfiles[0] || {} : {};
  const directa = String(principal.clave || principal.password || principal.pass || servicio.clave || servicio.password || servicio.pass || "").trim();
  if (directa) return directa;
  if (requiereClaveLocal(p) && !requierePinLocal(p)) return String(servicio.pin || "").trim();
  return "";
}

function extraerPinServicioLocal(servicio = {}) {
  const principal = Array.isArray(servicio.perfiles) && servicio.perfiles.length ? servicio.perfiles[0] || {} : {};
  const valores = [
    principal.pinPerfil,
    principal.pin_perfil,
    principal.perfilPin,
    principal.pin,
    servicio.pin,
    servicio.pinPerfil,
    servicio.pin_perfil,
    servicio.perfilPin,
    servicio.perfil_pin,
    servicio.profilePin,
    servicio.profile_pin,
    servicio.pinCliente,
    servicio.pin_cliente,
    servicio.pinServicio,
    servicio.pin_servicio,
  ];

  for (const v of valores) {
    const s = String(v || "").trim();
    if (!s) continue;
    const n = normTxt(s);
    if (["-", "sin pin", "n/a", "na", "null", "undefined"].includes(n)) continue;
    return s;
  }
  return "";
}

function getPinServicioLocal(servicio = {}, plataforma = "") {
  const p = normalizarPlataforma(plataforma || servicio.plataforma || "");
  if (!requierePinLocal(p)) return "";
  return extraerPinServicioLocal(servicio);
}

function renderCredencialesServicioLocal(servicio = {}, markdown = true, indent = "") {
  const p = normalizarPlataforma(servicio.plataforma || "");
  const esc = markdown ? escMD : (v = "") => String(v ?? "");
  const perfiles = perfilesServicioLocal(servicio, servicio.nombrePerfil || servicio.titular || "");
  if (perfiles.length > 1) {
    let multi = `${indent}👥 ${markdown ? "*Perfiles incluidos:*" : "Perfiles incluidos:"} ${perfiles.length}\n`;
    perfiles.forEach((perfil, index) => {
      const individual = servicioParaPerfilLocal(servicio, perfil, servicio.nombrePerfil || servicio.titular || "");
      multi += `${indent}${index + 1}. ${markdown ? `*${esc(perfil.nombre || `Perfil ${index + 1}`)}*` : (perfil.nombre || `Perfil ${index + 1}`)}\n`;
      const identLabel = getIdentLabelLocal(p);
      const identIcon = identLabel === "Usuario" ? "👤" : "📧";
      multi += `${indent}   ${identIcon} ${markdown ? `*${esc(identLabel)}:*` : `${identLabel}:`} ${esc(individual.correo || "-")}\n`;
      if (requiereClaveLocal(p)) multi += `${indent}   🔑 ${markdown ? "*Clave:*" : "Clave:"} ${esc(getClaveServicioLocal(individual, p) || "-")}\n`;
      if (requierePinLocal(p)) multi += `${indent}   🔐 ${markdown ? "*PIN:*" : "PIN:"} ${esc(getPinServicioLocal(individual, p) || "-")}\n`;
    });
    return multi;
  }
  const individual = servicioParaPerfilLocal(servicio, perfiles[0] || {}, servicio.nombrePerfil || servicio.titular || "");
  const identLabel = getIdentLabelLocal(p);
  const identIcon = identLabel === "Usuario" ? "👤" : "📧";
  let out = "";
  out += `${indent}${identIcon} ${markdown ? `*${esc(identLabel)}:*` : `${identLabel}:`} ${esc(individual.correo || "-")}\n`;
  if (requiereClaveLocal(p)) out += `${indent}🔑 ${markdown ? "*Clave:*" : "Clave:"} ${esc(getClaveServicioLocal(individual, p) || "-")}\n`;
  if (requierePinLocal(p)) out += `${indent}🔐 ${markdown ? "*PIN:*" : "PIN:"} ${esc(getPinServicioLocal(individual, p) || "-")}\n`;
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
  const map = { netflix:5, vipnetflix:1, disneyp:6, disneys:3, hbomax:5, primevideo:5, paramount:5, crunchyroll:5, vix:4, appletv:4, universal:4, spotify:1, youtube:1, deezer:1, oleadatv1:1, oleadatv3:3, iptv1:1, iptv3:3, iptv4:4, canva:1, gemini:1, chatgpt:1, duolingo:1, office:1 };
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
    perfiles: rows.reduce((sum, s) => sum + cantidadPerfilesServicioLocal(s), 0),
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
  const { ref } = found;
  return db.runTransaction(async (tx) => {
    const latest = await tx.get(ref);
    if (!latest.exists) return { ok: false, reason: "not_found" };
    const data = latest.data() || {};
    let clientes = Array.isArray(data.clientes) ? data.clientes.slice() : [];
    const pinNorm = String(pin || "").trim();
    const idxExiste = clientes.findIndex((x) => normTxt(x?.nombre || "") === normTxt(clienteNombre));
    if (idxExiste !== -1) {
      const patch = {};
      if (pinNorm && String(clientes[idxExiste].pin || "") !== pinNorm) {
        clientes[idxExiste] = { ...clientes[idxExiste], pin: pinNorm };
        patch.clientes = clientes;
      }
      const claveNorm = String(clave || "").trim();
      if (claveNorm && requiereClaveLocal(plat) && (!data.clave || String(data.clave || "").toLowerCase() === "sin clave")) patch.clave = claveNorm;
      if (Object.keys(patch).length) {
        patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        tx.set(ref, patch, { merge: true });
      }
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
    tx.set(ref, patch, { merge: true });
    return { ok: true, synced: true, added: true, ocupados, disponibles, capacidad };
  });
}

async function removeServicioDeInventario({ clienteNombre = "", plataforma = "", correo = "", pin = "" }) {
  const plat = normalizarPlataforma(plataforma);
  const acceso = normalizeIdentByPlatformLocal(plat, correo);
  const found = await getInventarioDoc(plat, acceso);
  if (!found) return { ok: false, reason: "not_found" };

  const { ref } = found;
  return db.runTransaction(async (tx) => {
    const latest = await tx.get(ref);
    if (!latest.exists) return { ok: false, reason: "not_found" };
    const data = latest.data() || {};
    let clientes = Array.isArray(data.clientes) ? data.clientes.slice() : [];
    const pinFiltro = String(pin || "").trim();
    let idx = -1;
    if (pinFiltro) {
      idx = clientes.findIndex((x) => normTxt(x?.nombre || "") === normTxt(clienteNombre) && String(x?.pin || "") === pinFiltro);
    }
    if (idx === -1) idx = clientes.findIndex((x) => normTxt(x?.nombre || "") === normTxt(clienteNombre));
    if (idx === -1) return { ok: true, removed: false };
    clientes.splice(idx, 1);
    clientes = clientes.map((x, i) => ({ ...x, slot: i + 1 }));
    const capacidad = Number(data.capacidad || data.total || getTotalPorPlataformaLocal(plat) || 1);
    const ocupados = clientes.length;
    const disponibles = Math.max(0, capacidad - ocupados);
    tx.set(ref, { clientes, ocupados, disponibles, disp: disponibles, capacidad, estado: disponibles === 0 ? "llena" : "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, removed: true };
  });
}

function normalizarCompraLocal(servicio = {}, titular = "", anterior = {}) {
  const plat = normalizarPlataforma(servicio.plataforma || anterior.plataforma || "");
  const tienePerfiles = Array.isArray(servicio.perfiles);
  let base;
  if (tienePerfiles && servicio.perfiles.length) base = servicio.perfiles;
  else if (!tienePerfiles && Array.isArray(anterior.perfiles) && anterior.perfiles.length) base = anterior.perfiles;
  else base = perfilesServicioLocal({ ...anterior, ...servicio }, titular);
  const prev = perfilesServicioLocal(anterior, titular);
  const perfiles = base.map((raw = {}, index) => {
    const previo = prev.find((p) => p.perfilId && p.perfilId === String(raw.perfilId || raw.id || "")) || prev[index] || {};
    const nombre = String(raw.nombre || raw.nombrePerfil || raw.cliente || raw.perfil || previo.nombre || titular || `Perfil ${index + 1}`).trim();
    const correoTop = index === 0 && servicio.correo != null ? servicio.correo : undefined;
    const claveTop = index === 0 && servicio.clave != null ? servicio.clave : undefined;
    const pinTop = index === 0 && (servicio.pin != null || servicio.pinPerfil != null) ? (servicio.pinPerfil ?? servicio.pin) : undefined;
    return {
      perfilId: String(raw.perfilId || raw.id || previo.perfilId || recordIdLocal("perfil")),
      nombre,
      perfil: String(raw.perfil || raw.nombrePerfil || raw.nombre || previo.perfil || nombre).trim(),
      correo: normalizeIdentByPlatformLocal(plat, raw.correo ?? correoTop ?? previo.correo ?? servicio.correo ?? anterior.correo ?? ""),
      clave: requiereClaveLocal(plat) ? String(raw.clave ?? raw.password ?? raw.pass ?? claveTop ?? previo.clave ?? servicio.clave ?? anterior.clave ?? "").trim() : "",
      pin: requierePinLocal(plat) ? String(raw.pinPerfil ?? raw.pin_perfil ?? raw.perfilPin ?? raw.pin ?? pinTop ?? previo.pin ?? "").trim() : ""
    };
  });
  const principal = perfiles[0] || {};
  return {
    ...anterior,
    ...servicio,
    compraId: String(servicio.compraId || anterior.compraId || recordIdLocal("compra")),
    modalidad: perfiles.length > 1 ? "multiperfil" : "individual",
    plataforma: plat,
    correo: principal.correo || "",
    clave: principal.clave || "",
    pin: principal.pin || "",
    perfil: principal.perfil || principal.nombre || titular || "",
    perfiles
  };
}

function validarCompraLocal(compra = {}) {
  const plat = normalizarPlataforma(compra.plataforma || "");
  if (!esPlataformaValida(plat)) throw new Error("Plataforma inválida.");
  const perfiles = perfilesServicioLocal(compra, "");
  if (!perfiles.length) throw new Error("Agregue al menos un perfil.");
  perfiles.forEach((p, index) => {
    if (!String(p.nombre || "").trim()) throw new Error(`Falta el nombre del perfil ${index + 1}.`);
    if (!validateIdentByPlatformLocal(plat, p.correo || "")) throw new Error(`${getIdentLabelLocal(plat)} inválido en ${p.nombre || `perfil ${index + 1}`}.`);
    if (requiereClaveLocal(plat) && !String(p.clave || "").trim()) throw new Error(`Falta la clave de ${p.nombre || `perfil ${index + 1}`}.`);
    if (requierePinLocal(plat) && !String(p.pin || "").trim()) throw new Error(`Falta el PIN individual de ${p.nombre || `perfil ${index + 1}`}.`);
  });
}

async function sincronizarCompraInventarioLocal(anterior, nuevo, titular = "") {
  const antes = anterior ? perfilesServicioLocal(anterior, titular) : [];
  const despues = nuevo ? perfilesServicioLocal(nuevo, titular) : [];
  const platAntes = normalizarPlataforma(anterior?.plataforma || nuevo?.plataforma || "");
  const platNuevo = normalizarPlataforma(nuevo?.plataforma || anterior?.plataforma || "");
  const key = (p, plat) => `${plat}|${normalizeIdentByPlatformLocal(plat, p.correo || "")}|${normTxt(p.nombre || "")}`;
  const nuevas = new Set(despues.map((p) => key(p, platNuevo)));
  const removidos = [];
  const agregados = [];

  try {
    for (const p of antes) {
      if (!nuevas.has(key(p, platAntes))) {
        const result = await removeServicioDeInventario({ clienteNombre: p.nombre || titular, plataforma: platAntes, correo: p.correo, pin: p.pin });
        if (result?.removed) removidos.push(p);
      }
    }
    for (const p of despues) {
      const result = await syncServicioEnInventario({ clienteNombre: p.nombre || titular, plataforma: platNuevo, correo: p.correo, clave: p.clave, pin: p.pin });
      if (result?.reason === "full") throw new Error(`La cuenta de ${p.nombre || "ese perfil"} ya está llena.`);
      if (result?.added) agregados.push(p);
    }
    return { ok: true, perfiles: despues.length, agregados: agregados.length, removidos: removidos.length };
  } catch (error) {
    for (const p of agregados) {
      try { await removeServicioDeInventario({ clienteNombre: p.nombre || titular, plataforma: platNuevo, correo: p.correo, pin: p.pin }); } catch (_) {}
    }
    for (const p of removidos) {
      try { await syncServicioEnInventario({ clienteNombre: p.nombre || titular, plataforma: platAntes, correo: p.correo, clave: p.clave, pin: p.pin }); } catch (_) {}
    }
    throw error;
  }
}

async function sincronizarCompraInventarioSeguroLocal(anterior, nuevo, titular = "") {
  try {
    return await sincronizarCompraInventarioLocal(anterior, nuevo, titular);
  } catch (error) {
    logErr("sincronizarCompraInventarioSeguroLocal", error);
    return { ok: false, warning: String(error?.message || "No se pudo sincronizar inventario.") };
  }
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
  txt += `Compras activas: ${servicios.length}\n`;
  txt += `Perfiles activos: ${resumen.perfiles}\n\n`;

  txt += "============================\n";
  txt += "COMPRAS / SERVICIOS ACTUALES\n";
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

  // ⚠️ TTL corto a propósito (no el de 5 min por defecto del prefijo "clientes").
  // Sublichat HQ (panel web en Vercel) escribe renovaciones directo en Firestore
  // desde OTRO proceso — no tiene forma de avisarle a este bot que invalide su
  // caché en memoria. Con 5 min, el bot seguía mostrando la fecha vieja y
  // renovando sobre datos obsoletos aunque el panel ya hubiera guardado el cambio.
  const cacheKey = `clientes:doc:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached === "__null__" ? null : cached;

  const doc = await db.collection(CLIENTES_COLLECTION).doc(id).get();
  if (!doc.exists) { cacheSet(cacheKey, "__null__", 10 * 1000); return null; }

  const result = { id: doc.id, ...(doc.data() || {}) };
  cacheSet(cacheKey, result, 10 * 1000);
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
        ...perfilesServicioLocal(s, x.nombrePerfil || "").flatMap((p) => [normTxt(p.nombre), normTxt(p.perfil), normTxt(p.correo), String(p.clave || "").toLowerCase(), String(p.pin || "").toLowerCase()]),
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
  txt += `Proxima renovacion: ${resumen.proxima}\nCompras activas: ${servicios.length}\nPerfiles activos: ${resumen.perfiles}\n\nCOMPRAS / SERVICIOS\n`;

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
  txt += `🛒 *Compras activas:* ${escMD(String(servicios.length))}\n👥 *Perfiles activos:* ${escMD(String(resumen.perfiles))}\n\n*COMPRAS / SERVICIOS*\n`;

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

  const kb = servicios.map((s, i) => [{ text: safeBtnLabel(`${i + 1}) ${humanPlataforma(s.plataforma || "")} • ${cantidadPerfilesServicioLocal(s, c.nombrePerfil || "")} perfil(es)`), callback_data: `cli:serv:menu:${clientId}:${compraSelectorLocal(s, s.idxOriginal)}` }]);
  kb.push([{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }]);
  kb.push([{ text: "⬅️ Volver Ficha",   callback_data: `cli:view:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio",          callback_data: "go:inicio" }]);

  return upsertPanel(chatId, `🧩 *SERVICIOS DE ${escMD(c.nombrePerfil || "CLIENTE")}*\n\nSeleccione uno:`, kb);
}

async function menuServicio(chatId, clientId, selector) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const idx = resolverIndiceCompraSelectorLocal(servicios, selector);
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");

  const s = servicios[idx] || {};
  const compraSel = compraSelectorLocal(s, idx);
  const est = getEstadoServicio(s.fechaRenovacion || "");
  let txt =
    `🧩 *SERVICIO #${idx + 1}*\n\n` +
    `${iconPlataforma(s.plataforma || "")} *Plataforma:* ${escMD(humanPlataforma(s.plataforma || ""))}\n`;

  txt += renderCredencialesServicioLocal(s, true, "");
  txt += `🛒 *Compra:* ${cantidadPerfilesServicioLocal(s, c.nombrePerfil || "")} perfil(es) · un solo precio\n`;
  txt += `💰 *Precio:* ${escMD(`${Number(s.precio || 0).toFixed(2)} Lps`)}\n`;
  txt += `📅 *Renovación:* ${escMD(s.fechaRenovacion || "-")}\n📊 *Estado:* ${est.emoji} ${escMD(est.texto)}`;

  const kb = [
    [{ text: "👥 Gestionar perfiles", callback_data: `cli:prof:list:${clientId}:${compraSel}` }],
    [{ text: "➕ Añadir perfil a esta compra", callback_data: `cli:prof:add:${clientId}:${compraSel}` }],
    [{ text: "📌 Cambiar plataforma", callback_data: `cli:serv:edit:plat:${clientId}:${compraSel}` }],
    [{ text: `${getIdentLabelLocal(s.plataforma || "") === "Usuario" ? "👤" : "📧"} Cambiar acceso del perfil 1`, callback_data: `cli:serv:edit:mail:${clientId}:${compraSel}` }],
  ];

  const credBtns = [];
  if (requiereClaveLocal(s.plataforma || "")) credBtns.push({ text: "🔑 Cambiar clave", callback_data: `cli:serv:edit:clave:${clientId}:${compraSel}` });
  if (requierePinLocal(s.plataforma || "")) credBtns.push({ text: "🔐 Cambiar PIN", callback_data: `cli:serv:edit:pin:${clientId}:${compraSel}` });
  if (credBtns.length) kb.push(credBtns);
  kb.push([{ text: "💰 Cambiar precio", callback_data: `cli:serv:edit:precio:${clientId}:${compraSel}` }]);
  kb.push([{ text: "📅 Cambiar fecha renovación", callback_data: `cli:serv:edit:fecha:${clientId}:${compraSel}` }]);
  kb.push([{ text: "🗑️ Eliminar compra completa", callback_data: `cli:serv:del:ask:${clientId}:${compraSel}` }]);
  kb.push([{ text: "⬅️ Volver Servicios", callback_data: `cli:serv:list:${clientId}` }, { text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, kb);
}

async function menuListaPerfilesServicio(chatId, clientId, selector) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const idx = resolverIndiceCompraSelectorLocal(servicios, selector);
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
  const s = servicios[idx] || {};
  const compraSel = compraSelectorLocal(s, idx);
  const perfiles = perfilesServicioLocal(s, c.nombrePerfil || "");
  const kb = perfiles.map((p, pidx) => [{
    text: safeBtnLabel(`${pidx + 1}) ${p.nombre || "Perfil"} • ${p.correo || "sin acceso"}`),
    callback_data: `cli:prof:menu:${clientId}:${compraSel}:${perfilSelectorLocal(p, pidx)}`
  }]);
  kb.push([{ text: "➕ Añadir otro perfil", callback_data: `cli:prof:add:${clientId}:${compraSel}` }]);
  kb.push([{ text: "⬅️ Volver compra", callback_data: `cli:serv:menu:${clientId}:${compraSel}` }]);
  return upsertPanel(chatId,
    `👥 *PERFILES DE LA COMPRA*\n\n👤 Titular: *${escMD(c.nombrePerfil || "Cliente")}*\n📦 ${escMD(humanPlataforma(s.plataforma || ""))}\n💰 Un solo precio: *${escMD(Number(s.precio || 0).toFixed(2))} Lps*\n📅 Una sola renovación: *${escMD(s.fechaRenovacion || "-")}*\n\nSeleccione un perfil:`,
    kb
  );
}

async function menuPerfilServicio(chatId, clientId, compraSelector, perfilSelector) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const idx = resolverIndiceCompraSelectorLocal(servicios, compraSelector);
  const s = idx >= 0 ? servicios[idx] : null;
  if (!s) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
  const perfiles = perfilesServicioLocal(s, c.nombrePerfil || "");
  const perfilIndex = resolverIndicePerfilSelectorLocal(perfiles, perfilSelector);
  const p = perfilIndex >= 0 ? perfiles[perfilIndex] : null;
  if (!p) return bot.sendMessage(chatId, "⚠️ Ese perfil cambió o ya no existe. Abra nuevamente la compra.");
  const compraSel = compraSelectorLocal(s, idx);
  const perfilSel = perfilSelectorLocal(p, perfilIndex);
  const individual = servicioParaPerfilLocal(s, p, c.nombrePerfil || "");
  let txt = `👤 *PERFIL ${perfilIndex + 1} DE ${perfiles.length}*\n\n🙍 *Nombre:* ${escMD(p.nombre || "-")}\n📦 *Plataforma:* ${escMD(humanPlataforma(s.plataforma || ""))}\n`;
  txt += renderCredencialesServicioLocal(individual, true, "");
  txt += `\n💰 _El precio pertenece a toda la compra: ${escMD(Number(s.precio || 0).toFixed(2))} Lps._`;
  const kb = [
    [{ text: "👤 Cambiar nombre", callback_data: `cli:prof:edit:name:${clientId}:${compraSel}:${perfilSel}` }],
    [{ text: `📧 Cambiar ${getIdentLabelLocal(s.plataforma || "").toLowerCase()}`, callback_data: `cli:prof:edit:mail:${clientId}:${compraSel}:${perfilSel}` }]
  ];
  if (requiereClaveLocal(s.plataforma || "")) kb.push([{ text: "🔑 Cambiar clave", callback_data: `cli:prof:edit:key:${clientId}:${compraSel}:${perfilSel}` }]);
  if (requierePinLocal(s.plataforma || "")) kb.push([{ text: "🔐 Cambiar PIN individual", callback_data: `cli:prof:edit:pin:${clientId}:${compraSel}:${perfilSel}` }]);
  if (perfiles.length > 1) kb.push([{ text: "🗑️ Quitar este perfil", callback_data: `cli:prof:del:ask:${clientId}:${compraSel}:${perfilSel}` }]);
  kb.push([{ text: "⬅️ Volver perfiles", callback_data: `cli:prof:list:${clientId}:${compraSel}` }]);
  return upsertPanel(chatId, txt, kb);
}

// ===============================
// ESCRITURAS CRM (invalidan caché + registran historial)
// ===============================
function stableRefLocal(value = "", prefix = "r") {
  const str = String(value || "");
  let h1 = 2166136261 >>> 0, h2 = 2246822519 >>> 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 ^= c; h2 = Math.imul(h2, 3266489917) >>> 0;
  }
  return `${prefix}${h1.toString(36)}${h2.toString(36)}`.slice(0, 15);
}

function compraSelectorLocal(servicio = {}, idx = -1) {
  const id = String(servicio?.compraId || "").trim();
  return id ? stableRefLocal(id, "c") : String(idx);
}

function perfilSelectorLocal(perfil = {}, idx = -1) {
  const id = String(perfil?.perfilId || perfil?.id || "").trim();
  return id ? stableRefLocal(id, "p") : String(idx);
}

function resolverIndiceCompraSelectorLocal(servicios = [], selector = null) {
  const lista = Array.isArray(servicios) ? servicios : [];
  const raw = String(selector ?? "").trim();
  if (/^c[0-9a-z]+$/i.test(raw)) {
    const matches = [];
    lista.forEach((s, i) => {
      const id = String(s?.compraId || "").trim();
      if (id && stableRefLocal(id, "c") === raw) matches.push(i);
    });
    return matches.length === 1 ? matches[0] : -1;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < lista.length ? n : -1;
}

function resolverIndicePerfilSelectorLocal(perfiles = [], selector = null) {
  const lista = Array.isArray(perfiles) ? perfiles : [];
  const raw = String(selector ?? "").trim();
  if (/^p[0-9a-z]+$/i.test(raw)) {
    const matches = [];
    lista.forEach((p, i) => {
      const id = String(p?.perfilId || p?.id || "").trim();
      if (id && stableRefLocal(id, "p") === raw) matches.push(i);
    });
    return matches.length === 1 ? matches[0] : -1;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < lista.length ? n : -1;
}

function resolverIndiceCompraLocal(servicios = [], idx = null, compraId = "") {
  const lista = Array.isArray(servicios) ? servicios : [];
  const id = String(compraId || "").trim();
  if (id) {
    const porId = lista.findIndex((s) => String(s?.compraId || "").trim() === id);
    // compraId manda. Si fue proporcionado y no existe, no reutilizamos idx:
    // el array pudo cambiar de orden y ese índice podría ser otra compra.
    return porId;
  }
  const n = Number(idx);
  return Number.isInteger(n) && n >= 0 && n < lista.length ? n : -1;
}

async function mutarServiciosClienteTx(clientId, mutador) {
  const id = String(clientId || "").trim();
  if (!id) throw new Error("Cliente inválido.");
  if (typeof mutador !== "function") throw new Error("Cambio de servicios inválido.");
  const ref = db.collection(CLIENTES_COLLECTION).doc(id);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error("Cliente no encontrado.");
    const cliente = doc.data() || {};
    // Migración progresiva: al tocar cualquier ficha antigua aseguramos IDs
    // persistentes para todas sus compras y perfiles, sin cambiar sus datos.
    const servicios = (Array.isArray(cliente.servicios) ? cliente.servicios : []).map((servicio) => {
      const s = { ...(servicio || {}) };
      if (!String(s.compraId || "").trim()) s.compraId = recordIdLocal("compra");
      if (Array.isArray(s.perfiles) && s.perfiles.length) {
        s.perfiles = s.perfiles.map((perfil) => ({
          ...(perfil || {}),
          perfilId: String(perfil?.perfilId || perfil?.id || recordIdLocal("perfil"))
        }));
      } else {
        // Las fichas legacy de perfil único también necesitan perfilId estable.
        s.perfilId = String(s.perfilId || recordIdLocal("perfil"));
      }
      return s;
    });
    const resultado = await mutador({ cliente: { ...cliente, servicios }, servicios, ref });
    const siguientes = Array.isArray(resultado?.servicios) ? resultado.servicios : servicios;
    tx.set(ref, {
      servicios: siguientes,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { ...(resultado || {}), cliente, servicios: siguientes };
  });
}

async function addServicioTx(clientId, servicio = {}) {
  const id = String(clientId || "").trim();
  if (!id) throw new Error("Cliente inválido.");
  const servicioEntrada = {
    ...servicio,
    compraId: String(servicio.compraId || recordIdLocal("compra")),
    perfiles: Array.isArray(servicio.perfiles)
      ? servicio.perfiles.map((p) => ({ ...(p || {}), perfilId: String(p?.perfilId || recordIdLocal("perfil")) }))
      : servicio.perfiles
  };
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    const compra = normalizarCompraLocal(servicioEntrada, cliente.nombrePerfil || "", {});
    const precio = Number(servicioEntrada.precio || 0);
    const fechaRenovacion = String(servicioEntrada.fechaRenovacion || "").trim();
    if (!Number.isFinite(precio) || precio <= 0) throw new Error("Precio inválido.");
    if (!isFechaDMY(fechaRenovacion)) throw new Error("Fecha de renovación inválida.");
    compra.precio = precio;
    compra.fechaRenovacion = fechaRenovacion;
    validarCompraLocal(compra);
    const servicioIndex = servicios.length;
    servicios.push(compra);
    return { servicios, compra, servicioIndex, nombreTitular: cliente.nombrePerfil || "" };
  });
  const compra = resultado.compra;
  const plat = compra.plataforma;
  const precio = Number(compra.precio || 0);
  const fechaRenovacion = String(compra.fechaRenovacion || "");
  const sync = await sincronizarCompraInventarioSeguroLocal(null, compra, resultado.nombreTitular || "");

  cacheInvalidatePrefix(`clientes:doc:${id}`);

  // ✅ Registrar en historial
  await registrarEventoHistorial(id, {
    tipo: "servicio_agregado",
    descripcion: `Se agregó ${humanPlataforma(plat)} con ${compra.perfiles.length} perfil(es) y un solo precio`,
    plataforma: plat,
    correo: compra.correo,
    clave: compra.clave,
    pin: compra.pin,
    precio,
    fechaRenovacion,
  });

  return { ok: true, servicio: compra, servicioIndex: resultado.servicioIndex, totalPerfiles: compra.perfiles.length, sync };
}

async function patchServicio(clientId, idx, patch = {}, compraId = "") {
  const id = String(clientId || "").trim();
  const patchLimpio = { ...(patch || {}) };
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    const actualIdx = resolverIndiceCompraLocal(servicios, idx, compraId || patchLimpio.compraId);
    if (actualIdx === -1) throw new Error("Servicio inválido.");
    const actual = servicios[actualIdx] || {};
  if (Object.prototype.hasOwnProperty.call(patchLimpio, "precio")) {
    const n = Number(patchLimpio.precio || 0);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Precio inválido.");
    patchLimpio.precio = n;
  }
  if (Object.prototype.hasOwnProperty.call(patchLimpio, "fechaRenovacion")) {
    if (!isFechaDMY(String(patchLimpio.fechaRenovacion || ""))) throw new Error("Fecha inválida.");
  }

  const entrada = { ...actual, ...patchLimpio };
  if (Array.isArray(actual.perfiles) && actual.perfiles.length && !Object.prototype.hasOwnProperty.call(patchLimpio, "perfiles")) {
    entrada.perfiles = actual.perfiles.map((p) => ({ ...(p || {}) }));
    const principal = entrada.perfiles[0];
    if (Object.prototype.hasOwnProperty.call(patchLimpio, "correo")) principal.correo = patchLimpio.correo;
    if (Object.prototype.hasOwnProperty.call(patchLimpio, "clave")) principal.clave = patchLimpio.clave;
    if (Object.prototype.hasOwnProperty.call(patchLimpio, "pin") || Object.prototype.hasOwnProperty.call(patchLimpio, "pinPerfil")) principal.pin = patchLimpio.pinPerfil ?? patchLimpio.pin ?? "";
  }
  const siguiente = normalizarCompraLocal(entrada, cliente.nombrePerfil || "", actual);
  if (!esPlataformaValida(siguiente.plataforma)) throw new Error("Plataforma inválida.");
  const credencialesTocadas = ["plataforma", "correo", "clave", "pin", "pinPerfil", "perfiles"].some((k) => Object.prototype.hasOwnProperty.call(patchLimpio, k));
  if (credencialesTocadas) validarCompraLocal(siguiente);
    servicios[actualIdx] = siguiente;
    return { servicios, actual, siguiente, actualIdx, nombreTitular: cliente.nombrePerfil || "" };
  });
  const { actual, siguiente } = resultado;
  const firma = (servicio) => JSON.stringify({
    plataforma: normalizarPlataforma(servicio?.plataforma || ""),
    perfiles: perfilesServicioLocal(servicio, resultado.nombreTitular || "").map((p) => ({ nombre: normTxt(p.nombre), correo: p.correo, clave: p.clave, pin: p.pin }))
  });
  const sync = firma(actual) !== firma(siguiente)
    ? await sincronizarCompraInventarioSeguroLocal(actual, siguiente, resultado.nombreTitular || "")
    : { ok: true, omitido: true };

  cacheInvalidatePrefix(`clientes:doc:${id}`);

  // ✅ Registrar cambios relevantes en historial
  const cambios = [];
  if (patchLimpio.correo && patchLimpio.correo !== actual.correo)
    cambios.push(`Correo: ${actual.correo || "-"} → ${patchLimpio.correo}`);
  if (patchLimpio.clave !== undefined && patchLimpio.clave !== actual.clave)
    cambios.push(`Clave cambiada`);
  if (patchLimpio.pin !== undefined && patchLimpio.pin !== actual.pin)
    cambios.push(`PIN cambiado`);
  if (patchLimpio.precio !== undefined && patchLimpio.precio !== actual.precio)
    cambios.push(`Precio: ${Number(actual.precio || 0).toFixed(2)} → ${Number(patchLimpio.precio || 0).toFixed(2)} Lps`);
  if (patchLimpio.fechaRenovacion && patchLimpio.fechaRenovacion !== actual.fechaRenovacion)
    cambios.push(`Fecha: ${actual.fechaRenovacion || "-"} → ${patchLimpio.fechaRenovacion}`);
  if (patchLimpio.plataforma && normalizarPlataforma(patchLimpio.plataforma) !== normalizarPlataforma(actual.plataforma || ""))
    cambios.push(`Plataforma: ${humanPlataforma(actual.plataforma)} → ${humanPlataforma(patchLimpio.plataforma)}`);

  if (cambios.length) {
    await registrarEventoHistorial(id, {
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

  return { ok: true, servicio: siguiente, servicioIndex: resultado.actualIdx, sync };
}

async function addPerfilTx(clientId, idx, perfil = {}, compraId = "") {
  const id = String(clientId || "").trim();
  const perfilEntrada = {
    ...perfil,
    perfilId: String(perfil.perfilId || recordIdLocal("perfil"))
  };
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    const actualIdx = resolverIndiceCompraLocal(servicios, idx, compraId);
    if (actualIdx === -1) throw new Error("Servicio inválido.");
    const actual = servicios[actualIdx] || {};
    const perfiles = perfilesServicioLocal(actual, cliente.nombrePerfil || "");
    perfiles.push({
    perfilId: perfilEntrada.perfilId,
    nombre: String(perfil.nombre || perfil.perfil || "").trim(),
    perfil: String(perfil.perfil || perfil.nombre || "").trim(),
    correo: perfil.correo || "", clave: perfil.clave || "", pin: perfil.pinPerfil ?? perfil.pin ?? ""
  });
  const siguiente = normalizarCompraLocal({ ...actual, perfiles }, cliente.nombrePerfil || "", actual);
  validarCompraLocal(siguiente);
    servicios[actualIdx] = siguiente;
    return { servicios, actual, siguiente, actualIdx, nombreTitular: cliente.nombrePerfil || "" };
  });
  const sync = await sincronizarCompraInventarioSeguroLocal(resultado.actual, resultado.siguiente, resultado.nombreTitular || "");
  cacheInvalidatePrefix(`clientes:doc:${id}`);
  await registrarEventoHistorial(id, {
    tipo: "perfil_agregado", descripcion: `Se añadió ${perfil.nombre || "un perfil"} a la compra ${humanPlataforma(resultado.actual.plataforma || "")}`,
    plataforma: resultado.actual.plataforma || "", correo: perfil.correo || "", pin: perfil.pinPerfil ?? perfil.pin ?? ""
  });
  return { ok: true, servicio: resultado.siguiente, servicioIndex: resultado.actualIdx, perfilIndex: resultado.siguiente.perfiles.length - 1, sync };
}

async function patchPerfilTx(clientId, idx, perfilIndex, patch = {}, compraId = "", perfilId = "") {
  const id = String(clientId || "").trim();
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    const actualIdx = resolverIndiceCompraLocal(servicios, idx, compraId);
    if (actualIdx === -1) throw new Error("Servicio inválido.");
    const actual = servicios[actualIdx] || {};
    const perfiles = perfilesServicioLocal(actual, cliente.nombrePerfil || "");
    let actualPerfilIndex = Number(perfilIndex);
    const perfilIdBuscado = String(perfilId || "").trim();
    if (perfilIdBuscado) actualPerfilIndex = perfiles.findIndex((p) => String(p?.perfilId || "") === perfilIdBuscado);
    if (!Number.isInteger(actualPerfilIndex) || actualPerfilIndex < 0 || actualPerfilIndex >= perfiles.length) throw new Error("Perfil inválido.");
    perfiles[actualPerfilIndex] = { ...perfiles[actualPerfilIndex], ...patch };
    if (patch.nombre != null && patch.perfil == null) perfiles[actualPerfilIndex].perfil = patch.nombre;
    const siguiente = normalizarCompraLocal({ ...actual, perfiles }, cliente.nombrePerfil || "", actual);
  validarCompraLocal(siguiente);
    servicios[actualIdx] = siguiente;
    return { servicios, actual, siguiente, actualIdx, actualPerfilIndex, nombreTitular: cliente.nombrePerfil || "" };
  });
  const sync = await sincronizarCompraInventarioSeguroLocal(resultado.actual, resultado.siguiente, resultado.nombreTitular || "");
  cacheInvalidatePrefix(`clientes:doc:${id}`);
  await registrarEventoHistorial(id, {
    tipo: "perfil_editado", descripcion: `Se editó el perfil ${resultado.siguiente.perfiles[resultado.actualPerfilIndex]?.nombre || resultado.actualPerfilIndex + 1} de ${humanPlataforma(resultado.actual.plataforma || "")}`,
    plataforma: resultado.actual.plataforma || "", correo: resultado.siguiente.perfiles[resultado.actualPerfilIndex]?.correo || "", pin: resultado.siguiente.perfiles[resultado.actualPerfilIndex]?.pin || ""
  });
  return { ok: true, servicio: resultado.siguiente, servicioIndex: resultado.actualIdx, perfilIndex: resultado.actualPerfilIndex, sync };
}

async function eliminarPerfilTx(clientId, idx, perfilIndex, compraId = "", perfilId = "") {
  const id = String(clientId || "").trim();
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    const actualIdx = resolverIndiceCompraLocal(servicios, idx, compraId);
    if (actualIdx === -1) throw new Error("Servicio inválido.");
    const actual = servicios[actualIdx] || {};
    const perfiles = perfilesServicioLocal(actual, cliente.nombrePerfil || "");
  if (perfiles.length <= 1) throw new Error("Es el único perfil. Para quitarlo, elimine la compra completa.");
    let actualPerfilIndex = Number(perfilIndex);
    const perfilIdBuscado = String(perfilId || "").trim();
    if (perfilIdBuscado) actualPerfilIndex = perfiles.findIndex((p) => String(p?.perfilId || "") === perfilIdBuscado);
    if (!Number.isInteger(actualPerfilIndex) || actualPerfilIndex < 0 || actualPerfilIndex >= perfiles.length) throw new Error("Perfil inválido.");
    const eliminado = perfiles.splice(actualPerfilIndex, 1)[0];
    const siguiente = normalizarCompraLocal({ ...actual, perfiles }, cliente.nombrePerfil || "", actual);
    servicios[actualIdx] = siguiente;
    return { servicios, actual, siguiente, eliminado, actualIdx, actualPerfilIndex, nombreTitular: cliente.nombrePerfil || "" };
  });
  const sync = await sincronizarCompraInventarioSeguroLocal(resultado.actual, resultado.siguiente, resultado.nombreTitular || "");
  cacheInvalidatePrefix(`clientes:doc:${id}`);
  await registrarEventoHistorial(id, {
    tipo: "perfil_eliminado", descripcion: `Se quitó ${resultado.eliminado.nombre || "un perfil"} de la compra ${humanPlataforma(resultado.actual.plataforma || "")}`,
    plataforma: resultado.actual.plataforma || "", correo: resultado.eliminado.correo || "", pin: resultado.eliminado.pin || ""
  });
  return { ok: true, servicio: resultado.siguiente, servicioIndex: resultado.actualIdx, perfilIndex: resultado.actualPerfilIndex, eliminado: resultado.eliminado, sync };
}

async function sincronizarCuentaEnComprasTx({ plataforma = "", correo = "", nuevaClave, nuevoCorreo } = {}) {
  const plat = normalizarPlataforma(plataforma);
  const acceso = normalizeIdentByPlatformLocal(plat, correo);
  const snap = await db.collection(CLIENTES_COLLECTION).get();
  let perfilesActualizados = 0, documentosActualizados = 0;
  for (const doc of snap.docs) {
    const resultado = await db.runTransaction(async (tx) => {
      const actualDoc = await tx.get(doc.ref);
      if (!actualDoc.exists) return { changed: false, perfilesActualizados: 0 };
      const data = actualDoc.data() || {};
      const servicios = Array.isArray(data.servicios) ? data.servicios : [];
      let changed = false;
      let perfilesCambiados = 0;
      const next = servicios.map((servicio) => {
        if (normalizarPlataforma(servicio?.plataforma || "") !== plat) return servicio;
        const perfiles = Array.isArray(servicio?.perfiles) && servicio.perfiles.length ? servicio.perfiles : null;
        if (!perfiles) {
          if (normalizeIdentByPlatformLocal(plat, servicio?.correo || "") !== acceso) return servicio;
          const copy = { ...servicio };
          if (nuevoCorreo != null) copy.correo = normalizeIdentByPlatformLocal(plat, nuevoCorreo);
          if (nuevaClave != null) copy.clave = String(nuevaClave || "").trim();
          perfilesCambiados++;
          changed = true;
          return copy;
        }
        let localChanged = false;
        const nextProfiles = perfiles.map((perfil) => {
          if (normalizeIdentByPlatformLocal(plat, perfil?.correo ?? servicio?.correo ?? "") !== acceso) return perfil;
          const copy = { ...(perfil || {}) };
          if (nuevoCorreo != null) copy.correo = normalizeIdentByPlatformLocal(plat, nuevoCorreo);
          if (nuevaClave != null) copy.clave = String(nuevaClave || "").trim();
          perfilesCambiados++;
          localChanged = true;
          return copy;
        });
        if (!localChanged) return servicio;
        changed = true;
        const copy = { ...servicio, perfiles: nextProfiles };
        const principal = nextProfiles[0] || {};
        copy.correo = principal.correo || copy.correo || "";
        copy.clave = principal.clave != null ? principal.clave : copy.clave || "";
        return copy;
      });
      if (changed) {
        tx.set(doc.ref, {
          servicios: next,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      return { changed, perfilesActualizados: perfilesCambiados };
    });
    perfilesActualizados += Number(resultado.perfilesActualizados || 0);
    if (resultado.changed) {
      documentosActualizados++;
      cacheInvalidatePrefix(`clientes:doc:${doc.id}`);
    }
  }
  return { ok: true, perfilesActualizados, documentosActualizados };
}

// ===============================
// ✅ ELIMINAR SERVICIO (con limpieza de inventario + historial)
// ===============================
async function eliminarServicioTx(clientId, idx, compraId = "") {
  const id = String(clientId || "").trim();
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    const actualIdx = resolverIndiceCompraLocal(servicios, idx, compraId);
    if (actualIdx === -1) throw new Error("Servicio inválido.");
    const eliminado = servicios[actualIdx];
    servicios.splice(actualIdx, 1);
    return { servicios, eliminado, actualIdx, nombreTitular: cliente.nombrePerfil || "" };
  });
  const eliminado = resultado.eliminado;
  const sync = await sincronizarCompraInventarioSeguroLocal(eliminado, null, resultado.nombreTitular || "");
  cacheInvalidatePrefix(`clientes:doc:${id}`);

  // ✅ Registrar en historial
  await registrarEventoHistorial(id, {
    tipo: "servicio_eliminado",
    descripcion: `Se eliminó ${humanPlataforma(eliminado.plataforma || "")} con ${cantidadPerfilesServicioLocal(eliminado, resultado.nombreTitular || "")} perfil(es)`,
    plataforma: eliminado.plataforma || "",
    correo: eliminado.correo || "",
    clave: getClaveServicioLocal(eliminado, eliminado.plataforma || ""),
    pin: getPinServicioLocal(eliminado, eliminado.plataforma || ""),
    precio: eliminado.precio || 0,
    fechaRenovacion: eliminado.fechaRenovacion || "",
  });

  return { ok: true, eliminado, servicioIndex: resultado.actualIdx, nombreCliente: resultado.nombreTitular || "", sync };
}

async function renovarServicioTx(clientId, idx, { dias = 0, fechaExacta = "", compraId = "" } = {}) {
  const id = String(clientId || "").trim();
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    const actualIdx = resolverIndiceCompraLocal(servicios, idx, compraId);
    if (actualIdx === -1) throw new Error("Servicio inválido.");
    const anterior = servicios[actualIdx] || {};
    const fechaAnterior = String(anterior.fechaRenovacion || "");
    const fechaNueva = fechaExacta
      ? String(fechaExacta || "").trim()
      : addDaysDMY(isFechaDMY(fechaAnterior) ? fechaAnterior : hoyDMY(), Number(dias || 0));
    if (!isFechaDMY(fechaNueva)) throw new Error("Fecha inválida.");
    const siguiente = { ...anterior, fechaRenovacion: fechaNueva };
    servicios[actualIdx] = siguiente;
    return { servicios, anterior, siguiente, actualIdx, fechaAnterior, fechaNueva, nombreTitular: cliente.nombrePerfil || "" };
  });
  cacheInvalidatePrefix(`clientes:doc:${id}`);
  await registrarEventoHistorial(id, {
    tipo: "servicio_renovado",
    descripcion: `Se renovó ${humanPlataforma(resultado.siguiente.plataforma || "")}: ${resultado.fechaAnterior || "-"} → ${resultado.fechaNueva}`,
    plataforma: resultado.siguiente.plataforma || "",
    correo: resultado.siguiente.correo || "",
    fechaAnterior: resultado.fechaAnterior,
    fechaRenovacion: resultado.fechaNueva
  });
  return { ok: true, servicio: resultado.siguiente, servicioIndex: resultado.actualIdx, fechaAnterior: resultado.fechaAnterior, fechaNueva: resultado.fechaNueva };
}

async function renovarTodosServiciosTx(clientId, { dias = 0, fechaExacta = "" } = {}) {
  const id = String(clientId || "").trim();
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    if (!servicios.length) throw new Error("Este cliente no tiene servicios.");
    const siguientes = servicios.map((s) => {
      const base = isFechaDMY(String(s?.fechaRenovacion || "")) ? String(s.fechaRenovacion) : hoyDMY();
      const fechaNueva = fechaExacta ? String(fechaExacta || "").trim() : addDaysDMY(base, Number(dias || 0));
      if (!isFechaDMY(fechaNueva)) throw new Error("Fecha inválida.");
      return { ...(s || {}), fechaRenovacion: fechaNueva };
    });
    return { servicios: siguientes, total: siguientes.length, fechaExacta: String(fechaExacta || ""), nombreTitular: cliente.nombrePerfil || "" };
  });
  cacheInvalidatePrefix(`clientes:doc:${id}`);
  await registrarEventoHistorial(id, {
    tipo: "servicios_renovados",
    descripcion: `Se renovaron ${resultado.total} servicio(s)${resultado.fechaExacta ? ` a ${resultado.fechaExacta}` : ` por ${Number(dias || 0)} días`}`
  });
  return { ok: true, total: resultado.total, servicios: resultado.servicios };
}

async function eliminarServiciosTx(clientId, referencias = []) {
  const id = String(clientId || "").trim();
  const refs = (Array.isArray(referencias) ? referencias : []).map((r) =>
    typeof r === "number" ? { idx: r, compraId: "" } : { idx: Number(r?.idx), compraId: String(r?.compraId || "") }
  );
  if (!refs.length) throw new Error("No seleccionó servicios para eliminar.");
  const resultado = await mutarServiciosClienteTx(id, ({ cliente, servicios }) => {
    const indices = new Set();
    refs.forEach((r) => {
      const pos = resolverIndiceCompraLocal(servicios, r.idx, r.compraId);
      if (pos !== -1) indices.add(pos);
    });
    if (!indices.size) throw new Error("Los servicios seleccionados ya no existen.");
    const eliminados = [];
    [...indices].sort((a, b) => b - a).forEach((pos) => {
      eliminados.unshift(servicios[pos]);
      servicios.splice(pos, 1);
    });
    return { servicios, eliminados, nombreTitular: cliente.nombrePerfil || "" };
  });
  const sync = [];
  for (const servicio of resultado.eliminados) {
    sync.push(await sincronizarCompraInventarioSeguroLocal(servicio, null, resultado.nombreTitular || ""));
  }
  cacheInvalidatePrefix(`clientes:doc:${id}`);
  await registrarEventoHistorial(id, {
    tipo: "servicios_eliminados",
    descripcion: `Se eliminaron ${resultado.eliminados.length} servicio(s): ${resultado.eliminados.map((s) => humanPlataforma(s?.plataforma || "")).join(", ")}`
  });
  return { ok: true, eliminados: resultado.eliminados, servicios: resultado.servicios, sync };
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
    text: safeBtnLabel(`${iconPlataforma(s.plataforma || "")} ${humanPlataforma(s.plataforma || "")} · ${cantidadPerfilesServicioLocal(s, c.nombrePerfil || "")} perfil(es) — ${s.fechaRenovacion || "sin fecha"}`),
    callback_data: `cli:ren:one:${clientId}:${compraSelectorLocal(s, s.idxOriginal)}`,
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
async function menuRenovacionServicio(chatId, clientId, selector) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const idx = resolverIndiceCompraSelectorLocal(servicios, selector);
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");

  const s = servicios[idx];
  const compraSel = compraSelectorLocal(s, idx);
  const est = getEstadoServicio(s.fechaRenovacion || "");

  const txt =
    `🔄 *GESTIONAR RENOVACIÓN*\n\n` +
    `👤 *${escMD(c.nombrePerfil || "Cliente")}*\n` +
    `${iconPlataforma(s.plataforma || "")} *${escMD(humanPlataforma(s.plataforma || ""))}*\n` +
    renderCredencialesServicioLocal(s, true, "") +
    `💰 ${escMD(`${Number(s.precio || 0).toFixed(2)} Lps`)}\n` +
    `📅 Vence: ${escMD(s.fechaRenovacion || "-")} — ${est.emoji} ${escMD(est.texto)}\n\n` +
    `¿Qué pasó con este servicio?`;

  return upsertPanel(chatId, txt, [
    [
      { text: "✅ +30 días", callback_data: `cli:ren:auto:${clientId}:${compraSel}` },
      { text: "✅ +31 días", callback_data: `cli:ren:auto31:${clientId}:${compraSel}` },
    ],
    [{ text: "📅 Renovó — otra fecha", callback_data: `cli:ren:manual:${clientId}:${compraSel}` }],
    [{ text: "🔄 Cambió de servicio", callback_data: `cli:ren:cambio:${clientId}:${compraSel}` }],
    [{ text: "❌ No renovó — eliminar", callback_data: `cli:ren:noren:ask:${clientId}:${compraSel}` }],
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
  const totalPerfiles = rows.reduce((sum, x) => sum + Number(x.cantidadPerfiles || cantidadPerfilesServicioLocal(x, x.nombrePerfil || "")), 0);

  let txt =
    `📅 *RENOVACIONES DEL ${escMD(fecha)}*\n\n` +
    `*Compras a renovar:* ${rows.length}\n` +
    `*Perfiles incluidos:* ${totalPerfiles}\n` +
    `*Total esperado:* ${escMD(`${total.toFixed(2)} Lps`)}\n\n` +
    `Seleccione una compra para gestionar su renovación:`;

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

      const guardado = await addServicioTx(clientId, {
        plataforma: plat,
        correo: st.servicio.correo,
        clave: st.servicio.clave || "",
        pin: st.servicio.pin || "",
        perfiles: [{
          nombre: st.nombre, perfil: st.nombre, correo: st.servicio.correo,
          clave: st.servicio.clave || "", pin: st.servicio.pin || ""
        }],
        precio: st.servicio.precio,
        fechaRenovacion: st.servicio.fechaRenovacion,
      });

      wizard.set(String(chatId), { step: 4, clientId, nombre: st.nombre, telefono: st.telefono, vendedor: st.vendedor, servicio: {}, servStep: 1 });

      return bot.sendMessage(chatId, "✅ *Compra guardada correctamente*\n\nTiene un solo precio y una sola fecha. Si esta compra incluye a otra persona (por ejemplo, una promoción 2x1), añádala como perfil aquí:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "👥 Añadir otro perfil a esta compra", callback_data: `cli:prof:add:${clientId}:${guardado.servicioIndex}` }],
          [{ text: "➕ Agregar otro servicio distinto", callback_data: `wiz:addmore:${clientId}` }],
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
        perfiles: perfilesServicioLocal(s, c.nombrePerfil || ""),
        cantidadPerfiles: cantidadPerfilesServicioLocal(s, c.nombrePerfil || ""),
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

  const totalPerfiles = items.reduce((sum, x) => sum + Number(x.cantidadPerfiles || cantidadPerfilesServicioLocal(x, x.nombrePerfil || "")), 0);
  txt += `*Compras a renovar:* ${escMD(String(items.length))}\n`;
  txt += `*Perfiles incluidos:* ${escMD(String(totalPerfiles))}\n`;
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

  const totalPerfiles = items.reduce((sum, x) => sum + Number(x.cantidadPerfiles || cantidadPerfilesServicioLocal(x, x.nombrePerfil || "")), 0);
  txt += `Compras a renovar: ${items.length}\nPerfiles incluidos: ${totalPerfiles}\nTotal esperado: ${total.toFixed(2)} Lps\n\n`;

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
  // 🐛 FIX (ago-2026): iconPlataforma() se usaba en index_06_handlers.js
  // (botones "Mis renovaciones de hoy" / "en 3 días" y el aviso diario de
  // las 7 AM) pero nunca estuvo exportada aquí — cada vez que se llamaba
  // tiraba ReferenceError, atrapado en silencio por el try/catch de más
  // arriba, y el vendedor solo veía "⚠️ Error interno".
  iconPlataforma,
  humanPlataforma, renderFichaClienteMarkdown, serviciosConIndiceOriginal, dedupeClientes, clienteDuplicado,
  getCliente, buscarPorTelefonoTodos, buscarClienteRobusto,
  enviarFichaCliente, enviarFichaClienteVendedor, enviarListaResultadosClientes, menuEditarCliente,
  menuListaServicios, menuServicio,
  menuListaPerfilesServicio, menuPerfilServicio,
  patchServicio, addServicioTx, addPerfilTx, patchPerfilTx, eliminarPerfilTx, eliminarServicioTx,
  renovarServicioTx, renovarTodosServiciosTx, eliminarServiciosTx,
  removeServicioDeInventario, sincronizarCuentaEnComprasTx,
  menuListaRenovacion, menuRenovacionServicio, enviarPanelRenovacionesConAcciones,
  kbPlataformasWiz, wizardStart, wizardNext,
  clienteResumenTXT, reporteClientesTXTGeneral, reporteClientesSplitPorVendedorTXT,
  enviarHistorialClienteTXT, enviarHistorialClienteTXTReal,
  generarHistorialTXT, getHistorialCliente, registrarEventoHistorial,
  enviarMisClientes, enviarMisClientesTXT,
  obtenerRenovacionesPorFecha, renovacionesTexto, enviarTXT, enviarTXTATodosHoy,
  perfilesServicioLocal, cantidadPerfilesServicioLocal,
  compraSelectorLocal, perfilSelectorLocal, resolverIndiceCompraSelectorLocal, resolverIndicePerfilSelectorLocal,
};
