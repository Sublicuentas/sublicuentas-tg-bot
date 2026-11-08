"use strict";
/* Destinos de Telegram del equipo (Sublicuentas / Relojes / Geisell). Compartido por server_api.js (Panel API)
   y el bot (index_36_socios_telegram.js) para que ambos procesos avisen al mismo chat. Extraído sin cambios de server_api.js. */
const { normVendedor } = require("./index_17_vendedores_servicio");
function revNormKey(v) {
  return normVendedor(String(v || "")) === "geissel" ? "geisell" : normVendedor(String(v || ""));
}
function destinoInfo(destinoRaw) {
  const destino = revNormKey(String(destinoRaw || "sublicuentas")).replace(/^geissel$/, "geisell");
  const destinos = {
    relojes: { key: "relojes", label: "⌚ Relojes", fallback: "411539492", env: "RELOJES_CHAT_ID" },
    sublicuentas: { key: "sublicuentas", label: "🟣 Sublicuentas", fallback: "5728675990", env: "SUBLICUENTAS_CHAT_ID" },
    geisell: { key: "geisell", label: "👤 Geisell", fallback: "", env: "GEISELL_CHAT_ID" },
  };
  const info = destinos[destino];
  if (!info) {
    const err = new Error("destino_invalido");
    err.status = 400; err.publicError = "destino_invalido";
    throw err;
  }
  return info;
}
// R195 · CAUSA RAÍZ (comprobantes de Sublicuentas que no llegaban): este archivo solo leía SUBLICUENTAS_CHAT_ID / RELOJES_CHAT_ID,
// pero el resto del sistema (Tickets, Sala de Juntas, accesos) usa TELEGRAM_CHAT_ID_SUBLICUENTAS / TELEGRAM_CHAT_ID_RELOJES.
// Sin la variable "vieja", Sublicuentas caía al PRIMER id de SUPER_ADMIN (otra persona/chat si no es el primero) y Relojes a un
// id fijo en el código. Ahora: 1) TELEGRAM_CHAT_ID_<DESTINO> (la misma de Tickets) 2) <DESTINO>_CHAT_ID 3) SUPER_ADMIN (solo
// Sublicuentas) 4) respaldo histórico. La fuente usada queda registrada en cada comprobante y se ve en el diagnóstico.
const ENV_CANONICO = { sublicuentas: ["TELEGRAM_CHAT_ID_SUBLICUENTAS"], relojes: ["TELEGRAM_CHAT_ID_RELOJES"], geisell: ["TELEGRAM_CHAT_ID_GEISELL", "TELEGRAM_CHAT_ID_GEISSEL"] };
const primero = (v) => String(v || "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)[0] || "";
function resolverDestino(destinoRaw, env = process.env) {
  const info = destinoInfo(destinoRaw);
  for (const k of [...(ENV_CANONICO[info.key] || []), info.env]) { const id = primero(env[k]); if (id) return { info, chatId: id, fuente: k }; }
  if (info.key === "sublicuentas") { const id = primero(env.SUPER_ADMIN); if (id) return { info, chatId: id, fuente: "SUPER_ADMIN (primer id)" }; }
  if (info.fallback) return { info, chatId: info.fallback, fuente: "respaldo fijo en el código" };
  const err = new Error(`destino_sin_chat_id:${info.key}`);
  err.status = 503; err.publicError = "destino_sin_configurar";
  throw err;
}
async function getDestinoChatIds(destinoRaw) {
  return [resolverDestino(destinoRaw).chatId]; // destinatario específico: nunca abanicar un comprobante a varios chats
}
// Para registros y pantallas: nunca el id completo.
function enmascararChat(id) { const s = String(id || ""); return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`; }
module.exports = { destinoInfo, getDestinoChatIds, resolverDestino, enmascararChat, ENV_CANONICO };
