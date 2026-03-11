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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    /(?:código|codigo|code)[^0-9]{0,25}(\d{6})/gi,
    /(?:código|codigo|code)[^0-9]{0,25}(\d{4})/gi,
    /(?:verificación|verificacion|verification|confirma el cambio)[^0-9]{0,35}(\d{6})/gi,
    /(?:verificación|verificacion|verification|confirma el cambio)[^0-9]{0,35}(\d{4})/gi,
    /(?:inicio de sesión|inicio de sesion|iniciar sesión|iniciar sesion|sign in|sign-in)[^0-9]{0,35}(\d{6})/gi,
    /(?:inicio de sesión|inicio de sesion|iniciar sesión|iniciar sesion|sign in|sign-in)[^0-9]{0,35}(\d{4})/gi,
    /(?:acceso temporal|temporary access|temporary code)[^0-9]{0,35}(\d{6})/gi,
    /(?:acceso temporal|temporary access|temporary code)[^0-9]{0,35}(\d{4})/gi,
    /\b(\d{6})\b/g,
    /\b(\d{4})\b/g,
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

function extraerCorreoDestino(subject = "", body = "", fallback = "") {
  const txt = `${subject}\n${body}`;

  const mPara = txt.match(/para:\s*([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
  if (mPara?.[1]) {
    return String(mPara[1]).trim().toLowerCase();
  }

  const candidatos = [...txt.matchAll(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi)]
    .map((m) => String(m[0] || "").trim().toLowerCase())
    .filter(Boolean);

  if (!candidatos.length) {
    return String(fallback || "").trim().toLowerCase();
  }

  const ignorar = new Set([
    "info@account.netflix.com",
    "account@netflix.com",
    "no-reply@netflix.com",
    "noreply@netflix.com",
    "support@netflix.com",
    "privacy@netflix.com",
    lower(fallback),
  ]);

  const limpios = candidatos.filter((x) => !ignorar.has(x));

  if (!limpios.length) {
    return String(fallback || "").trim().toLowerCase();
  }

  return limpios[0];
}

function detectarTipo(subject = "", body = "") {
  const txt = `${subject}\n${body}`.toLowerCase();

  if (
    txt.includes("acceso temporal") ||
    txt.includes("temporary access code") ||
    txt.includes("temporary code")
  ) {
    return "temporal";
  }

  if (
    txt.includes("código de verificación") ||
    txt.includes("codigo de verificacion") ||
    txt.includes("verification code") ||
    txt.includes("confirma el cambio") ||
    txt.includes("confirm the change") ||
    txt.includes("verify your device") ||
    txt.includes("verify it was you")
  ) {
    return "verification";
  }

  if (
    txt.includes("inicio de sesión") ||
    txt.includes("inicio de sesion") ||
    txt.includes("iniciar sesión") ||
    txt.includes("iniciar sesion") ||
    txt.includes("tu código de inicio de sesión") ||
    txt.includes("tu codigo de inicio de sesion") ||
    txt.includes("sign-in code") ||
    txt.includes("sign in code")
  ) {
    return "signin";
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

function esCorreoNetflix(subject = "", from = "", raw = "") {
  const txt = `${subject}\n${from}\n${raw}`.toLowerCase();

  return (
    txt.includes("netflix") ||
    txt.includes("info@account.netflix.com") ||
    txt.includes("account.netflix.com") ||
    txt.includes("messages.netflix.com")
  );
}

async function yaExisteCodigo({ correo, tipo, codigo, messageId, uid }) {
  const mail = lower(correo);
  const cod = norm(codigo);
  const kind = norm(tipo);

  if (messageId) {
    const byMsg = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .where("messageId", "==", String(messageId))
      .limit(1)
      .get();

    if (!byMsg.empty) return true;
  }

  if (uid) {
    const byUid = await db
      .collection("codigos_netflix")
      .where("correo", "==", mail)
      .where("uid", "==", String(uid))
      .limit(1)
      .get();

    if (!byUid.empty) return true;
  }

  const byCode = await db
    .collection("codigos_netflix")
    .where("correo", "==", mail)
    .where("tipo", "==", kind)
    .where("codigo", "==", cod)
    .limit(1)
    .get();

  return !byCode.empty;
}

async function guardarCodigo({
  alias,
  correo,
  correoRaiz,
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
  const raiz = lower(correoRaiz);

  const existe = await yaExisteCodigo({
    correo: mail,
    tipo,
    codigo,
    messageId,
    uid,
  });

  if (existe) {
    log(`ℹ️ Código repetido omitido [${alias}] ${mail} | ${tipo} | ${codigo}`);
    return false;
  }

  const safeMsgId = String(messageId || "").replace(/[^\w.-]+/g, "_").slice(0, 120);
  const safeUid = String(uid || "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const docId =
    `${mail}__${norm(tipo)}__${safeUid || Date.now()}__${safeMsgId || Date.now()}`
      .replace(/[\/#?[\]]+/g, "_")
      .slice(0, 300);

  await db.collection("codigos_netflix").doc(docId).set({
    alias: norm(alias),
    correo: mail,
    correoRaiz: raiz,
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

  log(`✅ Código guardado [${alias}] destino=${mail} raiz=${raiz} | ${tipo} | ${codigo}`);
  return true;
}

async function obtenerMensajePorUid(client, uid) {
  try {
    const msg = await client.fetchOne(String(uid), {
      uid: true,
      envelope: true,
      source: true,
    });

    if (!msg) return null;

    const envelope = msg.envelope || {};
    const from = Array.isArray(envelope.from) && envelope.from.length
      ? `${envelope.from[0].name || ""} <${envelope.from[0].address || ""}>`.trim()
      : "";

    return {
      uid: msg.uid,
      messageId: envelope.messageId || "",
      subject: envelope.subject || "",
      from,
      raw: msg.source ? msg.source.toString("utf8") : "",
    };
  } catch (e) {
    logErr("❌ Error obteniendo mensaje:", e?.message || e);
    return null;
  }
}

async function getLastUid(alias) {
  const ref = db.collection("config").doc(`netflix_listener_${alias}`);
  const doc = await ref.get();
  if (!doc.exists) return 0;
  return Number(doc.data()?.lastUid || 0);
}

async function setLastUid(alias, uid) {
  const ref = db.collection("config").doc(`netflix_listener_${alias}`);
  await ref.set(
    {
      lastUid: Number(uid || 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function procesarCorreosNuevos(client, account, maxBackfill = 10) {
  if (!client || client.closed) return;

  let lock = null;

  try {
    lock = await client.getMailboxLock("INBOX");

    const status = await client.status("INBOX", { uidNext: true, messages: true });
    const uidNext = Number(status.uidNext || 0);
    const total = Number(status.messages || 0);

    if (!uidNext || !total) return;

    let lastUid = await getLastUid(account.alias);

    if (!lastUid || lastUid <= 0) {
      lastUid = Math.max(0, uidNext - maxBackfill - 1);
    }

    const startUid = Math.max(1, lastUid + 1);
    const endUid = Math.max(startUid, uidNext - 1);

    if (startUid > endUid) return;

    let maxUidProcesado = lastUid;

    for await (const item of client.fetch(`${startUid}:${endUid}`, { uid: true })) {
      const uid = Number(item.uid || 0);
      if (!uid) continue;

      const info = await obtenerMensajePorUid(client, uid);
      if (!info) continue;

      const subject = info.subject || "";
      const from = info.from || "";
      const raw = info.raw || "";

      if (!esCorreoNetflix(subject, from, raw)) {
        if (uid > maxUidProcesado) maxUidProcesado = uid;
        continue;
      }

      const codigo = extraerCodigo(`${subject}\n${raw}`);
      const tipo = detectarTipo(subject, raw);
      const correoDestino = extraerCorreoDestino(subject, raw, account.user);

      if (codigo) {
        await guardarCodigo({
          alias: account.alias,
          correo: correoDestino,
          correoRaiz: account.user,
          subject,
          from,
          body: raw,
          tipo,
          codigo,
          uid: info.uid,
          messageId: info.messageId,
          source: account.source,
        });
      } else {
        log(`ℹ️ Correo Netflix sin código detectable [${account.alias}] destino=${correoDestino} asunto=${subject}`);
      }

      if (uid > maxUidProcesado) maxUidProcesado = uid;
    }

    if (maxUidProcesado > lastUid) {
      await setLastUid(account.alias, maxUidProcesado);
    }
  } catch (e) {
    logErr(`❌ Error procesando mensajes [${account.alias}]:`, e?.message || e);
    throw e;
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
    authTimeout: 30000,
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
  while (true) {
    let client = null;

    try {
      client = await conectarCuenta(account);

      await procesarCorreosNuevos(client, account, 10);

      while (client && !client.closed) {
        try {
          await client.noop();
          await procesarCorreosNuevos(client, account, 5);
        } catch (e) {
          logErr(`❌ Error cuenta ${account.alias}:`, e?.message || e);
          break;
        }

        await sleep(45000);
      }
    } catch (e) {
      logErr(`❌ Error cuenta ${account.alias}:`, e?.message || e);
    } finally {
      if (client) {
        try {
          await client.logout().catch(() => {});
        } catch (_) {}
      }
    }

    log(`🔄 Reintentando IMAP [${account.alias}] en 20s...`);
    await sleep(20000);
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
