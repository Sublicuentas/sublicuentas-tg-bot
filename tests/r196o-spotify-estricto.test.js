"use strict";
// R196o · PDF «Spotify Familiar · corrección estricta» (12/11/2026) — pruebas del BOT con el módulo real y Firestore en memoria.
// Datos ficticios. Con CAP_OUT=<carpeta> guarda la conversación (texto + botones) para las capturas.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { FakeDb } = require("./helpers/fake-firestore");
const B = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(B, f), "utf8");

function cargar() {
  const db = new FakeDb(); const enviados = [];
  const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (/index_38_spotify|lib_spotify_familias/.test(k)) delete require.cache[k];
  stub("index_01_core", { db, bot: { sendMessage: async (chatId, text, opts) => { enviados.push({ chatId, text, opts }); }, deleteMessage: async () => {} } });
  return { db, enviados, M: require("../index_38_spotify_familias"), S: require("../lib_spotify_familias") };
}
const q = (data) => ({ data, from: { id: 9, username: "op" }, message: { chat: { id: 9 } } });
let msgId = 100; const m = (text) => ({ text, message_id: ++msgId, chat: { id: 9 }, from: { id: 9, username: "op" } });
const botones = (e) => (e.opts?.reply_markup?.inline_keyboard || []).flat();
const SUBLI = { adminOk: true, superOk: true }, ADMIN = { adminOk: true, superOk: false }, RELOJES = { vend: { nombre: "Relojes" } };
const conversacion = [];
const anotar = (quien, x) => conversacion.push(typeof x === "string" ? { de: quien, texto: x } : { de: "bot", texto: x.text, botones: (x.opts?.reply_markup?.inline_keyboard || []).map((r) => r.map((b) => b.text)) });

// SP-001 con 4/5 invitados reales (como en la captura del PDF, con correos ficticios) y sus fichas.
async function escenario(db, S) {
  const fichas = { jony: "invitado1@ejemplo.test", olvin: "invitado2@ejemplo.test", karla: "invitado3@ejemplo.test", dereck: "invitado4@ejemplo.test" };
  for (const [id, correo] of Object.entries(fichas)) await db.collection("clientes").doc(id).set({ nombre: id[0].toUpperCase() + id.slice(1) + " Prueba", servicios: [{ compraId: `sp-${id}`, plataforma: "spotify", correo, precio: 90, fechaRenovacion: "20/12/2026" }, { compraId: `nf-${id}`, plataforma: "netflix", correo: "netflix@ejemplo.test", precio: 150, fechaRenovacion: "20/12/2026" }] });
  const f1 = await S.crearFamilia(db, { madreCorreo: "madre1@ejemplo.test" });
  for (const [id, correo] of Object.entries(fichas)) await S.vincularInvitado(db, { familiaId: f1.id, correo, clienteId: id, compraId: `sp-${id}` });
  const f2 = await S.crearFamilia(db, { madreCorreo: "madre2@ejemplo.test" });
  for (const c of ["otro1@ejemplo.test", "otro2@ejemplo.test", "otro3@ejemplo.test", "otro4@ejemplo.test"]) await S.vincularInvitado(db, { familiaId: f2.id, correo: c });
  return { f1, f2 };
}

test("T01/T02 · /spotify muestra las madres reales con 4/5 (ya no 0/0) y la cuenta con sus 4 correos", async () => {
  const { M, S, db, enviados } = cargar(); const { f1 } = await escenario(db, S);
  anotar("op", "/spotify"); assert.equal(await M.tryMensaje(m("/spotify"), SUBLI), true); anotar("bot", enviados.at(-1));
  const t = enviados.at(-1).text;
  assert.match(t, /Spotify Familiar · Familias/);
  assert.match(t, /SP-001 · 4\/5 ocupados · 1 libre/); assert.match(t, /SP-002 · 4\/5 ocupados · 1 libre/);
  assert.doesNotMatch(t, /Disponibles: 0|Llenas: 0/);
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["SP-001 · 4/5", "SP-002 · 4/5", "➕ Nueva familia"]);
  anotar("op", "[SP-001 · 4/5]"); await M.tryCallback(q(`spf:f:${f1.id}`), SUBLI); anotar("bot", enviados.at(-1));
  const v = enviados.at(-1).text;
  assert.match(v, /Cuenta SP-001/); assert.match(v, /Madre: madre1@ejemplo\.test/); assert.match(v, /Invitados: 4\/5/);
  for (const n of [1, 2, 3, 4]) assert.match(v, new RegExp(`${n}\\. invitado${n}@ejemplo\\.test`));
  assert.match(v, /5\. — LIBRE/);
  assert.doesNotMatch(v, /Clave|clave/);
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["➕ Añadir correo invitado", "🗑 Eliminar correo", "⬅️ Volver"]); // R196p
  // Bodega (inventario) refleja lo mismo: 4 ocupados
  const inv = (await db.collection("inventario").doc(S.idBodega(f1.id)).get()).data();
  assert.deepEqual([inv.ocupados, inv.disponibles], [4, 1]);
});

test("T03/T04 · añadir un correo escribiéndolo una vez → 5/5 en su fila; el 6.º se rechaza sin escribir nada", async () => {
  const { M, S, db, enviados } = cargar(); const { f1 } = await escenario(db, S);
  await db.collection("clientes").doc("eva").set({ nombre: "Eva Prueba", servicios: [{ compraId: "sp-eva", plataforma: "spotify", correo: "nuevo5@ejemplo.test", precio: 90, fechaRenovacion: "05/12/2026" }] });
  anotar("op", "[➕ Añadir correo invitado]"); await M.tryCallback(q(`spf:a:${f1.id}`), RELOJES); anotar("bot", enviados.at(-1));
  assert.match(enviados.at(-1).text, /Agregar correo · SP-001/); assert.match(enviados.at(-1).text, /Ingrese el correo del invitado/);
  anotar("op", "Nuevo5@Ejemplo.test"); await M.tryMensaje(m("Nuevo5@Ejemplo.test"), RELOJES); anotar("bot", enviados.at(-1));
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["✅ Guardar", "✖️ Cancelar"]);
  assert.equal((await S.leerFamilia(db, f1.id)).ocupados, 4, "no escribe antes de Guardar");
  const tok = botones(enviados.at(-1))[0].callback_data;
  anotar("op", "[✅ Guardar]"); await M.tryCallback(q(tok), RELOJES); anotar("bot", enviados.at(-2)); anotar("bot", enviados.at(-1));
  await M.tryCallback(q(tok), RELOJES); // doble toque
  const f = await S.leerFamilia(db, f1.id);
  assert.equal(f.ocupados, 5);
  assert.equal(f.miembros.filter((x) => x.estado === "activo" && x.correo === "nuevo5@ejemplo.test").length, 1);
  assert.equal(f.miembros.find((x) => x.correo === "nuevo5@ejemplo.test").clienteId, "eva", "se vinculó la única ficha con ese correo");
  assert.match(enviados.at(-2).text, /5\. nuevo5@ejemplo\.test/); assert.match(enviados.at(-3).text, /agregado a <b>SP-001<\/b> · 5\/5\nFicha: Eva Prueba/);
  assert.match(enviados.at(-1).text, /ya se guardó o venció/);
  const eva = (await db.collection("clientes").doc("eva").get()).data().servicios[0];
  assert.deepEqual([eva.spotifyFamiliaCodigo, eva.spotifyMadreCorreo, eva.precio, eva.fechaRenovacion], ["SP-001", "madre1@ejemplo.test", 90, "05/12/2026"]);
  // 6.º: la vista ya no ofrece añadir; aunque se fuerce el botón o la función, no escribe nada
  assert.deepEqual(botones(enviados.at(-2)).map((b) => b.text), ["⬅️ Volver"]);
  const antes = JSON.stringify((await db.collection("spotify_familias").doc(f1.id).get()).data());
  await M.tryCallback(q(`spf:a:${f1.id}`), RELOJES); anotar("op", "[➕ Añadir correo invitado] (forzado)"); anotar("bot", enviados.at(-1));
  assert.match(enviados.at(-1).text, /Cuenta llena \(5\/5\)/);
  await assert.rejects(S.agregarPorCorreo(db, { familiaId: f1.id, correo: "sexto@ejemplo.test" }), /llena \(5 de 5\): no se agregó nada/);
  assert.equal(JSON.stringify((await db.collection("spotify_familias").doc(f1.id).get()).data()), antes);
  assert.equal((await db.collection("spotify_indice").doc("sexto@ejemplo.test").get()).exists, false);
  if (process.env.CAP_OUT) fs.writeFileSync(path.join(process.env.CAP_OUT, "conversacion-bot.json"), JSON.stringify(conversacion, null, 1));
});

test("T05 · un correo que ya está en otra madre no se duplica: motivo legible", async () => {
  const { M, S, db, enviados } = cargar(); const { f2 } = await escenario(db, S);
  await M.tryCallback(q(`spf:a:${f2.id}`), SUBLI);
  await M.tryMensaje(m("invitado2@ejemplo.test"), SUBLI);
  assert.match(enviados.at(-1).text, /Ese correo ya está en SP-001\. Un correo solo puede estar en una cuenta\./);
  if (process.env.CAP_OUT) fs.writeFileSync(path.join(process.env.CAP_OUT, "conversacion-duplicado.json"), JSON.stringify([{ de: "op", texto: "invitado2@ejemplo.test" }, { de: "bot", texto: enviados.at(-1).text, botones: [["✖️ Cancelar"]] }], null, 1));
  await assert.rejects(S.vincularInvitado(db, { familiaId: f2.id, correo: "invitado2@ejemplo.test" }), /ya está como invitado en SP-001/);
  assert.equal((await S.leerFamilia(db, f2.id)).ocupados, 4);
  // correo inválido
  await M.tryMensaje(m("no-es-correo"), SUBLI);
  assert.match(enviados.at(-1).text, /no es un correo válido/);
});

test("T06/T07 · «No renovó» saca SOLO ese correo (5/5 → 4/5) y deja «Falta quitar en Spotify»; renovar no mueve ni duplica", async () => {
  const { M, S, db, enviados } = cargar(); const { f1 } = await escenario(db, S);
  await S.agregarPorCorreo(db, { familiaId: f1.id, correo: "nuevo5@ejemplo.test" });
  assert.equal((await S.leerFamilia(db, f1.id)).ocupados, 5);
  // T07 · renovar a Jony (la ficha se guarda otra vez): misma cuenta, mismo espacio, sin pedir madre
  const antes = (await S.leerFamilia(db, f1.id)).miembros.find((x) => x.correo === "invitado1@ejemplo.test");
  const r7 = await S.asignarServicio(db, { correo: "invitado1@ejemplo.test", clienteId: "jony", compraId: "sp-jony" });
  assert.deepEqual([r7.familia.codigo, r7.familia.madreCorreo, r7.requiereSeleccion], ["SP-001", "madre1@ejemplo.test", undefined]);
  const despues = (await S.leerFamilia(db, f1.id)).miembros.filter((x) => x.correo === "invitado1@ejemplo.test");
  assert.equal(despues.length, 1); assert.equal(despues[0].posicion, antes.posicion); assert.equal((await S.leerFamilia(db, f1.id)).ocupados, 5);
  // T06 · «No renovó» de Olvin (el servicio ya salió de la ficha)
  const cli = (await db.collection("clientes").doc("olvin").get()).data();
  await db.collection("clientes").doc("olvin").set({ ...cli, servicios: cli.servicios.filter((s) => s.compraId !== "sp-olvin") });
  const r6 = await S.retirarPorBaja(db, { correo: "invitado2@ejemplo.test", clienteId: "olvin", compraId: "sp-olvin", motivo: "no_renovo", usuario: "tg:9" });
  assert.deepEqual([r6.estado, r6.codigo, r6.ocupados, r6.retiroExternoPendiente], ["liberado", "SP-001", 4, true]);
  const f = await S.leerFamilia(db, f1.id);
  assert.equal(f.ocupados, 4);
  assert.deepEqual(f.miembros.filter((x) => x.estado === "activo").map((x) => x.correo).sort(), ["invitado1@ejemplo.test", "invitado3@ejemplo.test", "invitado4@ejemplo.test", "nuevo5@ejemplo.test"]);
  assert.equal((await S.resolverCorreo(db, "invitado2@ejemplo.test")), null, "relación activa borrada");
  const raw = (await db.collection("spotify_familias").doc(f1.id).get()).data();
  assert.equal(raw.miembros.find((x) => x.correo === "invitado2@ejemplo.test").desvinculadoMotivo, "no_renovo", "queda en el historial");
  assert.deepEqual(f.pendientesSpotify.map((p) => p.correo), ["invitado2@ejemplo.test"]);
  // repetir la baja no duplica nada
  const r6b = await S.retirarPorBaja(db, { correo: "invitado2@ejemplo.test", clienteId: "olvin", compraId: "sp-olvin" });
  assert.equal(r6b.yaEstaba, true); assert.equal((await S.leerFamilia(db, f1.id)).pendientesSpotify.length, 1);
  // ficha, Netflix e historial del cliente intactos
  const olvin = (await db.collection("clientes").doc("olvin").get()).data();
  assert.equal(olvin.nombre, "Olvin Prueba"); assert.deepEqual(olvin.servicios.map((s) => s.plataforma), ["netflix"]);
  // Bodega y vista del bot: 4/5 y el aviso
  assert.equal((await db.collection("inventario").doc(S.idBodega(f1.id)).get()).data().ocupados, 4);
  await M.verCuenta(9, f1.id);
  assert.match(enviados.at(-1).text, /Invitados: 4\/5/); assert.match(enviados.at(-1).text, /2\. — LIBRE/);
  assert.match(enviados.at(-1).text, /Falta quitar en la app de Spotify[\s\S]*invitado2@ejemplo\.test · No renovó/);
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["➕ Añadir correo invitado", "⬅️ Volver"]);
  if (process.env.CAP_OUT) fs.writeFileSync(path.join(process.env.CAP_OUT, "conversacion-no-renovo.json"), JSON.stringify([{ de: "op", texto: "[SP-001 · 4/5]  (después de «No renovó» en la ficha de Olvin)" }, { de: "bot", texto: enviados.at(-1).text, botones: [["➕ Añadir correo invitado"], ["⬅️ Volver"]] }], null, 1));
  // otra ficha con el mismo correo NO saca a quien sí paga
  const r = await S.retirarPorBaja(db, { correo: "invitado3@ejemplo.test", clienteId: "otra", compraId: "x" });
  assert.equal(r.omitido, "otra_ficha"); assert.equal((await S.leerFamilia(db, f1.id)).ocupados, 4);
  // si vuelve a la misma cuenta, ya no hay que quitarlo en Spotify
  await S.agregarPorCorreo(db, { familiaId: f1.id, correo: "invitado2@ejemplo.test" });
  assert.equal((await S.leerFamilia(db, f1.id)).pendientesSpotify.length, 0);
  // no hay retiro automático por fecha: el vencimiento solo no saca a nadie
  assert.doesNotMatch(R("lib_spotify_familias.js"), /vencid[oa][^\n]*retirarPorBaja|setInterval/);
});

test("T08 · la ficha del bot muestra el correo madre real (sin volver a elegirlo) y la compra nueva lo reconoce", () => {
  const crm = R("index_03_clientes_crm.js");
  assert.match(crm, /if \(\/spotify\/i\.test\(String\(s\.plataforma \|\| ""\)\) && s\.spotifyMadreCorreo\) txt \+= `🎵 \*Cuenta madre:\*/);
  assert.match(crm, /const spMadre = guardado && guardado\.spotifyFamilia \?/);
  assert.match(crm, /require\("\.\/lib_spotify_familias"\)\.asignarServicio\(db, \{ correo: compra\.correo/);
});

test("T09 · sin Mover, Desvincular, listas de fichas, clave ni «Añadir varias»; botones viejos no hacen nada", async () => {
  const { M, S, db, enviados } = cargar(); const { f1 } = await escenario(db, S);
  await M.tryMensaje(m("/spotifyf"), SUBLI); await M.tryCallback(q(`spf:f:${f1.id}`), SUBLI); await M.tryCallback(q(`spf:a:${f1.id}`), SUBLI);
  const todo = enviados.map((e) => e.text + " " + botones(e).map((b) => b.text).join(" ")).join("\n");
  assert.doesNotMatch(todo, /Mover|Desvincular|fichas Spotify sin cuenta|Ver clave|Guardar clave|Editar correo|Eliminar cuenta|Añadir varias|Buscar/);
  const fuente = R("index_38_spotify_familias.js");
  assert.doesNotMatch(fuente, /S\.moverInvitado|S\.desvincular|opcionesFichas|leerClaveMadre/);
  const antes = JSON.stringify((await db.collection("spotify_familias").doc(f1.id).get()).data());
  const mid = (await S.leerFamilia(db, f1.id)).miembros[0].id;
  for (const viejo of [`spf:mv:${mid}`, `spf:d:${mid}`, `spf:md:${f1.id}`, `spf:pi:0`, `spf:kv:${f1.id}`, `spf:delok:${f1.id}`]) await M.tryCallback(q(viejo), SUBLI);
  assert.match(enviados.at(-1).text, /Esa opción ya no existe/);
  assert.equal(JSON.stringify((await db.collection("spotify_familias").doc(f1.id).get()).data()), antes);
});

test("T11 · permisos en el bot: solo Sublicuentas crea madre; vendedor sin módulo no ve ni escribe", async () => {
  const { M, S, db, enviados } = cargar(); await escenario(db, S);
  await M.tryMensaje(m("/spotify"), ADMIN);
  assert.ok(!botones(enviados.at(-1)).some((b) => /Nueva familia/.test(b.text)), "admin que no es Sublicuentas no ve «Nueva familia»");
  await M.tryCallback(q("spf:n"), ADMIN); assert.match(enviados.at(-1).text, /Solo Sublicuentas puede crear cuentas madre/);
  await M.tryCallback(q("spf:c"), RELOJES); assert.match(enviados.at(-1).text, /Solo Sublicuentas/);
  // aunque arme el estado a mano y toque Guardar, el bot vuelve a verificar
  await M.tryCallback(q("spf:n"), SUBLI); await M.tryMensaje(m("madre3@ejemplo.test"), SUBLI);
  const tok = botones(enviados.at(-1))[0].callback_data;
  await M.tryCallback(q(tok), ADMIN); assert.match(enviados.at(-1).text, /Solo Sublicuentas/);
  assert.equal((await S.listarFamilias(db)).length, 2);
  await M.tryCallback(q("spf:n"), SUBLI); await M.tryMensaje(m("madre3@ejemplo.test"), SUBLI);
  await M.tryCallback(q(botones(enviados.at(-1))[0].callback_data), SUBLI);
  assert.deepEqual((await S.listarFamilias(db)).map((f) => f.codigo), ["SP-001", "SP-002", "SP-003"]);
  assert.match(enviados.at(-1).text, /Cuenta SP-003[\s\S]*Invitados: 0\/5/);
  // madre repetida
  await M.tryCallback(q("spf:n"), SUBLI); await M.tryMensaje(m("madre1@ejemplo.test"), SUBLI); assert.match(enviados.at(-1).text, /ya es la madre de SP-001/);
  // vendedor sin módulo
  const sinModulo = { vend: { nombre: "Otro", permisos: { "spotify-familias": false } } };
  assert.equal(await M.tryMensaje(m("/spotify"), sinModulo), true); assert.match(enviados.at(-1).text, /No tiene acceso/);
  assert.equal(await M.tryCallback(q("spf:a:x"), sinModulo), true); assert.match(enviados.at(-1).text, /No tiene acceso/);
});

test("cableado · /spotify ya no responde dos veces (0/0) y Bodega › Spotify abre las familias", () => {
  const h = R("index_06_handlers.js");
  assert.match(h, /if \(p === "spotify" \|\| p === "spotifyfamiliar"\) return; \/\/ R196o/);
  assert.match(h, /espacio liberado \(\$\{result\.spotifyRetiro\.ocupados\}/);
  assert.doesNotMatch(h, /Retiro en Spotify pendiente\*/);
  const inv = R("index_04_inventario_correos.js");
  assert.equal((inv.match(/if \(plat === "spotify" \|\| plat === "spotifyfamiliar"\) return abrirSpotifyFamiliar\(chatId\)/g) || []).length, 2);
});
