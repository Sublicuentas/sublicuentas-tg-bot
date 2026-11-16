// lib_hbo_planes.js = COPIA FIEL de Sublichat HQ api/_hbo-planes.js · · R196u Fase 3 — HBO Max Platinum (5 perfiles) / Standard (3 perfiles) por CUENTA. COPIA FIEL: lib_hbo_planes.js
// PDF «Actualización operativa…» v2.0 · punto 06. Las cuentas actuales están mezcladas (respuesta del dueño), así que:
// · La plataforma sigue siendo «hbomax» (no se renombra ni se migra nada). El plan es un dato de la CUENTA de Bodega
//   (`planHbo`), y la capacidad de esa cuenta pasa a ser la del plan: el límite de ventas sigue siendo `capacidad`, que ya
//   respetan Web, APK y bot, así que no se puede vender fuera de ella.
// · Cuenta vieja sin plan = «plan sin definir»: conserva su capacidad y sus clientes hasta que alguien la marque.
// · Bajar de Platinum (5) a Standard (3) se BLOQUEA si hay más de 3 perfiles ocupados: nunca se saca a un cliente.
// · Cada cambio en transacción y con historial (quién, cuándo, de qué a qué).
"use strict";

const PLAT_HBO = "hbomax";
const PLANES = { platinum: { id: "platinum", nombre: "HBO Max Platinum", corto: "Platinum", capacidad: 5 }, standard: { id: "standard", nombre: "HBO Max Standard", corto: "Standard", capacidad: 3 } };
const ocupadosDe = (d = {}) => Math.max(Number(d.ocupados || 0) || 0, Array.isArray(d.clientes) ? d.clientes.length : 0);
const esHbo = (d = {}) => String(d.plataforma || "").toLowerCase().replace(/\s+/g, "") === PLAT_HBO;

function planDeCuenta(d = {}) { const p = String(d.planHbo || "").toLowerCase(); return PLANES[p] || null; }
// «Platinum 4/5», «Standard 2/3» o «HBO 4/5 · plan sin definir».
function etiquetaPlan(d = {}) {
  if (!esHbo(d)) return "";
  const p = planDeCuenta(d); const occ = ocupadosDe(d);
  return p ? `${p.corto} ${occ}/${p.capacidad}` : `HBO ${occ}/${Math.max(1, Number(d.capacidad || 5))} · plan sin definir`;
}
function resumenCuenta(d = {}) {
  const p = planDeCuenta(d); const cap = p ? p.capacidad : Math.max(1, Number(d.capacidad || 5)); const occ = ocupadosDe(d);
  return { plan: p ? p.id : "", nombrePlan: p ? p.nombre : "Plan sin definir", capacidad: cap, ocupados: occ, libres: Math.max(0, cap - occ), sobreocupada: occ > cap, etiqueta: etiquetaPlan(d) };
}
// Plan sugerido por la capacidad al crear una cuenta nueva (5 → Platinum, 3 → Standard); cualquier otra = sin plan.
function planPorCapacidad(cap) { const n = Number(cap); return n === 5 ? "platinum" : n === 3 ? "standard" : ""; }

async function cambiarPlan(db, { inventarioId, plan, usuario = "", origen = "web" } = {}) {
  const nuevo = PLANES[String(plan || "").toLowerCase()];
  if (!nuevo) throw new Error("Plan no válido: elija Platinum (5) o Standard (3).");
  const ref = db.collection("inventario").doc(String(inventarioId || ""));
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa cuenta ya no existe.");
    const d = s.data() || {};
    if (!esHbo(d)) throw new Error("El plan solo aplica a cuentas HBO Max.");
    const antes = planDeCuenta(d); const occ = ocupadosDe(d);
    if (antes && antes.id === nuevo.id && Number(d.capacidad) === nuevo.capacidad) return { ok: true, yaEstaba: true, ...resumenCuenta(d) };
    if (occ > nuevo.capacidad) {
      const e = new Error(`No se puede pasar a ${nuevo.corto} (${nuevo.capacidad} perfiles): la cuenta tiene ${occ} perfiles ocupados. Mueva o dé de baja perfiles primero; no se saca a ningún cliente automáticamente.`);
      e.code = "sobreocupacion"; throw e;
    }
    const hist = [...(Array.isArray(d.historialPlan) ? d.historialPlan : []), { at: iso, por: usuario, origen, de: antes ? antes.id : "sin_plan", a: nuevo.id, capacidadAntes: Number(d.capacidad || 0), capacidadNueva: nuevo.capacidad, ocupados: occ }].slice(-50);
    const patch = { planHbo: nuevo.id, capacidad: nuevo.capacidad, disponibles: nuevo.capacidad - occ, disp: nuevo.capacidad - occ, historialPlan: hist, updatedAt: iso };
    tx.update(ref, patch);
    return { ok: true, ...resumenCuenta({ ...d, ...patch }) };
  });
}

// Resumen de todas las cuentas HBO (para Bodega / Control Maestro / bot): cuántas por plan y cuáles quedan por definir.
async function resumenHbo(db) {
  const snap = await db.collection("inventario").where("plataforma", "==", PLAT_HBO).get();
  const cuentas = snap.docs.map((x) => ({ id: x.id, correo: (x.data() || {}).correo || "", estado: (x.data() || {}).estado || "", ...resumenCuenta(x.data() || {}) }))
    .filter((c) => !/eliminad|baja/i.test(c.estado));
  const cuenta = (p) => cuentas.filter((c) => c.plan === p);
  return { cuentas, platinum: { cuentas: cuenta("platinum").length, libres: cuenta("platinum").reduce((a, c) => a + c.libres, 0) }, standard: { cuentas: cuenta("standard").length, libres: cuenta("standard").reduce((a, c) => a + c.libres, 0) }, sinPlan: cuenta("").length };
}

module.exports = { PLAT_HBO, PLANES, planDeCuenta, etiquetaPlan, resumenCuenta, planPorCapacidad, cambiarPlan, resumenHbo };
