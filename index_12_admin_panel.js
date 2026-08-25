/* ✅ SUBLICUENTAS — PARTE 12 — PANEL ADMIN (precios / vendedores / clientes)
   ----------------------------------------------------------------------
   Endpoints nuevos para que Sublichat HQ pueda editar, sin pasar por el
   bot de Telegram:
     - Precios que ven los revendedores (colección nueva "precios")
     - Vendedores (crear, editar, resetear PIN, eliminar)
     - Clientes (editar datos básicos y sus servicios, eliminar)

   Todo queda montado bajo /rev/admin/* y exige el mismo JWT de admin que
   ya usan /rev/admin/revendedores y /rev/admin/impersonate (revAdminAuth).
   Se obtiene haciendo POST /rev/login con ADMIN_USER / ADMIN_PASSWORD.

   Requiere en tu archivo de arranque de server_api.js:
       require("./index_12_admin_panel")(app);
   (se le pasa la instancia de Express ya creada, para montarse en el
   mismo servidor y puerto — no abre nada nuevo).
   ════════════════════════════════════════════════════════════════ */

const { revAdminAuth, generarPinSetup } = require("./index_09_api_auth");
const { db, admin, PLATAFORMAS, CLIENTES_COLLECTION, REVENDEDORES_COLLECTION } = require("./index_01_core");
const { getCliente, patchServicio, eliminarServicioTx, buscarClienteRobusto } = require("./index_03_clientes_crm");

const PRECIOS_COLLECTION = "precios";

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error("admin_panel", e);
  fail(res, e.status || 500, e.publicError || e.message || "server");
});

function normNombre(v = "") {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
}

module.exports = function mountAdminPanel(app) {
  /* ═══════════════ PRECIOS ═══════════════
     Colección nueva "precios", 1 doc por plataforma (mismas keys que
     PLATAFORMAS en index_01_core.js). No existía antes: el endpoint viejo
     /rev/precios leía "inventario" (cuentas/capacidad), que no tiene campo
     de precio — por eso la pestaña Precios del panel de socios no mostraba
     nada útil. Este módulo también corrige ESE endpoint más abajo.
  */

  // Admin: ver TODAS las plataformas conocidas, tengan precio puesto o no.
  app.get("/rev/admin/precios", revAdminAuth, wrap(async (req, res) => {
    const snap = await db.collection(PRECIOS_COLLECTION).get();
    const porPlataforma = {};
    snap.docs.forEach((d) => { porPlataforma[d.id] = d.data() || {}; });
    const lista = Object.values(PLATAFORMAS).map((p) => {
      const doc = porPlataforma[p.key] || {};
      return {
        plataforma: p.key,
        nombre: p.nombre,
        categoria: p.categoria,
        precio: doc.precio != null ? Number(doc.precio) : null,
        activo: doc.activo !== false,
        nota: doc.nota || "",
        configurado: doc.precio != null,
      };
    }).sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));
    ok(res, { precios: lista });
  }));

  // Admin: fijar/editar el precio de una plataforma.
  app.put("/rev/admin/precios/:plataforma", revAdminAuth, wrap(async (req, res) => {
    const plataforma = String(req.params.plataforma || "").trim().toLowerCase();
    const info = PLATAFORMAS[plataforma];
    if (!info) return fail(res, 400, "plataforma_invalida");

    const precio = Number(req.body?.precio);
    if (!Number.isFinite(precio) || precio <= 0) return fail(res, 400, "precio_invalido");
    const activo = req.body?.activo !== false;
    const nota = String(req.body?.nota || "").trim().slice(0, 200);

    await db.collection(PRECIOS_COLLECTION).doc(plataforma).set({
      plataforma, precio, activo, nota,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.admin?.nombre || "Admin",
    }, { merge: true });

    ok(res, { plataforma, nombre: info.nombre, precio, activo, nota });
  }));

  /* ═══════════════ VENDEDORES ═══════════════
     GET /rev/admin/revendedores (listar) e POST /rev/admin/impersonate
     ya existían en server_api.js — esto agrega crear / editar / resetear
     PIN / eliminar, que hoy SOLO existen como comandos de Telegram
     (/addvendedor, /resetpin, /delvendedor).
  */

  app.post("/rev/admin/revendedores", revAdminAuth, wrap(async (req, res) => {
    const nombre = String(req.body?.nombre || "").trim();
    const telegramId = String(req.body?.telegramId || "").trim().replace(/[^0-9]/g, "");
    if (!nombre) return fail(res, 400, "falta_nombre");
    if (!telegramId || telegramId.length < 5) return fail(res, 400, "telegramId_invalido");

    const docId = normNombre(nombre) || String(Date.now());
    const ref = db.collection(REVENDEDORES_COLLECTION).doc(docId);
    const existente = await ref.get();
    if (existente.exists) return fail(res, 409, "ya_existe");

    const { pin, pinSetupHash } = await generarPinSetup();
    await ref.set({
      nombre, nombre_norm: docId, telegramId, activo: true, autoLastSent: "",
      pinSetupHash, pinSetupCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // El PIN solo se devuelve UNA vez, igual que en /addvendedor del bot.
    ok(res, { docId, nombre, nombre_norm: docId, telegramId, pin });
  }));

  app.patch("/rev/admin/revendedores/:id", revAdminAuth, wrap(async (req, res) => {
    const ref = db.collection(REVENDEDORES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "no_existe");

    // ⚠️ nombre_norm es el usuario de login y la llave que usan los
    // clientes (vendedor_norm) — no se toca desde acá para no romper esos
    // vínculos. Si hace falta renombrar el usuario, hay que reasignar a
    // mano los clientes primero.
    const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (req.body?.nombre !== undefined) patch.nombre = String(req.body.nombre).trim().slice(0, 120);
    if (req.body?.telegramId !== undefined) {
      const tid = String(req.body.telegramId).trim().replace(/[^0-9]/g, "");
      if (!tid || tid.length < 5) return fail(res, 400, "telegramId_invalido");
      patch.telegramId = tid;
    }
    if (req.body?.activo !== undefined) patch.activo = !!req.body.activo;

    await ref.update(patch);
    const actualizado = await ref.get();
    ok(res, { id: ref.id, ...actualizado.data() });
  }));

  app.post("/rev/admin/revendedores/:id/resetpin", revAdminAuth, wrap(async (req, res) => {
    const ref = db.collection(REVENDEDORES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "no_existe");
    const d = snap.data() || {};

    const { pin, pinSetupHash } = await generarPinSetup();
    await ref.update({
      passwordHash: admin.firestore.FieldValue.delete(),
      pinSetupHash,
      pinSetupCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    ok(res, { id: ref.id, nombre: d.nombre || ref.id, pin });
  }));

  app.delete("/rev/admin/revendedores/:id", revAdminAuth, wrap(async (req, res) => {
    const ref = db.collection(REVENDEDORES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "no_existe");
    const d = snap.data() || {};
    await ref.delete();
    // Igual que /delvendedor en el bot: no reasigna ni borra sus clientes,
    // solo el registro del vendedor. Sus clientes quedan con un
    // vendedor_norm que ya no existe hasta que los reasignes.
    ok(res, { eliminado: ref.id, nombre: d.nombre || ref.id });
  }));

  /* ═══════════════ CLIENTES ═══════════════
     Antes solo se podía renovar fecha (vía /rev/renovacion, y solo el
     propio revendedor dueño del cliente). Esto agrega vista global de
     admin, edición de datos básicos, edición de un servicio puntual
     (reusa patchServicio, la misma función que usa el bot — valida
     precio/fecha y sincroniza inventario) y borrado.
  */

  app.get("/rev/admin/clientes", revAdminAuth, wrap(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q) {
      const resultados = await buscarClienteRobusto(q);
      return ok(res, { clientes: resultados });
    }
    const vendedor = String(req.query.vendedor || "").trim().toLowerCase();
    let query = db.collection(CLIENTES_COLLECTION);
    if (vendedor) query = query.where("vendedor_norm", "==", vendedor);
    const snap = await query.limit(500).get();
    const lista = snap.docs.map((d) => {
      const c = d.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      return {
        id: d.id,
        nombre: c.nombrePerfil || c.nombre || "Sin nombre",
        telefono: c.telefono || "",
        vendedor_norm: c.vendedor_norm || "",
        servicios: servicios.length,
      };
    });
    ok(res, { clientes: lista });
  }));

  app.get("/rev/admin/clientes/:id", revAdminAuth, wrap(async (req, res) => {
    const c = await getCliente(req.params.id);
    if (!c) return fail(res, 404, "no_existe");
    ok(res, { cliente: c });
  }));

  app.patch("/rev/admin/clientes/:id", revAdminAuth, wrap(async (req, res) => {
    const ref = db.collection(CLIENTES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "no_existe");

    const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (req.body?.nombrePerfil !== undefined) patch.nombrePerfil = String(req.body.nombrePerfil).trim().slice(0, 120);
    if (req.body?.telefono !== undefined) patch.telefono = String(req.body.telefono).trim().slice(0, 40);
    if (req.body?.vendedor_norm !== undefined) {
      const vn = normNombre(req.body.vendedor_norm);
      const vendSnap = await db.collection(REVENDEDORES_COLLECTION).where("nombre_norm", "==", vn).limit(1).get();
      if (vendSnap.empty) return fail(res, 400, "vendedor_no_existe");
      patch.vendedor_norm = vn;
    }

    await ref.update(patch);
    const actualizado = await ref.get();
    ok(res, { id: ref.id, ...actualizado.data() });
  }));

  app.delete("/rev/admin/clientes/:id", revAdminAuth, wrap(async (req, res) => {
    const ref = db.collection(CLIENTES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "no_existe");
    await ref.delete();
    ok(res, { eliminado: ref.id });
  }));

  // Editar un servicio puntual del cliente (precio, fecha, correo, clave, pin...)
  app.patch("/rev/admin/clientes/:id/servicios/:idx", revAdminAuth, wrap(async (req, res) => {
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0) return fail(res, 400, "indice_invalido");
    const resultado = await patchServicio(req.params.id, idx, req.body || {});
    ok(res, resultado);
  }));

  app.delete("/rev/admin/clientes/:id/servicios/:idx", revAdminAuth, wrap(async (req, res) => {
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0) return fail(res, 400, "indice_invalido");
    const resultado = await eliminarServicioTx(req.params.id, idx);
    ok(res, resultado);
  }));
};
