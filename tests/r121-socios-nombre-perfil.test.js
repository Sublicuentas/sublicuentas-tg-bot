const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "server_api.js"), "utf8");
function extraer(nombre) { const i = src.indexOf(`function ${nombre}(`); assert.ok(i >= 0, nombre); let d = 0; const j = src.indexOf("{", src.indexOf(")", i)); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(src.lastIndexOf("\n", i) + 1, k + 1); } } }
const nombreDe = new Function(`${extraer("r121NombreCompraSocio")}; return r121NombreCompraSocio;`)();

test("R121: el ingreso de una compra de socio lleva el nombre del perfil", () => {
  assert.equal(nombreDe([{ perfil: "Jhoseline Navas" }], "", "Jimena"), "Jhoseline Navas");
  assert.equal(nombreDe([{ perfilNombre: "Ana", perfilApellido: "Paz" }, { perfil: "ana  paz" }, { perfil: "Luis Rey" }], "", "Jimena"), "Ana Paz, Luis Rey", "perfiles repetidos salen una vez");
  assert.equal(nombreDe([{ nombreCliente: "Carlos Mejía" }], "", "Jimena"), "Carlos Mejía", "compras por correo: nombre del cliente");
  assert.equal(nombreDe([{}], "Cliente Pedido", "Jimena"), "Cliente Pedido");
  assert.equal(nombreDe([{}], "", "Jimena"), "Jimena", "nunca queda sin nombre");
  assert.ok(nombreDe([{ perfil: "x".repeat(200) }], "", "J").length <= 80);
  assert.match(src, /socioNombre: socio, clienteNombre: r121NombreCompraSocio\(productos, doc\.cliente, socio\), compraId: ref\.id/);
  assert.match(src, /productosSocio: productos\.map\(\(p\) => \(\{ servicio: p\.servicio, perfil: p\.perfil \|\| p\.nombreCliente \|\| ""/);
});

test("R121: las compras de socios ya guardadas se completan una sola vez (nombre + marca sin ficha), sin tocar el dinero", async () => {
  const movs = {
    a_venta: { subtipo: "compra_socio", tipo: "venta", monto: 110, pedidoId: "ped1", socioNombre: "Jimena" },
    a_cobro: { subtipo: "compra_socio", tipo: "ingreso", monto: 110, banco: "BAC Credomatic", pedidoId: "ped1", socioNombre: "Jimena" },
    b_cobro: { subtipo: "compra_socio", tipo: "ingreso", monto: 90, compraId: "perdido", socioNombre: "Abner" },
    c_cobro: { subtipo: "compra_socio", tipo: "ingreso", monto: 50, clienteNombre: "Ya Tiene", pedidoId: "ped1" },
    d_cobro: { subtipo: "renovacion_socio", tipo: "ingreso", monto: 70 },
  };
  const compras = { ped1: { productos: [{ perfil: "Jhoseline Navas" }], cliente: "" } };
  const config = {}; let lecturas = 0;
  const db = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => { lecturas++; const base = col === "compras" ? compras : col === "finanzas_config" ? config : movs; return { exists: !!base[id], data: () => base[id] }; },
        set: async (v) => { config[id] = { ...(config[id] || {}), ...v }; },
      }),
      where: (campo, op, valor) => ({ get: async () => { lecturas++; return { docs: Object.keys(movs).filter((k) => movs[k][campo] === valor).map((k) => ({ ref: k, data: () => movs[k] })) }; } }),
    }),
    batch: () => { const ops = []; return { update: (ref, v) => ops.push([ref, v]), commit: async () => ops.forEach(([ref, v]) => Object.assign(movs[ref], v)) }; },
  };
  const rellenar = new Function("db", "console", `${extraer("r121NombreCompraSocio")}; ${extraer("r121RellenarNombresCompraSocio")}; return r121RellenarNombresCompraSocio;`)(db, { log() {}, error(...a) { throw new Error(a.join(" ")); } });
  assert.equal(await rellenar(), 4);
  assert.equal(movs.a_cobro.fichaPendiente, true, 'el ingreso del socio queda "sin ficha" para la opción Ya pagó por Socios');
  assert.equal(movs.a_venta.fichaPendiente, undefined, 'la venta (valor comercial) no lleva la marca');
  assert.equal(movs.c_cobro.fichaPendiente, true);
  assert.equal(movs.a_cobro.clienteNombre, "Jhoseline Navas");
  assert.equal(movs.a_venta.clienteNombre, "Jhoseline Navas");
  assert.equal(movs.b_cobro.clienteNombre, "Abner", "sin pedido: al menos el socio");
  assert.equal(movs.c_cobro.clienteNombre, "Ya Tiene", "el que ya tenía nombre no se toca");
  assert.equal(movs.d_cobro.clienteNombre, undefined, "las renovaciones no se tocan");
  assert.deepEqual([movs.a_cobro.monto, movs.a_cobro.banco], [110, "BAC Credomatic"], "ni monto ni banco cambian");
  assert.ok(config.migraciones.r121NombresCompraSocio);
  const antes = lecturas;
  assert.equal(await rellenar(), 0);
  assert.equal(lecturas - antes, 1, "la segunda vez solo lee la marca");
  assert.match(src, /app\.listen\(PORT, \(\) => \{ console\.log\(.*\); r121RellenarNombresCompraSocio\(\);/);
});

// ---------- "Ya pagó por Socios" en el bot (index_31_finanzas_libro.js) ----------
const libroSrc = fs.readFileSync(path.join(__dirname, "..", "index_31_finanzas_libro.js"), "utf8");
function extraerLibro(nombre) { const i = libroSrc.indexOf(`function ${nombre}(`); assert.ok(i >= 0, nombre); let d = 0; const j = libroSrc.indexOf("{", libroSrc.indexOf(")", i)); for (let k = j; k < libroSrc.length; k++) { if (libroSrc[k] === "{") d++; else if (libroSrc[k] === "}") { d--; if (!d) return libroSrc.slice(libroSrc.lastIndexOf("\n", i) + 1, k + 1); } } }
function libroFalso(movs) {
  const aud = [];
  const db = {
    collection: (col) => ({
      doc: (id) => ({ id: id || `aud${aud.length + 1}`, col }),
      where: (campo, op, valor) => ({ get: async () => ({ docs: Object.keys(movs).filter((k) => movs[k][campo] === valor).map((k) => ({ id: k, data: () => movs[k] })) }) }),
    }),
    runTransaction: async (fn) => { const buf = []; const tx = { get: async (r) => ({ exists: !!movs[r.id], data: () => movs[r.id] }), update: (r, v) => buf.push(() => Object.assign(movs[r.id], v)), set: (r, v) => buf.push(() => { if (r.col === "auditoria_eventos") aud.push(v); }) }; const out = await fn(tx); buf.forEach((f) => f()); return out; },
  };
  const R = { money: (n) => Math.round(Number(n || 0) * 100) / 100, fmt: (n) => String(Number(n || 0)) };
  const auditarTg = (tx, actor, ev) => tx.set(db.collection("auditoria_eventos").doc(), { actorUsuario: actor.usuario, ...ev });
  const f = new Function("db", "R", "auditarTg", `const userErr = (msg) => Object.assign(new Error(msg), { userError: true }); ${extraerLibro("unidadesSocio")}; ${extraerLibro("pagoSocioDisponible")}; ${extraerLibro("pagosSociosSinFicha")}; ${extraerLibro("vincularFichaSocio")}; return { unidadesSocio, pagosSociosSinFicha, vincularFichaSocio };`)(db, R, auditarTg);
  return { ...f, aud };
}
const movSocio = () => ({ tipo: "ingreso", subtipo: "compra_socio", monto: 110, banco: "BAC Credomatic", socioNombre: "Jimena", clienteNombre: "Jhoseline Navas", fechaPago: "2026-10-05", fichaPendiente: true, productosSocio: [{ servicio: "Netflix Vip", perfil: "Jhoseline Navas", cantidad: 1 }] });

test("R121 bot: lista las compras de socios sin ficha y amarra la ficha SIN crear otro ingreso", async () => {
  const movs = { socio_compra_p1_cobro: movSocio(), socio_compra_p2_cobro: { ...movSocio(), estadoFinanciero: "anulado" }, socio_compra_p3_cobro: { ...movSocio(), fichaPendiente: false }, oper_x_cobro: { tipo: "ingreso", subtipo: "cobro_compra", monto: 50 } };
  const L = libroFalso(movs);
  const lista = await L.pagosSociosSinFicha();
  assert.deepEqual(lista.map((x) => [x.movimientoId, x.productoIdx]), [["socio_compra_p1_cobro", 0]]);
  assert.equal(lista[0].texto, "Jimena · Netflix Vip · Jhoseline Navas · L110 · BAC Credomatic");
  const actor = { usuario: "sublicuentas" }, cliente = { clienteId: "cli1", nombre: "Jhoseline Navas", compraId: "c1", plataforma: "vipnetflix" };
  const antes = Object.keys(movs).length;
  const r = await L.vincularFichaSocio({ movimientoId: "socio_compra_p1_cobro", productoIdx: 0, cliente, opId: "tg-op-1", actor });
  assert.equal(r.pagoSocio, true); assert.equal(r.socio, "Jimena"); assert.equal(r.total, 110); assert.equal(r.fichasPendientes, 0);
  assert.equal(Object.keys(movs).length, antes, "no se crea ningún movimiento nuevo");
  assert.equal(movs.socio_compra_p1_cobro.fichaPendiente, false); assert.equal(movs.socio_compra_p1_cobro.monto, 110);
  assert.equal(movs.socio_compra_p1_cobro.fichasVinculadas[0].clienteId, "cli1");
  assert.equal(L.aud.length, 1); assert.equal(L.aud[0].accion, "ficha_pago_socio"); assert.match(L.aud[0].detalle, /sin ingreso nuevo/);
  assert.equal((await L.vincularFichaSocio({ movimientoId: "socio_compra_p1_cobro", productoIdx: 0, cliente, opId: "tg-op-1", actor })).duplicado, true);
  await assert.rejects(L.vincularFichaSocio({ movimientoId: "socio_compra_p1_cobro", productoIdx: 0, cliente, opId: "tg-op-2", actor }), /ya tiene su ficha/);
  await assert.rejects(L.vincularFichaSocio({ movimientoId: "socio_compra_p2_cobro", productoIdx: 0, cliente, opId: "tg-op-3", actor }), /anulado o corregido/);
  await assert.rejects(L.vincularFichaSocio({ movimientoId: "oper_x_cobro", productoIdx: 0, cliente, opId: "tg-op-4", actor }), /ya no existe/);
  assert.equal((await L.pagosSociosSinFicha()).length, 0);
});

test("R121 bot: la hoja de pago de la compra ofrece 'Ya pagó por Socios' y los botones caben en Telegram (64 bytes)", () => {
  assert.match(libroSrc, /const kb = compra \? \[\[\{ text: "🤝 Ya pagó por Socios", callback_data: "fl:pg:socio" \}\]\]/);
  assert.match(libroSrc, /callback_data: `fl:pg:sp:\$\{i\}`/);
  for (const cb of ["fl:pg:socio", "fl:pg:sback", "fl:pg:sp:11"]) assert.ok(Buffer.byteLength(cb) <= 64);
  assert.match(libroSrc, /if \(data === "fl:pg:socio" && p\.tipoOrigen === "compra"/, "solo en compras");
  assert.match(src, /subtipo === "compra_socio" \? \{ fichaPendiente: true \} : \{\}/, "la compra de socio nace marcada sin ficha");
});
