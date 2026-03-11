const admin = require("firebase-admin");
const { ImapFlow } = require("imapflow");

const db = admin.firestore();
const TZ = process.env.TZ || "America/Tegucigalpa";

function log(...args) {
  console.log(...args);
}

function logErr(...args) {
  console.error(...args);
}

function norm(v = "") {
  return String(v || "").trim();
}

function lower(v = "") {
  return String(v || "").trim().toLowerCase();
}

function boolEnv(v) {
  return String(v || "").toLowerCase() === "true";
}

function buildImapAccountsFromEnv() {
  const accounts = [];
  let i = 1;

  while (true) {
    const alias = process.env[`IMAP_ALIAS_${i}`];
    const host = process.env[`IMAP_HOST_${i}`];
    const port = process.env[`IMAP_PORT_${i}`];
    const secure = process.env[`IMAP_SECURE_${i}`];
    const user = process.env[`IMAP_USER_${i}`];
    const pass = process.env[`IMAP_PASS_${i}`];
    const source = process.env[`IMAP_SOURCE_${i}`];

    if (!alias && !host && !port && !user && !pass) break;

    if (alias && host && port && user && pass) {
      accounts.push({
        idx: i,
        alias: norm(alias),
        host: norm(host),
        port: Number(port),
        secure: boolEnv(secure),
        user: norm(user),
        pass: norm(pass),
        source: lower(source || "imap"),
      });
    }

    i++;
  }

  return accounts;
}

function extraerCodigo(texto = "") {
  const raw = String(texto || "");

  const patrones = [
    /\b(\d{4})\b/g,
    /\b(\d{6})\b/g,
    /code[^0-9]{0,20}(\d{4,8})/gi,
    /codigo[^0-9]{0,20}(\d{4,8})/gi,
    /verification[^0-9]{0,20}(\d{4,8})/gi,
    /confirm[^0-9]{0,20}(\d{4,8})/gi,
    /netflix[^0-9]{0,40}(\d{4,8})/gi,
  ];

  for (const regex of patrones) {
    const matches = [...raw.matchAll(regex)];
    if (matches.length) {
      const last = matches[matches.length - 1];
      const codigo = last?.[1];
      if (codigo) return codigo;
    }
  }

  return null;
}

function detectarTipo(subject = "", body = "") {
  const txt = `${subject}\n${body}`.toLowerCase();

  if (
    txt.includes("temporary access code") ||
    txt.includes("temporary code") ||
    txt.includes("código temporal") ||
    txt.includes("codigo temporal")
  ) {
    return "temporal";
  }

  if (
    txt.includes("verify your device") ||
    txt.includes("verification code") ||
    txt.includes("código de verificación") ||
    txt.includes("codigo de verificacion") ||
    txt.includes("verify it was you")
  ) {
    return "verification";
  }

  if (
    txt.includes("update netflix household") ||
    txt.includes("netflix household") ||
    txt.includes("hogar con netflix") ||
    txt.includes("código de hogar") ||
    txt.includes("codigo de hogar")
  ) {
    return "hogar";
  }

  return "signin";
}

async function guardarCodigo({
  alias,
  correo,
  subject,
  from,
  body,
  tipo,
  codigo,
  uid,
  messageId,
  source,
}) {
  if (!codigo) return false;

  const mail = lower(correo);
  const docId = `${mail}__${tipo}__${Date.now()}`;

  await db.collection("codigos_netflix").doc(docId).set({
    alias: norm(alias),
    correo: mail,
    tipo: norm(tipo),
    codigo: norm(codigo),
    asunto: norm(subject),
    from: norm(from),
    body: String(body || "").slice(0, 4000),
    uid: String(uid || ""),
    messageId: String(messageId || ""),
    fuente: norm(source || "imap"),
    usado: false,
    fecha: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  log(`✅ Código guardado [${alias}] ${mail} | ${tipo} | ${codigo}`);
  return true;
}

async function obtenerTextoMensaje(client, seq) {
  try {
    const msg = await client.fetchOne(seq, {
      uid: true,
      envelope: true,
      source: true,
      bodyStructure: true,
    });

    if (!msg) return null;

    const envelope = msg.envelope || {};
    const from = Array.isArray(envelope.from) && envelope.from.length
      ? `${envelope.from[0].name || ""} <${envelope.from[0].address || ""}>`.trim()
      : "";

    const subject = envelope.subject || "";
    const sourceText = msg.source ? msg.source.toString("utf8") : "";

    return {
      uid: msg.uid,
      messageId: envelope.messageId || "",
      subject,
      from,
      raw: sourceText,
    };
  } catch (e) {
    logErr("❌ Error obteniendo mensaje:", e?.message || e);
    return null;
  }
}

function esCorreoNetflix(subject = "", from = "", raw = "") {
  const txt = `${subject}\n${from}\n${raw}`.toLowerCase();

  return (
    txt.includes("netflix") ||
    txt.includes("info@account.netflix.com") ||
    txt.includes("account.netflix.com") ||
    txt.includes("messages.netflix.com")
  );
}

async function procesarUltimosCorreos(client, account, max = 8) {
  if (!client || client.closed) return;

  let lock = null;

  try {
    lock = await client.getMailboxLock("INBOX");

    const status = await client.status("INBOX", { messages: true });
    const total = Number(status.messages || 0);
    if (!total) return;

    const start = Math.max(1, total - max + 1);

    for (let seq = start; seq <= total; seq++) {
      const info = await obtenerTextoMensaje(client, seq);
      if (!info) continue;

      const subject = info.subject || "";
      const from = info.from || "";
      const raw = info.raw || "";

      if (!esCorreoNetflix(subject, from, raw)) continue;

      const codigo = extraerCodigo(`${subject}\n${raw}`);
      const tipo = detectarTipo(subject, raw);

      if (!codigo) continue;

      await guardarCodigo({
        alias: account.alias,
        correo: account.user,
        subject,
        from,
        body: raw,
        tipo,
        codigo,
        uid: info.uid,
        messageId: info.messageId,
        source: account.source,
      });
    }
  } catch (e) {
    logErr(`❌ Error procesando mensajes [${account.alias}]:`, e?.message || e);
  } finally {
    if (lock) {
      try {
        lock.release();
      } catch (_) {}
    }
  }
}

async function conectarCuenta(account) {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.user,
      pass: account.pass,
    },
    logger: false,
    emitLogs: false,
    disableAutoEnable: true,
    clientInfo: {
      name: "SublicuentasBot",
      version: "1.0.0",
    },
    socketTimeout: 60000,
    greetingTimeout: 30000,
    connectionTimeout: 30000,
  });

  client._sc_alias = account.alias;
  client._sc_user = account.user;

  client.on("error", (err) => {
    logErr(`❌ IMAP event error [${account.alias}]`, err?.message || err);
  });

  client.on("close", () => {
    log(`⚠️ IMAP cerrado [${account.alias}]`);
  });

  await client.connect();
  log(`✅ IMAP conectado: ${account.alias}`);

  return client;
}

async function cicloCuenta(account) {
  let client = null;

  while (true) {
    try {
      client = await conectarCuenta(account);

      await procesarUltimosCorreos(client, account, 10);

      while (client && !client.closed) {
        try {
          await client.noop().catch(() => {});
          await procesarUltimosCorreos(client, account, 4);
        } catch (e) {
          logErr(`❌ Error procesando mensaje [${account.alias}]`, e?.message || e);
        }

        await new Promise((r) => setTimeout(r, 45000));
      }
    } catch (e) {
      logErr(`❌ Error cuenta ${account.alias}:`, e?.message || e);
    } finally {
      if (client && !client.closed) {
        try {
          await client.logout();
        } catch (_) {}
      }
    }

    log(`🔄 Reintentando IMAP [${account.alias}] en 20s...`);
    await new Promise((r) => setTimeout(r, 20000));
  }
}

async function iniciarNetflixListener() {
  const enabled = String(process.env.ENABLE_NETFLIX_LISTENER || "").toLowerCase() === "true";
  if (!enabled) {
    log("⏸️ Netflix listener desactivado por ENV");
    return;
  }

  const accounts = buildImapAccountsFromEnv();
  log(`📬 Cuentas IMAP cargadas: ${accounts.length}`);

  if (!accounts.length) {
    log("⚠️ No hay cuentas IMAP configuradas");
    return;
  }

  log("🚀 Netflix Codes Listener iniciado...");

  for (const acc of accounts) {
    cicloCuenta(acc).catch((e) => {
      logErr(`❌ Fallo ciclo cuenta ${acc.alias}:`, e?.message || e);
    });
  }
}

iniciarNetflixListener().catch((e) => {
  logErr("❌ No se pudo iniciar netflix listener:", e?.message || e);
});
