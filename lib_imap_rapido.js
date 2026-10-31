"use strict";
/* ============================================================================================================
   R159 · LECTOR IMAP RÁPIDO para códigos de plataformas (31/10/2026)
   MISMO TEXTO en el bot (sublicuentas-tg-bot/lib_imap_rapido.js) y en Sublichat HQ (api/_imap-rapido.js).
   No editar uno sin el otro.

   Antes, cada consulta: conectaba y hacía login al hosting, leía los encabezados de los últimos 200 correos y
   DESCARGABA UNO POR UNO el correo completo de cada candidato hasta juntar 15 de esa cuenta (en un buzón
   catch-all eran decenas de descargas en serie) → 10-40 s.
   Ahora:
     1) Conexión reutilizada por buzón (sin login en cada consulta). En el bot queda escuchando con IDLE:
        cuando entra un correo de una plataforma se lee y se guarda en memoria al instante, así la consulta
        responde con lo que ya está leído.
     2) Encabezados incrementales: solo se piden los correos NUEVOS (UID mayor al último visto).
     3) Se descargan primero los correos dirigidos a esa cuenta (To/Cc/Delivered-To/X-Original-To/Envelope-To),
        TODOS EN UNA SOLA PETICIÓN, y se procesan en paralelo. Solo si no hay ninguno dirigido se revisan los
        demás (el correo puede venir solo en el cuerpo), por lotes y con tiempo límite.
   Lo leído vive solo en memoria del proceso (no se guarda en base de datos ni en disco) y se descarta a los 3 días.
   ============================================================================================================ */

const HDRS = ["delivered-to", "x-original-to", "envelope-to", "x-forwarded-to"];

function plataformaConocida(fromStr = "", subjStr = "") {
  const f = String(fromStr).toLowerCase(), s = String(subjStr).toLowerCase();
  return f.includes("netflix") || f.includes("disney") || f.includes("hbo") || f.includes("max.com") ||
    f.includes("amazon") || f.includes("primevideo") || f.includes("paramount") || f.includes("vix") ||
    f.includes("universal") || f.includes("spotify") || f.includes("crunchyroll") ||
    s.includes("netflix") || s.includes("disney") || s.includes("spotify") || s.includes("hbo") || s.includes("amazon") ||
    s.includes("código") || s.includes("codigo") || s.includes("verifica") || s.includes("acceso") ||
    s.includes("contrase") || s.includes("restablec") || s.includes("hogar") || s.includes("household");
}
const ordenReciente = (a, b) => (b.ts || 0) - (a.ts || 0) || (b.uid || 0) - (a.uid || 0);

function crearLector({ ImapFlow, simpleParser, log = console, diasAtras = 3, ventana = 200, maxEnvelopes = 800, maxCuerpos = 300,
  ociosoMs = 10 * 60 * 1000, escuchar = false } = {}) {
  const pools = new Map();
  const clave = (c) => `${String(c.host || "").toLowerCase()}|${String(c.user || "").toLowerCase()}`;
  const limiteTs = () => Date.now() - diasAtras * 86400000;

  function estado(cuenta) {
    const k = clave(cuenta);
    let p = pools.get(k);
    if (!p) { p = { k, cuenta, client: null, conectando: null, cola: Promise.resolve(), env: new Map(), cuerpos: new Map(), maxUid: 0, uidValidity: "", ocioso: null, reintento: 0, reconectar: null }; pools.set(k, p); }
    p.cuenta = cuenta;
    return p;
  }
  function enCola(p, fn) { const r = p.cola.then(fn, fn); p.cola = r.catch(() => {}); return r; }
  function cerrar(p) {
    const c = p.client; p.client = null;
    if (c) { try { c.close(); } catch (_) {} }
  }
  function programarOcio(p) {
    if (escuchar) return;
    if (p.ocioso) clearTimeout(p.ocioso);
    p.ocioso = setTimeout(() => { enCola(p, async () => { if (p.client) { try { await p.client.logout(); } catch (_) {} p.client = null; } }); }, ociosoMs);
    if (p.ocioso.unref) p.ocioso.unref();
  }
  function programarReconexion(p) {
    if (!escuchar || p.reconectar) return;
    const espera = Math.min(60000, 3000 * Math.pow(2, Math.min(5, p.reintento++)));
    p.reconectar = setTimeout(() => { p.reconectar = null; escucharCuenta(p.cuenta).catch(() => {}); }, espera);
    if (p.reconectar.unref) p.reconectar.unref();
  }

  async function conectar(p) {
    if (p.client && p.client.usable) return p.client;
    if (p.conectando) return p.conectando;
    p.conectando = (async () => {
      const c = p.cuenta;
      const client = new ImapFlow({
        host: String(c.host), port: Number(c.port || 993), secure: c.tls !== false,
        auth: { user: String(c.user), pass: String(c.password || c.pass || "") },
        logger: false, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 5 * 60 * 1000,
        maxIdleTime: 4 * 60 * 1000, tls: { rejectUnauthorized: false },
      });
      client.on("error", (e) => { try { log.warn("[IMAP rápido] error", c.name || c.user, e?.message || e); } catch (_) {} });
      client.on("close", () => { if (p.client === client) p.client = null; programarReconexion(p); });
      client.on("exists", () => { if (escuchar) enCola(p, () => refrescar(p, client, true)).catch(() => {}); });
      await client.connect();
      await client.mailboxOpen("INBOX");
      const uv = String(client.mailbox?.uidValidity || "");
      if (p.uidValidity && uv && p.uidValidity !== uv) { p.env.clear(); p.cuerpos.clear(); p.maxUid = 0; }
      p.uidValidity = uv;
      p.client = client; p.reintento = 0;
      return client;
    })();
    try { return await p.conectando; } finally { p.conectando = null; }
  }

  // Encabezados nuevos (incremental por UID). Con `precargar`, también descarga los cuerpos de los nuevos.
  async function refrescar(p, client, precargar = false) {
    if (!client || !client.usable) return;
    const tope = limiteTs(), desde = p.maxUid, nuevos = [];
    let rango, opts;
    if (!desde) { const total = client.mailbox?.exists || 0; if (!total) return; rango = `${Math.max(1, total - ventana + 1)}:${total}`; opts = {}; }
    else { rango = `${desde + 1}:*`; opts = { uid: true }; }
    for await (const msg of client.fetch(rango, { envelope: true, internalDate: true, uid: true, headers: HDRS }, opts)) {
      const uid = Number(msg.uid || 0);
      if (!uid || (desde && uid <= desde)) continue; // "N:*" devuelve el último aunque no haya nuevos
      if (uid > p.maxUid) p.maxUid = uid;
      const ts = msg.internalDate ? new Date(msg.internalDate).getTime() : 0;
      if (ts && ts < tope) continue;
      const fromStr = String(msg.envelope?.from?.[0]?.address || msg.envelope?.from?.[0]?.name || "");
      const subj = String(msg.envelope?.subject || "");
      if (!plataformaConocida(fromStr, subj)) continue;
      const dest = [...(msg.envelope?.to || []), ...(msg.envelope?.cc || []), ...(msg.envelope?.bcc || [])].map((a) => String(a?.address || "")).join(" ");
      const hdr = msg.headers ? (Buffer.isBuffer(msg.headers) ? msg.headers.toString("utf8") : String(msg.headers)) : "";
      const item = { uid, ts, dest: `${dest} ${hdr}`.toLowerCase() };
      p.env.set(uid, item); nuevos.push(item);
    }
    for (const [uid, x] of p.env) if (x.ts && x.ts < tope) { p.env.delete(uid); p.cuerpos.delete(uid); }
    if (p.env.size > maxEnvelopes) [...p.env.values()].sort(ordenReciente).slice(maxEnvelopes).forEach((x) => { p.env.delete(x.uid); p.cuerpos.delete(x.uid); });
    if (precargar && nuevos.length) await cargarCuerpos(p, client, nuevos.map((x) => x.uid));
  }

  // Descarga en UNA petición los cuerpos que falten y los procesa en paralelo.
  async function cargarCuerpos(p, client, uids) {
    const faltan = uids.filter((u) => !p.cuerpos.has(u));
    if (!faltan.length) return;
    const fuentes = [];
    for await (const msg of client.fetch(faltan.join(","), { source: true, uid: true }, { uid: true })) {
      if (msg?.source) fuentes.push({ uid: Number(msg.uid || 0), source: msg.source });
    }
    await Promise.all(fuentes.map(async ({ uid, source }) => {
      try {
        const m = await simpleParser(source);
        const raw = Buffer.isBuffer(source) ? source.toString("utf8") : String(source || "");
        const rawHeaders = raw.split(/\r?\n\r?\n/, 1)[0];
        const cuerpo = {
          from: String(m.from?.text || ""), subject: String(m.subject || ""), text: String(m.text || ""), html: String(m.html || ""),
          fecha: m.date || null,
        };
        cuerpo.busq = `${cuerpo.text} ${cuerpo.html} ${cuerpo.subject} ${String(m.to?.text || "")} ${rawHeaders}`.toLowerCase();
        p.cuerpos.set(uid, cuerpo);
      } catch (_) {}
    }));
    if (p.cuerpos.size > maxCuerpos) {
      const orden = [...p.cuerpos.keys()].map((u) => p.env.get(u) || { uid: u, ts: 0 }).sort(ordenReciente);
      orden.slice(maxCuerpos).forEach((x) => p.cuerpos.delete(x.uid));
    }
  }

  function aEmail(p, x, b) {
    return {
      from: b.from, subject: b.subject, text: b.text, html: b.html,
      date: x.ts > 0 ? new Date(x.ts) : (b.fecha || new Date(0)), ts: x.ts || 0, uid: x.uid || 0, seq: 0,
      mailbox: String(p.cuenta.name || p.cuenta.label || p.cuenta.user || "hosting"),
    };
  }

  // Correos de una cuenta de streaming (`correo`) en un buzón del hosting. Más reciente primero.
  async function buscar(cuenta, correo, limite = 15, { deadline = Date.now() + 25000 } = {}) {
    const p = estado(cuenta);
    const c = String(correo || "").trim().toLowerCase();
    return enCola(p, async () => {
      for (let intento = 0; intento < 2; intento++) {
        try {
          const client = await conectar(p);
          const lock = await client.getMailboxLock("INBOX");
          try {
            await refrescar(p, client, false);
            const todos = [...p.env.values()].sort(ordenReciente);
            const directos = todos.filter((x) => x.dest.includes(c));
            const lista = directos.length ? directos : todos;
            const out = [];
            const paso = directos.length ? Math.max(1, limite) : 12;
            for (let i = 0; i < lista.length && out.length < limite; i += paso) {
              if (Date.now() > deadline) { try { log.warn("[IMAP rápido] tiempo límite: se devuelve lo encontrado", out.length); } catch (_) {} break; }
              const lote = lista.slice(i, i + paso);
              await cargarCuerpos(p, client, lote.map((x) => x.uid));
              for (const x of lote) {
                const b = p.cuerpos.get(x.uid);
                if (!b || !b.busq.includes(c)) continue;
                out.push(aEmail(p, x, b));
                if (out.length >= limite) break;
              }
            }
            return out.sort(ordenReciente);
          } finally { lock.release(); programarOcio(p); }
        } catch (e) {
          cerrar(p);
          if (intento) throw e;
        }
      }
      return [];
    });
  }

  // Bot (proceso que vive siempre): deja el buzón abierto en IDLE y precarga los correos que van entrando.
  async function escucharCuenta(cuenta) {
    if (!escuchar) return;
    const p = estado(cuenta);
    try {
      await enCola(p, async () => { const client = await conectar(p); const lock = await client.getMailboxLock("INBOX"); try { await refrescar(p, client, true); } finally { lock.release(); } });
    } catch (e) {
      try { log.warn("[IMAP rápido] no se pudo dejar escuchando", cuenta.name || cuenta.user, e?.message || e); } catch (_) {}
      cerrar(p); programarReconexion(p);
    }
  }

  function estadoPublico() {
    return [...pools.values()].map((p) => ({ buzon: p.cuenta.name || p.cuenta.label || "hosting", conectado: !!(p.client && p.client.usable), correosEnMemoria: p.cuerpos.size, encabezados: p.env.size }));
  }

  return { buscar, escucharCuenta, estado: estadoPublico, _pools: pools };
}

module.exports = { crearLector, plataformaConocida };
