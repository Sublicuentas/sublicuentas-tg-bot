/* ✅ SUBLICUENTAS — EXCEL CLIENTES NIVEL SAIYAJIN
   Reporte profesional para CRM / Clientes:
   - 5 hojas: Resumen, Clientes Vigentes, Clientes Top, Pagos y Servicios, Vendedores
   - KPI cards, barras visuales, filtros, freeze panes, fórmulas y formato Lps 1,234.56
   - Compatible con ExcelJS y Firestore del bot
*/

const { ExcelJS, db } = require("./index_01_core");

function logErr(scope = "error", err = "") {
  try { console.error(`❌ [${scope}]`, err?.stack || err?.message || err); } catch (_) {}
}

const C = {
  rojo: "FFE2231A",
  rojoOsc: "FFB71C1C",
  negro: "FF0A0A1A",
  grisOsc: "FF303039",
  gris: "FFF3F4F6",
  gris2: "FFE5E7EB",
  blanco: "FFFFFFFF",
  verde: "FF16A34A",
  verdeSuave: "FFE7F6EC",
  amarillo: "FFFFB300",
  naranja: "FFF97316",
  azul: "FF2563EB",
  cyan: "FF00B2EE",
  morado: "FF7C3AED",
};

const BORDER = {
  top: { style: "thin", color: { argb: "FFD1D5DB" } },
  left: { style: "thin", color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  right: { style: "thin", color: { argb: "FFD1D5DB" } },
};

const MONEY_FMT = '"Lps " #,##0.00';
const DATE_FMT = "dd/mm/yyyy";

function normTxt(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function onlyDigits(v = "") { return String(v || "").replace(/\D+/g, ""); }
function safe(v = "") { return String(v == null ? "" : v).trim(); }
function num(v = 0) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }

function toDate(value) {
  try {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value === "object" && Number.isFinite(value._seconds)) return new Date(value._seconds * 1000);
    if (typeof value === "object" && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value < 1e12 ? value * 1000 : value);

    const s = String(value || "").trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      let [, dd, mm, yy] = m;
      if (yy.length === 2) yy = "20" + yy;
      const d = new Date(Number(yy), Number(mm) - 1, Number(dd), 12, 0, 0, 0);
      return isNaN(d.getTime()) ? null : d;
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch (_) { return null; }
}

function dateToDMY(value) {
  const d = toDate(value);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function excelDate(value) {
  const d = toDate(value);
  if (!d) return "";
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function daysFromToday(value) {
  const d = toDate(value);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.ceil((end - today) / 86400000);
}

function estadoServicio(fecha) {
  const dias = daysFromToday(fecha);
  if (dias == null) return "Sin fecha";
  if (dias < 0) return "Vencido";
  if (dias === 0) return "Vence hoy";
  if (dias <= 3) return "Riesgo 3 días";
  return "Vigente";
}

function estadoCliente(servicios = []) {
  if (!Array.isArray(servicios) || servicios.length === 0) return "Sin servicios";
  const algunoVigente = servicios.some((s) => {
    const st = estadoServicio(s.fechaRenovacion || s.vencimiento || s.vence || s.fechaFin);
    return ["Vigente", "Vence hoy", "Riesgo 3 días"].includes(st);
  });
  return algunoVigente ? "Vigente" : "No vigente";
}

function plataformaLabel(v = "") {
  const k = normTxt(v).replace(/\s+/g, "");
  const map = {
    netflix: "Netflix", vipnetflix: "Netflix VIP", disneyp: "Disney Premium", disneys: "Disney Standard",
    hbomax: "HBO Max", primevideo: "Prime Video", paramount: "Paramount+", crunchyroll: "Crunchyroll",
    vix: "Vix", appletv: "Apple TV+", universal: "Universal+", spotify: "Spotify",
    youtube: "YouTube Premium", deezer: "Deezer", canva: "Canva", gemini: "Gemini", chatgpt: "ChatGPT",
    oleadatv1: "Oleada TV 1", oleadatv3: "Oleada TV 3", iptv1: "IPTV 1", iptv3: "IPTV 3", iptv4: "IPTV 4",
  };
  return map[k] || safe(v) || "Servicio";
}

function humanBar(value, max, length = 18) {
  const n = Math.abs(num(value));
  const m = Math.max(Math.abs(num(max)), 1);
  const blocks = Math.max(1, Math.round((n / m) * length));
  return "█".repeat(blocks) + "░".repeat(Math.max(0, length - blocks));
}

function pick(obj = {}, keys = []) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}

function normalizeClient(doc) {
  const c = doc || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const totalMensual = servicios.reduce((s, x) => s + num(x.precio || x.monto || x.total), 0) || num(c.total_mensual || c.totalMensual || c.total || c.pago || c.precio);

  const fechasRenov = servicios
    .map((s) => toDate(s.fechaRenovacion || s.vencimiento || s.vence || s.fechaFin))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const prox = fechasRenov.length ? fechasRenov[0] : null;

  const fechasAlta = [
    pick(c, ["fechaContratacion", "fecha_contratacion", "fechaRegistro", "fecha_registro", "fechaAlta", "fecha_alta", "fechaInicio", "fecha_inicio"]),
    c.createdAt,
    c.created_at,
    ...servicios.map((s) => pick(s, ["fechaContratacion", "fechaInicio", "fecha_inicio", "createdAt"])),
  ].map(toDate).filter(Boolean).sort((a, b) => a - b);

  return {
    id: c.id || "",
    nombre: safe(c.nombrePerfil || c.nombre || c.cliente || c.name || "Sin nombre"),
    telefono: safe(c.telefono || c.telefono_norm || c.celular || c.whatsapp || ""),
    telefonoDigits: onlyDigits(c.telefono || c.telefono_norm || c.celular || c.whatsapp || ""),
    email: safe(c.email || c.correo || ""),
    vendedor: safe(c.vendedor || c.revendedor || c.socio || "Sin vendedor"),
    vendedorNorm: normTxt(c.vendedor_norm || c.vendedor || c.revendedor || c.socio || "sin vendedor"),
    servicios,
    serviciosCount: servicios.length,
    totalMensual,
    fechaContratacion: fechasAlta[0] || null,
    proximaRenovacion: prox,
    estado: estadoCliente(servicios),
    raw: c,
  };
}

function buildServiceRows(clientes = []) {
  const out = [];
  clientes.forEach((c) => {
    if (!Array.isArray(c.servicios) || !c.servicios.length) {
      out.push({
        clienteId: c.id, nombre: c.nombre, telefono: c.telefono, vendedor: c.vendedor,
        plataforma: "Sin servicio", correo: "", pin: "", precio: 0, fecha: null, dias: null,
        estado: "Sin servicio", fechaContratacion: c.fechaContratacion,
      });
      return;
    }

    c.servicios.forEach((s, idx) => {
      const fecha = s.fechaRenovacion || s.vencimiento || s.vence || s.fechaFin || "";
      out.push({
        clienteId: c.id,
        servicioIndex: idx,
        nombre: c.nombre,
        telefono: c.telefono,
        vendedor: c.vendedor,
        plataforma: plataformaLabel(s.plataforma || s.servicio || s.nombre || ""),
        correo: safe(s.correo || s.usuario || s.ident || s.email || ""),
        pin: safe(s.pin || s.perfil || s.clavePerfil || ""),
        precio: num(s.precio || s.monto || s.total),
        fecha,
        fechaDate: toDate(fecha),
        dias: daysFromToday(fecha),
        estado: estadoServicio(fecha),
        fechaContratacion: toDate(s.fechaContratacion || s.fechaInicio || s.createdAt) || c.fechaContratacion,
      });
    });
  });
  return out;
}

async function obtenerTodosLosClientes() {
  try {
    const snap = await db.collection("clientes").get();
    return snap.docs.map((doc) => normalizeClient({ id: doc.id, ...(doc.data() || {}) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  } catch (e) {
    logErr("obtenerTodosLosClientes", e);
    return [];
  }
}

function setTitle(ws, text, cols) {
  const row = ws.addRow([text]);
  row.height = 30;
  row.getCell(1).font = { bold: true, size: 16, color: { argb: C.blanco } };
  row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rojo } };
  row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  ws.mergeCells(row.number, 1, row.number, cols);
}

function setSubTitle(ws, text, cols) {
  const row = ws.addRow([text]);
  row.height = 20;
  row.getCell(1).font = { italic: true, size: 10, color: { argb: C.grisOsc } };
  row.getCell(1).alignment = { horizontal: "center" };
  ws.mergeCells(row.number, 1, row.number, cols);
}

function styleHeader(row) {
  row.height = 23;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.blanco }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.negro } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER;
  });
}

function styleBodyRow(row, alt = false) {
  row.height = 21;
  row.eachCell((cell) => {
    cell.border = BORDER;
    cell.alignment = { vertical: "middle", wrapText: true };
    if (alt) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
  });
}

function statusStyle(cell, status) {
  const s = normTxt(status);
  if (s.includes("vigente") && !s.includes("no")) {
    cell.font = { bold: true, color: { argb: C.verde } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.verdeSuave } };
  } else if (s.includes("vence hoy") || s.includes("riesgo")) {
    cell.font = { bold: true, color: { argb: C.naranja } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3E0" } };
  } else if (s.includes("vencido") || s.includes("no vigente")) {
    cell.font = { bold: true, color: { argb: C.rojoOsc } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE5E5" } };
  }
}

function applyCurrency(cell) {
  cell.numFmt = MONEY_FMT;
  cell.alignment = { horizontal: "right", vertical: "middle" };
}

function addTableFilter(ws, headerRow, lastRow, lastColLetter) {
  if (lastRow >= headerRow) {
    ws.autoFilter = { from: `A${headerRow}`, to: `${lastColLetter}${lastRow}` };
  }
  ws.views = [{ state: "frozen", ySplit: headerRow, activeCell: `A${headerRow + 1}` }];
}

function addKpi(ws, rowNo, col, label, value, color, fmt) {
  const labelCell = ws.getCell(rowNo, col);
  const valueCell = ws.getCell(rowNo + 1, col);
  labelCell.value = label;
  valueCell.value = value;
  labelCell.font = { bold: true, size: 10, color: { argb: C.blanco } };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  labelCell.alignment = { horizontal: "center", vertical: "middle" };
  valueCell.font = { bold: true, size: 16, color: { argb: color } };
  valueCell.alignment = { horizontal: "center", vertical: "middle" };
  valueCell.border = BORDER;
  labelCell.border = BORDER;
  if (fmt) valueCell.numFmt = fmt;
}

async function crearResumen(ws, clientes, servicios) {
  ws.columns = [
    { width: 4 }, { width: 26 }, { width: 18 }, { width: 22 }, { width: 24 }, { width: 18 }, { width: 22 }, { width: 28 },
  ];
  setTitle(ws, "SUBLICUENTAS — DASHBOARD CRM CLIENTES", 8);
  setSubTitle(ws, `Generado: ${new Date().toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}`, 8);
  ws.addRow([]);

  const vigentes = clientes.filter((c) => c.estado === "Vigente").length;
  const noVigentes = clientes.filter((c) => c.estado !== "Vigente").length;
  const totalMensual = clientes.reduce((s, c) => s + c.totalMensual, 0);
  const serviciosActivos = servicios.filter((s) => ["Vigente", "Vence hoy", "Riesgo 3 días"].includes(s.estado)).length;
  const venceHoy = servicios.filter((s) => s.estado === "Vence hoy").length;
  const riesgo3 = servicios.filter((s) => s.estado === "Riesgo 3 días").length;

  addKpi(ws, 4, 2, "👥 Clientes", clientes.length, C.rojo, "#,##0");
  addKpi(ws, 4, 3, "🟢 Vigentes", vigentes, C.verde, "#,##0");
  addKpi(ws, 4, 4, "🔴 No vigentes", noVigentes, C.rojoOsc, "#,##0");
  addKpi(ws, 4, 5, "💰 Pagos mensuales", totalMensual, C.azul, MONEY_FMT);
  addKpi(ws, 4, 6, "📦 Servicios activos", serviciosActivos, C.morado, "#,##0");
  addKpi(ws, 4, 7, "⚠️ Hoy / 3 días", `${venceHoy} / ${riesgo3}`, C.naranja, null);

  ws.addRow([]);
  ws.addRow([]);
  const chartStart = ws.rowCount + 1;
  const h = ws.addRow(["", "Indicador", "Total", "Visual"]);
  styleHeader(h);
  const maxCount = Math.max(clientes.length, servicios.length, 1);
  [
    ["Clientes vigentes", vigentes, C.verde, maxCount],
    ["Clientes no vigentes", noVigentes, C.rojoOsc, maxCount],
    ["Servicios activos", serviciosActivos, C.morado, maxCount],
    ["Vencen hoy", venceHoy, C.naranja, maxCount],
    ["Riesgo próximos 3 días", riesgo3, C.amarillo, maxCount],
  ].forEach(([label, value, color, max], i) => {
    const r = ws.addRow(["", label, value, humanBar(value, max, 22)]);
    styleBodyRow(r, i % 2 === 1);
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).font = { color: { argb: color }, bold: true };
  });

  ws.addRow([]);
  const topVendedores = groupByVendedor(clientes).slice(0, 8);
  const vh = ws.addRow(["", "Top vendedores", "Clientes", "Pagos", "Barra"]);
  styleHeader(vh);
  const maxVend = Math.max(...topVendedores.map((x) => x.total), 1);
  topVendedores.forEach((x, i) => {
    const medal = i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : "";
    const r = ws.addRow(["", medal + x.vendedor, x.clientes, x.total, humanBar(x.total, maxVend, 20)]);
    styleBodyRow(r, i % 2 === 1);
    applyCurrency(r.getCell(4));
    r.getCell(5).font = { color: { argb: C.verde }, bold: true };
  });

  ws.getCell(`B${chartStart}`).note = "Barras visuales hechas con caracteres para máxima compatibilidad en Telegram/ExcelJS.";
}

function groupByVendedor(clientes) {
  const map = new Map();
  clientes.forEach((c) => {
    const key = c.vendedor || "Sin vendedor";
    if (!map.has(key)) map.set(key, { vendedor: key, clientes: 0, servicios: 0, total: 0, vigentes: 0, noVigentes: 0 });
    const x = map.get(key);
    x.clientes += 1;
    x.servicios += c.serviciosCount;
    x.total += c.totalMensual;
    if (c.estado === "Vigente") x.vigentes += 1; else x.noVigentes += 1;
  });
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

async function crearClientesVigentes(ws, clientes) {
  ws.columns = [
    { width: 5 }, { width: 28 }, { width: 18 }, { width: 24 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 28 },
  ];
  setTitle(ws, "CLIENTES VIGENTES", 10);
  setSubTitle(ws, "Clientes con al menos un servicio activo, en riesgo o que vence hoy", 10);
  ws.addRow([]);
  const headerNo = ws.rowCount + 1;
  const header = ws.addRow(["#", "Nombre", "Número", "Vendedor", "Fecha contratación", "Próx. renovación", "Servicios", "Pago mensual", "Estado", "Notas"]);
  styleHeader(header);

  const rows = clientes.filter((c) => c.estado === "Vigente").sort((a, b) => b.totalMensual - a.totalMensual);
  rows.forEach((c, i) => {
    const r = ws.addRow([i + 1, c.nombre, c.telefono, c.vendedor, excelDate(c.fechaContratacion), excelDate(c.proximaRenovacion), c.serviciosCount, c.totalMensual, c.estado, ""]);
    styleBodyRow(r, i % 2 === 1);
    r.getCell(5).numFmt = DATE_FMT;
    r.getCell(6).numFmt = DATE_FMT;
    applyCurrency(r.getCell(8));
    statusStyle(r.getCell(9), c.estado);
  });
  addTableFilter(ws, headerNo, ws.rowCount, "J");
}

async function crearClientesTop(ws, clientes) {
  ws.columns = [
    { width: 8 }, { width: 28 }, { width: 18 }, { width: 22 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 24 },
  ];
  setTitle(ws, "CLIENTES TOP — RANKING POR PAGO MENSUAL", 9);
  setSubTitle(ws, "Ranking de clientes que más aportan a la cartera", 9);
  ws.addRow([]);
  const headerNo = ws.rowCount + 1;
  const header = ws.addRow(["Rank", "Nombre", "Número", "Vendedor", "Servicios", "Pago mensual", "Próx. renovación", "Estado", "Barra"]);
  styleHeader(header);

  const rows = clientes.slice().sort((a, b) => b.totalMensual - a.totalMensual);
  const maxPago = Math.max(...rows.map((c) => c.totalMensual), 1);
  rows.forEach((c, i) => {
    const medal = i === 0 ? "🥇 1" : i === 1 ? "🥈 2" : i === 2 ? "🥉 3" : String(i + 1);
    const r = ws.addRow([medal, c.nombre, c.telefono, c.vendedor, c.serviciosCount, c.totalMensual, excelDate(c.proximaRenovacion), c.estado, humanBar(c.totalMensual, maxPago, 20)]);
    styleBodyRow(r, i % 2 === 1);
    applyCurrency(r.getCell(6));
    r.getCell(7).numFmt = DATE_FMT;
    statusStyle(r.getCell(8), c.estado);
    r.getCell(9).font = { color: { argb: C.verde }, bold: true };
  });
  addTableFilter(ws, headerNo, ws.rowCount, "I");
}

async function crearPagosServicios(ws, servicios) {
  ws.columns = [
    { width: 5 }, { width: 26 }, { width: 17 }, { width: 22 }, { width: 20 }, { width: 30 }, { width: 12 }, { width: 14 }, { width: 15 }, { width: 12 }, { width: 16 }, { width: 18 },
  ];
  setTitle(ws, "PAGOS Y SERVICIOS", 12);
  setSubTitle(ws, "Detalle operativo: nombre, número, vendedor, servicio, acceso, pago y vencimiento", 12);
  ws.addRow([]);
  const headerNo = ws.rowCount + 1;
  const header = ws.addRow(["#", "Nombre", "Número", "Vendedor", "Plataforma", "Correo / usuario", "PIN", "Pago", "Vence", "Días", "Estado", "Contratación"]);
  styleHeader(header);

  const rows = servicios.slice().sort((a, b) => {
    const da = a.fechaDate ? a.fechaDate.getTime() : 9999999999999;
    const db = b.fechaDate ? b.fechaDate.getTime() : 9999999999999;
    return da - db;
  });
  rows.forEach((s, i) => {
    const r = ws.addRow([
      i + 1, s.nombre, s.telefono, s.vendedor, s.plataforma, s.correo, s.pin, s.precio,
      excelDate(s.fecha), s.dias == null ? "" : s.dias, s.estado, excelDate(s.fechaContratacion),
    ]);
    styleBodyRow(r, i % 2 === 1);
    applyCurrency(r.getCell(8));
    r.getCell(9).numFmt = DATE_FMT;
    r.getCell(12).numFmt = DATE_FMT;
    statusStyle(r.getCell(11), s.estado);
  });
  addTableFilter(ws, headerNo, ws.rowCount, "L");

  try {
    ws.addConditionalFormatting({
      ref: `H${headerNo + 1}:H${Math.max(headerNo + 1, ws.rowCount)}`,
      rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: C.verde.replace(/^FF/, "") }],
    });
  } catch (_) {}
}

async function crearVendedores(ws, clientes) {
  const rows = groupByVendedor(clientes);
  ws.columns = [
    { width: 5 }, { width: 26 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 24 },
  ];
  setTitle(ws, "ANÁLISIS POR VENDEDOR", 9);
  setSubTitle(ws, "Cartera, clientes vigentes y pagos por vendedor", 9);
  ws.addRow([]);
  const headerNo = ws.rowCount + 1;
  const header = ws.addRow(["#", "Vendedor", "Clientes", "Vigentes", "No vigentes", "Servicios", "Total mensual", "Promedio", "Barra"]);
  styleHeader(header);
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);

  rows.forEach((x, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1;
    const avg = x.clientes ? x.total / x.clientes : 0;
    const r = ws.addRow([medal, x.vendedor, x.clientes, x.vigentes, x.noVigentes, x.servicios, x.total, avg, humanBar(x.total, maxTotal, 20)]);
    styleBodyRow(r, i % 2 === 1);
    applyCurrency(r.getCell(7));
    applyCurrency(r.getCell(8));
    r.getCell(9).font = { color: { argb: C.azul }, bold: true };
  });
  addTableFilter(ws, headerNo, ws.rowCount, "I");
}

async function generarExcelClientesGeneral() {
  try {
    const clientes = await obtenerTodosLosClientes();
    if (!clientes.length) throw new Error("No hay clientes en Firestore");
    const servicios = buildServiceRows(clientes);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Sublicuentas";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.properties.date1904 = false;

    await crearResumen(workbook.addWorksheet("Resumen"), clientes, servicios);
    await crearClientesVigentes(workbook.addWorksheet("Clientes Vigentes"), clientes);
    await crearClientesTop(workbook.addWorksheet("Clientes Top"), clientes);
    await crearPagosServicios(workbook.addWorksheet("Pagos Servicios"), servicios);
    await crearVendedores(workbook.addWorksheet("Vendedores"), clientes);

    workbook.eachSheet((ws) => {
      ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
      ws.properties.defaultRowHeight = 18;
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = cell.font || { size: 10 };
        });
      });
    });

    return await workbook.xlsx.writeBuffer();
  } catch (e) {
    logErr("generarExcelClientesGeneral", e);
    throw e;
  }
}

module.exports = {
  generarExcelClientesGeneral,
  obtenerTodosLosClientes,
};
