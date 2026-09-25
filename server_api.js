
/* ════════════════════════════════════════════════════════════════
   server_api.js  ·  API del PANEL DE REVENDEDORES (independiente)
   ────────────────────────────────────────────────────────────────
   Arranca SOLO la API REST del panel. NO inicia el polling del bot
   (reusa Firebase de index_01_core, donde el bot está en polling:false).
   Pensado para correr en un Web Service de Render aparte del Worker.

   Start command en Render:  node server_api.js

   Variables de entorno necesarias (las mismas del bot + las del panel):
     FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
     BOT_TOKEN            (el mismo; aquí NO hace polling, solo evita warnings)
     JWT_SECRET           (una frase larga aleatoria)
     ADMIN_USER           (tu usuario admin)
     ADMIN_PASSWORD       (tu clave admin)
     STORAGE_BUCKET       (opcional, ej. tu-proyecto.firebasestorage.app o tu-proyecto.appspot.com)
   ════════════════════════════════════════════════════════════════ */

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ✅ Usar módulo de auth compartido (elimina duplicación con index_08_api.js)
const {
  revAuth, revAdminAuth, revParseFecha, revDiasRest, revFechaISO, revParseFechaInput,
  getJwtSecret, revLoginIpLimiter, createRevLoginHandler, esRevSoloCatalogo, capacidadesRevendedor,
} = require("./index_09_api_auth");

// Reusa Firebase ya inicializado en el core (no arranca el bot)
const { db, PORT, bot, SUPER_ADMIN, PLATAFORMAS } = require("./index_01_core");
const { enqueueTelegramJob, isUnauthorizedTelegramError } = require("./index_22_telegram_outbox");
const { registrarEventoSorteosSeguro } = require("./index_14_sorteos");
const {
  obtenerCatalogoSocio,
  buscarProductoCatalogo,
  catalogoPlano,
} = require("./index_15_catalogo_socios");
const {
  normVendedor,
  vendedorEfectivoServicio,
  heredarVendedorServicios,
  camposResumenVendedores,
  servicioPerteneceAVendedor,
  filtrarClienteParaVendedor,
} = require("./index_17_vendedores_servicio");
const admin = require("firebase-admin");
const STORAGE_BUCKET_CANDIDATES = Array.from(new Set([
  process.env.STORAGE_BUCKET,
  process.env.FIREBASE_STORAGE_BUCKET,
  process.env.GCLOUD_STORAGE_BUCKET,
  process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.appspot.com` : "",
  process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app` : "",
].map((s) => String(s || "").trim()).filter(Boolean)));
const STORAGE_BUCKET = STORAGE_BUCKET_CANDIDATES[0] || "";

// ✅ Sin fallback inseguro: si falta JWT_SECRET, el proceso no arranca (ver index_09_api_auth.js).
const JWT_SECRET = getJwtSecret();

const app = express();
app.disable("x-powered-by");

// Seguridad web: en producción puede limitarse el CORS con
// PANEL_ALLOWED_ORIGINS=https://socios.sublicuentas.com,https://otro-dominio.com
// Si la variable no existe conservamos compatibilidad con el despliegue actual.
const PANEL_ALLOWED_ORIGINS = String(process.env.PANEL_ALLOWED_ORIGINS || "")
  .split(",").map((x) => x.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || !PANEL_ALLOWED_ORIGINS.length || PANEL_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
}));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.path.startsWith("/rev/")) res.set("Cache-Control", "no-store, max-age=0");
  next();
});
app.use(express.json({ limit: "15mb" }));

// keepalive / health (para que Render lo mantenga vivo)
const PANEL_API_VERSION = "socios-20260925-professional-web-1";
app.get("/", (_req, res) => res.type("text/plain").send(`Sublicuentas Panel API OK ${PANEL_API_VERSION}`));
app.get("/rev/ping", (_req, res) => res.json({ v: PANEL_API_VERSION, ticketsBridge: true, telegramOutbox: true, gemini: !!process.env.GEMINI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY, storageConfigured: STORAGE_BUCKET_CANDIDATES.length > 0 }));
app.get("/health", (_req, res) => res.json({ ok: true, version: PANEL_API_VERSION, ts: Date.now() }));

// ── perfil/permisos vivos del socio ──
const _revLiveCache = new Map();
function revNormKey(v) {
  return normVendedor(String(v || "")) === "geissel" ? "geisell" : normVendedor(String(v || ""));
}
async function revLiveProfile(tokenRev = {}, maxAgeMs = 30000) {
  const id = String(tokenRev?.id || "").trim();
  const cacheKey = id || revNormKey(tokenRev?.nombre_norm || tokenRev?.nombre || "");
  const now = Date.now();
  const cached = cacheKey ? _revLiveCache.get(cacheKey) : null;
  if (cached && now - cached.at < maxAgeMs) return cached.value;
  let data = {};
  try {
    if (id) {
      const snap = await db.collection("revendedores").doc(id).get();
      if (snap.exists) data = { id: snap.id, ...snap.data() };
    }
    if (!Object.keys(data).length) {
      const key = revNormKey(tokenRev?.nombre_norm || tokenRev?.nombre || "");
      if (key) {
        const snap = await db.collection("revendedores").where("nombre_norm", "==", key).limit(1).get();
        if (!snap.empty) data = { id: snap.docs[0].id, ...snap.docs[0].data() };
      }
    }
  } catch (e) {
    console.error("revLiveProfile", e?.message || e);
  }
  const merged = { ...tokenRev, ...data };
  const capabilities = capacidadesRevendedor(merged);
  const value = {
    ...merged,
    nombre_norm: revNormKey(merged.nombre_norm || merged.nombre || tokenRev?.nombre_norm || ""),
    capabilities,
    permisos: capabilities,
    soloCatalogo: !capabilities.canBuy,
    sinCompras: !capabilities.canBuy,
    tarifaId: String(merged.tarifaId || merged.tarifa_id || tokenRev?.tarifaId || "general"),
    priceTier: String(merged.tarifaId || merged.tarifa_id || tokenRev?.tarifaId || "general"),
  };
  if (cacheKey) _revLiveCache.set(cacheKey, { at: now, value });
  return value;
}
function revCap(profile, key, fallback = true) {
  const caps = profile?.capabilities || profile?.permisos || {};
  return typeof caps[key] === "boolean" ? caps[key] : fallback;
}
function revMoneyNumber(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c > -1) s = s.length - c - 1 === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  else if (d > -1 && s.length - d - 1 !== 2) s = s.replace(/\./g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function revDateMs(v) {
  if (!v) return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "object") {
    if (typeof v.toDate === "function") return v.toDate().getTime();
    if (v._seconds) return Number(v._seconds) * 1000;
    if (v.seconds) return Number(v.seconds) * 1000;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
function revCanonInventory(v) {
  const raw = String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const key = raw.replace(/[^a-z0-9]/g, "");
  const aliases = {
    netflixpremium:"netflix", netflix:"netflix", netflixvip:"vipnetflix", vipnetflix:"vipnetflix",
    disneyplus:"disney", disneypremium:"disney", disneystandard:"disney", disney:"disney",
    hbomax:"hbomax", max:"hbomax", hbo:"hbomax", primevideo:"primevideo", prime:"primevideo",
    crunchyroll:"crunchyroll", crunchy:"crunchyroll", paramountplus:"paramount", paramount:"paramount",
    vix:"vix", vikirakuten:"viki", viki:"viki", universalplus:"universal", universal:"universal",
    spotify:"spotify", youtube:"youtube", youtubepremium:"youtube", canva:"canva", gemini:"gemini",
    chatgpt:"chatgpt", duolingo:"duolingo", office365:"office", microsoft365:"office", office:"office",
    office2021:"office2021", esetnod32:"nod32", nod32:"nod32", stellatv:"stellatv", stella:"stellatv",
    oleadatv:"oleada", oleada:"oleada", latintv:"latintv", liontv:"liontv", iptv:"iptv",
    nanotech:"evoutouch", evoutouch:"evoutouch"
  };
  if (aliases[key]) return aliases[key];
  const stella = key.match(/^stella(?:tv)?([123])/); if (stella) return `stellatv${stella[1]}`;
  const oleada = key.match(/^oleada(?:tv)?([13])/); if (oleada) return `oleadatv${oleada[1]}`;
  const latin = key.match(/^latintv([1234])/); if (latin) return `latintv${latin[1]}`;
  const lion = key.match(/^liontv([1235])/); if (lion) return `liontv${lion[1]}`;
  const nano = key.match(/^(?:nanotech|evoutouch)([1234])$/); if (nano) return `evoutouch${nano[1] === "4" ? "1" : nano[1]}`;
  return key;
}
function revCatalogInventoryKeys(item = {}) {
  const text = `${item.n || item.nombre || ""} ${item.s || item.variante || ""}`.trim();
  const base = revCanonInventory(text);
  const raw = String(text).toLowerCase();
  const qty = Number((raw.match(/([1-9])\s*(?:dispositivo|pantalla)/) || [])[1] || 0);
  const keys = [];
  if (raw.includes("netflix") && raw.includes("vip")) keys.push("vipnetflix");
  if (raw.includes("stella") && qty) keys.push(`stellatv${qty}`);
  if (raw.includes("oleada") && qty) keys.push(`oleadatv${qty}`);
  if (raw.includes("latin") && qty) keys.push(`latintv${qty}`);
  if (raw.includes("lion") && qty) keys.push(`liontv${qty}`);
  if ((raw.includes("nanotech") || raw.includes("evoutouch")) && qty) keys.push(`evoutouch${qty}`);
  if (base) keys.push(base);
  if (base && /^(stellatv|oleadatv|latintv|liontv|evoutouch)\d$/.test(base)) keys.push(base.replace(/\d$/, ""));
  return [...new Set(keys.filter(Boolean))];
}

// ── helpers ──
// Autenticación y fechas compartidas vienen de index_09_api_auth.js.
function revCampoFechaServicio(s) {
  const keys = ["fechaRenovacion", "vencimiento", "vence", "fechaFin"];
  for (const k of keys) if (s && s[k] != null && s[k] !== "") return k;
  return "fechaRenovacion";
}
function revAddMonths(base, months) {
  const d = new Date(base || Date.now());
  d.setHours(12, 0, 0, 0);
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months || 1));
  if (d.getDate() !== day) d.setDate(0);
  return d;
}
function revFechaDMY(d) {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  x.setHours(12, 0, 0, 0);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
}
async function revResolverSeleccionCliente({ clienteId, socioNorm, seleccion = [] }) {
  const id = String(clienteId || "").trim();
  if (!id) throw Object.assign(new Error("cliente_no_existe"), { status: 404, publicError: "cliente_no_existe" });
  const snap = await db.collection("clientes").doc(id).get();
  if (!snap.exists) throw Object.assign(new Error("cliente_no_existe"), { status: 404, publicError: "cliente_no_existe" });
  const cliente = snap.data() || {};
  const servicios = heredarVendedorServicios(Array.isArray(cliente.servicios) ? cliente.servicios : [], cliente);
  const resueltos = seleccion.map((item) => {
    const compraId = String(item?.compraId || "").trim();
    const ix = compraId
      ? servicios.findIndex((s) => String(s?.compraId || "").trim() === compraId)
      : Number(item?.servicioIndex);
    if (!Number.isInteger(ix) || ix < 0 || ix >= servicios.length) {
      throw Object.assign(new Error("servicio_no_existe"), { status: 400, publicError: "servicio_no_existe" });
    }
    const servicio = servicios[ix] || {};
    if (!servicioPerteneceAVendedor(servicio, cliente, socioNorm)) {
      throw Object.assign(new Error("servicio_no_permitido"), { status: 403, publicError: "servicio_no_permitido" });
    }
    return {
      ...item,
      servicioIndex: ix,
      compraId: String(servicio.compraId || compraId || ""),
      servicio: item?.servicio || servicio.plataforma || servicio.servicio || servicio.nombre || "Servicio",
      precioCliente: revMoneyNumber(servicio.precioCliente ?? servicio.precioVenta ?? servicio.precio ?? servicio.monto ?? 0),
    };
  });
  const vistos = new Set();
  return resueltos.filter((item) => {
    if (vistos.has(item.servicioIndex)) return false;
    vistos.add(item.servicioIndex);
    return true;
  });
}
async function revActualizarFechaCliente({ clienteId, socioNorm, servicioIndex, compraId, nuevaFecha, meses }) {
  const id = (clienteId || "").toString().trim();
  if (!id) return { actualizado: false };
  const ref = db.collection("clientes").doc(id);
  const mutation = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw Object.assign(new Error("cliente_no_existe"), { status: 404, publicError: "cliente_no_existe" });
    const c = snap.data() || {};
    const servicios = heredarVendedorServicios(Array.isArray(c.servicios) ? c.servicios : [], c);
    const compraBuscada = String(compraId || "").trim();
    const ix = compraBuscada
      ? servicios.findIndex((s) => String(s?.compraId || "").trim() === compraBuscada)
      : Number(servicioIndex);
    if (!Number.isInteger(ix) || ix < 0 || ix >= servicios.length) throw Object.assign(new Error("servicio_no_existe"), { status: 400, publicError: "servicio_no_existe" });
    if (!servicioPerteneceAVendedor(servicios[ix], c, socioNorm)) {
      throw Object.assign(new Error("servicio_no_permitido"), { status: 403, publicError: "servicio_no_permitido" });
    }

    const svc = { ...(servicios[ix] || {}) };
    const campo = revCampoFechaServicio(svc);
    const anterior = revParseFecha(svc[campo] || svc.fechaRenovacion || svc.vencimiento || svc.vence || svc.fechaFin);
    let nf = revParseFechaInput(nuevaFecha);
    if (!nf && meses) {
      const base = anterior && revDiasRest(anterior) > 0 ? anterior : new Date();
      nf = revAddMonths(base, Number(meses));
    }
    if (!nf || isNaN(nf)) throw Object.assign(new Error("fecha_invalida"), { status: 400, publicError: "fecha_invalida" });

    const ahora = new Date();
    svc[campo] = revFechaDMY(nf);
    svc.ultimaRenovacionAt = ahora;
    const procesadorNorm = normVendedor(socioNorm);
    svc.ultimaRenovacionProcesadaPor = procesadorNorm === "geissel" ? "geisell" : procesadorNorm;
    servicios[ix] = svc;
    transaction.update(ref, {
      servicios,
      ...camposResumenVendedores(servicios, c),
      updatedAt: ahora,
      ultimaRenovacionAt: ahora,
    });
    return { c, svc, ix, campo, fechaFinal: revFechaDMY(nf), fechaAnterior: anterior ? revFechaDMY(anterior) : "" };
  });
  const { c, svc, ix, campo, fechaFinal, fechaAnterior } = mutation;
  const compraEvento = String(svc.compraId || `servicio-${ix}`);
  const sorteo = fechaFinal !== fechaAnterior
    ? await registrarEventoSorteosSeguro({
      tipo: "renovacion", clientId: id, compraId: compraEvento, fechaEvento: fechaFinal,
      eventoId: `renov:${compraEvento}:${fechaFinal}`,
      meses: Math.max(1, Number(meses) || 1),
      clienteNombre: c.nombrePerfil || c.nombre || "Cliente", telefono: c.telefono || "",
      vendedor: vendedorEfectivoServicio(svc, c).vendedor || socioNorm || "", origen: "Panel de socios"
    })
    : { ok: true, creados: 0, omitido: "fecha_sin_cambio" };
  const vendedor = vendedorEfectivoServicio(svc, c).vendedor || socioNorm || "";
  if (fechaFinal !== fechaAnterior) {
    try {
      await db.collection("historial_clientes").add({
        clientId: id,
        tipo: "servicio_renovado",
        compraId: compraEvento,
        servicioIndex: ix,
        descripcion: `Renovación confirmada desde Panel de Socios: ${fechaAnterior || "-"} → ${fechaFinal}`,
        plataforma: svc.plataforma || svc.servicio || svc.nombre || "Servicio",
        fechaAnterior,
        fechaRenovacion: fechaFinal,
        meses: Math.max(1, Number(meses) || 1),
        vendedor,
        procesadoPor: socioNorm || "panel_socios",
        origen: "Panel de socios",
        sorteoOk: sorteo?.ok !== false,
        boletosCreados: Math.max(0, Number(sorteo?.creados) || 0),
        fechaTS: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("historial renovación panel", error?.message || error);
    }
  }
  return {
    actualizado: true,
    clienteId: id,
    servicioIndex: ix,
    campo,
    fechaAnterior,
    nuevaFecha: fechaFinal,
    compraId: compraEvento,
    vendedor,
    servicio: svc.plataforma || svc.servicio || svc.nombre || svc.cuenta || "Servicio",
    precioCliente: revMoneyNumber(svc.precioCliente ?? svc.precioVenta ?? svc.precio ?? svc.monto ?? 0),
    sorteo,
  };
}

async function revVerificarRenovacionesCliente(clienteId, renovaciones = []) {
  const id = String(clienteId || "").trim();
  if (!id || !renovaciones.length) return { ok: false, error: "sin_renovaciones" };
  const snap = await db.collection("clientes").doc(id).get();
  if (!snap.exists) return { ok: false, error: "cliente_no_existe" };
  const c = snap.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const detalle = renovaciones.map((r) => {
    const compraId = String(r?.compraId || "").trim();
    const ix = compraId ? servicios.findIndex((x) => String(x?.compraId || "").trim() === compraId) : Number(r?.servicioIndex);
    const svc = ix >= 0 ? servicios[ix] || {} : {};
    const campo = revCampoFechaServicio(svc);
    const fecha = String(svc[campo] || svc.fechaRenovacion || svc.vencimiento || svc.vence || svc.fechaFin || "").trim();
    return { compraId, servicioIndex: ix, esperada: String(r?.nuevaFecha || ""), guardada: fecha, ok: ix >= 0 && fecha === String(r?.nuevaFecha || "") };
  });
  return { ok: detalle.every((x) => x.ok), detalle };
}

// ── LOGIN (revendedor o admin) ── handler compartido: ver index_09_api_auth.js
app.post("/rev/login", revLoginIpLimiter, createRevLoginHandler({ db, bot, SUPER_ADMIN }));

// Devuelve permisos/configuración vigentes aunque el JWT se haya emitido antes
// de un cambio hecho desde Sublichat.
app.get("/rev/me", revAuth, async (req, res) => {
  try {
    const live = await revLiveProfile(req.rev, 0);
    res.json({
      id: live.id || req.rev.id || "",
      nombre: live.nombre || req.rev.nombre || "",
      nombre_norm: live.nombre_norm || req.rev.nombre_norm || "",
      nombreMostrar: live.nombreMostrar || "",
      capabilities: live.capabilities,
      permisos: live.capabilities,
      soloCatalogo: live.soloCatalogo,
      sinCompras: live.sinCompras,
      tarifaId: live.tarifaId,
      priceTier: live.tarifaId,
      etiquetaRenovacion: live.etiquetaRenovacion || "",
    });
  } catch (e) {
    console.error("rev/me", e);
    res.status(500).json({ error: "server" });
  }
});

// ── CLIENTES del revendedor ──
// Caché corto del escaneo de clientes. Los campos vendedores_norm / vendedor_norm
// son índices de conveniencia, pero la fuente autoritativa sigue siendo servicios[].
// Esto evita que un cliente desaparezca del Panel de Socios cuando el resumen
// superior quedó viejo (caso típico: Telegram sí avisa la renovación, pero el panel
// no la muestra). El escaneo se comparte 30 s entre socios para no multiplicar lecturas.
let _revClientesScanCache = { at: 0, docs: [] };
async function revAllClientDocsCached(maxAgeMs = 30000) {
  const now = Date.now();
  if (_revClientesScanCache.docs.length && now - _revClientesScanCache.at < maxAgeMs) return _revClientesScanCache.docs;
  const snap = await db.collection("clientes").get();
  const docs = snap.docs.slice();
  _revClientesScanCache = { at: now, docs };
  return docs;
}
function revSocioAliases(live = {}, tokenRev = {}) {
  const values = [
    live.nombre_norm, live.nombre, live.usuario, live.username, live.id,
    tokenRev.nombre_norm, tokenRev.nombre, tokenRev.usuario, tokenRev.username, tokenRev.id,
    ...(Array.isArray(live.aliases) ? live.aliases : []),
  ];
  const out = new Set();
  values.forEach((v) => {
    const n = revNormKey(v);
    if (n) out.add(n);
  });
  if (out.has("geisell")) out.add("geissel");
  if (out.has("geissel")) out.add("geisell");
  return [...out];
}
function revFiltrarClientePorAliases(cliente = {}, aliases = []) {
  for (const alias of aliases) {
    const visible = filtrarClienteParaVendedor(cliente, alias);
    if (Array.isArray(visible.servicios) && visible.servicios.length) return visible;
  }
  return { ...cliente, servicios: [] };
}

// El Panel de Socios no necesita recibir credenciales internas del cliente.
// Se construye un DTO mínimo para reducir exposición de correo, clave, PIN,
// URL IPTV, tokens u otros campos que puedan existir en Firestore.
function revClientePublicoPanel(id, cliente = {}) {
  const nombre = String(cliente.nombrePerfil || cliente.nombre || cliente.nombre_norm || "Cliente").trim().slice(0, 180);
  const telefono = String(cliente.telefono || cliente.telefono_norm || "").trim().slice(0, 40);
  const servicios = (Array.isArray(cliente.servicios) ? cliente.servicios : []).map((s = {}, index) => {
    const servicio = String(s.plataforma || s.servicio || s.nombre || "Servicio").trim().slice(0, 160);
    const fecha = s.fechaRenovacion ?? s.vencimiento ?? s.vence ?? s.fechaFin ?? null;
    const precioRaw = s.precio;
    const precioNum = precioRaw == null || String(precioRaw).trim() === "" ? NaN : Number(precioRaw);
    const original = Number(s.servicioIndexOriginal ?? s._servicioIndexOriginal ?? index);
    return {
      servicio,
      fechaRenovacion: fecha,
      precio: Number.isFinite(precioNum) ? precioNum : null,
      compraId: String(s.compraId || "").slice(0, 180),
      servicioIndexOriginal: Number.isInteger(original) ? original : index,
      _servicioIndexOriginal: Number.isInteger(original) ? original : index,
    };
  });
  return {
    id: String(id || cliente.id || "").slice(0, 180),
    nombre,
    nombrePerfil: nombre,
    nombre_norm: String(cliente.nombre_norm || "").trim().slice(0, 180),
    telefono,
    telefono_norm: String(cliente.telefono_norm || telefono).trim().slice(0, 40),
    servicios,
  };
}
async function revRepairClientVendorSummary(doc, data) {
  try {
    const servicios = heredarVendedorServicios(Array.isArray(data.servicios) ? data.servicios : [], data);
    const resumen = camposResumenVendedores(servicios, data);
    const oldNorm = Array.isArray(data.vendedores_norm) ? data.vendedores_norm.map(revNormKey).filter(Boolean).sort() : [];
    const newNorm = Array.isArray(resumen.vendedores_norm) ? resumen.vendedores_norm.map(revNormKey).filter(Boolean).sort() : [];
    if (JSON.stringify(oldNorm) === JSON.stringify(newNorm) && revNormKey(data.vendedor_norm) === revNormKey(resumen.vendedor_norm)) return;
    await doc.ref.set({ ...resumen, servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error("revRepairClientVendorSummary", doc.id, e?.message || e);
  }
}

app.get("/rev/clientes", revAuth, async (req, res) => {
  try {
    const live = await revLiveProfile(req.rev);
    if (!revCap(live, "canViewClients", true)) return res.status(403).json({ error: "sin_permiso_clientes" });
    const aliases = revSocioAliases(live, req.rev);
    const vendedorNorm = aliases[0] || revNormKey(req.rev.nombre_norm || req.rev.nombre || "");
    if (!vendedorNorm) return res.json([]);

    // 1) Índices rápidos para la mayoría de los clientes.
    const consultas = await Promise.allSettled(aliases.flatMap(alias => [
      db.collection("clientes").where("vendedores_norm", "array-contains", alias).get(),
      db.collection("clientes").where("vendedor_norm", "==", alias).get(),
    ]));
    const docs = new Map();
    consultas.forEach((resultado) => {
      if (resultado.status !== "fulfilled") return;
      resultado.value.docs.forEach((d) => docs.set(d.id, d));
    });

    // 2) Verificación autoritativa por servicios[]. Se ejecuta para TODOS los socios,
    // no solo Geisell. Así Jimena, Relojes, Yami, etc. ven exactamente las mismas
    // renovaciones que el bot detecta al recorrer servicios[].
    const allDocs = await revAllClientDocsCached();
    const reparaciones = [];
    allDocs.forEach((d) => {
      if (docs.has(d.id)) return;
      const raw = d.data() || {};
      const visible = revFiltrarClientePorAliases(raw, aliases);
      if (!visible.servicios.length) return;
      docs.set(d.id, d);
      if (reparaciones.length < 25) reparaciones.push(revRepairClientVendorSummary(d, raw));
    });
    if (reparaciones.length) Promise.allSettled(reparaciones).catch(() => {});

    const lista = Array.from(docs.values())
      .map((d) => revClientePublicoPanel(d.id, revFiltrarClientePorAliases(d.data() || {}, aliases)))
      .filter((cliente) => cliente.servicios.length > 0);
    res.set("Cache-Control", "no-store");
    res.json(lista);
  } catch (e) { console.error("rev/clientes", e); res.status(500).json({ error: "server" }); }
});

// ── PRECIOS ──
// ✅ FIX (v1): antes leía "inventario" (cuentas/capacidad), que no tiene
// campo de precio.
// ✅ FIX (v2): el catálogo real que ya usa este panel — el que ve el socio
// en "Catálogo mayorista" y el que arma el formulario "Nueva compra" — está
// agrupado por categoría con variantes por ítem, no 1 precio por
// plataforma. Ahora lee la colección "precios" (1 doc = 1 ítem, la
// administra Sublichat en /rev/admin/precios, ver index_12_admin_panel.js)
// y la reagrupa en el MISMO formato {cat, sub, items:[{n,s,p,d}]} que ya
// esperan compraProductosCatalogo()/vPrecios() en index.html — así no hace
// falta tocarles la lógica, solo cambiarles la fuente de datos.
app.get("/rev/precios", revAuth, async (req, res) => {
  try {
    // El catálogo se administra desde Sublichat y debe reflejarse de inmediato
    // en los paneles ya abiertos. Nunca permitir una copia HTTP intermedia.
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    const live = await revLiveProfile(req.rev);
    const catalogo = await obtenerCatalogoSocio(db, live);
    res.set("X-Catalogo-Tarifa", catalogo.tarifaId);
    res.json(catalogo.grupos);
  } catch (e) { console.error("rev/precios", e); res.status(500).json({ error: "server" }); }
});

// ── INVENTARIO REAL DEL CATÁLOGO ──
// Combina la bodega real (colección inventario) con un override manual que
// puede configurarse por ítem desde Sublichat.
app.get("/rev/inventario", revAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const live = await revLiveProfile(req.rev);
    const [catalogo, invSnap] = await Promise.all([
      obtenerCatalogoSocio(db, live),
      db.collection("inventario").get(),
    ]);
    const agregados = new Map();
    invSnap.docs.forEach((doc) => {
      const d = doc.data() || {};
      const key = revCanonInventory(d.plataforma || d.servicio || d.tipo || "");
      if (!key) return;
      const estado = String(d.estado || "activa").trim().toLowerCase();
      const cap = Math.max(0, revMoneyNumber(d.capacidad));
      const ocupados = Math.max(0, revMoneyNumber(d.ocupados));
      let disponibles = d.disponibles == null || d.disponibles === "" ? Math.max(0, cap - ocupados) : Math.max(0, revMoneyNumber(d.disponibles));
      if (["inactiva", "inactivo", "suspendida", "suspendido", "bloqueada", "bloqueado"].includes(estado)) disponibles = 0;
      const prev = agregados.get(key) || { docs: 0, disponibles: 0, capacidad: 0, ocupados: 0 };
      prev.docs += 1; prev.disponibles += disponibles; prev.capacidad += cap; prev.ocupados += ocupados;
      agregados.set(key, prev);
    });

    const items = catalogoPlano(catalogo.grupos).map((item) => {
      const stockModo = String(item.stockModo || "auto").toLowerCase();
      const manualEstado = String(item.stockEstado || "").toLowerCase();
      const manualCantidad = item.stockCantidad == null ? null : Number(item.stockCantidad);
      if (stockModo === "manual") {
        let estado = ["disponible", "bajo", "agotado", "consultar"].includes(manualEstado) ? manualEstado : "consultar";
        if (!manualEstado && Number.isFinite(manualCantidad)) estado = manualCantidad <= 0 ? "agotado" : manualCantidad <= 2 ? "bajo" : "disponible";
        return { id:item.id, catalogId:item.id, nombre:item.nombreCompleto, estado, stock:Number.isFinite(manualCantidad)?manualCantidad:null, origen:"manual" };
      }
      const keys = revCatalogInventoryKeys(item);
      let docs = 0, disponibles = 0, capacidad = 0, ocupados = 0, plataforma = "";
      for (const key of keys) {
        const row = agregados.get(key);
        if (!row) continue;
        if (!plataforma) plataforma = key;
        docs += row.docs; disponibles += row.disponibles; capacidad += row.capacidad; ocupados += row.ocupados;
      }
      if (!docs) return { id:item.id, catalogId:item.id, nombre:item.nombreCompleto, estado:"consultar", stock:null, origen:"sin_bodega" };
      const estado = disponibles <= 0 ? "agotado" : disponibles <= 2 ? "bajo" : "disponible";
      return { id:item.id, catalogId:item.id, nombre:item.nombreCompleto, estado, stock:disponibles, capacidad, ocupados, plataforma, origen:"bodega" };
    });
    res.json({ ok:true, tarifaId:catalogo.tarifaId, items, updatedAt:Date.now() });
  } catch (e) {
    console.error("rev/inventario", e);
    res.status(500).json({ error:"server" });
  }
});

// ── MÉTRICAS DEL SOCIO ──
app.get("/rev/metricas", revAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const live = await revLiveProfile(req.rev);
    const socioNorm = revNormKey(live.nombre_norm || live.nombre || "");
    const aliases = socioNorm === "geisell" ? ["geisell", "geissel"] : [socioNorm];
    const [compraSnaps, renovSnaps] = await Promise.all([
      Promise.all(aliases.map((a) => db.collection("compras").where("socio_norm", "==", a).get())),
      Promise.all(aliases.map((a) => db.collection("renovaciones").where("socio_norm", "==", a).get())),
    ]);
    const dedupe = (snaps) => { const m=new Map(); snaps.forEach(snap=>snap.docs.forEach(d=>m.set(d.id,{id:d.id,...d.data()}))); return [...m.values()]; };
    const compras = dedupe(compraSnaps), renovaciones = dedupe(renovSnaps);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const end = new Date(now.getFullYear(), now.getMonth()+1, 1).getTime();
    const enMes = (x) => { const t=revDateMs(x.createdAt || x.fecha || x.ts); return t>=start && t<end; };
    const ops = [
      ...compras.filter(enMes).map(x=>({...x,_tipo:"compra"})),
      ...renovaciones.filter(enMes).map(x=>({...x,_tipo:"renovacion"})),
    ];
    const costoMes = ops.reduce((a,x)=>a+Math.max(0,revMoneyNumber(x.monto)),0);
    const counts = new Map();
    ops.forEach(x=>{const k=String(x.servicio||"Servicio").trim()||"Servicio";counts.set(k,(counts.get(k)||0)+1)});
    const topServicio = [...counts.entries()].sort((a,b)=>b[1]-a[1])[0] || null;
    const pendientes = compras.filter(x=>!["entregado","completado","cancelado"].includes(String(x.estado||"pendiente").toLowerCase())).length;
    res.json({
      ok:true,
      periodo:`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`,
      operacionesMes:ops.length, comprasMes:ops.filter(x=>x._tipo==="compra").length, renovacionesMes:ops.filter(x=>x._tipo==="renovacion").length,
      costoMes, operadoMes:costoMes,
      pedidosPendientes:pendientes,
      topServicio:topServicio?{nombre:topServicio[0],operaciones:topServicio[1]}:null,
    });
  } catch (e) {
    console.error("rev/metricas", e);
    res.status(500).json({ error:"server" });
  }
});

// ── MIS PEDIDOS / SEGUIMIENTO ──
app.get("/rev/compras/mias", revAuth, async (req, res) => {
  try {
    const live = await revLiveProfile(req.rev);
    if (!revCap(live, "canBuy", true)) return res.json({ ok:true, items:[] });
    const socioNorm = revNormKey(live.nombre_norm || live.nombre || "");
    const aliases = socioNorm === "geisell" ? ["geisell", "geissel"] : [socioNorm];
    const snaps = await Promise.all(aliases.map(a=>db.collection("compras").where("socio_norm","==",a).get()));
    const m=new Map();snaps.forEach(snap=>snap.docs.forEach(d=>m.set(d.id,{id:d.id,...d.data()})));
    const limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
    const items=[...m.values()].sort((a,b)=>revDateMs(b.createdAt)-revDateMs(a.createdAt)).slice(0,limit).map(x=>({
      id:x.id, servicio:x.servicio||"Compra", estado:x.estado||"pendiente", detalleEstado:x.detalleEstado||"", destino:x.destino||"", destinoLabel:x.destinoLabel||"",
      monto:revMoneyNumber(x.monto),
      createdAt:x.createdAt, estadoUpdatedAt:x.estadoUpdatedAt||x.updatedAt||x.createdAt, estadoHistorial:Array.isArray(x.estadoHistorial)?x.estadoHistorial.slice(-10):[],
    }));
    res.json({ok:true,items});
  } catch(e){console.error("rev/compras/mias",e);res.status(500).json({error:"server"})}
});

// ── AVISOS — buzón publicado desde Telegram (/aviso) ──
app.get("/rev/avisos", revAuth, async (req, res) => {
  try {
    // ✅ Sin where+orderBy combinado (evita necesitar índice compuesto en Firestore)
    const snap = await db.collection("avisos").orderBy("createdAt", "desc").limit(20).get();
    const live = await revLiveProfile(req.rev);
    const socioAliases = new Set(revSocioAliases(live, req.rev).map(revNormKey));
    const lista = snap.docs
      .map((d) => {
        const a = d.data();
        const ts = a.createdAt?._seconds ? a.createdAt._seconds * 1000 :
                   a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.now();
        return { id: d.id, texto: a.texto || "", autor: a.autor || "Admin", ts, activo: a.activo !== false, tipo:a.tipo||"aviso", imagenUrl:a.imagenUrl||"", promocionId:a.promocionId||"", destinatarios:Array.isArray(a.destinatarios)?a.destinatarios:[] };
      })
      .filter((a) => a.activo && (!a.destinatarios.length || a.destinatarios.map(revNormKey).some((x) => socioAliases.has(x))))
      .slice(0, 10);
    res.json(lista);
  } catch (e) { console.error("rev/avisos", e); res.status(500).json({ error: "server" }); }
});

// ── SUGERENCIAS — buzón del revendedor, llega directo al admin por Telegram ──
async function getAdminChatIds() {
  try {
    const snap = await db.collection("admins").get();
    const ids = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.activo !== false && /^\d+$/.test(String(d.id))) ids.push(String(d.id));
    });
    if (ids.length) return ids;
  } catch (_) {}
  return String(process.env.SUPER_ADMIN || "").split(",").map((s) => s.trim()).filter(Boolean);
}
async function sendTelegramMessage(chatId, text) {
  const token = String(process.env.BOT_TOKEN || "").trim();
  if (!token) {
    await enqueueTelegramJob({type:"message",chatId,text,parseMode:"Markdown",source:"panel-api"});
    return true;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    if (r.ok) return true;
    const raw=await r.text().catch(()=>"");
    if (r.status===401 || /unauthorized/i.test(raw)) {
      await enqueueTelegramJob({type:"message",chatId,text,parseMode:"Markdown",source:"panel-api-token-fallback"});
      return true;
    }
    console.error("sendTelegramMessage", r.status, raw);
    return false;
  } catch (e) {
    console.error("sendTelegramMessage", e.message);
    try { await enqueueTelegramJob({type:"message",chatId,text,parseMode:"Markdown",source:"panel-api-network-fallback"}); return true; } catch (_) { return false; }
  }
}

async function sendTelegramPhoto(chatId, photoUrl, caption) {
  const token = String(process.env.BOT_TOKEN || "").trim();
  if (!photoUrl) return false;
  if (!token) {
    await enqueueTelegramJob({type:"photo",chatId,photoUrl,text:caption,parseMode:"Markdown",source:"panel-api"});
    return true;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: "Markdown" }),
    });
    if (r.ok) return true;
    const raw=await r.text().catch(()=>r.statusText||"");
    if (r.status===401 || /unauthorized/i.test(raw)) {
      await enqueueTelegramJob({type:"photo",chatId,photoUrl,text:caption,parseMode:"Markdown",source:"panel-api-token-fallback"});
      return true;
    }
    console.error("sendTelegramPhoto",r.status,raw);
    return false;
  } catch (e) { console.error("sendTelegramPhoto", e.message); return false; }
}

async function sendTelegramPhotoBuffer(chatId, imageObj, caption) {
  const token = process.env.BOT_TOKEN;
  if (!token || !imageObj?.buffer) return false;
  try {
    if (typeof FormData !== "function" || typeof Blob !== "function") return false;
    const fd = new FormData();
    fd.append("chat_id", String(chatId));
    fd.append("caption", caption || "");
    fd.append("parse_mode", "Markdown");
    fd.append("photo", new Blob([imageObj.buffer], { type: imageObj.contentType || "image/jpeg" }), imageObj.filename || "comprobante.jpg");
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: fd });
    if (r.ok) return true;
    const raw=await r.text().catch(()=>r.statusText||"");
    if (r.status===401 || /unauthorized/i.test(raw)) {
      await enqueueTelegramJob({type:"message",chatId,text:caption,parseMode:"Markdown",source:"panel-api-buffer-token-fallback"});
      return true;
    }
    console.error("sendTelegramPhotoBuffer",r.status,raw);
    return false;
  } catch (e) { console.error("sendTelegramPhotoBuffer", e.message); return false; }
}

async function sendTelegramImageSmart(chatId, imageObj, caption) {
  if (imageObj?.url && await sendTelegramPhoto(chatId, imageObj.url, caption)) return true;
  if (imageObj?.buffer && await sendTelegramPhotoBuffer(chatId, imageObj, caption)) return true;
  await sendTelegramMessage(chatId, caption);
  return false;
}

function cleanTg(v, max = 300) {
  return (v == null ? "" : String(v)).replace(/[\*_`\[\]]/g, "").trim().slice(0, max);
}
function destinoInfo(destinoRaw) {
  const destino = revNormKey(String(destinoRaw || "sublicuentas")).replace(/^geissel$/, "geisell");
  const destinos = {
    relojes: { key: "relojes", label: "⌚ Relojes", env: "RELOJES_CHAT_ID" },
    sublicuentas: { key: "sublicuentas", label: "🟣 Sublicuentas", env: "SUBLICUENTAS_CHAT_ID" },
    geisell: { key: "geisell", label: "👤 Geisell", env: "GEISELL_CHAT_ID" },
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
  const envIds = String(process.env[info.env] || "").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  if (envIds.length) return [envIds[0]]; // destinatario específico: nunca abanicar un comprobante a varios chats
  if (info.key === "sublicuentas") {
    const superIds = String(process.env.SUPER_ADMIN || "").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
    if (superIds.length) return [superIds[0]];
  }
  // Respaldo sin IDs incrustados en el código: busca la configuración viva.
  try {
    const revSnap = await db.collection("revendedores").where("nombre_norm", "==", info.key).limit(1).get();
    if (!revSnap.empty) {
      const tg = String(revSnap.docs[0].data()?.telegramId || "").trim();
      if (/^\d+$/.test(tg)) return [tg];
    }
    const admins = await db.collection("admins").get();
    for (const doc of admins.docs) {
      const a = doc.data() || {};
      const key = revNormKey(a.nombre_norm || a.nombre || a.usuario || "");
      const tg = String(a.telegramId || (/^\d+$/.test(doc.id) ? doc.id : "")).trim();
      if ((info.key === "sublicuentas" || key === info.key) && a.activo !== false && /^\d+$/.test(tg)) return [tg];
    }
  } catch (e) {
    console.error("getDestinoChatIds", info.key, e?.message || e);
  }
  const err = new Error(`destino_sin_chat_id:${info.key}`);
  err.status = 503; err.publicError = "destino_sin_configurar";
  throw err;
}
function parsePanelImage(imagen) {
  if (!imagen) return null;
  const m = String(imagen).match(/^data:(image\/(?:jpe?g|png|webp));base64,(.+)$/);
  if (!m) return null;
  const contentType = m[1].replace("image/jpg", "image/jpeg");
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 7 * 1024 * 1024) {
    const err = new Error("imagen_muy_grande");
    err.status = 413;
    err.publicError = "imagen_muy_grande";
    throw err;
  }
  const ext = contentType.split("/")[1].replace("jpeg", "jpg");
  return { contentType, buffer, ext, filename: `comprobante_${Date.now()}.${ext}`, dataUri: String(imagen) };
}

async function uploadPanelImage(imagen, folder = "comprobantes") {
  const parsed = parsePanelImage(imagen);
  if (!parsed) return { url: "", buffer: null, contentType: "", filename: "", storageError: "" };

  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${parsed.ext}`;
  let lastError = null;
  for (const bucketName of STORAGE_BUCKET_CANDIDATES) {
    try {
      const file = admin.storage().bucket(bucketName).file(path);
      await file.save(parsed.buffer, {
        contentType: parsed.contentType,
        resumable: false,
        metadata: { cacheControl: "public,max-age=31536000" },
      });
      const [url] = await file.getSignedUrl({ action: "read", expires: "2099-12-31" });
      return { ...parsed, url, bucketName, storageError: "" };
    } catch (e) {
      lastError = e;
      console.error("uploadPanelImage bucket fail", bucketName, e.message);
    }
  }

  // No botamos la compra/renovación si Storage falla: se manda la foto directo a Telegram.
  return { ...parsed, url: "", bucketName: "", storageError: lastError ? lastError.message : "storage_no_configurado" };
}

// ── Comprobante de renovación: sube la foto + opcionalmente actualiza la fecha del servicio ──
app.post("/rev/renovacion", revAuth, async (req, res) => {
  try {
    const live = await revLiveProfile(req.rev);
    if (!revCap(live, "canRenew", true)) return res.status(403).json({ error: "sin_permiso_renovar" });
    const { clienteId, cliente, servicio, comentario, quien, monto, imagen, servicioIndex, nuevaFecha, meses } = req.body;
    const destino = destinoInfo(req.body?.destino);
    const socio = live.nombre || live.nombre_norm || req.rev.nombre || req.rev.nombre_norm || "Revendedor";
    const com = (comentario || "").toString().trim().slice(0, 600);

    const seleccionRaw=Array.isArray(req.body.servicios)&&req.body.servicios.length?req.body.servicios:[{servicioIndex,servicio}];
    const seleccionEntrada=seleccionRaw.map(x=>({
      servicioIndex:Number(x.servicioIndex),
      compraId:String(x.compraId||"").trim().slice(0,160),
      servicio:String(x.servicio||"").slice(0,120)
    })).filter(x=>(x.compraId||Number.isInteger(x.servicioIndex))&&(x.compraId||x.servicioIndex>=0)).slice(0,30);
    if(!seleccionEntrada.length)return res.status(400).json({error:"sin_servicios"});
    const seleccion=await revResolverSeleccionCliente({clienteId,socioNorm:live.nombre_norm||req.rev.nombre_norm||"",seleccion:seleccionEntrada});
    const renovacionesFecha=[];
    if (nuevaFecha || meses) {
      for(const item of seleccion) renovacionesFecha.push(await revActualizarFechaCliente({clienteId,socioNorm:live.nombre_norm||req.rev.nombre_norm||"",servicioIndex:item.servicioIndex,compraId:item.compraId,nuevaFecha,meses}));
    }
    const renovacionFecha=renovacionesFecha[0]||null;
    const verificacion = renovacionesFecha.length ? await revVerificarRenovacionesCliente(clienteId, renovacionesFecha) : { ok:true, detalle:[] };
    if (renovacionesFecha.length && !verificacion.ok) {
      const err = new Error("renovacion_no_confirmada_en_ficha");
      err.status = 409; err.publicError = "renovacion_no_confirmada";
      throw err;
    }

    const imagenObj = await uploadPanelImage(imagen, "renovaciones");
    const imagenUrl = imagenObj.url || "";

    const doc = {
      clienteId: (clienteId || "").toString(),
      cliente: (cliente || "").toString().slice(0, 120),
      servicio: seleccion.length>1?`${seleccion.length} servicios`:(renovacionFecha?.servicio || seleccion[0]?.servicio || servicio || "").toString().slice(0, 120),
      servicioIndex: seleccion.length===1?seleccion[0].servicioIndex:null,
      servicios: seleccion.map((x,i)=>({
        servicioIndex:x.servicioIndex,
        compraId:renovacionesFecha[i]?.compraId||x.compraId||"",
        servicio:renovacionesFecha[i]?.servicio||x.servicio,
        vendedor:renovacionesFecha[i]?.vendedor||live.nombre_norm||req.rev.nombre_norm||"",
        fechaAnterior:renovacionesFecha[i]?.fechaAnterior||"",
        nuevaFecha:renovacionesFecha[i]?.nuevaFecha||String(nuevaFecha||""),
        meses:Math.max(1,Number(meses)||1),
        sorteoOk:renovacionesFecha[i]?.sorteo?.ok!==false,
        boletosCreados:Math.max(0,Number(renovacionesFecha[i]?.sorteo?.creados)||0)
      })),
      comentario: com,
      quien: (quien || "").toString().slice(0, 120),
      monto: revMoneyNumber(monto),
      socio,
      socio_norm: live.nombre_norm || req.rev.nombre_norm || "",
      destino: destino.key,
      destinoLabel: destino.label,
      imagenUrl,
      // Si Storage falla, Telegram recibe la foto por buffer; para que Panel Dios también la vea,
      // guardamos una copia liviana en Firestore cuando no hay URL pública.
      imagenData: imagenUrl ? "" : (imagenObj.dataUri && imagenObj.dataUri.length < 850000 ? imagenObj.dataUri : ""),
      imagenStorageError: imagenObj.storageError || "",
      fechaAnterior: renovacionFecha?.fechaAnterior || "",
      nuevaFecha: renovacionFecha?.nuevaFecha || (nuevaFecha || "").toString().slice(0, 20),
      renovado: renovacionesFecha.length>0,
      renovadosCantidad: renovacionesFecha.length,
      operacionDiaKey: `${revNormKey(live.nombre_norm||req.rev.nombre_norm||"")}:${String(clienteId||"").trim()}:${revFechaDMY(new Date())}`,
      verificacionFicha: verificacion.ok === true,
      boletosCreados: renovacionesFecha.reduce((sum,item)=>sum+Math.max(0,Number(item?.sorteo?.creados)||0),0),
      createdAt: new Date(),
    };
    const ref = await db.collection("renovaciones").add(doc);

    const cap = [
      `🧾 *RENOVACIÓN RECIBIDA*`,
      `━━━━━━━━━━━━━━`,
      `👤 Socio: ${cleanTg(socio, 80)}`,
      `📍 Pago para: ${destino.label}`,
      `🙍 Cliente: ${cleanTg(doc.cliente || "—", 120)}`,
      `📦 Servicios: ${doc.servicios.map(x=>x.servicio||('Servicio '+(x.servicioIndex+1))).join(', ')}`,
      doc.renovado ? `📅 Nueva fecha: ${cleanTg(doc.nuevaFecha || "—", 30)} · ${doc.renovadosCantidad} renovado(s)` : "",
      doc.monto ? `💵 Monto pagado: Lps. ${doc.monto}` : "",
      doc.quien ? `🔁 Renovó: ${cleanTg(doc.quien, 80)}` : "",
      com ? `📝 Nota: ${cleanTg(com, 260)}` : "",
      (imagenUrl || imagenObj.buffer) ? `📎 Comprobante adjunto` : `⚠️ Sin comprobante`,
      `🆔 Ref: ${ref.id.slice(-6)}`,
    ].filter(Boolean).join("\n");
    const ids = await getDestinoChatIds(destino.key);
    await Promise.all(ids.map((id) => sendTelegramImageSmart(id, imagenObj, cap)));

    res.json({ ok: true, id: ref.id, imagenUrl, renovado: doc.renovado, renovadosCantidad:doc.renovadosCantidad, nuevaFecha: doc.nuevaFecha, destino: destino.key, destinoLabel: destino.label, verificacionFicha: verificacion.ok === true, operacionDiaKey: doc.operacionDiaKey });
  } catch (e) {
    console.error("rev/renovacion", e);
    res.status(e.status || 500).json({ error: e.publicError || "server", detail: e.message });
  }
});

// ── Renovación directa sin foto: actualiza fecha del servicio del cliente ──
app.post("/rev/renovar-cliente", revAuth, async (req, res) => {
  try {
    const live = await revLiveProfile(req.rev);
    if (!revCap(live, "canRenew", true)) return res.status(403).json({ error: "sin_permiso_renovar" });
    const r = await revActualizarFechaCliente({
      clienteId: req.body.clienteId,
      socioNorm: live.nombre_norm || req.rev.nombre_norm || "",
      servicioIndex: req.body.servicioIndex,
      compraId: req.body.compraId,
      nuevaFecha: req.body.nuevaFecha,
      meses: req.body.meses,
    });
    const verificacion = await revVerificarRenovacionesCliente(req.body.clienteId, [r]);
    if (!verificacion.ok) {
      const err = new Error("renovacion_no_confirmada_en_ficha"); err.status = 409; err.publicError = "renovacion_no_confirmada"; throw err;
    }
    await db.collection("renovaciones").add({
      clienteId: (req.body.clienteId || "").toString(),
      cliente: (req.body.cliente || "").toString().slice(0, 120),
      servicio: r.servicio,
      servicioIndex: r.servicioIndex,
      compraId: r.compraId || "",
      comentario: (req.body.comentario || "Renovación directa desde panel").toString().slice(0, 600),
      quien: (req.body.quien || "Panel socio").toString().slice(0, 120),
      monto: revMoneyNumber(req.body.monto),
      socio: live.nombre || live.nombre_norm || req.rev.nombre || req.rev.nombre_norm || "Revendedor",
      socio_norm: live.nombre_norm || req.rev.nombre_norm || "",
      imagenUrl: "",
      fechaAnterior: r.fechaAnterior || "",
      nuevaFecha: r.nuevaFecha || "",
      renovado: true,
      renovadosCantidad: 1,
      meses: Math.max(1, Number(req.body.meses) || 1),
      sorteoOk: r.sorteo?.ok !== false,
      boletosCreados: Math.max(0, Number(r.sorteo?.creados) || 0),
      createdAt: new Date(),
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error("rev/renovar-cliente", e);
    res.status(e.status || 500).json({ error: e.publicError || "server", detail: e.message });
  }
});


// ── COMPRA NUEVA / COMBO: socio envía solicitud + comprobante; avisa a Telegram según destino ──
app.post("/rev/compra", revAuth, async (req, res) => {
  try {
    const live = await revLiveProfile(req.rev);
    if (!revCap(live, "canBuy", !esRevSoloCatalogo(req.rev))) return res.status(403).json({ error: "sin_permiso_comprar" });
    const b = req.body || {};
    const socio = live.nombre || live.nombre_norm || req.rev.nombre || req.rev.nombre_norm || "Revendedor";
    const destino = destinoInfo(b.destino);
    // El navegador nunca decide el precio final. Se vuelve a consultar la
    // tarifa del socio autenticado para impedir valores viejos o manipulados.
    const catalogoSocio = await obtenerCatalogoSocio(db, live);

    const productosRaw = Array.isArray(b.productos) && b.productos.length
      ? b.productos.slice(0, 20)
      : [{
          servicio: b.servicio,
          servicioBase: b.servicioBase,
          catalogCategory: b.catalogCategory,
          catalogSub: b.catalogSub,
          catalogDetalle: b.catalogDetalle,
          precioCatalogo: b.precioCatalogo,
          entregaTipo: b.entregaTipo,
          perfilNombre: b.perfilNombre,
          perfilApellido: b.perfilApellido,
          correo: b.correo,
          detalleServicio: b.detalleServicio,
          acceso: b.acceso,
          serial: b.serial,
          key: b.key,
          nombreCliente: b.nombreCliente,
          dispositivo: b.dispositivo,
          marcaTv: b.marcaTv,
        }];

    const productos = productosRaw.map((p) => {
      const productoCatalogo = buscarProductoCatalogo(catalogoSocio.grupos, p);
      if (!productoCatalogo) {
        const err = new Error("producto_fuera_catalogo");
        err.status = 400;
        err.publicError = "producto_fuera_catalogo";
        throw err;
      }
      const servicio = cleanTg(productoCatalogo.nombreCompleto || p.servicio || p.nombre || "", 140);
      const precioCatalogo = productoCatalogo.p == null ? null : Number(productoCatalogo.p);
      const perfilNombre = cleanTg(p.perfilNombre, 80);
      const perfilApellido = cleanTg(p.perfilApellido, 80);
      const correo = cleanTg(p.correo, 160);
      const detalleServicio = cleanTg(p.detalleServicio, 240);
      const acceso = cleanTg(p.acceso, 220);
      const serial = cleanTg(p.serial, 220);
      const key = cleanTg(p.key, 220);
      // ✅ NUEVO: nombre del cliente (para compras tipo "correo" — Gemini,
      // Canva, invitación al correo) y dispositivo (para Disney, HBO/Max,
      // Vix, Paramount, Crunchyroll y Prime Video).
      const nombreCliente = cleanTg(p.nombreCliente, 80);
      const DISP_LABEL = { tv: "📺 TV", celular: "📱 Celular", tablet: "📱 Tablet", computadora: "💻 Computadora" };
      const dispositivo = DISP_LABEL[String(p.dispositivo || "").toLowerCase()] || cleanTg(p.dispositivo, 40);
      const MARCA_LABEL={samsung:"Samsung",lg:"LG",tcl:"TCL",roku:"Roku TV"};
      const marcaTv=MARCA_LABEL[String(p.marcaTv||"").toLowerCase()]||cleanTg(p.marcaTv,80);
      return {
        id: cleanTg(productoCatalogo.id || p.catalogId || p.id, 90),
        catalogId: cleanTg(productoCatalogo.id || "", 90),
        servicio,
        servicioBase: cleanTg(productoCatalogo.n || p.servicioBase, 100),
        entregaTipo: cleanTg(productoCatalogo.entregaTipo || p.entregaTipo || "", 60),
        entregaCanal: cleanTg(productoCatalogo.entregaCanal || p.entregaCanal || "manual", 60),
        catalogCategory: cleanTg(productoCatalogo.categoria || p.catalogCategory || "", 120),
        catalogSub: cleanTg(productoCatalogo.s || p.catalogSub || "", 160),
        catalogDetalle: cleanTg(productoCatalogo.d || p.catalogDetalle || "", 500),
        precioCatalogo,
        perfilNombre,
        perfilApellido,
        perfil: `${perfilNombre} ${perfilApellido}`.trim(),
        correo,
        detalleServicio,
        acceso,
        serial,
        key,
        nombreCliente,
        dispositivo,
        marcaTv,
      };
    }).filter((p) => p.servicio);

    if (!productos.length) return res.status(400).json({ error: "falta_servicio" });

    const comentario = cleanTg(b.comentario, 700);
    const clienteNombre = cleanTg(b.clienteNombre, 80);
    const clienteApellido = cleanTg(b.clienteApellido, 80);
    const subtotalCatalogo = productos.reduce((a, p) => a + (p.precioCatalogo !== null ? Number(p.precioCatalogo || 0) : 0), 0);
    const conPrecio = productos.filter((p) => p.precioCatalogo !== null).length;
    const descuentoCombo = Math.min(Math.max(conPrecio - 1, 0), 4) * 10; // 2=10, 3=20, 4=30, 5+=40
    const totalCombo = Math.max(0, subtotalCatalogo - descuentoCombo);
    const monto = revMoneyNumber(b.monto) || totalCombo || 0;
    const servicio = productos.length > 1
      ? `Combo ${productos.length} plataformas`
      : productos[0].servicio;

    const imagenObj = await uploadPanelImage(b.imagen, "compras");
    const imagenUrl = imagenObj.url || "";

    const doc = {
      tipo: "compra",
      servicio,
      productos,
      comboCantidad: productos.length,
      subtotalCatalogo,
      descuentoCombo,
      totalCombo,
      entregaTipo: productos[0].entregaTipo || "",
      entregaCanal: productos[0].entregaCanal || "manual",
      catalogCategory: productos[0].catalogCategory || "",
      catalogSub: productos[0].catalogSub || "",
      catalogDetalle: productos[0].catalogDetalle || "",
      detalleServicio: productos[0].detalleServicio || "",
      precioCatalogo: productos[0].precioCatalogo,
      clienteNombre,
      clienteApellido,
      cliente: `${clienteNombre} ${clienteApellido}`.trim(),
      perfilNombre: productos[0].perfilNombre || "",
      perfilApellido: productos[0].perfilApellido || "",
      perfil: productos[0].perfil || "",
      correo: productos[0].correo || "",
      acceso: productos[0].acceso || "",
      serial: productos[0].serial || "",
      key: productos[0].key || "",
      nombreCliente: productos[0].nombreCliente || "",
      dispositivo: productos[0].dispositivo || "",
      marcaTv: productos[0].marcaTv || "",
      comentario,
      monto,
      destino: destino.key,
      destinoLabel: destino.label,
      socio,
      socio_norm: live.nombre_norm || req.rev.nombre_norm || "",
      tarifaId: catalogoSocio.tarifaId,
      imagenUrl,
      // Si Storage falla, Telegram recibe la foto por buffer; para que Panel Dios también la vea,
      // guardamos una copia liviana en Firestore cuando no hay URL pública.
      imagenData: imagenUrl ? "" : (imagenObj.dataUri && imagenObj.dataUri.length < 850000 ? imagenObj.dataUri : ""),
      imagenStorageError: imagenObj.storageError || "",
      estado: "pendiente",
      detalleEstado: "Pedido recibido",
      estadoHistorial: [{ estado: "pendiente", detalle: "Pedido recibido", at: new Date().toISOString(), por: "sistema" }],
      createdAt: new Date(),
      estadoUpdatedAt: new Date(),
    };
    const ref = await db.collection("compras").add(doc);

    const productoLineas = productos.flatMap((p, i) => {
      const precio = p.precioCatalogo === null ? "Por comisión" : `Lps. ${p.precioCatalogo}`;
      const datos = [];
      if (p.perfil) datos.push(`Perfil: ${p.perfil}`);
      if (p.dispositivo) datos.push(`Dispositivo: ${p.dispositivo}`);
      if (p.marcaTv) datos.push(`Marca / sistema TV: ${p.marcaTv}`);
      if (p.nombreCliente) datos.push(`Cliente: ${p.nombreCliente}`);
      if (p.correo) datos.push(`Correo: ${p.correo}`);
      if (p.detalleServicio) datos.push(`Detalle: ${p.detalleServicio}`);
      if (p.acceso) datos.push(`Acceso: ${p.acceso}`);
      if (p.serial) datos.push(`Serial: ${p.serial}`);
      if (p.key) datos.push(`Key: ${p.key}`);
      if (p.entregaCanal && p.entregaCanal !== "manual") {
        const canalLabel = { bot_tg:"Bot TG / código", inventario:"Inventario Sublichat", invitacion:"Invitación al correo", iptv:"TV Digital / IPTV" }[p.entregaCanal] || p.entregaCanal;
        datos.push(`Flujo: ${canalLabel}`);
      }
      if (!datos.length && p.entregaTipo) datos.push(`Entrega: ${p.entregaTipo}`);
      return [
        `${i + 1}) ${p.servicio} — ${precio}`,
        ...datos.slice(0, 4).map((x) => `   • ${cleanTg(x, 150)}`),
      ];
    });

    const capLineas = [
      productos.length > 1 ? `🛒 *COMPRA COMBO*` : `🛒 *COMPRA NUEVA*`,
      `━━━━━━━━━━━━━━`,
      `📍 Avisar: ${destino.label}`,
      `👤 Socio: ${cleanTg(socio, 80)}`,
      `📦 Productos:`,
      ...productoLineas,
      ``,
      productos.length > 1
        ? `💰 Subtotal: Lps. ${subtotalCatalogo}\n🏷️ Descuento combo: Lps. ${descuentoCombo}\n✅ Total sugerido: Lps. ${totalCombo}\n💵 Monto pagado: ${monto ? `Lps. ${monto}` : "—"}`
        : `💵 Monto pagado: ${monto ? `Lps. ${monto}` : "—"}${productos[0].precioCatalogo !== null ? ` | Catálogo: Lps. ${productos[0].precioCatalogo}` : ""}`,
      comentario ? `📝 Nota: ${cleanTg(comentario, 220)}` : "",
      (imagenUrl || imagenObj.buffer) ? `📎 Comprobante adjunto` : `⚠️ Sin comprobante`,
      `🆔 Ref: ${ref.id.slice(-6)}`,
    ].filter((x) => x !== "");
    const cap = capLineas.join("\n").slice(0, 950);

    const ids = await getDestinoChatIds(destino.key);
    await Promise.all(ids.map((id) => sendTelegramImageSmart(id, imagenObj, cap)));

    res.json({ ok: true, id: ref.id, imagenUrl, destino: destino.key, destinoLabel: destino.label, totalCombo, descuentoCombo, estado: "pendiente" });
  } catch (e) {
    console.error("rev/compra", e);
    res.status(e.status || 500).json({ error: e.publicError || "server", detail: e.message });
  }
});

app.post("/rev/sugerencia", revAuth, async (req, res) => {
  try {
    const live = await revLiveProfile(req.rev);
    if (!revCap(live, "buzon", true)) return res.status(403).json({ error: "sin_permiso_buzon" });
    const texto = (req.body.texto || "").toString().trim().slice(0, 1000);
    if (!texto) return res.status(400).json({ error: "falta_texto" });
    const nombre = req.rev.nombre || req.rev.nombre_norm || "Revendedor";

    const destino = (req.body.destino || "sublicuentas").toString().trim();
    const infoDestino = destinoInfo(destino);
    const quien = infoDestino.label;

    await db.collection("sugerencias").add({
      texto, nombre, nombre_norm: req.rev.nombre_norm || "",
      destino, createdAt: new Date(),
    });

    const aviso = `💬 *Nueva sugerencia* (${quien})\n👤 ${nombre}\n\n${texto}`;
    const ids = await getDestinoChatIds(destino);
    await sendTelegramMessage(ids[0], aviso);

    res.json({ ok: true });
  } catch (e) { console.error("rev/sugerencia", e); res.status(500).json({ error: "server" }); }
});
app.get("/rev/admin/revendedores", revAdminAuth, async (req, res) => {
  try {
    const [revSnap, cliSnap] = await Promise.all([
      db.collection("revendedores").get(),
      db.collection("clientes").get(),
    ]);
    const porVend = {};
    cliSnap.docs.forEach((d) => {
      const c = d.data();
      (Array.isArray(c.servicios) ? c.servicios : []).forEach((s) => {
        const key = vendedorEfectivoServicio(s, c).vendedor_norm;
        if (!key) return;
        if (!porVend[key]) porVend[key] = { clientesIds: new Set(), servicios: 0, vencidos: 0, porVencer: 0 };
        porVend[key].clientesIds.add(d.id);
        porVend[key].servicios++;
        const n = revDiasRest(revParseFecha(s.fechaRenovacion || s.vencimiento || s.fechaFin));
        if (n != null) { if (n < 0) porVend[key].vencidos++; else if (n <= 5) porVend[key].porVencer++; }
      });
    });
    // "Geissel" fue un alias histórico de "Geisell". Se muestra una sola
    // cuenta y se le asignan también los clientes guardados con el alias.
    const cuentas = new Map();
    revSnap.docs.forEach((d) => {
      const r = d.data() || {};
      const rawKey = normVendedor(r.nombre_norm || r.nombre || d.id);
      const k = rawKey === "geissel" ? "geisell" : rawKey;
      const stats = porVend[k] || { clientesIds: new Set(), servicios: 0, vencidos: 0, porVencer: 0 };
      const capabilities = capacidadesRevendedor({ id: d.id, ...r, nombre_norm: k });
      const item = {
        id: d.id,
        nombre: k === "geisell" ? "Geisell" : (r.nombre || d.id),
        nombre_norm: k,
        nombreMostrar: r.nombreMostrar || "",
        activo: r.activo !== false,
        soloCatalogo: !capabilities.canBuy,
        sinCompras: !capabilities.canBuy,
        capabilities,
        permisos: capabilities,
        telegramId: r.telegramId || "",
        telefono: r.telefono || "",
        tarifaId: r.tarifaId || "general",
        etiquetaRenovacion: r.etiquetaRenovacion || "",
        clientes: stats.clientesIds.size,
        servicios: stats.servicios,
        vencidos: stats.vencidos,
        porVencer: stats.porVencer,
        _rawKey: rawKey,
      };
      const anterior = cuentas.get(k);
      // Si coexistieran ambos documentos, conservar el que ya está escrito
      // correctamente como Geisell; si no, el alias sigue funcionando.
      if (!anterior || (rawKey === "geisell" && anterior._rawKey !== "geisell")) cuentas.set(k, item);
    });
    const lista = Array.from(cuentas.values())
      .map(({ _rawKey, ...item }) => item)
      .sort((a, b) => b.clientes - a.clientes);
    res.json(lista);
  } catch (e) { console.error("rev/admin", e); res.status(500).json({ error: "server" }); }
});

// ── ADMIN: historial de comprobantes con foto para Panel Dios ──
app.get("/rev/admin/comprobantes", revAdminAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 120, 300);
    const snap = await db.collection("renovaciones").orderBy("createdAt", "desc").limit(limit).get();
    const lista = snap.docs.map((d) => {
      const r = d.data() || {};
      const ts = r.createdAt?._seconds ? r.createdAt._seconds * 1000 :
                 r.createdAt?.seconds ? r.createdAt.seconds * 1000 :
                 r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now();
      return {
        id: d.id,
        clienteId: r.clienteId || "",
        cliente: r.cliente || "",
        servicio: r.servicio || "",
        comentario: r.comentario || "",
        quien: r.quien || "",
        monto: Number(r.monto) || 0,
        socio: r.socio || "",
        socio_norm: r.socio_norm || "",
        imagenUrl: r.imagenUrl || r.imagenData || "",
        renovado: !!r.renovado,
        fechaAnterior: r.fechaAnterior || "",
        nuevaFecha: r.nuevaFecha || "",
        ts,
      };
    });
    res.json(lista);
  } catch (e) { console.error("rev/admin/comprobantes", e); res.status(500).json({ error: "server" }); }
});


// ── ADMIN: historial de compras nuevas con comprobante para Panel Dios ──
app.get("/rev/admin/compras", revAdminAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 120, 300);
    const snap = await db.collection("compras").orderBy("createdAt", "desc").limit(limit).get();
    const lista = snap.docs.map((d) => {
      const r = d.data() || {};
      const ts = r.createdAt?._seconds ? r.createdAt._seconds * 1000 :
                 r.createdAt?.seconds ? r.createdAt.seconds * 1000 :
                 r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now();
      return {
        id: d.id,
        servicio: r.servicio || "",
        productos: Array.isArray(r.productos) ? r.productos : [],
        comboCantidad: Number(r.comboCantidad) || (Array.isArray(r.productos) ? r.productos.length : 1),
        subtotalCatalogo: Number(r.subtotalCatalogo) || 0,
        descuentoCombo: Number(r.descuentoCombo) || 0,
        totalCombo: Number(r.totalCombo) || 0,
        entregaTipo: r.entregaTipo || "",
        catalogCategory: r.catalogCategory || "",
        catalogSub: r.catalogSub || "",
        catalogDetalle: r.catalogDetalle || "",
        detalleServicio: r.detalleServicio || "",
        precioCatalogo: r.precioCatalogo === null || r.precioCatalogo === undefined ? null : Number(r.precioCatalogo) || 0,
        cliente: r.cliente || `${r.clienteNombre || ""} ${r.clienteApellido || ""}`.trim(),
        perfil: r.perfil || `${r.perfilNombre || ""} ${r.perfilApellido || ""}`.trim(),
        correo: r.correo || "",
        acceso: r.acceso || "",
        serial: r.serial || "",
        key: r.key || "",
        comentario: r.comentario || "",
        monto: revMoneyNumber(r.monto),
        destino: r.destino || "sublicuentas",
        destinoLabel: r.destinoLabel || destinoInfo(r.destino).label,
        socio: r.socio || "",
        socio_norm: r.socio_norm || "",
        imagenUrl: r.imagenUrl || r.imagenData || "",
        estado: r.estado || "pendiente",
        detalleEstado: r.detalleEstado || "",
        estadoUpdatedAt: r.estadoUpdatedAt || r.updatedAt || r.createdAt || "",
        estadoHistorial: Array.isArray(r.estadoHistorial) ? r.estadoHistorial.slice(-15) : [],
        ts,
      };
    });
    res.json(lista);
  } catch (e) { console.error("rev/admin/compras", e); res.status(500).json({ error: "server" }); }
});

// ── ADMIN: cambiar estado de un pedido y avisar al socio ──
app.patch("/rev/admin/compras/:id/estado", revAdminAuth, async (req, res) => {
  try {
    const estado = String(req.body?.estado || "").trim().toLowerCase();
    const allowed = new Set(["pendiente", "en proceso", "falta información", "entregado", "cancelado"]);
    if (!allowed.has(estado)) return res.status(400).json({ error: "estado_invalido" });
    const detalle = cleanTg(req.body?.detalle || "", 300);
    const ref = db.collection("compras").doc(String(req.params.id || ""));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "no_existe" });
    const compra = snap.data() || {};
    const at = new Date();
    const hist = { estado, detalle, at: at.toISOString(), por: cleanTg(req.admin?.nombre || "Admin", 80) };
    await ref.update({
      estado,
      detalleEstado: detalle,
      estadoUpdatedAt: at,
      estadoHistorial: admin.firestore.FieldValue.arrayUnion(hist),
      updatedAt: at,
    });

    const socioNorm = revNormKey(compra.socio_norm || compra.socio || "");
    const estadoLabel = estado.charAt(0).toUpperCase() + estado.slice(1);
    const texto = `🛒 Pedido ${String(compra.servicio || "").trim() || ref.id.slice(-6)}: ${estadoLabel}${detalle ? ` · ${detalle}` : ""}`;
    if (socioNorm) {
      await db.collection("avisos").add({
        texto, autor:"Sublicuentas", tipo:"pedido_estado", compraId:ref.id,
        destinatarios:[socioNorm], activo:true, createdAt:admin.firestore.FieldValue.serverTimestamp(),
      }).catch(()=>{});
      try {
        const revAliases = socioNorm === "geisell" ? ["geisell", "geissel"] : [socioNorm];
        let revDoc = null;
        for (const alias of revAliases) {
          const revSnap = await db.collection("revendedores").where("nombre_norm", "==", alias).limit(1).get();
          if (!revSnap.empty) { revDoc = revSnap.docs[0]; break; }
        }
        if (revDoc) {
          const rd = revDoc.data() || {};
          const chatId = String(rd.telegramId || "").trim();
          if (chatId) await sendTelegramMessage(chatId, `🛒 *Actualización de pedido*\n${cleanTg(compra.servicio || "Pedido", 120)}\nEstado: *${cleanTg(estadoLabel, 80)}*${detalle ? `\n${detalle}` : ""}`);
        }
      } catch (_) {}
    }
    res.json({ ok:true, id:ref.id, estado, detalleEstado:detalle, estadoUpdatedAt:at.toISOString() });
  } catch(e){console.error("rev/admin/compras estado",e);res.status(500).json({error:"server"})}
});


// ── ADMIN: canal Telegram para Tickets y Avisos de Sublichat ───────────────
// Sublichat guarda la conversación en Firestore, pero el envío se ejecuta en
// este servicio porque aquí ya vive el bot real y BOT_TOKEN. De esta forma no
// hace falta duplicar TELEGRAM_BOT_TOKEN en Vercel y los errores de Telegram
// se devuelven con su causa real por destinatario.
function revTicketDestKey(value = "") {
  const raw = revNormKey(value);
  return raw === "geissel" ? "geisell" : raw;
}
function revTicketAliasSet(data = {}, docId = "") {
  const out = new Set();
  [docId, data.nombre_norm, data.nombre, data.usuario, data.username].forEach((value) => {
    const full = revTicketDestKey(value);
    if (!full) return;
    out.add(full);
    const first = full.split(/\s+/)[0];
    if (first) out.add(first);
  });
  if (out.has("geissel")) out.add("geisell");
  return out;
}
const REV_TICKET_CHAT_IDS = {
  sublicuentas: String(process.env.TELEGRAM_CHAT_ID_SUBLICUENTAS || SUPER_ADMIN || "").trim(),
  relojes: String(process.env.TELEGRAM_CHAT_ID_RELOJES || "").trim(),
  geisell: String(process.env.TELEGRAM_CHAT_ID_GEISELL || process.env.TELEGRAM_CHAT_ID_GEISSEL || "").trim(),
  magdiel: String(process.env.TELEGRAM_CHAT_ID_MAGDIEL || "").trim(),
};
async function revResolveTicketTelegram(role) {
  const wanted = revTicketDestKey(role);
  if (!wanted) return { chatId:"", source:"missing", reason:"destino_invalido" };
  const envId = String(REV_TICKET_CHAT_IDS[wanted] || "").trim();
  if (envId) return { chatId:envId, source:"env" };

  try {
    // Ruta rápida: nombre_norm exacto.
    const aliases = wanted === "geisell" ? ["geisell", "geissel"] : [wanted];
    for (const alias of aliases) {
      const snap = await db.collection("revendedores").where("nombre_norm", "==", alias).limit(2).get();
      for (const doc of snap.docs) {
        const d = doc.data() || {};
        if (d.activo === false) continue;
        const tg = String(d.telegramId || d.telegramID || d.telegramChatId || d.chatId || d.userId || "").trim();
        if (tg) return { chatId:tg, source:"revendedores", revendedorId:doc.id };
      }
    }

    // Compatibilidad con documentos viejos o nombres completos: acepta el
    // nombre completo y también su primer nombre (Heber, Jimena, etc.).
    const snap = await db.collection("revendedores").get();
    let found = null;
    snap.forEach((doc) => {
      if (found) return;
      const d = doc.data() || {};
      if (d.activo === false) return;
      const aliasesDoc = revTicketAliasSet(d, doc.id);
      if (!aliasesDoc.has(wanted)) return;
      const tg = String(d.telegramId || d.telegramID || d.telegramChatId || d.chatId || d.userId || "").trim();
      if (tg) found = { chatId:tg, source:"revendedores", revendedorId:doc.id };
    });
    return found || { chatId:"", source:"missing", reason:"chat_id_missing" };
  } catch (e) {
    console.error("revResolveTicketTelegram", wanted, e?.message || e);
    return { chatId:"", source:"error", reason:"resolver_error", error:String(e?.message || e).slice(0,240) };
  }
}
function revTelegramFriendlyError(err) {
  const description = String(err?.response?.body?.description || err?.message || err || "Error desconocido de Telegram").trim();
  const lower = description.toLowerCase();
  let code = "telegram_error";
  if (lower.includes("unauthorized")) code = "bot_token_invalido";
  else if (lower.includes("bot was blocked") || lower.includes("blocked by the user")) code = "bot_bloqueado";
  else if (lower.includes("chat not found")) code = "chat_no_encontrado";
  else if (lower.includes("user is deactivated")) code = "usuario_desactivado";
  else if (lower.includes("forbidden")) code = "telegram_prohibido";
  else if (lower.includes("wrong file identifier") || lower.includes("failed to get http url content")) code = "imagen_no_disponible";
  return { code, error:description.slice(0,300) };
}
async function revSendTicketTelegramOne(chatId, payload = {}) {
  const text = String(payload.text || "").slice(0, 3900);
  const imageUrl = String(payload.imageUrl || "").trim();
  const replyMarkup = payload.replyMarkup && typeof payload.replyMarkup === "object" ? payload.replyMarkup : undefined;
  const opts = { parse_mode:"HTML", ...(replyMarkup ? { reply_markup:replyMarkup } : {}) };
  try {
    if (imageUrl) {
      const msg = await bot.sendPhoto(chatId, imageUrl, { ...opts, caption:text.slice(0,1000) });
      return { ok:true, messageId:Number(msg?.message_id || 0) };
    }
    const msg = await bot.sendMessage(chatId, text, { ...opts, disable_web_page_preview:true });
    return { ok:true, messageId:Number(msg?.message_id || 0) };
  } catch (e) {
    if (!isUnauthorizedTelegramError(e)) throw e;
    const job = await enqueueTelegramJob({
      type:imageUrl?"photo":"message", chatId, photoUrl:imageUrl, text, parseMode:"HTML",
      replyMarkup, source:"sublichat-ticket-aviso", reference:String(payload.reference||""),
    });
    return { ok:true, queued:true, jobId:job.id, via:"bot_principal" };
  }
}

app.post("/rev/admin/tickets-telegram", revAdminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const destinos = [...new Set((Array.isArray(body.destinos) ? body.destinos : [body.destino])
      .map(revTicketDestKey).filter(Boolean))].slice(0,100);
    if (!destinos.length) return res.status(400).json({ ok:false, error:"sin_destinatarios" });
    const text = String(body.text || "").trim();
    if (!text) return res.status(400).json({ ok:false, error:"sin_texto" });

    // Lotes de 5 en paralelo (mismo criterio que las promociones): con muchos
    // socios el envío secuencial pasaba de los 10 s y Vercel cortaba la petición.
    const enviarRol = async (role) => {
      const resolved = await revResolveTicketTelegram(role);
      if (!resolved.chatId) {
        return { ok:false, skipped:true, reason:resolved.reason || "chat_id_missing", error:resolved.error || "", roles:[role], source:resolved.source };
      }
      try {
        const sent = await revSendTicketTelegramOne(resolved.chatId, body);
        return { ...sent, chatId:String(resolved.chatId), roles:[role], source:resolved.source };
      } catch (e) {
        const detail = revTelegramFriendlyError(e);
        return { ok:false, reason:detail.code, error:detail.error, roles:[role], source:resolved.source };
      }
    };
    const results = [];
    for (let i = 0; i < destinos.length; i += 5) {
      results.push(...(await Promise.all(destinos.slice(i, i + 5).map(enviarRol))));
    }
    const deliveredRoles = destinos.filter(role => results.some(r => r.ok && (r.roles || []).includes(role)));
    const failedRoles = destinos.filter(role => !deliveredRoles.includes(role));
    return res.json({
      ok: failedRoles.length === 0,
      partial: deliveredRoles.length > 0 && failedRoles.length > 0,
      results,
      deliveredRoles,
      failedRoles,
    });
  } catch (e) {
    console.error("rev/admin/tickets-telegram", e);
    return res.status(500).json({ ok:false, error:"telegram_bridge_error", detail:String(e?.message || e).slice(0,240) });
  }
});

// ── ADMIN: "ver como" ──
app.post("/rev/admin/impersonate", revAdminAuth, async (req, res) => {
  try {
    const id = (req.body.id || "").trim();
    const nombre_norm = (req.body.nombre_norm || "").trim().toLowerCase();
    let doc = null;

    // 1) por ID de documento (siempre confiable)
    if (id) {
      const d = await db.collection("revendedores").doc(id).get();
      if (d.exists) doc = d;
    }
    // 2) respaldo: por nombre_norm
    if (!doc && nombre_norm) {
      const aliases = [nombre_norm];
      if (nombre_norm === "geisell") aliases.push("geissel");
      const snaps = await Promise.all(aliases.map(alias =>
        db.collection("revendedores").where("nombre_norm", "==", alias).limit(1).get()
      ));
      const snap = snaps.find(s => !s.empty);
      if (snap) doc = snap.docs[0];
    }
    if (!doc) return res.status(404).json({ error: "no_existe" });

    const data = doc.data();
    const rawNorm = normVendedor(data.nombre_norm || data.nombre || doc.id);
    const nn = rawNorm === "geissel" ? "geisell" : rawNorm;
    const nombre = nn === "geisell" ? "Geisell" : (data.nombre || doc.id);
    const capabilities = capacidadesRevendedor({ id: doc.id, ...data, nombre_norm: nn });
    const soloCatalogo = !capabilities.canBuy;
    const sinCompras = !capabilities.canBuy;
    const tarifaId = String(data.tarifaId || data.tarifa_id || "general");
    const token = jwt.sign({ id: doc.id, nombre, nombre_norm: nn, soloCatalogo, sinCompras, capabilities, tarifaId, nombreMostrar:data.nombreMostrar||"", etiquetaRenovacion:data.etiquetaRenovacion||"" }, JWT_SECRET, { expiresIn: "6h" });
    res.json({ token, nombre, nombre_norm: nn, soloCatalogo, sinCompras, capabilities, tarifaId, priceTier:tarifaId, nombreMostrar:data.nombreMostrar||"", etiquetaRenovacion:data.etiquetaRenovacion||"" });
  } catch (e) { console.error("rev/impersonate", e); res.status(500).json({ error: "server" }); }
});

// ── IA: generar mensajes (Gemini o Claude según la llave configurada) ──
async function aiGenerate(prompt) {
  const sys = "Sos un asistente de ventas para un negocio de suscripciones digitales en Honduras (Sublicuentas). Escribí en español hondureño, trato de usted, claro, cálido y profesional. Nunca inventes precios. Devolvé solo el mensaje pedido, sin explicaciones.";
  if (typeof fetch !== "function") throw new Error("fetch_no_disponible_node_viejo");

  if (process.env.GEMINI_API_KEY) {
    const modelos = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];
    let ultimoError = "gemini_sin_respuesta";
    for (const m of modelos) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: sys + "\n\n" + prompt }] }] })
        });
        const j = await r.json();
        const t = j?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (t) return t.trim();
        ultimoError = (j?.error?.message || "sin_texto") + " [" + m + "]";
      } catch (err) { ultimoError = err.message + " [" + m + "]"; }
    }
    throw new Error(ultimoError);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, system: sys, messages: [{ role: "user", content: prompt }] })
    });
    const j = await r.json();
    const t = j?.content?.[0]?.text;
    if (t) return t.trim();
    throw new Error(j?.error?.message || "claude_sin_respuesta");
  }

  throw new Error("no_api_key");
}

app.post("/rev/ask", revAuth, async (req, res) => {
  try {
    const live = await revLiveProfile(req.rev);
    if (!revCap(live, "canUseAI", true)) return res.status(403).json({ error: "sin_permiso_ia" });
    const prompt = (req.body.prompt || "").toString().slice(0, 4000);
    if (!prompt) return res.status(400).json({ error: "falta_prompt" });
    const text = await aiGenerate(prompt);
    res.json({ text });
  } catch (e) {
    console.error("rev/ask", e.message);
    res.status(500).json({ error: "ia_error", detail: e.message });
  }
});

// ── Panel admin (precios / vendedores / clientes) — para Sublichat HQ ──
require("./index_12_admin_panel")(app);
require("./index_13_gamificacion")(app);

app.listen(PORT, () => console.log("🌐 Panel API (revendedores) activa en puerto", PORT));
