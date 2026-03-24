/* ✅ SUBLICUENTAS TG BOT — PARTE 4/6 CORREGIDA Y COMPATIBLE
   INVENTARIO / CUENTAS / PANEL POR CORREO-USUARIO
   -----------------------------------------------
   Compatible con index_05_finanzas_menus_2filas y index_06_handlers_columna_corregido
*/

const {
  bot,
  admin,
  db,
  PLATAFORMAS,
} = require("./index_01_core");

const {
  escMD,
  upsertPanel,
  normalizarPlataforma,
  isEmailLike,
  logErr,
} = require("./index_02_utils_roles");

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

function humanPlatSafe(key = "") {
  const k = String(key || "").trim().toLowerCase();
  const labels = {
    netflix: "Netflix",
    vipnetflix: "Netflix VIP",
    disneyp: "Disney Premium",
    disneys: "Disney Standard",
    hbomax: "HBO Max",
    primevideo: "Prime Video",
    paramount: "Paramount+",
    crunchyroll: "Crunchyroll",
    vix: "Vix",
    appletv: "Apple TV",
    universal: "Universal+",
    spotify: "Spotify",
    youtube: "YouTube",
    deezer: "Deezer",
    oleadatv1: "Oleada 1",
    oleadatv3: "Oleada 3",
    iptv1: "IPTV 1",
    iptv3: "IPTV 3",
    iptv4: "IPTV 4",
    canva: "Canva",
    gemini: "Gemini",
    chatgpt: "ChatGPT",
  };
  return labels[k] || platMeta(k)?.nombre || k;
}

function isUserPlatform(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  return ["oleadatv1", "oleadatv3", "iptv1", "iptv3", "iptv4"].includes(p);
}

function isNetflixPlatform(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  return p === "netflix" || p === "vipnetflix";
}

function getIdentLabel(plataforma = "") {
  return isUserPlatform(plataforma) ? "Usuario" : "Correo";
}

function getIdentIcon(plataforma = "") {
  return isUserPlatform(plataforma) ? "👤" : "📧";
}

function getAccessTypeLabel(plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  if (p === "canva") return "Solo correo";
  if (isUserPlatform(p)) return "Usuario + clave";
  return "Correo + clave";
}

function normalizeAccess(plataforma = "", acceso = "") {
  const p = normalizarPlataforma(plataforma);
  const v = String(acceso || "").trim();
  if (isUserPlatform(p)) return v;
  return v.toLowerCase();
}

function docIdInventario(acceso = "", plataforma = "") {
  const p = normalizarPlataforma(plataforma);
  const a = normalizeAccess(p, acceso)
    .toLowerCase()
    .replace(/[.#$/\[\]\s]+/g, "_");
  return `${p}__${a}`;
}

function getCapacidadCorreo(data = {}, plataforma = "") {
  const p = normalizarPlataforma(plataforma || data.plataforma || "");
  const defaults = {
    netflix: 5,
    vipnetflix: 1,
    disneyp: 6,
    disneys: 5,
    hbomax: 5,
    primevideo: 5,
    paramount: 5,
    crunchyroll: 5,
    vix: 4,
    appletv: 4,
    universal: 4,
    spotify: 1,
    youtube: 1,
    deezer: 1,
    oleadatv1: 1,
    oleadatv3: 3,
    iptv1: 1,
    iptv3: 3,
    iptv4: 4,
    canva: 1,
    gemini: 1,
    chatgpt: 1,
  };

  const n = Number(data.capacidad || data.total || 0);
  if (Number.isFinite(n) && n > 0) return n;
  return defaults[p] || 1;
}

function getClientesArray(data = {}) {
  return Array.isArray(data.clientes) ? data.clientes : [];
}

function getOcupados(data = {}) {
  const n = Number(data.ocupados);
  if (Number.isFinite(n) && n >= 0) return n;
  return getClientesArray(data).length;
}

function getDisponibles(data = {}, plataforma = "") {
  const n = Number(data.disponibles ?? data.disp);
  if (Number.isFinite(n) && n >= 0) return n;
  const capacidad = getCapacidadCorreo(data, plataforma);
  const ocupados = getOcupados(data);
  return Math.max(0, capacidad - ocupados);
}

function getEstado(data = {}, plataforma = "") {
  const disp = getDisponibles(data, plataforma);
  return disp <= 0 ? "llena" : "activa";
}

function boolHasCodes(data = {}) {
  const keys = [
    "codigo", "code", "codigo_hogar", "hogarCode", "hogar_code",
    "codigo_temporal", "tempCode", "pin_hogar", "pin_temporal",
  ];
  return keys.some((k) => data[k]);
}

function formatCuentaResumen(data = {}, plataforma = "") {
  const capacidad = getCapacidadCorreo(data, plataforma);
  const ocupados = getOcupados(data);
  const disponibles = getDisponibles(data, plataforma);
  const estado = getEstado(data, plataforma) === "llena" ? "🔴 LLENA" : "🟢 ACTIVA";
  return { capacidad, ocupados, disponibles, estado };
}

function normalizeLooseText(txt = "") {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pairButtons(buttons = []) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return rows;
}

function scoreMatch(value = "", query = "") {
  const v = normalizeLooseText(value);
  const q = normalizeLooseText(query);
  if (!v || !q) return 0;
  if (v === q) return 100;
  if (v.startsWith(q)) return 80;
  if (v.includes(q)) return 50;
  return 0;
}

// ===============================
// BÚSQUEDAS INVENTARIO
// ===============================
async function buscarInventarioPorCorreo(query = "") {
  const q = String(query || "").trim();
  if (!q) return [];

  try {
    const snap = await db.collection("inventario").get();
    const out = [];

    snap.forEach((doc) => {
      const data = doc.data() || {};
      const plat = normalizarPlataforma(data.plataforma || "");
      const acceso = String(data.correo || data.usuario || "");
      const clave = String(data.clave || "");
      const nombrePlat = humanPlatSafe(plat);

      let score = 0;
      score = Math.max(score, scoreMatch(acceso, q));
      score = Math.max(score, scoreMatch(clave, q));
      score = Math.max(score, scoreMatch(nombrePlat, q));
      score = Math.max(score, scoreMatch(plat, q));

      if (score > 0) {
        out.push({
          id: doc.id,
          ...data,
          plataforma: plat,
          _score: score,
        });
      }
    });

    out.sort((a, b) => {
      if ((b._score || 0) !== (a._score || 0)) return (b._score || 0) - (a._score || 0);
      const da = getDisponibles(a, a.plataforma);
      const dbb = getDisponibles(b, b.plataforma);
      if (dbb !== da) return dbb - da;
      return String(a.correo || "").localeCompare(String(b.correo || ""), "es", { sensitivity: "base" });
    });

    return out.slice(0, 30);
  } catch (e) {
    logErr("buscarInventarioPorCorreo", e);
    return [];
  }
}

async function buscarCorreoInventarioPorPlatCorreo(plataforma = "", acceso = "") {
  const plat = normalizarPlataforma(plataforma);
  const ident = String(acceso || "").trim();
  if (!plat || !ident) return null;

  try {
    const id = docIdInventario(ident, plat);
    const byId = await db.collection("inventario").doc(id).get();
    if (byId.exists) {
      return { id: byId.id, ref: byId.ref, data: byId.data() || {} };
    }

    const snap = await db.collection("inventario").where("plataforma", "==", plat).get();
    const exactNorm = normalizeAccess(plat, ident);
    let partial = null;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const stored = normalizeAccess(plat, data.correo || data.usuario || "");
      if (stored === exactNorm) {
        return { id: doc.id, ref: doc.ref, data };
      }
      if (!partial && stored.includes(normalizeLooseText(exactNorm))) {
        partial = { id: doc.id, ref: doc.ref, data };
      }
    }

    return partial;
  } catch (e) {
    logErr("buscarCorreoInventarioPorPlatCorreo", e);
    return null;
  }
}

// ===============================
// VISTAS INVENTARIO
// ===============================
async function enviarInventarioPlataforma(chatId, plataforma = "", page = 0) {
  const plat = normalizarPlataforma(plataforma);
  const pageSize = 10;

  try {
    const snap = await db.collection("inventario").where("plataforma", "==", plat).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    rows.sort((a, b) => {
      const da = getDisponibles(a, plat);
      const dbb = getDisponibles(b, plat);
      if (dbb !== da) return dbb - da;
      return String(a.correo || "").localeCompare(String(b.correo || ""), "es", { sensitivity: "base" });
    });

    if (!rows.length) {
      return upsertPanel(
        chatId,
        `📦 *${escMD(humanPlatSafe(plat).toUpperCase())}*\n\n_No hay cuentas en inventario para esta plataforma._`,
        [
          [{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }],
          [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
        ]
      );
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.max(0, Math.min(Number(page || 0), totalPages - 1));
    const start = safePage * pageSize;
    const slice = rows.slice(start, start + pageSize);

    let txt = `📦 *${escMD(humanPlatSafe(plat).toUpperCase())}*\n`;
    txt += `Página *${safePage + 1}/${totalPages}*\n\n`;

    slice.forEach((r, idx) => {
      const ident = String(r.correo || "");
      const { capacidad, ocupados, disponibles, estado } = formatCuentaResumen(r, plat);
      txt += `*${start + idx + 1}.* ${getIdentIcon(plat)} ${escMD(ident)}\n`;
      txt += `   👥 ${ocupados}/${capacidad} • ✅ ${disponibles} • ${estado}\n`;
      if (r.clave) txt += `   🔑 ${escMD(String(r.clave))}\n`;
    });

    const kb = slice.map((r) => [
      {
        text: `${getIdentIcon(plat)} ${String(r.correo || "")} • ${getDisponibles(r, plat)}/${getCapacidadCorreo(r, plat)}`,
        callback_data: `inv:open:${plat}:${encodeURIComponent(String(r.correo || ""))}`,
      },
    ]);

    const nav = [];
    if (safePage > 0) nav.push({ text: "⬅️ Anterior", callback_data: `inv:${plat}:${safePage - 1}` });
    if (safePage < totalPages - 1) nav.push({ text: "Siguiente ➡️", callback_data: `inv:${plat}:${safePage + 1}` });
    if (nav.length) kb.push(nav);

    kb.push([{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }]);
    kb.push([{ text: "🏠 Inicio", callback_data: "go:inicio" }]);

    return upsertPanel(chatId, txt, kb);
  } catch (e) {
    logErr("enviarInventarioPlataforma", e);
    return bot.sendMessage(chatId, "⚠️ Error al abrir inventario de esa plataforma.");
  }
}

async function mostrarListaCorreosPlataforma(chatId, plataforma = "") {
  return enviarInventarioPlataforma(chatId, plataforma, 0);
}

async function mostrarStockGeneral(chatId) {
  try {
    const snap = await db.collection("inventario").get();
    const map = {};

    snap.forEach((doc) => {
      const data = doc.data() || {};
      const plat = normalizarPlataforma(data.plataforma || "");
      if (!plat) return;
      if (!map[plat]) {
        map[plat] = {
          cuentas: 0,
          capacidad: 0,
          ocupados: 0,
          disponibles: 0,
        };
      }
      map[plat].cuentas += 1;
      map[plat].capacidad += getCapacidadCorreo(data, plat);
      map[plat].ocupados += getOcupados(data);
      map[plat].disponibles += getDisponibles(data, plat);
    });

    const keys = Object.keys(map).sort((a, b) => {
      return humanPlatSafe(a).localeCompare(humanPlatSafe(b), "es", { sensitivity: "base" });
    });

    let txt = "📊 *STOCK GENERAL*\n\n";
    if (!keys.length) {
      txt += "_No hay cuentas cargadas en inventario._";
    } else {
      for (const k of keys) {
        const x = map[k];
        txt += `*${escMD(humanPlatSafe(k))}*\n`;
        txt += `   📦 Cuentas: ${x.cuentas}\n`;
        txt += `   👥 Ocupados: ${x.ocupados}/${x.capacidad}\n`;
        txt += `   ✅ Disponibles: ${x.disponibles}\n\n`;
      }
    }

    return upsertPanel(
      chatId,
      txt,
      [
        [{ text: "⬅️ Volver Inventario", callback_data: "menu:inventario" }],
        [{ text: "🏠 Inicio", callback_data: "go:inicio" }],
      ]
    );
  } catch (e) {
    logErr("mostrarStockGeneral", e);
    return bot.sendMessage(chatId, "⚠️ Error al generar stock general.");
  }
}

async function mostrarPanelCorreo(chatId, plataforma = "", acceso = "") {
  const plat = normalizarPlataforma(plataforma);
  const found = await buscarCorreoInventarioPorPlatCorreo(plat, acceso);
  if (!found) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");

  const data = found.data || {};
  const ident = String(data.correo || acceso || "");
  const clave = String(data.clave || "Sin clave");
  const { capacidad, ocupados, disponibles, estado } = formatCuentaResumen(data, plat);

  let txt = `📦 *PANEL DE CUENTA*\n\n`;
  txt += `📌 *Plataforma:* ${escMD(humanPlatSafe(plat))}\n`;
  txt += `${getIdentIcon(plat)} *${escMD(getIdentLabel(plat))}:* ${escMD(ident)}\n`;
  txt += `🔐 *Tipo:* ${escMD(getAccessTypeLabel(plat))}\n`;
  txt += `🔑 *Clave:* ${escMD(clave)}\n`;
  txt += `👥 *Ocupados:* ${ocupados}/${capacidad}\n`;
  txt += `✅ *Disponibles:* ${disponibles}\n`;
  txt += `📊 *Estado:* ${escMD(estado)}\n`;

  if (isNetflixPlatform(plat) && boolHasCodes(data)) {
    txt += `\n💡 Esta cuenta tiene datos/códigos de Netflix disponibles.`;
  }

  const kb = [
    [{ text: "👥 Menú clientes", callback_data: `mail_menu_clientes|${plat}|${encodeURIComponent(ident)}` }],
    [{ text: "👥 Ver clientes", callback_data: `mail_ver_clientes|${plat}|${encodeURIComponent(ident)}` }],
  ];

  if (isNetflixPlatform(plat) && boolHasCodes(data)) {
    kb.push([{ text: "🔑 Ver códigos Netflix", callback_data: `mail_menu_codigos|${plat}|${encodeURIComponent(ident)}` }]);
  }

  kb.push([
    { text: "✏️ Editar clave", callback_data: `mail_edit_clave|${plat}|${encodeURIComponent(ident)}` },
    { text: "🗑️ Borrar cuenta", callback_data: `mail_delete|${plat}|${encodeURIComponent(ident)}` },
  ]);

  kb.push([
    { text: "⬅️ Volver plataforma", callback_data: `inv:${plat}:0` },
    { text: "🏠 Inicio", callback_data: "go:inicio" },
  ]);

  return upsertPanel(chatId, txt, kb);
}

async function enviarSubmenuInventario(chatId, plataforma = "", acceso = "") {
  return mostrarPanelCorreo(chatId, plataforma, acceso);
}

async function mostrarMenuClientesCorreo(chatId, plataforma = "", acceso = "") {
  const plat = normalizarPlataforma(plataforma);
  const found = await buscarCorreoInventarioPorPlatCorreo(plat, acceso);
  if (!found) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");

  const data = found.data || {};
  const ident = String(data.correo || acceso || "");
  const { capacidad, ocupados, disponibles, estado } = formatCuentaResumen(data, plat);

  const txt =
    `👥 *CLIENTES DE LA CUENTA*\n\n` +
    `📌 *Plataforma:* ${escMD(humanPlatSafe(plat))}\n` +
    `${getIdentIcon(plat)} *${escMD(getIdentLabel(plat))}:* ${escMD(ident)}\n` +
    `👥 *Ocupados:* ${ocupados}/${capacidad}\n` +
    `✅ *Disponibles:* ${disponibles}\n` +
    `📊 *Estado:* ${escMD(estado)}\n\n` +
    `Seleccione una acción:`;

  return upsertPanel(
    chatId,
    txt,
    [
      [
        { text: "➕ Agregar cliente", callback_data: `mail_add_cliente|${plat}|${encodeURIComponent(ident)}` },
        { text: "➖ Quitar cliente", callback_data: `mail_del_cliente|${plat}|${encodeURIComponent(ident)}` },
      ],
      [
        { text: "🔐 Editar PIN cliente", callback_data: `mail_edit_pin|${plat}|${encodeURIComponent(ident)}` },
        { text: "👥 Ver clientes", callback_data: `mail_ver_clientes|${plat}|${encodeURIComponent(ident)}` },
      ],
      [
        { text: "⬅️ Volver cuenta", callback_data: `mail_panel|${plat}|${encodeURIComponent(ident)}` },
        { text: "🏠 Inicio", callback_data: "go:inicio" },
      ],
    ]
  );
}

// ===============================
// NETFLIX CÓDIGOS
// ===============================
async function responderMenuCodigosNetflix(chatId, plataforma = "", acceso = "") {
  const plat = normalizarPlataforma(plataforma);
  const found = await buscarCorreoInventarioPorPlatCorreo(plat, acceso);
  if (!found) return bot.sendMessage(chatId, "⚠️ Esa cuenta no existe en inventario.");

  const data = found.data || {};
  const ident = String(data.correo || acceso || "");

  const txt =
    `🔑 *CÓDIGOS / DATOS NETFLIX*\n\n` +
    `📌 *Plataforma:* ${escMD(humanPlatSafe(plat))}\n` +
    `📧 *Cuenta:* ${escMD(ident)}\n\n` +
    `Seleccione qué desea ver:`;

  const kb = [
    [
      { text: "🔐 Login", callback_data: `nf_code|login|${encodeURIComponent(ident)}` },
      { text: "🏠 Código hogar", callback_data: `nf_code|hogar|${encodeURIComponent(ident)}` },
    ],
    [
      { text: "⏱️ Código temporal", callback_data: `nf_code|temporal|${encodeURIComponent(ident)}` },
      { text: "📌 PIN / perfil", callback_data: `nf_code|pin|${encodeURIComponent(ident)}` },
    ],
    [
      { text: "⬅️ Volver cuenta", callback_data: `mail_panel|${plat}|${encodeURIComponent(ident)}` },
      { text: "🏠 Inicio", callback_data: "go:inicio" },
    ],
  ];

  return upsertPanel(chatId, txt, kb);
}

async function responderCodigoNetflix(chatId, acceso = "", tipo = "") {
  const ident = String(acceso || "").trim();
  const tipoNorm = String(tipo || "").trim().toLowerCase();

  const plats = ["netflix", "vipnetflix"];
  let found = null;
  for (const p of plats) {
    found = await buscarCorreoInventarioPorPlatCorreo(p, ident);
    if (found) break;
  }

  if (!found) return bot.sendMessage(chatId, "⚠️ No encontré esa cuenta de Netflix.");

  const data = found.data || {};
  const plat = normalizarPlataforma(data.plataforma || "");

  const maps = {
    login: [
      ["Correo", data.correo || ident],
      ["Clave", data.clave || "Sin clave"],
    ],
    hogar: [
      ["Código hogar", data.codigo_hogar || data.hogarCode || data.hogar_code || data.hogar || "No disponible"],
    ],
    temporal: [
      ["Código temporal", data.codigo_temporal || data.tempCode || data.temporal || data.codigo || data.code || "No disponible"],
    ],
    pin: [
      ["PIN", data.pin || data.pin_hogar || data.pin_temporal || "No disponible"],
      ["Perfil", data.perfil || data.profile || "No disponible"],
    ],
  };

  const rows = maps[tipoNorm] || [["Dato", "No disponible"]];
  let txt = `🔑 *NETFLIX — ${escMD(tipoNorm.toUpperCase())}*\n\n`;
  txt += `📧 *Cuenta:* ${escMD(String(data.correo || ident))}\n`;
  txt += `📌 *Plataforma:* ${escMD(humanPlatSafe(plat))}\n\n`;

  rows.forEach(([k, v]) => {
    txt += `*${escMD(String(k))}:* ${escMD(String(v || "No disponible"))}\n`;
  });

  return upsertPanel(
    chatId,
    txt,
    [
      [
        { text: "⬅️ Volver códigos", callback_data: `mail_menu_codigos|${plat}|${encodeURIComponent(String(data.correo || ident))}` },
        { text: "🏠 Inicio", callback_data: "go:inicio" },
      ],
    ]
  );
}

// ===============================
// AUTO LLENO
// ===============================
async function aplicarAutoLleno(chatId, ref, antes = {}, despues = {}) {
  try {
    const plat = normalizarPlataforma(despues.plataforma || antes.plataforma || "");
    const ident = String(despues.correo || antes.correo || "");
    const beforeDisp = getDisponibles(antes, plat);
    const afterDisp = getDisponibles(despues, plat);
    const newEstado = afterDisp <= 0 ? "llena" : "activa";

    await ref.set(
      {
        estado: newEstado,
        disponibles: afterDisp,
        disp: afterDisp,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (beforeDisp > 0 && afterDisp <= 0 && chatId) {
      await bot.sendMessage(
        chatId,
        `🔴 *CUENTA LLENA*\n\n📌 ${escMD(humanPlatSafe(plat))}\n${getIdentIcon(plat)} ${escMD(ident)}`,
        { parse_mode: "Markdown" }
      );
    }

    if (beforeDisp <= 0 && afterDisp > 0 && chatId) {
      await bot.sendMessage(
        chatId,
        `🟢 *CUENTA CON ESPACIO*\n\n📌 ${escMD(humanPlatSafe(plat))}\n${getIdentIcon(plat)} ${escMD(ident)}\n✅ Disponibles: ${afterDisp}`,
        { parse_mode: "Markdown" }
      );
    }

    return true;
  } catch (e) {
    logErr("aplicarAutoLleno", e);
    return false;
  }
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
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
};
