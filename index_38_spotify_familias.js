"use strict";
/* SUBLICUENTAS · Bot · R188 · Spotify Familiar (PDF «Sublichat 5 puntos», bloque 01) — registro rápido desde Telegram.
   /spotifyf → ➕ Añadir cuenta · 📥 Añadir varias cuentas (en bloque) · 👤 Agregar invitado · 🔍 Ver cuentas.
   R196d · «Agregar invitado» acepta uno o VARIOS correos sueltos escritos (con o sin ficha). La ficha que usa el correo
   madre (cuenta completa vendida) se muestra como «Cliente de la cuenta madre» y no ocupa espacio.
   R196c · Cuenta madre como Netflix Premium: clave (oculta; «👁 Ver clave» la muestra), editar correo madre y eliminar
   cuenta (solo vacía; no se pierde nada). La clave se puede pegar al añadir: «madre@gmail.com Clave123». El mensaje con
   la clave se borra del chat y la clave nunca se repite en la revisión ni en la auditoría.
   R196b · Comando propio /spotifyf (/spotify sigue siendo el inventario). «Añadir varias»: UNA cuenta madre por línea
   (invitados solo con «madre: inv1, inv2» en la misma línea). Agregar invitado = ELEGIR la ficha Spotify de una lista.
   R196 · Alta en bloque: se pegan cuentas (correo madre + hasta 5 invitados), el bot muestra una REVISIÓN y solo guarda al
   tocar «Guardar». Solo se guardan correos: cualquier otro texto (p. ej. contraseñas) se ignora y no se repite en el chat.
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

function textoFamilia(f) { // R196 · siempre 5 renglones, en su posición
  const act = f.miembros.filter((m) => m.estado === "activo");
  const cap = Number(f.capacidad || 5);
  const enPos = (n) => act.find((m) => Number(m.posicion) === n);
  const sinPos = act.filter((m) => !(Number(m.posicion) >= 1 && Number(m.posicion) <= cap));
  const filas = Array.from({ length: cap }, (_, i) => {
    const m = enPos(i + 1) || sinPos.shift();
    return m ? `${i + 1}. ${esc(m.correo)}${m.clienteNombre ? ` · ${esc(m.clienteNombre)}` : ""}${m.estadoInvitacion === "pendiente" ? " · ⏳ pendiente" : ""}` : `${i + 1}. — libre`;
  });
  return [`🎵 <b>Cuenta ${esc(f.codigo)}</b> · ${f.ocupados}/${cap}`, `Madre: ${esc(f.madreCorreo)}`, ...(f.madreClientes || []).map((x) => `👤 Cliente de la cuenta madre: ${esc(x.cliente || x.clienteId)}${x.vence ? ` · vence ${x.vence.split("-").reverse().join("/")}${x.vencido ? " 🔴" : ""}` : ""}`), `Clave: ${f.tieneClave ? "🔒 guardada" : "— sin guardar"}`, "", ...filas].join("\n");
}
async function menu(chatId) {
  return enviar(chatId, "🎵 <b>Spotify Familiar</b>\nCada cuenta = 1 correo madre + hasta 5 invitados.", [
    [{ text: "➕ Añadir cuenta", callback_data: "spf:c" }, { text: "📥 Añadir varias", callback_data: "spf:b" }],
    [{ text: "👤 Agregar invitado a una cuenta", callback_data: "spf:a" }],
    [{ text: "🔍 Ver cuentas", callback_data: "spf:l" }],
  ]);
}

// ---------------------------------------------------------------- R196 · Añadir cuenta(s): pegar → revisar → guardar
const MAX_CUENTAS = 30, MAX_TEXTO = 3700;
const RE_MAIL = /[^\s@:;,|<>()"'=]+@[^\s@:;,|<>()"'=]+\.[a-z0-9-]{2,24}/gi;
const AYUDA_UNA = "➕ <b>Añadir cuenta</b>\nPegue el <b>correo madre</b> y su clave en la misma línea (la clave es opcional). Debajo, si quiere, hasta 5 invitados (uno por línea).\n\n<code>madre@gmail.com Clave123\ninvitado1@gmail.com\ninvitado2@gmail.com</code>\n\nBorro su mensaje del chat por la clave. /cancelar para salir.";
const AYUDA_VARIAS = "📥 <b>Añadir varias cuentas</b>\nUn <b>correo madre por línea</b>, con su clave al lado (opcional): cada línea es una cuenta nueva.\n\n<code>madre1@gmail.com Clave123\nmadre2@gmail.com Clave456\nmadre3@gmail.com</code>\n\nSi quiere poner invitados de una vez, en la MISMA línea con dos puntos (sin clave):\n<code>madre4@gmail.com: inv1@gmail.com, inv2@gmail.com</code>\n\nLos invitados también se agregan después con «👤 Agregar invitado», eligiendo la ficha de la lista.\nAntes de guardar le muestro una revisión (sin mostrar claves). Máx. " + MAX_CUENTAS + " cuentas. /cancelar para salir.";

// Texto pegado → cuentas. Lo que no es correo se ignora (sin repetirlo en el chat).
// · modo "b" (varias): cada línea es UNA cuenta; el primer correo es la madre y los de esa misma línea, invitados.
// · modo "c" (una):    el primer correo es la madre y los de abajo son sus invitados.
function parsearCuentas(texto = "", modo = "b") {
  const cuentas = [], avisos = []; let actual = null;
  const SOBRA = /^(?:[:;,|•*\-–>=]+|\d+[.)]?|madre|admin|administradora?|invitados?|cuenta|familia|correo|clave|contraseña|contrasena|pass(?:word)?)[:=]?$/i;
  String(texto).split(/\r?\n/).forEach((linea, i) => {
    const l = linea.trim(); if (!l) return;
    const correos = (l.match(RE_MAIL) || []).map(S.normCorreo);
    const tokens = l.replace(RE_MAIL, " ").split(/[\s,]+/).map((t) => t.replace(/^[:;=|]+/, "")).filter((t) => t && !SOBRA.test(t));
    const esMadre = correos.length && (modo !== "c" || !actual);
    let clave = "";
    if (esMadre && correos.length === 1 && tokens.length === 1) clave = tokens[0].slice(0, 120); // «madre@gmail.com Clave123» → clave de la cuenta madre
    else if (tokens.length) avisos.push(`Línea ${i + 1}: se ignoró texto que no es correo${correos.length > 1 ? " (la clave va solo en una línea con el correo madre solo)" : ""}.`);
    if (!correos.length) return;
    if (modo === "c") { if (!actual) { actual = { linea: i + 1, correos: [], clave }; cuentas.push(actual); } actual.correos.push(...correos); return; }
    cuentas.push({ linea: i + 1, correos, clave });
  });
  return { cuentas: cuentas.map((c) => ({ linea: c.linea, madre: c.correos[0], clave: c.clave || "", invitados: c.correos.slice(1) })), avisos };
}
// Fichas Spotify sin familia, por correo exacto (UNA lectura de clientes para todo el bloque).
async function indiceFichas() {
  const mapa = new Map(); const s = await db.collection("clientes").get();
  s.forEach((d) => {
    const c = d.data() || {};
    (Array.isArray(c.servicios) ? c.servicios : []).forEach((sv) => {
      if (!sv || !S.esPlataformaSpotify(sv.plataforma) || sv.spotifyFamiliaId) return;
      const correo = S.normCorreo(sv.correo || (sv.perfiles && sv.perfiles[0] && sv.perfiles[0].correo)); if (!correo) return;
      (mapa.get(correo) || mapa.set(correo, []).get(correo)).push({ clienteId: d.id, clienteNombre: String(c.nombrePerfil || c.nombre || "").slice(0, 60), compraId: String(sv.compraId || "") });
    });
  });
  return mapa;
}
// Revisión SIN escribir nada: qué se crea, qué ya existe, qué se bloquea (solo esa línea).
async function planearAlta(texto, modo = "b") {
  const { cuentas, avisos } = parsearCuentas(texto, modo);
  if (!cuentas.length) throw new Error("No encontré correos. Pegue al menos el correo madre.");
  if (cuentas.length > MAX_CUENTAS) throw new Error(`Son ${cuentas.length} cuentas: envíe máximo ${MAX_CUENTAS} por mensaje.`);
  const fichas = await indiceFichas(); const vistos = new Map(); const plan = [];
  for (const c of cuentas) {
    const e = { linea: c.linea, madre: c.madre, clave: c.clave || "", tipo: "nueva", familiaId: "", codigo: "", ocupados: 0, error: "", invitados: [] };
    const dupM = vistos.get(c.madre);
    if (!S.correoValido(c.madre)) e.error = "correo madre inválido";
    else if (dupM) e.error = `repetido (línea ${dupM})`;
    vistos.set(c.madre, c.linea);
    let libres = S.CAPACIDAD, actuales = new Set();
    if (!e.error) {
      const r = await S.resolverCorreo(db, c.madre);
      if (r && r.tipo === "invitado") e.error = `es invitado en ${r.codigo}`;
      else if (r && r.tipo === "madre") {
        const f = await S.leerFamilia(db, r.familiaId);
        Object.assign(e, { tipo: "existente", familiaId: f.id, codigo: f.codigo, ocupados: f.ocupados }); libres = f.libres;
        actuales = new Set(f.miembros.filter((m) => m.estado === "activo").map((m) => S.normCorreo(m.correo)));
      }
    }
    if (c.invitados.length > S.CAPACIDAD) e.error = e.error || `trae ${c.invitados.length} invitados (máx. ${S.CAPACIDAD})`;
    for (const inv of c.invitados) {
      const it = { correo: inv, estado: "ok", ficha: null, nota: "" };
      const dup = vistos.get(inv);
      if (e.error) { it.estado = "error"; it.nota = "cuenta bloqueada"; }
      else if (!S.correoValido(inv)) { it.estado = "error"; it.nota = "correo inválido"; }
      else if (inv === c.madre) { it.estado = "error"; it.nota = "es el correo madre"; }
      else if (dup) { it.estado = "error"; it.nota = `repetido (línea ${dup})`; }
      else if (actuales.has(inv)) { it.estado = "ya"; it.nota = "ya estaba en esta cuenta"; }
      else {
        const r = await S.resolverCorreo(db, inv);
        if (r) { it.estado = "error"; it.nota = r.tipo === "madre" ? `es madre de ${r.codigo}` : `ya está en ${r.codigo}`; }
        else if (libres <= 0) { it.estado = "error"; it.nota = "sin espacio (5/5)"; }
        else {
          libres--;
          const fs = fichas.get(inv) || [];
          if (fs.length === 1) it.ficha = fs[0];
          else if (fs.length > 1) it.nota = "varias fichas con ese correo: vincule la correcta después";
        }
      }
      if (S.correoValido(inv) && !dup) vistos.set(inv, c.linea);
      e.invitados.push(it);
    }
    plan.push(e);
  }
  const ok = plan.filter((e) => !e.error);
  const resumen = { cuentasNuevas: ok.filter((e) => e.tipo === "nueva").length, cuentasExistentes: ok.filter((e) => e.tipo === "existente").length,
    invitados: ok.reduce((a, e) => a + e.invitados.filter((i) => i.estado === "ok").length, 0), fichas: ok.reduce((a, e) => a + e.invitados.filter((i) => i.estado === "ok" && i.ficha).length, 0),
    errores: plan.filter((e) => e.error).length + plan.reduce((a, e) => a + (e.error ? 0 : e.invitados.filter((i) => i.estado === "error").length), 0) };
  resumen.claves = ok.filter((e) => e.clave).length;
  resumen.guardables = resumen.cuentasNuevas + resumen.invitados + resumen.claves;
  return { plan, avisos, resumen };
}
function textoRevision({ plan, avisos, resumen }) {
  const r = resumen;
  const cab = [`📋 <b>Revisión antes de guardar</b>`, `${r.cuentasNuevas} cuenta(s) nueva(s) · ${r.cuentasExistentes} existente(s) · ${r.invitados} invitado(s) · ${r.fichas} ficha(s) vinculada(s)${r.errores ? ` · ⛔ ${r.errores} con error` : ""}`, ""];
  const cuerpo = [];
  plan.forEach((e, n) => {
    const nuevos = e.invitados.filter((i) => i.estado === "ok").length;
    const estado = e.error ? `⛔ ${esc(e.error)}` : e.tipo === "nueva" ? `🆕 nueva · quedará ${nuevos}/${S.CAPACIDAD}` : `ya existe ${esc(e.codigo)} · ${e.ocupados} → ${e.ocupados + nuevos}/${S.CAPACIDAD}`;
    cuerpo.push(`<b>${n + 1}) ${esc(e.madre)}</b> — ${estado}${e.clave && !e.error ? " · 🔑 clave" : ""}`); // la clave nunca se muestra
    e.invitados.forEach((i) => cuerpo.push(`   ${i.estado === "ok" ? "✅" : i.estado === "ya" ? "▫️" : "⛔"} ${esc(i.correo)}${i.ficha ? ` · ficha de ${esc(i.ficha.clienteNombre || i.ficha.clienteId)}` : ""}${i.nota ? ` · ${esc(i.nota)}` : ""}`));
    if (!e.invitados.length && !e.error) cuerpo.push("   (sin invitados por ahora)");
  });
  let txt = cab.concat(cuerpo).join("\n");
  if (avisos.length) txt += `\n\n⚠️ ${avisos.slice(0, 5).map(esc).join("\n⚠️ ")}${avisos.length > 5 ? `\n… y ${avisos.length - 5} aviso(s) más` : ""}`;
  if (txt.length > MAX_TEXTO) txt = txt.slice(0, MAX_TEXTO).replace(/\n[^\n]*$/, "") + "\n… (lista recortada; se guarda completa)";
  txt += r.guardables ? `\n\nSolo se guardan las líneas ✅. Las ⛔ no se tocan. ¿Guardar?` : `\n\nNo hay nada nuevo para guardar. Corrija y vuelva a pegar, o /cancelar.`;
  return txt;
}
async function guardarAlta(plan, usuario) {
  const res = { cuentas: 0, invitados: 0, fichas: 0, fallos: [] , codigos: [] };
  for (const e of plan) {
    if (e.error) continue;
    let familiaId = e.familiaId, codigo = e.codigo;
    if (e.tipo === "nueva") {
      try { const f = await S.crearFamilia(db, { madreCorreo: e.madre, usuario }); familiaId = f.id; codigo = f.codigo; res.cuentas++; }
      catch (err) { // carrera o doble toque: si ya quedó creada, se usa esa misma (idempotente)
        const r = await S.resolverCorreo(db, e.madre).catch(() => null);
        if (r && r.tipo === "madre") { familiaId = r.familiaId; codigo = r.codigo; } else { res.fallos.push(`${e.madre}: ${String(err.message || err).slice(0, 120)}`); continue; }
      }
    }
    if (e.clave) { try { await S.guardarClaveMadre(db, { familiaId, clave: e.clave, usuario }); res.claves = (res.claves || 0) + 1; } catch (err) { res.fallos.push(`${e.madre}: clave no guardada (${String(err.message || err).slice(0, 80)})`); } }
    for (const i of e.invitados) {
      if (i.estado !== "ok") continue;
      try {
        const f = await S.vincularInvitado(db, { familiaId, correo: i.correo, clienteId: i.ficha ? i.ficha.clienteId : "", compraId: i.ficha ? i.ficha.compraId : "", usuario });
        if (!f.idempotente) { res.invitados++; if (i.ficha) res.fichas++; }
      } catch (err) { res.fallos.push(`${i.correo}: ${String(err.message || err).slice(0, 120)}`); }
    }
    if (codigo) res.codigos.push(codigo);
  }
  return res;
}

// ---------------------------------------------------------------- R196b · elegir la ficha Spotify (sin escribir el correo)
const POR_PAGINA = 8;
async function opcionesFichas(filtro = "") {
  const ocupados = new Set();
  for (const f of await S.listarFamilias(db)) { ocupados.add(S.normCorreo(f.madreCorreo)); f.miembros.filter((m) => m.estado === "activo").forEach((m) => ocupados.add(S.normCorreo(m.correo))); }
  const t = S.normCorreo(filtro); const out = [];
  for (const [correo, fs] of await indiceFichas()) {
    if (ocupados.has(correo)) continue;
    for (const x of fs) if (!t || correo.includes(t) || S.normCorreo(x.clienteNombre).includes(t)) out.push({ correo, ...x });
  }
  return out.sort((a, b) => String(a.clienteNombre).localeCompare(String(b.clienteNombre), "es") || a.correo.localeCompare(b.correo));
}
async function mostrarSelector(chatId, st, encabezado = "") {
  const f = await S.leerFamilia(db, st.familiaId);
  const tot = st.opciones.length, pags = Math.max(1, Math.ceil(tot / POR_PAGINA)); st.pagina = Math.min(Math.max(0, st.pagina || 0), pags - 1);
  const ini = st.pagina * POR_PAGINA;
  const corto = (v, n) => (v.length > n ? v.slice(0, n - 1) + "…" : v);
  const rows = f.libres > 0 ? st.opciones.slice(ini, ini + POR_PAGINA).map((o, j) => [{ text: corto(`${o.correo} · ${o.clienteNombre || "sin nombre"}`, 60), callback_data: `spf:pi:${ini + j}` }]) : [];
  const nav = []; if (st.pagina > 0) nav.push({ text: "‹ Anterior", callback_data: "spf:pp:-1" }); if (st.pagina < pags - 1) nav.push({ text: "Siguiente ›", callback_data: "spf:pp:1" });
  if (nav.length && f.libres > 0) rows.push(nav);
  rows.push([{ text: "✅ Listo", callback_data: `spf:f:l:${f.id}` }]);
  const guia = f.libres <= 0 ? "Cuenta llena (5/5)." : tot ? `Toque la ficha para vincularla (${tot} sin cuenta${st.filtro ? ` con «${esc(st.filtro)}»` : ""}). También puede escribir parte del correo o nombre para buscar, o el correo completo de un invitado nuevo.` : `No hay fichas Spotify sin cuenta${st.filtro ? ` con «${esc(st.filtro)}»` : ""}. Escriba el correo del invitado (o parte de él para buscar).`;
  espera.set(String(chatId), st);
  return enviar(chatId, `${encabezado ? encabezado + "\n\n" : ""}${textoFamilia(f)}\n\n${guia}`, rows);
}

async function borrarMensaje(msg) { try { if (typeof bot.deleteMessage !== "function" || !msg?.message_id) return false; await bot.deleteMessage(msg.chat.id, msg.message_id); return true; } catch (_) { return false; } }
async function elegirFamilia(chatId, accion) {
  const fs = (await S.listarFamilias(db)).filter((f) => f.estado !== "inactiva" && (accion === "l" || f.libres > 0));
  if (!fs.length) return enviar(chatId, accion === "l" ? "No hay cuentas familiares todavía. Use «➕ Añadir cuenta»." : "No hay cuentas con espacios libres.");
  return enviar(chatId, "Elija la cuenta:", fs.slice(0, 40).map((f) => [{ text: `${f.codigo} · ${f.madreCorreo} · ${f.ocupados}/${f.capacidad}`, callback_data: `spf:f:${accion}:${f.id}` }]));
}

async function tryCallback(q, ctx = {}) {
  const data = String(q.data || ""); if (!data.startsWith("spf:")) return false;
  const chatId = q.message?.chat?.id, p = data.split(":"), k = String(chatId);
  if (!puede(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso a Spotify Familiar."); return true; }
  const u = usuarioDe(q.from);
  try {
    if (p[1] === "m") return await menu(chatId), true;
    if (p[1] === "c" || p[1] === "b") { espera.set(k, { paso: "alta", modo: p[1], at: Date.now() }); await enviar(chatId, p[1] === "c" ? AYUDA_UNA : AYUDA_VARIAS); return true; } // R196
    if (p[1] === "g") { // R196 · guardar la revisión (un solo toque: el estado se borra antes de escribir)
      const st = espera.get(k);
      if (!st || st.paso !== "revision" || !st.revision || st.revision.id !== p[2]) { await bot.sendMessage(chatId, "Esa revisión ya se guardó o venció. Vuelva a pegar las cuentas."); return true; }
      espera.delete(k);
      const r = await guardarAlta(st.revision.plan, u);
      await enviar(chatId, [`✅ <b>Guardado</b>`, `${r.cuentas} cuenta(s) nueva(s) · ${r.invitados} invitado(s) · ${r.fichas} ficha(s) vinculada(s)${r.claves ? ` · ${r.claves} clave(s) guardada(s)` : ""}`, r.codigos.length ? `Cuentas: ${[...new Set(r.codigos)].map(esc).join(", ")}` : "", r.fallos.length ? `\n⛔ No se guardó:\n${r.fallos.slice(0, 10).map(esc).join("\n")}` : "", "Web, APK y Control Maestro ya lo ven."].filter(Boolean).join("\n"),
        [[{ text: "➕ Añadir más", callback_data: "spf:b" }, { text: "🔍 Ver cuentas", callback_data: "spf:l" }]]);
      return true;
    }
    if (p[1] === "x") { espera.delete(k); await bot.sendMessage(chatId, "Cancelado. No se guardó nada."); return true; }
    if (p[1] === "kv") { // R196c · ver clave (solo a quien la pide)
      const r = await S.leerClaveMadre(db, p[2]);
      await enviar(chatId, r.madreClave ? `🔑 <b>${esc(r.codigo)}</b> · ${esc(r.madreCorreo)}\nClave: <code>${esc(r.madreClave)}</code>` : `${esc(r.codigo)} no tiene clave guardada.`, [[{ text: "⬅️ Volver a la cuenta", callback_data: `spf:f:l:${p[2]}` }]]); return true;
    }
    if (p[1] === "kc" || p[1] === "em") {
      const f = await S.leerFamilia(db, p[2]);
      espera.set(k, { paso: p[1] === "kc" ? "clave" : "correo_madre", familiaId: f.id, at: Date.now() });
      await enviar(chatId, p[1] === "kc" ? `🔑 Envíe la <b>clave</b> de ${esc(f.madreCorreo)} (${esc(f.codigo)}). Borro su mensaje del chat al guardarla. /cancelar para salir.` : `✏️ Envíe el <b>correo madre nuevo</b> para ${esc(f.codigo)} (ahora: ${esc(f.madreCorreo)}). Se conservan los invitados, sus posiciones y las fichas. /cancelar para salir.`); return true;
    }
    if (p[1] === "del") {
      const f = await S.leerFamilia(db, p[2]);
      if (f.ocupados) { await enviar(chatId, `${esc(f.codigo)} tiene ${f.ocupados} invitado(s). Muévalos o desvincúlelos primero; así no se pierde ningún cliente.`, [[{ text: "⬅️ Volver a la cuenta", callback_data: `spf:f:l:${f.id}` }]]); return true; }
      await enviar(chatId, `🗑 ¿Eliminar la cuenta <b>${esc(f.codigo)}</b> (${esc(f.madreCorreo)})?\nQueda en el historial; el correo se puede volver a usar.`, [[{ text: `Sí, eliminar ${f.codigo}`, callback_data: `spf:delok:${f.id}` }], [{ text: "No", callback_data: `spf:f:l:${f.id}` }]]); return true;
    }
    if (p[1] === "delok") {
      const r = await S.eliminarCuenta(db, { familiaId: p[2], confirmo: true, usuario: u }); espera.delete(k);
      await enviar(chatId, r.yaEstaba ? `${esc(r.codigo)} ya estaba eliminada.` : `✅ Cuenta ${esc(r.codigo)} eliminada (${esc(r.madreCorreo)}).`, [[{ text: "🔍 Ver cuentas", callback_data: "spf:l" }]]); return true;
    }
    if (p[1] === "v") return await elegirFamilia(chatId, "a"), true; // R196b · «Vincular existente» = elegir ficha
    if (p[1] === "pp" || p[1] === "pi") { // R196b · selector de fichas
      const st = espera.get(k);
      if (!st || st.paso !== "agregar_correo" || !st.opciones) { await bot.sendMessage(chatId, "Vuelva a tocar «👤 Agregar invitado» (/spotifyf)."); return true; }
      st.at = Date.now();
      if (p[1] === "pp") { st.pagina = (st.pagina || 0) + Number(p[2] || 0); await mostrarSelector(chatId, st); return true; }
      const o = st.opciones[Number(p[2])];
      if (!o) { await mostrarSelector(chatId, st, "Esa opción ya no está."); return true; }
      const f = await S.vincularInvitado(db, { familiaId: st.familiaId, correo: o.correo, clienteId: o.clienteId, compraId: o.compraId, usuario: u });
      st.opciones = st.opciones.filter((x) => x.correo !== o.correo);
      await mostrarSelector(chatId, st, f.idempotente ? `▫️ ${esc(o.correo)} ya estaba en ${esc(f.codigo)}.` : `✅ Vinculada la ficha de ${esc(o.clienteNombre || o.correo)} · ${esc(f.codigo)} ${f.ocupados}/${f.capacidad}`); return true;
    }
    if (p[1] === "a" || p[1] === "l") return await elegirFamilia(chatId, p[1]), true;
    if (p[1] === "f") {
      const f = await S.leerFamilia(db, p[3]);
      if (p[2] === "l") {
        try { f.madreClientes = await S.clientesDeMadre(db, f.madreCorreo, { hoy: new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10) }); } catch (_) {}
        const rows = f.miembros.filter((m) => m.estado === "activo").map((m) => [{ text: `↔️ Mover ${m.correo}`, callback_data: `spf:mv:${m.id}` }, { text: "Desvincular", callback_data: `spf:d:${m.id}` }]);
        rows.push([{ text: "👁 Ver clave", callback_data: `spf:kv:${f.id}` }, { text: f.tieneClave ? "🔑 Cambiar clave" : "🔑 Guardar clave", callback_data: `spf:kc:${f.id}` }]); // R196c
        rows.push([{ text: "✏️ Editar correo", callback_data: `spf:em:${f.id}` }, { text: "🗑 Eliminar cuenta", callback_data: `spf:del:${f.id}` }]);
        if (f.libres > 0) rows.push([{ text: "👤 Agregar invitado", callback_data: `spf:f:a:${f.id}` }]);
        espera.set(k, { paso: "ver", familiaId: f.id, miembros: f.miembros, at: Date.now() });
        await enviar(chatId, textoFamilia(f), rows); return true;
      }
      const st = { paso: "agregar_correo", familiaId: f.id, opciones: await opcionesFichas(), pagina: 0, filtro: "", at: Date.now() };
      await mostrarSelector(chatId, st); return true;
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
  if (/^\/(spotifyf|spotify_familiar)(@\w+)?(\s|$)/i.test(text)) { /* R196b · /spotify queda para el inventario */ if (!puede(ctx)) { await bot.sendMessage(chatId, "⛔ No tiene acceso a Spotify Familiar."); return true; } await menu(chatId); return true; }
  const st = espera.get(k); if (!st) return false;
  if (Date.now() - st.at > ESPERA_MS) { espera.delete(k); return false; }
  if (/^\/cancelar\b/i.test(text)) { espera.delete(k); await bot.sendMessage(chatId, "Cancelado."); return true; }
  if (text.startsWith("/") || !["madre", "alta", "revision", "agregar_correo", "vincular_correo", "clave", "correo_madre"].includes(st.paso)) return false;
  if (!puede(ctx)) { espera.delete(k); return false; }
  const u = usuarioDe(msg.from);
  try {
    if (st.paso === "clave") { // R196c
      const r = await S.guardarClaveMadre(db, { familiaId: st.familiaId, clave: text, usuario: u }); espera.delete(k);
      const borrado = await borrarMensaje(msg);
      await enviar(chatId, `✅ Clave ${r.tenia ? "cambiada" : "guardada"} · ${esc(r.codigo)}${borrado ? " (borré su mensaje)" : " · borre su mensaje con la clave"}`, [[{ text: "⬅️ Volver a la cuenta", callback_data: `spf:f:l:${st.familiaId}` }]]); return true;
    }
    if (st.paso === "correo_madre") {
      const r = await S.cambiarCorreoMadre(db, { familiaId: st.familiaId, correoNuevo: text, usuario: u }); espera.delete(k);
      await enviar(chatId, `✅ ${esc(r.codigo)}: ${esc(r.antes)} → <b>${esc(r.despues)}</b>\nInvitados, posiciones y fichas se conservan.`, [[{ text: "⬅️ Volver a la cuenta", callback_data: `spf:f:l:${st.familiaId}` }]]); return true;
    }
    if (st.paso === "alta" || st.paso === "revision") { // R196 · pegar → revisión (no escribe nada todavía)
      const rev = await planearAlta(text, st.modo);
      if (rev.plan.some((e) => e.clave)) await borrarMensaje(msg); // trae claves: no se deja en el chat
      const id = Date.now().toString(36);
      espera.set(k, { paso: "revision", modo: st.modo, revision: { id, ...rev }, at: Date.now() });
      await enviar(chatId, textoRevision(rev), rev.resumen.guardables ? [[{ text: `✅ Guardar (${rev.resumen.cuentasNuevas} cuenta(s), ${rev.resumen.invitados} invitado(s))`, callback_data: `spf:g:${id}` }], [{ text: "✖️ Cancelar", callback_data: "spf:x" }]] : [[{ text: "✖️ Cancelar", callback_data: "spf:x" }]]);
      return true;
    }
    if (st.paso === "madre") { const f = await S.crearFamilia(db, { madreCorreo: text, usuario: u }); espera.delete(k); await enviar(chatId, `✅ Familia creada\n${textoFamilia(f)}`); return true; }
    if (st.paso === "agregar_correo") { // R196b/d · correos completos (uno o varios) = agregar; texto sin correo = buscar en las fichas
      st.at = Date.now();
      const correos = [...new Set((text.match(RE_MAIL) || []).map(S.normCorreo))];
      if (!correos.length) { st.filtro = text.slice(0, 40); st.opciones = await opcionesFichas(st.filtro); st.pagina = 0; await mostrarSelector(chatId, st); return true; }
      const todas = await opcionesFichas(); const lineas = [];
      for (const c of correos) {
        const fichas = todas.filter((x) => x.correo === c);
        if (fichas.length > 1) { lineas.push(`⚠️ ${esc(c)}: está en varias fichas, elíjala de la lista.`); continue; }
        const ya = fichas[0];
        try {
          const f = await S.vincularInvitado(db, { familiaId: st.familiaId, correo: c, clienteId: ya ? ya.clienteId : "", compraId: ya ? ya.compraId : "", usuario: u });
          lineas.push(f.idempotente ? `▫️ ${esc(c)} ya estaba.` : `✅ ${esc(c)}${ya ? ` · ficha de ${esc(ya.clienteNombre)}` : " · sin ficha (vincúlela después)"}`);
          st.opciones = (st.opciones || []).filter((x) => x.correo !== c);
        } catch (e) { lineas.push(`⛔ ${esc(c)}: ${esc(String(e.message || e).slice(0, 120))}`); }
      }
      const varias = correos.filter((c) => todas.filter((x) => x.correo === c).length > 1);
      if (varias.length) { st.filtro = varias[0]; st.opciones = todas.filter((x) => x.correo === varias[0]); st.pagina = 0; }
      await mostrarSelector(chatId, st, lineas.join("\n")); return true;
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

module.exports = { tryCallback, tryMensaje, puede, textoFamilia, parsearCuentas, planearAlta };
