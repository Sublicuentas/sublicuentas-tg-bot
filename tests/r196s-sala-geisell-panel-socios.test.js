"use strict";
// R196s · Sala de Juntas: Geisell ya vinculó Telegram en el Panel de Socios → se reutiliza ese vínculo (verificado con getChat),
// sin variable nueva en Render/Vercel y sin asignar chats por parecido de nombre.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDb } = require("./helpers/fake-firestore");
const S = require("../lib_sala_juntas");

const bot = (bloqueados = []) => ({ getMe: async () => ({ username: "SublicuentasBot" }), getChat: async (id) => { if (bloqueados.includes(String(id))) { const e = new Error("ETELEGRAM: 403 Forbidden: bot was blocked by the user"); e.response = { statusCode: 403 }; throw e; } return { id }; } });
const env = { TELEGRAM_CHAT_ID_SUBLICUENTAS: "111", TELEGRAM_CHAT_ID_RELOJES: "222" };
const ahora = Date.parse("2026-11-14T19:00:00Z");

test("T-01 Geisell vinculada en el Panel de Socios → LISTO (fuente panel_socios), sin guardar el chat", async () => {
  const db = new FakeDb();
  await db.collection("revendedores").doc("rv1").set({ nombre: "Geisell", nombre_norm: "geisell", activo: true, telegramId: "333", telegramVinculo: { estado: "vinculado", metodo: "token" } });
  const r = await S.publicarEstado({ db, bot: bot(), env, ahora });
  assert.deepEqual(r.fundadoras, { naara: "listo", libni: "listo", geisell: "listo(panel_socios)" });
  const g = (await db.collection("sala_telegram").doc("geisell").get()).data();
  assert.deepEqual([g.estado, g.fuente], ["listo", "panel_socios"]);
  assert.equal(JSON.stringify(g).includes("333"), false, "no copia el chat id");
  assert.equal(await S.chatDeDb(db, "geisell", env), "333", "los avisos salen al mismo chat del Panel de Socios");
});

test("Desvinculada, inactiva, ambigua o sin vínculo → no se inventa nada (sigue pendiente)", async () => {
  for (const docs of [
    [{ nombre_norm: "geisell", telegramId: "333", telegramVinculo: { estado: "desvinculado" } }],
    [{ nombre_norm: "geisell", telegramId: "333", activo: false }],
    [{ nombre_norm: "geisell", telegramId: "333" }, { nombre_norm: "geissel", telegramId: "444" }],
    [{ nombre_norm: "geisell" }],
    [{ nombre_norm: "geisell maria", telegramId: "555" }],
  ]) {
    const db = new FakeDb();
    for (const [i, d] of docs.entries()) await db.collection("revendedores").doc(`rv${i}`).set(d);
    const r = await S.publicarEstado({ db, bot: bot(), env, ahora });
    assert.equal(r.fundadoras.geisell, undefined, JSON.stringify(docs));
    assert.equal((await db.collection("sala_telegram").doc("geisell").get()).exists, false);
    assert.equal(await S.chatDeDb(db, "geisell", env), "");
  }
});

test("El vínculo del panel solo aplica a la fundadora Geisell; Relojes y Sublicuentas siguen por variable", async () => {
  const db = new FakeDb();
  await db.collection("revendedores").doc("x").set({ nombre_norm: "relojes", telegramId: "999" });
  await db.collection("revendedores").doc("y").set({ nombre_norm: "otra socia", telegramId: "888" });
  assert.equal(await S.chatDeDb(db, "libni", {}), "");
  assert.equal(await S.chatDeDb(db, "otra.socia", {}), "");
  assert.equal(await S.chatDeDb(db, "naara", env), "111");
});

test("Si Geisell bloqueó el bot → BLOQUEADO (estado real), no LISTO", async () => {
  const db = new FakeDb();
  await db.collection("revendedores").doc("rv1").set({ nombre_norm: "geissel", telegramId: "333", telegramVinculo: { estado: "vinculado" } });
  const r = await S.publicarEstado({ db, bot: bot(["333"]), env, ahora });
  assert.equal(r.fundadoras.geisell, "bloqueado(panel_socios)");
});

test("T-02 Recordatorios: un aviso por persona y tipo; Geisell recibe con su chat del panel, sin duplicar", async () => {
  const db = new FakeDb();
  await db.collection("revendedores").doc("rv1").set({ nombre_norm: "geisell", telegramId: "333", telegramVinculo: { estado: "vinculado" } });
  const enviados = [];
  const b = { ...bot(), sendMessage: async (chat, txt) => { enviados.push(String(chat)); return { message_id: enviados.length }; } };
  await db.collection("sala_reuniones").doc("R1").set({ titulo: "Prueba", inicioMs: ahora + 3600e3, estado: "programada", version: 1, participantes: ["naara", "libni", "geisell"], anfitriona: "naara" });
  for (const u of ["libni", "geisell"]) await db.collection("sala_avisos").doc(`R1_${u}_h1_v1`).set({ reunionId: "R1", usuario: u, tipo: "h1", version: 1, programadoMs: ahora - 1000, estado: "pendiente", intentos: 0 });
  await S.procesarPendientes({ db, bot: b, env, ahora, log: { log() {}, error() {} } });
  await S.procesarPendientes({ db, bot: b, env, ahora: ahora + 60000, log: { log() {}, error() {} } });
  assert.deepEqual(enviados.sort(), ["222", "333"], "uno para Relojes, uno para Geisell, sin repetir");
});
