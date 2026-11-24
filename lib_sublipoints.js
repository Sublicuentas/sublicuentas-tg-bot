"use strict";
/* =====================================================================================================
   R203 · SubliPoints (Fase 1) — motor de puntos mensual del Panel de Socios.
   Reglas aprobadas (PDF «SubliPoints, Billetera Subli y Tienda de Socios», 23/11/2026, y respuestas del dueño):
   · Venta nueva COBRADA: +2 por servicio. Cobrada = el admin marca el pedido «Pago confirmado» (o «Entregado»).
   · Renovación COBRADA: +1 por servicio renovado. Cobrada = el admin toca «Confirmar pago» en el comprobante.
     Cambiar una fecha sin pago confirmado suma 0.
   · Niveles por mes (hora de Honduras): Sin nivel 0–9 · Diamante 10–24 · Leyenda 25–49 · Inmortal 50+.
   · Idempotente: cada venta/renovación tiene UNA clave (id del documento). Firestore create() falla si ya existe,
     así que Web, Telegram, reintentos o doble clic nunca suman dos veces.
   · Anulación: asiento compensatorio (negativo) en el MISMO mes del original; el historial nunca se borra.
   · Inicio: «desde que se publique». La primera vez que corre se guarda la fecha en sublipoints_config/general
     (se puede cambiar ahí). Pedidos o renovaciones CREADOS antes de esa fecha no suman (sin retroactivo).
   · El mes de un punto es el mes (Honduras) en que se confirmó el cobro.
   · No toca compras, precios, Finanzas ni premios ya entregados: solo escribe en sublipoints_movimientos.
   ===================================================================================================== */
const COL_MOV = "sublipoints_movimientos";
const DOC_CFG = ["sublipoints_config", "general"];
const PUNTOS = Object.freeze({ venta_nueva: 2, renovacion: 1 });
const NIVELES = Object.freeze([
  { nivel: "Inmortal", min: 50 },
  { nivel: "Leyenda", min: 25 },
  { nivel: "Diamante", min: 10 },
]);
const HN_OFFSET_MS = 6 * 3600000; // Honduras: UTC−6 todo el año (sin horario de verano)

function msDe(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v._seconds || v.seconds) return Number(v._seconds || v.seconds) * 1000;
  const n = Date.parse(v); return Number.isFinite(n) ? n : 0;
}
function mesHN(v = Date.now()) { return new Date(msDe(v) - HN_OFFSET_MS).toISOString().slice(0, 7); }
function nivelDe(puntos) {
  const p = Number(puntos) || 0;
  for (const n of NIVELES) if (p >= n.min) return n.nivel;
  return "Sin nivel";
}
function siguienteNivel(puntos) {
  const p = Number(puntos) || 0;
  const orden = [...NIVELES].reverse(); // Diamante, Leyenda, Inmortal
  const sig = orden.find((n) => p < n.min);
  return sig ? { nivel: sig.nivel, min: sig.min, faltan: sig.min - p } : null;
}
const normSocio = (v) => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").slice(0, 80);
const esYaExiste = (e) => e && (e.code === 6 || e.code === "already-exists" || /already exists/i.test(String(e.message || "")));

/** Lee (o crea una sola vez) la configuración. inicio = momento de la primera ejecución ("desde que se publique"). */
async function config(db) {
  const ref = db.collection(DOC_CFG[0]).doc(DOC_CFG[1]);
  const snap = await ref.get();
  if (snap.exists) { const d = snap.data() || {}; if (d.inicio) return { inicio: String(d.inicio), excluidos: Array.isArray(d.excluidos) ? d.excluidos.map(normSocio) : [] }; }
  const inicio = new Date().toISOString();
  try { await ref.create({ inicio, excluidos: [], creadoPor: "sistema (primera ejecución)", nota: "Fecha de entrada en vigor de SubliPoints. Pagos de pedidos/renovaciones creados antes no suman." }); }
  catch (e) { if (!esYaExiste(e)) throw e; const d = (await ref.get()).data() || {}; return { inicio: String(d.inicio || inicio), excluidos: Array.isArray(d.excluidos) ? d.excluidos.map(normSocio) : [] }; }
  return { inicio, excluidos: [] };
}

/** Unidades comerciales de un pedido: un servicio por renglón (× cantidad en cuentas completas). */
function unidadesCompra(compra = {}) {
  const prods = Array.isArray(compra.productos) && compra.productos.length ? compra.productos : [{ cantidad: Number(compra.cantidad) || 1 }];
  return prods.reduce((a, p) => a + Math.max(1, Math.min(50, Number(p && p.cantidad) || 1)), 0);
}

/** Suma puntos UNA sola vez por clave. Devuelve { ok, duplicado?, omitido?, puntos, mes }. */
async function otorgar(db, { clave, socio, socioNorm, tipo, unidades = 1, ref = "", detalle = "", fechaEvento, por = "" }) {
  if (!clave || !PUNTOS[tipo]) throw new Error("sublipoints_parametros");
  const sn = normSocio(socioNorm || socio); if (!sn) return { ok: false, omitido: "sin_socio" };
  const cfg = await config(db);
  if (cfg.excluidos.includes(sn)) return { ok: false, omitido: "excluido" };
  if (msDe(fechaEvento) && msDe(fechaEvento) < Date.parse(cfg.inicio)) return { ok: false, omitido: "antes_del_inicio" };
  const u = Math.max(1, Math.min(50, Number(unidades) || 1));
  const puntos = PUNTOS[tipo] * u, mes = mesHN();
  const docRef = db.collection(COL_MOV).doc(String(clave).replace(/[\/#?]/g, "_").slice(0, 140));
  try {
    await docRef.create({ clave: docRef.id, socio: String(socio || sn).slice(0, 80), socio_norm: sn, tipo, unidades: u, puntos, mes, ref: String(ref).slice(0, 80), detalle: String(detalle).slice(0, 160), por: String(por).slice(0, 80), createdAt: new Date() });
  } catch (e) { if (esYaExiste(e)) return { ok: true, duplicado: true, puntos: 0, mes }; throw e; }
  return { ok: true, puntos, mes };
}

/** Asiento compensatorio (una sola vez) si el original existe. Mismo mes del original. */
async function revertir(db, { clave, motivo = "", por = "" }) {
  const id = String(clave).replace(/[\/#?]/g, "_").slice(0, 140);
  const orig = await db.collection(COL_MOV).doc(id).get();
  if (!orig.exists) return { ok: true, sinOriginal: true, puntos: 0 };
  const o = orig.data() || {};
  const rRef = db.collection(COL_MOV).doc(`${id}__reverso`.slice(0, 150));
  try {
    await rRef.create({ clave: rRef.id, original: id, socio: o.socio, socio_norm: o.socio_norm, tipo: "reverso", unidades: o.unidades, puntos: -Math.abs(Number(o.puntos) || 0), mes: o.mes, ref: o.ref, detalle: String(motivo || "Anulado").slice(0, 160), por: String(por).slice(0, 80), createdAt: new Date() });
  } catch (e) { if (esYaExiste(e)) return { ok: true, duplicado: true, puntos: 0 }; throw e; }
  return { ok: true, puntos: -Math.abs(Number(o.puntos) || 0), mes: o.mes };
}

/** Agrupa movimientos por mes: puntos netos, ventas nuevas y renovaciones (descontando reversos). */
function agrupar(movs = []) {
  const meses = {};
  for (const m of movs) {
    const k = m.mes || "?"; const g = meses[k] || (meses[k] = { mes: k, puntos: 0, ventasNuevas: 0, renovaciones: 0 });
    const p = Number(m.puntos) || 0; g.puntos += p;
    const tipoBase = m.tipo === "reverso" ? (String(m.original || "").startsWith("renov_") ? "renovacion" : "venta_nueva") : m.tipo;
    const signo = m.tipo === "reverso" ? -1 : 1, u = Number(m.unidades) || 0;
    if (tipoBase === "venta_nueva") g.ventasNuevas += signo * u; else if (tipoBase === "renovacion") g.renovaciones += signo * u;
  }
  return Object.values(meses).map((g) => ({ ...g, puntos: Math.max(0, g.puntos), nivel: nivelDe(g.puntos) })).sort((a, b) => b.mes.localeCompare(a.mes));
}

async function resumenSocio(db, socioNorm, mes = mesHN()) {
  const sn = normSocio(socioNorm);
  const [cfg, snap] = await Promise.all([config(db), db.collection(COL_MOV).where("socio_norm", "==", sn).get()]);
  const movs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const meses = agrupar(movs);
  const actual = meses.find((m) => m.mes === mes) || { mes, puntos: 0, ventasNuevas: 0, renovaciones: 0, nivel: "Sin nivel" };
  const recientes = movs.filter((m) => m.mes === mes).sort((a, b) => msDe(b.createdAt) - msDe(a.createdAt)).slice(0, 30)
    .map((m) => ({ tipo: m.tipo, puntos: m.puntos, unidades: m.unidades, detalle: m.detalle || "", ref: m.ref || "", fecha: new Date(msDe(m.createdAt)).toISOString() }));
  return { ok: true, inicio: cfg.inicio, mes, puntos: actual.puntos, nivel: actual.nivel, siguiente: siguienteNivel(actual.puntos), ventasNuevas: actual.ventasNuevas, renovaciones: actual.renovaciones, meses: meses.slice(0, 12), movimientos: recientes, reglas: { ventaNueva: PUNTOS.venta_nueva, renovacion: PUNTOS.renovacion, niveles: [...NIVELES].reverse() } };
}

async function rankingMes(db, mes = mesHN()) {
  const snap = await db.collection(COL_MOV).where("mes", "==", mes).get();
  const por = {};
  for (const d of snap.docs) { const m = d.data() || {}; (por[m.socio_norm] = por[m.socio_norm] || { socio: m.socio, socio_norm: m.socio_norm, movs: [] }).movs.push(m); }
  return Object.values(por).map((x) => { const g = agrupar(x.movs)[0] || { puntos: 0, ventasNuevas: 0, renovaciones: 0, nivel: "Sin nivel" }; return { socio: x.socio, socio_norm: x.socio_norm, puntos: g.puntos, nivel: g.nivel, ventasNuevas: g.ventasNuevas, renovaciones: g.renovaciones }; })
    .sort((a, b) => b.puntos - a.puntos);
}

// Claves estables (una por venta / por renovación)
const claveCompra = (id) => `compra_${id}`;
const claveRenovacion = (id) => `renov_${id}`;

module.exports = { PUNTOS, NIVELES, mesHN, nivelDe, siguienteNivel, unidadesCompra, config, otorgar, revertir, agrupar, resumenSocio, rankingMes, claveCompra, claveRenovacion, COL_MOV };
