/* SUBLICUENTAS — FINANZAS R104 en Telegram (solo Sublicuentas y Relojes)
   Mismo libro mayor que la APK y /api/finanzas (mismas colecciones, mismos campos, mismas reglas):
   · finanzas_config/libro_mayor  (bases por banco, ciclo abierto)
   · finanzas_movimientos         (ingresos, egresos, planilla por banco, ajustes)
   · planilla_pagos               (pago padre; los hijos por banco van en finanzas_movimientos)
   Flujos:
   · 💼 Ciclo, saldos y planilla multi-banco (borrador en `pending`; cancelar no escribe nada).
   · Renovar desde Telegram: pide el pago REAL (monto escrito + dónde pagó) o “Ajuste sin pago” con motivo.
*/
const { bot, admin, db } = require("./index_01_core");
const { pending, upsertPanel, logErr } = require("./index_02_utils_roles");
const accessControl = require("./index_23_access_control");
const R = require("./lib_finanzas_reglas");

const LIBRO = () => db.collection("finanzas_config").doc("libro_mayor");
const lps = (n) => `Lps. ${R.fmt(n)}`;
const hoyYmd = () => R.ymd(new Date(Date.now() - 6 * 3600000));
const ymdToDmy = (v) => { const [y, m, d] = String(v).split("-"); return `${d}/${m}/${y}`; };
let cfg = { ejecutarRenovacion: null };
function configurar(opts = {}) { cfg = { ...cfg, ...opts }; }

async function esLibroUser(userId) {
  try {
    const ctx = await accessControl.getAccessContext(userId);
    return ctx.active && (ctx.role === "superadmin" || ["sublicuentas", "relojes"].includes(String(ctx.profile || "")));
  } catch (_) { return false; }
}
async function actorDe(userId) {
  try { const ctx = await accessControl.getAccessContext(userId); return { usuario: String(ctx.profile === "relojes" ? "relojes" : (ctx.name || ctx.profile || "sublicuentas")).toLowerCase(), uid: String(userId) }; }
  catch (_) { return { usuario: "telegram", uid: String(userId) }; }
}

// ---------------------------------------------------------------- libro mayor (igual que api/finanzas.js)
async function loadMethods() {
  const snap = await db.collection("portal_cliente").doc("configuracion").get();
  const metodos = snap.exists && Array.isArray(snap.data()?.metodos) ? snap.data().metodos : [];
  return R.publicMethods(metodos);
}
function libroFrom(data = {}) {
  const bases = data.bases && typeof data.bases === "object" ? data.bases : {};
  const desdes = Object.values(bases).map((b) => b?.desde).filter(Boolean).sort();
  const cicloInicio = data.cicloInicio || desdes[0] || "2026-10-01"; // Finanzas nueva arranca el 01/10/2026
  return { ...data, bases, cicloInicio, cicloId: data.cicloId || `ciclo_${cicloInicio}`, lecturaDesde: [cicloInicio, ...desdes].sort()[0] };
}
function movQuery(desde) {
  const [y, m, d] = desde.split("-").map(Number);
  return db.collection("finanzas_movimientos").where("fechaTS", ">=", admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d))));
}
async function estadoLibro(tx = null) {
  const [methods, libroSnap] = await Promise.all([loadMethods(), tx ? tx.get(LIBRO()) : LIBRO().get()]);
  const libro = libroFrom(libroSnap.exists ? libroSnap.data() : {});
  const snap = tx ? await tx.get(movQuery(libro.lecturaDesde)) : await movQuery(libro.lecturaDesde).get();
  const movimientos = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return { methods, libro, movimientos, totales: R.cycleTotals(movimientos, libro.cicloInicio, ""), saldos: R.bankBalances(movimientos, libro, methods) };
}
function fechaCampos(ymdValue) {
  const [y, m, d] = ymdValue.split("-").map(Number);
  return { fecha: ymdToDmy(ymdValue), fechaPago: ymdValue, fechaTS: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d, 12))), mesKey: ymdValue.slice(0, 7), monthKey: ymdValue.slice(0, 7) };
}
function opDocId(prefix, uid, opId) { return `${prefix}_op_tg${String(uid).replace(/\D/g, "")}_${opId}`; }
function newOpId() { return `tg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

async function registrarCobroRenovacion({ monto, bancoId, opId, actor, cliente = {} }) {
  const methods = await loadMethods();
  const banco = methods.find((m) => m.id === bancoId);
  if (!banco) throw new Error("Método de pago no válido.");
  if (!(R.money(monto) > 0)) throw new Error("Monto inválido.");
  const ref = db.collection("finanzas_movimientos").doc(`op_tg${String(actor.uid).replace(/\D/g, "")}_${opId}`);
  const now = new Date().toISOString();
  const data = {
    movimientoId: ref.id, origen: "telegram", origenCanal: "tg", registradoPor: actor.usuario, registradoPorId: actor.uid,
    tipo: "ingreso", subtipo: "cobro_renovacion", monto: R.money(monto), bancoId, banco: banco.nombre, metodoPago: banco.nombre,
    clienteNombre: cliente.nombre || "", clienteId: cliente.clienteId || "", compraId: cliente.compraId || "", plataforma: cliente.plataforma || "",
    fechaAnterior: cliente.fechaAnterior || "", fechaNueva: cliente.fechaNueva || "", telefono: cliente.telefono || "",
    cobradoPor: actor.usuario, operationId: opId, ...fechaCampos(hoyYmd()), createdAt: now, updatedAt: now,
  };
  try { await ref.create(data); } catch (e) { if (String(e?.code) === "6" || /already exists/i.test(String(e?.message))) return { duplicado: true, id: ref.id }; throw e; }
  return { duplicado: false, id: ref.id };
}

// Saldo inicial (una vez por banco) — igual que registrar_saldo_inicial de /api/finanzas.
async function registrarSaldoInicial({ bancoId, monto, desde, actor }) {
  const methods = await loadMethods();
  const banco = methods.find((m) => m.id === bancoId);
  if (!banco) throw Object.assign(new Error("Banco no válido."), { userError: true });
  const hoy = hoyYmd(); const d = /^\d{4}-\d{2}-\d{2}$/.test(String(desde)) && desde <= hoy ? desde : hoy;
  const now = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(LIBRO());
    const data = snap.exists ? (snap.data() || {}) : {};
    const bases = { ...(data.bases || {}) };
    if (bases[bancoId]) throw Object.assign(new Error(`${banco.nombre} ya tiene saldo inicial. Para corregir use “Ajuste de saldo”.`), { userError: true });
    if (data.ultimoCierreFin && d <= data.ultimoCierreFin) throw Object.assign(new Error(`La fecha debe ser posterior al último cierre (${ymdToDmy(data.ultimoCierreFin)}).`), { userError: true });
    bases[bancoId] = { saldo: R.money(monto), desde: d, registradoPor: actor.usuario, at: now };
    const movRef = db.collection("finanzas_movimientos").doc(`saldoini_${bancoId}`);
    tx.set(movRef, { movimientoId: movRef.id, origen: "telegram", origenCanal: "tg", registradoPor: actor.usuario, registradoPorId: actor.uid, tipo: "saldo_inicial", subtipo: "saldo_inicial", bancoId, banco: banco.nombre, monto: R.money(monto), ...fechaCampos(d), createdAt: now, updatedAt: now });
    const cicloInicio = !data.cicloInicio ? d : (!data.ultimoCierreFin && d < data.cicloInicio ? d : data.cicloInicio);
    tx.set(LIBRO(), { bases, cicloInicio, cicloId: data.ultimoCierreFin ? (data.cicloId || `ciclo_${cicloInicio}`) : `ciclo_${cicloInicio}`, updatedAt: now }, { merge: true });
    tx.set(db.collection("auditoria_eventos").doc(), { tipo: "finanzas_saldo_inicial", bancoId, monto: R.money(monto), desde: d, registradoPor: actor.usuario, origen: "tg", createdAt: now });
    return { banco: banco.nombre, desde: d };
  });
}
// Ajuste auditado (+ suma / − resta) — nunca se edita el saldo directo.
async function registrarAjuste({ bancoId, monto, motivo, opId, actor }) {
  const methods = await loadMethods(); const banco = methods.find((m) => m.id === bancoId);
  const ref = db.collection("finanzas_movimientos").doc(opDocId("ajuste", actor.uid, opId));
  const now = new Date().toISOString();
  try { await ref.create({ movimientoId: ref.id, origen: "telegram", origenCanal: "tg", registradoPor: actor.usuario, registradoPorId: actor.uid, tipo: "ajuste_saldo", subtipo: "ajuste_saldo", bancoId, banco: banco?.nombre || bancoId, monto: R.money(monto), motivo, operationId: opId, ...fechaCampos(hoyYmd()), createdAt: now, updatedAt: now }); }
  catch (e) { if (String(e?.code) === "6" || /already exists/i.test(String(e?.message))) return { duplicado: true }; throw e; }
  await db.collection("auditoria_eventos").add({ tipo: "finanzas_ajuste_saldo", bancoId, monto: R.money(monto), motivo, movimientoId: ref.id, registradoPor: actor.usuario, origen: "tg", createdAt: now });
  return { duplicado: false };
}
async function panelBancos(chatId) {
  const { saldos } = await estadoLibro();
  const lines = saldos.bancos.map((b) => b.activado ? `✅ ${b.nombre}: *${lps(b.saldo)}* (desde ${ymdToDmy(b.desde)})` : `⚪ ${b.nombre}: sin saldo inicial`);
  const kb = [];
  const pend = saldos.bancos.filter((b) => !b.activado).map((b) => ({ text: `➕ ${b.nombre}`, callback_data: `fl:si:pick:${b.id}` }));
  for (let i = 0; i < pend.length; i += 2) kb.push(pend.slice(i, i + 2));
  const act = saldos.bancos.filter((b) => b.activado).map((b) => ({ text: `± Ajustar ${b.nombre}`, callback_data: `fl:aj:pick:${b.id}` }));
  for (let i = 0; i < act.length; i += 2) kb.push(act.slice(i, i + 2));
  kb.push([{ text: "⬅️ Ciclo", callback_data: "fl:menu" }]);
  return upsertPanel(chatId, ["🏦 *SALDOS POR BANCO*", "", ...lines, "", pend.length ? "Toque ➕ para registrar el saldo inicial (una sola vez por banco)." : "Todos los bancos tienen saldo inicial. Para corregir use ± Ajustar (pide motivo)."].join("\n"), kb);
}

async function confirmarPagoPlanilla({ draft, actor }) {
  const pagoRef = db.collection("planilla_pagos").doc(opDocId("planilla", actor.uid, draft.opId));
  const hoy = hoyYmd(), now = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const ya = await tx.get(pagoRef);
    if (ya.exists) return { duplicado: true, pago: ya.data() };
    const { libro, totales, saldos } = await estadoLibro(tx);
    const v = R.validatePlanilla({ montoTotal: draft.monto, asignaciones: Object.entries(draft.asignaciones || {}).map(([bancoId, monto]) => ({ bancoId, monto })), bancos: saldos.bancos, disponibleCiclo: totales.resultado });
    if (!v.ok) { const e = new Error(v.errors.join("\n")); e.userError = true; throw e; }
    const pago = {
      planillaPagoId: pagoRef.id, cicloId: libro.cicloId, beneficiario: draft.beneficiario, concepto: draft.concepto, conceptoLabel: R.PLANILLA_CONCEPTOS[draft.concepto],
      descripcion: draft.descripcion || "", montoTotal: R.money(draft.monto), fecha: hoy, estado: "confirmado", asignaciones: v.asignaciones,
      registradoPor: actor.usuario, origenCanal: "tg", operationId: draft.opId, createdAt: now, updatedAt: now,
    };
    tx.set(pagoRef, pago);
    for (const a of v.asignaciones) {
      const movRef = db.collection("finanzas_movimientos").doc(`${pagoRef.id}_${a.bancoId}`);
      tx.set(movRef, {
        movimientoId: movRef.id, origen: "telegram", origenCanal: "tg", registradoPor: actor.usuario, registradoPorId: actor.uid,
        tipo: "egreso", subtipo: draft.concepto, planillaPagoId: pagoRef.id, grupoId: pagoRef.id, cicloId: libro.cicloId, beneficiario: draft.beneficiario,
        motivo: `${R.PLANILLA_CONCEPTOS[draft.concepto]} · ${draft.beneficiario}${draft.descripcion ? ` · ${draft.descripcion}` : ""}`,
        bancoId: a.bancoId, banco: a.banco, monto: a.monto, saldoAntes: a.saldoAntes, saldoDespues: a.saldoDespues,
        ...fechaCampos(hoy), operationId: draft.opId, createdAt: now, updatedAt: now,
      });
    }
    tx.set(db.collection("auditoria_eventos").doc(), { tipo: "finanzas_pago_planilla", planillaPagoId: pagoRef.id, beneficiario: draft.beneficiario, montoTotal: pago.montoTotal, registradoPor: actor.usuario, origen: "tg", createdAt: now });
    return { duplicado: false, pago };
  });
}

// ---------------------------------------------------------------- bancos enlazados (registro manual)
// Botón del registro manual → banco configurado. Acepta el id nuevo o el texto de un botón viejo.
async function bancoDesdeBoton(valor = "") {
  const methods = await loadMethods();
  const v = String(valor || "").trim();
  const m = methods.find((x) => x.id === v) || methods.find((x) => x.id === R.resolveBankId(v, methods));
  return m ? { id: m.id, nombre: m.nombre } : { id: "", nombre: v };
}

// Movimientos desde el 01/10/2026 que no se pueden enlazar a ningún banco registrado.
const DESDE_SIN_BANCO = "2026-10-01";
async function movimientosSinBanco() {
  const methods = await loadMethods();
  const snap = await movQuery(DESDE_SIN_BANCO).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((m) => ["ingreso", "egreso", "planilla"].includes(R.movementKind(m)) && R.movementBankId(m, methods) === R.SIN_BANCO)
    .sort((a, b) => R.movementYmd(a).localeCompare(R.movementYmd(b)));
}
function lineaMov(m) {
  const k = R.movementKind(m);
  return `${k === "ingreso" ? "➕" : "➖"} ${ymdToDmy(R.movementYmd(m))} · ${lps(m.monto)} · ${String(m.motivo || m.clienteNombre || m.detalle || m.plataforma || k).slice(0, 40)}${m.banco || m.metodoPago ? ` · “${String(m.banco || m.metodoPago).slice(0, 18)}”` : ""}`;
}
async function panelSinBanco(chatId, page = 0) {
  const rows = await movimientosSinBanco();
  const per = 8, total = rows.length, pages = Math.max(1, Math.ceil(total / per));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = rows.slice(page * per, page * per + per);
  pending.set(String(chatId), { mode: "flSinBanco", ids: slice.map((m) => m.id), page });
  if (!total) return upsertPanel(chatId, "🏷 *MOVIMIENTOS SIN BANCO*\n\n✅ Todo enlazado: no hay ingresos ni egresos sin banco desde el 01/10/2026.", [[{ text: "⬅️ Ciclo", callback_data: "fl:menu" }]]);
  const txt = [`🏷 *MOVIMIENTOS SIN BANCO* (desde 01/10/2026)`, `Faltan *${total}*. Toque el número para elegir su banco.`, "", ...slice.map((m, i) => `${i + 1}) ${lineaMov(m)}`), pages > 1 ? `\nPágina ${page + 1}/${pages}` : ""].join("\n");
  const nums = slice.map((_, i) => ({ text: String(i + 1), callback_data: `fl:sb:pick:${i}` }));
  const kb = []; for (let i = 0; i < nums.length; i += 4) kb.push(nums.slice(i, i + 4));
  const nav = []; if (page > 0) nav.push({ text: "⬅️", callback_data: `fl:sb:list:${page - 1}` }); if (page < pages - 1) nav.push({ text: "➡️", callback_data: `fl:sb:list:${page + 1}` }); if (nav.length) kb.push(nav);
  kb.push([{ text: "⬅️ Ciclo", callback_data: "fl:menu" }]);
  return upsertPanel(chatId, txt, kb);
}
async function asignarBanco(chatId, userId, idx, bankIdx) {
  const p = pending.get(String(chatId)) || {};
  const id = (p.ids || [])[idx];
  const methods = await loadMethods();
  const banco = methods[bankIdx];
  if (!id || !banco) return bot.sendMessage(chatId, "⚠️ La lista cambió. Ábrala de nuevo.");
  const ref = db.collection("finanzas_movimientos").doc(id);
  const actor = await actorDe(userId), now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Ese movimiento ya no existe.");
    const d = snap.data() || {};
    tx.set(ref, { bancoId: banco.id, banco: banco.nombre, ...(d.banco || d.metodoPago ? { bancoOriginal: String(d.banco || d.metodoPago) } : {}), bancoAsignadoPor: actor.usuario, bancoAsignadoAt: now, updatedAt: now }, { merge: true });
    tx.set(db.collection("auditoria_eventos").doc(), { tipo: "finanzas_banco_asignado", movimientoId: id, bancoId: banco.id, anterior: String(d.banco || d.metodoPago || ""), registradoPor: actor.usuario, origen: "tg", createdAt: now });
  });
  await bot.sendMessage(chatId, `✅ Enlazado a ${banco.nombre}.`);
  return panelSinBanco(chatId, p.page || 0);
}

// ---------------------------------------------------------------- pantallas
async function menuLibro(chatId) {
  const [{ libro, totales: t, saldos }, sinBanco] = await Promise.all([estadoLibro(), movimientosSinBanco().catch(() => [])]);
  const bancos = saldos.bancos.filter((b) => b.activado);
  const txt = [
    "💼 *CICLO FINANCIERO*", `Desde ${ymdToDmy(libro.cicloInicio)}`, "",
    `💵 Ingresos: ${lps(t.ingresos)}`, `🧾 Egresos operativos: −${lps(t.egresosOperativos)}`, `= Disponible antes de planilla: *${lps(t.disponibleAntesPlanilla)}*`,
    `👥 Planilla / comisiones: −${lps(t.planilla)}`, `= Resultado: *${lps(t.resultado)}*`, "",
    ...(sinBanco.length ? [`⚠️ *${sinBanco.length} movimiento${sinBanco.length === 1 ? "" : "s"} sin banco* desde el 01/10 → toque 🏷 para enlazarlos.`, ""] : []),
    `🏦 *Saldos reales* · ${lps(saldos.total)}`, ...(bancos.length ? bancos.map((b) => `• ${b.nombre}: ${lps(b.saldo)}`) : ["(Toque 🏦 Saldos por banco para registrar el saldo inicial de cada banco)"]),
  ].join("\n");
  return upsertPanel(chatId, txt, [
    [{ text: "🏦 Saldos por banco", callback_data: "fl:bancos" }],
    [{ text: "👥 Nuevo pago de planilla", callback_data: "fl:pl:new" }],
    [{ text: "🏷 Movimientos sin banco", callback_data: "fl:sb:list:0" }],
    [{ text: "🔄 Actualizar", callback_data: "fl:menu" }, { text: "🏠 Inicio", callback_data: "go:inicio" }],
  ]);
}

function planillaPanelText(draft, bancos, v) {
  const lines = bancos.map((b) => { const tomar = R.money(draft.asignaciones?.[b.id] || 0); return `• ${b.nombre}: ${lps(b.saldo)}${tomar ? ` − ${lps(tomar)} → *${lps(b.saldo - tomar)}*` : ""}`; });
  const estado = v.ok ? `✅ Distribución completa (${lps(v.asignado)}).` : v.errors.map((e) => `⚠️ ${e}`).join("\n");
  return ["👥 *PLANILLA / DISTRIBUCIÓN*", `Beneficiario: *${draft.beneficiario}*`, `Concepto: ${R.PLANILLA_CONCEPTOS[draft.concepto]}${draft.descripcion ? ` · ${draft.descripcion}` : ""}`, `Monto: *${lps(draft.monto)}*`, "", "Saldos (antes → después):", ...lines, "", `Asignado: ${lps(v.asignado)} · Restante: ${lps(Math.max(0, v.faltante))}`, estado].join("\n");
}
async function panelPlanilla(chatId, draft) {
  const { totales, saldos } = await estadoLibro();
  const bancos = saldos.bancos.filter((b) => b.activado);
  const v = R.validatePlanilla({ montoTotal: draft.monto, asignaciones: Object.entries(draft.asignaciones || {}).map(([bancoId, monto]) => ({ bancoId, monto })), bancos: saldos.bancos, disponibleCiclo: totales.resultado });
  const kb = [];
  for (let i = 0; i < bancos.length; i += 2) kb.push(bancos.slice(i, i + 2).map((b) => ({ text: `🏦 ${b.nombre}${draft.asignaciones?.[b.id] ? ` (${R.fmt(draft.asignaciones[b.id])})` : ""}`, callback_data: `fl:pl:bank:${b.id}` })));
  if (v.ok) kb.push([{ text: "✅ Confirmar pago", callback_data: "fl:pl:ok" }]);
  kb.push([{ text: "❌ Cancelar (no guarda nada)", callback_data: "fl:pl:cancel" }]);
  return upsertPanel(chatId, planillaPanelText(draft, bancos, v), kb);
}

// ---------------------------------------------------------------- renovación con pago real
async function iniciarPagoRenovacion(chatId, userId, accion) {
  pending.set(String(chatId), { mode: "flRenMonto", accion, opId: newOpId(), userId: String(userId) });
  return upsertPanel(chatId, `💵 *RENOVAR · ${accion.etiqueta || "servicio"}*\n\n¿Cuánto pagó el cliente?\nEscriba el monto real (ej. 220). No hay monto predeterminado.`, [
    [{ text: "🛠 Ajuste sin pago (garantía/cortesía)", callback_data: "fl:ren:ajuste" }],
    [{ text: "❌ Cancelar", callback_data: "fl:ren:cancel" }],
  ]);
}
async function ejecutarYCobrar(chatId, userId, p, { bancoId = "", motivo = "" } = {}) {
  if (typeof cfg.ejecutarRenovacion !== "function") throw new Error("Renovación no configurada.");
  pending.delete(String(chatId));
  const actor = await actorDe(userId);
  const info = await cfg.ejecutarRenovacion(chatId, userId, p.accion, { ajuste: !!motivo, motivo }); // renueva (una sola vez) y devuelve datos del cliente
  if (motivo) {
    await db.collection("auditoria_eventos").add({ tipo: "renovacion_ajuste_sin_pago", clienteId: p.accion.clientId, compraId: p.accion.compraId || "", motivo, registradoPor: actor.usuario, origen: "tg", createdAt: new Date().toISOString() });
    return bot.sendMessage(chatId, `🛠 Fecha movida sin ingreso${info?.fechaNueva ? ` · ${info.fechaNueva}` : ""}.\nMotivo: ${motivo}`);
  }
  const r = await registrarCobroRenovacion({ monto: p.monto, bancoId, opId: p.opId, actor, cliente: { ...(info || {}), clienteId: p.accion.clientId, compraId: p.accion.compraId || "" } });
  const banco = (await loadMethods()).find((m) => m.id === bancoId);
  return bot.sendMessage(chatId, `✅ Pago registrado: ${lps(p.monto)} en ${banco?.nombre || bancoId}${r.duplicado ? " (ya estaba registrado)" : ""}.${info?.fechaNueva ? `\nNueva fecha: ${info.fechaNueva}` : ""}`);
}

// ---------------------------------------------------------------- entradas desde index_06
async function handleCallback(chatId, userId, data) {
  if (!(await esLibroUser(userId))) return bot.sendMessage(chatId, "⛔ Finanzas (ciclo y planilla) es exclusivo de Sublicuentas y Relojes.");
  const p = pending.get(String(chatId)) || {};
  try {
    if (data === "fl:menu") return menuLibro(chatId);
    if (data === "fl:bancos") return panelBancos(chatId);
    if (data.startsWith("fl:si:pick:")) {
      const bancoId = data.slice("fl:si:pick:".length); const m = (await loadMethods()).find((x) => x.id === bancoId);
      pending.set(String(chatId), { mode: "flSiMonto", bancoId });
      return upsertPanel(chatId, `🏦 *Saldo inicial · ${m?.nombre || bancoId}*\n\n¿Cuánto tenía este banco al EMPEZAR el 01/10/2026? Escriba el monto (0 si estaba vacío).`, [[{ text: "❌ Cancelar", callback_data: "fl:bancos" }]]);
    }
    if (data.startsWith("fl:si:dia:") && p.mode === "flSiDia") {
      const v = data.slice("fl:si:dia:".length); return confirmarSaldoInicialTg(chatId, userId, p, v === "hoy" ? hoyYmd() : v);
    }
    if (data.startsWith("fl:aj:pick:")) {
      pending.set(String(chatId), { mode: "flAjMonto", bancoId: data.slice("fl:aj:pick:".length), opId: newOpId() });
      return bot.sendMessage(chatId, "± Escriba el ajuste: positivo suma (ej. 150), negativo resta (ej. -150).");
    }
    if (data.startsWith("fl:sb:list:")) return panelSinBanco(chatId, Number(data.split(":")[3] || 0));
    if (data.startsWith("fl:sb:pick:")) {
      const i = Number(data.split(":")[3]); const id = (p.ids || [])[i];
      if (!id) return panelSinBanco(chatId, 0);
      const doc = await db.collection("finanzas_movimientos").doc(id).get();
      const methods = await loadMethods(); const kb = [];
      const btns = methods.map((m, j) => ({ text: m.nombre, callback_data: `fl:sb:set:${i}:${j}` }));
      for (let k = 0; k < btns.length; k += 2) kb.push(btns.slice(k, k + 2));
      kb.push([{ text: "⬅️ Lista", callback_data: `fl:sb:list:${p.page || 0}` }]);
      return upsertPanel(chatId, `🏷 *Elegir banco*\n\n${lineaMov({ id, ...(doc.data() || {}) })}\n\n¿De qué banco entró / salió este dinero?`, kb);
    }
    if (data.startsWith("fl:sb:set:")) { const [, , , i, j] = data.split(":"); return asignarBanco(chatId, userId, Number(i), Number(j)); }
    if (data === "fl:pl:new") { pending.set(String(chatId), { mode: "flPlBen", draft: { opId: newOpId(), asignaciones: {} } }); return upsertPanel(chatId, "👥 *Nuevo pago*\n\n1) Escriba el nombre del beneficiario (libre):", [[{ text: "❌ Cancelar", callback_data: "fl:pl:cancel" }]]); }
    if (data === "fl:pl:cancel") { pending.delete(String(chatId)); await bot.sendMessage(chatId, "Borrador cancelado. No se movió ningún saldo."); return menuLibro(chatId); }
    if (data.startsWith("fl:pl:con:") && p.draft) {
      p.draft.concepto = data.slice("fl:pl:con:".length);
      if (!R.PLANILLA_SUBTIPOS.has(p.draft.concepto)) return;
      p.mode = p.draft.concepto === "otro_planilla" ? "flPlDesc" : "flPlMonto"; pending.set(String(chatId), p);
      return bot.sendMessage(chatId, p.mode === "flPlDesc" ? "Describa el pago (“Otro”):" : "3) Escriba el monto total del pago (ej. 2000):");
    }
    if (data.startsWith("fl:pl:bank:") && p.draft) {
      p.mode = "flPlBankMonto"; p.bancoSel = data.slice("fl:pl:bank:".length); pending.set(String(chatId), p);
      const { saldos } = await estadoLibro(); const b = saldos.bancos.find((x) => x.id === p.bancoSel);
      return bot.sendMessage(chatId, `🏦 ${b?.nombre || p.bancoSel} · saldo ${lps(b?.saldo)}\n¿Cuánto tomar de este banco? (0 para quitarlo)`);
    }
    if (data === "fl:pl:ok" && p.draft) {
      const actor = await actorDe(userId);
      try {
        const r = await confirmarPagoPlanilla({ draft: p.draft, actor });
        pending.delete(String(chatId));
        await bot.sendMessage(chatId, `✅ Pago confirmado${r.duplicado ? " (ya estaba confirmado)" : ""}: ${p.draft.beneficiario} · ${lps(p.draft.monto)}\n${(r.pago?.asignaciones || []).map((a) => `• ${a.banco}: ${lps(a.monto)} (${lps(a.saldoAntes)} → ${lps(a.saldoDespues)})`).join("\n")}`);
        return menuLibro(chatId);
      } catch (e) { if (e.userError) { await bot.sendMessage(chatId, `⚠️ ${e.message}`); return panelPlanilla(chatId, p.draft); } throw e; }
    }
    if (data === "fl:ren:cancel") { pending.delete(String(chatId)); return bot.sendMessage(chatId, "Renovación cancelada. No se cambió nada."); }
    if (data === "fl:ren:ajuste" && p.accion) { p.mode = "flRenMotivo"; pending.set(String(chatId), p); return bot.sendMessage(chatId, "🛠 Escriba el motivo del ajuste (garantía, cortesía, corrección…):"); }
    if (data.startsWith("fl:ren:bank:") && p.accion && p.monto) return ejecutarYCobrar(chatId, userId, p, { bancoId: data.slice("fl:ren:bank:".length) });
  } catch (e) { logErr("finanzas_libro.callback", e); return bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 220)}`); }
  return null;
}

async function confirmarSaldoInicialTg(chatId, userId, p, desde) {
  try {
    const r = await registrarSaldoInicial({ bancoId: p.bancoId, monto: p.monto, desde, actor: await actorDe(userId) });
    pending.delete(String(chatId));
    await bot.sendMessage(chatId, `✅ Saldo inicial de ${r.banco}: ${lps(p.monto)} al empezar el ${ymdToDmy(r.desde)}.`);
  } catch (e) { pending.delete(String(chatId)); await bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 220)}`); }
  return panelBancos(chatId);
}

async function handleText(chatId, userId, text, p) {
  const t = String(text || "").trim();
  const num = Number(t.replace(/[^0-9.\-]/g, ""));
  try {
    if (p.mode === "flSiMonto") {
      if (!(num >= 0) || t === "") return bot.sendMessage(chatId, "Escriba el monto (0 o más), ej. 4000.");
      p.monto = R.money(num); p.mode = "flSiDia"; pending.set(String(chatId), p);
      return upsertPanel(chatId, `Saldo: *${lps(p.monto)}*\n¿Desde qué día cuenta este saldo?\n(o escriba otra fecha dd/mm/yyyy)`, [
        [{ text: "📅 01/10/2026 (recomendado)", callback_data: "fl:si:dia:2026-10-01" }], [{ text: "Hoy", callback_data: "fl:si:dia:hoy" }], [{ text: "❌ Cancelar", callback_data: "fl:bancos" }]]);
    }
    if (p.mode === "flSiDia") {
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return bot.sendMessage(chatId, "Escriba la fecha como dd/mm/yyyy o toque un botón.");
      return confirmarSaldoInicialTg(chatId, userId, p, `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
    }
    if (p.mode === "flAjMonto") {
      if (!num) return bot.sendMessage(chatId, "Escriba el ajuste (ej. 150 o -150).");
      p.monto = R.money(num); p.mode = "flAjMotivo"; pending.set(String(chatId), p);
      return bot.sendMessage(chatId, "Escriba el motivo del ajuste:");
    }
    if (p.mode === "flAjMotivo") {
      if (t.length < 4) return bot.sendMessage(chatId, "El ajuste necesita un motivo (mínimo 4 letras).");
      await registrarAjuste({ bancoId: p.bancoId, monto: p.monto, motivo: t.slice(0, 200), opId: p.opId, actor: await actorDe(userId) });
      pending.delete(String(chatId)); await bot.sendMessage(chatId, `✅ Ajuste de ${lps(p.monto)} guardado.`);
      return panelBancos(chatId);
    }
    if (p.mode === "flRenMonto") {
      if (!(num > 0)) return bot.sendMessage(chatId, "Escriba solo el monto que pagó (mayor que 0), ej. 220.");
      p.monto = R.money(num); p.mode = "flRenBanco"; pending.set(String(chatId), p);
      const methods = await loadMethods(); const kb = [];
      for (let i = 0; i < methods.length; i += 2) kb.push(methods.slice(i, i + 2).map((m) => ({ text: m.nombre, callback_data: `fl:ren:bank:${m.id}` })));
      kb.push([{ text: "❌ Cancelar", callback_data: "fl:ren:cancel" }]);
      return upsertPanel(chatId, `💵 Pagó *${lps(p.monto)}*\n¿Dónde pagó?`, kb);
    }
    if (p.mode === "flRenMotivo") {
      if (t.length < 4) return bot.sendMessage(chatId, "El ajuste necesita un motivo (mínimo 4 letras).");
      return ejecutarYCobrar(chatId, userId, p, { motivo: t.slice(0, 200) });
    }
    if (p.mode === "flPlBen") {
      if (!t) return bot.sendMessage(chatId, "Escriba el beneficiario.");
      p.draft.beneficiario = t.slice(0, 80); p.mode = "flPlCon"; pending.set(String(chatId), p);
      return upsertPanel(chatId, `👥 Beneficiario: *${p.draft.beneficiario}*\n\n2) Elija el concepto:`, [
        ...Object.entries(R.PLANILLA_CONCEPTOS).map(([k, label]) => [{ text: label, callback_data: `fl:pl:con:${k}` }]),
        [{ text: "❌ Cancelar", callback_data: "fl:pl:cancel" }]]);
    }
    if (p.mode === "flPlDesc") {
      if (t.length < 3) return bot.sendMessage(chatId, "Escriba una descripción.");
      p.draft.descripcion = t.slice(0, 160); p.mode = "flPlMonto"; pending.set(String(chatId), p);
      return bot.sendMessage(chatId, "3) Escriba el monto total del pago (ej. 2000):");
    }
    if (p.mode === "flPlMonto") {
      if (!(num > 0)) return bot.sendMessage(chatId, "Escriba el monto total (mayor que 0).");
      p.draft.monto = R.money(num); p.mode = "flPlDist"; pending.set(String(chatId), p);
      return panelPlanilla(chatId, p.draft);
    }
    if (p.mode === "flPlBankMonto") {
      if (!(num >= 0)) return bot.sendMessage(chatId, "Escriba un monto (0 para quitar el banco).");
      if (num > 0) p.draft.asignaciones[p.bancoSel] = R.money(num); else delete p.draft.asignaciones[p.bancoSel];
      p.mode = "flPlDist"; delete p.bancoSel; pending.set(String(chatId), p);
      return panelPlanilla(chatId, p.draft);
    }
  } catch (e) { logErr("finanzas_libro.text", e); return bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 220)}`); }
  return bot.sendMessage(chatId, "Use los botones del panel o toque ❌ Cancelar.");
}

module.exports = { registrarSaldoInicial, registrarAjuste, bancoDesdeBoton, movimientosSinBanco, configurar, esLibroUser, iniciarPagoRenovacion, handleCallback, handleText, menuLibro, estadoLibro, loadMethods, registrarCobroRenovacion, confirmarPagoPlanilla };
