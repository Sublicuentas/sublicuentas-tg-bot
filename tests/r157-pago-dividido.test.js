// Oct-2026 · Pago dividido en 2+ bancos (renovación/compra) en el bot: mismas reglas que web y APK.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../lib_finanzas_reglas");
const M = [{ id: "bac", nombre: "BAC" }, { id: "tigo", nombre: "Tigo Money" }];

test("repartoPagos (copia del bot) = misma regla", () => {
  assert.deepEqual(R.repartoPagos(null, 220, M, "bac").pagos, [{ bancoId: "bac", banco: "BAC", monto: 220 }]);
  assert.equal(R.repartoPagos([{ bancoId: "bac", monto: 120 }, { bancoId: "tigo", monto: 100 }], 220, M).pagos.length, 2);
  assert.match(R.repartoPagos([{ bancoId: "bac", monto: 120 }, { bancoId: "tigo", monto: 50 }], 220, M).error, /deben coincidir/);
  assert.equal(R.repartoPagos([], 0, M, "").ok, true, "sin dinero recibido no pide banco");
});

test("Telegram: botón “Pagó en 2 bancos”, un ingreso por banco (_cobro, _cobro_2) y venta con detalle", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  assert.match(src, /callback_data: "fl:pg:split"/);
  assert.match(src, /R\.repartoPagos\(pagos, ep\.recibido, methods, bancoId\)/);
  assert.match(src, /doc\(`\$\{id\}_cobro_\$\{i \+ 1\}`\)/);
  assert.match(src, /pagosDetalle: pagos, pagoDividido: true/);
  assert.match(src, /if \(p\.mode === "flPgSplitMonto"\)/);
  assert.match(src, /✅ \$\{m\.nombre\}: el resto/);
});
