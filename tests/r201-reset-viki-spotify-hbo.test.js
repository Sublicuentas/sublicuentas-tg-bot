// R201 · /link y /code entregan el link de restablecer de Viki, Spotify y HBO Max aunque el botón use link de seguimiento.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, parent, ...r) {
  if (/index_01_core$/.test(req)) return { bot: { onText() {}, sendMessage: async () => ({}) }, EMAIL_ACCOUNTS: [] };
  if (/index_23_access_control$/.test(req)) return new Proxy({}, { get: () => () => true });
  return orig.call(this, req, parent, ...r);
};
const M = require(path.join(__dirname, "../index_07_imap.js"));
Module._load = orig;

const viki = {
  from: "Viki <noreply@viki.com>", subject: "Solicitud de cambio de contraseña para Viki",
  html: '<p>Hola</p><a href="https://click.viki.com/ls/click?upn=abc123&amp;x=1" style="background:#00aaff">Restablece tu contraseña</a><a href="https://www.viki.com/help">Centro de ayuda</a>',
  text: "Restablece tu contraseña",
};
const spotify = {
  from: "Spotify <no-reply@spotify.com>", subject: "Restablece tu contraseña",
  html: '<a href="https://wl.spotify.com/ls/click?upn=zz">Restablecer contraseña</a>', text: "",
};
const hbo = {
  from: "HBO Max <hbomax@mail.hbomax.com>", subject: "Restablece tu contraseña de HBO Max",
  html: '<a href="https://links.email.max.com/els/v2/qq">Restablecer contraseña</a>', text: "",
};

test("Viki se reconoce y el asunto «Solicitud de cambio de contraseña» es reset", () => {
  assert.equal(M.esViki(viki.from, viki.subject), true);
  assert.equal(M.esReset(viki.subject, viki.text), true);
});
test("Viki: toma el botón Restablece, no el centro de ayuda", () => {
  assert.equal(M.linkResetDe(viki), "https://click.viki.com/ls/click?upn=abc123&x=1");
});
test("Spotify y HBO con link de seguimiento", () => {
  assert.equal(M.linkResetDe(spotify), "https://wl.spotify.com/ls/click?upn=zz");
  assert.equal(M.linkResetDe(hbo), "https://links.email.max.com/els/v2/qq");
});
test("un aviso que no es reset no devuelve botones", () => {
  assert.equal(M.linkResetDe({ from: "Viki <noreply@viki.com>", subject: "Nuevos estrenos esta semana", html: '<a href="https://click.viki.com/x">Restablece tu contraseña</a>' }), null);
});
test("los patrones de Netflix siguen primero", () => {
  assert.equal(M.extraerLink("", '<a href="https://www.netflix.com/password?g=1&amp;lkid=2">x</a>'), "https://www.netflix.com/password?g=1&lkid=2");
});
