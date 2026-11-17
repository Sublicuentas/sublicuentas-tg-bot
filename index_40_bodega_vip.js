"use strict";
/* SUBLICUENTAS · Bot · R196u — /addextra: Bodega Netflix VIP (PDF «Actualización operativa…» v2.0 · puntos 01–02).
   /addextra → proveedor → [lote | costo USDT | vencimiento proveedor] (opcional) → «Añadir una» o «Añadir varias»
     una:    correo → clave (igual que «Nueva cuenta» de Bodega)
     varias: líneas «correo clave» (o «correo | clave»)
   → vista previa SIN claves (total, nuevas, repetidas, ya existentes, ya asignadas, inválidas) → ✅ Confirmar
   → «X disponibles / Y ya existentes / Z errores» + archivo de fallas SIN claves.
   Solo Sublicuentas (superadmin). El mensaje con claves se borra del chat al leerlo y se avisa que Telegram puede
   conservar copia. Toda la lógica y las reglas viven en lib_bodega_vip.js (copia fiel de HQ api/_bodega-vip.js). */

const { db } = require("./index_01_core");
const { pending, upsertPanel, logErr } = require("./index_02_utils_roles");
const V = require("./lib_bodega_vip");

const k = (chatId) => String(chatId);
const esc = (s) => String(s == null ? "" : s).replace(/([_*`\[])/g, "\\$1");
const CANCEL = [{ text: "✖️ Cancelar", callback_data: "vipx:x" }];
const AVISO_CLAVES = "🔒 Borré su mensaje con las claves. Telegram puede conservar copias en otros dispositivos: no reenvíe ese texto.";

function bot() { return require("./index_01_core").bot; }
async function borrar(msg) { try { await bot().deleteMessage(msg.chat.id, msg.message_id); return true; } catch (_) { return false; } }

async function inicio(chatId, ctx) {
  if (!ctx.superOk) { await upsertPanel(chatId, "⛔ /addextra es solo para Sublicuentas (carga de Bodega VIP).", []); return true; }
  pending.set(k(chatId), { mode: "vipxProv", at: Date.now() });
  const kb = V.PROVEEDORES.map((p, i) => [{ text: p, callback_data: `vipx:p:${i}` }]);
  kb.push([{ text: "✍️ Otro proveedor", callback_data: "vipx:p:otro" }], CANCEL);
  await upsertPanel(chatId, "⭐ *BODEGA NETFLIX VIP · /addextra*\n\nCargar accesos VIP/Extra a Bodega.\n_Esto NO es una venta: no crea ingresos ni compras de clientes._\n\nElija el *proveedor*:", kb);
  return true;
}
async function pedirLote(chatId, st) {
  st.mode = "vipxLote"; pending.set(k(chatId), st);
  return upsertPanel(chatId, `⭐ *Proveedor:* ${esc(st.proveedor)}\n\nOpcional: escriba *lote | costo USDT | vencimiento proveedor*\nEj.: \`compra del día | 3.5 | 30/11/2026\`\n(puede dejar partes vacías) o toque *Omitir*.`, [[{ text: "⏭️ Omitir", callback_data: "vipx:lote:no" }], CANCEL]);
}
async function elegirModo(chatId, st) {
  st.mode = "vipxModo"; pending.set(k(chatId), st);
  const costo = st.costoUsdt != null && st.costoUsdt !== "" ? ` · ${esc(st.costoUsdt)} USDT` : "";
  return upsertPanel(chatId, `⭐ *Proveedor:* ${esc(st.proveedor)}${st.lote ? ` · lote ${esc(st.lote)}` : ""}${costo}\n📅 Vence proveedor: ${esc(st.vencimientoProveedor || "sin confirmar")}\n\n¿Cuántas va a cargar?`, [[{ text: "➕ Añadir una", callback_data: "vipx:m:una" }, { text: "📋 Añadir varias", callback_data: "vipx:m:varias" }], CANCEL]);
}
async function vistaPrevia(chatId, st) {
  const p = await V.previsualizar(db, st.texto);
  st.mode = "vipxConfirmar"; st.tok = Date.now().toString(36); pending.set(k(chatId), st);
  const lista = (arr, n = 6) => arr.slice(0, n).map((x) => `  • ${esc(x.correo || `línea ${x.linea}`)}${x.motivo ? ` — ${esc(x.motivo)}` : x.estado ? ` — ${esc(x.estado)}` : ""}`).join("\n") + (arr.length > n ? `\n  … y ${arr.length - n} más` : "");
  let t = `⭐ *VISTA PREVIA · BODEGA VIP*\nProveedor: ${esc(st.proveedor)}${st.lote ? ` · lote ${esc(st.lote)}` : ""}\n\n` +
    `📦 Total: *${p.total}*\n✅ Nuevas: *${p.nuevas.length}*\n🔁 Repetidas en el lote: *${p.repetidas.length}*\n📁 Ya existentes: *${p.yaExistentes.length}*\n👤 Ya asignadas: *${p.yaAsignadas.length}*\n⚠️ Inválidas: *${p.invalidas.length}*\n`;
  if (p.nuevas.length) t += `\n*Se agregarán:*\n${lista(p.nuevas)}\n`;
  if (p.yaExistentes.length + p.yaAsignadas.length) t += `\n*No se tocan (ya están):*\n${lista([...p.yaExistentes, ...p.yaAsignadas])}\n`;
  if (p.invalidas.length) t += `\n*Inválidas:*\n${lista(p.invalidas)}\n`;
  t += `\n_Las claves no se muestran._`;
  const kb = p.nuevas.length ? [[{ text: `✅ Confirmar ${p.nuevas.length}`, callback_data: `vipx:ok:${st.tok}` }], CANCEL] : [CANCEL];
  return upsertPanel(chatId, t, kb);
}

async function tryCallback(q, ctx = {}) {
  const data = String(q.data || ""); const chatId = q.message?.chat?.id;
  if (!data.startsWith("vipx:")) return false;
  if (!ctx.superOk) { await upsertPanel(chatId, "⛔ Solo Sublicuentas carga Bodega VIP.", []); return true; }
  const st = pending.get(k(chatId));
  const p = data.split(":");
  if (p[1] === "x") { pending.delete(k(chatId)); await upsertPanel(chatId, "✖️ Carga VIP cancelada. No se guardó nada.", []); return true; }
  if (!st || !String(st.mode || "").startsWith("vipx")) { await upsertPanel(chatId, "⚠️ La carga venció. Escriba /addextra otra vez.", []); return true; }
  try {
    if (p[1] === "p") {
      if (p[2] === "otro") { st.mode = "vipxProvOtro"; pending.set(k(chatId), st); await upsertPanel(chatId, "✍️ Escriba el nombre del proveedor:", [CANCEL]); return true; }
      st.proveedor = V.PROVEEDORES[Number(p[2])] || ""; await pedirLote(chatId, st); return true;
    }
    if (p[1] === "lote") { await elegirModo(chatId, st); return true; }
    if (p[1] === "m") {
      st.modo = p[2]; st.mode = p[2] === "una" ? "vipxCorreo" : "vipxLineas"; pending.set(k(chatId), st);
      await upsertPanel(chatId, p[2] === "una" ? "✉️ Escriba el *correo* del acceso VIP:" : `📋 Pegue las cuentas, *una por línea*:\n\`correo clave\`  (o \`correo | clave\`)\nMáximo ${V.MAX_LINEAS} líneas.\n\n${AVISO_CLAVES.replace("Borré su mensaje", "Al recibirlas borro su mensaje")}`, [CANCEL]);
      return true;
    }
    if (p[1] === "ok") {
      if (st.mode !== "vipxConfirmar" || st.tok !== p[2]) { await upsertPanel(chatId, "Eso ya se hizo o venció.", []); return true; }
      pending.delete(k(chatId)); // un solo toque
      const usuario = `tg:${q.from?.id || ""}${q.from?.username ? "@" + q.from.username : ""}`;
      const r = await V.importar(db, { texto: st.texto, proveedor: st.proveedor, lote: st.lote, costoUsdt: st.costoUsdt, vencimientoProveedor: st.vencimientoProveedor, usuario, origen: "tg" });
      try { require("./index_01_core").cacheInvalidatePrefix?.("inventario:"); } catch (_) {}
      await upsertPanel(chatId, `✅ *BODEGA VIP*\n${esc(r.resumen)}`, []);
      if (r.fallas.length) {
        const txt = ["Bodega VIP · fallas del lote (sin claves)", `Proveedor: ${st.proveedor}${st.lote ? ` · lote ${st.lote}` : ""}`, "", ...r.fallas.map((f) => `línea ${f.linea}\t${f.correo || "-"}\t${f.motivo}`)].join("\n");
        try { await require("./index_02_utils_roles").enviarTxtComoArchivo(chatId, txt, `bodega_vip_fallas_${Date.now()}.txt`); } catch (e) { logErr("vipx.fallas", e); }
      }
      return true;
    }
  } catch (e) { await upsertPanel(chatId, `⚠️ ${esc(String(e?.message || e).slice(0, 200))}\nNo se guardó nada.`, [CANCEL]); return true; }
  return true;
}

async function tryMensaje(msg, ctx = {}) {
  const chatId = msg?.chat?.id; const t = String(msg?.text || "").trim();
  if (/^\/addextra(@\w+)?\b/i.test(t)) return inicio(chatId, ctx);
  const st = pending.get(k(chatId));
  if (!st || !String(st.mode || "").startsWith("vipx") || !t || t.startsWith("/")) return false;
  if (!ctx.superOk) return false;
  try {
    if (st.mode === "vipxProvOtro") { st.proveedor = t.slice(0, 60); await pedirLote(chatId, st); return true; }
    if (st.mode === "vipxLote") {
      const [lote = "", costo = "", venc = ""] = t.split("|").map((x) => x.trim());
      V.datosLote({ proveedor: st.proveedor, lote, costoUsdt: costo, vencimientoProveedor: venc }); // valida antes de seguir
      Object.assign(st, { lote, costoUsdt: costo, vencimientoProveedor: venc }); await elegirModo(chatId, st); return true;
    }
    if (st.mode === "vipxCorreo") {
      const c = V.normCorreo(t); if (!/@/.test(c)) { await upsertPanel(chatId, "⚠️ Correo inválido. Escríbalo otra vez:", [CANCEL]); return true; }
      st.correo = c; st.mode = "vipxClave"; pending.set(k(chatId), st);
      await upsertPanel(chatId, `✉️ ${esc(c)}\n\n🔑 Escriba la *clave* (borro su mensaje al leerla):`, [CANCEL]); return true;
    }
    if (st.mode === "vipxClave" || st.mode === "vipxLineas") {
      st.texto = st.mode === "vipxClave" ? `${st.correo} | ${t}` : t;
      const borrado = await borrar(msg);
      await vistaPrevia(chatId, st);
      if (borrado) await bot().sendMessage(chatId, AVISO_CLAVES).catch(() => {});
      else await bot().sendMessage(chatId, "⚠️ No pude borrar su mensaje con las claves: bórrelo usted del chat.").catch(() => {});
      return true;
    }
  } catch (e) { await upsertPanel(chatId, `⚠️ ${esc(String(e?.message || e).slice(0, 200))}`, [CANCEL]); return true; }
  return false;
}

module.exports = { tryCallback, tryMensaje, inicio };

/* ── R196u Fase 2 · Hogar Netflix Premium y PIN opcional VIP desde el panel de la cuenta (👥 Clientes de la cuenta) ── */
const H = require("./lib_netflix_hogar");
const TOKENS = new Map(); let tokSeq = 0; // callback_data ≤ 64 bytes: el ID del documento va en un token corto
function tok(docId) { const t = (++tokSeq).toString(36); TOKENS.set(t, String(docId)); if (TOKENS.size > 500) TOKENS.delete(TOKENS.keys().next().value); return t; }
function botonesCuenta(plat, docId) {
  if (plat === "netflix") return [[{ text: "🏠 Hogar Netflix", callback_data: `hog:v:${tok(docId)}` }]];
  if (plat === "vipnetflix") return [[{ text: "🔏 PIN de perfil (opcional)", callback_data: `hog:pin:${tok(docId)}` }]];
  return [];
}
async function verHogar(chatId, docId, ctx, aviso = "") {
  const s = await db.collection("inventario").doc(docId).get();
  if (!s.exists) return upsertPanel(chatId, "⚠️ Esa cuenta ya no existe.", []);
  const d = s.data() || {}; const e = H.estadoHogar(d); const t = tok(docId);
  const filas = H.perfilesConHogar(d);
  let txt = `🏠 *HOGAR · NETFLIX PREMIUM*\n📧 ${esc(d.correo || "")}\n\n*${esc(e.texto)}*\n\n` + filas.map((p) => `${p.hogar ? "🏠" : "▫️"} Perfil ${p.perfil} · ${esc(p.cliente)}`).join("\n");
  txt += `\n\n_Dato de seguimiento en Sublichat: no cambia nada en Netflix._`;
  try { const r = await H.consultaHogar(db, { inventarioId: docId }); if (r && r.incidencia) txt += `\n\n⚠️ *Incidencia:* ${esc(r.incidencia)}`; } catch (_) {} // R196v · madre duplicada
  if (aviso) txt += `\n\n${aviso}`;
  const kb = [];
  if (ctx.superOk) {
    filas.filter((p) => p.clienteId && !p.hogar).forEach((p) => kb.push([{ text: `Marcar Hogar · Perfil ${p.perfil} · ${p.cliente}`.slice(0, 60), callback_data: `hog:a:${t}:${p.perfil}` }]));
    if (e.estado !== "sin_asignar") kb.push([{ text: "🧹 Quitar Hogar", callback_data: `hog:q:${t}` }]);
  }
  kb.push([{ text: "✖️ Cerrar", callback_data: "vipx:x" }]);
  return upsertPanel(chatId, txt, kb);
}
async function hogCallback(q, ctx) {
  const data = String(q.data || ""); const chatId = q.message?.chat?.id; const p = data.split(":");
  const docId = TOKENS.get(p[2]); if (!docId) { await upsertPanel(chatId, "⚠️ Ese botón venció. Abra otra vez la cuenta.", []); return true; }
  const usuario = `tg:${q.from?.id || ""}${q.from?.username ? "@" + q.from.username : ""}`;
  try {
    if (p[1] === "v") { await verHogar(chatId, docId, ctx); return true; }
    if (p[1] === "pin") {
      const s = await db.collection("inventario").doc(docId).get(); const d = s.data() || {};
      const kb = ctx.superOk ? [[{ text: d.tienePin ? "✏️ Cambiar PIN" : "➕ Poner PIN", callback_data: `hog:pe:${p[2]}` }], ...(d.tienePin ? [[{ text: "🚫 Quitar PIN (Sin PIN)", callback_data: `hog:pq:${p[2]}` }]] : []), [{ text: "✖️ Cerrar", callback_data: "vipx:x" }]] : [[{ text: "✖️ Cerrar", callback_data: "vipx:x" }]];
      await upsertPanel(chatId, `🔏 *PIN DE PERFIL · NETFLIX VIP*\n📧 ${esc(d.correo || "")}\n\nEstado: *${d.tienePin ? "PIN configurado" : "Sin PIN"}*\n_Opcional: solo si el cliente lo pidió. Sublichat lo registra; el PIN se pone en Netflix a mano._`, kb);
      return true;
    }
    if (!ctx.superOk) { await upsertPanel(chatId, "⛔ Solo Sublicuentas cambia Hogar o PIN VIP.", []); return true; }
    if (p[1] === "a" || p[1] === "ar") {
      const s = await db.collection("inventario").doc(docId).get(); const fila = H.perfilesConHogar(s.data() || {}).find((x) => String(x.perfil) === String(p[3]));
      if (!fila || !fila.clienteId) { await verHogar(chatId, docId, ctx, "⚠️ Ese perfil cambió. Elija otra vez."); return true; }
      try { await H.asignarHogar(db, { inventarioId: docId, clienteId: fila.clienteId, compraId: fila.compraId, confirmarReemplazo: p[1] === "ar", usuario, origen: "tg" }); }
      catch (e) {
        if (e.code !== "requiere_confirmacion") throw e;
        await upsertPanel(chatId, `⚠️ ${esc(e.message)}`, [[{ text: `✅ Reemplazar por Perfil ${fila.perfil}`, callback_data: `hog:ar:${p[2]}:${p[3]}` }], [{ text: "✖️ Cancelar", callback_data: `hog:v:${p[2]}` }]]);
        return true;
      }
      await verHogar(chatId, docId, ctx, "✅ Hogar guardado."); return true;
    }
    if (p[1] === "q") { await H.quitarHogar(db, { inventarioId: docId, usuario, origen: "tg" }); await verHogar(chatId, docId, ctx, "🧹 Hogar quitado."); return true; }
    if (p[1] === "pq") { await V.guardarPin(db, { inventarioId: docId, pin: "", usuario, origen: "tg" }); await upsertPanel(chatId, "✅ Ahora: *Sin PIN*. La entrega ya no muestra línea de PIN.", []); return true; }
    if (p[1] === "pe") { pending.set(k(chatId), { mode: "hogPinValor", docId, at: Date.now() }); await upsertPanel(chatId, "🔏 Escriba el PIN de perfil (4 números). Borro su mensaje al leerlo:", [[{ text: "✖️ Cancelar", callback_data: "vipx:x" }]]); return true; }
  } catch (e) { await upsertPanel(chatId, `⚠️ ${esc(String(e?.message || e).slice(0, 200))}\nNo se guardó nada.`, []); return true; }
  return true;
}
const _tryCallbackVip = tryCallback;
async function tryCallbackTodo(q, ctx = {}) {
  if (String(q.data || "").startsWith("hog:")) return hogCallback(q, ctx);
  return _tryCallbackVip(q, ctx);
}
const _tryMensajeVip = tryMensaje;
async function tryMensajeTodo(msg, ctx = {}) {
  const chatId = msg?.chat?.id; const st = pending.get(k(chatId)); const t = String(msg?.text || "").trim();
  if (st && st.mode === "hogPinValor" && t && !t.startsWith("/")) {
    if (!ctx.superOk) return false;
    await borrar(msg);
    try { await V.guardarPin(db, { inventarioId: st.docId, pin: t, usuario: `tg:${msg.from?.id || ""}`, origen: "tg" }); pending.delete(k(chatId)); await upsertPanel(chatId, "✅ *PIN configurado.* La entrega lo incluirá; el valor no se muestra aquí.", []); }
    catch (e) { await upsertPanel(chatId, `⚠️ ${esc(e.message)}\nEscríbalo otra vez:`, [[{ text: "✖️ Cancelar", callback_data: "vipx:x" }]]); }
    return true;
  }
  return _tryMensajeVip(msg, ctx);
}
module.exports = { tryCallback: tryCallbackTodo, tryMensaje: tryMensajeTodo, inicio, botonesCuenta, verHogar };

/* ── R196u Fase 3 · HBO Platinum 5 / Standard 3 desde el panel de la cuenta ── */
const P = require("./lib_hbo_planes");
const _botonesFase2 = botonesCuenta;
function botonesCuentaTodo(plat, docId) {
  if (plat === "hbomax") return [[{ text: "📦 Plan HBO", callback_data: `hog:hp:${tok(docId)}` }]];
  return _botonesFase2(plat, docId);
}
// R196z3 · Plan + capacidad por cuenta. Predeterminado Standard 3 · Platinum 5; otra capacidad = excepción de ESA cuenta,
// confirmada por Sublicuentas. Nunca se saca, mueve ni desactiva un perfil vendido (se ofrece conservarlos).
const usuarioTg = (from = {}) => `tg:${from.id || ""}${from.username ? "@" + from.username : ""}`;
async function panelPlan(chatId, docId, t, superOk, aviso = "") {
  const s = await db.collection("inventario").doc(docId).get(); const d = s.data() || {}; const r = P.resumenCuenta(d);
  const kb = superOk ? [[{ text: "Platinum", callback_data: `hog:hps:${t}:platinum` }, { text: "Standard", callback_data: `hog:hps:${t}:standard` }], ...(r.plan ? [[{ text: "✏️ Editar capacidad", callback_data: `hog:hpc:${t}` }]] : []), [{ text: "✖️ Cerrar", callback_data: "vipx:x" }]] : [[{ text: "✖️ Cerrar", callback_data: "vipx:x" }]];
  const pers = r.personalizada ? `\nPredeterminado de ${esc(r.nombrePlan)}: ${r.capacidadPlan}. ${r.excepcion ? `Excepción confirmada (${esc(r.excepcion.por || "—")}).` : "⚠️ Sin excepción registrada: confirme si es correcta."}` : "";
  await upsertPanel(chatId, `${aviso ? aviso + "\n\n" : ""}📦 *PLAN HBO MAX*\n📧 ${esc(d.correo || "")}\n\nActual: *${esc(r.etiqueta)}*\nCapacidad: ${r.capacidad} · Ocupados: ${r.ocupados} · Libres: ${r.libres}${pers}${r.sobreocupada ? "\n⚠️ Sobreocupada: revise antes de vender." : ""}\n\n_Standard trae 3 y Platinum 5. Otra capacidad queda como excepción de esta cuenta. Nunca se saca a un cliente._`, kb);
}
async function guardarPlanTg(chatId, docId, t, from, { plan = null, capacidad = null, autorizar = false } = {}) {
  try {
    const args = { inventarioId: docId, capacidad, autorizarExcepcion: autorizar, motivo: autorizar ? "Confirmado en Telegram" : "", usuario: usuarioTg(from), origen: "tg" };
    const r = plan ? await P.cambiarPlan(db, { ...args, plan }) : await P.editarCapacidad(db, args);
    if (plan && r.ok && !r.yaEstaba) { try { await P.sincronizarPlanVentas(db, { inventarioId: docId, usuario: args.usuario, origen: "tg" }); } catch (_) {} } // R196z4 · ventas ligadas toman el plan de la cuenta
    await upsertPanel(chatId, `✅ *${esc(r.etiqueta)}*\nCapacidad ${r.capacidad} · Ocupados ${r.ocupados} · Libres ${r.libres}${r.personalizada ? "\n_Capacidad personalizada de esta cuenta (excepción registrada)._" : ""}`, [[{ text: "📦 Ver plan", callback_data: `hog:hp:${t}` }, { text: "✖️ Cerrar", callback_data: "vipx:x" }]]);
  } catch (e) {
    if ((e.code === "requiere_excepcion" || e.code === "sobreocupacion") && e.capacidadSugerida) {
      await upsertPanel(chatId, `⚠️ ${esc(e.message)}`, [[{ text: `✅ Confirmar excepción de ${e.capacidadSugerida}`, callback_data: `hog:hpx:${t}:${plan || "-"}:${e.capacidadSugerida}` }], [{ text: "✖️ Cancelar", callback_data: `hog:hp:${t}` }]]);
    } else await upsertPanel(chatId, `⛔ ${esc(e.message)}`, [[{ text: "📦 Ver plan", callback_data: `hog:hp:${t}` }]]);
  }
}
async function planCallback(q, ctx) {
  const chatId = q.message?.chat?.id; const p = String(q.data || "").split(":");
  const docId = TOKENS.get(p[2]); if (!docId) { await upsertPanel(chatId, "⚠️ Ese botón venció. Abra otra vez la cuenta.", []); return true; }
  try {
    if (["hps", "hpc", "hpx"].includes(p[1]) && !ctx.superOk) { await upsertPanel(chatId, "⛔ Solo Sublicuentas cambia el plan o la capacidad HBO.", []); return true; }
    if (p[1] === "hps") { await guardarPlanTg(chatId, docId, p[2], q.from, { plan: p[3] }); return true; }
    if (p[1] === "hpx") { await guardarPlanTg(chatId, docId, p[2], q.from, { plan: p[3] && p[3] !== "-" ? p[3] : null, capacidad: Number(p[4]), autorizar: true }); return true; }
    if (p[1] === "hpc") { pending.set(k(chatId), { mode: "hboCapValor", docId, tok: p[2] }); await upsertPanel(chatId, "✏️ *EDITAR CAPACIDAD HBO*\n\nEscriba el número de perfiles de esta cuenta (Standard trae 3, Platinum 5).\nSi es otro número, le pediré confirmar la excepción.", [[{ text: "✖️ Cancelar", callback_data: `hog:hp:${p[2]}` }]]); return true; }
    pending.delete(k(chatId));
    await panelPlan(chatId, docId, p[2], ctx.superOk);
  } catch (e) { await upsertPanel(chatId, `⚠️ ${esc(String(e?.message || e).slice(0, 200))}`, []); }
  return true;
}
const _tryMensajeFase2 = module.exports.tryMensaje;
async function tryMensajeFase3(msg, ctx = {}) {
  const chatId = msg?.chat?.id; const st = pending.get(k(chatId)); const t = String(msg?.text || "").trim();
  if (st && st.mode === "hboCapValor" && t && !t.startsWith("/")) {
    if (!ctx.superOk) return false;
    if (!/^\d{1,2}$/.test(t)) { await upsertPanel(chatId, "⚠️ Escriba solo un número (ejemplo: 4).", [[{ text: "✖️ Cancelar", callback_data: `hog:hp:${st.tok}` }]]); return true; }
    pending.delete(k(chatId));
    await guardarPlanTg(chatId, st.docId, st.tok, msg.from, { capacidad: Number(t) });
    return true;
  }
  return _tryMensajeFase2(msg, ctx);
}
const _tryCallbackFase2 = module.exports.tryCallback;
async function tryCallbackFase3(q, ctx = {}) { const d = String(q.data || ""); if (/^hog:hp[scx]?:/.test(d)) return planCallback(q, ctx); return _tryCallbackFase2(q, ctx); }
module.exports = { ...module.exports, tryCallback: tryCallbackFase3, tryMensaje: tryMensajeFase3, botonesCuenta: botonesCuentaTodo };
