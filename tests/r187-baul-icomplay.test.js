"use strict";
// R187 · Fase 2 en el bot: ICOMPLAY (nombre oficial + 2 pantallas), Baúl de APKs y URLs de conexión. Datos ficticios.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { FakeDb } = require("./helpers/fake-firestore");
const B = path.join(__dirname, "..");

function cargar() {
  const db = new FakeDb(); const enviados = [];
  const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (/index_37_baul_apks|lib_baul_apks|lib_tv_digital/.test(k)) delete require.cache[k];
  stub("index_01_core", { db, bot: { sendMessage: async (chatId, text, opts) => { enviados.push({ chatId, text, opts }); } } });
  return { db, enviados, M: require("../index_37_baul_apks") };
}
const q = (data, id = 7) => ({ data, from: { id, username: "prueba" }, message: { chat: { id } } });

test("libs del bot = copia fiel de Sublichat HQ (mismo código salvo la 1.ª línea)", () => {
  const hq = path.join(B, "..", "hq-gh", "api");
  for (const [bot, h] of [["lib_baul_apks.js", "_baul-apks.js"], ["lib_planes_tv.js", "_planes-tv.js"], ["lib_tv_digital.js", "_tv-digital.js"]]) {
    if (!fs.existsSync(path.join(hq, h))) continue; // fuera del espacio de trabajo: se omite
    const a = fs.readFileSync(path.join(B, bot), "utf8").split("\n").slice(1).join("\n");
    const b = fs.readFileSync(path.join(hq, h), "utf8").split("\n").slice(1).join("\n");
    assert.equal(a, b, bot);
  }
});

test("ICOMPLAY: nombre oficial (sin «MAX»), 2 pantallas existe y tarifa 2×3 = L599", () => {
  const P = require("../lib_planes_tv");
  assert.equal(P.variantes("icomplay").length, 20);
  assert.equal(P.BASE.icomplay[2][3], 599);
  for (const f of ["index_01_core.js", "index_02_utils_roles.js", "index_03_clientes_crm.js", "index_04_inventario_correos.js", "index_05_finanzas_menus.js", "index_06_handlers.js"]) {
    const s = fs.readFileSync(path.join(B, f), "utf8");
    assert.doesNotMatch(s, /"[^"]*ICOMPLAY MAX[^"]*"/, `${f} sin etiqueta ICOMPLAY MAX`);
  }
  assert.match(fs.readFileSync(path.join(B, "index_01_core.js"), "utf8"), /icomplay2:\s+\{ key: "icomplay2",\s+nombre: "ICOMPLAY \(2 pantallas\)".*capacidadDefault: 2/);
  assert.match(fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8"), /\/\^icomplay\(max\)\?\[12357\]\?\$\//);
  assert.match(fs.readFileSync(path.join(B, "index_02_utils_roles.js"), "utf8"), /"icomplay max 2": "icomplay2"/, "lo escrito antes («icomplay max») se sigue entendiendo");
});

test("permisos: consulta admin o Relojes/Geisell; editar solo admin (en el servidor, no ocultando botones)", async () => {
  const { M, enviados, db } = cargar();
  assert.equal(M.puedeVer({ vend: { nombre: "Relojes" } }), true);
  assert.equal(M.puedeVer({ vend: { nombre: "Heber" } }), false);
  assert.equal(M.puedeVer({ vend: { nombre: "Heber", permisos: { "baul-apks": true } } }), true);
  assert.equal(M.puedeEditar({ vend: { nombre: "Relojes" } }), false);
  await M.tryCallback(q("baul:a:0:subli-atv"), { vend: { nombre: "Relojes" } });
  assert.match(enviados.at(-1).text, /Solo administradores/);
  await M.tryCallback(q("baul:p:liontv"), { vend: { nombre: "Heber" } });
  assert.match(enviados.at(-1).text, /No tiene acceso/);
  assert.equal(db.store.col("auditoria_eventos").size, 0, "sin permiso no se escribe nada");
});

test("/baul: plataforma → dispositivo muestra URL y código exactos; el código no confirmado no se entrega", async () => {
  const { M, enviados } = cargar();
  assert.equal(await M.tryMensaje({ text: "/baul", chat: { id: 7 }, from: { id: 7 } }, { vend: { nombre: "Geisell" } }), true);
  assert.equal(enviados.at(-1).opts.reply_markup.inline_keyboard.flat().length, 6);
  await M.tryCallback(q("baul:d:oleada:fire_tv"), { vend: { nombre: "Geisell" } });
  assert.match(enviados.at(-1).text, /mgs_pro\.apk[\s\S]*1290332/);
  await M.tryCallback(q("baul:d:oleada:android_movil"), { vend: { nombre: "Geisell" } });
  assert.doesNotMatch(enviados.at(-1).text, /Código Downloader: <code>4221609|Código por confirmar/, "el código no confirmado no se entrega como código");
  await M.tryCallback(q("baul:d:stellatv:iphone"), { vend: { nombre: "Geisell" } });
  assert.match(enviados.at(-1).text, /sin enlaces/);
});

test("admin: editar enlace por mensaje, desactivar, eliminar con confirmación; todo auditado", async () => {
  const { M, enviados, db } = cargar();
  const ctx = { adminOk: true };
  await M.tryCallback(q("baul:e:stella-mov"), ctx);
  assert.equal(await M.tryMensaje({ text: "javascript:alert(1)", chat: { id: 7 }, from: { id: 7 } }, ctx), true);
  assert.match(enviados.at(-1).text, /URL inválida/);
  await M.tryMensaje({ text: "https://bit.ly/nuevo-stella | | Probado en Samsung", chat: { id: 7 }, from: { id: 7 } }, ctx);
  assert.match(enviados.at(-1).text, /Enlace actualizado/);
  const B2 = require("../lib_baul_apks");
  let e = (await B2.leerBaul(db, { fresco: true })).enlaces.find((x) => x.id === "stella-mov");
  assert.deepEqual([e.url, e.nota, e.revision], ["https://bit.ly/nuevo-stella", "Probado en Samsung", 2]);
  await M.tryCallback(q("baul:xs:stella-mov"), ctx);
  assert.match(enviados.at(-1).text, /Primero desactívelo/);
  await M.tryCallback(q("baul:a:0:stella-mov"), ctx);
  await M.tryCallback(q("baul:xs:stella-mov"), ctx);
  assert.equal((await B2.leerBaul(db, { fresco: true })).enlaces.some((x) => x.id === "stella-mov"), false);
  const aud = [...db.store.col("auditoria_eventos").values()];
  assert.deepEqual(aud.map((a) => a.accion), ["editar_enlace", "desactivar_enlace", "eliminar_enlace"]);
  assert.ok(aud.every((a) => /^tg:7(@prueba)?$/.test(a.usuario)));
});

test("/urltv: desactivar no rompe clientes; nueva → desactivar → eliminar; base no se elimina", async () => {
  const { M, enviados, db } = cargar();
  await db.collection("clientes").doc("c1").set({ servicios: [{ plataforma: "icomplay2", iptvProveedor: "icomplay" }] });
  const ctx = { adminOk: true };
  await M.tryMensaje({ text: "/urltv_nueva latin3 | LatinTV 3 | http://nuevo.latin.hn:8080", chat: { id: 7 }, from: { id: 7 } }, ctx);
  assert.match(enviados.at(-1).text, /agregada/);
  await M.tryCallback(q("baul:ua:0:icomplay"), ctx);
  assert.match(enviados.at(-1).text, /no se tocan/);
  const T = require("../lib_tv_digital");
  const urls = await T.leerUrlsTv(db, { fresco: true });
  assert.equal(T.urlTvPara({ plataforma: "icomplay2" }, urls), "http://latinostream.xyz:80");
  await M.tryCallback(q("baul:ux:icomplay"), ctx);
  assert.match(enviados.at(-1).text, /Clientes asignados: 1/);
  assert.equal(enviados.at(-1).opts.reply_markup.inline_keyboard.length, 0, "con clientes no ofrece eliminar");
  await M.tryCallback(q("baul:uxs:latin3"), ctx);
  assert.match(enviados.at(-1).text, /Primero desactívela/);
  await M.tryCallback(q("baul:ua:0:latin3"), ctx);
  await M.tryCallback(q("baul:uxs:latin3"), ctx);
  assert.equal((await T.leerUrlsTv(db, { fresco: true })).latin3, undefined);
  await M.tryMensaje({ text: "/urltv", chat: { id: 7 }, from: { id: 7 } }, { vend: { nombre: "Relojes" } });
  assert.doesNotMatch(enviados.at(-1).text, /urltv_nueva/, "vendedor solo consulta");
});

test("cableado en index_06: callback «baul:» y mensajes /baul, /urltv", () => {
  const s = fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8");
  assert.match(s, /data\.startsWith\("baul:"\)\) \{ await require\("\.\/index_37_baul_apks"\)\.tryCallback\(q,\{adminOk,superOk,vend\}\)/);
  assert.match(s, /require\("\.\/index_37_baul_apks"\)\.tryMensaje\(msg,\{adminOk,superOk,vend\}\)/);
});
