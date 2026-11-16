// lib_netflix_hogar.js = COPIA FIEL de Sublichat HQ api/_netflix-hogar.js · · R196u Fase 2 — «Responsable del Hogar» de Netflix Premium. COPIA FIEL en el bot: lib_netflix_hogar.js
// PDF «Actualización operativa…» v2.0 · punto 03. Dato OPERATIVO de seguimiento en Sublichat: no cambia nada en Netflix.
// · Se guarda en la cuenta madre (documento de `inventario`, plataforma «netflix»): campo `hogar` = {clienteId, compraId,
//   perfilId, slot, nombre, asignadoAt, asignadoPor}. Un solo campo ⇒ nunca puede haber dos Hogares activos.
// · Se elige un perfil que YA está en la cuenta (clientes[] de la madre), por sus IDs; nada de texto libre.
// · Reemplazar un Hogar existente exige confirmación explícita. Todo en transacción, con historial.
// · Si el perfil con Hogar sale de la cuenta (No renovó, eliminado, trasladado) el Hogar queda «pendiente»: se avisa y
//   solo se reasigna con confirmación. No se reasigna solo.
"use strict";

const PLAT_HOGAR = "netflix";
const limpio = (s, max = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const claveCli = (c = {}) => String(c.vinculoInventario || `${c.clienteId || ""}|${c.compraId || ""}|${c.perfilId || ""}`);
const clientesDe = (d = {}) => (Array.isArray(d.clientes) ? d.clientes : []);

// Perfil (de los clientes de la madre) que coincide con el Hogar guardado: por compra/perfil y, si no, por cliente.
function perfilDelHogar(d = {}) {
  const h = d.hogar; if (!h || !h.clienteId) return null;
  const cs = clientesDe(d);
  return cs.find((c) => String(c.clienteId) === String(h.clienteId) && (!h.compraId || String(c.compraId || "") === String(h.compraId)) && (!h.perfilId || String(c.perfilId || "") === String(h.perfilId)))
    || cs.find((c) => String(c.clienteId) === String(h.clienteId) && (!h.compraId || String(c.compraId || "") === String(h.compraId)))
    || null;
}
function slotDe(d, c) { const cs = clientesDe(d); const i = cs.indexOf(c); return Number(c?.slot) || (i >= 0 ? i + 1 : null); }

// Estado legible para tarjetas, ficha, APK y Telegram.
function estadoHogar(d = {}) {
  if (String(d.plataforma || "").toLowerCase() !== PLAT_HOGAR) return { aplica: false };
  const h = d.hogar;
  if (!h || !h.clienteId) return { aplica: true, estado: "sin_asignar", texto: "Hogar sin asignar" };
  const c = perfilDelHogar(d);
  if (!c) return { aplica: true, estado: "pendiente", texto: `Hogar pendiente: ${limpio(h.nombre) || "el cliente"} ya no está en esta cuenta`, hogar: h };
  const slot = slotDe(d, c);
  return { aplica: true, estado: "asignado", texto: `Hogar: ${limpio(c.nombre || h.nombre) || "Cliente"}${slot ? ` · Perfil ${slot}` : ""}`, clienteId: String(c.clienteId), compraId: String(c.compraId || ""), perfilId: String(c.perfilId || ""), slot, nombre: limpio(c.nombre || h.nombre) };
}
// ¿Este perfil (cliente/compra) es el Hogar de su madre? Para el indicador en la ficha/entrega.
function esHogar(d = {}, { clienteId, compraId } = {}) {
  const e = estadoHogar(d);
  return e.estado === "asignado" && String(e.clienteId) === String(clienteId || "") && (!compraId || !e.compraId || String(e.compraId) === String(compraId));
}

// Lista de los 5 espacios de la madre con la marca Hogar (para el buscador del correo principal).
function perfilesConHogar(d = {}) {
  const cap = Math.max(1, Number(d.capacidad || 5));
  const cs = clientesDe(d); const e = estadoHogar(d);
  return Array.from({ length: cap }, (_, i) => {
    const c = cs.find((x) => Number(x.slot) === i + 1) || (cs.every((x) => !x.slot) ? cs[i] : null) || null;
    return { perfil: i + 1, cliente: c ? limpio(c.nombre) || "Cliente" : "Disponible", clienteId: c ? String(c.clienteId || "") : "", compraId: c ? String(c.compraId || "") : "", hogar: !!(c && e.estado === "asignado" && String(c.clienteId) === e.clienteId && String(c.compraId || "") === e.compraId) };
  });
}

async function asignarHogar(db, { inventarioId, clienteId, compraId = "", perfilId = "", confirmarReemplazo = false, usuario = "", origen = "web" } = {}) {
  if (!inventarioId || !clienteId) throw new Error("Elija la cuenta madre y el perfil.");
  const ref = db.collection("inventario").doc(String(inventarioId));
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new Error("Esa cuenta madre ya no existe.");
    const d = s.data() || {};
    if (String(d.plataforma || "").toLowerCase() !== PLAT_HOGAR) throw new Error("El Hogar solo aplica a cuentas madre de Netflix Premium.");
    const c = clientesDe(d).find((x) => String(x.clienteId) === String(clienteId) && (!compraId || String(x.compraId || "") === String(compraId)) && (!perfilId || String(x.perfilId || "") === String(perfilId)));
    if (!c) throw new Error("Ese perfil no está en esta cuenta madre.");
    const actual = estadoHogar(d);
    if (actual.estado === "asignado" && actual.clienteId === String(c.clienteId) && actual.compraId === String(c.compraId || "")) return { ok: true, yaEstaba: true, ...estadoHogar(d) };
    if (actual.estado !== "sin_asignar" && !confirmarReemplazo) {
      const e = new Error(`Esta cuenta ya tiene ${actual.texto.replace(/^Hogar pendiente: /, "un Hogar pendiente (").replace(/ ya no está en esta cuenta$/, " ya no está)")}. Confirme el reemplazo.`);
      e.code = "requiere_confirmacion"; throw e;
    }
    const slot = slotDe(d, c);
    const hogar = { clienteId: String(c.clienteId), compraId: String(c.compraId || ""), perfilId: String(c.perfilId || ""), slot: slot || null, nombre: limpio(c.nombre), asignadoAt: iso, asignadoPor: usuario };
    const hist = [...(Array.isArray(d.historialHogar) ? d.historialHogar : []), { tipo: actual.estado === "sin_asignar" ? "asignado" : "reemplazado", at: iso, por: usuario, origen, antes: d.hogar ? { clienteId: d.hogar.clienteId, nombre: d.hogar.nombre } : null, despues: { clienteId: hogar.clienteId, nombre: hogar.nombre, slot: hogar.slot } }].slice(-50);
    tx.update(ref, { hogar, historialHogar: hist, updatedAt: iso });
    return { ok: true, ...estadoHogar({ ...d, hogar }) };
  });
}

async function quitarHogar(db, { inventarioId, usuario = "", origen = "web" } = {}) {
  const ref = db.collection("inventario").doc(String(inventarioId || ""));
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa cuenta madre ya no existe.");
    const d = s.data() || {};
    if (!d.hogar) return { ok: true, estado: "sin_asignar", texto: "Hogar sin asignar" };
    const hist = [...(Array.isArray(d.historialHogar) ? d.historialHogar : []), { tipo: "quitado", at: iso, por: usuario, origen, antes: { clienteId: d.hogar.clienteId, nombre: d.hogar.nombre } }].slice(-50);
    tx.update(ref, { hogar: null, historialHogar: hist, updatedAt: iso });
    return { ok: true, estado: "sin_asignar", texto: "Hogar sin asignar" };
  });
}

// Madres con Hogar pendiente (el perfil salió de la cuenta): para avisar al administrador.
async function hogaresPendientes(db) {
  const snap = await db.collection("inventario").where("plataforma", "==", PLAT_HOGAR).get();
  return snap.docs.map((x) => ({ id: x.id, correo: (x.data() || {}).correo, ...estadoHogar(x.data() || {}) })).filter((x) => x.estado === "pendiente");
}

// ── R196v · Fuente única para leer el Hogar (PDF «Netflix Hogar y HBO Standard/Platinum» · 01/02) ──
// Web, APK y Telegram consultan AQUÍ, por el ID del documento de la cuenta madre (no por texto del nombre), y siempre
// contra Firestore en el momento (nada de copias en caché). Además revisa si la MISMA cuenta madre (plataforma + correo)
// existe en más de un documento de Bodega: el bot abre `netflix__<correo>` y la Web/APK pueden abrir otra copia; si el Hogar
// quedó en una y se mira la otra, una dice «Hogar» y la otra «sin asignar». Eso se informa como INCIDENCIA, sin inferir datos
// ni copiar el Hogar de una copia a otra: la unión de copias la decide una persona.
const normCorreo = (v) => String(v || "").trim().toLowerCase();
async function copiasDeLaMadre(db, d = {}, id = "") {
  const correo = normCorreo(d.correo); if (!correo) return [];
  const snap = await db.collection("inventario").where("plataforma", "==", PLAT_HOGAR).get();
  return snap.docs.filter((x) => x.id !== String(id) && normCorreo((x.data() || {}).correo) === correo)
    .map((x) => { const dd = x.data() || {}; const e = estadoHogar(dd); return { id: x.id, ocupados: clientesDe(dd).length, capacidad: Number(dd.capacidad || 0) || null, estadoHogar: e.estado, hogar: e.estado === "sin_asignar" ? "" : e.texto }; });
}
async function consultaHogar(db, { inventarioId } = {}) {
  const id = String(inventarioId || ""); if (!id) throw new Error("Falta la cuenta madre.");
  const s = await db.collection("inventario").doc(id).get();
  if (!s.exists) return { ok: false, error: "No encontré esa cuenta madre." };
  const d = s.data() || {};
  if (String(d.plataforma || "").toLowerCase() !== PLAT_HOGAR) return { ok: true, aplica: false, inventarioId: id };
  const hogar = estadoHogar(d);
  const copias = await copiasDeLaMadre(db, d, id);
  const conHogar = copias.filter((c) => c.estadoHogar !== "sin_asignar");
  let incidencia = "";
  if (copias.length) {
    incidencia = `Esta cuenta madre está ${copias.length + 1} veces en Bodega (mismo correo). `
      + (hogar.estado === "sin_asignar" && conHogar.length ? `El Hogar está registrado en la otra copia (${conHogar.map((c) => c.hogar).join(" / ")}). ` : "")
      + "Hay que unir las copias en una sola; no se copió ni se cambió nada.";
  }
  // `hogarDoc`: el campo tal como está guardado (IDs, sin claves ni PIN) para que la APK refresque su copia local.
  const hogarDoc = d.hogar && d.hogar.clienteId ? { clienteId: String(d.hogar.clienteId), compraId: String(d.hogar.compraId || ""), perfilId: String(d.hogar.perfilId || ""), slot: d.hogar.slot || null, nombre: limpio(d.hogar.nombre), asignadoAt: d.hogar.asignadoAt || "" } : null;
  return { ok: true, aplica: true, inventarioId: id, correo: String(d.correo || ""), hogar, hogarDoc, perfiles: perfilesConHogar(d), copias, incidencia, leidoAt: new Date().toISOString() };
}
// Informe de solo lectura para Sublicuentas: cuentas madre duplicadas y Hogares pendientes. Es la «lista de registros
// ambiguos que requieren asignación humana»: no corrige nada por su cuenta.
async function diagnosticoHogar(db) {
  const snap = await db.collection("inventario").where("plataforma", "==", PLAT_HOGAR).get();
  const grupos = new Map();
  snap.docs.forEach((x) => { const d = x.data() || {}; const k = normCorreo(d.correo); if (!k) return; if (!grupos.has(k)) grupos.set(k, []); const e = estadoHogar(d); grupos.get(k).push({ id: x.id, ocupados: clientesDe(d).length, estadoHogar: e.estado, hogar: e.estado === "sin_asignar" ? "" : e.texto }); });
  const duplicadas = [...grupos.entries()].filter(([, v]) => v.length > 1).map(([correo, copias]) => ({ correo, copias }));
  const pendientes = snap.docs.map((x) => ({ id: x.id, correo: (x.data() || {}).correo || "", ...estadoHogar(x.data() || {}) })).filter((x) => x.estado === "pendiente").map(({ id, correo, texto }) => ({ id, correo, texto }));
  const conHogar = snap.docs.filter((x) => estadoHogar(x.data() || {}).estado === "asignado").length;
  return { ok: true, madres: snap.size, conHogar, duplicadas, pendientes, leidoAt: new Date().toISOString() };
}

module.exports = { PLAT_HOGAR, estadoHogar, esHogar, perfilesConHogar, asignarHogar, quitarHogar, hogaresPendientes, claveCli, consultaHogar, diagnosticoHogar };
