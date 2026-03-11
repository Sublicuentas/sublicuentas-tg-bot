const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const admin = require("firebase-admin");

// ===============================
// ENV / FIREBASE
// ===============================
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;
const TZ = process.env.TZ || "America/Tegucigalpa";

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error("Faltan variables FIREBASE_*");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: String(FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

// ===============================
// CARGA AUTOMÁTICA CUENTAS IMAP
// ===============================
function loadImapAccounts(max = 30) {
  const arr = [];

  for (let i = 1; i <= max; i++) {
    const user = process.env[`IMAP_USER_${i}`];
    const pass = process.env[`IMAP_PASS_${i}`];
    const host = process.env[`IMAP_HOST_${i}`];
    const alias = process.env[`IMAP_ALIAS_${i}`] || `imap_${i}`;
    const source = process.env[`IMAP_SOURCE_${i}`] || "gmail";
    const port = Number(process.env[`IMAP_PORT_${i}`] || 993);
    const secure = String(process.env[`IMAP_SECURE_${i}`] || "true") === "true";

    if (!user || !pass || !host) continue;

    arr.push({
      alias,
      source,
      host,
      port,
      secure,
      user,
      pass,
    });
  }

  return arr;
}

const IMAP_ACCOUNTS = loadImapAccounts(30);
console.log(`📬 Cuentas IMAP cargadas: ${IMAP_ACCOUNTS.length}`);

// ===============================
// HELPERS
// ===============================
function norm(s = "") {
  return String(s || "").toLowerCase().trim();
}

function cleanText(s = "") {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function detectNetflixEmail(parsed) {
  const fromText = norm(parsed.from?.text || "");
  const subject = norm(parsed.subject || "");
  const text = norm(parsed.text || "");
  const html = norm(parsed.html || "");
  const joined = `${fromText} ${subject} ${text} ${html}`;

  return (
    joined.includes("netflix") ||
    fromText.includes("info@account.netflix.com") ||
    fromText.includes("netflix")
  );
}

function detectarTipoCorreo(subject = "", body = "") {
  const s = norm(subject);
  const b = norm(body);

  if (
    s.includes("inicio de sesión") ||
    b.includes("ingresa este código para iniciar sesión") ||
    b.includes("tu código de inicio de sesión")
  ) {
    return "signin";
  }

  if (
    s.includes("acceso temporal") ||
    b.includes("código de acceso temporal") ||
    b.includes("tu código de acceso temporal")
  ) {
    return "temporal";
  }

  if (
    s.includes("verificación") ||
    b.includes("confirma el cambio en tu cuenta con este código") ||
    b.includes("tu código de verificación")
  ) {
    return "verification";
  }

  if (
    b.includes("obtener código") ||
    b.includes("solicitud desde") ||
    b.includes("smart tv") ||
    b.includes("código hogar") ||
    s.includes("hogar")
  ) {
    return "hogar";
  }

  return null;
}

function extraerCodigo(tipo, subject = "", body = "") {
  const full = `${subject}\n${body}`;

  if (tipo === "signin") {
    const m = full.match(/\b\d{4}\b/);
    return m ? m[0] : null;
  }

  if (tipo === "verification") {
    const m = full.match(/\b\d{6}\b/);
    return m ? m[0] : null;
  }

  if (tipo === "temporal") {
    const m = full.match(/\b\d{4,6}\b/);
    return m ? m[0] : null;
  }

  if (tipo === "hogar") {
    const m = full.match(/\b\d{4,6}\b/);
    return m ? m[0] : null;
  }

  const m = full.match(/\b\d{4,6}\b/);
  return m ? m[0] : null;
}

function obtenerCorreoDestino(parsed) {
  const toValues = parsed.to?.value || [];
  if (toValues.length > 0 && toValues[0]?.address) {
    return norm(toValues[0].address);
  }

  const delivered = parsed.headers?.get?.("delivered-to");
  if (delivered) return norm(delivered);

  const originalTo = parsed.headers?.get?.("x-original-to");
  if (originalTo) return norm(originalTo);

  return "";
}

function makeUniqueId(correo, tipo, codigo, fecha) {
  const base = `${correo}__${tipo}__${codigo}__${fecha}`;
  return Buffer.from(base).toString("base64").replace(/[=+/]/g, "_").slice(0, 180);
}

async function guardarCodigoNetflix(data) {
  const correo = norm(data.correo);
  const tipo = norm(data.tipo);
  const codigo = String(data.codigo || "").trim();
  const fecha = data.fecha || new Date().toISOString();

  if (!correo || !tipo || !codigo) return false;

  const docId = makeUniqueId(correo, tipo, codigo, fecha);
  const ref = db.collection("codigos_netflix").doc(docId);
  const existing = await ref.get();

  if (existing.exists) return false;

  await ref.set(
    {
      correo,
      codigo,
      tipo,
      fecha,
      usado: false,
      fuente: data.fuente || "-",
      alias: data.alias || "-",
      subject: data.subject || "",
      from: data.from || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ Guardado [${tipo}] ${correo} => ${codigo}`);
  return true;
}

// ===============================
// PROCESAMIENTO MENSAJES
// ===============================
async function procesarMensaje(account, msg) {
  try {
    if (!account.client) return;

    const source = await account.client.download(msg.uid);
    const parsed = await simpleParser(source);

    if (!detectNetflixEmail(parsed)) return;

    const subject = cleanText(parsed.subject || "");
    const body = cleanText(parsed.text || parsed.html || "");
    const fromText = cleanText(parsed.from?.text || "");
    const correoDestino = obtenerCorreoDestino(parsed);

    if (!correoDestino) {
      console.log(`⚠️ Sin correo destino [${account.alias}]`);
      return;
    }

    const tipo = detectarTipoCorreo(subject, body);
    if (!tipo) {
      console.log(`⚠️ No clasificado [${account.alias}] ${subject}`);
      return;
    }

    const codigo = extraerCodigo(tipo, subject, body);

    if (!codigo && tipo !== "hogar") {
      console.log(`⚠️ Sin código [${account.alias}] ${correoDestino} | ${tipo}`);
      return;
    }

    await guardarCodigoNetflix({
      correo: correoDestino,
      codigo: codigo || "LINK_ONLY",
      tipo,
      fecha: new Date(msg.internalDate || Date.now()).toISOString(),
      fuente: account.source,
      alias: account.alias,
      subject,
      from: fromText,
    });

    try {
      await account.client.messageFlagsAdd(msg.uid, ["\\Seen"]);
    } catch (e) {
      console.log(`⚠️ No se pudo marcar como leído [${account.alias}] UID=${msg.uid}`);
    }
  } catch (err) {
    console.error(`❌ Error procesando mensaje [${account.alias}]`, err?.message || err);
  }
}

// ===============================
// IMAP CUENTA
// ===============================
async function revisarCuenta(account) {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.user,
      pass: account.pass,
    },
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 90000,
    disableAutoIdle: true,
  });

  account.client = client;

  try {
    await client.connect();
    console.log(`✅ IMAP conectado: ${account.alias}`);

    const lock = await client.getMailboxLock("INBOX");
    try {
      let processed = 0;

      for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true, internalDate: true })) {
        try {
          await procesarMensaje(account, msg);
        } catch (err) {
          console.error(`❌ Error procesando mensaje [${account.alias}]`, err?.message || err);
        }

        processed++;
        if (processed >= 10) break;
      }
    } finally {
      lock.release();
    }

    try {
      await client.logout();
    } catch (_) {}
  } catch (err) {
    console.error(`❌ Error cuenta ${account.alias}:`, err?.message || err);
    try {
      await client.logout();
    } catch (_) {}
  }
}

// ===============================
// CICLO GENERAL
// ===============================
async function cicloGeneral() {
  for (const account of IMAP_ACCOUNTS) {
    await revisarCuenta(account);
  }
}

async function main() {
  console.log("🚀 Netflix Codes Listener iniciado...");
  await cicloGeneral();

  setInterval(async () => {
    try {
      await cicloGeneral();
    } catch (err) {
      console.error("❌ Error en ciclo general:", err?.message || err);
    }
  }, 45000);
}

main().catch((err) => {
  console.error("❌ Error fatal:", err?.message || err);
});
