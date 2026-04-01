/* ✅ SUBLICUENTAS TG BOT — PARTE 5/6 SIN DUPLICADOS
   FINANZAS / REPORTES / EXCEL / MENÚS
   -----------------------------------
   Objetivo:
   - Evitar lecturas masivas que queman cuota
   - Leer movimientos viejos por fecha string
   - Leer movimientos nuevos por fechaTS
   - Usar UNA sola colección oficial
   - Evitar duplicados por colección espejo
*/

const fs = require("fs");

const {
  bot,
  admin,
  db,
  ExcelJS,
  PLATAFORMAS,
} = require("./index_01_core");

const {
  escMD,
  upsertPanel,
  parseFechaFinanceInput,
  getMonthLabelFromKey,
  getMonthKeyFromDMY,
  isFechaDMY,
  hoyDMY,
  moneyLps,
  logErr,
} = require("./index_02_utils_roles");

const { humanPlataforma } = require("./index_03_clientes_crm");

// ===============================
// CONFIG
// ===============================
const FIN_BANCOS_LOCAL = [
  "BAC",
  "Ficohsa",
  "Atlántida",
  "Banpaís",
  "Occidente",
  "Davivienda",
  "Lafise",
  "Efectivo",
  "Tigo Money",
  "Tengo",
  "PayPal",
  "Binance",
  "Otro",
];

const FIN_MOTIVOS_EGRESO_LOCAL = [
  "Renovaciones",
  "Cuentas nuevas",
  "Pago revendedor",
  "Pago planilla",
  "Publicidad",
  "Otros gastos",
];

const PLATFORM_KEYS = Array.isArray(PLATAFORMAS)
  ? PLATAFORMAS
  : Object.keys(PLATAFORMAS || {});

const FINANCE_COLLECTION_PRIMARY = "finanzas_movimientos";
const FINANCE_COLLECTIONS_READ = [FINANCE_COLLECTION_PRIMARY];

// ===============================
// HELPERS BASE
// ===============================
function normalizeFinanceDocRow(id, data = {}) {
  return { id: String(id || ""), ...(data || {}) };
}

function normalizeMonthKey(key = "") {
  const s = String(key || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1]}`;
  return "";
}

function altMonthKey(key = "") {
  const k = normalizeMonthKey(key);
  if (!k) return "";
  const m = k.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : "";
}

function platMeta(key = "") {
  if (Array.isArray(PLATAFORMAS)) return {};
  return PLATAFORMAS[String(key || "").trim()] || {};
}

function humanPlatSafe(key = "") {
  try {
    return humanPlataforma(key);
  } catch (_) {
    const meta = platMeta(key);
    return meta?.nombre || String(key || "");
  }
}

function pairButtons(buttons = []) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

function categoryOfPlat(key = "") {
  const k = String(key || "").trim().toLowerCase();
  const meta = platMeta(k);
  const c = String(meta.categoria || "").toLowerCase().trim();

  if (["video", "musica", "iptv", "diseno_ia", "designai", "disenoia"].includes(c)) {
    if (c === "designai" || c === "disenoia") return "diseno_ia";
    return c;
  }

  if ([
    "netflix", "vipnetflix", "disneyp", "disneys", "hbomax", "primevideo",
    "paramount", "crunchyroll", "vix", "appletv", "universal"
  ].includes(k)) return "video";
  if (["spotify", "youtube", "deezer"].includes(k)) return "musica";
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(k)) return "iptv";
  if (["canva", "gemini", "chatgpt"].includes(k)) return "diseno_ia";

  return "video";
}

function inventoryLabel(key = "") {
  const k = String(key || "").toLowerCase().trim();
  const labels = {
    netflix: "Netflix",
    vipnetflix: "Netflix VIP",
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
    oleadatv1: "Oleada 1",
    oleadatv3: "Oleada 3",
    iptv1: "IPTV 1",
    iptv3: "IPTV 3",
    iptv4: "IPTV 4",
    canva: "Canva",
    gemini: "Gemini",
    chatgpt: "ChatGPT",
  };
  return labels[k] || humanPlatSafe(k);
}

function kbFromItems(items = []) {
  const buttons = items.map((key) => ({
    text: inventoryLabel(key),
    callback_data: `inv:${String(key)}:0`,
  }));
  return pairButtons(buttons);
}

function dmyToDate(dmy = "") {
  const s = String(dmy || "").trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
  const [dd, mm, yyyy] = s.split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  return dt;
}

function dmyToMillis(dmy = "") {
  const dt = dmyToDate(dmy);
  return dt ? dt.getTime() : 0;
}

function dmyToTimestamp(dmy = "") {
  const dt = dmyToDate(dmy);
  return dt ? admin.firestore.Timestamp.fromDate(dt) : null;
}

function normalizeDMY(s = "") {
  const v = String(s || "").trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const dd = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  const yyyy = String(m[3]);
  return `${dd}/${mm}/${yyyy}`;
}

function tsToDMY(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  } catch (_) {
    return "";
  }
}

function monthKeyFromDMYLocal(dmy = "") {
  const v = typeof getMonthKeyFromDMY === "function" ? getMonthKeyFromDMY(dmy) : "";
  if (v) return normalizeMonthKey(v);
  const dt = dmyToDate(dmy);
  if (!dt) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKeyLocal(key = "") {
  const norm = normalizeMonthKey(key);
  if (typeof getMonthLabelFromKey === "function") {
    const v = getMonthLabelFromKey(norm);
    if (v) return v;
  }
  const m = norm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(key || "");
  const meses = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
  ];
  return `${meses[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

function parseFechaFlexible(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "hoy") return hoyDMY();
  if (typeof parseFechaFinanceInput === "function") {
    const p = parseFechaFinanceInput(s);
    if (p) return normalizeDMY(p);
  }
  return isFechaDMY(s) ? normalizeDMY(s) : null;
}

function extraerFechaMovimiento(r = {}) {
  const f1 = normalizeDMY(r.fecha || "");
  if (f1) return f1;
  const f2 = tsToDMY(r.fechaTS || r.fecha_ts || null);
  if (f2) return f2;
  const f3 = tsToDMY(r.createdAt || r.created_at || null);
  if (f3) return f3;
  const f4 = tsToDMY(r.updatedAt || r.updated_at || null);
  if (f4) return f4;
  return "";
}

function finTipoLabel(tipo) {
  return String(tipo || "").toLowerCase() === "egreso" ? "Egreso" : "Ingreso";
}

function finConceptoLabel(m = {}) {
  const tipo = String(m.tipo || "").toLowerCase();
  if (tipo === "egreso") return String(m.motivo || m.detalle || m.descripcion || "Egreso").trim();
  return String(m.plataforma || m.detalle || m.descripcion || m.cliente || "Ingreso").trim();
}

function normalizarBancoKey(raw = "") {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!s) return "sin_banco";
  if (["bac", "b.a.c", "b a c"].includes(s)) return "bac";
  if (["atlantida", "banco atlantida", "atlantida banco"].includes(s)) return "atlantida";
  if (["ficohsa", "banco ficohsa"].includes(s)) return "ficohsa";
  if (["banpais", "banco banpais"].includes(s)) return "banpais";
  if (["occidente", "banco occidente"].includes(s)) return "occidente";
  if (["davivienda", "banco davivienda"].includes(s)) return "davivienda";
  if (["lafise", "banco lafise"].includes(s)) return "lafise";
  if (["tigo money", "tigomoney", "tigo"].includes(s)) return "tigo_money";
  if (["paypal", "pay pal"].includes(s)) return "paypal";
  if (["binance"].includes(s)) return "binance";
  if (["efectivo", "cash"].includes(s)) return "efectivo";
  if (["transferencia", "transferencia bancaria"].includes(s)) return "transferencia";
  if (["tengo"].includes(s)) return "tengo";
  if (["otro", "otros"].includes(s)) return "otro";
  return s.replace(/\s+/g, "_");
}

function humanBanco(raw = "") {
  const key = normalizarBancoKey(raw);
  const map = {
    bac: "BAC",
    atlantida: "Atlántida",
    ficohsa: "Ficohsa",
    banpais: "Banpaís",
    occidente: "Occidente",
    davivienda: "Davivienda",
    lafise: "Lafise",
    tigo_money: "Tigo Money",
    paypal: "PayPal",
    binance: "Binance",
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    tengo: "Tengo",
    otro: "Otro",
    sin_banco: "Sin banco",
  };
  return map[key] || String(raw || "Sin banco").trim() || "Sin banco";
}

function finExtraLabel(m = {}) {
  const tipo = String(m.tipo || "").toLowerCase();
  if (tipo === "egreso") return String(m.detalle || m.descripcion || "").trim();
  return humanBanco(m.banco || m.metodo || "");
}

function textoMovimientoParaEliminar(m = {}) {
  const fecha = String(extraerFechaMovimiento(m) || m.fecha || "-").trim();
  const monto = Number(m.monto || 0).toFixed(2);
  const concepto = finConceptoLabel(m);
  const extra = finExtraLabel(m);

  let txt = `${fecha} • ${monto} Lps • ${concepto}`;
  if (extra) txt += ` • ${extra}`;
  if (txt.length > 60) txt = `${txt.slice(0, 57)}...`;
  return txt;
}

function textoConfirmarEliminacionMovimiento(m = {}) {
  const tipo = finTipoLabel(m.tipo);
  const fecha = String(extraerFechaMovimiento(m) || m.fecha || "-");
  const monto = typeof moneyLps === "function"
    ? moneyLps(m.monto || 0)
    : `${Number(m.monto || 0).toFixed(2)} Lps`;
  const concepto = finConceptoLabel(m);
  const extra = finExtraLabel(m);

  let txt = "🗑️ CONFIRMAR ELIMINACIÓN\n\n";
  txt += `Tipo: ${tipo}\n`;
  txt += `Fecha: ${fecha}\n`;
  txt += `Monto: ${monto}\n`;
  txt += `Concepto: ${concepto}\n`;
  if (extra) txt += `Extra: ${extra}\n`;
  txt += "\n¿Desea eliminar este movimiento?";
  return txt;
}

function startEndDayTimestamps(dmy = "") {
  const dt = dmyToDate(dmy);
  if (!dt) return null;
  const ini = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
  const fin = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999);
  return {
    iniTs: admin.firestore.Timestamp.fromDate(ini),
    finTs: admin.firestore.Timestamp.fromDate(fin),
  };
}

function startEndMonthTimestamps(monthKey = "") {
  const key = normalizeMonthKey(monthKey);
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const ini = new Date(yyyy, mm - 1, 1, 0, 0, 0, 0);
  const fin = new Date(yyyy, mm, 0, 23, 59, 59, 999);
  return {
    iniTs: admin.firestore.Timestamp.fromDate(ini),
    finTs: admin.firestore.Timestamp.fromDate(fin),
  };
}

function getMonthBoundsDMY(monthKey = "") {
  const key = normalizeMonthKey(monthKey);
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const lastDay = new Date(yyyy, mm, 0).getDate();

  return {
    ini: `01/${String(mm).padStart(2, "0")}/${yyyy}`,
    fin: `${String(lastDay).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yyyy}`,
  };
}

function monthsBetweenDMY(fechaInicio = "", fechaFin = "") {
  const ini = dmyToDate(fechaInicio);
  const fin = dmyToDate(fechaFin);
  if (!ini || !fin) return [];

  let a = new Date(ini.getFullYear(), ini.getMonth(), 1);
  let b = new Date(fin.getFullYear(), fin.getMonth(), 1);

  if (a.getTime() > b.getTime()) {
    const temp = a;
    a = b;
    b = temp;
  }

  const out = [];
  while (a.getTime() <= b.getTime()) {
    out.push(`${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}`);
    a = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  }

  return out;
}

function addRowsDedup(map, rows = []) {
  for (const row of rows) {
    if (!row?.id) continue;
    if (!map.has(row.id)) map.set(row.id, row);
  }
}

async function queryDocsByFieldEq(collectionName, field, value) {
  try {
    const snap = await db.collection(collectionName).where(field, "==", value).get();
    return snap.docs.map((d) => normalizeFinanceDocRow(d.id, d.data() || {}));
  } catch (e) {
    logErr(`queryDocsByFieldEq:${collectionName}.${field}`, e);
    return [];
  }
}

async function queryDocsByFieldRange(collectionName, field, ini, fin) {
  try {
    const snap = await db.collection(collectionName).where(field, ">=", ini).where(field, "<=", fin).get();
    return snap.docs.map((d) => normalizeFinanceDocRow(d.id, d.data() || {}));
  } catch (e) {
    logErr(`queryDocsByFieldRange:${collectionName}.${field}`, e);
    return [];
  }
}

async function getFinanceDocByIdAny(id) {
  const docId = String(id || "").trim();
  if (!docId) return null;

  try {
    const snap = await db.collection(FINANCE_COLLECTION_PRIMARY).doc(docId).get();
    if (snap.exists) {
      return {
        collection: FINANCE_COLLECTION_PRIMARY,
        ref: db.collection(FINANCE_COLLECTION_PRIMARY).doc(docId),
        row: normalizeFinanceDocRow(snap.id, snap.data() || {}),
      };
    }
  } catch (e) {
    logErr(`getFinanceDocByIdAny:${FINANCE_COLLECTION_PRIMARY}`, e);
  }

  return null;
}

async function saveFinancePayloadMirrored(docId, payload = {}) {
  const id = String(docId || "").trim();
  if (!id) throw new Error("ID de finanza inválido.");

  await db.collection(FINANCE_COLLECTION_PRIMARY).doc(id).set(payload, { merge: false });
  return { id, ...payload };
}

async function deleteFinanceDocMirrored(docId) {
  const id = String(docId || "").trim();
  if (!id) return;
  await db.collection(FINANCE_COLLECTION_PRIMARY).doc(id).delete();
}

// ===============================
// MENÚS PRINCIPALES
// ===============================
async function menuPrincipal(chatId) {
  return upsertPanel(chatId, "📌 *MENÚ PRINCIPAL*\n\nSeleccione una opción:", [
    [
      { text: "📦 Inventario", callback_data: "menu:inventario" },
      { text: "👥 Clientes / CRM", callback_data: "menu:clientes" },
    ],
    [{ text: "💰 Finanzas", callback_data: "menu:pagos" }],
  ]);
}

async function menuVendedor(chatId) {
  return upsertPanel(chatId, "👤 *MENÚ VENDEDOR*\n\nSeleccione una opción:", [
    [
      { text: "📅 Mis renovaciones", callback_data: "ren:mis" },
      { text: "📄 TXT renovaciones", callback_data: "txt:mis" },
    ],
    [
      { text: "👥 Mis clientes", callback_data: "vend:clientes" },
      { text: "📝 TXT mis clientes", callback_data: "vend:clientes:txt" },
    ],
  ]);
}

async function menuInventario(chatId) {
  return upsertPanel(chatId, "📦 *INVENTARIO*\n\nSeleccione una categoría:", [
    [
      { text: "🎬 Video", callback_data: "menu:inventario:video" },
      { text: "🎵 Música", callback_data: "menu:inventario:musica" },
    ],
    [
      { text: "📡 IPTV", callback_data: "menu:inventario:iptv" },
      { text: "🎨 Diseño e IA", callback_data: "menu:inventario:designai" },
    ],
    [
      { text: "📊 Stock general", callback_data: "inv:general" },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
    ],
  ]);
}

async function menuInventarioVideo(chatId) {
  const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "video");
  const kb = kbFromItems(items);
  kb.push([
    { text: "⬅️ Volver Inventario", callback_data: "menu:inventario" },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]);
  return upsertPanel(chatId, "🎬 *INVENTARIO VIDEO*\n\nSeleccione plataforma:", kb);
}

async function menuInventarioMusica(chatId) {
  const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "musica");
  const kb = kbFromItems(items);
  kb.push([
    { text: "⬅️ Volver Inventario", callback_data: "menu:inventario" },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]);
  return upsertPanel(chatId, "🎵 *INVENTARIO MÚSICA*\n\nSeleccione plataforma:", kb);
}

async function menuInventarioIptv(chatId) {
  const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "iptv");
  const kb = kbFromItems(items);
  kb.push([
    { text: "⬅️ Volver Inventario", callback_data: "menu:inventario" },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]);
  return upsertPanel(chatId, "📡 *INVENTARIO IPTV*\n\nSeleccione plataforma:", kb);
}

async function menuInventarioDisenoIA(chatId) {
  const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "diseno_ia");
  const kb = kbFromItems(items);
  kb.push([
    { text: "⬅️ Volver Inventario", callback_data: "menu:inventario" },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]);
  return upsertPanel(chatId, "🎨 *INVENTARIO DISEÑO E IA*\n\nSeleccione plataforma:", kb);
}

async function menuClientes(chatId) {
  return upsertPanel(chatId, "👥 *CLIENTES / CRM*\n\nSeleccione una opción:", [
    [
      { text: "➕ Nuevo cliente", callback_data: "cli:wiz:start" },
      { text: "🔎 Buscar cliente", callback_data: "menu:buscar" },
    ],
    [
      { text: "📅 Renovaciones", callback_data: "menu:renovaciones" },
      { text: "👤 Revendedores", callback_data: "rev:lista" },
    ],
    [
      { text: "📄 TXT clientes", callback_data: "cli:txt:general" },
      { text: "🗂️ TXT vendedores", callback_data: "cli:txt:vendedores_split" },
    ],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuRenovaciones(chatId) {
  return upsertPanel(chatId, "📅 *RENOVACIONES*\n\nSeleccione una opción:", [
    [
      { text: "📅 Ver hoy", callback_data: "ren:hoy" },
      { text: "📄 TXT de hoy", callback_data: "txt:hoy" },
    ],
    [
      { text: "📤 Enviar TXT a todos", callback_data: "txt:todos:hoy" },
      { text: "⬅️ Volver CRM", callback_data: "menu:clientes" },
    ],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuPagos(chatId) {
  return upsertPanel(chatId, "💰 *FINANZAS*\n\nSeleccione una opción:", [
    [
      { text: "➕ Registrar ingreso", callback_data: "fin:menu:ingreso" },
      { text: "➖ Registrar egreso", callback_data: "fin:menu:egreso" },
    ],
    [
      { text: "📒 Registro", callback_data: "fin:menu:registro" },
      { text: "🗑️ Eliminar movimiento", callback_data: "fin:menu:eliminar" },
    ],
    [
      { text: "📊 Reportes", callback_data: "fin:menu:reportes" },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
    ],
  ]);
}

async function menuFinRegistro(chatId) {
  return upsertPanel(chatId, "📒 *REGISTRO DE FINANZAS*\n\nSeleccione una opción:", [
    [
      { text: "➕ Registrar ingreso", callback_data: "fin:menu:ingreso" },
      { text: "➖ Registrar egreso", callback_data: "fin:menu:egreso" },
    ],
    [
      { text: "🗑️ Eliminar movimiento", callback_data: "fin:menu:eliminar" },
      { text: "🧾 Cierre de caja", callback_data: "fin:menu:cierre" },
    ],
    [
      { text: "📊 Reportes", callback_data: "fin:menu:reportes" },
      { text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" },
    ],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuFinEliminarTipo(chatId) {
  return upsertPanel(chatId, "🗑️ *ELIMINAR MOVIMIENTO POR FECHA*\n\nSeleccione qué desea buscar.\nLuego escribirá una *fecha exacta* en formato *dd/mm/yyyy*.", [
    [
      { text: "➕ Buscar ingresos", callback_data: "fin:menu:eliminar:ingreso" },
      { text: "➖ Buscar egresos", callback_data: "fin:menu:eliminar:egreso" },
    ],
    [
      { text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
    ],
  ]);
}

async function menuFinReportes(chatId) {
  return upsertPanel(chatId, "📊 *REPORTES DE FINANZAS*\n\nSeleccione una opción:", [
    [
      { text: "📅 Resumen por fecha", callback_data: "fin:menu:resumen_fecha" },
      { text: "🏦 Bancos del mes", callback_data: "fin:menu:bancos_mes" },
    ],
    [
      { text: "🏆 Top plataformas", callback_data: "fin:menu:top_plataformas" },
      { text: "📤 Excel por rango", callback_data: "fin:menu:excel_rango" },
    ],
    [
      { text: "🧾 Cierre por rango", callback_data: "fin:menu:cierre:rango" },
      { text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" },
    ],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

// keyboards
function kbBancosFinanzas() {
  const buttons = FIN_BANCOS_LOCAL.map((b) => ({
    text: String(b),
    callback_data: `fin:ing:banco:${encodeURIComponent(String(b))}`,
  }));
  const rows = pairButtons(buttons);
  rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return { inline_keyboard: rows };
}

function kbMotivosFinanzas() {
  const buttons = FIN_MOTIVOS_EGRESO_LOCAL.map((m) => ({
    text: String(m),
    callback_data: `fin:egr:motivo:${encodeURIComponent(String(m))}`,
  }));
  const rows = pairButtons(buttons);
  rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return { inline_keyboard: rows };
}

// CRUD
async function registrarIngresoTx({ monto, banco = "", plataforma = "", detalle = "", fecha = "", userId = "", userName = "" }) {
  const fechaOk = parseFechaFlexible(fecha || hoyDMY());
  if (!fechaOk) throw new Error("Fecha inválida");

  const montoOk = Number(monto || 0);
  if (!Number.isFinite(montoOk) || montoOk <= 0) throw new Error("Monto inválido");

  const mesKey = monthKeyFromDMYLocal(fechaOk);
  const docId = db.collection(FINANCE_COLLECTION_PRIMARY).doc().id;

  const payload = {
    tipo: "ingreso",
    monto: montoOk,
    banco: humanBanco(String(banco || "").trim()),
    plataforma: String(plataforma || "").trim(),
    detalle: String(detalle || "").trim(),
    fecha: fechaOk,
    fechaTS: dmyToTimestamp(fechaOk),
    mesKey,
    monthKey: mesKey,
    userId: String(userId || ""),
    userName: String(userName || ""),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await saveFinancePayloadMirrored(docId, payload);
  return { id: docId, ...payload };
}

async function registrarEgresoTx({ monto, motivo = "", detalle = "", fecha = "", userId = "", userName = "" }) {
  const fechaOk = parseFechaFlexible(fecha || hoyDMY());
  if (!fechaOk) throw new Error("Fecha inválida");

  const montoOk = Number(monto || 0);
  if (!Number.isFinite(montoOk) || montoOk <= 0) throw new Error("Monto inválido");

  const mesKey = monthKeyFromDMYLocal(fechaOk);
  const docId = db.collection(FINANCE_COLLECTION_PRIMARY).doc().id;

  const payload = {
    tipo: "egreso",
    monto: montoOk,
    motivo: String(motivo || "").trim(),
    detalle: String(detalle || "").trim(),
    fecha: fechaOk,
    fechaTS: dmyToTimestamp(fechaOk),
    mesKey,
    monthKey: mesKey,
    userId: String(userId || ""),
    userName: String(userName || ""),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await saveFinancePayloadMirrored(docId, payload);
  return { id: docId, ...payload };
}

async function getMovimientoFinanzaById(id) {
  const found = await getFinanceDocByIdAny(id);
  return found ? found.row : null;
}

async function getMovimientosPorFecha(fechaDMY, _userId = null, _isSuper = false) {
  const fecha = normalizeDMY(fechaDMY);
  if (!fecha) return [];

  const map = new Map();
  const range = startEndDayTimestamps(fecha);

  const [dd, mm, yyyy] = fecha.split("/");
  const fechaAlt = `${Number(dd)}/${Number(mm)}/${yyyy}`;

  for (const col of FINANCE_COLLECTIONS_READ) {
    addRowsDedup(map, await queryDocsByFieldEq(col, "fecha", fecha));

    if (fechaAlt !== fecha) {
      addRowsDedup(map, await queryDocsByFieldEq(col, "fecha", fechaAlt));
    }

    if (range) {
      addRowsDedup(map, await queryDocsByFieldRange(col, "fechaTS", range.iniTs, range.finTs));
    }
  }

  return Array.from(map.values())
    .map((r) => ({ ...r, fecha: extraerFechaMovimiento(r) || r.fecha || "" }))
    .filter((r) => normalizeDMY(String(r.fecha || "")) === fecha)
    .sort((a, b) => dmyToMillis(b.fecha || "") - dmyToMillis(a.fecha || ""));
}

async function getMovimientosPorMes(monthKey, _userId = null, _isSuper = false) {
  const key = normalizeMonthKey(monthKey);
  if (!key) return [];

  const map = new Map();
  const range = startEndMonthTimestamps(key);
  const alt = altMonthKey(key);
  const bounds = getMonthBoundsDMY(key);

  for (const col of FINANCE_COLLECTIONS_READ) {
    addRowsDedup(map, await queryDocsByFieldEq(col, "mesKey", key));
    addRowsDedup(map, await queryDocsByFieldEq(col, "monthKey", key));

    if (alt) {
      addRowsDedup(map, await queryDocsByFieldEq(col, "mesKey", alt));
      addRowsDedup(map, await queryDocsByFieldEq(col, "monthKey", alt));
    }

    if (range) {
      addRowsDedup(map, await queryDocsByFieldRange(col, "fechaTS", range.iniTs, range.finTs));
    }

    if (bounds) {
      addRowsDedup(map, await queryDocsByFieldRange(col, "fecha", bounds.ini, bounds.fin));
    }
  }

  return Array.from(map.values())
    .map((r) => {
      const fechaReal = extraerFechaMovimiento(r) || r.fecha || "";
      const mesReal = monthKeyFromDMYLocal(fechaReal);
      return {
        ...r,
        fecha: fechaReal,
        mesKey: normalizeMonthKey(r.mesKey || mesReal || ""),
        monthKey: normalizeMonthKey(r.monthKey || mesReal || ""),
      };
    })
    .filter((r) => {
      const mes = normalizeMonthKey(r.mesKey || r.monthKey || monthKeyFromDMYLocal(r.fecha || ""));
      return mes === key;
    })
    .sort((a, b) => dmyToMillis(b.fecha || "") - dmyToMillis(a.fecha || ""));
}

async function getMovimientosPorRango(fechaInicio, fechaFin, _userId = null, _isSuper = false) {
  const ini = normalizeDMY(fechaInicio);
  const fin = normalizeDMY(fechaFin);
  if (!ini || !fin) return [];

  let iniMs = dmyToMillis(ini);
  let finMs = dmyToMillis(fin);

  if (iniMs > finMs) {
    const temp = iniMs;
    iniMs = finMs;
    finMs = temp;
  }

  const iniDate = new Date(iniMs);
  const finDate = new Date(finMs);

  const iniTs = admin.firestore.Timestamp.fromDate(
    new Date(iniDate.getFullYear(), iniDate.getMonth(), iniDate.getDate(), 0, 0, 0, 0)
  );
  const finTs = admin.firestore.Timestamp.fromDate(
    new Date(finDate.getFullYear(), finDate.getMonth(), finDate.getDate(), 23, 59, 59, 999)
  );

  const monthKeys = monthsBetweenDMY(ini, fin);
  const map = new Map();

  for (const col of FINANCE_COLLECTIONS_READ) {
    addRowsDedup(map, await queryDocsByFieldRange(col, "fechaTS", iniTs, finTs));

    for (const mk of monthKeys) {
      const bounds = getMonthBoundsDMY(mk);
      if (!bounds) continue;
      addRowsDedup(map, await queryDocsByFieldRange(col, "fecha", bounds.ini, bounds.fin));
    }
  }

  return Array.from(map.values())
    .map((r) => ({ ...r, fecha: extraerFechaMovimiento(r) || r.fecha || "" }))
    .filter((r) => {
      const ts = dmyToMillis(String(r.fecha || ""));
      return ts >= iniMs && ts <= finMs;
    })
    .sort((a, b) => dmyToMillis(a.fecha || "") - dmyToMillis(b.fecha || ""));
}

async function eliminarMovimientoFinanzas(id, _userId = null, _isSuper = false) {
  const mov = await getMovimientoFinanzaById(id);
  if (!mov) throw new Error("Movimiento no encontrado.");
  await deleteFinanceDocMirrored(String(id));
  return mov;
}

// ===============================
// RESÚMENES
// ===============================
function resumenFinanzasTextoPorFecha(fecha, list = []) {
  const rows = Array.isArray(list) ? list : [];
  let ingresos = 0;
  let egresos = 0;

  for (const r of rows) {
    const monto = Number(r.monto || 0);
    if (String(r.tipo || "").toLowerCase() === "egreso") egresos += monto;
    else ingresos += monto;
  }

  const utilidad = ingresos - egresos;

  let txt = `📅 RESUMEN DEL ${String(fecha || "")}\n\n`;
  txt += `Ingresos: ${moneyLps(ingresos)}\n`;
  txt += `Egresos: ${moneyLps(egresos)}\n`;
  txt += `Utilidad: ${moneyLps(utilidad)}\n`;
  txt += `Movimientos: ${String(rows.length)}\n`;

  if (rows.length) {
    txt += `\nDetalle:\n`;
    txt += rows.slice(0, 20).map((r, i) => {
      const tipo = String(r.tipo || "").toLowerCase() === "egreso" ? "➖" : "➕";
      return `${i + 1}. ${tipo} ${textoMovimientoParaEliminar(r)}`;
    }).join("\n");
  }

  return txt;
}

function resumenBancosMesTexto(monthKey, list = []) {
  const rows = Array.isArray(list) ? list : [];
  const label = monthLabelFromKeyLocal(monthKey);
  const map = {};

  for (const r of rows) {
    const bancoRaw = String(r.banco || r.metodo || "").trim();
    const bancoKey = normalizarBancoKey(bancoRaw);
    const bancoLabel = humanBanco(bancoRaw);
    const monto = Number(r.monto || 0);

    if (!map[bancoKey]) {
      map[bancoKey] = { banco: bancoLabel, ingresos: 0, egresos: 0, neto: 0 };
    }

    if (String(r.tipo || "").trim().toLowerCase() === "egreso") {
      map[bancoKey].egresos += monto;
      map[bancoKey].neto -= monto;
    } else {
      map[bancoKey].ingresos += monto;
      map[bancoKey].neto += monto;
    }
  }

  const items = Object.values(map).sort((a, b) => {
    const totalA = Number(a.ingresos || 0) + Number(a.egresos || 0);
    const totalB = Number(b.ingresos || 0) + Number(b.egresos || 0);
    return totalB - totalA;
  });

  let txt = `🏦 RESUMEN POR BANCO — ${label}\n\n`;
  if (!items.length) {
    txt += "No hay movimientos para este mes.";
    return txt;
  }

  txt += items.map((v, i) => (
    `${i + 1}. ${v.banco}\n` +
    `   Ingresos: ${moneyLps(v.ingresos)}\n` +
    `   Egresos: ${moneyLps(v.egresos)}\n` +
    `   Neto: ${moneyLps(v.neto)}`
  )).join("\n\n");

  return txt;
}

function resumenTopPlataformasTexto(monthKey, list = []) {
  const rows = Array.isArray(list) ? list : [];
  const label = monthLabelFromKeyLocal(monthKey);
  const map = {};

  for (const r of rows) {
    if (String(r.tipo || "").toLowerCase() === "egreso") continue;
    const key = String(r.plataforma || "").trim().toLowerCase();
    if (!key) continue;
    map[key] = (map[key] || 0) + Number(r.monto || 0);
  }

  const items = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 20);
  let txt = `🏆 TOP PLATAFORMAS — ${label}\n\n`;

  if (!items.length) {
    txt += "No hay ingresos para este mes.";
    return txt;
  }

  txt += items.map(([plat, total], i) => `${i + 1}. ${humanPlatSafe(plat)} — ${moneyLps(total)}`).join("\n");
  return txt;
}

function cierreCajaTexto(fecha, list = []) {
  let ingresos = 0;
  let egresos = 0;
  for (const m of Array.isArray(list) ? list : []) {
    const monto = Number(m.monto || 0);
    if (String(m.tipo || "").toLowerCase() === "egreso") egresos += monto;
    else ingresos += monto;
  }
  const utilidad = ingresos - egresos;
  let color = "🟢";
  if (utilidad < 0) color = "🔴";
  else if (utilidad === 0) color = "🟡";

  let txt = "";
  txt += "🧾 CIERRE DE CAJA\n";
  txt += `(${String(fecha || "")})\n\n`;
  txt += `💰 Entradas: ${moneyLps(ingresos)}\n`;
  txt += `💸 Salidas: ${moneyLps(egresos)}\n`;
  txt += `📦 Caja final: ${utilidad >= 0 ? "+" : ""}${moneyLps(utilidad)} ${color}\n`;
  txt += `🧮 Movimientos: ${Array.isArray(list) ? list.length : 0}`;
  return txt;
}

function cierreCajaTextoRango(fechaInicio, fechaFin, list = []) {
  let ingresos = 0;
  let egresos = 0;
  for (const m of Array.isArray(list) ? list : []) {
    const monto = Number(m.monto || 0);
    if (String(m.tipo || "").toLowerCase() === "egreso") egresos += monto;
    else ingresos += monto;
  }
  const utilidad = ingresos - egresos;
  let color = "🟢";
  if (utilidad < 0) color = "🔴";
  else if (utilidad === 0) color = "🟡";

  let txt = "";
  txt += "🧾 CIERRE DE CAJA\n";
  txt += `(${String(fechaInicio || "")} al ${String(fechaFin || "")})\n\n`;
  txt += `💰 Entradas: ${moneyLps(ingresos)}\n`;
  txt += `💸 Salidas: ${moneyLps(egresos)}\n`;
  txt += `📦 Caja final: ${utilidad >= 0 ? "+" : ""}${moneyLps(utilidad)} ${color}\n`;
  txt += `🧮 Movimientos: ${Array.isArray(list) ? list.length : 0}`;
  return txt;
}

// ===============================
// EXCEL
// ===============================
function applyHeaderStyle(row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { vertical: "middle", horizontal: "center" };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E78" } };
}

function applyMoneyFormat(cell) {
  cell.numFmt = '#,##0.00';
}

function applyIngresoRowStyle(row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E2F0D9" } };
  });
  row.getCell("B").font = { bold: true, color: { argb: "008000" } };
}

function applyEgresoRowStyle(row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FCE4D6" } };
  });
  row.getCell("B").font = { bold: true, color: { argb: "C00000" } };
}

function autoBorderSheet(ws) {
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "D9D9D9" } },
        left: { style: "thin", color: { argb: "D9D9D9" } },
        bottom: { style: "thin", color: { argb: "D9D9D9" } },
        right: { style: "thin", color: { argb: "D9D9D9" } },
      };
      if (!cell.alignment) cell.alignment = { vertical: "middle" };
    });
  });
}

function visualBar(value, maxValue) {
  const v = Math.max(0, Number(value || 0));
  const max = Math.max(1, Number(maxValue || 1));
  const blocks = Math.max(1, Math.round((v / max) * 12));
  return "█".repeat(blocks);
}

function decorateFinanzasSheet(ws, rows = []) {
  applyHeaderStyle(ws.getRow(1));
  for (let i = 0; i < rows.length; i++) {
    const excelRow = ws.getRow(i + 2);
    const tipo = String(rows[i]?.tipo || "").toLowerCase();
    applyMoneyFormat(excelRow.getCell("C"));
    if (tipo === "ingreso") applyIngresoRowStyle(excelRow);
    else if (tipo === "egreso") applyEgresoRowStyle(excelRow);
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: `G${Math.max(1, ws.rowCount)}` };
  autoBorderSheet(ws);
}

function decorateResumenSheet(resumen, meta = {}) {
  const { fechaInicio = "", fechaFin = "", label = "", ingresos = 0, egresos = 0, utilidad = 0, movimientos = 0 } = meta;

  resumen.columns = [
    { header: "Concepto", key: "concepto", width: 24 },
    { header: "Valor", key: "valor", width: 18 },
    { header: "Visual", key: "visual", width: 18 },
  ];

  applyHeaderStyle(resumen.getRow(1));

  if (label) resumen.addRow({ concepto: "Periodo", valor: label, visual: "" });
  if (fechaInicio) resumen.addRow({ concepto: "Fecha inicio", valor: fechaInicio, visual: "" });
  if (fechaFin) resumen.addRow({ concepto: "Fecha fin", valor: fechaFin, visual: "" });

  const maxBase = Math.max(Number(ingresos || 0), Number(egresos || 0), Math.abs(Number(utilidad || 0)), 1);

  resumen.addRow({ concepto: "Ingresos", valor: Number(ingresos || 0), visual: visualBar(ingresos, maxBase) });
  resumen.addRow({ concepto: "Egresos", valor: Number(egresos || 0), visual: visualBar(egresos, maxBase) });
  resumen.addRow({ concepto: "Utilidad", valor: Number(utilidad || 0), visual: visualBar(Math.abs(utilidad || 0), maxBase) });
  resumen.addRow({ concepto: "Movimientos", valor: Number(movimientos || 0), visual: "" });

  for (let i = 2; i <= resumen.rowCount; i++) {
    const row = resumen.getRow(i);
    const concepto = String(row.getCell("A").value || "");

    if (["Ingresos", "Egresos", "Utilidad", "Movimientos"].includes(concepto)) row.font = { bold: true };

    if (concepto === "Ingresos") {
      row.getCell("A").font = { bold: true, color: { argb: "008000" } };
      row.getCell("B").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E2F0D9" } };
      applyMoneyFormat(row.getCell("B"));
      row.getCell("C").font = { color: { argb: "008000" } };
    }

    if (concepto === "Egresos") {
      row.getCell("A").font = { bold: true, color: { argb: "C00000" } };
      row.getCell("B").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FCE4D6" } };
      applyMoneyFormat(row.getCell("B"));
      row.getCell("C").font = { color: { argb: "C00000" } };
    }

    if (concepto === "Utilidad") {
      const positive = Number(utilidad || 0) >= 0;
      row.getCell("A").font = { bold: true, color: { argb: positive ? "008000" : "C00000" } };
      row.getCell("B").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: positive ? "E2F0D9" : "FCE4D6" },
      };
      applyMoneyFormat(row.getCell("B"));
      row.getCell("C").font = { color: { argb: positive ? "008000" : "C00000" } };
    }
  }

  resumen.views = [{ state: "frozen", ySplit: 1 }];
  autoBorderSheet(resumen);
}

async function exportarFinanzasRangoExcel(chatId, fechaInicio, fechaFin, _userId = null, _isSuper = false) {
  const ini = parseFechaFlexible(fechaInicio);
  const fin = parseFechaFlexible(fechaFin);
  if (!ini || !fin) throw new Error("Fechas inválidas.");

  const tsIni = dmyToMillis(ini);
  const tsFin = dmyToMillis(fin);
  if (tsIni > tsFin) throw new Error("La fecha inicial no puede ser mayor a la final.");

  const rows = (await getMovimientosPorRango(ini, fin)).map((r) => ({
    ...r,
    fecha: extraerFechaMovimiento(r) || r.fecha || "",
  }));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sublicuentas Bot";
  wb.created = new Date();

  const ws = wb.addWorksheet("Finanzas");
  ws.columns = [
    { header: "Fecha", key: "fecha", width: 15 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Monto", key: "monto", width: 15 },
    { header: "Plataforma/Motivo", key: "concepto", width: 30 },
    { header: "Banco/Método", key: "extra", width: 22 },
    { header: "Detalle", key: "detalle", width: 35 },
    { header: "ID", key: "id", width: 28 },
  ];

  for (const r of rows) {
    ws.addRow({
      fecha: r.fecha || "",
      tipo: finTipoLabel(r.tipo),
      monto: Number(r.monto || 0),
      concepto: finConceptoLabel(r),
      extra: finExtraLabel(r),
      detalle: r.detalle || r.descripcion || "",
      id: r.id,
    });
  }

  decorateFinanzasSheet(ws, rows);

  let ingresos = 0;
  let egresos = 0;
  for (const r of rows) {
    const monto = Number(r.monto || 0);
    if (String(r.tipo || "").toLowerCase() === "egreso") egresos += monto;
    else ingresos += monto;
  }

  const resumen = wb.addWorksheet("Resumen");
  decorateResumenSheet(resumen, {
    fechaInicio: ini,
    fechaFin: fin,
    ingresos,
    egresos,
    utilidad: ingresos - egresos,
    movimientos: rows.length,
  });

  const tempPath = `/tmp/finanzas_${Date.now()}.xlsx`;
  await wb.xlsx.writeFile(tempPath);

  await bot.sendDocument(chatId, tempPath, { caption: `📊 Finanzas del ${ini} al ${fin}` });

  try { fs.unlinkSync(tempPath); } catch (_) {}
  return true;
}

// compatibility
async function listarMovimientosPorFechaYTipo(fechaDMY, tipo) {
  const rows = await getMovimientosPorFecha(fechaDMY);
  return rows
    .filter((x) => String(x.tipo || "").toLowerCase() === String(tipo || "").toLowerCase())
    .sort((a, b) => dmyToMillis(b.fecha || "") - dmyToMillis(a.fecha || ""));
}

async function menuFinanzas(chatId) { return menuPagos(chatId); }
async function menuRegistroFinanzas(chatId) { return menuFinRegistro(chatId); }
async function menuEliminarMovimientoEspecifico(chatId) { return menuFinEliminarTipo(chatId); }

async function pedirFechaEliminarMovimiento(chatId, tipo) {
  const titulo = String(tipo || "").toLowerCase() === "egreso" ? "EGRESO" : "INGRESO";
  return upsertPanel(chatId,
    `🗑️ *ELIMINAR ${titulo} POR FECHA*\n\nEnvíe la fecha exacta en formato *dd/mm/yyyy*.\n\nEjemplo: *22/03/2026*`,
    [[
      { text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
    ]]
  );
}

async function listarMovimientosParaEliminarPorFecha(chatId, tipo, fechaDMY) {
  const rows = await listarMovimientosPorFechaYTipo(fechaDMY, tipo);

  if (!rows.length) {
    return upsertPanel(chatId,
      `⚠️ No encontré *${tipo === "egreso" ? "egresos" : "ingresos"}* en la fecha *${fechaDMY}*.`,
      [
        [{
          text: tipo === "egreso" ? "➖ Buscar otra fecha" : "➕ Buscar otra fecha",
          callback_data: tipo === "egreso" ? "fin:menu:eliminar:egreso" : "fin:menu:eliminar:ingreso",
        }],
        [
          { text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" },
          { text: "🏠 Inicio", callback_data: "go:inicio" },
        ],
      ]
    );
  }

  const keyboard = rows.map((r) => [
    { text: textoMovimientoParaEliminar(r), callback_data: `fin:del:pick:${r.id}` },
  ]);
  keyboard.push([{
    text: tipo === "egreso" ? "➖ Buscar otra fecha" : "➕ Buscar otra fecha",
    callback_data: tipo === "egreso" ? "fin:menu:eliminar:egreso" : "fin:menu:eliminar:ingreso",
  }]);
  keyboard.push([
    { text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]);

  return upsertPanel(chatId,
    `🗑️ *${tipo === "egreso" ? "EGRESOS" : "INGRESOS"} DEL ${fechaDMY}*\n\nSeleccione el movimiento exacto que desea borrar:`,
    keyboard
  );
}

async function confirmarEliminarMovimiento(chatId, movId) {
  const mov = await getMovimientoFinanzaById(movId);

  if (!mov) {
    return upsertPanel(chatId, "⚠️ Ese movimiento ya no existe o fue eliminado.", [[
      { text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
    ]]);
  }

  return upsertPanel(chatId, textoConfirmarEliminacionMovimiento(mov), [
    [
      { text: "✅ Sí, eliminar", callback_data: `fin:del:ok:${mov.id}` },
      { text: "❌ Cancelar", callback_data: "fin:menu:eliminar" },
    ],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function eliminarMovimientoDefinitivo(chatId, movId, userId = null) {
  const mov = await eliminarMovimientoFinanzas(movId, userId, true);

  let txt = "✅ MOVIMIENTO ELIMINADO\n\n";
  txt += `Tipo: ${finTipoLabel(mov.tipo)}\n`;
  txt += `Fecha: ${String(extraerFechaMovimiento(mov) || mov.fecha || "-")}\n`;
  txt += `Monto: ${moneyLps(mov.monto || 0)}\n`;
  txt += `Concepto: ${finConceptoLabel(mov)}\n`;
  if (userId) txt += `Eliminado por: ${String(userId)}\n`;

  return upsertPanel(chatId, txt, [
    [
      { text: "🗑️ Eliminar otro", callback_data: "fin:menu:eliminar" },
      { text: "📒 Volver Registro", callback_data: "fin:menu:registro" },
    ],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function listarIngresosHoy(chatId) {
  const hoy = hoyDMY();
  const rows = await listarMovimientosPorFechaYTipo(hoy, "ingreso");

  if (!rows.length) {
    return upsertPanel(chatId, `📒 *INGRESOS DE HOY (${hoy})*\n\nNo hay ingresos registrados hoy.`, [[
      { text: "⬅️ Volver Registro", callback_data: "fin:menu:registro" },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
    ]]);
  }

  const lines = rows.slice(0, 30).map((r, i) => `${i + 1}. ${textoMovimientoParaEliminar(r)}`);
  return upsertPanel(chatId, `📒 *INGRESOS DE HOY (${hoy})*\n\n${escMD(lines.join("\n"))}`, [[
    { text: "⬅️ Volver Registro", callback_data: "fin:menu:registro" },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]]);
}

async function listarEgresosHoy(chatId) {
  const hoy = hoyDMY();
  const rows = await listarMovimientosPorFechaYTipo(hoy, "egreso");

  if (!rows.length) {
    return upsertPanel(chatId, `📒 *EGRESOS DE HOY (${hoy})*\n\nNo hay egresos registrados hoy.`, [[
      { text: "⬅️ Volver Registro", callback_data: "fin:menu:registro" },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
    ]]);
  }

  const lines = rows.slice(0, 30).map((r, i) => `${i + 1}. ${textoMovimientoParaEliminar(r)}`);
  return upsertPanel(chatId, `📒 *EGRESOS DE HOY (${hoy})*\n\n${escMD(lines.join("\n"))}`, [[
    { text: "⬅️ Volver Registro", callback_data: "fin:menu:registro" },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]]);
}

async function menuReportesFinanzas(chatId) { return menuFinReportes(chatId); }

async function resumenFinancieroPorMonthKey(monthKey) {
  const rows = await getMovimientosPorMes(monthKey);
  let ingresos = 0;
  let egresos = 0;
  const top = {};

  for (const r of rows) {
    const monto = Number(r.monto || 0);
    if (String(r.tipo || "").toLowerCase() === "egreso") {
      egresos += monto;
    } else {
      ingresos += monto;
      const key = String(r.plataforma || "").trim().toLowerCase();
      if (key) top[key] = (top[key] || 0) + monto;
    }
  }

  const utilidad = ingresos - egresos;
  const topOrdenado = Object.entries(top)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([plataforma, total]) => ({ plataforma, total }));

  return {
    ingresos,
    egresos,
    utilidad,
    totalMovimientos: rows.length,
    topOrdenado,
    rows,
  };
}

async function enviarReporteMesActual(chatId) {
  const monthKey = monthKeyFromDMYLocal(hoyDMY());
  const label = monthLabelFromKeyLocal(monthKey);
  const res = await resumenFinancieroPorMonthKey(monthKey);

  let txt = `📊 *REPORTE ${escMD(label)}*\n\n`;
  txt += `*Ingresos:* ${escMD(moneyLps(res.ingresos || 0))}\n`;
  txt += `*Egresos:* ${escMD(moneyLps(res.egresos || 0))}\n`;
  txt += `*Utilidad:* ${escMD(moneyLps(res.utilidad || 0))}\n`;
  txt += `*Movimientos:* ${escMD(String(res.totalMovimientos || 0))}\n`;

  if (res.topOrdenado.length) {
    txt += `\n*Top plataformas vendidas:*\n`;
    txt += res.topOrdenado
      .map((x, i) => `${i + 1}. ${escMD(humanPlatSafe(x.plataforma))} — ${escMD(moneyLps(x.total || 0))}`)
      .join("\n");
  }

  return upsertPanel(chatId, txt, [
    [
      { text: "📤 Exportar Excel por rango", callback_data: "fin:menu:excel_rango" },
      { text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" },
    ],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function exportarExcelMesActual(chatId) {
  const monthKey = monthKeyFromDMYLocal(hoyDMY());
  const label = monthLabelFromKeyLocal(monthKey);
  const res = await resumenFinancieroPorMonthKey(monthKey);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sublicuentas Bot";
  wb.created = new Date();

  const ws = wb.addWorksheet("Finanzas");
  ws.columns = [
    { header: "Fecha", key: "fecha", width: 15 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Monto", key: "monto", width: 15 },
    { header: "Plataforma/Motivo", key: "concepto", width: 28 },
    { header: "Banco/Método", key: "extra", width: 22 },
    { header: "Detalle", key: "detalle", width: 35 },
  ];

  for (const r of res.rows) {
    ws.addRow({
      fecha: r.fecha || "",
      tipo: finTipoLabel(r.tipo),
      monto: Number(r.monto || 0),
      concepto: finConceptoLabel(r),
      extra: finExtraLabel(r),
      detalle: r.detalle || r.descripcion || "",
    });
  }

  decorateFinanzasSheet(ws, res.rows);

  const resumen = wb.addWorksheet("Resumen");
  decorateResumenSheet(resumen, {
    label,
    ingresos: res.ingresos || 0,
    egresos: res.egresos || 0,
    utilidad: res.utilidad || 0,
    movimientos: res.totalMovimientos || 0,
  });

  const tempPath = `/tmp/finanzas_${monthKey.replace(/[^\w]/g, "_")}.xlsx`;
  await wb.xlsx.writeFile(tempPath);

  await bot.sendDocument(chatId, tempPath, { caption: `📊 Reporte Excel de ${label}` });
  try { fs.unlinkSync(tempPath); } catch (_) {}

  return upsertPanel(chatId, `✅ *Excel generado correctamente* para *${escMD(label)}*.\n\n🟢 Ingresos en verde\n🔴 Egresos en rojo`, [[
    { text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]]);
}

module.exports = {
  menuPrincipal,
  menuVendedor,
  menuInventario,
  menuInventarioVideo,
  menuInventarioMusica,
  menuInventarioIptv,
  menuInventarioDisenoIA,
  menuClientes,
  menuRenovaciones,
  menuPagos,
  menuFinRegistro,
  menuFinEliminarTipo,
  menuFinReportes,
  kbBancosFinanzas,
  kbMotivosFinanzas,
  registrarIngresoTx,
  registrarEgresoTx,
  getMovimientosPorFecha,
  getMovimientosPorMes,
  getMovimientosPorRango,
  resumenFinanzasTextoPorFecha,
  resumenBancosMesTexto,
  resumenTopPlataformasTexto,
  cierreCajaTexto,
  cierreCajaTextoRango,
  textoConfirmarEliminacionMovimiento,
  exportarFinanzasRangoExcel,
  eliminarMovimientoFinanzas,
  menuFinanzas,
  menuRegistroFinanzas,
  menuEliminarMovimientoEspecifico,
  pedirFechaEliminarMovimiento,
  listarMovimientosParaEliminarPorFecha,
  confirmarEliminarMovimiento,
  eliminarMovimientoDefinitivo,
  listarIngresosHoy,
  listarEgresosHoy,
  menuReportesFinanzas,
  enviarReporteMesActual,
  exportarExcelMesActual,
  resumenFinancieroPorMonthKey,
  listarMovimientosPorFechaYTipo,
  getMovimientoFinanzaById,
  textoMovimientoParaEliminar,
};
