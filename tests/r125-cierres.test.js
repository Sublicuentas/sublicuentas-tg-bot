const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../lib_finanzas_reglas");
const f5 = fs.readFileSync(path.join(__dirname, "..", "index_05_finanzas_menus.js"), "utf8");
function extraer(src, nombre) { const i = src.indexOf(`function ${nombre}(`); assert.ok(i >= 0, nombre); let d = 0; const j = src.indexOf("{", src.indexOf(")", i)); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(src.lastIndexOf("\n", i) + 1, k + 1); } } }

// Día 01/10: 6269 de ingresos reales; un voucher de 270 anulado el 07/10 (su reversa cae ese día), una venta y una transferencia.
const dia = [
  { tipo: "ingreso", monto: 6269, fecha: "01/10/2026", bancoId: "bac" },
  { tipo: "ingreso", monto: 270, fecha: "01/10/2026", bancoId: "bac", estadoFinanciero: "anulado" },
  { tipo: "venta", monto: 500, fecha: "01/10/2026" },
  { tipo: "transferencia", monto: 100, fecha: "01/10/2026", direccion: "entrada", bancoId: "bac" },
  { tipo: "ajuste_saldo", subtipo: "ajuste_saldo", monto: 30, fecha: "01/10/2026", bancoId: "bac" },
  { tipo: "egreso", monto: 224, fecha: "01/10/2026", bancoId: "bac" },
];
const reversa = { tipo: "ingreso", monto: -270, fecha: "07/10/2026", bancoId: "bac", reversaDe: "x" };

test("R125: cierre de caja del bot = solo dinero real (antes daba 6539 en vez de 6269)", () => {
  const caja = new Function("RLR125", `${extraer(f5, "cuentaEnCajaR125")}; ${extraer(f5, "soloCajaR125")}; return soloCajaR125;`)(R);
  const sumas = (rows) => rows.reduce((a, m) => { if (String(m.tipo) === "egreso") a.sal += m.monto; else a.ent += m.monto; return a; }, { ent: 0, sal: 0 });
  assert.deepEqual(sumas(dia), { ent: 6539 + 500 + 100 + 30, sal: 224 }, "así sumaba antes");
  assert.deepEqual(sumas(caja(dia)), { ent: 6269, sal: 224 });
  assert.equal(caja(dia).length, 2, "Movimientos: solo los que son dinero");
  assert.equal(caja([...dia, reversa], { todos: true }).length, 7, "la lista de borrar sí ve todo");
});

test("R125: totales de ciclo y saldos de bancos ignoran anulado + reversa (igual que el servidor)", () => {
  const methods = R.publicMethods([{ id: "bac", nombre: "BAC", logoKey: "bac" }]);
  assert.equal(R.cycleTotals(dia, "2026-10-01", "2026-10-01").ingresos, 6269);
  assert.equal(R.cycleTotals([...dia, reversa], "2026-10-01", "2026-10-07").ingresos, 6269);
  const { bancos } = R.bankBalances([...dia, reversa], { bases: {} }, methods);
  const sinAnular = R.bankBalances(dia.filter((m) => !m.estadoFinanciero), { bases: {} }, methods).bancos;
  assert.equal(bancos[0].saldo, sinAnular[0].saldo, "el saldo del banco no cambia: el anulado y su reversa se cancelaban");
  assert.equal(bancos[0].ingresos, 6269);
});

test("R125: cierres, resúmenes y API usan la lectura filtrada; la lista de borrar pide todo", () => {
  assert.match(f5, /async function getMovimientosPorFecha\(fechaDMY, _userId = null, _isSuper = false, opts = \{\}\) \{ return soloCajaR125\(/);
  assert.match(f5, /async function getMovimientosPorMes\(monthKey, _userId = null, _isSuper = false, opts = \{\}\) \{ return soloCajaR125\(/);
  assert.match(f5, /async function getMovimientosPorRango\(fechaInicio, fechaFin, _userId = null, _isSuper = false, opts = \{\}\) \{ return soloCajaR125\(/);
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.match(h, /getMovimientosPorFecha\(fecha, userId, isSuper, \{ todos: true \}\)/);
});

test("R126: Excel limpio — usuario sin canal, plataformas sin ⭐/medallas, sin columnas técnicas y barras que caben en su celda", () => {
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  const sinAd = new Function(`${extraer(x, "sinAdornosR126")}; return sinAdornosR126;`)();
  assert.equal(sinAd("⭐ Netflix Premium VIP"), "Netflix Premium VIP");
  assert.equal(sinAd("Disney Premium + ⭐ Netflix Premium VIP"), "Disney Premium + Netflix Premium VIP");
  const usuario = new Function("safeText", "USUARIOS_LABEL", `${extraer(x, "usuarioMovimiento")}; return usuarioMovimiento;`)((v) => String(v || "").trim(), { sublicuentas: "Sublicuentas" });
  assert.equal(usuario({ usuario: "sublicuentas", origenCanal: "apk" }), "Sublicuentas");
  assert.equal(usuario({ usuario: "Libni Daniela", origenCanal: "tg" }), "Relojes");
  assert.equal(usuario({ socioNombre: "Jimena", origenCanal: "socios" }), "Jimena");
  assert.doesNotMatch(x, /🥇|"operationId", "Pedido \/ compra"|"pagoPlanillaId"|"cicloId", "Inicio"|"compraId", "Monto total"/);
  const bloques = new Function(`${extraer(x, "bloquesQueCaben")}; return bloquesQueCaben;`)();
  assert.equal(bloques({ getColumn: () => ({ width: 28 }) }, 7), 11, "columna de 28 → máx. 11 bloques (antes 24 y se salía)");
  assert.match(x, /formulaBar\(`\$C\$\{rowNumber\}`, `\$C\$\$\{firstDataRow\}:\$C\$\$\{lastDataRow\}`, 1, bloquesQueCaben\(ws, 7\)\)/);
  assert.match(x, /shrinkToFit: true/);
});
