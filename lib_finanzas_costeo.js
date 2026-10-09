// lib_finanzas_costeo.js · R137 — GENERADO del mismo texto que HQ (api/_finanzas-costeo.js). No editar uno sin el otro.
// ============================================================================================================
// R137 · FINANCE OS · FASE 3 — COSTO DE VENTAS AUTOMÁTICO (idéntico en HQ y bot: se genera del mismo texto).
// Cada VENTA ya registrada (compra nueva, renovación, socios, o un ingreso manual) descuenta su inventario (PEPS: el
// lote más viejo primero) y guarda su COSTO DE VENTA, sin crear otra venta ni otro ingreso y sin tocar cómo se
// registra hoy. Corre solo (bot cada 10 min y al abrir 🏢 Empresa) y es idempotente: una venta se costea UNA vez.
//  · Cuenta madre / panel / gift card: el lote está en perfiles-mes (Netflix L377 ÷ 7 = L53.86 por perfil al mes).
//  · Si al vencer el lote quedan perfiles sin vender, ese costo sale como "Cupos sin vender" (pérdida del mes).
//  · Créditos/links/unidades vencidos sin usar salen como "Vencimiento de inventario".
//  · Venta anulada → se devuelve lo consumido al lote y el costo se anula con su reversa (no se borra nada).
//  · Venta sin inventario cargado → queda "pendiente de costo" y se completa sola cuando se registre la compra.
// ============================================================================================================
const CUENTA_MADRE_LIKE = ["cuenta_madre", "panel", "gift_card"];
const m2 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const m6 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0; };
const limpio = (v, max = 120) => String(v ?? "").replace(/[⭐★☆✨]|\uD83C[\uDF1F\uDF20]|️/g, "").replace(/\s+/g, " ").trim().slice(0, max);

// Cuántos perfiles-mes trae una compra de cuenta madre/panel/gift card (cuentas × capacidad × meses).
function cuposMesDe(producto = {}, cuentas = 1, duracionDias) {
  const dur = Number(duracionDias ?? producto.duracionDias) || 30;
  const meses = Math.max(1, Math.round(dur / 30));
  return m6(Number(cuentas || 1) * Math.max(1, Number(producto.capacidad) || 1) * meses);
}
// Separa "Netflix + Disney, Spotify" en servicios.
function serviciosDeTexto(t) { return String(t || "").split(/\s*(?:\+|,|\/|\by\b|&)\s*/i).map((x) => limpio(x, 60)).filter(Boolean); }
// Unidades de una venta: [{servicio, cantidad, ingresoHnl}].
function unidadesDeVenta(v = {}) {
  const total = m2(v.monto);
  let us = [];
  if (Array.isArray(v.productosSocio) && v.productosSocio.length) us = v.productosSocio.map((p) => ({ servicio: limpio(p?.servicio || p?.plataforma || v.plataforma, 60), cantidad: Math.max(1, Math.round(Number(p?.cantidad) || 1)), precio: Number(p?.precio || p?.precioUnitario || 0) }));
  else if (Array.isArray(v.servicios) && v.servicios.length) us = v.servicios.map((s) => ({ servicio: limpio(s?.plataforma || s?.servicio, 60), cantidad: 1, precio: Number(s?.precio || s?.monto || 0) }));
  else us = serviciosDeTexto(v.plataforma).map((s) => ({ servicio: s, cantidad: 1, precio: 0 }));
  us = us.filter((u) => u.servicio);
  if (!us.length) return [];
  const conPrecio = us.every((u) => u.precio > 0) && Math.abs(us.reduce((a, u) => a + u.precio * u.cantidad, 0) - total) < 1;
  const n = us.reduce((a, u) => a + u.cantidad, 0);
  let resto = total;
  return us.map((u, i) => { const ing = i === us.length - 1 ? m2(resto) : m2(conPrecio ? u.precio * u.cantidad : (total * u.cantidad) / n); resto = m2(resto - ing); return { servicio: u.servicio, cantidad: u.cantidad, ingresoHnl: ing }; });
}
// ¿Qué producto financiero es este servicio? Por la plataforma del bot; si hay varios, decide el texto y luego el stock.
function productoDeServicio(servicio, productos = [], lotes = [], normPlataformaKey) {
  const key = normPlataformaKey ? normPlataformaKey(servicio) : "";
  const raw = String(servicio || "").toLowerCase();
  let cands = productos.filter((p) => p.activo !== false && p.plataformaKey && (p.plataformaKey === key || (key && p.plataformaKey.replace(/-/g, "") === key)));
  if (!cands.length) cands = productos.filter((p) => p.activo !== false && p.nombre && limpio(p.nombre).toLowerCase() === limpio(servicio).toLowerCase());
  if (cands.length <= 1) return cands[0] || null;
  const porTexto = cands.filter((p) => {
    const n = String(p.nombre || "").toLowerCase(), sku = String(p.sku || p.id || "").toLowerCase();
    if (/platinum/.test(raw)) return /plat/.test(n + sku);
    if (/\blink\b/.test(raw)) return p.modelo === "link";
    const d = raw.match(/(\d)\s*(?:disp|pant|dev)?/); if (d && /\d/.test(sku)) return sku.includes(d[1]);
    return false;
  });
  if (porTexto.length === 1) return porTexto[0];
  const pool = porTexto.length ? porTexto : cands;
  // Variantes por número (Oleada 1/3): si el texto no dice cuántos, es la de 1.
  if (pool.every((p) => /\d/.test(String(p.sku || p.id || "")))) return pool.find((p) => /-1$/.test(String(p.sku || p.id || ""))) || pool[0];
  const conStock = pool.filter((p) => lotes.some((l) => l.productoId === p.id && m6(l.disponible) > 0));
  return conStock[0] || pool[0];
}
// Consumo PEPS para una fecha de venta: primero lotes comprados hasta esa fecha (más viejo primero), luego posteriores.
function consumirLotes(lotes = [], cantidad, fechaVenta) {
  let falta = m6(cantidad);
  const vivo = (l) => m6(l.disponible) > 0 && l.estado !== "vencido" && (!l.vigenciaHasta || l.vigenciaHasta >= fechaVenta);
  const orden = (a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.id).localeCompare(String(b.id));
  const antes = lotes.filter((l) => vivo(l) && String(l.fecha) <= fechaVenta).sort(orden), despues = lotes.filter((l) => vivo(l) && String(l.fecha) > fechaVenta).sort(orden);
  const consumos = [];
  for (const l of [...antes, ...despues]) {
    if (falta <= 0) break;
    const toma = m6(Math.min(falta, m6(l.disponible)));
    consumos.push({ loteId: l.id, cantidad: toma, costoUnitarioHnl: m6(l.costoUnitarioHnl), costoHnl: m2(toma * (l.costoUnitarioHnl || 0)) });
    l.disponible = m6(l.disponible - toma); l.consumido = m6((l.consumido || 0) + toma);
    falta = m6(falta - toma);
  }
  return { consumos, costoHnl: m2(consumos.reduce((s, c) => s + c.costoHnl, 0)), faltante: falta > 0 ? falta : 0 };
}
// Plan de costo para UNA venta (puro). lineasPrevias: para completar una venta que quedó pendiente.
function planCostoVenta(venta, { productos = [], variantes = [], lotes = [], normPlataformaKey = null, lineasPrevias = null } = {}) {
  const fecha = venta.fecha;
  const base = lineasPrevias || unidadesDeVenta(venta).map((u) => ({ ...u, productoId: "", consumos: [], costoHnl: 0, faltante: 0, pendiente: true }));
  const lineas = base.map((ln) => {
    if (!ln.pendiente && !(ln.faltante > 0)) return ln;
    const p = ln.productoId ? productos.find((x) => x.id === ln.productoId) : productoDeServicio(ln.servicio, productos, lotes, normPlataformaKey);
    if (!p) return { ...ln, productoId: "", sinProducto: true, pendiente: true };
    if (p.modelo === "costo_cero") return { ...ln, productoId: p.id, producto: p.nombre, consumos: [], costoHnl: 0, faltante: 0, pendiente: false, sinProducto: false };
    const d = String(ln.servicio).match(/(\d)\s*(?:disp|pant|dev|perf)/i);
    const vr = variantes.filter((v) => v.productoId === p.id && v.activo !== false);
    const vv = (d && vr.find((v) => Number(v.dispositivos) === Number(d[1]))) || vr[0];
    const consumoUnidad = vv && Number(vv.consumo) >= 0 && vv.consumo !== undefined ? Number(vv.consumo) : 1;
    const necesita = ln.faltante > 0 ? ln.faltante : m6(ln.cantidad * consumoUnidad);
    const c = consumirLotes(lotes.filter((l) => l.productoId === p.id), necesita, fecha);
    return { ...ln, productoId: p.id, producto: p.nombre, varianteId: vv?.id || "", consumos: [...(ln.consumos || []), ...c.consumos], costoHnl: m2((ln.costoHnl || 0) + c.costoHnl), faltante: c.faltante, pendiente: c.faltante > 0, sinProducto: false, costoAgregadoHnl: c.costoHnl };
  });
  const costoHnl = m2(lineas.reduce((s, l) => s + (l.costoHnl || 0), 0));
  const estado = lineas.some((l) => l.sinProducto) ? "sin_producto" : lineas.some((l) => l.faltante > 0) ? "pendiente" : "completo";
  return { lineas, costoHnl, estado, costoNuevoHnl: m2(lineas.reduce((s, l) => s + (l.costoAgregadoHnl || 0), 0)) };
}
// ¿Esta venta cuenta? Devuelve las ventas a costear desde la fecha, sin duplicar con los cobros.
function ventasACostear(movs = [], desde, R, opts = {}) {
  const porId = new Map(movs.map((m) => [m.id, m]));
  const out = [];
  for (const m of movs) {
    const f = R.movementYmd(m); if (!f || f < desde) continue;
    if (m.reversaDe) continue;
    if (String(m.tipo) === "venta") {
      const cobro = porId.get(String(m.id).replace(/_venta$/, "_cobro"));
      const anulada = m.estadoFinanciero === "anulado" || (cobro && cobro.estadoFinanciero === "anulado" && !(m2(m.saldoPendiente) > 0));
      out.push({ ...m, fecha: f, origenVenta: "venta", anulada: !!anulada });
    } else if (R.movementKind(m) === "ingreso") {
      // Ingreso manual = venta sin ficha. Se salta lo que ya tiene su "venta" (cobros de compra/renovación/socios),
      // los abonos de pendientes y los sustitutos de una corrección (el costo se quedó en el original).
      const id = String(m.id);
      if (/_cobro($|_)/.test(id) || m.operacionId || m.cuentaId || /^cobro_pendiente/.test(String(m.subtipo || ""))) continue;
      if (opts.paraIngresos) { // R140 · para Resultados: cuenta el ingreso vigente (el sustituto de una corrección sí, el original corregido no), con o sin servicio
        if (m.estadoFinanciero === "corregido") continue;
        out.push({ ...m, fecha: f, origenVenta: "ingreso", anulada: m.estadoFinanciero === "anulado" }); continue;
      }
      if (m.sustituyeA) continue; // el costo se quedó con el original
      if (!limpio(m.plataforma)) continue; // sin servicio no hay qué descontar
      out.push({ ...m, fecha: f, origenVenta: "ingreso", anulada: m.estadoFinanciero === "anulado" });
    }
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.id).localeCompare(String(b.id)));
}
// Lotes vencidos con saldo: perfiles sin vender (cuenta madre/panel/gift) o vencimiento (créditos, links, unidades).
function vencimientosPendientes(lotes = [], hoy) {
  return lotes.filter((l) => l.vigenciaHasta && l.vigenciaHasta < hoy && m6(l.disponible) > 0 && l.estado !== "vencido").map((l) => ({
    loteId: l.id, productoId: l.productoId, producto: l.producto, fecha: l.vigenciaHasta, cantidad: m6(l.disponible), montoHnl: m2(m6(l.disponible) * (l.costoUnitarioHnl || 0)),
    subtipo: CUENTA_MADRE_LIKE.includes(l.modelo) ? "cupos_sin_vender" : "vencido",
  }));
}

// ---------------------------------------------------------------- runner (Firestore admin; misma API en HQ y bot)
// deps: { R, normPlataformaKey, leerMovimientos(desdeYmd), hoy, actor, limite }
async function correrCosteo(db, deps) {
  const { R, normPlataformaKey, leerMovimientos, hoy, actor = "sistema", limite = 250 } = deps;
  const cfgRef = db.collection("finanzas_config").doc("costeo");
  const cfgSnap = await cfgRef.get();
  const cfg = cfgSnap.exists ? cfgSnap.data() || {} : {};
  if (!cfg.desde || cfg.activo === false) return { activo: false, motivo: "Costeo apagado: elija desde qué fecha empieza." };
  const osSnap = await db.collection("finanzas_config").doc("finance_os").get(); // R139: pausa general de Finance OS
  if (osSnap.exists && (osSnap.data() || {}).activo === false) return { activo: false, motivo: "Finance OS en pausa." };
  const todos = async (c) => (await db.collection(c).get()).docs.map((x) => ({ id: x.id, ...(x.data() || {}) }));
  const [productos, variantes, consumosArr, movs] = await Promise.all([todos("fin_productos"), todos("fin_variantes"), todos("fin_consumos"), leerMovimientos(cfg.desde)]);
  const consumos = new Map(consumosArr.map((c) => [c.id, c]));
  const ventas0 = ventasACostear(movs, cfg.desde, R);
  // R140 · Primero las ventas nuevas y las anuladas; los reintentos (pendientes/sin producto) al final y solo si algo cambió.
  const lotesFoto = await todos("fin_lotes");
  const puedeCambiar = (v, prev) => {
    const copia = lotesFoto.map((l) => ({ ...l }));
    const plan = planCostoVenta(v, { productos, variantes, lotes: copia, normPlataformaKey, lineasPrevias: prev.lineas || null });
    return plan.costoNuevoHnl > 0 || plan.estado !== prev.estado || plan.lineas.some((l, i) => !!l.sinProducto !== !!((prev.lineas || [])[i] || {}).sinProducto);
  };
  const ventas = [...ventas0.filter((v) => !consumos.has(v.id) || v.anulada), ...ventas0.filter((v) => consumos.has(v.id) && !v.anulada)];
  const stats = { costeadas: 0, completadas: 0, revertidas: 0, pendientes: 0, sinProducto: 0, vencimientos: 0, costoHnl: 0 };
  let hechas = 0;
  const ahora = new Date().toISOString();
  const movBase = (fecha) => { const [y, mo, d] = fecha.split("-"); return { fecha: `${d}/${mo}/${y}`, fechaPago: fecha, mesKey: `${y}-${mo}`, monthKey: `${y}-${mo}`, fechaTS: new Date(Date.UTC(+y, +mo - 1, +d, 12)), registradoPor: actor, origenCanal: "sistema", createdAt: ahora, updatedAt: ahora }; };
  for (const v of ventas) {
    if (hechas >= limite) break;
    const prev = consumos.get(v.id);
    const necesitaRevertir = v.anulada && prev && prev.estado !== "revertido";
    let necesitaCostear = !v.anulada && (!prev || ["pendiente", "sin_producto"].includes(prev.estado));
    if (necesitaCostear && prev && !puedeCambiar(v, prev)) necesitaCostear = false; // nada nuevo: no gasta turno
    // R140 · Si cambiaron la fecha de la venta después de costearla, el costo se mueve con ella (mismo mes).
    if (!v.anulada && prev && prev.estado !== "revertido" && prev.fecha && prev.fecha !== v.fecha) {
      await db.runTransaction(async (tx) => {
        const ms = await Promise.all((prev.movimientos || []).map((mid) => tx.get(db.collection("finanzas_movimientos").doc(mid))));
        const f = movBase(v.fecha);
        ms.forEach((x, k) => { if (x.exists) tx.set(db.collection("finanzas_movimientos").doc(prev.movimientos[k]), { fecha: f.fecha, fechaPago: f.fechaPago, mesKey: f.mesKey, monthKey: f.monthKey, fechaTS: f.fechaTS, updatedAt: ahora }, { merge: true }); });
        tx.set(db.collection("fin_consumos").doc(v.id), { fecha: v.fecha, mesKey: v.fecha.slice(0, 7), actualizadoAt: ahora }, { merge: true });
      });
      stats.movidas = (stats.movidas || 0) + 1;
    }
    if (!necesitaRevertir && !necesitaCostear) continue;
    hechas++;
    const r = await db.runTransaction(async (tx) => {
      const cRef = db.collection("fin_consumos").doc(v.id);
      const cSnap = await tx.get(cRef); const actual = cSnap.exists ? cSnap.data() : null;
      if (necesitaRevertir) {
        if (!actual || actual.estado === "revertido") return null;
        const ids = [...new Set((actual.lineas || []).flatMap((l) => (l.consumos || []).map((c) => c.loteId)))];
        // Firestore: todas las lecturas antes de cualquier escritura.
        const lSnaps = await Promise.all(ids.map((id) => tx.get(db.collection("fin_lotes").doc(id))));
        const mSnaps = await Promise.all((actual.movimientos || []).map((mid) => tx.get(db.collection("finanzas_movimientos").doc(mid))));
        const devolver = {}; (actual.lineas || []).forEach((l) => (l.consumos || []).forEach((c) => { devolver[c.loteId] = m6((devolver[c.loteId] || 0) + c.cantidad); }));
        lSnaps.forEach((s, i) => {
          if (!s.exists) return; const l = s.data(), u = devolver[ids[i]];
          if (l.estado === "vencido") { // R140 · el lote ya venció: lo devuelto se da de baja de una vez (no queda inventario fantasma)
            tx.set(db.collection("fin_lotes").doc(ids[i]), { consumido: m6((l.consumido || 0) - u), vencidoSinUsar: m6((l.vencidoSinUsar || 0) + u), updatedAt: ahora }, { merge: true });
            const vid = `venc_${ids[i]}_r_${String(v.id).slice(-24)}`;
            tx.set(db.collection("finanzas_movimientos").doc(vid), { ...movBase(hoy), movimientoId: vid, tipo: "inventario", subtipo: CUENTA_MADRE_LIKE.includes(l.modelo) ? "cupos_sin_vender" : "vencido", loteId: ids[i], productoId: l.productoId, cantidad: -u, monto: m2(u * (l.costoUnitarioHnl || 0)), banco: "Inventario", motivo: `Devuelto de venta anulada a lote vencido · ${l.producto}` });
          } else tx.set(db.collection("fin_lotes").doc(ids[i]), { disponible: m6(l.disponible + u), consumido: m6((l.consumido || 0) - u), estado: "activo", updatedAt: ahora }, { merge: true });
        });
        for (let k = 0; k < mSnaps.length; k++) {
          const mSnap = mSnaps[k], mid = actual.movimientos[k]; if (!mSnap.exists) continue;
          const mm = mSnap.data();
          tx.set(db.collection("finanzas_movimientos").doc(mid), { estadoFinanciero: "anulado", anuladoPor: actor, anuladoAt: ahora, motivoAnulacion: "Venta anulada: el inventario vuelve al lote" }, { merge: true });
          tx.set(db.collection("finanzas_movimientos").doc(`${mid}_rev`), { ...mm, ...movBase(hoy), movimientoId: `${mid}_rev`, monto: -m2(mm.monto), reversaDe: mid, estadoFinanciero: "" });
        }
        tx.set(cRef, { estado: "revertido", revertidoAt: ahora }, { merge: true });
        return { revertida: true };
      }
      if (actual && !["pendiente", "sin_producto"].includes(actual.estado)) return null;
      const lotesSnap = await tx.get(db.collection("fin_lotes"));
      const lotes = (lotesSnap.docs || []).map((x) => ({ id: x.id, ...(x.data() || {}) }));
      const antes = new Map(lotes.map((l) => [l.id, m6(l.disponible)]));
      const plan = planCostoVenta(v, { productos, variantes, lotes, normPlataformaKey, lineasPrevias: actual ? actual.lineas : null });
      for (const l of lotes) if (m6(l.disponible) !== antes.get(l.id)) tx.set(db.collection("fin_lotes").doc(l.id), { disponible: m6(l.disponible), consumido: m6(l.consumido), estado: m6(l.disponible) > 0 ? "activo" : "agotado", updatedAt: ahora }, { merge: true });
      const movimientos = [...((actual && actual.movimientos) || [])];
      if (plan.costoNuevoHnl > 0) {
        const mid = `${v.id}_cv${movimientos.length ? `_${movimientos.length + 1}` : ""}`;
        tx.set(db.collection("finanzas_movimientos").doc(mid), { ...movBase(v.fecha), movimientoId: mid, tipo: "costo_venta", subtipo: v.origenVenta === "venta" ? "costo_venta" : "costo_venta_manual", monto: plan.costoNuevoHnl, ventaId: v.id, clienteNombre: v.clienteNombre || v.detalle || "", plataforma: limpio(v.plataforma), productoIds: [...new Set(plan.lineas.map((l) => l.productoId).filter(Boolean))], banco: "Inventario", motivo: `Costo de venta · ${limpio(v.plataforma, 60)}` });
        movimientos.push(mid);
      }
      tx.set(cRef, { ventaId: v.id, origenVenta: v.origenVenta, fecha: v.fecha, mesKey: v.fecha.slice(0, 7), clienteNombre: v.clienteNombre || v.detalle || "", plataforma: limpio(v.plataforma), ventaHnl: m2(v.monto), lineas: plan.lineas.map(({ costoAgregadoHnl, ...l }) => l), costoHnl: plan.costoHnl, utilidadBrutaHnl: m2(m2(v.monto) - plan.costoHnl), estado: plan.estado, movimientos, actualizadoAt: ahora, ...(actual ? {} : { creadoAt: ahora }) });
      return { costo: plan.costoNuevoHnl, estado: plan.estado, nuevo: !actual };
    });
    if (!r) continue;
    if (r.revertida) stats.revertidas++;
    else { if (r.nuevo) stats.costeadas++; else if (r.estado === "completo") stats.completadas++; if (r.estado === "pendiente") stats.pendientes++; if (r.estado === "sin_producto") stats.sinProducto++; stats.costoHnl = m2(stats.costoHnl + r.costo); }
  }
  // Vencimientos: perfiles sin vender / créditos vencidos → pérdida del mes, el lote queda en 0 y "vencido".
  const lotesTodos = await todos("fin_lotes");
  for (const vto of vencimientosPendientes(lotesTodos, hoy)) {
    const mid = `venc_${vto.loteId}`;
    const ok = await db.runTransaction(async (tx) => {
      const lRef = db.collection("fin_lotes").doc(vto.loteId); const s = await tx.get(lRef);
      const ya = await tx.get(db.collection("finanzas_movimientos").doc(mid));
      if (!s.exists || ya.exists) return false; const l = s.data();
      if (l.estado === "vencido" || !(m6(l.disponible) > 0)) return false;
      const monto = m2(m6(l.disponible) * (l.costoUnitarioHnl || 0));
      tx.set(lRef, { disponible: 0, vencidoSinUsar: m6(l.disponible), estado: "vencido", updatedAt: ahora }, { merge: true });
      tx.set(db.collection("finanzas_movimientos").doc(mid), { ...movBase(vto.fecha), movimientoId: mid, tipo: "inventario", subtipo: vto.subtipo, loteId: vto.loteId, productoId: vto.productoId, cantidad: -m6(l.disponible), monto, banco: "Inventario", motivo: `${vto.subtipo === "cupos_sin_vender" ? "Cupos sin vender" : "Vencimiento de inventario"} · ${l.producto} · ${m6(l.disponible)} ${l.unidad || ""}`.trim() });
      return true;
    });
    if (ok) stats.vencimientos++;
  }
  await cfgRef.set({ ultimaCorrida: ahora, ultimoResultado: stats }, { merge: true });
  return { activo: true, desde: cfg.desde, ...stats };
}
module.exports = { cuposMesDe, serviciosDeTexto, unidadesDeVenta, productoDeServicio, consumirLotes, planCostoVenta, ventasACostear, vencimientosPendientes, correrCosteo, CUENTA_MADRE_LIKE };
