// lib_finanzas_reglas.js · COPIA de Sublichat HQ api/_finanzas-libro.js en formato CommonJS (mismas reglas que el servidor y la APK).
// Si se cambia una regla, cambiar las TRES copias (HQ api/_finanzas-libro.js, APK src/app/finanzas-reglas.js y este archivo).
// api/_finanzas-libro.js · Libro mayor de Finanzas (ciclos, saldos por banco y planilla). Vive DENTRO de /api y como .js para que Vercel lo empaquete junto a api/finanzas.js (Vercel no puede hacer require() de un .mjs).
// Lógica PURA (sin Firestore) para que el backend, las pruebas y los reportes usen exactamente
// las mismas definiciones. El bot de Telegram replica estas reglas (index_31_finanzas_libro.js).
//
// Definiciones (spec "Finanzas + Renovaciones + Planilla"):
//  · Ingresos del ciclo       = movimientos tipo ingreso con fecha dentro del ciclo.
//  · Egresos operativos       = egresos que NO son planilla/comisiones.
//  · Disponible antes planilla = Ingresos − Egresos operativos.
//  · Planilla / comisiones    = egresos de planilla confirmados (subtipos PLANILLA_SUBTIPOS).
//  · Resultado final          = Disponible antes de planilla − Planilla.
//  · Saldo real por banco     = base (saldo inicial o saldo al último cierre)
//                               + ingresos − egresos (operativos y planilla) ± ajustes, desde la base.

const PLANILLA_CONCEPTOS = Object.freeze({
  pago_planilla: "Pago de planilla",
  comision_vendedor: "Comisión vendedor",
  bonificacion: "Bonificación",
  pago_administrativo: "Pago administrativo",
  otro_planilla: "Otro",
});
const PLANILLA_SUBTIPOS = new Set(Object.keys(PLANILLA_CONCEPTOS));
const SIN_BANCO = "sin_banco";

function norm(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function addDaysYmd(value, days) {
  const [y, m, d] = String(value).split("-").map(Number);
  return ymd(new Date(Date.UTC(y, m - 1, d + Number(days || 0), 12)));
}
function daysBetweenYmd(a, b) {
  const pa = String(a).split("-").map(Number), pb = String(b).split("-").map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

// Fecha del movimiento → "yyyy-mm-dd". Acepta fechaPago (API), fecha dd/mm/yyyy (bot) o fechaTS.
function movementYmd(m = {}) {
  const fp = String(m.fechaPago || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (fp) return `${fp[1]}-${fp[2]}-${fp[3]}`;
  const f = String(m.fecha || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (f) return `${f[3]}-${String(f[2]).padStart(2, "0")}-${String(f[1]).padStart(2, "0")}`;
  const ts = m.fechaTS;
  const ms = ts && typeof ts.toMillis === "function" ? ts.toMillis() : (ts && ts._seconds ? ts._seconds * 1000 : (ts?.seconds ? ts.seconds * 1000 : NaN));
  if (Number.isFinite(ms)) {
    // fechaTS se guarda a mediodía UTC (API) o medianoche Honduras (bot): ambas caen en el día correcto en UTC-6.
    return ymd(new Date(ms - 6 * 3600000));
  }
  return "";
}

// Métodos activos de portal_cliente/configuracion → solo id, nombre, logoKey, activo.
function publicMethods(methods = []) {
  return (Array.isArray(methods) ? methods : [])
    .filter((m) => m && m.activo !== false && m.id)
    .map((m) => ({ id: String(m.id), nombre: String(m.nombre || m.id), logoKey: String(m.logoKey || "custom"), activo: true }));
}

// Texto libre de banco/método (movimientos viejos o del bot) → id del método configurado.
function resolveBankId(text, methods = []) {
  const t = norm(text);
  if (!t) return SIN_BANCO;
  for (const m of methods) if (t === norm(m.id) || t === norm(m.nombre)) return m.id;
  for (const m of methods) {
    const key = norm(m.logoKey);
    if (key && key !== "custom" && (t === key || t.split(" ").includes(key) || t.startsWith(key))) return m.id;
  }
  for (const m of methods) {
    const first = norm(m.nombre).split(" ").filter((w) => !["banco", "de", "del"].includes(w))[0];
    if (first && first.length >= 3 && t.includes(first)) return m.id;
  }
  return SIN_BANCO;
}

function movementBankId(m = {}, methods = []) {
  if (m.bancoId) return String(m.bancoId);
  return resolveBankId(m.banco || m.metodoPago || m.metodo || "", methods);
}

// Centro financiero (R106):
//  · "venta": valor acordado de compra/renovación (NO es dinero; alimenta "Ventas generadas").
//  · "transferencia": mueve dinero entre bancos (entrada/salida); no cambia el total ni el ciclo.
//  · Anular/corregir NO borra: el original se marca estadoFinanciero "anulado"/"corregido" y se crea una
//    REVERSA con el mismo tipo y monto negativo, así bancos y ciclo vuelven exactos y queda la traza.
function movementKind(m = {}) {
  const tipo = norm(m.tipo);
  const sub = String(m.subtipo || "").trim();
  if ((m.estado === "anulado" || m.anulado === true) && !m.estadoFinanciero) return "ignorar"; // anulaciones antiguas sin reversa
  if (tipo === "venta") return "venta";
  if (tipo === "transferencia") return "transferencia";
  if (tipo === "billetera") return "billetera"; // R135 · Binance (USDT): no es ingreso ni egreso ni toca bancos HNL
  if (tipo === "compra") return "compra"; // R136 · compra de inventario: baja el banco, NO es gasto
  if (tipo === "inventario") return "inventario"; // R136 · ajuste de inventario (merma/vencido): no toca bancos
  if (tipo === "saldo inicial" || sub === "saldo_inicial") return "saldo_inicial";
  if (tipo === "ajuste saldo" || sub === "ajuste_saldo") return "ajuste";
  if (tipo === "ingreso" || tipo === "cobro") return "ingreso";
  if (tipo === "egreso" || tipo === "gasto") return (PLANILLA_SUBTIPOS.has(sub) || m.planillaPagoId) ? "planilla" : "egreso";
  return "ignorar";
}

// Totales de un ciclo [inicio, fin] (fin opcional = sin límite).
// R125 · Un movimiento ANULADO/CORREGIDO y su REVERSA no cuentan en ningún total (igual que api/_finanzas-libro.js).
function anuladoOReversa(m = {}) { return !!m.reversaDe || ["anulado", "corregido"].includes(String(m.estadoFinanciero || "")); }
function cycleTotals(movements = [], inicio = "", fin = "") {
  let ingresos = 0, egresosOperativos = 0, planilla = 0, ventas = 0, nIngresos = 0, nEgresos = 0, nPlanilla = 0;
  for (const m of movements) {
    if (anuladoOReversa(m)) continue; // R125: anulados/corregidos y sus reversas no son dinero del período
    const f = movementYmd(m);
    if (!f || (inicio && f < inicio) || (fin && f > fin)) continue;
    const kind = movementKind(m), monto = money(m.monto);
    if (kind === "ingreso") { ingresos += monto; nIngresos++; }
    else if (kind === "egreso") { egresosOperativos += monto; nEgresos++; }
    else if (kind === "planilla") { planilla += monto; nPlanilla++; }
    else if (kind === "venta") ventas += monto;
  }
  const disponibleAntesPlanilla = money(ingresos - egresosOperativos);
  return {
    ingresos: money(ingresos), egresosOperativos: money(egresosOperativos), disponibleAntesPlanilla,
    planilla: money(planilla), resultado: money(disponibleAntesPlanilla - planilla), ventasGeneradas: money(ventas),
    conteo: { ingresos: nIngresos, egresos: nEgresos, planilla: nPlanilla },
  };
}

// Saldo real por banco. `libro` = { baseFecha, bases: { [bancoId]: { saldo, desde } } }.
// Un banco sin base (sin saldo inicial) no está activado: se muestra pero su saldo no cuenta.
function bankBalances(movements = [], libro = {}, methods = []) {
  const bases = libro.bases || {};
  const out = new Map();
  for (const m of methods) {
    const b = bases[m.id];
    // R113: ya no se registra "saldo inicial". Cada banco es un RESUMEN desde el inicio del libro (01/10/2026):
    // entradas − salidas. Los saldos iniciales que ya se registraron se siguen respetando.
    out.set(m.id, {
      id: m.id, nombre: m.nombre, logoKey: m.logoKey, activado: true, sinSaldoInicial: !b,
      base: money(b?.saldo), desde: b?.desde || libro.cicloInicioLibro || "2026-10-01", ingresos: 0, egresosOperativos: 0, planilla: 0, ajustes: 0, movimientos: 0, saldo: money(b?.saldo),
    });
  }
  for (const m of movements) {
    if (anuladoOReversa(m)) continue; // R125: el anulado y su reversa se cancelan; no se cuentan ninguno de los dos
    const kind = movementKind(m);
    if (!["ingreso", "egreso", "planilla", "ajuste", "transferencia", "compra"].includes(kind)) continue;
    const id = movementBankId(m, methods);
    const row = out.get(id);
    if (!row || !row.activado) continue;
    const f = movementYmd(m);
    if (!f || f < row.desde) continue;
    const monto = money(m.monto);
    if (kind === "ingreso") { row.ingresos += monto; row.saldo += monto; }
    else if (kind === "egreso") { row.egresosOperativos += monto; row.saldo -= monto; }
    else if (kind === "planilla") { row.planilla += monto; row.saldo -= monto; }
    else if (kind === "ajuste") { row.ajustes += monto; row.saldo += monto; } // ajuste con signo
    else if (kind === "compra") { row.compras = money((row.compras || 0) + monto); row.saldo -= monto; } // R136: sale del banco, entra al inventario
    else if (kind === "transferencia") { const d = m.direccion === "salida" ? -monto : monto; row.transferencias = money((row.transferencias || 0) + d); row.saldo += d; }
    row.movimientos++;
  }
  const bancos = [...out.values()].map((r) => ({ ...r, ingresos: money(r.ingresos), egresosOperativos: money(r.egresosOperativos), planilla: money(r.planilla), ajustes: money(r.ajustes), saldo: money(r.saldo) }));
  return { bancos, total: money(bancos.filter((b) => b.activado).reduce((s, b) => s + b.saldo, 0)) };
}

// Valida una distribución de planilla contra saldos y disponible del ciclo.
function validatePlanilla({ montoTotal, asignaciones = [], bancos = [], disponibleCiclo = Infinity }) {
  const total = money(montoTotal);
  const errors = [];
  if (!(total > 0)) errors.push("Escriba el monto total del pago (mayor que 0).");
  const byId = new Map(bancos.map((b) => [b.id, b]));
  const clean = [];
  const seen = new Set();
  for (const a of asignaciones) {
    const monto = money(a?.monto);
    if (!monto) continue;
    if (monto < 0) { errors.push("Los montos por banco no pueden ser negativos."); continue; }
    const banco = byId.get(String(a.bancoId || ""));
    if (!banco) { errors.push("Banco no válido en la distribución."); continue; }
    if (!banco.activado) { errors.push(`${banco.nombre} no tiene saldo inicial registrado.`); continue; }
    if (seen.has(banco.id)) { errors.push(`${banco.nombre} está repetido.`); continue; }
    seen.add(banco.id);
    if (monto > banco.saldo + 0.001) errors.push(`Saldo insuficiente en ${banco.nombre}: tiene Lps. ${fmt(banco.saldo)} y se asignaron Lps. ${fmt(monto)}.`);
    clean.push({ bancoId: banco.id, banco: banco.nombre, monto, saldoAntes: banco.saldo, saldoDespues: money(banco.saldo - monto) });
  }
  const asignado = money(clean.reduce((s, a) => s + a.monto, 0));
  const diff = money(total - asignado);
  if (total > 0 && diff > 0) errors.push(`Faltan Lps. ${fmt(diff)} por asignar.`);
  if (total > 0 && diff < 0) errors.push(`Ha asignado Lps. ${fmt(-diff)} de más.`);
  if (total > 0 && Number.isFinite(Number(disponibleCiclo)) && total > money(disponibleCiclo) + 0.001) errors.push(`El pago (Lps. ${fmt(total)}) supera el disponible del ciclo (Lps. ${fmt(disponibleCiclo)}).`);
  return { ok: errors.length === 0, errors, asignaciones: clean, asignado, faltante: diff };
}

// Estado de pago de una compra/renovación: saldo = total − recibido (nunca negativo).
function estadoPago(total, recibido) {
  const t = money(total), r = money(recibido);
  const saldo = money(Math.max(0, t - r));
  return { total: t, recibido: r, saldo, estado: saldo <= 0 ? "pagado" : (r > 0 ? "parcial" : "pendiente") };
}

function fmt(n) {
  return money(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

module.exports = { anuladoOReversa, PLANILLA_CONCEPTOS, PLANILLA_SUBTIPOS, SIN_BANCO, norm, money, ymd, addDaysYmd, daysBetweenYmd, movementYmd, publicMethods, resolveBankId, movementBankId, movementKind, cycleTotals, bankBalances, validatePlanilla, estadoPago, fmt };
