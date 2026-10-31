"use strict";
// R158 · Excel de finanzas por plataforma. Datos FICTICIOS en memoria; no toca la base real ni crea ventas.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { FakeDb } = require("./helpers/fake-firestore");
const B = path.join(__dirname, "..");
const P = require("../lib_finanzas_plataformas");
const R = require("../lib_finanzas_reglas");
const C = require("../lib_finanzas_costeo");
const { normPlataformaKey } = require("../lib_catalogo_categorias");

// Movimientos como los guarda el sistema (venta + cobro por operación; socios; ingreso manual; anulados; reversas).
function movimientos() {
  const v = (id, f, extra) => ({ id: `${id}_venta`, tipo: "venta", fechaPago: f, monto: 0, saldoPendiente: 0, ...extra });
  const c = (id, f, monto, extra = {}) => ({ id: `${id}_cobro`, tipo: "ingreso", fechaPago: f, monto, operacionId: id, ...extra });
  return [
    // Octubre 2026
    v("op1", "2026-10-02", { subtipo: "compra_nueva", monto: 150, plataforma: "Netflix", clienteId: "c1", clienteNombre: "Ana López", origenCanal: "web", vendedor: "sublicuentas", correo: "ana@correo.test", clave: "SECRETA123", pin: "4321" }), c("op1", "2026-10-02", 150),
    v("op2", "2026-10-03", { subtipo: "renovacion", monto: 140, plataforma: "Netflix", clienteId: "c2", clienteNombre: "Beto Ruiz", fechaAnterior: "03/10/2026", fechaNueva: "02/11/2026", origenCanal: "apk" }), c("op2", "2026-10-03", 140),
    v("op3", "2026-10-04", { subtipo: "renovacion", monto: 110, plataforma: "Disney Premium", clienteId: "c1", clienteNombre: "Ana López", fechaAnterior: "04/10/2026", fechaNueva: "03/01/2027" }), c("op3", "2026-10-04", 110),
    v("op4", "2026-10-05", { subtipo: "compra_nueva", monto: 110, plataforma: "Disney+ Premium", clienteId: "c3", clienteNombre: "Carla Mejía", origenCanal: "tg" }), c("op4", "2026-10-05", 110),
    // Pago pendiente: venta de L90, recibió L50 → cuenta L90 de ingreso y L40 pendiente
    v("op5", "2026-10-06", { subtipo: "compra_nueva", monto: 90, plataforma: "HBO Max", clienteId: "c2", clienteNombre: "Beto Ruiz", saldoPendiente: 40 }), c("op5", "2026-10-06", 50),
    // Compra de socio con 2 productos (precio guardado)
    { id: "socio_compra_X1_venta", tipo: "venta", subtipo: "compra_socio", fechaPago: "2026-10-07", monto: 180, socioNombre: "Jimena", origenCanal: "socios", productosSocio: [{ servicio: "YouTube Premium · 1 mes", precio: 60, cantidad: 1, clienteNombre: "Dani Paz" }, { servicio: "YouTube Premium · 3 meses", precio: 120, cantidad: 1, clienteNombre: "Dani Paz" }] },
    { id: "socio_compra_X1_cobro", tipo: "ingreso", subtipo: "compra_socio", fechaPago: "2026-10-07", monto: 180 },
    // Servicio NUEVO que no está en ninguna tabla
    v("op6", "2026-10-08", { subtipo: "compra_nueva", monto: 75, plataforma: "Zeta Stream", clienteId: "c4", clienteNombre: "Eva Soto" }), c("op6", "2026-10-08", 75),
    // Ingreso manual (sin ficha) de renovación
    { id: "manual1", tipo: "ingreso", fechaPago: "2026-10-09", monto: 60, plataforma: "Spotify", clienteNombre: "Fer Luna", categoria: "Renovación Spotify" },
    // ANULADA: no cuenta
    v("op7", "2026-10-10", { subtipo: "compra_nueva", monto: 999, plataforma: "Netflix", clienteId: "c9", estadoFinanciero: "anulado" }), c("op7", "2026-10-10", 999, { estadoFinanciero: "anulado" }),
    { id: "rev_op7", tipo: "ingreso", fechaPago: "2026-10-10", monto: -999, reversaDe: "op7_cobro" },
    // Abono de cuenta por cobrar: NO es venta nueva
    { id: "abono1", tipo: "ingreso", subtipo: "cobro_pendiente", fechaPago: "2026-10-11", monto: 40, cuentaId: "op5" },
    // Egreso: no es venta
    { id: "egr1", tipo: "egreso", fechaPago: "2026-10-11", monto: 300, motivo: "Compra de cuentas" },
    // Septiembre (período anterior): Netflix L100, Disney L220
    v("op8", "2026-09-10", { subtipo: "compra_nueva", monto: 100, plataforma: "Netflix", clienteId: "c5" }), c("op8", "2026-09-10", 100),
    v("op9", "2026-09-12", { subtipo: "renovacion", monto: 220, plataforma: "Disney Premium", clienteId: "c6" }), c("op9", "2026-09-12", 220),
  ];
}
const opts = { R, C, normKey: normPlataformaKey, desde: "2026-10-01", hasta: "2026-10-31", ahora: new Date("2026-10-31T18:00:00Z") };

test("resumen: ranking por ingreso real, ventas vs clientes, nuevas vs renovaciones, IDs estables, servicio nuevo y anuladas fuera", () => {
  const d = P.datosPlataformas(movimientos(), opts);
  const by = Object.fromEntries(d.resumen.rows.map((r) => [r.servicio, r]));
  assert.deepEqual(d.resumen.rows.map((r) => r.servicio), ["Netflix", "Disney Premium", "YouTube Premium", "HBO Max", "Zeta Stream", "Spotify"]);
  assert.deepEqual(d.resumen.rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6]);
  assert.equal(by.Netflix.neto, 290, "monto cobrado en cada venta (150 + 140), no precio de catálogo; la anulada de L999 no cuenta");
  assert.equal(by.Netflix.ventas, 2); assert.equal(by.Netflix.nuevas, 1); assert.equal(by.Netflix.renovaciones, 1);
  assert.equal(by["Disney Premium"].ventas, 2, '"Disney Premium" y "Disney+ Premium" son el mismo ID: una sola fila');
  assert.equal(by["Disney Premium"].clientes, 2);
  assert.equal(by["YouTube Premium"].ventas, 2); assert.equal(by["YouTube Premium"].clientes, 1, "2 ventas del mismo cliente = 1 cliente único");
  assert.equal(by["HBO Max"].neto, 90); assert.equal(by["HBO Max"].pendiente, 40);
  assert.ok(by["Zeta Stream"], "servicio nuevo aparece sin tocar el código");
  assert.equal(by.Spotify.renovaciones, 1, "ingreso manual de renovación");
  assert.equal(d.resumen.total.neto, 290 + 220 + 180 + 90 + 75 + 60);
  assert.equal(d.resumen.total.ventas, 9);
  assert.equal(by.Netflix.ticket, 145);
  assert.ok(Math.abs(d.resumen.rows.reduce((a, r) => a + r.participacion, 0) - 1) < 1e-9);
  // Tendencia: octubre vs septiembre (mes calendario)
  assert.equal(d.anterior.desde, "2026-09-01"); assert.equal(d.anterior.hasta, "2026-09-30");
  assert.equal(by.Netflix.tendencia, 1.9); assert.equal(by["Disney Premium"].tendencia, 0);
  assert.equal(by["Zeta Stream"].tendencia, null, "sin base comparable → N/D, no 0 %");
});

test("planes, detalle y mensual; períodos de comparación; un cambio de precio no altera lo histórico", () => {
  const d = P.datosPlataformas(movimientos(), opts);
  const yt = d.planes.filter((p) => p.servicio === "YouTube Premium");
  assert.deepEqual(yt.map((p) => [p.plan, p.ventas, p.neto]).sort(), [["1 mes", 1, 60], ["3 meses", 1, 120]]);
  assert.ok(d.planes.some((p) => p.servicio === "Disney Premium" && p.plan === "3 meses"), "renovación 04/10 → 03/01 = 3 meses");
  assert.ok(d.planes.some((p) => p.servicio === "Netflix" && p.plan === "1 mes"));
  assert.equal(d.detalle.length, 9);
  assert.ok(!d.detalle.some((f) => f.ventaId.startsWith("op7")), "anulada fuera");
  assert.ok(!d.detalle.some((f) => /abono|egr|rev_/.test(f.ventaId)));
  const oct = d.mensual.meses.find((m) => m.mes === "2026-10"), sep = d.mensual.meses.find((m) => m.mes === "2026-09");
  assert.equal(oct.total, 915); assert.equal(sep.total, 320);
  assert.equal(d.mensual.meses.length, 6); assert.equal(d.mensual.meses[0].mes, "2026-05");
  assert.equal(d.mensual.meses.find((m) => m.mes === "2026-08").variacion, null);
  // Rango de 30 días → los 30 anteriores
  assert.deepEqual(P.periodoAnterior("2026-10-02", "2026-10-31"), { desde: "2026-09-02", hasta: "2026-10-01", tipo: "30 días inmediatamente anteriores" });
  // Mismo movimiento, precio de catálogo distinto: nada cambia (el reporte no lee el catálogo)
  const otra = P.datosPlataformas(movimientos(), { ...opts, catalogo: [{ n: "Netflix", p: 999 }] });
  assert.deepEqual(otra.resumen.rows.map((r) => r.neto), d.resumen.rows.map((r) => r.neto));
});

async function libro(movs, desde = "2026-10-01", hasta = "2026-10-31") {
  const wb = new ExcelJS.Workbook();
  P.agregarHojasPlataformas(wb, P.datosPlataformas(movs, { ...opts, desde, hasta }));
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook(); await back.xlsx.load(buf);
  return { back, buf };
}

test("Excel: hojas en orden, montos numéricos con formato L, filtros, encabezado congelado, TOTAL y sin credenciales", async () => {
  const { back } = await libro(movimientos());
  assert.deepEqual(back.worksheets.map((w) => w.name), ["RESUMEN_PLATAFORMAS", "DETALLE_PLANES", "DETALLE_VENTAS", "RESUMEN_MENSUAL", "METADATOS"]);
  const ws = back.getWorksheet("RESUMEN_PLATAFORMAS");
  assert.equal(ws.getCell("B5").value, "Netflix"); assert.equal(ws.getCell("A5").value, "#1");
  assert.equal(typeof ws.getCell("C5").value, "number"); assert.equal(ws.getCell("C5").value, 290);
  assert.match(ws.getCell("C5").numFmt, /"L"#,##0\.00/);
  assert.equal(ws.views[0].state, "frozen"); assert.ok(ws.autoFilter);
  const tot = ws.getRow(11);
  assert.equal(tot.getCell(2).value, "TOTAL"); assert.equal(tot.getCell(3).value.formula, "SUM(C5:C10)"); assert.equal(tot.getCell(3).value.result, 915);
  assert.equal(ws.getCell("J5").value, 1.9);
  const txt = JSON.stringify(back.worksheets.map((w) => w.getSheetValues()));
  assert.ok(!/SECRETA123|ana@correo\.test|4321/.test(txt), "no se exportan correos, claves ni PIN");
  const meta = back.getWorksheet("METADATOS");
  assert.match(JSON.stringify(meta.getSheetValues()), /plataformas-1\.0/);
  assert.match(JSON.stringify(meta.getSheetValues()), /HNL/);
  const ventas = back.getWorksheet("DETALLE_VENTAS");
  assert.ok(ventas.getCell("A5").value instanceof Date);
  assert.equal(typeof ventas.getCell("H5").value, "number");
  const mensual = back.getWorksheet("RESUMEN_MENSUAL");
  assert.equal(mensual.getRow(4).getCell(2).value, "Disney Premium", "columnas dinámicas ordenadas por ingreso de los 6 meses");
});

test("sin ventas en el período: archivo válido con N/D y sin errores", async () => {
  const { back } = await libro([], "2026-10-01", "2026-10-31");
  assert.equal(back.worksheets[0].name, "RESUMEN_PLATAFORMAS");
  assert.equal(back.getWorksheet("RESUMEN_PLATAFORMAS").getRow(5).getCell(2).value, "TOTAL");
});

test("generador central (index_10): RESUMEN_PLATAFORMAS es la 1.ª hoja, conserva las hojas de siempre y da los mismos totales en cada pedido (Bot TG / Web)", async () => {
  const db = new FakeDb();
  for (const m of movimientos()) { const { id, ...d } = m; await db.collection("finanzas_movimientos").doc(id).set(d); }
  const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (/index_10_reportes_excel|index_31_finanzas_libro/.test(k)) delete require.cache[k];
  stub("index_01_core", { ExcelJS, db, FINANZAS_COLLECTION: "finanzas_movimientos", bot: { sendMessage: async () => {} }, admin: { firestore: { Timestamp: { fromDate: (d) => d } } } });
  const { generarReporteExcelPorRango } = require("../index_10_reportes_excel");
  const leer = async () => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarReporteExcelPorRango("01/10/2026", "31/10/2026")); return wb; };
  const a = await leer(), b = await leer();
  const nombres = a.worksheets.map((w) => w.name);
  assert.equal(nombres[0], "RESUMEN_PLATAFORMAS");
  for (const h of ["DETALLE_PLANES", "DETALLE_VENTAS", "RESUMEN_MENSUAL", "METADATOS", "Resumen", "Ingresos", "Egresos"]) assert.ok(nombres.includes(h), `incluye ${h}`);
  const vals = (wb) => wb.getWorksheet("RESUMEN_PLATAFORMAS").getSheetValues().slice(4).map((r) => JSON.stringify(r));
  assert.deepEqual(vals(a), vals(b), "mismo período = mismos totales en cada solicitud");
  assert.equal(a.getWorksheet("RESUMEN_PLATAFORMAS").getCell("C5").value, 290);
});
