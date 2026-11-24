"use strict";
/* =====================================================================================================
   R204 · SubliPoints Fase 2 — catálogo oficial de 9 recompensas, solicitudes mensuales y Gift Card L100.
   Reglas (PDF 23/11/2026, sección 03–04):
   · Los tres niveles y sus premios siempre visibles: Disponible / Bloqueado / Agotado / Solicitado.
   · UNA recompensa por socio POR MES, del nivel más alto alcanzado ESE mes (no se acumulan niveles).
     Clave única recompensas_socios/sp_<socio>_<mes> → create() falla si ya existe (doble clic, reintentos).
   · Estados: pendiente_aprobacion → aprobada (pendiente de entrega) → entregada | rechazada. Todo manual.
   · Aprobar exige «disponibilidad comprobada» y, si hay cupos, descuenta uno en la MISMA transacción.
   · No se guardan credenciales: la entrega se registra con una nota (sin claves) y el costo real.
   · Gift Card Sublicuentas L100: al aprobarla se acredita UNA vez saldo PROMOCIONAL (no es dinero) en
     billetera_movimientos/premio_<id> (subcuenta «promocional», negocio Sublicuentas). Se usará en la tienda
     cuando esté el pago con saldo (Fase 4). Productos elegibles: todos menos Netflix.
   · Los premios ya pedidos con el sistema anterior se respetan (se siguen viendo y administrando).
   · Duración, costo, disponibilidad, cupos y plan de HBO se editan en administración (Sublichat › Revendedores).
   ===================================================================================================== */
const SP = require("./lib_sublipoints");

const COL_CAT = "recompensas_catalogo";
const COL_SOL = "recompensas_socios";
const COL_BILL = "billetera_movimientos";
const CATALOGO_BASE = Object.freeze([
  { id: "dia_appletv", nivel: "Diamante", nombre: "Apple TV", modalidad: "Cuenta completa", duracion: "", tipo: "producto", orden: 1 },
  { id: "dia_elevenreader", nivel: "Diamante", nombre: "Eleven Reader Ultra", modalidad: "Cuenta completa", duracion: "", tipo: "producto", orden: 2 },
  { id: "dia_canva_edu", nivel: "Diamante", nombre: "Canva Edu Pro", modalidad: "Acceso", duracion: "2 meses", tipo: "producto", orden: 3 },
  { id: "ley_duolingo", nivel: "Leyenda", nombre: "Duolingo Plus", modalidad: "Acceso", duracion: "3 meses", tipo: "producto", orden: 4 },
  { id: "ley_openenglish", nivel: "Leyenda", nombre: "Open English", modalidad: "Acceso", duracion: "3 meses", tipo: "producto", orden: 5 },
  { id: "ley_prime", nivel: "Leyenda", nombre: "Prime Video", modalidad: "Cuenta completa", duracion: "", tipo: "producto", orden: 6 },
  { id: "inm_gemini", nivel: "Inmortal", nombre: "Gemini Pro", modalidad: "Acceso", duracion: "3 meses", tipo: "producto", orden: 7 },
  { id: "inm_hbo", nivel: "Inmortal", nombre: "HBO Max", modalidad: "Acceso", duracion: "1 mes", tipo: "producto", plan: "", orden: 8 },
  { id: "inm_giftcard_100", nivel: "Inmortal", nombre: "Gift Card Sublicuentas", modalidad: "Saldo promocional", duracion: "", tipo: "giftcard", montoHnl: 100, excluirPlataformas: ["netflix"], orden: 9 },
]);
const NIVEL_ORDEN = { "Sin nivel": 0, Diamante: 1, Leyenda: 2, Inmortal: 3 };
const ESTADOS = Object.freeze({ pendiente_aprobacion: "Pendiente de aprobación", aprobada: "Aprobada · pendiente de entrega", entregada: "Entregada", rechazada: "Rechazada" });
const EDITABLES = ["duracion", "costoHnl", "disponibilidad", "cupos", "activo", "plan", "nota"];
const limpiar = (v, n = 160) => String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, n);
const esYaExiste = (e) => e && (e.code === 6 || e.code === "already-exists" || /already exists/i.test(String(e.message || "")));
const ms = (v) => (!v ? 0 : typeof v === "number" ? v : v instanceof Date ? v.getTime() : typeof v.toMillis === "function" ? v.toMillis() : v._seconds || v.seconds ? Number(v._seconds || v.seconds) * 1000 : Date.parse(v) || 0);

/** Catálogo completo (los 9 oficiales). Si falta alguno en Firestore se crea con sus valores base, una sola vez. */
async function catalogo(db) {
  const snap = await db.collection(COL_CAT).get();
  const guardados = new Map(snap.docs.map((d) => [d.id, d.data() || {}]));
  const out = [];
  for (const base of CATALOGO_BASE) {
    let d = guardados.get(base.id);
    if (!d) {
      d = { ...base, costoHnl: null, disponibilidad: "disponible", cupos: null, activo: true, nota: "", creadoAt: new Date() };
      try { await db.collection(COL_CAT).doc(base.id).create(d); } catch (e) { if (!esYaExiste(e)) throw e; d = (await db.collection(COL_CAT).doc(base.id).get()).data() || d; }
    }
    // Nombre, nivel y tipo son los oficiales del PDF: no se cambian desde la base de datos.
    out.push({ ...d, id: base.id, nivel: base.nivel, nombre: base.nombre, tipo: base.tipo, orden: base.orden, montoHnl: base.montoHnl || null, excluirPlataformas: base.excluirPlataformas || [] });
  }
  return out;
}
function agotado(item) { return item.disponibilidad === "agotado" || (item.cupos != null && Number(item.cupos) <= 0) || item.activo === false; }
function textoDuracion(item) {
  if (item.tipo === "giftcard") return `L${item.montoHnl} de saldo promocional · todos los productos menos Netflix`;
  const plan = item.id === "inm_hbo" ? (item.plan ? ` · plan ${item.plan}` : " · plan por configurar") : "";
  return `${item.modalidad}${item.duracion ? ` · ${item.duracion}` : " · duración por definir"}${plan}`;
}

/** Vista del socio: resumen del mes + catálogo con estado de cada premio + su solicitud del mes + historial. */
async function vistaSocio(db, socioNorm) {
  const sn = SP.normSocio(socioNorm);
  const [resumen, cat, solSnap, saldoPromo] = await Promise.all([SP.resumenSocio(db, sn), catalogo(db), db.collection(COL_SOL).where("socio_norm", "==", sn).get(), saldoPromocional(db, sn)]);
  const solicitudes = solSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const delMes = solicitudes.find((s) => s.programa === "sublipoints" && s.mes === resumen.mes && s.estado !== "rechazada") || null;
  const items = cat.map((it) => {
    let estado = "bloqueado", motivo = `Se desbloquea con ${it.nivel} (${{ Diamante: "10", Leyenda: "25", Inmortal: "50" }[it.nivel]} puntos este mes)`;
    if (resumen.excluido) motivo = "Las cuentas de Sublicuentas y Relojes no participan";
    else if (delMes) { estado = delMes.recompensaId === it.id ? "solicitado" : "bloqueado"; motivo = delMes.recompensaId === it.id ? ESTADOS[delMes.estado] || delMes.estado : "Ya eligió su recompensa de este mes"; }
    else if (agotado(it)) { estado = "agotado"; motivo = "Sin disponibilidad por ahora"; }
    else if (resumen.nivel === it.nivel) { estado = "disponible"; motivo = "Puede elegirla este mes"; }
    else if (NIVEL_ORDEN[resumen.nivel] > NIVEL_ORDEN[it.nivel]) motivo = `Este mes le corresponde un premio ${resumen.nivel}`;
    return { id: it.id, nivel: it.nivel, nombre: it.nombre, detalle: textoDuracion(it), tipo: it.tipo, estado, motivo };
  });
  return { ok: true, resumen, items, solicitudMes: delMes ? publica(delMes) : null, solicitudes: solicitudes.slice(0, 24).map(publica), saldoPromocional: saldoPromo };
}
function publica(s) {
  return { id: s.id, programa: s.programa || "anterior", mes: s.mes || "", nivel: s.nivel || "", recompensa: s.recompensa || "", recompensaId: s.recompensaId || "", estado: s.estado || "pendiente", estadoTexto: ESTADOS[s.estado] || s.estado || "Pendiente", motivo: s.motivoRechazo || "", nota: s.notaSocio || "", fecha: new Date(ms(s.createdAt) || Date.now()).toISOString() };
}

/** El socio elige un premio. Una sola vez por mes (clave única). */
async function solicitar(db, { socio, socioNorm, recompensaId }) {
  const sn = SP.normSocio(socioNorm || socio);
  const [resumen, cat] = await Promise.all([SP.resumenSocio(db, sn), catalogo(db)]);
  if (resumen.excluido) return { status: 403, error: "no_participa" };
  const item = cat.find((x) => x.id === String(recompensaId || ""));
  if (!item) return { status: 400, error: "recompensa_no_existe" };
  if (resumen.nivel === "Sin nivel") return { status: 409, error: "sin_nivel", detail: "Necesita al menos 10 puntos este mes." };
  if (item.nivel !== resumen.nivel) return { status: 409, error: "nivel_no_corresponde", detail: `Este mes le corresponde elegir un premio ${resumen.nivel}.` };
  if (agotado(item)) return { status: 409, error: "agotado" };
  const id = `sp_${sn.replace(/[^a-z0-9]+/g, "_")}_${resumen.mes}`;
  const ref = db.collection(COL_SOL).doc(id);
  const ahora = new Date();
  const doc = { programa: "sublipoints", socio: limpiar(socio || sn, 80), socio_norm: sn, mes: resumen.mes, nivel: resumen.nivel, puntos: resumen.puntos, recompensaId: item.id, recompensa: item.nombre, detalle: textoDuracion(item), tipo: item.tipo, estado: "pendiente_aprobacion", historial: [{ estado: "pendiente_aprobacion", por: "socio", at: ahora.toISOString() }], createdAt: ahora };
  try { await ref.create(doc); }
  catch (e) {
    if (!esYaExiste(e)) throw e;
    const prev = (await ref.get()).data() || {};
    if (prev.estado !== "rechazada") return { status: 409, error: "ya_eligio_este_mes", solicitud: publica({ id, ...prev }) };
    // Si la anterior fue rechazada puede volver a elegir (mismo documento; se conserva el historial).
    await db.runTransaction(async (tx) => {
      const s2 = await tx.get(ref); const d2 = s2.data() || {};
      if (d2.estado !== "rechazada") throw Object.assign(new Error("ya_eligio_este_mes"), { status: 409 });
      tx.set(ref, { ...doc, historial: [...(Array.isArray(d2.historial) ? d2.historial : []), { estado: "pendiente_aprobacion", por: "socio", at: ahora.toISOString(), nota: `Nueva elección tras rechazo (antes: ${d2.recompensa || ""})` }], intentos: (Number(d2.intentos) || 1) + 1 });
    });
  }
  return { status: 200, ok: true, solicitud: publica({ id, ...doc }) };
}

/** Cambios de estado hechos por administración. Idempotentes y dentro de una transacción. */
async function cambiarEstado(db, { id, estado, por = "Admin", delegado = "", disponibilidadComprobada = false, costoRealHnl, nota = "", motivo = "" }) {
  const ref = db.collection(COL_SOL).doc(String(id || ""));
  const quien = limpiar(delegado ? `${delegado} (vía ${por})` : por, 100);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 404, error: "no_existe" };
    const s = snap.data() || {};
    if (s.programa !== "sublipoints") return { status: 409, error: "programa_anterior" };
    const actual = s.estado;
    if (actual === estado) return { status: 200, ok: true, sinCambios: true, estado };
    const permitido = { pendiente_aprobacion: ["aprobada", "rechazada"], aprobada: ["entregada", "rechazada"], entregada: [], rechazada: [] };
    if (!(permitido[actual] || []).includes(estado)) return { status: 409, error: "transicion_invalida", detail: `${ESTADOS[actual] || actual} → ${ESTADOS[estado] || estado}` };
    const ahora = new Date(), at = ahora.toISOString();
    const patch = { estado, updatedAt: ahora };
    const hist = { estado, por: quien, at };
    const costo = costoRealHnl === "" || costoRealHnl == null ? null : Number(costoRealHnl);
    if (costo != null && (!Number.isFinite(costo) || costo < 0 || costo > 100000)) return { status: 400, error: "costo_invalido" };
    let catRef = null, item = null;
    if (estado === "aprobada") {
      if (disponibilidadComprobada !== true) return { status: 400, error: "falta_comprobar_disponibilidad", detail: "Confirme que comprobó el cupo y el acceso real antes de aprobar." };
      catRef = db.collection(COL_CAT).doc(s.recompensaId);
      const esGift = s.tipo === "giftcard" || s.recompensaId === "inm_giftcard_100";
      const bRef = esGift ? db.collection(COL_BILL).doc(`premio_${ref.id}`) : null;
      const [catSnap, bSnap] = await Promise.all([tx.get(catRef), bRef ? tx.get(bRef) : Promise.resolve(null)]); // todas las lecturas antes de escribir
      item = { ...(CATALOGO_BASE.find((x) => x.id === s.recompensaId) || {}), ...(catSnap.exists ? catSnap.data() : {}) };
      if (agotado(item)) return { status: 409, error: "agotado", detail: "El premio está marcado agotado o sin cupos." };
      patch.aprobadoPor = quien; patch.aprobadoAt = ahora; patch.disponibilidadComprobada = true;
      if (catSnap.exists && item.cupos != null) tx.update(catRef, { cupos: Math.max(0, Number(item.cupos) - 1), updatedAt: ahora });
      if (esGift) {
        // Saldo promocional: una sola vez por solicitud (id fijo). No es dinero ni venta.
        if (!bSnap.exists) tx.set(bRef, { socio: s.socio, socio_norm: s.socio_norm, negocio: "sublicuentas", subcuenta: "promocional", tipo: "premio", monto: Number(item.montoHnl || 100), signo: 1, ref: ref.id, detalle: "Gift Card Sublicuentas (recompensa Inmortal)", excluirPlataformas: ["netflix"], estado: "acreditado", por: quien, createdAt: ahora });
        patch.estado = "entregada"; patch.entregadoPor = quien; patch.entregadoAt = ahora; patch.notaEntrega = `Saldo promocional de L${Number(item.montoHnl || 100)} acreditado`;
        hist.nota = patch.notaEntrega; patch.notaSocio = `Se acreditaron L${Number(item.montoHnl || 100)} de saldo promocional (no es efectivo). Se usa en la tienda en todos los productos menos Netflix.`;
      }
    }
    if (estado === "entregada") { patch.entregadoPor = quien; patch.entregadoAt = ahora; patch.notaEntrega = limpiar(nota, 300); patch.notaSocio = limpiar(nota, 300); hist.nota = "Entrega registrada (sin datos de acceso)"; }
    if (estado === "rechazada") { const m = limpiar(motivo, 200); if (!m) return { status: 400, error: "falta_motivo" }; patch.motivoRechazo = m; patch.rechazadoPor = quien; patch.rechazadoAt = ahora; hist.nota = m; }
    if (costo != null) patch.costoRealHnl = costo;
    patch.historial = [...(Array.isArray(s.historial) ? s.historial : []), hist];
    tx.update(ref, patch);
    return { status: 200, ok: true, estado: patch.estado, solicitud: publica({ id: ref.id, ...s, ...patch }) };
  });
}

async function editarCatalogo(db, id, cambios = {}, por = "Admin") {
  const base = CATALOGO_BASE.find((x) => x.id === id);
  if (!base) return { status: 404, error: "no_existe" };
  await catalogo(db); // garantiza que exista
  const patch = { updatedAt: new Date(), updatedPor: limpiar(por, 80) };
  for (const k of EDITABLES) {
    if (!(k in cambios)) continue;
    const v = cambios[k];
    if (k === "costoHnl") { if (v === "" || v == null) patch.costoHnl = null; else { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100000) return { status: 400, error: "costo_invalido" }; patch.costoHnl = Math.round(n * 100) / 100; } }
    else if (k === "cupos") { if (v === "" || v == null) patch.cupos = null; else { const n = Math.floor(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 9999) return { status: 400, error: "cupos_invalidos" }; patch.cupos = n; } }
    else if (k === "disponibilidad") { if (!["disponible", "agotado"].includes(v)) return { status: 400, error: "disponibilidad_invalida" }; patch.disponibilidad = v; }
    else if (k === "activo") patch.activo = v === true || v === "true";
    else if (k === "plan") { if (id !== "inm_hbo") continue; if (!["", "Standard", "Platinum", "Basic con anuncios"].includes(String(v))) return { status: 400, error: "plan_invalido" }; patch.plan = String(v); }
    else if (k === "duracion") { if (base.tipo === "giftcard") continue; patch.duracion = limpiar(v, 40); }
    else patch[k] = limpiar(v, 200);
  }
  await db.collection(COL_CAT).doc(id).set(patch, { merge: true });
  return { status: 200, ok: true, item: (await catalogo(db)).find((x) => x.id === id) };
}

async function saldoPromocional(db, socioNorm) {
  const snap = await db.collection(COL_BILL).where("socio_norm", "==", SP.normSocio(socioNorm)).get();
  return Math.round(snap.docs.map((d) => d.data() || {}).filter((m) => m.subcuenta === "promocional" && m.estado !== "anulado").reduce((a, m) => a + (Number(m.monto) || 0) * (Number(m.signo) || 1), 0) * 100) / 100;
}

module.exports = { CATALOGO_BASE, ESTADOS, catalogo, vistaSocio, solicitar, cambiarEstado, editarCatalogo, saldoPromocional, publica, agotado, textoDuracion };
