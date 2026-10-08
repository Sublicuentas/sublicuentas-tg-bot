// lib_contabilidad.js · R134 — GENERADO del mismo texto que HQ (api/_contabilidad.js). No editar uno sin el otro.
const { money, movementKind, movementYmd, movementBankId, anuladoOReversa, bankBalances } = require("./lib_finanzas_reglas");
// ============================================================================================================
// R134 · CONTABILIDAD DE PARTIDA DOBLE + ESTADOS FINANCIEROS (estado de resultados y flujo de caja).
// Lógica PURA, idéntica en HQ (api/_contabilidad.js) y en el bot (lib_contabilidad.js): se generan del MISMO texto.
// Base de efectivo, igual que cierres y saldos: cuenta lo que de verdad entró y salió de los bancos.
//  · Cada movimiento vigente es un ASIENTO con Debe = Haber (cuenta de origen y cuenta de destino).
//  · Anulados/corregidos y sus reversas no generan asiento (misma regla R125 que cierres y saldos).
//  · Ventas (valor acordado) no son efectivo: viven en Pendientes de cobro, no en el libro diario.
//  · Transferencias pasan por 1190 "Transferencias en tránsito": salida y entrada se cancelan.
// ============================================================================================================
const CUENTAS_FIJAS = {
  "1190": { nombre: "Transferencias en tránsito", tipo: "activo" },
  "1199": { nombre: "Bancos por identificar", tipo: "activo" },
  "3100": { nombre: "Capital / saldos de apertura", tipo: "patrimonio" },
  "3900": { nombre: "Ajustes de saldo", tipo: "patrimonio" },
  "4110": { nombre: "Ventas · Perfiles de streaming", tipo: "ingreso" },
  "4120": { nombre: "Ventas · TV Digital", tipo: "ingreso" },
  "4130": { nombre: "Ventas · Música", tipo: "ingreso" },
  "4140": { nombre: "Ventas · Software y licencias", tipo: "ingreso" },
  "4150": { nombre: "Ventas · Cuentas completas", tipo: "ingreso" },
  "4190": { nombre: "Otros ingresos", tipo: "ingreso" },
  "5100": { nombre: "Gastos operativos", tipo: "gasto" },
  "5210": { nombre: "Planilla · Pago de planilla", tipo: "gasto" },
  "5220": { nombre: "Planilla · Comisiones de vendedores", tipo: "gasto" },
  "5230": { nombre: "Planilla · Bonificaciones", tipo: "gasto" },
  "5240": { nombre: "Planilla · Pagos administrativos", tipo: "gasto" },
  "5290": { nombre: "Planilla · Otros", tipo: "gasto" },
};
const CUENTA_CATEGORIA = { perfiles: "4110", tv_digital: "4120", musica: "4130", software: "4140", cuentas_completas: "4150" };
const CUENTA_PLANILLA = { pago_planilla: "5210", comision_vendedor: "5220", bonificacion: "5230", pago_administrativo: "5240", otro_planilla: "5290" };
const ORIGEN_INGRESO = { cobro_compra: "Compras nuevas", cobro_renovacion: "Renovaciones", cobro_pendiente_cliente: "Cobros de pendientes (clientes)", cobro_pendiente_vendedor: "Cobros de pendientes (vendedores)", compra_socio: "Socios / revendedores" };
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function cuentaBanco(bancoId, methods) {
  const b = (methods || []).find((x) => x.id === bancoId);
  return b ? { codigo: `1100-${b.id}`, nombre: `Banco · ${b.nombre}`, tipo: "activo" } : { codigo: "1199", ...CUENTAS_FIJAS["1199"] };
}
function cuentaFija(codigo) { return { codigo, ...CUENTAS_FIJAS[codigo] }; }
function cuentaIngreso(m, clasificar) {
  const plat = String(m.plataforma || "").trim(), cat = String(m.categoria || "").trim();
  if (!plat && !cat) return cuentaFija("4190");
  let c = "";
  try { c = clasificar ? clasificar({ plataforma: plat, categoria: cat, tipoVenta: m.tipoVenta }).categoria : cat; } catch (_) { c = cat; }
  return cuentaFija(CUENTA_CATEGORIA[c] || "4190");
}
function conceptoGasto(m) {
  const t = String(m.categoriaGasto || m.motivo || m.concepto || m.descripcion || m.detalle || "Sin concepto").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1, 60) : "Sin concepto";
}
function nombreMov(m) { return String(m.clienteNombre || m.beneficiario || m.deudorNombre || m.socioNombre || m.motivo || m.detalle || m.plataforma || "").replace(/\s+/g, " ").trim().slice(0, 80); }
function linea(cuenta, debe, haber) { return { cuenta: cuenta.codigo, nombre: cuenta.nombre, tipo: cuenta.tipo, debe: money(debe), haber: money(haber) }; }

// Un movimiento → un asiento (o null si no es efectivo vigente).
function asientoDe(m = {}, methods = [], clasificar = null) {
  if (anuladoOReversa(m)) return null;
  const kind = movementKind(m), monto = money(m.monto), fecha = movementYmd(m);
  if (!fecha || !monto) return null;
  const banco = cuentaBanco(movementBankId(m, methods), methods);
  const base = { id: String(m.id || ""), fecha, tipo: kind, monto: Math.abs(monto), descripcion: "", referencia: nombreMov(m), banco: banco.nombre };
  let lineas;
  if (kind === "ingreso") { const c = cuentaIngreso(m, clasificar); lineas = [linea(banco, monto, 0), linea(c, 0, monto)]; base.descripcion = `Cobro · ${String(m.plataforma || ORIGEN_INGRESO[m.subtipo] || "ingreso").slice(0, 60)}`; }
  else if (kind === "egreso") { lineas = [linea(cuentaFija("5100"), monto, 0), linea(banco, 0, monto)]; base.descripcion = `Gasto · ${conceptoGasto(m)}`; }
  else if (kind === "planilla") { const c = cuentaFija(CUENTA_PLANILLA[m.subtipo] || "5290"); lineas = [linea(c, monto, 0), linea(banco, 0, monto)]; base.descripcion = `Planilla · ${String(m.beneficiario || m.concepto || "").slice(0, 50)}`; }
  else if (kind === "ajuste") { const a = Math.abs(monto); lineas = monto > 0 ? [linea(banco, a, 0), linea(cuentaFija("3900"), 0, a)] : [linea(cuentaFija("3900"), a, 0), linea(banco, 0, a)]; base.descripcion = `Ajuste de saldo · ${String(m.motivo || "").slice(0, 50)}`; }
  else if (kind === "transferencia") { const a = Math.abs(monto); lineas = m.direccion === "salida" ? [linea(cuentaFija("1190"), a, 0), linea(banco, 0, a)] : [linea(banco, a, 0), linea(cuentaFija("1190"), 0, a)]; base.descripcion = `Transferencia ${m.direccion === "salida" ? "enviada" : "recibida"}`; }
  else return null;
  if (monto < 0 && kind !== "ajuste") lineas = lineas.map((l) => ({ ...l, debe: Math.abs(l.haber), haber: Math.abs(l.debe) })); // monto negativo: el asiento va al revés
  return { ...base, lineas };
}
// Saldos de apertura (bases del libro) como asientos contra Capital.
function asientosApertura(libro = {}, methods = [], desde = "", hasta = "") {
  const out = [];
  for (const [bancoId, b] of Object.entries(libro.bases || {})) {
    const s = money(b && b.saldo), f = String((b && b.desde) || "");
    if (!s || !f || (desde && f < desde) || (hasta && f > hasta)) continue;
    const banco = cuentaBanco(bancoId, methods);
    out.push({ id: `apertura_${bancoId}`, fecha: f, tipo: "apertura", monto: Math.abs(s), descripcion: "Saldo de apertura", referencia: banco.nombre, banco: banco.nombre, lineas: s > 0 ? [linea(banco, s, 0), linea(cuentaFija("3100"), 0, s)] : [linea(cuentaFija("3100"), -s, 0), linea(banco, 0, -s)] });
  }
  return out;
}
function libroDiario(movimientos = [], libro = {}, methods = [], desde = "", hasta = "", clasificar = null) {
  const out = asientosApertura(libro, methods, desde, hasta);
  for (const m of movimientos) { const a = asientoDe(m, methods, clasificar); if (a && (!desde || a.fecha >= desde) && (!hasta || a.fecha <= hasta)) out.push(a); }
  out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  out.forEach((a, i) => { a.numero = i + 1; });
  return out;
}
// Balanza de comprobación: suma de Debe y Haber por cuenta. Si el libro está bien, Debe total = Haber total.
function balanzaComprobacion(asientos = []) {
  const map = new Map();
  for (const a of asientos) for (const l of a.lineas) {
    const r = map.get(l.cuenta) || { cuenta: l.cuenta, nombre: l.nombre, tipo: l.tipo, debe: 0, haber: 0 };
    r.debe += l.debe; r.haber += l.haber; map.set(l.cuenta, r);
  }
  const cuentas = [...map.values()].map((r) => ({ ...r, debe: money(r.debe), haber: money(r.haber), saldo: money(["activo", "gasto"].includes(r.tipo) ? r.debe - r.haber : r.haber - r.debe) })).sort((a, b) => a.cuenta.localeCompare(b.cuenta));
  const debe = money(cuentas.reduce((s, r) => s + r.debe, 0)), haber = money(cuentas.reduce((s, r) => s + r.haber, 0));
  return { cuentas, debe, haber, cuadra: Math.abs(debe - haber) < 0.005 };
}
function agrupar(rows, keyFn) {
  const map = new Map();
  for (const r of rows) { const k = keyFn(r); const x = map.get(k) || { nombre: k, monto: 0, n: 0 }; x.monto += r.monto; x.n++; map.set(k, x); }
  return [...map.values()].map((x) => ({ ...x, monto: money(x.monto) })).sort((a, b) => b.monto - a.monto);
}
// Estado de resultados del período (base efectivo).
function estadoResultados(asientos = [], movimientosPorId = new Map()) {
  const ing = [], gas = [], pla = [];
  for (const a of asientos) {
    const m = movimientosPorId.get(a.id) || {};
    if (a.tipo === "ingreso") { const c = a.lineas.find((l) => l.tipo === "ingreso"); ing.push({ monto: c.haber - c.debe, cuenta: c.nombre.replace(/^Ventas · /, ""), origen: ORIGEN_INGRESO[m.subtipo] || "Registro manual" }); }
    else if (a.tipo === "egreso") { const c = a.lineas.find((l) => l.cuenta === "5100"); gas.push({ monto: c.debe - c.haber, concepto: conceptoGasto(m) }); }
    else if (a.tipo === "planilla") { const c = a.lineas.find((l) => l.tipo === "gasto"); pla.push({ monto: c.debe - c.haber, cuenta: c.nombre.replace(/^Planilla · /, "") }); }
  }
  const total = (rows) => money(rows.reduce((s, r) => s + r.monto, 0));
  const ingresos = total(ing), gastos = total(gas), planilla = total(pla);
  const utilidadOperativa = money(ingresos - gastos), utilidadNeta = money(utilidadOperativa - planilla);
  const pct = (v) => (ingresos ? Math.round((v / ingresos) * 1000) / 10 : 0);
  return {
    ingresos: { total: ingresos, porCategoria: agrupar(ing, (r) => r.cuenta), porOrigen: agrupar(ing, (r) => r.origen), pagos: ing.length },
    gastosOperativos: { total: gastos, porConcepto: agrupar(gas, (r) => r.concepto) },
    utilidadOperativa, margenOperativo: pct(utilidadOperativa),
    planilla: { total: planilla, porConcepto: agrupar(pla, (r) => r.cuenta) },
    utilidadNeta, margenNeto: pct(utilidadNeta),
  };
}
// Flujo de caja por banco: saldo inicial + entradas − salidas = saldo final (cuadra con los saldos reales del libro).
function flujoCaja(movimientos = [], libro = {}, methods = [], desde, hasta) {
  const antes = movimientos.filter((m) => { const f = movementYmd(m); return f && f < desde; });
  const hastaFin = movimientos.filter((m) => { const f = movementYmd(m); return f && f <= hasta; });
  const basesAntes = {}, basesFin = {};
  for (const [id, b] of Object.entries(libro.bases || {})) { if (b && b.desde && b.desde < desde) basesAntes[id] = b; else basesAntes[id] = { ...(b || {}), saldo: 0 }; if (b && b.desde && b.desde <= hasta) basesFin[id] = b; else basesFin[id] = { ...(b || {}), saldo: 0 }; }
  const ini = bankBalances(antes, { ...libro, bases: basesAntes }, methods), fin = bankBalances(hastaFin, { ...libro, bases: basesFin }, methods);
  const bancos = fin.bancos.map((bf) => {
    const bi = ini.bancos.find((x) => x.id === bf.id) || { saldo: 0, ingresos: 0, egresosOperativos: 0, planilla: 0, ajustes: 0, transferencias: 0, base: 0 };
    const aperturaPeriodo = money(bf.base - bi.base);
    const r = {
      id: bf.id, nombre: bf.nombre, saldoInicial: money(bi.saldo),
      cobros: money(bf.ingresos - bi.ingresos), gastos: money(bf.egresosOperativos - bi.egresosOperativos), planilla: money(bf.planilla - bi.planilla),
      transferencias: money((bf.transferencias || 0) - (bi.transferencias || 0)), ajustes: money(bf.ajustes - bi.ajustes + aperturaPeriodo), saldoFinal: money(bf.saldo),
    };
    r.cuadra = Math.abs(money(r.saldoInicial + r.cobros - r.gastos - r.planilla + r.transferencias + r.ajustes) - r.saldoFinal) < 0.005;
    return r;
  }).filter((r) => r.saldoInicial || r.cobros || r.gastos || r.planilla || r.transferencias || r.ajustes || r.saldoFinal);
  const sum = (k) => money(bancos.reduce((s, r) => s + r[k], 0));
  const sinBanco = movimientos.filter((m) => { const f = movementYmd(m); return f && f >= desde && f <= hasta && !anuladoOReversa(m) && ["ingreso", "egreso", "planilla"].includes(movementKind(m)) && !methods.some((x) => x.id === movementBankId(m, methods)); });
  const netoSinBanco = money(sinBanco.reduce((s, m) => s + (movementKind(m) === "ingreso" ? 1 : -1) * money(m.monto), 0));
  return {
    bancos, saldoInicial: sum("saldoInicial"), cobros: sum("cobros"), gastos: sum("gastos"), planilla: sum("planilla"), transferencias: sum("transferencias"), ajustes: sum("ajustes"), saldoFinal: sum("saldoFinal"),
    flujoOperativo: money(sum("cobros") - sum("gastos") - sum("planilla")), cuadra: bancos.every((r) => r.cuadra), sinBanco: { n: sinBanco.length, neto: netoSinBanco },
  };
}
function mesBounds(mes) {
  const m = String(mes || "").match(/^(\d{4})-(\d{2})$/); if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), ultimo = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { mes: `${m[1]}-${m[2]}`, desde: `${m[1]}-${m[2]}-01`, hasta: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, "0")}`, nombre: `${MESES[mo - 1]} ${y}` };
}
function mesVecino(mes, delta) { const b = mesBounds(mes); if (!b) return ""; const [y, m] = b.mes.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
// Paquete completo del mes: estado de resultados, flujo de caja, libro diario y balanza.
function estadosFinancieros({ movimientos = [], libro = {}, methods = [], mes, hoy = "", clasificar = null } = {}) {
  const b = mesBounds(mes); if (!b) throw new Error("Mes inválido (use yyyy-mm).");
  const hasta = hoy && hoy < b.hasta ? hoy : b.hasta;
  const porId = new Map(movimientos.map((m) => [String(m.id || ""), m]));
  const diario = libroDiario(movimientos, libro, methods, b.desde, hasta, clasificar);
  return {
    mes: b.mes, nombre: b.nombre, desde: b.desde, hasta, anterior: mesVecino(b.mes, -1), siguiente: mesVecino(b.mes, 1),
    resultados: estadoResultados(diario, porId), flujo: flujoCaja(movimientos, libro, methods, b.desde, hasta),
    balanza: balanzaComprobacion(diario), diario,
  };
}
module.exports = { CUENTAS_FIJAS, asientoDe, libroDiario, balanzaComprobacion, estadoResultados, flujoCaja, mesBounds, mesVecino, estadosFinancieros };
