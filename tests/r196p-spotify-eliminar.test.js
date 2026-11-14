"use strict";
// R196p · PDF «Spotify · eliminar correos y Control Maestro» (13/11/2026) — pruebas del BOT con el módulo real y Firestore en
// memoria. Datos ficticios. Con CAP_OUT=<carpeta> guarda la conversación (texto + botones) para las capturas.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { FakeDb } = require("./helpers/fake-firestore");
const B = path.join(__dirname, "..");

function cargar() {
  const db = new FakeDb(); const enviados = [];
  for (const k of Object.keys(require.cache)) if (/index_38_spotify|lib_spotify_familias/.test(k)) delete require.cache[k];
  require.cache[require.resolve(path.join(B, "index_01_core"))] = { id: "c", filename: "c", loaded: true, exports: { db, bot: { sendMessage: async (chatId, text, opts) => { enviados.push({ chatId, text, opts }); } } } };
  return { db, enviados, M: require("../index_38_spotify_familias"), S: require("../lib_spotify_familias") };
}
const q = (data) => ({ data, from: { id: 9, username: "op" }, message: { chat: { id: 9 } } });
const botones = (e) => (e.opts?.reply_markup?.inline_keyboard || []).flat();
const SUBLI = { adminOk: true, superOk: true }, ADMIN = { adminOk: true, superOk: false }, RELOJES = { vend: { nombre: "Relojes" } };
const conv = []; const anotar = (de, x) => conv.push(typeof x === "string" ? { de, texto: x } : { de: "bot", texto: x.text, botones: (x.opts?.reply_markup?.inline_keyboard || []).map((r) => r.map((b) => b.text)) });

async function llena(db, S) { // SP-001 5/5 con fichas (cliente, venta e historial) + SP-002 2/5
  for (let n = 1; n <= 5; n++) await db.collection("clientes").doc(`c${n}`).set({ nombre: `Cliente ${n}`, historial: [{ tipo: "venta", monto: 90 }], servicios: [{ compraId: `sp-c${n}`, plataforma: "spotify", correo: `invitado${n}@ejemplo.test`, precio: 90, fechaRenovacion: "20/12/2026" }, { compraId: `nf-c${n}`, plataforma: "netflix", correo: "nf@ejemplo.test", precio: 150, fechaRenovacion: "20/12/2026" }] });
  const f = await S.crearFamilia(db, { madreCorreo: "madre1@ejemplo.test" });
  for (let n = 1; n <= 5; n++) await S.vincularInvitado(db, { familiaId: f.id, correo: `invitado${n}@ejemplo.test`, clienteId: `c${n}`, compraId: `sp-c${n}` });
  const g = await S.crearFamilia(db, { madreCorreo: "madre2@ejemplo.test" });
  for (const c of ["otro1@ejemplo.test", "otro2@ejemplo.test"]) await S.vincularInvitado(db, { familiaId: g.id, correo: c });
  return { f, g };
}

test("T01/T02/T03 · 5/5 muestra «Eliminar correo»; cancelar deja 5/5; confirmar → «Correo eliminado de SP-001. Espacios ocupados: 4/5»", async () => {
  const { M, S, db, enviados } = cargar(); const { f, g } = await llena(db, S);
  anotar("op", "[SP-001 · 5/5]"); await M.tryCallback(q(`spf:f:${f.id}`), SUBLI); anotar("bot", enviados.at(-1));
  assert.match(enviados.at(-1).text, /Invitados: 5\/5/);
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["🗑 Eliminar correo", "⬅️ Volver"]);
  // lista de ESA familia, del 1 al 5 (nada de otras fichas ni de SP-002)
  anotar("op", "[🗑 Eliminar correo]"); await M.tryCallback(q(`spf:e:${f.id}`), SUBLI); anotar("bot", enviados.at(-1));
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["1. invitado1@ejemplo.test", "2. invitado2@ejemplo.test", "3. invitado3@ejemplo.test", "4. invitado4@ejemplo.test", "5. invitado5@ejemplo.test", "✖️ Cancelar"]);
  // T02 · elegir y cancelar
  await M.tryCallback(q(`spf:ep:${f.id}:3`), SUBLI);
  assert.equal(enviados.at(-1).text, "¿Eliminar invitado3@ejemplo.test de la familia SP-001?");
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["✅ Confirmar", "✖️ Cancelar"]);
  await M.tryCallback(q(botones(enviados.at(-1))[1].callback_data), SUBLI);
  assert.match(enviados.at(-1).text, /Invitados: 5\/5/); assert.equal((await S.leerFamilia(db, f.id)).ocupados, 5);
  // T03 · elegir y confirmar
  anotar("op", "[5. invitado5@ejemplo.test]"); await M.tryCallback(q(`spf:ep:${f.id}:5`), SUBLI); anotar("bot", enviados.at(-1));
  const ok = botones(enviados.at(-1))[0].callback_data;
  anotar("op", "[✅ Confirmar]"); await M.tryCallback(q(ok), SUBLI); anotar("bot", enviados.at(-2)); anotar("bot", enviados.at(-1));
  assert.match(enviados.at(-2).text, /^✅ Correo eliminado de SP-001\. Espacios ocupados: 4\/5\nFalta quitarlo en la app de Spotify/);
  assert.match(enviados.at(-1).text, /Invitados: 4\/5[\s\S]*4\. invitado4@ejemplo\.test\n5\. — LIBRE/);
  assert.deepEqual(botones(enviados.at(-1)).map((b) => b.text), ["➕ Añadir correo invitado", "🗑 Eliminar correo", "⬅️ Volver"]);
  const fam = await S.leerFamilia(db, f.id);
  assert.equal(fam.ocupados, 4); assert.equal(fam.madreCorreo, "madre1@ejemplo.test");
  assert.deepEqual(fam.miembros.filter((m) => m.estado === "activo").map((m) => m.posicion), [1, 2, 3, 4], "los demás no se mueven");
  assert.equal((await S.leerFamilia(db, g.id)).ocupados, 2, "otra familia intacta");
  assert.equal((await db.collection("inventario").doc(S.idBodega(f.id)).get()).data().ocupados, 4, "Bodega igual");
  // doble toque de Confirmar: no descuenta dos veces
  await M.tryCallback(q(ok), SUBLI); assert.match(enviados.at(-1).text, /ya se hizo o venció/);
  assert.equal((await S.leerFamilia(db, f.id)).ocupados, 4);
  if (process.env.CAP_OUT) fs.writeFileSync(path.join(process.env.CAP_OUT, "conv-eliminar.json"), JSON.stringify(conv, null, 1));
});

test("T07/T08/T09/T12 · «No renovó» retira solo; ficha/venta/historial intactos; repetir o correo inexistente no descuenta; sin compras", async () => {
  const { S, db } = cargar(); const { f } = await llena(db, S);
  const r = await S.retirarPorBaja(db, { correo: "invitado2@ejemplo.test", clienteId: "c2", compraId: "sp-c2", motivo: "no_renovo" });
  assert.deepEqual([r.estado, r.ocupados], ["liberado", 4]);
  // eliminación manual
  const e = await S.eliminarCorreo(db, { familiaId: f.id, correo: "Invitado4@Ejemplo.test", usuario: "tg:9" });
  assert.deepEqual([e.codigo, e.ocupados, e.capacidad], ["SP-001", 3, 5]);
  // T09 · repetir y correo inexistente / ya retirado por «No renovó»
  for (const c of ["invitado4@ejemplo.test", "nadie@ejemplo.test", "invitado2@ejemplo.test"]) {
    const x = await S.eliminarCorreo(db, { familiaId: f.id, correo: c, usuario: "tg:9" });
    assert.equal(x.yaEstaba, true); assert.equal(x.ocupados, 3); assert.match(x.aviso, /no está en SP-001: no se cambió nada/);
  }
  assert.equal((await S.leerFamilia(db, f.id)).ocupados, 3);
  // T08 · cliente, ficha, venta e historial: solo se quita la marca de familia del servicio Spotify
  const c4 = (await db.collection("clientes").doc("c4").get()).data();
  assert.equal(c4.nombre, "Cliente 4"); assert.deepEqual(c4.historial, [{ tipo: "venta", monto: 90 }]);
  assert.deepEqual(c4.servicios.map((s) => [s.compraId, s.precio, s.fechaRenovacion]), [["sp-c4", 90, "20/12/2026"], ["nf-c4", 150, "20/12/2026"]]);
  assert.equal(c4.servicios[0].spotifyFamiliaCodigo, undefined);
  const raw = (await db.collection("spotify_familias").doc(f.id).get()).data();
  assert.equal(raw.miembros.find((m) => m.correo === "invitado4@ejemplo.test").desvinculadoMotivo, "manual", "queda en el historial");
  const aud = (await db.collection("auditoria_eventos").get()).docs.map((d) => d.data()).filter((a) => a.accion === "eliminar_correo");
  assert.equal(aud.length, 1); assert.equal(aud[0].usuario, "tg:9"); assert.doesNotMatch(JSON.stringify(aud), /clave|password/i);
  // T12 · sin compras ni ventas ficticias
  for (const col of ["fin_compras", "fin_ventas", "fin_movimientos", "ventas"]) assert.equal((await db.collection(col).get()).docs.length, 0, col);
});

test("T10/T11 · solo Sublicuentas elimina (también si se fuerza el botón); nunca 6 invitados; la madre no ocupa cupo", async () => {
  const { M, S, db, enviados } = cargar(); const { f } = await llena(db, S);
  await M.tryCallback(q(`spf:f:${f.id}`), ADMIN);
  assert.ok(!botones(enviados.at(-1)).some((b) => /Eliminar/.test(b.text)), "admin que no es Sublicuentas no ve el botón");
  for (const cb of [`spf:e:${f.id}`, `spf:ep:${f.id}:1`, "spf:eok:x"]) { await M.tryCallback(q(cb), ADMIN); assert.match(enviados.at(-1).text, /Solo Sublicuentas puede eliminar/); }
  await M.tryCallback(q(`spf:e:${f.id}`), RELOJES); assert.match(enviados.at(-1).text, /Solo Sublicuentas/);
  // armado por Sublicuentas pero confirmado por otro: se vuelve a verificar
  await M.tryCallback(q(`spf:ep:${f.id}:1`), SUBLI); const ok = botones(enviados.at(-1))[0].callback_data;
  await M.tryCallback(q(ok), ADMIN); assert.match(enviados.at(-1).text, /Solo Sublicuentas/);
  assert.equal((await S.leerFamilia(db, f.id)).ocupados, 5);
  // T11
  const fam = await S.leerFamilia(db, f.id);
  assert.deepEqual([fam.capacidad, fam.ocupados, fam.libres], [5, 5, 0]);
  assert.ok(!fam.miembros.some((m) => m.correo === "madre1@ejemplo.test"), "la madre no es un espacio");
  await assert.rejects(S.agregarPorCorreo(db, { familiaId: f.id, correo: "sexto@ejemplo.test" }), /llena \(5 de 5\)/);
  // (la concurrencia se prueba en Sublichat HQ: su Firestore de prueba simula los reintentos de transacción)
});
