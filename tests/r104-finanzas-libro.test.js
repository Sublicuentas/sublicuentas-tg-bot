const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../lib_finanzas_reglas");

const methods = R.publicMethods([{ id: "bac", nombre: "BAC", logoKey: "bac" }, { id: "ficohsa", nombre: "Ficohsa", logoKey: "ficohsa" }, { id: "atl", nombre: "Atlántida", logoKey: "atlantida" }, { id: "tigo", nombre: "Tigo Money", logoKey: "tigo" }]);
const libro = { bases: { bac: { saldo: 4000, desde: "2026-10-01" }, ficohsa: { saldo: 1000, desde: "2026-10-01" }, atl: { saldo: 600, desde: "2026-10-01" }, tigo: { saldo: 400, desde: "2026-10-01" } } };

test("reglas del bot = reglas del servidor/APK (casos del PDF)", () => {
  const { bancos, total } = R.bankBalances([], libro, methods);
  assert.equal(total, 6000);
  const v = R.validatePlanilla({ montoTotal: 2000, asignaciones: [{ bancoId: "bac", monto: 1000 }, { bancoId: "ficohsa", monto: 1000 }], bancos });
  assert.equal(v.ok, true);
  assert.match(R.validatePlanilla({ montoTotal: 2000, asignaciones: [{ bancoId: "bac", monto: 1700 }], bancos }).errors.join(" "), /Faltan Lps\. 300/);
  assert.match(R.validatePlanilla({ montoTotal: 700, asignaciones: [{ bancoId: "atl", monto: 700 }], bancos }).errors.join(" "), /Saldo insuficiente/);
  assert.equal(R.resolveBankId("bac", methods), "bac");
  const t = R.cycleTotals([{ tipo: "ingreso", monto: 20000, fecha: "02/10/2026" }, { tipo: "egreso", monto: 12000, fecha: "03/10/2026" }, { tipo: "egreso", subtipo: "pago_planilla", monto: 5500, fecha: "09/10/2026" }], "2026-10-01", "2026-10-10");
  assert.equal(t.disponibleAntesPlanilla, 8000); assert.equal(t.resultado, 2500);
});

test("Telegram: renovar pide pago real a Sublicuentas/Relojes en todas las rutas; planilla y Excel conectados", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.equal((h.match(/finLibro\.iniciarPagoRenovacion\(/g) || []).length, 6, "+30, +31, todos +30, todos +31, fecha manual uno y todos");
  assert.match(h, /finLibro\.iniciarPagoCompra\(/, "R106: compra nueva pide el pago");
  assert.match(h, /if \(data\.startsWith\("fl:"\)\) return finLibro\.handleCallback/);
  assert.match(h, /return finLibro\.handleText\(chatId, userId, t, p\)/);
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  for (const hoja of ["Planilla", "Distribución Planilla", "Cierres", "Saldos Libro"]) assert.ok(x.includes(`"${hoja}"`), hoja);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "index_05_finanzas_menus.js"), "utf8"), /callback_data: "fl:menu"/);
});

test("registro manual de ingreso/egreso usa los bancos registrados y guarda bancoId", () => {
  const f = fs.readFileSync(path.join(__dirname, "..", "index_05_finanzas_menus.js"), "utf8");
  assert.match(f, /async function kbBancosLibro\(prefix\)/);
  assert.match(f, /\.\.\.\(bancoId \? \{ bancoId: String\(bancoId\) \} : \{\}\)/);
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.equal((h.match(/finLibro\.bancoDesdeBoton\(/g) || []).length, 2);
  assert.equal((h.match(/bancoId: p\.bancoId \|\| ""/g) || []).length, 5);
  const l = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  assert.match(l, /const DESDE_SIN_BANCO = "2026-10-01"/);
});

test("R106: estado de pago y cartera (pagado / parcial / pendiente)", () => {
  assert.deepEqual(R.estadoPago(220, 220), { total: 220, recibido: 220, saldo: 0, estado: "pagado" });
  assert.equal(R.estadoPago(300, 100).estado, "parcial");
  assert.equal(R.estadoPago(220, 0).estado, "pendiente");
  const l = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  for (const k of ["registrarOperacionPago", "registrarAbonoTg", "panelPendientes", "iniciarPagoCompra"]) assert.ok(l.includes(`function ${k}(`), k);
  const c = fs.readFileSync(path.join(__dirname, "..", "index_03_clientes_crm.js"), "utf8");
  assert.match(c, /finLibro\.iniciarPagoCompra\(chatId, chatId/);
});

test("R106 Excel: hoja Pendientes Cobro, ventas generadas y reversas restan", () => {
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  assert.ok(x.includes('"Pendientes Cobro"'));
  assert.match(x, /"Ventas generadas"/);
  assert.match(x, /!\["saldo_inicial", "venta", "transferencia", "billetera", "compra", "inventario", "costo_venta", "pago_cxp"\]\.includes\(m\.kind\)/);
  assert.match(x, /const monto = data\.reversaDe \? -montoBase : montoBase;/);
});

test("R106: añadir perfil a una compra existente pide pago (es compra nueva)", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.equal((h.match(/await addPerfilConPagoR106\(chatId, userId,/g) || []).length, 4);
  assert.match(h, /perfil adicional/);
});

test("R107: renovación + pago en UNA transacción en el bot", () => {
  const c = fs.readFileSync(path.join(__dirname, "..", "index_03_clientes_crm.js"), "utf8");
  assert.match(c, /async function mutarServiciosClienteTx\(clientId, mutador, extra = null\)/);
  assert.equal((c.match(/\}, pagoExtra\);/g) || []).length, 2);
  const l = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  assert.match(l, /cfg\.ejecutarRenovacion\(chatId, userId, p\.accion, \{ ajuste: false, pagoExtra \}\)/);
});

test("R110: fecha del pago elegible en el bot y ajuste de fecha agrupa un solo pago por cliente", () => {
  const l = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  assert.match(l, /callback_data: `fl:pg:fecha:\$\{f\}`/);
  assert.match(l, /const hoy = prep\.fechaPago \|\| hoyYmd\(\)/);
  assert.match(l, /\$\{m\.n > 1 \? ` \(\$\{m\.n\} servicios\)` : ""\}/);
  assert.match(l, /la venta va con su cobro/);
});

test("R111: eliminar por fecha no se cae con ids largos (límite 64 bytes) y protege el libro", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.match(h, /callback_data: `fin:del:pick:\$\{idCortoFinanzas\((m|x|it\.ms\[0\])\.id\)\}`/); // R129: también en grupos
  assert.match(h, /function movimientoLigadoFinanzas\(/);
  const largo = "oper_op_" + "a".repeat(28) + "_" + "b".repeat(36) + "_cobro";
  assert.ok(Buffer.byteLength(`fin:del:pick:${largo}`) > 64, "el id nuevo sí pasaba del límite");
});

test("R118 bot: 5 categorías antes de plataformas; cuenta completa = correo → clave → precio → meses → pago", () => {
  const c = fs.readFileSync(path.join(__dirname, "..", "index_03_clientes_crm.js"), "utf8");
  assert.match(c, /function kbCategoriasWiz\(mode, clientId = null, idx = null\)/);
  assert.match(c, /if \(mode && !categoriaCode\) return kbCategoriasWiz\(mode, clientId, idx\);/);
  assert.match(c, /compra\.sinPinPerfil = true; delete compra\.pinPerfil;/);
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.match(h, /data\.startsWith\("platcat:"\)/); assert.match(h, /finLibro\.iniciarCuentaCompleta\(/);
  const cat = require("../lib_catalogo_categorias");
  assert.equal(cat.clasificarServicio({ plataforma: "viki" }).tipoVenta, "cuenta_completa");
  const largo = "platcat:add:cc:" + "x".repeat(20) + ":12"; assert.ok(Buffer.byteLength(largo) <= 64, "botón de categoría cabe en 64 bytes");
});
