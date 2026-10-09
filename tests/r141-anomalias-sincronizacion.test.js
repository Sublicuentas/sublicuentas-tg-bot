const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const B = path.join(__dirname, "..");

function cargar() {
  const store = new Map();
  const ref = (c, id) => ({ id, path: `${c}/${id}`, async get() { const d = store.get(`${c}/${id}`); return { id, exists: !!d, data: () => d }; }, async set(d, o) { store.set(`${c}/${id}`, o && o.merge ? { ...(store.get(`${c}/${id}`) || {}), ...d } : d); } });
  const db = { collection: (c) => ({ doc: (id) => ref(c, id), add: async (d) => store.set(`${c}/a${store.size}`, d) }),
    async runTransaction(fn) { const buf = []; const tx = { get: (r) => r.get(), set: (r, d, o) => buf.push([r.path, d, o]) }; const out = await fn(tx); for (const [k, d, o] of buf) store.set(k, o && o.merge ? { ...(store.get(k) || {}), ...d } : d); return out; } };
  const enviados = [], papelera = [];
  const stub = (f, e) => { require.cache[require.resolve(path.join(B, f))] = { id: f, filename: f, loaded: true, exports: e }; };
  for (const k of Object.keys(require.cache)) if (/index_34_anomalias_tg/.test(k)) delete require.cache[k];
  stub("index_01_core", { bot: { sendMessage: async (c, t, o) => enviados.push({ t, kb: o?.reply_markup?.inline_keyboard || [] }) }, db, admin: { firestore: { FieldValue: { serverTimestamp: () => "ts" } } } });
  stub("index_02_utils_roles", { enviarTxtComoArchivo: async (c, t, n) => enviados.push({ t, archivo: n }), normalizarPlataforma: (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, ""), logErr: (a, e) => { throw e; } });
  stub("index_26_integrity_guard", { trashDocument: async ({ ref }) => { papelera.push(ref.id); store.delete(ref.path); return { trashId: `t_${ref.id}` }; }, makeWindowOperationKey: (a, b) => `${a}_${b.join("_")}` });
  stub("index_23_access_control", { hasPermission: async () => true });
  stub("index_03_clientes_crm", { humanPlataforma: (p) => ({ disneyp: "Disney Premium", disneys: "Disney Premium sin ESPN", hbomax: "HBO Max" }[p] || p), enviarFichaCliente: async (c, id) => enviados.push({ ficha: id }) });
  stub("index_04_inventario_correos", { enviarSubmenuInventario: async (c, p, a) => enviados.push({ cuenta: `${p}|${a}` }) });
  return { A: require(path.join(B, "index_34_anomalias_tg")), store, enviados, papelera };
}
const btn = (e, re) => e.kb.flat().find((b) => re.test(b.text));

test("R141: el reporte dice QUIÉN tiene el problema y deja pasar el servicio a la plataforma correcta", async () => {
  const { A, store, enviados } = cargar();
  store.set("clientes/c1", { nombre: "Ana López", servicios: [{ plataforma: "disneyp", correo: "pepito@sublicuentas.com", fechaRenovacion: "2026-11-01" }] });
  A.guardar(1, { otra: [{ plat: "disneyp", acceso: "pepito@sublicuentas.com", otras: ["disneys"], clientes: [{ clienteId: "c1", nombre: "Ana López", telefono: "99998888", servicioIndex: 0 }] }], sin: [], dup: [], cap: [] });
  assert.match(A.tecladoResumen({ otra: [1], sin: [], dup: [], cap: [] })[0][0].text, /OTRA plataforma \(1\)/);
  await A.callback(1, 7, "anom:l:otra:0");
  assert.match(enviados.at(-1).kb[0][0].text, /Ana López · Disney Premium/);
  await A.callback(1, 7, "anom:i:otra:0");
  const d = enviados.at(-1); assert.match(d.t, /1\. Ana López · 99998888/); assert.match(d.t, /existe en Bodega como: Disney Premium sin ESPN/);
  await A.callback(1, 7, btn(d, /Ver ficha/).callback_data); assert.equal(enviados.at(-1).ficha, "c1");
  await A.callback(1, 7, btn(d, /Pasar servicio a/).callback_data);
  await A.callback(1, 7, btn(enviados.at(-1), /Sí, pasarlo/).callback_data);
  assert.equal(store.get("clientes/c1").servicios[0].plataforma, "disneys");
  assert.equal(store.get("clientes/c1").servicios[0].fechaRenovacion, "2026-11-01", "lo demás queda igual");
  assert.ok([...store.values()].some((v) => v.accion === "corregir_plataforma_servicio"), "queda en auditoría");
});

test("R141: duplicado HBO — se ve cada documento con sus clientes y se puede unir o borrar (papelera)", async () => {
  const { A, store, enviados, papelera } = cargar();
  store.set("inventario/a", { plataforma: "hbomax", correo: "hondumusic05@gmail.com", capacidad: 4, clave: "gasparin25", clientes: [{ nombre: "Uno", perfilId: "p1" }, { nombre: "Dos", perfilId: "p2" }, { nombre: "Tres", perfilId: "p3" }] });
  store.set("inventario/b", { plataforma: "hbomax", correo: "hondumusic05@gmail.com", capacidad: 4, clave: "gasparin25", clientes: [{ nombre: "Tres", perfilId: "p3" }] });
  const kb = A.tecladoCoincidencias([{ id: "a", plataforma: "hbomax" }, { id: "b", plataforma: "hbomax" }], "hondumusic05@gmail.com");
  assert.match(kb[0][0].text, /HBOMAX · 2 duplicados — revisar/); assert.ok(Buffer.byteLength(kb[0][0].callback_data) <= 64);
  await A.callback(1, 7, kb[0][0].callback_data);
  const p = enviados.at(-1); assert.match(p.t, /Documento 1[\s\S]*3\/4 perfiles[\s\S]*• Uno[\s\S]*Documento 2[\s\S]*1\/4/);
  await A.callback(1, 7, btn(p, /Unir todo en el doc 1/).callback_data);
  assert.match(enviados.at(-1).t, /quedarían 3\/4 perfiles/, "el repetido (Tres) no se duplica");
  await A.callback(1, 7, btn(enviados.at(-1), /Sí, unir/).callback_data);
  assert.deepEqual(papelera, ["b"]); assert.equal(store.get("inventario/a").ocupados, 3); assert.equal(store.get("inventario/a").disponibles, 1);
  // Borrar un sobrante vacío
  store.set("inventario/c", { plataforma: "hbomax", correo: "x@y.com", capacidad: 4, clientes: [] }); store.set("inventario/d", { plataforma: "hbomax", correo: "x@y.com", capacidad: 4, clientes: [{ nombre: "Z" }] });
  const kb2 = A.tecladoCoincidencias([{ id: "c", plataforma: "hbomax" }, { id: "d", plataforma: "hbomax" }], "x@y.com");
  await A.callback(1, 7, kb2[0][0].callback_data);
  await A.callback(1, 7, btn(enviados.at(-1), /Borrar doc 1/).callback_data); assert.match(enviados.at(-1).t, /No tiene clientes/);
  await A.callback(1, 7, btn(enviados.at(-1), /Sí, borrar/).callback_data);
  assert.ok(papelera.includes("c")); assert.ok(store.get("inventario/d"));
});

test("R141: lista completa en .txt con nombres; /sincronizar_todo guarda el detalle y muestra los botones", async () => {
  const { A, enviados } = cargar();
  A.guardar(5, { otra: [], dup: [{ plat: "hbomax", acceso: "h@x.com", docIds: ["a", "b"] }], cap: [{ plat: "vix", acceso: "v@x.com", docId: "v", ocupados: 5, capacidad: 4, nombres: ["A", "B", "C", "D", "E"] }], sin: [{ plat: "canva", acceso: "m@x.com", clientes: [{ nombre: "Mélida", telefono: "3333" }] }] });
  await A.callback(5, 7, "anom:txt");
  const t = enviados.at(-1); assert.match(t.archivo, /anomalias_sincronizacion/); assert.match(t.t, /canva \| m@x\.com \| clientes: Mélida \(3333\)/); assert.match(t.t, /vix \| v@x\.com \| 5\/4 \| A; B; C; D; E/);
  const h = fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8");
  assert.match(h, /anomalias\.otra\.push\(\{ plat: e\.plat, acceso: e\.acceso, otras, clientes: clientesR141 \}\)/);
  assert.match(h, /A\.guardar\(chatId, anomalias\);/); assert.match(h, /inline_keyboard: A\.tecladoResumen\(anomalias\)/);
  assert.match(h, /if \(data\.startsWith\("anom:"\)\) return require\("\.\/index_34_anomalias_tg"\)\.callback/);
  assert.match(h, /tecladoCoincidencias\(hits, q\)/); assert.match(h, /tecladoCoincidencias\(invHits, q\)/);
});
