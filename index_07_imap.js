/* ✅ SUBLICUENTAS TG BOT — PARTE 7/7 v15
   IMAP — EXTRACTOR DE CÓDIGOS NETFLIX / DISNEY / HBO / PRIME VIDEO / UNIVERSAL
   ----------------------------------------------------------------
   ✅ CAMBIOS v15 (Actualización Casandra):
   - FIX CRÍTICO: Universal+ atrapaba palabras de 6 letras como "CUENTA".
   - MEJORA: Se fuerza a que el código de Universal+ tenga obligatoriamente letras Y números.
   - MEJORA: Se añade una lista negra de palabras a ignorar.
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
  return f.includes("netflix") || s.includes("netflix");
}

function esNetflixCodigo(from="",subject=""){
  if(!esNetflix(from,subject)) return false;
  const s=subject.toLowerCase();
  if(s.includes("restablecimiento")||s.includes("reset")||s.includes("password")||
     s.includes("contrase")||s.includes("cambio")||s.includes("actualiza")) return false;
  return s.includes("verificaci")||s.includes("seguridad")||
         s.includes("confirmaci")||s.includes("hogar")||s.includes("household")||
         s.includes("inicio de sesi");
}

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
         s.includes("hbo max")||s.includes("hbomax")||
         (s.includes("hbo") && !f.includes("netflix") && !f.includes("disney") && !f.includes("amazon"));
}

function esPrime(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("amazon")||f.includes("primevideo")||
         s.includes("prime video")||s.includes("primevideo")||s.includes("amazon prime")||
         (f.includes("prime") && !f.includes("paramount"));
}

function esParamount(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("paramount")||f.includes("cbs.com")||f.includes("viacom")||
         s.includes("paramount")||s.includes("paramount+");
}

function esUniversal(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("universal")||s.includes("universal")||s.includes("universal+");
}

function esHogar(subject="",text=""){
  const s=subject.toLowerCase(); const t=text.toLowerCase();
  return s.includes("hogar")||s.includes("household")||s.includes("extra member")||t.includes("netflix hogar");
}

// ===============================
// EXTRACCIÓN DE CÓDIGOS
// ===============================

/**
 * Extrae código numérico o alfanumérico. Validaciones estrictas por plataforma.
 */
function extraerCodigoInteligente(text = "", subject = "", html = "", plataforma = "otro") {
  const basuraAnios = new Set(["2024", "2025", "2026", "2027"]);
  const fuente = (subject + " " + text + " " + html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

  // REGLA ESTRICTA Y BLINDADA: Universal+
  if (plataforma === "universal") {
    // 1. Limpiamos enlaces web para matar cosas como idp-services.tbxnet.com
    const fuenteSinLinks = fuente.replace(/https?:\/\/[^\s]+/gi, " ");
    
    // 2. Buscamos bloques de 6 letras (mayúsculas) o números
    const matchUni = fuenteSinLinks.match(/(?<![a-zA-Z0-9])([A-Z0-9]{6})(?![a-zA-Z0-9])/g);
    
    if (matchUni) {
      // 3. Lista negra de palabras comunes de 6 letras que arruinan la lectura
      const ignorar = new Set(["CUENTA", "CODIGO", "CORREO", "ACCESO", "TBXNET", "ACTIVA", "ONLINE", "EQUIPO", "PRUEBA"]);
      
      // 4. BÚSQUEDA PRIORITARIA: Buscar un código que tenga SÍ o SÍ letras y números (ej. HGB6SE)
      for (const code of matchUni) {
        if (!ignorar.has(code) && /[A-Z]/.test(code) && /[0-9]/.test(code)) {
          return code;
        }
      }
      
      // 5. BÚSQUEDA SECUNDARIA: Si no hay alfanuméricos puros, tomar el primer bloque válido que no sea basura
      for (const code of matchUni) {
        if (!ignorar.has(code)) return code;
      }
    }
    return null; 
  }

  function esValido(c = "") {
    const s = c.replace(/\s/g, "");
    if (basuraAnios.has(s)) return null;
    if (plataforma === "disney" && s.length !== 6) return null;
    if (/^\d{4,6}$/.test(s)) return s;
    return null;
  }

  if (plataforma === "disney") {
    const disneyEsp6 = fuente.match(/\b(\d)\s(\d)\s(\d)\s(\d)\s(\d)\s(\d)\b/g);
    if (disneyEsp6) {
      for (const m of disneyEsp6) { const v = esValido(m); if (v) return v; }
    }
  }

  const match6 = fuente.match(/(?<!\d)(\d{6})(?!\d)/g);
  if (match6) {
    for (const c of match6) { const v = esValido(c); if (v) return v; }
  }

  const match4 = fuente.match(/(?<!\d)(\d{4})(?!\d)/g);
  if (match4) {
    for (const c of match4) { const v = esValido(c); if (v) return v; }
  }

  return null;
}

// Links de reset de contraseña/correo
function extraerLink(text="", html="") {
  const fuentes = [html, text].filter(Boolean);
  const pats = [
    /https:\/\/www\.netflix\.com\/password[^\s"<>\]&]+(?:&amp;|&)[^\s"<>\]]*/i,
    /https:\/\/www\.netflix\.com\/password[^\s"<>\]]+/i,
    /https:\/\/www\.netflix\.com\/[^\s"<>\]]*reset[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*netflix[^\s"<>\]]*password[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*disneyplus[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*disney[^\s"<>\]]*account[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*hbomax[^\s"<>\]]*(?:reset|password|account|verify)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*max\.com[^\s"<>\]]*(?:reset|password|account|verify|email)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*paramount[^\s"<>\]]*(?:reset|password|account|verify|login|signin)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*cbsinteractive[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*viacomcbs[^\s"<>\]]*(?:reset|password|account)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*universal[^\s"<>\]]*(?:reset|password|account|verify)[^\s"<>\]]*/i,
  ];
  for (const f of fuentes) {
    for (const p of pats) {
      const m = f.match(p);
      if (m?.[0]) {
        let url = m[0].replace(/&amp;/g,"&").replace(/["\s>]+$/,"").trim();
        try { url = decodeURIComponent(url.replace(/\+/g," ")); } catch(_) {}
        return url;
      }
    }
  }
  return null;
}

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
      const m1 = html.match(/>\s*([0-9]{4})\s*</);
      if (m1 && m1[1]) return m1[1];
    }
  } catch(e) {}
  return null;
}

// ===============================
// LECTURA IMAP
// ===============================
async function buscarEmails(correo, limite=15) {
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
      const desde=new Date(); desde.setDate(desde.getDate()-2);
      let uids = [];
      try { uids = await client.search({body: correoBuscar, since: desde}); } catch(_) {}
      
      if(!uids || !uids.length) { uids = await client.search({since: desde}); }
      if(!uids || !uids.length) return [];

      const ids = uids.slice(-Math.min(uids.length, 50));

      for await(const msg of client.fetch(ids, {source:true})){
        try{
          const p = await simpleParser(msg.source);
          const bodyText = String(p.text||"").toLowerCase();
          const bodyHtml = String(p.html||"").toLowerCase();
          const subj     = String(p.subject||"").toLowerCase();
          const toAddr   = (p.to?.text||"").toLowerCase();
          const allText  = bodyText + " " + bodyHtml + " " + subj + " " + toAddr;

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

  return emails.sort((a,b) => new Date(b.date) - new Date(a.date));
}

// ===============================
// COMANDOS
// ===============================

/** /code — Netflix, Disney+, o Universal+ */
async function cmdCode(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /code correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      const fromL = e.from.toLowerCase();
      const subjL = e.subject.toLowerCase();
      
      const isNetflix   = fromL.includes("netflix");
      const isDisney    = !isNetflix && (fromL.includes("disney") || subjL.includes("disney"));
      const isUniversal = !isNetflix && !isDisney && esUniversal(e.from, e.subject);

      if (isNetflix) {
        if (subjL.includes("acceso temporal") || subjL.includes("código de acceso") || subjL.includes("temporal")) {
          const linkWeb = extraerLinkObtenerCodigo(e.html);
          if (linkWeb) {
            const codigoWeb = await scrapearCodigoWeb(linkWeb);
            if (codigoWeb) {
              return bot.sendMessage(chatId, `🎬 *CÓDIGO NETFLIX TEMPORAL*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigoWeb}\`\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`, {parse_mode:"Markdown"});
            } else {
              return bot.sendMessage(chatId, `🎬 *CÓDIGO NETFLIX TEMPORAL*\n\n📧 *Correo:* ${escMD(correo)}\n⚠️ *El código está dentro del enlace:*`, {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"🔑 Ver código temporal", url:linkWeb}]]}});
            }
          }
          continue; 
        }

        if (subjL.includes("hogar") || subjL.includes("household") || subjL.includes("extra member")) {
           return bot.sendMessage(chatId, `🏠 *NETFLIX HOGAR*\n\n📧 *Correo:* ${escMD(correo)}\n⚠️ Este es un correo de Hogar. Use el comando /hogar o revise los enlaces de reset.`, {parse_mode:"Markdown"});
        }

        if (subjL.includes("inicio de sesi") || subjL.includes("verificaci") || subjL.includes("confirmaci") || subjL.includes("seguridad")) {
          const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "netflix");
          if (codigo) {
            return bot.sendMessage(chatId, `🎬 *CÓDIGO NETFLIX*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`, {parse_mode:"Markdown"});
          }
        }
        
      } else if (isDisney) {
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "disney");
        if (codigo) {
          return bot.sendMessage(chatId, `🏰 *CÓDIGO DISNEY+*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`, {parse_mode:"Markdown"});
        }
      } else if (isUniversal) {
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "universal");
        if (codigo) {
          return bot.sendMessage(chatId, `🌎 *CÓDIGO UNIVERSAL+*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`, {parse_mode:"Markdown"});
        }
      }
    }
    return bot.sendMessage(chatId,`⚠️ Sin código reciente para *${escMD(correo)}*`,{parse_mode:"Markdown"});

  }catch(e){ logErr("cmdCode",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
}

/** /link — Reset de contraseña */
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
      const isU  = esUniversal(e.from, e.subject);
      if(!isN && !isD && !isH && !isP && !isU) continue;

      const link = extraerLink(e.text, e.html);
      if(!link) continue;

      const fromL = e.from.toLowerCase();
      const isReallyNetflix = isN || fromL.includes("netflix");
      const isReallyDisney  = !isReallyNetflix && (isD || fromL.includes("disney"));
      const isReallyPrime   = !isReallyNetflix && !isReallyDisney && (fromL.includes("amazon")||fromL.includes("prime"));
      const isReallyParamount = !isReallyNetflix && !isReallyDisney && !isReallyPrime && (isP || fromL.includes("paramount"));
      const isReallyUniversal = !isReallyNetflix && !isReallyDisney && !isReallyPrime && !isReallyParamount && (isU || fromL.includes("universal"));
      
      const plat  = isReallyNetflix ? "NETFLIX" : isReallyDisney ? "DISNEY+" : isReallyParamount ? "PARAMOUNT+" : isReallyUniversal ? "UNIVERSAL+" : "HBO MAX";
      const emoji = isReallyNetflix ? "🎬" : isReallyDisney ? "🏰" : isReallyParamount ? "💿" : isReallyUniversal ? "🌎" : "🎞️";

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

      let codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "netflix");
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
      const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "otro");

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

  bot.onText(/^\/code\s+(\S+)/i,       async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdCode(msg.chat.id,  normalizarCorreo(m[1])); });
  bot.onText(/^\/link\s+(\S+)/i,       async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdLink(msg.chat.id,  normalizarCorreo(m[1])); });
  bot.onText(/^\/hogar\s+(\S+)/i,      async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdHogar(msg.chat.id, normalizarCorreo(m[1])); });
  bot.onText(/^\/prime\s+(\S+)/i,      async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdPrime(msg.chat.id, normalizarCorreo(m[1])); });
  bot.onText(/^\/inbox\s+(\S+)/i,      async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdInbox(msg.chat.id, normalizarCorreo(m[1])); });

  console.log("✅ Módulo IMAP cargado v15 — /code (Universal Alfanumérico Blindado) /link /hogar /prime /inbox");
}

module.exports = { cmdCode, cmdLink, cmdHogar, cmdPrime, cmdInbox };
