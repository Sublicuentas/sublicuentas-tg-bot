"use strict";
/* SUBLICUENTAS · Compras del Panel de Socios — pedido v2 (Rediseño Socios, oct-2026)
   Un pedido = UN cliente + varios renglones (brief maestro 30/10/2026: un pedido, un cliente, un pago).
   Todos los renglones heredan el cliente principal; "otro cliente" se rechaza (otro pedido). Los pedidos
   viejos que mezclaban clientes se conservan tal cual y se marcan "Histórico anterior". Los datos que se piden salen del CATÁLOGO (entregaTipo,
   entregaCanal, pideDispositivo, datoRequerido); el nombre comercial solo se usa para productos
   viejos que todavía no tienen esa configuración (quedan marcados como "inferida").
   Funciones puras: las usa /rev/compra en server_api.js y las pruebas. */

const norm = (v) => String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const clean = (v, max = 200) => String(v == null ? "" : v).replace(/[\*_`\[\]]/g, "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const CANTIDADES = new Set([...Array.from({ length: 20 }, (_, i) => i + 1), 25, 30, 40, 50]);
const DISPOSITIVOS = { tv: "📺 TV", celular: "📱 Celular", tablet: "📱 Tableta", tableta: "📱 Tableta", computadora: "💻 Computadora" };
const MARCAS_TV = { samsung: "Samsung", lg: "LG", tcl: "TCL", roku: "Roku TV", android_tv: "Android TV / Google TV", fire_tv: "Fire TV", otro: "Otra" };
const MODALIDADES = ["perfil", "correo", "cuenta_completa", "tv_digital", "licencia", "detalle", "acceso"];

// Misma regla que assets/socios-2026.js (sxModalidad). Metadatos primero; el nombre solo para catálogos viejos.
function modalidad(it = {}, categoria = "") {
  const t = norm(it.entregaTipo || it.entrega_tipo).replace(/\s+/g, "_");
  const canal = norm(it.entregaCanal || it.entrega_canal);
  if (t === "cuenta_completa" || t === "cuenta") return { m: "cuenta_completa", inferida: false };
  if (t === "tv_digital" || t === "iptv") return { m: "tv_digital", inferida: false };
  if (t === "perfil") return { m: "perfil", inferida: false };
  if (t === "correo" || t === "invitacion") return { m: "correo", inferida: false };
  if (t === "serial" || t === "serial_key" || t === "licencia") return { m: "licencia", inferida: false };
  if (t === "detalle" || t === "recarga") return { m: "detalle", inferida: false };
  if (t === "acceso") return { m: canal === "iptv" ? "tv_digital" : "acceso", inferida: false };
  if (canal === "iptv") return { m: "tv_digital", inferida: false };
  if (canal === "invitacion") return { m: "correo", inferida: false };
  if (/(^| )cuentas? completas?( |$)/.test(norm(categoria || it.categoria))) return { m: "cuenta_completa", inferida: false };
  const txt = norm([it.n || it.nombre, it.s || it.variante, it.d || it.detalle, categoria || it.categoria].filter(Boolean).join(" "));
  let m = "detalle";
  if (/iptv|liontv|latintv|latin tv|lion tv|icomplay|nanotech|evoutouch|oleada|tv digital/.test(txt)) m = "tv_digital";
  else if (/netflix|disney|\bmax\b|hbo|vix|viki|prime video|paramount|crunchyroll/.test(txt)) m = "perfil";
  else if (/canva|gemini|office personal|microsoft 365|invitacion|gmail del cliente|correo del cliente/.test(txt)) m = "correo";
  else if (/mcafee|nod32|eset|antivirus|office 20(21|24)|licencia|serial|\bkey\b/.test(txt)) m = "licencia";
  else if (/spotify|deezer|youtube|correo y contrasena|correo y clave/.test(txt)) m = "acceso";
  return { m, inferida: true };
}
function pideDispositivo(it = {}, m) {
  const meta = norm(it.pideDispositivo || it.pide_dispositivo);
  if (m === "tv_digital") return true;
  if (meta === "si" || meta === "true") return true;
  if (meta === "no" || meta === "false") return false;
  return m === "perfil";
}
function nombreCompleto(c = {}) { return `${clean(c.nombre, 80)} ${clean(c.apellido, 80)}`.trim(); }

/* Normaliza y valida UN renglón v2 contra su producto del catálogo (ya resuelto en el servidor).
   Devuelve { renglon, errores:[{renglonId,campo,mensaje}] }. Nunca confía en el tipo que manda el navegador. */
function normalizarRenglon(p = {}, item = {}, principal = {}, index = 0) {
  const { m, inferida } = modalidad(item, item.categoria);
  const renglonId = clean(p.renglonId, 60) || `r${index + 1}`;
  const errores = [];
  const err = (campo, mensaje) => errores.push({ renglonId, campo, mensaje });
  const d = p.destinatario && typeof p.destinatario === "object" ? p.destinatario : {};
  const esOtro = d.tipo === "otro";
  const dest = { tipo: "principal", clienteId: clean(principal.clienteId, 120), nombre: clean(principal.nombre, 80), apellido: clean(principal.apellido, 80) };
  if (esOtro) err("destinatario", "Un pedido es para un solo cliente. Haga otro pedido para esa persona.");
  const pide = pideDispositivo(item, m);
  const disp = norm(p.dispositivo).replace(/^[^a-z]+/, "");
  const dispKey = Object.keys(DISPOSITIVOS).find((k) => disp === k || disp.endsWith(k)) || "";
  const marcaKey = norm(p.marcaTv).replace(/\s+/g, "_");
  const r = {
    renglonId, modalidad: m, modalidadInferida: inferida,
    destinatario: dest, clienteNombre: nombreCompleto(dest),
    cantidad: 1, perfilNombre: "", perfilApellido: "", perfil: "", dispositivo: "", correo: "", marcaTv: "", modeloTv: "",
    detalleServicio: "", datoRequerido: clean(item.datoRequerido, 60), notas: clean(p.notas, 300),
  };
  if (m === "cuenta_completa") {
    const n = Number(p.cantidad);
    if (!CANTIDADES.has(n)) err("cantidad", "Elija una cantidad válida.");
    r.cantidad = CANTIDADES.has(n) ? n : 1;
  }
  if (m === "perfil") {
    const otroPerfil = p.otroPerfil === true;
    r.perfilNombre = otroPerfil ? clean(p.perfilNombre, 80) : dest.nombre;
    r.perfilApellido = otroPerfil ? clean(p.perfilApellido, 80) : dest.apellido;
    r.perfil = `${r.perfilNombre} ${r.perfilApellido}`.trim();
    if (!r.perfilNombre) err(otroPerfil ? "perfilNombre" : "destinatario", otroPerfil ? "Escriba el nombre del perfil." : "Falta el nombre del cliente.");
  }
  if (pide) {
    if (!dispKey) err("dispositivo", "Seleccione el dispositivo.");
    r.dispositivo = DISPOSITIVOS[dispKey] || "";
  }
  if (m === "tv_digital" && dispKey === "tv") {
    if (!marcaKey) err("marcaTv", "Seleccione la marca o sistema del TV.");
    else if (marcaKey === "otro" && !clean(p.marcaOtra, 80)) err("marcaOtra", "Escriba la marca y el modelo del TV.");
    r.marcaTv = marcaKey === "otro" ? clean(p.marcaOtra, 80) : (MARCAS_TV[marcaKey] || clean(p.marcaTv, 80));
    r.modeloTv = clean(p.modeloTv, 80);
  }
  if (m === "correo") {
    r.correo = clean(p.correo, 160).toLowerCase();
    if (!EMAIL.test(r.correo)) err("correo", "Escriba un correo válido.");
  }
  if (m === "detalle") {
    r.detalleServicio = clean(p.detalleServicio || p.detalle, 240);
    if (!r.detalleServicio) err("detalleServicio", `Escriba: ${r.datoRequerido || "el detalle requerido"}.`);
  }
  return { renglon: r, errores };
}

function validarPrincipal(principal = {}) {
  const errores = [];
  if (!clean(principal.nombre, 80)) errores.push({ renglonId: "principal", campo: "nombre", mensaje: "Escriba el nombre del cliente principal." });
  if (!clean(principal.apellido, 80) && !clean(principal.clienteId, 120)) errores.push({ renglonId: "principal", campo: "apellido", mensaje: "Escriba el apellido del cliente principal." });
  return errores;
}

// Descuento vigente (sin cambios): L10 por unidad adicional con precio, máximo L40.
function totales(lineas = []) {
  const subtotal = lineas.reduce((a, l) => a + (l.precio !== null ? Number(l.precio || 0) * (l.cantidad || 1) : 0), 0);
  const conPrecio = lineas.reduce((a, l) => a + (l.precio !== null ? (l.cantidad || 1) : 0), 0);
  const descuento = Math.min(Math.max(conPrecio - 1, 0), 4) * 10;
  return { subtotal, conPrecio, descuento, total: Math.max(0, subtotal - descuento), hayComision: lineas.some((l) => l.precio === null) };
}

// Unidades que pide el pedido por cada producto con stock manual numérico.
function unidadesPorProducto(lineas = []) {
  const m = new Map();
  for (const l of lineas) if (l.catalogId) m.set(l.catalogId, (m.get(l.catalogId) || 0) + (l.cantidad || 1));
  return m;
}
function stockInsuficiente(doc = {}, pedidas = 1) {
  const modo = norm(doc.stockModo || "auto"), estado = norm(doc.stockEstado);
  if (modo !== "manual") return false;
  if (estado === "agotado") return true;
  if (doc.stockCantidad === null || doc.stockCantidad === undefined || doc.stockCantidad === "") return false;
  return Number(doc.stockCantidad) < pedidas;
}

// Líneas del aviso a Telegram: destinatario por renglón + sus datos + notas.
function lineasTelegram(productos = [], principalNombre = "") {
  return productos.flatMap((p, i) => {
    const precio = p.precioCatalogo === null ? "Por comisión" : `L${p.precioCatalogo}${(p.cantidad || 1) > 1 ? ` × ${p.cantidad}` : ""}`;
    const datos = [];
    const destino = p.clienteNombre || p.nombreCliente || "";
    if (destino && (p.destinatario?.tipo === "otro" || !principalNombre)) datos.push(`Para: ${destino}${p.destinatario?.tipo === "otro" ? " (otro cliente)" : ""}`);
    if (p.perfil && p.perfil !== destino) datos.push(`Perfil: ${p.perfil}`);
    if (p.dispositivo) datos.push(`Dispositivo: ${p.dispositivo}`);
    if (p.marcaTv) datos.push(`TV: ${p.marcaTv}${p.modeloTv ? ` · ${p.modeloTv}` : ""}`);
    if (p.correo) datos.push(`Correo: ${p.correo}`);
    if (p.detalleServicio) datos.push(`${p.datoRequerido || "Detalle"}: ${p.detalleServicio}`);
    if (p.notas) datos.push(`Nota: ${p.notas}`);
    return [`${i + 1}) ${p.servicio} — ${precio}`, ...datos.slice(0, 5).map((x) => `   • ${clean(x, 150)}`)];
  });
}

// Pedido viejo que mezclaba clientes (v2 con "otro cliente" o v1 con nombres distintos): se conserva, con etiqueta.
function historicoMixto(x = {}) {
  const productos = Array.isArray(x.productos) ? x.productos : [];
  if (Number(x.version) === 2) return productos.some((p) => p.destinatario && p.destinatario.tipo === "otro");
  return new Set(productos.map((p) => norm(p.nombreCliente || p.clienteNombre || "")).filter(Boolean)).size > 1;
}
// Estado de entrega derivado de los renglones publicados (lo escribe rev_entregas_api.js en compra.entregas).
function entregaResumen(x = {}) {
  const productos = Array.isArray(x.productos) && x.productos.length ? x.productos : [{ renglonId: "r1" }];
  const e = x.entregas && typeof x.entregas === "object" ? x.entregas : {};
  const req = productos.map((p, i) => p.renglonId || `r${i + 1}`);
  const pub = req.filter((r) => e[r] && e[r].estado === "publicada").length;
  if (norm(x.estado) === "cancelado") return { estado: "cancelado", requeridos: req.length, publicados: pub, texto: "Cancelado" };
  const estado = pub === 0 ? "pendiente" : pub < req.length ? "parcial" : "entregado";
  return { estado, requeridos: req.length, publicados: pub, texto: estado === "parcial" ? `Entrega parcial · ${pub} de ${req.length} servicio${req.length === 1 ? "" : "s"}` : estado === "entregado" ? "Entregado al socio" : "Pendiente de entrega",
    renglones: Object.fromEntries(req.map((r) => [r, e[r] ? { estado: e[r].estado, entregaId: e[r].estado === "publicada" ? e[r].entregaId || "" : "" } : { estado: "pendiente", entregaId: "" }])) };
}

// Lo que ve el socio en "Pedidos" (sin imagen, sin datos internos de finanzas).
function pedidoPublico(id, x = {}) {
  const productos = Array.isArray(x.productos) ? x.productos : [];
  return {
    historicoAnterior: historicoMixto(x), entregaResumen: entregaResumen(x), pagoEnRevision: !!x.pagoRevision,
    id, ref: String(id).slice(-6).toUpperCase(), version: Number(x.version) || 1,
    servicio: x.servicio || "Compra", estado: x.estado || "pendiente", detalleEstado: x.detalleEstado || "",
    destino: x.destino || "", destinoLabel: x.destinoLabel || "",
    clientePrincipal: x.clientePrincipal || (x.cliente ? { nombre: x.clienteNombre || x.cliente, apellido: x.clienteApellido || "", clienteId: "" } : null),
    productos: productos.map((p, i) => ({
      renglonId: p.renglonId || `r${i + 1}`, catalogId: p.catalogId || "", servicio: p.servicio || "", servicioBase: p.servicioBase || "", catalogSub: p.catalogSub || "",
      modalidad: p.modalidad || "", cantidad: p.cantidad || 1, precioCatalogo: p.precioCatalogo === undefined ? null : p.precioCatalogo,
      destinatario: p.destinatario || null, clienteNombre: p.clienteNombre || p.nombreCliente || p.perfil || "",
      perfil: p.perfil || "", dispositivo: p.dispositivo || "", correo: p.correo || "", marcaTv: p.marcaTv || "", modeloTv: p.modeloTv || "",
      detalleServicio: p.detalleServicio || "", datoRequerido: p.datoRequerido || "", notas: p.notas || "",
      otroPerfil: !!(p.perfil && p.clienteNombre && p.perfil !== p.clienteNombre),
    })),
    subtotalCatalogo: Number(x.subtotalCatalogo) || 0, descuentoCombo: Number(x.descuentoCombo) || 0, totalCombo: Number(x.totalCombo) || 0,
    monto: Number(x.monto) || 0, montoAutomatico: x.montoAutomatico !== false, banco: x.banco || "", comentario: x.comentario || "",
    comprobante: !!(x.imagenUrl || x.imagenData), createdAt: x.createdAt, estadoUpdatedAt: x.estadoUpdatedAt || x.updatedAt || x.createdAt,
    estadoHistorial: Array.isArray(x.estadoHistorial) ? x.estadoHistorial.slice(-10) : [],
  };
}

module.exports = { norm, clean, EMAIL, CANTIDADES, DISPOSITIVOS, MARCAS_TV, MODALIDADES, modalidad, pideDispositivo, normalizarRenglon, validarPrincipal, totales, unidadesPorProducto, stockInsuficiente, lineasTelegram, pedidoPublico, nombreCompleto, historicoMixto, entregaResumen };
