"use strict";
// R196u · /addextra (Bodega Netflix VIP) — flujo del bot con la librería real y Firestore en memoria. Datos ficticios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FakeDb } = require("./helpers/fake-firestore");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function cargar() {
  const db = new FakeDb(); const paneles = [], mensajes = [], borrados = [], archivos = [];
  const pending = new Map();
  const bot = { deleteMessage: async (c, id) => { borrados.push(id); return true; }, sendMessage: async (c, t) => { mensajes.push(t); return {}; } };
  const stub = (rel, exports) => { const f = require.resolve(path.join("..", rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub("index_01_core", { db, bot, cacheInvalidatePrefix() {} });
  stub("index_02_utils_roles", { pending, logErr() {}, upsertPanel: async (c, t, kb) => { paneles.push({ t, kb }); }, enviarTxtComoArchivo: async (c, t, n) => { archivos.push({ t, n }); } });
  delete require.cache[require.resolve("../index_40_bodega_vip")];
  const M = require("../index_40_bodega_vip");
  const msg = (text, id = 1) => ({ chat: { id: 9 }, message_id: id, text });
  const cb = (data) => ({ data, message: { chat: { id: 9 } }, from: { id: 1, username: "sublicuentas" } });
  const ultimo = () => paneles[paneles.length - 1];
  const boton = (re) => ultimo().kb.flat().find((b) => re.test(b.text)).callback_data;
  return { db, M, msg, cb, paneles, mensajes, borrados, archivos, ultimo, boton };
}
const SUPER = { adminOk: true, superOk: true };

test("lib_bodega_vip.js es copia fiel de HQ api/_bodega-vip.js (solo cambia la línea 1)", () => {
  const hq = path.join(__dirname, "..", "..", "hq-gh", "api", "_bodega-vip.js");
  if (!fs.existsSync(hq)) return; // en el repo del bot solo
  assert.equal(R("lib_bodega_vip.js").split("\n").slice(1).join("\n"), fs.readFileSync(hq, "utf8").split("\n").slice(1).join("\n"));
});

test("/addextra varias: proveedor → lote/costo → líneas → vista previa SIN claves → confirmar → resultado y archivo de fallas sin claves", async () => {
  const t = cargar();
  assert.equal(await t.M.tryMensaje(t.msg("/addextra"), SUPER), true);
  assert.match(t.ultimo().t, /NO es una venta/);
  await t.M.tryCallback(t.cb(t.boton(/Deku peruano/)), SUPER);
  await t.M.tryMensaje(t.msg("compra del día | 3.5 |"), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Añadir varias/)), SUPER);
  const lineas = ["demo.vip01@ejemplo.com claveUno1", "demo.vip02@ejemplo.com | claveDos2", "demo.vip02@ejemplo.com | claveDos2", "malo clave"].join("\n");
  await t.M.tryMensaje(t.msg(lineas, 77), SUPER);
  assert.deepEqual(t.borrados, [77], "borra el mensaje que trae claves");
  assert.match(t.mensajes.join(" "), /Borré su mensaje con las claves/);
  const prev = t.ultimo().t;
  assert.match(prev, /Total: \*4\*/); assert.match(prev, /Nuevas: \*2\*/); assert.match(prev, /Repetidas en el lote: \*1\*/); assert.match(prev, /Inválidas: \*1\*/);
  assert.doesNotMatch(prev, /claveUno1|claveDos2/);
  await t.M.tryCallback(t.cb(t.boton(/Confirmar 2/)), SUPER);
  assert.match(t.ultimo().t, /2 disponibles \/ 0 ya existentes \/ 2 errores/);
  assert.equal(t.archivos.length, 1); assert.doesNotMatch(t.archivos[0].t, /clave(Uno|Dos)/); assert.match(t.archivos[0].t, /repetido en el lote/);
  const inv = await t.db.collection("inventario").doc("vipnetflix__demo_vip01@ejemplo_com").get();
  assert.equal(inv.data().proveedor, "Deku peruano"); assert.equal(inv.data().costoUsdt, 3.5); assert.equal(inv.data().clave, "claveUno1");
});

test("/addextra una: correo → clave; reenviar el mismo acceso no lo duplica", async () => {
  const t = cargar();
  for (let i = 0; i < 2; i++) {
    await t.M.tryMensaje(t.msg("/addextra"), SUPER);
    await t.M.tryCallback(t.cb(t.boton(/Trap colombiano/)), SUPER);
    await t.M.tryCallback(t.cb(t.boton(/Omitir/)), SUPER);
    await t.M.tryCallback(t.cb(t.boton(/Añadir una/)), SUPER);
    await t.M.tryMensaje(t.msg("Uno.Solo@Ejemplo.com"), SUPER);
    await t.M.tryMensaje(t.msg("claveSecreta9", 50 + i), SUPER);
    if (i === 0) await t.M.tryCallback(t.cb(t.boton(/Confirmar 1/)), SUPER);
  }
  assert.match(t.ultimo().t, /Nuevas: \*0\*/); assert.match(t.ultimo().t, /Ya existentes: \*1\*/);
  assert.equal(t.ultimo().kb.flat().some((b) => /Confirmar/.test(b.text)), false, "sin nuevas no hay botón Confirmar");
});

test("ALL-02 · un admin que no es Sublicuentas no puede cargar lotes; doble toque de Confirmar = una sola carga", async () => {
  const t = cargar();
  await t.M.tryMensaje(t.msg("/addextra"), { adminOk: true, superOk: false });
  assert.match(t.ultimo().t, /solo para Sublicuentas/);
  await t.M.tryMensaje(t.msg("/addextra"), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Propio/)), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Omitir/)), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Añadir varias/)), SUPER);
  await t.M.tryMensaje(t.msg("x1@ejemplo.com clave111"), SUPER);
  const ok = t.boton(/Confirmar 1/);
  await t.M.tryCallback(t.cb(ok), { adminOk: true, superOk: false });
  assert.match(t.ultimo().t, /Solo Sublicuentas/);
  await t.M.tryCallback(t.cb(ok), SUPER); await t.M.tryCallback(t.cb(ok), SUPER);
  assert.match(t.ultimo().t, /venció|ya se hizo/);
  const snap = await t.db.collection("inventario").where("plataforma", "==", "vipnetflix").get();
  assert.equal(snap.docs.length, 1);
});

test("el bot enruta /addextra y vipx: al módulo, con superOk", () => {
  const h = R("index_06_handlers.js");
  assert.match(h, /if \(data\.startsWith\("vipx:"\)\) \{ await require\("\.\/index_40_bodega_vip"\)\.tryCallback\(q,\{adminOk,superOk\}\); return; \}/);
  assert.match(h, /if \(adminOk && await require\("\.\/index_40_bodega_vip"\)\.tryMensaje\(msg,\{adminOk,superOk\}\)\) return;/);
});
