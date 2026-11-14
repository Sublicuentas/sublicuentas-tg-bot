"use strict";
/* SUBLICUENTAS · Bot · Spotify Familiar.
   R196o · PDF «Spotify Familiar · corrección estricta» (12/11/2026) — sustituye los flujos anteriores del bot
   (añadir varias, lista de fichas, Mover, Desvincular, clave, editar y eliminar desde el chat):
     /spotify, /spotifyf o Bodega › Spotify  →  «Spotify Familiar · Familias»: una fila por cuenta madre con ocupados/libres
       (los mismos datos que Control Maestro, Web y APK: spotify_familias) · [SP-00X] · [➕ Nueva familia] (solo Sublicuentas).
     Cuenta SP-00X → correo madre, «Invitados: n/5», los 5 renglones (correo o «— LIBRE») · [➕ Añadir correo invitado] [⬅️ Volver].
     Añadir → «Ingrese el correo del invitado» → [Guardar] [Cancelar]. Se guarda en el primer espacio libre (servidor, en
       transacción). Si hay UNA ficha Spotify con ese correo se vincula sola; si no, el espacio queda ocupado sin ficha y se
       vincula solo cuando se guarde o renueve la ficha. Nunca se muestra una lista de fichas ni se crea cliente.
     «No renovó» NO está aquí: se usa el de la ficha/renovaciones, que libera el espacio solo (lib · retirarPorBaja).
   R196p · [🗑 Eliminar correo] (solo Sublicuentas, también con 5/5): elige 1–5 de ESA familia → «¿Eliminar X de la familia
     SP-00X?» [Confirmar] [Cancelar] → lib.eliminarCorreo (misma función que Web/APK) → «Correo eliminado… 4/5».
   Permisos (en el bot, no solo ocultando botones): ver y añadir correo = administradores o vendedor con módulo Spotify
   (Relojes/Geisell); crear cuenta madre = solo Sublicuentas (super admin). No se muestra la clave de la madre.
   Lo llama index_06_handlers.js (mensajes y botones «spf:») e index_04 (Bodega). */

const { db, bot } = require("./index_01_core");
const S = require("./lib_spotify_familias");

const ESPERA_MS = 10 * 60 * 1000;
const espera = global.__SUBLI_SPOTIFY_ESPERA__ = global.__SUBLI_SPOTIFY_ESPERA__ || new Map();
const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const usuarioDe = (from = {}) => `tg:${from.id || ""}${from.username ? "@" + from.username : ""}`.slice(0, 60);
const RE_MAIL = /[^\s@:;,|<>()"'=]+@[^\s@:;,|<>()"'=]+\.[a-z0-9-]{2,24}/gi;
const MOTIVO = { no_renovo: "No renovó", quitar_servicio: "Se quitó Spotify", manual: "Eliminado" };

function puede({ adminOk = false, vend = null } = {}) {
  if (adminOk) return true;
  if (!vend) return false;
  if (vend.permisos && vend.permisos["spotify-familias"] === false) return false;
  if (vend.permisos && vend.permisos["spotify-familias"] === true) return true;
  return [vend.nombre_norm, vend.nombre, vend.id].map(norm).some((n) => ["relojes", "geisell", "geissel"].includes(n));
}
const puedeCrear = (ctx = {}) => !!ctx.superOk; // R196o · solo Sublicuentas
const enviar = (chatId, texto, rows = []) => bot.sendMessage(chatId, texto, { parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: rows } });
const fechaCorta = (iso) => { const t = Date.parse(String(iso || "")); if (!Number.isFinite(t)) return ""; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(new Date(t - 6 * 3600000).toISOString()); return `${m[3]}/${m[2]}`; }; // hora de Honduras

// Los 5 renglones en su posición (1–5).
function renglones(f) {
  const act = f.miembros.filter((m) => m.estado === "activo");
  const cap = Number(f.capacidad || 5);
  const enPos = (n) => act.find((m) => Number(m.posicion) === n);
  const sinPos = act.filter((m) => !(Number(m.posicion) >= 1 && Number(m.posicion) <= cap));
  return Array.from({ length: cap }, (_, i) => { const m = enPos(i + 1) || sinPos.shift(); return m ? `${i + 1}. ${esc(m.correo)}${m.retiroPendiente ? " · ⏳ quitar en Spotify" : ""}` : `${i + 1}. — LIBRE`; });
}
function textoFamilia(f) {
  const lineas = [`🎵 <b>Cuenta ${esc(f.codigo)}</b>`, `Madre: ${esc(f.madreCorreo)}`, `Invitados: ${f.ocupados}/${f.capacidad}`, ...renglones(f)];
  const pend = f.pendientesSpotify || [];
  if (pend.length) lineas.push("", "⚠️ <b>Falta quitar en la app de Spotify</b> (ya no ocupan espacio):", ...pend.slice(0, 5).map((p) => `• ${esc(p.correo)} · ${esc(MOTIVO[p.motivo] || p.motivo || "baja")}${fechaCorta(p.at) ? ` ${fechaCorta(p.at)}` : ""}`));
  return lineas.join("\n");
}
const lineaLista = (f) => `${esc(f.codigo)} · ${f.ocupados}/${f.capacidad} ocupados · ${f.libres} libre${f.libres === 1 ? "" : "s"}`;

async function familiasActivas() { return (await S.listarFamilias(db)).filter((f) => f.estado !== "inactiva"); }

// Lista de cuentas madre (lo que antes respondía «Disponibles: 0 / Llenas: 0»).
async function lista(chatId, ctx = {}) {
  try { await S.sincronizarTodo(db); } catch (_) {} // Bodega › Spotify Familiar al día
  espera.delete(String(chatId));
  const fs = await familiasActivas();
  const crear = puedeCrear(ctx) ? [[{ text: "➕ Nueva familia", callback_data: "spf:n" }]] : [];
  if (!fs.length) return enviar(chatId, `🎵 <b>Spotify Familiar · Familias</b>\nNo hay cuentas madre registradas.${puedeCrear(ctx) ? "" : "\nSolo Sublicuentas puede crearlas."}`, crear);
  const tot = fs.reduce((a, f) => ({ o: a.o + f.ocupados, c: a.c + f.capacidad }), { o: 0, c: 0 });
  return enviar(chatId, [`🎵 <b>Spotify Familiar · Familias</b>`, ...fs.map(lineaLista), "", `${fs.length} cuenta(s) · ${tot.o}/${tot.c} espacios ocupados.`, "Toque una cuenta para verla."].join("\n"),
    [...fs.slice(0, 60).map((f) => [{ text: `${f.codigo} · ${f.ocupados}/${f.capacidad}`, callback_data: `spf:f:${f.id}` }]), ...crear]);
}
// Vista de una cuenta (también se abre desde Bodega › Spotify Familiar).
async function verCuenta(chatId, familiaId, fam = null, ctx = {}) {
  const f = fam || await S.leerFamilia(db, familiaId);
  if (f.estado === "inactiva") return enviar(chatId, `${esc(f.codigo)} está eliminada.`, [[{ text: "⬅️ Volver", callback_data: "spf:l" }]]);
  espera.delete(String(chatId));
  const rows = [];
  if (f.libres > 0) rows.push([{ text: "➕ Añadir correo invitado", callback_data: `spf:a:${f.id}` }]);
  if (f.ocupados > 0 && puedeCrear(ctx)) rows.push([{ text: "🗑 Eliminar correo", callback_data: `spf:e:${f.id}` }]); // R196p · también con 5/5
  rows.push([{ text: "⬅️ Volver", callback_data: "spf:l" }]);
  return enviar(chatId, textoFamilia(f) + (f.libres > 0 ? "" : "\n\nCuenta llena (5/5)."), rows);
}
const botonesGuardar = (tok) => [[{ text: "✅ Guardar", callback_data: `spf:g:${tok}` }, { text: "✖️ Cancelar", callback_data: "spf:x" }]];

async function tryCallback(q, ctx = {}) {
  const data = String(q.data || ""); if (!data.startsWith("spf:")) return false;
  const chatId = q.message?.chat?.id, p = data.split(":"), k = String(chatId);
  if (!puede(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso a Spotify Familiar."); return true; }
  const u = usuarioDe(q.from);
  try {
    if (p[1] === "l" || p[1] === "m") return await lista(chatId, ctx), true;
    if (p[1] === "f") return await verCuenta(chatId, p[2] === "l" ? p[3] : p[2], null, ctx), true; // «spf:f:l:id» de mensajes viejos
    if (p[1] === "x") { const st = espera.get(k); espera.delete(k); if (st && st.familiaId) return await verCuenta(chatId, st.familiaId, null, ctx), true; await bot.sendMessage(chatId, "Cancelado. No se guardó nada."); return true; }
    if (p[1] === "a") { // Agregar correo · SP-00X
      const f = await S.leerFamilia(db, p[2]);
      if (f.estado === "inactiva") { await enviar(chatId, `${esc(f.codigo)} está eliminada.`); return true; }
      if (f.libres <= 0) return await verCuenta(chatId, f.id, f, ctx), true;
      espera.set(k, { paso: "correo_invitado", familiaId: f.id, at: Date.now() });
      await enviar(chatId, `<b>Agregar correo · ${esc(f.codigo)}</b> (${f.ocupados}/${f.capacidad})\nIngrese el correo del invitado:`, [[{ text: "✖️ Cancelar", callback_data: "spf:x" }]]); return true;
    }
    if (p[1] === "n" || p[1] === "c" || p[1] === "b") { // Nueva familia (los botones viejos «Añadir cuenta/varias» caen aquí)
      if (!puedeCrear(ctx)) { await bot.sendMessage(chatId, "⛔ Solo Sublicuentas puede crear cuentas madre."); return true; }
      espera.set(k, { paso: "correo_madre_nueva", at: Date.now() });
      await enviar(chatId, "<b>Nueva familia</b>\nIngrese el correo madre:", [[{ text: "✖️ Cancelar", callback_data: "spf:x" }]]); return true;
    }
    if (p[1] === "g") { // Guardar (un solo toque: el estado se borra antes de escribir)
      const st = espera.get(k);
      if (!st || st.paso !== "confirmar" || st.tok !== p[2]) { await bot.sendMessage(chatId, "Eso ya se guardó o venció. Vuelva a abrir /spotify."); return true; }
      espera.delete(k);
      if (st.tipo === "madre") {
        if (!puedeCrear(ctx)) { await bot.sendMessage(chatId, "⛔ Solo Sublicuentas puede crear cuentas madre."); return true; }
        const f = await S.crearFamilia(db, { madreCorreo: st.correo, usuario: u });
        await enviar(chatId, `✅ Cuenta creada: <b>${esc(f.codigo)}</b>`); return await verCuenta(chatId, f.id, null, ctx), true;
      }
      const r = await S.agregarPorCorreo(db, { familiaId: st.familiaId, correo: st.correo, usuario: u }); // mismo servidor que Web/APK
      const fam = r.familia;
      const nota = r.varias ? `\nHay ${r.varias} fichas con ese correo: se vincula sola cuando se guarde o renueve la ficha correcta.` : r.pendienteVincular ? "\nSin ficha Spotify con ese correo todavía: se vincula sola cuando se registre." : r.ficha ? `\nFicha: ${esc(r.ficha.clienteNombre || r.ficha.clienteId)}` : "";
      await enviar(chatId, fam.idempotente ? `▫️ ${esc(st.correo)} ya estaba en ${esc(fam.codigo)}: no se duplicó.` : `✅ ${esc(st.correo)} agregado a <b>${esc(fam.codigo)}</b> · ${fam.ocupados}/${fam.capacidad}${nota}`);
      return await verCuenta(chatId, fam.id, null, ctx), true;
    }
    // R196p · Eliminar correo: los invitados de ESA familia (1–5) → «¿Eliminar X de la familia SP-00X?» → Confirmar/Cancelar.
    if (p[1] === "e" || p[1] === "ep" || p[1] === "eok") {
      if (!puedeCrear(ctx)) { await bot.sendMessage(chatId, "⛔ Solo Sublicuentas puede eliminar correos de Spotify Familiar."); return true; }
      if (p[1] === "e") {
        const f = await S.leerFamilia(db, p[2]); espera.delete(k);
        const act = f.miembros.filter((x) => x.estado === "activo").sort((a, b) => Number(a.posicion) - Number(b.posicion));
        if (!act.length) return await verCuenta(chatId, f.id, f, ctx), true;
        await enviar(chatId, `<b>Eliminar correo · ${esc(f.codigo)}</b> (${f.ocupados}/${f.capacidad})\n¿Cuál correo se retira?`,
          [...act.map((x) => [{ text: `${x.posicion}. ${x.correo}`, callback_data: `spf:ep:${f.id}:${x.posicion}` }]), [{ text: "✖️ Cancelar", callback_data: `spf:f:${f.id}` }]]);
        return true;
      }
      if (p[1] === "ep") {
        const f = await S.leerFamilia(db, p[2]); const m = f.miembros.find((x) => x.estado === "activo" && String(x.posicion) === String(p[3]));
        if (!m) { await enviar(chatId, "Ese espacio ya está libre: no se cambió nada."); return await verCuenta(chatId, f.id, f, ctx), true; }
        const tok = Date.now().toString(36);
        espera.set(k, { paso: "eliminar", familiaId: f.id, correo: m.correo, tok, at: Date.now() });
        await enviar(chatId, `¿Eliminar ${esc(m.correo)} de la familia ${esc(f.codigo)}?`, [[{ text: "✅ Confirmar", callback_data: `spf:eok:${tok}` }, { text: "✖️ Cancelar", callback_data: `spf:f:${f.id}` }]]);
        return true;
      }
      const st = espera.get(k); // eok
      if (!st || st.paso !== "eliminar" || st.tok !== p[2]) { await bot.sendMessage(chatId, "Eso ya se hizo o venció. Vuelva a abrir /spotify."); return true; }
      espera.delete(k);
      const r = await S.eliminarCorreo(db, { familiaId: st.familiaId, correo: st.correo, usuario: u, motivo: "manual" }); // misma función que Web/APK
      await enviar(chatId, r.yaEstaba ? `▫️ ${esc(r.aviso)}` : `✅ Correo eliminado de ${esc(r.codigo)}. Espacios ocupados: ${r.ocupados}/${r.capacidad}\nFalta quitarlo en la app de Spotify (Sublichat no puede hacerlo).`);
      return await verCuenta(chatId, st.familiaId, null, ctx), true;
    }
    // Botones de mensajes viejos (Mover, Desvincular, lista de fichas, clave, editar, eliminar…): ya no existen.
    await enviar(chatId, "Esa opción ya no existe. Los espacios se liberan solos con «No renovó» en la ficha.", [[{ text: "🎵 Ver familias", callback_data: "spf:l" }]]);
  } catch (e) { await bot.sendMessage(chatId, `⚠️ ${esc(String(e?.message || e).slice(0, 300))}`); return true; }
  return true;
}

async function tryMensaje(msg, ctx = {}) {
  const text = String(msg?.text || "").trim(), chatId = msg?.chat?.id, k = String(chatId);
  if (/^\/(spotify|spotifyf|spotify_familiar|spotifyfamiliar)(@\w+)?(\s|$)/i.test(text)) { // R196o · /spotify ya no es el inventario vacío
    if (!puede(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso a Spotify Familiar."); return true; }
    await lista(chatId, ctx); return true;
  }
  const st = espera.get(k); if (!st) return false;
  if (Date.now() - st.at > ESPERA_MS) { espera.delete(k); return false; }
  if (/^\/cancelar\b/i.test(text)) { espera.delete(k); await bot.sendMessage(chatId, "Cancelado."); return true; }
  if (/^(menu|menú|inicio|start)$/i.test(text)) { espera.delete(k); return false; }
  if (text.startsWith("/") || !["correo_invitado", "correo_madre_nueva"].includes(st.paso)) return false;
  if (!puede(ctx)) { espera.delete(k); return false; }
  try {
    const correos = [...new Set((text.match(RE_MAIL) || []).map(S.normCorreo))];
    const c = correos.length === 1 ? S.correoValido(correos[0]) : "";
    if (!c) { await enviar(chatId, correos.length > 1 ? "Escriba un solo correo." : "Eso no es un correo válido. Escriba el correo completo (ej. cliente@gmail.com).", [[{ text: "✖️ Cancelar", callback_data: "spf:x" }]]); return true; }
    const r = await S.resolverCorreo(db, c); // validación previa con motivo legible (el servidor vuelve a validar al guardar)
    const tok = Date.now().toString(36);
    if (st.paso === "correo_madre_nueva") {
      if (!puedeCrear(ctx)) { espera.delete(k); await bot.sendMessage(chatId, "⛔ Solo Sublicuentas puede crear cuentas madre."); return true; }
      if (r) { await enviar(chatId, r.tipo === "madre" ? `⛔ Ese correo ya es la madre de ${esc(r.codigo)}.` : `⛔ Ese correo está como invitado en ${esc(r.codigo)}: no puede ser madre.`, [[{ text: "✖️ Cancelar", callback_data: "spf:x" }]]); return true; }
      espera.set(k, { paso: "confirmar", tipo: "madre", correo: c, tok, at: Date.now() });
      await enviar(chatId, `<b>Nueva familia</b>\nMadre: ${esc(c)}\n5 espacios libres.`, botonesGuardar(tok)); return true;
    }
    const f = await S.leerFamilia(db, st.familiaId);
    if (r && r.tipo === "invitado" && r.familiaId === f.id) { await enviar(chatId, `▫️ ${esc(c)} ya está en ${esc(f.codigo)}.`, [[{ text: "⬅️ Volver", callback_data: `spf:f:${f.id}` }]]); espera.delete(k); return true; }
    if (r) { await enviar(chatId, r.tipo === "madre" ? `⛔ Ese correo es la madre de ${esc(r.codigo)}: no puede ser invitado.` : `⛔ Ese correo ya está en ${esc(r.codigo)}. Un correo solo puede estar en una cuenta.`, [[{ text: "✖️ Cancelar", callback_data: "spf:x" }]]); return true; }
    if (c === S.normCorreo(f.madreCorreo)) { await enviar(chatId, "⛔ Ese es el correo madre de esta cuenta.", [[{ text: "✖️ Cancelar", callback_data: "spf:x" }]]); return true; }
    if (f.libres <= 0) { espera.delete(k); await enviar(chatId, `⛔ ${esc(f.codigo)} está llena (${f.capacidad}/${f.capacidad}). No se agregó nada.`, [[{ text: "⬅️ Volver", callback_data: `spf:f:${f.id}` }]]); return true; }
    espera.set(k, { paso: "confirmar", tipo: "invitado", familiaId: f.id, correo: c, tok, at: Date.now() });
    await enviar(chatId, `<b>Agregar correo · ${esc(f.codigo)}</b>\nInvitado: ${esc(c)}\nQuedará ${f.ocupados + 1}/${f.capacidad}.`, botonesGuardar(tok)); return true;
  } catch (e) { await bot.sendMessage(chatId, `⚠️ ${esc(String(e?.message || e).slice(0, 300))}\nCorrija y envíe otra vez, o /cancelar.`); return true; }
}

module.exports = { lista, verCuenta, tryCallback, tryMensaje, puede, puedeCrear, textoFamilia };
