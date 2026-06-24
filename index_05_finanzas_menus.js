<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>index_05_finanzas_menus.js actualizado - Sublicuentas</title>
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
    <h1>✅ Archivo actualizado: index_05_finanzas_menus.js</h1>
    <p>Este HTML es solo para transportar/copiar el código. En su proyecto debe quedar con el nombre exacto <b>index_05_finanzas_menus.js</b>.</p>
    <div class="warn">⚠️ No lo suba a Render/GitHub con extensión .html. Use el botón <b>Descargar como JS</b> o copie todo el código y guárdelo como <b>index_05_finanzas_menus.js</b>.</div>
    <button onclick="copyCode()">Copiar código</button>
    <button onclick="downloadJS()">Descargar como JS</button>
    <button class="secondary" onclick="selectCode()">Seleccionar todo</button>
    <textarea id="code" spellcheck="false">/* ✅ SUBLICUENTAS TG BOT — PARTE 5/6 OPTIMIZADA v3
   FINANZAS / REPORTES / EXCEL / MENÚS / DASHBOARD / BACKUP DOMINICAL
   -------------------------------------------------------------------
   ✅ CAMBIO v3:
   - Recordatorios de vencimiento: de 9PM → 11AM del día anterior
   - Función renombrada: enviarNotificacion9PM → enviarRecordatorios11AM
   - Scheduler actualizado: hh === 11 en lugar de hh === 21
   - Backup dominical se mantiene a las 9PM los domingos
*/

const fs = require(&quot;fs&quot;);

const {
  bot, admin, db, ExcelJS, PLATAFORMAS, FINANZAS_COLLECTION,
} = require(&quot;./index_01_core&quot;);

const {
  escMD, upsertPanel, parseFechaFinanceInput, getMonthLabelFromKey,
  getMonthKeyFromDMY, isFechaDMY, hoyDMY, moneyLps, logErr, normalizarPlataforma,
} = require(&quot;./index_02_utils_roles&quot;);

const { humanPlataforma, obtenerRenovacionesPorFecha } = require(&quot;./index_03_clientes_crm&quot;);

// ===============================
// CONFIG
// ===============================
const FIN_BANCOS_LOCAL = [
  &quot;🏦 BAC&quot;, &quot;🏦 Ficohsa&quot;, &quot;🏦 Atlántida&quot;, &quot;🏦 Banpaís&quot;, &quot;🏦 Occidente&quot;, &quot;🏦 Davivienda&quot;,
  &quot;🏦 Lafise&quot;, &quot;💵 Efectivo&quot;, &quot;📱 Tigo Money&quot;, &quot;📱 Tengo&quot;, &quot;💳 PayPal&quot;, &quot;🪙 Binance&quot;, &quot;🔁 Otro&quot;,
];

const FIN_MOTIVOS_EGRESO_LOCAL = [
  &quot;🔄 Renovaciones&quot;, &quot;🆕 Cuentas nuevas&quot;, &quot;👤 Pago revendedor&quot;, &quot;👥 Pago planilla&quot;,
  &quot;📣 Publicidad&quot;, &quot;📦 Otros gastos&quot;,
];

const PLATFORM_KEYS = Array.isArray(PLATAFORMAS) ? PLATAFORMAS : Object.keys(PLATAFORMAS || {});

const FINANCE_COLLECTION_PRIMARY = String(FINANZAS_COLLECTION || &quot;&quot;).trim() || &quot;finanzas_movimientos&quot;;
const FINANCE_COLLECTIONS_READ = Array.from(new Set([FINANCE_COLLECTION_PRIMARY, &quot;finanzas_movimientos&quot;, &quot;finanzas&quot;].filter(Boolean)));

// ===============================
// HELPERS BASE
// ===============================
function normalizeFinanceDocRow(id, data = {}, source = &quot;&quot;) { return { id: String(id || &quot;&quot;), _source: String(source || &quot;&quot;), ...(data || {}) }; }
function normalizeMonthKey(key = &quot;&quot;) { const s = String(key || &quot;&quot;).trim(); let m = s.match(/^(\d{4})-(\d{2})$/); if (m) return `${m[1]}-${m[2]}`; m = s.match(/^(\d{2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1]}`; return &quot;&quot;; }
function altMonthKey(key = &quot;&quot;) { const k = normalizeMonthKey(key); if (!k) return &quot;&quot;; const m = k.match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}/${m[1]}` : &quot;&quot;; }
function platMeta(key = &quot;&quot;) { if (Array.isArray(PLATAFORMAS)) return {}; return PLATAFORMAS[String(key || &quot;&quot;).trim()] || {}; }
function humanPlatSafe(key = &quot;&quot;) { try { return humanPlataforma(key); } catch (_) { return platMeta(key)?.nombre || String(key || &quot;&quot;); } }
function pairButtons(buttons = []) { const rows = []; for (let i = 0; i &lt; buttons.length; i += 2) rows.push(buttons.slice(i, i + 2)); return rows; }
function categoryOfPlat(key = &quot;&quot;) {
  const k = String(key || &quot;&quot;).trim().toLowerCase();
  const meta = platMeta(k);
  const c = String(meta.categoria || &quot;&quot;).toLowerCase().trim();
  if ([&quot;video&quot;,&quot;musica&quot;,&quot;iptv&quot;,&quot;diseno_ia&quot;].includes(c)) return c;
  if ([&quot;netflix&quot;,&quot;vipnetflix&quot;,&quot;disneyp&quot;,&quot;disneys&quot;,&quot;hbomax&quot;,&quot;primevideo&quot;,&quot;paramount&quot;,&quot;crunchyroll&quot;,&quot;vix&quot;,&quot;appletv&quot;,&quot;universal&quot;].includes(k)) return &quot;video&quot;;
  if ([&quot;spotify&quot;,&quot;youtube&quot;,&quot;deezer&quot;].includes(k)) return &quot;musica&quot;;
  if ([&quot;oleadatv1&quot;,&quot;oleadatv3&quot;,&quot;iptv1&quot;,&quot;iptv3&quot;,&quot;iptv4&quot;].includes(k)) return &quot;iptv&quot;;
  if ([&quot;canva&quot;,&quot;gemini&quot;,&quot;chatgpt&quot;].includes(k)) return &quot;diseno_ia&quot;;
  return &quot;video&quot;;
}
function inventoryLabel(key = &quot;&quot;) {
  // ✅ Sin emojis en los botones — evita encoding issues con node-telegram-bot-api
  return humanPlatSafe(key);
}
function kbFromItems(items = []) {
  const buttons = items.map((key) =&gt; ({ text: inventoryLabel(key), callback_data: `inv:${String(key)}:0` }));
  return pairButtons(buttons);
}
function dmyToDate(dmy = &quot;&quot;) {
  const s = String(dmy || &quot;&quot;).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  return dt;
}
function dmyToMillis(dmy = &quot;&quot;) { const dt = dmyToDate(dmy); return dt ? dt.getTime() : 0; }
function dmyToTimestamp(dmy = &quot;&quot;) { const dt = dmyToDate(dmy); return dt ? admin.firestore.Timestamp.fromDate(dt) : null; }
function normalizeDMY(s = &quot;&quot;) {
  const v = String(s || &quot;&quot;).trim();
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${String(Number(m[1])).padStart(2,&quot;0&quot;)}/${String(Number(m[2])).padStart(2,&quot;0&quot;)}/${m[3]}`;
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${String(Number(m[3])).padStart(2,&quot;0&quot;)}/${String(Number(m[2])).padStart(2,&quot;0&quot;)}/${m[1]}`;
  return &quot;&quot;;
}
function tsToDMY(ts) {
  try {
    if (!ts) return &quot;&quot;;
    let d = null;
    if (typeof ts?.toDate === &quot;function&quot;) d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else if (typeof ts === &quot;number&quot; &amp;&amp; Number.isFinite(ts)) d = new Date(ts);
    else if (typeof ts === &quot;string&quot;) { const direct = normalizeDMY(ts); if (direct) return direct; const parsed = new Date(ts); if (!isNaN(parsed.getTime())) d = parsed; }
    else if (typeof ts === &quot;object&quot; &amp;&amp; Number.isFinite(ts._seconds)) d = new Date(Number(ts._seconds) * 1000);
    if (!(d instanceof Date) || isNaN(d.getTime())) return &quot;&quot;;
    return `${String(d.getDate()).padStart(2,&quot;0&quot;)}/${String(d.getMonth()+1).padStart(2,&quot;0&quot;)}/${d.getFullYear()}`;
  } catch (_) { return &quot;&quot;; }
}
function monthKeyFromDMYLocal(dmy = &quot;&quot;) {
  const v = typeof getMonthKeyFromDMY === &quot;function&quot; ? getMonthKeyFromDMY(dmy) : &quot;&quot;;
  if (v) return normalizeMonthKey(v);
  const dt = dmyToDate(dmy);
  if (!dt) return &quot;&quot;;
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,&quot;0&quot;)}`;
}
function monthLabelFromKeyLocal(key = &quot;&quot;) {
  const norm = normalizeMonthKey(key);
  if (typeof getMonthLabelFromKey === &quot;function&quot;) { const v = getMonthLabelFromKey(norm); if (v) return v; }
  const m = norm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(key || &quot;&quot;);
  const meses = [&quot;Enero&quot;,&quot;Febrero&quot;,&quot;Marzo&quot;,&quot;Abril&quot;,&quot;Mayo&quot;,&quot;Junio&quot;,&quot;Julio&quot;,&quot;Agosto&quot;,&quot;Septiembre&quot;,&quot;Octubre&quot;,&quot;Noviembre&quot;,&quot;Diciembre&quot;];
  return `${meses[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}
function parseFechaFlexible(raw = &quot;&quot;) {
  const s = String(raw || &quot;&quot;).trim();
  if (!s) return null;
  if (s.toLowerCase() === &quot;hoy&quot;) return hoyDMY();
  if (typeof parseFechaFinanceInput === &quot;function&quot;) { const p = parseFechaFinanceInput(s); if (p) return normalizeDMY(p); }
  return isFechaDMY(s) ? normalizeDMY(s) : null;
}
function extraerFechaMovimiento(r = {}) {
  return normalizeDMY(r.fecha || &quot;&quot;) || tsToDMY(r.fechaTS || r.fecha_ts || null) || tsToDMY(r.createdAt || r.created_at || null) || tsToDMY(r.updatedAt || r.updated_at || null) || tsToDMY(r.timestamp || r.ts || null) || &quot;&quot;;
}
function finTipoLabel(tipo) { return String(tipo || &quot;&quot;).toLowerCase() === &quot;egreso&quot; ? &quot;Egreso&quot; : &quot;Ingreso&quot;; }
function finConceptoLabel(m = {}) {
  const tipo = String(m.tipo || &quot;&quot;).toLowerCase();
  if (tipo === &quot;egreso&quot;) return String(m.motivo || m.detalle || m.descripcion || &quot;Egreso&quot;).trim();
  return String(m.plataforma || m.detalle || m.descripcion || m.cliente || &quot;Ingreso&quot;).trim();
}

function normalizarBancoKey(raw = &quot;&quot;) {
  const s = String(raw || &quot;&quot;).trim().toLowerCase().normalize(&quot;NFD&quot;).replace(/[\u0300-\u036f]/g, &quot;&quot;);
  if (!s) return &quot;sin_banco&quot;;

  if (s.includes(&quot;bac&quot;)) return &quot;bac&quot;;
  if (s.includes(&quot;atlantida&quot;)) return &quot;atlantida&quot;;
  if (s.includes(&quot;ficohsa&quot;)) return &quot;ficohsa&quot;;
  if (s.includes(&quot;banpais&quot;)) return &quot;banpais&quot;;
  if (s.includes(&quot;occidente&quot;)) return &quot;occidente&quot;;
  if (s.includes(&quot;davivienda&quot;)) return &quot;davivienda&quot;;
  if (s.includes(&quot;lafise&quot;)) return &quot;lafise&quot;;
  if (s.includes(&quot;tigo&quot;)) return &quot;tigo_money&quot;;
  if (s.includes(&quot;paypal&quot;)) return &quot;paypal&quot;;
  if (s.includes(&quot;binance&quot;)) return &quot;binance&quot;;
  if (s.includes(&quot;efectivo&quot;) || s.includes(&quot;cash&quot;)) return &quot;efectivo&quot;;
  if (s.includes(&quot;transferencia&quot;)) return &quot;transferencia&quot;;
  if (s.includes(&quot;tengo&quot;)) return &quot;tengo&quot;;
  if (s.includes(&quot;otro&quot;)) return &quot;otro&quot;;

  const sinEmojis = s.replace(/[^\w\s.-]/gi, &#x27;&#x27;).trim().replace(/\s+/g, &quot;_&quot;);
  return sinEmojis || &quot;sin_banco&quot;;
}

function humanBanco(raw = &quot;&quot;) {
  const key = normalizarBancoKey(raw);
  const map = { 
    bac: &quot;🏦 BAC&quot;, 
    atlantida: &quot;🏦 Atlántida&quot;, 
    ficohsa: &quot;🏦 Ficohsa&quot;, 
    banpais: &quot;🏦 Banpaís&quot;, 
    occidente: &quot;🏦 Occidente&quot;, 
    davivienda: &quot;🏦 Davivienda&quot;, 
    lafise: &quot;🏦 Lafise&quot;, 
    tigo_money: &quot;📱 Tigo Money&quot;, 
    paypal: &quot;💳 PayPal&quot;, 
    binance: &quot;🪙 Binance&quot;, 
    efectivo: &quot;💵 Efectivo&quot;, 
    transferencia: &quot;🔁 Transferencia&quot;, 
    tengo: &quot;📱 Tengo&quot;, 
    otro: &quot;🔁 Otro&quot;, 
    sin_banco: &quot;Sin banco&quot; 
  };
  return map[key] || String(raw || &quot;Sin banco&quot;).trim() || &quot;Sin banco&quot;;
}

function finExtraLabel(m = {}) {
  const tipo = String(m.tipo || &quot;&quot;).toLowerCase();
  const banco = humanBanco(m.banco || m.metodo || &quot;&quot;);
  const detalle = String(m.detalle || m.descripcion || &quot;&quot;).trim();
  if (tipo === &quot;egreso&quot;) return detalle ? `${banco} • ${detalle}` : banco;
  return banco;
}
function textoMovimientoParaEliminar(m = {}) {
  const fecha = String(extraerFechaMovimiento(m) || m.fecha || &quot;-&quot;).trim();
  const monto = Number(m.monto || 0).toFixed(2);
  const concepto = finConceptoLabel(m);
  const extra = finExtraLabel(m);
  let txt = `${fecha} • ${monto} Lps • ${concepto}`;
  if (extra) txt += ` • ${extra}`;
  if (txt.length &gt; 60) txt = `${txt.slice(0, 57)}...`;
  return txt;
}
function textoConfirmarEliminacionMovimiento(m = {}) {
  const tipo = finTipoLabel(m.tipo);
  const fecha = String(extraerFechaMovimiento(m) || m.fecha || &quot;-&quot;);
  const monto = typeof moneyLps === &quot;function&quot; ? moneyLps(m.monto || 0) : `${Number(m.monto || 0).toFixed(2)} Lps`;
  const concepto = finConceptoLabel(m);
  const extra = finExtraLabel(m);
  let txt = &quot;🗑️ CONFIRMAR ELIMINACIÓN\n\n&quot;;
  txt += `Tipo: ${tipo}\nFecha: ${fecha}\nMonto: ${monto}\nConcepto: ${concepto}\n`;
  if (extra) txt += `Extra: ${extra}\n`;
  txt += &quot;\n¿Desea eliminar este movimiento?&quot;;
  return txt;
}
function resumenFinanzasTextoPorRango(fechaInicio, fechaFin, list = []) {
  const rows = Array.isArray(list) ? list : [];
  let ingresos = 0, egresos = 0;
  for (const r of rows) { const monto = Number(r.monto || 0); if (String(r.tipo || &quot;&quot;).toLowerCase() === &quot;egreso&quot;) egresos += monto; else ingresos += monto; }
  const utilidad = ingresos - egresos;
  let txt = `🗓️ RESUMEN DEL ${fechaInicio} AL ${fechaFin}\n\nIngresos: ${moneyLps(ingresos)}\nEgresos: ${moneyLps(egresos)}\nUtilidad: ${moneyLps(utilidad)}\nMovimientos: ${String(rows.length)}\n`;
  if (rows.length) { txt += `\nDetalle:\n`; txt += rows.slice(0, 30).map((r, i) =&gt; `${i+1}. ${String(r.tipo||&quot;&quot;).toLowerCase()===&quot;egreso&quot;?&quot;➖&quot;:&quot;➕&quot;} ${textoMovimientoParaEliminar(r)}`).join(&quot;\n&quot;); }
  return txt;
}
function agruparBancosDesdeLista(list = []) {
  const map = {};
  for (const r of Array.isArray(list) ? list : []) {
    const bancoRaw = String(r.banco || r.metodo || &quot;&quot;).trim();
    const bancoKey = normalizarBancoKey(bancoRaw);
    const bancoLabel = humanBanco(bancoRaw);
    const monto = Number(r.monto || 0);
    if (!map[bancoKey]) map[bancoKey] = { banco: bancoLabel, ingresos: 0, egresos: 0, neto: 0 };
    if (String(r.tipo || &quot;&quot;).trim().toLowerCase() === &quot;egreso&quot;) { map[bancoKey].egresos += monto; map[bancoKey].neto -= monto; }
    else { map[bancoKey].ingresos += monto; map[bancoKey].neto += monto; }
  }
  return Object.values(map).sort((a, b) =&gt; (Number(b.ingresos||0)+Number(b.egresos||0)) - (Number(a.ingresos||0)+Number(a.egresos||0)));
}
function resumenBancosFechaTexto(fecha, list = []) { const items = agruparBancosDesdeLista(list); let txt = `🏦 RESUMEN POR BANCO — ${fecha}\n\n`; if (!items.length) { txt += &quot;No hay movimientos para esa fecha.&quot;; return txt; } txt += items.map((v, i) =&gt; `${i+1}. ${v.banco}\n   Ingresos: ${moneyLps(v.ingresos)}\n   Egresos: ${moneyLps(v.egresos)}\n   Neto: ${moneyLps(v.neto)}`).join(&quot;\n\n&quot;); return txt; }
function resumenBancosRangoTexto(fechaInicio, fechaFin, list = []) { const items = agruparBancosDesdeLista(list); let txt = `🏦 RESUMEN POR BANCO — ${fechaInicio} al ${fechaFin}\n\n`; if (!items.length) { txt += &quot;No hay movimientos para ese rango.&quot;; return txt; } txt += items.map((v, i) =&gt; `${i+1}. ${v.banco}\n   Ingresos: ${moneyLps(v.ingresos)}\n   Egresos: ${moneyLps(v.egresos)}\n   Neto: ${moneyLps(v.neto)}`).join(&quot;\n\n&quot;); return txt; }
function splitPlataformasNormalizadas(raw = &quot;&quot;) {
  const source = String(raw || &quot;&quot;).trim();
  if (!source) return [];
  const normalized = source.replace(/\s+y\s+/gi, &quot;,&quot;).replace(/[+|&amp;;]/g, &quot;,&quot;).split(&quot;,&quot;).map((x) =&gt; String(x||&quot;&quot;).trim()).filter(Boolean);
  const out = [];
  for (const part of normalized.length ? normalized : [source]) { const plat = normalizarPlataforma(part); if (plat &amp;&amp; PLATFORM_KEYS.includes(plat) &amp;&amp; !out.includes(plat)) out.push(plat); }
  if (!out.length) { const single = normalizarPlataforma(source); if (single &amp;&amp; PLATFORM_KEYS.includes(single)) out.push(single); }
  return out;
}
function resumenTopPlataformasGenerico(label = &quot;&quot;, list = []) {
  const map = {};
  for (const r of Array.isArray(list) ? list : []) {
    if (String(r.tipo||&quot;&quot;).toLowerCase() === &quot;egreso&quot;) continue;
    const monto = Number(r.monto || 0);
    if (!Number.isFinite(monto) || monto &lt;= 0) continue;
    const plats = splitPlataformasNormalizadas(r.plataforma || r.plataformas || &quot;&quot;);
    if (!plats.length) continue;
    const porcion = monto / plats.length;
    for (const plat of plats) map[plat] = (map[plat] || 0) + porcion;
  }
  const items = Object.entries(map).sort((a, b) =&gt; b[1] - a[1]).slice(0, 20);
  let txt = `🏆 TOP PLATAFORMAS — ${label}\n\n`;
  if (!items.length) { txt += &quot;No hay ingresos para ese período.&quot;; return txt; }
  txt += items.map(([plat, total], i) =&gt; `${i+1}. ${humanPlatSafe(plat)} — ${moneyLps(total)}`).join(&quot;\n&quot;);
  return txt;
}
function resumenTopPlataformasRangoTexto(fechaInicio, fechaFin, list = []) { return resumenTopPlataformasGenerico(`${fechaInicio} al ${fechaFin}`, list); }
function resumenTopCombosRangoTexto(fechaInicio, fechaFin, list = []) {
  const map = {};
  for (const r of Array.isArray(list) ? list : []) {
    if (String(r.tipo||&quot;&quot;).toLowerCase() === &quot;egreso&quot;) continue;
    const monto = Number(r.monto || 0);
    if (!Number.isFinite(monto) || monto &lt;= 0) continue;
    const plats = splitPlataformasNormalizadas(r.plataforma || r.plataformas || &quot;&quot;);
    if (plats.length &lt; 2) continue;
    const combo = plats.map((x) =&gt; humanPlatSafe(x)).sort((a, b) =&gt; a.localeCompare(b, &quot;es&quot;)).join(&quot; + &quot;);
    map[combo] = (map[combo] || 0) + monto;
  }
  const items = Object.entries(map).sort((a, b) =&gt; b[1] - a[1]).slice(0, 20);
  let txt = `🎯 TOP COMBOS — ${fechaInicio} al ${fechaFin}\n\n`;
  if (!items.length) { txt += &quot;No hay combos para ese período.&quot;; return txt; }
  txt += items.map(([combo, total], i) =&gt; `${i+1}. ${combo} — ${moneyLps(total)}`).join(&quot;\n&quot;);
  return txt;
}
function detalleBancoRangoTexto(banco = &quot;&quot;, fechaInicio = &quot;&quot;, fechaFin = &quot;&quot;, list = []) {
  const objetivo = normalizarBancoKey(banco);
  const rows = (Array.isArray(list) ? list : []).filter((r) =&gt; normalizarBancoKey(r.banco || r.metodo || &quot;&quot;) === objetivo);
  let ingresos = 0, egresos = 0, ing = [], egr = [];
  for (const r of rows) {
    const monto = Number(r.monto || 0);
    const linea = `${r.fecha || extraerFechaMovimiento(r) || &quot;-&quot;} — ${moneyLps(monto)} — ${finConceptoLabel(r)}${finExtraLabel(r) ? ` — ${finExtraLabel(r)}` : &quot;&quot;}`;
    if (String(r.tipo||&quot;&quot;).toLowerCase() === &quot;egreso&quot;) { egresos += monto; egr.push(linea); }
    else { ingresos += monto; ing.push(linea); }
  }
  let txt = `🏦 DETALLE BANCO: ${humanBanco(banco)}\n📅 Del ${fechaInicio} al ${fechaFin}\n\n`;
  if (!rows.length) { txt += &quot;No hay movimientos para ese banco en ese rango.&quot;; return txt; }
  txt += &quot;Ingresos:\n&quot; + (ing.length ? ing.map((x, i) =&gt; `${i+1}. ${x}`).join(&quot;\n&quot;) : &quot;Sin ingresos&quot;);
  txt += &quot;\n\nEgresos:\n&quot; + (egr.length ? egr.map((x, i) =&gt; `${i+1}. ${x}`).join(&quot;\n&quot;) : &quot;Sin egresos&quot;);
  txt += `\n\nTotal ingresos: ${moneyLps(ingresos)}\nTotal egresos: ${moneyLps(egresos)}\nNeto: ${moneyLps(ingresos - egresos)}`;
  return txt;
}
function startEndDayTimestamps(dmy = &quot;&quot;) { const dt = dmyToDate(dmy); if (!dt) return null; return { iniTs: admin.firestore.Timestamp.fromDate(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0)), finTs: admin.firestore.Timestamp.fromDate(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999)) }; }
function startEndMonthTimestamps(monthKey = &quot;&quot;) { const key = normalizeMonthKey(monthKey); const m = key.match(/^(\d{4})-(\d{2})$/); if (!m) return null; const yyyy = Number(m[1]), mm = Number(m[2]); return { iniTs: admin.firestore.Timestamp.fromDate(new Date(yyyy, mm-1, 1, 0, 0, 0, 0)), finTs: admin.firestore.Timestamp.fromDate(new Date(yyyy, mm, 0, 23, 59, 59, 999)) }; }
function getMonthBoundsDMY(monthKey = &quot;&quot;) { const key = normalizeMonthKey(monthKey); const m = key.match(/^(\d{4})-(\d{2})$/); if (!m) return null; const yyyy = Number(m[1]), mm = Number(m[2]), lastDay = new Date(yyyy, mm, 0).getDate(); return { ini: `01/${String(mm).padStart(2,&quot;0&quot;)}/${yyyy}`, fin: `${String(lastDay).padStart(2,&quot;0&quot;)}/${String(mm).padStart(2,&quot;0&quot;)}/${yyyy}` }; }
function monthsBetweenDMY(fechaInicio = &quot;&quot;, fechaFin = &quot;&quot;) { const ini = dmyToDate(fechaInicio), fin = dmyToDate(fechaFin); if (!ini || !fin) return []; let a = new Date(ini.getFullYear(), ini.getMonth(), 1), b = new Date(fin.getFullYear(), fin.getMonth(), 1); if (a.getTime() &gt; b.getTime()) { const temp = a; a = b; b = temp; } const out = []; while (a.getTime() &lt;= b.getTime()) { out.push(`${a.getFullYear()}-${String(a.getMonth()+1).padStart(2,&quot;0&quot;)}`); a = new Date(a.getFullYear(), a.getMonth()+1, 1); } return out; }
function addRowsDedup(map, rows = []) { for (const row of rows) { if (!row?.id) continue; if (!map.has(row.id)) map.set(row.id, row); } }
function mergeFinanceRows(base = {}, extra = {}) { const out = { ...(base || {}) }; for (const [k, v] of Object.entries(extra || {})) { if (out[k] == null || out[k] === &quot;&quot; || (typeof out[k] === &quot;number&quot; &amp;&amp; out[k] === 0)) out[k] = v; } return out; }

async function queryDocsByFieldEq(collectionName, field, value) { try { const snap = await db.collection(collectionName).where(field, &quot;==&quot;, value).get(); return snap.docs.map((d) =&gt; normalizeFinanceDocRow(d.id, d.data() || {}, collectionName)); } catch (e) { logErr(`queryDocsByFieldEq:${collectionName}.${field}`, e); return []; } }
async function queryDocsByFieldRange(collectionName, field, ini, fin) { try { const snap = await db.collection(collectionName).where(field, &quot;&gt;=&quot;, ini).where(field, &quot;&lt;=&quot;, fin).get(); return snap.docs.map((d) =&gt; normalizeFinanceDocRow(d.id, d.data() || {}, collectionName)); } catch (e) { logErr(`queryDocsByFieldRange:${collectionName}.${field}`, e); return []; } }

async function getAllFinanceRowsRecovered() {
  const byId = new Map();
  for (const col of FINANCE_COLLECTIONS_READ) {
    try { const snap = await db.collection(col).get(); snap.forEach((d) =&gt; { const row = normalizeFinanceDocRow(d.id, d.data() || {}, col); if (!byId.has(d.id)) byId.set(d.id, row); else byId.set(d.id, mergeFinanceRows(byId.get(d.id), row)); }); } catch (e) { logErr(`getAllFinanceRowsRecovered:${col}`, e); }
  }
  return Array.from(byId.values()).map((r) =&gt; ({ ...r, fecha: extraerFechaMovimiento(r) || r.fecha || &quot;&quot; }));
}

async function scanFinanceDocsFallbackByDate(fechaDMY = &quot;&quot;) {
  const fecha = normalizeDMY(fechaDMY);
  if (!fecha) return [];
  const rows = await getAllFinanceRowsRecovered();
  return rows.filter((r) =&gt; normalizeDMY(extraerFechaMovimiento(r) || r.fecha || &quot;&quot;) === fecha).sort((a, b) =&gt; dmyToMillis(b.fecha || &quot;&quot;) - dmyToMillis(a.fecha || &quot;&quot;));
}

async function scanFinanceDocsFallbackByRange(fechaInicio = &quot;&quot;, fechaFin = &quot;&quot;) {
  const ini = normalizeDMY(fechaInicio), fin = normalizeDMY(fechaFin);
  if (!ini || !fin) return [];
  let iniMs = dmyToMillis(ini), finMs = dmyToMillis(fin);
  if (iniMs &gt; finMs) { const t = iniMs; iniMs = finMs; finMs = t; }
  const rows = await getAllFinanceRowsRecovered();
  return rows.filter((r) =&gt; { const ts = dmyToMillis(extraerFechaMovimiento(r) || r.fecha || &quot;&quot;); return ts &gt;= iniMs &amp;&amp; ts &lt;= finMs; }).sort((a, b) =&gt; dmyToMillis(a.fecha||&quot;&quot;) - dmyToMillis(b.fecha||&quot;&quot;));
}

async function getFinanceDocByIdAny(id) {
  const docId = String(id || &quot;&quot;).trim();
  if (!docId) return null;
  for (const col of FINANCE_COLLECTIONS_READ) {
    try { const snap = await db.collection(col).doc(docId).get(); if (snap.exists) return { collection: col, ref: db.collection(col).doc(docId), row: normalizeFinanceDocRow(snap.id, snap.data() || {}, col) }; } catch (e) { logErr(`getFinanceDocByIdAny:${col}`, e); }
  }
  return null;
}

async function saveFinancePayload(docId, payload = {}) {
  const id = String(docId || &quot;&quot;).trim();
  if (!id) throw new Error(&quot;ID de finanza inválido.&quot;);
  await db.collection(FINANCE_COLLECTION_PRIMARY).doc(id).set(payload, { merge: false });
  return { id, ...payload };
}

async function deleteFinanceDocAny(docId) {
  const id = String(docId || &quot;&quot;).trim();
  if (!id) return;
  for (const col of FINANCE_COLLECTIONS_READ) { try { const ref = db.collection(col).doc(id); const doc = await ref.get(); if (doc.exists) await ref.delete(); } catch (e) { logErr(`deleteFinanceDocAny:${col}`, e); } }
}

// ===============================
// MENÚS PRINCIPALES
// ===============================
async function menuPrincipal(chatId) {
  // ✅ Redirige a Centro de Operaciones — menuPrincipal ya no se usa directamente
  return upsertPanel(chatId,
    &quot;📊 *CENTRO DE OPERACIONES*\n\nSublicuentas — Conectamos su entretenimiento\n\nSeleccione una opción:&quot;, [
    [{ text: &quot;🎯 Control cuentas&quot;, callback_data: &quot;menu:inventario&quot; }, { text: &quot;👥 Clientes&quot;, callback_data: &quot;menu:clientes&quot; }],
    [{ text: &quot;💰 Control financiero&quot;, callback_data: &quot;menu:pagos&quot; }, { text: &quot;🚨 Riesgos&quot;, callback_data: &quot;menu:alertas&quot; }],
    [{ text: &quot;📊 Análisis&quot;, callback_data: &quot;menu:dashboard&quot; }, { text: &quot;👤 Revendedores&quot;, callback_data: &quot;menu:revendedores&quot; }],
  ]);
}

async function menuVendedor(chatId) {
  return upsertPanel(chatId,
    &quot;👤 *MENÚ VENDEDOR*\n\nSeleccione una opción:&quot;, [
    [{ text: &quot;📅 Mis renovaciones hoy&quot;, callback_data: &quot;ren:mis:hoy&quot; }, { text: &quot;⏳ Próximos 3 días&quot;, callback_data: &quot;ren:mis:prox3&quot; }],
    [{ text: &quot;📄 TXT renovaciones&quot;, callback_data: &quot;txt:mis&quot; }, { text: &quot;👥 Mis clientes&quot;, callback_data: &quot;vend:clientes&quot; }],
    [{ text: &quot;🧾 TXT mis clientes&quot;, callback_data: &quot;vend:clientes:txt&quot; }, { text: &quot;💰 Mi resumen del mes&quot;, callback_data: &quot;vend:resumen&quot; }],
    [{ text: &quot;🔴 Mis vencidos&quot;, callback_data: &quot;vend:vencidos&quot; }],
    [{ text: &quot;🔍 Buscar cliente&quot;, callback_data: &quot;vend:buscar&quot; }],
  ]);
}

async function menuInventario(chatId) {
  return upsertPanel(chatId,
    &quot;📦 *INVENTARIO*\n\nSeleccione una categoría:&quot;, [
    [{ text: &quot;🎬 Video&quot;, callback_data: &quot;menu:inventario:video&quot; }, { text: &quot;🎵 Música&quot;, callback_data: &quot;menu:inventario:musica&quot; }],
    [{ text: &quot;📡 IPTV&quot;, callback_data: &quot;menu:inventario:iptv&quot; }, { text: &quot;🎨 Diseño e IA&quot;, callback_data: &quot;menu:inventario:designai&quot; }],
    [{ text: &quot;📊 Stock general&quot;, callback_data: &quot;inv:general&quot; }],
    [{ text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }],
  ]);
}

async function menuInventarioVideo(chatId) { const items = PLATFORM_KEYS.filter((x) =&gt; categoryOfPlat(x) === &quot;video&quot;); const kb = kbFromItems(items); kb.push([{ text: &quot;⬅️ Volver Inventario&quot;, callback_data: &quot;menu:inventario&quot; }, { text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }]); return upsertPanel(chatId, &quot;VIDEO\n\nSeleccione plataforma:&quot;, kb); }
async function menuInventarioMusica(chatId) { const items = PLATFORM_KEYS.filter((x) =&gt; categoryOfPlat(x) === &quot;musica&quot;); const kb = kbFromItems(items); kb.push([{ text: &quot;⬅️ Volver Inventario&quot;, callback_data: &quot;menu:inventario&quot; }, { text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }]); return upsertPanel(chatId, &quot;MUSICA\n\nSeleccione plataforma:&quot;, kb); }
async function menuInventarioIptv(chatId) { const items = PLATFORM_KEYS.filter((x) =&gt; categoryOfPlat(x) === &quot;iptv&quot;); const kb = kbFromItems(items); kb.push([{ text: &quot;⬅️ Volver Inventario&quot;, callback_data: &quot;menu:inventario&quot; }, { text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }]); return upsertPanel(chatId, &quot;IPTV\n\nSeleccione plataforma:&quot;, kb); }
async function menuInventarioDisenoIA(chatId) { const items = PLATFORM_KEYS.filter((x) =&gt; categoryOfPlat(x) === &quot;diseno_ia&quot;); const kb = kbFromItems(items); kb.push([{ text: &quot;⬅️ Volver Inventario&quot;, callback_data: &quot;menu:inventario&quot; }, { text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }]); return upsertPanel(chatId, &quot;DISENO E IA\n\nSeleccione plataforma:&quot;, kb); }

async function menuClientes(chatId) {
  return upsertPanel(chatId,
    &quot;👥 *CLIENTES / CRM*\n\nSeleccione una opción:&quot;, [
    [{ text: &quot;➕ Nuevo cliente&quot;, callback_data: &quot;cli:wiz:start&quot; }, { text: &quot;🔎 Buscar cliente&quot;, callback_data: &quot;menu:buscar&quot; }],
    [{ text: &quot;📅 Renovaciones del día&quot;, callback_data: &quot;menu:renovaciones&quot; }, { text: &quot;👤 Revendedores&quot;, callback_data: &quot;rev:lista&quot; }],
    [{ text: &quot;📊 Resumen CRM&quot;, callback_data: &quot;cli:crm:resumen&quot; }, { text: &quot;🗂️ TXT por vendedor&quot;, callback_data: &quot;cli:txt:vendedores_split&quot; }],
    [{ text: &quot;🟢 TXT vigentes&quot;, callback_data: &quot;cli:txt:vigentes&quot; }, { text: &quot;🔴 TXT no vigentes&quot;, callback_data: &quot;cli:txt:no_vigentes&quot; }],
    [{ text: &quot;📄 TXT general&quot;, callback_data: &quot;cli:txt:general&quot; }, { text: &quot;📒 Agenda simple&quot;, callback_data: &quot;cli:txt:agenda&quot; }],
    [{ text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }],
  ]);
}

async function menuRenovaciones(chatId) {
  return upsertPanel(chatId,
    &quot;📅 *RENOVACIONES*\n\nSeleccione una opción:&quot;, [
    [{ text: &quot;📋 Ver renovaciones hoy&quot;, callback_data: &quot;ren:hoy&quot; }, { text: &quot;📄 TXT de hoy&quot;, callback_data: &quot;txt:hoy&quot; }],
    [{ text: &quot;📤 Enviar TXT a vendedores&quot;, callback_data: &quot;txt:todos:hoy&quot; }, { text: &quot;⬅️ Volver CRM&quot;, callback_data: &quot;menu:clientes&quot; }],
    [{ text: &quot;⬅️ Volver CRM&quot;, callback_data: &quot;menu:clientes&quot; }, { text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }],
  ]);
}

async function menuPagos(chatId) {
  return upsertPanel(chatId,
    &quot;💰 *FINANZAS*\n\nSeleccione una opción:&quot;, [
    [{ text: &quot;➕ Registrar ingreso&quot;, callback_data: &quot;fin:menu:ingreso&quot; }, { text: &quot;➖ Registrar egreso&quot;, callback_data: &quot;fin:menu:egreso&quot; }],
    [{ text: &quot;📒 Ver registro&quot;, callback_data: &quot;fin:menu:registro&quot; }, { text: &quot;🗑️ Eliminar movimiento&quot;, callback_data: &quot;fin:menu:eliminar&quot; }],
    [{ text: &quot;📊 Reportes&quot;, callback_data: &quot;fin:menu:reportes&quot; }, { text: &quot;🧾 Cierre de caja&quot;, callback_data: &quot;fin:menu:cierre&quot; }],
    [{ text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }],
  ]);
}

async function menuAlertas(chatId) {
  return upsertPanel(chatId,
    &quot;🚨 *ALERTAS*\n\nSeleccione una opción:&quot;, [
    [{ text: &quot;🔴 Clientes vencidos&quot;, callback_data: &quot;alert:vencidos:0&quot; }, { text: &quot;🟠 Vencen hoy&quot;, callback_data: &quot;alert:hoy:0&quot; }],
    [{ text: &quot;⚡ Renov. masiva vencidos&quot;, callback_data: &quot;masivo:start&quot; }, { text: &quot;⚡ Renov. masiva hoy&quot;, callback_data: &quot;masivo:start:hoy&quot; }],
    [{ text: &quot;🟡 Vencen en 3 días&quot;, callback_data: &quot;alert:3dias:0&quot; }, { text: &quot;📦 Inventario crítico&quot;, callback_data: &quot;alert:inventario:0&quot; }],
    [{ text: &quot;📄 TXT alertas del día&quot;, callback_data: &quot;alert:txt:hoy&quot; }, { text: &quot;⬅️ Volver&quot;, callback_data: &quot;go:inicio&quot; }],
    [{ text: &quot;⬅️ Volver&quot;, callback_data: &quot;go:inicio&quot; }],
  ]);
}

async function menuFinRegistro(chatId) {
  return upsertPanel(chatId,
    &quot;📒 *REGISTRO DE FINANZAS*\n\nSeleccione una opción:&quot;, [
    [{ text: &quot;➕ Registrar ingreso&quot;, callback_data: &quot;fin:menu:ingreso&quot; }, { text: &quot;➖ Registrar egreso&quot;, callback_data: &quot;fin:menu:egreso&quot; }],
    [{ text: &quot;🗑️ Eliminar Movimiento&quot;, callback_data: &quot;fin:menu:eliminar&quot; }, { text: &quot;🧾 Cierre de Caja&quot;, callback_data: &quot;fin:menu:cierre&quot; }],
    [{ text: &quot;📊 Reportes&quot;, callback_data: &quot;fin:menu:reportes&quot; }, { text: &quot;⬅️ Volver Finanzas&quot;, callback_data: &quot;menu:pagos&quot; }],
    [{ text: &quot;⬅️ Volver Finanzas&quot;, callback_data: &quot;menu:pagos&quot; }, { text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }],
  ]);
}

async function menuFinEliminarTipo(chatId) {
  return upsertPanel(chatId,
    &quot;🗑️ *ELIMINAR MOVIMIENTO*\n\nSeleccione qué desea buscar:&quot;, [
    [{ text: &quot;➕ Buscar ingresos&quot;, callback_data: &quot;fin:menu:eliminar:ingreso&quot; }, { text: &quot;➖ Buscar egresos&quot;, callback_data: &quot;fin:menu:eliminar:egreso&quot; }],
    [{ text: &quot;⬅️ Volver Finanzas&quot;, callback_data: &quot;menu:pagos&quot; }, { text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }],
  ]);
}

async function menuFinReportes(chatId) {
  return upsertPanel(chatId,
    &quot;📊 *REPORTES DE FINANZAS*\n\nSeleccione una opción:&quot;, [
    [{ text: &quot;📅 Resumen por fecha&quot;, callback_data: &quot;fin:menu:resumen_fecha&quot; }, { text: &quot;🗓️ Resumen por rango&quot;, callback_data: &quot;fin:menu:resumen_rango&quot; }],
    [{ text: &quot;🏦 Bancos por fecha&quot;, callback_data: &quot;fin:menu:bancos_fecha&quot; }, { text: &quot;🏦 Bancos por rango&quot;, callback_data: &quot;fin:menu:bancos_rango&quot; }],
    [{ text: &quot;🔍 Detalle por banco&quot;, callback_data: &quot;fin:menu:detalle_banco&quot; }, { text: &quot;🏆 Top plataformas&quot;, callback_data: &quot;fin:menu:top_plataformas&quot; }],
    [{ text: &quot;🎯 Top combos&quot;, callback_data: &quot;fin:menu:top_combos&quot; }, { text: &quot;📤 Excel por rango&quot;, callback_data: &quot;fin:menu:excel_rango&quot; }],
    [{ text: &quot;🧾 Cierre por rango&quot;, callback_data: &quot;fin:menu:cierre:rango&quot; }, { text: &quot;⬅️ Volver Finanzas&quot;, callback_data: &quot;menu:pagos&quot; }],
    [{ text: &quot;⬅️ Volver Finanzas&quot;, callback_data: &quot;menu:pagos&quot; }, { text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }],
  ]);
}

// ===============================
// KEYBOARDS FINANZAS
// ===============================
function kbBancosFinanzas() { const buttons = FIN_BANCOS_LOCAL.map((b) =&gt; ({ text: String(b), callback_data: `fin:ing:banco:${encodeURIComponent(String(b))}` })); const rows = pairButtons(buttons); rows.push([{ text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }]); return { inline_keyboard: rows }; }
function kbBancosFinanzasEgreso() { const buttons = FIN_BANCOS_LOCAL.map((b) =&gt; ({ text: String(b), callback_data: `fin:egr:banco:${encodeURIComponent(String(b))}` })); const rows = pairButtons(buttons); rows.push([{ text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }]); return { inline_keyboard: rows }; }
function kbMotivosFinanzas() { const buttons = FIN_MOTIVOS_EGRESO_LOCAL.map((m) =&gt; ({ text: String(m), callback_data: `fin:egr:motivo:${encodeURIComponent(String(m))}` })); const rows = pairButtons(buttons); rows.push([{ text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }]); return { inline_keyboard: rows }; }

// ===============================
// CRUD FINANZAS
// ===============================
async function registrarIngresoTx({ monto, banco = &quot;&quot;, plataforma = &quot;&quot;, detalle = &quot;&quot;, fecha = &quot;&quot;, userId = &quot;&quot;, userName = &quot;&quot; }) {
  const fechaOk = parseFechaFlexible(fecha || hoyDMY());
  if (!fechaOk) throw new Error(&quot;Fecha inválida&quot;);
  const montoOk = Number(monto || 0);
  if (!Number.isFinite(montoOk) || montoOk &lt;= 0) throw new Error(&quot;Monto inválido&quot;);
  const mesKey = monthKeyFromDMYLocal(fechaOk);
  const docId = db.collection(FINANCE_COLLECTION_PRIMARY).doc().id;
  const payload = { tipo: &quot;ingreso&quot;, monto: montoOk, banco: humanBanco(String(banco || &quot;&quot;).trim()), plataforma: String(plataforma || &quot;&quot;).trim(), detalle: String(detalle || &quot;&quot;).trim(), fecha: fechaOk, fechaTS: dmyToTimestamp(fechaOk), mesKey, monthKey: mesKey, userId: String(userId || &quot;&quot;), userName: String(userName || &quot;&quot;), createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  await saveFinancePayload(docId, payload);
  return { id: docId, ...payload };
}

async function registrarEgresoTx({ monto, banco = &quot;&quot;, motivo = &quot;&quot;, detalle = &quot;&quot;, fecha = &quot;&quot;, userId = &quot;&quot;, userName = &quot;&quot; }) {
  const fechaOk = parseFechaFlexible(fecha || hoyDMY());
  if (!fechaOk) throw new Error(&quot;Fecha inválida&quot;);
  const montoOk = Number(monto || 0);
  if (!Number.isFinite(montoOk) || montoOk &lt;= 0) throw new Error(&quot;Monto inválido&quot;);
  const mesKey = monthKeyFromDMYLocal(fechaOk);
  const docId = db.collection(FINANCE_COLLECTION_PRIMARY).doc().id;
  const payload = { tipo: &quot;egreso&quot;, monto: montoOk, banco: humanBanco(String(banco || &quot;&quot;).trim()), motivo: String(motivo || &quot;&quot;).trim(), detalle: String(detalle || &quot;&quot;).trim(), fecha: fechaOk, fechaTS: dmyToTimestamp(fechaOk), mesKey, monthKey: mesKey, userId: String(userId || &quot;&quot;), userName: String(userName || &quot;&quot;), createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  await saveFinancePayload(docId, payload);
  return { id: docId, ...payload };
}

async function getMovimientoFinanzaById(id) {
  const found = await getFinanceDocByIdAny(id);
  return found ? { ...found.row, fecha: extraerFechaMovimiento(found.row) || found.row.fecha || &quot;&quot; } : null;
}

async function getMovimientosPorFecha(fechaDMY, _userId = null, _isSuper = false) {
  const fecha = normalizeDMY(fechaDMY);
  if (!fecha) return [];
  const map = new Map();
  const range = startEndDayTimestamps(fecha);
  const [dd, mm, yyyy] = fecha.split(&quot;/&quot;);
  const fechaAlt = `${Number(dd)}/${Number(mm)}/${yyyy}`;
  for (const col of FINANCE_COLLECTIONS_READ) {
    addRowsDedup(map, await queryDocsByFieldEq(col, &quot;fecha&quot;, fecha));
    if (fechaAlt !== fecha) addRowsDedup(map, await queryDocsByFieldEq(col, &quot;fecha&quot;, fechaAlt));
    if (range) addRowsDedup(map, await queryDocsByFieldRange(col, &quot;fechaTS&quot;, range.iniTs, range.finTs));
  }
  let rows = Array.from(map.values()).map((r) =&gt; ({ ...r, fecha: extraerFechaMovimiento(r) || r.fecha || &quot;&quot; })).filter((r) =&gt; normalizeDMY(String(r.fecha || &quot;&quot;)) === fecha).sort((a, b) =&gt; dmyToMillis(b.fecha||&quot;&quot;) - dmyToMillis(a.fecha||&quot;&quot;));
  if (!rows.length) rows = await scanFinanceDocsFallbackByDate(fecha);
  return rows;
}

async function getMovimientosPorMes(monthKey, _userId = null, _isSuper = false) {
  const key = normalizeMonthKey(monthKey);
  if (!key) return [];
  const map = new Map();
  const range = startEndMonthTimestamps(key);
  const alt = altMonthKey(key);
  const bounds = getMonthBoundsDMY(key);
  for (const col of FINANCE_COLLECTIONS_READ) {
    addRowsDedup(map, await queryDocsByFieldEq(col, &quot;mesKey&quot;, key));
    addRowsDedup(map, await queryDocsByFieldEq(col, &quot;monthKey&quot;, key));
    if (alt) { addRowsDedup(map, await queryDocsByFieldEq(col, &quot;mesKey&quot;, alt)); addRowsDedup(map, await queryDocsByFieldEq(col, &quot;monthKey&quot;, alt)); }
    if (range) addRowsDedup(map, await queryDocsByFieldRange(col, &quot;fechaTS&quot;, range.iniTs, range.finTs));
    if (bounds) addRowsDedup(map, await queryDocsByFieldRange(col, &quot;fecha&quot;, bounds.ini, bounds.fin));
  }
  let rows = Array.from(map.values()).map((r) =&gt; { const fechaReal = extraerFechaMovimiento(r) || r.fecha || &quot;&quot;; const mesReal = monthKeyFromDMYLocal(fechaReal); return { ...r, fecha: fechaReal, mesKey: normalizeMonthKey(r.mesKey || mesReal || &quot;&quot;), monthKey: normalizeMonthKey(r.monthKey || mesReal || &quot;&quot;) }; }).filter((r) =&gt; { const mes = normalizeMonthKey(r.mesKey || r.monthKey || monthKeyFromDMYLocal(r.fecha || &quot;&quot;)); return mes === key; }).sort((a, b) =&gt; dmyToMillis(b.fecha||&quot;&quot;) - dmyToMillis(a.fecha||&quot;&quot;));
  if (!rows.length &amp;&amp; bounds) rows = await scanFinanceDocsFallbackByRange(bounds.ini, bounds.fin);
  return rows;
}

async function getMovimientosPorRango(fechaInicio, fechaFin, _userId = null, _isSuper = false) {
  const ini = normalizeDMY(fechaInicio), fin = normalizeDMY(fechaFin);
  if (!ini || !fin) return [];
  let iniMs = dmyToMillis(ini), finMs = dmyToMillis(fin);
  if (iniMs &gt; finMs) { const temp = iniMs; iniMs = finMs; finMs = temp; }
  const iniDate = new Date(iniMs), finDate = new Date(finMs);
  const iniTs = admin.firestore.Timestamp.fromDate(new Date(iniDate.getFullYear(), iniDate.getMonth(), iniDate.getDate(), 0, 0, 0, 0));
  const finTs = admin.firestore.Timestamp.fromDate(new Date(finDate.getFullYear(), finDate.getMonth(), finDate.getDate(), 23, 59, 59, 999));
  const monthKeys = monthsBetweenDMY(ini, fin);
  const map = new Map();
  for (const col of FINANCE_COLLECTIONS_READ) {
    addRowsDedup(map, await queryDocsByFieldRange(col, &quot;fechaTS&quot;, iniTs, finTs));
    for (const mk of monthKeys) { const bounds = getMonthBoundsDMY(mk); if (!bounds) continue; addRowsDedup(map, await queryDocsByFieldRange(col, &quot;fecha&quot;, bounds.ini, bounds.fin)); }
  }
  let rows = Array.from(map.values()).map((r) =&gt; ({ ...r, fecha: extraerFechaMovimiento(r) || r.fecha || &quot;&quot; })).filter((r) =&gt; { const ts = dmyToMillis(String(r.fecha||&quot;&quot;)); return ts &gt;= iniMs &amp;&amp; ts &lt;= finMs; }).sort((a, b) =&gt; dmyToMillis(a.fecha||&quot;&quot;) - dmyToMillis(b.fecha||&quot;&quot;));
  if (!rows.length) rows = await scanFinanceDocsFallbackByRange(ini, fin);
  return rows;
}

async function eliminarMovimientoFinanzas(id, _userId = null, _isSuper = false) {
  const mov = await getMovimientoFinanzaById(id);
  if (!mov) throw new Error(&quot;Movimiento no encontrado.&quot;);
  await deleteFinanceDocAny(String(id));
  return mov;
}

// ===============================
// RESÚMENES
// ===============================
function resumenFinanzasTextoPorFecha(fecha, list = []) {
  const rows = Array.isArray(list) ? list : [];
  let ingresos = 0, egresos = 0;
  for (const r of rows) { const monto = Number(r.monto || 0); if (String(r.tipo||&quot;&quot;).toLowerCase() === &quot;egreso&quot;) egresos += monto; else ingresos += monto; }
  const utilidad = ingresos - egresos;
  let txt = `📅 RESUMEN DEL ${String(fecha || &quot;&quot;)}\n\nIngresos: ${moneyLps(ingresos)}\nEgresos: ${moneyLps(egresos)}\nUtilidad: ${moneyLps(utilidad)}\nMovimientos: ${String(rows.length)}\n`;
  if (rows.length) { txt += `\nDetalle:\n`; txt += rows.slice(0, 20).map((r, i) =&gt; `${i+1}. ${String(r.tipo||&quot;&quot;).toLowerCase()===&quot;egreso&quot;?&quot;➖&quot;:&quot;➕&quot;} ${textoMovimientoParaEliminar(r)}`).join(&quot;\n&quot;); }
  return txt;
}

function resumenBancosMesTexto(monthKey, list = []) { const label = monthLabelFromKeyLocal(monthKey); return resumenBancosRangoTexto(label, label, list).replace(`— ${label} al ${label}`, `— ${label}`); }
function resumenTopPlataformasTexto(monthKey, list = []) { return resumenTopPlataformasGenerico(monthLabelFromKeyLocal(monthKey), list); }

function cierreCajaTexto(fecha, list = []) {
  let ingresos = 0, egresos = 0;
  for (const m of Array.isArray(list) ? list : []) { const monto = Number(m.monto || 0); if (String(m.tipo||&quot;&quot;).toLowerCase() === &quot;egreso&quot;) egresos += monto; else ingresos += monto; }
  const utilidad = ingresos - egresos;
  const color = utilidad &lt; 0 ? &quot;🔴&quot; : utilidad === 0 ? &quot;🟡&quot; : &quot;🟢&quot;;
  return `🧾 CIERRE DE CAJA\n(${String(fecha || &quot;&quot;)})\n\n💰 Entradas: ${moneyLps(ingresos)}\n💸 Salidas: ${moneyLps(egresos)}\n📦 Caja final: ${utilidad &gt;= 0 ? &quot;+&quot; : &quot;&quot;}${moneyLps(utilidad)} ${color}\n🧮 Movimientos: ${Array.isArray(list) ? list.length : 0}`;
}

function cierreCajaTextoRango(fechaInicio, fechaFin, list = []) {
  let ingresos = 0, egresos = 0;
  for (const m of Array.isArray(list) ? list : []) { const monto = Number(m.monto || 0); if (String(m.tipo||&quot;&quot;).toLowerCase() === &quot;egreso&quot;) egresos += monto; else ingresos += monto; }
  const utilidad = ingresos - egresos;
  const color = utilidad &lt; 0 ? &quot;🔴&quot; : utilidad === 0 ? &quot;🟡&quot; : &quot;🟢&quot;;
  return `🧾 CIERRE DE CAJA\n(${String(fechaInicio || &quot;&quot;)} al ${String(fechaFin || &quot;&quot;)})\n\n💰 Entradas: ${moneyLps(ingresos)}\n💸 Salidas: ${moneyLps(egresos)}\n📦 Caja final: ${utilidad &gt;= 0 ? &quot;+&quot; : &quot;&quot;}${moneyLps(utilidad)} ${color}\n🧮 Movimientos: ${Array.isArray(list) ? list.length : 0}`;
}

async function resumenFinancieroPorMonthKey(monthKey) {
  const rows = await getMovimientosPorMes(monthKey);
  let ingresos = 0, egresos = 0;
  const top = {};
  for (const r of rows) {
    const monto = Number(r.monto || 0);
    if (String(r.tipo||&quot;&quot;).toLowerCase() === &quot;egreso&quot;) egresos += monto;
    else { ingresos += monto; const key = String(r.plataforma || &quot;&quot;).trim().toLowerCase(); if (key) top[key] = (top[key] || 0) + monto; }
  }
  const utilidad = ingresos - egresos;
  const topOrdenado = Object.entries(top).sort((a, b) =&gt; b[1] - a[1]).slice(0, 10).map(([plataforma, total]) =&gt; ({ plataforma, total }));
  return { ingresos, egresos, utilidad, totalMovimientos: rows.length, topOrdenado, rows };
}

// ===============================
// ✅ DASHBOARD EJECUTIVO
// ===============================
async function generarDashboard(chatId) {
  try {
    await bot.sendMessage(chatId, &quot;⏳ Calculando dashboard...&quot;);
    const hoy = hoyDMY();
    const [dd, mm, yyyy] = hoy.split(&quot;/&quot;);
    const mesActualKey = `${yyyy}-${String(mm).padStart(2, &quot;0&quot;)}`;
    const dMesAnt = new Date(Number(yyyy), Number(mm) - 2, 1);
    const mesAnteriorKey = `${dMesAnt.getFullYear()}-${String(dMesAnt.getMonth() + 1).padStart(2, &quot;0&quot;)}`;
    let resMesActual = { ingresos: 0, egresos: 0, utilidad: 0, topOrdenado: [] };
    let resMesAnterior = { ingresos: 0, egresos: 0, utilidad: 0, topOrdenado: [] };
    try { [resMesActual, resMesAnterior] = await Promise.all([resumenFinancieroPorMonthKey(mesActualKey), resumenFinancieroPorMonthKey(mesAnteriorKey)]); } catch (e) { logErr(&quot;dashboard.finanzas&quot;, e); }
    let clientes = [];
    try { const snapClientes = await db.collection(&quot;clientes&quot;).get(); clientes = snapClientes.docs.map((d) =&gt; ({ id: d.id, ...(d.data() || {}) })); } catch (e) { logErr(&quot;dashboard.clientes&quot;, e); }
    const totalClientes = clientes.length;
    const hoyDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    const en7Dias = new Date(hoyDate.getTime()); en7Dias.setDate(en7Dias.getDate() + 7);
    let renovacionesSemana = 0;
    const ingresoPorVendedor = {};
    for (const c of clientes) {
      const vendedor = String(c.vendedor || &quot;Sin vendedor&quot;).trim();
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      for (const s of servicios) {
        const fecha = String(s.fechaRenovacion || &quot;&quot;).trim();
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) continue;
        const [fdd, fmm, fyyyy] = fecha.split(&quot;/&quot;);
        const fechaDate = new Date(Number(fyyyy), Number(fmm) - 1, Number(fdd));
        if (fechaDate &gt;= hoyDate &amp;&amp; fechaDate &lt;= en7Dias) renovacionesSemana++;
        const precio = Number(s.precio || 0);
        if (!ingresoPorVendedor[vendedor]) ingresoPorVendedor[vendedor] = 0;
        ingresoPorVendedor[vendedor] += precio;
      }
    }
    const topVendedor = Object.entries(ingresoPorVendedor).sort((a, b) =&gt; b[1] - a[1])[0];
    const varIngresos = resMesActual.ingresos - resMesAnterior.ingresos;
    const varPct = resMesAnterior.ingresos &gt; 0 ? ((varIngresos / resMesAnterior.ingresos) * 100).toFixed(1) : null;
    const varEmoji = varIngresos &gt;= 0 ? &quot;📈&quot; : &quot;📉&quot;;
    const labelActual = monthLabelFromKeyLocal(mesActualKey);
    const labelAnterior = monthLabelFromKeyLocal(mesAnteriorKey);
    const fmt = (n) =&gt; `${Number(n || 0).toFixed(2)} Lps`;
    let txt = ` *DASHBOARD EJECUTIVO*\n📅 ${escMD(hoy)}\n\n`;
    txt += `💰 *FINANZAS — ${escMD(labelActual)}*\n`;
    txt += `Ingresos: ${escMD(fmt(resMesActual.ingresos))}\n`;
    txt += `Egresos: ${escMD(fmt(resMesActual.egresos))}\n`;
    txt += `Utilidad: ${escMD(fmt(resMesActual.utilidad))}\n`;
    txt += `vs ${escMD(labelAnterior)}: ${varEmoji} ${varPct !== null ? `${varPct}%` : &quot;Sin datos anteriores&quot;}\n\n`;
    txt += `Perfiles: *CLIENTES*\n`;
    txt += `Total: ${escMD(String(totalClientes))}\n`;
    txt += `Renovaciones próximos 7 días: ${escMD(String(renovacionesSemana))}\n\n`;
    if (topVendedor) { txt += `🏆 *TOP VENDEDOR*\n`; txt += `${escMD(topVendedor[0])}: ${escMD(fmt(topVendedor[1]))} en cartera\n\n`; }
    if (Array.isArray(resMesActual.topOrdenado) &amp;&amp; resMesActual.topOrdenado.length) {
      txt += ` *TOP PLATAFORMAS (${escMD(labelActual)})*\n`;
      resMesActual.topOrdenado.slice(0, 5).forEach((x, i) =&gt; { txt += `${i + 1}. ${escMD(humanPlatSafe(x.plataforma))} — ${escMD(fmt(x.total))}\n`; });
    }
    return upsertPanel(chatId, txt, [
      [{ text: &quot;📊 Reporte Excel&quot;, callback_data: &quot;fin:menu:excel_rango&quot; }],
      [{ text: &quot;🏠 Inicio&quot;, callback_data: &quot;go:inicio&quot; }],
    ]);
  } catch (e) { logErr(&quot;generarDashboard&quot;, e); return bot.sendMessage(chatId, `⚠️ Error en dashboard: ${e?.message || &quot;desconocido&quot;}`); }
}

// ===============================
// ✅ RECORDATORIOS 11AM — DÍA ANTERIOR
// Envía a admins y vendedores las renovaciones de mañana a las 11AM
// Así tienen tiempo de avisar a sus clientes durante el día
// ===============================
async function enviarRecordatorios11AM() {
  try {
    const hoy = hoyDMY();
    const [dd, mm, yyyy] = hoy.split(&quot;/&quot;);
    const mananaDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd) + 1);
    const manana = `${String(mananaDate.getDate()).padStart(2,&quot;0&quot;)}/${String(mananaDate.getMonth()+1).padStart(2,&quot;0&quot;)}/${mananaDate.getFullYear()}`;

    // Admins activos
    const snapAdmins = await db.collection(&quot;admins&quot;).get();
    const adminIds = [];
    snapAdmins.forEach((d) =&gt; {
      const data = d.data() || {};
      if (data.activo === false) return;
      const tg = String(data.telegramId || data.userId || d.id || &quot;&quot;).trim();
      if (tg) adminIds.push(tg);
    });

    // Renovaciones de mañana — todas (para admins)
    const rowsMananaGlobal = await obtenerRenovacionesPorFecha(manana, null);

    for (const adminId of adminIds) {
      try {
        if (!rowsMananaGlobal.length) continue;
        let msg = `🔔 *RECORDATORIO: Renovaciones de mañana (${escMD(manana)})*\n\n`;
        msg += `*Total:* ${rowsMananaGlobal.length} perfil(es)\n\n`;
        rowsMananaGlobal.slice(0, 20).forEach((x, i) =&gt; {
          msg += `${i + 1}. ${escMD(x.nombrePerfil || &quot;Sin nombre&quot;)} — ${escMD(humanPlatSafe(x.plataforma || &quot;&quot;))} — ${escMD(moneyLps(x.precio))}\n`;
        });
        if (rowsMananaGlobal.length &gt; 20) msg += `\n_...y ${rowsMananaGlobal.length - 20} más._`;
        await bot.sendMessage(adminId, msg, { parse_mode: &quot;Markdown&quot; });
      } catch (e) { logErr(`recordatorio11AM:admin:${adminId}`, e); }
    }

    // Notificación filtrada por vendedor
    const snapRev = await db.collection(&quot;revendedores&quot;).get();
    for (const d of snapRev.docs) {
      const rev = d.data() || {};
      if (!rev.activo || !rev.telegramId || !rev.nombre) continue;
      try {
        const rowsVend = await obtenerRenovacionesPorFecha(manana, rev.nombre);
        if (!rowsVend.length) continue;
        let msg = `🔔 *RECORDATORIO: Tus renovaciones de mañana (${escMD(manana)})*\n\n`;
        msg += `*Total:* ${rowsVend.length} perfil(es)\n\n`;
        rowsVend.forEach((x, i) =&gt; {
          msg += `${i + 1}. ${escMD(x.nombrePerfil || &quot;Sin nombre&quot;)}\n`;
          msg += `   📱 ${escMD(x.telefono || &quot;-&quot;)}\n`;
          msg += `   📦 ${escMD(humanPlatSafe(x.plataforma || &quot;&quot;))}\n`;
          msg += `   💰 ${escMD(moneyLps(x.precio))}\n\n`;
        });
        await bot.sendMessage(rev.telegramId, msg, { parse_mode: &quot;Markdown&quot; });
      } catch (e) { logErr(`recordatorio11AM:rev:${rev.nombre}`, e); }
    }

    console.log(`✅ Recordatorios 11AM enviados para renovaciones del ${manana}`);
  } catch (e) {
    logErr(&quot;enviarRecordatorios11AM&quot;, e);
  }
}

// ===============================
// ✅ BACKUP DOMINICAL — DOMINGO 9PM
// ===============================
async function ejecutarBackupDominical() {
  try {
    const hoy = hoyDMY();
    const [, mm, yyyy] = hoy.split(&quot;/&quot;);
    const mesKey = `${yyyy}-${String(mm).padStart(2, &quot;0&quot;)}`;
    const label = monthLabelFromKeyLocal(mesKey);
    console.log(`🗄️ Iniciando backup dominical — ${hoy}`);
    const rows = await getMovimientosPorMes(mesKey);
    let ingresos = 0, egresos = 0;
    for (const r of rows) { const monto = Number(r.monto || 0); if (String(r.tipo || &quot;&quot;).toLowerCase() === &quot;egreso&quot;) egresos += monto; else ingresos += monto; }
    const snapClientes = await db.collection(&quot;clientes&quot;).get();
    const clientes = snapClientes.docs.map((d) =&gt; ({ id: d.id, ...(d.data() || {}) }));
    const wb = new ExcelJS.Workbook();
    wb.creator = &quot;Sublicuentas Bot&quot;; wb.created = new Date();
    const wsFinanzas = wb.addWorksheet(`Finanzas ${label}`);
    wsFinanzas.columns = [
      { header: &quot;Fecha&quot;, key: &quot;fecha&quot;, width: 14 }, { header: &quot;Tipo&quot;, key: &quot;tipo&quot;, width: 10 },
      { header: &quot;Monto&quot;, key: &quot;monto&quot;, width: 14 }, { header: &quot;Plataforma/Motivo&quot;, key: &quot;concepto&quot;, width: 28 },
      { header: &quot;Banco&quot;, key: &quot;banco&quot;, width: 20 }, { header: &quot;Detalle&quot;, key: &quot;detalle&quot;, width: 30 },
    ];
    for (const r of rows) { wsFinanzas.addRow({ fecha: r.fecha || &quot;&quot;, tipo: finTipoLabel(r.tipo), monto: Number(r.monto || 0), concepto: finConceptoLabel(r), banco: humanBanco(r.banco || r.metodo || &quot;&quot;), detalle: r.detalle || &quot;&quot; }); }
    wsFinanzas.getRow(1).font = { bold: true }; wsFinanzas.views = [{ state: &quot;frozen&quot;, ySplit: 1 }];
    const wsClientes = wb.addWorksheet(&quot;Clientes&quot;);
    wsClientes.columns = [
      { header: &quot;Nombre&quot;, key: &quot;nombre&quot;, width: 28 }, { header: &quot;Teléfono&quot;, key: &quot;telefono&quot;, width: 16 },
      { header: &quot;Vendedor&quot;, key: &quot;vendedor&quot;, width: 20 }, { header: &quot;Servicios activos&quot;, key: &quot;servicios&quot;, width: 16 },
      { header: &quot;Total mensual&quot;, key: &quot;total&quot;, width: 16 }, { header: &quot;Próx. renovación&quot;, key: &quot;proxima&quot;, width: 18 },
    ];
    for (const c of clientes) {
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      let total = 0, proxima = &quot;&quot;, proximaTs = Infinity;
      for (const s of servicios) {
        total += Number(s.precio || 0);
        const f = String(s.fechaRenovacion || &quot;&quot;).trim();
        if (f) { const [fdd, fmm, fyyyy] = f.split(&quot;/&quot;); const ts = new Date(Number(fyyyy), Number(fmm) - 1, Number(fdd)).getTime(); if (ts &lt; proximaTs) { proximaTs = ts; proxima = f; } }
      }
      wsClientes.addRow({ nombre: c.nombrePerfil || &quot;&quot;, telefono: c.telefono || &quot;&quot;, vendedor: c.vendedor || &quot;&quot;, servicios: servicios.length, total, proxima });
    }
    wsClientes.getRow(1).font = { bold: true }; wsClientes.views = [{ state: &quot;frozen&quot;, ySplit: 1 }];
    const tempPath = `/tmp/backup_dominical_${hoy.replace(/\//g, &quot;-&quot;)}.xlsx`;
    await wb.xlsx.writeFile(tempPath);
    const resumenMsg =
      `🗄️ *BACKUP DOMINICAL — ${escMD(hoy)}*\n\n` +
      `📊 *Finanzas ${escMD(label)}*\n` +
      `Ingresos: ${escMD(moneyLps(ingresos))}\n` +
      `Egresos: ${escMD(moneyLps(egresos))}\n` +
      `Utilidad: ${escMD(moneyLps(ingresos - egresos))}\n` +
      `Movimientos: ${rows.length}\n\n` +
      `👥 *Clientes*: ${clientes.length} registrados\n\n` +
      `_El archivo Excel contiene todas las finanzas del mes y la lista completa de clientes._`;
    const snapAdmins = await db.collection(&quot;admins&quot;).get();
    let enviados = 0;
    for (const d of snapAdmins.docs) {
      const data = d.data() || {};
      if (data.activo === false) continue;
      const tg = String(data.telegramId || data.userId || d.id || &quot;&quot;).trim();
      if (!tg) continue;
      try { await bot.sendMessage(tg, resumenMsg, { parse_mode: &quot;Markdown&quot; }); await bot.sendDocument(tg, tempPath, { caption: ` Backup ${hoy}` }); enviados++; } catch (e) { logErr(`backup:admin:${tg}`, e); }
    }
    try { fs.unlinkSync(tempPath); } catch (_) {}
    console.log(`✅ Backup dominical enviado a ${enviados} admin(s) — ${hoy}`);
  } catch (e) { logErr(&quot;ejecutarBackupDominical&quot;, e); }
}

// ===============================
// ✅ SCHEDULER
// - 11AM todos los días → recordatorio de renovaciones del día siguiente
// - Domingo 9PM → backup dominical con Excel
// ===============================
let _lastRecordatorio11AM = &quot;&quot;;
let _lastBackupDominical = &quot;&quot;;

function getTimePartsNowLocal() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat(&quot;es-HN&quot;, {
    timeZone: String(process.env.TZ || &quot;America/Tegucigalpa&quot;),
    hour: &quot;2-digit&quot;, minute: &quot;2-digit&quot;, hour12: false,
    year: &quot;numeric&quot;, month: &quot;2-digit&quot;, day: &quot;2-digit&quot;,
    weekday: &quot;short&quot;,
  }).formatToParts(now);
  const obj = {};
  fmt.forEach((p) =&gt; { if (p.type !== &quot;literal&quot;) obj[p.type] = p.value; });
  return {
    dmy: `${obj.day}/${obj.month}/${obj.year}`,
    hh: Number(obj.hour),
    mm: Number(obj.minute),
    weekday: String(obj.weekday || &quot;&quot;).toLowerCase(),
  };
}

if (!global.__SUBLICUENTAS_SCHEDULER__) {
  global.__SUBLICUENTAS_SCHEDULER__ = true;

  setInterval(async () =&gt; {
    try {
      const { dmy, hh, mm, weekday } = getTimePartsNowLocal();

      // ✅ 11AM todos los días — recordatorio de renovaciones del día siguiente
      if (hh === 11 &amp;&amp; mm === 0 &amp;&amp; _lastRecordatorio11AM !== dmy) {
        _lastRecordatorio11AM = dmy;
        await enviarRecordatorios11AM();
      }

      // Domingo 9PM — backup dominical
      const esDomingo = weekday.startsWith(&quot;dom&quot;) || weekday === &quot;sun&quot; || weekday === &quot;su&quot;;
      if (esDomingo &amp;&amp; hh === 21 &amp;&amp; mm === 0 &amp;&amp; _lastBackupDominical !== dmy) {
        _lastBackupDominical = dmy;
        await ejecutarBackupDominical();
      }
    } catch (e) {
      logErr(&quot;scheduler&quot;, e);
    }
  }, 30 * 1000);

  console.log(&quot;⏰ Scheduler activo: recordatorio 11AM diario + backup dominical domingo 9PM&quot;);
}

// ===============================
// EXCEL RANGO
// ===============================
function applyHeaderStyle(row) { row.font = { bold: true, color: { argb: &quot;FFFFFFFF&quot; } }; row.alignment = { vertical: &quot;middle&quot;, horizontal: &quot;center&quot; }; row.fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: &quot;1F4E78&quot; } }; }
function applyMoneyFormat(cell) { cell.numFmt = &quot;#,##0.00&quot;; }
function autoBorderSheet(ws) { ws.eachRow((row) =&gt; { row.eachCell((cell) =&gt; { cell.border = { top: { style: &quot;thin&quot;, color: { argb: &quot;D9D9D9&quot; } }, left: { style: &quot;thin&quot;, color: { argb: &quot;D9D9D9&quot; } }, bottom: { style: &quot;thin&quot;, color: { argb: &quot;D9D9D9&quot; } }, right: { style: &quot;thin&quot;, color: { argb: &quot;D9D9D9&quot; } } }; if (!cell.alignment) cell.alignment = { vertical: &quot;middle&quot; }; }); }); }
function visualBar(value, maxValue) { const v = Math.max(0, Number(value||0)); const max = Math.max(1, Number(maxValue||1)); const blocks = Math.max(1, Math.round((v/max)*12)); return &quot;█&quot;.repeat(blocks); }

function decorateFinanzasSheet(ws, rows = []) {
  applyHeaderStyle(ws.getRow(1));
  for (let i = 0; i &lt; rows.length; i++) {
    const excelRow = ws.getRow(i + 2);
    const tipo = String(rows[i]?.tipo || &quot;&quot;).toLowerCase();
    applyMoneyFormat(excelRow.getCell(&quot;C&quot;));
    if (tipo === &quot;ingreso&quot;) { excelRow.eachCell((cell) =&gt; { cell.fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: &quot;E2F0D9&quot; } }; }); excelRow.getCell(&quot;B&quot;).font = { bold: true, color: { argb: &quot;008000&quot; } }; }
    else if (tipo === &quot;egreso&quot;) { excelRow.eachCell((cell) =&gt; { cell.fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: &quot;FCE4D6&quot; } }; }); excelRow.getCell(&quot;B&quot;).font = { bold: true, color: { argb: &quot;C00000&quot; } }; }
  }
  ws.views = [{ state: &quot;frozen&quot;, ySplit: 1 }];
  ws.autoFilter = { from: &quot;A1&quot;, to: `G${Math.max(1, ws.rowCount)}` };
  autoBorderSheet(ws);
}

function decorateResumenSheet(resumen, meta = {}) {
  const { fechaInicio = &quot;&quot;, fechaFin = &quot;&quot;, label = &quot;&quot;, ingresos = 0, egresos = 0, utilidad = 0, movimientos = 0 } = meta;
  resumen.columns = [{ header: &quot;Concepto&quot;, key: &quot;concepto&quot;, width: 24 }, { header: &quot;Valor&quot;, key: &quot;valor&quot;, width: 18 }, { header: &quot;Visual&quot;, key: &quot;visual&quot;, width: 18 }];
  applyHeaderStyle(resumen.getRow(1));
  if (label) resumen.addRow({ concepto: &quot;Periodo&quot;, valor: label, visual: &quot;&quot; });
  if (fechaInicio) resumen.addRow({ concepto: &quot;Fecha inicio&quot;, valor: fechaInicio, visual: &quot;&quot; });
  if (fechaFin) resumen.addRow({ concepto: &quot;Fecha fin&quot;, valor: fechaFin, visual: &quot;&quot; });
  const maxBase = Math.max(Number(ingresos||0), Number(egresos||0), Math.abs(Number(utilidad||0)), 1);
  resumen.addRow({ concepto: &quot;Ingresos&quot;, valor: Number(ingresos||0), visual: visualBar(ingresos, maxBase) });
  resumen.addRow({ concepto: &quot;Egresos&quot;, valor: Number(egresos||0), visual: visualBar(egresos, maxBase) });
  resumen.addRow({ concepto: &quot;Utilidad&quot;, valor: Number(utilidad||0), visual: visualBar(Math.abs(utilidad||0), maxBase) });
  resumen.addRow({ concepto: &quot;Movimientos&quot;, valor: Number(movimientos||0), visual: &quot;&quot; });
  for (let i = 2; i &lt;= resumen.rowCount; i++) {
    const row = resumen.getRow(i); const concepto = String(row.getCell(&quot;A&quot;).value || &quot;&quot;);
    if ([&quot;Ingresos&quot;,&quot;Egresos&quot;,&quot;Utilidad&quot;,&quot;Movimientos&quot;].includes(concepto)) row.font = { bold: true };
    if (concepto === &quot;Ingresos&quot;) { row.getCell(&quot;A&quot;).font = { bold: true, color: { argb: &quot;008000&quot; } }; row.getCell(&quot;B&quot;).fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: &quot;E2F0D9&quot; } }; applyMoneyFormat(row.getCell(&quot;B&quot;)); row.getCell(&quot;C&quot;).font = { color: { argb: &quot;008000&quot; } }; }
    if (concepto === &quot;Egresos&quot;) { row.getCell(&quot;A&quot;).font = { bold: true, color: { argb: &quot;C00000&quot; } }; row.getCell(&quot;B&quot;).fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: &quot;FCE4D6&quot; } }; applyMoneyFormat(row.getCell(&quot;B&quot;)); row.getCell(&quot;C&quot;).font = { color: { argb: &quot;C00000&quot; } }; }
    if (concepto === &quot;Utilidad&quot;) { const positive = Number(utilidad||0) &gt;= 0; row.getCell(&quot;A&quot;).font = { bold: true, color: { argb: positive ? &quot;008000&quot; : &quot;C00000&quot; } }; row.getCell(&quot;B&quot;).fill = { type: &quot;pattern&quot;, pattern: &quot;solid&quot;, fgColor: { argb: positive ? &quot;E2F0D9&quot; : &quot;FCE4D6&quot; } }; applyMoneyFormat(row.getCell(&quot;B&quot;)); row.getCell(&quot;C&quot;).font = { color: { argb: positive ? &quot;008000&quot; : &quot;C00000&quot; } }; }
  }
  resumen.views = [{ state: &quot;frozen&quot;, ySplit: 1 }];
  autoBorderSheet(resumen);
}

async function exportarFinanzasRangoExcel(chatId, fechaInicio, fechaFin, _userId = null, _isSuper = false) {
  const ini = parseFechaFlexible(fechaInicio), fin = parseFechaFlexible(fechaFin);
  if (!ini || !fin) throw new Error(&quot;Fechas inválidas.&quot;);
  if (dmyToMillis(ini) &gt; dmyToMillis(fin)) throw new Error(&quot;La fecha inicial no puede ser mayor a la final.&quot;);

  const safeName = (v = &quot;&quot;) =&gt; String(v || &quot;&quot;).replace(/\//g, &quot;-&quot;).replace(/[^0-9A-Za-z_-]+/g, &quot;_&quot;);
  const filename = `finanzas_${safeName(ini)}_${safeName(fin)}.xlsx`;
  const tempPath = `/tmp/${filename}`;

  try {
    await bot.sendMessage(chatId, &quot;⏳ Generando Excel profesional nivel Saiyajin... espere un momento.&quot;);

    const { generarReporteExcelPorRango } = require(&quot;./index_10_reportes_excel&quot;);
    const rawBuffer = await generarReporteExcelPorRango(ini, fin);
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer || []);

    if (!buffer || buffer.length === 0) {
      await bot.sendMessage(chatId, &quot;❌ Error al generar el archivo Excel.&quot;);
      return menuFinReportes(chatId);
    }

    // Enviar por ruta temporal evita errores de node-telegram-bot-api con Buffer/FormData.
    fs.writeFileSync(tempPath, buffer);

    await bot.sendDocument(
      chatId,
      tempPath,
      {
        caption:
          `📊 *Reporte financiero profesional*
` +
          `📅 Período: *${escMD(ini)}* al *${escMD(fin)}*

` +
          `✅ 5 hojas: Resumen, Ingresos, Egresos, Bancos y Gráficos
` +
          `✅ Filtros, fórmulas, barras visuales y formato Lps`,
        parse_mode: &quot;Markdown&quot;,
      },
      {
        filename,
        contentType: &quot;application/vnd.openxmlformats-officedocument.spreadsheetml.sheet&quot;,
      }
    );

    await bot.sendMessage(chatId, &quot;✅ Excel generado correctamente.&quot;);
    return menuFinReportes(chatId);
  } catch (e) {
    logErr(&quot;exportarFinanzasRangoExcel&quot;, e);
    await bot.sendMessage(chatId, &quot;❌ Error al generar Excel: &quot; + (e?.message || e));
    return menuFinReportes(chatId);
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
  }
}

// ===============================
// COMPATIBILITY
// ===============================
async function listarMovimientosPorFechaYTipo(fechaDMY, tipo) {
  const rows = await getMovimientosPorFecha(fechaDMY);
  return rows.filter((x) =&gt; String(x.tipo||&quot;&quot;).toLowerCase() === String(tipo||&quot;&quot;).toLowerCase()).sort((a, b) =&gt; dmyToMillis(b.fecha||&quot;&quot;) - dmyToMillis(a.fecha||&quot;&quot;));
}

async function menuFinanzas(chatId) { return menuPagos(chatId); }
async function menuRegistroFinanzas(chatId) { return menuFinRegistro(chatId); }
async function menuEliminarMovimientoEspecifico(chatId) { return menuFinEliminarTipo(chatId); }
async function menuReportesFinanzas(chatId) { return menuFinReportes(chatId); }

// ===============================
// COMANDOS TELEGRAM — DESCARGAR EXCEL
// ===============================
// Importar función del nuevo módulo
const { generarReporteExcelPorRango } = require(&quot;./index_10_reportes_excel&quot;);

// ✅ Comando: /reportes_excel_rango 01/06/2026 30/06/2026
bot.onText(/^\/reportes_excel_rango\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})$/, async (msg, match) =&gt; {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const [, fechaInicio, fechaFin] = match;

  // Solo admin
  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, &quot;❌ Solo admin puede descargar reportes&quot;);
  }

  try {
    await bot.sendMessage(chatId, &quot;⏳ Generando Excel... espera&quot;);
    const buffer = await generarReporteExcelPorRango(fechaInicio, fechaFin);
    
    if (!buffer || buffer.length === 0) {
      return bot.sendMessage(chatId, &quot;❌ Error al generar el archivo&quot;);
    }

    const filename = `reporte_${fechaInicio.replace(/\//g, &quot;-&quot;)}_${fechaFin.replace(/\//g, &quot;-&quot;)}.xlsx`;
    const tempPath = `/tmp/${filename}`;
    try {
      fs.writeFileSync(tempPath, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []));
      await bot.sendDocument(chatId, tempPath, {}, {
        filename,
        contentType: &quot;application/vnd.openxmlformats-officedocument.spreadsheetml.sheet&quot;,
      });
    } finally {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    }

    await bot.sendMessage(chatId, `✅ Excel generado
📊 Período: ${fechaInicio} - ${fechaFin}
💾 Incluye: Resumen, Ingresos, Egresos, Bancos y Gráficos`);

  } catch (e) {
    logErr(&quot;reportes_excel_rango&quot;, e);
    bot.sendMessage(chatId, `❌ Error: ${e.message}`);
  }
});

// ✅ Comando: /reportes_excel_mes 06/2026
bot.onText(/^\/reportes_excel_mes\s+(\d{2}\/\d{4})$/, async (msg, match) =&gt; {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const mesStr = match[1];

  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, &quot;❌ Solo admin&quot;);
  }

  try {
    const [mes, año] = mesStr.split(&quot;/&quot;);
    const fechaInicio = `01/${mes}/${año}`;
    const ultimoDia = new Date(parseInt(año), parseInt(mes), 0).getDate();
    const fechaFin = `${String(ultimoDia).padStart(2, &quot;0&quot;)}/${mes}/${año}`;

    await bot.sendMessage(chatId, &quot;⏳ Generando Excel del mes...&quot;);
    const buffer = await generarReporteExcelPorRango(fechaInicio, fechaFin);

    const filename = `reporte_${año}-${mes}.xlsx`;
    const tempPath = `/tmp/${filename}`;
    try {
      fs.writeFileSync(tempPath, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []));
      await bot.sendDocument(chatId, tempPath, {}, {
        filename,
        contentType: &quot;application/vnd.openxmlformats-officedocument.spreadsheetml.sheet&quot;,
      });
    } finally {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    }

    await bot.sendMessage(chatId, `✅ Reporte de ${mesStr} descargado`);
  } catch (e) {
    logErr(&quot;reportes_excel_mes&quot;, e);
    bot.sendMessage(chatId, `❌ Error: ${e.message}`);
  }
});

module.exports = {
  menuPrincipal, menuVendedor, menuInventario, menuInventarioVideo, menuInventarioMusica,
  menuInventarioIptv, menuInventarioDisenoIA, menuClientes, menuRenovaciones, menuPagos,
  menuAlertas, menuFinRegistro, menuFinEliminarTipo, menuFinReportes,
  kbBancosFinanzas, kbBancosFinanzasEgreso, kbMotivosFinanzas,
  registrarIngresoTx, registrarEgresoTx,
  getMovimientosPorFecha, getMovimientosPorMes, getMovimientosPorRango,
  resumenFinanzasTextoPorFecha, resumenFinanzasTextoPorRango, resumenBancosMesTexto,
  resumenBancosFechaTexto, resumenBancosRangoTexto, detalleBancoRangoTexto,
  resumenTopPlataformasTexto, resumenTopPlataformasRangoTexto, resumenTopCombosRangoTexto,
  cierreCajaTexto, cierreCajaTextoRango, textoConfirmarEliminacionMovimiento,
  exportarFinanzasRangoExcel, eliminarMovimientoFinanzas,
  getMovimientoFinanzaById, textoMovimientoParaEliminar,
  resumenFinancieroPorMonthKey, listarMovimientosPorFechaYTipo,
  // ✅ v3: recordatorio renombrado a 11AM
  generarDashboard, enviarRecordatorios11AM, ejecutarBackupDominical,
  // compat
  menuFinanzas, menuRegistroFinanzas, menuEliminarMovimientoEspecifico, menuReportesFinanzas,
};
</textarea>
    <p class="small">Sublicuentas — Reportes Excel Finanzas fix.</p>
  </div>
<script>
const filename = 'index_05_finanzas_menus.js';
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
