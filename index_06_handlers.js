/* ✅ SUBLICUENTAS TG BOT — PARTE 6/6 CORREGIDA
   HANDLERS / COMANDOS / CALLBACKS / MESSAGE / AUTOTXT / HARDEN / HTTP
   -------------------------------------------------------------------
   Compatible con:
   - inventario por categorías
   - plataformas nuevas: deezer, gemini, chatgpt
   - accesos por correo o usuario según plataforma
   - parte 1, 2, 3, 4 y 5 actualizadas
   ✅ CORREGIDO: eliminar movimientos por fecha
*/

const http = require("http");

const {
  bot,
  admin,
  db,
  TZ,
  PLATAFORMAS,
  FINANZAS_COLLECTION,
  CORE_STATE,
  hardStopBot,
  releaseRuntimeLock,
  getCoreHealth,
} = require("./index_01_core");

const {
  allowMsg,
  isAdmin,
  isSuperAdmin,
  isVendedor,
  getRevendedorPorTelegramId,
  setTelegramIdToRevendedor,
  normalizeRevendedorDoc,
  panelMsgId,
  bindPanelFromCallback,
  upsertPanel,
  wizard,
  pending,
  limpiarQuery,
  normalizarPlataforma,
  esPlataformaValida,
  isEmailLike,
  onlyDigits,
  docIdInventario,
  safeBtnLabel,
  escMD,
  isFechaDMY,
  parseMontoNumber,
  parseMonthInputToKey,
  parseFechaFinanceInput,
  getMonthKeyFromDMY,
  parseDMYtoTS,
  moneyLps,
  hoyDMY,
  addDaysDMY,
  logErr,
  getIdentLabel,
  getAccessTypeLabel,
  validateIdentByPlatform,
  normalizeIdentByPlatform,
} = require("./index_02_utils_roles");

const {
  dedupeClientes,
  buscarPorTelefonoTodos,
  buscarClienteRobusto,
  enviarFichaCliente,
  enviarListaResultadosClientes,
  reporteClientesTXTGeneral,
  reporteClientesSplitPorVendedorTXT,
  obtenerRenovacionesPorFecha,
  renovacionesTexto,
  enviarTXT,
  enviarTXTATodosHoy,
  wizardStart,
  wizardNext,
  getCliente,
  clienteResumenTXT,
  enviarHistorialClienteTXT,
  kbPlataformasWiz,
  menuEditarCliente,
  menuListaServicios,
  menuServicio,
  patchServicio,
  addServicioTx,
  serviciosConIndiceOriginal,
  clienteDuplicado,
} = require("./index_03_clientes_crm");

const {
  buscarInventarioPorCorreo,
  enviarInventarioPlataforma,
  mostrarStockGeneral,
  enviarSubmenuInventario,
  buscarCorreoInventarioPorPlatCorreo,
  mostrarMenuClientesCorreo,
  mostrarListaCorreosPlataforma,
  mostrarPanelCorreo,
  responderMenuCodigosNetflix,
  responderCodigoNetflix,
  getCapacidadCorreo,
  aplicarAutoLleno,
} = require("./index_04_inventario_correos");

const {
  menuPrincipal,
  menuPrincipalFromCommand,
  menuVendedor,
  menuVendedorFromCommand,
  menuInventario,
  menuInventarioVideo,
  menuInventarioMusica,
  menuInventarioIptv,
  menuInventarioDisenoIA,
  menuClientes,
  menuPagos,
  menuRenovaciones,
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
} = require("./index_05_finanzas_menus");

// ===============================
// HELPERS LOCALES
// ===============================
function hasRuntimeLock() {
  return CORE_STATE.HAS_RUNTIME_LOCK === true;
}

function identIcon(plataforma = "") {
  return getIdentLabel(plataforma) === "Usuario" ? "👤" : "📧";
}

function textoBtnEliminarMovimiento(m = {}) {
  const tipo = String(m.tipo || "").toLowerCase();
  const fecha = String(m.fecha || "-");
  const monto = moneyLps(m.monto || 0);

  const concepto =
    tipo === "egreso"
      ? String(m.motivo || m.detalle || m.descripcion || "Egreso")
      : String(m.plataforma || m.detalle || m.descripcion || "Ingreso");

  const extra =
    tipo === "egreso"
      ? String(m.detalle || "")
      : String(m.banco || "");

  let txt = `${fecha} • ${monto} • ${concepto}`;
  if (extra) txt += ` • ${extra}`;

  return safeBtnLabel(txt, 60);
}

async function listarRevendedores(chatId) {
  const snap = await db.collection("revendedores").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay revendedores.");

  const all = snap.docs.map((d) => normalizeRevendedorDoc(d));
  all.sort((a, b) =>
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", {
      sensitivity: "base",
    })
  );

  let t = "👤 *REVENDEDORES*\n\n";
  all.forEach((x) => {
    t += `• ${escMD(x.nombre || x.id)} — ${x.activo ? "✅ activo" : "⛔ inactivo"}${
      x.telegramId ? ` | 🆔 ${escMD(x.telegramId)}` : ""
    }\n`;
  });

  if (t.length > 3800) {
    const { enviarTxtComoArchivo } = require("./index_02_utils_roles");
    return enviarTxtComoArchivo(chatId, t, `revendedores_${Date.now()}.txt`);
  }

  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
}

// ===============================
// COMANDOS CLIENTES
// ===============================
bot.onText(/\/buscar\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const q = String(match[1] || "").trim();
  if (!q) return bot.sendMessage(chatId, "⚠️ Uso: /buscar texto");

  if (onlyDigits(q).length >= 7) {
    const resultados = await buscarPorTelefonoTodos(q);
    const dedup = dedupeClientes(resultados);
    if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
    if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
    return enviarListaResultadosClientes(chatId, dedup);
  }

  const resultados = await buscarClienteRobusto(q);
  const dedup = dedupeClientes(resultados);

  if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
  if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

  return enviarListaResultadosClientes(chatId, dedup);
});

bot.onText(/\/cliente\s+(\S+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const tel = String(match[1] || "").trim();
  const resultados = await buscarPorTelefonoTodos(tel);
  const dedup = dedupeClientes(resultados);

  if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
  if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

  return enviarListaResultadosClientes(chatId, dedup);
});

bot.onText(/\/clientes_txt/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return reporteClientesTXTGeneral(chatId);
});

bot.onText(/\/vendedores_txt_split/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return reporteClientesSplitPorVendedorTXT(chatId);
});

bot.onText(/\/sincronizar_todo/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isSuperAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo el SUPER ADMIN puede sincronizar la base de datos.");
  }

  await bot.sendMessage(chatId, "🔄 *Iniciando sincronización masiva...*", {
    parse_mode: "Markdown",
  });

  let perfilesEmparejados = 0;
  const cuentasAfectadas = new Set();

  try {
    const snapClientes = await db.collection("clientes").get();

    for (const docCli of snapClientes.docs) {
      const c = docCli.data() || {};
      const servicios = Array.isArray(c.servicios) ? c.servicios : [];
      const nombreCliente = c.nombrePerfil || "Sin Nombre";

      for (const s of servicios) {
        if (!s.correo || !s.plataforma) continue;

        const plat = normalizarPlataforma(s.plataforma);
        const acceso = String(s.correo).trim().toLowerCase();
        const docId = docIdInventario(acceso, plat);

        const refInv = db.collection("inventario").doc(docId);
        const docInv = await refInv.get();

        if (!docInv.exists) continue;

        const invData = docInv.data() || {};
        let clientesInv = Array.isArray(invData.clientes) ? invData.clientes.slice() : [];
        const pinCliente = s.pin || "0000";

        const yaExiste = clientesInv.some(
          (x) => x.nombre === nombreCliente && x.pin === pinCliente
        );
        if (yaExiste) continue;

        clientesInv.push({
          nombre: nombreCliente,
          pin: pinCliente,
          slot: clientesInv.length + 1,
        });

        const capacidad = Number(invData.capacidad || invData.total || 0);
        const ocupados = clientesInv.length;
        const disponibles =
          capacidad > 0
            ? Math.max(0, capacidad - ocupados)
            : Math.max(0, Number(invData.disp || 0) - 1);
        const estado = disponibles === 0 ? "llena" : "activa";

        await refInv.set(
          {
            clientes: clientesInv,
            ocupados,
            disponibles,
            disp: disponibles,
            estado,
            capacidad,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        perfilesEmparejados++;
        cuentasAfectadas.add(docId);
      }
    }

    let reporte = "✅ *Sincronización completada con éxito*\n\n";
    reporte += `👤 Perfiles emparejados: *${perfilesEmparejados}*\n`;
    reporte += `📦 Cuentas actualizadas: *${cuentasAfectadas.size}*\n\n`;
    reporte += "💡 _La base quedó sincronizada._";

    return bot.sendMessage(chatId, reporte, { parse_mode: "Markdown" });
  } catch (error) {
    logErr("Error en sincronización:", error);
    return bot.sendMessage(
      chatId,
      "⚠️ Ocurrió un error al sincronizar. Revise los logs del servidor."
    );
  }
});

// ===============================
// COMANDOS RENOVACIONES
// ===============================
bot.onText(/\/renovaciones(?:\s+(.+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await isAdmin(userId);
  const vend = await getRevendedorPorTelegramId(userId);

  if (!adminOk && !(vend && vend.nombre)) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

  const arg = String(match[1] || "").trim();
  let fecha = "";
  let vendedor = "";

  if (!arg || arg.toLowerCase() === "hoy") {
    fecha = hoyDMY();
  } else {
    const parts = arg.split(/\s+/);
    if (parts.length === 1 && isFechaDMY(parts[0])) {
      fecha = parts[0];
    } else if (parts.length >= 2 && isFechaDMY(parts[parts.length - 1])) {
      fecha = parts[parts.length - 1];
      vendedor = parts.slice(0, -1).join(" ");
    } else {
      return bot.sendMessage(
        chatId,
        "⚠️ Uso:\n/renovaciones hoy\n/renovaciones dd/mm/yyyy\n/renovaciones VENDEDOR dd/mm/yyyy"
      );
    }
  }

  if (!adminOk && vend?.nombre) vendedor = vend.nombre;

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  const texto = renovacionesTexto(list, fecha, vendedor || null);
  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
});

bot.onText(/\/txt(?:\s+(.+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const adminOk = await isAdmin(userId);
  const vend = await getRevendedorPorTelegramId(userId);

  if (!adminOk && !(vend && vend.nombre)) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

  const arg = String(match[1] || "").trim();
  let fecha = "";
  let vendedor = "";

  if (!arg || arg.toLowerCase() === "hoy") {
    fecha = hoyDMY();
  } else {
    const parts = arg.split(/\s+/);
    if (parts.length === 1 && isFechaDMY(parts[0])) {
      fecha = parts[0];
    } else if (parts.length >= 2 && isFechaDMY(parts[parts.length - 1])) {
      fecha = parts[parts.length - 1];
      vendedor = parts.slice(0, -1).join(" ");
    } else {
      return bot.sendMessage(
        chatId,
        "⚠️ Uso:\n/txt hoy\n/txt dd/mm/yyyy\n/txt VENDEDOR dd/mm/yyyy"
      );
    }
  }

  if (!adminOk && vend?.nombre) vendedor = vend.nombre;

  const list = await obtenerRenovacionesPorFecha(fecha, vendedor || null);
  return enviarTXT(chatId, list, fecha, vendedor || null);
});

// ===============================
// COMANDOS FINANZAS
// ===============================
bot.onText(/\/finanzas/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return menuPagos(chatId);
});

bot.onText(/\/resumen_fecha\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const fecha =
    String(match[1] || "").trim().toLowerCase() === "hoy"
      ? hoyDMY()
      : String(match[1] || "").trim();

  if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Uso: /resumen_fecha dd/mm/yyyy");

  const list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));
  return bot.sendMessage(chatId, resumenFinanzasTextoPorFecha(fecha, list), {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/bancos_mes\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const key = parseMonthInputToKey(String(match[1] || "").trim());
  if (!key) return bot.sendMessage(chatId, "⚠️ Uso: /bancos_mes mm/yyyy");

  const list = await getMovimientosPorMes(key, userId, await isSuperAdmin(userId));
  return bot.sendMessage(chatId, resumenBancosMesTexto(key, list), {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/top_plataformas_mes\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const key = parseMonthInputToKey(String(match[1] || "").trim());
  if (!key) return bot.sendMessage(chatId, "⚠️ Uso: /top_plataformas_mes mm/yyyy");

  const list = await getMovimientosPorMes(key, userId, await isSuperAdmin(userId));
  return bot.sendMessage(chatId, resumenTopPlataformasTexto(key, list), {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/cierre_caja\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const fecha =
    String(match[1] || "").trim().toLowerCase() === "hoy"
      ? hoyDMY()
      : String(match[1] || "").trim();

  if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Uso: /cierre_caja dd/mm/yyyy");

  const list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));
  return bot.sendMessage(chatId, cierreCajaTexto(fecha, list), {
    parse_mode: "Markdown",
  });
});

bot.onText(
  /\/excel_finanzas\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i,
  async (msg, match) => {
    if (!hasRuntimeLock()) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

    const fechaInicio = String(match[1] || "").trim();
    const fechaFin = String(match[2] || "").trim();

    return exportarFinanzasRangoExcel(
      chatId,
      fechaInicio,
      fechaFin,
      userId,
      await isSuperAdmin(userId)
    );
  }
);

bot.onText(/\/editar_movimiento\s+([A-Za-z0-9_-]+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const id = String(match[1] || "").trim();
  const ref = db.collection(FINANZAS_COLLECTION).doc(id);
  const doc = await ref.get();

  if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Movimiento no encontrado.");

  const m = doc.data() || {};

  const txt =
    `✏️ *EDITAR MOVIMIENTO*\n\n` +
    `🆔 ID: \`${id}\`\n` +
    `🗂️ Tipo: ${escMD(m.tipo || "-")}\n` +
    `💰 Monto: ${moneyLps(m.monto || 0)}\n` +
    `🏦 Banco: ${escMD(m.banco || "-")}\n` +
    `🧾 Motivo: ${escMD(m.motivo || "-")}\n` +
    `📦 Plataforma: ${escMD(m.plataforma || "-")}\n` +
    `📝 Detalle: ${escMD(m.detalle || "-")}\n` +
    `📅 Fecha: ${escMD(m.fecha || "-")}\n\n` +
    `Seleccione qué desea editar:`;

  return bot.sendMessage(chatId, txt, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Editar monto", callback_data: `fin:edit:monto:${id}` }],
        [{ text: "🏦 Editar banco", callback_data: `fin:edit:banco:${id}` }],
        [{ text: "🧾 Editar motivo", callback_data: `fin:edit:motivo:${id}` }],
        [{ text: "📦 Editar plataforma", callback_data: `fin:edit:plataforma:${id}` }],
        [{ text: "📝 Editar detalle", callback_data: `fin:edit:detalle:${id}` }],
        [{ text: "📅 Editar fecha", callback_data: `fin:edit:fecha:${id}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
  });
});

// ===============================
// IDS / VINCULACIÓN
// ===============================
bot.onText(/\/id/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(
    chatId,
    `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`
  );
});

bot.onText(/\/miid/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  return bot.sendMessage(
    chatId,
    `🆔 Tu Telegram ID es:\n${userId}\n\n📩 Envíelo al administrador para activarte en el bot.`
  );
});

bot.onText(/\/vincular_vendedor\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso: /vincular_vendedor NOMBRE");

  const r = await setTelegramIdToRevendedor(nombre, userId);
  return bot.sendMessage(chatId, r.msg);
});

// ===============================
// REVENDEDORES ADMIN
// ===============================
bot.onText(/\/addvendedor\s+(\d+)\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");

  const telegramId = String(match[1] || "").trim();
  const nombre = String(match[2] || "").trim();

  if (!telegramId || !nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/addvendedor ID Nombre");

  const docId =
    String(nombre || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .replace(/\s+/g, " ") || String(Date.now());

  await db.collection("revendedores").doc(docId).set(
    {
      nombre,
      nombre_norm: docId,
      telegramId: String(telegramId),
      activo: true,
      autoLastSent: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return bot.sendMessage(
    chatId,
    `✅ Revendedor agregado\n\n👤 ${nombre}\n🆔 ${telegramId}\n📌 DocID: ${docId}`
  );
});

bot.onText(/\/delvendedor\s+(.+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo admin puede usar este comando");

  const nombre = String(match[1] || "").trim();
  if (!nombre) return bot.sendMessage(chatId, "⚠️ Uso:\n/delvendedor Nombre");

  const nombreNorm = String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");

  const snap = await db.collection("revendedores").get();

  let found = null;
  snap.forEach((d) => {
    const rev = normalizeRevendedorDoc(d);
    if (rev.nombre_norm === nombreNorm) found = { ref: d.ref, nombre: rev.nombre };
  });

  if (!found) return bot.sendMessage(chatId, "⚠️ No encontré ese revendedor.");

  await found.ref.delete();
  return bot.sendMessage(chatId, `🗑️ Revendedor eliminado:\n${found.nombre}`);
});

// ===============================
// ADMINS
// ===============================
bot.onText(/\/adminadd\s+(\d+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isSuperAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede agregar admins.");
  }

  const id = String(match[1] || "").trim();

  await db.collection("admins").doc(id).set(
    {
      activo: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      creadoPor: String(userId),
    },
    { merge: true }
  );

  return bot.sendMessage(chatId, `✅ Admin agregado: ${id}`);
});

bot.onText(/\/admindel\s+(\d+)/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isSuperAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN puede eliminar admins.");
  }

  const id = String(match[1] || "").trim();

  await db.collection("admins").doc(id).set(
    {
      activo: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      desactivadoPor: String(userId),
    },
    { merge: true }
  );

  return bot.sendMessage(chatId, `🗑️ Admin desactivado: ${id}`);
});

bot.onText(/\/adminlist/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isSuperAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPER ADMIN.");

  const snap = await db.collection("admins").get();
  if (snap.empty) return bot.sendMessage(chatId, "⚠️ No hay admins en colección.");

  const { SUPER_ADMIN } = require("./index_01_core");
  let t = `👑 *ADMINS*\nSUPER_ADMIN: ${SUPER_ADMIN || "(no seteado)"}\n\n`;

  snap.forEach((d) => {
    const x = d.data() || {};
    t += `• ${d.id} — ${x.activo ? "✅ activo" : "⛔ inactivo"}\n`;
  });

  return bot.sendMessage(chatId, t, { parse_mode: "Markdown" });
});

// ===============================
// START / MENU BLINDADO
// ===============================
bot.onText(/\/start/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (await isAdmin(userId)) return menuPrincipalFromCommand(msg);
  if (await isVendedor(userId)) return menuVendedorFromCommand(msg);

  return bot.sendMessage(chatId, "⛔ Acceso denegado");
});

bot.onText(/\/menu/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    panelMsgId.delete(String(chatId));

    if (await isAdmin(userId)) return menuPrincipalFromCommand(msg);
    if (await isVendedor(userId)) return menuVendedorFromCommand(msg);

    return bot.sendMessage(chatId, "⛔ Acceso denegado", {
      reply_to_message_id: msg.message_id,
    });
  } catch (_) {
    return bot.sendMessage(chatId, "⚠️ Error interno.");
  }
});

// ===============================
// ATAJOS INVENTARIO
// ===============================
PLATAFORMAS.forEach((p) => {
  bot.onText(new RegExp("^\\/" + p + "(?:@\\w+)?(?:\\s+.*)?$", "i"), async (msg) => {
    if (!hasRuntimeLock()) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

    return enviarInventarioPlataforma(chatId, p, 0);
  });
});

bot.onText(/\/stock/i, async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  return mostrarStockGeneral(chatId);
});

// ===============================
// AGREGAR CUENTA INVENTARIO
// /addcorreo plataforma acceso [capacidad]
// ===============================
bot.onText(/\/addcorreo\s+(\S+)\s+(\S+)(?:\s+(\d+))?/i, async (msg, match) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado. Solo admins pueden agregar inventario.");
  }

  const platRaw = match[1];
  const accesoRaw = match[2];
  const capacidadRaw = match[3];

  const plat = normalizarPlataforma(platRaw);
  if (!esPlataformaValida(plat)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Plataforma no válida.*",
      { parse_mode: "Markdown" }
    );
  }

  const label = getIdentLabel(plat);
  const acceso = normalizeIdentByPlatform(plat, accesoRaw);

  if (!validateIdentByPlatform(plat, acceso)) {
    return bot.sendMessage(
      chatId,
      `⚠️ *${escMD(label)} inválido.*\nRevise el formato para esta plataforma.`,
      { parse_mode: "Markdown" }
    );
  }

  const idInv = docIdInventario(acceso, plat);
  const ref = db.collection("inventario").doc(idInv);
  const doc = await ref.get();

  if (doc.exists) {
    return bot.sendMessage(
      chatId,
      `⚠️ *Esta cuenta ya existe* en el inventario para *${escMD(plat)}*.`,
      { parse_mode: "Markdown" }
    );
  }

  let capacidad = Number(capacidadRaw);
  if (!capacidadRaw || isNaN(capacidad) || capacidad <= 0) {
    const { getTotalPorPlataforma } = require("./index_02_utils_roles");
    const total = await getTotalPorPlataforma(plat);
    capacidad = total || 1;
  }

  await ref.set({
    plataforma: plat,
    correo: acceso,
    capacidad,
    clientes: [],
    ocupados: 0,
    disponibles: capacidad,
    disp: capacidad,
    estado: "activa",
    clave: getAccessTypeLabel(plat) === "Solo correo" ? "" : "Sin clave",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let out = `✅ *NUEVA CUENTA AGREGADA AL INVENTARIO*\n\n`;
  out += `📌 *Plataforma:* ${escMD(plat.toUpperCase())}\n`;
  out += `🔐 *Tipo de acceso:* ${escMD(getAccessTypeLabel(plat))}\n`;
  out += `${identIcon(plat)} *${escMD(label)}:* ${escMD(acceso)}\n`;
  if (getAccessTypeLabel(plat) !== "Solo correo") {
    out += `🔑 *Clave inicial:* Sin clave\n`;
  }
  out += `👥 *Capacidad:* ${capacidad}\n\n`;
  out += `_💡 Ya puede editar la clave o asignar clientes._`;

  return bot.sendMessage(chatId, out, { parse_mode: "Markdown" });
});

// ===============================
// CALLBACKS
// ===============================
bot.on("callback_query", async (q) => {
  if (!hasRuntimeLock()) return;

  const chatId = q.message?.chat?.id;
  const userId = q.from?.id;
  const data = q.data || "";

  try {
    try {
      await bot.answerCallbackQuery(q.id);
    } catch (_) {}

    if (!chatId) return;
    if (!allowMsg(chatId, userId)) return;

    bindPanelFromCallback(q);

    const adminOk = await isAdmin(userId);
    const vend = await getRevendedorPorTelegramId(userId);
    const vendOk = !!(vend && vend.nombre);

    if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    if (data === "noop") return;

    if (data === "go:inicio") {
      pending.delete(String(chatId));
      if (adminOk) return menuPrincipal(chatId);
      return menuVendedor(chatId);
    }

    const vendedorOnlyAllowed = new Set([
      "ren:mis",
      "txt:mis",
      "vend:clientes",
      "vend:clientes:txt",
      "go:inicio",
    ]);

    if (!adminOk) {
      if (!vendedorOnlyAllowed.has(data)) {
        return upsertPanel(
          chatId,
          "⛔ Modo vendedor.\n\nUsa:\n• Mis renovaciones\n• TXT Mis renovaciones\n• Mis clientes\n• TXT Mis clientes\n",
          { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
          "Markdown"
        );
      }
    }

    if (adminOk) {
      if (data === "menu:inventario") return menuInventario(chatId);
      if (data === "menu:inventario:video") return menuInventarioVideo(chatId);
      if (data === "menu:inventario:musica") return menuInventarioMusica(chatId);
      if (data === "menu:inventario:iptv") return menuInventarioIptv(chatId);
      if (data === "menu:inventario:designai") return menuInventarioDisenoIA(chatId);

      if (data === "menu:clientes") return menuClientes(chatId);
      if (data === "menu:pagos") return menuPagos(chatId);
      if (data === "menu:renovaciones") return menuRenovaciones(chatId, userId);

      if (data === "fin:menu:registro") return menuFinRegistro(chatId);
      if (data === "fin:menu:reportes") return menuFinReportes(chatId);
      if (data === "fin:menu:eliminar") return menuFinEliminarTipo(chatId);

      // ✅ CORREGIDO: ahora pide fecha primero
      if (data === "fin:menu:eliminar:ingreso") {
        pending.set(String(chatId), {
          mode: "finEliminarFechaAsk",
          tipo: "ingreso",
        });

        return upsertPanel(
          chatId,
          "🗑️ *ELIMINAR INGRESO POR FECHA*\n\nEscriba la fecha exacta en formato *dd/mm/yyyy*.\n\nEjemplo: *23/03/2026*",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      // ✅ CORREGIDO: ahora pide fecha primero
      if (data === "fin:menu:eliminar:egreso") {
        pending.set(String(chatId), {
          mode: "finEliminarFechaAsk",
          tipo: "egreso",
        });

        return upsertPanel(
          chatId,
          "🗑️ *ELIMINAR EGRESO POR FECHA*\n\nEscriba la fecha exacta en formato *dd/mm/yyyy*.\n\nEjemplo: *23/03/2026*",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:ingreso") {
        pending.set(String(chatId), { mode: "finIngresoMonto" });
        return upsertPanel(
          chatId,
          "➕ *REGISTRAR INGRESO*\n\n💰 Escriba el monto del ingreso en Lps:",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:egreso") {
        pending.set(String(chatId), { mode: "finEgresoMonto" });
        return upsertPanel(
          chatId,
          "➖ *REGISTRAR EGRESO*\n\n💸 Escriba el monto del gasto en Lps:",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:resumen_fecha") {
        pending.set(String(chatId), { mode: "finResumenFechaAsk" });
        return upsertPanel(
          chatId,
          "📊 *VER RESUMEN POR FECHA*\n\nEscriba la fecha en formato *dd/mm/yyyy* o escriba *hoy*.",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:bancos_mes") {
        pending.set(String(chatId), { mode: "finResumenBancoMesAsk" });
        return upsertPanel(
          chatId,
          "🏦 *RESUMEN POR BANCO DEL MES*\n\nEscriba el mes en formato *mm/yyyy*.\nEjemplo: *01/2026*",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:top_plataformas") {
        pending.set(String(chatId), { mode: "finTopPlataformasMesAsk" });
        return upsertPanel(
          chatId,
          "🏆 *TOP PLATAFORMAS DEL MES*\n\nEscriba el mes en formato *mm/yyyy*.\nEjemplo: *01/2026*",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:cierre") {
        pending.set(String(chatId), { mode: "finCierreCajaAsk" });
        return upsertPanel(
          chatId,
          "🧾 *CIERRE DE CAJA*\n\nEscriba la fecha en formato *dd/mm/yyyy* o escriba *hoy*.",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data === "fin:menu:excel_rango") {
        pending.set(String(chatId), { mode: "finExcelRangoInicio" });
        return upsertPanel(
          chatId,
          "📤 *EXPORTAR EXCEL POR RANGO*\n\nEscriba la fecha inicial en formato *dd/mm/yyyy*.",
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Reportes", callback_data: "fin:menu:reportes" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("fin:ing:banco:")) {
        const banco = decodeURIComponent(data.split(":").slice(3).join(":") || "");
        const p = pending.get(String(chatId));
        if (!p || p.mode !== "finIngresoBancoPick") {
          return bot.sendMessage(chatId, "⚠️ Flujo de ingreso no activo.");
        }

        pending.set(String(chatId), {
          mode: "finIngresoPlataformaManual",
          monto: p.monto,
          banco,
        });

        return upsertPanel(
          chatId,
          `➕ *REGISTRAR INGRESO*\n\n🏦 Banco: *${escMD(
            banco
          )}*\n\n📦 Escriba manualmente la plataforma o plataformas.\nEjemplo:\nNetflix\nDisney\nHBO Max\nPrime Video`,
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("fin:egr:motivo:")) {
        const motivo = decodeURIComponent(data.split(":").slice(3).join(":") || "");
        const p = pending.get(String(chatId));
        if (!p || p.mode !== "finEgresoMotivoPick") {
          return bot.sendMessage(chatId, "⚠️ Flujo de egreso no activo.");
        }

        pending.set(String(chatId), {
          mode: "finEgresoDetalle",
          monto: p.monto,
          motivo,
        });

        return upsertPanel(
          chatId,
          `➖ *REGISTRAR EGRESO*\n\n🧾 Motivo: *${escMD(
            motivo
          )}*\n\n📝 Escriba el detalle del egreso:`,
          {
            inline_keyboard: [
              [{ text: "⬅️ Volver Finanzas", callback_data: "fin:menu:registro" }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("fin:del:pick:")) {
        const id = String(data.split(":")[3] || "").trim();
        const ref = db.collection(FINANZAS_COLLECTION).doc(id);
        const doc = await ref.get();

        if (!doc.exists) {
          return bot.sendMessage(chatId, "⚠️ Movimiento no encontrado.");
        }

        const m = { id: doc.id, ...(doc.data() || {}) };
        const tipo = String(m.tipo || "").toLowerCase() === "egreso" ? "egreso" : "ingreso";

        return upsertPanel(
          chatId,
          textoConfirmarEliminacionMovimiento(m),
          {
            inline_keyboard: [
              [{ text: "✅ Sí, eliminar este", callback_data: `fin:del:ok:${id}` }],
              [
                {
                  text:
                    tipo === "egreso"
                      ? "⬅️ Buscar egresos por fecha"
                      : "⬅️ Buscar ingresos por fecha",
                  callback_data:
                    tipo === "egreso"
                      ? "fin:menu:eliminar:egreso"
                      : "fin:menu:eliminar:ingreso",
                },
              ],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("fin:del:ok:")) {
        const id = String(data.split(":")[3] || "").trim();

        try {
          const eliminado = await eliminarMovimientoFinanzas(
            id,
            userId,
            await isSuperAdmin(userId)
          );

          const tipoEliminado =
            String(eliminado.tipo || "").toLowerCase() === "egreso" ? "egreso" : "ingreso";

          return upsertPanel(
            chatId,
            `✅ *Movimiento eliminado correctamente*\n\n` +
              `🗂️ Tipo: ${escMD(eliminado.tipo || "-")}\n` +
              `💰 Monto: ${moneyLps(eliminado.monto || 0)}\n` +
              `📅 Fecha: ${escMD(eliminado.fecha || "-")}`,
            {
              inline_keyboard: [
                [
                  {
                    text:
                      tipoEliminado === "egreso"
                        ? "➖ Buscar egreso por fecha"
                        : "➕ Buscar ingreso por fecha",
                    callback_data: `fin:menu:eliminar:${tipoEliminado}`,
                  },
                ],
                [{ text: "🗑️ Volver eliminar", callback_data: "fin:menu:eliminar" }],
                [{ text: "⬅️ Volver a Finanzas", callback_data: "menu:pagos" }],
                [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
              ],
            },
            "Markdown"
          );
        } catch (e) {
          return bot.sendMessage(
            chatId,
            `⚠️ ${e.message || "No se pudo eliminar el movimiento."}`
          );
        }
      }

      if (data === "fin:otro:ingreso") {
        pending.set(String(chatId), { mode: "finIngresoMonto" });
        return bot.sendMessage(chatId, "💰 Escriba el monto del nuevo ingreso:");
      }

      if (data === "fin:otro:egreso") {
        pending.set(String(chatId), { mode: "finEgresoMonto" });
        return bot.sendMessage(chatId, "💸 Escriba el monto del nuevo egreso:");
      }

      if (data === "fin:otro:no") {
        pending.delete(String(chatId));
        return menuPagos(chatId);
      }

      if (data.startsWith("fin:edit:monto:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditMonto", id });
        return bot.sendMessage(chatId, "💰 Escriba el nuevo monto:");
      }

      if (data.startsWith("fin:edit:banco:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditBanco", id });
        return bot.sendMessage(chatId, "🏦 Escriba el nuevo banco:");
      }

      if (data.startsWith("fin:edit:motivo:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditMotivo", id });
        return bot.sendMessage(chatId, "🧾 Escriba el nuevo motivo:");
      }

      if (data.startsWith("fin:edit:plataforma:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditPlataforma", id });
        return bot.sendMessage(chatId, "📦 Escriba la nueva plataforma o plataformas:");
      }

      if (data.startsWith("fin:edit:detalle:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditDetalle", id });
        return bot.sendMessage(chatId, "📝 Escriba el nuevo detalle:");
      }

      if (data.startsWith("fin:edit:fecha:")) {
        const id = data.split(":")[3];
        pending.set(String(chatId), { mode: "finEditFecha", id });
        return bot.sendMessage(chatId, "📅 Escriba la nueva fecha en formato dd/mm/yyyy:");
      }

      if (data === "menu:buscar") {
        return upsertPanel(
          chatId,
          "🔎 *BUSCAR*\n\nUse:\n• /buscar NOMBRE\n• /buscar TELEFONO\n\nTambién puede escribir directamente:\n• /NOMBRE\n• /TELEFONO\n• /CORREO\n• /USUARIO",
          { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
          "Markdown"
        );
      }

      if (data === "inv:general") return mostrarStockGeneral(chatId);

      if (
        data.startsWith("inv:") &&
        !data.startsWith("inv:open:") &&
        !data.startsWith("inv:menu:")
      ) {
        const [, plat, pageStr] = data.split(":");
        return enviarInventarioPlataforma(chatId, plat, Number(pageStr || 0));
      }

      if (data.startsWith("inv:open:")) {
        const [, , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.set(String(chatId), {
          mode: "invSubmenuCtx",
          plat: normalizarPlataforma(plat),
          correo: String(acceso).toLowerCase(),
        });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (data.startsWith("inv:menu:sumar:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.set(String(chatId), { mode: "invSumarQty", plat, correo: acceso });
        return upsertPanel(
          chatId,
          `➕ *Agregar perfil*\n📌 ${String(plat).toUpperCase()}\n${identIcon(plat)} ${escMD(
            getIdentLabel(plat)
          )}: ${escMD(acceso)}\n\nEscriba cantidad a *SUMAR* (ej: 1):`,
          {
            inline_keyboard: [[{
              text: "↩️ Cancelar",
              callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(acceso)}`,
            }]],
          },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:restar:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.set(String(chatId), { mode: "invRestarQty", plat, correo: acceso });
        return upsertPanel(
          chatId,
          `➖ *Quitar perfil*\n📌 ${String(plat).toUpperCase()}\n${identIcon(plat)} ${escMD(
            getIdentLabel(plat)
          )}: ${escMD(acceso)}\n\nEscriba cantidad a *RESTAR* (ej: 1):`,
          {
            inline_keyboard: [[{
              text: "↩️ Cancelar",
              callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(acceso)}`,
            }]],
          },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:clave:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.set(String(chatId), { mode: "invEditClave", plat, correo: acceso });
        return upsertPanel(
          chatId,
          `✏️ *Editar clave*\n📌 ${String(plat).toUpperCase()}\n${identIcon(plat)} ${escMD(
            getIdentLabel(plat)
          )}: ${escMD(acceso)}\n\nEscriba la nueva clave:`,
          {
            inline_keyboard: [[{
              text: "↩️ Cancelar",
              callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(acceso)}`,
            }]],
          },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:cancel:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        pending.delete(String(chatId));
        pending.set(String(chatId), {
          mode: "invSubmenuCtx",
          plat: normalizarPlataforma(plat),
          correo: String(acceso).toLowerCase(),
        });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (data.startsWith("inv:menu:borrar:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        return upsertPanel(
          chatId,
          `🗑️ Confirmar *borrar cuenta*?\n📌 ${String(plat).toUpperCase()}\n${identIcon(
            plat
          )} ${escMD(getIdentLabel(plat))}: ${escMD(acceso)}`,
          {
            inline_keyboard: [
              [{
                text: "✅ Confirmar",
                callback_data: `inv:menu:borrarok:${normalizarPlataforma(plat)}:${encodeURIComponent(String(acceso).toLowerCase())}`,
              }],
              [{
                text: "⬅️ Cancelar",
                callback_data: `inv:menu:cancel:${plat}:${encodeURIComponent(acceso)}`,
              }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("inv:menu:borrarok:")) {
        const [, , , plat, accesoEnc] = data.split(":");
        const acceso = decodeURIComponent(accesoEnc || "");
        const ref = db.collection("inventario").doc(docIdInventario(acceso, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ No existe esa cuenta en inventario.");
        await ref.delete();
        pending.delete(String(chatId));
        return enviarInventarioPlataforma(chatId, plat, 0);
      }

      if (data.startsWith("mail_panel|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        return mostrarPanelCorreo(chatId, plataforma, acceso);
      }

      if (data.startsWith("mail_menu_clientes|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        return mostrarMenuClientesCorreo(chatId, plataforma, acceso);
      }

      if (data.startsWith("mail_menu_codigos|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        return responderMenuCodigosNetflix(chatId, plataforma, acceso);
      }

      if (data.startsWith("nf_code|")) {
        const parts = data.split("|");
        const tipo = parts[1] || "";
        const acceso = decodeURIComponent(parts[2] || "");
        return responderCodigoNetflix(chatId, acceso, tipo);
      }

      if (data.startsWith("mail_ver_clientes|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        let txt = "👥 *Clientes en esta cuenta*\n\n";
        txt += `${identIcon(plataforma)} *${escMD(getIdentLabel(plataforma))}:* ${escMD(acceso)}\n`;
        txt += `📌 *${escMD(String(plataforma).toUpperCase())}*\n\n`;

        if (!clientes.length) {
          txt += "_No hay clientes asignados._\n\n";
        } else {
          clientes.forEach((c, i) => {
            txt += `${i + 1}. ${escMD(c.nombre || "Sin nombre")} — PIN ${escMD(c.pin || "----")}\n`;
          });
          txt += "\n";
        }

        txt += `👤 *Ocupados:* ${ocupados}/${capacidad}\n`;
        txt += `✅ *Disponibles:* ${disponibles}\n`;
        txt += `📊 *Estado:* ${escMD(estado)}`;

        return upsertPanel(
          chatId,
          txt,
          {
            inline_keyboard: [
              [{
                text: "⬅️ Volver a la cuenta",
                callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}`,
              }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("mail_add_cliente|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];
        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);

        if (disponibles <= 0) {
          return bot.sendMessage(
            chatId,
            `❌ Esta cuenta ya está llena.\n\n👤 Ocupados: ${ocupados}/${capacidad}\n✅ Disponibles: 0\n📊 Estado: LLENA`
          );
        }

        pending.set(String(chatId), {
          mode: "mailAddClienteNombre",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(acceso).toLowerCase(),
        });

        return bot.sendMessage(chatId, "👤 *Agregar cliente*\n\nEscriba el nombre del cliente:", {
          parse_mode: "Markdown",
        });
      }

      if (data.startsWith("mail_del_cliente|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) {
          return bot.sendMessage(chatId, "⚠️ Esta cuenta no tiene clientes.");
        }

        const kb = clientes.map((c, i) => [
          {
            text: `${i + 1}. ${c.nombre || "Sin nombre"} — PIN ${c.pin || "----"}`,
            callback_data: `mail_del_cliente_ok|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}|${i}`,
          },
        ]);

        kb.push([{
          text: "⬅️ Volver",
          callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}`,
        }]);

        return upsertPanel(
          chatId,
          `➖ *Quitar cliente*\n\n${identIcon(plataforma)} *${escMD(
            getIdentLabel(plataforma)
          )}:* ${escMD(acceso)}\n\nSeleccione el cliente que desea quitar:`,
          { inline_keyboard: kb },
          "Markdown"
        );
      }

      if (data.startsWith("mail_del_cliente_ok|")) {
        const [, plataforma, accesoEnc, indexStr] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const index = Number(indexStr);

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Esta cuenta ya no tiene clientes.");
        if (isNaN(index) || index < 0 || index >= clientes.length) {
          return bot.sendMessage(chatId, "❌ Cliente inválido.");
        }

        const cliente = clientes[index];
        clientes.splice(index, 1);

        clientes = clientes.map((c, i) => ({
          ...c,
          slot: i + 1,
        }));

        const capacidad = getCapacidadCorreo(correoData, plataforma);
        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        await ref.set(
          {
            clientes,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            capacidad,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(
          chatId,
          "✅ *Cliente quitado correctamente*\n\n" +
            `👤 *Nombre:* ${escMD(cliente.nombre || "Sin nombre")}\n` +
            `🔐 *PIN:* ${escMD(cliente.pin || "----")}\n\n` +
            `👤 *Ocupados:* ${ocupados}/${capacidad}\n` +
            `✅ *Disponibles:* ${disponibles}\n` +
            `📊 *Estado:* ${escMD(estado)}`,
          { parse_mode: "Markdown" }
        );

        return mostrarPanelCorreo(chatId, plataforma, acceso);
      }

      if (data.startsWith("mail_edit_pin|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Esta cuenta no tiene clientes.");

        const kb = clientes.map((c, i) => [
          {
            text: `${i + 1}. ${c.nombre || "Sin nombre"} — PIN ${c.pin || "----"}`,
            callback_data: `mail_edit_pin_sel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}|${i}`,
          },
        ]);

        kb.push([{
          text: "⬅️ Volver",
          callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}`,
        }]);

        return upsertPanel(
          chatId,
          `🔐 *Editar PIN*\n\n${identIcon(plataforma)} *${escMD(
            getIdentLabel(plataforma)
          )}:* ${escMD(acceso)}\n\nSeleccione el cliente:`,
          { inline_keyboard: kb },
          "Markdown"
        );
      }

      if (data.startsWith("mail_edit_pin_sel|")) {
        const [, plataforma, accesoEnc, indexStr] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");
        const clienteIndex = Number(indexStr);

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (!clientes.length) return bot.sendMessage(chatId, "⚠️ Esta cuenta no tiene clientes.");
        if (isNaN(clienteIndex) || clienteIndex < 0 || clienteIndex >= clientes.length) {
          return bot.sendMessage(chatId, "❌ Cliente inválido.");
        }

        const cliente = clientes[clienteIndex];

        pending.set(String(chatId), {
          mode: "mailEditPin",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(acceso).toLowerCase(),
          clienteIndex,
        });

        return bot.sendMessage(
          chatId,
          "🔐 *Editar PIN*\n\n" +
            `👤 *Cliente:* ${escMD(cliente.nombre || "Sin nombre")}\n` +
            `🔑 *PIN actual:* ${escMD(cliente.pin || "----")}\n\n` +
            "Escriba el nuevo PIN de 4 dígitos:",
          { parse_mode: "Markdown" }
        );
      }

      if (data.startsWith("mail_edit_clave|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const correoData = found.data || {};
        const claveActual = correoData.clave || "Sin clave";

        pending.set(String(chatId), {
          mode: "mailEditClaveCorreo",
          plataforma: normalizarPlataforma(plataforma),
          correo: String(acceso).toLowerCase(),
        });

        return bot.sendMessage(
          chatId,
          "✏️ *Editar clave de la cuenta*\n\n" +
            `${identIcon(plataforma)} *${escMD(getIdentLabel(plataforma))}:* ${escMD(acceso)}\n` +
            `🔑 *Clave actual:* ${escMD(claveActual)}\n\n` +
            "Escriba la nueva clave:",
          { parse_mode: "Markdown" }
        );
      }

      if (data.startsWith("mail_delete|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return bot.sendMessage(chatId, "❌ Esta cuenta ya no existe.");

        return upsertPanel(
          chatId,
          "⚠️ *Confirmar eliminación*\n\n" +
            `📌 *Plataforma:* ${escMD(normalizarPlataforma(plataforma).toUpperCase())}\n` +
            `${identIcon(plataforma)} *${escMD(getIdentLabel(plataforma))}:* ${escMD(acceso)}\n\n` +
            "Esta acción eliminará la cuenta del inventario.\n\n¿Está seguro que desea borrarla?",
          {
            inline_keyboard: [
              [{
                text: "✅ Sí borrar",
                callback_data: `mail_delete_confirm|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}`,
              }],
              [{
                text: "❌ Cancelar",
                callback_data: `mail_panel|${normalizarPlataforma(plataforma)}|${encodeURIComponent(acceso)}`,
              }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("mail_delete_confirm|")) {
        const [, plataforma, accesoEnc] = data.split("|");
        const acceso = decodeURIComponent(accesoEnc || "");

        const found = await buscarCorreoInventarioPorPlatCorreo(plataforma, acceso);
        if (!found) return mostrarListaCorreosPlataforma(chatId, plataforma);

        const ref = found.ref;
        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes : [];

        if (clientes.length > 0) {
          await bot.sendMessage(
            chatId,
            "⚠️ Esta cuenta tenía clientes asignados. Se eliminará igualmente del inventario."
          );
        }

        await ref.delete();
        return enviarInventarioPlataforma(chatId, plataforma, 0);
      }

      if (data === "cli:txt:general") return reporteClientesTXTGeneral(chatId);
      if (data === "cli:txt:vendedores_split") return reporteClientesSplitPorVendedorTXT(chatId);

      if (data.startsWith("cli:txt:hist:")) {
        const clientId = data.split(":")[3];
        return enviarHistorialClienteTXT(chatId, clientId);
      }

      if (data.startsWith("cli:txt:one:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        const { enviarTxtComoArchivo } = require("./index_02_utils_roles");
        return enviarTxtComoArchivo(
          chatId,
          clienteResumenTXT(c),
          `cliente_${onlyDigits(c.telefono || "") || clientId}.txt`
        );
      }

      if (data.startsWith("cli:view:")) return enviarFichaCliente(chatId, data.split(":")[2]);
      if (data === "cli:wiz:start") return wizardStart(chatId);

      if (data.startsWith("wiz:plat:")) {
        const parts = data.split(":");
        const platRaw = parts[2] || "";
        const clientId = parts[3] || null;

        const plat = normalizarPlataforma(platRaw);
        if (!esPlataformaValida(plat)) {
          return bot.sendMessage(chatId, `⚠️ Plataforma inválida en wizard: ${platRaw}`);
        }

        let st = wizard.get(String(chatId));
        if (!st) {
          st = {
            step: 4,
            clientId,
            nombre: "",
            telefono: "",
            vendedor: "",
            servicio: {},
            servStep: 1,
          };
        }

        st.clientId = clientId || st.clientId;
        st.servicio = st.servicio || {};
        st.servicio.plataforma = plat;
        st.servStep = 2;
        st.step = 4;

        wizard.set(String(chatId), st);
        return bot.sendMessage(
          chatId,
          `(Servicio 2/5) ${getIdentLabel(plat)} de la cuenta:`
        );
      }

      if (data.startsWith("wiz:addmore:")) {
        const clientId = data.split(":")[2];

        const nuevoState = {
          step: 4,
          clientId,
          nombre: "",
          telefono: "",
          vendedor: "",
          servicio: {},
          servStep: 1,
        };

        wizard.set(String(chatId), nuevoState);

        return bot.sendMessage(chatId, "📌 Agregar otro servicio\nSeleccione plataforma:", {
          reply_markup: {
            inline_keyboard: kbPlataformasWiz("wiz:plat", clientId),
          },
        });
      }

      if (data.startsWith("wiz:finish:")) {
        const clientId = data.split(":")[2];
        wizard.delete(String(chatId));
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:edit:menu:")) return menuEditarCliente(chatId, data.split(":")[3]);

      if (data.startsWith("cli:edit:nombre:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditNombre", clientId });
        return upsertPanel(
          chatId,
          "👤 *Editar nombre*\nEscriba el nuevo nombre:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:edit:tel:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditTel", clientId });
        return upsertPanel(
          chatId,
          "📱 *Editar teléfono*\nEscriba el nuevo teléfono:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:edit:vend:")) {
        const clientId = data.split(":")[3];
        pending.set(String(chatId), { mode: "cliEditVendedor", clientId });
        return upsertPanel(
          chatId,
          "🧑‍💼 *Editar vendedor*\nEscriba el nuevo vendedor:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:edit:menu:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:list:")) return menuListaServicios(chatId, data.split(":")[3]);
      if (data.startsWith("cli:serv:menu:")) return menuServicio(chatId, data.split(":")[3], Number(data.split(":")[4]));

      if (data.startsWith("cli:serv:add:")) {
        const clientId = data.split(":")[3];
        return upsertPanel(
          chatId,
          "➕ *AGREGAR SERVICIO*\nSeleccione plataforma:",
          {
            inline_keyboard: [
              ...kbPlataformasWiz("cli:add:plat", clientId),
              [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:add:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[3]);
        const clientId = parts[4];

        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

        pending.set(String(chatId), { mode: "cliAddServMail", clientId, plat });

        return upsertPanel(
          chatId,
          `${identIcon(plat)} *${getIdentLabel(plat)}* (${plat})\nEscriba el ${getIdentLabel(plat).toLowerCase()}:`,
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:edit:")) {
        const parts = data.split(":");
        const field = parts[3];
        const clientId = parts[4];
        const idx = Number(parts[5]);

        if (field === "plat") {
          return upsertPanel(
            chatId,
            "📌 *Cambiar plataforma*\nSeleccione:",
            {
              inline_keyboard: [
                ...kbPlataformasWiz("cli:serv:set:plat", clientId, idx),
                [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
              ],
            },
            "Markdown"
          );
        }

        let platActual = "";
        if (field === "mail") {
          const c = await getCliente(clientId);
          if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
          const servicios = Array.isArray(c.servicios) ? c.servicios : [];
          if (idx < 0 || idx >= servicios.length) return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
          platActual = normalizarPlataforma(servicios[idx]?.plataforma || "");
          pending.set(String(chatId), { mode: "cliServEditMail", clientId, idx, plat: platActual });
        }

        if (field === "pin") pending.set(String(chatId), { mode: "cliServEditPin", clientId, idx });
        if (field === "precio") pending.set(String(chatId), { mode: "cliServEditPrecio", clientId, idx });
        if (field === "fecha") pending.set(String(chatId), { mode: "cliServEditFecha", clientId, idx });

        const titulo =
          field === "mail"
            ? `${identIcon(platActual)} *Cambiar ${getIdentLabel(platActual).toLowerCase()}*`
            : field === "pin"
            ? "🔐 *Cambiar clave/pin*"
            : field === "precio"
            ? "💰 *Cambiar precio*"
            : "📅 *Cambiar fecha*";

        const hint =
          field === "mail"
            ? `Escriba el nuevo ${getIdentLabel(platActual).toLowerCase()}:`
            : field === "precio"
            ? "Escriba el precio (solo número):"
            : field === "fecha"
            ? "Escriba dd/mm/yyyy:"
            : "Escriba el nuevo valor:";

        return upsertPanel(
          chatId,
          `${titulo}\n${hint}`,
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }]] },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:set:plat:")) {
        const parts = data.split(":");
        const plat = normalizarPlataforma(parts[4]);
        const clientId = parts[5];
        const idx = Number(parts[6]);

        if (!esPlataformaValida(plat)) return bot.sendMessage(chatId, "⚠️ Plataforma inválida.");

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        servicios[idx] = { ...(servicios[idx] || {}), plataforma: plat };
        await ref.set(
          {
            servicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuServicio(chatId, clientId, idx);
      }

      if (data.startsWith("cli:serv:del:ask:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const idx = Number(parts[5]);

        return upsertPanel(
          chatId,
          "🗑️ *Eliminar perfil*\nConfirmar borrado de este servicio?",
          {
            inline_keyboard: [
              [{ text: "✅ Confirmar", callback_data: `cli:serv:del:ok:${clientId}:${idx}` }],
              [{ text: "⬅️ Cancelar", callback_data: `cli:serv:menu:${clientId}:${idx}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:serv:del:ok:")) {
        const parts = data.split(":");
        const clientId = parts[4];
        const idx = Number(parts[5]);

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        const servicioABorrar = servicios[idx];
        const plat = normalizarPlataforma(servicioABorrar.plataforma);
        const acceso = String(servicioABorrar.correo || "").trim().toLowerCase();
        const nombreCliente = c.nombrePerfil || "";

        const refInv = db.collection("inventario").doc(docIdInventario(acceso, plat));
        const docInv = await refInv.get();

        if (docInv.exists) {
          const invData = docInv.data() || {};
          let clientesInv = Array.isArray(invData.clientes) ? invData.clientes.slice() : [];

          const indexInv = clientesInv.findIndex(
            (cl) => cl.nombre === nombreCliente && cl.pin === servicioABorrar.pin
          );

          if (indexInv !== -1) {
            clientesInv.splice(indexInv, 1);
            clientesInv = clientesInv.map((cl, i) => ({ ...cl, slot: i + 1 }));

            const capacidad = Number(invData.capacidad || invData.total || 0);
            const ocupados = clientesInv.length;
            const disponibles = capacidad > 0
              ? Math.max(0, capacidad - ocupados)
              : Number(invData.disp || 0) + 1;
            const estado = disponibles === 0 ? "llena" : "activa";

            await refInv.set(
              {
                clientes: clientesInv,
                ocupados,
                disponibles,
                disp: disponibles,
                estado,
                capacidad,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }

        servicios.splice(idx, 1);
        await ref.set(
          {
            servicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (servicios.length) return menuListaServicios(chatId, clientId);
        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:ren:list:")) {
        const clientId = data.split(":")[3];
        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const servicios = serviciosConIndiceOriginal(Array.isArray(c.servicios) ? c.servicios : []);
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

        const kb = servicios.map((s, i) => [
          {
            text: safeBtnLabel(
              `🔄 ${i + 1}) ${s.plataforma} — ${s.correo} (Ren: ${s.fechaRenovacion || "-"})`,
              60
            ),
            callback_data: `cli:ren:menu:${clientId}:${s.idxOriginal}`,
          },
        ]);
        kb.push([{ text: "⬅️ Volver", callback_data: `cli:view:${clientId}` }]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

        return upsertPanel(
          chatId,
          "🔄 *RENOVAR SERVICIO*\nSeleccione cuál renovar:",
          { inline_keyboard: kb },
          "Markdown"
        );
      }

      if (data.startsWith("cli:ren:menu:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        const c = await getCliente(clientId);
        if (!c) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        const s = servicios[idx] || {};
        const texto =
          `🔄 *RENOVAR SERVICIO #${idx + 1}*\n` +
          `📌 ${escMD(s.plataforma || "-")}\n` +
          `${identIcon(s.plataforma || "")} ${escMD(s.correo || "-")}\n` +
          `📅 Actual: *${escMD(s.fechaRenovacion || "-")}*`;

        return upsertPanel(
          chatId,
          texto,
          {
            inline_keyboard: [
              [{ text: "➕ +30 días", callback_data: `cli:ren:+30:${clientId}:${idx}` }],
              [{ text: "📅 Poner fecha manual", callback_data: `cli:ren:fecha:${clientId}:${idx}` }],
              [{ text: "⬅️ Volver lista", callback_data: `cli:ren:list:${clientId}` }],
              [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:ren:+30:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (idx < 0 || idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        const actual = String(servicios[idx].fechaRenovacion || hoyDMY());
        const base = isFechaDMY(actual) ? actual : hoyDMY();
        const nueva = addDaysDMY(base, 30);

        servicios[idx] = { ...(servicios[idx] || {}), fechaRenovacion: nueva };
        await ref.set(
          {
            servicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuServicio(chatId, clientId, idx);
      }

      if (data.startsWith("cli:ren:all:ask:")) {
        const clientId = data.split(":")[4];
        return upsertPanel(
          chatId,
          "🔄 *Renovar todos +30 días*\n\n¿Desea renovar todos los servicios de este cliente?",
          {
            inline_keyboard: [
              [{ text: "✅ Confirmar", callback_data: `cli:ren:all:ok:${clientId}` }],
              [{ text: "⬅️ Cancelar", callback_data: `cli:view:${clientId}` }],
            ],
          },
          "Markdown"
        );
      }

      if (data.startsWith("cli:ren:all:ok:")) {
        const clientId = data.split(":")[4];

        const ref = db.collection("clientes").doc(String(clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (!servicios.length) return bot.sendMessage(chatId, "⚠️ Este cliente no tiene servicios.");

        const nuevos = servicios.map((s) => {
          const actual = String(s.fechaRenovacion || hoyDMY());
          const base = isFechaDMY(actual) ? actual : hoyDMY();
          return {
            ...s,
            fechaRenovacion: addDaysDMY(base, 30),
          };
        });

        await ref.set(
          {
            servicios: nuevos,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return enviarFichaCliente(chatId, clientId);
      }

      if (data.startsWith("cli:ren:fecha:")) {
        const parts = data.split(":");
        const clientId = parts[3];
        const idx = Number(parts[4]);

        pending.set(String(chatId), { mode: "cliRenovarFechaManual", clientId, idx });

        return upsertPanel(
          chatId,
          "📅 *Renovar (fecha manual)*\nEscriba la nueva fecha en formato dd/mm/yyyy:",
          { inline_keyboard: [[{ text: "⬅️ Cancelar", callback_data: `cli:ren:menu:${clientId}:${idx}` }]] },
          "Markdown"
        );
      }

      if (data === "txt:todos:hoy") {
        if (!(await isSuperAdmin(userId))) return bot.sendMessage(chatId, "⛔ Solo SUPERADMIN.");
        return enviarTXTATodosHoy(chatId);
      }
    }

    if (data === "ren:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      const texto = renovacionesTexto(list, fecha, adminOk ? null : vend?.nombre);
      return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
    }

    if (data === "txt:hoy") {
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, adminOk ? null : vend?.nombre);
      return enviarTXT(chatId, list, fecha, adminOk ? null : vend?.nombre);
    }

    if (data === "ren:mis") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      const texto = renovacionesTexto(list, fecha, vend.nombre);
      return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
    }

    if (data === "txt:mis") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const fecha = hoyDMY();
      const list = await obtenerRenovacionesPorFecha(fecha, vend.nombre);
      return enviarTXT(chatId, list, fecha, vend.nombre);
    }

    if (data === "vend:clientes") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const { enviarMisClientes } = require("./index_03_clientes_crm");
      return enviarMisClientes(chatId, vend.nombre);
    }

    if (data === "vend:clientes:txt") {
      if (!vendOk) return bot.sendMessage(chatId, "⚠️ No está vinculado a un vendedor.");
      const { enviarMisClientesTXT } = require("./index_03_clientes_crm");
      return enviarMisClientesTXT(chatId, vend.nombre);
    }

    if (data === "rev:lista") return listarRevendedores(chatId);

    return bot.sendMessage(chatId, "⚠️ Acción no reconocida.");
  } catch (err) {
    logErr("callback_query error:", err?.message || err);
    if (chatId) return bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
  }
});

// ===============================
// MESSAGE HANDLER
// ===============================
bot.on("message", async (msg) => {
  if (!hasRuntimeLock()) return;

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = msg.text || "";
  if (!chatId) return;

  try {
    if (!allowMsg(chatId, userId)) return;

    const adminOk = await isAdmin(userId);
    const vendOk = await isVendedor(userId);

    if (wizard.has(String(chatId)) && text.startsWith("/")) {
      const cmd = limpiarQuery(text).split(" ")[0];

      if (cmd !== "menu" && cmd !== "start") {
        return bot.sendMessage(
          chatId,
          "⚠️ Está en creación de cliente.\nPrimero toque *➕ Agregar otra* o *✅ Finalizar*.",
          { parse_mode: "Markdown" }
        );
      }
    }

    if (text.startsWith("/")) {
      if (!adminOk && !vendOk) return bot.sendMessage(chatId, "⛔ Acceso denegado");

      const cmd = limpiarQuery(text);
      const first = cmd.split(" ")[0];

      const vendedorCmd = new Set([
        "menu",
        "start",
        "miid",
        "id",
        "vincular_vendedor",
        "renovaciones",
        "txt",
      ]);

      if (!adminOk && vendOk && !vendedorCmd.has(first)) return;

      const comandosReservados = new Set([
        "start",
        "menu",
        "stock",
        "buscar",
        "cliente",
        "renovaciones",
        "txt",
        "clientes_txt",
        "vendedores_txt_split",
        "reindex_clientes",
        "fix_duplicados",
        "add",
        "del",
        "editclave",
        "adminadd",
        "admindel",
        "adminlist",
        "addvendedor",
        "delvendedor",
        "id",
        "miid",
        "vincular_vendedor",
        "sincronizar_todo",
        "addcorreo",
        "finanzas",
        "resumen_fecha",
        "bancos_mes",
        "top_plataformas_mes",
        "cierre_caja",
        "excel_finanzas",
        "editar_movimiento",
        ...PLATAFORMAS,
      ]);

      if (adminOk && !comandosReservados.has(first)) {
        const query = normalizeIdentByPlatform("", cmd.trim());

        const hits = await buscarInventarioPorCorreo(query);

        if (hits.length === 1) {
          pending.set(String(chatId), {
            mode: "invSubmenuCtx",
            plat: normalizarPlataforma(hits[0].plataforma),
            correo: query,
          });
          return enviarSubmenuInventario(chatId, hits[0].plataforma, query);
        }

        if (hits.length > 1) {
          const kb = hits.map((x) => [
            {
              text: `📌 ${String(x.plataforma).toUpperCase()}`,
              callback_data: `inv:open:${normalizarPlataforma(x.plataforma)}:${encodeURIComponent(query)}`,
            },
          ]);
          kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

          return bot.sendMessage(
            chatId,
            `🔎 *Coincidencias de inventario*\n\nAcceso: ${escMD(query)}\nSeleccione plataforma:`,
            {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: kb },
            }
          );
        }

        if (onlyDigits(query).length >= 7) {
          const resultados = await buscarPorTelefonoTodos(query);
          const dedup = dedupeClientes(resultados);
          if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
          if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);
          return enviarListaResultadosClientes(chatId, dedup);
        }

        const resultados = await buscarClienteRobusto(query);
        const dedup = dedupeClientes(resultados);

        if (!dedup.length) return bot.sendMessage(chatId, "⚠️ Sin resultados.");
        if (dedup.length === 1) return enviarFichaCliente(chatId, dedup[0].id);

        return enviarListaResultadosClientes(chatId, dedup);
      }

      return;
    }

    if (wizard.has(String(chatId))) {
      if (!(await isAdmin(userId))) return;
      return wizardNext(chatId, text);
    }

    if (pending.has(String(chatId))) {
      if (!(await isAdmin(userId))) return;

      const p = pending.get(String(chatId));
      const t = String(text || "").trim();

      // ✅ CORREGIDO: pedir fecha para eliminar y luego listar solo ese día
      if (p.mode === "finEliminarFechaAsk") {
        const parsed = parseFechaFinanceInput(t);

        if (!parsed.ok) {
          return bot.sendMessage(
            chatId,
            "⚠️ Fecha inválida. Use *dd/mm/yyyy*.\nEjemplo: *23/03/2026*",
            { parse_mode: "Markdown" }
          );
        }

        const fecha = parsed.fecha;
        const isSuper = await isSuperAdmin(userId);

        const listFecha = await getMovimientosPorFecha(fecha, userId, isSuper);
        const list = (Array.isArray(listFecha) ? listFecha : []).filter(
          (x) => String(x.tipo || "").toLowerCase() === String(p.tipo || "").toLowerCase()
        );

        pending.delete(String(chatId));

        if (!list.length) {
          return upsertPanel(
            chatId,
            `⚠️ No encontré *${p.tipo === "egreso" ? "egresos" : "ingresos"}* en la fecha *${escMD(fecha)}*.`,
            {
              inline_keyboard: [
                [
                  {
                    text: p.tipo === "egreso" ? "➖ Buscar otra fecha" : "➕ Buscar otra fecha",
                    callback_data:
                      p.tipo === "egreso"
                        ? "fin:menu:eliminar:egreso"
                        : "fin:menu:eliminar:ingreso",
                  },
                ],
                [{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }],
                [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
              ],
            },
            "Markdown"
          );
        }

        const kb = list.slice(0, 40).map((m) => [
          {
            text: textoBtnEliminarMovimiento(m),
            callback_data: `fin:del:pick:${m.id}`,
          },
        ]);

        kb.push([
          {
            text: p.tipo === "egreso" ? "➖ Buscar otra fecha" : "➕ Buscar otra fecha",
            callback_data:
              p.tipo === "egreso"
                ? "fin:menu:eliminar:egreso"
                : "fin:menu:eliminar:ingreso",
          },
        ]);
        kb.push([{ text: "⬅️ Volver eliminar", callback_data: "fin:menu:eliminar" }]);
        kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

        return upsertPanel(
          chatId,
          `🗑️ *${p.tipo === "egreso" ? "EGRESOS" : "INGRESOS"} DEL ${escMD(fecha)}*\n\nSeleccione el movimiento que desea borrar:`,
          { inline_keyboard: kb },
          "Markdown"
        );
      }

      if (p.mode === "finIngresoMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) {
          return bot.sendMessage(chatId, "⚠️ Monto inválido. Escriba solo número.");
        }

        pending.set(String(chatId), { mode: "finIngresoBancoPick", monto });
        return bot.sendMessage(chatId, "🏦 Seleccione el banco:", {
          reply_markup: kbBancosFinanzas(),
        });
      }

      if (p.mode === "finIngresoPlataformaManual") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la plataforma o plataformas manualmente.");

        pending.set(String(chatId), {
          mode: "finIngresoDetalle",
          monto: p.monto,
          banco: p.banco,
          plataforma: t,
        });

        return bot.sendMessage(chatId, "📝 Escriba el detalle del ingreso:");
      }

      if (p.mode === "finIngresoDetalle") {
        pending.set(String(chatId), {
          mode: "finIngresoFecha",
          monto: p.monto,
          banco: p.banco,
          plataforma: p.plataforma,
          detalle: t,
        });

        return bot.sendMessage(chatId, "📅 Escriba la fecha del ingreso en formato dd/mm/yyyy o escriba hoy:");
      }

      if (p.mode === "finIngresoFecha") {
        const parsed = parseFechaFinanceInput(t);
        if (!parsed.ok) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");

        pending.delete(String(chatId));
        const ok = await registrarIngresoTx({
          monto: p.monto,
          banco: p.banco,
          plataforma: p.plataforma,
          detalle: p.detalle || "",
          fecha: parsed.fecha,
          userId,
          userName: msg.from?.first_name || "",
        });

        return bot.sendMessage(
          chatId,
          `✅ *Ingreso registrado*\n\n💰 Monto: ${moneyLps(ok.monto)}\n🏦 Banco: ${escMD(ok.banco)}\n📦 Plataforma(s): ${escMD(ok.plataforma || "-")}\n📝 Detalle: ${escMD(ok.detalle || "-")}\n📅 Fecha: ${escMD(ok.fecha)}\n🆔 ID: \`${ok.id}\``,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➕ Registrar otro ingreso", callback_data: "fin:otro:ingreso" }],
                [{ text: "⬅️ Volver a Finanzas", callback_data: "menu:pagos" }],
                [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
              ],
            },
          }
        );
      }

      if (p.mode === "finEgresoMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) {
          return bot.sendMessage(chatId, "⚠️ Monto inválido. Escriba solo número.");
        }

        pending.set(String(chatId), { mode: "finEgresoMotivoPick", monto });
        return bot.sendMessage(chatId, "🧾 Seleccione el motivo del egreso:", {
          reply_markup: kbMotivosFinanzas(),
        });
      }

      if (p.mode === "finEgresoDetalle") {
        pending.set(String(chatId), {
          mode: "finEgresoFecha",
          monto: p.monto,
          motivo: p.motivo,
          detalle: t,
        });

        return bot.sendMessage(chatId, "📅 Escriba la fecha del egreso en formato dd/mm/yyyy o escriba hoy:");
      }

      if (p.mode === "finEgresoFecha") {
        const parsed = parseFechaFinanceInput(t);
        if (!parsed.ok) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");

        pending.delete(String(chatId));
        const ok = await registrarEgresoTx({
          monto: p.monto,
          motivo: p.motivo,
          detalle: p.detalle || "",
          fecha: parsed.fecha,
          userId,
          userName: msg.from?.first_name || "",
        });

        return bot.sendMessage(
          chatId,
          `✅ *Egreso registrado*\n\n💸 Monto: ${moneyLps(ok.monto)}\n🧾 Motivo: ${escMD(ok.motivo)}\n📝 Detalle: ${escMD(ok.detalle || "-")}\n📅 Fecha: ${escMD(ok.fecha)}\n🆔 ID: \`${ok.id}\``,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➕ Registrar otro egreso", callback_data: "fin:otro:egreso" }],
                [{ text: "⬅️ Volver a Finanzas", callback_data: "menu:pagos" }],
                [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
              ],
            },
          }
        );
      }

      if (p.mode === "finResumenFechaAsk") {
        const fecha = String(t || "").trim().toLowerCase() === "hoy" ? hoyDMY() : String(t || "").trim();
        if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");

        pending.delete(String(chatId));
        const list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));
        return bot.sendMessage(chatId, resumenFinanzasTextoPorFecha(fecha, list), {
          parse_mode: "Markdown",
        });
      }

      if (p.mode === "finResumenBancoMesAsk") {
        const key = parseMonthInputToKey(t);
        if (!key) return bot.sendMessage(chatId, "⚠️ Mes inválido. Use mm/yyyy");

        pending.delete(String(chatId));
        const list = await getMovimientosPorMes(key, userId, await isSuperAdmin(userId));
        return bot.sendMessage(chatId, resumenBancosMesTexto(key, list), {
          parse_mode: "Markdown",
        });
      }

      if (p.mode === "finTopPlataformasMesAsk") {
        const key = parseMonthInputToKey(t);
        if (!key) return bot.sendMessage(chatId, "⚠️ Mes inválido. Use mm/yyyy");

        pending.delete(String(chatId));
        const list = await getMovimientosPorMes(key, userId, await isSuperAdmin(userId));
        return bot.sendMessage(chatId, resumenTopPlataformasTexto(key, list), {
          parse_mode: "Markdown",
        });
      }

      if (p.mode === "finCierreCajaAsk") {
        const fecha = String(t || "").trim().toLowerCase() === "hoy" ? hoyDMY() : String(t || "").trim();
        if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy o escriba hoy.");

        pending.delete(String(chatId));
        const list = await getMovimientosPorFecha(fecha, userId, await isSuperAdmin(userId));
        return bot.sendMessage(chatId, cierreCajaTexto(fecha, list), {
          parse_mode: "Markdown",
        });
      }

      if (p.mode === "finExcelRangoInicio") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");

        pending.set(String(chatId), {
          mode: "finExcelRangoFin",
          fechaInicio: t,
        });

        return bot.sendMessage(chatId, "📅 Escriba la fecha final en formato dd/mm/yyyy:");
      }

      if (p.mode === "finExcelRangoFin") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");

        pending.delete(String(chatId));
        return exportarFinanzasRangoExcel(
          chatId,
          p.fechaInicio,
          t,
          userId,
          await isSuperAdmin(userId)
        );
      }

      if (p.mode === "finEditMonto") {
        const monto = parseMontoNumber(t);
        if (!Number.isFinite(monto) || monto <= 0) {
          return bot.sendMessage(chatId, "⚠️ Monto inválido.");
        }

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            monto: Number(monto),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Monto actualizado correctamente.");
      }

      if (p.mode === "finEditBanco") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el banco.");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            banco: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Banco actualizado correctamente.");
      }

      if (p.mode === "finEditMotivo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el motivo.");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            motivo: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Motivo actualizado correctamente.");
      }

      if (p.mode === "finEditPlataforma") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la plataforma.");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            plataforma: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Plataforma actualizada correctamente.");
      }

      if (p.mode === "finEditDetalle") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el detalle.");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            detalle: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Detalle actualizado correctamente.");
      }

      if (p.mode === "finEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Fecha inválida. Use dd/mm/yyyy");

        pending.delete(String(chatId));
        await db.collection(FINANZAS_COLLECTION).doc(String(p.id)).set(
          {
            fecha: t,
            fechaTS: parseDMYtoTS(t),
            mesKey: getMonthKeyFromDMY(t),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return bot.sendMessage(chatId, "✅ Fecha actualizada correctamente.");
      }

      if (p.mode === "mailAddClienteNombre") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nombre del cliente.");

        pending.set(String(chatId), {
          mode: "mailAddClientePin",
          plataforma: p.plataforma,
          correo: p.correo,
          nombre: t,
        });

        return bot.sendMessage(chatId, "🔐 Escriba el PIN del cliente:");
      }

      if (p.mode === "mailAddClientePin") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el PIN.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        let clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        const capacidad = getCapacidadCorreo(correoData, p.plataforma);
        const ocupadosActual = clientes.length;
        const disponiblesActual = Math.max(0, capacidad - ocupadosActual);

        if (disponiblesActual <= 0) {
          return bot.sendMessage(chatId, "❌ Esta cuenta ya está llena.");
        }

        clientes.push({
          nombre: p.nombre,
          pin: t,
          slot: clientes.length + 1,
        });

        const ocupados = clientes.length;
        const disponibles = Math.max(0, capacidad - ocupados);
        const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

        await ref.set(
          {
            clientes,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            capacidad,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(
          chatId,
          "✅ *Cliente agregado correctamente*\n\n" +
            `👤 *Nombre:* ${escMD(p.nombre)}\n` +
            `🔐 *PIN:* ${escMD(t)}\n\n` +
            `👤 *Ocupados:* ${ocupados}/${capacidad}\n` +
            `✅ *Disponibles:* ${disponibles}\n` +
            `📊 *Estado:* ${escMD(estado)}`,
          { parse_mode: "Markdown" }
        );

        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditPin") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba el nuevo PIN.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        const ref = found.ref;
        const correoData = found.data || {};
        const clientes = Array.isArray(correoData.clientes) ? correoData.clientes.slice() : [];

        if (p.clienteIndex < 0 || p.clienteIndex >= clientes.length) {
          return bot.sendMessage(chatId, "❌ Cliente inválido.");
        }

        clientes[p.clienteIndex] = {
          ...clientes[p.clienteIndex],
          pin: t,
        };

        await ref.set(
          {
            clientes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(chatId, "✅ PIN actualizado correctamente.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "mailEditClaveCorreo") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Escriba la nueva clave.");

        pending.delete(String(chatId));

        const found = await buscarCorreoInventarioPorPlatCorreo(p.plataforma, p.correo);
        if (!found) return bot.sendMessage(chatId, "❌ La cuenta no existe.");

        await found.ref.set(
          {
            clave: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await bot.sendMessage(chatId, "✅ Clave de la cuenta actualizada.");
        return mostrarPanelCorreo(chatId, p.plataforma, p.correo);
      }

      if (p.mode === "invSumarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) {
          return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");
        }

        pending.delete(String(chatId));

        const acceso = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(acceso, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");

        const d = doc.data() || {};
        const capacidad = Number(d.capacidad || d.total || getCapacidadCorreo(d, plat) || 0);
        const clientes = Array.isArray(d.clientes) ? d.clientes : [];
        const ocupados = clientes.length;
        const nuevaCapacidad = Math.max(capacidad, ocupados + qty);
        const disponibles = Math.max(0, nuevaCapacidad - ocupados);

        await ref.set(
          {
            capacidad: nuevaCapacidad,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo: acceso });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (p.mode === "invRestarQty") {
        const qty = Number(t);
        if (!Number.isFinite(qty) || qty <= 0) {
          return bot.sendMessage(chatId, "⚠️ Cantidad inválida. Escriba un número (ej: 1)");
        }

        pending.delete(String(chatId));

        const acceso = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(acceso, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");

        const d = doc.data() || {};
        const clientes = Array.isArray(d.clientes) ? d.clientes : [];
        const ocupados = clientes.length;
        const capacidadActual = Number(d.capacidad || d.total || getCapacidadCorreo(d, plat) || 0);
        const nuevaCapacidad = Math.max(ocupados, capacidadActual - qty);
        const disponibles = Math.max(0, nuevaCapacidad - ocupados);

        const antes = {
          ...d,
          disp: Math.max(0, capacidadActual - ocupados),
          capacidad: capacidadActual,
        };

        await ref.set(
          {
            capacidad: nuevaCapacidad,
            ocupados,
            disponibles,
            disp: disponibles,
            estado: disponibles === 0 ? "llena" : "activa",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        const despues = {
          ...d,
          disp: disponibles,
          plataforma: plat,
          correo: acceso,
          capacidad: nuevaCapacidad,
        };

        await aplicarAutoLleno(chatId, ref, antes, despues);

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo: acceso });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (p.mode === "invEditClave") {
        if (!t) return bot.sendMessage(chatId, "⚠️ Clave vacía.");

        pending.delete(String(chatId));

        const acceso = String(p.correo).toLowerCase();
        const plat = normalizarPlataforma(p.plat);

        const ref = db.collection("inventario").doc(docIdInventario(acceso, plat));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");

        await ref.set(
          {
            clave: t,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        pending.set(String(chatId), { mode: "invSubmenuCtx", plat, correo: acceso });
        return enviarSubmenuInventario(chatId, plat, acceso);
      }

      if (p.mode === "cliRenovarFechaManual") {
        const fecha = String(t || "").trim();
        if (!isFechaDMY(fecha)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");

        pending.delete(String(chatId));

        const ref = db.collection("clientes").doc(String(p.clientId));
        const doc = await ref.get();
        if (!doc.exists) return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");

        const c = doc.data() || {};
        const servicios = Array.isArray(c.servicios) ? c.servicios : [];
        if (p.idx < 0 || p.idx >= servicios.length) {
          return bot.sendMessage(chatId, "⚠️ Servicio inválido.");
        }

        servicios[p.idx] = { ...(servicios[p.idx] || {}), fechaRenovacion: fecha };
        await ref.set(
          {
            servicios,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliEditNombre") {
        const actual = await getCliente(p.clientId);
        if (!actual) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        }

        const dup = await clienteDuplicado(t, actual.telefono || "", p.clientId);
        if (dup) {
          return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        }

        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          {
            nombrePerfil: t,
            nombre_norm: String(t || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim()
              .replace(/\s+/g, " "),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditTel") {
        const actual = await getCliente(p.clientId);
        if (!actual) {
          pending.delete(String(chatId));
          return bot.sendMessage(chatId, "⚠️ Cliente no encontrado.");
        }

        const dup = await clienteDuplicado(actual.nombrePerfil || "", t, p.clientId);
        if (dup) {
          return bot.sendMessage(chatId, "⚠️ Ya existe otro cliente con ese mismo nombre y teléfono.");
        }

        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          {
            telefono: t,
            telefono_norm: onlyDigits(t),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliEditVendedor") {
        pending.delete(String(chatId));
        const ref = db.collection("clientes").doc(String(p.clientId));
        await ref.set(
          {
            vendedor: t,
            vendedor_norm: String(t || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim()
              .replace(/\s+/g, " "),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return menuEditarCliente(chatId, p.clientId);
      }

      if (p.mode === "cliAddServMail") {
        const label = getIdentLabel(p.plat);
        if (!validateIdentByPlatform(p.plat, t)) {
          return bot.sendMessage(chatId, `⚠️ ${label} inválido. Escriba el ${label.toLowerCase()}:`);
        }

        pending.set(String(chatId), {
          mode: "cliAddServPin",
          clientId: p.clientId,
          plat: p.plat,
          mail: normalizeIdentByPlatform(p.plat, t),
        });

        return bot.sendMessage(chatId, "🔐 Escriba la clave/pin:");
      }

      if (p.mode === "cliAddServPin") {
        pending.set(String(chatId), {
          mode: "cliAddServPrecio",
          clientId: p.clientId,
          plat: p.plat,
          mail: p.mail,
          pin: t,
        });

        return bot.sendMessage(chatId, "💰 Precio (solo número, Lps):");
      }

      if (p.mode === "cliAddServPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) {
          return bot.sendMessage(chatId, "⚠️ Precio inválido. Escriba solo número:");
        }

        pending.set(String(chatId), {
          mode: "cliAddServFecha",
          clientId: p.clientId,
          plat: p.plat,
          mail: p.mail,
          pin: p.pin,
          precio: n,
        });

        return bot.sendMessage(chatId, "📅 Fecha renovación (dd/mm/yyyy):");
      }

      if (p.mode === "cliAddServFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy:");

        pending.delete(String(chatId));

        await addServicioTx(String(p.clientId), {
          plataforma: p.plat,
          correo: p.mail,
          pin: p.pin,
          precio: p.precio,
          fechaRenovacion: t,
        });

        return enviarFichaCliente(chatId, p.clientId);
      }

      if (p.mode === "cliServEditMail") {
        const label = getIdentLabel(p.plat || "");
        if (!validateIdentByPlatform(p.plat || "", t)) {
          return bot.sendMessage(chatId, `⚠️ ${label} inválido.`);
        }

        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, {
          correo: normalizeIdentByPlatform(p.plat || "", t),
        });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPin") {
        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { pin: t });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditPrecio") {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "⚠️ Precio inválido.");

        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { precio: n });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      if (p.mode === "cliServEditFecha") {
        if (!isFechaDMY(t)) return bot.sendMessage(chatId, "⚠️ Formato inválido. Use dd/mm/yyyy");

        pending.delete(String(chatId));
        await patchServicio(p.clientId, p.idx, { fechaRenovacion: t });
        return menuServicio(chatId, p.clientId, p.idx);
      }

      return;
    }
  } catch (err) {
    logErr("message handler error:", err?.message || err);
    if (chatId) {
      try {
        await bot.sendMessage(chatId, "⚠️ Error interno (revise logs).");
      } catch (_) {}
    }
  }
});

// ===============================
// AUTO TXT 7AM
// ===============================
let _lastDailyRun = "";

async function getLastRunDB() {
  const ref = db.collection("config").doc("dailyRun");
  const doc = await ref.get();
  return doc.exists ? String(doc.data()?.lastRun || "") : "";
}

async function setLastRunDB(dmy) {
  const ref = db.collection("config").doc("dailyRun");
  await ref.set(
    {
      lastRun: String(dmy),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function getTimePartsNow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("es-HN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const obj = {};
  fmt.forEach((p) => {
    if (p.type !== "literal") obj[p.type] = p.value;
  });

  return {
    dmy: `${obj.day}/${obj.month}/${obj.year}`,
    hh: Number(obj.hour),
    mm: Number(obj.minute),
  };
}

async function enviarTxtRenovacionesDiariasPorVendedor() {
  if (!hasRuntimeLock()) return;

  const { dmy } = getTimePartsNow();

  const snap = await db.collection("revendedores").get();
  if (snap.empty) return;

  for (const doc of snap.docs) {
    const rev = normalizeRevendedorDoc(doc);

    if (!rev.activo || !rev.nombre || !rev.telegramId) continue;

    const list = await obtenerRenovacionesPorFecha(dmy, rev.nombre);
    await enviarTXT(rev.telegramId, list, dmy, rev.nombre);

    await doc.ref.set(
      {
        autoLastSent: dmy,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

setInterval(async () => {
  if (!hasRuntimeLock()) return;

  try {
    const { dmy, hh, mm } = getTimePartsNow();

    if (hh === 7 && mm === 0) {
      const dbLast = await getLastRunDB();
      if (_lastDailyRun === dmy || dbLast === dmy) return;

      _lastDailyRun = dmy;
      await setLastRunDB(dmy);
      await enviarTxtRenovacionesDiariasPorVendedor();

      console.log(`ℹ️ ✅ AutoTXT 7AM enviado (${dmy}) TZ=${TZ}`);
    }
  } catch (e) {
    logErr("AutoTXT error:", e?.message || e);
  }
}, 30 * 1000);

// ===============================
// HARDEN
// ===============================
process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
});

process.on("SIGINT", async () => {
  console.log("⚠️ SIGINT recibido, cerrando polling...");
  try {
    await hardStopBot().catch(() => {});
    await releaseRuntimeLock().catch(() => {});
  } catch (_) {}
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("⚠️ SIGTERM recibido, cerrando polling...");
  try {
    await hardStopBot().catch(() => {});
    await releaseRuntimeLock().catch(() => {});
  } catch (_) {}
  process.exit(0);
});

// ===============================
// HTTP KEEPALIVE FINAL
// ===============================
const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(getCoreHealth()));
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, () => {
    console.log("🌐 HTTP KEEPALIVE activo en puerto", PORT);
  });
