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

// R109 · Fecha REAL de Honduras. Hasta el 04/10 la APK/web fechaban con la hora de Londres (UTC): lo cobrado
// de 6 PM a medianoche quedaba con fecha del día siguiente. Si la fecha guardada es la del día UTC de createdAt
// y se registró entre 00:00 y 05:59 UTC, la fecha real es la del día anterior (hora de Honduras).
function fechaRealHonduras(data = {}) {
  const iso = typeof data.createdAt === "string" ? data.createdAt : "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/);
  if (!m || Number(m[4]) >= 6) return "";
  const utcYmd = `${m[1]}-${m[2]}-${m[3]}`;
  const guardada = String(data.fechaPago || "").slice(0, 10) || (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(data.fecha || "")) ? (() => { const [d, mo, y] = String(data.fecha).split("/"); return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; })() : "");
  if (guardada !== utcYmd) return ""; // fecha elegida a mano o ya correcta: se respeta
  const hn = new Date(Date.parse(iso) - 6 * 3600000);
  return `${String(hn.getUTCDate()).padStart(2, "0")}/${String(hn.getUTCMonth() + 1).padStart(2, "0")}/${hn.getUTCFullYear()}`;
}
const USUARIOS_LABEL = { naara: "Sublicuentas", sublicuentas: "Sublicuentas", sublicuentas2: "Sublicuentas", relojes: "Relojes", libni: "Relojes", daniela: "Relojes", finanzas: "Relojes" };
function usuarioMovimiento(data = {}) {
  const origen = String(data.origenCanal || data.origen || "").toLowerCase();
  const canal = { apk: "APK", web: "Web", tg: "Telegram", telegram: "Telegram", socios: "Socios" }[origen] || "";
  // Socios/revendedores: el usuario financiero visible es SIEMPRE el nombre del socio, no un slug ni “Socios”.
  if (["socios", "socio", "revendedor", "revendedores"].includes(origen)) {
    const socio = safeText(data.socioNombre || data.revendedorNombre || data.nombreSocio || data.registradoPorNombre || data.registradoPor || data.cobradoPor || "Socio");
    return socio; // R126: solo el nombre (sin "· APK/Telegram/Socios")
  }
  const u = safeText(data.userName || data.registradoPorNombre || data.usuario || data.cobradoPor || data.registradoPor || data.admin || data.creadoPor || data.createdBy || "");
  if (!u) return "";
  const key = u.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const label = USUARIOS_LABEL[key] || (/^libni|daniela$/i.test(String(u).replace(/\s+/g, "")) ? "Relojes" : u); // R119: "Libni Daniela" = Relojes
  return label; // R126: solo el usuario, sin canal
}
const SUBTIPO_LABEL = { cobro_renovacion: "Renovación", cobro_compra: "Compra nueva", cobro_pendiente_cliente: "Abono de cliente", cobro_pendiente_vendedor: "Entrega de vendedor", compra_socio: "Compra socio", renovacion_socio: "Renovación socio", cobro_cliente: "Cobro" };
function detalleMovimiento(data = {}) {
  // Como antes: el Detalle es el nombre del cliente (o socio/beneficiario). Solo si no hay nombre se pone el tipo.
  const directo = safeText(data.detalle || data.descripcion || data.nota || data.observacion || "");
  if (directo) return directo;
  const quien = safeText(data.clienteNombre || data.socioNombre || data.beneficiario || data.deudorNombre || "");
  if (quien) return data.reversaDe ? `${quien} (reversa)` : quien;
  return SUBTIPO_LABEL[String(data.subtipo || "")] || "";
}
let platLabel = null;
// R126 · En el Excel van solo datos: sin ⭐/emojis en los nombres de plataforma.
function sinAdornosR126(v = "") { return String(v || "").replace(/[\u2B50\u2605\u2606\u2728]|\uD83C[\uDF1F\uDF20]|\uFE0F/g, "").replace(/\s+/g, " ").replace(/^[\s·+\-]+|[\s·+\-]+$/g, "").trim(); }
// R126 · Las barras visuales NO se salen de su celda: cuántos "█" caben según el ancho de la columna.
function bloquesQueCaben(ws, col) { return Math.max(4, Math.floor(Number(ws.getColumn(col).width || 10) / 2.4)); }
function plataformaLegible(v = "") {
  const t = safeText(v);
  if (!t) return "Sin plataforma";
  try { if (!platLabel) platLabel = require("./index_02_utils_roles").humanPlataforma; } catch (_) { platLabel = (x) => x; }
  // Solo traduce claves internas (vipnetflix, disneyp…); los nombres ya legibles se dejan igual.
  return sinAdornosR126(/^[a-z0-9_]+$/.test(t) ? (platLabel(t) || t) : t) || "Sin plataforma";
}

function extraerFechaMovimiento(data = {}) {
  const real = fechaRealHonduras(data);
  if (real) return real;
  return normalizeDMY(data.fecha || data.fechaPago || data.fecha_pago || data.fecha_dmy || data.fechaMovimiento || data.date || "") ||
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
  // R106: las REVERSAS (anular/corregir) llevan monto negativo y deben restar; lo demás se toma en positivo como antes.
  const montoBase = Math.abs(parseMonto(data.monto ?? data.valor ?? data.amount ?? data.total));
  const monto = data.reversaDe ? -montoBase : montoBase;
  return {
    id: String(id || ""),
    source: String(source || ""),
    fecha,
    fechaTs: dmyToMillis(fecha),
    tipo,
    monto,
    banco: safeText(data.banco || data.metodo || data.cuenta || data.bank || "Sin banco"),
    plataforma: plataformaLegible(data.plataforma || data.servicio || data.producto || data.platform || ""),
    motivo: safeText(data.motivo || data.concepto || data.descripcion || data.detalle || "Egreso"),
    detalle: detalleMovimiento(data),
    userName: usuarioMovimiento(data),
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
        if (col === "finanzas" && row.fechaTs >= dmyToMillis("01/10/2026")) continue; // R124: desde el 01/10 solo cuenta finanzas_movimientos (igual que la APK/web)
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
    ["💸 Egresos operativos", { formula: `Egresos!C${egrTotalRow}`, result: egresosTotal }, COLORS.rojo, MONEY_FMT],
    ["📈 Disponible antes de planilla", { formula: "C5-C6", result: utilidad }, utilidad >= 0 ? COLORS.verde : COLORS.rojoOscuro, MONEY_FMT],
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
    const r = ws.addRow(["", label, amount, "", desc, value, "", "█".repeat(Math.max(1, Math.round((Math.abs(Number(amount) || 0) / maxBase) * bloquesQueCaben(ws, 8))))]);
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
      p ? `${i + 1}. ${p.plataforma}` : "—", // R126: sin medallas
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

// R131: auditoría de pagos. El usuario elige en la lista y se guarda en el Excel.
const CONCILIADO_R131 = { ok: "✔ Conciliado", mal: "✖ No cuadra", pendiente: "Pendiente" };
function marcarCeldaConciliadoR131(cell) {
  cell.dataValidation = {
    type: "list",
    allowBlank: true,
    formulae: [`"${CONCILIADO_R131.ok},${CONCILIADO_R131.mal},${CONCILIADO_R131.pendiente}"`],
    showErrorMessage: true,
    errorTitle: "Conciliado",
    error: "Elegí: Conciliado, No cuadra o Pendiente",
  };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.protection = { locked: false };
}
function colorearConciliadoR131(ws, ref) {
  const primera = ref.split(":")[0];
  const regla = (texto, fondo, letra) => ({
    type: "expression", formulae: [`ISNUMBER(SEARCH("${texto}",${primera}))`],
    style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: fondo } }, font: { bold: true, color: { argb: letra } } },
  });
  ws.addConditionalFormatting({ ref, rules: [
    regla("Conciliado", "FFD9F2DE", "FF1B7A34"),
    regla("No cuadra", "FFFADBD8", "FFB3261E"),
  ] });
}

function createDetalleSheet(wb, sheetName, title, subtitle, rows, tipo) {
  const isIngreso = tipo === "ingreso";
  const color = isIngreso ? COLORS.verde : COLORS.rojo;
  const light = isIngreso ? COLORS.verdeClaro : COLORS.rojoClaro;
  const ws = wb.addWorksheet(sheetName);
  ws.columns = [
    { width: 13 }, { width: 26 }, { width: 15 }, { width: 18 },
    { width: 18 }, { width: 34 }, { width: 28 }, { width: 18 },
  ];
  addTitle(ws, title, subtitle, 8);
  // R131: columna de auditoría para marcar que el pago entró y cuadra en la cuenta.
  const headerRow = addHeader(ws, ["Fecha", isIngreso ? "Plataforma" : "Motivo", "Monto", "Banco", "Usuario", "Detalle", "Barra visual", "Conciliado"]);
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
      CONCILIADO_R131.pendiente,
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
    barCell.value = rows.length ? { formula: formulaBar(`$C${rowNumber}`, `$C$${firstDataRow}:$C$${lastDataRow}`, 1, bloquesQueCaben(ws, 7)), result: "" } : "";
    barCell.font = { color: { argb: color } };
    if (rows.length) marcarCeldaConciliadoR131(ws.getCell(`H${rowNumber}`));
  }
  if (rows.length) colorearConciliadoR131(ws, `H${firstDataRow}:H${lastDataRow}`);

  const totalRow = ws.addRow(["TOTAL", "", rows.length ? { formula: `SUM(C${firstDataRow}:C${lastDataRow})`, result: rows.reduce((s, x) => s + Number(x.monto || 0), 0) } : 0, "", `${rows.length} registros`, "", "", rows.length ? { formula: `COUNTIF(H${firstDataRow}:H${lastDataRow},"${CONCILIADO_R131.ok}")&" de ${rows.length}"`, result: `0 de ${rows.length}` } : ""]);
  totalRow.height = 24;
  styleRow(totalRow, { fill: color, font: { bold: true, color: { argb: COLORS.blanco } } });
  totalRow.getCell(3).numFmt = MONEY_FMT;

  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastDataRow), column: 8 } };
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
    barCell.value = bancos.length ? { formula: `IF($D${rowNumber}=0,"",REPT("█",MAX(1,ROUND(ABS($D${rowNumber})/${maxNetoAbs}*${bloquesQueCaben(ws, 6)},0))))`, result: "" } : "";
    barCell.font = { color: { argb: netoVal >= 0 ? COLORS.verde : COLORS.rojo } };
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
    const r = ws.addRow(["", label, amount, "█".repeat(Math.max(1, Math.round((Math.abs(Number(amount) || 0) / maxComp) * bloquesQueCaben(ws, 4)))), "", lectura, amount, utilidad >= 0 ? "✅ Controlado" : "⚠️ Revisar"]);
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
    const medalla = `${i + 1}.`; // R126: sin medallas/emojis
    const r = ws.addRow([
      "",
      p ? `${medalla} ${p.plataforma}` : "—",
      p ? p.ingresos : 0,
      p ? "█".repeat(Math.max(1, Math.round((p.ingresos / maxPlat) * bloquesQueCaben(ws, 4)))) : "",
      "",
      b ? `${i + 1}. ${b.banco}` : "—",
      b ? b.neto : 0,
      b ? "█".repeat(Math.max(1, Math.round((Math.abs(b.neto) / maxBanco) * bloquesQueCaben(ws, 8)))) : "",
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

// ===================== R104 · Libro mayor en el Reporte Saiyajin =====================
// Hojas: Planilla (pago padre), Distribución Planilla (una fila por banco), Cierres y Saldos Libro.
// Lee las MISMAS colecciones que la APK y /api/finanzas; los borradores nunca se guardan, así que no aparecen.
const RL = require("./lib_finanzas_reglas");
function dmyToYmd(dmy) { const [d, m, y] = String(dmy).split("/"); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function simpleSheet(wb, name, title, subtitle, headers, widths, rows, moneyCols = [], totalCols = []) {
  const ws = wb.addWorksheet(name);
  ws.columns = widths.map((width) => ({ width }));
  addTitle(ws, title, subtitle, headers.length);
  addHeader(ws, headers);
  const first = ws.rowCount + 1;
  rows.forEach((values, i) => {
    const r = ws.addRow(values);
    r.eachCell((c) => setBorder(c));
    if (i % 2 === 1) r.eachCell((c) => setFill(c, COLORS.zebra || "FFF2FBFF"));
    moneyCols.forEach((c) => applyMoney(r.getCell(c)));
  });
  if (rows.length && totalCols.length) {
    const last = ws.rowCount;
    const t = ws.addRow(headers.map((_, i) => (i === 0 ? "TOTAL" : "")));
    totalCols.forEach((c) => { const L = String.fromCharCode(64 + c); t.getCell(c).value = { formula: `SUM(${L}${first}:${L}${last})`, result: rows.reduce((s, r) => s + Number(r[c - 1] || 0), 0) }; applyMoney(t.getCell(c)); });
    t.eachCell((c) => { c.font = { bold: true }; setBorder(c); });
  }
  ws.views = [{ state: "frozen", ySplit: first - 1 }];
  if (headers.length) ws.autoFilter = { from: { row: first - 1, column: 1 }, to: { row: first - 1, column: headers.length } };
  return ws;
}
async function agregarHojasLibroR104(wb, { ini, fin, subtitle, ingresosTotal, egresosTotal, planillaTotal, ventasTotal = 0 }) {
  const desde = dmyToYmd(ini), hasta = dmyToYmd(fin);
  let pagos = [], ciclos = [], libro = null;
  try { pagos = (await db.collection("planilla_pagos").get()).docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).filter((p) => p.estado === "confirmado" && p.fecha >= desde && p.fecha <= hasta).sort((a, b) => String(a.fecha).localeCompare(b.fecha)); } catch (e) { logErr("R104 planilla_pagos", e); }
  try { ciclos = (await db.collection("finanzas_ciclos").get()).docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).filter((c) => c.fechaInicio <= hasta && c.fechaFin >= desde).sort((a, b) => String(a.fechaInicio).localeCompare(b.fechaInicio)); } catch (e) { logErr("R104 finanzas_ciclos", e); }
  try { libro = await require("./index_31_finanzas_libro").estadoLibro(); } catch (e) { logErr("R104 estadoLibro", e); }
  // R106: cartera por cobrar (clientes / vendedores). Estado actual; NO es efectivo.
  let cuentas = [];
  try { cuentas = (await db.collection("cuentas_por_cobrar").get()).docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))); } catch (e) { logErr("R106 cuentas_por_cobrar", e); }
  const abiertas = cuentas.filter((c) => ["pendiente", "parcial"].includes(c.estado));
  const penCli = abiertas.filter((c) => c.deudorTipo !== "vendedor").reduce((s, c) => s + Number(c.saldoPendiente || 0), 0);
  const penVen = abiertas.filter((c) => c.deudorTipo === "vendedor").reduce((s, c) => s + Number(c.saldoPendiente || 0), 0);

  // Resumen: bloque del ciclo con planilla y resultado final.
  const res = wb.getWorksheet("Resumen");
  if (res) {
    res.addRow([]);
    const hh = addHeader(res, ["", "Ciclo financiero (R104)", "Monto", "", "Definición", "", "", ""]);
    const disponible = ingresosTotal - egresosTotal, resultado = disponible - planillaTotal;
    [["Ventas generadas", ventasTotal, "Valor acordado de compras/renovaciones (no es efectivo)"], ["Dinero real recibido", ingresosTotal, "Cobros y abonos que sí entraron a bancos"],
     ["Pendiente clientes (hoy)", penCli, "Cuentas por cobrar a clientes · NO suma a bancos"], ["Pendiente vendedores (hoy)", penVen, "Dinero que vendedores aún no entregan · NO suma"], ["Pendiente total (hoy)", penCli + penVen, "Cartera por cobrar, fuera del disponible"],
     ["Ingresos", ingresosTotal, "Cobros confirmados"], ["Egresos operativos", egresosTotal, "Gastos manuales (sin planilla)"], ["Disponible antes de planilla", disponible, "Ingresos − egresos operativos"],
     ["Planilla / comisiones", planillaTotal, "Pagos confirmados a beneficiarios"], ["Resultado final", resultado, "Disponible − planilla"],
     ["Saldo retenido en bancos (hoy)", libro ? libro.saldos.total : 0, libro ? `Ciclo abierto desde ${libro.libro.cicloInicio}` : "Sin libro mayor"]].forEach(([l, v, d]) => {
      const r = res.addRow(["", l, v, "", d]); applyMoney(r.getCell(3)); [2, 3, 5].forEach((c) => setBorder(r.getCell(c))); r.getCell(2).font = { bold: /Resultado|Disponible/.test(l) };
    });
    const estado = ciclos.length ? ciclos.map((c) => `${c.fechaInicio}→${c.fechaFin} cerrado por ${c.cerradoPor || "—"}`).join(" · ") : "Sin cierres en el período";
    const r = res.addRow(["", "Estado del cierre", "", "", estado]); [2, 5].forEach((c) => setBorder(r.getCell(c)));
  }
  simpleSheet(wb, "Planilla", "PLANILLA / COMISIONES", subtitle,
    ["Fecha", "Beneficiario", "Concepto", "Descripción", "Monto total", "Confirmó", "Estado"],
    [12, 22, 20, 26, 14, 14, 12],
    pagos.map((p) => [p.fecha, p.beneficiario, p.conceptoLabel || p.concepto, p.descripcion || "", Number(p.montoTotal || 0), usuarioMovimiento({ usuario: p.registradoPor }) || p.registradoPor || "", String(p.estado || "").toUpperCase()]), [5], [5]); // R126: sin columnas técnicas
  const dist = [];
  for (const p of pagos) for (const a of p.asignaciones || []) dist.push([p.fecha, p.beneficiario, a.banco || a.bancoId, Number(a.monto || 0), Number(a.saldoAntes || 0), Number(a.saldoDespues || 0)]);
  simpleSheet(wb, "Distribución Planilla", "DISTRIBUCIÓN DE PLANILLA POR BANCO", subtitle,
    ["Fecha", "Beneficiario", "Banco", "Monto tomado", "Saldo antes", "Saldo después"], [12, 22, 20, 14, 14, 14], dist, [4, 5, 6], [4]);
  // R108 · Socios: "Ingreso - Compra Socio" / "Ingreso - Renovación Socio" (mismo libro, sin libro aparte).
  let socios = [];
  try { socios = (await getMovimientosPorRango(ini, fin)).map((m) => m.raw || {}).filter((r) => String(r.tipo) === "ingreso" && ["compra_socio", "renovacion_socio"].includes(String(r.subtipo))); } catch (e) { logErr("R108 socios excel", e); }
  simpleSheet(wb, "Socios", "INGRESOS DE SOCIOS (COMPRAS Y RENOVACIONES)", subtitle,
    ["Fecha", "Socio", "Tipo", "Cliente", "Servicio / producto", "Cantidad", "Precio unitario", "Descuento", "Total", "Banco", "Estado"],
    [12, 18, 22, 20, 34, 10, 16, 12, 12, 16, 12],
    socios.map((r) => {
      const prod = Array.isArray(r.productosSocio) ? r.productosSocio : (Array.isArray(r.serviciosSocio) ? r.serviciosSocio.map((x) => ({ servicio: x.servicio, cantidad: 1, precioUnitario: x.precio })) : []);
      return [r.fecha || "", r.socioNombre || r.socioNorm || "", r.subtipo === "compra_socio" ? "Ingreso - Compra Socio" : "Ingreso - Renovación Socio", r.clienteNombre || "", sinAdornosR126(prod.map((x) => `${x.servicio}${x.cantidad > 1 ? ` x${x.cantidad}` : ""}`).join(" + ") || r.plataforma || ""),
        prod.reduce((a, x) => a + Number(x.cantidad || 1), 0), prod.map((x) => x.precioUnitario).filter((x) => x != null).join(" / "), Number(r.descuento || 0), Number(r.monto || 0), r.banco || "", r.estadoFinanciero ? String(r.estadoFinanciero).toUpperCase() : "CONFIRMADO"];
    }), [8, 9], [9]);
  simpleSheet(wb, "Pendientes Cobro", "PENDIENTES DE COBRO (CLIENTES / VENDEDORES)", "Estado actual de la cartera · no es efectivo disponible",
    ["Tipo deudor", "Deudor", "Origen", "Cliente", "Plataforma", "Monto total", "Recibido inicial", "Abonos posteriores", "Saldo pendiente", "Estado", "Creado"],
    [12, 22, 12, 22, 22, 13, 14, 15, 15, 11, 17],
    cuentas.map((c) => [c.deudorTipo === "vendedor" ? "Vendedor" : "Cliente", c.deudorNombre || "", c.tipoOrigen === "compra" ? "Compra" : "Renovación", c.clienteNombre || "", sinAdornosR126(c.plataforma || ""), Number(c.montoTotalOperacion || 0), Number(c.montoRecibidoInicial || 0), Number(c.montoRecibidoPosterior || 0), Number(c.saldoPendiente || 0), String(c.estado || "").toUpperCase(), fechaHoraHN(c.createdAt)]), [6, 7, 8, 9], [9]);
  simpleSheet(wb, "Cierres", "CIERRES DE CICLO", subtitle,
    ["Inicio", "Fin", "Ingresos", "Egresos operativos", "Disponible antes planilla", "Planilla / comisiones", "Resultado final", "Saldo retenido", "Cerrado por", "Fecha cierre"],
    [12, 12, 14, 16, 18, 16, 14, 14, 14, 17],
    ciclos.map((c) => [c.fechaInicio, c.fechaFin, Number(c.ingresos || 0), Number(c.egresosOperativos || 0), Number(c.disponibleAntesPlanilla || 0), Number(c.planilla || 0), Number(c.resultado || 0), Number(c.saldoRetenido || 0), usuarioMovimiento({ usuario: c.cerradoPor }) || c.cerradoPor || "", fechaHoraHN(c.cerradoAt)]), [3, 4, 5, 6, 7, 8]);
  simpleSheet(wb, "Saldos Libro", "SALDOS REALES POR BANCO (LIBRO MAYOR · HOY)", libro ? `Ciclo abierto desde ${libro.libro.cicloInicio}` : "Sin libro mayor",
    ["Banco", "Base (inicial / último cierre)", "Desde", "Ingresos", "Egresos operativos", "Planilla / comisiones", "Ajustes", "Transferencias (neto)", "Saldo final", "Movimientos"],
    [22, 22, 12, 14, 16, 18, 12, 18, 14, 12],
    (libro ? libro.saldos.bancos.filter((b) => b.activado) : []).map((b) => [b.nombre, b.base, b.desde, b.ingresos, b.egresosOperativos, b.planilla, b.ajustes, Number(b.transferencias || 0), b.saldo, b.movimientos]), [2, 4, 5, 6, 7, 8, 9], [9]);
}

// R123 · Anulados aparte (abajo / en su hoja), igual que la lista de Telegram y el Excel de la APK.
function esAnuladoR123(m = {}) { return ["anulado", "corregido"].includes(String(m.raw?.estadoFinanciero || "")); }
function fechaHoraHN(iso) { const d = typeof iso?.toDate === "function" ? iso.toDate() : new Date(iso); if (!d || isNaN(d)) return ""; const x = new Date(d.getTime() - 6 * 3600000).toISOString(); return `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)} ${x.slice(11, 16)}`; }
function crearHojaAnuladosR123(wb, anulados = [], subtitle = "") {
  const filas = [...anulados].sort((a, b) => (a.fechaTs || 0) - (b.fechaTs || 0)).map((m) => {
    const r = m.raw || {};
    return [m.fecha, m.tipo === "egreso" ? "Egreso" : "Ingreso", m.detalle || safeText(r.clienteNombre || r.motivo || ""), m.plataforma || "", m.banco || "", Math.abs(Number(m.monto || 0)),
      String(r.estadoFinanciero || "").toUpperCase(), safeText(r.motivoAnulacion || r.motivoCorreccion || ""), usuarioMovimiento({ usuario: r.anuladoPor }) || safeText(r.anuladoPor || ""), fechaHoraHN(r.anuladoAt), m.userName || ""];
  });
  const ws = simpleSheet(wb, "Anulados", "MOVIMIENTOS ANULADOS / CORREGIDOS", `${subtitle} · NO suman en Ingresos, Egresos ni Resumen`,
    ["Fecha", "Tipo", "Cliente / detalle", "Plataforma", "Banco", "Monto", "Estado", "Motivo", "Anulado por", "Anulado el", "Registrado por"], [12, 10, 26, 26, 18, 13, 12, 30, 16, 17, 20], filas, [6], [6]);
  if (!filas.length) ws.addRow(["Sin movimientos anulados en este período."]);
  return ws;
}

// R124 · "Revisar repetidos": el mismo cliente más de una vez el MISMO día (vigentes). No borra ni resta nada: es
// la lista para revisar contra el banco y anular el voucher que sobre (mismo criterio que la lista de Telegram).
function claveClienteR124(m = {}) {
  const r = m.raw || {}, det = String(r.detalle || "").trim();
  const n = String(r.clienteNombre || r.cliente || r.nombrePerfil || r.deudorNombre || r.socioNombre || (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(det) ? "" : det) || "");
  return n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
}
function crearHojaRepetidosR124(wb, ingresos = [], subtitle = "") {
  // R129: repetido = mismo cliente + MISMO servicio (compraId o plataforma) + mismo monto el mismo día (2 perfiles distintos no lo son).
  const serv = (m) => String(m.raw?.compraId || "").trim() || String(m.plataforma || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const cuenta = new Map(), k = (m) => `${m.fecha}|${claveClienteR124(m)}|${serv(m)}|${Number(m.monto || 0)}`;
  for (const m of ingresos) if (claveClienteR124(m)) cuenta.set(k(m), (cuenta.get(k(m)) || 0) + 1);
  const filas = ingresos.filter((m) => claveClienteR124(m) && cuenta.get(k(m)) > 1)
    .sort((a, b) => (a.fechaTs || 0) - (b.fechaTs || 0) || claveClienteR124(a).localeCompare(claveClienteR124(b)) || String(a.raw?.createdAt || "").localeCompare(String(b.raw?.createdAt || "")))
    .map((m) => [m.fecha, m.detalle || "", m.plataforma || "", Number(m.monto || 0), m.banco || "", m.userName || "", fechaHoraHN(m.raw?.createdAt).slice(11), cuenta.get(k(m))]);
  const ws = simpleSheet(wb, "Revisar repetidos", "POSIBLES VOUCHERS REPETIDOS", `${subtitle} · mismo cliente, mismo servicio y mismo monto el mismo día · revíselos contra el banco`,
    ["Fecha", "Cliente", "Plataforma", "Monto", "Banco", "Registrado por", "Hora", "Veces ese día"], [12, 26, 28, 13, 18, 22, 8, 12], filas, [4], [4]);
  if (!filas.length) ws.addRow(["Sin vouchers repetidos en este período."]);
  return ws;
}

async function generarReporteExcelPorRango(fechaInicio, fechaFin) {
  const ini = normalizeDMY(fechaInicio);
  const fin = normalizeDMY(fechaFin);
  if (!ini || !fin) throw new Error("Fechas inválidas. Use dd/mm/yyyy.");
  if (dmyToMillis(ini) > dmyToMillis(fin)) throw new Error("La fecha inicial no puede ser mayor que la fecha final.");

  try {
    // R104: misma clasificación que la APK y /api/finanzas (lib_finanzas_reglas.js):
    // saldos iniciales no son ingresos; la planilla/comisiones va aparte de los egresos operativos.
    const todosR123 = (await getMovimientosPorRango(ini, fin)).map((m) => ({ ...m, kind: RL.movementKind(m.raw || {}) }));
    // R123: los movimientos ANULADOS/CORREGIDOS y sus reversas no se mezclan con los vigentes: van en su propia hoja
    // "Anulados" y no suman en Ingresos, Egresos ni el Resumen (así el día muestra solo lo que de verdad entró/salió).
    const anulados = todosR123.filter((m) => esAnuladoR123(m) && ["ingreso", "egreso", "ajuste", "planilla"].includes(m.kind));
    const movimientos = todosR123.filter((m) => !esAnuladoR123(m) && !m.raw?.reversaDe).filter((m) => !["saldo_inicial", "venta", "transferencia"].includes(m.kind)); // R106: ventas y transferencias no son ingreso/egreso
    const ventasTotal = todosR123.filter((m) => m.kind === "venta" && !esAnuladoR123(m) && !m.raw?.reversaDe).reduce((s, m) => s + Number(m.monto || 0), 0);
    // R114/R129: un cliente paga UNA vez → todos los cobros del mismo cliente al mismo banco el mismo día van en UNA fila
    // (ej. Juan de Dios 80 + 80 de sus 2 perfiles = L160), aunque se hayan registrado en momentos distintos o por otro usuario.
    const ingresos = (() => {
      const lista = movimientos.filter((m) => m.tipo === "ingreso" && m.kind !== "ajuste").sort((a, b) => String(a.raw?.createdAt || "").localeCompare(String(b.raw?.createdAt || "")));
      const out = [];
      for (const m of lista) {
        const r = m.raw || {}, t = Date.parse(r.createdAt || "") || 0, quien = String(r.clienteId || r.clienteNombre || "").toLowerCase().trim();
        const key = [quien, String(r.bancoId || m.banco).toLowerCase(), m.fecha].join("|");
        const g = quien && !r.reversaDe ? out.find((x) => x._key === key) : null;
        if (g) { g.monto += Number(m.monto || 0); if (m.plataforma && !g.plataforma.includes(m.plataforma)) g.plataforma += ` + ${m.plataforma}`; }
        else out.push({ ...m, _key: key, _t: t });
      }
      return out;
    })();
    const egresos = movimientos.filter((m) => m.tipo === "egreso" && m.kind !== "planilla" && m.kind !== "ajuste");
    const planillaMovs = movimientos.filter((m) => m.kind === "planilla");
    const planillaTotal = planillaMovs.reduce((s, m) => s + Number(m.monto || 0), 0);
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
    crearHojaAnuladosR123(wb, anulados, subtitle);
    crearHojaRepetidosR124(wb, movimientos.filter((m) => m.tipo === "ingreso" && m.kind !== "ajuste"), subtitle);
    createBancosSheet(wb, bancos, subtitle);
    await agregarHojasLibroR104(wb, { ini, fin, subtitle, ingresosTotal, egresosTotal, planillaTotal, ventasTotal });
    createGraficosSheet(wb, { ini, fin, ingresosTotal, egresosTotal, utilidad, topPlats, bancos });

    // R126: toda celda con barra se encoge para caber (por si Excel usa otra letra más ancha) y nunca invade la de al lado.
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { const v = c.value; const t = typeof v === "string" ? v : (v && v.formula) || ""; if (String(t).includes("█")) c.alignment = { horizontal: "left", vertical: "middle", shrinkToFit: true }; })));
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
  fechaRealHonduras,
  generarReporteExcelPorRango,
  getMovimientosPorRango,
};
