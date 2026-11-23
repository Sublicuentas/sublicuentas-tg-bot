"use strict";
// R201 · Protocolo de seguridad: Turnstile, 3 fallos → 30 min, sesión de socio 12 h sin uso.
const test = require("node:test"); const assert = require("node:assert/strict");
process.env.JWT_SECRET = process.env.JWT_SECRET || "prueba-secreto-largo-solo-tests-0123456789";
const jwt = require("jsonwebtoken");
const { verificarTurnstile, turnstileConfigPublica } = require("../lib_turnstile");
const auth = require("../index_09_api_auth");

function fakeDb() {
  const data = new Map();
  const ref = (id) => ({ id, get: async () => ({ exists: data.has(id), data: () => data.get(id) }), delete: async () => data.delete(id) });
  return { _data: data, collection: () => ({ doc: (id) => ref(id) }),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v) => data.set(r.id, { ...(data.get(r.id) || {}), ...v }) }) };
}
const req = (origin) => ({ headers: origin ? { origin, "cf-connecting-ip": "190.0.0.1" } : {} });

test("Turnstile: sin clave secreta queda apagado; la config pública nunca trae la secreta", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  assert.equal((await verificarTurnstile(req("https://socios.capuchino.lat"), {})).ok, true);
  process.env.TURNSTILE_SECRET_KEY = "secreta-prueba"; process.env.TURNSTILE_SITE_KEY = "publica-prueba";
  const c = turnstileConfigPublica(); assert.deepEqual(c, { activo: true, siteKey: "publica-prueba" });
  assert.ok(!JSON.stringify(c).includes("secreta"));
});
test("Turnstile: navegador sin token → 400; token malo → 403; bueno → ok; Cloudflare caído → 503 (falla cerrada)", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secreta-prueba"; delete process.env.TURNSTILE_MODE;
  const web = req("https://socios.capuchino.lat");
  assert.equal((await verificarTurnstile(web, {})).status, 400);
  let enviado = null;
  const f = (ok) => async (_u, o) => { enviado = String(o.body); return { json: async () => ({ success: ok, hostname: "socios.capuchino.lat", action: "login" }) }; };
  assert.equal((await verificarTurnstile(web, { token: "x", accion: "login", fetchImpl: f(false) })).status, 403);
  assert.equal((await verificarTurnstile(web, { token: "x", accion: "login", fetchImpl: f(true) })).ok, true);
  assert.match(enviado, /remoteip=190\.0\.0\.1/);
  assert.equal((await verificarTurnstile(web, { token: "x", fetchImpl: async () => { throw new Error("caído"); } })).status, 503);
  process.env.TURNSTILE_MODE = "all";
  assert.equal((await verificarTurnstile(req(""), {})).status, 400, "modo all: también la app");
  delete process.env.TURNSTILE_MODE; delete process.env.TURNSTILE_SECRET_KEY;
});
test("3 fallos del mismo usuario en 15 min → bloqueo de 30 min", async () => {
  const db = fakeDb();
  for (let i = 0; i < 2; i++) await auth.registerLoginFailure(db, "socio1", "190.0.0.1");
  assert.equal((await auth.checkLoginThrottle(db, "socio1", "190.0.0.1")).blocked, false);
  await auth.registerLoginFailure(db, "socio1", "190.0.0.1");
  const t = await auth.checkLoginThrottle(db, "socio1", "190.0.0.9");
  assert.equal(t.blocked, true); assert.ok(t.retryAfterSeconds > 29 * 60 && t.retryAfterSeconds <= 30 * 60);
  assert.equal((await auth.checkLoginThrottle(db, "otro", "190.0.0.5")).blocked, false, "otro socio con otra IP sigue entrando");
  assert.ok(![...db._data.keys()].some((k) => k.includes("190.0.0.1")), "la IP no se guarda en claro");
});
test("IP con 10 fallos (varios usuarios) → bloqueada; 3 fallos de otros en la misma IP no bloquean a todos", async () => {
  const db = fakeDb();
  for (let i = 0; i < 3; i++) await auth.registerLoginFailure(db, "u" + i, "201.1.1.1");
  assert.equal((await auth.checkLoginThrottle(db, "nuevo", "201.1.1.1")).blocked, false);
  for (let i = 3; i < 10; i++) await auth.registerLoginFailure(db, "u" + i, "201.1.1.1");
  assert.equal((await auth.checkLoginThrottle(db, "nuevo", "201.1.1.1")).blocked, true);
});
test("Sesión de socio: se renueva con el uso (X-Rev-Token de 12 h) y vence con 12 h sin uso", () => {
  const s = process.env.JWT_SECRET; const ahora = Math.floor(Date.now() / 1000);
  const viejo = jwt.sign({ id: "r1", nombre_norm: "socio1", iat: ahora - 3600 }, s, { expiresIn: "12h" });
  let hdr = {}; let code = 0; const res = { set: (k, v) => { hdr[k] = v; }, status: (c) => { code = c; return { json: () => {} }; } };
  let paso = false; auth.revAuth({ headers: { authorization: "Bearer " + viejo } }, res, () => { paso = true; });
  assert.equal(paso, true); const nuevo = jwt.verify(hdr["X-Rev-Token"], s);
  assert.equal(nuevo.id, "r1"); assert.ok(nuevo.exp - nuevo.iat === 12 * 3600);
  const de14 = jwt.sign({ id: "r1", nombre_norm: "socio1", iat: ahora - 13 * 3600 }, s, { expiresIn: "14d" });
  paso = false; auth.revAuth({ headers: { authorization: "Bearer " + de14 } }, res, () => { paso = true; });
  assert.equal(paso, false); assert.equal(code, 401);
});
