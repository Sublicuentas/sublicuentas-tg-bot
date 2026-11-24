"use strict";
// R213 · Mensaje del día: mismo texto todo el día de Honduras, cambia al día siguiente, respaldo nunca vacío.
const test = require("node:test"); const assert = require("node:assert/strict");
const MD = require("../lib_mensaje_dia");
function fakeDb() {
  const cols = new Map(); const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  return { _c: cols, collection: (n) => ({ doc: (id) => ({ id, get: async () => ({ exists: col(n).has(id), data: () => col(n).get(id) }),
    set: async (v, o) => { col(n).set(id, o && o.merge ? { ...(col(n).get(id) || {}), ...v } : v); },
    create: async (v) => { if (col(n).has(id)) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } col(n).set(id, v); } }) }) };
}
test("fecha de Honduras: 23:59 HN sigue siendo el mismo día aunque en UTC ya sea mañana", () => {
  assert.equal(MD.fechaHN(new Date("2026-11-25T05:59:00Z")), "2026-11-24");
  assert.equal(MD.fechaHN(new Date("2026-11-25T06:00:00Z")), "2026-11-25");
});
test("05 · días consecutivos cambian; banco sin repetir hasta completar la vuelta; frases de largo razonable", () => {
  const fechas = Array.from({ length: MD.BANCO.length }, (_, i) => new Date(Date.UTC(2026, 10, 24 + i)).toISOString().slice(0, 10));
  const txt = fechas.map(MD.respaldo);
  assert.equal(new Set(txt).size, MD.BANCO.length);
  for (let i = 1; i < txt.length; i++) assert.notEqual(txt[i], txt[i - 1]);
  for (const t of MD.BANCO) { const n = t.split(" ").length; assert.ok(n >= 10 && n <= 22, `${n}: ${t}`); assert.ok(!/conectamos emociones/i.test(t)); }
});
test("03/04 · misma fecha → mismo texto (cualquier usuario, cualquier recarga)", async () => {
  const db = fakeDb();
  const a = await MD.delDia(db, { fecha: "2026-11-24" }), b = await MD.delDia(db, { fecha: "2026-11-24" });
  assert.equal(a.texto, b.texto); assert.equal(a.fuente, "respaldo");
});
test("06 · sin programado → respaldo legible y UNA alerta administrativa por día", async () => {
  const db = fakeDb();
  await MD.delDia(db, { fecha: "2026-11-24" }); await MD.delDia(db, { fecha: "2026-11-24" });
  assert.equal(db._c.get("mensajes_dia_alertas").size, 1);
  assert.equal(db._c.get("mensajes_dia_alertas").get("2026-11-24").motivo, "sin_mensaje_programado");
});
test("programado manda; retirado vuelve al respaldo; borrador no se muestra", async () => {
  const db = fakeDb();
  assert.equal((await MD.guardar(db, "2026-11-25", { texto: "La constancia de hoy crea las oportunidades comerciales de mañana." }, "Admin")).ok, true);
  let r = await MD.delDia(db, { fecha: "2026-11-25" }); assert.equal(r.fuente, "programado"); assert.match(r.texto, /constancia/);
  await MD.guardar(db, "2026-11-25", { estado: "retirado" }); r = await MD.delDia(db, { fecha: "2026-11-25" }); assert.equal(r.fuente, "respaldo");
  await MD.guardar(db, "2026-11-26", { texto: "Texto en borrador para revisar luego.", estado: "borrador" }); assert.equal((await MD.delDia(db, { fecha: "2026-11-26" })).fuente, "respaldo");
});
test("seguridad: sin HTML, largo controlado, fecha válida", async () => {
  const db = fakeDb();
  assert.equal((await MD.guardar(db, "2026-11-25", { texto: "<script>alert(1)</script> hola a todos" })).error, "texto_invalido");
  assert.equal((await MD.guardar(db, "2026-11-25", { texto: "corto" })).error, "texto_corto");
  assert.equal((await MD.guardar(db, "2026-11-25", { texto: "x".repeat(300) })).error, "texto_largo");
  assert.equal((await MD.guardar(db, "25-11-2026", { texto: "Un mensaje correcto para el día." })).error, "fecha_invalida");
});
test("agenda: 14 días con fuente programado/respaldo", async () => {
  const db = fakeDb(); await MD.guardar(db, "2026-11-26", { texto: "Cada cliente bien atendido vuelve y recomienda." });
  const a = await MD.agenda(db, { desde: "2026-11-24", dias: 14 });
  assert.equal(a.length, 14); assert.equal(a[2].fuente, "programado"); assert.equal(a[0].fuente, "respaldo");
});
test("rutas montadas: socio solo lee; publicar exige admin general", () => {
  const s = require("fs").readFileSync(require("path").join(__dirname, "..", "server_api.js"), "utf8");
  assert.match(s, /app\.get\("\/rev\/mensaje-dia", revAuth/);
  assert.match(s, /app\.put\("\/rev\/admin\/mensajes-dia\/:fecha", revAdminAuth[\s\S]{0,80}isFullAdmin/);
});
