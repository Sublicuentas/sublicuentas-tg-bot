"use strict";

// Migra únicamente la marca antigua EvouTouch/EvoTouch a Nanotech.
// No toca clientes, precios, fechas, credenciales, compraId, perfilId ni vendedores.
function normalizarNanotechServicio(servicio = {}) {
  const s = { ...servicio };
  const raw = String(s.plataforma || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const esLegacy = raw === "evoutouch" || /^evoutouch[1-4]$/.test(raw) || raw === "nanotech" || /^nanotech[1-4]$/.test(raw);
  if (!esLegacy) return { servicio, cambio: false };
  let dispositivos = Number(s.iptvPantallas || 0);
  if (!Number.isInteger(dispositivos) || dispositivos < 1 || dispositivos > 3) {
    const m = raw.match(/([123])$/);
    dispositivos = m ? Number(m[1]) : 1;
  }
  s.plataforma = `evoutouch${dispositivos}`; // clave interna compatible; etiqueta pública = Nanotech
  s.iptvProveedor = "evoutouch";
  s.iptvPantallas = dispositivos;
  if (typeof s.fichaTexto === "string") s.fichaTexto = s.fichaTexto.replace(/evou\s*touch|evoutouch/gi, "Nanotech");
  return { servicio: s, cambio: JSON.stringify(s) !== JSON.stringify(servicio) };
}

async function migrarNanotechClientes({ db, admin }) {
  const snap = await db.collection("clientes").get();
  let clientes = 0, servicios = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!Array.isArray(data.servicios) || !data.servicios.length) continue;
    let cambio = false;
    const nuevos = data.servicios.map(s => {
      const r = normalizarNanotechServicio(s || {});
      if (r.cambio) { cambio = true; servicios++; }
      return r.servicio;
    });
    if (!cambio) continue;
    clientes++;
    await doc.ref.set({ servicios: nuevos, updatedAt: new Date().toISOString(), nanotechMigradoAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  return { clientes, servicios };
}

module.exports = { migrarNanotechClientes, normalizarNanotechServicio };
