"use strict";
/* SUBLICUENTAS · Bot · R196q — «Cambiar plataforma» de una compra existente → «🔐 Cuentas completas».
   PDF «Cuenta completa · cambio de plataforma · Control Maestro» (14/11/2026). Mismo flujo de edición que ya existe:
     CRM → Editar servicios → compra → 📌 Cambiar plataforma → 🔐 Cuentas completas → plataforma
       → solo las cuentas de Bodega VÁLIDAS de esa plataforma (sin perfiles de otros clientes; la actual primero; buscador)
       → [la clave, solo si Bodega no la tiene] → Vista previa (antes / después; precio, fecha y vendedor se mantienen)
       → [✅ Confirmar] [✖️ Cancelar] → lib_cuenta_completa.convertir (UNA transacción, misma compra, sin venta nueva).
   Perfiles, TV Digital, Música y Software siguen igual (index_03 · kbCategoriasWiz). La clave nunca va a auditoría. */

const { db } = require("./index_01_core");
const { pending, upsertPanel, logErr } = require("./index_02_utils_roles");
const L = require("./lib_cuenta_completa");
const cat = require("./lib_catalogo_categorias");

const crm = () => require("./index_03_clientes_crm");
const MAX_LISTA = 8;
const esc = (s) => String(s == null ? "" : s).replace(/([_*`\[])/g, "\\$1");
const lps = (n) => `L${Number(n || 0).toFixed(2).replace(/\.00$/, "")}`;
const k = (chatId) => String(chatId);
const volver = (st) => [{ text: "✖️ Cancelar", callback_data: `cli:serv:menu:${st.clientId}:${st.compraSel}` }];

async function compraDe(st) {
  const c = await crm().getCliente(st.clientId);
  if (!c) throw new Error("Cliente no encontrado.");
  const s = (Array.isArray(c.servicios) ? c.servicios : []).find((x) => String(x.compraId || "") === String(st.compraId));
  if (!s) throw new Error("Esa compra cambió o ya no existe. Abra nuevamente la ficha.");
  const titular = String((Array.isArray(s.perfiles) && s.perfiles[0]?.nombre) || c.nombrePerfil || c.nombre || "").trim();
  return { c, s, titular };
}
const nombrePlat = (p) => { try { return crm().humanPlataforma(p); } catch (_) { return p; } };

// Paso 2/3 · ccsel:set:<plat> (sale de la categoría 🔐 Cuentas completas dentro de Cambiar plataforma)
async function iniciar(chatId, plat) {
  const ctx = pending.get(k(chatId));
  if (!ctx || ctx.mode !== "cliServSelectPlat" || !ctx.compraId) return upsertPanel(chatId, "⚠️ El cambio de plataforma venció. Abra nuevamente la ficha del servicio.", []);
  if (!cat.puedeSerCuentaCompleta(plat)) return upsertPanel(chatId, "⚠️ Esa plataforma no se vende como cuenta completa.", [volver(ctx)]);
  const st = { mode: "ccConvElegir", clientId: ctx.clientId, compraSel: ctx.compraSel, compraId: ctx.compraId, plat: cat.normPlataformaKey(plat), q: "", lista: [], at: Date.now() };
  pending.set(k(chatId), st);
  return listar(chatId, st);
}

async function listar(chatId, st, aviso = "") {
  const { s, titular } = await compraDe(st);
  const todas = await L.cuentasElegibles(db, { plataforma: st.plat, compra: s, clienteId: st.clientId, titular, q: st.q });
  st.lista = todas.slice(0, MAX_LISTA).map((x) => ({ id: x.id, correo: x.correo, tieneClave: x.tieneClave, esCuentaActual: x.esCuentaActual }));
  st.mode = "ccConvElegir"; pending.set(k(chatId), st);
  const actual = L.etiquetaModalidad(s);
  let txt = `🔐 *Cambiar a cuenta completa · ${esc(nombrePlat(st.plat))}*\n` +
    `Compra actual: ${esc(nombrePlat(s.plataforma))} · ${esc(actual.texto)} · ${esc(lps(s.precio))} · vence ${esc(s.fechaRenovacion || "-")}\n\n` +
    `Tipo de entrega: *Cuenta completa*\n`;
  if (aviso) txt += `\n${aviso}\n`;
  if (st.q) txt += `🔎 Búsqueda: ${esc(st.q)}\n`;
  if (!todas.length) {
    txt += `\nNo hay cuentas de ${esc(nombrePlat(st.plat))} válidas en Bodega${st.q ? " con esa búsqueda" : ""}.\nUna cuenta con perfiles de otros clientes no puede ser exclusiva (no se saca a nadie).`;
  } else {
    txt += `\nElija la cuenta de Bodega (solo las que no tienen perfiles de otros clientes):`;
    if (todas.length > MAX_LISTA) txt += `\n_Hay ${todas.length}; se muestran ${MAX_LISTA}. Busque por correo para ver otras._`;
  }
  const kb = st.lista.map((x, i) => [{ text: `${x.esCuentaActual ? "⭐ " : ""}${x.correo}${x.esCuentaActual ? " (la actual)" : ""}`, callback_data: `ccv:c:${i}` }]);
  kb.push([{ text: "🔎 Buscar por correo", callback_data: "ccv:q" }]);
  kb.push(volver(st));
  return upsertPanel(chatId, txt, kb);
}

async function vistaPrevia(chatId, st) {
  const { c, s } = await compraDe(st);
  const actual = L.etiquetaModalidad(s);
  const n = Array.isArray(s.perfiles) && s.perfiles.length ? s.perfiles.length : 1;
  st.tok = Date.now().toString(36); st.mode = "ccConvConfirmar"; pending.set(k(chatId), st);
  const txt = `🔐 *Vista previa · cambiar a cuenta completa*\n\n` +
    `👤 Cliente: ${esc(c.nombrePerfil || c.nombre || "-")}\n` +
    `*Antes:* ${esc(nombrePlat(s.plataforma))} · ${esc(actual.texto)} · ${esc(s.correo || "sin correo")}${actual.codigo === "perfil" ? ` · ${n} perfil(es)` : ""}\n` +
    `*Después:* ${esc(nombrePlat(st.plat))} · *CUENTA COMPLETA* · ${esc(st.elegida.correo)} (exclusiva, sin PIN)\n\n` +
    `Se mantienen: precio ${esc(lps(s.precio))} · vence ${esc(s.fechaRenovacion || "-")} · vendedor ${esc(s.vendedor || c.vendedor || "-")}\n` +
    `Es la misma compra: no se crea venta nueva ni otra renovación.`;
  return upsertPanel(chatId, txt, [[{ text: "✅ Confirmar", callback_data: `ccv:ok:${st.tok}` }, { text: "✖️ Cancelar", callback_data: `cli:serv:menu:${st.clientId}:${st.compraSel}` }]]);
}

// Callbacks ccv:* (el control de acceso es el mismo de Editar servicios: este módulo se llama desde ese bloque de index_06)
async function tryCallback(q, { auditar } = {}) {
  const data = String(q.data || ""); const chatId = q.message?.chat?.id;
  if (data.startsWith("ccsel:set:")) { await iniciar(chatId, data.split(":")[2]); return true; }
  if (!data.startsWith("ccv:")) return false;
  const st = pending.get(k(chatId));
  if (!st || !String(st.mode || "").startsWith("ccConv")) { await upsertPanel(chatId, "⚠️ El cambio venció. Abra nuevamente la ficha del servicio.", []); return true; }
  const p = data.split(":");
  try {
    if (p[1] === "q") { st.mode = "ccConvBuscar"; pending.set(k(chatId), st); await upsertPanel(chatId, "🔎 Escriba parte del correo de la cuenta:", [volver(st)]); return true; }
    if (p[1] === "c") {
      const x = st.lista[Number(p[2])]; if (!x) return listar(chatId, st, "⚠️ Esa opción cambió. Elija otra vez."), true;
      st.elegida = x;
      const { s } = await compraDe(st);
      const mismaCuenta = String(s.correo || "").trim().toLowerCase() === String(x.correo || "").trim().toLowerCase() && String(s.clave || "").trim();
      if (!x.tieneClave && !mismaCuenta) { st.mode = "ccConvClave"; pending.set(k(chatId), st); await upsertPanel(chatId, `🔑 Bodega no tiene la clave de ${esc(x.correo)}.\nEscríbala (solo se guarda en esta compra y en la cuenta):`, [volver(st)]); return true; }
      await vistaPrevia(chatId, st); return true;
    }
    if (p[1] === "ok") {
      if (st.mode !== "ccConvConfirmar" || st.tok !== p[2]) { await upsertPanel(chatId, "Eso ya se hizo o venció. Abra nuevamente la ficha del servicio.", []); return true; }
      pending.delete(k(chatId)); // un solo toque
      const usuario = `tg:${q.from?.id || ""}${q.from?.username ? "@" + q.from.username : ""}`;
      const r = await L.convertir(db, { clientId: st.clientId, compraId: st.compraId, plataforma: st.plat, inventarioId: st.elegida.id, clave: st.clave || "", usuario }, { mutar: crm().mutarServiciosClienteTx });
      try { require("./index_01_core").cacheInvalidatePrefix?.(`clientes:doc:${st.clientId}`); } catch (_) {}
      if (!r.yaEstaba) {
        try { await crm().registrarEventoHistorial(st.clientId, { tipo: "modalidad_cambiada", descripcion: `${r.antes.tipoVenta === "perfil" ? "Perfil" : r.antes.tipoVenta} → Cuenta completa (${r.despues.cuenta.correo})`, compraId: st.compraId, plataforma: st.plat, correo: r.despues.cuenta.correo, modalidadAnterior: r.antes.tipoVenta, modalidadNueva: "cuenta_completa", cuentaAnterior: r.antes.correo, cuentaNueva: r.despues.cuenta.correo, operador: usuario }); } catch (e) { logErr("cc.historial", e); }
        try { if (auditar) await auditar("cambiar_modalidad", { clienteId: st.clientId, servicioId: st.compraId, plataforma: st.plat, cuenta: r.despues.cuenta.correo, inventarioId: r.despues.cuenta.id, campo: "modalidad", cambio: `${r.antes.tipoVenta} (${r.antes.correo || "-"}) → cuenta_completa (${r.despues.cuenta.correo})` }, `Convirtió a cuenta completa ${nombrePlat(st.plat)} · ${r.despues.cuenta.correo}`); } catch (e) { logErr("cc.auditoria", e); }
      }
      await upsertPanel(chatId, r.yaEstaba ? `▫️ Esa compra ya era cuenta completa con ${esc(r.cuenta.correo)}: no se cambió nada.` : `✅ Ahora es *CUENTA COMPLETA* · ${esc(nombrePlat(st.plat))} · ${esc(r.despues.cuenta.correo)}\nMisma compra, mismo precio y fecha. Sin venta nueva.`, []);
      await crm().menuServicio(chatId, st.clientId, st.compraSel);
      return true;
    }
  } catch (e) { await upsertPanel(chatId, `⚠️ ${esc(String(e?.message || e).slice(0, 300))}\nNo se guardó nada.`, [volver(st)]); return true; }
  return true;
}

async function tryMensaje(msg) {
  const chatId = msg?.chat?.id; const st = pending.get(k(chatId)); const t = String(msg?.text || "").trim();
  if (!st || !["ccConvBuscar", "ccConvClave"].includes(st.mode) || !t || t.startsWith("/")) return false;
  try {
    if (st.mode === "ccConvBuscar") { st.q = t.slice(0, 80); await listar(chatId, st); return true; }
    if (t.length < 3) { await upsertPanel(chatId, "Escriba la clave completa.", [volver(st)]); return true; }
    st.clave = t; await vistaPrevia(chatId, st); return true;
  } catch (e) { await upsertPanel(chatId, `⚠️ ${esc(String(e?.message || e).slice(0, 300))}`, [volver(st)]); return true; }
}

module.exports = { tryCallback, tryMensaje, iniciar, listar };
