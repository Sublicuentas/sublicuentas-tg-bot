"use strict";
/* SUBLICUENTAS · Bot · R188 · Spotify Familiar (PDF «Sublichat 5 puntos», bloque 01) — registro rápido desde Telegram.
   /spotify → 1. Crear familia · 2. Agregar invitado · 3. Vincular existente · 4. Consultar familia.
   Mismas funciones que Web y APK (lib_spotify_familias.js = copia fiel de Sublichat HQ): cupo de 5, exclusividad, mover y
   desvincular en transacción, auditoría con el usuario. Nunca se borra un cliente. No se guarda contraseña de Spotify.
   Permisos (servidor): administradores del bot, o vendedor Relojes/Geisell (igual que el módulo «spotify-familias» de HQ).
   Lo llama index_06_handlers.js. */

const { db, bot } = require("./index_01_core");
const S = require("./lib_spotify_familias");

const ESPERA_MS = 10 * 60 * 1000;
const espera = global.__SUBLI_SPOTIFY_ESPERA__ = global.__SUBLI_SPOTIFY_ESPERA__ || new Map();
const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const usuarioDe = (from = {}) => `tg:${from.id || ""}${from.username ? "@" + from.username : ""}`.slice(0, 60);

function puede({ adminOk = false, vend = null } = {}) {
  if (adminOk) return true;
  if (!vend) return false;
  if (vend.permisos && vend.permisos["spotify-familias"] === false) return false;
  if (vend.permisos && vend.permisos["spotify-familias"] === true) return true;
  return [vend.nombre_norm, vend.nombre, vend.id].map(norm).some((n) => ["relojes", "geisell", "geissel"].includes(n));
}
const enviar = (chatId, texto, rows = []) => bot.sendMessage(chatId, texto, { parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: rows } });

function textoFamilia(f) {
  const act = f.miembros.filter((m) => m.estado === "activo");
  return [`🎵 <b>${esc(f.codigo)}</b> · Madre: ${esc(f.madreCorreo)}`, `Invitados <b>${f.ocupados}/${f.capacidad}</b>`, "",
    ...act.map((m, i) => `${i + 1}. ${esc(m.correo)}${m.clienteNombre ? ` · ${esc(m.clienteNombre)}` : ""} · Vinculada`),
    ...Array.from({ length: f.libres }).map(() => "+ Espacio disponible")].join("\n");
}
async function menu(chatId) {
  return enviar(chatId, "🎵 <b>Spotify Familiar</b>\nSeleccione una opción:", [
    [{ text: "1. Crear familia", callback_data: "spf:c" }], [{ text: "2. Agregar invitado", callback_data: "spf:a" }],
    [{ text: "3. Vincular existente", callback_data: "spf:v" }], [{ text: "4. Consultar familia", callback_data: "spf:l" }],
  ]);
}
async function elegirFamilia(chatId, accion) {
  const fs = (await S.listarFamilias(db)).filter((f) => f.estado !== "inactiva" && (accion === "l" || f.libres > 0));
  if (!fs.length) return enviar(chatId, accion === "l" ? "No hay familias todavía." : "No hay familias con espacios libres.");
  return enviar(chatId, "Elija la familia:", fs.slice(0, 40).map((f) => [{ text: `${f.codigo} · ${f.madreCorreo} · ${f.ocupados}/${f.capacidad}`, callback_data: `spf:f:${accion}:${f.id}` }]));
}

async function tryCallback(q, ctx = {}) {
  const data = String(q.data || ""); if (!data.startsWith("spf:")) return false;
  const chatId = q.message?.chat?.id, p = data.split(":"), k = String(chatId);
  if (!puede(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso a Spotify Familiar."); return true; }
  const u = usuarioDe(q.from);
  try {
    if (p[1] === "m") return await menu(chatId), true;
    if (p[1] === "c") { espera.set(k, { paso: "madre", at: Date.now() }); await enviar(chatId, "Envíe el <b>correo madre</b> (administradora). /cancelar para salir."); return true; }
    if (p[1] === "v") { espera.set(k, { paso: "vincular_correo", at: Date.now() }); await enviar(chatId, "Envíe o elija el <b>correo registrado</b> (ficha Spotify que ya existe)."); return true; }
    if (p[1] === "a" || p[1] === "l") return await elegirFamilia(chatId, p[1]), true;
    if (p[1] === "f") {
      const f = await S.leerFamilia(db, p[3]);
      if (p[2] === "l") {
        const rows = f.miembros.filter((m) => m.estado === "activo").map((m) => [{ text: `↔️ Mover ${m.correo}`, callback_data: `spf:mv:${m.id}` }, { text: "Desvincular", callback_data: `spf:d:${m.id}` }]);
        espera.set(k, { paso: "ver", familiaId: f.id, miembros: f.miembros, at: Date.now() });
        await enviar(chatId, textoFamilia(f), rows); return true;
      }
      espera.set(k, { paso: "agregar_correo", familiaId: f.id, at: Date.now() });
      await enviar(chatId, `${textoFamilia(f)}\n\nEnvíe el <b>correo invitado</b>. Si ya tiene ficha, se vincula esa misma (no se duplica).`); return true;
    }
    if (p[1] === "ok") { // confirmar vinculación de ficha existente
      const st = espera.get(k); if (!st || !st.pendiente) return true;
      const f = await S.vincularInvitado(db, { ...st.pendiente, usuario: u }); espera.delete(k);
      await enviar(chatId, `✅ Confirmado · ${esc(f.codigo)} ${f.ocupados}/${f.capacidad}\nFicha, Web y APK actualizadas.`); return true;
    }
    if (p[1] === "vf") { // vincular existente: elegir familia destino
      const st = espera.get(k); if (!st || !st.servicio) return true;
      const f = await S.leerFamilia(db, p[2]);
      st.pendiente = { familiaId: f.id, correo: st.servicio.correo, clienteId: st.servicio.clienteId, compraId: st.servicio.compraId }; espera.set(k, st);
      await enviar(chatId, `Familia: <b>${esc(f.codigo)}</b>\nMadre: ${esc(f.madreCorreo)}\n${f.ocupados + 1} de ${f.capacidad} · ¿Confirmar vinculación de ${esc(st.servicio.correo)}?`, [[{ text: "✅ Confirmar", callback_data: "spf:ok" }]]); return true;
    }
    if (p[1] === "d" || p[1] === "mv") {
      const st = espera.get(k); const m = st && (st.miembros || []).find((x) => x.id === p[2]);
      if (!m) { await bot.sendMessage(chatId, "Vuelva a consultar la familia."); return true; }
      if (p[1] === "d") { const r = await S.desvincular(db, { correo: m.correo, usuario: u }); await enviar(chatId, `✅ ${esc(m.correo)} desvinculado de ${esc(r.codigo)} (el cliente no se borra).${r.advertencia ? `\n⚠️ ${esc(r.advertencia)}` : ""}`); return true; }
      const destinos = (await S.listarFamilias(db)).filter((f) => f.id !== st.familiaId && f.libres > 0 && f.estado !== "inactiva");
      st.moviendo = m.correo; espera.set(k, st);
      await enviar(chatId, destinos.length ? `¿A qué familia mueve ${esc(m.correo)}?` : "No hay otra familia con espacio.", destinos.slice(0, 40).map((f) => [{ text: `${f.codigo} · ${f.ocupados}/${f.capacidad}`, callback_data: `spf:md:${f.id}` }])); return true;
    }
    if (p[1] === "md") {
      const st = espera.get(k); if (!st || !st.moviendo) return true;
      const r = await S.moverInvitado(db, { correo: st.moviendo, destinoId: p[2], usuario: u }); espera.delete(k);
      await enviar(chatId, `✅ Movido: ${esc(r.origen.codigo)} (${r.origen.ocupados}/5) → ${esc(r.destino.codigo)} (${r.destino.ocupados}/5). Queda en auditoría.`); return true;
    }
  } catch (e) { await bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 300)}`); return true; }
  return true;
}

async function tryMensaje(msg, ctx = {}) {
  const text = String(msg?.text || "").trim(), chatId = msg?.chat?.id, k = String(chatId);
  if (/^\/spotify\b/i.test(text)) { if (!puede(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso a Spotify Familiar."); return true; } await menu(chatId); return true; }
  const st = espera.get(k); if (!st) return false;
  if (Date.now() - st.at > ESPERA_MS) { espera.delete(k); return false; }
  if (/^\/cancelar\b/i.test(text)) { espera.delete(k); await bot.sendMessage(chatId, "Cancelado."); return true; }
  if (text.startsWith("/") || !["madre", "agregar_correo", "vincular_correo"].includes(st.paso)) return false;
  if (!puede(ctx)) { espera.delete(k); return false; }
  const u = usuarioDe(msg.from);
  try {
    if (st.paso === "madre") { const f = await S.crearFamilia(db, { madreCorreo: text, usuario: u }); espera.delete(k); await enviar(chatId, `✅ Familia creada\n${textoFamilia(f)}`); return true; }
    if (st.paso === "agregar_correo") {
      const ya = (await S.buscarServiciosSpotify(db, text)).find((x) => x.correo === S.normCorreo(text) && !x.spotifyFamiliaId);
      const f = await S.vincularInvitado(db, { familiaId: st.familiaId, correo: text, clienteId: ya ? ya.clienteId : "", compraId: ya ? ya.compraId : "", usuario: u });
      espera.delete(k); await enviar(chatId, `✅ ${ya ? `Vinculada la ficha existente de ${esc(ya.clienteNombre)}` : "Invitado agregado"} · ${esc(f.codigo)} ${f.ocupados}/${f.capacidad}`); return true;
    }
    if (st.paso === "vincular_correo") {
      const r = await S.resolverCorreo(db, text);
      if (r && r.tipo === "invitado") { espera.delete(k); await enviar(chatId, `Familia encontrada: <b>${esc(r.codigo)}</b>\nMadre: ${esc(r.madreCorreo)}\n${r.posicion} de ${r.capacidad} · Ya está vinculada.`); return true; }
      const servs = (await S.buscarServiciosSpotify(db, text)).filter((x) => !x.spotifyFamiliaId);
      if (!servs.length) { await enviar(chatId, "No encontré una ficha Spotify con ese correo. Use «2. Agregar invitado» para crear el registro."); return true; }
      st.servicio = servs[0]; st.paso = "elegir_familia"; espera.set(k, st);
      const fs = (await S.listarFamilias(db)).filter((f) => f.libres > 0 && f.estado !== "inactiva");
      await enviar(chatId, `Ficha: ${esc(servs[0].correo)} · ${esc(servs[0].clienteNombre)}\nElija la familia:`, fs.slice(0, 40).map((f) => [{ text: `${f.codigo} · ${f.madreCorreo} · ${f.ocupados}/${f.capacidad}`, callback_data: `spf:vf:${f.id}` }])); return true;
    }
  } catch (e) { await bot.sendMessage(chatId, `⚠️ ${String(e?.message || e).slice(0, 300)}\nCorrija y envíe otra vez, o /cancelar.`); return true; }
  return false;
}

module.exports = { tryCallback, tryMensaje, puede, textoFamilia };
