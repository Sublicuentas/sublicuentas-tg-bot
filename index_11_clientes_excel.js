/* ✅ SUBLICUENTAS — PARTE 11/12 — EXCEL CLIENTES PROFESIONAL
   GENERADOR DE LISTADO DE CLIENTES EN EXCEL COMPLETO
   -------------------------------------------------------------------
   ✅ FUNCIONES:
   - generarExcelClientesGeneral: Excel con todos los clientes
   - Incluye: Resumen, Listado detallado, Análisis, Filtros
   - Colores corporativos: Rojo/Negro
   - Formatos profesionales: Tablas, filtros automáticos
*/

const { ExcelJS, db } = require("./index_01_core");

// logErr local (evita problemas de carga circular)
function logErr(scope = "error", err = "") {
  try {
    console.error(`❌ [${scope}]`, err && err.message ? err.message : err);
  } catch (_) {}
}

// ===============================
// CONFIG COLORES
// ===============================
const COLORES = {
  rojo: "FF0000",
  negro: "000000",
  gris_oscuro: "1F1F1F",
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
    font: { bold: true, size: 11, color: { argb: COLORES.blanco } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.negro } },
    alignment: { horizontal: "center", vertical: "center" },
    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
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
  activo: {
    font: { color: { argb: COLORES.verde } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "E2EFDA" } },
  },
  inactivo: {
    font: { color: { argb: "C5504F" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "F4CCCC" } },
  },
};

// ===============================
// HELPERS
// ===============================
function normalizeDMY(s = "") {
  const v = String(s || "").trim();
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${String(Number(m[1])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[3]}`;
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  return "";
}

async function obtenerTodosLosClientes() {
  try {
    const snap = await db.collection("clientes").get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => {
      const nameA = (a.nombre || "").toLowerCase();
      const nameB = (b.nombre || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  } catch (e) {
    logErr("obtenerTodosLosClientes", e);
    return [];
  }
}

// ===============================
// GENERADOR DE EXCEL
// ===============================
async function generarExcelClientesGeneral() {
  try {
    const clientes = await obtenerTodosLosClientes();
    if (!clientes || clientes.length === 0) throw new Error("No hay clientes");

    const workbook = new ExcelJS.Workbook();

    // ✅ HOJA 1: RESUMEN
    const wsResumen = workbook.addWorksheet("📊 Resumen");
    await crearResumenClientes(wsResumen, clientes);

    // ✅ HOJA 2: LISTADO COMPLETO
    const wsListado = workbook.addWorksheet("👥 Listado Completo");
    await crearListadoClientes(wsListado, clientes);

    // ✅ HOJA 3: ANÁLISIS
    const wsAnalisis = workbook.addWorksheet("📈 Análisis");
    await crearAnalisisClientes(wsAnalisis, clientes);

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  } catch (e) {
    logErr("generarExcelClientesGeneral", e);
    throw e;
  }
}

// ===============================
// HOJA 1: RESUMEN
// ===============================
async function crearResumenClientes(ws, clientes) {
  ws.columns = [
    { width: 35 },
    { width: 20 },
    { width: 20 },
  ];

  // ENCABEZADO
  const titleRow = ws.addRow(["SUBLICUENTAS — RESUMEN DE CLIENTES", "", ""]);
  titleRow.font = { bold: true, size: 16, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  titleRow.alignment = { horizontal: "center", vertical: "center" };
  ws.mergeCells("A1:C1");
  ws.rowHeight = 25;

  const dateRow = ws.addRow([new Date().toLocaleDateString("es-HN"), "", ""]);
  dateRow.alignment = { horizontal: "center" };
  ws.mergeCells("A2:C2");

  ws.addRow(["", "", ""]);

  // ESTADÍSTICAS
  const activos = clientes.filter(c => c.estado === "Activo" || !c.estado).length;
  const inactivos = clientes.filter(c => c.estado === "Inactivo").length;
  const totalMensual = clientes.reduce((s, c) => s + (Number(c.total_mensual) || 0), 0);
  const serviciosActivos = clientes.reduce((s, c) => s + (c.servicios && Array.isArray(c.servicios) ? c.servicios.length : 0), 0);

  ws.addRow(["MÉTRICA", "CANTIDAD", "PORCENTAJE"]);
  const headerRow = ws.lastRow;
  headerRow.eachCell((cell) => { cell.style = ESTILOS.subheader; });

  const rowTotal = ws.addRow(["Total de clientes", clientes.length, "100%"]);
  rowTotal.getCell(2).font = { bold: true };

  const rowActivos = ws.addRow(["Clientes activos", activos, ((activos / clientes.length) * 100).toFixed(1) + "%"]);
  rowActivos.getCell(1).style = ESTILOS.activo;
  rowActivos.getCell(2).style = ESTILOS.activo;

  const rowInactivos = ws.addRow(["Clientes inactivos", inactivos, ((inactivos / clientes.length) * 100).toFixed(1) + "%"]);
  rowInactivos.getCell(1).style = ESTILOS.inactivo;
  rowInactivos.getCell(2).style = ESTILOS.inactivo;

  ws.addRow(["", "", ""]);

  const rowIngresos = ws.addRow(["Ingresos mensuales totales", totalMensual, ""]);
  rowIngresos.getCell(2).style = { ...ESTILOS.numero };

  const rowServicios = ws.addRow(["Total de servicios activos", serviciosActivos, ""]);
  rowServicios.getCell(2).font = { bold: true };

  const rowPromedio = ws.addRow(["Promedio por cliente", (totalMensual / clientes.length).toFixed(2), ""]);
  rowPromedio.getCell(2).style = { ...ESTILOS.numero };

  // Aplicar estilos
  for (let i = 5; i < ws.rowCount; i++) {
    const row = ws.getRow(i);
    if (i !== 5) {
      row.getCell(1).style = ESTILOS.dato;
      row.getCell(3).style = ESTILOS.dato;
    }
  }
}

// ===============================
// HOJA 2: LISTADO COMPLETO
// ===============================
async function crearListadoClientes(ws, clientes) {
  ws.columns = [
    { width: 5 },
    { width: 20 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 12 },
    { width: 12 },
    { width: 15 },
    { width: 15 },
    { width: 10 },
  ];

  // ENCABEZADO
  const titleRow = ws.addRow(["LISTADO COMPLETO DE CLIENTES", "", "", "", "", "", "", "", "", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:J1");
  ws.rowHeight = 20;

  ws.addRow(["", "", "", "", "", "", "", "", "", ""]);

  // ENCABEZADOS
  const headers = ["#", "Nombre", "Teléfono", "Email", "Vendedor", "Estado", "Servicios", "Total/Mes", "Próx. Renov.", "Días Rest."];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => { cell.style = ESTILOS.subheader; });

  // DATOS
  clientes.forEach((cliente, idx) => {
    const proximaRenov = cliente.proxima_renovacion || "";
    const hoy = new Date();
    const fechaRenov = new Date(String(proximaRenov).replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1"));
    const diasRest = Math.ceil((fechaRenov - hoy) / (1000 * 60 * 60 * 24));

    const row = ws.addRow([
      idx + 1,
      cliente.nombre || "",
      cliente.telefono || "",
      cliente.email || "",
      cliente.vendedor || "",
      cliente.estado || "Activo",
      cliente.servicios && Array.isArray(cliente.servicios) ? cliente.servicios.length : 0,
      cliente.total_mensual || 0,
      proximaRenov,
      diasRest > 0 ? diasRest : "Vencido",
    ]);

    // Aplicar estilos
    row.getCell(1).style = ESTILOS.dato;
    row.getCell(2).style = ESTILOS.dato;
    row.getCell(3).style = ESTILOS.dato;
    row.getCell(4).style = ESTILOS.dato;
    row.getCell(5).style = ESTILOS.dato;
    
    if (cliente.estado === "Activo" || !cliente.estado) {
      row.getCell(6).style = ESTILOS.activo;
    } else {
      row.getCell(6).style = ESTILOS.inactivo;
    }

    row.getCell(7).style = ESTILOS.numero;
    row.getCell(8).style = ESTILOS.numero;
    row.getCell(9).style = ESTILOS.fecha;
    row.getCell(10).style = ESTILOS.dato;
  });

  // Agregar filtros automáticos
  ws.autoFilter = { from: "A3", to: `J${clientes.length + 3}` };
}

// ===============================
// HOJA 3: ANÁLISIS
// ===============================
async function crearAnalisisClientes(ws, clientes) {
  ws.columns = [
    { width: 25 },
    { width: 15 },
    { width: 15 },
  ];

  // ENCABEZADO
  const titleRow = ws.addRow(["ANÁLISIS DE CLIENTES", "", ""]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.rojo } };
  ws.mergeCells("A1:C1");

  ws.addRow(["", "", ""]);

  // POR VENDEDOR
  ws.addRow(["INGRESOS POR VENDEDOR", "", ""]);
  const vendedorHeader = ws.lastRow;
  vendedorHeader.getCell(1).font = { bold: true };
  vendedorHeader.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.gris_oscuro } };

  ws.addRow(["Vendedor", "Clientes", "Ingresos"]);
  const vendedorHeadRow = ws.lastRow;
  vendedorHeadRow.eachCell((cell) => { cell.style = ESTILOS.subheader; });

  const vendedores = {};
  clientes.forEach(c => {
    const vendedor = c.vendedor || "Sin asignar";
    if (!vendedores[vendedor]) vendedores[vendedor] = { clientes: 0, ingresos: 0 };
    vendedores[vendedor].clientes++;
    vendedores[vendedor].ingresos += Number(c.total_mensual) || 0;
  });

  Object.entries(vendedores).forEach(([vendedor, datos]) => {
    const row = ws.addRow([vendedor, datos.clientes, datos.ingresos]);
    row.getCell(1).style = ESTILOS.dato;
    row.getCell(2).style = ESTILOS.numero;
    row.getCell(3).style = ESTILOS.numero;
  });

  ws.addRow(["", "", ""]);

  // POR ESTADO
  ws.addRow(["DISTRIBUCIÓN POR ESTADO", "", ""]);
  const estadoHeader = ws.lastRow;
  estadoHeader.getCell(1).font = { bold: true };
  estadoHeader.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES.gris_oscuro } };

  ws.addRow(["Estado", "Cantidad", "Porcentaje"]);
  const estadoHeadRow = ws.lastRow;
  estadoHeadRow.eachCell((cell) => { cell.style = ESTILOS.subheader; });

  const estados = { Activo: 0, Inactivo: 0 };
  clientes.forEach(c => {
    const estado = c.estado === "Inactivo" ? "Inactivo" : "Activo";
    estados[estado]++;
  });

  Object.entries(estados).forEach(([estado, cantidad]) => {
    const row = ws.addRow([estado, cantidad, ((cantidad / clientes.length) * 100).toFixed(1) + "%"]);
    if (estado === "Activo") {
      row.getCell(1).style = ESTILOS.activo;
    } else {
      row.getCell(1).style = ESTILOS.inactivo;
    }
    row.getCell(2).style = ESTILOS.numero;
    row.getCell(3).style = ESTILOS.dato;
  });
}

module.exports = {
  generarExcelClientesGeneral,
};
