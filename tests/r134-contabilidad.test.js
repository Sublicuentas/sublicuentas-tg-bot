const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../lib_contabilidad");
const R = require("../lib_finanzas_reglas");
const { clasificarServicio } = require("../lib_catalogo_categorias");

const methods = [{ id: "bac", nombre: "BAC" }, { id: "atlantida", nombre: "Atlántida" }, { id: "tigo", nombre: "Tigo Money" }];
const libro = { cicloInicio: "2026-10-01", bases: { bac: { saldo: 1000, desde: "2026-10-01" } } };
const mov = (id, o) => ({ id, ...o });
const movimientos = [
  mov("s1", { tipo: "ingreso", subtipo: "cobro_renovacion", monto: 300, bancoId: "bac", plataforma: "Netflix", fecha: "28/09/2026" }), // mes anterior
  mov("i1", { tipo: "ingreso", subtipo: "cobro_compra", monto: 260, bancoId: "bac", plataforma: "⭐ Netflix Premium VIP", fecha: "02/10/2026" }),
  mov("i2", { tipo: "ingreso", subtipo: "cobro_renovacion", monto: 120, bancoId: "atlantida", plataforma: "Spotify", fecha: "03/10/2026" }),
  mov("i3", { tipo: "ingreso", monto: 50, banco: "Tigo Money", detalle: "Mariana", fecha: "03/10/2026" }), // manual, sin plataforma
  mov("e1", { tipo: "egreso", subtipo: "egreso_operativo", monto: 80, bancoId: "bac", motivo: "Pago luz", fecha: "04/10/2026" }),
  mov("p1", { tipo: "egreso", subtipo: "comision_vendedor", planillaPagoId: "pp1", monto: 100, bancoId: "bac", beneficiario: "Geisell", fecha: "05/10/2026" }),
  mov("t1", { tipo: "transferencia", direccion: "salida", monto: 200, bancoId: "bac", transferenciaId: "t", fecha: "06/10/2026" }),
  mov("t2", { tipo: "transferencia", direccion: "entrada", monto: 200, bancoId: "atlantida", transferenciaId: "t", fecha: "06/10/2026" }),
  mov("a1", { tipo: "ingreso", monto: 75, bancoId: "bac", plataforma: "Netflix", fecha: "02/10/2026", estadoFinanciero: "anulado" }),
  mov("a1_rev", { tipo: "ingreso", monto: -75, bancoId: "bac", plataforma: "Netflix", fecha: "07/10/2026", reversaDe: "a1" }),
  mov("v1", { tipo: "venta", monto: 999, bancoId: "bac", fecha: "02/10/2026" }),
  mov("x1", { tipo: "ingreso", monto: 40, banco: "Banco Raro", plataforma: "Netflix", fecha: "05/10/2026" }),
];

test("R134: partida doble — cada asiento cuadra y la balanza cuadra (Debe = Haber)", () => {
  const ef = C.estadosFinancieros({ movimientos, libro, methods, mes: "2026-10", hoy: "2026-10-08", clasificar: clasificarServicio });
  for (const a of ef.diario) assert.equal(R.money(a.lineas.reduce((s, l) => s + l.debe - l.haber, 0)), 0, a.id);
  assert.ok(ef.balanza.cuadra); assert.equal(ef.balanza.debe, ef.balanza.haber);
  assert.ok(!ef.diario.some((a) => ["a1", "a1_rev", "v1", "s1"].includes(a.id)), "anulado, reversa, venta y mes anterior no van");
  assert.equal(ef.balanza.cuentas.find((c) => c.cuenta === "1190").saldo, 0, "la transferencia se cancela");
  assert.ok(ef.diario.find((a) => a.id === "apertura_bac"), "saldo de apertura contra Capital");
});

test("R134: estado de resultados por categoría y origen, margen y utilidad neta", () => {
  const r = C.estadosFinancieros({ movimientos, libro, methods, mes: "2026-10", hoy: "2026-10-08", clasificar: clasificarServicio }).resultados;
  assert.equal(r.ingresos.total, 470); // 260 + 120 + 50 + 40 (anulado fuera)
  assert.deepEqual(r.ingresos.porCategoria.map((x) => [x.nombre, x.monto]), [["Perfiles de streaming", 300], ["Música", 120], ["Otros ingresos", 50]]);
  assert.equal(r.ingresos.porOrigen.find((x) => x.nombre === "Renovaciones").monto, 120);
  assert.equal(r.gastosOperativos.total, 80); assert.equal(r.gastosOperativos.porConcepto[0].nombre, "Pago luz");
  assert.equal(r.utilidadOperativa, 390); assert.equal(r.planilla.total, 100); assert.equal(r.planilla.porConcepto[0].nombre, "Comisiones de vendedores");
  assert.equal(r.utilidadNeta, 290); assert.equal(r.margenNeto, 61.7);
  // Igual que cierres/ciclo (R125): mismo resultado que cycleTotals del período.
  assert.equal(r.utilidadNeta, R.cycleTotals(movimientos, "2026-10-01", "2026-10-31").resultado);
});

test("R134: flujo de caja — saldo inicial + entradas − salidas = saldo final = saldo real del banco", () => {
  const f = C.estadosFinancieros({ movimientos, libro, methods, mes: "2026-10", hoy: "2026-10-08", clasificar: clasificarServicio }).flujo;
  assert.ok(f.cuadra);
  const real = R.bankBalances(movimientos, libro, methods);
  for (const b of f.bancos) assert.equal(b.saldoFinal, real.bancos.find((x) => x.id === b.id).saldo, b.id);
  const bac = f.bancos.find((b) => b.id === "bac");
  assert.equal(bac.saldoInicial, 0); assert.equal(bac.ajustes, 1000, "la apertura del 01/10 entra en el período");
  assert.equal(bac.transferencias, -200); assert.equal(f.transferencias, 0);
  assert.equal(f.flujoOperativo, 250); // 430 cobros en bancos − 80 − 100
  assert.deepEqual(f.sinBanco, { n: 1, neto: 40 });
  // Noviembre arranca con el saldo final de octubre.
  const nov = C.estadosFinancieros({ movimientos, libro, methods, mes: "2026-11", clasificar: clasificarServicio }).flujo;
  assert.equal(nov.saldoInicial, f.saldoFinal);
});

test("R134: HQ y bot usan el MISMO texto de contabilidad", () => {
  const hq = path.join(__dirname, "..", "..", "..", "hq", "sublichat-hq-main", "api", "_contabilidad.js");
  if (!fs.existsSync(hq)) return; // en Render solo está el bot
  const cuerpo = (t) => t.split("\n").slice(2, -2).join("\n");
  assert.equal(cuerpo(fs.readFileSync(hq, "utf8")), cuerpo(fs.readFileSync(path.join(__dirname, "..", "lib_contabilidad.js"), "utf8")));
});

test("R134: Telegram tiene 📊 Estados financieros (panel + Excel de 4 hojas) en Ciclo y en Reportes", () => {
  const l = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  const m5 = fs.readFileSync(path.join(__dirname, "..", "index_05_finanzas_menus.js"), "utf8");
  const e = fs.readFileSync(path.join(__dirname, "..", "index_32_estados_financieros.js"), "utf8");
  assert.match(l, /callback_data: "fl:ef"/); assert.match(m5, /callback_data: "fl:ef"/);
  assert.match(l, /startsWith\("fl:efx:"\)\) return require\("\.\/index_32_estados_financieros"\)\.enviarExcelEstados/);
  for (const h of ["Estado de resultados", "Flujo de caja", "Libro diario", "Balanza"]) assert.match(e, new RegExp(`addWorksheet\\("${h}"\\)`));
});

test("R135: recarga a Binance en Telegram = transferencia del banco + billetera USDT; no es ingreso ni gasto; balanza cuadra", () => {
  const ms = [
    mov("r1", { tipo: "transferencia", subtipo: "recarga_binance", direccion: "salida", monto: 2820, bancoId: "bac", fecha: "08/10/2026", montoUsdt: 100 }),
    mov("r1_usdt", { tipo: "billetera", subtipo: "recarga", direccion: "entrada", billeteraId: "binance", moneda: "USDT", montoUsdt: 100, monto: 2820, tasa: 28.2, fecha: "08/10/2026" }),
  ];
  assert.equal(R.movementKind(ms[1]), "billetera");
  const t = R.cycleTotals(ms, "2026-10-01", ""); assert.equal(t.ingresos, 0); assert.equal(t.egresosOperativos, 0);
  assert.equal(R.bankBalances(ms, libro, methods).bancos.find((b) => b.id === "bac").saldo, 1000 - 2820);
  const bz = C.balanzaComprobacion(C.libroDiario(ms, {}, methods, "2026-10-01", "2026-10-31"));
  assert.ok(bz.cuadra); assert.equal(bz.cuentas.find((c) => c.cuenta === "1150-binance").saldo, 2820); assert.equal(bz.cuentas.find((c) => c.cuenta === "1190").saldo, 0);
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  assert.match(x, /\["saldo_inicial", "venta", "transferencia", "billetera", "compra", "inventario", "costo_venta", "pago_cxp"\]\.includes\(m\.kind\)/);
});

test("R137: el bot costea las ventas solo (cada 10 min) con el mismo motor que la web", () => {
  const C2 = require("../lib_finanzas_costeo");
  assert.equal(typeof C2.correrCosteo, "function");
  const l = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  assert.match(l, /setInterval\(\(\) => correrCosteoBot\(\), 10 \* 60 \* 1000\)/);
  const sa = fs.readFileSync(path.join(__dirname, "..", "server_api.js"), "utf8");
  assert.match(sa, /require\("\.\/index_31_finanzas_libro"\)\.iniciarCosteoAutomatico\(\)/);
  assert.equal(R.movementKind({ tipo: "costo_venta", monto: 50 }), "costo_venta");
  assert.equal(R.cycleTotals([{ tipo: "costo_venta", monto: 50, fecha: "08/10/2026" }], "2026-10-01", "").resultado, 0, "no toca cierres");
});

test("R138: compra a crédito y pago al proveedor — no son gasto; el pago baja el banco (flujo: compras); partida doble con Cuentas por pagar", () => {
  const ms = [
    mov("c1", { tipo: "compra", subtipo: "compra_credito", monto: 7500, banco: "Cuentas por pagar", fecha: "08/10/2026" }),
    mov("p1", { tipo: "pago_cxp", subtipo: "pago_proveedor", monto: 3000, montoCxpHnl: 3000, bancoId: "bac", fecha: "09/10/2026" }),
  ];
  assert.equal(R.movementKind(ms[1]), "pago_cxp");
  assert.equal(R.cycleTotals(ms, "2026-10-01", "").resultado, 0);
  const bac = R.bankBalances(ms, libro, methods).bancos.find((b) => b.id === "bac"); assert.equal(bac.saldo, 1000 - 3000); assert.equal(bac.compras, 3000);
  const bz = C.balanzaComprobacion(C.libroDiario(ms, {}, methods, "2026-10-01", "2026-10-31"));
  assert.ok(bz.cuadra); assert.equal(bz.cuentas.find((c) => c.cuenta === "2100").saldo, 4500); assert.equal(bz.cuentas.find((c) => c.cuenta === "1300").saldo, 7500);
});
