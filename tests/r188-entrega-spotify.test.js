"use strict";
// R188 · Bot: Fase 3 (modalidad de acceso, copia fiel de avisos) y Fase 4 (Spotify Familiar por Telegram). Datos ficticios.
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
  stub("index_01_core", { db, bot: { sendMessage: async (chatId, text, opts) => { enviados.push({ chatId, text, opts }); } } });
  return { db, enviados, M: require("../index_38_spotify_familias"), S: require("../lib_spotify_familias") };
}
const q = (data) => ({ data, from: { id: 9, username: "op" }, message: { chat: { id: 9 } } });
const m = (text) => ({ text, chat: { id: 9 }, from: { id: 9, username: "op" } });
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

test("S04 por bot: «Vincular existente» encuentra la ficha, pide familia y confirma sin duplicar", async () => {
  const { M, S, db, enviados } = cargar();
  await db.collection("clientes").doc("ana").set({ nombre: "Ana", servicios: [{ compraId: "c1", plataforma: "spotify", correo: "cuenta02@ejemplo.com" }] });
  const f = await S.crearFamilia(db, { madreCorreo: "principal@ejemplo.com" });
  const ctx = { vend: { nombre: "Relojes" } };
  assert.equal(await M.tryMensaje(m("/spotify"), ctx), true);
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["1. Crear familia", "2. Agregar invitado", "3. Vincular existente", "4. Consultar familia"]);
  await M.tryCallback(q("spf:v"), ctx);
  await M.tryMensaje(m("cuenta02@ejemplo.com"), ctx);
  assert.match(enviados.at(-1).text, /Ana/); assert.equal(botones(enviados.at(-1))[0].callback_data, `spf:vf:${f.id}`);
  await M.tryCallback(q(`spf:vf:${f.id}`), ctx);
  assert.match(enviados.at(-1).text, /SP-001[\s\S]*principal@ejemplo\.com[\s\S]*1 de 5/);
  await M.tryCallback(q("spf:ok"), ctx);
  assert.match(enviados.at(-1).text, /Confirmado[\s\S]*Ficha, Web y APK actualizadas/);
  const cliente = (await db.collection("clientes").doc("ana").get()).data();
  assert.equal(cliente.servicios.length, 1); assert.equal(cliente.servicios[0].spotifyFamiliaCodigo, "SP-001");
  await M.tryCallback(q("spf:v"), ctx); await M.tryMensaje(m("cuenta02@ejemplo.com"), ctx);
  assert.match(enviados.at(-1).text, /Familia encontrada: <b>SP-001<\/b>[\s\S]*Ya está vinculada/);
});

test("permisos: un vendedor sin módulo no ve ni escribe; sexto invitado bloqueado también por bot", async () => {
  const { M, S, db, enviados } = cargar();
  await M.tryMensaje(m("/spotify"), { vend: { nombre: "Heber" } });
  assert.match(enviados.at(-1).text, /No tiene acceso/);
  const f = await S.crearFamilia(db, { madreCorreo: "m@ejemplo.com" });
  for (let i = 1; i <= 5; i++) await S.vincularInvitado(db, { familiaId: f.id, correo: `i${i}@ejemplo.com` });
  const ctx = { adminOk: true };
  await M.tryCallback(q("spf:a"), ctx);
  assert.match(enviados.at(-1).text, /No hay familias con espacios libres/);
});

test("cableado en index_06 y alta de ficha Spotify por bot asigna la familia", () => {
  const s = fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8");
  assert.match(s, /data\.startsWith\("spf:"\)\) \{ await require\("\.\/index_38_spotify_familias"\)\.tryCallback/);
  assert.match(s, /require\("\.\/index_38_spotify_familias"\)\.tryMensaje\(msg/);
  assert.match(fs.readFileSync(path.join(B, "index_03_clientes_crm.js"), "utf8"), /require\("\.\/lib_spotify_familias"\)\.asignarServicio\(db/);
});
