"use strict";
// R196q · PDF «Cuenta completa · cambio de plataforma · Control Maestro» (14/11/2026) — pruebas del BOT con la librería real
// y Firestore en memoria (escrituras en bloque: si algo falla no se aplica nada). Datos ficticios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FakeDb } = require("./helpers/fake-firestore");
const L = require("../lib_cuenta_completa");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

async function escenario() {
  const db = new FakeDb();
  // Ana compró Netflix en 2025 como «perfil» (cuenta propia A, sola) + Disney compartido. Beto y Caro comparten la cuenta C.
  await db.collection("clientes").doc("ana").set({ nombrePerfil: "Ana Prueba", vendedor: "Relojes", servicios: [
    { compraId: "c-nf", plataforma: "netflix", correo: "cuenta-a@ejemplo.test", clave: "claveA", precio: 300, fechaRenovacion: "20/12/2026", vendedor: "Relojes", mesesContratados: 1, perfiles: [{ perfilId: "p1", nombre: "Ana Prueba", correo: "cuenta-a@ejemplo.test", pin: "1234", inventarioId: "inv-a" }] },
    { compraId: "c-dp", plataforma: "disneyp", correo: "disney@ejemplo.test", precio: 120, fechaRenovacion: "05/12/2026", vendedor: "Relojes", perfiles: [{ perfilId: "p2", nombre: "Ana Prueba", pin: "1111" }] },
  ] });
  await db.collection("clientes").doc("beto").set({ nombrePerfil: "Beto Prueba", servicios: [{ compraId: "c-beto", plataforma: "netflix", correo: "cuenta-c@ejemplo.test", precio: 150, fechaRenovacion: "01/12/2026", perfiles: [{ perfilId: "pb", nombre: "Beto Prueba", pin: "2222", inventarioId: "inv-c" }] }] });
  const inv = (id, correo, clientes, extra = {}) => db.collection("inventario").doc(id).set({ plataforma: "netflix", correo, clave: extra.clave ?? "claveX", capacidad: 5, clientes, ocupados: clientes.length, disponibles: 5 - clientes.length, estado: "activa", ...extra });
  await inv("inv-a", "cuenta-a@ejemplo.test", [{ nombre: "Ana Prueba", clienteId: "ana", compraId: "c-nf", perfilId: "p1", pin: "1234", slot: 1 }]);
  await inv("inv-b", "cuenta-b@ejemplo.test", []);
  await inv("inv-c", "cuenta-c@ejemplo.test", [{ nombre: "Beto Prueba", clienteId: "beto", compraId: "c-beto", perfilId: "pb", slot: 1 }, { nombre: "Caro Prueba", clienteId: "caro", compraId: "c-caro", slot: 2 }]);
  await inv("inv-d", "cuenta-d@ejemplo.test", [], { clave: "" });
  await inv("inv-e", "cuenta-e@ejemplo.test", [], { estado: "eliminada" });
  await db.collection("inventario").doc("inv-x").set({ plataforma: "disneyp", correo: "disney-libre@ejemplo.test", capacidad: 7, clientes: [] });
  return db;
}
const compra = async (db, cid = "ana", id = "c-nf") => ((await db.collection("clientes").doc(cid).get()).data().servicios || []).find((s) => s.compraId === id);
const invDoc = async (db, id) => (await db.collection("inventario").doc(id).get()).data();
const todo = async (db) => JSON.stringify([...db.store.cols.entries()].map(([k, m]) => [k, [...m.entries()]]));

test("T01/T02 · «Cambiar plataforma» ya ofrece 🔐 Cuentas completas y lista solo cuentas válidas de esa plataforma", async () => {
  assert.match(R("index_03_clientes_crm.js"), /const items = Object\.entries\(R118_CAT\)\.map\(/);
  assert.doesNotMatch(R("index_03_clientes_crm.js"), /code === "cc" && mode === "set"/);
  assert.match(R("index_06_handlers.js"), /if \(data\.startsWith\("ccsel:set:"\) \|\| data\.startsWith\("ccv:"\)\) \{[\s\S]{0,120}index_39_cuenta_completa"\)\.tryCallback/);
  // Perfiles, TV Digital, Música y Software siguen en el mismo selector
  for (const code of ["per", "tv", "mus", "sof", "cc"]) assert.match(R("index_03_clientes_crm.js"), new RegExp(`${code}: "`));
  const db = await escenario(); const s = await compra(db);
  const l = await L.cuentasElegibles(db, { plataforma: "netflix", compra: s, clienteId: "ana", titular: "Ana Prueba" });
  assert.deepEqual(l.map((x) => [x.id, x.esCuentaActual]), [["inv-a", true], ["inv-b", false], ["inv-d", false]], "sin la compartida (C), ni la dada de baja (E), ni Disney");
  assert.equal(l.find((x) => x.id === "inv-d").tieneClave, false);
  assert.deepEqual((await L.cuentasElegibles(db, { plataforma: "netflix", compra: s, clienteId: "ana", titular: "Ana Prueba", q: "cuenta-b" })).map((x) => x.id), ["inv-b"]);
  await assert.rejects(L.cuentasElegibles(db, { plataforma: "spotify", compra: s }), /no se vende como cuenta completa/);
});

test("T03/T07/T08/T09 · confirmar: MISMA compra cambia de tipo y cuenta; precio, fecha, vendedor y Disney intactos; sin Finanzas", async () => {
  const db = await escenario(); const antes = await compra(db); const disneyAntes = await compra(db, "ana", "c-dp");
  const r = await L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-b", usuario: "tg:9@op" });
  assert.deepEqual([r.antes.tipoVenta, r.despues.tipoVenta, r.despues.cuenta.correo], ["perfil", "cuenta_completa", "cuenta-b@ejemplo.test"]);
  const s = await compra(db);
  assert.equal(s.compraId, "c-nf");
  assert.deepEqual([s.tipoVenta, s.categoria, s.cuentaInventarioId, s.correo, s.clave, s.sinPinPerfil], ["cuenta_completa", "cuentas_completas", "inv-b", "cuenta-b@ejemplo.test", "claveX", true]);
  assert.deepEqual([s.precio, s.fechaRenovacion, s.vendedor, s.mesesContratados], [antes.precio, antes.fechaRenovacion, antes.vendedor, antes.mesesContratados]);
  assert.equal(s.perfiles.length, 1); assert.equal(s.perfiles[0].perfilId, "p1"); assert.equal(s.perfiles[0].pin, undefined);
  assert.equal(s.modalidadAnterior.tipoVenta, "perfil"); assert.equal(s.modalidadAnterior.perfiles[0].pin, "1234", "lo histórico del perfil se conserva");
  assert.deepEqual(Object.keys(s.historialModalidad[0]).sort(), ["a", "at", "cuentaAntes", "cuentaAntesCorreo", "cuentaNueva", "cuentaNuevaCorreo", "de", "plataformaAntes", "plataformaNueva", "por"].sort());
  assert.deepEqual([s.historialModalidad[0].de, s.historialModalidad[0].cuentaAntes, s.historialModalidad[0].cuentaNueva, s.historialModalidad[0].por], ["perfil", "inv-a", "inv-b", "tg:9@op"]);
  assert.doesNotMatch(JSON.stringify(s.historialModalidad), /clave/i);
  assert.deepEqual(await compra(db, "ana", "c-dp"), disneyAntes, "la otra compra no cambia");
  assert.equal((await db.collection("clientes").doc("ana").get()).data().servicios.length, 2, "no se duplica la compra");
  // Bodega: A suelta solo a Ana; B queda exclusiva con un ocupante
  const a = await invDoc(db, "inv-a"), b = await invDoc(db, "inv-b");
  assert.deepEqual([a.clientes.length, a.ocupados, a.disponibles, a.estado], [0, 0, 5, "activa"]);
  assert.deepEqual([b.clientes.length, b.clientes[0].compraId, b.exclusivaCompraId, b.modalidadVenta, b.disponibles, b.estado], [1, "c-nf", "c-nf", "cuenta_completa", 0, "llena"]);
  for (const col of ["finanzas_movimientos", "fin_ventas", "fin_movimientos", "ventas", "pagos"]) assert.equal((await db.collection(col).get()).docs.length, 0, col);
  // repetir: no hace nada
  const otra = await L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-b" });
  assert.equal(otra.yaEstaba, true); assert.equal((await compra(db)).historialModalidad.length, 1);
});

test("T03b · convertir sobre su MISMA cuenta (la vendida como perfil): queda exclusiva, sin otra cuenta", async () => {
  const db = await escenario();
  await L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-a" });
  const s = await compra(db), a = await invDoc(db, "inv-a");
  assert.deepEqual([s.cuentaInventarioId, s.correo, s.clave], ["inv-a", "cuenta-a@ejemplo.test", "claveX"]);
  assert.deepEqual([a.clientes.length, a.exclusivaCompraId], [1, "c-nf"]);
  assert.equal((await db.collection("inventario").get()).docs.length, 6, "no se crea ninguna cuenta");
});

test("T06/T10 · cuenta con perfiles de otros clientes: bloqueada y nadie sale; Beto sigue como perfil compartido", async () => {
  const db = await escenario(); const antes = await todo(db);
  await assert.rejects(L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-c" }), /tiene 2 perfil\(es\) de otros clientes: no puede ser exclusiva/);
  assert.equal(await todo(db), antes, "nada cambió");
  assert.deepEqual(L.etiquetaModalidad(await compra(db, "beto", "c-beto")), { codigo: "perfil", texto: "PERFIL" });
  // otra compra no puede tomar una cuenta que ya es exclusiva
  await L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-b" });
  await assert.rejects(L.convertir(db, { clientId: "beto", compraId: "c-beto", plataforma: "netflix", inventarioId: "inv-b" }), /ya es cuenta completa de otra compra/);
});

test("T11 · error o cancelación a mitad: no queda nada a medias (sin clave, cuenta de otra plataforma, sin cuenta elegida)", async () => {
  const db = await escenario(); const antes = await todo(db);
  await assert.rejects(L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-d" }), /Falta la clave/);
  await assert.rejects(L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-x" }), /otra plataforma/);
  await assert.rejects(L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "" }), /no se escoge ninguna sola/);
  await assert.rejects(L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-e" }), /dada de baja/);
  assert.equal(await todo(db), antes);
  // con la clave escrita sí
  await L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-d", clave: "nuevaClave" });
  assert.equal((await compra(db)).clave, "nuevaClave");
});

test("Corrección autorizada · si se eligió la cuenta equivocada, elegir otra libera la anterior (sin huérfanas ni dobles)", async () => {
  const db = await escenario();
  await L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-b" });
  await L.convertir(db, { clientId: "ana", compraId: "c-nf", plataforma: "netflix", inventarioId: "inv-d", clave: "claveD" });
  const b = await invDoc(db, "inv-b"), d = await invDoc(db, "inv-d"), s = await compra(db);
  assert.deepEqual([b.clientes.length, b.exclusivaCompraId, b.disponibles], [0, null, 5]);
  assert.deepEqual([d.clientes.length, d.exclusivaCompraId], [1, "c-nf"]);
  assert.deepEqual([s.cuentaInventarioId, s.historialModalidad.length, s.historialModalidad[1].de, s.historialModalidad[1].cuentaAntes], ["inv-d", 2, "cuenta_completa", "inv-b"]);
});

test("T04/T12 · ficha del bot: «CUENTA COMPLETA», no «1 perfil»; no suma a perfiles activos", () => {
  const crm = R("index_03_clientes_crm.js");
  assert.match(crm, /perfiles: rows\.filter\(\(s\) => !esCuentaCompletaLocal\(s\)\)\.reduce/);
  assert.match(crm, /cuentasCompletas: rows\.filter\(\(s\) => esCuentaCompletaLocal\(s\)\)\.length/);
  assert.match(crm, /const uso = esCuentaCompletaLocal\(s\) \/\/ R196q\n\s+\? `🔐 \*CUENTA COMPLETA\* · /);
  assert.match(crm, /esCuentaCompletaLocal\(s\) \? `🛒 \*Compra:\* cuenta completa · un solo precio\\n`/);
  assert.match(crm, /function esCuentaCompletaLocal\(s = \{\}\) \{ try \{ return require\("\.\/lib_catalogo_categorias"\)\.clasificarServicio\(s\)\.tipoVenta === "cuenta_completa"/);
  // el módulo del flujo: lista + búsqueda + vista previa + confirmar; usa la transacción de la ficha
  const m = R("index_39_cuenta_completa.js");
  assert.match(m, /\{ mutar: crm\(\)\.mutarServiciosClienteTx \}/);
  assert.match(m, /✅ Confirmar[\s\S]*✖️ Cancelar/); assert.match(m, /Es la misma compra: no se crea venta nueva/);
  assert.match(crm, /mutarServiciosClienteTx, \/\/ R196q/);
});

test("Flujo Telegram (módulo real index_39): categoría → plataforma → cuentas válidas → vista previa → Confirmar", async () => {
  const db = await escenario(); const panel = []; const pending = new Map(); const hist = [];
  const B = path.join(__dirname, "..");
  const stub = (f, exports) => { require.cache[require.resolve(path.join(B, f))] = { id: f, filename: f, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (/index_39_cuenta_completa/.test(k)) delete require.cache[k];
  stub("index_01_core", { db, cacheInvalidatePrefix: () => {} });
  stub("index_02_utils_roles", { pending, upsertPanel: async (chatId, text, kb) => { panel.push({ text, kb }); }, logErr: () => {} });
  stub("index_03_clientes_crm", {
    getCliente: async (id) => { const d = await db.collection("clientes").doc(id).get(); return d.exists ? { id, ...d.data() } : null; },
    humanPlataforma: (p) => ({ netflix: "Netflix", disneyp: "Disney+" }[p] || p),
    mutarServiciosClienteTx: undefined, registrarEventoHistorial: async (id, ev) => hist.push(ev),
    menuServicio: async () => panel.push({ text: "🧩 SERVICIO (menú de la compra)", kb: [] }),
  });
  const M = require("../index_39_cuenta_completa");
  const q = (data) => ({ data, from: { id: 9, username: "op" }, message: { chat: { id: 9 } } });
  const btn = (i = -1) => (panel.at(i).kb || []).flat();
  pending.set("9", { mode: "cliServSelectPlat", clientId: "ana", compraSel: "c-nf", compraId: "c-nf" }); // = «📌 Cambiar plataforma»
  await M.tryCallback(q("ccsel:set:netflix"));
  assert.match(panel.at(-1).text, /Cambiar a cuenta completa · Netflix[\s\S]*Compra actual: Netflix · PERFIL · L300 · vence 20\/12\/2026[\s\S]*Tipo de entrega: \*Cuenta completa\*/);
  assert.deepEqual(btn().map((b) => b.text), ["⭐ cuenta-a@ejemplo.test (la actual)", "cuenta-b@ejemplo.test", "cuenta-d@ejemplo.test", "🔎 Buscar por correo", "✖️ Cancelar"]);
  const lista = panel.at(-1);
  // búsqueda
  await M.tryCallback(q("ccv:q")); assert.equal(await M.tryMensaje({ chat: { id: 9 }, text: "cuenta-b" }), true);
  assert.deepEqual(btn().map((b) => b.text).slice(0, 1), ["cuenta-b@ejemplo.test"]);
  await M.tryCallback(q("ccv:c:0"));
  const previa = panel.at(-1);
  assert.match(previa.text, /Vista previa[\s\S]*\*Antes:\* Netflix · PERFIL · cuenta-a@ejemplo\.test · 1 perfil\(es\)[\s\S]*\*Después:\* Netflix · \*CUENTA COMPLETA\* · cuenta-b@ejemplo\.test[\s\S]*precio L300 · vence 20\/12\/2026 · vendedor Relojes[\s\S]*no se crea venta nueva/);
  assert.equal((await compra(db)).tipoVenta, undefined, "nada se guarda antes de Confirmar");
  const ok = btn().find((b) => b.text === "✅ Confirmar").callback_data;
  await M.tryCallback(q(ok));
  assert.match(panel.at(-2).text, /✅ Ahora es \*CUENTA COMPLETA\* · Netflix · cuenta-b@ejemplo\.test/);
  assert.equal((await compra(db)).cuentaInventarioId, "inv-b");
  assert.equal(hist.length, 1); assert.equal(hist[0].modalidadNueva, "cuenta_completa"); assert.doesNotMatch(JSON.stringify(hist), /claveX/);
  await M.tryCallback(q(ok)); assert.match(panel.at(-1).text, /venció/, "doble toque no repite");
  if (process.env.CAP_OUT) {
    const c = (p) => ({ de: "bot", texto: p.text.replace(/\*([^*]+)\*/g, "<b>$1</b>").replace(/_([^_]+)_/g, "<i>$1</i>").replace(/\\([_*`\[])/g, "$1"), botones: (p.kb || []).map((r) => r.map((b) => b.text)) });
    fs.writeFileSync(path.join(process.env.CAP_OUT, "conv-cc.json"), JSON.stringify([{ de: "op", texto: "📌 Cambiar plataforma → 🔐 Cuentas completas → Netflix" }, c(lista), { de: "op", texto: "🔎 cuenta-b → [cuenta-b@ejemplo.test]" }, c(previa), { de: "op", texto: "[✅ Confirmar]" }, c(panel.at(-3))], null, 1));
  }
});
