"use strict";
// R200e · Auditoría en el Excel: el Detalle debe decir QUIEN COMPRA (el tercero), no el titular del número que pagó.
// Caso real: la titular pagó la cuenta de su tercera → debe salir la tercera. Datos FICTICIOS en memoria.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { FakeDb } = require("./helpers/fake-firestore");
const B = path.join(__dirname, "..");

function cargar(db) {
  const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (/index_10_reportes_excel|index_31_finanzas_libro/.test(k)) delete require.cache[k];
  stub("index_01_core", { ExcelJS, db, FINANZAS_COLLECTION: "finanzas_movimientos", bot: { sendMessage: async () => {} }, admin: { firestore: { Timestamp: { fromDate: (d) => d } } } });
  return require("../index_10_reportes_excel");
}

const clientes = {
  cG: { nombre: "Gladys Prueba", servicios: [
    { compraId: "kE", plataforma: "Disney Premium sin ESPN", beneficiarioTipo: "tercero", beneficiarioNombre: "Elsa Tercera" },
    { compraId: "kG", plataforma: "Netflix VIP", beneficiarioTipo: "titular" },
  ] },
  cA: { nombre: "Andrés Prueba", servicios: [{ compraId: "kA", plataforma: "Netflix VIP", beneficiarioTipo: "titular" }] },
  cM: { nombre: "Marta Prueba", servicios: [
    { compraId: "kM1", plataforma: "HBO Max", beneficiarioTipo: "tercero", beneficiarioNombre: "Hijo Tercero" },
    { compraId: "kM2", plataforma: "Prime Video", beneficiarioTipo: "tercero", beneficiarioNombre: "Prima Tercera" },
  ] },
  cS: { nombre: "Sin Id Prueba", servicios: [
    { compraId: "kS1", plataforma: "Netflix VIP", beneficiarioTipo: "tercero", beneficiarioNombre: "Ana Tercera" },
    { compraId: "kS2", plataforma: "Netflix VIP", beneficiarioTipo: "titular" },
  ] },
};
const mov = (id, extra) => ({ tipo: "ingreso", subtipo: "cobro_renovacion", fechaPago: "2026-11-16", banco: "Occidente", bancoId: "b1", createdAt: `2026-11-16T1${id.length % 9}:00:00Z`, ...extra });
const movimientos = {
  m1: mov("m1", { monto: 70, plataforma: "Disney Premium sin ESPN", clienteId: "cG", clienteNombre: "Gladys Prueba", compraId: "kE", registradoPor: "sublicuentas" }),
  m2: mov("m2x", { monto: 150, plataforma: "Netflix VIP", clienteId: "cA", clienteNombre: "Andrés Prueba", compraId: "kA", banco: "BAC", bancoId: "b2" }),
  // un pago de la titular por DOS terceros (mismo banco, mismo día) → una fila con los dos nombres
  m3: mov("m3xx", { monto: 160, plataforma: "HBO Max", clienteId: "cM", clienteNombre: "Marta Prueba", compraId: "kM1", banco: "Banpaís", bancoId: "b3" }),
  m4: mov("m4xxx", { monto: 70, plataforma: "Prime Video", clienteId: "cM", clienteNombre: "Marta Prueba", compraId: "kM2", banco: "Banpaís", bancoId: "b3" }),
  // sin compraId y la ficha tiene Netflix de tercero Y del titular → no se adivina: queda el titular
  m5: mov("m5xxxx", { monto: 150, plataforma: "Netflix VIP", clienteId: "cS", clienteNombre: "Sin Id Prueba", banco: "BAC", bancoId: "b2" }),
  // sin compraId pero la única Disney de la ficha es de la tercera → sí se usa
  m6: mov("m6xxxxx", { monto: 70, plataforma: "Disney Premium sin ESPN", clienteId: "cG", clienteNombre: "Gladys Prueba", banco: "BAC", bancoId: "b2", fechaPago: "2026-11-17" }),
  // Detalle escrito a mano distinto del titular → se respeta
  m7: mov("m7xxxxxx", { monto: 80, plataforma: "Disney Premium sin ESPN", clienteId: "cG", clienteNombre: "Gladys Prueba", compraId: "kE", detalle: "Pago adelantado diciembre", banco: "BAC", bancoId: "b2", fechaPago: "2026-11-18" }),
};

async function libro() {
  const db = new FakeDb();
  for (const [id, d] of Object.entries(clientes)) await db.collection("clientes").doc(id).set(d);
  for (const [id, d] of Object.entries(movimientos)) await db.collection("finanzas_movimientos").doc(id).set(d);
  const { generarReporteExcelPorRango } = cargar(db);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarReporteExcelPorRango("16/11/2026", "18/11/2026"));
  return wb;
}
const filasIngresos = (wb) => {
  const ws = wb.getWorksheet("Ingresos"); const out = [];
  ws.eachRow((r) => { const v = r.values; if (typeof v[3] === "number" || (v[3] && typeof v[3] === "object" && "result" in v[3])) out.push({ plat: String(v[2] || ""), monto: typeof v[3] === "number" ? v[3] : v[3].result, detalle: String(v[6] || "") }); });
  return out.filter((f) => f.plat && !/total/i.test(f.plat));
};

test("1 · Ingresos: sale quien compra (tercera), no la titular que pagó", async () => {
  const f = filasIngresos(await libro());
  const disney = f.filter((x) => x.monto === 70 && /Disney/.test(x.plat));
  assert.equal(disney.length, 2, JSON.stringify(f));
  for (const d of disney) assert.equal(d.detalle, "Elsa Tercera");
  assert.ok(!f.some((x) => x.detalle === "Gladys Prueba"), "la titular que pagó no aparece como compradora");
  assert.equal(f.find((x) => x.monto === 150 && x.detalle !== "Sin Id Prueba").detalle, "Andrés Prueba", "si compra el mismo titular, queda su nombre");
});

test("2 · un pago por dos terceros: una fila, monto sumado, los dos compradores", async () => {
  const f = filasIngresos(await libro());
  const g = f.find((x) => x.monto === 230);
  assert.ok(g, JSON.stringify(f));
  assert.equal(g.detalle, "Hijo Tercero / Prima Tercera");
});

test("3 · sin compraId: solo si no hay duda; detalle escrito a mano se respeta; montos no cambian", async () => {
  const wb = await libro(); const f = filasIngresos(wb);
  assert.ok(f.some((x) => x.monto === 150 && x.detalle === "Sin Id Prueba"), "ambiguo → titular de siempre");
  assert.ok(f.some((x) => x.monto === 70 && x.detalle === "Elsa Tercera" && /Disney/.test(x.plat)));
  assert.ok(f.some((x) => x.monto === 80 && x.detalle === "Pago adelantado diciembre"));
  assert.equal(f.reduce((s, x) => s + x.monto, 0), 70 + 150 + 160 + 70 + 150 + 70 + 80);
});

test("4 · función pura: comprador por compraId, por plataforma sin duda, y nada si es el titular", () => {
  const { compradorDeMovimientoR200: c } = cargar(new FakeDb());
  assert.equal(c({ compraId: "kE" }, clientes.cG), "Elsa Tercera");
  assert.equal(c({ compraId: "kG" }, clientes.cG), "");
  assert.equal(c({ compraId: "kM1,kM2" }, clientes.cM), "Hijo Tercero / Prima Tercera");
  assert.equal(c({ plataforma: "Netflix VIP" }, clientes.cS), "");
  assert.equal(c({ plataforma: "HBO Max" }, clientes.cM), "Hijo Tercero");
  assert.equal(c({ compraId: "kE" }, null), "");
});

test("5 · DETALLE_VENTAS también muestra a quien compra", async () => {
  const db = new FakeDb();
  for (const [id, d] of Object.entries(clientes)) await db.collection("clientes").doc(id).set(d);
  await db.collection("finanzas_movimientos").doc("op9_venta").set({ tipo: "venta", subtipo: "renovacion", fechaPago: "2026-11-16", monto: 70, plataforma: "Disney Premium sin ESPN", clienteId: "cG", clienteNombre: "Gladys Prueba", compraId: "kE" });
  await db.collection("finanzas_movimientos").doc("op9_cobro").set({ tipo: "ingreso", subtipo: "cobro_renovacion", fechaPago: "2026-11-16", monto: 70, operacionId: "op9", banco: "BAC", plataforma: "Disney Premium sin ESPN", clienteId: "cG", clienteNombre: "Gladys Prueba", compraId: "kE" });
  const { generarReporteExcelPorRango } = cargar(db);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarReporteExcelPorRango("16/11/2026", "16/11/2026"));
  const txt = []; wb.getWorksheet("DETALLE_VENTAS").eachRow((r) => txt.push(r.values.map(String).join("|")));
  assert.ok(txt.some((t) => t.includes("Elsa Tercera")), txt.join("\n"));
  assert.ok(!txt.some((t) => t.includes("Gladys Prueba")));
});

test("6 · cobro guardado SIN clienteId (ingreso manual): se ubica la ficha por nombre o teléfono, solo si es única", async () => {
  const db = new FakeDb();
  for (const [id, d] of Object.entries(clientes)) await db.collection("clientes").doc(id).set({ ...d, telefono: id === "cG" ? "+504 9999-1111" : "" });
  await db.collection("clientes").doc("dup1").set({ nombre: "Nombre Repetido", servicios: [{ compraId: "x1", plataforma: "HBO Max", beneficiarioTipo: "tercero", beneficiarioNombre: "Otro Tercero" }] });
  await db.collection("clientes").doc("dup2").set({ nombre: "Nombre Repetido", servicios: [] });
  const base = { tipo: "ingreso", fechaPago: "2026-11-16", banco: "Occidente", bancoId: "b1" };
  await db.collection("finanzas_movimientos").doc("x1").set({ ...base, monto: 70, plataforma: "Disney Premium sin ESPN", clienteNombre: "Gladys Prueba" });
  await db.collection("finanzas_movimientos").doc("x2").set({ ...base, monto: 71, plataforma: "Disney Premium sin ESPN", clienteNombre: "Pagó Otra", telefono: "99991111", banco: "BAC", bancoId: "b2" });
  await db.collection("finanzas_movimientos").doc("x3").set({ ...base, monto: 72, plataforma: "HBO Max", clienteNombre: "Nombre Repetido", banco: "Banpaís", bancoId: "b3" });
  const { generarReporteExcelPorRango } = cargar(db);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarReporteExcelPorRango("16/11/2026", "16/11/2026"));
  const f = filasIngresos(wb);
  assert.equal(f.find((x) => x.monto === 70).detalle, "Elsa Tercera", JSON.stringify(f));
  assert.equal(f.find((x) => x.monto === 71).detalle, "Elsa Tercera", "por teléfono");
  assert.equal(f.find((x) => x.monto === 72).detalle, "Nombre Repetido", "nombre en 2 fichas → no se adivina");
});

test("7 · otras formas de guardar al tercero: perfil a nombre de otra clienta, tercero sin nombre, compra en la ficha de la que usa, IDs en servicios[]", () => {
  const { compradorDeMovimientoR200: c } = cargar(new FakeDb());
  // perfil con nombre de otra persona en un servicio "titular" → solo si esa persona es otra ficha del CRM
  const g = { nombre: "Gladys Prueba", servicios: [{ compraId: "k1", plataforma: "Disney", beneficiarioTipo: "titular", perfiles: [{ nombre: "Elsa Tercera" }] }] };
  assert.equal(c({ compraId: "k1" }, g), "", "sin ficha de Elsa no se adivina");
  // tercero marcado sin nombre: se usa el nombre del perfil
  const g2 = { nombre: "Gladys Prueba", servicios: [{ compraId: "k2", plataforma: "Disney", beneficiarioTipo: "tercero", perfiles: [{ nombre: "Elsa Tercera" }] }] };
  assert.equal(c({ compraId: "k2" }, g2), "Elsa Tercera");
  // la compra vive en la ficha de Elsa, pero el cobro se registró a nombre de Gladys
  const elsa = { nombre: "Elsa Tercera", servicios: [{ compraId: "k3", plataforma: "Disney", beneficiarioTipo: "titular" }] };
  const idx = new Map([["k3", [elsa, elsa.servicios[0]]]]);
  assert.equal(c({ compraId: "k3", clienteNombre: "Gladys Prueba" }, { nombre: "Gladys Prueba", servicios: [] }, undefined, idx), "Elsa Tercera");
  // IDs dentro de servicios[] (renovación en lote)
  assert.equal(c({ servicios: [{ compraId: "kE" }] }, clientes.cG), "Elsa Tercera");
});

test("8 · Bodega: la fila del perfil dice quién lo usa y quién pagó → se usa si la ficha no lo marcó como tercero", async () => {
  const db = new FakeDb();
  await db.collection("clientes").doc("cZ").set({ nombre: "Gladys Prueba", servicios: [{ compraId: "kZ", plataforma: "Disney Premium sin ESPN", beneficiarioTipo: "titular" }] });
  await db.collection("inventario").doc("i1").set({ plataforma: "disneyp", clientes: [{ nombre: "Elsa Tercera", pagadoPor: "Gladys Prueba", compraId: "kZ", clienteId: "cZ" }] });
  await db.collection("finanzas_movimientos").doc("z1").set({ tipo: "ingreso", fechaPago: "2026-11-16", monto: 70, banco: "Occidente", bancoId: "b1", plataforma: "Disney Premium sin ESPN", clienteId: "cZ", clienteNombre: "Gladys Prueba", compraId: "kZ" });
  const { generarReporteExcelPorRango } = cargar(db);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarReporteExcelPorRango("16/11/2026", "16/11/2026"));
  assert.equal(filasIngresos(wb).find((x) => x.monto === 70).detalle, "Elsa Tercera");
});
