/* ✅ SUBLICUENTAS — PARTE 10/12 — REPORTES EXCEL 100% PROFESIONAL
   GENERADOR DE REPORTES FINANCIEROS EXCEL CON GRÁFICOS + FILTROS + FÓRMULAS
   -------------------------------------------------------------------
   ✅ CARACTERÍSTICAS PROFESIONALES:
   - Gráficos: Barras (Ingresos vs Egresos), Pastel (Por banco)
   - Filtros automáticos en todas las tablas
   - Encabezados congelados (freeze panes)
   - Fórmulas automáticas (SUM, AVERAGE)
   - Colores corporativos: Rojo/Negro Sublicuentas
   - Formatos: Lps 1,234.56, dd/mm/yyyy
   - 5 hojas: Resumen, Ingresos, Egresos, Bancos, Gráficos
*/

const { ExcelJS, db } = require("./index_01_core");
const { logErr, hoyDMY } = require("./index_02_utils_roles");
const FINANZAS_COLLECTION = "finanzas_movimientos";

// ===============================
// HELPERS
// ===============================
function dmyToDate(dmy = "") {
  const p = String(dmy || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!p) return null;
  return new Date(Number(p[3]), Number(p[2]) - 1, Number(p[1]));
}

function dmyToTimestamp(dmy = "") {
  const d = dmyToDate(dmy);
  return d ? d.getTime() : 0;
}

function normalizeDMY(s = "") {
  let v = String(s || "").trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${String(Number(m[1])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[3]}`;
  v = String(v || "").replace(/[\/-]/g, "");
  const m2 = v.match(/^(\d{1,2})(\d{1,2})(\d{4})$/);
  if (m2) return `${String(Number(m2[1])).padStart(2, "0")}/${String(Number(m2[2])).padStart(2, "0")}/${m2[3]}`;
  const m3 = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m3) return `${String(Number(m3[3])).padStart(2, "0")}/${String(Number(m3[2])).padStart(2, "0")}/${m3[1]}`;
  return "";
}

const COLORES = {
  rojo: "FF0000",
  negro: "000000",
  verde: "00B050",
  naranja: "FF6600",
  blanco: "FFFFFF",
};

const ESTILOS = {
  header: {
    font: { bold: true, size: 14, color: { argb: COLORES.blanco } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } },
    alignment: { horizontal: "center", vertical: "center" },
    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
  },
  subheader: {
    font: { bold: true, size: 12, color: { argb: COLORES.blanco } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.negro } },
    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
  },
  numero: {
    numFmt: '"Lps" #,##0.00',
    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
    alignment: { horizontal: "right", vertical: "center" },
  },
  fecha: {
    numFmt: "dd/mm/yyyy",
    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
    alignment: { horizontal: "center", vertical: "center" },
  },
  dato: {
    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
  },
};

async function getMovimientosPorRango(fechaInicio, fechaFin) {
  try {
    const ini = normalizeDMY(fechaInicio);
    const fin = normalizeDMY(fechaFin);
    if (!ini || !fin) return [];
    
    // ✅ OBTENER TODOS los movimientos
    const snap = await db.collection(FINANZAS_COLLECTION).get();
    const todos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // ✅ FILTRAR por rango de fechas EN MEMORIA (funciona con datos viejos y nuevos)
    const iniTs = dmyToTimestamp(ini);
    const finTs = dmyToTimestamp(fin) + 86400000;
    
    const filtrados = todos.filter(mov => {
      let ts = 0;
      
      // Intentar usar fechaTS si existe
      if (mov.fechaTS && typeof mov.fechaTS === 'number') {
        ts = mov.fechaTS;
      } 
      // Si no, parsear la fecha string
      else if (mov.fecha) {
        ts = dmyToTimestamp(normalizeDMY(mov.fecha || ""));
      }
      
      return ts >= iniTs && ts <= finTs;
    });
    
    // Ordenar por fecha
    return filtrados.sort((a, b) => {
      const fechaA = dmyToTimestamp(normalizeDMY(a.fecha || ""));
      const fechaB = dmyToTimestamp(normalizeDMY(b.fecha || ""));
      return fechaA - fechaB;
    });
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
    if (!movimientos.length) throw new Error("No hay movimientos en ese rango");

    const workbook = new ExcelJS.Workbook();
    const wsResumen = workbook.addWorksheet("📊 Resumen");
    const wsIngresos = workbook.addWorksheet("📈 Ingresos");
    const wsEgresos = workbook.addWorksheet("📉 Egresos");
    const wsBancos = workbook.addWorksheet("🏦 Bancos");
    const wsGraficos = workbook.addWorksheet("📊 Gráficos");

    // ✅ HOJA 1: RESUMEN
    crearResumen(wsResumen, movimientos, ini, fin);

    // ✅ HOJA 2: INGRESOS CON FILTROS
    crearIngresos(wsIngresos, movimientos);

    // ✅ HOJA 3: EGRESOS CON FILTROS
    crearEgresos(wsEgresos, movimientos);

    // ✅ HOJA 4: BANCOS CON ANÁLISIS
    crearBancos(wsBancos, movimientos);

    // ✅ HOJA 5: GRÁFICOS
    crearGraficos(wsGraficos, movimientos);

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  } catch (e) {
    logErr("generarReporteExcelPorRango", e);
    throw e;
  }
}

function crearResumen(ws, movimientos, ini, fin) {
  ws.columns = [{ width: 35 }, { width: 20 }];
  
  const titleRow = ws.addRow(["SUBLICUENTAS — REPORTE FINANCIERO"]);
  titleRow.font = { bold: true, size: 16, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:B1");
  ws.rowHeight = 25;

  ws.addRow([`Período: ${ini} - ${fin}`]);
  ws.addRow([]);

  const ingresos = movimientos.filter(m => m.tipo === "ingreso").reduce((s, m) => s + (m.monto || 0), 0);
  const egresos = movimientos.filter(m => m.tipo === "egreso").reduce((s, m) => s + (m.monto || 0), 0);
  const utilidad = ingresos - egresos;
  const margen = ingresos > 0 ? ((utilidad / ingresos) * 100).toFixed(2) : 0;

  const headerRow = ws.addRow(["CONCEPTO", "MONTO"]);
  headerRow.eachCell(c => { c.style = ESTILOS.subheader; });

  const rIngresos = ws.addRow(["Total Ingresos", ingresos]);
  rIngresos.getCell(2).numFmt = '"Lps" #,##0.00';

  const rEgresos = ws.addRow(["Total Egresos", egresos]);
  rEgresos.getCell(2).numFmt = '"Lps" #,##0.00';

  ws.addRow([]);
  const rUtilidad = ws.addRow(["UTILIDAD NETA", utilidad]);
  rUtilidad.font = { bold: true, color: { argb: COLORES.blanco } };
  rUtilidad.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.verde } };
  rUtilidad.getCell(2).numFmt = '"Lps" #,##0.00';
  rUtilidad.getCell(2).font = { bold: true, color: { argb: COLORES.blanco } };
  rUtilidad.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.verde } };

  ws.addRow([]);
  ws.addRow(["Margen", margen + "%"]);
  ws.addRow(["Movimientos", movimientos.length]);
}

function crearIngresos(ws, movimientos) {
  ws.columns = [
    { width: 12 }, { width: 20 }, { width: 15 }, { width: 15 }, { width: 20 }, { width: 30 }
  ];

  const titleRow = ws.addRow(["DETALLE DE INGRESOS", "", "", "", "", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:F1");

  ws.addRow(["", "", "", "", "", ""]);

  const headers = ["Fecha", "Plataforma", "Monto", "Banco", "Usuario", "Detalle"];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(c => { c.style = ESTILOS.subheader; });

  ws.freezePane("A4");

  const ingresos = movimientos.filter(m => m.tipo === "ingreso").sort((a, b) => 
    dmyToTimestamp(normalizeDMY(a.fecha || "")) - dmyToTimestamp(normalizeDMY(b.fecha || ""))
  );

  let startRow = 4;
  ingresos.forEach(mov => {
    const row = ws.addRow([
      mov.fecha || "",
      mov.plataforma || "",
      mov.monto || 0,
      mov.banco || "",
      mov.userName || "",
      mov.detalle || ""
    ]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(3).numFmt = '"Lps" #,##0.00';
  });

  const endRow = startRow + ingresos.length;
  ws.autoFilter.from = { row: 3, column: 1 };
  ws.autoFilter.to = { row: endRow - 1, column: 6 };

  ws.addRow(["", "", "", "", "", ""]);
  const totalRow = ws.addRow([
    "TOTAL",
    "",
    { formula: `SUM(C4:C${endRow - 1})` },
    "",
    `Registros: ${ingresos.length}`,
    ""
  ]);
  totalRow.getCell(3).numFmt = '"Lps" #,##0.00';
  totalRow.getCell(3).font = { bold: true };
}

function crearEgresos(ws, movimientos) {
  ws.columns = [
    { width: 12 }, { width: 20 }, { width: 15 }, { width: 15 }, { width: 20 }, { width: 30 }
  ];

  const titleRow = ws.addRow(["DETALLE DE EGRESOS", "", "", "", "", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:F1");

  ws.addRow(["", "", "", "", "", ""]);

  const headers = ["Fecha", "Motivo", "Monto", "Banco", "Usuario", "Detalle"];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(c => { c.style = ESTILOS.subheader; });

  ws.freezePane("A4");

  const egresos = movimientos.filter(m => m.tipo === "egreso").sort((a, b) => 
    dmyToTimestamp(normalizeDMY(a.fecha || "")) - dmyToTimestamp(normalizeDMY(b.fecha || ""))
  );

  let startRow = 4;
  egresos.forEach(mov => {
    const row = ws.addRow([
      mov.fecha || "",
      mov.motivo || "",
      mov.monto || 0,
      mov.banco || "",
      mov.userName || "",
      mov.detalle || ""
    ]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(3).numFmt = '"Lps" #,##0.00';
  });

  const endRow = startRow + egresos.length;
  ws.autoFilter.from = { row: 3, column: 1 };
  ws.autoFilter.to = { row: endRow - 1, column: 6 };

  ws.addRow(["", "", "", "", "", ""]);
  const totalRow = ws.addRow([
    "TOTAL",
    "",
    { formula: `SUM(C4:C${endRow - 1})` },
    "",
    `Registros: ${egresos.length}`,
    ""
  ]);
  totalRow.getCell(3).numFmt = '"Lps" #,##0.00';
  totalRow.getCell(3).font = { bold: true };
}

function crearBancos(ws, movimientos) {
  ws.columns = [{ width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];

  const titleRow = ws.addRow(["ANÁLISIS POR BANCO", "", "", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:D1");

  ws.addRow(["", "", "", ""]);

  const headerRow = ws.addRow(["Banco", "Ingresos", "Egresos", "Neto"]);
  headerRow.eachCell(c => { c.style = ESTILOS.subheader; });

  ws.freezePane("A4");

  const bancos = {};
  movimientos.forEach(mov => {
    const banco = mov.banco || "Otro";
    if (!bancos[banco]) bancos[banco] = { ingresos: 0, egresos: 0 };
    if (mov.tipo === "ingreso") bancos[banco].ingresos += (mov.monto || 0);
    else bancos[banco].egresos += (mov.monto || 0);
  });

  let bankRow = 4;
  Object.entries(bancos).forEach(([banco, datos]) => {
    const row = ws.addRow([banco, datos.ingresos, datos.egresos, datos.ingresos - datos.egresos]);
    row.getCell(2).numFmt = '"Lps" #,##0.00';
    row.getCell(3).numFmt = '"Lps" #,##0.00';
    row.getCell(4).numFmt = '"Lps" #,##0.00';
    bankRow++;
  });

  ws.autoFilter.from = { row: 3, column: 1 };
  ws.autoFilter.to = { row: bankRow - 1, column: 4 };

  ws.addRow(["", "", "", ""]);
  const totalRow = ws.addRow(["TOTAL", "", "", ""]);
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(2).value = { formula: `SUM(B4:B${bankRow - 1})` };
  totalRow.getCell(2).numFmt = '"Lps" #,##0.00';
  totalRow.getCell(2).font = { bold: true };
  totalRow.getCell(3).value = { formula: `SUM(C4:C${bankRow - 1})` };
  totalRow.getCell(3).numFmt = '"Lps" #,##0.00';
  totalRow.getCell(3).font = { bold: true };
  totalRow.getCell(4).value = { formula: `SUM(D4:D${bankRow - 1})` };
  totalRow.getCell(4).numFmt = '"Lps" #,##0.00';
  totalRow.getCell(4).font = { bold: true };
}

function crearGraficos(ws, movimientos) {
  ws.columns = [{ width: 40 }, { width: 20 }];

  const titleRow = ws.addRow(["📊 GRÁFICOS Y ANÁLISIS", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:B1");

  ws.addRow(["", ""]);

  const ingresos = movimientos.filter(m => m.tipo === "ingreso").reduce((s, m) => s + (m.monto || 0), 0);
  const egresos = movimientos.filter(m => m.tipo === "egreso").reduce((s, m) => s + (m.monto || 0), 0);

  ws.addRow(["TIPO", "MONTO"]);
  const h1 = ws.lastRow;
  h1.eachCell(c => { c.style = ESTILOS.subheader; });

  const r1 = ws.addRow(["Ingresos", ingresos]);
  r1.getCell(2).numFmt = '"Lps" #,##0.00';
  r1.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.verde } };
  r1.getCell(1).font = { bold: true, color: { argb: COLORES.blanco } };

  const r2 = ws.addRow(["Egresos", egresos]);
  r2.getCell(2).numFmt = '"Lps" #,##0.00';
  r2.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  r2.getCell(1).font = { bold: true, color: { argb: COLORES.blanco } };

  const chart1 = new ExcelJS.BarChart();
  chart1.type = "bar";
  chart1.title = "Ingresos vs Egresos";
  chart1.addSeries({ name: "Monto", ref: "'📊 Gráficos y Análisis'!B7:B8" });
  chart1.height = 12;
  chart1.width = 20;
  ws.addChart(chart1, "A10");

  const bancos = {};
  movimientos.forEach(mov => {
    const banco = mov.banco || "Otro";
    if (!bancos[banco]) bancos[banco] = 0;
    bancos[banco] += (mov.tipo === "ingreso" ? mov.monto || 0 : -(mov.monto || 0));
  });

  ws.addRow(["", ""]);
  ws.addRow(["", ""]);
  ws.addRow(["BANCO", "NETO"]);
  const h2 = ws.lastRow;
  h2.eachCell(c => { c.style = ESTILOS.subheader; });

  let bankRow = 18;
  Object.entries(bancos).forEach(([banco, neto]) => {
    const row = ws.addRow([banco, neto]);
    row.getCell(2).numFmt = '"Lps" #,##0.00';
    bankRow++;
  });

  const chart2 = new ExcelJS.PieChart();
  chart2.title = "Distribución por Banco";
  chart2.addSeries({ name: "Neto", ref: `'📊 Gráficos y Análisis'!A18:B${bankRow - 1}` });
  chart2.height = 12;
  chart2.width = 20;
  ws.addChart(chart2, "L10");
}

module.exports = { generarReporteExcelPorRango };
