const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const B = path.join(__dirname, "..");
class Ts { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } static fromDate(d) { return new Ts(d.getTime()); } static fromMillis(ms) { return new Ts(ms); } }
const noon = (y, m, d) => new Ts(Date.UTC(y, m - 1, d, 12));
const midUtc = (y, m, d) => new Ts(Date.UTC(y, m - 1, d));

function cargar(docs) {
  const escritos = {};
  const col = (name) => ({
    get: async () => ({ docs: (name === "finanzas_movimientos" ? Object.entries(docs) : []).map(([id, d]) => ({ id, data: () => d })), forEach(fn) { this.docs.forEach(fn); } }),
    where: (f, op, v) => ({ get: async () => { const arr = Object.entries(docs).filter(([, d]) => d.fechaTS instanceof Ts && d.fechaTS.ms >= v.ms).map(([id, d]) => ({ id, data: () => d })); return { docs: arr }; } }),
    doc: (id) => ({ id, get: async () => ({ exists: false, data: () => ({}) }), _path: [name, id] }),
  });
  const db = {
    collection: (n) => { const c = col(n); const g = c.get; c.get = async () => { const r = await g(); r.forEach = (fn) => r.docs.forEach(fn); return r; }; return c; },
    batch: () => ({ set: (ref, data) => { escritos[ref.id] = data; Object.assign(docs[ref.id], data); }, commit: async () => {} }),
  };
  const paneles = [];
  const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (k.includes("index_31_finanzas_libro")) delete require.cache[k];
  stub("index_01_core", { bot: { sendMessage: async () => {} }, admin: { firestore: { Timestamp: Ts } }, db });
  stub("index_02_utils_roles", { pending: new Map(), upsertPanel: async (chatId, txt, kb) => paneles.push({ txt, kb }), logErr: () => {} });
  stub("index_23_access_control", {});
  // Telegram: toma la fecha escrita (dd/mm/yyyy) de TODOS los docs, como el escaneo del bot.
  stub("index_05_finanzas_menus", { getMovimientosPorRango: async () => Object.entries(docs).filter(([, d]) => !d.estadoFinanciero && !d.reversaDe).map(([id, d]) => ({ id, ...d })) });
  const L = require(path.join(B, "index_31_finanzas_libro"));
  return { L, paneles, escritos };
}

test("R132: cuadre muestra lo que solo ve Telegram (fechaTS número de una edición de fecha) y Reparar lo cuadra", async () => {
  const docs = {
    a: { tipo: "ingreso", monto: 500, banco: "BAC", clienteNombre: "Ana", fecha: "02/10/2026", fechaPago: "2026-10-02", fechaTS: noon(2026, 10, 2) },
    b: { tipo: "ingreso", monto: 610, banco: "BAC", clienteNombre: "Beto", fecha: "03/10/2026", fechaTS: Date.UTC(2026, 9, 3, 12) }, // editado en TG: número
    c: { tipo: "egreso", subtipo: "egreso_operativo", monto: 100, banco: "BAC", motivo: "Luz", fecha: "04/10/2026", fechaTS: midUtc(2026, 10, 4) }, // manual del bot: medianoche UTC, está bien
  };
  const { L, paneles } = cargar(docs);
  await L.cuadreTgApkR132(1);
  const t1 = paneles.pop().txt;
  assert.match(t1, /APK \(disponible\): \*Lps\. 400/);
  assert.match(t1, /Telegram mismo período: \*Lps\. 1,?010/);
  assert.match(t1, /Solo en Telegram \(1\)[\s\S]*Beto/);
  assert.match(t1, /1 con fecha descuadrada/);
  assert.equal((await L.descuadresFechaR132("2026-10-01")).length, 1, "el egreso manual del bot (medianoche UTC) no se toca");
  assert.equal(await L.repararFechasR132("2026-10-01"), 1);
  assert.ok(docs.b.fechaTS instanceof Ts); assert.equal(docs.b.fechaPago, "2026-10-03");
  await L.cuadreTgApkR132(1);
  const t2 = paneles.pop().txt;
  assert.match(t2, /Cuadran exacto/);
});

test("R132: cambiar la fecha en Telegram guarda Timestamp y fechaPago (la APK lo ve)", () => {
  const src = fs.readFileSync(path.join(B, "index_06_handlers.js"), "utf8");
  assert.match(src, /fecha: t, fechaPago: t\.split\("\/"\)\.reverse\(\)\.join\("-"\), fechaTS: admin\.firestore\.Timestamp\.fromMillis\(parseDMYtoTS\(t\)\)/);
  const lib = fs.readFileSync(path.join(B, "index_31_finanzas_libro.js"), "utf8");
  assert.match(lib, /callback_data: "fl:cuadre"/);
});
