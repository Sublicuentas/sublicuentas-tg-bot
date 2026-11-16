"use strict";
// R196u · /addextra (Bodega Netflix VIP) — flujo del bot con la librería real y Firestore en memoria. Datos ficticios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FakeDb } = require("./helpers/fake-firestore");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function cargar() {
  const db = new FakeDb(); const paneles = [], mensajes = [], borrados = [], archivos = [];
  const pending = new Map();
  const bot = { deleteMessage: async (c, id) => { borrados.push(id); return true; }, sendMessage: async (c, t) => { mensajes.push(t); return {}; } };
  const stub = (rel, exports) => { const f = require.resolve(path.join("..", rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub("index_01_core", { db, bot, cacheInvalidatePrefix() {} });
  stub("index_02_utils_roles", { pending, logErr() {}, upsertPanel: async (c, t, kb) => { paneles.push({ t, kb }); }, enviarTxtComoArchivo: async (c, t, n) => { archivos.push({ t, n }); } });
  delete require.cache[require.resolve("../index_40_bodega_vip")];
  const M = require("../index_40_bodega_vip");
  const msg = (text, id = 1) => ({ chat: { id: 9 }, message_id: id, text });
  const cb = (data) => ({ data, message: { chat: { id: 9 } }, from: { id: 1, username: "sublicuentas" } });
  const ultimo = () => paneles[paneles.length - 1];
  const boton = (re) => ultimo().kb.flat().find((b) => re.test(b.text)).callback_data;
  return { db, M, msg, cb, paneles, mensajes, borrados, archivos, ultimo, boton };
}
const SUPER = { adminOk: true, superOk: true };

test("lib_bodega_vip.js es copia fiel de HQ api/_bodega-vip.js (solo cambia la línea 1)", () => {
  const hq = path.join(__dirname, "..", "..", "hq-gh", "api", "_bodega-vip.js");
  if (!fs.existsSync(hq)) return; // en el repo del bot solo
  assert.equal(R("lib_bodega_vip.js").split("\n").slice(1).join("\n"), fs.readFileSync(hq, "utf8").split("\n").slice(1).join("\n"));
});

test("/addextra varias: proveedor → lote/costo → líneas → vista previa SIN claves → confirmar → resultado y archivo de fallas sin claves", async () => {
  const t = cargar();
  assert.equal(await t.M.tryMensaje(t.msg("/addextra"), SUPER), true);
  assert.match(t.ultimo().t, /NO es una venta/);
  await t.M.tryCallback(t.cb(t.boton(/Deku peruano/)), SUPER);
  await t.M.tryMensaje(t.msg("compra del día | 3.5 |"), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Añadir varias/)), SUPER);
  const lineas = ["demo.vip01@ejemplo.com claveUno1", "demo.vip02@ejemplo.com | claveDos2", "demo.vip02@ejemplo.com | claveDos2", "malo clave"].join("\n");
  await t.M.tryMensaje(t.msg(lineas, 77), SUPER);
  assert.deepEqual(t.borrados, [77], "borra el mensaje que trae claves");
  assert.match(t.mensajes.join(" "), /Borré su mensaje con las claves/);
  const prev = t.ultimo().t;
  assert.match(prev, /Total: \*4\*/); assert.match(prev, /Nuevas: \*2\*/); assert.match(prev, /Repetidas en el lote: \*1\*/); assert.match(prev, /Inválidas: \*1\*/);
  assert.doesNotMatch(prev, /claveUno1|claveDos2/);
  await t.M.tryCallback(t.cb(t.boton(/Confirmar 2/)), SUPER);
  assert.match(t.ultimo().t, /2 disponibles \/ 0 ya existentes \/ 2 errores/);
  assert.equal(t.archivos.length, 1); assert.doesNotMatch(t.archivos[0].t, /clave(Uno|Dos)/); assert.match(t.archivos[0].t, /repetido en el lote/);
  const inv = await t.db.collection("inventario").doc("vipnetflix__demo_vip01@ejemplo_com").get();
  assert.equal(inv.data().proveedor, "Deku peruano"); assert.equal(inv.data().costoUsdt, 3.5); assert.equal(inv.data().clave, "claveUno1");
});

test("/addextra una: correo → clave; reenviar el mismo acceso no lo duplica", async () => {
  const t = cargar();
  for (let i = 0; i < 2; i++) {
    await t.M.tryMensaje(t.msg("/addextra"), SUPER);
    await t.M.tryCallback(t.cb(t.boton(/Trap colombiano/)), SUPER);
    await t.M.tryCallback(t.cb(t.boton(/Omitir/)), SUPER);
    await t.M.tryCallback(t.cb(t.boton(/Añadir una/)), SUPER);
    await t.M.tryMensaje(t.msg("Uno.Solo@Ejemplo.com"), SUPER);
    await t.M.tryMensaje(t.msg("claveSecreta9", 50 + i), SUPER);
    if (i === 0) await t.M.tryCallback(t.cb(t.boton(/Confirmar 1/)), SUPER);
  }
  assert.match(t.ultimo().t, /Nuevas: \*0\*/); assert.match(t.ultimo().t, /Ya existentes: \*1\*/);
  assert.equal(t.ultimo().kb.flat().some((b) => /Confirmar/.test(b.text)), false, "sin nuevas no hay botón Confirmar");
});

test("ALL-02 · un admin que no es Sublicuentas no puede cargar lotes; doble toque de Confirmar = una sola carga", async () => {
  const t = cargar();
  await t.M.tryMensaje(t.msg("/addextra"), { adminOk: true, superOk: false });
  assert.match(t.ultimo().t, /solo para Sublicuentas/);
  await t.M.tryMensaje(t.msg("/addextra"), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Propio/)), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Omitir/)), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Añadir varias/)), SUPER);
  await t.M.tryMensaje(t.msg("x1@ejemplo.com clave111"), SUPER);
  const ok = t.boton(/Confirmar 1/);
  await t.M.tryCallback(t.cb(ok), { adminOk: true, superOk: false });
  assert.match(t.ultimo().t, /Solo Sublicuentas/);
  await t.M.tryCallback(t.cb(ok), SUPER); await t.M.tryCallback(t.cb(ok), SUPER);
  assert.match(t.ultimo().t, /venció|ya se hizo/);
  const snap = await t.db.collection("inventario").where("plataforma", "==", "vipnetflix").get();
  assert.equal(snap.docs.length, 1);
});

test("el bot enruta /addextra y vipx: al módulo, con superOk", () => {
  const h = R("index_06_handlers.js");
  assert.match(h, /if \(data\.startsWith\("vipx:"\) \|\| data\.startsWith\("hog:"\)\) \{ await require\("\.\/index_40_bodega_vip"\)\.tryCallback\(q,\{adminOk,superOk\}\); return; \}/);
  assert.match(h, /if \(adminOk && await require\("\.\/index_40_bodega_vip"\)\.tryMensaje\(msg,\{adminOk,superOk\}\)\) return;/);
});

/* ── Fase 2 · Hogar Netflix Premium y PIN opcional VIP en Telegram ── */
const H = require("../lib_netflix_hogar");
test("lib_netflix_hogar.js es copia fiel de HQ api/_netflix-hogar.js", () => {
  const hq = path.join(__dirname, "..", "..", "hq-gh", "api", "_netflix-hogar.js");
  if (!fs.existsSync(hq)) return;
  assert.equal(R("lib_netflix_hogar.js").split("\n").slice(1).join("\n"), fs.readFileSync(hq, "utf8").split("\n").slice(1).join("\n"));
});
test("HOG-01/02 en el bot: botón 🏠 Hogar → Marcar perfil → segundo Hogar pide confirmar reemplazo", async () => {
  const t = cargar();
  await t.db.collection("inventario").doc("m1").set({ plataforma: "netflix", correo: "premium01@ejemplo.com", capacidad: 5, clientes: [{ clienteId: "A", compraId: "cA", nombre: "Cliente A", slot: 1 }, { clienteId: "B", compraId: "cB", nombre: "Cliente B", slot: 2 }] });
  const [[b]] = t.M.botonesCuenta("netflix", "m1");
  await t.M.tryCallback(t.cb(b.callback_data), SUPER);
  assert.match(t.ultimo().t, /Hogar sin asignar/);
  await t.M.tryCallback(t.cb(t.boton(/Perfil 1 · Cliente A/)), SUPER);
  assert.match(t.ultimo().t, /\*Hogar: Cliente A · Perfil 1\*/); assert.match(t.ultimo().t, /🏠 Perfil 1 · Cliente A/);
  await t.M.tryCallback(t.cb(t.boton(/Perfil 2 · Cliente B/)), SUPER);
  assert.match(t.ultimo().t, /Confirme el reemplazo/);
  await t.M.tryCallback(t.cb(t.boton(/Reemplazar por Perfil 2/)), SUPER);
  assert.match(t.ultimo().t, /\*Hogar: Cliente B · Perfil 2\*/);
  const d = (await t.db.collection("inventario").doc("m1").get()).data();
  assert.equal(H.perfilesConHogar(d).filter((x) => x.hogar).length, 1);
  // un admin que no es Sublicuentas ve el Hogar pero no puede cambiarlo
  await t.M.tryCallback(t.cb(b.callback_data), { adminOk: true, superOk: false });
  assert.equal(t.ultimo().kb.flat().some((x) => /Marcar Hogar|Quitar/.test(x.text)), false);
});
test("PIN-01 en el bot: poner PIN (mensaje borrado, valor no se muestra) y quitarlo; ficha VIP sin PIN no muestra línea", async () => {
  const t = cargar();
  await t.db.collection("clientes").doc("cli1").set({ nombre: "Cliente Demo", servicios: [{ compraId: "c1", plataforma: "vipnetflix", correo: "vip1@ejemplo.com", sinPinPerfil: true }] });
  await t.db.collection("inventario").doc("v1").set({ plataforma: "vipnetflix", correo: "vip1@ejemplo.com", capacidad: 1, ocupados: 1, clientes: [{ clienteId: "cli1", compraId: "c1", nombre: "Cliente Demo" }] });
  const [[b]] = t.M.botonesCuenta("vipnetflix", "v1");
  await t.M.tryCallback(t.cb(b.callback_data), SUPER);
  assert.match(t.ultimo().t, /Estado: \*Sin PIN\*/);
  await t.M.tryCallback(t.cb(t.boton(/Poner PIN/)), SUPER);
  await t.M.tryMensaje(t.msg("4321", 88), SUPER);
  assert.ok(t.borrados.includes(88)); assert.match(t.ultimo().t, /PIN configurado/); assert.doesNotMatch(t.ultimo().t, /4321/);
  assert.equal((await t.db.collection("clientes").doc("cli1").get()).data().servicios[0].pinPerfil, "4321");
  await t.M.tryCallback(t.cb(b.callback_data), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Quitar PIN/)), SUPER);
  assert.match(t.ultimo().t, /Sin PIN/);
  assert.equal((await t.db.collection("clientes").doc("cli1").get()).data().servicios[0].pinPerfil, undefined);
  const crm = R("index_03_clientes_crm.js");
  assert.match(crm, /if \(pv\) out \+= `\$\{indent\}🔏 \$\{markdown \? "\*PIN de perfil:\*" : "PIN de perfil:"\} \$\{esc\(pv\)\}\\n`;/);
});
test("el panel de la cuenta muestra la línea de Hogar / PIN y enruta hog:", () => {
  const inv = R("index_04_inventario_correos.js");
  assert.match(inv, /extraHogarPin\(plat, data\) \+ \/\/ R196u/);
  assert.match(inv, /\.\.\.extraKb,/);
  assert.match(R("index_06_handlers.js"), /data\.startsWith\("vipx:"\) \|\| data\.startsWith\("hog:"\)/);
});

/* ── Fase 3 · HBO Platinum 5 / Standard 3 en Telegram ── */
const P3 = require("../lib_hbo_planes");
test("lib_hbo_planes.js es copia fiel de HQ api/_hbo-planes.js", () => {
  const hq = path.join(__dirname, "..", "..", "hq-gh", "api", "_hbo-planes.js");
  if (!fs.existsSync(hq)) return;
  assert.equal(R("lib_hbo_planes.js").split("\n").slice(1).join("\n"), fs.readFileSync(hq, "utf8").split("\n").slice(1).join("\n"));
});
test("HBO-01/02 en el bot: 📦 Plan HBO → Standard con 4 ocupados BLOQUEA; Platinum queda 4/5; admin no-super solo ve", async () => {
  const t = cargar();
  const clientes = [1, 2, 3, 4].map((i) => ({ clienteId: "c" + i, nombre: "Cliente " + i, slot: i }));
  await t.db.collection("inventario").doc("h1").set({ plataforma: "hbomax", correo: "hbo01@ejemplo.com", capacidad: 5, ocupados: 4, clientes });
  const [[b]] = t.M.botonesCuenta("hbomax", "h1");
  assert.match(b.text, /Plan HBO/);
  await t.M.tryCallback(t.cb(b.callback_data), SUPER);
  assert.match(t.ultimo().t, /HBO 4\/5 · plan sin definir/);
  await t.M.tryCallback(t.cb(t.boton(/Standard · 3/)), SUPER);
  assert.match(t.ultimo().t, /No se puede pasar a Standard/);
  let d = (await t.db.collection("inventario").doc("h1").get()).data();
  assert.equal(d.capacidad, 5); assert.equal(d.clientes.length, 4); assert.equal(d.planHbo, undefined);
  await t.M.tryCallback(t.cb(b.callback_data), SUPER);
  await t.M.tryCallback(t.cb(t.boton(/Platinum · 5/)), SUPER);
  assert.match(t.ultimo().t, /Platinum 4\/5/);
  d = (await t.db.collection("inventario").doc("h1").get()).data();
  assert.equal(d.planHbo, "platinum"); assert.equal(d.historialPlan.length, 1);
  await t.M.tryCallback(t.cb(b.callback_data), { adminOk: true, superOk: false });
  assert.equal(t.ultimo().kb.flat().some((x) => /Platinum ·|Standard ·/.test(x.text)), false);
  assert.match(t.M.botonesCuenta("netflix", "m1")[0][0].text, /Hogar/, "Netflix sigue con su botón de Hogar");
});
test("HBO en el bot: capacidad a mano bloqueada contra el plan; cuentas nuevas 5/3 nacen con plan", () => {
  assert.match(R("index_04_inventario_correos.js"), /const pl = require\("\.\/lib_hbo_planes"\)\.planDeCuenta\(data\); if \(pl && capacidad !== pl\.capacidad\) throw/);
  const h = R("index_06_handlers.js");
  assert.equal((h.match(/require\("\.\/lib_hbo_planes"\)\.planPorCapacidad\(/g) || []).length, 4);
  assert.equal(P3.planPorCapacidad(5), "platinum"); assert.equal(P3.planPorCapacidad(3), "standard");
});

/* ── Fases 4 y 5 · AutoCAD, Eleven Reader e integración en Telegram / Socios ── */
test("CAD/ELV en Telegram: AutoCAD en Software con contraseña opcional; Eleven Reader en Música con correo + contraseña", () => {
  const core = R("index_01_core.js");
  assert.match(core, /autocad:\s+\{ key: "autocad",\s+nombre: "Autodesk AutoCAD", categoria: "diseno_ia", acceso: "invitacion_correo",.*requiereClave: false, claveOpcional: true, requierePin: false/);
  assert.match(core, /elevenreader: \{ key: "elevenreader", nombre: "Eleven Reader", categoria: "musica",\s+acceso: "correo_clave",.*requiereClave: true,\s+requierePin: false/);
  const cat = require("../lib_catalogo_categorias");
  assert.equal(cat.clasificarServicio({ plataforma: "autocad" }).categoria, "software", "sale en 💻 Software al vender");
  assert.equal(cat.clasificarServicio({ plataforma: "elevenreader" }).categoria, "musica", "sale en 🎵 Música al vender");
  const E = require("../lib_entrega_plataforma");
  assert.equal(E.claveOpcional("autocad"), true); assert.equal(E.claveOpcional("elevenreader"), false);
  const crm = R("index_03_clientes_crm.js");
  assert.match(crm, /clave: requiereClaveLocal\(plat, \{ \.\.\.anterior, \.\.\.servicio \}\) \|\| claveOpcionalLocal\(plat\)/, "si se escribió, se guarda");
  assert.match(crm, /else if \(claveOpcionalLocal\(p\)\) \{ const cv = String\(individual\.clave \|\| servicio\.clave \|\| ""\)\.trim\(\); if \(cv\) out \+=/, "sin contraseña no hay línea");
  assert.match(crm, /"🔑 Contraseña \(opcional\)"/);
  assert.match(R("index_02_utils_roles.js"), /"eleven reader": "elevenreader",.*"autodesk autocad": "autocad"/);
});
test("lib_entrega_plataforma.js sigue siendo copia fiel de HQ (AutoCAD / Eleven Reader incluidos)", () => {
  const hq = path.join(__dirname, "..", "..", "hq-gh", "api", "_entrega-plataforma.js");
  if (!fs.existsSync(hq)) return;
  assert.equal(R("lib_entrega_plataforma.js").split("\n").slice(1).join("\n"), fs.readFileSync(hq, "utf8").split("\n").slice(1).join("\n"));
});
test("Socios: AutoCAD = invitación al correo, Eleven Reader = acceso; productos de respaldo sin precio inventado", () => {
  const S = require("../lib_compra_socios");
  assert.equal(S.modalidad({ n: "Autodesk AutoCAD" }).m, "correo");
  assert.equal(S.modalidad({ n: "Eleven Reader" }).m, "acceso");
  const C = require("../index_15_catalogo_socios");
  const cad = C.CATALOGO_PROPIETARIOS.find((x) => x.id === "autocad"), er = C.CATALOGO_PROPIETARIOS.find((x) => x.id === "eleven_reader");
  assert.equal(cad.precio, null); assert.equal(er.precio, null); assert.equal(er.categoria, "🎵 Música");
});
