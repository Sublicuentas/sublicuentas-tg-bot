"use strict";
// R159 · Lector IMAP rápido y Netflix Hogar. Buzón FALSO en memoria (no se conecta a ningún hosting real).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { simpleParser } = require("mailparser");
const { crearLector } = require("../lib_imap_rapido");

function mime({ from, to, subject, body, date }) {
  return Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${date.toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`);
}
function buzonFalso() {
  const msgs = [], stats = { conexiones: 0, lotesCuerpo: 0, uidsCuerpo: [], rangos: [] };
  let uid = 100;
  const agregar = (o) => { const date = o.date || new Date(); msgs.push({ uid: ++uid, internalDate: date, envelope: { from: [{ address: o.from }], subject: o.subject, to: [{ address: o.to }] }, source: mime({ ...o, date }) }); return uid; };
  class FakeImap {
    constructor() { this.usable = false; this.mailbox = null; this.h = {}; }
    on(ev, fn) { this.h[ev] = fn; }
    async connect() { stats.conexiones++; this.usable = true; }
    async mailboxOpen() { this.mailbox = { exists: msgs.length, uidValidity: 7n }; }
    async getMailboxLock() { this.mailbox.exists = msgs.length; return { release() {} }; }
    async *fetch(range, query, opts = {}) {
      stats.rangos.push(`${opts.uid ? "uid " : ""}${range}`);
      let sel;
      if (opts.uid && /^\d+:\*$/.test(range)) { const d = Number(range.split(":")[0]); sel = msgs.filter((m) => m.uid >= d); if (!sel.length) sel = msgs.slice(-1); }
      else if (opts.uid) { const set = new Set(range.split(",").map(Number)); sel = msgs.filter((m) => set.has(m.uid)); }
      else { const [a, b] = range.split(":").map(Number); sel = msgs.slice(a - 1, b); }
      if (query.source) { stats.lotesCuerpo++; stats.uidsCuerpo.push(...sel.map((m) => m.uid)); }
      for (const m of sel) yield query.source ? { uid: m.uid, source: m.source } : { uid: m.uid, internalDate: m.internalDate, envelope: m.envelope, headers: Buffer.from("") };
    }
    close() { this.usable = false; } async logout() { this.usable = false; }
  }
  return { FakeImap, agregar, stats };
}
const CUENTA = { name: "hosting", host: "imap.ejemplo.test", port: 993, user: "admin@ejemplo.test", password: "x" };

test("lector rápido: una conexión, cuerpos en UN lote solo de la cuenta pedida, incremental y con caché", async () => {
  const B = buzonFalso();
  for (let i = 0; i < 30; i++) B.agregar({ from: "info@netflix.com", to: `otro${i}@sublicuentas.com`, subject: "Tu código de inicio de sesión", body: `Código ${1000 + i}` });
  B.agregar({ from: "info@netflix.com", to: "bonjovi@sublicuentas.com", subject: "Tu código de inicio de sesión", body: "Código 1111" });
  B.agregar({ from: "disneyplus@trx.mail2.disneyplus.com", to: "bonjovi@sublicuentas.com", subject: "Tu código de acceso único para Disney+", body: "123456" });
  const L = crearLector({ ImapFlow: B.FakeImap, simpleParser, escuchar: false, log: { warn() {} } });
  const r1 = await L.buscar(CUENTA, "bonjovi@sublicuentas.com", 15);
  assert.equal(r1.length, 2); assert.match(r1[0].subject, /Disney/, "más reciente primero");
  assert.equal(B.stats.conexiones, 1); assert.equal(B.stats.lotesCuerpo, 1, "un solo lote de cuerpos");
  assert.equal(B.stats.uidsCuerpo.length, 2, "solo descarga los 2 correos de esa cuenta (no los 30 de otras)");
  const r2 = await L.buscar(CUENTA, "bonjovi@sublicuentas.com", 15);
  assert.equal(r2.length, 2); assert.equal(B.stats.conexiones, 1, "reutiliza la conexión"); assert.equal(B.stats.lotesCuerpo, 1, "usa lo ya leído");
  assert.match(B.stats.rangos.at(-1), /^uid \d+:\*$/, "solo pide encabezados nuevos");
  B.agregar({ from: "info@netflix.com", to: "bonjovi@sublicuentas.com", subject: "Tu código de inicio de sesión", body: "Código 2222" });
  const r3 = await L.buscar(CUENTA, "bonjovi@sublicuentas.com", 15);
  assert.equal(r3.length, 3); assert.match(r3[0].text, /2222/); assert.equal(B.stats.uidsCuerpo.length, 3, "descarga solo el nuevo");
});

test("lector rápido: catch-all (la cuenta solo aparece en el cuerpo) también se encuentra", async () => {
  const B = buzonFalso();
  B.agregar({ from: "info@netflix.com", to: "admin@sublicuentas.com", subject: "Netflix: tu código", body: "Para bonjovi@sublicuentas.com: código 4321" });
  const L = crearLector({ ImapFlow: B.FakeImap, simpleParser, escuchar: false, log: { warn() {} } });
  const r = await L.buscar(CUENTA, "bonjovi@sublicuentas.com", 15);
  assert.equal(r.length, 1);
});

test("mismo texto del lector en el bot y en Sublichat HQ; reglas de Hogar idénticas", () => {
  const hq = path.join(__dirname, "../../hq/api");
  if (!fs.existsSync(hq)) return;
  assert.equal(fs.readFileSync(path.join(__dirname, "../lib_imap_rapido.js"), "utf8"), fs.readFileSync(path.join(hq, "_imap-rapido.js"), "utf8"));
  const bot = fs.readFileSync(path.join(__dirname, "../index_07_imap.js"), "utf8"), web = fs.readFileSync(path.join(hq, "_codigos-imap.js"), "utf8");
  for (const fn of ["esHogarAprobacion", "extraerLinkAprobacionHogar", "detalleSolicitudHogar"]) {
    const cuerpo = (src) => (src.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n}\\n`)) || [""])[0];
    assert.ok(cuerpo(bot)); assert.equal(cuerpo(bot), cuerpo(web), fn);
  }
  assert.match(bot, /if \(\/update-primary-location\/i\.test\(String\(url \|\| ""\)\)\) return null;/, "el servidor nunca abre el enlace de aprobación");
});
