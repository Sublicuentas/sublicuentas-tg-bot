// lib_bodega_vip.js = COPIA FIEL de Sublichat HQ api/_bodega-vip.js · · R196u — Bodega Netflix VIP (una unidad = un acceso VIP/Extra). COPIA FIEL en el bot: lib_bodega_vip.js
// PDF «Actualización operativa de inventario, cuentas y catálogo» v2.0 · puntos 01 y 02.
// · Fuente única: cada unidad es un documento de la colección `inventario` (plataforma «vipnetflix», capacidad 1), el
//   mismo que ya usan Bodega, Control Maestro, la APK y el bot. No hay colección paralela.
// · Cargar a Bodega NO es una venta ni un ingreso: solo deja la unidad «disponible» con su proveedor/lote/costo de referencia.
//   El costo real sigue saliendo de Finanzas (lotes R137); aquí solo se guarda como dato del lote.
// · Importación idempotente: id determinista por correo → reenviar el mismo lote no crea nada dos veces.
// · Las claves nunca se devuelven en vistas previas, resultados, auditoría ni logs.
"use strict";

const PLAT = "vipnetflix";
const ESTADOS = ["disponible", "reservado", "asignado", "suspendido", "revision"];
const ETIQUETA_ESTADO = { disponible: "Disponible", reservado: "Reservado", asignado: "Asignado", suspendido: "Suspendido", revision: "Requiere revisión" };
const PROVEEDORES = ["Trap colombiano", "Deku peruano", "Propio"];
const MAX_LINEAS = 300;

const normCorreo = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");
const correoValido = (s) => /^[^\s@]+@[^\s@]+\.[a-z0-9-]{2,}$/i.test(String(s || ""));
const docIdVip = (correo) => `${PLAT}__${normCorreo(correo).replace(/[.#$/\[\]\s]+/g, "_")}`;
const limpio = (s, max = 80) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// «correo | clave», «correo clave», «correo:clave», «correo;clave» o «correo<TAB>clave». Una cuenta por línea.
function parsearLineas(texto = "") {
  const lineas = String(texto || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINEAS + 1);
  const items = [], invalidas = [];
  lineas.slice(0, MAX_LINEAS).forEach((l, i) => {
    const m = l.match(/^([^\s|:;,\t]+@[^\s|:;,\t]+)\s*(?:[|:;,\t]\s*|\s+)(.+)$/) || l.match(/^([^\s|:;,\t]+@[^\s|:;,\t]+)$/);
    const correo = m ? normCorreo(m[1]) : "";
    const clave = m && m[2] ? String(m[2]).trim() : "";
    if (!correo || !correoValido(correo)) return invalidas.push({ linea: i + 1, motivo: "correo inválido" });
    if (!clave) return invalidas.push({ linea: i + 1, correo, motivo: "falta la clave" });
    if (clave.length < 3 || clave.length > 80) return invalidas.push({ linea: i + 1, correo, motivo: "clave con largo inválido" });
    items.push({ linea: i + 1, correo, clave });
  });
  if (lineas.length > MAX_LINEAS) invalidas.push({ linea: MAX_LINEAS + 1, motivo: `máximo ${MAX_LINEAS} líneas por lote` });
  return { items, invalidas };
}

// Estado operativo (no se duplica en otro campo): suspendido / revisión son marcas manuales; lo demás sale de la ocupación real.
function estadoUnidad(d = {}) {
  const manual = String(d.estadoBodega || "").toLowerCase();
  if (manual === "suspendido" || manual === "revision") return manual;
  const ocup = Number(d.ocupados || 0) || (Array.isArray(d.clientes) ? d.clientes.length : 0);
  if (ocup >= Math.max(1, Number(d.capacidad || 1))) return "asignado";
  if (manual === "reservado") return "reservado";
  return "disponible";
}

async function unidadesVip(db) {
  const snap = await db.collection("inventario").where("plataforma", "==", PLAT).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}
async function correosNetflixPremium(db) {
  const snap = await db.collection("inventario").where("plataforma", "==", "netflix").get();
  return new Set(snap.docs.map((d) => normCorreo((d.data() || {}).correo)));
}

// Vista previa SIN claves: total, nuevas, repetidas dentro del lote, ya existentes, ya asignadas e inválidas.
async function previsualizar(db, texto = "") {
  const { items, invalidas } = parsearLineas(texto);
  const existentes = new Map((await unidadesVip(db)).map((u) => [normCorreo(u.correo), u]));
  const premium = await correosNetflixPremium(db);
  const vistos = new Set(); const nuevas = [], repetidas = [], yaExistentes = [], yaAsignadas = [];
  const malas = invalidas.map((x) => ({ ...x }));
  for (const it of items) {
    if (vistos.has(it.correo)) { repetidas.push({ linea: it.linea, correo: it.correo }); continue; }
    vistos.add(it.correo);
    const ex = existentes.get(it.correo);
    if (ex) { (estadoUnidad(ex) === "asignado" ? yaAsignadas : yaExistentes).push({ linea: it.linea, correo: it.correo, estado: ETIQUETA_ESTADO[estadoUnidad(ex)] }); continue; }
    if (premium.has(it.correo)) { malas.push({ linea: it.linea, correo: it.correo, motivo: "ese correo ya es una cuenta Netflix Premium" }); continue; }
    nuevas.push({ linea: it.linea, correo: it.correo });
  }
  return { total: items.length + invalidas.length, nuevas, repetidas, yaExistentes, yaAsignadas, invalidas: malas };
}

function datosLote({ proveedor, lote, costoUsdt, vencimientoProveedor } = {}) {
  const prov = limpio(proveedor, 60);
  if (!prov) throw new Error("Elija el proveedor.");
  const costo = costoUsdt === "" || costoUsdt == null ? null : Number(String(costoUsdt).replace(",", "."));
  if (costo != null && (!Number.isFinite(costo) || costo < 0 || costo > 1000)) throw new Error("Costo USDT inválido.");
  const venc = String(vencimientoProveedor || "").trim();
  if (venc && !/^\d{2}\/\d{2}\/\d{4}$/.test(venc)) throw new Error("Vencimiento del proveedor: use dd/mm/aaaa o déjelo vacío.");
  return { proveedor: prov, lote: limpio(lote, 60), costoUsdt: costo, vencimientoProveedor: venc || "sin confirmar" };
}

// Importa SOLO las nuevas. Cada unidad en su propia transacción: si ya existe (otro envío, otro canal) no se toca.
async function importar(db, { texto = "", proveedor, lote, costoUsdt, vencimientoProveedor, usuario = "", origen = "web" } = {}) {
  const meta = datosLote({ proveedor, lote, costoUsdt, vencimientoProveedor });
  const prev = await previsualizar(db, texto);
  const claves = new Map(parsearLineas(texto).items.map((it) => [it.correo, it.clave]));
  const iso = new Date().toISOString();
  const creadas = [], yaEstaban = [];
  for (const n of prev.nuevas) {
    const ref = db.collection("inventario").doc(docIdVip(n.correo));
    const hecho = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists) return false;
      tx.set(ref, {
        accountId: ref.id, plataforma: PLAT, correo: n.correo, ident: n.correo, clave: claves.get(n.correo) || "",
        capacidad: 1, ocupados: 0, disponibles: 1, disp: 1, clientes: [], estado: "activa", estadoBodega: "disponible",
        proveedor: meta.proveedor, lote: meta.lote, costoUsdt: meta.costoUsdt, vencimientoProveedor: meta.vencimientoProveedor,
        tienePin: false, pin: "",
        historialBodega: [{ tipo: "alta", at: iso, por: usuario, origen, lote: meta.lote, proveedor: meta.proveedor }],
        createdAt: iso, updatedAt: iso,
      });
      return true;
    });
    (hecho ? creadas : yaEstaban).push(n.correo);
  }
  if (creadas.length) {
    // auditoría sin claves
    await db.collection("auditoria_eventos").add({ tipo: "bodega_vip_lote", plataforma: PLAT, cantidad: creadas.length, proveedor: meta.proveedor, lote: meta.lote, costoUsdt: meta.costoUsdt, usuario, origen, createdAt: iso });
  }
  const existentes = prev.yaExistentes.length + prev.yaAsignadas.length + yaEstaban.length;
  return {
    disponibles: creadas.length, existentes, errores: prev.invalidas.length + prev.repetidas.length,
    fallas: [...prev.invalidas, ...prev.repetidas.map((r) => ({ ...r, motivo: "repetido en el lote" }))].map((f) => ({ linea: f.linea, correo: f.correo || "", motivo: f.motivo })),
    resumen: `${creadas.length} disponibles / ${existentes} ya existentes / ${prev.invalidas.length + prev.repetidas.length} errores`,
  };
}

// Listado sin claves (para Web/APK/bot): estado, proveedor, lote, costo y a quién está asignada.
async function listar(db, { estado = "" } = {}) {
  const us = await unidadesVip(db);
  const filas = us.map((u) => {
    const est = estadoUnidad(u);
    const c = Array.isArray(u.clientes) && u.clientes[0] ? u.clientes[0] : null;
    return { id: u.id, correo: u.correo, estado: est, etiqueta: ETIQUETA_ESTADO[est], proveedor: u.proveedor || "sin proveedor", lote: u.lote || "", costoUsdt: u.costoUsdt ?? null,
      vencimientoProveedor: u.vencimientoProveedor || "sin confirmar", tienePin: !!u.tienePin, cliente: c ? (c.nombre || c.clienteId || "") : "", clienteId: c?.clienteId || "", tieneClave: !!String(u.clave || "").trim() };
  }).filter((f) => !estado || f.estado === estado).sort((a, b) => ESTADOS.indexOf(a.estado) - ESTADOS.indexOf(b.estado) || a.correo.localeCompare(b.correo));
  const conteo = Object.fromEntries(ESTADOS.map((e) => [e, filas.filter((f) => f.estado === e).length]));
  return { unidades: filas, conteo };
}

// Asignar una unidad Disponible a una compra EXISTENTE (no crea venta, no cambia fecha ni precio del cliente).
// Transacción: si dos vendedores la toman a la vez, solo una gana; la otra recibe «ya fue asignada».
async function asignar(db, { inventarioId, clienteId, compraId = "", nombre = "", usuario = "", origen = "web" } = {}) {
  if (!inventarioId || !clienteId) throw new Error("Falta la unidad o el cliente.");
  const ref = db.collection("inventario").doc(String(inventarioId));
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new Error("Esa unidad VIP ya no existe.");
    const d = s.data() || {};
    if (d.plataforma !== PLAT) throw new Error("Esa cuenta no es Netflix VIP.");
    const est = estadoUnidad(d);
    if (est !== "disponible" && est !== "reservado") throw new Error(`Esa unidad ya está ${ETIQUETA_ESTADO[est].toLowerCase()}: elija otra.`);
    const clientes = [{ clienteId: String(clienteId), compraId: String(compraId || ""), nombre: limpio(nombre, 80), asignadoAt: iso, asignadoPor: usuario }];
    const hist = [...(Array.isArray(d.historialBodega) ? d.historialBodega : []), { tipo: "asignada", at: iso, por: usuario, origen, clienteId: String(clienteId), compraId: String(compraId || "") }].slice(-50);
    tx.update(ref, { clientes, ocupados: 1, disponibles: 0, disp: 0, estadoBodega: "asignado", historialBodega: hist, updatedAt: iso });
    return { ok: true, inventarioId: ref.id, correo: d.correo, estado: "asignado" };
  });
}

// Suspender / marcar revisión / reactivar (manual, con historial). No toca a quién está asignada.
async function marcarEstado(db, { inventarioId, estado, nota = "", usuario = "", origen = "web" } = {}) {
  if (!["suspendido", "revision", "disponible"].includes(estado)) throw new Error("Estado no permitido.");
  const ref = db.collection("inventario").doc(String(inventarioId || ""));
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa unidad VIP ya no existe.");
    const d = s.data() || {}; if (d.plataforma !== PLAT) throw new Error("Esa cuenta no es Netflix VIP.");
    const hist = [...(Array.isArray(d.historialBodega) ? d.historialBodega : []), { tipo: `estado:${estado}`, at: iso, por: usuario, origen, nota: limpio(nota, 140) }].slice(-50);
    tx.update(ref, { estadoBodega: estado === "disponible" ? "" : estado, historialBodega: hist, updatedAt: iso });
    return { ok: true, estado: estadoUnidad({ ...d, estadoBodega: estado === "disponible" ? "" : estado }) };
  });
}

// R196u Fase 2 · PIN de perfil OPCIONAL por acceso VIP (PDF 04). pin «» = quitar (vuelve a «Sin PIN»). Se guarda en la unidad
// de Bodega Y en el servicio del cliente asignado (la ficha/entrega lo lee de ahí), en una sola transacción. El valor del PIN
// nunca va a auditoría ni historial; solo quién y cuándo. No se toca el PIN de otra persona ni de otro acceso.
async function guardarPin(db, { inventarioId, pin = "", usuario = "", origen = "web" } = {}) {
  const valor = String(pin ?? "").trim();
  if (valor && !/^\d{4}$/.test(valor)) throw new Error("El PIN de perfil de Netflix es de 4 números.");
  const ref = db.collection("inventario").doc(String(inventarioId || ""));
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa unidad VIP ya no existe.");
    const d = s.data() || {}; if (d.plataforma !== PLAT) throw new Error("Esa cuenta no es Netflix VIP.");
    const c0 = Array.isArray(d.clientes) && d.clientes[0] ? d.clientes[0] : null;
    let cliRef = null, cliData = null;
    if (c0 && c0.clienteId) { cliRef = db.collection("clientes").doc(String(c0.clienteId)); const cs = await tx.get(cliRef); cliData = cs.exists ? (cs.data() || {}) : null; }
    const hist = [...(Array.isArray(d.historialBodega) ? d.historialBodega : []), { tipo: valor ? "pin_configurado" : "pin_quitado", at: iso, por: usuario, origen }].slice(-50);
    const clientes = c0 ? [{ ...c0, pin: valor }, ...d.clientes.slice(1)] : (Array.isArray(d.clientes) ? d.clientes : []);
    tx.update(ref, { tienePin: !!valor, pin: valor, clientes, historialBodega: hist, updatedAt: iso });
    let servicioActualizado = false;
    if (cliRef && cliData && Array.isArray(cliData.servicios)) {
      const correo = normCorreo(d.correo);
      const servicios = cliData.servicios.map((sv) => {
        const coincide = (c0.compraId && String(sv?.compraId || "") === String(c0.compraId)) || (!c0.compraId && String(sv?.plataforma || "").toLowerCase() === PLAT && normCorreo(sv?.correo) === correo);
        if (!coincide) return sv;
        servicioActualizado = true;
        const out = { ...sv };
        if (valor) { out.pinPerfil = valor; delete out.sinPinPerfil; } else { delete out.pinPerfil; out.sinPinPerfil = true; }
        if (Array.isArray(out.perfiles) && out.perfiles[0]) out.perfiles = [{ ...out.perfiles[0], pinPerfil: valor }, ...out.perfiles.slice(1)];
        return out;
      });
      if (servicioActualizado) tx.update(cliRef, { servicios, updatedAt: iso });
    }
    return { ok: true, tienePin: !!valor, etiqueta: valor ? "PIN configurado" : "Sin PIN", servicioActualizado };
  });
}

module.exports = { guardarPin, PLAT, ESTADOS, ETIQUETA_ESTADO, PROVEEDORES, MAX_LINEAS, normCorreo, docIdVip, parsearLineas, estadoUnidad, previsualizar, importar, listar, asignar, marcarEstado, datosLote };
