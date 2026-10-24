// Registro único de vendedores y socios · Oct-2026 (copia exacta de Sublichat HQ api/_vendedores.js)
// MISMO ARCHIVO en Sublichat HQ (api/_vendedores.js) y en el TG Bot (lib_vendedores.js).
// CommonJS a propósito: lo usan mobile-core.js (CommonJS), acceso.js (ESM) y el bot (CommonJS).
//
// Antes los teléfonos y la lista del equipo estaban fijos en 5 lugares (Web, APK, Bot, portal y API)
// y GANABAN sobre lo guardado: si Relojes cambiaba de número, seguía saliendo el viejo, y un vendedor
// eliminado volvía a aparecer. Ahora:
//   1. Lo guardado manda. Orden: vendedores/{clave} (lo que se edita desde Web o Bot)
//      → revendedores/{id} (socios del Panel) → lista base (solo respaldo si nunca se editó).
//   2. Eliminar deja una marca (eliminado:true) para que la lista base no lo vuelva a sumar.
//   3. Cada cambio de número guarda el anterior en telefonosAnteriores. Así una ficha que guardó
//      el número viejo del vendedor muestra el nuevo; un número de soporte escrito a mano se respeta.
//   4. Renombrar guarda el nombre viejo como alias: las fichas viejas siguen encontrando al vendedor.

const COL = "vendedores";
const COL_SOCIOS = "revendedores";

// Respaldo de arranque (lo que estaba fijo en el código). Solo se usa si ese vendedor nunca se guardó.
const EQUIPO_BASE = Object.freeze([
  { nombre: "Relojes", telefono: "32126332", alias: ["libni"] },
  { nombre: "Sublicuentas", telefono: "89464277" },
  { nombre: "Sublicuentas 2", telefono: "89464328", alias: ["sublicuentas2"] },
  { nombre: "Geisell", telefono: "", alias: ["geissel"] },
  { nombre: "Yami", telefono: "96877246" },
  { nombre: "Manuel", telefono: "87989267" },
  { nombre: "Heber", telefono: "32174922" },
  { nombre: "Abner", telefono: "94306551" },
  { nombre: "Jimena", telefono: "88501036" },
  { nombre: "Elizabeth", telefono: "" },
  { nombre: "Lucy", telefono: "" },
  { nombre: "WolfTeam", telefono: "" },
]);

function claveVendedor(v) {
  const k = String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return k === "geissel" ? "geisell" : k;
}
// Para Firestore: la clave sirve de ID (sin "/").
function idVendedor(v) { return claveVendedor(v).replace(/\//g, "-").slice(0, 80); }

// Teléfono para comparar: Honduras se guarda con 8 dígitos; otros países con su código completo.
function telClave(v) {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("504")) d = d.slice(3);
  return d;
}
function telValido(v) { const d = telClave(v); return d.length >= 8 && d.length <= 15 ? d : ""; }
function limpiarNombre(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 60); }

// Accesos del sistema: aunque su cuenta del Panel de Socios esté desactivada, siguen siendo vendedores.
const ACCESOS_FIJOS = new Set(["sublicuentas", "relojes", "geisell"]);

let cache = { at: 0, data: null };
function limpiarCache() { cache = { at: 0, data: null }; }

function armarRegistro(docsVendedores = [], docsSocios = []) {
  const porClave = new Map(); // clave → entrada
  const alias = new Map();    // alias → clave
  const conocidos = new Set();
  const orden = [];
  const poner = (clave, entrada) => {
    if (!porClave.has(clave)) orden.push(clave);
    porClave.set(clave, { ...(porClave.get(clave) || {}), ...entrada });
  };
  EQUIPO_BASE.forEach((b) => {
    const c = claveVendedor(b.nombre);
    poner(c, { nombre: b.nombre, clave: c, telefono: telValido(b.telefono), tipo: "equipo", origen: "base", activo: true });
    (b.alias || []).forEach((a) => alias.set(claveVendedor(a), c));
    if (telValido(b.telefono)) conocidos.add(telValido(b.telefono));
  });
  docsSocios.forEach(({ id, data }) => {
    const d = data || {};
    const nombre = limpiarNombre(d.nombre || d.usuario || id);
    const c = claveVendedor(d.nombre_norm || id || nombre);
    if (!c) return;
    const tel = telValido(d.telefono || d.whatsapp);
    if (tel) conocidos.add(tel);
    const previo = porClave.get(c);
    poner(c, {
      nombre: nombre || (previo && previo.nombre) || c, clave: c,
      telefono: tel || (previo && previo.telefono) || "",
      tipo: previo && previo.tipo === "equipo" ? "equipo" : "socio",
      socioId: id, origen: "socio",
      // Vendedor desactivado (Revendedores → Desactivar acceso) = desaparece de todas las listas de Web, APK y Bot.
      // Sus fichas no se tocan y su número se sigue resolviendo. Excepción: Sublicuentas, Relojes y Geisell.
      activo: d.activo === false ? ACCESOS_FIJOS.has(c) : true,
    });
    [d.nombre, d.usuario, id].forEach((a) => { const k = claveVendedor(a); if (k && k !== c) alias.set(k, c); });
  });
  docsVendedores.forEach(({ id, data }) => {
    const d = data || {};
    const c = claveVendedor(d.clave || id);
    if (!c) return;
    (Array.isArray(d.telefonosAnteriores) ? d.telefonosAnteriores : []).forEach((t) => { const v = telValido(t); if (v) conocidos.add(v); });
    (Array.isArray(d.alias) ? d.alias : []).forEach((a) => { const k = claveVendedor(a); if (k && k !== c) alias.set(k, c); });
    if (d.eliminado === true) { if (porClave.has(c)) porClave.set(c, { ...porClave.get(c), eliminado: true }); return; }
    const previo = porClave.get(c) || {};
    const tel = d.telefono !== undefined ? telValido(d.telefono) : previo.telefono || "";
    if (tel) conocidos.add(tel);
    poner(c, {
      nombre: limpiarNombre(d.nombre) || previo.nombre || c, clave: c, telefono: tel,
      tipo: d.tipo === "socio" || previo.tipo === "socio" ? (previo.tipo === "equipo" ? "equipo" : "socio") : "equipo",
      // Un socio desactivado en el Panel sigue fuera de las listas aunque tenga registro.
      origen: "registro", activo: d.activo !== false && previo.activo !== false, eliminado: false,
      updatedAt: d.updatedAt || "", updatedBy: d.updatedBy || "",
    });
  });
  // Orden alfabético (igual que el filtro de Renovación): Sublicuentas → Sublicuentas 1 → Sublicuentas 2.
  const ordenados = orden.map((c) => porClave.get(c)).filter((v) => v && !v.eliminado && v.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true, sensitivity: "base" }));
  const telefonos = {};
  ordenados.forEach((v) => { if (v.telefono) telefonos[v.clave] = v.telefono; });
  return {
    lista: ordenados,
    nombres: ordenados.map((v) => v.nombre),
    telefonos,
    conocidos: [...conocidos],
    alias: Object.fromEntries(alias),
    eliminados: [...porClave.values()].filter((v) => v.eliminado).map((v) => v.clave),
    _porClave: porClave, _alias: alias, _conocidos: conocidos,
  };
}

async function leerRegistro(db, { fresco = false } = {}) {
  if (!fresco && cache.data && Date.now() - cache.at < 60 * 1000) return cache.data;
  const [sv, ss] = await Promise.all([
    db.collection(COL).get().catch(() => null),
    db.collection(COL_SOCIOS).get().catch(() => null),
  ]);
  const docs = (snap) => { const out = []; if (snap) snap.forEach((d) => out.push({ id: d.id, data: d.data() || {} })); return out; };
  const reg = armarRegistro(docs(sv), docs(ss));
  cache = { at: Date.now(), data: reg };
  return reg;
}

function buscar(reg, vendedor) {
  if (!reg) return null;
  let c = claveVendedor(vendedor);
  if (!c) return null;
  if (reg._alias && reg._alias.has(c)) c = reg._alias.get(c);
  const v = reg._porClave && reg._porClave.get(c);
  return v && !v.eliminado ? v : null;
}

// Número que se muestra para el vendedor de una ficha.
// - Sin número guardado → el actual del vendedor.
// - Guardó un número que fue de algún vendedor (actual o anterior) → el actual de ESTE vendedor.
// - Guardó otro número (soporte escrito a mano) → se respeta.
function telefonoVigente(reg, vendedor, guardado) {
  const v = buscar(reg, vendedor);
  const g = telClave(guardado);
  if (!g) return (v && v.telefono) || "";
  if (v && v.telefono && reg._conocidos && reg._conocidos.has(g)) return v.telefono;
  return String(guardado || "").trim();
}
function nombreVigente(reg, vendedor) { const v = buscar(reg, vendedor); return v ? v.nombre : String(vendedor || "").trim(); }

// Datos para clientes (APK / navegador). Sin datos internos.
function registroPublico(reg) {
  return {
    sellers: reg.nombres.slice(),
    sellerPhones: { ...reg.telefonos },
    sellerPhonesKnown: reg.conocidos.slice(),
    sellerAliases: { ...reg.alias },
    sellersDetail: reg.lista.map((v) => ({ nombre: v.nombre, clave: v.clave, telefono: v.telefono || "", tipo: v.tipo })),
  };
}

// Crear / editar. nombreAnterior = nombre que tenía (para renombrar). Devuelve la entrada guardada.
async function guardarVendedor(db, { nombre, telefono, nombreAnterior = "", usuario = "", tipo = "" } = {}) {
  const limpio = limpiarNombre(nombre);
  if (!limpio) throw new Error("Escriba el nombre del vendedor.");
  if (telefono != null && String(telefono).trim() && !telValido(telefono)) {
    throw new Error("Número inválido. Honduras: 8 dígitos (2255-4675). Otros países: con su código (+52 55 1234 5678).");
  }
  const reg = await leerRegistro(db, { fresco: true });
  const clave = claveVendedor(limpio);
  const anterior = nombreAnterior ? buscar(reg, nombreAnterior) : null;
  const claveAnterior = anterior ? anterior.clave : "";
  const existente = buscar(reg, limpio);
  // Sin nombreAnterior y el nombre ya existe → se edita ese mismo vendedor (no se duplica).
  if (existente && claveAnterior && existente.clave !== claveAnterior) {
    throw new Error(`Ya existe un vendedor llamado ${existente.nombre}.`);
  }
  const base = anterior || existente || null;
  const ahora = new Date().toISOString();
  const telNuevo = telefono == null ? (base && base.telefono) || "" : telValido(telefono);
  const ref = db.collection(COL).doc(idVendedor(clave));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() || {} : {};
    const anteriores = new Set((prev.telefonosAnteriores || []).map(telClave).filter(Boolean));
    const telViejo = telClave(base && base.telefono);
    if (telViejo && telViejo !== telNuevo) anteriores.add(telViejo);
    const alias = new Set((prev.alias || []).map(claveVendedor).filter(Boolean));
    if (claveAnterior && claveAnterior !== clave) alias.add(claveAnterior);
    tx.set(ref, {
      clave, nombre: limpio, telefono: telNuevo, activo: true, eliminado: false,
      tipo: tipo || (base && base.tipo) || prev.tipo || "equipo",
      telefonosAnteriores: [...anteriores].slice(-20), alias: [...alias].slice(-20),
      updatedAt: ahora, updatedBy: String(usuario || ""),
      ...(snap.exists ? {} : { createdAt: ahora, createdBy: String(usuario || "") }),
    }, { merge: true });
    if (claveAnterior && claveAnterior !== clave) {
      // Renombrado: el nombre viejo deja de aparecer en listas, pero sus fichas siguen encontrándolo (alias).
      tx.set(db.collection(COL).doc(idVendedor(claveAnterior)), { clave: claveAnterior, eliminado: true, renombradoA: clave, updatedAt: ahora, updatedBy: String(usuario || "") }, { merge: true });
    }
  });
  // Si es socio del Panel, el número y el nombre visibles también se actualizan allá (mismo registro).
  const socioId = base && base.socioId;
  if (socioId) {
    await db.collection(COL_SOCIOS).doc(socioId).set({ nombre: limpio, telefono: telNuevo, updatedAt: ahora }, { merge: true }).catch(() => null);
  }
  await auditar(db, base ? "vendedor_editado" : "vendedor_creado", { clave, nombre: limpio, antes: base ? { nombre: base.nombre, telefono: base.telefono || "" } : null, despues: { nombre: limpio, telefono: telNuevo }, usuario });
  limpiarCache();
  return buscar(await leerRegistro(db, { fresco: true }), limpio);
}

// Eliminar: deja de salir en listas de Web, APK y Bot. Sus clientes NO se borran ni se reasignan.
// Si es socio, se desactiva su acceso al Panel (reversible), no se borra su cuenta.
async function eliminarVendedor(db, { nombre, usuario = "" } = {}) {
  const reg = await leerRegistro(db, { fresco: true });
  const v = buscar(reg, nombre);
  if (!v) throw new Error("Ese vendedor ya no existe.");
  const ahora = new Date().toISOString();
  await db.collection(COL).doc(idVendedor(v.clave)).set({ clave: v.clave, nombre: v.nombre, eliminado: true, updatedAt: ahora, updatedBy: String(usuario || ""), telefonosAnteriores: (v.telefono ? [v.telefono] : []) }, { merge: true });
  if (v.socioId) await db.collection(COL_SOCIOS).doc(v.socioId).set({ activo: false, updatedAt: ahora }, { merge: true }).catch(() => null);
  await auditar(db, "vendedor_eliminado", { clave: v.clave, nombre: v.nombre, antes: { nombre: v.nombre, telefono: v.telefono || "" }, usuario });
  limpiarCache();
  return { clave: v.clave, nombre: v.nombre };
}

// Lo llaman las rutas del Panel de Socios (crear/editar/eliminar socio) para que el registro quede igual.
async function anotarCambioSocio(db, { antes = null, despues = null, usuario = "" } = {}) {
  const ahora = new Date().toISOString();
  const ref = (c) => db.collection(COL).doc(idVendedor(c));
  if (despues) {
    const c = claveVendedor(despues.nombre_norm || despues.nombre);
    if (!c) return;
    const patch = { clave: c, eliminado: false, updatedAt: ahora, updatedBy: String(usuario || "") };
    if (despues.telefono !== undefined) patch.telefono = telValido(despues.telefono);
    if (despues.nombre) patch.nombre = limpiarNombre(despues.nombre);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref(c));
      const prev = snap.exists ? snap.data() || {} : {};
      const anteriores = new Set((prev.telefonosAnteriores || []).map(telClave).filter(Boolean));
      const viejo = telClave((antes && antes.telefono) || prev.telefono);
      if (viejo && patch.telefono !== undefined && viejo !== patch.telefono) anteriores.add(viejo);
      tx.set(ref(c), { ...patch, tipo: prev.tipo || "socio", telefonosAnteriores: [...anteriores].slice(-20) }, { merge: true });
    }).catch(() => null);
  } else if (antes) {
    const c = claveVendedor(antes.nombre_norm || antes.nombre);
    if (c) await ref(c).set({ clave: c, eliminado: true, updatedAt: ahora, updatedBy: String(usuario || ""), ...(telValido(antes.telefono) ? { telefonosAnteriores: [telValido(antes.telefono)] } : {}) }, { merge: true }).catch(() => null);
  }
  limpiarCache();
}

async function auditar(db, tipo, datos) {
  try { await db.collection("auditoria_eventos").add({ tipo, ...datos, createdAt: new Date().toISOString() }); } catch (_) { /* la auditoría nunca bloquea */ }
}

module.exports = {
  EQUIPO_BASE, claveVendedor, idVendedor, telClave, telValido,
  armarRegistro, leerRegistro, limpiarCache, buscar, telefonoVigente, nombreVigente, registroPublico,
  guardarVendedor, eliminarVendedor, anotarCambioSocio,
};
