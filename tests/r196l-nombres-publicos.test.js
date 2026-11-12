// R196l · Nunca se muestran los nombres de las personas: Naara → Sublicuentas, Libni → Relojes. Datos ficticios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { publico } = require("../lib_nombres_publicos");

test("nombres públicos: Naara y Libni nunca salen; el titular bancario legal se respeta", () => {
  assert.equal(publico("naara (vía Sublicuentas)"), "Sublicuentas (vía Sublicuentas)");
  assert.equal(publico("Libni Daniela confirmó"), "Relojes confirmó");
  assert.equal(publico("NAARA canceló"), "Sublicuentas canceló");
  assert.equal(publico("Titular: LIBNI DANIELA VELÁSQUEZ BLANCO"), "Titular: LIBNI DANIELA VELÁSQUEZ BLANCO");
  assert.equal(publico("Geisell y Manuel"), "Geisell y Manuel");
});

test("Sala y entregas usan los nombres públicos", () => {
  const sala = require("../lib_sala_juntas");
  const r = { titulo: "Junta de Naara", participantes: ["naara", "libni"], fechaInicio: new Date("2026-12-01T16:00:00Z").toISOString() };
  const m = sala.mensaje({ tipo: "cancelacion" }, r, {}, {});
  assert.doesNotMatch(m.texto, /Naara|Libni/i);
  const s = fs.readFileSync(path.join(__dirname, "..", "rev_entregas_api.js"), "utf8");
  assert.match(s, /lib_nombres_publicos/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "lib_sala_juntas.js"), "utf8"), /naara: "Naara"|libni: "Libni"/);
});
