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
// R196 · Control Maestro › Spotify Premium Familiar (autorización expresa del 08/11/2026): cada familia muestra EXACTAMENTE
//   5 espacios por CORREO (posición 1–5), con estado Disponible / Invitación pendiente / Ocupado / Pendiente de retirada,
//   el cliente y el vencimiento LEÍDOS de su ficha (no se guarda otra fecha). Corregir correo conserva cliente, ficha,
//   posición e historial. Vincular dos veces lo mismo es idempotente. Liberar exige confirmar que se retiró en Spotify.
// R196c · Cuenta madre como en Netflix Premium (pedido del 08/11/2026): clave de la cuenta madre (solo la madre; nunca la de
//   los clientes), editar el correo madre y eliminar la cuenta. La clave NO sale en vista()/listados (solo «tieneClave»):
//   se lee aparte con leerClaveMadre(). Auditoría sin el valor. Eliminar = desactivar (estado «inactiva»), solo sin invitados.
// R196d · Cliente de la cuenta madre: si una ficha tiene Spotify con el MISMO correo de la madre (cuenta completa vendida),
//   se muestra como «cliente de la cuenta madre» (leído en vivo de la ficha, sin escribir nada y SIN ocupar uno de los 5 espacios).
// CommonJS a propósito.

const CAPACIDAD = 5;
const COL = "spotify_familias", IDX = "spotify_indice", META = "spotify_familias_meta";

function normCorreo(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
function correoValido(v) { const s = normCorreo(v); return /^[^\s@/]{1,64}@[^\s@/]{1,190}\.[a-z0-9-]{2,24}$/i.test(s) ? s : ""; }
const idxId = (correoNorm) => correoNorm.replace(/\//g, "_").slice(0, 300);
const ahoraIso = () => new Date().toISOString();
const activos = (f) => (f.miembros || []).filter((m) => m.estado === "activo");
// R196 · Posición estable 1–5. Los miembros anteriores sin posición toman los espacios libres en el orden en que se vincularon.
function conPosiciones(f) {
  const cap = Number(f.capacidad || CAPACIDAD);
  const act = activos(f).slice().sort((a, b) => String(a.vinculadoAt || "").localeCompare(String(b.vinculadoAt || "")));
  const usadas = new Set(act.map((m) => Number(m.posicion)).filter((p) => p >= 1 && p <= cap));
  const asignada = new Map();
  for (const m of act) {
    let p = Number(m.posicion);
    if (!(p >= 1 && p <= cap) || asignada.has(p)) { p = 0; for (let i = 1; i <= cap; i++) if (!usadas.has(i) && !asignada.has(i)) { p = i; break; } }
    if (p) { asignada.set(p, m.id); usadas.add(p); }
  }
  const pos = new Map([...asignada.entries()].map(([p, id]) => [id, p]));
  return (f.miembros || []).map((m) => (m.estado === "activo" && pos.has(m.id) ? { ...m, posicion: pos.get(m.id) } : m));
}
function primeraLibre(f, pedida) {
  const cap = Number(f.capacidad || CAPACIDAD);
  const usadas = new Set(conPosiciones(f).filter((m) => m.estado === "activo").map((m) => Number(m.posicion)));
  if (pedida >= 1 && pedida <= cap && !usadas.has(pedida)) return pedida;
  for (let i = 1; i <= cap; i++) if (!usadas.has(i)) return i;
  return 0;
}
function esPlataformaSpotify(p) { return /spotify/i.test(String(p || "")); }

async function auditar(db, accion, usuario, datos) {
  try { await db.collection("auditoria_eventos").add({ tipo: "spotify_familia", accion, modulo: "spotify-familias", usuario: String(usuario || "").slice(0, 60), ...datos, createdAt: ahoraIso() }); } catch (_) { /* la auditoría no tumba la operación ya confirmada */ }
}
function vista(id, f) {
  const a = activos(f);
  return { id, codigo: f.codigo || "", madreCorreo: f.madreCorreo || "", tieneClave: !!f.madreClave, estado: f.estado || "activa", capacidad: Number(f.capacidad || CAPACIDAD), ocupados: a.length, libres: Math.max(0, Number(f.capacidad || CAPACIDAD) - a.length),
    miembros: conPosiciones(f).map((m) => ({ id: m.id, correo: m.correo, estado: m.estado, posicion: m.estado === "activo" ? Number(m.posicion || 0) : 0, estadoInvitacion: m.estadoInvitacion === "pendiente" ? "pendiente" : "aceptada", retiroPendiente: !!m.retiroPendiente, historialCorreos: (m.historialCorreos || []).slice(-10), clienteId: m.clienteId || "", compraId: m.compraId || "", clienteNombre: m.clienteNombre || "", vinculadoAt: m.vinculadoAt || "", desvinculadoAt: m.desvinculadoAt || "" })),
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

async function vincularInvitado(db, { familiaId, correo, clienteId = "", compraId = "", usuario = "", pendiente = false, posicion = 0 } = {}) {
  const c = correoValido(correo); if (!c) throw new Error("Correo invitado inválido.");
  const fref = db.collection(COL).doc(String(familiaId || "")), idx = db.collection(IDX).doc(idxId(c));
  const cref = clienteId ? db.collection("clientes").doc(String(clienteId)) : null;
  let out = null;
  await db.runTransaction(async (tx) => {
    const sf = await tx.get(fref); if (!sf.exists) throw new Error("Esa familia no existe.");
    const f = sf.data() || {}; if (f.estado === "inactiva") throw new Error("Esa familia está inactiva.");
    const si = await tx.get(idx); const d = si.exists ? si.data() || {} : null;
    if (d && d.activo !== false && d.familiaId === fref.id && d.tipo === "invitado") {
      // R196 · idempotente: repetir el mismo vínculo no crea otro espacio ni otro miembro
      const ya = activos(f).find((m) => m.correoNorm === c) || {};
      if ((!clienteId || ya.clienteId === String(clienteId)) && (!compraId || ya.compraId === String(compraId))) { out = { ...vista(fref.id, f), idempotente: true }; return; }
      throw new Error("Ese correo ya está en esta familia con otra ficha: use «Vincular ficha» para corregirla.");
    }
    if (d && d.activo !== false) throw new Error(d.tipo === "madre" ? "Ese correo es madre de otra familia." : "Ese correo ya está activo en otra familia: use «Mover».");
    if (c === f.madreCorreoNorm) throw new Error("La madre no ocupa un espacio de invitado.");
    if (activos(f).length >= Number(f.capacidad || CAPACIDAD)) throw new Error(`La familia ${f.codigo} ya tiene ${CAPACIDAD} invitados: no hay espacios libres.`);
    const sc = cref ? await tx.get(cref) : null;
    const ahora = ahoraIso();
    const miembro = { id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, correo: c, correoNorm: c, estado: "activo", posicion: primeraLibre(f, Number(posicion) || 0), estadoInvitacion: pendiente ? "pendiente" : "aceptada", retiroPendiente: false, clienteId: String(clienteId || ""), compraId: String(compraId || ""), clienteNombre: sc && sc.exists ? String((sc.data() || {}).nombrePerfil || (sc.data() || {}).nombre || "").slice(0, 80) : "", vinculadoAt: ahora, vinculadoPor: String(usuario || "").slice(0, 60) };
    const miembros = [...(f.miembros || []), miembro];
    tx.set(fref, { ...f, miembros, version: Number(f.version || 1) + 1, updatedAt: ahora });
    tx.set(idx, { tipo: "invitado", familiaId: fref.id, activo: true, updatedAt: ahora });
    if (sc && sc.exists) { const sv = marcarServicio(sc.data() || {}, String(compraId || ""), c, { id: fref.id, codigo: f.codigo, madreCorreo: f.madreCorreo }); if (sv) tx.set(cref, { servicios: sv }, { merge: true }); }
    out = vista(fref.id, { ...f, miembros });
  });
  if (!out.idempotente) await auditar(db, "vincular", usuario, { familiaId: out.id, codigo: out.codigo, correo: c, clienteId, compraId, pendiente: !!pendiente });
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
    const nuevo = { ...viejo, id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, estado: "activo", posicion: primeraLibre(f, 0), retiroPendiente: false, vinculadoAt: ahora, vinculadoPor: String(usuario || "").slice(0, 60), movidoDe: oref.id };
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

// ---------------------------------------------------------------------------------------------------------------
// R196 · Acciones de Control Maestro › Spotify Familiar
// Corregir el correo de un invitado: MISMO miembro, posición, cliente y ficha; queda el historial (antes, después, quién, cuándo).
async function cambiarCorreo(db, { correoActual, correoNuevo, usuario = "" } = {}) {
  const a = correoValido(correoActual), b = correoValido(correoNuevo);
  if (!a || !b) throw new Error("Escriba el correo actual y el correo nuevo completos.");
  if (a === b) throw new Error("El correo nuevo es igual al actual.");
  const ia = db.collection(IDX).doc(idxId(a)), ib = db.collection(IDX).doc(idxId(b));
  let res = null;
  await db.runTransaction(async (tx) => {
    const [sa, sb] = [await tx.get(ia), await tx.get(ib)];
    const da = sa.exists ? sa.data() || {} : null, dbb = sb.exists ? sb.data() || {} : null;
    if (!da || da.activo === false || da.tipo !== "invitado") throw new Error("Ese correo no está activo como invitado.");
    if (dbb && dbb.activo !== false) throw new Error(dbb.tipo === "madre" ? "El correo nuevo es madre de una familia." : "El correo nuevo ya ocupa un espacio en una familia.");
    const fref = db.collection(COL).doc(da.familiaId); const sf = await tx.get(fref); const f = sf.data() || {};
    if (b === f.madreCorreoNorm) throw new Error("El correo nuevo es el administrador de esta familia.");
    const viejo = (f.miembros || []).find((m) => m.correoNorm === a && m.estado === "activo") || {};
    const cref = viejo.clienteId ? db.collection("clientes").doc(viejo.clienteId) : null;
    const sc = cref ? await tx.get(cref) : null;
    const ahora = ahoraIso();
    const miembros = conPosiciones(f).map((m) => m.id === viejo.id ? { ...m, correo: b, correoNorm: b, historialCorreos: [...(m.historialCorreos || []), { antes: a, despues: b, por: String(usuario || "").slice(0, 60), at: ahora }].slice(-20) } : m);
    tx.set(fref, { ...f, miembros, version: Number(f.version || 1) + 1, updatedAt: ahora });
    tx.set(ia, { ...da, activo: false, reemplazadoPor: b, updatedAt: ahora });
    tx.set(ib, { tipo: "invitado", familiaId: fref.id, activo: true, updatedAt: ahora });
    if (sc && sc.exists) { // la ficha del MISMO cliente se corrige en su servicio Spotify (no se crea otra venta)
      const servicios = (Array.isArray((sc.data() || {}).servicios) ? sc.data().servicios : []).map((x) => ({ ...x }));
      let tocado = false;
      for (const sv of servicios) if (esPlataformaSpotify(sv.plataforma) && ((viejo.compraId && String(sv.compraId || "") === viejo.compraId) || (!viejo.compraId && normCorreo(sv.correo) === a))) { if (normCorreo(sv.correo) === a) sv.correo = b; sv.spotifyFamiliaId = fref.id; sv.spotifyFamiliaCodigo = f.codigo; sv.spotifyMadreCorreo = f.madreCorreo; tocado = true; }
      if (tocado) tx.set(cref, { servicios }, { merge: true });
    }
    res = { familiaId: fref.id, codigo: f.codigo, antes: a, despues: b, posicion: Number((miembros.find((m) => m.id === viejo.id) || {}).posicion || 0) };
  });
  await auditar(db, "cambiar_correo", usuario, { familiaId: res.familiaId, codigo: res.codigo, antes: { correo: res.antes }, despues: { correo: res.despues } });
  return res;
}
// Vincular un invitado YA presente con la ficha/servicio Spotify EXISTENTE del cliente (no crea venta ni cambia fecha ni precio).
async function vincularFicha(db, { correo, clienteId, compraId = "", usuario = "" } = {}) {
  const c = correoValido(correo); if (!c) throw new Error("Correo inválido.");
  if (!clienteId) throw new Error("Elija la ficha del cliente.");
  const idx = db.collection(IDX).doc(idxId(c)), cref = db.collection("clientes").doc(String(clienteId));
  let res = null;
  await db.runTransaction(async (tx) => {
    const si = await tx.get(idx); const d = si.exists ? si.data() || {} : null;
    if (!d || d.activo === false || d.tipo !== "invitado") throw new Error("Ese correo no está activo como invitado.");
    const fref = db.collection(COL).doc(d.familiaId);
    const [sf, sc] = [await tx.get(fref), await tx.get(cref)];
    if (!sc.exists) throw new Error("Esa ficha de cliente no existe.");
    const cli = sc.data() || {};
    const sv = (cli.servicios || []).find((x) => esPlataformaSpotify(x.plataforma) && (!compraId || String(x.compraId || "") === String(compraId)));
    if (!sv) throw new Error("Ese cliente no tiene un servicio Spotify registrado: regístrelo primero en su ficha.");
    const f = sf.data() || {};
    const otro = activos(f).find((m) => m.correoNorm !== c && m.clienteId === String(clienteId) && m.compraId === String(sv.compraId || ""));
    if (otro) throw new Error(`Esa ficha ya está vinculada al correo ${otro.correo} en esta familia.`);
    const ahora = ahoraIso();
    const miembros = conPosiciones(f).map((m) => m.correoNorm === c && m.estado === "activo" ? { ...m, clienteId: String(clienteId), compraId: String(sv.compraId || ""), clienteNombre: String(cli.nombrePerfil || cli.nombre || "").slice(0, 80), fichaVinculadaAt: ahora, fichaVinculadaPor: String(usuario || "").slice(0, 60) } : m);
    tx.set(fref, { ...f, miembros, version: Number(f.version || 1) + 1, updatedAt: ahora });
    const svs = marcarServicio(cli, String(sv.compraId || ""), c, { id: fref.id, codigo: f.codigo, madreCorreo: f.madreCorreo });
    if (svs) tx.set(cref, { servicios: svs }, { merge: true });
    res = { familiaId: fref.id, codigo: f.codigo, correo: c, clienteId: String(clienteId), compraId: String(sv.compraId || "") };
  });
  await auditar(db, "vincular_ficha", usuario, res);
  return res;
}
// Estado del espacio: invitación pendiente/aceptada y «pendiente de retirada» (sigue ocupando hasta que se confirme el retiro).
async function marcarMiembro(db, { correo, estadoInvitacion, retiroPendiente, usuario = "" } = {}) {
  const c = correoValido(correo); if (!c) throw new Error("Correo inválido.");
  const idx = db.collection(IDX).doc(idxId(c));
  let res = null;
  await db.runTransaction(async (tx) => {
    const si = await tx.get(idx); const d = si.exists ? si.data() || {} : null;
    if (!d || d.activo === false || d.tipo !== "invitado") throw new Error("Ese correo no está activo como invitado.");
    const fref = db.collection(COL).doc(d.familiaId); const f = (await tx.get(fref)).data() || {};
    const ahora = ahoraIso();
    const miembros = conPosiciones(f).map((m) => {
      if (!(m.correoNorm === c && m.estado === "activo")) return m;
      const n = { ...m };
      if (estadoInvitacion === "pendiente" || estadoInvitacion === "aceptada") n.estadoInvitacion = estadoInvitacion;
      if (typeof retiroPendiente === "boolean") { n.retiroPendiente = retiroPendiente; n.retiroMarcadoAt = ahora; n.retiroMarcadoPor = String(usuario || "").slice(0, 60); }
      return n;
    });
    tx.set(fref, { ...f, miembros, version: Number(f.version || 1) + 1, updatedAt: ahora });
    res = { familiaId: fref.id, codigo: f.codigo, correo: c, estadoInvitacion: estadoInvitacion || null, retiroPendiente: typeof retiroPendiente === "boolean" ? retiroPendiente : null };
  });
  await auditar(db, "marcar_espacio", usuario, res);
  return res;
}
// Liberar el espacio SOLO con confirmación de que el miembro ya fue retirado en Spotify.
async function liberarEspacio(db, { correo, confirmoRetiro = false, usuario = "" } = {}) {
  if (confirmoRetiro !== true) throw new Error("Confirme que el correo ya fue retirado de la familia en Spotify.");
  return desvincular(db, { correo, usuario });
}
// ---------------------------------------------------------------- R196c · cuenta madre: clave, editar correo, eliminar
async function guardarClaveMadre(db, { familiaId, clave, usuario = "" } = {}) {
  const v = String(clave == null ? "" : clave).trim();
  if (!v || v.length > 120 || /\s/.test(v)) throw new Error("Escriba la clave sin espacios (máx. 120).");
  const ref = db.collection(COL).doc(String(familiaId || "")); let res = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa cuenta no existe.");
    const f = s.data() || {}; if (f.estado === "inactiva") throw new Error("Esa cuenta está eliminada.");
    const ahora = ahoraIso();
    tx.set(ref, { ...f, madreClave: v, madreClaveAt: ahora, madreClavePor: String(usuario || "").slice(0, 60), version: Number(f.version || 1) + 1, updatedAt: ahora });
    res = { familiaId: ref.id, codigo: f.codigo, tenia: !!f.madreClave };
  });
  await auditar(db, res.tenia ? "cambiar_clave_madre" : "guardar_clave_madre", usuario, { familiaId: res.familiaId, codigo: res.codigo }); // sin el valor
  return res;
}
async function leerClaveMadre(db, familiaId) {
  const s = await db.collection(COL).doc(String(familiaId || "")).get();
  if (!s.exists) throw new Error("Esa cuenta no existe.");
  const f = s.data() || {};
  return { codigo: f.codigo || "", madreCorreo: f.madreCorreo || "", madreClave: f.madreClave || "" };
}
// Cambia el correo madre: misma cuenta, mismos invitados y posiciones; el índice viejo queda inactivo; las fichas vinculadas
// actualizan solo la referencia «spotifyMadreCorreo» (no cobros ni fechas).
async function cambiarCorreoMadre(db, { familiaId, correoNuevo, usuario = "" } = {}) {
  const b = correoValido(correoNuevo); if (!b) throw new Error("Correo madre nuevo inválido.");
  const ref = db.collection(COL).doc(String(familiaId || "")); let res = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa cuenta no existe.");
    const f = s.data() || {}; if (f.estado === "inactiva") throw new Error("Esa cuenta está eliminada.");
    const a = normCorreo(f.madreCorreo); if (a === b) throw new Error("Es el mismo correo.");
    const idxA = db.collection(IDX).doc(idxId(a)), idxB = db.collection(IDX).doc(idxId(b));
    const sb = await tx.get(idxB); const d = sb.exists ? sb.data() || {} : null;
    if (d && d.activo !== false) throw new Error(d.tipo === "madre" ? "Ese correo ya es madre de otra cuenta." : "Ese correo está activo como invitado: desvincúlelo primero.");
    const sa = await tx.get(idxA);
    const fichas = [...new Set(activos(f).map((m) => m.clienteId).filter(Boolean))].map((id) => db.collection("clientes").doc(id));
    const snaps = await Promise.all(fichas.map((r) => tx.get(r)));
    const ahora = ahoraIso();
    tx.set(ref, { ...f, madreCorreo: b, madreCorreoNorm: b, historialMadre: [...(f.historialMadre || []), { antes: a, despues: b, por: String(usuario || "").slice(0, 60), at: ahora }].slice(-20), version: Number(f.version || 1) + 1, updatedAt: ahora });
    if (sa.exists) tx.set(idxA, { ...(sa.data() || {}), activo: false, reemplazadoPor: b, updatedAt: ahora });
    tx.set(idxB, { tipo: "madre", familiaId: ref.id, activo: true, createdAt: ahora });
    snaps.forEach((sc, i) => {
      if (!sc.exists) return; const c = sc.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios.map((x) => ({ ...x })) : []; let tocado = false;
      servicios.forEach((sv) => { if (String(sv.spotifyFamiliaId || "") === ref.id) { sv.spotifyMadreCorreo = b; tocado = true; } });
      if (tocado) tx.update(fichas[i], { servicios });
    });
    res = { familiaId: ref.id, codigo: f.codigo, antes: a, despues: b };
  });
  await auditar(db, "cambiar_correo_madre", usuario, res);
  return res;
}
// Eliminar = desactivar (no se borra el documento ni el historial). Solo sin invitados activos.
async function eliminarCuenta(db, { familiaId, usuario = "", confirmo = false } = {}) {
  if (confirmo !== true) throw new Error("Confirme la eliminación.");
  const ref = db.collection(COL).doc(String(familiaId || "")); let res = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) throw new Error("Esa cuenta no existe.");
    const f = s.data() || {}; if (f.estado === "inactiva") { res = { familiaId: ref.id, codigo: f.codigo, yaEstaba: true }; return; }
    const n = activos(f).length;
    if (n) throw new Error(`Tiene ${n} invitado(s): muévalos o desvincúlelos primero (no se pierde ningún cliente).`);
    const idx = db.collection(IDX).doc(idxId(normCorreo(f.madreCorreo))); const si = await tx.get(idx);
    const ahora = ahoraIso();
    tx.set(ref, { ...f, estado: "inactiva", eliminadaAt: ahora, eliminadaPor: String(usuario || "").slice(0, 60), version: Number(f.version || 1) + 1, updatedAt: ahora });
    if (si.exists) tx.set(idx, { ...(si.data() || {}), activo: false, updatedAt: ahora });
    res = { familiaId: ref.id, codigo: f.codigo, madreCorreo: f.madreCorreo };
  });
  if (!res.yaEstaba) await auditar(db, "eliminar_cuenta", usuario, res);
  return res;
}
// R196d · Fichas con Spotify cuyo correo es el de una madre → { correoMadre: [{ clienteId, cliente, compraId, vence }] }.
function fichasPorCorreo(docsClientes = []) {
  const mapa = new Map();
  for (const d of docsClientes) {
    const c = d.data || {};
    (Array.isArray(c.servicios) ? c.servicios : []).forEach((sv) => {
      if (!sv || !esPlataformaSpotify(sv.plataforma)) return;
      const correo = normCorreo(sv.correo || (sv.perfiles && sv.perfiles[0] && sv.perfiles[0].correo)); if (!correo) return;
      (mapa.get(correo) || mapa.set(correo, []).get(correo)).push({ clienteId: d.id, cliente: String(c.nombrePerfil || c.nombre || "").slice(0, 80), compraId: String(sv.compraId || ""), vence: ymdDe(sv.fechaRenovacion || sv.vence) });
    });
  }
  return mapa;
}
async function clientesDeMadre(db, madreCorreo, { hoy = "" } = {}) {
  const docs = (await db.collection("clientes").get()).docs.map((d) => ({ id: d.id, data: d.data() || {} }));
  return (fichasPorCorreo(docs).get(normCorreo(madreCorreo)) || []).map((x) => ({ ...x, vencido: !!(x.vence && hoy && x.vence < hoy) }));
}
// Fechas de ficha: "dd/mm/aaaa" (formato de Sublichat) o ISO → "aaaa-mm-dd".
function ymdDe(v) { const t = String(v || "").trim(); let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; }
function estadoEspacio(m) {
  if (!m) return "disponible";
  if (m.retiroPendiente) return "retiro_pendiente";
  if (m.estadoInvitacion === "pendiente") return "pendiente";
  return "ocupado";
}
// Panel de Control Maestro: exactamente `capacidad` espacios por familia; cliente y vencimiento leídos de la ficha ACTUAL.
async function panelFamilias(db, { hoy = "" } = {}) {
  const fams = (await db.collection(COL).get()).docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).filter((f) => f.estado !== "inactiva"); // R196c
  // R196d · una sola lectura de clientes: fichas de los invitados y clientes de la cuenta madre
  const docs = (await db.collection("clientes").get()).docs.map((d) => ({ id: d.id, data: d.data() || {} }));
  const fichas = new Map(docs.map((d) => [d.id, d.data])); const porCorreo = fichasPorCorreo(docs);
  const out = fams.map((f) => {
    const cap = Number(f.capacidad || CAPACIDAD);
    const ms = conPosiciones(f).filter((m) => m.estado === "activo");
    const espacios = Array.from({ length: cap }, (_, i) => {
      const m = ms.find((x) => Number(x.posicion) === i + 1);
      if (!m) return { posicion: i + 1, estado: "disponible" };
      const ficha = m.clienteId ? fichas.get(m.clienteId) : null;
      const sv = ficha ? (ficha.servicios || []).find((x) => esPlataformaSpotify(x.plataforma) && (m.compraId ? String(x.compraId || "") === m.compraId : normCorreo(x.correo) === m.correoNorm)) : null;
      const vence = sv ? ymdDe(sv.fechaRenovacion || sv.vence) : "";
      return { posicion: i + 1, estado: estadoEspacio(m), correo: m.correo, clienteId: m.clienteId || "", compraId: m.compraId || "", cliente: ficha ? String(ficha.nombrePerfil || ficha.nombre || m.clienteNombre || "").slice(0, 80) : (m.clienteNombre || ""),
        vence, vencido: !!(vence && hoy && vence < hoy), fichaEncontrada: !!sv, sinFicha: !m.clienteId, historialCorreos: (m.historialCorreos || []).slice(-5), vinculadoAt: m.vinculadoAt || "" };
    });
    const ocupados = espacios.filter((e) => e.estado !== "disponible").length;
    return { id: f.id, codigo: f.codigo || "", madreCorreo: f.madreCorreo || "", tieneClave: !!f.madreClave, madreClientes: (porCorreo.get(normCorreo(f.madreCorreo)) || []).map((x) => ({ ...x, vencido: !!(x.vence && hoy && x.vence < hoy) })), estado: f.estado || "activa", capacidad: cap, ocupados, libres: cap - ocupados, espacios };
  });
  return out.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
}

module.exports = { clientesDeMadre, fichasPorCorreo, guardarClaveMadre, leerClaveMadre, cambiarCorreoMadre, eliminarCuenta, cambiarCorreo, vincularFicha, marcarMiembro, liberarEspacio, panelFamilias, estadoEspacio, conPosiciones, CAPACIDAD, normCorreo, correoValido, crearFamilia, listarFamilias, leerFamilia, resolverCorreo, buscarServiciosSpotify, vincularInvitado, moverInvitado, desvincular, asignarServicio, esPlataformaSpotify };
