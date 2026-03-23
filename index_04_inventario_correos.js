/* ✅ SUBLICUENTAS TG BOT — PARTE 4/6
   INVENTARIO / CORREOS / PANEL CORREO / CÓDIGOS NETFLIX
   -----------------------------------------------------
*/

const { bot, admin, db, TZ, PAGE_SIZE, PLATAFORMAS } = require("./index_01_core");
const {
  normalizarPlataforma,
  esPlataformaValida,
  docIdInventario,
  fmtEstado,
  escMD,
  safeBtnLabel,
  logErr,
  upsertPanel,
  getTotalPorPlataforma,
} = require("./index_02_utils_roles");
const { humanPlataforma } = require("./index_03_clientes_crm");

// ===============================
// HELPERS INVENTARIO
// ===============================
async function buscarInventarioPorCorreo(correo) {
  const mail = String(correo || "").trim().toLowerCase();
  const snap = await db.collection("inventario").where("correo", "==", mail).limit(50).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function getCapacidadCorreo(data = {}, plataforma = "") {
  const desdeData = Number(data.capacidad || data.total || 0);
  if (Number.isFinite(desdeData) && desdeData > 0) return desdeData;

  const plat = normalizarPlataforma(plataforma);
  const mapa = {
    netflix: 5,
    vipnetflix: 1,
    disney: 6,
    disneyp: 6,
    disneyplus: 6,
    disneys: 3,
    max: 5,
    hbomax: 5,
    primevideo: 5,
    prime: 5,
    paramount: 5,
    vix: 4,
    crunchyroll: 5,
    spotify: 1,
    youtube: 1,
    canva: 1,
    appletv: 4,
    universal: 4,
    oleadatv1: 1,
    oleadatv3: 3,
    iptv1: 1,
    iptv3: 3,
    iptv4: 4,
  };

  return mapa[plat] || 1;
}

async function aplicarAutoLleno(chatId, ref, dataAntes, dataDespues) {
  const antes = Number(dataAntes?.disp ?? 0);
  const despues = Number(dataDespues?.disp ?? 0);

  if (despues <= 0) {
    await ref.set(
      {
        disp: 0,
        estado: "llena",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (antes > 0) {
      return bot.sendMessage(
        chatId,
        `🚨 *ALERTA STOCK*\n${String(dataDespues.plataforma).toUpperCase()} quedó en *0*.\n📧 ${dataDespues.correo}\n✅ Estado: *LLENA*`,
        { parse_mode: "Markdown" }
      );
    }
  }
}

async function inventarioPlataformaTexto(plataforma, page) {
  const p = normalizarPlataforma(plataforma);
  const totalDefault = await getTotalPorPlataforma(p);

  const snap = await db.collection("inventario").where("plataforma", "==", p).limit(500).get();

  const docs = snap.docs
    .map((d) => {
      const data = d.data() || {};
      const clientes = Array.isArray(data.clientes) ? data.clientes : [];
      const capacidad = Number(data.capacidad || data.total || totalDefault || getCapacidadCorreo(data, p) || 0);
      const ocupados = clientes.length;
      const disponibles = Math.max(0, capacidad - ocupados);
      const estado = disponibles === 0 ? "llena" : "activa";

      return {
        id: d.id,
        ...data,
        capacidad,
        ocupados,
        disp: disponibles,
        disponibles,
        estado,
      };
    })
    .filter((x) => Number(x.disp || 0) > 0)
    .sort((a, b) => {
      if (Number(b.disp || 0) !== Number(a.disp || 0)) {
        return Number(b.disp || 0) - Number(a.disp || 0);
      }
      return String(a.correo || "").localeCompare(String(b.correo || ""));
    });

  const totalItems = docs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, totalItems);
  const slice = docs.slice(start, end);

  let texto = `📌 *${p.toUpperCase()} — INVENTARIO DISPONIBLE*\n`;
  texto += `Mostrando ${totalItems === 0 ? 0 : start + 1}-${end} de ${totalItems}\n\n`;

  if (slice.length === 0) {
    texto += "⚠️ No hay correos con espacio disponible.\n";
  } else {
    let i = start + 1;
    for (const d of slice) {
      texto += `${i}) ${d.correo} — 🔑 ${d?.clave ? d.clave : "Sin clave"} — ${d.ocupados}/${d.capacidad} — ${fmtEstado(d.estado)}\n`;
      i++;
    }

    texto += "\n━━━━━━━━━━━━━━\n";
    texto += "📌 Para abrir correo: escriba /correo\n";
  }

  texto += `\n📄 Página: ${safePage + 1}/${totalPages}`;
  return { texto, safePage, totalPages };
}

async function enviarInventarioPlataforma(chatId, plataforma, page) {
  const p = normalizarPlataforma(plataforma);

  if (!esPlataformaValida(p)) {
    return upsertPanel(
      chatId,
      "⚠️ Plataforma inválida.",
      { inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]] },
      "Markdown"
    );
  }

  const { texto, safePage, totalPages } = await inventarioPlataformaTexto(p, page);
  const canBack = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return upsertPanel(
    chatId,
    texto,
    {
      inline_keyboard: [
        [
          { text: "⬅️ Atrás", callback_data: canBack ? `inv:${p}:${safePage - 1}` : "noop" },
          { text: "🏠 Inicio", callback_data: "go:inicio" },
          { text: "➡️ Siguiente", callback_data: canNext ? `inv:${p}:${safePage + 1}` : "noop" },
        ],
        [{ text: "🔄 Actualizar", callback_data: `inv:${p}:${safePage}` }],
        [{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }],
      ],
    },
    "Markdown"
  );
}

async function mostrarStockGeneral(chatId) {
  const lines = [];

  for (const p of PLATAFORMAS) {
    const snap = await db.collection("inventario").where("plataforma", "==", p).limit(500).get();
    let libres = 0;

    snap.forEach((d) => {
      const data = d.data() || {};
      const clientes = Array.isArray(data.clientes) ? data.clientes : [];
      const capacidad = Number(data.capacidad || data.total || getCapacidadCorreo(data, p) || 0);
      libres += Math.max(0, capacidad - clientes.length);
    });

    lines.push(`✅ *${humanPlataforma(p)}*: ${libres} libres`);
  }

  const texto = `📦 *STOCK GENERAL*\n\n${lines.join("\n")}`;
  return bot.sendMessage(chatId, texto, { parse_mode: "Markdown" });
}

async function enviarSubmenuInventario(chatId, plataforma, correo) {
  return mostrarPanelCorreo(chatId, plataforma, correo);
}

// ===============================
// CORREO / PANEL / CLIENTES EN CORREO
// ===============================
async function buscarCorreoInventarioPorPlatCorreo(plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  const directRef = db.collection("inventario").doc(docIdInventario(mail, plat));
  const directSnap = await directRef.get();

  if (directSnap.exists) {
    return {
      id: directSnap.id,
      ref: directRef,
      data: directSnap.data() || {},
    };
  }

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", plat)
    .where("correo", "==", mail)
    .limit(1)
    .get();

  if (!snap.empty) {
    const d = snap.docs[0];
    return {
      id: d.id,
      ref: d.ref,
      data: d.data() || {},
    };
  }

  return null;
}

async function mostrarListaCorreosPlataforma(chatId, plataforma) {
  const plat = normalizarPlataforma(plataforma);

  const snap = await db.collection("inventario").where("plataforma", "==", plat).limit(500).get();

  if (snap.empty) {
    return upsertPanel(
      chatId,
      `📭 *${escMD(String(plat).toUpperCase())}*\n\nNo hay correos registrados en esta plataforma.`,
      {
        inline_keyboard: [[{ text: "🏠 Inicio", callback_data: "go:inicio" }]],
      },
      "Markdown"
    );
  }

  const docs = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() || {}),
  }));

  docs.sort((a, b) => {
    const aCorreo = String(a.correo || "").toLowerCase();
    const bCorreo = String(b.correo || "").toLowerCase();
    return aCorreo.localeCompare(bCorreo);
  });

  let txt = `📂 *${escMD(String(plat).toUpperCase())}*\n\n`;
  txt += "Seleccione un correo:\n";

  const kb = docs.map((item) => {
    const clientes = Array.isArray(item.clientes) ? item.clientes : [];
    const capacidad = getCapacidadCorreo(item, plat);
    const ocupados = clientes.length;
    const disponibles = Math.max(0, capacidad - ocupados);
    const estado = disponibles === 0 ? "LLENA" : "CON ESPACIO";

    return [
      {
        text: safeBtnLabel(`${item.correo || "correo"} | ${ocupados}/${capacidad} | ${estado}`, 60),
        callback_data: `mail_panel|${plat}|${encodeURIComponent(item.correo || "")}`,
      },
    ];
  });

  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

async function mostrarMenuClientesCorreo(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  return upsertPanel(
    chatId,
    "👥 *CLIENTES*\n\nSeleccione una opción:",
    {
      inline_keyboard: [
        [{ text: "👥 Ver clientes", callback_data: `mail_ver_clientes|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "➕ Agregar cliente", callback_data: `mail_add_cliente|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "➖ Quitar cliente", callback_data: `mail_del_cliente|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🔐 Editar PIN", callback_data: `mail_edit_pin|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "✏️ Editar clave del correo", callback_data: `mail_edit_clave|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "⬅️ Volver al correo", callback_data: `mail_panel|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

async function mostrarMenuCodigosNetflix(chatId, plataforma, correo) {
  return responderMenuCodigosNetflix(chatId, plataforma, correo);
}

async function mostrarPanelCorreo(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  const found = await buscarCorreoInventarioPorPlatCorreo(plat, mail);
  if (!found) {
    return bot.sendMessage(chatId, "❌ Este correo no existe.");
  }

  const data = found.data || {};
  const clientes = Array.isArray(data.clientes) ? data.clientes : [];
  const capacidad = getCapacidadCorreo(data, plat);

  const ocupados = clientes.length;
  const disponibles = Math.max(0, capacidad - ocupados);
  const estadoDb = disponibles === 0 ? "llena" : "activa";
  const estadoView = disponibles === 0 ? "LLENA" : "CON ESPACIO";

  if (
    Number(data.disp || 0) !== disponibles ||
    String(data.estado || "") !== estadoDb ||
    Number(data.ocupados || 0) !== ocupados ||
    Number(data.disponibles || 0) !== disponibles ||
    Number(data.capacidad || 0) !== capacidad
  ) {
    await found.ref.set(
      {
        ocupados,
        disponibles,
        disp: disponibles,
        estado: estadoDb,
        capacidad,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  let txt = "";
  txt += `📧 *${escMD(mail)}*\n`;
  txt += `${escMD(String(plat).toUpperCase())}\n\n`;
  txt += `👤 *Ocupados:* ${ocupados}/${capacidad}\n`;
  txt += `✅ *Disponibles:* ${disponibles}\n`;
  txt += `📊 *Estado:* ${escMD(estadoView)}`;

  const kb = [
    [{ text: "👥 CLIENTES", callback_data: `mail_menu_clientes|${plat}|${encodeURIComponent(mail)}` }],
  ];

  if (plat === "netflix" || plat === "vipnetflix") {
    kb.push([{ text: "🎬 CÓDIGOS NETFLIX", callback_data: `mail_menu_codigos|${plat}|${encodeURIComponent(mail)}` }]);
  }

  kb.push([{ text: "🗑️ Borrar correo", callback_data: `mail_delete|${plat}|${encodeURIComponent(mail)}` }]);
  kb.push([{ text: "⬅️ Volver Inventario", callback_data: `inv:${plat}:0` }]);
  kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

  return upsertPanel(chatId, txt, { inline_keyboard: kb }, "Markdown");
}

// ===============================
// HELPERS CÓDIGOS NETFLIX
// ===============================
function tsToMillisNetflix(v) {
  try {
    if (!v) return 0;
    if (typeof v?.toDate === "function") return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch (_) {
    return 0;
  }
}

async function obtenerUltimoCodigoNetflix(correo, tipo) {
  const mail = String(correo || "").trim().toLowerCase();
  if (!mail || !tipo) return null;

  let snap = null;

  try {
    snap = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .where("tipo", "==", tipo)
      .orderBy("fecha", "desc")
      .limit(1)
      .get();
  } catch (_) {
    const alt = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .where("tipo", "==", tipo)
      .limit(50)
      .get();

    const docs = alt.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => {
        const fa = tsToMillisNetflix(a.fecha || a.createdAt || a.updatedAt);
        const fb = tsToMillisNetflix(b.fecha || b.createdAt || b.updatedAt);
        return fb - fa;
      });

    return docs.length ? docs[0] : null;
  }

  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() || {}) };
}

async function obtenerUltimoCodigoNetflixGeneral(correo) {
  const mail = String(correo || "").trim().toLowerCase();
  if (!mail) return null;

  let snap = null;

  try {
    snap = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .orderBy("fecha", "desc")
      .limit(1)
      .get();
  } catch (_) {
    const alt = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .limit(50)
      .get();

    const docs = alt.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => {
        const fa = tsToMillisNetflix(a.fecha || a.createdAt || a.updatedAt);
        const fb = tsToMillisNetflix(b.fecha || b.createdAt || b.updatedAt);
        return fb - fa;
      });

    return docs.length ? docs[0] : null;
  }

  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() || {}) };
}

function labelTipoCodigoNetflix(tipo = "") {
  const t = String(tipo || "").toLowerCase();
  if (t === "signin") return "🔐 Inicio sesión";
  if (t === "temporal") return "⏳ Código temporal";
  if (t === "hogar") return "🏠 Código hogar";
  if (t === "verification") return "✅ Verificación";
  return "📩 Código";
}

function fmtFechaCodigoNetflix(fecha) {
  if (!fecha) return "-";

  try {
    let dt = null;

    if (typeof fecha?.toDate === "function") {
      dt = fecha.toDate();
    } else if (fecha instanceof Date) {
      dt = fecha;
    } else {
      dt = new Date(fecha);
    }

    if (isNaN(dt.getTime())) return String(fecha);

    return new Intl.DateTimeFormat("es-HN", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(dt);
  } catch (_) {
    return String(fecha);
  }
}

async function marcarCodigoNetflixUsado(docId) {
  if (!docId) return;
  try {
    await db.collection("codigos_netflix").doc(String(docId)).set(
      {
        usado: true,
        usadoAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    logErr("Error marcando codigo usado:", e?.message || e);
  }
}

async function responderCodigoNetflix(chatId, correo, tipo) {
  const mail = String(correo || "").trim().toLowerCase();

  let data = null;
  if (tipo === "ultimo") {
    data = await obtenerUltimoCodigoNetflixGeneral(mail);
  } else {
    data = await obtenerUltimoCodigoNetflix(mail, tipo);
  }

  if (!data) {
    return bot.sendMessage(
      chatId,
      `🎬 *CÓDIGOS NETFLIX*\n\n📧 *${escMD(mail)}*\n🧩 *Tipo:* ${escMD(
        tipo === "ultimo" ? "último disponible" : tipo
      )}\n\n⚠️ No encontré códigos disponibles.`,
      { parse_mode: "Markdown" }
    );
  }

  const tipoReal = String(data.tipo || tipo || "ultimo").toLowerCase();
  const codigo = String(data.codigo || "").trim();
  const fuente = String(data.fuente || "-").trim();
  const fechaFmt = fmtFechaCodigoNetflix(data.fecha || data.createdAt || data.updatedAt);
  const usado = data.usado === true ? "Sí" : "No";

  let txt = "🎬 *CÓDIGOS NETFLIX*\n\n";
  txt += `📧 *${escMD(mail)}*\n`;
  txt += `🧩 *Tipo:* ${escMD(labelTipoCodigoNetflix(tipoReal))}\n`;
  txt += `🔢 *Código:* \`${codigo || "-"}\`\n`;
  txt += `🕒 *Fecha:* ${escMD(fechaFmt)}\n`;
  txt += `📥 *Fuente:* ${escMD(fuente || "-")}\n`;
  txt += `✅ *Usado:* ${escMD(usado)}`;

  await bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });

  if (data.id) {
    await marcarCodigoNetflixUsado(data.id);
  }
}

async function responderMenuCodigosNetflix(chatId, plataforma, correo) {
  const plat = normalizarPlataforma(plataforma);
  const mail = String(correo || "").trim().toLowerCase();

  if (plat !== "netflix" && plat !== "vipnetflix") {
    return bot.sendMessage(chatId, "⚠️ Este menú de códigos solo aplica para Netflix.");
  }

  return upsertPanel(
    chatId,
    "🎬 *CÓDIGOS NETFLIX*\n\nSeleccione una opción:",
    {
      inline_keyboard: [
        [{ text: "📩 Último código", callback_data: `nf_code|ultimo|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "🔐 Inicio sesión", callback_data: `nf_code|signin|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "⏳ Código temporal", callback_data: `nf_code|temporal|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "🏠 Código hogar", callback_data: `nf_code|hogar|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "✅ Verificación", callback_data: `nf_code|verification|${encodeURIComponent(mail)}|${plat}` }],
        [{ text: "⬅️ Volver al correo", callback_data: `mail_panel|${plat}|${encodeURIComponent(mail)}` }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ],
    },
    "Markdown"
  );
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  buscarInventarioPorCorreo,
  getCapacidadCorreo,
  aplicarAutoLleno,
  inventarioPlataformaTexto,
  enviarInventarioPlataforma,
  mostrarStockGeneral,
  enviarSubmenuInventario,

  buscarCorreoInventarioPorPlatCorreo,
  mostrarListaCorreosPlataforma,
  mostrarMenuClientesCorreo,
  mostrarMenuCodigosNetflix,
  mostrarPanelCorreo,

  tsToMillisNetflix,
  obtenerUltimoCodigoNetflix,
  obtenerUltimoCodigoNetflixGeneral,
  labelTipoCodigoNetflix,
  fmtFechaCodigoNetflix,
  marcarCodigoNetflixUsado,
  responderCodigoNetflix,
  responderMenuCodigosNetflix,
};
