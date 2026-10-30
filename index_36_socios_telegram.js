"use strict";
/* SUBLICUENTAS · Bot · Vínculo seguro de Telegram + respuestas del Buzón (oct-2026)
   - /start v_<token>: el socio lo abre desde "Conectar Telegram" en su panel. Token aleatorio, de un uso, 10 min,
     guardado solo como hash. Solo chat privado. No reemplaza en silencio un vínculo de otro socio.
   - Respuestas al Buzón: la respuesta NATIVA a un mensaje del bot o el botón "Responder consulta #C…" identifican
     el hilo. Un texto suelto nunca se asigna "a la última consulta" por suposición.
   - Respuestas del equipo desde Telegram: solo administradores verificados y hacia un hilo explícito.
   Lo llaman index_06_handlers.js (bot.on("message") y bot.on("callback_query")). */

const { db, bot } = require("./index_01_core");
const L = require("./lib_entregas_socios");
const { crearBuzon } = require("./lib_buzon_core");
const { getDestinoChatIds } = require("./lib_destinos_tg");
const { normVendedor } = require("./index_17_vendedores_servicio");

const buzon = crearBuzon({ db, getDestinoChatIds });
const estadoRespuesta = global.__SUBLI_BUZON_REPLY__ = global.__SUBLI_BUZON_REPLY__ || new Map();
const ESPERA_MS = 15 * 60 * 1000;
const key = (v) => { const n = normVendedor(String(v || "")); return n === "geissel" ? "geisell" : n; };
const esDelSocio = (consulta, vend) => !!vend && [vend.nombre_norm, vend.nombre, vend.id].map(key).filter(Boolean).includes(key(consulta.socio_norm));
const MOTIVOS = {
  token_invalido: "Ese enlace no es válido. Genere uno nuevo desde su panel (Perfil → Conectar Telegram).",
  token_usado: "Ese enlace ya se usó. Genere uno nuevo desde su panel.",
  token_vencido: "Ese enlace venció. Genere uno nuevo desde su panel.",
  chat_no_privado: "La vinculación solo funciona en un chat privado con el bot, no en grupos ni canales.",
  usuario_invalido: "No pudimos identificar su cuenta de Telegram.",
  telegram_de_otro_socio: "Esta cuenta de Telegram ya está vinculada a otro socio. Pida ayuda a Sublicuentas.",
  ya_vinculado_otro: "Su panel ya tiene otro Telegram vinculado. Use “Cambiar Telegram” en su panel para reemplazarlo.",
};

async function tryVincular(msg) {
  const token = L.tokenDesdeStart(msg?.text || "");
  if (!token) return false;
  const chatId = msg.chat?.id, userId = String(msg.from?.id || "");
  const ref = db.collection("telegram_vinculos_tokens").doc(L.hashToken(token));
  let resultado = "";
  try {
    const otro = await db.collection("revendedores").where("telegramId", "==", userId).limit(2).get();
    resultado = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const tok = s.exists ? s.data() || {} : null;
      const socioRef = tok ? db.collection("revendedores").doc(String(tok.socioId)) : null;
      const socio = socioRef ? await tx.get(socioRef) : null;
      const socioDelUsuario = otro.docs.find((x) => x.id !== tok?.socioId)?.id || null;
      const err = L.validarVinculo({ tok, chatType: msg.chat?.type, telegramUserId: userId, socioDelUsuario, socioActual: socio?.exists ? socio.data() : null });
      if (err) { if (tok && !tok.usadoAt && err !== "token_vencido") tx.set(ref, { ultimoIntentoFallido: err, ultimoIntentoAt: new Date() }, { merge: true }); return err; }
      const prev = socio.data() || {};
      tx.set(ref, { usadoAt: new Date(), usadoPor: userId }, { merge: true });
      tx.set(socioRef, { telegramId: userId, telegramVinculo: { estado: "vinculado", metodo: "token", desde: new Date(), userId, chatId: String(chatId), anteriorTelegramId: String(prev.telegramId || ""), incidencia: "" } }, { merge: true });
      return "";
    });
  } catch (e) { console.error("vincular_tg", e?.message || e); resultado = "token_invalido"; }
  await bot.sendMessage(chatId, resultado ? `⚠️ ${MOTIVOS[resultado] || MOTIVOS.token_invalido}` : "✅ Telegram conectado a su Panel de Socios.\nAquí recibirá avisos de entregas y respuestas del Buzón. Los mensajes anteriores no se recuperan.").catch(() => {});
  return true;
}

async function hiloDeRespuesta(msg) {
  const mid = msg?.reply_to_message?.message_id;
  if (!mid) return null;
  const s = await db.collection("buzon_telegram_messages").doc(`${String(msg.chat?.id).replace(/[^0-9-]/g, "")}_${Number(mid)}`).get().catch(() => null);
  return s && s.exists ? s.data() || null : null;
}

// true = el mensaje era para el Buzón (ya se atendió); false = seguir con el flujo normal del bot.
async function tryMensaje(msg, { adminOk = false, superOk = false, vend = null } = {}) {
  const chatId = msg.chat?.id; if (!chatId || msg.chat?.type !== "private") return false;
  const texto = String(msg.text || msg.caption || "").trim();
  const raw = texto.toLowerCase();
  const st = estadoRespuesta.get(String(chatId));
  if (st && ["/cancelar", "cancelar"].includes(raw)) { estadoRespuesta.delete(String(chatId)); await bot.sendMessage(chatId, "✅ Respuesta cancelada."); return true; }
  if (raw === "/consultas" && vend) return listarConsultas(chatId, vend);
  const link = await hiloDeRespuesta(msg);
  const sel = L.hiloDesdeTelegram({ porRespuesta: link?.consultaId || "", porBoton: st && Date.now() - st.at < ESPERA_MS ? st.consultaId : "" });
  if (!sel.consultaId) return false;
  if (texto.startsWith("/") && sel.via !== "respuesta") return false;
  if (!texto) { await bot.sendMessage(chatId, "Escriba su respuesta en texto."); return true; }
  const cs = await db.collection("buzon_consultas").doc(sel.consultaId).get();
  if (!cs.exists) { await bot.sendMessage(chatId, "⚠️ Esa consulta ya no existe."); return true; }
  const c = cs.data() || {};
  const rolEquipo = link ? link.rol === "equipo" : false;
  const externalId = `tg:${chatId}:${msg.message_id}`;
  try {
    if (rolEquipo) {
      if (!(adminOk || superOk)) { await bot.sendMessage(chatId, "⛔ Solo administradores pueden responder consultas del equipo."); return true; }
      const socio = await db.collection("revendedores").where("nombre_norm", "==", key(c.socio_norm)).limit(1).get();
      const sd = socio.empty ? {} : socio.docs[0].data() || {};
      const chatSocio = sd.telegramVinculo?.estado === "desvinculado" ? "" : String(sd.telegramId || "");
      const r = await buzon.agregarMensaje(cs.id, { autor: "equipo", nombre: String(c.destinoLabel || "Equipo").replace(/^[^\p{L}]+/u, ""), actor: `telegram:${msg.from?.id || ""} ${String(msg.from?.first_name || "").slice(0, 40)}`, texto, origen: "telegram", externalId, socioChat: chatSocio });
      await bot.sendMessage(chatId, r.dup ? "Ya estaba guardado." : `✅ Respuesta agregada a la consulta #${c.numero}${chatSocio ? " y enviada al socio" : " (el socio la verá en su panel)"}.`);
    } else {
      if (!esDelSocio(c, vend)) { await bot.sendMessage(chatId, "⛔ Esa consulta no corresponde a su usuario."); return true; }
      const r = await buzon.agregarMensaje(cs.id, { autor: "socio", nombre: vend.nombre || "", texto, origen: "telegram", externalId });
      estadoRespuesta.delete(String(chatId));
      await bot.sendMessage(chatId, r.dup ? "Ya estaba guardado." : `✅ Agregado a la consulta #${c.numero}. También lo verá en su panel.`);
    }
  } catch (e) { console.error("buzon_tg", e?.message || e); await bot.sendMessage(chatId, "⚠️ No se pudo guardar. Intente de nuevo.").catch(() => {}); }
  return true;
}

async function listarConsultas(chatId, vend) {
  const s = await db.collection("buzon_consultas").where("socio_norm", "==", key(vend.nombre_norm || vend.nombre)).get();
  const abiertas = s.docs.map((x) => ({ id: x.id, ...(x.data() || {}) })).filter((c) => c.estado !== "resuelta").sort((a, b) => L.ms(b.updatedAt) - L.ms(a.updatedAt)).slice(0, 8);
  if (!abiertas.length) { await bot.sendMessage(chatId, "No tiene consultas abiertas. Puede crear una desde el Buzón de su panel."); return true; }
  await bot.sendMessage(chatId, "Elija la consulta que quiere responder:", { reply_markup: { inline_keyboard: abiertas.map((c) => [{ text: `#${c.numero} · ${String(c.asunto || "Consulta").slice(0, 40)}`, callback_data: `bz:r:${c.id}`.slice(0, 64) }]) } });
  return true;
}

async function tryCallback(q, { vend = null } = {}) {
  const data = String(q?.data || "");
  if (!data.startsWith("bz:r:")) return false;
  const chatId = q.message?.chat?.id;
  const id = L.safeId(data.slice(5), 120);
  const cs = await db.collection("buzon_consultas").doc(id).get();
  if (!cs.exists || !esDelSocio(cs.data() || {}, vend)) { await bot.sendMessage(chatId, "⛔ Esa consulta no corresponde a su usuario."); return true; }
  estadoRespuesta.set(String(chatId), { consultaId: id, at: Date.now() });
  await bot.sendMessage(chatId, `💬 Respondiendo la consulta #${(cs.data() || {}).numero}.\nEscriba su mensaje. /cancelar para salir.`);
  return true;
}

module.exports = { tryVincular, tryMensaje, tryCallback };
