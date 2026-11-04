"use strict";
// R161 · Fase 1 del plan de reducción de costos: interruptores y arranque único (sin conectarse a nada real).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const F = require("../lib_infra_flags");
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("sin variables nuevas todo queda como antes", () => {
  assert.deepEqual(F.leerFlags({}), { panelApiUnificada: false, pollingTelegram: true, tareasFondo: true, keepalivePanel: true });
});
test("servicio nuevo en prueba: API unificada, sin polling, sin tareas, sin keepalive", () => {
  assert.deepEqual(F.leerFlags({ UNIFICAR_PANEL_API: "1", TELEGRAM_POLLING_ENABLED: "0" }), { panelApiUnificada: true, pollingTelegram: false, tareasFondo: false, keepalivePanel: false });
  assert.deepEqual(F.leerFlags({ UNIFICAR_PANEL_API: "true", TELEGRAM_POLLING_ENABLED: "1" }), { panelApiUnificada: true, pollingTelegram: true, tareasFondo: true, keepalivePanel: false });
  assert.equal(F.leerFlags({ ENABLE_PANEL_KEEPALIVE: "1", UNIFICAR_PANEL_API: "1" }).keepalivePanel, true, "explícito manda");
  assert.equal(F.leerFlags({ TELEGRAM_POLLING_ENABLED: "0", TAREAS_FONDO_ENABLED: "1" }).tareasFondo, true);
  assert.equal(F.leerFlags({ TELEGRAM_POLLING_ENABLED: "quizás" }).pollingTelegram, true, "valor raro = valor por defecto");
});
test("variables críticas: solo nombres, nunca valores", () => {
  const env = { BOT_TOKEN: "x", FIREBASE_PROJECT_ID: "p", FIREBASE_CLIENT_EMAIL: "e", FIREBASE_PRIVATE_KEY: "SECRETO", JWT_SECRET: "" };
  assert.deepEqual(F.variablesFaltantes(env), ["JWT_SECRET"]);
  assert.deepEqual(F.variablesFaltantes(env, F.leerFlags({ UNIFICAR_PANEL_API: "1" })), ["JWT_SECRET", "ADMIN_USER", "ADMIN_PASSWORD", "CORS_ALLOWED_ORIGINS"]);
  const linea = F.resumenArranque(F.leerFlags({}), F.variablesFaltantes(env));
  assert.doesNotMatch(linea, /SECRETO/); assert.match(linea, /faltan variables: JWT_SECRET/);
});
test("un solo app.listen por proceso y un solo polling", () => {
  const sa = leer("server_api.js"), api = leer("index_08_api.js"), idx = leer("index.js");
  assert.equal((sa.match(/^\s*app\.listen\(/gm) || []).length, 1);
  assert.match(sa, /if \(require\.main === module\) \{\n  app\.listen\(PORT/, "server_api solo escucha si se arranca directo");
  assert.match(sa, /module\.exports = \{ app, iniciarTareasPanel, PANEL_API_VERSION \};/);
  assert.match(api, /if \(!global\.__SUBLICUENTAS_API_SERVER__\) \{\n  global\.__SUBLICUENTAS_API_SERVER__ = app\.listen\(PORT/);
  assert.match(api, /if \(PANEL_UNIFICADA\) \{\n  app\.use\(require\("\.\/server_api"\)\.app\);/);
  assert.ok(api.indexOf('app.use(require("./server_api").app)') < api.indexOf('app.post("/rev/login"'), "la Panel API va antes que las /rev duplicadas");
  assert.match(api, /if \(!PANEL_UNIFICADA\) \{\n\/\/ LOGIN/);
  assert.equal((idx.match(/startBotPollingSafe\(\)/g) || []).length, 1);
  assert.match(idx, /if \(FLAGS\.pollingTelegram\) await startBotPollingSafe\(\);/);
  assert.match(idx, /if \(FLAGS\.keepalivePanel\) \{/);
  assert.doesNotMatch(idx, /require\("\.\/server_api"\)\)?;?\s*$/m, "index.js no arranca server_api como servidor");
});
test("las rutas /rev que existen en ambos archivos quedan cubiertas por la versión de server_api", () => {
  const rutas = (src) => new Set([...src.matchAll(/app\.(get|post|put|patch|delete)\("(\/rev[^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`));
  const panel = rutas(leer("server_api.js")), principal = rutas(leer("index_08_api.js"));
  for (const r of principal) assert.ok(panel.has(r), `server_api.js no tiene ${r}`);
});
