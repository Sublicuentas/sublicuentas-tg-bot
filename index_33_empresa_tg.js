/* SUBLICUENTAS — R140 · FINANCE OS · FASE 7: 🏢 EMPRESA EN TELEGRAM (solo Sublicuentas y Relojes)
   Telegram usa el MISMO manejador que la web (lib_finanzas_empresa.js, generado de api/_finanzas-empresa.js) y el mismo
   tablero (lib_finanzas_reportes.js). Las reglas, el costo de ventas, las alertas y la conciliación salen idénticos.
   · Tablero del mes: resultados por venta, caja, cobrar/pagar, utilidad repartible, alertas y conciliación.
   · 💱 Binance: saldo y recarga desde banco (no es gasto).
   · 📦 Inventario: existencias, valor y avisos.
   · 🧾 Cobrar / Pagar: antigüedad de saldos y deudas con proveedores.
   · 💸 Retiro de dueños: baja el banco, no es gasto.
*/
const { bot, db } = require("./index_01_core");
const { pending, upsertPanel, logErr } = require("./index_02_utils_roles");
const R = require("./lib_finanzas_reglas");
const E = require("./lib_finanzas_empresa");
const L = () => require("./index_31_finanzas_libro");

const lps = (n) => `L ${R.fmt(n)}`;
const hoyYmd = () => R.ymd(new Date(Date.now() - 6 * 3600000));
const esc = (v) => String(v ?? "").replace(/[*_`\[\]]/g, "");
const dmy = (v) => { const [y, m, d] = String(v || "").split("-"); return d ? `${d}/${m}/${y}` : "—"; };
const nuevoOp = () => `tg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

// Llama al manejador compartido como si fuera la web: mismas validaciones, auditoría e idempotencia.
async function emp(userId, accion, body = {}) {
  const libro = L();
  const actor = await libro.actorDe(userId);
  const identity = { usuario: actor.usuario, role: actor.usuario === "relojes" ? "relojes" : "sublicuentas" };
  let out = null;
  const res = { status: () => ({ json: (j) => { out = j; return j; } }) };
  let norm = null; try { norm = require("./lib_catalogo_categorias").normPlataformaKey; } catch (_) {}
  const deps = {
    canUseLibro: () => true, hoyYmdHN: hoyYmd, loadMethods: () => libro.loadMethods(),
    auditar: (tx, _db, idt, ev = {}) => tx.set(db.collection("auditoria_eventos").doc(), { actorUsuario: idt.usuario, rol: idt.role, origen: "telegram", modulo: ev.modulo || "finanzas", accion: ev.accion, targetType: ev.targetType || "", targetId: ev.targetId || "", movimientoId: ev.movimientoId || "", operationId: ev.operationId || "", before: ev.before ?? null, after: ev.after ?? null, motivo: ev.motivo || "", detalle: ev.detalle || "", monto: ev.monto ?? null, resultado: "ok", tipo: `finanzas_${ev.accion}`, createdAt: new Date().toISOString() }),
    libroOpDocId: (prefijo, b, uid) => (/^[A-Za-z0-9-]{8,80}$/.test(String(b.operationId || "")) ? `${prefijo}_op_${String(uid).replace(/[^A-Za-z0-9_-]/g, "")}_${b.operationId}` : ""),
    estadoLibro: (_db, tx) => libro.estadoLibro(tx),
    baseMov: (idt) => ({ registradoPor: idt.usuario, rol: idt.role, origenCanal: "telegram", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    canonicalFinanceDate: (f) => libro.fechaCampos(f),
    costeoDeps: () => ({ R, normPlataformaKey: norm, leerMovimientos: libro.leerMovimientosDesde }),
  };
  await E.handleEmpresa(db, accion, { origen: "telegram", ...body }, identity, { uid: `tg${userId}` }, res, deps);
  return out || { ok: false, error: "Sin respuesta." };
}

const volver = [{ text: "⬅️ Empresa", callback_data: "fl:emp" }, { text: "⬅️ Ciclo", callback_data: "fl:menu" }];

async function tablero(chatId, userId) {
  const t = await emp(userId, "fin_tablero", {});
  if (!t.ok) return bot.sendMessage(chatId, `⚠️ ${t.error}`);
  const r = t.resultados, b = t.balance, u = t.repartible, c = t.conciliacion;
  const al = (t.alertas || []).slice(0, 6).map((a) => `${a.nivel === "alta" ? "🔴" : "🟠"} ${esc(a.texto)}`);
  const top = (t.rentabilidad.productos || []).slice(0, 4).map((p) => `   • ${esc(p.nombre)}: ${lps(p.utilidadBrutaHnl)} (${p.margen}%)`);
  const txt = [
    `🏢 *EMPRESA · ${esc(t.nombreMes)}*`, "",
    `Hoy: ventas ${lps(t.hoyRes.ventas)} · utilidad bruta ${lps(t.hoyRes.utilidadBruta)}`, "",
    "*RESULTADOS POR VENTA*",
    `Ventas: ${lps(r.ventas)} (${r.nVentas})`, `− Costo de ventas: ${lps(r.costoVentas)}`, `= Utilidad bruta: *${lps(r.utilidadBruta)}* (${r.margenBruto}%)`,
    `− Gastos: ${lps(r.gastosOperativos)} · Planilla: ${lps(r.planilla)}`, ...(r.cuposSinVender ? [`− Cupos sin vender: ${lps(r.cuposSinVender)}`] : []), ...(r.mermas ? [`− Mermas/vencimientos: ${lps(r.mermas)}`] : []),
    `= *Utilidad neta: ${lps(r.utilidadNeta)}* (${r.margenNeto}%)`, ...(top.length ? ["Mejores productos:", ...top] : []), "",
    "*CAJA Y BALANCE*",
    `Bancos ${lps(b.bancos)} · Binance ${b.binanceUsdt} USDT (${lps(b.binanceHnl)})`,
    `Por cobrar ${lps(b.cuentasPorCobrar)} · Inventario ${lps(b.inventario)}`, `Por pagar ${lps(b.cuentasPorPagar)} · *Patrimonio ${lps(b.patrimonio)}*`, "",
    `💸 Se puede repartir: *${lps(u.repartible)}* (limita ${u.limitaPor === "caja" ? "la caja" : "la utilidad"})`, "",
    ...(al.length ? ["*ALERTAS*", ...al, ""] : ["✅ Sin alertas", ""]),
    c.todoCuadra ? "🧮 Conciliación con el libro: ✔ todo cuadra" : `🧮 Conciliación: ✖ revisar ${c.filas.filter((f) => !f.ok).map((f) => esc(f.nombre)).join(", ")}`,
  ].join("\n");
  return upsertPanel(chatId, txt.length > 3900 ? `${txt.slice(0, 3900)}\n…` : txt, [
    [{ text: "💱 Binance", callback_data: "fl:emp:bin" }, { text: "📦 Inventario", callback_data: "fl:emp:inv" }],
    [{ text: "🧾 Cobrar / Pagar", callback_data: "fl:emp:cxc" }, { text: "💸 Retiro de dueños", callback_data: "fl:emp:ret" }],
    [{ text: "🔄 Actualizar", callback_data: "fl:emp" }, { text: "⬅️ Ciclo", callback_data: "fl:menu" }],
  ]);
}

async function panelBinance(chatId, userId) {
  const e = await emp(userId, "fin_empresa_estado", {});
  if (!e.ok) return bot.sendMessage(chatId, `⚠️ ${e.error}`);
  const b = e.billetera || {};
  const movs = (e.movimientosBinance || []).slice(0, 6).map((m) => `• ${dmy(m.fechaPago)} ${m.subtipo === "recarga" ? "Recarga" : m.subtipo === "ajuste" ? "Ajuste" : "Pago"} ${Number(m.montoUsdt) > 0 && m.direccion !== "salida" ? "+" : "−"}${Math.abs(Number(m.montoUsdt || 0))} USDT (${lps(m.monto)})`);
  return upsertPanel(chatId, [`💱 *BINANCE*`, "", `Saldo: *${b.saldo || 0} USDT*`, `Valor en libros: ${lps(b.valorHnl)}`, `Costo promedio: ${b.costoPromedio ? `L ${Number(b.costoPromedio).toFixed(4)}` : "—"} · última tasa ${b.ultimaTasa ? `L ${Number(b.ultimaTasa).toFixed(4)}` : "—"}`, "", ...(movs.length ? movs : ["Sin movimientos todavía."]), "", "Recargar Binance no es gasto: el banco baja y Binance sube."].join("\n"),
    [[{ text: "＋ Recargar desde banco", callback_data: "fl:emp:rec" }], volver]);
}
async function panelInventario(chatId, userId) {
  const e = await emp(userId, "fin_empresa_estado", {});
  if (!e.ok) return bot.sendMessage(chatId, `⚠️ ${e.error}`);
  const inv = e.inventario || [];
  const total = inv.reduce((a, r) => a + Number(r.valorHnl || 0), 0);
  const filas = inv.map((r) => `• ${esc(r.nombre)}: ${r.disponible} de ${r.comprado} · ${lps(r.valorHnl)}${r.stockBajo ? " ⚠️ stock bajo" : ""}${r.vencePronto ? ` ⏳ vence ${dmy(r.proximoVencimiento)}` : ""}`);
  return upsertPanel(chatId, [`📦 *INVENTARIO*`, `Valor total: *${lps(total)}*`, "", ...(filas.length ? filas : ["Sin inventario. Las compras se registran en la web (🏢 Empresa → Compras)."])].join("\n").slice(0, 3900), [volver]);
}
async function panelCobrarPagar(chatId, userId) {
  const e = await emp(userId, "fin_empresa_estado", {});
  if (!e.ok) return bot.sendMessage(chatId, `⚠️ ${e.error}`);
  const c = e.cxc || {}, p = e.cxp || {};
  const tr = ["0–7 días", "8–15 días", "16–30 días", "Más de 30 días"].map((t) => `   ${t}: ${lps((c.porTramo || {})[t] || 0)}`);
  const deud = (c.deudores || []).slice(0, 8).map((x) => `• ${esc(x.deudor)} (${x.deudorTipo}): ${lps(x.saldo)} · ${x.diasMax} días`);
  const pag = (p.cuentas || []).slice(0, 8).map((x) => `• ${esc(x.proveedor)}: ${x.saldo} ${x.moneda}${x.vencida ? " 🔴 VENCIDA" : ` · vence ${dmy(x.vence)}`}`);
  return upsertPanel(chatId, [`🧾 *POR COBRAR*: ${lps(c.totalHnl)}`, `Vendedores ${lps(c.vendedoresHnl)} · Clientes ${lps(c.clientesHnl)}`, ...tr, ...(deud.length ? ["", ...deud] : []), "", `🏷 *POR PAGAR A PROVEEDORES*: ${lps(p.totalHnl)}${p.vencidasHnl ? ` (vencido ${lps(p.vencidasHnl)})` : ""}`, ...(pag.length ? pag : ["No se le debe a ningún proveedor."]), "", "Los abonos se registran como siempre (APK/web/Telegram)."].join("\n").slice(0, 3900), [volver]);
}
async function elegirBanco(chatId, titulo, prefijo) {
  const bancos = await L().loadMethods();
  const kb = []; for (let i = 0; i < bancos.length; i += 2) kb.push(bancos.slice(i, i + 2).map((b, j) => ({ text: b.nombre, callback_data: `fl:emp:${prefijo}:${i + j}` })));
  kb.push([{ text: "❌ Cancelar", callback_data: "fl:emp" }]);
  return upsertPanel(chatId, titulo, kb);
}

async function callback(chatId, userId, data) {
  try {
    if (data === "fl:emp") return tablero(chatId, userId);
    if (data === "fl:emp:bin") return panelBinance(chatId, userId);
    if (data === "fl:emp:inv") return panelInventario(chatId, userId);
    if (data === "fl:emp:cxc") return panelCobrarPagar(chatId, userId);
    if (data === "fl:emp:rec") return elegirBanco(chatId, "💱 *RECARGAR BINANCE*\n\n1) ¿De qué banco salieron los Lempiras?", "rb");
    if (data === "fl:emp:ret") return elegirBanco(chatId, "💸 *RETIRO DE DUEÑOS*\n\nNo es gasto: baja el banco y el patrimonio.\n\n1) ¿De qué banco sale?", "tb");
    const m = data.match(/^fl:emp:(rb|tb):(\d+)$/);
    if (m) {
      const banco = (await L().loadMethods())[Number(m[2])]; if (!banco) return bot.sendMessage(chatId, "⚠️ Banco no válido.");
      if (m[1] === "rb") { pending.set(String(chatId), { mode: "flEmpRecHnl", bancoId: banco.id, banco: banco.nombre, op: nuevoOp() }); return bot.sendMessage(chatId, `2) ¿Cuántos *Lempiras* salieron de ${esc(banco.nombre)}?`, { parse_mode: "Markdown" }); }
      pending.set(String(chatId), { mode: "flEmpRetMonto", bancoId: banco.id, banco: banco.nombre, op: nuevoOp() }); return bot.sendMessage(chatId, `2) ¿Cuánto se retira de ${esc(banco.nombre)}? (Lempiras)`);
    }
    if (data === "fl:emp:rok" || data === "fl:emp:tok") {
      const p = pending.get(String(chatId)) || {};
      if (!["flEmpRecOk", "flEmpRetOk"].includes(p.mode)) return bot.sendMessage(chatId, "⚠️ Esto venció. Empiece otra vez.");
      pending.delete(String(chatId));
      const r = p.mode === "flEmpRecOk"
        ? await emp(userId, "fin_binance_recargar", { bancoId: p.bancoId, hnl: p.hnl, usdt: p.usdt, operationId: p.op })
        : await emp(userId, "fin_retiro_registrar", { bancoId: p.bancoId, monto: p.monto, beneficiario: p.beneficiario, motivo: "Retiro desde Telegram", operationId: p.op });
      if (!r.ok) return bot.sendMessage(chatId, `⚠️ ${r.error}`);
      await bot.sendMessage(chatId, r.duplicado ? "ℹ️ Ya estaba registrado." : p.mode === "flEmpRecOk" ? `✅ Binance +${p.usdt} USDT · tasa L ${r.tasa}` : `✅ Retiro de ${lps(p.monto)} registrado.`);
      return p.mode === "flEmpRecOk" ? panelBinance(chatId, userId) : tablero(chatId, userId);
    }
  } catch (e) { logErr("R140 empresa tg", e); return bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 200)}`); }
  return null;
}

async function texto(chatId, userId, t, p) {
  const n = Number(String(t).replace(/,/g, "").replace(/[^0-9.]/g, ""));
  if (p.mode === "flEmpRecHnl") { if (!(n > 0)) return bot.sendMessage(chatId, "Escriba los Lempiras, ej. 2820"); pending.set(String(chatId), { ...p, mode: "flEmpRecUsdt", hnl: n }); return bot.sendMessage(chatId, "3) ¿Cuántos *USDT* recibió en Binance?", { parse_mode: "Markdown" }); }
  if (p.mode === "flEmpRecUsdt") {
    if (!(n > 0)) return bot.sendMessage(chatId, "Escriba los USDT, ej. 100");
    pending.set(String(chatId), { ...p, mode: "flEmpRecOk", usdt: n });
    return upsertPanel(chatId, `💱 *Confirmar recarga*\n\n${esc(p.banco)}: −${lps(p.hnl)}\nBinance: +${n} USDT\nTasa efectiva: L ${(p.hnl / n).toFixed(4)}\n\nNo es gasto.`, [[{ text: "✅ Registrar", callback_data: "fl:emp:rok" }], [{ text: "❌ Cancelar", callback_data: "fl:emp" }]]);
  }
  if (p.mode === "flEmpRetMonto") { if (!(n > 0)) return bot.sendMessage(chatId, "Escriba el monto, ej. 1500"); pending.set(String(chatId), { ...p, mode: "flEmpRetQuien", monto: n }); return bot.sendMessage(chatId, "3) ¿Para quién es el retiro? (nombre del dueño/socio)"); }
  if (p.mode === "flEmpRetQuien") {
    const quien = String(t || "").trim().slice(0, 60); if (quien.length < 2) return bot.sendMessage(chatId, "Escriba el nombre.");
    pending.set(String(chatId), { ...p, mode: "flEmpRetOk", beneficiario: quien });
    return upsertPanel(chatId, `💸 *Confirmar retiro*\n\n${esc(quien)} · ${lps(p.monto)} de ${esc(p.banco)}\n\nNo es gasto: no baja la utilidad.`, [[{ text: "✅ Registrar", callback_data: "fl:emp:tok" }], [{ text: "❌ Cancelar", callback_data: "fl:emp" }]]);
  }
  return null;
}

module.exports = { callback, texto, emp, tablero };
