const admin = require("firebase-admin");
const { ImapFlow } = require("imapflow");

const db = admin.firestore();

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
    /confirma el cambio en tu cuenta con este código[^0-9]{0,80}(\d{6})/i,
    /confirma el cambio en tu cuenta con este código[^0-9]{0,80}(\d{4})/i,
    /ingresa este código para iniciar sesión[^0-9]{0,80}(\d{6})/i,
    /ingresa este código para iniciar sesión[^0-9]{0,80}(\d{4})/i,
    /tu código de acceso temporal de netflix[^0-9]{0,80}(\d{6})/i,
    /tu código de acceso temporal de netflix[^0-9]{0,80}(\d{4})/i,
    /(?:código|codigo|code)[^0-9]{0,40}(\d{6})/i,
    /(?:código|codigo|code)[^0-9]{0,40}(\d{4})/i,
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
  ];

  for (const regex of patrones) {
    const m = raw.match(regex);
    if (m?.[1]) return m[1];
  }

  return null;
}

function extraerCorreoDestino(subject = "", body = "", fallback = "") {
  const txt = `${subject}\n${body}`;

  const mPara = txt.match(/para:\s*([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
  if (mPara?.[1]) return lower(mPara[1]);

  const candidatos = [...txt.matchAll(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi)]
    .map((m) => lower(m[0]))
    .filter(Boolean);

  if (!candidatos.length) return lower(fallback);

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
  if (!limpios.length) return lower(fallback);

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

  const safeMsgId = String(messageId || "").replace(/[^\w.-]+/g, "_").slice(
