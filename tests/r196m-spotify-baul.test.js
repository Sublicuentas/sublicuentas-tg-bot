// R196m · Bot: misma lógica que la web (copias fieles) para Spotify Familiar y mensajes cortos del Baúl. Datos ficticios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const B = require("../lib_baul_apks");

test("Baúl: mensaje corto de UN dispositivo, *negritas*, sin enlace/código → No configurado", () => {
  const v = B.vistaPlataforma(B.SEMILLA, "stellatv");
  const atv = v.dispositivos.find((d) => d.id === "android_tv").enlaces.find((e) => e.codigo);
  assert.match(atv.mensaje, /^\*Instalación en Android TV - Stella TV\*/);
  assert.match(atv.mensaje, /Introduzca el código \*7471459\*/);
  assert.doesNotMatch(atv.mensaje, /celular|iPhone|SUBLICUENTAS \|/);
  const mov = v.dispositivos.find((d) => d.id === "android_movil").enlaces[0];
  assert.match(mov.mensaje, /^\*Instalación en celular Android - Stella TV\*\n\n1\. \*Descargue\* la app aquí: https:\/\/bit\.ly\/4bg5tgE/);
  assert.equal(B.mensajeCliente({ dispositivo: "android_movil", metodo: "apk", url: "" }, { plataforma: "X" }), "");
  assert.equal(B.faltanteDe({ dispositivo: "android_movil", metodo: "apk", url: "" }), "Enlace no configurado");
  assert.equal(B.PLATAFORMAS.find((p) => p.id === "icomplay").nombre, "Icomplay");
  assert.match(R("index_37_baul_apks.js"), /No configurado: \$\{e\.faltante/);
});

test("Spotify Familiar: copia fiel de la web y «No renovó» desde Telegram deja «Retiro en Spotify pendiente»", () => {
  const web = path.join(__dirname, "..", "..", "hq-gh", "api", "_spotify-familias.js");
  if (fs.existsSync(web)) assert.equal(R("lib_spotify_familias.js").split("\n").slice(1).join("\n"), fs.readFileSync(web, "utf8").split("\n").slice(1).join("\n"));
  assert.match(R("lib_spotify_familias.js"), /async function retirarPorBaja/);
  assert.match(R("index_03_clientes_crm.js"), /require\("\.\/lib_spotify_familias"\)\.retirarPorBaja\(db/);
  assert.match(R("index_06_handlers.js"), /motivo:"no_renovo"/);
  assert.match(R("index_06_handlers.js"), /Retiro en Spotify pendiente/);
});
