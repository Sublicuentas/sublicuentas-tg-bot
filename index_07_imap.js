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
function esNetflix(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("netflix")||s.includes("netflix")||s.includes("verificaci")||s.includes("seguridad")||s.includes("confirmaci")||s.includes("actualiza");
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
  const basuraAnios = ["2024", "2025", "2026", "2027"];

  // ── 1. Búsqueda en subject + text plano ──────────────────────────────
  const fuente = (subject + " " + text).replace(/\s+/g, " ");

  // 6 dígitos exactos
  const match6 = fuente.match(/\b\d{6}\b/g);
  if (match6) {
    for (const c of match6) if (!basuraAnios.includes(c)) return c;
  }

  // 6 dígitos con espacio al medio (ej. 123 456)
  const match6Esp = fuente.match(/\b(\d{3})\s+(\d{3})\b/);
  if (match6Esp) return (match6Esp[1] + match6Esp[2]);

  // 4 dígitos
  const match4 = fuente.match(/\b\d{4}\b/g);
  if (match4) {
    for (const c of match4) if (!basuraAnios.includes(c)) return c;
  }

  // ── 2. Búsqueda en HTML (necesario para Disney y Prime) ──────────────
  if (html) {
    const htmlLimpio = html.replace(/\s+/g, " ");

    // Patrón Disney: el código suele estar en un <td> o <div> grande, solo dígitos
    // Buscar 6 dígitos rodeados de tags HTML
    const htmlMatch6 = htmlLimpio.match(/>\s*(\d{6})\s*</g);
    if (htmlMatch6) {
      for (const bloque of htmlMatch6) {
        const num = bloque.replace(/[^\d]/g, "");
        if (num.length === 6 && !basuraAnios.includes(num)) return num;
      }
    }

    // Patrón Disney alternativo: font-size grande con número
    const fontMatch = htmlLimpio.match(/font-size\s*:\s*\d+px[^>]*>\s*(\d{4,6})\s*</i);
    if (fontMatch && fontMatch[1] && !basuraAnios.includes(fontMatch[1])) return fontMatch[1];

    // Patrón con tracking-widespace (Disney usa esto frecuentemente)
    const trackMatch = htmlLimpio.match(/letter-spacing[^>]*>\s*(\d{4,6})\s*</i);
    if (trackMatch && trackMatch[1] && !basuraAnios.includes(trackMatch[1])) return trackMatch[1];

    // Fallback HTML: 4 dígitos en tags
    const htmlMatch4 = htmlLimpio.match(/>\s*(\d{4})\s*</g);
    if (htmlMatch4) {
      for (const bloque of htmlMatch4) {
        const num = bloque.replace(/[^\d]/g, "");
        if (num.length === 4 && !basuraAnios.includes(num)) return num;
      }
    }
  }

  return null;
}

// Links de reset de contraseña/correo
function extraerLink(text="", html="") {
  const f = html || text;
  const pats = [
    // Netflix
    /https:\/\/www\.netflix\.com\/password[^\s"<>\]]+/i,
    /https:\/\/www\.netflix\.com\/[^\s"<>\]]*reset[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*netflix[^\s"<>\]]*password[^\s"<>\]]*/i,
    // Disney
    /https:\/\/[^\s"<>\]]*disneyplus[^\s"<>\]]*reset[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*disney[^\s"<>\]]*account[^\s"<>\]]*/i,
    // HBO Max
    /https:\/\/[^\s"<>\]]*hbomax[^\s"<>\]]*(?:reset|password|account|verify)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*max\.com[^\s"<>\]]*(?:reset|password|account|verify|email)[^\s"<>\]]*/i,
  ];
  for (const p of pats) {
    const m = f.match(p);
    if (m?.[0]) return m[0].replace(/&amp;/g,"&").trim();
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
      const desde=new Date(); desde.setDate(desde.getDate()-7);
      const uids = await client.search({to:correo, since:desde});
      if(!uids||!uids.length) return [];
      const ids=uids.slice(-limite);
      for await(const msg of client.fetch(ids,{source:true})){
        try{
          const p=await simpleParser(msg.source);
          emails.push({
            from:  String(p.from?.text||""),
            subject: String(p.subject||""),
            text:  String(p.text||""),
            html:  String(p.html||""),
            date:  p.date||new Date(),
          });
        }catch(_){}
      }
    } finally { lock.release(); }
  } finally { await client.logout(); }
  return emails.reverse();
}

// ===============================
// COMANDOS
// ===============================

/** /code — Netflix o Disney+ */
async function cmdCode(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /code correo@dominio.com");
  await bot.sendMessage(chatId,`🔎 Buscando código para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      const isN = esNetflix(e.from, e.subject);
      const isD = esDisney(e.from, e.subject);
      if(!isN && !isD) continue;

      // Pasar HTML también para que Disney funcione
      let codigo = extraerCodigoInteligente(e.text, e.subject, e.html);
      let linkWeb = null;

      if(!codigo && isN) {
        linkWeb = extraerLinkObtenerCodigo(e.html);
        if(linkWeb) codigo = await scrapearCodigoWeb(linkWeb);
      }

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

      if(linkWeb) {
        return bot.sendMessage(chatId,
          `🎬 *CÓDIGO NETFLIX (VIA WEB)*\n\n` +
          `📧 *Correo:* ${escMD(correo)}\n` +
          `⚠️ Toca el botón para ver el código:\n\n` +
          `📨 *Asunto:* ${escMD(e.subject)}`,
          {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"🔎 Abrir Enlace Netflix", url:linkWeb}]]}}
        );
      }
    }
    return bot.sendMessage(chatId,`⚠️ Sin código para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdCode",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
}

/** /link — Reset de contraseña: Netflix, Disney+, HBO Max */
async function cmdLink(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /link correo@dominio.com");
  await bot.sendMessage(chatId,`🔎 Buscando link de reset para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      const isN  = esNetflix(e.from, e.subject);
      const isD  = esDisney(e.from, e.subject);
      const isH  = esHBO(e.from, e.subject);
      if(!isN && !isD && !isH) continue;

      const link = extraerLink(e.text, e.html);
      if(!link) continue;

      const plat  = isN ? "NETFLIX" : isD ? "DISNEY+" : "HBO MAX";
      const emoji = isN ? "🎬" : isD ? "🏰" : "🎞️";

      return bot.sendMessage(chatId,
        `${emoji} *LINK RESET ${plat}*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\n` +
        `🔗 *Link:*\n${link}`,
        {parse_mode:"Markdown", disable_web_page_preview:true}
      );
    }
    return bot.sendMessage(chatId,`⚠️ Sin link de reset para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdLink",e); return bot.sendMessage(chatId,"❌ Error."); }
}

/** /hogar — Código de Netflix hogar */
async function cmdHogar(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /hogar correo@dominio.com");
  await bot.sendMessage(chatId,`🔎 Buscando código hogar para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      if(!esNetflix(e.from,e.subject) || !esHogar(e.subject,e.text)) continue;

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
  await bot.sendMessage(chatId,`🔎 Buscando código de *Prime Video* para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
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
  await bot.sendMessage(chatId,`📥 Inbox de *${escMD(correo)}*...`,{parse_mode:"Markdown"});
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
