"use strict";
/* SUBLICUENTAS · Entregas a socios + Buzón de dos vías + Telegram (oct-2026)
   Brief "Entregas en panel + Telegram · Historial completo y autorización administrativa".
   Funciones PURAS (sin Firestore): las usan rev_entregas_api.js, index_36_socios_telegram.js y las pruebas.

   Estados separados (nunca se mezclan):
     Entrega : borrador / publicada / revocada
     Pedido  : pendiente / parcial / entregado  (derivado de sus renglones; cancelación y pago aparte)
     Aviso   : pendiente / procesando / aceptado / fallido / incierto   (lo da la cola telegram_outbox)
     Lectura : sin abrir / visto, por socio y versión */

const crypto = require("crypto");

const clean = (v, max = 300) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, max);
const norm = (v) => String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const safeId = (v, max = 80) => String(v == null ? "" : v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, max);
const escHtml = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function ms(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return Number(v.toMillis()) || 0;
  if (v._seconds != null) return Number(v._seconds) * 1000;
  if (v.seconds != null) return Number(v.seconds) * 1000;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- identificadores estables (doble toque = mismo documento) ---------- */
function entregaId(compraId, renglonId) { return `ent_${safeId(compraId, 60)}_${safeId(renglonId || "r1", 40)}`; }
function entregaHistoricaId(sistema, origenId, renglonId = "") { return `enth_${safeId(sistema, 20)}_${safeId(origenId, 70)}${renglonId ? "_" + safeId(renglonId, 30) : ""}`; }
function avisoId(entId, version, canal = "tg", reenvio = 0) { return `entrega_${safeId(entId, 120)}_v${Number(version) || 1}_${canal}${reenvio ? `_r${reenvio}` : ""}`; }

/* ---------- pedido: estado derivado de sus renglones requeridos ---------- */
// entregas = { [renglonId]: { estado:'publicada'|'revocada'|'borrador', version, publicadaAt } }
function estadoEntregaPedido(productos = [], entregas = {}, estadoPedido = "") {
  const renglones = (Array.isArray(productos) && productos.length ? productos : [{ renglonId: "r1" }])
    .map((p, i) => clean(p.renglonId, 60) || `r${i + 1}`);
  const publicados = renglones.filter((r) => entregas && entregas[r] && entregas[r].estado === "publicada").length;
  const requeridos = renglones.length;
  if (norm(estadoPedido) === "cancelado") return { estado: "cancelado", requeridos, publicados, texto: "Cancelado" };
  const estado = publicados === 0 ? "pendiente" : publicados < requeridos ? "parcial" : "entregado";
  const texto = estado === "parcial" ? `Entrega parcial · ${publicados} de ${requeridos} servicio${requeridos === 1 ? "" : "s"}`
    : estado === "entregado" ? "Entregado al socio" : "Pendiente de entrega";
  return { estado, requeridos, publicados, texto };
}

/* ---------- código del portal: secreto cifrado en reposo (AES-256-GCM, llave solo en el servidor) ---------- */
function llaveCodigos(env = process.env) {
  const raw = String(env.ENTREGAS_CODIGOS_KEY || "").trim();
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}
function cifrarCodigo(texto, key) {
  if (!key) { const e = new Error("cifrado_no_configurado"); e.publicError = "cifrado_no_configurado"; e.status = 503; throw e; }
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function descifrarCodigo(obj, key) {
  if (!obj || !key) return "";
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(obj.iv, "base64"));
  d.setAuthTag(Buffer.from(obj.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(obj.data, "base64")), d.final()]).toString("utf8");
}

/* ---------- lo que ve el socio (nunca el código cifrado; nunca otros servicios de la ficha) ---------- */
function entregaPublica(id, e = {}, { detalle = false } = {}) {
  const visto = e.visto && typeof e.visto === "object" ? e.visto : {};
  const out = {
    id, compraId: e.compraId || "", pedidoRef: e.pedidoRef || (e.compraId ? String(e.compraId).slice(-6).toUpperCase() : ""),
    renglonId: e.renglonId || "", estado: e.estado || "borrador", version: Number(e.version) || 0,
    servicio: e.servicio || "", modalidad: e.modalidad || "", clienteNombre: e.clienteNombre || "",
    publicadaAt: e.publicadaAt ? ms(e.publicadaAt) : null, actualizadaAt: e.actualizadaAt ? ms(e.actualizadaAt) : null,
    fechaOriginal: e.fechaOriginal === null || e.fechaOriginal === undefined ? (e.publicadaAt ? ms(e.publicadaAt) : null) : ms(e.fechaOriginal) || null,
    vencimiento: e.vencimiento || "", historico: !!e.historico, historicoIncompleto: !!e.historicoIncompleto,
    importadaAt: e.importadaAt ? ms(e.importadaAt) : null, importe: e.importe === undefined ? null : e.importe,
    nueva: e.estado === "publicada" && Number(visto.version || 0) < Number(e.version || 0),
    vistaAt: visto.primeraAt ? ms(visto.primeraAt) : null, tieneCodigo: !!(e.codigoCifrado && e.codigoAutorizado),
    tienePortal: !!(e.portal && e.portal.clienteId),
  };
  if (detalle) {
    out.nota = e.notaSocio || "";
    out.mensajeCliente = e.mensajeCliente || "";
    out.motivoActualizacion = e.motivoActualizacion || "";
    out.revocadaAt = e.revocadaAt ? ms(e.revocadaAt) : null;
  }
  return out;
}

/* ---------- filtros + paginación del servidor (cursor opaco = desplazamiento firmado por la consulta) ---------- */
function filtrarEntregas(list = [], f = {}) {
  const q = (k) => norm(f[k] || "");
  const cliente = q("cliente"), servicio = q("servicio"), pedido = q("pedido").replace(/^#/, "");
  const desde = f.desde ? Date.parse(f.desde) : 0, hasta = f.hasta ? Date.parse(f.hasta) + 86399999 : 0;
  const estado = q("estado"), soloNuevas = String(f.nuevas || "") === "1";
  return list.filter((e) => {
    if (cliente && !norm(e.clienteNombre).includes(cliente)) return false;
    if (servicio && !norm(e.servicio).includes(servicio)) return false;
    if (pedido && !norm(e.pedidoRef).includes(pedido) && !norm(e.compraId).includes(pedido)) return false;
    const t = e.fechaOriginal || e.publicadaAt || e.importadaAt || 0;
    if (desde && (!t || t < desde)) return false;
    if (hasta && (!t || t > hasta)) return false;
    if (estado && estado !== "todos" && norm(e.estado) !== estado && !(estado === "historico" && e.historico)) return false;
    if (soloNuevas && !e.nueva) return false;
    return true;
  }).sort((a, b) => (b.fechaOriginal || b.publicadaAt || 0) - (a.fechaOriginal || a.publicadaAt || 0) || String(b.id).localeCompare(String(a.id)));
}
function paginar(list = [], cursor = "", limit = 20) {
  const n = Math.min(50, Math.max(1, Number(limit) || 20));
  const off = Math.max(0, Number(Buffer.from(String(cursor || ""), "base64url").toString("utf8")) || 0);
  const items = list.slice(off, off + n);
  const sig = off + n < list.length ? Buffer.from(String(off + n), "utf8").toString("base64url") : "";
  return { items, cursor: sig, total: list.length };
}

/* ---------- aviso privado de Telegram: nombre mínimo, sin códigos, botón a una ruta con sesión ---------- */
function urlPanelEntrega(base, id) {
  const b = String(base || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(\/[^\s?#]*)?$/i.test(b)) return "";
  return `${b}/?entrega=${encodeURIComponent(safeId(id, 160))}`;
}
function mensajeEntregaTelegram({ ref, cliente, servicio, actualizacion = false } = {}) {
  const lineas = [
    actualizacion ? `🔄 <b>Pedido #${escHtml(ref)} actualizado.</b>` : `✅ <b>Pedido #${escHtml(ref)} disponible.</b>`,
    `Cliente: ${escHtml(clean(cliente, 80) || "—")}.`,
    `Servicio: ${escHtml(clean(servicio, 120) || "—")}.`,
    `Estado: Entregado al socio.`,
  ];
  return lineas.join("\n");
}
function botonPanel(url, texto = "Ver entrega en mi panel") { return url ? { inline_keyboard: [[{ text: texto, url }]] } : null; }

/* ---------- vinculación de Telegram: token aleatorio, de un uso, corto, solo guardado como hash ---------- */
function nuevoTokenVinculo() {
  const token = crypto.randomBytes(24).toString("base64url"); // 32 chars, cabe en ?start= (máx. 64)
  return { token, hash: hashToken(token) };
}
function hashToken(t) { return crypto.createHash("sha256").update(String(t || "")).digest("hex"); }
const PREFIJO_START = "v_";
function tokenDesdeStart(texto = "") {
  const m = String(texto || "").trim().match(/^\/start(?:@\w+)?\s+v_([A-Za-z0-9_-]{20,60})$/);
  return m ? m[1] : "";
}
// Reglas de aceptación del token (pura, para probarla sin Firestore).
function validarVinculo({ tok, chatType, telegramUserId, now = Date.now(), socioDelUsuario = null, socioActual = null } = {}) {
  if (!tok) return "token_invalido";
  if (tok.usadoAt) return "token_usado";
  if (Number(tok.expiraMs || 0) < now) return "token_vencido";
  if (chatType !== "private") return "chat_no_privado";
  if (!/^\d{4,}$/.test(String(telegramUserId || ""))) return "usuario_invalido";
  if (socioDelUsuario && String(socioDelUsuario) !== String(tok.socioId)) return "telegram_de_otro_socio";
  if (socioActual && socioActual.telegramId && String(socioActual.telegramId) !== String(telegramUserId) && !tok.reemplazar) return "ya_vinculado_otro";
  return "";
}

/* ---------- Buzón: hilos con estados y mensajes de dos canales ---------- */
const ESTADOS_CONSULTA = { abierta: "Abierta", en_atencion: "En atención", esperando_socio: "Esperando respuesta del socio", resuelta: "Resuelta" };
function numeroConsulta(n) { return `C${Math.max(1, Number(n) || 1)}`; }
function nuevoMensaje({ autor, nombre, texto, origen = "web", interna = false, externalId = "", actor = "", at = new Date() } = {}) {
  return {
    id: crypto.randomBytes(6).toString("hex"), autor: autor === "equipo" ? "equipo" : "socio", nombre: clean(nombre, 80),
    texto: clean(texto, 3000), origen: origen === "telegram" ? "telegram" : "web", interna: !!interna && autor === "equipo",
    externalId: clean(externalId, 80), ...(actor ? { actor: clean(actor, 100) } : {}), at: at instanceof Date ? at.toISOString() : String(at),
  };
}
// Un mensaje externo ya agregado (mismo chat+message_id de Telegram) no se vuelve a guardar.
function yaExiste(mensajes = [], externalId = "") { return !!externalId && mensajes.some((m) => m.externalId === externalId); }
function estadoTrasMensaje(actual, autor) {
  if (actual === "resuelta" && autor === "equipo") return "resuelta";
  return autor === "equipo" ? "esperando_socio" : (actual === "esperando_socio" || actual === "resuelta" ? "en_atencion" : (actual || "abierta"));
}
function consultaPublica(id, c = {}, { conMensajes = true } = {}) {
  const mensajes = (Array.isArray(c.mensajes) ? c.mensajes : []).filter((m) => !m.interna);
  return {
    id, numero: c.numero || "", asunto: c.asunto || "", estado: c.estado || "abierta", estadoLabel: ESTADOS_CONSULTA[c.estado] || "Abierta",
    pedidoId: c.pedidoId || "", pedidoRef: c.pedidoRef || "", renglonId: c.renglonId || "", entregaId: c.entregaId || "",
    destinoLabel: c.destinoLabel || "", createdAt: ms(c.createdAt), updatedAt: ms(c.updatedAt),
    noLeidas: Number(c.noLeidasSocio || 0), ultimo: mensajes.length ? { autor: mensajes[mensajes.length - 1].autor, texto: clean(mensajes[mensajes.length - 1].texto, 140) } : null,
    ...(conMensajes ? { mensajes: mensajes.map((m) => ({ id: m.id, autor: m.autor, nombre: m.autor === "equipo" ? (m.nombre || "Equipo") : m.nombre, texto: m.texto, origen: m.origen, at: m.at })) } : {}),
  };
}
// Desde Telegram: ¿a qué hilo va un texto? Respuesta nativa o botón activo; nunca "el último" por suposición.
function hiloDesdeTelegram({ porRespuesta = "", porBoton = "", abiertas = 0 } = {}) {
  if (porRespuesta) return { consultaId: porRespuesta, via: "respuesta" };
  if (porBoton) return { consultaId: porBoton, via: "boton" };
  return { consultaId: "", via: abiertas > 0 ? "ambiguo" : "ninguno" };
}

/* ---------- historial anterior: simulación sin inventar datos ---------- */
// compras: [{id, socio_norm, estado, productos, clientePrincipal, cliente, createdAt, estadoHistorial, monto}]
// sociosVerificados: Set(socio_norm) · yaImportados: Set(entregaHistoricaId) · entregasActuales: Set(entregaId)
function clasificarHistorico({ compras = [], sociosVerificados = new Set(), yaImportados = new Set(), entregasActuales = new Set() } = {}) {
  const r = { encontradas: 0, vinculables: [], duplicadas: [], incompletas: [], sinSocio: [], ambiguas: [] };
  for (const c of compras) {
    if (norm(c.estado) !== "entregado") continue;
    r.encontradas++;
    const socio = norm(c.socio_norm);
    const productos = Array.isArray(c.productos) && c.productos.length ? c.productos : [{ renglonId: "r1", servicio: c.servicio }];
    const clientes = new Set(productos.map((p) => norm(p.clienteNombre || p.nombreCliente || "")).filter(Boolean));
    const histMix = Number(c.version) === 2 ? productos.some((p) => p.destinatario?.tipo === "otro") : clientes.size > 1;
    const entregado = (c.estadoHistorial || []).slice().reverse().find((h) => norm(h.estado) === "entregado");
    const base = { compraId: c.id, socio_norm: socio, ref: String(c.id).slice(-6).toUpperCase(), servicios: productos.map((p) => p.servicio || c.servicio || "").filter(Boolean),
      cliente: (c.clientePrincipal ? `${c.clientePrincipal.nombre || ""} ${c.clientePrincipal.apellido || ""}`.trim() : c.cliente) || "", fechaEntrega: entregado?.at || null, historicoAnterior: histMix };
    if (!socio || !sociosVerificados.has(socio)) { r.sinSocio.push({ ...base, motivo: "Socio no verificable" }); continue; }
    const ids = productos.map((p, i) => entregaHistoricaId("compras", c.id, p.renglonId || `r${i + 1}`));
    const actuales = productos.map((p, i) => entregaId(c.id, p.renglonId || `r${i + 1}`));
    if (ids.every((x) => yaImportados.has(x)) || actuales.every((x) => entregasActuales.has(x))) { r.duplicadas.push(base); continue; }
    if (!base.cliente) { r.ambiguas.push({ ...base, motivo: "Cliente sin identificar" }); continue; }
    if (!base.servicios.length) { r.incompletas.push({ ...base, motivo: "Faltan datos del servicio" }); continue; }
    r.vinculables.push(base);
  }
  return {
    encontradas: r.encontradas, vinculables: r.vinculables.length, duplicadas: r.duplicadas.length, incompletas: r.incompletas.length,
    sinSocio: r.sinSocio.length, ambiguas: r.ambiguas.length, sinFecha: r.vinculables.filter((x) => !x.fechaEntrega).length, detalle: r,
  };
}

module.exports = {
  clean, norm, safeId, escHtml, ms,
  entregaId, entregaHistoricaId, avisoId, estadoEntregaPedido,
  llaveCodigos, cifrarCodigo, descifrarCodigo, entregaPublica, filtrarEntregas, paginar,
  urlPanelEntrega, mensajeEntregaTelegram, botonPanel,
  nuevoTokenVinculo, hashToken, tokenDesdeStart, validarVinculo, PREFIJO_START,
  ESTADOS_CONSULTA, numeroConsulta, nuevoMensaje, yaExiste, estadoTrasMensaje, consultaPublica, hiloDesdeTelegram,
  clasificarHistorico,
};
