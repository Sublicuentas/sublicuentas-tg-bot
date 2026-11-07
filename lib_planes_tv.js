// lib_planes_tv.js = COPIA FIEL de Sublichat HQ api/_planes-tv.js · · R187 · Catálogo CENTRAL de planes de TV Digital (empieza con ICOMPLAY, PDF bloque 03).
// Web, APK y bot leen de aquí (el bot tiene copia fiel: lib_planes_tv.js). Nada de tarifas fijas por triplicado.
// ICOMPLAY (nombre oficial; NO "Icomplay Max": Max Player es otro reproductor):
//   20 variantes exactas = 1, 2, 3, 5, 7 pantallas × 1, 3, 6, 12 meses. Las pantallas NO se deducen de la duración.
// Precios nuevos solo para ventas FUTURAS: cada servicio guarda su precio al confirmarse (foto del precio);
// al cambiar una tarifa, la anterior se archiva con fecha y usuario (historial) y queda en auditoría.
// Firestore: configuracion_tv_digital/planes { planes: { icomplay: { "2x3": {precio, desde, por}, … } }, historial: [...] }.
// CommonJS a propósito (igual que _tv-digital.js).

const PANTALLAS = Object.freeze({ icomplay: [1, 2, 3, 5, 7] });
const MESES = Object.freeze({ icomplay: [1, 3, 6, 12] });
const BASE = Object.freeze({
  icomplay: Object.freeze({
    1: { 1: 179, 3: 499, 6: 949, 12: 1799 },
    2: { 1: 219, 3: 599, 6: 1149, 12: 2149 },
    3: { 1: 249, 3: 699, 6: 1349, 12: 2499 },
    5: { 1: 329, 3: 929, 6: 1799, 12: 3399 },
    7: { 1: 399, 3: 1129, 6: 2199, 12: 4199 },
  }),
});
const NOMBRE = Object.freeze({ icomplay: "ICOMPLAY" });
const VIGENTE_DESDE = "2026-11-07";
const COL = "configuracion_tv_digital", DOC = "planes";

function variantes(plataforma = "icomplay", tabla = BASE[plataforma]) {
  const out = [];
  for (const p of PANTALLAS[plataforma] || []) for (const m of MESES[plataforma] || []) {
    const precio = Number(tabla?.[p]?.[m]);
    if (precio > 0) out.push({ plataforma, nombre: NOMBRE[plataforma], pantallas: p, meses: m, clave: `${plataforma}${p}`, precio, moneda: "HNL", etiqueta: `${NOMBRE[plataforma]} · ${p} pantalla${p === 1 ? "" : "s"} · ${m} mes${m === 1 ? "" : "es"}` });
  }
  return out;
}
function tablaDe(data = {}, plataforma = "icomplay") {
  const t = JSON.parse(JSON.stringify(BASE[plataforma] || {}));
  const g = (data.planes || {})[plataforma] || {};
  for (const [k, v] of Object.entries(g)) { const [p, m] = k.split("x").map(Number); if (t[p] && t[p][m] != null && Number(v?.precio) > 0) t[p][m] = Number(v.precio); }
  return t;
}
let cache = { at: 0, data: null };
async function leerPlanesTv(db, { fresco = false } = {}) {
  if (!fresco && cache.data && Date.now() - cache.at < 60 * 1000) return cache.data;
  let data = {};
  try { const s = await db.collection(COL).doc(DOC).get(); data = s.exists ? s.data() || {} : {}; } catch (_) { if (cache.data) return cache.data; }
  const icomplay = tablaDe(data, "icomplay");
  cache = { at: Date.now(), data: { version: Number(data.version || 0), icomplay: { nombre: NOMBRE.icomplay, pantallas: PANTALLAS.icomplay, meses: MESES.icomplay, precios: icomplay, variantes: variantes("icomplay", icomplay) }, historial: (data.historial || []).slice(-40) } };
  return cache.data;
}
// Precio para una venta: plan permitido o error (nunca 0 silencioso, nunca mezclar con otro IPTV).
function precioPlan(planes, plataforma, pantallas, meses) {
  const P = planes?.[plataforma];
  if (!P) throw new Error("Plataforma sin catálogo de planes.");
  if (!P.pantallas.includes(Number(pantallas))) throw new Error(`${P.nombre}: pantallas permitidas ${P.pantallas.join(", ")}.`);
  if (!P.meses.includes(Number(meses))) throw new Error(`${P.nombre}: meses permitidos ${P.meses.join(", ")}.`);
  return Number(P.precios[pantallas][meses]);
}
async function guardarPrecioPlan(db, { plataforma = "icomplay", pantallas, meses, precio, usuario }) {
  const p = Number(pantallas), m = Number(meses), nuevo = Math.round(Number(precio) * 100) / 100;
  if (!(PANTALLAS[plataforma] || []).includes(p) || !(MESES[plataforma] || []).includes(m)) throw new Error("Esa combinación no existe en el catálogo.");
  if (!(nuevo > 0 && nuevo < 100000)) throw new Error("Precio inválido.");
  const ref = db.collection(COL).doc(DOC), ahora = new Date().toISOString(), hoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  let anterior = 0;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); const d = s.exists ? s.data() || {} : {};
    anterior = tablaDe(d, plataforma)[p][m];
    const planes = { ...(d.planes || {}) }; planes[plataforma] = { ...(planes[plataforma] || {}), [`${p}x${m}`]: { precio: nuevo, desde: hoy, por: String(usuario || "").slice(0, 60) } };
    const historial = [...(d.historial || []), { plataforma, pantallas: p, meses: m, precioAnterior: anterior, precioNuevo: nuevo, hasta: hoy, por: String(usuario || "").slice(0, 60), at: ahora }].slice(-200);
    tx.set(ref, { planes, historial, version: Number(d.version || 0) + 1, updatedAt: ahora }, { merge: true });
  });
  await db.collection("auditoria_eventos").add({ tipo: "plan_tv_precio", plataforma, pantallas: p, meses: m, precioAnterior: anterior, precioNuevo: nuevo, usuario: String(usuario || ""), nota: "Solo ventas futuras; las ventas anteriores conservan su precio.", createdAt: ahora });
  cache = { at: 0, data: null };
  return { plataforma, pantallas: p, meses: m, precioAnterior: anterior, precioNuevo: nuevo };
}
module.exports = { PANTALLAS, MESES, BASE, NOMBRE, VIGENTE_DESDE, variantes, leerPlanesTv, precioPlan, guardarPrecioPlan, _limpiarCache: () => { cache = { at: 0, data: null }; } };
