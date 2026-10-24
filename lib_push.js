// Notificaciones push (FCM) · Fase 2 · Oct-2026 (copia exacta de Sublichat HQ api/_push.js)
// MISMO ARCHIVO en Sublichat HQ (api/_push.js) y en el TG Bot (lib_push.js).
// CommonJS: lo usan mobile-core.js, tickets.js (ESM, import default) y el bot.
//
// - Tokens por teléfono en push_tokens/{sha256(token)}: un teléfono = un documento. Si en ese teléfono
//   entra otro usuario, el documento pasa a ese usuario (el anterior ya no recibe ahí).
// - Envío con Firebase Admin (credenciales del servidor; NUNCA en la APK).
// - Tokens que FCM rechaza (desinstaló la app, token vencido) se borran solos.
// - El aviso NO lleva datos sensibles: solo título, texto corto y a dónde abrir. Se rechaza el envío si
//   el texto parece llevar un correo, una clave o un PIN.

const crypto = require("crypto");
const COL = "push_tokens";
const CANAL = "sublichat_avisos";

function idToken(token) { return crypto.createHash("sha256").update(String(token || "")).digest("hex").slice(0, 40); }
function usuarioClave(v) {
  const k = String(v == null ? "" : v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/^asesor-/, "");
  return k === "geissel" ? "geisell" : k;
}
function tokenValido(t) { const s = String(t || "").trim(); return s.length >= 20 && s.length <= 4096 && /^[\w:\-.]+$/.test(s) ? s : ""; }

// Guardián de contenido: nada de correos, claves, PIN ni números largos en el aviso.
const SENSIBLE = /[\w.+-]+@[\w-]+\.[\w.]+|\b(clave|contrase(ñ|n)a|password|pin)\s*[:=]|\b\d{6,}\b/i;
function textoSeguro(v, max) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  if (SENSIBLE.test(s)) throw new Error("El aviso push no puede llevar correos, claves, PIN ni números largos.");
  return s;
}
const DATA_PERMITIDA = new Set(["tipo", "ir", "tab", "id"]);
function dataSegura(data = {}) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!DATA_PERMITIDA.has(k)) continue;
    out[k] = String(v == null ? "" : v).replace(/[^\w:\-.]/g, "").slice(0, 80);
  }
  return out;
}

// grupo = a quién va dirigido en tickets/avisos (sublicuentas · relojes · geisell · el usuario).
async function registrarToken(db, { token, usuario, role = "", grupo = "", appBuild = "", plataforma = "android" } = {}) {
  const t = tokenValido(token);
  if (!t) throw new Error("Token push inválido.");
  const u = usuarioClave(usuario);
  if (!u) throw new Error("Usuario requerido.");
  const ahora = new Date().toISOString();
  const ref = db.collection(COL).doc(idToken(t));
  const snap = await ref.get();
  await ref.set({
    token: t, usuario: u, role: String(role || "").toLowerCase().slice(0, 40), grupo: usuarioClave(grupo || u), plataforma: String(plataforma || "android").slice(0, 20),
    appBuild: String(appBuild || "").slice(0, 20), activo: true, updatedAt: ahora,
    ...(snap.exists ? {} : { createdAt: ahora }),
  }, { merge: true });
  return { ok: true, id: ref.id };
}

async function bajaToken(db, { token, usuario = "" } = {}) {
  const t = tokenValido(token);
  if (!t) return { ok: true };
  const ref = db.collection(COL).doc(idToken(t));
  const snap = await ref.get();
  // Solo el dueño actual puede dar de baja ese teléfono.
  if (snap.exists && (!usuario || (snap.data() || {}).usuario === usuarioClave(usuario))) await ref.delete();
  return { ok: true };
}

// destinatarios: { usuarios: ['sublicuentas','relojes'] } o { todos: true }; excluir: usuario que hizo el cambio.
async function enviarPush(db, admin, { usuarios = null, todos = false, excluir = "", titulo, cuerpo = "", data = {} } = {}) {
  const title = textoSeguro(titulo || "Sublichat", 80);
  const body = textoSeguro(cuerpo, 180);
  const extra = dataSegura(data);
  const lista = Array.isArray(usuarios) ? [...new Set(usuarios.map(usuarioClave).filter(Boolean))] : [];
  if (!todos && !lista.length) return { enviados: 0, fallidos: 0, borrados: 0 };
  const snap = await db.collection(COL).get();
  const excl = usuarioClave(excluir);
  const docs = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    if (x.activo === false || !x.token) return;
    if (excl && x.usuario === excl) return;
    if (excl && x.grupo === excl) return;
    if (!todos && !lista.includes(x.usuario) && !lista.includes(x.grupo) && !lista.includes(x.role)) return;
    docs.push({ id: d.id, token: x.token });
  });
  if (!docs.length) return { enviados: 0, fallidos: 0, borrados: 0 };
  let enviados = 0, fallidos = 0, borrados = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const lote = docs.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: lote.map((d) => d.token),
      notification: { title, body },
      data: extra,
      android: { priority: "high", notification: { channelId: CANAL, icon: "ic_stat_sublicuentas", color: "#E2231A" } },
    });
    enviados += res.successCount; fallidos += res.failureCount;
    const muertos = [];
    res.responses.forEach((r, k) => {
      const code = r && r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token" || code === "messaging/invalid-argument") muertos.push(lote[k].id);
    });
    for (const id of muertos) { await db.collection(COL).doc(id).delete().catch(() => null); borrados++; }
  }
  return { enviados, fallidos, borrados };
}

// Nunca rompe la operación principal (guardar ticket, cambiar clave…): si push falla, solo se registra.
async function avisar(db, admin, opciones) {
  try { return await enviarPush(db, admin, opciones); }
  catch (e) {
    // Texto con datos sensibles (p. ej. un ticket que pegó una clave): se avisa sin el texto.
    if (/no puede llevar/.test(String(e && e.message))) {
      try { return await enviarPush(db, admin, { ...opciones, cuerpo: "Abra Sublichat para verlo." }); } catch (_) { /* abajo */ }
    }
    console.error("PUSH_ERROR", e && e.message || e); return { enviados: 0, error: String(e && e.message || e) };
  }
}

module.exports = { COL, CANAL, idToken, usuarioClave, tokenValido, textoSeguro, dataSegura, registrarToken, bajaToken, enviarPush, avisar };
