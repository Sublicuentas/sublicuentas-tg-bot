/* ✅ SUBLICUENTAS TG BOT — PARTE 7/7 v19
   IMAP — CÓDIGOS Y LINKS: NETFLIX / DISNEY / HBO / PRIME / VIX / UNIVERSAL / SPOTIFY
   ----------------------------------------------------------------
   ✅ CAMBIOS v16:
   - NUEVO: esVix() — detecta emails de Vix
   - NUEVO: /code ahora extrae códigos de HBO Max (4 dígitos) y Vix
   - NUEVO: /code ahora extrae códigos de Prime Video (ya no solo /prime)
   - NUEVO: /link ahora incluye links de Vix (login, cambio correo, clave)
   - FIX: /hogar ahora también devuelve link de confirmación de hogar Netflix
   - FIX: extraerLink incluye patrones de Vix
*/

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const { bot, EMAIL_ACCOUNTS } = require("./index_01_core");
const { isAdmin, logErr, escMD } = require("./index_02_utils_roles");

// Resolución robusta de credenciales IMAP en Render.
// Históricamente este bot ha usado varios nombres de variables. En vez de
// depender de uno solo, normalizamos las claves y aceptamos las familias
// EMAIL_ADMIN_*, EMAIL_IMAP_* e IMAP_*_N (PASS/PASSWORD/PWD).
function normalizarClaveEnv(k = "") {
  return String(k || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapaEnvNormalizado() {
  const out = new Map();
  for (const [rawKey, rawValue] of Object.entries(process.env || {})) {
    const key = normalizarClaveEnv(rawKey);
    if (!key) continue;
    const value = String(rawValue ?? "");
    const anterior = out.get(key);
    // Si Render llegara a exponer dos claves equivalentes, preferimos la que
    // tenga contenido. Nunca registramos aquí el valor de un secreto.
    if (!anterior || (!String(anterior.value || "").length && value.length)) {
      out.set(key, { rawKey, value });
    }
  }
  return out;
}

function buscarEnv(aliases = [], matcher = null, { requireEmail = false } = {}) {
  const env = mapaEnvNormalizado();
  for (const alias of aliases) {
    const hit = env.get(normalizarClaveEnv(alias));
    if (!hit) continue;
    const value = String(hit.value ?? "");
    if (!value.length) continue;
    if (requireEmail && !value.includes("@")) continue;
    return { value, key: hit.rawKey };
  }
  if (typeof matcher === "function") {
    for (const [normKey, hit] of env.entries()) {
      const value = String(hit.value ?? "");
      if (!value.length || !matcher(normKey, value)) continue;
      if (requireEmail && !value.includes("@")) continue;
      return { value, key: hit.rawKey };
    }
  }
  return { value: "", key: "" };
}

function valorBool(v, fallback = true) {
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (["0", "false", "no", "off", "disabled"].includes(s)) return false;
  if (["1", "true", "yes", "si", "sí", "on", "ssl", "tls", "secure"].includes(s)) return true;
  return fallback;
}

function resolverImapBase() {
  const hostHit = buscarEnv(
    ["EMAIL_IMAP_HOST", "IMAP_HOST", "IMAP_HOST_1"],
    (k) => /^(?:EMAIL_)?IMAP_HOST(?:_\d+)?$/.test(k)
  );
  const portHit = buscarEnv(
    ["EMAIL_IMAP_PORT", "IMAP_PORT", "IMAP_PORT_1"],
    (k) => /^(?:EMAIL_)?IMAP_PORT(?:_\d+)?$/.test(k)
  );
  const userHit = buscarEnv(
    [
      "EMAIL_ADMIN_USER", "EMAIL_ADMIN_USERNAME", "EMAIL_ADMIN_EMAIL",
      "EMAIL_IMAP_USER", "EMAIL_IMAP_USERNAME", "IMAP_USER", "IMAP_USER_1",
      "IMAP_USERNAME_1", "IMAP_EMAIL_1"
    ],
    (k, value) => (
      /^(?:EMAIL_ADMIN|EMAIL_IMAP|IMAP)_(?:USER|USERNAME|EMAIL)(?:_\d+)?$/.test(k) && value.includes("@")
    ),
    { requireEmail: true }
  );
  const passHit = buscarEnv(
    [
      "EMAIL_ADMIN_PASS", "EMAIL_ADMIN_PASSWORD", "EMAIL_ADMIN_PWD",
      "EMAIL_IMAP_PASS", "EMAIL_IMAP_PASSWORD", "EMAIL_IMAP_PWD",
      "IMAP_PASS", "IMAP_PASSWORD", "IMAP_PWD",
      "IMAP_PASS_1", "IMAP_PASSWORD_1", "IMAP_PWD_1"
    ],
    (k) => /^(?:EMAIL_ADMIN|EMAIL_IMAP|IMAP)_(?:PASS|PASSWORD|PWD)(?:_\d+)?$/.test(k)
  );
  const secureHit = buscarEnv(
    ["EMAIL_IMAP_SECURE", "IMAP_SECURE", "IMAP_SECURE_1", "IMAP_TLS", "IMAP_TLS_1"],
    (k) => /^(?:EMAIL_)?IMAP_(?:SECURE|TLS)(?:_\d+)?$/.test(k)
  );
  const sourceHit = buscarEnv(
    ["IMAP_SOURCE_1", "IMAP_SOURCE", "EMAIL_IMAP_SOURCE"],
    (k) => /^(?:EMAIL_)?IMAP_(?:SOURCE|NAME|LABEL)(?:_\d+)?$/.test(k)
  );

  const portParsed = Number(portHit.value || 993);
  return {
    name: String(sourceHit.value || "hosting-principal").trim() || "hosting-principal",
    host: String(hostHit.value || "premium48.web-hosting.com").trim(),
    port: Number.isFinite(portParsed) && portParsed > 0 ? portParsed : 993,
    tls: valorBool(secureHit.value, true),
    user: String(userHit.value || "admin@sublicuentas.com").trim(),
    password: String(passHit.value || ""),
    _keys: {
      host: hostHit.key || "(fallback premium48.web-hosting.com)",
      port: portHit.key || "(fallback 993)",
      user: userHit.key || "(fallback admin@sublicuentas.com)",
      password: passHit.key || "(no detectada)",
      secure: secureHit.key || "(fallback true)",
      source: sourceHit.key || "(fallback hosting-principal)",
    },
  };
}

function resolverCuentasImapNumeradas() {
  const env = mapaEnvNormalizado();
  const indices = new Set();
  for (const key of env.keys()) {
    const m = key.match(/^IMAP_(?:USER|USERNAME|EMAIL|PASS|PASSWORD|PWD|HOST|PORT|SECURE|TLS|SOURCE|NAME|LABEL)_(\d+)$/);
    if (m) indices.add(Number(m[1]));
  }
  const base = resolverImapBase();
  const out = [];

  const get = (...keys) => {
    for (const k of keys) {
      const hit = env.get(normalizarClaveEnv(k));
      if (hit && String(hit.value ?? "").length) return { value: String(hit.value), key: hit.rawKey };
    }
    return { value: "", key: "" };
  };

  for (const n of [...indices].sort((a, b) => a - b)) {
    const user = get(`IMAP_USER_${n}`, `IMAP_USERNAME_${n}`, `IMAP_EMAIL_${n}`);
    const pass = get(`IMAP_PASS_${n}`, `IMAP_PASSWORD_${n}`, `IMAP_PWD_${n}`);
    if (!user.value || !pass.value) continue;
    const host = get(`IMAP_HOST_${n}`);
    const port = get(`IMAP_PORT_${n}`);
    const secure = get(`IMAP_SECURE_${n}`, `IMAP_TLS_${n}`);
    const source = get(`IMAP_SOURCE_${n}`, `IMAP_NAME_${n}`, `IMAP_LABEL_${n}`);
    const portNum = Number(port.value || base.port || 993);
    out.push({
      name: String(source.value || `imap-${n}`).trim() || `imap-${n}`,
      host: String(host.value || base.host || "premium48.web-hosting.com").trim(),
      port: Number.isFinite(portNum) && portNum > 0 ? portNum : 993,
      tls: valorBool(secure.value, base.tls),
      user: String(user.value).trim(),
      password: String(pass.value),
      _keys: { user: user.key, password: pass.key, host: host.key || base._keys.host },
    });
  }
  return out;
}

const disneyUltimoEntregado = global.__SUBLICUENTAS_DISNEY_OTP__ || new Map();
global.__SUBLICUENTAS_DISNEY_OTP__ = disneyUltimoEntregado;
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

function cuentasImapCodigos() {
  const base = resolverImapBase();
  const legacy = {
    name: base.name, host: base.host, port: base.port, tls: base.tls,
    user: base.user, password: base.password, _keys: base._keys,
  };
  const rows = [legacy, ...resolverCuentasImapNumeradas(), ...(Array.isArray(EMAIL_ACCOUNTS) ? EMAIL_ACCOUNTS : [])];
  const seen = new Set();
  return rows.filter(row => {
    const host = String(row?.host || "").trim();
    const user = String(row?.user || "").trim();
    const password = String(row?.password || row?.pass || "");
    const key = `${host.toLowerCase()}|${user.toLowerCase()}`;
    if (!host || !user || !password || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function estadoImapSeguro() {
  const base = resolverImapBase();
  const cuentas = cuentasImapCodigos();
  const variables = Object.keys(process.env || {})
    .filter(k => {
      const n = normalizarClaveEnv(k);
      return n.startsWith("IMAP_") || n.startsWith("EMAIL_IMAP_") || n.startsWith("EMAIL_ADMIN_");
    })
    .sort();
  return {
    cuentasValidas: cuentas.length,
    host: Boolean(base.host),
    user: Boolean(base.user),
    password: Boolean(base.password),
    port: base.port,
    tls: base.tls,
    selectedKeys: base._keys,
    variables,
  };
}

// ===============================
// HELPERS BASE
// ===============================
function normalizarCorreo(c = "") { return String(c||"").trim().toLowerCase(); }

function normalizarTextoBusqueda(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodificarEntidadesHtmlBasicas(v = "") {
  return String(v || "")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
    })
    .replace(/&#([0-9]{1,7});/g, (_, dec) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
    })
    .replace(/&(?:nbsp|ensp|emsp|thinsp|zwnj|zwj);/gi, " ")
    .replace(/&amp;/gi, "&");
}

function htmlATextoVisible(html = "") {
  return decodificarEntidadesHtmlBasicas(html)
    // Disney deja OTP anteriores dentro de preheaders/bloques ocultos. Esos
    // números existen en el HTML, pero no son el código que ve el usuario.
    .replace(/<([a-z0-9]+)\b[^>]*\b(?:hidden|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|font-size\s*:\s*0|max-height\s*:\s*0)[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*\b(?:hidden|aria-hidden\s*=\s*["']?true)[^>]*\/?>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<(?:br|\/p|\/div|\/td|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function emailCodigoVigente(email = {}, minutos = 120) {
  const tsInterno = Number(email.ts || 0);
  const tsCabecera = new Date(email.date || 0).getTime();
  const ts = tsInterno > 0 ? tsInterno : tsCabecera;
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return Date.now() - ts <= Math.max(1, Number(minutos || 0)) * 60 * 1000;
}

function formatearFecha(date) {
  try { return new Date(date).toLocaleString("es-HN",{timeZone:"America/Tegucigalpa",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
  catch(_){ return String(date||""); }
}

// ===============================
// DETECTORES DE PLATAFORMA
// ===============================
function esNetflix(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("netflix") || s.includes("netflix");
}

function esNetflixCodigo(from="",subject=""){
  if(!esNetflix(from,subject)) return false;
  const s=subject.toLowerCase();
  if(s.includes("restablecimiento")||s.includes("reset")||s.includes("password")||
     s.includes("contrase")||s.includes("cambio")||s.includes("actualiza")) return false;
  return s.includes("verificaci")||s.includes("seguridad")||
         s.includes("confirmaci")||s.includes("hogar")||s.includes("household")||
         s.includes("inicio de sesi");
}

function esNetflixReset(from="",subject=""){
  if(!esNetflix(from,subject)) return false;
  const s=subject.toLowerCase();
  return s.includes("restablecimiento")||s.includes("reset")||s.includes("password")||
         s.includes("contrase")||s.includes("cambio")||s.includes("actualiza");
}

function esDisney(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("disney")||s.includes("disneyplus")||s.includes("disney plus")||s.includes("disney+");
}

function esDisneyCodigo(from="", subject="", text="") {
  if (!esDisney(from, subject)) return false;
  const s = normalizarTextoBusqueda(`${subject} ${String(text || "").slice(0, 1200)}`);
  return [
    "codigo", "one-time code", "one time code", "one-time passcode",
    "verification code", "access code", "passcode", "otp",
    // Sueco: "Din engångskod till Disney+"
    "engangskod", "engangskoden",
    // Variantes frecuentes en otros idiomas europeos.
    "einmalcode", "einmaliger code", "code unique", "toegangscode"
  ].some(k => s.includes(k));
}

function esHBO(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("hbo")||f.includes("max.com")||f.includes("hbomax")||
         s.includes("hbo max")||s.includes("hbomax")||
         (s.includes("hbo") && !f.includes("netflix") && !f.includes("disney") && !f.includes("amazon"));
}

function esPrime(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("amazon")||f.includes("primevideo")||
         s.includes("prime video")||s.includes("primevideo")||s.includes("amazon prime")||
         (f.includes("prime") && !f.includes("paramount"));
}

function esParamount(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("paramount")||f.includes("cbs.com")||f.includes("viacom")||
         s.includes("paramount")||s.includes("paramount+");
}

function esUniversal(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("universal")||s.includes("universal")||s.includes("universal+");
}

function esSpotify(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("spotify") || s.includes("spotify");
}

// Correos que SOLO avisan (nuevo inicio de sesión, cuenta modificada, bienvenida,
// invitación a familia). Traen links de "si no fuiste tú, restablece tu clave"
// en el cuerpo, pero NO son un restablecimiento ni traen el OTP.
function esNotificacionCuenta(subject = "") {
  const s = normalizarTextoBusqueda(subject);
  return [
    "nuevo inicio de sesion", "inicio de sesion nuevo", "new sign-in", "new sign in", "new login",
    "se ha modificado", "ha sido modificad", "has been updated", "was changed", "se actualizo",
    "te damos la bienvenida", "bienvenid", "welcome to",
    "invited to join", "te invitaron", "invitacion", "mydisney family", "familia mydisney",
    "tu contrasena ha cambiado", "tu contrasena se cambio", "password has been changed", "password was changed",
  ].some(k => s.includes(k));
}

// El restablecimiento se decide por el ASUNTO. Antes se miraba también el cuerpo
// completo y cualquier correo con un pie "restablece tu contraseña" (como
// "Nuevo inicio de sesión" de Disney) se entregaba como link de reset.
function esReset(subject = "", _text = "") {
  if (esNotificacionCuenta(subject)) return false;
  const s = normalizarTextoBusqueda(subject);
  return s.includes("restablec") || s.includes("reset") || s.includes("recupera") ||
         s.includes("olvidaste") || s.includes("cambiar tu contrasena") || s.includes("cambia tu contrasena") ||
         s.includes("change your password") || s.includes("forgot your password");
}

function esVix(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("vix.com")||f.includes("@vix")||f.includes("vix@")||
         s.includes("vix.com")||
         (s.includes("vix") && (s.includes("acceso")||s.includes("verifica")||
          s.includes("código")||s.includes("codigo")||s.includes("correo")||
          s.includes("contrase")||s.includes("login")||s.includes("inicio")));
}

function esHogar(subject="",text=""){
  const s=subject.toLowerCase(); const t=text.toLowerCase();
  return s.includes("hogar")||s.includes("household")||s.includes("extra member")||t.includes("netflix hogar");
}

// ===============================
// EXTRACCIÓN DE CÓDIGOS
// ===============================

/**
 * Extrae código numérico o alfanumérico. Validaciones estrictas por plataforma.
 */
function extraerCodigoInteligente(text = "", subject = "", html = "", plataforma = "otro") {
  const basuraAnios = new Set(["2024", "2025", "2026", "2027"]);
  const htmlVisible = htmlATextoVisible(html);
  // El texto plano representa mejor lo que ve el usuario. El HTML queda de respaldo.
  const fuentePrincipal = (subject + " " + text).replace(/\s+/g, " ").trim();
  const fuente = (fuentePrincipal + " " + htmlVisible).replace(/\s+/g, " ");

  // Universal+ usa un OTP numérico de 6 dígitos.
  if (plataforma === "universal") {
    for (const origen of [htmlVisible, fuentePrincipal]) {
      const contexto = origen.match(/(?:c[oó]digo|code|otp|pin|verificaci[oó]n|inicio de sesi[oó]n|acceso)[\s\S]{0,160}?(\d(?:[\s\u00a0]*\d){5})(?!\d)/i);
      if (contexto) return contexto[1].replace(/\s/g, "");
      const codigos = origen.match(/(?<!\d)\d{6}(?!\d)/g) || [];
      const valido = codigos.find(c => !basuraAnios.has(c));
      if (valido) return valido;
    }
    return null;
  }

  function esValido(c = "") {
    const s = c.replace(/\s/g, "");
    if (basuraAnios.has(s)) return null;
    if (["disney", "prime", "hbo", "vix"].includes(plataforma) && s.length !== 6) return null;
    if (plataforma === "spotify" && s.length !== 6) return null;
    if (/^\d{4,6}$/.test(s)) return s;
    return null;
  }

  if (plataforma === "disney") {
    // Disney localiza el mismo correo a muchos idiomas. Normalizamos acentos
    // para reconocer, entre otros, el sueco "engångskod".
    // Primero el HTML visible: el texto plano generado por algunos hostings
    // incluye preheaders ocultos con un OTP viejo (por ejemplo 814644).
    for (const origenOriginal of [htmlVisible, fuentePrincipal]) {
      const origen = normalizarTextoBusqueda(`${subject} ${origenOriginal}`);
      const contextoDisney = origen.match(/(?:codigo(?:\s+(?:de\s+)?(?:acceso|verificacion))?|one[- ]time (?:code|passcode)|verification code|access code|passcode|otp|engangskod(?:en)?|einmal(?:iger )?code|code unique|toegangscode)[^0-9]{0,220}?((?:\d\s*){6})(?!\d)/i);
      if (contextoDisney) {
        const v = esValido(contextoDisney[1]);
        if (v) return v;
      }
      // Algunas plantillas colocan cada dígito en una celda/span diferente.
      const secuencias = origen.match(/(?<!\d)(\d(?:[\s\u00a0\u200b-\u200d\ufeff]*\d){5})(?!\d)/g) || [];
      for (const secuencia of secuencias) {
        const v = esValido(secuencia);
        if (v) return v;
      }
    }
    return null;
  }

  if (plataforma === "spotify") {
    const contextoSpotify = fuentePrincipal.match(/(?:c[oó]digo|code|otp|inicio de sesi[oó]n|log[ -]?in)[\s\S]{0,120}?(\d{6})(?!\d)/i);
    if (contextoSpotify) return contextoSpotify[1];
    const codigos6 = fuentePrincipal.match(/(?<!\d)\d{6}(?!\d)/g) || [];
    for (const c of codigos6) { const v = esValido(c); if (v) return v; }
    return null;
  }

  if (["prime", "hbo", "vix"].includes(plataforma)) {
    const contexto6 = fuentePrincipal.match(/(?:c[oó]digo|code|otp|pin|verificaci[oó]n|inicio de sesi[oó]n)[\s\S]{0,100}?(\d{6})(?!\d)/i);
    if (contexto6) return contexto6[1];
    const codigos6 = fuentePrincipal.match(/(?<!\d)\d{6}(?!\d)/g) || [];
    for (const c of codigos6) { const v = esValido(c); if (v) return v; }
    return null;
  }

  const subjL = String(subject || "").toLowerCase();

  // ✅ Netflix "inicio de sesión" y "acceso temporal" usan 4 dígitos — buscar 4 primero
  const netflixPide4 = plataforma === "netflix" && (
    subjL.includes("inicio de sesi") ||
    subjL.includes("acceso temporal") ||
    subjL.includes("ingresa este c") ||
    subjL.includes("code to sign in") ||
    subjL.includes("sign-in code")
  );

  // ✅ Netflix "verificación" y "confirmación" usan 6 dígitos
  const netflixPide6 = plataforma === "netflix" && (
    subjL.includes("verificaci") ||
    subjL.includes("confirmaci") ||
    subjL.includes("código de verif")
  );

  if (netflixPide4) {
    // Buscar 4 dígitos primero, ignorar 6 dígitos
    const match4 = fuente.match(/(?<!\d)(\d{4})(?!\d)/g);
    if (match4) {
      for (const c of match4) { const v = esValido(c); if (v) return v; }
    }
    return null;
  }

  if (netflixPide6) {
    // Buscar 6 dígitos primero
    const match6 = fuente.match(/(?<!\d)(\d{6})(?!\d)/g);
    if (match6) {
      for (const c of match6) { const v = esValido(c); if (v) return v; }
    }
    // Fallback a 4
    const match4 = fuente.match(/(?<!\d)(\d{4})(?!\d)/g);
    if (match4) {
      for (const c of match4) { const v = esValido(c); if (v) return v; }
    }
    return null;
  }

  // Para otras plataformas y Netflix genérico: probar 4 dígitos cerca de palabras clave primero
  // luego 6, luego 4 general
  const match4cerca = fuente.match(/(?:código|code|clave|pin)[^\d]{0,20}(\d{4})(?!\d)/gi);
  if (match4cerca) {
    for (const m of match4cerca) {
      const nums = m.match(/\d{4}/);
      if (nums) { const v = esValido(nums[0]); if (v) return v; }
    }
  }

  const match6 = fuente.match(/(?<!\d)(\d{6})(?!\d)/g);
  if (match6) {
    for (const c of match6) { const v = esValido(c); if (v) return v; }
  }

  const match4 = fuente.match(/(?<!\d)(\d{4})(?!\d)/g);
  if (match4) {
    for (const c of match4) { const v = esValido(c); if (v) return v; }
  }

  return null;
}

// Links de reset de contraseña/correo
function extraerLink(text="", html="") {
  const fuentes = [html, text].filter(Boolean);
  const pats = [
    /https:\/\/www\.netflix\.com\/password[^\s"<>\]&]+(?:&amp;|&)[^\s"<>\]]*/i,
    /https:\/\/www\.netflix\.com\/password[^\s"<>\]]+/i,
    /https:\/\/www\.netflix\.com\/[^\s"<>\]]*reset[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*netflix[^\s"<>\]]*password[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*disneyplus[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*disney[^\s"<>\]]*account[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*hbomax[^\s"<>\]]*(?:reset|password|account|verify)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*max\.com[^\s"<>\]]*(?:reset|password|account|verify|email)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*paramount[^\s"<>\]]*(?:reset|password|account|verify|login|signin)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*cbsinteractive[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*viacomcbs[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*universal[^\s"<>\]]*(?:reset|password|account|verify)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*spotify[^\s"<>\]]*(?:reset|password|account|verify|login)[^\s"<>\]]*/i,
    // Vix
    /https:\/\/[^\s"<>\]]*vix\.com[^\s"<>\]]*(?:reset|password|account|verify|email|confirm)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*vix[^\s"<>\]]*(?:reset|password|cuenta|correo|verificar|confirmar)[^\s"<>\]]*/i,
  ];
  for (const f of fuentes) {
    for (const p of pats) {
      const m = f.match(p);
      if (m?.[0]) {
        let url = m[0].replace(/&amp;/g,"&").replace(/["\s>]+$/,"").trim();
        try { url = decodeURIComponent(url.replace(/\+/g," ")); } catch(_) {}
        return url;
      }
    }
  }
  return null;
}

function extraerLinkObtenerCodigo(html="") {
  const pat = /https:\/\/[^"'>]+netflix\.com[^"'>]*(?:travel|verify|temporary|update|account\/travel)[^"'>]*/i;
  const m = html.match(pat);
  if(m) return m[0].replace(/&amp;/g, "&").trim();
  return null;
}

async function scrapearCodigoWeb(url) {
  try {
    if(typeof fetch !== "undefined") {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      const html = await res.text();
      const m1 = html.match(/>\s*([0-9]{4})\s*</);
      if (m1 && m1[1]) return m1[1];
    }
  } catch(e) {}
  return null;
}

// ===============================
// LECTURA IMAP — sin SEARCH para compatibilidad con cPanel
// ===============================
async function buscarEmailsCuenta(correo, limite=15, cuenta={}) {
  const correoBuscar = String(correo||"").trim().toLowerCase();
  const base = resolverImapBase();

  const client = new ImapFlow({
    host:String(cuenta.host||base.host), port:Number(cuenta.port||base.port), secure:cuenta.tls!==false,
    auth:{user:String(cuenta.user||base.user), pass:String(cuenta.password||cuenta.pass||base.password)},
    logger:{
      debug: (obj) => console.log("[IMAP DBG]", obj?.msg || JSON.stringify(obj).slice(0,120)),
      info:  (obj) => console.log("[IMAP INF]", obj?.msg || ""),
      warn:  (obj) => console.warn("[IMAP WRN]", obj?.msg || ""),
      error: (obj) => console.error("[IMAP ERR]", obj?.msg || ""),
    },
    tls:{rejectUnauthorized:false},
  });

  await client.connect();
  const emails = [];

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = client.mailbox?.exists || 0;
      if (!total) return [];

      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 3);

      // Traer suficientes headers para buzones con bastante tráfico. Solo se
      // descarga el cuerpo de los candidatos, así que sigue siendo liviano.
      const inicio = total;
      const fin    = Math.max(1, total - 199);
      const rango  = `${fin}:${inicio}`;

      // ✅ Paso 1: traer envelope con internalDate — guardar seq + fecha exacta del servidor
      const candidatos = []; // { seq, uid, ts }
      for await (const msg of client.fetch(rango, { envelope: true, internalDate: true, uid: true })) {
        try {
          const fecha = msg.internalDate ? new Date(msg.internalDate) : new Date(0);
          if (fecha < fechaLimite) continue;

          const fromStr = String(msg.envelope?.from?.[0]?.address || msg.envelope?.from?.[0]?.name || "").toLowerCase();
          const subjStr = String(msg.envelope?.subject || "").toLowerCase();

          const esPlatConocida =
            fromStr.includes("netflix") || fromStr.includes("disney") ||
            fromStr.includes("hbo") || fromStr.includes("max.com") ||
            fromStr.includes("amazon") || fromStr.includes("primevideo") ||
            fromStr.includes("paramount") || fromStr.includes("vix") ||
            fromStr.includes("universal") || fromStr.includes("spotify") || fromStr.includes("crunchyroll") ||
            subjStr.includes("netflix") || subjStr.includes("disney") || subjStr.includes("spotify") ||
            subjStr.includes("hbo") || subjStr.includes("amazon") ||
            subjStr.includes("código") || subjStr.includes("codigo") ||
            subjStr.includes("verifica") || subjStr.includes("acceso") ||
            subjStr.includes("contrase") || subjStr.includes("restablec");

          if (esPlatConocida) candidatos.push({ seq: msg.seq, uid: Number(msg.uid || 0), ts: fecha.getTime() });
        } catch(_) {}
      }

      // ✅ Ordenar candidatos: más reciente primero (por internalDate del servidor)
      // Algunos hostings guardan dos OTP reenviados dentro del mismo segundo.
      // En ese caso internalDate empata; UID/sequence más alto es el correo que
      // llegó último y, para Disney, el único código que sigue siendo válido.
      candidatos.sort((a, b) => b.ts - a.ts || b.uid - a.uid || b.seq - a.seq);

      // ✅ Paso 2: descargar source solo de candidatos, del más reciente al más viejo
      for (const { seq, uid, ts } of candidatos) {
        if (emails.length >= limite) break;
        try {
          const data = await client.fetchOne(String(seq), { source: true });
          if (!data?.source) continue;

          const p = await simpleParser(data.source);

          const bodyText = String(p.text    || "").toLowerCase();
          const bodyHtml = String(p.html    || "").toLowerCase();
          const subj     = String(p.subject || "").toLowerCase();
          const toAddr   = (p.to?.text      || "").toLowerCase();
          // En correos reenviados/catch-all, el destinatario original puede
          // aparecer solo en Delivered-To, X-Original-To o Envelope-To. Esos
          // encabezados siguen presentes en el source aunque p.to sea admin@.
          const rawSource = Buffer.isBuffer(data.source) ? data.source.toString("utf8") : String(data.source || "");
          const rawHeaders = rawSource.split(/\r?\n\r?\n/, 1)[0].toLowerCase();
          const allText  = bodyText + " " + bodyHtml + " " + subj + " " + toAddr + " " + rawHeaders;

          if (!allText.includes(correoBuscar)) continue;

          emails.push({
            from:    String(p.from?.text || ""),
            subject: String(p.subject   || ""),
            text:    String(p.text      || ""),
            html:    String(p.html      || ""),
            // Para ordenar y mostrar usamos la llegada real al hosting. La
            // cabecera Date puede repetirse, venir retrasada o faltar.
            date:    ts > 0 ? new Date(ts) : (p.date || new Date(0)),
            ts:      ts || 0,
            uid:     uid || 0,
            seq:     seq || 0,
            mailbox: String(cuenta.name || cuenta.label || cuenta.user || "hosting"),
          });
        } catch(_) {}
      }
    } finally { lock.release(); }
  } catch(err) {
    console.error("[IMAP buscarEmails] Error:", err?.message || err);
    throw err;
  } finally {
    try { await client.logout(); } catch(_) {}
  }

  // Más reciente primero
  // Ordenar por timestamp del servidor (más preciso que p.date)
  return emails.sort((a, b) => (b.ts || 0) - (a.ts || 0) || (b.uid || 0) - (a.uid || 0) || (b.seq || 0) - (a.seq || 0));
}

async function buscarEmails(correo, limite=15) {
  const cuentas = cuentasImapCodigos();
  if (!cuentas.length) {
    const estado = estadoImapSeguro();
    console.error("[IMAP /code] Sin cuenta válida. Estado seguro:", {
      cuentasValidas: estado.cuentasValidas,
      host: estado.host,
      user: estado.user,
      password: estado.password,
      port: estado.port,
      tls: estado.tls,
      selectedKeys: estado.selectedKeys,
      variables: estado.variables,
      jsonAccounts: Array.isArray(EMAIL_ACCOUNTS) ? EMAIL_ACCOUNTS.length : 0,
    });
    throw new Error("IMAP no recibió una credencial válida del entorno. Use /imapstatus para ver qué variables está leyendo el bot.");
  }
  const results = await Promise.allSettled(cuentas.map(cuenta => buscarEmailsCuenta(correo, limite, cuenta)));
  const emails = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  if (!emails.length && results.every(result => result.status === "rejected")) {
    throw results.find(result => result.status === "rejected")?.reason || new Error("No se pudo abrir el hosting de correo.");
  }
  return emails.sort((a,b)=>(b.ts||0)-(a.ts||0)||(b.uid||0)-(a.uid||0)||(b.seq||0)-(a.seq||0)).slice(0,Math.max(1,limite));
}

// ===============================
// COMANDOS
// ===============================

/** /code — Netflix, Disney+ (6), HBO Max, Prime Video, Vix, Universal+ (6), Spotify (6) */
async function cmdCode(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /code correo@dominio.com");
  try{
    let emails = await buscarEmails(correo);
    // El reenvío hacia el hosting suele tardar unos segundos. Si ya existe un
    // correo Disney, hacemos una segunda lectura para no contestar con el OTP
    // anterior justo cuando el nuevo todavía está entrando al buzón.
    if (emails.some(e => esDisney(e.from, e.subject))) {
      await esperar(4500);
      emails = await buscarEmails(correo);
    }
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      const fromL = e.from.toLowerCase();
      const subjL = e.subject.toLowerCase();

      // Restablecer contraseña siempre es un link, nunca un código numérico.
      if (esReset(e.subject, e.text)) {
        if (!emailCodigoVigente(e, 120)) continue;
        const linkReset = extraerLink(e.text, e.html);
        if (linkReset) {
          const plat = esNetflix(e.from,e.subject) ? "NETFLIX" : esDisney(e.from,e.subject) ? "DISNEY+" :
            esHBO(e.from,e.subject) ? "HBO MAX" : esPrime(e.from,e.subject) ? "PRIME VIDEO" :
            esParamount(e.from,e.subject) ? "PARAMOUNT+" : esUniversal(e.from,e.subject) ? "UNIVERSAL+" :
            esSpotify(e.from,e.subject) ? "SPOTIFY" : esVix(e.from,e.subject) ? "VIX" : "CUENTA";
          return bot.sendMessage(chatId,
            `🔗 *RESTABLECER CLAVE ${plat}*\n\n📧 *Correo:* ${escMD(correo)}\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\nToca el botón para abrir el enlace:`,
            {parse_mode:"Markdown",reply_markup:{inline_keyboard:[[{text:"🔗 Abrir enlace de restablecimiento",url:linkReset}]]}}
          );
        }
        continue;
      }

      // ── NETFLIX ──────────────────────────────────────
      if(fromL.includes("netflix") || esNetflix(e.from, e.subject)) {
        if(!emailCodigoVigente(e, 120)) continue;
        if(subjL.includes("restablecimiento")||subjL.includes("contrase")||subjL.includes("cambio")) continue;
        if(subjL.includes("acceso temporal")||subjL.includes("codigo de acceso")||subjL.includes("temporal")) {
          const linkWeb = extraerLinkObtenerCodigo(e.html);
          if(linkWeb) {
            const codigoWeb = await scrapearCodigoWeb(linkWeb);
            if(codigoWeb) return bot.sendMessage(chatId,`🎬 *CÓDIGO NETFLIX TEMPORAL*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigoWeb}\`\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
            return bot.sendMessage(chatId,`🎬 *CÓDIGO NETFLIX TEMPORAL*\n\n📧 *Correo:* ${escMD(correo)}\n⚠️ El código está dentro del enlace:`,{parse_mode:"Markdown",reply_markup:{inline_keyboard:[[{text:"🔑 Ver código temporal",url:linkWeb}]]}});
          }
          continue;
        }
        if(subjL.includes("hogar")||subjL.includes("household")||subjL.includes("extra member")) {
          return bot.sendMessage(chatId,`🏠 *NETFLIX HOGAR*\n\n📧 *Correo:* ${escMD(correo)}\n⚠️ Usa el comando /hogar para este correo.`,{parse_mode:"Markdown"});
        }
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "netflix");
        if(codigo) return bot.sendMessage(chatId,`🎬 *CÓDIGO NETFLIX*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }

      // ── DISNEY+ — 6 dígitos en todos los casos ───────
      if(esDisney(e.from, e.subject)) {
        // Disney indica que el OTP vence en 15 minutos. Damos 30 minutos de
        // margen por relojes del servidor, pero jamás devolvemos el de ayer.
        if(!emailCodigoVigente(e, 30)) continue;
        // Avisos de cuenta no traen OTP: saltarlos para no leer un número
        // cualquiera del cuerpo ni tapar el correo del código.
        if(esNotificacionCuenta(e.subject)) continue;
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "disney");
        if(codigo) {
          const correoKey = normalizarCorreo(correo);
          const previous = disneyUltimoEntregado.get(correoKey);
          const marker = `${Number(e.uid || 0)}:${codigo}`;
          if (previous === marker) {
            return bot.sendMessage(chatId,`⏳ *DISNEY+ TODAVÍA NO ENVÍA OTRO CÓDIGO*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 El hosting conserva como último el código \`${codigo}\`, que ya fue entregado.\n\nPulse *Reenviar* en Disney y vuelva a usar /code en unos segundos; no repetí el código anterior.`,{parse_mode:"Markdown"});
          }
          disneyUltimoEntregado.set(correoKey, marker);
          return bot.sendMessage(chatId,`🏰 *CÓDIGO DISNEY+*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        }
        // Si el email más nuevo sí anuncia un OTP pero cambió nuevamente su
        // plantilla, no retroceder a otro código anterior y posiblemente vencido.
        if(esDisneyCodigo(e.from, e.subject, e.text)) {
          return bot.sendMessage(chatId,
            `⚠️ Encontré el correo nuevo de Disney+, pero no pude leer sus 6 dígitos.\n\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\nUse /debug ${escMD(correo)} para revisarlo; no se entregó un código anterior.`,
            {parse_mode:"Markdown"}
          );
        }
        continue;
      }

      // ── HBO MAX — 4 dígitos ───────────────────────────
      if(esHBO(e.from, e.subject)) {
        if(!emailCodigoVigente(e, 120)) continue;
        if(subjL.includes("restablecimiento")||subjL.includes("reset")||subjL.includes("contrase")||subjL.includes("cambio de correo")) continue;
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "hbo");
        if(codigo) return bot.sendMessage(chatId,`🎞️ *CÓDIGO HBO MAX*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }

      // ── PRIME VIDEO — 6 dígitos ───────────────────────
      if(esPrime(e.from, e.subject)) {
        if(!emailCodigoVigente(e, 120)) continue;
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "prime");
        if(codigo) return bot.sendMessage(chatId,`🎥 *CÓDIGO PRIME VIDEO*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }

      // ── VIX — código o link ───────────────────────────
      if(esVix(e.from, e.subject)) {
        if(!emailCodigoVigente(e, 120)) continue;
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "vix");
        if(codigo) return bot.sendMessage(chatId,`📱 *CÓDIGO VIX*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        const link = extraerLink(e.text, e.html);
        if(link) return bot.sendMessage(chatId,`📱 *LINK VIX*\n\n📧 *Correo:* ${escMD(correo)}\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\nToca el botón:`,{parse_mode:"Markdown",reply_markup:{inline_keyboard:[[{text:"📱 Abrir link Vix",url:link}]]}});
        continue;
      }

      // ── UNIVERSAL+ — código numérico de 6 dígitos ────
      if(esUniversal(e.from, e.subject)) {
        if(!emailCodigoVigente(e, 120)) continue;
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "universal");
        if(codigo) return bot.sendMessage(chatId,`🌎 *CÓDIGO UNIVERSAL+*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }

      // ── SPOTIFY — inicio de sesión: 6 dígitos ───────
      if(esSpotify(e.from, e.subject)) {
        if(!emailCodigoVigente(e, 120)) continue;
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "spotify");
        if(codigo) return bot.sendMessage(chatId,`🎵 *CÓDIGO SPOTIFY*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }
    }
    return bot.sendMessage(chatId,`⚠️ Sin código reciente para *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){ logErr("cmdCode",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
}

/** /debug — temporal: ver texto crudo del email para diagnosticar extracción de código */
async function cmdDebug(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /debug correo@dominio.com");
  try{
    const emails = await buscarEmails(correo, 3);
    if(!emails.length) return bot.sendMessage(chatId,"📬 Sin emails.");

    for (let i = 0; i < emails.length; i++) {
      const e = emails[i];
      const text = String(e.text || "").replace(/\s+/g, " ").trim();
      const html = String(e.html || "").replace(/\s+/g, " ").trim();

      // Buscar todos los números de 6 y 4 dígitos en text y html
      const nums6text = (text.match(/(?<!\d)\d{6}(?!\d)/g) || []);
      const nums6html = (html.match(/(?<!\d)\d{6}(?!\d)/g) || []);
      const nums4text = (text.match(/(?<!\d)\d{4}(?!\d)/g) || []);

      let msg = `📧 *Email ${i+1}*\n`;
      msg += `Asunto: ${escMD(e.subject)}\n`;
      msg += `Fecha: ${escMD(formatearFecha(e.date))}\n\n`;
      msg += `*6 dígitos en TEXT:* ${nums6text.join(", ") || "ninguno"}\n`;
      msg += `*6 dígitos en HTML:* ${nums6html.slice(0,15).join(", ") || "ninguno"}\n`;
      msg += `*4 dígitos en TEXT:* ${nums4text.join(", ") || "ninguno"}\n\n`;
      msg += "*TEXT (primeros 600 char):*\n`" + escMD(text.slice(0,600)) + "`";

      await bot.sendMessage(chatId, msg, {parse_mode:"Markdown"});
    }
  }catch(e){ logErr("cmdDebug",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
}

/** /link — Reset de contraseña */
async function cmdLink(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /link correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      const isN  = esNetflixReset(e.from, e.subject);
      const isD  = esDisney(e.from, e.subject);
      const isH  = esHBO(e.from, e.subject);
      const isP  = esParamount(e.from, e.subject);
      const isU  = esUniversal(e.from, e.subject);
      const isV  = esVix(e.from, e.subject);
      const isS  = esSpotify(e.from, e.subject);
      if(!isN && !isD && !isH && !isP && !isU && !isV && !isS) continue;

      const link = extraerLink(e.text, e.html);
      if(!link) continue;

      const fromL = e.from.toLowerCase();
      const isReallyNetflix = isN || fromL.includes("netflix");
      const isReallyDisney  = !isReallyNetflix && (isD || fromL.includes("disney"));
      const isReallyPrime   = !isReallyNetflix && !isReallyDisney && (fromL.includes("amazon")||fromL.includes("prime"));
      const isReallyParamount = !isReallyNetflix && !isReallyDisney && !isReallyPrime && (isP || fromL.includes("paramount"));
      const isReallyUniversal = !isReallyNetflix && !isReallyDisney && !isReallyPrime && !isReallyParamount && (isU || fromL.includes("universal"));
      const isReallySpotify = !isReallyNetflix && !isReallyDisney && !isReallyPrime && !isReallyParamount && !isReallyUniversal && (isS || fromL.includes("spotify"));
      const isReallyVix = !isReallyNetflix && !isReallyDisney && !isReallyPrime && !isReallyParamount && !isReallyUniversal && !isReallySpotify && (isV || fromL.includes("vix"));
      const plat  = isReallyNetflix ? "NETFLIX" : isReallyDisney ? "DISNEY+" : isReallyPrime ? "PRIME VIDEO" : isReallyParamount ? "PARAMOUNT+" : isReallyUniversal ? "UNIVERSAL+" : isReallySpotify ? "SPOTIFY" : isReallyVix ? "VIX" : "HBO MAX";
      const emoji = isReallyNetflix ? "🎬" : isReallyDisney ? "🏰" : isReallyPrime ? "🎥" : isReallyParamount ? "💿" : isReallyUniversal ? "🌎" : isReallySpotify ? "🎵" : isReallyVix ? "📱" : "🎞️";

      return bot.sendMessage(chatId,
        `${emoji} *LINK RESET ${plat}*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\n` +
        `Toca el botón para abrir el link:`,
        {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:`${emoji} Abrir link ${plat}`, url:link}]]}}
      );
    }
    return bot.sendMessage(chatId,`⚠️ Sin link de reset para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdLink",e); return bot.sendMessage(chatId,"❌ Error."); }
}

/** /hogar — Código de Netflix hogar */
async function cmdHogar(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /hogar correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      if(!esNetflix(e.from,e.subject)) continue;
      if(!esHogar(e.subject,e.text)) continue;

      let codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "netflix");
      let linkWeb = extraerLinkObtenerCodigo(e.html);

      // Intentar sacar el código del link web si no vino en el texto
      if(!codigo && linkWeb) codigo = await scrapearCodigoWeb(linkWeb);

      if(codigo) return bot.sendMessage(chatId,
        `🏠 *CÓDIGO NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `🔑 *Código:* \`${codigo}\`\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,
        {parse_mode:"Markdown"}
      );

      // Si hay link de confirmación de hogar (Netflix a veces solo manda link)
      if(linkWeb) return bot.sendMessage(chatId,
        `🏠 *CONFIRMAR NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\nToca el botón para confirmar:`,
        {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"🏠 Confirmar Hogar Netflix", url:linkWeb}]]}}
      );

      // Link de reset de hogar como fallback
      const linkReset = extraerLink(e.text, e.html);
      if(linkReset) return bot.sendMessage(chatId,
        `🏠 *LINK NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `📨 *Asunto:* ${escMD(e.subject)}`,
        {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"🏠 Abrir Link Hogar", url:linkReset}]]}}
      );
    }
    return bot.sendMessage(chatId,`⚠️ Sin código de hogar para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdHogar",e); return bot.sendMessage(chatId,"❌ Error."); }
}

/** /prime — Código OTP de Prime Video (6 dígitos) */
async function cmdPrime(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /prime correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      if(!esPrime(e.from, e.subject)) continue;
      if(!emailCodigoVigente(e, 120)) continue;
      const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "prime");

      if(codigo) return bot.sendMessage(chatId,
        `🎥 *CÓDIGO PRIME VIDEO*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `🔑 *Código:* \`${codigo}\`\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,
        {parse_mode:"Markdown"}
      );
    }
    return bot.sendMessage(chatId,`⚠️ Sin código de Prime Video para *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){ logErr("cmdPrime",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
}

/** /inbox — Ver últimos emails del correo */
async function cmdInbox(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /inbox correo@dominio.com");
  try{
    const emails = await buscarEmails(correo,5);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    let txt=`📥 *ÚLTIMOS EMAILS*\n📧 ${escMD(correo)}\n\n`;
    emails.forEach((e,i)=>{ txt+=`*${i+1}.* ${escMD(e.subject||"(sin asunto)")}\n   📨 ${escMD(e.from)}\n   🕒 ${escMD(formatearFecha(e.date))}\n\n`; });
    return bot.sendMessage(chatId,txt,{parse_mode:"Markdown"});
  }catch(e){ logErr("cmdInbox",e); return bot.sendMessage(chatId,"❌ Error."); }
}

/** /imapstatus — diagnóstico seguro de configuración IMAP (sin secretos) */
async function cmdImapStatus(chatId){
  try {
    const estado = estadoImapSeguro();
    const sel = estado.selectedKeys || {};
    const variables = estado.variables.length ? estado.variables.join(", ") : "ninguna";
    const txt =
      `📡 *ESTADO IMAP*\n\n` +
      `✅ Cuentas válidas: *${estado.cuentasValidas}*\n` +
      `🌐 Host: ${estado.host ? "✅" : "❌"}  \`${escMD(sel.host || "-")}\`\n` +
      `👤 Usuario: ${estado.user ? "✅" : "❌"}  \`${escMD(sel.user || "-")}\`\n` +
      `🔐 Contraseña: ${estado.password ? "✅" : "❌"}  \`${escMD(sel.password || "-")}\`\n` +
      `🔢 Puerto: \`${estado.port}\`\n` +
      `🔒 TLS: \`${estado.tls ? "sí" : "no"}\`\n\n` +
      `*Variables IMAP visibles para este proceso:*\n${escMD(variables)}`;
    return bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
  } catch (e) {
    logErr("cmdImapStatus", e);
    return bot.sendMessage(chatId, "❌ No pude leer el estado IMAP.");
  }
}

// ===============================
// REGISTRO DE COMANDOS (1 sola vez)
// ===============================
// ✅ Limpiar _textRegexpCallbacks — array interno donde onText guarda los handlers
// bot.removeListener no funciona para onText, hay que limpiar el array directo
try {
  if (Array.isArray(bot._textRegexpCallbacks)) {
    bot._textRegexpCallbacks = bot._textRegexpCallbacks.filter(item => {
      const reg = item.regexp ? item.regexp.toString() : "";
      return !(
        reg.includes("\/code") || reg.includes("\/link") ||
        reg.includes("\/hogar") || reg.includes("\/prime") || reg.includes("\/inbox") || reg.includes("\/imapstatus")
      );
    });
    console.log("✅ IMAP: handlers viejos eliminados, registrando nuevos...");
  }
} catch(e) { console.error("IMAP cleanup error:", e?.message); }

// Handlers IMAP — comandos de extracción de códigos
const _imapCodeHandler  = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdCode(msg.chat.id,  normalizarCorreo(m[1])); };
const _imapLinkHandler  = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdLink(msg.chat.id,  normalizarCorreo(m[1])); };
const _imapHogarHandler = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdHogar(msg.chat.id, normalizarCorreo(m[1])); };
const _imapPrimeHandler = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdPrime(msg.chat.id, normalizarCorreo(m[1])); };
const _imapInboxHandler = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdInbox(msg.chat.id, normalizarCorreo(m[1])); };
const _imapDebugHandler = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdDebug(msg.chat.id, normalizarCorreo(m[1])); };
const _imapStatusHandler = async(msg)=>{ if(await isAdmin(msg.from.id)) return cmdImapStatus(msg.chat.id); };

bot.onText(/^\/code\s+(\S+)/i,  _imapCodeHandler);
bot.onText(/^\/link\s+(\S+)/i,  _imapLinkHandler);
bot.onText(/^\/hogar\s+(\S+)/i, _imapHogarHandler);
bot.onText(/^\/prime\s+(\S+)/i, _imapPrimeHandler);
bot.onText(/^\/inbox\s+(\S+)/i, _imapInboxHandler);
bot.onText(/^\/debug\s+(\S+)/i, _imapDebugHandler);
bot.onText(/^\/imapstatus(?:\s|$)/i, _imapStatusHandler);

console.log("✅ Módulo IMAP v20 cargado — /code /link /hogar /prime /inbox /imapstatus");

module.exports = { cmdCode, cmdLink, cmdHogar, cmdPrime, cmdInbox, cmdImapStatus, buscarEmails, estadoImapSeguro, extraerCodigoInteligente, htmlATextoVisible };
