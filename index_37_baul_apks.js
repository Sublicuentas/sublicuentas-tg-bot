"use strict";
/* SUBLICUENTAS · Bot · R187 · Baúl de APKs de TV Digital + URLs de conexión (PDF «Sublichat 5 puntos», bloque 02).
   - /baul: consulta por plataforma → dispositivo → enlaces (Downloader, APK, tienda). Mismo directorio que Web y APK
     (Firestore configuracion_tv_digital/baul_apks · lib_baul_apks.js = copia fiel de Sublichat HQ).
   - /urltv: URLs de CONEXIÓN (aparte del Baúl): ver, editar, activar/desactivar, eliminar e historial.
   Permisos (servidor, nunca solo ocultar botones):
     · consultar: administradores del bot, o vendedor Relojes/Geisell (igual que el módulo «baul-apks» de HQ).
     · editar: solo administradores del bot. Todo queda en auditoria_eventos con el usuario.
   Desactivar una URL de conexión NO rompe a los clientes que ya la tienen; eliminar solo si está desactivada,
   no es proveedor base y no tiene clientes asignados. Lo llama index_06_handlers.js. */

const { db, bot } = require("./index_01_core");
const B = require("./lib_baul_apks");
const T = require("./lib_tv_digital");

const ESPERA_MS = 10 * 60 * 1000;
const espera = global.__SUBLI_BAUL_ESPERA__ = global.__SUBLI_BAUL_ESPERA__ || new Map();
const VEND_BAUL = ["relojes", "geisell", "geissel"];
const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

function puedeVer({ adminOk = false, vend = null } = {}) {
  if (adminOk) return true;
  if (!vend) return false;
  if (vend.permisos && vend.permisos["baul-apks"] === false) return false;
  if (vend.permisos && vend.permisos["baul-apks"] === true) return true;
  return [vend.nombre_norm, vend.nombre, vend.id].map(norm).some((n) => VEND_BAUL.includes(n));
}
const puedeEditar = ({ adminOk = false } = {}) => !!adminOk;
const usuarioDe = (from = {}) => `tg:${from.id || ""}${from.username ? "@" + from.username : ""}`.slice(0, 60);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ───────── Textos (puros: los prueban los tests) ─────────
function textoEnlace(e, { editor = false } = {}) {
  const l = [`<b>${esc(e.app)}</b> · ${esc(B.METODOS[e.metodo] || e.metodo)}${e.activo === false ? " · <i>desactivado</i>" : ""}`];
  if (e.url) l.push(`🔗 <code>${esc(e.url)}</code>`);
  else if (e.metodo === "tv_store") l.push("🔎 Buscar en la tienda del TV (sin enlace).");
  if (e.codigo) l.push(`🔢 Código Downloader: <code>${esc(e.codigo)}</code>`);
  if (editor && e.codigoPendiente) l.push(`⚠️ Código por confirmar: ${esc(e.codigoPendiente)} (no se entrega)`);
  if (e.costoExterno && e.costoExterno.texto) l.push(`💲 ${esc(e.costoExterno.texto)}`);
  if (e.nota) l.push(`📝 ${esc(e.nota)}`);
  if (editor) l.push(`<i>id ${esc(e.id)} · rev ${Number(e.revision || 1)}</i>`);
  return l.join("\n");
}
function textoDispositivo(vista, dispId, opts = {}) {
  const d = (vista.dispositivos || []).find((x) => x.id === dispId);
  if (!d) return `${esc(vista.nombre)}: sin enlaces para ese dispositivo.`;
  return [`🧰 <b>${esc(vista.nombre)} · ${esc(d.nombre)}</b>`, "", ...d.enlaces.map((e) => textoEnlace(e, opts)), "", `<i>${esc(B.AVISO_INSTALACION)}</i>`].join("\n\n").replace(/\n\n\n+/g, "\n\n");
}
function textoUrls(urls, editor = false) {
  const l = ["📡 <b>URLs de conexión de TV Digital</b>", ""];
  for (const [k, v] of Object.entries(urls)) l.push(`${v.activo === false ? "⏸️" : "✅"} <b>${esc(v.nombre)}</b> (${esc(k)})\n<code>${esc(v.url)}</code>${editor ? ` · v${Number(v.version || 1)}` : ""}`);
  return l.join("\n");
}

// ───────── Envío ─────────
const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });
async function enviar(chatId, texto, rows = []) { return bot.sendMessage(chatId, texto, { parse_mode: "HTML", disable_web_page_preview: true, ...kb(rows) }); }

async function menuPlataformas(chatId) {
  const rows = []; const ps = B.PLATAFORMAS.map((p) => ({ text: p.nombre, callback_data: `baul:p:${p.id}` }));
  for (let i = 0; i < ps.length; i += 2) rows.push(ps.slice(i, i + 2));
  return enviar(chatId, "🧰 <b>Baúl de APKs</b>\nElija la plataforma:", rows);
}
async function menuDispositivos(chatId, plat, ctx) {
  const v = B.vistaPlataforma(await B.leerBaul(db), plat, { incluirInactivos: puedeEditar(ctx) });
  const rows = v.dispositivos.map((d) => [{ text: `${d.nombre} (${d.enlaces.length})`, callback_data: `baul:d:${plat}:${d.id}` }]);
  rows.push([{ text: "⬅️ Plataformas", callback_data: "baul:m" }]);
  return enviar(chatId, `🧰 <b>${esc(v.nombre)}</b>\nElija el dispositivo:`, rows);
}
async function verDispositivo(chatId, plat, disp, ctx) {
  const editor = puedeEditar(ctx);
  const v = B.vistaPlataforma(await B.leerBaul(db), plat, { incluirInactivos: editor });
  const d = (v.dispositivos || []).find((x) => x.id === disp);
  const rows = [];
  if (editor && d) for (const e of d.enlaces) rows.push([
    { text: `✏️ ${e.app}`, callback_data: `baul:e:${e.id}` },
    { text: e.activo === false ? "▶️ Activar" : "⏸️ Desactivar", callback_data: `baul:a:${e.activo === false ? 1 : 0}:${e.id}` },
    ...(e.activo === false ? [{ text: "🗑️", callback_data: `baul:x:${e.id}` }] : []),
  ]);
  rows.push([{ text: "⬅️ Dispositivos", callback_data: `baul:p:${plat}` }]);
  return enviar(chatId, textoDispositivo(v, disp, { editor }), rows);
}
async function menuUrls(chatId, ctx) {
  const editor = puedeEditar(ctx);
  const urls = await T.leerUrlsTv(db, { fresco: true });
  const rows = editor ? Object.entries(urls).map(([k, v]) => [
    { text: `✏️ ${v.nombre}`, callback_data: `baul:ue:${k}` },
    { text: v.activo === false ? "▶️" : "⏸️", callback_data: `baul:ua:${v.activo === false ? 1 : 0}:${k}` },
    ...(v.activo === false ? [{ text: "🗑️", callback_data: `baul:ux:${k}` }] : []),
  ]) : [];
  if (editor) rows.push([{ text: "📜 Historial", callback_data: "baul:uh" }]);
  return enviar(chatId, textoUrls(urls, editor) + (editor ? "\n\nNueva: <code>/urltv_nueva clave | Nombre | http://…</code>" : ""), rows);
}

// ───────── Entrada desde index_06 ─────────
async function tryCallback(q, ctx = {}) {
  const data = String(q.data || ""); if (!data.startsWith("baul:")) return false;
  const chatId = q.message?.chat?.id; const p = data.split(":");
  if (!puedeVer(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso al Baúl de APKs."); return true; }
  const soloEditor = ["e", "a", "x", "ue", "ua", "ux", "uh", "xs", "uxs"].includes(p[1]);
  if (soloEditor && !puedeEditar(ctx)) { await bot.sendMessage(chatId, "⛔ Solo administradores pueden editar."); return true; }
  const u = usuarioDe(q.from);
  try {
    if (p[1] === "m") return await menuPlataformas(chatId), true;
    if (p[1] === "p") return await menuDispositivos(chatId, p[2], ctx), true;
    if (p[1] === "d") return await verDispositivo(chatId, p[2], p[3], ctx), true;
    if (p[1] === "u") return await menuUrls(chatId, ctx), true;
    if (p[1] === "a") { await B.activarEnlace(db, p[3], p[2] === "1", u); await bot.sendMessage(chatId, p[2] === "1" ? "✅ Enlace activado." : "⏸️ Enlace desactivado (ya no se ofrece)."); return true; }
    if (p[1] === "x") { await enviar(chatId, `¿Eliminar el enlace <b>${esc(p[2])}</b>? No se puede deshacer.`, [[{ text: "🗑️ Sí, eliminar", callback_data: `baul:xs:${p[2]}` }]]); return true; }
    if (p[1] === "xs") { await B.eliminarEnlace(db, p[2], u); await bot.sendMessage(chatId, "🗑️ Enlace eliminado (queda en auditoría)."); return true; }
    if (p[1] === "e") { espera.set(String(chatId), { tipo: "enlace", id: p[2], at: Date.now() }); await enviar(chatId, `✏️ Envíe el nuevo dato de <b>${esc(p[2])}</b> así:\n<code>url | código | nota</code>\n(deje vacío lo que no cambia; «-» borra el código o la nota). /cancelar para salir.`); return true; }
    if (p[1] === "ua") { await T.activarUrlTv(db, { proveedor: p[3], activo: p[2] === "1", usuario: u }); await bot.sendMessage(chatId, p[2] === "1" ? "✅ URL activada." : "⏸️ URL desactivada para entregas NUEVAS. Los clientes que ya la tienen no se tocan."); return true; }
    if (p[1] === "ux") { const n = await T.clientesConProveedor(db, p[2]); await enviar(chatId, `¿Eliminar la URL <b>${esc(p[2])}</b>? Clientes asignados: ${n}.`, n ? [] : [[{ text: "🗑️ Sí, eliminar", callback_data: `baul:uxs:${p[2]}` }]]); return true; }
    if (p[1] === "uxs") { await T.eliminarUrlTv(db, { proveedor: p[2], usuario: u }); await bot.sendMessage(chatId, "🗑️ URL eliminada (queda en historial)."); return true; }
    if (p[1] === "ue") { espera.set(String(chatId), { tipo: "urltv", id: p[2], at: Date.now() }); await enviar(chatId, `✏️ Envíe la nueva URL de conexión de <b>${esc(p[2])}</b> (http://…). /cancelar para salir.`); return true; }
    if (p[1] === "uh") { const h = (await T.historialUrlsTv(db)).slice(0, 15); await enviar(chatId, ["📜 <b>Historial URLs</b>", ...h.map((x) => `${esc(x.at ? String(x.at).slice(0, 16).replace("T", " ") : "")} · ${esc(x.accion)} · ${esc(x.proveedor)} · ${esc(x.por || x.usuario || "")}`)].join("\n") || "Sin historial."); return true; }
  } catch (e) { await bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 300)}`); return true; }
  return true;
}

function parseEdicion(texto) {
  const [url = "", codigo = "", nota = ""] = String(texto || "").split("|").map((s) => s.trim());
  return { url, codigo, nota };
}
async function tryMensaje(msg, ctx = {}) {
  const text = String(msg?.text || "").trim(); const chatId = msg?.chat?.id;
  if (/^\/baul\b/i.test(text)) { if (!puedeVer(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso al Baúl de APKs."); return true; } await menuPlataformas(chatId); return true; }
  if (/^\/urltv_nueva\b/i.test(text)) {
    if (!puedeEditar(ctx)) { await bot.sendMessage(chatId, "⛔ Solo administradores pueden editar."); return true; }
    const [clave = "", nombre = "", url = ""] = text.replace(/^\/urltv_nueva\s*/i, "").split("|").map((s) => s.trim());
    try { await T.guardarUrlTv(db, { proveedor: norm(clave), nombre, url, usuario: usuarioDe(msg.from) }); await bot.sendMessage(chatId, "✅ URL de conexión agregada."); }
    catch (e) { await bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 300)}`); }
    return true;
  }
  if (/^\/urltv\b/i.test(text)) { if (!puedeVer(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso."); return true; } await menuUrls(chatId, ctx); return true; }
  const st = espera.get(String(chatId));
  if (!st) return false;
  if (Date.now() - st.at > ESPERA_MS) { espera.delete(String(chatId)); return false; }
  if (/^\/cancelar\b/i.test(text)) { espera.delete(String(chatId)); await bot.sendMessage(chatId, "Cancelado."); return true; }
  if (text.startsWith("/")) return false;
  if (!puedeEditar(ctx)) { espera.delete(String(chatId)); return false; }
  const u = usuarioDe(msg.from);
  try {
    if (st.tipo === "urltv") {
      const urls = await T.leerUrlsTv(db, { fresco: true });
      await T.guardarUrlTv(db, { proveedor: st.id, nombre: urls[st.id]?.nombre || st.id, url: text, usuario: u });
      await bot.sendMessage(chatId, "✅ URL de conexión actualizada (versión nueva; queda en historial).");
    } else {
      const b = await B.leerBaul(db, { fresco: true }); const e = b.enlaces.find((x) => x.id === st.id);
      if (!e) throw new Error("Ese enlace ya no existe.");
      const c = parseEdicion(text);
      const input = { ...e, url: c.url || e.url, codigo: c.codigo === "-" ? "" : (c.codigo || e.codigo || ""), nota: c.nota === "-" ? "" : (c.nota || e.nota || "") };
      await B.guardarEnlace(db, input, u);
      await bot.sendMessage(chatId, "✅ Enlace actualizado (revisión nueva; queda en auditoría).");
    }
    espera.delete(String(chatId));
  } catch (e) { await bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 300)}\nCorrija y envíe otra vez, o /cancelar.`); }
  return true;
}

module.exports = { tryCallback, tryMensaje, puedeVer, puedeEditar, textoEnlace, textoDispositivo, textoUrls, parseEdicion };
