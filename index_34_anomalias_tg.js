/* SUBLICUENTAS — R141 · ANOMALÍAS DE /sincronizar_todo CON NOMBRES Y BOTONES PARA CORREGIR
   Antes el reporte solo decía "este acceso está en otra plataforma" o "hay un duplicado", sin decir de qué cliente
   ni dejar hacer nada. Ahora cada anomalía se abre y se corrige desde Telegram:
   · 🔀 Mismo correo en OTRA plataforma: muestra los clientes; botón "Ver ficha" y "Pasar el servicio a <plataforma>".
   · 🚫 Sin cuenta en Bodega: clientes afectados y su ficha.
   · 🧬 Duplicados (misma plataforma + acceso en 2 documentos): ver cada documento, UNIR en uno o BORRAR el sobrante
     (va a la papelera, se puede recuperar).
   · 📏 Capacidad excedida: quiénes están y abrir la cuenta.
   · 📄 Lista completa en .txt.
   Nada se mezcla solo: cada cambio pide confirmación y queda en auditoría.
*/
const crypto = require("crypto");
const { bot, db, admin } = require("./index_01_core");
const { enviarTxtComoArchivo, normalizarPlataforma, logErr } = require("./index_02_utils_roles");
const integrity = require("./index_26_integrity_guard");
const accessControl = require("./index_23_access_control");

const REPORTES = new Map();   // chatId → { anomalias, at }
const CLAVES = new Map();     // clave corta → payload (callback_data máx. 64 bytes)
const POR_PAGINA = 8;
const TITULOS = { otra: "🔀 Mismo acceso en OTRA plataforma", sin: "🚫 Sin cuenta en Bodega", dup: "🧬 Cuentas duplicadas", cap: "📏 Capacidad excedida" };

const humano = (p) => { try { return require("./index_03_clientes_crm").humanPlataforma(p); } catch (_) { return String(p || "").toUpperCase(); } };
const corto = (payload) => { const k = crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 12); CLAVES.set(k, payload); if (CLAVES.size > 3000) CLAVES.delete(CLAVES.keys().next().value); return k; };
const cut = (t, n) => { const s = String(t || ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const send = (chatId, txt, rows = []) => bot.sendMessage(chatId, cut(txt, 3900), kb(rows));
async function puede(userId) { try { return await accessControl.hasPermission(userId, "sincronizacion.claves"); } catch (_) { return false; } }
const actorDe = (q, userId) => ({ userId: String(userId || ""), name: q?.from?.first_name || q?.from?.username || "", source: "Telegram" });
async function auditar(userId, accion, detalle, extra = {}) {
  try { await db.collection("auditoria_eventos").add({ actorUsuario: String(userId), origen: "telegram", modulo: "inventario", accion, detalle, ...extra, resultado: "ok", createdAt: new Date().toISOString() }); } catch (e) { logErr("R141 auditar", e); }
}

function guardar(chatId, anomalias) { REPORTES.set(String(chatId), { anomalias, at: Date.now() }); }
function tecladoResumen(a = {}) {
  const rows = [];
  for (const t of ["otra", "dup", "cap", "sin"]) if ((a[t] || []).length) rows.push([{ text: `${TITULOS[t]} (${a[t].length})`, callback_data: `anom:l:${t}:0` }]);
  if (rows.length) rows.push([{ text: "📄 Lista completa con nombres (.txt)", callback_data: "anom:txt" }]);
  return rows;
}
const reporte = (chatId) => REPORTES.get(String(chatId));
const vencido = (chatId) => send(chatId, "⚠️ Ese reporte ya no está en memoria. Vuelva a correr /sincronizar_todo.");

function etiqueta(t, x) {
  if (t === "dup") return `🧬 ${humano(x.plat)} · ${cut(x.acceso, 26)} (${x.docIds.length})`;
  if (t === "cap") return `📏 ${humano(x.plat)} · ${cut(x.acceso, 22)} ${x.ocupados}/${x.capacidad}`;
  const n = (x.clientes || [])[0]?.nombre || "Sin nombre";
  return `${cut(n, 18)} · ${humano(x.plat)} · ${cut(x.acceso, 20)}`;
}
async function lista(chatId, t, page) {
  const r = reporte(chatId); if (!r) return vencido(chatId);
  const arr = r.anomalias[t] || [];
  const pags = Math.max(1, Math.ceil(arr.length / POR_PAGINA)), pg = Math.min(Math.max(0, page), pags - 1);
  const trozo = arr.slice(pg * POR_PAGINA, pg * POR_PAGINA + POR_PAGINA);
  const rows = trozo.map((x, i) => [{ text: cut(etiqueta(t, x), 60), callback_data: `anom:i:${t}:${pg * POR_PAGINA + i}` }]);
  const nav = []; if (pg > 0) nav.push({ text: "⬅️", callback_data: `anom:l:${t}:${pg - 1}` }); if (pg < pags - 1) nav.push({ text: "➡️", callback_data: `anom:l:${t}:${pg + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "📄 Lista completa (.txt)", callback_data: "anom:txt" }]);
  return send(chatId, `${TITULOS[t]} · ${arr.length}\nPágina ${pg + 1}/${pags}. Toque una para ver los clientes y corregirla:`, rows);
}

async function detalle(chatId, t, idx) {
  const r = reporte(chatId); if (!r) return vencido(chatId);
  const x = (r.anomalias[t] || [])[idx]; if (!x) return vencido(chatId);
  if (t === "dup") return panelDuplicado(chatId, corto({ plat: x.plat, acceso: x.acceso, docIds: x.docIds }));
  if (t === "cap") {
    return send(chatId, [`📏 ${humano(x.plat)} · ${x.acceso}`, `Hay ${x.ocupados} perfiles y la cuenta es de ${x.capacidad}.`, "", ...x.nombres.map((n, i) => `${i + 1}. ${n}`), "", "Quite a quien sobre o súbale la capacidad a la cuenta."].join("\n"),
      [[{ text: "📦 Abrir la cuenta", callback_data: `anom:ab:${corto({ plat: x.plat, acceso: x.acceso })}` }], [{ text: "⬅️ Volver", callback_data: `anom:l:${t}:${Math.floor(idx / POR_PAGINA)}` }]]);
  }
  const cl = x.clientes || [];
  const lineas = [`${TITULOS[t]}`, "", `Servicio: ${humano(x.plat)} · ${x.acceso}`, ...(t === "otra" ? [`Ese acceso existe en Bodega como: ${x.otras.map(humano).join(", ")}`] : ["No hay ninguna cuenta en Bodega con esa plataforma + acceso."]), "", `Cliente(s) con ese servicio (${cl.length}):`, ...cl.slice(0, 15).map((c, i) => `${i + 1}. ${c.nombre || "Sin nombre"}${c.telefono ? ` · ${c.telefono}` : ""}`)];
  if (t === "otra") lineas.push("", "Si el servicio del cliente está mal puesto, páselo a la plataforma correcta. Si lo que está mal es la cuenta de Bodega, abra la cuenta y use \"Cambiar plataforma de esta cuenta\".");
  else lineas.push("", "Corrija el correo en la ficha del cliente o cree la cuenta en Bodega.");
  const rows = cl.slice(0, 6).map((c) => [{ text: `👤 Ver ficha · ${cut(c.nombre || "Sin nombre", 30)}`, callback_data: `anom:c:${corto({ id: c.clienteId })}` }]);
  if (t === "otra") x.otras.forEach((p, j) => rows.push([{ text: `🔁 Pasar servicio a ${cut(humano(p), 28)}`, callback_data: `anom:mv:${idx}:${j}` }]));
  if (t === "otra") x.otras.forEach((p) => rows.push([{ text: `📦 Abrir cuenta de Bodega (${cut(humano(p), 24)})`, callback_data: `anom:ab:${corto({ plat: p, acceso: x.acceso })}` }]));
  rows.push([{ text: "⬅️ Volver", callback_data: `anom:l:${t}:${Math.floor(idx / POR_PAGINA)}` }]);
  return send(chatId, lineas.join("\n"), rows);
}

// Pasar el servicio del cliente a la plataforma donde de verdad está la cuenta.
async function moverServicio(chatId, userId, idx, j, confirmado) {
  const r = reporte(chatId); if (!r) return vencido(chatId);
  const x = (r.anomalias.otra || [])[idx]; const destino = x && x.otras[j];
  if (!x || !destino) return vencido(chatId);
  if (!confirmado) return send(chatId, `🔁 ¿Pasar el servicio de ${x.clientes.length} cliente(s) de ${humano(x.plat)} a ${humano(destino)}?\n\nAcceso: ${x.acceso}\n${x.clientes.map((c) => `• ${c.nombre}`).join("\n")}\n\nSolo cambia la plataforma del servicio (correo, clave, PIN, fecha y precio quedan igual).`,
    [[{ text: "✅ Sí, pasarlo", callback_data: `anom:mvok:${idx}:${j}` }], [{ text: "❌ Cancelar", callback_data: `anom:i:otra:${idx}` }]]);
  if (!(await puede(userId))) return send(chatId, "⛔ No tiene permiso para corregir sincronización.");
  let hechos = 0; const fallos = [];
  for (const c of x.clientes) {
    try {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("clientes").doc(String(c.clienteId)); const s = await tx.get(ref);
        if (!s.exists) throw new Error("cliente no existe");
        const d = s.data() || {}; const servs = Array.isArray(d.servicios) ? d.servicios.slice() : [];
        let i = Number(c.servicioIndex);
        const coincide = (sv) => sv && normalizarPlataforma(sv.plataforma || "") === x.plat && JSON.stringify(sv).toLowerCase().includes(String(x.acceso).toLowerCase());
        if (!coincide(servs[i])) i = servs.findIndex(coincide);
        if (i < 0) throw new Error("servicio ya no coincide");
        servs[i] = { ...servs[i], plataforma: destino, plataformaAnterior: servs[i].plataforma, plataformaCorregidaAt: new Date().toISOString() };
        tx.set(ref, { servicios: servs, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
      hechos++;
    } catch (e) { fallos.push(`${c.nombre}: ${e.message}`); }
  }
  await auditar(userId, "corregir_plataforma_servicio", `${x.acceso}: ${humano(x.plat)} → ${humano(destino)} (${hechos} cliente/s)`, { plataformaAntes: x.plat, plataformaDespues: destino });
  return send(chatId, `✅ ${hechos} servicio(s) pasados a ${humano(destino)}.${fallos.length ? `\n⚠️ ${fallos.join("\n⚠️ ")}` : ""}\n\nCorra /sincronizar_todo para que queden en su cuenta de Bodega.`);
}

// ---------------------------------------------------------------- duplicados
async function leerDocs(ids) { const snaps = await Promise.all(ids.map((id) => db.collection("inventario").doc(id).get())); return snaps.map((s, i) => ({ id: ids[i], existe: s.exists, data: s.exists ? s.data() || {} : {} })); }
const fechaDoc = (d) => { const v = d.createdAt || d.creado || d.updatedAt; try { const t = v && v.toDate ? v.toDate() : new Date(v); return isNaN(t) ? "" : t.toISOString().slice(0, 10); } catch (_) { return ""; } };
async function panelDuplicado(chatId, k) {
  const p = CLAVES.get(k); if (!p) return vencido(chatId);
  const docs = (await leerDocs(p.docIds)).filter((d) => d.existe);
  if (docs.length < 2) return send(chatId, `✅ Ya no hay duplicado: queda ${docs.length} documento para ${humano(p.plat)} · ${p.acceso}.\nCorra /sincronizar_todo.`);
  const lineas = [`🧬 DUPLICADO · ${humano(p.plat)}`, p.acceso, "", "La misma cuenta está guardada en varios documentos. Deje UNO: únalos o borre el que sobra (va a la papelera).", ""];
  docs.forEach((d, i) => {
    const cl = Array.isArray(d.data.clientes) ? d.data.clientes : [];
    lineas.push(`📄 Documento ${i + 1}${fechaDoc(d.data) ? ` · ${fechaDoc(d.data)}` : ""}`, `   ${cl.length}/${d.data.capacidad || "?"} perfiles · clave: ${d.data.clave || "—"}`, ...(cl.length ? cl.slice(0, 6).map((c) => `   • ${c.nombre || "Sin nombre"}${c.pin ? ` (PIN ${c.pin})` : ""}`) : ["   (sin clientes)"]), "");
  });
  const rows = docs.map((d, i) => [{ text: `🔗 Unir todo en el doc ${i + 1}`, callback_data: `anom:dm:${k}:${i}` }, { text: `🗑️ Borrar doc ${i + 1}`, callback_data: `anom:dd:${k}:${i}` }]);
  return send(chatId, lineas.join("\n"), rows);
}
const claveFila = (c) => String(c.perfilId || "").trim() || `${c.clienteId || ""}|${c.compraId || ""}|${String(c.nombre || "").toLowerCase().trim()}|${String(c.pin || "").trim()}`;
async function unirDuplicado(chatId, userId, q, k, n, confirmado) {
  const p = CLAVES.get(k); if (!p) return vencido(chatId);
  const docs = (await leerDocs(p.docIds)).filter((d) => d.existe); const dest = docs[n];
  if (!dest || docs.length < 2) return panelDuplicado(chatId, k);
  const vistos = new Set(), clientes = [];
  for (const d of [dest, ...docs.filter((_, i) => i !== n)]) for (const c of (Array.isArray(d.data.clientes) ? d.data.clientes : [])) { const key = claveFila(c); if (vistos.has(key)) continue; vistos.add(key); clientes.push(c); }
  const capacidad = Number(dest.data.capacidad || dest.data.total || 0) || clientes.length;
  if (!confirmado) return send(chatId, `🔗 Unir en el documento ${n + 1}: quedarían ${clientes.length}/${capacidad} perfiles${clientes.length > capacidad ? " ⚠️ NO CABEN" : ""} y el otro documento va a la papelera.\n\n${clientes.map((c) => `• ${c.nombre || "Sin nombre"}`).join("\n")}`,
    clientes.length > capacidad ? [[{ text: "⬅️ Volver", callback_data: `anom:dk:${k}` }]] : [[{ text: "✅ Sí, unir", callback_data: `anom:dmok:${k}:${n}` }], [{ text: "❌ Cancelar", callback_data: `anom:dk:${k}` }]]);
  if (!(await puede(userId))) return send(chatId, "⛔ No tiene permiso para corregir sincronización.");
  if (clientes.length > capacidad) return send(chatId, "⚠️ No caben todos los perfiles en una sola cuenta. Quite perfiles primero.");
  const norm = clientes.map((c, i) => ({ ...c, slot: i + 1 })), disp = Math.max(0, capacidad - norm.length);
  await db.collection("inventario").doc(dest.id).set({ clientes: norm, ocupados: norm.length, disponibles: disp, disp, capacidad, estado: disp === 0 ? "llena" : "activa", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  for (const d of docs.filter((_, i) => i !== n)) await integrity.trashDocument({ ref: db.collection("inventario").doc(d.id), kind: "inventario_cuenta", actor: actorDe(q, userId), operationId: integrity.makeWindowOperationKey("tg-dup-merge", [d.id, String(userId)], 120000), metadata: { plataforma: humano(p.plat), cuenta: p.acceso, motivo: `Duplicado unido en ${dest.id}` } });
  await auditar(userId, "unir_cuenta_duplicada", `${humano(p.plat)} · ${p.acceso}: ${docs.length} documentos → 1 (${norm.length} perfiles)`, { inventarioId: dest.id });
  return send(chatId, `✅ Unido: ${humano(p.plat)} · ${p.acceso} queda en un solo documento con ${norm.length}/${capacidad} perfiles. El otro está en la papelera.`);
}
async function borrarDuplicado(chatId, userId, q, k, n, confirmado) {
  const p = CLAVES.get(k); if (!p) return vencido(chatId);
  const docs = (await leerDocs(p.docIds)).filter((d) => d.existe); const d = docs[n];
  if (!d || docs.length < 2) return panelDuplicado(chatId, k);
  const cl = Array.isArray(d.data.clientes) ? d.data.clientes : [];
  if (!confirmado) return send(chatId, `🗑️ ¿Borrar el documento ${n + 1} de ${humano(p.plat)} · ${p.acceso}?\n${cl.length ? `⚠️ Tiene ${cl.length} perfil(es): ${cl.map((c) => c.nombre).join(", ")}. Si los quiere conservar, mejor use "Unir".` : "No tiene clientes."}\n\nVa a la papelera (se puede recuperar).`,
    [[{ text: "✅ Sí, borrar este", callback_data: `anom:ddok:${k}:${n}` }], [{ text: "❌ Cancelar", callback_data: `anom:dk:${k}` }]]);
  if (!(await puede(userId))) return send(chatId, "⛔ No tiene permiso para corregir sincronización.");
  const trash = await integrity.trashDocument({ ref: db.collection("inventario").doc(d.id), kind: "inventario_cuenta", actor: actorDe(q, userId), operationId: integrity.makeWindowOperationKey("tg-dup-delete", [d.id, String(userId)], 120000), metadata: { plataforma: humano(p.plat), cuenta: p.acceso, motivo: "Duplicado" } });
  await auditar(userId, "borrar_cuenta_duplicada", `${humano(p.plat)} · ${p.acceso}: documento ${d.id} a la papelera`, { inventarioId: d.id, papeleraId: trash?.trashId || "" });
  return send(chatId, `✅ Documento ${n + 1} enviado a la papelera. ${humano(p.plat)} · ${p.acceso} queda en un solo documento.\nCorra /sincronizar_todo.`);
}

// Botones de "Coincidencias de inventario": si la misma plataforma sale 2+ veces, es un duplicado → panel para resolverlo.
function tecladoCoincidencias(hits = [], q = "") {
  const porPlat = new Map();
  for (const h of hits) { const p = normalizarPlataforma(h.plataforma); if (!porPlat.has(p)) porPlat.set(p, []); porPlat.get(p).push(h); }
  const rows = [];
  for (const [p, hs] of porPlat) {
    if (hs.length === 1) rows.push([{ text: `📌 ${String(p).toUpperCase()}`, callback_data: `inv:open:${p}:${encodeURIComponent(q)}` }]);
    else rows.push([{ text: `🧬 ${String(p).toUpperCase()} · ${hs.length} duplicados — revisar`, callback_data: `anom:dk:${corto({ plat: p, acceso: q, docIds: hs.map((h) => h.id) })}` }]);
  }
  rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return rows;
}

async function txt(chatId) {
  const r = reporte(chatId); if (!r) return vencido(chatId);
  const a = r.anomalias, out = [`ANOMALÍAS DE SINCRONIZACIÓN · ${new Date(r.at).toISOString().slice(0, 16).replace("T", " ")} UTC`, ""];
  const cli = (x) => (x.clientes || []).map((c) => `${c.nombre || "Sin nombre"}${c.telefono ? ` (${c.telefono})` : ""}`).join("; ");
  out.push(`== ${TITULOS.otra} (${a.otra.length}) ==`, ...a.otra.map((x) => `${humano(x.plat)} | ${x.acceso} | existe en: ${x.otras.map(humano).join(", ")} | clientes: ${cli(x)}`), "");
  out.push(`== ${TITULOS.dup} (${a.dup.length}) ==`, ...a.dup.map((x) => `${humano(x.plat)} | ${x.acceso} | documentos: ${x.docIds.join(", ")}`), "");
  out.push(`== ${TITULOS.cap} (${a.cap.length}) ==`, ...a.cap.map((x) => `${humano(x.plat)} | ${x.acceso} | ${x.ocupados}/${x.capacidad} | ${x.nombres.join("; ")}`), "");
  out.push(`== ${TITULOS.sin} (${a.sin.length}) ==`, ...a.sin.map((x) => `${humano(x.plat)} | ${x.acceso} | clientes: ${cli(x)}`));
  return enviarTxtComoArchivo(chatId, out.join("\n"), `anomalias_sincronizacion_${new Date().toISOString().slice(0, 10)}.txt`);
}

async function callback(chatId, userId, data, q) {
  try {
    let m;
    if (data === "anom:txt") return txt(chatId);
    if ((m = data.match(/^anom:l:(otra|sin|dup|cap):(\d+)$/))) return lista(chatId, m[1], Number(m[2]));
    if ((m = data.match(/^anom:i:(otra|sin|dup|cap):(\d+)$/))) return detalle(chatId, m[1], Number(m[2]));
    if ((m = data.match(/^anom:c:(\w+)$/))) { const p = CLAVES.get(m[1]); if (!p) return vencido(chatId); return require("./index_03_clientes_crm").enviarFichaCliente(chatId, p.id); }
    if ((m = data.match(/^anom:ab:(\w+)$/))) { const p = CLAVES.get(m[1]); if (!p) return vencido(chatId); return require("./index_04_inventario_correos").enviarSubmenuInventario(chatId, p.plat, p.acceso); }
    if ((m = data.match(/^anom:mv(ok)?:(\d+):(\d+)$/))) return moverServicio(chatId, userId, Number(m[2]), Number(m[3]), !!m[1]);
    if ((m = data.match(/^anom:dk:(\w+)$/))) return panelDuplicado(chatId, m[1]);
    if ((m = data.match(/^anom:dm(ok)?:(\w+):(\d+)$/))) return unirDuplicado(chatId, userId, q, m[2], Number(m[3]), !!m[1]);
    if ((m = data.match(/^anom:dd(ok)?:(\w+):(\d+)$/))) return borrarDuplicado(chatId, userId, q, m[2], Number(m[3]), !!m[1]);
  } catch (e) { logErr("R141 anomalías", e); return send(chatId, `⚠️ ${String(e?.message || e).slice(0, 200)}`); }
  return null;
}

module.exports = { guardar, tecladoResumen, tecladoCoincidencias, callback, _pruebas: { CLAVES, REPORTES, claveFila } };
