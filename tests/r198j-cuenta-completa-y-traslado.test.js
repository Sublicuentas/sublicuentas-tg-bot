// R198j · (1) Una CUENTA COMPLETA cuenta como LLENA en Bodega/Inventario (0 perfiles para vender), por la marca del
// cliente (cuentaCompleta) o de la cuenta (modalidadVenta / exclusivaCompraId). (2) Un perfil vive en UNA sola cuenta:
// al mover una compra de cuenta, si quedó también en la anterior, se retira de ahí (caso real: Carmen navidad → c2hi).
// Datos FICTICIOS.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const B = path.join(__dirname, "..");
const inv = require("../lib_inventario_canonico");
const HP = require("../lib_hbo_planes");

test("1 · cuenta completa = 0 disponibles aunque su capacidad sea 3 o 5", () => {
  const marcada = { plataforma: "hbomax", planHbo: "platinum", capacidad: 5, modalidadVenta: "cuenta_completa", exclusivaCompraId: "k1", clientes: [{ nombre: "Cliente A", compraId: "k1" }] };
  assert.equal(inv.esCuentaCompleta(marcada), true);
  assert.equal(inv.conteosCuenta(marcada).disponibles, 0);
  assert.equal(inv.conteosCuenta({ capacidad: 3, clientes: [{ cuentaCompleta: true }] }).disponibles, 0, "por la marca del cliente");
  assert.equal(inv.conteosCuenta({ capacidad: 3, clientes: [{ nombre: "x" }] }).disponibles, 2, "cuenta de perfiles normal");
  assert.equal(inv.conteosCuenta({ capacidad: 3, modalidadVenta: "cuenta_completa", clientes: [] }).disponibles, 3, "sin su cliente vuelve a ser cuenta normal");
  assert.equal(inv.conteosCuenta({ plataforma: "netflix", capacidad: 5, exclusivaCompraId: "n1", clientes: [{ compraId: "n1" }] }).disponibles, 0, "cualquier plataforma");
});

test("2 · HBO: no se vende un perfil en una cuenta completa marcada en la cuenta; la etiqueta y los libres lo dicen", () => {
  const d = { plataforma: "hbomax", planHbo: "standard", capacidad: 3, modalidadVenta: "cuenta_completa", exclusivaCompraId: "k1", clientes: [{ nombre: "Cliente A", compraId: "k1" }] };
  assert.match(HP.validarAsignacion(d, { plan: "standard", completa: false, compraId: "k9" }), /vendida como cuenta completa/);
  assert.equal(HP.validarAsignacion(d, { plan: "standard", completa: true, compraId: "k1" }), "", "su propia compra sí");
  assert.equal(HP.cuposVendibles(d), 0);
  assert.equal(HP.resumenCuenta(d).libres, 0);
  assert.match(HP.etiquetaPlan(d), /Standard · cuenta completa/);
});

function cargarCrm() {
  const store = new Map();
  const doc = (c, id) => ({ id, path: `${c}/${id}`, async get() { const d = store.get(`${c}/${id}`); return { id, exists: !!d, data: () => d, ref: doc(c, id) }; } });
  const db = {
    collection: (c) => ({
      doc: (id) => doc(c, id),
      where: (k, op, v) => ({ async get() { return { docs: [...store.entries()].filter(([p, d]) => p.startsWith(`${c}/`) && d[k] === v).map(([p, d]) => ({ id: p.split("/")[1], ref: doc(c, p.split("/")[1]), data: () => d })) }; } }),
    }),
    async runTransaction(fn) { const buf = []; const tx = { get: (r) => r.get(), set: (r, d, o) => buf.push([r.path, d, o]) }; const out = await fn(tx); for (const [k, d, o] of buf) store.set(k, o && o.merge ? { ...(store.get(k) || {}), ...d } : d); return out; },
  };
  const noop = new Proxy({}, { get: (t, k) => (k === "__esModule" ? false : (...a) => (typeof a[0] === "string" ? a[0] : undefined)) });
  const stub = (f, e) => { require.cache[require.resolve(path.join(B, f))] = { id: f, filename: f, loaded: true, exports: e }; };
  for (const k of Object.keys(require.cache)) if (/index_03_clientes_crm\.js$/.test(k)) delete require.cache[k];
  stub("index_01_core", { bot: new Proxy({}, { get: () => () => {} }), db, admin: { firestore: { FieldValue: { serverTimestamp: () => "ts" } } }, PLATAFORMAS: [] });
  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  stub("index_02_utils_roles", new Proxy({ normalizarPlataforma: norm, logErr: () => {} }, { get: (t, k) => (k in t ? t[k] : (...a) => a[0]) }));
  stub("index_23_access_control", noop); stub("index_26_integrity_guard", noop); stub("index_14_sorteos", noop); stub("index_17_vendedores_servicio", noop);
  return { crm: require(path.join(B, "index_03_clientes_crm")), store };
}

test("3 · Carmen: al quedar en c2hi se retira SOLO su perfil de navidad; los demás clientes y c2hi no se tocan", async () => {
  const { crm, store } = cargarCrm();
  store.set("inventario/nav", { plataforma: "hbomax", correo: "navidad@prueba.test", capacidad: 4, clientes: [
    { nombre: "Cliente 1", slot: 1, perfilId: "p1" }, { nombre: "Cliente 2", slot: 2 }, { nombre: "Cliente 3", slot: 3, compraId: "kx", clienteId: "cx" },
    { nombre: "Carmen Prueba", slot: 4, perfilId: "pC", compraId: "kC", clienteId: "cC" }] });
  store.set("inventario/c2", { plataforma: "hbomax", correo: "c2hi@prueba.test", capacidad: 4, clientes: [{ nombre: "Otro", slot: 1 }, { nombre: "Carmen Prueba", slot: 2, perfilId: "pC", compraId: "kC", clienteId: "cC" }] });
  const r = await crm.limpiarPerfilEnOtrasCuentasLocal({ plataforma: "hbomax", perfiles: [{ perfilId: "pC", correo: "c2hi@prueba.test" }], compraId: "kC", clienteId: "cC" });
  assert.deepEqual(r.retirados, [{ cuenta: "navidad@prueba.test", perfiles: 1 }]);
  const nav = store.get("inventario/nav");
  assert.deepEqual(nav.clientes.map((c) => c.nombre), ["Cliente 1", "Cliente 2", "Cliente 3"]); assert.equal(nav.disponibles, 1); assert.equal(nav.estado, "activa");
  assert.equal(store.get("inventario/c2").clientes.length, 2, "la cuenta donde quedó no se toca");
});

test("4 · compra multiperfil en dos cuentas: cada perfil se queda en SU cuenta (no se borra el perfil hermano)", async () => {
  const { crm, store } = cargarCrm();
  store.set("inventario/a", { plataforma: "netflix", correo: "a@prueba.test", capacidad: 5, clientes: [{ nombre: "P1", perfilId: "x1", compraId: "k" }] });
  store.set("inventario/b", { plataforma: "netflix", correo: "b@prueba.test", capacidad: 5, clientes: [{ nombre: "P2", perfilId: "x2", compraId: "k" }] });
  const r = await crm.limpiarPerfilEnOtrasCuentasLocal({ plataforma: "netflix", perfiles: [{ perfilId: "x1", correo: "a@prueba.test" }, { perfilId: "x2", correo: "b@prueba.test" }], compraId: "k", clienteId: "c" });
  assert.deepEqual(r.retirados, []);
  assert.equal(store.get("inventario/a").clientes.length, 1); assert.equal(store.get("inventario/b").clientes.length, 1);
});

test("5 · sin perfilId ni compra+cliente exactos no se retira a nadie (nunca por nombre)", async () => {
  const { crm, store } = cargarCrm();
  store.set("inventario/nav", { plataforma: "hbomax", correo: "navidad@prueba.test", capacidad: 4, clientes: [{ nombre: "Carmen Prueba", slot: 1 }] });
  const r = await crm.limpiarPerfilEnOtrasCuentasLocal({ plataforma: "hbomax", perfiles: [{ correo: "c2hi@prueba.test" }], compraId: "", clienteId: "cC" });
  assert.deepEqual(r.retirados, []); assert.equal(store.get("inventario/nav").clientes.length, 1);
});

test("6 · el bot avisa (no en silencio) y bloquea agregar perfiles a una cuenta completa; el inventario la rotula", () => {
  const fs = require("node:fs");
  const h = fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8"), i4 = fs.readFileSync(path.join(B, "index_04_inventario_correos.js"), "utf8");
  assert.match(h, /async function avisoSyncInventarioLocal/);
  assert.match(h, /await avisoSyncInventarioLocal\(chatId, rPatchMail && rPatchMail\.sync\)/);
  assert.equal((h.match(/vendida como CUENTA COMPLETA a un cliente: no se le agregan perfiles/g) || []).length, 2);
  assert.match(i4, /disponiblesCuenta\(data, capacidad, ocupados\); \/\/ R198j/);
  assert.match(i4, /CUENTA COMPLETA \(exclusiva de un cliente\)/);
});
