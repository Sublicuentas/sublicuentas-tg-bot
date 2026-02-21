const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

async function isAdmin(userId) {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data().activo === true;
}

bot.onText(/\/netflix/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ Acceso denegado");
  }

  const config = await db.collection("config").doc("totales_plataforma").get();
  const total = config.data().netflix;

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", "netflix")
    .where("disp", ">=", 1)
    .get();

  if (snap.empty) {
    return bot.sendMessage(chatId, "⚠️ Netflix sin perfiles disponibles");
  }

  let texto = "📌 NETFLIX — STOCK DISPONIBLE\n\n";
  let suma = 0;
  let i = 1;

  snap.forEach(doc => {
    const d = doc.data();
    texto += `${i}) ${d.correo} — ${d.disp}/${total}\n`;
    suma += d.disp;
    i++;
  });

  texto += `\n📊 Cuentas con stock: ${i-1}`;
  texto += `\n👤 Perfiles libres totales: ${suma}`;

  bot.sendMessage(chatId, texto);
});

bot.onText(/\/start/, (msg)=>{
  bot.sendMessage(msg.chat.id,"✅ Bot Sublicuentas activo");
});
