"use strict";
// R186 · Motor único de fechas en el bot: MISMOS vectores que Sublichat HQ (tests/renovacion-vectores.json).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const M = require("../lib_renovacion_motor");

const V = JSON.parse(fs.readFileSync(path.join(__dirname, "renovacion-vectores.json"), "utf8"));

test("vectores compartidos con Sublichat (R01 3 meses calendario, R02 30 días, R03 31 días, fin de mes y ancla)", () => {
  for (const c of V.casos) {
    const r = M.sumarPeriodo(c.fecha, c.periodo);
    assert.equal(r.fechaNueva, c.esperado, c.id);
    if (c.diaAncla) assert.equal(r.diaAncla, c.diaAncla, c.id);
  }
});

test("el bot usa el motor en renovar uno / todos y guarda el día ancla; reintento con pago existente no mueve fechas", () => {
  const crm = fs.readFileSync(path.join(__dirname, "..", "index_03_clientes_crm.js"), "utf8");
  assert.match(crm, /^const MOTOR_RENOVACION = require\("\.\/lib_renovacion_motor"\)/);
  assert.match(crm, /calcRenovacionLocal\(fechaAnterior, \{ dias, meses, diaAncla: anterior\.diaAncla \}\)/);
  assert.match(crm, /calcRenovacionLocal\(fechaAnterior, \{ dias, meses, diaAncla: s\?\.diaAncla \}\)/);
  assert.match(crm, /lecturaExtra\.yaExiste === true\) return \{ duplicadoPago: true/);
  assert.doesNotMatch(crm, /m \* 30 \/\* 1 mes = 30 días \*\//, "ya no multiplica meses × 30");
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.doesNotMatch(h, /\? n \* 30 : n/, "+3m ya no es 90 días");
});

test("copia fiel: el motor del bot y el de Sublichat tienen las mismas reglas (mismas funciones)", () => {
  assert.deepEqual(Object.keys(M).sort(), ["aCentavos", "aDMY", "aYMD", "deCentavos", "diasEntre", "leerFecha", "sigueVencida", "sumarPeriodo", "sumarPeriodos"]);
  assert.equal(M.sumarPeriodos("31/12/2026", { unidad: "meses", cantidad: 2 }, 2).fechaNueva, "30/04/2027");
});
