"use strict";
// R196i · Sala de Juntas: el bot publica su nombre y el estado verificado de las fundadoras (sin guardar chat ids).
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDb } = require("./helpers/fake-firestore");
const S = require("../lib_sala_juntas");

test("publica @bot y fundadoras verificadas con getChat; bloqueado si Telegram lo rechaza; nunca guarda el chat", async () => {
  const db = new FakeDb();
  const bot = { getMe: async () => ({ username: "SublicuentasBot" }), getChat: async (id) => { if (id === "222") { const e = new Error("ETELEGRAM: 403 Forbidden: bot was blocked by the user"); e.response = { statusCode: 403 }; throw e; } return { id }; } };
  const env = { TELEGRAM_CHAT_ID_SUBLICUENTAS: "111", TELEGRAM_CHAT_ID_RELOJES: "222" };
  const r = await S.publicarEstado({ db, bot, env, ahora: Date.parse("2026-11-11T20:00:00Z") });
  assert.equal(r.bot, "SublicuentasBot");
  assert.deepEqual(r.fundadoras, { naara: "listo", libni: "bloqueado" });
  assert.equal((await db.collection("sala_config").doc("telegram").get()).data().botUsername, "SublicuentasBot");
  const n = (await db.collection("sala_telegram").doc("naara").get()).data();
  assert.deepEqual([n.estado, n.fuente], ["listo", "render"]);
  assert.equal(JSON.stringify(n).includes("111"), false, "no guarda el chat id");
  assert.equal((await db.collection("sala_telegram").doc("geisell").get()).exists, false, "sin variable no se inventa estado");
});
