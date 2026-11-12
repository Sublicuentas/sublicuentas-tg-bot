"use strict";
/* R195 · Comprobantes de pago del Portal de Socios → Telegram con ENTREGA VERIFICABLE.
   · El destino es un enum estable: SUBLICUENTAS | RELOJES (lo elige el socio; nunca se deduce del nombre ni se cambia solo).
   · Outbox durable: el pedido nace con `notificacion` (estado "pendiente") en la MISMA escritura/transacción del pedido.
   · "Enviado" SOLO si Telegram respondió ok:true con message_id. Guardar ≠ entregar.
   · Si falla: el pago y el voucher quedan intactos; se registra el error (código y descripción de Telegram) y se reintenta
     con espera creciente. Si el resultado es INCIERTO (se cortó la red), no se reintenta solo: lo decide un admin tras
     verificar que no llegó (evita comprobantes repetidos).
   · Cada intento queda en `voucher_intentos` (solo se agrega; nunca se borra). Sin token ni ids completos en registros. */
// Carga perezosa: este archivo también lo usa lib_compra_socios.js (vista pública del estado) sin arrastrar el bot.
const resolverDestino = (...a) => require("./lib_destinos_tg").resolverDestino(...a);
const enmascararChat = (...a) => require("./lib_destinos_tg").enmascararChat(...a);

const DESTINOS_VOUCHER = Object.freeze({ sublicuentas: "SUBLICUENTAS", relojes: "RELOJES" });
const ESPERAS_MIN = [1, 5, 15, 60, 180]; // reintentos automáticos (solo errores definitivos de Telegram)
const MAX_AUTO = ESPERAS_MIN.length + 1;
const LEASE_MS = 60000;

function destinoVoucher(raw, { requerido = true } = {}) {
  const k = String(raw || "").trim().toLowerCase();
  if (!k) { if (!requerido) return "sublicuentas"; const e = new Error("destino_requerido"); e.status = 400; e.publicError = "destino_requerido"; throw e; }
  if (!DESTINOS_VOUCHER[k]) { const e = new Error("destino_invalido"); e.status = 400; e.publicError = "destino_invalido"; throw e; }
  return k;
}
function notificacionInicial(id, destinoKey, ahora = new Date()) {
  return { voucherId: id, destino: DESTINOS_VOUCHER[destinoKey] || String(destinoKey).toUpperCase(), estado: "pendiente", intentos: 0, lastError: "", lastErrorCode: null,
    telegramChatRef: "", fuente: "", telegramMessageId: null, entregadoAt: null, idempotencyKey: `voucher-telegram:${id}`, creadoAt: ahora.toISOString(), proximoIntentoAt: ahora.toISOString() };
}
// Lo que ve el socio (sin ids de chat ni errores técnicos).
function estadoPublico(n) {
  if (!n) return { estado: "sin_registro", texto: "Sin registro de envío (pedido anterior)" };
  if (n.estado === "enviado") return { estado: "recibido", texto: "Recibido en Telegram", entregadoAt: n.entregadoAt || null };
  if (n.estado === "error" || n.estado === "incierto") return { estado: "error", texto: "Error de envío: el comprobante está guardado y el equipo lo reenvía", intentos: n.intentos || 0 };
  return { estado: "pendiente", texto: "Pendiente de envío a Telegram", intentos: n.intentos || 0 };
}

const textoPlano = (s) => String(s || "").replace(/\*/g, "").slice(0, 1000); // sin Markdown: un "_" en un correo ya no tumba el envío
async function llamarTelegram(fetchFn, token, metodo, body, ms = 15000) {
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), ms) : null;
  try {
    const r = await fetchFn(`https://api.telegram.org/bot${token}/${metodo}`, { method: "POST", body, ...(body instanceof FormData ? {} : { headers: { "Content-Type": "application/json" } }), ...(ac ? { signal: ac.signal } : {}) });
    let j = {}; try { j = await r.json(); } catch (_) {}
    if (j && j.ok === true && j.result && j.result.message_id) return { ok: true, messageId: j.result.message_id, metodo };
    return { ok: false, httpStatus: r.status, errorCode: j?.error_code || r.status, description: String(j?.description || r.statusText || "sin respuesta").slice(0, 200), metodo };
  } catch (e) {
    return { ok: false, incierto: true, errorCode: "red", description: String(e?.name === "AbortError" ? "Telegram no respondió a tiempo" : e?.message || e).slice(0, 200), metodo };
  } finally { if (t) clearTimeout(t); }
}
// Envía el comprobante como foto; si Telegram no acepta la imagen, como documento (adjunto legible igual).
async function enviarTelegram({ token, chatId, foto = {}, caption, fetchFn = fetch }) {
  if (!token) return { ok: false, errorCode: "sin_token", description: "BOT_TOKEN no configurado en este servicio" };
  const cap = textoPlano(caption);
  if (foto.buffer && typeof FormData === "function" && typeof Blob === "function") {
    const fd = (campo) => { const f = new FormData(); f.append("chat_id", String(chatId)); f.append("caption", cap); f.append(campo, new Blob([foto.buffer], { type: foto.contentType || "image/jpeg" }), foto.filename || "comprobante.jpg"); return f; };
    const r = await llamarTelegram(fetchFn, token, "sendPhoto", fd("photo"));
    if (r.ok || r.incierto || [401, 403].includes(Number(r.errorCode)) || /chat not found|bot was blocked|not enough rights|kicked/i.test(r.description)) return r;
    const d = await llamarTelegram(fetchFn, token, "sendDocument", fd("document"));
    return d.ok ? d : r;
  }
  if (foto.url) return llamarTelegram(fetchFn, token, "sendPhoto", JSON.stringify({ chat_id: chatId, photo: foto.url, caption: cap }));
  // Sin archivo (no debería pasar en compras con comprobante): avisar igual, marcado.
  return llamarTelegram(fetchFn, token, "sendMessage", JSON.stringify({ chat_id: chatId, text: `${cap}\n⚠️ El archivo del comprobante no se pudo adjuntar: revíselo en el panel.` }));
}

// Para pedidos anteriores (sin texto guardado): orden, socio, importe, fecha y destino.
function captionRespaldo(id, d = {}) {
  const f = d.createdAt?.toDate ? d.createdAt.toDate() : d.createdAt instanceof Date ? d.createdAt : d.createdAt?._seconds ? new Date(d.createdAt._seconds * 1000) : null;
  return [`🧾 COMPROBANTE DE PAGO (reenvío)`, `🆔 Pedido: #${String(id).slice(-6).toUpperCase()}`, `👤 Socio: ${String(d.socio || "—").slice(0, 80)}`, `🙍 Cliente: ${String(d.cliente || (d.clientePrincipal && [d.clientePrincipal.nombre, d.clientePrincipal.apellido].filter(Boolean).join(" ")) || "—").slice(0, 80)}`,
    `💵 Importe: L${Number(d.totalCombo || d.monto || 0)}`, f ? `📅 Fecha: ${f.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}` : "", `📍 Para: ${String(d.destinoLabel || d.destino || "").replace(/[^\p{L} ]/gu, "").trim()}`].filter(Boolean).join("\n");
}
// Recupera el archivo guardado para reintentos: Storage privado → copia en Firestore → URL firmada.
function fotoDesdeDoc(doc = {}) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(doc.imagenData || ""));
  if (m) return { buffer: Buffer.from(m[2], "base64"), contentType: m[1], filename: "comprobante." + (m[1].split("/")[1] || "jpg") };
  return { url: doc.imagenUrl || "" };
}

async function registrarIntento(db, datos) { try { await db.collection("voucher_intentos").add({ ...datos, at: new Date().toISOString() }); } catch (_) {} }

/* Entrega UNA vez. Idempotente: si ya hay message_id no vuelve a enviar; un "lease" evita dos envíos simultáneos. */
async function entregarVoucher(db, id, { coleccion = "compras", token = process.env.BOT_TOKEN, env = process.env, fetchFn = fetch, foto = null, caption = "", ahora = () => new Date(), actor = "sistema", forzar = false, cargarFoto = null } = {}) {
  const ref = db.collection(coleccion).doc(id);
  const t0 = ahora();
  const pre = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { salir: { estado: "no_existe" } };
    const d = s.data() || {}; const n = d.notificacion;
    if (!n) return { salir: { estado: "sin_registro" } };
    if (n.estado === "enviado" && n.telegramMessageId) return { salir: { estado: "enviado", yaEnviado: true, n } };
    if (n.estado === "incierto" && !forzar) return { salir: { estado: "incierto", n } };
    if (n.leaseHasta && Date.parse(n.leaseHasta) > t0.getTime()) return { salir: { estado: "enviando", n } };
    const nuevo = { ...n, estado: "enviando", intentos: (n.intentos || 0) + 1, leaseHasta: new Date(t0.getTime() + LEASE_MS).toISOString() };
    tx.set(ref, { notificacion: nuevo, ...(caption && !d.telegramCaption ? { telegramCaption: String(caption).slice(0, 1000) } : {}) }, { merge: true });
    return { d, n: nuevo };
  });
  if (pre.salir) return pre.salir;
  const { d, n } = pre;
  let destino;
  try { destino = resolverDestino(String(n.destino || "").toLowerCase(), env); }
  catch (e) {
    const fin = { ...n, estado: "error", leaseHasta: null, lastError: "Destino sin chat configurado", lastErrorCode: "destino_sin_configurar", proximoIntentoAt: new Date(t0.getTime() + 60 * 60000).toISOString() };
    await ref.set({ notificacion: fin }, { merge: true });
    await registrarIntento(db, { coleccion, compraId: id, ok: false, errorCode: "destino_sin_configurar", destino: n.destino, actor });
    return { estado: "error", n: fin };
  }
  const archivo = foto || (cargarFoto ? await cargarFoto(d).catch(() => null) : null) || fotoDesdeDoc(d);
  const r = await enviarTelegram({ token, chatId: destino.chatId, foto: archivo, caption: caption || d.telegramCaption || captionRespaldo(id, d), fetchFn });
  const chatRef = enmascararChat(destino.chatId);
  const tf = ahora();
  let fin;
  if (r.ok) fin = { ...n, estado: "enviado", leaseHasta: null, telegramMessageId: r.messageId, telegramChatRef: chatRef, fuente: destino.fuente, entregadoAt: tf.toISOString(), lastError: "", lastErrorCode: null, metodo: r.metodo };
  else {
    const espera = ESPERAS_MIN[Math.min(n.intentos - 1, ESPERAS_MIN.length - 1)];
    fin = { ...n, estado: r.incierto ? "incierto" : "error", leaseHasta: null, telegramChatRef: chatRef, fuente: destino.fuente, lastError: r.description, lastErrorCode: r.errorCode,
      proximoIntentoAt: new Date(tf.getTime() + espera * 60000).toISOString() };
  }
  await ref.set({ notificacion: fin }, { merge: true });
  await registrarIntento(db, { coleccion, compraId: id, ok: !!r.ok, metodo: r.metodo || "", messageId: r.messageId || null, httpStatus: r.httpStatus || null, errorCode: r.errorCode || null, description: r.description || "", chatRef, fuente: destino.fuente, destino: n.destino, actor, intento: n.intentos });
  if (!r.ok) console.error("voucher_tg", coleccion, id, n.destino, destino.fuente, r.errorCode, r.description);
  return { estado: fin.estado, n: fin };
}

/* Reintentos automáticos (solo "pendiente"/"error" definitivos, con espera). Lo llama la tarea del panel cada 2 min. */
async function barrerPendientes(db, opts = {}) {
  const ahora = (opts.ahora || (() => new Date()))();
  const hechos = [];
  for (const coleccion of ["compras", "renovaciones"]) {
    for (const estado of ["pendiente", "error"]) {
      let snap; try { snap = await db.collection(coleccion).where("notificacion.estado", "==", estado).limit(25).get(); } catch (_) { continue; }
      for (const doc of snap.docs) {
        const n = (doc.data() || {}).notificacion || {};
        if ((n.intentos || 0) >= MAX_AUTO) continue;
        if (n.proximoIntentoAt && Date.parse(n.proximoIntentoAt) > ahora.getTime()) continue;
        hechos.push({ id: doc.id, ...(await entregarVoucher(db, doc.id, { ...opts, coleccion, actor: "reintento_automatico" })) });
      }
    }
  }
  return hechos;
}

/* Diagnóstico de rutas (sin token ni ids completos): de dónde sale cada chat y si el bot puede escribir ahí. */
async function diagnostico({ token = process.env.BOT_TOKEN, env = process.env, fetchFn = fetch } = {}) {
  const out = { bot: null, destinos: [] };
  if (!token) out.bot = { ok: false, error: "BOT_TOKEN no configurado en este servicio" };
  else {
    const me = await llamarTelegramGet(fetchFn, token, "getMe", {}); out.bot = me.ok ? { ok: true, usuario: me.result?.username || "" } : { ok: false, error: me.description };
    // R196i · webhook: si quedó un webhook puesto, el bot por polling deja de recibir (409) aunque los envíos sigan.
    const wh = await llamarTelegramGet(fetchFn, token, "getWebhookInfo", {});
    if (wh.ok) { const w = wh.result || {}; out.webhook = { activo: !!w.url, pendientes: Number(w.pending_update_count || 0), ultimoError: String(w.last_error_message || "").slice(0, 200), ultimoErrorAt: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : "" }; }
  }
  out.servicio = { version: require("./server_api_version"), unificado: String(env.UNIFICAR_PANEL_API || "") === "1", arrancoAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString() };
  for (const k of Object.keys(DESTINOS_VOUCHER)) {
    try {
      const r = resolverDestino(k, env);
      const fila = { destino: DESTINOS_VOUCHER[k], fuente: r.fuente, chatRef: enmascararChat(r.chatId) };
      if (token) { const c = await llamarTelegramGet(fetchFn, token, "getChat", { chat_id: r.chatId }); fila.alcanzable = !!c.ok; fila.tipo = c.ok ? c.result?.type || "" : "";
        // R196l · No se muestra el nombre de la persona del chat (regla del negocio): solo destino, fuente y chat enmascarado.
        if (!c.ok) fila.error = c.description; }
      out.destinos.push(fila);
    } catch (e) { out.destinos.push({ destino: DESTINOS_VOUCHER[k], fuente: "", alcanzable: false, error: "Sin chat configurado" }); }
  }
  return out;
}
async function llamarTelegramGet(fetchFn, token, metodo, body) {
  try { const r = await fetchFn(`https://api.telegram.org/bot${token}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return j && j.ok ? { ok: true, result: j.result } : { ok: false, description: String(j?.description || r.status).slice(0, 160) }; }
  catch (e) { return { ok: false, description: String(e?.message || e).slice(0, 160) }; }
}

/* Reporte de comprobantes que NO constan como entregados (incluye pedidos anteriores sin registro). Solo lectura. */
function filaReporte(id, x = {}, coleccion = "compras") {
  const n = x.notificacion || null; const ms = x.createdAt?.toMillis ? x.createdAt.toMillis() : x.createdAt?._seconds ? x.createdAt._seconds * 1000 : x.createdAt instanceof Date ? x.createdAt.getTime() : Date.parse(x.createdAt || 0) || 0;
  return { id, coleccion, ref: String(id).slice(-6).toUpperCase(), fecha: ms ? new Date(ms).toISOString() : "", socio: x.socio || "", destino: (n && n.destino) || DESTINOS_VOUCHER[String(x.destino || "sublicuentas").toLowerCase()] || String(x.destino || "").toUpperCase(),
    estado: n ? n.estado : "sin_registro", intentos: n ? n.intentos || 0 : 0, lastError: n ? n.lastError || "" : "Pedido anterior a R195: el sistema no guardaba si Telegram lo entregó", fuente: n ? n.fuente || "" : "",
    comprobante: !!(x.imagenUrl || x.imagenData), monto: Number(x.totalCombo || x.monto || 0) };
}

module.exports = { DESTINOS_VOUCHER, ESPERAS_MIN, MAX_AUTO, destinoVoucher, notificacionInicial, estadoPublico, enviarTelegram, entregarVoucher, barrerPendientes, diagnostico, filaReporte, fotoDesdeDoc, textoPlano, captionRespaldo };
