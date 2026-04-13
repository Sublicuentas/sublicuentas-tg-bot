/* ✅ SUBLICUENTAS TG BOT — PARTE 7/7
   IMAP — EXTRACTOR DE CÓDIGOS NETFLIX / DISNEY
   ---------------------------------------------
   Comandos:
   /code correo    → código de inicio de sesión
   /link correo    → link de reset de contraseña
   /hogar correo   → código de Netflix Hogar
   /inbox correo   → últimos 5 emails recibidos
*/

const Imap = require("imap");
const { simpleParser } = require("mailparser");

const { bot, SUPER_ADMIN } = require("./index_01_core");
const { isAdmin, logErr, escMD } = require("./index_02_utils_roles");

// ===============================
// CONFIG IMAP
// ===============================
const IMAP_CONFIG = {
  user:     process.env.EMAIL_ADMIN_USER || "admin@sublicuentas.com",
  password: process.env.EMAIL_ADMIN_PASS || "",
  host:     process.env.EMAIL_IMAP_HOST  || "sublicuentas.com",
  port:     Number(process.env.EMAIL_IMAP_PORT || 993),
  tls:      true,
  tlsOptions: { rejectUnauthorized: false },
  authTimeout: 10000,
  connTimeout: 15000,
};

const DOMINIOS_PROPIOS = ["sublicuentas.com", "capuchino.lat", "imitatiko.lat"];

// ===============================
// HELPERS
// ===============================
function esDominioPropioLocal(correo = "") {
  const dominio = String(correo || "").toLowerCase().split("@")[1] || "";
  return DOMINIOS_PROPIOS.some((d) => dominio === d);
}

function normalizarCorreo(correo = "") {
  return String(correo || "").trim().toLowerCase();
}

// ===============================
// CONEXIÓN IMAP
// ===============================
function conectarIMAP() {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
    imap.once("ready", () => resolve(imap));
    imap.once("error", (err) => reject(err));
    imap.once("end", () => {});
    imap.connect();
  });
}

function cerrarIMAP(imap) {
  try { imap.end(); } catch (_) {}
}

// ===============================
// BUSCAR EMAILS POR DESTINATARIO
// ===============================
async function buscarEmailsPorDestinatario(correoDestino, limite = 10) {
  const imap = await conectarIMAP();

  return new Promise((resolve, reject) => {
    imap.openBox("INBOX", true, (err, box) => {
      if (err) { cerrarIMAP(imap); return reject(err); }

      // Buscar emails dirigidos a ese correo en los últimos 7 días
      const fechaDesde = new Date();
      fechaDesde.setDate(fechaDesde.getDate() - 7);
      const fechaStr = fechaDesde.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });

      imap.search([
        ["TO", correoDestino],
        ["SINCE", fechaStr],
      ], (err, uids) => {
        if (err) { cerrarIMAP(imap); return reject(err); }
        if (!uids || !uids.length) { cerrarIMAP(imap); return resolve([]); }

        // Tomar los últimos N
        const idsRecientes = uids.slice(-limite);
        const fetch = imap.fetch(idsRecientes, { bodies: "" });
        const emails = [];

        fetch.on("message", (msg) => {
          let buffer = "";
          msg.on("body", (stream) => {
            stream.on("data", (chunk) => { buffer += chunk.toString("utf8"); });
            stream.once("end", () => {
              simpleParser(buffer).then((parsed) => {
                emails.push({
                  from:    String(parsed.from?.text || ""),
                  to:      String(parsed.to?.text || ""),
                  subject: String(parsed.subject || ""),
                  text:    String(parsed.text || ""),
                  html:    String(parsed.html || ""),
                  date:    parsed.date || new Date(),
                });
              }).catch(() => {});
            });
          });
        });

        fetch.once("error", (err) => { cerrarIMAP(imap); reject(err); });
        fetch.once("end", () => {
          cerrarIMAP(imap);
          setTimeout(() => resolve(emails.reverse()), 500); // más reciente primero
        });
      });
    });
  });
}

// ===============================
// EXTRACTORES DE CÓDIGO
// ===============================
function extraerCodigoNetflix(text = "", html = "") {
  const fuente = text || html.replace(/<[^>]+>/g, " ");

  // Código de 4-8 dígitos en emails de Netflix
  const patrones = [
    /tu c[oó]digo es[:\s]+([A-Z0-9]{4,8})/i,
    /verification code[:\s]+([A-Z0-9]{4,8})/i,
    /c[oó]digo de verificaci[oó]n[:\s]+([A-Z0-9]{4,8})/i,
    /c[oó]digo temporal[:\s]+([A-Z0-9]{4,8})/i,
    /enter this code[:\s]+([A-Z0-9]{4,8})/i,
    /use this code[:\s]+([A-Z0-9]{4,8})/i,
    /\b([A-Z0-9]{6})\b/,  // 6 caracteres alfanuméricos standalone
  ];

  for (const pat of patrones) {
    const match = fuente.match(pat);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extraerCodigoHogar(text = "", html = "") {
  const fuente = text || html.replace(/<[^>]+>/g, " ");

  const patrones = [
    /c[oó]digo de netflix hogar[:\s]+([A-Z0-9]{4,8})/i,
    /hogar con netflix[^]*?c[oó]digo[:\s]+([A-Z0-9]{4,8})/i,
    /extra member[^]*?code[:\s]+([A-Z0-9]{4,8})/i,
    /household[^]*?code[:\s]+([A-Z0-9]{4,8})/i,
  ];

  for (const pat of patrones) {
    const match = fuente.match(pat);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extraerLinkReset(text = "", html = "") {
  const fuente = html || text;

  const patrones = [
    /https:\/\/www\.netflix\.com\/password[^\s"<>]+/i,
    /https:\/\/www\.netflix\.com\/[^\s"<>]*reset[^\s"<>]*/i,
    /https:\/\/[^\s"<>]*netflix[^\s"<>]*password[^\s"<>]*/i,
    /https:\/\/[^\s"<>]*disneyplus[^\s"<>]*reset[^\s"<>]*/i,
    /https:\/\/[^\s"<>]*disney[^\s"<>]*password[^\s"<>]*/i,
  ];

  for (const pat of patrones) {
    const match = fuente.match(pat);
    if (match?.[0]) return match[0].replace(/&amp;/g, "&").trim();
  }
  return null;
}

function esEmailNetflix(from = "", subject = "") {
  const f = from.toLowerCase(); const s = subject.toLowerCase();
  return f.includes("netflix") || s.includes("netflix");
}

function esEmailDisney(from = "", subject = "") {
  const f = from.toLowerCase(); const s = subject.toLowerCase();
  return f.includes("disney") || s.includes("disney");
}

function esEmailHogar(from = "", subject = "") {
  const s = subject.toLowerCase();
  return s.includes("hogar") || s.includes("household") || s.includes("extra member");
}

function formatearFecha(date) {
  try {
    const d = new Date(date);
    return d.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) { return String(date || ""); }
}

// ===============================
// HANDLERS IMAP
// ===============================

// /code correo → código de inicio de sesión Netflix o Disney
async function cmdCode(chatId, correo) {
  if (!correo) return bot.sendMessage(chatId, "⚠️ Uso: /code correo@dominio.com");

  await bot.sendMessage(chatId, `🔍 Buscando código para *${escMD(correo)}*...`, { parse_mode: "Markdown" });

  try {
    const emails = await buscarEmailsPorDestinatario(correo, 20);

    if (!emails.length) {
      return bot.sendMessage(chatId, `📭 No se encontraron emails recientes para *${escMD(correo)}*\n\n_Revisa que el correo esté correcto o espera a que llegue el email._`, { parse_mode: "Markdown" });
    }

    // Buscar código en emails de Netflix o Disney
    for (const email of emails) {
      if (!esEmailNetflix(email.from, email.subject) && !esEmailDisney(email.from, email.subject)) continue;

      const codigo = extraerCodigoNetflix(email.text, email.html);
      if (!codigo) continue;

      const servicio = esEmailNetflix(email.from, email.subject) ? "Netflix" : "Disney+";
      const emoji = servicio === "Netflix" ? "🎬" : "🏰";

      return bot.sendMessage(chatId,
        `${emoji} *CÓDIGO ${servicio.toUpperCase()}*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `🔑 *Código:* \`${codigo}\`\n` +
        `📨 *Asunto:* ${escMD(email.subject)}\n` +
        `🕐 *Fecha:* ${escMD(formatearFecha(email.date))}`,
        { parse_mode: "Markdown" }
      );
    }

    return bot.sendMessage(chatId,
      `⚠️ No se encontró código en los últimos emails de *${escMD(correo)}*\n\n` +
      `📧 Se revisaron *${emails.length}* emails recientes.\n` +
      `_Espera a que llegue el email de verificación._`,
      { parse_mode: "Markdown" }
    );

  } catch (e) {
    logErr("cmdCode", e);
    return bot.sendMessage(chatId, `❌ Error al conectar al correo: ${escMD(e?.message || "Error desconocido")}`, { parse_mode: "Markdown" });
  }
}

// /link correo → link de reset de contraseña
async function cmdLink(chatId, correo) {
  if (!correo) return bot.sendMessage(chatId, "⚠️ Uso: /link correo@dominio.com");

  await bot.sendMessage(chatId, `🔍 Buscando link de reset para *${escMD(correo)}*...`, { parse_mode: "Markdown" });

  try {
    const emails = await buscarEmailsPorDestinatario(correo, 20);

    if (!emails.length) {
      return bot.sendMessage(chatId, `📭 No se encontraron emails recientes para *${escMD(correo)}*`, { parse_mode: "Markdown" });
    }

    for (const email of emails) {
      if (!esEmailNetflix(email.from, email.subject) && !esEmailDisney(email.from, email.subject)) continue;

      const link = extraerLinkReset(email.text, email.html);
      if (!link) continue;

      const servicio = esEmailNetflix(email.from, email.subject) ? "Netflix" : "Disney+";
      const emoji = servicio === "Netflix" ? "🎬" : "🏰";

      return bot.sendMessage(chatId,
        `${emoji} *LINK RESET ${servicio.toUpperCase()}*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `📨 *Asunto:* ${escMD(email.subject)}\n` +
        `🕐 *Fecha:* ${escMD(formatearFecha(email.date))}\n\n` +
        `🔗 *Link:*\n${link}`,
        { parse_mode: "Markdown", disable_web_page_preview: true }
      );
    }

    return bot.sendMessage(chatId,
      `⚠️ No se encontró link de reset para *${escMD(correo)}*\n_Solicita el reset de contraseña primero._`,
      { parse_mode: "Markdown" }
    );

  } catch (e) {
    logErr("cmdLink", e);
    return bot.sendMessage(chatId, `❌ Error: ${escMD(e?.message || "Error desconocido")}`, { parse_mode: "Markdown" });
  }
}

// /hogar correo → código de Netflix Hogar
async function cmdHogar(chatId, correo) {
  if (!correo) return bot.sendMessage(chatId, "⚠️ Uso: /hogar correo@dominio.com");

  await bot.sendMessage(chatId, `🔍 Buscando código de hogar para *${escMD(correo)}*...`, { parse_mode: "Markdown" });

  try {
    const emails = await buscarEmailsPorDestinatario(correo, 20);

    if (!emails.length) {
      return bot.sendMessage(chatId, `📭 No se encontraron emails recientes para *${escMD(correo)}*`, { parse_mode: "Markdown" });
    }

    for (const email of emails) {
      if (!esEmailNetflix(email.from, email.subject)) continue;
      if (!esEmailHogar(email.from, email.subject) &&
          !email.text.toLowerCase().includes("hogar") &&
          !email.text.toLowerCase().includes("household")) continue;

      const codigo = extraerCodigoHogar(email.text, email.html) || extraerCodigoNetflix(email.text, email.html);
      if (!codigo) continue;

      return bot.sendMessage(chatId,
        `🏠 *CÓDIGO NETFLIX HOGAR*\n\n` +
        `📧 *Correo:* ${escMD(correo)}\n` +
        `🔑 *Código:* \`${codigo}\`\n` +
        `📨 *Asunto:* ${escMD(email.subject)}\n` +
        `🕐 *Fecha:* ${escMD(formatearFecha(email.date))}`,
        { parse_mode: "Markdown" }
      );
    }

    return bot.sendMessage(chatId,
      `⚠️ No se encontró código de hogar para *${escMD(correo)}*\n_Espera a que el cliente reenvíe el código de Netflix Hogar._`,
      { parse_mode: "Markdown" }
    );

  } catch (e) {
    logErr("cmdHogar", e);
    return bot.sendMessage(chatId, `❌ Error: ${escMD(e?.message || "Error desconocido")}`, { parse_mode: "Markdown" });
  }
}

// /inbox correo → últimos emails recibidos
async function cmdInbox(chatId, correo) {
  if (!correo) return bot.sendMessage(chatId, "⚠️ Uso: /inbox correo@dominio.com");

  await bot.sendMessage(chatId, `📬 Revisando inbox de *${escMD(correo)}*...`, { parse_mode: "Markdown" });

  try {
    const emails = await buscarEmailsPorDestinatario(correo, 5);

    if (!emails.length) {
      return bot.sendMessage(chatId, `📭 No se encontraron emails recientes para *${escMD(correo)}*`, { parse_mode: "Markdown" });
    }

    let txt = `📬 *ÚLTIMOS EMAILS*\n📧 ${escMD(correo)}\n\n`;
    emails.forEach((e, i) => {
      txt += `*${i+1}.* ${escMD(e.subject || "(sin asunto)")}\n`;
      txt += `   📨 ${escMD(e.from)}\n`;
      txt += `   🕐 ${escMD(formatearFecha(e.date))}\n\n`;
    });

    return bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });

  } catch (e) {
    logErr("cmdInbox", e);
    return bot.sendMessage(chatId, `❌ Error: ${escMD(e?.message || "Error desconocido")}`, { parse_mode: "Markdown" });
  }
}

// ===============================
// REGISTRO DE COMANDOS
// ===============================
if (!global.__SUBLICUENTAS_IMAP_READY__) {
  global.__SUBLICUENTAS_IMAP_READY__ = true;

  bot.onText(/^\/code\s+(\S+)/i, async (msg, match) => {
    const chatId = msg.chat.id; const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return cmdCode(chatId, normalizarCorreo(match[1]));
  });

  bot.onText(/^\/link\s+(\S+)/i, async (msg, match) => {
    const chatId = msg.chat.id; const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return cmdLink(chatId, normalizarCorreo(match[1]));
  });

  bot.onText(/^\/hogar\s+(\S+)/i, async (msg, match) => {
    const chatId = msg.chat.id; const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return cmdHogar(chatId, normalizarCorreo(match[1]));
  });

  bot.onText(/^\/inbox\s+(\S+)/i, async (msg, match) => {
    const chatId = msg.chat.id; const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    return cmdInbox(chatId, normalizarCorreo(match[1]));
  });

  // Comando de prueba de conexión IMAP
  bot.onText(/^\/imap_test$/i, async (msg) => {
    const chatId = msg.chat.id; const userId = msg.from.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
    try {
      await bot.sendMessage(chatId, "🔌 Probando conexión IMAP...");
      const imap = await conectarIMAP();
      cerrarIMAP(imap);
      return bot.sendMessage(chatId, "✅ Conexión IMAP exitosa con `" + IMAP_CONFIG.user + "`", { parse_mode: "Markdown" });
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Error de conexión IMAP:\n${e?.message || e}`, { parse_mode: "Markdown" });
    }
  });

  console.log("✅ Módulo IMAP cargado — /code /link /hogar /inbox /imap_test");
}

module.exports = { cmdCode, cmdLink, cmdHogar, cmdInbox };
