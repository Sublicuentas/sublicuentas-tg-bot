/* âœ… SUBLICUENTAS TG BOT â€” PARTE 5/6 CORREGIDA Y ALINEADA CON PARTE 6
   FINANZAS / REPORTES / EXCEL / MENÃšS
   -----------------------------------
   Ajustes aplicados:
   - callback_data corregidos para coincidir con index_06_handlers
   - exports corregidos para coincidir con index_06_handlers
   - menÃº principal, vendedor, inventario, clientes, renovaciones y finanzas completos
   - registrarIngresoTx / registrarEgresoTx agregados
   - getMovimientosPorFecha / getMovimientosPorMes agregados
   - reportes de fecha, bancos, top plataformas y cierre de caja agregados
   - exportarFinanzasRangoExcel agregado
   - eliminarMovimientoFinanzas agregado
*/

const fs = require("fs");

const {
  bot,
  admin,
  db,
  ExcelJS,
  PLATAFORMAS,
  FINANZAS_COLLECTION,
  FIN_BANCOS,
  FIN_MOTIVOS_EGRESO,
} = require("./index_01_core");

const {
  escMD,
  upsertPanel,
  parseFechaFinanceInput,
  parseMontoNumber,
  parseMonthInputToKey,
  getMonthLabelFromKey,
  getMonthKeyFromDMY,
  isFechaDMY,
  hoyDMY,
  moneyLps,
  logErr,
} = require("./index_02_utils_roles");

const { humanPlataforma } = require("./index_03_clientes_crm");

// ===============================
// HELPERS BASE
// ===============================
const PLATFORM_KEYS = Array.isArray(PLATAFORMAS)
  ? PLATAFORMAS
  : Object.keys(PLATAFORMAS || {});

function platMeta(key = "") {
  if (Array.isArray(PLATAFORMAS)) return {};
  return PLATAFORMAS[String(key || "").trim()] || {};
}

function dmyToDate(dmy = "") {
  const s = String(dmy || "").trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
  const [dd, mm, yyyy] = s.split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  if (
    dt.getFullYear() !== yyyy ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd
  ) {
    return null;
  }
  return dt;
}

function dmyToMillis(dmy = "") {
  const dt = dmyToDate(dmy);
  return dt ? dt.getTime() : 0;
}

function dmyToTimestamp(dmy = "") {
  const dt = dmyToDate(dmy);
  return dt ? admin.firestore.Timestamp.fromDate(dt) : null;
}

function monthKeyFromDMYLocal(dmy = "") {
  if (typeof getMonthKeyFromDMY === "function") {
    const v = getMonthKeyFromDMY(dmy);
    if (v) return v;
  }
  const dt = dmyToDate(dmy);
  if (!dt) return "";
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = String(dt.getFullYear());
  return `${mm}/${yyyy}`;
}

function monthLabelFromKeyLocal(key = "") {
  if (typeof getMonthLabelFromKey === "function") {
    const v = getMonthLabelFromKey(key);
    if (v) return v;
  }
  return String(key || "");
}

function parseFechaFlexible(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "hoy") return hoyDMY();
  if (typeof parseFechaFinanceInput === "function") {
    const p = parseFechaFinanceInput(s);
    if (p) return p;
  }
  return isFechaDMY(s) ? s : null;
}

function finTipoLabel(tipo) {
  return String(tipo || "").toLowerCase() === "egreso" ? "Egreso" : "Ingreso";
}

function finConceptoLabel(m = {}) {
  const tipo = String(m.tipo || "").toLowerCase();

  if (tipo === "egreso") {
    return String(m.motivo || m.detalle || m.descripcion || "Egreso").trim();
  }

  return String(
    m.plataforma ||
    m.detalle ||
    m.descripcion ||
    m.cliente ||
    "Ingreso"
  ).trim();
}

function finExtraLabel(m = {}) {
  return String(
    m.banco ||
    m.metodo ||
    m.vendedor ||
    m.cliente ||
    ""
  ).trim();
}

function textoMovimientoParaEliminar(m = {}) {
  const fecha = String(m.fecha || "-").trim();
  const monto = Number(m.monto || 0).toFixed(2);
  const concepto = finConceptoLabel(m);
  const extra = finExtraLabel(m);

  let txt = `${fecha} â€¢ ${monto} Lps â€¢ ${concepto}`;
  if (extra) txt += ` â€¢ ${extra}`;

  if (txt.length > 60) txt = txt.slice(0, 57) + "...";
  return txt;
}

function textoConfirmarEliminacionMovimiento(m = {}) {
  const tipo = finTipoLabel(m.tipo);
  const fecha = String(m.fecha || "-");
  const monto = typeof moneyLps === "function"
    ? moneyLps(m.monto || 0)
    : `${Number(m.monto || 0).toFixed(2)} Lps`;
  const concepto = finConceptoLabel(m);
  const extra = finExtraLabel(m);

  let txt = `ðŸ—‘ï¸ *CONFIRMAR ELIMINACIÃ“N*\n\n`;
  txt += `*Tipo:* ${escMD(tipo)}\n`;
  txt += `*Fecha:* ${escMD(fecha)}\n`;
  txt += `*Monto:* ${escMD(monto)}\n`;
  txt += `*Concepto:* ${escMD(concepto)}\n`;
  if (extra) txt += `*Extra:* ${escMD(extra)}\n`;
  txt += `\nÂ¿Desea eliminar este movimiento?`;

  return txt;
}

function categoryOfPlat(key = "") {
  const k = String(key || "").trim().toLowerCase();
  const meta = platMeta(k);
  const c = String(meta.categoria || "").toLowerCase().trim();

  if (["video", "musica", "iptv", "diseno_ia", "designai", "disenoia"].includes(c)) {
    if (c === "designai" || c === "disenoia") return "diseno_ia";
    return c;
  }

  if ([
    "netflix", "vipnetflix", "disneyp", "disneys", "hbomax", "primevideo",
    "paramount", "crunchyroll", "vix", "appletv", "universal"
  ].includes(k)) return "video";

  if (["spotify", "youtube", "deezer"].includes(k)) return "musica";
  if (["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(k)) return "iptv";
  if (["canva", "gemini", "chatgpt"].includes(k)) return "diseno_ia";

  return "video";
}

function humanPlatSafe(key = "") {
  try {
    return humanPlataforma(key);
  } catch (_) {
    const meta = platMeta(key);
    return meta?.nombre || String(key || "");
  }
}

function kbFromItems(items = []) {
  const rows = [];
  for (const key of items) {
    rows.push([
      {
        text: humanPlatSafe(key),
        callback_data: `inv:${String(key)}:0`,
      },
    ]);
  }
  return rows;
}

// ===============================
// MENÃšS PRINCIPALES
// ===============================
async function menuPrincipal(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ“Œ *MENÃš PRINCIPAL*\n\nSeleccione una opciÃ³n:",
    [
      [{ text: "ðŸ“¦ Inventario", callback_data: "menu:inventario" }],
      [{ text: "ðŸ‘¥ Clientes / CRM", callback_data: "menu:clientes" }],
      [{ text: "ðŸ’° Finanzas", callback_data: "menu:pagos" }],
      [{ text: "ðŸ“Š Reportes", callback_data: "fin:menu:reportes" }],
    ]
  );
}

async function menuVendedor(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ‘¤ *MENÃš VENDEDOR*\n\nSeleccione una opciÃ³n:",
    [
      [{ text: "ðŸ“… Mis renovaciones", callback_data: "ren:mis" }],
      [{ text: "ðŸ“„ TXT Mis renovaciones", callback_data: "txt:mis" }],
      [{ text: "ðŸ‘¥ Mis clientes", callback_data: "vend:clientes" }],
      [{ text: "ðŸ“ TXT Mis clientes", callback_data: "vend:clientes:txt" }],
    ]
  );
}

// ===============================
// MENÃšS INVENTARIO
// ===============================
async function menuInventario(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ“¦ *INVENTARIO*\n\nSeleccione una categorÃ­a:",
    [
      [{ text: "ðŸŽ¬ Video", callback_data: "menu:inventario:video" }],
      [{ text: "ðŸŽµ MÃºsica", callback_data: "menu:inventario:musica" }],
      [{ text: "ðŸ“¡ IPTV", callback_data: "menu:inventario:iptv" }],
      [{ text: "ðŸŽ¨ DiseÃ±o e IA", callback_data: "menu:inventario:designai" }],
      [{ text: "ðŸ“Š Stock general", callback_data: "inv:general" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function menuInventarioVideo(chatId) {
  const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "video");
  const kb = kbFromItems(items);
  kb.push([{ text: "â¬…ï¸ Volver Inventario", callback_data: "menu:inventario" }]);
  kb.push([{ text: "ðŸ  Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, "ðŸŽ¬ *INVENTARIO VIDEO*\n\nSeleccione plataforma:", kb);
}

async function menuInventarioMusica(chatId) {
  const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "musica");
  const kb = kbFromItems(items);
  kb.push([{ text: "â¬…ï¸ Volver Inventario", callback_data: "menu:inventario" }]);
  kb.push([{ text: "ðŸ  Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, "ðŸŽµ *INVENTARIO MÃšSICA*\n\nSeleccione plataforma:", kb);
}

async function menuInventarioIptv(chatId) {
  const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "iptv");
  const kb = kbFromItems(items);
  kb.push([{ text: "â¬…ï¸ Volver Inventario", callback_data: "menu:inventario" }]);
  kb.push([{ text: "ðŸ  Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, "ðŸ“¡ *INVENTARIO IPTV*\n\nSeleccione plataforma:", kb);
}

async function menuInventarioDisenoIA(chatId) {
  const items = PLATFORM_KEYS.filter((x) => categoryOfPlat(x) === "diseno_ia");
  const kb = kbFromItems(items);
  kb.push([{ text: "â¬…ï¸ Volver Inventario", callback_data: "menu:inventario" }]);
  kb.push([{ text: "ðŸ  Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, "ðŸŽ¨ *INVENTARIO DISEÃ‘O E IA*\n\nSeleccione plataforma:", kb);
}

// ===============================
// MENÃšS CLIENTES / CRM
// ===============================
async function menuClientes(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ‘¥ *CLIENTES / CRM*\n\nSeleccione una opciÃ³n:",
    [
      [{ text: "âž• Nuevo cliente", callback_data: "cli:wiz:start" }],
      [{ text: "ðŸ”Ž Buscar cliente", callback_data: "menu:buscar" }],
      [{ text: "ðŸ“„ TXT clientes general", callback_data: "cli:txt:general" }],
      [{ text: "ðŸ—‚ï¸ TXT por vendedor", callback_data: "cli:txt:vendedores_split" }],
      [{ text: "ðŸ‘¤ Revendedores", callback_data: "rev:lista" }],
      [{ text: "ðŸ“… Renovaciones", callback_data: "menu:renovaciones" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

// ===============================
// MENÃšS RENOVACIONES
// ===============================
async function menuRenovaciones(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ“… *RENOVACIONES*\n\nSeleccione una opciÃ³n:",
    [
      [{ text: "ðŸ“… Ver renovaciones de hoy", callback_data: "ren:hoy" }],
      [{ text: "ðŸ“„ TXT renovaciones de hoy", callback_data: "txt:hoy" }],
      [{ text: "ðŸ“¤ Enviar TXT a todos hoy", callback_data: "txt:todos:hoy" }],
      [{ text: "â¬…ï¸ Volver CRM", callback_data: "menu:clientes" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

// ===============================
// MENÃšS FINANZAS
// ===============================
async function menuPagos(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ’° *FINANZAS*\n\nSeleccione una opciÃ³n:",
    [
      [{ text: "âž• Registrar ingreso", callback_data: "fin:menu:ingreso" }],
      [{ text: "âž– Registrar egreso", callback_data: "fin:menu:egreso" }],
      [{ text: "ðŸ“’ Registro", callback_data: "fin:menu:registro" }],
      [{ text: "ðŸ—‘ï¸ Eliminar movimiento", callback_data: "fin:menu:eliminar" }],
      [{ text: "ðŸ“Š Reportes", callback_data: "fin:menu:reportes" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function menuFinRegistro(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ“’ *REGISTRO DE FINANZAS*\n\nSeleccione una opciÃ³n:",
    [
      [{ text: "âž• Registrar ingreso", callback_data: "fin:menu:ingreso" }],
      [{ text: "âž– Registrar egreso", callback_data: "fin:menu:egreso" }],
      [{ text: "ðŸ—‘ï¸ Eliminar movimiento", callback_data: "fin:menu:eliminar" }],
      [{ text: "ðŸ“Š Reportes", callback_data: "fin:menu:reportes" }],
      [{ text: "ðŸ§¾ Cierre de caja", callback_data: "fin:menu:cierre" }],
      [{ text: "â¬…ï¸ Volver Finanzas", callback_data: "menu:pagos" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function menuFinEliminarTipo(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ—‘ï¸ *ELIMINAR MOVIMIENTO POR FECHA*\n\nSeleccione quÃ© desea buscar.\nLuego escribirÃ¡ una *fecha exacta* en formato *dd/mm/yyyy*.",
    [
      [{ text: "âž• Buscar ingresos", callback_data: "fin:menu:eliminar:ingreso" }],
      [{ text: "âž– Buscar egresos", callback_data: "fin:menu:eliminar:egreso" }],
      [{ text: "â¬…ï¸ Volver Finanzas", callback_data: "menu:pagos" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function menuFinReportes(chatId) {
  return upsertPanel(
    chatId,
    "ðŸ“Š *REPORTES DE FINANZAS*\n\nSeleccione una opciÃ³n:",
    [
      [{ text: "ðŸ“… Resumen por fecha", callback_data: "fin:menu:resumen_fecha" }],
      [{ text: "ðŸ¦ Resumen por banco del mes", callback_data: "fin:menu:bancos_mes" }],
      [{ text: "ðŸ† Top plataformas del mes", callback_data: "fin:menu:top_plataformas" }],
      [{ text: "ðŸ“¤ Exportar Excel por rango", callback_data: "fin:menu:excel_rango" }],
      [{ text: "â¬…ï¸ Volver Finanzas", callback_data: "menu:pagos" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

// ===============================
// KEYBOARDS FINANZAS
// ===============================
function kbBancosFinanzas() {
  const rows = (Array.isArray(FIN_BANCOS) ? FIN_BANCOS : []).map((b) => [
    {
      text: String(b),
      callback_data: `fin:ing:banco:${encodeURIComponent(String(b))}`,
    },
  ]);

  rows.push([{ text: "ðŸ  Inicio", callback_data: "go:inicio" }]);

  return { inline_keyboard: rows };
}

function kbMotivosFinanzas() {
  const rows = (Array.isArray(FIN_MOTIVOS_EGRESO) ? FIN_MOTIVOS_EGRESO : []).map((m) => [
    {
      text: String(m),
      callback_data: `fin:egr:motivo:${encodeURIComponent(String(m))}`,
    },
  ]);

  rows.push([{ text: "ðŸ  Inicio", callback_data: "go:inicio" }]);

  return { inline_keyboard: rows };
}

// ===============================
// CRUD FINANZAS
// ===============================
async function registrarIngresoTx({
  monto,
  banco = "",
  plataforma = "",
  detalle = "",
  fecha = "",
  userId = "",
  userName = "",
}) {
  const fechaOk = parseFechaFlexible(fecha || hoyDMY());
  if (!fechaOk) throw new Error("Fecha invÃ¡lida");

  const montoOk = Number(monto || 0);
  if (!Number.isFinite(montoOk) || montoOk <= 0) {
    throw new Error("Monto invÃ¡lido");
  }

  const mesKey = monthKeyFromDMYLocal(fechaOk);
  const ref = db.collection(FINANZAS_COLLECTION).doc();

  const payload = {
    tipo: "ingreso",
    monto: montoOk,
    banco: String(banco || "").trim(),
    plataforma: String(plataforma || "").trim(),
    detalle: String(detalle || "").trim(),
    fecha: fechaOk,
    fechaTS: dmyToTimestamp(fechaOk),
    mesKey,
    monthKey: mesKey,
    userId: String(userId || ""),
    userName: String(userName || ""),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await ref.set(payload);

  return {
    id: ref.id,
    ...payload,
  };
}

async function registrarEgresoTx({
  monto,
  motivo = "",
  detalle = "",
  fecha = "",
  userId = "",
  userName = "",
}) {
  const fechaOk = parseFechaFlexible(fecha || hoyDMY());
  if (!fechaOk) throw new Error("Fecha invÃ¡lida");

  const montoOk = Number(monto || 0);
  if (!Number.isFinite(montoOk) || montoOk <= 0) {
    throw new Error("Monto invÃ¡lido");
  }

  const mesKey = monthKeyFromDMYLocal(fechaOk);
  const ref = db.collection(FINANZAS_COLLECTION).doc();

  const payload = {
    tipo: "egreso",
    monto: montoOk,
    motivo: String(motivo || "").trim(),
    detalle: String(detalle || "").trim(),
    fecha: fechaOk,
    fechaTS: dmyToTimestamp(fechaOk),
    mesKey,
    monthKey: mesKey,
    userId: String(userId || ""),
    userName: String(userName || ""),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await ref.set(payload);

  return {
    id: ref.id,
    ...payload,
  };
}

async function getMovimientoFinanzaById(id) {
  const ref = db.collection(FINANZAS_COLLECTION).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

async function getMovimientosPorFecha(fechaDMY, _userId = null, _isSuper = false) {
  const fecha = String(fechaDMY || "").trim();
  if (!fecha) return [];

  let rows = [];

  try {
    const snap = await db
      .collection(FINANZAS_COLLECTION)
      .where("fecha", "==", fecha)
      .get();

    rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (e) {
    logErr("getMovimientosPorFecha", e);
  }

  return rows.sort((a, b) => {
    const ta = dmyToMillis(a.fecha || "");
    const tb = dmyToMillis(b.fecha || "");
    return tb - ta;
  });
}

async function getMovimientosPorMes(monthKey, _userId = null, _isSuper = false) {
  const key = String(monthKey || "").trim();
  if (!key) return [];

  let rows = [];

  try {
    let snap = await db
      .collection(FINANZAS_COLLECTION)
      .where("mesKey", "==", key)
      .get();

    rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    if (!rows.length) {
      snap = await db
        .collection(FINANZAS_COLLECTION)
        .where("monthKey", "==", key)
        .get();

      rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    }
  } catch (e) {
    logErr("getMovimientosPorMes", e);
  }

  return rows.sort((a, b) => {
    const ta = dmyToMillis(a.fecha || "");
    const tb = dmyToMillis(b.fecha || "");
    return tb - ta;
  });
}

async function eliminarMovimientoFinanzas(id, _userId = null, _isSuper = false) {
  const mov = await getMovimientoFinanzaById(id);
  if (!mov) throw new Error("Movimiento no encontrado.");

  await db.collection(FINANZAS_COLLECTION).doc(String(id)).delete();
  return mov;
}

// ===============================
// RESÃšMENES
// ===============================
function resumenFinanzasTextoPorFecha(fecha, list = []) {
  const rows = Array.isArray(list) ? list : [];

  let ingresos = 0;
  let egresos = 0;

  for (const r of rows) {
    const monto = Number(r.monto || 0);
    if (String(r.tipo || "").toLowerCase() === "egreso") egresos += monto;
    else ingresos += monto;
  }

  const utilidad = ingresos - egresos;

  let txt = `ðŸ“… *RESUMEN DEL ${escMD(fecha)}*\n\n`;
  txt += `*Ingresos:* ${escMD(moneyLps(ingresos))}\n`;
  txt += `*Egresos:* ${escMD(moneyLps(egresos))}\n`;
  txt += `*Utilidad:* ${escMD(moneyLps(utilidad))}\n`;
  txt += `*Movimientos:* ${escMD(String(rows.length))}\n`;

  if (rows.length) {
    txt += `\n*Detalle:*\n`;
    txt += rows
      .slice(0, 20)
      .map((r, i) => {
        const tipo = String(r.tipo || "").toLowerCase() === "egreso" ? "âž–" : "âž•";
        return `${i + 1}. ${tipo} ${escMD(textoMovimientoParaEliminar(r))}`;
      })
      .join("\n");
  }

  return txt;
}

function resumenBancosMesTexto(monthKey, list = []) {
  const rows = Array.isArray(list) ? list : [];
  const label = monthLabelFromKeyLocal(monthKey);
  const map = {};

  for (const r of rows) {
    const banco = String(r.banco || "Sin banco").trim();
    const monto = Number(r.monto || 0);
    if (!map[banco]) map[banco] = { ingresos: 0, egresos: 0, neto: 0 };

    if (String(r.tipo || "").toLowerCase() === "egreso") {
      map[banco].egresos += monto;
      map[banco].neto -= monto;
    } else {
      map[banco].ingresos += monto;
      map[banco].neto += monto;
    }
  }

  const items = Object.entries(map).sort((a, b) => b[1].neto - a[1].neto);

  let txt = `ðŸ¦ *RESUMEN POR BANCO â€” ${escMD(label)}*\n\n`;

  if (!items.length) {
    txt += "_No hay movimientos para este mes._";
    return txt;
  }

  txt += items
    .map(([bank, v], i) => {
      return (
        `${i + 1}. *${escMD(bank)}*\n` +
        `   Ingresos: ${escMD(moneyLps(v.ingresos))}\n` +
        `   Egresos: ${escMD(moneyLps(v.egresos))}\n` +
        `   Neto: ${escMD(moneyLps(v.neto))}`
      );
    })
    .join("\n\n");

  return txt;
}

function resumenTopPlataformasTexto(monthKey, list = []) {
  const rows = Array.isArray(list) ? list : [];
  const label = monthLabelFromKeyLocal(monthKey);
  const map = {};

  for (const r of rows) {
    if (String(r.tipo || "").toLowerCase() === "egreso") continue;
    const key = String(r.plataforma || "otros").trim().toLowerCase() || "otros";
    map[key] = (map[key] || 0) + Number(r.monto || 0);
  }

  const items = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  let txt = `ðŸ† *TOP PLATAFORMAS â€” ${escMD(label)}*\n\n`;

  if (!items.length) {
    txt += "_No hay ingresos para este mes._";
    return txt;
  }

  txt += items
    .map(([plat, total], i) => `${i + 1}. ${escMD(humanPlatSafe(plat))} â€” ${escMD(moneyLps(total))}`)
    .join("\n");

  return txt;
}

function cierreCajaTexto(fecha, list = []) {
  const rows = Array.isArray(list) ? list : [];
  let ingresos = 0;
  let egresos = 0;

  for (const r of rows) {
    const monto = Number(r.monto || 0);
    if (String(r.tipo || "").toLowerCase() === "egreso") egresos += monto;
    else ingresos += monto;
  }

  const saldo = ingresos - egresos;

  let txt = `ðŸ§¾ *CIERRE DE CAJA â€” ${escMD(fecha)}*\n\n`;
  txt += `*Ingresos:* ${escMD(moneyLps(ingresos))}\n`;
  txt += `*Egresos:* ${escMD(moneyLps(egresos))}\n`;
  txt += `*Saldo:* ${escMD(moneyLps(saldo))}\n`;
  txt += `*Movimientos:* ${escMD(String(rows.length))}\n`;

  return txt;
}

// ===============================
// EXCEL
// ===============================
async function exportarFinanzasRangoExcel(
  chatId,
  fechaInicio,
  fechaFin,
  userId = null,
  isSuper = false
) {
  const ini = parseFechaFlexible(fechaInicio);
  const fin = parseFechaFlexible(fechaFin);

  if (!ini || !fin) {
    throw new Error("Fechas invÃ¡lidas.");
  }

  const tsIni = dmyToMillis(ini);
  const tsFin = dmyToMillis(fin);

  if (tsIni > tsFin) {
    throw new Error("La fecha inicial no puede ser mayor a la final.");
  }

  const snap = await db.collection(FINANZAS_COLLECTION).get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((r) => {
      const ts = dmyToMillis(r.fecha || "");
      return ts >= tsIni && ts <= tsFin;
    })
    .sort((a, b) => dmyToMillis(a.fecha || "") - dmyToMillis(b.fecha || ""));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Finanzas");

  ws.columns = [
    { header: "Fecha", key: "fecha", width: 15 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Monto", key: "monto", width: 15 },
    { header: "Plataforma/Motivo", key: "concepto", width: 30 },
    { header: "Banco/MÃ©todo", key: "extra", width: 22 },
    { header: "Detalle", key: "detalle", width: 35 },
    { header: "ID", key: "id", width: 28 },
  ];

  for (const r of rows) {
    ws.addRow({
      fecha: r.fecha || "",
      tipo: finTipoLabel(r.tipo),
      monto: Number(r.monto || 0),
      concepto: finConceptoLabel(r),
      extra: finExtraLabel(r),
      detalle: r.detalle || r.descripcion || "",
      id: r.id,
    });
  }

  ws.getRow(1).font = { bold: true };

  const resumen = wb.addWorksheet("Resumen");
  resumen.columns = [
    { header: "Concepto", key: "concepto", width: 25 },
    { header: "Valor", key: "valor", width: 25 },
  ];

  let ingresos = 0;
  let egresos = 0;
  for (const r of rows) {
    const monto = Number(r.monto || 0);
    if (String(r.tipo || "").toLowerCase() === "egreso") egresos += monto;
    else ingresos += monto;
  }

  resumen.addRow({ concepto: "Fecha inicio", valor: ini });
  resumen.addRow({ concepto: "Fecha fin", valor: fin });
  resumen.addRow({ concepto: "Ingresos", valor: Number(ingresos || 0) });
  resumen.addRow({ concepto: "Egresos", valor: Number(egresos || 0) });
  resumen.addRow({ concepto: "Utilidad", valor: Number(ingresos - egresos) });
  resumen.addRow({ concepto: "Movimientos", valor: Number(rows.length || 0) });
  resumen.getRow(1).font = { bold: true };

  const tempPath = `/tmp/finanzas_${Date.now()}.xlsx`;
  await wb.xlsx.writeFile(tempPath);

  await bot.sendDocument(chatId, tempPath, {
    caption: `ðŸ“Š Finanzas del ${ini} al ${fin}`,
  });

  try {
    fs.unlinkSync(tempPath);
  } catch (_) {}

  return true;
}

// ===============================
// HELPERS VIEJOS / COMPAT
// ===============================
async function listarMovimientosPorFechaYTipo(fechaDMY, tipo) {
  const rows = await getMovimientosPorFecha(fechaDMY);
  return rows
    .filter((x) => String(x.tipo || "").toLowerCase() === String(tipo || "").toLowerCase())
    .sort((a, b) => dmyToMillis(b.fecha || "") - dmyToMillis(a.fecha || ""));
}

async function menuFinanzas(chatId) {
  return menuPagos(chatId);
}

async function menuRegistroFinanzas(chatId) {
  return menuFinRegistro(chatId);
}

async function menuEliminarMovimientoEspecifico(chatId) {
  return menuFinEliminarTipo(chatId);
}

async function pedirFechaEliminarMovimiento(chatId, tipo) {
  const titulo = String(tipo || "").toLowerCase() === "egreso" ? "EGRESO" : "INGRESO";

  return upsertPanel(
    chatId,
    `ðŸ—‘ï¸ *ELIMINAR ${titulo} POR FECHA*\n\nEnvÃ­e la fecha exacta en formato *dd/mm/yyyy*.\n\nEjemplo: *22/03/2026*`,
    [
      [{ text: "â¬…ï¸ Volver eliminar", callback_data: "fin:menu:eliminar" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function listarMovimientosParaEliminarPorFecha(chatId, tipo, fechaDMY) {
  const rows = await listarMovimientosPorFechaYTipo(fechaDMY, tipo);

  if (!rows.length) {
    return upsertPanel(
      chatId,
      `âš ï¸ No encontrÃ© *${tipo === "egreso" ? "egresos" : "ingresos"}* en la fecha *${fechaDMY}*.`,
      [
        [{
          text: tipo === "egreso" ? "âž– Buscar otra fecha" : "âž• Buscar otra fecha",
          callback_data: tipo === "egreso" ? "fin:menu:eliminar:egreso" : "fin:menu:eliminar:ingreso",
        }],
        [{ text: "â¬…ï¸ Volver eliminar", callback_data: "fin:menu:eliminar" }],
        [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
      ]
    );
  }

  const keyboard = [];
  for (const r of rows) {
    keyboard.push([
      {
        text: textoMovimientoParaEliminar(r),
        callback_data: `fin:del:pick:${r.id}`,
      },
    ]);
  }

  keyboard.push([
    {
      text: tipo === "egreso" ? "âž– Buscar otra fecha" : "âž• Buscar otra fecha",
      callback_data: tipo === "egreso" ? "fin:menu:eliminar:egreso" : "fin:menu:eliminar:ingreso",
    },
  ]);
  keyboard.push([{ text: "â¬…ï¸ Volver eliminar", callback_data: "fin:menu:eliminar" }]);
  keyboard.push([{ text: "ðŸ  Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(
    chatId,
    `ðŸ—‘ï¸ *${tipo === "egreso" ? "EGRESOS" : "INGRESOS"} DEL ${fechaDMY}*\n\nSeleccione el movimiento exacto que desea borrar:`,
    keyboard
  );
}

async function confirmarEliminarMovimiento(chatId, movId) {
  const mov = await getMovimientoFinanzaById(movId);

  if (!mov) {
    return upsertPanel(
      chatId,
      "âš ï¸ Ese movimiento ya no existe o fue eliminado.",
      [
        [{ text: "â¬…ï¸ Volver eliminar", callback_data: "fin:menu:eliminar" }],
        [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
      ]
    );
  }

  return upsertPanel(
    chatId,
    textoConfirmarEliminacionMovimiento(mov),
    [
      [{ text: "âœ… SÃ­, eliminar", callback_data: `fin:del:ok:${mov.id}` }],
      [{ text: "âŒ Cancelar", callback_data: "fin:menu:eliminar" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function eliminarMovimientoDefinitivo(chatId, movId, userId = null) {
  const mov = await eliminarMovimientoFinanzas(movId, userId, true);

  let txt = `âœ… *MOVIMIENTO ELIMINADO*\n\n`;
  txt += `*Tipo:* ${escMD(finTipoLabel(mov.tipo))}\n`;
  txt += `*Fecha:* ${escMD(String(mov.fecha || "-"))}\n`;
  txt += `*Monto:* ${escMD(moneyLps(mov.monto || 0))}\n`;
  txt += `*Concepto:* ${escMD(finConceptoLabel(mov))}\n`;

  if (userId) {
    txt += `*Eliminado por:* \`${String(userId)}\`\n`;
  }

  return upsertPanel(
    chatId,
    txt,
    [
      [{ text: "ðŸ—‘ï¸ Eliminar otro", callback_data: "fin:menu:eliminar" }],
      [{ text: "ðŸ“’ Volver Registro", callback_data: "fin:menu:registro" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function listarIngresosHoy(chatId) {
  const hoy = hoyDMY();
  const rows = await listarMovimientosPorFechaYTipo(hoy, "ingreso");

  if (!rows.length) {
    return upsertPanel(
      chatId,
      `ðŸ“’ *INGRESOS DE HOY (${hoy})*\n\nNo hay ingresos registrados hoy.`,
      [
        [{ text: "â¬…ï¸ Volver Registro", callback_data: "fin:menu:registro" }],
        [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
      ]
    );
  }

  const lines = rows.slice(0, 30).map((r, i) => {
    return `${i + 1}. ${textoMovimientoParaEliminar(r)}`;
  });

  return upsertPanel(
    chatId,
    `ðŸ“’ *INGRESOS DE HOY (${hoy})*\n\n${escMD(lines.join("\n"))}`,
    [
      [{ text: "â¬…ï¸ Volver Registro", callback_data: "fin:menu:registro" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function listarEgresosHoy(chatId) {
  const hoy = hoyDMY();
  const rows = await listarMovimientosPorFechaYTipo(hoy, "egreso");

  if (!rows.length) {
    return upsertPanel(
      chatId,
      `ðŸ“’ *EGRESOS DE HOY (${hoy})*\n\nNo hay egresos registrados hoy.`,
      [
        [{ text: "â¬…ï¸ Volver Registro", callback_data: "fin:menu:registro" }],
        [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
      ]
    );
  }

  const lines = rows.slice(0, 30).map((r, i) => {
    return `${i + 1}. ${textoMovimientoParaEliminar(r)}`;
  });

  return upsertPanel(
    chatId,
    `ðŸ“’ *EGRESOS DE HOY (${hoy})*\n\n${escMD(lines.join("\n"))}`,
    [
      [{ text: "â¬…ï¸ Volver Registro", callback_data: "fin:menu:registro" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function menuReportesFinanzas(chatId) {
  return menuFinReportes(chatId);
}

async function resumenFinancieroPorMonthKey(monthKey) {
  const rows = await getMovimientosPorMes(monthKey);

  let ingresos = 0;
  let egresos = 0;
  const top = {};

  for (const r of rows) {
    const monto = Number(r.monto || 0);

    if (String(r.tipo || "").toLowerCase() === "egreso") {
      egresos += monto;
    } else {
      ingresos += monto;
      const key = String(r.plataforma || "otros").trim().toLowerCase();
      top[key] = (top[key] || 0) + monto;
    }
  }

  const utilidad = ingresos - egresos;

  const topOrdenado = Object.entries(top)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([plat, total]) => ({
      plataforma: plat,
      total,
    }));

  return {
    ingresos,
    egresos,
    utilidad,
    totalMovimientos: rows.length,
    topOrdenado,
    rows,
  };
}

async function enviarReporteMesActual(chatId) {
  const monthKey = monthKeyFromDMYLocal(hoyDMY());
  const label = monthLabelFromKeyLocal(monthKey);
  const res = await resumenFinancieroPorMonthKey(monthKey);

  let txt = `ðŸ“Š *REPORTE ${escMD(label)}*\n\n`;
  txt += `*Ingresos:* ${escMD(moneyLps(res.ingresos || 0))}\n`;
  txt += `*Egresos:* ${escMD(moneyLps(res.egresos || 0))}\n`;
  txt += `*Utilidad:* ${escMD(moneyLps(res.utilidad || 0))}\n`;
  txt += `*Movimientos:* ${escMD(String(res.totalMovimientos || 0))}\n`;

  if (res.topOrdenado.length) {
    txt += `\n*Top plataformas vendidas:*\n`;
    txt += res.topOrdenado
      .map((x, i) => `${i + 1}. ${escMD(humanPlatSafe(x.plataforma))} â€” ${escMD(moneyLps(x.total || 0))}`)
      .join("\n");
  }

  return upsertPanel(
    chatId,
    txt,
    [
      [{ text: "ðŸ§¾ Exportar Excel mensual", callback_data: "fin:menu:excel_rango" }],
      [{ text: "â¬…ï¸ Volver Reportes", callback_data: "fin:menu:reportes" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

async function exportarExcelMesActual(chatId) {
  const monthKey = monthKeyFromDMYLocal(hoyDMY());
  const label = monthLabelFromKeyLocal(monthKey);
  const res = await resumenFinancieroPorMonthKey(monthKey);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Finanzas");

  ws.columns = [
    { header: "Fecha", key: "fecha", width: 15 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Monto", key: "monto", width: 15 },
    { header: "Plataforma/Motivo", key: "concepto", width: 28 },
    { header: "Banco/MÃ©todo", key: "extra", width: 22 },
    { header: "Detalle", key: "detalle", width: 35 },
  ];

  for (const r of res.rows) {
    ws.addRow({
      fecha: r.fecha || "",
      tipo: finTipoLabel(r.tipo),
      monto: Number(r.monto || 0),
      concepto: finConceptoLabel(r),
      extra: finExtraLabel(r),
      detalle: r.detalle || r.descripcion || "",
    });
  }

  ws.getRow(1).font = { bold: true };

  const resumen = wb.addWorksheet("Resumen");
  resumen.columns = [
    { header: "Concepto", key: "concepto", width: 25 },
    { header: "Valor", key: "valor", width: 25 },
  ];

  resumen.addRow({ concepto: "Mes", valor: label });
  resumen.addRow({ concepto: "Ingresos", valor: Number(res.ingresos || 0) });
  resumen.addRow({ concepto: "Egresos", valor: Number(res.egresos || 0) });
  resumen.addRow({ concepto: "Utilidad", valor: Number(res.utilidad || 0) });
  resumen.addRow({ concepto: "Movimientos", valor: Number(res.totalMovimientos || 0) });

  const tempPath = `/tmp/finanzas_${monthKey.replace(/[^\w]/g, "_")}.xlsx`;
  await wb.xlsx.writeFile(tempPath);

  await bot.sendDocument(chatId, tempPath, {
    caption: `ðŸ“Š Reporte Excel de ${label}`,
  });

  try {
    fs.unlinkSync(tempPath);
  } catch (_) {}

  return upsertPanel(
    chatId,
    `âœ… *Excel generado correctamente* para *${escMD(label)}*.`,
    [
      [{ text: "â¬…ï¸ Volver Reportes", callback_data: "fin:menu:reportes" }],
      [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
    ]
  );
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  // menÃºs principales
  menuPrincipal,
  menuVendedor,

  // inventario
  menuInventario,
  menuInventarioVideo,
  menuInventarioMusica,
  menuInventarioIptv,
  menuInventarioDisenoIA,

  // clientes / crm
  menuClientes,
  menuRenovaciones,

  // finanzas
  menuPagos,
  menuFinRegistro,
  menuFinEliminarTipo,
  menuFinReportes,
  kbBancosFinanzas,
  kbMotivosFinanzas,
  registrarIngresoTx,
  registrarEgresoTx,
  getMovimientosPorFecha,
  getMovimientosPorMes,
  resumenFinanzasTextoPorFecha,
  resumenBancosMesTexto,
  resumenTopPlataformasTexto,
  cierreCajaTexto,
  textoConfirmarEliminacionMovimiento,
  exportarFinanzasRangoExcel,
  eliminarMovimientoFinanzas,

  // compatibilidad con tu versiÃ³n vieja
  menuFinanzas,
  menuRegistroFinanzas,
  menuEliminarMovimientoEspecifico,
  pedirFechaEliminarMovimiento,
  listarMovimientosParaEliminarPorFecha,
  confirmarEliminarMovimiento,
  eliminarMovimientoDefinitivo,
  listarIngresosHoy,
  listarEgresosHoy,
  menuReportesFinanzas,
  enviarReporteMesActual,
  exportarExcelMesActual,
  resumenFinancieroPorMonthKey,
  listarMovimientosPorFechaYTipo,
  getMovimientoFinanzaById,
  textoMovimientoParaEliminar,
};
