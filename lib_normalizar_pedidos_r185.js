"use strict";
// R185 · Normalización de pedidos ANTIGUOS realmente entregados (guía Portal de Socios, pág. 15).
// 1) Respaldo · 2) Alcance (corte) · 3) Simulación (dry-run con IDs) · 4) Migración idempotente solo de IDs revisados
// · 5) Reconciliación antes/después · 6) Reversión por lote. Nunca toca pagos, productos, montos ni fechas de venta.
// No manda avisos a los socios. Un pedido sin evidencia NO se marca: se lista como dudoso.

const CS = require("./lib_compra_socios");

const norm = (v) => String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
function ms(v) {
  if (v == null || v === "") return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (v._seconds) return v._seconds * 1000;
  if (v.seconds) return v.seconds * 1000;
  const s = String(v);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1], 12);
  return Date.parse(s) || 0;
}

// Categorías: aplicable = se puede marcar con evidencia del sistema; vistoBueno = solo con lista de IDs aprobada por Sublicuentas.
const CATEGORIAS = {
  entregas_publicadas: { aplicable: true, vistoBueno: false, motivo: "Todas las entregas del pedido están publicadas en el panel" },
  ficha_armada: { aplicable: true, vistoBueno: false, motivo: "El pago del pedido ya tiene su ficha de cliente armada en Finanzas" },
  historial_entregado: { aplicable: true, vistoBueno: true, motivo: "El historial dice Entregado pero el estado actual cambió" },
  cliente_con_servicio: { aplicable: true, vistoBueno: true, motivo: "El cliente del pedido tiene ese servicio activo/renovado con este socio después de la compra" },
  sin_evidencia: { aplicable: false, vistoBueno: true, motivo: "Sin evidencia de entrega en el sistema: revisar manualmente" },
  ya_entregado: { aplicable: false, vistoBueno: false, motivo: "Ya figura Entregado" },
  cancelado: { aplicable: false, vistoBueno: false, motivo: "Cancelado: no se toca" },
  posterior_al_corte: { aplicable: false, vistoBueno: false, motivo: "Pedido nuevo (después del corte): sigue con su estado real" },
};

function nombresDelPedido(c = {}) {
  const out = new Set();
  const cp = c.clientePrincipal || {};
  const full = `${cp.nombre || ""} ${cp.apellido || ""}`.trim();
  if (full) out.add(norm(full));
  if (c.cliente) out.add(norm(c.cliente));
  for (const p of Array.isArray(c.productos) ? c.productos : []) [p.clienteNombre, p.nombreCliente, p.perfil].forEach((n) => { if (n) out.add(norm(n)); });
  out.delete("");
  return out;
}
function serviciosDelPedido(c = {}) {
  const out = new Set();
  for (const p of Array.isArray(c.productos) ? c.productos : []) { const s = norm(p.servicioBase || p.servicio || ""); if (s) out.add(s.split(" · ")[0]); }
  if (!out.size && c.servicio) out.add(norm(c.servicio).split(" · ")[0]);
  return [...out];
}
function coincidePlataforma(svcPedido, plataforma) {
  const a = norm(svcPedido), b = norm(plataforma);
  if (!a || !b) return false;
  const claveA = a.split(" ")[0], claveB = b.split(" ")[0];
  return a.includes(b) || b.includes(a) || (claveA.length >= 3 && claveA === claveB);
}
function clienteConServicio(c, clientes, socioAliases) {
  const nombres = nombresDelPedido(c), svcs = serviciosDelPedido(c), creado = ms(c.createdAt);
  if (!nombres.size || !svcs.length || !creado) return null;
  const idPedido = String(c.clientePrincipal?.clienteId || "");
  for (const cl of clientes) {
    const nc = new Set([cl.nombre, cl.nombrePerfil, cl.nombre_norm].map(norm).filter(Boolean));
    const mismo = (idPedido && String(cl.id) === idPedido) || [...nombres].some((n) => nc.has(n));
    if (!mismo) continue;
    for (const s of Array.isArray(cl.servicios) ? cl.servicios : []) {
      const vend = norm(s.vendedor || s.vendedor_norm || cl.vendedor || cl.vendedor_norm || "");
      if (socioAliases.length && !socioAliases.includes(vend)) continue;
      const plat = s.plataforma || s.servicio || s.nombre || "";
      const vence = ms(s.fechaRenovacion || s.vencimiento || s.vence || s.fechaFin);
      if (svcs.some((x) => coincidePlataforma(x, plat)) && vence >= creado) return { clienteId: cl.id, plataforma: plat };
    }
  }
  return null;
}

function clasificar(id, c, { corteMs, movimientos = [], clientes = [] } = {}) {
  const estado = norm(c.estado || "pendiente");
  if (["entregado", "completado"].includes(estado)) return { categoria: "ya_entregado" };
  if (estado === "cancelado") return { categoria: "cancelado" };
  if (corteMs && ms(c.createdAt) >= corteMs) return { categoria: "posterior_al_corte" };
  const er = CS.entregaResumen(c);
  if (er.estado === "entregado") return { categoria: "entregas_publicadas", evidencia: `${er.publicados}/${er.requeridos} entregas publicadas` };
  const mov = movimientos.find((m) => String(m.pedidoId || m.compraId || "") === String(id) && m.tipo === "ingreso" && m.subtipo === "compra_socio" && m.fichaPendiente === false && !m.reversaDe && !m.estadoFinanciero);
  if (mov) return { categoria: "ficha_armada", evidencia: `movimiento ${mov.id || mov.movimientoId || ""}${mov.fichaListaPor ? ` · ficha por ${mov.fichaListaPor}` : ""}` };
  if ((c.estadoHistorial || []).some((h) => norm(h.estado) === "entregado")) return { categoria: "historial_entregado" };
  const socioAliases = [norm(c.socio_norm || c.socio || "")].filter(Boolean);
  if (socioAliases.includes("geisell")) socioAliases.push("geissel");
  const cs = clienteConServicio(c, clientes, socioAliases);
  if (cs) return { categoria: "cliente_con_servicio", evidencia: `cliente ${cs.clienteId} · ${cs.plataforma}` };
  return { categoria: "sin_evidencia" };
}

async function leerTodo(db, { socio = "" } = {}) {
  const q = socio ? db.collection("compras").where("socio_norm", "==", norm(socio)) : db.collection("compras");
  const [compras, movs, clientes] = await Promise.all([
    q.get(),
    db.collection("finanzas_movimientos").where("subtipo", "==", "compra_socio").get(),
    db.collection("clientes").get(),
  ]);
  return {
    compras: compras.docs.map((d) => ({ id: d.id, data: d.data() || {} })),
    movimientos: movs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })),
    clientes: clientes.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })),
  };
}

function resumenEstados(compras) {
  const porEstado = {}, porSocio = {};
  for (const { data } of compras) {
    const e = norm(data.estado || "pendiente") || "pendiente", s = norm(data.socio_norm || data.socio || "sin_socio") || "sin_socio";
    porEstado[e] = (porEstado[e] || 0) + 1;
    porSocio[s] = porSocio[s] || {}; porSocio[s][e] = (porSocio[s][e] || 0) + 1;
  }
  return { total: compras.length, porEstado, porSocio };
}

async function previsualizar(db, { corte, socio = "" } = {}) {
  const corteMs = corte ? ms(`${corte}T06:00:00Z`) : 0;
  if (!corteMs) throw new Error("Falta --corte=AAAA-MM-DD (fecha desde la que los pedidos se consideran nuevos).");
  const { compras, movimientos, clientes } = await leerTodo(db, { socio });
  const filas = compras.map(({ id, data }) => {
    const r = clasificar(id, data, { corteMs, movimientos, clientes });
    return { id, ref: id.slice(-6).toUpperCase(), socio: data.socio_norm || data.socio || "", estado: data.estado || "pendiente", creado: new Date(ms(data.createdAt) || 0).toISOString(),
      servicio: serviciosDelPedido(data).join(" + ") || data.servicio || "", cliente: [...nombresDelPedido(data)][0] || "", monto: Number(data.totalCombo || data.monto) || 0,
      categoria: r.categoria, motivo: CATEGORIAS[r.categoria].motivo, evidencia: r.evidencia || "", aplicable: CATEGORIAS[r.categoria].aplicable, requiereVistoBueno: CATEGORIAS[r.categoria].vistoBueno };
  });
  const porCategoria = {};
  filas.forEach((f) => { porCategoria[f.categoria] = (porCategoria[f.categoria] || 0) + 1; });
  return { modo: "preview", generado: new Date().toISOString(), corte, socio: socio || "todos", antes: resumenEstados(compras), porCategoria, filas };
}

// Solo IDs del preview revisado. Las categorías con visto bueno requieren lista de IDs explícita.
async function aplicar(db, preview, { categorias = ["entregas_publicadas", "ficha_armada"], ids = null, actor = "migracion-r185", lote = "" } = {}) {
  if (!preview || preview.modo !== "preview" || !Array.isArray(preview.filas)) throw new Error("Pase el archivo de preview generado con --preview.");
  const loteId = lote || `r185_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const idsSet = ids ? new Set(ids.map(String)) : null;
  const elegidos = preview.filas.filter((f) => f.aplicable && categorias.includes(f.categoria) && (!f.requiereVistoBueno || (idsSet && idsSet.has(f.id))) && (!idsSet || idsSet.has(f.id)));
  const respaldo = [], hechos = [], omitidos = [];
  for (const f of elegidos) {
    const ref = db.collection("compras").doc(f.id);
    const r = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { omitido: "no_existe" };
      const c = snap.data() || {};
      if (c.normalizacionR185) return { omitido: "ya_normalizado" };
      if (norm(c.estado || "pendiente") !== norm(f.estado)) return { omitido: `estado_cambio:${c.estado}` };
      const at = new Date().toISOString();
      const antes = { estado: c.estado || "pendiente", detalleEstado: c.detalleEstado || "", estadoUpdatedAt: c.estadoUpdatedAt || null };
      const entrada = { estado: "entregado", detalle: `Regularización de historial R185 · ${CATEGORIAS[f.categoria].motivo}`, at, por: actor };
      tx.update(ref, {
        estado: "entregado", detalleEstado: "Entregado (regularización de historial)", estadoUpdatedAt: at,
        estadoHistorial: [...(Array.isArray(c.estadoHistorial) ? c.estadoHistorial : []), entrada],
        normalizacionR185: { lote: loteId, categoria: f.categoria, motivo: CATEGORIAS[f.categoria].motivo, evidencia: f.evidencia || "", antes, at, actor },
      });
      tx.set(db.collection("auditoria_eventos").doc(), { actorUsuario: actor, rol: "sistema", origen: "migracion", modulo: "socios", accion: "normalizar_pedido_entregado", compraId: f.id, lote: loteId, antes: antes.estado, despues: "entregado", categoria: f.categoria, resultado: "ok", createdAt: at });
      return { antes };
    });
    if (r.omitido) omitidos.push({ id: f.id, motivo: r.omitido }); else { respaldo.push({ id: f.id, ...r.antes }); hechos.push(f.id); }
  }
  const despues = resumenEstados((await leerTodo(db, { socio: preview.socio === "todos" ? "" : preview.socio })).compras);
  return { modo: "apply", lote: loteId, aplicados: hechos.length, ids: hechos, omitidos, respaldo, antes: preview.antes, despues };
}

async function revertir(db, { lote, actor = "migracion-r185" } = {}) {
  if (!lote) throw new Error("Falta --lote=…");
  const snap = await db.collection("compras").get();
  const revertidos = [], omitidos = [];
  for (const d of snap.docs) {
    const c = d.data() || {};
    if (!c.normalizacionR185 || c.normalizacionR185.lote !== lote) continue;
    if (norm(c.estado) !== "entregado") { omitidos.push({ id: d.id, motivo: `estado_actual:${c.estado}` }); continue; }
    const a = c.normalizacionR185.antes || {};
    const at = new Date().toISOString();
    await d.ref.update({
      estado: a.estado || "pendiente", detalleEstado: a.detalleEstado || "", estadoUpdatedAt: a.estadoUpdatedAt || at,
      estadoHistorial: [...(c.estadoHistorial || []), { estado: a.estado || "pendiente", detalle: `Reversión de la regularización R185 (lote ${lote})`, at, por: actor }],
      normalizacionR185: { ...c.normalizacionR185, revertido: true, revertidoAt: at, lote: `${lote}_revertido` },
    });
    revertidos.push(d.id);
  }
  return { modo: "revert", lote, revertidos: revertidos.length, ids: revertidos, omitidos };
}

module.exports = { CATEGORIAS, clasificar, previsualizar, aplicar, revertir, resumenEstados, _norm: norm, _ms: ms };
