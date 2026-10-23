// R150 · Oct-2026 · accountId inmutable + cupos reales en el TG Bot (lib_inventario_canonico.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const inv = require("../lib_inventario_canonico");

function fakeDb(seed = {}) {
  const data = Object.fromEntries(Object.entries(seed).map(([c, docs]) => [c, new Map(Object.entries(docs))]));
  const col = (n) => (data[n] ||= new Map());
  const snap = (n, id) => ({ id, exists: col(n).has(id), data: () => ({ ...col(n).get(id) }), ref: ref(n, id) });
  const ref = (n, id) => ({ id, get: async () => snap(n, id), set: async (v, o) => col(n).set(id, o && o.merge ? { ...(col(n).get(id) || {}), ...v } : { ...v }) });
  const q = (n, f = []) => ({
    where: (k, op, v) => q(n, [...f, [k, v]]),
    get: async () => { const docs = [...col(n).keys()].filter((id) => f.every(([k, v]) => col(n).get(id)[k] === v)).map((id) => snap(n, id)); return { docs, forEach: (fn) => docs.forEach(fn) }; },
  });
  return { _data: data, collection: (n) => ({ ...q(n), doc: (id) => ref(n, id) }), runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o) }) };
}
const adminFake = { firestore: { FieldValue: { serverTimestamp: () => "TS" } } };

test("resolver: encuentra por accountId, por ID calculado y por plataforma+correo (cuentas creadas en la Web)", async () => {
  const db = fakeDb({ inventario: {
    "netflix__a_x_com": { plataforma: "netflix", correo: "a@x.com" },
    "Xy7RandomWebId": { plataforma: "hbomax", correo: "web@x.com" },
  } });
  assert.equal((await inv.resolverCuentaInventario(db, { docId: "Xy7RandomWebId" })).id, "Xy7RandomWebId");
  assert.equal((await inv.resolverCuentaInventario(db, { plataforma: "netflix", acceso: "A@x.com", docIdCalculado: "netflix__a_x_com" })).id, "netflix__a_x_com");
  assert.equal((await inv.resolverCuentaInventario(db, { plataforma: "hbomax", acceso: "web@x.com", docIdCalculado: "hbomax__web_x_com" })).id, "Xy7RandomWebId",
    "antes el bot no encontraba las cuentas creadas en la Web (ID aleatorio)");
  assert.equal(await inv.resolverCuentaInventario(db, { plataforma: "hbomax", acceso: "otra@x.com" }), null);
});

test("editar correo: mismo documento (accountId no cambia), replica a fichas y renombra vínculos", async () => {
  const db = fakeDb({ inventario: { acc1: { plataforma: "hbomax", correo: "viejo@x.com", clientes: [{ nombre: "A", vinculoInventario: JSON.stringify([JSON.stringify(["c1", "k", "a"]), 0]) }, { nombre: "B", vinculoInventario: JSON.stringify([JSON.stringify(["c2", "hbomax|viejo@x.com", "b"]), 0]) }] } } });
  const cuenta = await inv.resolverCuentaInventario(db, { docId: "acc1" });
  let llamada = null;
  const r = await inv.editarCuentaCanonica(db, adminFake, { cuenta, nuevoCorreo: "nuevo@x.com", sincronizarFichas: async (args) => { llamada = args; return { perfilesActualizados: 5, documentosActualizados: 5 }; } });
  assert.equal(r.accountId, "acc1");
  assert.equal(db._data.inventario.size, 1, "no se crea un documento nuevo ni se borra el viejo");
  const d = db._data.inventario.get("acc1");
  assert.equal(d.correo, "nuevo@x.com");
  assert.equal(d.accountId, "acc1");
  assert.equal(llamada.inventarioId, "acc1");
  assert.equal(llamada.correo, "viejo@x.com");
  assert.equal(llamada.nuevoCorreo, "nuevo@x.com");
  assert.match(d.clientes[1].vinculoInventario, /hbomax\|nuevo@x\.com/);
  assert.equal(r.perfilesActualizados, 5);
});

test("cupos reales y cuenta más vacía primero", () => {
  assert.deepEqual(inv.conteosCuenta({ capacidad: 5, ocupados: 2, disponibles: 3, clientes: [1, 2, 3, 4, 5] }), { capacidad: 5, ocupados: 5, disponibles: 0, sobreasignada: false });
  assert.equal(inv.conteosCuenta({ capacidad: 3, clientes: [1, 2, 3, 4] }).sobreasignada, true);
  const orden = inv.ordenarPorMasVacia([
    { id: "c", capacidad: 5, clientes: [1, 2, 3, 4, 5] },
    { id: "b", capacidad: 5, clientes: [1, 2, 3] },
    { id: "a", capacidad: 5, clientes: [1] },
  ]).map((x) => x.id);
  assert.deepEqual(orden, ["a", "b", "c"]);
});

test("el bot ya no cambia el ID de la cuenta al editar correo ni al moverla de plataforma", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  const block = h.slice(h.indexOf('if (p.mode === "mailEditCorreoCuenta")'), h.indexOf("// ✅ AGREGAR REVENDEDOR"));
  assert.doesNotMatch(block, /found\.ref\.delete\(\)/);
  assert.match(block, /editarCuentaCanonica/);
  const m = fs.readFileSync(path.join(__dirname, "..", "index_04_inventario_correos.js"), "utf8");
  const mover = m.slice(m.indexOf("async function moverCuentaInventarioPlataforma"), m.indexOf("// VISTAS INVENTARIO"));
  assert.doesNotMatch(mover, /tx\.delete\(srcRef\)/);
});

test("ICOMPLAY MAX registrado en el bot (1/3/5/7 pantallas · 1/3/6/12 meses)", () => {
  const core = fs.readFileSync(path.join(__dirname, "..", "index_01_core.js"), "utf8");
  for (const n of [1, 3, 5, 7]) assert.match(core, new RegExp(`icomplay${n}:\\s+\\{ key: "icomplay${n}"`));
  const crm = fs.readFileSync(path.join(__dirname, "..", "index_03_clientes_crm.js"), "utf8");
  assert.match(crm, /icomplay: \[1, 3, 6, 12\]/);
  assert.match(crm, /icomplay: "http:\/\/latinostream\.xyz:80"/);
});
