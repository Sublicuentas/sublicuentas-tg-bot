// R206 · Disney Premium con ESPN ↔ sin ESPN en la misma cuenta, con sus ventas, sin sacar clientes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDb } = require("./helpers/fake-firestore.js");
const DT = require("../lib_disney_tipo");

async function base() {
  const db = new FakeDb();
  const cls = Array.from({ length: 7 }, (_, i) => ({ clienteId: "c" + (i % 2), slot: i + 1, nombre: "Cliente " + i }));
  await db.collection("inventario").doc("inv1").set({ plataforma: "disneys", correo: "songoku@prueba.test", capacidad: 6, clientes: cls, estado: "activa" });
  await db.collection("clientes").doc("c0").set({ servicios: [{ plataforma: "disneys", correo: "songoku@prueba.test", precio: 70 }, { plataforma: "netflix", correo: "otra@prueba.test" }] });
  await db.collection("clientes").doc("c1").set({ servicios: [{ plataforma: "disneys", inventarioId: "inv1", precio: 70 }] });
  return db;
}
test("con más ocupados que la capacidad pide excepción y no cambia nada", async () => {
  const db = await base();
  await assert.rejects(DT.cambiarTipo(db, { inventarioId: "inv1", tipo: "disneyp" }), (e) => e.code === "requiere_excepcion" && e.capacidadSugerida === 7);
  assert.equal((await db.collection("inventario").doc("inv1").get()).data().plataforma, "disneys");
});
test("confirmado: pasa a Con ESPN, conserva a los 7 y sincroniza sus ventas", async () => {
  const db = await base();
  const r = await DT.cambiarTipo(db, { inventarioId: "inv1", tipo: "disneyp", autorizarExcepcion: true, usuario: "prueba" });
  assert.equal(r.plataforma, "disneyp"); assert.equal(r.capacidad, 7); assert.equal(r.disponibles, 0);
  const d = (await db.collection("inventario").doc("inv1").get()).data();
  assert.equal(d.clientes.length, 7); assert.equal(d.movedFromPlatform, "disneys"); assert.equal(d.historialTipo.length, 1);
  const v = await DT.sincronizarVentas(db, { inventarioId: "inv1" }); assert.equal(v.ventas, 2);
  const c0 = (await db.collection("clientes").doc("c0").get()).data().servicios;
  assert.equal(c0[0].plataforma, "disneyp"); assert.equal(c0[0].precio, 70); assert.equal(c0[1].plataforma, "netflix");
});
test("capacidad predeterminada sigue al tipo (3 → 6) y no deja dos cuentas iguales", async () => {
  const db = new FakeDb();
  await db.collection("inventario").doc("a").set({ plataforma: "disneys", correo: "x@prueba.test", capacidad: 3, clientes: [] });
  assert.equal((await DT.cambiarTipo(db, { inventarioId: "a", tipo: "disneyp" })).capacidad, 6);
  await db.collection("inventario").doc("b").set({ plataforma: "disneys", correo: "x@prueba.test", capacidad: 3, clientes: [] });
  await assert.rejects(DT.cambiarTipo(db, { inventarioId: "b", tipo: "disneyp" }), /Ya existe/);
  await assert.rejects(DT.cambiarTipo(db, { inventarioId: "a", tipo: "hbomax" }), /Tipo no válido/);
});
test("copia fiel Web = bot", () => {
  const fs = require("fs"), path = require("path"); const hq = path.join(__dirname, "../../hq-gh/api/_disney-tipo.js");
  if (!fs.existsSync(hq)) return;
  const cuerpo = (t) => t.split("\n").slice(2).join("\n");
  assert.equal(cuerpo(fs.readFileSync(path.join(__dirname, "../lib_disney_tipo.js"), "utf8")), cuerpo(fs.readFileSync(hq, "utf8")));
});
