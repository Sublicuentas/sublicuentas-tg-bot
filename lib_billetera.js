"use strict";
/* =====================================================================================================
   R205 · Billetera Subli (Fase 3) — saldos y recargas con verificación administrativa.
   Decisiones: billetera para TODOS los socios; DOS saldos separados por negocio (Sublicuentas y Relojes);
   el saldo promocional (Gift Card) es aparte y nunca se suma como efectivo.
   · Libro de movimientos: billetera_movimientos (solo se agregan registros; un reverso es otro registro).
     Campos: socio_norm, negocio, subcuenta (real | promocional | reserva), tipo, monto (>0), signo (+1/−1),
     ref, estado (acreditado | anulado), por, createdAt. El saldo SIEMPRE se calcula desde aquí (servidor).
   · Recargas: billetera_recargas. El comprobante NO acredita nada: queda «pendiente» hasta que administración
     confirma el dinero real. Aprobar = UNA sola acreditación (id fijo recarga_<id> creado dentro de una
     transacción); doble clic o reintento no duplican. Rechazar deja el saldo igual y guarda el motivo.
   · Antifraude básico: misma referencia bancaria o misma imagen (huella SHA-256) que otra recarga no rechazada,
     o que un pedido ya registrado → se bloquea. Monto entre L10 y L50,000. Un requestId = una solicitud.
   · Recargar NO es una venta: se registra como fondos recibidos de un socio (Finanzas lo concilia en Fase 6).
   ===================================================================================================== */
const crypto = require("crypto");
const COL_MOV = "billetera_movimientos";
const COL_REC = "billetera_recargas";
const NEGOCIOS = Object.freeze({ sublicuentas: "Sublicuentas", relojes: "Relojes" });
const BANCOS = Object.freeze(["BAC Honduras", "Banco Atlántida", "Ficohsa", "Banpaís", "Banco de Occidente", "Davivienda", "Banrural", "Tigo Money", "Otro"]);
const MONTO_MIN = 10, MONTO_MAX = 50000;
const norm = (v) => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").slice(0, 80);
const limpiar = (v, n = 160) => String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, n);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ms = (v) => (!v ? 0 : typeof v === "number" ? v : v instanceof Date ? v.getTime() : typeof v.toMillis === "function" ? v.toMillis() : v._seconds || v.seconds ? Number(v._seconds || v.seconds) * 1000 : Date.parse(v) || 0);
const negocioDe = (v) => { const k = norm(v).replace(/[^a-z]/g, ""); return NEGOCIOS[k] ? k : ""; };
const refNorm = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);

/** Saldos por negocio desde el libro. real/promocional/reservado/disponible (disponible = real − reservado). */
function saldosDe(movs = []) {
  const out = {};
  for (const k of Object.keys(NEGOCIOS)) out[k] = { negocio: k, nombre: NEGOCIOS[k], real: 0, promocional: 0, reservado: 0, disponible: 0 };
  for (const m of movs) {
    if (m.estado === "anulado") continue;
    const k = NEGOCIOS[m.negocio] ? m.negocio : "sublicuentas";
    const v = (Number(m.monto) || 0) * (Number(m.signo) || 1);
    if (m.subcuenta === "promocional") out[k].promocional += v;
    else if (m.subcuenta === "reserva") out[k].reservado += v;
    else out[k].real += v;
  }
  for (const s of Object.values(out)) { s.real = r2(s.real); s.promocional = r2(s.promocional); s.reservado = r2(s.reservado); s.disponible = r2(s.real - s.reservado); }
  return out;
}
function movPublico(m) {
  return { id: m.id, fecha: new Date(ms(m.createdAt) || Date.now()).toISOString(), negocio: m.negocio, subcuenta: m.subcuenta, tipo: m.tipo, monto: r2(m.monto), signo: Number(m.signo) || 1, ref: m.ref ? String(m.ref).slice(-6).toUpperCase() : "", detalle: m.detalle || "", estado: m.estado || "acreditado" };
}
function recargaPublica(r) {
  return { id: r.id, ref: String(r.id || "").slice(-6).toUpperCase(), fecha: new Date(ms(r.createdAt) || Date.now()).toISOString(), negocio: r.negocio, negocioNombre: NEGOCIOS[r.negocio] || r.negocio, monto: r2(r.monto), banco: r.banco || "", referencia: r.referencia || "", estado: r.estado, motivo: r.motivo || "", montoAcreditado: r.montoAcreditado != null ? r2(r.montoAcreditado) : null, revisadoAt: r.revisadoAt ? new Date(ms(r.revisadoAt)).toISOString() : "" };
}

async function vistaSocio(db, socioNorm) {
  const sn = norm(socioNorm);
  const [mSnap, rSnap] = await Promise.all([db.collection(COL_MOV).where("socio_norm", "==", sn).get(), db.collection(COL_REC).where("socio_norm", "==", sn).get()]);
  const movs = mSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const saldo = saldosDe(movs);
  // Saldo posterior en cada movimiento (por negocio y subcuenta), del más viejo al más nuevo.
  const acum = {}; const conSaldo = movs.filter((m) => m.estado !== "anulado").sort((a, b) => ms(a.createdAt) - ms(b.createdAt)).map((m) => { const k = `${m.negocio}|${m.subcuenta}`; acum[k] = r2((acum[k] || 0) + (Number(m.monto) || 0) * (Number(m.signo) || 1)); return { ...movPublico(m), saldoPosterior: acum[k] }; });
  const recargas = rSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 40).map(recargaPublica);
  return { ok: true, saldos: saldo, movimientos: conSaldo.reverse().slice(0, 60), recargas, pendientes: recargas.filter((r) => r.estado === "pendiente").length, bancos: BANCOS, negocios: NEGOCIOS, limites: { min: MONTO_MIN, max: MONTO_MAX } };
}

/** El socio pide una recarga. Nada se acredita aquí. */
async function solicitarRecarga(db, { socio, socioNorm, negocio, monto, banco, referencia, requestId, imagenHash = "", imagenUrl = "" }) {
  const sn = norm(socioNorm || socio); if (!sn) return { status: 400, error: "sin_socio" };
  const neg = negocioDe(negocio); if (!neg) return { status: 400, error: "negocio_requerido", detail: "Elija si la recarga es para Sublicuentas o para Relojes." };
  const m = r2(monto); if (!(m >= MONTO_MIN && m <= MONTO_MAX)) return { status: 400, error: "monto_invalido", detail: `El monto debe estar entre L${MONTO_MIN} y L${MONTO_MAX.toLocaleString("en-US")}.` };
  const bco = BANCOS.includes(String(banco)) ? String(banco) : ""; if (!bco) return { status: 400, error: "banco_requerido" };
  const refN = refNorm(referencia); if (refN.length < 4) return { status: 400, error: "referencia_requerida", detail: "Escriba el número de referencia o autorización del depósito." };
  if (!imagenHash) return { status: 400, error: "comprobante_requerido" };
  const rid = limpiar(requestId, 120);
  const id = rid ? `rec_${crypto.createHash("sha256").update(`${sn}|${rid}`).digest("hex").slice(0, 32)}` : db.collection(COL_REC).doc().id;
  const ref = db.collection(COL_REC).doc(id);
  const prev = await ref.get(); if (prev.exists) return { status: 200, ok: true, duplicado: true, recarga: recargaPublica({ id, ...prev.data() }) };
  // Antifraude: referencia o imagen ya usadas (recargas no rechazadas o pedidos).
  const [porRef, porImg, enCompras] = await Promise.all([
    db.collection(COL_REC).where("referenciaNorm", "==", refN).get(),
    db.collection(COL_REC).where("imagenHash", "==", imagenHash).get(),
    db.collection("compras").where("comprobanteHash", "==", imagenHash).limit(1).get(),
  ]);
  if (porRef.docs.some((d) => (d.data() || {}).estado !== "rechazada" && (d.data() || {}).negocio === neg)) return { status: 409, error: "referencia_repetida", detail: "Esa referencia ya se usó en otra recarga." };
  if (porImg.docs.some((d) => (d.data() || {}).estado !== "rechazada")) return { status: 409, error: "comprobante_repetido", detail: "Ese comprobante ya se envió en otra recarga." };
  if (!enCompras.empty) return { status: 409, error: "comprobante_ya_usado", detail: "Ese comprobante ya se usó para pagar un pedido." };
  const doc = { socio: limpiar(socio || sn, 80), socio_norm: sn, negocio: neg, monto: m, banco: bco, referencia: limpiar(referencia, 40), referenciaNorm: refN, imagenHash, imagenUrl: String(imagenUrl || "").slice(0, 2000), estado: "pendiente", requestId: rid, historial: [{ estado: "pendiente", por: "socio", at: new Date().toISOString() }], createdAt: new Date() };
  try { await ref.create(doc); } catch (e) { if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) return { status: 200, ok: true, duplicado: true, recarga: recargaPublica({ id, ...((await ref.get()).data() || {}) }) }; throw e; }
  return { status: 200, ok: true, recarga: recargaPublica({ id, ...doc }) };
}

/** Administración confirma el dinero real (una sola acreditación) o rechaza con motivo. */
async function revisarRecarga(db, { id, accion, por = "Admin", montoRecibido, motivo = "", alcance = "" }) {
  const ref = db.collection(COL_REC).doc(String(id || ""));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 404, error: "no_existe" };
    const r = snap.data() || {};
    if (alcance && alcance !== r.negocio) return { status: 403, error: "fuera_de_ambito" };
    const movRef = db.collection(COL_MOV).doc(`recarga_${ref.id}`);
    const movSnap = await tx.get(movRef); // todas las lecturas antes de escribir
    const ahora = new Date(), quien = limpiar(por, 100);
    if (accion === "aprobar") {
      if (r.estado === "aprobada" || movSnap.exists) return { status: 200, ok: true, sinCambios: true, recarga: recargaPublica({ id: ref.id, ...r }) };
      if (r.estado !== "pendiente") return { status: 409, error: "transicion_invalida" };
      const monto = montoRecibido === "" || montoRecibido == null ? r2(r.monto) : r2(montoRecibido);
      if (!(monto >= MONTO_MIN && monto <= MONTO_MAX)) return { status: 400, error: "monto_invalido" };
      tx.set(movRef, { socio: r.socio, socio_norm: r.socio_norm, negocio: r.negocio, subcuenta: "real", tipo: "recarga", monto, signo: 1, ref: ref.id, detalle: `Recarga ${r.banco} · ref ${r.referencia}`, estado: "acreditado", por: quien, createdAt: ahora });
      const patch = { estado: "aprobada", montoAcreditado: monto, revisadoPor: quien, revisadoAt: ahora, historial: [...(r.historial || []), { estado: "aprobada", por: quien, at: ahora.toISOString(), nota: monto !== r2(r.monto) ? `Monto recibido L${monto} (pidió L${r2(r.monto)})` : "" }] };
      tx.update(ref, patch);
      return { status: 200, ok: true, recarga: recargaPublica({ id: ref.id, ...r, ...patch }) };
    }
    if (accion === "rechazar") {
      if (r.estado === "rechazada") return { status: 200, ok: true, sinCambios: true, recarga: recargaPublica({ id: ref.id, ...r }) };
      if (r.estado !== "pendiente" || movSnap.exists) return { status: 409, error: "transicion_invalida", detail: "Una recarga ya acreditada no se rechaza: se registra un ajuste." };
      const m = limpiar(motivo, 200); if (!m) return { status: 400, error: "falta_motivo" };
      const patch = { estado: "rechazada", motivo: m, revisadoPor: quien, revisadoAt: ahora, historial: [...(r.historial || []), { estado: "rechazada", por: quien, at: ahora.toISOString(), nota: m }] };
      tx.update(ref, patch);
      return { status: 200, ok: true, recarga: recargaPublica({ id: ref.id, ...r, ...patch }) };
    }
    return { status: 400, error: "accion_invalida" };
  });
}

async function listaAdmin(db, { estado = "", alcance = "" } = {}) {
  const [rSnap, mSnap] = await Promise.all([db.collection(COL_REC).get(), db.collection(COL_MOV).get()]);
  let recargas = rSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => (!estado || r.estado === estado) && (!alcance || r.negocio === alcance)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 200)
    .map((r) => ({ ...recargaPublica(r), socio: r.socio || r.socio_norm, socio_norm: r.socio_norm, imagenUrl: r.imagenUrl || "", revisadoPor: r.revisadoPor || "" }));
  const porSocio = {};
  for (const d of mSnap.docs) { const m = d.data() || {}; (porSocio[m.socio_norm] = porSocio[m.socio_norm] || { socio: m.socio || m.socio_norm, movs: [] }).movs.push(m); }
  const saldos = Object.entries(porSocio).map(([sn, x]) => ({ socio: x.socio, socio_norm: sn, saldos: saldosDe(x.movs) })).filter((x) => !alcance || x.saldos[alcance]);
  const total = { sublicuentas: { real: 0, promocional: 0 }, relojes: { real: 0, promocional: 0 } };
  for (const s of saldos) for (const k of Object.keys(total)) { total[k].real = r2(total[k].real + s.saldos[k].real); total[k].promocional = r2(total[k].promocional + s.saldos[k].promocional); }
  return { ok: true, recargas, saldos, total };
}

module.exports = { NEGOCIOS, BANCOS, MONTO_MIN, MONTO_MAX, saldosDe, vistaSocio, solicitarRecarga, revisarRecarga, listaAdmin, negocioDe, refNorm, recargaPublica, COL_MOV, COL_REC };
