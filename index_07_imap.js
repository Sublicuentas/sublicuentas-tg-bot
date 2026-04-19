/* ✅ SUBLICUENTAS TG BOT — PARTE 7/7 v10
   IMAP — EXTRACTOR DE CÓDIGOS NETFLIX / DISNEY / HBO / PRIME VIDEO
   ----------------------------------------------------------------
   ✅ CAMBIOS v10:
   - FIX Disney: ahora busca también en HTML (el código venía en HTML, no en text)
   - FIX Disney: regex específico para extraer el código del bloque HTML
   - NUEVO: esHBO() — detecta emails de HBO Max / Max
   - NUEVO: cmdLink ahora también saca link de reset de HBO (cambio de correo)
   - NUEVO: esPrime() — detecta emails de Amazon Prime Video
   - NUEVO: /prime correo — extrae código OTP de 6 dígitos de Prime Video
*/

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const { bot } = require("./index_01_core");
const { isAdmin, logErr, escMD } = require("./index_02_utils_roles");

const IMAP_HOST = process.env.IMAP_HOST_1 || process.env.EMAIL_IMAP_HOST || "premium48.web-hosting.com";
const IMAP_PORT = Number(process.env.EMAIL_IMAP_PORT || 993);
const IMAP_USER = process.env.EMAIL_ADMIN_USER || "admin@sublicuentas.com";
const IMAP_PASS = process.env.EMAIL_ADMIN_PASS || "";

// ===============================
// HELPERS BASE
// ===============================
function normalizarCorreo(c = "") { return String(c||"").trim().toLowerCase(); }

function formatearFecha(date) {
  try { return new Date(date).toLocaleString("es-HN",{timeZone:"America/Tegucigalpa",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
  catch(_){ return String(date||""); }
}

// ===============================
// DETECTORES DE PLATAFORMA
// ===============================
// Netflix en general
function esNetflix(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("netflix") || s.includes("netflix");
}

// Netflix OTP/codigo: verificacion, seguridad, hogar — excluye resets
// Netflix con código DIRECTO en el email (Disney-style, 6 digitos visibles)
function esNetflixCodigo(from="",subject=""){
  if(!esNetflix(from,subject)) return false;
  const s=subject.toLowerCase();
  if(s.includes("restablecimiento")||s.includes("reset")||s.includes("password")||
     s.includes("contrase")||s.includes("cambio")||s.includes("actualiza")) return false;
  // Estos asuntos tienen código directo en el texto
  return s.includes("verificaci")||s.includes("seguridad")||
         s.includes("confirmaci")||s.includes("hogar")||s.includes("household")||
         s.includes("inicio de sesi");
}

// Netflix con link "Obtener código" — el código está detrás del link, no en el email
function esNetflixLinkCodigo(from="",subject=""){
  if(!esNetflix(from,subject)) return false;
  const s=subject.toLowerCase();
  if(s.includes("restablecimiento")||s.includes("reset")||s.includes("password")||
     s.includes("contrase")||s.includes("cambio")||s.includes("actualiza")) return false;
  return s.includes("acceso temporal")||s.includes("codigo de acceso")||
         s.includes("código de acceso")||s.includes("temporal")||s.includes("codigo");
}

// Netflix reset de contrasena/correo -> para /link
function esNetflixReset(from="",subject=""){
  if(!esNetflix(from,subject)) return false;
  const s=subject.toLowerCase();
  return s.includes("restablecimiento")||s.includes("reset")||s.includes("password")||
         s.includes("contrase")||s.includes("cambio")||s.includes("actualiza");
}

function esDisney(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("disney")||s.includes("disneyplus")||s.includes("disney plus")||s.includes("disney+");
}

function esHBO(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("hbo")||f.includes("max.com")||f.includes("hbomax")||
         s.includes("hbo")||s.includes("hbo max")||s.includes("max ")||
         s.includes("actualiza")||s.includes("verifica")||s.includes("cambio")||
         s.includes("update")||s.includes("reset")||s.includes("acceso");
}

function esPrime(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("amazon")||f.includes("primevideo")||f.includes("prime")||
         s.includes("amazon")||s.includes("prime video")||s.includes("primevideo")||
         s.includes("amazon prime")||s.includes("código de")||s.includes("otp")||
         s.includes("one-time")||s.includes("verificacion")||s.includes("iniciar sesion");
}

function esParamount(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("paramount")||f.includes("cbs.com")||f.includes("viacom")||
         s.includes("paramount")||s.includes("paramount+");
}

function esHogar(subject="",text=""){
  const s=subject.toLowerCase(); const t=text.toLowerCase();
  return s.includes("hogar")||s.includes("household")||s.includes("extra member")||t.includes("netflix hogar");
}

// ===============================
// EXTRACCIÓN DE CÓDIGOS
// ===============================

/**
 * Extrae código numérico de 6 (o 4) dígitos del texto/asunto.
 * Para Disney busca también en HTML directamente.
 */
function extraerCodigoInteligente(text = "", subject = "", html = "") {
  const basuraAnios = new Set(["2024", "2025", "2026", "2027"]);

  // Limpia un candidato y valida
  function esValido(c = "") {
    const s = c.replace(/\s/g, "");
    return /^\d{4,6}$/.test(s) && !basuraAnios.has(s) ? s : null;
  }

  // ── 1. Disney: dígitos con un espacio entre cada uno (0 5 6 6 6 5) ──
  // Patrón: exactamente 6 dígitos separados por un espacio cada uno
  const disneyEsp6 = (subject + " " + text + " " + html.replace(/<[^>]+>/g, " "))
    .match(/\b(\d)\s(\d)\s(\d)\s(\d)\s(\d)\s(\d)\b/g);
  if (disneyEsp6) {
    for (const m of disneyEsp6) {
      const v = esValido(m.replace(/\s/g, ""));
      if (v) return v;
    }
  }

  // ── 2. Búsqueda en texto plano + asunto ──────────────────────────────
  const fuente = (subject + " " + text).replace(/\s+/g, " ");

  // 6 dígitos juntos (con o sin leading zero — usar \d{6} sin \b al inicio)
  const match6 = fuente.match(/(?<!\d)(\d{6})(?!\d)/g);
  if (match6) {
    for (const c of match6) { const v = esValido(c); if (v) return v; }
  }

  // 6 dígitos con espacio al medio tipo Netflix (123 456)
  const match6Mid = fuente.match(/(?<!\d)(\d{3})\s(\d{3})(?!\d)/g);
  if (match6Mid) {
    for (const m of match6Mid) { const v = esValido(m); if (v) return v; }
  }

  // 4 dígitos
  const match4 = fuente.match(/(?<!\d)(\d{4})(?!\d)/g);
  if (match4) {
    for (const c of match4) { const v = esValido(c); if (v) return v; }
  }

  // ── 3. Búsqueda en HTML (Disney, Prime y otros) ──────────────────────
  if (html) {
    // Quitar tags para buscar en texto visible del HTML
    const htmlTexto = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    // Disney con espacios entre dígitos en texto del HTML
    const htmlEsp6 = htmlTexto.match(/\b(\d)\s(\d)\s(\d)\s(\d)\s(\d)\s(\d)\b/g);
    if (htmlEsp6) {
      for (const m of htmlEsp6) { const v = esValido(m); if (v) return v; }
    }

    // 6 dígitos directos en texto HTML
    const htmlMatch6 = htmlTexto.match(/(?<!\d)(\d{6})(?!\d)/g);
    if (htmlMatch6) {
      for (const c of htmlMatch6) { const v = esValido(c); if (v) return v; }
    }

    // 6 dígitos entre tags HTML (>056665<)
    const tagMatch6 = html.replace(/\s+/g, " ").match(/>\s*(\d[\s\d]{4,10}\d)\s*</g);
    if (tagMatch6) {
      for (const bloque of tagMatch6) {
        const num = bloque.replace(/[^\d]/g, "");
        if (num.length === 6 && !basuraAnios.has(num)) return num;
        if (num.length === 4 && !basuraAnios.has(num)) return num; // fallback 4
      }
    }

    // font-size grande (código resaltado)
    const fontMatch = html.replace(/\s+/g, " ").match(/font-size\s*:\s*\d+px[^>]*>([\d\s]{6,13})</i);
    if (fontMatch && fontMatch[1]) {
      const v = esValido(fontMatch[1]);
      if (v) return v;
    }
  }

  return null;
}

// Links de reset de contraseña/correo
function extraerLink(text="", html="") {
  // Buscar primero en HTML (tiene los links reales), luego en text
  const fuentes = [html, text].filter(Boolean);
  const pats = [
    // Netflix password/reset
    /https:\/\/www\.netflix\.com\/password[^\s"<>\]&]+(?:&amp;|&)[^\s"<>\]]*/i,
    /https:\/\/www\.netflix\.com\/password[^\s"<>\]]+/i,
    /https:\/\/www\.netflix\.com\/[^\s"<>\]]*reset[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*netflix[^\s"<>\]]*password[^\s"<>\]]*/i,
    // Disney
    /https:\/\/[^\s"<>\]]*disneyplus[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*disney[^\s"<>\]]*account[^\s"<>\]]*/i,
    // HBO Max / Max
    /https:\/\/[^\s"<>\]]*hbomax[^\s"<>\]]*(?:reset|password|account|verify)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*max\.com[^\s"<>\]]*(?:reset|password|account|verify|email)[^\s"<>\]]*/i,
    // Paramount+
    /https:\/\/[^\s"<>\]]*paramount[^\s"<>\]]*(?:reset|password|account|verify|login|signin)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*cbsinteractive[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*viacomcbs[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
  ];
  for (const f of fuentes) {
    for (const p of pats) {
      const m = f.match(p);
      if (m?.[0]) {
        // Decodificar &amp; y limpiar comillas/espacios que puedan haber quedado
        let url = m[0].replace(/&amp;/g,"&").replace(/["\s>]+$/,"").trim();
        // Decodificar %XX si es necesario (URLs que vienen encoded en el HTML)
        try { url = decodeURIComponent(url.replace(/\+/g," ")); } catch(_) {}
        return url;
      }
    }
  }
  return null;
}

// Link especial de Netflix para obtener código vía web
function extraerLinkObtenerCodigo(html="") {
  const pat = /https:\/\/[^"'>]+netflix\.com[^"'>]*(?:travel|verify|temporary|update|account\/travel)[^"'>]*/i;
  const m = html.match(pat);
  if(m) return m[0].replace(/&amp;/g, "&").trim();
  return null;
}

async function scrapearCodigoWeb(url) {
  try {
    if(typeof fetch !== "undefined") {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      const html = await res.text();
      const m1 = html.match(/>\s*([0-9]{4,6})\s*</);
      if (m1 && m1[1]) return m1[1];
    }
  } catch(e) {}
  return null;
}

// ===============================
// LECTURA IMAP
// ===============================
async function buscarEmails(correo, limite=15) {
  // Todos los emails llegan al inbox del hosting (admin@sublicuentas.com).
  // No filtramos por to: porque el destinatario es el hosting, no el cliente.
  // En cambio: traemos los ultimos N emails recientes y filtramos los que
  // mencionan el correo del cliente en el body, html, subject o headers.
  const correoBuscar = String(correo||"").trim().toLowerCase();

  const client = new ImapFlow({
    host:IMAP_HOST, port:IMAP_PORT, secure:true,
    auth:{user:IMAP_USER, pass:IMAP_PASS},
    logger:false, tls:{rejectUnauthorized:false},
  });
  await client.connect();
  const emails=[];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const desde=new Date(); desde.setDate(desde.getDate()-2); // ultimos 2 dias
      // Intentar buscar por body text (mas preciso). Si falla, traer todos recientes.
      let uids = [];
      try {
        uids = await client.search({body: correoBuscar, since: desde});
      } catch(_) {}
      // Fallback: si no encontro nada por body, buscar todos los recientes
      if(!uids || !uids.length) {
        uids = await client.search({since: desde});
      }
      if(!uids || !uids.length) return [];

      // Tomar los ultimos (mas recientes)
      const ids = uids.slice(-Math.min(uids.length, 50));

      for await(const msg of client.fetch(ids, {source:true})){
        try{
          const p = await simpleParser(msg.source);
          const bodyText = String(p.text||"").toLowerCase();
          const bodyHtml = String(p.html||"").toLowerCase();
          const subj     = String(p.subject||"").toLowerCase();
          const toAddr   = (p.to?.text||"").toLowerCase();
          const allText  = bodyText + " " + bodyHtml + " " + subj + " " + toAddr;

          // Solo incluir si menciona el correo del cliente en algun campo
          if(!allText.includes(correoBuscar)) continue;

          emails.push({
            from:    String(p.from?.text||""),
            subject: String(p.subject||""),
            text:    String(p.text||""),
            html:    String(p.html||""),
            date:    p.date||new Date(),
          });

          if(emails.length >= limite) break;
        }catch(_){}
      }
    } finally { lock.release(); }
  } finally { await client.logout(); }

  // Ordenar de mas reciente a mas antiguo
  return emails.sort((a,b) => new Date(b.date) - new Date(a.date));
}

// ===============================
// COMANDOS
// ===============================

/** /code — Netflix o Disney+ */
async function cmdCode(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /code correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      const isN      = esNetflixCodigo(e.from, e.subject);
      const isNLink  = esNetflixLinkCodigo(e.from, e.subject);
      const isD      = esDisney(e.from, e.subject);
      if(!isN && !isNLink && !isD) continue;

      // Emails de "acceso temporal" de Netflix: el código está detrás de un link
      // NO intentar extraer número — mandar el link directamente
      if(isNLink && !isN) {
        const linkWeb = extraerLinkObtenerCodigo(e.html);
        if(linkWeb) {
          return bot.sendMessage(chatId,
            `🎬 *CÓDIGO NETFLIX — ACCESO TEMPORAL*\n\n` +
            `📧 *Correo:* ${escMD(correo)}\n` +
            `📨 *Asunto:* ${escMD(e.subject)}\n` +
            `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\n` +
            `⚠️ El código se genera al abrir el link. Toca el botón:`,
            {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"🔑 Obtener código Netflix", url:linkWeb}]]}}
          );
        }
        // Si no hay link tampoco, ignorar este email y seguir buscando
        continue;
      }

      // Emails con código directo (verificación, seguridad, Disney)
      const codigo = extraerCodigoInteligente(e.text, e.subject, e.html);

      if(codigo) {
        return bot.sendMessage(chatId,
          `${isN?"🎬":"🏰"} *CÓDIGO ${isN?"NETFLIX":"DISNEY+"}*\n\n` +
          `📧 *Correo:* ${escMD(correo)}\n` +
          `🔑 *Código:* \`${codigo}\`\n` +
          `📨 *Asunto:* ${escMD(e.subject)}\n` +
          `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,
          {parse_mode:"Markdown"}
        );
      }
    }
    return bot.sendMessage(chatId,`⚠️ Sin código reciente para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdCode",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
}

/** /link — Reset de contraseña: Netflix, Disney+, HBO Max */
async function cmdLink(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /link correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      const isN  = esNetflixReset(e.from, e.subject);
      const isD  = esDisney(e.from, e.subject);
      const isH  = esHBO(e.from, e.subject);
      const isP  = esParamount(e.from, e.subject);
      if(!isN && !isD && !isH && !isP) continue;

      const link = extraerLink(e.text, e.html);
      if(!link) continue;

      const plat  = isN ? "NETFLIX" : isD ? "DISNEY+" : isP ? "PARAMOUNT+" : "HBO MAX";
      const emoji = isN ? "🎬" : isD ? "🏰" : isP ? "💿" : "🎞️";

      return bot.sendMessage(chatId,
        `${emoji} *LINK RESET ${plat}*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\n` +
        `Toca el botón para abrir el link:`,
        {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:`${emoji} Abrir link ${plat}`, url:link}]]}}
      );
    }
    return bot.sendMessage(chatId,`⚠️ Sin link de reset para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdLink",e); return bot.sendMessage(chatId,"❌ Error."); }
}

/** /hogar — Código de Netflix hogar */
async function cmdHogar(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /hogar correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      if(!esNetflixCodigo(e.from,e.subject) && !esNetflixReset(e.from,e.subject)) continue;
      if(!esHogar(e.subject,e.text)) continue;

      let codigo = extraerCodigoInteligente(e.text, e.subject, e.html);
      let linkWeb = null;

      if(!codigo) {
        linkWeb = extraerLinkObtenerCodigo(e.html);
        if(linkWeb) codigo = await scrapearCodigoWeb(linkWeb);
      }

      if(codigo) return bot.sendMessage(chatId,
        `🏠 *CÓDIGO NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `🔑 *Código:* \`${codigo}\`\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,
        {parse_mode:"Markdown"}
      );

      if(linkWeb) return bot.sendMessage(chatId,
        `🏠 *CÓDIGO NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `⚠️ Abrir enlace seguro:\n📨 *Asunto:* ${escMD(e.subject)}`,
        {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"🏠 Abrir Enlace Hogar", url:linkWeb}]]}}
      );
    }
    return bot.sendMessage(chatId,`⚠️ Sin código de hogar para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdHogar",e); return bot.sendMessage(chatId,"❌ Error."); }
}

/** /prime — Código OTP de Prime Video (6 dígitos) */
async function cmdPrime(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /prime correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      if(!esPrime(e.from, e.subject)) continue;

      const codigo = extraerCodigoInteligente(e.text, e.subject, e.html);

      if(codigo) return bot.sendMessage(chatId,
        `🎥 *CÓDIGO PRIME VIDEO*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `🔑 *Código:* \`${codigo}\`\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,
        {parse_mode:"Markdown"}
      );
    }
    return bot.sendMessage(chatId,`⚠️ Sin código de Prime Video para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdPrime",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
}

/** /inbox — Ver últimos emails del correo */
async function cmdInbox(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /inbox correo@dominio.com");
  try{
    const emails = await buscarEmails(correo,5);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    let txt=`📥 *ÚLTIMOS EMAILS*\n📧 ${escMD(correo)}\n\n`;
    emails.forEach((e,i)=>{ txt+=`*${i+1}.* ${escMD(e.subject||"(sin asunto)")}\n   📨 ${escMD(e.from)}\n   🕒 ${escMD(formatearFecha(e.date))}\n\n`; });
    return bot.sendMessage(chatId,txt,{parse_mode:"Markdown"});
  }catch(e){ logErr("cmdInbox",e); return bot.sendMessage(chatId,"❌ Error."); }
}

// ===============================
// REGISTRO DE COMANDOS (1 sola vez)
// ===============================
if(!global.__SUBLICUENTAS_IMAP_READY__){
  global.__SUBLICUENTAS_IMAP_READY__=true;

  bot.onText(/^\/code\s+(\S+)/i,   async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdCode(msg.chat.id,  normalizarCorreo(m[1])); });
  bot.onText(/^\/link\s+(\S+)/i,   async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdLink(msg.chat.id,  normalizarCorreo(m[1])); });
  bot.onText(/^\/hogar\s+(\S+)/i,  async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdHogar(msg.chat.id, normalizarCorreo(m[1])); });
  bot.onText(/^\/prime\s+(\S+)/i,  async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdPrime(msg.chat.id, normalizarCorreo(m[1])); });
  bot.onText(/^\/inbox\s+(\S+)/i,  async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdInbox(msg.chat.id, normalizarCorreo(m[1])); });

  console.log("✅ Módulo IMAP cargado v10 — /code /link /hogar /prime /inbox");
}

module.exports = { cmdCode, cmdLink, cmdHogar, cmdPrime, cmdInbox };
