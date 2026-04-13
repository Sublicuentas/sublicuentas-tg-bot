/* ✅ SUBLICUENTAS TG BOT — PARTE 7/7
   IMAP — EXTRACTOR DE CÓDIGOS NETFLIX / DISNEY
   Usa imapflow, mailparser y extracción web nativa
*/

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const { bot } = require("./index_01_core");
const { isAdmin, logErr, escMD } = require("./index_02_utils_roles");

const IMAP_HOST = process.env.IMAP_HOST_1 || process.env.EMAIL_IMAP_HOST || "premium48.web-hosting.com";
const IMAP_PORT = Number(process.env.EMAIL_IMAP_PORT || 993);
const IMAP_USER = process.env.EMAIL_ADMIN_USER || "admin@sublicuentas.com";
const IMAP_PASS = process.env.EMAIL_ADMIN_PASS || "";

function normalizarCorreo(c = "") { return String(c||"").trim().toLowerCase(); }

function formatearFecha(date) {
  try { return new Date(date).toLocaleString("es-HN",{timeZone:"America/Tegucigalpa",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
  catch(_){ return String(date||""); }
}

function esNetflix(from="",subject=""){const f=from.toLowerCase();const s=subject.toLowerCase();return f.includes("netflix")||s.includes("netflix");}
function esDisney(from="",subject=""){const f=from.toLowerCase();const s=subject.toLowerCase();return f.includes("disney")||s.includes("disney");}
function esHogar(subject="",text=""){const s=subject.toLowerCase();const t=text.toLowerCase();return s.includes("hogar")||s.includes("household")||s.includes("extra member")||t.includes("netflix hogar");}

function extraerCodigo(text="", html="", esD = false){
  let f = "";
  if (text && text.trim().length > 20) {
    f = text;
  } else {
    f = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&[a-z]+;/gi, " ");
  }
  
  const pats = [];
  if (esD) {
    pats.push(/[Cc][oóOÓ]digo.{0,40}?\b(\d{6})\b/g);
    pats.push(/\b(?:es|is|código)[\s:]+(\d{6})\b/g);
    pats.push(/\b(\d{6})\b/g); 
  } else {
    pats.push(/[Cc][oóOÓ]digo.{0,40}?\b([A-Z0-9]{4,8})\b/g);
    pats.push(/\b(?:es|is)[\s:]+([A-Z0-9]{4,8})\b/g);
    pats.push(/\b([0-9]{4})\b/g);
    pats.push(/\b([A-Z0-9]{6,8})\b/g);
  }

  for(const p of pats){
    const matches = [...f.matchAll(p)];
    for(const m of matches){
      if(m && m[1]){
        const codigo = m[1].trim();
        const basura = ["000000", "123456", "0000", "1111", "1234", "FFFFFF"];
        const anios = ["2023", "2024", "2025", "2026", "2027"];
        
        if(!basura.includes(codigo.toUpperCase()) && !anios.includes(codigo)) {
           if(esD && !/^\d{6}$/.test(codigo)) continue;
           if(/\d/.test(codigo)) return codigo;
        }
      }
    }
  }
  return null;
}

function extraerLink(text="",html=""){
  const f=html||text;
  const pats=[/https:\/\/www\.netflix\.com\/password[^\s"<>\]]+/i,/https:\/\/www\.netflix\.com\/[^\s"<>\]]*reset[^\s"<>\]]*/i,/https:\/\/[^\s"<>\]]*netflix[^\s"<>\]]*password[^\s"<>\]]*/i,/https:\/\/[^\s"<>\]]*disneyplus[^\s"<>\]]*reset[^\s"<>\]]*/i];
  for(const p of pats){const m=f.match(p);if(m?.[0])return m[0].replace(/&amp;/g,"&").trim();}
  return null;
}

// NUEVO: Extrae el enlace del botón "Obtener código"
function extraerLinkObtenerCodigo(html="") {
  const pat = /https:\/\/[^"'>]+netflix\.com[^"'>]*(?:travel|verify|temporary|update|account\/travel)[^"'>]*/i;
  const m = html.match(pat);
  if(m) return m[0].replace(/&amp;/g, "&").trim();
  return null;
}

// NUEVO: Intenta raspar el código directamente de la web de Netflix
async function scrapearCodigoWeb(url) {
  try {
    if(typeof fetch !== "undefined") {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      const html = await res.text();
      const m1 = html.match(/>\s*([0-9]{4})\s*</); // Busca 4 dígitos entre etiquetas
      if (m1 && m1[1]) return m1[1];
    }
  } catch(e) { /* Error silencioso si Netflix bloquea */ }
  return null;
}

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
        try{ const p=await simpleParser(msg.source); emails.push({from:String(p.from?.text||""),subject:String(p.subject||""),text:String(p.text||""),html:String(p.html||""),date:p.date||new Date()}); }catch(_){}
      }
    } finally { lock.release(); }
  } finally { await client.logout(); }
  return emails.reverse();
}

async function cmdCode(chatId,correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /code correo@dominio.com");
  await bot.sendMessage(chatId,`🔍 Buscando código para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails=await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📭 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    
    for(const e of emails){
      const esN=esNetflix(e.from,e.subject);
      const esD=esDisney(e.from,e.subject);
      if(!esN && !esD) continue; 
      
      let codigo = extraerCodigo(e.text, e.html, esD); 
      let linkWeb = null;

      // Si no hay código escrito pero es Netflix, verificamos si trae enlace de web
      if(!codigo && esN) {
         linkWeb = extraerLinkObtenerCodigo(e.html);
         if(linkWeb) {
            codigo = await scrapearCodigoWeb(linkWeb); // Intenta extraerlo solo
         }
      }

      if(!codigo && !linkWeb) continue;
      
      if(codigo) {
         return bot.sendMessage(chatId,`${esN?"🎬":"🏰"} *CÓDIGO ${esN?"NETFLIX":"DISNEY+"}*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕐 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
      } else if (linkWeb) {
         // Rescate: Si Netflix nos bloquea el rastreo, enviamos el botón directo
         return bot.sendMessage(chatId,`🎬 *CÓDIGO NETFLIX (VIA WEB)*\n\n📧 *Correo:* ${escMD(correo)}\n⚠️ Netflix exige generar este código en su página web. Toca el botón rojo de abajo:\n\n📨 *Asunto:* ${escMD(e.subject)}`, {
             parse_mode: "Markdown",
             reply_markup: { inline_keyboard: [[{ text: "📍 Abrir Enlace de Netflix", url: linkWeb }]] }
         });
      }
    }
    return bot.sendMessage(chatId,`⚠️ Sin código en emails de *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){logErr("cmdCode",e);return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"desconocido")}`,{parse_mode:"Markdown"});}
}

async function cmdLink(chatId,correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /link correo@dominio.com");
  await bot.sendMessage(chatId,`🔍 Buscando link para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails=await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📭 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    for(const e of emails){
      if(!esNetflix(e.from,e.subject)&&!esDisney(e.from,e.subject)) continue;
      const link=extraerLink(e.text,e.html); if(!link) continue;
      const esN=esNetflix(e.from,e.subject);
      return bot.sendMessage(chatId,`${esN?"🎬":"🏰"} *LINK RESET ${esN?"NETFLIX":"DISNEY+"}*\n\n📧 *Correo:* ${escMD(correo)}\n📨 *Asunto:* ${escMD(e.subject)}\n🕐 *Fecha:* ${escMD(formatearFecha(e.date))}\n\n🔗 *Link:*\n${link}`,{parse_mode:"Markdown",disable_web_page_preview:true});
    }
    return bot.sendMessage(chatId,`⚠️ Sin link de reset para *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){logErr("cmdLink",e);return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"desconocido")}`,{parse_mode:"Markdown"});}
}

async function cmdHogar(chatId,correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /hogar correo@dominio.com");
  await bot.sendMessage(chatId,`🔍 Buscando código hogar para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails=await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📭 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    for(const e of emails){
      if(!esNetflix(e.from,e.subject)) continue;
      if(!esHogar(e.subject,e.text)) continue;
      
      let codigo = extraerCodigo(e.text,e.html, false); 
      let linkWeb = null;

      if(!codigo) {
         linkWeb = extraerLinkObtenerCodigo(e.html);
         if(linkWeb
