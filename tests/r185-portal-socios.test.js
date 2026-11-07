"use strict";
// R185 · Portal de Socios: utilidades de solo lectura de la API + regularización de pedidos antiguos (datos ficticios).
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib_portal_socios");
const N = require("../lib_normalizar_pedidos_r185");
const { FakeDb } = require("./helpers/fake-firestore");

test("periodo, rango de mes en hora de Honduras y límite del historial", () => {
  assert.deepEqual(P.periodoValido("2026-11"), { y: 2026, m: 11, txt: "2026-11" });
  for (const malo of ["2026-13", "26-11", "", "2026-1", "abc", "2026-11; drop"]) assert.equal(P.periodoValido(malo), null, malo);
  const r = P.rangoMesHonduras("2026-01");
  assert.equal(r.desde.toISOString(), "2026-01-01T06:00:00.000Z"); assert.equal(r.hasta.toISOString(), "2026-02-01T06:00:00.000Z");
  assert.equal(P.rangoMesHonduras("2026-12").hasta.toISOString(), "2027-01-01T06:00:00.000Z");
  assert.equal(P.limiteHistorial(undefined), 20); assert.equal(P.limiteHistorial("60"), 60); assert.equal(P.limiteHistorial("9999"), 500); assert.equal(P.limiteHistorial("-3"), 20);
});

test("metas: solo valores reales y positivos; 0 o vacío = no configurada", () => {
  assert.deepEqual(P.metasPublicas({}), { metas: {}, metaMensual: null });
  assert.deepEqual(P.metasPublicas({ metas: { "2026-11": 60000, "2026-10": 0, "x": 5, "2026-09": { monto: "1500.5" } }, metaMensual: "0" }), { metas: { "2026-11": 60000, "2026-09": 1500.5 }, metaMensual: null });
  assert.deepEqual(P.metasPublicas({ metaMensual: 2000 }).metaMensual, 2000);
});

const D = (s) => new Date(s).toISOString();
async function base() {
  const db = new FakeDb();
  const compra = (id, x) => db.collection("compras").doc(id).set({ socio_norm: "jimena", version: 2, monto: 150, totalCombo: 150, banco: "BAC", imagenUrl: "x", productos: [{ renglonId: "r1", servicio: "Netflix · 1 mes", servicioBase: "Netflix", clienteNombre: "Ana López" }], clientePrincipal: { nombre: "Ana", apellido: "López", clienteId: "c1" }, ...x });
  await compra("web_pub", { estado: "pendiente", createdAt: D("2026-09-01T15:00:00Z"), entregas: { r1: { estado: "publicada", entregaId: "e1" } } });
  await compra("web_fin", { estado: "en proceso", createdAt: D("2026-09-02T15:00:00Z") });
  await compra("web_cli", { estado: "pendiente", createdAt: D("2026-09-03T15:00:00Z"), clientePrincipal: { nombre: "Ana", apellido: "López", clienteId: "" } });
  await compra("web_hist", { estado: "pendiente", createdAt: D("2026-09-04T15:00:00Z"), estadoHistorial: [{ estado: "entregado", at: D("2026-09-05T00:00:00Z") }, { estado: "pendiente", at: D("2026-09-06T00:00:00Z") }], productos: [{ renglonId: "r1", servicioBase: "Canva Pro", clienteNombre: "Nadie" }], clientePrincipal: { nombre: "Nadie" } });
  await compra("web_nada", { estado: "pendiente", createdAt: D("2026-09-05T15:00:00Z"), productos: [{ renglonId: "r1", servicioBase: "Disney", clienteNombre: "Otro Cliente" }], clientePrincipal: { nombre: "Otro", apellido: "Cliente" } });
  await compra("web_nuevo", { estado: "pendiente", createdAt: D("2026-11-05T15:00:00Z"), entregas: { r1: { estado: "publicada" } } });
  await compra("web_ok", { estado: "entregado", createdAt: D("2026-08-01T15:00:00Z") });
  await compra("web_can", { estado: "cancelado", createdAt: D("2026-08-02T15:00:00Z") });
  await db.collection("finanzas_movimientos").doc("m1").set({ tipo: "ingreso", subtipo: "compra_socio", pedidoId: "web_fin", fichaPendiente: false, monto: 150 });
  await db.collection("finanzas_movimientos").doc("m2").set({ tipo: "ingreso", subtipo: "compra_socio", pedidoId: "web_nada", fichaPendiente: true, monto: 150 });
  await db.collection("clientes").doc("c9").set({ nombrePerfil: "Ana López", servicios: [{ plataforma: "Netflix", vendedor: "jimena", fechaRenovacion: "03/10/2026" }] });
  return db;
}

test("simulación: categorías con evidencia, pedidos nuevos y dudosos no se marcan, y no escribe nada", async () => {
  const db = await base();
  const antes = JSON.stringify(db.dump("compras"));
  const p = await N.previsualizar(db, { corte: "2026-10-30" });
  const cat = Object.fromEntries(p.filas.map((f) => [f.id, f.categoria]));
  assert.deepEqual(cat, { web_pub: "entregas_publicadas", web_fin: "ficha_armada", web_cli: "cliente_con_servicio", web_hist: "historial_entregado", web_nada: "sin_evidencia", web_nuevo: "posterior_al_corte", web_ok: "ya_entregado", web_can: "cancelado" });
  assert.equal(JSON.stringify(db.dump("compras")), antes, "el preview no modifica nada");
  assert.equal(p.antes.total, 8); assert.equal(p.antes.porEstado.entregado, 1);
  await assert.rejects(() => N.previsualizar(db, {}), /corte/);
});

test("aplicar: solo evidencia automática por defecto, idempotente, sin tocar pagos ni fechas; visto bueno exige IDs; reversión", async () => {
  const db = await base();
  const p = await N.previsualizar(db, { corte: "2026-10-30" });
  const r = await N.aplicar(db, p, { lote: "lote1" });
  assert.deepEqual(r.ids.sort(), ["web_fin", "web_pub"]);
  const c = db.dump("compras");
  assert.equal(c.web_pub.estado, "entregado"); assert.equal(c.web_pub.monto, 150); assert.equal(c.web_pub.banco, "BAC"); assert.equal(c.web_pub.createdAt, D("2026-09-01T15:00:00Z"));
  assert.equal(c.web_pub.normalizacionR185.antes.estado, "pendiente"); assert.match(c.web_pub.estadoHistorial.at(-1).detalle, /R185/);
  for (const id of ["web_cli", "web_hist", "web_nada", "web_nuevo"]) assert.equal(c[id].estado, "pendiente", `${id} intacto`);
  assert.equal(r.despues.porEstado.entregado, 3);
  assert.equal(Object.values(db.dump("avisos")).length, 0, "no avisa a los socios");
  assert.equal(Object.values(db.dump("auditoria_eventos")).filter((a) => a.accion === "normalizar_pedido_entregado").length, 2);
  // Repetir no duplica
  const r2 = await N.aplicar(db, p, { lote: "lote2" });
  assert.equal(r2.aplicados, 0); assert.deepEqual(r2.omitidos.map((o) => o.motivo).sort(), ["ya_normalizado", "ya_normalizado"]);
  // Categoría con visto bueno: sin IDs no hace nada; con IDs solo esos
  assert.equal((await N.aplicar(db, p, { categorias: ["cliente_con_servicio"], lote: "x" })).aplicados, 0);
  const r3 = await N.aplicar(db, p, { categorias: ["cliente_con_servicio"], ids: ["web_cli"], lote: "lote3" });
  assert.deepEqual(r3.ids, ["web_cli"]);
  // sin_evidencia nunca se aplica aunque se pida
  assert.equal((await N.aplicar(db, p, { categorias: ["sin_evidencia"], ids: ["web_nada"], lote: "y" })).aplicados, 0);
  // Si el estado cambió después del preview, se omite
  await db.collection("compras").doc("web_hist").set({ estado: "cancelado" }, { merge: true });
  const r4 = await N.aplicar(db, p, { categorias: ["historial_entregado"], ids: ["web_hist"], lote: "lote4" });
  assert.equal(r4.aplicados, 0); assert.match(r4.omitidos[0].motivo, /estado_cambio/);
  // Revertir lote1
  const rv = await N.revertir(db, { lote: "lote1" });
  assert.equal(rv.revertidos, 2);
  const c2 = db.dump("compras");
  assert.equal(c2.web_pub.estado, "pendiente"); assert.equal(c2.web_fin.estado, "en proceso"); assert.equal(c2.web_cli.estado, "entregado", "otro lote no se toca");
});
