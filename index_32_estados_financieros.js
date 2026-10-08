/* SUBLICUENTAS — R134 · ESTADOS FINANCIEROS + PARTIDA DOBLE en Telegram (solo Sublicuentas y Relojes)
   Misma lógica que la web/API (lib_contabilidad.js = api/_contabilidad.js):
   · 📊 Estado de resultados del mes (ingresos por categoría y origen, gastos, planilla, utilidad y margen).
   · 💧 Flujo de caja por banco (saldo inicial + entradas − salidas = saldo final, cuadra con el saldo real).
   · 📒 Libro diario en partida doble y balanza de comprobación (Debe = Haber).
   · 📥 Excel con las 4 hojas.
*/
const { bot, db, ExcelJS } = require("./index_01_core");
const { upsertPanel, logErr } = require("./index_02_utils_roles");
const R = require("./lib_finanzas_reglas");
const C = require("./lib_contabilidad");
let clasificar = null; try { clasificar = require("./lib_catalogo_categorias").clasificarServicio; } catch (_) {}

const lps = (n) => `Lps. ${R.fmt(n)}`;
const hoyYmd = () => R.ymd(new Date(Date.now() - 6 * 3600000));
const dmy = (v) => { const [y, m, d] = String(v || "").split("-"); return d ? `${d}/${m}/${y}` : String(v || ""); };
const esc = (v) => String(v ?? "").replace(/[*_`\[\]]/g, "");

async function cargarEstados(mes) {
  const L = require("./index_31_finanzas_libro");
  const { methods, libro, movimientos } = await L.estadoLibro();
  return C.estadosFinancieros({ movimientos, libro, methods, mes: mes || hoyYmd().slice(0, 7), hoy: hoyYmd(), clasificar });
}

function textoEstados(ef) {
  const r = ef.resultados, f = ef.flujo, b = ef.balanza;
  const lista = (rows, n = 6) => rows.slice(0, n).map((x) => `   • ${esc(x.nombre)}: ${lps(x.monto)}`).concat(rows.length > n ? [`   • (+${rows.length - n} más en el Excel)`] : []);
  return [
    `📊 *ESTADOS FINANCIEROS · ${ef.nombre}*`, `${dmy(ef.desde)} al ${dmy(ef.hasta)} · base efectivo`, "",
    "*ESTADO DE RESULTADOS*",
    `💵 Ingresos: *${lps(r.ingresos.total)}* (${r.ingresos.pagos} cobros)`, ...lista(r.ingresos.porCategoria),
    `🧾 Gastos operativos: −${lps(r.gastosOperativos.total)}`, ...lista(r.gastosOperativos.porConcepto, 4),
    `= Utilidad operativa: *${lps(r.utilidadOperativa)}* (${r.margenOperativo}%)`,
    `👥 Planilla y comisiones: −${lps(r.planilla.total)}`,
    `= *Utilidad neta: ${lps(r.utilidadNeta)}* · margen ${r.margenNeto}%`, "",
    "*FLUJO DE CAJA (bancos)*",
    `Saldo inicial: ${lps(f.saldoInicial)}`, `+ Cobros: ${lps(f.cobros)}`, `− Gastos: ${lps(f.gastos)}`, `− Planilla: ${lps(f.planilla)}`,
    ...(f.ajustes ? [`± Ajustes / aperturas: ${lps(f.ajustes)}`] : []),
    `= Saldo final: *${lps(f.saldoFinal)}* ${f.cuadra ? "✅ cuadra con los bancos" : "⚠️ revisar"}`,
    `Flujo operativo del mes: ${lps(f.flujoOperativo)}`,
    ...(f.sinBanco.n ? [`⚠️ ${f.sinBanco.n} cobro/gasto sin banco (${lps(f.sinBanco.neto)}): enlácelos en 🏷 Movimientos sin banco.`] : []), "",
    "*PARTIDA DOBLE*",
    `📒 ${ef.diario.length} asientos · Debe ${lps(b.debe)} = Haber ${lps(b.haber)} ${b.cuadra ? "✅" : "⚠️ NO cuadra"}`,
  ].join("\n");
}

async function panelEstados(chatId, mes) {
  try {
    const ef = await cargarEstados(mes);
    const nav = [{ text: `⬅️ ${C.mesBounds(ef.anterior).nombre}`, callback_data: `fl:ef:${ef.anterior}` }];
    if (ef.siguiente <= hoyYmd().slice(0, 7)) nav.push({ text: `${C.mesBounds(ef.siguiente).nombre} ➡️`, callback_data: `fl:ef:${ef.siguiente}` });
    return upsertPanel(chatId, textoEstados(ef), [
      [{ text: "📥 Excel (resultados, flujo, diario, balanza)", callback_data: `fl:efx:${ef.mes}` }],
      nav,
      [{ text: "⬅️ Ciclo", callback_data: "fl:menu" }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
    ]);
  } catch (e) { logErr("R134 panelEstados", e); return bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 200)}`); }
}

// ---------------------------------------------------------------- Excel (mismo estilo que el reporte del bot)
const X = { rojo: "FFE2231A", negro: "FF0A0A1A", blanco: "FFFFFFFF", zebra: "FFF4F6F8", verde: "FF16A34A", verdeClaro: "FFE6F4EA", rojoClaro: "FFFCE8E6", gris: "FFE7E9EF" };
const MONEY = '"Lps " #,##0.00;[Red]-"Lps " #,##0.00';
const MONEY_TOTAL = '"Lps " #,##0.00;-"Lps " #,##0.00'; // en filas de color: sin rojo (no se leería)
const BORDE = { top: { style: "thin", color: { argb: X.gris } }, left: { style: "thin", color: { argb: X.gris } }, bottom: { style: "thin", color: { argb: X.gris } }, right: { style: "thin", color: { argb: X.gris } } };
const pinta = (c, argb) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; };
function titulo(ws, t, sub, cols) {
  ws.addRow([]);
  const r1 = ws.addRow([t]); r1.height = 30; ws.mergeCells(r1.number, 1, r1.number, cols);
  pinta(r1.getCell(1), X.rojo); r1.getCell(1).font = { bold: true, size: 15, color: { argb: X.blanco } }; r1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  const r2 = ws.addRow([sub]); r2.height = 20; ws.mergeCells(r2.number, 1, r2.number, cols);
  pinta(r2.getCell(1), X.negro); r2.getCell(1).font = { bold: true, size: 10, color: { argb: X.blanco } }; r2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  ws.addRow([]);
}
function encabezado(ws, vals) {
  const h = ws.addRow(vals); h.height = 22;
  h.eachCell((c) => { pinta(c, X.negro); c.font = { bold: true, color: { argb: X.blanco } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = BORDE; });
  return h.number;
}
function fila(ws, vals, { money = [], bold = false, fondo = "", letra = "" } = {}) {
  const r = ws.addRow(vals);
  r.eachCell({ includeEmpty: true }, (c) => { c.border = BORDE; if (fondo) pinta(c, fondo); if (bold || letra) c.font = { bold, ...(letra ? { color: { argb: letra } } : {}) }; });
  money.forEach((k) => { r.getCell(k).numFmt = letra === X.blanco ? MONEY_TOTAL : MONEY; });
  return r;
}
const pct = (v, t) => (t ? v / t : 0);

async function excelEstados(ef) {
  const wb = new ExcelJS.Workbook(); wb.creator = "Sublicuentas Bot"; wb.created = new Date(); wb.calcProperties.fullCalcOnLoad = true;
  const sub = `${ef.nombre} · ${dmy(ef.desde)} al ${dmy(ef.hasta)} · base efectivo`;
  const r = ef.resultados, f = ef.flujo;

  // 1) Estado de resultados
  const er = wb.addWorksheet("Estado de resultados"); er.columns = [{ width: 44 }, { width: 18 }, { width: 14 }];
  titulo(er, "ESTADO DE RESULTADOS", sub, 3); encabezado(er, ["Concepto", "Monto", "% ingresos"]);
  const seccion = (t) => fila(er, [t, "", ""], { bold: true, fondo: X.zebra });
  const det = (rows) => rows.forEach((x) => { const rr = fila(er, [`   ${x.nombre}`, x.monto, pct(x.monto, r.ingresos.total)], { money: [2] }); rr.getCell(3).numFmt = "0.0%"; });
  const tot = (t, v, fondo, letra = X.blanco) => { const rr = fila(er, [t, v, pct(v, r.ingresos.total)], { money: [2], bold: true, fondo, letra }); rr.getCell(3).numFmt = "0.0%"; };
  seccion("INGRESOS POR VENTAS"); det(r.ingresos.porCategoria); tot("Total ingresos", r.ingresos.total, X.verde);
  seccion("GASTOS OPERATIVOS"); det(r.gastosOperativos.porConcepto); tot("Total gastos operativos", -r.gastosOperativos.total, X.rojo);
  tot("UTILIDAD OPERATIVA", r.utilidadOperativa, X.negro);
  seccion("PLANILLA Y COMISIONES"); det(r.planilla.porConcepto); tot("Total planilla y comisiones", -r.planilla.total, X.rojo);
  tot("UTILIDAD NETA", r.utilidadNeta, r.utilidadNeta >= 0 ? X.verde : X.rojo);
  er.addRow([]);
  encabezado(er, ["Ingresos por origen", "Monto", "% ingresos"]); det(r.ingresos.porOrigen);
  er.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // 2) Flujo de caja
  const fc = wb.addWorksheet("Flujo de caja"); fc.columns = [{ width: 22 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 16 }, { width: 15 }, { width: 10 }];
  titulo(fc, "FLUJO DE CAJA POR BANCO", `${sub} · saldo inicial + entradas − salidas = saldo final`, 9);
  const h = encabezado(fc, ["Banco", "Saldo inicial", "Cobros", "Gastos", "Planilla", "Transferencias", "Ajustes / apertura", "Saldo final", "Cuadra"]);
  f.bancos.forEach((b, i) => fila(fc, [b.nombre, b.saldoInicial, b.cobros, -b.gastos, -b.planilla, b.transferencias, b.ajustes, b.saldoFinal, b.cuadra ? "✔" : "✖"], { money: [2, 3, 4, 5, 6, 7, 8], fondo: i % 2 ? X.zebra : "" }));
  const first = h + 1, last = fc.rowCount, t = fc.addRow(["TOTAL"]);
  ["B", "C", "D", "E", "F", "G", "H"].forEach((L, k) => { const key = ["saldoInicial", "cobros", "gastos", "planilla", "transferencias", "ajustes", "saldoFinal"][k]; const v = ["gastos", "planilla"].includes(key) ? -f[key] : f[key]; t.getCell(k + 2).value = f.bancos.length ? { formula: `SUM(${L}${first}:${L}${last})`, result: v } : v; t.getCell(k + 2).numFmt = MONEY_TOTAL; });
  t.getCell(9).value = f.cuadra ? "✔" : "✖";
  t.eachCell({ includeEmpty: true }, (c) => { pinta(c, X.verde); c.font = { bold: true, color: { argb: X.blanco } }; c.border = BORDE; });
  fc.addRow([]);
  const nota = (txt, v, fondo = "") => { const rr = fila(fc, [txt, "", "", "", "", "", "", v, ""], { money: [8], bold: true, fondo }); fc.mergeCells(rr.number, 1, rr.number, 7); };
  nota("Flujo operativo del mes (cobros − gastos − planilla)", f.flujoOperativo);
  if (f.sinBanco.n) nota(`Cobros/gastos SIN banco (no entran a ningún banco): ${f.sinBanco.n}`, f.sinBanco.neto, X.rojoClaro);
  fc.views = [{ state: "frozen", ySplit: h }];
  fc.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // 3) Libro diario (partida doble)
  const ld = wb.addWorksheet("Libro diario"); ld.columns = [{ width: 7 }, { width: 12 }, { width: 14 }, { width: 32 }, { width: 15 }, { width: 15 }, { width: 38 }, { width: 26 }];
  titulo(ld, "LIBRO DIARIO · PARTIDA DOBLE", `${sub} · cada asiento: Debe = Haber`, 8);
  const hd = encabezado(ld, ["N°", "Fecha", "Cuenta", "Nombre de la cuenta", "Debe", "Haber", "Descripción", "Referencia"]);
  ef.diario.forEach((a, i) => a.lineas.forEach((l, k) => {
    const rr = fila(ld, [k ? "" : a.numero, k ? "" : dmy(a.fecha), l.cuenta, l.nombre, l.debe || null, l.haber || null, k ? "" : a.descripcion, k ? "" : a.referencia], { money: [5, 6], fondo: i % 2 ? X.zebra : "" });
    if (l.haber) rr.getCell(4).alignment = { indent: 2 };
  }));
  const ldFirst = hd + 1, ldLast = ld.rowCount, td = ld.addRow(["", "", "", "TOTAL"]);
  [["E", 5, ef.balanza.debe], ["F", 6, ef.balanza.haber]].forEach(([L, k, v]) => { td.getCell(k).value = ef.diario.length ? { formula: `SUM(${L}${ldFirst}:${L}${ldLast})`, result: v } : v; td.getCell(k).numFmt = MONEY_TOTAL; });
  td.getCell(7).value = ef.balanza.cuadra ? "✔ Debe = Haber" : "✖ NO cuadra";
  td.eachCell({ includeEmpty: true }, (c) => { pinta(c, ef.balanza.cuadra ? X.verde : X.rojo); c.font = { bold: true, color: { argb: X.blanco } }; c.border = BORDE; });
  ld.views = [{ state: "frozen", ySplit: hd }];
  ld.autoFilter = { from: { row: hd, column: 1 }, to: { row: hd, column: 8 } };
  ld.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // 4) Balanza de comprobación
  const bz = wb.addWorksheet("Balanza"); bz.columns = [{ width: 14 }, { width: 34 }, { width: 13 }, { width: 16 }, { width: 16 }, { width: 16 }];
  titulo(bz, "BALANZA DE COMPROBACIÓN", sub, 6);
  const hb = encabezado(bz, ["Cuenta", "Nombre", "Tipo", "Debe", "Haber", "Saldo"]);
  ef.balanza.cuentas.forEach((c, i) => fila(bz, [c.cuenta, c.nombre, c.tipo, c.debe, c.haber, c.saldo], { money: [4, 5, 6], fondo: i % 2 ? X.zebra : "" }));
  const tb = bz.addRow(["TOTAL", ef.balanza.cuadra ? "✔ Cuadra" : "✖ NO cuadra"]);
  [["D", 4, ef.balanza.debe], ["E", 5, ef.balanza.haber]].forEach(([L, k, v]) => { tb.getCell(k).value = ef.balanza.cuentas.length ? { formula: `SUM(${L}${hb + 1}:${L}${bz.rowCount - 1})`, result: v } : v; tb.getCell(k).numFmt = MONEY_TOTAL; });
  tb.eachCell({ includeEmpty: true }, (c) => { pinta(c, ef.balanza.cuadra ? X.verde : X.rojo); c.font = { bold: true, color: { argb: X.blanco } }; c.border = BORDE; });
  bz.views = [{ state: "frozen", ySplit: hb }];
  bz.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function enviarExcelEstados(chatId, mes) {
  try {
    const ef = await cargarEstados(mes);
    const buf = await excelEstados(ef);
    return bot.sendDocument(chatId, buf, { caption: `📊 Estados financieros · ${ef.nombre}` }, { filename: `Estados_financieros_${ef.mes}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  } catch (e) { logErr("R134 excelEstados", e); return bot.sendMessage(chatId, `⚠️ No pude generar el Excel: ${String(e?.message || e).slice(0, 180)}`); }
}

module.exports = { panelEstados, enviarExcelEstados, excelEstados, textoEstados, cargarEstados };
