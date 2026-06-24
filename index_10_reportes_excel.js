const { ExcelJS } = require("./index_01_core");
const { db, logErr } = require("./index_01_core");
const FINANZAS_COLLECTION = "finanzas_movimientos";

function dmyToTimestamp(dmy = "") {
  const p = String(dmy || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!p) return 0;
  return new Date(Number(p[3]), Number(p[2]) - 1, Number(p[1])).getTime();
}

function normalizeDMY(s = "") {
  let v = String(s || "").trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${String(Number(m[1])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[3]}`;
  return "";
}

async function getMovimientosPorRango(fechaInicio, fechaFin) {
  try {
    const ini = normalizeDMY(fechaInicio);
    const fin = normalizeDMY(fechaFin);
    if (!ini || !fin) return [];
    
    const iniTs = dmyToTimestamp(ini);
    const finTs = dmyToTimestamp(fin) + 86400000;
    
    const snap = await db.collection(FINANZAS_COLLECTION).orderBy("fecha", "desc").limit(10000).get();
    const todos = snap.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id, 
        ...data,
        fecha: data.fecha || "",
        tipo: data.tipo || "",
        monto: Number(data.monto || 0)
      };
    });
    
    const filtrados = todos.filter(mov => {
      if (!mov.fecha) return false;
      const ts = dmyToTimestamp(normalizeDMY(mov.fecha));
      return ts >= iniTs && ts <= finTs;
    });
    
    return filtrados;
  } catch (e) {
    logErr("getMovimientosPorRango", e);
    return [];
  }
}

async function generarReporteExcelPorRango(fechaInicio, fechaFin) {
  try {
    const ini = normalizeDMY(fechaInicio);
    const fin = normalizeDMY(fechaFin);
    if (!ini || !fin) throw new Error("Fechas inválidas");
    if (dmyToTimestamp(ini) > dmyToTimestamp(fin)) throw new Error("Fecha inicial mayor que final");

    const movimientos = await getMovimientosPorRango(ini, fin);
    
    const workbook = new ExcelJS.Workbook();
    
    // HOJA 1: RESUMEN
    const wsResumen = workbook.addWorksheet("📊 Resumen");
    wsResumen.columns = [{ width: 35 }, { width: 20 }];
    
    const r1 = wsResumen.addRow(["SUBLICUENTAS — REPORTE FINANCIERO"]);
    r1.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    r1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    wsResumen.mergeCells("A1:B1");
    
    wsResumen.addRow([`Período: ${ini} - ${fin}`]);
    wsResumen.addRow([]);
    
    const ingresos = movimientos.filter(m => m.tipo === "ingreso").reduce((s, m) => s + (m.monto || 0), 0);
    const egresos = movimientos.filter(m => m.tipo === "egreso").reduce((s, m) => s + (m.monto || 0), 0);
    const utilidad = ingresos - egresos;
    
    const rh = wsResumen.addRow(["CONCEPTO", "MONTO"]);
    rh.font = { bold: true, color: { argb: "FFFFFFFF" } };
    rh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    
    const ri = wsResumen.addRow(["Ingresos", ingresos]);
    ri.getCell(2).numFmt = '"Lps" #,##0.00';
    
    const re = wsResumen.addRow(["Egresos", egresos]);
    re.getCell(2).numFmt = '"Lps" #,##0.00';
    
    wsResumen.addRow([]);
    const ru = wsResumen.addRow(["UTILIDAD", utilidad]);
    ru.font = { bold: true, color: { argb: "FFFFFFFF" } };
    ru.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
    ru.getCell(2).numFmt = '"Lps" #,##0.00';
    
    // HOJA 2: INGRESOS
    const wsIngresos = workbook.addWorksheet("📈 Ingresos");
    wsIngresos.columns = [
      { width: 12 }, { width: 20 }, { width: 15 }, { width: 15 }, { width: 20 }, { width: 30 }
    ];
    
    const ih = wsIngresos.addRow(["Fecha", "Plataforma", "Monto", "Banco", "Usuario", "Detalle"]);
    ih.font = { bold: true, color: { argb: "FFFFFFFF" } };
    ih.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    
    const ingresosData = movimientos.filter(m => m.tipo === "ingreso");
    ingresosData.forEach(mov => {
      const row = wsIngresos.addRow([mov.fecha || "", mov.plataforma || "", mov.monto || 0, mov.banco || "", mov.userName || "", mov.detalle || ""]);
      row.getCell(3).numFmt = '"Lps" #,##0.00';
    });
    
    wsIngresos.autoFilter.from = { row: 1, column: 1 };
    wsIngresos.autoFilter.to = { row: ingresosData.length + 1, column: 6 };
    
    const itotal = wsIngresos.addRow(["TOTAL", "", { formula: `SUM(C2:C${ingresosData.length + 1})` }, "", "", ""]);
    itotal.getCell(3).numFmt = '"Lps" #,##0.00';
    itotal.getCell(3).font = { bold: true };
    
    // HOJA 3: EGRESOS
    const wsEgresos = workbook.addWorksheet("📉 Egresos");
    wsEgresos.columns = [
      { width: 12 }, { width: 20 }, { width: 15 }, { width: 15 }, { width: 20 }, { width: 30 }
    ];
    
    const eh = wsEgresos.addRow(["Fecha", "Motivo", "Monto", "Banco", "Usuario", "Detalle"]);
    eh.font = { bold: true, color: { argb: "FFFFFFFF" } };
    eh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    
    const egresosData = movimientos.filter(m => m.tipo === "egreso");
    egresosData.forEach(mov => {
      const row = wsEgresos.addRow([mov.fecha || "", mov.motivo || "", mov.monto || 0, mov.banco || "", mov.userName || "", mov.detalle || ""]);
      row.getCell(3).numFmt = '"Lps" #,##0.00';
    });
    
    wsEgresos.autoFilter.from = { row: 1, column: 1 };
    wsEgresos.autoFilter.to = { row: egresosData.length + 1, column: 6 };
    
    const etotal = wsEgresos.addRow(["TOTAL", "", { formula: `SUM(C2:C${egresosData.length + 1})` }, "", "", ""]);
    etotal.getCell(3).numFmt = '"Lps" #,##0.00';
    etotal.getCell(3).font = { bold: true };
    
    // HOJA 4: BANCOS
    const wsBancos = workbook.addWorksheet("🏦 Bancos");
    wsBancos.columns = [{ width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];
    
    const bh = wsBancos.addRow(["Banco", "Ingresos", "Egresos", "Neto"]);
    bh.font = { bold: true, color: { argb: "FFFFFFFF" } };
    bh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    
    const bancos = {};
    movimientos.forEach(mov => {
      const banco = mov.banco || "Otro";
      if (!bancos[banco]) bancos[banco] = { ingresos: 0, egresos: 0 };
      if (mov.tipo === "ingreso") bancos[banco].ingresos += (mov.monto || 0);
      else bancos[banco].egresos += (mov.monto || 0);
    });
    
    let bankRow = 2;
    Object.entries(bancos).forEach(([banco, datos]) => {
      const row = wsBancos.addRow([banco, datos.ingresos, datos.egresos, datos.ingresos - datos.egresos]);
      row.getCell(2).numFmt = '"Lps" #,##0.00';
      row.getCell(3).numFmt = '"Lps" #,##0.00';
      row.getCell(4).numFmt = '"Lps" #,##0.00';
      bankRow++;
    });
    
    wsBancos.autoFilter.from = { row: 1, column: 1 };
    wsBancos.autoFilter.to = { row: bankRow - 1, column: 4 };
    
    const btotal = wsBancos.addRow(["TOTAL", "", "", ""]);
    btotal.getCell(1).font = { bold: true };
    btotal.getCell(2).value = { formula: `SUM(B2:B${bankRow - 1})` };
    btotal.getCell(2).numFmt = '"Lps" #,##0.00';
    btotal.getCell(2).font = { bold: true };
    btotal.getCell(3).value = { formula: `SUM(C2:C${bankRow - 1})` };
    btotal.getCell(3).numFmt = '"Lps" #,##0.00';
    btotal.getCell(3).font = { bold: true };
    btotal.getCell(4).value = { formula: `SUM(D2:D${bankRow - 1})` };
    btotal.getCell(4).numFmt = '"Lps" #,##0.00';
    btotal.getCell(4).font = { bold: true };
    
    // HOJA 5: GRÁFICOS
    const wsGraficos = workbook.addWorksheet("📊 Gráficos");
    wsGraficos.columns = [{ width: 40 }, { width: 20 }];
    
    const tg = wsGraficos.addRow(["📊 ANÁLISIS Y GRÁFICOS", ""]);
    tg.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    tg.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    wsGraficos.mergeCells("A1:B1");
    
    wsGraficos.addRow(["", ""]);
    wsGraficos.addRow(["CONCEPTO", "MONTO"]);
    
    const r2 = wsGraficos.addRow(["Ingresos", ingresos]);
    r2.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
    r2.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    r2.getCell(2).numFmt = '"Lps" #,##0.00';
    
    const r3 = wsGraficos.addRow(["Egresos", egresos]);
    r3.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    r3.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    r3.getCell(2).numFmt = '"Lps" #,##0.00';
    
    // Gráfico 1: Barras
    const chart1 = new ExcelJS.BarChart();
    chart1.type = "bar";
    chart1.title = "Ingresos vs Egresos";
    chart1.addSeries({ name: "Monto", ref: "'📊 Gráficos'!B4:B5" });
    chart1.height = 12;
    chart1.width = 20;
    wsGraficos.addChart(chart1, "A8");
    
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  } catch (e) {
    logErr("generarReporteExcelPorRango", e);
    throw e;
  }
}

module.exports = { generarReporteExcelPorRango };
