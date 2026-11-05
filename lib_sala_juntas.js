"use strict";
/* ============================================================================================================
   R168 · SubliStudio 3D · Sala de Juntas — FASE 2: invitaciones y recordatorios por Telegram (bot existente).
   Sublichat HQ (api/sala-juntas.js) crea los avisos en Firestore `sala_avisos` (estado "pendiente").
   Este módulo, que corre SOLO en el proceso que hace polling (tareas de fondo), cada 30 s:
     · toma los avisos pendientes cuya hora ya llegó, los marca "enviando" en una transacción (nunca se envían dos
       veces aunque haya dos instancias), revisa que la reunión siga vigente y la versión sea la actual,
     · envía al chat de Telegram YA vinculado a esa cuenta (variables TELEGRAM_CHAT_ID_* que usa Tickets),
     · deja "enviado" / "fallido" (3 intentos; si Telegram dice que la persona bloqueó o no inició el bot: fallido)
       o "vencido" si el bot estuvo apagado y el recordatorio ya no tiene sentido.
   Botones "Confirmar" / "No asistiré": callback `sj:r:<invitación>:a|n`. Solo cambia la invitación si el que toca
   es el chat de ESA cuenta. El botón "Abrir convocatoria" abre Sublichat (con su login); nunca lleva tokens.
   Se apaga con SALA_JUNTAS_ENABLED=0. No toca ningún otro flujo del bot.
   ============================================================================================================ */

const C = { R: "sala_reuniones", I: "sala_invitaciones", A: "sala_avisos", AUD: "auditoria_eventos" };
const NOMBRE = { naara: "Naara", libni: "Libni", geisell: "Geisell" };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MAX_INTENTOS = 3;
// Cuánto tarde puede salir un recordatorio si el bot estuvo apagado (después ya no tiene sentido).
const TOLERANCIA_MS = { h24: 6 * 3600e3, h1: 45 * 60e3, m10: 9 * 60e3, inicio: 20 * 60e3, invitacion: Infinity, cancelacion: 48 * 3600e3 };

const esc = (v) => String(v == null ? "" : v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function chatDe(usuario, env = process.env) {
  if (usuario === "naara") return String(env.TELEGRAM_CHAT_ID_SUBLICUENTAS || env.SUPER_ADMIN || "").split(/[,\s]+/)[0].trim();
  if (usuario === "libni") return String(env.TELEGRAM_CHAT_ID_RELOJES || "").split(/[,\s]+/)[0].trim();
  if (usuario === "geisell") return String(env.TELEGRAM_CHAT_ID_GEISELL || env.TELEGRAM_CHAT_ID_GEISSEL || "").split(/[,\s]+/)[0].trim();
  return "";
}
function fechaHN(ms) {
  const d = new Date(Number(ms) - 6 * 3600e3), h = d.getUTCHours(), m = d.getUTCMinutes();
  const hora = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
  return { fecha: `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`, hora };
}
function urlSala(reunionId, env = process.env) {
  const base = String(env.SUBLICHAT_WEB_URL || "https://sublichat.capuchino.lat").split(",")[0].trim().replace(/\/+$/, "");
  return /^https:\/\//.test(base) ? `${base}/?sala=${encodeURIComponent(reunionId)}` : "";
}

// Texto y botones de cada aviso (HTML de Telegram).
function mensaje(aviso, r, inv, env = process.env) {
  const { fecha, hora } = fechaHN(r.inicioMs);
  const titulo = esc(r.titulo || "Reunión");
  const part = (r.participantes || []).map((u) => NOMBRE[u] || u).join(", ");
  const agenda = (r.agenda || []).slice(0, 8).map((t) => `• ${esc(t)}`).join("\n");
  const pendiente = !inv || inv.estado === "pendiente";
  const invId = `${aviso.reunionId}_${aviso.usuario}`;
  const rsvp = [{ text: "✅ Confirmar", callback_data: `sj:r:${invId}:a` }, { text: "❌ No asistiré", callback_data: `sj:r:${invId}:n` }];
  const url = urlSala(aviso.reunionId, env);
  const abrir = url ? [[{ text: aviso.tipo === "inicio" ? "🎥 Ir a la antesala" : "🔐 Abrir convocatoria segura", url }]] : [];
  const kb = (conRsvp) => ({ inline_keyboard: [...(conRsvp && pendiente ? [rsvp] : []), ...abrir] });
  const cuando = { h24: "en 24 horas", h1: "en 1 hora", m10: "en 10 minutos" };
  if (aviso.tipo === "invitacion") {
    return {
      texto: `🎥 <b>${aviso.reprogramada ? "Reunión reprogramada" : "Convocatoria"} · Sala de Juntas</b>\n\n<b>Asunto:</b> ${titulo}\n<b>Fecha:</b> ${esc(fecha)}\n<b>Hora:</b> ${esc(hora)} (Honduras)\n<b>Participantes:</b> ${esc(part)}${agenda ? `\n\n<b>Agenda:</b>\n${agenda}` : ""}\n\n¿Asistirá?`,
      teclado: kb(true),
    };
  }
  if (cuando[aviso.tipo]) return { texto: `⏰ <b>Recordatorio · Sala de Juntas</b>\n\n«${titulo}» empieza <b>${cuando[aviso.tipo]}</b>.\n${esc(fecha)} · ${esc(hora)} (Honduras)${pendiente ? "\n\nTodavía no ha confirmado su asistencia." : ""}`, teclado: kb(true) };
  if (aviso.tipo === "inicio") return { texto: `🟢 <b>«${titulo}» empieza ahora.</b>\nEntre a la antesala de la Sala de Juntas para revisar su micrófono.`, teclado: kb(false) };
  if (aviso.tipo === "cancelacion") return { texto: `❌ <b>Reunión cancelada</b>\n\nNaara canceló «${titulo}» del ${esc(fecha)} · ${esc(hora)}.`, teclado: { inline_keyboard: [] } };
  return null;
}

function errorDefinitivo(e) {
  const code = Number(e?.response?.body?.error_code || e?.response?.statusCode || 0), t = String(e?.message || "");
  return code === 403 || code === 400 || /blocked|chat not found|deactivated|bot can't initiate/i.test(t);
}

// Envía los avisos pendientes que ya tocan. Devuelve un resumen (para logs y pruebas).
async function procesarPendientes({ db, bot, env = process.env, ahora = Date.now(), log = console } = {}) {
  const res = { enviados: 0, fallidos: 0, vencidos: 0, anulados: 0, reintentar: 0 };
  if (String(env.SALA_JUNTAS_ENABLED ?? "1") === "0") return res;
  const s = await db.collection(C.A).where("estado", "==", "pendiente").get();
  const listos = s.docs.map((d) => ({ ref: d.ref, id: d.id, a: d.data() || {} })).filter((x) => Number(x.a.programadoMs || 0) <= ahora).sort((x, y) => x.a.programadoMs - y.a.programadoMs).slice(0, 40);
  for (const { ref, a } of listos) {
    // 1) reclamar (transacción): solo una instancia lo toma
    let tomado = false;
    await db.runTransaction(async (tx) => {
      const d = await tx.get(ref); const x = d.exists ? d.data() : null;
      if (!x || x.estado !== "pendiente" || Number(x.programadoMs || 0) > ahora) return;
      tx.set(ref, { estado: "enviando", tomadoAt: new Date(ahora).toISOString() }, { merge: true }); tomado = true;
    });
    if (!tomado) continue;
    const fin = async (data) => ref.set({ ...data, actualizadoAt: new Date(ahora).toISOString() }, { merge: true });
    try {
      const rs = await db.collection(C.R).doc(a.reunionId).get();
      const r = rs.exists ? rs.data() : null;
      const vigente = r && (a.tipo === "cancelacion" ? r.estado === "cancelada" : ["programada", "en_curso"].includes(r.estado) && Number(r.version || 1) === Number(a.version || 1));
      if (!vigente) { await fin({ estado: "anulado", motivo: "reunion_no_vigente" }); res.anulados++; continue; }
      if (ahora - Number(a.programadoMs) > (TOLERANCIA_MS[a.tipo] ?? 3600e3)) { await fin({ estado: "vencido", motivo: "bot_apagado_a_la_hora" }); res.vencidos++; continue; }
      const chat = chatDe(a.usuario, env);
      if (!chat) { await fin({ estado: "fallido", error: "Esta cuenta no tiene Telegram vinculado (TELEGRAM_CHAT_ID)." }); res.fallidos++; continue; }
      const is = await db.collection(C.I).doc(`${a.reunionId}_${a.usuario}`).get();
      const inv = is.exists ? is.data() : null;
      if (a.tipo !== "invitacion" && a.tipo !== "cancelacion" && inv && inv.estado === "rechazada") { await fin({ estado: "anulado", motivo: "no_asistira" }); res.anulados++; continue; }
      const m = mensaje(a, r, inv, env);
      if (!m) { await fin({ estado: "anulado", motivo: "tipo_desconocido" }); res.anulados++; continue; }
      const msg = await bot.sendMessage(chat, m.texto, { parse_mode: "HTML", disable_web_page_preview: true, reply_markup: m.teclado });
      await fin({ estado: "enviado", enviadoAt: new Date(ahora).toISOString(), messageId: Number(msg?.message_id || 0) || null });
      res.enviados++;
    } catch (e) {
      const intentos = Number(a.intentos || 0) + 1, def = errorDefinitivo(e) || intentos >= MAX_INTENTOS;
      await fin(def ? { estado: "fallido", intentos, error: String(e?.message || e).slice(0, 300) } : { estado: "pendiente", intentos, programadoMs: ahora + intentos * 60e3, error: String(e?.message || e).slice(0, 300) });
      def ? res.fallidos++ : res.reintentar++;
      try { log.warn("[Sala de Juntas] aviso", a.tipo, a.usuario, String(e?.message || e).slice(0, 160)); } catch (_) {}
    }
  }
  return res;
}

// Botones Confirmar / No asistiré. Devuelve true si el callback era de la Sala (aunque se rechace).
async function handleCallback(q, { db, bot, env = process.env, ahora = Date.now() } = {}) {
  const data = String(q?.data || "");
  const m = data.match(/^sj:r:([A-Za-z0-9_-]{6,80})_(naara|libni|geisell):(a|n)$/);
  if (!data.startsWith("sj:")) return false;
  const responder = (t, alerta) => bot.answerCallbackQuery(q.id, { text: t, show_alert: !!alerta }).catch(() => {});
  if (!m || String(env.SALA_JUNTAS_ENABLED ?? "1") === "0") { await responder("Esta opción ya no está disponible.", true); return true; }
  const [, reunionId, usuario, op] = m;
  if (String(q.from?.id || "") !== chatDe(usuario, env)) { await responder("Esta invitación no es suya.", true); return true; }
  const estado = op === "a" ? "aceptada" : "rechazada";
  const rRef = db.collection(C.R).doc(reunionId), iRef = db.collection(C.I).doc(`${reunionId}_${usuario}`);
  let resultado = "";
  await db.runTransaction(async (tx) => {
    const rs = await tx.get(rRef), is = await tx.get(iRef);
    const r = rs.exists ? rs.data() : null, inv = is.exists ? is.data() : null;
    if (!r || !inv || !(r.participantes || []).includes(usuario)) { resultado = "no_invitada"; return; }
    if (!["programada", "en_curso"].includes(r.estado)) { resultado = "cerrada"; return; }
    if (inv.estado === estado) { resultado = "igual"; return; }
    tx.set(iRef, { estado, respondidoAt: new Date(ahora).toISOString(), canal: "telegram", actualizadoAt: new Date(ahora).toISOString() }, { merge: true });
    tx.set(db.collection(C.AUD).doc(), { tipo: "sala_juntas", modulo: "sala-juntas", accion: "rsvp", actorUsuario: usuario, objetivo: reunionId, respuesta: estado, canal: "telegram", resultado: "ok", createdAt: new Date(ahora).toISOString() });
    resultado = "ok"; q.__titulo = r.titulo;
  });
  if (resultado === "no_invitada") { await responder("No encontré su invitación.", true); return true; }
  if (resultado === "cerrada") { await responder("Esa reunión ya no recibe confirmaciones.", true); return true; }
  const texto = estado === "aceptada" ? "✅ Asistencia confirmada" : "❌ Registrado: no asistirá";
  await responder(texto);
  try { await bot.editMessageReplyMarkup({ inline_keyboard: (q.message?.reply_markup?.inline_keyboard || []).filter((fila) => !fila.some((b) => String(b.callback_data || "").startsWith("sj:r:"))) }, { chat_id: q.message?.chat?.id, message_id: q.message?.message_id }); } catch (_) {}
  if (resultado === "ok") {
    try { await bot.sendMessage(q.message.chat.id, `${texto}.`); } catch (_) {}
    const naara = chatDe("naara", env);
    if (naara && usuario !== "naara") { try { await bot.sendMessage(naara, `${estado === "aceptada" ? "✅" : "❌"} ${NOMBRE[usuario]} ${estado === "aceptada" ? "confirmó asistencia" : "no asistirá"} a «${esc(q.__titulo || "la reunión")}».`, { parse_mode: "HTML" }); } catch (_) {} }
  }
  return true;
}

let timer = null;
function iniciar({ db, bot, env = process.env, cadaMs = 30000, log = console } = {}) {
  if (timer || String(env.SALA_JUNTAS_ENABLED ?? "1") === "0") return;
  let ocupado = false;
  const tick = async () => {
    if (ocupado) return; ocupado = true;
    try { const r = await procesarPendientes({ db, bot, env, log }); if (r.enviados || r.fallidos || r.vencidos) log.log(`[Sala de Juntas] avisos: ${JSON.stringify(r)}`); }
    catch (e) { log.error("[Sala de Juntas] avisos", e?.message || e); }
    ocupado = false;
  };
  timer = setInterval(tick, cadaMs); timer.unref?.();
  setTimeout(tick, 8000).unref?.();
  log.log("🎥 Sala de Juntas: avisos de Telegram activos");
}

module.exports = { iniciar, procesarPendientes, handleCallback, mensaje, chatDe, urlSala, TOLERANCIA_MS };
