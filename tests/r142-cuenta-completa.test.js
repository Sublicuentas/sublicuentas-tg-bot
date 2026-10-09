const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
const c = fs.readFileSync(path.join(__dirname, "..", "index_03_clientes_crm.js"), "utf8");
test("R142: cuenta completa desde 'cliente nuevo' en Telegram crea el cliente antes de pedir correo/clave/precio", () => {
  assert.match(h, /if \(!clientId && mode === "wiz"\) \{[\s\S]{0,300}asegurarClienteWizard\(st\)/);
  assert.match(c, /async function asegurarClienteWizard\(st = \{\}\)[\s\S]{0,400}clienteExactoNombreTelefono\(st\.nombre, st\.telefono\)/);
  assert.match(c, /module\.exports = \{\n  asegurarClienteWizard,/);
});
