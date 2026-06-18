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
   ════════════════════════════════════════════════════════════════ */

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Reusa Firebase ya inicializado en el core (no arranca el bot)
const { db, PORT } = require("./index_01_core");

const JWT_SECRET = process.env.JWT_SECRET || "CAMBIAME_EN_RENDER";
const ADMIN_USER = (process.env.ADMIN_USER || "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// keepalive / health (para que Render lo mantenga vivo)
app.get("/", (_req, res) => res.type("text/plain").send("Sublicuentas Panel API OK v2-ia"));
app.get("/rev/ping", (_req, res) => res.json({ v: "2-ia", gemini: !!process.env.GEMINI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY }));
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
