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
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["➕ Añadir cuenta", "📥 Añadir varias", "👤 Agregar invitado a una cuenta", "🔍 Ver cuentas"]); // R196
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
  assert.match(enviados.at(-1).text, /No hay cuentas con espacios libres/);
});

test("cableado en index_06 y alta de ficha Spotify por bot asigna la familia", () => {
  const s = fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8");
  assert.match(s, /data\.startsWith\("spf:"\)\) \{ await require\("\.\/index_38_spotify_familias"\)\.tryCallback/);
  assert.match(s, /require\("\.\/index_38_spotify_familias"\)\.tryMensaje\(msg/);
  assert.match(fs.readFileSync(path.join(B, "index_03_clientes_crm.js"), "utf8"), /require\("\.\/lib_spotify_familias"\)\.asignarServicio\(db/);
});

// ---------------------------------------------------------------- R196 · Añadir cuenta(s) en bloque
test("R196 · parser: bloques por línea en blanco, «madre: inv, inv» en una línea, contraseñas ignoradas y no repetidas", () => {
  const { M } = cargar();
  const r = M.parsearCuentas("Madre1@Gmail.com\ninv1@gmail.com\ninv2@gmail.com clave123\n\nmadre2@gmail.com: inv3@gmail.com, inv4@gmail.com\nmadre3@gmail.com:\ninv5@gmail.com");
  assert.deepEqual(r.cuentas.map((c) => [c.madre, c.invitados]), [["madre1@gmail.com", ["inv1@gmail.com", "inv2@gmail.com"]], ["madre2@gmail.com", ["inv3@gmail.com", "inv4@gmail.com"]], ["madre3@gmail.com", ["inv5@gmail.com"]]]);
  assert.equal(r.avisos.length, 1); assert.doesNotMatch(r.avisos.join(), /clave123/);
});

test("R196 · Añadir varias: revisión sin escribir → Guardar crea cuentas, vincula fichas, bloquea solo lo malo; doble toque no duplica", async () => {
  const { M, S, db, enviados } = cargar();
  await db.collection("clientes").doc("edu").set({ nombre: "Eduardo Prueba", servicios: [{ compraId: "c9", plataforma: "Spotify", correo: "musica02@ejemplo.com", fechaRenovacion: "04/12/2026", precio: 120 }] });
  const vieja = await S.crearFamilia(db, { madreCorreo: "vieja@ejemplo.com" });
  await S.vincularInvitado(db, { familiaId: vieja.id, correo: "ocupado@ejemplo.com" });
  const ctx = { vend: { nombre: "Relojes" } };
  await M.tryMensaje(m("/spotify"), ctx); await M.tryCallback(q("spf:b"), ctx);
  assert.match(enviados.at(-1).text, /línea en blanco/);
  const pegado = "nueva1@ejemplo.com\nmusica02@ejemplo.com\nlibre1@ejemplo.com\n\nvieja@ejemplo.com\nocupado@ejemplo.com\nextra@ejemplo.com\n\nnueva2@ejemplo.com: ocupado@ejemplo.com, malo@\n\nocupado@ejemplo.com";
  const antes = db._dump ? JSON.stringify(db._dump()) : null;
  await M.tryMensaje(m(pegado), ctx);
  const rev = enviados.at(-1);
  assert.match(rev.text, /Revisión antes de guardar/);
  assert.match(rev.text, /musica02@ejemplo\.com · ficha de Eduardo Prueba/);
  assert.match(rev.text, /ya existe SP-001 · 1 → 2\/5/);
  assert.match(rev.text, /ocupado@ejemplo\.com · ya estaba en esta cuenta/);
  assert.match(rev.text, /4\) ocupado@ejemplo\.com<\/b> — ⛔ repetido/);
  assert.match(rev.text, /se ignoró texto que no es correo/);
  assert.equal((await S.listarFamilias(db)).length, 1, "la revisión no escribe nada");
  const btn = botones(rev)[0]; assert.match(btn.text, /Guardar \(2 cuenta\(s\), 3 invitado\(s\)\)/);
  await M.tryCallback(q(btn.callback_data), ctx);
  assert.match(enviados.at(-1).text, /Guardado[\s\S]*2 cuenta\(s\) nueva\(s\) · 3 invitado\(s\) · 1 ficha\(s\) vinculada\(s\)/);
  const fs = await S.listarFamilias(db);
  assert.deepEqual(fs.map((f) => [f.madreCorreo, f.ocupados]), [["vieja@ejemplo.com", 2], ["nueva1@ejemplo.com", 2], ["nueva2@ejemplo.com", 0]]);
  const edu = (await db.collection("clientes").doc("edu").get()).data().servicios;
  assert.equal(edu.length, 1); assert.deepEqual([edu[0].fechaRenovacion, edu[0].precio, edu[0].spotifyFamiliaCodigo], ["04/12/2026", 120, "SP-002"], "no cambia cobro ni fecha; queda vinculada");
  await M.tryCallback(q(btn.callback_data), ctx);
  assert.match(enviados.at(-1).text, /ya se guardó o venció/);
  assert.equal((await S.listarFamilias(db)).length, 3, "doble toque no duplica");
  // volver a pegar lo mismo: nada nuevo que guardar
  await M.tryCallback(q("spf:b"), ctx); await M.tryMensaje(m("nueva1@ejemplo.com\nmusica02@ejemplo.com\nlibre1@ejemplo.com"), ctx);
  assert.match(enviados.at(-1).text, /No hay nada nuevo para guardar/);
});

test("R196 · Añadir cuenta: sexto invitado y madre repetida se bloquean; Ver cuentas muestra 5 renglones", async () => {
  const { M, S, enviados } = cargar();
  const ctx = { adminOk: true };
  await M.tryCallback(q("spf:c"), ctx);
  await M.tryMensaje(m(["madre@ejemplo.com", ...[1, 2, 3, 4, 5, 6].map((i) => `i${i}@ejemplo.com`)].join("\n")), ctx);
  assert.match(enviados.at(-1).text, /trae 6 invitados \(máx\. 5\)/);
  assert.equal(botones(enviados.at(-1)).length, 1, "solo Cancelar");
  await M.tryMensaje(m("madre@ejemplo.com\ni1@ejemplo.com\ni2@ejemplo.com"), ctx);
  await M.tryCallback(q(botones(enviados.at(-1))[0].callback_data), ctx);
    await M.tryCallback(q("spf:l"), ctx);
  const cb = botones(enviados.at(-1))[0].callback_data; await M.tryCallback(q(cb), ctx);
  assert.match(enviados.at(-1).text, /Cuenta SP-001<\/b> · 2\/5[\s\S]*1\. i1@ejemplo\.com[\s\S]*3\. — libre[\s\S]*5\. — libre/);
});
