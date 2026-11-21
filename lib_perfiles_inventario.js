// lib_perfiles_inventario.js · R199e · Un perfil = UNA fila en la cuenta de Bodega. COPIA FIEL en Sublichat HQ: api/_perfiles-inventario.js
"use strict";
// Caso real (nov-2026): HBO primal@… con Aaron Flores y Leyda Blanco mostraba «Ocupados 5/3»:
// Aaron ×2 y Leyda ×3. Tres fallas lo causaban, en bot y en Web:
//  1) La vista «Clientes en esta cuenta» del bot le ponía nombre e IDs de un cliente del CRM a cualquier fila
//     que solo compartiera el PIN (p. ej. 0000) y lo GUARDABA: filas ajenas pasaban a ser «Leyda Blanco».
//  2) La Web (api/renovar.js) no adoptaba una fila del mismo perfil si esa fila ya traía otro perfilId
//     (ID viejo o generado por el otro sistema) y agregaba una fila nueva cada vez que se guardaba la ficha.
//  3) El bot, al revés, adoptaba la fila de un perfil hermano (misma compra, mismo nombre y PIN) y la pisaba.
// Reglas de esta librería (las usan bot y Web):
//  · Una fila se identifica por perfilId. Sin perfilId en común, por cliente + compra + NOMBRE + PIN. Nunca solo por PIN.
//  · No se adopta una fila que ya pertenece a OTRO perfil vigente de la misma compra (perfiles hermanos).
//  · Dos filas con el mismo perfilId son el mismo perfil: queda una.
//  · Filas iguales (cliente + compra + nombre + PIN) se dejan en la cantidad de perfiles que la compra tiene en esa
//    cuenta según la ficha. Si la ficha no se conoce, no se toca nada. Nunca se quita a otra persona ni a un cliente
//    que ya no esté en la ficha: eso lo revisa el dueño (regla «nunca expulsar un cliente automáticamente»).

function s(v) { return String(v == null ? "" : v).trim(); }
function norm(v) {
  return s(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function claveCompra(clienteId, compraId) { return `${s(clienteId)}|${s(compraId)}`; }

// ¿La fila de Bodega puede representar a este perfil del CRM? Nunca por PIN solo: hace falta el ID o el nombre.
function filaCoincidePerfil(fila = {}, perfil = {}, { nombresAlternos = [] } = {}) {
  const fp = s(fila.perfilId), pp = s(perfil.perfilId);
  if (fp && pp) return fp === pp;
  const fc = s(fila.compraId), pc = s(perfil.compraId);
  if (fc && pc && fc !== pc) return false;
  const fcl = s(fila.clienteId), pcl = s(perfil.clienteId);
  if (fcl && pcl && fcl !== pcl) return false;
  const nf = norm(fila.nombre);
  if (!nf) return false;
  const nombres = [perfil.nombre, ...nombresAlternos].map(norm).filter(Boolean);
  if (!nombres.includes(nf)) return false;
  const fpin = s(fila.pin), ppin = s(perfil.pin);
  if (fpin && ppin && fpin !== ppin) return false;
  return true;
}

// Índice de la fila que corresponde a este perfil, o -1 (hay que agregarla).
// perfilIdsCompra: IDs de TODOS los perfiles vigentes de la misma compra (para no pisar a un perfil hermano).
function buscarFilaDePerfil(filas = [], perfil = {}, { perfilIdsCompra = [], nombresAlternos = [] } = {}) {
  const pid = s(perfil.perfilId);
  if (pid) {
    const i = filas.findIndex((f) => s(f?.perfilId) === pid);
    if (i !== -1) return i;
  }
  const hermanos = new Set(perfilIdsCompra.map(s).filter((x) => x && x !== pid));
  const adoptable = (f) => {
    const fpid = s(f?.perfilId);
    if (fpid && (fpid === pid || hermanos.has(fpid))) return false; // es de un perfil hermano vigente
    // fila con perfilId viejo/ajeno: solo si es del mismo cliente y compra (o la fila no los trae) y mismo nombre+PIN
    return filaCoincidePerfil({ ...f, perfilId: "" }, { ...perfil, perfilId: "" }, { nombresAlternos });
  };
  // primero filas del mismo cliente/compra, luego filas viejas sin IDs
  let i = filas.findIndex((f) => adoptable(f) && s(f?.compraId) && s(f.compraId) === s(perfil.compraId));
  if (i === -1) i = filas.findIndex((f) => adoptable(f));
  return i;
}

function pesoFila(f = {}) {
  return (s(f.pin) && s(f.pin) !== "0000" ? 4 : s(f.pin) ? 2 : 0) + (s(f.perfilId) ? 2 : 0) + (s(f.compraId) ? 1 : 0) + (s(f.clienteId) ? 1 : 0);
}

// perfilesPorCompra: Map clave(clienteId|compraId) → [{ perfilId, nombre, pin }] = perfiles de esa compra EN ESTA CUENTA.
function colapsarPerfilesRepetidos(filas = [], { perfilesPorCompra = null } = {}) {
  const lista = Array.isArray(filas) ? filas.map((f) => ({ ...(f || {}) })) : [];
  const quitadas = [];
  // 1) mismo perfilId → una sola fila (se completa con los datos de la repetida)
  const porId = new Map();
  const paso1 = [];
  for (const f of lista) {
    const pid = s(f.perfilId);
    if (!pid) { paso1.push(f); continue; }
    if (!porId.has(pid)) { porId.set(pid, paso1.length); paso1.push(f); continue; }
    const k = porId.get(pid), actual = paso1[k];
    const mejor = pesoFila(f) > pesoFila(actual) ? { ...actual, ...f } : { ...f, ...actual };
    paso1[k] = mejor;
    quitadas.push({ nombre: s(f.nombre), pin: s(f.pin), motivo: "mismo perfil repetido" });
  }
  // 2) misma compra + cliente + nombre + PIN, más filas que perfiles en la ficha → se dejan las que dice la ficha
  let salida = paso1;
  if (perfilesPorCompra && typeof perfilesPorCompra.get === "function") {
    const grupos = new Map();
    paso1.forEach((f, i) => {
      if (!s(f.clienteId) || !s(f.compraId) || !norm(f.nombre)) return;
      const g = `${claveCompra(f.clienteId, f.compraId)}|${norm(f.nombre)}|${s(f.pin)}`;
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(i);
    });
    const fuera = new Set();
    for (const idxs of grupos.values()) {
      if (idxs.length < 2) continue;
      const f0 = paso1[idxs[0]];
      const ficha = perfilesPorCompra.get(claveCompra(f0.clienteId, f0.compraId));
      if (!Array.isArray(ficha) || !ficha.length) continue; // ficha desconocida o sin perfiles aquí → no se toca
      const permitidos = ficha.filter((p) => norm(p.nombre) === norm(f0.nombre) && (!s(p.pin) || !s(f0.pin) || s(p.pin) === s(f0.pin))).length;
      if (!permitidos || idxs.length <= permitidos) continue;
      const idsFicha = new Set(ficha.map((p) => s(p.perfilId)).filter(Boolean));
      const orden = idxs.slice().sort((a, b) => (idsFicha.has(s(paso1[b].perfilId)) - idsFicha.has(s(paso1[a].perfilId))) || (pesoFila(paso1[b]) - pesoFila(paso1[a])) || (a - b));
      for (const i of orden.slice(permitidos)) { fuera.add(i); quitadas.push({ nombre: s(paso1[i].nombre), pin: s(paso1[i].pin), motivo: "fila repetida de la misma compra" }); }
    }
    salida = paso1.filter((_, i) => !fuera.has(i));
  }
  return { filas: salida.map((f, i) => ({ ...f, slot: i + 1 })), quitadas };
}

// Perfiles de una ficha del CRM que viven en ESTA cuenta, agrupados por compra. `perfilesDe(servicio, titular)` lo da cada sistema.
function perfilesPorCompraDeCliente(cliente = {}, { clienteId = "", familia = "", acceso = "", perfilesDe, familiaDe, accesoDe } = {}) {
  const mapa = new Map();
  const titular = s(cliente.nombrePerfil || cliente.nombre);
  for (const sv of Array.isArray(cliente.servicios) ? cliente.servicios : []) {
    if (familiaDe(sv?.plataforma) !== familia) continue;
    const compraId = s(sv?.compraId);
    if (!compraId) continue;
    for (const p of perfilesDe(sv, titular) || []) {
      if (accesoDe(p?.correo || sv?.correo || "") !== acceso) continue;
      const k = claveCompra(clienteId, compraId);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push({ perfilId: s(p.perfilId), nombre: s(p.nombre), pin: s(p.pin ?? p.pinPerfil) });
    }
  }
  return mapa;
}

module.exports = { filaCoincidePerfil, buscarFilaDePerfil, colapsarPerfilesRepetidos, perfilesPorCompraDeCliente, claveCompra, norm };
