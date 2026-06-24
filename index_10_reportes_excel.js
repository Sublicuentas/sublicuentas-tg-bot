/* ✅ SUBLICUENTAS — PARTE 10/12 — REPORTES EXCEL PROFESIONAL
   GENERADOR DE REPORTES FINANCIEROS EXCEL CON GRÁFICOS
   -------------------------------------------------------------------
   ✅ FUNCIONES:
   - generarReporteExcelPorRango: Excel completo para rango de fechas
   - Incluye: Resumen ejecutivo, Detalle, Gráficos, Análisis
   - Colores corporativos: Rojo/Negro Sublicuentas
   - Formatos profesionales: Lps 1,234.56, fechas, tablas
   - Múltiples hojas: Resumen, Ingresos, Egresos, Gráficos
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
    if (!movimientos.length) throw new Error("No hay movimientos en ese rango");

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

  // DATOS
  const ingresos = movimientos.filter(m => m.tipo === "ingreso").sort((a, b) => {
    const fechaA = dmyToTimestamp(normalizeDMY(a.fecha || ""));
    const fechaB = dmyToTimestamp(normalizeDMY(b.fecha || ""));
    return fechaA - fechaB;
  });

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
    row.getCell(2).style = ESTILOS.dato;
    row.getCell(4).style = ESTILOS.dato;
    row.getCell(5).style = ESTILOS.dato;
    row.getCell(6).style = ESTILOS.dato;
  });

  // TOTAL
  ws.addRow(["", "", "", "", "", ""]);
  const totalRow = ws.addRow(["TOTAL INGRESOS", "", ingresos.reduce((s, m) => s + (m.monto || 0), 0), "", "", ""]);
  totalRow.eachCell((cell) => { cell.style = ESTILOS.total; });
  totalRow.getCell(3).style = { ...ESTILOS.numero, font: { bold: true, color: { argb: COLORES.blanco } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } } };
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

  // DATOS
  const egresos = movimientos.filter(m => m.tipo === "egreso").sort((a, b) => {
    const fechaA = dmyToTimestamp(normalizeDMY(a.fecha || ""));
    const fechaB = dmyToTimestamp(normalizeDMY(b.fecha || ""));
    return fechaA - fechaB;
  });

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
    row.getCell(2).style = ESTILOS.dato;
    row.getCell(4).style = ESTILOS.dato;
    row.getCell(5).style = ESTILOS.dato;
    row.getCell(6).style = ESTILOS.dato;
  });

  // TOTAL
  ws.addRow(["", "", "", "", "", ""]);
  const totalRow = ws.addRow(["TOTAL EGRESOS", "", egresos.reduce((s, m) => s + (m.monto || 0), 0), "", "", ""]);
  totalRow.eachCell((cell) => { cell.style = ESTILOS.total; });
  totalRow.getCell(3).style = { ...ESTILOS.numero, font: { bold: true, color: { argb: COLORES.blanco } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } } };
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

  // Agrupar por banco
  const bancos = {};
  movimientos.forEach(mov => {
    const banco = mov.banco || "Otro";
    if (!bancos[banco]) bancos[banco] = { ingresos: 0, egresos: 0 };
    if (mov.tipo === "ingreso") bancos[banco].ingresos += (mov.monto || 0);
    else bancos[banco].egresos += (mov.monto || 0);
  });

  Object.entries(bancos).forEach(([banco, datos]) => {
    const row = ws.addRow([banco, datos.ingresos, datos.egresos, datos.ingresos - datos.egresos]);
    row.getCell(2).style = ESTILOS.numero;
    row.getCell(3).style = ESTILOS.numero;
    row.getCell(4).style = ESTILOS.numero;
    row.getCell(1).style = ESTILOS.dato;
  });
}

module.exports = {
  generarReporteExcelPorRango,
};
