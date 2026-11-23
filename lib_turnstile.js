/* R201 · Cloudflare Turnstile (validación SIEMPRE en el servidor).
   Variables de entorno (Render): TURNSTILE_SECRET_KEY (secreta), TURNSTILE_SITE_KEY (pública),
   TURNSTILE_MODE = off | web | all (por defecto: web si hay secreta, off si no),
   TURNSTILE_HOSTNAMES = lista separada por comas (opcional) de hostnames válidos.
   · web: exige el token a todo navegador (cabecera Origin https que no sea localhost).
   · all: lo exige siempre (usar cuando todos tengan la APK nueva).
   La clave secreta nunca sale del servidor ni se escribe en logs. */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileModo() {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) return "off";
  const m = String(process.env.TURNSTILE_MODE || "web").trim().toLowerCase();
  return ["off", "web", "all"].includes(m) ? m : "web";
}

function esNavegadorWeb(req) {
  const o = String((req.headers && req.headers.origin) || "").trim().toLowerCase();
  return /^https:\/\//.test(o) && !/^https:\/\/localhost(?::\d+)?$/.test(o);
}

function ipCliente(req) {
  const h = req.headers || {};
  return String(h["cf-connecting-ip"] || h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0] || (req.socket && req.socket.remoteAddress) || "").trim().slice(0, 64);
}

/** Devuelve { ok:true } o { ok:false, status, error }. Nunca lanza. */
async function verificarTurnstile(req, { token, accion = "", fetchImpl } = {}) {
  const modo = turnstileModo();
  if (modo === "off") return { ok: true, omitido: "sin_configurar" };
  if (modo === "web" && !esNavegadorWeb(req)) return { ok: true, omitido: "app" };
  const t = String(token || "").trim();
  if (!t || t.length > 2048) return { ok: false, status: 400, error: "verificacion_requerida" };
  const f = fetchImpl || globalThis.fetch;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
  try {
    const body = new URLSearchParams({ secret: String(process.env.TURNSTILE_SECRET_KEY).trim(), response: t });
    const ip = ipCliente(req); if (ip) body.set("remoteip", ip);
    const r = await f(VERIFY_URL, { method: "POST", body, signal: ctl ? ctl.signal : undefined });
    const j = await r.json().catch(() => ({}));
    if (!j || j.success !== true) return { ok: false, status: 403, error: "verificacion_fallida" };
    const hosts = String(process.env.TURNSTILE_HOSTNAMES || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (hosts.length && !hosts.includes(String(j.hostname || "").toLowerCase())) return { ok: false, status: 403, error: "verificacion_fallida" };
    if (accion && j.action && j.action !== accion) return { ok: false, status: 403, error: "verificacion_fallida" };
    return { ok: true };
  } catch (_) {
    return { ok: false, status: 503, error: "verificacion_no_disponible" }; // falla cerrada: sin verificación no se procesa
  } finally { if (timer) clearTimeout(timer); }
}

function turnstileConfigPublica() {
  const modo = turnstileModo();
  return { activo: modo !== "off", siteKey: modo === "off" ? "" : String(process.env.TURNSTILE_SITE_KEY || "").trim() };
}

module.exports = { verificarTurnstile, turnstileConfigPublica, turnstileModo, ipCliente, esNavegadorWeb };
