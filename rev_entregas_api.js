"use strict";
/* SUBLICUENTAS · Panel API · Entregas a socios, Buzón de dos vías, vínculo de Telegram e historial (oct-2026)
   Se registra desde server_api.js: require("./rev_entregas_api").registrar(app, deps).

   Colecciones (nuevas, no destructivas):
     entregas_socios/{ent_<compra>_<renglon> | enth_<sistema>_<id>_<renglon>}   + /versiones/{n}
     buzon_consultas/{id}  · contadores/buzon_consultas
     buzon_telegram_messages/{chat}_{message}   (lo escribe la cola al enviar)
     telegram_vinculos_tokens/{sha256(token)}   (el token en claro nunca se guarda)
     entregas_lotes/{loteId}                     (importaciones del historial anterior)
   Los avisos de Telegram van a telegram_outbox (cola durable del bot) con ID determinístico:
   un doble clic o un reintento del navegador nunca crea dos avisos de la misma versión. */

const L = require("./lib_entregas_socios");
const { crearBuzon, outboxDoc: outboxDocBase } = require("./lib_buzon_core");

const COL = { ent: "entregas_socios", cons: "buzon_consultas", tok: "telegram_vinculos_tokens", lotes: "entregas_lotes", outbox: "telegram_outbox", cont: "contadores" };
const PERMISOS_ENTREGA = ["socios.compras.write", "socios.compras.own.write"];
const PERMISOS_LECTURA = ["socios.compras.read", "socios.compras.own.read"];
const TOKEN_MIN = 10;

function registrar(app, d) {
  const { db, revAuth, revAdminAuth, adminAnyPermission, isFullAdmin, adminScopeProfile, revLiveProfile, revSocioAliases, revNormKey, revFiltrarClientePorAliases, destinoInfo, getDestinoChatIds } = d;
  const env = d.env || process.env;
  const now = () => (d.now ? d.now() : new Date());
  const llave = () => L.llaveCodigos(env);
  const PANEL_URL = () => String(env.SOCIOS_PANEL_URL || "").trim();
  const PORTAL_BASE = () => String(env.PORTAL_CLIENTE_BASE || "https://sublichat.capuchino.lat").trim().replace(/\/+$/, "");

  const fail = (res, status, error, extra = {}) => res.status(status).json({ ok: false, error, ...extra });
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { console.error("entregas", req.method, req.path, e?.message || e); fail(res, e.status || 500, e.publicError || "server"); }
  };
  // Quién lo hizo: la sesión admin del Panel API + (si llega por el puente de Sublichat) el usuario real de Sublichat.
  const actorDe = (req) => ({ admin: L.clean(req.admin?.nombre || req.admin?.usuario || "Admin", 80), delegado: L.clean(req.headers?.["x-sublichat-actor"] || "", 80) });
  const actorTxt = (a) => a.delegado ? `${a.delegado} (vía ${a.admin})` : a.admin;
  const enAmbito = (req, compra) => isFullAdmin(req) || revNormKey(compra.destino || "sublicuentas") === adminScopeProfile(req);

  async function socioPorNorm(socioNorm) {
    const n = revNormKey(socioNorm);
    if (!n) return null;
    const aliases = n === "geisell" ? ["geisell", "geissel"] : n === "geissel" ? ["geissel", "geisell"] : [n];
    for (const a of aliases) {
      const s = await db.collection("revendedores").where("nombre_norm", "==", a).limit(1).get();
      if (!s.empty) return { id: s.docs[0].id, ...(s.docs[0].data() || {}) };
    }
    return null;
  }
  async function aliasesSocio(req) {
    const live = await revLiveProfile(req.rev);
    return { live, aliases: revSocioAliases(live, req.rev) };
  }
  const chatSocio = (socio) => {
    const v = socio && socio.telegramVinculo;
    if (v && v.estado === "desvinculado") return "";
    return String(socio?.telegramId || "").replace(/[^0-9-]/g, "");
  };

  const outboxDoc = (o) => outboxDocBase(o, now());
  const ESTADO_AVISO = { pending: "pendiente", retry_wait: "pendiente", processing: "procesando", sent: "aceptado", failed: "fallido", uncertain: "incierto" };
  async function estadoAvisos(avisos = []) {
    const out = [];
    for (const a of avisos.slice(-6)) {
      const s = await db.collection(COL.outbox).doc(a.id).get();
      const x = s.exists ? s.data() || {} : {};
      out.push({ id: a.id, version: a.version, reenvio: a.reenvio || 0, estado: s.exists ? (ESTADO_AVISO[x.status] || x.status) : a.sinVinculo ? "sin_vinculo" : "desconocido", error: L.clean(x.errorKind || x.error || "", 120), at: L.ms(a.at) });
    }
    return out;
  }

  /* ---------- ficha de Sublichat del servicio (IDs estables; la búsqueda solo ayuda a elegir) ---------- */
  function servicioDeFicha(cliente = {}, ficha = {}) {
    const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
    let idx = Number.isInteger(Number(ficha.servicioIndex)) ? Number(ficha.servicioIndex) : -1;
    let s = idx >= 0 ? servicios[idx] : null;
    if (!s || (ficha.servicioCompraId && String(s.compraId || "") !== String(ficha.servicioCompraId))) {
      idx = servicios.findIndex((x) => ficha.servicioCompraId && String(x?.compraId || "") === String(ficha.servicioCompraId));
      s = idx >= 0 ? servicios[idx] : null;
    }
    return s ? { servicio: s, index: idx } : null;
  }
  function keyBeneficiario(s = {}) {
    if (String(s.beneficiarioKey || "").trim()) return String(s.beneficiarioKey).trim();
    if (String(s.beneficiarioTipo || "").toLowerCase() !== "tercero") return "titular";
    const k = L.norm(s.beneficiarioNombre || s.beneficiario).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "persona";
    return `tercero-${k}`;
  }
  function tokenPortal(cliente = {}, s = {}) {
    const reg = cliente.accesosBeneficiarios && typeof cliente.accesosBeneficiarios === "object" ? cliente.accesosBeneficiarios : {};
    return String(reg[keyBeneficiario(s)]?.token || s.token || "").trim();
  }
  const fechaServicio = (s = {}) => L.clean(s.fechaRenovacion || s.fecha_renovacion || s.vence || "", 40);

  /* ======================= ADMINISTRACIÓN ======================= */
  const adminW = [revAdminAuth, adminAnyPermission(PERMISOS_ENTREGA)];
  const adminR = [revAdminAuth, adminAnyPermission([...PERMISOS_LECTURA, ...PERMISOS_ENTREGA])];

  // Entregas de un pedido (por renglón) con estado de avisos y versiones.
  app.get("/rev/admin/entregas", ...adminR, wrap(async (req, res) => {
    const compraId = L.clean(req.query.compraId, 120);
    if (!compraId) return fail(res, 400, "falta_compra");
    const cs = await db.collection("compras").doc(compraId).get();
    if (!cs.exists) return fail(res, 404, "no_existe");
    const compra = cs.data() || {};
    if (!enAmbito(req, compra)) return fail(res, 403, "fuera_de_ambito");
    const socio = await socioPorNorm(compra.socio_norm || compra.socio);
    const productos = Array.isArray(compra.productos) && compra.productos.length ? compra.productos : [{ renglonId: "r1", servicio: compra.servicio }];
    const renglones = [];
    for (let i = 0; i < productos.length; i++) {
      const p = productos[i], rid = p.renglonId || `r${i + 1}`, id = L.entregaId(compraId, rid);
      const s = await db.collection(COL.ent).doc(id).get();
      const e = s.exists ? s.data() || {} : null;
      const vers = s.exists ? await db.collection(COL.ent).doc(id).collection("versiones").orderBy("n", "desc").limit(10).get() : { docs: [] };
      renglones.push({
        renglonId: rid, servicio: p.servicio || compra.servicio || "", clienteNombre: p.clienteNombre || p.perfil || compra.cliente || "", modalidad: p.modalidad || p.entregaTipo || "",
        datos: { dispositivo: p.dispositivo || "", correo: p.correo || "", detalle: p.detalleServicio || "", notas: p.notas || "" },
        entrega: e ? {
          id, estado: e.estado, version: Number(e.version) || 0, ficha: e.portal || null, fichaResumen: e.fichaResumen || null, portalAutorizado: !!e.portalAutorizado,
          codigoGuardado: !!e.codigoCifrado, codigoAutorizado: !!e.codigoAutorizado, notaSocio: e.notaSocio || "", mensajeCliente: e.mensajeCliente || "",
          publicadaAt: L.ms(e.publicadaAt) || null, actualizadaAt: L.ms(e.actualizadaAt) || null, revocadaAt: L.ms(e.revocadaAt) || null, motivoRevocacion: e.motivoRevocacion || "",
          visto: e.visto ? { version: e.visto.version, at: L.ms(e.visto.primeraAt) } : null, avisos: await estadoAvisos(e.avisos || []),
          versiones: vers.docs.map((v) => { const x = v.data() || {}; return { n: x.n, accion: x.accion, actor: x.actor, motivo: x.motivo || "", at: L.ms(x.at) }; }),
        } : null,
      });
    }
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, compraId, ref: compraId.slice(-6).toUpperCase(), socio: compra.socio || compra.socio_norm || "", socioVerificado: !!socio,
      telegram: socio ? (chatSocio(socio) ? "vinculado" : "sin_vinculo") : "socio_no_encontrado", estadoPedido: compra.estado || "pendiente",
      cliente: compra.clientePrincipal ? L.clean(`${compra.clientePrincipal.nombre || ""} ${compra.clientePrincipal.apellido || ""}`, 120) : (compra.cliente || ""),
      pago: { monto: Number(compra.monto) || 0, banco: compra.banco || "", comprobante: !!(compra.imagenUrl || compra.imagenData), revision: compra.pagoRevision || null },
      resumen: L.estadoEntregaPedido(productos, compra.entregas || {}, compra.estado), renglones });
  }));

  // Buscar ficha de Sublichat para vincular (solo ayuda a elegir; publicar exige que el servicio sea de ese socio).
  app.get("/rev/admin/entregas/fichas", ...adminW, wrap(async (req, res) => {
    const q = L.norm(req.query.q || ""), dig = String(req.query.q || "").replace(/\D/g, "");
    const socio = await socioPorNorm(req.query.socio || "");
    if (!socio) return fail(res, 404, "socio_no_encontrado");
    if (q.length < 2 && dig.length < 4) return res.json({ ok: true, items: [] });
    const aliases = revSocioAliases(socio, {});
    const snap = await (d.allClientDocs ? d.allClientDocs() : db.collection("clientes").get().then((s) => s.docs));
    const items = [];
    for (const doc of snap) {
      const c = doc.data() || {};
      const nombre = String(c.nombre || c.nombrePerfil || "");
      if (!(L.norm(nombre).includes(q) || (dig.length >= 4 && String(c.telefono || c.telefono_norm || "").replace(/\D/g, "").includes(dig)))) continue;
      const visibles = revFiltrarClientePorAliases(c, aliases).servicios || [];
      const servicios = (Array.isArray(c.servicios) ? c.servicios : []).map((s, index) => ({
        index, compraId: String(s?.compraId || ""), plataforma: L.clean(s?.plataforma, 60), vence: fechaServicio(s), beneficiario: keyBeneficiario(s),
        deEsteSocio: visibles.some((v) => String(v?.compraId || "") && String(v.compraId) === String(s?.compraId || "")),
      })).filter((s) => s.compraId);
      if (!servicios.some((s) => s.deEsteSocio)) continue; // nunca ofrecer fichas ajenas al socio del pedido
      items.push({ clienteId: doc.id, nombre: L.clean(nombre, 120), telefono: L.clean(c.telefono || c.telefono_norm || "", 30).replace(/\d(?=\d{4})/g, "•"), servicios: servicios.filter((s) => s.deEsteSocio) });
      if (items.length >= 15) break;
    }
    res.json({ ok: true, items });
  }));

  async function prepararEntrega(req, compraId, renglonId) {
    const cs = await db.collection("compras").doc(compraId).get();
    if (!cs.exists) throw Object.assign(new Error("no_existe"), { status: 404, publicError: "no_existe" });
    const compra = cs.data() || {};
    if (!enAmbito(req, compra)) throw Object.assign(new Error("fuera"), { status: 403, publicError: "fuera_de_ambito" });
    const productos = Array.isArray(compra.productos) && compra.productos.length ? compra.productos : [{ renglonId: "r1", servicio: compra.servicio }];
    const i = productos.findIndex((p, k) => (p.renglonId || `r${k + 1}`) === renglonId);
    if (i < 0) throw Object.assign(new Error("renglon"), { status: 400, publicError: "renglon_invalido" });
    const socio = await socioPorNorm(compra.socio_norm || compra.socio);
    if (!socio) throw Object.assign(new Error("socio"), { status: 409, publicError: "socio_no_verificado" });
    return { compra, productos, producto: productos[i], socio };
  }
  async function resolverFicha(ficha, socio) {
    if (!ficha || !ficha.clienteId) return null;
    const cdoc = await db.collection("clientes").doc(L.clean(ficha.clienteId, 120)).get();
    if (!cdoc.exists) throw Object.assign(new Error("ficha"), { status: 404, publicError: "ficha_no_existe" });
    const cliente = cdoc.data() || {};
    const found = servicioDeFicha(cliente, ficha);
    if (!found) throw Object.assign(new Error("svc"), { status: 404, publicError: "servicio_no_existe" });
    const visibles = revFiltrarClientePorAliases(cliente, revSocioAliases(socio, {})).servicios || [];
    if (!visibles.some((v) => String(v?.compraId || "") === String(found.servicio.compraId || ""))) throw Object.assign(new Error("ajena"), { status: 403, publicError: "ficha_de_otro_socio" });
    return {
      portal: { clienteId: cdoc.id, servicioCompraId: String(found.servicio.compraId || ""), servicioIndex: found.index, beneficiarioKey: keyBeneficiario(found.servicio) },
      fichaResumen: { cliente: L.clean(cliente.nombre || cliente.nombrePerfil, 120), plataforma: L.clean(found.servicio.plataforma, 60), vence: fechaServicio(found.servicio) },
    };
  }

  // Vista previa: exactamente lo que verá el socio (sin el código) + el aviso de Telegram.
  app.post("/rev/admin/entregas/vista-previa", ...adminW, wrap(async (req, res) => {
    const b = req.body || {};
    const compraId = L.clean(b.compraId, 120), renglonId = L.clean(b.renglonId, 60);
    const { compra, producto, socio } = await prepararEntrega(req, compraId, renglonId);
    const f = await resolverFicha(b.ficha, socio);
    const cliente = producto.clienteNombre || compra.cliente || "";
    res.json({ ok: true,
      socio: { nombre: socio.nombre || compra.socio, telegram: chatSocio(socio) ? "vinculado" : "sin_vinculo" },
      verSocio: { pedido: `#${compraId.slice(-6).toUpperCase()}`, cliente, servicio: producto.servicio || compra.servicio, vence: f?.fichaResumen?.vence || "",
        portal: f && b.portalAutorizado ? "Botón “Abrir portal del cliente” (solo este servicio/persona)" : "Sin portal", codigo: b.codigoAutorizado ? "Código visible para el socio (oculto hasta que lo pida)" : "Sin código",
        nota: L.clean(b.notaSocio, 600), mensajeCliente: L.clean(b.mensajeCliente, 1500) },
      telegram: chatSocio(socio) ? L.mensajeEntregaTelegram({ ref: compraId.slice(-6).toUpperCase(), cliente, servicio: producto.servicio, actualizacion: b.accion === "actualizar" }) : "",
      ficha: f?.fichaResumen || null });
  }));

  // Guardar borrador · Publicar · Actualizar (una sola transacción: entrega + versión + pedido + aviso).
  app.post("/rev/admin/entregas/guardar", ...adminW, wrap(async (req, res) => {
    const b = req.body || {};
    const accion = ["borrador", "publicar", "actualizar"].includes(b.accion) ? b.accion : "";
    if (!accion) return fail(res, 400, "accion_invalida");
    const compraId = L.clean(b.compraId, 120), renglonId = L.clean(b.renglonId, 60), opId = L.safeId(b.opId, 80);
    if (!compraId || !renglonId) return fail(res, 400, "faltan_datos");
    if (accion !== "borrador" && !opId) return fail(res, 400, "falta_op_id");
    const motivo = L.clean(b.motivo, 300);
    if (accion === "actualizar" && !motivo) return fail(res, 400, "falta_motivo");
    const { compra, productos, producto, socio } = await prepararEntrega(req, compraId, renglonId);
    if (accion !== "borrador" && String(compra.estado || "").toLowerCase() === "cancelado") return fail(res, 409, "pedido_cancelado");
    const f = await resolverFicha(b.ficha, socio);
    const codigoNuevo = L.clean(b.codigo, 200);
    const cifrado = codigoNuevo ? L.cifrarCodigo(codigoNuevo, llave()) : null;
    const actor = actorDe(req), id = L.entregaId(compraId, renglonId);
    const entRef = db.collection(COL.ent).doc(id), compraRef = db.collection("compras").doc(compraId);
    const chat = chatSocio(socio);
    const avisar = accion === "publicar" || (accion === "actualizar" && b.avisar !== false);

    const r = await db.runTransaction(async (tx) => {
      const [es, cs] = [await tx.get(entRef), await tx.get(compraRef)];
      const prev = es.exists ? es.data() || {} : null;
      const comp = cs.data() || compra;
      if (prev && (prev.opIds || []).includes(opId) && opId) return { dup: true, version: prev.version, estado: prev.estado };
      if (accion === "borrador" && prev && prev.estado === "publicada") throw Object.assign(new Error("pub"), { status: 409, publicError: "ya_publicada_use_actualizar" });
      if (accion === "publicar" && prev && prev.estado === "publicada") throw Object.assign(new Error("pub"), { status: 409, publicError: "ya_publicada_use_actualizar" });
      if (accion === "actualizar" && (!prev || prev.estado !== "publicada")) throw Object.assign(new Error("np"), { status: 409, publicError: "no_publicada" });
      const t = now();
      const version = accion === "borrador" ? Number(prev?.version || 0) : Number(prev?.version || 0) + 1;
      const doc = {
        compraId, renglonId, pedidoRef: compraId.slice(-6).toUpperCase(), socio_norm: revNormKey(comp.socio_norm || socio.nombre_norm), socioId: socio.id,
        servicio: L.clean(producto.servicio || comp.servicio, 140), modalidad: L.clean(producto.modalidad || producto.entregaTipo, 40),
        clienteNombre: L.clean(producto.clienteNombre || producto.perfil || comp.cliente, 120),
        estado: accion === "borrador" ? (prev?.estado === "revocada" ? "revocada" : "borrador") : "publicada", version,
        portal: f ? f.portal : (b.ficha === null ? null : prev?.portal || null), fichaResumen: f ? f.fichaResumen : prev?.fichaResumen || null,
        vencimiento: f ? f.fichaResumen.vence : prev?.vencimiento || "", portalAutorizado: !!b.portalAutorizado && !!(f || prev?.portal),
        codigoCifrado: cifrado || (b.quitarCodigo ? null : prev?.codigoCifrado || null), codigoAutorizado: !!b.codigoAutorizado && !!(cifrado || (!b.quitarCodigo && prev?.codigoCifrado)),
        notaSocio: L.clean(b.notaSocio, 600), mensajeCliente: L.clean(b.mensajeCliente, 1500),
        historico: false, notificar: true, visibleSocio: true, origen: prev?.origen || { sistema: "panel", id: compraId },
        actualizadoPor: actorTxt(actor), updatedAt: t, opIds: [...(prev?.opIds || []), ...(opId ? [opId] : [])].slice(-20),
        avisos: prev?.avisos || [], visto: prev?.visto || null, createdAt: prev?.createdAt || t,
      };
      if (accion !== "borrador") {
        doc.publicadaAt = prev?.publicadaAt || t; // fecha ORIGINAL: nunca cambia con actualizaciones ni reenvíos
        doc.actualizadaAt = t; doc.publicadoPor = prev?.publicadoPor || actorTxt(actor);
        if (accion === "actualizar") doc.motivoActualizacion = motivo;
        doc.revocadaAt = null; doc.motivoRevocacion = "";
      }
      let aviso = null;
      if (accion !== "borrador" && avisar) {
        if (chat) {
          const aid = L.avisoId(id, version, "tg");
          const url = L.urlPanelEntrega(PANEL_URL(), id);
          tx.set(db.collection(COL.outbox).doc(aid), outboxDoc({ chatId: chat, text: L.mensajeEntregaTelegram({ ref: doc.pedidoRef, cliente: doc.clienteNombre, servicio: doc.servicio, actualizacion: accion === "actualizar" }), replyMarkup: L.botonPanel(url), reference: `entrega:${id}:v${version}` }));
          aviso = { id: aid, version, canal: "telegram", at: t };
        } else aviso = { id: L.avisoId(id, version, "tg"), version, canal: "telegram", at: t, sinVinculo: true };
        doc.avisos = [...doc.avisos, aviso].slice(-30);
      }
      tx.set(entRef, doc);
      tx.set(entRef.collection("versiones").doc(String(Date.now()) + "_" + version), { n: version, accion, actor: actorTxt(actor), at: t, motivo: motivo || "", codigoCambiado: !!cifrado, ficha: doc.fichaResumen || null });
      if (accion !== "borrador") {
        const entregas = { ...(comp.entregas || {}), [renglonId]: { entregaId: id, estado: "publicada", version, at: t } };
        const resumen = L.estadoEntregaPedido(productos, entregas, comp.estado);
        const patch = { entregas, entregaResumen: resumen, updatedAt: t };
        if (resumen.estado === "entregado" && String(comp.estado || "").toLowerCase() !== "entregado") {
          patch.estado = "entregado"; patch.estadoPorEntregas = true; patch.detalleEstado = "Entregado al socio"; patch.estadoUpdatedAt = t;
          patch.estadoHistorial = [...(comp.estadoHistorial || []), { estado: "entregado", detalle: "Entrega publicada en el panel", at: t.toISOString(), por: actorTxt(actor) }].slice(-40);
        } else if (resumen.estado === "parcial") {
          patch.detalleEstado = resumen.texto;
          if (!["entregado", "cancelado"].includes(String(comp.estado || "").toLowerCase())) { patch.estado = "en proceso"; patch.estadoUpdatedAt = t; }
        }
        tx.set(compraRef, patch, { merge: true });
      }
      return { version, estado: doc.estado, aviso };
    });
    res.json({ ok: true, id, duplicate: !!r.dup, version: r.version, estado: r.estado, aviso: r.aviso ? (r.aviso.sinVinculo ? "sin_vinculo" : "pendiente") : null });
  }));

  // Reenviar aviso: reutiliza la entrega; no crea compra ni cambia la fecha original.
  app.post("/rev/admin/entregas/:id/reenviar", ...adminW, wrap(async (req, res) => {
    const ref = db.collection(COL.ent).doc(L.safeId(req.params.id, 160));
    const s = await ref.get(); if (!s.exists) return fail(res, 404, "no_existe");
    const e = s.data() || {};
    if (e.estado !== "publicada") return fail(res, 409, "no_publicada");
    const cs = await db.collection("compras").doc(e.compraId).get();
    if (cs.exists && !enAmbito(req, cs.data() || {})) return fail(res, 403, "fuera_de_ambito");
    const socio = await socioPorNorm(e.socio_norm); const chat = chatSocio(socio);
    if (!chat) return fail(res, 409, "socio_sin_telegram");
    const opId = L.safeId(req.body?.opId, 80) || "";
    const r = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() || {};
      if (opId && (fresh.opIds || []).includes(opId)) return { dup: true };
      const n = (fresh.avisos || []).filter((a) => a.version === fresh.version).length;
      const aid = L.avisoId(ref.id, fresh.version, "tg", n);
      tx.set(db.collection(COL.outbox).doc(aid), outboxDoc({ chatId: chat, text: L.mensajeEntregaTelegram({ ref: fresh.pedidoRef, cliente: fresh.clienteNombre, servicio: fresh.servicio }), replyMarkup: L.botonPanel(L.urlPanelEntrega(PANEL_URL(), ref.id)), reference: `entrega:${ref.id}:v${fresh.version}:r${n}` }));
      tx.set(ref, { avisos: [...(fresh.avisos || []), { id: aid, version: fresh.version, reenvio: n, canal: "telegram", at: now() }].slice(-30), opIds: [...(fresh.opIds || []), ...(opId ? [opId] : [])].slice(-20) }, { merge: true });
      tx.set(ref.collection("versiones").doc(String(Date.now()) + "_r"), { n: fresh.version, accion: "reenviar_aviso", actor: actorTxt(actorDe(req)), at: now() });
      return { id: aid };
    });
    res.json({ ok: true, duplicate: !!r.dup, aviso: "pendiente" });
  }));

  // Revocar: oculta la información al socio; deja motivo e historial. No cancela el servicio real.
  app.post("/rev/admin/entregas/:id/revocar", ...adminW, wrap(async (req, res) => {
    const motivo = L.clean(req.body?.motivo, 300);
    if (!motivo) return fail(res, 400, "falta_motivo");
    const ref = db.collection(COL.ent).doc(L.safeId(req.params.id, 160));
    const s = await ref.get(); if (!s.exists) return fail(res, 404, "no_existe");
    const e0 = s.data() || {};
    const compraRef = e0.compraId ? db.collection("compras").doc(e0.compraId) : null;
    if (compraRef) { const cs = await compraRef.get(); if (cs.exists && !enAmbito(req, cs.data() || {})) return fail(res, 403, "fuera_de_ambito"); }
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() || {};
      const cs = compraRef && !fresh.historico ? await tx.get(compraRef) : null;
      if (fresh.estado === "revocada") return;
      const t = now();
      tx.set(ref, { estado: "revocada", revocadaAt: t, motivoRevocacion: motivo, codigoAutorizado: false, portalAutorizado: false, updatedAt: t }, { merge: true });
      tx.set(ref.collection("versiones").doc(String(Date.now()) + "_x"), { n: fresh.version || 0, accion: "revocar", actor: actorTxt(actorDe(req)), at: t, motivo });
      if (cs && cs.exists) {
        const comp = cs.data() || {};
        const entregas = { ...(comp.entregas || {}), [fresh.renglonId]: { ...(comp.entregas || {})[fresh.renglonId], estado: "revocada", at: t } };
        const productos = Array.isArray(comp.productos) && comp.productos.length ? comp.productos : [{ renglonId: "r1" }];
        const resumen = L.estadoEntregaPedido(productos, entregas, comp.estado);
        const patch = { entregas, entregaResumen: resumen, updatedAt: t };
        if (comp.estadoPorEntregas && String(comp.estado).toLowerCase() === "entregado") { patch.estado = "en proceso"; patch.estadoPorEntregas = false; patch.detalleEstado = resumen.texto; patch.estadoUpdatedAt = t; }
        tx.set(compraRef, patch, { merge: true });
      }
    });
    res.json({ ok: true, estado: "revocada", nota: "Los mensajes ya enviados por Telegram no se retiran automáticamente." });
  }));

  /* ======================= SOCIO ======================= */
  async function entregaDelSocio(req, id) {
    const { live, aliases } = await aliasesSocio(req);
    const s = await db.collection(COL.ent).doc(L.safeId(id, 160)).get();
    // Conocer un ID no concede acceso: mismo error para "no existe" y "es de otro socio".
    if (!s.exists) return { error: 404 };
    const e = s.data() || {};
    if (!aliases.includes(revNormKey(e.socio_norm)) || e.estado === "borrador" || e.visibleSocio === false) return { error: 404 };
    return { ref: s.ref, e, live };
  }
  async function listarDelSocio(req) {
    const { aliases } = await aliasesSocio(req);
    const snap = await db.collection(COL.ent).where("socio_norm", "in", aliases.slice(0, 10)).get();
    return snap.docs.map((x) => ({ id: x.id, data: x.data() || {} })).filter((x) => x.data.estado !== "borrador" && x.data.visibleSocio !== false)
      .map((x) => L.entregaPublica(x.id, x.data));
  }

  app.get("/rev/entregas", revAuth, wrap(async (req, res) => {
    const todas = await listarDelSocio(req);
    const filtradas = L.filtrarEntregas(todas, req.query || {});
    const pag = L.paginar(filtradas, req.query.cursor, req.query.limit);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, ...pag, nuevas: todas.filter((e) => e.nueva).length });
  }));

  app.get("/rev/entregas/:id", revAuth, wrap(async (req, res) => {
    const r = await entregaDelSocio(req, req.params.id);
    if (r.error) return fail(res, 404, "no_disponible");
    const { e, ref } = r;
    const pub = L.entregaPublica(ref.id, e, { detalle: true });
    let servicioActual = null;
    if (e.estado === "publicada" && e.portal?.clienteId) {
      const c = await db.collection("clientes").doc(e.portal.clienteId).get();
      const found = c.exists ? servicioDeFicha(c.data() || {}, e.portal) : null;
      servicioActual = found ? { existe: true, plataforma: L.clean(found.servicio.plataforma, 60), vence: fechaServicio(found.servicio), reemplazado: false }
        : { existe: false, reemplazado: true };
    }
    // "Visto por el socio" solo al abrir el detalle autenticado de una entrega publicada (por versión).
    if (e.estado === "publicada" && Number(e.visto?.version || 0) < Number(e.version || 0)) {
      await ref.set({ visto: { version: Number(e.version), primeraAt: e.visto?.primeraAt || now(), ultimaAt: now() } }, { merge: true });
      pub.nueva = false;
    }
    let pedido = null;
    if (e.compraId && !e.historico) {
      const cs = await db.collection("compras").doc(e.compraId).get();
      if (cs.exists) { const c = cs.data() || {}; const productos = Array.isArray(c.productos) && c.productos.length ? c.productos : [{ renglonId: "r1", servicio: c.servicio }];
        pedido = { ref: e.compraId.slice(-6).toUpperCase(), compraId: e.compraId, cliente: c.clientePrincipal ? `${c.clientePrincipal.nombre || ""} ${c.clientePrincipal.apellido || ""}`.trim() : c.cliente || "", createdAt: L.ms(c.createdAt),
          resumen: L.estadoEntregaPedido(productos, c.entregas || {}, c.estado), renglones: productos.map((p, i) => { const rid = p.renglonId || `r${i + 1}`; const x = (c.entregas || {})[rid]; return { renglonId: rid, servicio: p.servicio || "", estado: x?.estado === "publicada" ? "entregado" : x?.estado === "revocada" ? "revocado" : "pendiente", entregaId: x?.estado === "publicada" ? x.entregaId : "" }; }) }; }
    }
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, entrega: { ...pub, servicioActual, portalDisponible: e.estado === "publicada" && !!e.portalAutorizado && !!servicioActual?.existe, codigoDisponible: e.estado === "publicada" && !!e.codigoAutorizado && !!e.codigoCifrado }, pedido });
  }));

  async function auditarSocio(ref, live, accion) {
    try { await ref.collection("versiones").doc(String(Date.now()) + "_s").set({ accion, actor: `socio:${L.clean(live?.nombre_norm || live?.nombre || "", 60)}`, at: now() }); } catch (_) {}
  }
  // Portal del cliente: el enlace es una credencial → se entrega solo por POST autenticado y queda auditado.
  app.post("/rev/entregas/:id/portal", revAuth, wrap(async (req, res) => {
    const r = await entregaDelSocio(req, req.params.id);
    if (r.error || r.e.estado !== "publicada" || !r.e.portalAutorizado || !r.e.portal?.clienteId) return fail(res, 404, "no_disponible");
    const c = await db.collection("clientes").doc(r.e.portal.clienteId).get();
    const found = c.exists ? servicioDeFicha(c.data() || {}, r.e.portal) : null;
    if (!found) return fail(res, 410, "servicio_reemplazado");
    const tok = tokenPortal(c.data() || {}, found.servicio);
    if (!tok) return fail(res, 409, "portal_sin_enlace");
    await auditarSocio(r.ref, r.live, "abrir_portal");
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, url: `${PORTAL_BASE()}/c/${encodeURIComponent(tok)}` });
  }));
  app.post("/rev/entregas/:id/codigo", revAuth, wrap(async (req, res) => {
    const r = await entregaDelSocio(req, req.params.id);
    if (r.error || r.e.estado !== "publicada" || !r.e.codigoAutorizado || !r.e.codigoCifrado) return fail(res, 404, "no_disponible");
    const k = llave(); if (!k) return fail(res, 503, "cifrado_no_configurado");
    await auditarSocio(r.ref, r.live, "ver_codigo");
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, codigo: L.descifrarCodigo(r.e.codigoCifrado, k) });
  }));

  // Campanita: novedades persistentes (entregas nuevas/actualizadas sin abrir + respuestas del equipo sin leer).
  app.get("/rev/novedades", revAuth, wrap(async (req, res) => {
    const { aliases } = await aliasesSocio(req);
    const [ents, cons] = await Promise.all([
      db.collection(COL.ent).where("socio_norm", "in", aliases.slice(0, 10)).get(),
      db.collection(COL.cons).where("socio_norm", "in", aliases.slice(0, 10)).get(),
    ]);
    const entregas = ents.docs.filter((x) => { const e = x.data() || {}; return e.estado === "publicada" && e.visibleSocio !== false; }).map((x) => L.entregaPublica(x.id, x.data() || {})).filter((e) => e.nueva);
    const consultas = cons.docs.map((x) => L.consultaPublica(x.id, x.data() || {}, { conMensajes: false })).filter((c) => c.noLeidas > 0);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, total: entregas.length + consultas.length,
      entregas: entregas.slice(0, 10).map((e) => ({ id: e.id, pedidoRef: e.pedidoRef, servicio: e.servicio, clienteNombre: e.clienteNombre, version: e.version })),
      consultas: consultas.slice(0, 10).map((c) => ({ id: c.id, numero: c.numero, asunto: c.asunto, noLeidas: c.noLeidas })) });
  }));

  /* ======================= TELEGRAM: VINCULAR / DESVINCULAR ======================= */
  let botUser = String(env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  async function botUsername() {
    if (botUser) return botUser;
    try { const me = await d.bot?.getMe?.(); botUser = String(me?.username || ""); } catch (_) {}
    return botUser;
  }
  app.get("/rev/telegram/estado", revAuth, wrap(async (req, res) => {
    const live = await revLiveProfile(req.rev, 0);
    const v = live.telegramVinculo || {};
    const conectado = !!chatSocio(live);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, conectado, metodo: conectado ? (v.metodo || "administracion") : "", desde: L.ms(v.desde) || null, incidencia: v.incidencia || "", desvinculadoAt: L.ms(v.desvinculadoAt) || null });
  }));
  app.post("/rev/telegram/vincular", revAuth, wrap(async (req, res) => {
    const live = await revLiveProfile(req.rev, 0);
    if (!live?.id) return fail(res, 404, "socio_no_encontrado");
    const reemplazar = req.body?.reemplazar === true;
    if (chatSocio(live) && !reemplazar) return fail(res, 409, "ya_vinculado");
    const user = await botUsername();
    if (!user) return fail(res, 503, "bot_sin_usuario");
    const { token, hash } = L.nuevoTokenVinculo();
    const expiraMs = Date.now() + TOKEN_MIN * 60000;
    await db.collection(COL.tok).doc(hash).set({ socioId: String(live.id), socio_norm: revNormKey(live.nombre_norm || live.nombre), expiraMs, reemplazar, usadoAt: null, createdAt: now() });
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, url: `https://t.me/${user}?start=${L.PREFIJO_START}${token}`, expiraMin: TOKEN_MIN });
  }));
  app.post("/rev/telegram/desvincular", revAuth, wrap(async (req, res) => {
    const live = await revLiveProfile(req.rev, 0);
    if (!live?.id) return fail(res, 404, "socio_no_encontrado");
    const prev = live.telegramVinculo || {};
    await db.collection("revendedores").doc(String(live.id)).set({ telegramId: "", telegramVinculo: { ...prev, estado: "desvinculado", desvinculadoAt: now(), anteriorTelegramId: String(live.telegramId || "") } }, { merge: true });
    d.invalidarSocio?.(live.id);
    res.json({ ok: true, conectado: false });
  }));

  /* ======================= BUZÓN DE DOS VÍAS ======================= */
  async function siguienteNumero(tx) {
    const ref = db.collection(COL.cont).doc("buzon_consultas");
    const s = await tx.get(ref);
    const n = Number((s.exists ? s.data() : {})?.n || 100) + 1;
    return { ref, n };
  }
  const { agregarMensaje, avisarEquipo } = crearBuzon({ db, getDestinoChatIds, now });

  app.get("/rev/consultas", revAuth, wrap(async (req, res) => {
    const { live, aliases } = await aliasesSocio(req);
    const [snap, legacy] = await Promise.all([
      db.collection(COL.cons).where("socio_norm", "in", aliases.slice(0, 10)).get(),
      db.collection("sugerencias").where("nombre_norm", "in", aliases.slice(0, 10)).get().catch(() => ({ docs: [] })),
    ]);
    const items = snap.docs.map((x) => L.consultaPublica(x.id, x.data() || {}));
    // Sugerencias anteriores: se conservan como hilos de solo lectura.
    legacy.docs.forEach((x) => { const s = x.data() || {}; if (s.consultaId) return; items.push({ id: `sug_${x.id}`, legacy: true, numero: "", asunto: s.pedidoRef ? `Pedido #${s.pedidoRef}` : "Sugerencia", estado: s.respuesta ? "resuelta" : "abierta", estadoLabel: s.respuesta ? "Respondida" : "Enviada", pedidoId: s.pedidoId || "", pedidoRef: s.pedidoRef || "", createdAt: L.ms(s.createdAt), updatedAt: L.ms(s.respondedAt || s.createdAt), noLeidas: 0,
      mensajes: [{ id: "m1", autor: "socio", nombre: live.nombre || "", texto: L.clean(s.texto, 3000), origen: "web", at: new Date(L.ms(s.createdAt) || 0).toISOString() }, ...(s.respuesta ? [{ id: "m2", autor: "equipo", nombre: s.destinoLabel || "Equipo", texto: L.clean(s.respuesta, 3000), origen: "web", at: new Date(L.ms(s.respondedAt) || 0).toISOString() }] : [])] }); });
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, items: items.slice(0, 100) });
  }));

  app.post("/rev/consultas", revAuth, wrap(async (req, res) => {
    const { live, aliases } = await aliasesSocio(req);
    if (live.capabilities && live.capabilities.buzon === false) return fail(res, 403, "sin_permiso_buzon");
    const b = req.body || {};
    const texto = L.clean(b.texto, 3000), asunto = L.clean(b.asunto, 120), opId = L.safeId(b.opId, 80);
    if (!texto) return fail(res, 400, "falta_texto");
    let destino = String(b.destino || "sublicuentas"), pedido = null;
    const pedidoId = L.clean(b.pedidoId, 120);
    if (pedidoId) {
      const ps = await db.collection("compras").doc(pedidoId).get();
      if (!ps.exists || !aliases.includes(revNormKey((ps.data() || {}).socio_norm || ""))) return fail(res, 403, "pedido_ajeno");
      pedido = { id: ps.id, ref: ps.id.slice(-6).toUpperCase() }; destino = (ps.data() || {}).destino || destino;
    }
    const entregaId = L.safeId(b.entregaId, 160);
    if (entregaId) { const r = await entregaDelSocio(req, entregaId); if (r.error) return fail(res, 403, "entrega_ajena"); }
    const info = destinoInfo(destino);
    const ref = opId ? db.collection(COL.cons).doc(`c_${L.hashToken(`${live.id}|${opId}`).slice(0, 32)}`) : db.collection(COL.cons).doc();
    const r = await db.runTransaction(async (tx) => {
      const ya = await tx.get(ref);
      if (ya.exists) return { dup: true, c: ya.data() || {} };
      const { ref: cref, n } = await siguienteNumero(tx);
      const m = L.nuevoMensaje({ autor: "socio", nombre: live.nombre || live.nombre_norm, texto, origen: "web", externalId: opId ? `op:${opId}` : "", at: now() });
      const c = { numero: L.numeroConsulta(n), asunto: asunto || (pedido ? `Pedido #${pedido.ref}` : "Consulta"), estado: "abierta", socio_norm: revNormKey(live.nombre_norm || live.nombre), socioId: String(live.id || ""), socioNombre: L.clean(live.nombre, 80),
        destino: info.key, destinoLabel: info.label, pedidoId: pedido?.id || "", pedidoRef: pedido?.ref || "", renglonId: L.clean(b.renglonId, 60), entregaId: entregaId || "",
        mensajes: [m], createdAt: now(), updatedAt: now(), ultimoAutor: "socio", noLeidasSocio: 0, noLeidasEquipo: 1, origen: "web" };
      tx.set(cref, { n }, { merge: true });
      await avisarEquipo(tx, ref.id, c, m);
      tx.set(ref, c);
      return { c };
    });
    res.json({ ok: true, duplicate: !!r.dup, consulta: L.consultaPublica(ref.id, r.c) });
  }));

  app.post("/rev/consultas/:id/mensajes", revAuth, wrap(async (req, res) => {
    const { live, aliases } = await aliasesSocio(req);
    const s = await db.collection(COL.cons).doc(L.safeId(req.params.id, 120)).get();
    if (!s.exists || !aliases.includes(revNormKey((s.data() || {}).socio_norm))) return fail(res, 404, "no_disponible");
    const texto = L.clean(req.body?.texto, 3000); if (!texto) return fail(res, 400, "falta_texto");
    const r = await agregarMensaje(s.id, { autor: "socio", nombre: live.nombre, texto, origen: "web", opId: L.safeId(req.body?.opId, 80) });
    res.json({ ok: true, duplicate: !!r.dup, consulta: L.consultaPublica(s.id, r.consulta) });
  }));
  app.post("/rev/consultas/:id/leida", revAuth, wrap(async (req, res) => {
    const { aliases } = await aliasesSocio(req);
    const s = await db.collection(COL.cons).doc(L.safeId(req.params.id, 120)).get();
    if (!s.exists || !aliases.includes(revNormKey((s.data() || {}).socio_norm))) return fail(res, 404, "no_disponible");
    await s.ref.set({ noLeidasSocio: 0, leidaSocioAt: now() }, { merge: true });
    res.json({ ok: true });
  }));

  // Administración del buzón (incluye notas internas que nunca salen al socio).
  app.get("/rev/admin/consultas", ...adminR, wrap(async (req, res) => {
    const snap = await db.collection(COL.cons).orderBy("updatedAt", "desc").limit(Math.min(200, Number(req.query.limit) || 100)).get();
    const estado = L.clean(req.query.estado, 30);
    const items = snap.docs.map((x) => ({ id: x.id, ...(x.data() || {}) }))
      .filter((c) => (isFullAdmin(req) || revNormKey(c.destino) === adminScopeProfile(req)) && (!estado || estado === "todas" || c.estado === estado))
      .map((c) => ({ id: c.id, numero: c.numero, asunto: c.asunto, estado: c.estado, estadoLabel: L.ESTADOS_CONSULTA[c.estado] || c.estado, socio: c.socioNombre || c.socio_norm, destino: c.destinoLabel,
        pedidoRef: c.pedidoRef || "", pedidoId: c.pedidoId || "", entregaId: c.entregaId || "", updatedAt: L.ms(c.updatedAt), noLeidasEquipo: Number(c.noLeidasEquipo || 0),
        mensajes: (c.mensajes || []).map((m) => ({ id: m.id, autor: m.autor, nombre: m.actor || m.nombre, texto: m.texto, origen: m.origen, interna: !!m.interna, at: m.at })) }));
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, items });
  }));
  app.post("/rev/admin/consultas/:id/mensajes", ...adminW, wrap(async (req, res) => {
    const s = await db.collection(COL.cons).doc(L.safeId(req.params.id, 120)).get();
    if (!s.exists) return fail(res, 404, "no_existe");
    const c = s.data() || {};
    if (!isFullAdmin(req) && revNormKey(c.destino) !== adminScopeProfile(req)) return fail(res, 403, "fuera_de_ambito");
    const texto = L.clean(req.body?.texto, 3000); if (!texto) return fail(res, 400, "falta_texto");
    const socio = await socioPorNorm(c.socio_norm);
    const actor = actorDe(req);
    const r = await agregarMensaje(s.id, { autor: "equipo", nombre: String(c.destinoLabel || "").replace(/^[^\p{L}]+/u, "") || "Equipo", actor: actorTxt(actor), texto, origen: "web", interna: req.body?.interna === true, opId: L.safeId(req.body?.opId, 80), socioChat: chatSocio(socio) });
    await db.collection(COL.cons).doc(s.id).set({ noLeidasEquipo: 0 }, { merge: true });
    res.json({ ok: true, duplicate: !!r.dup, telegram: chatSocio(socio) ? "encolado" : "sin_vinculo" });
  }));
  app.patch("/rev/admin/consultas/:id/estado", ...adminW, wrap(async (req, res) => {
    const estado = String(req.body?.estado || "");
    if (!L.ESTADOS_CONSULTA[estado]) return fail(res, 400, "estado_invalido");
    const ref = db.collection(COL.cons).doc(L.safeId(req.params.id, 120));
    const s = await ref.get(); if (!s.exists) return fail(res, 404, "no_existe");
    if (!isFullAdmin(req) && revNormKey((s.data() || {}).destino) !== adminScopeProfile(req)) return fail(res, 403, "fuera_de_ambito");
    await ref.set({ estado, updatedAt: now(), noLeidasEquipo: 0 }, { merge: true });
    res.json({ ok: true, estado });
  }));

  /* ======================= HISTORIAL ANTERIOR (simular → importar en silencio → habilitar / revertir) ======================= */
  async function datosHistorico() {
    const [compras, revs, ents] = await Promise.all([db.collection("compras").where("estado", "==", "entregado").get(), db.collection("revendedores").get(), db.collection(COL.ent).get()]);
    const sociosVerificados = new Set();
    revs.docs.forEach((x) => { const r = x.data() || {}; if (r.activo === false) return; const n = revNormKey(r.nombre_norm || r.nombre); if (n) sociosVerificados.add(n); if (n === "geisell") sociosVerificados.add("geissel"); });
    const yaImportados = new Set(), entregasActuales = new Set();
    ents.docs.forEach((x) => (x.id.startsWith("enth_") ? yaImportados : entregasActuales).add(x.id));
    return { compras: compras.docs.map((x) => ({ id: x.id, ...(x.data() || {}) })), sociosVerificados, yaImportados, entregasActuales };
  }
  app.get("/rev/admin/entregas/historico/simular", revAdminAuth, adminAnyPermission(["*"]), wrap(async (req, res) => {
    const datos = await datosHistorico();
    const r = L.clasificarHistorico(datos);
    const porSocio = {};
    r.detalle.vinculables.forEach((x) => { porSocio[x.socio_norm] = (porSocio[x.socio_norm] || 0) + 1; });
    const muestra = (arr) => arr.slice(0, 15).map((x) => ({ ref: x.ref, socio: x.socio_norm, cliente: x.cliente, servicios: x.servicios.slice(0, 4), fecha: x.fechaEntrega || "Sin fecha confirmada", motivo: x.motivo || "", historicoAnterior: !!x.historicoAnterior }));
    res.json({ ok: true, simulacion: true, encontradas: r.encontradas, vinculables: r.vinculables, duplicadas: r.duplicadas, incompletas: r.incompletas, sinSocio: r.sinSocio, ambiguas: r.ambiguas, sinFecha: r.sinFecha, porSocio,
      muestras: { vinculables: muestra(r.detalle.vinculables), incompletas: muestra(r.detalle.incompletas), revision: muestra([...r.detalle.ambiguas, ...r.detalle.sinSocio]) } });
  }));
  app.post("/rev/admin/entregas/historico/importar", revAdminAuth, adminAnyPermission(["*"]), wrap(async (req, res) => {
    if (req.body?.confirmar !== true) return fail(res, 400, "falta_confirmar");
    const soloSocios = Array.isArray(req.body?.socios) ? req.body.socios.map(revNormKey).filter(Boolean) : [];
    const datos = await datosHistorico();
    const r = L.clasificarHistorico(datos);
    const loteId = `lote_${Date.now().toString(36)}`;
    const t = now(), actor = actorTxt(actorDe(req));
    const elegidas = [...r.detalle.vinculables.map((x) => ({ ...x, incompleto: false })), ...r.detalle.incompletas.map((x) => ({ ...x, incompleto: true }))]
      .filter((x) => !soloSocios.length || soloSocios.includes(x.socio_norm));
    const compraMap = new Map(datos.compras.map((c) => [c.id, c]));
    const escrituras = [];
    for (const x of elegidas) {
      const c = compraMap.get(x.compraId) || {};
      const productos = Array.isArray(c.productos) && c.productos.length ? c.productos : [{ renglonId: "r1", servicio: c.servicio }];
      productos.forEach((p, i) => {
        const rid = p.renglonId || `r${i + 1}`, id = L.entregaHistoricaId("compras", c.id, rid);
        if (datos.yaImportados.has(id) || datos.entregasActuales.has(L.entregaId(c.id, rid))) return;
        escrituras.push([id, {
          compraId: c.id, renglonId: rid, pedidoRef: String(c.id).slice(-6).toUpperCase(), socio_norm: x.socio_norm, servicio: L.clean(p.servicio || c.servicio, 140),
          clienteNombre: L.clean(p.clienteNombre || p.nombreCliente || x.cliente, 120), modalidad: L.clean(p.modalidad || p.entregaTipo, 40),
          estado: "publicada", version: 1, historico: true, historicoIncompleto: x.incompleto, historicoAnterior: !!x.historicoAnterior,
          fechaOriginal: x.fechaEntrega ? new Date(x.fechaEntrega) : null, importadaAt: t, importe: null, // nunca inventar importes
          notificar: false, contabilizar: false, visibleSocio: false, visto: { version: 1, primeraAt: null }, // no cuenta como novedad
          origen: { sistema: "compras", id: c.id, loteId }, portal: null, portalAutorizado: false, codigoCifrado: null, codigoAutorizado: false, avisos: [], opIds: [], createdAt: t, updatedAt: t,
        }]);
      });
    }
    for (let i = 0; i < escrituras.length; i += 400) {
      const batch = db.batch();
      escrituras.slice(i, i + 400).forEach(([id, doc]) => batch.set(db.collection(COL.ent).doc(id), doc));
      await batch.commit();
    }
    await db.collection(COL.lotes).doc(loteId).set({ loteId, creadoPor: actor, createdAt: t, socios: soloSocios, total: escrituras.length, ids: escrituras.map((x) => x[0]).slice(0, 5000), habilitado: false, revertido: false,
      resumen: { encontradas: r.encontradas, vinculables: r.vinculables, incompletas: r.incompletas, revision: r.ambiguas + r.sinSocio, duplicadas: r.duplicadas } });
    res.json({ ok: true, loteId, importadas: escrituras.length, visibles: false, siguiente: "Revise la muestra y use “Habilitar lote” para mostrarlas a los socios." });
  }));
  app.post("/rev/admin/entregas/historico/:loteId/:accion", revAdminAuth, adminAnyPermission(["*"]), wrap(async (req, res) => {
    const accion = req.params.accion;
    if (!["habilitar", "revertir"].includes(accion)) return fail(res, 400, "accion_invalida");
    const ref = db.collection(COL.lotes).doc(L.safeId(req.params.loteId, 60));
    const s = await ref.get(); if (!s.exists) return fail(res, 404, "no_existe");
    const lote = s.data() || {};
    if (lote.revertido) return fail(res, 409, "lote_revertido");
    const ids = Array.isArray(lote.ids) ? lote.ids : [];
    for (let i = 0; i < ids.length; i += 400) {
      const batch = db.batch();
      // Revertir solo borra lo que creó este lote (enth_*); la fuente original no se toca.
      ids.slice(i, i + 400).forEach((id) => accion === "habilitar" ? batch.set(db.collection(COL.ent).doc(id), { visibleSocio: true }, { merge: true }) : batch.delete(db.collection(COL.ent).doc(id)));
      await batch.commit();
    }
    await ref.set(accion === "habilitar" ? { habilitado: true, habilitadoAt: now(), habilitadoPor: actorTxt(actorDe(req)) } : { revertido: true, revertidoAt: now(), revertidoPor: actorTxt(actorDe(req)) }, { merge: true });
    res.json({ ok: true, loteId: s.id, accion, afectadas: ids.length });
  }));
  app.get("/rev/admin/entregas/historico/lotes", revAdminAuth, adminAnyPermission(["*"]), wrap(async (req, res) => {
    const s = await db.collection(COL.lotes).orderBy("createdAt", "desc").limit(20).get();
    res.json({ ok: true, items: s.docs.map((x) => { const l = x.data() || {}; return { loteId: x.id, total: l.total, socios: l.socios || [], habilitado: !!l.habilitado, revertido: !!l.revertido, creadoPor: l.creadoPor, createdAt: L.ms(l.createdAt), resumen: l.resumen || {} }; }) });
  }));

  return { agregarMensaje };
}

module.exports = { registrar, COL };
