// R163 · El lector IMAP explica por qué no pudo escuchar (sin credenciales) y no insiste si el hosting rechaza la clave.
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearLector } = require("../lib_imap_rapido");

function fakeImap(err) {
  return class { constructor() { this.usable = false; } on() {} async connect() { throw err; } close() {} };
}
test("clave rechazada: mensaje claro y sin reintentos", async () => {
  const logs = []; const e = Object.assign(new Error("Authentication failed"), { authenticationFailed: true });
  const L = crearLector({ ImapFlow: fakeImap(e), simpleParser: async () => ({}), escuchar: true, log: { warn: (...a) => logs.push(a.join(" ")) } });
  await L.escucharCuenta({ name: "imap", host: "h", user: "u@x.com", password: "SECRETO" });
  assert.match(logs[0], /rechazó usuario o clave/);
  assert.ok(!logs.join(" ").includes("SECRETO"));
  const p = [...L._pools.values()][0];
  assert.equal(p.authFallo, true); assert.equal(p.reconectar, null);
});
test("comando rechazado: muestra la respuesta del servidor", async () => {
  const logs = []; const e = Object.assign(new Error("Command failed"), { responseText: "Mailbox doesn't exist: INBOX" });
  const L = crearLector({ ImapFlow: fakeImap(e), simpleParser: async () => ({}), escuchar: true, log: { warn: (...a) => logs.push(a.join(" ")) } });
  await L.escucharCuenta({ name: "imap", host: "h", user: "u@x.com", password: "x" });
  assert.match(logs[0], /Command failed · Mailbox doesn't exist/);
  const p = [...L._pools.values()][0]; clearTimeout(p.reconectar);
});
