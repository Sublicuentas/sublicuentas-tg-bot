"use strict";
// R196v Fase 4 · HBO Standard (3) / Platinum (5) en Telegram y Panel de Socios. Datos ficticios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib_hbo_planes");
const CS = require("../lib_compra_socios");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("lib_hbo_planes.js es copia fiel de HQ api/_hbo-planes.js (mismas reglas que Web y APK)", () => {
  const hq = path.join(__dirname, "..", "..", "hq-gh", "api", "_hbo-planes.js");
  if (!fs.existsSync(hq)) return;
  assert.equal(R("lib_hbo_planes.js").split("\n").slice(1).join("\n"), fs.readFileSync(hq, "utf8").split("\n").slice(1).join("\n"));
});

test("10 · Telegram ofrece «HBO Standard / HBO Platinum» y «· cuenta completa»; nunca «HBO Max» genérico en ventas nuevas", () => {
  const crm = R("index_03_clientes_crm.js");
  assert.match(crm, /text: "🎬 HBO Standard", callback_data: appendCallbackContextLocal\(`\$\{prefix\}:hbomaxstandard`/);
  assert.match(crm, /text: "🎬 HBO Platinum", callback_data: appendCallbackContextLocal\(`\$\{prefix\}:hbomaxplatinum`/);
  assert.match(crm, /text: "🔐 HBO Standard · cuenta completa", callback_data: appendCallbackContextLocal\(`ccsel:\$\{mode\}:hbomaxstandard`/);
  assert.match(crm, /text: "🔐 HBO Platinum · cuenta completa", callback_data: appendCallbackContextLocal\(`ccsel:\$\{mode\}:hbomaxplatinum`/);
  const roles = R("index_02_utils_roles.js");
  assert.match(roles, /hbomaxstandard: "hbomax", hbomaxplatinum: "hbomax"/, "se guarda como hbomax + planHbo");
  assert.equal(H.planDesdePlataforma("hbomaxplatinum"), "platinum"); assert.equal(H.planDesdePlataforma("hbomax"), "");
});

test("10 · Telegram guarda el plan en las 3 rutas (asistente, ➕ servicio, cuenta completa) y valida antes de guardar", () => {
  const h = R("index_06_handlers.js"), crm = R("index_03_clientes_crm.js"), fl = R("index_31_finanzas_libro.js");
  assert.match(h, /const ph = require\("\.\/lib_hbo_planes"\)\.planDesdePlataforma\(platRaw\); if \(ph\) st\.servicio\.planHbo = ph;/);
  assert.match(h, /plataforma: p\.plat, \.\.\.\(phAdd \? \{ planHbo: phAdd \} : \{\}\),/);
  assert.match(h, /finLibro\.iniciarCuentaCompleta\(chatId, userId, \{ clientId: String\(clientId\), plat, planHbo: require\("\.\/lib_hbo_planes"\)\.planDesdePlataforma\(plat\) \}\)/);
  assert.match(fl, /addServicioTx\(p\.clientId, \{ plataforma: p\.plat, \.\.\.\(p\.planHbo \? \{ planHbo: p\.planHbo \} : \{\}\)/);
  assert.match(crm, /const planHbo = await validarHboTelegram\(servicio, String\(servicio\.compraId \|\| ""\)\); \/\/ R196v/);
  assert.match(crm, /const motivo = H\.validarAsignacion\(found\.data \|\| \{\}, \{ plan, completa, compraId \}\);/);
  assert.match(crm, /if \(planHbo\) compra\.planHbo = planHbo; \/\/ R196v/);
  assert.match(crm, /const disponibles = invCanon\.disponiblesCuenta\(\{ \.\.\.data, clientes \}, capacidad, ocupados\); \/\/ R198j[^\n]*R196v · completa = 0 para terceros/); // R198j · misma regla, ahora para cualquier plataforma
  assert.match(crm, /📦 \$\{markdown \? "\*Plan:\*" : "Plan:"\}/, "la ficha muestra el plan real");
});

test("04–07 en Telegram: mismas reglas (lib compartida) — 4.ª en Standard, 6.ª en Platinum y perfiles en cuenta completa se bloquean", () => {
  const c = (n, x = {}) => Array.from({ length: n }, (_, i) => ({ compraId: "k" + i, ...x }));
  assert.match(H.validarAsignacion({ plataforma: "hbomax", planHbo: "standard", capacidad: 3, clientes: c(3) }, { plan: "standard" }), /llena \(3\/3\)/);
  assert.match(H.validarAsignacion({ plataforma: "hbomax", planHbo: "platinum", capacidad: 5, clientes: c(5) }, { plan: "platinum" }), /llena \(5\/5\)/);
  assert.match(H.validarAsignacion({ plataforma: "hbomax", planHbo: "standard", capacidad: 3, clientes: c(1, { cuentaCompleta: true }) }, { plan: "standard" }), /vendida como cuenta completa/);
  assert.match(H.validarAsignacion({ plataforma: "hbomax", planHbo: "platinum", capacidad: 5, clientes: c(1) }, { plan: "platinum", completa: true }), /perfil\(es\) de otros clientes/);
  assert.equal(H.validarAsignacion({ plataforma: "hbomax", planHbo: "platinum", capacidad: 5, clientes: c(2) }, { plan: "platinum" }), "");
});

test("10 · Socios: el pedido guarda el plan (del nombre del producto) y Telegram lo muestra; producto genérico no se adivina", () => {
  const { renglon } = CS.normalizarRenglon({ dispositivo: "tv" }, { n: "HBO Max Platino", s: "1 mes", categoria: "Perfiles" }, { clienteId: "x", nombre: "Cliente", apellido: "Demo" }, 0);
  assert.equal(renglon.planHbo, "platinum");
  assert.equal(CS.normalizarRenglon({ dispositivo: "tv" }, { n: "HBO Max", categoria: "Perfiles" }, { nombre: "C", apellido: "D" }, 0).renglon.planHbo, undefined);
  const l = CS.lineasTelegram([{ servicio: "HBO Standard · cuenta completa", precioCatalogo: null, planHbo: "standard", modalidad: "cuenta_completa" }], "Cliente Demo");
  assert.match(l.join("\n"), /Plan: HBO Standard · cuenta completa/);
});

test("10 · Socios /rev/inventario: stock separado Standard / Platinum; cuenta completa = cuentas vacías del plan; genérico suma todo como antes", () => {
  const s = R("server_api.js");
  assert.match(s, /if \(key === "hbomax" && HBO\.planValido\(d\.planHbo\)\) key = `hbomax_\$\{HBO\.planValido\(d\.planHbo\)\}`;/);
  assert.match(s, /if \(key\.startsWith\("hbomax"\)\) disponibles = Math\.min\(disponibles, HBO\.cuposVendibles\(d\)\); \/\/ R196v · vendida completa = 0/);
  assert.match(s, /\{ const ph = require\("\.\/lib_hbo_planes"\)\.planDesdeNombreProducto\(text\); if \(ph\) return \[`hbomax_\$\{ph\}`\]; \}/);
  assert.match(s, /disponibles \+= completaHbo \? row\.vacias : row\.disponibles;/);
  assert.match(s, /\.\.\.\(renglon\.planHbo \? \{ planHbo: renglon\.planHbo \} : \{\}\), \/\/ R196v/);
  assert.equal(H.planDesdeNombreProducto("HBO Max Platino"), "platinum"); assert.equal(H.planDesdeNombreProducto("HBO Standard"), "standard");
});
