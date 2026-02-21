const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const http = require("http");

// ===============================
// LOGS DE ERRORES
// ===============================
process.on("unhandledRejection", (err) => console.error("UNHANDLED:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT:", err));

// ===============================
// VARIABLES DE ENTORNO (Render)
// ===============================
const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;

if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN");
if (!FIREBASE_PROJECT_ID) throw new Error("Falta FIREBASE_PROJECT_ID");
if (!FIREBASE_CLIENT_EMAIL) throw new Error("Falta FIREBASE_CLIENT_EMAIL");
if (!FIREBASE_PRIVATE_KEY) throw new Error("Falta FIREBASE_PRIVATE_KEY");

// ===============================
// FIREBASE INIT
// ===============================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const db = admin.firestore();

// ===============================
// TELEGRAM BOT
// ===============================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("✅ Bot iniciado");

// ===============================
// MAPA DE PLATAFORMAS (COMANDO -> KEY/LABEL)
// (Estos keys deben existir en Firestore: inventario.plataforma y config.totales_plataforma)
// ===============================
const PLATFORMS = {
  netflix: { key: "netflix", label: "NETFLIX" },
  disneyp: { key: "disneyp", label: "DISNEY PREMIUM" },
  disneys: { key: "disneys", label: "DISNEY STANDARD" },
  hbo: { key: "hbo", label: "HBO" },
  prime: { key: "prime", label: "PRIME VIDEO" },
  paramount: { key: "paramount", label: "PARAMOUNT+" },
  crunchy: { key: "crunchy", label: "CRUNCHYROLL" },
};

// ===============================
// VALIDAR ADMIN
// ===============================
async function isAdmin(userId) {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data()?.activo === true;
}

async function requireAdmin(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  const ok = await isAdmin(userId);
  if (!ok) await bot.sendMessage(chatId, "⛔ Acceso denegado");
  return ok;
}

// ===============================
// MENÚ (TEXTO + TECLADO)
// ===============================
function menuText() {
  return (
    "✅ Bot Sublicuentas activo\n\n" +
    "📦 STOCK:\n" +
    "/netflix\n/disneyp\n/disneys\n/hbo\n/prime\n/paramount\n/crunchy\n\n" +
    "⚙️ INVENTARIO:\n" +
    "/addp correo@gmail.com  (resta 1)\n" +
    "/delp correo@gmail.com  (suma 1)\n\n" +
    "Tip: también puedes usar los botones del teclado 👇"
  );
}

function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ["📦 Netflix", "📦 Disney Premium", "📦 Disney Standard"],
        ["📦 HBO", "📦 Prime", "📦 Paramount+"],
        ["📦 Crunchyroll", "➖ Restar perfil", "➕ Sumar perfil"],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

// ===============================
// /START y /HELP
// ===============================
bot.onText(/^\/start$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  await bot.sendMessage(msg.chat.id, menuText(), mainKeyboard());
});

bot.onText(/^\/help$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  await bot.sendMessage(msg.chat.id, menuText(), mainKeyboard());
});

// ===============================
// CONFIG (totales por plataforma)
// ===============================
async function getTotals() {
  const cfg = await db.collection("config").doc("totales_plataforma").get();
  if (!cfg.exists) throw new Error("Falta config/totales_plataforma");
  return cfg.data() || {};
}

// ===============================
// STOCK GENÉRICO
// ===============================
async function sendStock(chatId, platKey, label) {
  const totals = await getTotals();
  const total = Number(totals[platKey] ?? 0);

  if (!total) {
    return bot.sendMessage(
      chatId,
      `⚠️ No está configurado el total para: ${label}\nRevise: config/totales_plataforma → ${platKey}`
    );
  }

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", platKey)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) {
    return bot.sendMessage(chatId, `⚠️ ${label} SIN PERFILES DISPONIBLES`);
  }

  let texto = `📌 ${label} — STOCK DISPONIBLE\n\n`;
  let suma = 0;
  let i = 1;

  snap.forEach((doc) => {
    const d = doc.data();
    texto += `${i}) ${d.correo} — ${d.disp}/${total}\n`;
    suma += Number(d.disp || 0);
    i++;
  });

  texto += `\n━━━━━━━━━━━━━━`;
  texto += `\n📊 Cuentas con stock: ${i - 1}`;
  texto += `\n👤 Perfiles libres totales: ${suma}`;

  return bot.sendMessage(chatId, texto);
}

// ===============================
// COMANDOS DE STOCK
// ===============================
Object.keys(PLATFORMS).forEach((cmd) => {
  bot.onText(new RegExp(`^\\/${cmd}$`, "i"), async (msg) => {
    if (!(await requireAdmin(msg))) return;
    const chatId = msg.chat.id;
    const { key, label } = PLATFORMS[cmd];
    await sendStock(chatId, key, label);
  });
});

// ===============================
// BOTONES DEL TECLADO (sin /)
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  // evitar responder a mensajes que son comandos
  if ((msg.text || "").startsWith("/")) return;

  if (!(await isAdmin(userId))) return;

  const t = (msg.text || "").trim();

  if (t === "📦 Netflix") return sendStock(chatId, "netflix", "NETFLIX");
  if (t === "📦 Disney Premium") return sendStock(chatId, "disneyp", "DISNEY PREMIUM");
  if (t === "📦 Disney Standard") return sendStock(chatId, "disneys", "DISNEY STANDARD");
  if (t === "📦 HBO") return sendStock(chatId, "hbo", "HBO");
  if (t === "📦 Prime") return sendStock(chatId, "prime", "PRIME VIDEO");
  if (t === "📦 Paramount+") return sendStock(chatId, "paramount", "PARAMOUNT+");
  if (t === "📦 Crunchyroll") return sendStock(chatId, "crunchy", "CRUNCHYROLL");

  if (t === "➖ Restar perfil") {
    return bot.sendMessage(chatId, "Use: /addp correo@gmail.com");
  }
  if (t === "➕ Sumar perfil") {
    return bot.sendMessage(chatId, "Use: /delp correo@gmail.com");
  }
});

// ===============================
// addp / delp (inventario)
// ===============================
function parseEmailArg(text) {
  const parts = String(text || "").trim().split(/\s+/);
  if (parts.length < 2) return null;
  return parts[1].trim().toLowerCase();
}

async function updateDispByEmail(chatId, email, delta) {
  const emailNorm = email.toLowerCase();

  const q = await db.collection("inventario").where("correo", "==", emailNorm).limit(1).get();
  if (q.empty) {
    return bot.sendMessage(chatId, `❌ No encontré ese correo en inventario:\n${emailNorm}`);
  }

  const ref = q.docs[0].ref;

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const d = doc.data();

    const platKey = d.plataforma;
    const totals = await getTotals();
    const total = Number(totals[platKey] ?? 0);
    if (!total) throw new Error(`No hay total configurado para plataforma: ${platKey}`);

    const current = Number(d.disp ?? 0);
    let next = current + delta;

    if (next < 0) next = 0;
    if (next > total) next = total;

    tx.update(ref, {
      disp: next,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  const done = await ref.get();
  const d2 = done.data();
  const totals = await getTotals();
  const total = Number(totals[d2.plataforma] ?? 0);

  const label =
    Object.values(PLATFORMS).find((p) => p.key === d2.plataforma)?.label || d2.plataforma;

  return bot.sendMessage(
    chatId,
    `✅ Actualizado\n📌 ${label}\n📧 ${d2.correo}\n👤 Disponibles: ${d2.disp}/${total}`
  );
}

bot.onText(/^\/addp(\s+.+)?$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;
  const email = parseEmailArg(msg.text);

  if (!email) return bot.sendMessage(chatId, "Uso: /addp correo@gmail.com");

  // addp = resta 1
  await updateDispByEmail(chatId, email, -1);
});

bot.onText(/^\/delp(\s+.+)?$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;
  const email = parseEmailArg(msg.text);

  if (!email) return bot.sendMessage(chatId, "Uso: /delp correo@gmail.com");

  // delp = suma 1
  await updateDispByEmail(chatId, email, +1);
});

// ===============================
// SERVIDOR HTTP PARA RENDER
// ===============================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, "0.0.0.0", () => console.log("🌐 Listening on " + PORT));

// Keep alive log
setInterval(() => console.log("🟢 Bot activo..."), 60000);
