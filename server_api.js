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

// Reusa Firebase ya inicializado en el core (no arranca el bot)
const { db, PORT } = require("./index_01_core");
const admin = require("firebase-admin");
const STORAGE_BUCKET_CANDIDATES = Array.from(new Set([
  process.env.STORAGE_BUCKET,
  process.env.FIREBASE_STORAGE_BUCKET,
  process.env.GCLOUD_STORAGE_BUCKET,
  process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.appspot.com` : "",
  process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app` : "",
].map((s) => String(s || "").trim()).filter(Boolean)));
const STORAGE_BUCKET = STORAGE_BUCKET_CANDIDATES[0] || "";

const JWT_SECRET = process.env.JWT_SECRET || "CAMBIAME_EN_RENDER";
const ADMIN_USER = (process.env.ADMIN_USER || "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

// keepalive / health (para que Render lo mantenga vivo)
app.get("/", (_req, res) => res.type("text/plain").send("Sublicuentas Panel API OK v2-ia"));
app.get("/rev/ping", (_req, res) => res.json({ v: "3-img-fix", gemini: !!process.env.GEMINI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY, storageBuckets: STORAGE_BUCKET_CANDIDATES }));
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── helpers ──
function revAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sin_token" });
  try { req.rev = jwt.verify(token, JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: "token_invalido" }); }
}
function revAdminAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sin_token" });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (!p.admin) return res.status(403).json({ error: "no_admin" });
    req.admin = p; next();
  } catch (e) { return res.status(401).json({ error: "token_invalido" }); }
}
function revParseFecha(v) {
  if (v == null) return null;
  if (typeof v === "object") { if (v._seconds) return new Date(v._seconds * 1000); if (v.seconds) return new Date(v.seconds * 1000); }
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { let [, d, mo, y] = m; y = y.length === 2 ? "20" + y : y; return new Date(+y, +mo - 1, +d); }
  const d = new Date(s); return isNaN(d) ? null : d;
}
function revDiasRest(d) { if (!d) return null; const h = new Date(); h.setHours(0, 0, 0, 0); return Math.round((d - h) / 86400000); }
function revFechaISO(d) {
  if (!d) return "";
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function revParseFechaInput(v) {
  const s = (v || "").toString().trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  return revParseFecha(s);
}
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
async function revActualizarFechaCliente({ clienteId, socioNorm, servicioIndex, nuevaFecha, meses }) {
  const id = (clienteId || "").toString().trim();
  if (!id) return { actualizado: false };
  const ref = db.collection("clientes").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error("cliente_no_existe"), { status: 404, publicError: "cliente_no_existe" });
  const c = snap.data() || {};
  if ((c.vendedor_norm || "") !== (socioNorm || "")) throw Object.assign(new Error("cliente_no_permitido"), { status: 403, publicError: "cliente_no_permitido" });
  const servicios = Array.isArray(c.servicios) ? [...c.servicios] : [];
  const ix = Number(servicioIndex);
  if (!Number.isInteger(ix) || ix < 0 || ix >= servicios.length) throw Object.assign(new Error("servicio_no_existe"), { status: 400, publicError: "servicio_no_existe" });

  const svc = { ...(servicios[ix] || {}) };
  const campo = revCampoFechaServicio(svc);
  const anterior = revParseFecha(svc[campo] || svc.fechaRenovacion || svc.vencimiento || svc.vence || svc.fechaFin);
  let nf = revParseFechaInput(nuevaFecha);
  if (!nf && meses) {
    const base = anterior && revDiasRest(anterior) > 0 ? anterior : new Date();
    nf = revAddMonths(base, Number(meses));
  }
  if (!nf || isNaN(nf)) throw Object.assign(new Error("fecha_invalida"), { status: 400, publicError: "fecha_invalida" });

  svc[campo] = revFechaISO(nf);
  svc.ultimaRenovacionAt = new Date();
  servicios[ix] = svc;
  await ref.update({ servicios, updatedAt: new Date(), ultimaRenovacionAt: new Date() });
  return {
    actualizado: true,
    clienteId: id,
    servicioIndex: ix,
    campo,
    fechaAnterior: anterior ? revFechaISO(anterior) : "",
    nuevaFecha: revFechaISO(nf),
    servicio: svc.plataforma || svc.servicio || svc.nombre || svc.cuenta || "Servicio",
  };
}

// ── LOGIN (revendedor o admin) ──
app.post("/rev/login", async (req, res) => {
  try {
    const usuario = (req.body.usuario || "").trim().toLowerCase();
    const password = (req.body.password || "").trim();
    if (!usuario || !password) return res.status(400).json({ error: "faltan_datos" });

    if (ADMIN_USER && usuario === ADMIN_USER && password === ADMIN_PASSWORD) {
      const token = jwt.sign({ admin: true, nombre: "Admin" }, JWT_SECRET, { expiresIn: "30d" });
      return res.json({ token, admin: true, nombre: "Admin" });
    }

    const snap = await db.collection("revendedores").where("nombre_norm", "==", usuario).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: "credenciales" });
    const doc = snap.docs[0], d = doc.data();
    if (d.activo === false) return res.status(403).json({ error: "inactivo" });

    if (!d.passwordHash) {
      const hash = await bcrypt.hash(password, 10);
      await doc.ref.update({ passwordHash: hash });
    } else {
      const okp = await bcrypt.compare(password, d.passwordHash);
      if (!okp) return res.status(401).json({ error: "credenciales" });
    }
    const token = jwt.sign({ id: doc.id, nombre: d.nombre, nombre_norm: d.nombre_norm }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, nombre: d.nombre, nombre_norm: d.nombre_norm });
  } catch (e) { console.error("rev/login", e); res.status(500).json({ error: "server" }); }
});

// ── CLIENTES del revendedor ──
app.get("/rev/clientes", revAuth, async (req, res) => {
  try {
    const snap = await db.collection("clientes").where("vendedor_norm", "==", req.rev.nombre_norm).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) { console.error("rev/clientes", e); res.status(500).json({ error: "server" }); }
});

// ── PRECIOS (inventario) ──
app.get("/rev/precios", revAuth, async (req, res) => {
  try {
    const snap = await db.collection("inventario").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) { console.error("rev/precios", e); res.status(500).json({ error: "server" }); }
});

// ── AVISOS — buzón publicado desde Telegram (/aviso) ──
app.get("/rev/avisos", revAuth, async (req, res) => {
  try {
    // ✅ Sin where+orderBy combinado (evita necesitar índice compuesto en Firestore)
    const snap = await db.collection("avisos").orderBy("createdAt", "desc").limit(20).get();
    const lista = snap.docs
      .map((d) => {
        const a = d.data();
        const ts = a.createdAt?._seconds ? a.createdAt._seconds * 1000 :
                   a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.now();
        return { id: d.id, texto: a.texto || "", autor: a.autor || "Admin", ts, activo: a.activo !== false };
      })
      .filter((a) => a.activo)
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
  const token = process.env.BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
  } catch (e) { console.error("sendTelegramMessage", e.message); }
}

async function sendTelegramPhoto(chatId, photoUrl, caption) {
  const token = process.env.BOT_TOKEN;
  if (!token || !photoUrl) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: "Markdown" }),
    });
    if (!r.ok) console.error("sendTelegramPhoto", await r.text().catch(() => r.statusText));
    return r.ok;
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
    if (!r.ok) console.error("sendTelegramPhotoBuffer", await r.text().catch(() => r.statusText));
    return r.ok;
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
  const destino = String(destinoRaw || "sublicuentas").trim().toLowerCase();
  if (destino === "relojes") return { key: "relojes", label: "⌚ Relojes", fallback: "411539492", env: "RELOJES_CHAT_ID" };
  return { key: "sublicuentas", label: "🟣 Sublicuentas", fallback: "5728675990", env: "SUBLICUENTAS_CHAT_ID" };
}
async function getDestinoChatIds(destinoRaw) {
  const info = destinoInfo(destinoRaw);
  const envIds = String(process.env[info.env] || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (envIds.length) return envIds;
  if (info.key === "sublicuentas") {
    const superIds = String(process.env.SUPER_ADMIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (superIds.length) return superIds;
  }
  return [info.fallback].filter(Boolean);
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
  return { contentType, buffer, ext, filename: `comprobante_${Date.now()}.${ext}` };
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
    const { clienteId, cliente, servicio, comentario, quien, monto, imagen, servicioIndex, nuevaFecha, meses } = req.body;
    const socio = req.rev.nombre || req.rev.nombre_norm || "Revendedor";
    const com = (comentario || "").toString().trim().slice(0, 600);

    let renovacionFecha = null;
    if ((nuevaFecha || meses) && clienteId !== undefined && servicioIndex !== undefined) {
      renovacionFecha = await revActualizarFechaCliente({
        clienteId,
        socioNorm: req.rev.nombre_norm || "",
        servicioIndex,
        nuevaFecha,
        meses,
      });
    }

    const imagenObj = await uploadPanelImage(imagen, "renovaciones");
    const imagenUrl = imagenObj.url || "";

    const doc = {
      clienteId: (clienteId || "").toString(),
      cliente: (cliente || "").toString().slice(0, 120),
      servicio: (renovacionFecha?.servicio || servicio || "").toString().slice(0, 120),
      servicioIndex: Number.isInteger(Number(servicioIndex)) ? Number(servicioIndex) : null,
      comentario: com,
      quien: (quien || "").toString().slice(0, 120),
      monto: Number(monto) || 0,
      socio,
      socio_norm: req.rev.nombre_norm || "",
      imagenUrl,
      imagenStorageError: imagenObj.storageError || "",
      fechaAnterior: renovacionFecha?.fechaAnterior || "",
      nuevaFecha: renovacionFecha?.nuevaFecha || (nuevaFecha || "").toString().slice(0, 20),
      renovado: !!renovacionFecha?.actualizado,
      createdAt: new Date(),
    };
    const ref = await db.collection("renovaciones").add(doc);

    const cap = `🧾 *Comprobante de renovación*
👤 Socio: ${socio}
🙍 Cliente: ${doc.cliente || "—"}
📦 ${doc.servicio || "—"}`
      + (doc.monto ? `
💵 Lps. ${doc.monto}` : "")
      + (doc.quien ? `
🔁 Renovó: ${doc.quien}` : "")
      + (doc.renovado ? `
📅 Nueva fecha: ${doc.nuevaFecha}` : "")
      + (com ? `
📝 ${com}` : "");
    const ids = await getAdminChatIds();
    await Promise.all(ids.map((id) => sendTelegramImageSmart(id, imagenObj, cap)));

    res.json({ ok: true, id: ref.id, imagenUrl, renovado: doc.renovado, nuevaFecha: doc.nuevaFecha });
  } catch (e) {
    console.error("rev/renovacion", e);
    res.status(e.status || 500).json({ error: e.publicError || "server", detail: e.message });
  }
});

// ── Renovación directa sin foto: actualiza fecha del servicio del cliente ──
app.post("/rev/renovar-cliente", revAuth, async (req, res) => {
  try {
    const r = await revActualizarFechaCliente({
      clienteId: req.body.clienteId,
      socioNorm: req.rev.nombre_norm || "",
      servicioIndex: req.body.servicioIndex,
      nuevaFecha: req.body.nuevaFecha,
      meses: req.body.meses,
    });
    await db.collection("renovaciones").add({
      clienteId: (req.body.clienteId || "").toString(),
      cliente: (req.body.cliente || "").toString().slice(0, 120),
      servicio: r.servicio,
      servicioIndex: r.servicioIndex,
      comentario: (req.body.comentario || "Renovación directa desde panel").toString().slice(0, 600),
      quien: (req.body.quien || "Panel socio").toString().slice(0, 120),
      monto: Number(req.body.monto) || 0,
      socio: req.rev.nombre || req.rev.nombre_norm || "Revendedor",
      socio_norm: req.rev.nombre_norm || "",
      imagenUrl: "",
      fechaAnterior: r.fechaAnterior || "",
      nuevaFecha: r.nuevaFecha || "",
      renovado: true,
      createdAt: new Date(),
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error("rev/renovar-cliente", e);
    res.status(e.status || 500).json({ error: e.publicError || "server", detail: e.message });
  }
});


// ── COMPRA NUEVA: socio envía solicitud + comprobante; avisa a Telegram según destino ──
app.post("/rev/compra", revAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const socio = req.rev.nombre || req.rev.nombre_norm || "Revendedor";
    const destino = destinoInfo(b.destino);
    const servicio = cleanTg(b.servicio, 120);
    if (!servicio) return res.status(400).json({ error: "falta_servicio" });

    const clienteNombre = cleanTg(b.clienteNombre, 80);
    const clienteApellido = cleanTg(b.clienteApellido, 80);
    const perfilNombre = cleanTg(b.perfilNombre, 80);
    const perfilApellido = cleanTg(b.perfilApellido, 80);
    const correo = cleanTg(b.correo, 160);
    const acceso = cleanTg(b.acceso, 220);
    const serial = cleanTg(b.serial, 220);
    const key = cleanTg(b.key, 220);
    const comentario = cleanTg(b.comentario, 700);
    const entregaTipo = cleanTg(b.entregaTipo || "", 60);
    const catalogCategory = cleanTg(b.catalogCategory || "", 120);
    const catalogSub = cleanTg(b.catalogSub || "", 160);
    const catalogDetalle = cleanTg(b.catalogDetalle || "", 700);
    const detalleServicio = cleanTg(b.detalleServicio || "", 240);
    const precioCatalogo = b.precioCatalogo === null || b.precioCatalogo === undefined || b.precioCatalogo === "" ? null : Number(b.precioCatalogo) || 0;
    const monto = Number(b.monto) || 0;

    const imagenObj = await uploadPanelImage(b.imagen, "compras");
    const imagenUrl = imagenObj.url || "";

    const doc = {
      tipo: "compra",
      servicio,
      entregaTipo,
      catalogCategory,
      catalogSub,
      catalogDetalle,
      detalleServicio,
      precioCatalogo,
      clienteNombre,
      clienteApellido,
      cliente: `${clienteNombre} ${clienteApellido}`.trim(),
      perfilNombre,
      perfilApellido,
      perfil: `${perfilNombre} ${perfilApellido}`.trim(),
      correo,
      acceso,
      serial,
      key,
      comentario,
      monto,
      destino: destino.key,
      destinoLabel: destino.label,
      socio,
      socio_norm: req.rev.nombre_norm || "",
      imagenUrl,
      imagenStorageError: imagenObj.storageError || "",
      estado: "pendiente",
      createdAt: new Date(),
    };
    const ref = await db.collection("compras").add(doc);

    const lineas = [
      `🛒 *Nueva compra recibida*`,
      `📣 Avisar a: ${destino.label}`,
      `👤 Socio: ${cleanTg(socio, 80)}`,
      `📦 Servicio: ${servicio}`,
    ];
    if (catalogCategory) lineas.push(`🗂️ Catálogo: ${catalogCategory}`);
    if (catalogSub) lineas.push(`📌 Plan: ${catalogSub}`);
    if (precioCatalogo !== null) lineas.push(`🏷️ Precio catálogo: ${precioCatalogo ? `Lps. ${precioCatalogo}` : "Por comisión"}`);
    if (entregaTipo) lineas.push(`⚙️ Tipo: ${entregaTipo}`);
    if (doc.cliente) lineas.push(`🙍 Cliente: ${doc.cliente}`);
    if (doc.perfil) lineas.push(`👥 Perfil: ${doc.perfil}`);
    if (correo) lineas.push(`✉️ Correo: ${correo}`);
    if (detalleServicio) lineas.push(`🧾 Detalle solicitado: ${detalleServicio}`);
    if (acceso) lineas.push(`🔐 Acceso: ${acceso}`);
    if (serial) lineas.push(`🔑 Serial: ${serial}`);
    if (key) lineas.push(`🧩 Key: ${key}`);
    if (monto) lineas.push(`💵 Monto: Lps. ${monto}`);
    if (comentario) lineas.push(`📝 ${comentario}`);
    if (catalogDetalle) lineas.push(`ℹ️ Detalle catálogo: ${catalogDetalle}`);
    lineas.push((imagenUrl || imagenObj.buffer) ? `📷 Comprobante adjunto` : `📷 Sin comprobante adjunto`);
    const cap = lineas.join("\n");

    let ids = await getDestinoChatIds(destino.key);
    if (!ids.length) ids = await getAdminChatIds();
    await Promise.all(ids.map((id) => sendTelegramImageSmart(id, imagenObj, cap)));

    res.json({ ok: true, id: ref.id, imagenUrl, destino: destino.key, destinoLabel: destino.label });
  } catch (e) {
    console.error("rev/compra", e);
    res.status(e.status || 500).json({ error: e.publicError || "server", detail: e.message });
  }
});

app.post("/rev/sugerencia", revAuth, async (req, res) => {
  try {
    const texto = (req.body.texto || "").toString().trim().slice(0, 1000);
    if (!texto) return res.status(400).json({ error: "falta_texto" });
    const nombre = req.rev.nombre || req.rev.nombre_norm || "Revendedor";

    const destino = (req.body.destino || "sublicuentas").toString().trim();
    const CHATS = { sublicuentas: "5728675990", relojes: "411539492" };
    const quien = destino === "relojes" ? "⌚ Relojes" : "🟣 Sublicuentas";

    await db.collection("sugerencias").add({
      texto, nombre, nombre_norm: req.rev.nombre_norm || "",
      destino, createdAt: new Date(),
    });

    const aviso = `💬 *Nueva sugerencia* (${quien})\n👤 ${nombre}\n\n${texto}`;
    const id = CHATS[destino] || CHATS.sublicuentas;
    await sendTelegramMessage(id, aviso);

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
      const key = c.vendedor_norm || "";
      if (!porVend[key]) porVend[key] = { clientes: 0, servicios: 0, vencidos: 0, porVencer: 0 };
      porVend[key].clientes++;
      (Array.isArray(c.servicios) ? c.servicios : []).forEach((s) => {
        porVend[key].servicios++;
        const n = revDiasRest(revParseFecha(s.fechaRenovacion || s.vencimiento || s.fechaFin));
        if (n != null) { if (n < 0) porVend[key].vencidos++; else if (n <= 5) porVend[key].porVencer++; }
      });
    });
    const lista = revSnap.docs.map((d) => {
      const r = d.data();
      const k = r.nombre_norm || (r.nombre || d.id).toLowerCase();
      const c = porVend[k] || { clientes: 0, servicios: 0, vencidos: 0, porVencer: 0 };
      return { id: d.id, nombre: r.nombre || d.id, nombre_norm: k, activo: r.activo !== false, telegramId: r.telegramId || "", ...c };
    }).sort((a, b) => b.clientes - a.clientes);
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
        imagenUrl: r.imagenUrl || "",
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
        monto: Number(r.monto) || 0,
        destino: r.destino || "sublicuentas",
        destinoLabel: r.destinoLabel || destinoInfo(r.destino).label,
        socio: r.socio || "",
        socio_norm: r.socio_norm || "",
        imagenUrl: r.imagenUrl || "",
        estado: r.estado || "pendiente",
        ts,
      };
    });
    res.json(lista);
  } catch (e) { console.error("rev/admin/compras", e); res.status(500).json({ error: "server" }); }
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
      const snap = await db.collection("revendedores").where("nombre_norm", "==", nombre_norm).limit(1).get();
      if (!snap.empty) doc = snap.docs[0];
    }
    if (!doc) return res.status(404).json({ error: "no_existe" });

    const data = doc.data();
    const nn = data.nombre_norm || (data.nombre || doc.id).toLowerCase();
    const token = jwt.sign({ id: doc.id, nombre: data.nombre, nombre_norm: nn }, JWT_SECRET, { expiresIn: "6h" });
    res.json({ token, nombre: data.nombre, nombre_norm: nn });
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
    const prompt = (req.body.prompt || "").toString().slice(0, 4000);
    if (!prompt) return res.status(400).json({ error: "falta_prompt" });
    const text = await aiGenerate(prompt);
    res.json({ text });
  } catch (e) {
    console.error("rev/ask", e.message);
    res.status(500).json({ error: "ia_error", detail: e.message });
  }
});

app.listen(PORT, () => console.log("🌐 Panel API (revendedores) activa en puerto", PORT));
