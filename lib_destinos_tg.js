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
async function getDestinoChatIds(destinoRaw) {
  const info = destinoInfo(destinoRaw);
  const envIds = String(process.env[info.env] || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (envIds.length) return [envIds[0]]; // destinatario específico: nunca abanicar un comprobante a varios chats
  if (info.key === "sublicuentas") {
    const superIds = String(process.env.SUPER_ADMIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (superIds.length) return [superIds[0]];
  }
  if (info.fallback) return [info.fallback];
  const err = new Error(`destino_sin_chat_id:${info.key}`);
  err.status = 503; err.publicError = "destino_sin_configurar";
  throw err;
}
module.exports = { destinoInfo, getDestinoChatIds };
