/* Migración segura e idempotente: precios por vendedor + Geisell + Sublicuentas 2. */

const {
  TARIFA_PROPIETARIOS_ID,
  CATALOGO_PROPIETARIOS,
  normSocio,
  precioEspecialParaServicio,
} = require("./index_15_catalogo_socios");

const MIGRATION_ID = "precios_socios_20260828_v1";
const TARGETS = new Set(["sublicuentas", "sublicuentas 2", "relojes", "geisell", "geissel"]);

function canonicalVendor(value) {
  const n = normSocio(value);
  if (n === "geissel" || n === "geisell") return { nombre: "Geisell", norm: "geisell" };
  if (n === "sublicuentas 2") return { nombre: "Sublicuentas 2", norm: "sublicuentas 2" };
  if (n === "sublicuentas") return { nombre: "Sublicuentas", norm: "sublicuentas" };
  if (n === "relojes") return { nombre: "Relojes", norm: "relojes" };
  return null;
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== undefined));
}

function sameNumber(a, b) {
  return Number(a || 0) === Number(b || 0);
}

function analizarClientes(docs = []) {
  const cambios = [];
  const ambiguos = new Map();
  let serviciosRevisados = 0;
  let serviciosConPrecio = 0;
  for (const doc of docs) {
    const data = doc.data() || {};
    const actual = canonicalVendor(data.vendedor_norm || data.vendedor || "");
    if (!actual || !TARGETS.has(normSocio(data.vendedor_norm || data.vendedor || ""))) continue;
    const servicios = Array.isArray(data.servicios) ? data.servicios : [];
    let cambioPrecio = false;
    const nuevosServicios = servicios.map((servicio) => {
      serviciosRevisados++;
      const regla = precioEspecialParaServicio(servicio || {});
      if (!regla) return servicio;
      if (regla.ambiguo) {
        ambiguos.set(regla.regla, (ambiguos.get(regla.regla) || 0) + 1);
        return servicio;
      }
      serviciosConPrecio++;
      if (sameNumber(servicio && servicio.precio, regla.precio)) return servicio;
      cambioPrecio = true;
      return { ...(servicio || {}), precio: regla.precio, precioActualizadoPor: MIGRATION_ID };
    });
    const vendedorCambio = normSocio(data.vendedor_norm) !== actual.norm || String(data.vendedor || "").trim() !== actual.nombre;
    if (cambioPrecio || vendedorCambio) {
      cambios.push({
        id: doc.id,
        ref: doc.ref,
        data,
        patch: {
          vendedor: actual.nombre,
          vendedor_norm: actual.norm,
          servicios: nuevosServicios,
        },
        cambioPrecio,
        vendedorCambio,
      });
    }
  }
  return {
    cambios,
    serviciosRevisados,
    serviciosConPrecio,
    ambiguos: [...ambiguos.entries()].map(([motivo, cantidad]) => ({ motivo, cantidad })),
  };
}

async function cargarEstado(db) {
  const [revendedores, clientes] = await Promise.all([
    db.collection("revendedores").get(),
    db.collection("clientes").get(),
  ]);
  return { revendedores, clientes };
}

async function previsualizarActualizacion({ db }) {
  const { revendedores, clientes } = await cargarEstado(db);
  const analisis = analizarClientes(clientes.docs);
  const geisellDocs = revendedores.docs.filter((d) => ["geissel", "geisell"].includes(normSocio((d.data() || {}).nombre_norm || (d.data() || {}).nombre || d.id)));
  const sociosObjetivo = revendedores.docs.filter((d) => TARGETS.has(normSocio((d.data() || {}).nombre_norm || (d.data() || {}).nombre || d.id)));
  return {
    migrationId: MIGRATION_ID,
    tarifaId: TARIFA_PROPIETARIOS_ID,
    itemsTarifa: CATALOGO_PROPIETARIOS.length,
    sociosObjetivo: sociosObjetivo.length,
    registrosGeisellEncontrados: geisellDocs.length,
    clientesAActualizar: analisis.cambios.length,
    serviciosRevisados: analisis.serviciosRevisados,
    serviciosConRegla: analisis.serviciosConPrecio,
    iptvPendientes: analisis.ambiguos,
  };
}

async function commitOps(db, ops = []) {
  let committed = 0;
  for (let pos = 0; pos < ops.length; pos += 350) {
    const batch = db.batch();
    for (const op of ops.slice(pos, pos + 350)) {
      if (op.type === "delete") batch.delete(op.ref);
      else if (op.type === "update") batch.update(op.ref, op.data);
      else batch.set(op.ref, op.data, op.options || {});
    }
    await batch.commit();
    committed += Math.min(350, ops.length - pos);
  }
  return committed;
}

function backupRef(db, collection, id) {
  return db.collection("migraciones_backups").doc(MIGRATION_ID).collection(collection).doc(String(id));
}

async function migrarHistorialGeisell({ db, admin }) {
  const specs = [
    { collection: "renovaciones", nombre: "socio", norm: "socio_norm" },
    { collection: "compras", nombre: "socio", norm: "socio_norm" },
    { collection: "sugerencias", nombre: "nombre", norm: "nombre_norm" },
    { collection: "recompensas_socios", nombre: "socio", norm: "socio_norm" },
  ];
  let total = 0;
  for (const spec of specs) {
    const snap = await db.collection(spec.collection).get();
    const ops = [];
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      if (normSocio(d[spec.norm] || d[spec.nombre]) !== "geissel") continue;
      ops.push({
        type: "set",
        ref: backupRef(db, spec.collection, doc.id),
        data: { original: compact({ [spec.nombre]: d[spec.nombre], [spec.norm]: d[spec.norm] }), guardadoAt: admin.firestore.FieldValue.serverTimestamp() },
        options: { merge: true },
      });
      ops.push({
        type: "update",
        ref: doc.ref,
        data: { [spec.nombre]: "Geisell", [spec.norm]: "geisell", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      });
      total++;
    }
    await commitOps(db, ops);
  }
  return total;
}

async function aplicarActualizacion({ db, admin, generarPinSetup, force = false }) {
  const markerRef = db.collection("config_migraciones").doc(MIGRATION_ID);
  const marker = await markerRef.get();
  if (marker.exists && marker.data()?.aplicada === true && !force) {
    return { yaAplicada: true, ...(marker.data().resumen || {}), migrationId: MIGRATION_ID };
  }

  const preview = await previsualizarActualizacion({ db });
  const backupRoot = db.collection("migraciones_backups").doc(MIGRATION_ID);
  await backupRoot.set({ migrationId: MIGRATION_ID, creadoAt: admin.firestore.FieldValue.serverTimestamp(), preview }, { merge: true });

  // 1) Tarifa especial exacta solicitada.
  const priceOps = [];
  const preciosPrevios = await db.collection("precios_especiales").where("tarifaId", "==", TARIFA_PROPIETARIOS_ID).get();
  const previosPorId = new Map(preciosPrevios.docs.map((doc) => [doc.id, doc]));
  for (const row of CATALOGO_PROPIETARIOS) {
    const id = `${TARIFA_PROPIETARIOS_ID}__${row.id}`;
    const ref = db.collection("precios_especiales").doc(id);
    const old = previosPorId.get(id);
    if (old) {
      priceOps.push({ type: "set", ref: backupRef(db, "precios_especiales", id), data: { original: old.data(), guardadoAt: admin.firestore.FieldValue.serverTimestamp() }, options: { merge: true } });
    }
    priceOps.push({
      type: "set",
      ref,
      data: { ...row, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: MIGRATION_ID },
      options: { merge: true },
    });
  }
  await commitOps(db, priceOps);

  // 2) Consolidar cualquier Geissel/Geisell en una identidad canónica.
  const revSnap = await db.collection("revendedores").get();
  const relacionados = revSnap.docs.filter((d) => ["geissel", "geisell"].includes(normSocio((d.data() || {}).nombre_norm || (d.data() || {}).nombre || d.id)));
  const correcto = relacionados.find((d) => d.id === "geisell" || normSocio((d.data() || {}).nombre_norm) === "geisell");
  const conCredencial = relacionados.find((d) => !!(d.data() || {}).passwordHash)
    || relacionados.find((d) => !!String((d.data() || {}).telegramId || "").trim());
  const fuente = conCredencial || correcto || relacionados[0];
  const geisellRef = db.collection("revendedores").doc("geisell");
  const geisellPrev = await geisellRef.get();
  const baseGeisell = {
    ...(correcto ? correcto.data() : {}),
    ...(geisellPrev.exists ? geisellPrev.data() : {}),
    ...(fuente ? fuente.data() : {}),
  };
  const revOps = [];
  for (const doc of relacionados) {
    revOps.push({ type: "set", ref: backupRef(db, "revendedores", doc.id), data: { original: doc.data(), guardadoAt: admin.firestore.FieldValue.serverTimestamp() }, options: { merge: true } });
    if (doc.ref.path !== geisellRef.path) revOps.push({ type: "delete", ref: doc.ref });
  }
  revOps.push({
    type: "set",
    ref: geisellRef,
    data: { ...baseGeisell, nombre: "Geisell", nombre_norm: "geisell", tarifaId: TARIFA_PROPIETARIOS_ID, activo: baseGeisell.activo !== false, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    options: { merge: true },
  });

  // Asignar la tarifa a Sublicuentas y Relojes sin alterar sus credenciales.
  for (const doc of revSnap.docs) {
    const n = normSocio((doc.data() || {}).nombre_norm || (doc.data() || {}).nombre || doc.id);
    if (!["sublicuentas", "relojes"].includes(n)) continue;
    revOps.push({ type: "set", ref: backupRef(db, "revendedores", doc.id), data: { original: doc.data(), guardadoAt: admin.firestore.FieldValue.serverTimestamp() }, options: { merge: true } });
    revOps.push({ type: "update", ref: doc.ref, data: { tarifaId: TARIFA_PROPIETARIOS_ID, updatedAt: admin.firestore.FieldValue.serverTimestamp() } });
  }

  // Crear Sublicuentas 2 con teléfono de WhatsApp. Telegram queda opcional.
  const sub2Existing = revSnap.docs.find((d) => normSocio((d.data() || {}).nombre_norm || (d.data() || {}).nombre || d.id) === "sublicuentas 2");
  let sublicuentas2Pin = "";
  if (sub2Existing) {
    revOps.push({ type: "set", ref: backupRef(db, "revendedores", sub2Existing.id), data: { original: sub2Existing.data(), guardadoAt: admin.firestore.FieldValue.serverTimestamp() }, options: { merge: true } });
    revOps.push({ type: "set", ref: sub2Existing.ref, data: { nombre: "Sublicuentas 2", nombre_norm: "sublicuentas 2", telefono: "89464328", tarifaId: TARIFA_PROPIETARIOS_ID, activo: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, options: { merge: true } });
  } else {
    const setup = await generarPinSetup();
    sublicuentas2Pin = setup.pin;
    revOps.push({
      type: "set",
      ref: db.collection("revendedores").doc("sublicuentas 2"),
      data: {
        nombre: "Sublicuentas 2", nombre_norm: "sublicuentas 2", telefono: "89464328", telegramId: "",
        tarifaId: TARIFA_PROPIETARIOS_ID, activo: true, autoLastSent: "",
        pinSetupHash: setup.pinSetupHash,
        pinSetupCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }
  await commitOps(db, revOps);

  // 3) Corregir vendedores y precios en los clientes de los socios indicados.
  const clientesSnap = await db.collection("clientes").get();
  const analisis = analizarClientes(clientesSnap.docs);
  const clientOps = [];
  for (const cambio of analisis.cambios) {
    clientOps.push({
      type: "set",
      ref: backupRef(db, "clientes", cambio.id),
      data: {
        original: compact({ vendedor: cambio.data.vendedor, vendedor_norm: cambio.data.vendedor_norm, servicios: cambio.data.servicios }),
        guardadoAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      options: { merge: true },
    });
    clientOps.push({
      type: "update",
      ref: cambio.ref,
      data: { ...cambio.patch, updatedAt: admin.firestore.FieldValue.serverTimestamp(), preciosActualizadosPor: MIGRATION_ID },
    });
  }
  await commitOps(db, clientOps);

  // 4) La identidad histórica también debe decir Geisell.
  const historialGeisell = await migrarHistorialGeisell({ db, admin });
  const resumen = {
    tarifaId: TARIFA_PROPIETARIOS_ID,
    itemsTarifa: CATALOGO_PROPIETARIOS.length,
    clientesActualizados: analisis.cambios.length,
    serviciosRevisados: analisis.serviciosRevisados,
    serviciosConRegla: analisis.serviciosConPrecio,
    iptvPendientes: analisis.ambiguos,
    registrosGeisellFusionados: relacionados.length,
    historialGeisellActualizado: historialGeisell,
    sublicuentas2Creado: !sub2Existing,
  };
  await markerRef.set({ aplicada: true, aplicadaAt: admin.firestore.FieldValue.serverTimestamp(), resumen });
  return { ok: true, migrationId: MIGRATION_ID, ...resumen, sublicuentas2Pin };
}

module.exports = {
  MIGRATION_ID,
  previsualizarActualizacion,
  aplicarActualizacion,
};
