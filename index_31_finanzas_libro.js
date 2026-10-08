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
function usuarioCanonico(raw = "") {
  const k = String(raw || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").trim();
  if (["naara", "sublicuentas", "sublicuentas2"].includes(k)) return "sublicuentas";
  if (["libni", "daniela", "relojes", "finanzas"].includes(k)) return "relojes";
  return k || "sublicuentas";
}
function usuarioLabel(raw = "", socioNombre = "") {
  if (socioNombre) return String(socioNombre).trim();
  const k = usuarioCanonico(raw);
  if (k === "sublicuentas") return "Sublicuentas";
  if (k === "relojes") return "Relojes";
  return String(raw || "Usuario").trim() || "Usuario";
}
async function actorDe(userId) {
  try {
    const ctx = await accessControl.getAccessContext(userId);
    const raw = ctx.profile || ctx.name || ctx.usuario || "sublicuentas";
    const usuario = usuarioCanonico(raw);
    return { usuario, label: usuarioLabel(usuario), uid: String(userId) };
  } catch (_) { return { usuario: "sublicuentas", label: "Sublicuentas", uid: String(userId) }; }
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
  // R113: sin "saldo inicial": resumen de entradas y salidas por banco.
  const lines = saldos.bancos.filter((b) => b.movimientos || !b.sinSaldoInicial).map((b) => `🏦 *${b.nombre}*: ${lps(b.saldo)}\n   +${lps(b.ingresos)} ingresos · −${lps(b.egresosOperativos + b.planilla)} egresos`);
  const kb = [];
  const pend = saldos.bancos.filter((b) => !b.activado).map((b) => ({ text: `➕ ${b.nombre}`, callback_data: `fl:si:pick:${b.id}` }));
  for (let i = 0; i < pend.length; i += 2) kb.push(pend.slice(i, i + 2));
  const act = saldos.bancos.filter((b) => b.activado).map((b) => ({ text: `± Ajustar ${b.nombre}`, callback_data: `fl:aj:pick:${b.id}` }));
  for (let i = 0; i < act.length; i += 2) kb.push(act.slice(i, i + 2));
  kb.push([{ text: "⬅️ Ciclo", callback_data: "fl:menu" }]);
  return upsertPanel(chatId, ["🏦 *SALDOS POR BANCO*", "", ...lines, "", "Resumen desde el 01/10/2026. Para corregir un saldo use ± Ajustar (pide motivo)."].join("\n"), kb);
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

// ---------------------------------------------------------------- FECHA REAL DEL DINERO · ajuste manual y auditado
// Regla: la fecha financiera es el día en que el dinero ENTRÓ/SALIÓ realmente.
// Nunca se infiere desde la fecha de corte/renovación del cliente. Ej.: corte 29/09 + pago 03/10 => Finanzas 03/10.
// La fecha de servicio (fechaAnterior/fechaNueva) se conserva aparte y NO mueve dinero.
function dmyAYmd(v = "") { const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; }
function movimientoAjustable(m = {}) {
  const kind = R.movementKind(m);
  return ["ingreso", "egreso", "ajuste"].includes(kind) && !m.reversaDe && !m.estadoFinanciero && !m.planillaPagoId;
}
function nombreMovimiento(m = {}) { return String(m.clienteNombre || m.beneficiario || m.deudorNombre || m.socioNombre || m.motivo || m.plataforma || m.tipo || "Movimiento").trim(); }
function usuarioMovimientoLabel(m = {}) {
  const origen = String(m.origenCanal || m.origen || "").toLowerCase();
  if (["socios", "socio", "revendedor", "revendedores"].includes(origen)) return usuarioLabel("", m.socioNombre || m.revendedorNombre || m.registradoPorNombre || m.registradoPor || "Socio");
  return usuarioLabel(m.cobradoPor || m.registradoPor || m.userName || "");
}
// R110 · Un cliente paga UNA vez: los cobros del mismo cliente, banco, usuario y día registrados juntos
// (p. ej. renovar 3 servicios en la APK) se muestran y ajustan como UN solo pago.
async function movimientosAjustables() {
  const { movimientos } = await estadoLibro();
  const lista = movimientos.filter(movimientoAjustable).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const grupos = [];
  for (const m of lista) {
    const quien = String(m.clienteId || nombreMovimiento(m)).toLowerCase().trim();
    const key = [R.movementKind(m), quien, m.bancoId || m.banco || "", R.movementYmd(m)].join("|"); // R129: mismo cliente + banco + día = 1 pago
    const t = Date.parse(m.createdAt || "") || 0;
    const g = R.movementKind(m) === "ingreso" ? grupos.find((x) => x.key === key) : null;
    if (g) { g.items.push(m); g.monto = R.money(g.monto + R.money(m.monto)); }
    else grupos.push({ key, t, items: [m], monto: R.money(m.monto) });
  }
  return grupos.map((g) => ({ ...g.items[0], id: g.items.map((x) => x.id).join(","), monto: g.monto, servicios: g.items.map((x) => x.plataforma).filter(Boolean), n: g.items.length }))
    .sort((a, b) => String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || "")));
}
async function panelAjustarFechas(chatId, page = 0) {
  const all = await movimientosAjustables();
  const per = 8, pages = Math.max(1, Math.ceil(all.length / per)); page = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const slice = all.slice(page * per, page * per + per);
  pending.set(String(chatId), { mode: "flFechaList", ids: slice.map((m) => m.id), page });
  const txt = [
    "🗓 *AJUSTAR FECHA DEL PAGO*",
    "",
    "Elija SOLO el movimiento que quiera corregir. La fecha de renovación/corte del cliente NO se usa como fecha del dinero.",
    "Ejemplo: corte 29/09, pagó 03/10 → el ingreso queda 03/10.",
    "",
    ...(slice.length ? slice.map((m, i) => `${i + 1}) *${R.movementYmd(m) ? ymdToDmy(R.movementYmd(m)) : "Sin fecha"}* · ${lps(m.monto)} · ${`${nombreMovimiento(m).slice(0, 30)}${m.n > 1 ? ` (${m.n} servicios)` : ""}`} · ${m.banco || m.metodoPago || "Sin banco"} · ${usuarioMovimientoLabel(m)}`) : ["No hay movimientos ajustables."]),
    "",
    `Página ${page + 1}/${pages}`
  ].join("\n");
  const kb = [];
  const nums = slice.map((_, i) => ({ text: `🗓 ${i + 1}`, callback_data: `fl:fd:pick:${i}` }));
  for (let i = 0; i < nums.length; i += 4) kb.push(nums.slice(i, i + 4));
  const nav = []; if (page > 0) nav.push({ text: "⬅️", callback_data: `fl:fd:list:${page - 1}` }); if (page < pages - 1) nav.push({ text: "➡️", callback_data: `fl:fd:list:${page + 1}` }); if (nav.length) kb.push(nav);
  kb.push([{ text: "⬅️ Ciclo", callback_data: "fl:menu" }]);
  return upsertPanel(chatId, txt, kb);
}
async function panelFechaDetalle(chatId, movimientoId, page = 0) {
  const ids = String(movimientoId || "").split(",").filter(Boolean);
  const snaps = await Promise.all(ids.map((id) => db.collection("finanzas_movimientos").doc(id).get()));
  const items = snaps.filter((x) => x.exists).map((x) => ({ id: x.id, ...(x.data() || {}) }));
  if (!items.length) return panelAjustarFechas(chatId, page);
  if (!items.every(movimientoAjustable)) return bot.sendMessage(chatId, "⚠️ Ese pago ya no se puede ajustar.");
  const m = { ...items[0], monto: R.money(items.reduce((a, x) => a + R.money(x.monto), 0)), plataforma: items.map((x) => x.plataforma).filter(Boolean).join(" + ") };
  pending.set(String(chatId), { mode: "flFechaDetalle", movimientoId, page });
  const hoy = hoyYmd();
  const dias = [0, -1, -2, -3].map((n) => R.addDaysYmd(hoy, n));
  const txt = [
    "🗓 *AJUSTAR FECHA DEL PAGO*", "",
    `Cliente / detalle: *${nombreMovimiento(m).slice(0, 60)}*`,
    `Monto: *${lps(m.monto)}*`,
    `Banco: ${m.banco || m.metodoPago || "Sin banco"}`,
    `Usuario: ${usuarioMovimientoLabel(m)}`,
    `Fecha actual en Finanzas: *${R.movementYmd(m) ? ymdToDmy(R.movementYmd(m)) : "Sin fecha"}*`,
    m.fechaAnterior || m.fechaNueva ? `Fecha del servicio: ${m.fechaAnterior || "—"} → ${m.fechaNueva || "—"} _(solo referencia; no mueve dinero)_` : "",
    "", "Seleccione la fecha REAL en que entró/salió el dinero:"
  ].filter(Boolean).join("\n");
  return upsertPanel(chatId, txt, [
    [{ text: `Hoy ${ymdToDmy(dias[0])}`, callback_data: `fl:fd:set:${dias[0]}` }, { text: `Ayer ${ymdToDmy(dias[1])}`, callback_data: `fl:fd:set:${dias[1]}` }],
    [{ text: ymdToDmy(dias[2]), callback_data: `fl:fd:set:${dias[2]}` }, { text: ymdToDmy(dias[3]), callback_data: `fl:fd:set:${dias[3]}` }],
    [{ text: "✍️ Escribir otra fecha", callback_data: "fl:fd:manual" }],
    [{ text: "⬅️ Lista", callback_data: `fl:fd:list:${page}` }]
  ]);
}
async function ajustarFechaMovimiento({ movimientoId, nuevaFecha, actor, motivo = "Ajuste manual de fecha de pago" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nuevaFecha || ""))) throw Object.assign(new Error("Fecha inválida."), { userError: true });
  if (nuevaFecha > hoyYmd()) throw Object.assign(new Error("La fecha del pago no puede ser futura."), { userError: true });
  const ids = String(movimientoId || "").split(",").filter(Boolean);
  const refs = ids.map((id) => db.collection("finanzas_movimientos").doc(id));
  const ventas = ids.filter((id) => id.endsWith("_cobro")).map((id) => db.collection("finanzas_movimientos").doc(id.replace(/_cobro$/, "_venta")));
  const now = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const vSnaps = await Promise.all(ventas.map((r) => tx.get(r)));
    const items = snaps.filter((x) => x.exists).map((x) => x.data() || {});
    if (!items.length) throw Object.assign(new Error("Ese pago ya no existe."), { userError: true });
    if (!items.every(movimientoAjustable)) throw Object.assign(new Error("Ese pago no admite ajuste de fecha."), { userError: true });
    const antesYmd = R.movementYmd(items[0]);
    const total = R.money(items.reduce((a, x) => a + R.money(x.monto), 0));
    if (items.every((x) => R.movementYmd(x) === nuevaFecha)) return { sinCambios: true, antes: antesYmd, despues: nuevaFecha, movimiento: items[0] };
    const campos = { ...fechaCampos(nuevaFecha), fechaPagoAjustadaManualmente: true, fechaAjustadaPor: actor.usuario, fechaAjustadaAt: now, updatedAt: now };
    snaps.forEach((x, k) => { if (x.exists) tx.set(refs[k], { ...campos, fechaAjustadaDe: R.movementYmd(x.data() || {}) || "" }, { merge: true }); });
    vSnaps.forEach((x, k) => { if (x.exists) tx.set(ventas[k], { ...campos, fechaAjustadaDe: R.movementYmd(x.data() || {}) || "" }, { merge: true }); }); // la venta va con su cobro
    tx.set(db.collection("auditoria_eventos").doc(), {
      actorUsuario: actor.usuario, actorLabel: actor.label || usuarioLabel(actor.usuario), rol: "telegram", origen: "tg", modulo: "finanzas", accion: "ajustar_fecha_pago",
      targetType: "pago", targetId: ids.join(","), movimientoId: ids[0], before: { fechaPago: antesYmd || "" }, after: { fechaPago: nuevaFecha },
      motivo, detalle: `${antesYmd ? ymdToDmy(antesYmd) : "Sin fecha"} → ${ymdToDmy(nuevaFecha)} · ${nombreMovimiento(items[0])} · ${lps(total)}${items.length > 1 ? ` (${items.length} servicios, un solo pago)` : ""}`, resultado: "ok", tipo: "finanzas_ajustar_fecha_pago", createdAt: now
    });
    return { sinCambios: false, antes: antesYmd, despues: nuevaFecha, movimiento: { ...items[0], monto: total } };
  });
}

// ---------------------------------------------------------------- R118 · cuenta completa por Telegram
// Plataforma → correo → clave → precio → meses → (pago). Sin PIN ni perfiles; se guarda tipoVenta=cuenta_completa.
async function iniciarCuentaCompleta(chatId, userId, { clientId, plat }) {
  const cat = require("./lib_catalogo_categorias");
  if (!cat.puedeSerCuentaCompleta(plat)) return bot.sendMessage(chatId, "⚠️ Esa plataforma no se vende como cuenta completa.");
  pending.set(String(chatId), { mode: "flCcCorreo", clientId, plat, userId: String(userId) });
  return bot.sendMessage(chatId, `🔐 *CUENTA COMPLETA · ${plat.toUpperCase()}*\n\n1) Escriba el *correo* de la cuenta:`, { parse_mode: "Markdown" });
}
async function textoCuentaCompleta(chatId, userId, t, p) {
  if (p.mode === "flCcCorreo") { if (!/^\S+@\S+\.\S+$/.test(t)) return bot.sendMessage(chatId, "Escriba un correo válido."); p.correo = t; p.mode = "flCcClave"; pending.set(String(chatId), p); return bot.sendMessage(chatId, "2) Escriba la *clave* de la cuenta:", { parse_mode: "Markdown" }); }
  if (p.mode === "flCcClave") { if (t.length < 3) return bot.sendMessage(chatId, "Escriba la clave."); p.clave = t; p.mode = "flCcPrecio"; pending.set(String(chatId), p); return bot.sendMessage(chatId, "3) Escriba el *precio* real de la venta (ej. 450):", { parse_mode: "Markdown" }); }
  if (p.mode === "flCcPrecio") { const n = Number(t.replace(/[^0-9.]/g, "")); if (!(n > 0)) return bot.sendMessage(chatId, "Escriba el precio (mayor que 0)."); p.precio = R.money(n); p.mode = "flCcMeses"; pending.set(String(chatId), p); return bot.sendMessage(chatId, "4) ¿Cuántos *meses*? (1 a 12)", { parse_mode: "Markdown" }); }
  if (p.mode === "flCcMeses") {
    const meses = Math.round(Number(t)); if (!(meses >= 1 && meses <= 12)) return bot.sendMessage(chatId, "Escriba los meses (1 a 12).");
    pending.delete(String(chatId));
    const d = new Date(Date.now() - 6 * 3600000); const dia = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + meses);
    const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(dia, ult)); // mes calendario
    const fecha = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    const { addServicioTx, getCliente } = require("./index_03_clientes_crm");
    const r = await addServicioTx(p.clientId, { plataforma: p.plat, correo: p.correo, clave: p.clave, precio: p.precio, fechaRenovacion: fecha, mesesContratados: meses, tipoVenta: "cuenta_completa", categoria: "cuentas_completas", sinPinPerfil: true });
    const c = await getCliente(p.clientId).catch(() => null);
    await bot.sendMessage(chatId, `✅ Cuenta completa guardada · ${p.plat} · ${lps(p.precio)} · vence ${fecha}\n(la clave no se muestra en auditoría)`);
    if (await esLibroUser(userId)) return iniciarPagoCompra(chatId, userId, { clientId: p.clientId, compraId: String(r?.servicio?.compraId || ""), plataforma: `${p.plat} · cuenta completa`, cliente: c?.nombrePerfil || c?.nombre || "Cliente" });
    return null;
  }
  return null;
}

// ---------------------------------------------------------------- pantallas

// R132 · CUADRE Telegram vs APK. Los dos leen finanzas_movimientos, pero la APK (y el ciclo del bot) solo toma docs con
// fechaTS desde el inicio del libro y fecha = fechaPago; los reportes de Telegram toman la fecha escrita (dd/mm/yyyy).
// Si un movimiento quedó sin fechaTS o con fechaPago vieja (ej. cuando se le cambiaba la fecha desde Telegram, que
// solo tocaba "fecha"), un lado lo contaba y el otro no. Este panel enseña la diferencia y la repara.
function dmyAYmdR132(v = "") { const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; }
function tsMsR132(ts) { return ts && typeof ts.toMillis === "function" ? ts.toMillis() : (ts && ts._seconds ? ts._seconds * 1000 : (ts?.seconds ? ts.seconds * 1000 : NaN)); }
function signoR132(m = {}) { const k = R.movementKind(m); return k === "ingreso" ? 1 : (k === "egreso" || k === "planilla") ? -1 : 0; }
function lineaR132(m = {}, y = "") {
  const k = R.movementKind(m), quien = String(m.clienteNombre || m.cliente || m.beneficiario || m.motivo || m.detalle || m.plataforma || "—").slice(0, 28);
  return `• ${y ? ymdToDmy(y) : "?"} · ${k === "ingreso" ? "➕" : "➖"} ${lps(m.monto)} · ${quien} · ${m.banco || m.bancoId || "sin banco"}`;
}
// Docs del libro cuya fecha escrita no coincide con fechaPago/fechaTS (o les falta): son los que descuadran.
async function descuadresFechaR132(desdeYmd) {
  const snap = await db.collection("finanzas_movimientos").get();
  const out = [];
  snap.forEach((d) => {
    const m = { id: d.id, ...(d.data() || {}) };
    const yFecha = dmyAYmdR132(m.fecha);
    if (!yFecha || yFecha < desdeYmd) return;
    // fechaTS debe ser Timestamp de Firestore (un número no lo ve la APK) y caer en el mismo día (medianoche UTC del bot o mediodía UTC de la API).
    const ms = typeof m.fechaTS === "number" ? NaN : tsMsR132(m.fechaTS);
    const tsOk = Number.isFinite(ms) && [R.ymd(new Date(ms)), R.ymd(new Date(ms - 6 * 3600000))].includes(yFecha);
    const yPago = String(m.fechaPago || "").slice(0, 10);
    if (!tsOk || (yPago && yPago !== yFecha)) out.push({ m, yFecha, yPago });
  });
  return out;
}
async function repararFechasR132(desdeYmd, actor = "telegram") {
  const malos = await descuadresFechaR132(desdeYmd);
  for (let i = 0; i < malos.length; i += 400) {
    const batch = db.batch();
    for (const { m, yFecha } of malos.slice(i, i + 400)) {
      const [y, mo, d] = yFecha.split("-").map(Number);
      batch.set(db.collection("finanzas_movimientos").doc(m.id), { fecha: ymdToDmy(yFecha), fechaPago: yFecha, fechaTS: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, mo - 1, d, 12))), mesKey: yFecha.slice(0, 7), monthKey: yFecha.slice(0, 7), fechaReparadaR132: true, fechaReparadaPor: actor, updatedAt: new Date().toISOString() }, { merge: true });
    }
    await batch.commit();
  }
  return malos.length;
}
async function cuadreTgApkR132(chatId) {
  const { libro, movimientos, totales } = await estadoLibro();
  const ini = libro.cicloInicio, hoy = hoyYmd();
  const apk = new Map();
  for (const m of movimientos) {
    if (R.anuladoOReversa(m) || !signoR132(m)) continue;
    const y = R.movementYmd(m); if (!y || y < ini) continue;
    apk.set(m.id, { m, y, v: R.money(signoR132(m) * R.money(m.monto)) });
  }
  const fin = [hoy, ...Array.from(apk.values()).map((x) => x.y)].sort().pop();
  const filas = await require("./index_05_finanzas_menus").getMovimientosPorRango(ymdToDmy(ini), ymdToDmy(fin));
  const tg = new Map();
  for (const r of filas) { const v = R.money((String(r.tipo || "").trim().toLowerCase() === "egreso" ? -1 : 1) * Number(r.monto || 0)); tg.set(r.id, { m: r, y: dmyAYmdR132(r.fecha), v }); }
  const sum = (map) => R.money(Array.from(map.values()).reduce((s, x) => s + x.v, 0));
  const soloTg = Array.from(tg.entries()).filter(([id]) => !apk.has(id)).map(([, x]) => x);
  const soloApk = Array.from(apk.entries()).filter(([id]) => !tg.has(id)).map(([, x]) => x);
  const distinto = Array.from(apk.entries()).filter(([id, a]) => tg.has(id) && tg.get(id).v !== a.v).map(([id, a]) => ({ a, t: tg.get(id) }));
  const fechas = await descuadresFechaR132(ini);
  const totTg = sum(tg), dif = R.money(totTg - totales.resultado);
  const txt = [
    "🧮 *CUADRE TELEGRAM vs APK*", `Ciclo desde ${ymdToDmy(ini)} hasta ${ymdToDmy(fin)}`, "",
    `📱 APK (disponible): *${lps(totales.resultado)}*`, `🤖 Telegram mismo período: *${lps(totTg)}*`,
    dif ? `⚠️ Diferencia: *${lps(dif)}*` : "✅ Cuadran exacto.", "",
    ...(soloTg.length ? [`*Solo en Telegram (${soloTg.length})* — la APK no los ve:`, ...soloTg.slice(0, 15).map((x) => lineaR132(x.m, x.y)), ""] : []),
    ...(soloApk.length ? [`*Solo en APK (${soloApk.length})*:`, ...soloApk.slice(0, 15).map((x) => lineaR132(x.m, x.y)), ""] : []),
    ...(distinto.length ? [`*Monto o tipo distinto (${distinto.length})*:`, ...distinto.slice(0, 15).map(({ a, t }) => `${lineaR132(a.m, a.y)} → TG ${lps(t.v)} / APK ${lps(a.v)}`), ""] : []),
    ...(fechas.length ? [`🗓 *${fechas.length} con fecha descuadrada* (la fecha escrita no es la misma que usa la APK). Toque 🔧 Reparar para dejarlos con la fecha escrita.`] : []),
    "", "Ojo: el disponible de la APK es del ciclo hasta HOY y ya resta planilla. Compare con Telegram usando las mismas fechas.",
  ].join("\n");
  const kb = [];
  if (fechas.length) kb.push([{ text: `🔧 Reparar ${fechas.length} fecha${fechas.length === 1 ? "" : "s"}`, callback_data: "fl:cuadre:fix" }]);
  kb.push([{ text: "🔄 Actualizar", callback_data: "fl:cuadre" }, { text: "⬅️ Ciclo", callback_data: "fl:menu" }]);
  return upsertPanel(chatId, txt.length > 3900 ? txt.slice(0, 3900) + "\n…" : txt, kb);
}

async function menuLibro(chatId) {
  const [{ libro, totales: t, saldos }, sinBanco, cart] = await Promise.all([estadoLibro(), movimientosSinBanco().catch(() => []), carteraResumen().catch(() => ({ clientes: 0, vendedores: 0 }))]);
  const bancos = saldos.bancos.filter((b) => b.activado);
  const txt = [
    "💼 *CICLO FINANCIERO*", `Desde ${ymdToDmy(libro.cicloInicio)}`, "",
    `💵 Ingresos: ${lps(t.ingresos)}`, `🧾 Egresos operativos: −${lps(t.egresosOperativos)}`, `= Disponible antes de planilla: *${lps(t.disponibleAntesPlanilla)}*`,
    `👥 Planilla / comisiones: −${lps(t.planilla)}`, `= Resultado: *${lps(t.resultado)}*`, "",
    `🧾 Ventas generadas: ${lps(t.ventasGeneradas || 0)}`, `📋 Pendiente clientes: ${lps(cart.clientes)} · vendedores: ${lps(cart.vendedores)} (no es efectivo)`, "",
    ...(sinBanco.length ? [`⚠️ *${sinBanco.length} movimiento${sinBanco.length === 1 ? "" : "s"} sin banco* desde el 01/10 → toque 🏷 para enlazarlos.`, ""] : []),
    `🏦 *Saldos reales* · ${lps(saldos.total)}`, ...(bancos.length ? bancos.map((b) => `• ${b.nombre}: ${lps(b.saldo)}`) : ["(Sin movimientos todavía)"]),
  ].join("\n");
  return upsertPanel(chatId, txt, [
    [{ text: "🏦 Saldos por banco", callback_data: "fl:bancos" }, { text: "📋 Pendientes de cobro", callback_data: "fl:cxc:menu" }],
    [{ text: "👥 Nuevo pago de planilla", callback_data: "fl:pl:new" }],
    [{ text: "🏷 Movimientos sin banco", callback_data: "fl:sb:list:0" }, { text: "🗓 Ajustar fecha de pago", callback_data: "fl:fd:list:0" }],
    [{ text: "🧮 Cuadre Telegram vs APK", callback_data: "fl:cuadre" }],
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
// ---------------------------------------------------------------- R106 · centro financiero en Telegram
// Compra/renovación con monto total + recibido ahora (pagado / parcial / pendiente), cartera por cobrar
// (cliente o vendedor) y abonos. Mismas colecciones y campos que /api/finanzas (registrar_operacion_pago,
// registrar_abono): la APK, la web, el bot y el Excel ven lo mismo.
const CXC = "cuentas_por_cobrar";
function auditarTg(tx, actor, ev) {
  tx.set(db.collection("auditoria_eventos").doc(), { actorUsuario: actor.usuario, rol: "telegram", origen: "tg", modulo: ev.modulo || "finanzas", accion: ev.accion, targetType: ev.targetType || "", targetId: ev.targetId || "", clienteId: ev.clienteId || "", compraId: ev.compraId || "", movimientoId: ev.movimientoId || "", cuentaId: ev.cuentaId || "", operationId: ev.operationId || "", before: ev.before ?? null, after: ev.after ?? null, motivo: "", detalle: ev.detalle || "", monto: ev.monto ?? null, bancos: ev.bancos || [], resultado: "ok", tipo: `finanzas_${ev.accion}`, createdAt: new Date().toISOString() });
}
// R107: preparar (fuera) → leer (al inicio de la transacción) → escribir (junto con la renovación).
async function prepararPagoTg({ tipoOrigen, total, recibido, bancoId, responsable, vendedorNombre, opId, actor, fechaPago = "" }) {
  const ep = R.estadoPago(total, recibido);
  if (!(ep.total > 0) || ep.recibido < 0 || ep.recibido > ep.total) throw Object.assign(new Error("Montos inválidos."), { userError: true });
  const methods = await loadMethods(); const banco = methods.find((m) => m.id === bancoId);
  if (ep.recibido > 0 && !banco) throw Object.assign(new Error("Elija el banco donde entró el dinero."), { userError: true });
  const hoyP = hoyYmd(); const fp = /^\d{4}-\d{2}-\d{2}$/.test(String(fechaPago)) && fechaPago <= hoyP && R.daysBetweenYmd(fechaPago, hoyP) <= 30 ? fechaPago : hoyP; // R110
  return { fechaPago: fp, ep, banco, tipoOrigen, deudorTipo: responsable === "vendedor" ? "vendedor" : "cliente", vendedorNombre: String(vendedorNombre || "").slice(0, 60), opId, id: opDocId("oper", actor.uid, opId), actor };
}
async function leerPagoTg(tx, prep) {
  const ventaRef = db.collection("finanzas_movimientos").doc(`${prep.id}_venta`);
  const [libroSnap, ventaSnap] = await Promise.all([tx.get(LIBRO()), tx.get(ventaRef)]);
  const libro = libroFrom(libroSnap.exists ? libroSnap.data() : {});
  return { yaExiste: ventaSnap.exists, cicloId: libro.cicloId };
}
function escribirPagoTg(tx, prep, lectura, cliente = {}) {
  const { ep, banco, tipoOrigen, deudorTipo, vendedorNombre, id, opId, actor } = prep;
  if (lectura.yaExiste) return { duplicado: true, ...ep };
  const ventaRef = db.collection("finanzas_movimientos").doc(`${id}_venta`), ingRef = db.collection("finanzas_movimientos").doc(`${id}_cobro`), cxcRef = db.collection(CXC).doc(id);
  const hoy = prep.fechaPago || hoyYmd(), now = new Date().toISOString(); // R110: día real del pago
  const base = { origen: "telegram", origenCanal: "tg", registradoPor: actor.usuario, registradoPorId: actor.uid, ...fechaCampos(hoy), createdAt: now, updatedAt: now };
  const clsTg = require("./lib_catalogo_categorias").clasificarServicio({ plataforma: cliente.plataforma || "", tipoVenta: cliente.tipoVenta, categoria: cliente.categoria }); // R118
  const rel = { categoria: clsTg.categoria, tipoVenta: clsTg.tipoVenta, categoriaLabel: require("./lib_catalogo_categorias").CATEGORIAS[clsTg.categoria]?.finanzas || "", clienteId: cliente.clienteId || "", clienteNombre: String(cliente.nombre || "").slice(0, 80), compraId: cliente.compraId || "", plataforma: String(cliente.plataforma || "").slice(0, 40), tipoOrigen, operacionId: id, cicloId: lectura.cicloId, operationId: opId, fechaNueva: cliente.fechaNueva || "", fechaAnterior: cliente.fechaAnterior || "", vendedor: vendedorNombre };
  tx.set(ventaRef, { ...base, movimientoId: ventaRef.id, tipo: "venta", subtipo: tipoOrigen === "compra" ? "compra_nueva" : "renovacion", monto: ep.total, montoRecibido: ep.recibido, saldoPendiente: ep.saldo, estadoPago: ep.estado, ...rel });
  if (ep.recibido > 0) tx.set(ingRef, { ...base, movimientoId: ingRef.id, tipo: "ingreso", subtipo: tipoOrigen === "compra" ? "cobro_compra" : "cobro_renovacion", monto: ep.recibido, bancoId: banco.id, banco: banco.nombre, metodoPago: banco.nombre, cobradoPor: actor.usuario, ...(ep.saldo > 0 ? { cuentaId: cxcRef.id } : {}), ...rel });
  if (ep.saldo > 0) tx.set(cxcRef, { cuentaId: cxcRef.id, deudorTipo, deudorId: deudorTipo === "cliente" ? rel.clienteId : vendedorNombre, deudorNombre: deudorTipo === "cliente" ? rel.clienteNombre : vendedorNombre, ...rel, montoTotalOperacion: ep.total, montoRecibidoInicial: ep.recibido, montoOriginalPendiente: ep.saldo, montoRecibidoPosterior: 0, saldoPendiente: ep.saldo, estado: ep.recibido > 0 ? "parcial" : "pendiente", cicloOrigen: lectura.cicloId, abonos: [], creadoPor: actor.usuario, createdAt: now, updatedAt: now });
  auditarTg(tx, actor, { modulo: tipoOrigen === "compra" ? "compras" : "renovaciones", accion: tipoOrigen === "compra" ? "compra_pago" : "renovacion_pago", targetType: "operacion", targetId: id, clienteId: rel.clienteId, compraId: rel.compraId, operationId: opId, monto: ep.total, after: { total: ep.total, recibido: ep.recibido, saldo: ep.saldo, estado: ep.estado, banco: banco?.nombre || "", responsable: ep.saldo > 0 ? deudorTipo : "" }, detalle: `${rel.clienteNombre} · ${rel.plataforma} · total ${ep.total} · recibido ${ep.recibido}${banco ? ` en ${banco.nombre}` : ""}${ep.saldo > 0 ? ` · pendiente ${ep.saldo} (${deudorTipo})` : ""}`, bancos: ep.recibido > 0 ? [{ bancoId: banco.id, monto: ep.recibido, direccion: "entrada" }] : [] });
  return { duplicado: false, ...ep, cuentaId: ep.saldo > 0 ? cxcRef.id : "" };
}
async function registrarOperacionPago(args) {
  const prep = await prepararPagoTg(args);
  return db.runTransaction(async (tx) => escribirPagoTg(tx, prep, await leerPagoTg(tx, prep), args.cliente || {}));
}
async function registrarAbonoTg({ cuentaId, monto, bancoId, opId, actor }) {
  const methods = await loadMethods(); const banco = methods.find((m) => m.id === bancoId);
  if (!banco || !(R.money(monto) > 0)) throw Object.assign(new Error("Abono inválido."), { userError: true });
  const ref = db.collection("finanzas_movimientos").doc(opDocId("abono", actor.uid, opId)), cxcRef = db.collection(CXC).doc(cuentaId);
  const hoy = hoyYmd(), now = new Date().toISOString(); monto = R.money(monto);
  return db.runTransaction(async (tx) => {
    const [ya, cs] = await Promise.all([tx.get(ref), tx.get(cxcRef)]);
    if (ya.exists) return { duplicado: true };
    if (!cs.exists) throw Object.assign(new Error("Esa cuenta por cobrar no existe."), { userError: true });
    const c = cs.data() || {};
    if (monto > R.money(c.saldoPendiente) + 0.001) throw Object.assign(new Error(`El abono es mayor que el saldo pendiente (${lps(c.saldoPendiente)}).`), { userError: true });
    const { libro } = await estadoLibro(tx);
    const saldo = R.money(c.saldoPendiente - monto);
    tx.set(ref, { origen: "telegram", origenCanal: "tg", registradoPor: actor.usuario, registradoPorId: actor.uid, movimientoId: ref.id, tipo: "ingreso", subtipo: c.deudorTipo === "vendedor" ? "cobro_pendiente_vendedor" : "cobro_pendiente_cliente", monto, bancoId: banco.id, banco: banco.nombre, metodoPago: banco.nombre, cobradoPor: actor.usuario, cuentaId, clienteId: c.clienteId || "", clienteNombre: c.clienteNombre || "", compraId: c.compraId || "", plataforma: c.plataforma || "", tipoOrigen: c.tipoOrigen || "", operacionId: c.operacionId || "", deudorTipo: c.deudorTipo, deudorNombre: c.deudorNombre || "", cicloId: libro.cicloId, cicloOrigen: c.cicloOrigen || "", deCicloAnterior: !!(c.cicloOrigen && c.cicloOrigen !== libro.cicloId), operationId: opId, ...fechaCampos(hoy), createdAt: now, updatedAt: now });
    tx.set(cxcRef, { saldoPendiente: saldo, montoRecibidoPosterior: R.money((c.montoRecibidoPosterior || 0) + monto), estado: saldo <= 0 ? "pagado" : "parcial", abonos: [...(c.abonos || []), { movimientoId: ref.id, monto, bancoId: banco.id, banco: banco.nombre, fecha: hoy, por: actor.usuario }], updatedAt: now }, { merge: true });
    auditarTg(tx, actor, { modulo: "cartera", accion: "abono", targetType: "cuenta_por_cobrar", targetId: cuentaId, cuentaId, movimientoId: ref.id, clienteId: c.clienteId, compraId: c.compraId, operationId: opId, monto, before: { saldo: R.money(c.saldoPendiente) }, after: { saldo, estado: saldo <= 0 ? "pagado" : "parcial" }, detalle: `${c.deudorNombre} (${c.deudorTipo}) abonó ${monto} en ${banco.nombre} · pendiente ${saldo}`, bancos: [{ bancoId: banco.id, monto, direccion: "entrada" }] });
    return { duplicado: false, saldoPendiente: saldo, banco: banco.nombre };
  });
}
async function carteraResumen() {
  const snap = await db.collection(CXC).where("estado", "in", ["pendiente", "parcial"]).get().catch(() => ({ docs: [] }));
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const sum = (t) => R.money(rows.filter((c) => (t === "vendedor" ? c.deudorTipo === "vendedor" : c.deudorTipo !== "vendedor")).reduce((a, c) => a + R.money(c.saldoPendiente), 0));
  return { rows, clientes: sum("cliente"), vendedores: sum("vendedor") };
}

// ===================== R122 · Anular movimiento desde Telegram =====================
// Mismo proceso que la APK/web (/api/finanzas · anular_movimiento): NO se borra nada. El original queda
// estadoFinanciero "anulado" y se crea su reversa `<id>_rev` con el monto en negativo (fecha de hoy). Si era un cobro
// de una cuenta por cobrar, ese dinero vuelve al pendiente. Motivo obligatorio, auditado, y la marca en
// finanzas_operaciones evita que un doble toque lo anule dos veces.
function motivoBloqueoAnular(m = {}) {
  if (m.estadoFinanciero) return `Ese movimiento ya está ${m.estadoFinanciero}.`;
  if (m.reversaDe) return "No se puede anular una reversa.";
  if (m.planillaPagoId) return "Es parte de un pago de planilla: anule el pago completo desde Planilla (APK o web).";
  if (!["ingreso", "egreso", "ajuste"].includes(R.movementKind(m))) return "Este tipo de movimiento (venta, transferencia o saldo inicial) no se anula aquí.";
  return "";
}
async function anularMovimientoTg({ movimientoId, motivo, opId, actor }) {
  const mot = String(motivo || "").trim().slice(0, 200);
  if (mot.length < 4) throw userErrR122("Escriba el motivo (obligatorio).");
  const id = String(movimientoId || "").trim();
  const ref = db.collection("finanzas_movimientos").doc(id || "x");
  const marcaRef = db.collection("finanzas_operaciones").doc(opDocId("corr", actor.uid, opId));
  return db.runTransaction(async (tx) => {
    if ((await tx.get(marcaRef)).exists) return { duplicado: true };
    const snap = await tx.get(ref);
    if (!snap.exists) throw userErrR122("Ese movimiento no existe.");
    const m = snap.data() || {};
    const bloqueo = motivoBloqueoAnular(m); if (bloqueo) throw userErrR122(bloqueo);
    const cxcRef = m.cuentaId ? db.collection(CXC).doc(m.cuentaId) : null;
    const cs = cxcRef ? await tx.get(cxcRef) : null;
    const now = new Date().toISOString();
    const rev = db.collection("finanzas_movimientos").doc(`${id}_rev`);
    const { createdAt, updatedAt, movimientoId: _mid, saldoAntes, saldoDespues, estadoFinanciero, reversaId, ...resto } = m;
    tx.set(rev, { ...resto, registradoPor: actor.usuario, registradoPorId: actor.uid, rol: "telegram", origenCanal: "tg", movimientoId: rev.id, monto: -R.money(m.monto), reversaDe: id, motivo: `Reversa: ${mot}`, ...fechaCampos(hoyYmd()), createdAt: now, updatedAt: now });
    tx.set(ref, { estadoFinanciero: "anulado", reversaId: rev.id, anuladoPor: actor.usuario, anuladoAt: now, motivoAnulacion: mot, updatedAt: now }, { merge: true });
    if (cs?.exists && R.movementKind(m) === "ingreso") { // anular un cobro devuelve ese dinero al pendiente
      const c = cs.data() || {}, delta = R.money(-R.money(m.monto));
      const saldo = R.money(Math.max(0, R.money(c.saldoPendiente) - delta));
      const deAbono = String(m.subtipo || "").startsWith("cobro_pendiente");
      const posterior = R.money((c.montoRecibidoPosterior || 0) + (deAbono ? delta : 0)), inicial = R.money((c.montoRecibidoInicial || 0) + (deAbono ? 0 : delta));
      tx.set(cxcRef, { saldoPendiente: saldo, montoRecibidoPosterior: posterior, montoRecibidoInicial: inicial, estado: saldo <= 0 ? "pagado" : (inicial + posterior > 0 ? "parcial" : "pendiente"), updatedAt: now }, { merge: true });
    }
    tx.set(marcaRef, { accion: "anular_movimiento", movimientoId: id, reversaId: rev.id, sustitutoId: "", por: actor.usuario, motivo: mot, origen: "tg", createdAt: now });
    tx.set(db.collection("auditoria_eventos").doc(), { actorUsuario: actor.usuario, rol: "telegram", origen: "tg", modulo: "finanzas", accion: "anular_movimiento", targetType: "movimiento", targetId: id, movimientoId: id, clienteId: m.clienteId || "", compraId: m.compraId || "", cuentaId: m.cuentaId || "", operationId: opId, motivo: mot, monto: R.money(m.monto), before: { monto: R.money(m.monto), banco: m.banco || "", bancoId: m.bancoId || "" }, after: { estado: "anulado" }, detalle: `Anulado L${R.money(m.monto)} ${m.banco || ""} · ${m.clienteNombre || m.detalle || m.motivo || ""}`.trim(), bancos: [{ bancoId: m.bancoId || "", monto: -R.money(m.monto) }], resultado: "ok", tipo: "finanzas_anular_movimiento", createdAt: now });
    return { duplicado: false, reversaId: rev.id, monto: R.money(m.monto), banco: m.banco || "", cliente: m.clienteNombre || m.detalle || "" };
  });
}
const userErrR122 = (msg) => Object.assign(new Error(msg), { userError: true });
// R128 · Corregir monto y/o BANCO desde Telegram (mismo proceso que la APK/web · corregir_movimiento): el original queda
// "corregido" con su reversa (fecha de hoy) y se crea el movimiento correcto con la fecha REAL del original.
// Si era un cobro de una cuenta por cobrar, se ajusta solo la diferencia. Motivo obligatorio y auditado.
async function corregirMovimientoTg({ movimientoId, monto, bancoId, motivo, opId, actor }) {
  const mot = String(motivo || "").trim().slice(0, 200);
  if (mot.length < 4) throw userErrR122("Escriba el motivo (obligatorio).");
  const methods = await loadMethods();
  const id = String(movimientoId || "").trim();
  const ref = db.collection("finanzas_movimientos").doc(id || "x");
  const marcaRef = db.collection("finanzas_operaciones").doc(opDocId("corr", actor.uid, opId));
  return db.runTransaction(async (tx) => {
    if ((await tx.get(marcaRef)).exists) return { duplicado: true };
    const snap = await tx.get(ref);
    if (!snap.exists) throw userErrR122("Ese movimiento no existe.");
    const m = snap.data() || {};
    const bloqueo = motivoBloqueoAnular(m); if (bloqueo) throw userErrR122(bloqueo.replace("anular", "corregir").replace("se anula", "se corrige"));
    const nuevoMonto = monto != null && monto !== "" ? R.money(monto) : R.money(m.monto);
    const b = methods.find((x) => x.id === String(bancoId || "").trim()) || methods.find((x) => x.id === (m.bancoId || R.resolveBankId(m.banco || m.metodoPago, methods)));
    if (!(nuevoMonto > 0) || !b) throw userErrR122("Corrección inválida: revise monto y banco.");
    if (nuevoMonto === R.money(m.monto) && b.id === m.bancoId) throw userErrR122("No cambió ni el monto ni el banco.");
    const cxcRef = m.cuentaId ? db.collection(CXC).doc(m.cuentaId) : null;
    const cs = cxcRef ? await tx.get(cxcRef) : null;
    if (cs?.exists && R.movementKind(m) === "ingreso" && nuevoMonto - R.money(m.monto) > R.money((cs.data() || {}).saldoPendiente) + 0.001) throw userErrR122("La corrección deja el cobro mayor que lo que se debía.");
    const now = new Date().toISOString();
    const { createdAt, updatedAt, movimientoId: _mid, saldoAntes, saldoDespues, estadoFinanciero, reversaId, ...resto } = m;
    const rev = db.collection("finanzas_movimientos").doc(`${id}_rev`);
    tx.set(rev, { ...resto, registradoPor: actor.usuario, registradoPorId: actor.uid, rol: "telegram", origenCanal: "tg", movimientoId: rev.id, monto: -R.money(m.monto), reversaDe: id, motivo: `Reversa: ${mot}`, ...fechaCampos(hoyYmd()), createdAt: now, updatedAt: now });
    tx.set(ref, { estadoFinanciero: "corregido", reversaId: rev.id, anuladoPor: actor.usuario, anuladoAt: now, motivoAnulacion: mot, updatedAt: now }, { merge: true });
    const sus = db.collection("finanzas_movimientos").doc(`${id}_c${Date.now().toString(36)}`);
    const fOrig = R.movementYmd(m) || hoyYmd(); // el corregido conserva la fecha REAL del pago
    tx.set(sus, { ...resto, monto: nuevoMonto, bancoId: b.id, banco: b.nombre, ...(m.metodoPago ? { metodoPago: b.nombre } : {}), registradoPor: actor.usuario, registradoPorId: actor.uid, rol: "telegram", origenCanal: "tg", movimientoId: sus.id, sustituyeA: id, motivoCorreccion: mot, ...fechaCampos(fOrig), createdAt: now, updatedAt: now });
    if (cs?.exists && R.movementKind(m) === "ingreso") {
      const c = cs.data() || {}, delta = R.money(nuevoMonto - R.money(m.monto));
      const saldo = R.money(Math.max(0, R.money(c.saldoPendiente) - delta)), deAbono = String(m.subtipo || "").startsWith("cobro_pendiente");
      const posterior = R.money((c.montoRecibidoPosterior || 0) + (deAbono ? delta : 0)), inicial = R.money((c.montoRecibidoInicial || 0) + (deAbono ? 0 : delta));
      tx.set(cxcRef, { saldoPendiente: saldo, montoRecibidoPosterior: posterior, montoRecibidoInicial: inicial, estado: saldo <= 0 ? "pagado" : (inicial + posterior > 0 ? "parcial" : "pendiente"), updatedAt: now }, { merge: true });
    }
    tx.set(marcaRef, { accion: "corregir_movimiento", movimientoId: id, reversaId: rev.id, sustitutoId: sus.id, por: actor.usuario, motivo: mot, origen: "tg", createdAt: now });
    tx.set(db.collection("auditoria_eventos").doc(), { actorUsuario: actor.usuario, rol: "telegram", origen: "tg", modulo: "finanzas", accion: "corregir_movimiento", targetType: "movimiento", targetId: id, movimientoId: id, clienteId: m.clienteId || "", compraId: m.compraId || "", cuentaId: m.cuentaId || "", operationId: opId, motivo: mot, monto: R.money(m.monto), before: { monto: R.money(m.monto), banco: m.banco || "", bancoId: m.bancoId || "" }, after: { monto: nuevoMonto, banco: b.nombre, bancoId: b.id }, detalle: `${m.banco || "—"} L${R.money(m.monto)} → ${b.nombre} L${nuevoMonto}`, bancos: [{ bancoId: m.bancoId || "", monto: -R.money(m.monto) }, { bancoId: b.id, monto: nuevoMonto }], resultado: "ok", tipo: "finanzas_corregir_movimiento", createdAt: now });
    return { duplicado: false, antes: { monto: R.money(m.monto), banco: m.banco || "" }, despues: { monto: nuevoMonto, banco: b.nombre }, cliente: m.clienteNombre || m.detalle || "" };
  });
}

// ===================== R121 · "Ya pagó por Socios" =====================
// La compra de un socio YA dejó su venta + ingreso en el libro (server_api.js · compra_socio). Al armar la ficha de esa
// cuenta NO se registra otro ingreso: se amarra a ese pago. Mismas reglas y campos que la web y la APK
// (api/_finanzas-operacion.js): fichasVinculadas[] + fichaPendiente en el movimiento del socio.
const userErr = (msg) => Object.assign(new Error(msg), { userError: true });
function unidadesSocio(mov = {}) {
  const vinc = Array.isArray(mov.fichasVinculadas) ? mov.fichasVinculadas : [];
  const prods = Array.isArray(mov.productosSocio) && mov.productosSocio.length ? mov.productosSocio : [{ servicio: mov.plataforma || "Servicio", cantidad: 1 }];
  return prods.map((x, idx) => {
    const cantidad = Math.max(1, Math.min(50, Math.round(Number(x?.cantidad) || 1)));
    const vinculadas = vinc.filter((v) => Number(v?.productoIdx) === idx).length;
    return { idx, servicio: String(x?.servicio || mov.plataforma || "Servicio").slice(0, 140), perfil: String(x?.perfil || (prods.length === 1 ? mov.clienteNombre : "") || "").slice(0, 80), cantidad, vinculadas, restantes: Math.max(0, cantidad - vinculadas) };
  });
}
function pagoSocioDisponible(mov = {}) { return mov.subtipo === "compra_socio" && mov.tipo === "ingreso" && !mov.estadoFinanciero && !mov.reversaDe && mov.fichaPendiente !== false; }
async function pagosSociosSinFicha() {
  const snap = await db.collection("finanzas_movimientos").where("fichaPendiente", "==", true).get();
  const filas = [];
  for (const d of snap.docs) {
    const m = d.data() || {}; if (!pagoSocioDisponible(m)) continue;
    for (const u of unidadesSocio(m)) if (u.restantes > 0) filas.push({ movimientoId: d.id, productoIdx: u.idx, fecha: String(m.fechaPago || ""), texto: [m.socioNombre || "Socio", u.servicio, u.perfil || m.clienteNombre, `L${R.fmt(m.monto)}`, m.banco].filter(Boolean).join(" · ") });
  }
  return filas.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.movimientoId.localeCompare(a.movimientoId)).slice(0, 12);
}
async function vincularFichaSocio({ movimientoId, productoIdx, cliente = {}, opId, actor }) {
  const ref = db.collection("finanzas_movimientos").doc(String(movimientoId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const m = snap.exists ? (snap.data() || {}) : null;
    if (!m || m.subtipo !== "compra_socio" || m.tipo !== "ingreso") throw userErr("Esa compra de socio ya no existe en Finanzas.");
    if (m.estadoFinanciero || m.reversaDe) throw userErr("Ese pago de socio está anulado o corregido: registre el pago normal.");
    const previas = Array.isArray(m.fichasVinculadas) ? m.fichasVinculadas : [];
    const resumen = { pagoSocio: true, socio: m.socioNombre || "Socio", banco: m.banco || "", total: R.money(m.monto) };
    if (previas.some((v) => v?.operationId === opId)) return { duplicado: true, ...resumen };
    const u = unidadesSocio(m)[Number(productoIdx)];
    if (!u || u.restantes <= 0 || m.fichaPendiente === false) throw userErr("Esa compra de socio ya tiene su ficha armada. Si es otra venta, registre el pago normal.");
    const ahora = new Date().toISOString();
    const vinc = [...previas, { productoIdx: Number(productoIdx), clienteId: String(cliente.clienteId || ""), clienteNombre: String(cliente.nombre || "").slice(0, 80), compraId: String(cliente.compraId || ""), plataforma: String(cliente.plataforma || "").slice(0, 40), operationId: opId, por: actor.usuario, origen: "tg", at: ahora }];
    const quedan = unidadesSocio({ ...m, fichasVinculadas: vinc }).reduce((a, x) => a + x.restantes, 0);
    tx.update(ref, { fichasVinculadas: vinc, fichaPendiente: quedan > 0, updatedAt: ahora });
    auditarTg(tx, actor, { modulo: "compras", accion: "ficha_pago_socio", targetType: "movimiento", targetId: ref.id, movimientoId: ref.id, clienteId: String(cliente.clienteId || ""), compraId: String(cliente.compraId || ""), operationId: opId, monto: R.money(m.monto), after: { socio: resumen.socio, banco: resumen.banco, fichasPendientes: quedan }, detalle: `${cliente.nombre || ""} · ${cliente.plataforma || ""} · ya pagado por el socio ${resumen.socio} (${R.money(m.monto)} en ${resumen.banco}) · sin ingreso nuevo` });
    return { duplicado: false, ...resumen, fichasPendientes: quedan };
  });
}
async function panelPagosSocios(chatId, p) {
  const filas = await pagosSociosSinFicha();
  p.mode = "flPgSocio"; p.socios = filas; pending.set(String(chatId), p);
  const volver = [{ text: "⬅️ Volver: registrar pago normal", callback_data: "fl:pg:sback" }];
  if (!filas.length) return upsertPanel(chatId, `🤝 *Ya pagó por Socios · ${p.etiqueta || ""}*

No hay compras de socios pendientes de ficha.
Si el cliente pagó aparte, registre el pago normal.`, [volver]);
  return upsertPanel(chatId, `🤝 *Ya pagó por Socios · ${p.etiqueta || ""}*

¿Cuál compra de socio es?
La ficha queda amarrada a ese pago y *no se registra otro ingreso*.`, [...filas.map((f, i) => [{ text: f.texto.slice(0, 60), callback_data: `fl:pg:sp:${i}` }]), volver]);
}

// -- hoja de pago (compra y renovación): total → recibido → banco → responsable → confirmar
async function iniciarPago(chatId, userId, datos) {
  pending.set(String(chatId), { mode: "flPgTotal", ...datos, opId: newOpId(), userId: String(userId) });
  const compra = datos.tipoOrigen === "compra";
  const kb = compra ? [[{ text: "🤝 Ya pagó por Socios", callback_data: "fl:pg:socio" }]] : [[{ text: "🛠 Ajuste sin pago (garantía/cortesía)", callback_data: "fl:ren:ajuste" }], [{ text: "❌ Cancelar", callback_data: "fl:ren:cancel" }]];
  return upsertPanel(chatId, `💵 *${compra ? "COMPRA NUEVA" : "RENOVAR"} · ${datos.etiqueta || "servicio"}*\n\n1) Escriba el *monto total* acordado (ej. 220).\nNo hay monto predeterminado.`, kb);
}
async function iniciarPagoRenovacion(chatId, userId, accion) { return iniciarPago(chatId, userId, { tipoOrigen: "renovacion", accion, etiqueta: accion.etiqueta }); }
async function iniciarPagoCompra(chatId, userId, compra) { return iniciarPago(chatId, userId, { tipoOrigen: "compra", compra, etiqueta: `${compra.cliente || "Cliente"} · ${compra.plataforma || "servicio"}` }); }
async function siguientePaso(chatId, p) {
  const ep = R.estadoPago(p.total, p.recibido);
  if (ep.recibido > 0 && !p.bancoId) {
    p.mode = "flPgBanco"; pending.set(String(chatId), p);
    const methods = await loadMethods(); const kb = [];
    for (let i = 0; i < methods.length; i += 2) kb.push(methods.slice(i, i + 2).map((m) => ({ text: m.nombre, callback_data: `fl:pg:bank:${m.id}` })));
    return upsertPanel(chatId, `Recibido ahora: *${lps(ep.recibido)}*\n3) ¿Dónde entró el dinero?`, kb);
  }
  if (ep.saldo > 0 && !p.responsable) {
    p.mode = "flPgResp"; pending.set(String(chatId), p);
    return upsertPanel(chatId, `Queda pendiente: *${lps(ep.saldo)}*\n4) ¿Quién debe el pendiente?\n(No suma a bancos hasta que se cobre)`, [[{ text: "👤 El cliente", callback_data: "fl:pg:resp:cliente" }, { text: "🧑‍💼 Un vendedor", callback_data: "fl:pg:resp:vendedor" }]]);
  }
  p.mode = "flPgConfirm"; pending.set(String(chatId), p);
  const banco = p.bancoId ? (await loadMethods()).find((m) => m.id === p.bancoId) : null;
  let txt = [`💵 *Revisar ${p.tipoOrigen === "compra" ? "compra" : "renovación"}* · ${p.etiqueta || ""}`, "", `Monto total: *${lps(ep.total)}*`, `Recibido ahora: *${lps(ep.recibido)}*${banco ? ` en ${banco.nombre}` : ""}`, `Saldo pendiente: *${lps(ep.saldo)}*${ep.saldo > 0 ? ` (${p.responsable === "vendedor" ? `vendedor ${p.vendedorNombre}` : "cliente"})` : ""}`, `Estado: *${ep.estado.toUpperCase()}*`].join("\n");
  const hoyF = hoyYmd(), fSel = p.fechaPago || hoyF;
  txt += `\n📅 Día que entró el dinero: *${ymdToDmy(fSel)}*${fSel === hoyF ? " (hoy)" : ""}`; // R110
  const kb = [[0, "Hoy"], [-1, "Ayer"], [-2, "Antier"]].map(([n, t]) => { const f = R.addDaysYmd(hoyF, n); return { text: `${f === fSel ? "✅ " : ""}${t} ${ymdToDmy(f).slice(0, 5)}`, callback_data: `fl:pg:fecha:${f}` }; });
  kb.splice(0, 3, kb.slice(0, 3)); kb.push([{ text: "✍️ Otra fecha", callback_data: "fl:pg:fecha:otra" }]);
  kb.push([{ text: p.tipoOrigen === "compra" ? "✅ Confirmar operación" : "✅ Confirmar y renovar", callback_data: "fl:pg:ok" }]);
  if (p.tipoOrigen !== "compra") kb.push([{ text: "❌ Cancelar", callback_data: "fl:ren:cancel" }]);
  return upsertPanel(chatId, txt, kb);
}
async function confirmarPago(chatId, userId, p) {
  const actor = await actorDe(userId);
  pending.delete(String(chatId));
  let cliente = {};
  if (p.tipoOrigen === "compra") cliente = { clienteId: p.compra.clientId, nombre: p.compra.cliente, compraId: p.compra.compraId, plataforma: p.compra.plataforma };
  let r = null;
  if (p.tipoOrigen !== "compra") {
    if (typeof cfg.ejecutarRenovacion !== "function") throw new Error("Renovación no configurada.");
    // R107: la renovación y su pago se guardan en UNA sola transacción (o se guarda todo, o nada).
    const prep = await prepararPagoTg({ tipoOrigen: "renovacion", total: p.total, recibido: p.recibido, bancoId: p.bancoId, responsable: p.responsable, vendedorNombre: p.vendedorNombre, opId: p.opId, actor, fechaPago: p.fechaPago || "" });
    const pagoExtra = { leer: (tx) => leerPagoTg(tx, prep), escribir: (tx, res, cl, lectura) => escribirPagoTg(tx, prep, lectura, { clienteId: p.accion.clientId, nombre: cl?.nombrePerfil || cl?.nombre || "", compraId: res?.siguiente?.compraId || p.accion.compraId || "", plataforma: res?.siguiente?.plataforma || (Array.isArray(res?.servicios) ? res.servicios.map((x) => x?.plataforma).filter(Boolean).join(", ") : ""), fechaAnterior: res?.fechaAnterior || "", fechaNueva: res?.fechaNueva || "" }) };
    const info = await cfg.ejecutarRenovacion(chatId, userId, p.accion, { ajuste: false, pagoExtra });
    cliente = { ...(info || {}), clienteId: p.accion.clientId, compraId: p.accion.compraId || "" };
    r = info?.pagoOperacion || null;
  }
  if (!r) r = await registrarOperacionPago({ tipoOrigen: p.tipoOrigen, total: p.total, recibido: p.recibido, bancoId: p.bancoId, responsable: p.responsable, vendedorNombre: p.vendedorNombre, cliente, opId: p.opId, actor, fechaPago: p.fechaPago || "" });
  return bot.sendMessage(chatId, `✅ ${p.tipoOrigen === "compra" ? "Compra" : "Renovación"} registrada · *${r.estado.toUpperCase()}*${r.duplicado ? " (ya estaba registrada)" : ""}\nTotal ${lps(r.total)} · Recibido ${lps(r.recibido)} · Pendiente ${lps(r.saldo)}${cliente.fechaNueva ? `\nNueva fecha: ${cliente.fechaNueva}` : ""}`, { parse_mode: "Markdown" });
}

// -- pendientes de cobro
async function panelPendientes(chatId, tipo = "", page = 0) {
  const { rows, clientes, vendedores } = await carteraResumen();
  if (!tipo) return upsertPanel(chatId, `📋 *PENDIENTES DE COBRO*\n\n👤 Clientes: *${lps(clientes)}*\n🧑‍💼 Vendedores: *${lps(vendedores)}*\nTotal: *${lps(clientes + vendedores)}*\n\n(No suman a bancos ni al disponible hasta que se cobren)`, [[{ text: "👤 Clientes", callback_data: "fl:cxc:list:cliente:0" }, { text: "🧑‍💼 Vendedores", callback_data: "fl:cxc:list:vendedor:0" }], [{ text: "⬅️ Ciclo", callback_data: "fl:menu" }]]);
  const list = rows.filter((c) => (tipo === "vendedor" ? c.deudorTipo === "vendedor" : c.deudorTipo !== "vendedor")).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const per = 8, pages = Math.max(1, Math.ceil(list.length / per)); page = Math.min(Math.max(0, page), pages - 1);
  const slice = list.slice(page * per, page * per + per);
  pending.set(String(chatId), { mode: "flCxcList", ids: slice.map((c) => c.id), tipo, page });
  const txt = [`📋 *Pendientes · ${tipo === "vendedor" ? "Vendedores" : "Clientes"}* (${list.length})`, "", ...(slice.length ? slice.map((c, i) => `${i + 1}) ${c.deudorNombre || "—"} · ${lps(c.saldoPendiente)} · ${c.tipoOrigen === "compra" ? "Compra" : "Renovación"}${c.plataforma ? ` ${c.plataforma}` : ""}${c.deudorTipo === "vendedor" && c.clienteNombre ? ` (cliente ${c.clienteNombre})` : ""}`) : ["✅ Nada pendiente."])].join("\n");
  const nums = slice.map((_, i) => ({ text: `💵 ${i + 1}`, callback_data: `fl:cxc:pick:${i}` })); const kb = [];
  for (let i = 0; i < nums.length; i += 4) kb.push(nums.slice(i, i + 4));
  const nav = []; if (page > 0) nav.push({ text: "⬅️", callback_data: `fl:cxc:list:${tipo}:${page - 1}` }); if (page < pages - 1) nav.push({ text: "➡️", callback_data: `fl:cxc:list:${tipo}:${page + 1}` }); if (nav.length) kb.push(nav);
  kb.push([{ text: "⬅️ Pendientes", callback_data: "fl:cxc:menu" }]);
  return upsertPanel(chatId, txt, kb);
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
    if (data === "fl:cuadre") return cuadreTgApkR132(chatId);
    if (data === "fl:cuadre:fix") { const n = await repararFechasR132((await estadoLibro()).libro.cicloInicio, String(userId)); await bot.sendMessage(chatId, `✅ ${n} movimiento${n === 1 ? "" : "s"} con la fecha reparada.`); return cuadreTgApkR132(chatId); }
    if (data === "fl:bancos") return panelBancos(chatId);
    if (data === "fl:rf:ver") return panelAjustarFechas(chatId, 0); // compatibilidad con botones antiguos
    if (data === "fl:rf:ok") return bot.sendMessage(chatId, "ℹ️ Ahora las fechas se corrigen una por una. Toque 🗓 Ajustar fecha de pago.");
    if (data.startsWith("fl:fd:list:")) return panelAjustarFechas(chatId, Number(data.split(":")[3] || 0));
    if (data.startsWith("fl:fd:pick:") && p.mode === "flFechaList") {
      const id = (p.ids || [])[Number(data.split(":")[3])];
      return id ? panelFechaDetalle(chatId, id, p.page || 0) : panelAjustarFechas(chatId, p.page || 0);
    }
    if (data === "fl:fd:manual" && p.mode === "flFechaDetalle") {
      p.mode = "flFechaManual"; pending.set(String(chatId), p);
      return bot.sendMessage(chatId, "✍️ Escriba la fecha REAL del pago como dd/mm/yyyy. Ejemplo: 03/10/2026");
    }
    if (data.startsWith("fl:fd:set:") && p.mode === "flFechaDetalle") {
      const fecha = data.slice("fl:fd:set:".length); const actor = await actorDe(userId);
      try { const r = await ajustarFechaMovimiento({ movimientoId: p.movimientoId, nuevaFecha: fecha, actor }); pending.delete(String(chatId)); await bot.sendMessage(chatId, r.sinCambios ? "✅ Esa fecha ya estaba correcta." : `✅ Fecha financiera ajustada: ${r.antes ? ymdToDmy(r.antes) : "Sin fecha"} → ${ymdToDmy(r.despues)}.\nQuedó registrado en Auditoría.`); return panelAjustarFechas(chatId, p.page || 0); }
      catch (e) { return bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 200)}`); }
    }
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
    // R121 · compra de socio ya pagada: la ficha se amarra a ese pago, sin ingreso nuevo
    if (data === "fl:pg:socio" && p.tipoOrigen === "compra" && ["flPgTotal", "flPgRecibido", "flPgSocio"].includes(p.mode)) return panelPagosSocios(chatId, p);
    if (data === "fl:pg:sback" && p.mode === "flPgSocio") { const { socios, total, recibido, mode, ...resto } = p; return iniciarPago(chatId, userId, resto); }
    if (data.startsWith("fl:pg:sp:") && p.mode === "flPgSocio") {
      const f = (p.socios || [])[Number(data.split(":")[3])]; if (!f) return panelPagosSocios(chatId, p);
      try {
        const r = await vincularFichaSocio({ movimientoId: f.movimientoId, productoIdx: f.productoIdx, cliente: { clienteId: p.compra?.clientId, nombre: p.compra?.cliente, compraId: p.compra?.compraId, plataforma: p.compra?.plataforma }, opId: p.opId, actor: await actorDe(userId) });
        pending.delete(String(chatId));
        return bot.sendMessage(chatId, `✅ Compra registrada · *YA PAGADA POR SOCIOS*${r.duplicado ? " (ya estaba amarrada)" : ""}
${r.socio} · ${lps(r.total)}${r.banco ? ` en ${r.banco}` : ""}
No se registró otro ingreso.`, { parse_mode: "Markdown" });
      } catch (e) { if (e.userError) { await bot.sendMessage(chatId, `⚠️ ${e.message}`); return panelPagosSocios(chatId, p); } throw e; }
    }
    // R106 · hoja de pago (compra / renovación)
    if (data.startsWith("fl:pg:bank:") && p.mode === "flPgBanco") { p.bancoId = data.slice("fl:pg:bank:".length); return siguientePaso(chatId, p); }
    if (data.startsWith("fl:pg:resp:") && p.mode === "flPgResp") {
      p.responsable = data.endsWith("vendedor") ? "vendedor" : "cliente";
      if (p.responsable === "vendedor") { p.mode = "flPgVendedor"; pending.set(String(chatId), p); return bot.sendMessage(chatId, "🧑‍💼 Escriba el nombre del vendedor que tiene el dinero:"); }
      return siguientePaso(chatId, p);
    }
    if (data.startsWith("fl:pg:fecha:") && p.mode === "flPgConfirm") { // R110: día real del pago
      const v = data.slice("fl:pg:fecha:".length);
      if (v === "otra") { p.mode = "flPgFecha"; pending.set(String(chatId), p); return bot.sendMessage(chatId, "✍️ Escriba el día que entró el dinero (dd/mm/yyyy), máximo 30 días atrás:"); }
      p.fechaPago = v; return siguientePaso(chatId, p);
    }
    if (data === "fl:pg:ok" && p.mode === "flPgConfirm") {
      try { return await confirmarPago(chatId, userId, p); } catch (e) { if (e.userError) return bot.sendMessage(chatId, `⚠️ ${e.message}`); throw e; }
    }
    // R106 · pendientes de cobro y abonos
    if (data === "fl:cxc:menu") return panelPendientes(chatId);
    if (data.startsWith("fl:cxc:list:")) { const [, , , tipo, pg] = data.split(":"); return panelPendientes(chatId, tipo, Number(pg || 0)); }
    if (data.startsWith("fl:cxc:pick:") && p.mode === "flCxcList") {
      const id = (p.ids || [])[Number(data.split(":")[3])]; if (!id) return panelPendientes(chatId, p.tipo || "");
      const c = (await db.collection(CXC).doc(id).get()).data() || {};
      pending.set(String(chatId), { mode: "flAbMonto", cuentaId: id, tipo: p.tipo, opId: newOpId() });
      return bot.sendMessage(chatId, `💵 *Abono · ${c.deudorNombre || "—"}* (${c.deudorTipo})
${c.tipoOrigen === "compra" ? "Compra" : "Renovación"} ${c.plataforma || ""} · total ${lps(c.montoTotalOperacion)}
Pendiente: *${lps(c.saldoPendiente)}*

Escriba cuánto pagó ahora:`, { parse_mode: "Markdown" });
    }
    if (data.startsWith("fl:ab:bank:") && p.mode === "flAbBanco") {
      try {
        const r = await registrarAbonoTg({ cuentaId: p.cuentaId, monto: p.monto, bancoId: data.slice("fl:ab:bank:".length), opId: p.opId, actor: await actorDe(userId) });
        pending.delete(String(chatId));
        await bot.sendMessage(chatId, r.duplicado ? "Ese abono ya estaba registrado." : `✅ Abono de ${lps(p.monto)} en ${r.banco}. Pendiente: ${lps(r.saldoPendiente)}${r.saldoPendiente <= 0 ? " · PAGADO" : ""}.`);
      } catch (e) { pending.delete(String(chatId)); await bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 200)}`); }
      return panelPendientes(chatId, p.tipo || "");
    }
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
    if (p.mode === "flFechaManual") {
      const ymd = dmyAYmd(t);
      if (!ymd) return bot.sendMessage(chatId, "Escriba la fecha como dd/mm/yyyy. Ejemplo: 03/10/2026");
      try { const r = await ajustarFechaMovimiento({ movimientoId: p.movimientoId, nuevaFecha: ymd, actor: await actorDe(userId) }); pending.delete(String(chatId)); await bot.sendMessage(chatId, r.sinCambios ? "✅ Esa fecha ya estaba correcta." : `✅ Fecha financiera ajustada: ${r.antes ? ymdToDmy(r.antes) : "Sin fecha"} → ${ymdToDmy(r.despues)}.\nQuedó registrado en Auditoría.`); return panelAjustarFechas(chatId, p.page || 0); }
      catch (e) { return bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 200)}`); }
    }
    if (p.mode === "flPgFecha") {
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); const f = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
      const hoyF = hoyYmd();
      if (!f || f > hoyF || R.daysBetweenYmd(f, hoyF) > 30) return bot.sendMessage(chatId, "Fecha inválida: dd/mm/yyyy, no futura y máximo 30 días atrás.");
      p.fechaPago = f; p.mode = "flPgConfirm"; return siguientePaso(chatId, p);
    }
    if (String(p.mode).startsWith("flCc")) return textoCuentaCompleta(chatId, userId, t, p); // R118
    if (p.mode === "flPgTotal") {
      if (!(num > 0)) return bot.sendMessage(chatId, "Escriba el monto total acordado (mayor que 0), ej. 220.");
      p.total = R.money(num); p.mode = "flPgRecibido"; pending.set(String(chatId), p);
      return bot.sendMessage(chatId, `Total: ${lps(p.total)}\n2) ¿Cuánto recibió *ahora*? (escriba 0 si no pagó nada)`, { parse_mode: "Markdown" });
    }
    if (p.mode === "flPgRecibido") {
      if (!(num >= 0) || t === "") return bot.sendMessage(chatId, "Escriba lo recibido ahora (0 o más).");
      if (num > p.total) return bot.sendMessage(chatId, `No puede ser mayor que el total (${lps(p.total)}).`);
      p.recibido = R.money(num); return siguientePaso(chatId, p);
    }
    if (p.mode === "flPgVendedor") {
      if (t.length < 2) return bot.sendMessage(chatId, "Escriba el nombre del vendedor.");
      p.vendedorNombre = t.slice(0, 60); return siguientePaso(chatId, p);
    }
    if (p.mode === "flAbMonto") {
      if (!(num > 0)) return bot.sendMessage(chatId, "Escriba el monto del abono (mayor que 0).");
      p.monto = R.money(num); p.mode = "flAbBanco"; pending.set(String(chatId), p);
      const methods = await loadMethods(); const kb = [];
      for (let i = 0; i < methods.length; i += 2) kb.push(methods.slice(i, i + 2).map((m) => ({ text: m.nombre, callback_data: `fl:ab:bank:${m.id}` })));
      return upsertPanel(chatId, `Abono: *${lps(p.monto)}*\n¿Dónde entró el dinero?`, kb);
    }
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

module.exports = { cuadreTgApkR132, repararFechasR132, descuadresFechaR132, corregirMovimientoTg, motivoBloqueoAnular, anularMovimientoTg, newOpId, actorDe, unidadesSocio, pagoSocioDisponible, pagosSociosSinFicha, vincularFichaSocio, iniciarCuentaCompleta, iniciarPagoCompra, registrarOperacionPago, registrarAbonoTg, carteraResumen, registrarSaldoInicial, registrarAjuste, bancoDesdeBoton, movimientosSinBanco, configurar, esLibroUser, iniciarPagoRenovacion, handleCallback, handleText, menuLibro, estadoLibro, loadMethods, registrarCobroRenovacion, confirmarPagoPlanilla, usuarioCanonico, usuarioLabel, ajustarFechaMovimiento };
