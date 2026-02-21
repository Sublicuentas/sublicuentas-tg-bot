const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

// ===============================
// VARIABLES DE ENTORNO (Render)
// ===============================
const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;

if (!BOT_TOKEN) {
  throw new Error("Falta BOT_TOKEN");
}

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
const bot = new TelegramBot(BOT_TOKEN, {
  polling: true,
});

console.log("✅ Bot iniciado");

// ===============================
// VALIDAR ADMIN
// ===============================
async function isAdmin(userId) {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data().activo === true;
}

// ===============================
// /START
// ===============================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

  bot.sendMessage(chatId, "✅ Bot Sublicuentas activo");
});

// ===============================
// /NETFLIX STOCK
// ===============================
bot.onText(/\/netflix/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

  const config = await db
    .collection("config")
    .doc("totales_plataforma")
    .get();

  const total = config.data().netflix;

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", "netflix")
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) {
    return bot.sendMessage(
      chatId,
      "⚠️ NETFLIX SIN PERFILES DISPONIBLES"
    );
  }

  let texto = "📌 NETFLIX — STOCK DISPONIBLE\n\n";
  let suma = 0;
  let i = 1;

  snap.forEach((doc) => {
    const d = doc.data();
    texto += `${i}) ${d.correo} — ${d.disp}/${total}\n`;
    suma += d.disp;
    i++;
  });

  texto += `\n━━━━━━━━━━━━━━`;
  texto += `\n📊 Cuentas con stock: ${i - 1}`;
  texto += `\n👤 Perfiles libres totales: ${suma}`;

  bot.sendMessage(chatId, texto);
});

// ===============================
// KEEP ALIVE (Render)
// ===============================
setInterval(() => {
  console.log("🟢 Bot activo...");
}, 60000);

setInterval(() => {
  console.log("Bot activo...");
}, 60000);

// ===============================
// SERVIDOR FALSO PARA RENDER
// ===============================
const http = require("http");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot Sublicuentas activo");
}).listen(PORT, () => {
  console.log("🌐 Web service activo en puerto " + PORT);
});
