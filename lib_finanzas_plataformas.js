"use strict";
/* ============================================================================================================
   R158 · EXCEL DE FINANZAS POR PLATAFORMA (spec "Excel de Finanzas por Plataforma", oct-2026)
   Lógica PURA: recibe los movimientos ya leídos de la base central y arma las hojas
   RESUMEN_PLATAFORMAS · DETALLE_PLANES · DETALLE_VENTAS · RESUMEN_MENSUAL · METADATOS.
   La usa el ÚNICO generador de Excel de finanzas (index_10_reportes_excel.js → generarReporteExcelPorRango),
   que sirve al Bot TG y, por la API del panel, a la Web. Ningún canal recalcula nada.
   Reglas:
   · Ventas = la MISMA definición que Estados financieros (lib_finanzas_costeo.ventasACostear con paraIngresos):
     ventas de compra/renovación/socios + ingresos manuales; sin anuladas, corregidas ni reversas.
   · Monto = lo que se cobró en ESA venta (campo monto guardado), repartido entre sus servicios con la misma regla
     del costeo (unidadesDeVenta). NUNCA se recalcula con el precio actual del catálogo.
   · Agrupación por ID estable del servicio (normPlataformaKey del catálogo); el nombre visible sale de los datos.
     Sin listas fijas de plataformas: un servicio nuevo aparece solo.
   · Fechas en hora de Honduras (movementYmd). Nunca se exportan correos, claves, PIN ni credenciales.
   ============================================================================================================ */

const VERSION = "plataformas-1.0 (R158 · 30/10/2026)";
const r2 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const limpio = (v, max = 120) => String(v ?? "").replace(/[⭐★☆✨]|\uD83C[\uDF1F\uDF20]|️/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const normTxt = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const SIN_SERVICIO = "__sin_servicio__";

/* ---------- Fechas (yyyy-mm-dd) ---------- */
function ymdUTC(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
function addDays(ymd, n) { const [y, m, d] = ymd.split("-").map(Number); return ymdUTC(new Date(Date.UTC(y, m - 1, d + n, 12))); }
function diasEntre(a, b) { const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000); }
function finDeMes(ym) { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; }
function mesMenos(ym, n) { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 - n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const nombreMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dmy = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "");
function dmyAYmd(v) { const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; }

// Período de comparación: mes calendario completo → mes anterior completo; cualquier otro rango → los N días inmediatamente anteriores.
function periodoAnterior(desde, hasta) {
  if (desde.endsWith("-01") && hasta === finDeMes(desde.slice(0, 7))) { const ym = mesMenos(desde.slice(0, 7), 1); return { desde: `${ym}-01`, hasta: finDeMes(ym), tipo: "mes calendario anterior" }; }
  const n = diasEntre(desde, hasta) + 1;
  return { desde: addDays(desde, -n), hasta: addDays(desde, -1), tipo: `${n} día${n === 1 ? "" : "s"} inmediatamente anteriores` };
}
// Rango que hay que leer para el período, su comparación y los 6 meses del resumen mensual.
function rangoLectura(desde, hasta) {
  const prev = periodoAnterior(desde, hasta);
  const ini6 = `${mesMenos(hasta.slice(0, 7), 5)}-01`;
  return { desde: [prev.desde, ini6, desde].sort()[0], hasta };
}

/* ---------- Líneas de venta ---------- */
function tipoVenta(v) {
  const s = String(v.subtipo || ""), o = String(v.tipoOrigen || "");
  if (/^(compra_nueva|cobro_compra|compra_socio)$/.test(s) || o === "compra") return "Nueva";
  if (/^(renovacion|cobro_renovacion)$/.test(s) || o === "renovacion") return "Renovación";
  const t = normTxt(`${v.categoria || ""} ${v.concepto || ""} ${v.motivo || ""} ${v.detalle || ""}`);
  if (/\brenov/.test(t)) return "Renovación";
  if (/\b(nuev|compra|venta nueva|alta)\b/.test(t)) return "Nueva";
  return "Sin clasificar";
}
function canalDe(v, fuente) {
  const c = normTxt(v.origenCanal || v.origen || v.canal || "");
  if (/apk|android|movil/.test(c)) return "APK";
  if (/web|hq|sublichat/.test(c)) return "Web";
  if (/tg|telegram|bot/.test(c)) return "Bot TG";
  if (/socio|revend|panel/.test(c) || v.subtipo === "compra_socio") return "Panel de socios";
  if (fuente === "finanzas") return "Bot TG (histórico)";
  return c ? limpio(c, 30) : "Sin registro";
}
function mesesEntreDmy(a, b) { const x = dmyAYmd(a), y = dmyAYmd(b); if (!x || !y) return 0; const d = diasEntre(x, y); return d > 0 ? Math.max(1, Math.round(d / 30)) : 0; }
// Plan / variante: lo GUARDADO en la venta (texto del producto, meses, dispositivos). Si no hay dato, se dice.
function planDe(fuente = {}, v = {}, servicioTxt = "") {
  const partes = String(servicioTxt).split(/\s+·\s+/);
  let plan = partes.length > 1 ? limpio(partes.slice(1).join(" · "), 60) : "";
  const meses = Number(fuente.meses || fuente.duracionMeses || v.meses || v.duracionMeses || 0) || mesesEntreDmy(v.fechaAnterior, v.fechaNueva);
  if (!plan && (fuente.plan || fuente.variante || v.plan || v.variante)) plan = limpio(fuente.plan || fuente.variante || v.plan || v.variante, 60);
  if (!plan && meses) plan = `${meses} mes${meses === 1 ? "" : "es"}`;
  const disp = Number(fuente.dispositivos || fuente.pantallas || v.dispositivos || v.pantallas || 0);
  if (disp && !/disp|pantall/i.test(plan)) plan = `${plan ? plan + " / " : ""}${disp} disp.`;
  return plan || "Sin plan registrado";
}
// Unidades de una venta con su metadato (mismo orden y reparto que unidadesDeVenta del costeo).
// Texto "Netflix + Spotify, Canva" → servicios. Un "+" pegado al nombre es parte de la marca (Disney+ Premium,
// Apple TV+, Paramount+): solo separa " + " con espacios, coma, " y ", "&" o "/".
function serviciosTexto(t) { return String(t || "").split(/\s+\+\s+|\s*,\s*|\s*\/\s*|\s+y\s+|\s*&\s*/i).map((x) => limpio(x, 60)).filter(Boolean); }
function repartoIgual(total, cantidades) {
  const n = cantidades.reduce((a, c) => a + c, 0) || 1; let resto = r2(total);
  return cantidades.map((c, i) => { const ing = i === cantidades.length - 1 ? r2(resto) : r2((total * c) / n); resto = r2(resto - ing); return { cantidad: c, ingresoHnl: ing }; });
}
function lineasDeVenta(v, { C, normKey }) {
  let fuentes, montos;
  if (Array.isArray(v.productosSocio) && v.productosSocio.length) fuentes = v.productosSocio.map((p) => ({ src: p || {}, txt: String(p?.servicio || p?.plataforma || v.plataforma || ""), cliente: p?.clienteNombre || "" }));
  else if (Array.isArray(v.servicios) && v.servicios.length) fuentes = v.servicios.map((s) => ({ src: s || {}, txt: String(s?.plataforma || s?.servicio || ""), cliente: "" }));
  if (fuentes) montos = C.unidadesDeVenta(v); // mismo reparto que el costo de ventas
  else { fuentes = serviciosTexto(v.plataforma).map((t) => ({ src: {}, txt: t, cliente: "" })); montos = fuentes.length ? repartoIgual(Number(v.monto) || 0, fuentes.map(() => 1)) : []; }
  fuentes = fuentes.filter((f) => limpio(f.txt.split(/\s+·\s+/)[0], 60));
  if (!montos.length || montos.length !== fuentes.length) {
    return [{ key: SIN_SERVICIO, nombre: limpio(v.plataforma, 60) || "Sin servicio identificado", plan: "Sin plan registrado", cantidad: 1, ingreso: r2(v.monto), cliente: "" }];
  }
  return montos.map((u, i) => {
    const base = limpio(fuentes[i].txt.split(/\s+·\s+/)[0], 60);
    return { key: normKey(base) || normTxt(base).replace(/\s+/g, "") || SIN_SERVICIO, nombre: base, plan: planDe(fuentes[i].src, v, fuentes[i].txt), cantidad: u.cantidad, ingreso: u.ingresoHnl, cliente: limpio(fuentes[i].cliente, 80) };
  });
}

/* Ventas válidas → filas (una por servicio vendido). movs = movimientos crudos con id (y _fuente opcional). */
function filasVentas(movs, { R, C, normKey, desde, hasta }) {
  const ventas = C.ventasACostear(movs, desde, R, { paraIngresos: true }).filter((v) => !v.anulada && v.fecha <= hasta);
  const filas = [];
  for (const v of ventas) {
    const clienteBase = limpio(v.clienteNombre || v.cliente || v.socioNombre || "", 80);
    for (const ln of lineasDeVenta(v, { C, normKey })) {
      const cliNombre = ln.cliente || clienteBase;
      const cliId = ln.cliente ? `nom:${normTxt(ln.cliente)}` : (v.clienteId ? `id:${v.clienteId}` : (cliNombre ? `nom:${normTxt(cliNombre)}` : ""));
      const reembolso = r2(Math.abs(Number(v.reembolso || v.montoReembolso || 0)) * (Number(v.monto) ? ln.ingreso / Number(v.monto) : 0));
      filas.push({
        fecha: v.fecha, mes: v.fecha.slice(0, 7), ventaId: String(v.id), clienteId: cliId, cliente: cliNombre || "Sin cliente registrado",
        key: ln.key, servicio: ln.nombre, plan: ln.plan, tipo: tipoVenta(v), cantidad: ln.cantidad,
        monto: r2(ln.ingreso), reembolso, neto: r2(ln.ingreso - reembolso),
        pendiente: r2(Number(v.saldoPendiente || 0) * (Number(v.monto) ? ln.ingreso / Number(v.monto) : 0)),
        canal: canalDe(v, v._fuente), vendedor: limpio(v.vendedor || v.vendedorNombre || v.registradoPorNombre || v.registradoPor || v.usuario || "", 40) || "Sin registro",
      });
    }
  }
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ventaId.localeCompare(b.ventaId));
}

/* ---------- Agregados ---------- */
// Nombre visible de cada ID: el más usado en el período (si varía la escritura, no se duplica la fila).
function nombresPorKey(filas) {
  const cnt = new Map();
  for (const f of filas) { const m = cnt.get(f.key) || new Map(); m.set(f.servicio, (m.get(f.servicio) || 0) + f.cantidad); cnt.set(f.key, m); }
  return new Map([...cnt].map(([k, m]) => [k, k === SIN_SERVICIO ? "Sin servicio identificado" : [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]]));
}
function agrupar(filas) {
  const g = new Map();
  for (const f of filas) {
    const x = g.get(f.key) || { key: f.key, neto: 0, ventas: 0, clientes: new Set(), nuevas: 0, renov: 0, pendiente: 0 };
    x.neto += f.neto; x.ventas += f.cantidad; x.pendiente += f.pendiente;
    if (f.clienteId) x.clientes.add(f.clienteId);
    if (f.tipo === "Nueva") x.nuevas += f.cantidad; else if (f.tipo === "Renovación") x.renov += f.cantidad;
    g.set(f.key, x);
  }
  return g;
}
function resumenPlataformas(filas, filasPrev, { hayPrevio = true } = {}) {
  const nombres = nombresPorKey(filas), g = agrupar(filas), gp = agrupar(filasPrev);
  const total = r2(filas.reduce((a, f) => a + f.neto, 0));
  const rows = [...g.values()].map((x) => {
    const prev = gp.get(x.key), netoPrev = prev ? r2(prev.neto) : 0;
    return {
      key: x.key, servicio: nombres.get(x.key), neto: r2(x.neto), ventas: x.ventas, clientes: x.clientes.size, nuevas: x.nuevas, renovaciones: x.renov,
      ticket: x.ventas ? r2(x.neto / x.ventas) : 0, participacion: total ? x.neto / total : 0,
      tendencia: hayPrevio && netoPrev > 0 ? (x.neto - netoPrev) / netoPrev : null, netoAnterior: netoPrev, pendiente: r2(x.pendiente),
    };
  }).sort((a, b) => b.neto - a.neto || b.ventas - a.ventas || a.servicio.localeCompare(b.servicio));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const totPrev = r2(filasPrev.reduce((a, f) => a + f.neto, 0));
  const todos = new Set(filas.map((f) => f.clienteId).filter(Boolean));
  return {
    rows, total: { neto: total, ventas: filas.reduce((a, f) => a + f.cantidad, 0), clientes: todos.size, nuevas: rows.reduce((a, r) => a + r.nuevas, 0), renovaciones: rows.reduce((a, r) => a + r.renovaciones, 0), pendiente: r2(rows.reduce((a, r) => a + r.pendiente, 0)), tendencia: hayPrevio && totPrev > 0 ? (total - totPrev) / totPrev : null, netoAnterior: totPrev },
  };
}
function detallePlanes(filas) {
  const nombres = nombresPorKey(filas), porSvc = new Map();
  for (const f of filas) {
    const s = porSvc.get(f.key) || { total: 0, planes: new Map() };
    const p = s.planes.get(f.plan) || { ventas: 0, clientes: new Set(), neto: 0 };
    p.ventas += f.cantidad; p.neto += f.neto; if (f.clienteId) p.clientes.add(f.clienteId);
    s.planes.set(f.plan, p); s.total += f.neto; porSvc.set(f.key, s);
  }
  return [...porSvc.entries()].sort((a, b) => b[1].total - a[1].total).flatMap(([k, s]) => [...s.planes.entries()]
    .sort((a, b) => b[1].ventas - a[1].ventas || b[1].neto - a[1].neto)
    .map(([plan, p]) => ({ servicio: nombres.get(k), plan, ventas: p.ventas, clientes: p.clientes.size, neto: r2(p.neto), dentro: s.total ? p.neto / s.total : 0 })));
}
function resumenMensual(filas, hastaYm) {
  const meses = Array.from({ length: 6 }, (_, i) => mesMenos(hastaYm, 5 - i));
  const enMeses = filas.filter((f) => meses.includes(f.mes));
  const nombres = nombresPorKey(enMeses), tot = agrupar(enMeses);
  const keys = [...tot.values()].sort((a, b) => b.neto - a.neto).map((x) => x.key);
  const tabla = meses.map((ym) => {
    const delMes = enMeses.filter((f) => f.mes === ym), g = agrupar(delMes);
    return { mes: ym, nombre: nombreMes(ym), porKey: Object.fromEntries(keys.map((k) => [k, r2(g.get(k)?.neto || 0)])), ventasPorKey: Object.fromEntries(keys.map((k) => [k, g.get(k)?.ventas || 0])), total: r2(delMes.reduce((a, f) => a + f.neto, 0)), ventas: delMes.reduce((a, f) => a + f.cantidad, 0) };
  });
  tabla.forEach((t, i) => { const p = tabla[i - 1]; t.variacion = p && p.total > 0 ? (t.total - p.total) / p.total : null; });
  return { meses: tabla, columnas: keys.map((k) => ({ key: k, nombre: nombres.get(k) })) };
}

/* Datos completos del reporte. movs = movimientos crudos (con id) que cubren rangoLectura(desde, hasta). */
function datosPlataformas(movs, { R, C, normKey, desde, hasta, ahora = new Date() }) {
  const prev = periodoAnterior(desde, hasta), lec = rangoLectura(desde, hasta);
  const todas = filasVentas(movs, { R, C, normKey, desde: lec.desde, hasta });
  const filas = todas.filter((f) => f.fecha >= desde && f.fecha <= hasta);
  const filasPrev = todas.filter((f) => f.fecha >= prev.desde && f.fecha <= prev.hasta);
  const primeraFecha = movs.map((m) => R.movementYmd(m)).filter(Boolean).sort()[0] || "";
  const hayPrevio = !!primeraFecha && primeraFecha <= prev.hasta; // hay datos del período anterior
  return {
    desde, hasta, anterior: { ...prev, disponible: hayPrevio }, ahora,
    resumen: resumenPlataformas(filas, filasPrev, { hayPrevio }), planes: detallePlanes(filas), detalle: filas,
    mensual: resumenMensual(todas, hasta.slice(0, 7)),
    revision: filas.filter((f) => f.key === SIN_SERVICIO || f.cliente === "Sin cliente registrado" || f.tipo === "Sin clasificar"),
  };
}

/* ---------- Libro Excel (ExcelJS) ---------- */
const C_ = { tinta: "FF111827", rojo: "FFE2231A", gris: "FFF4F6F8", linea: "FFE5E7EB", blanco: "FFFFFFFF", verde: "FF15803D", verdeSuave: "FFE8F5EC", rojoSuave: "FFFDECEC", oro: "FFFFF4D6", muted: "FF64748B" };
const FMT_L = '"L"#,##0.00';
const FMT_PCT = "0.0%";
const BORDE = { top: { style: "thin", color: { argb: C_.linea } }, left: { style: "thin", color: { argb: C_.linea } }, bottom: { style: "thin", color: { argb: C_.linea } }, right: { style: "thin", color: { argb: C_.linea } } };

function hoja(wb, nombre, titulo, subtitulo, columnas) {
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: C_.rojo } }, views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = columnas.map((c) => ({ key: c.key, width: c.width || 14 }));
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.mergeCells(1, 1, 1, columnas.length); ws.mergeCells(2, 1, 2, columnas.length);
  const t = ws.getCell(1, 1); t.value = titulo; t.font = { bold: true, size: 15, color: { argb: C_.tinta } };
  const s = ws.getCell(2, 1); s.value = subtitulo; s.font = { size: 10.5, color: { argb: C_.muted } };
  ws.getRow(1).height = 24; ws.getRow(3).height = 4;
  const h = ws.getRow(4); h.values = columnas.map((c) => c.titulo); h.height = 30;
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_.tinta } }; c.font = { bold: true, color: { argb: C_.blanco }, size: 10.5 }; c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = { ...BORDE, bottom: { style: "medium", color: { argb: C_.rojo } } }; });
  return ws;
}
function fila(ws, valores, columnas, { total = false, zebra = false } = {}) {
  const r = ws.addRow(valores);
  columnas.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    if (c.fmt) cell.numFmt = c.fmt;
    cell.border = BORDE;
    cell.alignment = { vertical: "middle", horizontal: c.align || (c.fmt ? "right" : "left") };
    if (total) { cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_.gris } }; cell.border = { ...BORDE, top: { style: "medium", color: { argb: C_.tinta } } }; }
    else if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAFB" } };
  });
  return r;
}
function filtro(ws, columnas, ultimaFila) { if (ultimaFila >= 5) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: ultimaFila, column: columnas.length } }; }
function tendencia(cell, v) {
  if (v === null || v === undefined) { cell.value = "N/D"; cell.alignment = { horizontal: "center", vertical: "middle" }; cell.font = { color: { argb: C_.muted } }; return; }
  cell.value = v; cell.numFmt = '+0.0%;-0.0%;0.0%';
  cell.font = { bold: true, color: { argb: v > 0 ? C_.verde : v < 0 ? C_.rojo : C_.tinta } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: v > 0 ? C_.verdeSuave : v < 0 ? C_.rojoSuave : C_.blanco } };
}

function agregarHojasPlataformas(wb, d, { filtros = "Ninguno (todas las ventas del período)" } = {}) {
  const per = `Período ${dmy(d.desde)} al ${dmy(d.hasta)}`;
  // 1) RESUMEN_PLATAFORMAS
  const cR = [
    { key: "rank", titulo: "#", width: 6, align: "center" }, { key: "servicio", titulo: "Servicio / Plataforma", width: 30 },
    { key: "neto", titulo: "Ingreso neto", width: 16, fmt: FMT_L }, { key: "ventas", titulo: "Ventas", width: 10, fmt: "#,##0" },
    { key: "clientes", titulo: "Clientes únicos", width: 12, fmt: "#,##0" }, { key: "nuevas", titulo: "Nuevas", width: 10, fmt: "#,##0" },
    { key: "renovaciones", titulo: "Renov.", width: 10, fmt: "#,##0" }, { key: "ticket", titulo: "Ticket prom.", width: 14, fmt: FMT_L },
    { key: "participacion", titulo: "% del ingreso", width: 12, fmt: FMT_PCT }, { key: "tendencia", titulo: "Tendencia", width: 12 },
    { key: "pendiente", titulo: "Pendiente de cobro", width: 16, fmt: FMT_L },
  ];
  const wsR = hoja(wb, "RESUMEN_PLATAFORMAS", "SUBLICUENTAS · RESUMEN POR PLATAFORMA", `${per} · Comparación: ${d.anterior.tipo} (${dmy(d.anterior.desde)} al ${dmy(d.anterior.hasta)})${d.anterior.disponible ? "" : " · sin datos previos: N/D"}`, cR);
  d.resumen.rows.forEach((x, i) => {
    const r = fila(wsR, [`#${x.rank}`, x.servicio, x.neto, x.ventas, x.clientes, x.nuevas, x.renovaciones, x.ticket, x.participacion, null, x.pendiente], cR, { zebra: i % 2 === 1 });
    tendencia(r.getCell(10), x.tendencia);
    if (x.rank <= 3 && x.neto > 0) { r.getCell(2).font = { bold: true }; r.getCell(3).font = { bold: true }; r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_.oro } }; }
  });
  const first = 5, last = 4 + d.resumen.rows.length;
  const T = d.resumen.total;
  const rt = fila(wsR, ["", "TOTAL", last >= first ? { formula: `SUM(C${first}:C${last})`, result: T.neto } : 0, last >= first ? { formula: `SUM(D${first}:D${last})`, result: T.ventas } : 0, T.clientes, last >= first ? { formula: `SUM(F${first}:F${last})`, result: T.nuevas } : 0, last >= first ? { formula: `SUM(G${first}:G${last})`, result: T.renovaciones } : 0, T.ventas ? r2(T.neto / T.ventas) : 0, T.neto ? 1 : 0, null, last >= first ? { formula: `SUM(K${first}:K${last})`, result: T.pendiente } : 0], cR, { total: true });
  tendencia(rt.getCell(10), T.tendencia); rt.getCell(10).font = { ...(rt.getCell(10).font || {}), bold: true };
  filtro(wsR, cR, last);
  if (!d.resumen.rows.length) { const r = wsR.addRow(["", "Sin ventas en el período."]); r.getCell(2).font = { italic: true, color: { argb: C_.muted } }; }
  wsR.addRow([]);
  const nota = wsR.addRow(["", "Clientes únicos del TOTAL = clientes distintos de todo el período (un cliente que compró 2 servicios cuenta 1 vez)."]);
  nota.getCell(2).font = { size: 9.5, color: { argb: C_.muted } };

  // 2) DETALLE_PLANES
  const cP = [{ key: "servicio", titulo: "Servicio", width: 30 }, { key: "plan", titulo: "Plan / variante", width: 26 }, { key: "ventas", titulo: "Ventas", width: 10, fmt: "#,##0" }, { key: "clientes", titulo: "Clientes", width: 10, fmt: "#,##0" }, { key: "neto", titulo: "Ingreso", width: 16, fmt: FMT_L }, { key: "dentro", titulo: "% dentro del servicio", width: 14, fmt: FMT_PCT }];
  const wsP = hoja(wb, "DETALLE_PLANES", "DETALLE POR PLAN / DURACIÓN / DISPOSITIVOS", `${per} · Qué variante compra más el cliente`, cP);
  d.planes.forEach((p, i) => fila(wsP, [p.servicio, p.plan, p.ventas, p.clientes, p.neto, p.dentro], cP, { zebra: i % 2 === 1 }));
  filtro(wsP, cP, 4 + d.planes.length);

  // 3) DETALLE_VENTAS
  const cV = [
    { key: "fecha", titulo: "Fecha", width: 12, align: "center" }, { key: "ventaId", titulo: "ID venta", width: 30 }, { key: "cliente", titulo: "Cliente", width: 26 },
    { key: "servicio", titulo: "Servicio", width: 24 }, { key: "plan", titulo: "Plan", width: 18 }, { key: "tipo", titulo: "Tipo", width: 13 }, { key: "cantidad", titulo: "Cant.", width: 7, fmt: "#,##0" },
    { key: "monto", titulo: "Monto cobrado", width: 15, fmt: FMT_L }, { key: "reembolso", titulo: "Reembolso", width: 13, fmt: FMT_L }, { key: "neto", titulo: "Neto", width: 15, fmt: FMT_L },
    { key: "pendiente", titulo: "Pendiente de cobro", width: 15, fmt: FMT_L }, { key: "canal", titulo: "Canal", width: 16 }, { key: "vendedor", titulo: "Vendedor / usuario", width: 18 },
  ];
  const wsV = hoja(wb, "DETALLE_VENTAS", "DETALLE DE VENTAS (una fila por servicio vendido)", `${per} · Sirve para conciliar cualquier cifra del resumen`, cV);
  d.detalle.forEach((f, i) => {
    const [y, m, dd] = f.fecha.split("-").map(Number);
    const r = fila(wsV, [new Date(Date.UTC(y, m - 1, dd, 12)), f.ventaId, f.cliente, d.resumen.rows.find((x) => x.key === f.key)?.servicio || f.servicio, f.plan, f.tipo, f.cantidad, f.monto, f.reembolso, f.neto, f.pendiente, f.canal, f.vendedor], cV, { zebra: i % 2 === 1 });
    r.getCell(1).numFmt = "dd/mm/yyyy";
  });
  const lv = 4 + d.detalle.length;
  if (d.detalle.length) fila(wsV, ["", "", "", "TOTAL", "", "", { formula: `SUM(G5:G${lv})`, result: d.resumen.total.ventas }, { formula: `SUM(H5:H${lv})`, result: r2(d.detalle.reduce((a, f) => a + f.monto, 0)) }, { formula: `SUM(I5:I${lv})`, result: r2(d.detalle.reduce((a, f) => a + f.reembolso, 0)) }, { formula: `SUM(J5:J${lv})`, result: d.resumen.total.neto }, { formula: `SUM(K5:K${lv})`, result: d.resumen.total.pendiente }, "", ""], cV, { total: true });
  filtro(wsV, cV, lv);

  // 4) RESUMEN_MENSUAL (columnas dinámicas)
  const cols = d.mensual.columnas;
  const cM = [{ key: "mes", titulo: "Mes", width: 12 }, ...cols.map((c) => ({ key: c.key, titulo: c.nombre, width: 15, fmt: FMT_L })), { key: "total", titulo: "Total", width: 16, fmt: FMT_L }, { key: "ventas", titulo: "Ventas", width: 10, fmt: "#,##0" }, { key: "var", titulo: "Var. vs mes anterior", width: 14 }];
  const wsM = hoja(wb, "RESUMEN_MENSUAL", "INGRESO POR PLATAFORMA · ÚLTIMOS 6 MESES", `Hasta ${dmy(d.hasta)} · Ingreso neto por mes (columnas = servicios con ventas)`, cM);
  d.mensual.meses.forEach((t, i) => { const r = fila(wsM, [t.nombre, ...cols.map((c) => t.porKey[c.key]), t.total, t.ventas, null], cM, { zebra: i % 2 === 1 }); tendencia(r.getCell(cM.length), t.variacion); });
  filtro(wsM, cM, 4 + d.mensual.meses.length);

  // 5) METADATOS
  const wsX = wb.addWorksheet("METADATOS", { properties: { tabColor: { argb: C_.tinta } } });
  wsX.columns = [{ width: 34 }, { width: 90 }];
  const hn = new Date(d.ahora.getTime() - 6 * 3600000);
  const meta = [
    ["Reporte", "Sublicuentas · Excel de Finanzas por Plataforma"], ["Período", `${dmy(d.desde)} al ${dmy(d.hasta)}`],
    ["Comparación (Tendencia)", `${d.anterior.tipo}: ${dmy(d.anterior.desde)} al ${dmy(d.anterior.hasta)}${d.anterior.disponible ? "" : " — sin datos previos, se muestra N/D"}`],
    ["Generado", `${ymdUTC(hn).split("-").reverse().join("/")} ${String(hn.getUTCHours()).padStart(2, "0")}:${String(hn.getUTCMinutes()).padStart(2, "0")} (hora de Honduras)`],
    ["Versión del exportador", VERSION], ["Moneda", "HNL · Lempiras"], ["Filtros aplicados", filtros],
    ["Fuente", "Base central: finanzas_movimientos (y la colección histórica finanzas antes del 01/10/2026). Un solo generador para Bot TG y Web."],
    ["Ingreso neto", "Monto guardado en cada venta (lo que se cobró en esa operación) − reembolsos. No usa el precio actual del catálogo."],
    ["Ventas que cuentan", "Las mismas de Estados financieros: compras, renovaciones, compras de socios e ingresos manuales vigentes. Sin anuladas, corregidas, reversas ni abonos de cuentas por cobrar."],
    ["Servicio", "Agrupado por ID estable del catálogo (no por texto). El nombre visible es el más usado en el período."],
    ["Pendiente de cobro", "Parte de la venta que quedó en cuentas por cobrar al registrarla. Ya está incluida en el Ingreso neto."],
    ["Credenciales", "Este archivo no contiene correos, claves, PIN ni datos de acceso."],
    ["Ventas que requieren revisión manual", String(d.revision.length)],
  ];
  meta.forEach(([a, b]) => { const r = wsX.addRow([a, b]); r.getCell(1).font = { bold: true }; r.getCell(2).alignment = { wrapText: true, vertical: "top" }; r.getCell(1).alignment = { vertical: "top" }; });
  if (d.revision.length) {
    wsX.addRow([]);
    const h = wsX.addRow(["Revisión manual (sin servicio, sin cliente o sin tipo)", ""]); h.getCell(1).font = { bold: true, color: { argb: C_.rojo } };
    d.revision.slice(0, 300).forEach((f) => wsX.addRow([`${dmy(f.fecha)} · ${f.ventaId}`, `${f.servicio} · ${f.cliente} · ${f.tipo} · L${f.neto.toFixed(2)}`]));
  }
  return wb;
}

function nombreArchivo(desde, hasta) { return `Sublicuentas_Finanzas_${desde}_a_${hasta}.xlsx`; }

module.exports = { VERSION, SIN_SERVICIO, periodoAnterior, rangoLectura, tipoVenta, planDe, lineasDeVenta, filasVentas, resumenPlataformas, detallePlanes, resumenMensual, datosPlataformas, agregarHojasPlataformas, nombreArchivo, dmyAYmd };
