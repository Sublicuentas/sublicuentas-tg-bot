/* CATÁLOGO PERSONALIZADO DE SOCIOS · agosto 2026
   ------------------------------------------------
   Fuente única para:
   - Panel web de socios (/rev/precios)
   - Nueva compra / combos
   - Lista de precios del bot de Telegram
   - Migración de precios de clientes por vendedor

   La colección `precios` conserva la tarifa general. La colección
   `precios_especiales` guarda listas adicionales identificadas por tarifaId.
*/

const TARIFA_PROPIETARIOS_ID = "propietarios_2026";
const SOCIOS_TARIFA_PROPIETARIOS = new Set([
  "sublicuentas",
  "sublicuentas 2",
  "relojes",
  "geisell",
  // Alias histórico. La migración lo consolida en Geisell.
  "geissel",
]);

function normSocio(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value = "") {
  return normSocio(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function item(id, categoria, categoriaOrden, orden, nombre, variante, precio, detalle) {
  return {
    id,
    tarifaId: TARIFA_PROPIETARIOS_ID,
    claveNatural: `${slug(categoria)}__${slug(nombre)}__${slug(variante)}`,
    categoria,
    categoriaSub: categoria === "📺 Streaming" || categoria === "🎵 Música" ? "Plan mensual" : "",
    categoriaOrden,
    orden,
    nombre,
    variante: variante || "",
    precio,
    detalle: detalle || "",
    activo: true,
  };
}

const CATALOGO_PROPIETARIOS = Object.freeze([
  item("netflix_premium", "📺 Streaming", 1, 1, "Netflix Premium", "1 mes", 130, "Perfil Premium · 1 dispositivo a la vez"),
  item("netflix_premium_vip", "📺 Streaming", 1, 2, "Netflix Premium VIP", "1 mes", 150, "Acceso VIP · 1 dispositivo a la vez"),
  item("disney_premium", "📺 Streaming", 1, 3, "Disney Premium", "1 mes", 100, "Acceso por perfil · 1 dispositivo"),
  item("disney_premium_sin_espn", "📺 Streaming", 1, 4, "Disney Premium sin ESPN", "1 mes", 70, "Acceso por perfil · 1 dispositivo"),
  item("hbo_max", "📺 Streaming", 1, 5, "HBO Max", "1 mes", 80, "Acceso por perfil · 1 dispositivo"),
  item("prime_video", "📺 Streaming", 1, 6, "Prime Video", "1 mes", 80, "Acceso por perfil · 1 dispositivo"),
  item("crunchyroll", "📺 Streaming", 1, 7, "Crunchyroll", "1 mes", 80, "Acceso por perfil · 1 dispositivo"),
  item("paramount", "📺 Streaming", 1, 8, "Paramount+", "1 mes", 80, "Acceso mensual · 1 dispositivo"),
  item("vix", "📺 Streaming", 1, 9, "ViX", "1 mes", 80, "Acceso mensual · 1 dispositivo"),
  item("viki_rakuten", "📺 Streaming", 1, 10, "Viki Rakuten", "1 mes", 80, "Acceso mensual · 1 dispositivo"),

  item("oleada_tv_1", "📡 IPTV y TV", 2, 1, "Oleada TV", "1 dispositivo", 90, "Usuario y clave · 1 dispositivo"),
  item("oleada_tv_3", "📡 IPTV y TV", 2, 2, "Oleada TV", "3 dispositivos", 200, "Usuario y clave · 3 dispositivos"),
  item("liontv_1", "📡 IPTV y TV", 2, 3, "LionTV", "1 dispositivo", 250, "Plan LionTV · 1 dispositivo"),
  item("liontv_2", "📡 IPTV y TV", 2, 4, "LionTV", "2 dispositivos", 275, "Plan LionTV · 2 dispositivos"),
  item("liontv_3", "📡 IPTV y TV", 2, 5, "LionTV", "3 dispositivos", 300, "Plan LionTV · 3 dispositivos"),
  item("liontv_5", "📡 IPTV y TV", 2, 6, "LionTV", "5 dispositivos", 350, "Plan LionTV · 5 dispositivos"),
  item("latintv_1", "📡 IPTV y TV", 2, 7, "LatinTV", "1 dispositivo", 99, "Plan LatinTV · 1 dispositivo"),
  item("latintv_2", "📡 IPTV y TV", 2, 8, "LatinTV", "2 dispositivos", 149, "Plan LatinTV · 2 dispositivos"),
  item("latintv_3", "📡 IPTV y TV", 2, 9, "LatinTV", "3 dispositivos", 199, "Plan LatinTV · 3 dispositivos"),
  item("latintv_4", "📡 IPTV y TV", 2, 10, "LatinTV", "4 dispositivos", 249, "Plan LatinTV · 4 dispositivos"),

  item("spotify", "🎵 Música", 3, 1, "Spotify Premium", "1 mes", 110, "Acceso Premium mensual"),
  item("deezer", "🎵 Música", 3, 2, "Deezer Premium", "1 mes", 90, "Acceso Premium mensual"),

  item("nod32", "💻 Productividad y seguridad", 4, 1, "ESET NOD32 Antivirus", "1 año · 1 dispositivo", 399, "Licencia por 1 año para 1 dispositivo"),
  item("duolingo", "💻 Productividad y seguridad", 4, 2, "Duolingo", "1 mes", 89, "Acceso mensual"),
  item("canva", "💻 Productividad y seguridad", 4, 3, "Canva Pro", "1 mes", 69, "Activación por 1 mes"),
  item("office_365", "💻 Productividad y seguridad", 4, 4, "Office 365", "1 año", 449, "Licencia por 1 año"),
  item("office_2021", "💻 Productividad y seguridad", 4, 5, "Office 2021 Pro Plus", "Licencia permanente", 449, "Licencia permanente para Windows"),

  item("gemini_pro", "🤖 Inteligencia Artificial", 5, 1, "Gemini Pro", "1 mes", 170, "Activación por 1 mes"),
]);

function tarifaIdParaSocio(rev = {}) {
  const explicita = String(rev.tarifaId || rev.tarifa_id || "").trim();
  if (explicita) return explicita;
  const nombre = normSocio(rev.nombre_norm || rev.nombre || rev.id || "");
  return SOCIOS_TARIFA_PROPIETARIOS.has(nombre) ? TARIFA_PROPIETARIOS_ID : "general";
}

function agruparCatalogo(rows = []) {
  const ordenados = rows
    .filter((p) => p && p.activo !== false)
    .slice()
    .sort((a, b) =>
      (Number(a.categoriaOrden) || 999) - (Number(b.categoriaOrden) || 999) ||
      (Number(a.orden) || 999) - (Number(b.orden) || 999)
    );
  const grupos = [];
  const porCategoria = new Map();
  for (const p of ordenados) {
    const key = `${p.categoria || ""}|${p.categoriaSub || ""}`;
    if (!porCategoria.has(key)) {
      const grupo = { cat: p.categoria || "Catálogo", sub: p.categoriaSub || "", items: [] };
      porCategoria.set(key, grupo);
      grupos.push(grupo);
    }
    porCategoria.get(key).items.push({
      id: p.id || p.claveNatural || "",
      n: p.nombre || "",
      s: p.variante || "",
      p: p.precio == null ? null : Number(p.precio),
      d: p.detalle || "",
    });
  }
  return grupos;
}

async function datosRevendedor(db, rev = {}) {
  if (rev && rev.id) {
    try {
      const snap = await db.collection("revendedores").doc(String(rev.id)).get();
      if (snap.exists) return { id: snap.id, ...snap.data(), ...rev };
    } catch (_) {}
  }
  return rev || {};
}

async function obtenerCatalogoSocio(db, rev = {}) {
  const vendedor = await datosRevendedor(db, rev);
  const tarifaId = tarifaIdParaSocio(vendedor);
  if (tarifaId !== "general") {
    const snap = await db.collection("precios_especiales").where("tarifaId", "==", tarifaId).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return {
      tarifaId,
      grupos: agruparCatalogo(rows.length ? rows : CATALOGO_PROPIETARIOS),
      origen: rows.length ? "firestore" : "respaldo_especial",
    };
  }
  const snap = await db.collection("precios").get();
  return {
    tarifaId: "general",
    grupos: agruparCatalogo(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    origen: "firestore",
  };
}

function catalogoPlano(grupos = []) {
  return grupos.flatMap((g) => (g.items || []).map((it) => ({
    ...it,
    categoria: g.cat || "",
    categoriaSub: g.sub || "",
    nombreCompleto: it.s ? `${it.n} · ${it.s}` : it.n,
  })));
}

function buscarProductoCatalogo(grupos, producto = {}) {
  const lista = catalogoPlano(grupos);
  const id = String(producto.catalogId || producto.id || "").replace(/^cat_/, "").trim();
  if (id) {
    const porId = lista.find((it) => String(it.id || "") === id || slug(it.id) === slug(id));
    if (porId) return porId;
  }
  const base = normSocio(producto.servicioBase || producto.nombre || producto.servicio || "");
  const variante = normSocio(producto.catalogSub || producto.variante || "");
  return lista.find((it) => {
    const mismoNombre = normSocio(it.n) === base || normSocio(it.nombreCompleto) === normSocio(producto.servicio || "");
    return mismoNombre && (!variante || normSocio(it.s) === variante);
  }) || null;
}

function textoServicio(servicio = {}) {
  return normSocio([
    servicio.plataforma, servicio.servicio, servicio.nombre, servicio.cuenta,
    servicio.variante, servicio.plan, servicio.detalle, servicio.proveedor,
    servicio.iptvProveedor, servicio.fichaTexto,
  ].filter(Boolean).join(" "));
}

function cantidadServicio(servicio = {}, texto = "") {
  const directos = [
    servicio.dispositivos, servicio.pantallas, servicio.cantidadDispositivos,
    servicio.cantidadPantallas, servicio.iptvPantallas, servicio.oleadaDispositivos,
    servicio.capacidad,
  ];
  for (const valor of directos) {
    const n = Number(valor);
    if (Number.isFinite(n) && n > 0 && n <= 10) return n;
  }
  const m = String(texto || "").match(/(?:^|\D)([1-9])\s*(?:dispositivo|dispositivos|pantalla|pantallas|screen|screens)?(?:\D|$)/);
  return m ? Number(m[1]) : null;
}

function precioEspecialParaServicio(servicio = {}) {
  const t = textoServicio(servicio);
  const cantidad = cantidadServicio(servicio, t);
  if (!t) return null;

  if (t.includes("netflix") && t.includes("vip")) return { precio: 150, regla: "Netflix Premium VIP" };
  if (t.includes("netflix")) return { precio: 130, regla: "Netflix Premium" };
  if (t.includes("disney") && (t.includes("sin espn") || t.includes("standard") || t.includes("disneys"))) return { precio: 70, regla: "Disney Premium sin ESPN" };
  if (t.includes("disney")) return { precio: 100, regla: "Disney Premium" };
  if (t.includes("hbo") || t === "max" || t.includes("hbo max")) return { precio: 80, regla: "HBO Max" };
  if (t.includes("prime")) return { precio: 80, regla: "Prime Video" };
  if (t.includes("crunchy")) return { precio: 80, regla: "Crunchyroll" };
  if (t.includes("paramount")) return { precio: 80, regla: "Paramount+" };
  if (t.includes("vix")) return { precio: 80, regla: "ViX" };
  if (t.includes("viki") || t.includes("rakuten")) return { precio: 80, regla: "Viki Rakuten" };

  if (t.includes("oleada")) {
    if (cantidad === 3) return { precio: 200, regla: "Oleada TV · 3 dispositivos" };
    if (cantidad === 1 || cantidad == null) return { precio: 90, regla: "Oleada TV · 1 dispositivo" };
    return { ambiguo: true, regla: `Oleada TV · ${cantidad} dispositivos no configurado` };
  }
  if (t.includes("lion")) {
    const mapa = { 1: 250, 2: 275, 3: 300, 5: 350 };
    return mapa[cantidad] ? { precio: mapa[cantidad], regla: `LionTV · ${cantidad} dispositivo(s)` } : { ambiguo: true, regla: "LionTV sin cantidad válida" };
  }
  if (t.includes("latin") || t.includes("latvgt") || t.includes("enlatv")) {
    const mapa = { 1: 99, 2: 149, 3: 199, 4: 249 };
    return mapa[cantidad] ? { precio: mapa[cantidad], regla: `LatinTV · ${cantidad} dispositivo(s)` } : { ambiguo: true, regla: "LatinTV sin cantidad válida" };
  }
  if (t.includes("iptv")) return { ambiguo: true, regla: "IPTV antiguo sin marca LatinTV/LionTV" };

  if (t.includes("spotify")) return { precio: 110, regla: "Spotify" };
  if (t.includes("deezer")) return { precio: 90, regla: "Deezer" };
  if (t.includes("canva")) return { precio: 69, regla: "Canva" };
  if (t.includes("gemini")) return { precio: 170, regla: "Gemini Pro" };
  if (t.includes("duolingo")) return { precio: 89, regla: "Duolingo" };
  if (t.includes("nod32") || t.includes("eset")) return { precio: 399, regla: "ESET NOD32" };
  if (t.includes("office 2021") || t.includes("office2021")) return { precio: 449, regla: "Office 2021" };
  if (t.includes("office") || t.includes("microsoft 365") || t.includes("office365")) return { precio: 449, regla: "Office 365" };
  return null;
}

module.exports = {
  TARIFA_PROPIETARIOS_ID,
  SOCIOS_TARIFA_PROPIETARIOS,
  CATALOGO_PROPIETARIOS,
  normSocio,
  slug,
  tarifaIdParaSocio,
  agruparCatalogo,
  obtenerCatalogoSocio,
  catalogoPlano,
  buscarProductoCatalogo,
  precioEspecialParaServicio,
};
