// R197c · Exportador del Excel de clientes (index_11): rótulos separados, IDs reales, PIN sin nombre. Datos FICTICIOS.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const ExcelJS = require("exceljs");
const B = path.join(__dirname, "..");
const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
const hoy = new Date(); const dmy = (dias) => { const d = new Date(hoy.getTime() + dias * 86400000); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
const CLIENTES = [
  { id: "cli_a", nombre: "Titular A", telefono: "50411112222", servicios: [{ compraId: "cmp_a1", inventarioId: "inv_1", plataforma: "hbomax", precio: 90, fechaRenovacion: dmy(20), mesesContratados: 1, perfil: "Perfil Ana", vendedor: "Relojes" }] },
  { id: "cli_b", nombre: "Titular B", servicios: [{ compraId: "cmp_b1", plataforma: "iptv1", precio: 1200, fechaRenovacion: dmy(300), mesesContratados: 12, pin: "4455", vendedor: "Relojes" }, { compraId: "cmp_b2", plataforma: "netflix", precio: 140, fechaRenovacion: dmy(-3), vendedor: "Relojes" }] },
  { id: "cli_c", nombre: "Titular C", servicios: [{ compraId: "cmp_c1", plataforma: "disneyp", precio: 100, fechaRenovacion: dmy(-5), vendedor: "Geisell" }] },
  { id: "cli_d", nombre: "Sin servicios", total_mensual: 60, servicios: [] },
];
stub("index_01_core", { ExcelJS, db: {} });
stub("index_17_vendedores_servicio", { vendedorEfectivoServicio: (s) => ({ vendedor: s.vendedor || "" }), resumenVendedoresCliente: (svs) => ({ vendedores: [...new Set(svs.map((s) => s.vendedor).filter(Boolean))], vendedores_norm: [] }) });
stub("index_30_espejo_firestore", { getColeccion: async () => ({ docs: CLIENTES.map((c) => ({ id: c.id, data: () => { const { id, ...r } = c; return r; } })) }) });
global.logErr = () => {};
const { generarExcelClientesGeneral } = require(path.join(B, "index_11_clientes_excel.js"));

const leer = async () => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarExcelClientesGeneral()); return wb; };
const filas = (ws) => { const out = []; ws.eachRow((r) => out.push(r.values.slice(1).map((v) => (v && v.result !== undefined ? v.result : v)))); return out; };

test("Resumen separa precio registrado, valor vigente, mensualizado comprobado e ingresos cobrados", async () => {
  const wb = await leer(); const f = filas(wb.getWorksheet("Resumen"));
  const kpi = f.findIndex((r) => r.includes("💰 Valor de cartera vigente")); assert.ok(kpi >= 0, "KPI renombrado");
  assert.ok(!f.flat().includes("💰 Pagos mensuales"));
  const v = (label) => (f.find((r) => r[1] === label) || [])[2];
  assert.equal(v("Precio registrado (todas las fichas)"), 90 + 1200 + 140 + 100 + 60);
  assert.equal(v("Valor de cartera vigente"), 90 + 1200, "solo servicios activos");
  assert.equal(v("Valor mensualizado comprobado"), 90 + 100, "1200 / 12 meses guardados; no se infiere por el vencimiento");
  assert.equal(v("Ingresos cobrados"), "Ver Finanzas");
});

test("Pagos Servicios: IDs reales al final, PIN nunca con el nombre del perfil, columnas viejas en su lugar", async () => {
  const wb = await leer(); const f = filas(wb.getWorksheet("Pagos Servicios"));
  const h = f.find((r) => r[0] === "#");
  assert.deepEqual(h.slice(0, 9), ["#", "Titular", "Perfil", "Número", "Vendedor", "Plataforma", "Correo / usuario", "PIN", "Precio registrado"]);
  assert.deepEqual(h.slice(13), ["ID cliente", "ID compra", "ID cuenta madre", "Meses contratados"]);
  const a = f.find((r) => r[14] === "cmp_a1");
  assert.equal(a[7] || "", "", "sin PIN guardado → vacío (antes salía «Perfil Ana»)");
  assert.deepEqual([a[13], a[15], a[16]], ["cli_a", "inv_1", 1]);
  assert.equal(f.find((r) => r[14] === "cmp_b1")[7], "4455");
  assert.equal(f.find((r) => r[14] === "cmp_c1")[15] || "", "", "sin cuenta madre → vacío, no inventado");
});
