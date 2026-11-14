"use strict";
/* lib_cuenta_completa.js · R196q — Convertir una compra EXISTENTE (vendida como «perfil» antes de existir la modalidad)
   a «cuenta completa», eligiendo una cuenta real de Bodega (inventario). PDF «Cuenta completa · cambio de plataforma ·
   Control Maestro» (14/11/2026).

   Modelo real (no se crean campos paralelos):
     · clientes/{id}.servicios[] → la MISMA compra (mismo compraId). Ya existía tipoVenta "cuenta_completa" y categoría
       "cuentas_completas" (R118 / lib_catalogo_categorias). Se agrega la referencia estable cuentaInventarioId y el rastro
       modalidadAnterior + historialModalidad (antes/después, cuenta antes/después, operador, fecha).
     · inventario/{id} (Bodega) → la cuenta elegida queda con este único ocupante y marcada exclusiva
       (modalidadVenta, exclusivaCompraId, exclusivaClienteId; sin cupos disponibles). La cuenta anterior suelta SOLO los
       perfiles de esta compra (recalcula ocupados/disponibles); los demás clientes no se tocan.
   Reglas: no elige sola ninguna cuenta; una cuenta con perfiles de OTROS clientes o exclusiva de otra compra no es elegible
   (se valida otra vez dentro de la transacción); precio, fecha, vendedor, meses, cliente y compraId no cambian; no se crea
   venta, pago ni movimiento de Finanzas; todo en UNA transacción (si algo falla no queda nada a medias). Repetir la misma
   conversión no hace nada; elegir otra cuenta después corrige (libera la anterior). La clave nunca va a auditoría. */

const cat = require("./lib_catalogo_categorias");
const invCanon = require("./lib_inventario_canonico");

const INV = "inventario";
const ESTADOS_FUERA = new Set(["eliminada", "eliminado", "inactiva", "inactivo", "baja", "papelera"]);
const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const correoNorm = (v) => String(v || "").trim().toLowerCase();
const familia = (p) => { try { return invCanon.familiaPlataforma(p); } catch (_) { return cat.normPlataformaKey(p); } };
const ahoraIso = () => new Date().toISOString();

function perfilesDe(s = {}) { return Array.isArray(s.perfiles) && s.perfiles.length ? s.perfiles : [{ perfilId: s.perfilId || "", nombre: s.nombrePerfil || s.perfil || "", correo: s.correo || "", pin: s.pinPerfil || s.pin || "", inventarioId: s.inventarioId || "" }]; }
function cuentasDeCompra(s = {}) { // ids de Bodega que hoy ocupa la compra
  return [...new Set([s.cuentaInventarioId, ...perfilesDe(s).map((p) => p.inventarioId)].map((x) => String(x || "").trim()).filter(Boolean))];
}
// ¿Este ocupante de Bodega es de ESTA compra? (compraId; o legado sin compraId: mismo cliente, o mismo nombre del titular, en la cuenta actual)
function esPropio(x = {}, { compraId, clienteId, titular, esCuentaActual }) {
  const cx = String(x.compraId || "").trim();
  if (cx) return cx === String(compraId) && (!x.clienteId || String(x.clienteId) === String(clienteId));
  if (!esCuentaActual) return false;
  if (x.clienteId) return String(x.clienteId) === String(clienteId);
  return !!titular && norm(x.nombre) === norm(titular);
}
// Elegibilidad de una cuenta de Bodega para esta compra. Devuelve { ok, motivo }.
function evaluarCuenta(d = {}, { plataforma, compraId, clienteId, titular, cuentaActualIds = [] } = {}) {
  if (!d || !d.id) return { ok: false, motivo: "La cuenta no existe en Bodega." };
  if (familia(d.plataforma) !== familia(plataforma)) return { ok: false, motivo: "Esa cuenta es de otra plataforma." };
  if (ESTADOS_FUERA.has(norm(d.estado))) return { ok: false, motivo: "Esa cuenta está dada de baja." };
  if (!correoNorm(d.correo)) return { ok: false, motivo: "Esa cuenta no tiene correo." };
  if (d.exclusivaCompraId && String(d.exclusivaCompraId) !== String(compraId)) return { ok: false, motivo: "Esa cuenta ya es cuenta completa de otra compra." };
  const esCuentaActual = cuentaActualIds.includes(d.id);
  const otros = (Array.isArray(d.clientes) ? d.clientes : []).filter((x) => !esPropio(x, { compraId, clienteId, titular, esCuentaActual }));
  if (otros.length) return { ok: false, motivo: `Esa cuenta tiene ${otros.length} perfil(es) de otros clientes: no puede ser exclusiva (no se saca a nadie).` };
  return { ok: true, esCuentaActual };
}

async function leerInventarioPlataforma(db, plataforma) {
  let rows = [];
  try { rows = (await db.collection(INV).where("plataforma", "==", plataforma).get()).docs.map((d) => ({ id: d.id, ...(d.data() || {}) })); } catch (_) { rows = []; }
  if (!rows.length) {
    const f = familia(plataforma);
    rows = (await db.collection(INV).get()).docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).filter((r) => familia(r.plataforma) === f);
  }
  return rows;
}

// Cuentas elegibles (solo las válidas: sin perfiles de otros clientes y no exclusivas de otra compra). La actual primero.
async function cuentasElegibles(db, { plataforma, compra = {}, clienteId = "", titular = "", q = "" } = {}) {
  const plat = cat.normPlataformaKey(plataforma);
  if (!cat.puedeSerCuentaCompleta(plat)) throw new Error("Esa plataforma no se vende como cuenta completa.");
  const actuales = cuentasDeCompra(compra);
  const rows = await leerInventarioPlataforma(db, plat);
  // la cuenta que hoy usa la compra por correo (ventas viejas sin inventarioId)
  const corr = correoNorm(compra.correo);
  rows.forEach((r) => { if (corr && correoNorm(r.correo) === corr && !actuales.includes(r.id)) actuales.push(r.id); });
  const filtro = correoNorm(q);
  return rows
    .map((d) => ({ d, ev: evaluarCuenta(d, { plataforma: plat, compraId: compra.compraId, clienteId, titular, cuentaActualIds: actuales }) }))
    .filter(({ d, ev }) => ev.ok && (!filtro || correoNorm(d.correo).includes(filtro)))
    .map(({ d, ev }) => ({ id: d.id, correo: d.correo, capacidad: Number(d.capacidad || 0), ocupados: Array.isArray(d.clientes) ? d.clientes.length : 0, esCuentaActual: ev.esCuentaActual, tieneClave: !!String(d.clave || "").trim() && norm(d.clave) !== "sinclave" }))
    .sort((a, b) => (b.esCuentaActual - a.esCuentaActual) || (a.ocupados - b.ocupados) || a.correo.localeCompare(b.correo));
}

function recalcular(d, clientes) {
  const capacidad = Number(d.capacidad || d.total || 1) || 1;
  const cl = clientes.map((x, i) => ({ ...x, slot: i + 1 }));
  const ocupados = cl.length, disponibles = Math.max(0, capacidad - ocupados);
  return { clientes: cl, ocupados, disponibles, disp: disponibles, capacidad, sobreasignada: ocupados > capacidad, estado: disponibles === 0 ? "llena" : "activa" };
}

// Transacción por defecto (pruebas). El bot pasa mutarServiciosClienteTx (misma transacción + campos derivados de la ficha).
async function mutarSimple(db, clientId, mutador, extra) {
  const ref = db.collection("clientes").doc(String(clientId));
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref); if (!doc.exists) throw new Error("Cliente no encontrado.");
    if (extra && extra.leer) await extra.leer(tx);
    const cliente = doc.data() || {}; const servicios = (cliente.servicios || []).map((s) => ({ ...s }));
    const r = await mutador({ cliente: { ...cliente, servicios }, servicios, ref, tx });
    if (!r?.skipWrite) tx.set(ref, { servicios: r.servicios }, { merge: true });
    return r;
  });
}

/* Convierte la compra (por compraId) a cuenta completa con la cuenta inventarioId.
   opts: { clientId, compraId, plataforma, inventarioId, clave?, usuario }  deps: { mutar(clientId, mutador, extra) } */
async function convertir(db, { clientId, compraId, plataforma, inventarioId, clave = "", usuario = "" } = {}, deps = {}) {
  const plat = cat.normPlataformaKey(plataforma);
  if (!cat.puedeSerCuentaCompleta(plat)) throw new Error("Esa plataforma no se vende como cuenta completa.");
  if (!String(compraId || "").trim()) throw new Error("Falta la compra.");
  if (!String(inventarioId || "").trim()) throw new Error("Elija la cuenta: no se escoge ninguna sola.");
  // Cuentas que hoy ocupa la compra (se resuelven antes; se vuelven a leer dentro de la transacción)
  const cli = await db.collection("clientes").doc(String(clientId)).get();
  if (!cli.exists) throw new Error("Cliente no encontrado.");
  const s0 = ((cli.data() || {}).servicios || []).find((s) => String(s.compraId || "") === String(compraId));
  if (!s0) throw new Error("Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
  const actuales = cuentasDeCompra(s0);
  const platAntes = cat.normPlataformaKey(s0.plataforma);
  if (correoNorm(s0.correo)) {
    try { (await leerInventarioPlataforma(db, platAntes)).forEach((r) => { if (correoNorm(r.correo) === correoNorm(s0.correo) && !actuales.includes(r.id)) actuales.push(r.id); }); } catch (_) {}
  }
  const ids = [...new Set([String(inventarioId), ...actuales])];
  const mutar = deps.mutar || ((cid, m, e) => mutarSimple(db, cid, m, e));
  let res = null, docs = {}; // docs = lecturas de Bodega hechas DENTRO de la transacción (extra.leer), antes de escribir
  const r = await mutar(String(clientId), async ({ cliente, servicios, tx }) => {
    const idx = servicios.findIndex((s) => String(s.compraId || "") === String(compraId));
    if (idx < 0) throw new Error("Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
    const s = servicios[idx];
    const titular = String(perfilesDe(s)[0]?.nombre || cliente.nombrePerfil || cliente.nombre || "").trim();
    const destino = docs[String(inventarioId)];
    const ev = evaluarCuenta(destino, { plataforma: plat, compraId, clienteId: clientId, titular, cuentaActualIds: actuales });
    if (!ev.ok) throw new Error(ev.motivo);
    const clAntes = cat.clasificarServicio(s);
    const cuentaAntes = String(s.cuentaInventarioId || actuales[0] || "");
    if (clAntes.tipoVenta === "cuenta_completa" && cuentaAntes === destino.id && cat.normPlataformaKey(s.plataforma) === plat && destino.exclusivaCompraId === String(compraId)) {
      res = { yaEstaba: true, compraId, cuenta: { id: destino.id, correo: destino.correo } }; return { skipWrite: true, servicios };
    }
    const claveFinal = String(clave || "").trim() || (norm(destino.clave) !== "sinclave" ? String(destino.clave || "").trim() : "") || (correoNorm(s.correo) === correoNorm(destino.correo) ? String(s.clave || "").trim() : "");
    if (!claveFinal) throw new Error("Falta la clave de esa cuenta: escríbala para terminar.");
    const at = ahoraIso(), por = String(usuario || "").slice(0, 80);
    const perfiles = perfilesDe(s);
    const antes = { tipoVenta: clAntes.tipoVenta, categoria: clAntes.categoria, plataforma: s.plataforma || "", correo: s.correo || "", cuentaInventarioId: cuentaAntes, perfiles: perfiles.map((p) => ({ perfilId: p.perfilId || "", nombre: p.nombre || "", pin: p.pin || p.pinPerfil || "", correo: p.correo || "", inventarioId: p.inventarioId || "" })) };
    const p0 = { ...(perfiles[0] || {}), correo: destino.correo, clave: claveFinal, inventarioId: destino.id };
    delete p0.pin; delete p0.pinPerfil;
    const nuevo = { ...s, plataforma: plat, tipoVenta: "cuenta_completa", categoria: "cuentas_completas", correo: destino.correo, clave: claveFinal, sinPinPerfil: true, cuentaInventarioId: destino.id,
      perfiles: Array.isArray(s.perfiles) && s.perfiles.length ? [p0] : s.perfiles,
      modalidadAnterior: antes,
      historialModalidad: [...(Array.isArray(s.historialModalidad) ? s.historialModalidad : []), { de: clAntes.tipoVenta, a: "cuenta_completa", plataformaAntes: antes.plataforma, plataformaNueva: plat, cuentaAntes, cuentaAntesCorreo: antes.correo, cuentaNueva: destino.id, cuentaNuevaCorreo: destino.correo, por, at }].slice(-20),
      modalidadActualizadaAt: at, modalidadActualizadaPor: por };
    delete nuevo.pin; delete nuevo.pinPerfil;
    // Bodega: suelta la(s) cuenta(s) anterior(es) solo de ESTA compra; la elegida queda exclusiva con un solo ocupante.
    for (const id of ids) {
      const d = docs[id]; if (!d || id === destino.id) continue;
      const restantes = (d.clientes || []).filter((x) => !esPropio(x, { compraId, clienteId: clientId, titular, esCuentaActual: actuales.includes(id) }));
      const patch = { ...recalcular(d, restantes), updatedAt: at };
      if (String(d.exclusivaCompraId || "") === String(compraId)) Object.assign(patch, { exclusivaCompraId: null, exclusivaClienteId: null, modalidadVenta: null });
      tx.set(db.collection(INV).doc(id), patch, { merge: true });
    }
    const capacidad = Number(destino.capacidad || destino.total || 1) || 1;
    tx.set(db.collection(INV).doc(destino.id), {
      clientes: [{ nombre: titular, clienteId: String(clientId), compraId: String(compraId), perfilId: String(p0.perfilId || ""), slot: 1, cuentaCompleta: true }],
      ocupados: 1, disponibles: 0, disp: 0, capacidad, sobreasignada: false, estado: "llena", accountId: destino.id,
      modalidadVenta: "cuenta_completa", exclusivaCompraId: String(compraId), exclusivaClienteId: String(clientId), exclusivaDesde: at, updatedAt: at,
    }, { merge: true });
    servicios[idx] = nuevo;
    res = { compraId, antes: { tipoVenta: antes.tipoVenta, plataforma: antes.plataforma, correo: antes.correo, cuentaInventarioId: cuentaAntes, perfiles: perfiles.length },
      despues: { tipoVenta: "cuenta_completa", plataforma: plat, cuenta: { id: destino.id, correo: destino.correo } }, precio: s.precio, fechaRenovacion: s.fechaRenovacion, vendedor: s.vendedor || "" };
    return { servicios };
  }, { leer: async (tx) => { docs = {}; for (const id of ids) { const d = await tx.get(db.collection(INV).doc(id)); if (d.exists) docs[id] = { id, ...(d.data() || {}) }; } return { yaExiste: false }; } });
  return res || r;
}

// Etiqueta comercial por compra (la misma regla en bot, web y Control Maestro): lo GUARDADO manda; no se infiere por «1 perfil».
function etiquetaModalidad(s = {}) {
  const c = cat.clasificarServicio(s);
  if (c.tipoVenta === "cuenta_completa") return { codigo: "cuenta_completa", texto: "CUENTA COMPLETA" };
  if (c.tipoVenta === "perfil") return { codigo: "perfil", texto: "PERFIL" };
  return { codigo: c.tipoVenta, texto: (cat.CATEGORIAS[c.categoria]?.label || "Servicio").toUpperCase() };
}

module.exports = { evaluarCuenta, cuentasElegibles, convertir, etiquetaModalidad, cuentasDeCompra, esPropio };
