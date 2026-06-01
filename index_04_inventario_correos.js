/* âœ… SUBLICUENTAS TG BOT â€” PARTE 4/6 CORREGIDA Y COMPATIBLE
   INVENTARIO / CUENTAS / PANEL POR CORREO-USUARIO
   -----------------------------------------------
   Compatible con index_05_finanzas_menus_2filas y index_06_handlers_columna_corregido

   âœ… AJUSTES CLAVE:
   - Se respeta correo || usuario en vistas y botones
   - disneys ajustado a capacidad 3
   - âœ… v4: Eliminada lÃ­nea "Tipo:" innecesaria del panel de cuenta
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

function getStoredIdent(data = {}) {
  return String(data.correo || data.usuario || data.ident || "").trim();
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
  return isUserPlatform(plataforma) ? "ðŸ‘¤" : "ðŸ“§";
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
    disneys: 3,
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
  const estado = getEstado(data, plataforma) === "llena" ? "ðŸ”´ LLENA" : "ðŸŸ¢ ACTIVA";
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
// BÃšSQUEDAS INVENTARIO
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
      const acceso = getStoredIdent(data);
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
      return getStoredIdent(a).localeCompare(getStoredIdent(b), "es", { sensitivity: "base" });
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
      const stored = normalizeAccess(plat, getStoredIdent(data));
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
async function getInventarioRowsByPlataforma(plataforma = "") {
  const plat = normalizarPlataforma(plataforma);
  let rows = [];

  try {
    const snap = await db.collection("inventario").where("plataforma", "==", plat).get();
    rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (e) {
    logErr("getInventarioRowsByPlataforma.where", e);
  }

  if (!rows.length) {
    try {
      const snapAll = await db.collection("inventario").get();
      rows = snapAll.docs
        .map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((r) => normalizarPlataforma(r.plataforma || "") === plat);
    } catch (e) {
      logErr("getInventarioRowsByPlataforma.fallback", e);
      rows = [];
    }
  }

  rows.sort((a, b) => {
    const da = getDisponibles(a, plat);
    const dbb = getDisponibles(b, plat);
    if (dbb !== da) return dbb - da;
    return getStoredIdent(a).localeCompare(getStoredIdent(b), "es", { sensitivity: "base" });
  });

  return rows;
}

async function enviarInventarioPlataforma(chatId, plataforma = "", page = 0) {
  const plat = normalizarPlataforma(plataforma);

  try {
    const rows = await getInventarioRowsByPlataforma(plat);
    const disponibles = rows.filter((r) => getDisponibles(r, plat) > 0);
    const llenas = rows.filter((r) => getDisponibles(r, plat) <= 0);

    let txt = `ðŸ“¦ *${escMD(humanPlatSafe(plat).toUpperCase())}*\n\n`;
    txt += `Seleccione quÃ© desea ver:\n\n`;
    txt += `ðŸŸ¢ *Disponibles:* ${disponibles.length}\n`;
    txt += `ðŸ”´ *Llenas:* ${llenas.length}`;

    return upsertPanel(
      chatId,
      txt,
      [
        [
          { text: `ðŸŸ¢ Disponibles (${disponibles.length})`, callback_data: `invf:${plat}:disponibles:0` },
          { text: `ðŸ”´ Llenas (${llenas.length})`, callback_data: `invf:${plat}:llenas:0` },
        ],
        [{ text: "âž• Nueva cuenta", callback_data: `inv:new:plat:${plat}` }],
        [
          { text: "â¬…ï¸ Volver Inventario", callback_data: "menu:inventario" },
          { text: "ðŸ  Inicio", callback_data: "go:inicio" },
        ],
      ]
    );
  } catch (e) {
    logErr("enviarInventarioPlataforma.selector", e);
    return bot.sendMessage(chatId, "âš ï¸ Error al abrir inventario de esa plataforma.");
  }
}

async function enviarInventarioPlataformaEstado(chatId, plataforma = "", filtro = "disponibles", page = 0) {
  const plat = normalizarPlataforma(plataforma);
  const pageSize = 10;
  const filtroNorm = String(filtro || "").toLowerCase() === "llenas" ? "llenas" : "disponibles";

  try {
    const rowsAll = await getInventarioRowsByPlataforma(plat);
    const rows = filtroNorm === "llenas"
      ? rowsAll.filter((r) => getDisponibles(r, plat) <= 0)
      : rowsAll.filter((r) => getDisponibles(r, plat) > 0);

    if (!rows.length) {
      return upsertPanel(
        chatId,
        `ðŸ“¦ *${escMD(humanPlatSafe(plat).toUpperCase())}*\n\n_No hay cuentas en la secciÃ³n ${filtroNorm === "llenas" ? "llenas" : "disponibles"}._`,
        [
          [
            { text: "â¬…ï¸ Volver plataforma", callback_data: `inv:${plat}:0` },
            { text: "ðŸ  Inicio", callback_data: "go:inicio" },
          ],
        ]
      );
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.max(0, Math.min(Number(page || 0), totalPages - 1));
    const start = safePage * pageSize;
    const slice = rows.slice(start, start + pageSize);

    const emojiEstado = filtroNorm === "llenas" ? "ðŸ”´" : "ðŸŸ¢";
    const tituloEstado = filtroNorm === "llenas" ? "LLENAS" : "DISPONIBLES";

    let txt = `ðŸ“¦ *${escMD(humanPlatSafe(plat).toUpperCase())}*\n`;
    txt += `${emojiEstado} *${tituloEstado}*\n`;
    txt += `PÃ¡gina *${safePage + 1}/${totalPages}*\n\n`;

    slice.forEach((r, idx) => {
      const ident = getStoredIdent(r);
      const { capacidad, ocupados, disponibles } = formatCuentaResumen(r, plat);
      txt += `*${start + idx + 1}.* ${filtroNorm === "llenas" ? "ðŸ”´" : "ðŸŸ¢"} ${getIdentIcon(plat)} ${escMD(ident)}\n`;
      txt += `   ðŸ‘¥ ${ocupados}/${capacidad} â€¢ âœ… ${disponibles}\n`;
      if (r.clave) txt += `   ðŸ”‘ ${escMD(String(r.clave))}\n`;
    });

    const kb = slice.map((r) => {
      const ident = getStoredIdent(r);
      return [
        {
          text: `${filtroNorm === "llenas" ? "ðŸ”´" : "ðŸŸ¢"} ${ident} â€¢ ${getDisponibles(r, plat)}/${getCapacidadCorreo(r, plat)}`,
          callback_data: `inv:open:${plat}:${encodeURIComponent(String(ident || ""))}`,
        },
      ];
    });

    const nav = [];
    if (safePage > 0) nav.push({ text: "â¬…ï¸ Anterior", callback_data: `invf:${plat}:${filtroNorm}:${safePage - 1}` });
    if (safePage < totalPages - 1) nav.push({ text: "Siguiente âž¡ï¸", callback_data: `invf:${plat}:${filtroNorm}:${safePage + 1}` });
    if (nav.length) kb.push(nav);

    kb.push([
      { text: "â¬…ï¸ Volver plataforma", callback_data: `inv:${plat}:0` },
      { text: "ðŸ  Inicio", callback_data: "go:inicio" },
    ]);

    return upsertPanel(chatId, txt, kb);
  } catch (e) {
    logErr("enviarInventarioPlataformaEstado", e);
    return bot.sendMessage(chatId, "âš ï¸ Error al listar cuentas de esa plataforma.");
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

    let txt = "ðŸ“Š *STOCK GENERAL*\n\n";
    if (!keys.length) {
      txt += "_No hay cuentas cargadas en inventario._";
    } else {
      for (const k of keys) {
        const x = map[k];
        txt += `*${escMD(humanPlatSafe(k))}*\n`;
        txt += `   ðŸ“¦ Cuentas: ${x.cuentas}\n`;
        txt += `   ðŸ‘¥ Ocupados: ${x.ocupados}/${x.capacidad}\n`;
        txt += `   âœ… Disponibles: ${x.disponibles}\n\n`;
      }
    }

    return upsertPanel(
      chatId,
      txt,
      [
        [{ text: "â¬…ï¸ Volver Inventario", callback_data: "menu:inventario" }],
        [{ text: "ðŸ  Inicio", callback_data: "go:inicio" }],
      ]
    );
  } catch (e) {
    logErr("mostrarStockGeneral", e);
    return bot.sendMessage(chatId, "âš ï¸ Error al generar stock general.");
  }
}

// ===============================
// âœ… PANEL DE CUENTA â€” sin lÃ­nea "Tipo:"
// ===============================
async function mostrarPanelCorreo(chatId, plataforma = "", acceso = "") {
  const plat = normalizarPlataforma(plataforma);
  const found = await buscarCorreoInventarioPorPlatCorreo(plat, acceso);
  if (!found) return bot.sendMessage(chatId, "âš ï¸ Esa cuenta no existe en inventario.");

  const data = found.data || {};
  const ident = getStoredIdent(data) || String(acceso || "");
  const clave = String(data.clave || "Sin clave");
  const { capacidad, ocupados, disponibles, estado } = formatCuentaResumen(data, plat);

  // âœ… Panel compacto para que ocupe menos pantalla
  let txt = `ðŸ“¦ *${escMD(humanPlatSafe(plat))}*\n`;
  txt += `${getIdentIcon(plat)} ${escMD(ident)}\n`;
  txt += `ðŸ”‘ ${escMD(clave)}\n`;
  txt += `ðŸ‘¥ ${ocupados}/${capacidad} Â· âœ… ${disponibles}\n`;
  txt += `${escMD(estado)}`;

  if (isNetflixPlatform(plat) && boolHasCodes(data)) {
    txt += `\n\nðŸ’¡ Tiene datos/cÃ³digos de Netflix disponibles.`;
  }

  const kb = [
    [{ text: "ðŸ‘¥ Clientes", callback_data: `mail_menu_clientes|${plat}|${encodeURIComponent(ident)}` }],
  ];

  if (isNetflixPlatform(plat) && boolHasCodes(data)) {
    kb.push([{ text: "ðŸ”‘ Ver cÃ³digos Netflix", callback_data: `mail_menu_codigos|${plat}|${encodeURIComponent(ident)}` }]);
  }

  kb.push([
    { text: "âœï¸ Editar clave", callback_data: `mail_edit_clave|${plat}|${encodeURIComponent(ident)}` },
    { text: "âœ‰ï¸ Editar correo", callback_data: `mail_edit_correo|${plat}|${encodeURIComponent(ident)}` },
  ]);

  kb.push([{ text: "ðŸ—‘ï¸ Borrar cuenta", callback_data: `mail_delete|${plat}|${encodeURIComponent(ident)}` }]);

  kb.push([
    { text: "â¬…ï¸ Volver plataforma", callback_data: `inv:${plat}:0` },
    { text: "ðŸ  Inicio", callback_data: "go:inicio" },
  ]);

  return upsertPanel(chatId, txt, kb);
}

async function enviarSubmenuInventario(chatId, plataforma = "", acceso = "") {
  return mostrarPanelCorreo(chatId, plataforma, acceso);
}

async function mostrarMenuClientesCorreo(chatId, plataforma = "", acceso = "") {
  const plat = normalizarPlataforma(plataforma);
  const found = await buscarCorreoInventarioPorPlatCorreo(plat, acceso);
  if (!found) return bot.sendMessage(chatId, "âš ï¸ Esa cuenta no existe en inventario.");

  const data = found.data || {};
  const ident = getStoredIdent(data) || String(acceso || "");
  const { capacidad, ocupados, disponibles, estado } = formatCuentaResumen(data, plat);

  const txt =
    `ðŸ‘¥ *CLIENTES DE LA CUENTA*\n\n` +
    `ðŸ“Œ *Plataforma:* ${escMD(humanPlatSafe(plat))}\n` +
    `${getIdentIcon(plat)} *${escMD(getIdentLabel(plat))}:* ${escMD(ident)}\n` +
    `ðŸ‘¥ *Ocupados:* ${ocupados}/${capacidad}\n` +
    `âœ… *Disponibles:* ${disponibles}\n` +
    `ðŸ“Š *Estado:* ${escMD(estado)}\n\n` +
    `Seleccione una acciÃ³n:`;

  return upsertPanel(
    chatId,
    txt,
    [
      [
        { text: "âž• Agregar cliente", callback_data: `mail_add_cliente|${plat}|${encodeURIComponent(ident)}` },
        { text: "âž– Quitar cliente", callback_data: `mail_del_cliente|${plat}|${encodeURIComponent(ident)}` },
      ],
      [
        { text: "ðŸ” Editar PIN cliente", callback_data: `mail_edit_pin|${plat}|${encodeURIComponent(ident)}` },
        { text: "ðŸ‘¥ Ver clientes", callback_data: `mail_ver_clientes|${plat}|${encodeURIComponent(ident)}` },
      ],
      [
        { text: "â¬…ï¸ Cuenta", callback_data: `mail_panel|${plat}|${encodeURIComponent(ident)}` },
        { text: "ðŸ  Inicio", callback_data: "go:inicio" },
      ],
    ]
  );
}

// ===============================
// NETFLIX CÃ“DIGOS
// ===============================
async function responderMenuCodigosNetflix(chatId, plataforma = "", acceso = "") {
  const plat = normalizarPlataforma(plataforma);
  const found = await buscarCorreoInventarioPorPlatCorreo(plat, acceso);
  if (!found) return bot.sendMessage(chatId, "âš ï¸ Esa cuenta no existe en inventario.");

  const data = found.data || {};
  const ident = getStoredIdent(data) || String(acceso || "");

  const txt =
    `ðŸ”‘ *CÃ“DIGOS / DATOS NETFLIX*\n\n` +
    `ðŸ“Œ *Plataforma:* ${escMD(humanPlatSafe(plat))}\n` +
    `ðŸ“§ *Cuenta:* ${escMD(ident)}\n\n` +
    `Seleccione quÃ© desea ver:`;

  const kb = [
    [
      { text: "ðŸ” Login", callback_data: `nf_code|login|${encodeURIComponent(ident)}` },
      { text: "ðŸ  CÃ³digo hogar", callback_data: `nf_code|hogar|${encodeURIComponent(ident)}` },
    ],
    [
      { text: "â±ï¸ CÃ³digo temporal", callback_data: `nf_code|temporal|${encodeURIComponent(ident)}` },
      { text: "ðŸ“Œ PIN / perfil", callback_data: `nf_code|pin|${encodeURIComponent(ident)}` },
    ],
    [
      { text: "â¬…ï¸ Cuenta", callback_data: `mail_panel|${plat}|${encodeURIComponent(ident)}` },
      { text: "ðŸ  Inicio", callback_data: "go:inicio" },
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

  if (!found) return bot.sendMessage(chatId, "âš ï¸ No encontrÃ© esa cuenta de Netflix.");

  const data = found.data || {};
  const plat = normalizarPlataforma(data.plataforma || "");
  const cuenta = getStoredIdent(data) || ident;

  const maps = {
    login: [
      ["Correo", cuenta],
      ["Clave", data.clave || "Sin clave"],
    ],
    hogar: [
      ["CÃ³digo hogar", data.codigo_hogar || data.hogarCode || data.hogar_code || data.hogar || "No disponible"],
    ],
    temporal: [
      ["CÃ³digo temporal", data.codigo_temporal || data.tempCode || data.temporal || data.codigo || data.code || "No disponible"],
    ],
    pin: [
      ["PIN", data.pin || data.pin_hogar || data.pin_temporal || "No disponible"],
      ["Perfil", data.perfil || data.profile || "No disponible"],
    ],
  };

  const rows = maps[tipoNorm] || [["Dato", "No disponible"]];
  let txt = `ðŸ”‘ *NETFLIX â€” ${escMD(tipoNorm.toUpperCase())}*\n\n`;
  txt += `ðŸ“§ *Cuenta:* ${escMD(cuenta)}\n`;
  txt += `ðŸ“Œ *Plataforma:* ${escMD(humanPlatSafe(plat))}\n\n`;

  rows.forEach(([k, v]) => {
    txt += `*${escMD(String(k))}:* ${escMD(String(v || "No disponible"))}\n`;
  });

  return upsertPanel(
    chatId,
    txt,
    [
      [
        { text: "â¬…ï¸ Volver cÃ³digos", callback_data: `mail_menu_codigos|${plat}|${encodeURIComponent(cuenta)}` },
        { text: "ðŸ  Inicio", callback_data: "go:inicio" },
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
    const ident = getStoredIdent(despues) || getStoredIdent(antes);
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
        `ðŸ”´ *CUENTA LLENA*\n\nðŸ“Œ ${escMD(humanPlatSafe(plat))}\n${getIdentIcon(plat)} ${escMD(ident)}`,
        { parse_mode: "Markdown" }
      );
    }

    if (beforeDisp <= 0 && afterDisp > 0 && chatId) {
      await bot.sendMessage(
        chatId,
        `ðŸŸ¢ *CUENTA CON ESPACIO*\n\nðŸ“Œ ${escMD(humanPlatSafe(plat))}\n${getIdentIcon(plat)} ${escMD(ident)}\nâœ… Disponibles: ${afterDisp}`,
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
  enviarInventarioPlataformaEstado,
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
