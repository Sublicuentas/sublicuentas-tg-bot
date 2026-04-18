/* âœ… SUBLICUENTAS TG BOT â€” PARTE 7/7
   IMAP â€” EXTRACTOR DE CÃ“DIGOS NETFLIX / DISNEY
   Usa imapflow, mailparser y extracciÃ³n web nativa
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

function esNetflix(from="",subject=""){const f=from.toLowerCase();const s=subject.toLowerCase();return f.includes("netflix")||s.includes("netflix")||s.includes("verificaci")||s.includes("seguridad")||s.includes("confirmaci")||s.includes("actualiza");}
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
    pats.push(/[Cc][oÃ³OÃ“]digo.{0,40}?\b(\d{6})\b/g);
    pats.push(/\b(?:es|is|cÃ³digo)[\s:]+(\d{6})\b/g);
    pats.push(/\b(\d{6})\b/g); 
  } else {
    pats.push(/[Cc][oÃ³OÃ“]digo.{0,40}?\b([A-Z0-9]{4,8})\b/g);
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

// NUEVO: Extrae el enlace del botÃ³n "Obtener cÃ³digo"
function extraerLinkObtenerCodigo(html="") {
  const pat = /https:\/\/[^"'>]+netflix\.com[^"'>]*(?:travel|verify|temporary|update|account\/travel)[^"'>]*/i;
  const m = html.match(pat);
  if(m) return m[0].replace(/&amp;/g, "&").trim();
  return null;
}

// NUEVO: Intenta raspar el cÃ³digo directamente de la web de Netflix
async function scrapearCodigoWeb(url) {
  try {
    if(typeof fetch !== "undefined") {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      const html = await res.text();
      const m1 = html.match(/>\s*([0-9]{4})\s*</); // Busca 4 dÃ­gitos entre etiquetas
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
  if(!correo) return bot.sendMessage(chatId,"âš ï¸ Uso: /code correo@dominio.com");
  await bot.sendMessage(chatId,`ðŸ” Buscando cÃ³digo para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails=await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`ðŸ“­ Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    
    for(const e of emails){
      const esN=esNetflix(e.from,e.subject);
      const esD=esDisney(e.from,e.subject);
      if(!esN && !esD) continue; 
      
      let codigo = extraerCodigo(e.text, e.html, esD); 
      let linkWeb = null;

      // Si no hay cÃ³digo escrito pero es Netflix, verificamos si trae enlace de web
      if(!codigo && esN) {
         linkWeb = extraerLinkObtenerCodigo(e.html);
         if(linkWeb) {
            codigo = await scrapearCodigoWeb(linkWeb); // Intenta extraerlo solo
         }
      }

      if(!codigo && !linkWeb) continue;
      
      if(codigo) {
         return bot.sendMessage(chatId,`${esN?"ðŸŽ¬":"ðŸ°"} *CÃ“DIGO ${esN?"NETFLIX":"DISNEY+"}*\n\nðŸ“§ *Correo:* ${escMD(correo)}\nðŸ”‘ *CÃ³digo:* \`${codigo}\`\nðŸ“¨ *Asunto:* ${escMD(e.subject)}\nðŸ• *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
      } else if (linkWeb) {
         // Rescate: Si Netflix nos bloquea el rastreo, enviamos el botÃ³n directo
         return bot.sendMessage(chatId,`ðŸŽ¬ *CÃ“DIGO NETFLIX (VIA WEB)*\n\nðŸ“§ *Correo:* ${escMD(correo)}\nâš ï¸ Netflix exige generar este cÃ³digo en su pÃ¡gina web. Toca el botÃ³n rojo de abajo:\n\nðŸ“¨ *Asunto:* ${escMD(e.subject)}`, {
             parse_mode: "Markdown",
             reply_markup: { inline_keyboard: [[{ text: "ðŸ“ Abrir Enlace de Netflix", url: linkWeb }]] }
         });
      }
    }
    return bot.sendMessage(chatId,`âš ï¸ Sin cÃ³digo en emails de *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){logErr("cmdCode",e);return bot.sendMessage(chatId,`âŒ Error: ${escMD(e?.message||"desconocido")}`,{parse_mode:"Markdown"});}
}

async function cmdLink(chatId,correo){
  if(!correo) return bot.sendMessage(chatId,"âš ï¸ Uso: /link correo@dominio.com");
  await bot.sendMessage(chatId,`ðŸ” Buscando link para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails=await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`ðŸ“­ Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    for(const e of emails){
      if(!esNetflix(e.from,e.subject)&&!esDisney(e.from,e.subject)) continue;
      const link=extraerLink(e.text,e.html); if(!link) continue;
      const esN=esNetflix(e.from,e.subject);
      return bot.sendMessage(chatId,`${esN?"ðŸŽ¬":"ðŸ°"} *LINK RESET ${esN?"NETFLIX":"DISNEY+"}*\n\nðŸ“§ *Correo:* ${escMD(correo)}\nðŸ“¨ *Asunto:* ${escMD(e.subject)}\nðŸ• *Fecha:* ${escMD(formatearFecha(e.date))}\n\nðŸ”— *Link:*\n${link}`,{parse_mode:"Markdown",disable_web_page_preview:true});
    }
    return bot.sendMessage(chatId,`âš ï¸ Sin link de reset para *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){logErr("cmdLink",e);return bot.sendMessage(chatId,`âŒ Error: ${escMD(e?.message||"desconocido")}`,{parse_mode:"Markdown"});}
}

async function cmdHogar(chatId,correo){
  if(!correo) return bot.sendMessage(chatId,"âš ï¸ Uso: /hogar correo@dominio.com");
  await bot.sendMessage(chatId,`ðŸ” Buscando cÃ³digo hogar para *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails=await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`ðŸ“­ Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    for(const e of emails){
      if(!esNetflix(e.from,e.subject)) continue;
      if(!esHogar(e.subject,e.text)) continue;
      
      let codigo = extraerCodigo(e.text,e.html, false); 
      let linkWeb = null;

      if(!codigo) {
         linkWeb = extraerLinkObtenerCodigo(e.html);
         if(linkWeb) codigo = await scrapearCodigoWeb(linkWeb);
      }

      if(!codigo && !linkWeb) continue;

      if(codigo) {
         return bot.sendMessage(chatId,`ðŸ  *CÃ“DIGO NETFLIX HOGAR*\n\nðŸ“§ *Correo:* ${escMD(correo)}\nðŸ”‘ *CÃ³digo:* \`${codigo}\`\nðŸ“¨ *Asunto:* ${escMD(e.subject)}\nðŸ• *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
      } else if (linkWeb) {
         return bot.sendMessage(chatId,`ðŸ  *CÃ“DIGO NETFLIX HOGAR*\n\nðŸ“§ *Correo:* ${escMD(correo)}\nâš ï¸ Netflix enviÃ³ un enlace seguro para este cÃ³digo. Ãbrelo aquÃ­:\n\nðŸ“¨ *Asunto:* ${escMD(e.subject)}`,{
             parse_mode:"Markdown",
             reply_markup: { inline_keyboard: [[{ text: "ðŸ  Abrir Enlace Hogar", url: linkWeb }]] }
         });
      }
    }
    return bot.sendMessage(chatId,`âš ï¸ Sin cÃ³digo de hogar para *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){logErr("cmdHogar",e);return bot.sendMessage(chatId,`âŒ Error: ${escMD(e?.message||"desconocido")}`,{parse_mode:"Markdown"});}
}


function extraerCodigoInteligente(text = "", subject = "") {
  const t = (text || "").toLowerCase();
  const s = (subject || "").toLowerCase();
  
  // Buscar 6 dÃ­gitos con espacio (ej. 123 456) o pegados (123456)
  const match6 = text.match(/\b(\d{3})\s?(\d{3})\b/) || subject.match(/\b(\d{3})\s?(\d{3})\b/);
  if (match6) return (match6[1] + match6[2]);

  // Si no hay de 6, buscar el clÃ¡sico de 4 (Hogar/Acceso)
  const match4 = text.match(/\b\d{4}\b/);
  return match4 ? match4[0] : null;
}

async function cmdInbox(chatId,correo){
  if(!correo) return bot.sendMessage(chatId,"âš ï¸ Uso: /inbox correo@dominio.com");
  await bot.sendMessage(chatId,`ðŸ“¬ Revisando inbox de *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails=await buscarEmails(correo,5);
    if(!emails.length) return bot.sendMessage(chatId,`ðŸ“­ Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    let txt=`ðŸ“¬ *ÃšLTIMOS EMAILS*\nðŸ“§ ${escMD(correo)}\n\n`;
    emails.forEach((e,i)=>{txt+=`*${i+1}.* ${escMD(e.subject||"(sin asunto)")}\n   ðŸ“¨ ${escMD(e.from)}\n   ðŸ• ${escMD(formatearFecha(e.date))}\n\n`;});
    return bot.sendMessage(chatId,txt,{parse_mode:"Markdown"});
  }catch(e){logErr("cmdInbox",e);return bot.sendMessage(chatId,`âŒ Error: ${escMD(e?.message||"desconocido")}`,{parse_mode:"Markdown"});}
}

if(!global.__SUBLICUENTAS_IMAP_READY__){
  global.__SUBLICUENTAS_IMAP_READY__=true;

  bot.onText(/^\/code\s+(\S+)/i,async(msg,match)=>{const chatId=msg.chat.id;const userId=msg.from.id;if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"â›” Acceso denegado");return cmdCode(chatId,normalizarCorreo(match[1]));});
  bot.onText(/^\/link\s+(\S+)/i,async(msg,match)=>{const chatId=msg.chat.id;const userId=msg.from.id;if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"â›” Acceso denegado");return cmdLink(chatId,normalizarCorreo(match[1]));});
  bot.onText(/^\/hogar\s+(\S+)/i,async(msg,match)=>{const chatId=msg.chat.id;const userId=msg.from.id;if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"â›” Acceso denegado");return cmdHogar(chatId,normalizarCorreo(match[1]));});
  bot.onText(/^\/inbox\s+(\S+)/i,async(msg,match)=>{const chatId=msg.chat.id;const userId=msg.from.id;if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"â›” Acceso denegado");return cmdInbox(chatId,normalizarCorreo(match[1]));});

  bot.onText(/^\/imap_test$/i,async(msg)=>{
    const chatId=msg.chat.id;const userId=msg.from.id;
    if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"â›” Acceso denegado");
    try{
      await bot.sendMessage(chatId,"ðŸ”Œ Probando conexiÃ³n IMAP...");
      const c=new ImapFlow({host:IMAP_HOST,port:IMAP_PORT,secure:true,auth:{user:IMAP_USER,pass:IMAP_PASS},logger:false,tls:{rejectUnauthorized:false}});
      await c.connect(); await c.logout();
      return bot.sendMessage(chatId,`âœ… ConexiÃ³n IMAP exitosa\n\nðŸŒ Host: \`${IMAP_HOST}\`\nðŸ‘¤ Usuario: \`${IMAP_USER}\``,{parse_mode:"Markdown"});
    }catch(e){return bot.sendMessage(chatId,`âŒ Error IMAP:\n${escMD(e?.message||String(e))}`,{parse_mode:"Markdown"});}
  });

  console.log("âœ… MÃ³dulo IMAP cargado (imapflow) â€” /code /link /hogar /inbox /imap_test");
}

module.exports={cmdCode,cmdLink,cmdHogar,cmdInbox};
