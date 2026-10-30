"use strict";
/* Buzón de dos vías (web ↔ Telegram) · lógica compartida por la Panel API (server_api.js) y el bot (index_36).
   Regla: primero se guarda el mensaje canónico en buzon_consultas; luego se encola el envío al otro canal
   en telegram_outbox (misma transacción). Un reintento con el mismo externalId no duplica el mensaje. */
const L = require("./lib_entregas_socios");

function outboxDoc({ chatId, text, replyMarkup, reference, onSent = null }, at = new Date()) {
  return {
    type: "message", chatId: String(chatId), text: String(text).slice(0, 3900), photoUrl: "", parseMode: "HTML", disableWebPreview: true,
    replyMarkupJson: replyMarkup ? JSON.stringify(replyMarkup) : "", source: "socios-entregas", reference: String(reference || "").slice(0, 180),
    status: "pending", attempts: 0, noRetryOnUncertain: true, ...(onSent ? { onSent } : {}), createdAt: at, updatedAt: at,
  };
}

function crearBuzon({ db, getDestinoChatIds, now = () => new Date() }) {
  async function avisarEquipo(tx, consultaId, c, mensaje) {
    let ids = [];
    try { ids = await getDestinoChatIds(c.destino || "sublicuentas"); } catch (_) { ids = []; }
    const texto = [`💬 <b>Consulta #${L.escHtml(c.numero)}</b>${c.pedidoRef ? ` · Pedido #${L.escHtml(c.pedidoRef)}` : ""}`, `👤 ${L.escHtml(c.socioNombre || c.socio_norm)}`, c.asunto ? `📌 ${L.escHtml(c.asunto)}` : "", "", L.escHtml(mensaje.texto), "", "<i>Responda a este mensaje para contestar en el mismo hilo.</i>"].filter((x) => x !== "").join("\n");
    ids.slice(0, 1).forEach((chat) => tx.set(db.collection("telegram_outbox").doc(`buzon_${consultaId}_${mensaje.id}_eq`), outboxDoc({ chatId: chat, text: texto, reference: `consulta:${consultaId}`, onSent: { collection: "buzon_telegram_messages", data: { consultaId, rol: "equipo" } } })));
  }
  function avisarSocio(tx, consultaId, c, mensaje, chat) {
    if (!chat) return;
    const texto = [`💬 <b>Respuesta a su consulta #${L.escHtml(c.numero)}</b>${c.pedidoRef ? ` · Pedido #${L.escHtml(c.pedidoRef)}` : ""}`, "", L.escHtml(mensaje.texto)].join("\n");
    tx.set(db.collection("telegram_outbox").doc(`buzon_${consultaId}_${mensaje.id}_so`), outboxDoc({ chatId: chat, text: texto, reference: `consulta:${consultaId}`,
      replyMarkup: { inline_keyboard: [[{ text: `Responder consulta #${c.numero}`, callback_data: `bz:r:${consultaId}`.slice(0, 64) }]] },
      onSent: { collection: "buzon_telegram_messages", data: { consultaId, rol: "socio" } } }));
  }

  // Lo usan la web y el bot (respuesta nativa de Telegram). Guarda primero el mensaje canónico, luego encola el otro canal.
  async function agregarMensaje(consultaId, { autor, nombre, texto, origen, interna = false, externalId = "", socioChat = "", opId = "", actor = "" }) {
    const ref = db.collection("buzon_consultas").doc(L.safeId(consultaId, 120));
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw Object.assign(new Error("nc"), { status: 404, publicError: "no_existe" });
      const c = s.data() || {};
      const mensajes = Array.isArray(c.mensajes) ? c.mensajes : [];
      const ext = externalId || (opId ? `op:${opId}` : "");
      if (L.yaExiste(mensajes, ext)) return { dup: true, consulta: c };
      if (mensajes.length >= 300) throw Object.assign(new Error("lleno"), { status: 409, publicError: "hilo_lleno" });
      const m = L.nuevoMensaje({ autor, nombre, texto, origen, interna, externalId: ext, actor, at: now() });
      const estado = interna ? c.estado : L.estadoTrasMensaje(c.estado, autor);
      const patch = { mensajes: [...mensajes, m], estado, updatedAt: now(), ultimoAutor: autor,
        noLeidasSocio: autor === "equipo" && !interna ? Number(c.noLeidasSocio || 0) + 1 : Number(c.noLeidasSocio || 0),
        noLeidasEquipo: autor === "socio" ? Number(c.noLeidasEquipo || 0) + 1 : 0 };
      if (autor === "socio") await avisarEquipo(tx, ref.id, c, m);
      if (autor === "equipo" && !interna) avisarSocio(tx, ref.id, c, m, socioChat);
      tx.set(ref, patch, { merge: true });
      return { mensaje: m, consulta: { ...c, ...patch } };
    });
  }
  return { agregarMensaje, avisarEquipo, avisarSocio };
}

module.exports = { crearBuzon, outboxDoc };
