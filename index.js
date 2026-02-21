const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const http = require("http");

// ===============================
// ENV CHECK
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
console.log("✅ SUBLICUENTAS BOT ONLINE");

// ===============================
// ADMIN CHECK
// ===============================
async function isAdmin(userId) {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data()?.activo === true;
}

// ===============================
// CONFIG (totales_plataforma)
// ===============================
async function getTotal(plataformaKey) {
  const doc = await db.collection("config").doc("totales_plataforma").get();
  return doc.exists ? (doc.data()?.[plataformaKey] ?? null) : null;
}

// ===============================
// LISTAR PLATAFORMA (solo activas con disp>=1)
// ===============================
async function listar(chatId, plataformaKey, titulo) {
  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", plataformaKey)
    .where("estado", "==", "activa")
    .where("disp", ">=", 1)
    .get();

  if (snap.empty) return bot.sendMessage(chatId, `❌ Sin cuentas ${titulo}`);

  const totalMax = await getTotal(plataformaKey);

  let txt = `📺 ${titulo}\n\n`;
  let suma = 0;
  let i = 1;

  snap.forEach((doc) => {
    const d = doc.data();
    txt += `${i}) 📧 ${d.correo}\n👤 ${Number(d.disp || 0)} libres${totalMax ? `/${totalMax}` : ""}\n\n`;
    suma += Number(d.disp || 0);
    i++;
  });

  txt += `🔥 Perfiles disponibles: ${suma}`;
  return bot.sendMessage(chatId, txt);
}

// ===============================
// STOCK GENERAL (suma de disp por plataforma)
// ===============================
async function stockGeneral(chatId) {
  const plataformas = [
    ["netflix", "NETFLIX"],
    ["disneyp", "DISNEY PREMIUM"],
    ["disneys", "DISNEY STANDARD"],
    ["hbomax", "HBO MAX"],
    ["primevideo", "PRIME VIDEO"],
    ["paramount", "PARAMOUNT+"],
    ["crunchyroll", "CRUNCHYROLL"],
  ];

  let txt = "📊 STOCK GENERAL\n\n";

  for (const [key, label] of plataformas) {
    const snap = await db
      .collection("inventario")
      .where("plataforma", "==", key)
      .where("estado", "==", "activa")
      .where("disp", ">=", 1)
      .get();

    let suma = 0;
    snap.forEach((d) => (suma += Number(d.data().disp || 0)));

    txt += `🎬 ${label} → ${suma} perfiles\n`;
  }

  return bot.sendMessage(chatId, txt);
}

// ===============================
// VENTA / AUTO (elige cuenta con más disp)
// - descuenta 1
// - alerta en 1
// - auto-bloqueo en 0 (estado=agotada)
// ===============================
async function procesarVenta(chatId, plataformaKey) {
  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", plataformaKey)
    .where("estado", "==", "activa")
    .where("disp", ">=", 1)
    .orderBy("disp", "desc")
    .limit(1)
    .get();

  if (snap.empty) {
    return bot.sendMessage(chatId, `⚠️ ${plataformaKey.toUpperCase()} SIN STOCK`);
  }

  const doc = snap.docs[0];
  const data = doc.data();

  let nuevo = Number(data.disp || 0) - 1;
  let estado = "activa";

  if (nuevo <= 0) {
    nuevo = 0;
    estado = "agotada";
  }

  await doc.ref.update({
    disp: nuevo,
    estado,
    updatedAt: new Date(),
  });

  const totalMax = await getTotal(plataformaKey);

  let txt =
`🎟 ENTREGA AUTOMATICA

📌 ${plataformaKey.toUpperCase()}
📧 ${data.correo}
👤 Disponible ahora: ${nuevo}${totalMax ? `/${totalMax}` : ""}`;

  if (nuevo === 1) txt += `\n⚠️ ALERTA: solo queda 1 perfil`;
  if (nuevo === 0) txt += `\n⛔ AGOTADA: cuenta bloqueada automaticamente`;

  return bot.sendMessage(chatId, txt);
}

// ===============================
// START / HELP
// ===============================
function panelText() {
  return (
`✅ PANEL SUBLICUENTAS

📦 LISTADOS:
/netflix /disneyp /disneys
/hbomax /primevideo /paramount /crunchyroll

📊 GENERAL:
/stock
/menu

⚡ VENTAS:
/auto netflix
/venta netflix

⚙️ ADMIN:
/add correo plataforma disp
/addp correo
/delp correo`
  );
}

bot.onText(/^\/start$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return bot.sendMessage(msg.chat.id, panelText());
});

bot.onText(/^\/help$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return bot.sendMessage(msg.chat.id, panelText());
});

// ===============================
// LISTADOS POR PLATAFORMA
// ===============================
bot.onText(/^\/netflix$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return listar(msg.chat.id, "netflix", "NETFLIX");
});

bot.onText(/^\/disneyp$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return listar(msg.chat.id, "disneyp", "DISNEY PREMIUM");
});

bot.onText(/^\/disneys$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return listar(msg.chat.id, "disneys", "DISNEY STANDARD");
});

bot.onText(/^\/hbomax$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return listar(msg.chat.id, "hbomax", "HBO MAX");
});

bot.onText(/^\/primevideo$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return listar(msg.chat.id, "primevideo", "PRIME VIDEO");
});

bot.onText(/^\/paramount$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return listar(msg.chat.id, "paramount", "PARAMOUNT+");
});

bot.onText(/^\/crunchyroll$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return listar(msg.chat.id, "crunchyroll", "CRUNCHYROLL");
});

// ===============================
// STOCK GENERAL
// ===============================
bot.onText(/^\/stock$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return stockGeneral(msg.chat.id);
});

// ===============================
// AUTO / VENTA
// ===============================
bot.onText(/^\/auto\s+(.+)$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  const plataforma = String(match[1] || "").trim().toLowerCase();
  return procesarVenta(msg.chat.id, plataforma);
});

bot.onText(/^\/venta\s+(.+)$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  const plataforma = String(match[1] || "").trim().toLowerCase();
  return procesarVenta(msg.chat.id, plataforma);
});

// ===============================
// ADD CUENTA
// /add correo netflix 5
// ===============================
bot.onText(/^\/add\s+(\S+)\s+(\S+)\s+(\d+)(?:\s+(\S+))?$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();
  const plataforma = String(match[2] || "").trim().toLowerCase();
  const disp = Number(match[3] || 0);
  const estado = String(match[4] || "activa").trim().toLowerCase();

  if (!correo.includes("@")) {
    return bot.sendMessage(msg.chat.id, "❌ Correo invalido. Ej: /add correo@gmail.com netflix 5");
  }

  await db.collection("inventario").add({
    correo,
    plataforma,
    disp,
    estado,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const totalMax = await getTotal(plataforma);

  return bot.sendMessage(
    msg.chat.id,
    `✅ Agregada\n📌 ${plataforma.toUpperCase()}\n📧 ${correo}\n👤 ${disp}${totalMax ? `/${totalMax}` : ""}\n🟢 Estado: ${estado}`
  );
});

// ===============================
// ADDP (resta 1 + alerta + auto-bloqueo)
// ===============================
bot.onText(/^\/addp\s+(\S+)$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();

  const snap = await db.collection("inventario").where("correo", "==", correo).limit(1).get();
  if (snap.empty) return bot.sendMessage(msg.chat.id, "⚠️ Correo no encontrado");

  const doc = snap.docs[0];
  const d = doc.data();

  let nuevo = Number(d.disp || 0) - 1;
  let estado = "activa";
  if (nuevo <= 0) {
    nuevo = 0;
    estado = "agotada";
  }

  await doc.ref.update({ disp: nuevo, estado, updatedAt: new Date() });

  const totalMax = await getTotal(d.plataforma);

  let txt =
`➖ Perfil descontado
📌 ${String(d.plataforma).toUpperCase()}
📧 ${correo}
👤 ${nuevo}${totalMax ? `/${totalMax}` : ""}`;

  if (nuevo === 1) txt += `\n⚠️ ALERTA: solo queda 1 perfil`;
  if (nuevo === 0) txt += `\n⛔ AGOTADA: bloqueada automaticamente`;

  return bot.sendMessage(msg.chat.id, txt);
});

// ===============================
// DELP (suma 1 + reactiva)
// ===============================
bot.onText(/^\/delp\s+(\S+)$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");

  const correo = String(match[1] || "").trim().toLowerCase();

  const snap = await db.collection("inventario").where("correo", "==", correo).limit(1).get();
  if (snap.empty) return bot.sendMessage(msg.chat.id, "⚠️ Correo no encontrado");

  const doc = snap.docs[0];
  const d = doc.data();

  const nuevo = Number(d.disp || 0) + 1;

  await doc.ref.update({
    disp: nuevo,
    estado: "activa", // ✅ reactiva SIEMPRE
    updatedAt: new Date(),
  });

  const totalMax = await getTotal(d.plataforma);

  return bot.sendMessage(
    msg.chat.id,
    `➕ Perfil liberado\n📌 ${String(d.plataforma).toUpperCase()}\n📧 ${correo}\n👤 ${nuevo}${totalMax ? `/${totalMax}` : ""}\n✅ Estado: activa`
  );
});

// ===============================
// MENU INTERACTIVO (/menu)
// ===============================
bot.onText(/^\/menu$/i, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");

  return bot.sendMessage(msg.chat.id, "📊 PANEL SUBLICUENTAS", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📺 Netflix", callback_data: "list_netflix" },
          { text: "🎬 Disney Premium", callback_data: "list_disneyp" },
        ],
        [
          { text: "🎞 Disney Standard", callback_data: "list_disneys" },
          { text: "🍿 HBO Max", callback_data: "list_hbomax" },
        ],
        [
          { text: "🎥 Prime Video", callback_data: "list_primevideo" },
          { text: "📀 Paramount+", callback_data: "list_paramount" },
        ],
        [{ text: "🍥 Crunchyroll", callback_data: "list_crunchyroll" }],
        [{ text: "📦 Stock General", callback_data: "stock_general" }],
        [
          { text: "⚡ Auto Netflix", callback_data: "auto_netflix" },
          { text: "⚡ Auto DisneyP", callback_data: "auto_disneyp" },
        ],
        [
          { text: "⚡ Auto HBO", callback_data: "auto_hbomax" },
          { text: "⚡ Auto Prime", callback_data: "auto_primevideo" },
        ],
      ],
    },
  });
});

// ===============================
// BOTONES (callback_query)
// ===============================
bot.on("callback_query", async (q) => {
  try {
    const chatId = q.message.chat.id;

    // seguridad: también validamos admin en botones
    if (!(await isAdmin(q.from.id))) {
      await bot.answerCallbackQuery(q.id, { text: "Acceso denegado", show_alert: true });
      return;
    }

    const data = q.data;

    // Listados
    if (data === "list_netflix") await listar(chatId, "netflix", "NETFLIX");
    if (data === "list_disneyp") await listar(chatId, "disneyp", "DISNEY PREMIUM");
    if (data === "list_disneys") await listar(chatId, "disneys", "DISNEY STANDARD");
    if (data === "list_hbomax") await listar(chatId, "hbomax", "HBO MAX");
    if (data === "list_primevideo") await listar(chatId, "primevideo", "PRIME VIDEO");
    if (data === "list_paramount") await listar(chatId, "paramount", "PARAMOUNT+");
    if (data === "list_crunchyroll") await listar(chatId, "crunchyroll", "CRUNCHYROLL");

    // Stock general
    if (data === "stock_general") await stockGeneral(chatId);

    // Auto entrega
    if (data === "auto_netflix") await procesarVenta(chatId, "netflix");
    if (data === "auto_disneyp") await procesarVenta(chatId, "disneyp");
    if (data === "auto_hbomax") await procesarVenta(chatId, "hbomax");
    if (data === "auto_primevideo") await procesarVenta(chatId, "primevideo");

    await bot.answerCallbackQuery(q.id);
  } catch (e) {
    console.error("callback_query error:", e);
    try {
      await bot.answerCallbackQuery(q.id, { text: "Error", show_alert: true });
    } catch {}
  }
});

// ===============================
// KEEP ALIVE (Render Web Service)
// ===============================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, "0.0.0.0", () => console.log("🌐 Listening on " + PORT));

setInterval(() => console.log("🟢 Bot activo..."), 60000);
