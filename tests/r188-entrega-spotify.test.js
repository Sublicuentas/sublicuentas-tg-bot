"use strict";
// R188 · Bot: Fase 3 (modalidad de acceso, copia fiel de avisos) y Fase 4 (Spotify Familiar por Telegram). Datos ficticios.
// R196o · Los flujos de R196b–e (añadir varias, lista de fichas, Mover, Desvincular, clave/editar/eliminar en el chat) se quitaron
//   por orden del propietario; sus pruebas se reemplazan por tests/r196o-spotify-estricto.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { FakeDb } = require("./helpers/fake-firestore");
const B = path.join(__dirname, "..");

function cargar() {
  const db = new FakeDb(); const enviados = [];
  const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (/index_38_spotify|lib_spotify_familias/.test(k)) delete require.cache[k];
  const borrados = [];
  stub("index_01_core", { db, bot: { sendMessage: async (chatId, text, opts) => { enviados.push({ chatId, text, opts }); }, deleteMessage: async (chatId, id) => { borrados.push(id); } } });
  return { db, enviados, borrados, M: require("../index_38_spotify_familias"), S: require("../lib_spotify_familias") };
}
const q = (data) => ({ data, from: { id: 9, username: "op" }, message: { chat: { id: 9 } } });
let msgId = 100; const m = (text) => ({ text, message_id: ++msgId, chat: { id: 9 }, from: { id: 9, username: "op" } });
const botones = (e) => (e.opts?.reply_markup?.inline_keyboard || []).flat();

test("libs del bot = copia fiel de Sublichat HQ", () => {
  const hq = path.join(B, "..", "hq-gh", "api");
  for (const [b, h] of [["lib_entrega_plataforma.js", "_entrega-plataforma.js"], ["lib_spotify_familias.js", "_spotify-familias.js"]]) {
    if (!fs.existsSync(path.join(hq, h))) continue;
    assert.equal(fs.readFileSync(path.join(B, b), "utf8").split("\n").slice(1).join("\n"), fs.readFileSync(path.join(hq, h), "utf8").split("\n").slice(1).join("\n"), b);
  }
});

test("Fase 3: ChatGPT pide contraseña; Gemini/Duolingo solo con cuenta entregada; correo del cliente nunca guarda contraseña", () => {
  const E = require("../lib_entrega_plataforma");
  assert.equal(E.claveSegunModalidad("chatgpt", {}), true);
  assert.equal(E.claveSegunModalidad("gemini", {}), false);
  assert.equal(E.claveSegunModalidad("duolingo", { modalidadAcceso: "proveedor" }), true);
  assert.equal(E.claveSegunModalidad("netflix", {}), null);
  const core = fs.readFileSync(path.join(B, "index_01_core.js"), "utf8");
  assert.match(core, /chatgpt:\s+\{ key: "chatgpt",.*acceso: "correo_clave",.*requiereClave: true/);
  const crm = fs.readFileSync(path.join(B, "index_03_clientes_crm.js"), "utf8");
  assert.match(crm, /function requiereClaveLocal\(plataforma = "", servicio = null\)/);
  assert.match(crm, /clave: requiereClaveLocal\(plat, \{ \.\.\.anterior, \.\.\.servicio \}\)/);
});

test("cableado en index_06 y alta de ficha Spotify por bot asigna la familia", () => {
  const s = fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8");
  assert.match(s, /data\.startsWith\("spf:"\)\) \{ await require\("\.\/index_38_spotify_familias"\)\.tryCallback/);
  assert.match(s, /require\("\.\/index_38_spotify_familias"\)\.tryMensaje\(msg/);
  assert.match(fs.readFileSync(path.join(B, "index_03_clientes_crm.js"), "utf8"), /require\("\.\/lib_spotify_familias"\)\.asignarServicio\(db/);
});

// ---------------------------------------------------------------- R196b · /spotifyf, una cuenta por línea, elegir ficha

test("R196f · Bodega: /spotifyf deja las cuentas en inventario «spotifyfamiliar»; abrirla en Bodega lleva a la vista de la cuenta", async () => {
  const { M, S, db, enviados } = cargar();
  const f = await S.crearFamilia(db, { madreCorreo: "principal@ejemplo.com" });
  await db.collection("inventario").doc(S.idBodega(f.id)).delete(); // cuenta vieja sin reflejo
  await M.tryMensaje(m("/spotifyf"), { adminOk: true });
  const inv = (await db.collection("inventario").doc(S.idBodega(f.id)).get()).data();
  assert.deepEqual([inv.plataforma, inv.correo, inv.capacidad, inv.origen], ["spotifyfamiliar", "principal@ejemplo.com", 5, "spotify_familia"]);
  await M.verCuenta(9, f.id);
  assert.match(enviados.at(-1).text, /Cuenta SP-001/);
  const core = fs.readFileSync(path.join(B, "index_01_core.js"), "utf8");
  assert.match(core, /spotifyfamiliar: \{ key: "spotifyfamiliar", nombre: "Spotify Familiar", categoria: "musica",.*capacidadDefault: 5/);
  assert.match(fs.readFileSync(path.join(B, "index_04_inventario_correos.js"), "utf8"), /data\.origen === "spotify_familia" && data\.familiaId\) \{[^\n]*return require\("\.\/index_38_spotify_familias"\)\.verCuenta\(chatId, data\.familiaId, null, \{ adminOk: true, superOk \}\)/);
  assert.match(fs.readFileSync(path.join(B, "index_03_clientes_crm.js"), "utf8"), /PLATAFORMAS_ALIAS_OCULTAS_LOCAL = new Set\(\[.*"spotifyfamiliar"\]\)/);
});

test("R196g · nombre «Spotify Familiar» en los botones de Bodega; Bodega sincroniza al abrirla; Spotify en Bodega abre las familias (R196o)", () => {
  const crm = fs.readFileSync(path.join(B, "index_03_clientes_crm.js"), "utf8");
  assert.match(crm, /spotify:"Spotify", spotifyfamiliar:"Spotify Familiar"/);
  assert.match(crm, /PLATAFORMAS\[k\]\.nombre\) \|\| String\(key/);
  const inv = fs.readFileSync(path.join(B, "index_04_inventario_correos.js"), "utf8");
  assert.match(inv, /if \(plat === "spotifyfamiliar"\) \{ try \{ await require\("\.\/lib_spotify_familias"\)\.sincronizarTodo\(db\)/);
  assert.match(inv, /if \(plat === "spotify" \|\| plat === "spotifyfamiliar"\) return abrirSpotifyFamiliar\(chatId\); \/\/ R196o/); // R196o · Bodega › Spotify = familias
  for (const f of ["index_02_utils_roles.js", "index_06_handlers.js", "index_04_inventario_correos.js"]) assert.match(fs.readFileSync(path.join(B, f), "utf8"), /spotifyfamiliar: "Spotify Familiar"/, f);
});
