// R155 · Rediseño Panel de Socios — pedido v2 (cliente principal + renglones) en el servidor.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const CS = require("../lib_compra_socios");
const src = fs.readFileSync(path.join(__dirname, "..", "server_api.js"), "utf8");

const HBO = { id: "hbo_platino", n: "HBO Max", s: "Platino", p: 100, categoria: "Streaming", entregaTipo: "perfil" };
const CANVA = { id: "canva", n: "Canva", s: "1 mes", p: 70, categoria: "Diseño", entregaTipo: "correo" };
const ANA = { clienteId: "", nombre: "Ana", apellido: "López" };

test("modalidad: el catálogo manda; el nombre solo para productos viejos (y queda marcado)", () => {
  assert.deepEqual(CS.modalidad({ entregaTipo: "tv_digital", n: "Oleada TV" }), { m: "tv_digital", inferida: false });
  assert.deepEqual(CS.modalidad({ entregaTipo: "acceso", entregaCanal: "manual", n: "Oleada TV" }), { m: "acceso", inferida: false }, "Oleada con metadatos 'acceso' ya no se contradice");
  assert.deepEqual(CS.modalidad({ entregaTipo: "", entregaCanal: "iptv", n: "Cualquier cosa" }), { m: "tv_digital", inferida: false });
  assert.deepEqual(CS.modalidad({ n: "Disney Premium" }, "Streaming"), { m: "perfil", inferida: true });
  assert.deepEqual(CS.modalidad({ n: "Netflix" }, "Cuentas completas"), { m: "cuenta_completa", inferida: false });
  assert.equal(CS.modalidad({ entregaTipo: "serial_key" }).m, "licencia");
  assert.equal(CS.modalidad({ entregaTipo: "detalle" }).m, "detalle");
  assert.equal(CS.pideDispositivo({ pideDispositivo: "no" }, "perfil"), false);
  assert.equal(CS.pideDispositivo({}, "perfil"), true);
  assert.equal(CS.pideDispositivo({ pideDispositivo: "no" }, "tv_digital"), true, "TV digital siempre pide dispositivo");
});

test("Caso A · Ana compra HBO y Canva: nombre una vez, dispositivo para HBO y correo para Canva", () => {
  const h = CS.normalizarRenglon({ renglonId: "r1", dispositivo: "tv" }, HBO, ANA, 0);
  const c = CS.normalizarRenglon({ renglonId: "r2", correo: "Ana@Ejemplo.com" }, CANVA, ANA, 1);
  assert.deepEqual([h.errores, c.errores], [[], []]);
  assert.equal(h.renglon.perfil, "Ana López"); assert.equal(h.renglon.dispositivo, "📺 TV"); assert.equal(h.renglon.clienteNombre, "Ana López");
  assert.equal(c.renglon.correo, "ana@ejemplo.com"); assert.equal(c.renglon.clienteNombre, "Ana López"); assert.equal(c.renglon.dispositivo, "", "no copia el dispositivo de HBO");
});

test("Caso B · Ana compra HBO y Carlos Disney: la excepción va en ese renglón", () => {
  const d = CS.normalizarRenglon({ renglonId: "r2", destinatario: { tipo: "otro", nombre: "Carlos", apellido: "Mejía" }, dispositivo: "celular" }, { n: "Disney", entregaTipo: "perfil" }, ANA, 1);
  assert.equal(d.renglon.clienteNombre, "Carlos Mejía"); assert.equal(d.renglon.perfil, "Carlos Mejía"); assert.equal(d.renglon.destinatario.tipo, "otro");
  const h = CS.normalizarRenglon({ renglonId: "r1", dispositivo: "tv" }, HBO, { ...ANA, nombre: "Ana María" }, 0);
  assert.equal(h.renglon.perfil, "Ana María López", "cambiar el principal actualiza los que heredan");
  assert.equal(CS.normalizarRenglon({ destinatario: { tipo: "otro", nombre: "" }, dispositivo: "tv" }, HBO, ANA, 0).errores[0].campo, "destinatario");
});

test("Caso C · dos perfiles HBO: dos renglones con ID propio; otro nombre de perfil sin cambiar el cliente", () => {
  const a = CS.normalizarRenglon({ renglonId: "r1", dispositivo: "tv" }, HBO, ANA, 0);
  const b = CS.normalizarRenglon({ renglonId: "r2", dispositivo: "celular", otroPerfil: true, perfilNombre: "Niños", perfilApellido: "" }, HBO, ANA, 1);
  assert.notEqual(a.renglon.renglonId, b.renglon.renglonId);
  assert.equal(b.renglon.perfil, "Niños"); assert.equal(b.renglon.clienteNombre, "Ana López");
  assert.equal(a.renglon.dispositivo, "📺 TV"); assert.equal(b.renglon.dispositivo, "📱 Celular");
});

test("Modalidades: perfil, invitación, cuenta completa, licencia, detalle y TV digital (sin exigir TV a celular)", () => {
  assert.equal(CS.normalizarRenglon({}, HBO, ANA, 0).errores[0].campo, "dispositivo");
  assert.equal(CS.normalizarRenglon({ correo: "malo" }, CANVA, ANA, 0).errores[0].campo, "correo");
  const cc = CS.normalizarRenglon({ cantidad: 25 }, { entregaTipo: "cuenta_completa" }, ANA, 0);
  assert.equal(cc.renglon.cantidad, 25); assert.equal(cc.errores.length, 0); assert.equal(cc.renglon.dispositivo, "", "no inventa dispositivo");
  assert.equal(CS.normalizarRenglon({ cantidad: 21 }, { entregaTipo: "cuenta_completa" }, ANA, 0).errores[0].campo, "cantidad");
  assert.equal(CS.normalizarRenglon({}, { entregaTipo: "serial_key" }, ANA, 0).errores.length, 0, "licencia no pide contraseñas ni datos extra");
  const rec = CS.normalizarRenglon({}, { entregaTipo: "detalle", datoRequerido: "ID de jugador" }, ANA, 0);
  assert.match(rec.errores[0].mensaje, /ID de jugador/);
  const cel = CS.normalizarRenglon({ dispositivo: "celular" }, { entregaTipo: "tv_digital", n: "Oleada TV" }, ANA, 0);
  assert.equal(cel.errores.length, 0, "celular no exige marca de TV");
  assert.equal(CS.normalizarRenglon({ dispositivo: "tv" }, { entregaTipo: "tv_digital" }, ANA, 0).errores[0].campo, "marcaTv");
  const tv = CS.normalizarRenglon({ dispositivo: "tv", marcaTv: "otro", marcaOtra: "Hisense 55A6" }, { entregaTipo: "tv_digital" }, ANA, 0);
  assert.equal(tv.renglon.marcaTv, "Hisense 55A6");
  assert.equal(CS.validarPrincipal({ nombre: "" })[0].campo, "nombre");
  assert.equal(CS.validarPrincipal({ nombre: "Ana", clienteId: "c1" }).length, 0, "cliente existente sin apellido guardado");
});

test("Totales: descuento vigente (L10 por unidad adicional, máximo L40) y comisión aparte", () => {
  assert.deepEqual(CS.totales([{ precio: 100, cantidad: 1 }, { precio: 70, cantidad: 1 }]), { subtotal: 170, conPrecio: 2, descuento: 10, total: 160, hayComision: false });
  assert.equal(CS.totales([{ precio: 100, cantidad: 25 }]).descuento, 40);
  assert.equal(CS.totales([{ precio: null, cantidad: 1 }, { precio: 50, cantidad: 1 }]).hayComision, true);
});

test("Stock manual: agotado o cantidad insuficiente se rechaza; auto no", () => {
  assert.equal(CS.stockInsuficiente({ stockModo: "manual", stockCantidad: 1 }, 2), true);
  assert.equal(CS.stockInsuficiente({ stockModo: "manual", stockCantidad: 2 }, 2), false);
  assert.equal(CS.stockInsuficiente({ stockModo: "manual", stockEstado: "agotado" }, 1), true);
  assert.equal(CS.stockInsuficiente({ stockModo: "auto", stockCantidad: 0 }, 1), false);
  assert.deepEqual([...CS.unidadesPorProducto([{ catalogId: "hbo", cantidad: 1 }, { catalogId: "hbo", cantidad: 1 }, { catalogId: "cc", cantidad: 5 }])], [["hbo", 2], ["cc", 5]]);
});

test("Telegram: destinatario por renglón, datos y notas; sin claves", () => {
  const l = CS.lineasTelegram([
    { servicio: "HBO Max · Platino", precioCatalogo: 100, clienteNombre: "Ana López", perfil: "Ana López", dispositivo: "📺 TV", destinatario: { tipo: "principal" } },
    { servicio: "Disney", precioCatalogo: 90, clienteNombre: "Carlos Mejía", perfil: "Carlos Mejía", destinatario: { tipo: "otro" }, notas: "Urgente" },
  ], "Ana López").join("\n");
  assert.match(l, /Para: Carlos Mejía \(otro cliente\)/); assert.match(l, /Nota: Urgente/); assert.doesNotMatch(l, /Para: Ana López/);
});

test("Pedido público: renglones con destinatario, sin imagen ni finanzas", () => {
  const p = CS.pedidoPublico("web_abcdef123456", { version: 2, clientePrincipal: ANA, productos: [{ renglonId: "r1", servicio: "HBO", clienteNombre: "Ana López", perfil: "Ana López" }], imagenUrl: "https://x", totalCombo: 160, banco: "BAC" });
  assert.equal(p.ref, "123456"); assert.equal(p.comprobante, true); assert.equal(p.productos[0].clienteNombre, "Ana López");
  assert.equal(p.imagenUrl, undefined);
});

test("Cableado de /rev/compra v2: valida en servidor, clientes propios, cambio de precio, stock atómico, idempotencia", () => {
  assert.match(src, /const CS = require\(".\/lib_compra_socios"\)/);
  assert.match(src, /error: "datos_incompletos", errores/);
  assert.match(src, /error: "cliente_ajeno"/);
  assert.match(src, /error: "precio_cambio"/);
  assert.match(src, /error: "sin_stock"/);
  assert.match(src, /const aplicarStock = await reservarStock\(tx\);\n        aplicarStock\(\);\n        tx\.set\(ref, doc\);/, "stock y pedido en la misma transacción");
  assert.match(src, /app\.get\("\/rev\/compra\/estado"/);
  assert.match(src, /pedidoId: pedido\.id, pedidoRef: pedido\.ref/);
  assert.match(src, /error: "pedido_ajeno"/);
  assert.match(src, /titular: cleanTg\(x\.titular, 130\), cuenta: cleanTg\(x\.cuenta, 60\)/);
  // pedidos viejos (v1) siguen igual
  assert.match(src, /const clienteNombre = v2 \? clientePrincipal\.nombre : cleanTg\(b\.clienteNombre, 80\);/);
  const idx = fs.readFileSync(path.join(__dirname, "..", "index_12_admin_panel.js"), "utf8");
  assert.match(idx, /"cuenta_completa", "tv_digital"/); assert.match(idx, /datoRequerido: String\(b\.datoRequerido/);
  const cat = fs.readFileSync(path.join(__dirname, "..", "index_15_catalogo_socios.js"), "utf8");
  assert.match(cat, /pideDispositivo: \["si", "no"\]/);
});
