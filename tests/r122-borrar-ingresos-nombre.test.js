const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
const f5 = fs.readFileSync(path.join(__dirname, "..", "index_05_finanzas_menus.js"), "utf8");
function extraer(src, nombre) { const i = src.indexOf(`function ${nombre}(`); assert.ok(i >= 0, nombre); let d = 0; const j = src.indexOf("{", src.indexOf(")", i)); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(src.lastIndexOf("\n", i) + 1, k + 1); } } }
const moneyLps = (n) => `${Number(n || 0).toFixed(2)} Lps`;
const F = new Function("moneyLps", `${["safeBtnLabelLocal", "nombreMovimientoFinanzas", "estadoMovimientoFinanzas", "textoBtnEliminarMovimiento", "R122_montoCorto", "R122_clavesRepetidas"].map((n) => extraer(h, n)).join("\n")}; return { textoBtnEliminarMovimiento, R122_clavesRepetidas };`)(moneyLps);

test("R122: borrar ingresos por fecha muestra el NOMBRE del cliente en cada botón", () => {
  const m = { tipo: "ingreso", fecha: "04/10/2026", monto: 150, plataforma: "⭐ Netflix Premium VIP", banco: "BAC Credomatic", clienteNombre: "Ever Figueroa" };
  const t = F.textoBtnEliminarMovimiento(m);
  assert.match(t, /^L150 · Ever Figueroa · ⭐ Netflix Premium VIP/);
  assert.ok(Array.from(t).length <= 60);
  assert.match(F.textoBtnEliminarMovimiento({ tipo: "ingreso", monto: 80, detalle: "Mari Zavala", plataforma: "Prime Video" }), /^L80 · Mari Zavala · Prime Video/, "ingresos manuales: el detalle");
  assert.match(F.textoBtnEliminarMovimiento({ tipo: "ingreso", monto: 110, socioNombre: "Jimena" }), /Jimena/);
  assert.match(F.textoBtnEliminarMovimiento({ tipo: "ingreso", monto: 70 }), /Sin nombre/);
  assert.match(F.textoBtnEliminarMovimiento({ ...m, estadoFinanciero: "anulado" }), /^🚫 anulado L150/);
  assert.match(F.textoBtnEliminarMovimiento({ ...m, monto: -150, reversaDe: "x" }), /^↩️ reversa L-150/);
  assert.match(F.textoBtnEliminarMovimiento({ tipo: "egreso", fecha: "04/10/2026", monto: 50, motivo: "Pago" }), /^04\/10\/2026 • 50\.00 Lps • Pago/, "egresos igual que antes");
});

test("R122: mismo cliente + mismo monto el mismo día se marca ⚠️ (sin contar anulados/reversas)", () => {
  const a = { tipo: "ingreso", monto: 150, clienteNombre: "Ever Figueroa" }, b = { ...a }, c = { ...a, estadoFinanciero: "anulado" }, d = { tipo: "ingreso", monto: 80, clienteNombre: "Ever Figueroa" };
  const rep = F.R122_clavesRepetidas([a, b, c, d]);
  assert.deepEqual([a, b, c, d].map(rep), [true, true, false, false]);
  assert.match(F.textoBtnEliminarMovimiento(a, true), /^⚠️ L150 · Ever Figueroa/);
});

test("R122: la lista va ordenada por nombre con total vigente, y la confirmación dice cliente, banco y quién lo registró", () => {
  assert.match(h, /list\.sort\(\(a, b\) => nombreMovimientoFinanzas\(a\)\.localeCompare\(nombreMovimientoFinanzas\(b\), "es"\)/);
  assert.match(h, /textoBtnEliminarMovimiento\(m, esRepetido\(m\)\), callback_data: `fin:del:pick:\$\{idCortoFinanzas\(m\.id\)\}`/);
  assert.match(h, /vigente\$\{vigentes\.length === 1 \? "" : "s"\} · total/);
  const conf = new Function("finTipoLabel", "extraerFechaMovimiento", "moneyLps", "finConceptoLabel", "finExtraLabel", `${extraer(f5, "textoConfirmarEliminacionMovimiento")}; return textoConfirmarEliminacionMovimiento;`)(() => "Ingreso", (m) => m.fecha, moneyLps, (m) => m.plataforma, () => "");
  const txt = conf({ fecha: "04/10/2026", monto: 150, plataforma: "Netflix VIP", banco: "BAC Credomatic", clienteNombre: "Ever_Figueroa", registradoPor: "libni", origenCanal: "apk", createdAt: "2026-10-04T20:15:00.000Z" });
  assert.match(txt, /Cliente: EverFigueroa/); assert.match(txt, /Banco: BAC Credomatic/); assert.match(txt, /Registrado: Relojes · apk · 14:15 h/);
});
