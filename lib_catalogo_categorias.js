// lib_catalogo_categorias.js · COPIA de Sublichat HQ api/_catalogo-categorias.js en CommonJS (contrato único R112).
// Copias exactas: APK src/app/catalogo-categorias.js y bot lib_catalogo_categorias.js (formato CommonJS).
// Regla: la categoría y el tipo de venta se GUARDAN en la compra y en Finanzas; esta tabla solo da el valor
// por defecto para servicios viejos que todavía no lo tienen guardado.
const CATEGORIAS = Object.freeze({
  perfiles: { label: "Perfiles", finanzas: "Venta de perfil de streaming", emoji: "👤" },
  tv_digital: { label: "TV Digital", finanzas: "Venta TV Digital", emoji: "📺" },
  musica: { label: "Música", finanzas: "Venta de música", emoji: "🎵" },
  software: { label: "Software", finanzas: "Venta de software/licencia", emoji: "💻" },
  cuentas_completas: { label: "Cuentas completas", finanzas: "Venta de cuenta completa", emoji: "🔐" },
});
const ORDEN_CATEGORIAS = Object.freeze(["perfiles", "tv_digital", "musica", "software", "cuentas_completas"]);
const TIPOS_VENTA = Object.freeze({ perfil: "perfil", cuenta_completa: "cuenta_completa", servicio: "servicio" });

// Plataforma → categoría por defecto. Viki Rakuten YA NO es perfil: solo se vende como cuenta completa.
const PLATAFORMA_CATEGORIA = Object.freeze({
  netflix: "perfiles", vipnetflix: "perfiles", disneyp: "perfiles", disneys: "perfiles", hbomax: "perfiles", primevideo: "perfiles",
  crunchyroll: "perfiles", paramount: "perfiles", vix: "perfiles", appletv: "perfiles", universal: "perfiles",
  stellatv: "tv_digital", oleada: "tv_digital", latintv: "tv_digital", liontv: "tv_digital", evoutouch: "tv_digital", iptv: "tv_digital", tvdigital: "tv_digital",
  spotify: "musica", youtube: "musica", deezer: "musica",
  canva: "software", gemini: "software", chatgpt: "software", duolingo: "software", office: "software", office2021: "software", m365: "software",
  adobeexpress: "software", windows10: "software", windows11: "software", eset: "software",
  viki: "cuentas_completas",
});
// Plataformas que se pueden vender como CUENTA COMPLETA (correo + clave + precio; sin PIN ni perfil).
const CUENTA_COMPLETA_PLATAFORMAS = Object.freeze(["viki", "disneys", "hbomax", "netflix", "crunchyroll"]);
// Las que SOLO existen como cuenta completa.
const SOLO_CUENTA_COMPLETA = Object.freeze(["viki"]);

function normPlataformaKey(v = "") {
  const t = String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  if (!t) return "";
  if (PLATAFORMA_CATEGORIA[t]) return t;
  if (/^viki/.test(t)) return "viki";
  if (/sinespn|disneys$/.test(t)) return "disneys";
  if (/vipnetflix|netflixvip|netflixpremiumvip/.test(t)) return "vipnetflix";
  if (/^netflix/.test(t)) return "netflix";
  if (/^disney/.test(t)) return "disneyp";
  if (/^hbo|^max$/.test(t)) return "hbomax";
  if (/^prime|amazon/.test(t)) return "primevideo";
  if (/^crunchy/.test(t)) return "crunchyroll";
  if (/^paramount/.test(t)) return "paramount";
  if (/^vix/.test(t)) return "vix";
  if (/^apple/.test(t)) return "appletv";
  if (/^universal/.test(t)) return "universal";
  if (/^spotify/.test(t)) return "spotify";
  if (/^youtube/.test(t)) return "youtube";
  if (/^deezer/.test(t)) return "deezer";
  if (/^canva/.test(t)) return "canva";
  if (/^gemini/.test(t)) return "gemini";
  if (/^chatgpt|^openai/.test(t)) return "chatgpt";
  if (/^duolingo/.test(t)) return "duolingo";
  if (/office2021/.test(t)) return "office2021";
  if (/^office|^microsoft365|^m365/.test(t)) return "office";
  if (/stella/.test(t)) return "stellatv";
  if (/oleada/.test(t)) return "oleada";
  if (/latintv/.test(t)) return "latintv";
  if (/liontv/.test(t)) return "liontv";
  if (/nanotech|evoutouch/.test(t)) return "evoutouch";
  if (/iptv|tvdigital/.test(t)) return "iptv";
  return t;
}
function puedeSerCuentaCompleta(plataforma) { return CUENTA_COMPLETA_PLATAFORMAS.includes(normPlataformaKey(plataforma)); }

// Clasificación de un servicio/venta: usa lo GUARDADO; si es un servicio viejo sin dato, toma el valor por defecto.
function clasificarServicio(s = {}) {
  const plat = normPlataformaKey(s.plataforma || s.servicio || "");
  const tipoGuardado = String(s.tipoVenta || s.entregaTipo || "").toLowerCase();
  const tipoVenta = tipoGuardado === "cuenta_completa" || SOLO_CUENTA_COMPLETA.includes(plat) ? "cuenta_completa" : (PLATAFORMA_CATEGORIA[plat] === "perfiles" ? "perfil" : "servicio");
  const catGuardada = String(s.categoria || "").toLowerCase();
  const categoria = tipoVenta === "cuenta_completa" ? "cuentas_completas" : (CATEGORIAS[catGuardada] && catGuardada !== "cuentas_completas" ? catGuardada : (PLATAFORMA_CATEGORIA[plat] || "perfiles"));
  return { categoria, tipoVenta, plataformaKey: plat };
}

// Normaliza un servicio antes de guardarlo. Cuenta completa: exige correo + clave; quita PIN/perfil heredados.
// Devuelve { servicio, error }. No escribe la clave en ningún log.
function normalizarServicioVenta(servicio = {}) {
  const c = clasificarServicio(servicio);
  const out = { ...servicio, categoria: c.categoria, tipoVenta: c.tipoVenta };
  if (c.tipoVenta !== "cuenta_completa") return { servicio: out, error: "" };
  if (!puedeSerCuentaCompleta(c.plataformaKey)) return { servicio: out, error: "Esa plataforma no se vende como cuenta completa." };
  const correo = String(out.correo || out.email || "").trim(), clave = String(out.clave || out.password || "").trim();
  if (!correo || !clave) return { servicio: out, error: "Cuenta completa: escriba el correo y la clave." };
  for (const k of ["pin", "pinPerfil"]) delete out[k]; // cuenta completa: sin PIN
  out.sinPinPerfil = true;
  return { servicio: out, error: "" };
}

module.exports = { CATEGORIAS, ORDEN_CATEGORIAS, TIPOS_VENTA, CUENTA_COMPLETA_PLATAFORMAS, SOLO_CUENTA_COMPLETA, normPlataformaKey, puedeSerCuentaCompleta, clasificarServicio, normalizarServicioVenta };
