/* ✅ PARTE 5/6 — actualizado */

const { bot, admin, db, ExcelJS, PLATAFORMAS, FINANZAS_COLLECTION, FIN_BANCOS, FIN_MOTIVOS_EGRESO } = require("./index_01_core");
const {
  escMD, upsertPanel, sendCommandAnchoredPanel, parseFechaFinanceInput, parseMontoNumber,
  parseMonthInputToKey, getMonthLabelFromKey, getMonthKeyFromDMY, startOfDayTS, endOfDayTS,
  ymdFromDMY, isFechaDMY, hoyDMY, moneyLps, logErr, isSuperAdmin,
} = require("./index_02_utils_roles");

async function menuPrincipal(chatId) {
  return upsertPanel(chatId, "📌 *MENÚ PRINCIPAL*", {
    inline_keyboard: [
      [{ text: "📦 Inventario", callback_data: "menu:inventario" }],
      [{ text: "👥 Clientes", callback_data: "menu:clientes" }],
      [{ text: "💳 Pagos", callback_data: "menu:pagos" }],
      [{ text: "📅 Renovaciones", callback_data: "menu:renovaciones" }],
      [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
    ],
  });
}
async function menuPrincipalFromCommand(msg) {
  return sendCommandAnchoredPanel(msg, "📌 *MENÚ PRINCIPAL*", {
    inline_keyboard: [
      [{ text: "📦 Inventario", callback_data: "menu:inventario" }],
      [{ text: "👥 Clientes", callback_data: "menu:clientes" }],
      [{ text: "💳 Pagos", callback_data: "menu:pagos" }],
      [{ text: "📅 Renovaciones", callback_data: "menu:renovaciones" }],
      [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
    ],
  }, "Markdown");
}
async function menuVendedor(chatId) {
  return upsertPanel(chatId, "👤 *MENÚ VENDEDOR*\n\nFunciones disponibles:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n", {
    inline_keyboard: [
      [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
      [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
      [{ text: "👥 Mis clientes", callback_data: "vend:clientes" }],
      [{ text: "📄 TXT Mis clientes", callback_data: "vend:clientes:txt" }],
    ],
  });
}
async function menuVendedorFromCommand(msg) {
  return sendCommandAnchoredPanel(msg, "👤 *MENÚ VENDEDOR*\n\nFunciones disponibles:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n", {
    inline_keyboard: [
      [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
      [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
      [{ text: "👥 Mis clientes", callback_data: "vend:clientes" }],
      [{ text: "📄 TXT Mis clientes", callback_data: "vend:clientes:txt" }],
    ],
  }, "Markdown");
}
async function menuInventario(chatId) {
  return upsertPanel(chatId, "📦 *INVENTARIO CENTRAL*\n\nSeleccione categoría:", {
    inline_keyboard: [
      [{ text: "🎬 Video", callback_data: "menu:inventario:video" }, { text: "🎵 Música", callback_data: "menu:inventario:musica" }],
      [{ text: "📡 IPTV", callback_data: "menu:inventario:iptv" }, { text: "🎨 Diseño e IA", callback_data: "menu:inventario:designai" }],
      [{ text: "📊 Stock General", callback_data: "inv:general" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}
async function menuInventarioVideo(chatId) {
  return upsertPanel(chatId, "🎬 *VIDEO*\n\nSeleccione plataforma:", {
    inline_keyboard: [
      [{ text: "📺 Netflix", callback_data: "inv:netflix:0" }, { text: "🔥 VIP Netflix", callback_data: "inv:vipnetflix:0" }],
      [{ text: "🏰 Disney+ P", callback_data: "inv:disneyp:0" }, { text: "🎞️ Disney+ S", callback_data: "inv:disneys:0" }],
      [{ text: "🍿 HBO Max", callback_data: "inv:hbomax:0" }, { text: "🎥 Prime Video", callback_data: "inv:primevideo:0" }],
      [{ text: "📀 Paramount+", callback_data: "inv:paramount:0" }, { text: "🍥 Crunchyroll", callback_data: "inv:crunchyroll:0" }],
      [{ text: "🎬 Vix", callback_data: "inv:vix:0" }, { text: "🍎 Apple TV", callback_data: "inv:appletv:0" }],
      [{ text: "🌎 Universal+", callback_data: "inv:universal:0" }],
      [{ text: "⬅️ Volver", callback_data: "menu:inventario" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}
async function menuInventarioMusica(chatId) {
  return upsertPanel(chatId, "🎵 *MÚSICA*\n\nSeleccione plataforma:", {
    inline_keyboard: [
      [{ text: "🎵 Spotify", callback_data: "inv:spotify:0" }, { text: "▶️ YouTube", callback_data: "inv:youtube:0" }],
      [{ text: "🎧 Deezer", callback_data: "inv:deezer:0" }],
      [{ text: "⬅️ Volver", callback_data: "menu:inventario" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}
async function menuInventarioIptv(chatId) {
  return upsertPanel(chatId, "📡 *IPTV*\n\nSeleccione plataforma:", {
    inline_keyboard: [
      [{ text: "🌊 Oleada 1", callback_data: "inv:oleadatv1:0" }, { text: "🌊 Oleada 3", callback_data: "inv:oleadatv3:0" }],
      [{ text: "📡 IPTV 1", callback_data: "inv:iptv1:0" }, { text: "📡 IPTV 3", callback_data: "inv:iptv3:0" }],
      [{ text: "📡 IPTV 4", callback_data: "inv:iptv4:0" }],
      [{ text: "⬅️ Volver", callback_data: "menu:inventario" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}
async function menuInventarioDisenoIA(chatId) {
  return upsertPanel(chatId, "🎨 *DISEÑO E IA*\n\nSeleccione plataforma:", {
    inline_keyboard: [
      [{ text: "🎨 Canva", callback_data: "inv:canva:0" }, { text: "✨ Gemini", callback_data: "inv:gemini:0" }],
      [{ text: "🤖 ChatGPT", callback_data: "inv:chatgpt:0" }],
      [{ text: "⬅️ Volver", callback_data: "menu:inventario" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}
async function menuClientes(chatId) {
  return upsertPanel(chatId, "👥 *CLIENTES*\n\n• Nuevo cliente (wizard)\n• Buscar (abre ficha)\n• TXT General (Nombre | Tel)\n• TXT 1 por vendedor\n\n💡 Tip:\nEscriba: */NOMBRE* o */TELEFONO* para abrir listado.", {
    inline_keyboard: [
      [{ text: "➕ Nuevo cliente", callback_data: "cli:wiz:start" }],
      [{ text: "🔎 Buscar", callback_data: "menu:buscar" }],
      [{ text: "📄 TXT General", callback_data: "cli:txt:general" }],
      [{ text: "📄 TXT 1 por vendedor", callback_data: "cli:txt:vendedores_split" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  });
}
async function menuRenovaciones(chatId, userIdOpt) {
  const isSA = userIdOpt ? await isSuperAdmin(userIdOpt) : false;
  const kb = [
    [{ text: "📅 Renovaciones hoy", callback_data: "ren:hoy" }],
    [{ text: "📄 TXT hoy", callback_data: "txt:hoy" }],
    [{ text: "🧾 Mis renovaciones", callback_data: "ren:mis" }],
    [{ text: "📄 TXT Mis renovaciones", callback_data: "txt:mis" }],
    [{ text: "👤 Revendedores (lista)", callback_data: "rev:lista" }],
  ];
  if (isSA) kb.push([{ text: "📬 Enviar TXT a TODOS (HOY)", callback_data: "txt:todos:hoy" }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return upsertPanel(chatId, "📅 *RENOVACIONES*\n\nComandos:\n• /renovaciones hoy\n• /renovaciones dd/mm/yyyy\n• /renovaciones VENDEDOR dd/mm/yyyy\n\nTXT:\n• /txt hoy\n• /txt dd/mm/yyyy\n• /txt VENDEDOR dd/mm/yyyy\n\n✅ Nota:\n• *Enviar TXT a TODOS (HOY)* solo SUPERADMIN.\n", { inline_keyboard: kb });
}
async function menuPagos(chatId) {
  return upsertPanel(chatId, "💳 *FINANZAS V13 PRO*\n\nSeleccione una opción:", {
    inline_keyboard: [
      [{ text: "📝 Registro", callback_data: "fin:menu:registro" }],
      [{ text: "📊 Reportes", callback_data: "fin:menu:reportes" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}
const menuFinanzas = menuPagos;
async function menuFinRegistro(chatId) {
  return upsertPanel(chatId, "📝 *REGISTRO FINANCIERO*\n\nSeleccione una opción:", {
    inline_keyboard: [
      [{ text: "➕ Registrar ingreso", callback_data: "fin:menu:ingreso" }],
      [{ text: "➖ Registrar egreso", callback_data: "fin:menu:egreso" }],
      [{ text: "🗑️ Eliminar movimiento específico", callback_data: "fin:menu:eliminar" }],
      [{ text: "🧾 Cierre de caja", callback_data: "fin:menu:cierre" }],
      [{ text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}
async function menuFinEliminarTipo(chatId) {
  return upsertPanel(chatId, "🗑️ *ELIMINAR MOVIMIENTO ESPECÍFICO*\n\nSeleccione qué desea listar para eliminar.\nLuego podrá escoger *un solo registro exacto*:", {
    inline_keyboard: [
      [{ text: "➕ Ver ingresos", callback_data: "fin:menu:eliminar:ingreso" }],
      [{ text: "➖ Ver egresos", callback_data: "fin:menu:eliminar:egreso" }],
      [{ text: "⬅️ Volver Registro", callback_data: "fin:menu:registro" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}
async function menuFinEliminarListado(chatId, tipo = "", list = []) {
  const tipoNorm = String(tipo || "").trim().toLowerCase() === "egreso" ? "egreso" : "ingreso";
  const titulo = tipoNorm === "egreso" ? "➖ *EGRESOS RECIENTES*" : "➕ *INGRESOS RECIENTES*";
  const rows = [];
  if (!Array.isArray(list) || !list.length) {
    rows.push([{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }]);
    rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
    return upsertPanel(chatId, `${titulo}\n\n⚠️ No hay movimientos recientes para mostrar.`, { inline_keyboard: rows }, "Markdown");
  }
  for (const m of list) rows.push([{ text: buildEliminarMovimientoLabel(m), callback_data: `fin:del:pick:${m.id}` }]);
  rows.push([{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }]);
  rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return upsertPanel(chatId, `${titulo}\n\nSeleccione el movimiento exacto que desea eliminar:`, { inline_keyboard: rows }, "Markdown");
}
async function menuFinReportes(chatId) {
  return upsertPanel(chatId, "📊 *REPORTES FINANCIEROS*\n\nSeleccione una opción:", {
    inline_keyboard: [
      [{ text: "📊 Resumen por fecha", callback_data: "fin:menu:resumen_fecha" }],
      [{ text: "🏦 Resumen por banco del mes", callback_data: "fin:menu:bancos_mes" }],
      [{ text: "🏆 Top plataformas del mes", callback_data: "fin:menu:top_plataformas" }],
      [{ text: "📤 Exportar Excel PRO", callback_data: "fin:menu:excel_rango" }],
      [{ text: "⬅️ Volver Finanzas", callback_data: "menu:pagos" }],
      [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
    ],
  }, "Markdown");
}

function getFinBancos() { return Array.isArray(global.FIN_BANCOS) && global.FIN_BANCOS.length ? global.FIN_BANCOS : FIN_BANCOS; }
function getFinMotivosEgreso() { return Array.isArray(global.FIN_MOTIVOS_EGRESO) && global.FIN_MOTIVOS_EGRESO.length ? global.FIN_MOTIVOS_EGRESO : FIN_MOTIVOS_EGRESO; }
function getFinPlataformasIngreso() { return Array.isArray(PLATAFORMAS) ? PLATAFORMAS.slice() : []; }
function kbBancosFinanzas() {
  const bancos = getFinBancos(); const rows = [];
  for (let i = 0; i < bancos.length; i += 2) {
    const row = [{ text: bancos[i], callback_data: `fin:ing:banco:${encodeURIComponent(bancos[i])}` }];
    if (bancos[i + 1]) row.push({ text: bancos[i + 1], callback_data: `fin:ing:banco:${encodeURIComponent(bancos[i + 1])}` });
    rows.push(row);
  }
  rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return { inline_keyboard: rows };
}
function kbMotivosFinanzas() {
  const motivos = getFinMotivosEgreso(); const rows = [];
  for (let i = 0; i < motivos.length; i += 2) {
    const row = [{ text: motivos[i], callback_data: `fin:egr:motivo:${encodeURIComponent(motivos[i])}` }];
    if (motivos[i + 1]) row.push({ text: motivos[i + 1], callback_data: `fin:egr:motivo:${encodeURIComponent(motivos[i + 1])}` });
    rows.push(row);
  }
  rows.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);
  return { inline_keyboard: rows };
}
function splitPlataformasManual(input = "") { return String(input || "").split(/\n|,|;|\+|\/|\|/g).map((x) => String(x || "").trim()).filter(Boolean); }
function normalizarCategoriaPlataforma(txt = "") {
  const s = String(txt || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.includes("netflix")) return "netflix";
  if (s.includes("disney")) return "disney";
  if (s.includes("hbo") || s.includes("max")) return "hbomax";
  if (s.includes("prime")) return "primevideo";
  if (s.includes("oleada")) return "oleada";
  if (s.includes("spotify")) return "spotify";
  if (s.includes("vix")) return "vix";
  if (s.includes("crunchy")) return "crunchyroll";
  if (s.includes("paramount")) return "paramount";
  if (s.includes("apple")) return "appletv";
  if (s.includes("youtube")) return "youtube";
  if (s.includes("universal")) return "universal";
  if (s.includes("canva")) return "canva";
  if (s.includes("gemini")) return "gemini";
  if (s.includes("chatgpt")) return "chatgpt";
  if (s.includes("deezer")) return "deezer";
  if (s.includes("iptv")) return "iptv";
  return s;
}
function humanCategoriaPlataforma(cat = "") {
  const c = String(cat || "").trim();
  const map = {
    netflix: "Netflix", disney: "Disney", hbomax: "HBO Max", primevideo: "Prime Video",
    oleada: "Oleada", spotify: "Spotify", vix: "Vix", crunchyroll: "Crunchyroll", paramount: "Paramount+",
    appletv: "Apple TV", youtube: "YouTube", universal: "Universal+", canva: "Canva", gemini: "Gemini",
    chatgpt: "ChatGPT", deezer: "Deezer", iptv: "IPTV",
  };
  return map[c] || c || "-";
}
function getCategoriasPlataformasDesdeTexto(plataformaRaw = "") {
  const items = splitPlataformasManual(plataformaRaw);
  const cats = items.map((x) => normalizarCategoriaPlataforma(x)).filter(Boolean);
  return Array.from(new Set(cats));
}
async function registrarIngresoTx({ monto, banco, fecha, userId, userName = "", plataforma = "", detalle = "", vendedor = "", cliente = "" }) {
  const parsed = parseFechaFinanceInput(fecha); if (!parsed.ok) throw new Error("Fecha inválida");
  const nMonto = parseMontoNumber(monto); if (!Number.isFinite(nMonto) || nMonto <= 0) throw new Error("Monto inválido");
  const plataformasArray = getCategoriasPlataformasDesdeTexto(plataforma);
  const ref = db.collection(FINANZAS_COLLECTION).doc();
  await ref.set({
    tipo: "ingreso", monto: Number(nMonto), banco: String(banco || "Otro").trim(), motivo: "",
    detalle: String(detalle || "").trim(), plataforma: String(plataforma || "").trim(), plataformas: plataformasArray,
    vendedor: String(vendedor || "").trim(), cliente: String(cliente || "").trim(), fecha: parsed.fecha,
    fechaTS: parsed.fechaTS, mesKey: parsed.mesKey, createdBy: String(userId), createdByName: String(userName || "").trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { id: ref.id, fecha: parsed.fecha, monto: nMonto, banco: String(banco || "Otro").trim(), plataforma: String(plataforma || "").trim(), plataformas: plataformasArray, detalle: String(detalle || "").trim() };
}
async function registrarEgresoTx({ monto, motivo, fecha, userId, userName = "", detalle = "", vendedor = "", cliente = "" }) {
  const parsed = parseFechaFinanceInput(fecha); if (!parsed.ok) throw new Error("Fecha inválida");
  const nMonto = parseMontoNumber(monto); if (!Number.isFinite(nMonto) || nMonto <= 0) throw new Error("Monto inválido");
  const ref = db.collection(FINANZAS_COLLECTION).doc();
  await ref.set({
    tipo: "egreso", monto: Number(nMonto), banco: "", motivo: String(motivo || "Otros").trim(), detalle: String(detalle || "").trim(),
    plataforma: "", plataformas: [], vendedor: String(vendedor || "").trim(), cliente: String(cliente || "").trim(),
    fecha: parsed.fecha, fechaTS: parsed.fechaTS, mesKey: parsed.mesKey, createdBy: String(userId), createdByName: String(userName || "").trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { id: ref.id, fecha: parsed.fecha, monto: nMonto, motivo: String(motivo || "Otros").trim(), detalle: String(detalle || "").trim() };
}
async function getMovimientosPorFecha(fechaDMY) {
  const ini = startOfDayTS(fechaDMY); const fin = endOfDayTS(fechaDMY);
  const snap = await db.collection(FINANZAS_COLLECTION).where("fechaTS", ">=", ini).where("fechaTS", "<=", fin).get();
  const movs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  movs.sort((a, b) => Number(a.fechaTS || 0) !== Number(b.fechaTS || 0) ? Number(a.fechaTS || 0) - Number(b.fechaTS || 0) : String(a.tipo || "").localeCompare(String(b.tipo || "")));
  return movs;
}
async function getMovimientosPorMes(monthKey) {
  const snap = await db.collection(FINANZAS_COLLECTION).where("mesKey", "==", monthKey).get();
  const movs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  movs.sort((a, b) => Number(a.fechaTS || 0) - Number(b.fechaTS || 0));
  return movs;
}
async function getMovimientosRecientesParaEliminar(tipo = "", limit = 20) {
  const tipoNorm = String(tipo || "").trim().toLowerCase();
  if (!["ingreso", "egreso"].includes(tipoNorm)) return [];
  const take = Math.max(Number(limit || 20) * 4, 80);
  const snap = await db.collection(FINANZAS_COLLECTION).orderBy("fechaTS", "desc").limit(take).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).filter((m) => String(m.tipo || "").trim().toLowerCase() === tipoNorm).slice(0, Number(limit || 20));
}
async function getMovimientosPorTipo(tipo = "", limit = 20) { return getMovimientosRecientesParaEliminar(tipo, limit); }
function agruparIngresosPorBanco(movs = []) {
  const map = new Map();
  for (const m of movs) {
    if (String(m.tipo || "") !== "ingreso") continue;
    const banco = String(m.banco || "Otro").trim() || "Otro";
    map.set(banco, Number(map.get(banco) || 0) + Number(m.monto || 0));
  }
  return Array.from(map.entries()).map(([banco, monto]) => ({ banco, monto })).sort((a, b) => b.monto - a.monto);
}
function agruparIngresosPorPlataforma(movs = []) {
  const map = new Map();
  for (const m of movs) {
    if (String(m.tipo || "") !== "ingreso") continue;
    let cats = Array.isArray(m.plataformas) ? m.plataformas.filter(Boolean) : [];
    if (!cats.length && m.plataforma) cats = getCategoriasPlataformasDesdeTexto(m.plataforma);
    if (!cats.length) continue;
    const monto = Number(m.monto || 0);
    const reparto = cats.length > 0 ? monto / cats.length : 0;
    for (const cat of cats) map.set(cat, Number(map.get(cat) || 0) + reparto);
  }
  return Array.from(map.entries()).map(([plataforma, monto]) => ({ plataforma, monto })).sort((a, b) => b.monto - a.monto);
}
function agruparEgresosPorMotivo(movs = []) {
  const map = new Map();
  for (const m of movs) {
    if (String(m.tipo || "") !== "egreso") continue;
    const motivo = String(m.motivo || "Otros").trim() || "Otros";
    map.set(motivo, Number(map.get(motivo) || 0) + Number(m.monto || 0));
  }
  return Array.from(map.entries()).map(([motivo, monto]) => ({ motivo, monto })).sort((a, b) => b.monto - a.monto);
}
function calcularTotalesMovimientos(movs = []) {
  let ingresos = 0, egresos = 0;
  for (const m of movs) {
    if (String(m.tipo || "") === "ingreso") ingresos += Number(m.monto || 0);
    if (String(m.tipo || "") === "egreso") egresos += Number(m.monto || 0);
  }
  return { ingresos, egresos, neta: ingresos - egresos };
}
function getConceptoMovimientoFin(m = {}) { return String(m.tipo || "") === "ingreso" ? String(m.plataforma || m.detalle || m.cliente || "Sin detalle").trim() : String(m.detalle || m.motivo || m.cliente || "Sin detalle").trim(); }
function buildEliminarMovimientoLabel(m = {}) {
  const esIngreso = String(m.tipo || "") === "ingreso";
  const icon = esIngreso ? "➕" : "➖";
  const fecha = String(m.fecha || "").trim() || "--/--/----";
  const monto = moneyLps(Number(m.monto || 0));
  const extra = esIngreso ? String(m.banco || "Sin banco").trim() : String(m.motivo || "Sin motivo").trim();
  const concepto = getConceptoMovimientoFin(m).replace(/\s+/g, " ").trim();
  return `${icon} ${fecha} • ${monto} • ${concepto.length > 24 ? `${concepto.slice(0, 24)}…` : concepto} • ${extra.length > 16 ? `${extra.slice(0, 16)}…` : extra}`;
}
function buildEliminarMovimientoTexto(m = {}) {
  const esIngreso = String(m.tipo || "") === "ingreso";
  const tipo = esIngreso ? "INGRESO" : "EGRESO";
  const fecha = escMD(String(m.fecha || "").trim() || "--/--/----");
  const monto = escMD(moneyLps(Number(m.monto || 0)));
  const bancoMotivo = esIngreso ? `*Banco:* ${escMD(String(m.banco || "Sin banco").trim())}` : `*Motivo:* ${escMD(String(m.motivo || "Sin motivo").trim())}`;
  const plataforma = esIngreso && String(m.plataforma || "").trim() ? `\n*Plataforma:* ${escMD(String(m.plataforma || "").trim())}` : "";
  const detalle = `*Detalle:* ${escMD(String(m.detalle || "").trim() || "Sin detalle")}`;
  const cliente = String(m.cliente || "").trim() ? `\n*Cliente:* ${escMD(String(m.cliente || "").trim())}` : "";
  const vendedor = String(m.vendedor || "").trim() ? `\n*Vendedor:* ${escMD(String(m.vendedor || "").trim())}` : "";
  const user = String(m.createdByName || m.createdBy || "").trim() ? `\n*Registrado por:* ${escMD(String(m.createdByName || m.createdBy || "").trim())}` : "";
  return `🗑️ *CONFIRMAR ELIMINACIÓN*\n\n*Tipo:* ${tipo}\n*Fecha:* ${fecha}\n*Monto:* ${monto}\n${bancoMotivo}${plataforma}\n${detalle}${cliente}${vendedor}${user}\n\n¿Desea eliminar este movimiento?`;
}
function textoConfirmarEliminacionMovimiento(m = {}) { return buildEliminarMovimientoTexto(m); }
function resumenFinanzasTextoPorFecha(fechaDMY, movs = []) {
  const { ingresos, egresos, neta } = calcularTotalesMovimientos(movs);
  let txt = `📊 *ESTADO DE RESULTADOS (${escMD(fechaDMY)})*\n\n`;
  if (!movs.length) return txt + `⚠️ No hay movimientos registrados.\n\n💰 *INGRESOS:* ${moneyLps(0)}\n💸 *EGRESOS:* ${moneyLps(0)}\n📈 *GANANCIA NETA:* ${moneyLps(0)}\n`;
  txt += "*MOVIMIENTOS DEL DÍA*\n\n";
  movs.forEach((m, i) => {
    const esIngreso = String(m.tipo || "") === "ingreso";
    const signo = esIngreso ? "+" : "-";
    const bancoOMotivo = esIngreso ? String(m.banco || "Sin banco") : String(m.motivo || "Sin motivo");
    const concepto = esIngreso ? String(m.plataforma || m.detalle || "-") : String(m.detalle || m.motivo || "-");
    const usuario = String(m.createdByName || m.createdBy || "Admin");
    txt += `${i + 1}) ${signo} *${escMD(moneyLps(Number(m.monto || 0)))}* ${escMD(concepto)} — ${escMD(usuario)} — ${escMD(bancoOMotivo)}\n`;
  });
  txt += `\n━━━━━━━━━━━━━━\n💰 *INGRESOS:* ${moneyLps(ingresos)}\n💸 *EGRESOS:* ${moneyLps(egresos)}\n📈 *GANANCIA NETA:* ${neta >= 0 ? "+" : ""}${moneyLps(neta)} ${neta >= 0 ? "🟢" : "🔴"}\n🧾 *Movimientos:* ${movs.length}`;
  return txt;
}
function resumenBancosMesTexto(monthKey, movs = []) {
  const bancos = agruparIngresosPorBanco(movs);
  const total = bancos.reduce((a, b) => a + Number(b.monto || 0), 0);
  let txt = `🏦 *RESUMEN POR BANCO DEL MES ${escMD(getMonthLabelFromKey(monthKey))}*\n\n`;
  if (!bancos.length) return txt + "⚠️ No hay ingresos registrados en ese mes.";
  txt += `🥇 *BANCO CON MÁS DINERO:* ${escMD(bancos[0].banco)} — ${moneyLps(bancos[0].monto)}\n\n`;
  bancos.forEach((x, i) => { txt += `${i + 1}) *${escMD(x.banco)}* — ${moneyLps(x.monto)}\n`; });
  txt += `\n━━━━━━━━━━━━━━\n💰 *Total ingresos del mes:* ${moneyLps(total)}`;
  return txt;
}
function resumenTopPlataformasTexto(monthKey, movs = []) {
  const plataformas = agruparIngresosPorPlataforma(movs).slice(0, 10);
  let txt = `🏆 *TOP 10 PLATAFORMAS VENDIDAS — ${escMD(getMonthLabelFromKey(monthKey))}*\n\n`;
  if (!plataformas.length) return txt + "⚠️ No hay ingresos con plataforma registrada en ese mes.";
  plataformas.forEach((x, i) => { txt += `${i + 1}) ${escMD(humanCategoriaPlataforma(x.plataforma))} — ${moneyLps(x.monto)}\n`; });
  return txt;
}
function cierreCajaTexto(fechaDMY, movs = []) {
  const { ingresos, egresos, neta } = calcularTotalesMovimientos(movs);
  return `🧾 *CIERRE DE CAJA (${escMD(fechaDMY)})*\n\n💰 Entradas: ${moneyLps(ingresos)}\n💸 Salidas: ${moneyLps(egresos)}\n📦 Caja final: ${neta >= 0 ? "+" : ""}${moneyLps(neta)} ${neta >= 0 ? "🟢" : "🔴"}\n🧮 Movimientos: ${movs.length}`;
}
async function eliminarMovimientoFinanzas(id) {
  const ref = db.collection(FINANZAS_COLLECTION).doc(String(id));
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Movimiento no encontrado");
  const data = doc.data() || {};
  await ref.delete();
  return { id: doc.id, ...data };
}
async function exportarFinanzasRangoExcel(chatId, fechaInicio, fechaFin) {
  try {
    if (!ExcelJS) return bot.sendMessage(chatId, "⚠️ ExcelJS no está instalado en el servidor.");
    if (!isFechaDMY(fechaInicio) || !isFechaDMY(fechaFin)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");
    const ini = startOfDayTS(fechaInicio); const fin = endOfDayTS(fechaFin);
    if (ini > fin) return bot.sendMessage(chatId, "⚠️ El rango es inválido.");
    const snap = await db.collection(FINANZAS_COLLECTION).where("fechaTS", ">=", ini).where("fechaTS", "<=", fin).get();
    const movs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    movs.sort((a, b) => Number(a.fechaTS || 0) - Number(b.fechaTS || 0));
    if (!movs.length) return bot.sendMessage(chatId, "⚠️ No hay movimientos en ese rango.");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Sublicuentas Bot";
    workbook.created = new Date(); workbook.modified = new Date();
    const wsMov = workbook.addWorksheet("Movimientos", { views: [{ state: "frozen", ySplit: 1 }] });
    wsMov.columns = [
      { header: "Fecha", key: "fecha", width: 14 }, { header: "Tipo", key: "tipo", width: 12 }, { header: "Monto", key: "monto", width: 14 },
      { header: "Banco", key: "banco", width: 18 }, { header: "Motivo", key: "motivo", width: 22 }, { header: "Plataforma", key: "plataforma", width: 24 },
      { header: "Detalle", key: "detalle", width: 36 }, { header: "Usuario", key: "usuario", width: 18 }, { header: "Cliente", key: "cliente", width: 22 }, { header: "ID", key: "id", width: 28 },
    ];
    wsMov.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    wsMov.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    wsMov.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
    movs.forEach((m) => {
      const row = wsMov.addRow({ fecha: m.fecha || "", tipo: String(m.tipo || "").toUpperCase(), monto: Number(m.monto || 0), banco: m.banco || "", motivo: m.motivo || "", plataforma: m.plataforma || "", detalle: m.detalle || "", usuario: m.createdByName || m.createdBy || "", cliente: m.cliente || "", id: m.id || "" });
      row.getCell("monto").numFmt = "#,##0.00";
      row.getCell("tipo").font = { bold: true, color: { argb: String(m.tipo || "") === "ingreso" ? "FF008000" : "FFFF0000" } };
    });
    const { ingresos, egresos, neta } = calcularTotalesMovimientos(movs);
    const wsRes = workbook.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 1 }] });
    wsRes.columns = [{ header: "Concepto", key: "concepto", width: 28 }, { header: "Monto", key: "monto", width: 18 }];
    wsRes.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    wsRes.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    wsRes.addRow({ concepto: "Ingresos", monto: ingresos }); wsRes.addRow({ concepto: "Egresos", monto: egresos }); wsRes.addRow({ concepto: "Ganancia neta", monto: neta }); wsRes.getColumn("monto").numFmt = "#,##0.00";
    const wsBancos = workbook.addWorksheet("Bancos", { views: [{ state: "frozen", ySplit: 1 }] });
    wsBancos.columns = [{ header: "Banco", key: "banco", width: 24 }, { header: "Monto", key: "monto", width: 18 }];
    wsBancos.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    wsBancos.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    agruparIngresosPorBanco(movs).forEach((x) => wsBancos.addRow({ banco: x.banco, monto: Number(x.monto || 0) }));
    wsBancos.getColumn("monto").numFmt = "#,##0.00";
    const wsTop = workbook.addWorksheet("Top Plataformas", { views: [{ state: "frozen", ySplit: 1 }] });
    wsTop.columns = [{ header: "Plataforma", key: "plataforma", width: 26 }, { header: "Monto", key: "monto", width: 18 }];
    wsTop.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    wsTop.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    agruparIngresosPorPlataforma(movs).forEach((x) => wsTop.addRow({ plataforma: humanCategoriaPlataforma(x.plataforma), monto: Number(x.monto || 0) }));
    wsTop.getColumn("monto").numFmt = "#,##0.00";
    const wsEgr = workbook.addWorksheet("Egresos por Motivo", { views: [{ state: "frozen", ySplit: 1 }] });
    wsEgr.columns = [{ header: "Motivo", key: "motivo", width: 28 }, { header: "Monto", key: "monto", width: 18 }];
    wsEgr.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    wsEgr.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    agruparEgresosPorMotivo(movs).forEach((x) => wsEgr.addRow({ motivo: x.motivo, monto: Number(x.monto || 0) }));
    wsEgr.getColumn("monto").numFmt = "#,##0.00";
    const buffer = await workbook.xlsx.writeBuffer();
    return bot.sendDocument(chatId, Buffer.from(buffer), {}, { filename: `finanzas_pro_${ymdFromDMY(fechaInicio)}_a_${ymdFromDMY(fechaFin)}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  } catch (e) {
    logErr("exportarFinanzasRangoExcel", e);
    return bot.sendMessage(chatId, "❌ No se pudo exportar el Excel.");
  }
}

module.exports = {
  menuPrincipal, menuPrincipalFromCommand, menuVendedor, menuVendedorFromCommand,
  menuInventario, menuInventarioVideo, menuInventarioMusica, menuInventarioIptv, menuInventarioDisenoIA,
  menuClientes, menuRenovaciones, menuPagos, menuFinanzas, menuFinRegistro, menuFinEliminarTipo,
  menuFinEliminarListado, menuFinReportes, getFinBancos, getFinMotivosEgreso, getFinPlataformasIngreso,
  kbBancosFinanzas, kbMotivosFinanzas, splitPlataformasManual, normalizarCategoriaPlataforma,
  humanCategoriaPlataforma, getCategoriasPlataformasDesdeTexto, registrarIngresoTx, registrarEgresoTx,
  getMovimientosPorFecha, getMovimientosPorMes, getMovimientosRecientesParaEliminar, getMovimientosPorTipo,
  agruparIngresosPorBanco, agruparIngresosPorPlataforma, agruparEgresosPorMotivo, calcularTotalesMovimientos,
  getConceptoMovimientoFin, buildEliminarMovimientoLabel, buildEliminarMovimientoTexto,
  textoConfirmarEliminacionMovimiento, resumenFinanzasTextoPorFecha, resumenBancosMesTexto,
  resumenTopPlataformasTexto, cierreCajaTexto, eliminarMovimientoFinanzas, exportarFinanzasRangoExcel,
};
