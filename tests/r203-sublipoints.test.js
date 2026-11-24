"use strict";
// R203 · SubliPoints (Fase 1): matriz QA-02..QA-05 del PDF + idempotencia, reversos e inicio sin retroactivo.
const test = require("node:test"); const assert = require("node:assert/strict");
const SP = require("../lib_sublipoints");

function fakeDb() {
  const cols = new Map(); const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const docRef = (n, id) => ({ id, get: async () => ({ exists: col(n).has(id), data: () => col(n).get(id) }),
    create: async (v) => { if (col(n).has(id)) { const e = new Error("6 ALREADY_EXISTS: Document already exists"); e.code = 6; throw e; } col(n).set(id, v); } });
  return { _cols: cols, collection: (n) => ({ doc: (id) => docRef(n, id), where: (f, _op, v) => ({ get: async () => ({ docs: [...col(n).entries()].filter(([, d]) => d[f] === v).map(([id, d]) => ({ id, data: () => d })) }) }) }) };
}
const ahora = () => new Date();
async function dbConInicio(inicioMs = Date.now() - 86400000) { const db = fakeDb(); await db.collection("sublipoints_config").doc("general").create({ inicio: new Date(inicioMs).toISOString(), excluidos: [] }); return db; }

test("niveles del PDF: 0–9 sin nivel · 10–24 Diamante · 25–49 Leyenda · 50+ Inmortal", () => {
  assert.deepEqual([0, 9, 10, 24, 25, 49, 50, 120].map(SP.nivelDe), ["Sin nivel", "Sin nivel", "Diamante", "Diamante", "Leyenda", "Leyenda", "Inmortal", "Inmortal"]);
  assert.deepEqual(SP.siguienteNivel(32), { nivel: "Inmortal", min: 50, faltan: 18 });
  assert.equal(SP.siguienteNivel(60), null);
});
test("QA-02 · venta nueva cobrada suma +2 UNA sola vez aunque se reintente", async () => {
  const db = await dbConInicio();
  const a = await SP.otorgar(db, { clave: SP.claveCompra("c1"), socio: "Jimena", tipo: "venta_nueva", unidades: 1, fechaEvento: ahora() });
  const b = await SP.otorgar(db, { clave: SP.claveCompra("c1"), socio: "Jimena", tipo: "venta_nueva", unidades: 1, fechaEvento: ahora() });
  assert.equal(a.puntos, 2); assert.equal(b.duplicado, true);
  assert.equal((await SP.resumenSocio(db, "jimena")).puntos, 2);
});
test("QA-03 · renovación cobrada +1; sin confirmar pago no existe movimiento (0)", async () => {
  const db = await dbConInicio();
  assert.equal((await SP.resumenSocio(db, "jimena")).puntos, 0, "renovar fechas sin pago confirmado no suma");
  await SP.otorgar(db, { clave: SP.claveRenovacion("r1"), socio: "Jimena", tipo: "renovacion", fechaEvento: ahora() });
  assert.equal((await SP.resumenSocio(db, "jimena")).puntos, 1);
});
test("QA-04 · combo de tres servicios: +6 en UN solo movimiento (un solo pago)", async () => {
  const db = await dbConInicio();
  const compra = { productos: [{ servicio: "HBO" }, { servicio: "Disney" }, { servicio: "Canva" }] };
  assert.equal(SP.unidadesCompra(compra), 3);
  await SP.otorgar(db, { clave: SP.claveCompra("combo"), socio: "Jimena", tipo: "venta_nueva", unidades: SP.unidadesCompra(compra), fechaEvento: ahora() });
  const r = await SP.resumenSocio(db, "jimena"); assert.equal(r.puntos, 6); assert.equal(r.ventasNuevas, 3);
  assert.equal(db._cols.get("sublipoints_movimientos").size, 1, "un pedido = un movimiento");
});
test("caso del PDF · 8 ventas nuevas + 16 renovaciones = 32 puntos = Leyenda", async () => {
  const db = await dbConInicio();
  for (let i = 0; i < 8; i++) await SP.otorgar(db, { clave: SP.claveCompra("v" + i), socio: "Jimena", tipo: "venta_nueva", fechaEvento: ahora() });
  for (let i = 0; i < 16; i++) await SP.otorgar(db, { clave: SP.claveRenovacion("r" + i), socio: "Jimena", tipo: "renovacion", fechaEvento: ahora() });
  const r = await SP.resumenSocio(db, "jimena");
  assert.equal(r.puntos, 32); assert.equal(r.nivel, "Leyenda"); assert.equal(r.ventasNuevas, 8); assert.equal(r.renovaciones, 16);
});
test("QA-05 · el mes nuevo empieza en cero y el historial del mes anterior se conserva", async () => {
  const db = await dbConInicio();
  db._cols.set("sublipoints_movimientos", new Map([["compra_viejo", { socio_norm: "jimena", tipo: "venta_nueva", unidades: 10, puntos: 20, mes: "2026-10", createdAt: new Date("2026-10-15") }]]));
  const r = await SP.resumenSocio(db, "jimena", "2026-11");
  assert.equal(r.puntos, 0); assert.equal(r.meses.find((m) => m.mes === "2026-10").puntos, 20);
});
test("anulación: asiento compensatorio una sola vez y el original se conserva", async () => {
  const db = await dbConInicio();
  await SP.otorgar(db, { clave: SP.claveCompra("x"), socio: "Jimena", tipo: "venta_nueva", unidades: 2, fechaEvento: ahora() });
  await SP.revertir(db, { clave: SP.claveCompra("x"), motivo: "cancelado" }); await SP.revertir(db, { clave: SP.claveCompra("x") });
  const r = await SP.resumenSocio(db, "jimena"); assert.equal(r.puntos, 0); assert.equal(r.ventasNuevas, 0);
  assert.equal(db._cols.get("sublipoints_movimientos").size, 2);
  assert.equal((await SP.revertir(db, { clave: SP.claveCompra("nunca") })).sinOriginal, true);
});
test("sin retroactivo: un pedido creado antes del inicio no suma; la fecha de inicio se crea una sola vez", async () => {
  const db = await dbConInicio(Date.now());
  const r = await SP.otorgar(db, { clave: SP.claveCompra("viejo"), socio: "Jimena", tipo: "venta_nueva", fechaEvento: new Date(Date.now() - 3 * 86400000) });
  assert.equal(r.omitido, "antes_del_inicio");
  const db2 = fakeDb(); const c1 = await SP.config(db2); const c2 = await SP.config(db2); assert.equal(c1.inicio, c2.inicio);
});
test("mes en hora de Honduras (UTC−6)", () => {
  assert.equal(SP.mesHN(Date.parse("2026-12-01T03:00:00Z")), "2026-11", "9 p. m. del 30/11 en Honduras sigue siendo noviembre");
  assert.equal(SP.mesHN(Date.parse("2026-12-01T07:00:00Z")), "2026-12");
});
test("los dueños (Sublicuentas y Relojes) no ganan puntos ni salen en el ranking", async () => {
  const db = await dbConInicio();
  for (const s of ["Sublicuentas", "Relojes", "Naara", "Libni"]) assert.equal((await SP.otorgar(db, { clave: SP.claveCompra("o" + s), socio: s, tipo: "venta_nueva", fechaEvento: ahora() })).omitido, "excluido");
  await SP.otorgar(db, { clave: SP.claveCompra("j"), socio: "Jimena", tipo: "venta_nueva", fechaEvento: ahora() });
  assert.deepEqual((await SP.rankingMes(db)).map((x) => x.socio_norm), ["jimena"]);
  assert.equal((await SP.resumenSocio(db, "relojes")).excluido, true);
});
