const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const http = require("http");

// ===== DEBUG: que SIEMPRE imprima algo =====
console.log("🚀 Arrancando app...");

// Capturar errores reales
process.on("unhandledRejection", (err) => console.error("UNHANDLED:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT:", err));

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;

console.log("🔎 ENV check:", {
  BOT_TOKEN: !!BOT_TOKEN,
  FIREBASE_PROJECT_ID: !!FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: !!FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: !!FIREBASE_PRIVATE_KEY,
});

// Si falta algo, que quede CLARÍSIMO
if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN en Render ENV");
if (!FIREBASE_PROJECT_ID) throw new Error("Falta FIREBASE_PROJECT_ID en Render ENV");
if (!FIREBASE_CLIENT_EMAIL) throw new Error("Falta FIREBASE_CLIENT_EMAIL en Render ENV");
if (!FIREBASE_PRIVATE_KEY) throw new Error("Falta FIREBASE_PRIVATE_KEY en Render ENV");

// ===== Firebase init con try/catch =====
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
  console.log("✅ Firebase Admin inicializado");
} catch (e) {
  console.error("❌ Firebase init falló:", e);
  process.exit(1);
}

const db = admin.firestore();

// ===== Telegram bot =====
let bot;
try {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log("✅ Telegram polling iniciado");
} catch (e) {
  console.error("❌ Telegram init falló:", e);
  process.exit(1);
}

// ===== Admin check =====
async function isAdmin(userId) {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data()?.activo === true;
}

bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");
  bot.sendMessage(chatId, "✅ Bot Sublicuentas activo\nComando: /netflix");
});

bot.onText(/^\/netflix$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) return bot.sendMessage(chatId, "⛔ Acceso denegado");

  const config = await db.collection("config").doc("totales_plataforma").get();
  const total = config.data()?.netflix || 5;

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", "netflix")
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) return bot.sendMessage(chatId, "⚠️ NETFLIX SIN PERFILES DISPONIBLES");

  let texto = "📌 NETFLIX — STOCK DISPONIBLE\n\n";
  let suma = 0;
  let i = 1;

  snap.forEach((doc) => {
    const d = doc.data();
    texto += `${i}) ${d.correo} — ${d.disp}/${total}\n`;
    suma += Number(d.disp || 0);
    i++;
  });

  texto += `\n━━━━━━━━━━━━━━\n📊 Cuentas con stock: ${i - 1}\n👤 Perfiles libres totales: ${suma}`;
  bot.sendMessage(chatId, texto);
});

// ===== Web server para Render =====
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log("🌐 Listening on " + PORT);
  });

// ===== Keep alive log =====
setInterval(() => console.log("🟢 Bot activo..."), 60000);
