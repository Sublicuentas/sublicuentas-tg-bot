<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>index_11_clientes_excel.js actualizado - Sublicuentas</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;background:#0b0b10;color:#fff;margin:0;padding:18px;}
    .card{max-width:1100px;margin:0 auto;background:#15151d;border:1px solid #333;border-radius:16px;padding:18px;box-shadow:0 0 30px rgba(255,0,0,.15)}
    h1{font-size:22px;margin:0 0 10px;color:#ff3b3b}
    p{line-height:1.5;color:#ddd}
    .warn{background:#2b1111;border-left:5px solid #ff3b3b;padding:12px;border-radius:8px;margin:12px 0;color:#fff}
    button{background:#e2231a;color:white;border:0;border-radius:10px;padding:12px 16px;font-weight:bold;margin:6px 8px 12px 0;cursor:pointer}
    button.secondary{background:#222;border:1px solid #555}
    textarea{width:100%;height:70vh;background:#060608;color:#e8e8e8;border:1px solid #444;border-radius:10px;padding:14px;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.35;box-sizing:border-box;white-space:pre;}
    .small{font-size:13px;color:#aaa}
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ Archivo actualizado: index_11_clientes_excel.js</h1>
    <p>Este HTML es solo para transportar/copiar el código. En su proyecto debe quedar con el nombre exacto <b>index_11_clientes_excel.js</b>.</p>
    <div class="warn">⚠️ No lo suba a Render/GitHub con extensión .html. Use el botón <b>Descargar como JS</b> o copie todo el código y guárdelo como <b>index_11_clientes_excel.js</b>.</div>
    <button onclick="copyCode()">Copiar código</button>
    <button onclick="downloadJS()">Descargar como JS</button>
    <button class="secondary" onclick="selectCode()">Seleccionar todo</button>
    <textarea id="code" spellcheck="false">/* ✅ SUBLICUENTAS — PARTE 11/12 — EXCEL CLIENTES PROFESIONAL
   GENERADOR DE LISTADO DE CLIENTES EN EXCEL COMPLETO
   -------------------------------------------------------------------
   ✅ FUNCIONES:
   - generarExcelClientesGeneral: Excel con todos los clientes
   - Incluye: Resumen, Listado detallado, Análisis, Filtros
   - Colores corporativos: Rojo/Negro
   - Formatos profesionales: Tablas, filtros automáticos
*/

const { ExcelJS, db } = require(&quot;./index_01_core&quot;);

// logErr local (evita problemas de carga circular)
function logErr(scope = &quot;error&quot;, err = &quot;&quot;) {
  try {
    console.error(`❌ [${scope}]`, err &amp;&amp; err.message ? err.message : err);
  } catch (_) {}
}

// ===============================
// CONFIG COLORES
// ===============================
const COLORES = {
  rojo: &quot;FF0000&quot;,
  negro: &quot;000000&quot;,
  gris_oscuro: &quot;1F1F1F&quot;,
  verde: &quot;00B050&quot;,
  naranja: &quot;FF6600&quot;,
  blanco: &quot;FFFFFF&quot;,
};

const ESTILOS = {
  header: {
    font: { bold: true, size: 14, color: { argb: COLORES.blanco } },
    fill: { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: COLORES.rojo } },
    alignment: { horizontal: &quot;center&quot;, vertical: &quot;center&quot; },
    border: { top: { style: &quot;thin&quot; }, bottom: { style: &quot;thin&quot; }, left: { style: &quot;thin&quot; }, right: { style: &quot;thin&quot; } },
  },
  subheader: {
    font: { bold: true, size: 11, color: { argb: COLORES.blanco } },
    fill: { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: COLORES.negro } },
    alignment: { horizontal: &quot;center&quot;, vertical: &quot;center&quot; },
    border: { top: { style: &quot;thin&quot; }, bottom: { style: &quot;thin&quot; }, left: { style: &quot;thin&quot; }, right: { style: &quot;thin&quot; } },
  },
  dato: {
    border: { top: { style: &quot;thin&quot; }, bottom: { style: &quot;thin&quot; }, left: { style: &quot;thin&quot; }, right: { style: &quot;thin&quot; } },
    alignment: { horizontal: &quot;left&quot;, vertical: &quot;center&quot; },
  },
  numero: {
    numFmt: &#x27;&quot;Lps&quot; #,##0.00&#x27;,
    border: { top: { style: &quot;thin&quot; }, bottom: { style: &quot;thin&quot; }, left: { style: &quot;thin&quot; }, right: { style: &quot;thin&quot; } },
    alignment: { horizontal: &quot;right&quot;, vertical: &quot;center&quot; },
  },
  fecha: {
    numFmt: &quot;dd/mm/yyyy&quot;,
    border: { top: { style: &quot;thin&quot; }, bottom: { style: &quot;thin&quot; }, left: { style: &quot;thin&quot; }, right: { style: &quot;thin&quot; } },
    alignment: { horizontal: &quot;center&quot;, vertical: &quot;center&quot; },
  },
  activo: {
    font: { color: { argb: COLORES.verde } },
    fill: { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: &quot;E2EFDA&quot; } },
  },
  inactivo: {
    font: { color: { argb: &quot;C5504F&quot; } },
    fill: { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: &quot;F4CCCC&quot; } },
  },
};

// ===============================
// HELPERS
// ===============================
function normalizeDMY(s = &quot;&quot;) {
  const v = String(s || &quot;&quot;).trim();
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${String(Number(m[1])).padStart(2, &quot;0&quot;)}/${String(Number(m[2])).padStart(2, &quot;0&quot;)}/${m[3]}`;
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${String(Number(m[3])).padStart(2, &quot;0&quot;)}/${String(Number(m[2])).padStart(2, &quot;0&quot;)}/${m[1]}`;
  return &quot;&quot;;
}

async function obtenerTodosLosClientes() {
  try {
    const snap = await db.collection(&quot;clientes&quot;).get();
    return snap.docs.map(doc =&gt; ({ id: doc.id, ...doc.data() })).sort((a, b) =&gt; {
      const nameA = (a.nombre || &quot;&quot;).toLowerCase();
      const nameB = (b.nombre || &quot;&quot;).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  } catch (e) {
    logErr(&quot;obtenerTodosLosClientes&quot;, e);
    return [];
  }
}

// ===============================
// GENERADOR DE EXCEL
// ===============================
async function generarExcelClientesGeneral() {
  try {
    const clientes = await obtenerTodosLosClientes();
    if (!clientes || clientes.length === 0) throw new Error(&quot;No hay clientes&quot;);

    const workbook = new ExcelJS.Workbook();

    // ✅ HOJA 1: RESUMEN
    const wsResumen = workbook.addWorksheet(&quot;📊 Resumen&quot;);
    await crearResumenClientes(wsResumen, clientes);

    // ✅ HOJA 2: LISTADO COMPLETO
    const wsListado = workbook.addWorksheet(&quot;👥 Listado Completo&quot;);
    await crearListadoClientes(wsListado, clientes);

    // ✅ HOJA 3: ANÁLISIS
    const wsAnalisis = workbook.addWorksheet(&quot;📈 Análisis&quot;);
    await crearAnalisisClientes(wsAnalisis, clientes);

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  } catch (e) {
    logErr(&quot;generarExcelClientesGeneral&quot;, e);
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
  const titleRow = ws.addRow([&quot;SUBLICUENTAS — RESUMEN DE CLIENTES&quot;, &quot;&quot;, &quot;&quot;]);
  titleRow.font = { bold: true, size: 16, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: COLORES.rojo } };
  titleRow.alignment = { horizontal: &quot;center&quot;, vertical: &quot;center&quot; };
  ws.mergeCells(&quot;A1:C1&quot;);
  ws.rowHeight = 25;

  const dateRow = ws.addRow([new Date().toLocaleDateString(&quot;es-HN&quot;), &quot;&quot;, &quot;&quot;]);
  dateRow.alignment = { horizontal: &quot;center&quot; };
  ws.mergeCells(&quot;A2:C2&quot;);

  ws.addRow([&quot;&quot;, &quot;&quot;, &quot;&quot;]);

  // ESTADÍSTICAS
  const activos = clientes.filter(c =&gt; c.estado === &quot;Activo&quot; || !c.estado).length;
  const inactivos = clientes.filter(c =&gt; c.estado === &quot;Inactivo&quot;).length;
  const totalMensual = clientes.reduce((s, c) =&gt; s + (Number(c.total_mensual) || 0), 0);
  const serviciosActivos = clientes.reduce((s, c) =&gt; s + (c.servicios &amp;&amp; Array.isArray(c.servicios) ? c.servicios.length : 0), 0);

  ws.addRow([&quot;MÉTRICA&quot;, &quot;CANTIDAD&quot;, &quot;PORCENTAJE&quot;]);
  const headerRow = ws.lastRow;
  headerRow.eachCell((cell) =&gt; { cell.style = ESTILOS.subheader; });

  const rowTotal = ws.addRow([&quot;Total de clientes&quot;, clientes.length, &quot;100%&quot;]);
  rowTotal.getCell(2).font = { bold: true };

  const rowActivos = ws.addRow([&quot;Clientes activos&quot;, activos, ((activos / clientes.length) * 100).toFixed(1) + &quot;%&quot;]);
  rowActivos.getCell(1).style = ESTILOS.activo;
  rowActivos.getCell(2).style = ESTILOS.activo;

  const rowInactivos = ws.addRow([&quot;Clientes inactivos&quot;, inactivos, ((inactivos / clientes.length) * 100).toFixed(1) + &quot;%&quot;]);
  rowInactivos.getCell(1).style = ESTILOS.inactivo;
  rowInactivos.getCell(2).style = ESTILOS.inactivo;

  ws.addRow([&quot;&quot;, &quot;&quot;, &quot;&quot;]);

  const rowIngresos = ws.addRow([&quot;Ingresos mensuales totales&quot;, totalMensual, &quot;&quot;]);
  rowIngresos.getCell(2).style = { ...ESTILOS.numero };

  const rowServicios = ws.addRow([&quot;Total de servicios activos&quot;, serviciosActivos, &quot;&quot;]);
  rowServicios.getCell(2).font = { bold: true };

  const rowPromedio = ws.addRow([&quot;Promedio por cliente&quot;, (totalMensual / clientes.length).toFixed(2), &quot;&quot;]);
  rowPromedio.getCell(2).style = { ...ESTILOS.numero };

  // Aplicar estilos
  for (let i = 5; i &lt; ws.rowCount; i++) {
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
  const titleRow = ws.addRow([&quot;LISTADO COMPLETO DE CLIENTES&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: COLORES.rojo } };
  ws.mergeCells(&quot;A1:J1&quot;);
  ws.rowHeight = 20;

  ws.addRow([&quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;, &quot;&quot;]);

  // ENCABEZADOS
  const headers = [&quot;#&quot;, &quot;Nombre&quot;, &quot;Teléfono&quot;, &quot;Email&quot;, &quot;Vendedor&quot;, &quot;Estado&quot;, &quot;Servicios&quot;, &quot;Total/Mes&quot;, &quot;Próx. Renov.&quot;, &quot;Días Rest.&quot;];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) =&gt; { cell.style = ESTILOS.subheader; });

  // DATOS
  clientes.forEach((cliente, idx) =&gt; {
    const proximaRenov = cliente.proxima_renovacion || &quot;&quot;;
    const hoy = new Date();
    const fechaRenov = new Date(String(proximaRenov).replace(/(\d{2})\/(\d{2})\/(\d{4})/, &quot;$3-$2-$1&quot;));
    const diasRest = Math.ceil((fechaRenov - hoy) / (1000 * 60 * 60 * 24));

    const row = ws.addRow([
      idx + 1,
      cliente.nombre || &quot;&quot;,
      cliente.telefono || &quot;&quot;,
      cliente.email || &quot;&quot;,
      cliente.vendedor || &quot;&quot;,
      cliente.estado || &quot;Activo&quot;,
      cliente.servicios &amp;&amp; Array.isArray(cliente.servicios) ? cliente.servicios.length : 0,
      cliente.total_mensual || 0,
      proximaRenov,
      diasRest &gt; 0 ? diasRest : &quot;Vencido&quot;,
    ]);

    // Aplicar estilos
    row.getCell(1).style = ESTILOS.dato;
    row.getCell(2).style = ESTILOS.dato;
    row.getCell(3).style = ESTILOS.dato;
    row.getCell(4).style = ESTILOS.dato;
    row.getCell(5).style = ESTILOS.dato;
    
    if (cliente.estado === &quot;Activo&quot; || !cliente.estado) {
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
  ws.autoFilter = { from: &quot;A3&quot;, to: `J${clientes.length + 3}` };
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
  const titleRow = ws.addRow([&quot;ANÁLISIS DE CLIENTES&quot;, &quot;&quot;, &quot;&quot;]);
  titleRow.font = { bold: true, size: 14, color: { argb: COLORES.blanco } };
  titleRow.fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: COLORES.rojo } };
  ws.mergeCells(&quot;A1:C1&quot;);

  ws.addRow([&quot;&quot;, &quot;&quot;, &quot;&quot;]);

  // POR VENDEDOR
  ws.addRow([&quot;INGRESOS POR VENDEDOR&quot;, &quot;&quot;, &quot;&quot;]);
  const vendedorHeader = ws.lastRow;
  vendedorHeader.getCell(1).font = { bold: true };
  vendedorHeader.getCell(1).fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: COLORES.gris_oscuro } };

  ws.addRow([&quot;Vendedor&quot;, &quot;Clientes&quot;, &quot;Ingresos&quot;]);
  const vendedorHeadRow = ws.lastRow;
  vendedorHeadRow.eachCell((cell) =&gt; { cell.style = ESTILOS.subheader; });

  const vendedores = {};
  clientes.forEach(c =&gt; {
    const vendedor = c.vendedor || &quot;Sin asignar&quot;;
    if (!vendedores[vendedor]) vendedores[vendedor] = { clientes: 0, ingresos: 0 };
    vendedores[vendedor].clientes++;
    vendedores[vendedor].ingresos += Number(c.total_mensual) || 0;
  });

  Object.entries(vendedores).forEach(([vendedor, datos]) =&gt; {
    const row = ws.addRow([vendedor, datos.clientes, datos.ingresos]);
    row.getCell(1).style = ESTILOS.dato;
    row.getCell(2).style = ESTILOS.numero;
    row.getCell(3).style = ESTILOS.numero;
  });

  ws.addRow([&quot;&quot;, &quot;&quot;, &quot;&quot;]);

  // POR ESTADO
  ws.addRow([&quot;DISTRIBUCIÓN POR ESTADO&quot;, &quot;&quot;, &quot;&quot;]);
  const estadoHeader = ws.lastRow;
  estadoHeader.getCell(1).font = { bold: true };
  estadoHeader.getCell(1).fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: COLORES.gris_oscuro } };

  ws.addRow([&quot;Estado&quot;, &quot;Cantidad&quot;, &quot;Porcentaje&quot;]);
  const estadoHeadRow = ws.lastRow;
  estadoHeadRow.eachCell((cell) =&gt; { cell.style = ESTILOS.subheader; });

  const estados = { Activo: 0, Inactivo: 0 };
  clientes.forEach(c =&gt; {
    const estado = c.estado === &quot;Inactivo&quot; ? &quot;Inactivo&quot; : &quot;Activo&quot;;
    estados[estado]++;
  });

  Object.entries(estados).forEach(([estado, cantidad]) =&gt; {
    const row = ws.addRow([estado, cantidad, ((cantidad / clientes.length) * 100).toFixed(1) + &quot;%&quot;]);
    if (estado === &quot;Activo&quot;) {
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
</textarea>
    <p class="small">Sublicuentas — Reportes Excel Finanzas fix.</p>
  </div>
<script>
const filename = 'index_11_clientes_excel.js';
function selectCode(){ const t=document.getElementById('code'); t.focus(); t.select(); }
async function copyCode(){
  const t=document.getElementById('code');
  try{ await navigator.clipboard.writeText(t.value); alert('Código copiado. Guárdelo como '+filename); }
  catch(e){ t.focus(); t.select(); document.execCommand('copy'); alert('Código copiado. Guárdelo como '+filename); }
}
function downloadJS(){
  const code=document.getElementById('code').value;
  const blob=new Blob([code], {type:'text/javascript;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},1000);
}
</script>
</body>
</html>
