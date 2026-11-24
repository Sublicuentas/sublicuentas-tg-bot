"use strict";
// R207 · promociones/avisos: una ventaja por línea (antes llegaban como un solo párrafo).
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("fs"); const path = require("path");
const T = require("../lib_texto_avisos");
const pegado = "✅ Perfiles Premium 4K UHD 🔑 Acceso rápido por código 📱 1 dispositivo por cuenta vigente 🛠️ Soporte incluido durante toda la suscripción 📅 Válido hasta el 30 de noviembre 💰 Ideal para que le saques excelente margen. ¡Haga su pedido ahora! 👇";
test("conserva los saltos de línea que escribió el equipo", () => {
  assert.equal(T.textoPromo("Perfil Premium\r\nSoporte\n\n\n\nVálido hasta el 30"), "Perfil Premium\nSoporte\n\nVálido hasta el 30");
});
test("todo pegado en una línea con emojis → una viñeta por línea, sin cambiar palabras", () => {
  const r = T.textoPromo(pegado).split("\n");
  assert.equal(r.length, 7);
  assert.equal(r[0], "✅ Perfiles Premium 4K UHD"); assert.equal(r[3], "🛠️ Soporte incluido durante toda la suscripción");
  assert.equal(r[6], "👇");
  assert.equal(r.join(" "), pegado);
});
test("una frase normal con un emoji no se parte", () => {
  assert.equal(T.textoPromo("Hola 👋 socio, gracias"), "Hola 👋 socio, gracias");
  assert.equal(T.textoPromo("Netflix subió a L110 🔥"), "Netflix subió a L110 🔥");
});
test("promociones ya no usan clean() (que borraba los saltos) para el texto", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "index_12_admin_panel.js"), "utf8");
  assert.doesNotMatch(s, /texto:clean\(/);
  assert.match(s, /texto:textoPromo\(req\.body\?\.texto,1200\)/);
  assert.match(s, /\\n\\n\$\{textoPromo\(p\.texto/);
});
