/* ✅ SUBLICUENTAS — REPORTES EXCEL PROFESIONAL (NIVEL DIOS)
   100% COMPATIBLE CON ExcelJS — SIN funciones inexistentes
   - Barras de datos visuales (data bars con formato condicional)
   - Encabezados congelados (ws.views correcto)
   - Filtros automáticos
   - Fórmulas dinámicas SUM
   - Colores corporativos + formato moneda Lps
*/

const { ExcelJS, db } = require("./index_01_core");
const FINANZAS_COLLECTION = "finanzas_movimientos";

// logErr local (evita problemas de carga circular)
function logErr(scope = "error", err = "") {
  try {
    console.error(`❌ [${scope}]`, err && err.message ? err.message : err);
  } catch (_) {}
}

const C = {
  rojo: "FFD32F2F", rojoOsc: "FFB71C1C", negro: "FF1A1A1A",
  verde: "FF2E7D32", verdeClaro: "FFC8E6C9", rojoClaro: "FFFFCDD2",
  blanco: "FFFFFFFF", gris: "FFF5F5F5", grisOsc: "FF424242",
  dorado: "FFFFB300", azul: "FF1565C0",
};

const BORDE = { top:{style:"thin",color:{argb:"FFBDBDBD"}}, bottom:{style:"thin",color:{argb:"FFBDBDBD"}}, left:{style:"thin",color:{argb:"FFBDBDBD"}}, right:{style:"thin",color:{argb:"FFBDBDBD"}} };

function dmyToTimestamp(dmy = "") {
  const p = String(dmy || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!p) return 0;
  return new Date(Number(p[3]), Number(p[2]) - 1, Number(p[1])).getTime();
}

function normalizeDMY(s = "") {
  const v = String(s || "").trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${String(Number(m[1])).padStart(2,"0")}/${String(Number(m[2])).padStart(2,"0")}/${m[3]}`;
  return "";
}

async function getMovimientosPorRango(fechaInicio, fechaFin) {
  try {
    const ini = normalizeDMY(fechaInicio), fin = normalizeDMY(fechaFin);
    if (!ini || !fin) return [];
    const iniTs = dmyToTimestamp(ini), finTs = dmyToTimestamp(fin) + 86400000;
    const snap = await db.collection(FINANZAS_COLLECTION).get();
    const todos = snap.docs.map(doc => {
      const d = doc.data();
      return { id: doc.id, ...d, fecha: d.fecha || "", tipo: String(d.tipo || "").toLowerCase(), monto: Number(d.monto || 0) };
    });
    return todos.filter(m => {
      if (!m.fecha) return false;
      const ts = dmyToTimestamp(normalizeDMY(m.fecha));
      return ts >= iniTs && ts <= finTs;
    }).sort((a, b) => dmyToTimestamp(normalizeDMY(a.fecha)) - dmyToTimestamp(normalizeDMY(b.fecha)));
  } catch (e) {
    logErr("getMovimientosPorRango", e);
    return [];
  }
}

function titulo(ws, texto, cols) {
  const row = ws.addRow([texto]);
  row.height = 28;
  row.getCell(1).font = { bold: true, size: 15, color: { argb: C.blanco } };
  row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rojo } };
  row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  ws.mergeCells(row.number, 1, row.number, cols);
  return row;
}

function headerFila(ws, headers) {
  const row = ws.addRow(headers);
  row.height = 22;
  row.eachCell(c => {
    c.font = { bold: true, size: 11, color: { argb: C.blanco } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.negro } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = BORDE;
  });
  return row;
}

async function generarReporteExcelPorRango(fechaInicio, fechaFin) {
  try {
    const ini = normalizeDMY(fechaInicio), fin = normalizeDMY(fechaFin);
    if (!ini || !fin) throw new Error("Fechas inválidas");
    if (dmyToTimestamp(ini) > dmyToTimestamp(fin)) throw new Error("Fecha inicial mayor que final");

    const movimientos = await getMovimientosPorRango(ini, fin);
    const wb = new ExcelJS.Workbook();
    wb.creator = "Sublicuentas";
    wb.created = new Date();

    const ingresos = movimientos.filter(m => m.tipo === "ingreso");
    const egresos = movimientos.filter(m => m.tipo === "egreso");
    const totIng = ingresos.reduce((s, m) => s + m.monto, 0);
    const totEgr = egresos.reduce((s, m) => s + m.monto, 0);
    const utilidad = totIng - totEgr;
    const margen = totIng > 0 ? (utilidad / totIng) * 100 : 0;

    // ========== HOJA 1: RESUMEN ==========
    const ws1 = wb.addWorksheet("📊 Resumen", { views: [{ showGridLines: false }] });
    ws1.columns = [{ width: 4 }, { width: 30 }, { width: 22 }, { width: 30 }];

    ws1.addRow([]);
    const t1 = ws1.addRow(["", "SUBLICUENTAS — REPORTE FINANCIERO"]);
    t1.height = 34;
    t1.getCell(2).font = { bold: true, size: 18, color: { argb: C.blanco } };
    t1.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rojo } };
    t1.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    ws1.mergeCells(t1.number, 2, t1.number, 4);

    const sub1 = ws1.addRow(["", `Período del ${ini} al ${fin}`]);
    sub1.getCell(2).font = { italic: true, size: 11, color: { argb: C.grisOsc } };
    sub1.getCell(2).alignment = { horizontal: "center" };
    ws1.mergeCells(sub1.number, 2, sub1.number, 4);
    ws1.addRow([]);

    // Tarjetas KPI
    const kpis = [
      ["💰 Total Ingresos", totIng, C.verde],
      ["💸 Total Egresos", totEgr, C.rojo],
      ["📈 Utilidad Neta", utilidad, utilidad >= 0 ? C.verde : C.rojoOsc],
      ["📊 Margen", margen / 100, C.azul],
      ["🧾 Movimientos", movimientos.length, C.grisOsc],
    ];
    kpis.forEach(([label, valor, color], i) => {
      const r = ws1.addRow(["", label, valor]);
      r.height = 26;
      r.getCell(2).font = { bold: true, size: 12, color: { argb: C.blanco } };
      r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      r.getCell(2).alignment = { vertical: "middle", indent: 1 };
      r.getCell(2).border = BORDE;
      r.getCell(3).font = { bold: true, size: 13, color: { argb: color } };
      r.getCell(3).alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      r.getCell(3).border = BORDE;
      if (label.includes("Margen")) r.getCell(3).numFmt = '0.00%';
      else if (label.includes("Movimientos")) r.getCell(3).numFmt = '#,##0';
      else r.getCell(3).numFmt = '"Lps " #,##0.00';
    });

    ws1.addRow([]);
    // Mini comparativa con barras visuales
    const cmpHead = ws1.addRow(["", "COMPARATIVA", "MONTO", "VISUAL"]);
    cmpHead.eachCell((c, n) => { if (n > 1) { c.font = { bold: true, color: { argb: C.blanco } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.negro } }; c.border = BORDE; c.alignment = { horizontal: "center" }; } });
    const maxVal = Math.max(totIng, totEgr, 1);
    [["Ingresos", totIng, C.verde], ["Egresos", totEgr, C.rojo]].forEach(([lbl, val, col]) => {
      const r = ws1.addRow(["", lbl, val, ""]);
      r.getCell(2).border = BORDE; r.getCell(2).alignment = { indent: 1 };
      r.getCell(3).numFmt = '"Lps " #,##0.00'; r.getCell(3).border = BORDE; r.getCell(3).alignment = { horizontal: "right", indent: 1 };
      // Barra visual con bloques
      const pct = Math.round((val / maxVal) * 20);
      r.getCell(4).value = "█".repeat(Math.max(1, pct));
      r.getCell(4).font = { color: { argb: col }, size: 11 };
      r.getCell(4).border = BORDE;
    });

    ws1.views = [{ state: "frozen", ySplit: 0, showGridLines: false }];

    // ========== HOJA 2: INGRESOS ==========
    const ws2 = wb.addWorksheet("📈 Ingresos");
    ws2.columns = [{ width: 13 }, { width: 22 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 32 }];
    titulo(ws2, "DETALLE DE INGRESOS", 6);
    headerFila(ws2, ["Fecha", "Plataforma", "Monto", "Banco", "Usuario", "Detalle"]);
    const ing0 = ws2.rowCount;
    ingresos.forEach((m, i) => {
      const r = ws2.addRow([m.fecha, m.plataforma || "", m.monto, m.banco || "", m.userName || "", m.detalle || ""]);
      r.eachCell(c => { c.border = BORDE; });
      if (i % 2 === 1) r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.gris } }; });
      r.getCell(3).numFmt = '"Lps " #,##0.00';
      r.getCell(1).alignment = { horizontal: "center" };
    });
    const ing1 = ws2.rowCount;
    if (ingresos.length > 0) {
      ws2.autoFilter = { from: { row: ing0, column: 1 }, to: { row: ing1, column: 6 } };
      // Data bar visual sobre la columna Monto
      ws2.addConditionalFormatting({
        ref: `C${ing0 + 1}:C${ing1}`,
        rules: [{ type: "dataBar", color: { argb: C.verde } }],
      });
    }
    const totR2 = ws2.addRow(["TOTAL", "", ingresos.length ? { formula: `SUM(C${ing0 + 1}:C${ing1})` } : 0, "", `${ingresos.length} reg.`, ""]);
    totR2.eachCell(c => { c.font = { bold: true, color: { argb: C.blanco } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rojo } }; c.border = BORDE; });
    totR2.getCell(3).numFmt = '"Lps " #,##0.00';
    ws2.views = [{ state: "frozen", ySplit: 2 }];

    // ========== HOJA 3: EGRESOS ==========
    const ws3 = wb.addWorksheet("📉 Egresos");
    ws3.columns = [{ width: 13 }, { width: 22 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 32 }];
    titulo(ws3, "DETALLE DE EGRESOS", 6);
    headerFila(ws3, ["Fecha", "Motivo", "Monto", "Banco", "Usuario", "Detalle"]);
    const egr0 = ws3.rowCount;
    egresos.forEach((m, i) => {
      const r = ws3.addRow([m.fecha, m.motivo || m.plataforma || "", m.monto, m.banco || "", m.userName || "", m.detalle || ""]);
      r.eachCell(c => { c.border = BORDE; });
      if (i % 2 === 1) r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.gris } }; });
      r.getCell(3).numFmt = '"Lps " #,##0.00';
      r.getCell(1).alignment = { horizontal: "center" };
    });
    const egr1 = ws3.rowCount;
    if (egresos.length > 0) {
      ws3.autoFilter = { from: { row: egr0, column: 1 }, to: { row: egr1, column: 6 } };
      ws3.addConditionalFormatting({
        ref: `C${egr0 + 1}:C${egr1}`,
        rules: [{ type: "dataBar", color: { argb: C.rojo } }],
      });
    }
    const totR3 = ws3.addRow(["TOTAL", "", egresos.length ? { formula: `SUM(C${egr0 + 1}:C${egr1})` } : 0, "", `${egresos.length} reg.`, ""]);
    totR3.eachCell(c => { c.font = { bold: true, color: { argb: C.blanco } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rojo } }; c.border = BORDE; });
    totR3.getCell(3).numFmt = '"Lps " #,##0.00';
    ws3.views = [{ state: "frozen", ySplit: 2 }];

    // ========== HOJA 4: BANCOS ==========
    const ws4 = wb.addWorksheet("🏦 Bancos");
    ws4.columns = [{ width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 16 }];
    titulo(ws4, "ANÁLISIS POR BANCO", 5);
    headerFila(ws4, ["Banco", "Ingresos", "Egresos", "Neto", "Visual"]);
    const bancos = {};
    movimientos.forEach(m => {
      const b = m.banco || "Otro";
      if (!bancos[b]) bancos[b] = { ing: 0, egr: 0 };
      if (m.tipo === "ingreso") bancos[b].ing += m.monto;
      else bancos[b].egr += m.monto;
    });
    const ban0 = ws4.rowCount;
    const entries = Object.entries(bancos).sort((a, b) => (b[1].ing - b[1].egr) - (a[1].ing - a[1].egr));
    const maxNeto = Math.max(...entries.map(([, d]) => Math.abs(d.ing - d.egr)), 1);
    entries.forEach(([banco, d], i) => {
      const neto = d.ing - d.egr;
      const r = ws4.addRow([banco, d.ing, d.egr, neto, ""]);
      r.eachCell(c => { c.border = BORDE; });
      if (i % 2 === 1) r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.gris } }; });
      r.getCell(2).numFmt = '"Lps " #,##0.00';
      r.getCell(3).numFmt = '"Lps " #,##0.00';
      r.getCell(4).numFmt = '"Lps " #,##0.00';
      r.getCell(4).font = { bold: true, color: { argb: neto >= 0 ? C.verde : C.rojoOsc } };
      const pct = Math.round((Math.abs(neto) / maxNeto) * 15);
      r.getCell(5).value = "█".repeat(Math.max(1, pct));
      r.getCell(5).font = { color: { argb: neto >= 0 ? C.verde : C.rojo } };
    });
    const ban1 = ws4.rowCount;
    if (entries.length > 0) ws4.autoFilter = { from: { row: ban0, column: 1 }, to: { row: ban1, column: 5 } };
    const totR4 = ws4.addRow(["TOTAL", entries.length ? { formula: `SUM(B${ban0 + 1}:B${ban1})` } : 0, entries.length ? { formula: `SUM(C${ban0 + 1}:C${ban1})` } : 0, entries.length ? { formula: `SUM(D${ban0 + 1}:D${ban1})` } : 0, ""]);
    totR4.eachCell(c => { c.font = { bold: true, color: { argb: C.blanco } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rojo } }; c.border = BORDE; });
    totR4.getCell(2).numFmt = '"Lps " #,##0.00';
    totR4.getCell(3).numFmt = '"Lps " #,##0.00';
    totR4.getCell(4).numFmt = '"Lps " #,##0.00';
    ws4.views = [{ state: "frozen", ySplit: 2 }];

    // ========== HOJA 5: TOP PLATAFORMAS ==========
    const ws5 = wb.addWorksheet("🏆 Top Plataformas");
    ws5.columns = [{ width: 8 }, { width: 26 }, { width: 18 }, { width: 14 }, { width: 20 }];
    titulo(ws5, "TOP PLATAFORMAS POR INGRESOS", 5);
    headerFila(ws5, ["#", "Plataforma", "Ingresos", "Ventas", "Visual"]);
    const plats = {};
    ingresos.forEach(m => {
      const p = m.plataforma || "Otro";
      if (!plats[p]) plats[p] = { monto: 0, count: 0 };
      plats[p].monto += m.monto;
      plats[p].count++;
    });
    const topPlats = Object.entries(plats).sort((a, b) => b[1].monto - a[1].monto);
    const maxPlat = Math.max(...topPlats.map(([, d]) => d.monto), 1);
    topPlats.forEach(([plat, d], i) => {
      const medalla = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
      const r = ws5.addRow([medalla, plat, d.monto, d.count, ""]);
      r.eachCell(c => { c.border = BORDE; });
      if (i % 2 === 1) r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.gris } }; });
      r.getCell(1).alignment = { horizontal: "center" };
      r.getCell(3).numFmt = '"Lps " #,##0.00';
      r.getCell(4).alignment = { horizontal: "center" };
      const pct = Math.round((d.monto / maxPlat) * 18);
      r.getCell(5).value = "█".repeat(Math.max(1, pct));
      r.getCell(5).font = { color: { argb: C.dorado } };
    });
    ws5.views = [{ state: "frozen", ySplit: 2 }];

    const buffer = await wb.xlsx.writeBuffer();
    return buffer;
  } catch (e) {
    logErr("generarReporteExcelPorRango", e);
    throw e;
  }
}

module.exports = { generarReporteExcelPorRango };
