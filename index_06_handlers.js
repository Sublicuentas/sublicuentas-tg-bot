/* ✅ SUBLICUENTAS TG BOT — PARTE 6/6 FINAL OPTIMIZADA
   HANDLERS / COMANDOS / CALLBACKS / MESSAGE / AUTOTXT / HARDEN / HTTP
   -------------------------------------------------------------------
   ✅ MEJORAS INCLUIDAS:
   - BÚSQUEDA: texto libre activa búsqueda directa para admins
   - BÚSQUEDA: búsqueda parcial por nombre/vendedor/teléfono
   - ALERTAS: bug vencidos corregido (comparación yyyy-mm-dd)
   - ALERTAS: paginación 10 en 10 con ⬅️ Anterior / Siguiente ➡️
   - DASHBOARD: /dashboard y botón en menú principal
   - CACHÉ: roles y revendedores con invalidación tras cambios
   - invalidarCacheAdmins() / invalidarCacheRevendedores() en admin cmds
   - HISTORIAL REAL: uso de enviarHistorialClienteTXTReal
   - COMANDOS SIN SLASH: Atajos de texto directo
*/

const http = require("http");

const {
  bot,
  admin,
  db,
  TZ,
  PLATAFORMAS,
  FINANZAS_COLLECTION,
  CORE_STATE,
  SUPER_ADMIN,
  hardStopBot,
  releaseRuntimeLock,
  getCoreHealth,
} = require("./index_01_core");

const {
  isAdmin,
  isSuperAdmin,
  isVendedor,
  getRevendedorPorTelegramId,
  setTelegramIdToRevendedor,
  normalizeRevendedorDoc,
  panelMsgId,
  bindPanelFromCallback,
  upsertPanel: upsertPanelBase,
  wizard,
  pending,
  limpiarQuery,
  normalizarPlataforma,
  esPlataformaValida,
  isEmailLike,
  onlyDigits,
  logErr,
  escMD,
  isFechaDMY,
  parseMontoNumber,
  parseMonthInputToKey,
  parseFechaFinanceInput,
  getMonthKeyFromDMY,
  parseDMYtoTS,
  moneyLps,
  hoyDMY,
  enviarTxtComoArchivo,
  invalidarCacheAdmins,
  invalidarCacheRevendedores,
} = require("./index_02_utils_roles");

const {
  dedupeClientes,
  buscarPorTelefonoTodos,
  buscarClienteRobusto,
  enviarFichaCliente, enviarFichaClienteVendedor, renderFichaClienteMarkdown,
  enviarListaResultadosClientes,
  reporteClientesTXTGeneral,
  reporteClientesSplitPorVendedorTXT,
  obtenerRenovacionesPorFecha,
  renovacionesTexto,
  enviarTXT,
  enviarTXTATodosHoy,
  wizardStart,
  wizardNext,
  getCliente,
  clienteResumenTXT,
  enviarHistorialClienteTXT,
  enviarHistorialClienteTXTReal,
  kbPlataformasWiz,
  menuEditarCliente,
  menuListaServicios,
  menuServicio,
  patchServicio,
  addServicioTx,
  eliminarServicioTx,
  menuListaRenovacion,
  menuRenovacionServicio,
  enviarPanelRenovacionesConAcciones,
  serviciosConIndiceOriginal,
  clienteDuplicado,
} = require("./index_03_clientes_crm");

const {
  buscarInventarioPorCorreo,
  enviarInventarioPlataforma,
  enviarInventarioPlataformaEstado,
  mostrarStockGeneral,
  enviarSubmenuInventario,
  buscarCorreoInventarioPorPlatCorreo,
  mostrarMenuClientesCorreo,
  mostrarListaCorreosPlataforma,
  mostrarPanelCorreo,
  responderMenuCodigosNetflix,
  responderCodigoNetflix,
  getCapacidadCorreo,
  aplicarAutoLleno,
} = require("./index_04_inventario_correos");

const {
  menuPrincipal,
  menuVendedor,
  menuInventario,
  menuInventarioVideo,
  menuInventarioMusica,
  menuInventarioIptv,
  menuInventarioDisenoIA,
  menuClientes,
  menuPagos,
  menuAlertas,
  menuRenovaciones,
  menuFinRegistro,
  menuFinEliminarTipo,
  menuFinReportes,
  kbBancosFinanzas,
  kbBancosFinanzasEgreso,
  kbMotivosFinanzas,
  registrarIngresoTx,
  registrarEgresoTx,
  getMovimientosPorFecha,
  getMovimientosPorMes,
  getMovimientosPorRango,
  resumenFinanzasTextoPorFecha,
  resumenFinanzasTextoPorRango,
  resumenBancosMesTexto,
  resumenBancosFechaTexto,
  resumenBancosRangoTexto,
  detalleBancoRangoTexto,
  resumenTopPlataformasTexto,
  resumenTopPlataformasRangoTexto,
  resumenTopCombosRangoTexto,
  cierreCajaTexto,
  cierreCajaTextoRango,
  textoConfirmarEliminacionMovimiento,
  exportarFinanzasRangoExcel,
  eliminarMovimientoFinanzas,
  generarDashboard,
} = require("./index_05_finanzas_menus");

// ===============================
// HELPERS LOCALES / FALLBACKS
// ===============================
function hasRuntimeLock() {
  return CORE_STATE?.HAS_RUNTIME_LOCK === true || CORE_STATE?.runtimeLock === true;
}

function escapeRegex(txt = "") {
  return String(txt).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function limpiarComandoTexto(texto = "") {
  return String(texto || "").trim().replace(/^\/+/, "").toLowerCase();
}

function parseFechaFlexible(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "hoy") return hoyDMY();
  return parseFechaFinanceInput(s) || null;
}

// ✅ Valida que una fecha de finanzas no sea de un mes futuro
// Permite el mes actual y meses pasados, bloquea meses futuros
function validarFechaFinanzas(fecha) {
  if (!isFechaDMY(fecha)) return { ok: false, msg: "Fecha inválida. Use dd/mm/yyyy o escriba hoy." };
  const [dd, mm, yyyy] = fecha.split("/").map(Number);
  const hoy = new Date();
  const añoHoy = hoy.getFullYear();
  const mesHoy = hoy.getMonth() + 1;
  // Bloquear si el año es futuro, o si es el año actual pero mes futuro
  if (yyyy > añoHoy || (yyyy === añoHoy && mm > mesHoy)) {
    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    return {
      ok: false,
      msg: `⚠️ *Fecha futura detectada*\n\nEscribiste: *${fecha}*\nHoy estamos en: *${String(mesHoy).padStart(2,"0")}/${añoHoy}* (${meses[mesHoy-1]})\n\n¿Pusiste el mes equivocado? Corrígela y reenvía.`
    };
  }
  return { ok: true };
}

function addDaysDMY(baseDmy = "", days = 0) {
  if (!isFechaDMY(baseDmy)) return hoyDMY();
  const [dd, mm, yyyy] = String(baseDmy).split("/").map(Number);
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const y = String(dt.getUTCFullYear());
  return `${d}/${m}/${y}`;
}

function safeBtnLabelLocal(txt = "", max = 60) {
  const s = String(txt || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, 55).join("") + "...";
}

function platMetaLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (Array.isArray(PLATAFORMAS)) return {};
  return PLATAFORMAS[p] || {};
}

function getIdentLabelLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) return "Usuario";
  return "Correo";
}

function esSoloCorreoLocal(plataforma = "") {
  const cfg = platMetaLocal(plataforma);
  return cfg.requiereCorreo === true && cfg.requiereClave !== true && cfg.requierePin !== true;
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
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p)) {
    return v;
  }
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

function identIcon(plataforma = "") {
  return getIdentLabelLocal(plataforma) === "Usuario" ? "👤" : "📧";
}

const PLATFORM_KEYS = Array.isArray(PLATAFORMAS)
  ? PLATAFORMAS
  : Object.keys(PLATAFORMAS || {});

function normalizeTelegramIdLocal(value = "") {
  return String(value == null ? "" : value).trim();
}

function getSuperAdminIdsLocal() {
  const raw = String(SUPER_ADMIN || "").trim();
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((x) => normalizeTelegramIdLocal(x))
        .filter(Boolean)
    )
  );
}

// ✅ Lista de admins en memoria — se carga al arrancar y se refresca cada 10 min
// Evita hits a Firestore en cada mensaje
const _adminIds = global.__SUBLICUENTAS_ADMIN_IDS__ =
  global.__SUBLICUENTAS_ADMIN_IDS__ || new Set();
let _adminIdsLoaded = global.__SUBLICUENTAS_ADMIN_IDS_LOADED__ || false;
let _adminIdsLoading = false;

async function cargarAdminIds() {
  if (_adminIdsLoading) return;
  _adminIdsLoading = true;
  try {
    const snap = await db.collection("admins").get();
    snap.forEach(doc => {
      const d = doc.data() || {};
      const id = String(doc.id).trim();
      // ✅ Solo IDs numéricos válidos de Telegram (ignorar docs basura como "user_id")
      if (d.activo !== false && /^\d+$/.test(id)) _adminIds.add(id);
    });
    _adminIdsLoaded = true;
    global.__SUBLICUENTAS_ADMIN_IDS_LOADED__ = true;
    global.__SUBLICUENTAS_ADMIN_IDS__ = _adminIds;
    console.log(`✅ Admins cargados: ${[..._adminIds].join(", ")}`);
    // Refrescar cada 10 minutos
    setTimeout(() => {
      _adminIdsLoaded = false;
      global.__SUBLICUENTAS_ADMIN_IDS_LOADED__ = false;
      _adminIdsLoading = false;
      cargarAdminIds().catch(() => {});
    }, 10 * 60 * 1000);
  } catch (e) {
    logErr("cargarAdminIds", e?.message || e);
    _adminIdsLoading = false;
    // Reintentar en 30 segundos si falla
    setTimeout(() => cargarAdminIds().catch(() => {}), 30 * 1000);
  }
}

// Cargar admins al iniciar (no bloquea el arranque)
if (!_adminIdsLoaded) cargarAdminIds().catch(e => logErr("cargarAdminIds:init", e?.message || e));

async function safeIsSuperAdminLocal(userId) {
  const uid = normalizeTelegramIdLocal(userId);
  if (!uid) return false;

  // Verificar contra lista en memoria (instantáneo)
  if (_adminIds.has(uid)) {
    try {
      const doc = await db.collection("admins").doc(uid).get();
      if (doc.exists) {
        const d = doc.data() || {};
        if (d.activo !== false && (d.superAdmin === true || d.superadmin === true || d.rol === "superadmin")) return true;
      }
    } catch (_) {}
  }

  try { if (await isSuperAdmin(userId)) return true; } catch (_) {}
  if (getSuperAdminIdsLocal().includes(uid)) return true;
  return false;
}

async function safeIsAdminLocal(userId) {
  const uid = normalizeTelegramIdLocal(userId);
  if (!uid) return false;

  // ✅ Si la lista ya cargó, verificar instantáneamente sin Firestore
  if (_adminIdsLoaded && _adminIds.has(uid)) return true;

  // Si aún no cargó, esperar hasta 3 segundos a que cargue
  if (!_adminIdsLoaded) {
    let waited = 0;
    while (!_adminIdsLoaded && waited < 3000) {
      await new Promise(r => setTimeout(r, 200));
      waited += 200;
    }
    if (_adminIdsLoaded && _adminIds.has(uid)) return true;
  }

  // Fallback: consulta directa a Firestore
  try { if (await isAdmin(userId)) return true; } catch (_) {}
  try {
    const doc = await db.collection("admins").doc(uid).get();
    if (doc.exists && (doc.data() || {}).activo !== false) {
      _adminIds.add(uid); // Agregar a la lista para próximas veces
      return true;
    }
  } catch (e) {
    logErr("safeIsAdminLocal:doc", e?.message || e);
  }

  return false;
}

async function safeGetRevendedorLocal(userId) {
  const uid = normalizeTelegramIdLocal(userId);
  if (!uid) return null;

  try {
    const rev = await getRevendedorPorTelegramId(userId);
    if (rev && typeof rev === "object") {
      return typeof normalizeRevendedorDoc === "function" ? normalizeRevendedorDoc(rev) : rev;
    }
  } catch (e) {
    logErr("safeGetRevendedorLocal:getRevendedorPorTelegramId", e?.stack || e?.message || e);
  }

  try {
    const snap = await db.collection("revendedores").get();
    let found = null;

    snap.forEach((d) => {
      if (found) return;
      const data = d.data() || {};
      const tg = normalizeTelegramIdLocal(data.telegramId || data.telegramID || data.userId || "");
      if (tg === uid) {
        found = { id: d.id, ...data };
      }
    });

    if (found) {
      return typeof normalizeRevendedorDoc === "function" ? normalizeRevendedorDoc(found) : found;
    }
  } catch (e) {
    logErr("safeGetRevendedorLocal:fallback", e?.stack || e?.message || e);
  }

  return null;
}

async function safeIsVendedorLocal(userId) {
  const uid = normalizeTelegramIdLocal(userId);
  if (!uid) return false;

  try {
    if (await isVendedor(userId)) return true;
  } catch (e) {
    logErr("safeIsVendedorLocal:isVendedor", e?.stack || e?.message || e);
  }

  const rev = await safeGetRevendedorLocal(uid);
  return !!(rev && rev.nombre);
}

async function getActiveAdminIdsLocal() {
  const ids = new Set(getSuperAdminIdsLocal());

  try {
    const snap = await db.collection("admins").get();
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.activo === false) return;

      ids.add(normalizeTelegramIdLocal(d.id));

      const tg = normalizeTelegramIdLocal(data.telegramId || data.telegramID || data.userId || "");
      if (tg) ids.add(tg);
    });
  } catch (e) {
    logErr("getActiveAdminIdsLocal", e?.stack || e?.message || e);
  }

  return Array.from(ids).filter(Boolean);
}

async function getActiveRevendedoresLocal() {
  const out = [];
  try {
    const snap = await db.collection("revendedores").get();
    snap.forEach((d) => {
      const data = d.data() || {};
      const telegramId = normalizeTelegramIdLocal(data.telegramId || data.telegramID || data.userId || "");
      if (!data.activo || !data.nombre || !telegramId) return;
      out.push({ id: d.id, ...data, telegramId });
    });
  } catch (e) {
    logErr("getActiveRevendedoresLocal", e?.stack || e?.message || e);
  }
  return out;
}

async function answerCallbackSilentlySafe(q) {
  try {
    if (q?.id) await bot.answerCallbackQuery(q.id);
  } catch (_) {}
}

function resetChatState(chatId) {
  try { pending?.delete?.(String(chatId)); } catch (_) {}
  try { panelMsgId?.delete?.(String(chatId)); } catch (_) {}
  // ✅ NO borrar wizard aquí — se borra solo en go:inicio o al finalizar
}

function resetChatStateFull(chatId) {
  try { pending?.delete?.(String(chatId)); } catch (_) {}
  try { wizard?.delete?.(String(chatId)); } catch (_) {}
  try { panelMsgId?.delete?.(String(chatId)); } catch (_) {}
}

function clearFlowStateKeepPanel(chatId) {
  try { pending?.delete?.(String(chatId)); } catch (_) {}
  try { wizard?.delete?.(String(chatId)); } catch (_) {}
  // Modo app: no borrar panelMsgId para que el menú edite la misma pantalla.
}

// ✅ DEBOUNCE: evita procesar múltiples "menu" rápidos del mismo chat
const menuDebounce = global.__SUBLICUENTAS_MENU_DEBOUNCE__ =
  global.__SUBLICUENTAS_MENU_DEBOUNCE__ || new Map();

function isMenuDebounced(chatId) {
  const key = String(chatId);
  const last = menuDebounce.get(key) || 0;
  const now = Date.now();
  if (now - last < 2000) return true; // bloqueado si < 2 segundos
  menuDebounce.set(key, now);
  return false;
}

function forceNextPanelAtBottom(chatId) {
  try { panelMsgId?.delete?.(String(chatId)); } catch (_) {}
}



async function sendBottomMainMenu(chatId, userId, fromText = false) {
  // ✅ DEBOUNCE: si ya se abrió el menú en los últimos 2s, ignorar silenciosamente
  if (fromText && isMenuDebounced(chatId)) return null;
  try {
    if (fromText) forceNextPanelAtBottom(chatId);
    clearFlowStateKeepPanel(chatId);

    if (await safeIsAdminLocal(userId)) {
      const texto = "📊 *CENTRO DE OPERACIONES*\n\nSublicuentas — Conectamos su entretenimiento\n\nSeleccione una opción:";
      return upsertPanel(chatId, texto, [
        [
          { text: "🎯 Control cuentas", callback_data: "menu:inventario" },
          { text: "👥 Clientes", callback_data: "menu:clientes" },
        ],
        [
          { text: "💰 Control financiero", callback_data: "menu:pagos" },
          { text: "🚨 Riesgos", callback_data: "menu:alertas" },
        ],
        [
          { text: "📊 Análisis", callback_data: "menu:dashboard" },
          { text: "👤 Revendedores", callback_data: "menu:revendedores" },
        ],
      ], "Markdown");
    } else if (await safeIsVendedorLocal(userId)) {
      return upsertPanel(chatId, "👤 *MENÚ VENDEDOR*\n\nSeleccione una opción:", [
        [{ text: "📅 Mis renovaciones hoy",  callback_data: "ren:mis:hoy" },      { text: "⏳ Próximos 3 días",      callback_data: "ren:mis:prox3" }],
        [{ text: "📄 TXT renovaciones",      callback_data: "txt:mis" },           { text: "👥 Mis clientes",         callback_data: "vend:clientes" }],
        [{ text: "🧾 TXT mis clientes",      callback_data: "vend:clientes:txt" }, { text: "💰 Mi resumen del mes",   callback_data: "vend:resumen" }],
        [{ text: "🔴 Mis vencidos",          callback_data: "vend:vencidos" }],
        [{ text: "🔍 Buscar cliente",          callback_data: "vend:buscar" }],
      ], "Markdown");
    } else {
      return bot.sendMessage(chatId, "⛔ Acceso denegado");
    }
  } catch (err) {
    logErr("sendBottomMainMenu", err?.stack || err?.message || err);
    return bot.sendMessage(chatId, "⚠️ Error interno al abrir el menú.");
  }
}

function normalizeLooseText(txt = "") {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normVendorText(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeFileNameLocal(v = "", fallback = "archivo") {
  const s = String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return s || fallback;
}

function formatearBloqueRenovaciones(rows = [], titulo = "") {
  const items = Array.isArray(rows) ? rows : [];
  let txt = "";
  txt += "==============================\n";
  txt += `${titulo}\n`;
  txt += "==============================\n";

  if (!items.length) {
    txt += "Sin registros.\n\n";
    return txt;
  }

  items.forEach((x, i) => {
    txt += `${i + 1}) ${x.nombrePerfil || "Sin nombre"}\n`;
    txt += `Telefono: ${x.telefono || "-"}\n`;
    txt += `Plataforma: ${x.plataforma || "-"}\n`;
    txt += `${getIdentLabelLocal(x.plataforma || "")}: ${x.correo || "-"}\n`;
    txt += `PIN: ${x.pin || "-"}\n`;
    txt += `Precio: ${Number(x.precio || 0).toFixed(2)} Lps\n`;
    txt += `Fecha: ${x.fechaRenovacion || "-"}\n`;
    txt += `\n`;
  });

  return txt;
}

function generarTxtRenovacionesPro(vendedorNombre = "", fechaHoy = "", fechaMas3 = "", rowsHoy = [], rowsMas3 = []) {
  let txt = "";
  txt += `RENOVACIONES - ${vendedorNombre}\n`;
  txt += `FECHA DE ENVIO: ${fechaHoy}\n\n`;

  if (rowsMas3.length) {
    txt += formatearBloqueRenovaciones(rowsMas3, `⏳ VENCEN EN 3 DIAS (${fechaMas3})`);
  }

  if (rowsHoy.length) {
    txt += formatearBloqueRenovaciones(rowsHoy, `📅 VENCEN HOY (${fechaHoy})`);
  }

  return txt.trim() + "\n";
}

async function enviarTxtRenovacionesVendedorPro(chatId, vendedorNombre = "") {
  const fechaHoy = hoyDMY();
  const fechaMas3 = addDaysDMY(fechaHoy, 3);

  const rowsHoy = await obtenerRenovacionesPorFecha(fechaHoy, vendedorNombre);
  const rowsMas3 = await obtenerRenovacionesPorFecha(fechaMas3, vendedorNombre);

  if (!rowsHoy.length && !rowsMas3.length) {
    return false;
  }

  const contenido = generarTxtRenovacionesPro(vendedorNombre, fechaHoy, fechaMas3, rowsHoy, rowsMas3);
  const nombre = `renovaciones_${safeFileNameLocal(vendedorNombre, "vendedor")}_${fechaHoy.replace(/\//g, "-")}.txt`;
  await enviarTxtComoArchivo(chatId, contenido, nombre);
  return true;
}

async function enviarTxtRenovacionesAdminPro(chatId) {
  const fechaHoy = hoyDMY();
  const fechaMas3 = addDaysDMY(fechaHoy, 3);

  const rowsHoy = await obtenerRenovacionesPorFecha(fechaHoy, null);
  const rowsMas3 = await obtenerRenovacionesPorFecha(fechaMas3, null);

  if (!rowsHoy.length && !rowsMas3.length) {
    return false;
  }

  const contenido = generarTxtRenovacionesPro("GENERAL", fechaHoy, fechaMas3, rowsHoy, rowsMas3);
  const nombre = `renovaciones_general_${fechaHoy.replace(/\//g, "-")}.txt`;
  await enviarTxtComoArchivo(chatId, contenido, nombre);
  return true;
}

async function enviarResumenVendedorPro(chatId, vendedorNombre = "") {
  const fechaHoy = hoyDMY();
  const fechaMas3 = addDaysDMY(fechaHoy, 3);
  const hoyTs = parseDMYtoTS(fechaHoy);

  const snap = await db.collection("clientes").get();

  let clientesActivos = 0;
  let renovacionesHoy = 0;
  let renovacionesMas3 = 0;
  let vencidas = 0;
  let totalMensual = 0;

  snap.forEach((d) => {
    const c = d.data() || {};
    if (normVendorText(c.vendedor || "") !== normVendorText(vendedorNombre || "")) return;

    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    if (servicios.length) clientesActivos++;

    servicios.forEach((s) => {
      const fecha = String(s.fechaRenovacion || "").trim();
      const ts = parseDMYtoTS(fecha);

      totalMensual += Number(s.precio || 0);

      if (fecha === fechaHoy) renovacionesHoy++;
      if (fecha === fechaMas3) renovacionesMas3++;
      if (ts && ts < hoyTs) vencidas++;
    });
  });

  let txt = "💰 *MI RESUMEN*\n\n";
  txt += `👤 *Vendedor:* ${escMD(vendedorNombre || "-")}\n`;
  txt += `👥 *Clientes activos:* ${clientesActivos}\n`;
  txt += `📅 *Renovaciones hoy:* ${renovacionesHoy}\n`;
  txt += `⏳ *Renovaciones en 3 días:* ${renovacionesMas3}\n`;
  txt += `🔴 *Vencidas:* ${vencidas}\n`;
  txt += `💵 *Total mensual estimado:* ${escMD(Number(totalMensual || 0).toFixed(2))} Lps`;

  return upsertPanel(chatId, txt, [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]);
}

function getClienteEstadoCRM(c = {}) {
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const hoyTs = parseDMYtoTS(hoyDMY());

  for (const s of servicios) {
    const fecha = String(s.fechaRenovacion || "").trim();
    const ts = parseDMYtoTS(fecha);
    if (ts && ts >= hoyTs) return "vigente";
  }

  return "no_vigente";
}

async function getClientesRowsLocal() {
  const snap = await db.collection("clientes").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function enviarAgendaSimpleClientesTXT(chatId) {
  const rows = await getClientesRowsLocal();
  rows.sort((a, b) => normVendorText(a.nombrePerfil || "").localeCompare(normVendorText(b.nombrePerfil || ""), "es"));

  let vigentes = 0;
  let noVigentes = 0;
  let txt = "CLIENTES - AGENDA SIMPLE\n\n";

  rows.forEach((c, i) => {
    const estado = getClienteEstadoCRM(c);
    const etiqueta = estado === "vigente" ? "Vigente" : "No vigente";
    if (estado === "vigente") vigentes++;
    else noVigentes++;
    txt += `${i + 1}) ${c.nombrePerfil || "Sin nombre"} | ${c.telefono || "-"} | ${etiqueta}\n`;
  });

  txt += `\nTotal clientes: ${rows.length}\n`;
  txt += `Vigentes: ${vigentes}\n`;
  txt += `No vigentes: ${noVigentes}\n`;

  return enviarTxtComoArchivo(chatId, txt, `clientes_agenda_simple_${hoyDMY().replace(/\//g, "-")}.txt`);
}

async function enviarClientesPorEstadoTXT(chatId, targetState = "vigente") {
  const rows = await getClientesRowsLocal();
  const filtered = rows
    .filter((c) => getClienteEstadoCRM(c) === targetState)
    .sort((a, b) => normVendorText(a.nombrePerfil || "").localeCompare(normVendorText(b.nombrePerfil || ""), "es"));

  const titulo = targetState === "vigente" ? "CLIENTES VIGENTES" : "CLIENTES NO VIGENTES";
  let txt = `${titulo}\n\n`;

  if (!filtered.length) {
    txt += "Sin registros.\n";
  } else {
    filtered.forEach((c, i) => {
      txt += `${i + 1}) ${c.nombrePerfil || "Sin nombre"} | ${c.telefono || "-"} | ${c.vendedor || "-"}\n`;
    });
  }

  txt += `\nTotal: ${filtered.length}\n`;

  const nombre = targetState === "vigente"
    ? `clientes_vigentes_${hoyDMY().replace(/\//g, "-")}.txt`
    : `clientes_no_vigentes_${hoyDMY().replace(/\//g, "-")}.txt`;

  return enviarTxtComoArchivo(chatId, txt, nombre);
}

async function enviarResumenCRMLocal(chatId) {
  const rows = await getClientesRowsLocal();

  let vigentes = 0;
  let noVigentes = 0;
  let totalMensual = 0;
  let conTelefono = 0;

  for (const c of rows) {
    if (String(c.telefono || "").trim()) conTelefono++;
    const estado = getClienteEstadoCRM(c);
    if (estado === "vigente") vigentes++;
    else noVigentes++;

    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    for (const s of servicios) totalMensual += Number(s.precio || 0);
  }

  let txt = "📊 *RESUMEN CRM*\n\n";
  txt += `👥 *Total clientes:* ${rows.length}\n`;
  txt += `📱 *Con teléfono:* ${conTelefono}\n`;
  txt += `🟢 *Vigentes:* ${vigentes}\n`;
  txt += `🔴 *No vigentes:* ${noVigentes}\n`;
  txt += `💰 *Total mensual estimado:* ${escMD(Number(totalMensual || 0).toFixed(2))} Lps`;

  return upsertPanel(chatId, txt, [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]);
}

// ===============================
// ✅ FIX: buscarClientesFallbackLocal con búsqueda parcial
// ===============================
async function buscarClientesFallbackLocal(query = "") {
  const qRaw = String(query || "").trim();
  const qNorm = normalizeLooseText(qRaw);
  const qDigits = onlyDigits(qRaw);

  if (!qNorm && !qDigits) return [];
  if (isEmailLike(qRaw)) return [];

  const out = new Map();

  // Scan completo con búsqueda parcial (incluye en nombre_norm o vendedor_norm)
  try {
    const snap = await db.collection("clientes").get();
    snap.forEach((doc) => {
      const x = doc.data() || {};
      const nombreNorm = normalizeLooseText(x.nombrePerfil || x.nombre_norm || "");
      const vendedorNorm = normalizeLooseText(x.vendedor || x.vendedor_norm || "");
      const telefonoDigits = onlyDigits(x.telefono || x.telefono_norm || "");

      let match = false;

      if (qDigits && qDigits.length >= 4 && telefonoDigits.includes(qDigits)) {
        match = true;
      }

      if (!match && qNorm && qNorm.length >= 2) {
        if (nombreNorm.includes(qNorm)) match = true;
        if (!match && vendedorNorm.includes(qNorm)) match = true;
      }

      if (match && !out.has(doc.id)) {
        out.set(doc.id, { id: doc.id, ...(x || {}) });
      }
    });
  } catch (e) {
    logErr("buscarClientesFallbackLocal:scan", e?.stack || e?.message || e);
  }

  return Array.from(out.values()).slice(0, 30);
}

// ===============================
// ✅ FIX: resolverBusquedaAdmin sin return prematuro
// ===============================

function isNavigationTextLocal(text = "") {
  const s = String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return new Set([
    "menu",
    "menú",
    "/menu",
    "inicio",
    "/inicio",
    "start",
    "/start",
    "volver",
    "atras",
    "atrás",
    "cancelar",
    "cancel",

    // etiquetas del menú principal: no deben disparar búsqueda
    "alertas",
    "riesgos",
    "clientes",
    "cliente",
    "clientes crm",
    "crm",
    "finanzas",
    "control financiero",
    "inventario",
    "control cuentas",
    "dashboard",
    "analisis",
    "análisis",
  ]).has(s);
}

async function resolverBusquedaAdmin(chatId, query = "") {
  const q = String(query || "").trim().replace(/^\/+/, "").trim();
  if (!q) return bot.sendMessage(chatId, "⚠️ Escriba algo para buscar.");
  if (isNavigationTextLocal(q)) return;

  const qDigits = onlyDigits(q);
  const qNorm = normalizeLooseText(q);
  const isMail = isEmailLike(q);

  if ((!qNorm || qNorm.length < 2) && (!qDigits || qDigits.length < 7) && !isMail) {
    return bot.sendMessage(chatId, "⚠️ Escriba al menos 2 letras o 7 dígitos para buscar.");
  }

  // 1) Buscar en inventario por correo/usuario (solo si parece email o es muy corto sin dígitos)
  if (isMail || (!qDigits.length && qNorm.includes("@"))) {
    let hits = [];
    try {
      hits = await buscarInventarioPorCorreo(q);
    } catch (_) {}

    if (hits.length === 1) {
      pending.set(String(chatId), {
        mode: "invSubmenuCtx",
        plat: normalizarPlataforma(hits[0].plataforma),
        correo: q,
      });
      return enviarSubmenuInventario(chatId, hits[0].plataforma, q);
    }

    if (hits.length > 1) {
      const kb = hits.map((x) => [
        {
          text: `📌 ${String(x.plataforma).toUpperCase()}`,
          callback_data: `inv:open:${normalizarPlataforma(x.plataforma)}:${encodeURIComponent(q)}`,
        },
      ]);
      kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

      return bot.sendMessage(chatId, `🔎 *Coincidencias de inventario*\n\nAcceso: ${escMD(q)}\nSeleccione plataforma:`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: kb },
      });
    }

    // Email no encontrado en inventario → sin resultados
    return bot.sendMessage(chatId, "⚠️ Sin resultados.");
  }

  // 2) Buscar por teléfono (sólo dígitos largos)
  if (qDigits.length >= 7) {
    const resultados = await buscarPorTelefonoTodos(q);
    const dedup = dedupeClientes(resultados);
    if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
    if (dedup.length > 1) return enviarListaResultadosClientes(chatId, dedup);
    // No encontrado por teléfono → continuar a búsqueda por texto
  }

  // 3) Buscar clientes por texto (nombre, vendedor, plataforma, etc.)
  let resultados = [];
  try {
    resultados = await buscarClienteRobusto(q);
  } catch (_) {
    resultados = [];
  }

  if (!Array.isArray(resultados)) resultados = [];

  // 4) Fallback parcial si buscarClienteRobusto no encontró nada
  let extra = [];
  if (!resultados.length) {
    extra = await buscarClientesFallbackLocal(q);
  }

  const dedup = dedupeClientes([...resultados, ...extra]);

  if (!dedup.length) {
    // 5) Último intento: buscar en inventario (por si es usuario IPTV o correo parcial)
    let invHits = [];
    try {
      invHits = await buscarInventarioPorCorreo(q);
    } catch (_) {}

    if (invHits.length === 1) {
      pending.set(String(chatId), {
        mode: "invSubmenuCtx",
        plat: normalizarPlataforma(invHits[0].plataforma),
        correo: q,
      });
      return enviarSubmenuInventario(chatId, invHits[0].plataforma, q);
    }

    if (invHits.length > 1) {
      const kb = invHits.map((x) => [
        {
          text: `📌 ${String(x.plataforma).toUpperCase()}`,
          callback_data: `inv:open:${normalizarPlataforma(x.plataforma)}:${encodeURIComponent(q)}`,
        },
      ]);
      kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
      return bot.sendMessage(chatId, `🔎 *Coincidencias de inventario*\n\nAcceso: ${escMD(q)}\nSeleccione plataforma:`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: kb },
      });
    }

    return bot.sendMessage(chatId, "⚠️ Sin resultados.");
  }

  if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
  return enviarListaResultadosClientes(chatId, dedup);
}

async function upsertPanel(chatId, text, keyboardArg = [], parseMode = "Markdown") {
  try {
    let keyboard = [];

    if (Array.isArray(keyboardArg)) {
      keyboard = keyboardArg;
    } else if (keyboardArg && Array.isArray(keyboardArg.inline_keyboard)) {
      keyboard = keyboardArg.inline_keyboard;
    } else if (keyboardArg && keyboardArg.reply_markup && Array.isArray(keyboardArg.reply_markup.inline_keyboard)) {
      keyboard = keyboardArg.reply_markup.inline_keyboard;
    }

    return await upsertPanelBase(chatId, text, keyboard, parseMode);
  } catch (e) {
    logErr("upsertPanel.wrapper", e);
    throw e;
  }
}

async function userHasAccessFromMessage(msg) {
  const userId = msg?.from?.id;
  const chatId = msg?.chat?.id;
  if (!chatId || !userId) return false;

  if (await safeIsAdminLocal(userId)) return true;
  if (await safeIsVendedorLocal(userId)) return true;

  try {
    await bot.sendMessage(chatId, "⛔ Acceso denegado");
  } catch (_) {}
  return false;
}

async function userHasAccessById(chatId, userId) {
  if (!chatId || !userId) return false;
  if (await safeIsAdminLocal(userId)) return true;
  if (await safeIsVendedorLocal(userId)) return true;
  try {
    await bot.sendMessage(chatId, "⛔ Acceso denegado");
  } catch (_) {}
  return false;
}

async function linkRevendedorByNombre(nombre = "", telegramId = "") {
  const nombreNorm = String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");

  const snap = await db.collection("revendedores").get();
  let foundId = null;

  snap.forEach((d) => {
    const data = d.data() || {};
    const nom = String(data.nombre || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .replace(/\s+/g, " ");
    if (nom === nombreNorm) foundId = d.id;
  });

  if (!foundId) {
    return { ok: false, msg: "⚠️ No encontré ese vendedor para vincular." };
  }

  await setTelegramIdToRevendedor(foundId, telegramId);
  return { ok: true, msg: "✅ Vendedor vinculado correctamente." };
}

function textoBtnEliminarMovimiento(m = {}) {
  const tipo = String(m.tipo || "").toLowerCase();
  const fecha = String(m.fecha || "-");
  const monto = moneyLps(m.monto || 0);

  const concepto =
    tipo === "egreso"
      ? String(m.motivo || m.descripcion || "Egreso").trim()
      : String(m.plataforma || m.descripcion || "Ingreso").trim();

  const banco = String(m.banco || "").trim();
  const detalle = String(m.detalle || "").trim();

  const partes = [`${fecha}`, `${monto}`, concepto];

  if (tipo === "ingreso") {
    if (detalle) partes.push(detalle);
    if (banco) partes.push(banco);
  } else {
    if (detalle) partes.push(detalle);
  }

  return safeBtnLabelLocal(partes.join(" • "), 60);
}

async function listarRevendedores(chatId) {
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay revendedores.");

  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  all.sort((a, b) =>
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" })
  );

  let t = "👤 *REVENDEDORES*\n\n";
  all.forEach((x) => {
    t += `• ${escMD(x.nombre || x.id)} — ${x.activo ? "✅ activo" : "⛔ inactivo"}${
      x.telegramId ? ` | 🆔 ${escMD(String(x.telegramId))}` : ""
    }\n`;
  });

  if (t.length > 3800) {
    try {
      const { enviarTxtComoArchivo } = require("./index_02_utils_roles");
      return enviarTxtComoArchivo(chatId, t, `revendedores_${Date.now()}.txt`);
    } catch (_) {}
  }

  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
}

// ✅ GESTIÓN REVENDEDORES POR BOTONES
async function menuGestionRevendedores(chatId) {
  const snap = await db.collection("revendedores").get();
  const all = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  all.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" }));

  let txt = "👤 *GESTIÓN REVENDEDORES*\n\n";
  if (!all.length) {
    txt += "_No hay revendedores registrados._";
  } else {
    all.forEach((x, i) => {
      txt += `*${i + 1}.* ${escMD(x.nombre || x.id)} — ${x.activo ? "✅" : "⛔"}`;
      txt += x.telegramId ? ` | 🆔 ${escMD(String(x.telegramId))}` : " | sin ID";
      txt += "\n";
    });
  }
  const kb = [];
  all.forEach(x => {
    kb.push([{ text: `🗑️ Eliminar ${(x.nombre || x.id).slice(0, 20)}`, callback_data: `rev:del:ask:${x.id}` }]);
  });
  kb.push([{ text: "➕ Agregar revendedor", callback_data: "rev:add:start" }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return upsertPanel(chatId, txt, kb);
}

function humanPlatAlertLocal(key = "") {
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
    universal: "Universal",
    spotify: "Spotify",
    youtube: "YouTube",
    deezer: "Deezer",
    oleadatv1: "Oleada 1",
    oleadatv3: "Oleada 3",
    iptv1: "IPTV 1",
    iptv3: "IPTV 3",
    iptv4: "IPTV 4",
    canva: "Canva",
    gemini: "Gemini",
    chatgpt: "ChatGPT",
  };
  return map[k] || String(key || "");
}

function diffDaysFromTodayLocal(fechaDMY = "") {
  const hoyTs = Number(parseDMYtoTS(hoyDMY()) || 0);
  const fechaTs = Number(parseDMYtoTS(fechaDMY) || 0);
  if (!hoyTs || !fechaTs) return 0;
  return Math.floor((hoyTs - fechaTs) / 86400000);
}

// ✅ FIX VENCIDOS: comparación por string DMY es más confiable que timestamps
// parseDMYtoTS usa Date.UTC con hora 12:00 y puede fallar en comparaciones exactas.
// Comparar strings dd/mm/yyyy directamente es seguro porque el formato es fijo.
function dmyToSortKey(dmy = "") {
  // Convierte "dd/mm/yyyy" a "yyyy-mm-dd" para comparación lexicográfica correcta
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function getAlertaClientesLocal(tipo = "hoy") {
  try {
    const snap = await db.collection("clientes").get();
    const hoy = hoyDMY();
    const fecha3 = addDaysDMY(hoy, 3);
    const hoyKey = dmyToSortKey(hoy); // "yyyy-mm-dd" de hoy para comparar
    const rows = [];

    snap.forEach((doc) => {
      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];

      servicios.forEach((s) => {
        const fecha = String(s?.fechaRenovacion || "").trim();
        if (!isFechaDMY(fecha)) return;

        const fechaKey = dmyToSortKey(fecha);
        let ok = false;

        // ✅ FIX: vencidos = fechaKey < hoyKey (comparación de strings yyyy-mm-dd)
        if (tipo === "vencidos") ok = fechaKey < hoyKey && fechaKey !== "";
        else if (tipo === "hoy") ok = fecha === hoy;
        else if (tipo === "3dias") ok = fecha === fecha3;

        if (!ok) return;

        rows.push({
          clientId: doc.id,
          nombrePerfil: String(c.nombrePerfil || "Sin nombre").trim(),
          telefono: String(c.telefono || "-").trim(),
          vendedor: String(c.vendedor || "-").trim(),
          plataforma: normalizarPlataforma(s?.plataforma || ""),
          correo: String(s?.correo || "-").trim(),
          pin: String(s?.pin || "-").trim(),
          precio: Number(s?.precio || 0),
          fechaRenovacion: fecha,
          atrasoDias: tipo === "vencidos" ? Math.max(1, diffDaysFromTodayLocal(fecha)) : 0,
        });
      });
    });

    rows.sort((a, b) => {
      const fa = dmyToSortKey(a.fechaRenovacion || "");
      const fb = dmyToSortKey(b.fechaRenovacion || "");
      if (fa !== fb) return fa.localeCompare(fb);
      const va = String(a.vendedor || "");
      const vb = String(b.vendedor || "");
      if (va !== vb) return va.localeCompare(vb, "es", { sensitivity: "base" });
      return String(a.nombrePerfil || "").localeCompare(String(b.nombrePerfil || ""), "es", { sensitivity: "base" });
    });

    return rows;
  } catch (e) {
    logErr(`getAlertaClientesLocal:${tipo}`, e?.stack || e?.message || e);
    return [];
  }
}

// ✅ PAGINACIÓN: renderiza solo la página indicada (10 registros por página)
const ALERT_PAGE_SIZE = 10;

function renderAlertaClientesMarkdown(rows = [], titulo = "", emptyText = "Sin resultados.", page = 0) {
  const items = Array.isArray(rows) ? rows : [];
  const totalPages = Math.max(1, Math.ceil(items.length / ALERT_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(Number(page || 0), totalPages - 1));
  const start = safePage * ALERT_PAGE_SIZE;
  const slice = items.slice(start, start + ALERT_PAGE_SIZE);

  let txt = `${titulo}`;
  if (items.length > ALERT_PAGE_SIZE) {
    txt += ` — Página *${safePage + 1}/${totalPages}*`;
  }
  txt += `\n\n`;

  if (!items.length) {
    txt += `_${emptyText}_`;
    return txt;
  }

  slice.forEach((x, i) => {
    const numGlobal = start + i + 1;
    txt += `*${numGlobal})* ${escMD(x.nombrePerfil || "Sin nombre")}\n`;
    txt += `📱 ${escMD(x.telefono || "-")}\n`;
    txt += `🧾 ${escMD(x.vendedor || "-")}\n`;
    txt += `📦 ${escMD(humanPlatAlertLocal(x.plataforma || ""))}\n`;
    txt += `${getIdentLabelLocal(x.plataforma || "") === "Usuario" ? "👤" : "📧"} ${escMD(x.correo || "-")}\n`;
    txt += `💰 ${escMD(moneyLps(x.precio || 0))}\n`;
    txt += `📅 ${escMD(x.fechaRenovacion || "-")}`;
    if (Number(x.atrasoDias || 0) > 0) {
      txt += ` • ⏰ ${escMD(String(x.atrasoDias))} día(s)`;
    }
    txt += `\n\n`;
  });

  txt += `*Total:* ${escMD(String(items.length))}`;
  return txt.trim();
}

// ✅ Construye los botones de navegación para alertas paginadas
function buildAlertNavKeyboard(tipo = "", page = 0, totalRows = 0) {
  const totalPages = Math.max(1, Math.ceil(totalRows / ALERT_PAGE_SIZE));
  const nav = [];

  if (page > 0) nav.push({ text: "⬅️ Anterior", callback_data: `alert:pg:${tipo}:${page - 1}` });
  if (page < totalPages - 1) nav.push({ text: "Siguiente ➡️", callback_data: `alert:pg:${tipo}:${page + 1}` });

  const kb = [];
  if (nav.length) kb.push(nav);
  kb.push([{ text: "⬅️ Volver alertas", callback_data: "menu:alertas" }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return kb;
}

async function getInventarioCriticoLocal() {
  try {
    const snap = await db.collection("inventario").get();
    const rows = [];

    snap.forEach((doc) => {
      const d = doc.data() || {};
      const plataforma = normalizarPlataforma(d.plataforma || "");
      const capacidad = Number(d.capacidad || d.total || getCapacidadCorreo(d, plataforma) || 1);
      const clientes = Array.isArray(d.clientes) ? d.clientes : [];
      const ocupados = Number.isFinite(Number(d.ocupados)) ? Number(d.ocupados) : clientes.length;
      const disponiblesRaw = d.disponibles ?? d.disp;
      const disponibles = Number.isFinite(Number(disponiblesRaw))
        ? Number(disponiblesRaw)
        : Math.max(0, capacidad - ocupados);
      const acceso = String(d.correo || d.usuario || "").trim();

      if (ocupados > capacidad || disponibles <= 0) {
        rows.push({
          id: doc.id,
          plataforma,
          acceso,
          ocupados,
          capacidad,
          disponibles,
          estado: ocupados > capacidad ? "SOBREOCUPADA" : "LLENA",
        });
      }
    });

    rows.sort((a, b) => {
      if ((b.ocupados - b.capacidad) !== (a.ocupados - a.capacidad)) {
        return (b.ocupados - b.capacidad) - (a.ocupados - a.capacidad);
      }
      return String(a.plataforma || "").localeCompare(String(b.plataforma || ""), "es", { sensitivity: "base" });
    });

    return rows;
  } catch (e) {
    logErr("getInventarioCriticoLocal", e?.stack || e?.message || e);
    return [];
  }
}

function renderInventarioCriticoMarkdown(rows = [], page = 0) {
  const items = Array.isArray(rows) ? rows : [];
  const totalPages = Math.max(1, Math.ceil(items.length / ALERT_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(Number(page || 0), totalPages - 1));
  const start = safePage * ALERT_PAGE_SIZE;
  const slice = items.slice(start, start + ALERT_PAGE_SIZE);

  let txt = `📦 *INVENTARIO CRÍTICO*`;
  if (items.length > ALERT_PAGE_SIZE) {
    txt += ` — Página *${safePage + 1}/${totalPages}*`;
  }
  txt += `\n\n`;

  if (!items.length) {
    txt += `_Sin cuentas críticas._`;
    return txt;
  }

  slice.forEach((x, i) => {
    const numGlobal = start + i + 1;
    txt += `*${numGlobal})* ${escMD(humanPlatAlertLocal(x.plataforma || ""))}\n`;
    txt += `${getIdentLabelLocal(x.plataforma || "") === "Usuario" ? "👤" : "📧"} ${escMD(x.acceso || "-")}\n`;
    txt += `👥 ${escMD(String(x.ocupados))}/${escMD(String(x.capacidad))}\n`;
    txt += `✅ Disp: ${escMD(String(x.disponibles))}\n`;
    txt += `📊 ${escMD(x.estado || "-")}\n\n`;
  });

  txt += `*Total:* ${escMD(String(items.length))}`;
  return txt.trim();
}

async function enviarTxtAlertasDiaLocal(chatId) {
  const hoy = hoyDMY();
  const fecha3 = addDaysDMY(hoy, 3);

  const [vencidos, hoyRows, dias3, inventario] = await Promise.all([
    getAlertaClientesLocal("vencidos"),
    getAlertaClientesLocal("hoy"),
    getAlertaClientesLocal("3dias"),
    getInventarioCriticoLocal(),
  ]);

  let txt = "";
  txt += `ALERTAS DEL DÍA\nFecha: ${hoy}\n\n`;

  txt += "==============================\n";
  txt += "🔴 CLIENTES VENCIDOS\n";
  txt += "==============================\n";
  if (!vencidos.length) {
    txt += "Sin clientes vencidos.\n\n";
  } else {
    vencidos.forEach((x, i) => {
      txt += `${i + 1}) ${x.nombrePerfil}\nTeléfono: ${x.telefono}\nVendedor: ${x.vendedor}\n`;
      txt += `Plataforma: ${humanPlatAlertLocal(x.plataforma)}\n`;
      txt += `${getIdentLabelLocal(x.plataforma) === "Usuario" ? "Usuario" : "Correo"}: ${x.correo}\n`;
      txt += `Fecha: ${x.fechaRenovacion}\nAtraso: ${x.atrasoDias} día(s)\nMonto: ${Number(x.precio || 0).toFixed(2)} Lps\n\n`;
    });
  }

  txt += "==============================\n";
  txt += "🟠 VENCEN HOY\n";
  txt += "==============================\n";
  if (!hoyRows.length) {
    txt += "Sin renovaciones para hoy.\n\n";
  } else {
    hoyRows.forEach((x, i) => {
      txt += `${i + 1}) ${x.nombrePerfil}\nTeléfono: ${x.telefono}\nVendedor: ${x.vendedor}\n`;
      txt += `Plataforma: ${humanPlatAlertLocal(x.plataforma)}\n`;
      txt += `${getIdentLabelLocal(x.plataforma) === "Usuario" ? "Usuario" : "Correo"}: ${x.correo}\n`;
      txt += `Fecha: ${x.fechaRenovacion}\nMonto: ${Number(x.precio || 0).toFixed(2)} Lps\n\n`;
    });
  }

  txt += "==============================\n";
  txt += `⏳ VENCEN EN 3 DÍAS (${fecha3})\n`;
  txt += "==============================\n";
  if (!dias3.length) {
    txt += "Sin renovaciones en 3 días.\n\n";
  } else {
    dias3.forEach((x, i) => {
      txt += `${i + 1}) ${x.nombrePerfil}\nTeléfono: ${x.telefono}\nVendedor: ${x.vendedor}\n`;
      txt += `Plataforma: ${humanPlatAlertLocal(x.plataforma)}\n`;
      txt += `${getIdentLabelLocal(x.plataforma) === "Usuario" ? "Usuario" : "Correo"}: ${x.correo}\n`;
      txt += `Fecha: ${x.fechaRenovacion}\nMonto: ${Number(x.precio || 0).toFixed(2)} Lps\n\n`;
    });
  }

  txt += "==============================\n";
  txt += "📦 INVENTARIO CRÍTICO\n";
  txt += "==============================\n";
  if (!inventario.length) {
    txt += "Sin cuentas críticas.\n";
  } else {
    inventario.forEach((x, i) => {
      txt += `${i + 1}) ${humanPlatAlertLocal(x.plataforma)}\n`;
      txt += `${getIdentLabelLocal(x.plataforma) === "Usuario" ? "Usuario" : "Correo"}: ${x.acceso}\n`;
      txt += `Ocupados: ${x.ocupados}/${x.capacidad}\nDisponibles: ${x.disponibles}\nEstado: ${x.estado}\n\n`;
    });
  }

  try {
    return await enviarTxtComoArchivo(chatId, txt, `alertas_${hoy.replace(/\//g, "-")}.txt`);
  } catch (e) {
    logErr("enviarTxtAlertasDiaLocal", e);
    return bot.sendMessage(chatId, txt);
  }
}

// ===============================
// ✅ PAGINACIÓN ALERTAS: mostrarPanelAlertaSeguro recibe page y muestra 10 en 10

// ===============================
// ✅ RENOVACIÓN MASIVA VENCIDOS
// ===============================
const MASIVO_PAGE_SIZE = 10;
function masivoKey(chatId) { return `masivo:${chatId}`; }

function renderMasivoPanel(rows = [], selSet = new Set(), page = 0, tipo = "vencidos") {
  const totalPages = Math.max(1, Math.ceil(rows.length / MASIVO_PAGE_SIZE));
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  const start      = safePage * MASIVO_PAGE_SIZE;
  const slice      = rows.slice(start, start + MASIVO_PAGE_SIZE);
  const titulo     = tipo === "hoy" ? "RENOV. MASIVA — HOY" : "RENOVACION MASIVA";
  const labelRows  = tipo === "hoy" ? "vencen hoy" : "vencidos";
  let txt = `*${titulo}*\n`;
  txt += `${rows.length} ${labelRows} — Pag *${safePage + 1}/${totalPages}* — *${selSet.size}* sel.\n\n`;
  slice.forEach((x, i) => {
    const sel = selSet.has(x.clientId) ? "✅" : "⬜";
    const dias = tipo === "hoy" ? "" : ` · ${x.atrasoDias}d`;
    txt += `${sel} ${start + i + 1}. ${escMD((x.nombrePerfil || "Sin nombre").slice(0, 20))}${dias}\n`;
  });
  return { txt, safePage, totalPages, slice };
}
// alias para compatibilidad
const renderMasivoVencidos = renderMasivoPanel;

function buildMasivoKb(rows = [], selSet = new Set(), page = 0, tipo = "vencidos") {
  const { safePage, totalPages, slice } = renderMasivoPanel(rows, selSet, page, tipo);
  const start = safePage * MASIVO_PAGE_SIZE;
  const kb = [];
  slice.forEach((x, i) => {
    const sel = selSet.has(x.clientId);
    kb.push([
      { text: `${sel ? "✅" : "⬜"} ${start + i + 1}. ${(x.nombrePerfil || "Sin nombre").slice(0, 18)}`, callback_data: `masivo:toggle:${x.clientId}:${safePage}` },
      { text: "👁 Ver", callback_data: `masivo:ver:${x.clientId}:${safePage}` },
    ]);
  });
  const todosEnPag = slice.every(x => selSet.has(x.clientId));
  kb.push([
    { text: todosEnPag ? "⬜ Deselec. página" : "✅ Selec. página", callback_data: `masivo:selpage:${safePage}` },
    { text: "✅ Todos", callback_data: "masivo:selall" },
  ]);
  if (selSet.size > 0) kb.push([
    { text: `+30d (${selSet.size})`, callback_data: `masivo:ren:30:${safePage}` },
    { text: `+31d (${selSet.size})`, callback_data: `masivo:ren:31:${safePage}` },
  ]);
  const nav = [];
  if (safePage > 0)              nav.push({ text: "< Anterior", callback_data: `masivo:pg:${safePage - 1}` });
  if (safePage < totalPages - 1) nav.push({ text: "Siguiente >", callback_data: `masivo:pg:${safePage + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: "< Volver alertas", callback_data: "menu:alertas" }, { text: "Inicio", callback_data: "go:inicio" }]);
  return kb;
}

async function mostrarPanelMasivoVencidos(chatId, page = 0, tipo = "vencidos") {
  const sesion = global[masivoKey(chatId)] || { seleccionados: [] };
  const selSet = new Set(sesion.seleccionados || []);
  const rows = await getAlertaClientesLocal(tipo);
  const labelVacio = tipo === "hoy" ? "Sin clientes para hoy." : "Sin clientes vencidos.";
  if (!rows.length) {
    global[masivoKey(chatId)] = null;
    return upsertPanel(chatId, labelVacio, [[{ text: "< Volver alertas", callback_data: "menu:alertas" }]]);
  }
  global[masivoKey(chatId)] = { seleccionados: [...selSet], rows, tipo };
  const { txt } = renderMasivoPanel(rows, selSet, page, tipo);
  return upsertPanel(chatId, txt, buildMasivoKb(rows, selSet, page, tipo));
}

async function refrescarPanelMasivo(chatId, page = 0) {
  const sesion = global[masivoKey(chatId)];
  if (!sesion) return mostrarPanelMasivoVencidos(chatId, page);
  const tipo = sesion.tipo || "vencidos";
  const rows = sesion.rows || await getAlertaClientesLocal(tipo);
  const selSet = new Set(sesion.seleccionados || []);
  global[masivoKey(chatId)] = { ...sesion, rows };
  const { txt } = renderMasivoPanel(rows, selSet, page, tipo);
  return upsertPanel(chatId, txt, buildMasivoKb(rows, selSet, page, tipo));
}
async function mostrarPanelAlertaSeguro(chatId, tipo = "", page = 0) {
  const safePage = Math.max(0, Number(page || 0));

  try {
    if (tipo === "vencidos") {
      const rows = await getAlertaClientesLocal("vencidos");
      return upsertPanel(
        chatId,
        renderAlertaClientesMarkdown(rows, "🔴 *CLIENTES VENCIDOS*", "Sin clientes vencidos.", safePage),
        buildAlertNavKeyboard("vencidos", safePage, rows.length)
      );
    }

    if (tipo === "hoy") {
      const rows = await getAlertaClientesLocal("hoy");
      return upsertPanel(
        chatId,
        renderAlertaClientesMarkdown(rows, "🟠 *VENCEN HOY*", "Sin renovaciones para hoy.", safePage),
        buildAlertNavKeyboard("hoy", safePage, rows.length)
      );
    }

    if (tipo === "3dias") {
      const fecha3 = addDaysDMY(hoyDMY(), 3);
      const rows = await getAlertaClientesLocal("3dias");
      return upsertPanel(
        chatId,
        renderAlertaClientesMarkdown(rows, `⏳ *VENCEN EN 3 DÍAS (${escMD(fecha3)})*`, "Sin renovaciones en 3 días.", safePage),
        buildAlertNavKeyboard("3dias", safePage, rows.length)
      );
    }

    if (tipo === "inventario") {
      const rows = await getInventarioCriticoLocal();
      return upsertPanel(
        chatId,
        renderInventarioCriticoMarkdown(rows, safePage),
        buildAlertNavKeyboard("inventario", safePage, rows.length)
      );
    }

    if (tipo === "txt") {
      return enviarTxtAlertasDiaLocal(chatId);
    }

    return bot.sendMessage(chatId, "⚠️ Alerta no reconocida.");
  } catch (e) {
    logErr(`mostrarPanelAlertaSeguro:${tipo}`, e?.stack || e?.message || e);
    return bot.sendMessage(chatId, "⚠️ Error interno en alertas. Revise logs.");
  }
}

if (global.__SUBLICUENTAS_HANDLERS_READY__) {
  console.log("ℹ️ Handlers ya estaban registrados. Se omite registro duplicado.");
} else {
  global.__SUBLICUENTAS_HANDLERS_READY__ = true;

// ===============================
// COMANDOS CLIENTES
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  return resolverBusquedaAdmin(chatId, q);
});

bot.onText(/\/cliente\s+(\S+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const tel = String(match[1] || "").trim();
  const resultados = await buscarPorTelefonoTodos(tel);
  const dedup = dedupeClientes(resultados);

  if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

  return enviarListaResultadosClientes(chatId, dedup);
});

bot.onText(/\/clientes_txt/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return reporteClientesTXTGeneral(chatId);
});

bot.onText(/\/vendedores_txt_split/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return reporteClientesSplitPorVendedorTXT(chatId);
});

bot.onText(/\/sincronizar_todo/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await safeIsAdminLocal(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo ADMIN puede sincronizar la base de datos.");
  }

  await bot.sendMessage(chatId, "🔄 *Iniciando sincronización masiva...*", { parse_mode: "Markdown" });

  let perfilesEmparejados = 0;
  const cuentasAfectadas = new Set();

  try {
    const snapClientes = await db.collection("clientes").get();

    for (const docCli of snapClientes.docs) {
      const c = docCli.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      const nombreCliente = c.nombrePerfil || "Sin Nombre";

      for (const s of servicios) {
        if (!s.correo || !s.plataforma) continue;

        const plat = normalizarPlataforma(s.plataforma);
        const acceso = normalizeIdentByPlatformLocal(plat, s.correo);
        const idInv = docIdInventarioLocal(acceso, plat);

        const refInv = db.collection("inventario").doc(idInv);
        const docInv = await refInv.get();

        if (!docInv.exists) continue;

        const invData = docInv.data() || {};
        let clientesInv = Array.isArray(invData.clientes) ? invData.clientes.slice() : [];
        const pinCliente = s.pin || "0000";

        const yaExiste = clientesInv.some(
          (x) => x.nombre === nombreCliente && x.pin === pinCliente
        );
        if (yaExiste) continue;

        clientesInv.push({ nombre: nombreCliente, pin: pinCliente, slot: clientesInv.length + 1 });

        const capacidad = Number(invData.capacidad || invData.total || 0);
        const ocupados = clientesInv.length;
        const disponibles = capacidad > 0
          ? Math.max(0, capacidad - ocupados)
          : Math.max(0, Number(invData.disp || 0) - 1);
        const estado = disponibles === 0 ? "llena" : "activa";

        await refInv.set(
          { clientes: clientesInv, ocupados, disponibles, disp: disponibles, estado, capacidad, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );

        perfilesEmparejados++;
        cuentasAfectadas.add(idInv);
      }
    }

    return bot.sendMessage(
      chatId,
      `✅ *Sincronización completada con éxito*\n\n👤 Perfiles emparejados: *${perfilesEmparejados}*\n📦 Cuentas actualizadas: *${cuentasAfectadas.size}*\n\n💡 _La base quedó sincronizada._`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    logErr("sincronizar_todo", error);
    return bot.sendMessage(chatId, "⚠️ Ocurrió un error al sincronizar. Revise los logs del servidor.");
  }
});

// ===============================
// COMANDOS RENOVACIONES
// ===============================
bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await safeIsAdminLocal(userId);
  const vend = await safeGetRevendedorLocal(userId);

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
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await safeIsAdminLocal(userId);
  const vend = await safeGetRevendedorLocal(userId);

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
// COMANDOS FINANZAS
// ===============================
bot.onText(/\/finanzas/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return menuPagos(chatId);
});

bot.onText(/\/resumen_fecha\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  const fecha = String(match[1] || "").trim().toLowerCase() === "hoy" ? hoyDMY() : String(match[1] || "").trim();
  if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Uso: /resumen_fecha dd/mm/yyyy");
  const list = await getMovimientosPorFecha(fecha, userId, await safeIsSuperAdminLocal(userId));
  return bot.sendMessage(chatId, resumenFinanzasTextoPorFecha(fecha, list), { parse_mode: "Markdown" });
});

bot.onText(/\/bancos_mes\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  const key = parseMonthInputToKey(String(match[1] || "").trim());
  if (!key) return bot.sendMessage(chatId, "⚠️ Uso: /bancos_mes mm/yyyy");
  const list = await getMovimientosPorMes(key, userId, await safeIsSuperAdminLocal(userId));
  return bot.sendMessage(chatId, resumenBancosMesTexto(key, list), { parse_mode: "Markdown" });
});

bot.onText(/\/top_plataformas_mes\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  const key = parseMonthInputToKey(String(match[1] || "").trim());
  if (!key) return bot.sendMessage(chatId, "⚠️ Uso: /top_plataformas_mes mm/yyyy");
  const list = await getMovimientosPorMes(key, userId, await safeIsSuperAdminLocal(userId));
  return bot.sendMessage(chatId, resumenTopPlataformasTexto(key, list), { parse_mode: "Markdown" });
});

bot.onText(/\/cierre_caja\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  const fecha = String(match[1] || "").trim().toLowerCase() === "hoy" ? hoyDMY() : String(match[1] || "").trim();
  if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Uso: /cierre_caja dd/mm/yyyy");
  const list = await getMovimientosPorFecha(fecha, userId, await safeIsSuperAdminLocal(userId));
  return bot.sendMessage(chatId, cierreCajaTexto(fecha, list), { parse_mode: "Markdown" });
});

bot.onText(/\/cierre_caja_rango\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  const fechaInicio = String(match[1] || "").trim();
  const fechaFin = String(match[2] || "").trim();
  const list = await getMovimientosPorRango(fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
  return bot.sendMessage(chatId, cierreCajaTextoRango(fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
});

bot.onText(/\/excel_finanzas\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return exportarFinanzasRangoExcel(chatId, String(match[1] || "").trim(), String(match[2] || "").trim(), userId, await safeIsSuperAdminLocal(userId));
});

bot.onText(/\/editar_movimiento\s+([A-Za-z0-9_-]+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const id = String(match[1] || "").trim();
  const ref = db.collection(FINANZAS_COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Movimiento no encontrado.");

  const m = doc.data() || {};
  const txt =
    `✏️ *EDITAR MOVIMIENTO*\n\n🆔 ID: \`${id}\`\n🗂️ Tipo: ${escMD(m.tipo || "-")}\n` +
    `💰 Monto: ${moneyLps(m.monto || 0)}\n🏦 Banco: ${escMD(m.banco || "-")}\n` +
    `🧾 Motivo: ${escMD(m.motivo || "-")}\n📦 Plataforma: ${escMD(m.plataforma || "-")}\n` +
    `📝 Detalle: ${escMD(m.detalle || "-")}\n📅 Fecha: ${escMD(m.fecha || "-")}\n\nSeleccione qué desea editar:`;

  return bot.sendMessage(chatId, txt, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Editar monto", callback_data: `fin:edit:monto:${id}` }],
        [{ text: "🏦 Editar banco", callback_data: `fin:edit:banco:${id}` }],
        [{ text: "🧾 Editar motivo", callback_data: `fin:edit:motivo:${id}` }],
        [{ text: "📦 Editar plataforma", callback_data: `fin:edit:plataforma:${id}` }],
        [{ text: "📝 Editar detalle", callback_data: `fin:edit:detalle:${id}` }],
        [{ text: "📅 Editar fecha", callback_data: `fin:edit:fecha:${id}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
});

// ===============================
// IDS / VINCULACIÓN
// ===============================
bot.onText(/\/id/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(chatId, `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`);
});

bot.onText(/\/miid/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(chatId, `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`);
});

bot.onText(/\/vincular_vendedor\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso: /vincular_vendedor NOMBRE");
  const r = await linkRevendedorByNombre(nombre, userId);
  return bot.sendMessage(chatId, r.msg);
});

// ===============================
// REVENDEDORES ADMIN
// ===============================
bot.onText(/\/addvendedor\s+(\d+)\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");
  const telegramId = String(match[1] || "").trim();
  const nombre = String(match[2] || "").trim();
  if (!telegramId || !nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/addvendedor ID Nombre");
  const docId = String(nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ") || String(Date.now());
  await db.collection("revendedores").doc(docId).set(
    { nombre, nombre_norm: docId, telegramId: String(telegramId), activo: true, autoLastSent: "", createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return bot.sendMessage(chatId, `✅ Revendedor agregado\n\n👤 ${nombre}\n🆔 ${telegramId}\n📌 DocID: ${docId}`);
});

bot.onText(/\/delvendedor\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");
  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/delvendedor Nombre");
  const nombreNorm = String(nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
  const snap = await db.collection("revendedores").get();
  let found = null;
  snap.forEach((d) => {
    const rev = d.data() || {};
    const revNombreNorm = String(rev.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
    if (revNombreNorm === nombreNorm) found = { ref: d.ref, nombre: rev.nombre || d.id };
  });
  if (!found) return bot.sendMessage(chatId, "⚠️ No encontré ese revendedor.");
  await found.ref.delete();
  return bot.sendMessage(chatId, `🗑️ Revendedor eliminado:\n${found.nombre}`);
});

// ===============================
// ADMINS
// ===============================
bot.onText(/\/adminadd\s+(\d+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsSuperAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede agregar admins.");
  const id = String(match[1] || "").trim();
  await db.collection("admins").doc(id).set({ activo: true, updatedAt: admin.firestore.FieldValue.serverTimestamp(), creadoPor: String(userId) }, { merge: true });
  invalidarCacheAdmins();
  return bot.sendMessage(chatId, `✅ Admin agregado: ${id}`);
});

bot.onText(/\/admindel\s+(\d+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsSuperAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede eliminar admins.");
  const id = String(match[1] || "").trim();
  await db.collection("admins").doc(id).set({ activo: false, updatedAt: admin.firestore.FieldValue.serverTimestamp(), desactivadoPor: String(userId) }, { merge: true });
  invalidarCacheAdmins();
  return bot.sendMessage(chatId, `🗑️ Admin desactivado: ${id}`);
});

bot.onText(/\/adminlist/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsSuperAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN.");
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
// START / MENU
// ===============================
bot.onText(/^\/start(?:@\w+)?$/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  return sendBottomMainMenu(msg.chat.id, msg.from.id, true);
});

bot.onText(/^\/menu(?:@\w+)?$/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  return sendBottomMainMenu(msg.chat.id, msg.from.id, true);
});

// ✅ ATajos DE TEXTO SIN SLASH
const COMANDOS_SIN_SLASH = [
  { texto: "menu",       accion: (chatId, userId) => sendBottomMainMenu(chatId, userId, true), soloAdmin: false },
  { texto: "inicio",     accion: (chatId, userId) => sendBottomMainMenu(chatId, userId, true), soloAdmin: false },
  { texto: "inventario", accion: (chatId) => menuInventario(chatId), soloAdmin: true },
  { texto: "finanzas",   accion: (chatId) => menuPagos(chatId), soloAdmin: true },
  { texto: "clientes",   accion: (chatId) => menuClientes(chatId), soloAdmin: true },
  { texto: "alertas",    accion: (chatId) => menuAlertas(chatId), soloAdmin: true },
  { texto: "dashboard",  accion: (chatId) => generarDashboard(chatId), soloAdmin: true },
];

COMANDOS_SIN_SLASH.forEach(({ texto, accion, soloAdmin }) => {
  bot.onText(new RegExp(`^${escapeRegex(texto)}$`, "i"), async (msg) => {
    if (!hasRuntimeLock()) return;
    const chatId = msg.chat.id; const userId = msg.from.id;
    if (!(await userHasAccessFromMessage(msg))) return;

    // Modo app: mantener el panel anclado, no crear mensaje nuevo.
    if (soloAdmin && !(await safeIsAdminLocal(userId))) return;
    // Modo app: limpiar flujos, pero mantener el panel principal.
    clearFlowStateKeepPanel(chatId);
    return accion(chatId, userId);
  });
});

// ===============================
// ATAJOS INVENTARIO
// ===============================
PLATFORM_KEYS.forEach((p) => {
  const safeP = escapeRegex(String(p));
  bot.onText(new RegExp(`^\\/${safeP}(?:@\\w+)?(?:\\s+.*)?$`, "i"), async (msg) => {
    if (!hasRuntimeLock()) return;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return enviarInventarioPlataforma(chatId, p, 0);
  });
});

bot.onText(/\/stock/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return mostrarStockGeneral(chatId);
});

// ✅ NUEVO: Comando /dashboard
bot.onText(/\/dashboard/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  return generarDashboard(chatId);
});

// ===============================
// AGREGAR CUENTA INVENTARIO
// /addcorreo plataforma acceso [capacidad]
// ===============================
bot.onText(/\/addcorreo\s+(\S+)\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado. Solo admins pueden agregar inventario.");

  const platRaw = match[1];
  const accesoRaw = match[2];
  const capacidadRaw = match[3];

  const plat = normalizarPlataforma(platRaw);
  if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ *Plataforma no válida.*", { parse_mode: "Markdown" });

  const label = getIdentLabelLocal(plat);
  const acceso = normalizeIdentByPlatformLocal(plat, accesoRaw);

  if (!validateIdentByPlatformLocal(plat, acceso)) {
    return bot.sendMessage(chatId, `⚠️ *${escMD(label)} inválido.*\nRevise el formato para esta plataforma.`, { parse_mode: "Markdown" });
  }

  const idInv = docIdInventarioLocal(acceso, plat);
  const ref = db.collection("inventario").doc(idInv);
  const doc = await ref.get();

  if (doc.exists) return bot.sendMessage(chatId, `⚠️ *Esta cuenta ya existe* en el inventario para *${escMD(plat)}*.`, { parse_mode: "Markdown" });

  let capacidad = Number(capacidadRaw);
  if (!capacidadRaw || isNaN(capacidad) || capacidad <= 0) {
    capacidad = getTotalPorPlataformaLocal(plat);
  }

  await ref.set({
    plataforma: plat,
    correo: acceso,
    capacidad,
    clientes: [],
    ocupados: 0,
    disponibles: capacidad,
    disp: capacidad,
    estado: "activa",
    clave: getAccessTypeLabelLocal(plat) === "Solo correo" ? "" : "Sin clave",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let out = `✅ *NUEVA CUENTA AGREGADA AL INVENTARIO*\n\n📌 *Plataforma:* ${escMD(plat.toUpperCase())}\n`;
  out += `🔐 *Tipo de acceso:* ${escMD(getAccessTypeLabelLocal(plat))}\n`;
  out += `${identIcon(plat)} *${escMD(label)}:* ${escMD(acceso)}\n`;
  if (getAccessTypeLabelLocal(plat) !== "Solo correo") out += `🔑 *Clave inicial:* Sin clave\n`;
  out += `👥 *Capacidad:* ${capacidad}\n\n_💡 Ya puede editar la clave o asignar clientes._`;

  return bot.sendMessage(chatId, out, { parse_mode: "Markdown" });
});

// ===============================
// CALLBACKS
// ===============================
bot.on("callback_query", async (q) => {
  if (!hasRuntimeLock()) return;

  const chatId = q.message?.chat?.id;
  const userId = q.from?.id;
  const data = String(q.data || "");

  try {
    await answerCallbackSilentlySafe(q);

    if (!chatId) return;
    if (!(await userHasAccessById(chatId, userId))) return;

    bindPanelFromCallback(q);

    const adminOk = await safeIsAdminLocal(userId);
    const vend = await safeGetRevendedorLocal(userId);
    const vendOk = !!(vend && vend.nombre);

    if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    if (data === "go:inicio") {
      resetChatStateFull(chatId);
      return sendBottomMainMenu(chatId, userId);
    }

    const vendedorOnlyAllowed = new Set([
      "ren:mis:hoy", "ren:mis:prox3", "txt:mis", "vend:clientes",
      "vend:clientes:txt", "vend:resumen", "vend:vencidos", "vend:precios",
      "vend:buscar", "go:inicio",
    ]);

    // ✅ Los callbacks de ficha de cliente para vendedores se permiten
    const vendedorDynamicOk = data.startsWith("vend:cli:");
    if (!adminOk && !vendedorOnlyAllowed.has(data) && !vendedorDynamicOk) {
      return upsertPanel(
        chatId,
        "⛔ Modo vendedor.\n\nUsa:\n• Mis renovaciones hoy\n• Renovaciones en 3 días\n• TXT renovaciones\n• Mis clientes\n• TXT Mis clientes\n• Mi resumen\n",
        [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]
      );
    }

    if (adminOk) {
      if (data === "menu:inventario") return menuInventario(chatId);
      if (data === "menu:dashboard")  return generarDashboard(chatId);
      if (data === "menu:inventario:video") return menuInventarioVideo(chatId);
      if (data === "menu:inventario:musica") return menuInventarioMusica(chatId);
      if (data === "menu:inventario:iptv") return menuInventarioIptv(chatId);
      if (data === "menu:inventario:designai") return menuInventarioDisenoIA(chatId);
      if (data === "menu:clientes") return menuClientes(chatId);
      if (data === "menu:pagos") return menuPagos(chatId);
      if (data === "menu:alertas") return menuAlertas(chatId);
      if (data === "menu:renovaciones") return menuRenovaciones(chatId, userId);
      if (data === "menu:revendedores")  return menuGestionRevendedores(chatId);

      // ✅ FIX ALERTAS: usar startsWith para tolerar el sufijo :0 de paginación
      // Formato: alert:vencidos:0 o alert:pg:vencidos:2 (navegación)
      if (data.startsWith("alert:pg:")) {
        // Paginación directa: alert:pg:tipo:page
        const parts = data.split(":");
        const tipo = parts[2] || "";
        const pg = Number(parts[3] || 0);
        return mostrarPanelAlertaSeguro(chatId, tipo, pg);
      }

      // ✅ RENOVACIÓN MASIVA
      if (data === "masivo:start") {
        global[masivoKey(chatId)] = null;
        return mostrarPanelMasivoVencidos(chatId, 0, "vencidos");
      }
      if (data === "masivo:start:hoy") {
        global[masivoKey(chatId)] = null;
        return mostrarPanelMasivoVencidos(chatId, 0, "hoy");
      }
      if (data.startsWith("masivo:pg:")) {
        return refrescarPanelMasivo(chatId, Number(data.split(":")[2] || 0));
      }
      if (data.startsWith("masivo:toggle:")) {
        const parts = data.split(":");
        const sesion = global[masivoKey(chatId)] || {};
        const selSet = new Set(Array.isArray(sesion.seleccionados) ? sesion.seleccionados : []);
        selSet.has(parts[2]) ? selSet.delete(parts[2]) : selSet.add(parts[2]);
        global[masivoKey(chatId)] = { ...sesion, seleccionados: [...selSet] };
        return refrescarPanelMasivo(chatId, Number(parts[3] || 0));
      }
      if (data.startsWith("masivo:selpage:")) {
        const pg = Number(data.split(":")[2] || 0);
        const sesion = global[masivoKey(chatId)] || {};
        const rows = sesion.rows || await getAlertaClientesLocal("vencidos");
        const slice = rows.slice(pg * MASIVO_PAGE_SIZE, (pg + 1) * MASIVO_PAGE_SIZE);
        const selSet = new Set(Array.isArray(sesion.seleccionados) ? sesion.seleccionados : []);
        const todosEnPag = slice.every(x => selSet.has(x.clientId));
        slice.forEach(x => todosEnPag ? selSet.delete(x.clientId) : selSet.add(x.clientId));
        global[masivoKey(chatId)] = { ...sesion, rows, seleccionados: [...selSet] };
        return refrescarPanelMasivo(chatId, pg);
      }
      if (data === "masivo:selall") {
        const sesion = global[masivoKey(chatId)] || {};
        const rows = sesion.rows || await getAlertaClientesLocal("vencidos");
        const selSet = new Set(Array.isArray(sesion.seleccionados) ? sesion.seleccionados : []);
        const todosSelec = rows.every(x => selSet.has(x.clientId));
        todosSelec ? selSet.clear() : rows.forEach(x => selSet.add(x.clientId));
        global[masivoKey(chatId)] = { ...sesion, rows, seleccionados: [...selSet] };
        return refrescarPanelMasivo(chatId, 0);
      }
      if (data.startsWith("masivo:ver:")) {
        const parts = data.split(":");
        const cliId = parts[2]; const pg = Number(parts[3] || 0);
        const cVer = await getCliente(cliId);
        if (!cVer) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        // ✅ Ficha con botón Volver al masivo en la misma página
        return upsertPanel(chatId, renderFichaClienteMarkdown(cVer), [
          [{ text: "✏️ Editar cliente",         callback_data: `cli:edit:menu:${cVer.id}` }],
          [{ text: "🧩 Editar servicios",       callback_data: `cli:serv:list:${cVer.id}` }],
          [{ text: "🔄 Gestionar renovaciones", callback_data: `cli:ren:list:${cVer.id}` }],
          [{ text: "➕ Agregar servicio",       callback_data: `cli:serv:add:${cVer.id}` }],
          [{ text: "🗑️ Borrar cliente",        callback_data: `cli:del:ask:${cVer.id}` }],
          [{ text: "⬅️ Volver masivo", callback_data: `masivo:pg:${pg}` }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }
      if (data === "masivo:back" || data.startsWith("masivo:back:")) {
        return refrescarPanelMasivo(chatId, Number((data.split(":")[2]) || 0));
      }
      if (data.startsWith("masivo:ren:") && !data.startsWith("masivo:ren:ok:")) {
        const parts = data.split(":");
        const dias = Number(parts[2] || 30); const pg = Number(parts[3] || 0);
        const sesion = global[masivoKey(chatId)] || {};
        const selArr = Array.isArray(sesion.seleccionados) ? sesion.seleccionados : [];
        if (!selArr.length) return bot.sendMessage(chatId, "⚠️ No hay clientes seleccionados.");
        const rows = sesion.rows || [];
        const nombres = selArr.slice(0, 5).map(id => {
          const r = rows.find(x => x.clientId === id);
          return r ? escMD(r.nombrePerfil || id) : id;
        });
        const extra = selArr.length > 5 ? ` y ${selArr.length - 5} más` : "";
        return upsertPanel(chatId,
          `⚡ *CONFIRMAR RENOVACIÓN MASIVA*\n\n📅 *+${dias} días* a *${selArr.length}* cliente(s):\n\n${nombres.map(n => `• ${n}`).join("\n")}${escMD(extra)}\n\n⚠️ Se renuevan todos los servicios de cada cliente.`,
          [[{ text: `✅ Confirmar +${dias}d`, callback_data: `masivo:ren:ok:${dias}:${pg}` }, { text: "❌ Cancelar", callback_data: `masivo:pg:${pg}` }]]
        );
      }
      if (data.startsWith("masivo:ren:ok:")) {
        const parts = data.split(":");
        const dias = Number(parts[3] || 30); const pg = Number(parts[4] || 0);
        const sesion = global[masivoKey(chatId)] || {};
        const selArr = Array.isArray(sesion.seleccionados) ? sesion.seleccionados : [];
        if (!selArr.length) return bot.sendMessage(chatId, "⚠️ No hay clientes seleccionados.");
        await bot.sendMessage(chatId, `⏳ Renovando ${selArr.length} cliente(s)...`);
        let ok = 0; let err = 0;
        const { cacheInvalidatePrefix: cIPM } = require("./index_01_core");
        for (const cliId of selArr) {
          try {
            const ref = db.collection("clientes").doc(String(cliId));
            const doc = await ref.get();
            if (!doc.exists) { err++; continue; }
            const cData = doc.data() || {};
            const servicios = Array.isArray(cData.servicios) ? cData.servicios : [];
            if (!servicios.length) { err++; continue; }
            const nuevos = servicios.map(s => {
              const base = isFechaDMY(String(s.fechaRenovacion || "")) ? String(s.fechaRenovacion) : hoyDMY();
              return { ...s, fechaRenovacion: addDaysDMY(base, dias) };
            });
            await ref.set({ servicios: nuevos, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            cIPM(`clientes:doc:${cliId}`); ok++;
          } catch(e) { logErr(`masivo:ren:ok:${cliId}`, e); err++; }
        }
        global[masivoKey(chatId)] = null;
        await bot.sendMessage(chatId,
          `✅ *Renovación masiva completada*\n✅ Renovados: *${ok}*${err ? `\n❌ Con error: *${err}*` : ""}\n📅 +${dias} días`,
          { parse_mode: "Markdown" }
        );
        return mostrarPanelMasivoVencidos(chatId, 0);
      }

      if (data.startsWith("alert:vencidos") || data.startsWith("alertas:vencidos")) {
        const pg = Number((data.split(":")[2]) || 0);
        return mostrarPanelAlertaSeguro(chatId, "vencidos", isNaN(pg) ? 0 : pg);
      }
      if (data.startsWith("alert:hoy") || data.startsWith("alertas:hoy")) {
        const pg = Number((data.split(":")[2]) || 0);
        return mostrarPanelAlertaSeguro(chatId, "hoy", isNaN(pg) ? 0 : pg);
      }
      if (data.startsWith("alert:3dias") || data.startsWith("alertas:3dias")) {
        const pg = Number((data.split(":")[2]) || 0);
        return mostrarPanelAlertaSeguro(chatId, "3dias", isNaN(pg) ? 0 : pg);
      }
      if (data.startsWith("alert:inventario") || data.startsWith("alertas:inventario")) {
        const pg = Number((data.split(":")[2]) || 0);
        return mostrarPanelAlertaSeguro(chatId, "inventario", isNaN(pg) ? 0 : pg);
      }
      if (data.startsWith("alert:txt:hoy") || data.startsWith("alertas:txt:hoy")) {
        return mostrarPanelAlertaSeguro(chatId, "txt", 0);
      }

      if (data === "fin:menu:registro") return menuFinRegistro(chatId);
      if (data === "fin:menu:reportes") return menuFinReportes(chatId);
      if (data === "fin:menu:eliminar") return menuFinEliminarTipo(chatId);

      if (data === "fin:menu:eliminar:ingreso") {
        pending.set(String(chatId), { mode: "finEliminarFechaAsk", tipo: "ingreso" });
        return upsertPanel(chatId, "🗑️ *ELIMINAR INGRESO POR FECHA*\n\nEscriba la fecha exacta en formato *dd/mm/yyyy*.\n\nEjemplo: *23/03/2026*", [
          [{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:eliminar:egreso") {
        pending.set(String(chatId), { mode: "finEliminarFechaAsk", tipo: "egreso" });
        return upsertPanel(chatId, "🗑️ *ELIMINAR EGRESO POR FECHA*\n\nEscriba la fecha exacta en formato *dd/mm/yyyy*.\n\nEjemplo: *23/03/2026*", [
          [{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:ingreso") {
        pending.set(String(chatId), { mode: "finIngresoMonto" });
        return upsertPanel(chatId, "➕ *REGISTRAR INGRESO*\n\n💰 Escriba el monto del ingreso en Lps:", [
          [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:egreso") {
        pending.set(String(chatId), { mode: "finEgresoMonto" });
        return upsertPanel(chatId, "➖ *REGISTRAR EGRESO*\n\n💸 Escriba el monto del gasto en Lps:", [
          [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:resumen_fecha") {
        pending.set(String(chatId), { mode: "finResumenFechaAsk" });
        return upsertPanel(chatId, "📊 *VER RESUMEN POR FECHA*\n\nEscriba la fecha en formato *dd/mm/yyyy* o escriba *hoy*.", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:resumen_rango") {
        pending.set(String(chatId), { mode: "finResumenRangoInicio" });
        return upsertPanel(chatId, "🗓️ *RESUMEN POR RANGO*\n\nEscriba la fecha inicial en formato *dd/mm/yyyy*.", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:bancos_fecha") {
        pending.set(String(chatId), { mode: "finBancosFechaAsk" });
        return upsertPanel(chatId, "🏦 *BANCOS POR FECHA*\n\nEscriba la fecha en formato *dd/mm/yyyy* o escriba *hoy*.", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:bancos_rango") {
        pending.set(String(chatId), { mode: "finBancosRangoInicio" });
        return upsertPanel(chatId, "🏦 *BANCOS POR RANGO*\n\nEscriba la fecha inicial en formato *dd/mm/yyyy*.", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:detalle_banco") {
        pending.set(String(chatId), { mode: "finDetalleBancoNombreAsk" });
        return upsertPanel(chatId, "🏦 *DETALLE DE BANCO*\n\nEscriba el nombre del banco.\nEjemplo: *BAC*", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:top_plataformas") {
        pending.set(String(chatId), { mode: "finTopPlataformasRangoInicio" });
        return upsertPanel(chatId, "🏆 *TOP PLATAFORMAS*\n\nEscriba la fecha inicial en formato *dd/mm/yyyy*.", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:top_combos") {
        pending.set(String(chatId), { mode: "finTopCombosRangoInicio" });
        return upsertPanel(chatId, "🎯 *TOP COMBOS*\n\nEscriba la fecha inicial en formato *dd/mm/yyyy*.", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:cierre") {
        pending.set(String(chatId), { mode: "finCierreCajaAsk" });
        return upsertPanel(chatId, "🧾 *CIERRE DE CAJA*\n\nEscriba la fecha en formato *dd/mm/yyyy* o escriba *hoy*.", [
          [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:cierre:rango") {
        pending.set(String(chatId), { mode: "finCierreCajaRangoInicio" });
        return upsertPanel(chatId, "🧾 *CIERRE DE CAJA POR RANGO*\n\nEscriba la *fecha inicial* en formato *dd/mm/yyyy*.", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data === "fin:menu:excel_rango") {
        pending.set(String(chatId), { mode: "finExcelRangoInicio" });
        return upsertPanel(chatId, "📤 *EXPORTAR EXCEL POR RANGO*\n\nEscriba la fecha inicial en formato *dd/mm/yyyy*.", [
          [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data.startsWith("fin:ing:banco:")) {
        const banco = decodeURIComponent(data.split(":").slice(3).join(":") || "");
        const p = pending.get(String(chatId));
        if (!p || p.mode !== "finIngresoBancoPick") return bot.sendMessage(chatId, "⚠️ Flujo de ingreso no activo.");
        pending.set(String(chatId), { mode: "finIngresoPlataformaManual", monto: p.monto, banco });
        return upsertPanel(chatId, `➕ *REGISTRAR INGRESO*\n\n🏦 Banco: *${escMD(banco)}*\n\n📦 Escriba manualmente la plataforma o plataformas.\nEjemplo:\nNetflix\nDisney\nHBO Max\nPrime Video`, [
          [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data.startsWith("fin:egr:motivo:")) {
        const motivo = decodeURIComponent(data.split(":").slice(3).join(":") || "");
        const p = pending.get(String(chatId));
        if (!p || p.mode !== "finEgresoMotivoPick") return bot.sendMessage(chatId, "⚠️ Flujo de egreso no activo.");
        pending.set(String(chatId), { mode: "finEgresoBancoPick", monto: p.monto, motivo });
        return bot.sendMessage(chatId, `➖ *REGISTRAR EGRESO*\n\n🧾 Motivo: *${escMD(motivo)}*\n\n🏦 Seleccione el banco desde donde salió el dinero:`, {
          parse_mode: "Markdown",
          reply_markup: kbBancosFinanzasEgreso(),
        });
      }

      if (data.startsWith("fin:egr:banco:")) {
        const banco = decodeURIComponent(data.split(":").slice(3).join(":") || "");
        const p = pending.get(String(chatId));
        if (!p || p.mode !== "finEgresoBancoPick") return bot.sendMessage(chatId, "⚠️ Flujo de egreso no activo.");
        pending.set(String(chatId), { mode: "finEgresoDetalle", monto: p.monto, motivo: p.motivo, banco });
        return upsertPanel(chatId, `➖ *REGISTRAR EGRESO*\n\n🧾 Motivo: *${escMD(p.motivo)}*\n🏦 Banco: *${escMD(banco)}*\n\n📝 Escriba el detalle del egreso:`, [
          [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data.startsWith("fin:del:pick:")) {
        const id = String(data.split(":")[3] || "").trim();
        const ref = db.collection(FINANZAS_COLLECTION).doc(id);
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Movimiento no encontrado.");
        const m = { id: doc.id, ...(doc.data() || {}) };
        const tipo = String(m.tipo || "").toLowerCase() === "egreso" ? "egreso" : "ingreso";
        return upsertPanel(chatId, textoConfirmarEliminacionMovimiento(m), [
          [{ text: "✅ Sí, eliminar este", callback_data: `fin:del:ok:${id}` }],
          [{ text: tipo === "egreso" ? "⬅️ Buscar egresos por fecha" : "⬅️ Buscar ingresos por fecha", callback_data: tipo === "egreso" ? "fin:menu:eliminar:egreso" : "fin:menu:eliminar:ingreso" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data.startsWith("fin:del:ok:")) {
        const id = String(data.split(":")[3] || "").trim();
        try {
          const eliminado = await eliminarMovimientoFinanzas(id, userId, await safeIsSuperAdminLocal(userId));
          const tipoEliminado = String(eliminado.tipo || "").toLowerCase() === "egreso" ? "egreso" : "ingreso";
          return upsertPanel(chatId,
            `✅ *Movimiento eliminado correctamente*\n\n🗂️ Tipo: ${escMD(eliminado.tipo || "-")}\n💰 Monto: ${moneyLps(eliminado.monto || 0)}\n📅 Fecha: ${escMD(eliminado.fecha || "-")}`,
            [
              [{ text: tipoEliminado === "egreso" ? "➖ Buscar egreso por fecha" : "➕ Buscar ingreso por fecha", callback_data: tipoEliminado === "egreso" ? "fin:menu:eliminar:egreso" : "fin:menu:eliminar:ingreso" }],
              [{ text: "🗑️ Volver eliminar", callback_data: "fin:menu:eliminar" }],
              [{ text: "⬅️ Volver a Finanzas", callback_data: "menu:pagos" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ]
          );
        } catch (e) {
          return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo eliminar el movimiento."}`);
        }
      }

      if (data === "fin:otro:ingreso") { pending.set(String(chatId), { mode: "finIngresoMonto" }); return bot.sendMessage(chatId, "💰 Escriba el monto del nuevo ingreso:"); }
      if (data === "fin:otro:egreso") { pending.set(String(chatId), { mode: "finEgresoMonto" }); return bot.sendMessage(chatId, "💸 Escriba el monto del nuevo egreso:"); }
      if (data === "fin:otro:no") { pending.delete(String(chatId)); return menuPagos(chatId); }

      if (data.startsWith("fin:edit:monto:")) { pending.set(String(chatId), { mode: "finEditMonto", id: data.split(":")[3] }); return bot.sendMessage(chatId, "💰 Escriba el nuevo monto:"); }
      if (data.startsWith("fin:edit:banco:")) { pending.set(String(chatId), { mode: "finEditBanco", id: data.split(":")[3] }); return bot.sendMessage(chatId, "🏦 Escriba el nuevo banco:"); }
      if (data.startsWith("fin:edit:motivo:")) { pending.set(String(chatId), { mode: "finEditMotivo", id: data.split(":")[3] }); return bot.sendMessage(chatId, "🧾 Escriba el nuevo motivo:"); }
      if (data.startsWith("fin:edit:plataforma:")) { pending.set(String(chatId), { mode: "finEditPlataforma", id: data.split(":")[3] }); return bot.sendMessage(chatId, "📦 Escriba la nueva plataforma o plataformas:"); }
      if (data.startsWith("fin:edit:detalle:")) { pending.set(String(chatId), { mode: "finEditDetalle", id: data.split(":")[3] }); return bot.sendMessage(chatId, "📝 Escriba el nuevo detalle:"); }
      if (data.startsWith("fin:edit:fecha:")) { pending.set(String(chatId), { mode: "finEditFecha", id: data.split(":")[3] }); return bot.sendMessage(chatId, "📅 Escriba la nueva fecha en formato dd/mm/yyyy:"); }

      if (data === "menu:buscar") {
        return upsertPanel(chatId, "🔎 *BUSCAR*\n\nUse:\n• /buscar NOMBRE\n• /buscar TELEFONO\n\nTambién puede escribir directamente el nombre, teléfono o correo.", [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]);
      }

      if (data === "inv:general") return mostrarStockGeneral(chatId);

      if (data.startsWith("inv:new:plat:")) {
        const plat = normalizarPlataforma(data.split(":")[3]);
        pending.set(String(chatId), { mode: "invNewCorreo", plat });
        return upsertPanel(chatId,
          `➕ *NUEVA CUENTA*\n📌 *Plataforma:* ${String(plat).toUpperCase()}\n\nEscriba el *correo* de la cuenta:`,
          [[{ text: "❌ Cancelar", callback_data: `inv:${plat}:0` }]]
        );
      }

      if (data.startsWith("invf:")) {
        const [, plat, filtro, pageStr] = data.split(":");
        return enviarInventarioPlataformaEstado(chatId, plat, filtro, Number(pageStr || 0));
      }

      if (data.startsWith("inv:") && !data.startsWith("inv:open:") && !data.startsWith("inv:menu:")) {
        const [, plat, pageStr] = data.split(":");
        return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
      }

      if (data.startsWith("inv:open:")) {
        const [, , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.set(String(chatId), { mode: "invSubmenuCtx", plat: normalizarPlataforma(plat), correo: normalizeIdentByPlatformLocal(plat, acceso) });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (data.startsWith("inv:menu:sumar:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.set(String(chatId), { mode: "invSumarQty", plat, correo: acceso });
        return upsertPanel(chatId, `➕ *Agregar perfil*\n📌 ${String(plat).toUpperCase()}\n${identIcon(plat)} ${escMD(getIdentLabelLocal(plat))}: ${escMD(acceso)}\n\nEscriba cantidad a *SUMAR* (ej: 1):`, [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(acceso)}` }]]);
      }

      if (data.startsWith("inv:menu:restar:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.set(String(chatId), { mode: "invRestarQty", plat, correo: acceso });
        return upsertPanel(chatId, `➖ *Quitar perfil*\n📌 ${String(plat).toUpperCase()}\n${identIcon(plat)} ${escMD(getIdentLabelLocal(plat))}: ${escMD(acceso)}\n\nEscriba cantidad a *RESTAR* (ej: 1):`, [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(acceso)}` }]]);
      }

      if (data.startsWith("inv:menu:clave:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.set(String(chatId), { mode: "invEditClave", plat, correo: acceso });
        return upsertPanel(chatId, `✏️ *Editar clave*\n📌 ${String(plat).toUpperCase()}\n${identIcon(plat)} ${escMD(getIdentLabelLocal(plat))}: ${escMD(acceso)}\n\nEscriba la nueva clave:`, [[{ text: "↩️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(acceso)}` }]]);
      }

      if (data.startsWith("inv:menu:cancel:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        pending.set(String(chatId), { mode: "invSubmenuCtx", plat: normalizarPlataforma(plat), correo: normalizeIdentByPlatformLocal(plat, acceso) });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (data.startsWith("inv:menu:borrar:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        return upsertPanel(chatId, `🗑️ Confirmar *borrar cuenta*?\n📌 ${String(plat).toUpperCase()}\n${identIcon(plat)} ${escMD(getIdentLabelLocal(plat))}: ${escMD(acceso)}`, [
          [{ text: "✅ Confirmar", callback_data: `inv:menu:borrarok:${normalizarPlataforma(plat)}:${encodeURIComponent(normalizeIdentByPlatformLocal(plat, acceso))}` }],
          [{ text: "⬅️ Cancelar", callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(acceso)}` }],
        ]);
      }

      if (data.startsWith("inv:menu:borrarok:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        const ref = db.collection("inventario").doc(docIdInventarioLocal(acceso, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ No existe esa cuenta en inventario.");
        await ref.delete();
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        return enviarInventarioPlataforma(chatId, plat, 0);
      }

      if (data.startsWith("mail_panel|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        return mostrarPanelCorreo(chatId, plataforma, decodeURIComponent(accesoEnc || ""));
      }

      if (data.startsWith("mail_menu_clientes|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        return mostrarMenuClientesCorreo(chatId, plataforma, decodeURIComponent(accesoEnc || ""));
      }

      if (data.startsWith("mail_menu_codigos|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        return responderMenuCodigosNetflix(chatId, plataforma, decodeURIComponent(accesoEnc || ""));
      }

      if (data.startsWith("nf_code|")) {
        const parts = data.split("|");
        return responderCodigoNetflix(chatId, decodeURIComponent(parts[2] || ""), parts[1] || "");
      }

      if (data.startsWith("mail_ver_clientes|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";
        let txt = "👥 *Clientes en esta cuenta*\n\n";
        txt += `${identIcon(plataforma)} *${escMD(getIdentLabelLocal(plataforma))}:* ${escMD(acceso)}\n📌 *${escMD(String(plataforma).toUpperCase())}*\n\n`;
        if (!clientes.length) txt += "_No hay clientes asignados._\n\n";
        else { clientes.forEach((c, i) => { txt += `${i + 1}. ${escMD(c.nombre || "Sin nombre")} — PIN ${escMD(c.pin || "----")}\n`; }); txt += "\n"; }
        txt += `👤 *Ocupados:* ${ocupados}/${capacidad}\n✅ *Disponibles:* ${disponibles}\n📊 *Estado:* ${escMD(estado)}`;
        return upsertPanel(chatId, txt, [
          [{ text: "⬅️ Volver a la cuenta", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}` }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }

      if (data.startsWith("mail_add_cliente|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const disponibles = Math.max(0, capacidad - clientes.length);
        if (disponibles <= 0) return bot.sendMessage(chatId, `❌ Esta cuenta ya está llena.\n\n👤 Ocupados: ${clientes.length}/${capacidad}\n✅ Disponibles: 0\n📊 Estado: LLENA`);
        pending.set(String(chatId), { mode: "mailAddClienteNombre", plataforma: normalizarPlataforma(plataforma), correo: normalizeIdentByPlatformLocal(plataforma, acceso) });
        return bot.sendMessage(chatId, "👤 *Agregar cliente*\n\nEscriba el nombre del cliente:", { parse_mode: "Markdown" });
      }

      if (data.startsWith("mail_del_cliente|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const platNorm = normalizarPlataforma(plataforma);
        const accesoNorm = normalizeIdentByPlatformLocal(platNorm, acceso);
        const found = await buscarCorreoInventarioPorPlatCorreo(platNorm, accesoNorm);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const clientes = Array.isArray(found.data?.clientes) ? found.data.clientes : [];
        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Esta cuenta no tiene clientes.");
        pending.set(String(chatId), { mode: "mailDelClientePickCtx", plataforma: platNorm, correo: accesoNorm });
        const kb = clientes.map((c, i) => [{ text: `${i + 1}. ${c.nombre || "Sin nombre"} — PIN ${c.pin || "----"}`, callback_data: `mail_del_cliente_ok|${i}` }]);
        kb.push([{ text: "⬅️ Volver", callback_data: `mail_panel|${platNorm}|${encodeURIComponent(accesoNorm)}` }]);
        return upsertPanel(chatId, `➖ *Quitar cliente*\n\n${identIcon(platNorm)} *${escMD(getIdentLabelLocal(platNorm))}:* ${escMD(accesoNorm)}\n\nSeleccione el cliente que desea quitar:`, kb);
      }

      if (data.startsWith("mail_del_cliente_ok|")) {
        const parts = data.split("|");
        let plataforma = "", acceso = "", index = -1;
        if (parts.length >= 4) {
          plataforma = normalizarPlataforma(parts[1] || "");
          acceso = normalizeIdentByPlatformLocal(plataforma, decodeURIComponent(parts[2] || ""));
          index = Number(parts[3]);
        } else {
          const ctx = pending.get(String(chatId));
          if (!ctx || ctx.mode !== "mailDelClientePickCtx") return bot.sendMessage(chatId, "⚠️ El selector expiró. Abra otra vez el menú de quitar cliente.");
          plataforma = normalizarPlataforma(ctx.plataforma || "");
          acceso = normalizeIdentByPlatformLocal(plataforma, ctx.correo || "");
          index = Number(parts[1]);
        }
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];
        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Esta cuenta ya no tiene clientes.");
        if (isNaN(index) || index < 0 || index >= clientes.length) return bot.sendMessage(chatId, "❌ Cliente inválido.");
        const cliente = clientes[index];
        clientes.splice(index, 1);
        clientes = clientes.map((c, i) => ({ ...c, slot: i + 1 }));
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        await ref.set({ clientes, ocupados, disponibles, disp: disponibles, estado: disponibles === 0 ? "llena" : "activa", capacidad, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await bot.sendMessage(chatId, `✅ *Cliente quitado correctamente*\n\n👤 *Nombre:* ${escMD(cliente.nombre || "Sin nombre")}\n🔐 *PIN:* ${escMD(cliente.pin || "----")}\n\n👤 *Ocupados:* ${ocupados}/${capacidad}\n✅ *Disponibles:* ${disponibles}\n📊 *Estado:* ${escMD(disponibles === 0 ? "LLENA" : "CON ESPACIO")}`, { parse_mode: "Markdown" });
        return mostrarPanelCorreo(chatId, plataforma, acceso);
      }

      if (data.startsWith("mail_edit_pin|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const platNorm = normalizarPlataforma(plataforma);
        const accesoNorm = normalizeIdentByPlatformLocal(platNorm, acceso);
        const found = await buscarCorreoInventarioPorPlatCorreo(platNorm, accesoNorm);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const clientes = Array.isArray(found.data?.clientes) ? found.data.clientes : [];
        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Esta cuenta no tiene clientes.");
        pending.set(String(chatId), { mode: "mailEditPinPickCtx", plataforma: platNorm, correo: accesoNorm });
        const kb = clientes.map((c, i) => [{ text: `${i + 1}. ${c.nombre || "Sin nombre"} — PIN ${c.pin || "----"}`, callback_data: `mail_edit_pin_sel|${i}` }]);
        kb.push([{ text: "⬅️ Volver", callback_data: `mail_panel|${platNorm}|${encodeURIComponent(accesoNorm)}` }]);
        return upsertPanel(chatId, `🔐 *Editar PIN*\n\n${identIcon(platNorm)} *${escMD(getIdentLabelLocal(platNorm))}:* ${escMD(accesoNorm)}\n\nSeleccione el cliente:`, kb);
      }

      if (data.startsWith("mail_edit_pin_sel|")) {
        const parts = data.split("|");
        let plataforma = "", acceso = "", clienteIndex = -1;
        if (parts.length >= 4) {
          plataforma = normalizarPlataforma(parts[1] || "");
          acceso = normalizeIdentByPlatformLocal(plataforma, decodeURIComponent(parts[2] || ""));
          clienteIndex = Number(parts[3]);
        } else {
          const ctx = pending.get(String(chatId));
          if (!ctx || ctx.mode !== "mailEditPinPickCtx") return bot.sendMessage(chatId, "⚠️ El selector expiró. Abra otra vez el menú de editar PIN.");
          plataforma = normalizarPlataforma(ctx.plataforma || "");
          acceso = normalizeIdentByPlatformLocal(plataforma, ctx.correo || "");
          clienteIndex = Number(parts[1]);
        }
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const clientes = Array.isArray(found.data?.clientes) ? found.data.clientes : [];
        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Esta cuenta no tiene clientes.");
        if (isNaN(clienteIndex) || clienteIndex < 0 || clienteIndex >= clientes.length) return bot.sendMessage(chatId, "❌ Cliente inválido.");
        const cliente = clientes[clienteIndex];
        pending.set(String(chatId), { mode: "mailEditPin", plataforma: normalizarPlataforma(plataforma), correo: normalizeIdentByPlatformLocal(plataforma, acceso), clienteIndex });
        return bot.sendMessage(chatId, `🔐 *Editar PIN*\n\n👤 *Cliente:* ${escMD(cliente.nombre || "Sin nombre")}\n🔑 *PIN actual:* ${escMD(cliente.pin || "----")}\n\nEscriba el nuevo PIN de 4 dígitos:`, { parse_mode: "Markdown" });
      }

      if (data.startsWith("mail_edit_clave|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const claveActual = found.data?.clave || "Sin clave";
        pending.set(String(chatId), { mode: "mailEditClaveCorreo", plataforma: normalizarPlataforma(plataforma), correo: normalizeIdentByPlatformLocal(plataforma, acceso) });
        return bot.sendMessage(chatId, `✏️ *Editar clave de la cuenta*\n\n${identIcon(plataforma)} *${escMD(getIdentLabelLocal(plataforma))}:* ${escMD(acceso)}\n🔑 *Clave actual:* ${escMD(claveActual)}\n\nEscriba la nueva clave:`, { parse_mode: "Markdown" });
      }

      if (data.startsWith("mail_edit_correo|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        pending.set(String(chatId), {
          mode: "mailEditCorreoCuenta",
          plataforma: normalizarPlataforma(plataforma),
          correo: normalizeIdentByPlatformLocal(plataforma, acceso),
        });
        return bot.sendMessage(
          chatId,
          `✉️ *Editar correo de la cuenta*\n\n${identIcon(plataforma)} *${escMD(getIdentLabelLocal(plataforma))}:* ${escMD(acceso)}\n\nEscriba el nuevo correo:`,
          { parse_mode: "Markdown" }
        );
      }

      if (data.startsWith("mail_delete|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ Esta cuenta ya no existe.");
        return upsertPanel(chatId, `⚠️ *Confirmar eliminación*\n\n📌 *Plataforma:* ${escMD(normalizarPlataforma(plataforma).toUpperCase())}\n${identIcon(plataforma)} *${escMD(getIdentLabelLocal(plataforma))}:* ${escMD(acceso)}\n\n¿Está seguro que desea borrarla?`, [
          [{ text: "✅ Sí borrar", callback_data: `mail_delete_confirm|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}` }],
          [{ text: "❌ Cancelar", callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}` }],
        ]);
      }

      if (data.startsWith("mail_delete_confirm|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return mostrarListaCorreosPlataforma(chatId, plataforma);
        const clientes = Array.isArray(found.data?.clientes) ? found.data.clientes : [];
        if (clientes.length > 0) await bot.sendMessage(chatId, "⚠️ Esta cuenta tenía clientes asignados. Se eliminará igualmente del inventario.");
        await found.ref.delete();
        return enviarInventarioPlataforma(chatId, plataforma, 0);
      }

      if (data === "cli:txt:general") return reporteClientesTXTGeneral(chatId);
      if (data === "cli:txt:agenda") return enviarAgendaSimpleClientesTXT(chatId);
      if (data === "cli:txt:vigentes") return enviarClientesPorEstadoTXT(chatId, "vigente");
      if (data === "cli:txt:no_vigentes") return enviarClientesPorEstadoTXT(chatId, "no_vigente");
      if (data === "cli:crm:resumen") return enviarResumenCRMLocal(chatId);
      if (data === "cli:txt:vendedores_split") return reporteClientesSplitPorVendedorTXT(chatId);

      if (data.startsWith("cli:txt:hist:")) return enviarHistorialClienteTXTReal(chatId, data.split(":")[3]);

      if (data.startsWith("cli:txt:one:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        try {
          return enviarTxtComoArchivo(chatId, clienteResumenTXT(c), `cliente_${onlyDigits(c.telefono || "") || clientId}.txt`);
        } catch (_) {
          return bot.sendMessage(chatId, clienteResumenTXT(c));
        }
      }

      if (data.startsWith("cli:view:")) return enviarFichaCliente(chatId, data.split(":")[2]);
      if (data === "cli:wiz:start") { pending.delete(String(chatId)); return wizardStart(chatId); }

      if (data.startsWith("wiz:plat:")) {
        const parts = data.split(":");
        const platRaw = parts[2] || "";
        const clientId = parts[3] || null;
        const plat = normalizarPlataforma(platRaw);
        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, `⚠️ Plataforma inválida en wizard: ${platRaw}`);
        let st = wizard.get(String(chatId));
        if (!st) st = { step: 4, clientId, nombre: "", telefono: "", vendedor: "", servicio: {}, servStep: 1 };
        st.clientId = clientId || st.clientId;
        st.servicio = st.servicio || {};
        st.servicio.plataforma = plat;
        st.servStep = 2;
        st.step = 4;
        wizard.set(String(chatId), st);
        return bot.sendMessage(chatId, `(Servicio 2/5) ${getIdentLabelLocal(plat)} de la cuenta:`);
      }

      if (data.startsWith("wiz:addmore:")) {
        const clientId = data.split(":")[2];
        const current = wizard.get(String(chatId)) || {};
        wizard.set(String(chatId), { step: 4, clientId, nombre: current.nombre || "", telefono: current.telefono || "", vendedor: current.vendedor || "", servicio: {}, servStep: 1 });
        return bot.sendMessage(chatId, "📌 Agregar otro servicio\nSeleccione plataforma:", { reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", clientId) } });
      }

      if (data.startsWith("wiz:finish:")) {
        const clientId = data.split(":")[2];
        wizard.delete(String(chatId));
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:edit:menu:")) return menuEditarCliente(chatId, data.split(":")[3]);

      if (data.startsWith("cli:edit:nombre:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditNombre", clientId });
        return upsertPanel(chatId, "👤 *Editar nombre*\nEscriba el nuevo nombre:", [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]]);
      }

      if (data.startsWith("cli:edit:tel:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditTel", clientId });
        return upsertPanel(chatId, "📱 *Editar teléfono*\nEscriba el nuevo teléfono:", [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]]);
      }

      if (data.startsWith("cli:edit:vend:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditVendedor", clientId });
        return upsertPanel(chatId, "🧑‍💼 *Editar vendedor*\nEscriba el nuevo vendedor:", [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]]);
      }

      // ✅ BORRAR CLIENTE
      if (data.startsWith("cli:del:ask:")) {
        const clientId = data.split(":")[3];
        const c2 = await getCliente(clientId);
        const nombre = c2?.nombrePerfil || "este cliente";
        return upsertPanel(chatId,
          `🗑️ *BORRAR CLIENTE*\n\n👤 *${escMD(nombre)}*\n\n⚠️ Se eliminará el cliente y todo su historial. No se puede deshacer.\n\n¿Confirma borrar a *${escMD(nombre)}*?`,
          [
            [{ text: "✅ Sí, borrar definitivamente", callback_data: `cli:del:ok:${clientId}` }],
            [{ text: "❌ Cancelar", callback_data: `cli:view:${clientId}` }],
          ]
        );
      }

      if (data.startsWith("cli:del:ok:")) {
        const clientId = data.split(":")[3];
        const c2 = await getCliente(clientId);
        const nombre = c2?.nombrePerfil || "Cliente";
        const batch = db.batch();
        batch.delete(db.collection("clientes").doc(clientId));
        const histSnap = await db.collection("historial_clientes").where("clientId", "==", clientId).get();
        histSnap.forEach(d => batch.delete(d.ref));
        await batch.commit();
        const { cacheInvalidatePrefix: cIPDel } = require("./index_01_core");
        cIPDel(`clientes:doc:${clientId}`);
        forceNextPanelAtBottom(chatId);
        return bot.sendMessage(chatId, `✅ Cliente *${escMD(nombre)}* eliminado.`, { parse_mode: "Markdown" });
      }

      if (data.startsWith("cli:serv:list:")) return menuListaServicios(chatId, data.split(":")[3]);
      if (data.startsWith("cli:serv:menu:")) return menuServicio(chatId, data.split(":")[3], Number(data.split(":")[4]));

      if (data.startsWith("cli:serv:add:")) {
        const clientId = data.split(":")[3];
        return upsertPanel(chatId, "➕ *AGREGAR SERVICIO*\nSeleccione plataforma:", [
          ...kbPlataformasWiz("cli:add:plat", clientId),
          [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
        ]);
      }

      if (data.startsWith("cli:add:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[3]);
        const clientId = parts[4];
        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
        pending.set(String(chatId), { mode: "cliAddServMail", clientId, plat });
        return upsertPanel(chatId, `${identIcon(plat)} *${getIdentLabelLocal(plat)}* (${plat})\nEscriba el ${getIdentLabelLocal(plat).toLowerCase()}:`, [[{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }]]);
      }

      if (data.startsWith("cli:serv:edit:")) {
        const parts = data.split(":");
        const field = parts[3];
        const clientId = parts[4];
        const idx = Number(parts[5]);

        if (field === "plat") {
          return upsertPanel(chatId, "📌 *Cambiar plataforma*\nSeleccione:", [
            ...kbPlataformasWiz("cli:serv:set:plat", clientId, idx),
            [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
          ]);
        }

        let platActual = "";
        if (field === "mail") {
          const c = await getCliente(clientId);
          if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
          const servicios = Array.isArray(c.servicios) ? c.servicios : [];
          if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
          platActual = normalizarPlataforma(servicios[idx]?.plataforma || "");
          pending.set(String(chatId), { mode: "cliServEditMail", clientId, idx, plat: platActual });
        }

        if (field === "pin") pending.set(String(chatId), { mode: "cliServEditPin", clientId, idx });
        if (field === "precio") pending.set(String(chatId), { mode: "cliServEditPrecio", clientId, idx });
        if (field === "fecha") pending.set(String(chatId), { mode: "cliServEditFecha", clientId, idx });

        const titulo = field === "mail" ? `${identIcon(platActual)} *Cambiar ${getIdentLabelLocal(platActual).toLowerCase()}*` : field === "pin" ? "🔐 *Cambiar clave/pin*" : field === "precio" ? "💰 *Cambiar precio*" : "📅 *Cambiar fecha*";
        const hint = field === "mail" ? `Escriba el nuevo ${getIdentLabelLocal(platActual).toLowerCase()}:` : field === "precio" ? "Escriba el precio (solo número):" : field === "fecha" ? "Escriba dd/mm/yyyy:" : "Escriba el nuevo valor:";

        return upsertPanel(chatId, `${titulo}\n${hint}`, [[{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }]]);
      }

      if (data.startsWith("cli:serv:set:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[4]);
        const clientId = parts[5];
        const idx = Number(parts[6]);
        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");
        try { await patchServicio(clientId, idx, { plataforma: plat }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo cambiar la plataforma."}`); }
        return menuServicio(chatId, clientId, idx);
      }

      if (data.startsWith("cli:serv:del:ask:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const idx = Number(parts[5]);
        return upsertPanel(chatId, "🗑️ *Eliminar perfil*\nConfirmar borrado de este servicio?", [
          [{ text: "✅ Confirmar", callback_data: `cli:serv:del:ok:${clientId}:${idx}` }],
          [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
        ]);
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
        const servicioABorrar = servicios[idx];
        const plat = normalizarPlataforma(servicioABorrar.plataforma);
        const acceso = normalizeIdentByPlatformLocal(plat, servicioABorrar.correo || "");
        const nombreCliente = c.nombrePerfil || "";
        const refInv = db.collection("inventario").doc(docIdInventarioLocal(acceso, plat));
        const docInv = await refInv.get();
        if (docInv.exists) {
          const invData = docInv.data() || {};
          let clientesInv = Array.isArray(invData.clientes) ? invData.clientes.slice() : [];
          const indexInv = clientesInv.findIndex((cl) => cl.nombre === nombreCliente && cl.pin === servicioABorrar.pin);
          if (indexInv !== -1) {
            clientesInv.splice(indexInv, 1);
            clientesInv = clientesInv.map((cl, i) => ({ ...cl, slot: i + 1 }));
            const capacidad = Number(invData.capacidad || invData.total || 0);
            const ocupados = clientesInv.length;
            const disponibles = capacidad > 0 ? Math.max(0, capacidad - ocupados) : Number(invData.disp || 0) + 1;
            await refInv.set({ clientes: clientesInv, ocupados, disponibles, disp: disponibles, estado: disponibles === 0 ? "llena" : "activa", capacidad, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          }
        }
        servicios.splice(idx, 1);
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        if (servicios.length) return menuListaServicios(chatId, clientId);
        return enviarFichaCliente(chatId, clientId);
      }

      // ✅ LISTA DE SERVICIOS A RENOVAR (ficha del cliente)
      if (data.startsWith("cli:ren:list:")) {
        const clientId = data.split(":")[3];
        return menuListaRenovacion(chatId, clientId);
      }

      // ✅ PANEL DE ACCIÓN — 4 opciones por servicio (desde ficha del cliente)
      if (data.startsWith("cli:ren:one:")) {
        const raw = data.slice("cli:ren:one:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));
        return menuRenovacionServicio(chatId, clientId, idx);
      }

      // ✅ ACCIÓN DESDE PANEL DEL DÍA
      if (data.startsWith("ren:accion:")) {
        const raw = data.slice("ren:accion:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));
        return menuRenovacionServicio(chatId, clientId, idx);
      }

      // ✅ RENOVAR +30 DÍAS
      if (data.startsWith("cli:ren:auto:")) {
        const raw = data.slice("cli:ren:auto:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));
        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        const base = isFechaDMY(String(servicios[idx].fechaRenovacion || "")) ? String(servicios[idx].fechaRenovacion) : hoyDMY();
        servicios[idx] = { ...servicios[idx], fechaRenovacion: addDaysDMY(base, 30) };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const { cacheInvalidatePrefix: cIP } = require("./index_01_core");
        cIP(`clientes:doc:${clientId}`);
        await bot.sendMessage(chatId, `✅ Renovado +30 días\nNueva fecha: *${escMD(servicios[idx].fechaRenovacion)}*`, { parse_mode: "Markdown" });
        return enviarFichaCliente(chatId, clientId);
      }

      // ✅ RENOVAR +31 DÍAS
      if (data.startsWith("cli:ren:auto31:")) {
        const raw = data.slice("cli:ren:auto31:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));
        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        const base31 = isFechaDMY(String(servicios[idx].fechaRenovacion || "")) ? String(servicios[idx].fechaRenovacion) : hoyDMY();
        servicios[idx] = { ...servicios[idx], fechaRenovacion: addDaysDMY(base31, 31) };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const { cacheInvalidatePrefix: cIP31 } = require("./index_01_core");
        cIP31(`clientes:doc:${clientId}`);
        await bot.sendMessage(chatId, `✅ Renovado +31 días\nNueva fecha: *${escMD(servicios[idx].fechaRenovacion)}*`, { parse_mode: "Markdown" });
        return enviarFichaCliente(chatId, clientId);
      }

      // ✅ RENOVAR CON FECHA MANUAL
      if (data.startsWith("cli:ren:manual:")) {
        const raw = data.slice("cli:ren:manual:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));
        pending.set(String(chatId), { mode: "cliRenovarFechaManual", clientId, idx });
        return upsertPanel(chatId,
          "📅 *Renovar — fecha personalizada*\n\n" +
          "Escriba la fecha o los días a sumar:\n\n" +
          "• `dd/mm/yyyy` — fecha exacta\n" +
          "• `+40` — suma 40 días desde la fecha actual del servicio\n" +
          "• `+3m` — suma 3 meses\n" +
          "• `+90` — suma 90 días",
          [[{ text: "⬅️ Cancelar", callback_data: `cli:ren:one:${clientId}:${idx}` }]]
        );
      }

      // ✅ CAMBIÓ DE SERVICIO — elimina el actual y abre wizard para agregar uno nuevo
      if (data.startsWith("cli:ren:cambio:")) {
        const raw = data.slice("cli:ren:cambio:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));
        try {
          const result = await eliminarServicioTx(clientId, idx);
          await bot.sendMessage(chatId,
            `🔄 *Servicio eliminado*\n\n` +
            `📦 ${escMD(humanPlatAlertLocal(result.eliminado?.plataforma || "-"))} — ${escMD(result.eliminado?.correo || "-")}\n` +
            `_El slot en inventario fue liberado._\n\nAhora agregue el nuevo servicio:`,
            { parse_mode: "Markdown" }
          );
          const st = wizard.get(String(chatId)) || {};
          wizard.set(String(chatId), { step: 4, clientId, nombre: result.nombreCliente, telefono: st.telefono || "", vendedor: st.vendedor || "", servicio: {}, servStep: 1 });
          return bot.sendMessage(chatId, "📌 Seleccione la nueva plataforma:", {
            reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", clientId) },
          });
        } catch (e) {
          logErr("cli:ren:cambio", e);
          return bot.sendMessage(chatId, `⚠️ Error: ${e.message}`);
        }
      }

      // ✅ NO RENOVÓ — pedir confirmación antes de eliminar
      if (data.startsWith("cli:ren:noren:ask:")) {
        // Formato: cli:ren:noren:ask:CLIENTID:IDX
        // clientId puede contener caracteres varios — tomamos todo excepto el último segmento
        const raw = data.slice("cli:ren:noren:ask:".length); // "CLIENTID:IDX"
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        const s = servicios[idx] || {};
        return upsertPanel(chatId,
          `❌ *NO RENOVÓ — CONFIRMAR ELIMINACIÓN*\n\n` +
          `👤 *${escMD(c.nombrePerfil || "Cliente")}*\n` +
          `📦 *${escMD(humanPlatAlertLocal(s.plataforma || ""))}*\n` +
          `${identIcon(s.plataforma || "")} ${escMD(s.correo || "-")}\n\n` +
          `_El servicio se eliminará y el slot en inventario quedará libre._\n\n¿Confirmar?`,
          [
            [{ text: "✅ Sí, eliminar", callback_data: `cli:ren:noren:ok:${clientId}:${idx}` }],
            [{ text: "⬅️ Cancelar",    callback_data: `cli:ren:one:${clientId}:${idx}` }],
          ]
        );
      }

      // ✅ NO RENOVÓ — ejecutar eliminación
      if (data.startsWith("cli:ren:noren:ok:")) {
        const raw = data.slice("cli:ren:noren:ok:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));
        try {
          const result = await eliminarServicioTx(clientId, idx);
          await bot.sendMessage(chatId,
            `✅ *Servicio eliminado correctamente*\n\n` +
            `📦 ${escMD(humanPlatAlertLocal(result.eliminado?.plataforma || "-"))} — ${escMD(result.eliminado?.correo || "-")}\n` +
            `_Slot liberado en inventario._`,
            { parse_mode: "Markdown" }
          );
          return enviarFichaCliente(chatId, clientId);
        } catch (e) {
          logErr("cli:ren:noren:ok", e);
          return bot.sendMessage(chatId, `⚠️ Error al eliminar: ${e.message}`);
        }
      }

      if (data.startsWith("cli:ren:all:ask:")) {
        const clientId = data.slice("cli:ren:all:ask:".length);
        return upsertPanel(chatId, "⏫ *Renovar TODOS +30 días*\n\n¿Desea renovar todos los servicios de este cliente?", [
          [{ text: "✅ Confirmar", callback_data: `cli:ren:all:ok:${clientId}` }],
          [{ text: "⬅️ Cancelar", callback_data: `cli:ren:list:${clientId}` }],
        ]);
      }

      if (data.startsWith("cli:ren:all:ok:")) {
        const clientId = data.slice("cli:ren:all:ok:".length);
        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");
        const nuevos = servicios.map((s) => {
          const base = isFechaDMY(String(s.fechaRenovacion || "")) ? String(s.fechaRenovacion) : hoyDMY();
          return { ...s, fechaRenovacion: addDaysDMY(base, 30) };
        });
        await ref.set({ servicios: nuevos, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const { cacheInvalidatePrefix: cIP } = require("./index_01_core");
        cIP(`clientes:doc:${clientId}`);
        await bot.sendMessage(chatId, `✅ Todos los servicios renovados +30 días.`);
        return enviarFichaCliente(chatId, clientId);
      }

      // ✅ RENOVAR TODOS +31 DÍAS
      if (data.startsWith("cli:ren:all31:ask:")) {
        const clientId = data.slice("cli:ren:all31:ask:".length);
        return upsertPanel(chatId, "⏫ *Renovar TODOS +31 días*\n\n¿Desea renovar todos los servicios de este cliente?", [
          [{ text: "✅ Confirmar", callback_data: `cli:ren:all31:ok:${clientId}` }],
          [{ text: "⬅️ Cancelar", callback_data: `cli:ren:list:${clientId}` }],
        ]);
      }

      if (data.startsWith("cli:ren:all31:ok:")) {
        const clientId = data.slice("cli:ren:all31:ok:".length);
        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");
        const nuevos31 = servicios.map((s) => {
          const base = isFechaDMY(String(s.fechaRenovacion || "")) ? String(s.fechaRenovacion) : hoyDMY();
          return { ...s, fechaRenovacion: addDaysDMY(base, 31) };
        });
        await ref.set({ servicios: nuevos31, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const { cacheInvalidatePrefix: cIP31 } = require("./index_01_core");
        cIP31(`clientes:doc:${clientId}`);
        await bot.sendMessage(chatId, `✅ Todos los servicios renovados +31 días.`);
        return enviarFichaCliente(chatId, clientId);
      }

      // ✅ BAJA MASIVA — mostrar servicios con checkboxes para seleccionar cuáles eliminar
      if (data.startsWith("cli:baja:menu:")) {
        const clientId = data.slice("cli:baja:menu:".length);
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

        // Inicializar selección vacía en pending
        pending.set(String(chatId), { mode: "bajaMasiva", clientId, seleccionados: [] });

        let txt = `🗑️ *BAJA MASIVA DE SERVICIOS*\n👤 *${escMD(c.nombrePerfil || "Cliente")}*\n\n`;
        txt += `Seleccione los servicios a *eliminar* (los que NO renovaron).\nLuego presione *Confirmar eliminación*.\n\n`;
        txt += `_Ninguno seleccionado aún._`;

        const kb = servicios.map((s, i) => [{
          text: `⬜ ${humanPlatAlertLocal(s.plataforma || "")} — ${s.fechaRenovacion || "sin fecha"}`,
          callback_data: `cli:baja:toggle:${clientId}:${i}`,
        }]);
        kb.push([{ text: "🗑️ Confirmar eliminación", callback_data: `cli:baja:confirm:${clientId}` }]);
        kb.push([{ text: "⬅️ Volver renovaciones",   callback_data: `cli:ren:list:${clientId}` }]);

        return upsertPanel(chatId, txt, kb);
      }

      // ✅ BAJA MASIVA — toggle selección de un servicio
      if (data.startsWith("cli:baja:toggle:")) {
        const raw = data.slice("cli:baja:toggle:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const idx = Number(raw.slice(lastColon + 1));

        const ctx = pending.get(String(chatId));
        if (!ctx || ctx.mode !== "bajaMasiva" || ctx.clientId !== clientId) {
          // Reiniciar si el contexto expiró
          return bot.sendMessage(chatId, "⚠️ La sesión expiró. Abra baja masiva de nuevo desde el menú de renovaciones.");
        }

        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];

        // Toggle idx en la lista de seleccionados
        const sel = new Set(ctx.seleccionados || []);
        if (sel.has(idx)) sel.delete(idx);
        else sel.add(idx);
        ctx.seleccionados = Array.from(sel);
        pending.set(String(chatId), ctx);

        // Reconstruir panel con checkboxes actualizados
        const selCount = ctx.seleccionados.length;
        let txt = `🗑️ *BAJA MASIVA DE SERVICIOS*\n👤 *${escMD(c.nombrePerfil || "Cliente")}*\n\n`;
        txt += `Seleccione los servicios a *eliminar*.\nLuego presione *Confirmar eliminación*.\n\n`;
        if (selCount === 0) txt += `_Ninguno seleccionado._`;
        else txt += `*${selCount} seleccionado(s) para eliminar.*`;

        const kb = servicios.map((s, i) => {
          const marcado = sel.has(i);
          return [{
            text: `${marcado ? "✅" : "⬜"} ${humanPlatAlertLocal(s.plataforma || "")} — ${s.fechaRenovacion || "sin fecha"}`,
            callback_data: `cli:baja:toggle:${clientId}:${i}`,
          }];
        });
        kb.push([{ text: `🗑️ Confirmar eliminación${selCount ? ` (${selCount})` : ""}`, callback_data: `cli:baja:confirm:${clientId}` }]);
        kb.push([{ text: "⬅️ Volver renovaciones", callback_data: `cli:ren:list:${clientId}` }]);

        return upsertPanel(chatId, txt, kb);
      }

      // ✅ BAJA MASIVA — confirmar y ejecutar eliminación
      if (data.startsWith("cli:baja:confirm:")) {
        const clientId = data.slice("cli:baja:confirm:".length);
        const ctx = pending.get(String(chatId));

        if (!ctx || ctx.mode !== "bajaMasiva" || ctx.clientId !== clientId) {
          return bot.sendMessage(chatId, "⚠️ La sesión expiró. Abra baja masiva de nuevo.");
        }

        const seleccionados = Array.isArray(ctx.seleccionados) ? ctx.seleccionados : [];
        if (!seleccionados.length) {
          return bot.sendMessage(chatId, "⚠️ No seleccionó ningún servicio. Toque los que desea eliminar primero.");
        }

        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];

        // Eliminar de mayor a menor índice para no desfasar el array
        const indices = [...seleccionados].sort((a, b) => b - a);
        const eliminados = [];

        for (const idx of indices) {
          if (idx < 0 || idx >= servicios.length) continue;
          const s = servicios[idx];
          eliminados.push(s);
          servicios.splice(idx, 1);
          // Liberar slot en inventario
          try {
            const { db: dbCore, admin: adminCore } = require("./index_01_core");
            const { removeServicioDeInventario: removeInv } = require("./index_03_clientes_crm");
            await removeInv({ clienteNombre: c.nombrePerfil || "", plataforma: s.plataforma || "", correo: s.correo || "", pin: s.pin || "" });
          } catch (e) { logErr("bajaMasiva.removeInv", e); }
        }

        // Guardar servicios restantes
        const ref = db.collection("clientes").doc(String(clientId));
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const { cacheInvalidatePrefix: cIP } = require("./index_01_core");
        cIP(`clientes:doc:${clientId}`);
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);

        let msg = `✅ *Baja masiva completada*\n\n`;
        msg += `*Eliminados (${eliminados.length}):*\n`;
        eliminados.forEach((s) => { msg += `• ${escMD(humanPlatAlertLocal(s.plataforma || ""))} — ${escMD(s.correo || "-")}\n`; });
        msg += `\n*Servicios restantes:* ${servicios.length}`;

        await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
        return enviarFichaCliente(chatId, clientId);
      }

      if (data === "txt:todos:hoy") {
        if (!(await safeIsSuperAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPERADMIN.");
        return enviarTXTATodosHoy(chatId);
      }
    }

    if (data === "ren:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      // ✅ Admin ve panel con botones de acción. Vendedor ve texto simple.
      if (adminOk) return enviarPanelRenovacionesConAcciones(chatId, fecha, list);
      return bot.sendMessage(chatId, renovacionesTexto(list, fecha, vend?.nombre), { parse_mode: "Markdown" });
    }

    if (data === "txt:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      return enviarTXT(chatId, list, fecha, adminOk ? null : vend?.nombre);
    }

    if (data === "ren:mis:hoy") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      if (!list.length) return upsertPanel(chatId,
        `📅 *RENOVACIONES HOY — ${escMD(fecha)}*\n👤 ${escMD(vend.nombre)}\n\n_Sin renovaciones para hoy._`,
        [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]
      );
      let total = 0; list.forEach(x => { total += Number(x.precio || 0); });
      let txt = `📅 *RENOVACIONES HOY — ${escMD(fecha)}*\n`;
      txt += `👤 *${escMD(vend.nombre)}* · 👥 *${list.length}* · 💰 *${escMD(total.toFixed(2))} Lps*\n\n`;
      list.forEach((x, i) => {
        txt += `*${i + 1}.* ${iconPlataforma(x.plataforma || "")} ${escMD(x.nombrePerfil || "Sin nombre")}\n`;
        txt += `   📱 ${escMD(x.telefono || "-")} · 💰 ${escMD(Number(x.precio || 0).toFixed(2))} Lps\n`;
      });
      const kb = list.slice(0, 20).map((x, i) => [{
        text: `${i + 1}) ${(x.nombrePerfil || "Sin nombre").slice(0, 22)} • ${humanPlataforma(x.plataforma || "")}`,
        callback_data: `cli:view:${x.clientId || x.id || ""}`,
      }]);
      kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
      return upsertPanel(chatId, txt, kb);
    }

    if (data === "ren:mis:prox3") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = addDaysDMY(hoyDMY(), 3);
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      if (!list.length) return upsertPanel(chatId,
        `⏳ *RENOVACIONES EN 3 DÍAS — ${escMD(fecha)}*\n👤 ${escMD(vend.nombre)}\n\n_Sin renovaciones._`,
        [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]
      );
      let total = 0; list.forEach(x => { total += Number(x.precio || 0); });
      let txt = `⏳ *RENOVACIONES EN 3 DÍAS — ${escMD(fecha)}*\n`;
      txt += `👤 *${escMD(vend.nombre)}* · 👥 *${list.length}* · 💰 *${escMD(total.toFixed(2))} Lps*\n\n`;
      list.forEach((x, i) => {
        txt += `*${i + 1}.* ${iconPlataforma(x.plataforma || "")} ${escMD(x.nombrePerfil || "Sin nombre")}\n`;
        txt += `   📱 ${escMD(x.telefono || "-")} · 💰 ${escMD(Number(x.precio || 0).toFixed(2))} Lps\n`;
      });
      const kb = list.slice(0, 20).map((x, i) => [{
        text: `${i + 1}) ${(x.nombrePerfil || "Sin nombre").slice(0, 22)} • ${humanPlataforma(x.plataforma || "")}`,
        callback_data: `cli:view:${x.clientId || x.id || ""}`,
      }]);
      kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
      return upsertPanel(chatId, txt, kb);
    }

    if (data === "txt:mis") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const sent = await enviarTxtRenovacionesVendedorPro(chatId, vend.nombre);
      if (!sent) return bot.sendMessage(chatId, "ℹ️ No tiene renovaciones para hoy ni para dentro de 3 días.");
      return;
    }

    if (data === "vend:clientes") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const { enviarMisClientes } = require("./index_03_clientes_crm");
      return enviarMisClientes(chatId, vend.nombre);
    }

    if (data === "vend:clientes:txt") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const { enviarMisClientesTXT } = require("./index_03_clientes_crm");
      return enviarMisClientesTXT(chatId, vend.nombre);
    }

    if (data === "vend:resumen") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      return enviarResumenVendedorPro(chatId, vend.nombre);
    }

    if (data === "rev:lista") return listarRevendedores(chatId);

    // ✅ Ver ficha de cliente desde búsqueda del vendedor
    if (data.startsWith("vend:cli:")) {
      const clientId = data.slice("vend:cli:".length);
      return enviarFichaClienteVendedor(chatId, clientId, "vend:buscar");
    }

    if (data === "rev:add:start") {
      pending.set(String(chatId), { mode: "revAddNombre" });
      return upsertPanel(chatId,
        "➕ *AGREGAR REVENDEDOR*\n\nEscriba el *nombre* del revendedor:",
        [[{ text: "❌ Cancelar", callback_data: "menu:revendedores" }]]
      );
    }

    if (data.startsWith("rev:del:ask:")) {
      const docId = data.split(":")[3];
      const snap2 = await db.collection("revendedores").doc(docId).get();
      const nombre = snap2.exists ? (snap2.data()?.nombre || docId) : docId;
      return upsertPanel(chatId,
        `🗑️ *ELIMINAR REVENDEDOR*\n\n👤 *${escMD(nombre)}*\n\n¿Confirma eliminación?`,
        [
          [{ text: "✅ Sí, eliminar", callback_data: `rev:del:ok:${docId}` }],
          [{ text: "❌ Cancelar",     callback_data: "menu:revendedores" }],
        ]
      );
    }

    if (data.startsWith("rev:del:ok:")) {
      const docId = data.split(":")[3];
      const snap2 = await db.collection("revendedores").doc(docId).get();
      const nombre = snap2.exists ? (snap2.data()?.nombre || docId) : docId;
      await db.collection("revendedores").doc(docId).delete();
      invalidarCacheRevendedores();
      forceNextPanelAtBottom(chatId);
      await bot.sendMessage(chatId, `✅ Revendedor *${escMD(nombre)}* eliminado.`, { parse_mode: "Markdown" });
      return menuGestionRevendedores(chatId);
    }

    if (data === "vend:vencidos") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const rows = await getAlertaClientesLocal("vencidos");
      const misVencidos = rows.filter(x => normVendorText(x.vendedor || "") === normVendorText(vend.nombre || ""));
      if (!misVencidos.length) return upsertPanel(chatId,
        `🔴 *MIS VENCIDOS*\n👤 ${escMD(vend.nombre)}\n\n✅ _No tiene clientes vencidos._`,
        [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]
      );
      let txt = `🔴 *MIS VENCIDOS*\n👤 *${escMD(vend.nombre)}*\n*Total: ${misVencidos.length}*\n\n`;
      misVencidos.forEach((x, i) => {
        txt += `*${i + 1}.* ${escMD(x.nombrePerfil || "Sin nombre")}\n`;
        txt += `   📦 ${escMD(humanPlatAlertLocal(x.plataforma || ""))} · 📅 ${escMD(x.fechaRenovacion || "-")} · ⏰ ${x.atrasoDias}d\n`;
      });
      const kb = misVencidos.slice(0, 20).map((x, i) => [{
        text: `${i + 1}) ${(x.nombrePerfil || "Sin nombre").slice(0, 24)} • ${x.atrasoDias}d`,
        callback_data: `cli:view:${x.clientId}`,
      }]);
      kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
      return upsertPanel(chatId, txt, kb);
    }

    if (data === "vend:buscar") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      pending.set(String(chatId), { mode: "vendBuscarCliente" });
      return upsertPanel(chatId,
        "🔍 *BUSCAR CLIENTE*\n\nEscriba el nombre o teléfono del cliente:",
        [[{ text: "❌ Cancelar", callback_data: "go:inicio" }]]
      );
    }

    if (data === "vend:precios") {
      const PRECIOS = [
        { plat: "Netflix",      precio: "L. 270" }, { plat: "Disney+",     precio: "L. 120" },
        { plat: "HBO Max",      precio: "L. 130" }, { plat: "Prime Video", precio: "L. 90"  },
        { plat: "Paramount+",   precio: "L. 90"  }, { plat: "Crunchyroll", precio: "L. 90"  },
        { plat: "Apple TV",     precio: "L. 90"  }, { plat: "Spotify",     precio: "L. 90"  },
        { plat: "YouTube",      precio: "L. 90"  }, { plat: "Canva",       precio: "L. 90"  },
        { plat: "ChatGPT",      precio: "L. 160" }, { plat: "Gemini",      precio: "L. 90"  },
        { plat: "IPTV",         precio: "L. 150" },
      ];
      let txt = "💲 *LISTA DE PRECIOS — REVENDEDOR*\n\n";
      PRECIOS.forEach(p => { txt += `• ${escMD(p.plat)}: *${escMD(p.precio)}*\n`; });
      txt += "\n_Precios por perfil mensual._";
      return upsertPanel(chatId, txt, [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]);
    }

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    logErr("callback_query", err?.stack || err?.message || err);
    if (chatId) {
      try { await bot.sendMessage(chatId, "⚠️ Error interno (revise logs)."); } catch (_) {}
    }
  }
});

// ===============================
// ✅ FIX MESSAGE HANDLER: texto libre activa búsqueda para admins
// ===============================
bot.on("message", async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = String(msg.text || "");
  const textClean = String(text || "").trim();
  if (!chatId) return;

  // Modo app: los textos de navegación los atienden los atajos bot.onText.
  // Aquí se detienen para que NO disparen búsqueda ni "Sin resultados".
  if (isNavigationTextLocal(textClean)) {
    return sendBottomMainMenu(chatId, userId, true);
  }

  try {
    if (!(await userHasAccessFromMessage(msg))) return;

    // Modo app: mantener el panel anclado, no crear mensaje nuevo.

    const adminOk = await safeIsAdminLocal(userId);
    const vendOk = await safeIsVendedorLocal(userId);

    // Si hay wizard activo y mandan un comando que no sea menu/start, avisar
    if (wizard.has(String(chatId)) && text.startsWith("/")) {
      const cmdWizard = limpiarComandoTexto(text).split(" ")[0];
      if (cmdWizard !== "menu" && cmdWizard !== "start") {
        return bot.sendMessage(chatId, "⚠️ Está en creación de cliente.\nPrimero toque *➕ Agregar otra* o *✅ Finalizar*.", { parse_mode: "Markdown" });
      }
    }

    if (text.startsWith("/")) {
      if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");

      const rawCmd = String(text || "").trim().replace(/^\/+/, "");
      const partsCmd = rawCmd.split(/\s+/).filter(Boolean);
      const first = String(partsCmd[0] || "").toLowerCase();
      const rest = String(rawCmd.slice((partsCmd[0] || "").length) || "").trim();

      const vendedorCmd = new Set(["menu", "start", "miid", "id", "vincular_vendedor", "renovaciones", "txt"]);
      if (!adminOk && vendOk && !vendedorCmd.has(first)) return;

      if (adminOk && PLATFORM_KEYS.includes(first)) {
        return enviarInventarioPlataforma(chatId, first, 0);
      }

      if (adminOk && first === "buscar" && rest) {
        return resolverBusquedaAdmin(chatId, rest);
      }

      const comandosReservados = new Set([
        "start", "menu", "stock", "buscar", "cliente", "renovaciones", "txt",
        "clientes_txt", "vendedores_txt_split", "reindex_clientes", "fix_duplicados",
        "add", "del", "editclave", "adminadd", "admindel", "adminlist",
        "addvendedor", "delvendedor", "id", "miid", "vincular_vendedor",
        "sincronizar_todo", "addcorreo", "finanzas", "resumen_fecha", "bancos_mes",
        "top_plataformas_mes", "cierre_caja", "cierre_caja_rango", "excel_finanzas",
        "editar_movimiento",
        // ✅ Comandos IMAP — no pasar a resolverBusquedaAdmin
        "code", "link", "hogar", "prime", "inbox", "debug",
        ...PLATFORM_KEYS,
      ]);

      if (adminOk && !comandosReservados.has(first)) {
        return resolverBusquedaAdmin(chatId, rawCmd);
      }

      return;
    }

    // ── Búsqueda directa sin / desde cualquier panel ──
    // Permite buscar correo, nombre o teléfono sin escribir "menu".
    // Solo se bloquea si hay un flujo que realmente está esperando respuesta.
    if (adminOk && !text.startsWith("/")) {
      const tSearch = String(text || "").trim();
      const pSearch = pending.get(String(chatId));
      const pendingMode = String(pSearch?.mode || "");
      const pendingBloqueaBusqueda = !!(pSearch && !["invSubmenuCtx"].includes(pendingMode));
      const pareceBusqueda =
        isEmailLike(tSearch) ||
        onlyDigits(tSearch).length >= 7 ||
        normalizeLooseText(tSearch).length >= 2;

      if (pareceBusqueda && !wizard.has(String(chatId)) && !pendingBloqueaBusqueda) {
        return resolverBusquedaAdmin(chatId, tSearch);
      }
    }

    // ── Flujo wizard (texto libre, admin) ──
    if (wizard.has(String(chatId))) {
      if (!adminOk) return;
      return wizardNext(chatId, text);
    }

    // ── Flujo pending (texto libre, admin) ──
    if (pending.has(String(chatId))) {
      if (!adminOk) return;

      const p = pending.get(String(chatId));
      const t = String(text || "").trim();

      if (p.mode === "finEliminarFechaAsk") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use *dd/mm/yyyy*.\nEjemplo: *23/03/2026*", { parse_mode: "Markdown" });
        const isSuper = await safeIsSuperAdminLocal(userId);
        const listFecha = await getMovimientosPorFecha(fecha, userId, isSuper);
        const list = (Array.isArray(listFecha) ? listFecha : []).filter((x) => String(x.tipo || "").toLowerCase() === String(p.tipo || "").toLowerCase());
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        if (!list.length) {
          return upsertPanel(chatId, `⚠️ No encontré *${p.tipo === "egreso" ? "egresos" : "ingresos"}* en la fecha *${escMD(fecha)}*.`, [
            [{ text: p.tipo === "egreso" ? "➖ Buscar otra fecha" : "➕ Buscar otra fecha", callback_data: p.tipo === "egreso" ? "fin:menu:eliminar:egreso" : "fin:menu:eliminar:ingreso" }],
            [{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }],
            [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
          ]);
        }
        const kb = list.slice(0, 40).map((m) => [{ text: textoBtnEliminarMovimiento(m), callback_data: `fin:del:pick:${m.id}` }]);
        kb.push([{ text: p.tipo === "egreso" ? "➖ Buscar otra fecha" : "➕ Buscar otra fecha", callback_data: p.tipo === "egreso" ? "fin:menu:eliminar:egreso" : "fin:menu:eliminar:ingreso" }]);
        kb.push([{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
        return upsertPanel(chatId, `🗑️ *${p.tipo === "egreso" ? "EGRESOS" : "INGRESOS"} DEL ${escMD(fecha)}*\n\nSeleccione el movimiento que desea borrar:`, kb);
      }

      if (p.mode === "finIngresoMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) return bot.sendMessage(chatId, "⚠️ Monto inválido. Escriba solo número.");
        pending.set(String(chatId), { mode: "finIngresoBancoPick", monto });
        return bot.sendMessage(chatId, "🏦 Seleccione el banco:", { reply_markup: kbBancosFinanzas() });
      }

      if (p.mode === "finIngresoPlataformaManual") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la plataforma o plataformas manualmente.");
        pending.set(String(chatId), { mode: "finIngresoDetalle", monto: p.monto, banco: p.banco, plataforma: t });
        return bot.sendMessage(chatId, "📝 Escriba el detalle del ingreso:");
      }

      if (p.mode === "finIngresoDetalle") {
        pending.set(String(chatId), { mode: "finIngresoFecha", monto: p.monto, banco: p.banco, plataforma: p.plataforma, detalle: p.detalle || t });
        return bot.sendMessage(chatId, "📅 Escriba la fecha del ingreso en formato dd/mm/yyyy o escriba hoy:");
      }

      if (p.mode === "finIngresoFecha") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");
        // ✅ Bloquear fechas de meses futuros
        const vf = validarFechaFinanzas(fecha);
        if (!vf.ok) return bot.sendMessage(chatId, vf.msg, { parse_mode: "Markdown" });
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const ok = await registrarIngresoTx({ monto: p.monto, banco: p.banco, plataforma: p.plataforma, detalle: p.detalle || "", fecha, userId, userName: msg.from?.first_name || "" });
        return bot.sendMessage(chatId, `✅ *Ingreso registrado*\n\n💰 Monto: ${moneyLps(ok.monto)}\n🏦 Banco: ${escMD(ok.banco)}\n📦 Plataforma(s): ${escMD(ok.plataforma || "-")}\n📝 Detalle: ${escMD(ok.detalle || "-")}\n📅 Fecha: ${escMD(ok.fecha)}\n🆔 ID: \`${ok.id}\``, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[{ text: "➕ Registrar otro ingreso", callback_data: "fin:otro:ingreso" }], [{ text: "⬅️ Volver a Finanzas", callback_data: "menu:pagos" }], [{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
        });
      }

      if (p.mode === "finEgresoMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) return bot.sendMessage(chatId, "⚠️ Monto inválido. Escriba solo número.");
        pending.set(String(chatId), { mode: "finEgresoMotivoPick", monto });
        return bot.sendMessage(chatId, "🧾 Seleccione el motivo del egreso:", { reply_markup: kbMotivosFinanzas() });
      }

      if (p.mode === "finEgresoDetalle") {
        pending.set(String(chatId), { mode: "finEgresoFecha", monto: p.monto, motivo: p.motivo, banco: p.banco, detalle: t });
        return bot.sendMessage(chatId, "📅 Escriba la fecha del egreso en formato dd/mm/yyyy o escriba hoy:");
      }

      if (p.mode === "finEgresoFecha") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");
        // ✅ Bloquear fechas de meses futuros
        const vf2 = validarFechaFinanzas(fecha);
        if (!vf2.ok) return bot.sendMessage(chatId, vf2.msg, { parse_mode: "Markdown" });
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const ok = await registrarEgresoTx({ monto: p.monto, banco: p.banco, motivo: p.motivo, detalle: p.detalle || "", fecha, userId, userName: msg.from?.first_name || "" });
        return bot.sendMessage(chatId, `✅ *Egreso registrado*\n\n💸 Monto: ${moneyLps(ok.monto)}\n🏦 Banco: ${escMD(ok.banco || "-")}\n🧾 Motivo: ${escMD(ok.motivo)}\n📝 Detalle: ${escMD(ok.detalle || "-")}\n📅 Fecha: ${escMD(ok.fecha)}\n🆔 ID: \`${ok.id}\``, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[{ text: "➕ Registrar otro egreso", callback_data: "fin:otro:egreso" }], [{ text: "⬅️ Volver a Finanzas", callback_data: "menu:pagos" }], [{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
        });
      }

      if (p.mode === "finResumenFechaAsk") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorFecha(fecha, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenFinanzasTextoPorFecha(fecha, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finResumenRangoInicio") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.set(String(chatId), { mode: "finResumenRangoFin", fechaInicio: fecha });
        return bot.sendMessage(chatId, "📅 Escriba la fecha final en formato dd/mm/yyyy:");
      }

      if (p.mode === "finResumenRangoFin") {
        const fechaFin = parseFechaFlexible(t);
        if (!fechaFin) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorRango(p.fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenFinanzasTextoPorRango(p.fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finBancosFechaAsk") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorFecha(fecha, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenBancosFechaTexto(fecha, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finBancosRangoInicio") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.set(String(chatId), { mode: "finBancosRangoFin", fechaInicio: fecha });
        return bot.sendMessage(chatId, "📅 Escriba la fecha final en formato dd/mm/yyyy:");
      }

      if (p.mode === "finBancosRangoFin") {
        const fechaFin = parseFechaFlexible(t);
        if (!fechaFin) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorRango(p.fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenBancosRangoTexto(p.fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finDetalleBancoNombreAsk") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nombre del banco.");
        pending.set(String(chatId), { mode: "finDetalleBancoInicio", banco: t });
        return bot.sendMessage(chatId, "📅 Escriba la fecha inicial en formato dd/mm/yyyy:");
      }

      if (p.mode === "finDetalleBancoInicio") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.set(String(chatId), { mode: "finDetalleBancoFin", banco: p.banco, fechaInicio: fecha });
        return bot.sendMessage(chatId, "📅 Escriba la fecha final en formato dd/mm/yyyy:");
      }

      if (p.mode === "finDetalleBancoFin") {
        const fechaFin = parseFechaFlexible(t);
        if (!fechaFin) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorRango(p.fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, detalleBancoRangoTexto(p.banco, p.fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finTopPlataformasRangoInicio") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.set(String(chatId), { mode: "finTopPlataformasRangoFin", fechaInicio: fecha });
        return bot.sendMessage(chatId, "📅 Escriba la fecha final en formato dd/mm/yyyy:");
      }

      if (p.mode === "finTopPlataformasRangoFin") {
        const fechaFin = parseFechaFlexible(t);
        if (!fechaFin) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorRango(p.fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenTopPlataformasRangoTexto(p.fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finTopCombosRangoInicio") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.set(String(chatId), { mode: "finTopCombosRangoFin", fechaInicio: fecha });
        return bot.sendMessage(chatId, "📅 Escriba la fecha final en formato dd/mm/yyyy:");
      }

      if (p.mode === "finTopCombosRangoFin") {
        const fechaFin = parseFechaFlexible(t);
        if (!fechaFin) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorRango(p.fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenTopCombosRangoTexto(p.fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finResumenBancoMesAsk") {
        const key = parseMonthInputToKey(t);
        if (!key) return bot.sendMessage(chatId, "⚠️ Mes inválido. Use mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorMes(key, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenBancosMesTexto(key, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finTopPlataformasMesAsk") {
        const key = parseMonthInputToKey(t);
        if (!key) return bot.sendMessage(chatId, "⚠️ Mes inválido. Use mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorMes(key, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenTopPlataformasTexto(key, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finCierreCajaAsk") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorFecha(fecha, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, cierreCajaTexto(fecha, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finCierreCajaRangoInicio") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.set(String(chatId), { mode: "finCierreCajaRangoFin", fechaInicio: fecha });
        return bot.sendMessage(chatId, "📅 Escriba la *fecha final* en formato dd/mm/yyyy:", { parse_mode: "Markdown" });
      }

      if (p.mode === "finCierreCajaRangoFin") {
        const fechaFin = parseFechaFlexible(t);
        if (!fechaFin) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const list = await getMovimientosPorRango(p.fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, cierreCajaTextoRango(p.fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finExcelRangoInicio") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.set(String(chatId), { mode: "finExcelRangoFin", fechaInicio: t });
        return bot.sendMessage(chatId, "📅 Escriba la fecha final en formato dd/mm/yyyy:");
      }

      if (p.mode === "finExcelRangoFin") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        return exportarFinanzasRangoExcel(chatId, p.fechaInicio, t, userId, await safeIsSuperAdminLocal(userId));
      }

      if (p.mode === "finEditMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) return bot.sendMessage(chatId, "⚠️ Monto inválido.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ monto: Number(monto), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Monto actualizado correctamente.");
      }

      if (p.mode === "finEditBanco") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el banco.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ banco: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Banco actualizado correctamente.");
      }

      if (p.mode === "finEditMotivo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el motivo.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ motivo: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Motivo actualizado correctamente.");
      }

      if (p.mode === "finEditPlataforma") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la plataforma.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ plataforma: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Plataforma actualizada correctamente.");
      }

      if (p.mode === "finEditDetalle") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el detalle.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ detalle: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Detalle actualizado correctamente.");
      }

      if (p.mode === "finEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ fecha: t, fechaTS: parseDMYtoTS(t), mesKey: getMonthKeyFromDMY(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Fecha actualizada correctamente.");
      }

      if (p.mode === "mailAddClienteNombre") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nombre del cliente.");
        pending.set(String(chatId), { mode: "mailAddClientePin", plataforma: p.plataforma, correo: p.correo, nombre: t });
        return bot.sendMessage(chatId, "🔐 Escriba el PIN del cliente:");
      }

      if (p.mode === "mailAddClientePin") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el PIN.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];
        const capacidad = getCapacidadCorreo(correoData, p.plataforma);
        const disponiblesActual = Math.max(0, capacidad - clientes.length);
        if (disponiblesActual <= 0) return bot.sendMessage(chatId, "❌ Esta cuenta ya está llena.");
        clientes.push({ nombre: p.nombre, pin: t, slot: clientes.length + 1 });
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        await ref.set({ clientes, ocupados, disponibles, disp: disponibles, estado: disponibles === 0 ? "llena" : "activa", capacidad, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await bot.sendMessage(chatId, `✅ *Cliente agregado correctamente*\n\n👤 *Nombre:* ${escMD(p.nombre)}\n🔐 *PIN:* ${escMD(t)}\n\n👤 *Ocupados:* ${ocupados}/${capacidad}\n✅ *Disponibles:* ${disponibles}\n📊 *Estado:* ${escMD(disponibles === 0 ? "LLENA" : "CON ESPACIO")}`, { parse_mode: "Markdown" });
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditPin") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nuevo PIN.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const ref = found.ref;
        const clientes = Array.isArray(found.data?.clientes) ? found.data.clientes.slice() : [];
        if (p.clienteIndex < 0 || p.clienteIndex >= clientes.length) return bot.sendMessage(chatId, "❌ Cliente inválido.");
        clientes[p.clienteIndex] = { ...clientes[p.clienteIndex], pin: t };
        await ref.set({ clientes, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await bot.sendMessage(chatId, "✅ PIN actualizado correctamente.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditClaveCorreo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la nueva clave.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        await found.ref.set({ clave: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await bot.sendMessage(chatId, "✅ Clave de la cuenta actualizada.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditCorreoCuenta") {
        if (!isEmailLike(t)) return bot.sendMessage(chatId, "⚠️ Correo inválido. Escriba un correo válido.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const nuevoCorreo = normalizeIdentByPlatformLocal(p.plataforma, t);
        const nuevaRef = db.collection("inventario").doc(docIdInventarioLocal(nuevoCorreo, p.plataforma));
        const nuevaDoc = await nuevaRef.get();

        if (nuevaDoc.exists && nuevaRef.id !== found.ref.id) {
          return bot.sendMessage(chatId, "⚠️ Ya existe una cuenta con ese correo en esta plataforma.");
        }

        const dataCuenta = { ...(found.data || {}) };
        dataCuenta.correo = nuevoCorreo;
        dataCuenta.ident = nuevoCorreo;
        dataCuenta.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await nuevaRef.set(dataCuenta, { merge: true });
        if (nuevaRef.id !== found.ref.id) {
          await found.ref.delete();
        }

        await bot.sendMessage(chatId, "✅ Correo de la cuenta actualizado.");
        return mostrarPanelCorreo(chatId, p.plataforma, nuevoCorreo);
      }

      // ✅ AGREGAR REVENDEDOR — paso 1: nombre
      // ✅ BÚSQUEDA DE CLIENTE PARA VENDEDOR
      if (p.mode === "vendBuscarCliente") {
        pending.delete(String(chatId));
        forceNextPanelAtBottom(chatId);
        if (!t || t.length < 2) return bot.sendMessage(chatId, "⚠️ Escriba al menos 2 caracteres.");
        const { buscarClienteRobusto } = require("./index_03_clientes_crm");
        const resultados = await buscarClienteRobusto(t);
        if (!resultados.length) {
          return upsertPanel(chatId,
            `🔍 Sin resultados para *${escMD(t)}*`,
            [[{ text: "🔍 Buscar de nuevo", callback_data: "vend:buscar" }, { text: "🏠 Inicio", callback_data: "go:inicio" }]]
          );
        }
        if (resultados.length === 1) {
          return enviarFichaClienteVendedor(chatId, resultados[0].id, "vend:buscar");
        }
        // Varios resultados — mostrar lista
        const kb = resultados.slice(0, 20).map(r => [{
          text: `👤 ${(r.nombrePerfil || "Sin nombre").slice(0, 25)} • ${r.telefono || "-"}`,
          callback_data: `vend:cli:${r.id}`,
        }]);
        kb.push([{ text: "🔍 Nueva búsqueda", callback_data: "vend:buscar" }, { text: "🏠 Inicio", callback_data: "go:inicio" }]);
        return upsertPanel(chatId, `🔍 *RESULTADOS — "${escMD(t)}"*\n\n${resultados.length} cliente(s) encontrado(s):`, kb);
      }

      if (p.mode === "revAddNombre") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nombre.");
        pending.set(String(chatId), { mode: "revAddTelegramId", nombre: t.trim() });
        return upsertPanel(chatId,
          `➕ *AGREGAR REVENDEDOR*\n👤 *${escMD(t.trim())}*\n\nEscriba el *ID de Telegram* (número):`,
          [[{ text: "❌ Cancelar", callback_data: "menu:revendedores" }]]
        );
      }

      // ✅ AGREGAR REVENDEDOR — paso 2: ID Telegram
      if (p.mode === "revAddTelegramId") {
        const telegramId = t.trim().replace(/[^0-9]/g, "");
        if (!telegramId || telegramId.length < 5) return bot.sendMessage(chatId, "⚠️ ID inválido. Debe ser un número (ej: 123456789).");
        pending.delete(String(chatId));
        forceNextPanelAtBottom(chatId);
        const nombre = p.nombre || "Sin nombre";
        const docId = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ");
        await db.collection("revendedores").doc(docId).set({
          nombre, nombre_norm: docId, telegramId: String(telegramId), activo: true,
          autoLastSent: "", createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        invalidarCacheRevendedores();
        await bot.sendMessage(chatId, `✅ Revendedor *${escMD(nombre)}* agregado.\n🆔 ${escMD(telegramId)}`, { parse_mode: "Markdown" });
        return menuGestionRevendedores(chatId);
      }

      if (p.mode === "invNewCorreo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el correo.");
        const correoNorm = normalizeIdentByPlatformLocal(p.plat, t);
        const ref = db.collection("inventario").doc(docIdInventarioLocal(correoNorm, p.plat));
        const doc = await ref.get();
        if (doc.exists) return bot.sendMessage(chatId, `⚠️ Ya existe una cuenta con ese correo para *${String(p.plat).toUpperCase()}*.`, { parse_mode: "Markdown" });
        pending.set(String(chatId), { mode: "invNewClave", plat: p.plat, correo: correoNorm });
        return bot.sendMessage(chatId, `➕ *NUEVA CUENTA*\n📌 ${String(p.plat).toUpperCase()}\n${identIcon(p.plat)} ${escMD(correoNorm)}\n\nEscriba la *clave*:`, { parse_mode: "Markdown" });
      }

      if (p.mode === "invNewClave") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la clave.");
        pending.set(String(chatId), { mode: "invNewPerfiles", plat: p.plat, correo: p.correo, clave: t });
        return bot.sendMessage(chatId, `➕ *NUEVA CUENTA*\n📌 ${String(p.plat).toUpperCase()}\n${identIcon(p.plat)} ${escMD(p.correo)}\n🔑 ${escMD(t)}\n\nEscriba la *cantidad de perfiles* (ej: 4):`, { parse_mode: "Markdown" });
      }

      if (p.mode === "invNewPerfiles") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0 || qty > 20) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número entre 1 y 20.");
        pending.delete(String(chatId));
        forceNextPanelAtBottom(chatId);
        const correoNorm = normalizeIdentByPlatformLocal(p.plat, p.correo);
        const ref = db.collection("inventario").doc(docIdInventarioLocal(correoNorm, p.plat));
        await ref.set({ plataforma: p.plat, correo: correoNorm, ident: correoNorm, clave: p.clave, capacidad: qty, ocupados: 0, disponibles: qty, disp: qty, estado: "activa", clientes: [], createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        await bot.sendMessage(chatId, `✅ Cuenta *${escMD(correoNorm)}* creada con ${qty} perfiles.`, { parse_mode: "Markdown" });
        pending.set(String(chatId), { mode: "invSubmenuCtx", plat: p.plat, correo: correoNorm });
        return enviarSubmenuInventario(chatId, p.plat, correoNorm);
      }

      if (p.mode === "invSumarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const acceso = normalizeIdentByPlatformLocal(p.plat, p.correo);
        const plat = normalizarPlataforma(p.plat);
        const ref = db.collection("inventario").doc(docIdInventarioLocal(acceso, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");
        const d = doc.data() || {};
        const capacidad = Number(d.capacidad || d.total || getCapacidadCorreo(d, plat) || 0);
        const clientes = Array.isArray(d.clientes) ? d.clientes : [];
        const ocupados = clientes.length;
        const nuevaCapacidad = Math.max(capacidad, ocupados + qty);
        const disponibles = Math.max(0, nuevaCapacidad - ocupados);
        await ref.set({ capacidad: nuevaCapacidad, ocupados, disponibles, disp: disponibles, estado: disponibles === 0 ? "llena" : "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo: acceso });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (p.mode === "invRestarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const acceso = normalizeIdentByPlatformLocal(p.plat, p.correo);
        const plat = normalizarPlataforma(p.plat);
        const ref = db.collection("inventario").doc(docIdInventarioLocal(acceso, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");
        const d = doc.data() || {};
        const clientes = Array.isArray(d.clientes) ? d.clientes : [];
        const ocupados = clientes.length;
        const capacidadActual = Number(d.capacidad || d.total || getCapacidadCorreo(d, plat) || 0);
        const nuevaCapacidad = Math.max(ocupados, capacidadActual - qty);
        const disponibles = Math.max(0, nuevaCapacidad - ocupados);
        const antes = { ...d, disp: Math.max(0, capacidadActual - ocupados), capacidad: capacidadActual };
        await ref.set({ capacidad: nuevaCapacidad, ocupados, disponibles, disp: disponibles, estado: disponibles === 0 ? "llena" : "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await aplicarAutoLleno(chatId, ref, antes, { ...d, disp: disponibles, plataforma: plat, correo: acceso, capacidad: nuevaCapacidad });
        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo: acceso });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (p.mode === "invEditClave") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Clave vacía.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const acceso = normalizeIdentByPlatformLocal(p.plat, p.correo);
        const plat = normalizarPlataforma(p.plat);
        const ref = db.collection("inventario").doc(docIdInventarioLocal(acceso, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");
        await ref.set({ clave: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo: acceso });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (p.mode === "cliRenovarFechaManual") {
        // Acepta: dd/mm/yyyy | +40 | +3m | +90
        let fechaFinal = "";
        const tClean = t.trim();

        if (isFechaDMY(tClean)) {
          fechaFinal = tClean;
        } else if (/^\+\d+m$/i.test(tClean)) {
          // +3m = suma N meses desde hoy
          const meses = parseInt(tClean.slice(1));
          const hoy = hoyDMY();
          const [dd, mm, yyyy] = hoy.split("/").map(Number);
          const dt = new Date(Date.UTC(yyyy, mm - 1 + meses, dd, 12));
          fechaFinal = `${String(dt.getUTCDate()).padStart(2,"0")}/${String(dt.getUTCMonth()+1).padStart(2,"0")}/${dt.getUTCFullYear()}`;
        } else if (/^\+\d+$/.test(tClean)) {
          // +40 = suma N días desde hoy
          const dias = parseInt(tClean.slice(1));
          fechaFinal = addDaysDMY(hoyDMY(), dias);
        } else {
          return bot.sendMessage(chatId,
            "⚠️ Formato inválido.\n\nUse:\n• `dd/mm/yyyy` — fecha exacta\n• `+40` — suma 40 días\n• `+3m` — suma 3 meses",
            { parse_mode: "Markdown" }
          );
        }

        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const ref = db.collection("clientes").doc(String(p.clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (p.idx < 0 || p.idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        servicios[p.idx] = { ...(servicios[p.idx] || {}), fechaRenovacion: fechaFinal };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await bot.sendMessage(chatId, `✅ Fecha actualizada: *${fechaFinal}*`, { parse_mode: "Markdown" });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliEditNombre") {
        const actual = await getCliente(p.clientId);
        if (!actual) { pending.delete(String(chatId)); return bot.sendMessage(chatId, "⚠️ Cliente no encontrado."); }
        const dup = await clienteDuplicado(t, actual.telefono || "", p.clientId);
        if (dup) return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set({ nombrePerfil: t, nombre_norm: String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " "), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditTel") {
        const actual = await getCliente(p.clientId);
        if (!actual) { pending.delete(String(chatId)); return bot.sendMessage(chatId, "⚠️ Cliente no encontrado."); }
        const dup = await clienteDuplicado(actual.nombrePerfil || "", t, p.clientId);
        if (dup) return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set({ telefono: t, telefono_norm: onlyDigits(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditVendedor") {
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set({ vendedor: t, vendedor_norm: String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " "), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliAddServMail") {
        const label = getIdentLabelLocal(p.plat);
        if (!validateIdentByPlatformLocal(p.plat, t)) return bot.sendMessage(chatId, `⚠️ ${label} inválido. Escriba el ${label.toLowerCase()}:`);
        const normalizedMail = normalizeIdentByPlatformLocal(p.plat, t);
        if (esSoloCorreoLocal(p.plat)) {
          pending.set(String(chatId), { mode: "cliAddServPrecio", clientId: p.clientId, plat: p.plat, mail: normalizedMail, pin: "" });
          return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
        }
        pending.set(String(chatId), { mode: "cliAddServPin", clientId: p.clientId, plat: p.plat, mail: normalizedMail });
        return bot.sendMessage(chatId, "🔐 Escriba la clave/pin:");
      }

      if (p.mode === "cliAddServPin") {
        pending.set(String(chatId), { mode: "cliAddServPrecio", clientId: p.clientId, plat: p.plat, mail: p.mail, pin: t });
        return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
      }

      if (p.mode === "cliAddServPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
        pending.set(String(chatId), { mode: "cliAddServFecha", clientId: p.clientId, plat: p.plat, mail: p.mail, pin: p.pin, precio: n });
        return bot.sendMessage(chatId, "📅 Fecha renovación (dd/mm/yyyy):");
      }

      if (p.mode === "cliAddServFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try {
          await addServicioTx(String(p.clientId), { plataforma: p.plat, correo: p.mail, pin: p.pin, precio: p.precio, fechaRenovacion: t });
        } catch (e) {
          return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo agregar el servicio."}`);
        }
        return enviarFichaCliente(chatId, p.clientId);
      }

      if (p.mode === "cliServEditMail") {
        const label = getIdentLabelLocal(p.plat || "");
        if (!validateIdentByPlatformLocal(p.plat || "", t)) return bot.sendMessage(chatId, `⚠️ ${label} inválido.`);
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try { await patchServicio(p.clientId, p.idx, { correo: normalizeIdentByPlatformLocal(p.plat || "", t) }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPin") {
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try { await patchServicio(p.clientId, p.idx, { pin: t }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try { await patchServicio(p.clientId, p.idx, { precio: n }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try { await patchServicio(p.clientId, p.idx, { fechaRenovacion: t }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      return;
    }

    // ── Texto libre sin "/" → búsqueda (wizard y pending ya manejados arriba) ──
    if (!text.startsWith("/") && adminOk) {
      const t = text.trim();
      if (t.length >= 2) {
        // ✅ Ignorar comandos de menú — ya los maneja bot.onText
        const IGNORAR = new Set(["menu","inicio","inventario","finanzas","clientes","alertas","dashboard"]);
        if (IGNORAR.has(t.toLowerCase())) return;
        forceNextPanelAtBottom(chatId);

        return resolverBusquedaAdmin(chatId, t);
      }
    }

  } catch (err) {
    logErr("message handler", err?.stack || err?.message || err);
    if (chatId) {
      try { await bot.sendMessage(chatId, "⚠️ Error interno (revise logs)."); } catch (_) {}
    }
  }
});

} // fin if (!global.__SUBLICUENTAS_HANDLERS_READY__)

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
  await ref.set({ lastRun: String(dmy), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
  fmt.forEach((p) => { if (p.type !== "literal") obj[p.type] = p.value; });
  return {
    dmy: `${obj.day}/${obj.month}/${obj.year}`,
    hh: Number(obj.hour),
    mm: Number(obj.minute),
  };
}

async function enviarListaRenovacionesVendedor7AM(chatId, vendedorNombre) {
  const fecha = hoyDMY();
  const list  = await obtenerRenovacionesPorFecha(fecha, vendedorNombre);
  if (!list.length) return false;
  let total = 0; list.forEach(x => { total += Number(x.precio || 0); });
  let txt = `📅 *RENOVACIONES DE HOY — ${escMD(fecha)}*\n`;
  txt += `👤 *${escMD(vendedorNombre)}* · 👥 *${list.length}* · 💰 *${escMD(total.toFixed(2))} Lps*\n\n`;
  list.forEach((x, i) => {
    txt += `*${i + 1}.* ${iconPlataforma(x.plataforma || "")} ${escMD(x.nombrePerfil || "Sin nombre")}\n`;
    txt += `   📱 ${escMD(x.telefono || "-")} · 💰 ${escMD(Number(x.precio || 0).toFixed(2))} Lps\n`;
  });
  const kb = list.slice(0, 20).map((x, i) => [{ text: `${i + 1}) ${(x.nombrePerfil || "Sin nombre").slice(0, 22)} • ${humanPlataforma(x.plataforma || "")}`, callback_data: `cli:view:${x.clientId || x.id || ""}` }]);
  try { await bot.sendMessage(String(chatId), txt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: kb } }); return true; } catch(e) { return false; }
}

async function enviarTxtRenovacionesDiarias7AM() {
  if (!hasRuntimeLock()) return;
  const { dmy } = getTimePartsNow();
  const adminIds = new Set(await getActiveAdminIdsLocal());

  // ✅ Enviar a todos los revendedores (incluyendo admins que sean vendedores)
  // Solo el TXT filtrado por su propio nombre de vendedor
  const revendedores = await getActiveRevendedoresLocal();
  const revendedoresEnviados = new Set();

  for (const rev of revendedores) {
    try {
      await enviarListaRenovacionesVendedor7AM(rev.telegramId, rev.nombre);
      const sent = await enviarTxtRenovacionesVendedorPro(rev.telegramId, rev.nombre);
      if (!sent) continue;
      revendedoresEnviados.add(normalizeTelegramIdLocal(rev.telegramId));
      await db.collection("revendedores").doc(rev.id).set({ autoLastSent: dmy, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) { logErr(`AutoTXT:revendedor:${rev.id}`, e); }
  }

  // ✅ Admins que NO son revendedores reciben el TXT GENERAL (con todos)
  try {
    for (const adminId of adminIds) {
      try {
        if (revendedoresEnviados.has(normalizeTelegramIdLocal(adminId))) continue;
        await enviarTxtRenovacionesAdminPro(adminId);
      } catch (e) { logErr(`AutoTXT:admin:${adminId}`, e); }
    }
  } catch (e) { logErr("AutoTXT:admins", e); }
}

setInterval(async () => {
  if (!hasRuntimeLock()) return;
  try {
    const { dmy, hh, mm } = getTimePartsNow();
    if (hh === 7 && mm === 0) {
      const dbLast = await getLastRunDB();
      if (_lastDailyRun === dmy || dbLast === dmy) return;
      _lastDailyRun = dmy;
      await setLastRunDB(dmy);
      await enviarTxtRenovacionesDiarias7AM();
      console.log(`ℹ️ ✅ AutoTXT 7AM enviado (${dmy}) TZ=${TZ}`);
    }
  } catch (e) { logErr("AutoTXT", e); }
}, 30 * 1000);

// ===============================
// HARDEN
// ===============================
process.on("unhandledRejection", (reason) => { console.error("❌ unhandledRejection:", reason); });
process.on("uncaughtException", (err) => { console.error("❌ uncaughtException:", err); });
process.on("SIGINT", async () => { try { hardStopBot(); releaseRuntimeLock(); } catch (_) {} process.exit(0); });
process.on("SIGTERM", async () => { try { hardStopBot(); releaseRuntimeLock(); } catch (_) {} process.exit(0); });

console.log("✅ index_06_handlers actualizado");

// ===============================
// HTTP KEEPALIVE FINAL
// ===============================
const PORT = process.env.PORT || 10000;

if (!global.__SUBLICUENTAS_HTTP_SERVER__) {
  global.__SUBLICUENTAS_HTTP_SERVER__ = http
    .createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(getCoreHealth()));
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    })
    .listen(PORT, () => { console.log("🌐 HTTP KEEPALIVE activo en puerto", PORT); });
             }
