"use strict";
// R192 · Cierre del ciclo desde Telegram (mismo documento que HQ, idempotente), aviso en «Cierre de caja» y mensaje del Baúl.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const B = path.join(__dirname, "..");
class Ts { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } static fromDate(d) { return new Ts(d.getTime()); } static fromMillis(ms) { return new Ts(ms); } }

function cargar() {
  const store = new Map(); let n = 0;
  const snap = (k, id) => { const d = store.get(k); return { id, exists: !!d, data: () => d }; };
  const ref = (c, id = `auto${++n}`) => ({ id, _k: `${c}/${id}`, get: async () => snap(`${c}/${id}`, id) });
  const docs = (c) => [...store.entries()].filter(([k]) => k.startsWith(`${c}/`)).map(([k, d]) => ({ id: k.slice(c.length + 1), data: () => d }));
  const q = (c, f = () => true) => ({ _q: true, get: async () => ({ docs: docs(c).filter(f) }), where: (fl, op, v) => q(c, (x) => f(x) && (!(v instanceof Ts) || (x.data()[fl]?.ms ?? 0) >= v.ms)), orderBy: () => q(c, f), limit: () => q(c, f) });
  const db = { collection: (c) => ({ doc: (id) => ref(c, id), ...q(c) }),
    async runTransaction(fn) { const buf = []; const tx = { get: (r) => r.get(), set: (r, d, o) => buf.push([r._k, d, o]) }; const out = await fn(tx); for (const [k, d, o] of buf) store.set(k, o && o.merge ? { ...(store.get(k) || {}), ...d } : d); return out; } };
  store.set("portal_cliente/configuracion", { metodos: [{ id: "bac", nombre: "BAC", activo: true }] });
  store.set("finanzas_config/libro_mayor", { bases: { bac: { saldo: 1000, desde: "2026-10-01" } }, cicloInicio: "2026-10-01", cicloId: "ciclo_2026-10-01" });
  const mov = (id, tipo, monto, f) => store.set(`finanzas_movimientos/${id}`, { tipo, monto, banco: "BAC", bancoId: "bac", fecha: f.split("-").reverse().join("/"), fechaPago: f, fechaTS: new Ts(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8), 12)) });
  mov("o1", "ingreso", 500, "2026-10-15"); mov("o2", "egreso", 100, "2026-10-20"); mov("n1", "ingreso", 70, "2026-11-03");
  const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (k.includes("index_31_finanzas_libro")) delete require.cache[k];
  stub("index_01_core", { bot: { sendMessage: async () => {} }, admin: { firestore: { Timestamp: Ts } }, db });
  stub("index_02_utils_roles", { pending: new Map(), upsertPanel: async () => {}, logErr: () => {} });
  stub("index_23_access_control", {});
  stub("index_05_finanzas_menus", { getMovimientosPorRango: async () => [] });
  return { L: require(path.join(B, "index_31_finanzas_libro")), store };
}

test("R192: cerrar octubre desde Telegram escribe finanzas_ciclos y abre noviembre; repetir no duplica", async () => {
  const { L, store } = cargar();
  assert.equal(L.fechaSugeridaCierre({ cicloInicio: "2026-10-01" }, "2026-11-07"), "2026-10-31");
  const r = await L.cerrarCicloBot({ fechaFin: "2026-10-31", actor: { usuario: "sublicuentas" } });
  assert.equal(r.duplicado, false);
  const c = store.get("finanzas_ciclos/ciclo_2026-10-01");
  assert.equal(c.estado, "cerrado"); assert.equal(c.fechaFin, "2026-10-31"); assert.equal(c.origenCanal, "tg");
  assert.equal(c.saldoRetenido, 1400, "1000 + 500 − 100; el ingreso de noviembre no entra");
  const libro = store.get("finanzas_config/libro_mayor");
  assert.equal(libro.cicloInicio, "2026-11-01"); assert.equal(libro.ultimoCierreFin, "2026-10-31"); assert.equal(libro.bases.bac.saldo, 1400);
  const nMovs = [...store.keys()].filter((k) => k.startsWith("finanzas_movimientos/")).length;
  assert.equal(nMovs, 3, "no crea ni borra movimientos");
  await assert.rejects(() => L.cerrarCicloBot({ fechaFin: "2099-01-01" }), /futura/);
  const aud = [...store.entries()].filter(([k, v]) => k.startsWith("auditoria_eventos/") && v.tipo === "finanzas_cierre_ciclo");
  assert.equal(aud.length, 1);
});

test("R192: «Cierre de caja» avisa que es reporte; menú con 🔒 Cierre del ciclo; Baúl con botón de mensaje", () => {
  const m = fs.readFileSync(path.join(B, "index_05_finanzas_menus.js"), "utf8");
  assert.match(m, /NOTA_CIERRE_CAJA_R192 = "\\n\\nℹ️ Esto es un reporte del periodo: NO cierra el ciclo financiero/);
  assert.ok((m.match(/NOTA_CIERRE_CAJA_R192/g) || []).length >= 3);
  const l = fs.readFileSync(path.join(B, "index_31_finanzas_libro.js"), "utf8");
  assert.match(l, /🔒 Cierre del ciclo/); assert.match(l, /fl:cc:ok:/);
  const b = fs.readFileSync(path.join(B, "index_37_baul_apks.js"), "utf8");
  assert.match(b, /baul:msg:/); assert.match(b, /📋 Mensaje para el cliente/);
  assert.match(fs.readFileSync(path.join(B, "lib_baul_apks.js"), "utf8"), /function mensajeCliente/);
});
