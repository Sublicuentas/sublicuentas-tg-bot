// lib_finanzas_empresa.js · R140 — GENERADO de Sublichat HQ api/_finanzas-empresa.js (mismas reglas en web, APK y Telegram). No editar a mano.
// api/_finanzas-empresa.js · R135 — FINANCE OS · FASE 1 (catálogo financiero, proveedores, precios con historial y Binance USDT).
// Lógica pura arriba (se prueba sin Firestore) y el manejador de /api/finanzas abajo. Nada de esto modifica movimientos
// existentes: todo vive en colecciones nuevas fin_* y en movimientos nuevos con su propio operationId.
//
// Reglas del PDF que se cumplen aquí:
//  · Precio de venta con HISTORIAL: cambiar un precio crea una versión nueva y cierra la anterior. Nunca se edita una versión.
//  · Costo de referencia del proveedor con historial: cambiarlo agrega una versión; los lotes ya comprados no cambian (Fase 2).
//  · Recargar Binance desde un banco NO es gasto: el banco baja (transferencia) y Binance sube en USDT con su tasa efectiva.
//  · Binance lleva costo promedio ponderado: una recarga nueva no recalcula compras viejas.
//  · Ajuste de Binance: solo con motivo y queda en auditoría; nunca se cambia el historial en silencio.

const { cuposMesDe, correrCosteo, CUENTA_MADRE_LIKE, ventasACostear } = require("./lib_finanzas_costeo"); // R137
const { libroDiario, balanzaComprobacion } = require("./lib_contabilidad"); // R139
const { cargarTablero } = require("./lib_finanzas_reportes"); // R139

const MODELOS = Object.freeze({
  unidad: { label: "Unidad individual", unidad: "unidad", ejemplo: "Netflix VIP, Office" },
  cuenta_madre: { label: "Cuenta madre / perfiles", unidad: "cupo", ejemplo: "Netflix Premium, Paramount, Crunchyroll, Spotify" },
  link: { label: "Link / activación", unidad: "link", ejemplo: "Disney, HBO, Gemini, YouTube" },
  gift_card: { label: "Gift Card", unidad: "tarjeta", ejemplo: "Prime Video" },
  creditos: { label: "Créditos", unidad: "crédito", ejemplo: "Lion, Oleada, Stella, LatinTV, MaxPlayer" },
  panel: { label: "Panel / cupos", unidad: "cupo", ejemplo: "Canva, Duolingo" },
  costo_cero: { label: "Costo cero", unidad: "unidad", ejemplo: "Vix" },
});
const MONEDAS = Object.freeze(["HNL", "USDT", "USD"]);
const CATEGORIAS_FIN = Object.freeze({ perfiles: "Perfiles de streaming", tv_digital: "TV Digital", musica: "Música", software: "Software y licencias", cuentas_completas: "Cuentas completas" });
const BINANCE_ID = "binance";

const r2 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const r6 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0; };
const txt = (v, max = 160) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
function slug(v) { return String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }
const ymdOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
function errUsuario(msg) { const e = new Error(msg); e.userError = true; return e; }
function diaAnterior(ymd) { const [y, m, d] = ymd.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d - 1, 12)); return t.toISOString().slice(0, 10); }

// ---------------------------------------------------------------- catálogo (validación)
function validarProducto(p = {}) {
  const nombre = txt(p.nombre, 80); if (!nombre) throw errUsuario("Escriba el nombre del producto.");
  const sku = (txt(p.sku, 30) || slug(nombre)).toUpperCase().replace(/[^A-Z0-9-]/g, "-").slice(0, 30);
  const modelo = String(p.modelo || ""); if (!MODELOS[modelo]) throw errUsuario("Elija el modelo de abastecimiento.");
  const categoria = CATEGORIAS_FIN[p.categoria] ? p.categoria : "perfiles";
  const capacidad = Math.max(1, Math.round(Number(p.capacidad) || 1));
  const duracionDias = Math.max(0, Math.round(Number(p.duracionDias) || 0));
  const c = p.costoRef || {};
  const costoRef = { monto: r6(c.monto), moneda: MONEDAS.includes(c.moneda) ? c.moneda : "HNL", cantidad: Math.max(1, Math.round(Number(c.cantidad) || 1)), nota: txt(c.nota, 160) };
  if (modelo === "costo_cero") costoRef.monto = 0;
  return {
    sku, nombre, categoria, modelo, unidad: txt(p.unidad, 20) || MODELOS[modelo].unidad, duracionDias, capacidad,
    plataformaKey: slug(p.plataformaKey || "").replace(/-/g, ""), costoRef,
    requiereCuentaMadre: modelo === "cuenta_madre", requiereCorreo: !!p.requiereCorreo, requierePin: !!p.requierePin,
    activo: p.activo !== false, notas: txt(p.notas, 300),
  };
}
function validarVariante(v = {}, producto = {}) {
  const nombre = txt(v.nombre, 60); if (!nombre) throw errUsuario("Escriba el nombre de la variante (ej. 1 mes · 3 dispositivos).");
  return {
    productoId: String(producto.sku || v.productoId || ""), nombre,
    duracionMeses: Math.max(0, Number(v.duracionMeses) || 0), dispositivos: Math.max(0, Math.round(Number(v.dispositivos) || 0)),
    consumo: Math.max(0, Number(v.consumo ?? 1)), // créditos/cupos que consume UNA venta (Stella 3 disp. = 1 crédito)
    activo: v.activo !== false, notas: txt(v.notas, 200),
  };
}
function validarProveedor(p = {}) {
  const alias = txt(p.alias, 60); if (!alias) throw errUsuario("Escriba el nombre del proveedor.");
  return { alias, pais: txt(p.pais, 40), moneda: MONEDAS.includes(p.moneda) ? p.moneda : "USDT", metodoPago: txt(p.metodoPago, 40), activo: p.activo !== false, notas: txt(p.notas, 300) };
}

// ---------------------------------------------------------------- precios con historial
function precioVigente(versiones = [], fecha) {
  return versiones.filter((v) => v.desde <= fecha && (!v.hasta || v.hasta >= fecha)).sort((a, b) => b.desde.localeCompare(a.desde))[0] || null;
}
// Nueva versión de precio: la anterior se CIERRA el día antes; nunca se edita su precio.
function planNuevoPrecio(versiones = [], { precioHnl, desde }) {
  const precio = r2(precioHnl);
  if (!(precio > 0)) throw errUsuario("Escriba el precio de venta en Lempiras (mayor que 0).");
  if (!ymdOk(desde)) throw errUsuario("Fecha desde inválida.");
  if (versiones.some((v) => v.desde >= desde)) throw errUsuario("Ya hay un precio con esa fecha o posterior. Use una fecha más nueva.");
  const abiertas = versiones.filter((v) => !v.hasta || v.hasta >= desde);
  return { cerrar: abiertas.map((v) => ({ id: v.id, hasta: diaAnterior(desde) })), nueva: { precioHnl: precio, desde, hasta: null } };
}
// Términos del proveedor: cambiar el costo de referencia agrega una versión (los lotes guardan su propio costo).
function agregarTermino(terminos = [], t = {}, hoy) {
  const productoId = String(t.productoId || ""); if (!productoId) throw errUsuario("Elija el producto del término.");
  const costo = r6(t.costoRef); if (!(costo >= 0)) throw errUsuario("Costo de referencia inválido.");
  const desde = ymdOk(t.desde) ? t.desde : hoy;
  const previos = terminos.map((x) => (x.productoId === productoId && !x.hasta ? { ...x, hasta: diaAnterior(desde) < x.desde ? x.desde : diaAnterior(desde) } : x));
  return [...previos, { productoId, costoRef: costo, moneda: MONEDAS.includes(t.moneda) ? t.moneda : "USDT", cantidad: Math.max(1, Math.round(Number(t.cantidad) || 1)), minimo: Math.max(0, Math.round(Number(t.minimo) || 0)), nota: txt(t.nota, 160), desde, hasta: null }];
}

// ---------------------------------------------------------------- Binance (USDT) · costo promedio ponderado
function estadoBilleteraVacio() { return { id: BINANCE_ID, nombre: "Binance", moneda: "USDT", saldo: 0, valorHnl: 0, costoPromedio: 0, ultimaTasa: 0, recargas: 0 }; }
function aplicarRecarga(est = estadoBilleteraVacio(), { hnl, usdt }) {
  const h = r2(hnl), u = r6(usdt);
  if (!(h > 0)) throw errUsuario("Escriba los Lempiras que salieron del banco.");
  if (!(u > 0)) throw errUsuario("Escriba los USDT que recibió en Binance.");
  const tasa = r6(h / u);
  const saldo = r6((est.saldo || 0) + u), valorHnl = r2((est.valorHnl || 0) + h);
  return { estado: { ...est, saldo, valorHnl, costoPromedio: saldo > 0 ? r6(valorHnl / saldo) : 0, ultimaTasa: tasa, recargas: (est.recargas || 0) + 1 }, tasa, hnl: h, usdt: u };
}
// Salida de USDT (pago a proveedor, Fase 2): sale al costo promedio actual; el promedio NO cambia.
function aplicarSalida(est = estadoBilleteraVacio(), usdt) {
  const u = r6(usdt);
  if (!(u > 0)) throw errUsuario("Monto USDT inválido.");
  if (u > (est.saldo || 0) + 1e-6) throw errUsuario(`Saldo insuficiente en Binance: tiene ${r6(est.saldo)} USDT.`);
  const costoHnl = r2(u * (est.costoPromedio || 0));
  const saldo = r6(est.saldo - u);
  return { estado: { ...est, saldo, valorHnl: saldo > 0 ? r2(est.valorHnl - costoHnl) : 0, costoPromedio: saldo > 0 ? est.costoPromedio : 0 }, costoHnl, usdt: u };
}
// Ajuste a saldo real: la diferencia se valora al costo promedio (o a la última tasa si no hay saldo).
function aplicarAjuste(est = estadoBilleteraVacio(), saldoCorrecto) {
  const nuevo = r6(saldoCorrecto);
  if (!(nuevo >= 0)) throw errUsuario("Escriba el saldo correcto en USDT (0 o más).");
  const delta = r6(nuevo - (est.saldo || 0));
  if (!delta) throw errUsuario("El saldo ya es ese. No hay nada que ajustar.");
  const tasa = est.costoPromedio || est.ultimaTasa || 0;
  const deltaHnl = r2(delta * tasa);
  const valorHnl = nuevo > 0 ? r2((est.valorHnl || 0) + deltaHnl) : 0;
  return { estado: { ...est, saldo: nuevo, valorHnl, costoPromedio: nuevo > 0 && valorHnl > 0 ? r6(valorHnl / nuevo) : (nuevo > 0 ? tasa : 0) }, delta, deltaHnl };
}

// ---------------------------------------------------------------- semilla: datos del PDF (08/10/2026)
// Precios con rango en el PDF (ej. L70–80) se cargan con el valor alto y la nota del rango: se editan con "Cambiar precio".
const P = (sku, nombre, categoria, modelo, extra = {}) => ({ sku, nombre, categoria, modelo, ...extra });
const SEMILLA = Object.freeze({
  productos: [
    P("NFX-VIP", "Netflix VIP", "perfiles", "unidad", { plataformaKey: "vipnetflix", duracionDias: 30, capacidad: 1, costoRef: { monto: 2.5, moneda: "USDT", cantidad: 1, nota: "Deku Perú 2.50; Trap Colombia 25+ a 2.50; otras 2.70" }, notas: "Miembro extra individual, 1 persona." }),
    P("NFX-PREM", "Netflix Premium propio", "perfiles", "cuenta_madre", { plataformaKey: "netflix", duracionDias: 30, capacidad: 7, costoRef: { monto: 377, moneda: "HNL", cantidad: 1, nota: "Tarjeta: base L237 + 2 extras de L70" }, requierePin: true, notas: "5 perfiles compartidos + 2 miembros extra." }),
    P("PRIME", "Prime Video", "perfiles", "gift_card", { plataformaKey: "primevideo", duracionDias: 90, capacidad: 5, costoRef: { monto: 12.9, moneda: "USD", cantidad: 1, nota: "Eneba aprox. USD 12.90–13; usar cargo real de tarjeta en HNL" }, requierePin: true, notas: "3 meses, 5 perfiles." }),
    P("HBO-LINK", "HBO links", "perfiles", "link", { plataformaKey: "hbomax", duracionDias: 0, capacidad: 1, costoRef: { monto: 0, moneda: "USDT", cantidad: 1, nota: "Costo y duración variables: registrar lote y vigencia real" } }),
    P("HBO-PLAT", "HBO Platinum", "perfiles", "cuenta_madre", { plataformaKey: "hbomax", duracionDias: 365, capacidad: 5, costoRef: { monto: 3.5, moneda: "USDT", cantidad: 1, nota: "Binance, por cuenta" }, requierePin: true, notas: "1 año; 5 perfiles." }),
    P("DIS-PREM", "Disney Premium (link)", "perfiles", "link", { plataformaKey: "disneyp", duracionDias: 30, capacidad: 1, costoRef: { monto: 8.5, moneda: "USDT", cantidad: 1, nota: "Link 8.00–8.50 USDT; dura 1, 2 o 3 meses" } }),
    P("PARAMOUNT", "Paramount+", "perfiles", "cuenta_madre", { plataformaKey: "paramount", duracionDias: 30, capacidad: 4, costoRef: { monto: 150, moneda: "HNL", cantidad: 1, nota: "L150/mes" } }),
    P("CRUNCHY", "Crunchyroll", "perfiles", "cuenta_madre", { plataformaKey: "crunchyroll", duracionDias: 365, capacidad: 4, costoRef: { monto: 450, moneda: "HNL", cantidad: 1, nota: "L450/año, tarjeta" }, requierePin: true }),
    P("VIX", "Vix", "perfiles", "costo_cero", { plataformaKey: "vix", duracionDias: 30, capacidad: 1, notas: "Costo directo L0: margen bruto 100%; los gastos generales van aparte." }),
    P("LION", "Lion TV", "tv_digital", "creditos", { plataformaKey: "liontv", duracionDias: 30, capacidad: 1, costoRef: { monto: 7500, moneda: "HNL", cantidad: 100, nota: "L7,500 por 100 créditos" }, notas: "1 crédito activa 1–3 pantallas." }),
    P("OLEADA-1", "Oleada 1 dispositivo", "tv_digital", "creditos", { plataformaKey: "oleada", duracionDias: 30, capacidad: 1, costoRef: { monto: 18, moneda: "USDT", cantidad: 20, nota: "20 créditos por 18 USDT" }, notas: "1 crédito = 1 acceso." }),
    P("OLEADA-3", "Oleada 3 dispositivos", "tv_digital", "creditos", { plataformaKey: "oleada", duracionDias: 30, capacidad: 1, costoRef: { monto: 35, moneda: "USDT", cantidad: 20, nota: "20 créditos por 35 USDT" }, notas: "1 crédito = plan 3 accesos." }),
    P("STELLA", "Stella TV", "tv_digital", "creditos", { plataformaKey: "stellatv", duracionDias: 30, capacidad: 1, costoRef: { monto: 37.5, moneda: "USDT", cantidad: 15, nota: "15 créditos por 37.50 USDT" }, notas: "1 crédito activa hasta 3 dispositivos." }),
    P("LATINTV", "LatinTV", "tv_digital", "creditos", { plataformaKey: "latintv", duracionDias: 30, capacidad: 1, costoRef: { monto: 200, moneda: "USDT", cantidad: 200, nota: "Último lote: 200 USDT por 200 créditos" }, notas: "1 crédito activa hasta 4 dispositivos; tarifario 1–4 pantallas editable." }),
    P("MAXPLAYER", "MaxPlayer", "tv_digital", "creditos", { plataformaKey: "maxplayer", duracionDias: 365, capacidad: 1, costoRef: { monto: 83, moneda: "HNL", cantidad: 5, nota: "5 créditos por L83" }, notas: "Reproductor IPTV; 1 crédito por licencia. Costo separado del servicio IPTV." }),
    P("SPOTIFY-FAM", "Spotify Familiar", "musica", "cuenta_madre", { plataformaKey: "spotify", duracionDias: 30, capacidad: 5, costoRef: { monto: 320, moneda: "HNL", cantidad: 1, nota: "L320/mes" }, notas: "5 invitaciones." }),
    P("YOUTUBE", "YouTube Premium (link)", "musica", "link", { plataformaKey: "youtube", duracionDias: 90, capacidad: 1, costoRef: { monto: 85, moneda: "HNL", cantidad: 1, nota: "Link de 3 meses L85" } }),
    P("CANVA", "Canva", "software", "panel", { plataformaKey: "canva", duracionDias: 1095, capacidad: 500, costoRef: { monto: 25, moneda: "USDT", cantidad: 1, nota: "Panel 25 USDT por 500 accesos, 3 años" } }),
    P("GEMINI", "Gemini Pro (link)", "software", "link", { plataformaKey: "gemini", duracionDias: 540, capacidad: 1, costoRef: { monto: 1.4, moneda: "USDT", cantidad: 1, nota: "Link 1.40 USDT; activa al Gmail del cliente; 18 meses" } }),
    P("DUOLINGO", "Duolingo", "software", "panel", { plataformaKey: "duolingo", duracionDias: 365, capacidad: 6, costoRef: { monto: 10, moneda: "USDT", cantidad: 1, nota: "Panel familiar 10 USDT/año" }, notas: "Capacidad del panel configurable (puesta en 6)." }),
    P("OFFICE365", "Office 365", "software", "unidad", { plataformaKey: "office", duracionDias: 365, capacidad: 1, costoRef: { monto: 6.9, moneda: "USDT", cantidad: 1, nota: "6.90 USDT por licencia, Binance" } }),
  ],
  // [sku, nombre, meses, dispositivos, consumo, precioHnl|null, nota]
  variantes: [
    ["NFX-VIP", "1 mes · 1 persona", 1, 1, 1, null, "Precio no indicado en el PDF"],
    ["NFX-PREM", "Perfil 1 mes", 1, 1, 1, 130, ""],
    ["NFX-PREM", "Miembro extra 1 mes", 1, 1, 1, null, "Precio no indicado en el PDF"],
    ["PRIME", "Perfil 1 mes", 1, 1, 1, 80, "Rango L70–80"],
    ["HBO-LINK", "Link", 1, 1, 1, null, "Precio no indicado en el PDF"],
    ["HBO-PLAT", "Perfil 1 mes", 1, 1, 1, 80, ""],
    ["DIS-PREM", "Link", 1, 1, 1, null, "Precio no indicado en el PDF"],
    ["PARAMOUNT", "Perfil 1 mes", 1, 1, 1, 80, ""],
    ["CRUNCHY", "Perfil 1 mes", 1, 1, 1, 80, "Rango L70–80"],
    ["VIX", "1 mes", 1, 1, 1, null, "Precio no indicado en el PDF"],
    ["LION", "1 mes · 1 pantalla", 1, 1, 1, 250, ""],
    ["LION", "1 mes · 2 pantallas", 1, 2, 1, 275, ""],
    ["LION", "1 mes · 3 pantallas", 1, 3, 1, 300, ""],
    ["OLEADA-1", "1 mes · 1 dispositivo", 1, 1, 1, 90, ""],
    ["OLEADA-3", "1 mes · 3 dispositivos", 1, 3, 1, 200, ""],
    ["STELLA", "1 mes · 1 dispositivo", 1, 1, 1, 130, ""],
    ["STELLA", "1 mes · 2 dispositivos", 1, 2, 1, 170, ""],
    ["STELLA", "1 mes · 3 dispositivos", 1, 3, 1, 200, ""],
    ["LATINTV", "1 mes · 1 pantalla", 1, 1, 1, null, "Tarifario 1–4 pantallas por definir"],
    ["LATINTV", "1 mes · 2 pantallas", 1, 2, 1, null, ""],
    ["LATINTV", "1 mes · 3 pantallas", 1, 3, 1, null, ""],
    ["LATINTV", "1 mes · 4 pantallas", 1, 4, 1, null, ""],
    ["MAXPLAYER", "Licencia", 12, 1, 1, null, "Precio no indicado en el PDF"],
    ["SPOTIFY-FAM", "Invitación 1 mes", 1, 1, 1, 110, "Rango L100–110"],
    ["YOUTUBE", "Link 3 meses", 3, 1, 1, 300, ""],
    ["CANVA", "1 mes", 1, 1, 1, 50, "Planes flexibles; desde L50/mes"],
    ["GEMINI", "1 mes", 1, 1, 1, 150, ""],
    ["DUOLINGO", "1 mes", 1, 1, 1, 80, ""],
    ["OFFICE365", "1 año", 12, 1, 1, 300, ""],
  ],
  proveedores: [
    { alias: "Deku Perú", pais: "Perú", moneda: "USDT", metodoPago: "Binance", terminos: [{ productoId: "NFX-VIP", costoRef: 2.5, moneda: "USDT", nota: "" }] },
    { alias: "Trap Colombia", pais: "Colombia", moneda: "USDT", metodoPago: "Binance", terminos: [{ productoId: "NFX-VIP", costoRef: 2.5, moneda: "USDT", minimo: 25, nota: "25 o más a 2.50; otras compras 2.70" }] },
    { alias: "Eneba", pais: "Internacional", moneda: "USD", metodoPago: "Tarjeta", terminos: [{ productoId: "PRIME", costoRef: 12.9, moneda: "USD", nota: "Gift card; usar cargo real de tarjeta en HNL" }] },
    { alias: "Pago directo (tarjeta)", pais: "Honduras", moneda: "HNL", metodoPago: "Tarjeta", terminos: [
      { productoId: "NFX-PREM", costoRef: 377, moneda: "HNL", nota: "Base L237 + 2 extras de L70" }, { productoId: "PARAMOUNT", costoRef: 150, moneda: "HNL" },
      { productoId: "CRUNCHY", costoRef: 450, moneda: "HNL", nota: "Anual" }, { productoId: "SPOTIFY-FAM", costoRef: 320, moneda: "HNL" }] },
  ],
});
const PRECIOS_DESDE_SEMILLA = "2026-10-01";
const varianteIdDe = (sku, nombre) => `${sku}__${slug(nombre)}`;


// ---------------------------------------------------------------- FASE 2 · compras por lote, inventario y créditos
// Una compra NO es gasto: baja la cuenta de pago (banco o Binance) y sube el INVENTARIO con un lote histórico.
// El costo en Lempiras del lote queda fijo para siempre: cambiar precios, tasas o costos de referencia no lo toca.
const PAGOS_COMPRA = Object.freeze({ binance: "Binance (USDT)", banco: "Banco (Lempiras)", credito: "A crédito (por pagar al proveedor)", inicial: "Inventario inicial (ya lo tenía)" });
// Costea la compra en Lempiras según cómo se pagó.
//  · USDT pagado con Binance → sale al COSTO PROMEDIO de Binance (Prueba B: 62.50 × 28.20 = L1,762.50).
//  · Lempiras pagados del banco → el costo es lo pagado.
//  · USD/USDT pagados con banco o tarjeta → se usa el CARGO REAL en Lempiras (obligatorio).
//  · Inventario inicial → Lempiras directos, o USDT al costo promedio/última tasa de Binance si no se da el cargo.
function costearCompra({ producto = {}, cantidad, costoTotal, moneda, pago = {}, billetera = estadoBilleteraVacio() }) {
  const cant = r6(cantidad); if (!(cant > 0)) throw errUsuario("Escriba la cantidad comprada (unidades, créditos, cupos o links).");
  const cero = producto.modelo === "costo_cero";
  const total = r6(costoTotal); if (!(total > 0) && !cero) throw errUsuario("Escriba el costo total de la compra.");
  const mon = MONEDAS.includes(moneda) ? moneda : "HNL";
  const tipo = PAGOS_COMPRA[pago.tipo] ? pago.tipo : "";
  if (!tipo) throw errUsuario("Elija con qué se pagó la compra.");
  const cargo = r2(pago.cargoHnl);
  let costoTotalHnl, tasa = 0, salida = null;
  if (cero) costoTotalHnl = 0;
  else if (tipo === "binance") {
    if (mon !== "USDT") throw errUsuario("Con Binance la compra se paga en USDT.");
    salida = aplicarSalida(billetera, total);
    costoTotalHnl = salida.costoHnl; tasa = billetera.costoPromedio || 0;
  } else if (mon === "HNL") costoTotalHnl = r2(total);
  else if (cargo > 0) { costoTotalHnl = cargo; tasa = r6(cargo / total); }
  else if ((tipo === "inicial" || tipo === "credito") && mon === "USDT" && (billetera.costoPromedio || billetera.ultimaTasa)) { tasa = billetera.costoPromedio || billetera.ultimaTasa; costoTotalHnl = r2(total * tasa); }
  else throw errUsuario(`Escriba el cargo real en Lempiras de esa compra en ${mon}.`);
  return { cantidad: cant, moneda: mon, costoTotalMoneda: total, costoUnitarioMoneda: r6(total / cant), tasa, costoTotalHnl: r2(costoTotalHnl), costoUnitarioHnl: r6(costoTotalHnl / cant), salidaBinance: salida };
}
const vencido = (l, hoy) => !!(l.vigenciaHasta && l.vigenciaHasta < hoy);
// Consumo PEPS (primero en entrar, primero en salir): usa primero el lote más viejo vigente.
// Devuelve qué lote se consume y a qué costo. Prueba C: Stella 3 dispositivos consume 1 crédito (consumo de la variante).
function consumirPEPS(lotes = [], cantidad, hoy = "") {
  let falta = r6(cantidad);
  const usables = lotes.filter((l) => r6(l.disponible) > 0 && !vencido(l, hoy)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.id).localeCompare(String(b.id)));
  const consumos = [];
  for (const l of usables) {
    if (falta <= 0) break;
    const toma = Math.min(falta, r6(l.disponible));
    consumos.push({ loteId: l.id, cantidad: r6(toma), costoUnitarioHnl: r6(l.costoUnitarioHnl), costoHnl: r2(toma * (l.costoUnitarioHnl || 0)) });
    falta = r6(falta - toma);
  }
  return { consumos, costoHnl: r2(consumos.reduce((s, c) => s + c.costoHnl, 0)), faltante: falta > 0 ? falta : 0 };
}
// Resumen de inventario por producto: existencias, valor en libros, costo promedio, próximos vencimientos y stock bajo.
function resumenInventario(productos = [], lotes = [], hoy = "") {
  const en30 = (() => { const [y, m, d] = hoy.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + 30, 12)).toISOString().slice(0, 10); })();
  return productos.map((p) => {
    const ls = lotes.filter((l) => l.productoId === p.id);
    const vig = ls.filter((l) => !vencido(l, hoy)), venc = ls.filter((l) => vencido(l, hoy) && r6(l.disponible) > 0);
    const disponible = r6(vig.reduce((s, l) => s + r6(l.disponible), 0));
    const valorHnl = r2(vig.reduce((s, l) => s + r6(l.disponible) * (l.costoUnitarioHnl || 0), 0));
    const comprado = r6(ls.reduce((s, l) => s + r6(l.cantidad), 0)), consumido = r6(ls.reduce((s, l) => s + r6(l.consumido), 0));
    const proximo = vig.filter((l) => l.vigenciaHasta && r6(l.disponible) > 0).map((l) => l.vigenciaHasta).sort()[0] || "";
    const bajo = ls.length > 0 && disponible <= Math.max(2, Math.ceil(comprado * 0.15));
    return { productoId: p.id, nombre: p.nombre, modelo: p.modelo, unidad: p.unidad, lotes: ls.length, comprado, consumido, disponible, valorHnl, costoPromedioHnl: disponible > 0 ? r6(valorHnl / disponible) : 0, proximoVencimiento: proximo, vencePronto: !!(proximo && proximo <= en30), vencidoSinUsar: { cantidad: r6(venc.reduce((s, l) => s + r6(l.disponible), 0)), valorHnl: r2(venc.reduce((s, l) => s + r6(l.disponible) * (l.costoUnitarioHnl || 0), 0)) }, stockBajo: bajo && p.modelo !== "costo_cero" };
  }).filter((r) => r.lotes > 0);
}

// ---------------------------------------------------------------- manejador /api/finanzas
const ACCIONES_EMPRESA = Object.freeze(["fin_empresa_estado", "fin_sembrar_catalogo", "fin_producto_guardar", "fin_variante_guardar", "fin_precio_nuevo", "fin_proveedor_guardar", "fin_proveedor_termino", "fin_binance_recargar", "fin_binance_ajustar", "fin_compra_registrar", "fin_lote_ajustar", "fin_costeo_config", "fin_costear", "fin_cxp_pagar", "fin_tablero", "fin_retiro_registrar", "fin_finance_os_config", "fin_respaldo"]);

async function handleEmpresa(db, accion, body, identity, authUser, res, d) {
  if (!d.canUseLibro(identity)) return res.status(403).json({ ok: false, error: "Finanzas empresarial es exclusivo de Sublicuentas y Relojes." });
  const hoy = d.hoyYmdHN(), ahora = new Date().toISOString(), actor = identity.usuario;
  const run = (fn) => db.runTransaction(fn).catch((e) => { if (e.userError) return { error: e.message }; throw e; });
  const reply = (r) => res.status(200).json(r && r.error ? { ok: false, error: r.error } : { ok: true, accion, ...r });
  const col = (c) => db.collection(c);
  const todos = async (c) => { const s = await col(c).get(); return s.docs.map((x) => ({ id: x.id, ...(x.data() || {}) })); };
  const audit = (tx, ev) => d.auditar(tx, db, identity, { origen: body.origen || "web", modulo: "finanzas_empresa", ...ev });
  const billeteraRef = col("fin_billeteras").doc(BINANCE_ID);

  if (accion === "fin_empresa_estado") {
    let costeoCorrida = null; // R137: al abrir 🏢 Empresa se costean las ventas nuevas (idempotente)
    if (d.costeoDeps) { try { costeoCorrida = await correrCosteo(db, { ...d.costeoDeps(db), hoy, actor: "sistema", limite: 150 }); } catch (e) { costeoCorrida = { error: String(e?.message || e).slice(0, 200) }; } }
    const [productos, variantes, precios, proveedores, bSnap] = await Promise.all([todos("fin_productos"), todos("fin_variantes"), todos("fin_precios"), todos("fin_proveedores"), billeteraRef.get()]);
    const movsSnap = await col("finanzas_movimientos").where("billeteraId", "==", BINANCE_ID).get().catch(() => ({ docs: [] }));
    const [lotes, bodegaSnap] = await Promise.all([todos("fin_lotes"), col("inventario").get().catch(() => ({ docs: [] }))]);
    const cuentasBodega = bodegaSnap.docs.map((x) => { const c = x.data() || {}; return { id: x.id, plataforma: c.plataforma || "", correo: c.correo || "", capacidad: Number(c.capacidad || 0), disponibles: Number(c.disponibles || 0) }; });
    const movsBinance = movsSnap.docs.map((x) => ({ id: x.id, ...(x.data() || {}) })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 60);
    const vars = variantes.map((v) => {
      const hist = precios.filter((p) => p.varianteId === v.id).sort((a, b) => b.desde.localeCompare(a.desde));
      return { ...v, precioVigente: precioVigente(hist, hoy), historialPrecios: hist };
    });
    return res.status(200).json({ ok: true, accion, hoy, modelos: MODELOS, categorias: CATEGORIAS_FIN, monedas: MONEDAS,
      productos: productos.sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => ({ ...p, variantes: vars.filter((v) => v.productoId === p.id) })),
      proveedores: proveedores.sort((a, b) => a.alias.localeCompare(b.alias)),
      billetera: bSnap.exists ? { ...estadoBilleteraVacio(), ...bSnap.data() } : estadoBilleteraVacio(), movimientosBinance: movsBinance,
      pagosCompra: PAGOS_COMPRA, lotes: lotes.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 400),
      inventario: resumenInventario(productos, lotes, hoy), cuentasBodega,
      cxp: await resumenCxp(col, hoy), cxc: await resumenCxc(col, hoy),
      costeo: await resumenCosteo(col, body.mes && /^\d{4}-\d{2}$/.test(String(body.mes)) ? String(body.mes) : hoy.slice(0, 7), costeoCorrida) });
  }

  if (accion === "fin_sembrar_catalogo") { // idempotente: solo crea lo que falta; nunca pisa lo que el usuario ya editó
    const r = await run(async (tx) => {
      const refsP = SEMILLA.productos.map((p) => col("fin_productos").doc(p.sku));
      const refsV = SEMILLA.variantes.map(([sku, nombre]) => col("fin_variantes").doc(varianteIdDe(sku, nombre)));
      const refsS = SEMILLA.proveedores.map((p) => col("fin_proveedores").doc(slug(p.alias)));
      const [sP, sV, sS] = await Promise.all([Promise.all(refsP.map((x) => tx.get(x))), Promise.all(refsV.map((x) => tx.get(x))), Promise.all(refsS.map((x) => tx.get(x)))]);
      let productos = 0, variantes = 0, precios = 0, proveedores = 0;
      SEMILLA.productos.forEach((p, i) => { if (sP[i].exists) return; tx.set(refsP[i], { ...validarProducto(p), createdAt: ahora, updatedAt: ahora, createdBy: actor, origenSemilla: "pdf_2026-10-08" }); productos++; });
      SEMILLA.variantes.forEach(([sku, nombre, meses, disp, consumo, precio, nota], i) => {
        if (sV[i].exists) return;
        tx.set(refsV[i], { ...validarVariante({ nombre, duracionMeses: meses, dispositivos: disp, consumo, notas: nota }, { sku }), createdAt: ahora, updatedAt: ahora, createdBy: actor }); variantes++;
        if (precio) { tx.set(col("fin_precios").doc(`${refsV[i].id}__${PRECIOS_DESDE_SEMILLA}`), { varianteId: refsV[i].id, productoId: sku, precioHnl: precio, desde: PRECIOS_DESDE_SEMILLA, hasta: null, canal: "general", nota, createdBy: actor, createdAt: ahora }); precios++; }
      });
      SEMILLA.proveedores.forEach((p, i) => { if (sS[i].exists) return; tx.set(refsS[i], { ...validarProveedor(p), terminos: p.terminos.reduce((acc, t) => agregarTermino(acc, { ...t, desde: PRECIOS_DESDE_SEMILLA }, hoy), []), createdAt: ahora, updatedAt: ahora, createdBy: actor }); proveedores++; });
      audit(tx, { accion: "sembrar_catalogo", targetType: "catalogo_financiero", detalle: `Catálogo del PDF: ${productos} productos, ${variantes} variantes, ${precios} precios, ${proveedores} proveedores` });
      return { productos, variantes, precios, proveedores };
    });
    return reply(r);
  }

  if (accion === "fin_producto_guardar") {
    const r = await run(async (tx) => {
      const p = validarProducto(body.producto || {});
      const ref = col("fin_productos").doc(String(body.producto?.id || p.sku));
      const snap = await tx.get(ref);
      if (!body.producto?.id && snap.exists) throw errUsuario(`Ya existe un producto con el código ${p.sku}.`);
      const antes = snap.exists ? snap.data() : null;
      tx.set(ref, { ...p, sku: ref.id, updatedAt: ahora, ...(snap.exists ? {} : { createdAt: ahora, createdBy: actor }) }, { merge: true });
      audit(tx, { accion: snap.exists ? "editar_producto" : "crear_producto", targetType: "producto", targetId: ref.id, before: antes ? { nombre: antes.nombre ?? null, modelo: antes.modelo ?? null, capacidad: antes.capacidad ?? null, costoRef: antes.costoRef ?? null, activo: antes.activo ?? null } : null, after: { nombre: p.nombre, modelo: p.modelo, capacidad: p.capacidad, costoRef: p.costoRef, activo: p.activo }, motivo: txt(body.motivo, 200) });
      return { productoId: ref.id };
    });
    return reply(r);
  }

  if (accion === "fin_variante_guardar") {
    const r = await run(async (tx) => {
      const prodRef = col("fin_productos").doc(String(body.variante?.productoId || ""));
      const prod = await tx.get(prodRef); if (!prod.exists) throw errUsuario("Producto no encontrado.");
      const v = validarVariante(body.variante || {}, { sku: prodRef.id });
      const ref = col("fin_variantes").doc(String(body.variante?.id || varianteIdDe(prodRef.id, v.nombre)));
      const snap = await tx.get(ref);
      if (!body.variante?.id && snap.exists) throw errUsuario("Ya existe una variante con ese nombre en este producto.");
      tx.set(ref, { ...v, updatedAt: ahora, ...(snap.exists ? {} : { createdAt: ahora, createdBy: actor }) }, { merge: true });
      audit(tx, { accion: snap.exists ? "editar_variante" : "crear_variante", targetType: "variante", targetId: ref.id, after: v });
      return { varianteId: ref.id };
    });
    return reply(r);
  }

  if (accion === "fin_precio_nuevo") { // nunca se edita una versión: se cierra la vigente y se crea otra
    const varianteId = String(body.varianteId || "");
    const desde = ymdOk(body.desde) ? body.desde : hoy;
    const r = await run(async (tx) => {
      const versSnap = await tx.get(col("fin_precios").where("varianteId", "==", varianteId)); // R140: dentro de la transacción (dos cambios a la vez no se pisan)
      const versiones = versSnap.docs.map((x) => ({ id: x.id, ...(x.data() || {}) }));
      const vRef = col("fin_variantes").doc(varianteId); const v = await tx.get(vRef);
      if (!v.exists) throw errUsuario("Variante no encontrada.");
      const plan = planNuevoPrecio(versiones, { precioHnl: body.precioHnl, desde });
      const antes = precioVigente(versiones, desde);
      plan.cerrar.forEach((c) => tx.set(col("fin_precios").doc(c.id), { hasta: c.hasta, cerradoPor: actor, cerradoAt: ahora }, { merge: true }));
      const ref = col("fin_precios").doc(`${varianteId}__${desde}`);
      tx.set(ref, { ...plan.nueva, varianteId, productoId: v.data().productoId, canal: "general", nota: txt(body.motivo, 160), createdBy: actor, createdAt: ahora });
      audit(tx, { accion: "cambiar_precio", targetType: "variante", targetId: varianteId, before: { precioHnl: antes?.precioHnl ?? null }, after: { precioHnl: plan.nueva.precioHnl, desde }, motivo: txt(body.motivo, 200), detalle: `${v.data().nombre}: L${antes?.precioHnl ?? "—"} → L${plan.nueva.precioHnl} desde ${desde}` });
      return { precioId: ref.id, cerradas: plan.cerrar.length };
    });
    return reply(r);
  }

  if (accion === "fin_proveedor_guardar") {
    const r = await run(async (tx) => {
      const p = validarProveedor(body.proveedor || {});
      const ref = col("fin_proveedores").doc(String(body.proveedor?.id || slug(p.alias)));
      const snap = await tx.get(ref);
      if (!body.proveedor?.id && snap.exists) throw errUsuario("Ya existe un proveedor con ese nombre.");
      tx.set(ref, { ...p, updatedAt: ahora, ...(snap.exists ? {} : { createdAt: ahora, createdBy: actor, terminos: [] }) }, { merge: true });
      audit(tx, { accion: snap.exists ? "editar_proveedor" : "crear_proveedor", targetType: "proveedor", targetId: ref.id, after: p });
      return { proveedorId: ref.id };
    });
    return reply(r);
  }

  if (accion === "fin_proveedor_termino") { // costo de referencia nuevo = versión nueva; lo viejo queda con "hasta"
    const r = await run(async (tx) => {
      const ref = col("fin_proveedores").doc(String(body.proveedorId || ""));
      const snap = await tx.get(ref); if (!snap.exists) throw errUsuario("Proveedor no encontrado.");
      const prod = await tx.get(col("fin_productos").doc(String(body.termino?.productoId || ""))); if (!prod.exists) throw errUsuario("Producto no encontrado.");
      const terminos = agregarTermino(snap.data().terminos || [], body.termino || {}, hoy);
      tx.set(ref, { terminos, updatedAt: ahora }, { merge: true });
      const t = terminos[terminos.length - 1];
      audit(tx, { accion: "costo_referencia_proveedor", targetType: "proveedor", targetId: ref.id, after: t, detalle: `${snap.data().alias} · ${prod.data().nombre}: ${t.costoRef} ${t.moneda} desde ${t.desde}` });
      return { proveedorId: ref.id, terminos: terminos.length };
    });
    return reply(r);
  }

  if (accion === "fin_binance_recargar") { // Prueba A: BAC −L2,820 · Binance +100 USDT · gasto L0 · tasa 28.20
    const methods = await d.loadMethods(db);
    const banco = methods.find((m) => m.id === String(body.bancoId || ""));
    if (!banco) return res.status(200).json({ ok: false, error: "Elija el banco de donde salieron los Lempiras." });
    const opId = d.libroOpDocId("binrec", body, authUser.uid);
    if (!opId) return res.status(200).json({ ok: false, error: "Falta operationId (actualice la app)." });
    const fecha = ymdOk(body.fecha) && body.fecha <= hoy ? body.fecha : hoy;
    const refOut = col("finanzas_movimientos").doc(opId), refIn = col("finanzas_movimientos").doc(`${opId}_usdt`);
    const r = await run(async (tx) => {
      if ((await tx.get(refOut)).exists) return { duplicado: true };
      const bSnap = await tx.get(billeteraRef);
      const { saldos } = await d.estadoLibro(db, tx);
      const est = bSnap.exists ? { ...estadoBilleteraVacio(), ...bSnap.data() } : estadoBilleteraVacio();
      const rec = aplicarRecarga(est, { hnl: body.hnl, usdt: body.usdt });
      const b = saldos.bancos.find((x) => x.id === banco.id);
      if (b && rec.hnl > b.saldo + 0.001 && !body.forzar) throw errUsuario(`Saldo insuficiente en ${banco.nombre} según el libro (Lps. ${b.saldo}). Si el banco sí lo tiene, revise movimientos pendientes.`);
      const comun = { ...d.baseMov(identity, authUser, body), operationId: String(body.operationId), transferenciaId: refOut.id, referencia: txt(body.referencia, 80), nota: txt(body.nota, 160), ...d.canonicalFinanceDate(fecha, hoy) };
      // Lado banco: TRANSFERENCIA de salida (no es gasto). Cierres, cuadre y saldos la tratan como hoy.
      tx.set(refOut, { ...comun, movimientoId: refOut.id, tipo: "transferencia", subtipo: "recarga_binance", direccion: "salida", monto: rec.hnl, bancoId: banco.id, banco: banco.nombre, contraparteId: BINANCE_ID, montoUsdt: rec.usdt, tasa: rec.tasa });
      // Lado Binance: movimiento de BILLETERA en USDT con su valor contable en Lempiras.
      tx.set(refIn, { ...comun, movimientoId: refIn.id, tipo: "billetera", subtipo: "recarga", direccion: "entrada", billeteraId: BINANCE_ID, moneda: "USDT", montoUsdt: rec.usdt, monto: rec.hnl, tasa: rec.tasa, contraparteId: banco.id, banco: "Binance", saldoUsdtAntes: est.saldo, saldoUsdtDespues: rec.estado.saldo, costoPromedioDespues: rec.estado.costoPromedio });
      tx.set(billeteraRef, { ...rec.estado, updatedAt: ahora });
      audit(tx, { accion: "recarga_binance", targetType: "billetera", targetId: BINANCE_ID, movimientoId: refOut.id, operationId: String(body.operationId), monto: rec.hnl, detalle: `${banco.nombre} −Lps. ${rec.hnl} → Binance +${rec.usdt} USDT · tasa ${rec.tasa}`, before: { saldoUsdt: est.saldo, valorHnl: est.valorHnl }, after: { saldoUsdt: rec.estado.saldo, valorHnl: rec.estado.valorHnl, costoPromedio: rec.estado.costoPromedio } });
      return { duplicado: false, tasa: rec.tasa, billetera: rec.estado, movimientoId: refOut.id };
    });
    return reply(r);
  }

  if (accion === "fin_binance_ajustar") { // solo con motivo; queda en auditoría; no toca el historial
    const motivo = txt(body.motivo, 200);
    if (motivo.length < 4) return res.status(200).json({ ok: false, error: "Escriba el motivo del ajuste." });
    const opId = d.libroOpDocId("binaju", body, authUser.uid);
    if (!opId) return res.status(200).json({ ok: false, error: "Falta operationId (actualice la app)." });
    const ref = col("finanzas_movimientos").doc(opId);
    const r = await run(async (tx) => {
      if ((await tx.get(ref)).exists) return { duplicado: true };
      const bSnap = await tx.get(billeteraRef);
      const est = bSnap.exists ? { ...estadoBilleteraVacio(), ...bSnap.data() } : estadoBilleteraVacio();
      const aj = aplicarAjuste(est, body.saldoCorrecto);
      tx.set(ref, { ...d.baseMov(identity, authUser, body), movimientoId: ref.id, operationId: String(body.operationId), tipo: "billetera", subtipo: "ajuste", direccion: aj.delta > 0 ? "entrada" : "salida", billeteraId: BINANCE_ID, moneda: "USDT", montoUsdt: aj.delta, monto: aj.deltaHnl, banco: "Binance", motivo, saldoUsdtAntes: est.saldo, saldoUsdtDespues: aj.estado.saldo, ...d.canonicalFinanceDate(hoy, hoy) });
      tx.set(billeteraRef, { ...aj.estado, updatedAt: ahora });
      audit(tx, { accion: "ajuste_binance", targetType: "billetera", targetId: BINANCE_ID, movimientoId: ref.id, motivo, monto: aj.deltaHnl, before: { saldoUsdt: est.saldo, valorHnl: est.valorHnl }, after: { saldoUsdt: aj.estado.saldo, valorHnl: aj.estado.valorHnl }, detalle: `Binance ${est.saldo} → ${aj.estado.saldo} USDT (${aj.delta > 0 ? "+" : ""}${aj.delta})` });
      return { duplicado: false, billetera: aj.estado, delta: aj.delta, deltaHnl: aj.deltaHnl };
    });
    return reply(r);
  }
  if (accion === "fin_compra_registrar") { // Prueba B: 25 Netflix VIP × 2.50 USDT → Binance −62.50 · inventario +25 · sin egreso
    const c = body.compra || {};
    const pagoTipo = String(c.pago || "");
    const methods = pagoTipo === "banco" ? await d.loadMethods(db) : [];
    const banco = pagoTipo === "banco" ? methods.find((m) => m.id === String(c.bancoId || "")) : null;
    if (pagoTipo === "banco" && !banco) return res.status(200).json({ ok: false, error: "Elija el banco con que se pagó." });
    if (pagoTipo === "credito" && !c.proveedorId) return res.status(200).json({ ok: false, error: "A crédito: elija a qué proveedor se le debe." });
    const opId = d.libroOpDocId("compra", body, authUser.uid);
    if (!opId) return res.status(200).json({ ok: false, error: "Falta operationId (actualice la app)." });
    const fecha = ymdOk(c.fecha) && c.fecha <= hoy ? c.fecha : hoy;
    const loteRef = col("fin_lotes").doc(opId), movRef = col("finanzas_movimientos").doc(`${opId}_pago`);
    const r = await run(async (tx) => {
      if ((await tx.get(loteRef)).exists) return { duplicado: true, loteId: loteRef.id };
      const pSnap = await tx.get(col("fin_productos").doc(String(c.productoId || "")));
      if (!pSnap.exists) throw errUsuario("Elija el producto comprado.");
      const producto = { id: pSnap.id, ...pSnap.data() };
      let proveedor = null;
      if (c.proveedorId) { const s2 = await tx.get(col("fin_proveedores").doc(String(c.proveedorId))); if (!s2.exists) throw errUsuario("Proveedor no encontrado."); proveedor = { id: s2.id, ...s2.data() }; }
      const bSnap = await tx.get(billeteraRef);
      const billetera = bSnap.exists ? { ...estadoBilleteraVacio(), ...bSnap.data() } : estadoBilleteraVacio();
      const k = costearCompra({ producto, cantidad: c.cantidad, costoTotal: c.costoTotal, moneda: c.moneda, pago: { tipo: pagoTipo, cargoHnl: c.cargoHnl }, billetera });
      if (banco) {
        const { saldos } = await d.estadoLibro(db, tx);
        const b = saldos.bancos.find((x) => x.id === banco.id);
        if (b && k.costoTotalHnl > b.saldo + 0.001 && !c.forzar) throw errUsuario(`Saldo insuficiente en ${banco.nombre} según el libro (Lps. ${b.saldo}).`);
      }
      const dur = Math.max(0, Math.round(Number(c.duracionDias ?? producto.duracionDias) || 0));
      // La vigencia automática solo aplica a lo que de verdad vence como lote (cuenta madre, gift card, panel). Créditos,
      // unidades y links duran X días DESPUÉS de venderse: su lote no vence solo (se puede poner vencimiento a mano).
      const venceSolo = ["cuenta_madre", "gift_card", "panel"].includes(producto.modelo);
      const vigenciaHasta = ymdOk(c.vigenciaHasta) ? c.vigenciaHasta : (dur && venceSolo ? (() => { const [y, m, dd] = fecha.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + dur, 12)).toISOString().slice(0, 10); })() : "");
      const uni = producto.unidad || "unidad", unis = Number(k.cantidad) === 1 ? uni : (/[dlrn]$/i.test(uni) ? `${uni}es` : `${uni}s`);
      const detalle = `${producto.nombre} · ${k.cantidad} ${unis}${proveedor ? ` · ${proveedor.alias}` : ""}`;
      // R137 · Cuenta madre / panel / gift card: el lote se lleva en PERFILES-MES (cuentas × capacidad × meses), así cada
      // perfil vendido carga su parte: Netflix L377 ÷ 7 = L53.86. Lo que no se venda al vencer = "Cupos sin vender".
      const porCupo = CUENTA_MADRE_LIKE.includes(producto.modelo);
      const unidades = porCupo ? cuposMesDe(producto, k.cantidad, dur || producto.duracionDias) : k.cantidad;
      const unitHnl = unidades > 0 ? Math.round((k.costoTotalHnl / unidades) * 1e6) / 1e6 : 0;
      const lote = {
        compraId: loteRef.id, cuentasCompradas: porCupo ? k.cantidad : 0, proveedorId: proveedor?.id || "", proveedor: proveedor?.alias || "", productoId: producto.id, producto: producto.nombre, modelo: producto.modelo, unidad: porCupo ? "perfil-mes" : (producto.unidad || ""),
        cantidad: unidades, disponible: unidades, consumido: 0, moneda: k.moneda, costoUnitarioMoneda: k.costoUnitarioMoneda, costoTotalMoneda: k.costoTotalMoneda, tasa: k.tasa,
        costoTotalHnl: k.costoTotalHnl, costoUnitarioHnl: unitHnl, pago: pagoTipo, cuentaPago: pagoTipo === "binance" ? BINANCE_ID : (banco?.id || ""), cuentaPagoNombre: pagoTipo === "binance" ? "Binance" : pagoTipo === "credito" ? "A crédito (por pagar)" : (banco?.nombre || PAGOS_COMPRA.inicial),
        fecha, vigenciaHasta, duracionDias: dur, capacidadPorUnidad: producto.modelo === "cuenta_madre" ? producto.capacidad : 1,
        cuentaInventarioId: txt(c.cuentaInventarioId, 80), referencia: txt(c.referencia, 80), notas: txt(c.notas, 300),
        operationId: String(body.operationId), movimientoId: pagoTipo === "inicial" ? "" : movRef.id, estado: "activo", createdBy: actor, createdAt: ahora, updatedAt: ahora,
      };
      tx.set(loteRef, lote);
      const comun = { ...d.baseMov(identity, authUser, body), movimientoId: movRef.id, operationId: String(body.operationId), loteId: loteRef.id, productoId: producto.id, proveedorId: proveedor?.id || "", motivo: `Compra · ${detalle}`, ...d.canonicalFinanceDate(fecha, hoy) };
      if (pagoTipo === "binance") {
        tx.set(movRef, { ...comun, tipo: "billetera", subtipo: "pago_proveedor", direccion: "salida", billeteraId: BINANCE_ID, moneda: "USDT", montoUsdt: k.costoTotalMoneda, monto: k.costoTotalHnl, tasa: k.tasa, banco: "Binance", saldoUsdtAntes: billetera.saldo, saldoUsdtDespues: k.salidaBinance.estado.saldo });
        tx.set(billeteraRef, { ...k.salidaBinance.estado, updatedAt: ahora });
      } else if (pagoTipo === "banco") {
        tx.set(movRef, { ...comun, tipo: "compra", subtipo: "compra_inventario", direccion: "salida", monto: k.costoTotalHnl, bancoId: banco.id, banco: banco.nombre, moneda: k.moneda, montoMoneda: k.costoTotalMoneda, tasa: k.tasa });
      } else if (pagoTipo === "credito") { // R138 · compra a crédito: sube inventario y nace la CUENTA POR PAGAR; el banco no se toca hasta pagar
        const vence = ymdOk(c.vencePago) ? c.vencePago : (() => { const [y, m, dd] = fecha.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + 15, 12)).toISOString().slice(0, 10); })();
        const cxpRef = col("fin_cxp").doc(loteRef.id);
        tx.set(movRef, { ...comun, tipo: "compra", subtipo: "compra_credito", direccion: "entrada", monto: k.costoTotalHnl, bancoId: "", banco: "Cuentas por pagar", moneda: k.moneda, montoMoneda: k.costoTotalMoneda, tasa: k.tasa, cxpId: cxpRef.id, proveedor: proveedor.alias });
        tx.set(cxpRef, { cxpId: cxpRef.id, proveedorId: proveedor.id, proveedor: proveedor.alias, loteId: loteRef.id, concepto: detalle, moneda: k.moneda, total: k.costoTotalMoneda, saldo: k.costoTotalMoneda, totalHnl: k.costoTotalHnl, saldoHnl: k.costoTotalHnl, tasa: k.tasa, fecha, vence, estado: "pendiente", pagos: [], movimientoId: movRef.id, createdBy: actor, createdAt: ahora, updatedAt: ahora });
        tx.set(loteRef, { cxpId: cxpRef.id }, { merge: true });
      } else if (k.costoTotalHnl > 0) { // inventario inicial: sube inventario contra capital (sin tocar bancos)
        tx.set(movRef, { ...comun, tipo: "compra", subtipo: "inventario_inicial", direccion: "entrada", monto: k.costoTotalHnl, banco: "Inventario inicial", moneda: k.moneda, montoMoneda: k.costoTotalMoneda, tasa: k.tasa });
        tx.set(loteRef, { movimientoId: movRef.id }, { merge: true });
      }
      audit(tx, { accion: pagoTipo === "inicial" ? "inventario_inicial" : "compra_inventario", targetType: "lote", targetId: loteRef.id, movimientoId: movRef.id, operationId: String(body.operationId), monto: k.costoTotalHnl, detalle: `${detalle} · ${k.costoTotalMoneda} ${k.moneda} = Lps. ${k.costoTotalHnl} (Lps. ${k.costoUnitarioHnl} c/u) · pagado: ${lote.cuentaPagoNombre}` });
      return { duplicado: false, loteId: loteRef.id, costoTotalHnl: k.costoTotalHnl, costoUnitarioHnl: unitHnl, unidades, tasa: k.tasa, billetera: k.salidaBinance ? k.salidaBinance.estado : undefined };
    });
    return reply(r);
  }

  if (accion === "fin_lote_ajustar") { // merma, vencido o conteo físico: con motivo, nunca se borra el lote
    const motivo = txt(body.motivo, 200);
    if (motivo.length < 4) return res.status(200).json({ ok: false, error: "Escriba el motivo del ajuste (vencido, se cayó la cuenta, conteo…)." });
    const opId = d.libroOpDocId("invaju", body, authUser.uid);
    if (!opId) return res.status(200).json({ ok: false, error: "Falta operationId (actualice la app)." });
    const movRef = col("finanzas_movimientos").doc(opId);
    const r = await run(async (tx) => {
      if ((await tx.get(movRef)).exists) return { duplicado: true };
      const lRef = col("fin_lotes").doc(String(body.loteId || "")); const ls = await tx.get(lRef);
      if (!ls.exists) throw errUsuario("Lote no encontrado.");
      const l = ls.data();
      if (l.estado === "vencido") throw errUsuario("Ese lote ya venció y se dio de baja. Registre una compra nueva si llegó más.");
      const nuevo = r6(body.disponibleCorrecto);
      if (!(nuevo >= 0) || nuevo > r6(l.cantidad) - r6(l.consumido) + 1e-6) throw errUsuario(`El disponible correcto va de 0 a ${r6(l.cantidad - l.consumido)}.`);
      const delta = r6(nuevo - r6(l.disponible)); if (!delta) throw errUsuario("Ese ya es el disponible del lote.");
      const montoHnl = r2(-delta * (l.costoUnitarioHnl || 0)); // positivo = pérdida (merma/vencido)
      tx.set(lRef, { disponible: nuevo, ajustado: r6((l.ajustado || 0) + delta), estado: nuevo > 0 ? "activo" : "agotado", updatedAt: ahora }, { merge: true });
      tx.set(movRef, { ...d.baseMov(identity, authUser, body), movimientoId: movRef.id, operationId: String(body.operationId), tipo: "inventario", subtipo: delta < 0 ? "merma" : "sobrante", loteId: lRef.id, productoId: l.productoId, cantidad: delta, monto: montoHnl, motivo: `Ajuste inventario · ${l.producto} · ${motivo}`, banco: "Inventario", ...d.canonicalFinanceDate(hoy, hoy) });
      audit(tx, { accion: "ajuste_inventario", targetType: "lote", targetId: lRef.id, movimientoId: movRef.id, motivo, monto: montoHnl, before: { disponible: l.disponible }, after: { disponible: nuevo }, detalle: `${l.producto}: ${l.disponible} → ${nuevo} (${delta > 0 ? "+" : ""}${delta}) · Lps. ${montoHnl}` });
      return { duplicado: false, delta, montoHnl };
    });
    return reply(r);
  }
  if (accion === "fin_costeo_config") { // desde qué fecha se costean las ventas (después de cargar el inventario inicial)
    const desde = ymdOk(body.desde) ? body.desde : "";
    if (!desde || desde > hoy) return res.status(200).json({ ok: false, error: "Elija una fecha válida (hoy o antes)." });
    const r = await run(async (tx) => {
      const ref = col("finanzas_config").doc("costeo"); const s = await tx.get(ref); const antes = s.exists ? s.data() : null;
      tx.set(ref, { desde, activo: body.activo !== false, configuradoPor: actor, configuradoAt: ahora }, { merge: true });
      audit(tx, { accion: "configurar_costeo", targetType: "costeo", targetId: "costeo", before: antes ? { desde: antes.desde } : null, after: { desde }, detalle: `Costo de ventas automático desde ${desde}` });
      return { desde };
    });
    return reply(r);
  }
  if (accion === "fin_costear") {
    if (!d.costeoDeps) return res.status(200).json({ ok: false, error: "Costeo no disponible." });
    const r = await correrCosteo(db, { ...d.costeoDeps(db), hoy, actor, limite: 400 });
    return res.status(200).json({ ok: true, accion, ...r });
  }
  if (accion === "fin_cxp_pagar") { // R138 · pagar (todo o parte) una cuenta por pagar, con banco o con Binance
    const monto = r6(body.monto), pago = String(body.pago || "");
    if (!(monto > 0)) return res.status(200).json({ ok: false, error: "Escriba cuánto se le paga (en la moneda de la deuda)." });
    if (!["banco", "binance"].includes(pago)) return res.status(200).json({ ok: false, error: "Elija con qué se paga: banco o Binance." });
    const methods = pago === "banco" ? await d.loadMethods(db) : [];
    const banco = pago === "banco" ? methods.find((m) => m.id === String(body.bancoId || "")) : null;
    if (pago === "banco" && !banco) return res.status(200).json({ ok: false, error: "Elija el banco con que se paga." });
    const opId = d.libroOpDocId("pagocxp", body, authUser.uid);
    if (!opId) return res.status(200).json({ ok: false, error: "Falta operationId (actualice la app)." });
    const fecha = ymdOk(body.fecha) && body.fecha <= hoy ? body.fecha : hoy;
    const movRef = col("finanzas_movimientos").doc(opId);
    const r = await run(async (tx) => {
      if ((await tx.get(movRef)).exists) return { duplicado: true };
      const cRef = col("fin_cxp").doc(String(body.cxpId || "")); const cs = await tx.get(cRef);
      if (!cs.exists) throw errUsuario("Cuenta por pagar no encontrada.");
      const cx = cs.data();
      if (cx.estado === "pagado" || !(r6(cx.saldo) > 0)) throw errUsuario("Esa cuenta ya está pagada.");
      if (monto > r6(cx.saldo) + 1e-6) throw errUsuario(`Debe ${r6(cx.saldo)} ${cx.moneda}: no puede pagar más.`);
      const bSnap = await tx.get(billeteraRef);
      const billetera = bSnap.exists ? { ...estadoBilleteraVacio(), ...bSnap.data() } : estadoBilleteraVacio();
      // Lempiras que de verdad salen
      let pagadoHnl, salida = null;
      if (pago === "binance") { if (cx.moneda !== "USDT") throw errUsuario("Con Binance solo se pagan deudas en USDT."); salida = aplicarSalida(billetera, monto); pagadoHnl = salida.costoHnl; }
      else if (cx.moneda === "HNL") pagadoHnl = r2(monto);
      else { pagadoHnl = r2(body.montoHnl); if (!(pagadoHnl > 0)) throw errUsuario(`Escriba cuántos Lempiras salieron del banco por esos ${monto} ${cx.moneda}.`); }
      if (banco) { const { saldos } = await d.estadoLibro(db, tx); const b = saldos.bancos.find((x) => x.id === banco.id); if (b && pagadoHnl > b.saldo + 0.001 && !body.forzar) throw errUsuario(`Saldo insuficiente en ${banco.nombre} según el libro (Lps. ${b.saldo}).`); }
      const liquida = monto >= r6(cx.saldo) - 1e-6;
      const saldadoHnl = liquida ? r2(cx.saldoHnl) : r2((monto / r6(cx.saldo)) * r2(cx.saldoHnl)); // parte de la deuda (en Lempiras de libro) que se cancela
      const diferencialHnl = r2(pagadoHnl - saldadoHnl); // + pérdida / − ganancia por tipo de cambio
      const comun = { ...d.baseMov(identity, authUser, body), movimientoId: movRef.id, operationId: String(body.operationId), cxpId: cRef.id, proveedorId: cx.proveedorId, proveedor: cx.proveedor, montoCxpHnl: saldadoHnl, diferencialHnl, motivo: `Pago a ${cx.proveedor} · ${cx.concepto}`, ...d.canonicalFinanceDate(fecha, hoy) };
      if (pago === "binance") { tx.set(movRef, { ...comun, tipo: "billetera", subtipo: "pago_cxp", direccion: "salida", billeteraId: BINANCE_ID, moneda: "USDT", montoUsdt: monto, monto: pagadoHnl, tasa: billetera.costoPromedio, banco: "Binance" }); tx.set(billeteraRef, { ...salida.estado, updatedAt: ahora }); }
      else tx.set(movRef, { ...comun, tipo: "pago_cxp", subtipo: "pago_proveedor", direccion: "salida", monto: pagadoHnl, bancoId: banco.id, banco: banco.nombre, moneda: cx.moneda, montoMoneda: monto });
      const saldo = r6(cx.saldo - monto), saldoHnl = r2(cx.saldoHnl - saldadoHnl);
      tx.set(cRef, { saldo: liquida ? 0 : saldo, saldoHnl: liquida ? 0 : saldoHnl, estado: liquida ? "pagado" : "parcial", pagos: [...(cx.pagos || []), { movimientoId: movRef.id, monto, moneda: cx.moneda, pagadoHnl, saldadoHnl, diferencialHnl, con: pago === "binance" ? "Binance" : banco.nombre, fecha, por: actor }], updatedAt: ahora }, { merge: true });
      audit(tx, { accion: "pago_cuenta_por_pagar", targetType: "cuenta_por_pagar", targetId: cRef.id, movimientoId: movRef.id, operationId: String(body.operationId), monto: pagadoHnl, before: { saldo: cx.saldo }, after: { saldo: liquida ? 0 : saldo }, detalle: `${cx.proveedor}: ${monto} ${cx.moneda} con ${pago === "binance" ? "Binance" : banco.nombre} (Lps. ${pagadoHnl}${diferencialHnl ? ` · diferencial ${diferencialHnl}` : ""})` });
      return { duplicado: false, saldo: liquida ? 0 : saldo, estado: liquida ? "pagado" : "parcial", pagadoHnl, diferencialHnl };
    });
    return reply(r);
  }
  if (accion === "fin_tablero") { // R139 · Fase 5: tablero de dirección (resultados por venta, balance, rentabilidad, alertas, conciliación)
    if (!d.costeoDeps) return res.status(200).json({ ok: false, error: "Tablero no disponible." });
    const cd = d.costeoDeps(db);
    try { await correrCosteo(db, { ...cd, hoy, actor: "sistema", limite: 120 }); } catch (_) {}
    const t = await cargarTablero(db, { leerMovimientos: cd.leerMovimientos, loadMethods: () => d.loadMethods(db), hoy, mes: body.mes }, { R: cd.R, ventasACostear, libroDiario, balanzaComprobacion, resumenInventario });
    const cfgSnap = await col("finanzas_config").doc("finance_os").get();
    return res.status(200).json({ ok: true, accion, ...t, config: { reservaPct: 10, capitalTrabajoMin: 5000, activo: true, ...(cfgSnap.exists ? cfgSnap.data() : {}) } });
  }

  if (accion === "fin_retiro_registrar") { // R139 · Fase 6: retiro de propietarios. Baja el banco, NO es gasto.
    const monto = r2(body.monto), motivo = txt(body.motivo, 200), beneficiario = txt(body.beneficiario, 60);
    if (!(monto > 0)) return res.status(200).json({ ok: false, error: "Escriba el monto del retiro." });
    if (!beneficiario) return res.status(200).json({ ok: false, error: "¿Para quién es el retiro? (dueño/socio)" });
    const methods = await d.loadMethods(db); const banco = methods.find((m) => m.id === String(body.bancoId || ""));
    if (!banco) return res.status(200).json({ ok: false, error: "Elija de qué banco sale." });
    const opId = d.libroOpDocId("retiro", body, authUser.uid);
    if (!opId) return res.status(200).json({ ok: false, error: "Falta operationId (actualice la app)." });
    const fecha = ymdOk(body.fecha) && body.fecha <= hoy ? body.fecha : hoy;
    const ref = col("finanzas_movimientos").doc(opId);
    const r = await run(async (tx) => {
      if ((await tx.get(ref)).exists) return { duplicado: true };
      const { saldos } = await d.estadoLibro(db, tx);
      const b = saldos.bancos.find((x) => x.id === banco.id);
      if (b && monto > b.saldo + 0.001 && !body.forzar) throw errUsuario(`Saldo insuficiente en ${banco.nombre} según el libro (Lps. ${b.saldo}).`);
      tx.set(ref, { ...d.baseMov(identity, authUser, body), movimientoId: ref.id, operationId: String(body.operationId), tipo: "retiro", subtipo: "retiro_propietario", direccion: "salida", monto, bancoId: banco.id, banco: banco.nombre, beneficiario, motivo: motivo || "Retiro de utilidades", ...d.canonicalFinanceDate(fecha, hoy) });
      audit(tx, { accion: "retiro_propietario", targetType: "retiro", targetId: ref.id, movimientoId: ref.id, operationId: String(body.operationId), monto, motivo, detalle: `Retiro ${beneficiario} · ${banco.nombre} · Lps. ${monto}` });
      return { duplicado: false, movimientoId: ref.id };
    });
    return reply(r);
  }

  if (accion === "fin_finance_os_config") { // reserva %, capital de trabajo mínimo y pausa general
    const r = await run(async (tx) => {
      const ref = col("finanzas_config").doc("finance_os"); const s0 = await tx.get(ref); const antes = s0.exists ? s0.data() : {};
      const nuevo = { reservaPct: Math.max(0, Math.min(100, Number(body.reservaPct ?? antes.reservaPct ?? 10))), capitalTrabajoMin: Math.max(0, r2(body.capitalTrabajoMin ?? antes.capitalTrabajoMin ?? 5000)), activo: body.activo === undefined ? antes.activo !== false : !!body.activo, actualizadoPor: actor, actualizadoAt: ahora };
      tx.set(ref, nuevo, { merge: true });
      audit(tx, { accion: "configurar_finance_os", targetType: "config", targetId: "finance_os", before: antes, after: nuevo });
      return nuevo;
    });
    return reply(r);
  }

  if (accion === "fin_respaldo") { // R139 · Fase 8: respaldo descargable de todo lo nuevo (antes de migrar o por seguridad)
    const cols = ["fin_productos", "fin_variantes", "fin_precios", "fin_proveedores", "fin_lotes", "fin_consumos", "fin_cxp", "fin_billeteras"];
    const out = {}; for (const c of cols) out[c] = await todos(c);
    const cfg = {}; for (const id of ["costeo", "finance_os", "libro_mayor"]) { const x = await col("finanzas_config").doc(id).get(); if (x.exists) cfg[id] = x.data(); }
    const movs = (await col("finanzas_movimientos").where("origenCanal", "==", "sistema").get().catch(() => ({ docs: [] }))).docs.map((x) => ({ id: x.id, ...(x.data() || {}) }));
    await run(async (tx) => { audit(tx, { accion: "respaldo_finance_os", targetType: "respaldo", detalle: Object.entries(out).map(([k, v]) => `${k}:${v.length}`).join(" · ") }); return {}; });
    return res.status(200).json({ ok: true, accion, generado: ahora, colecciones: out, config: cfg, movimientosSistema: movs, conteo: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])) });
  }
  return null;
}

// R138 · Cuentas por pagar (proveedores) y por cobrar (clientes/vendedores) con antigüedad de saldos.
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
function tramo(dias) { return dias <= 7 ? "0–7 días" : dias <= 15 ? "8–15 días" : dias <= 30 ? "16–30 días" : "Más de 30 días"; }
async function resumenCxp(col, hoy) {
  const s = await col("fin_cxp").get();
  const abiertas = s.docs.map((x) => ({ id: x.id, ...(x.data() || {}) })).filter((c) => c.estado !== "pagado").sort((a, b) => String(a.vence).localeCompare(String(b.vence)));
  const r2c = (v) => Math.round((Number(v) || 0) * 100) / 100;
  return { totalHnl: r2c(abiertas.reduce((a, c) => a + Number(c.saldoHnl || 0), 0)), vencidasHnl: r2c(abiertas.filter((c) => c.vence && c.vence < hoy).reduce((a, c) => a + Number(c.saldoHnl || 0), 0)),
    cuentas: abiertas.map((c) => ({ ...c, vencida: !!(c.vence && c.vence < hoy), diasParaVencer: c.vence ? diasEntre(hoy, c.vence) : null })) };
}
async function resumenCxc(col, hoy) {
  const s = await col("cuentas_por_cobrar").get();
  const fechaDe = (c) => String(c.fechaPago || c.fecha || c.createdAt || "").slice(0, 10).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");
  const abiertas = s.docs.map((x) => ({ id: x.id, ...(x.data() || {}) })).filter((c) => ["pendiente", "parcial"].includes(c.estado) && Number(c.saldoPendiente) > 0);
  const r2c = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const filas = abiertas.map((c) => { const f = fechaDe(c); const dias = /^\d{4}-\d{2}-\d{2}$/.test(f) ? Math.max(0, diasEntre(f, hoy)) : 0; return { id: c.id, deudorTipo: c.deudorTipo || "cliente", deudor: c.deudorNombre || c.clienteNombre || "—", cliente: c.clienteNombre || "", plataforma: c.plataforma || "", total: r2c(c.montoTotalOperacion), saldo: r2c(c.saldoPendiente), estado: c.estado, fecha: f, dias, tramo: tramo(dias), abonos: (c.abonos || []).length }; }).sort((a, b) => b.dias - a.dias);
  const porTramo = {}; for (const f of filas) porTramo[f.tramo] = r2c((porTramo[f.tramo] || 0) + f.saldo);
  const porDeudor = new Map(); for (const f of filas) { const k = `${f.deudorTipo}|${f.deudor}`; const x = porDeudor.get(k) || { deudorTipo: f.deudorTipo, deudor: f.deudor, saldo: 0, cuentas: 0, diasMax: 0 }; x.saldo = r2c(x.saldo + f.saldo); x.cuentas++; x.diasMax = Math.max(x.diasMax, f.dias); porDeudor.set(k, x); }
  return { totalHnl: r2c(filas.reduce((a, f) => a + f.saldo, 0)), clientesHnl: r2c(filas.filter((f) => f.deudorTipo !== "vendedor").reduce((a, f) => a + f.saldo, 0)), vendedoresHnl: r2c(filas.filter((f) => f.deudorTipo === "vendedor").reduce((a, f) => a + f.saldo, 0)),
    porTramo, deudores: [...porDeudor.values()].sort((a, b) => b.saldo - a.saldo), cuentas: filas.slice(0, 300) };
}

// R137 · Resumen del costo de ventas del mes: ventas costeadas, costo, utilidad bruta por producto y lo pendiente.
async function resumenCosteo(col, mes, corrida) {
  const [cfgSnap, csSnap, mvSnap] = await Promise.all([col("finanzas_config").doc("costeo").get(), col("fin_consumos").where("mesKey", "==", mes).get(), col("finanzas_movimientos").where("mesKey", "==", mes).get().catch(() => ({ docs: [] }))]);
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const cs = csSnap.docs.map((x) => ({ id: x.id, ...(x.data() || {}) })).filter((c) => c.estado !== "revertido");
  const r2c = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const porProd = new Map();
  for (const c of cs) for (const l of c.lineas || []) {
    const k = l.productoId || `?${l.servicio}`;
    const x = porProd.get(k) || { productoId: l.productoId || "", nombre: l.producto || l.servicio, ventas: 0, unidades: 0, ingresoHnl: 0, costoHnl: 0, pendientes: 0 };
    x.ventas++; x.unidades += Number(l.cantidad || 0); x.ingresoHnl += Number(l.ingresoHnl || 0); x.costoHnl += Number(l.costoHnl || 0); if (l.faltante > 0 || l.sinProducto) x.pendientes++;
    porProd.set(k, x);
  }
  const productos = [...porProd.values()].map((x) => ({ ...x, ingresoHnl: r2c(x.ingresoHnl), costoHnl: r2c(x.costoHnl), utilidadBrutaHnl: r2c(x.ingresoHnl - x.costoHnl), margen: x.ingresoHnl ? Math.round(((x.ingresoHnl - x.costoHnl) / x.ingresoHnl) * 1000) / 10 : 0 })).sort((a, b) => b.ingresoHnl - a.ingresoHnl);
  const venc = mvSnap.docs.map((x) => x.data() || {}).filter((m) => m.tipo === "inventario" && !m.reversaDe && !m.estadoFinanciero);
  const ventas = r2c(cs.reduce((a, c) => a + Number(c.ventaHnl || 0), 0)), costo = r2c(cs.reduce((a, c) => a + Number(c.costoHnl || 0), 0));
  return {
    config: { desde: cfg.desde || "", activo: cfg.activo !== false, ultimaCorrida: cfg.ultimaCorrida || "" }, corrida, mes,
    ventasHnl: ventas, costoVentasHnl: costo, utilidadBrutaHnl: r2c(ventas - costo), margenBruto: ventas ? Math.round(((ventas - costo) / ventas) * 1000) / 10 : 0, nVentas: cs.length,
    cuposSinVenderHnl: r2c(venc.filter((m) => m.subtipo === "cupos_sin_vender").reduce((a, m) => a + Number(m.monto || 0), 0)),
    mermasHnl: r2c(venc.filter((m) => m.subtipo !== "cupos_sin_vender").reduce((a, m) => a + Number(m.monto || 0), 0)),
    productos,
    pendientes: cs.filter((c) => c.estado !== "completo").slice(0, 60).map((c) => ({ id: c.id, fecha: c.fecha, cliente: c.clienteNombre, plataforma: c.plataforma, estado: c.estado, faltan: (c.lineas || []).filter((l) => l.faltante > 0 || l.sinProducto).map((l) => ({ servicio: l.servicio, producto: l.producto || "", faltante: l.faltante || 0, sinProducto: !!l.sinProducto })) })),
  };
}

module.exports = { MODELOS, MONEDAS, CATEGORIAS_FIN, BINANCE_ID, slug, validarProducto, validarVariante, validarProveedor, precioVigente, planNuevoPrecio, agregarTermino, estadoBilleteraVacio, aplicarRecarga, aplicarSalida, aplicarAjuste, SEMILLA, PRECIOS_DESDE_SEMILLA, varianteIdDe, PAGOS_COMPRA, costearCompra, consumirPEPS, resumenInventario, ACCIONES_EMPRESA, handleEmpresa };
