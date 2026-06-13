/* ✅ SUBLICUENTAS TG BOT — PARTE 7/7 v16
   IMAP — CÓDIGOS Y LINKS: NETFLIX / DISNEY / HBO / PRIME / VIX / UNIVERSAL
   ----------------------------------------------------------------
   ✅ CAMBIOS v16:
   - NUEVO: esVix() — detecta emails de Vix
   - NUEVO: /code ahora extrae códigos de HBO Max (4 dígitos) y Vix
   - NUEVO: /code ahora extrae códigos de Prime Video (ya no solo /prime)
   - NUEVO: /link ahora incluye links de Vix (login, cambio correo, clave)
   - FIX: /hogar ahora también devuelve link de confirmación de hogar Netflix
   - FIX: extraerLink incluye patrones de Vix
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

function esVix(from="",subject=""){
  const f=from.toLowerCase(); const s=subject.toLowerCase();
  return f.includes("vix.com")||f.includes("@vix")||f.includes("vix@")||
         s.includes("vix.com")||
         (s.includes("vix") && (s.includes("acceso")||s.includes("verifica")||
          s.includes("código")||s.includes("codigo")||s.includes("correo")||
          s.includes("contrase")||s.includes("login")||s.includes("inicio")));
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

  const subjL = String(subject || "").toLowerCase();

  // ✅ Netflix "inicio de sesión" y "acceso temporal" usan 4 dígitos — buscar 4 primero
  const netflixPide4 = plataforma === "netflix" && (
    subjL.includes("inicio de sesi") ||
    subjL.includes("acceso temporal") ||
    subjL.includes("ingresa este c") ||
    subjL.includes("code to sign in") ||
    subjL.includes("sign-in code")
  );

  // ✅ Netflix "verificación" y "confirmación" usan 6 dígitos
  const netflixPide6 = plataforma === "netflix" && (
    subjL.includes("verificaci") ||
    subjL.includes("confirmaci") ||
    subjL.includes("código de verif")
  );

  if (netflixPide4) {
    // Buscar 4 dígitos primero, ignorar 6 dígitos
    const match4 = fuente.match(/(?<!\d)(\d{4})(?!\d)/g);
    if (match4) {
      for (const c of match4) { const v = esValido(c); if (v) return v; }
    }
    return null;
  }

  if (netflixPide6) {
    // Buscar 6 dígitos primero
    const match6 = fuente.match(/(?<!\d)(\d{6})(?!\d)/g);
    if (match6) {
      for (const c of match6) { const v = esValido(c); if (v) return v; }
    }
    // Fallback a 4
    const match4 = fuente.match(/(?<!\d)(\d{4})(?!\d)/g);
    if (match4) {
      for (const c of match4) { const v = esValido(c); if (v) return v; }
    }
    return null;
  }

  // Para otras plataformas y Netflix genérico: probar 4 dígitos cerca de palabras clave primero
  // luego 6, luego 4 general
  const match4cerca = fuente.match(/(?:código|code|clave|pin)[^\d]{0,20}(\d{4})(?!\d)/gi);
  if (match4cerca) {
    for (const m of match4cerca) {
      const nums = m.match(/\d{4}/);
      if (nums) { const v = esValido(nums[0]); if (v) return v; }
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
    // Vix
    /https:\/\/[^\s"<>\]]*vix\.com[^\s"<>\]]*(?:reset|password|account|verify|email|confirm)[^\s"<>\]]*/i,
    /https:\/\/[^\s"<>\]]*vix[^\s"<>\]]*(?:reset|password|cuenta|correo|verificar|confirmar)[^\s"<>\]]*/i,
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
// LECTURA IMAP — sin SEARCH para compatibilidad con cPanel
// ===============================
async function buscarEmails(correo, limite=15) {
  const correoBuscar = String(correo||"").trim().toLowerCase();

  const client = new ImapFlow({
    host:IMAP_HOST, port:IMAP_PORT, secure:true,
    auth:{user:IMAP_USER, pass:IMAP_PASS},
    logger:{
      debug: (obj) => console.log("[IMAP DBG]", obj?.msg || JSON.stringify(obj).slice(0,120)),
      info:  (obj) => console.log("[IMAP INF]", obj?.msg || ""),
      warn:  (obj) => console.warn("[IMAP WRN]", obj?.msg || ""),
      error: (obj) => console.error("[IMAP ERR]", obj?.msg || ""),
    },
    tls:{rejectUnauthorized:false},
  });

  await client.connect();
  const emails = [];

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = client.mailbox?.exists || 0;
      if (!total) return [];

      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 3);

      // ✅ Paso 1: traer solo headers de los últimos 50 mensajes (liviano)
      const inicio = total;
      const fin    = Math.max(1, total - 49);
      const rango  = `${fin}:${inicio}`;

      // ✅ Paso 1: traer envelope con internalDate — guardar seq + fecha exacta del servidor
      const candidatos = []; // { seq, internalDate }
      for await (const msg of client.fetch(rango, { envelope: true, internalDate: true })) {
        try {
          const fecha = msg.internalDate ? new Date(msg.internalDate) : new Date(0);
          if (fecha < fechaLimite) continue;

          const fromStr = String(msg.envelope?.from?.[0]?.address || msg.envelope?.from?.[0]?.name || "").toLowerCase();
          const subjStr = String(msg.envelope?.subject || "").toLowerCase();

          const esPlatConocida =
            fromStr.includes("netflix") || fromStr.includes("disney") ||
            fromStr.includes("hbo") || fromStr.includes("max.com") ||
            fromStr.includes("amazon") || fromStr.includes("primevideo") ||
            fromStr.includes("paramount") || fromStr.includes("vix") ||
            fromStr.includes("universal") || fromStr.includes("crunchyroll") ||
            subjStr.includes("netflix") || subjStr.includes("disney") ||
            subjStr.includes("hbo") || subjStr.includes("amazon") ||
            subjStr.includes("código") || subjStr.includes("codigo") ||
            subjStr.includes("verifica") || subjStr.includes("acceso") ||
            subjStr.includes("contrase") || subjStr.includes("restablec");

          if (esPlatConocida) candidatos.push({ seq: msg.seq, ts: fecha.getTime() });
        } catch(_) {}
      }

      // ✅ Ordenar candidatos: más reciente primero (por internalDate del servidor)
      candidatos.sort((a, b) => b.ts - a.ts);

      // ✅ Paso 2: descargar source solo de candidatos, del más reciente al más viejo
      for (const { seq } of candidatos) {
        if (emails.length >= limite) break;
        try {
          const data = await client.fetchOne(String(seq), { source: true });
          if (!data?.source) continue;

          const p = await simpleParser(data.source);

          const bodyText = String(p.text    || "").toLowerCase();
          const bodyHtml = String(p.html    || "").toLowerCase();
          const subj     = String(p.subject || "").toLowerCase();
          const toAddr   = (p.to?.text      || "").toLowerCase();
          const allText  = bodyText + " " + bodyHtml + " " + subj + " " + toAddr;

          if (!allText.includes(correoBuscar)) continue;

          emails.push({
            from:    String(p.from?.text || ""),
            subject: String(p.subject   || ""),
            text:    String(p.text      || ""),
            html:    String(p.html      || ""),
            date:    p.date || new Date(),
            ts:      candidatos.find(x => x.seq === seq)?.ts || 0,
          });
        } catch(_) {}
      }
    } finally { lock.release(); }
  } catch(err) {
    console.error("[IMAP buscarEmails] Error:", err?.message || err);
    throw err;
  } finally {
    try { await client.logout(); } catch(_) {}
  }

  // Más reciente primero
  // Ordenar por timestamp del servidor (más preciso que p.date)
  return emails.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// ===============================
// COMANDOS
// ===============================

/** /code — Netflix (4/6 dig), Disney+ (6), HBO Max (4), Prime Video (6), Vix, Universal+ */
async function cmdCode(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /code correo@dominio.com");
  try{
    const emails = await buscarEmails(correo);
    if(!emails.length) return bot.sendMessage(chatId,`📬 Sin emails recientes para *${escMD(correo)}*`,{parse_mode:"Markdown"});

    for(const e of emails){
      const fromL = e.from.toLowerCase();
      const subjL = e.subject.toLowerCase();

      // ── NETFLIX ──────────────────────────────────────
      if(fromL.includes("netflix") || esNetflix(e.from, e.subject)) {
        if(subjL.includes("restablecimiento")||subjL.includes("contrase")||subjL.includes("cambio")) continue;
        if(subjL.includes("acceso temporal")||subjL.includes("codigo de acceso")||subjL.includes("temporal")) {
          const linkWeb = extraerLinkObtenerCodigo(e.html);
          if(linkWeb) {
            const codigoWeb = await scrapearCodigoWeb(linkWeb);
            if(codigoWeb) return bot.sendMessage(chatId,`🎬 *CÓDIGO NETFLIX TEMPORAL*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigoWeb}\`\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
            return bot.sendMessage(chatId,`🎬 *CÓDIGO NETFLIX TEMPORAL*\n\n📧 *Correo:* ${escMD(correo)}\n⚠️ El código está dentro del enlace:`,{parse_mode:"Markdown",reply_markup:{inline_keyboard:[[{text:"🔑 Ver código temporal",url:linkWeb}]]}});
          }
          continue;
        }
        if(subjL.includes("hogar")||subjL.includes("household")||subjL.includes("extra member")) {
          return bot.sendMessage(chatId,`🏠 *NETFLIX HOGAR*\n\n📧 *Correo:* ${escMD(correo)}\n⚠️ Usa el comando /hogar para este correo.`,{parse_mode:"Markdown"});
        }
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "netflix");
        if(codigo) return bot.sendMessage(chatId,`🎬 *CÓDIGO NETFLIX*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }

      // ── DISNEY+ — 6 dígitos en todos los casos ───────
      if(esDisney(e.from, e.subject)) {
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "disney");
        if(codigo) return bot.sendMessage(chatId,`🏰 *CÓDIGO DISNEY+*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }

      // ── HBO MAX — 4 dígitos ───────────────────────────
      if(esHBO(e.from, e.subject)) {
        if(subjL.includes("restablecimiento")||subjL.includes("reset")||subjL.includes("contrase")||subjL.includes("cambio de correo")) continue;
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "otro");
        if(codigo) return bot.sendMessage(chatId,`🎞️ *CÓDIGO HBO MAX*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }

      // ── PRIME VIDEO — 6 dígitos ───────────────────────
      if(esPrime(e.from, e.subject)) {
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "otro");
        if(codigo) return bot.sendMessage(chatId,`🎥 *CÓDIGO PRIME VIDEO*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }

      // ── VIX — código o link ───────────────────────────
      if(esVix(e.from, e.subject)) {
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "otro");
        if(codigo) return bot.sendMessage(chatId,`📱 *CÓDIGO VIX*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        const link = extraerLink(e.text, e.html);
        if(link) return bot.sendMessage(chatId,`📱 *LINK VIX*\n\n📧 *Correo:* ${escMD(correo)}\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\nToca el botón:`,{parse_mode:"Markdown",reply_markup:{inline_keyboard:[[{text:"📱 Abrir link Vix",url:link}]]}});
        continue;
      }

      // ── UNIVERSAL+ — código alfanumérico ─────────────
      if(esUniversal(e.from, e.subject)) {
        const codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "universal");
        if(codigo) return bot.sendMessage(chatId,`🌎 *CÓDIGO UNIVERSAL+*\n\n📧 *Correo:* ${escMD(correo)}\n🔑 *Código:* \`${codigo}\`\n📨 *Asunto:* ${escMD(e.subject)}\n🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,{parse_mode:"Markdown"});
        continue;
      }
    }
    return bot.sendMessage(chatId,`⚠️ Sin código reciente para *${escMD(correo)}*`,{parse_mode:"Markdown"});
  }catch(e){ logErr("cmdCode",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
}

/** /debug — temporal: ver texto crudo del email para diagnosticar extracción de código */
async function cmdDebug(chatId, correo){
  if(!correo) return bot.sendMessage(chatId,"⚠️ Uso: /debug correo@dominio.com");
  try{
    const emails = await buscarEmails(correo, 3);
    if(!emails.length) return bot.sendMessage(chatId,"📬 Sin emails.");

    for (let i = 0; i < emails.length; i++) {
      const e = emails[i];
      const text = String(e.text || "").replace(/\s+/g, " ").trim();
      const html = String(e.html || "").replace(/\s+/g, " ").trim();

      // Buscar todos los números de 6 y 4 dígitos en text y html
      const nums6text = (text.match(/(?<!\d)\d{6}(?!\d)/g) || []);
      const nums6html = (html.match(/(?<!\d)\d{6}(?!\d)/g) || []);
      const nums4text = (text.match(/(?<!\d)\d{4}(?!\d)/g) || []);

      let msg = `📧 *Email ${i+1}*\n`;
      msg += `Asunto: ${escMD(e.subject)}\n`;
      msg += `Fecha: ${escMD(formatearFecha(e.date))}\n\n`;
      msg += `*6 dígitos en TEXT:* ${nums6text.join(", ") || "ninguno"}\n`;
      msg += `*6 dígitos en HTML:* ${nums6html.slice(0,15).join(", ") || "ninguno"}\n`;
      msg += `*4 dígitos en TEXT:* ${nums4text.join(", ") || "ninguno"}\n\n`;
      msg += `*TEXT (primeros 600 char):*\n\\`${escMD(text.slice(0,600))}\\``;

      await bot.sendMessage(chatId, msg, {parse_mode:"Markdown"});
    }
  }catch(e){ logErr("cmdDebug",e); return bot.sendMessage(chatId,`❌ Error: ${escMD(e?.message||"IMAP error")}`,{parse_mode:"Markdown"}); }
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
      const isV  = esVix(e.from, e.subject);
      if(!isN && !isD && !isH && !isP && !isU && !isV) continue;

      const link = extraerLink(e.text, e.html);
      if(!link) continue;

      const fromL = e.from.toLowerCase();
      const isReallyNetflix = isN || fromL.includes("netflix");
      const isReallyDisney  = !isReallyNetflix && (isD || fromL.includes("disney"));
      const isReallyPrime   = !isReallyNetflix && !isReallyDisney && (fromL.includes("amazon")||fromL.includes("prime"));
      const isReallyParamount = !isReallyNetflix && !isReallyDisney && !isReallyPrime && (isP || fromL.includes("paramount"));
      const isReallyUniversal = !isReallyNetflix && !isReallyDisney && !isReallyPrime && !isReallyParamount && (isU || fromL.includes("universal"));
      
      const isReallyVix = !isReallyNetflix && !isReallyDisney && !isReallyPrime && !isReallyParamount && !isReallyUniversal && (isV || fromL.includes("vix"));
      const plat  = isReallyNetflix ? "NETFLIX" : isReallyDisney ? "DISNEY+" : isReallyParamount ? "PARAMOUNT+" : isReallyUniversal ? "UNIVERSAL+" : isReallyVix ? "VIX" : "HBO MAX";
      const emoji = isReallyNetflix ? "🎬" : isReallyDisney ? "🏰" : isReallyParamount ? "💿" : isReallyUniversal ? "🌎" : isReallyVix ? "📱" : "🎞️";

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
      if(!esNetflix(e.from,e.subject)) continue;
      if(!esHogar(e.subject,e.text)) continue;

      let codigo = extraerCodigoInteligente(e.text, e.subject, e.html, "netflix");
      let linkWeb = extraerLinkObtenerCodigo(e.html);

      // Intentar sacar el código del link web si no vino en el texto
      if(!codigo && linkWeb) codigo = await scrapearCodigoWeb(linkWeb);

      if(codigo) return bot.sendMessage(chatId,
        `🏠 *CÓDIGO NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `🔑 *Código:* \`${codigo}\`\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}`,
        {parse_mode:"Markdown"}
      );

      // Si hay link de confirmación de hogar (Netflix a veces solo manda link)
      if(linkWeb) return bot.sendMessage(chatId,
        `🏠 *CONFIRMAR NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `📨 *Asunto:* ${escMD(e.subject)}\n` +
        `🕒 *Fecha:* ${escMD(formatearFecha(e.date))}\n\nToca el botón para confirmar:`,
        {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"🏠 Confirmar Hogar Netflix", url:linkWeb}]]}}
      );

      // Link de reset de hogar como fallback
      const linkReset = extraerLink(e.text, e.html);
      if(linkReset) return bot.sendMessage(chatId,
        `🏠 *LINK NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `📨 *Asunto:* ${escMD(e.subject)}`,
        {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"🏠 Abrir Link Hogar", url:linkReset}]]}}
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
// ✅ Limpiar _textRegexpCallbacks — array interno donde onText guarda los handlers
// bot.removeListener no funciona para onText, hay que limpiar el array directo
try {
  if (Array.isArray(bot._textRegexpCallbacks)) {
    bot._textRegexpCallbacks = bot._textRegexpCallbacks.filter(item => {
      const reg = item.regexp ? item.regexp.toString() : "";
      return !(
        reg.includes("\/code") || reg.includes("\/link") ||
        reg.includes("\/hogar") || reg.includes("\/prime") || reg.includes("\/inbox")
      );
    });
    console.log("✅ IMAP: handlers viejos eliminados, registrando nuevos...");
  }
} catch(e) { console.error("IMAP cleanup error:", e?.message); }

// Handlers IMAP — comandos de extracción de códigos
const _imapCodeHandler  = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdCode(msg.chat.id,  normalizarCorreo(m[1])); };
const _imapLinkHandler  = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdLink(msg.chat.id,  normalizarCorreo(m[1])); };
const _imapHogarHandler = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdHogar(msg.chat.id, normalizarCorreo(m[1])); };
const _imapPrimeHandler = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdPrime(msg.chat.id, normalizarCorreo(m[1])); };
const _imapInboxHandler = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdInbox(msg.chat.id, normalizarCorreo(m[1])); };
const _imapDebugHandler = async(msg,m)=>{ if(await isAdmin(msg.from.id)) return cmdDebug(msg.chat.id, normalizarCorreo(m[1])); };

bot.onText(/^\/code\s+(\S+)/i,  _imapCodeHandler);
bot.onText(/^\/link\s+(\S+)/i,  _imapLinkHandler);
bot.onText(/^\/hogar\s+(\S+)/i, _imapHogarHandler);
bot.onText(/^\/prime\s+(\S+)/i, _imapPrimeHandler);
bot.onText(/^\/inbox\s+(\S+)/i, _imapInboxHandler);
bot.onText(/^\/debug\s+(\S+)/i, _imapDebugHandler);

console.log("✅ Módulo IMAP v16 cargado — /code /link /hogar /prime /inbox");

module.exports = { cmdCode, cmdLink, cmdHogar, cmdPrime, cmdInbox };
