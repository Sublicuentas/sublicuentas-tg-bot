/* ✅ SUBLICUENTAS TG BOT — PARTE 5/6 OPTIMIZADA v3
   FINANZAS / REPORTES / EXCEL / MENÚS / DASHBOARD / BACKUP DOMINICAL
   -------------------------------------------------------------------
   ✅ CAMBIO v3:
   - Recordatorios de vencimiento: de 9PM → 11AM del día anterior
   - Función renombrada: enviarNotificacion9PM → enviarRecordatorios11AM
   - Scheduler actualizado: hh === 11 en lugar de hh === 21
   - Backup dominical se mantiene a las 9PM los domingos
*/

const fs = require("fs");

const {
  bot, admin, db, ExcelJS, PLATAFORMAS, FINANZAS_COLLECTION,
} = require("./index_01_core");

const {
  escMD, upsertPanel, parseFechaFinanceInput, getMonthLabelFromKey,
  getMonthKeyFromDMY, isFechaDMY, hoyDMY, moneyLps, logErr, normalizarPlataforma,
} = require("./index_02_utils_roles");

const { humanPlataforma, obtenerRenovacionesPorFecha } = require("./index_03_clientes_crm");

// ===============================
// CONFIG
// ===============================
const FIN_BANCOS_LOCAL = [
  "🏦 BAC", "🏦 Ficohsa", "🏦 Atlántida", "🏦 Banpaís", "🏦 Occidente", "🏦 Davivienda",
  "🏦 Lafise", "💵 Efectivo", "📱 Tigo Money", "📱 Tengo", "💳 PayPal", "🪙 Binance", "🔁 Otro",
];

const FIN_MOTIVOS_EGRESO_LOCAL = [
  "🔄 Renovaciones", "🆕 Cuentas nuevas", "👤 Pago revendedor", "👥 Pago planilla",
  "📣 Publicidad", "📦 Otros gastos",
];

const PLATFORM_KEYS = Array.isArray(PLATAFORMAS) ? PLATAFORMAS : Object.keys(PLATAFORMAS || {});

const FINANCE_COLLECTION_PRIMARY = String(FINANZAS_COLLECTION || "").trim() || "finanzas_movimientos";
const FINANCE_COLLECTIONS_READ = Array.from(new Set([FINANCE_COLLECTION_PRIMARY, "finanzas_movimientos", "finanzas"].filter(Boolean)));

// ===============================
// HELPERS BASE
// ===============================
function normalizeFinanceDocRow(id, data = {}, source = "") { return { id: String(id || ""), _source: String(source || ""), ...(data || {}) }; }
function normalizeMonthKey(key = "") { const s = String(key || "").trim(); let m = s.match(/^(\d{4})-(\d{2})$/); if (m) return `${m[1]}-${m[2]}`; m = s.match(/^(\d{2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1]}`; return ""; }
function altMonthKey(key = "") { const k = normalizeMonthKey(key); if (!k) return ""; const m = k.match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}/${m[1]}` : ""; }
function platMeta(key = "") { if (Array.isArray(PLATAFORMAS)) return {}; return PLATAFORMAS[String(key || "").trim()] || {}; }
function humanPlatSafe(key = "") { try { return humanPlataforma(key); } catch (_) { return platMeta(key)?.nombre || String(key || ""); } }
function pairButtons(buttons = []) { const rows = []; for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2)); return rows; }
function categoryOfPlat(key = "") {
  const k = String(key || "").trim().toLowerCase();
  const meta = platMeta(k);
  const c = String(meta.categoria || "").toLowerCase().trim();
  if (["video","musica","iptv","diseno_ia"].includes(c)) return c;
  if (["netflix","vipnetflix","disneyp","disneys","hbomax","primevideo","paramount","crunchyroll","vix","appletv","universal"].includes(k)) return "video";
  if (["spotify","youtube","deezer"].includes(k)) return "musica";
  if (["oleadatv1","oleadatv3","iptv1","iptv3","iptv4"].includes(k)) return "iptv";
  if (["canva","gemini","chatgpt"].includes(k)) return "diseno_ia";
  return "video";
}
function inventoryLabel(key = "") {
  // ✅ Sin emojis en los botones — evita encoding issues con node-telegram-bot-api
  return humanPlatSafe(key);
}
function kbFromItems(items = []) {
  const buttons = items.map((key) => ({ text: inventoryLabel(key), callback_data: `inv:${String(key)}:0` }));
  return pairButtons(buttons);
}
function dmyToDate(dmy = "") {
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  return dt;
}
function dmyToMillis(dmy = "") { const dt = dmyToDate(dmy); return dt ? dt.getTime() : 0; }
function dmyToTimestamp(dmy = "") { const dt = dmyToDate(dmy); return dt ? admin.firestore.Timestamp.fromDate(dt) : null; }
function normalizeDMY(s = "") {
  const v = String(s || "").trim();
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${String(Number(m[1])).padStart(2,"0")}/${String(Number(m[2])).padStart(2,"0")}/${m[3]}`;
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${String(Number(m[3])).padStart(2,"0")}/${String(Number(m[2])).padStart(2,"0")}/${m[1]}`;
  return "";
}
function tsToDMY(ts) {
  try {
    if (!ts) return "";
    let d = null;
    if (typeof ts?.toDate === "function") d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else if (typeof ts === "number" && Number.isFinite(ts)) d = new Date(ts);
    else if (typeof ts === "string") { const direct = normalizeDMY(ts); if (direct) return direct; const parsed = new Date(ts); if (!isNaN(parsed.getTime())) d = parsed; }
    else if (typeof ts === "object" && Number.isFinite(ts._seconds)) d = new Date(Number(ts._seconds) * 1000);
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  } catch (_) { return ""; }
}
function monthKeyFromDMYLocal(dmy = "") {
  const v = typeof getMonthKeyFromDMY === "function" ? getMonthKeyFromDMY(dmy) : "";
  if (v) return normalizeMonthKey(v);
  const dt = dmyToDate(dmy);
  if (!dt) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
}
function monthLabelFromKeyLocal(key = "") {
  const norm = normalizeMonthKey(key);
  if (typeof getMonthLabelFromKey === "function") { const v = getMonthLabelFromKey(norm); if (v) return v; }
  const m = norm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(key || "");
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return `${meses[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}
function parseFechaFlexible(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "hoy") return hoyDMY();
  if (typeof parseFechaFinanceInput === "function") { const p = parseFechaFinanceInput(s); if (p) return normalizeDMY(p); }
  return isFechaDMY(s) ? normalizeDMY(s) : null;
}
function extraerFechaMovimiento(r = {}) {
  return normalizeDMY(r.fecha || "") || tsToDMY(r.fechaTS || r.fecha_ts || null) || tsToDMY(r.createdAt || r.created_at || null) || tsToDMY(r.updatedAt || r.updated_at || null) || tsToDMY(r.timestamp || r.ts || null) || "";
}
function finTipoLabel(tipo) { return String(tipo || "").toLowerCase() === "egreso" ? "Egreso" : "Ingreso"; }
function finConceptoLabel(m = {}) {
  const tipo = String(m.tipo || "").toLowerCase();
  if (tipo === "egreso") return String(m.motivo || m.detalle || m.descripcion || "Egreso").trim();
  return String(m.plataforma || m.detalle || m.descripcion || m.cliente || "Ingreso").trim();
}

function normalizarBancoKey(raw = "") {
  const s = String(raw || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!s) return "sin_banco";

  if (s.includes("bac")) return "bac";
  if (s.includes("atlantida")) return "atlantida";
  if (s.includes("ficohsa")) return "ficohsa";
  if (s.includes("banpais")) return "banpais";
  if (s.includes("occidente")) return "occidente";
  if (s.includes("davivienda")) return "davivienda";
  if (s.includes("lafise")) return "lafise";
  if (s.includes("tigo")) return "tigo_money";
  if (s.includes("paypal")) return "paypal";
  if (s.includes("binance")) return "binance";
  if (s.includes("efectivo") || s.includes("cash")) return "efectivo";
  if (s.includes("transferencia")) return "transferencia";
  if (s.includes("tengo")) return "tengo";
  if (s.includes("otro")) return "otro";

  const sinEmojis = s.replace(/[^\w\s.-]/gi, '').trim().replace(/\s+/g, "_");
  return sinEmojis || "sin_banco";
}

function humanBanco(raw = "") {
  const key = normalizarBancoKey(raw);
  const map = { 
    bac: "🏦 BAC", 
    atlantida: "🏦 Atlántida", 
    ficohsa: "🏦 Ficohsa", 
    banpais: "🏦 Banpaís", 
    occidente: "🏦 Occidente", 
    davivienda: "🏦 Davivienda", 
    lafise: "🏦 Lafise", 
    tigo_money: "📱 Tigo Money", 
    paypal: "💳 PayPal", 
    binance: "🪙 Binance", 
    efectivo: "💵 Efectivo", 
    transferencia: "🔁 Transferencia", 
    tengo: "📱 Tengo", 
    otro: "🔁 Otro", 
    sin_banco: "Sin banco" 
  };
  return map[key] || String(raw || "Sin banco").trim() || "Sin banco";
}

function finExtraLabel(m = {}) {
  const tipo = String(m.tipo || "").toLowerCase();
  const banco = humanBanco(m.banco || m.metodo || "");
  const detalle = String(m.detalle || m.descripcion || "").trim();
  if (tipo === "egreso") return detalle ? `${banco} • ${detalle}` : banco;
  return banco;
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
  const monto = typeof moneyLps === "function" ? moneyLps(m.monto || 0) : `${Number(m.monto || 0).toFixed(2)} Lps`;
  const concepto = finConceptoLabel(m);
  const extra = finExtraLabel(m);
  let txt = "🗑️ CONFIRMAR ELIMINACIÓN\n\n";
  txt += `Tipo: ${tipo}\nFecha: ${fecha}\nMonto: ${monto}\nConcepto: ${concepto}\n`;
  if (extra) txt += `Extra: ${extra}\n`;
  txt += "\n¿Desea eliminar este movimiento?";
  return txt;
}
function resumenFinanzasTextoPorRango(fechaInicio, fechaFin, list = []) {
  const rows = Array.isArray(list) ? list : [];
  let ingresos = 0, egresos = 0;
  for (const r of rows) { const monto = Number(r.monto || 0); if (String(r.tipo || "").toLowerCase() === "egreso") egresos += monto; else ingresos += monto; }
  const utilidad = ingresos - egresos;
  let txt = `🗓️ RESUMEN DEL ${fechaInicio} AL ${fechaFin}\n\nIngresos: ${moneyLps(ingresos)}\nEgresos: ${moneyLps(egresos)}\nUtilidad: ${moneyLps(utilidad)}\nMovimientos: ${String(rows.length)}\n`;
  if (rows.length) { txt += `\nDetalle:\n`; txt += rows.slice(0, 30).map((r, i) => `${i+1}. ${String(r.tipo||"").toLowerCase()==="egreso"?"➖":"➕"} ${textoMovimientoParaEliminar(r)}`).join("\n"); }
  return txt;
}
function agruparBancosDesdeLista(list = []) {
  const map = {};
  for (const r of Array.isArray(list) ? list : []) {
    const bancoRaw = String(r.banco || r.metodo || "").trim();
    const bancoKey = normalizarBancoKey(bancoRaw);
    const bancoLabel = humanBanco(bancoRaw);
    const monto = Number(r.monto || 0);
    if (!map[bancoKey]) map[bancoKey] = { banco: bancoLabel, ingresos: 0, egresos: 0, neto: 0 };
    if (String(r.tipo || "").trim().toLowerCase() === "egreso") { map[bancoKey].egresos += monto; map[bancoKey].neto -= monto; }
    else { map[bancoKey].ingresos += monto; map[bancoKey].neto += monto; }
  }
  return Object.values(map).sort((a, b) => (Number(b.ingresos||0)+Number(b.egresos||0)) - (Number(a.ingresos||0)+Number(a.egresos||0)));
}
function resumenBancosFechaTexto(fecha, list = []) { const items = agruparBancosDesdeLista(list); let txt = `🏦 RESUMEN POR BANCO — ${fecha}\n\n`; if (!items.length) { txt += "No hay movimientos para esa fecha."; return txt; } txt += items.map((v, i) => `${i+1}. ${v.banco}\n   Ingresos: ${moneyLps(v.ingresos)}\n   Egresos: ${moneyLps(v.egresos)}\n   Neto: ${moneyLps(v.neto)}`).join("\n\n"); return txt; }
function resumenBancosRangoTexto(fechaInicio, fechaFin, list = []) { const items = agruparBancosDesdeLista(list); let txt = `🏦 RESUMEN POR BANCO — ${fechaInicio} al ${fechaFin}\n\n`; if (!items.length) { txt += "No hay movimientos para ese rango."; return txt; } txt += items.map((v, i) => `${i+1}. ${v.banco}\n   Ingresos: ${moneyLps(v.ingresos)}\n   Egresos: ${moneyLps(v.egresos)}\n   Neto: ${moneyLps(v.neto)}`).join("\n\n"); return txt; }
function splitPlataformasNormalizadas(raw = "") {
  const source = String(raw || "").trim();
  if (!source) return [];
  const normalized = source.replace(/\s+y\s+/gi, ",").replace(/[+|&;]/g, ",").split(",").map((x) => String(x||"").trim()).filter(Boolean);
  const out = [];
  for (const part of normalized.length ? normalized : [source]) { const plat = normalizarPlataforma(part); if (plat && PLATFORM_KEYS.includes(plat) && !out.includes(plat)) out.push(plat); }
  if (!out.length) { const single = normalizarPlataforma(source); if (single && PLATFORM_KEYS.includes(single)) out.push(single); }
  return out;
}
function resumenTopPlataformasGenerico(label = "", list = []) {
  const map = {};
  for (const r of Array.isArray(list) ? list : []) {
    if (String(r.tipo||"").toLowerCase() === "egreso") continue;
    const monto = Number(r.monto || 0);
    if (!Number.isFinite(monto) || monto <= 0) continue;
    const plats = splitPlataformasNormalizadas(r.plataforma || r.plataformas || "");
    if (!plats.length) continue;
    const porcion = monto / plats.length;
    for (const plat of plats) map[plat] = (map[plat] || 0) + porcion;
  }
  const items = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 20);
  let txt = `🏆 TOP PLATAFORMAS — ${label}\n\n`;
  if (!items.length) { txt += "No hay ingresos para ese período."; return txt; }
  txt += items.map(([plat, total], i) => `${i+1}. ${humanPlatSafe(plat)} — ${moneyLps(total)}`).join("\n");
  return txt;
}
function resumenTopPlataformasRangoTexto(fechaInicio, fechaFin, list = []) { return resumenTopPlataformasGenerico(`${fechaInicio} al ${fechaFin}`, list); }
function resumenTopCombosRangoTexto(fechaInicio, fechaFin, list = []) {
  const map = {};
  for (const r of Array.isArray(list) ? list : []) {
    if (String(r.tipo||"").toLowerCase() === "egreso") continue;
    const monto = Number(r.monto || 0);
    if (!Number.isFinite(monto) || monto <= 0) continue;
    const plats = splitPlataformasNormalizadas(r.plataforma || r.plataformas || "");
    if (plats.length < 2) continue;
    const combo = plats.map((x) => humanPlatSafe(x)).sort((a, b) => a.localeCompare(b, "es")).join(" + ");
    map[combo] = (map[combo] || 0) + monto;
  }
  const items = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 20);
  let txt = `🎯 TOP COMBOS — ${fechaInicio} al ${fechaFin}\n\n`;
  if (!items.length) { txt += "No hay combos para ese período."; return txt; }
  txt += items.map(([combo, total], i) => `${i+1}. ${combo} — ${moneyLps(total)}`).join("\n");
  return txt;
}
function detalleBancoRangoTexto(banco = "", fechaInicio = "", fechaFin = "", list = []) {
  const objetivo = normalizarBancoKey(banco);
  const rows = (Array.isArray(list) ? list : []).filter((r) => normalizarBancoKey(r.banco || r.metodo || "") === objetivo);
  let ingresos = 0, egresos = 0, ing = [], egr = [];
  for (const r of rows) {
    const monto = Number(r.monto || 0);
    const linea = `${r.fecha || extraerFechaMovimiento(r) || "-"} — ${moneyLps(monto)} — ${finConceptoLabel(r)}${finExtraLabel(r) ? ` — ${finExtraLabel(r)}` : ""}`;
    if (String(r.tipo||"").toLowerCase() === "egreso") { egresos += monto; egr.push(linea); }
    else { ingresos += monto; ing.push(linea); }
  }
  let txt = `🏦 DETALLE BANCO: ${humanBanco(banco)}\n📅 Del ${fechaInicio} al ${fechaFin}\n\n`;
  if (!rows.length) { txt += "No hay movimientos para ese banco en ese rango."; return txt; }
  txt += "Ingresos:\n" + (ing.length ? ing.map((x, i) => `${i+1}. ${x}`).join("\n") : "Sin ingresos");
  txt += "\n\nEgresos:\n" + (egr.length ? egr.map((x, i) => `${i+1}. ${x}`).join("\n") : "Sin egresos");
  txt += `\n\nTotal ingresos: ${moneyLps(ingresos)}\nTotal egresos: ${moneyLps(egresos)}\nNeto: ${moneyLps(ingresos - egresos)}`;
  return txt;
}
function startEndDayTimestamps(dmy = "") { const dt = dmyToDate(dmy); if (!dt) return null; return { iniTs: admin.firestore.Timestamp.fromDate(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0)), finTs: admin.firestore.Timestamp.fromDate(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999)) }; }
function startEndMonthTimestamps(monthKey = "") { const key = normalizeMonthKey(monthKey); const m = key.match(/^(\d{4})-(\d{2})$/); if (!m) return null; const yyyy = Number(m[1]), mm = Number(m[2]); return { iniTs: admin.firestore.Timestamp.fromDate(new Date(yyyy, mm-1, 1, 0, 0, 0, 0)), finTs: admin.firestore.Timestamp.fromDate(new Date(yyyy, mm, 0, 23, 59, 59, 999)) }; }
function getMonthBoundsDMY(monthKey = "") { const key = normalizeMonthKey(monthKey); const m = key.match(/^(\d{4})-(\d{2})$/); if (!m) return null; const yyyy = Number(m[1]), mm = Number(m[2]), lastDay = new Date(yyyy, mm, 0).getDate(); return { ini: `01/${String(mm).padStart(2,"0")}/${yyyy}`, fin: `${String(lastDay).padStart(2,"0")}/${String(mm).padStart(2,"0")}/${yyyy}` }; }
function monthsBetweenDMY(fechaInicio = "", fechaFin = "") { const ini = dmyToDate(fechaInicio), fin = dmyToDate(fechaFin); if (!ini || !fin) return []; let a = new Date(ini.getFullYear(), ini.getMonth(), 1), b = new Date(fin.getFullYear(), fin.getMonth(), 1); if (a.getTime() > b.getTime()) { const temp = a; a = b; b = temp; } const out = []; while (a.getTime() <= b.getTime()) { out.push(`${a.getFullYear()}-${String(a.getMonth()+1).padStart(2,"0")}`); a = new Date(a.getFullYear(), a.getMonth()+1, 1); } return out; }
function addRowsDedup(map, rows = []) { for (const row of rows) { if (!row?.id) continue; if (!map.has(row.id)) map.set(row.id, row); } }
function mergeFinanceRows(base = {}, extra = {}) { const out = { ...(base || {}) }; for (const [k, v] of Object.entries(extra || {})) { if (out[k] == null || out[k] === "" || (typeof out[k] === "number" && out[k] === 0)) out[k] = v; } return out; }

async function queryDocsByFieldEq(collectionName, field, value) { try { const snap = await db.collection(collectionName).where(field, "==", value).get(); return snap.docs.map((d) => normalizeFinanceDocRow(d.id, d.data() || {}, collectionName)); } catch (e) { logErr(`queryDocsByFieldEq:${collectionName}.${field}`, e); return []; } }
async function queryDocsByFieldRange(collectionName, field, ini, fin) { try { const snap = await db.collection(collectionName).where(field, ">=", ini).where(field, "<=", fin).get(); return snap.docs.map((d) => normalizeFinanceDocRow(d.id, d.data() || {}, collectionName)); } catch (e) { logErr(`queryDocsByFieldRange:${collectionName}.${field}`, e); return []; } }

async function getAllFinanceRowsRecovered() {
  const byId = new Map();
  for (const col of FINANCE_COLLECTIONS_READ) {
    try { const snap = await db.collection(col).get(); snap.forEach((d) => { const row = normalizeFinanceDocRow(d.id, d.data() || {}, col); if (!byId.has(d.id)) byId.set(d.id, row); else byId.set(d.id, mergeFinanceRows(byId.get(d.id), row)); }); } catch (e) { logErr(`getAllFinanceRowsRecovered:${col}`, e); }
  }
  return Array.from(byId.values()).map((r) => ({ ...r, fecha: extraerFechaMovimiento(r) || r.fecha || "" }));
}

async function scanFinanceDocsFallbackByDate(fechaDMY = "") {
  const fecha = normalizeDMY(fechaDMY);
  if (!fecha) return [];
  const rows = await getAllFinanceRowsRecovered();
  return rows.filter((r) => normalizeDMY(extraerFechaMovimiento(r) || r.fecha || "") === fecha).sort((a, b) => dmyToMillis(b.fecha || "") - dmyToMillis(a.fecha || ""));
}

async function scanFinanceDocsFallbackByRange(fechaInicio = "", fechaFin = "") {
  const ini = normalizeDMY(fechaInicio), fin = normalizeDMY(fechaFin);
  if (!ini || !fin) return [];
  let iniMs = dmyToMillis(ini), finMs = dmyToMillis(fin);
  if (iniMs > finMs) { const t = iniMs; iniMs = finMs; finMs = t; }
  const rows = await getAllFinanceRowsRecovered();
  return rows.filter((r) => { const ts = dmyToMillis(extraerFechaMovimiento(r) || r.fecha || ""); return ts >= iniMs && ts <= finMs; }).sort((a, b) => dmyToMillis(a.fecha||"") - dmyToMillis(b.fecha||""));
}

async function getFinanceDocByIdAny(id) {
  const docId = String(id || "").trim();
  if (!docId) return null;
  for (const col of FINANCE_COLLECTIONS_READ) {
    try { const snap = await db.collection(col).doc(docId).get(); if (snap.exists) return { collection: col, ref: db.collection(col).doc(docId), row: normalizeFinanceDocRow(snap.id, snap.data() || {}, col) }; } catch (e) { logErr(`getFinanceDocByIdAny:${col}`, e); }
  }
  return null;
}

async function saveFinancePayload(docId, payload = {}) {
  const id = String(docId || "").trim();
  if (!id) throw new Error("ID de finanza inválido.");
  await db.collection(FINANCE_COLLECTION_PRIMARY).doc(id).set(payload, { merge: false });
  return { id, ...payload };
}

async function deleteFinanceDocAny(docId) {
  const id = String(docId || "").trim();
  if (!id) return;
  for (const col of FINANCE_COLLECTIONS_READ) { try { const ref = db.collection(col).doc(id); const doc = await ref.get(); if (doc.exists) await ref.delete(); } catch (e) { logErr(`deleteFinanceDocAny:${col}`, e); } }
}

// ===============================
// MENÚS PRINCIPALES
// ===============================
async function menuPrincipal(chatId) {
  // ✅ Redirige a Centro de Operaciones — menuPrincipal ya no se usa directamente
  return upsertPanel(chatId,
    "📊 *CENTRO DE OPERACIONES*\n\nSublicuentas — Conectamos su entretenimiento\n\nSeleccione una opción:", [
    [{ text: "🎯 Control cuentas", callback_data: "menu:inventario" }, { text: "👥 Clientes", callback_data: "menu:clientes" }],
    [{ text: "💰 Control financiero", callback_data: "menu:pagos" }, { text: "🚨 Riesgos", callback_data: "menu:alertas" }],
    [{ text: "📊 Análisis", callback_data: "menu:dashboard" }, { text: "👤 Revendedores", callback_data: "menu:revendedores" }],
  ]);
}

async function menuVendedor(chatId) {
  return upsertPanel(chatId,
    "👤 *MENÚ VENDEDOR*\n\nSeleccione una opción:", [
    [{ text: "📅 Mis renovaciones hoy", callback_data: "ren:mis:hoy" }, { text: "⏳ Próximos 3 días", callback_data: "ren:mis:prox3" }],
    [{ text: "📄 TXT renovaciones", callback_data: "txt:mis" }, { text: "👥 Mis clientes", callback_data: "vend:clientes" }],
    [{ text: "🧾 TXT mis clientes", callback_data: "vend:clientes:txt" }, { text: "💰 Mi resumen del mes", callback_data: "vend:resumen" }],
    [{ text: "🔴 Mis vencidos", callback_data: "vend:vencidos" }],
    [{ text: "🔍 Buscar cliente", callback_data: "vend:buscar" }],
  ]);
}

async function menuInventario(chatId) {
  return upsertPanel(chatId,
    "📦 *INVENTARIO*\n\nSeleccione una categoría:", [
    [{ text: "🎬 Video", callback_data: "menu:inventario:video" }, { text: "🎵 Música", callback_data: "menu:inventario:musica" }],
    [{ text: "📡 IPTV", callback_data: "menu:inventario:iptv" }, { text: "🎨 Diseño e IA", callback_data: "menu:inventario:designai" }],
    [{ text: "📊 Stock general", callback_data: "inv:general" }],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuInventarioVideo(chatId) { const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "video"); const kb = kbFromItems(items); kb.push([{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }, { text: "🏠 Inicio", callback_data: "go:inicio" }]); return upsertPanel(chatId, "VIDEO\n\nSeleccione plataforma:", kb); }
async function menuInventarioMusica(chatId) { const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "musica"); const kb = kbFromItems(items); kb.push([{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }, { text: "🏠 Inicio", callback_data: "go:inicio" }]); return upsertPanel(chatId, "MUSICA\n\nSeleccione plataforma:", kb); }
async function menuInventarioIptv(chatId) { const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "iptv"); const kb = kbFromItems(items); kb.push([{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }, { text: "🏠 Inicio", callback_data: "go:inicio" }]); return upsertPanel(chatId, "IPTV\n\nSeleccione plataforma:", kb); }
async function menuInventarioDisenoIA(chatId) { const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "diseno_ia"); const kb = kbFromItems(items); kb.push([{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }, { text: "🏠 Inicio", callback_data: "go:inicio" }]); return upsertPanel(chatId, "DISENO E IA\n\nSeleccione plataforma:", kb); }

async function menuClientes(chatId) {
  return upsertPanel(chatId,
    "👥 *CLIENTES / CRM*\n\nSeleccione una opción:", [
    [{ text: "➕ Nuevo cliente", callback_data: "cli:wiz:start" }, { text: "🔎 Buscar cliente", callback_data: "menu:buscar" }],
    [{ text: "📅 Renovaciones del día", callback_data: "menu:renovaciones" }, { text: "👤 Revendedores", callback_data: "rev:lista" }],
    [{ text: "📊 Resumen CRM", callback_data: "cli:crm:resumen" }, { text: "🗂️ TXT por vendedor", callback_data: "cli:txt:vendedores_split" }],
    [{ text: "🟢 TXT vigentes", callback_data: "cli:txt:vigentes" }, { text: "🔴 TXT no vigentes", callback_data: "cli:txt:no_vigentes" }],
    [{ text: "📊 Excel clientes", callback_data: "cli:excel:general" }, { text: "📒 Agenda simple", callback_data: "cli:txt:agenda" }],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuRenovaciones(chatId) {
  return upsertPanel(chatId,
    "📅 *RENOVACIONES*\n\nSeleccione una opción:", [
    [{ text: "📋 Ver renovaciones hoy", callback_data: "ren:hoy" }, { text: "📄 TXT de hoy", callback_data: "txt:hoy" }],
    [{ text: "📤 Enviar TXT a vendedores", callback_data: "txt:todos:hoy" }, { text: "⬅️ Volver CRM", callback_data: "menu:clientes" }],
    [{ text: "⬅️ Volver CRM", callback_data: "menu:clientes" }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuPagos(chatId) {
  return upsertPanel(chatId,
    "💰 *FINANZAS*\n\nSeleccione una opción:", [
    [{ text: "➕ Registrar ingreso", callback_data: "fin:menu:ingreso" }, { text: "➖ Registrar egreso", callback_data: "fin:menu:egreso" }],
    [{ text: "📒 Ver registro", callback_data: "fin:menu:registro" }, { text: "🗑️ Eliminar movimiento", callback_data: "fin:menu:eliminar" }],
    [{ text: "📊 Reportes", callback_data: "fin:menu:reportes" }, { text: "🧾 Cierre de caja", callback_data: "fin:menu:cierre" }],
    [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuAlertas(chatId) {
  return upsertPanel(chatId,
    "🚨 *ALERTAS*\n\nSeleccione una opción:", [
    [{ text: "🔴 Clientes vencidos", callback_data: "alert:vencidos:0" }, { text: "🟠 Vencen hoy", callback_data: "alert:hoy:0" }],
    [{ text: "⚡ Renov. masiva vencidos", callback_data: "masivo:start" }, { text: "⚡ Renov. masiva hoy", callback_data: "masivo:start:hoy" }],
    [{ text: "🟡 Vencen en 3 días", callback_data: "alert:3dias:0" }, { text: "📦 Inventario crítico", callback_data: "alert:inventario:0" }],
    [{ text: "📄 TXT alertas del día", callback_data: "alert:txt:hoy" }, { text: "⬅️ Volver", callback_data: "go:inicio" }],
    [{ text: "⬅️ Volver", callback_data: "go:inicio" }],
  ]);
}

async function menuFinRegistro(chatId) {
  return upsertPanel(chatId,
    "📒 *REGISTRO DE FINANZAS*\n\nSeleccione una opción:", [
    [{ text: "➕ Registrar ingreso", callback_data: "fin:menu:ingreso" }, { text: "➖ Registrar egreso", callback_data: "fin:menu:egreso" }],
    [{ text: "🗑️ Eliminar Movimiento", callback_data: "fin:menu:eliminar" }, { text: "🧾 Cierre de Caja", callback_data: "fin:menu:cierre" }],
    [{ text: "📊 Reportes", callback_data: "fin:menu:reportes" }, { text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }],
    [{ text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuFinEliminarTipo(chatId) {
  return upsertPanel(chatId,
    "🗑️ *ELIMINAR MOVIMIENTO*\n\nSeleccione qué desea buscar:", [
    [{ text: "➕ Buscar ingresos", callback_data: "fin:menu:eliminar:ingreso" }, { text: "➖ Buscar egresos", callback_data: "fin:menu:eliminar:egreso" }],
    [{ text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

async function menuFinReportes(chatId) {
  return upsertPanel(chatId,
    "📊 *REPORTES DE FINANZAS*\n\nSeleccione una opción:", [
    [{ text: "📅 Resumen por fecha", callback_data: "fin:menu:resumen_fecha" }, { text: "🗓️ Resumen por rango", callback_data: "fin:menu:resumen_rango" }],
    [{ text: "🏦 Bancos por fecha", callback_data: "fin:menu:bancos_fecha" }, { text: "🏦 Bancos por rango", callback_data: "fin:menu:bancos_rango" }],
    [{ text: "🔍 Detalle por banco", callback_data: "fin:menu:detalle_banco" }, { text: "🏆 Top plataformas", callback_data: "fin:menu:top_plataformas" }],
    [{ text: "🎯 Top combos", callback_data: "fin:menu:top_combos" }, { text: "📤 Excel por rango", callback_data: "fin:menu:excel_rango" }],
    [{ text: "🧾 Cierre por rango", callback_data: "fin:menu:cierre:rango" }, { text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }],
    [{ text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

// ===============================
// KEYBOARDS FINANZAS
// ===============================
function kbBancosFinanzas() { const buttons = FIN_BANCOS_LOCAL.map((b) => ({ text: String(b), callback_data: `fin:ing:banco:${encodeURIComponent(String(b))}` })); const rows = pairButtons(buttons); rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]); return { inline_keyboard: rows }; }
function kbBancosFinanzasEgreso() { const buttons = FIN_BANCOS_LOCAL.map((b) => ({ text: String(b), callback_data: `fin:egr:banco:${encodeURIComponent(String(b))}` })); const rows = pairButtons(buttons); rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]); return { inline_keyboard: rows }; }
function kbMotivosFinanzas() { const buttons = FIN_MOTIVOS_EGRESO_LOCAL.map((m) => ({ text: String(m), callback_data: `fin:egr:motivo:${encodeURIComponent(String(m))}` })); const rows = pairButtons(buttons); rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]); return { inline_keyboard: rows }; }

// ===============================
// CRUD FINANZAS
// ===============================
async function registrarIngresoTx({ monto, banco = "", plataforma = "", detalle = "", fecha = "", userId = "", userName = "" }) {
  const fechaOk = parseFechaFlexible(fecha || hoyDMY());
  if (!fechaOk) throw new Error("Fecha inválida");
  const montoOk = Number(monto || 0);
  if (!Number.isFinite(montoOk) || montoOk <= 0) throw new Error("Monto inválido");
  const mesKey = monthKeyFromDMYLocal(fechaOk);
  const docId = db.collection(FINANCE_COLLECTION_PRIMARY).doc().id;
  const payload = { tipo: "ingreso", monto: montoOk, banco: humanBanco(String(banco || "").trim()), plataforma: String(plataforma || "").trim(), detalle: String(detalle || "").trim(), fecha: fechaOk, fechaTS: dmyToTimestamp(fechaOk), mesKey, monthKey: mesKey, userId: String(userId || ""), userName: String(userName || ""), createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  await saveFinancePayload(docId, payload);
  return { id: docId, ...payload };
}

async function registrarEgresoTx({ monto, banco = "", motivo = "", detalle = "", fecha = "", userId = "", userName = "" }) {
  const fechaOk = parseFechaFlexible(fecha || hoyDMY());
  if (!fechaOk) throw new Error("Fecha inválida");
  const montoOk = Number(monto || 0);
  if (!Number.isFinite(montoOk) || montoOk <= 0) throw new Error("Monto inválido");
  const mesKey = monthKeyFromDMYLocal(fechaOk);
  const docId = db.collection(FINANCE_COLLECTION_PRIMARY).doc().id;
  const payload = { tipo: "egreso", monto: montoOk, banco: humanBanco(String(banco || "").trim()), motivo: String(motivo || "").trim(), detalle: String(detalle || "").trim(), fecha: fechaOk, fechaTS: dmyToTimestamp(fechaOk), mesKey, monthKey: mesKey, userId: String(userId || ""), userName: String(userName || ""), createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  await saveFinancePayload(docId, payload);
  return { id: docId, ...payload };
}

async function getMovimientoFinanzaById(id) {
  const found = await getFinanceDocByIdAny(id);
  return found ? { ...found.row, fecha: extraerFechaMovimiento(found.row) || found.row.fecha || "" } : null;
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
    if (fechaAlt !== fecha) addRowsDedup(map, await queryDocsByFieldEq(col, "fecha", fechaAlt));
    if (range) addRowsDedup(map, await queryDocsByFieldRange(col, "fechaTS", range.iniTs, range.finTs));
  }
  let rows = Array.from(map.values()).map((r) => ({ ...r, fecha: extraerFechaMovimiento(r) || r.fecha || "" })).filter((r) => normalizeDMY(String(r.fecha || "")) === fecha).sort((a, b) => dmyToMillis(b.fecha||"") - dmyToMillis(a.fecha||""));
  if (!rows.length) rows = await scanFinanceDocsFallbackByDate(fecha);
  return rows;
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
    if (alt) { addRowsDedup(map, await queryDocsByFieldEq(col, "mesKey", alt)); addRowsDedup(map, await queryDocsByFieldEq(col, "monthKey", alt)); }
    if (range) addRowsDedup(map, await queryDocsByFieldRange(col, "fechaTS", range.iniTs, range.finTs));
    if (bounds) addRowsDedup(map, await queryDocsByFieldRange(col, "fecha", bounds.ini, bounds.fin));
  }
  let rows = Array.from(map.values()).map((r) => { const fechaReal = extraerFechaMovimiento(r) || r.fecha || ""; const mesReal = monthKeyFromDMYLocal(fechaReal); return { ...r, fecha: fechaReal, mesKey: normalizeMonthKey(r.mesKey || mesReal || ""), monthKey: normalizeMonthKey(r.monthKey || mesReal || "") }; }).filter((r) => { const mes = normalizeMonthKey(r.mesKey || r.monthKey || monthKeyFromDMYLocal(r.fecha || "")); return mes === key; }).sort((a, b) => dmyToMillis(b.fecha||"") - dmyToMillis(a.fecha||""));
  if (!rows.length && bounds) rows = await scanFinanceDocsFallbackByRange(bounds.ini, bounds.fin);
  return rows;
}

async function getMovimientosPorRango(fechaInicio, fechaFin, _userId = null, _isSuper = false) {
  const ini = normalizeDMY(fechaInicio), fin = normalizeDMY(fechaFin);
  if (!ini || !fin) return [];
  let iniMs = dmyToMillis(ini), finMs = dmyToMillis(fin);
  if (iniMs > finMs) { const temp = iniMs; iniMs = finMs; finMs = temp; }
  const iniDate = new Date(iniMs), finDate = new Date(finMs);
  const iniTs = admin.firestore.Timestamp.fromDate(new Date(iniDate.getFullYear(), iniDate.getMonth(), iniDate.getDate(), 0, 0, 0, 0));
  const finTs = admin.firestore.Timestamp.fromDate(new Date(finDate.getFullYear(), finDate.getMonth(), finDate.getDate(), 23, 59, 59, 999));
  const monthKeys = monthsBetweenDMY(ini, fin);
  const map = new Map();
  for (const col of FINANCE_COLLECTIONS_READ) {
    addRowsDedup(map, await queryDocsByFieldRange(col, "fechaTS", iniTs, finTs));
    for (const mk of monthKeys) { const bounds = getMonthBoundsDMY(mk); if (!bounds) continue; addRowsDedup(map, await queryDocsByFieldRange(col, "fecha", bounds.ini, bounds.fin)); }
  }
  let rows = Array.from(map.values()).map((r) => ({ ...r, fecha: extraerFechaMovimiento(r) || r.fecha || "" })).filter((r) => { const ts = dmyToMillis(String(r.fecha||"")); return ts >= iniMs && ts <= finMs; }).sort((a, b) => dmyToMillis(a.fecha||"") - dmyToMillis(b.fecha||""));
  if (!rows.length) rows = await scanFinanceDocsFallbackByRange(ini, fin);
  return rows;
}

async function eliminarMovimientoFinanzas(id, _userId = null, _isSuper = false) {
  const mov = await getMovimientoFinanzaById(id);
  if (!mov) throw new Error("Movimiento no encontrado.");
  await deleteFinanceDocAny(String(id));
  return mov;
}

// ===============================
// RESÚMENES
// ===============================
function resumenFinanzasTextoPorFecha(fecha, list = []) {
  const rows = Array.isArray(list) ? list : [];
  let ingresos = 0, egresos = 0;
  for (const r of rows) { const monto = Number(r.monto || 0); if (String(r.tipo||"").toLowerCase() === "egreso") egresos += monto; else ingresos += monto; }
  const utilidad = ingresos - egresos;
  let txt = `📅 RESUMEN DEL ${String(fecha || "")}\n\nIngresos: ${moneyLps(ingresos)}\nEgresos: ${moneyLps(egresos)}\nUtilidad: ${moneyLps(utilidad)}\nMovimientos: ${String(rows.length)}\n`;
  if (rows.length) { txt += `\nDetalle:\n`; txt += rows.slice(0, 20).map((r, i) => `${i+1}. ${String(r.tipo||"").toLowerCase()==="egreso"?"➖":"➕"} ${textoMovimientoParaEliminar(r)}`).join("\n"); }
  return txt;
}

function resumenBancosMesTexto(monthKey, list = []) { const label = monthLabelFromKeyLocal(monthKey); return resumenBancosRangoTexto(label, label, list).replace(`— ${label} al ${label}`, `— ${label}`); }
function resumenTopPlataformasTexto(monthKey, list = []) { return resumenTopPlataformasGenerico(monthLabelFromKeyLocal(monthKey), list); }

function cierreCajaTexto(fecha, list = []) {
  let ingresos = 0, egresos = 0;
  for (const m of Array.isArray(list) ? list : []) { const monto = Number(m.monto || 0); if (String(m.tipo||"").toLowerCase() === "egreso") egresos += monto; else ingresos += monto; }
  const utilidad = ingresos - egresos;
  const color = utilidad < 0 ? "🔴" : utilidad === 0 ? "🟡" : "🟢";
  return `🧾 CIERRE DE CAJA\n(${String(fecha || "")})\n\n💰 Entradas: ${moneyLps(ingresos)}\n💸 Salidas: ${moneyLps(egresos)}\n📦 Caja final: ${utilidad >= 0 ? "+" : ""}${moneyLps(utilidad)} ${color}\n🧮 Movimientos: ${Array.isArray(list) ? list.length : 0}`;
}

function cierreCajaTextoRango(fechaInicio, fechaFin, list = []) {
  let ingresos = 0, egresos = 0;
  for (const m of Array.isArray(list) ? list : []) { const monto = Number(m.monto || 0); if (String(m.tipo||"").toLowerCase() === "egreso") egresos += monto; else ingresos += monto; }
  const utilidad = ingresos - egresos;
  const color = utilidad < 0 ? "🔴" : utilidad === 0 ? "🟡" : "🟢";
  return `🧾 CIERRE DE CAJA\n(${String(fechaInicio || "")} al ${String(fechaFin || "")})\n\n💰 Entradas: ${moneyLps(ingresos)}\n💸 Salidas: ${moneyLps(egresos)}\n📦 Caja final: ${utilidad >= 0 ? "+" : ""}${moneyLps(utilidad)} ${color}\n🧮 Movimientos: ${Array.isArray(list) ? list.length : 0}`;
}

async function resumenFinancieroPorMonthKey(monthKey) {
  const rows = await getMovimientosPorMes(monthKey);
  let ingresos = 0, egresos = 0;
  const top = {};
  for (const r of rows) {
    const monto = Number(r.monto || 0);
    if (String(r.tipo||"").toLowerCase() === "egreso") egresos += monto;
    else { ingresos += monto; const key = String(r.plataforma || "").trim().toLowerCase(); if (key) top[key] = (top[key] || 0) + monto; }
  }
  const utilidad = ingresos - egresos;
  const topOrdenado = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([plataforma, total]) => ({ plataforma, total }));
  return { ingresos, egresos, utilidad, totalMovimientos: rows.length, topOrdenado, rows };
}

// ===============================
// ✅ DASHBOARD EJECUTIVO
// ===============================
async function generarDashboard(chatId) {
  try {
    await bot.sendMessage(chatId, "⏳ Calculando dashboard...");
    const hoy = hoyDMY();
    const [dd, mm, yyyy] = hoy.split("/");
    const mesActualKey = `${yyyy}-${String(mm).padStart(2, "0")}`;
    const dMesAnt = new Date(Number(yyyy), Number(mm) - 2, 1);
    const mesAnteriorKey = `${dMesAnt.getFullYear()}-${String(dMesAnt.getMonth() + 1).padStart(2, "0")}`;
    let resMesActual = { ingresos: 0, egresos: 0, utilidad: 0, topOrdenado: [] };
    let resMesAnterior = { ingresos: 0, egresos: 0, utilidad: 0, topOrdenado: [] };
    try { [resMesActual, resMesAnterior] = await Promise.all([resumenFinancieroPorMonthKey(mesActualKey), resumenFinancieroPorMonthKey(mesAnteriorKey)]); } catch (e) { logErr("dashboard.finanzas", e); }
    let clientes = [];
    try { const snapClientes = await db.collection("clientes").get(); clientes = snapClientes.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })); } catch (e) { logErr("dashboard.clientes", e); }
    const totalClientes = clientes.length;
    const hoyDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    const en7Dias = new Date(hoyDate.getTime()); en7Dias.setDate(en7Dias.getDate() + 7);
    let renovacionesSemana = 0;
    const ingresoPorVendedor = {};
    for (const c of clientes) {
      const vendedor = String(c.vendedor || "Sin vendedor").trim();
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      for (const s of servicios) {
        const fecha = String(s.fechaRenovacion || "").trim();
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) continue;
        const [fdd, fmm, fyyyy] = fecha.split("/");
        const fechaDate = new Date(Number(fyyyy), Number(fmm) - 1, Number(fdd));
        if (fechaDate >= hoyDate && fechaDate <= en7Dias) renovacionesSemana++;
        const precio = Number(s.precio || 0);
        if (!ingresoPorVendedor[vendedor]) ingresoPorVendedor[vendedor] = 0;
        ingresoPorVendedor[vendedor] += precio;
      }
    }
    const topVendedor = Object.entries(ingresoPorVendedor).sort((a, b) => b[1] - a[1])[0];
    const varIngresos = resMesActual.ingresos - resMesAnterior.ingresos;
    const varPct = resMesAnterior.ingresos > 0 ? ((varIngresos / resMesAnterior.ingresos) * 100).toFixed(1) : null;
    const varEmoji = varIngresos >= 0 ? "📈" : "📉";
    const labelActual = monthLabelFromKeyLocal(mesActualKey);
    const labelAnterior = monthLabelFromKeyLocal(mesAnteriorKey);
    const fmt = (n) => `${Number(n || 0).toFixed(2)} Lps`;
    let txt = ` *DASHBOARD EJECUTIVO*\n📅 ${escMD(hoy)}\n\n`;
    txt += `💰 *FINANZAS — ${escMD(labelActual)}*\n`;
    txt += `Ingresos: ${escMD(fmt(resMesActual.ingresos))}\n`;
    txt += `Egresos: ${escMD(fmt(resMesActual.egresos))}\n`;
    txt += `Utilidad: ${escMD(fmt(resMesActual.utilidad))}\n`;
    txt += `vs ${escMD(labelAnterior)}: ${varEmoji} ${varPct !== null ? `${varPct}%` : "Sin datos anteriores"}\n\n`;
    txt += `Perfiles: *CLIENTES*\n`;
    txt += `Total: ${escMD(String(totalClientes))}\n`;
    txt += `Renovaciones próximos 7 días: ${escMD(String(renovacionesSemana))}\n\n`;
    if (topVendedor) { txt += `🏆 *TOP VENDEDOR*\n`; txt += `${escMD(topVendedor[0])}: ${escMD(fmt(topVendedor[1]))} en cartera\n\n`; }
    if (Array.isArray(resMesActual.topOrdenado) && resMesActual.topOrdenado.length) {
      txt += ` *TOP PLATAFORMAS (${escMD(labelActual)})*\n`;
      resMesActual.topOrdenado.slice(0, 5).forEach((x, i) => { txt += `${i + 1}. ${escMD(humanPlatSafe(x.plataforma))} — ${escMD(fmt(x.total))}\n`; });
    }
    return upsertPanel(chatId, txt, [
      [{ text: "📊 Reporte Excel", callback_data: "fin:menu:excel_rango" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ]);
  } catch (e) { logErr("generarDashboard", e); return bot.sendMessage(chatId, `⚠️ Error en dashboard: ${e?.message || "desconocido"}`); }
}

// ===============================
// ✅ RECORDATORIOS 11AM — DÍA ANTERIOR
// Envía a admins y vendedores las renovaciones de mañana a las 11AM
// Así tienen tiempo de avisar a sus clientes durante el día
// ===============================
async function enviarRecordatorios11AM() {
  try {
    const hoy = hoyDMY();
    const [dd, mm, yyyy] = hoy.split("/");
    const mananaDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd) + 1);
    const manana = `${String(mananaDate.getDate()).padStart(2,"0")}/${String(mananaDate.getMonth()+1).padStart(2,"0")}/${mananaDate.getFullYear()}`;

    // Admins activos
    const snapAdmins = await db.collection("admins").get();
    const adminIds = [];
    snapAdmins.forEach((d) => {
      const data = d.data() || {};
      if (data.activo === false) return;
      const tg = String(data.telegramId || data.userId || d.id || "").trim();
      if (tg) adminIds.push(tg);
    });

    // Renovaciones de mañana — todas (para admins)
    const rowsMananaGlobal = await obtenerRenovacionesPorFecha(manana, null);

    for (const adminId of adminIds) {
      try {
        if (!rowsMananaGlobal.length) continue;
        let msg = `🔔 *RECORDATORIO: Renovaciones de mañana (${escMD(manana)})*\n\n`;
        msg += `*Total:* ${rowsMananaGlobal.length} perfil(es)\n\n`;
        rowsMananaGlobal.slice(0, 20).forEach((x, i) => {
          msg += `${i + 1}. ${escMD(x.nombrePerfil || "Sin nombre")} — ${escMD(humanPlatSafe(x.plataforma || ""))} — ${escMD(moneyLps(x.precio))}\n`;
        });
        if (rowsMananaGlobal.length > 20) msg += `\n_...y ${rowsMananaGlobal.length - 20} más._`;
        await bot.sendMessage(adminId, msg, { parse_mode: "Markdown" });
      } catch (e) { logErr(`recordatorio11AM:admin:${adminId}`, e); }
    }

    // Notificación filtrada por vendedor
    const snapRev = await db.collection("revendedores").get();
    for (const d of snapRev.docs) {
      const rev = d.data() || {};
      if (!rev.activo || !rev.telegramId || !rev.nombre) continue;
      try {
        const rowsVend = await obtenerRenovacionesPorFecha(manana, rev.nombre);
        if (!rowsVend.length) continue;
        let msg = `🔔 *RECORDATORIO: Tus renovaciones de mañana (${escMD(manana)})*\n\n`;
        msg += `*Total:* ${rowsVend.length} perfil(es)\n\n`;
        rowsVend.forEach((x, i) => {
          msg += `${i + 1}. ${escMD(x.nombrePerfil || "Sin nombre")}\n`;
          msg += `   📱 ${escMD(x.telefono || "-")}\n`;
          msg += `   📦 ${escMD(humanPlatSafe(x.plataforma || ""))}\n`;
          msg += `   💰 ${escMD(moneyLps(x.precio))}\n\n`;
        });
        await bot.sendMessage(rev.telegramId, msg, { parse_mode: "Markdown" });
      } catch (e) { logErr(`recordatorio11AM:rev:${rev.nombre}`, e); }
    }

    console.log(`✅ Recordatorios 11AM enviados para renovaciones del ${manana}`);
  } catch (e) {
    logErr("enviarRecordatorios11AM", e);
  }
}

// ===============================
// ✅ BACKUP DOMINICAL — DOMINGO 9PM
// ===============================
async function ejecutarBackupDominical() {
  try {
    const hoy = hoyDMY();
    const [, mm, yyyy] = hoy.split("/");
    const mesKey = `${yyyy}-${String(mm).padStart(2, "0")}`;
    const label = monthLabelFromKeyLocal(mesKey);
    console.log(`🗄️ Iniciando backup dominical — ${hoy}`);
    const rows = await getMovimientosPorMes(mesKey);
    let ingresos = 0, egresos = 0;
    for (const r of rows) { const monto = Number(r.monto || 0); if (String(r.tipo || "").toLowerCase() === "egreso") egresos += monto; else ingresos += monto; }
    const snapClientes = await db.collection("clientes").get();
    const clientes = snapClientes.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const wb = new ExcelJS.Workbook();
    wb.creator = "Sublicuentas Bot"; wb.created = new Date();
    const wsFinanzas = wb.addWorksheet(`Finanzas ${label}`);
    wsFinanzas.columns = [
      { header: "Fecha", key: "fecha", width: 14 }, { header: "Tipo", key: "tipo", width: 10 },
      { header: "Monto", key: "monto", width: 14 }, { header: "Plataforma/Motivo", key: "concepto", width: 28 },
      { header: "Banco", key: "banco", width: 20 }, { header: "Detalle", key: "detalle", width: 30 },
    ];
    for (const r of rows) { wsFinanzas.addRow({ fecha: r.fecha || "", tipo: finTipoLabel(r.tipo), monto: Number(r.monto || 0), concepto: finConceptoLabel(r), banco: humanBanco(r.banco || r.metodo || ""), detalle: r.detalle || "" }); }
    wsFinanzas.getRow(1).font = { bold: true }; wsFinanzas.views = [{ state: "frozen", ySplit: 1 }];
    const wsClientes = wb.addWorksheet("Clientes");
    wsClientes.columns = [
      { header: "Nombre", key: "nombre", width: 28 }, { header: "Teléfono", key: "telefono", width: 16 },
      { header: "Vendedor", key: "vendedor", width: 20 }, { header: "Servicios activos", key: "servicios", width: 16 },
      { header: "Total mensual", key: "total", width: 16 }, { header: "Próx. renovación", key: "proxima", width: 18 },
    ];
    for (const c of clientes) {
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      let total = 0, proxima = "", proximaTs = Infinity;
      for (const s of servicios) {
        total += Number(s.precio || 0);
        const f = String(s.fechaRenovacion || "").trim();
        if (f) { const [fdd, fmm, fyyyy] = f.split("/"); const ts = new Date(Number(fyyyy), Number(fmm) - 1, Number(fdd)).getTime(); if (ts < proximaTs) { proximaTs = ts; proxima = f; } }
      }
      wsClientes.addRow({ nombre: c.nombrePerfil || "", telefono: c.telefono || "", vendedor: c.vendedor || "", servicios: servicios.length, total, proxima });
    }
    wsClientes.getRow(1).font = { bold: true }; wsClientes.views = [{ state: "frozen", ySplit: 1 }];
    const tempPath = `/tmp/backup_dominical_${hoy.replace(/\//g, "-")}.xlsx`;
    await wb.xlsx.writeFile(tempPath);
    const resumenMsg =
      `🗄️ *BACKUP DOMINICAL — ${escMD(hoy)}*\n\n` +
      `📊 *Finanzas ${escMD(label)}*\n` +
      `Ingresos: ${escMD(moneyLps(ingresos))}\n` +
      `Egresos: ${escMD(moneyLps(egresos))}\n` +
      `Utilidad: ${escMD(moneyLps(ingresos - egresos))}\n` +
      `Movimientos: ${rows.length}\n\n` +
      `👥 *Clientes*: ${clientes.length} registrados\n\n` +
      `_El archivo Excel contiene todas las finanzas del mes y la lista completa de clientes._`;
    const snapAdmins = await db.collection("admins").get();
    let enviados = 0;
    for (const d of snapAdmins.docs) {
      const data = d.data() || {};
      if (data.activo === false) continue;
      const tg = String(data.telegramId || data.userId || d.id || "").trim();
      if (!tg) continue;
      try { await bot.sendMessage(tg, resumenMsg, { parse_mode: "Markdown" }); await bot.sendDocument(tg, tempPath, { caption: ` Backup ${hoy}` }); enviados++; } catch (e) { logErr(`backup:admin:${tg}`, e); }
    }
    try { fs.unlinkSync(tempPath); } catch (_) {}
    console.log(`✅ Backup dominical enviado a ${enviados} admin(s) — ${hoy}`);
  } catch (e) { logErr("ejecutarBackupDominical", e); }
}

// ===============================
// ✅ SCHEDULER
// - 11AM todos los días → recordatorio de renovaciones del día siguiente
// - Domingo 9PM → backup dominical con Excel
// ===============================
let _lastRecordatorio11AM = "";
let _lastBackupDominical = "";

function getTimePartsNowLocal() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("es-HN", {
    timeZone: String(process.env.TZ || "America/Tegucigalpa"),
    hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const obj = {};
  fmt.forEach((p) => { if (p.type !== "literal") obj[p.type] = p.value; });
  return {
    dmy: `${obj.day}/${obj.month}/${obj.year}`,
    hh: Number(obj.hour),
    mm: Number(obj.minute),
    weekday: String(obj.weekday || "").toLowerCase(),
  };
}

if (!global.__SUBLICUENTAS_SCHEDULER__) {
  global.__SUBLICUENTAS_SCHEDULER__ = true;

  setInterval(async () => {
    try {
      const { dmy, hh, mm, weekday } = getTimePartsNowLocal();

      // ✅ 11AM todos los días — recordatorio de renovaciones del día siguiente
      if (hh === 11 && mm === 0 && _lastRecordatorio11AM !== dmy) {
        _lastRecordatorio11AM = dmy;
        await enviarRecordatorios11AM();
      }

      // Domingo 9PM — backup dominical
      const esDomingo = weekday.startsWith("dom") || weekday === "sun" || weekday === "su";
      if (esDomingo && hh === 21 && mm === 0 && _lastBackupDominical !== dmy) {
        _lastBackupDominical = dmy;
        await ejecutarBackupDominical();
      }
    } catch (e) {
      logErr("scheduler", e);
    }
  }, 30 * 1000);

  console.log("⏰ Scheduler activo: recordatorio 11AM diario + backup dominical domingo 9PM");
}

// ===============================
// EXCEL RANGO
// ===============================
function applyHeaderStyle(row) { row.font = { bold: true, color: { argb: "FFFFFFFF" } }; row.alignment = { vertical: "middle", horizontal: "center" }; row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E78" } }; }
function applyMoneyFormat(cell) { cell.numFmt = "#,##0.00"; }
function autoBorderSheet(ws) { ws.eachRow((row) => { row.eachCell((cell) => { cell.border = { top: { style: "thin", color: { argb: "D9D9D9" } }, left: { style: "thin", color: { argb: "D9D9D9" } }, bottom: { style: "thin", color: { argb: "D9D9D9" } }, right: { style: "thin", color: { argb: "D9D9D9" } } }; if (!cell.alignment) cell.alignment = { vertical: "middle" }; }); }); }
function visualBar(value, maxValue) { const v = Math.max(0, Number(value||0)); const max = Math.max(1, Number(maxValue||1)); const blocks = Math.max(1, Math.round((v/max)*12)); return "█".repeat(blocks); }

function decorateFinanzasSheet(ws, rows = []) {
  applyHeaderStyle(ws.getRow(1));
  for (let i = 0; i < rows.length; i++) {
    const excelRow = ws.getRow(i + 2);
    const tipo = String(rows[i]?.tipo || "").toLowerCase();
    applyMoneyFormat(excelRow.getCell("C"));
    if (tipo === "ingreso") { excelRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E2F0D9" } }; }); excelRow.getCell("B").font = { bold: true, color: { argb: "008000" } }; }
    else if (tipo === "egreso") { excelRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FCE4D6" } }; }); excelRow.getCell("B").font = { bold: true, color: { argb: "C00000" } }; }
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: `G${Math.max(1, ws.rowCount)}` };
  autoBorderSheet(ws);
}

function decorateResumenSheet(resumen, meta = {}) {
  const { fechaInicio = "", fechaFin = "", label = "", ingresos = 0, egresos = 0, utilidad = 0, movimientos = 0 } = meta;
  resumen.columns = [{ header: "Concepto", key: "concepto", width: 24 }, { header: "Valor", key: "valor", width: 18 }, { header: "Visual", key: "visual", width: 18 }];
  applyHeaderStyle(resumen.getRow(1));
  if (label) resumen.addRow({ concepto: "Periodo", valor: label, visual: "" });
  if (fechaInicio) resumen.addRow({ concepto: "Fecha inicio", valor: fechaInicio, visual: "" });
  if (fechaFin) resumen.addRow({ concepto: "Fecha fin", valor: fechaFin, visual: "" });
  const maxBase = Math.max(Number(ingresos||0), Number(egresos||0), Math.abs(Number(utilidad||0)), 1);
  resumen.addRow({ concepto: "Ingresos", valor: Number(ingresos||0), visual: visualBar(ingresos, maxBase) });
  resumen.addRow({ concepto: "Egresos", valor: Number(egresos||0), visual: visualBar(egresos, maxBase) });
  resumen.addRow({ concepto: "Utilidad", valor: Number(utilidad||0), visual: visualBar(Math.abs(utilidad||0), maxBase) });
  resumen.addRow({ concepto: "Movimientos", valor: Number(movimientos||0), visual: "" });
  for (let i = 2; i <= resumen.rowCount; i++) {
    const row = resumen.getRow(i); const concepto = String(row.getCell("A").value || "");
    if (["Ingresos","Egresos","Utilidad","Movimientos"].includes(concepto)) row.font = { bold: true };
    if (concepto === "Ingresos") { row.getCell("A").font = { bold: true, color: { argb: "008000" } }; row.getCell("B").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E2F0D9" } }; applyMoneyFormat(row.getCell("B")); row.getCell("C").font = { color: { argb: "008000" } }; }
    if (concepto === "Egresos") { row.getCell("A").font = { bold: true, color: { argb: "C00000" } }; row.getCell("B").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FCE4D6" } }; applyMoneyFormat(row.getCell("B")); row.getCell("C").font = { color: { argb: "C00000" } }; }
    if (concepto === "Utilidad") { const positive = Number(utilidad||0) >= 0; row.getCell("A").font = { bold: true, color: { argb: positive ? "008000" : "C00000" } }; row.getCell("B").fill = { type: "pattern", pattern: "solid", fgColor: { argb: positive ? "E2F0D9" : "FCE4D6" } }; applyMoneyFormat(row.getCell("B")); row.getCell("C").font = { color: { argb: positive ? "008000" : "C00000" } }; }
  }
  resumen.views = [{ state: "frozen", ySplit: 1 }];
  autoBorderSheet(resumen);
}

async function exportarFinanzasRangoExcel(chatId, fechaInicio, fechaFin, _userId = null, _isSuper = false) {
  const ini = parseFechaFlexible(fechaInicio), fin = parseFechaFlexible(fechaFin);
  if (!ini || !fin) throw new Error("Fechas inválidas.");
  if (dmyToMillis(ini) > dmyToMillis(fin)) throw new Error("La fecha inicial no puede ser mayor a la final.");

  const safeName = (v = "") => String(v || "").replace(/\//g, "-").replace(/[^0-9A-Za-z_-]+/g, "_");
  const filename = `finanzas_${safeName(ini)}_${safeName(fin)}.xlsx`;
  const tempPath = `/tmp/${filename}`;

  try {
    await bot.sendMessage(chatId, "⏳ Generando Excel profesional nivel Saiyajin... espere un momento.");

    const { generarReporteExcelPorRango } = require("./index_10_reportes_excel");
    const rawBuffer = await generarReporteExcelPorRango(ini, fin);
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer || []);

    if (!buffer || buffer.length === 0) {
      await bot.sendMessage(chatId, "❌ Error al generar el archivo Excel.");
      return menuFinReportes(chatId);
    }

    // Enviar por ruta temporal evita errores de node-telegram-bot-api con Buffer/FormData.
    fs.writeFileSync(tempPath, buffer);

    await bot.sendDocument(
      chatId,
      tempPath,
      {
        caption:
          `📊 *Reporte financiero profesional*
` +
          `📅 Período: *${escMD(ini)}* al *${escMD(fin)}*

` +
          `✅ 5 hojas: Resumen, Ingresos, Egresos, Bancos y Gráficos
` +
          `✅ Filtros, fórmulas, barras visuales y formato Lps`,
        parse_mode: "Markdown",
      },
      {
        filename,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }
    );

    await bot.sendMessage(chatId, "✅ Excel generado correctamente.");
    return menuFinReportes(chatId);
  } catch (e) {
    logErr("exportarFinanzasRangoExcel", e);
    await bot.sendMessage(chatId, "❌ Error al generar Excel: " + (e?.message || e));
    return menuFinReportes(chatId);
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
  }
}

// ===============================
// COMPATIBILITY
// ===============================
async function listarMovimientosPorFechaYTipo(fechaDMY, tipo) {
  const rows = await getMovimientosPorFecha(fechaDMY);
  return rows.filter((x) => String(x.tipo||"").toLowerCase() === String(tipo||"").toLowerCase()).sort((a, b) => dmyToMillis(b.fecha||"") - dmyToMillis(a.fecha||""));
}

async function menuFinanzas(chatId) { return menuPagos(chatId); }
async function menuRegistroFinanzas(chatId) { return menuFinRegistro(chatId); }
async function menuEliminarMovimientoEspecifico(chatId) { return menuFinEliminarTipo(chatId); }
async function menuReportesFinanzas(chatId) { return menuFinReportes(chatId); }

// ===============================
// COMANDOS TELEGRAM — DESCARGAR EXCEL
// ===============================
// Importar función del nuevo módulo
const { generarReporteExcelPorRango } = require("./index_10_reportes_excel");

// ✅ Comando: /reportes_excel_rango 01/06/2026 30/06/2026
bot.onText(/^\/reportes_excel_rango\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const [, fechaInicio, fechaFin] = match;

  // Solo admin
  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, "❌ Solo admin puede descargar reportes");
  }

  try {
    await bot.sendMessage(chatId, "⏳ Generando Excel... espera");
    const buffer = await generarReporteExcelPorRango(fechaInicio, fechaFin);
    
    if (!buffer || buffer.length === 0) {
      return bot.sendMessage(chatId, "❌ Error al generar el archivo");
    }

    const filename = `reporte_${fechaInicio.replace(/\//g, "-")}_${fechaFin.replace(/\//g, "-")}.xlsx`;
    const tempPath = `/tmp/${filename}`;
    try {
      fs.writeFileSync(tempPath, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []));
      await bot.sendDocument(chatId, tempPath, {}, {
        filename,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    } finally {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    }

    await bot.sendMessage(chatId, `✅ Excel generado
📊 Período: ${fechaInicio} - ${fechaFin}
💾 Incluye: Resumen, Ingresos, Egresos, Bancos y Gráficos`);

  } catch (e) {
    logErr("reportes_excel_rango", e);
    bot.sendMessage(chatId, `❌ Error: ${e.message}`);
  }
});

// ✅ Comando: /reportes_excel_mes 06/2026
bot.onText(/^\/reportes_excel_mes\s+(\d{2}\/\d{4})$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const mesStr = match[1];

  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, "❌ Solo admin");
  }

  try {
    const [mes, año] = mesStr.split("/");
    const fechaInicio = `01/${mes}/${año}`;
    const ultimoDia = new Date(parseInt(año), parseInt(mes), 0).getDate();
    const fechaFin = `${String(ultimoDia).padStart(2, "0")}/${mes}/${año}`;

    await bot.sendMessage(chatId, "⏳ Generando Excel del mes...");
    const buffer = await generarReporteExcelPorRango(fechaInicio, fechaFin);

    const filename = `reporte_${año}-${mes}.xlsx`;
    const tempPath = `/tmp/${filename}`;
    try {
      fs.writeFileSync(tempPath, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []));
      await bot.sendDocument(chatId, tempPath, {}, {
        filename,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    } finally {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    }

    await bot.sendMessage(chatId, `✅ Reporte de ${mesStr} descargado`);
  } catch (e) {
    logErr("reportes_excel_mes", e);
    bot.sendMessage(chatId, `❌ Error: ${e.message}`);
  }
});

module.exports = {
  menuPrincipal, menuVendedor, menuInventario, menuInventarioVideo, menuInventarioMusica,
  menuInventarioIptv, menuInventarioDisenoIA, menuClientes, menuRenovaciones, menuPagos,
  menuAlertas, menuFinRegistro, menuFinEliminarTipo, menuFinReportes,
  kbBancosFinanzas, kbBancosFinanzasEgreso, kbMotivosFinanzas,
  registrarIngresoTx, registrarEgresoTx,
  getMovimientosPorFecha, getMovimientosPorMes, getMovimientosPorRango,
  resumenFinanzasTextoPorFecha, resumenFinanzasTextoPorRango, resumenBancosMesTexto,
  resumenBancosFechaTexto, resumenBancosRangoTexto, detalleBancoRangoTexto,
  resumenTopPlataformasTexto, resumenTopPlataformasRangoTexto, resumenTopCombosRangoTexto,
  cierreCajaTexto, cierreCajaTextoRango, textoConfirmarEliminacionMovimiento,
  exportarFinanzasRangoExcel, eliminarMovimientoFinanzas,
  getMovimientoFinanzaById, textoMovimientoParaEliminar,
  resumenFinancieroPorMonthKey, listarMovimientosPorFechaYTipo,
  // ✅ v3: recordatorio renombrado a 11AM
  generarDashboard, enviarRecordatorios11AM, ejecutarBackupDominical,
  // compat
  menuFinanzas, menuRegistroFinanzas, menuEliminarMovimientoEspecifico, menuReportesFinanzas,
};
