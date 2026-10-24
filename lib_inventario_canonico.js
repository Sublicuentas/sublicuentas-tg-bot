"use strict";
// lib_inventario_canonico.js · Oct-2026 · Sincronización total Bodega ↔ fichas (TG Bot).
// Misma regla que Sublichat HQ (api/inventario.js y api/renovar.js):
// - accountId = ID del documento de "inventario". NUNCA cambia, aunque cambie el correo/usuario
//   o la plataforma. Antes el bot calculaba el ID con plataforma+correo: si el correo cambiaba
//   (o la cuenta se creó desde la Web con ID aleatorio) el bot no la encontraba o creaba otra.
// - Los cupos se calculan con los clientes realmente asignados (clientes[]), no con contadores viejos.
// - "Más vacía": menor % de ocupación; empate → más libres; llenas al final.

function normTxt(v) {
  return String(v == null ? "" : v).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function normAcceso(v) {
  return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, "");
}
function familiaPlataforma(p) {
  const k = normTxt(p).replace(/[^a-z0-9]/g, "");
  if (/^disney/.test(k)) return "disney";
  return k;
}

function identCuenta(data = {}) {
  return String(data.correo || data.ident || data.usuario || data.acceso || "").trim();
}

function conteosCuenta(data = {}, capacidadPorDefecto = 1) {
  const clientes = Array.isArray(data.clientes) ? data.clientes : [];
  const ocupados = Array.isArray(data.clientes) ? clientes.length : Math.max(0, Number(data.ocupados) || 0);
  const capacidad = Number(data.capacidad || data.total || 0) > 0 ? Number(data.capacidad || data.total) : capacidadPorDefecto;
  return { capacidad, ocupados, disponibles: Math.max(0, capacidad - ocupados), sobreasignada: capacidad > 0 && ocupados > capacidad };
}

function ordenarPorMasVacia(rows = [], capacidadDe = (r) => conteosCuenta(r).capacidad) {
  return [...rows].sort((a, b) => {
    const ca = Math.max(1, capacidadDe(a)), cb = Math.max(1, capacidadDe(b));
    const oa = conteosCuenta(a, ca).ocupados, ob = conteosCuenta(b, cb).ocupados;
    const la = Math.max(0, ca - oa), lb = Math.max(0, cb - ob);
    if ((la > 0) !== (lb > 0)) return la > 0 ? -1 : 1;
    if (oa / ca !== ob / cb) return oa / ca - ob / cb;
    return lb - la;
  });
}

// Busca la cuenta: 1) por accountId/docId, 2) por el ID calculado (cuentas creadas en el bot),
// 3) por plataforma + correo/usuario guardado (cuentas creadas en la Web o con correo cambiado).
async function resolverCuentaInventario(db, { docId = "", plataforma = "", acceso = "", docIdCalculado = "" } = {}, coleccion = "inventario") {
  const col = db.collection(coleccion);
  const id = String(docId || "").trim();
  if (id && !id.includes("/")) {
    const snap = await col.doc(id).get();
    if (snap.exists) return { id: snap.id, ref: snap.ref, data: snap.data() || {} };
  }
  const fam = familiaPlataforma(plataforma);
  const wanted = normAcceso(acceso);
  if (!wanted) return null;
  const calc = String(docIdCalculado || "").trim();
  if (calc && !calc.includes("/")) {
    const snap = await col.doc(calc).get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (normAcceso(identCuenta(d)) === wanted && (!fam || familiaPlataforma(d.plataforma) === fam)) return { id: snap.id, ref: snap.ref, data: d };
    }
  }
  const plat = String(plataforma || "").trim();
  const candidatos = [];
  try {
    const snap = plat ? await col.where("plataforma", "==", plat).get() : await col.get();
    snap.forEach((doc) => candidatos.push(doc));
  } catch (_) { /* sin índice: se busca abajo en toda la colección */ }
  let hit = candidatos.find((doc) => normAcceso(identCuenta(doc.data() || {})) === wanted);
  if (!hit && fam) {
    // Disney Premium / sin ESPN comparten familia; una cuenta puede estar guardada con la otra clave.
    let all;
    try { all = await require("./index_30_espejo_firestore").getColeccion(coleccion); } catch (_) { all = await col.get(); }
    hit = all.docs.find((doc) => {
      const d = doc.data() || {};
      return familiaPlataforma(d.plataforma) === fam && normAcceso(identCuenta(d)) === wanted;
    });
  }
  return hit ? { id: hit.id, ref: hit.ref, data: hit.data() || {} } : null;
}

// Vínculo de reparación usado por Sublichat HQ: [JSON([clienteId, compra|accountKey, perfil]), n].
// Si el correo cambia, se renombra la llave para no perder exclusiones ni ediciones manuales.
function accountKeyWeb(plataforma, correo) {
  const key = normTxt(plataforma).replace(/[^a-z0-9]/g, "");
  const aliases = { disneyp: "disney", disneys: "disney", disneypremium: "disney", disneystandard: "disney", disney: "disney" };
  return `${aliases[key] || key}|${normAcceso(correo)}`;
}
function renombrarVinculo(link, plataforma, correoViejo, correoNuevo) {
  try {
    const value = JSON.parse(link);
    const identity = JSON.parse(value[0]);
    if (identity[1] !== accountKeyWeb(plataforma, correoViejo)) return link;
    identity[1] = accountKeyWeb(plataforma, correoNuevo);
    return JSON.stringify([JSON.stringify(identity), value[1]]);
  } catch (_) { return link; }
}

// Edita correo/clave/URL de la cuenta EN SU MISMO DOCUMENTO (el accountId no cambia) y
// replica el cambio a las fichas enlazadas con sincronizarCuentaEnComprasTx (inyectada).
async function editarCuentaCanonica(db, admin, { cuenta, nuevoCorreo, nuevaClave, nuevaUrl, sincronizarFichas }) {
  if (!cuenta || !cuenta.ref) throw new Error("La cuenta ya no existe.");
  const antes = cuenta.data || {};
  const plataforma = String(antes.plataforma || "");
  const correoAnterior = identCuenta(antes);
  const patch = { accountId: cuenta.ref.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (nuevoCorreo != null) { patch.correo = String(nuevoCorreo).trim(); patch.ident = String(nuevoCorreo).trim(); }
  if (nuevaClave != null) patch.clave = String(nuevaClave).trim();
  if (nuevaUrl != null) patch.url = String(nuevaUrl).trim();
  // Fichas primero: si falla a mitad, la cuenta conserva el correo viejo y repetir encuentra los pendientes.
  let sync = { perfilesActualizados: 0, documentosActualizados: 0 };
  if (typeof sincronizarFichas === "function" && (nuevoCorreo != null || nuevaClave != null)) {
    sync = await sincronizarFichas({
      plataforma, correo: correoAnterior,
      ...(nuevoCorreo != null ? { nuevoCorreo } : {}),
      ...(nuevaClave != null ? { nuevaClave } : {}),
      asignaciones: Array.isArray(antes.clientes) ? antes.clientes : [],
      inventarioId: cuenta.ref.id,
    }) || sync;
  }
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(cuenta.ref);
    if (!snap.exists) throw new Error("La cuenta desapareció durante el cambio.");
    const actual = snap.data() || {};
    const p = { ...patch };
    if (nuevoCorreo != null && normAcceso(nuevoCorreo) !== normAcceso(correoAnterior)) {
      const ren = (l) => renombrarVinculo(l, plataforma, correoAnterior, nuevoCorreo);
      p.clientes = (Array.isArray(actual.clientes) ? actual.clientes : []).map((c) => (c && c.vinculoInventario ? { ...c, vinculoInventario: ren(c.vinculoInventario) } : c));
      if (Array.isArray(actual.exclusionesSincronizacion)) p.exclusionesSincronizacion = actual.exclusionesSincronizacion.map(ren);
    }
    tx.set(cuenta.ref, p, { merge: true });
  });
  // Fase 2 · aviso push al equipo: la ficha cambió (sin correo ni clave en el aviso).
  if (nuevoCorreo != null || nuevaClave != null) {
    const cambioCorreo = nuevoCorreo != null && normAcceso(nuevoCorreo) !== normAcceso(correoAnterior);
    const queCambio = cambioCorreo && nuevaClave != null ? "Cambió correo y clave" : cambioCorreo ? "Cambió el correo" : "Cambió la clave";
    await require("./lib_push").avisar(db, admin, { todos: true, titulo: `🔑 Cuenta ${plataforma.toUpperCase()} actualizada`,
      cuerpo: `${queCambio} · ${Number(sync.perfilesActualizados || 0)} ficha(s) ya actualizadas.`, data: { tipo: "cuenta", ir: "clientes" } });
  }
  return { accountId: cuenta.ref.id, correoAnterior, ...sync };
}

module.exports = {
  normAcceso, familiaPlataforma, identCuenta, conteosCuenta, ordenarPorMasVacia,
  resolverCuentaInventario, renombrarVinculo, accountKeyWeb, editarCuentaCanonica,
};
