// lib_hbo_planes.js = COPIA FIEL de Sublichat HQ api/_hbo-planes.js · · R196u Fase 3 — HBO Max Platinum (5 perfiles) / Standard (3 perfiles) por CUENTA (R196z3: capacidad editable por cuenta). COPIA FIEL: lib_hbo_planes.js
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
// R196z3 · UNA sola capacidad para todos (Web, APK, Telegram, Control Maestro): la guardada en la cuenta (`capacidad`).
// El plan solo da el valor PREDETERMINADO (Standard 3 · Platinum 5). Si la cuenta tiene otra capacidad, es «personalizada»
// (excepción por cuenta madre). Antes el bot tomaba la del plan y la Web la de la cuenta: por eso no coincidían.
function capacidadEfectiva(d = {}) { const n = Math.round(Number(d.capacidad) || 0); if (n > 0) return n; const p = planDeCuenta(d); return p ? p.capacidad : Math.max(1, Number(d.total || 5) || 5); }
function esPersonalizada(d = {}) { const p = planDeCuenta(d); return !!p && capacidadEfectiva(d) !== p.capacidad; }
// «Standard · 2/3», «Standard · 4/4 · Capacidad personalizada», «Platinum · cuenta completa» o «HBO · 4/5 · plan sin definir».
function etiquetaPlan(d = {}) {
  if (!esHbo(d)) return "";
  const p = planDeCuenta(d); const occ = ocupadosDe(d); const cap = capacidadEfectiva(d);
  if (p && Array.isArray(d.clientes) && d.clientes.some((c) => c && (c.cuentaCompleta === true || c.tipoVenta === "cuenta_completa"))) return `${p.corto} · cuenta completa`; // R196v
  return p ? `${p.corto} · ${occ}/${cap}${esPersonalizada(d) ? " · Capacidad personalizada" : ""}` : `HBO · ${occ}/${cap} · plan sin definir`;
}
function resumenCuenta(d = {}) {
  const p = planDeCuenta(d); const cap = capacidadEfectiva(d); const occ = ocupadosDe(d);
  return { plan: p ? p.id : "", nombrePlan: p ? p.nombre : "Plan sin definir", capacidad: cap, capacidadPlan: p ? p.capacidad : null, personalizada: esPersonalizada(d), excepcion: d.capacidadExcepcion || null,
    ocupados: occ, libres: Math.max(0, cap - occ), sobreocupada: occ > cap, etiqueta: etiquetaPlan(d) };
}
// Plan sugerido por la capacidad al crear una cuenta nueva (5 → Platinum, 3 → Standard); cualquier otra = sin plan.
function planPorCapacidad(cap) { const n = Number(cap); return n === 5 ? "platinum" : n === 3 ? "standard" : ""; }

// R196z3 · Cambiar plan y/o capacidad de UNA cuenta madre. Predeterminado: Standard 3 · Platinum 5.
// · Otra capacidad = excepción de ESA cuenta: exige `autorizarExcepcion` (el administrador confirma) y queda registrada.
// · Nunca menos capacidad que perfiles ocupados: se ofrece conservarlos (capacidad excepcional = ocupados). No se saca,
//   mueve ni desactiva ningún cliente. Solo cambian planHbo, capacidad y disponibles; clientes, precios, fechas, claves y PIN no.
const CAP_MAX = 12;
function errorCodigo(msg, code, extra = {}) { const e = new Error(msg); e.code = code; Object.assign(e, extra); return e; }
async function cambiarPlan(db, { inventarioId, plan, capacidad = null, autorizarExcepcion = false, motivo = "", usuario = "", origen = "web" } = {}) {
  const ref = db.collection("inventario").doc(String(inventarioId || ""));
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa cuenta ya no existe.");
    const d = s.data() || {};
    if (!esHbo(d)) throw new Error("El plan solo aplica a cuentas HBO Max.");
    const antes = planDeCuenta(d); const occ = ocupadosDe(d);
    const nuevo = plan ? PLANES[String(plan).toLowerCase()] : antes;
    if (!nuevo) throw new Error(plan ? "Plan no válido: elija Platinum o Standard." : "Defina primero el plan (Standard o Platinum).");
    const pedida = capacidad == null || capacidad === "" ? null : Math.round(Number(capacidad));
    if (pedida != null && !(pedida >= 1 && pedida <= CAP_MAX)) throw new Error(`Capacidad inválida: escriba un número de 1 a ${CAP_MAX}.`);
    let cap = pedida != null ? pedida : nuevo.capacidad;
    if (pedida == null && occ > cap) { // bajar de plan con más ocupados: se ofrece conservarlos con excepción autorizada
      if (!autorizarExcepcion) throw errorCodigo(`La cuenta tiene ${occ} perfiles ocupados y ${nuevo.corto} trae ${nuevo.capacidad}. Para conservarlos sin sacar a nadie, confirme una capacidad excepcional de ${occ}.`, "requiere_excepcion", { capacidadSugerida: occ, plan: nuevo.id });
      cap = occ;
    }
    if (cap < occ) throw errorCodigo(`Quedarían ${occ} perfiles ocupados en una capacidad de ${cap}. No se saca a ningún cliente: puede conservarlos con una capacidad excepcional de ${occ}.`, "sobreocupacion", { capacidadSugerida: occ, plan: nuevo.id });
    const personalizada = cap !== nuevo.capacidad;
    if (personalizada && !autorizarExcepcion) throw errorCodigo(`${nuevo.corto} trae ${nuevo.capacidad} perfiles. Una capacidad de ${cap} es una excepción de esta cuenta: confírmela.`, "requiere_excepcion", { capacidadSugerida: cap, plan: nuevo.id });
    if (antes && antes.id === nuevo.id && capacidadEfectiva(d) === cap) return { ok: true, yaEstaba: true, ...resumenCuenta(d) };
    const hist = [...(Array.isArray(d.historialPlan) ? d.historialPlan : []), { at: iso, por: usuario, origen, de: antes ? antes.id : "sin_plan", a: nuevo.id, capacidadAntes: Number(d.capacidad || 0), capacidadNueva: cap, ocupados: occ, ...(personalizada ? { excepcion: true, motivo: String(motivo || "").slice(0, 160) } : {}) }].slice(-50);
    const patch = { planHbo: nuevo.id, capacidad: cap, disponibles: Math.max(0, cap - occ), disp: Math.max(0, cap - occ), capacidadPersonalizada: personalizada,
      capacidadExcepcion: personalizada ? { capacidad: cap, capacidadPlan: nuevo.capacidad, por: usuario, origen, at: iso, motivo: String(motivo || "").slice(0, 160) } : null, historialPlan: hist, updatedAt: iso };
    tx.update(ref, patch);
    return { ok: true, ...resumenCuenta({ ...d, ...patch }) };
  });
}
// «Editar capacidad» (Standard o Platinum): misma regla, sin cambiar el plan.
function editarCapacidad(db, { inventarioId, capacidad, autorizarExcepcion = false, motivo = "", usuario = "", origen = "web" } = {}) {
  return cambiarPlan(db, { inventarioId, plan: null, capacidad, autorizarExcepcion, motivo, usuario, origen });
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
  { id: "hbomax_standard", plan: "standard", label: "HBO Standard", labelCompleta: "HBO Standard · cuenta completa" },
  { id: "hbomax_platinum", plan: "platinum", label: "HBO Platinum", labelCompleta: "HBO Platinum · cuenta completa" },
]);
function planDesdePlataforma(v = "") { const t = String(v || "").toLowerCase().replace(/[^a-z]/g, ""); if (!/^hbo/.test(t)) return ""; if (/platinum$/.test(t)) return "platinum"; if (/standard$/.test(t)) return "standard"; return ""; }
function esPlataformaHbo(v = "") { return /^hbo/.test(String(v || "").toLowerCase().replace(/[^a-z]/g, "")) || String(v || "").toLowerCase().trim() === "max"; }
function planValido(v = "") { const p = String(v || "").toLowerCase(); return PLANES[p] ? p : ""; }
const esCompleta = (c = {}) => c && (c.cuentaCompleta === true || c.tipoVenta === "cuenta_completa");
function vendidaCompleta(d = {}) { return Array.isArray(d.clientes) && d.clientes.some(esCompleta); }
// Cupos que quedan para VENDER a terceros (compartida). Completa vendida = 0, sin importar la capacidad nominal.
function cuposVendibles(d = {}) {
  if (vendidaCompleta(d)) return 0;
  return Math.max(0, capacidadEfectiva(d) - ocupadosDe(d)); // R196z3 · la capacidad de la cuenta (con excepción si la hay)
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
  if (!completa && !yaEsta && pc && otros.length >= capacidadEfectiva(d)) return `Esa cuenta ${pc.corto} ya está llena (${otros.length}/${capacidadEfectiva(d)}).`; // R196z3
  return "";
}
// Plan por el NOMBRE de un producto del catálogo de socios («HBO Max Platino», «HBO Standard · cuenta completa»…).
// Sin palabra de plan = producto genérico anterior: "" (no se adivina).
function planDesdeNombreProducto(texto = "") {
  const t = String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!/\bhbo\b|\bmax\b|hbomax/.test(t)) return "";
  if (/platin/.test(t)) return "platinum";
  if (/standard|estandar|\bstd\b/.test(t)) return "standard";
  return "";
}
// Diagnóstico de SOLO LECTURA (PDF · evidencia «lista de registros ambiguos que requieren asignación humana»).
// · Cuentas HBO sin plan (y su capacidad/ocupación). · Cuentas cuyo uso no cabe en su plan. · Ventas HBO sin plan, separando
// las que tienen plan VERIFICABLE por su cuenta de Bodega de las que necesitan una persona. No escribe nada.
async function diagnosticoHbo(db, { limiteClientes = 5000 } = {}) {
  const inv = await db.collection("inventario").where("plataforma", "==", PLAT_HBO).get();
  const cuentas = inv.docs.map((x) => ({ id: x.id, d: x.data() || {} })).filter((c) => !/eliminad|baja/i.test(String(c.d.estado || "")));
  const porCorreo = new Map(cuentas.map((c) => [String(c.d.correo || "").trim().toLowerCase(), c]));
  const sinPlan = cuentas.filter((c) => !planDeCuenta(c.d)).map((c) => ({ id: c.id, correo: c.d.correo || "", capacidad: Number(c.d.capacidad || 0), ocupados: ocupadosDe(c.d), sugerencia: planPorCapacidad(c.d.capacidad) ? `su capacidad (${c.d.capacidad}) coincide con ${PLANES[planPorCapacidad(c.d.capacidad)].corto}; confirme antes de marcarla` : "capacidad distinta de 3 o 5: decide una persona" }));
  const fueraDePlan = cuentas.filter((c) => { const p = planDeCuenta(c.d); return p && ocupadosDe(c.d) > capacidadEfectiva(c.d); }).map((c) => ({ id: c.id, correo: c.d.correo || "", plan: planDeCuenta(c.d).corto, ocupados: ocupadosDe(c.d), capacidad: capacidadEfectiva(c.d) }));
  // R196z3 · capacidad guardada distinta de la del plan SIN excepción registrada (p. ej. Platinum con capacidad 4): antes el bot
  // mostraba la del plan y la Web la de la cuenta. Solo se informa: decide una persona (plan real o excepción).
  const capacidadDistinta = cuentas.filter((c) => esPersonalizada(c.d) && !c.d.capacidadExcepcion).map((c) => ({ id: c.id, correo: c.d.correo || "", plan: planDeCuenta(c.d).corto, capacidadGuardada: capacidadEfectiva(c.d), capacidadPlan: planDeCuenta(c.d).capacidad, ocupados: ocupadosDe(c.d), historial: (Array.isArray(c.d.historialPlan) ? c.d.historialPlan : []).slice(-3),
    sugerencia: ocupadosDe(c.d) > planDeCuenta(c.d).capacidad ? `tiene ${ocupadosDe(c.d)} ocupados: si es ${planDeCuenta(c.d).corto}, confirme excepción de ${ocupadosDe(c.d)}` : `confirme si es ${planDeCuenta(c.d).corto} ${planDeCuenta(c.d).capacidad} o una excepción de ${capacidadEfectiva(c.d)}` }));
  const refCli = db.collection("clientes"); const cli = await (typeof refCli.limit === "function" ? refCli.limit(limiteClientes) : refCli).get();
  const ventasSinPlan = [];
  cli.docs.forEach((x) => {
    const c = x.data() || {}; if (String(c.consolidadoEn || "").trim()) return;
    (Array.isArray(c.servicios) ? c.servicios : []).forEach((s) => {
      if (!s || !esPlataformaHbo(s.plataforma) || planValido(s.planHbo)) return;
      const cuenta = porCorreo.get(String(s.correo || "").trim().toLowerCase());
      const pc = cuenta ? planDeCuenta(cuenta.d) : null;
      ventasSinPlan.push({ clienteId: x.id, cliente: String(c.nombrePerfil || c.nombre || "Cliente").slice(0, 80), compraId: String(s.compraId || ""), correo: String(s.correo || ""), modalidad: s.tipoVenta === "cuenta_completa" ? "cuenta completa" : "perfil", planVerificable: pc ? pc.id : "", accion: pc ? `su cuenta de Bodega es ${pc.corto}: al editar la venta toma ese plan` : "requiere asignación humana (la cuenta no tiene plan o no está en Bodega)" });
    });
  });
  return { ok: true, cuentas: cuentas.length, sinPlan, fueraDePlan, capacidadDistinta, ventasSinPlan, ventasRequierenPersona: ventasSinPlan.filter((v) => !v.planVerificable).length, leidoAt: new Date().toISOString() };
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

module.exports = { PLAT_HBO, PLANES, planDeCuenta, etiquetaPlan, resumenCuenta, planPorCapacidad, cambiarPlan, editarCapacidad, capacidadEfectiva, esPersonalizada, resumenHbo,
  OPCIONES_VENTA, planDesdePlataforma, esPlataformaHbo, planValido, vendidaCompleta, cuposVendibles, validarAsignacion, contadoresHbo, planDesdeNombreProducto, diagnosticoHbo };
