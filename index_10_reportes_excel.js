/* ✅ SUBLICUENTAS — REPORTES EXCEL PROFESIONAL NIVEL SAIYAJIN
   ------------------------------------------------------------------
   Generador seguro para Telegram + ExcelJS.
   - 5 hojas: Resumen, Ingresos, Egresos, Bancos, Graficos
   - Barras visuales compatibles con ExcelJS (sin chart API inestable)
   - Fórmulas SUM / IF / REPT para totales y visuales dinámicos
   - Filtros automáticos, encabezados congelados, filas alternas
   - Formato moneda: Lps 1,234.56
*/

const {
  ExcelJS,
  db,
  FINANZAS_COLLECTION,
} = require("./index_01_core");

const FINANCE_COLLECTIONS_READ = Array.from(new Set([
  String(FINANZAS_COLLECTION || "").trim(),
  "finanzas_movimientos",
  "finanzas",
].filter(Boolean)));

const COLORS = {
  rojo: "FFE2231A",
  rojoOscuro: "FFB71C1C",
  negro: "FF0A0A1A",
  grisTitulo: "FF222222",
  grisClaro: "FFF4F6F8",
  grisMedio: "FFE7E9EF",
  blanco: "FFFFFFFF",
  verde: "FF16A34A",
  verdeClaro: "FFE6F4EA",
  rojoClaro: "FFFCE8E6",
  azul: "FF1D4ED8",
  azulClaro: "FFEFF6FF",
  dorado: "FFFFB300",
  morado: "FF6D28D9",
  naranja: "FFF97316",
};

const MONEY_FMT = '"Lps " #,##0.00';
const INT_FMT = '#,##0';
const PCT_FMT = '0.00%';

const BORDER_THIN = {
  top: { style: "thin", color: { argb: "FFD7DCE2" } },
  bottom: { style: "thin", color: { argb: "FFD7DCE2" } },
  left: { style: "thin", color: { argb: "FFD7DCE2" } },
  right: { style: "thin", color: { argb: "FFD7DCE2" } },
};

function logErr(scope = "error", err = "") {
  try { console.error(`❌ [${scope}]`, err?.stack || err?.message || err); } catch (_) {}
}

function safeText(v = "", fallback = "") {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s || fallback;
}

function normalizeDMY(input = "") {
  const s = String(input ?? "").trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const dd = String(Number(m[1])).padStart(2, "0");
    const mm = String(Number(m[2])).padStart(2, "0");
    const yyyy = String(Number(m[3])).padStart(4, "0");
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0);
    if (d.getFullYear() === Number(yyyy) && d.getMonth() === Number(mm) - 1 && d.getDate() === Number(dd)) {
      return `${dd}/${mm}/${yyyy}`;
    }
    return "";
  }

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const yyyy = String(Number(m[1])).padStart(4, "0");
    const mm = String(Number(m[2])).padStart(2, "0");
    const dd = String(Number(m[3])).padStart(2, "0");
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0);
    if (d.getFullYear() === Number(yyyy) && d.getMonth() === Number(mm) - 1 && d.getDate() === Number(dd)) {
      return `${dd}/${mm}/${yyyy}`;
    }
  }
  return "";
}

function dmyToMillis(dmy = "") {
  const v = normalizeDMY(dmy);
  if (!v) return 0;
  const [dd, mm, yyyy] = v.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0).getTime();
}

function dmyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function dateFromAny(v) {
  if (!v) return null;
  try {
    if (typeof v?.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v);
    if (typeof v === "object" && Number.isFinite(v._seconds)) return new Date(Number(v._seconds) * 1000);
    if (typeof v === "object" && Number.isFinite(v.seconds)) return new Date(Number(v.seconds) * 1000);
    const norm = normalizeDMY(String(v));
    if (norm) {
      const [dd, mm, yyyy] = norm.split("/").map(Number);
      return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
    }
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
  } catch (_) {
    return null;
  }
}

function extraerFechaMovimiento(data = {}) {
  return normalizeDMY(data.fecha || data.fecha_dmy || data.fechaMovimiento || data.date || "") ||
    dmyFromDate(dateFromAny(data.fechaTS || data.fecha_ts || data.createdAt || data.created_at || data.updatedAt || data.updated_at || data.timestamp || data.ts));
}

function normalizeTipo(data = {}) {
  const raw = safeText(data.tipo || data.type || data.movimiento || "ingreso").toLowerCase();
  if (raw.includes("egreso") || raw.includes("gasto") || raw.includes("salida")) return "egreso";
  return "ingreso";
}

function parseMonto(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "0").replace(/[^0-9.,-]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeMovimiento(id, data = {}, source = "") {
  const tipo = normalizeTipo(data);
  const fecha = extraerFechaMovimiento(data);
  const monto = Math.abs(parseMonto(data.monto ?? data.valor ?? data.amount ?? data.total));
  return {
    id: String(id || ""),
    source: String(source || ""),
    fecha,
    fechaTs: dmyToMillis(fecha),
    tipo,
    monto,
    banco: safeText(data.banco || data.metodo || data.cuenta || data.bank || "Sin banco"),
    plataforma: safeText(data.plataforma || data.servicio || data.producto || data.platform || "Sin plataforma"),
    motivo: safeText(data.motivo || data.concepto || data.descripcion || data.detalle || "Egreso"),
    detalle: safeText(data.detalle || data.descripcion || data.nota || data.observacion || ""),
    userName: safeText(data.userName || data.usuario || data.admin || data.creadoPor || data.createdBy || ""),
    raw: data,
  };
}

async function getMovimientosPorRango(fechaInicio, fechaFin) {
  const ini = normalizeDMY(fechaInicio);
  const fin = normalizeDMY(fechaFin);
  if (!ini || !fin) return [];

  const iniMs = dmyToMillis(ini);
  const finMs = dmyToMillis(fin) + 86399999;
  const byId = new Map();

  for (const col of FINANCE_COLLECTIONS_READ) {
    try {
      const snap = await db.collection(col).get();
      const docs = Array.isArray(snap?.docs) ? snap.docs : [];
      for (const doc of docs) {
        const row = normalizeMovimiento(doc.id, doc.data() || {}, col);
        if (!row.fecha || row.fechaTs < iniMs || row.fechaTs > finMs) continue;
        const key = String(doc.id || `${col}:${row.fecha}:${row.tipo}:${row.monto}:${row.banco}:${row.plataforma}`);
        if (!byId.has(key)) byId.set(key, row);
      }
    } catch (e) {
      logErr(`getMovimientosPorRango:${col}`, e);
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.fechaTs - b.fechaTs || a.tipo.localeCompare(b.tipo));
}

function setFill(cell, argb) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; }
function setFont(cell, opts = {}) { cell.font = { ...(cell.font || {}), ...opts }; }
function setBorder(cell) { cell.border = BORDER_THIN; }

function styleRow(row, opts = {}) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    setBorder(cell);
    cell.alignment = { vertical: "middle", ...(cell.alignment || {}) };
    if (opts.fill) setFill(cell, opts.fill);
    if (opts.font) cell.font = { ...(cell.font || {}), ...opts.font };
  });
}

function addTitle(ws, title, subtitle, lastCol) {
  ws.addRow([]);
  const titleRow = ws.addRow([title]);
  titleRow.height = 32;
  ws.mergeCells(titleRow.number, 1, titleRow.number, lastCol);
  const titleCell = titleRow.getCell(1);
  setFill(titleCell, COLORS.rojo);
  titleCell.font = { bold: true, size: 16, color: { argb: COLORS.blanco } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };

  const subRow = ws.addRow([subtitle]);
  subRow.height = 22;
  ws.mergeCells(subRow.number, 1, subRow.number, lastCol);
  const subCell = subRow.getCell(1);
  setFill(subCell, COLORS.negro);
  subCell.font = { bold: true, size: 10, color: { argb: COLORS.blanco } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.addRow([]);
}

function addHeader(ws, values) {
  const row = ws.addRow(values);
  row.height = 24;
  row.eachCell({ includeEmpty: true }, (cell) => {
    setFill(cell, COLORS.negro);
    cell.font = { bold: true, color: { argb: COLORS.blanco } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    setBorder(cell);
  });
  return row.number;
}

function formulaBar(valueCell, maxRange, minBlocks = 1, maxBlocks = 24) {
  return `IF(${valueCell}<=0,"",REPT("█",MAX(${minBlocks},ROUND(${valueCell}/MAX(${maxRange})*${maxBlocks},0))))`;
}

function applyMoney(cell) { cell.numFmt = MONEY_FMT; }
function applyInteger(cell) { cell.numFmt = INT_FMT; }
function applyPercent(cell) { cell.numFmt = PCT_FMT; }

function normalizeBanco(raw = "") {
  const s = safeText(raw, "Sin banco");
  const low = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (low.includes("bac")) return "BAC";
  if (low.includes("ficohsa")) return "Ficohsa";
  if (low.includes("atlantida")) return "Atlántida";
  if (low.includes("banpais")) return "Banpaís";
  if (low.includes("occidente")) return "Occidente";
  if (low.includes("davivienda")) return "Davivienda";
  if (low.includes("lafise")) return "Lafise";
  if (low.includes("tigo")) return "Tigo Money";
  if (low.includes("paypal")) return "PayPal";
  if (low.includes("binance")) return "Binance";
  if (low.includes("efectivo") || low.includes("cash")) return "Efectivo";
  if (low.includes("tengo")) return "Tengo";
  if (low.includes("transferencia")) return "Transferencia";
  return s;
}

function resumenPorBanco(rows = []) {
  const map = new Map();
  for (const m of rows) {
    const banco = normalizeBanco(m.banco);
    if (!map.has(banco)) map.set(banco, { banco, ingresos: 0, egresos: 0, movimientos: 0 });
    const row = map.get(banco);
    row.movimientos += 1;
    if (m.tipo === "egreso") row.egresos += Number(m.monto || 0);
    else row.ingresos += Number(m.monto || 0);
  }
  return Array.from(map.values())
    .map((x) => ({ ...x, neto: x.ingresos - x.egresos }))
    .sort((a, b) => b.neto - a.neto || b.ingresos - a.ingresos);
}

function resumenTopPlataformas(rows = []) {
  const map = new Map();
  for (const m of rows.filter((x) => x.tipo === "ingreso")) {
    const plat = safeText(m.plataforma, "Sin plataforma");
    if (!map.has(plat)) map.set(plat, { plataforma: plat, ingresos: 0, ventas: 0 });
    const row = map.get(plat);
    row.ingresos += Number(m.monto || 0);
    row.ventas += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.ingresos - a.ingresos || b.ventas - a.ventas);
}

function createResumenSheet(wb, meta) {
  const { ini, fin, ingresosTotal, egresosTotal, utilidad, margen, movimientos, ingTotalRow, egrTotalRow, topPlats, bancos } = meta;
  const ws = wb.addWorksheet("Resumen");
  ws.columns = [
    { width: 4 }, { width: 26 }, { width: 18 }, { width: 4 },
    { width: 26 }, { width: 18 }, { width: 4 }, { width: 32 },
  ];
  addTitle(ws, "SUBLICUENTAS — REPORTE FINANCIERO", `Período ${ini} al ${fin}`, 8);

  const cardRows = [
    ["💰 Total ingresos", { formula: `Ingresos!C${ingTotalRow}`, result: ingresosTotal }, COLORS.verde, MONEY_FMT],
    ["💸 Total egresos", { formula: `Egresos!C${egrTotalRow}`, result: egresosTotal }, COLORS.rojo, MONEY_FMT],
    ["📈 Utilidad neta", { formula: "C5-C6", result: utilidad }, utilidad >= 0 ? COLORS.verde : COLORS.rojoOscuro, MONEY_FMT],
    ["📊 Margen", { formula: "IF(C5=0,0,C7/C5)", result: margen }, COLORS.azul, PCT_FMT],
    ["🧾 Movimientos", movimientos, COLORS.morado, INT_FMT],
  ];

  cardRows.forEach(([label, value, color, fmt], i) => {
    const row = ws.addRow(["", label, value, "", i === 0 ? "Resumen ejecutivo" : "", i === 0 ? "Estado" : "", "", i === 0 ? "Visual" : ""]);
    row.height = 28;
    setFill(row.getCell(2), color);
    row.getCell(2).font = { bold: true, color: { argb: COLORS.blanco } };
    row.getCell(2).alignment = { vertical: "middle", indent: 1 };
    row.getCell(3).font = { bold: true, size: 13, color: { argb: color } };
    row.getCell(3).alignment = { horizontal: "right", vertical: "middle" };
    row.getCell(3).numFmt = fmt;
    if (i === 0) {
      setFill(row.getCell(5), COLORS.negro);
      setFill(row.getCell(6), COLORS.negro);
      setFill(row.getCell(8), COLORS.negro);
      [5, 6, 8].forEach((c) => { row.getCell(c).font = { bold: true, color: { argb: COLORS.blanco } }; row.getCell(c).alignment = { horizontal: "center" }; });
    }
    setBorder(row.getCell(2)); setBorder(row.getCell(3));
  });

  ws.addRow([]);
  const h = addHeader(ws, ["", "Comparativa", "Monto", "", "Indicador", "Valor", "", "Barra visual"]);
  const maxBase = Math.max(ingresosTotal, egresosTotal, Math.abs(utilidad), 1);
  const comparativa = [
    ["Ingresos", ingresosTotal, "Ventas cobradas", ingresosTotal, COLORS.verde],
    ["Egresos", egresosTotal, "Gastos registrados", egresosTotal, COLORS.rojo],
    ["Utilidad", utilidad, utilidad >= 0 ? "Ganancia" : "Pérdida", utilidad, utilidad >= 0 ? COLORS.verde : COLORS.rojo],
  ];
  comparativa.forEach(([label, amount, desc, value, color], idx) => {
    const r = ws.addRow(["", label, amount, "", desc, value, "", "█".repeat(Math.max(1, Math.round((Math.abs(Number(amount) || 0) / maxBase) * 26)))]);
    r.height = 22;
    [2, 3, 5, 6, 8].forEach((c) => setBorder(r.getCell(c)));
    r.getCell(2).font = { bold: true };
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(6).numFmt = MONEY_FMT;
    r.getCell(8).font = { color: { argb: color }, bold: true };
    if (idx % 2 === 1) [2, 3, 5, 6, 8].forEach((c) => setFill(r.getCell(c), COLORS.grisClaro));
  });

  ws.addRow([]);
  addHeader(ws, ["", "Top plataforma", "Ingresos", "", "Top banco", "Neto", "", "Alerta"]);
  for (let i = 0; i < Math.max(3, topPlats.slice(0, 5).length, bancos.slice(0, 5).length); i++) {
    const p = topPlats[i] || null;
    const b = bancos[i] || null;
    const r = ws.addRow([
      "",
      p ? `${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} ${p.plataforma}` : "—",
      p ? p.ingresos : 0,
      "",
      b ? b.banco : "—",
      b ? b.neto : 0,
      "",
      i === 0 ? (utilidad >= 0 ? "✅ Operación positiva" : "⚠️ Revisar egresos") : "",
    ]);
    [2, 3, 5, 6, 8].forEach((c) => setBorder(r.getCell(c)));
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(6).numFmt = MONEY_FMT;
    r.getCell(6).font = { bold: true, color: { argb: (b?.neto || 0) >= 0 ? COLORS.verde : COLORS.rojo } };
  }

  ws.views = [{ state: "frozen", ySplit: h }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

function createDetalleSheet(wb, sheetName, title, subtitle, rows, tipo) {
  const isIngreso = tipo === "ingreso";
  const color = isIngreso ? COLORS.verde : COLORS.rojo;
  const light = isIngreso ? COLORS.verdeClaro : COLORS.rojoClaro;
  const ws = wb.addWorksheet(sheetName);
  ws.columns = [
    { width: 13 }, { width: 26 }, { width: 15 }, { width: 18 },
    { width: 18 }, { width: 34 }, { width: 28 },
  ];
  addTitle(ws, title, subtitle, 7);
  const headerRow = addHeader(ws, ["Fecha", isIngreso ? "Plataforma" : "Motivo", "Monto", "Banco", "Usuario", "Detalle", "Barra visual"]);
  const firstDataRow = headerRow + 1;

  rows.forEach((m, i) => {
    const r = ws.addRow([
      m.fecha,
      isIngreso ? m.plataforma : m.motivo,
      Number(m.monto || 0),
      normalizeBanco(m.banco),
      m.userName || "—",
      m.detalle || "—",
      "",
    ]);
    r.height = 21;
    styleRow(r, { fill: i % 2 === 1 ? COLORS.grisClaro : undefined });
    r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(3).font = { bold: true, color: { argb: color } };
  });

  const lastDataRow = Math.max(firstDataRow, ws.rowCount);
  for (let rowNumber = firstDataRow; rowNumber <= ws.rowCount; rowNumber++) {
    const barCell = ws.getCell(`G${rowNumber}`);
    barCell.value = rows.length ? { formula: formulaBar(`$C${rowNumber}`, `$C$${firstDataRow}:$C$${lastDataRow}`), result: "" } : "";
    barCell.font = { bold: true, color: { argb: color } };
  }

  const totalRow = ws.addRow(["TOTAL", "", rows.length ? { formula: `SUM(C${firstDataRow}:C${lastDataRow})`, result: rows.reduce((s, x) => s + Number(x.monto || 0), 0) } : 0, "", `${rows.length} registros`, "", ""]);
  totalRow.height = 24;
  styleRow(totalRow, { fill: color, font: { bold: true, color: { argb: COLORS.blanco } } });
  totalRow.getCell(3).numFmt = MONEY_FMT;

  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastDataRow), column: 7 } };
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return { ws, totalRow: totalRow.number, firstDataRow, lastDataRow };
}

function createBancosSheet(wb, bancos, subtitle) {
  const ws = wb.addWorksheet("Bancos");
  ws.columns = [
    { width: 22 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 13 }, { width: 30 },
  ];
  addTitle(ws, "ANÁLISIS POR BANCOS", subtitle, 6);
  const headerRow = addHeader(ws, ["Banco", "Ingresos", "Egresos", "Neto", "Movs.", "Barra neta"]);
  const firstDataRow = headerRow + 1;

  bancos.forEach((b, i) => {
    const r = ws.addRow([b.banco, b.ingresos, b.egresos, b.neto, b.movimientos, ""]);
    r.height = 22;
    styleRow(r, { fill: i % 2 === 1 ? COLORS.grisClaro : undefined });
    [2, 3, 4].forEach((c) => r.getCell(c).numFmt = MONEY_FMT);
    r.getCell(4).font = { bold: true, color: { argb: b.neto >= 0 ? COLORS.verde : COLORS.rojo } };
    r.getCell(5).numFmt = INT_FMT;
  });

  const lastDataRow = Math.max(firstDataRow, ws.rowCount);
  const maxNetoAbs = Math.max(...bancos.map((x) => Math.abs(Number(x.neto || 0))), 1);
  for (let rowNumber = firstDataRow; rowNumber <= ws.rowCount; rowNumber++) {
    const netoVal = Number(ws.getCell(`D${rowNumber}`).value || 0);
    const barCell = ws.getCell(`F${rowNumber}`);
    barCell.value = bancos.length ? { formula: `IF($D${rowNumber}=0,"",REPT("█",MAX(1,ROUND(ABS($D${rowNumber})/${maxNetoAbs}*24,0))))`, result: "" } : "";
    barCell.font = { bold: true, color: { argb: netoVal >= 0 ? COLORS.verde : COLORS.rojo } };
  }

  const totalRow = ws.addRow([
    "TOTAL",
    bancos.length ? { formula: `SUM(B${firstDataRow}:B${lastDataRow})`, result: bancos.reduce((s, x) => s + x.ingresos, 0) } : 0,
    bancos.length ? { formula: `SUM(C${firstDataRow}:C${lastDataRow})`, result: bancos.reduce((s, x) => s + x.egresos, 0) } : 0,
    bancos.length ? { formula: `SUM(D${firstDataRow}:D${lastDataRow})`, result: bancos.reduce((s, x) => s + x.neto, 0) } : 0,
    bancos.reduce((s, x) => s + x.movimientos, 0),
    "",
  ]);
  styleRow(totalRow, { fill: COLORS.rojo, font: { bold: true, color: { argb: COLORS.blanco } } });
  [2, 3, 4].forEach((c) => totalRow.getCell(c).numFmt = MONEY_FMT);
  totalRow.getCell(5).numFmt = INT_FMT;

  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastDataRow), column: 6 } };
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

function createGraficosSheet(wb, meta) {
  const { ini, fin, ingresosTotal, egresosTotal, utilidad, topPlats, bancos } = meta;
  const ws = wb.addWorksheet("Graficos");
  ws.columns = [
    { width: 4 }, { width: 28 }, { width: 16 }, { width: 40 }, { width: 4 }, { width: 28 }, { width: 16 }, { width: 36 },
  ];
  addTitle(ws, "GRÁFICOS Y RANKINGS", `Barras visuales del ${ini} al ${fin}`, 8);

  addHeader(ws, ["", "Comparativa", "Monto", "Barra", "", "Indicador", "Valor", "Lectura"]);
  const maxComp = Math.max(ingresosTotal, egresosTotal, Math.abs(utilidad), 1);
  [
    ["Ingresos", ingresosTotal, COLORS.verde, "Dinero cobrado"],
    ["Egresos", egresosTotal, COLORS.rojo, "Dinero salido"],
    ["Utilidad", utilidad, utilidad >= 0 ? COLORS.verde : COLORS.rojo, utilidad >= 0 ? "Ganancia neta" : "Pérdida neta"],
  ].forEach(([label, amount, color, lectura], i) => {
    const r = ws.addRow(["", label, amount, "█".repeat(Math.max(1, Math.round((Math.abs(Number(amount) || 0) / maxComp) * 30))), "", lectura, amount, utilidad >= 0 ? "✅ Controlado" : "⚠️ Revisar"]);
    [2, 3, 4, 6, 7, 8].forEach((c) => setBorder(r.getCell(c)));
    r.getCell(2).font = { bold: true };
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(4).font = { bold: true, color: { argb: color } };
    r.getCell(7).numFmt = MONEY_FMT;
    if (i % 2 === 1) [2, 3, 4, 6, 7, 8].forEach((c) => setFill(r.getCell(c), COLORS.grisClaro));
  });

  ws.addRow([]);
  addHeader(ws, ["", "Top plataformas", "Ingresos", "Barra", "", "Top bancos", "Neto", "Barra"]);
  const topLimit = Math.max(topPlats.slice(0, 10).length, bancos.slice(0, 10).length, 1);
  const maxPlat = Math.max(...topPlats.map((x) => x.ingresos), 1);
  const maxBanco = Math.max(...bancos.map((x) => Math.abs(x.neto)), 1);

  for (let i = 0; i < topLimit; i++) {
    const p = topPlats[i];
    const b = bancos[i];
    const medalla = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const r = ws.addRow([
      "",
      p ? `${medalla} ${p.plataforma}` : "—",
      p ? p.ingresos : 0,
      p ? "█".repeat(Math.max(1, Math.round((p.ingresos / maxPlat) * 26))) : "",
      "",
      b ? `${i + 1}. ${b.banco}` : "—",
      b ? b.neto : 0,
      b ? "█".repeat(Math.max(1, Math.round((Math.abs(b.neto) / maxBanco) * 24))) : "",
    ]);
    [2, 3, 4, 6, 7, 8].forEach((c) => setBorder(r.getCell(c)));
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(4).font = { bold: true, color: { argb: COLORS.dorado } };
    r.getCell(7).numFmt = MONEY_FMT;
    r.getCell(7).font = { bold: true, color: { argb: (b?.neto || 0) >= 0 ? COLORS.verde : COLORS.rojo } };
    r.getCell(8).font = { bold: true, color: { argb: (b?.neto || 0) >= 0 ? COLORS.verde : COLORS.rojo } };
    if (i % 2 === 1) [2, 3, 4, 6, 7, 8].forEach((c) => setFill(r.getCell(c), COLORS.grisClaro));
  }

  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

async function generarReporteExcelPorRango(fechaInicio, fechaFin) {
  const ini = normalizeDMY(fechaInicio);
  const fin = normalizeDMY(fechaFin);
  if (!ini || !fin) throw new Error("Fechas inválidas. Use dd/mm/yyyy.");
  if (dmyToMillis(ini) > dmyToMillis(fin)) throw new Error("La fecha inicial no puede ser mayor que la fecha final.");

  try {
    const movimientos = await getMovimientosPorRango(ini, fin);
    const ingresos = movimientos.filter((m) => m.tipo === "ingreso");
    const egresos = movimientos.filter((m) => m.tipo === "egreso");
    const ingresosTotal = ingresos.reduce((s, m) => s + Number(m.monto || 0), 0);
    const egresosTotal = egresos.reduce((s, m) => s + Number(m.monto || 0), 0);
    const utilidad = ingresosTotal - egresosTotal;
    const margen = ingresosTotal > 0 ? utilidad / ingresosTotal : 0;
    const topPlats = resumenTopPlataformas(movimientos);
    const bancos = resumenPorBanco(movimientos);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Sublicuentas Bot";
    wb.lastModifiedBy = "Sublicuentas Bot";
    wb.created = new Date();
    wb.modified = new Date();
    wb.calcProperties.fullCalcOnLoad = true;
    wb.properties.date1904 = false;

    const subtitle = `Período ${ini} al ${fin} · ${movimientos.length} movimientos`;

    // Creamos primero Resumen para que abra como primera hoja. Los totales apuntan a
    // filas conocidas de Ingresos/Egresos, aunque esas hojas se creen después.
    const ingTotalRowPredicted = 6 + ingresos.length;
    const egrTotalRowPredicted = 6 + egresos.length;
    createResumenSheet(wb, {
      ini,
      fin,
      ingresosTotal,
      egresosTotal,
      utilidad,
      margen,
      movimientos: movimientos.length,
      ingTotalRow: ingTotalRowPredicted,
      egrTotalRow: egrTotalRowPredicted,
      topPlats,
      bancos,
    });

    createDetalleSheet(wb, "Ingresos", "DETALLE DE INGRESOS", subtitle, ingresos, "ingreso");
    createDetalleSheet(wb, "Egresos", "DETALLE DE EGRESOS", subtitle, egresos, "egreso");
    createBancosSheet(wb, bancos, subtitle);
    createGraficosSheet(wb, { ini, fin, ingresosTotal, egresosTotal, utilidad, topPlats, bancos });

    // Vista y protección visual básica.
    wb.eachSheet((ws) => {
      ws.properties.defaultRowHeight = 18;
      ws.state = "visible";
    });

    return await wb.xlsx.writeBuffer();
  } catch (e) {
    logErr("generarReporteExcelPorRango", e);
    throw e;
  }
}

module.exports = {
  generarReporteExcelPorRango,
  getMovimientosPorRango,
};
