// lib_spotify_familias.js = COPIA FIEL de Sublichat HQ api/_spotify-familias.js · · R188 · Fase 4 (PDF «Sublichat 5 puntos», bloque 01): Spotify Familiar, gestor centralizado.
// Copia fiel en el bot: lib_spotify_familias.js. Web, APK y bot usan las MISMAS funciones (por /api/inventario o directo en el bot).
// Modelo: 1 correo madre (administradora) + hasta 5 invitados activos. Una familia con menos de 5 se puede guardar.
// Reglas (en transacción, nunca solo en pantalla):
//   · madre duplicada activa → se rechaza;
//   · un correo invitado no puede estar activo en 2 familias;
//   · el 6.º invitado se bloquea y no altera cupos;
//   · mover = liberar el cupo anterior y ocupar el nuevo en UNA transacción, con actor/fecha/antes/después;
//   · desvincular = desactivar la relación (nunca borra el cliente ni su historial).
// Firestore:
//   spotify_familias/{id}  { codigo:"SP-001", madreCorreo, madreCorreoNorm, capacidad:5, estado, miembros:[…], version, … }
//   spotify_indice/{correoNorm}  { tipo:"madre"|"invitado", familiaId, activo }  ← candado de exclusividad
//   spotify_familias_meta/contador { n }
// La relación en Sublichat NO envía invitaciones ni comprueba pertenencia real en Spotify. No se guarda la contraseña de Spotify aquí.
// CommonJS a propósito.

const CAPACIDAD = 5;
const COL = "spotify_familias", IDX = "spotify_indice", META = "spotify_familias_meta";

function normCorreo(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
function correoValido(v) { const s = normCorreo(v); return /^[^\s@/]{1,64}@[^\s@/]{1,190}\.[a-z0-9-]{2,24}$/i.test(s) ? s : ""; }
const idxId = (correoNorm) => correoNorm.replace(/\//g, "_").slice(0, 300);
const ahoraIso = () => new Date().toISOString();
const activos = (f) => (f.miembros || []).filter((m) => m.estado === "activo");
function esPlataformaSpotify(p) { return /spotify/i.test(String(p || "")); }

async function auditar(db, accion, usuario, datos) {
  try { await db.collection("auditoria_eventos").add({ tipo: "spotify_familia", accion, modulo: "spotify-familias", usuario: String(usuario || "").slice(0, 60), ...datos, createdAt: ahoraIso() }); } catch (_) { /* la auditoría no tumba la operación ya confirmada */ }
}
function vista(id, f) {
  const a = activos(f);
  return { id, codigo: f.codigo || "", madreCorreo: f.madreCorreo || "", estado: f.estado || "activa", capacidad: Number(f.capacidad || CAPACIDAD), ocupados: a.length, libres: Math.max(0, Number(f.capacidad || CAPACIDAD) - a.length),
    miembros: (f.miembros || []).map((m) => ({ id: m.id, correo: m.correo, estado: m.estado, clienteId: m.clienteId || "", compraId: m.compraId || "", clienteNombre: m.clienteNombre || "", vinculadoAt: m.vinculadoAt || "", desvinculadoAt: m.desvinculadoAt || "" })),
    version: Number(f.version || 1), updatedAt: f.updatedAt || "" };
}

async function crearFamilia(db, { madreCorreo, usuario = "", nota = "" } = {}) {
  const madre = correoValido(madreCorreo);
  if (!madre) throw new Error("Correo madre inválido.");
  const ref = db.collection(COL).doc(), idx = db.collection(IDX).doc(idxId(madre)), cont = db.collection(META).doc("contador");
  let out = null;
  await db.runTransaction(async (tx) => {
    const [si, sc] = [await tx.get(idx), await tx.get(cont)];
    const d = si.exists ? si.data() || {} : null;
    if (d && d.activo !== false && d.tipo === "madre") throw new Error("Ese correo ya es madre de una familia activa.");
    if (d && d.activo !== false && d.tipo === "invitado") throw new Error("Ese correo está activo como invitado en otra familia: desvincúlelo primero.");
    const n = Number((sc.exists ? sc.data() || {} : {}).n || 0) + 1;
    const ahora = ahoraIso();
    const fam = { codigo: `SP-${String(n).padStart(3, "0")}`, madreCorreo: madre, madreCorreoNorm: madre, capacidad: CAPACIDAD, estado: "activa", miembros: [], nota: String(nota || "").slice(0, 200), version: 1, createdAt: ahora, updatedAt: ahora, creadoPor: String(usuario || "").slice(0, 60) };
    tx.set(cont, { n }, { merge: true });
    tx.set(ref, fam);
    tx.set(idx, { tipo: "madre", familiaId: ref.id, activo: true, updatedAt: ahora });
    out = vista(ref.id, fam);
  });
  await auditar(db, "crear_familia", usuario, { familiaId: out.id, codigo: out.codigo, despues: { madreCorreo: madre } });
  return out;
}

async function listarFamilias(db) {
  const s = await db.collection(COL).get(); const out = [];
  s.forEach((d) => out.push(vista(d.id, d.data() || {})));
  return out.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
}
async function leerFamilia(db, id) {
  const s = await db.collection(COL).doc(String(id || "")).get();
  if (!s.exists) throw new Error("Esa familia no existe.");
  return vista(s.id, s.data() || {});
}
// Desde cualquier canal: ¿a qué familia pertenece este correo invitado?
async function resolverCorreo(db, correo) {
  const c = correoValido(correo); if (!c) return null;
  const si = await db.collection(IDX).doc(idxId(c)).get();
  const d = si.exists ? si.data() || {} : null;
  if (!d || d.activo === false) return null;
  const f = await leerFamilia(db, d.familiaId).catch(() => null);
  if (!f) return null;
  return { tipo: d.tipo, familiaId: f.id, codigo: f.codigo, madreCorreo: f.madreCorreo, ocupados: f.ocupados, capacidad: f.capacidad, posicion: d.tipo === "invitado" ? f.miembros.filter((m) => m.estado === "activo").findIndex((m) => m.correo === c) + 1 : 0 };
}

// Servicios Spotify YA registrados (para vincular sin duplicar ficha ni servicio). Busca por correo o por ID de cliente/compra.
async function buscarServiciosSpotify(db, q = "", { limite = 30 } = {}) {
  const t = normCorreo(q); if (t.length < 3) return [];
  const s = await db.collection("clientes").get(); const out = [];
  s.forEach((d) => {
    const c = d.data() || {};
    (Array.isArray(c.servicios) ? c.servicios : []).forEach((sv, i) => {
      if (!esPlataformaSpotify(sv && sv.plataforma)) return;
      const correo = normCorreo(sv.correo || (sv.perfiles && sv.perfiles[0] && sv.perfiles[0].correo));
      if (correo.includes(t) || d.id === q || String(sv.compraId || "") === q) out.push({ clienteId: d.id, clienteNombre: c.nombrePerfil || c.nombre || "", compraId: String(sv.compraId || ""), servicioIndex: i, correo, fechaRenovacion: sv.fechaRenovacion || "", spotifyFamiliaId: sv.spotifyFamiliaId || "" });
    });
  });
  return out.slice(0, limite);
}

// Marca el servicio del cliente con su familia (o la quita). Mismo documento y mismo servicio: no se duplica nada.
function marcarServicio(c, compraId, correoNorm, familia) {
  const servicios = Array.isArray(c.servicios) ? c.servicios.map((x) => ({ ...x })) : [];
  let tocado = false;
  servicios.forEach((sv) => {
    if (!esPlataformaSpotify(sv.plataforma)) return;
    const correo = normCorreo(sv.correo || (sv.perfiles && sv.perfiles[0] && sv.perfiles[0].correo));
    if ((compraId && String(sv.compraId || "") === compraId) || (!compraId && correo === correoNorm)) {
      if (familia) { sv.spotifyFamiliaId = familia.id; sv.spotifyFamiliaCodigo = familia.codigo; sv.spotifyMadreCorreo = familia.madreCorreo; }
      else { delete sv.spotifyFamiliaId; delete sv.spotifyFamiliaCodigo; delete sv.spotifyMadreCorreo; }
      tocado = true;
    }
  });
  return tocado ? servicios : null;
}

async function vincularInvitado(db, { familiaId, correo, clienteId = "", compraId = "", usuario = "" } = {}) {
  const c = correoValido(correo); if (!c) throw new Error("Correo invitado inválido.");
  const fref = db.collection(COL).doc(String(familiaId || "")), idx = db.collection(IDX).doc(idxId(c));
  const cref = clienteId ? db.collection("clientes").doc(String(clienteId)) : null;
  let out = null;
  await db.runTransaction(async (tx) => {
    const sf = await tx.get(fref); if (!sf.exists) throw new Error("Esa familia no existe.");
    const f = sf.data() || {}; if (f.estado === "inactiva") throw new Error("Esa familia está inactiva.");
    const si = await tx.get(idx); const d = si.exists ? si.data() || {} : null;
    if (d && d.activo !== false) throw new Error(d.familiaId === fref.id ? "Ese correo ya está vinculado a esta familia." : d.tipo === "madre" ? "Ese correo es madre de otra familia." : "Ese correo ya está activo en otra familia: use «Mover».");
    if (c === f.madreCorreoNorm) throw new Error("La madre no ocupa un espacio de invitado.");
    if (activos(f).length >= Number(f.capacidad || CAPACIDAD)) throw new Error(`La familia ${f.codigo} ya tiene ${CAPACIDAD} invitados: no hay espacios libres.`);
    const sc = cref ? await tx.get(cref) : null;
    const ahora = ahoraIso();
    const miembro = { id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, correo: c, correoNorm: c, estado: "activo", clienteId: String(clienteId || ""), compraId: String(compraId || ""), clienteNombre: sc && sc.exists ? String((sc.data() || {}).nombrePerfil || (sc.data() || {}).nombre || "").slice(0, 80) : "", vinculadoAt: ahora, vinculadoPor: String(usuario || "").slice(0, 60) };
    const miembros = [...(f.miembros || []), miembro];
    tx.set(fref, { ...f, miembros, version: Number(f.version || 1) + 1, updatedAt: ahora });
    tx.set(idx, { tipo: "invitado", familiaId: fref.id, activo: true, updatedAt: ahora });
    if (sc && sc.exists) { const sv = marcarServicio(sc.data() || {}, String(compraId || ""), c, { id: fref.id, codigo: f.codigo, madreCorreo: f.madreCorreo }); if (sv) tx.set(cref, { servicios: sv }, { merge: true }); }
    out = vista(fref.id, { ...f, miembros });
  });
  await auditar(db, "vincular", usuario, { familiaId: out.id, codigo: out.codigo, correo: c, clienteId, compraId });
  return out;
}

async function moverInvitado(db, { correo, destinoId, usuario = "" } = {}) {
  const c = correoValido(correo); if (!c) throw new Error("Correo inválido.");
  const idx = db.collection(IDX).doc(idxId(c)), dref = db.collection(COL).doc(String(destinoId || ""));
  let res = null;
  await db.runTransaction(async (tx) => {
    const si = await tx.get(idx); const d = si.exists ? si.data() || {} : null;
    if (!d || d.activo === false || d.tipo !== "invitado") throw new Error("Ese correo no está activo como invitado.");
    if (d.familiaId === dref.id) throw new Error("Ya está en esa familia.");
    const oref = db.collection(COL).doc(d.familiaId);
    const [so, sd] = [await tx.get(oref), await tx.get(dref)];
    if (!sd.exists) throw new Error("La familia destino no existe.");
    const o = so.data() || {}, f = sd.data() || {};
    if (f.estado === "inactiva") throw new Error("La familia destino está inactiva.");
    if (activos(f).length >= Number(f.capacidad || CAPACIDAD)) throw new Error(`La familia ${f.codigo} no tiene espacios libres.`);
    const ahora = ahoraIso();
    const viejo = (o.miembros || []).find((m) => m.correoNorm === c && m.estado === "activo") || {};
    const omiembros = (o.miembros || []).map((m) => m.correoNorm === c && m.estado === "activo" ? { ...m, estado: "movido", desvinculadoAt: ahora, movidoA: dref.id, desvinculadoPor: String(usuario || "").slice(0, 60) } : m);
    const nuevo = { ...viejo, id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, estado: "activo", vinculadoAt: ahora, vinculadoPor: String(usuario || "").slice(0, 60), movidoDe: oref.id };
    delete nuevo.desvinculadoAt;
    const cref = viejo.clienteId ? db.collection("clientes").doc(viejo.clienteId) : null;
    const sc = cref ? await tx.get(cref) : null;
    tx.set(oref, { ...o, miembros: omiembros, version: Number(o.version || 1) + 1, updatedAt: ahora });
    tx.set(dref, { ...f, miembros: [...(f.miembros || []), nuevo], version: Number(f.version || 1) + 1, updatedAt: ahora });
    tx.set(idx, { tipo: "invitado", familiaId: dref.id, activo: true, updatedAt: ahora });
    if (sc && sc.exists) { const sv = marcarServicio(sc.data() || {}, String(viejo.compraId || ""), c, { id: dref.id, codigo: f.codigo, madreCorreo: f.madreCorreo }); if (sv) tx.set(cref, { servicios: sv }, { merge: true }); }
    res = { origen: { id: oref.id, codigo: o.codigo, ocupados: activos({ miembros: omiembros }).length }, destino: { id: dref.id, codigo: f.codigo, ocupados: activos(f).length + 1 } };
  });
  await auditar(db, "mover", usuario, { correo: c, antes: res.origen, despues: res.destino });
  return res;
}

async function desvincular(db, { correo, usuario = "" } = {}) {
  const c = correoValido(correo); if (!c) throw new Error("Correo inválido.");
  const idx = db.collection(IDX).doc(idxId(c));
  let res = null;
  await db.runTransaction(async (tx) => {
    const si = await tx.get(idx); const d = si.exists ? si.data() || {} : null;
    if (!d || d.activo === false || d.tipo !== "invitado") throw new Error("Ese correo no está activo como invitado.");
    const fref = db.collection(COL).doc(d.familiaId); const sf = await tx.get(fref); const f = sf.data() || {};
    const ahora = ahoraIso();
    const viejo = (f.miembros || []).find((m) => m.correoNorm === c && m.estado === "activo") || {};
    const miembros = (f.miembros || []).map((m) => m.correoNorm === c && m.estado === "activo" ? { ...m, estado: "desvinculado", desvinculadoAt: ahora, desvinculadoPor: String(usuario || "").slice(0, 60) } : m);
    const cref = viejo.clienteId ? db.collection("clientes").doc(viejo.clienteId) : null;
    const sc = cref ? await tx.get(cref) : null;
    tx.set(fref, { ...f, miembros, version: Number(f.version || 1) + 1, updatedAt: ahora });
    tx.set(idx, { ...d, activo: false, updatedAt: ahora });
    // La ficha y el cliente NO se borran: solo se quita la marca de familia del servicio.
    if (sc && sc.exists) { const sv = marcarServicio(sc.data() || {}, String(viejo.compraId || ""), c, null); if (sv) tx.set(cref, { servicios: sv }, { merge: true }); }
    const fichaActiva = !!(sc && sc.exists && (sc.data().servicios || []).some((x) => esPlataformaSpotify(x.plataforma) && String(x.compraId || "") === String(viejo.compraId || "")));
    res = { familiaId: fref.id, codigo: f.codigo, correo: c, ocupados: activos({ miembros }).length, advertencia: fichaActiva ? "El cliente sigue con su ficha Spotify activa: revise si debe moverlo a otra familia." : "" };
  });
  await auditar(db, "desvincular", usuario, { correo: c, familiaId: res.familiaId, codigo: res.codigo });
  return res;
}

// Al guardar una ficha Spotify (Web/APK/bot): si el correo ya es invitado de una familia, el servicio queda marcado con
// su familia y el miembro con su ficha. Si no es invitado de ninguna, no se crea nada (requiere elegir familia).
async function asignarServicio(db, { correo, clienteId, compraId, usuario = "" } = {}) {
  const r = await resolverCorreo(db, correo);
  if (!r || r.tipo !== "invitado") return { familia: null, requiereSeleccion: true };
  const c = correoValido(correo), fref = db.collection(COL).doc(r.familiaId), cref = db.collection("clientes").doc(String(clienteId || ""));
  await db.runTransaction(async (tx) => {
    const [sf, sc] = [await tx.get(fref), await tx.get(cref)];
    if (!sf.exists) return;
    const f = sf.data() || {};
    const miembros = (f.miembros || []).map((m) => m.correoNorm === c && m.estado === "activo" && (!m.clienteId || !m.compraId) ? { ...m, clienteId: String(clienteId || ""), compraId: String(compraId || ""), clienteNombre: sc.exists ? String((sc.data() || {}).nombrePerfil || (sc.data() || {}).nombre || "").slice(0, 80) : m.clienteNombre || "" } : m);
    tx.set(fref, { ...f, miembros, updatedAt: ahoraIso() });
    if (sc.exists) { const sv = marcarServicio(sc.data() || {}, String(compraId || ""), c, { id: fref.id, codigo: f.codigo, madreCorreo: f.madreCorreo }); if (sv) tx.set(cref, { servicios: sv }, { merge: true }); }
  });
  return { familia: { id: r.familiaId, codigo: r.codigo, madreCorreo: r.madreCorreo, posicion: r.posicion, capacidad: r.capacidad } };
}

module.exports = { CAPACIDAD, normCorreo, correoValido, crearFamilia, listarFamilias, leerFamilia, resolverCorreo, buscarServiciosSpotify, vincularInvitado, moverInvitado, desvincular, asignarServicio, esPlataformaSpotify };
