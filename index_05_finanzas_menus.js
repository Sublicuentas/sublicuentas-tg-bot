/* ✅ SUBLICUENTAS TG BOT — PARTE 5/6
   FINANZAS / REPORTES / EXCEL / MENÚS
   -----------------------------------
   ✅ CORREGIDO: ELIMINAR MOVIMIENTO POR FECHA
*/

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
  sendCommandAnchoredPanel,
  parseFechaFinanceInput,
  parseMontoNumber,
  parseMonthInputToKey,
  getMonthLabelFromKey,
  getMonthKeyFromDMY,
  startOfDayTS,
  endOfDayTS,
  ymdFromDMY,
  isFechaDMY,
  hoyDMY,
  moneyLps,
  moneyNumber,
  logErr,
  isSuperAdmin,
} = require("./index_02_utils_roles");

const { humanPlataforma } = require("./index_03_clientes_crm");

// ===============================
// HELPERS FINANZAS
// ===============================
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

  let txt = `${fecha} • ${monto} Lps • ${concepto}`;
  if (extra) txt += ` • ${extra}`;

  if (txt.length > 60) txt = txt.slice(0, 57) + "...";
  return txt;
}

async function getMovimientoFinanzaById(id) {
  const ref = db.collection(FINANZAS_COLLECTION).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

async function listarMovimientosPorFechaYTipo(fechaDMY, tipo) {
  const snap = await db
    .collection(FINANZAS_COLLECTION)
    .where("fecha", "==", fechaDMY)
    .get();

  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((x) => String(x.tipo || "").toLowerCase() === String(tipo || "").toLowerCase())
    .sort((a, b) => {
      const ta = a.fechaTS?.toMillis ? a.fechaTS.toMillis() : 0;
      const tb = b.fechaTS?.toMillis ? b.fechaTS.toMillis() : 0;
      return tb - ta;
    });

  return rows;
}

// ===============================
// MENÚS PRINCIPALES
// ===============================
async function menuPrincipal(chatId) {
  return upsertPanel(
    chatId,
    "📌 *MENÚ PRINCIPAL*\n\nSeleccione una opción:",
    [
      [{ text: "📦 Inventario", callback_data: "menu_inventario" }],
      [{ text: "👥 Clientes / CRM", callback_data: "menu_clientes" }],
      [{ text: "💰 Finanzas", callback_data: "fin_menu" }],
      [{ text: "📊 Reportes", callback_data: "fin_reportes_menu" }],
    ]
  );
}

async function menuFinanzas(chatId) {
  return upsertPanel(
    chatId,
    "💰 *FINANZAS*\n\nSeleccione una opción:",
    [
      [{ text: "➕ Registrar ingreso", callback_data: "fin_reg_ingreso" }],
      [{ text: "➖ Registrar egreso", callback_data: "fin_reg_egreso" }],
      [{ text: "🗑️ Eliminar movimiento", callback_data: "menu_fin_eliminar_mov" }],
      [{ text: "📒 Ver registro", callback_data: "fin_registro_menu" }],
      [{ text: "📊 Reportes", callback_data: "fin_reportes_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

async function menuRegistroFinanzas(chatId) {
  return upsertPanel(
    chatId,
    "📒 *REGISTRO DE FINANZAS*\n\nSeleccione una opción:",
    [
      [{ text: "➕ Ver ingresos", callback_data: "fin_ver_ingresos_hoy" }],
      [{ text: "➖ Ver egresos", callback_data: "fin_ver_egresos_hoy" }],
      [{ text: "🗑️ Eliminar movimiento específico", callback_data: "menu_fin_eliminar_mov" }],
      [{ text: "⬅️ Volver Finanzas", callback_data: "fin_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

// ===============================
// MENÚ ELIMINAR MOVIMIENTO
// ===============================
async function menuEliminarMovimientoEspecifico(chatId) {
  return upsertPanel(
    chatId,
    "🗑️ *ELIMINAR MOVIMIENTO ESPECÍFICO*\n\nSeleccione qué desea buscar para eliminar.\nLuego escribirá una *fecha exacta* en formato *DD/MM/YYYY* y solo verá los registros de ese día para borrar uno exacto.",
    [
      [{ text: "➕ Ver ingresos", callback_data: "fin_del_ingresos_fecha" }],
      [{ text: "➖ Ver egresos", callback_data: "fin_del_egresos_fecha" }],
      [{ text: "⬅️ Volver Registro", callback_data: "fin_registro_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

async function pedirFechaEliminarMovimiento(chatId, tipo) {
  const titulo = String(tipo || "").toLowerCase() === "egreso" ? "EGRESO" : "INGRESO";

  return upsertPanel(
    chatId,
    `🗑️ *ELIMINAR ${titulo} POR FECHA*\n\nEnvíe la fecha exacta en formato *DD/MM/YYYY*.\n\nEjemplo: *22/03/2026*`,
    [
      [{ text: "⬅️ Volver eliminar", callback_data: "menu_fin_eliminar_mov" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

async function listarMovimientosParaEliminarPorFecha(chatId, tipo, fechaDMY) {
  const rows = await listarMovimientosPorFechaYTipo(fechaDMY, tipo);

  if (!rows.length) {
    return upsertPanel(
      chatId,
      `⚠️ No encontré *${tipo === "egreso" ? "egresos" : "ingresos"}* en la fecha *${fechaDMY}*.`,
      [
        [{
          text: tipo === "egreso" ? "➖ Buscar otra fecha" : "➕ Buscar otra fecha",
          callback_data: tipo === "egreso" ? "fin_del_egresos_fecha" : "fin_del_ingresos_fecha",
        }],
        [{ text: "⬅️ Volver eliminar", callback_data: "menu_fin_eliminar_mov" }],
        [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
      ]
    );
  }

  const keyboard = [];

  for (const r of rows) {
    keyboard.push([
      {
        text: textoMovimientoParaEliminar(r),
        callback_data: `fin_del_mov_${r.id}`,
      },
    ]);
  }

  keyboard.push([
    {
      text: tipo === "egreso" ? "➖ Buscar otra fecha" : "➕ Buscar otra fecha",
      callback_data: tipo === "egreso" ? "fin_del_egresos_fecha" : "fin_del_ingresos_fecha",
    },
  ]);

  keyboard.push([{ text: "⬅️ Volver eliminar", callback_data: "menu_fin_eliminar_mov" }]);
  keyboard.push([{ text: "🏠 Inicio", callback_data: "menu_principal" }]);

  return upsertPanel(
    chatId,
    `🗑️ *${tipo === "egreso" ? "EGRESOS" : "INGRESOS"} DEL ${fechaDMY}*\n\nSeleccione el movimiento exacto que desea borrar:`,
    keyboard
  );
}

async function confirmarEliminarMovimiento(chatId, movId) {
  const mov = await getMovimientoFinanzaById(movId);

  if (!mov) {
    return upsertPanel(
      chatId,
      "⚠️ Ese movimiento ya no existe o fue eliminado.",
      [
        [{ text: "⬅️ Volver eliminar", callback_data: "menu_fin_eliminar_mov" }],
        [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
      ]
    );
  }

  const tipo = finTipoLabel(mov.tipo);
  const fecha = String(mov.fecha || "-");
  const monto = moneyLps ? moneyLps(mov.monto || 0) : `${Number(mov.monto || 0).toFixed(2)} Lps`;
  const concepto = finConceptoLabel(mov);
  const extra = finExtraLabel(mov);

  let txt = `🗑️ *CONFIRMAR ELIMINACIÓN*\n\n`;
  txt += `*Tipo:* ${escMD(tipo)}\n`;
  txt += `*Fecha:* ${escMD(fecha)}\n`;
  txt += `*Monto:* ${escMD(monto)}\n`;
  txt += `*Concepto:* ${escMD(concepto)}\n`;
  if (extra) txt += `*Extra:* ${escMD(extra)}\n`;
  txt += `\n¿Desea eliminar este movimiento?`;

  return upsertPanel(
    chatId,
    txt,
    [
      [{ text: "✅ Sí, eliminar", callback_data: `fin_del_mov_ok_${mov.id}` }],
      [{ text: "❌ Cancelar", callback_data: "menu_fin_eliminar_mov" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

async function eliminarMovimientoDefinitivo(chatId, movId, userId = null) {
  const mov = await getMovimientoFinanzaById(movId);

  if (!mov) {
    return upsertPanel(
      chatId,
      "⚠️ El movimiento ya no existe o ya fue eliminado.",
      [
        [{ text: "⬅️ Volver eliminar", callback_data: "menu_fin_eliminar_mov" }],
        [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
      ]
    );
  }

  await db.collection(FINANZAS_COLLECTION).doc(movId).delete();

  const tipo = finTipoLabel(mov.tipo);
  const fecha = String(mov.fecha || "-");
  const monto = moneyLps ? moneyLps(mov.monto || 0) : `${Number(mov.monto || 0).toFixed(2)} Lps`;
  const concepto = finConceptoLabel(mov);

  let txt = `✅ *MOVIMIENTO ELIMINADO*\n\n`;
  txt += `*Tipo:* ${escMD(tipo)}\n`;
  txt += `*Fecha:* ${escMD(fecha)}\n`;
  txt += `*Monto:* ${escMD(monto)}\n`;
  txt += `*Concepto:* ${escMD(concepto)}\n`;

  if (userId) {
    txt += `*Eliminado por:* \`${String(userId)}\`\n`;
  }

  return upsertPanel(
    chatId,
    txt,
    [
      [{ text: "🗑️ Eliminar otro", callback_data: "menu_fin_eliminar_mov" }],
      [{ text: "📒 Volver Registro", callback_data: "fin_registro_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

// ===============================
// REGISTROS RÁPIDOS
// ===============================
async function listarIngresosHoy(chatId) {
  const hoy = hoyDMY();
  const rows = await listarMovimientosPorFechaYTipo(hoy, "ingreso");

  if (!rows.length) {
    return upsertPanel(
      chatId,
      `📒 *INGRESOS DE HOY (${hoy})*\n\nNo hay ingresos registrados hoy.`,
      [
        [{ text: "⬅️ Volver Registro", callback_data: "fin_registro_menu" }],
        [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
      ]
    );
  }

  const lines = rows.slice(0, 30).map((r, i) => {
    return `${i + 1}. ${textoMovimientoParaEliminar(r)}`;
  });

  return upsertPanel(
    chatId,
    `📒 *INGRESOS DE HOY (${hoy})*\n\n${escMD(lines.join("\n"))}`,
    [
      [{ text: "⬅️ Volver Registro", callback_data: "fin_registro_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

async function listarEgresosHoy(chatId) {
  const hoy = hoyDMY();
  const rows = await listarMovimientosPorFechaYTipo(hoy, "egreso");

  if (!rows.length) {
    return upsertPanel(
      chatId,
      `📒 *EGRESOS DE HOY (${hoy})*\n\nNo hay egresos registrados hoy.`,
      [
        [{ text: "⬅️ Volver Registro", callback_data: "fin_registro_menu" }],
        [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
      ]
    );
  }

  const lines = rows.slice(0, 30).map((r, i) => {
    return `${i + 1}. ${textoMovimientoParaEliminar(r)}`;
  });

  return upsertPanel(
    chatId,
    `📒 *EGRESOS DE HOY (${hoy})*\n\n${escMD(lines.join("\n"))}`,
    [
      [{ text: "⬅️ Volver Registro", callback_data: "fin_registro_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

// ===============================
// REPORTES
// ===============================
async function menuReportesFinanzas(chatId) {
  return upsertPanel(
    chatId,
    "📊 *REPORTES DE FINANZAS*\n\nSeleccione una opción:",
    [
      [{ text: "📅 Reporte del mes actual", callback_data: "fin_rep_mes_actual" }],
      [{ text: "🧾 Exportar Excel mensual", callback_data: "fin_excel_mes_actual" }],
      [{ text: "⬅️ Volver Finanzas", callback_data: "fin_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

async function resumenFinancieroPorMonthKey(monthKey) {
  const snap = await db
    .collection(FINANZAS_COLLECTION)
    .where("monthKey", "==", monthKey)
    .get();

  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

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
  const monthKey = parseMonthInputToKey ? parseMonthInputToKey(hoyDMY()) : getMonthKeyFromDMY(hoyDMY());
  const label = getMonthLabelFromKey ? getMonthLabelFromKey(monthKey) : monthKey;
  const res = await resumenFinancieroPorMonthKey(monthKey);

  let txt = `📊 *REPORTE ${escMD(label)}*\n\n`;
  txt += `*Ingresos:* ${escMD(moneyLps(res.ingresos || 0))}\n`;
  txt += `*Egresos:* ${escMD(moneyLps(res.egresos || 0))}\n`;
  txt += `*Utilidad:* ${escMD(moneyLps(res.utilidad || 0))}\n`;
  txt += `*Movimientos:* ${escMD(String(res.totalMovimientos || 0))}\n`;

  if (res.topOrdenado.length) {
    txt += `\n*Top plataformas vendidas:*\n`;
    txt += res.topOrdenado
      .map((x, i) => `${i + 1}. ${escMD(humanPlataforma(x.plataforma))} — ${escMD(moneyLps(x.total || 0))}`)
      .join("\n");
  }

  return upsertPanel(
    chatId,
    txt,
    [
      [{ text: "🧾 Exportar Excel mensual", callback_data: "fin_excel_mes_actual" }],
      [{ text: "⬅️ Volver Reportes", callback_data: "fin_reportes_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

// ===============================
// EXCEL MENSUAL
// ===============================
async function exportarExcelMesActual(chatId) {
  const monthKey = parseMonthInputToKey ? parseMonthInputToKey(hoyDMY()) : getMonthKeyFromDMY(hoyDMY());
  const label = getMonthLabelFromKey ? getMonthLabelFromKey(monthKey) : monthKey;
  const res = await resumenFinancieroPorMonthKey(monthKey);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Finanzas");

  ws.columns = [
    { header: "Fecha", key: "fecha", width: 15 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Monto", key: "monto", width: 15 },
    { header: "Plataforma/Motivo", key: "concepto", width: 28 },
    { header: "Banco/Método", key: "extra", width: 22 },
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

  const tempPath = `/tmp/finanzas_${monthKey}.xlsx`;
  await wb.xlsx.writeFile(tempPath);

  await bot.sendDocument(chatId, tempPath, {
    caption: `📊 Reporte Excel de ${label}`,
  });

  return upsertPanel(
    chatId,
    `✅ *Excel generado correctamente* para *${escMD(label)}*.`,
    [
      [{ text: "⬅️ Volver Reportes", callback_data: "fin_reportes_menu" }],
      [{ text: "🏠 Inicio", callback_data: "menu_principal" }],
    ]
  );
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  menuPrincipal,
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
