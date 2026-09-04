"use strict";

const { createHash } = require("crypto");
const { camposResumenVendedores } = require("./index_17_vendedores_servicio");

const MIGRATION_ID = "clientes_telefono_canonico_20260904_v1";

function normalizarTelefonoCliente(value = "") {
  let digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("504")) digits = digits.slice(3);
  return digits;
}

function normalizarNombre(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hash(value, size = 24) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, size);
}

function recordId(prefix, sourceId, index, extra = "") {
  return `${prefix}_merge_${hash(`${sourceId}|${index}|${extra}`, 20)}`;
}

function objectScore(value = {}) {
  let score = 0;
  for (const [key, item] of Object.entries(value || {})) {
    if (["updatedAt", "createdAt"].includes(key)) continue;
    if (Array.isArray(item)) score += item.length * 3;
    else if (item && typeof item === "object") score += Object.keys(item).length * 2;
    else if (item !== undefined && item !== null && String(item).trim() !== "") score += 1;
  }
  return score;
}

function mergeProfiles(first = [], second = []) {
  const result = [], positions = new Map();
  [...first, ...second].forEach((raw, index) => {
    const profile = { ...(raw || {}) };
    const id = String(profile.perfilId || profile.id || "").trim();
    const fallback = `${normalizarNombre(profile.nombre || profile.perfil)}|${String(profile.correo || "").toLowerCase()}|${String(profile.pin || profile.pinPerfil || "")}`;
    const key = id ? `id:${id}` : `legacy:${fallback || index}`;
    if (!positions.has(key)) {
      positions.set(key, result.length);
      result.push(profile);
      return;
    }
    const pos = positions.get(key);
    const previous = result[pos] || {};
    const preferred = objectScore(profile) >= objectScore(previous) ? profile : previous;
    const other = preferred === profile ? previous : profile;
    result[pos] = { ...other, ...preferred };
  });
  return result;
}

function mergeService(first = {}, second = {}) {
  const preferred = objectScore(second) >= objectScore(first) ? second : first;
  const other = preferred === second ? first : second;
  const merged = { ...other, ...preferred };
  if (Array.isArray(first.perfiles) || Array.isArray(second.perfiles)) {
    merged.perfiles = mergeProfiles(
      Array.isArray(first.perfiles) ? first.perfiles : [],
      Array.isArray(second.perfiles) ? second.perfiles : []
    );
  }
  return merged;
}

function serviciosConIdentidad(miembros = []) {
  const result = [], positions = new Map();
  miembros.forEach((member) => {
    const titular = String(member.data?.nombrePerfil || member.data?.nombre || "Cliente").trim();
    (Array.isArray(member.data?.servicios) ? member.data.servicios : []).forEach((raw, serviceIndex) => {
      const service = { ...(raw || {}) };
      service.compraId = String(service.compraId || recordId("compra", member.id, serviceIndex)).trim();
      if (Array.isArray(service.perfiles) && service.perfiles.length) {
        service.perfiles = service.perfiles.map((rawProfile, profileIndex) => {
          const profile = { ...(rawProfile || {}) };
          profile.perfilId = String(profile.perfilId || profile.id || recordId("perfil", member.id, serviceIndex, profileIndex)).trim();
          return profile;
        });
      } else {
        service.perfilId = String(service.perfilId || recordId("perfil", member.id, serviceIndex, titular)).trim();
      }
      const key = `id:${service.compraId}`;
      if (!positions.has(key)) {
        positions.set(key, result.length);
        result.push(service);
      } else {
        const pos = positions.get(key);
        result[pos] = mergeService(result[pos], service);
      }
    });
  });
  return result;
}

function clientScore(member = {}) {
  const data = member.data || {};
  const services = Array.isArray(data.servicios) ? data.servicios.length : 0;
  const access = data.accesosBeneficiarios && typeof data.accesosBeneficiarios === "object"
    ? Object.keys(data.accesosBeneficiarios).length : 0;
  const canonical = String(data.telefono || "").trim() === normalizarTelefonoCliente(data.telefono || data.telefono_norm || "") ? 1 : 0;
  return services * 1000 + (data.tokenAcceso ? 100 : 0) + access * 20 + canonical;
}

function elegirPrincipal(miembros = []) {
  return [...miembros].sort((a, b) => clientScore(b) - clientScore(a) || String(a.id).localeCompare(String(b.id)))[0];
}

function gruposDuplicados(docs = []) {
  const groups = new Map();
  for (const doc of docs) {
    const data = typeof doc.data === "function" ? (doc.data() || {}) : (doc.data || {});
    if (String(data.consolidadoEn || "").trim()) continue;
    // El nombre visible es la fuente principal. `nombre_norm` pudo quedar
    // desactualizado en fichas antiguas después de una edición manual.
    const nombre = normalizarNombre(data.nombrePerfil || data.nombre || data.nombre_norm || "");
    const telefono = normalizarTelefonoCliente(data.telefono_norm || data.telefono || data.whatsapp || "");
    // Criterio intencionalmente estricto para no unir homónimos o teléfonos
    // incompletos: mismo nombre normalizado y número hondureño de 8 dígitos.
    if (!nombre || telefono.length !== 8) continue;
    const key = `${nombre}|${telefono}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: doc.id, ref: doc.ref, data });
  }
  return [...groups.entries()].filter(([, members]) => members.length > 1).map(([key, members]) => ({ key, members }));
}

function construirConsolidacion(group = {}) {
  const members = Array.isArray(group.members) ? group.members : [];
  const primary = elegirPrincipal(members);
  if (!primary) return null;
  const telefono = String(group.key || "").split("|").pop() || normalizarTelefonoCliente(primary.data?.telefono || "");
  const servicios = serviciosConIdentidad(members);
  const access = {};
  [...members.filter((item) => item.id !== primary.id), primary].forEach((item) => {
    const source = item.data?.accesosBeneficiarios;
    if (source && typeof source === "object" && !Array.isArray(source)) Object.assign(access, source);
  });
  const mergedIds = [...new Set(members.flatMap((item) => [item.id, ...(Array.isArray(item.data?.mergedClientIds) ? item.data.mergedClientIds : [])]).map(String))];
  const loyaltySource = [...members].sort((a, b) => Number(b.data?.fidelidadCiclos || 0) - Number(a.data?.fidelidadCiclos || 0))[0] || primary;
  const loyaltyMonths = [...new Set(members.flatMap((item) => Array.isArray(item.data?.fidelidadMesesAsegurados) ? item.data.fidelidadMesesAsegurados : []))].sort();
  const summary = camposResumenVendedores(servicios, primary.data || {});
  return {
    primary,
    aliases: members.filter((item) => item.id !== primary.id),
    patch: {
      telefono,
      telefono_norm: telefono,
      nombre_norm: normalizarNombre(primary.data?.nombrePerfil || primary.data?.nombre || ""),
      servicios,
      ...summary,
      clienteUid: primary.data?.clienteUid || primary.id,
      tokenAcceso: primary.data?.tokenAcceso || access.titular?.token || members.find((item) => item.data?.tokenAcceso)?.data?.tokenAcceso || "",
      accesosBeneficiarios: access,
      fidelidadCiclos: Math.max(...members.map((item) => Number(item.data?.fidelidadCiclos || 0)), 0),
      fidelidadMesesAsegurados: loyaltyMonths,
      nivelCliente: loyaltySource.data?.nivelCliente || primary.data?.nivelCliente || "",
      fidelidadNivelNombre: loyaltySource.data?.fidelidadNivelNombre || primary.data?.fidelidadNivelNombre || "",
      mergedClientIds: mergedIds,
      consolidacionTelefonoVersion: MIGRATION_ID,
    }
  };
}

async function commitInChunks(db, entries = [], makePatch, size = 400) {
  let updated = 0;
  for (let offset = 0; offset < entries.length; offset += size) {
    const batch = db.batch();
    entries.slice(offset, offset + size).forEach((entry) => {
      batch.set(entry.ref, makePatch(entry), { merge: true });
      updated++;
    });
    await batch.commit();
  }
  return updated;
}

async function rewriteCollectionReference(db, collection, sourceId, targetId) {
  const snap = await db.collection(collection).where("clientId", "==", sourceId).get();
  await commitInChunks(db, snap.docs, (doc) => ({
    clientId: targetId,
    clientIdAnterior: sourceId,
    consolidacionTelefonoVersion: MIGRATION_ID,
  }));
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function repairInventoryReferences(db, admin, aliasMap) {
  if (!aliasMap.size) return 0;
  const snap = await db.collection("inventario").get();
  const changed = [];
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const clientes = Array.isArray(data.clientes) ? data.clientes : [];
    let dirty = false;
    const next = clientes.map((item) => {
      const oldId = String(item?.clienteId || "").trim();
      const target = aliasMap.get(oldId);
      if (!target) return item;
      dirty = true;
      return { ...(item || {}), clienteId: target, clienteIdAnterior: oldId };
    });
    if (dirty) changed.push({ ref: doc.ref, next });
  });
  await commitInChunks(db, changed, (item) => ({ clientes: item.next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
  return changed.length;
}

async function consolidarClientesDuplicadosPorTelefono({ db, admin } = {}) {
  if (!db || !admin) throw new Error("Firebase no está disponible para consolidar clientes.");
  const snap = await db.collection("clientes").get();
  const groups = gruposDuplicados(snap.docs);
  const backupRoot = db.collection("migraciones_backups").doc(MIGRATION_ID);
  if (groups.length) {
    await backupRoot.set({
      migrationId: MIGRATION_ID,
      criterio: "mismo nombre normalizado + mismo telefono hondureno de 8 digitos",
      ultimaEjecucionAt: admin.firestore.FieldValue.serverTimestamp(),
      gruposDetectados: groups.length,
    }, { merge: true });
  }

  let mergedGroups = 0, absorbed = 0, services = 0;
  for (const group of groups) {
    const plan = construirConsolidacion(group);
    if (!plan) continue;
    const batch = db.batch();
    for (const member of group.members) {
      batch.set(backupRoot.collection("clientes").doc(member.id), {
        original: member.data,
        principalId: plan.primary.id,
        guardadoAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    batch.set(plan.primary.ref, {
      ...plan.patch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      consolidadoAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    for (const alias of plan.aliases) {
      batch.set(alias.ref, {
        consolidadoEn: plan.primary.id,
        estadoRegistro: "consolidado",
        telefono: plan.patch.telefono,
        telefono_norm: plan.patch.telefono,
        servicios: [],
        vendedores: [],
        vendedores_norm: [],
        vendedor: "",
        vendedor_norm: "",
        vendedorTelefono: "",
        clienteCompartido: false,
        tokenAcceso: admin.firestore.FieldValue.delete(),
        accesosBeneficiarios: admin.firestore.FieldValue.delete(),
        referenciasConsolidadasAt: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        consolidadoAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    mergedGroups++;
    absorbed += plan.aliases.length;
    services += plan.patch.servicios.length;
  }

  // Incluye aliases creados en ejecuciones interrumpidas: las referencias se
  // reparan antes de marcarlos como terminados, por lo que un reinicio reanuda.
  const latest = await db.collection("clientes").get();
  const pendingAliases = latest.docs.map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }))
    .filter((item) => String(item.data.consolidadoEn || "").trim() && !item.data.referenciasConsolidadasAt);
  const aliasMap = new Map(pendingAliases.map((item) => [item.id, String(item.data.consolidadoEn).trim()]));
  const inventoryUpdated = await repairInventoryReferences(db, admin, aliasMap);
  let referencesUpdated = 0;
  const counterPairs = new Set();
  for (const alias of pendingAliases) {
    const targetId = aliasMap.get(alias.id);
    for (const collection of ["enlaces", "historial_clientes", "sorteo_eventos", "fidelidad_eventos", "sorteo_contadores"]) {
      const changed = await rewriteCollectionReference(db, collection, alias.id, targetId);
      referencesUpdated += changed.length;
    }
    const tickets = await rewriteCollectionReference(db, "sorteo_boletos", alias.id, targetId);
    referencesUpdated += tickets.length;
    tickets.forEach((ticket) => {
      if (ticket.sorteoId) counterPairs.add(`${targetId}|${ticket.sorteoId}`);
    });
    await alias.ref.set({ referenciasConsolidadasAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  // El contador canónico se reconstruye sin crear ni borrar boletos.
  for (const pair of counterPairs) {
    const [clientId, drawId] = pair.split("|");
    const ticketSnap = await db.collection("sorteo_boletos").where("clientId", "==", clientId).get();
    const total = ticketSnap.docs.filter((doc) => String((doc.data() || {}).sorteoId || "") === drawId).length;
    const counterId = hash(`${drawId}|${clientId}`, 40);
    await db.collection("sorteo_contadores").doc(counterId).set({
      sorteoId: drawId,
      clientId,
      total,
      consolidacionTelefonoVersion: MIGRATION_ID,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return {
    ok: true,
    migrationId: MIGRATION_ID,
    clientesRevisados: snap.size,
    gruposConsolidados: mergedGroups,
    fichasAbsorbidas: absorbed,
    serviciosEnPrincipales: services,
    referenciasActualizadas: referencesUpdated,
    cuentasBodegaActualizadas: inventoryUpdated,
  };
}

module.exports = {
  MIGRATION_ID,
  normalizarTelefonoCliente,
  normalizarNombre,
  gruposDuplicados,
  construirConsolidacion,
  consolidarClientesDuplicadosPorTelefono,
};
