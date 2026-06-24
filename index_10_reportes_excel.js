<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>index_10_reportes_excel.js actualizado - Sublicuentas</title>
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
    <h1>✅ Archivo actualizado: index_10_reportes_excel.js</h1>
    <p>Este HTML es solo para transportar/copiar el código. En su proyecto debe quedar con el nombre exacto <b>index_10_reportes_excel.js</b>.</p>
    <div class="warn">⚠️ No lo suba a Render/GitHub con extensión .html. Use el botón <b>Descargar como JS</b> o copie todo el código y guárdelo como <b>index_10_reportes_excel.js</b>.</div>
    <button onclick="copyCode()">Copiar código</button>
    <button onclick="downloadJS()">Descargar como JS</button>
    <button class="secondary" onclick="selectCode()">Seleccionar todo</button>
    <textarea id="code" spellcheck="false">/* ✅ SUBLICUENTAS — REPORTES EXCEL PROFESIONAL NIVEL SAIYAJIN
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
} = require(&quot;./index_01_core&quot;);

const FINANCE_COLLECTIONS_READ = Array.from(new Set([
  String(FINANZAS_COLLECTION || &quot;&quot;).trim(),
  &quot;finanzas_movimientos&quot;,
  &quot;finanzas&quot;,
].filter(Boolean)));

const COLORS = {
  rojo: &quot;FFE2231A&quot;,
  rojoOscuro: &quot;FFB71C1C&quot;,
  negro: &quot;FF0A0A1A&quot;,
  grisTitulo: &quot;FF222222&quot;,
  grisClaro: &quot;FFF4F6F8&quot;,
  grisMedio: &quot;FFE7E9EF&quot;,
  blanco: &quot;FFFFFFFF&quot;,
  verde: &quot;FF16A34A&quot;,
  verdeClaro: &quot;FFE6F4EA&quot;,
  rojoClaro: &quot;FFFCE8E6&quot;,
  azul: &quot;FF1D4ED8&quot;,
  azulClaro: &quot;FFEFF6FF&quot;,
  dorado: &quot;FFFFB300&quot;,
  morado: &quot;FF6D28D9&quot;,
  naranja: &quot;FFF97316&quot;,
};

const MONEY_FMT = &#x27;&quot;Lps &quot; #,##0.00&#x27;;
const INT_FMT = &#x27;#,##0&#x27;;
const PCT_FMT = &#x27;0.00%&#x27;;

const BORDER_THIN = {
  top: { style: &quot;thin&quot;, color: { argb: &quot;FFD7DCE2&quot; } },
  bottom: { style: &quot;thin&quot;, color: { argb: &quot;FFD7DCE2&quot; } },
  left: { style: &quot;thin&quot;, color: { argb: &quot;FFD7DCE2&quot; } },
  right: { style: &quot;thin&quot;, color: { argb: &quot;FFD7DCE2&quot; } },
};

function logErr(scope = &quot;error&quot;, err = &quot;&quot;) {
  try { console.error(`❌ [${scope}]`, err?.stack || err?.message || err); } catch (_) {}
}

function safeText(v = &quot;&quot;, fallback = &quot;&quot;) {
  const s = String(v ?? &quot;&quot;).replace(/\s+/g, &quot; &quot;).trim();
  return s || fallback;
}

function normalizeDMY(input = &quot;&quot;) {
  const s = String(input ?? &quot;&quot;).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const dd = String(Number(m[1])).padStart(2, &quot;0&quot;);
    const mm = String(Number(m[2])).padStart(2, &quot;0&quot;);
    const yyyy = String(Number(m[3])).padStart(4, &quot;0&quot;);
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0);
    if (d.getFullYear() === Number(yyyy) &amp;&amp; d.getMonth() === Number(mm) - 1 &amp;&amp; d.getDate() === Number(dd)) {
      return `${dd}/${mm}/${yyyy}`;
    }
    return &quot;&quot;;
  }

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const yyyy = String(Number(m[1])).padStart(4, &quot;0&quot;);
    const mm = String(Number(m[2])).padStart(2, &quot;0&quot;);
    const dd = String(Number(m[3])).padStart(2, &quot;0&quot;);
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0);
    if (d.getFullYear() === Number(yyyy) &amp;&amp; d.getMonth() === Number(mm) - 1 &amp;&amp; d.getDate() === Number(dd)) {
      return `${dd}/${mm}/${yyyy}`;
    }
  }
  return &quot;&quot;;
}

function dmyToMillis(dmy = &quot;&quot;) {
  const v = normalizeDMY(dmy);
  if (!v) return 0;
  const [dd, mm, yyyy] = v.split(&quot;/&quot;).map(Number);
  return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0).getTime();
}

function dmyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return &quot;&quot;;
  return `${String(date.getDate()).padStart(2, &quot;0&quot;)}/${String(date.getMonth() + 1).padStart(2, &quot;0&quot;)}/${date.getFullYear()}`;
}

function dateFromAny(v) {
  if (!v) return null;
  try {
    if (typeof v?.toDate === &quot;function&quot;) return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === &quot;number&quot; &amp;&amp; Number.isFinite(v)) return new Date(v &lt; 1e12 ? v * 1000 : v);
    if (typeof v === &quot;object&quot; &amp;&amp; Number.isFinite(v._seconds)) return new Date(Number(v._seconds) * 1000);
    if (typeof v === &quot;object&quot; &amp;&amp; Number.isFinite(v.seconds)) return new Date(Number(v.seconds) * 1000);
    const norm = normalizeDMY(String(v));
    if (norm) {
      const [dd, mm, yyyy] = norm.split(&quot;/&quot;).map(Number);
      return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
    }
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
  } catch (_) {
    return null;
  }
}

function extraerFechaMovimiento(data = {}) {
  return normalizeDMY(data.fecha || data.fecha_dmy || data.fechaMovimiento || data.date || &quot;&quot;) ||
    dmyFromDate(dateFromAny(data.fechaTS || data.fecha_ts || data.createdAt || data.created_at || data.updatedAt || data.updated_at || data.timestamp || data.ts));
}

function normalizeTipo(data = {}) {
  const raw = safeText(data.tipo || data.type || data.movimiento || &quot;ingreso&quot;).toLowerCase();
  if (raw.includes(&quot;egreso&quot;) || raw.includes(&quot;gasto&quot;) || raw.includes(&quot;salida&quot;)) return &quot;egreso&quot;;
  return &quot;ingreso&quot;;
}

function parseMonto(v) {
  if (typeof v === &quot;number&quot;) return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? &quot;0&quot;).replace(/[^0-9.,-]/g, &quot;&quot;).replace(/,/g, &quot;&quot;));
  return Number.isFinite(n) ? n : 0;
}

function normalizeMovimiento(id, data = {}, source = &quot;&quot;) {
  const tipo = normalizeTipo(data);
  const fecha = extraerFechaMovimiento(data);
  const monto = Math.abs(parseMonto(data.monto ?? data.valor ?? data.amount ?? data.total));
  return {
    id: String(id || &quot;&quot;),
    source: String(source || &quot;&quot;),
    fecha,
    fechaTs: dmyToMillis(fecha),
    tipo,
    monto,
    banco: safeText(data.banco || data.metodo || data.cuenta || data.bank || &quot;Sin banco&quot;),
    plataforma: safeText(data.plataforma || data.servicio || data.producto || data.platform || &quot;Sin plataforma&quot;),
    motivo: safeText(data.motivo || data.concepto || data.descripcion || data.detalle || &quot;Egreso&quot;),
    detalle: safeText(data.detalle || data.descripcion || data.nota || data.observacion || &quot;&quot;),
    userName: safeText(data.userName || data.usuario || data.admin || data.creadoPor || data.createdBy || &quot;&quot;),
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
        if (!row.fecha || row.fechaTs &lt; iniMs || row.fechaTs &gt; finMs) continue;
        const key = String(doc.id || `${col}:${row.fecha}:${row.tipo}:${row.monto}:${row.banco}:${row.plataforma}`);
        if (!byId.has(key)) byId.set(key, row);
      }
    } catch (e) {
      logErr(`getMovimientosPorRango:${col}`, e);
    }
  }

  return Array.from(byId.values()).sort((a, b) =&gt; a.fechaTs - b.fechaTs || a.tipo.localeCompare(b.tipo));
}

function setFill(cell, argb) { cell.fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb } }; }
function setFont(cell, opts = {}) { cell.font = { ...(cell.font || {}), ...opts }; }
function setBorder(cell) { cell.border = BORDER_THIN; }

function styleRow(row, opts = {}) {
  row.eachCell({ includeEmpty: true }, (cell) =&gt; {
    setBorder(cell);
    cell.alignment = { vertical: &quot;middle&quot;, ...(cell.alignment || {}) };
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
  titleCell.alignment = { horizontal: &quot;center&quot;, vertical: &quot;middle&quot; };

  const subRow = ws.addRow([subtitle]);
  subRow.height = 22;
  ws.mergeCells(subRow.number, 1, subRow.number, lastCol);
  const subCell = subRow.getCell(1);
  setFill(subCell, COLORS.negro);
  subCell.font = { bold: true, size: 10, color: { argb: COLORS.blanco } };
  subCell.alignment = { horizontal: &quot;center&quot;, vertical: &quot;middle&quot; };
  ws.addRow([]);
}

function addHeader(ws, values) {
  const row = ws.addRow(values);
  row.height = 24;
  row.eachCell({ includeEmpty: true }, (cell) =&gt; {
    setFill(cell, COLORS.negro);
    cell.font = { bold: true, color: { argb: COLORS.blanco } };
    cell.alignment = { horizontal: &quot;center&quot;, vertical: &quot;middle&quot;, wrapText: true };
    setBorder(cell);
  });
  return row.number;
}

function formulaBar(valueCell, maxRange, minBlocks = 1, maxBlocks = 24) {
  return `IF(${valueCell}&lt;=0,&quot;&quot;,REPT(&quot;█&quot;,MAX(${minBlocks},ROUND(${valueCell}/MAX(${maxRange})*${maxBlocks},0))))`;
}

function applyMoney(cell) { cell.numFmt = MONEY_FMT; }
function applyInteger(cell) { cell.numFmt = INT_FMT; }
function applyPercent(cell) { cell.numFmt = PCT_FMT; }

function normalizeBanco(raw = &quot;&quot;) {
  const s = safeText(raw, &quot;Sin banco&quot;);
  const low = s.toLowerCase().normalize(&quot;NFD&quot;).replace(/[\u0300-\u036f]/g, &quot;&quot;);
  if (low.includes(&quot;bac&quot;)) return &quot;BAC&quot;;
  if (low.includes(&quot;ficohsa&quot;)) return &quot;Ficohsa&quot;;
  if (low.includes(&quot;atlantida&quot;)) return &quot;Atlántida&quot;;
  if (low.includes(&quot;banpais&quot;)) return &quot;Banpaís&quot;;
  if (low.includes(&quot;occidente&quot;)) return &quot;Occidente&quot;;
  if (low.includes(&quot;davivienda&quot;)) return &quot;Davivienda&quot;;
  if (low.includes(&quot;lafise&quot;)) return &quot;Lafise&quot;;
  if (low.includes(&quot;tigo&quot;)) return &quot;Tigo Money&quot;;
  if (low.includes(&quot;paypal&quot;)) return &quot;PayPal&quot;;
  if (low.includes(&quot;binance&quot;)) return &quot;Binance&quot;;
  if (low.includes(&quot;efectivo&quot;) || low.includes(&quot;cash&quot;)) return &quot;Efectivo&quot;;
  if (low.includes(&quot;tengo&quot;)) return &quot;Tengo&quot;;
  if (low.includes(&quot;transferencia&quot;)) return &quot;Transferencia&quot;;
  return s;
}

function resumenPorBanco(rows = []) {
  const map = new Map();
  for (const m of rows) {
    const banco = normalizeBanco(m.banco);
    if (!map.has(banco)) map.set(banco, { banco, ingresos: 0, egresos: 0, movimientos: 0 });
    const row = map.get(banco);
    row.movimientos += 1;
    if (m.tipo === &quot;egreso&quot;) row.egresos += Number(m.monto || 0);
    else row.ingresos += Number(m.monto || 0);
  }
  return Array.from(map.values())
    .map((x) =&gt; ({ ...x, neto: x.ingresos - x.egresos }))
    .sort((a, b) =&gt; b.neto - a.neto || b.ingresos - a.ingresos);
}

function resumenTopPlataformas(rows = []) {
  const map = new Map();
  for (const m of rows.filter((x) =&gt; x.tipo === &quot;ingreso&quot;)) {
    const plat = safeText(m.plataforma, &quot;Sin plataforma&quot;);
    if (!map.has(plat)) map.set(plat, { plataforma: plat, ingresos: 0, ventas: 0 });
    const row = map.get(plat);
    row.ingresos += Number(m.monto || 0);
    row.ventas += 1;
  }
  return Array.from(map.values()).sort((a, b) =&gt; b.ingresos - a.ingresos || b.ventas - a.ventas);
}

function createResumenSheet(wb, meta) {
  const { ini, fin, ingresosTotal, egresosTotal, utilidad, margen, movimientos, ingTotalRow, egrTotalRow, topPlats, bancos } = meta;
  const ws = wb.addWorksheet(&quot;Resumen&quot;);
  ws.columns = [
    { width: 4 }, { width: 26 }, { width: 18 }, { width: 4 },
    { width: 26 }, { width: 18 }, { width: 4 }, { width: 32 },
  ];
  addTitle(ws, &quot;SUBLICUENTAS — REPORTE FINANCIERO&quot;, `Período ${ini} al ${fin}`, 8);

  const cardRows = [
    [&quot;💰 Total ingresos&quot;, { formula: `Ingresos!C${ingTotalRow}`, result: ingresosTotal }, COLORS.verde, MONEY_FMT],
    [&quot;💸 Total egresos&quot;, { formula: `Egresos!C${egrTotalRow}`, result: egresosTotal }, COLORS.rojo, MONEY_FMT],
    [&quot;📈 Utilidad neta&quot;, { formula: &quot;C5-C6&quot;, result: utilidad }, utilidad &gt;= 0 ? COLORS.verde : COLORS.rojoOscuro, MONEY_FMT],
    [&quot;📊 Margen&quot;, { formula: &quot;IF(C5=0,0,C7/C5)&quot;, result: margen }, COLORS.azul, PCT_FMT],
    [&quot;🧾 Movimientos&quot;, movimientos, COLORS.morado, INT_FMT],
  ];

  cardRows.forEach(([label, value, color, fmt], i) =&gt; {
    const row = ws.addRow([&quot;&quot;, label, value, &quot;&quot;, i === 0 ? &quot;Resumen ejecutivo&quot; : &quot;&quot;, i === 0 ? &quot;Estado&quot; : &quot;&quot;, &quot;&quot;, i === 0 ? &quot;Visual&quot; : &quot;&quot;]);
    row.height = 28;
    setFill(row.getCell(2), color);
    row.getCell(2).font = { bold: true, color: { argb: COLORS.blanco } };
    row.getCell(2).alignment = { vertical: &quot;middle&quot;, indent: 1 };
    row.getCell(3).font = { bold: true, size: 13, color: { argb: color } };
    row.getCell(3).alignment = { horizontal: &quot;right&quot;, vertical: &quot;middle&quot; };
    row.getCell(3).numFmt = fmt;
    if (i === 0) {
      setFill(row.getCell(5), COLORS.negro);
      setFill(row.getCell(6), COLORS.negro);
      setFill(row.getCell(8), COLORS.negro);
      [5, 6, 8].forEach((c) =&gt; { row.getCell(c).font = { bold: true, color: { argb: COLORS.blanco } }; row.getCell(c).alignment = { horizontal: &quot;center&quot; }; });
    }
    setBorder(row.getCell(2)); setBorder(row.getCell(3));
  });

  ws.addRow([]);
  const h = addHeader(ws, [&quot;&quot;, &quot;Comparativa&quot;, &quot;Monto&quot;, &quot;&quot;, &quot;Indicador&quot;, &quot;Valor&quot;, &quot;&quot;, &quot;Barra visual&quot;]);
  const maxBase = Math.max(ingresosTotal, egresosTotal, Math.abs(utilidad), 1);
  const comparativa = [
    [&quot;Ingresos&quot;, ingresosTotal, &quot;Ventas cobradas&quot;, ingresosTotal, COLORS.verde],
    [&quot;Egresos&quot;, egresosTotal, &quot;Gastos registrados&quot;, egresosTotal, COLORS.rojo],
    [&quot;Utilidad&quot;, utilidad, utilidad &gt;= 0 ? &quot;Ganancia&quot; : &quot;Pérdida&quot;, utilidad, utilidad &gt;= 0 ? COLORS.verde : COLORS.rojo],
  ];
  comparativa.forEach(([label, amount, desc, value, color], idx) =&gt; {
    const r = ws.addRow([&quot;&quot;, label, amount, &quot;&quot;, desc, value, &quot;&quot;, &quot;█&quot;.repeat(Math.max(1, Math.round((Math.abs(Number(amount) || 0) / maxBase) * 26)))]);
    r.height = 22;
    [2, 3, 5, 6, 8].forEach((c) =&gt; setBorder(r.getCell(c)));
    r.getCell(2).font = { bold: true };
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(6).numFmt = MONEY_FMT;
    r.getCell(8).font = { color: { argb: color }, bold: true };
    if (idx % 2 === 1) [2, 3, 5, 6, 8].forEach((c) =&gt; setFill(r.getCell(c), COLORS.grisClaro));
  });

  ws.addRow([]);
  addHeader(ws, [&quot;&quot;, &quot;Top plataforma&quot;, &quot;Ingresos&quot;, &quot;&quot;, &quot;Top banco&quot;, &quot;Neto&quot;, &quot;&quot;, &quot;Alerta&quot;]);
  for (let i = 0; i &lt; Math.max(3, topPlats.slice(0, 5).length, bancos.slice(0, 5).length); i++) {
    const p = topPlats[i] || null;
    const b = bancos[i] || null;
    const r = ws.addRow([
      &quot;&quot;,
      p ? `${i === 0 ? &quot;🥇&quot; : i === 1 ? &quot;🥈&quot; : i === 2 ? &quot;🥉&quot; : `${i + 1}.`} ${p.plataforma}` : &quot;—&quot;,
      p ? p.ingresos : 0,
      &quot;&quot;,
      b ? b.banco : &quot;—&quot;,
      b ? b.neto : 0,
      &quot;&quot;,
      i === 0 ? (utilidad &gt;= 0 ? &quot;✅ Operación positiva&quot; : &quot;⚠️ Revisar egresos&quot;) : &quot;&quot;,
    ]);
    [2, 3, 5, 6, 8].forEach((c) =&gt; setBorder(r.getCell(c)));
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(6).numFmt = MONEY_FMT;
    r.getCell(6).font = { bold: true, color: { argb: (b?.neto || 0) &gt;= 0 ? COLORS.verde : COLORS.rojo } };
  }

  ws.views = [{ state: &quot;frozen&quot;, ySplit: h }];
  ws.pageSetup = { orientation: &quot;landscape&quot;, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

function createDetalleSheet(wb, sheetName, title, subtitle, rows, tipo) {
  const isIngreso = tipo === &quot;ingreso&quot;;
  const color = isIngreso ? COLORS.verde : COLORS.rojo;
  const light = isIngreso ? COLORS.verdeClaro : COLORS.rojoClaro;
  const ws = wb.addWorksheet(sheetName);
  ws.columns = [
    { width: 13 }, { width: 26 }, { width: 15 }, { width: 18 },
    { width: 18 }, { width: 34 }, { width: 28 },
  ];
  addTitle(ws, title, subtitle, 7);
  const headerRow = addHeader(ws, [&quot;Fecha&quot;, isIngreso ? &quot;Plataforma&quot; : &quot;Motivo&quot;, &quot;Monto&quot;, &quot;Banco&quot;, &quot;Usuario&quot;, &quot;Detalle&quot;, &quot;Barra visual&quot;]);
  const firstDataRow = headerRow + 1;

  rows.forEach((m, i) =&gt; {
    const r = ws.addRow([
      m.fecha,
      isIngreso ? m.plataforma : m.motivo,
      Number(m.monto || 0),
      normalizeBanco(m.banco),
      m.userName || &quot;—&quot;,
      m.detalle || &quot;—&quot;,
      &quot;&quot;,
    ]);
    r.height = 21;
    styleRow(r, { fill: i % 2 === 1 ? COLORS.grisClaro : undefined });
    r.getCell(1).alignment = { horizontal: &quot;center&quot;, vertical: &quot;middle&quot; };
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(3).font = { bold: true, color: { argb: color } };
  });

  const lastDataRow = Math.max(firstDataRow, ws.rowCount);
  for (let rowNumber = firstDataRow; rowNumber &lt;= ws.rowCount; rowNumber++) {
    const barCell = ws.getCell(`G${rowNumber}`);
    barCell.value = rows.length ? { formula: formulaBar(`$C${rowNumber}`, `$C$${firstDataRow}:$C$${lastDataRow}`), result: &quot;&quot; } : &quot;&quot;;
    barCell.font = { bold: true, color: { argb: color } };
  }

  const totalRow = ws.addRow([&quot;TOTAL&quot;, &quot;&quot;, rows.length ? { formula: `SUM(C${firstDataRow}:C${lastDataRow})`, result: rows.reduce((s, x) =&gt; s + Number(x.monto || 0), 0) } : 0, &quot;&quot;, `${rows.length} registros`, &quot;&quot;, &quot;&quot;]);
  totalRow.height = 24;
  styleRow(totalRow, { fill: color, font: { bold: true, color: { argb: COLORS.blanco } } });
  totalRow.getCell(3).numFmt = MONEY_FMT;

  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastDataRow), column: 7 } };
  ws.views = [{ state: &quot;frozen&quot;, ySplit: headerRow }];
  ws.pageSetup = { orientation: &quot;landscape&quot;, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return { ws, totalRow: totalRow.number, firstDataRow, lastDataRow };
}

function createBancosSheet(wb, bancos, subtitle) {
  const ws = wb.addWorksheet(&quot;Bancos&quot;);
  ws.columns = [
    { width: 22 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 13 }, { width: 30 },
  ];
  addTitle(ws, &quot;ANÁLISIS POR BANCOS&quot;, subtitle, 6);
  const headerRow = addHeader(ws, [&quot;Banco&quot;, &quot;Ingresos&quot;, &quot;Egresos&quot;, &quot;Neto&quot;, &quot;Movs.&quot;, &quot;Barra neta&quot;]);
  const firstDataRow = headerRow + 1;

  bancos.forEach((b, i) =&gt; {
    const r = ws.addRow([b.banco, b.ingresos, b.egresos, b.neto, b.movimientos, &quot;&quot;]);
    r.height = 22;
    styleRow(r, { fill: i % 2 === 1 ? COLORS.grisClaro : undefined });
    [2, 3, 4].forEach((c) =&gt; r.getCell(c).numFmt = MONEY_FMT);
    r.getCell(4).font = { bold: true, color: { argb: b.neto &gt;= 0 ? COLORS.verde : COLORS.rojo } };
    r.getCell(5).numFmt = INT_FMT;
  });

  const lastDataRow = Math.max(firstDataRow, ws.rowCount);
  const maxNetoAbs = Math.max(...bancos.map((x) =&gt; Math.abs(Number(x.neto || 0))), 1);
  for (let rowNumber = firstDataRow; rowNumber &lt;= ws.rowCount; rowNumber++) {
    const netoVal = Number(ws.getCell(`D${rowNumber}`).value || 0);
    const barCell = ws.getCell(`F${rowNumber}`);
    barCell.value = bancos.length ? { formula: `IF($D${rowNumber}=0,&quot;&quot;,REPT(&quot;█&quot;,MAX(1,ROUND(ABS($D${rowNumber})/${maxNetoAbs}*24,0))))`, result: &quot;&quot; } : &quot;&quot;;
    barCell.font = { bold: true, color: { argb: netoVal &gt;= 0 ? COLORS.verde : COLORS.rojo } };
  }

  const totalRow = ws.addRow([
    &quot;TOTAL&quot;,
    bancos.length ? { formula: `SUM(B${firstDataRow}:B${lastDataRow})`, result: bancos.reduce((s, x) =&gt; s + x.ingresos, 0) } : 0,
    bancos.length ? { formula: `SUM(C${firstDataRow}:C${lastDataRow})`, result: bancos.reduce((s, x) =&gt; s + x.egresos, 0) } : 0,
    bancos.length ? { formula: `SUM(D${firstDataRow}:D${lastDataRow})`, result: bancos.reduce((s, x) =&gt; s + x.neto, 0) } : 0,
    bancos.reduce((s, x) =&gt; s + x.movimientos, 0),
    &quot;&quot;,
  ]);
  styleRow(totalRow, { fill: COLORS.rojo, font: { bold: true, color: { argb: COLORS.blanco } } });
  [2, 3, 4].forEach((c) =&gt; totalRow.getCell(c).numFmt = MONEY_FMT);
  totalRow.getCell(5).numFmt = INT_FMT;

  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastDataRow), column: 6 } };
  ws.views = [{ state: &quot;frozen&quot;, ySplit: headerRow }];
  ws.pageSetup = { orientation: &quot;landscape&quot;, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

function createGraficosSheet(wb, meta) {
  const { ini, fin, ingresosTotal, egresosTotal, utilidad, topPlats, bancos } = meta;
  const ws = wb.addWorksheet(&quot;Graficos&quot;);
  ws.columns = [
    { width: 4 }, { width: 28 }, { width: 16 }, { width: 40 }, { width: 4 }, { width: 28 }, { width: 16 }, { width: 36 },
  ];
  addTitle(ws, &quot;GRÁFICOS Y RANKINGS&quot;, `Barras visuales del ${ini} al ${fin}`, 8);

  addHeader(ws, [&quot;&quot;, &quot;Comparativa&quot;, &quot;Monto&quot;, &quot;Barra&quot;, &quot;&quot;, &quot;Indicador&quot;, &quot;Valor&quot;, &quot;Lectura&quot;]);
  const maxComp = Math.max(ingresosTotal, egresosTotal, Math.abs(utilidad), 1);
  [
    [&quot;Ingresos&quot;, ingresosTotal, COLORS.verde, &quot;Dinero cobrado&quot;],
    [&quot;Egresos&quot;, egresosTotal, COLORS.rojo, &quot;Dinero salido&quot;],
    [&quot;Utilidad&quot;, utilidad, utilidad &gt;= 0 ? COLORS.verde : COLORS.rojo, utilidad &gt;= 0 ? &quot;Ganancia neta&quot; : &quot;Pérdida neta&quot;],
  ].forEach(([label, amount, color, lectura], i) =&gt; {
    const r = ws.addRow([&quot;&quot;, label, amount, &quot;█&quot;.repeat(Math.max(1, Math.round((Math.abs(Number(amount) || 0) / maxComp) * 30))), &quot;&quot;, lectura, amount, utilidad &gt;= 0 ? &quot;✅ Controlado&quot; : &quot;⚠️ Revisar&quot;]);
    [2, 3, 4, 6, 7, 8].forEach((c) =&gt; setBorder(r.getCell(c)));
    r.getCell(2).font = { bold: true };
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(4).font = { bold: true, color: { argb: color } };
    r.getCell(7).numFmt = MONEY_FMT;
    if (i % 2 === 1) [2, 3, 4, 6, 7, 8].forEach((c) =&gt; setFill(r.getCell(c), COLORS.grisClaro));
  });

  ws.addRow([]);
  addHeader(ws, [&quot;&quot;, &quot;Top plataformas&quot;, &quot;Ingresos&quot;, &quot;Barra&quot;, &quot;&quot;, &quot;Top bancos&quot;, &quot;Neto&quot;, &quot;Barra&quot;]);
  const topLimit = Math.max(topPlats.slice(0, 10).length, bancos.slice(0, 10).length, 1);
  const maxPlat = Math.max(...topPlats.map((x) =&gt; x.ingresos), 1);
  const maxBanco = Math.max(...bancos.map((x) =&gt; Math.abs(x.neto)), 1);

  for (let i = 0; i &lt; topLimit; i++) {
    const p = topPlats[i];
    const b = bancos[i];
    const medalla = i === 0 ? &quot;🥇&quot; : i === 1 ? &quot;🥈&quot; : i === 2 ? &quot;🥉&quot; : `${i + 1}.`;
    const r = ws.addRow([
      &quot;&quot;,
      p ? `${medalla} ${p.plataforma}` : &quot;—&quot;,
      p ? p.ingresos : 0,
      p ? &quot;█&quot;.repeat(Math.max(1, Math.round((p.ingresos / maxPlat) * 26))) : &quot;&quot;,
      &quot;&quot;,
      b ? `${i + 1}. ${b.banco}` : &quot;—&quot;,
      b ? b.neto : 0,
      b ? &quot;█&quot;.repeat(Math.max(1, Math.round((Math.abs(b.neto) / maxBanco) * 24))) : &quot;&quot;,
    ]);
    [2, 3, 4, 6, 7, 8].forEach((c) =&gt; setBorder(r.getCell(c)));
    r.getCell(3).numFmt = MONEY_FMT;
    r.getCell(4).font = { bold: true, color: { argb: COLORS.dorado } };
    r.getCell(7).numFmt = MONEY_FMT;
    r.getCell(7).font = { bold: true, color: { argb: (b?.neto || 0) &gt;= 0 ? COLORS.verde : COLORS.rojo } };
    r.getCell(8).font = { bold: true, color: { argb: (b?.neto || 0) &gt;= 0 ? COLORS.verde : COLORS.rojo } };
    if (i % 2 === 1) [2, 3, 4, 6, 7, 8].forEach((c) =&gt; setFill(r.getCell(c), COLORS.grisClaro));
  }

  ws.views = [{ state: &quot;frozen&quot;, ySplit: 4 }];
  ws.pageSetup = { orientation: &quot;landscape&quot;, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

async function generarReporteExcelPorRango(fechaInicio, fechaFin) {
  const ini = normalizeDMY(fechaInicio);
  const fin = normalizeDMY(fechaFin);
  if (!ini || !fin) throw new Error(&quot;Fechas inválidas. Use dd/mm/yyyy.&quot;);
  if (dmyToMillis(ini) &gt; dmyToMillis(fin)) throw new Error(&quot;La fecha inicial no puede ser mayor que la fecha final.&quot;);

  try {
    const movimientos = await getMovimientosPorRango(ini, fin);
    const ingresos = movimientos.filter((m) =&gt; m.tipo === &quot;ingreso&quot;);
    const egresos = movimientos.filter((m) =&gt; m.tipo === &quot;egreso&quot;);
    const ingresosTotal = ingresos.reduce((s, m) =&gt; s + Number(m.monto || 0), 0);
    const egresosTotal = egresos.reduce((s, m) =&gt; s + Number(m.monto || 0), 0);
    const utilidad = ingresosTotal - egresosTotal;
    const margen = ingresosTotal &gt; 0 ? utilidad / ingresosTotal : 0;
    const topPlats = resumenTopPlataformas(movimientos);
    const bancos = resumenPorBanco(movimientos);

    const wb = new ExcelJS.Workbook();
    wb.creator = &quot;Sublicuentas Bot&quot;;
    wb.lastModifiedBy = &quot;Sublicuentas Bot&quot;;
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

    createDetalleSheet(wb, &quot;Ingresos&quot;, &quot;DETALLE DE INGRESOS&quot;, subtitle, ingresos, &quot;ingreso&quot;);
    createDetalleSheet(wb, &quot;Egresos&quot;, &quot;DETALLE DE EGRESOS&quot;, subtitle, egresos, &quot;egreso&quot;);
    createBancosSheet(wb, bancos, subtitle);
    createGraficosSheet(wb, { ini, fin, ingresosTotal, egresosTotal, utilidad, topPlats, bancos });

    // Vista y protección visual básica.
    wb.eachSheet((ws) =&gt; {
      ws.properties.defaultRowHeight = 18;
      ws.state = &quot;visible&quot;;
    });

    return await wb.xlsx.writeBuffer();
  } catch (e) {
    logErr(&quot;generarReporteExcelPorRango&quot;, e);
    throw e;
  }
}

module.exports = {
  generarReporteExcelPorRango,
  getMovimientosPorRango,
};
</textarea>
    <p class="small">Sublicuentas — Reportes Excel Finanzas fix.</p>
  </div>
<script>
const filename = 'index_10_reportes_excel.js';
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
