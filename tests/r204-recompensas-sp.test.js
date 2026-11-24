"use strict";
// R204 · SubliPoints Fase 2: QA-01, QA-06, QA-07, QA-08 (emisión) y reglas de solicitud/entrega manual.
const test = require("node:test"); const assert = require("node:assert/strict");
const SP = require("../lib_sublipoints"); const R = require("../lib_recompensas_sp");

function fakeDb() {
  const cols = new Map(); const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const ref = (n, id) => ({ id, _n: n, get: async () => ({ exists: col(n).has(id), data: () => col(n).get(id) }),
    create: async (v) => { if (col(n).has(id)) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } col(n).set(id, v); },
    set: async (v, o) => { col(n).set(id, o && o.merge ? { ...(col(n).get(id) || {}), ...v } : v); }, update: async (v) => { col(n).set(id, { ...(col(n).get(id) || {}), ...v }); } });
  const db = { _cols: cols, collection: (n) => ({ doc: (id) => ref(n, id), get: async () => ({ docs: [...col(n).entries()].map(([id, d]) => ({ id, data: () => d })) }),
    where: (f, _o, v) => ({ get: async () => ({ docs: [...col(n).entries()].filter(([, d]) => d[f] === v).map(([id, d]) => ({ id, data: () => d })) }) }) }),
    runTransaction: async (fn) => { let escribio = false; const tx = { get: async (r) => { if (escribio) throw new Error("lectura después de escritura"); return r.get(); }, set: (r, v) => { escribio = true; col(r._n).set(r.id, v); }, update: (r, v) => { escribio = true; col(r._n).set(r.id, { ...(col(r._n).get(r.id) || {}), ...v }); } }; return fn(tx); } };
  return db;
}
async function conPuntos(socio, puntos) {
  const db = fakeDb(); await db.collection("sublipoints_config").doc("general").create({ inicio: new Date(Date.now() - 86400000).toISOString(), excluidos: [] });
  for (let i = 0; i < puntos; i++) await SP.otorgar(db, { clave: SP.claveRenovacion(`${socio}${i}`), socio, tipo: "renovacion", fechaEvento: new Date() });
  return db;
}
const est = (v, id) => v.items.find((x) => x.id === id).estado;

test("catálogo oficial: 9 premios, 3 por nivel, nombres del PDF", async () => {
  const c = await R.catalogo(fakeDb());
  assert.equal(c.length, 9);
  assert.deepEqual(c.map((x) => x.nombre), ["Apple TV", "Eleven Reader Ultra", "Canva Edu Pro", "Duolingo Plus", "Open English", "Prime Video", "Gemini Pro", "HBO Max", "Gift Card Sublicuentas"]);
  assert.match(R.textoDuracion(c.find((x) => x.id === "dia_canva_edu")), /2 meses/);
  assert.match(R.textoDuracion(c.find((x) => x.id === "inm_hbo")), /plan por configurar/);
  assert.match(R.textoDuracion(c.find((x) => x.id === "inm_giftcard_100")), /menos Netflix/);
});
test("QA-01 · socio sin nivel ve todo bloqueado y no puede pedir", async () => {
  const db = await conPuntos("Jimena", 5);
  const v = await R.vistaSocio(db, "jimena"); assert.ok(v.items.every((x) => x.estado === "bloqueado"));
  assert.equal((await R.solicitar(db, { socio: "Jimena", recompensaId: "dia_appletv" })).error, "sin_nivel");
});
test("QA-06 · Leyenda elige UNO de sus tres premios; ni Diamante ni un segundo premio ese mes", async () => {
  const db = await conPuntos("Jimena", 30);
  const v = await R.vistaSocio(db, "jimena");
  assert.equal(est(v, "ley_duolingo"), "disponible"); assert.equal(est(v, "dia_appletv"), "bloqueado"); assert.equal(est(v, "inm_gemini"), "bloqueado");
  assert.equal((await R.solicitar(db, { socio: "Jimena", recompensaId: "dia_appletv" })).error, "nivel_no_corresponde");
  assert.equal((await R.solicitar(db, { socio: "Jimena", recompensaId: "ley_duolingo" })).ok, true);
  assert.equal((await R.solicitar(db, { socio: "Jimena", recompensaId: "ley_prime" })).error, "ya_eligio_este_mes");
  const v2 = await R.vistaSocio(db, "jimena"); assert.equal(est(v2, "ley_duolingo"), "solicitado"); assert.equal(est(v2, "ley_prime"), "bloqueado");
});
test("QA-07 · premio agotado no se puede pedir ni aprobar; aprobar exige disponibilidad comprobada y descuenta cupo", async () => {
  const db = await conPuntos("Jimena", 12);
  await R.editarCatalogo(db, "dia_canva_edu", { cupos: 1 });
  const s = await R.solicitar(db, { socio: "Jimena", recompensaId: "dia_canva_edu" }); assert.ok(s.ok);
  assert.equal((await R.cambiarEstado(db, { id: s.solicitud.id, estado: "aprobada" })).error, "falta_comprobar_disponibilidad");
  const a = await R.cambiarEstado(db, { id: s.solicitud.id, estado: "aprobada", disponibilidadComprobada: true, por: "Sublicuentas" });
  assert.equal(a.estado, "aprobada"); assert.equal((await R.catalogo(db)).find((x) => x.id === "dia_canva_edu").cupos, 0);
  const db2 = await conPuntos("Heber", 12); await R.editarCatalogo(db2, "dia_appletv", { disponibilidad: "agotado" });
  assert.equal(est(await R.vistaSocio(db2, "heber"), "dia_appletv"), "agotado");
  assert.equal((await R.solicitar(db2, { socio: "Heber", recompensaId: "dia_appletv" })).error, "agotado");
});
test("entrega manual: aprobada → entregada con nota y costo real; sin saltos ni doble entrega; rechazo pide motivo y deja elegir otra", async () => {
  const db = await conPuntos("Jimena", 30);
  const s = await R.solicitar(db, { socio: "Jimena", recompensaId: "ley_prime" });
  assert.equal((await R.cambiarEstado(db, { id: s.solicitud.id, estado: "entregada" })).error, "transicion_invalida", "no se entrega sin aprobar");
  await R.cambiarEstado(db, { id: s.solicitud.id, estado: "aprobada", disponibilidadComprobada: true });
  const e = await R.cambiarEstado(db, { id: s.solicitud.id, estado: "entregada", nota: "Enviada por correo", costoRealHnl: 120, por: "Sublicuentas" });
  assert.equal(e.estado, "entregada");
  const d = db._cols.get("recompensas_socios").get(s.solicitud.id); assert.equal(d.costoRealHnl, 120); assert.equal(d.entregadoPor, "Sublicuentas"); assert.equal(d.aprobadoPor, "Admin");
  assert.equal((await R.cambiarEstado(db, { id: s.solicitud.id, estado: "entregada" })).sinCambios, true);
  const db2 = await conPuntos("Heber", 26); const s2 = await R.solicitar(db2, { socio: "Heber", recompensaId: "ley_openenglish" });
  assert.equal((await R.cambiarEstado(db2, { id: s2.solicitud.id, estado: "rechazada" })).error, "falta_motivo");
  await R.cambiarEstado(db2, { id: s2.solicitud.id, estado: "rechazada", motivo: "Sin cupo este mes" });
  assert.equal((await R.solicitar(db2, { socio: "Heber", recompensaId: "ley_duolingo" })).ok, true, "tras un rechazo puede elegir otra");
});
test("QA-08 (emisión) · Gift Card L100: se acredita UNA vez como saldo promocional, aparte del dinero", async () => {
  const db = await conPuntos("Jimena", 55);
  const s = await R.solicitar(db, { socio: "Jimena", recompensaId: "inm_giftcard_100" });
  const a = await R.cambiarEstado(db, { id: s.solicitud.id, estado: "aprobada", disponibilidadComprobada: true });
  assert.equal(a.estado, "entregada");
  await R.cambiarEstado(db, { id: s.solicitud.id, estado: "aprobada", disponibilidadComprobada: true });
  assert.equal(await R.saldoPromocional(db, "jimena"), 100);
  const mov = [...db._cols.get("billetera_movimientos").values()][0];
  assert.equal(mov.subcuenta, "promocional"); assert.equal(mov.negocio, "sublicuentas"); assert.deepEqual(mov.excluirPlataformas, ["netflix"]);
  assert.equal(db._cols.get("billetera_movimientos").size, 1);
});
test("los dueños no pueden pedir premios", async () => {
  const db = await conPuntos("Relojes", 60);
  assert.equal((await R.solicitar(db, { socio: "Relojes", recompensaId: "inm_gemini" })).error, "no_participa");
});
