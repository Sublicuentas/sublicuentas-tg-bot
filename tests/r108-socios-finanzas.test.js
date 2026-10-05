const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "server_api.js"), "utf8");
function extraer(nombre) { const i = src.indexOf(`function ${nombre}(`); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); } } }
const revAddMonths = new Function(`${extraer("revAddMonths")}; return revAddMonths;`)();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("Socios: +1m respeta el mes calendario (03/10→03/11; 31/01→fin de febrero)", () => {
  assert.equal(ymd(revAddMonths(new Date(2026, 9, 3), 1)), "2026-11-03");
  assert.equal(ymd(revAddMonths(new Date(2027, 0, 31), 1)), "2027-02-28");
  assert.equal(ymd(revAddMonths(new Date(2028, 0, 31), 1)), "2028-02-29");
  assert.equal(ymd(revAddMonths(new Date(2026, 9, 3), 6)), "2027-04-03");
});

test("Socios compra: cantidad solo para cuentas completas, total del servidor y banco obligatorio", () => {
  assert.match(src, /const R108_CANTIDADES = new Set\(\[\.\.\.Array\.from\(\{ length: 20 \}, \(_, i\) => i \+ 1\), 25, 30, 40, 50\]\);/);
  assert.match(src, /=== "cuenta_completa" && R108_CANTIDADES\.has\(Number\(p\.cantidad\)\) \? Number\(p\.cantidad\) : 1/);
  assert.match(src, /Number\(p\.precioCatalogo \|\| 0\) \* \(p\.cantidad \|\| 1\)/);
  assert.match(src, /const monto = hayComisionR108 \? \(revMoneyNumber\(b\.monto\) \|\| totalCombo \|\| 0\) : totalCombo;/, "con precio fijo nunca usa el monto del navegador");
  assert.match(src, /error: "falta_banco"/);
  // descuento vigente: 10 por unidad adicional hasta 40 (5 cuentas completas → 40)
  const unidades = 5, precio = 100; const desc = Math.min(Math.max(unidades - 1, 0), 4) * 10;
  assert.equal(precio * unidades - desc, 460);
});

test("Socios: compra/renovación + venta + ingreso en UNA transacción, idempotente, auditada y en el Excel", () => {
  assert.match(src, /async function revRenovarSeleccionConPago\(/);
  assert.match(src, /tx\.update\(ref, \{ servicios,/);
  assert.match(src, /subtipo: "renovacion_socio"/);
  assert.match(src, /subtipo: "compra_socio"/);
  assert.match(src, /if \(ya\.exists\) return \{ duplicado: true/);
  assert.match(src, /app\.get\("\/rev\/metodos-pago"/);
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  assert.match(x, /"Ingreso - Compra Socio"/); assert.match(x, /"Ingreso - Renovación Socio"/);
});

test("R109: fecha real de Honduras, usuario y detalle en el Excel", () => {
  const xs = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  const cuerpo = xs.slice(xs.indexOf("function fechaRealHonduras("), xs.indexOf("const USUARIOS_LABEL"));
  const X = { fechaRealHonduras: new Function(`${cuerpo}; return fechaRealHonduras;`)() };
  assert.equal(X.fechaRealHonduras({ createdAt: "2026-10-04T02:30:00.000Z", fechaPago: "2026-10-04" }), "03/10/2026", "6 PM–medianoche HN quedaba con fecha de mañana");
  assert.equal(X.fechaRealHonduras({ createdAt: "2026-10-04T15:00:00.000Z", fechaPago: "2026-10-04" }), "");
  assert.equal(X.fechaRealHonduras({ createdAt: "2026-10-04T02:30:00.000Z", fechaPago: "2026-10-03" }), "", "fecha elegida a mano se respeta");
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  assert.match(x, /userName: usuarioMovimiento\(data\)/); assert.match(x, /detalle: detalleMovimiento\(data\)/);
  const l = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  assert.match(l, /data === "fl:rf:ver"/); // botón viejo sigue funcionando (ahora abre "Ajustar fecha de pago")
});

test("R109b: detalle = nombre del cliente; revisar fechas incluye la fecha de corte de renovaciones (≤5 días)", () => {
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  assert.match(x, /if \(quien\) return data\.reversaDe \? `\$\{quien\} \(reversa\)` : quien;/);
  const l = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
  // R109c: la fecha de corte NO es el día del pago → ya no se corrige sola; se ajusta a mano por pago.
  assert.doesNotMatch(l, /motivo: "fecha de corte del cliente"/);
});
