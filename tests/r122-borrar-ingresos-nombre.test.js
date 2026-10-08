const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
const f5 = fs.readFileSync(path.join(__dirname, "..", "index_05_finanzas_menus.js"), "utf8");
function extraer(src, nombre) { const i = src.indexOf(`function ${nombre}(`); assert.ok(i >= 0, nombre); let d = 0; const j = src.indexOf("{", src.indexOf(")", i)); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(src.lastIndexOf("\n", i) + 1, k + 1); } } }
const moneyLps = (n) => `${Number(n || 0).toFixed(2)} Lps`;
const F = new Function("moneyLps", `${["safeBtnLabelLocal", "nombreMovimientoFinanzas", "claveNombreR124", "estadoMovimientoFinanzas", "textoBtnEliminarMovimiento", "R122_montoCorto", "R122_clavesRepetidas"].map((n) => extraer(h, n)).join("\n")}; return { textoBtnEliminarMovimiento, R122_clavesRepetidas };`)(moneyLps);

test("R122: borrar ingresos por fecha muestra el NOMBRE del cliente en cada botón", () => {
  const m = { tipo: "ingreso", fecha: "04/10/2026", monto: 150, plataforma: "⭐ Netflix Premium VIP", banco: "BAC Credomatic", clienteNombre: "Ever Figueroa" };
  const t = F.textoBtnEliminarMovimiento(m);
  assert.match(t, /^L150 · Ever Figueroa · ⭐ Netflix Premium VIP/);
  assert.ok(Array.from(t).length <= 60);
  assert.match(F.textoBtnEliminarMovimiento({ tipo: "ingreso", monto: 80, detalle: "Mari Zavala", plataforma: "Prime Video" }), /^L80 · Mari Zavala · Prime Video/, "ingresos manuales: el detalle");
  assert.match(F.textoBtnEliminarMovimiento({ tipo: "ingreso", monto: 110, socioNombre: "Jimena" }), /Jimena/);
  assert.match(F.textoBtnEliminarMovimiento({ tipo: "ingreso", monto: 70 }), /Sin nombre/);
  assert.match(F.textoBtnEliminarMovimiento({ ...m, estadoFinanciero: "anulado" }), /^🚫 anulado L150/);
  assert.match(F.textoBtnEliminarMovimiento({ ...m, monto: -150, reversaDe: "x" }), /^↩️ reversa L-150/);
  assert.match(F.textoBtnEliminarMovimiento({ tipo: "egreso", fecha: "04/10/2026", monto: 50, motivo: "Pago" }), /^04\/10\/2026 • 50\.00 Lps • Pago/, "egresos igual que antes");
});

test("R122/R124: el mismo cliente más de una vez el mismo día se marca ⚠️ (sin contar anulados/reversas)", () => {
  const a = { tipo: "ingreso", monto: 150, clienteNombre: "Ever Figueroa" }, b = { ...a }, c = { ...a, estadoFinanciero: "anulado" }, d = { tipo: "ingreso", monto: 80, clienteNombre: "Ever Figueroa" };
  const rep = F.R122_clavesRepetidas([a, b, c, d]);
  assert.deepEqual([a, b, c, d].map(rep), [true, true, false, true], 'R124: mismo cliente el mismo día aunque cambie el monto');
  assert.match(F.textoBtnEliminarMovimiento(a, true), /^⚠️ L150 · Ever Figueroa/);
});

test("R122: la lista va ordenada por nombre con total vigente, y la confirmación dice cliente, banco y quién lo registró", () => {
  assert.match(h, /claveNombreR124\(a\)\.localeCompare\(claveNombreR124\(b\), "es"\)/); // R124: por nombre normalizado, después de poner los anulados al final
  assert.match(h, /textoBtnEliminarMovimiento\(m, esRepetido\(m\)\), callback_data: `fin:del:pick:\$\{idCortoFinanzas\(m\.id\)\}`/);
  assert.match(h, /vigente\$\{vigentes\.length === 1 \? "" : "s"\} · total/);
  const conf = new Function("finTipoLabel", "extraerFechaMovimiento", "moneyLps", "finConceptoLabel", "finExtraLabel", `${extraer(f5, "textoConfirmarEliminacionMovimiento")}; return textoConfirmarEliminacionMovimiento;`)(() => "Ingreso", (m) => m.fecha, moneyLps, (m) => m.plataforma, () => "");
  const txt = conf({ fecha: "04/10/2026", monto: 150, plataforma: "Netflix VIP", banco: "BAC Credomatic", clienteNombre: "Ever_Figueroa", registradoPor: "libni", origenCanal: "apk", createdAt: "2026-10-04T20:15:00.000Z" });
  assert.match(txt, /Cliente: EverFigueroa/); assert.match(txt, /Banco: BAC Credomatic/); assert.match(txt, /Registrado: Relojes · apk · 14:15 h/);
});

// ---------- R122 · Anular desde Telegram (mismo proceso que la APK/web) ----------
const L = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
function libroAnular(store) {
  const ref = (col, id) => ({ col, id, _k: `${col}/${id}` });
  let n = 0;
  const db = { collection: (col) => ({ doc: (id) => ref(col, id || `auto${++n}`) }),
    runTransaction: async (fn) => { const buf = []; const tx = { get: async (r) => ({ exists: store.has(r._k), data: () => store.get(r._k) }), set: (r, v, o) => buf.push([r._k, v, o]) }; const out = await fn(tx); for (const [k, v, o] of buf) store.set(k, o?.merge ? { ...(store.get(k) || {}), ...v } : v); return out; } };
  const admin = { firestore: { Timestamp: { fromDate: (d) => d } } };
  const R = require("../lib_finanzas_reglas");
  return new Function("db", "R", "admin", `const CXC = "cuentas_por_cobrar"; const ymdToDmy = (v) => { const [y, m, d] = String(v).split("-"); return d + "/" + m + "/" + y; }; const hoyYmd = () => "2026-10-07"; ${extraer(L, "fechaCampos")}; ${extraer(L, "opDocId")}; const userErrR122 = (msg) => Object.assign(new Error(msg), { userError: true }); ${extraer(L, "motivoBloqueoAnular")}; ${extraer(L, "anularMovimientoTg")}; return { anularMovimientoTg, motivoBloqueoAnular };`)(db, R, admin);
}

test("R122: anular desde Telegram NO borra: marca anulado + reversa negativa + auditoría; doble toque no duplica", async () => {
  const store = new Map([["finanzas_movimientos/oper_op_u_a_cobro", { tipo: "ingreso", subtipo: "cobro_compra", monto: 150, banco: "BAC Credomatic", bancoId: "bac", clienteNombre: "Ever Figueroa", fecha: "04/10/2026", fechaPago: "2026-10-04" }]]);
  const F = libroAnular(store), actor = { usuario: "sublicuentas", uid: "123" };
  await assert.rejects(F.anularMovimientoTg({ movimientoId: "oper_op_u_a_cobro", motivo: "x", opId: "tg-1", actor }), /motivo/);
  const r = await F.anularMovimientoTg({ movimientoId: "oper_op_u_a_cobro", motivo: "Voucher repetido", opId: "tg-1", actor });
  assert.equal(r.duplicado, false); assert.equal(r.cliente, "Ever Figueroa");
  const orig = store.get("finanzas_movimientos/oper_op_u_a_cobro"), rev = store.get("finanzas_movimientos/oper_op_u_a_cobro_rev");
  assert.equal(orig.estadoFinanciero, "anulado"); assert.equal(orig.motivoAnulacion, "Voucher repetido"); assert.equal(orig.monto, 150, "el original no se toca");
  assert.equal(rev.monto, -150); assert.equal(rev.reversaDe, "oper_op_u_a_cobro"); assert.equal(rev.bancoId, "bac"); assert.equal(rev.fechaPago, "2026-10-07");
  const aud = [...store.entries()].filter(([k]) => k.startsWith("auditoria_eventos/")).map(([, v]) => v);
  assert.equal(aud.length, 1); assert.equal(aud[0].accion, "anular_movimiento"); assert.equal(aud[0].motivo, "Voucher repetido");
  assert.equal((await F.anularMovimientoTg({ movimientoId: "oper_op_u_a_cobro", motivo: "Voucher repetido", opId: "tg-1", actor })).duplicado, true);
  await assert.rejects(F.anularMovimientoTg({ movimientoId: "oper_op_u_a_cobro", motivo: "otra vez", opId: "tg-2", actor }), /ya está anulado/);
  await assert.rejects(F.anularMovimientoTg({ movimientoId: "oper_op_u_a_cobro_rev", motivo: "reversa", opId: "tg-3", actor }), /reversa/);
});

test("R122: anular un abono devuelve el dinero al pendiente; planilla y ventas no se anulan aquí", async () => {
  const store = new Map([
    ["finanzas_movimientos/ab1", { tipo: "ingreso", subtipo: "cobro_pendiente_cliente", monto: 50, bancoId: "bac", banco: "BAC", cuentaId: "cx1" }],
    ["cuentas_por_cobrar/cx1", { saldoPendiente: 0, montoRecibidoInicial: 100, montoRecibidoPosterior: 50, estado: "pagado" }],
    ["finanzas_movimientos/pl1", { tipo: "egreso", subtipo: "pago_planilla", monto: 500, planillaPagoId: "pp1" }],
    ["finanzas_movimientos/v1", { tipo: "venta", monto: 150 }],
  ]);
  const F = libroAnular(store), actor = { usuario: "relojes", uid: "9" };
  await F.anularMovimientoTg({ movimientoId: "ab1", motivo: "Abono duplicado", opId: "tg-9", actor });
  const c = store.get("cuentas_por_cobrar/cx1"); assert.equal(c.saldoPendiente, 50); assert.equal(c.montoRecibidoPosterior, 0); assert.equal(c.estado, "parcial");
  await assert.rejects(F.anularMovimientoTg({ movimientoId: "pl1", motivo: "planilla", opId: "tg-10", actor }), /planilla/);
  await assert.rejects(F.anularMovimientoTg({ movimientoId: "v1", motivo: "venta", opId: "tg-11", actor }), /no se anula aquí/);
});

test("R122: en 'borrar por fecha' los movimientos del centro financiero ofrecen Anular (con motivo) en vez de mandar a la APK", () => {
  assert.doesNotMatch(h, /👉 APK o Web → Control financiero → \*Movimientos\* → \*Anular\*/);
  assert.match(h, /text: "🚫 Anular este \(pide motivo\)", callback_data: `fin:anul:ask:\$\{idCortoFinanzas\(id\)\}`/);
  assert.match(h, /if \(data\.startsWith\("fin:anul:ask:"\)\)/);
  assert.match(h, /pending\.set\(String\(chatId\), \{ mode: "finAnularMotivo", movimientoId: id, opId: finLibro\.newOpId\(\) \}\)/);
  assert.match(h, /if \(p\.mode === "finAnularMotivo"\)/);
  assert.match(h, /finLibro\.anularMovimientoTg\(\{ movimientoId: p\.movimientoId, motivo: t, opId: p\.opId, actor: await finLibro\.actorDe\(userId\) \}\)/);
  assert.match(h, /Anular es exclusivo de Sublicuentas y Relojes/);
  assert.ok(Buffer.byteLength("fin:anul:ask:~zzzzzzzzzz") <= 64);
});

test("R123: en Telegram los anulados/reversas van al final; el Excel del bot los pone en su hoja 'Anulados' y no los suma", () => {
  assert.match(h, /todos\.sort\(\(a, b\) => \(estadoMovimientoFinanzas\(a\) \? 1 : 0\) - \(estadoMovimientoFinanzas\(b\) \? 1 : 0\) \|\| claveNombreR124/);
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  assert.match(x, /const movimientos = todosR123\.filter\(\(m\) => !esAnuladoR123\(m\) && !m\.raw\?\.reversaDe\)/);
  assert.match(x, /simpleSheet\(wb, "Anulados", "MOVIMIENTOS ANULADOS \/ CORREGIDOS"/);
  assert.match(x, /createDetalleSheet\(wb, "Egresos"[^\n]*\n\s*crearHojaAnuladosR123\(wb, anulados, subtitle\);/);
});

// ---------- R124 · sincronía con la APK y repetidos reales ----------
const F124 = new Function("moneyLps", `${["safeBtnLabelLocal", "nombreMovimientoFinanzas", "claveNombreR124", "estadoMovimientoFinanzas", "textoBtnEliminarMovimiento", "R122_montoCorto", "R122_clavesRepetidas"].map((n) => extraer(h, n)).join("\n")}; return { nombreMovimientoFinanzas, R122_clavesRepetidas, textoBtnEliminarMovimiento };`)(moneyLps);

test("R124: el ingreso manual (cliente en 'detalle') cuenta como nombre; una fecha en el detalle no", () => {
  assert.equal(F124.nombreMovimientoFinanzas({ detalle: "Michell Torrez" }), "Michell Torrez");
  assert.equal(F124.nombreMovimientoFinanzas({ detalle: "01/10/2026" }), "");
  assert.equal(F124.nombreMovimientoFinanzas({ clienteNombre: "Ana", detalle: "otra cosa" }), "Ana");
});

test("R124: el mismo cliente dos veces el mismo día se marca ⚠️ aunque cambie el monto, las mayúsculas o las tildes", () => {
  const manual = { tipo: "ingreso", monto: 260, detalle: "Mariana Garcia", plataforma: "Netflix, hbo, prime video" };
  const apk = { tipo: "ingreso", monto: 130, clienteNombre: "MARIANA  García", plataforma: "Netflix Premium" };
  const otro = { tipo: "ingreso", monto: 99, detalle: "Gerson David" };
  const anulado = { tipo: "ingreso", monto: 99, detalle: "Gerson David", estadoFinanciero: "anulado" };
  const rep = F124.R122_clavesRepetidas([manual, apk, otro, anulado]);
  assert.deepEqual([manual, apk, otro, anulado].map(rep), [true, true, false, false]);
  assert.match(F124.textoBtnEliminarMovimiento(manual, true), /^⚠️ L260 · Mariana Garcia/);
});

test("R124: la lista tiene páginas (antes se cortaba en 40) y filtro de repetidos; botones caben en Telegram", () => {
  assert.match(h, /async function panelEliminarPorFechaR124\(chatId, userId, tipo, fecha, page = 0, soloRep = false\)/);
  assert.match(h, /return panelEliminarPorFechaR124\(chatId, userId, p\.tipo === "egreso" \? "egreso" : "ingreso", fecha, 0, false\);/);
  assert.match(h, /if \(data\.startsWith\("fin:del:pg:"\)\)/);
  assert.doesNotMatch(h, /list\.slice\(0, 40\)/);
  for (const cb of ["fin:del:pg:i:01102026:12:r", "fin:del:pg:e:31122026:0:t"]) assert.ok(Buffer.byteLength(cb) <= 64);
});

test("R124: desde el 01/10/2026 la colección vieja 'finanzas' ya no se cuenta (igual que la APK/web); antes sí", () => {
  const f5src = fs.readFileSync(path.join(__dirname, "..", "index_05_finanzas_menus.js"), "utf8");
  const extraerFecha = new Function(`${extraer(f5src, "extraerFechaMovimiento")}; return extraerFechaMovimiento;`);
  let fuera;
  try { fuera = new Function("extraerFechaMovimiento", `const INICIO_LIBRO_R124 = Date.UTC(2026, 9, 1); ${extraer(f5src, "fueraDelLibroR124")}; return fueraDelLibroR124;`)((r) => r.fecha); } catch (e) { throw e; }
  assert.equal(fuera({ _source: "finanzas", fecha: "01/10/2026" }), true);
  assert.equal(fuera({ _source: "finanzas", fecha: "30/09/2026" }), false, "el histórico anterior sigue");
  assert.equal(fuera({ _source: "finanzas_movimientos", fecha: "01/10/2026" }), false);
  assert.match(f5src, /function addRowsDedup\(map, rows = \[\]\) \{ for \(const row of rows\) \{ if \(!row\?\.id \|\| fueraDelLibroR124\(row\)\) continue;/);
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  assert.match(x, /if \(col === "finanzas" && row\.fechaTs >= dmyToMillis\("01\/10\/2026"\)\) continue;/);
  void extraerFecha;
});

test("R124: el Excel del bot trae la hoja 'Revisar repetidos' (mismo cliente el mismo día, sin restar nada)", () => {
  const x = fs.readFileSync(path.join(__dirname, "..", "index_10_reportes_excel.js"), "utf8");
  assert.match(x, /crearHojaRepetidosR124\(wb, movimientos\.filter\(\(m\) => m\.tipo === "ingreso" && m\.kind !== "ajuste"\), subtitle\);/);
  assert.match(x, /simpleSheet\(wb, "Revisar repetidos", "POSIBLES VOUCHERS REPETIDOS"/);
});
