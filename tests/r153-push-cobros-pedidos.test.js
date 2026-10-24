// R153 · Fase 2 · Push de cobros 7 AM / 7 PM desde el servidor + push de pedido nuevo de socio.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PC = require("../index_35_push_cobros");
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const docs = [
  { id: "c1", data: { vendedor: "Relojes", servicios: [{ fechaRenovacion: "24/10/2026", precio: 130 }, { fechaRenovacion: "24/10/2026", precio: 90 }] } },
  { id: "c2", data: { vendedor: "Relojes", servicios: [{ fechaRenovacion: "2026-10-24", precio: 150, beneficiarioTipo: "tercero", beneficiarioNombre: "Beto" }] } },
  { id: "c3", data: { servicios: [{ vendedor: "Geissel", fechaRenovacion: "25/10/2026", precio: 80 }] } },
  { id: "c4", data: { vendedor: "Relojes", servicios: [{ fechaRenovacion: "20/10/2026", precio: 70 }] } },
  { id: "c5", data: { vendedor: "Sublicuentas", consolidadoEn: "c9", servicios: [{ fechaRenovacion: "24/10/2026", precio: 999 }] } },
];
const hoy = PC.dmyATs("24/10/2026");

test("7 AM: cada vendedor solo sus cobros; cliente y tercero son cobros distintos; cuenta vencidos", () => {
  const por = PC.cobrosPorVendedor(docs);
  const a = PC.avisoCobros(por.get("relojes"), "hoy", hoy);
  assert.equal(a.titulo, "💰 Hoy toca cobrar a 2 clientes");
  assert.equal(a.cuerpo, "Total por cobrar hoy: L370 · además 1 vencido sin gestionar. Toque para abrir Cobros.");
  assert.deepEqual(a.data, { tipo: "cobros", ir: "renovar", tab: "hoy" });
  assert.equal(PC.avisoCobros(por.get("sublicuentas"), "hoy", hoy), null, "ficha consolidada no cuenta");
});

test("7 PM: mañana vencen (Geisell incluye registros viejos 'Geissel')", () => {
  const por = PC.cobrosPorVendedor(docs);
  const a = PC.avisoCobros(por.get("geisell"), "manana", hoy);
  assert.equal(a.titulo, "📅 Mañana vencen 1");
  assert.match(a.cuerpo, /L80/);
  assert.equal(PC.avisoCobros(por.get("relojes"), "manana", hoy), null);
});

test("el aviso pasa el filtro de datos sensibles y respeta el interruptor de cobros", async () => {
  const P = require("../lib_push");
  const a = PC.avisoCobros(PC.cobrosPorVendedor(docs).get("relojes"), "hoy", hoy);
  assert.doesNotThrow(() => P.textoSeguro(a.cuerpo, 180));
  assert.equal(await PC.enviarPushCobros({ db: null, admin: null, tipo: "hoy", scheduledDateDMY: "24/10/2026", horaLimite: 12, horaActual: 15 }).then((r) => r.omitido), "fuera_de_hora");
  const ix = leer("index.js");
  assert.match(ix, /id: "push_cobros_7am", type: "daily", hour: 7/);
  assert.match(ix, /id: "push_cobros_7pm", type: "daily", hour: 19/);
});

test("pedido nuevo de socio avisa SOLO al vendedor elegido por el socio (sin datos de entrega)", () => {
  const s = leer("server_api.js");
  const i = s.indexOf("Fase 2 · push SOLO al vendedor que eligió el socio");
  assert.ok(i > s.indexOf('app.post("/rev/compra"'));
  const bloque = s.slice(i, i + 700);
  assert.match(bloque, /usuarios: \[destino\.key\]/);
  assert.doesNotMatch(bloque, /correo|perfilNombre|clave|dispositivo/);
});
