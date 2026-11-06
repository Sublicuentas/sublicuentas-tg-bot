// R182 · Telegram para TODOS los invitados: vínculo con /start sj_<token> (un solo uso), mensaje de prueba, reactivación de
// avisos "sin_vinculo", RSVP del invitado correcto, bloqueado = error visible, retirado = ningún envío, solicitud de ingreso a Naara.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib_sala_juntas");
const { crearFakeDb } = require("./helpers/fake-firestore-sala");
const ENV = { TELEGRAM_CHAT_ID_SUBLICUENTAS: "100", TELEGRAM_CHAT_ID_RELOJES: "200", TELEGRAM_CHAT_ID_GEISELL: "300", SUBLICHAT_WEB_URL: "https://sublichat.capuchino.lat" };
const T0 = Date.UTC(2026, 10, 6, 18, 0), INICIO = Date.UTC(2026, 10, 10, 1, 0);
function botFalso() { const env = []; let n = 0; return { env, sendMessage: async (chat, texto, op) => { if (String(chat) === "666") throw Object.assign(new Error("403 Forbidden: bot was blocked by the user"), { response: { statusCode: 403 } }); env.push({ chat: String(chat), texto, op }); return { message_id: ++n }; }, answerCallbackQuery: async (id, op) => { env.push({ answer: op && op.text }); }, editMessageReplyMarkup: async () => {} }; }
async function sembrar(db) {
  await db.collection("sala_reuniones").doc("reu777777").set({ titulo: "Junta con invitado", agenda: ["Cuadre"], inicioMs: INICIO, estado: "programada", participantes: ["naara", "libni", "geisell", "daniela"], version: 1 });
  for (const u of ["naara", "libni", "geisell", "daniela"]) await db.collection("sala_invitaciones").doc(`reu777777_${u}`).set({ reunionId: "reu777777", usuario: u, estado: u === "naara" ? "aceptada" : "pendiente" });
  for (const u of ["libni", "geisell"]) await db.collection("sala_avisos").doc(`reu777777_${u}_invitacion_v1`).set({ reunionId: "reu777777", usuario: u, tipo: "invitacion", version: 1, programadoMs: T0, estado: "pendiente" });
  await db.collection("sala_avisos").doc("reu777777_daniela_invitacion_v1").set({ reunionId: "reu777777", usuario: "daniela", tipo: "invitacion", version: 1, programadoMs: T0, estado: "sin_vinculo" });
  await db.collection("sala_avisos").doc("reu777777_daniela_h24_v1").set({ reunionId: "reu777777", usuario: "daniela", tipo: "h24", version: 1, programadoMs: INICIO - 24 * 3600e3, estado: "sin_vinculo" });
}
const msg = (chat, text, type = "private") => ({ chat: { id: chat, type }, from: { id: chat }, text });

test("vincular: enlace de un solo uso, prueba real, queda listo y reactiva sus avisos; el invitado recibe convocatoria y recordatorio", async () => {
  const db = crearFakeDb(), bot = botFalso(); await sembrar(db);
  await db.collection("sala_tg_tokens").doc("tok_abcdefghijklmnopqrstu").set({ usuario: "daniela", expiraMs: T0 + 15 * 60e3, usado: false });
  let r = await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 }); assert.equal(r.enviados, 2, "solo fundadoras vinculadas");
  assert.equal(db.todos("sala_avisos").find((x) => x.usuario === "daniela" && x.tipo === "invitacion").estado, "sin_vinculo", "nunca 'enviado' sin vínculo");
  assert.equal(await S.tryVincular(msg(555, "/start sj_tok_abcdefghijklmnopqrstu"), { db, bot, env: ENV, ahora: T0 + 1000 }), true);
  const tg = db.todos("sala_telegram").find((x) => x.usuario === "daniela"); assert.equal(tg.estado, "listo"); assert.equal(tg.chatId, "555"); assert.ok(tg.pruebaMessageId);
  assert.match(bot.env.at(-1).texto, /Telegram vinculado/);
  r = await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 + 2000 }); assert.equal(r.enviados, 1); assert.equal(bot.env.at(-1).chat, "555"); assert.match(bot.env.at(-1).texto, /Convocatoria/);
  r = await S.procesarPendientes({ db, bot, env: ENV, ahora: INICIO - 24 * 3600e3 + 10e3 }); assert.equal(r.enviados, 1); assert.match(bot.env.at(-1).texto, /en 24 horas/);
  // el mismo enlace no sirve dos veces
  await S.tryVincular(msg(999, "/start sj_tok_abcdefghijklmnopqrstu"), { db, bot, env: ENV, ahora: T0 + 3000 });
  assert.equal(db.todos("sala_telegram").find((x) => x.usuario === "daniela").chatId, "555"); assert.match(bot.env.at(-1).texto, /venció o ya se usó/);
  // RSVP del invitado: solo su chat
  const q = (from, data) => ({ id: "cb", data, from: { id: from }, message: { chat: { id: from }, message_id: 9, reply_markup: { inline_keyboard: [] } } });
  await S.handleCallback(q(300, "sj:r:reu777777_daniela:a"), { db, bot, env: ENV, ahora: T0 }); assert.equal(db.todos("sala_invitaciones").find((x) => x.usuario === "daniela").estado, "pendiente");
  await S.handleCallback(q(555, "sj:r:reu777777_daniela:a"), { db, bot, env: ENV, ahora: T0 }); assert.equal(db.todos("sala_invitaciones").find((x) => x.usuario === "daniela").estado, "aceptada");
});

test("bloqueado / no iniciado: error visible, nunca entregado; retirado: ningún envío; solicitud de ingreso avisa a Naara", async () => {
  const db = crearFakeDb(), bot = botFalso(); await sembrar(db);
  await db.collection("sala_telegram").doc("daniela").set({ usuario: "daniela", chatId: "666", estado: "listo" });
  await db.collection("sala_avisos").doc("reu777777_daniela_invitacion_v1").set({ estado: "pendiente" }, { merge: true });
  await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 });
  assert.equal(db.todos("sala_avisos").find((x) => x.usuario === "daniela" && x.tipo === "invitacion").estado, "fallido");
  assert.equal(db.todos("sala_telegram").find((x) => x.usuario === "daniela").estado, "bloqueado");
  // retirado: ya no está en participantes → anulado
  await db.collection("sala_reuniones").doc("reu777777").set({ participantes: ["naara", "libni", "geisell"] }, { merge: true });
  await db.collection("sala_avisos").doc("x1").set({ reunionId: "reu777777", usuario: "daniela", tipo: "h1", version: 1, programadoMs: T0, estado: "pendiente" });
  const r = await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 + 1000 }); assert.equal(r.anulados, 1);
  // solicitud de ingreso tardío → Naara
  await db.collection("sala_reuniones").doc("reu777777").set({ estado: "en_curso" }, { merge: true });
  await db.collection("sala_avisos").doc("s1").set({ reunionId: "reu777777", usuario: "naara", tipo: "solicitud", solicitante: "geisell", solicitanteNombre: "Geisell", version: 1, programadoMs: T0 + 2000, estado: "pendiente" });
  await S.procesarPendientes({ db, bot, env: ENV, ahora: T0 + 2500 });
  assert.equal(bot.env.at(-1).chat, "100"); assert.match(bot.env.at(-1).texto, /Geisell<\/b> pide entrar/);
});
