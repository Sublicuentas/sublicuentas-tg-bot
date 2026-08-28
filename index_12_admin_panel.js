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
const { db, admin, CLIENTES_COLLECTION, REVENDEDORES_COLLECTION } = require("./index_01_core");
const { getCliente, patchServicio, eliminarServicioTx, buscarClienteRobusto } = require("./index_03_clientes_crm");
const {
  normVendedor,
  canonicalVendedor,
  resumenVendedoresCliente,
  clientePerteneceAVendedor,
} = require("./index_17_vendedores_servicio");
const {
  TARIFA_PROPIETARIOS_ID,
  CATALOGO_PROPIETARIOS,
  tarifaIdParaSocio,
} = require("./index_15_catalogo_socios");
const {
  previsualizarActualizacion,
  aplicarActualizacion,
} = require("./index_16_migracion_precios_socios");
const {
  previsualizarVendedoresPorServicio,
  aplicarVendedoresPorServicio,
} = require("./index_18_migracion_vendedores_servicio");

const PRECIOS_COLLECTION = "precios";
const PRECIOS_ESPECIALES_COLLECTION = "precios_especiales";

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error("admin_panel", e);
  fail(res, e.status || 500, e.publicError || e.message || "server");
});

function normNombre(v = "") {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
}

function tarifaPrecios(req) {
  return String(req.query?.tarifa || req.body?.tarifaId || "general").trim() === TARIFA_PROPIETARIOS_ID
    ? TARIFA_PROPIETARIOS_ID
    : "general";
}

function coleccionPrecios(req) {
  return tarifaPrecios(req) === "general" ? PRECIOS_COLLECTION : PRECIOS_ESPECIALES_COLLECTION;
}

module.exports = function mountAdminPanel(app) {
  /* ═══════════════ PRECIOS ═══════════════
     ⚠️ CORRECCIÓN (ago-2026): la primera versión de esto asumía que los
     precios eran 1-por-plataforma (llave = key de PLATAFORMAS). Resultó
     que el catálogo REAL que ya usan los socios (el que ven en "Catálogo
     mayorista" y el que arma el formulario de "Nueva compra") vive
     hardcodeado en revendedoreschat/index.html como `const PRECIOS=[...]`
     — agrupado por categoría, con variantes por ítem (ej. "Oleada · 1
     dispositivo" y "Oleada · 3 dispositivos" son dos precios distintos
     del mismo nombre). Colección rediseñada para calzar con eso: 1 doc
     Firestore = 1 ítem del catálogo (no 1 por plataforma).

     GET /rev/precios (el que ya consume revendedoreschat) devuelve los
     ítems reagrupados en el MISMO formato {cat, sub, items:[{n,s,p,d}]}
     que ya espera ese frontend — así no hay que tocarle la lógica de
     "Nueva compra" (compraTipoDesdeCatalogo, etc.), solo la fuente de
     datos. Ver migrar_precios_catalogo.js para la carga inicial con los
     precios que ya estaban hardcodeados.
  */

  // Admin: lista plana de todos los ítems (para editar uno por uno).
  app.get("/rev/admin/precios", revAdminAuth, wrap(async (req, res) => {
    // ✅ Sin orderBy múltiple (evita necesitar índice compuesto en
    // Firestore): la colección es chica, se ordena en memoria.
    const tarifaId = tarifaPrecios(req);
    const col = db.collection(coleccionPrecios(req));
    const snap = tarifaId === "general" ? await col.get() : await col.where("tarifaId", "==", tarifaId).get();
    const lista = snap.docs.map((d) => {
      const data = d.data() || {};
      // Algunos ítems semilla guardan su id de catálogo dentro del documento.
      // Para editar/borrar, el panel necesita siempre el ID real de Firestore.
      return { ...data, catalogId: data.catalogId || data.id || "", id: d.id, tarifaId };
    });
    lista.sort((a, b) => (Number(a.categoriaOrden) || 999) - (Number(b.categoriaOrden) || 999) || (Number(a.orden) || 999) - (Number(b.orden) || 999));
    ok(res, { precios: lista, tarifaId });
  }));

  // Admin: crear un ítem nuevo del catálogo.
  app.post("/rev/admin/precios", revAdminAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const categoria = String(b.categoria || "").trim();
    const nombre = String(b.nombre || "").trim();
    if (!categoria) return fail(res, 400, "falta_categoria");
    if (!nombre) return fail(res, 400, "falta_nombre");
    const precio = b.precio === null || b.precio === "" || b.precio === undefined ? null : Number(b.precio);
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) return fail(res, 400, "precio_invalido");

    const doc = {
      categoria, categoriaSub: String(b.categoriaSub || "").trim(),
      categoriaOrden: Number.isFinite(Number(b.categoriaOrden)) ? Number(b.categoriaOrden) : 999,
      nombre, variante: String(b.variante || "").trim(),
      precio, // null = "Por comisión" (mismo significado que it.p===null en el catálogo original)
      detalle: String(b.detalle || "").trim().slice(0, 600),
      activo: b.activo !== false,
      orden: Number.isFinite(Number(b.orden)) ? Number(b.orden) : 999,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.admin?.nombre || "Admin",
    };
    const tarifaId = tarifaPrecios(req);
    if (tarifaId !== "general") doc.tarifaId = tarifaId;
    const ref = await db.collection(coleccionPrecios(req)).add(doc);
    ok(res, { id: ref.id, ...doc, tarifaId });
  }));

  // Admin: editar un ítem existente (parcial).
  app.put("/rev/admin/precios/:id", revAdminAuth, wrap(async (req, res) => {
    const tarifaId = tarifaPrecios(req);
    const ref = db.collection(coleccionPrecios(req)).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "no_existe");

    const b = req.body || {};
    const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.admin?.nombre || "Admin" };
    if (b.categoria !== undefined) patch.categoria = String(b.categoria).trim();
    if (b.categoriaSub !== undefined) patch.categoriaSub = String(b.categoriaSub).trim();
    if (b.categoriaOrden !== undefined) patch.categoriaOrden = Number(b.categoriaOrden) || 999;
    if (b.nombre !== undefined) patch.nombre = String(b.nombre).trim();
    if (b.variante !== undefined) patch.variante = String(b.variante).trim();
    if (b.detalle !== undefined) patch.detalle = String(b.detalle).trim().slice(0, 600);
    if (b.activo !== undefined) patch.activo = !!b.activo;
    if (b.orden !== undefined) patch.orden = Number(b.orden) || 999;
    if (b.precio !== undefined) {
      const precio = b.precio === null || b.precio === "" ? null : Number(b.precio);
      if (precio !== null && (!Number.isFinite(precio) || precio < 0)) return fail(res, 400, "precio_invalido");
      patch.precio = precio;
    }

    await ref.update(patch);
    const actualizado = await ref.get();
    ok(res, { ...actualizado.data(), id: ref.id, tarifaId });
  }));

  // Admin: borrar un ítem del catálogo.
  app.delete("/rev/admin/precios/:id", revAdminAuth, wrap(async (req, res) => {
    const tarifaId = tarifaPrecios(req);
    const ref = db.collection(coleccionPrecios(req)).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "no_existe");
    await ref.delete();
    ok(res, { eliminado: ref.id, tarifaId });
  }));

  // ✅ NUEVO: importar el catálogo inicial con un botón, sin entrar a la
  // Shell de Render. Es la MISMA lógica de migrar_precios_catalogo.js
  // (los precios que ya estaban hardcodeados en revendedoreschat/index.html),
  // pero disponible como endpoint para que Sublichat la dispare con un clic.
  // Seguro de correr más de una vez: si el ítem ya existe (misma
  // categoría+nombre+variante), lo actualiza en vez de duplicarlo.
  const PRECIOS_INICIALES = [
    { cat: '📺 Streaming', sub: 'Plan mensual', items: [
      { n: 'Netflix', p: 110, d: '👤 Perfil personal: correo y contraseña\n📺 Reproduce en 1 dispositivo a la vez\n🔐 Más perfiles: sin clave, acceso por código\n🏠 A los 20 días puede pedir código hogar' },
      { n: 'Disney+ Premium', p: 80, d: '🔢 Acceso por código\n👤 PIN de perfil\n📱 1 dispositivo' },
      { n: 'Disney+ Standar', p: 50, d: '🔢 Acceso por código\n👤 PIN de perfil\n📱 1 dispositivo' },
      { n: 'Max', p: 60, d: '📺 En TV: acceso por código\n📱 En celular: se da clave\n👤 PIN de perfil · 1 dispositivo' },
      { n: 'Vix', p: 30, d: '📧 Se entrega correo y contraseña\n📱 1 dispositivo' },
      { n: 'Viki Rakuten', p: 60, d: '📧 Se entrega correo y contraseña\n📱 1 dispositivo' },
      { n: 'Prime Video', p: 60, d: '🔢 Acceso por código\n👤 PIN de perfil · 1 dispositivo' },
      { n: 'Paramount+', p: 60, d: '📧 Se entrega correo y contraseña\n📱 1 dispositivo' },
      { n: 'Crunchyroll', p: 60, d: '👤 PIN de perfil\n📱 1 dispositivo' },
      { n: 'Oleada', s: '1 dispositivo', p: 70, d: '▶️ Reproduce en 1 a la vez\n🤖 Solo dispositivos Android / Web' },
      { n: 'Oleada', s: '3 dispositivos', p: 130, d: '▶️ Reproduce en 1 a la vez\n🤖 Solo dispositivos Android / Web' },
      { n: 'IPTV', s: '1 pantalla', p: 80, d: '📲 Funciona en cualquier dispositivo\n🎁 Prueba gratis de 3 horas' },
      { n: 'IPTV', s: '2 pantallas', p: 110, d: '📲 Funciona en cualquier dispositivo\n🎁 Prueba gratis de 3 horas' },
      { n: 'IPTV', s: '3 pantallas', p: 140, d: '📲 Funciona en cualquier dispositivo\n🎁 Prueba gratis de 3 horas' },
    ]},
    { cat: '🎶 Música', sub: 'Plan mensual', items: [
      { n: 'Spotify Premium', p: 80, d: '📧 Se entrega correo y contraseña' },
      { n: 'Deezer Premium', p: 50, d: '📧 Se entrega correo y contraseña' },
    ]},
    { cat: '💻 Productividad', items: [
      { n: 'Canva Edu Pro', s: '1 mes', p: 20, d: '✉️ Invitación al correo del cliente\n⚠️ Debe estar registrado en Canva' },
      { n: 'Microsoft 365', s: '1 año · correo y clave · 5 disp · 100 GB', p: 200, d: '📧 Se entrega correo y contraseña\n💻 5 dispositivos\n☁️ 100 GB en Drive' },
      { n: 'Microsoft 365', s: '1 año · a correo del cliente · 1 TB', p: 350, d: '📧 Al correo del cliente\n🗓️ Vigencia 1 año\n💻 Nivel 5 dispositivos\n☁️ 1 TB en Drive' },
      { n: 'Office 2021 Pro Plus', s: 'Windows · licencia permanente', p: 200, d: '🪟 Solo para Windows\n🔑 Serial de activación\n♾️ Licencia permanente' },
      { n: 'Office 2024 Pro Plus', s: 'Windows · licencia permanente', p: 250, d: '🪟 Solo para Windows\n🔑 Serial de activación\n♾️ Licencia permanente' },
      { n: 'Antivirus McAfee', s: '1 año · 1 dispositivo', p: 150, d: '🛡️ Protección 1 dispositivo\n🔑 Se entrega key / serial\n🗓️ Vigencia 1 año' },
      { n: 'Antivirus McAfee', s: '1 año · 3 dispositivos', p: 350, d: '🛡️ Protección 3 dispositivos\n🔑 Se entrega serial\n🗓️ Vigencia 1 año' },
    ]},
    { cat: '🤖 Inteligencia Artificial', items: [
      { n: 'Gemini Pro', s: '1 mes', p: 100, d: '✉️ Invitación al Gmail del cliente' },
    ]},
    { cat: '🎮 Recargas de juegos', items: [
      { n: 'Free Fire', s: 'Por comisión', p: null, d: '💬 Consultar precios con su asesor' },
    ]},
  ];
  function slugPrecio(v) {
    return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }
  app.post("/rev/admin/precios/importar-inicial", revAdminAuth, wrap(async (req, res) => {
    const col = db.collection(PRECIOS_COLLECTION);
    let creados = 0, actualizados = 0, categoriaOrden = 0;
    for (const grupo of PRECIOS_INICIALES) {
      categoriaOrden += 1;
      let orden = 0;
      for (const it of grupo.items) {
        orden += 1;
        const claveNatural = `${slugPrecio(grupo.cat)}__${slugPrecio(it.n)}__${slugPrecio(it.s || "")}`;
        const existente = await col.where("claveNatural", "==", claveNatural).limit(1).get();
        const doc = {
          claveNatural,
          categoria: grupo.cat,
          categoriaSub: grupo.sub || "",
          categoriaOrden,
          nombre: it.n,
          variante: it.s || "",
          precio: it.p == null ? null : Number(it.p),
          detalle: it.d || "",
          activo: true,
          orden,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: req.admin?.nombre || "importacion_inicial",
        };
        if (!existente.empty) {
          await existente.docs[0].ref.set(doc, { merge: true });
          actualizados++;
        } else {
          doc.createdAt = admin.firestore.FieldValue.serverTimestamp();
          await col.add(doc);
          creados++;
        }
      }
    }
    ok(res, { creados, actualizados });
  }));

  // Previsualización y aplicación única de la tarifa solicitada para
  // Sublicuentas, Sublicuentas 2, Relojes y Geisell. La aplicación también
  // corrige Geissel -> Geisell y actualiza los precios de sus clientes.
  app.get("/rev/admin/actualizaciones/precios-agosto-2026", revAdminAuth, wrap(async (_req, res) => {
    ok(res, await previsualizarActualizacion({ db }));
  }));

  app.post("/rev/admin/actualizaciones/precios-agosto-2026", revAdminAuth, wrap(async (req, res) => {
    const resultado = await aplicarActualizacion({
      db,
      admin,
      generarPinSetup,
      force: req.body?.force === true,
    });
    ok(res, resultado);
  }));

  // Migra fichas antiguas al modelo de vendedor por cuenta. Cada servicio
  // sin vendedor hereda el vendedor legacy del cliente y se crea respaldo.
  app.get("/rev/admin/actualizaciones/vendedores-por-servicio", revAdminAuth, wrap(async (_req, res) => {
    ok(res, await previsualizarVendedoresPorServicio({ db }));
  }));

  app.post("/rev/admin/actualizaciones/vendedores-por-servicio", revAdminAuth, wrap(async (req, res) => {
    ok(res, await aplicarVendedoresPorServicio({ db, admin, force: req.body?.force === true }));
  }));

  // Permite restaurar la lista especial si se vacía, sin tocar clientes ni
  // vendedores. La migración completa de arriba es la opción recomendada.
  app.post("/rev/admin/precios/importar-especial", revAdminAuth, wrap(async (req, res) => {
    const ops = CATALOGO_PROPIETARIOS.map((row) => ({
      id: `${TARIFA_PROPIETARIOS_ID}__${row.id}`,
      data: {
        ...row,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.admin?.nombre || "Admin",
      },
    }));
    const batch = db.batch();
    ops.forEach(({ id, data }) => batch.set(db.collection(PRECIOS_ESPECIALES_COLLECTION).doc(id), data, { merge: true }));
    await batch.commit();
    ok(res, { tarifaId: TARIFA_PROPIETARIOS_ID, actualizados: ops.length });
  }));

  /* ═══════════════ VENDEDORES ═══════════════
     GET /rev/admin/revendedores (listar) e POST /rev/admin/impersonate
     ya existían en server_api.js — esto agrega crear / editar / resetear
     PIN / eliminar, que hoy SOLO existen como comandos de Telegram
     (/addvendedor, /resetpin, /delvendedor).
  */

  app.post("/rev/admin/revendedores", revAdminAuth, wrap(async (req, res) => {
    let nombre = String(req.body?.nombre || "").trim();
    if (normNombre(nombre) === "geissel") nombre = "Geisell";
    const telegramId = String(req.body?.telegramId || "").trim().replace(/[^0-9]/g, "");
    const telefono = String(req.body?.telefono || "").trim().replace(/[^0-9]/g, "");
    if (!nombre) return fail(res, 400, "falta_nombre");
    if (telegramId && telegramId.length < 5) return fail(res, 400, "telegramId_invalido");
    if (telefono && telefono.length < 8) return fail(res, 400, "telefono_invalido");
    if (!telegramId && !telefono) return fail(res, 400, "falta_telefono_o_telegram");

    const docId = normNombre(nombre) || String(Date.now());
    const ref = db.collection(REVENDEDORES_COLLECTION).doc(docId);
    const existente = await ref.get();
    if (existente.exists) return fail(res, 409, "ya_existe");

    const { pin, pinSetupHash } = await generarPinSetup();
    await ref.set({
      nombre, nombre_norm: docId, telegramId, telefono, activo: true, autoLastSent: "",
      tarifaId: tarifaIdParaSocio({ nombre, nombre_norm: docId }),
      pinSetupHash, pinSetupCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // El PIN solo se devuelve UNA vez, igual que en /addvendedor del bot.
    ok(res, { docId, nombre, nombre_norm: docId, telegramId, telefono, pin });
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
    if (req.body?.nombre !== undefined) {
      const nombre = String(req.body.nombre).trim().slice(0, 120);
      patch.nombre = normNombre(nombre) === "geissel" ? "Geisell" : nombre;
    }
    if (req.body?.telegramId !== undefined) {
      const tid = String(req.body.telegramId).trim().replace(/[^0-9]/g, "");
      if (tid && tid.length < 5) return fail(res, 400, "telegramId_invalido");
      patch.telegramId = tid;
    }
    if (req.body?.telefono !== undefined) {
      const tel = String(req.body.telefono).trim().replace(/[^0-9]/g, "");
      if (tel && tel.length < 8) return fail(res, 400, "telefono_invalido");
      patch.telefono = tel;
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
      let resultados = await buscarClienteRobusto(q);
      const vendedorFiltro = normVendedor(req.query.vendedor || "");
      if (vendedorFiltro) resultados = resultados.filter((c) => clientePerteneceAVendedor(c, vendedorFiltro));
      return ok(res, { clientes: resultados.map((c) => {
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        const resumen = resumenVendedoresCliente(servicios, c);
        return {
          id: c.id,
          nombre: c.nombrePerfil || c.nombre || "Sin nombre",
          telefono: c.telefono || "",
          vendedor: resumen.vendedores.join(" + ") || c.vendedor || "",
          vendedor_norm: resumen.vendedores_norm[0] || c.vendedor_norm || "",
          vendedores: resumen.vendedores,
          vendedores_norm: resumen.vendedores_norm,
          clienteCompartido: resumen.clienteCompartido,
          servicios: servicios.length,
        };
      }) });
    }
    const vendedor = normVendedor(req.query.vendedor || "");
    const snap = await db.collection(CLIENTES_COLLECTION).limit(500).get();
    const lista = snap.docs.filter((d) => !vendedor || clientePerteneceAVendedor(d.data() || {}, vendedor)).map((d) => {
      const c = d.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      const resumen = resumenVendedoresCliente(servicios, c);
      return {
        id: d.id,
        nombre: c.nombrePerfil || c.nombre || "Sin nombre",
        telefono: c.telefono || "",
        vendedor: resumen.vendedores.join(" + ") || c.vendedor || "",
        vendedor_norm: resumen.vendedores_norm[0] || c.vendedor_norm || "",
        vendedores: resumen.vendedores,
        vendedores_norm: resumen.vendedores_norm,
        clienteCompartido: resumen.clienteCompartido,
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
      return fail(res, 409, "vendedor_se_asigna_por_servicio");
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
    const patch = { ...(req.body || {}) };
    if (patch.vendedor !== undefined || patch.vendedor_norm !== undefined) {
      const vn = normVendedor(patch.vendedor_norm || patch.vendedor || "");
      const vendSnap = await db.collection(REVENDEDORES_COLLECTION).where("nombre_norm", "==", vn).limit(1).get();
      if (vendSnap.empty) return fail(res, 400, "vendedor_no_existe");
      const vendedorDoc = vendSnap.docs[0].data() || {};
      patch.vendedor = canonicalVendedor(vendedorDoc.nombre || patch.vendedor || vn);
      patch.vendedor_norm = vn;
      patch.vendedorTelefono = String(patch.vendedorTelefono || vendedorDoc.telefono || "").trim();
      patch.vendedorAsignadoAt = new Date().toISOString();
      patch.vendedorAsignadoPor = req.admin?.nombre || "Admin";
    }
    const resultado = await patchServicio(req.params.id, idx, patch, String(req.body?.compraId || ""));
    ok(res, resultado);
  }));

  app.delete("/rev/admin/clientes/:id/servicios/:idx", revAdminAuth, wrap(async (req, res) => {
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0) return fail(res, 400, "indice_invalido");
    const resultado = await eliminarServicioTx(req.params.id, idx, String(req.query?.compraId || ""));
    ok(res, resultado);
  }));
};
