// lib_disney_tipo.js · R206 — Cambiar el TIPO de una cuenta madre Disney: Premium CON ESPN (disneyp) ↔ Premium SIN ESPN (disneys).
// COPIA FIEL: Sublichat HQ api/_disney-tipo.js (misma regla en Web y bot).
// · La cuenta cambia de plataforma EN SU MISMO documento de `inventario` (mismo id): fichas, Finanzas y Control Maestro siguen
//   ligados. Se guarda historial (`historialTipo`) y de dónde venía (`movedFromPlatform`).
// · Capacidad: si la cuenta tenía el predeterminado del tipo viejo (con ESPN 6 · sin ESPN 3) toma el del tipo nuevo; una capacidad
//   personalizada se conserva. Nunca queda menos capacidad que perfiles ocupados: el servidor pide confirmar una EXCEPCIÓN
//   (capacidad = ocupados). No se saca, mueve ni desactiva ningún cliente.
// · Las ventas ligadas a esa cuenta (por inventarioId o por su correo) pasan al mismo tipo, con historial. Nunca se tocan
//   precios, fechas, PIN, perfiles, montos ni registros financieros.
"use strict";

const TIPOS = Object.freeze({
  disneyp: { id: "disneyp", nombre: "Disney Premium con ESPN", corto: "Con ESPN", capacidad: 6 },
  disneys: { id: "disneys", nombre: "Disney Premium sin ESPN", corto: "Sin ESPN", capacidad: 3 },
});
const CAP_MAX = 12;
const norm = (v = "") => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
// «disneys», «Disney Premium sin ESPN», «disney standard» → disneys · cualquier otro Disney → disneyp · otra plataforma → "".
function tipoDisney(p) {
  const t = norm(p); if (!/^disney/.test(t)) return "";
  return /sinespn|^disneys$|standard|estandar/.test(t) ? "disneys" : "disneyp";
}
const normC = (v) => String(v || "").trim().toLowerCase();
const ocupadosDe = (d = {}) => Math.max(Number(d.ocupados || 0) || 0, Array.isArray(d.clientes) ? d.clientes.length : 0);
function errorCodigo(msg, code, extra = {}) { const e = new Error(msg); e.code = code; Object.assign(e, extra); return e; }

async function cambiarTipo(db, { inventarioId, tipo, autorizarExcepcion = false, motivo = "", usuario = "", origen = "web" } = {}) {
  const nuevo = TIPOS[String(tipo || "").toLowerCase()];
  if (!nuevo) throw new Error("Tipo no válido: elija Disney Premium con ESPN o sin ESPN.");
  const ref = db.collection("inventario").doc(String(inventarioId || ""));
  const pre = await ref.get(); if (!pre.exists) throw new Error("Esa cuenta ya no existe.");
  const correo = normC((pre.data() || {}).correo);
  // Nunca dos documentos con el mismo correo en el mismo tipo.
  if (correo) {
    const dup = await db.collection("inventario").where("plataforma", "==", nuevo.id).get();
    const otro = dup.docs.find((x) => x.id !== ref.id && normC((x.data() || {}).correo) === correo && String((x.data() || {}).estado || "") !== "eliminada");
    if (otro) throw new Error(`Ya existe ${nuevo.nombre} con ese correo. No se cambió nada.`);
  }
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa cuenta ya no existe.");
    const d = s.data() || {};
    const antes = tipoDisney(d.plataforma);
    if (!antes) throw new Error("El cambio de tipo solo aplica a cuentas Disney.");
    if (antes === nuevo.id) return { ok: true, yaEstaba: true, plataforma: nuevo.id, nombre: nuevo.nombre, capacidad: Number(d.capacidad || 0) || TIPOS[antes].capacidad };
    const occ = ocupadosDe(d);
    const capActual = Math.round(Number(d.capacidad || d.total || 0)) || TIPOS[antes].capacidad;
    let cap = capActual === TIPOS[antes].capacidad ? nuevo.capacidad : capActual;
    if (cap > CAP_MAX) cap = CAP_MAX;
    if (occ > cap) {
      if (!autorizarExcepcion) throw errorCodigo(`La cuenta tiene ${occ} perfiles ocupados y quedaría con capacidad ${cap}. Para conservarlos sin sacar a nadie, confirme una capacidad excepcional de ${occ}.`, "requiere_excepcion", { capacidadSugerida: occ, tipo: nuevo.id });
      cap = occ;
    }
    const disponibles = Math.max(0, cap - occ);
    const hist = [...(Array.isArray(d.historialTipo) ? d.historialTipo : []), { at: iso, por: usuario, origen, de: antes, a: nuevo.id, capacidadAntes: capActual, capacidadNueva: cap, ocupados: occ, ...(motivo ? { motivo: String(motivo).slice(0, 160) } : {}) }].slice(-20);
    const estado = String(d.estado || "activa");
    const patch = { plataforma: nuevo.id, capacidad: cap, disponibles, disp: disponibles, movedFromPlatform: antes, historialTipo: hist, updatedAt: iso,
      ...(estado === "activa" || estado === "llena" ? { estado: disponibles <= 0 ? "llena" : "activa" } : {}),
      ...(cap !== nuevo.capacidad ? { capacidadExcepcion: { capacidad: cap, capacidadTipo: nuevo.capacidad, por: usuario, origen, at: iso, motivo: String(motivo || "").slice(0, 160) } } : { capacidadExcepcion: null }) };
    tx.update(ref, patch);
    return { ok: true, de: antes, plataforma: nuevo.id, nombre: nuevo.nombre, capacidad: cap, ocupados: occ, disponibles, personalizada: cap !== nuevo.capacidad };
  });
}

// Las ventas ligadas a la cuenta copian el tipo nuevo (ficha, Control Maestro, Socios, Finanzas y bot dicen lo mismo).
async function sincronizarVentas(db, { inventarioId, usuario = "", origen = "web" } = {}) {
  const id = String(inventarioId || ""); const s = await db.collection("inventario").doc(id).get();
  if (!s.exists) return { ok: false, ventas: 0 };
  const d = s.data() || {}; const tipo = tipoDisney(d.plataforma); if (!tipo) return { ok: true, ventas: 0 };
  const correo = normC(d.correo); const iso = new Date().toISOString();
  const liga = (sv) => String(sv.inventarioId || sv.accountId || "") === id || (correo && normC(sv.correo) === correo) || (Array.isArray(sv.perfiles) && sv.perfiles.some((p) => p && (String(p.inventarioId || "") === id || (correo && normC(p.correo) === correo))));
  const ids = [...new Set((Array.isArray(d.clientes) ? d.clientes : []).map((c) => String(c && c.clienteId || "")).filter(Boolean))];
  let ventas = 0;
  for (const cid of ids) {
    ventas += await db.runTransaction(async (tx) => {
      const ref = db.collection("clientes").doc(cid); const cs = await tx.get(ref); if (!cs.exists) return 0;
      const c = cs.data() || {}; if (String(c.consolidadoEn || "").trim()) return 0;
      let k = 0;
      const servicios = (Array.isArray(c.servicios) ? c.servicios : []).map((sv) => {
        if (!sv || !tipoDisney(sv.plataforma) || !liga(sv) || sv.plataforma === tipo) return sv;
        k += 1;
        return { ...sv, plataforma: tipo, historialTipo: [...(Array.isArray(sv.historialTipo) ? sv.historialTipo : []), { at: iso, de: sv.plataforma || "", a: tipo, por: usuario, origen, inventarioId: id }].slice(-10) };
      });
      if (k) tx.update(ref, { servicios });
      return k;
    });
  }
  return { ok: true, ventas };
}

module.exports = { TIPOS, tipoDisney, cambiarTipo, sincronizarVentas };
