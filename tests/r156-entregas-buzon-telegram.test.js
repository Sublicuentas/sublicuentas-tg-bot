// R156 · Entregas en panel + Telegram + historial + Buzón de dos vías (brief 30/10/2026).
// Rutas reales de rev_entregas_api.js sobre un Firestore en memoria. Datos ficticios; no crea ventas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { FakeDb } = require("./helpers/fake-firestore");
const L = require("../lib_entregas_socios");

const KEY = crypto.randomBytes(32).toString("base64");
const norm = (v) => String(v || "").toLowerCase().trim();

function montar() {
  const db = new FakeDb();
  const app = express(); app.use(express.json());
  const revAuth = (req, res, next) => { const s = req.headers["x-socio"]; if (!s) return res.status(401).end(); req.rev = { id: s, nombre_norm: s, nombre: s.toUpperCase() }; next(); };
  const revAdminAuth = (req, res, next) => { if (!req.headers["x-admin"]) return res.status(401).end(); req.admin = { nombre: "Admin", permissions: ["*"], profile: "sublicuentas" }; next(); };
  const deps = {
    db, revAuth, revAdminAuth, adminAnyPermission: () => (q, s, n) => n(), isFullAdmin: () => true, adminScopeProfile: () => "sublicuentas",
    revLiveProfile: async (rev) => { const s = await db.collection("revendedores").doc(rev.id).get(); return { id: rev.id, ...(s.data() || {}) }; },
    revSocioAliases: (live) => [norm(live.nombre_norm || live.id)], revNormKey: norm,
    revFiltrarClientePorAliases: (c, aliases) => ({ ...c, servicios: (c.servicios || []).filter((s) => aliases.includes(norm(s.vendedor))) }),
    destinoInfo: (d) => ({ key: d || "sublicuentas", label: "🟣 Sublicuentas" }), getDestinoChatIds: async () => ["900001"],
    bot: { getMe: async () => ({ username: "SubliBotPrueba" }) },
    env: { ENTREGAS_CODIGOS_KEY: KEY, SOCIOS_PANEL_URL: "https://socios.ejemplo.test", PORTAL_CLIENTE_BASE: "https://sublichat.ejemplo.test" },
  };
  require("../rev_entregas_api").registrar(app, deps);
  return { db, app };
}
async function servidor(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }
function cliente(s) {
  const base = `http://127.0.0.1:${s.address().port}`;
  return async (method, url, { body, socio, admin, actor } = {}) => {
    const h = { "Content-Type": "application/json" };
    if (socio) h["x-socio"] = socio; if (admin) h["x-admin"] = "1"; if (actor) h["x-sublichat-actor"] = actor;
    const r = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
}
async function sembrar(db, { telegramA = "111111" } = {}) {
  await db.collection("revendedores").doc("ana_socia").set({ nombre: "Ana Socia", nombre_norm: "ana_socia", telegramId: telegramA, activo: true });
  await db.collection("revendedores").doc("beto_socio").set({ nombre: "Beto", nombre_norm: "beto_socio", telegramId: "222222", activo: true });
  await db.collection("clientes").doc("cli_juan").set({ nombre: "Juan Pérez", servicios: [
    { plataforma: "Netflix", compraId: "svc_nf_1", vendedor: "ana_socia", fechaRenovacion: "2026-11-30", token: "tokNF" },
    { plataforma: "Prime Video", compraId: "svc_pv_1", vendedor: "ana_socia", fechaRenovacion: "2026-11-30" },
  ], accesosBeneficiarios: { titular: { token: "tokJuanTitular" } } });
  await db.collection("clientes").doc("cli_otro").set({ nombre: "Juana Ajena", servicios: [{ plataforma: "Netflix", compraId: "svc_ajeno", vendedor: "beto_socio" }] });
  await db.collection("compras").doc("web_pedidojuan01").set({ socio: "Ana Socia", socio_norm: "ana_socia", destino: "sublicuentas", estado: "pendiente", version: 2,
    clientePrincipal: { nombre: "Juan", apellido: "Pérez" }, servicio: "Combo", productos: [
      { renglonId: "r1", servicio: "Netflix · 1 perfil", clienteNombre: "Juan Pérez", modalidad: "perfil" },
      { renglonId: "r2", servicio: "Prime Video", clienteNombre: "Juan Pérez", modalidad: "perfil" }], createdAt: new Date("2026-10-30T10:00:00Z") });
}
const outbox = (db) => Object.entries(db.dump("telegram_outbox"));

test("Publicar: el socio correcto ve la entrega; otro socio recibe acceso denegado incluso con el ID", async () => {
  const { db, app } = montar(); await sembrar(db); const s = await servidor(app); const api = cliente(s);
  try {
    const r = await api("POST", "/rev/admin/entregas/guardar", { admin: true, actor: "naara", body: { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "op1", ficha: { clienteId: "cli_juan", servicioCompraId: "svc_nf_1", servicioIndex: 0 }, portalAutorizado: true } });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.version, 1);
    const id = r.j.id;
    const a = await api("GET", `/rev/entregas/${id}`, { socio: "ana_socia" });
    assert.equal(a.status, 200); assert.equal(a.j.entrega.servicio, "Netflix · 1 perfil"); assert.equal(a.j.entrega.portalDisponible, true);
    const b = await api("GET", `/rev/entregas/${id}`, { socio: "beto_socio" });
    assert.equal(b.status, 404); assert.equal(b.j.error, "no_disponible");
    const bp = await api("POST", `/rev/entregas/${id}/portal`, { socio: "beto_socio" });
    assert.equal(bp.status, 404);
    const ap = await api("POST", `/rev/entregas/${id}/portal`, { socio: "ana_socia" });
    assert.equal(ap.j.url, "https://sublichat.ejemplo.test/c/tokJuanTitular", "portal del titular, resuelto en vivo");
    const audit = Object.values(db.dump(`entregas_socios/${id}/versiones`)).map((v) => v.accion);
    assert.ok(audit.includes("abrir_portal"), "abrir portal queda auditado");
    assert.match(Object.values(db.dump(`entregas_socios/${id}/versiones`)).find((v) => v.accion === "publicar").actor, /naara \(vía Admin\)/);
  } finally { s.close(); }
});

test("Ficha de otro socio: no se puede vincular (la búsqueda no autoriza)", async () => {
  const { db, app } = montar(); await sembrar(db); const s = await servidor(app); const api = cliente(s);
  try {
    const r = await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "x", ficha: { clienteId: "cli_otro", servicioCompraId: "svc_ajeno" } } });
    assert.equal(r.status, 403); assert.equal(r.j.error, "ficha_de_otro_socio");
    const f = await api("GET", "/rev/admin/entregas/fichas?q=Ju&socio=ana_socia", { admin: true });
    assert.deepEqual(f.j.items.map((x) => x.clienteId), ["cli_juan"], "solo fichas del socio del pedido");
    assert.ok(!JSON.stringify(f.j).includes("tokJuan"), "la búsqueda no expone enlaces");
  } finally { s.close(); }
});

test("Entrega parcial: 1 de 2; publicar el segundo completa el pedido sin duplicar el primero", async () => {
  const { db, app } = montar(); await sembrar(db); const s = await servidor(app); const api = cliente(s);
  try {
    await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "a1" } });
    let c = (await db.collection("compras").doc("web_pedidojuan01").get()).data();
    assert.equal(c.entregaResumen.texto, "Entrega parcial · 1 de 2 servicios"); assert.equal(c.estado, "en proceso");
    await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r2", opId: "a2" } });
    c = (await db.collection("compras").doc("web_pedidojuan01").get()).data();
    assert.equal(c.entregaResumen.estado, "entregado"); assert.equal(c.estado, "entregado");
    assert.equal(Object.keys(db.dump("entregas_socios")).length, 2);
    const again = await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "otro" } });
    assert.equal(again.status, 409); assert.equal(again.j.error, "ya_publicada_use_actualizar");
  } finally { s.close(); }
});

test("Telegram conectado: aviso privado con botón al panel, sin código; doble clic = una versión y un aviso", async () => {
  const { db, app } = montar(); await sembrar(db); const s = await servidor(app); const api = cliente(s);
  try {
    const body = { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "dbl", codigo: "ABC-SECRETO-99", codigoAutorizado: false };
    const [x, y] = await Promise.all([api("POST", "/rev/admin/entregas/guardar", { admin: true, body }), api("POST", "/rev/admin/entregas/guardar", { admin: true, body })]);
    assert.deepEqual([x.status, y.status].sort(), [200, 200]);
    const avisos = outbox(db).filter(([id]) => id.startsWith("entrega_"));
    assert.equal(avisos.length, 1, "un evento por versión/canal");
    const [, job] = avisos[0];
    assert.equal(job.chatId, "111111"); assert.equal(job.noRetryOnUncertain, true);
    assert.match(job.text, /Pedido #JUAN01 disponible\./); assert.match(job.text, /Cliente: Juan Pérez/);
    assert.doesNotMatch(job.text, /ABC-SECRETO/); assert.match(job.replyMarkupJson, /https:\/\/socios\.ejemplo\.test\/\?entrega=ent_web_pedidojuan01_r1/);
    const e = (await db.collection("entregas_socios").doc("ent_web_pedidojuan01_r1").get()).data();
    assert.equal(e.version, 1); assert.ok(e.codigoCifrado && !JSON.stringify(e).includes("ABC-SECRETO"), "código cifrado en reposo");
    // código NO autorizado → oculto para el socio
    const cod = await api("POST", "/rev/entregas/ent_web_pedidojuan01_r1/codigo", { socio: "ana_socia" });
    assert.equal(cod.status, 404);
  } finally { s.close(); }
});

test("Sin Telegram: la entrega sigue en el panel, aviso 'sin_vinculo', nada se marca visto", async () => {
  const { db, app } = montar(); await sembrar(db, { telegramA: "" }); const s = await servidor(app); const api = cliente(s);
  try {
    const r = await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "n1" } });
    assert.equal(r.j.aviso, "sin_vinculo"); assert.equal(outbox(db).length, 0);
    const l = await api("GET", "/rev/entregas", { socio: "ana_socia" });
    assert.equal(l.j.items.length, 1); assert.equal(l.j.items[0].nueva, true, "listar no equivale a leer");
    const adm = await api("GET", "/rev/admin/entregas?compraId=web_pedidojuan01", { admin: true });
    assert.equal(adm.j.renglones[0].entrega.avisos[0].estado, "sin_vinculo"); assert.equal(adm.j.renglones[0].entrega.visto, null);
    await api("GET", "/rev/entregas/ent_web_pedidojuan01_r1", { socio: "ana_socia" });
    const l2 = await api("GET", "/rev/entregas", { socio: "ana_socia" });
    assert.equal(l2.j.items[0].nueva, false, "visto solo al abrir el detalle");
  } finally { s.close(); }
});

test("Actualizar y revocar: nueva versión con motivo; código autorizado visible; revocar quita acceso; fecha original intacta", async () => {
  const { db, app } = montar(); await sembrar(db); const s = await servidor(app); const api = cliente(s);
  try {
    await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "p1" } });
    const e1 = (await db.collection("entregas_socios").doc("ent_web_pedidojuan01_r1").get()).data();
    await api("GET", "/rev/entregas/ent_web_pedidojuan01_r1", { socio: "ana_socia" }); // visto v1
    const sinMotivo = await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "actualizar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "u0" } });
    assert.equal(sinMotivo.j.error, "falta_motivo");
    const u = await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "actualizar", motivo: "Cambio de clave", compraId: "web_pedidojuan01", renglonId: "r1", opId: "u1", codigo: "CODIGO-NUEVO", codigoAutorizado: true } });
    assert.equal(u.j.version, 2);
    const e2 = (await db.collection("entregas_socios").doc("ent_web_pedidojuan01_r1").get()).data();
    assert.equal(+e2.publicadaAt, +e1.publicadaAt, "la fecha original no cambia");
    const l = await api("GET", "/rev/entregas", { socio: "ana_socia" });
    assert.equal(l.j.items[0].nueva, true, "una actualización vuelve a avisar sin borrar la lectura anterior");
    assert.ok(!outbox(db).some(([, j]) => /CODIGO-NUEVO/.test(j.text)), "el mensaje de actualización no contiene códigos");
    const c = await api("POST", "/rev/entregas/ent_web_pedidojuan01_r1/codigo", { socio: "ana_socia" });
    assert.equal(c.j.codigo, "CODIGO-NUEVO");
    const rv = await api("POST", "/rev/admin/entregas/ent_web_pedidojuan01_r1/revocar", { admin: true, body: { motivo: "Pago rechazado" } });
    assert.match(rv.j.nota, /no se retiran/);
    assert.equal((await api("POST", "/rev/entregas/ent_web_pedidojuan01_r1/codigo", { socio: "ana_socia" })).status, 404);
    const det = await api("GET", "/rev/entregas/ent_web_pedidojuan01_r1", { socio: "ana_socia" });
    assert.equal(det.j.entrega.estado, "revocada"); assert.equal(det.j.entrega.codigoDisponible, false);
    // reenviar no cambia fecha ni crea compra
    const nCompras = Object.keys(db.dump("compras")).length;
    await api("POST", "/rev/admin/entregas/guardar", { admin: true, body: { accion: "publicar", compraId: "web_pedidojuan01", renglonId: "r1", opId: "p2" } });
    await api("POST", "/rev/admin/entregas/ent_web_pedidojuan01_r1/reenviar", { admin: true, body: { opId: "rs1" } });
    await api("POST", "/rev/admin/entregas/ent_web_pedidojuan01_r1/reenviar", { admin: true, body: { opId: "rs1" } });
    assert.equal(Object.keys(db.dump("compras")).length, nCompras);
    assert.equal(outbox(db).filter(([id]) => /_r1$/.test(id)).length, 1, "reenviar con el mismo opId no duplica");
  } finally { s.close(); }
});

test("Histórico: simular, importar en silencio (sin avisos, sin ingresos), idempotente, visible solo al habilitar, revertible", async () => {
  const { db, app } = montar(); await sembrar(db); const s = await servidor(app); const api = cliente(s);
  try {
    await db.collection("compras").doc("viejo000001").set({ socio_norm: "ana_socia", estado: "entregado", servicio: "Disney", cliente: "Rosa Díaz", productos: [{ servicio: "Disney", nombreCliente: "Rosa Díaz" }], estadoHistorial: [{ estado: "entregado", at: "2026-03-01T12:00:00Z" }], monto: 120 });
    await db.collection("compras").doc("viejo000002").set({ socio_norm: "ana_socia", estado: "entregado", servicio: "HBO", cliente: "Luis", productos: [{ servicio: "HBO", nombreCliente: "Luis" }] }); // sin fecha
    await db.collection("compras").doc("viejo000003").set({ socio_norm: "fantasma", estado: "entregado", servicio: "Max", cliente: "X" });
    await db.collection("compras").doc("viejo000004").set({ socio_norm: "ana_socia", estado: "entregado", servicio: "Max", cliente: "", productos: [{ servicio: "Max" }] }); // ambiguo
    const sim = await api("GET", "/rev/admin/entregas/historico/simular", { admin: true });
    assert.equal(sim.j.encontradas, 4); assert.equal(sim.j.vinculables, 2); assert.equal(sim.j.sinSocio, 1); assert.equal(sim.j.ambiguas, 1); assert.equal(sim.j.sinFecha, 1);
    assert.equal(Object.keys(db.dump("entregas_socios")).length, 0, "simular no escribe");
    const imp = await api("POST", "/rev/admin/entregas/historico/importar", { admin: true, body: { confirmar: true, socios: ["ana_socia"] } });
    assert.equal(imp.j.importadas, 2); assert.equal(outbox(db).length, 0, "no avisa");
    const again = await api("POST", "/rev/admin/entregas/historico/importar", { admin: true, body: { confirmar: true } });
    assert.equal(again.j.importadas, 0, "reimportar no duplica");
    const e = (await db.collection("entregas_socios").doc("enth_compras_viejo000002_r1").get()).data();
    assert.equal(e.fechaOriginal, null); assert.equal(e.importe, null); assert.equal(e.contabilizar, false); assert.equal(e.notificar, false);
    assert.equal((await api("GET", "/rev/entregas", { socio: "ana_socia" })).j.items.length, 0, "no visible hasta validar la muestra");
    await api("POST", `/rev/admin/entregas/historico/${imp.j.loteId}/habilitar`, { admin: true });
    const l = await api("GET", "/rev/entregas?pedido=000001", { socio: "ana_socia" });
    assert.equal(l.j.items.length, 1); assert.equal(l.j.items[0].historico, true); assert.equal(l.j.items[0].nueva, false, "no cuenta como novedad");
    const nov = await api("GET", "/rev/novedades", { socio: "ana_socia" }); assert.equal(nov.j.total, 0);
    assert.equal((await db.collection("compras").doc("viejo000001").get()).data().monto, 120, "la fuente original no se toca");
    await api("POST", `/rev/admin/entregas/historico/${imp.j.loteId}/revertir`, { admin: true });
    assert.equal(Object.keys(db.dump("entregas_socios")).length, 0);
  } finally { s.close(); }
});

test("Paginación del servidor y filtros: sin límite de cuatro", async () => {
  const { db, app } = montar(); await sembrar(db); const s = await servidor(app); const api = cliente(s);
  try {
    for (let i = 0; i < 27; i++) await db.collection("entregas_socios").doc(`enth_compras_x${i}_r1`).set({ socio_norm: "ana_socia", estado: "publicada", version: 1, visibleSocio: true, historico: true, servicio: i % 2 ? "Netflix" : "Disney", clienteNombre: `Cliente ${i}`, fechaOriginal: new Date(Date.UTC(2026, 0, 1 + i)), visto: { version: 1 } });
    const p1 = await api("GET", "/rev/entregas?limit=20", { socio: "ana_socia" });
    assert.equal(p1.j.items.length, 20); assert.equal(p1.j.total, 27); assert.ok(p1.j.cursor);
    const p2 = await api("GET", `/rev/entregas?limit=20&cursor=${p1.j.cursor}`, { socio: "ana_socia" });
    assert.equal(p2.j.items.length, 7); assert.equal(p2.j.cursor, "");
    const f = await api("GET", "/rev/entregas?servicio=disney&desde=2026-01-10&hasta=2026-01-20", { socio: "ana_socia" });
    assert.ok(f.j.items.length > 0 && f.j.items.every((x) => x.servicio === "Disney"));
    assert.equal((await api("GET", "/rev/entregas", { socio: "beto_socio" })).j.total, 0);
  } finally { s.close(); }
});

test("Buzón: consulta web → equipo por Telegram → respuesta → el socio responde desde Telegram al MISMO hilo, sin duplicados", async () => {
  const { db, app } = montar(); await sembrar(db); const s = await servidor(app); const api = cliente(s);
  try {
    const c = await api("POST", "/rev/consultas", { socio: "ana_socia", body: { asunto: "Netflix no abre", texto: "El perfil pide código", pedidoId: "web_pedidojuan01", opId: "q1" } });
    assert.equal(c.status, 200); assert.equal(c.j.consulta.numero, "C101"); assert.equal(c.j.consulta.pedidoRef, "JUAN01");
    const dup = await api("POST", "/rev/consultas", { socio: "ana_socia", body: { texto: "El perfil pide código", opId: "q1" } });
    assert.equal(dup.j.duplicate, true);
    const ajena = await api("POST", "/rev/consultas", { socio: "beto_socio", body: { texto: "x", pedidoId: "web_pedidojuan01" } });
    assert.equal(ajena.status, 403);
    const id = c.j.consulta.id;
    const eq = outbox(db).find(([k]) => k.endsWith("_eq"));
    assert.equal(eq[1].chatId, "900001"); assert.deepEqual(eq[1].onSent, { collection: "buzon_telegram_messages", data: { consultaId: id, rol: "equipo" } });
    await api("POST", `/rev/admin/consultas/${id}/mensajes`, { admin: true, body: { texto: "Nota interna: revisar correo", interna: true, opId: "n1" } });
    await api("POST", `/rev/admin/consultas/${id}/mensajes`, { admin: true, actor: "naara", body: { texto: "Ya le cambiamos el perfil", opId: "r1" } });
    const so = outbox(db).filter(([k]) => k.endsWith("_so"));
    assert.equal(so.length, 1, "la nota interna nunca sale al socio"); assert.match(so[0][1].replyMarkupJson, /bz:r:/);
    const vista = await api("GET", "/rev/consultas", { socio: "ana_socia" });
    const hilo = vista.j.items.find((x) => x.id === id);
    assert.equal(hilo.estado, "esperando_socio"); assert.equal(hilo.mensajes.length, 2); assert.ok(!JSON.stringify(hilo).includes("Nota interna"));
    assert.equal(hilo.mensajes[1].nombre, "Sublicuentas", "el socio ve el equipo, no el usuario interno");
    const adm = (await api("GET", "/rev/admin/consultas", { admin: true })).j.items.find((x) => x.id === id);
    assert.match(adm.mensajes.find((m) => m.texto === "Ya le cambiamos el perfil").nombre, /naara \(vía Admin\)/, "auditoría: quién respondió");
    // respuesta desde Telegram (misma lógica que usa el bot): dos veces el mismo message_id → un solo mensaje
    const { crearBuzon } = require("../lib_buzon_core");
    const bz = crearBuzon({ db, getDestinoChatIds: async () => ["900001"] });
    await bz.agregarMensaje(id, { autor: "socio", nombre: "Ana", texto: "Gracias, ya funciona", origen: "telegram", externalId: "tg:111111:55" });
    const r2 = await bz.agregarMensaje(id, { autor: "socio", nombre: "Ana", texto: "Gracias, ya funciona", origen: "telegram", externalId: "tg:111111:55" });
    assert.equal(r2.dup, true);
    const fin = (await api("GET", "/rev/consultas", { socio: "ana_socia" })).j.items.find((x) => x.id === id);
    assert.equal(fin.mensajes.length, 3); assert.equal(fin.mensajes[2].origen, "telegram"); assert.equal(fin.estado, "en_atencion");
    assert.equal((await api("GET", "/rev/consultas", { socio: "beto_socio" })).j.items.length, 0, "el socio no ve consultas ajenas");
  } finally { s.close(); }
});

test("Vinculación de Telegram: token aleatorio de un uso; rechaza usado, vencido, grupos y cuentas de otro socio", async () => {
  const { db, app } = montar(); await sembrar(db, { telegramA: "" }); const s = await servidor(app); const api = cliente(s);
  try {
    const v = await api("POST", "/rev/telegram/vincular", { socio: "ana_socia" });
    assert.match(v.j.url, /^https:\/\/t\.me\/SubliBotPrueba\?start=v_[A-Za-z0-9_-]{30,}$/);
    const token = v.j.url.split("start=v_")[1];
    assert.ok(!JSON.stringify(db.dump("telegram_vinculos_tokens")).includes(token), "solo se guarda el hash");
    assert.ok(!/ana|socia|111|cli/i.test(token.slice(0, 6)) || token.length >= 30);
    assert.equal(L.tokenDesdeStart(`/start v_${token}`), token);
    const tok = { socioId: "ana_socia", expiraMs: Date.now() + 60000 };
    assert.equal(L.validarVinculo({ tok, chatType: "private", telegramUserId: "333333" }), "");
    assert.equal(L.validarVinculo({ tok: { ...tok, usadoAt: new Date() }, chatType: "private", telegramUserId: "333333" }), "token_usado");
    assert.equal(L.validarVinculo({ tok: { ...tok, expiraMs: 1 }, chatType: "private", telegramUserId: "333333" }), "token_vencido");
    assert.equal(L.validarVinculo({ tok, chatType: "group", telegramUserId: "333333" }), "chat_no_privado");
    assert.equal(L.validarVinculo({ tok, chatType: "private", telegramUserId: "222222", socioDelUsuario: "beto_socio" }), "telegram_de_otro_socio");
    assert.equal(L.validarVinculo({ tok, chatType: "private", telegramUserId: "333333", socioActual: { telegramId: "444444" } }), "ya_vinculado_otro", "no reemplaza en silencio");
    assert.equal(L.validarVinculo({ tok: null }), "token_invalido");
    await db.collection("revendedores").doc("ana_socia").set({ telegramId: "111111" }, { merge: true });
    assert.equal((await api("POST", "/rev/telegram/vincular", { socio: "ana_socia" })).j.error, "ya_vinculado");
    const d = await api("POST", "/rev/telegram/desvincular", { socio: "ana_socia" });
    assert.equal(d.j.conectado, false);
    assert.equal((await api("GET", "/rev/telegram/estado", { socio: "ana_socia" })).j.conectado, false);
  } finally { s.close(); }
});

test("Cableado: bot, cola incierta, comprobante repetido y puente HQ", () => {
  const out = fs.readFileSync(path.join(__dirname, "..", "index_22_telegram_outbox.js"), "utf8");
  assert.match(out, /job\.noRetryOnUncertain && resultadoIncierto\(e\)/); assert.match(out, /status: 'uncertain'/); assert.match(out, /job\.onSent && job\.onSent\.collection/);
  const h = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  const handler = h.slice(h.indexOf('bot.on("message"'));
  assert.ok(handler.indexOf("tryVincular(msg)") > 0 && handler.indexOf("tryVincular(msg)") < handler.indexOf("userHasAccessFromMessage(msg)"), "vincular antes del control de acceso");
  assert.match(h, /tryMensaje\(msg,\{adminOk,superOk,vend\}\)/); assert.match(h, /data\.startsWith\("bz:r:"\)/);
  const srv = fs.readFileSync(path.join(__dirname, "..", "server_api.js"), "utf8");
  assert.match(srv, /require\("\.\/rev_entregas_api"\)\.registrar\(app/); assert.match(srv, /posible_comprobante_repetido/); assert.match(srv, /comprobanteHash, \.\.\.\(pagoRevision/);
  const tg = fs.readFileSync(path.join(__dirname, "..", "index_36_socios_telegram.js"), "utf8");
  assert.match(tg, /msg\.chat\?\.type !== "private"/); assert.match(tg, /Solo administradores pueden responder/);
  assert.equal(L.hiloDesdeTelegram({ abiertas: 3 }).consultaId, "", "texto suelto con varias abiertas: nunca al último hilo");
});
