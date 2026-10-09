// lib_finanzas_reportes.js · R139 — GENERADO del mismo texto que HQ (api/_finanzas-reportes.js). No editar uno sin el otro.
// ============================================================================================================
// R139 · FINANCE OS · FASES 5, 6 y 8 — TABLERO DE DIRECCIÓN, RESULTADOS, BALANCE, RENTABILIDAD, UTILIDAD REPARTIBLE
// y CONCILIACIÓN. Mismo texto en HQ (api/_finanzas-reportes.js) y bot (lib_finanzas_reportes.js).
//  · Resultados POR VENTA (devengado): Ventas − Costo de ventas = Utilidad bruta − Gastos − Planilla − Cupos sin vender
//    − Mermas ± Diferencial cambiario = Utilidad neta. Los retiros de dueños NO son gasto.
//  · Balance gerencial: Bancos + Binance + Cuentas por cobrar + Inventario − Cuentas por pagar = Patrimonio.
//  · Utilidad repartible: lo menor entre (utilidad acumulada − retiros − reserva) y (caja − deudas − capital de trabajo).
//  · Conciliación: cada saldo del sistema contra el libro (partida doble). Si algo no cuadra, se ve aquí.
// ============================================================================================================
const r2x = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const pctx = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const mesDe = (ymd) => String(ymd || "").slice(0, 7);
function limitesMes(mes) { const [y, m] = mes.split("-").map(Number); const ult = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { desde: `${mes}-01`, hasta: `${mes}-${String(ult).padStart(2, "0")}` }; }
function mesAnterior(mes) { const [y, m] = mes.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
const NOMBRES_MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const nombreMes = (mes) => { const [y, m] = mes.split("-").map(Number); return `${NOMBRES_MES[m - 1]} ${y}`; };

// Resultados por venta en [desde, hasta].
function resultadosRango({ movimientos = [], R, ventasACostear }, desde, hasta) {
  const vigente = (m) => !R.anuladoOReversa(m);
  const enRango = (m) => { const f = R.movementYmd(m); return f && f >= desde && f <= hasta; };
  const ventas = ventasACostear(movimientos, desde, R, { paraIngresos: true }).filter((v) => v.fecha <= hasta && !v.anulada);
  const sum = (arr, f = (m) => Number(m.monto || 0)) => r2x(arr.reduce((a, m) => a + f(m), 0));
  const kind = (k) => movimientos.filter((m) => vigente(m) && enRango(m) && R.movementKind(m) === k);
  const inv = kind("inventario");
  const pagos = movimientos.filter((m) => vigente(m) && enRango(m) && (R.movementKind(m) === "pago_cxp" || (R.movementKind(m) === "billetera" && m.subtipo === "pago_cxp")));
  const ventasHnl = sum(ventas), costo = sum(kind("costo_venta"));
  const gastos = sum(kind("egreso")), planilla = sum(kind("planilla"));
  const cupos = sum(inv.filter((m) => m.subtipo === "cupos_sin_vender")), mermas = sum(inv.filter((m) => m.subtipo !== "cupos_sin_vender"));
  const diferencial = sum(pagos, (m) => Number(m.diferencialHnl || 0));
  const bruta = r2x(ventasHnl - costo), operativa = r2x(bruta - gastos - planilla), neta = r2x(operativa - cupos - mermas - diferencial);
  const cobrado = sum(kind("ingreso"));
  return {
    desde, hasta, ventas: ventasHnl, nVentas: ventas.length, costoVentas: costo, utilidadBruta: bruta, margenBruto: pctx(bruta, ventasHnl),
    gastosOperativos: gastos, planilla, utilidadOperativa: operativa, cuposSinVender: cupos, mermas, diferencialCambiario: diferencial,
    utilidadNeta: neta, margenNeto: pctx(neta, ventasHnl), cobradoEnEfectivo: cobrado, retiros: sum(kind("retiro")),
    ventasPendientesCobro: r2x(ventas.filter((v) => Number(v.saldoPendiente) > 0).reduce((a, v) => a + Number(v.saldoPendiente || 0), 0)),
  };
}
// Rentabilidad del mes por producto, proveedor y vendedor (desde el costo de ventas guardado).
function rentabilidad({ consumos = [], lotes = [], movimientos = [] }, mes) {
  const loteDe = new Map(lotes.map((l) => [l.id, l]));
  const ventaDe = new Map(movimientos.map((m) => [m.id, m]));
  const acc = () => new Map();
  const prod = acc(), prov = acc(), vend = acc();
  const suma = (map, key, nombre, ing, costo, uds = 0) => { const x = map.get(key) || { nombre, ventas: 0, unidades: 0, ingresoHnl: 0, costoHnl: 0 }; x.ventas++; x.unidades += uds; x.ingresoHnl += ing; x.costoHnl += costo; map.set(key, x); };
  for (const c of consumos.filter((c) => c.mesKey === mes && c.estado !== "revertido")) {
    const v = ventaDe.get(c.ventaId) || {};
    const vendedor = String(v.vendedor || v.vendedorNombre || v.registradoPorNombre || v.registradoPor || "Sin vendedor").trim() || "Sin vendedor";
    suma(vend, vendedor.toLowerCase(), vendedor, Number(c.ventaHnl || 0), Number(c.costoHnl || 0));
    for (const l of c.lineas || []) {
      suma(prod, l.productoId || `?${l.servicio}`, l.producto || l.servicio, Number(l.ingresoHnl || 0), Number(l.costoHnl || 0), Number(l.cantidad || 0));
      const tot = (l.consumos || []).reduce((a, x) => a + Number(x.cantidad || 0), 0) || 1;
      for (const x of l.consumos || []) { const lt = loteDe.get(x.loteId) || {}; const p = lt.proveedor || "Sin proveedor"; suma(prov, p.toLowerCase(), p, Number(l.ingresoHnl || 0) * (Number(x.cantidad || 0) / tot), Number(x.costoHnl || 0), Number(x.cantidad || 0)); }
    }
  }
  const fin = (map) => [...map.values()].map((x) => ({ ...x, ingresoHnl: r2x(x.ingresoHnl), costoHnl: r2x(x.costoHnl), utilidadBrutaHnl: r2x(x.ingresoHnl - x.costoHnl), margen: pctx(x.ingresoHnl - x.costoHnl, x.ingresoHnl) })).sort((a, b) => b.utilidadBrutaHnl - a.utilidadBrutaHnl);
  return { productos: fin(prod), proveedores: fin(prov), vendedores: fin(vend) };
}
// Costo promedio histórico por producto y proveedor; el más económico.
function costosProveedor(lotes = []) {
  const map = new Map();
  for (const l of lotes.filter((l) => l.pago !== "inicial" && Number(l.cantidad) > 0)) {
    const k = `${l.productoId}|${l.proveedor || "Sin proveedor"}`;
    const x = map.get(k) || { productoId: l.productoId, producto: l.producto, proveedor: l.proveedor || "Sin proveedor", unidades: 0, costoHnl: 0, compras: 0, ultimo: 0, ultimaFecha: "" };
    x.unidades += Number(l.cantidad); x.costoHnl += Number(l.costoTotalHnl || 0); x.compras++;
    if (String(l.fecha) >= x.ultimaFecha) { x.ultimaFecha = String(l.fecha); x.ultimo = Number(l.costoUnitarioHnl || 0); }
    map.set(k, x);
  }
  const filas = [...map.values()].map((x) => ({ ...x, costoHnl: r2x(x.costoHnl), promedioHnl: x.unidades ? Math.round((x.costoHnl / x.unidades) * 10000) / 10000 : 0 }));
  const minPorProd = {}; for (const f of filas) if (!(f.productoId in minPorProd) || f.promedioHnl < minPorProd[f.productoId]) minPorProd[f.productoId] = f.promedioHnl;
  return filas.map((f) => ({ ...f, masEconomico: filas.filter((g) => g.productoId === f.productoId).length > 1 && f.promedioHnl === minPorProd[f.productoId] })).sort((a, b) => String(a.producto).localeCompare(String(b.producto)) || a.promedioHnl - b.promedioHnl);
}
// Balance gerencial a hoy.
function balanceGerencial({ bancos = { bancos: [], total: 0 }, billetera = {}, cxc = [], cxp = [], lotes = [] }) {
  const cxcHnl = r2x(cxc.filter((c) => ["pendiente", "parcial"].includes(c.estado)).reduce((a, c) => a + Number(c.saldoPendiente || 0), 0));
  const cxpHnl = r2x(cxp.filter((c) => c.estado !== "pagado").reduce((a, c) => a + Number(c.saldoHnl || 0), 0));
  const invHnl = r2x(lotes.reduce((a, l) => a + Number(l.disponible || 0) * Number(l.costoUnitarioHnl || 0), 0));
  const binHnl = r2x(billetera.valorHnl || 0);
  const activos = r2x(Number(bancos.total || 0) + binHnl + cxcHnl + invHnl);
  return { bancos: r2x(bancos.total), bancosDetalle: [...(bancos.bancos || [])].filter((b) => b.saldo).sort((a, b) => b.saldo - a.saldo).map((b) => ({ id: b.id, nombre: b.nombre, saldo: r2x(b.saldo) })),
    binanceUsdt: Number(billetera.saldo || 0), binanceHnl: binHnl, cuentasPorCobrar: cxcHnl, inventario: invHnl, otrosActivos: 0, activos, cuentasPorPagar: cxpHnl, pasivos: cxpHnl, patrimonio: r2x(activos - cxpHnl) };
}
// Fase 6 · Utilidad repartible a los dueños.
function utilidadRepartible({ acumulado, balance, config = {} }) {
  const reservaPct = Math.max(0, Math.min(100, Number(config.reservaPct ?? 10)));
  const capitalTrabajo = Math.max(0, Number(config.capitalTrabajoMin ?? 5000));
  const reserva = r2x(Math.max(0, acumulado.utilidadNeta) * reservaPct / 100);
  const porUtilidad = r2x(acumulado.utilidadNeta - acumulado.retiros - reserva);
  const caja = r2x(balance.bancos + balance.binanceHnl);
  const porCaja = r2x(caja - balance.cuentasPorPagar - capitalTrabajo);
  return { utilidadAcumulada: acumulado.utilidadNeta, retirosAcumulados: acumulado.retiros, reservaPct, reserva, capitalTrabajo, caja, deudas: balance.cuentasPorPagar, porUtilidad, porCaja, repartible: r2x(Math.max(0, Math.min(porUtilidad, porCaja))), limitaPor: porUtilidad <= porCaja ? "utilidad" : "caja" };
}
// Fase 8 · Conciliación: sistema vs libro (partida doble acumulada).
function conciliacion({ bancos = { bancos: [] }, billetera = {}, cxp = [], cxc = [], lotes = [], balanza = { cuentas: [] }, movimientos = [], R }) {
  const cta = (c) => (balanza.cuentas.find((x) => x.cuenta === c) || { saldo: 0 }).saldo;
  const filas = [];
  const fila = (nombre, sistema, libro, nota = "") => filas.push({ nombre, sistema: r2x(sistema), libro: r2x(libro), diferencia: r2x(sistema - libro), ok: Math.abs(sistema - libro) <= 1, nota });
  for (const b of (bancos.bancos || []).filter((b) => b.saldo || cta(`1100-${b.id}`))) fila(`Banco ${b.nombre}`, b.saldo, cta(`1100-${b.id}`));
  fila("Binance (valor en Lempiras)", Number(billetera.valorHnl || 0), cta("1150-binance"));
  const usdtMovs = movimientos.filter((m) => R.movementKind(m) === "billetera" && !R.anuladoOReversa(m)).reduce((a, m) => a + (m.subtipo === "ajuste" ? Number(m.montoUsdt || 0) : (m.direccion === "salida" ? -1 : 1) * Math.abs(Number(m.montoUsdt || 0))), 0);
  fila("Binance (USDT)", Number(billetera.saldo || 0), Math.round(usdtMovs * 1e6) / 1e6, "saldo vs suma de movimientos");
  fila("Inventario", lotes.reduce((a, l) => a + Number(l.disponible || 0) * Number(l.costoUnitarioHnl || 0), 0), cta("1300"));
  fila("Cuentas por pagar", cxp.filter((c) => c.estado !== "pagado").reduce((a, c) => a + Number(c.saldoHnl || 0), 0), cta("2100"));
  const abiertas = cxc.filter((c) => ["pendiente", "parcial", "pagado"].includes(c.estado));
  const abonosPorCuenta = {}; for (const m of movimientos) if (m.cuentaId && /^cobro_pendiente/.test(String(m.subtipo || "")) && R.movementKind(m) === "ingreso" && !R.anuladoOReversa(m)) abonosPorCuenta[m.cuentaId] = (abonosPorCuenta[m.cuentaId] || 0) + Number(m.monto || 0);
  fila("Cuentas por cobrar", abiertas.reduce((a, c) => a + Number(c.saldoPendiente || 0), 0), abiertas.reduce((a, c) => a + Math.max(0, Number(c.montoOriginalPendiente ?? c.saldoPendiente ?? 0) - (abonosPorCuenta[c.id] || 0)), 0), "deuda original − abonos cobrados");
  fila("Partida doble (Debe − Haber)", balanza.debe || 0, balanza.haber || 0);
  return { filas, todoCuadra: filas.every((f) => f.ok) };
}
// Alertas de dirección.
function alertas({ mes, actual, anterior, rent, inventario = [], lotes = [], cxc = [], cxp = [], hoy, costeo = {}, productos = [], movimientos = [], R }) {
  const out = []; const a = (nivel, texto) => out.push({ nivel, texto });
  if (anterior.ventas > 0 && actual.ventas > 0 && actual.margenBruto < anterior.margenBruto - 5) a("alta", `El margen bruto bajó de ${anterior.margenBruto}% a ${actual.margenBruto}%.`);
  if (anterior.gastosOperativos > 0 && actual.gastosOperativos > anterior.gastosOperativos * 1.2) a("media", `Los gastos subieron ${pctx(actual.gastosOperativos - anterior.gastosOperativos, anterior.gastosOperativos)}% contra ${nombreMes(mesAnterior(mes))}.`);
  for (const p of rent.productos.filter((p) => p.ingresoHnl > 0 && p.margen < 30)) a("alta", `${p.nombre}: margen de ${p.margen}% (bajo).`);
  for (const i of inventario.filter((i) => i.stockBajo)) a("media", `${i.nombre}: quedan ${i.disponible} ${i.unidad || ""}. Toca comprar.`);
  for (const i of inventario.filter((i) => i.disponible === 0 && i.lotes > 0)) a("alta", `${i.nombre}: sin existencias.`);
  for (const i of inventario.filter((i) => i.vencePronto)) a("media", `${i.nombre}: lote vence el ${i.proximoVencimiento}.`);
  const porProd = {}; for (const l of [...lotes].filter((l) => l.pago !== "inicial").sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)))) (porProd[l.productoId] = porProd[l.productoId] || []).push(l);
  for (const ls of Object.values(porProd)) if (ls.length >= 2) { const u = ls[ls.length - 1], p = ls[ls.length - 2]; if (p.costoUnitarioHnl > 0 && u.costoUnitarioHnl > p.costoUnitarioHnl * 1.05) a("media", `${u.producto}: el costo subió ${pctx(u.costoUnitarioHnl - p.costoUnitarioHnl, p.costoUnitarioHnl)}%${u.proveedor ? ` (${u.proveedor})` : ""}.`); }
  const madre = productos.filter((p) => p.modelo === "cuenta_madre");
  for (const p of madre) {
    const r = rent.productos.find((x) => x.nombre === p.nombre);
    const cupos = movimientos.filter((m) => R.movementKind(m) === "inventario" && m.subtipo === "cupos_sin_vender" && m.productoId === p.id && mesDe(R.movementYmd(m)) === mes && !R.anuladoOReversa(m)).reduce((s, m) => s + Number(m.monto || 0), 0);
    const neto = r2x((r ? r.utilidadBrutaHnl : 0) - cupos);
    if ((r || cupos) && neto <= 0) a("alta", `${p.nombre}: la cuenta madre no deja ganancia este mes (${neto < 0 ? "pérdida" : "cero"}: L ${Math.abs(neto)}).`);
  }
  for (const l of lotes.filter((l) => ["cuenta_madre", "panel", "gift_card"].includes(l.modelo) && l.estado !== "vencido" && l.vigenciaHasta && Number(l.cantidad) > 0)) {
    const ocup = pctx(Number(l.consumido || 0), Number(l.cantidad)); const dias = Math.round((Date.parse(`${l.vigenciaHasta}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86400000);
    if (dias >= 0 && dias <= 10 && ocup < 50) a("media", `${l.producto}: solo ${ocup}% de los perfiles vendidos y vence en ${dias} días.`);
  }
  const vencCxp = cxp.filter((c) => c.estado !== "pagado" && c.vence && c.vence < hoy); if (vencCxp.length) a("alta", `${vencCxp.length} deuda(s) con proveedores vencida(s): L ${r2x(vencCxp.reduce((s, c) => s + Number(c.saldoHnl || 0), 0))}.`);
  const viejas = cxc.filter((c) => ["pendiente", "parcial"].includes(c.estado) && c.createdAt && (Date.parse(`${hoy}T12:00:00Z`) - Date.parse(c.createdAt)) / 86400000 > 30); if (viejas.length) a("media", `${viejas.length} cuenta(s) por cobrar con más de 30 días: L ${r2x(viejas.reduce((s, c) => s + Number(c.saldoPendiente || 0), 0))}.`);
  if (costeo.pendientes) a("media", `${costeo.pendientes} venta(s) sin costo completo (falta inventario o catálogo).`);
  return out.sort((x, y) => (x.nivel === y.nivel ? 0 : x.nivel === "alta" ? -1 : 1));
}
// Todo el tablero (puro). deps: { R, ventasACostear, libroDiario, balanzaComprobacion, resumenInventario }
function tableroDireccion(datos, deps) {
  const { movimientos = [], libro = {}, methods = [], consumos = [], lotes = [], productos = [], cxc = [], cxp = [], billetera = {}, config = {}, hoy, mes: mesPedido } = datos;
  const { R, ventasACostear, libroDiario, balanzaComprobacion, resumenInventario } = deps;
  const mes = /^\d{4}-\d{2}$/.test(String(mesPedido || "")) ? mesPedido : mesDe(hoy);
  const lm = limitesMes(mes), ant = limitesMes(mesAnterior(mes));
  const base = { movimientos, R, ventasACostear };
  const actual = resultadosRango(base, lm.desde, lm.hasta < hoy ? lm.hasta : hoy);
  { // R140 · lo pendiente de cobro sale de las cuentas por cobrar (las ventas no se actualizan con los abonos)
    const ventasMes = ventasACostear(movimientos, lm.desde, R, { paraIngresos: true }).filter((v) => v.fecha <= actual.hasta && !v.anulada && v.origenVenta === "venta").map((v) => String(v.id).replace(/_venta$/, ""));
    const porId = new Map(cxc.map((c) => [c.id, c]));
    actual.ventasPendientesCobro = r2x(ventasMes.reduce((a, id) => { const c = porId.get(id); return a + (c && ["pendiente", "parcial"].includes(c.estado) ? Number(c.saldoPendiente || 0) : 0); }, 0));
  }
  const anterior = resultadosRango(base, ant.desde, ant.hasta);
  const hoyRes = resultadosRango(base, hoy, hoy);
  const inicio = libro.cicloInicioLibro || libro.lecturaDesde || "2026-10-01";
  const acumulado = resultadosRango(base, inicio, hoy);
  const bancos = R.bankBalances(movimientos, libro, methods);
  const balance = balanceGerencial({ bancos, billetera, cxc, cxp, lotes });
  const rent = rentabilidad({ consumos, lotes, movimientos }, mes);
  const inventario = resumenInventario ? resumenInventario(productos, lotes, hoy) : [];
  const balanza = balanzaComprobacion(libroDiario(movimientos, libro, methods, "", hoy));
  const pendCosteo = consumos.filter((c) => c.mesKey === mes && ["pendiente", "sin_producto"].includes(c.estado)).length;
  return {
    mes, nombreMes: nombreMes(mes), hoy, hoyRes, resultados: actual, anterior: { ...anterior, nombreMes: nombreMes(mesAnterior(mes)) }, acumulado,
    balance, repartible: utilidadRepartible({ acumulado, balance, config }), rentabilidad: rent, costosProveedor: costosProveedor(lotes), inventario,
    conciliacion: conciliacion({ bancos, billetera, cxp, cxc, lotes, balanza, movimientos, R }),
    alertas: alertas({ mes, actual, anterior, rent, inventario, lotes, cxc, cxp, hoy, costeo: { pendientes: pendCosteo }, productos, movimientos, R }),
  };
}
// Lector de Firestore (misma API admin en HQ y bot). deps: { leerMovimientos(desde), loadMethods(), hoy, mes }
async function cargarTablero(db, deps, fns) {
  const libroSnap = await db.collection("finanzas_config").doc("libro_mayor").get();
  const l = libroSnap.exists ? libroSnap.data() || {} : {};
  const desdes = Object.values(l.bases || {}).map((b) => b && b.desde).filter(Boolean).sort();
  const cicloInicio = l.cicloInicio || desdes[0] || "2026-10-01";
  const libro = { ...l, bases: l.bases || {}, cicloInicio, lecturaDesde: [cicloInicio, ...desdes].sort()[0] };
  const todos = async (c) => (await db.collection(c).get()).docs.map((x) => ({ id: x.id, ...(x.data() || {}) }));
  const [movimientos, methods, consumos, lotes, productos, cxc, cxp, bSnap, cfgSnap] = await Promise.all([
    deps.leerMovimientos(libro.lecturaDesde), deps.loadMethods(), todos("fin_consumos"), todos("fin_lotes"), todos("fin_productos"), todos("cuentas_por_cobrar"), todos("fin_cxp"),
    db.collection("fin_billeteras").doc("binance").get(), db.collection("finanzas_config").doc("finance_os").get()]);
  return tableroDireccion({ movimientos, libro, methods, consumos, lotes, productos, cxc, cxp, billetera: bSnap.exists ? bSnap.data() : {}, config: cfgSnap.exists ? cfgSnap.data() : {}, hoy: deps.hoy, mes: deps.mes }, fns);
}
module.exports = { resultadosRango, rentabilidad, costosProveedor, balanceGerencial, utilidadRepartible, conciliacion, alertas, tableroDireccion, cargarTablero, limitesMes, mesAnterior, nombreMes };
