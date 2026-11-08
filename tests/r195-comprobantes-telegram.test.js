"use strict";
// R195 · Comprobantes del Portal de Socios → Telegram con entrega VERIFICABLE. Datos, ids y token ficticios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FakeDb } = require("./helpers/fake-firestore");
const D = require("../lib_destinos_tg");
const V = require("../lib_voucher_tg");

const ENV = { TELEGRAM_CHAT_ID_SUBLICUENTAS: "-1001111222333", TELEGRAM_CHAT_ID_RELOJES: "444555666", SUPER_ADMIN: "999000111,-1001111222333" };
const TOKEN = "000:token-ficticio";
function fakeTg(respuestas) {
  const llamadas = [];
  const f = async (url, op) => {
    const metodo = url.split("/").pop(); llamadas.push({ metodo, url, op });
    const r = typeof respuestas === "function" ? respuestas(metodo, llamadas.length) : respuestas;
    if (r instanceof Error) throw r;
    return { ok: r.ok !== false, status: r.status || 200, statusText: "", json: async () => r.body };
  };
  f.llamadas = llamadas; return f;
}
const OK = { body: { ok: true, result: { message_id: 7781 } } };
const NO_CHAT = { ok: false, status: 400, body: { ok: false, error_code: 400, description: "Bad Request: chat not found" } };
async function pedido(db, id, destino = "sublicuentas") {
  await db.collection("compras").doc(id).set({ socio: "Socio Prueba", destino, destinoLabel: destino === "relojes" ? "⌚ Relojes" : "🟣 Sublicuentas", totalCombo: 160, imagenData: "data:image/png;base64,iVBORw0KGgo=", createdAt: new Date("2026-11-07T15:00:00Z"), notificacion: V.notificacionInicial(id, destino, new Date("2026-11-07T15:00:00Z")) });
}
const foto = { buffer: Buffer.from("png"), contentType: "image/png", filename: "c.png" };

test("causa raíz: Sublicuentas usa la MISMA variable que Tickets (TELEGRAM_CHAT_ID_SUBLICUENTAS), no el primer SUPER_ADMIN", () => {
  const r = D.resolverDestino("sublicuentas", ENV);
  assert.equal(r.chatId, "-1001111222333"); assert.equal(r.fuente, "TELEGRAM_CHAT_ID_SUBLICUENTAS");
  assert.equal(D.resolverDestino("relojes", ENV).chatId, "444555666");
  assert.equal(D.resolverDestino("sublicuentas", { SUBLICUENTAS_CHAT_ID: "123" }).fuente, "SUBLICUENTAS_CHAT_ID", "la variable vieja sigue sirviendo");
  assert.equal(D.resolverDestino("sublicuentas", { SUPER_ADMIN: "999" }).fuente, "SUPER_ADMIN (primer id)");
  assert.equal(D.enmascararChat("-1001111222333"), "••••2333");
});

test("selector obligatorio: el destino es enum SUBLICUENTAS | RELOJES y no se asume en pedidos v2", () => {
  assert.throws(() => V.destinoVoucher(""), /destino_requerido/);
  assert.throws(() => V.destinoVoucher("geisell"), /destino_invalido/);
  assert.throws(() => V.destinoVoucher("Sublicuentas2"), /destino_invalido/);
  assert.equal(V.destinoVoucher("Relojes"), "relojes");
  assert.equal(V.destinoVoucher("", { requerido: false }), "sublicuentas", "solo pedidos viejos (v1) conservan el valor de antes");
  const n = V.notificacionInicial("web_x", "sublicuentas");
  assert.deepEqual([n.destino, n.estado, n.intentos, n.idempotencyKey], ["SUBLICUENTAS", "pendiente", 0, "voucher-telegram:web_x"]);
  assert.doesNotMatch(JSON.stringify(n), /token/i);
});

test("Sublicuentas: «enviado» SOLO con message_id; llega al chat de Sublicuentas; repetir no reenvía", async () => {
  const db = new FakeDb(); await pedido(db, "web_a");
  const f = fakeTg(OK);
  const r = await V.entregarVoucher(db, "web_a", { token: TOKEN, env: ENV, fetchFn: f, foto, caption: "🛒 *COMPRA* juan_perez@correo.com" });
  assert.equal(r.estado, "enviado");
  const n = (await db.collection("compras").doc("web_a").get()).data().notificacion;
  assert.equal(n.telegramMessageId, 7781); assert.equal(n.telegramChatRef, "••••2333"); assert.equal(n.fuente, "TELEGRAM_CHAT_ID_SUBLICUENTAS"); assert.ok(n.entregadoAt);
  const body = f.llamadas[0].op.body; assert.equal(body.get("chat_id"), "-1001111222333");
  assert.equal(body.get("parse_mode"), null, "sin Markdown: un «_» en un correo ya no tumba el envío");
  assert.doesNotMatch(body.get("caption"), /\*/);
  const otra = await V.entregarVoucher(db, "web_a", { token: TOKEN, env: ENV, fetchFn: f, foto });
  assert.equal(otra.yaEnviado, true); assert.equal(f.llamadas.length, 1, "doble clic / reintento no duplica");
  assert.equal(V.estadoPublico(n).estado, "recibido");
  const audit = Object.values(db.dump("voucher_intentos"));
  assert.equal(audit.length, 1); assert.doesNotMatch(JSON.stringify(audit), /token-ficticio|1001111222333/);
});

test("Relojes llega SOLO al chat de Relojes", async () => {
  const db = new FakeDb(); await pedido(db, "web_r", "relojes");
  const f = fakeTg(OK);
  await V.entregarVoucher(db, "web_r", { token: TOKEN, env: ENV, fetchFn: f, foto });
  assert.equal(f.llamadas[0].op.body.get("chat_id"), "444555666");
});

test("Telegram rechaza (chat not found / 401): NO hay éxito falso; queda error con código; el pago no se toca; reintento con espera", async () => {
  const db = new FakeDb(); await pedido(db, "web_e");
  const antes = (await db.collection("compras").doc("web_e").get()).data();
  let t = new Date("2026-11-08T14:00:00Z");
  const f = fakeTg(NO_CHAT);
  const r = await V.entregarVoucher(db, "web_e", { token: TOKEN, env: ENV, fetchFn: f, foto, ahora: () => t });
  assert.equal(r.estado, "error");
  const d = (await db.collection("compras").doc("web_e").get()).data();
  assert.equal(d.notificacion.lastErrorCode, 400); assert.match(d.notificacion.lastError, /chat not found/);
  assert.equal(d.totalCombo, antes.totalCombo); assert.equal(d.imagenData, antes.imagenData, "voucher conservado");
  assert.equal(V.estadoPublico(d.notificacion).estado, "error");
  // barrido: antes de la espera no reintenta; después sí, y al llegar queda enviado
  const f2 = fakeTg(OK);
  assert.equal((await V.barrerPendientes(db, { token: TOKEN, env: ENV, fetchFn: f2, ahora: () => t })).length, 0);
  t = new Date(t.getTime() + 2 * 60000);
  const h = await V.barrerPendientes(db, { token: TOKEN, env: ENV, fetchFn: f2, ahora: () => t });
  assert.equal(h[0].estado, "enviado"); assert.equal(f2.llamadas.length, 1);
  assert.match(f2.llamadas[0].op.body.get("caption"), /#WEB_E/, "reintento con orden, socio, importe y destino");
  const f401 = fakeTg({ ok: false, status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } });
  const db2 = new FakeDb(); await pedido(db2, "web_t");
  assert.equal((await V.entregarVoucher(db2, "web_t", { token: TOKEN, env: ENV, fetchFn: f401, foto })).estado, "error", "401 ya no se cuenta como enviado");
});

test("red cortada = INCIERTO: no se reintenta solo (podría haber llegado); el admin reenvía tras verificar", async () => {
  const db = new FakeDb(); await pedido(db, "web_i");
  const r = await V.entregarVoucher(db, "web_i", { token: TOKEN, env: ENV, fetchFn: fakeTg(new Error("socket hang up")), foto });
  assert.equal(r.estado, "incierto");
  const f = fakeTg(OK);
  assert.equal((await V.barrerPendientes(db, { token: TOKEN, env: ENV, fetchFn: f, ahora: () => new Date("2027-01-01") })).length, 0);
  assert.equal((await V.entregarVoucher(db, "web_i", { token: TOKEN, env: ENV, fetchFn: f, foto })).estado, "incierto", "sin confirmación del admin no se envía");
  assert.equal((await V.entregarVoucher(db, "web_i", { token: TOKEN, env: ENV, fetchFn: f, foto, forzar: true, actor: "admin:sublicuentas" })).estado, "enviado");
});

test("si Telegram no acepta la foto, va como documento; reporte lista los anteriores sin registro", async () => {
  const db = new FakeDb(); await pedido(db, "web_d");
  const f = fakeTg((m) => (m === "sendPhoto" ? { ok: false, status: 400, body: { ok: false, error_code: 400, description: "Bad Request: IMAGE_PROCESS_FAILED" } } : OK));
  assert.equal((await V.entregarVoucher(db, "web_d", { token: TOKEN, env: ENV, fetchFn: f, foto })).estado, "enviado");
  assert.deepEqual(f.llamadas.map((x) => x.metodo), ["sendPhoto", "sendDocument"]);
  const fila = V.filaReporte("web_viejo", { socio: "S", destino: "sublicuentas", imagenUrl: "https://x", createdAt: new Date("2026-11-01T12:00:00Z") });
  assert.deepEqual([fila.estado, fila.destino, fila.comprobante], ["sin_registro", "SUBLICUENTAS", true]);
});

test("diagnóstico: fuente y chat enmascarado, si el bot alcanza el chat; nunca el token", async () => {
  const f = fakeTg((m) => (m === "getMe" ? { body: { ok: true, result: { username: "SubliBotPrueba" } } } : m === "getChat" ? { body: { ok: true, result: { type: "group" } } } : OK));
  const d = await V.diagnostico({ token: TOKEN, env: ENV, fetchFn: f });
  assert.equal(d.bot.usuario, "SubliBotPrueba");
  assert.deepEqual(d.destinos.map((x) => [x.destino, x.fuente, x.chatRef, x.alcanzable]), [["SUBLICUENTAS", "TELEGRAM_CHAT_ID_SUBLICUENTAS", "••••2333", true], ["RELOJES", "TELEGRAM_CHAT_ID_RELOJES", "••••5666", true]]);
  assert.doesNotMatch(JSON.stringify(d), /token-ficticio|1001111222333|444555666/);
});

test("server_api: outbox en la misma escritura del pedido, respuesta con estado REAL, duplicados con su estado, rutas admin", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "server_api.js"), "utf8");
  assert.match(s, /destinoInfo\(VTG\.destinoVoucher\(b\.destino, \{ requerido: Number\(b\.version\) === 2 \}\)\)/);
  assert.match(s, /doc\.notificacion = VTG\.notificacionInicial\(compraIdPrevisto, destino\.key\);\n[\s\S]{0,200}let ref;/);
  assert.match(s, /notif = await VTG\.entregarVoucher\(db, ref\.id, \{ coleccion: "compras", foto: imagenObj, caption: cap \}\)/);
  assert.match(s, /notificacion: VTG\.estadoPublico\(notif\.n\) \}\);/);
  assert.equal((s.match(/descuentoCombo:Number\(d\.descuentoCombo\|\|0\), notificacion: VTG\.estadoPublico\(d\.notificacion\) \}/g) || []).length, 4);
  assert.match(s, /app\.post\("\/rev\/admin\/comprobantes-telegram\/:id\/reenviar"/); assert.match(s, /confirmoNoLlego !== true/);
  assert.match(s, /error: "ya_entregado"/);
  const compra = s.slice(s.indexOf('app.post("/rev/compra"'), s.indexOf('app.get("/rev/sugerencias/mias"'));
  assert.doesNotMatch(compra, /sendTelegramImageSmart/, "la compra ya no usa el envío que fingía éxito");
});
