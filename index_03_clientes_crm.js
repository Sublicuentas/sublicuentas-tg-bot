/* ✅ PARTE 3/6 — CLIENTES / CRM / RENOVACIONES / WIZARD
   Actualizada:
   - búsqueda robusta por nombre, teléfono, correo, usuario, pin y vendedor
   - ficha de cliente conservada
   - TXT / historial / renovaciones conservados
*/

const { bot, admin, db } = require("./index_01_core");
const {
  stripAcentos, normTxt, onlyDigits, normalizarPlataforma, docIdInventario, isFechaDMY,
  hoyDMY, esTelefono, parseDMYtoTS, addDaysDMY, escMD, enviarTxtComoArchivo, logErr,
  safeBtnLabel, normalizeRevendedorDoc, upsertPanel, w, wset, wclear,
  getIdentLabel, validateIdentByPlatform, normalizeIdentByPlatform,
} = require("./index_02_utils_roles");

function serviciosConIndiceOriginal(servicios = []) {
  const arr = Array.isArray(servicios)
    ? servicios.map((s, idxOriginal) => ({ ...(s || {}), idxOriginal }))
    : [];
  arr.sort((a, b) => parseDMYtoTS(a.fechaRenovacion) - parseDMYtoTS(b.fechaRenovacion));
  return arr;
}

function serviciosOrdenados(servicios = []) {
  return serviciosConIndiceOriginal(servicios).map((x) => {
    const c = { ...x };
    delete c.idxOriginal;
    return c;
  });
}

function daysUntilDMY(dmy) {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = String(dmy).split("/").map(Number);
  const target = new Date(yyyy, mm - 1, dd);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function estadoServicioLabel(fechaRenovacion) {
  const d = daysUntilDMY(fechaRenovacion);
  if (d === null) return "⚪ Sin fecha";
  if (d < 0) return "⚫ Vencido";
  if (d === 0) return "🔴 Vence hoy";
  if (d >= 1 && d <= 3) return "🟡 Próximo";
  return "🟢 Activo";
}

function emojiPlataforma(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const map = {
    netflix: "📺", vipnetflix: "🔥", disneyp: "🏰", disneys: "🎞️", hbomax: "🍿",
    primevideo: "🎥", paramount: "📀", crunchyroll: "🍥", vix: "🎬", appletv: "🍎",
    universal: "🌎", spotify: "🎵", youtube: "▶️", deezer: "🎧", canva: "🎨",
    gemini: "✨", chatgpt: "🤖", oleadatv1: "🌊", oleadatv3: "🌊", iptv1: "📡",
    iptv3: "📡", iptv4: "📡",
  };
  return map[p] || "📦";
}

function humanPlataforma(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const map = {
    netflix: "Netflix", vipnetflix: "VIP Netflix", disneyp: "Disney Premium", disneys: "Disney Standard",
    hbomax: "HBO Max", primevideo: "Prime Video", paramount: "Paramount+", crunchyroll: "Crunchyroll",
    vix: "Vix", appletv: "Apple TV", universal: "Universal+", spotify: "Spotify", youtube: "YouTube",
    deezer: "Deezer", canva: "Canva", gemini: "Gemini", chatgpt: "ChatGPT",
    oleadatv1: "OleadaTV (1)", oleadatv3: "OleadaTV (3)", iptv1: "IPTV (1)", iptv3: "IPTV (3)", iptv4: "IPTV (4)",
  };
  return map[p] || p || "-";
}

function labelPlataforma(plataforma = "") {
  return `${emojiPlataforma(plataforma)} ${humanPlataforma(plataforma)}`;
}

function getEstadoGeneralCliente(cliente = {}) {
  const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
  if (!servicios.length) return "⚪ Sin cuentas";
  const hayVencido = servicios.some((s) => isFechaDMY(s?.fechaRenovacion) && daysUntilDMY(s.fechaRenovacion) < 0);
  return hayVencido ? "🔴 Vencido" : "🟢 Vigente";
}

function getProximaRenovacionCliente(cliente = {}) {
  const servicios = serviciosOrdenados(Array.isArray(cliente.servicios) ? cliente.servicios : []);
  const conFecha = servicios.filter((s) => isFechaDMY(s.fechaRenovacion));
  return conFecha.length ? conFecha[0].fechaRenovacion || "-" : "-";
}

function getTotalMensualCliente(cliente = {}) {
  const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
  return servicios.reduce((acc, s) => acc + Number(s?.precio || 0), 0);
}

function getCapacidadBasePorPlataformaLocal(plataforma = "") {
  const plat = normalizarPlataforma(plataforma);
  const mapa = {
    netflix: 5, vipnetflix: 1, disney: 6, disneyp: 6, disneyplus: 6, disneys: 3,
    max: 5, hbomax: 5, primevideo: 5, prime: 5, paramount: 5, vix: 4, crunchyroll: 5,
    appletv: 4, universal: 4, spotify: 1, youtube: 1, deezer: 1, canva: 1, gemini: 1,
    chatgpt: 1, oleadatv1: 1, oleadatv3: 3, iptv1: 1, iptv3: 3, iptv4: 4,
  };
  return mapa[plat] || 1;
}

// ===============================
// HELPERS BÚSQUEDA
// ===============================
function dedupeClientes(arr = []) {
  const map = new Map();
  for (const c of Array.isArray(arr) ? arr : []) {
    const tel = String(c.telefono_norm || onlyDigits(c.telefono || "") || "").trim();
    const nom = String(c.nombre_norm || normTxt(c.nombrePerfil || c.nombre || "") || "").trim();
    const id = String(c.id || "").trim();
    const key = id || `${tel}__${nom}`;
    if (!map.has(key)) map.set(key, c);
  }
  return Array.from(map.values());
}

function scoreClienteBusqueda(c = {}, qNorm = "", qDigits = "") {
  const nombre = normTxt(c.nombrePerfil || c.nombre || "");
  const vendedor = normTxt(c.vendedor || "");
  const telefono = onlyDigits(c.telefono || "");
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];

  const correos = normTxt(servicios.map((s) => s?.correo || "").join(" "));
  const pines = normTxt(servicios.map((s) => s?.pin || "").join(" "));
  const plataformas = normTxt(servicios.map((s) => s?.plataforma || "").join(" "));

  let score = 0;

  if (qDigits) {
    if (telefono === qDigits) score = Math.max(score, 200);
    else if (telefono.includes(qDigits)) score = Math.max(score, 160);

    const pinesDigits = onlyDigits(servicios.map((s) => s?.pin || "").join(" "));
    const correosDigits = onlyDigits(servicios.map((s) => s?.correo || "").join(" "));
    if (pinesDigits.includes(qDigits)) score = Math.max(score, 90);
    if (correosDigits.includes(qDigits)) score = Math.max(score, 70);
  }

  if (qNorm) {
    if (nombre === qNorm) score = Math.max(score, 220);
    else if (nombre.startsWith(qNorm)) score = Math.max(score, 190);
    else if (nombre.includes(qNorm)) score = Math.max(score, 170);

    if (vendedor === qNorm) score = Math.max(score, 120);
    else if (vendedor.includes(qNorm)) score = Math.max(score, 90);

    if (correos.includes(qNorm)) score = Math.max(score, 130);
    if (plataformas.includes(qNorm)) score = Math.max(score, 80);
    if (pines.includes(qNorm)) score = Math.max(score, 70);

    const tokens = qNorm.split(" ").filter(Boolean);
    if (tokens.length >= 2) {
      const hitsNombre = tokens.filter((t) => nombre.includes(t)).length;
      if (hitsNombre === tokens.length) score = Math.max(score, 210);
      else if (hitsNombre >= 1) score = Math.max(score, 120);

      const hitsCorreo = tokens.filter((t) => correos.includes(t)).length;
      if (hitsCorreo === tokens.length) score = Math.max(score, 140);
    }
  }

  return score;
}

async function clienteDuplicado(nombre, telefono, excludeId = "") {
  const nombreN = normTxt(nombre);
  const telN = onlyDigits(telefono);
  if (!nombreN || !telN) return null;

  const snap = await db.collection("clientes").limit(5000).get();
  let duplicado = null;
  snap.forEach((doc) => {
    if (excludeId && String(doc.id) === String(excludeId)) return;
    const c = doc.data() || {};
    const dbNombre = normTxt(c.nombrePerfil || "");
    const dbTel = onlyDigits(c.telefono || "");
    if (dbNombre === nombreN && dbTel === telN && !duplicado) {
      duplicado = { id: doc.id, ...c };
    }
  });
  return duplicado;
}

async function getCliente(clientId) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  return doc.exists ? { id: doc.id, ...(doc.data() || {}) } : null;
}

async function patchServicio(clientId, idx, patch) {
  const ref = db.collection("clientes").doc(String(clientId));
  const doc = await ref.get();
  if (!doc.exists) return false;
  const c = doc.data() || {};
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return false;
  servicios[idx] = { ...(servicios[idx] || {}), ...patch };
  await ref.set({ servicios, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

async function getHistorialCliente(clientId) {
  try {
    const snap = await db.collection("clientes").doc(String(clientId)).collection("historial")
      .orderBy("createdAt", "desc").limit(500).get();
    if (snap.empty) return [];
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (_) {
    return [];
  }
}

async function registrarHistorialCliente(clientId, payload = {}) {
  try {
    await db.collection("clientes").doc(String(clientId)).collection("historial").add({
      ...payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logErr("registrarHistorialCliente:", e?.message || e);
  }
}

async function construirHistorialClienteTXT(cliente = {}, clientId = "") {
  const nombre = stripAcentos(cliente.nombrePerfil || "-");
  const telefono = onlyDigits(cliente.telefono || "") || "-";
  const vendedor = stripAcentos(cliente.vendedor || "-");
  const servicios = serviciosOrdenados(Array.isArray(cliente.servicios) ? cliente.servicios : []);
  const historial = clientId ? await getHistorialCliente(clientId) : [];
  let body = "";
  body += "HISTORIAL DEL CLIENTE\n\n";
  body += `NOMBRE: ${nombre}\n`;
  body += `TELEFONO: ${telefono}\n`;
  body += `VENDEDOR ACTUAL: ${vendedor}\n`;
  body += `ESTADO: ${stripAcentos(getEstadoGeneralCliente(cliente))}\n`;
  body += `TOTAL MENSUAL: ${getTotalMensualCliente(cliente)} Lps\n`;
  body += `PROXIMA RENOVACION: ${getProximaRenovacionCliente(cliente)}\n\n`;
  body += "SERVICIOS ACTIVOS\n\n";
  if (!servicios.length) {
    body += "SIN CUENTAS REGISTRADAS\n";
  } else {
    servicios.forEach((s, i) => {
      body += `${String(i + 1).padStart(2, "0")}) ${stripAcentos(humanPlataforma(s.plataforma || "-"))} | ${stripAcentos(String(s.correo || "-"))} | ${Number(s.precio || 0)} Lps | ${s.fechaRenovacion || "-"} | ESTADO: ${stripAcentos(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }
  body += "\n--------------------\n";
  body += `TOTAL SERVICIOS: ${servicios.length}\n\n`;
  body += "MOVIMIENTOS / HISTORIAL\n\n";
  if (!historial.length) {
    body += "SIN MOVIMIENTOS REGISTRADOS\n";
  } else {
    historial.forEach((h, i) => {
      const fecha = h.fecha || h.fechaRenovacion || h.createdAt?.toDate?.()?.toLocaleString?.("es-HN", { hour12: false }) || "-";
      body += `${String(i + 1).padStart(2, "0")}) ${stripAcentos(h.tipo || "movimiento")} | ${stripAcentos(humanPlataforma(h.plataforma || "-"))} | ${stripAcentos(String(h.correo || "-"))} | ${Number(h.precio || 0)} Lps | ${stripAcentos(String(fecha))} | VENDEDOR: ${stripAcentos(h.vendedor || vendedor || "-")}\n`;
    });
  }
  return body;
}

function clienteResumenTXT(c = {}) {
  const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);
  const estadoGeneral = getEstadoGeneralCliente(c);
  const totalMensual = getTotalMensualCliente(c);
  const proxFecha = getProximaRenovacionCliente(c);
  let body = "";
  body += "CLIENTE CRM\n\n";
  body += `NOMBRE: ${stripAcentos(c.nombrePerfil || "-")}\n`;
  body += `TELEFONO: ${onlyDigits(c.telefono || "") || "-"}\n`;
  body += `VENDEDOR: ${stripAcentos(c.vendedor || "-")}\n\n`;
  body += `SERVICIOS ACTIVOS: ${servicios.length}\n`;
  body += `TOTAL MENSUAL: ${totalMensual} Lps\n`;
  body += `PROXIMA RENOVACION: ${proxFecha}\n`;
  body += `ESTADO GENERAL: ${stripAcentos(estadoGeneral)}\n\nSERVICIOS\n\n`;
  if (!servicios.length) {
    body += "SIN SERVICIOS\n";
  } else {
    servicios.forEach((s, i) => {
      body += `${i + 1}) ${stripAcentos(humanPlataforma(s.plataforma || "-"))} | ${s.correo || "-"} | ${Number(s.precio || 0)} Lps | ${s.fechaRenovacion || "-"} | ${stripAcentos(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }
  return body;
}

async function enviarHistorialClienteTXT(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const body = await construirHistorialClienteTXT(c, clientId);
  const nombreSafe = stripAcentos(c.nombrePerfil || "cliente").replace(/[^\w\-]+/g, "_").slice(0, 40) || "cliente";
  return enviarTxtComoArchivo(chatId, body, `historial_${nombreSafe}_${Date.now()}.txt`);
}

async function enviarFichaCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const servicios = serviciosOrdenados(Array.isArray(c.servicios) ? c.servicios : []);
  const estadoGeneral = getEstadoGeneralCliente(c);
  const totalMensual = getTotalMensualCliente(c);
  const proxFecha = getProximaRenovacionCliente(c);

  let txt = "👤 *CRM CLIENTE*\n\n";
  txt += `🧑 *Nombre:* ${escMD(c.nombrePerfil || "-")}\n`;
  txt += `📱 *Teléfono:* ${escMD(c.telefono || "-")}\n`;
  txt += `🧾 *Vendedor:* ${escMD(c.vendedor || "-")}\n`;
  txt += `📊 *Estado general:* ${escMD(estadoGeneral)}\n`;
  txt += `💰 *Total mensual:* ${totalMensual} Lps\n`;
  txt += `📅 *Próxima renovación:* ${escMD(proxFecha)}\n`;
  txt += `🧩 *Servicios activos:* ${servicios.length}\n\n*SERVICIOS*\n`;

  if (!servicios.length) {
    txt += "— Sin servicios —\n";
  } else {
    servicios.forEach((s, i) => {
      txt += `\n*${i + 1})* ${escMD(labelPlataforma(s.plataforma || "-"))}\n`;
      txt += `🔐 ${escMD(s.correo || "-")}\n`;
      txt += `🔑 ${escMD(s.pin || "-")}\n`;
      txt += `💵 ${Number(s.precio || 0)} Lps\n`;
      txt += `📆 ${escMD(s.fechaRenovacion || "-")} — ${escMD(estadoServicioLabel(s.fechaRenovacion))}\n`;
    });
  }

  const kb = [];
  kb.push([{ text: "✏️ Editar cliente", callback_data: `cli:edit:menu:${clientId}` }]);
  if (servicios.length > 0) {
    kb.push([{ text: "🧩 Editar servicios", callback_data: `cli:serv:list:${clientId}` }]);
    kb.push([{ text: "🔄 Renovar servicio", callback_data: `cli:ren:list:${clientId}` }]);
    kb.push([{ text: "⏫ Renovar TODOS +30 días", callback_data: `cli:ren:all:ask:${clientId}` }]);
  }
  kb.push([{ text: "➕ Agregar servicio", callback_data: `cli:serv:add:${clientId}` }]);
  kb.push([{ text: "📄 TXT de este cliente", callback_data: `cli:txt:one:${clientId}` }]);
  kb.push([{ text: "📜 Historial TXT", callback_data: `cli:txt:hist:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

async function menuEditarCliente(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const t = `✏️ *EDITAR CLIENTE*\n\n👤 Nombre: *${escMD(c.nombrePerfil || "-")}*\n📱 Tel: *${escMD(c.telefono || "-")}*\n🧑‍💼 Vendedor: *${escMD(c.vendedor || "-")}*`;
  return upsertPanel(chatId, t, {
    inline_keyboard: [
      [{ text: "👤 Editar nombre", callback_data: `cli:edit:nombre:${clientId}` }],
      [{ text: "📱 Editar teléfono", callback_data: `cli:edit:tel:${clientId}` }],
      [{ text: "🧑‍💼 Editar vendedor", callback_data: `cli:edit:vend:${clientId}` }],
      [{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}

async function menuListaServicios(chatId, clientId) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const servicios = serviciosConIndiceOriginal(Array.isArray(c.servicios) ? c.servicios : []);
  if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

  const kb = servicios.map((s, i) => [
    {
      text: safeBtnLabel(`${i + 1}) ${labelPlataforma(s.plataforma)} — ${s.correo}`),
      callback_data: `cli:serv:menu:${clientId}:${s.idxOriginal}`,
    },
  ]);
  kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, "🧩 *EDITAR SERVICIOS*\nSeleccione un servicio:", { inline_keyboard: kb }, "Markdown");
}

async function menuServicio(chatId, clientId, idx) {
  const c = await getCliente(clientId);
  if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");

  const s = servicios[idx] || {};
  const labelAcceso = getIdentLabel(s.plataforma || "");
  const t =
    `🧩 *SERVICIO #${idx + 1}*\n\n` +
    `📌 Plataforma: *${escMD(labelPlataforma(s.plataforma || "-"))}*\n` +
    `${labelAcceso === "Usuario" ? "👤" : "📧"} ${labelAcceso}: *${escMD(s.correo || "-")}*\n` +
    `🔐 Clave: *${escMD(s.pin || "-")}*\n` +
    `💰 Precio: *${Number(s.precio || 0)}* Lps\n` +
    `📅 Renovación: *${escMD(s.fechaRenovacion || "-")}*\n` +
    `📊 Estado: *${escMD(estadoServicioLabel(s.fechaRenovacion))}*`;

  return upsertPanel(chatId, t, {
    inline_keyboard: [
      [{ text: "📌 Cambiar plataforma", callback_data: `cli:serv:edit:plat:${clientId}:${idx}` }],
      [{ text: `${labelAcceso === "Usuario" ? "👤" : "📧"} Cambiar ${labelAcceso.toLowerCase()}`, callback_data: `cli:serv:edit:mail:${clientId}:${idx}` }],
      [{ text: "🔐 Cambiar clave", callback_data: `cli:serv:edit:pin:${clientId}:${idx}` }],
      [{ text: "💰 Cambiar precio", callback_data: `cli:serv:edit:precio:${clientId}:${idx}` }],
      [{ text: "📅 Cambiar fecha", callback_data: `cli:serv:edit:fecha:${clientId}:${idx}` }],
      [{ text: "🗑️ Eliminar perfil", callback_data: `cli:serv:del:ask:${clientId}:${idx}` }],
      [{ text: "⬅️ Volver lista", callback_data: `cli:serv:list:${clientId}` }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}

async function addServicioTx(clientId, servicio) {
  const refCliente = db.collection("clientes").doc(String(clientId));
  const plat = normalizarPlataforma(servicio.plataforma);
  const ident = String(servicio.correo || "").trim().toLowerCase();
  const refInv = db.collection("inventario").doc(docIdInventario(ident, plat));

  return db.runTransaction(async (tx) => {
    const docCli = await tx.get(refCliente);
    if (!docCli.exists) throw new Error("Cliente no existe en TX");
    const curCli = docCli.data() || {};
    const docInv = await tx.get(refInv);

    const arrServ = Array.isArray(curCli.servicios) ? curCli.servicios.slice() : [];
    arrServ.push(servicio);

    tx.set(refCliente, {
      servicios: arrServ,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (docInv.exists) {
      const invData = docInv.data() || {};
      let clientesInv = Array.isArray(invData.clientes) ? invData.clientes.slice() : [];
      const capacidad = Number(invData.capacidad || invData.total || getCapacidadBasePorPlataformaLocal(plat) || 0);
      const yaExiste = clientesInv.some((c) => c.nombre === curCli.nombrePerfil && c.pin === servicio.pin);

      if (!yaExiste) {
        clientesInv.push({
          nombre: curCli.nombrePerfil || "Sin Nombre",
          pin: servicio.pin || "0000",
          slot: clientesInv.length + 1,
        });
        const ocupados = clientesInv.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "llena" : "activa";

        tx.set(refInv, {
          clientes: clientesInv,
          capacidad,
          ocupados,
          disponibles,
          disp: disponibles,
          estado,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    return { cliente: { id: docCli.id, ...curCli }, servicios: arrServ };
  });
}

function kbPlataformasWiz(prefix, clientId, idxOpt) {
  const cb = (plat) => idxOpt !== undefined ? `${prefix}:${plat}:${clientId}:${idxOpt}` : `${prefix}:${plat}:${clientId}`;
  return [
    [{ text: "📺 netflix", callback_data: cb("netflix") }, { text: "🔥 vipnetflix", callback_data: cb("vipnetflix") }],
    [{ text: "🏰 disneyp", callback_data: cb("disneyp") }, { text: "🎞️ disneys", callback_data: cb("disneys") }],
    [{ text: "🍿 hbomax", callback_data: cb("hbomax") }, { text: "🎥 primevideo", callback_data: cb("primevideo") }],
    [{ text: "📀 paramount", callback_data: cb("paramount") }, { text: "🍥 crunchyroll", callback_data: cb("crunchyroll") }],
    [{ text: "🎬 vix", callback_data: cb("vix") }, { text: "🍎 appletv", callback_data: cb("appletv") }],
    [{ text: "🌎 universal", callback_data: cb("universal") }, { text: "🎵 spotify", callback_data: cb("spotify") }],
    [{ text: "▶️ youtube", callback_data: cb("youtube") }, { text: "🎧 deezer", callback_data: cb("deezer") }],
    [{ text: "🎨 canva", callback_data: cb("canva") }, { text: "✨ gemini", callback_data: cb("gemini") }],
    [{ text: "🤖 chatgpt", callback_data: cb("chatgpt") }, { text: "🌊 oleadatv (1)", callback_data: cb("oleadatv1") }],
    [{ text: "🌊 oleadatv (3)", callback_data: cb("oleadatv3") }, { text: "📡 iptv (1)", callback_data: cb("iptv1") }],
    [{ text: "📡 iptv (3)", callback_data: cb("iptv3") }, { text: "📡 iptv (4)", callback_data: cb("iptv4") }],
  ];
}

async function wizardStart(chatId) {
  wset(chatId, { step: 1, data: {}, clientId: null, servStep: 0, servicio: {} });
  return bot.sendMessage(chatId, "👥 *NUEVO CLIENTE*\n\n(1/3) Escriba *Nombre*:", { parse_mode: "Markdown" });
}

async function wizardNext(chatId, text) {
  const st = w(chatId);
  if (!st) return;
  const t = String(text || "").trim();
  const d = st.data || {};

  if (st.step === 1) {
    if (!t) return bot.sendMessage(chatId, "⚠️ Nombre vacío. Escriba el nombre:");
    d.nombrePerfil = t;
    st.data = d;
    st.step = 2;
    wset(chatId, st);
    return bot.sendMessage(chatId, "(2/3) Escriba *Teléfono*:", { parse_mode: "Markdown" });
  }

  if (st.step === 2) {
    if (!esTelefono(t)) return bot.sendMessage(chatId, "⚠️ Teléfono inválido. Escriba solo números válidos:");
    d.telefono = t;
    st.data = d;
    st.step = 3;
    wset(chatId, st);
    return bot.sendMessage(chatId, "(3/3) Escriba *Vendedor*:", { parse_mode: "Markdown" });
  }

  if (st.step === 3) {
    if (!t) return bot.sendMessage(chatId, "⚠️ Vendedor vacío. Escríbalo:");
    d.vendedor = t;

    const dup = await clienteDuplicado(d.nombrePerfil || "", d.telefono || "");
    if (dup) {
      wclear(chatId);
      return bot.sendMessage(chatId, `⚠️ Cliente duplicado detectado.\nYa existe:\n${dup.nombrePerfil || "-"} | ${dup.telefono || "-"}`);
    }

    const clientRef = db.collection("clientes").doc();
    st.clientId = clientRef.id;

    await clientRef.set({
      nombrePerfil: d.nombrePerfil,
      telefono: String(d.telefono || "").trim(),
      vendedor: d.vendedor,
      servicios: [],
      nombre_norm: normTxt(d.nombrePerfil),
      telefono_norm: onlyDigits(d.telefono),
      vendedor_norm: normTxt(d.vendedor),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await registrarHistorialCliente(st.clientId, {
      tipo: "cliente_creado",
      nombrePerfil: d.nombrePerfil || "",
      telefono: String(d.telefono || "").trim(),
      vendedor: d.vendedor || "",
      fecha: hoyDMY(),
    });

    st.step = 4;
    st.servStep = 1;
    st.servicio = {};
    st.data = d;
    wset(chatId, st);

    return bot.sendMessage(chatId, "✅ Cliente creado.\n\n📌 Ahora agreguemos el servicio.\n(Servicio 1/5) Plataforma:", {
      reply_markup: { inline_keyboard: kbPlataformasWiz("wiz:plat", st.clientId) },
    });
  }

  if (st.step === 4) {
    const s = st.servicio || {};

    if (st.servStep === 1) {
      return bot.sendMessage(chatId, "📌 Seleccione la plataforma con los botones.");
    }

    if (st.servStep === 2) {
      const label = getIdentLabel(s.plataforma || "");
      if (!validateIdentByPlatform(s.plataforma || "", t)) {
        return bot.sendMessage(chatId, `⚠️ ${label} inválido. Escríbalo correctamente:`);
      }
      s.correo = normalizeIdentByPlatform(s.plataforma || "", t);
      st.servStep = 3;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 3/5) Clave/PIN:");
    }

    if (st.servStep === 3) {
      if (!t) return bot.sendMessage(chatId, "⚠️ Clave vacía. Escríbala:");
      s.pin = t;
      st.servStep = 4;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 4/5) Precio (solo número, Lps):");
    }

    if (st.servStep === 4) {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
      s.precio = n;
      st.servStep = 5;
      st.servicio = s;
      wset(chatId, st);
      return bot.sendMessage(chatId, "(Servicio 5/5) Fecha renovación (dd/mm/yyyy):");
    }

    if (st.servStep === 5) {
      if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");
      s.fechaRenovacion = String(t).trim();

      const { cliente, servicios } = await addServicioTx(String(st.clientId), {
        plataforma: String(s.plataforma || "").trim(),
        correo: String(s.correo || "").trim().toLowerCase(),
        pin: String(s.pin || "").trim(),
        precio: Number(s.precio || 0),
        fechaRenovacion: s.fechaRenovacion,
      });

      await registrarHistorialCliente(st.clientId, {
        tipo: "servicio_agregado",
        plataforma: String(s.plataforma || "").trim(),
        correo: String(s.correo || "").trim().toLowerCase(),
        pin: String(s.pin || "").trim(),
        precio: Number(s.precio || 0),
        fechaRenovacion: s.fechaRenovacion,
        vendedor: cliente?.vendedor || st.data?.vendedor || "",
        fecha: hoyDMY(),
      });

      st.servicio = {};
      st.servStep = 1;
      st.step = 4;
      wset(chatId, st);

      const ordenados = serviciosOrdenados(servicios);
      const resumen =
        "✅ Servicio agregado.\n¿Desea agregar otra plataforma a este cliente?\n\n" +
        `Cliente:\n${cliente?.nombrePerfil || st.data?.nombrePerfil || "-"}\n${cliente?.telefono || st.data?.telefono || "-"}\n${cliente?.vendedor || st.data?.vendedor || "-"}\n\n` +
        "SERVICIOS (ordenados por fecha):\n" +
        ordenados.map((x, i) => `${i + 1}) ${x.plataforma} — ${x.correo} — ${x.precio} Lps — Renueva: ${x.fechaRenovacion}`).join("\n");

      const kb = {
        inline_keyboard: [
          [{ text: "➕ Agregar otra", callback_data: `wiz:addmore:${st.clientId}` }],
          [{ text: "✅ Finalizar", callback_data: `wiz:finish:${st.clientId}` }],
        ],
      };

      if (resumen.length > 3800) {
        await enviarTxtComoArchivo(chatId, resumen, `resumen_servicios_${Date.now()}.txt`);
        return bot.sendMessage(chatId, "📄 Te mandé el resumen en TXT.\n¿Deseas agregar otra plataforma?", { reply_markup: kb });
      }

      return bot.sendMessage(chatId, resumen, { reply_markup: kb });
    }
  }
}

// ===============================
// BÚSQUEDA CLIENTES
// ===============================
// ===============================
// BÚSQUEDA CLIENTES (AJUSTADA A TU FIRESTORE REAL)
// ===============================
function flattenClienteTexts(value, acc = []) {
  if (value == null) return acc;

  if (Array.isArray(value)) {
    value.forEach((v) => flattenClienteTexts(v, acc));
    return acc;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((v) => flattenClienteTexts(v, acc));
    return acc;
  }

  acc.push(String(value));
  return acc;
}

function clienteNombrePrincipal(c = {}) {
  return String(
    c.nombrePerfil ||
    c.nombre ||
    c.perfil ||
    c.cliente ||
    c.fullName ||
    c.name ||
    ""
  ).trim();
}

function clienteTelefonoPrincipal(c = {}) {
  return String(
    c.telefono ||
    c.telefono_norm ||
    c.phone ||
    c.celular ||
    c.numero ||
    c.whatsapp ||
    ""
  ).trim();
}

function clienteVendedorPrincipal(c = {}) {
  return String(
    c.vendedor ||
    c.vendedor_norm ||
    c.seller ||
    c.revendedor ||
    ""
  ).trim();
}

function scoreClienteBusqueda(c = {}, qNorm = "", qDigits = "") {
  const nombre = normTxt(clienteNombrePrincipal(c) || c.nombre_norm || "");
  const vendedor = normTxt(clienteVendedorPrincipal(c) || c.vendedor_norm || "");
  const telefono = onlyDigits(clienteTelefonoPrincipal(c) || c.telefono_norm || "");

  const servicios = Array.isArray(c.servicios) ? c.servicios : [];
  const correosServicios = servicios.map((s) => String(s?.correo || "")).join(" | ");
  const flatTexts = flattenClienteTexts(c, []).join(" | ") + " | " + correosServicios;
  const flatNorm = normTxt(flatTexts);
  const flatDigits = onlyDigits(flatTexts);

  let score = 0;

  if (qDigits) {
    if (telefono === qDigits) score = Math.max(score, 300);
    else if (telefono.includes(qDigits)) score = Math.max(score, 260);

    if (flatDigits.includes(qDigits)) score = Math.max(score, 170);
  }

  if (qNorm) {
    if (nombre === qNorm) score = Math.max(score, 320);
    else if (nombre.startsWith(qNorm)) score = Math.max(score, 280);
    else if (nombre.includes(qNorm)) score = Math.max(score, 240);

    if (vendedor === qNorm) score = Math.max(score, 150);
    else if (vendedor.includes(qNorm)) score = Math.max(score, 120);

    if (flatNorm.includes(qNorm)) score = Math.max(score, 180);

    const tokens = qNorm.split(" ").filter(Boolean);
    if (tokens.length >= 2) {
      const hitsNombre = tokens.filter((t) => nombre.includes(t)).length;
      if (hitsNombre === tokens.length) score = Math.max(score, 300);
      else if (hitsNombre >= 1) score = Math.max(score, 220);

      const hitsFlat = tokens.filter((t) => flatNorm.includes(t)).length;
      if (hitsFlat === tokens.length) score = Math.max(score, 200);
    }
  }

  return score;
}

async function buscarPorTelefonoTodos(telInput) {
  const tnorm = onlyDigits(telInput);
  if (!tnorm) return [];

  const encontrados = [];
  const seen = new Set();

  try {
    const snapExact = await db.collection("clientes")
      .where("telefono_norm", "==", tnorm)
      .limit(50)
      .get();

    snapExact.forEach((doc) => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      encontrados.push({ id: doc.id, ...(doc.data() || {}), _score: 320 });
    });
  } catch (_) {}

  if (encontrados.length) {
    return dedupeClientes(encontrados).slice(0, 50);
  }

  const snap = await db.collection("clientes").get();

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const tel = onlyDigits(
      c.telefono_norm ||
      c.telefono ||
      c.phone ||
      c.celular ||
      c.numero ||
      c.whatsapp ||
      ""
    );

    const servicios = Array.isArray(c.servicios) ? c.servicios : [];
    const flatDigits = onlyDigits(
      flattenClienteTexts(c, []).join(" ") + " " + servicios.map((s) => String(s?.correo || "")).join(" ")
    );

    let score = 0;

    if (tel === tnorm) score = 300;
    else if (tel.includes(tnorm)) score = 260;
    else if (flatDigits.includes(tnorm)) score = 150;

    if (score > 0) {
      encontrados.push({ id: doc.id, ...c, _score: score });
    }
  });

  encontrados.sort((a, b) => {
    if ((b._score || 0) !== (a._score || 0)) return (b._score || 0) - (a._score || 0);
    return normTxt(clienteNombrePrincipal(a)).localeCompare(normTxt(clienteNombrePrincipal(b)));
  });

  return dedupeClientes(encontrados).slice(0, 50);
}

async function buscarClienteRobusto(queryLower) {
  const qRaw = String(queryLower || "").trim();
  const qNorm = normTxt(qRaw);
  const qDigits = onlyDigits(qRaw);

  if (!qNorm && !qDigits) return [];

  if (qDigits && qDigits.length >= 4) {
    const porTel = await buscarPorTelefonoTodos(qDigits);
    if (porTel.length) return porTel;
  }

  const encontrados = [];
  const seen = new Set();

  try {
    const snapNombre = await db.collection("clientes")
      .where("nombre_norm", ">=", qNorm)
      .where("nombre_norm", "<=", qNorm + "\uf8ff")
      .limit(25)
      .get();

    snapNombre.forEach((doc) => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      encontrados.push({ id: doc.id, ...(doc.data() || {}), _score: 340 });
    });
  } catch (_) {}

  if (encontrados.length) {
    encontrados.sort((a, b) => normTxt(clienteNombrePrincipal(a)).localeCompare(normTxt(clienteNombrePrincipal(b))));
    return dedupeClientes(encontrados).slice(0, 50);
  }

  const snap = await db.collection("clientes").get();

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const score = scoreClienteBusqueda(c, qNorm, qDigits);
    if (score > 0) encontrados.push({ id: doc.id, ...c, _score: score });
  });

  encontrados.sort((a, b) => {
    if ((b._score || 0) !== (a._score || 0)) return (b._score || 0) - (a._score || 0);
    return normTxt(clienteNombrePrincipal(a)).localeCompare(normTxt(clienteNombrePrincipal(b)));
  });

  return dedupeClientes(encontrados).slice(0, 50);
}

async function enviarListaResultadosClientes(chatId, resultados) {
  const dedup = dedupeClientes(resultados);

  if (!dedup.length) {
    return bot.sendMessage(chatId, "⚠️ Sin resultados.");
  }

  let txt = `📱 *RESULTADOS*\nSe encontraron *${dedup.length}* clientes.\n\n`;
  dedup.forEach((c, i) => {
    const servicios = Array.isArray(c.servicios) ? c.servicios.length : 0;
    txt += `*${i + 1})* ${escMD(clienteNombrePrincipal(c) || "-")} | ${escMD(clienteTelefonoPrincipal(c) || "-")} | ${escMD(clienteVendedorPrincipal(c) || "-")} | Servicios: ${servicios}\n`;
  });

  if (txt.length > 3800) {
    return enviarTxtComoArchivo(chatId, txt, `clientes_resultados_${Date.now()}.txt`);
  }

  const kb = dedup.map((c, i) => [
    {
      text: safeBtnLabel(`👤 ${i + 1}) ${clienteNombrePrincipal(c) || "-"} (${clienteTelefonoPrincipal(c) || "-"})`, 58),
      callback_data: `cli:view:${c.id}`,
    },
  ]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

// ===============================
// TXT / REPORTES / VENDEDORES
// ===============================
async function reporteClientesTXTGeneral(chatId) {
  const snap = await db.collection("clientes").limit(5000).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay clientes.");
  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  arr.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));
  let body = "CLIENTES (NOMBRE | TELEFONO)\n\n";
  arr.forEach((c, i) => {
    body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")}\n`;
  });
  body += `\n--------------------\nTOTAL CLIENTES: ${arr.length}\n`;
  return enviarTxtComoArchivo(chatId, body, `clientes_${Date.now()}.txt`);
}

async function reporteClientesSplitPorVendedorTXT(chatId) {
  const snap = await db.collection("clientes").limit(5000).get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay clientes.");
  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const map = new Map();

  for (const c of arr) {
    const vend = String(c.vendedor || "SIN VENDEDOR").trim() || "SIN VENDEDOR";
    if (!map.has(vend)) map.set(vend, []);
    map.get(vend).push(c);
  }

  const vendedores = Array.from(map.keys()).sort((a, b) => normTxt(a).localeCompare(normTxt(b)));
  await bot.sendMessage(chatId, `📄 Generando ${vendedores.length} TXT (1 por vendedor)...`);

  for (const vend of vendedores) {
    const lista = map.get(vend) || [];
    lista.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));
    let body = `VENDEDOR: ${stripAcentos(vend)}\nTOTAL CLIENTES: ${lista.length}\n\nCLIENTES (NOMBRE | TELEFONO)\n\n`;
    lista.forEach((c, i) => {
      body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")}\n`;
    });
    const fileSafe = stripAcentos(vend).replace(/[^\w\-]+/g, "_").slice(0, 40) || "VENDEDOR";
    await enviarTxtComoArchivo(chatId, body, `clientes_${fileSafe}_${Date.now()}.txt`);
  }

  return bot.sendMessage(chatId, "✅ Listo: enviados los TXT por vendedor.");
}

async function obtenerClientesPorVendedor(vendedorNombre) {
  const snap = await db.collection("clientes").limit(5000).get();
  const out = [];
  snap.forEach((doc) => {
    const c = doc.data() || {};
    if (normTxt(c.vendedor || "") === normTxt(vendedorNombre || "")) {
      out.push({ id: doc.id, ...c });
    }
  });
  out.sort((a, b) => normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil)));
  return out;
}

async function enviarMisClientes(chatId, vendedorNombre) {
  const arr = await obtenerClientesPorVendedor(vendedorNombre);
  if (!arr.length) return bot.sendMessage(chatId, `⚠️ No hay clientes para ${vendedorNombre}.`);
  let txt = `👥 *MIS CLIENTES — ${escMD(vendedorNombre)}*\n\n`;
  arr.forEach((c, i) => {
    const servicios = Array.isArray(c.servicios) ? c.servicios.length : 0;
    txt += `${i + 1}) ${escMD(c.nombrePerfil || "-")} | ${escMD(c.telefono || "-")} | Servicios: ${servicios}\n`;
  });
  return txt.length > 3800
    ? enviarTxtComoArchivo(chatId, txt, `mis_clientes_${Date.now()}.txt`)
    : bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
}

async function enviarMisClientesTXT(chatId, vendedorNombre) {
  const arr = await obtenerClientesPorVendedor(vendedorNombre);
  let body = `MIS CLIENTES - ${stripAcentos(vendedorNombre)}\n\n`;
  if (!arr.length) {
    body += "SIN CLIENTES\n";
  } else {
    arr.forEach((c, i) => {
      const servicios = Array.isArray(c.servicios) ? c.servicios.length : 0;
      body += `${String(i + 1).padStart(3, "0")}) ${stripAcentos(c.nombrePerfil || "-")} | ${onlyDigits(c.telefono || "")} | SERVICIOS: ${servicios}\n`;
    });
    body += `\n--------------------\nTOTAL CLIENTES: ${arr.length}\n`;
  }
  return enviarTxtComoArchivo(chatId, body, `mis_clientes_${Date.now()}.txt`);
}

async function obtenerRenovacionesPorFecha(fechaDMY, vendedorOpt) {
  const snap = await db.collection("clientes").limit(5000).get();
  const out = [];

  snap.forEach((doc) => {
    const c = doc.data() || {};
    const vendedor = String(c.vendedor || "").trim();
    const servicios = Array.isArray(c.servicios) ? c.servicios : [];

    for (const s of servicios) {
      if (String(s.fechaRenovacion || "") === fechaDMY) {
        const okVend = !vendedorOpt || normTxt(vendedor) === normTxt(vendedorOpt);
        if (okVend) {
          out.push({
            nombrePerfil: c.nombrePerfil || "-",
            plataforma: s.plataforma || "-",
            precio: Number(s.precio || 0),
            telefono: c.telefono || "-",
            vendedor: vendedor || "-",
            fechaRenovacion: fechaDMY,
          });
        }
      }
    }
  });

  out.sort((a, b) => {
    const va = normTxt(a.vendedor);
    const vb = normTxt(b.vendedor);
    return va !== vb ? va.localeCompare(vb) : normTxt(a.nombrePerfil).localeCompare(normTxt(b.nombrePerfil));
  });

  return out;
}

function renovacionesTexto(list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt ? `RENOVACIONES ${fechaDMY} — ${vendedorOpt}` : `RENOVACIONES ${fechaDMY} — GENERAL`;
  let t = `📅 *${escMD(titulo)}*\n\n`;
  if (!list || list.length === 0) {
    t += "⚠️ No hay renovaciones.\n";
    return t;
  }

  let suma = 0;
  list.forEach((x, i) => {
    suma += Number(x.precio || 0);
    t += `${i + 1}) ${escMD(x.nombrePerfil)} — ${escMD(x.plataforma)} — ${x.precio} Lps — ${escMD(x.telefono)} — ${escMD(x.vendedor)}\n`;
  });
  t += "\n━━━━━━━━━━━━━━\n";
  t += `Clientes: ${list.length}\n`;
  t += `Total a cobrar: ${suma} Lps\n`;
  return t;
}

async function enviarTXT(chatId, list, fechaDMY, vendedorOpt) {
  const titulo = vendedorOpt ? `renovaciones_${stripAcentos(vendedorOpt)}_${fechaDMY}` : `renovaciones_general_${fechaDMY}`;
  const fileSafe = titulo.replace(/[^\w\-]+/g, "_");
  let body = vendedorOpt ? `RENOVACIONES ${fechaDMY} - ${stripAcentos(vendedorOpt)}\n\n` : `RENOVACIONES ${fechaDMY} - GENERAL\n\n`;

  if (!list || list.length === 0) {
    body += "SIN RENOVACIONES\n";
  } else {
    let suma = 0;
    list.forEach((x, i) => {
      suma += Number(x.precio || 0);
      body += `${String(i + 1).padStart(2, "0")}) ${stripAcentos(x.nombrePerfil)} | ${x.plataforma} | ${x.precio} Lps | ${x.telefono} | ${stripAcentos(x.vendedor)}\n`;
    });
    body += `\n--------------------\nCLIENTES: ${list.length}\nTOTAL: ${suma} Lps\n`;
  }

  return enviarTxtComoArchivo(chatId, body, `${fileSafe}.txt`);
}

async function enviarTXTATodosHoy(superChatId) {
  const fecha = hoyDMY();
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(superChatId, "⚠️ No hay revendedores.");

  let enviados = 0;
  let saltados = 0;

  for (const d of snap.docs) {
    const rev = normalizeRevendedorDoc(d);
    if (!rev.activo || !rev.telegramId || !rev.nombre) {
      saltados++;
      continue;
    }
    const list = await obtenerRenovacionesPorFecha(fecha, rev.nombre);
    await enviarTXT(rev.telegramId, list, fecha, rev.nombre);
    enviados++;
  }

  return bot.sendMessage(superChatId, `✅ Enviado TXT HOY (${fecha})\n• Revendedores enviados: ${enviados}\n• Saltados: ${saltados}`);
}

module.exports = {
  serviciosConIndiceOriginal,
  serviciosOrdenados,
  daysUntilDMY,
  estadoServicioLabel,
  emojiPlataforma,
  humanPlataforma,
  labelPlataforma,
  getEstadoGeneralCliente,
  getProximaRenovacionCliente,
  getTotalMensualCliente,
  dedupeClientes,
  clienteDuplicado,
  getCliente,
  patchServicio,
  addServicioTx,
  getHistorialCliente,
  registrarHistorialCliente,
  construirHistorialClienteTXT,
  clienteResumenTXT,
  enviarHistorialClienteTXT,
  enviarFichaCliente,
  menuEditarCliente,
  menuListaServicios,
  menuServicio,
  kbPlataformasWiz,
  wizardStart,
  wizardNext,
  buscarPorTelefonoTodos,
  buscarClienteRobusto,
  enviarListaResultadosClientes,
  reporteClientesTXTGeneral,
  reporteClientesSplitPorVendedorTXT,
  obtenerClientesPorVendedor,
  enviarMisClientes,
  enviarMisClientesTXT,
  obtenerRenovacionesPorFecha,
  renovacionesTexto,
  enviarTXT,
  enviarTXTATodosHoy,
};
