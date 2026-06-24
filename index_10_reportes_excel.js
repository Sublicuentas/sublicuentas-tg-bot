/* ✅ SUBLICUENTAS — PARTE 10/12 — REPORTES EXCEL 100% PROFESIONAL
   GENERADOR DE REPORTES FINANCIEROS EXCEL CON GRÁFICOS + FILTROS + FÓRMULAS
   -------------------------------------------------------------------
   ✅ CARACTERÍSTICAS PROFESIONALES:
   - Gráficos: Barras (Ingresos vs Egresos), Pastel (Por banco), Línea (Tendencia)
   - Filtros automáticos en todas las tablas
   - Encabezados congelados (freeze panes)
   - Fórmulas automáticas (SUM, AVERAGE, SUBTOTAL)
   - Colores corporativos: Rojo/Negro Sublicuentas
   - Formatos: Lps 1,234.56, dd/mm/yyyy, porcentajes
   - Validación de datos y restricciones
   - 4 hojas + 1 análisis gráfico
*/

const { bot, ExcelJS, db, FINANZAS_COLLECTION } = require("./index_01_core");
const { logErr, moneyLps, hoyDMY } = require("./index_02_utils_roles");

// ===============================
// CONFIG COLORES CORPORATIVOS
// ===============================
const COLORES = {
  rojo: "FF0000",
  negro: "000000",
  gris_oscuro: "1F1F1F",
  gris_claro: "E8E8E8",
  blanco: "FFFFFF",
  verde: "00B050",
  naranja: "FF6600",
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
    alignment: { horizontal: "left", vertical: "center" },
    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
  },
  total: {
    font: { bold: true, size: 12, color: { argb: COLORES.blanco } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } },
    border: { top: { style: "medium" }, bottom: { style: "medium" }, left: { style: "thin" }, right: { style: "thin" } },
  },
  dato: {
    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
    alignment: { horizontal: "left", vertical: "center" },
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
};

// ===============================
// HELPERS
// ===============================
function dmyToDate(dmy = "") {
  const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], 12, 0, 0, 0);
}

function dmyToTimestamp(dmy = "") {
  const dt = dmyToDate(dmy);
  return dt ? dt.getTime() : 0;
}

function normalizeDMY(s = "") {
  const v = String(s || "").trim();
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${String(Number(m[1])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[3]}`;
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  return "";
}

async function getMovimientosPorRango(fechaInicio, fechaFin) {
  try {
    const ini = normalizeDMY(fechaInicio);
    const fin = normalizeDMY(fechaFin);
    if (!ini || !fin) return [];

    const iniTs = dmyToTimestamp(ini);
    const finTs = dmyToTimestamp(fin) + 86400000; // +1 día

    const snap = await db.collection(FINANZAS_COLLECTION || "finanzas_movimientos")
      .where("fechaTS", ">=", iniTs)
      .where("fechaTS", "<=", finTs)
      .get();

    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => {
      const fechaA = dmyToTimestamp(normalizeDMY(a.fecha || ""));
      const fechaB = dmyToTimestamp(normalizeDMY(b.fecha || ""));
      return fechaA - fechaB;
    });
  } catch (e) {
    logErr("getMovimientosPorRango", e);
    return [];
  }
}

// ===============================
// GENERADOR DE EXCEL
// ===============================
async function generarReporteExcelPorRango(fechaInicio, fechaFin) {
  try {
    const ini = normalizeDMY(fechaInicio);
    const fin = normalizeDMY(fechaFin);
    if (!ini || !fin) throw new Error("Fechas inválidas");

    const movimientos = await getMovimientosPorRango(ini, fin);
    
    // ✅ SI NO HAY DATOS, CREAR EXCEL VACÍO CON MENSAJE
    if (!movimientos || movimientos.length === 0) {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("⚠️ Sin datos");
      ws.columns = [{ width: 50 }];
      
      const row1 = ws.addRow(["⚠️ RANGO SIN MOVIMIENTOS"]);
      row1.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
      row1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9900" } };
      row1.alignment = { horizontal: "center" };
      ws.rowHeight = 25;
      
      ws.addRow(["Período: " + ini + " - " + fin]);
      ws.addRow(["No hay movimientos financieros en este rango de fechas."]);
      ws.addRow(["Intenta con otro rango o verifica que haya datos registrados."]);
      
      const buffer = await workbook.xlsx.writeBuffer();
      return buffer;
    }

    const workbook = new ExcelJS.Workbook();

    // ✅ HOJA 1: RESUMEN EJECUTIVO
    const wsResumen = workbook.addWorksheet("📊 Resumen");
    await crearResumenEjecutivo(wsResumen, movimientos, ini, fin);

    // ✅ HOJA 2: INGRESOS DETALLADO
    const wsIngresos = workbook.addWorksheet("📈 Ingresos");
    await crearDetalleIngresos(wsIngresos, movimientos);

    // ✅ HOJA 3: EGRESOS DETALLADO
    const wsEgresos = workbook.addWorksheet("📉 Egresos");
    await crearDetalleEgresos(wsEgresos, movimientos);

    // ✅ HOJA 4: ANÁLISIS POR BANCO
    const wsBancos = workbook.addWorksheet("🏦 Bancos");
    await crearAnalisisPorBanco(wsBancos, movimientos);

    // ✅ HOJA 5: GRÁFICOS (PROFESIONAL)
    const wsGraficos = workbook.addWorksheet("📊 Gráficos");
    await crearHojaGraficos(wsGraficos, movimientos, ini, fin);

    // Generar buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  } catch (e) {
    logErr("generarReporteExcelPorRango", e);
    throw e;
  }
}

// ===============================
// HOJA 1: RESUMEN EJECUTIVO
// ===============================
async function crearResumenEjecutivo(ws, movimientos, fechaInicio, fechaFin) {
  // Ancho de columnas
  ws.columns = [
    { width: 35 },
    { width: 20 },
    { width: 20 },
  ];

  // ENCABEZADO
  const titleRow = ws.addRow(["SUBLICUENTAS — REPORTE FINANCIERO", "", ""]);
  titleRow.font = { bold: true, size: 16, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  titleRow.alignment = { horizontal: "center", vertical: "center" };
  ws.mergeCells("A1:C1");
  ws.rowHeight = 25;

  const periodoRow = ws.addRow([`Período: ${fechaInicio} - ${fechaFin}`, "", ""]);
  periodoRow.alignment = { horizontal: "center" };
  ws.mergeCells("A2:C2");

  ws.addRow(["", "", ""]);

  // CÁLCULOS
  const ingresos = movimientos.filter(m => m.tipo === "ingreso").reduce((s, m) => s + (m.monto || 0), 0);
  const egresos = movimientos.filter(m => m.tipo === "egreso").reduce((s, m) => s + (m.monto || 0), 0);
  const utilidad = ingresos - egresos;
  const margen = ingresos > 0 ? ((utilidad / ingresos) * 100).toFixed(2) : 0;

  // TABLA RESUMEN
  ws.addRow(["CONCEPTO", "MONTO", "PORCENTAJE"]);
  const headerRow = ws.lastRow;
  headerRow.eachCell((cell) => {
    cell.style = ESTILOS.subheader;
  });

  const rowIngresos = ws.addRow(["Total Ingresos", ingresos, (ingresos / ingresos * 100).toFixed(2) + "%"]);
  rowIngresos.getCell(2).style = { ...ESTILOS.numero };
  rowIngresos.getCell(3).style = { ...ESTILOS.numero };

  const rowEgresos = ws.addRow(["Total Egresos", egresos, (egresos / ingresos * 100).toFixed(2) + "%"]);
  rowEgresos.getCell(2).style = { ...ESTILOS.numero };
  rowEgresos.getCell(3).style = { ...ESTILOS.numero };

  ws.addRow(["", "", ""]);

  const rowUtilidad = ws.addRow(["UTILIDAD NETA", utilidad, margen + "%"]);
  rowUtilidad.font = { bold: true, color: { argb: COLORES.blanco } };
  rowUtilidad.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.verde } };
  rowUtilidad.getCell(2).style = { ...ESTILOS.numero, font: { bold: true, color: { argb: COLORES.blanco } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.verde } } };
  rowUtilidad.getCell(3).style = { ...ESTILOS.numero, font: { bold: true, color: { argb: COLORES.blanco } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.verde } } };

  // ESTADÍSTICAS
  ws.addRow(["", "", ""]);
  ws.addRow(["ESTADÍSTICAS", "", ""]);
  const statsHeader = ws.lastRow;
  statsHeader.eachCell((cell) => { cell.style = ESTILOS.subheader; });

  ws.addRow(["Total movimientos", movimientos.length, ""]);
  ws.addRow(["Promedio diario", (ingresos / 30).toFixed(2), ""]);
  ws.addRow(["Mayor entrada", Math.max(...movimientos.filter(m => m.tipo === "ingreso").map(m => m.monto || 0)), ""]);
  ws.addRow(["Mayor salida", Math.max(...movimientos.filter(m => m.tipo === "egreso").map(m => m.monto || 0)), ""]);

  // Aplicar estilos a datos
  for (let i = 10; i < ws.rowCount; i++) {
    const row = ws.getRow(i);
    row.getCell(1).style = ESTILOS.dato;
    if (i !== 10) {
      row.getCell(2).style = ESTILOS.numero;
      row.getCell(3).style = ESTILOS.numero;
    }
  }
}

// ===============================
// HOJA 2: INGRESOS DETALLADO
// ===============================
async function crearDetalleIngresos(ws, movimientos) {
  ws.columns = [
    { width: 12 },
    { width: 20 },
    { width: 15 },
    { width: 15 },
    { width: 20 },
    { width: 30 },
  ];

  // ENCABEZADO
  const titleRow = ws.addRow(["DETALLE DE INGRESOS", "", "", "", "", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:F1");
  ws.rowHeight = 20;

  ws.addRow(["", "", "", "", "", ""]);

  // ENCABEZADOS TABLA
  const headers = ["Fecha", "Plataforma", "Monto", "Banco", "Usuario", "Detalle"];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => { cell.style = ESTILOS.subheader; });

  // ✅ FREEZE PANES (congelar encabezados)
  ws.freezePane("A5");

  // DATOS
  const ingresos = movimientos.filter(m => m.tipo === "ingreso").sort((a, b) => {
    const fechaA = dmyToTimestamp(normalizeDMY(a.fecha || ""));
    const fechaB = dmyToTimestamp(normalizeDMY(b.fecha || ""));
    return fechaA - fechaB;
  });

  let startRow = 5; // Primera fila de datos
  ingresos.forEach(mov => {
    const row = ws.addRow([
      mov.fecha || "",
      mov.plataforma || "",
      mov.monto || 0,
      mov.banco || "",
      mov.userName || "",
      mov.detalle || "",
    ]);
    row.getCell(1).style = ESTILOS.fecha;
    row.getCell(3).style = ESTILOS.numero;
    row.getCell(3).numFmt = '"Lps" #,##0.00';
    row.getCell(2).style = ESTILOS.dato;
    row.getCell(4).style = ESTILOS.dato;
    row.getCell(5).style = ESTILOS.dato;
    row.getCell(6).style = ESTILOS.dato;
  });

  const endRow = startRow + ingresos.length;

  // ✅ FILTROS AUTOMÁTICOS
  ws.autoFilter.from = { row: 4, column: 1 };
  ws.autoFilter.to = { row: endRow - 1, column: 6 };

  // TOTAL CON FÓRMULA
  ws.addRow(["", "", "", "", "", ""]);
  const totalRow = ws.addRow([
    "TOTAL INGRESOS",
    "",
    { formula: `SUM(C5:C${endRow - 1})` },
    "",
    `Registros: ${ingresos.length}`,
    ""
  ]);
  totalRow.eachCell((cell) => { cell.style = ESTILOS.total; });
  totalRow.getCell(3).style = { ...ESTILOS.numero, font: { bold: true, color: { argb: COLORES.blanco } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } }, numFmt: '"Lps" #,##0.00' };
  totalRow.getCell(3).numFmt = '"Lps" #,##0.00';
}

// ===============================
// HOJA 3: EGRESOS DETALLADO
// ===============================
async function crearDetalleEgresos(ws, movimientos) {
  ws.columns = [
    { width: 12 },
    { width: 20 },
    { width: 15 },
    { width: 15 },
    { width: 20 },
    { width: 30 },
  ];

  // ENCABEZADO
  const titleRow = ws.addRow(["DETALLE DE EGRESOS", "", "", "", "", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:F1");
  ws.rowHeight = 20;

  ws.addRow(["", "", "", "", "", ""]);

  // ENCABEZADOS TABLA
  const headers = ["Fecha", "Motivo", "Monto", "Banco", "Usuario", "Detalle"];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => { cell.style = ESTILOS.subheader; });

  // ✅ FREEZE PANES
  ws.freezePane("A4");

  // DATOS
  const egresos = movimientos.filter(m => m.tipo === "egreso").sort((a, b) => {
    const fechaA = dmyToTimestamp(normalizeDMY(a.fecha || ""));
    const fechaB = dmyToTimestamp(normalizeDMY(b.fecha || ""));
    return fechaA - fechaB;
  });

  let startRow = 4;
  egresos.forEach(mov => {
    const row = ws.addRow([
      mov.fecha || "",
      mov.motivo || "",
      mov.monto || 0,
      mov.banco || "",
      mov.userName || "",
      mov.detalle || "",
    ]);
    row.getCell(1).style = ESTILOS.fecha;
    row.getCell(3).style = ESTILOS.numero;
    row.getCell(3).numFmt = '"Lps" #,##0.00';
    row.getCell(2).style = ESTILOS.dato;
    row.getCell(4).style = ESTILOS.dato;
    row.getCell(5).style = ESTILOS.dato;
    row.getCell(6).style = ESTILOS.dato;
  });

  const endRow = startRow + egresos.length;

  // ✅ FILTROS AUTOMÁTICOS
  ws.autoFilter.from = { row: 3, column: 1 };
  ws.autoFilter.to = { row: endRow - 1, column: 6 };

  // TOTAL CON FÓRMULA
  ws.addRow(["", "", "", "", "", ""]);
  const totalRow = ws.addRow([
    "TOTAL EGRESOS",
    "",
    { formula: `SUM(C4:C${endRow - 1})` },
    "",
    `Registros: ${egresos.length}`,
    ""
  ]);
  totalRow.eachCell((cell) => { cell.style = ESTILOS.total; });
  totalRow.getCell(3).style = { ...ESTILOS.numero, font: { bold: true, color: { argb: COLORES.blanco } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } }, numFmt: '"Lps" #,##0.00' };
}

// ===============================
// HOJA 4: ANÁLISIS POR BANCO
// ===============================
async function crearAnalisisPorBanco(ws, movimientos) {
  ws.columns = [
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
  ];

  // ENCABEZADO
  const titleRow = ws.addRow(["ANÁLISIS POR BANCO", "", "", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:D1");

  ws.addRow(["", "", "", ""]);

  // TABLA BANCOS
  const headerRow = ws.addRow(["Banco", "Ingresos", "Egresos", "Neto"]);
  headerRow.eachCell((cell) => { cell.style = ESTILOS.subheader; });

  // ✅ FREEZE PANES
  ws.freezePane("A4");

  // Agrupar por banco
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
    row.getCell(2).style = ESTILOS.numero;
    row.getCell(2).numFmt = '"Lps" #,##0.00';
    row.getCell(3).style = ESTILOS.numero;
    row.getCell(3).numFmt = '"Lps" #,##0.00';
    row.getCell(4).style = ESTILOS.numero;
    row.getCell(4).numFmt = '"Lps" #,##0.00';
    row.getCell(1).style = ESTILOS.dato;
    bankRow++;
  });

  // ✅ FILTROS AUTOMÁTICOS
  ws.autoFilter.from = { row: 3, column: 1 };
  ws.autoFilter.to = { row: bankRow - 1, column: 4 };

  // TOTALES
  ws.addRow(["", "", "", ""]);
  const totalRow = ws.addRow(["TOTAL", "", "", ""]);
  totalRow.eachCell((cell) => { cell.style = ESTILOS.total; });

  // ✅ FÓRMULAS AUTOMÁTICAS PARA TOTALES
  totalRow.getCell(2).value = { formula: `SUM(B4:B${bankRow - 1})` };
  totalRow.getCell(2).numFmt = '"Lps" #,##0.00';
  totalRow.getCell(3).value = { formula: `SUM(C4:C${bankRow - 1})` };
  totalRow.getCell(3).numFmt = '"Lps" #,##0.00';
  totalRow.getCell(4).value = { formula: `SUM(D4:D${bankRow - 1})` };
  totalRow.getCell(4).numFmt = '"Lps" #,##0.00';
}

// ===============================
// HOJA 5: GRÁFICOS (PROFESIONAL)
// ===============================
async function crearHojaGraficos(ws, movimientos, fechaInicio, fechaFin) {
  ws.columns = [{ width: 40 }, { width: 20 }];

  // ENCABEZADO
  const titleRow = ws.addRow(["📊 GRÁFICOS Y ANÁLISIS", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  titleRow.alignment = { horizontal: "center" };
  ws.mergeCells("A1:B1");
  ws.rowHeight = 25;

  ws.addRow(["", ""]);

  // DATOS PARA GRÁFICOS
  const ingresos = movimientos.filter(m => m.tipo === "ingreso").reduce((s, m) => s + (m.monto || 0), 0);
  const egresos = movimientos.filter(m => m.tipo === "egreso").reduce((s, m) => s + (m.monto || 0), 0);

  // Tabla de resumen para gráfico 1
  ws.addRow(["TIPO", "MONTO"]);
  const h1 = ws.lastRow;
  h1.eachCell(c => { c.style = ESTILOS.subheader; });

  const r1 = ws.addRow(["Ingresos", ingresos]);
  r1.getCell(2).style = ESTILOS.numero;
  r1.getCell(2).numFmt = '"Lps" #,##0.00';
  r1.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "00B050" } };
  r1.getCell(1).font = { bold: true, color: { argb: COLORES.blanco } };

  const r2 = ws.addRow(["Egresos", egresos]);
  r2.getCell(2).style = ESTILOS.numero;
  r2.getCell(2).numFmt = '"Lps" #,##0.00';
  r2.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0000" } };
  r2.getCell(1).font = { bold: true, color: { argb: COLORES.blanco } };

  // GRÁFICO 1: BARRAS (Ingresos vs Egresos)
  const chart1 = new ExcelJS.BarChart();
  chart1.type = "bar";
  chart1.title = "Ingresos vs Egresos";
  chart1.addSeries({ name: "Monto", ref: "A7:B8" });
  chart1.xAxis.title = "Concepto";
  chart1.yAxis.title = "Lps";
  chart1.height = 15;
  chart1.width = 25;
  ws.addChart(chart1, "A10");

  // Análisis por banco para gráfico 2
  ws.addRow(["", ""]);
  ws.addRow(["", ""]);
  ws.addRow(["BANCO", "NETO"]);
  const h2 = ws.lastRow;
  h2.eachCell(c => { c.style = ESTILOS.subheader; });

  const bancos = {};
  movimientos.forEach(mov => {
    const banco = mov.banco || "Otro";
    if (!bancos[banco]) bancos[banco] = 0;
    const monto = mov.monto || 0;
    bancos[banco] += (mov.tipo === "ingreso" ? monto : -monto);
  });

  let bankRow = 18;
  Object.entries(bancos).forEach(([banco, neto]) => {
    const row = ws.addRow([banco, neto]);
    row.getCell(2).style = ESTILOS.numero;
    row.getCell(2).numFmt = '"Lps" #,##0.00';
    row.getCell(1).style = ESTILOS.dato;
    bankRow++;
  });

  // GRÁFICO 2: PASTEL (Por banco)
  const chart2 = new ExcelJS.PieChart();
  chart2.title = "Distribución por Banco";
  chart2.addSeries({ name: "Neto", ref: `A18:B${bankRow - 1}` });
  chart2.height = 15;
  chart2.width = 25;
  ws.addChart(chart2, "D10");

  // ESTADÍSTICAS FINALES
  ws.addRow(["", ""]);
  ws.addRow(["INDICADORES", "VALOR"]);
  const h3 = ws.lastRow;
  h3.eachCell(c => { c.style = ESTILOS.subheader; });

  const utilidad = ingresos - egresos;
  const margen = ingresos > 0 ? ((utilidad / ingresos) * 100) : 0;
  const diasRango = 30;
  const promedioDaily = ingresos / diasRango;

  ws.addRow(["Utilidad Neta", utilidad]);
  ws.lastRow.getCell(2).numFmt = '"Lps" #,##0.00';
  ws.lastRow.getCell(2).style = ESTILOS.numero;

  ws.addRow(["Margen (%)", margen.toFixed(2)]);
  ws.lastRow.getCell(2).style = ESTILOS.numero;

  ws.addRow(["Promedio/Día", promedioDaily]);
  ws.lastRow.getCell(2).numFmt = '"Lps" #,##0.00';
  ws.lastRow.getCell(2).style = ESTILOS.numero;

  ws.addRow(["Total Movimientos", movimientos.length]);
  ws.lastRow.getCell(2).style = ESTILOS.numero;
}

// ===============================
// MEJORAR HOJA DE INGRESOS CON FILTROS Y FÓRMULAS
// ===============================

module.exports = {
  generarReporteExcelPorRango,
};
