"use strict";

const {
  normVendedor,
  canonicalVendedor,
  vendedorEfectivoServicio,
  camposResumenVendedores,
} = require("./index_17_vendedores_servicio");

const MIGRATION_ID = "vendedores_por_servicio_20260828_v1";

function compact(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function prepararCliente(cliente = {}) {
  const legacyVendedor = canonicalVendedor(cliente.vendedor || cliente.vendedor_norm || "");
  const legacyNormRaw = normVendedor(cliente.vendedor_norm || legacyVendedor);
  const legacyNorm = legacyNormRaw === "geissel" ? "geisell" : legacyNormRaw;
  let heredados = 0;
  let corregidosGeisell = 0;
  let sinVendedor = 0;

  const servicios = (Array.isArray(cliente.servicios) ? cliente.servicios : []).map((servicio) => {
    const original = { ...(servicio || {}) };
    const explicitNorm = normVendedor(original.vendedor_norm || original.vendedor || "");
    const fuente = explicitNorm
      ? vendedorEfectivoServicio(original, {})
      : (legacyNorm ? {
          vendedor: legacyVendedor,
          vendedor_norm: legacyNorm,
          vendedorTelefono: String(cliente.vendedorTelefono || "").trim(),
        } : { vendedor: "", vendedor_norm: "", vendedorTelefono: "" });

    if (!explicitNorm && fuente.vendedor_norm) heredados++;
    if (!fuente.vendedor_norm) {
      sinVendedor++;
      return original;
    }
    if (normVendedor(original.vendedor || original.vendedor_norm || "") === "geissel") corregidosGeisell++;
    return {
      ...original,
      vendedor: canonicalVendedor(fuente.vendedor || fuente.vendedor_norm),
      vendedor_norm: normVendedor(fuente.vendedor_norm || fuente.vendedor),
      ...(fuente.vendedorTelefono ? { vendedorTelefono: fuente.vendedorTelefono } : {}),
    };
  });

  const resumen = camposResumenVendedores(servicios, cliente);
  const patch = {
    servicios,
    ...resumen,
    vendedoresPorServicioMigradoPor: MIGRATION_ID,
  };
  const antes = JSON.stringify(compact({
    servicios: cliente.servicios,
    vendedor: cliente.vendedor,
    vendedor_norm: cliente.vendedor_norm,
    vendedorTelefono: cliente.vendedorTelefono,
    vendedores: cliente.vendedores,
    vendedores_norm: cliente.vendedores_norm,
    clienteCompartido: cliente.clienteCompartido,
  }));
  const despues = JSON.stringify(compact({
    servicios: patch.servicios,
    vendedor: patch.vendedor,
    vendedor_norm: patch.vendedor_norm,
    vendedorTelefono: patch.vendedorTelefono,
    vendedores: patch.vendedores,
    vendedores_norm: patch.vendedores_norm,
    clienteCompartido: patch.clienteCompartido,
  }));
  return { patch, cambiado: antes !== despues, heredados, corregidosGeisell, sinVendedor };
}

async function analizar({ db }) {
  const snap = await db.collection("clientes").get();
  const cambios = [];
  let servicios = 0;
  let serviciosHeredados = 0;
  let serviciosSinVendedor = 0;
  let geisselCorregidos = 0;
  let clientesCompartidos = 0;
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    servicios += Array.isArray(data.servicios) ? data.servicios.length : 0;
    const preparado = prepararCliente(data);
    serviciosHeredados += preparado.heredados;
    serviciosSinVendedor += preparado.sinVendedor;
    geisselCorregidos += preparado.corregidosGeisell;
    if (preparado.patch.clienteCompartido) clientesCompartidos++;
    if (preparado.cambiado) cambios.push({ doc, data, preparado });
  });
  return {
    snap,
    cambios,
    resumen: {
      migrationId: MIGRATION_ID,
      clientesRevisados: snap.size,
      clientesAActualizar: cambios.length,
      serviciosRevisados: servicios,
      serviciosQueHeredaranVendedor: serviciosHeredados,
      serviciosSinVendedor,
      geisselCorregidos,
      clientesCompartidos,
    },
  };
}

async function previsualizarVendedoresPorServicio({ db }) {
  const estado = await analizar({ db });
  return estado.resumen;
}

async function aplicarVendedoresPorServicio({ db, admin, force = false }) {
  const markerRef = db.collection("config_migraciones").doc(MIGRATION_ID);
  const marker = await markerRef.get();
  if (marker.exists && marker.data()?.aplicada === true && !force) {
    return { yaAplicada: true, migrationId: MIGRATION_ID, ...(marker.data()?.resumen || {}) };
  }

  const estado = await analizar({ db });
  const backupRoot = db.collection("migraciones_backups").doc(MIGRATION_ID);
  await backupRoot.set({
    migrationId: MIGRATION_ID,
    creadoAt: admin.firestore.FieldValue.serverTimestamp(),
    preview: estado.resumen,
  }, { merge: true });

  let actualizados = 0;
  for (let pos = 0; pos < estado.cambios.length; pos += 200) {
    const batch = db.batch();
    for (const cambio of estado.cambios.slice(pos, pos + 200)) {
      const backupRef = backupRoot.collection("clientes").doc(cambio.doc.id);
      batch.set(backupRef, {
        original: compact({
          vendedor: cambio.data.vendedor,
          vendedor_norm: cambio.data.vendedor_norm,
          vendedorTelefono: cambio.data.vendedorTelefono,
          vendedores: cambio.data.vendedores,
          vendedores_norm: cambio.data.vendedores_norm,
          clienteCompartido: cambio.data.clienteCompartido,
          servicios: cambio.data.servicios,
        }),
        guardadoAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(cambio.doc.ref, {
        ...cambio.preparado.patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      actualizados++;
    }
    await batch.commit();
  }

  const resumen = { ...estado.resumen, clientesActualizados: actualizados };
  await markerRef.set({
    aplicada: true,
    aplicadaAt: admin.firestore.FieldValue.serverTimestamp(),
    resumen,
  }, { merge: true });
  return { ok: true, ...resumen };
}

module.exports = {
  MIGRATION_ID,
  prepararCliente,
  previsualizarVendedoresPorServicio,
  aplicarVendedoresPorServicio,
};
