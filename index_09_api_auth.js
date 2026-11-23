/* ✅ SUBLICUENTAS — PARTE 9/9 — AUTH COMPARTIDA
   -----------------------------------------------
   Módulo único de funciones de autenticación para:
   - index_08_api.js (API Android)
   - server_api.js (Panel Revendedores)
   
   Elimina duplicación de código y mantiene consistencia
*/

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const admin = require("firebase-admin");
const {
  findAdminAccount, verifyAdminPassword, createAdminSession, createAdminSessionAuth,
} = require("./index_25_api_security");
const { verificarTurnstile, ipCliente } = require("./lib_turnstile"); // R201

/**
 * ✅ SEGURIDAD — Ya NO hay fallback público ("CAMBIAME_EN_RENDER").
 * Si JWT_SECRET no está configurado (o quedó con el valor de ejemplo del
 * repo), el proceso se niega a arrancar en vez de firmar tokens con un
 * secreto que cualquiera puede leer en GitHub.
 */
function getJwtSecret() {
  const s = String(process.env.JWT_SECRET || "").trim();
  if (!s || s === "CAMBIAME_EN_RENDER") {
    throw new Error(
      "[FATAL] JWT_SECRET no está configurado (o quedó con el valor de ejemplo 'CAMBIAME_EN_RENDER'). " +
      "Configurá una frase larga y aleatoria en las variables de entorno (Render) antes de desplegar. " +
      "Sin esto, cualquiera podría firmar tokens de admin válidos."
    );
  }
  return s;
}

/**
 * Comparación de strings en tiempo constante (evita timing attacks).
 * No filtra la longitud real: siempre compara buffers del mismo tamaño.
 */
function safeEqualStr(a, b) {
  const ab = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  const len = Math.max(ab.length, bb.length, 1);
  const abPad = Buffer.concat([ab], len);
  const bbPad = Buffer.concat([bb], len);
  return crypto.timingSafeEqual(abPad, bbPad) && ab.length === bb.length;
}

/**
 * Permiso sin compras: Geisell puede consultar clientes, catálogo,
 * renovaciones y mensajes de renovación, pero no registrar compras. Se
 * conserva el nombre `soloCatalogo` para aceptar tokens y datos anteriores.
 */
function esRevSoloCatalogo(rev = {}) {
  const caps = (rev && typeof rev.capabilities === "object" && rev.capabilities) ||
    (rev && typeof rev.permisos === "object" && rev.permisos) || null;
  // Si ya existe configuración explícita de permisos, ella manda. El fallback
  // por nombre solo conserva compatibilidad con cuentas antiguas.
  if (caps && typeof caps.canBuy === "boolean") return !caps.canBuy;
  if (caps && typeof caps.comprar === "boolean") return !caps.comprar;
  const nombre = String(rev.nombre_norm || rev.nombre || rev.usuario || rev.id || "")
    .trim().toLowerCase();
  return rev.soloCatalogo === true || rev.sinCompras === true || nombre === "geisell" || nombre === "geissel";
}

function capacidadesRevendedor(rev = {}) {
  const soloCatalogo = esRevSoloCatalogo(rev);
  const src = (rev && typeof rev.capabilities === "object" && rev.capabilities) ||
    (rev && typeof rev.permisos === "object" && rev.permisos) || {};
  const defaults = {
    inicio: true,
    clientes: true,
    catalogo: true,
    renovar: true,
    comprar: !soloCatalogo,
    aula: !soloCatalogo,
    perfil: true,
    recompensas: !soloCatalogo,
    buzon: !soloCatalogo,
    canViewClients: true,
    canRenew: true,
    canBuy: !soloCatalogo,
    canUseAI: !soloCatalogo,
  };
  const out = { ...defaults };
  Object.keys(defaults).forEach((k) => { if (typeof src[k] === "boolean") out[k] = src[k]; });
  // Alias UI/API siempre coherentes.
  if (typeof src.canBuy === "boolean" && typeof src.comprar !== "boolean") out.comprar = src.canBuy;
  if (typeof src.comprar === "boolean" && typeof src.canBuy !== "boolean") out.canBuy = src.comprar;
  if (typeof src.canRenew === "boolean" && typeof src.renovar !== "boolean") out.renovar = src.canRenew;
  if (typeof src.renovar === "boolean" && typeof src.canRenew !== "boolean") out.canRenew = src.renovar;
  if (typeof src.canViewClients === "boolean" && typeof src.clientes !== "boolean") out.clientes = src.canViewClients;
  if (typeof src.clientes === "boolean" && typeof src.canViewClients !== "boolean") out.canViewClients = src.clientes;
  if (typeof src.canUseAI === "boolean" && typeof src.aula !== "boolean") out.aula = src.canUseAI;
  return out;
}

/**
 * R201 · Sesión del socio: vence a las 12 h SIN uso. Cada petición válida con más de 10 min de emitido
 * devuelve un token nuevo de 12 h en la cabecera X-Rev-Token (el panel lo guarda solo). Sin actividad, vence.
 * Tokens viejos de 14 días: se aceptan solo si fueron usados en las últimas 12 h desde su emisión; si no, 401.
 */
const REV_SESION_INACTIVIDAD = "12h";
const REV_SESION_MS = 12 * 60 * 60 * 1000;
function renovarSesionRev(req, res) {
  try {
    const p = req.rev || {};
    if (!p.iat || p.admin || p.sid || p.jti) return; // las sesiones de admin tienen su propio control
    if (Date.now() - p.iat * 1000 < 10 * 60 * 1000) return;
    const { iat, exp, nbf, ...resto } = p;
    const nuevo = jwt.sign(resto, getJwtSecret(), { expiresIn: REV_SESION_INACTIVIDAD });
    res.set("X-Rev-Token", nuevo);
  } catch (_) { /* nunca tumba la petición */ }
}

/**
 * Middleware: Valida JWT token para revendedor/admin
 */
function revAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sin_token" });
  try {
    req.rev = jwt.verify(token, getJwtSecret());
    // R201 · token de 14 días emitido antes del cambio: si pasó más de 12 h desde que se emitió, se pide entrar de nuevo.
    if (req.rev && req.rev.iat && !req.rev.admin && !req.rev.sid && !req.rev.jti && Date.now() - req.rev.iat * 1000 > REV_SESION_MS) return res.status(401).json({ error: "sesion_vencida" });
    // Los JWT emitidos antes de la corrección Geissel → Geisell conservan
    // el nombre anterior hasta 30 días. Se canonizan en memoria para que la
    // sesión siga viendo sus clientes durante la transición.
    if (String(req.rev?.nombre_norm || "").trim().toLowerCase() === "geissel") {
      req.rev = { ...req.rev, id: "geisell", nombre: "Geisell", nombre_norm: "geisell" };
    }
    if (esRevSoloCatalogo(req.rev)) req.rev = { ...req.rev, soloCatalogo: true, sinCompras: true };
    renovarSesionRev(req, res);
    next();
  } catch (e) {
    return res.status(401).json({ error: "token_invalido" });
  }
}

/**
 * Middleware: Valida JWT token SOLO para admin
 */
let _revAdminSessionAuth = null;
function revAdminAuth(req, res, next) {
  // FASE 3: los JWT admin anteriores (admin:true sin sesión individual) ya
  // no son suficientes. Cada administrador debe volver a iniciar sesión y
  // recibe una sesión revocable con perfil + permisos.
  if (!_revAdminSessionAuth) {
    const { db } = require("./index_01_core");
    _revAdminSessionAuth = createAdminSessionAuth({ db });
  }
  return _revAdminSessionAuth(req, res, next);
}

/**
 * ✅ RATE LIMITING — capa 1 (en memoria, por IP, defensa rápida).
 * Frena floods básicos antes de gastar una lectura de Firestore.
 * No es la defensa autoritativa (ver checkLoginThrottle, que sí
 * sobrevive reinicios y es por usuario) — es solo la primera barrera.
 */
const _revLoginIpHits = new Map();
function revLoginIpLimiter(req, res, next) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0].trim().slice(0, 120);
  const now = Date.now();
  const prev = _revLoginIpHits.get(ip);
  const state = (!prev || now - prev.startedAt >= 60_000) ? { startedAt: now, count: 0 } : prev;
  state.count += 1;
  _revLoginIpHits.set(ip, state);
  if (_revLoginIpHits.size > 2000) {
    for (const [k, v] of _revLoginIpHits) if (now - v.startedAt > 120_000) _revLoginIpHits.delete(k);
  }
  if (state.count > 20) return res.status(429).json({ error: "demasiados_intentos" });
  next();
}

/**
 * ✅ RATE LIMITING — capa 2 (Firestore, por usuario, autoritativa).
 * Sobrevive reinicios/despliegues y funciona igual sin importar cuántas
 * instancias corran. Bloquea el USUARIO (no la IP) tras varios fallos
 * seguidos — así un atacante que rota de IP no gana nada.
 */
const LOGIN_ATTEMPTS_COLLECTION = "login_attempts";
// R201 · Protocolo de seguridad: 3 fallos en 15 min → bloqueo de 30 min (429).
// Por USUARIO: 3. Por IP: LOGIN_MAX_FALLOS_IP (10 por defecto): en Honduras muchas personas salen
// a internet con la misma IP de Tigo/Claro y 3 errores de otros no deben bloquear a todos.
const LOGIN_MAX_FALLOS = 3;
const LOGIN_MAX_FALLOS_IP = Math.max(3, Math.min(Number(process.env.LOGIN_MAX_FALLOS_IP) || 10, 50));
const LOGIN_VENTANA_MS = 15 * 60 * 1000;
const LOGIN_BLOQUEO_MS = 30 * 60 * 1000;

function _loginAttemptKey(usuarioNorm) {
  const k = String(usuarioNorm || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 120);
  return "rev_" + (k || "desconocido");
}
function _loginIpKey(ip) {
  // La IP no se guarda en claro: solo su huella (no es un dato que haga falta conservar).
  return "rev_ip_" + crypto.createHash("sha256").update(String(ip || "sin_ip")).digest("hex").slice(0, 32);
}

async function checkLoginThrottle(db, usuarioNorm, ip = "") {
  const refs = [db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(_loginAttemptKey(usuarioNorm))];
  if (ip) refs.push(db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(_loginIpKey(ip)));
  const snaps = await Promise.all(refs.map((r) => r.get()));
  const now = Date.now();
  let hasta = 0;
  for (const snap of snaps) { if (snap.exists) hasta = Math.max(hasta, Number((snap.data() || {}).bloqueadoHasta) || 0); }
  if (hasta > now) return { blocked: true, retryAfterSeconds: Math.ceil((hasta - now) / 1000) };
  return { blocked: false };
}

async function registerLoginFailure(db, usuarioNorm, ip = "") {
  await _registrarFallo(db, db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(_loginAttemptKey(usuarioNorm)), LOGIN_MAX_FALLOS);
  if (ip) await _registrarFallo(db, db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(_loginIpKey(ip)), LOGIN_MAX_FALLOS_IP);
}
async function _registrarFallo(db, ref, maximo) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const d = snap.exists ? snap.data() || {} : {};
    const ventanaVencida = !d.primerFalloEn || (now - d.primerFalloEn) > LOGIN_VENTANA_MS;
    const fallos = ventanaVencida ? 1 : Number(d.fallos || 0) + 1;
    const primerFalloEn = ventanaVencida ? now : d.primerFalloEn;
    const patch = { fallos, primerFalloEn, updatedAt: now };
    if (fallos >= maximo) patch.bloqueadoHasta = now + LOGIN_BLOQUEO_MS;
    tx.set(ref, patch, { merge: true });
  }).catch(() => {}); // el throttle nunca debe tumbar el login por un error transitorio
}

async function clearLoginThrottle(db, usuarioNorm) {
  await db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(_loginAttemptKey(usuarioNorm)).delete().catch(() => {});
}

/**
 * ✅ Login compartido de revendedor/admin (antes duplicado línea por línea
 * en server_api.js e index_08_api.js). Incluye el flujo de PIN de
 * configuración inicial: una cuenta nueva (creada por /addvendedor, sin
 * passwordHash) YA NO puede ser "reclamada" por cualquiera que adivine el
 * usuario — necesita el PIN de un solo uso que el admin generó y compartió
 * por su canal de confianza (ver /addvendedor y /resetpin en el bot).
 */
function createRevLoginHandler({ db, bot, SUPER_ADMIN }) {
  return async function revLoginHandler(req, res) {
    try {
      const JWT_SECRET = getJwtSecret();
      const usuarioIngresado = (req.body?.usuario || "").trim().toLowerCase();
      // El nombre correcto es Geisell. El alias mal escrito sigue entrando
      // para no dejar fuera una cuenta o sesión creada anteriormente.
      const usuario = usuarioIngresado === "geissel" ? "geisell" : usuarioIngresado;
      const password = (req.body?.password || "").trim();
      const pin = (req.body?.pin || "").trim();
      if (!usuario || !password) return res.status(400).json({ error: "faltan_datos" });
      if (usuario.length > 80 || password.length > 200 || pin.length > 20) return res.status(400).json({ error: "credenciales" }); // R201 · entradas acotadas

      // R201 · Turnstile se valida ANTES de tocar la base de datos.
      const ts = await verificarTurnstile(req, { token: req.body?.turnstileToken, accion: "login" });
      if (!ts.ok) return res.status(ts.status).json({ error: ts.error });
      const ip = ipCliente(req);
      const bloqueo429 = (t) => { res.set("Retry-After", String(t.retryAfterSeconds || 1800)); return res.status(429).json({ error: "demasiados_intentos", retryAfterSeconds: t.retryAfterSeconds }); };

      // Esta lectura se inicia ya y, para revendedores, viaja en paralelo con
      // la búsqueda de la cuenta. Antes eran dos esperas de Firestore seguidas.
      const throttlePromise = checkLoginThrottle(db, usuario, ip);

      // ── Admin FASE 3: credenciales individuales + sesión revocable ──
      const adminAccount = findAdminAccount(usuarioIngresado);
      if (adminAccount) {
        const throttle = await throttlePromise;
        if (throttle.blocked) return bloqueo429(throttle);
        if (!(await verifyAdminPassword(adminAccount, password))) {
          await registerLoginFailure(db, usuario, ip);
          return res.status(400).json({ error: "credenciales" });
        }
        clearLoginThrottle(db, usuario).catch(() => {});
        const session = await createAdminSession({ db, account: adminAccount, req });
        return res.json(session);
      }

      // ── Revendedor ──
      const aliases = usuario === "geisell" ? ["geisell", "geissel"] : [usuario];
      const [throttle, snaps] = await Promise.all([
        throttlePromise,
        Promise.all(aliases.map(alias =>
          db.collection("revendedores").where("nombre_norm", "==", alias).limit(1).get()
        )),
      ]);
      if (throttle.blocked) return bloqueo429(throttle);
      const encontrados = [];
      snaps.forEach(snap => snap.docs.forEach(doc => encontrados.push(doc)));
      if (!encontrados.length) {
        await registerLoginFailure(db, usuario, ip);
        return res.status(400).json({ error: "credenciales" });
      }
      // Si coexistieran las dos grafías, se usa primero la cuenta activa y
      // correctamente nombrada.
      encontrados.sort((a, b) => {
        const ad = a.data() || {}, bd = b.data() || {};
        const activoA = ad.activo !== false ? 1 : 0;
        const activoB = bd.activo !== false ? 1 : 0;
        const canonA = String(ad.nombre_norm || "").toLowerCase() === "geisell" ? 1 : 0;
        const canonB = String(bd.nombre_norm || "").toLowerCase() === "geisell" ? 1 : 0;
        return (activoB - activoA) || (canonB - canonA);
      });
      const activos = encontrados.filter(candidato => (candidato.data() || {}).activo !== false);
      if (!activos.length) return res.status(403).json({ error: "inactivo" });

      // Si existen dos documentos históricos, aceptar la contraseña del que
      // realmente la conserva. Así la consolidación del nombre no rompe el
      // acceso mientras se despliega la migración de datos.
      let doc = null, d = null;
      for (const candidato of activos) {
        const datos = candidato.data() || {};
        if (!datos.passwordHash) continue;
        if (await bcrypt.compare(password, datos.passwordHash)) {
          doc = candidato;
          d = datos;
          break;
        }
      }

      if (!doc) {
        const candidatoSetup = activos.find(candidato => !(candidato.data() || {}).passwordHash);
        if (!candidatoSetup) {
          await registerLoginFailure(db, usuario, ip);
          return res.status(400).json({ error: "credenciales" });
        }
        doc = candidatoSetup;
        d = doc.data() || {};
        // Primera vez: exige el PIN de un solo uso (ya no se auto-reclama con solo la contraseña).
        if (!d.pinSetupHash) {
          return res.status(403).json({ error: "cuenta_no_configurada" });
        }
        if (!pin) {
          return res.status(400).json({ error: "pin_requerido" });
        }
        const pinOk = await bcrypt.compare(pin, d.pinSetupHash);
        if (!pinOk) {
          await registerLoginFailure(db, usuario, ip);
          return res.status(400).json({ error: "pin_invalido" });
        }
        const hash = await bcrypt.hash(password, 10);
        await doc.ref.update({
          passwordHash: hash,
          pinSetupHash: admin.firestore.FieldValue.delete(),
          pinSetupCreatedAt: admin.firestore.FieldValue.delete(),
          pinSetupUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (bot && SUPER_ADMIN) {
          bot.sendMessage(
            SUPER_ADMIN,
            `🔐 El revendedor "${d.nombre || usuario}" (usuario: ${usuario}) acaba de configurar su contraseña por primera vez.\nSi no fue él/ella, avisale ya y pedile que corra /resetpin ${d.nombre || usuario}.`
          ).catch(() => {});
        }
      }

      clearLoginThrottle(db, usuario).catch(() => {});
      const nombreNorm = usuario === "geisell" ? "geisell" : (d.nombre_norm || usuario);
      const nombre = nombreNorm === "geisell" ? "Geisell" : (d.nombre || usuario);
      const capabilities = capacidadesRevendedor({ id: doc.id, ...d, nombre, nombre_norm: nombreNorm });
      const soloCatalogo = !capabilities.canBuy;
      const sinCompras = !capabilities.canBuy;
      const tarifaId = String(d.tarifaId || d.tarifa_id || "general");
      const nombreMostrar = String(d.nombreMostrar || "").trim().slice(0, 60);
      const etiquetaRenovacion = String(d.etiquetaRenovacion || "").trim().slice(0, 60);
      const tokenPayload = { id: doc.id, nombre, nombre_norm: nombreNorm, soloCatalogo, sinCompras, capabilities, tarifaId, nombreMostrar, etiquetaRenovacion };
      const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: REV_SESION_INACTIVIDAD }); // R201 · 12 h de inactividad (se renueva con cada uso)
      res.json({ token, nombre, nombre_norm: nombreNorm, soloCatalogo, sinCompras, capabilities, tarifaId, priceTier: tarifaId, nombreMostrar, etiquetaRenovacion });
    } catch (e) {
      console.error("rev/login", e);
      res.status(500).json({ error: "server" });
    }
  };
}

/**
 * Parsea fecha en múltiples formatos a Date
 */
function revParseFecha(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v._seconds) return new Date(v._seconds * 1000);
    if (v.seconds) return new Date(v.seconds * 1000);
  }
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    y = y.length === 2 ? "20" + y : y;
    return new Date(+y, +mo - 1, +d);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/**
 * Calcula días restantes desde hoy
 */
function revDiasRest(d) {
  if (!d) return null;
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  return Math.round((d - h) / 86400000);
}

/**
 * Formatea Date a ISO (yyyy-mm-dd)
 */
function revFechaISO(d) {
  if (!d) return "";
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parsea input de fecha flexible a Date
 */
function revParseFechaInput(v) {
  const s = (v || "").toString().trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  return revParseFecha(s);
}

/**
 * Suma meses a una fecha
 */
function revAddMonths(base, months) {
  const d = new Date(base || Date.now());
  d.setHours(12, 0, 0, 0);
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months || 1));
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

/**
 * Genera un PIN numérico de 6 dígitos (para /addvendedor y /resetpin) y su
 * hash bcrypt listo para guardar en Firestore como `pinSetupHash`.
 */
async function generarPinSetup() {
  const pin = String(crypto.randomInt(100000, 1000000));
  const pinSetupHash = await bcrypt.hash(pin, 10);
  return { pin, pinSetupHash };
}

module.exports = {
  getJwtSecret,
  safeEqualStr,
  esRevSoloCatalogo,
  capacidadesRevendedor,
  revAuth,
  renovarSesionRev,
  revAdminAuth,
  revLoginIpLimiter,
  checkLoginThrottle,
  registerLoginFailure,
  clearLoginThrottle,
  createRevLoginHandler,
  generarPinSetup,
  revParseFecha,
  revDiasRest,
  revFechaISO,
  revParseFechaInput,
  revAddMonths,
};
