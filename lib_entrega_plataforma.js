// lib_entrega_plataforma.js = COPIA FIEL de Sublichat HQ api/_entrega-plataforma.js · · R188 · Fase 3 (PDF «Sublichat 5 puntos», bloque 04): avisos por plataforma, modalidad de acceso
// (Gemini / Duolingo / ChatGPT) y dispositivo POR SERVICIO. Configuración central y VERSIONADA: Web, URL del cliente, APK y bot
// leen de aquí (copias fieles: bot lib_entrega_plataforma.js, APK src/app/entrega-plataforma.js). Un aviso se busca por la
// plataforma EXACTA (clave canónica): nunca se hereda a otra app (HBO ≠ Netflix ≠ Prime).
// CommonJS a propósito (igual que _tv-digital.js).

const VERSION = "2026-11-07.1";

// Avisos que van en la ficha Y en la URL personalizada.
const AVISOS = Object.freeze({
  netflix: [{ id: "netflix_hogar_15", destacado: false, titulo: "Aviso de sistema · Netflix",
    texto: "Es posible que en 15 días o más el sistema solicite un código temporal de hogar. Cuando le aparezca, notifíquenos y se lo daremos al instante." }],
  hbomax: [{ id: "hbo_codigo_hogar", destacado: false, titulo: "Código de hogar · HBO Max",
    texto: "HBO Max puede pedir un código de hogar en cualquier momento, incluso apenas inicie sesión. Si le aparece, escríbanos y le ayudamos a ingresarlo." }],
  primevideo: [{ id: "prime_solo_app", destacado: true, titulo: "Importante",
    texto: "Solo disponible para la aplicación Prime Video. Prohibido ingresar en Amazon." }],
});

function norm(v) { return String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
// Clave canónica SOLO para avisos/modalidad (no reemplaza a canonPlat de cada sistema).
function clavePlataforma(plataforma) {
  const p = norm(plataforma);
  if (!p) return "";
  if (p.includes("netflix") && p.includes("vip")) return "vipnetflix";
  if (p === "vipnetflix" || p.startsWith("netflix")) return p === "vipnetflix" ? "vipnetflix" : "netflix";
  if (p.startsWith("hbo") || p === "max") return "hbomax";
  if (p.startsWith("prime") || p === "amazonprime") return "primevideo";
  if (p.startsWith("crunchy")) return "crunchyroll";
  if (p.startsWith("gemini")) return "gemini";
  if (p.startsWith("duolingo")) return "duolingo";
  if (p.startsWith("chatgpt")) return "chatgpt";
  return p;
}
function avisosPara(plataforma) { return (AVISOS[clavePlataforma(plataforma)] || []).map((a) => ({ ...a, version: VERSION })); }
// Texto para fichas de WhatsApp (Markdown de WhatsApp: *negrita*).
function avisosTexto(plataforma) {
  return avisosPara(plataforma).map((a) => a.destacado ? `*⚠️ ${a.titulo}: ${a.texto}*` : `⚠️ ${a.titulo}:\n${a.texto}`).join("\n\n");
}

// ── Modalidad de acceso ──
//   ChatGPT: cuenta entregada por Sublicuentas → correo + contraseña.
//   Gemini / Duolingo: «proveedor» (cuenta de Sublicuentas: correo + contraseña) o «correo_cliente» (correo propio del cliente:
//   la contraseña NO se pide, NO se guarda y NO se muestra). Registros anteriores sin modalidad = correo del cliente (como hasta hoy).
const MODALIDADES = Object.freeze({ proveedor: "Cuenta entregada por Sublicuentas", correo_cliente: "Correo propio del cliente" });
function usaModalidad(plataforma) { return ["gemini", "duolingo"].includes(clavePlataforma(plataforma)); }
function modalidadAcceso(plataforma, servicio = {}) {
  const k = clavePlataforma(plataforma);
  if (k === "chatgpt") return "proveedor";
  if (k === "gemini" || k === "duolingo") return servicio && servicio.modalidadAcceso === "proveedor" ? "proveedor" : "correo_cliente";
  return "";
}
// true/false = esta regla manda; null = sigue la regla de siempre de cada sistema.
function claveSegunModalidad(plataforma, servicio = {}) {
  const m = modalidadAcceso(plataforma, servicio);
  if (m === "proveedor") return true;
  if (m === "correo_cliente") return false;
  return null;
}

// ── Dispositivo por SERVICIO ──
const EQUIPOS = Object.freeze({
  android_tv: "Android TV / TV Box", fire_tv: "Fire TV / Fire Stick", android_movil: "Celular / tableta Android",
  smart_tv: "Smart TV Samsung / LG", iphone: "iPhone / iPad", pc: "PC / Laptop",
});
const FAMILIA_TV = [["stellatv", "stellatv"], ["stella", "stellatv"], ["oleada", "oleada"], ["latintv", "latintv"], ["liontv", "liontv"], ["evoutouch", "evoutouch"], ["nanotech", "evoutouch"], ["icomplay", "icomplay"]];
function familiaTv(plataforma) { const p = norm(plataforma); const f = FAMILIA_TV.find(([pre]) => p.startsWith(pre)); return f ? f[1] : ""; }
// Equipos permitidos para una plataforma de TV Digital = los que tienen al menos un enlace ACTIVO en el Baúl (no se inventan).
function equiposPermitidos(plataforma, baulVistas = null) {
  const fam = familiaTv(plataforma); if (!fam) return [];
  const vista = Array.isArray(baulVistas) ? baulVistas.find((v) => v && v.plataforma === fam) : null;
  if (vista) return (vista.dispositivos || []).filter((d) => (d.enlaces || []).length && EQUIPOS[d.id]).map((d) => d.id);
  return Object.keys(EQUIPOS).filter((k) => !(fam === "stellatv" && ["iphone", "pc"].includes(k)));
}
// Normaliza lo que llega al guardar: "" (sin elegir) o un id permitido; cualquier otro valor es error (no se adivina).
function validarEquipoTv(plataforma, valor, baulVistas = null) {
  const v = String(valor == null ? "" : valor).trim();
  if (!v) return "";
  if (!familiaTv(plataforma)) return "";
  if (!equiposPermitidos(plataforma, baulVistas).includes(v)) throw new Error(`Ese dispositivo no está disponible para esta plataforma: ${EQUIPOS[v] || v}.`);
  return v;
}
// Lo que se muestra como «Dispositivo registrado» (ficha y URL). Siempre del SERVICIO (o del perfil), nunca del cliente global.
function etiquetaDispositivo(servicio = {}, perfil = null) {
  const fam = familiaTv(servicio.plataforma);
  if (fam) return EQUIPOS[servicio.equipoTv] || "Pendiente de seleccionar";
  const k = clavePlataforma(servicio.plataforma);
  if (!["netflix", "disneyp", "disneys", "hbomax", "vix", "universal", "primevideo"].includes(k) && !/^disney/.test(k)) return "";
  const d = String((perfil && perfil.dispositivo != null && perfil.dispositivo !== "" ? perfil.dispositivo : servicio.dispositivo) || "");
  const roku = d === "tv" && ((perfil && perfil.esRoku === true) || (!perfil && servicio.esRoku === true));
  return d === "tv" ? (roku ? "TV (Roku)" : "TV") : d === "cel" ? "Celular" : "Pendiente de seleccionar";
}

module.exports = { VERSION, AVISOS, MODALIDADES, EQUIPOS, clavePlataforma, avisosPara, avisosTexto, usaModalidad, modalidadAcceso, claveSegunModalidad, familiaTv, equiposPermitidos, validarEquipoTv, etiquetaDispositivo };
