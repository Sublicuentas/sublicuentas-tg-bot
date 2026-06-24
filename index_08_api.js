/* ✅ SUBLICUENTAS — PARTE 8/8 — API REST (para la app Android) v2
   ----------------------------------------------------------------
   Expone la MISMA lógica del bot por HTTP para que la app la consuma.
   Todo escribe/lee del mismo Firestore → bot, app y Render siempre sincronizados.

   🔒 SOLO ADMIN: cada endpoint exige el header
        Authorization: Bearer <API_ADMIN_TOKEN>
      Sin ese token → 401. Además valida isAdmin si se manda adminId.

   ⚙️ REQUISITOS (1 sola vez):
   1) npm install express cors
   2) Variables de entorno en Render:
        API_ADMIN_TOKEN = (un secreto largo y único)
        GEMINI_API_KEY  = (tu key de Gemini, la misma de Sublichat) — para el cobro con IA
        JWT_SECRET      = (llave para revendedores panel)
   3) En tu archivo de arranque, requerir esta parte AL FINAL:
        require("./index_08_api");
   
   ✅ v2 CAMBIOS:
   - Usa módulo compartido index_09_api_auth (elimina duplicación)
   - Detecta si handlers.js ya abrió HTTP KEEPALIVE
   - NO hay conflicto de puertos
   - Panel revendedores montado en /rev (mismo puerto, rutas diferentes)
*/

const express = require("express");
const cors = require("cors");

// ✅ Usar módulo de auth compartido (elimina duplicación)
const { revAuth, revAdminAuth, revParseFecha, revDiasRest, revFechaISO, revParseFechaInput, revAddMonths } = require("./index_09_api_auth");

const {
  db, admin, ExcelJS, PORT,
  CLIENTES_COLLECTION,
  FIN_BANCOS, FIN_MOTIVOS_EGRESO, PLATAFORMAS,
  cacheInvalidatePrefix, getCoreHealth,
} = require("./index_01_core");

const {
  isAdmin, logErr, hoyDMY, isFechaDMY,
} = require("./index_02_utils_roles");

const {
  getCliente, buscarClienteRobusto, obtenerRenovacionesPorFecha,
  patchServicio, eliminarServicioTx,
} = require("./index_03_clientes_crm");

const { buscarInventarioPorCorreo } = require("./index_04_inventario_correos");

const {
  registrarIngresoTx, registrarEgresoTx,
  getMovimientosPorFecha, getMovimientosPorRango,
  getMovimientoFinanzaById, eliminarMovimientoFinanzas,
  cierreCajaTexto,
} = require("./index_05_finanzas_menus");

const { apiCode, apiLink, apiHogar, apiInbox } = require("./index_07_imap");

// ===============================
// HELPERS
// ===============================
const API_TOKEN = String(process.env.API_ADMIN_TOKEN || "").trim();
const APP_NAME = "App Admin";

// Gemini — mismo modelo y endpoint que tu chat.js de Sublichat
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function generarMensajeCobroIA({ nombre, plataforma, precio, fecha }) {
  if (!GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  const prompt =
    `Redactá UN mensaje de WhatsApp de cobro para un cliente de Sublicuentas ` +
    `(reventa de suscripciones en Honduras). Tono cordial y profesional, de usted, ` +
    `hondureño, cálido, breve (máx 3 líneas). Incluí 1 emoji discreto. ` +
    `Datos: cliente "${nombre}", servicio "${plataforma}", monto Lps ${precio}, ` +
    `renueva el ${fecha}. Devolvé SOLO el mensaje, sin comillas ni explicación.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    // thinkingBudget 0 evita que 2.5-flash gaste los tokens "pensando" y deje la respuesta vacía
    generationConfig: { maxOutputTokens: 300, temperature: 0.9, thinkingConfig: { thinkingBudget: 0 } },
  };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  const texto = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!texto) throw new Error("Gemini no devolvió texto");
  return texto;
}

// Copia EXACTA de addDaysDMY del bot (mismo formato DD/MM/AAAA)
function addDaysDMY(baseDmy = "", days = 0) {
  if (!isFechaDMY(baseDmy)) return hoyDMY();
  const [dd, mm, yyyy] = String(baseDmy).split("/").map(Number);
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const y = String(dt.getUTCFullYear());
  return `${d}/${m}/${y}`;
}

// Renovar un servicio — MISMA lógica que el handler cli:ren:auto del bot
async function renovarServicio(clientId, idx, dias) {
  const ref = db.collection(CLIENTES_COLLECTION).doc(String(clientId || ""));
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Cliente no encontrado");
  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) throw new Error("Servicio inválido");
  const base = isFechaDMY(String(servicios[idx].fechaRenovacion || ""))
    ? String(servicios[idx].fechaRenovacion) : hoyDMY();
  servicios[idx] = { ...servicios[idx], fechaRenovacion: addDaysDMY(base, dias) };
  await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  cacheInvalidatePrefix(`clientes:doc:${clientId}`);
  return servicios[idx];
}

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  logErr("API", e); fail(res, 500, e?.message || "Error interno");
});

// ===============================
// APP
// ===============================
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Healthcheck (público, lo usa Render para keepalive)
app.get("/health", (_req, res) => res.json(getCoreHealth ? getCoreHealth() : { ok: true }));
app.get("/", (_req, res) => res.send("Sublicuentas API OK"));

// 🔒 Candado SOLO ADMIN — aplica a todo lo que empiece con /api
app.use("/api", async (req, res, next) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!API_TOKEN || token !== API_TOKEN) return fail(res, 401, "No autorizado");
    // Doble candado opcional: si la app manda adminId, se valida contra la colección de admins
    const adminId = req.headers["x-admin-id"] || req.body?.adminId || req.query?.adminId;
    if (adminId && !(await isAdmin(adminId))) return fail(res, 403, "No es admin");
    next();
  } catch (e) { fail(res, 401, "No autorizado"); }
});

// Login: la app valida el token de admin
app.post("/api/login", wrap((req, res) => ok(res, { rol: "admin" })));

// Catálogos (bancos, motivos, plataformas) para los selectores de la app
app.get("/api/catalogos", wrap((_req, res) => ok(res, {
  bancos: FIN_BANCOS,
  motivos: FIN_MOTIVOS_EGRESO,
  plataformas: Object.values(PLATAFORMAS).map((p) => ({ key: p.key, nombre: p.nombre, categoria: p.categoria })),
})));

// ---------- CÓDIGOS (IMAP) ----------
app.get("/api/code", wrap(async (req, res) => {
  const correo = String(req.query.correo || "").trim().toLowerCase();
  if (!correo) return fail(res, 400, "Falta correo");
  ok(res, await apiCode(correo));
}));
app.get("/api/link", wrap(async (req, res) => ok(res, await apiLink(String(req.query.correo || "").trim().toLowerCase()))));
app.get("/api/hogar", wrap(async (req, res) => ok(res, await apiHogar(String(req.query.correo || "").trim().toLowerCase()))));
app.get("/api/inbox", wrap(async (req, res) => ok(res, await apiInbox(String(req.query.correo || "").trim().toLowerCase()))));

// ---------- CLIENTES / CRM ----------
app.get("/api/clientes", wrap(async (req, res) => {
  const q = String(req.query.q || "").trim();
  ok(res, { resultados: await buscarClienteRobusto(q) });
}));
app.get("/api/clientes/:id", wrap(async (req, res) => {
  const c = await getCliente(req.params.id);
  if (!c) return fail(res, 404, "Cliente no encontrado");
  ok(res, { cliente: c });
}));
// Renovar servicio (+30 / +31) — usa la misma lógica del bot
app.post("/api/clientes/:id/renovar", wrap(async (req, res) => {
  const idx = Number(req.body.idx);
  const dias = Number(req.body.dias) === 31 ? 31 : 30;
  const servicio = await renovarServicio(req.params.id, idx, dias);
  ok(res, { servicio, mensaje: `Renovado +${dias} días` });
}));
// Editar un servicio del cliente
app.patch("/api/clientes/:id/servicio/:idx", wrap(async (req, res) => {
  const r = await patchServicio(req.params.id, Number(req.params.idx), req.body.patch || {});
  cacheInvalidatePrefix(`clientes:doc:${req.params.id}`);
  ok(res, { resultado: r });
}));
// Borrar un servicio del cliente
app.delete("/api/clientes/:id/servicio/:idx", wrap(async (req, res) => {
  const r = await eliminarServicioTx(req.params.id, Number(req.params.idx));
  cacheInvalidatePrefix(`clientes:doc:${req.params.id}`);
  ok(res, { resultado: r });
}));

// ---------- RENOVACIONES POR FECHA ----------
app.get("/api/renovaciones", wrap(async (req, res) => {
  const fecha = String(req.query.fecha || hoyDMY());
  ok(res, { fecha, rows: await obtenerRenovacionesPorFecha(fecha) });
}));

// ---------- MENSAJE DE COBRO CON IA (Gemini) ----------
app.post("/api/cobro/ia", wrap(async (req, res) => {
  const { nombre = "", plataforma = "", precio = "", fecha = "" } = req.body || {};
  if (!nombre || !plataforma) return fail(res, 400, "Faltan datos del cliente");
  const mensaje = await generarMensajeCobroIA({ nombre, plataforma, precio, fecha });
  ok(res, { mensaje });
}));

// ---------- INVENTARIO ----------
app.get("/api/inventario", wrap(async (req, res) => {
  const correo = String(req.query.correo || "").trim();
  ok(res, { resultados: await buscarInventarioPorCorreo(correo) });
}));

// ---------- FINANZAS ----------
app.post("/api/finanzas/ingreso", wrap(async (req, res) => {
  const { monto, banco, plataforma, detalle, fecha } = req.body || {};
  const mov = await registrarIngresoTx({ monto, banco, plataforma, detalle, fecha, userName: APP_NAME });
  ok(res, { movimiento: mov });
}));
app.post("/api/finanzas/egreso", wrap(async (req, res) => {
  const { monto, banco, motivo, detalle, fecha } = req.body || {};
  const mov = await registrarEgresoTx({ monto, banco, motivo, detalle, fecha, userName: APP_NAME });
  ok(res, { movimiento: mov });
}));
app.get("/api/finanzas/movimientos", wrap(async (req, res) => {
  const fecha = String(req.query.fecha || hoyDMY());
  ok(res, { fecha, movimientos: await getMovimientosPorFecha(fecha) });
}));
app.delete("/api/finanzas/movimientos/:id", wrap(async (req, res) => {
  const existe = await getMovimientoFinanzaById(req.params.id);
  if (!existe) return fail(res, 404, "Movimiento no encontrado");
  await eliminarMovimientoFinanzas(req.params.id);
  ok(res, { eliminado: req.params.id });
}));
app.get("/api/finanzas/cierre", wrap(async (req, res) => {
  const fecha = String(req.query.fecha || hoyDMY());
  const lista = await getMovimientosPorFecha(fecha);
  let ingresos = 0, egresos = 0;
  for (const m of lista) {
    const n = Number(m.monto || 0);
    if (String(m.tipo || "").toLowerCase() === "egreso") egresos += n; else ingresos += n;
  }
  ok(res, { fecha, ingresos, egresos, saldo: ingresos - egresos, movimientos: lista.length, texto: cierreCajaTexto(fecha, lista) });
}));
// Excel — genera el .xlsx y lo devuelve como descarga (mismo ExcelJS del bot)
app.get("/api/finanzas/excel", wrap(async (req, res) => {
  const desde = String(req.query.desde || hoyDMY());
  const hasta = String(req.query.hasta || desde);
  const rows = await getMovimientosPorRango(desde, hasta);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sublicuentas App";
  wb.created = new Date();
  const ws = wb.addWorksheet("Finanzas");
  ws.columns = [
    { header: "Fecha", key: "fecha", width: 14 },
    { header: "Tipo", key: "tipo", width: 10 },
    { header: "Monto", key: "monto", width: 14 },
    { header: "Plataforma/Motivo", key: "concepto", width: 28 },
    { header: "Banco", key: "banco", width: 18 },
    { header: "Detalle", key: "detalle", width: 32 },
    { header: "ID", key: "id", width: 26 },
  ];
  ws.getRow(1).font = { bold: true };
  let ingresos = 0, egresos = 0;
  for (const r of rows) {
    const esEgreso = String(r.tipo || "").toLowerCase() === "egreso";
    const monto = Number(r.monto || 0);
    if (esEgreso) egresos += monto; else ingresos += monto;
    ws.addRow({
      fecha: r.fecha || "",
      tipo: esEgreso ? "Egreso" : "Ingreso",
      monto,
      concepto: esEgreso ? (r.motivo || r.detalle || "") : (r.plataforma || r.detalle || r.cliente || ""),
      banco: r.banco || r.metodo || "",
      detalle: r.detalle || r.descripcion || "",
      id: r.id || "",
    });
  }
  const resumen = wb.addWorksheet("Resumen");
  resumen.addRows([
    ["Del", desde], ["Al", hasta],
    ["Ingresos", ingresos], ["Egresos", egresos],
    ["Utilidad", ingresos - egresos], ["Movimientos", rows.length],
  ]);
  resumen.getColumn(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="finanzas_${desde.replace(/\//g, "-")}_${hasta.replace(/\//g, "-")}.xlsx"`);
  res.send(Buffer.from(buffer));
}));

// 404 para rutas /api no encontradas

/* ════════════════════════════════════════════════════════════════
   PANEL REVENDEDORES + MODO ADMIN  (montado en /rev, fuera del candado /api)
   Variables en Render: JWT_SECRET, ADMIN_USER, ADMIN_PASSWORD
   ════════════════════════════════════════════════════════════════ */
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const REV_JWT_SECRET = process.env.JWT_SECRET || "CAMBIAME_EN_RENDER";
const REV_ADMIN_USER = (process.env.ADMIN_USER || "").trim().toLowerCase();
const REV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

// ✅ Las funciones revAuth, revAdminAuth, revParseFecha, revDiasRest, etc.
// ahora se importan de index_09_api_auth (módulo compartido)
// Esto elimina duplicación y mantiene consistencia con server_api.js

// LOGIN (revendedor con clave, o admin con ADMIN_USER/ADMIN_PASSWORD)
app.post("/rev/login", async (req, res) => {
  try {
    const usuario = (req.body.usuario || "").trim().toLowerCase();
    const password = (req.body.password || "").trim();
    if (!usuario || !password) return res.status(400).json({ error: "faltan_datos" });

    if (REV_ADMIN_USER && usuario === REV_ADMIN_USER && password === REV_ADMIN_PASSWORD) {
      const token = jwt.sign({ admin: true, nombre: "Admin" }, REV_JWT_SECRET, { expiresIn: "30d" });
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
    const token = jwt.sign({ id: doc.id, nombre: d.nombre, nombre_norm: d.nombre_norm }, REV_JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, nombre: d.nombre, nombre_norm: d.nombre_norm });
  } catch (e) { console.error("rev/login", e); res.status(500).json({ error: "server" }); }
});

// CLIENTES del revendedor autenticado
app.get("/rev/clientes", revAuth, async (req, res) => {
  try {
    const snap = await db.collection("clientes").where("vendedor_norm", "==", req.rev.nombre_norm).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) { console.error("rev/clientes", e); res.status(500).json({ error: "server" }); }
});

// PRECIOS (inventario)
app.get("/rev/precios", revAuth, async (req, res) => {
  try {
    const snap = await db.collection("inventario").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) { console.error("rev/precios", e); res.status(500).json({ error: "server" }); }
});

// ADMIN: lista de revendedores con contadores
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

// ADMIN: "ver como" un revendedor
app.post("/rev/admin/impersonate", revAdminAuth, async (req, res) => {
  try {
    const nombre_norm = (req.body.nombre_norm || "").trim().toLowerCase();
    if (!nombre_norm) return res.status(400).json({ error: "falta_revendedor" });
    const snap = await db.collection("revendedores").where("nombre_norm", "==", nombre_norm).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "no_existe" });
    const d = snap.docs[0].data();
    const token = jwt.sign({ id: snap.docs[0].id, nombre: d.nombre, nombre_norm: d.nombre_norm }, REV_JWT_SECRET, { expiresIn: "6h" });
    res.json({ token, nombre: d.nombre, nombre_norm: d.nombre_norm });
  } catch (e) { console.error("rev/impersonate", e); res.status(500).json({ error: "server" }); }
});
/* ════════════ fin panel revendedores ════════════ */

app.use("/api", (_req, res) => fail(res, 404, "Ruta no encontrada"));

// ===============================
// ARRANQUE — abre puerto SOLO si handlers NO lo hizo
// ===============================
// ✅ handlers.js abre HTTP KEEPALIVE en global.__SUBLICUENTAS_KEEPALIVE_SERVER__
// Si existe, esta API se monta en app.listen pero SOLO si no hay conflicto

if (!global.__SUBLICUENTAS_KEEPALIVE_SERVER__ && !global.__SUBLICUENTAS_API_SERVER__) {
  global.__SUBLICUENTAS_API_SERVER__ = app.listen(PORT, () => {
    console.log("🌐 API REST Sublicuentas activa en puerto", PORT);
    if (!API_TOKEN) console.warn("⚠️ Falta API_ADMIN_TOKEN — la API rechazará todo hasta configurarlo.");
  });
} else if (!global.__SUBLICUENTAS_API_SERVER__) {
  console.log("ℹ️ HTTP KEEPALIVE ya activo (handlers.js). API monta en mismo puerto.");
}

module.exports = { app };
