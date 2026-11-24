"use strict";
/* =====================================================================================================
   R206 · Fase 4 — Pagar pedidos con saldo de billetera (reserva/cargo atómico), Gift Card y descuento ≤5%.
   Reglas aprobadas (PDF secc. 07 + dueño 23/11/2026):
   · Dos medios de pago que terminan en el MISMO pedido y la MISMA cola de entregas manuales.
   · Con billetera: el cargo se hace dentro de la MISMA transacción que crea el pedido. Se lee un documento de
     bloqueo por socio+negocio (billetera_cuentas) y el libro; si dos compras llegan a la vez, Firestore repite una
     y esa ya ve el primer cargo → nunca saldo negativo ni doble gasto. El pedido nace «pago confirmado» (no se entrega solo).
   · Descuento por billetera (dueño 23/11/2026, 21:50): 5% parejo en TODOS los productos menos Netflix. No se pide
     costo: el dueño maneja sus márgenes. Cada producto puede apagarse o bajarse de % en Panel Dios. Se redondea hacia
     abajo a lempiras enteros. La transferencia con comprobante conserva el precio normal.
   · Gift Card (saldo promocional): solo negocio Sublicuentas, todos los productos menos Netflix. Por defecto NO se
     combina con el descuento de billetera (si usa Gift Card, el descuento es 0). Consumo parcial permitido.
   · Cancelación: se devuelve UNA sola vez lo cargado (real y promocional) con movimientos compensatorios.
   · Se guarda precio de lista, descuento, Gift Card, saldo usado y total final en el pedido.
   ===================================================================================================== */
const BIL = require("./lib_billetera");
const COL_CFG = ["billetera_config", "descuentos"];
const COL_COSTOS = "billetera_descuentos";
const COL_LOCK = "billetera_cuentas";
const CFG_BASE = Object.freeze({ pctMax: 5, excluir: ["netflix"], combinarGiftDescuento: false, giftCardMaxPorPedido: null });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (v) => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Ajuste por producto (% o apagado) guardado por categoría + nombre + variante, igual en tarifa general y especiales.
const slugK = (v) => norm(v).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const claveCosto = (p) => `${slugK(p.catalogCategory || p.categoria)}__${slugK(p.servicioBase || p.n)}__${slugK(p.catalogSub ?? p.s ?? "")}`.slice(0, 140);
const esExcluido = (p, excl = CFG_BASE.excluir) => excl.some((x) => [p.servicio, p.servicioBase, p.catalogId, p.id].some((v) => norm(v).includes(norm(x))));

async function configuracion(db) {
  const [cfgSnap, costSnap] = await Promise.all([db.collection(COL_CFG[0]).doc(COL_CFG[1]).get(), db.collection(COL_COSTOS).get()]);
  const d = cfgSnap.exists ? cfgSnap.data() || {} : {};
  const cfg = {
    pctMax: Math.max(0, Math.min(5, Number(d.pctMax ?? CFG_BASE.pctMax))),
    excluir: [...new Set([...CFG_BASE.excluir, ...(Array.isArray(d.excluir) ? d.excluir.map(norm).filter(Boolean) : [])])],
    combinarGiftDescuento: d.combinarGiftDescuento === true,
    giftCardMaxPorPedido: d.giftCardMaxPorPedido == null || d.giftCardMaxPorPedido === "" ? null : Math.max(0, Number(d.giftCardMaxPorPedido)),
  };
  const costos = {};
  for (const doc of costSnap.docs) { const c = doc.data() || {}; costos[doc.id] = { pct: c.pct == null || c.pct === "" ? null : Math.max(0, Math.min(5, Number(c.pct))), activo: c.activo !== false }; }
  return { cfg, costos };
}

/** Cotización pura: no toca la base. saldos = saldos del negocio elegido {real, reservado, promocional}. */
function cotizar({ productos = [], descuentoCombo = 0, totalCombo = 0, negocio = "sublicuentas", saldos = {}, usarGiftCard = false, cfg = CFG_BASE, costos = {} }) {
  const conPrecio = productos.filter((p) => p.precioCatalogo !== null && p.precioCatalogo !== undefined);
  if (conPrecio.length !== productos.length) return { ok: false, error: "billetera_no_aplica_comision", detail: "Los productos «por comisión» se pagan con transferencia y comprobante." };
  const subtotal = conPrecio.reduce((a, p) => a + Number(p.precioCatalogo) * (p.cantidad || 1), 0);
  const giftPedido = usarGiftCard === true && negocio === "sublicuentas" && Number(saldos.promocional) > 0;
  const sinDescuento = giftPedido && !cfg.combinarGiftDescuento;
  const lineas = conPrecio.map((p) => {
    const cant = p.cantidad || 1, bruto = Number(p.precioCatalogo) * cant;
    const neto = subtotal > 0 ? bruto - descuentoCombo * (bruto / subtotal) : bruto; // parte del descuento por combo
    const unit = neto / cant, excl = esExcluido(p, cfg.excluir), c = costos[claveCosto(p)] || {};
    let descUnit = 0, motivo = "";
    if (excl) motivo = "Netflix no tiene descuento";
    else if (sinDescuento) motivo = "Con Gift Card no aplica descuento";
    else if (c.activo === false) motivo = "Descuento apagado para este producto";
    else {
      const pct = c.pct != null ? Math.min(c.pct, cfg.pctMax) : cfg.pctMax;
      descUnit = Math.max(0, Math.floor(unit * pct / 100));
      if (!descUnit) motivo = "Descuento menor a L1";
    }
    return { catalogId: p.catalogId || "", clave: claveCosto(p), servicio: p.servicio || "", cantidad: cant, neto: r2(neto), descuento: descUnit * cant, motivo, excluido: excl };
  });
  const descuento = lineas.reduce((a, l) => a + l.descuento, 0);
  const totalFinal = r2(Math.max(0, Number(totalCombo) - descuento));
  let giftCard = 0;
  if (giftPedido) {
    const elegible = lineas.filter((l) => !l.excluido).reduce((a, l) => a + l.neto - l.descuento, 0);
    giftCard = r2(Math.max(0, Math.min(Number(saldos.promocional) || 0, elegible, totalFinal, cfg.giftCardMaxPorPedido == null ? Infinity : cfg.giftCardMaxPorPedido)));
  }
  const aPagarSaldo = r2(totalFinal - giftCard);
  const disponible = r2(Number(saldos.disponible ?? saldos.real) || 0);
  return { ok: true, negocio, lista: r2(totalCombo), descuento: r2(descuento), totalFinal, giftCard, aPagarSaldo, saldoDisponible: disponible, saldoPromocional: r2(saldos.promocional || 0), suficiente: disponible >= aPagarSaldo, faltante: r2(Math.max(0, aPagarSaldo - disponible)), lineas, reglas: { pctMax: cfg.pctMax, combinarGiftDescuento: cfg.combinarGiftDescuento } };
}

/** Dentro de una transacción: lee el bloqueo y el libro del socio (SOLO lecturas). Devuelve los saldos y una
 *  función que escribe el cargo cuando el llamador termine sus lecturas. */
async function prepararCargo(tx, db, { socioNorm, negocio }) {
  const sn = BIL.norm(socioNorm), lockRef = db.collection(COL_LOCK).doc(`${sn.replace(/[^a-z0-9]+/g, "_")}_${negocio}`);
  const [lockSnap, movSnap] = await Promise.all([tx.get(lockRef), tx.get(db.collection(BIL.COL_MOV).where("socio_norm", "==", sn))]);
  const saldos = BIL.saldosDe(movSnap.docs.map((d) => d.data() || {}))[negocio];
  const version = lockSnap.exists ? Number((lockSnap.data() || {}).version) || 0 : 0;
  return {
    saldos,
    aplicar(cot, { compraId, socio, por = "socio" }) {
      const ahora = new Date();
      if (cot.aPagarSaldo > 0) tx.set(db.collection(BIL.COL_MOV).doc(`pago_${compraId}_real`), { socio, socio_norm: sn, negocio, subcuenta: "real", tipo: "compra", monto: cot.aPagarSaldo, signo: -1, ref: compraId, detalle: "Pago de pedido con saldo", estado: "acreditado", por, createdAt: ahora });
      if (cot.giftCard > 0) tx.set(db.collection(BIL.COL_MOV).doc(`pago_${compraId}_promo`), { socio, socio_norm: sn, negocio, subcuenta: "promocional", tipo: "compra", monto: cot.giftCard, signo: -1, ref: compraId, detalle: "Pago de pedido con Gift Card", estado: "acreditado", por, createdAt: ahora });
      tx.set(lockRef, { socio_norm: sn, negocio, version: version + 1, ultimoCargo: compraId, updatedAt: ahora }, { merge: true });
    },
  };
}

/** Devolución por cancelación: una sola vez por subcuenta (ids fijos). Solo devuelve lo que de verdad se cargó. */
async function devolver(db, { compraId, motivo = "Pedido cancelado", por = "Admin" }) {
  const out = { real: 0, promocional: 0 };
  for (const sub of ["real", "promo"]) {
    const orig = await db.collection(BIL.COL_MOV).doc(`pago_${compraId}_${sub}`).get();
    if (!orig.exists) continue;
    const o = orig.data() || {};
    try {
      await db.collection(BIL.COL_MOV).doc(`devolucion_${compraId}_${sub}`).create({ socio: o.socio, socio_norm: o.socio_norm, negocio: o.negocio, subcuenta: o.subcuenta, tipo: "devolucion", monto: o.monto, signo: 1, ref: compraId, detalle: String(motivo).slice(0, 160), estado: "acreditado", por: String(por).slice(0, 80), createdAt: new Date() });
      out[o.subcuenta === "promocional" ? "promocional" : "real"] = r2(o.monto);
    } catch (e) { if (!(e && (e.code === 6 || /already exists/i.test(String(e.message))))) throw e; out.duplicado = true; }
  }
  return out;
}

async function guardarConfig(db, cambios = {}, por = "Admin") {
  const p = { updatedAt: new Date(), updatedPor: String(por).slice(0, 80) };
  if ("pctMax" in cambios) { const n = Number(cambios.pctMax); if (!(n >= 0 && n <= 5)) return { status: 400, error: "pct_invalido", detail: "El descuento máximo es de 0% a 5%." }; p.pctMax = n; }
  if ("combinarGiftDescuento" in cambios) p.combinarGiftDescuento = cambios.combinarGiftDescuento === true;
  if ("giftCardMaxPorPedido" in cambios) { const v = cambios.giftCardMaxPorPedido; p.giftCardMaxPorPedido = v === "" || v == null ? null : Math.max(0, Number(v) || 0); }
  await db.collection(COL_CFG[0]).doc(COL_CFG[1]).set(p, { merge: true });
  return { status: 200, ok: true, ...(await configuracion(db)) };
}
async function guardarCosto(db, clave, cambios = {}, por = "Admin") {
  const id = String(clave || "").replace(/[\/#?]/g, "_").slice(0, 90); if (!id) return { status: 400, error: "falta_producto" };
  const p = { updatedAt: new Date(), updatedPor: String(por).slice(0, 80) };
  if ("pct" in cambios) { const v = cambios.pct; if (v === "" || v == null) p.pct = null; else { const n = Number(v); if (!(n >= 0 && n <= 5)) return { status: 400, error: "pct_invalido" }; p.pct = n; } }
  if ("activo" in cambios) p.activo = cambios.activo !== false && cambios.activo !== "false";
  if (cambios.nombre) p.nombre = String(cambios.nombre).slice(0, 140);
  await db.collection(COL_COSTOS).doc(id).set(p, { merge: true });
  return { status: 200, ok: true, id };
}

/** Lista para Panel Dios: productos del catálogo general con su %, si está activo y el descuento que saldría hoy. */
function tablaAdmin(itemsPlanos = [], { cfg = CFG_BASE, costos = {} } = {}) {
  return itemsPlanos.filter((it) => it && it.n).map((it) => {
    const p = { catalogCategory: it.categoria, servicioBase: it.n, catalogSub: it.s || "", servicio: it.nombreCompleto || it.n, catalogId: it.id, precioCatalogo: it.p ?? null, cantidad: 1 };
    const clave = claveCosto(p), c = costos[clave] || {};
    const precio = p.precioCatalogo === null ? NaN : Number(p.precioCatalogo);
    const cot = Number.isFinite(precio) && precio > 0 ? cotizar({ productos: [p], descuentoCombo: 0, totalCombo: precio, cfg, costos }) : null;
    return { clave, nombre: p.servicio, categoria: it.categoria || "", precio: Number.isFinite(precio) ? precio : null, pct: c.pct ?? null, activo: c.activo !== false, excluido: esExcluido(p, cfg.excluir), descuentoHoy: cot && cot.ok ? cot.descuento : 0, motivo: cot && cot.ok ? cot.lineas[0].motivo : "Sin precio fijo" };
  });
}

module.exports = { CFG_BASE, claveCosto, tablaAdmin, configuracion, cotizar, prepararCargo, devolver, guardarConfig, guardarCosto, esExcluido };
