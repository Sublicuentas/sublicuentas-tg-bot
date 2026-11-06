// R168 · Sala de Juntas · Telegram: avisos una sola vez, reprogramación/cancelación, RSVP solo del dueño del chat.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../lib_sala_juntas");
const { crearFakeDb } = require("./helpers/fake-firestore-sala");

const ENV = { TELEGRAM_CHAT_ID_SUBLICUENTAS: "100", TELEGRAM_CHAT_ID_RELOJES: "200", TELEGRAM_CHAT_ID_GEISELL: "300", SUBLICHAT_WEB_URL: "https://sublichat.capuchino.lat" };
const T0 = Date.UTC(2026, 10, 5, 18, 0); // 05/11 12:00 Honduras
const INICIO = Date.UTC(2026, 10, 10, 1, 0); // 09/11 7:00 p. m. Honduras
function botFalso() {
  const env = []; let n = 0;
  return { env, sendMessage: async (chat, texto, op) => { if (chat === "bloqueado") throw Object.assign(new Error("403 Forbidden: bot was blocked by the user"), { response: { statusCode: 403 } }); env.push({ chat, texto, op }); return { message_id: ++n }; },
    answerCallbackQuery: async (id, op) => { env.push({ answer: op && op.text }); }, editMessageReplyMarkup: async () => {} };
}
async function sembrar(db, extra = {}) {
  await db.collection("sala_reuniones").doc("reu123456").set({ titulo: "Revisión mensual", agenda: ["Ventas", "Campañas"], inicioMs: INICIO, estado: "programada", participantes: ["naara", "libni", "geisell"], version: 1, ...extra });
  for (const u of ["naara", "libni", "geisell"]) await db.collection("sala_invitaciones").doc(`reu123456_${u}`).set({ reunionId: "reu123456", usuario: u, estado: u === "naara" ? "aceptada" : "pendiente" });
  const av = (u, tipo, ms, v = 1) => db.collection("sala_avisos").doc(`reu123456_${u}_${tipo}_v${v}`).set({ reunionId: "reu123456", usuario: u, tipo, version: v, programadoMs: ms, estado: "pendiente", intentos: 0 });
  await av("libni", "invitacion", T0); await av("geisell", "invitacion", T0);
  await av("libni", "h24", INICIO - 24 * 3600e3); await av("libni", "m10", INICIO - 10 * 60e3);
}

test("invitación: una sola vez aunque corran dos instancias; texto con fecha de Honduras y botones", async () => {
  const db = crearFakeDb(), bot = botFalso(); await sembrar(db);
  const [a, b] = await Promise.all([S.procesarPendientes({ db, bot, env: ENV, ahora: T0 }), S.procesarPendientes({ db, bot, env: ENV, ahora: T0 })]);
  assert.equal(a.enviados + b.enviados, 2);
  assert.deepEqual(bot.env.map((x) => x.chat).sort(), ["200", "300"]);
  const m = bot.env.find((x) => x.chat === "200");
  assert.match(m.texto, /lunes 9 de noviembre de 2026/); assert.match(m.texto, /7:00 p\. m\./); assert.match(m.texto, /Naara, Libni, Geisell/);
  const kb = m.op.reply_markup.inline_keyboard;
  assert.deepEqual(kb[0].map((x) => x.callback_data), ["sj:r:reu123456_libni:a", "sj:r:reu123456_libni:n"]);
  assert.equal(kb[1][0].url, "https://sublichat.capuchino.lat/?sala=reu123456");
  assert.ok(!JSON.stringify(m).match(/token|livekit/i), "el mensaje no lleva tokens");
  assert.equal((await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 + 60e3 })).enviados, 0, "no repite");
});

test("recordatorios a su hora; vencido si el bot estaba apagado; reprogramada (otra versión) se anula", async () => {
  const db = crearFakeDb(), bot = botFalso(); await sembrar(db);
  await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 });
  let r = await S.procesarPendientes({ db, bot, env: ENV, ahora: INICIO - 24 * 3600e3 + 30e3 });
  assert.equal(r.enviados, 1); assert.match(bot.env.at(-1).texto, /en 24 horas/);
  r = await S.procesarPendientes({ db, bot, env: ENV, ahora: INICIO + 5 * 60e3 }); // m10 llega 15 min tarde
  assert.equal(r.vencidos, 1);
  await db.collection("sala_reuniones").doc("reu123456").set({ version: 2 }, { merge: true });
  await db.collection("sala_avisos").doc("x_v1").set({ reunionId: "reu123456", usuario: "libni", tipo: "h1", version: 1, programadoMs: T0, estado: "pendiente" });
  r = await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 + 1000 });
  assert.equal(r.anulados, 1);
});

test("cancelada: recordatorios se anulan y el aviso de cancelación sí sale", async () => {
  const db = crearFakeDb(), bot = botFalso(); await sembrar(db, { estado: "cancelada" });
  await db.collection("sala_avisos").doc("c1").set({ reunionId: "reu123456", usuario: "geisell", tipo: "cancelacion", version: 1, programadoMs: T0, estado: "pendiente" });
  const r = await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 });
  assert.equal(r.enviados, 1); assert.match(bot.env[0].texto, /cancel/); assert.equal(r.anulados, 2);
});

test("sin Telegram vinculado o chat bloqueado: queda fallido (sin reintentar sin fin)", async () => {
  const db = crearFakeDb(), bot = botFalso(); await sembrar(db);
  const r = await S.procesarPendientes({ db, bot, env: { ...ENV, TELEGRAM_CHAT_ID_GEISELL: "", TELEGRAM_CHAT_ID_RELOJES: "bloqueado" }, ahora: T0 });
  assert.equal(r.fallidos, 2);
  const inv = db.todos("sala_avisos").filter((x) => x.tipo === "invitacion");
  assert.equal(inv.find((x) => x.usuario === "geisell").estado, "sin_vinculo", "R182: sin Telegram = sin_vinculo (nunca enviado)");
  assert.equal(inv.find((x) => x.usuario === "libni").estado, "fallido", "bloqueó al bot = fallido");
});

test("RSVP por Telegram: solo el chat de esa cuenta; actualiza solo su invitación; avisa a Naara", async () => {
  const db = crearFakeDb(), bot = botFalso(); await sembrar(db);
  const q = (from, data) => ({ id: "cb", data, from: { id: from }, message: { chat: { id: from }, message_id: 9, reply_markup: { inline_keyboard: [] } } });
  await S.handleCallback(q(300, "sj:r:reu123456_libni:a"), { db, bot, env: ENV, ahora: T0 }); // Geisell toca el botón de Libni
  assert.equal(db.todos("sala_invitaciones").find((x) => x.usuario === "libni").estado, "pendiente");
  assert.match(bot.env.at(-1).answer, /no es suya/);
  await S.handleCallback(q(200, "sj:r:reu123456_libni:a"), { db, bot, env: ENV, ahora: T0 });
  const inv = db.todos("sala_invitaciones");
  assert.equal(inv.find((x) => x.usuario === "libni").estado, "aceptada"); assert.equal(inv.find((x) => x.usuario === "libni").canal, "telegram");
  assert.equal(inv.find((x) => x.usuario === "geisell").estado, "pendiente");
  assert.ok(bot.env.some((x) => x.chat === "100" && /Libni confirmó/.test(x.texto)));
  const antes = bot.env.length;
  await S.handleCallback(q(200, "sj:r:reu123456_libni:a"), { db, bot, env: ENV, ahora: T0 }); // repetido: idempotente
  assert.ok(!bot.env.slice(antes).some((x) => x.chat === "100"), "no avisa dos veces a Naara");
  assert.equal(db.todos("auditoria_eventos").filter((x) => x.accion === "rsvp").length, 1);
});

test("cableado: el callback va antes del filtro general; el envío arranca con las tareas de fondo", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  assert.ok(h.indexOf('data.startsWith("sj:")') < h.indexOf("await answerCallbackSilentlySafe(q);\n\n    if (!chatId) return;"));
  const i = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(i, /require\("\.\/lib_sala_juntas"\)\.iniciar/);
});
