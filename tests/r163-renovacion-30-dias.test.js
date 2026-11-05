// R163 · Renovación en el bot: 1 mes = 30 días, +31 días = 31, siempre desde la fecha de vencimiento.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "index_03_clientes_crm.js"), "utf8");
const pick = (n) => { const i = src.indexOf(`function ${n}(`); return src.slice(i, src.indexOf("\n}\n", i) + 3); };
const f = new Function("isFechaDMY", "parseDMYtoDate", "hoyDMY",
  `${pick("addDaysDMY")}\n${pick("sumarDuracionRenovacionLocal")}\nreturn sumarDuracionRenovacionLocal;`)(
  (s) => /^\d{2}\/\d{2}\/\d{4}$/.test(String(s || "")),
  (s) => { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? new Date(+m[3], +m[2] - 1, +m[1], 12) : null; },
  () => "04/11/2026");

test("1 mes = 30 días (no mes calendario)", () => {
  assert.equal(f("04/11/2026", { meses: 1 }), "04/12/2026");
  assert.equal(f("01/10/2026", { meses: 1 }), "31/10/2026");
  assert.equal(f("01/01/2027", { meses: 2 }), "02/03/2027");
  assert.equal(f("01/01/2027", { meses: 12 }), "27/12/2027");
});
test("+31 días = 31 días", () => { assert.equal(f("04/11/2026", { dias: 31 }), "05/12/2026"); });
test("vencía el 1 y renueva el 4: se cuenta desde el 1", () => {
  assert.equal(f("01/11/2026", { meses: 1 }), "01/12/2026");
  assert.equal(f("01/11/2026", { dias: 31 }), "02/12/2026");
});
test("sin fecha válida: desde hoy", () => { assert.equal(f("", { meses: 1 }), "04/12/2026"); });
test("los botones del bot siguen siendo +31 días y +1/2/3/6/12 meses", () => {
  assert.match(src, /\["d31", "\+31 días"\], \["m1", "\+1 mes"\]/);
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.ok(!/Date\.UTC\(yyyy, mm - 1 \+ meses/.test(h), "el +Nm manual ya no usa meses calendario desde hoy");
});
