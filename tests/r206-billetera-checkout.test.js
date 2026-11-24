"use strict";
// R206 · Fase 4: pagar con billetera. QA-08, QA-12, QA-14, QA-16 (+ QA-13/QA-15 en el flujo del endpoint).
const test = require("node:test"); const assert = require("node:assert/strict");
const BC = require("../lib_billetera_checkout");
const BIL = require("../lib_billetera");

/* Base falsa con transacciones OPTIMISTAS como Firestore: si un documento o una consulta leída cambió antes
   de confirmar, la transacción se repite. Así se prueba el doble gasto con dos compras simultáneas. */
function fakeDb() {
  const cols = new Map(); const ver = new Map(); let reloj = 0;
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const bump = (n, id) => { reloj++; ver.set(`${n}/${id}`, reloj); ver.set(`${n}/*`, reloj); };
  const ref = (n, id) => ({ id, _n: n, _k: `${n}/${id}`,
    get: async () => ({ exists: col(n).has(id), data: () => col(n).get(id) }),
    create: async (v) => { if (col(n).has(id)) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } col(n).set(id, v); bump(n, id); },
    set: async (v, o) => { col(n).set(id, o && o.merge ? { ...(col(n).get(id) || {}), ...v } : v); bump(n, id); } });
  const query = (n, f, v) => ({ _k: `${n}/*`, get: async () => { const docs = [...col(n).entries()].filter(([, d]) => d[f] === v).map(([id, d]) => ({ id, data: () => d })); return { docs, empty: !docs.length }; } });
  const db = { _cols: cols, intentos: 0,
    collection: (n) => ({ doc: (id) => ref(n, id), get: async () => ({ docs: [...col(n).entries()].map(([id, d]) => ({ id, data: () => d })) }), where: (f, _o, v) => query(n, f, v) }),
    runTransaction: async (fn) => {
      for (let i = 0; i < 5; i++) {
        db.intentos++;
        const leidos = new Map(), escrituras = []; let w = false;
        const tx = { get: async (r) => { if (w) throw new Error("lectura después de escritura"); leidos.set(r._k, ver.get(r._k) || 0); await new Promise((ok) => setImmediate(ok)); return r.get(); },
          set: (r, v, o) => { w = true; escrituras.push([r, v, o]); }, update: (r, v) => { w = true; escrituras.push([r, v, { merge: true }]); } };
        const out = await fn(tx);
        if ([...leidos].some(([k, v0]) => (ver.get(k) || 0) !== v0)) continue; // conflicto → repetir
        for (const [r, v, o] of escrituras) { col(r._n).set(r.id, o && o.merge ? { ...(col(r._n).get(r.id) || {}), ...v } : v); bump(r._n, r.id); }
        return out;
      }
      throw new Error("demasiados conflictos");
    } };
  return db;
}
const acreditar = (db, socio, negocio, monto, sub = "real", id = `m${Math.random()}`) => db.collection(BIL.COL_MOV).doc(id).set({ socio, socio_norm: BIL.norm(socio), negocio, subcuenta: sub, tipo: sub === "promocional" ? "premio" : "recarga", monto, signo: 1, estado: "acreditado" });
const prod = (o = {}) => ({ catalogId: "disney_perfil", catalogCategory: "🎬 Streaming", servicioBase: "Disney+", catalogSub: "Perfil 1 mes", servicio: "Disney+ · Perfil 1 mes", precioCatalogo: 100, cantidad: 1, ...o });

/* Compra con billetera tal como la hace /rev/compra: pedido + cargo en la MISMA transacción. */
async function comprar(db, { id, socio = "Jimena", negocio = "sublicuentas", productos, descuentoCombo = 0, usarGiftCard = false, costos = {} }) {
  const totalCombo = productos.reduce((a, p) => a + p.precioCatalogo * p.cantidad, 0) - descuentoCombo;
  return db.runTransaction(async (tx) => {
    const ref = db.collection("compras").doc(id);
    const ya = await tx.get(ref); if (ya.exists) return { dup: true };
    const cargo = await BC.prepararCargo(tx, db, { socioNorm: socio, negocio });
    const cot = BC.cotizar({ productos, descuentoCombo, totalCombo, negocio, saldos: cargo.saldos, usarGiftCard, cfg: BC.CFG_BASE, costos });
    if (!cot.ok) return { error: cot.error };
    if (!cot.suficiente) return { error: "saldo_insuficiente", cot };
    tx.set(ref, { estado: "pago confirmado", entregaCanal: "manual", pago: { metodo: "billetera", ...cot } });
    cargo.aplicar(cot, { compraId: id, socio });
    return { ok: true, cot };
  });
}
const saldos = async (db, socio = "Jimena") => (await BIL.vistaSocio(db, socio)).saldos;

test("QA-12 · dos compras simultáneas con saldo para una sola: una pasa, la otra no; nunca saldo negativo", async () => {
  const db = fakeDb(); await acreditar(db, "Jimena", "sublicuentas", 150);
  const [a, b] = await Promise.all([comprar(db, { id: "c1", productos: [prod()] }), comprar(db, { id: "c2", productos: [prod()] })]);
  const ok = [a, b].filter((x) => x.ok).length, sin = [a, b].filter((x) => x.error === "saldo_insuficiente").length;
  assert.equal(ok, 1); assert.equal(sin, 1);
  const s = await saldos(db); assert.equal(s.sublicuentas.real, 55); assert.ok(s.sublicuentas.real >= 0);
  assert.ok(db.intentos > 2, "la segunda transacción tuvo que repetirse al ver el primer cargo");
  assert.equal([...db._cols.get("compras").keys()].length, 1);
});
test("saldo insuficiente: no se crea pedido ni movimiento", async () => {
  const db = fakeDb(); await acreditar(db, "Jimena", "sublicuentas", 40);
  const r = await comprar(db, { id: "c1", productos: [prod()] });
  assert.equal(r.error, "saldo_insuficiente"); assert.equal(r.cot.faltante, 55);
  assert.equal((db._cols.get("compras") || new Map()).size, 0); assert.equal((await saldos(db)).sublicuentas.real, 40);
});
test("saldos separados: el saldo de Relojes no paga pedidos de Sublicuentas", async () => {
  const db = fakeDb(); await acreditar(db, "Jimena", "relojes", 500);
  assert.equal((await comprar(db, { id: "c1", productos: [prod()] })).error, "saldo_insuficiente");
  assert.equal((await comprar(db, { id: "c2", negocio: "relojes", productos: [prod()] })).ok, true);
});

test("QA-14 · 5% parejo sin pedir costo; Netflix nunca; se puede apagar o bajar el % por producto", () => {
  const p = prod(), s = { real: 1000, disponible: 1000, promocional: 0 };
  const base = BC.cotizar({ productos: [p], totalCombo: 100, saldos: s });
  assert.equal(base.descuento, 5); assert.equal(base.totalFinal, 95);              // sin costo registrado igual aplica
  const caro = prod({ precioCatalogo: 160 });
  assert.equal(BC.cotizar({ productos: [caro], totalCombo: 160, saldos: s }).descuento, 8);
  const barato = prod({ precioCatalogo: 50 });
  assert.equal(BC.cotizar({ productos: [barato], totalCombo: 50, saldos: s }).descuento, 2); // 2.50 → L2
  const nf = prod({ catalogId: "netflix_vip", servicioBase: "Netflix Vip", servicio: "Netflix Vip" });
  const n = BC.cotizar({ productos: [nf], totalCombo: 110, saldos: s });
  assert.equal(n.descuento, 0); assert.equal(n.lineas[0].motivo, "Netflix no tiene descuento");
  assert.equal(BC.cotizar({ productos: [p], totalCombo: 100, saldos: s, costos: { [BC.claveCosto(p)]: { activo: false, pct: null } } }).descuento, 0);
  assert.equal(BC.cotizar({ productos: [p], totalCombo: 100, saldos: s, costos: { [BC.claveCosto(p)]: { activo: true, pct: 2 } } }).descuento, 2);
  assert.equal(BC.cotizar({ productos: [p], totalCombo: 100, saldos: s, cfg: { ...BC.CFG_BASE, pctMax: 3 } }).descuento, 3);
});
test("combo: el descuento se calcula sobre el precio ya rebajado por combo, por unidad y cantidad", () => {
  const a = prod({ catalogId: "a", servicioBase: "Disney+", cantidad: 1 }), b = prod({ catalogId: "b", servicioBase: "HBO Max", precioCatalogo: 100, cantidad: 1 });
  const c = BC.cotizar({ productos: [a, b], descuentoCombo: 10, totalCombo: 190, saldos: { disponible: 999 } });
  assert.equal(c.lineas[0].neto, 95); assert.equal(c.descuento, 8); assert.equal(c.totalFinal, 182); // floor(4.75)=4 ×2
});
test("productos «por comisión» no se pagan con billetera", () => {
  assert.equal(BC.cotizar({ productos: [prod({ precioCatalogo: null })], totalCombo: 0, saldos: {} }).error, "billetera_no_aplica_comision");
});

test("QA-08 · Gift Card L100 en pedido de L70: queda L30; no se combina con descuento; Netflix no la usa", async () => {
  const db = fakeDb(); await acreditar(db, "Jimena", "sublicuentas", 100, "promocional");
  const p = prod({ precioCatalogo: 70 });
  const r = await comprar(db, { id: "g1", productos: [p], usarGiftCard: true });
  assert.equal(r.ok, true); assert.equal(r.cot.giftCard, 70); assert.equal(r.cot.descuento, 0); assert.equal(r.cot.aPagarSaldo, 0);
  assert.equal((await saldos(db)).sublicuentas.promocional, 30);
  const nf = prod({ servicioBase: "Netflix", servicio: "Netflix · Perfil", precioCatalogo: 50 });
  const n = await comprar(db, { id: "g2", productos: [nf], usarGiftCard: true });
  assert.equal(n.error, "saldo_insuficiente"); assert.equal(n.cot.giftCard, 0);
});
test("Gift Card parcial + saldo real cubren juntos; Gift Card nunca en Relojes", async () => {
  const db = fakeDb(); await acreditar(db, "Jimena", "sublicuentas", 30, "promocional"); await acreditar(db, "Jimena", "sublicuentas", 100);
  const r = await comprar(db, { id: "g1", productos: [prod()], usarGiftCard: true });
  assert.equal(r.cot.giftCard, 30); assert.equal(r.cot.aPagarSaldo, 70);
  const s = await saldos(db); assert.equal(s.sublicuentas.promocional, 0); assert.equal(s.sublicuentas.real, 30);
  assert.equal(BC.cotizar({ productos: [prod()], totalCombo: 100, negocio: "relojes", saldos: { disponible: 0, promocional: 500 }, usarGiftCard: true }).giftCard, 0);
});

test("QA-16 · cancelar devuelve UNA sola vez lo cargado (real y Gift Card)", async () => {
  const db = fakeDb(); await acreditar(db, "Jimena", "sublicuentas", 20, "promocional"); await acreditar(db, "Jimena", "sublicuentas", 100);
  await comprar(db, { id: "c9", productos: [prod()], usarGiftCard: true });
  const d1 = await BC.devolver(db, { compraId: "c9" }); const d2 = await BC.devolver(db, { compraId: "c9" });
  assert.deepEqual([d1.real, d1.promocional], [80, 20]); assert.equal(d2.duplicado, true);
  const s = await saldos(db); assert.equal(s.sublicuentas.real, 100); assert.equal(s.sublicuentas.promocional, 20);
  assert.deepEqual(await BC.devolver(db, { compraId: "noexiste" }), { real: 0, promocional: 0 });
});
test("QA-15 · el pedido con billetera nace «pago confirmado» y la entrega sigue manual", async () => {
  const db = fakeDb(); await acreditar(db, "Jimena", "sublicuentas", 100);
  await comprar(db, { id: "c1", productos: [prod()] });
  const c = db._cols.get("compras").get("c1"); assert.equal(c.estado, "pago confirmado"); assert.equal(c.entregaCanal, "manual");
});
test("reintento del mismo pedido no cobra dos veces", async () => {
  const db = fakeDb(); await acreditar(db, "Jimena", "sublicuentas", 300);
  await comprar(db, { id: "c1", productos: [prod()] }); const r2 = await comprar(db, { id: "c1", productos: [prod()] });
  assert.equal(r2.dup, true); assert.equal((await saldos(db)).sublicuentas.real, 205);
});
test("config admin: % fuera de 0–5 se rechaza; tabla calcula el descuento de hoy sin costos", async () => {
  const db = fakeDb();
  assert.equal((await BC.guardarConfig(db, { pctMax: 8 })).error, "pct_invalido");
  assert.equal((await BC.guardarCosto(db, "x", { pct: 9 })).error, "pct_invalido");
  const it = { categoria: "🎬 Streaming", n: "Disney+", s: "Perfil 1 mes", nombreCompleto: "Disney+ · Perfil 1 mes", id: "d", p: 100 };
  const clave = BC.claveCosto({ catalogCategory: it.categoria, servicioBase: it.n, catalogSub: it.s });
  let t = BC.tablaAdmin([it, { ...it, n: "Netflix", nombreCompleto: "Netflix" }], await BC.configuracion(db));
  assert.equal(t[0].descuentoHoy, 5); assert.equal(t[1].excluido, true); assert.equal(t[1].descuentoHoy, 0);
  await BC.guardarCosto(db, clave, { activo: false });
  t = BC.tablaAdmin([it], await BC.configuracion(db)); assert.equal(t[0].descuentoHoy, 0);
});
