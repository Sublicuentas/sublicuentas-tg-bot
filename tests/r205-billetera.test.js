"use strict";
// R205 · Billetera Fase 3: QA-09, QA-10, QA-11 y controles de recarga.
const test = require("node:test"); const assert = require("node:assert/strict");
const B = require("../lib_billetera");

function fakeDb() {
  const cols = new Map(); const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  let auto = 0;
  const ref = (n, id) => ({ id, _n: n, get: async () => ({ exists: col(n).has(id), data: () => col(n).get(id) }),
    create: async (v) => { if (col(n).has(id)) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } col(n).set(id, v); } });
  return { _cols: cols,
    collection: (n) => ({ doc: (id) => ref(n, id || `auto${++auto}`), get: async () => ({ docs: [...col(n).entries()].map(([id, d]) => ({ id, data: () => d })) }),
      where: (f, _o, v) => { const q = { get: async () => { const docs = [...col(n).entries()].filter(([, d]) => d[f] === v).map(([id, d]) => ({ id, data: () => d })); return { docs, empty: !docs.length }; }, limit: () => q }; return q; } }),
    runTransaction: async (fn) => { let w = false; return fn({ get: async (r) => { if (w) throw new Error("lectura después de escritura"); return r.get(); }, set: (r, v) => { w = true; col(r._n).set(r.id, v); }, update: (r, v) => { w = true; col(r._n).set(r.id, { ...(col(r._n).get(r.id) || {}), ...v }); } }); } };
}
const base = { socio: "Jimena", negocio: "sublicuentas", monto: 500, banco: "BAC Honduras", referencia: "AB-123456", imagenHash: "h1", requestId: "r1" };

test("QA-10 · el comprobante NO acredita: la recarga queda pendiente y el saldo en L0", async () => {
  const db = fakeDb(); const r = await B.solicitarRecarga(db, base);
  assert.equal(r.recarga.estado, "pendiente");
  const v = await B.vistaSocio(db, "jimena"); assert.equal(v.saldos.sublicuentas.real, 0); assert.equal(v.pendientes, 1);
});
test("QA-11 · aprobar dos veces (doble clic/reintento) acredita UNA sola vez", async () => {
  const db = fakeDb(); const r = await B.solicitarRecarga(db, base);
  const a1 = await B.revisarRecarga(db, { id: r.recarga.id, accion: "aprobar", por: "Sublicuentas" });
  const a2 = await B.revisarRecarga(db, { id: r.recarga.id, accion: "aprobar", por: "Sublicuentas" });
  assert.equal(a1.recarga.estado, "aprobada"); assert.equal(a2.sinCambios, true);
  const v = await B.vistaSocio(db, "jimena"); assert.equal(v.saldos.sublicuentas.real, 500); assert.equal(v.saldos.sublicuentas.disponible, 500);
  assert.equal(db._cols.get("billetera_movimientos").size, 1);
  assert.equal(v.movimientos[0].saldoPosterior, 500);
});
test("monto recibido distinto: se acredita lo que de verdad llegó y queda anotado", async () => {
  const db = fakeDb(); const r = await B.solicitarRecarga(db, base);
  await B.revisarRecarga(db, { id: r.recarga.id, accion: "aprobar", montoRecibido: 450 });
  assert.equal((await B.vistaSocio(db, "jimena")).saldos.sublicuentas.real, 450);
});
test("rechazo con motivo: saldo igual; una recarga acreditada no se puede rechazar", async () => {
  const db = fakeDb(); const r = await B.solicitarRecarga(db, base);
  assert.equal((await B.revisarRecarga(db, { id: r.recarga.id, accion: "rechazar" })).error, "falta_motivo");
  const x = await B.revisarRecarga(db, { id: r.recarga.id, accion: "rechazar", motivo: "No aparece el depósito" });
  assert.equal(x.recarga.estado, "rechazada"); assert.equal((await B.vistaSocio(db, "jimena")).saldos.sublicuentas.real, 0);
  const r2 = await B.solicitarRecarga(db, { ...base, requestId: "r2", referencia: "ZZ-999999", imagenHash: "h2" });
  await B.revisarRecarga(db, { id: r2.recarga.id, accion: "aprobar" });
  assert.equal((await B.revisarRecarga(db, { id: r2.recarga.id, accion: "rechazar", motivo: "x" })).error, "transicion_invalida");
});
test("antifraude: referencia o imagen repetidas, o comprobante ya usado en un pedido → bloqueado", async () => {
  const db = fakeDb(); await B.solicitarRecarga(db, base);
  assert.equal((await B.solicitarRecarga(db, { ...base, requestId: "r2", imagenHash: "otra" })).error, "referencia_repetida");
  assert.equal((await B.solicitarRecarga(db, { ...base, requestId: "r3", referencia: "NUEVA-1" })).error, "comprobante_repetido");
  await db.collection("compras").doc("c1").create({ comprobanteHash: "hc" });
  assert.equal((await B.solicitarRecarga(db, { ...base, requestId: "r4", referencia: "NUEVA-2", imagenHash: "hc" })).error, "comprobante_ya_usado");
  assert.equal((await B.solicitarRecarga(db, base)).duplicado, true, "mismo requestId = misma solicitud");
});
test("validaciones: negocio obligatorio, monto L10–L50,000, banco de la lista, referencia", async () => {
  const db = fakeDb();
  assert.equal((await B.solicitarRecarga(db, { ...base, negocio: "" })).error, "negocio_requerido");
  assert.equal((await B.solicitarRecarga(db, { ...base, monto: 5 })).error, "monto_invalido");
  assert.equal((await B.solicitarRecarga(db, { ...base, banco: "Banco X" })).error, "banco_requerido");
  assert.equal((await B.solicitarRecarga(db, { ...base, referencia: "1" })).error, "referencia_requerida");
});
test("QA-09 · dos saldos separados (Sublicuentas / Relojes) y el promocional nunca se suma al dinero", () => {
  const s = B.saldosDe([
    { negocio: "sublicuentas", subcuenta: "real", monto: 300, signo: 1 },
    { negocio: "relojes", subcuenta: "real", monto: 200, signo: 1 },
    { negocio: "sublicuentas", subcuenta: "promocional", monto: 100, signo: 1 },
    { negocio: "sublicuentas", subcuenta: "real", monto: 50, signo: 1, estado: "anulado" },
  ]);
  assert.deepEqual([s.sublicuentas.real, s.sublicuentas.promocional, s.sublicuentas.disponible, s.relojes.real], [300, 100, 300, 200]);
});
test("administración por negocio: Relojes no puede aprobar recargas de Sublicuentas", async () => {
  const db = fakeDb(); const r = await B.solicitarRecarga(db, base);
  assert.equal((await B.revisarRecarga(db, { id: r.recarga.id, accion: "aprobar", alcance: "relojes" })).error, "fuera_de_ambito");
  const l = await B.listaAdmin(db, { alcance: "relojes" }); assert.equal(l.recargas.length, 0);
});
