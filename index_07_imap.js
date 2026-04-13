/* ✅ SUBLICUENTAS TG BOT — PARTE 7/7
   IMAP — EXTRACTOR DE CÓDIGOS NETFLIX / DISNEY
   Usa imapflow (ya instalado en el proyecto)
*/

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const { bot } = require("./index_01_core");
const { isAdmin, logErr, escMD } = require("./index_02_utils_roles");

const IMAP_HOST = process.env.EMAIL_IMAP_HOST  || "sublicuentas.com";
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

function extraerCodigo(text="",html=""){
  const f=text||html.replace(/<[^>]+>/g," ");
  const pats=[/c[oó]digo[:\s]+([A-Z0-9]{4,8})\b/i,/verification code[:\s]+([A-Z0-9]{4,8})\b/i,/tu c[oó]digo es[:\s]+([A-Z0-9]{4,8})\b/i,/c[oó]digo temporal[:\s]+([A-Z0-9]{4,8})\b/i,/enter this code[:\s]+([A-Z0-9]{4,8})\b/i,/use this code[:\s]+([A-Z0-9]{4,8})\b/i,/\b([A-Z0-9]{6})\b/];
  for(const p of pats){const m=f.match(p);if(m?.[1])return m[1].trim();}
  return null;
}

function extraerLink(text="",html=""){
  const f=html||text;
  const pats=[/https:\/\/www\.netflix\.com\/password[^\s"<>\]]+/i,/https:\/\/www\.netflix\.com\/[^\s"<>\]]*reset[^\s"<>\]]*/i,/https:\/\/[^\s"<>\]]*netflix[^\s"<>\]]*password[^\s"<>\]]*/i,/https:\/\/[^\s"<>\]]*disneyplus[^\s"<>\]]*reset[^\s"<>\]]*/i];
  for(const p of pats){const m=f.match(p);if(m?.[0])return m[0].replace(/&amp;/g,"&").trim();}
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
      if(!esNetflix(e.from,e.subject)&&!esDisney(e.from,e.subject)) continue;
      const codigo=extraerCodigo(e.text,e.html); if(!codigo) continue;
      const esN=esNetflix(e.from,e.subject);
      return bot.sendMessage(chatId,`${esN?"🎬":"🏰"} *CÓDIGO ${esN?"NETFLIX":"DISNEY+"}*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕐 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
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
      const codigo=extraerCodigo(e.text,e.html); if(!codigo) continue;
      return bot.sendMessage(chatId,`🏠 *CÓDIGO NETFLIX HOGAR*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕐 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
    }
    return bot.sendMessage(chatId,`⚠️ Sin código de hogar para *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){logErr("cmdHogar",e);return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"desconocido")}`,{parse_mode:"Markdown"});}
}

async function cmdInbox(chatId,correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /inbox correo@dominio.com");
  await bot.sendMessage(chatId,`📬 Revisando inbox de *${escMD(correo)}*...`,{parse_mode:"Markdown"});
  try{
    const emails=await buscarEmails(correo,5);
    if(!emails.length) return bot.sendMessage(chatId,`📭 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});
    let txt=`📬 *ÚLTIMOS EMAILS*\n📧 ${escMD(correo)}\n\n`;
    emails.forEach((e,i)=>{txt+=`*${i+1}.* ${escMD(e.subject||"(sin asunto)")}\n   📨 ${escMD(e.from)}\n   🕐 ${escMD(formatearFecha(e.date))}\n\n`;});
    return bot.sendMessage(chatId,txt,{parse_mode:"Markdown"});
  }catch(e){logErr("cmdInbox",e);return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"desconocido")}`,{parse_mode:"Markdown"});}
}

if(!global.__SUBLICUENTAS_IMAP_READY__){
  global.__SUBLICUENTAS_IMAP_READY__=true;

  bot.onText(/^\/code\s+(\S+)/i,async(msg,match)=>{const chatId=msg.chat.id;const userId=msg.from.id;if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"⛔ Acceso denegado");return cmdCode(chatId,normalizarCorreo(match[1]));});
  bot.onText(/^\/link\s+(\S+)/i,async(msg,match)=>{const chatId=msg.chat.id;const userId=msg.from.id;if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"⛔ Acceso denegado");return cmdLink(chatId,normalizarCorreo(match[1]));});
  bot.onText(/^\/hogar\s+(\S+)/i,async(msg,match)=>{const chatId=msg.chat.id;const userId=msg.from.id;if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"⛔ Acceso denegado");return cmdHogar(chatId,normalizarCorreo(match[1]));});
  bot.onText(/^\/inbox\s+(\S+)/i,async(msg,match)=>{const chatId=msg.chat.id;const userId=msg.from.id;if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"⛔ Acceso denegado");return cmdInbox(chatId,normalizarCorreo(match[1]));});

  bot.onText(/^\/imap_test$/i,async(msg)=>{
    const chatId=msg.chat.id;const userId=msg.from.id;
    if(!(await isAdmin(userId)))return bot.sendMessage(chatId,"⛔ Acceso denegado");
    try{
      await bot.sendMessage(chatId,"🔌 Probando conexión IMAP...");
      const c=new ImapFlow({host:IMAP_HOST,port:IMAP_PORT,secure:true,auth:{user:IMAP_USER,pass:IMAP_PASS},logger:false,tls:{rejectUnauthorized:false}});
      await c.connect(); await c.logout();
      return bot.sendMessage(chatId,`✅ Conexión IMAP exitosa\n\n🌐 Host: \`${IMAP_HOST}\`\n👤 Usuario: \`${IMAP_USER}\``,{parse_mode:"Markdown"});
    }catch(e){return bot.sendMessage(chatId,`❌ Error IMAP:\n${escMD(e?.message||String(e))}`,{parse_mode:"Markdown"});}
  });

  console.log("✅ Módulo IMAP cargado (imapflow) — /code /link /hogar /inbox /imap_test");
}

module.exports={cmdCode,cmdLink,cmdHogar,cmdInbox};
