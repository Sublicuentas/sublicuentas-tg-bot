/* ✅ SUBLICUENTAS TG BOT — PARTE 6/6 CORREGIDA
   HANDLERS / COMANDOS / CALLBACKS / MESSAGE / AUTOTXT / HARDEN / HTTP
   -------------------------------------------------------------------
   ✅ FIXES APLICADOS EN ESTA VERSIÓN:
   - BÚSQUEDA: texto libre sin "/" ahora activa resolverBusquedaAdmin correctamente
   - BÚSQUEDA: resolverBusquedaAdmin ya no hace return prematuro cuando inventario da 0
   - BÚSQUEDA: buscarClientesFallbackLocal mejorado para búsquedas parciales por nombre
   - ALERTAS: callbacks alert:vencidos:0 / alert:hoy:0 / alert:3dias:0 / alert:inventario:0
     ahora detectados con startsWith en lugar de igualdad exacta
   - Resto de fixes previos mantenidos
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
} = require("./index_02_utils_roles");

const {
  dedupeClientes,
  buscarPorTelefonoTodos,
  buscarClienteRobusto,
  enviarFichaCliente,
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
  kbPlataformasWiz,
  menuEditarCliente,
  menuListaServicios,
  menuServicio,
  patchServicio,
  addServicioTx,
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
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trim()}…`;
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

async function safeIsSuperAdminLocal(userId) {
  const uid = normalizeTelegramIdLocal(userId);
  if (!uid) return false;

  try {
    if (await isSuperAdmin(userId)) return true;
  } catch (e) {
    logErr("safeIsSuperAdminLocal:isSuperAdmin", e?.stack || e?.message || e);
  }

  if (getSuperAdminIdsLocal().includes(uid)) return true;

  try {
    const doc = await db.collection("admins").doc(uid).get();
    if (doc.exists) {
      const data = doc.data() || {};
      if (data.activo !== false && (data.superAdmin === true || data.superadmin === true || data.rol === "superadmin")) {
        return true;
      }
    }
  } catch (e) {
    logErr("safeIsSuperAdminLocal:doc", e?.stack || e?.message || e);
  }

  return false;
}

async function safeIsAdminLocal(userId) {
  const uid = normalizeTelegramIdLocal(userId);
  if (!uid) return false;

  if (await safeIsSuperAdminLocal(uid)) return true;

  try {
    if (await isAdmin(userId)) return true;
  } catch (e) {
    logErr("safeIsAdminLocal:isAdmin", e?.stack || e?.message || e);
  }

  try {
    const doc = await db.collection("admins").doc(uid).get();
    if (doc.exists) {
      const data = doc.data() || {};
      if (data.activo !== false) return true;
    }
  } catch (e) {
    logErr("safeIsAdminLocal:doc", e?.stack || e?.message || e);
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
  try {
    pending?.delete?.(String(chatId));
  } catch (_) {}
  try {
    wizard?.delete?.(String(chatId));
  } catch (_) {}
  try {
    panelMsgId?.delete?.(String(chatId));
  } catch (_) {}
}

async function sendBottomMainMenu(chatId, userId) {
  try {
    resetChatState(chatId);

    let text = "";
    let keyboard = [];

    if (await safeIsAdminLocal(userId)) {
      text = "📌 *MENÚ PRINCIPAL*\n\nSeleccione una opción:";
      keyboard = [
        [
          { text: "📦 Inventario", callback_data: "menu:inventario" },
          { text: "👥 Clientes / CRM", callback_data: "menu:clientes" },
        ],
        [
          { text: "💰 Finanzas", callback_data: "menu:pagos" },
          { text: "🚨 Alertas", callback_data: "menu:alertas" },
        ],
      ];
    } else if (await safeIsVendedorLocal(userId)) {
      text = "👤 *MENÚ VENDEDOR PRO*\n\nSeleccione una opción:";
      keyboard = [
        [
          { text: "📅 Mis renovaciones hoy", callback_data: "ren:mis:hoy" },
          { text: "⏳ Renovaciones en 3 días", callback_data: "ren:mis:prox3" },
        ],
        [
          { text: "📄 TXT renovaciones", callback_data: "txt:mis" },
          { text: "👥 Mis clientes", callback_data: "vend:clientes" },
        ],
        [
          { text: "🧾 TXT mis clientes", callback_data: "vend:clientes:txt" },
          { text: "💰 Mi resumen", callback_data: "vend:resumen" },
        ],
      ];
    } else {
      return bot.sendMessage(chatId, "⛔ Acceso denegado");
    }

    return upsertPanel(chatId, text, keyboard, "Markdown");
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
async function resolverBusquedaAdmin(chatId, query = "") {
  const q = String(query || "").trim().replace(/^\/+/, "").trim();
  if (!q) return bot.sendMessage(chatId, "⚠️ Escriba algo para buscar.");

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

async function getAlertaClientesLocal(tipo = "hoy") {
  try {
    const snap = await db.collection("clientes").get();
    const hoy = hoyDMY();
    const fecha3 = addDaysDMY(hoy, 3);
    const rows = [];

    snap.forEach((doc) => {
      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];

      servicios.forEach((s) => {
        const fecha = String(s?.fechaRenovacion || "").trim();
        if (!isFechaDMY(fecha)) return;

        let ok = false;
        if (tipo === "vencidos") ok = Number(parseDMYtoTS(fecha) || 0) < Number(parseDMYtoTS(hoy) || 0);
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
      const fa = String(a.fechaRenovacion || "");
      const fb = String(b.fechaRenovacion || "");
      if (fa !== fb) return fa.localeCompare(fb, "es");
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

function renderAlertaClientesMarkdown(rows = [], titulo = "", emptyText = "Sin resultados.") {
  const items = Array.isArray(rows) ? rows : [];
  let txt = `${titulo}\n\n`;

  if (!items.length) {
    txt += `_${emptyText}_`;
    return txt;
  }

  items.slice(0, 120).forEach((x, i) => {
    txt += `*${i + 1})* ${escMD(x.nombrePerfil || "Sin nombre")}\n`;
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

  if (items.length > 120) {
    txt += `_Mostrando 120 de ${items.length} resultados._`;
  } else {
    txt += `*Total:* ${escMD(String(items.length))}`;
  }

  return txt.trim();
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

function renderInventarioCriticoMarkdown(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  let txt = `📦 *INVENTARIO CRÍTICO*\n\n`;

  if (!items.length) {
    txt += `_Sin cuentas críticas._`;
    return txt;
  }

  items.slice(0, 120).forEach((x, i) => {
    txt += `*${i + 1})* ${escMD(humanPlatAlertLocal(x.plataforma || ""))}\n`;
    txt += `${getIdentLabelLocal(x.plataforma || "") === "Usuario" ? "👤" : "📧"} ${escMD(x.acceso || "-")}\n`;
    txt += `👥 ${escMD(String(x.ocupados))}/${escMD(String(x.capacidad))}\n`;
    txt += `✅ ${escMD(String(x.disponibles))}\n`;
    txt += `📊 ${escMD(x.estado || "-")}\n\n`;
  });

  if (items.length > 120) {
    txt += `_Mostrando 120 de ${items.length} resultados._`;
  } else {
    txt += `*Total:* ${escMD(String(items.length))}`;
  }

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
// ✅ FIX: mostrarPanelAlertaSeguro con startsWith para detectar paginación
// ===============================
async function mostrarPanelAlertaSeguro(chatId, tipo = "") {
  try {
    if (tipo === "vencidos") {
      const rows = await getAlertaClientesLocal("vencidos");
      return upsertPanel(
        chatId,
        renderAlertaClientesMarkdown(rows, "🔴 *CLIENTES VENCIDOS*", "Sin clientes vencidos."),
        [
          [{ text: "⬅️ Volver alertas", callback_data: "menu:alertas" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]
      );
    }

    if (tipo === "hoy") {
      const rows = await getAlertaClientesLocal("hoy");
      return upsertPanel(
        chatId,
        renderAlertaClientesMarkdown(rows, "🟠 *VENCEN HOY*", "Sin renovaciones para hoy."),
        [
          [{ text: "⬅️ Volver alertas", callback_data: "menu:alertas" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]
      );
    }

    if (tipo === "3dias") {
      const fecha3 = addDaysDMY(hoyDMY(), 3);
      const rows = await getAlertaClientesLocal("3dias");
      return upsertPanel(
        chatId,
        renderAlertaClientesMarkdown(rows, `⏳ *VENCEN EN 3 DÍAS (${escMD(fecha3)})*`, "Sin renovaciones en 3 días."),
        [
          [{ text: "⬅️ Volver alertas", callback_data: "menu:alertas" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]
      );
    }

    if (tipo === "inventario") {
      const rows = await getInventarioCriticoLocal();
      return upsertPanel(
        chatId,
        renderInventarioCriticoMarkdown(rows),
        [
          [{ text: "⬅️ Volver alertas", callback_data: "menu:alertas" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]
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
  return bot.sendMessage(chatId, `✅ Admin agregado: ${id}`);
});

bot.onText(/\/admindel\s+(\d+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsSuperAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede eliminar admins.");
  const id = String(match[1] || "").trim();
  await db.collection("admins").doc(id).set({ activo: false, updatedAt: admin.firestore.FieldValue.serverTimestamp(), desactivadoPor: String(userId) }, { merge: true });
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
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  resetChatState(chatId);
  return sendBottomMainMenu(chatId, userId);
});

bot.onText(/^\/menu(?:@\w+)?$/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  resetChatState(chatId);
  return sendBottomMainMenu(chatId, userId);
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
      resetChatState(chatId);
      if (adminOk) return menuPrincipal(chatId);
      return menuVendedor(chatId);
    }

    const vendedorOnlyAllowed = new Set([
      "ren:mis:hoy", "ren:mis:prox3", "txt:mis", "vend:clientes",
      "vend:clientes:txt", "vend:resumen", "go:inicio",
    ]);

    if (!adminOk && !vendedorOnlyAllowed.has(data)) {
      return upsertPanel(
        chatId,
        "⛔ Modo vendedor.\n\nUsa:\n• Mis renovaciones hoy\n• Renovaciones en 3 días\n• TXT renovaciones\n• Mis clientes\n• TXT Mis clientes\n• Mi resumen\n",
        [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]
      );
    }

    if (adminOk) {
      if (data === "menu:inventario") return menuInventario(chatId);
      if (data === "menu:inventario:video") return menuInventarioVideo(chatId);
      if (data === "menu:inventario:musica") return menuInventarioMusica(chatId);
      if (data === "menu:inventario:iptv") return menuInventarioIptv(chatId);
      if (data === "menu:inventario:designai") return menuInventarioDisenoIA(chatId);
      if (data === "menu:clientes") return menuClientes(chatId);
      if (data === "menu:pagos") return menuPagos(chatId);
      if (data === "menu:alertas") return menuAlertas(chatId);
      if (data === "menu:renovaciones") return menuRenovaciones(chatId, userId);

      // ✅ FIX ALERTAS: usar startsWith para tolerar el sufijo :0 de paginación
      if (data.startsWith("alert:vencidos") || data.startsWith("alertas:vencidos")) {
        return mostrarPanelAlertaSeguro(chatId, "vencidos");
      }
      if (data.startsWith("alert:hoy") || data.startsWith("alertas:hoy")) {
        return mostrarPanelAlertaSeguro(chatId, "hoy");
      }
      if (data.startsWith("alert:3dias") || data.startsWith("alertas:3dias")) {
        return mostrarPanelAlertaSeguro(chatId, "3dias");
      }
      if (data.startsWith("alert:inventario") || data.startsWith("alertas:inventario")) {
        return mostrarPanelAlertaSeguro(chatId, "inventario");
      }
      if (data.startsWith("alert:txt:hoy") || data.startsWith("alertas:txt:hoy")) {
        return mostrarPanelAlertaSeguro(chatId, "txt");
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

      if (data.startsWith("cli:txt:hist:")) return enviarHistorialClienteTXT(chatId, data.split(":")[3]);

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
      if (data === "cli:wiz:start") return wizardStart(chatId);

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

      if (data.startsWith("cli:ren:list:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const servicios = serviciosConIndiceOriginal(Array.isArray(c.servicios) ? c.servicios : []);
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");
        const kb = servicios.map((s, i) => [{ text: safeBtnLabelLocal(`🔄 ${i + 1}) ${s.plataforma} — ${s.correo} (Ren: ${s.fechaRenovacion || "-"})`, 60), callback_data: `cli:ren:menu:${clientId}:${s.idxOriginal}` }]);
        kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
        return upsertPanel(chatId, "🔄 *RENOVAR SERVICIO*\nSeleccione cuál renovar:", kb);
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
        return upsertPanel(chatId, `🔄 *RENOVAR SERVICIO #${idx + 1}*\n📌 ${escMD(s.plataforma || "-")}\n${identIcon(s.plataforma || "")} ${escMD(s.correo || "-")}\n📅 Actual: *${escMD(s.fechaRenovacion || "-")}*`, [
          [{ text: "➕ +30 días", callback_data: `cli:ren:+30:${clientId}:${idx}` }],
          [{ text: "📅 Poner fecha manual", callback_data: `cli:ren:fecha:${clientId}:${idx}` }],
          [{ text: "⬅️ Volver lista", callback_data: `cli:ren:list:${clientId}` }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
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
        servicios[idx] = { ...(servicios[idx] || {}), fechaRenovacion: addDaysDMY(base, 30) };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuServicio(chatId, clientId, idx);
      }

      if (data.startsWith("cli:ren:all:ask:")) {
        const clientId = data.split(":")[4];
        return upsertPanel(chatId, "🔄 *Renovar todos +30 días*\n\n¿Desea renovar todos los servicios de este cliente?", [
          [{ text: "✅ Confirmar", callback_data: `cli:ren:all:ok:${clientId}` }],
          [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
        ]);
      }

      if (data.startsWith("cli:ren:all:ok:")) {
        const clientId = data.split(":")[4];
        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");
        const nuevos = servicios.map((s) => { const base = isFechaDMY(String(s.fechaRenovacion || "")) ? String(s.fechaRenovacion) : hoyDMY(); return { ...s, fechaRenovacion: addDaysDMY(base, 30) }; });
        await ref.set({ servicios: nuevos, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:ren:fecha:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);
        pending.set(String(chatId), { mode: "cliRenovarFechaManual", clientId, idx });
        return upsertPanel(chatId, "📅 *Renovar (fecha manual)*\nEscriba la nueva fecha en formato dd/mm/yyyy:", [[{ text: "⬅️ Cancelar", callback_data: `cli:ren:menu:${clientId}:${idx}` }]]);
      }

      if (data === "txt:todos:hoy") {
        if (!(await safeIsSuperAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPERADMIN.");
        return enviarTXTATodosHoy(chatId);
      }
    }

    if (data === "ren:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      return bot.sendMessage(chatId, renovacionesTexto(list, fecha, adminOk ? null : vend?.nombre), { parse_mode: "Markdown" });
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
      return bot.sendMessage(chatId, renovacionesTexto(list, fecha, vend.nombre), { parse_mode: "Markdown" });
    }

    if (data === "ren:mis:prox3") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = addDaysDMY(hoyDMY(), 3);
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      return bot.sendMessage(chatId, renovacionesTexto(list, fecha, vend.nombre), { parse_mode: "Markdown" });
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
  if (!chatId) return;

  try {
    if (!(await userHasAccessFromMessage(msg))) return;

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
        "editar_movimiento", ...PLATFORM_KEYS,
      ]);

      if (adminOk && !comandosReservados.has(first)) {
        return resolverBusquedaAdmin(chatId, rawCmd);
      }

      return;
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
        pending.delete(String(chatId));
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
        pending.delete(String(chatId));
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
        const list = await getMovimientosPorRango(p.fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenFinanzasTextoPorRango(p.fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finBancosFechaAsk") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");
        pending.delete(String(chatId));
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
        const list = await getMovimientosPorRango(p.fechaInicio, fechaFin, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenTopCombosRangoTexto(p.fechaInicio, fechaFin, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finResumenBancoMesAsk") {
        const key = parseMonthInputToKey(t);
        if (!key) return bot.sendMessage(chatId, "⚠️ Mes inválido. Use mm/yyyy");
        pending.delete(String(chatId));
        const list = await getMovimientosPorMes(key, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenBancosMesTexto(key, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finTopPlataformasMesAsk") {
        const key = parseMonthInputToKey(t);
        if (!key) return bot.sendMessage(chatId, "⚠️ Mes inválido. Use mm/yyyy");
        pending.delete(String(chatId));
        const list = await getMovimientosPorMes(key, userId, await safeIsSuperAdminLocal(userId));
        return bot.sendMessage(chatId, resumenTopPlataformasTexto(key, list), { parse_mode: "Markdown" });
      }

      if (p.mode === "finCierreCajaAsk") {
        const fecha = parseFechaFlexible(t);
        if (!fecha) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");
        pending.delete(String(chatId));
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
        return exportarFinanzasRangoExcel(chatId, p.fechaInicio, t, userId, await safeIsSuperAdminLocal(userId));
      }

      if (p.mode === "finEditMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) return bot.sendMessage(chatId, "⚠️ Monto inválido.");
        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ monto: Number(monto), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Monto actualizado correctamente.");
      }

      if (p.mode === "finEditBanco") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el banco.");
        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ banco: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Banco actualizado correctamente.");
      }

      if (p.mode === "finEditMotivo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el motivo.");
        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ motivo: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Motivo actualizado correctamente.");
      }

      if (p.mode === "finEditPlataforma") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la plataforma.");
        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ plataforma: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Plataforma actualizada correctamente.");
      }

      if (p.mode === "finEditDetalle") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el detalle.");
        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set({ detalle: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return bot.sendMessage(chatId, "✅ Detalle actualizado correctamente.");
      }

      if (p.mode === "finEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");
        pending.delete(String(chatId));
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
        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        await found.ref.set({ clave: t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await bot.sendMessage(chatId, "✅ Clave de la cuenta actualizada.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "invSumarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");
        pending.delete(String(chatId));
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
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");
        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (p.idx < 0 || p.idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        servicios[p.idx] = { ...(servicios[p.idx] || {}), fechaRenovacion: t };
        await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliEditNombre") {
        const actual = await getCliente(p.clientId);
        if (!actual) { pending.delete(String(chatId)); return bot.sendMessage(chatId, "⚠️ Cliente no encontrado."); }
        const dup = await clienteDuplicado(t, actual.telefono || "", p.clientId);
        if (dup) return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        pending.delete(String(chatId));
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
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set({ telefono: t, telefono_norm: onlyDigits(t), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditVendedor") {
        pending.delete(String(chatId));
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
        try { await patchServicio(p.clientId, p.idx, { correo: normalizeIdentByPlatformLocal(p.plat || "", t) }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPin") {
        pending.delete(String(chatId));
        try { await patchServicio(p.clientId, p.idx, { pin: t }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido.");
        pending.delete(String(chatId));
        try { await patchServicio(p.clientId, p.idx, { precio: n }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");
        pending.delete(String(chatId));
        try { await patchServicio(p.clientId, p.idx, { fechaRenovacion: t }); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      return;
    }

    // ── ✅ FIX: Texto libre sin "/" ni wizard ni pending → búsqueda directa para admins ──
    if (!text.startsWith("/") && adminOk) {
      const t = text.trim();
      if (t.length >= 2) {
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

async function enviarTxtRenovacionesDiarias7AM() {
  if (!hasRuntimeLock()) return;
  const { dmy } = getTimePartsNow();
  const adminIds = new Set(await getActiveAdminIdsLocal());
  try {
    for (const adminId of adminIds) {
      try { await enviarTxtRenovacionesAdminPro(adminId); } catch (e) { logErr(`AutoTXT:admin:${adminId}`, e); }
    }
  } catch (e) { logErr("AutoTXT:admins", e); }

  const revendedores = await getActiveRevendedoresLocal();
  for (const rev of revendedores) {
    try {
      if (adminIds.has(normalizeTelegramIdLocal(rev.telegramId))) continue;
      const sent = await enviarTxtRenovacionesVendedorPro(rev.telegramId, rev.nombre);
      if (!sent) continue;
      await db.collection("revendedores").doc(rev.id).set({ autoLastSent: dmy, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) { logErr(`AutoTXT:revendedor:${rev.id}`, e); }
  }
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
