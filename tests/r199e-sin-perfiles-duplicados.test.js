// R199e · Caso real: HBO con Aaron y Leyda mostraba «Ocupados 5/3» (Aaron ×2, Leyda ×3).
// Un perfil = UNA fila en Bodega. Nunca se identifica una fila solo por el PIN. Nunca se pisa a un perfil hermano.
// Nunca se quita a otra persona. Datos FICTICIOS.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const B = path.join(__dirname, "..");
const L = require("../lib_perfiles_inventario");

const aaron = { perfilId: "pA", compraId: "kA", clienteId: "cA", nombre: "Aaron Prueba", pin: "2000" };
const leyda = { perfilId: "pL", compraId: "kL", clienteId: "cL", nombre: "Leyda Prueba", pin: "0000" };

test("1 · nunca por PIN solo: una fila ajena con PIN 0000 NO se convierte en Leyda", () => {
  assert.equal(L.filaCoincidePerfil({ nombre: "Otra Persona", pin: "0000" }, leyda), false);
  assert.equal(L.filaCoincidePerfil({ nombre: "Leyda Prueba", pin: "0000" }, leyda), true, "mismo nombre y PIN, fila vieja sin IDs");
  assert.equal(L.filaCoincidePerfil({ nombre: "Leyda Prueba", pin: "1111" }, leyda), false, "otro PIN");
  assert.equal(L.filaCoincidePerfil({ nombre: "Pagador X", pin: "0000" }, leyda, { nombresAlternos: ["Pagador X"] }), true, "el pagador vale como nombre alterno");
  assert.equal(L.filaCoincidePerfil({ nombre: "Leyda Prueba", pin: "0000", clienteId: "otro" }, leyda), false, "otro cliente");
});

test("2 · guardar la ficha otra vez con perfilId nuevo (Web) ADOPTA la fila del mismo perfil: no agrega otra", () => {
  const filas = [{ nombre: "Leyda Prueba", pin: "0000", perfilId: "pViejo", compraId: "kL", clienteId: "cL" }];
  assert.equal(L.buscarFilaDePerfil(filas, { ...leyda, perfilId: "pNuevo" }, { perfilIdsCompra: ["pNuevo"] }), 0);
});

test("3 · compra de 2 perfiles con el mismo nombre y PIN: el segundo NO pisa al primero (perfil hermano)", () => {
  const filas = [{ nombre: "Aaron Prueba", pin: "2000", perfilId: "p1", compraId: "kA", clienteId: "cA" }];
  assert.equal(L.buscarFilaDePerfil(filas, { ...aaron, perfilId: "p2" }, { perfilIdsCompra: ["p1", "p2"] }), -1, "se agrega su propia fila");
  assert.equal(L.buscarFilaDePerfil(filas, { ...aaron, perfilId: "p1" }, { perfilIdsCompra: ["p1", "p2"] }), 0);
});

test("4 · colapsar: Aaron ×2 y Leyda ×3 (como en la captura) quedan 1 y 1; nadie más sale", () => {
  const filas = [
    { ...aaron }, { ...aaron, perfilId: "pA-viejo" },
    { ...leyda }, { ...leyda }, { ...leyda, perfilId: "" },
  ];
  const ficha = new Map([[L.claveCompra("cA", "kA"), [aaron]], [L.claveCompra("cL", "kL"), [leyda]]]);
  const r = L.colapsarPerfilesRepetidos(filas, { perfilesPorCompra: ficha });
  assert.deepEqual(r.filas.map((f) => f.nombre), ["Aaron Prueba", "Leyda Prueba"]);
  assert.deepEqual(r.filas.map((f) => f.perfilId), ["pA", "pL"], "queda la fila con el perfilId de la ficha");
  assert.equal(r.quitadas.length, 3);
  assert.deepEqual(r.filas.map((f) => f.slot), [1, 2]);
});

test("5 · colapsar respeta compras legítimas de varios perfiles y no toca lo que la ficha no conoce", () => {
  const p1 = { ...aaron, perfilId: "p1" }, p2 = { ...aaron, perfilId: "p2" };
  const ficha = new Map([[L.claveCompra("cA", "kA"), [p1, p2]]]);
  assert.equal(L.colapsarPerfilesRepetidos([p1, p2], { perfilesPorCompra: ficha }).filas.length, 2, "2 perfiles comprados = 2 filas");
  const sinFicha = L.colapsarPerfilesRepetidos([{ ...leyda, perfilId: "x1" }, { ...leyda, perfilId: "x2" }], { perfilesPorCompra: new Map() });
  assert.equal(sinFicha.filas.length, 2, "ficha desconocida → no se borra nada");
  const otros = L.colapsarPerfilesRepetidos([{ nombre: "Ana", pin: "0000" }, { nombre: "Luis", pin: "0000" }, leyda], { perfilesPorCompra: new Map() });
  assert.equal(otros.filas.length, 3, "otras personas con el mismo PIN nunca salen");
});

// ---------- Integración con la función real del bot (Firestore falso) ----------
function cargarCrm() {
  const store = new Map();
  const snapDe = (c, id) => { const d = store.get(`${c}/${id}`); return { id, exists: !!d, data: () => d, ref: doc(c, id) }; };
  const doc = (c, id) => ({ id, path: `${c}/${id}`, async get() { return snapDe(c, id); } });
  const listar = (c, filtro) => { const docs = [...store.keys()].filter((p) => p.startsWith(`${c}/`)).map((p) => snapDe(c, p.split("/")[1])).filter((s) => !filtro || filtro(s.data())); return { docs, forEach: (fn) => docs.forEach(fn), size: docs.length }; };
  const db = {
    collection: (c) => ({ doc: (id) => doc(c, id), async get() { return listar(c); }, where: (k, op, v) => ({ async get() { return listar(c, (d) => d[k] === v); } }) }),
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

const CORREO = "primal@prueba.test";
const servicio = (compraId, perfiles) => ({ plataforma: "hbomax", compraId, correo: CORREO, perfiles: perfiles.map((p) => ({ ...p, correo: CORREO })) });

test("6 · guardar la misma ficha 3 veces (y con perfilId regenerado) deja UNA fila por perfil", async () => {
  const { crm, store } = cargarCrm();
  store.set("inventario/hbo1", { plataforma: "hbomax", correo: CORREO, capacidad: 3, clientes: [] });
  const sv = servicio("kL", [{ perfilId: "pL", nombre: "Leyda Prueba", pin: "0000" }]);
  for (let i = 0; i < 3; i++) await crm.sincronizarCompraInventarioLocal(i ? sv : null, sv, "Leyda Prueba", { clienteId: "cL" });
  const sv2 = servicio("kL", [{ perfilId: "pL-otro", nombre: "Leyda Prueba", pin: "0000" }]);
  await crm.sincronizarCompraInventarioLocal(sv, sv2, "Leyda Prueba", { clienteId: "cL" });
  const cuenta = store.get("inventario/hbo1");
  assert.equal(cuenta.clientes.length, 1);
  assert.equal(cuenta.clientes[0].perfilId, "pL-otro");
  assert.equal(cuenta.disponibles, 2);
});

test("7 · una cuenta que ya trae copias de la misma compra queda limpia al guardar la ficha; los demás no se tocan", async () => {
  const { crm, store } = cargarCrm();
  store.set("inventario/hbo1", { plataforma: "hbomax", correo: CORREO, capacidad: 3, clientes: [
    { nombre: "Aaron Prueba", pin: "2000", perfilId: "pA", compraId: "kA", clienteId: "cA", slot: 1 },
    { nombre: "Aaron Prueba", pin: "2000", perfilId: "pA-viejo", compraId: "kA", clienteId: "cA", slot: 2 },
    { nombre: "Otra Persona", pin: "0000", slot: 3 },
  ] });
  const sv = servicio("kA", [{ perfilId: "pA", nombre: "Aaron Prueba", pin: "2000" }]);
  await crm.sincronizarCompraInventarioLocal(sv, sv, "Aaron Prueba", { clienteId: "cA" });
  const cuenta = store.get("inventario/hbo1");
  assert.deepEqual(cuenta.clientes.map((c) => c.nombre), ["Aaron Prueba", "Otra Persona"]);
  assert.equal(cuenta.ocupados, 2); assert.equal(cuenta.disponibles, 1); assert.equal(cuenta.sobreasignada, false);
});

test("8 · compra de 2 perfiles iguales (mismo nombre y PIN) → 2 filas, guardada las veces que sea", async () => {
  const { crm, store } = cargarCrm();
  store.set("inventario/hbo1", { plataforma: "hbomax", correo: CORREO, capacidad: 3, clientes: [] });
  const sv = servicio("kA", [{ perfilId: "p1", nombre: "Aaron Prueba", pin: "2000" }, { perfilId: "p2", nombre: "Aaron Prueba", pin: "2000" }]);
  await crm.sincronizarCompraInventarioLocal(null, sv, "Aaron Prueba", { clienteId: "cA" });
  await crm.sincronizarCompraInventarioLocal(sv, sv, "Aaron Prueba", { clienteId: "cA" });
  assert.deepEqual(store.get("inventario/hbo1").clientes.map((c) => c.perfilId), ["p1", "p2"]);
});

test("9 · bot: la vista de la cuenta ya no renombra por PIN, colapsa copias y avisa; /fix_duplicados usa la regla nueva", () => {
  const h = fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8");
  assert.match(h, /perfilesInv\.filaCoincidePerfil\(/);
  assert.match(h, /Se quitaron \$\{quitadasRepetidas\.length\} registro\(s\) repetido\(s\) del mismo perfil/);
  assert.match(h, /bot\.onText\(\/\\\/fix_duplicados[^\n]*\n  \/\/ R199e/);
  assert.doesNotMatch(h.slice(h.indexOf("/fix_duplicados(?:"), h.indexOf("/fix_duplicados(?:") + 4000), /normalizeLooseText\(c\?\.nombre/, "ya no agrupa solo por nombre");
});
