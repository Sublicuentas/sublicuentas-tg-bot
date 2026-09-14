/* ✅ SUBLICUENTAS TG BOT — PARTE 6/6 FINAL OPTIMIZADA
   HANDLERS / COMANDOS / CALLBACKS / MESSAGE / AUTOTXT / HARDEN
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


const {
  bot,
  admin,
  db,
  ExcelJS,
  TZ,
  PLATAFORMAS,
  FINANZAS_COLLECTION,
  CORE_STATE,
  SUPER_ADMIN,
  hardStopBot,
  releaseRuntimeLock,
  cacheInvalidatePrefix,
} = require("./index_01_core");

// ✅ PIN de configuración inicial para /addvendedor y /resetpin (cierra el
// hueco de "auto-claim" del panel de revendedores — ver index_09_api_auth.js)
const { generarPinSetup } = require("./index_09_api_auth");
const { obtenerCatalogoSocio, tarifaIdParaSocio } = require("./index_15_catalogo_socios");
const { canonicalVendedor, normVendedor, clientePerteneceAVendedor, vendedorEfectivoServicio } = require("./index_17_vendedores_servicio");

const {
  isAdmin,
  premiumIcons,
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
  normTxt,
  normalizarPlataforma,
  esPlataformaValida,
  isEmailLike,
  onlyDigits,
  normalizarTelefonoCliente,
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
  // 🐛 FIX (ago-2026): faltaban estas dos — ver comentario en el
  // module.exports de index_03_clientes_crm.js.
  iconPlataforma,
  humanPlataforma,
  dedupeClientes,
  buscarPorTelefonoTodos,
  buscarClienteRobusto,
  getClientesBusquedaSnapshot,
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
  kbTvDigitalMarcasWiz,
  kbTvDigitalPlanesWiz,
  menuEditarCliente,
  menuListaServicios,
  menuServicio,
  menuListaPerfilesServicio,
  menuPerfilServicio,
  patchServicio,
  addServicioTx,
  addPerfilTx,
  patchPerfilTx,
  eliminarPerfilTx,
  eliminarServicioTx,
  renovarServicioTx,
  renovarTodosServiciosTx,
  eliminarServiciosTx,
  sincronizarCuentaEnComprasTx,
  menuListaRenovacion,
  menuRenovacionServicio,
  enviarPanelRenovacionesConAcciones,
  serviciosConIndiceOriginal,
  clienteDuplicado,
  perfilesServicioLocal,
  cantidadPerfilesServicioLocal,
  compraSelectorLocal, perfilSelectorLocal, resolverIndiceCompraSelectorLocal, resolverIndicePerfilSelectorLocal,
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
  getMailPanelContext,
  getInventoryMoveToken,
  buscarCuentaInventarioPorMoveToken,
  moverCuentaInventarioPlataforma,
} = require("./index_04_inventario_correos");

const {
  menuPrincipal,
  menuVendedor,
  menuInventario,
  menuInventarioVideo,
  menuInventarioMusica,
  menuInventarioIptv,
  menuInventarioTvDigitalMarca,
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

function esPlataformaUsuarioLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  return [
    "stellatv1", "stellatv2", "stellatv3",
    "oleadatv1", "oleadatv3",
    "latintv1", "latintv2", "latintv3", "latintv4",
    "liontv1", "liontv2", "liontv3", "liontv5",
    "evoutouch4",
    "iptv1", "iptv3", "iptv4",
  ].includes(p);
}

function getIdentLabelLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (esPlataformaUsuarioLocal(p)) return "Usuario";
  return "Correo";
}

function requiereClaveLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const cfg = platMetaLocal(p);
  if (Object.prototype.hasOwnProperty.call(cfg, "requiereClave")) return cfg.requiereClave === true;
  return !["canva", "gemini", "chatgpt", "duolingo"].includes(p);
}

function requiereCorreoLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const cfg = platMetaLocal(p);
  // En plataformas con usuario, el identificador se almacena en el mismo
  // campo que el correo y también debe solicitarse antes de la clave.
  if (cfg.permiteUsuario === true) return true;
  if (Object.prototype.hasOwnProperty.call(cfg, "requiereCorreo")) return cfg.requiereCorreo === true;
  return true;
}

function requierePinLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const cfg = platMetaLocal(p);
  if (Object.prototype.hasOwnProperty.call(cfg, "requierePin")) return cfg.requierePin === true;
  return ["netflix", "disneyp", "disneys", "hbomax", "primevideo", "crunchyroll", "universal"].includes(p);
}

function esSoloCorreoLocal(plataforma = "") {
  return requiereCorreoLocal(plataforma) && !requiereClaveLocal(plataforma) && !requierePinLocal(plataforma);
}

function getAccessTypeLabelLocal(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (!requiereCorreoLocal(p) && !requiereClaveLocal(p) && requierePinLocal(p)) return "Solo PIN";
  if (esSoloCorreoLocal(p)) return "Solo correo";
  if (esPlataformaUsuarioLocal(p)) return "Usuario + clave";
  if (requiereClaveLocal(p) && requierePinLocal(p)) return "Correo + clave + PIN";
  if (requiereClaveLocal(p)) return "Correo + clave";
  if (requierePinLocal(p)) return requiereCorreoLocal(p) ? "Correo + PIN" : "Solo PIN";
  return "Correo";
}

function validateIdentByPlatformLocal(plataforma = "", ident = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(ident || "").trim();
  if (!v) return false;
  if (esPlataformaUsuarioLocal(p)) {
    return v.length >= 3 && !/\s/.test(v);
  }
  return isEmailLike(v);
}

function normalizeIdentByPlatformLocal(plataforma = "", ident = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(ident || "").trim();
  if (esPlataformaUsuarioLocal(p)) {
    return v;
  }
  return v.toLowerCase();
}


// ==========================================================
// CONTROL MAESTRO · SINCRONIZACIÓN AUTOMÁTICA DESDE TELEGRAM
// ==========================================================
// Cuando se quita un cliente desde la cuenta de Bodega en Telegram, también
// se limpia su fila del Excel privado que usa Control Maestro. Se conserva el
// correo/usuario y la clave de la cuenta; solo se borran las columnas del
// cliente, exactamente igual que la acción manual "Borrar del Excel".
const CM_AUTO_ARCHIVOS = "control_maestro_archivos";
const CM_AUTO_CONFIG = "control_maestro_config";
const CM_AUTO_CONFIG_DOC = "principal";
const CM_AUTO_CHUNK_SIZE = 450000;
let cmAutoSyncChain = Promise.resolve();

function cmAutoNorm(value = "") {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9@.+\s_-]/g, " ").replace(/\s+/g, " ").trim();
}
function cmAutoPerson(value = "") {
  return cmAutoNorm(value).replace(/^(?:(?:perfil|cliente|titular|usuario)\s+)+/, "").trim();
}
function cmAutoCellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (value.result != null) return cmAutoCellText(value.result);
    if (value.text != null) return String(value.text);
    if (Array.isArray(value.richText)) return value.richText.map((part) => String(part?.text || "")).join("");
    if (value.hyperlink && value.text) return String(value.text);
  }
  return String(value).trim();
}
function cmAutoHeaderKey(value) {
  return cmAutoNorm(cmAutoCellText(value)).replace(/[^a-z0-9]/g, "").toUpperCase();
}
function cmAutoFirstCol(map, names) {
  for (const name of names) if (map[name]?.length) return map[name][0];
  return 0;
}
function cmAutoFindHeader(ws) {
  let best = null;
  const max = Math.min(Math.max(ws.actualRowCount || ws.rowCount || 20, 20), 80);
  for (let r = 1; r <= max; r += 1) {
    const map = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const key = cmAutoHeaderKey(cell.value);
      if (key) (map[key] || (map[key] = [])).push(col);
    });
    const has = (names) => names.some((name) => map[name]?.length);
    const score =
      (has(["NOMBRE","CLIENTE","NOMBRECLIENTE","NOMBREDELCLIENTE","CLIENTENOMBRE"]) ? 3 : 0) +
      (has(["CELULAR","TELEFONO","TELEFONOCLIENTE","TELEFONOWHATSAPP","WHATSAPP","NUMERO","NUMEROTELEFONO","NUMERODETELEFONO"]) ? 3 : 0) +
      (has(["CORREO","EMAIL","CORREOELECTRONICO","EMAILCUENTA","EMAILDECUENTA","CORREOCUENTA","CORREODECUENTA","CUENTA","USUARIO"]) ? 4 : 0) +
      (has(["CLAVE","CONTRASENA","PASSWORD","CLAVEDECUENTA","CLAVEDELACUENTA"]) ? 2 : 0) +
      (has(["PERFIL","PERFILES","NOMBREDEPERFIL","SLOT","CUPO"]) ? 1 : 0) +
      (has(["EXPIRACION","RENOVACION","VENCIMIENTO","FECHAVENCIMIENTO","FECHADEVENCIMIENTO","FECHARENOVACION","FECHADERENOVACION"]) ? 1 : 0) +
      (has(["PLATAFORMA","SERVICIO","APLICACION","APP","PRODUCTO"]) ? 2 : 0);
    if (!best || score > best.score) best = { row: r, map, score };
  }
  if (!best || best.score < 3) return null;
  const m = best.map;
  return {
    row: best.row,
    name: cmAutoFirstCol(m,["NOMBRE","CLIENTE","NOMBRECLIENTE","NOMBREDELCLIENTE","CLIENTENOMBRE"]),
    seller: cmAutoFirstCol(m,["VENDEDOR","ASESOR"]),
    phone: cmAutoFirstCol(m,["CELULAR","TELEFONO","TELEFONOCLIENTE","TELEFONOWHATSAPP","WHATSAPP","NUMEROTELEFONO","NUMERODETELEFONO","NUMERO"]),
    profile: cmAutoFirstCol(m,["PERFIL","PERFILES","NOMBREDEPERFIL","SLOT","CUPO"]),
    pin: cmAutoFirstCol(m,["PIN","PINPERFIL"]),
    email: cmAutoFirstCol(m,["CORREO","EMAIL","CORREOELECTRONICO","EMAILCUENTA","EMAILDECUENTA","CORREOCUENTA","CORREODECUENTA","CUENTA","USUARIO"]),
    password: cmAutoFirstCol(m,["CLAVE","CONTRASENA","PASSWORD","CLAVEDECUENTA","CLAVEDELACUENTA"]),
    price: cmAutoFirstCol(m,["PRECIO","VALOR","MONTO"]),
    expiry: cmAutoFirstCol(m,["RENOVACION","EXPIRACION","VENCIMIENTO","FECHAVENCIMIENTO","FECHADEVENCIMIENTO","FECHARENOVACION","FECHADERENOVACION"]),
    alert: cmAutoFirstCol(m,["ALERTA","ESTADO"]),
    days: cmAutoFirstCol(m,["DIAS","DIASRESTANTES"]),
    platform: cmAutoFirstCol(m,["PLATAFORMA","SERVICIO","APLICACION","APP","PRODUCTO"]),
  };
}
function cmAutoFamily(platform = "") {
  const p = normalizarPlataforma(platform);
  if (["disneyp","disneys","disney"].includes(p)) return "disney";
  if (/^stellatv[123]$/.test(p) || p === "stellatv") return "stella";
  if (/^oleadatv[13]$/.test(p) || p === "oleada") return "oleada";
  if (/^latintv[1234]$/.test(p) || p === "latintv") return "latintv";
  if (/^liontv[1235]$/.test(p) || p === "liontv") return "liontv";
  if (p === "evoutouch4" || p === "evoutouch") return "evoutouch";
  if (/^iptv[134]$/.test(p) || p === "iptv") return "iptv";
  return p;
}
function cmAutoPlatformsForSheet(name = "") {
  const n = cmAutoNorm(name);
  if (n.includes("netflix") && n.includes("vip")) return ["vipnetflix"];
  if (n.includes("extra")) return ["vipnetflix"];
  if (n.includes("netflix")) return ["netflix"];
  if (n.includes("disney")) return ["disney"];
  if (n.includes("hbo") || /^max$/.test(n)) return ["hbomax"];
  if (n.includes("prime")) return ["primevideo"];
  if (n.includes("paramount")) return ["paramount"];
  if (n.includes("crunch")) return ["crunchyroll"];
  if (/\bvix\b/.test(n)) return ["vix"];
  if (n.includes("viki")) return ["viki"];
  if (n.includes("universal")) return ["universal"];
  if (n.includes("spotify")) return ["spotify"];
  if (n.includes("youtube")) return ["youtube"];
  if (n.includes("deezer")) return ["deezer"];
  if (n.includes("canva")) return ["canva"];
  if (n.includes("gemini")) return ["gemini"];
  if (n.includes("chatgpt") || n.includes("openai")) return ["chatgpt"];
  if (n.includes("duolingo")) return ["duolingo"];
  if (n.includes("apple")) return ["appletv"];
  if (/\bstar\b/.test(n)) return ["star"];
  if (n.includes("office 2021")) return ["office2021"];
  if (n.includes("office") || n.includes("microsoft")) return ["office"];
  if (n.includes("windows 10") || n.includes("win 10")) return ["windows10"];
  if (n.includes("windows 11") || n.includes("win 11")) return ["windows11"];
  if (n.includes("adobe")) return ["adobeexpress"];
  if (n.includes("eset") || n.includes("nod32")) return ["eset"];
  if (n.includes("stella")) return ["stella"];
  if (n.includes("oleada")) return ["oleada"];
  if (n.includes("latin tv") || n.includes("latintv")) return ["latintv"];
  if (n.includes("lion tv") || n.includes("liontv")) return ["liontv"];
  if (n.includes("evoutouch") || n.includes("evou touch")) return ["evoutouch"];
  if (n.includes("iptv")) return ["iptv"];
  return [];
}
async function cmAutoReadTemplate() {
  const cfg = await db.collection(CM_AUTO_CONFIG).doc(CM_AUTO_CONFIG_DOC).get();
  const cfgData = cfg.exists ? (cfg.data() || {}) : {};
  const templateId = String(cfgData.plantillaId || "").trim();
  if (!templateId) return null;
  const doc = await db.collection(CM_AUTO_ARCHIVOS).doc(templateId).get();
  if (!doc.exists) return null;
  const meta = doc.data() || {};
  if (meta.estado && meta.estado !== "listo") throw new Error("La plantilla de Control Maestro todavía no está lista.");
  const snap = await doc.ref.collection("archivo").orderBy("index", "asc").get();
  if (!snap.size) throw new Error("La plantilla de Control Maestro no tiene bloques.");
  const base64 = snap.docs.map((d) => String((d.data() || {}).base64 || "")).join("");
  if (!base64) throw new Error("La plantilla de Control Maestro está vacía.");
  return { id: templateId, meta, base64 };
}
async function cmAutoSaveTemplate(buffer, previous, audit = {}) {
  const base64 = Buffer.from(buffer).toString("base64");
  const chunks = [];
  for (let i = 0; i < base64.length; i += CM_AUTO_CHUNK_SIZE) chunks.push(base64.slice(i, i + CM_AUTO_CHUNK_SIZE));
  const now = new Date().toISOString();
  const ref = db.collection(CM_AUTO_ARCHIVOS).doc();
  const filename = String(previous?.meta?.filename || "Sublicuentas.xlsx").slice(0, 180);
  await ref.set({
    version: "control-maestro-v1-20260804", clase: "plantilla", filename,
    size: Buffer.byteLength(buffer), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    chunks: chunks.length, base64Length: base64.length, dateKey: now.slice(0, 10), createdAt: now,
    createdBy: "telegram", motivo: "telegram_quitar_cliente", estado: "guardando", privado: true,
    owner: "sublicuentas", reemplaza: previous?.id || "", telegramSync: audit,
  });
  let batch = db.batch(); let ops = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    batch.set(ref.collection("archivo").doc(String(i + 1).padStart(4, "0")), { index: i + 1, totalChunks: chunks.length, base64: chunks[i], createdAt: now });
    ops += 1;
    if (ops >= 350) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops) await batch.commit();
  await ref.update({ estado: "listo", updatedAt: new Date().toISOString() });
  await db.collection(CM_AUTO_CONFIG).doc(CM_AUTO_CONFIG_DOC).set({
    plantillaId: ref.id, plantillaFilename: filename, plantillaUpdatedAt: now,
    updatedBy: "telegram", version: "control-maestro-v1",
  }, { merge: true });
  try {
    await db.collection("auditoria_eventos").add({
      tipo: "control_maestro_cliente_borrado_desde_telegram", archivoId: ref.id,
      archivoAnteriorId: previous?.id || "", filename, usuario: "telegram", rol: "sublicuentas",
      ...audit, createdAt: now,
    });
  } catch (_) {}
  return ref.id;
}
async function cmAutoRemoveClientOnce({ plataforma = "", acceso = "", cliente = {} } = {}) {
  if (!ExcelJS) return { ok: false, code: "no_exceljs", message: "ExcelJS no disponible." };
  const previous = await cmAutoReadTemplate();
  if (!previous) return { ok: false, code: "no_template", message: "No hay plantilla de Control Maestro configurada." };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(previous.base64, "base64"));
  const targetAccount = normalizeIdentByPlatformLocal(plataforma, acceso);
  const targetName = cmAutoPerson(cliente?.nombre || "");
  const targetPin = cmAutoNorm(cliente?.pin || "");
  const targetPhone = String(cliente?.telefono || cliente?.celular || "").replace(/\D/g, "").slice(-8);
  const targetFamily = cmAutoFamily(plataforma);
  const candidates = [];

  for (const ws of workbook.worksheets) {
    const sheetKey = cmAutoNorm(ws.name).replace(/[^a-z0-9_]/g, "");
    if (["revision","__sublichat_ids","resumen","dashboard","portada","instrucciones","configuracion"].includes(sheetKey)) continue;
    const h = cmAutoFindHeader(ws); if (!h) continue;
    const sheetFamilies = cmAutoPlatformsForSheet(ws.name).map(cmAutoFamily);
    let currentAccount = "";
    let currentFamily = sheetFamilies[0] || "";
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (_row, rowNumber) => { if (rowNumber > h.row) rows.push(rowNumber); });
    for (const rowNumber of rows) {
      const row = ws.getRow(rowNumber);
      const directAccount = h.email ? normalizeIdentByPlatformLocal(plataforma, cmAutoCellText(row.getCell(h.email).value)) : "";
      if (directAccount) currentAccount = directAccount;
      if (h.platform) {
        const rawPlatform = cmAutoCellText(row.getCell(h.platform).value);
        if (rawPlatform) currentFamily = cmAutoFamily(rawPlatform);
      }
      if (!currentAccount || currentAccount !== targetAccount) continue;
      if (currentFamily && targetFamily && currentFamily !== targetFamily) continue;
      const rowName = h.name ? cmAutoPerson(cmAutoCellText(row.getCell(h.name).value)) : "";
      const rowPin = h.pin ? cmAutoNorm(cmAutoCellText(row.getCell(h.pin).value)) : "";
      const rowPhone = h.phone ? String(cmAutoCellText(row.getCell(h.phone).value)).replace(/\D/g, "").slice(-8) : "";
      const nameMatch = !!targetName && !!rowName && rowName === targetName;
      const pinMatch = !!targetPin && !!rowPin && rowPin === targetPin;
      const phoneMatch = !!targetPhone && !!rowPhone && rowPhone === targetPhone;
      if (!nameMatch && !pinMatch && !phoneMatch) continue;
      let score = 100;
      if (nameMatch) score += 70;
      if (pinMatch) score += 45;
      if (phoneMatch) score += 35;
      if (currentFamily === targetFamily) score += 20;
      candidates.push({ ws, row, rowNumber, h, score, nameMatch, pinMatch, phoneMatch });
    }
  }

  if (!candidates.length) return { ok: false, code: "not_found", message: "No encontré una fila exacta de ese cliente en el Excel." };
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const tied = candidates.filter((c) => c.score === best.score);
  if (tied.length > 1 && !(best.nameMatch && best.pinMatch)) {
    return { ok: false, code: "ambiguous", message: "Encontré más de una fila posible y no borré ninguna para evitar un error." };
  }
  const columns = [best.h.name,best.h.seller,best.h.phone,best.h.profile,best.h.pin,best.h.price,best.h.expiry,best.h.alert,best.h.days].filter((v, i, arr) => v && arr.indexOf(v) === i);
  for (const col of columns) {
    const cell = best.row.getCell(col);
    cell.value = null;
    try { cell.note = undefined; } catch (_) {}
  }
  const out = await workbook.xlsx.writeBuffer();
  const newId = await cmAutoSaveTemplate(out, previous, {
    plataforma: normalizarPlataforma(plataforma), cuenta: targetAccount,
    cliente: String(cliente?.nombre || "").slice(0, 160), pin: String(cliente?.pin || "").slice(0, 40),
    hoja: best.ws.name, fila: best.rowNumber,
  });
  return { ok: true, code: "deleted", hoja: best.ws.name, fila: best.rowNumber, archivoId: newId };
}
function cmAutoRemoveClient(payload) {
  const run = () => cmAutoRemoveClientOnce(payload);
  const result = cmAutoSyncChain.then(run, run);
  cmAutoSyncChain = result.catch(() => null);
  return result;
}

// Sublichat tiene vendedores operativos que no necesariamente poseen una
// cuenta en la colección `revendedores` del Panel de Socios. La validación
// anterior consultaba solo esa colección y rechazaba nombres reales como
// Abner, Yami, Jimena, Heber, Manuel, Elizabeth o Lucy.
const VENDEDORES_OPERATIVOS_LOCAL = new Map([
  ["sublicuentas", { nombre: "Sublicuentas", telefono: "89464277" }],
  ["relojes", { nombre: "Relojes", telefono: "32126332" }],
  ["libni", { nombre: "Relojes", telefono: "32126332" }],
  ["yami", { nombre: "Yami", telefono: "96877246" }],
  ["jimena", { nombre: "Jimena", telefono: "88501036" }],
  ["heber", { nombre: "Heber", telefono: "32174922" }],
  ["abner", { nombre: "Abner", telefono: "94306551" }],
  ["manuel", { nombre: "Manuel", telefono: "87989267" }],
  ["geisell", { nombre: "Geisell", telefono: "" }],
  ["geissel", { nombre: "Geisell", telefono: "" }],
  ["elizabeth", { nombre: "Elizabeth", telefono: "" }],
  ["lucy", { nombre: "Lucy", telefono: "" }],
]);
let vendedoresDescubiertosCache = { expiresAt: 0, items: new Map() };

function vendedorNormCanonicoLocal(value = "") {
  const n = normVendedor(value);
  return n === "geissel" ? "geisell" : n;
}

async function cargarVendedoresDescubiertosLocal() {
  if (Date.now() < vendedoresDescubiertosCache.expiresAt) return vendedoresDescubiertosCache.items;
  const items = new Map();
  try {
    const [revSnap, cliSnap] = await Promise.all([
      db.collection("revendedores").get(),
      db.collection("clientes").get(),
    ]);
    revSnap.forEach((doc) => {
      const data = doc.data() || {};
      if (data.activo === false) return;
      const nombre = canonicalVendedor(data.nombre || data.usuario || doc.id);
      const telefono = String(data.telefono || data.whatsapp || "").trim();
      [doc.id, data.nombre_norm, data.nombre, data.usuario].forEach((alias) => {
        const key = vendedorNormCanonicoLocal(alias);
        if (key) items.set(key, { nombre, telefono, source: "revendedores" });
      });
    });
    cliSnap.forEach((doc) => {
      const data = doc.data() || {};
      const candidatos = [{
        nombre: data.vendedor, norm: data.vendedor_norm,
        telefono: data.vendedorTelefono,
      }];
      (Array.isArray(data.servicios) ? data.servicios : []).forEach((s) => candidatos.push({
        nombre: s?.vendedor || s?.vendedorNombre,
        norm: s?.vendedor_norm || s?.vendedorNorm,
        telefono: s?.vendedorTelefono || s?.vendedor_telefono,
      }));
      candidatos.forEach((v) => {
        const nombre = canonicalVendedor(v.nombre || v.norm || "");
        const key = vendedorNormCanonicoLocal(v.norm || nombre);
        if (!key || items.has(key)) return;
        items.set(key, { nombre, telefono: String(v.telefono || "").trim(), source: "clientes" });
      });
    });
  } catch (error) {
    logErr("cargarVendedoresDescubiertosLocal", error);
  }
  vendedoresDescubiertosCache = { expiresAt: Date.now() + 5 * 60 * 1000, items };
  return items;
}

async function resolverVendedorRegistradoLocal(value = "") {
  const entrada = canonicalVendedor(value);
  const key = vendedorNormCanonicoLocal(entrada);
  if (!key) return null;
  const operativo = VENDEDORES_OPERATIVOS_LOCAL.get(key);
  if (operativo) return { ...operativo, nombre_norm: vendedorNormCanonicoLocal(operativo.nombre), source: "sublichat" };
  const descubiertos = await cargarVendedoresDescubiertosLocal();
  const found = descubiertos.get(key);
  return found ? { ...found, nombre_norm: key } : null;
}

function docIdInventarioLocal(ident = "", plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const i = normalizeIdentByPlatformLocal(p, ident)
    .toLowerCase()
    .replace(/[.#$/\[\]\s]+/g, "_");
  return `${p}__${i}`;
}

function dmyToKeyLocal(dmy = "") {
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return 0;
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return 0;
  return yyyy * 10000 + mm * 100 + dd;
}

function normEstadoSyncLocal(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function servicioVigenteParaSyncLocal(servicio = {}) {
  const estado = normEstadoSyncLocal(servicio.estado || servicio.status || "");
  if (["cancelado", "inactivo", "eliminado", "no renovo", "no renovo.", "vencido"].includes(estado)) return false;

  const fecha = String(servicio.fechaRenovacion || servicio.renovacion || servicio.fecha || "").trim();
  const fechaKey = dmyToKeyLocal(fecha);
  if (!fechaKey) return estado === "activo" || estado === "vigente";

  return fechaKey >= dmyToKeyLocal(hoyDMY());
}

function getIdentServicioSyncLocal(servicio = {}) {
  return String(servicio.correo || servicio.usuario || servicio.ident || servicio.email || "").trim();
}

function extraerClaveInventarioLocal(data = {}) {
  const valores = [
    data.clave,
    data.password,
    data.pass,
    data.contrasena,
    data["contraseña"],
    data.key,
  ];

  for (const v of valores) {
    const s = String(v || "").trim();
    if (!s) continue;
    const n = normEstadoSyncLocal(s);
    if (["-", "sin clave", "sin password", "n/a", "na", "null", "undefined"].includes(n)) continue;
    return s;
  }
  return "";
}

function extraerPinInventarioLocal(data = {}) {
  const valores = [
    data.pin,
    data.pinPerfil,
    data.pin_perfil,
    data.perfilPin,
    data.perfil_pin,
    data.profilePin,
    data.profile_pin,
    data.pinCliente,
    data.pin_cliente,
    data.pinServicio,
    data.pin_servicio,
  ];

  for (const v of valores) {
    const s = String(v || "").trim();
    if (!s) continue;
    const n = normEstadoSyncLocal(s);
    if (["-", "sin pin", "n/a", "na", "null", "undefined"].includes(n)) continue;
    return s;
  }
  return "";
}

function extraerPinServicioLocal(servicio = {}) {
  return extraerPinInventarioLocal(servicio || {});
}

function getIdentInventarioSyncLocal(data = {}) {
  return String(data.correo || data.usuario || data.ident || data.email || "").trim();
}

function syncIdentKeyLocal(value = "") {
  return String(value || "").trim().toLowerCase();
}

function pickInventarioMatchLocal(rows = [], plataformaPreferida = "") {
  const prefer = normalizarPlataforma(plataformaPreferida);
  const arr = Array.isArray(rows) ? rows.slice() : [];
  if (!arr.length) return null;

  arr.sort((a, b) => {
    const aPrefer = normalizarPlataforma(a.plataforma || "") === prefer ? 1 : 0;
    const bPrefer = normalizarPlataforma(b.plataforma || "") === prefer ? 1 : 0;
    if (bPrefer !== aPrefer) return bPrefer - aPrefer;

    const aClave = extraerClaveInventarioLocal(a.data || {}) ? 1 : 0;
    const bClave = extraerClaveInventarioLocal(b.data || {}) ? 1 : 0;
    if (bClave !== aClave) return bClave - aClave;

    return String(a.id || "").localeCompare(String(b.id || ""), "es", { sensitivity: "base" });
  });

  return arr[0] || null;
}

async function buildInventarioClaveIndexLocal() {
  const byPlatIdent = new Map();
  const byIdent = new Map();

  try {
    const snapInv = await db.collection("inventario").get();
    snapInv.forEach((docInv) => {
      const data = docInv.data() || {};
      const plataforma = normalizarPlataforma(data.plataforma || "");
      const identRaw = getIdentInventarioSyncLocal(data);
      if (!plataforma || !identRaw) return;

      const identNorm = syncIdentKeyLocal(normalizeIdentByPlatformLocal(plataforma, identRaw));
      if (!identNorm) return;

      const row = { id: docInv.id, ref: docInv.ref, data, plataforma, ident: identNorm };
      const key = `${plataforma}__${identNorm}`;
      const prev = byPlatIdent.get(key);
      byPlatIdent.set(key, pickInventarioMatchLocal([prev, row].filter(Boolean), plataforma));

      const arr = byIdent.get(identNorm) || [];
      arr.push(row);
      byIdent.set(identNorm, arr);
    });
  } catch (e) {
    logErr("buildInventarioClaveIndexLocal", e);
  }

  return {
    byPlatIdent,
    byIdent,
    findByPlatIdent(plataforma = "", ident = "") {
      const plat = normalizarPlataforma(plataforma);
      const key = `${plat}__${syncIdentKeyLocal(normalizeIdentByPlatformLocal(plat, ident))}`;
      return byPlatIdent.get(key) || null;
    },
    findByAnyIdent(ident = "", plataformaPreferida = "") {
      const key = syncIdentKeyLocal(ident);
      const rows = byIdent.get(key) || [];
      return pickInventarioMatchLocal(rows, plataformaPreferida);
    },
  };
}

async function buscarInventarioFlexiblePorServicioLocal(servicio = {}, plataformaObjetivo = "", inventarioIndex = null) {
  const plat = normalizarPlataforma(plataformaObjetivo || servicio.plataforma || "");
  const identOriginal = getIdentServicioSyncLocal(servicio);
  if (!plat || !identOriginal) return null;

  // IMPORTANTE: nunca emparejar únicamente por correo/usuario.
  // El mismo acceso puede existir en plataformas distintas (por ejemplo,
  // cocacola@... en Disney y Prime Video). El fallback antiguo por "solo correo"
  // podía cambiar la plataforma de un servicio o traer la clave/PIN de otra
  // cuenta. La identidad real de inventario es SIEMPRE plataforma + acceso.
  const index = inventarioIndex || await buildInventarioClaveIndexLocal();
  const inv = index.findByPlatIdent(plat, identOriginal);
  if (!inv) return null;
  return { ...inv, plataformaCoincidente: plat, match: "plataforma_correo" };
}

async function sincronizarUnServicioDesdeInventarioLocal(clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) throw new Error("Cliente no encontrado.");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) throw new Error("Servicio inválido.");

  const actual = servicios[idx] || {};
  const platActual = normalizarPlataforma(actual.plataforma || "");
  const ident = getIdentServicioSyncLocal(actual);
  if (!ident) throw new Error("Este servicio no tiene correo/usuario.");

  const inv = await buscarInventarioFlexiblePorServicioLocal(actual, platActual);
  if (!inv) throw new Error("No encontré ese correo/usuario en inventario.");

  const platInv = normalizarPlataforma(inv.plataformaCoincidente || inv.plataforma || platActual);
  const claveInv = extraerClaveInventarioLocal(inv.data || {});
  const pinInv = extraerPinInventarioLocal(inv.data || {});
  const patch = { plataforma: platInv };

  if (requiereClaveLocal(platInv)) {
    if (!claveInv) throw new Error("La cuenta existe en inventario, pero no tiene clave guardada.");
    patch.clave = claveInv;
  } else {
    patch.clave = "";
  }

  if (requierePinLocal(platInv)) {
    patch.pin = extraerPinServicioLocal(actual) || pinInv || "";
  } else {
    patch.pin = "";
  }

  await patchServicio(clientId, idx, patch, actual.compraId || "");
  return {
    ok: true,
    plataformaAnterior: platActual,
    plataformaNueva: platInv,
    correo: ident,
    claveActualizada: !!patch.clave,
    pinConservado: !!patch.pin,
    match: inv.match || "",
  };
}

async function sincronizarClavesClientesVigentes(chatId) {
  const lockKey = String(chatId || "global");
  if (!global.__SUBLICUENTAS_SYNC_CLAVES_RUNNING__) global.__SUBLICUENTAS_SYNC_CLAVES_RUNNING__ = new Set();
  const running = global.__SUBLICUENTAS_SYNC_CLAVES_RUNNING__;
  if (running.has(lockKey)) {
    return bot.sendMessage(chatId, "⏳ Ya hay una sincronización de claves en proceso. Espere que termine.");
  }

  running.add(lockKey);
  let clientesRevisados = 0;
  let clientesActualizados = 0;
  let serviciosRevisados = 0;
  let serviciosActualizados = 0;
  let omitidosNoVigentes = 0;
  let omitidosSoloCorreo = 0;
  let sinInventario = 0;
  let sinClaveInventario = 0;
  let sinCorreo = 0;
  let plataformasCorregidas = 0;
  const plataformasActualizadas = new Map();

  try {
    const snapClientes = await db.collection("clientes").get();
    const inventarioIndex = await buildInventarioClaveIndexLocal();

    for (const docCli of snapClientes.docs) {
      clientesRevisados++;
      const resultado = await db.runTransaction(async (tx) => {
        const docActual = await tx.get(docCli.ref);
        if (!docActual.exists) return { changed: false, stats: {}, plataformas: [] };
        const cliente = docActual.data() || {};
        const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
        const stats = {
          serviciosRevisados: 0,
          serviciosActualizados: 0,
          omitidosNoVigentes: 0,
          omitidosSoloCorreo: 0,
          sinInventario: 0,
          sinClaveInventario: 0,
          sinCorreo: 0,
          plataformasCorregidas: 0,
        };
        const plataformas = [];
        let changed = false;
        const nuevosServicios = [];

        for (const servicioRaw of servicios) {
          const servicio = { ...(servicioRaw || {}) };
          let plat = normalizarPlataforma(servicio.plataforma || "");
          stats.serviciosRevisados++;

          if (!servicioVigenteParaSyncLocal(servicio)) {
            stats.omitidosNoVigentes++;
            nuevosServicios.push(servicio);
            continue;
          }
          if (!requiereClaveLocal(plat)) {
            stats.omitidosSoloCorreo++;
            nuevosServicios.push(servicio);
            continue;
          }
          const identOriginal = getIdentServicioSyncLocal(servicio);
          if (!identOriginal) {
            stats.sinCorreo++;
            nuevosServicios.push(servicio);
            continue;
          }

          const inv = await buscarInventarioFlexiblePorServicioLocal(servicio, plat, inventarioIndex);
          if (!inv) {
            stats.sinInventario++;
            nuevosServicios.push(servicio);
            continue;
          }

          const platInv = normalizarPlataforma(inv.plataformaCoincidente || inv.plataforma || plat);
          if (platInv && platInv !== plat && requiereClaveLocal(platInv)) {
            servicio.plataforma = platInv;
            plat = platInv;
            changed = true;
            stats.plataformasCorregidas++;
          }

          const claveInv = extraerClaveInventarioLocal(inv.data || {});
          if (!claveInv) {
            stats.sinClaveInventario++;
            nuevosServicios.push(servicio);
            continue;
          }

          const pinInv = extraerPinInventarioLocal(inv.data || {});
          if (requierePinLocal(plat) && !String(servicio.pin || "").trim() && pinInv) {
            servicio.pin = pinInv;
            changed = true;
          }

          const claveActual = String(servicio.clave || servicio.password || servicio.pass || "").trim();
          if (claveActual !== claveInv) {
            servicio.clave = claveInv;
            delete servicio.password;
            delete servicio.pass;
            changed = true;
            stats.serviciosActualizados++;
            plataformas.push(plat);
          }
          nuevosServicios.push(servicio);
        }

        if (changed) {
          tx.set(docCli.ref, {
            servicios: nuevosServicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        return { changed, stats, plataformas };
      });

      const stats = resultado.stats || {};
      serviciosRevisados += Number(stats.serviciosRevisados || 0);
      serviciosActualizados += Number(stats.serviciosActualizados || 0);
      omitidosNoVigentes += Number(stats.omitidosNoVigentes || 0);
      omitidosSoloCorreo += Number(stats.omitidosSoloCorreo || 0);
      sinInventario += Number(stats.sinInventario || 0);
      sinClaveInventario += Number(stats.sinClaveInventario || 0);
      sinCorreo += Number(stats.sinCorreo || 0);
      plataformasCorregidas += Number(stats.plataformasCorregidas || 0);
      (resultado.plataformas || []).forEach((plat) => {
        plataformasActualizadas.set(plat, (plataformasActualizadas.get(plat) || 0) + 1);
      });
      if (resultado.changed) {
        clientesActualizados++;
        try { cacheInvalidatePrefix(`clientes:doc:${docCli.id}`); } catch (_) {}
      }
    }

    const topPlats = Array.from(plataformasActualizadas.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([plat, total]) => `• ${humanPlatLabelSyncLocal(plat)}: ${total}`)
      .join("\n");

    let txt = `✅ *Claves sincronizadas*\n\n`;
    txt += `👥 Clientes revisados: *${clientesRevisados}*\n`;
    txt += `📝 Clientes actualizados: *${clientesActualizados}*\n`;
    txt += `🧩 Servicios revisados: *${serviciosRevisados}*\n`;
    txt += `🔑 Claves colocadas/actualizadas: *${serviciosActualizados}*\n\n`;
    txt += `ℹ️ No tocados:\n`;
    txt += `• Vencidos/no vigentes: ${omitidosNoVigentes}\n`;
    txt += `• Solo correo: ${omitidosSoloCorreo}\n`;
    txt += `• Sin correo/usuario: ${sinCorreo}\n`;
    txt += `• No encontrados en inventario: ${sinInventario}\n`;
    txt += `• Inventario sin clave: ${sinClaveInventario}`;
    if (topPlats) txt += `\n\n📌 *Por plataforma:*\n${escMD(topPlats)}`;

    return bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
  } catch (e) {
    logErr("sincronizarClavesClientesVigentes", e);
    return bot.sendMessage(chatId, "⚠️ No se pudo sincronizar claves. Revise los logs del servidor.");
  } finally {
    running.delete(lockKey);
  }
}

function humanPlatLabelSyncLocal(key = "") {
  const p = normalizarPlataforma(key);
  const labels = {
    netflix: "Netflix Premium",
    vipnetflix: "Netflix VIP",
    disneyp: "Disney Premium",
    disneys: "Disney Premium sin ESPN",
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
    stellatv1: "Stella TV (1 dispositivo)",
    stellatv2: "Stella TV (2 dispositivos)",
    stellatv3: "Stella TV (3 dispositivos)",
    oleadatv1: "Oleada TV (1)",
    oleadatv3: "Oleada TV (3)",
    latintv1: "LatinTV (1 dispositivo)",
    latintv2: "LatinTV (2 dispositivos)",
    latintv3: "LatinTV (3 dispositivos)",
    latintv4: "LatinTV (4 dispositivos)",
    liontv1: "LionTV (1 dispositivo)",
    liontv2: "LionTV (2 dispositivos)",
    liontv3: "LionTV (3 dispositivos)",
    liontv5: "LionTV (5 dispositivos)",
    evoutouch4: "EvouTouch (4 dispositivos)",
    iptv1: "IPTV anterior (1)",
    iptv3: "IPTV anterior (3)",
    iptv4: "IPTV anterior (4)",
    canva: "Canva",
    gemini: "Gemini Pro",
    chatgpt: "ChatGPT",
    duolingo: "Duolingo",
    office: "Microsoft 365",
    office2021: "Office 2021",
  };
  return labels[p] || String(key || "");
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
    stellatv1: 1,
    stellatv2: 2,
    stellatv3: 3,
    oleadatv1: 1,
    oleadatv3: 3,
    latintv1: 1,
    latintv2: 2,
    latintv3: 3,
    latintv4: 4,
    liontv1: 1,
    liontv2: 2,
    liontv3: 3,
    liontv5: 5,
    evoutouch4: 4,
    iptv1: 1,
    iptv3: 3,
    iptv4: 4,
    canva: 1,
    gemini: 1,
    chatgpt: 1,
    duolingo: 1,
    office: 1,
    office2021: 1,
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
      // 🎨 FIX (ago-2026): a este menú nunca se le puso el campo "style" que
      // sí tienen los demás menús (Finanzas, Alertas, Inventario) — por eso
      // salía sin color aunque el resto del bot sí lo mostraba. Mismos
      // colores que ya usan en esos otros menús para las mismas acciones.
      return upsertPanel(chatId, texto, [
        [
          { text: "🎯 Control cuentas", callback_data: "menu:inventario", style: "primary" },
          { text: "👥 Clientes", callback_data: "menu:clientes", style: "primary" },
        ],
        [
          { text: "💰 Control financiero", callback_data: "menu:pagos", style: "success" },
          { text: "🚨 Riesgos", callback_data: "menu:alertas", style: "danger" },
        ],
        [
          { text: "📊 Análisis", callback_data: "menu:dashboard", style: "primary" },
          { text: "👤 Revendedores", callback_data: "menu:revendedores", style: "primary" },
        ],
      ], "Markdown");
    } else if (await safeIsVendedorLocal(userId)) {
      return upsertPanel(chatId, "👤 *MENÚ VENDEDOR*\n\nSeleccione una opción:", [
        [{ text: "📅 Mis renovaciones hoy",  callback_data: "ren:mis:hoy", style: "primary" },      { text: "⏳ Próximos 3 días",      callback_data: "ren:mis:prox3", style: "primary" }],
        [{ text: "📄 TXT renovaciones",      callback_data: "txt:mis", style: "primary" },           { text: "👥 Mis clientes",         callback_data: "vend:clientes", style: "primary" }],
        [{ text: "🧾 TXT mis clientes",      callback_data: "vend:clientes:txt", style: "primary" }, { text: "💰 Mi resumen del mes",   callback_data: "vend:resumen", style: "success" }],
        [{ text: "🔴 Mis vencidos",          callback_data: "vend:vencidos", style: "danger" }],
        [{ text: "🔍 Buscar cliente",          callback_data: "vend:buscar", style: "primary" }],
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


async function enviarExcelClientesGeneralBot(chatId) {
  try {
    await bot.sendMessage(chatId, "⏳ Generando Excel profesional de clientes...");
    const { generarExcelClientesGeneral } = require("./index_11_clientes_excel");
    const rawBuffer = await generarExcelClientesGeneral();
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);

    if (!buffer || !buffer.length) {
      return bot.sendMessage(chatId, "❌ Error al generar el archivo de clientes.");
    }

    const fecha = hoyDMY().replace(/\//g, "-");
    await bot.sendDocument(chatId, buffer,
      {
        caption:
          "📊 Excel CRM Clientes — Nivel Saiyajin\n" +
          "✅ Resumen\n" +
          "✅ Clientes vigentes\n" +
          "✅ Recuperar clientes (no vigentes)\n" +
          "✅ Clientes top\n" +
          "✅ Pagos y servicios\n" +
          "✅ Vendedores"
      },
      {
        filename: `clientes_sublicuentas_${fecha}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }
    );

    return bot.sendMessage(chatId, "✅ Excel de clientes generado correctamente.");
  } catch (e) {
    logErr("enviarExcelClientesGeneralBot", e?.stack || e?.message || e);
    return bot.sendMessage(chatId, `❌ Error generando Excel de clientes: ${e?.message || "desconocido"}`);
  }
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
    if (requiereCorreoLocal(x.plataforma || "")) txt += `${getIdentLabelLocal(x.plataforma || "")}: ${x.correo || "-"}\n`;
    if (requierePinLocal(x.plataforma || "")) txt += `PIN: ${x.pin || "-"}\n`;
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
    const vendedorNorm = normVendedor(vendedorNombre || "");
    const servicios = (Array.isArray(c.servicios) ? c.servicios : [])
      .filter((s) => vendedorEfectivoServicio(s, c).vendedor_norm === vendedorNorm);
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
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((cliente) => !String(cliente.consolidadoEn || "").trim())
    .map((cliente) => ({ ...cliente, telefono: normalizarTelefonoCliente(cliente.telefono_norm || cliente.telefono || "") || cliente.telefono || "" }));
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
  const qDigits = normalizarTelefonoCliente(qRaw);

  if (!qNorm && !qDigits) return [];
  if (isEmailLike(qRaw)) return [];

  const out = new Map();
  try {
    // Reutiliza el snapshot de buscarClienteRobusto: NO vuelve a leer Firestore.
    const rows = await getClientesBusquedaSnapshot();
    for (const x of rows) {
      const nombres = [x.nombrePerfil, x.nombre, x.cliente, x.nombre_norm]
        .map((v) => normalizeLooseText(v || ""));
      const vendedores = [x.vendedor, x.vendedor_norm]
        .map((v) => normalizeLooseText(v || ""));
      const telefonos = [x.telefono, x.telefono_norm, x.whatsapp, x.numero]
        .map((v) => normalizarTelefonoCliente(v || ""));

      let match = false;
      if (qDigits && qDigits.length >= 4 && telefonos.some((v) => v.includes(qDigits))) match = true;
      if (!match && qNorm && qNorm.length >= 2) {
        if (nombres.some((v) => v.includes(qNorm))) match = true;
        if (!match && vendedores.some((v) => v.includes(qNorm))) match = true;
      }

      if (match) out.set(x.id, x);
      if (out.size >= 30) break;
    }
  } catch (e) {
    logErr("buscarClientesFallbackLocal:cache", e?.stack || e?.message || e);
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

// Modos que REALMENTE esperan que el usuario escriba una respuesta.
// Cualquier otro pending es un selector por botones y jamás debe bloquear
// una nueva búsqueda escrita (correo, teléfono o nombre).
const PENDING_TEXT_INPUT_MODES_LOCAL = new Set([
  "cliAddServClave",
  "cliAddServFecha",
  "cliAddServMail",
  "cliAddServPin",
  "cliAddServPrecio",
  "cliAddServVendedor",
  "cliEditNombre",
  "cliEditTel",
  "cliEditVendedor",
  "cliProfAddKey",
  "cliProfAddMail",
  "cliProfAddName",
  "cliProfAddPin",
  "cliProfEdit",
  "cliRenovarFechaManual",
  "cliRenovarFechaManualAll",
  "cliServEditClave",
  "cliServEditFecha",
  "cliServEditMail",
  "cliServEditPin",
  "cliServEditPrecio",
  "cliServEditVendedor",
  "cliServSetPlatPin",
  "finBancosFechaAsk",
  "finBancosRangoFin",
  "finBancosRangoInicio",
  "finCierreCajaAsk",
  "finCierreCajaRangoFin",
  "finCierreCajaRangoInicio",
  "finDetalleBancoFin",
  "finDetalleBancoInicio",
  "finDetalleBancoNombreAsk",
  "finEditBanco",
  "finEditDetalle",
  "finEditFecha",
  "finEditMonto",
  "finEditMotivo",
  "finEditPlataforma",
  "finEgresoDetalle",
  "finEgresoFecha",
  "finEgresoMonto",
  "finEliminarFechaAsk",
  "finExcelRangoFin",
  "finExcelRangoInicio",
  "finIngresoDetalle",
  "finIngresoFecha",
  "finIngresoMonto",
  "finIngresoPlataformaManual",
  "finResumenBancoMesAsk",
  "finResumenFechaAsk",
  "finResumenRangoFin",
  "finResumenRangoInicio",
  "finTopCombosRangoFin",
  "finTopCombosRangoInicio",
  "finTopPlataformasMesAsk",
  "finTopPlataformasRangoFin",
  "finTopPlataformasRangoInicio",
  "invEditClave",
  "invNewClave",
  "invNewCorreo",
  "invNewPerfiles",
  "invRestarQty",
  "invSumarQty",
  "mailAddClienteNombre",
  "mailAddClientePin",
  "mailEditClaveCorreo",
  "mailEditCorreoCuenta",
  "mailEditPin",
  "revAddNombre",
  "revAddTelegramId",
  "vendBuscarCliente",
]);

function interactiveStateAgeMsLocal(state) {
  const ts = Number(state?._ts || state?.updatedAt || 0);
  return ts > 0 ? Math.max(0, Date.now() - ts) : 0;
}

function cleanupStaleInteractiveStateLocal(chatId) {
  const key = String(chatId);
  const maxAge = 15 * 60 * 1000;
  try {
    const p = pending.get(key);
    if (p && interactiveStateAgeMsLocal(p) > maxAge) pending.delete(key);
  } catch (_) {}
  try {
    const w = wizard.get(key);
    if (w && interactiveStateAgeMsLocal(w) > maxAge) wizard.delete(key);
  } catch (_) {}
}

function pendingReallyExpectsTextLocal(state) {
  if (!state) return false;
  return PENDING_TEXT_INPUT_MODES_LOCAL.has(String(state.mode || ""));
}

// ==========================================================
// CAMBIO DE PLATAFORMA DIRECTO Y SEGURO
// ==========================================================
// El flujo anterior necesitaba un segundo callback para mostrar una
// confirmación. En algunos despliegues ese segundo callback quedaba sin
// procesar y la pantalla parecía congelada. Ahora tocar la plataforma
// ejecuta el movimiento inmediatamente contra Firestore. Los callbacks
// antiguos mail_move_to siguen funcionando y se enrutan aquí también.
async function moverCuentaPorTokenYDestinoLocal(chatId, token = "", nuevaRaw = "") {
  const moveToken = String(token || "").trim();
  const nuevaPlat = normalizarPlataforma(nuevaRaw || "");

  if (!moveToken) throw new Error("No pude identificar la cuenta. Abra la cuenta nuevamente.");
  if (!esPlataformaValida(nuevaPlat)) throw new Error("Plataforma destino inválida.");

  const found = await buscarCuentaInventarioPorMoveToken(moveToken);
  if (!found) throw new Error("La cuenta ya no existe en Bodega.");

  const src = found.data || {};
  const oldPlat = normalizarPlataforma(src.plataforma || "");
  const acceso = String(src.correo || src.usuario || src.ident || "").trim();
  if (!oldPlat || !acceso) throw new Error("La cuenta no tiene plataforma o correo/usuario válido.");
  if (oldPlat === nuevaPlat) {
    return { sinCambios: true, anterior: oldPlat, nueva: nuevaPlat, ident: acceso, found };
  }

  const r = await moverCuentaInventarioPlataforma(found.id, nuevaPlat);
  pending.delete(String(chatId));
  forceNextPanelAtBottom(chatId);

  await bot.sendMessage(
    chatId,
    `✅ *Cuenta movida correctamente*\n\n${escMD(humanPlataforma(r.anterior))} ➜ *${escMD(humanPlataforma(r.nueva))}*\n${identIcon(r.nueva)} ${escMD(r.ident)}\n👥 Cupos actuales: ${r.ocupados}/${r.capacidad}\n\nAhora ejecute /sincronizar_todo para reconciliar los perfiles vigentes del CRM con Bodega.`,
    { parse_mode: "Markdown" }
  );
  await mostrarPanelCorreo(chatId, r.nueva, r.ident);
  return r;
}

async function moverCuentaPorAccesoLocal(chatId, accesoRaw = "", nuevaRaw = "", origenRaw = "") {
  const acceso = String(accesoRaw || "").trim();
  const nuevaPlat = normalizarPlataforma(nuevaRaw || "");
  const origenPlat = origenRaw ? normalizarPlataforma(origenRaw) : "";
  if (!acceso) throw new Error("Falta el correo/usuario de la cuenta.");
  if (!esPlataformaValida(nuevaPlat)) throw new Error("Plataforma destino inválida.");
  if (origenPlat && !esPlataformaValida(origenPlat)) throw new Error("Plataforma origen inválida.");

  const hits = await buscarInventarioPorCorreo(acceso);
  const exactos = (Array.isArray(hits) ? hits : []).filter((x) => {
    const p = normalizarPlataforma(x?.plataforma || "");
    if (origenPlat && p !== origenPlat) return false;
    const stored = String(x?.correo || x?.usuario || x?.ident || "").trim();
    return normalizeIdentByPlatformLocal(p, stored) === normalizeIdentByPlatformLocal(p, acceso);
  });

  if (!exactos.length) throw new Error(`No encontré esa cuenta${origenPlat ? ` en ${humanPlataforma(origenPlat)}` : ""}.`);
  if (exactos.length > 1) {
    const plats = [...new Set(exactos.map((x) => humanPlataforma(x.plataforma || "")))].join(", ");
    throw new Error(`Hay más de una cuenta exacta con ese acceso (${plats}). Use: /movercuenta PLATAFORMA_ORIGEN acceso PLATAFORMA_DESTINO`);
  }

  const row = exactos[0];
  const oldPlat = normalizarPlataforma(row.plataforma || "");
  if (oldPlat === nuevaPlat) throw new Error(`La cuenta ya está en ${humanPlataforma(nuevaPlat)}.`);

  const r = await moverCuentaInventarioPlataforma(row.id, nuevaPlat);
  pending.delete(String(chatId));
  forceNextPanelAtBottom(chatId);
  await bot.sendMessage(
    chatId,
    `✅ *Cuenta movida correctamente*\n\n${escMD(humanPlataforma(r.anterior))} ➜ *${escMD(humanPlataforma(r.nueva))}*\n${identIcon(r.nueva)} ${escMD(r.ident)}\n👥 Cupos actuales: ${r.ocupados}/${r.capacidad}`,
    { parse_mode: "Markdown" }
  );
  return mostrarPanelCorreo(chatId, r.nueva, r.ident);
}

async function resolverBusquedaAdmin(chatId, query = "") {
  const q = String(query || "").trim().replace(/^\/+/, "").trim();
  if (!q) return bot.sendMessage(chatId, "⚠️ Escriba algo para buscar.");
  if (isNavigationTextLocal(q)) return;

  // ✅ Cada búsqueda por texto debe aparecer como mensaje nuevo abajo,
  // no editar el panel anterior que quedó más arriba en el chat
  forceNextPanelAtBottom(chatId);

  const qDigits = normalizarTelefonoCliente(q);
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
    disneys: "Disney Premium sin ESPN",
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
    stellatv1: "Stella TV 1",
    stellatv2: "Stella TV 2",
    stellatv3: "Stella TV 3",
    oleadatv1: "Oleada 1",
    oleadatv3: "Oleada 3",
    latintv1: "LatinTV 1",
    latintv2: "LatinTV 2",
    latintv3: "LatinTV 3",
    latintv4: "LatinTV 4",
    liontv1: "LionTV 1",
    liontv2: "LionTV 2",
    liontv3: "LionTV 3",
    liontv5: "LionTV 5",
    iptv1: "IPTV anterior 1",
    iptv3: "IPTV anterior 3",
    iptv4: "IPTV anterior 4",
    canva: "Canva",
    gemini: "Gemini Pro",
    chatgpt: "ChatGPT",
    duolingo: "Duolingo",
    office: "Microsoft 365",
    office2021: "Office 2021",
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
          vendedor: vendedorEfectivoServicio(s, c).vendedor || "-",
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

bot.onText(/\/sincronizar_claves/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await safeIsAdminLocal(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo ADMIN puede sincronizar claves.");
  }

  return upsertPanel(
    chatId,
    `🔄 *SINCRONIZAR CLAVES VIGENTES*\n\nEsto revisará todos los clientes vigentes y colocará la clave desde inventario cuando coincida la misma plataforma + correo/usuario.\n\nNo toca PIN. No toca Canva, Gemini, ChatGPT ni Duolingo porque son solo correo.`,
    [
      [{ text: "✅ Ejecutar sincronización", callback_data: "sync:claves:run" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ]
  );
});

bot.onText(/\/sincronizar_todo/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await safeIsAdminLocal(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo ADMIN puede sincronizar la base de datos.");
  }

  await bot.sendMessage(
    chatId,
    "🔄 *Auditando y sincronizando inventario con el CRM...*\n\nSolo se cruzarán perfiles VIGENTES por *plataforma + correo/usuario exactos*. No se mezclan plataformas aunque usen el mismo correo.",
    { parse_mode: "Markdown" }
  );

  let perfilesVigentes = 0;
  let perfilesVinculados = 0;
  let perfilesAgregados = 0;
  let perfilesDepurados = 0;
  let cuentasActualizadas = 0;
  let cuentasDuplicadas = 0;
  let cuentasSinInventario = 0;
  let conflictosCapacidad = 0;
  let legacySinVerificar = 0;
  const avisosSinCuenta = [];
  const avisosDuplicados = [];
  const avisosCapacidad = [];
  const avisosOtraPlataforma = [];

  try {
    const [snapInv, snapClientes] = await Promise.all([
      db.collection("inventario").get(),
      db.collection("clientes").get(),
    ]);

    // 1) Indexar inventario por la identidad REAL: plataforma + acceso.
    const invPorKey = new Map();
    const plataformasPorAcceso = new Map();
    snapInv.forEach((d) => {
      const data = d.data() || {};
      const plat = normalizarPlataforma(data.plataforma || "");
      const acceso = normalizeIdentByPlatformLocal(plat, getIdentInventarioSyncLocal(data));
      if (!plat || !acceso) return;
      const key = `${plat}__${syncIdentKeyLocal(acceso)}`;
      if (!invPorKey.has(key)) invPorKey.set(key, []);
      invPorKey.get(key).push({ id: d.id, ref: d.ref, data, plat, acceso });

      const accesoGlobal = syncIdentKeyLocal(acceso);
      const set = plataformasPorAcceso.get(accesoGlobal) || new Set();
      set.add(plat);
      plataformasPorAcceso.set(accesoGlobal, set);
    });

    // 2) Construir lo que DEBE haber en cada cuenta usando solo servicios vigentes.
    const esperadosPorKey = new Map();
    for (const docCli of snapClientes.docs) {
      const c = docCli.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      const titular = String(c.nombrePerfil || c.nombre || "Sin Nombre").trim();
      const telefono = String(c.telefono || c.celular || c.phone || "").trim();

      for (let servicioIndex = 0; servicioIndex < servicios.length; servicioIndex++) {
        const s = servicios[servicioIndex] || {};
        if (!s.plataforma || !servicioVigenteParaSyncLocal(s)) continue;
        const plat = normalizarPlataforma(s.plataforma || "");
        if (!plat) continue;
        const perfiles = perfilesServicioLocal(s, titular);
        const compraId = String(s.compraId || `legacy_compra_${docCli.id}_${servicioIndex}`);

        for (let perfilIndex = 0; perfilIndex < perfiles.length; perfilIndex++) {
          const perfil = perfiles[perfilIndex] || {};
          const acceso = normalizeIdentByPlatformLocal(plat, perfil.correo || s.correo || "");
          if (!acceso) continue;

          perfilesVigentes++;
          const perfilId = String(perfil.perfilId || `legacy_perfil_${docCli.id}_${servicioIndex}_${perfilIndex}`);
          const nombre = String(perfil.nombre || titular || "Sin Nombre").trim();
          const pin = String(perfil.pin || s.pin || s.pinPerfil || "").trim();
          const key = `${plat}__${syncIdentKeyLocal(acceso)}`;
          const row = { nombre, pin, telefono, clienteId: docCli.id, compraId, perfilId, plat, acceso };
          const arr = esperadosPorKey.get(key) || [];

          // Evitar duplicar el mismo perfil si una ficha vieja repite datos.
          const ya = arr.some((x) =>
            String(x.perfilId || "") === perfilId
            || (String(x.compraId || "") === compraId && String(x.clienteId || "") === docCli.id && normTxt(x.nombre || "") === normTxt(nombre))
          );
          if (!ya) arr.push(row);
          esperadosPorKey.set(key, arr);
        }
      }
    }

    // 3) Diagnosticar servicios vigentes que no tienen cuenta exacta.
    for (const [key, esperados] of esperadosPorKey.entries()) {
      if (invPorKey.has(key)) continue;
      cuentasSinInventario++;
      const e = esperados[0] || {};
      const otras = Array.from(plataformasPorAcceso.get(syncIdentKeyLocal(e.acceso || "")) || []).filter((p) => p !== e.plat);
      if (otras.length) {
        avisosOtraPlataforma.push(`${humanPlataforma(e.plat)} · ${e.acceso} → ese mismo acceso existe en ${otras.map(humanPlataforma).join(", ")}`);
      } else {
        avisosSinCuenta.push(`${humanPlataforma(e.plat)} · ${e.acceso}`);
      }
    }

    // 4) Reconciliar TODAS las cuentas de inventario.
    //    - añade perfiles vigentes del CRM que faltan;
    //    - enlaza IDs a filas legacy que sí coinciden;
    //    - quita únicamente filas con IDs que ya NO corresponden a un servicio
    //      vigente de esa misma plataforma + acceso (esto limpia contaminación
    //      creada por sincronizaciones anteriores);
    //    - conserva filas legacy sin IDs que no podemos demostrar como incorrectas.
    for (const [key, docs] of invPorKey.entries()) {
      if (docs.length !== 1) {
        cuentasDuplicadas++;
        const d0 = docs[0] || {};
        avisosDuplicados.push(`${humanPlataforma(d0.plat)} · ${d0.acceso} (${docs.length} documentos)`);
        continue;
      }

      const inv = docs[0];
      const data = inv.data || {};
      const actuales = Array.isArray(data.clientes) ? data.clientes.slice() : [];
      const esperados = (esperadosPorKey.get(key) || []).slice();
      const usados = new Set();
      const salida = [];
      let cambios = false;

      const encontrarActual = (e) => {
        let idx = -1;
        if (e.perfilId) idx = actuales.findIndex((x, i) => !usados.has(i) && String(x?.perfilId || "") === String(e.perfilId));
        if (idx === -1 && e.compraId) idx = actuales.findIndex((x, i) => !usados.has(i)
          && String(x?.compraId || "") === String(e.compraId)
          && String(x?.clienteId || "") === String(e.clienteId || ""));
        if (idx === -1) idx = actuales.findIndex((x, i) => !usados.has(i)
          && !String(x?.perfilId || "").trim()
          && !String(x?.compraId || "").trim()
          && normTxt(x?.nombre || "") === normTxt(e.nombre || "")
          && (!String(e.pin || "").trim() || String(x?.pin || "").trim() === String(e.pin || "").trim()));
        return idx;
      };

      for (const e of esperados) {
        const idx = encontrarActual(e);
        if (idx !== -1) {
          usados.add(idx);
          const anterior = actuales[idx] || {};
          const unido = {
            ...anterior,
            nombre: e.nombre,
            ...(e.pin ? { pin: e.pin } : {}),
            ...(e.telefono ? { telefono: e.telefono } : {}),
            clienteId: e.clienteId,
            compraId: e.compraId,
            perfilId: e.perfilId,
          };
          if (JSON.stringify(anterior) !== JSON.stringify(unido)) {
            perfilesVinculados++;
            cambios = true;
          }
          salida.push(unido);
        } else {
          salida.push({
            nombre: e.nombre,
            pin: e.pin,
            ...(e.telefono ? { telefono: e.telefono } : {}),
            clienteId: e.clienteId,
            compraId: e.compraId,
            perfilId: e.perfilId,
          });
          perfilesAgregados++;
          cambios = true;
        }
      }

      // Lo que sobró en inventario: si tiene IDs, fue enlazado por el sistema y
      // ya no existe como servicio vigente exacto → se depura. Si es una fila
      // legacy sin IDs, se conserva para no borrar datos manuales a ciegas.
      for (let i = 0; i < actuales.length; i++) {
        if (usados.has(i)) continue;
        const row = actuales[i] || {};
        const tieneIds = Boolean(String(row.perfilId || "").trim() || String(row.compraId || "").trim() || String(row.clienteId || "").trim());
        if (tieneIds) {
          perfilesDepurados++;
          cambios = true;
        } else {
          salida.push(row);
          legacySinVerificar++;
        }
      }

      const capacidad = Number(data.capacidad || data.total || getTotalPorPlataformaLocal(inv.plat) || 1);
      if (capacidad > 0 && salida.length > capacidad) {
        conflictosCapacidad++;
        avisosCapacidad.push(`${humanPlataforma(inv.plat)} · ${inv.acceso}: ${salida.length}/${capacidad}`);
        continue; // No tocar una cuenta si la reconciliación excede su capacidad.
      }

      const normalizados = salida.map((x, i) => ({ ...x, slot: i + 1 }));
      const ocupados = normalizados.length;
      const disponibles = Math.max(0, capacidad - ocupados);
      const estado = disponibles === 0 ? "llena" : "activa";
      const metadataCambio = Number(data.ocupados) !== ocupados
        || Number(data.disponibles ?? data.disp) !== disponibles
        || Number(data.capacidad || data.total || capacidad) !== capacidad
        || String(data.estado || "") !== estado;

      if (cambios || metadataCambio) {
        await inv.ref.set({
          clientes: normalizados,
          ocupados,
          disponibles,
          disp: disponibles,
          capacidad,
          estado,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        cuentasActualizadas++;
      }
    }

    const lineas = [
      "✅ Sincronización segura completada",
      "",
      `👤 Perfiles vigentes revisados: ${perfilesVigentes}`,
      `🔗 Perfiles enlazados/corregidos: ${perfilesVinculados}`,
      `➕ Perfiles agregados a su cuenta exacta: ${perfilesAgregados}`,
      `🧹 Asignaciones antiguas depuradas: ${perfilesDepurados}`,
      `📦 Cuentas actualizadas: ${cuentasActualizadas}`,
      `⚠️ Cuentas exactas faltantes: ${cuentasSinInventario}`,
      `🧬 Cuentas duplicadas (no tocadas): ${cuentasDuplicadas}`,
      `📏 Conflictos de capacidad (no tocados): ${conflictosCapacidad}`,
      `🗂 Filas legacy sin IDs conservadas: ${legacySinVerificar}`,
    ];

    const agregarMuestra = (titulo, arr) => {
      if (!arr.length) return;
      lineas.push("", titulo);
      arr.slice(0, 10).forEach((x) => lineas.push(`• ${x}`));
      if (arr.length > 10) lineas.push(`…y ${arr.length - 10} más.`);
    };
    agregarMuestra("🚫 Servicio CRM sin cuenta de inventario exacta:", avisosSinCuenta);
    agregarMuestra("🔀 MISMO correo/usuario encontrado en OTRA plataforma (NO se mezcló):", avisosOtraPlataforma);
    agregarMuestra("🧬 Duplicados de plataforma + acceso (requieren revisión):", avisosDuplicados);
    agregarMuestra("📏 Capacidad excedida (no se modificó):", avisosCapacidad);

    lineas.push("", "🛡️ Regla nueva: nunca se sincroniza por correo solo. Deben coincidir plataforma + correo/usuario exactos y el servicio debe estar vigente.");
    return bot.sendMessage(chatId, lineas.join("\n"));
  } catch (error) {
    logErr("sincronizar_todo", error);
    return bot.sendMessage(chatId, "⚠️ Ocurrió un error al sincronizar. Revise los logs del servidor.");
  }
});

// ===============================
// ✅ NUEVO: /reparar_colisiones
// Separa clientes que quedaron mezclados en un mismo documento porque la
// ficha se guardó con el teléfono por defecto del vendedor (Yami, Jimena,
// Heber, Abner, Manuel) en vez del teléfono real del cliente. En ese caso,
// cada cliente nuevo del mismo vendedor pisaba el nombre del anterior en el
// MISMO documento de Firestore, aunque sus servicios (correo/clave/PIN) se
// mantuvieron intactos dentro del array "servicios". Aquí los separamos
// usando el campo "perfil" que cada servicio guarda con el nombre real del
// cliente al que pertenece.
// ===============================
const VENDOR_DEFAULT_PHONES_TG = new Set(["9687724", "88501036", "32174922", "94306551", "87989267"]);

async function detectarColisionesTelefono() {
  // ✅ Nunca debe quedarse "mudo": si Firestore tarda más de 25s (problema de
  // red, cuota, o el proceso reiniciándose por un deploy), se corta y avisa
  // en vez de dejar al admin esperando sin saber qué pasó.
  const TIMEOUT_MS = 25000;
  const snap = await Promise.race([
    db.collection("clientes").get(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout_firestore_25s")), TIMEOUT_MS)),
  ]);

  const colisiones = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const tel = String(c.telefono || "").trim();
    const telDigits = tel.replace(/\D/g, "");

    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    if (!servicios.length) return;

    const grupos = new Map(); // nombreNorm -> { nombre, servicios: [] }
    servicios.forEach((s) => {
      const nombreServ = String((s && s.perfil) || c.nombrePerfil || "Sin nombre").trim() || "Sin nombre";
      const key = nombreServ.toLowerCase();
      if (!grupos.has(key)) grupos.set(key, { nombre: nombreServ, servicios: [] });
      grupos.get(key).servicios.push(s);
    });

    // ✅ Ya no exigimos que el teléfono coincida exacto con el default del
    // vendedor (algunos quedaron con formato distinto): cualquier documento
    // con más de un nombre de perfil distinto entre sus servicios es
    // sospechoso de tener clientes mezclados.
    if (grupos.size > 1) {
      colisiones.push({
        docId: doc.id,
        telefonoVendedor: tel,
        esTelVendedorConocido: VENDOR_DEFAULT_PHONES_TG.has(telDigits),
        vendedor: c.vendedor || "",
        nombreActual: c.nombrePerfil || "",
        grupos: Array.from(grupos.values()),
      });
    }
  });

  return colisiones;
}

bot.onText(/\/reparar_colisiones(?:\s+(confirmar))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo ADMIN puede ejecutar esto.");

  // SEGURIDAD: la versión anterior intentaba separar automáticamente usando
  // servicio.perfil como si siempre fuera el titular y vaciaba teléfonos. Eso
  // puede borrar evidencia y partir una compra legítima. Desde ahora este
  // comando es SOLO LECTURA. La recuperación debe hacerse por clienteId y con
  // evidencia (historial/inventario/respaldo), nunca por nombre inferido.
  const confirmar = !!(match && match[1]);
  if (confirmar) {
    return bot.sendMessage(chatId,
      "⛔ Reparación automática deshabilitada por seguridad. No se modificó Firebase. Use /reparar_colisiones sin 'confirmar' para auditar candidatos; la separación debe hacerse con evidencia por clienteId."
    );
  }

  await bot.sendMessage(chatId, "🔎 Auditando posibles fichas mezcladas (SOLO LECTURA)...");
  try {
    const colisiones = await detectarColisionesTelefono();
    if (!colisiones.length) return bot.sendMessage(chatId, "✅ No encontré documentos con varios nombres internos entre sus servicios.");
    let txt = `⚠️ Encontré ${colisiones.length} documento(s) que requieren revisión manual:

`;
    colisiones.slice(0, 15).forEach((c, i) => {
      txt += `${i + 1}) clientId: ${c.docId} — vendedor actual: ${c.vendedor || "-"} — tel actual: ${c.telefonoVendedor || "-"}
`;
      c.grupos.forEach((g) => { txt += `   • ${g.nombre} — ${g.servicios.length} servicio(s)
`; });
      txt += `
`;
    });
    if (colisiones.length > 15) txt += `…y ${colisiones.length - 15} más.
`;
    txt += `\n⚠️ Esto es una señal, NO prueba de fusión. No se modificó ningún dato.`;
    return bot.sendMessage(chatId, txt);
  } catch (error) {
    logErr("reparar_colisiones_auditoria", error);
    return bot.sendMessage(chatId, "⚠️ No pude completar la auditoría. Revise los logs del servidor.");
  }
});

// ===============================
// AUDITORÍA FORENSE DE IDENTIDAD (SOLO LECTURA)
// Detecta señales de fusiones antiguas sin modificar ningún documento.
// ===============================
bot.onText(/\/auditar_fusiones/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo ADMIN puede ejecutar esto.");

  await bot.sendMessage(chatId, "🔎 Auditando identidad de clientes en Firestore (solo lectura)...");
  try {
    const snap = await db.collection("clientes").get();
    const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    const norm = (v) => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
    const slug = (v) => norm(v).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "cliente";
    const vendorPhones = VENDOR_DEFAULT_PHONES_TG;
    const porNombre = new Map();
    const compraOwners = new Map();

    for (const c of docs) {
      const nn = norm(c.nombrePerfil || c.nombre || "");
      if (nn) {
        if (!porNombre.has(nn)) porNombre.set(nn, []);
        porNombre.get(nn).push(c);
      }
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      for (const sv of servicios) {
        const cid = String(sv?.compraId || "").trim();
        if (!cid) continue;
        if (!compraOwners.has(cid)) compraOwners.set(cid, []);
        compraOwners.get(cid).push(c.id);
      }
    }

    const compraDuplicada = new Set([...compraOwners.entries()].filter(([, owners]) => new Set(owners).size > 1).map(([id]) => id));
    const resultados = [];
    for (const c of docs) {
      const nombre = String(c.nombrePerfil || c.nombre || "").trim();
      const nn = norm(nombre);
      const tel = String(c.telefono || "").trim();
      const telDigits = tel.replace(/\D/g, "");
      const vend = String(c.vendedor || "").trim();
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      let score = 0;
      const motivos = [];

      if (nn && c.id === slug(nn) && servicios.length >= 2) { score += 5; motivos.push("ID antiguo derivado solo del nombre"); }
      if (vendorPhones.has(telDigits)) { score += 4; motivos.push("teléfono coincide con número default de vendedor"); }

      const homologos = porNombre.get(nn) || [];
      if (nn && homologos.length > 1) {
        const vendedores = new Set(homologos.map(x => norm(x.vendedor || "")));
        const telefonos = new Set(homologos.map(x => String(x.telefono || "").replace(/\D/g, "")).filter(Boolean));
        if (vendedores.size > 1 || telefonos.size > 1) { score += 3; motivos.push(`mismo nombre aparece en ${homologos.length} fichas con vendedor/teléfono distinto`); }
      }

      const nombresInternos = new Set();
      for (const sv of servicios) {
        const arr = Array.isArray(sv?.perfiles) && sv.perfiles.length ? sv.perfiles : [sv];
        for (const p of arr) {
          const x = norm(p?.perfil || p?.nombre || sv?.perfil || "");
          if (x && !/^perfil\s*\d*$/.test(x)) nombresInternos.add(x);
        }
        if (compraDuplicada.has(String(sv?.compraId || ""))) { score += 8; motivos.push(`compraId repetido en otra ficha: ${sv.compraId}`); }
      }
      if (nombresInternos.size > 1 && servicios.length > 1) { score += 4; motivos.push(`${nombresInternos.size} nombres internos distintos entre servicios/perfiles`); }

      if (score > 0) resultados.push({ id: c.id, nombre, tel, vend, servicios: servicios.length, score, motivos });
    }

    resultados.sort((a,b) => b.score - a.score || b.servicios - a.servicios);
    const altos = resultados.filter(x => x.score >= 7);
    let txt = `✅ Auditoría terminada\n\nClientes: ${docs.length}\nCandidatos: ${resultados.length}\nAlta sospecha (score ≥7): ${altos.length}\n\n`;
    (altos.length ? altos : resultados).slice(0, 20).forEach((x, i) => {
      txt += `${i+1}) ${x.nombre || "Sin nombre"}\n   clientId: ${x.id}\n   vendedor: ${x.vend || "-"} | tel: ${x.tel || "-"} | servicios: ${x.servicios} | score: ${x.score}\n   señales: ${x.motivos.join("; ")}\n\n`;
    });
    txt += "⚠️ Solo lectura: no se modificó Firebase. Un candidato no debe separarse sin verificar historial/inventario/respaldo.";
    if (txt.length > 3900) txt = txt.slice(0, 3850) + "\n…resultado recortado; hay más candidatos.";
    return bot.sendMessage(chatId, txt);
  } catch (e) {
    logErr("auditar_fusiones", e);
    return bot.sendMessage(chatId, "⚠️ No pude completar la auditoría de fusiones. Revise los logs.");
  }
});

// ===============================
// AUDITORÍA FORENSE INDIVIDUAL: /auditar_cliente <nombre|teléfono|clientId>
// SOLO LECTURA. Nunca crea, edita, separa ni elimina fichas.
// ===============================
function fechaAuditoriaLocal(v) {
  if (!v) return "-";
  if (typeof v === "string") return v;
  try {
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    }
  } catch (_) {}
  return "-";
}

function cortarTelegramLocal(texto = "", max = 3800) {
  const s = String(texto || "");
  if (s.length <= max) return [s];
  const partes = [];
  let resto = s;
  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n", max);
    if (corte < Math.floor(max * 0.55)) corte = max;
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\n+/, "");
  }
  if (resto) partes.push(resto);
  return partes;
}

async function buscarClienteAuditoriaLocal(query = "") {
  const q = String(query || "").trim();
  if (!q) return [];

  // 1) clientId exacto: máxima prioridad, porque es la identidad real.
  try {
    const exactDoc = await db.collection("clientes").doc(q).get();
    if (exactDoc.exists) return [{ id: exactDoc.id, ...(exactDoc.data() || {}) }];
  } catch (_) {}

  // 2) Reutilizamos el buscador robusto, pero reordenamos exactos primero.
  const candidatos = await buscarClienteRobusto(q);
  const norm = (v) => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  const digits = (v) => String(v || "").replace(/\D/g, "");
  const nq = norm(q);
  const dq = digits(q);

  return (Array.isArray(candidatos) ? candidatos : []).sort((a, b) => {
    const score = (c) => {
      const nombre = norm(c?.nombrePerfil || c?.nombre || "");
      const tel = digits(c?.telefono || "");
      let n = 0;
      if (nombre && nombre === nq) n += 100;
      if (dq.length >= 7 && tel === dq) n += 120;
      if (String(c?.id || "") === q) n += 200;
      if (nombre.includes(nq) && nq) n += 10;
      if (dq.length >= 4 && tel.includes(dq)) n += 10;
      return n;
    };
    return score(b) - score(a);
  });
}

async function historialAuditoriaLocal(clientId = "") {
  try {
    const snap = await db.collection("historial_clientes")
      .where("clientId", "==", String(clientId || ""))
      .get();
    return snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) })).sort((a, b) => {
      const ta = a?.fechaTS?.toMillis?.() || 0;
      const tb = b?.fechaTS?.toMillis?.() || 0;
      return tb - ta;
    });
  } catch (e) {
    logErr("auditar_cliente_historial", e);
    return [];
  }
}

function nombresInternosAuditoriaLocal(cliente = {}) {
  const salida = new Set();
  const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
  for (const sv of servicios) {
    const perfiles = perfilesServicioLocal(sv, cliente.nombrePerfil || cliente.nombre || "");
    for (const p of perfiles) {
      const nombre = String(p?.nombre || p?.perfil || "").trim();
      if (nombre && !/^perfil\s*\d*$/i.test(nombre)) salida.add(nombre);
    }
  }
  return [...salida];
}

function renderAuditoriaClienteLocal(cliente = {}, eventos = []) {
  const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
  const internos = nombresInternosAuditoriaLocal(cliente);
  let txt = `🔎 AUDITORÍA INDIVIDUAL — SOLO LECTURA\n\n`;
  txt += `Nombre actual: ${cliente.nombrePerfil || cliente.nombre || "Sin nombre"}\n`;
  txt += `clientId: ${cliente.id || "-"}\n`;
  txt += `Teléfono actual: ${cliente.telefono || "-"}\n`;
  txt += `Vendedor actual: ${cliente.vendedor || "-"}\n`;
  txt += `Servicios actuales: ${servicios.length}\n`;
  txt += `Creado: ${fechaAuditoriaLocal(cliente.createdAt || cliente.fechaCreacion || cliente.created_at)}\n`;
  txt += `Actualizado: ${fechaAuditoriaLocal(cliente.updatedAt || cliente.fechaActualizacion || cliente.updated_at)}\n`;
  txt += `Nombres internos detectados (${internos.length}): ${internos.length ? internos.join(" | ") : "ninguno"}\n`;

  txt += `\n=== SERVICIOS ACTUALES ===\n`;
  if (!servicios.length) txt += `(sin servicios)\n`;
  servicios.forEach((sv, i) => {
    const perfiles = perfilesServicioLocal(sv, cliente.nombrePerfil || cliente.nombre || "");
    txt += `\n${i + 1}) ${humanPlataforma(sv?.plataforma || "")}\n`;
    txt += `   compraId: ${sv?.compraId || "⚠️ SIN compraId"}\n`;
    txt += `   correo/usuario: ${sv?.correo || perfiles?.[0]?.correo || "-"}\n`;
    txt += `   renovación: ${sv?.fechaRenovacion || "-"} | precio: ${Number(sv?.precio || 0).toFixed(2)} Lps\n`;
    txt += `   creado: ${fechaAuditoriaLocal(sv?.createdAt || sv?.fechaCreacion)} | actualizado: ${fechaAuditoriaLocal(sv?.updatedAt || sv?.fechaActualizacion)}\n`;
    txt += `   perfiles (${perfiles.length}):\n`;
    perfiles.forEach((p, pi) => {
      txt += `      ${pi + 1}. ${p?.nombre || p?.perfil || "Sin nombre"} | perfilId: ${p?.perfilId || "⚠️ SIN perfilId"} | correo: ${p?.correo || "-"} | PIN: ${p?.pin || "-"}\n`;
    });
  });

  txt += `\n=== HISTORIAL DISPONIBLE (${eventos.length}) ===\n`;
  if (!eventos.length) {
    txt += `No hay eventos en historial_clientes para este clientId.\n`;
  } else {
    eventos.slice(0, 30).forEach((ev, i) => {
      const fecha = fechaAuditoriaLocal(ev?.fechaTS) !== "-" ? fechaAuditoriaLocal(ev?.fechaTS) : (ev?.fecha || "-");
      const partes = [];
      if (ev?.tipo) partes.push(String(ev.tipo));
      if (ev?.descripcion) partes.push(String(ev.descripcion));
      if (ev?.plataforma) partes.push(humanPlataforma(ev.plataforma));
      if (ev?.correoAnterior) partes.push(`correo anterior: ${ev.correoAnterior}`);
      if (ev?.correo) partes.push(`correo: ${ev.correo}`);
      if (ev?.fechaAnterior) partes.push(`fecha anterior: ${ev.fechaAnterior}`);
      if (ev?.precioAnterior != null) partes.push(`precio anterior: ${ev.precioAnterior}`);
      txt += `${i + 1}. ${fecha} — ${partes.join(" | ") || "evento sin descripción"}\n`;
    });
    if (eventos.length > 30) txt += `…${eventos.length - 30} evento(s) adicional(es) no mostrados.\n`;
  }

  txt += `\n⚠️ Este reporte NO modifica Firebase y NO determina por sí solo qué servicio pertenece a otra persona.`;
  return txt;
}

bot.onText(/^\/auditar_cliente(?:\s+(.+))?$/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo ADMIN puede ejecutar esto.");

  const query = String(match?.[1] || "").trim();
  if (!query) {
    return bot.sendMessage(chatId, "Uso: /auditar_cliente Nombre del cliente\nTambién acepta teléfono o clientId.");
  }

  await bot.sendMessage(chatId, `🔎 Auditando “${query}” (solo lectura)...`);
  try {
    const encontrados = await buscarClienteAuditoriaLocal(query);
    if (!encontrados.length) return bot.sendMessage(chatId, "⚠️ No encontré ninguna ficha que coincida.");

    // Para evitar mezclar resultados parciales sin querer, mostramos hasta 8
    // coincidencias y cada ficha conserva su clientId claramente visible.
    const seleccion = encontrados.slice(0, 8);
    if (encontrados.length > 1) {
      let cab = `Encontré ${encontrados.length} coincidencia(s). Mostraré ${seleccion.length}:\n`;
      seleccion.forEach((c, i) => {
        cab += `${i + 1}) ${c.nombrePerfil || c.nombre || "Sin nombre"} | ${c.telefono || "-"} | ${c.vendedor || "-"} | clientId: ${c.id}\n`;
      });
      await bot.sendMessage(chatId, cab);
    }

    for (const c of seleccion) {
      const eventos = await historialAuditoriaLocal(c.id);
      const reporte = renderAuditoriaClienteLocal(c, eventos);
      const partes = cortarTelegramLocal(reporte);
      for (let i = 0; i < partes.length; i++) {
        const prefijo = partes.length > 1 ? `[${i + 1}/${partes.length}]\n` : "";
        await bot.sendMessage(chatId, prefijo + partes[i]);
      }
    }
  } catch (e) {
    logErr("auditar_cliente", e);
    return bot.sendMessage(chatId, "⚠️ No pude completar la auditoría individual. Revise los logs del servidor.");
  }
});

// ===============================
// ✅ NUEVO: /fix_duplicados (confirmar)
// El nombre ya estaba reservado en comandosReservados pero nunca se había
// implementado. Limpia clientes duplicados dentro del arreglo "clientes" de
// cada cuenta de inventario (ej: mismo nombre repetido con PIN "----" y
// "0000" por el bug de identidad ya corregido en syncServicioEnInventario /
// ajustarInventario). Deja UN solo registro por nombre, priorizando el que
// tenga un PIN real (no vacío, no "0000"), y recalcula ocupados/disponibles.
// ===============================
bot.onText(/\/fix_duplicados(?:\s+(confirmar))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await safeIsAdminLocal(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo ADMIN puede ejecutar esto.");
  }

  const confirmar = !!(match && match[1]);
  await bot.sendMessage(
    chatId,
    confirmar
      ? "🔧 Limpiando clientes duplicados en el inventario..."
      : "🔎 Revisando cuentas del inventario con clientes duplicados (no se guarda nada todavía)..."
  );

  try {
    const snap = await db.collection("inventario").get();
    const afectadas = [];

    snap.forEach((doc) => {
      const data = doc.data() || {};
      const clientes = Array.isArray(data.clientes) ? data.clientes : [];
      if (clientes.length < 2) return;
      const porNombre = new Map();
      for (const c of clientes) {
        const key = normalizeLooseText(c?.nombre || "");
        if (!key) continue;
        if (!porNombre.has(key)) porNombre.set(key, []);
        porNombre.get(key).push(c);
      }
      const grupos = [...porNombre.values()].filter((arr) => arr.length > 1);
      if (grupos.length) afectadas.push({ ref: doc.ref, data, grupos, totalActual: clientes.length });
    });

    if (!afectadas.length) {
      return bot.sendMessage(chatId, "✅ No encontré clientes duplicados en ninguna cuenta del inventario.");
    }

    if (!confirmar) {
      let txt = `⚠️ Encontré ${afectadas.length} cuenta(s) del inventario con clientes duplicados:\n\n`;
      afectadas.slice(0, 15).forEach((a, i) => {
        const plat = a.data.plataforma || "?";
        const correo = a.data.correo || a.data.ident || a.ref.id;
        txt += `${i + 1}) ${plat} — ${correo} (${a.totalActual} perfiles guardados)\n`;
        a.grupos.forEach((g) => { txt += `   • ${g[0].nombre || "Sin nombre"} × ${g.length}\n`; });
        txt += `\n`;
      });
      if (afectadas.length > 15) txt += `…y ${afectadas.length - 15} cuenta(s) más.\n\n`;
      txt += `Nada se ha modificado todavía. Se va a dejar 1 solo registro por cliente (el que tenga PIN real, si hay). Para aplicar, envía:\n/fix_duplicados confirmar`;
      return bot.sendMessage(chatId, txt);
    }

    let cuentasReparadas = 0;
    let perfilesEliminados = 0;

    for (const a of afectadas) {
      const clientes = Array.isArray(a.data.clientes) ? a.data.clientes : [];
      const porNombre = new Map();
      const sinNombre = [];
      for (const c of clientes) {
        const key = normalizeLooseText(c?.nombre || "");
        if (!key) { sinNombre.push(c); continue; }
        if (!porNombre.has(key)) porNombre.set(key, []);
        porNombre.get(key).push(c);
      }
      const limpios = [...sinNombre];
      for (const grupo of porNombre.values()) {
        if (grupo.length === 1) { limpios.push(grupo[0]); continue; }
        const pinValido = (c) => c?.pin && String(c.pin).trim() && String(c.pin).trim() !== "0000";
        const mejor = grupo.find(pinValido) || grupo.find((c) => c?.pin && String(c.pin).trim()) || grupo[0];
        limpios.push(mejor);
        perfilesEliminados += grupo.length - 1;
      }
      const clientesFinal = limpios.map((c, i) => ({ ...c, slot: i + 1 }));
      const capacidad = Number(a.data.capacidad || a.data.total || 0) || clientesFinal.length || 1;
      const ocupados = clientesFinal.length;
      const disponibles = Math.max(0, capacidad - ocupados);
      await a.ref.set(
        {
          clientes: clientesFinal,
          ocupados,
          disponibles,
          disp: disponibles,
          estado: disponibles === 0 ? "llena" : "activa",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      cuentasReparadas++;
    }

    return bot.sendMessage(
      chatId,
      `✅ Limpieza completada\n\n📄 Cuentas reparadas: ${cuentasReparadas}\n👤 Perfiles duplicados eliminados: ${perfilesEliminados}`
    );
  } catch (error) {
    logErr("fix_duplicados", error);
    return bot.sendMessage(chatId, "⚠️ Ocurrió un error limpiando duplicados. Revise los logs del servidor.");
  }
});

// ===============================
// ✅ NUEVO: /buscar_raw <texto>
// Diagnóstico sin ningún filtro inteligente: recorre TODA la colección
// "clientes" y muestra cualquier documento cuyo contenido (en JSON) incluya
// el texto buscado. Sirve para confirmar si un cliente existe o no en la
// base, sin depender de nombre_norm, teléfono, ni ninguna lógica de match.
// ===============================
bot.onText(/\/buscar_raw(?:\s+([\s\S]+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await safeIsAdminLocal(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo ADMIN puede usar este diagnóstico.");
  }

  const q = String((match && match[1]) || "").trim().toLowerCase();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar_raw texto a buscar");

  await bot.sendMessage(chatId, `🔎 Buscando "${q}" en TODA la colección clientes (sin filtros)...`);

  try {
    const snap = await db.collection("clientes").get();
    const hits = [];

    snap.forEach((doc) => {
      const raw = JSON.stringify(doc.data() || {}).toLowerCase();
      if (raw.includes(q)) hits.push(doc);
    });

    if (!hits.length) {
      return bot.sendMessage(
        chatId,
        `⚠️ No encontré "${q}" en NINGÚN documento de la colección clientes (${snap.size} documentos revisados). No es un problema de búsqueda: ese cliente no existe guardado en Firebase.`
      );
    }

    // ✅ Texto plano: los nombres/correos reales de clientes pueden traer
    // símbolos que rompen el parser de Markdown de Telegram.
    let txt = `✅ Encontré "${q}" en ${hits.length} documento(s):\n\n`;
    hits.slice(0, 8).forEach((doc, i) => {
      const c = doc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      txt += `${i + 1}) doc ${doc.id}\n`;
      txt += `   nombrePerfil: ${c.nombrePerfil || "-"}\n`;
      txt += `   telefono: ${c.telefono || "-"}\n`;
      txt += `   vendedor: ${c.vendedor || "-"}\n`;
      txt += `   servicios: ${servicios.length}`;
      if (servicios.length) {
        const perfiles = [...new Set(servicios.map((s) => String((s && s.perfil) || "").trim()).filter(Boolean))];
        if (perfiles.length) txt += ` (perfiles: ${perfiles.join(", ")})`;
      }
      txt += `\n\n`;
    });
    if (hits.length > 8) txt += `…y ${hits.length - 8} documento(s) más.`;

    return bot.sendMessage(chatId, txt);
  } catch (error) {
    logErr("buscar_raw", error);
    const detalle = String(error?.code || error?.message || error || "error desconocido");
    return bot.sendMessage(chatId, `⚠️ Error real de Firestore:\n\n\`${detalle}\``, { parse_mode: "Markdown" });
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
// BUZÓN DE AVISOS — WEB REVENDEDORES (revendedoreschat.vercel.app)
// ===============================
bot.onText(/^\/aviso\s+(.+)/is, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const texto = String(match[1] || "").trim();
  if (!texto) return bot.sendMessage(chatId, "⚠️ Escriba el texto del aviso.\n\nEj: `/aviso Netflix subió a Lps. 110`", { parse_mode: "Markdown" });

  try {
    const autor = msg.from?.first_name || "Admin";
    const ref = await db.collection("avisos").add({
      texto,
      autor,
      autorId: String(userId),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      activo: true,
    });
    return bot.sendMessage(chatId,
      `✅ *Aviso publicado*\n\n📌 ${escMD(texto)}\n\n_Visible ya en el panel de revendedores._\n🆔 \`${ref.id}\``,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    logErr("cmd:aviso", e);
    return bot.sendMessage(chatId, "❌ Error al publicar el aviso.");
  }
});

bot.onText(/^\/avisos\s*$/i, async (msg) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  try {
    const snap = await db.collection("avisos").orderBy("createdAt", "desc").limit(20).get();
    const activos = [];
    snap.forEach(d => {
      const a = d.data() || {};
      if (a.activo !== false) activos.push({ id: d.id, ...a });
    });
    const top = activos.slice(0, 10);

    if (!top.length) return bot.sendMessage(chatId, "📭 No hay avisos publicados.");

    let txt = "📌 *AVISOS ACTIVOS*\n\n";
    top.forEach(a => {
      const fecha = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString("es-HN") : "-";
      txt += `🆔 \`${a.id}\`\n${escMD(a.texto || "")}\n_${escMD(a.autor || "Admin")} · ${fecha}_\n\n`;
    });
    txt += "Para borrar uno: `/borraraviso <id>`";
    return bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
  } catch (e) {
    logErr("cmd:avisos", e);
    return bot.sendMessage(chatId, "❌ Error al listar avisos.");
  }
});

bot.onText(/^\/borraraviso\s+(\S+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const id = String(match[1] || "").trim();
  try {
    await db.collection("avisos").doc(id).set({ activo: false }, { merge: true });
    return bot.sendMessage(chatId, "✅ Aviso eliminado del panel de revendedores.");
  } catch (e) {
    logErr("cmd:borraraviso", e);
    return bot.sendMessage(chatId, "❌ No se pudo borrar. Verifique el ID con /avisos.");
  }
});


// ===============================
// CUSTOM EMOJI PREMIUM — PROMOCIONES
// FIX 20260909: una sola ruta antes del buscador, lista directa y reply.
// ===============================
const PROMO_EMOJI_CONFIG_COLLECTION_LOCAL = "config";
const PROMO_EMOJI_CONFIG_DOC_LOCAL = "telegram_promo_emojis";
const PROMO_EMOJI_ROLES_LOCAL = [
  { key:"titulo",     label:"Encabezado",       fallback:"🔥" },
  { key:"plataforma", label:"Plataforma",       fallback:"🎯" },
  { key:"datos",      label:"Datos de la oferta",fallback:"💎" },
  { key:"normal",     label:"Precio normal",    fallback:"🧾" },
  { key:"socio",      label:"Precio socio",     fallback:"💰" },
  { key:"cupos",      label:"Cupos",            fallback:"📦" },
  { key:"vigencia",   label:"Vigencia",         fallback:"⏳" },
  { key:"detalles",   label:"Detalles",         fallback:"✨" },
  { key:"solicitar",  label:"Cómo solicitar",   fallback:"📲" },
];
const promoEmojiSessionsLocal = new Map();
const PROMO_EMOJI_SESSION_MS_LOCAL = 30 * 60 * 1000;

function promoEmojiSessionKeyLocal(msg) {
  return `${msg.chat?.id}:${msg.from?.id}:${msg.message_thread_id || 0}`;
}

function promoEmojiSessionLocal(msg) {
  const now = Date.now();
  for (const [key, value] of promoEmojiSessionsLocal) {
    if (now - value.at >= PROMO_EMOJI_SESSION_MS_LOCAL) promoEmojiSessionsLocal.delete(key);
  }
  return promoEmojiSessionsLocal.get(promoEmojiSessionKeyLocal(msg));
}

function promoEmojiTextLocal(msg) {
  return typeof msg?.text === "string" ? msg.text : String(msg?.caption || "");
}

function promoEmojiCommandLocal(msg) {
  // Acepta el comando solo, antes de la lista o en su última línea.
  const match = promoEmojiTextLocal(msg).match(/(?:^|\n)[ \t]*\/(promoemojis?)(?:@\w+)?(?=\s|$)(?:[ \t]+([^\r\n]*))?/i);
  if (!match) return null;
  return { name:match[1].toLowerCase(), action:String(match[2] || "").trim().split(/\s+/)[0].toLowerCase() };
}

function promoEmojiListLocal(msg) {
  const text = promoEmojiTextLocal(msg).replace(/(?:^|\n)[ \t]*\/promoemojis?(?:@\w+)?[^\r\n]*/gi, "");
  // Una lista de iconos (con o sin numeración) no es un nombre de cliente.
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u.test(text) &&
    /^[\s\d.,:;()\-]*$/.test(text.replace(/[\p{Emoji}\uFE0F\u200D\u20E3]/gu, ""));
}

function extractCustomEmojiLocal(message) {
  if (!message) return [];
  const text = promoEmojiTextLocal(message);
  const rawEntities = typeof message.text === "string" ? message.entities : message.caption_entities;
  const entities = Array.isArray(rawEntities) ? rawEntities : [];
  return entities
    .filter((e) => e && e.type === "custom_emoji" && e.custom_emoji_id)
    .sort((a,b) => Number(a.offset||0) - Number(b.offset||0))
    .map((e) => ({
      id: String(e.custom_emoji_id || "").replace(/\D/g, ""),
      alt: text.substring(Number(e.offset)||0, (Number(e.offset)||0) + (Number(e.length)||0)),
    }))
    .filter((x) => x.id && x.alt);
}

function promoEmojiTagLocal(icon, fallback) {
  const id = String(icon?.id || "").replace(/\D/g, "");
  const alt = String(icon?.alt || fallback || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return id && alt ? `<tg-emoji emoji-id="${id}">${alt}</tg-emoji>` : fallback;
}

async function loadPromoEmojiConfigLocal() {
  const snap = await db.collection(PROMO_EMOJI_CONFIG_COLLECTION_LOCAL).doc(PROMO_EMOJI_CONFIG_DOC_LOCAL).get();
  const d = snap.exists ? (snap.data() || {}) : {};
  return d.activo !== false && d.icons && typeof d.icons === "object" ? d.icons : {};
}

function promoEmojiInstructionsLocal() {
  return [
    "💎 *ICONOS PREMIUM PARA PROMOCIONES*",
    "",
    "Envíe *11 custom emojis Premium* en un solo mensaje. Los guardaré automáticamente en este orden:",
    ...PROMO_EMOJI_ROLES_LOCAL.map((r,i)=>`${i+1}. ${r.fallback} ${r.label}`),
    "",
    "Si ya envió la lista, responda a ella con `/promoemojis guardar`.",
    "También puede escribir ese comando debajo de la lista, en el mismo mensaje.",
    "",
    "Comandos:",
    "• `/promoemojis ver` — ver configuración",
    "• `/promoemojis probar` — enviar muestra Premium",
    "• `/promoemojis limpiar` — volver a emojis normales",
    "• `/promoemojis cancelar` — salir sin guardar",
    "",
    "Para cambiar solo uno, escriba `/promoemoji titulo` y luego envíe el nuevo emoji, o responda al emoji con ese comando.",
    "Claves: `" + PROMO_EMOJI_ROLES_LOCAL.map(r=>r.key).join(", ") + "`",
  ].join("\n");
}

function promoEmojiSourceLocal(msg, session) {
  const inline = extractCustomEmojiLocal(msg);
  if (inline.length || promoEmojiListLocal(msg)) return inline;
  if (msg.reply_to_message) return extractCustomEmojiLocal(msg.reply_to_message);
  return session?.icons || [];
}

async function savePromoEmojisLocal(msg, found, role = null) {
  const expected = role ? 1 : PROMO_EMOJI_ROLES_LOCAL.length;
  if (found.length !== expected) {
    const help = found.length === 0
      ? "Telegram no recibió emojis Premium en ese mensaje. Selecciónelos desde el panel de emojis de Telegram; una captura o un sticker separado no sirve."
      : "Envíe exactamente esa cantidad en un solo mensaje, en el orden indicado.";
    await bot.sendMessage(msg.chat.id, `⚠️ Detecté ${found.length} emojis Premium; necesito ${expected}.\n\n${help}`);
    return;
  }
  const icons = {};
  (role ? [role] : PROMO_EMOJI_ROLES_LOCAL).forEach((item,i)=>{ icons[item.key] = found[i]; });
  await db.collection(PROMO_EMOJI_CONFIG_COLLECTION_LOCAL).doc(PROMO_EMOJI_CONFIG_DOC_LOCAL).set({
    icons, activo:true, updatedBy:String(msg.from.id), updatedAt:admin.firestore.FieldValue.serverTimestamp(),
  }, { merge:true });
  promoEmojiSessionsLocal.delete(promoEmojiSessionKeyLocal(msg));
  await bot.sendMessage(msg.chat.id, role
    ? `✅ Icono Premium actualizado: ${role.label}.\nUse /promoemojis probar.`
    : "✅ Los 11 iconos Premium quedaron guardados.\n\nUse /promoemojis probar para ver la muestra.");
}

async function runPromoEmojiCommandLocal(msg, command) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const action = command.action;
  const key = promoEmojiSessionKeyLocal(msg);
  const session = promoEmojiSessionLocal(msg);

  if (!action) {
    promoEmojiSessionsLocal.set(key, { mode:"all", at:Date.now() });
    return bot.sendMessage(chatId, promoEmojiInstructionsLocal(), { parse_mode:"Markdown" });
  }

  if (action === "guardar") {
    const found = promoEmojiSourceLocal(msg, session);
    promoEmojiSessionsLocal.set(key, { mode:"all", icons:found, at:Date.now() });
    return savePromoEmojisLocal(msg, found);
  }

  if (action === "ver") {
    const icons = await loadPromoEmojiConfigLocal();
    const lines = ["💎 <b>Iconos Premium configurados</b>",""];
    for (const role of PROMO_EMOJI_ROLES_LOCAL) {
      const x = icons[role.key];
      lines.push(`${promoEmojiTagLocal(x,role.fallback)} <b>${role.label}:</b> ${x?.id ? `<code>${String(x.id)}</code>` : "sin configurar"}`);
    }
    try { return await bot.sendMessage(chatId, lines.join("\n"), { parse_mode:"HTML" }); }
    catch (e) { return bot.sendMessage(chatId, `⚠️ La configuración existe, pero Telegram rechazó los custom emoji:\n${e?.message||e}`); }
  }

  if (action === "probar") {
    const icons = await loadPromoEmojiConfigLocal();
    if (!Object.keys(icons).length) return bot.sendMessage(chatId, "Todavía no hay iconos Premium activos. Escriba /promoemojis y envíe los emojis configurables.");
    const sample = [
      `${promoEmojiTagLocal(icons.titulo,"🔥")} <b>Oferta Premium de prueba</b>`,
      `${promoEmojiTagLocal(icons.plataforma,"🎯")} <b>Plataforma:</b> Sublicuentas`,
      "",
      `<b>${promoEmojiTagLocal(icons.datos,"💎")} Datos de la oferta</b>`,
      `• ${promoEmojiTagLocal(icons.normal,"🧾")} <b>Precio normal:</b> L 100`,
      `• ${promoEmojiTagLocal(icons.socio,"💰")} <b>Precio socio:</b> L 50`,
      `• ${promoEmojiTagLocal(icons.cupos,"📦")} <b>Cupos:</b> 5`,
      `• ${promoEmojiTagLocal(icons.vigencia,"⏳")} <b>Vigencia:</b> septiembre`,
      "",
      `<b>${promoEmojiTagLocal(icons.detalles,"✨")} Detalles</b>`,
      "• Esta es una prueba de visualización.",
      "",
      `<b>${promoEmojiTagLocal(icons.solicitar,"📲")} Cómo solicitar</b>`,
      "• Desde su Panel de Socios.",
    ].join("\n");
    try {
      await bot.sendMessage(chatId, sample, { parse_mode:"HTML" });
      return bot.sendMessage(chatId, "✅ Prueba enviada. Si arriba ve los iconos animados/custom, quedó listo.");
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Telegram rechazó los custom emoji.\n\n${e?.message||e}\n\nRevise que la cuenta dueña del bot en BotFather tenga Premium activo.`);
    }
  }

  if (action === "limpiar") {
    await db.collection(PROMO_EMOJI_CONFIG_COLLECTION_LOCAL).doc(PROMO_EMOJI_CONFIG_DOC_LOCAL).set({
      icons:{}, activo:false, updatedBy:String(userId), updatedAt:admin.firestore.FieldValue.serverTimestamp(),
    }, { merge:true });
    promoEmojiSessionsLocal.delete(key);
    return bot.sendMessage(chatId, "✅ Custom emojis desactivados. Las promociones volverán a usar emojis normales.");
  }

  if (action === "cancelar") {
    promoEmojiSessionsLocal.delete(key);
    return bot.sendMessage(chatId, "Configuración cancelada. Los iconos guardados se conservan.");
  }

  const role = PROMO_EMOJI_ROLES_LOCAL.find((r)=>r.key===action);
  if (role) {
    const found = extractCustomEmojiLocal(msg);
    promoEmojiSessionsLocal.set(key, { mode:"single", role:role.key, at:Date.now() });
    if (found.length || msg.reply_to_message) return savePromoEmojisLocal(msg, found.length ? found : extractCustomEmojiLocal(msg.reply_to_message), role);
    return bot.sendMessage(chatId, `Envíe un solo emoji Premium para ${role.label}. Lo guardaré al recibirlo.\nPara salir: /promoemojis cancelar.`);
  }

  return bot.sendMessage(chatId, `⚠️ Opción no reconocida. Use /promoemojis, /promoemojis ver o /promoemojis probar.\nPara cambiar uno: /promoemoji ${PROMO_EMOJI_ROLES_LOCAL[0].key}.\nClaves: ${PROMO_EMOJI_ROLES_LOCAL.map(r=>r.key).join(", ")}`);
}

async function handlePromoEmojiMessageLocal(msg) {
  const command = promoEmojiCommandLocal(msg);
  const session = promoEmojiSessionLocal(msg);
  const found = extractCustomEmojiLocal(msg);
  if (!command && /^\s*\//.test(promoEmojiTextLocal(msg))) {
    if (/^\s*\/(?:menu|start|cancelar)(?:@\w+)?(?:\s|$)/i.test(promoEmojiTextLocal(msg))) promoEmojiSessionsLocal.delete(promoEmojiSessionKeyLocal(msg));
    return false;
  }
  const list = promoEmojiListLocal(msg);
  if (!command && !list && !(session?.mode && (found.length || msg.sticker || msg.photo))) return false;
  if (!(await safeIsAdminLocal(msg.from?.id))) {
    await bot.sendMessage(msg.chat.id, "⛔ Solo admin puede configurar los iconos Premium.");
    return true;
  }
  try {
    const currentSession = promoEmojiSessionLocal(msg);
    if (command) await runPromoEmojiCommandLocal(msg, command);
    else if (currentSession?.mode) {
      promoEmojiSessionsLocal.set(promoEmojiSessionKeyLocal(msg), { ...currentSession, icons:found, at:Date.now() });
      const role = currentSession.mode === "single" ? PROMO_EMOJI_ROLES_LOCAL.find(r=>r.key===currentSession.role) : null;
      await savePromoEmojisLocal(msg, found, role);
    } else {
      // Retener solo los IDs de este usuario y chat; nunca guardar sin comando.
      promoEmojiSessionsLocal.set(promoEmojiSessionKeyLocal(msg), { icons:found, at:Date.now() });
      await bot.sendMessage(msg.chat.id, found.length
        ? `Recibí ${found.length} emojis Premium. Para aplicar los 11 iconos de promociones, envíe /promoemojis guardar.`
        : "Ese mensaje contiene emojis normales. Para configurar los Premium, escriba /promoemojis y envíelos desde el panel de emojis de Telegram.");
    }
  } catch (error) {
    logErr("promoemojis", error?.message || error);
    await bot.sendMessage(msg.chat.id, "⚠️ No pude completar la configuración de emojis. Vuelva a enviar el comando; si estaba guardando una lista, responda a ella con /promoemojis guardar.");
  }
  return true;
}

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
  let nombre = String(match[2] || "").trim();
  if (String(nombre).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() === "geissel") nombre = "Geisell";
  if (!telegramId || !nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/addvendedor ID Nombre");
  const docId = String(nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ") || String(Date.now());
  // ✅ PIN de un solo uso: sin esto, cualquiera que adivine el usuario (el
  // nombre en minúsculas) podía "reclamar" la cuenta con la clave que quisiera.
  const { pin, pinSetupHash } = await generarPinSetup();
  await db.collection("revendedores").doc(docId).set(
    {
      nombre, nombre_norm: docId, telegramId: String(telegramId), activo: true, autoLastSent: "",
      tarifaId: tarifaIdParaSocio({ nombre, nombre_norm: docId }),
      pinSetupHash, pinSetupCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return bot.sendMessage(
    chatId,
    `✅ Revendedor agregado\n\n👤 ${nombre}\n🆔 ${telegramId}\n📌 DocID: ${docId}\n\n🔐 PIN de configuración (un solo uso): *${pin}*\nPasáselo al socio junto con su usuario (\`${docId}\`) por un canal de confianza. Lo va a necesitar la primera vez que entre al panel, junto con la clave que él mismo elija. El PIN se borra solo después de usarse.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/resetpin\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await safeIsAdminLocal(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");
  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/resetpin Nombre");
  const nombreNorm = String(nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
  const snap = await db.collection("revendedores").get();
  let found = null;
  snap.forEach((d) => {
    const rev = d.data() || {};
    const revNombreNorm = String(rev.nombre_norm || rev.nombre || d.id).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
    if (revNombreNorm === nombreNorm) found = { ref: d.ref, nombre: rev.nombre || d.id };
  });
  if (!found) return bot.sendMessage(chatId, "⚠️ No encontré ese revendedor.");
  // Genera un PIN nuevo y BORRA la contraseña actual: obliga a reclamar la
  // cuenta de nuevo con el PIN. Útil si el socio olvidó su clave, o si
  // sospechás que alguien más la reclamó por error.
  const { pin, pinSetupHash } = await generarPinSetup();
  await found.ref.update({
    passwordHash: admin.firestore.FieldValue.delete(),
    pinSetupHash,
    pinSetupCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return bot.sendMessage(
    chatId,
    `🔐 PIN reiniciado para *${found.nombre}*\n\nNuevo PIN (un solo uso): *${pin}*\nSu clave anterior quedó invalidada — la próxima vez que entre al panel va a tener que poner este PIN y elegir una clave nueva.`,
    { parse_mode: "Markdown" }
  );
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
// 💬 RESPUESTAS DE TICKETS / AVISOS DESDE TELEGRAM
// El mensaje fue creado en Sublichat (api/tickets.js). El socio puede tocar
// "Responder" o usar la respuesta nativa de Telegram. Todo queda en el mismo
// documento tickets_auditoria y vuelve a verse en Sublichat.
// ===============================
const ticketReplyState = global.__SUBLICUENTAS_TICKET_REPLY_STATE__ = global.__SUBLICUENTAS_TICKET_REPLY_STATE__ || new Map();
function ticketReplyStateKey(chatId){return String(chatId||'');}
function ticketDestNorm(v){return normVendedor(String(v||'')).replace(/^geissel$/,'geisell');}
function ticketActorAliases(rev={}){
  const vals=[rev.id,rev.nombre_norm,rev.nombre,rev.usuario,rev.username].filter(Boolean);
  const nombre=String(rev.nombre||'').trim();if(nombre)vals.push(nombre.split(/\s+/)[0]);
  return [...new Set(vals.map(ticketDestNorm).filter(Boolean))];
}
function ticketCanTelegramAccess(ticket={},rev=null,adminOk=false){
  if(adminOk)return true;
  if(!rev)return false;
  const aliases=ticketActorAliases(rev),dest=(Array.isArray(ticket.destinos)?ticket.destinos:[]).map(ticketDestNorm);
  const creator=ticketDestNorm(ticket.creadoPorRol||'');
  return aliases.some(a=>dest.includes(a)||a===creator);
}
function ticketTelegramLinkKey(chatId,messageId){
  const safeChat=String(chatId||'').replace(/[^0-9-]/g,'').slice(0,40);
  return `${safeChat}_${Number(messageId)||0}`;
}
async function ticketResolveIdFromTelegramReply(msg){
  const mid=msg?.reply_to_message?.message_id;if(!mid)return '';
  try{const snap=await db.collection('ticket_telegram_messages').doc(ticketTelegramLinkKey(msg.chat?.id,mid)).get();return snap.exists?String((snap.data()||{}).ticketId||''):'';}catch(_){return '';}
}
function ticketStorageBucketsLocal(){
  const projectId=process.env.FIREBASE_PROJECT_ID||'';
  return [...new Set([process.env.TICKETS_FIREBASE_STORAGE_BUCKET,process.env.FIREBASE_STORAGE_BUCKET,process.env.STORAGE_BUCKET,projectId?`${projectId}.firebasestorage.app`:'',projectId?`${projectId}.appspot.com`:''].map(x=>String(x||'').trim()).filter(Boolean))];
}
async function ticketTelegramPhotoUrl(msg,ticketId){
  const photos=Array.isArray(msg?.photo)?msg.photo:[];if(!photos.length)return '';
  const best=photos[photos.length-1];if(!best?.file_id)return '';
  let stream;try{stream=bot.getFileStream(best.file_id);}catch(e){throw new Error('No pude descargar la foto de Telegram.');}
  const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const buffer=Buffer.concat(chunks);
  if(!buffer.length||buffer.length>8*1024*1024)throw new Error('La foto de Telegram pesa demasiado.');
  const path=`tickets/respuestas-telegram/${String(ticketId||'sin-ticket').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)}/${Date.now()}-${Math.random().toString(36).slice(2,9)}.jpg`;
  let last=null;
  for(const bucketName of ticketStorageBucketsLocal()){
    try{const file=admin.storage().bucket(bucketName).file(path);await file.save(buffer,{contentType:'image/jpeg',resumable:false,metadata:{cacheControl:'public,max-age=31536000'}});const [url]=await file.getSignedUrl({action:'read',expires:'2099-12-31'});return url;}catch(e){last=e;}
  }
  throw new Error('No pude guardar la evidencia en Storage. '+String(last?.message||''));
}
async function ticketAppendTelegramReply({ticketId,msg,rev,adminOk}){
  const ref=db.collection('tickets_auditoria').doc(String(ticketId||''));
  const snap=await ref.get();if(!snap.exists)throw new Error('Ese ticket ya no existe.');
  const old=snap.data()||{};if(!ticketCanTelegramAccess(old,rev,adminOk))throw new Error('Este ticket no corresponde a su usuario.');
  const texto=String(msg?.text||msg?.caption||'').trim().slice(0,3000);
  const imagenUrl=await ticketTelegramPhotoUrl(msg,ticketId);
  if(!texto&&!imagenUrl)throw new Error('Envíe texto o una foto como respuesta.');
  const actor=rev?.nombre||rev?.nombre_norm||(adminOk?'Admin Telegram':'Socio');
  const actorRol=rev?ticketDestNorm(rev.nombre_norm||rev.id||rev.nombre):'sublicuentas';
  const entry={texto:texto||(imagenUrl?'Evidencia adjunta':''),por:String(actor).slice(0,100),porRol:actorRol,imagenUrl,origen:'telegram',telegramUserId:String(msg?.from?.id||''),at:new Date().toISOString()};
  await db.runTransaction(async tx=>{const fresh=await tx.get(ref);if(!fresh.exists)throw new Error('Ese ticket ya no existe.');const data=fresh.data()||{},respuestas=Array.isArray(data.respuestas)?data.respuestas.slice():[];respuestas.push(entry);tx.set(ref,{respuestas,ultimaRespuesta:entry.texto,ultimaRespuestaPor:entry.por,estado:String(data.estado||'abierto')==='resuelto'?'resuelto':'respondido',updatedAt:new Date().toISOString()},{merge:true});});
  const label=String(old.tipo||'').toLowerCase()==='aviso'?`aviso "${old.titulo||'Sin título'}"`:`ticket #${old.numero||String(ticketId).slice(-4)}`;
  const aviso=`💬 *Respuesta desde Telegram*\n👤 ${escMD(entry.por)}\n🎫 ${escMD(label)}\n\n${escMD(entry.texto||'Evidencia adjunta')}`;
  const admins=await getActiveAdminIdsLocal();
  for(const id of admins){if(String(id)===String(msg?.chat?.id))continue;try{if(imagenUrl)await bot.sendPhoto(id,imagenUrl,{caption:aviso,parse_mode:'Markdown'});else await bot.sendMessage(id,aviso,{parse_mode:'Markdown'});}catch(e){logErr('ticket:notify-admin',e?.message||e);}}
  return {old,entry};
}
async function ticketStartTelegramReply(chatId,userId,ticketId,adminOk,vend){
  const ref=db.collection('tickets_auditoria').doc(String(ticketId||''));const snap=await ref.get();if(!snap.exists)return bot.sendMessage(chatId,'⚠️ Ese ticket ya no existe.');const t=snap.data()||{};
  if(!ticketCanTelegramAccess(t,vend,adminOk))return bot.sendMessage(chatId,'⛔ Ese ticket no corresponde a su usuario.');
  ticketReplyState.set(ticketReplyStateKey(chatId),{ticketId:String(ticketId),at:Date.now()});
  return bot.sendMessage(chatId,`💬 Respondiendo ${String(t.tipo||'').toLowerCase()==='aviso'?'al aviso':`al ticket #${t.numero||'—'}`}\n\nEscriba su respuesta. También puede enviar una foto con comentario como evidencia.\n\n/cancelar para salir.`);
}
async function ticketTryConsumeTelegramReply(msg,adminOk,vend){
  const chatId=msg.chat?.id,key=ticketReplyStateKey(chatId),pendingReply=ticketReplyState.get(key);
  const nativeTicketId=await ticketResolveIdFromTelegramReply(msg);
  const ticketId=String(nativeTicketId||(pendingReply&&pendingReply.ticketId)||'');if(!ticketId)return false;
  const raw=String(msg.text||'').trim().toLowerCase();if(['/cancelar','cancelar','cancel'].includes(raw)){ticketReplyState.delete(key);await bot.sendMessage(chatId,'✅ Respuesta cancelada.');return true;}
  if(raw.startsWith('/')&&!nativeTicketId)return false;
  try{const {old}=await ticketAppendTelegramReply({ticketId,msg,rev:vend,adminOk});ticketReplyState.delete(key);await bot.sendMessage(chatId,`✅ Su respuesta quedó agregada ${String(old.tipo||'').toLowerCase()==='aviso'?'al aviso':`al ticket #${old.numero||'—'}`}. Sublicuentas la verá en la misma conversación.`);return true;}catch(e){ticketReplyState.delete(key);await bot.sendMessage(chatId,'⚠️ '+String(e?.message||'No pude guardar la respuesta.'));return true;}
}

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
    if (await premiumIcons?.handleCallback?.(q)) return;
    if (!(await userHasAccessById(chatId, userId))) return;

    bindPanelFromCallback(q);

    const adminOk = await safeIsAdminLocal(userId);
    const vend = await safeGetRevendedorLocal(userId);
    const vendOk = !!(vend && vend.nombre);

    if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data.startsWith("tk:reply:")) {
      const ticketId=data.slice("tk:reply:".length).trim();
      return ticketStartTelegramReply(chatId,userId,ticketId,adminOk,vend);
    }
    if (data === "noop") return;

    if (data.startsWith("sync:clave:serv:")) {
      if (!adminOk) return bot.sendMessage(chatId, "⛔ Solo ADMIN puede sincronizar claves.");
      const parts = data.split(":");
      const clientId = parts[3];
      const idx = Number(parts[4]);
      try {
        const r = await sincronizarUnServicioDesdeInventarioLocal(clientId, idx);
        let txt = `✅ *Servicio sincronizado*

`;
        if (r.plataformaAnterior !== r.plataformaNueva) {
          txt += `📌 Plataforma: *${escMD(humanPlatLabelSyncLocal(r.plataformaAnterior))}* → *${escMD(humanPlatLabelSyncLocal(r.plataformaNueva))}*
`;
        } else {
          txt += `📌 Plataforma: *${escMD(humanPlatLabelSyncLocal(r.plataformaNueva))}*
`;
        }
        txt += `📧 Correo/usuario: ${escMD(r.correo)}
`;
        txt += `🔑 Clave: ${r.claveActualizada ? "actualizada" : "sin cambio"}
`;
        txt += `🔐 PIN: ${r.pinConservado ? "conservado" : "sin PIN"}`;
        return upsertPanel(chatId, txt, [
          [{ text: "⬅️ Volver servicio", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      } catch (e) {
        return upsertPanel(chatId, `⚠️ *No se pudo sincronizar este servicio*

${escMD(e.message || "Revise inventario.")}`, [
          [{ text: "⬅️ Volver servicio", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]);
      }
    }

    if (data === "sync:claves:ask") {
      if (!adminOk) return bot.sendMessage(chatId, "⛔ Solo ADMIN puede sincronizar claves.");
      return upsertPanel(
        chatId,
        `🔄 *SINCRONIZAR CLAVES VIGENTES*

Esto revisará todos los clientes vigentes y colocará la clave desde inventario. Si el correo existe en inventario con otra plataforma, también corrige la plataforma del servicio.

No toca Canva, Gemini, ChatGPT ni Duolingo porque son solo correo. Conserva el PIN existente.`,
        [
          [{ text: "✅ Ejecutar sincronización", callback_data: "sync:claves:run" }],
          [{ text: "❌ Cancelar", callback_data: "go:inicio" }],
        ]
      );
    }

    if (data === "sync:claves:run") {
      if (!adminOk) return bot.sendMessage(chatId, "⛔ Solo ADMIN puede sincronizar claves.");
      await upsertPanel(chatId, `🔄 *Sincronizando claves vigentes...*\n\nEspere un momento.`, [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]);
      return sincronizarClavesClientesVigentes(chatId);
    }

    if (data === "go:inicio") {
      resetChatStateFull(chatId);
      return sendBottomMainMenu(chatId, userId);
    }

    // 📲 Recordatorios de vencimiento al cliente final (piloto Relojes/Sublicuentas)
    if (data.startsWith("rec:start:") || data.startsWith("rec:next:")) {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      if (!VENDEDORES_PILOTO_RECORDATORIOS.has(normTxt(vend.nombre))) {
        return bot.sendMessage(chatId, "⚠️ Esta función todavía no está activa para su cuenta.");
      }

      const parts = data.split(":");
      const dmy = parts[2];
      const key = recordatoriosKey(chatId, dmy);
      let estado = recordatoriosState.get(key);

      // Si el estado se perdió (reinicio del bot, o lo retoma otro día),
      // se reconstruye de cero desde Firestore en vez de fallar en silencio.
      if (!estado) {
        const total = await prepararRecordatoriosPendientes(chatId, vend.nombre, dmy);
        if (!total) return bot.sendMessage(chatId, "✅ No quedan recordatorios pendientes para esa fecha.");
        estado = recordatoriosState.get(key);
      }

      if (data.startsWith("rec:next:")) {
        const flag = parts[3];
        if (flag === "e") estado.enviados++; else estado.omitidos++;
        estado.indice++;
      }

      if (estado.indice >= estado.items.length) {
        recordatoriosState.delete(key);
        return bot.sendMessage(chatId,
          `✅ *Listo — recordatorios de hoy*\n\n` +
          `📲 Enviados: *${estado.enviados}*\n` +
          `⏭️ Omitidos: *${estado.omitidos}*` +
          (estado.omitidos ? `\n\n_Los omitidos ya no se pueden retomar desde aquí — reaparecerán si siguen pendientes en el aviso de mañana._` : ""),
          { parse_mode: "Markdown" }
        );
      }

      const { txt, kb } = tarjetaRecordatorio(dmy, estado);
      try {
        return await bot.sendMessage(String(chatId), txt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: kb } });
      } catch (e) {
        logErr("recordatorios:tarjeta", e);
        return bot.sendMessage(chatId, "⚠️ No se pudo mostrar el recordatorio. Intente de nuevo.");
      }
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
      // Cambiar de módulo cancela cualquier flujo anterior. Antes un pending
      // abandonado podía seguir bloqueando búsquedas aunque el usuario ya
      // estuviera en otra pantalla y obligaba a escribir "menu".
      if (data.startsWith("menu:")) clearFlowStateKeepPanel(chatId);

      if (data === "menu:inventario") return menuInventario(chatId);
      if (data === "menu:dashboard")  return generarDashboard(chatId);
      if (data === "menu:inventario:video") return menuInventarioVideo(chatId);
      if (data === "menu:inventario:musica") return menuInventarioMusica(chatId);
      if (data === "menu:inventario:iptv") return menuInventarioIptv(chatId);
      if (data.startsWith("menu:inventario:tvdigital:")) return menuInventarioTvDigitalMarca(chatId, data.split(":")[3]);
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
        for (const cliId of selArr) {
          try {
            await renovarTodosServiciosTx(String(cliId), { dias });
            ok++;
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
        const identLabel = getIdentLabelLocal(plat);
        pending.set(String(chatId), { mode: "invNewCorreo", plat });
        return upsertPanel(chatId,
          `➕ *NUEVA CUENTA*\n📌 *Plataforma:* ${String(plat).toUpperCase()}\n\nEscriba el *${identLabel.toLowerCase()}* de la cuenta:`,
          [[{ text: "❌ Cancelar", callback_data: `inv:${plat}:0` }]]
        );
      }

      if (data.startsWith("invf:")) {
        const [, plat, filtro, pageStr] = data.split(":");
        return enviarInventarioPlataformaEstado(chatId, plat, filtro, Number(pageStr || 0));
      }

      if (data.startsWith("inv:") && !data.startsWith("inv:open:") && !data.startsWith("inv:menu:")) {
        pending.delete(String(chatId));
        const [, plat, pageStr] = data.split(":");
        return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
      }

      if (data.startsWith("inv:open:")) {
        pending.delete(String(chatId));
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
        pending.delete(String(chatId));
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

        // La salida desde Telegram también limpia la fila histórica del Excel
        // privado de Control Maestro. Si el Excel no puede tocarse, Bodega no
        // se revierte: se informa el motivo para que nunca parezca que falló la
        // eliminación principal.
        let excelSync = null;
        try { excelSync = await cmAutoRemoveClient({ plataforma, acceso, cliente }); }
        catch (e) { excelSync = { ok:false, code:"error", message:e?.message || "No se pudo sincronizar el Excel." }; console.error("cmAutoRemoveClient", e); }
        const excelLine = excelSync?.ok
          ? `\n📗 *Control Maestro:* eliminado también del Excel.`
          : `\n⚠️ *Control Maestro:* ${escMD(excelSync?.message || "No se pudo sincronizar el Excel.")}`;

        await bot.sendMessage(chatId, `✅ *Cliente quitado correctamente*\n\n👤 *Nombre:* ${escMD(cliente.nombre || "Sin nombre")}\n🔐 *PIN:* ${escMD(cliente.pin || "----")}\n\n👤 *Ocupados:* ${ocupados}/${capacidad}\n✅ *Disponibles:* ${disponibles}\n📊 *Estado:* ${escMD(disponibles === 0 ? "LLENA" : "CON ESPACIO")}${excelLine}`, { parse_mode: "Markdown" });
        return mostrarPanelCorreo(chatId, plataforma, acceso);
      }

      // ==========================================================
      // MOVER CUENTA ENTRE PLATAFORMAS — CALLBACK 100% STATELESS
      // ==========================================================
      // Antes este flujo dependía de pending/Map en memoria. Si el proceso
      // reiniciaba o Telegram entregaba el siguiente callback a otra instancia,
      // aparecía "El cambio venció" aunque el clic fuera inmediato.
      // Ahora cada botón lleva un token corto derivado del docId y la cuenta se
      // vuelve a resolver directamente desde Firestore en CADA clic.
      if (data === "mail_move_platform" || data.startsWith("mail_move_platform|")) {
        let token = String(data.split("|")[1] || "").trim();
        let found = null;

        if (token) {
          try { found = await buscarCuentaInventarioPorMoveToken(token); } catch (e) {
            return bot.sendMessage(chatId, `⚠️ No pude abrir esa cuenta: ${e.message || "token inválido"}`);
          }
        } else {
          // Compatibilidad con botones viejos que quedaron en mensajes anteriores.
          const ctx = getMailPanelContext(chatId);
          if (ctx?.docId) {
            token = getInventoryMoveToken(ctx.docId);
            try { found = await buscarCuentaInventarioPorMoveToken(token); } catch (_) {}
          }
        }

        if (!found) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Esa pantalla era de una versión anterior. Busque la cuenta otra vez y abra su ficha; el bot ya quedó libre para seguir buscando.");
        }

        const cuenta = found.data || {};
        const oldPlat = normalizarPlataforma(cuenta.plataforma || "");
        const acceso = String(cuenta.correo || cuenta.usuario || cuenta.ident || "").trim();
        if (!oldPlat || !acceso) return bot.sendMessage(chatId, "⚠️ La cuenta no tiene plataforma o correo/usuario válido.");

        // Importante: el cambio de plataforma ya NO deja pending activo.
        pending.delete(String(chatId));

        const keys = Object.keys(PLATAFORMAS || {}).filter((k) => !["iptv1", "iptv3", "iptv4"].includes(k));
        const buttons = keys
          .filter((k) => normalizarPlataforma(k) !== oldPlat)
          .map((k) => ({
            text: `${iconPlataforma(k)} ${humanPlataforma(k)}`,
            callback_data: `mail_move_now|${token}|${normalizarPlataforma(k)}`,
          }));
        const kb = [];
        for (let i = 0; i < buttons.length; i += 2) kb.push(buttons.slice(i, i + 2));
        kb.push([{ text: "❌ Cancelar", callback_data: `mail_move_cancel|${token}` }]);

        return upsertPanel(
          chatId,
          `🔄 *CAMBIAR PLATAFORMA DE LA CUENTA*\n\n${identIcon(oldPlat)} *${escMD(getIdentLabelLocal(oldPlat))}:* ${escMD(acceso)}\n📌 *Actual:* ${escMD(humanPlataforma(oldPlat))}\n\nSeleccione la plataforma correcta. *Al tocarla, el cambio se aplica de inmediato.*`,
          kb
        );
      }

      // Tocar una plataforma mueve la cuenta de inmediato. También capturamos
      // los botones mail_move_to de mensajes viejos para que NO queden muertos.
      if (data.startsWith("mail_move_now|") || data.startsWith("mail_move_to|")) {
        const parts = data.split("|");
        const token = String(parts[1] || "").trim();
        const nuevaPlat = normalizarPlataforma(parts[2] || "");
        try {
          return await moverCuentaPorTokenYDestinoLocal(chatId, token, nuevaPlat);
        } catch (e) {
          pending.delete(String(chatId));
          forceNextPanelAtBottom(chatId);
          return bot.sendMessage(
            chatId,
            `⚠️ No se movió la cuenta: ${escMD(e?.message || "error desconocido")}\n\nPuede buscar otra cuenta inmediatamente o usar /movercuenta.`,
            { parse_mode: "Markdown" }
          );
        }
      }

      if (data.startsWith("mail_move_to|")) {
        const parts = data.split("|");
        const token = String(parts[1] || "").trim();
        const nuevaPlat = normalizarPlataforma(parts[2] || "");

        // Compatibilidad con botones del flujo anterior: mail_move_to|primevideo
        if (!parts[2]) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Ese botón pertenece a la versión anterior. Abra nuevamente la cuenta y vuelva a tocar Cambiar plataforma.");
        }
        if (!esPlataformaValida(nuevaPlat)) return bot.sendMessage(chatId, "⚠️ Plataforma destino inválida.");

        let found;
        try { found = await buscarCuentaInventarioPorMoveToken(token); } catch (e) {
          return bot.sendMessage(chatId, `⚠️ No pude resolver la cuenta: ${e.message || "error"}`);
        }
        if (!found) return bot.sendMessage(chatId, "⚠️ La cuenta ya no existe. Puede buscar otra cuenta inmediatamente.");

        const src = found.data || {};
        const oldPlat = normalizarPlataforma(src.plataforma || "");
        const acceso = String(src.correo || src.usuario || src.ident || "").trim();
        if (oldPlat === nuevaPlat) return bot.sendMessage(chatId, "ℹ️ La cuenta ya está en esa plataforma.");

        pending.delete(String(chatId));
        return upsertPanel(
          chatId,
          `⚠️ *CONFIRMAR CAMBIO DE PLATAFORMA*\n\n${identIcon(oldPlat)} ${escMD(acceso)}\n\n${escMD(humanPlataforma(oldPlat))} ➜ *${escMD(humanPlataforma(nuevaPlat))}*\n\nEsto mueve la cuenta de Bodega conservando correo/usuario, clave y perfiles actuales. Después ejecute /sincronizar_todo para reconciliar los perfiles con el CRM.`,
          [
            [{ text: "✅ Sí, mover cuenta", callback_data: `mail_move_confirm|${token}|${nuevaPlat}` }],
            [{ text: "❌ Cancelar", callback_data: `mail_move_cancel|${token}` }],
          ]
        );
      }

      if (data === "mail_move_cancel" || data.startsWith("mail_move_cancel|")) {
        const token = String(data.split("|")[1] || "").trim();
        pending.delete(String(chatId));
        if (token) {
          try {
            const found = await buscarCuentaInventarioPorMoveToken(token);
            if (found) {
              const d = found.data || {};
              const plat = normalizarPlataforma(d.plataforma || "");
              const acceso = String(d.correo || d.usuario || d.ident || "").trim();
              if (plat && acceso) return mostrarPanelCorreo(chatId, plat, acceso);
            }
          } catch (_) {}
        }
        return bot.sendMessage(chatId, "Cambio cancelado. Puede buscar otra cuenta inmediatamente.");
      }

      if (data === "mail_move_confirm" || data.startsWith("mail_move_confirm|")) {
        const parts = data.split("|");
        const token = String(parts[1] || "").trim();
        const nuevaPlat = normalizarPlataforma(parts[2] || "");

        if (!token || !nuevaPlat) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Ese botón pertenece a la versión anterior. Abra nuevamente la cuenta; el bot no quedó bloqueado.");
        }

        let found;
        try { found = await buscarCuentaInventarioPorMoveToken(token); } catch (e) {
          return bot.sendMessage(chatId, `⚠️ No pude resolver la cuenta: ${e.message || "error"}`);
        }
        if (!found) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ La cuenta ya no existe. Puede hacer otra búsqueda sin regresar a Menú.");
        }

        try {
          const r = await moverCuentaInventarioPlataforma(found.id, nuevaPlat);
          pending.delete(String(chatId));
          forceNextPanelAtBottom(chatId);
          await bot.sendMessage(
            chatId,
            `✅ *Cuenta movida correctamente*\n\n${escMD(humanPlataforma(r.anterior))} ➜ *${escMD(humanPlataforma(r.nueva))}*\n${identIcon(r.nueva)} ${escMD(r.ident)}\n👥 Cupos actuales: ${r.ocupados}/${r.capacidad}\n\nAhora ejecute /sincronizar_todo para quitar asignaciones cruzadas y colocar los perfiles vigentes del CRM en la plataforma correcta.`,
            { parse_mode: "Markdown" }
          );
          return mostrarPanelCorreo(chatId, r.nueva, r.ident);
        } catch (e) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, `⚠️ No se movió la cuenta: ${e.message || "error desconocido"}\n\nEl bot quedó libre; puede buscar otra cuenta inmediatamente.`);
        }
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
        if (!requiereClaveLocal(plataforma)) return bot.sendMessage(chatId, "ℹ️ Esta plataforma usa solo correo; no requiere clave.");
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        const claveActual = found.data?.clave || "Sin clave";
        pending.set(String(chatId), { mode: "mailEditClaveCorreo", plataforma: normalizarPlataforma(plataforma), correo: normalizeIdentByPlatformLocal(plataforma, acceso) });
        return bot.sendMessage(chatId, `✏️ *Editar clave de la cuenta*\n\n${identIcon(plataforma)} *${escMD(getIdentLabelLocal(plataforma))}:* ${escMD(acceso)}\n🔑 *Clave actual:* ${escMD(claveActual)}\n\nEscriba la nueva clave:`, { parse_mode: "Markdown" });
      }

      if (data.startsWith("mail_edit_correo|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const identLabel = getIdentLabelLocal(plataforma);
        const editIcon = identIcon(plataforma);
        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");
        pending.set(String(chatId), {
          mode: "mailEditCorreoCuenta",
          plataforma: normalizarPlataforma(plataforma),
          correo: normalizeIdentByPlatformLocal(plataforma, acceso),
        });
        return bot.sendMessage(
          chatId,
          `${editIcon} *Editar ${identLabel.toLowerCase()} de la cuenta*\n\n${editIcon} *${escMD(identLabel)}:* ${escMD(acceso)}\n\nEscriba el nuevo ${identLabel.toLowerCase()}:`,
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

      if (data === "cli:excel:general") return enviarExcelClientesGeneralBot(chatId);
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

      if (data.startsWith("platgrp:")) {
        const parts = data.split(":");
        const mode = parts[1];
        const view = parts[2];
        if (!["wiz", "add", "set"].includes(mode)) return bot.sendMessage(chatId, "⚠️ Selector de plataforma inválido.");

        const brand = view === "brand" ? String(parts[3] || "").toLowerCase() : "";
        let clientId = view === "brand" ? (parts[4] || null) : (parts[3] || null);
        let compraSel = view === "brand" ? (parts[5] ?? null) : (parts[4] ?? null);

        // En "cambiar plataforma" no enviamos clientId/compraSel dentro de
        // callback_data. Con IDs automáticos de Firestore algunos botones
        // superaban los 64 bytes permitidos por Telegram (por ejemplo,
        // Crunchyroll llegaba a 66) y Telegram rechazaba el teclado completo.
        // El contexto queda ligado al chat mientras se navega por TV Digital.
        if (mode === "set" && (!clientId || compraSel === null)) {
          const ctx = pending.get(String(chatId));
          if (!ctx || ctx.mode !== "cliServSelectPlat") {
            return bot.sendMessage(chatId, "⚠️ El cambio de plataforma venció. Abra nuevamente la ficha del servicio.");
          }
          clientId = ctx.clientId;
          compraSel = ctx.compraSel;
        }

        const prefix = ({ wiz: "wiz:plat", add: "cli:add:plat", set: "cli:serv:set:plat" })[mode];
        const callbackClientId = mode === "set" ? null : clientId;
        const callbackCompraSel = mode === "set" ? null : compraSel;
        const brandLabels = {
          stella: "🔥 STELLA TV",
          oleada: "🌊 OLEADA TV",
          lion: "🦁 LION TV",
          latin: "📡 LATIN TV",
          evoutouch: "📺 EVOUTOUCH",
        };
        const brandDuraciones = {
          stella: "1, 3 y 7 meses (6 + 1 gratis)",
          oleada: "1, 3, 7 y 14 meses (6 + 1 / 12 + 2)",
          lion: "1, 3, 5 y 12 meses (10 + 2 gratis)",
          latin: "1, 4, 8 y 12 meses (3 + 1 gratis = 4)",
          evoutouch: "1 y 3 meses",
        };
        const addContextActions = (keyboard = []) => {
          const kb = Array.isArray(keyboard) ? keyboard.slice() : [];
          if (mode === "add" && clientId) kb.push([{ text: "❌ Cancelar", callback_data: `cli:view:${clientId}` }]);
          if (mode === "set" && clientId && compraSel !== null) kb.push([{ text: "❌ Cancelar", callback_data: `cli:serv:menu:${clientId}:${compraSel}` }]);
          return kb;
        };

        if (view === "all") {
          return upsertPanel(chatId, "📌 *SELECCIONE PLATAFORMA*", addContextActions(kbPlataformasWiz(prefix, callbackClientId, callbackCompraSel)));
        }
        if (view === "brand" && brandLabels[brand]) {
          return upsertPanel(
            chatId,
            `${brandLabels[brand]}\n\n🗓️ Planes: *${brandDuraciones[brand]}*\n\nSeleccione la cantidad de dispositivos:`,
            addContextActions(kbTvDigitalPlanesWiz(mode, brand, callbackClientId, callbackCompraSel))
          );
        }
        return upsertPanel(
          chatId,
          "📺 *TV DIGITAL*\n\nSeleccione el servicio:",
          addContextActions(kbTvDigitalMarcasWiz(mode, callbackClientId, callbackCompraSel))
        );
      }

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
        st.step = 4;
        if (requiereCorreoLocal(plat)) st.servStep = 2;
        else if (requiereClaveLocal(plat)) st.servStep = 3;
        else if (requierePinLocal(plat)) st.servStep = 4;
        else st.servStep = 5;
        wizard.set(String(chatId), st);
        if (st.servStep === 2) return bot.sendMessage(chatId, `(Servicio 2/6) ${getIdentLabelLocal(plat)} de la cuenta:`);
        if (st.servStep === 3) return bot.sendMessage(chatId, "(Servicio 3/6) Clave de la cuenta:");
        if (st.servStep === 4) return bot.sendMessage(chatId, "(Servicio 4/6) PIN del perfil:");
        return bot.sendMessage(chatId, "(Servicio 5/6) Precio (solo número, Lps):");
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
        await bot.sendMessage(chatId, "ℹ️ El vendedor ahora se asigna por cuenta. Elija el servicio que desea transferir.");
        return menuListaServicios(chatId, clientId);
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
        const compras = Array.isArray(c2?.servicios) ? c2.servicios : [];
        for (let i = compras.length - 1; i >= 0; i--) {
          try { await eliminarServicioTx(clientId, i, compras[i]?.compraId || ""); }
          catch (e) { return bot.sendMessage(chatId, `⚠️ No se borró el cliente porque no pude liberar todos sus perfiles: ${e.message || "revise Bodega"}`); }
        }
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
      if (data.startsWith("cli:serv:menu:")) {
        const estado = pending.get(String(chatId));
        if (String(estado?.mode || "").startsWith("cliServ")) pending.delete(String(chatId));
        return menuServicio(chatId, data.split(":")[3], data.split(":")[4]);
      }

      if (data.startsWith("cli:prof:list:")) {
        const parts = data.split(":");
        return menuListaPerfilesServicio(chatId, parts[3], parts[4]);
      }
      if (data.startsWith("cli:prof:menu:")) {
        const parts = data.split(":");
        return menuPerfilServicio(chatId, parts[3], parts[4], parts[5]);
      }
      if (data.startsWith("cli:prof:add:")) {
        const parts = data.split(":");
        const clientId = parts[3], compraSel = parts[4];
        const c = await getCliente(clientId);
        const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
        const compraId = String(servicios[idx]?.compraId || "");
        wizard.delete(String(chatId));
        pending.set(String(chatId), { mode: "cliProfAddName", clientId, idx, compraId });
        return upsertPanel(chatId,
          "👥 *AÑADIR PERFIL A LA MISMA COMPRA*\n\nEscriba el nombre de la persona o perfil. El precio y la fecha no se pedirán otra vez porque pertenecen a toda la compra:",
          [[{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${compraSel}` }]]
        );
      }
      if (data.startsWith("cli:prof:edit:")) {
        const parts = data.split(":");
        const field = parts[3], clientId = parts[4], compraSel = parts[5], perfilSel = parts[6];
        const labels = { name: "👤 Escriba el nuevo nombre del perfil:", mail: "📧 Escriba el nuevo correo/usuario:", key: "🔑 Escriba la nueva clave:", pin: "🔐 Escriba el nuevo PIN individual:" };
        if (!labels[field]) return bot.sendMessage(chatId, "⚠️ Opción inválida.");
        const c = await getCliente(clientId);
        const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
        const perfiles = perfilesServicioLocal(servicios[idx] || {}, c?.nombrePerfil || "");
        const perfilIndex = resolverIndicePerfilSelectorLocal(perfiles, perfilSel);
        if (perfilIndex < 0) return bot.sendMessage(chatId, "⚠️ Ese perfil cambió o ya no existe. Abra nuevamente la compra.");
        const compraId = String(servicios[idx]?.compraId || "");
        const perfilId = String(perfiles[perfilIndex]?.perfilId || "");
        const platPerfil = normalizarPlataforma(servicios[idx]?.plataforma || "");
        if (field === "mail" && !requiereCorreoLocal(platPerfil)) return bot.sendMessage(chatId, "ℹ️ Apple TV se entrega solo con PIN; no usa correo.");
        if (field === "key" && !requiereClaveLocal(platPerfil)) return bot.sendMessage(chatId, "ℹ️ Apple TV se entrega solo con PIN; no usa clave.");
        if (field === "pin" && !requierePinLocal(platPerfil)) return bot.sendMessage(chatId, "ℹ️ Esta plataforma no usa PIN.");
        pending.set(String(chatId), { mode: "cliProfEdit", field, clientId, idx, perfilIndex, compraId, perfilId });
        return upsertPanel(chatId, labels[field], [[{ text: "⬅️ Cancelar", callback_data: `cli:prof:menu:${clientId}:${compraSel}:${perfilSel}` }]]);
      }
      if (data.startsWith("cli:prof:del:ask:")) {
        const parts = data.split(":");
        const clientId = parts[4], compraSel = parts[5], perfilSel = parts[6];
        const c = await getCliente(clientId);
        const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
        const perfiles = perfilesServicioLocal(servicios[idx] || {}, c?.nombrePerfil || "");
        const perfilIndex = resolverIndicePerfilSelectorLocal(perfiles, perfilSel);
        if (perfilIndex < 0) return bot.sendMessage(chatId, "⚠️ Ese perfil cambió o ya no existe. Abra nuevamente la compra.");
        pending.set(String(chatId), {
          mode: "cliProfDelete", clientId, idx, perfilIndex, compraSel, perfilSel,
          compraId: String(servicios[idx]?.compraId || ""),
          perfilId: String(perfiles[perfilIndex]?.perfilId || "")
        });
        return upsertPanel(chatId,
          "🗑️ *QUITAR PERFIL*\n\nSe quitará solo esta persona y se liberará su cupo. La compra, el precio, la renovación y los demás perfiles se conservarán. ¿Confirma?",
          [[{ text: "✅ Sí, quitar perfil", callback_data: `cli:prof:del:ok:${clientId}:${compraSel}:${perfilSel}` }],[{ text: "❌ Cancelar", callback_data: `cli:prof:menu:${clientId}:${compraSel}:${perfilSel}` }]]
        );
      }
      if (data.startsWith("cli:prof:del:ok:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const ctx = pending.get(String(chatId));
        const idx = Number(ctx?.idx);
        const perfilIndex = Number(ctx?.perfilIndex);
        try {
          await eliminarPerfilTx(clientId, idx, perfilIndex, ctx?.compraId || "", ctx?.perfilId || "");
          pending.delete(String(chatId));
          await bot.sendMessage(chatId, "✅ Perfil retirado. La compra conserva un solo precio y una sola renovación.");
          return menuListaPerfilesServicio(chatId, clientId, ctx?.compraSel || idx);
        } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo quitar el perfil."}`); }
      }

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
        if (requiereCorreoLocal(plat)) {
          pending.set(String(chatId), { mode: "cliAddServMail", clientId, plat });
          return upsertPanel(chatId, `${identIcon(plat)} *${getIdentLabelLocal(plat)}* (${plat})\nEscriba el ${getIdentLabelLocal(plat).toLowerCase()}:`, [[{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }]]);
        }
        if (requiereClaveLocal(plat)) {
          pending.set(String(chatId), { mode: "cliAddServClave", clientId, plat, mail: "" });
          return upsertPanel(chatId, `🔑 *${humanPlataforma(plat)}*\nEscriba la clave:`, [[{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }]]);
        }
        if (requierePinLocal(plat)) {
          pending.set(String(chatId), { mode: "cliAddServPin", clientId, plat, mail: "", clave: "" });
          return upsertPanel(chatId, `🔐 *${humanPlataforma(plat)} · Solo PIN*\nEscriba el PIN:`, [[{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }]]);
        }
        pending.set(String(chatId), { mode: "cliAddServPrecio", clientId, plat, mail: "", clave: "", pin: "" });
        return upsertPanel(chatId, `💰 *${humanPlataforma(plat)}*\nEscriba el precio:`, [[{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }]]);
      }

      if (data.startsWith("cli:serv:edit:")) {
        const parts = data.split(":");
        const field = parts[3];
        const clientId = parts[4];
        const compraSel = parts[5];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");

        if (field === "plat") {
          const actual = servicios[idx] || {};
          pending.set(String(chatId), {
            mode: "cliServSelectPlat",
            clientId,
            compraSel,
            idx,
            compraId: String(actual.compraId || ""),
          });
          return upsertPanel(chatId, "📌 *Cambiar plataforma*\nSeleccione:", [
            ...kbPlataformasWiz("cli:serv:set:plat"),
            [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${compraSel}` }],
          ]);
        }

        const platActual = normalizarPlataforma(servicios[idx]?.plataforma || "");
        const compraId = String(servicios[idx]?.compraId || "");

        if (field === "mail" && !requiereCorreoLocal(platActual)) return bot.sendMessage(chatId, "ℹ️ Apple TV se entrega solo con PIN; no usa correo.");
        if (field === "clave" && !requiereClaveLocal(platActual)) return bot.sendMessage(chatId, "ℹ️ Apple TV se entrega solo con PIN; no usa clave.");
        if (field === "pin" && !requierePinLocal(platActual)) return bot.sendMessage(chatId, "ℹ️ Esta plataforma no usa PIN.");

        if (field === "mail") pending.set(String(chatId), { mode: "cliServEditMail", clientId, idx, plat: platActual, compraId });
        if (field === "clave") pending.set(String(chatId), { mode: "cliServEditClave", clientId, idx, plat: platActual, compraId });
        if (field === "pin") pending.set(String(chatId), { mode: "cliServEditPin", clientId, idx, plat: platActual, compraId });
        if (field === "precio") pending.set(String(chatId), { mode: "cliServEditPrecio", clientId, idx, compraId });
        if (field === "fecha") pending.set(String(chatId), { mode: "cliServEditFecha", clientId, idx, compraId });
        if (field === "vendedor") pending.set(String(chatId), { mode: "cliServEditVendedor", clientId, idx, compraId });

        const titulo =
          field === "mail" ? `${identIcon(platActual)} *Cambiar ${getIdentLabelLocal(platActual).toLowerCase()}*` :
          field === "clave" ? "🔑 *Cambiar clave*" :
          field === "pin" ? "🔐 *Cambiar PIN*" :
          field === "precio" ? "💰 *Cambiar precio*" :
          field === "vendedor" ? "🧾 *Cambiar vendedor responsable de esta cuenta*" :
          "📅 *Cambiar fecha*";

        const hint =
          field === "mail" ? `Escriba el nuevo ${getIdentLabelLocal(platActual).toLowerCase()}:` :
          field === "clave" ? "Escriba la nueva clave:" :
          field === "pin" ? "Escriba el nuevo PIN:" :
          field === "precio" ? "Escriba el precio (solo número):" :
          field === "vendedor" ? "Escriba el nombre del vendedor. Solo cambiará esta cuenta:" :
          "Escriba dd/mm/yyyy:";

        return upsertPanel(chatId, `${titulo}\n${hint}`, [[{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${compraSel}` }]]);
      }

      if (data.startsWith("cli:serv:set:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[4]);
        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

        // Compatibilidad doble:
        // - botones nuevos: solo llevan la plataforma y leen el contexto del chat;
        // - botones antiguos que aún estén visibles: conservan clientId/selector.
        const tieneContextoLegacy = Boolean(parts[5] && parts[6] !== undefined);
        const ctx = pending.get(String(chatId));
        const ctxValido = ctx && ctx.mode === "cliServSelectPlat";
        const clientId = tieneContextoLegacy ? parts[5] : (ctxValido ? ctx.clientId : "");
        const compraSel = tieneContextoLegacy ? parts[6] : (ctxValido ? ctx.compraSel : null);
        if (!clientId || compraSel === null || compraSel === undefined) {
          return bot.sendMessage(chatId, "⚠️ El cambio de plataforma venció. Abra nuevamente la ficha del servicio.");
        }

        try {
          const c = await getCliente(clientId);
          if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
          const servicios = Array.isArray(c.servicios) ? c.servicios : [];
          let idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
          if (idx < 0 && ctxValido && ctx.compraId) {
            idx = servicios.findIndex((s) => String(s?.compraId || "") === String(ctx.compraId));
          }
          if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");

          const actual = servicios[idx] || {};
          if (!requiereCorreoLocal(plat) && !requiereClaveLocal(plat) && requierePinLocal(plat)) {
            pending.set(String(chatId), {
              mode: "cliServSetPlatPin",
              clientId,
              idx,
              compraId: String(actual.compraId || ""),
              plat,
            });
            return upsertPanel(chatId, `🔐 *${humanPlataforma(plat)} · Solo PIN*\n\nEscriba el PIN para terminar el cambio de plataforma:`, [[{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${compraSel}` }]]);
          }
          const patch = { plataforma: plat };
          const identActual = getIdentServicioSyncLocal(actual);

          if (esSoloCorreoLocal(plat)) {
            patch.clave = "";
            patch.pin = "";
          } else if (identActual) {
            const inv = await buscarInventarioFlexiblePorServicioLocal(actual, plat);
            if (inv && normalizarPlataforma(inv.plataformaCoincidente || inv.plataforma || "") === plat) {
              const claveInv = extraerClaveInventarioLocal(inv.data || {});
              const pinInv = extraerPinInventarioLocal(inv.data || {});
              if (requiereClaveLocal(plat) && claveInv) patch.clave = claveInv;
              if (requierePinLocal(plat)) patch.pin = extraerPinServicioLocal(actual) || pinInv || "";
              if (!requierePinLocal(plat)) patch.pin = "";
            }
          }

          await patchServicio(clientId, idx, patch, actual.compraId || "");
          if (ctxValido) pending.delete(String(chatId));
          return menuServicio(chatId, clientId, compraSel);
        } catch (e) {
          const msg = String(e.message || "No se pudo cambiar la plataforma.");
          if (msg.includes("Clave inválida")) {
            return upsertPanel(chatId,
              `⚠️ *No se pudo cambiar la plataforma*

La plataforma seleccionada ocupa clave y este servicio no tiene clave todavía.

Revise que el correo exista en inventario con esa plataforma o coloque la clave manualmente.`,
              [
                [{ text: "🔑 Cambiar clave", callback_data: `cli:serv:edit:clave:${clientId}:${compraSel}` }],
                [{ text: "📧 Cambiar correo", callback_data: `cli:serv:edit:mail:${clientId}:${compraSel}` }],
                [{ text: "⬅️ Volver servicio", callback_data: `cli:serv:menu:${clientId}:${compraSel}` }],
              ]
            );
          }
          return bot.sendMessage(chatId, `⚠️ ${msg}`);
        }
      }

      if (data.startsWith("cli:serv:del:ask:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const compraSel = parts[5];
        const c = await getCliente(clientId);
        const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
        pending.set(String(chatId), { mode: "cliServDelete", clientId, idx, compraSel, compraId: String(servicios[idx]?.compraId || "") });
        return upsertPanel(chatId, "🗑️ *Eliminar compra completa*\n\nSe quitarán todos los perfiles incluidos, se liberarán sus cupos y se eliminará el precio/renovación de este servicio. ¿Confirma?", [
          [{ text: "✅ Confirmar", callback_data: `cli:serv:del:ok:${clientId}:${compraSel}` }],
          [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${compraSel}` }],
        ]);
      }

      if (data.startsWith("cli:serv:del:ok:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const ctx = pending.get(String(chatId));
        const idx = Number(ctx?.idx);
        try { await eliminarServicioTx(clientId, idx, ctx?.compraId || ""); pending.delete(String(chatId)); }
        catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo eliminar la compra."}`); }
        const actualizado = await getCliente(clientId);
        const restantes = Array.isArray(actualizado?.servicios) ? actualizado.servicios : [];
        if (restantes.length) return menuListaServicios(chatId, clientId);
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
        const compraSel = raw.slice(lastColon + 1);
        return menuRenovacionServicio(chatId, clientId, compraSel);
      }

      // ✅ ACCIÓN DESDE PANEL DEL DÍA
      if (data.startsWith("ren:accion:")) {
        const raw = data.slice("ren:accion:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const compraSel = raw.slice(lastColon + 1);
        return menuRenovacionServicio(chatId, clientId, compraSel);
      }

      // ✅ RENOVAR +30 DÍAS
      if (data.startsWith("cli:ren:auto:")) {
        const raw = data.slice("cli:ren:auto:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const compraSel = raw.slice(lastColon + 1);
        const actual = await getCliente(clientId);
        const servicios = Array.isArray(actual?.servicios) ? actual.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
        const compraId = String(servicios[idx]?.compraId || "");
        const renovado = await renovarServicioTx(clientId, idx, { dias: 30, compraId });
        await bot.sendMessage(chatId, `✅ Renovado +30 días\nNueva fecha: *${escMD(renovado.fechaNueva)}*`, { parse_mode: "Markdown" });
        return enviarFichaCliente(chatId, clientId);
      }

      // ✅ RENOVAR +31 DÍAS
      if (data.startsWith("cli:ren:auto31:")) {
        const raw = data.slice("cli:ren:auto31:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const compraSel = raw.slice(lastColon + 1);
        const actual = await getCliente(clientId);
        const servicios = Array.isArray(actual?.servicios) ? actual.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
        const compraId = String(servicios[idx]?.compraId || "");
        const renovado = await renovarServicioTx(clientId, idx, { dias: 31, compraId });
        await bot.sendMessage(chatId, `✅ Renovado +31 días\nNueva fecha: *${escMD(renovado.fechaNueva)}*`, { parse_mode: "Markdown" });
        return enviarFichaCliente(chatId, clientId);
      }

      // ✅ RENOVAR CON FECHA MANUAL
      if (data.startsWith("cli:ren:manual:")) {
        const raw = data.slice("cli:ren:manual:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const compraSel = raw.slice(lastColon + 1);
        const c = await getCliente(clientId);
        const servicios = Array.isArray(c?.servicios) ? c.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
        const compraId = String(servicios[idx]?.compraId || "");
        pending.set(String(chatId), { mode: "cliRenovarFechaManual", clientId, idx, compraId });
        return upsertPanel(chatId,
          "📅 *Renovar — fecha personalizada*\n\n" +
          "Escriba la fecha o los días a sumar:\n\n" +
          "• `dd/mm/yyyy` — fecha exacta\n" +
          "• `+40` — suma 40 días desde la fecha actual del servicio\n" +
          "• `+3m` — suma 3 meses\n" +
          "• `+90` — suma 90 días",
          [[{ text: "⬅️ Cancelar", callback_data: `cli:ren:one:${clientId}:${compraSel}` }]]
        );
      }

      // ✅ CAMBIÓ DE SERVICIO — elimina el actual y abre wizard para agregar uno nuevo
      if (data.startsWith("cli:ren:cambio:")) {
        const raw = data.slice("cli:ren:cambio:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const compraSel = raw.slice(lastColon + 1);
        try {
          const actual = await getCliente(clientId);
          const servicios = Array.isArray(actual?.servicios) ? actual.servicios : [];
          const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
          if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
          const compraId = String(servicios[idx]?.compraId || "");
          const result = await eliminarServicioTx(clientId, idx, compraId);
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
        const compraSel = raw.slice(lastColon + 1);
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        const idx = resolverIndiceCompraSelectorLocal(servicios, compraSel);
        if (idx < 0) return bot.sendMessage(chatId, "⚠️ Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
        const s = servicios[idx] || {};
        pending.set(String(chatId), {
          mode: "cliRenNoRenovo",
          clientId,
          idx,
          compraId: String(s.compraId || "")
        });
        return upsertPanel(chatId,
          `❌ *NO RENOVÓ — CONFIRMAR ELIMINACIÓN*\n\n` +
          `👤 *${escMD(c.nombrePerfil || "Cliente")}*\n` +
          `📦 *${escMD(humanPlatAlertLocal(s.plataforma || ""))}*\n` +
          `${requiereCorreoLocal(s.plataforma || "") ? `${identIcon(s.plataforma || "")} ${escMD(s.correo || "-")}` : `🔐 PIN: ${escMD(extraerPinServicioLocal(s) || "-")}`}\n\n` +
          `_El servicio se eliminará y el slot en inventario quedará libre._\n\n¿Confirmar?`,
          [
            [{ text: "✅ Sí, eliminar", callback_data: `cli:ren:noren:ok:${clientId}:${compraSel}` }],
            [{ text: "⬅️ Cancelar",    callback_data: `cli:ren:one:${clientId}:${compraSel}` }],
          ]
        );
      }

      // ✅ NO RENOVÓ — ejecutar eliminación
      if (data.startsWith("cli:ren:noren:ok:")) {
        const raw = data.slice("cli:ren:noren:ok:".length);
        const lastColon = raw.lastIndexOf(":");
        const clientId = raw.slice(0, lastColon);
        const compraSel = raw.slice(lastColon + 1);
        try {
          const ctx = pending.get(String(chatId));
          const idx = Number(ctx?.idx);
          const result = await eliminarServicioTx(clientId, idx, ctx?.compraId || "");
          pending.delete(String(chatId));
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

      // ✅ RENOVAR TODOS — FECHA PERSONALIZADA (aplica a todos los servicios del cliente)
      if (data.startsWith("cli:ren:allcustom:ask:")) {
        const clientId = data.slice("cli:ren:allcustom:ask:".length);
        pending.set(String(chatId), { mode: "cliRenovarFechaManualAll", clientId });
        return upsertPanel(chatId,
          "📅 *Renovar TODOS — fecha personalizada*\n\n" +
          "Escriba la fecha o los días a sumar:\n\n" +
          "• `dd/mm/yyyy` — fecha exacta para todos los servicios\n" +
          "• `+40` — suma 40 días desde hoy a todos\n" +
          "• `+3m` — suma 3 meses desde hoy a todos\n" +
          "• `+90` — suma 90 días desde hoy a todos",
          [[{ text: "⬅️ Cancelar", callback_data: `cli:ren:list:${clientId}` }]]
        );
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
        await renovarTodosServiciosTx(clientId, { dias: 30 });
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
        await renovarTodosServiciosTx(clientId, { dias: 31 });
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
        pending.set(String(chatId), {
          mode: "bajaMasiva", clientId, seleccionados: [],
          referencias: servicios.map((s, idx) => ({ idx, compraId: String(s?.compraId || "") }))
        });

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

        const referenciasBase = Array.isArray(ctx.referencias) ? ctx.referencias : [];
        const referencias = seleccionados.map((idx) => referenciasBase[idx] || { idx, compraId: "" });
        const baja = await eliminarServiciosTx(clientId, referencias);
        const eliminados = baja.eliminados || [];
        const servicios = baja.servicios || [];
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);

        let msg = `✅ *Baja masiva completada*\n\n`;
        msg += `*Eliminados (${eliminados.length}):*\n`;
        eliminados.forEach((s) => { msg += `• ${escMD(humanPlatAlertLocal(s.plataforma || ""))} — ${escMD(requiereCorreoLocal(s.plataforma || "") ? (s.correo || "-") : `PIN ${extraerPinServicioLocal(s) || "-"}`)}\n`; });
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
        callback_data: `vend:cli:${x.clientId || x.id || ""}`,
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
        callback_data: `vend:cli:${x.clientId || x.id || ""}`,
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
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      return enviarFichaClienteVendedor(chatId, clientId, "vend:buscar", vend.nombre);
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
        callback_data: `vend:cli:${x.clientId}`,
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
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const catalogo = await obtenerCatalogoSocio(db, vend);
      let txt = `💲 *LISTA DE PRECIOS — ${escMD(vend.nombre || "REVENDEDOR")}*\n`;
      for (const grupo of catalogo.grupos || []) {
        txt += `\n*${escMD(grupo.cat || "Catálogo")}*\n`;
        for (const it of grupo.items || []) {
          const nombre = it.s ? `${it.n} · ${it.s}` : it.n;
          const precio = it.p == null ? "Por comisión" : `Lps. ${Number(it.p)}`;
          txt += `• ${escMD(nombre)}: *${escMD(precio)}*\n`;
        }
      }
      txt += "\n_Catálogo sincronizado con el Panel de Socios._";
      return upsertPanel(chatId, txt, [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]]);
    }

    // Un botón viejo/desconocido no debe dejar un flujo pendiente pegado.
    pending.delete(String(chatId));
    return bot.sendMessage(chatId, "⚠️ Ese botón ya no está vigente. Puede hacer otra búsqueda inmediatamente.");
  } catch (err) {
    logErr("callback_query", err?.stack || err?.message || err);
    if (chatId) {
      try { pending.delete(String(chatId)); } catch (_) {}
      try { await bot.sendMessage(chatId, "⚠️ Ocurrió un error en esa acción. El bot quedó libre; puede buscar nuevamente sin escribir menu."); } catch (_) {}
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
    promoEmojiSessionsLocal.delete(promoEmojiSessionKeyLocal(msg));
    premiumIcons?.cancelSession?.(msg);
    return sendBottomMainMenu(chatId, userId, true);
  }

  try {
    // Los comandos y listas de emojis se consumen aquí una sola vez, antes
    // de los flujos de clientes y de la búsqueda libre (incluye captions).
    if (await premiumIcons?.handleMessage?.(msg)) {
      promoEmojiSessionsLocal.delete(promoEmojiSessionKeyLocal(msg));
      return;
    }
    if (await handlePromoEmojiMessageLocal(msg)) return;
    if (!(await userHasAccessFromMessage(msg))) return;

    // Modo app: mantener el panel anclado, no crear mensaje nuevo.

    const adminOk = await safeIsAdminLocal(userId);
    const vend = await safeGetRevendedorLocal(userId);
    const vendOk = !!(vend && vend.nombre);

    if ((adminOk || vendOk) && await ticketTryConsumeTelegramReply(msg,adminOk,vend)) return;

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

      if (adminOk && ["movercuenta", "mover_cuenta"].includes(first)) {
        const args = partsCmd.slice(1);
        if (args.length < 2) {
          return bot.sendMessage(
            chatId,
            "Uso rápido:\n/movercuenta correo@dominio.com primevideo\n\nSi el mismo acceso existe en varias plataformas:\n/movercuenta disneyp correo@dominio.com primevideo"
          );
        }

        let origen = "";
        let acceso = "";
        let destino = "";
        if (args.length === 2) {
          [acceso, destino] = args;
        } else {
          origen = args[0];
          destino = args[args.length - 1];
          acceso = args.slice(1, -1).join(" ");
        }

        try {
          return await moverCuentaPorAccesoLocal(chatId, acceso, destino, origen);
        } catch (e) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, `⚠️ ${e?.message || "No se pudo mover la cuenta."}`);
        }
      }

      if (adminOk && first === "clientes_excel") {
        try {
          await bot.sendMessage(chatId, "⏳ Generando Excel de clientes...");
          const { generarExcelClientesGeneral } = require("./index_11_clientes_excel");
          const buffer = await generarExcelClientesGeneral();
          
          if (!buffer || buffer.length === 0) {
            return bot.sendMessage(chatId, "❌ Error al generar el archivo");
          }
          
          await bot.sendDocument(chatId, buffer, 
            { caption: "👥 Listado General de Clientes\n✅ Incluye: Resumen, Listado (con filtros), Análisis" },
            { filename: `clientes_${Date.now()}.xlsx`,
              contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
          );
          return bot.sendMessage(chatId, "✅ Excel de clientes generado correctamente");
        } catch (e) {
          logErr("cmd_clientes_excel", e);
          return bot.sendMessage(chatId, "❌ Error: " + e.message);
        }
      }

      const comandosReservados = new Set([
        "start", "menu", "stock", "buscar", "cliente", "renovaciones", "txt",
        "clientes_txt", "vendedores_txt_split", "reindex_clientes", "fix_duplicados",
        "add", "del", "editclave", "adminadd", "admindel", "adminlist",
        "addvendedor", "delvendedor", "resetpin", "id", "miid", "vincular_vendedor",
        "sincronizar_todo", "sincronizar_claves", "addcorreo", "finanzas", "resumen_fecha", "bancos_mes",
        "top_plataformas_mes", "cierre_caja", "cierre_caja_rango", "excel_finanzas",
        "editar_movimiento", "clientes_excel", "movercuenta", "mover_cuenta",
        // ✅ Diagnóstico / reparación de colisiones (antes faltaban aquí y por eso
        // el buscador genérico también los interceptaba y mandaba "Sin resultados").
        "reparar_colisiones", "auditar_fusiones", "auditar_cliente", "buscar_raw",
        // ✅ Comandos IMAP — no pasar a resolverBusquedaAdmin
        "code", "link", "hogar", "prime", "inbox", "debug",
        // ✅ Buzón de avisos web revendedores
        "aviso", "avisos", "borraraviso",
        "promoemoji", "promoemojis",
        ...PLATFORM_KEYS,
      ]);

      if (adminOk && !comandosReservados.has(first)) {
        return resolverBusquedaAdmin(chatId, rawCmd);
      }

      return;
    }

    // ── Búsqueda directa sin / desde CUALQUIER panel ──
    // Un selector que funciona únicamente con botones NUNCA puede dejar pegado
    // el buscador. Solo bloqueamos cuando el flujo realmente espera texto.
    if (adminOk && !text.startsWith("/")) {
      cleanupStaleInteractiveStateLocal(chatId);

      const tSearch = String(text || "").trim();
      const keySearch = String(chatId);
      const pSearch = pending.get(keySearch);
      const pendingBloqueaBusqueda = pendingReallyExpectsTextLocal(pSearch);
      const wizardActivo = wizard.has(keySearch);
      const pareceBusqueda =
        isEmailLike(tSearch) ||
        onlyDigits(tSearch).length >= 7 ||
        normalizeLooseText(tSearch).length >= 2;

      if (pareceBusqueda && !wizardActivo && !pendingBloqueaBusqueda) {
        // Si quedó un selector por botones abierto/abandonado, se cancela y
        // la búsqueda nueva toma prioridad sin obligar a escribir "menu".
        if (pSearch) pending.delete(keySearch);
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
        // ⚠️ FIX: esta alta manual no revisaba si el nombre ya estaba en la
        // cuenta, así que agregar de nuevo a alguien que ya estaba creaba un
        // duplicado. Ahora, si ya existe, se le actualiza el PIN en vez de
        // crear otro registro.
        const idxExiste = clientes.findIndex((c) => normalizeLooseText(c?.nombre || "") === normalizeLooseText(p.nombre));
        if (idxExiste !== -1) {
          clientes[idxExiste] = { ...clientes[idxExiste], pin: t };
          await ref.set({ clientes, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          await bot.sendMessage(chatId, `⚠️ *${escMD(p.nombre)}* ya estaba en esta cuenta — actualicé su PIN a *${escMD(t)}* en vez de duplicarlo.`, { parse_mode: "Markdown" });
          return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
        }
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
        const identLabel = getIdentLabelLocal(p.plataforma);
        if (!validateIdentByPlatformLocal(p.plataforma, t)) {
          return bot.sendMessage(chatId, `⚠️ ${identLabel} inválido. Escriba un ${identLabel.toLowerCase()} válido.`);
        }
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const nuevoCorreo = normalizeIdentByPlatformLocal(p.plataforma, t);
        const nuevaRef = db.collection("inventario").doc(docIdInventarioLocal(nuevoCorreo, p.plataforma));
        const nuevaDoc = await nuevaRef.get();

        if (nuevaDoc.exists && nuevaRef.id !== found.ref.id) {
          return bot.sendMessage(chatId, `⚠️ Ya existe una cuenta con ese ${identLabel.toLowerCase()} en esta plataforma.`);
        }

        const dataCuenta = { ...(found.data || {}) };
        dataCuenta.correo = nuevoCorreo;
        dataCuenta.ident = nuevoCorreo;
        dataCuenta.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await nuevaRef.set(dataCuenta, { merge: true });
        if (nuevaRef.id !== found.ref.id) {
          await found.ref.delete();
        }

        await bot.sendMessage(chatId, `✅ ${identLabel} de la cuenta actualizado.`);
        return mostrarPanelCorreo(chatId, p.plataforma, nuevoCorreo);
      }

      // ✅ AGREGAR REVENDEDOR — paso 1: nombre
      // ✅ BÚSQUEDA DE CLIENTE PARA VENDEDOR
      if (p.mode === "vendBuscarCliente") {
        pending.delete(String(chatId));
        forceNextPanelAtBottom(chatId);
        if (!t || t.length < 2) return bot.sendMessage(chatId, "⚠️ Escriba al menos 2 caracteres.");
        const { buscarClienteRobusto } = require("./index_03_clientes_crm");
        const vendedorActual = await safeGetRevendedorLocal(userId);
        const resultadosTodos = await buscarClienteRobusto(t);
        const resultados = resultadosTodos.filter((cliente) =>
          vendedorActual?.nombre && clientePerteneceAVendedor(cliente, vendedorActual.nombre)
        );
        if (!resultados.length) {
          return upsertPanel(chatId,
            `🔍 Sin resultados para *${escMD(t)}*`,
            [[{ text: "🔍 Buscar de nuevo", callback_data: "vend:buscar" }, { text: "🏠 Inicio", callback_data: "go:inicio" }]]
          );
        }
        if (resultados.length === 1) {
          return enviarFichaClienteVendedor(chatId, resultados[0].id, "vend:buscar", vendedorActual.nombre);
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
        const identLabel = getIdentLabelLocal(p.plat);
        if (!validateIdentByPlatformLocal(p.plat, t)) {
          return bot.sendMessage(chatId, `⚠️ ${identLabel} inválido. Escriba un ${identLabel.toLowerCase()} válido.`);
        }
        const correoNorm = normalizeIdentByPlatformLocal(p.plat, t);
        const ref = db.collection("inventario").doc(docIdInventarioLocal(correoNorm, p.plat));
        const doc = await ref.get();
        if (doc.exists) return bot.sendMessage(chatId, `⚠️ Ya existe una cuenta con ese ${identLabel.toLowerCase()} para *${String(p.plat).toUpperCase()}*.`, { parse_mode: "Markdown" });
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
        const sync = await sincronizarCuentaEnComprasTx({ plataforma: plat, correo: acceso, nuevaClave: t, asignaciones: Array.isArray((doc.data() || {}).clientes) ? (doc.data() || {}).clientes : [] });
        if (sync.perfilesActualizados) await bot.sendMessage(chatId, `✅ Clave actualizada también en ${sync.perfilesActualizados} perfil(es) del CRM.`);
        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo: acceso });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (p.mode === "cliRenovarFechaManualAll") {
        // Acepta: dd/mm/yyyy | +40 | +3m | +90 — aplica a TODOS los servicios del cliente
        let fechaFinal = "";
        const tClean = t.trim();

        if (isFechaDMY(tClean)) {
          fechaFinal = tClean;
        } else if (/^\+\d+m$/i.test(tClean)) {
          const meses = parseInt(tClean.slice(1));
          const hoy = hoyDMY();
          const [dd, mm, yyyy] = hoy.split("/").map(Number);
          const dt = new Date(Date.UTC(yyyy, mm - 1 + meses, dd, 12));
          fechaFinal = `${String(dt.getUTCDate()).padStart(2,"0")}/${String(dt.getUTCMonth()+1).padStart(2,"0")}/${dt.getUTCFullYear()}`;
        } else if (/^\+\d+$/.test(tClean)) {
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
        await renovarTodosServiciosTx(p.clientId, { fechaExacta: fechaFinal });
        await bot.sendMessage(chatId, `✅ Todos los servicios renovados a la fecha: *${fechaFinal}*`, { parse_mode: "Markdown" });
        return enviarFichaCliente(chatId, p.clientId);
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
        await renovarServicioTx(p.clientId, p.idx, { fechaExacta: fechaFinal, compraId: p.compraId || "" });
        await bot.sendMessage(chatId, `✅ Fecha actualizada: *${fechaFinal}*`, { parse_mode: "Markdown" });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliEditNombre") {
        const actual = await getCliente(p.clientId);
        if (!actual) { pending.delete(String(chatId)); return bot.sendMessage(chatId, "⚠️ Cliente no encontrado."); }
        const dup = await clienteDuplicado(t, actual.telefono || "", actual.id);
        if (dup) return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const ref = db.collection("clientes").doc(String(actual.id));
        await ref.set({ nombrePerfil: t, nombre_norm: String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " "), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        { const { cacheInvalidatePrefix: cIPn } = require("./index_01_core"); cIPn(`clientes:doc:${actual.id}`); }
        return menuEditarCliente(chatId, actual.id);
      }

      if (p.mode === "cliEditTel") {
        const actual = await getCliente(p.clientId);
        if (!actual) { pending.delete(String(chatId)); return bot.sendMessage(chatId, "⚠️ Cliente no encontrado."); }
        const dup = await clienteDuplicado(actual.nombrePerfil || "", t, actual.id);
        if (dup) return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        const ref = db.collection("clientes").doc(String(actual.id));
        const telefonoCanonico = normalizarTelefonoCliente(t);
        await ref.set({ telefono: telefonoCanonico, telefono_norm: telefonoCanonico, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        { const { cacheInvalidatePrefix: cIPt } = require("./index_01_core"); cIPt(`clientes:doc:${actual.id}`); }
        return menuEditarCliente(chatId, actual.id);
      }

      if (p.mode === "cliEditVendedor") {
        pending.delete(String(chatId));
        await bot.sendMessage(chatId, "ℹ️ Esa edición global fue desactivada para no mover todas las cuentas. Seleccione el servicio que desea transferir.");
        return menuListaServicios(chatId, p.clientId);
      }

      if (p.mode === "cliProfAddName") {
        const c = await getCliente(p.clientId);
        const s = c && Array.isArray(c.servicios) ? c.servicios[p.idx] : null;
        if (!s) { pending.delete(String(chatId)); return bot.sendMessage(chatId, "⚠️ La compra ya no existe."); }
        const plat = normalizarPlataforma(s.plataforma || "");
        if (!requiereCorreoLocal(plat)) {
          if (requiereClaveLocal(plat)) {
            pending.set(String(chatId), { ...p, mode: "cliProfAddKey", plat, nombre: t, mail: "" });
            return bot.sendMessage(chatId, "🔑 Escriba la clave de esa cuenta:");
          }
          if (requierePinLocal(plat)) {
            pending.set(String(chatId), { ...p, mode: "cliProfAddPin", plat, nombre: t, mail: "", clave: "" });
            return bot.sendMessage(chatId, "🔐 Escriba el PIN individual de Apple TV:");
          }
          pending.delete(String(chatId));forceNextPanelAtBottom(chatId);
          try { await addPerfilTx(p.clientId, p.idx, { nombre: t, perfil: t, correo: "", clave: "", pin: "" }, p.compraId || ""); }
          catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo añadir el perfil."}`); }
          return menuListaPerfilesServicio(chatId, p.clientId, p.idx);
        }
        pending.set(String(chatId), { ...p, mode: "cliProfAddMail", plat, nombre: t });
        return bot.sendMessage(chatId, `${identIcon(plat)} Escriba el ${getIdentLabelLocal(plat).toLowerCase()} donde quedará el perfil de ${t}:`);
      }

      if (p.mode === "cliProfAddMail") {
        if (!validateIdentByPlatformLocal(p.plat, t)) return bot.sendMessage(chatId, `⚠️ ${getIdentLabelLocal(p.plat)} inválido. Intente otra vez:`);
        const mail = normalizeIdentByPlatformLocal(p.plat, t);
        if (requiereClaveLocal(p.plat)) {
          pending.set(String(chatId), { ...p, mode: "cliProfAddKey", mail });
          return bot.sendMessage(chatId, "🔑 Escriba la clave de esa cuenta:");
        }
        if (requierePinLocal(p.plat)) {
          pending.set(String(chatId), { ...p, mode: "cliProfAddPin", mail, clave: "" });
          return bot.sendMessage(chatId, "🔐 Escriba el PIN individual de este perfil:");
        }
        pending.delete(String(chatId));forceNextPanelAtBottom(chatId);
        try { await addPerfilTx(p.clientId, p.idx, { nombre: p.nombre, perfil: p.nombre, correo: mail, clave: "", pin: "" }, p.compraId || ""); }
        catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo añadir el perfil."}`); }
        await bot.sendMessage(chatId, "✅ Perfil añadido a la misma compra. No se creó otro precio ni otra renovación.");
        return menuListaPerfilesServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliProfAddKey") {
        if (requierePinLocal(p.plat)) {
          pending.set(String(chatId), { ...p, mode: "cliProfAddPin", clave: t });
          return bot.sendMessage(chatId, "🔐 Escriba el PIN individual de este perfil:");
        }
        pending.delete(String(chatId));forceNextPanelAtBottom(chatId);
        try { await addPerfilTx(p.clientId, p.idx, { nombre: p.nombre, perfil: p.nombre, correo: p.mail, clave: t, pin: "" }, p.compraId || ""); }
        catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo añadir el perfil."}`); }
        await bot.sendMessage(chatId, "✅ Perfil añadido a la misma compra. No se creó otro precio ni otra renovación.");
        return menuListaPerfilesServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliProfAddPin") {
        pending.delete(String(chatId));forceNextPanelAtBottom(chatId);
        try { await addPerfilTx(p.clientId, p.idx, { nombre: p.nombre, perfil: p.nombre, correo: p.mail, clave: p.clave || "", pin: t }, p.compraId || ""); }
        catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo añadir el perfil."}`); }
        await bot.sendMessage(chatId, "✅ Perfil añadido a la misma compra con su PIN individual. El precio y la fecha siguen únicos.");
        return menuListaPerfilesServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliProfEdit") {
        const c = await getCliente(p.clientId);
        const s = c && Array.isArray(c.servicios) ? c.servicios[p.idx] : null;
        if (!s) { pending.delete(String(chatId)); return bot.sendMessage(chatId, "⚠️ La compra ya no existe."); }
        const plat = normalizarPlataforma(s.plataforma || "");
        const patch = {};
        if (p.field === "name") { patch.nombre = t; patch.perfil = t; }
        else if (p.field === "mail") {
          if (!validateIdentByPlatformLocal(plat, t)) return bot.sendMessage(chatId, `⚠️ ${getIdentLabelLocal(plat)} inválido. Intente otra vez:`);
          patch.correo = normalizeIdentByPlatformLocal(plat, t);
        } else if (p.field === "key") patch.clave = t;
        else if (p.field === "pin") patch.pin = t;
        pending.delete(String(chatId));forceNextPanelAtBottom(chatId);
        try { await patchPerfilTx(p.clientId, p.idx, p.perfilIndex, patch, p.compraId || "", p.perfilId || ""); }
        catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo editar el perfil."}`); }
        await bot.sendMessage(chatId, "✅ Perfil actualizado dentro de la misma compra.");
        return menuPerfilServicio(chatId, p.clientId, p.idx, p.perfilIndex);
      }

      if (p.mode === "cliAddServMail") {
        const label = getIdentLabelLocal(p.plat);
        if (!validateIdentByPlatformLocal(p.plat, t)) return bot.sendMessage(chatId, `⚠️ ${label} inválido. Escriba el ${label.toLowerCase()}:`);
        const normalizedMail = normalizeIdentByPlatformLocal(p.plat, t);
        if (esSoloCorreoLocal(p.plat)) {
          pending.set(String(chatId), { mode: "cliAddServPrecio", clientId: p.clientId, plat: p.plat, mail: normalizedMail, clave: "", pin: "" });
          return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
        }
        if (requiereClaveLocal(p.plat)) {
          pending.set(String(chatId), { mode: "cliAddServClave", clientId: p.clientId, plat: p.plat, mail: normalizedMail });
          return bot.sendMessage(chatId, "🔑 Escriba la clave de la cuenta:");
        }
        pending.set(String(chatId), { mode: "cliAddServPin", clientId: p.clientId, plat: p.plat, mail: normalizedMail, clave: "" });
        return bot.sendMessage(chatId, "🔐 Escriba el PIN del perfil:");
      }

      if (p.mode === "cliAddServClave") {
        if (requierePinLocal(p.plat)) {
          pending.set(String(chatId), { mode: "cliAddServPin", clientId: p.clientId, plat: p.plat, mail: p.mail, clave: t });
          return bot.sendMessage(chatId, "🔐 Escriba el PIN del perfil:");
        }
        pending.set(String(chatId), { mode: "cliAddServPrecio", clientId: p.clientId, plat: p.plat, mail: p.mail, clave: t, pin: "" });
        return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
      }

      if (p.mode === "cliAddServPin") {
        pending.set(String(chatId), { mode: "cliAddServPrecio", clientId: p.clientId, plat: p.plat, mail: p.mail, clave: p.clave || "", pin: t });
        return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
      }

      if (p.mode === "cliAddServPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
        pending.set(String(chatId), { mode: "cliAddServFecha", clientId: p.clientId, plat: p.plat, mail: p.mail, clave: p.clave || "", pin: p.pin || "", precio: n });
        return bot.sendMessage(chatId, "📅 Fecha renovación (dd/mm/yyyy):");
      }

      if (p.mode === "cliAddServFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");
        pending.set(String(chatId), { ...p, mode: "cliAddServVendedor", fechaRenovacion: t });
        return bot.sendMessage(chatId, "🧾 Vendedor responsable de esta cuenta (por ejemplo, Sublicuentas o Relojes):");
      }

      if (p.mode === "cliAddServVendedor") {
        const vendedorData = await resolverVendedorRegistradoLocal(t);
        if (!vendedorData) return bot.sendMessage(chatId, "⚠️ No encontré ese vendedor en Sublichat, clientes ni socios. Revise el nombre:");
        const vendedor = canonicalVendedor(vendedorData.nombre || t);
        const vendedorNorm = vendedorData.nombre_norm || vendedorNormCanonicoLocal(vendedor);
        pending.delete(String(chatId));
        forceNextPanelAtBottom(chatId);
        try {
          await addServicioTx(String(p.clientId), {
            plataforma: p.plat,
            correo: p.mail,
            clave: p.clave || "",
            pin: p.pin || "",
            precio: p.precio,
            fechaRenovacion: p.fechaRenovacion,
            vendedor,
            vendedor_norm: vendedorNorm,
            vendedorTelefono: String(vendedorData.telefono || "").trim(),
          });
        } catch (e) {
          return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo agregar el servicio."}`);
        }
        return enviarFichaCliente(chatId, p.clientId);
      }

      if (p.mode === "cliServEditMail") {
        const platBase = normalizarPlataforma(p.plat || "");
        const label = getIdentLabelLocal(platBase);
        if (!validateIdentByPlatformLocal(platBase, t)) {
          return bot.sendMessage(chatId, `⚠️ ${label} inválido. Escriba un ${label.toLowerCase()} válido:`);
        }

        pending.delete(String(chatId));
        forceNextPanelAtBottom(chatId);

        try {
          const c = await getCliente(p.clientId);
          if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
          const servicios = Array.isArray(c.servicios) ? c.servicios : [];
          if (p.idx < 0 || p.idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

          const actual = servicios[p.idx] || {};
          const correoIngresado = normalizeIdentByPlatformLocal(platBase, t);
          const servicioBusqueda = { ...actual, plataforma: platBase, correo: correoIngresado };
          const inv = await buscarInventarioFlexiblePorServicioLocal(servicioBusqueda, platBase);

          let patch = { correo: correoIngresado };

          if (inv) {
            const dataInv = inv.data || {};
            const platInv = normalizarPlataforma(inv.plataformaCoincidente || inv.plataforma || dataInv.plataforma || platBase);
            const identInv = getIdentInventarioSyncLocal(dataInv) || correoIngresado;
            const claveInv = extraerClaveInventarioLocal(dataInv);
            const pinInv = extraerPinInventarioLocal(dataInv);

            patch.plataforma = platInv;
            patch.correo = normalizeIdentByPlatformLocal(platInv, identInv);

            if (requiereClaveLocal(platInv)) {
              patch.clave = claveInv || actual.clave || actual.password || actual.pass || "";
            } else {
              patch.clave = "";
            }

            if (requierePinLocal(platInv)) {
              patch.pin = extraerPinServicioLocal(actual) || pinInv || "";
            } else {
              patch.pin = "";
            }
          }

          await patchServicio(p.clientId, p.idx, patch, p.compraId || "");

          if (inv) {
            const platFinal = normalizarPlataforma(patch.plataforma || platBase);
            const msg = platFinal !== platBase
              ? `✅ ${label} actualizado. También corregí la plataforma a *${humanPlatLabelLocal(platFinal)}* y traje los datos del inventario.`
              : `✅ ${label} actualizado y datos sincronizados desde inventario.`;
            await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
          } else {
            await bot.sendMessage(chatId, `✅ ${label} actualizado. ⚠️ No lo encontré en inventario, revise clave/PIN si aplica.`);
          }

          return menuServicio(chatId, p.clientId, p.idx);
        } catch (e) {
          return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`);
        }
      }

      if (p.mode === "cliServEditClave") {
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try { await patchServicio(p.clientId, p.idx, { clave: t }, p.compraId || ""); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPin") {
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try { await patchServicio(p.clientId, p.idx, { pin: t }, p.compraId || ""); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServSetPlatPin") {
        pending.delete(String(chatId));
        forceNextPanelAtBottom(chatId);
        try {
          await patchServicio(p.clientId, p.idx, { plataforma: p.plat, correo: "", clave: "", pin: t }, p.compraId || "");
        } catch (e) {
          return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo cambiar la plataforma."}`);
        }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido.");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try { await patchServicio(p.clientId, p.idx, { precio: n }, p.compraId || ""); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");
        pending.delete(String(chatId));
      forceNextPanelAtBottom(chatId);
        try { await patchServicio(p.clientId, p.idx, { fechaRenovacion: t }, p.compraId || ""); } catch (e) { return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo actualizar el servicio."}`); }
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditVendedor") {
        const vendedorData = await resolverVendedorRegistradoLocal(t);
        if (!vendedorData) return bot.sendMessage(chatId, "⚠️ No encontré ese vendedor en Sublichat, clientes ni socios. Revise el nombre.");
        const vendedor = canonicalVendedor(vendedorData.nombre || t);
        const vendedorNorm = vendedorData.nombre_norm || vendedorNormCanonicoLocal(vendedor);
        pending.delete(String(chatId));
        forceNextPanelAtBottom(chatId);
        try {
          await patchServicio(p.clientId, p.idx, {
            vendedor,
            vendedor_norm: vendedorNorm,
            vendedorTelefono: String(vendedorData.telefono || "").trim(),
            vendedorAsignadoAt: new Date().toISOString(),
          }, p.compraId || "");
        } catch (e) {
          return bot.sendMessage(chatId, `⚠️ ${e.message || "No se pudo transferir la cuenta."}`);
        }
        await bot.sendMessage(chatId, `✅ Cuenta transferida a ${vendedor}. Las demás cuentas del cliente no cambiaron.`);
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
  const kb = list.slice(0, 20).map((x, i) => [{ text: `${i + 1}) ${(x.nombrePerfil || "Sin nombre").slice(0, 22)} • ${humanPlataforma(x.plataforma || "")}`, callback_data: `vend:cli:${x.clientId || x.id || ""}` }]);
  try { await bot.sendMessage(String(chatId), txt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: kb } }); return true; } catch(e) { return false; }
}

// ===============================
// 📲 NUEVO: recordatorios de vencimiento al CLIENTE FINAL (piloto)
// Hasta ahora los avisos de renovación solo llegan al vendedor por Telegram.
// Esto le arma, además, un mensaje personalizado y variado (nunca dos veces
// idéntico) por cada cliente que vence hoy, con un link de WhatsApp ya
// escrito — el vendedor solo tiene que abrirlo y darle enviar desde su
// propio número de siempre. No usa ninguna API de pago ni número nuevo.
//
// Por ahora, a propósito, solo se activa para los vendedores del piloto
// (Relojes y Sublicuentas). Para sumar más vendedores, solo hay que agregar
// su nombre (en minúsculas, sin tildes) a VENDEDORES_PILOTO_RECORDATORIOS.
// ===============================
const VENDEDORES_PILOTO_RECORDATORIOS = new Set(["relojes", "sublicuentas"]);

// Código de país para armar el link de WhatsApp (wa.me exige el número
// completo con código de país, sin "+" ni espacios). Ajustar aquí si el
// negocio empieza a operar en otro país.
const CODIGO_PAIS_TEL_WA = "504";

function telefonoWhatsApp(telefono = "") {
  const digits = onlyDigits(telefono);
  if (!digits) return "";
  if (digits.startsWith(CODIGO_PAIS_TEL_WA)) return digits;
  if (digits.length === 8) return CODIGO_PAIS_TEL_WA + digits; // número local hondureño típico
  return digits;
}

// Variedad "combinatoria": no hay un único texto fijo, se arma combinando
// piezas sueltas. Con estas listas ya salen cientos de combinaciones
// distintas, y crece solo con agregar más frases a los arreglos — no hay
// límite de cuántas se pueden sumar.
const REC_SALUDOS = [
  (n) => `Hola ${n} 👋`,
  (n) => `¡Qué tal, ${n}! 😊`,
  (n) => `Hola ${n}, ¿cómo estás? 🙌`,
  (n) => `¡Hey ${n}! 👋`,
  (n) => `Buen día ${n} ☀️`,
  (n) => `Hola ${n} 🙂`,
  (n) => `¡Hola ${n}! Espero estés bien 😊`,
  (n) => `${n}, ¿todo bien? 👋`,
];
const REC_CUERPOS_HOY = [
  (plat, emoji) => `Tu ${emoji} *${plat}* vence *hoy* ⏰`,
  (plat, emoji) => `Te escribo porque tu ${emoji} *${plat}* vence *hoy*`,
  (plat, emoji) => `Pasando a recordarte que hoy vence tu ${emoji} *${plat}*`,
  (plat, emoji) => `Tu suscripción de ${emoji} *${plat}* vence *hoy* 📌`,
  (plat, emoji) => `Hoy es el día de renovar tu ${emoji} *${plat}* 🔄`,
  (plat, emoji) => `Un recordatorio rápido: tu ${emoji} *${plat}* vence *hoy* ✅`,
];
const REC_CIERRES = [
  () => `Cualquier duda, aquí estoy 🙌`,
  () => `Cualquier cosa me avisas 🙂`,
  () => `Quedo pendiente de tu renovación 🔄`,
  () => `Avísame si la renuevo 👍`,
  () => `Estoy para ayudarte 🤝`,
  () => `Me dices y te la dejo lista 💫`,
  () => `Quedo atenta/o a tu mensaje 📩`,
  () => `Gracias por seguir confiando en mí 🙏`,
];

// Selección "variada pero estable": usa un hash de datos propios del
// servicio (cliente + índice + fecha) para elegir la frase. Así, si el bot
// reintenta el mismo día por lo que sea, el mensaje no cambia a mitad de
// camino, pero entre clientes o fechas distintas sí varía.
function elegirVariado(lista, semilla) {
  let hash = 0;
  const s = String(semilla || "");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return lista[hash % lista.length];
}

function primerNombre(nombreCompleto = "") {
  return String(nombreCompleto || "").trim().split(/\s+/)[0] || "cliente";
}

function construirMensajeRecordatorio(row) {
  const nombre = primerNombre(row.nombrePerfil);
  const plat = humanPlataforma(row.plataforma || "");
  const emoji = iconPlataforma(row.plataforma || "");
  const precio = Number(row.precio || 0).toFixed(2);
  const semilla = `${row.clientId}:${row.idx}:${row.fechaRenovacion}`;

  const saludo = elegirVariado(REC_SALUDOS, semilla + ":s")(nombre);
  const cuerpo = elegirVariado(REC_CUERPOS_HOY, semilla + ":c")(plat, emoji);
  const cierre = elegirVariado(REC_CIERRES, semilla + ":z")();

  return `${saludo}\n\n${cuerpo}\n\n💰 Monto: *L. ${precio}*\n\n${cierre}`;
}

// WhatsApp Business (Android): los enlaces https://wa.me no permiten elegir
// de forma fiable entre WhatsApp normal y WhatsApp Business. Para este bot
// usamos un puente HTTPS propio que abre explícitamente el paquete Android
// com.whatsapp.w4b. Así los recordatorios de Sublicuentas van al Business.
//
// En Render puede sobreescribirse con WA_BUSINESS_BRIDGE_BASE_URL si cambia
// el dominio público de la API. RENDER_EXTERNAL_URL se usa automáticamente
// cuando está disponible.
const WA_BUSINESS_BRIDGE_BASE_URL = String(
  process.env.WA_BUSINESS_BRIDGE_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.PUBLIC_BASE_URL ||
  "https://sublicuentas-panel-api.onrender.com"
).trim().replace(/\/+$/, "");

function linkWhatsAppRecordatorio(row) {
  const tel = telefonoWhatsApp(row.telefono || "");
  if (!tel) return "";
  const texto = construirMensajeRecordatorio(row);
  const qs = new URLSearchParams({ phone: tel, text: texto });
  return `${WA_BUSINESS_BRIDGE_BASE_URL}/wa-business?${qs.toString()}`;
}

// Estado en memoria del flujo "uno a la vez" por chat+fecha. Mismo patrón
// que wizard/pending (global.__SUBLICUENTAS_...__) para que sobreviva a
// recargas del módulo sin perderse. No necesita Firestore: es un flujo
// corto, de una sola sesión de trabajo del vendedor.
const recordatoriosState = global.__SUBLICUENTAS_RECORDATORIOS__ =
  global.__SUBLICUENTAS_RECORDATORIOS__ || new Map();

function recordatoriosKey(chatId, dmy) { return `${chatId}:${dmy}`; }

async function prepararRecordatoriosPendientes(chatId, vendedorNombre, dmy) {
  const list = await obtenerRenovacionesPorFecha(dmy, vendedorNombre);
  const pendientes = list.filter((x) => telefonoWhatsApp(x.telefono || ""));
  if (!pendientes.length) return 0;
  recordatoriosState.set(recordatoriosKey(chatId, dmy), {
    items: pendientes, indice: 0, enviados: 0, omitidos: 0,
  });
  return pendientes.length;
}

async function enviarAvisoRecordatoriosPendientes(chatId, vendedorNombre) {
  if (!VENDEDORES_PILOTO_RECORDATORIOS.has(normTxt(vendedorNombre))) return false;
  const { dmy } = getTimePartsNow();
  const total = await prepararRecordatoriosPendientes(chatId, vendedorNombre, dmy);
  if (!total) return false;
  try {
    await bot.sendMessage(String(chatId),
      `📲 Tienes *${total}* cliente(s) para recordarles su renovación de hoy por WhatsApp.`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[
        { text: `📲 Empezar a enviar recordatorios (${total} pendientes)`, callback_data: `rec:start:${dmy}` },
      ]] } }
    );
    return true;
  } catch (e) { logErr("recordatorios:aviso", e); return false; }
}

function tarjetaRecordatorio(dmy, estado) {
  const row = estado.items[estado.indice];
  const restantes = estado.items.length - estado.indice;
  const link = linkWhatsAppRecordatorio(row);
  const plat = humanPlataforma(row.plataforma || "");
  const emoji = iconPlataforma(row.plataforma || "");
  // ✅ El mensaje va dentro de un bloque de código (```): dentro de un
  // bloque, Telegram no interpreta *, _ como formato, así que el asterisco
  // de negrita del mensaje al cliente no choca con el Markdown del panel.
  const txt =
    `Recordatorio ${estado.indice + 1} de ${estado.items.length}\n\n` +
    `${emoji} *${escMD(row.nombrePerfil || "Sin nombre")}* — ${escMD(plat)}\n` +
    `📱 ${escMD(row.telefono || "-")} · vence *hoy*\n\n` +
    "💬 Mensaje que se va a mandar:\n```\n" + construirMensajeRecordatorio(row) + "\n```";
  const kb = [];
  if (link) kb.push([{ text: "🟢 Abrir WhatsApp Business y enviar", url: link }]);
  kb.push([
    { text: "✅ Ya lo envié → siguiente", callback_data: `rec:next:${dmy}:e` },
    { text: "⏭️ Omitir, siguiente", callback_data: `rec:next:${dmy}:o` },
  ]);
  return { txt, kb, restantes };
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
      await enviarAvisoRecordatoriosPendientes(rev.telegramId, rev.nombre);
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

// El servidor HTTP y /health los abre index_08_api.js en el mismo Express.
// Así el bot no intenta ocupar PORT dos veces y las rutas /api y /rev quedan activas.
