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
