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

test("S04 por bot: «Vincular existente» encuentra la ficha, pide familia y confirma sin duplicar", async () => {
  const { M, S, db, enviados } = cargar();
  await db.collection("clientes").doc("ana").set({ nombre: "Ana", servicios: [{ compraId: "c1", plataforma: "spotify", correo: "cuenta02@ejemplo.com" }] });
  const f = await S.crearFamilia(db, { madreCorreo: "principal@ejemplo.com" });
  const ctx = { vend: { nombre: "Relojes" } };
  assert.equal(await M.tryMensaje(m("/spotifyf"), ctx), true);
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["➕ Añadir cuenta", "📥 Añadir varias", "👤 Agregar invitado a una cuenta", "🔍 Ver cuentas"]); // R196
  await M.tryCallback(q("spf:v"), ctx); // R196b · «Vincular existente» = elegir cuenta y luego la ficha de la lista
  assert.equal(botones(enviados.at(-1))[0].callback_data, `spf:f:a:${f.id}`);
  await M.tryCallback(q(`spf:f:a:${f.id}`), ctx);
  const op = botones(enviados.at(-1))[0]; assert.match(op.text, /cuenta02@ejemplo\.com · Ana/);
  await M.tryCallback(q(op.callback_data), ctx);
  assert.match(enviados.at(-1).text, /Vinculada la ficha de Ana · SP-001 1\/5/);
  const cliente = (await db.collection("clientes").doc("ana").get()).data();
  assert.equal(cliente.servicios.length, 1); assert.equal(cliente.servicios[0].spotifyFamiliaCodigo, "SP-001");
  assert.deepEqual(botones(enviados.at(-1)).map((x) => x.text), ["✍️ Escribir correo(s)", "🔎 Buscar", "✅ Listo"], "ya no se ofrece de nuevo; escribir va aparte");
});

test("permisos: un vendedor sin módulo no ve ni escribe; sexto invitado bloqueado también por bot", async () => {
  const { M, S, db, enviados } = cargar();
  await M.tryMensaje(m("/spotifyf"), { vend: { nombre: "Heber" } });
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

// ---------------------------------------------------------------- R196b · /spotifyf, una cuenta por línea, elegir ficha
test("R196b · /spotifyf abre Spotify Familiar; /spotify NO (queda para el inventario)", async () => {
  const { M, enviados } = cargar();
  assert.equal(await M.tryMensaje(m("/spotify"), { adminOk: true }), false);
  assert.equal(enviados.length, 0);
  assert.equal(await M.tryMensaje(m("/spotifyf"), { adminOk: true }), true);
  assert.match(enviados.at(-1).text, /Spotify Familiar/);
});

test("R196b/c · parser: en «varias» cada línea es una cuenta (con su clave al lado); en «una» los de abajo son invitados", () => {
  const { M } = cargar();
  const v = M.parsearCuentas("sandyc@ejemplo.com\nmusic4@ejemplo.com clave123\n\njonny@ejemplo.com\nmadre4@ejemplo.com: inv1@ejemplo.com, inv2@ejemplo.com", "b");
  assert.deepEqual(v.cuentas.map((c) => [c.madre, c.clave, c.invitados]), [["sandyc@ejemplo.com", "", []], ["music4@ejemplo.com", "clave123", []], ["jonny@ejemplo.com", "", []], ["madre4@ejemplo.com", "", ["inv1@ejemplo.com", "inv2@ejemplo.com"]]]);
  assert.equal(v.avisos.length, 0);
  const u = M.parsearCuentas("madre@ejemplo.com\ni1@ejemplo.com\n\ni2@ejemplo.com", "c");
  assert.deepEqual(u.cuentas.map((c) => [c.madre, c.invitados]), [["madre@ejemplo.com", ["i1@ejemplo.com", "i2@ejemplo.com"]]]);
});

test("R196b · Añadir varias: 3 líneas = 3 cuentas; revisión no escribe; Guardar una vez; doble toque no duplica", async () => {
  const { M, S, db, enviados } = cargar();
  await S.crearFamilia(db, { madreCorreo: "vieja@ejemplo.com" });
  const ctx = { vend: { nombre: "Relojes" } };
  await M.tryCallback(q("spf:b"), ctx);
  assert.match(enviados.at(-1).text, /correo madre por línea/);
  await M.tryMensaje(m("a1@ejemplo.com\na2@ejemplo.com\nvieja@ejemplo.com\na1@ejemplo.com"), ctx);
  const rev = enviados.at(-1);
  assert.match(rev.text, /2 cuenta\(s\) nueva\(s\) · 1 existente/);
  assert.match(rev.text, /4\) a1@ejemplo\.com<\/b> — ⛔ repetido/);
  assert.equal((await S.listarFamilias(db)).length, 1, "la revisión no escribe");
  const btn = botones(rev)[0]; assert.match(btn.text, /Guardar \(2 cuenta\(s\), 0 invitado\(s\)\)/);
  await M.tryCallback(q(btn.callback_data), ctx);
  assert.match(enviados.at(-1).text, /Guardado[\s\S]*2 cuenta\(s\) nueva\(s\)/);
  await M.tryCallback(q(btn.callback_data), ctx);
  assert.match(enviados.at(-1).text, /ya se guardó o venció/);
  assert.deepEqual((await S.listarFamilias(db)).map((f) => [f.madreCorreo, f.ocupados]), [["vieja@ejemplo.com", 0], ["a1@ejemplo.com", 0], ["a2@ejemplo.com", 0]]);
});

test("R196b · Agregar invitado: se ELIGE la ficha de una lista (sin escribir), busca por texto, no cambia cobro ni fecha", async () => {
  const { M, S, db, enviados } = cargar();
  await db.collection("clientes").doc("dani").set({ nombre: "Daniela Prueba", servicios: [{ compraId: "c1", plataforma: "Spotify", correo: "music4@ejemplo.com", fechaRenovacion: "04/12/2026", precio: 120 }] });
  await db.collection("clientes").doc("jony").set({ nombre: "Jony Prueba", servicios: [{ compraId: "c2", plataforma: "spotify", correo: "jony@ejemplo.com", fechaRenovacion: "01/12/2026", precio: 120 }] });
  await db.collection("clientes").doc("nf").set({ nombre: "Netflix Solo", servicios: [{ compraId: "c3", plataforma: "netflix", correo: "nf@ejemplo.com" }] });
  const f = await S.crearFamilia(db, { madreCorreo: "sandyc@ejemplo.com" });
  const ctx = { adminOk: true };
  await M.tryCallback(q(`spf:f:a:${f.id}`), ctx);
  let b = botones(enviados.at(-1));
  assert.deepEqual(b.map((x) => x.text), ["music4@ejemplo.com · Daniela Prueba", "jony@ejemplo.com · Jony Prueba", "✍️ Escribir correo(s)", "🔎 Buscar", "✅ Listo"], "solo fichas Spotify sin cuenta; escribir/buscar aparte");
  await M.tryCallback(q(b[0].callback_data), ctx);
  assert.match(enviados.at(-1).text, /Vinculada la ficha de Daniela Prueba · SP-001 1\/5[\s\S]*1\. music4@ejemplo\.com · Daniela Prueba[\s\S]*5\. — libre/);
  b = botones(enviados.at(-1)); assert.deepEqual(b.map((x) => x.text), ["jony@ejemplo.com · Jony Prueba", "✍️ Escribir correo(s)", "🔎 Buscar", "✅ Listo"]);
  assert.equal(await M.tryMensaje(m("Menu"), ctx), false, "la lista sola no captura texto");
  await M.tryCallback(q(`spf:f:a:${f.id}`), ctx);
  await M.tryCallback(q("spf:pe:b"), ctx); await M.tryMensaje(m("jon"), ctx);
  assert.equal(botones(enviados.at(-1))[0].text, "jony@ejemplo.com · Jony Prueba");
  await M.tryCallback(q("spf:pe:c"), ctx); await M.tryMensaje(m("nuevo@ejemplo.com"), ctx);
  assert.match(enviados.at(-1).text, /✅ nuevo@ejemplo\.com · sin ficha/);
  const dani = (await db.collection("clientes").doc("dani").get()).data().servicios[0];
  assert.deepEqual([dani.fechaRenovacion, dani.precio, dani.spotifyFamiliaCodigo], ["04/12/2026", 120, "SP-001"]);
  await M.tryCallback(q(`spf:f:l:${f.id}`), ctx);
  assert.match(enviados.at(-1).text, /Cuenta SP-001<\/b> · 2\/5/);
  assert.equal(await M.tryMensaje(m("hola"), ctx), false, "al tocar Listo ya no captura mensajes");
});

test("R196c · clave de la cuenta madre: se pega al añadir, no se muestra en la revisión, se borra el mensaje; Ver/Cambiar clave", async () => {
  const { M, S, db, enviados, borrados } = cargar();
  const ctx = { adminOk: true };
  await M.tryCallback(q("spf:b"), ctx);
  await M.tryMensaje(m("madre1@ejemplo.com Secreta#1\nmadre2@ejemplo.com"), ctx);
  const rev = enviados.at(-1);
  assert.doesNotMatch(rev.text, /Secreta/); assert.match(rev.text, /madre1@ejemplo\.com<\/b> — .*🔑 clave/);
  assert.equal(borrados.length, 1, "el mensaje con la clave se borra del chat");
  await M.tryCallback(q(botones(rev)[0].callback_data), ctx);
  assert.match(enviados.at(-1).text, /1 clave\(s\) guardada\(s\)/);
  const [f1] = await S.listarFamilias(db);
  assert.equal(f1.tieneClave, true); assert.equal(f1.madreClave, undefined, "la clave no sale en los listados");
  await M.tryCallback(q(`spf:f:l:${f1.id}`), ctx);
  assert.match(enviados.at(-1).text, /Clave: 🔒 guardada/); assert.doesNotMatch(enviados.at(-1).text, /Secreta/);
  await M.tryCallback(q(`spf:kv:${f1.id}`), ctx);
  assert.match(enviados.at(-1).text, /<code>Secreta#1<\/code>/);
  await M.tryCallback(q(`spf:kc:${f1.id}`), ctx); await M.tryMensaje(m("Nueva#2"), ctx);
  assert.match(enviados.at(-1).text, /Clave cambiada · SP-001 \(borré su mensaje\)/);
  assert.equal((await S.leerClaveMadre(db, f1.id)).madreClave, "Nueva#2");
});

test("R196c · editar correo madre conserva invitados y fichas; eliminar solo vacía; el correo se puede reutilizar", async () => {
  const { M, S, db, enviados } = cargar();
  await db.collection("clientes").doc("ana").set({ nombre: "Ana", servicios: [{ compraId: "c1", plataforma: "spotify", correo: "ana@ejemplo.com", fechaRenovacion: "04/12/2026", precio: 120 }] });
  const f = await S.crearFamilia(db, { madreCorreo: "vieja@ejemplo.com" });
  await S.vincularInvitado(db, { familiaId: f.id, correo: "ana@ejemplo.com", clienteId: "ana", compraId: "c1" });
  const ctx = { adminOk: true };
  await M.tryCallback(q(`spf:em:${f.id}`), ctx); await M.tryMensaje(m("nueva@ejemplo.com"), ctx);
  assert.match(enviados.at(-1).text, /vieja@ejemplo\.com → <b>nueva@ejemplo\.com<\/b>/);
  const l = await S.leerFamilia(db, f.id);
  assert.equal(l.madreCorreo, "nueva@ejemplo.com"); assert.equal(l.ocupados, 1);
  const sv = (await db.collection("clientes").doc("ana").get()).data().servicios[0];
  assert.deepEqual([sv.spotifyMadreCorreo, sv.fechaRenovacion, sv.precio], ["nueva@ejemplo.com", "04/12/2026", 120]);
  assert.equal((await S.resolverCorreo(db, "vieja@ejemplo.com")), null);
  await M.tryCallback(q(`spf:del:${f.id}`), ctx);
  assert.match(enviados.at(-1).text, /tiene 1 invitado\(s\)/);
  await S.desvincular(db, { correo: "ana@ejemplo.com" });
  await M.tryCallback(q(`spf:del:${f.id}`), ctx);
  await M.tryCallback(q(botones(enviados.at(-1))[0].callback_data), ctx);
  assert.match(enviados.at(-1).text, /Cuenta SP-001 eliminada/);
  assert.equal((await S.leerFamilia(db, f.id)).estado, "inactiva", "no se borra el documento");
  await M.tryCallback(q("spf:l"), ctx); assert.match(enviados.at(-1).text, /No hay cuentas familiares/);
  const g = await S.crearFamilia(db, { madreCorreo: "nueva@ejemplo.com" }); assert.equal(g.codigo, "SP-002");
});

test("R196d · Agregar invitado: varios correos sueltos de una vez (con y sin ficha); la ficha con el correo madre sale como cliente de la cuenta madre", async () => {
  const { M, S, db, enviados } = cargar();
  await db.collection("clientes").doc("alexey").set({ nombre: "Alexey Prueba", servicios: [{ compraId: "c7", plataforma: "Spotify", correo: "sandyc@ejemplo.com", fechaRenovacion: "25/11/2026", precio: 100 }] });
  await db.collection("clientes").doc("jony").set({ nombre: "Jony Prueba", servicios: [{ compraId: "c2", plataforma: "spotify", correo: "jony@ejemplo.com", fechaRenovacion: "01/12/2026" }] });
  const f = await S.crearFamilia(db, { madreCorreo: "sandyc@ejemplo.com" });
  const ctx = { adminOk: true };
  await M.tryCallback(q(`spf:f:a:${f.id}`), ctx);
  assert.deepEqual(botones(enviados.at(-1)).map((x) => x.text), ["jony@ejemplo.com · Jony Prueba", "✍️ Escribir correo(s)", "🔎 Buscar", "✅ Listo"], "la ficha del correo madre no se ofrece como invitado");
  await M.tryCallback(q("spf:pe:c"), ctx);
  await M.tryMensaje(m("suelto1@ejemplo.com\nJONY@ejemplo.com, suelto2@ejemplo.com\nsandyc@ejemplo.com"), ctx);
  const t = enviados.at(-1).text;
  assert.match(t, /✅ suelto1@ejemplo\.com · sin ficha/); assert.match(t, /✅ jony@ejemplo\.com · ficha de Jony Prueba/); assert.match(t, /✅ suelto2@ejemplo\.com/); assert.match(t, /⛔ sandyc@ejemplo\.com/);
  assert.equal((await S.leerFamilia(db, f.id)).ocupados, 3);
  await M.tryCallback(q(`spf:f:l:${f.id}`), ctx);
  assert.match(enviados.at(-1).text, /Cliente de la cuenta madre: Alexey Prueba · vence 25\/11\/2026/);
  const [p] = await S.panelFamilias(db, { hoy: "2026-11-08" });
  assert.equal(p.madreClientes[0].cliente, "Alexey Prueba"); assert.equal(p.ocupados, 3, "el cliente de la madre no ocupa espacio");
});

test("R196e · una cuenta eliminada ya no tapa la ficha que usaba ese correo", async () => {
  const { M, S, db, enviados } = cargar();
  await db.collection("clientes").doc("alexey").set({ nombre: "Alexey Prueba", servicios: [{ compraId: "c7", plataforma: "Spotify", correo: "sandyc@ejemplo.com" }] });
  const mala = await S.crearFamilia(db, { madreCorreo: "sandyc@ejemplo.com" });
  await S.eliminarCuenta(db, { familiaId: mala.id, confirmo: true });
  const f = await S.crearFamilia(db, { madreCorreo: "otra@ejemplo.com" });
  await M.tryCallback(q(`spf:f:a:${f.id}`), { adminOk: true });
  assert.equal(botones(enviados.at(-1))[0].text, "sandyc@ejemplo.com · Alexey Prueba");
});

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
  assert.match(fs.readFileSync(path.join(B, "index_04_inventario_correos.js"), "utf8"), /data\.origen === "spotify_familia" && data\.familiaId\) return require\("\.\/index_38_spotify_familias"\)\.verCuenta/);
  assert.match(fs.readFileSync(path.join(B, "index_03_clientes_crm.js"), "utf8"), /PLATAFORMAS_ALIAS_OCULTAS_LOCAL = new Set\(\[.*"spotifyfamiliar"\]\)/);
});
