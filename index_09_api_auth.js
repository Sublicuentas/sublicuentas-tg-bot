/* ✅ SUBLICUENTAS — PARTE 9/9 — AUTH COMPARTIDA
   -----------------------------------------------
   Módulo único de funciones de autenticación para:
   - index_08_api.js (API Android)
   - server_api.js (Panel Revendedores)
   
   Elimina duplicación de código y mantiene consistencia
*/

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

/**
 * Middleware: Valida JWT token para revendedor/admin
 */
function revAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sin_token" });
  try {
    req.rev = jwt.verify(token, process.env.JWT_SECRET || "CAMBIAME_EN_RENDER");
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
    const p = jwt.verify(token, process.env.JWT_SECRET || "CAMBIAME_EN_RENDER");
    if (!p.admin) return res.status(403).json({ error: "no_admin" });
    req.admin = p;
    next();
  } catch (e) {
    return res.status(401).json({ error: "token_invalido" });
  }
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

module.exports = {
  revAuth,
  revAdminAuth,
  revParseFecha,
  revDiasRest,
  revFechaISO,
  revParseFechaInput,
  revAddMonths,
};
