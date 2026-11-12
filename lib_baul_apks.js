// lib_baul_apks.js = COPIA FIEL de Sublichat HQ api/_baul-apks.js · · R187 · Baúl de APKs de TV Digital (PDF «Sublichat 5 puntos», bloque 03, 07/11/2026).
// Fuente ÚNICA para Sublichat Web, APK y bot de Telegram (el bot tiene una copia fiel: lib_baul_apks.js).
// Directorio oficial dado por la dirección: URLs y códigos EXACTOS. Nada se inventa:
//   · sin URL → "tienda del TV (sin URL exacta)" · código no confirmado → pendiente de confirmar.
//   · Stella TV: solo Android TV/TV Box y Android móvil (no iPhone ni PC).
//   · El código 298863 es SOLO de la app "Sublicuentas" (no de Latv-Gt).
// Una app compartida (p. ej. "Sublicuentas" en Lion/Icomplay/Latin/Nanotech) es UN enlace con varias plataformas:
// editarlo cambia todas a la vez sin duplicar el recurso.
// Vive en Firestore (configuracion_tv_digital/baul_apks); estos valores son la semilla si el documento no existe.
// Separado de las URLs de conexión de cada IPTV (_tv-digital.js): aquí solo hay descargas de apps.
// CommonJS a propósito (igual que _tv-digital.js).

const PLATAFORMAS = Object.freeze([
  { id: "liontv", nombre: "Lion TV" }, { id: "icomplay", nombre: "Icomplay" }, { id: "latintv", nombre: "Latin TV" },
  { id: "oleada", nombre: "Oleada TV" }, { id: "stellatv", nombre: "Stella TV" }, { id: "evoutouch", nombre: "Nanotech" },
]);
const DISPOSITIVOS = Object.freeze({
  android_tv: "Android TV / TV Box", fire_tv: "Fire TV / Fire Stick", android_movil: "Celular / tableta Android",
  smart_tv: "Smart TV Samsung / LG", iphone: "iPhone / iPad", pc: "PC / Laptop",
});
const METODOS = Object.freeze({ apk: "APK directo", downloader: "Downloader", play_store: "Google Play", app_store: "App Store", tv_store: "Tienda del TV", web: "Web" });

const PURPLE = "https://apps.apple.com/hn/app/purple-lite-iptv-player/id6749171817";
const L4 = ["liontv", "icomplay", "latintv", "evoutouch"];
const SEMILLA = Object.freeze({
  version: 1,
  apps: [
    { id: "sublicuentas", nombre: "Sublicuentas" }, { id: "purple", nombre: "Purple IPTV Lite" },
    { id: "maxplayer", nombre: "Max Player" }, { id: "smartone", nombre: "SmartOne" },
    { id: "latvgt", nombre: "Latv-Gt" }, { id: "evotouch", nombre: "Evotouch" },
    { id: "oleada", nombre: "Oleada" }, { id: "oleadaweb", nombre: "Oleada Web" }, { id: "stellatv", nombre: "Stella TV" },
  ],
  enlaces: [
    { id: "subli-atv", appId: "sublicuentas", plataformas: L4, dispositivo: "android_tv", metodo: "downloader", url: "http://aftv.news/298863", codigo: "298863" },
    { id: "purple-ios", appId: "purple", plataformas: L4, dispositivo: "iphone", metodo: "app_store", url: PURPLE, codigo: "" },
    { id: "maxplayer-tv", appId: "maxplayer", plataformas: L4, dispositivo: "smart_tv", metodo: "tv_store", url: "", codigo: "", nota: "Tienda de apps del TV (sin URL exacta). Alternativa a SmartOne." },
    { id: "smartone-tv", appId: "smartone", plataformas: L4, dispositivo: "smart_tv", metodo: "tv_store", url: "", codigo: "", nota: "Tienda de apps del TV (sin URL exacta). Alternativa a Max Player.", costoExterno: { monto: 85, moneda: "HNL", texto: "L85 para activar 12 meses POR DISPOSITIVO, lo paga el cliente aparte del costo IPTV." } },
    { id: "latvgt-atv", appId: "latvgt", plataformas: ["latintv"], dispositivo: "android_tv", metodo: "play_store", url: "https://play.google.com/store/apps/details?id=latvgt.appcom", codigo: "", nota: "Segunda app Android independiente. El código 298863 NO es de esta app." },
    { id: "evotouch-atv", appId: "evotouch", plataformas: ["evoutouch"], dispositivo: "android_tv", metodo: "play_store", url: "https://play.google.com/store/apps/details?id=com.evotouch.app", codigo: "" },
    { id: "oleada-atv", appId: "oleada", plataformas: ["oleada"], dispositivo: "android_tv", metodo: "apk", url: "https://dldsrvs.com/apks/tv/ola_tv.apk", codigo: "9387291" },
    { id: "oleada-fire", appId: "oleada", plataformas: ["oleada"], dispositivo: "fire_tv", metodo: "apk", url: "https://dldsrvs.com/apks/firestick/mgs_pro.apk", codigo: "1290332" },
    { id: "oleada-mov-aftv", appId: "oleada", plataformas: ["oleada"], dispositivo: "android_movil", metodo: "downloader", url: "http://aftv.news/4221609", codigo: "", codigoPendiente: "4221609", nota: "El número 4221609 está en la URL pero NO está confirmado como código Downloader." },
    { id: "oleada-mov-apk", appId: "oleada", plataformas: ["oleada"], dispositivo: "android_movil", metodo: "apk", url: "https://dldsrvs.com/apks/mobile/ola_mob.apk", codigo: "" },
    { id: "oleadaweb-ios", appId: "oleadaweb", plataformas: ["oleada"], dispositivo: "iphone", metodo: "web", url: "https://www.oleada-tv.online", codigo: "" },
    { id: "oleadaweb-pc", appId: "oleadaweb", plataformas: ["oleada"], dispositivo: "pc", metodo: "web", url: "https://www.oleada-tv.online", codigo: "" },
    { id: "stella-atv-aftv", appId: "stellatv", plataformas: ["stellatv"], dispositivo: "android_tv", metodo: "downloader", url: "http://aftv.news/7471459", codigo: "7471459" },
    { id: "stella-atv-bit", appId: "stellatv", plataformas: ["stellatv"], dispositivo: "android_tv", metodo: "apk", url: "https://bit.ly/stv0904", codigo: "" },
    { id: "stella-mov", appId: "stellatv", plataformas: ["stellatv"], dispositivo: "android_movil", metodo: "apk", url: "https://bit.ly/4bg5tgE", codigo: "" },
  ].map((e, i) => ({ prioridad: i + 1, activo: true, revision: 1, nota: "", ...e })),
});
const AVISO_INSTALACION = "Para APK externas: instale Downloader si corresponde, active el permiso de instalar desde esa fuente y use solo estos enlaces. Si no instala por falta de espacio, libere espacio borrando a mano una app que no use (Sublichat no borra nada).";

// R196m · PDF «Correcciones Spotify y entrega APK» (12/11/2026): mensaje CORTO para WhatsApp, de UN solo dispositivo, con
// pasos numerados y *negritas* de WhatsApp (los asteriscos se copian). Solo usa el enlace / código Downloader YA guardados
// para esa plataforma; si falta lo necesario NO se arma mensaje: se devuelve `faltante` («No configurado») y la APK bloquea
// la copia. Nunca se sugiere desactivar protecciones del equipo: solo «autorizar esta fuente de confianza» si lo pide.
// (R192: mismo registro para Web, APK y bot.)
const TITULO_DISP = Object.freeze({ android_tv: "Android TV", fire_tv: "Fire TV", android_movil: "celular Android", smart_tv: "Smart TV", iphone: "iPhone", pc: "PC" });
const EQUIPO = Object.freeze({ android_tv: "su televisor", fire_tv: "su Fire TV", android_movil: "su celular" });
const DATOS = "Ingrese los datos de acceso proporcionados.";
const conCodigo = (e) => !!e.codigo && ["android_tv", "fire_tv", "android_movil"].includes(e.dispositivo);
// Qué falta para poder entregar este enlace (texto para el administrador). "" = completo.
function faltanteDe(e = {}) {
  if (conCodigo(e) || e.metodo === "tv_store" || e.metodo === "play_store") return "";
  if (!e.url) return e.metodo === "downloader" ? "Código Downloader o enlace no configurado" : "Enlace no configurado";
  return "";
}
function pasosInstalacion(e = {}, app = "la aplicación") {
  const tv = ["android_tv", "fire_tv"].includes(e.dispositivo);
  if (conCodigo(e)) return [`Abra *Downloader* en ${EQUIPO[e.dispositivo]}.`, "Permita que Downloader instale aplicaciones si el sistema lo solicita.",
    `Introduzca el código *${e.codigo}* en la casilla principal.`, "Presione *Go*.", "Cuando termine la descarga, pulse *Instalar* y luego *Abrir*.", DATOS];
  if (e.metodo === "app_store") return [`Abra la *App Store* aquí: ${e.url}`, `Presione *Obtener* para instalar ${app}.`, "Ábrala.", DATOS];
  if (e.metodo === "play_store") return [e.url ? `Abra *Google Play* aquí: ${e.url}` : `Abra *Google Play* y busque *${app}*.`, "Presione *Instalar* y luego *Abrir*.", DATOS];
  if (e.metodo === "tv_store") return ["Abra la tienda de aplicaciones de su TV.", `Busque *${app}* y presione *Instalar*.`, "Ábrala.", DATOS];
  if (e.metodo === "web") return [`Abra este enlace en su navegador: ${e.url}`, DATOS];
  if (tv) return [`Abra *Downloader* en ${EQUIPO[e.dispositivo]}.`, "Permita que Downloader instale aplicaciones si el sistema lo solicita.",
    `Escriba este enlace en la casilla principal: ${e.url}`, "Presione *Go*.", "Cuando termine la descarga, pulse *Instalar* y luego *Abrir*.", DATOS];
  return [`*Descargue* la app aquí: ${e.url}`, "Abra el archivo descargado.", "Si Android solicita permiso de instalación, *autorícelo* para esta fuente de confianza.", "Presione *Instalar* y luego *Abrir*.", DATOS];
}
function mensajeCliente(e = {}, { plataforma = "", app = "" } = {}) {
  if (faltanteDe(e)) return "";
  const nombreApp = app || e.app || e.appId || "la aplicación";
  const lineas = [`*Instalación en ${TITULO_DISP[e.dispositivo] || "su equipo"} - ${plataforma || nombreApp}*`, "", ...pasosInstalacion(e, nombreApp).map((p, i) => `${i + 1}. ${p}`)];
  if (e.costoExterno && e.costoExterno.texto) lineas.push("", `*Importante:* ${e.costoExterno.texto}`);
  return lineas.join("\n");
}

const COL = "configuracion_tv_digital", DOC = "baul_apks";
const clean = (v, n = 200) => String(v == null ? "" : v).trim().slice(0, n);
const idOk = (v) => /^[a-z0-9-]{2,40}$/.test(String(v || ""));

// Solo http(s), sin espacios ni caracteres de inyección; dominio obligatorio.
function validarUrlDescarga(url) {
  const s = clean(url, 400);
  if (!s) return "";
  let u; try { u = new URL(s); } catch (_) { return null; }
  if (!["http:", "https:"].includes(u.protocol) || !u.hostname || !u.hostname.includes(".")) return null;
  if (/[\s<>"'`\\]/.test(s)) return null;
  return s;
}
function validarCodigo(c) { const s = clean(c, 20); return !s || /^\d{3,12}$/.test(s) ? s : null; }

function normalizar(data) {
  const d = data && Array.isArray(data.enlaces) ? data : SEMILLA;
  return { version: Number(d.version || 1), apps: (d.apps || SEMILLA.apps).map((a) => ({ id: a.id, nombre: clean(a.nombre, 60) })), enlaces: d.enlaces.map((e) => ({ ...e })), updatedAt: d.updatedAt || "", updatedBy: d.updatedBy || "" };
}

let cache = { at: 0, data: null };
async function leerBaul(db, { fresco = false } = {}) {
  if (!fresco && cache.data && Date.now() - cache.at < 60 * 1000) return cache.data;
  let data = null;
  try { const s = await db.collection(COL).doc(DOC).get(); data = s.exists ? s.data() : null; } catch (_) { if (cache.data) return cache.data; }
  cache = { at: Date.now(), data: normalizar(data) };
  return cache.data;
}

// Vista para consultar: por plataforma → dispositivos → enlaces activos (con nombre de app y método legibles).
function vistaPlataforma(baul, plataformaId, { incluirInactivos = false } = {}) {
  const apps = new Map(baul.apps.map((a) => [a.id, a.nombre]));
  const enl = baul.enlaces.filter((e) => (incluirInactivos || e.activo !== false) && (e.plataformas || []).includes(plataformaId)).sort((a, b) => (a.prioridad || 99) - (b.prioridad || 99));
  const porDisp = {};
  const pNombre = (PLATAFORMAS.find((x) => x.id === plataformaId) || {}).nombre || plataformaId;
  for (const e of enl) (porDisp[e.dispositivo] = porDisp[e.dispositivo] || []).push({ ...e, mensaje: mensajeCliente(e, { plataforma: pNombre, app: apps.get(e.appId) || e.appId }), faltante: faltanteDe(e), app: apps.get(e.appId) || e.appId, metodoTxt: METODOS[e.metodo] || e.metodo, dispositivoTxt: DISPOSITIVOS[e.dispositivo] || e.dispositivo, compartidaCon: (e.plataformas || []).filter((p) => p !== plataformaId) });
  const p = PLATAFORMAS.find((x) => x.id === plataformaId);
  return { plataforma: plataformaId, nombre: p ? p.nombre : plataformaId, dispositivos: Object.keys(DISPOSITIVOS).filter((k) => porDisp[k]).map((k) => ({ id: k, nombre: DISPOSITIVOS[k], enlaces: porDisp[k] })), aviso: AVISO_INSTALACION };
}

async function escribir(db, usuario, mutar, auditoria) {
  const ref = db.collection(COL).doc(DOC), ahora = new Date().toISOString();
  let antes = null, despues = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const actual = normalizar(s.exists ? s.data() : null);
    const r = mutar(actual);
    antes = r.antes; despues = r.despues;
    tx.set(ref, { version: actual.version + 1, apps: actual.apps, enlaces: actual.enlaces, updatedAt: ahora, updatedBy: clean(usuario, 60) });
  });
  await db.collection("auditoria_eventos").add({ tipo: "baul_apks", accion: auditoria, modulo: "baul-apks", usuario: clean(usuario, 60), antes: antes || null, despues: despues || null, createdAt: ahora });
  cache = { at: 0, data: null };
  return { ok: true, antes, despues };
}

// Alta o edición de un enlace. Editar sube la revisión. Validación estricta (URL, código, plataformas, dispositivo, método).
async function guardarEnlace(db, input = {}, usuario = "") {
  const plataformas = [...new Set((Array.isArray(input.plataformas) ? input.plataformas : []).map((x) => clean(x, 20)).filter((x) => PLATAFORMAS.some((p) => p.id === x)))];
  if (!plataformas.length) throw new Error("Elija al menos una plataforma.");
  if (!DISPOSITIVOS[input.dispositivo]) throw new Error("Dispositivo inválido.");
  if (!METODOS[input.metodo]) throw new Error("Método inválido.");
  if (plataformas.includes("stellatv") && ["iphone", "pc"].includes(input.dispositivo)) throw new Error("Stella TV no se ofrece en iPhone ni en PC.");
  const url = validarUrlDescarga(input.url);
  if (url === null) throw new Error("URL inválida: use http:// o https:// con dominio, sin espacios.");
  if (!url && input.metodo !== "tv_store") throw new Error("Falta la URL (solo «Tienda del TV» puede ir sin URL).");
  const codigo = validarCodigo(input.codigo);
  if (codigo === null) throw new Error("El código Downloader son solo números (3 a 12).");
  const appNombre = clean(input.appNombre, 60);
  return escribir(db, usuario, (b) => {
    let appId = clean(input.appId, 40);
    if (!b.apps.some((a) => a.id === appId)) {
      if (!appNombre) throw new Error("Elija la aplicación o escriba su nombre.");
      appId = appNombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `app-${Date.now()}`;
      if (!b.apps.some((a) => a.id === appId)) b.apps.push({ id: appId, nombre: appNombre });
    }
    if (codigo && b.enlaces.some((e) => e.codigo === codigo && e.appId !== appId && e.id !== input.id)) throw new Error(`El código ${codigo} ya pertenece a otra aplicación: no se reutiliza.`);
    const i = input.id ? b.enlaces.findIndex((e) => e.id === input.id) : -1;
    const base = { appId, plataformas, dispositivo: input.dispositivo, metodo: input.metodo, url, codigo, nota: clean(input.nota, 300), prioridad: Math.max(1, Math.min(99, Number(input.prioridad) || 50)) };
    if (i >= 0) { const antes = { ...b.enlaces[i] }; b.enlaces[i] = { ...b.enlaces[i], ...base, revision: Number(antes.revision || 1) + 1, activo: antes.activo !== false }; return { antes, despues: b.enlaces[i] }; }
    const id = idOk(input.id) ? input.id : `${appId}-${input.dispositivo}-${Date.now().toString(36)}`.slice(0, 40);
    if (b.enlaces.some((e) => e.id === id)) throw new Error("Ya existe un enlace con ese ID.");
    const nuevo = { id, ...base, activo: true, revision: 1 };
    b.enlaces.push(nuevo);
    return { antes: null, despues: nuevo };
  }, input.id ? "editar_enlace" : "agregar_enlace");
}
async function activarEnlace(db, id, activo, usuario = "") {
  return escribir(db, usuario, (b) => {
    const e = b.enlaces.find((x) => x.id === id); if (!e) throw new Error("Ese enlace ya no existe.");
    const antes = { ...e }; e.activo = !!activo; e.revision = Number(e.revision || 1) + 1; return { antes, despues: { ...e } };
  }, activo ? "activar_enlace" : "desactivar_enlace");
}
// Eliminación controlada: solo un enlace YA desactivado (primero se desactiva, queda en la auditoría).
async function eliminarEnlace(db, id, usuario = "") {
  return escribir(db, usuario, (b) => {
    const i = b.enlaces.findIndex((x) => x.id === id); if (i < 0) throw new Error("Ese enlace ya no existe.");
    if (b.enlaces[i].activo !== false) throw new Error("Primero desactívelo; luego se puede eliminar.");
    const antes = b.enlaces[i]; b.enlaces.splice(i, 1); return { antes, despues: null };
  }, "eliminar_enlace");
}

module.exports = { mensajeCliente, pasosInstalacion, faltanteDe, PLATAFORMAS, DISPOSITIVOS, METODOS, SEMILLA, AVISO_INSTALACION, validarUrlDescarga, validarCodigo, leerBaul, vistaPlataforma, guardarEnlace, activarEnlace, eliminarEnlace, _limpiarCache: () => { cache = { at: 0, data: null }; } };
