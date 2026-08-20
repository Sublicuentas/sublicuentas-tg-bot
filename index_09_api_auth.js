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
 * Middleware: Valida JWT token para revendedor/admin
 */
function revAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sin_token" });
  try {
    req.rev = jwt.verify(token, getJwtSecret());
    next();
  } catch (e) {
    return res.status(401).json({ error: "token_invalido" });
  }
}

/**
 * Middleware: Valida JWT token SOLO para admin
 */
function revAdminAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sin_token" });
  try {
    const p = jwt.verify(token, getJwtSecret());
    if (!p.admin) return res.status(403).json({ error: "no_admin" });
    req.admin = p;
    next();
  } catch (e) {
    return res.status(401).json({ error: "token_invalido" });
  }
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
const LOGIN_MAX_FALLOS = 8;
const LOGIN_VENTANA_MS = 15 * 60 * 1000;
const LOGIN_BLOQUEO_MS = 15 * 60 * 1000;

function _loginAttemptKey(usuarioNorm) {
  const k = String(usuarioNorm || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 120);
  return "rev_" + (k || "desconocido");
}

async function checkLoginThrottle(db, usuarioNorm) {
  const ref = db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(_loginAttemptKey(usuarioNorm));
  const snap = await ref.get();
  if (!snap.exists) return { blocked: false };
  const d = snap.data() || {};
  const now = Date.now();
  if ((d.bloqueadoHasta || 0) > now) {
    return { blocked: true, retryAfterSeconds: Math.ceil((d.bloqueadoHasta - now) / 1000) };
  }
  return { blocked: false };
}

async function registerLoginFailure(db, usuarioNorm) {
  const ref = db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(_loginAttemptKey(usuarioNorm));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const d = snap.exists ? snap.data() || {} : {};
    const ventanaVencida = !d.primerFalloEn || (now - d.primerFalloEn) > LOGIN_VENTANA_MS;
    const fallos = ventanaVencida ? 1 : Number(d.fallos || 0) + 1;
    const primerFalloEn = ventanaVencida ? now : d.primerFalloEn;
    const patch = { fallos, primerFalloEn, updatedAt: now };
    if (fallos >= LOGIN_MAX_FALLOS) patch.bloqueadoHasta = now + LOGIN_BLOQUEO_MS;
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
      const ADMIN_USER = (process.env.ADMIN_USER || "").trim().toLowerCase();
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

      const usuario = (req.body?.usuario || "").trim().toLowerCase();
      const password = (req.body?.password || "").trim();
      const pin = (req.body?.pin || "").trim();
      if (!usuario || !password) return res.status(400).json({ error: "faltan_datos" });

      const throttle = await checkLoginThrottle(db, usuario);
      if (throttle.blocked) {
        return res.status(429).json({ error: "demasiados_intentos", retryAfterSeconds: throttle.retryAfterSeconds });
      }

      // ── Admin ──
      if (ADMIN_USER && ADMIN_PASSWORD && usuario === ADMIN_USER && safeEqualStr(password, ADMIN_PASSWORD)) {
        await clearLoginThrottle(db, usuario);
        const token = jwt.sign({ admin: true, nombre: "Admin" }, JWT_SECRET, { expiresIn: "30d" });
        return res.json({ token, admin: true, nombre: "Admin" });
      }

      // ── Revendedor ──
      const snap = await db.collection("revendedores").where("nombre_norm", "==", usuario).limit(1).get();
      if (snap.empty) {
        await registerLoginFailure(db, usuario);
        return res.status(400).json({ error: "credenciales" });
      }
      const doc = snap.docs[0], d = doc.data();
      if (d.activo === false) return res.status(403).json({ error: "inactivo" });

      if (d.passwordHash) {
        // Flujo normal: ya tiene contraseña configurada.
        const okp = await bcrypt.compare(password, d.passwordHash);
        if (!okp) {
          await registerLoginFailure(db, usuario);
          return res.status(400).json({ error: "credenciales" });
        }
      } else {
        // Primera vez: exige el PIN de un solo uso (ya no se auto-reclama con solo la contraseña).
        if (!d.pinSetupHash) {
          return res.status(403).json({ error: "cuenta_no_configurada" });
        }
        if (!pin) {
          return res.status(400).json({ error: "pin_requerido" });
        }
        const pinOk = await bcrypt.compare(pin, d.pinSetupHash);
        if (!pinOk) {
          await registerLoginFailure(db, usuario);
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

      await clearLoginThrottle(db, usuario);
      const token = jwt.sign({ id: doc.id, nombre: d.nombre, nombre_norm: d.nombre_norm }, JWT_SECRET, { expiresIn: "30d" });
      res.json({ token, nombre: d.nombre, nombre_norm: d.nombre_norm });
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
  revAuth,
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
