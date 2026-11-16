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
  if (p && Array.isArray(d.clientes) && d.clientes.some((c) => c && (c.cuentaCompleta === true || c.tipoVenta === "cuenta_completa"))) return `${p.corto} · cuenta completa`; // R196v
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
  const cuentas = snap.docs.map((x) => ({ id: x.id, correo: (x.data() || {}).correo || "", estado: (x.data() || {}).estado || "", completa: vendidaCompleta(x.data() || {}), vendibles: cuposVendibles(x.data() || {}), ...resumenCuenta(x.data() || {}) }))
    .filter((c) => !/eliminad|baja/i.test(c.estado));
  const cuenta = (p) => cuentas.filter((c) => c.plan === p);
  const contadores = contadoresHbo(snap.docs.map((x) => x.data() || {})); // R196v · compartidas / exclusivas por plan
  return { contadores, cuentas, platinum: { cuentas: cuenta("platinum").length, libres: cuenta("platinum").reduce((a, c) => a + c.libres, 0) }, standard: { cuentas: cuenta("standard").length, libres: cuenta("standard").reduce((a, c) => a + c.libres, 0) }, sinPlan: cuenta("").length };
}

// ── R196v · Fase 3 (PDF «Netflix Hogar y HBO Standard/Platinum» · 03) — plan y MODALIDAD en la VENTA ──
// · Opciones de venta: «hbomax_standard» / «hbomax_platinum» (por perfil o cuenta completa). Se guardan como plataforma
//   «hbomax» + `planHbo`; la modalidad es el `tipoVenta` que ya existe (perfil | cuenta_completa).
// · Una cuenta vendida COMPLETA deja 0 cupos para terceros (el perfil lleva `cuentaCompleta: true`).
// · Una cuenta con perfiles de otros clientes no se puede vender completa. Standard y Platinum nunca se mezclan.
// · Ventas «HBO Max» antiguas sin plan: se respetan tal cual; solo toman plan si su cuenta de Bodega ya lo tiene (verificable).
const OPCIONES_VENTA = Object.freeze([
  { id: "hbomax_standard", plan: "standard", label: "HBO Standard · 3 perfiles", labelCompleta: "HBO Standard · cuenta completa" },
  { id: "hbomax_platinum", plan: "platinum", label: "HBO Platinum · 5 perfiles", labelCompleta: "HBO Platinum · cuenta completa" },
]);
function planDesdePlataforma(v = "") { const t = String(v || "").toLowerCase().replace(/[^a-z]/g, ""); if (!/^hbo/.test(t)) return ""; if (/platinum$/.test(t)) return "platinum"; if (/standard$/.test(t)) return "standard"; return ""; }
function esPlataformaHbo(v = "") { return /^hbo/.test(String(v || "").toLowerCase().replace(/[^a-z]/g, "")) || String(v || "").toLowerCase().trim() === "max"; }
function planValido(v = "") { const p = String(v || "").toLowerCase(); return PLANES[p] ? p : ""; }
const esCompleta = (c = {}) => c && (c.cuentaCompleta === true || c.tipoVenta === "cuenta_completa");
function vendidaCompleta(d = {}) { return Array.isArray(d.clientes) && d.clientes.some(esCompleta); }
// Cupos que quedan para VENDER a terceros (compartida). Completa vendida = 0, sin importar la capacidad nominal.
function cuposVendibles(d = {}) {
  if (vendidaCompleta(d)) return 0;
  const p = planDeCuenta(d); const cap = p ? p.capacidad : Math.max(0, Number(d.capacidad || 0));
  return Math.max(0, cap - ocupadosDe(d));
}
// ¿Se puede poner esta venta en esta cuenta? Devuelve "" si sí, o el motivo. `mismaVenta` = la venta ya estaba en la cuenta.
function validarAsignacion(d = {}, { plan = "", completa = false, compraId = "" } = {}) {
  if (!esHbo(d)) return "";
  const pc = planDeCuenta(d); const pv = planValido(plan);
  if (pv && !pc) return "Esa cuenta HBO no tiene plan definido en Bodega (Standard o Platinum). Defínalo antes de vender en ella.";
  if (pv && pc && pc.id !== pv) return `Esa cuenta es ${pc.nombre} y la venta es ${PLANES[pv].nombre}: no se mezclan.`;
  const otros = (Array.isArray(d.clientes) ? d.clientes : []).filter((c) => !compraId || String(c.compraId || "") !== String(compraId));
  const yaEsta = otros.length !== (Array.isArray(d.clientes) ? d.clientes.length : 0);
  if (completa && otros.length) return `Esa cuenta tiene ${otros.length} perfil(es) de otros clientes: no se puede vender como cuenta completa sin resolverlos primero.`;
  if (!completa && otros.some(esCompleta)) return "Esa cuenta ya está vendida como cuenta completa: no tiene perfiles para terceros.";
  if (!completa && !yaEsta && pc && otros.length >= pc.capacidad) return `Esa cuenta ${pc.corto} ya está llena (${otros.length}/${pc.capacidad}).`;
  return "";
}
// Contadores separados para Bodega: compartidas y exclusivas por plan.
function contadoresHbo(cuentas = []) {
  const base = () => ({ cuentas: 0, compartidas: 0, libres: 0, completas: 0, completasLibres: 0 });
  const out = { standard: base(), platinum: base(), sinPlan: 0 };
  cuentas.forEach((d) => {
    if (!esHbo(d) || /eliminad|baja/i.test(String(d.estado || ""))) return;
    const p = planDeCuenta(d); if (!p) { out.sinPlan += 1; return; }
    const o = out[p.id]; o.cuentas += 1;
    if (vendidaCompleta(d)) o.completas += 1;
    else { o.compartidas += 1; o.libres += cuposVendibles(d); if (ocupadosDe(d) === 0) o.completasLibres += 1; }
  });
  return out;
}

module.exports = { PLAT_HBO, PLANES, planDeCuenta, etiquetaPlan, resumenCuenta, planPorCapacidad, cambiarPlan, resumenHbo,
  OPCIONES_VENTA, planDesdePlataforma, esPlataformaHbo, planValido, vendidaCompleta, cuposVendibles, validarAsignacion, contadoresHbo };
