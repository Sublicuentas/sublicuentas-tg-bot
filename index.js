const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const http = require("http");

// ===============================
// VARIABLES DE ENTORNO
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
// PLATAFORMAS (IGUAL A FIREBASE)
// (cmd -> inventario.plataforma key)
// ===============================
const PLATFORMS = {
  netflix: { key: "netflix", label: "NETFLIX" },
  disneyp: { key: "disneyp", label: "DISNEY PREMIUM" },
  disneys: { key: "disneys", label: "DISNEY STANDARD" },
  hbo: { key: "hbomax", label: "HBO MAX" },
  prime: { key: "primevideo", label: "PRIME VIDEO" },
  paramount: { key: "paramount", label: "PARAMOUNT+" },
  crunchy: { key: "crunchyroll", label: "CRUNCHYROLL" },
};

// Orden para panel/resumen
const PLATFORM_ORDER = [
  { key: "netflix", label: "NETFLIX", totalKey: "netflix" },
  { key: "disneyp", label: "DISNEY PREMIUM", totalKey: "disneyp" },
  { key: "disneys", label: "DISNEY STANDARD", totalKey: "disneys" },
  { key: "hbomax", label: "HBO MAX", totalKey: "hbomax" },
  { key: "primevideo", label: "PRIME VIDEO", totalKey: "primevideo" },
  { key: "paramount", label: "PARAMOUNT+", totalKey: "paramount" },
  { key: "crunchyroll", label: "CRUNCHYROLL", totalKey: "crunchyroll" },
];

// ===============================
// ADMIN CHECK
// admins/{telegramUserId} => { activo: true }
// ===============================
async function isAdmin(userId) {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists && doc.data()?.activo === true;
}

async function requireAdmin(msg) {
  const ok = await isAdmin(msg.from.id);
  if (!ok) await bot.sendMessage(msg.chat.id, "⛔ Acceso denegado");
  return ok;
}

// ===============================
// CONFIG (totales)
// config/totales_plataforma
// ===============================
async function getTotals() {
  const cfg = await db.collection("config").doc("totales_plataforma").get();
  if (!cfg.exists) return null;
  return cfg.data() || {};
}

// ===============================
// MENÚ
// ===============================
function menuText() {
  return (
    "✅ Bot Sublicuentas activo\n\n" +
    "📦 STOCK:\n" +
    "/stock (panel completo)\n" +
    "/netflix\n/disneyp\n/disneys\n/hbo\n/prime\n/paramount\n/crunchy\n\n" +
    "📧 LISTADOS:\n" +
    "/list netflix\n/list disneyp\n/list disneys\n/list hbomax\n/list primevideo\n/list paramount\n/list crunchyroll\n\n" +
    "🔎 BUSCAR:\n" +
    "/buscar correo@gmail.com\n\n" +
    "🏆 RANKING:\n" +
    "/top\n\n" +
    "➕ AGREGAR CUENTAS:\n" +
    "/add correo@gmail.com netflix 5 [activa]\n" +
    "/addm (lote)\n\n" +
    "⚙️ INVENTARIO PERFILES:\n" +
    "/addp correo@gmail.com  (resta 1)\n" +
    "/delp correo@gmail.com  (suma 1)\n"
  );
}

bot.onText(/^\/start$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  await bot.sendMessage(msg.chat.id, menuText());
});

bot.onText(/^\/help$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  await bot.sendMessage(msg.chat.id, menuText());
});

// ===============================
// STOCK por plataforma (lista correos + disp/total)
// ===============================
async function sendStock(chatId, platKey, label, totalKey) {
  const totals = await getTotals();
  if (!totals) return bot.sendMessage(chatId, "⚠️ Falta config/totales_plataforma");

  const total = Number(totals[totalKey] ?? 0);
  if (!total) {
    return bot.sendMessage(chatId, `⚠️ No está configurado el total para ${label} (campo: ${totalKey})`);
  }

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", platKey)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) return bot.sendMessage(chatId, `⚠️ ${label} SIN PERFILES DISPONIBLES`);

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
// COMANDOS STOCK: /netflix /disneyp /disneys /hbo /prime /paramount /crunchy
// ===============================
Object.keys(PLATFORMS).forEach((cmd) => {
  bot.onText(new RegExp(`^\\/${cmd}$`, "i"), async (msg) => {
    if (!(await requireAdmin(msg))) return;

    const chatId = msg.chat.id;
    const p = PLATFORMS[cmd];

    // En tu caso, totalKey coincide con la key de plataforma (hbomax, primevideo, etc.)
    const totalKey = p.key;

    await sendStock(chatId, p.key, p.label, totalKey);
  });
});

// ===============================
// /STOCK (panel completo resumen)
// ===============================
bot.onText(/^\/stock$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;

  const totals = await getTotals();
  if (!totals) return bot.sendMessage(chatId, "⚠️ Falta config/totales_plataforma");

  let texto = "📊 PANEL DE STOCK — SUBLICUENTAS\n\n";
  let globalCuentas = 0;
  let globalPerfiles = 0;

  for (const p of PLATFORM_ORDER) {
    const snap = await db
      .collection("inventario")
      .where("plataforma", "==", p.key)
      .where("disp", ">=", 1)
      .where("estado", "==", "activa")
      .get();

    if (snap.empty) {
      texto += `❌ ${p.label}: 0 cuentas (0 perfiles)\n`;
      continue;
    }

    let cuentas = 0;
    let perfiles = 0;

    snap.forEach((d) => {
      const x = d.data();
      cuentas += 1;
      perfiles += Number(x.disp || 0);
    });

    globalCuentas += cuentas;
    globalPerfiles += perfiles;

    texto += `✅ ${p.label}: ${cuentas} cuentas (${perfiles} perfiles)\n`;
  }

  texto += `\n━━━━━━━━━━━━━━\n`;
  texto += `📦 TOTAL CUENTAS CON STOCK: ${globalCuentas}\n`;
  texto += `👤 TOTAL PERFILES LIBRES: ${globalPerfiles}\n`;

  return bot.sendMessage(chatId, texto);
});

// ===============================
// /LIST plataformaKey
// Ej: /list netflix | disneyp | hbomax | primevideo | crunchyroll
// ===============================
bot.onText(/^\/list\s+([a-zA-Z0-9_]+)$/i, async (msg, match) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;

  const platKey = String(match[1] || "").toLowerCase().trim();
  const valid = PLATFORM_ORDER.find((p) => p.key === platKey);
  if (!valid) {
    return bot.sendMessage(
      chatId,
      "⚠️ Plataforma inválida.\nUsa: netflix, disneyp, disneys, hbomax, primevideo, paramount, crunchyroll"
    );
  }

  const totals = await getTotals();
  if (!totals) return bot.sendMessage(chatId, "⚠️ Falta config/totales_plataforma");

  const total = Number(totals[valid.totalKey] ?? 0);

  const snap = await db
    .collection("inventario")
    .where("plataforma", "==", valid.key)
    .where("disp", ">=", 1)
    .where("estado", "==", "activa")
    .get();

  if (snap.empty) return bot.sendMessage(chatId, `⚠️ ${valid.label} SIN PERFILES DISPONIBLES`);

  const MAX = 60; // evitar corte por Telegram
  let texto = `📧 LISTADO — ${valid.label}\n\n`;
  let i = 1;

  for (const doc of snap.docs.slice(0, MAX)) {
    const d = doc.data();
    texto += `${i}) ${d.correo} — ${d.disp}/${total}\n`;
    i++;
  }

  if (snap.size > MAX) {
    texto += `\n… y ${snap.size - MAX} más (limité a ${MAX} para que Telegram no corte el mensaje)`;
  }

  return bot.sendMessage(chatId, texto);
});

// ===============================
// /BUSCAR correo@gmail.com
// ===============================
bot.onText(/^\/buscar\s+(.+)$/i, async (msg, match) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;

  const correo = String(match[1] || "").trim().toLowerCase();
  if (!correo.includes("@")) return bot.sendMessage(chatId, "Uso: /buscar correo@gmail.com");

  const snap = await db.collection("inventario").where("correo", "==", correo).limit(1).get();
  if (snap.empty) return bot.sendMessage(chatId, `❌ No encontrado:\n${correo}`);

  const d = snap.docs[0].data();
  const totals = await getTotals();
  const total = Number(totals?.[d.plataforma] ?? 0);
  const label = PLATFORM_ORDER.find((p) => p.key === d.plataforma)?.label || d.plataforma;

  return bot.sendMessage(
    chatId,
    `🔎 RESULTADO\n\n📌 Plataforma: ${label}\n📧 Correo: ${d.correo}\n🟢 Estado: ${d.estado || "sin_estado"}\n👤 Disponibles: ${Number(d.disp ?? 0)}/${total || "?"}`
  );
});

// ===============================
// /TOP (ranking por perfiles libres)
// ===============================
bot.onText(/^\/top$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;

  const results = [];

  for (const p of PLATFORM_ORDER) {
    const snap = await db
      .collection("inventario")
      .where("plataforma", "==", p.key)
      .where("disp", ">=", 1)
      .where("estado", "==", "activa")
      .get();

    let cuentas = 0;
    let perfiles = 0;

    snap.forEach((doc) => {
      const d = doc.data();
      cuentas += 1;
      perfiles += Number(d.disp || 0);
    });

    results.push({ label: p.label, cuentas, perfiles });
  }

  results.sort((a, b) => b.perfiles - a.perfiles);

  let texto = "🏆 TOP STOCK — SUBLICUENTAS\n\n";
  results.forEach((r, idx) => {
    texto += `${idx + 1}) ${r.label}: ${r.perfiles} perfiles (${r.cuentas} cuentas)\n`;
  });

  return bot.sendMessage(chatId, texto);
});

// ===============================
// addp / delp (inventario perfiles por correo)
// ===============================
function parseEmailArg(text) {
  const parts = String(text || "").trim().split(/\s+/);
  if (parts.length < 2) return null;
  return parts[1].trim().toLowerCase();
}

async function updateDispByEmail(chatId, email, delta) {
  const emailNorm = email.toLowerCase();

  const q = await db.collection("inventario").where("correo", "==", emailNorm).limit(1).get();
  if (q.empty) return bot.sendMessage(chatId, `❌ No encontré ese correo en inventario:\n${emailNorm}`);

  const ref = q.docs[0].ref;

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const d = doc.data();

    const totals = await getTotals();
    const max = Number(totals?.[d.plataforma] ?? 0);
    if (!max) throw new Error(`No hay total configurado para plataforma: ${d.plataforma}`);

    const current = Number(d.disp ?? 0);
    let next = current + delta;

    if (next < 0) next = 0;
    if (next > max) next = max;

    tx.update(ref, {
      disp: next,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  const done = await ref.get();
  const d2 = done.data();
  const totals = await getTotals();
  const max = Number(totals?.[d2.plataforma] ?? 0);
  const label = PLATFORM_ORDER.find((p) => p.key === d2.plataforma)?.label || d2.plataforma;

  return bot.sendMessage(chatId, `✅ Actualizado\n📌 ${label}\n📧 ${d2.correo}\n👤 Disponibles: ${d2.disp}/${max}`);
}

bot.onText(/^\/addp(\s+.+)?$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;
  const email = parseEmailArg(msg.text);
  if (!email) return bot.sendMessage(chatId, "Uso: /addp correo@gmail.com");
  await updateDispByEmail(chatId, email, -1);
});

bot.onText(/^\/delp(\s+.+)?$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;
  const email = parseEmailArg(msg.text);
  if (!email) return bot.sendMessage(chatId, "Uso: /delp correo@gmail.com");
  await updateDispByEmail(chatId, email, +1);
});

// ===============================
// Normalizar plataforma (acepta alias)
// ===============================
function normalizePlatform(input) {
  const p = String(input || "").trim().toLowerCase();

  // alias -> keys reales
  if (p === "hbo") return "hbomax";
  if (p === "prime") return "primevideo";
  if (p === "crunchy") return "crunchyroll";

  const allowed = new Set([
    "netflix",
    "disneyp",
    "disneys",
    "hbomax",
    "primevideo",
    "paramount",
    "crunchyroll",
  ]);

  return allowed.has(p) ? p : null;
}

// ===============================
// Crear o actualizar cuenta (por correo)
// ===============================
async function upsertAccount({ chatId, correo, plataforma, disp, estado = "activa" }) {
  const totals = await getTotals();
  if (!totals) return bot.sendMessage(chatId, "⚠️ Falta config/totales_plataforma");

  const max = Number(totals[plataforma] ?? 0);
  if (!max) {
    return bot.sendMessage(chatId, `⚠️ No hay total configurado para ${plataforma} en config/totales_plataforma`);
  }

  let dispNum = Number(disp);
  if (!Number.isFinite(dispNum)) dispNum = max;
  if (dispNum < 0) dispNum = 0;
  if (dispNum > max) dispNum = max;

  const email = String(correo || "").trim().toLowerCase();
  if (!email.includes("@")) return bot.sendMessage(chatId, `❌ Correo inválido: ${correo}`);

  const q = await db.collection("inventario").where("correo", "==", email).limit(1).get();

  const label = PLATFORM_ORDER.find((x) => x.key === plataforma)?.label || plataforma;

  if (q.empty) {
    await db.collection("inventario").add({
      correo: email,
      plataforma,
      disp: dispNum,
      estado,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return bot.sendMessage(chatId, `✅ Agregada\n📌 ${label}\n📧 ${email}\n👤 Disponibles: ${dispNum}/${max}\n🟢 Estado: ${estado}`);
  } else {
    const ref = q.docs[0].ref;
    await ref.update({
      plataforma,
      disp: dispNum,
      estado,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return bot.sendMessage(chatId, `♻️ Actualizada\n📌 ${label}\n📧 ${email}\n👤 Disponibles: ${dispNum}/${max}\n🟢 Estado: ${estado}`);
  }
}

// ===============================
// /ADD correo plataforma disp [estado]
// Ej: /add correo@gmail.com netflix 5
// Ej: /add correo@gmail.com hbomax 3 activa
// ===============================
bot.onText(/^\/add\s+(.+)$/i, async (msg, match) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;

  const parts = String(match[1] || "").trim().split(/\s+/);
  if (parts.length < 3) {
    return bot.sendMessage(
      chatId,
      "Uso: /add correo@gmail.com plataforma disp [estado]\nEj: /add correo@gmail.com netflix 5"
    );
  }

  const correo = parts[0];
  const plataformaRaw = parts[1];
  const disp = parts[2];
  const estado = parts[3] || "activa";

  const plataforma = normalizePlatform(plataformaRaw);
  if (!plataforma) {
    return bot.sendMessage(
      chatId,
      "❌ Plataforma inválida.\nUsa: netflix, disneyp, disneys, hbomax(hbo), primevideo(prime), paramount, crunchyroll(crunchy)"
    );
  }

  await upsertAccount({ chatId, correo, plataforma, disp, estado });
});

// ===============================
// /ADDM (ayuda)
// ===============================
bot.onText(/^\/addm$/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;

  return bot.sendMessage(
    chatId,
    "📥 Envíe el lote así (en el mismo chat):\n\n/addm\ncorreo1@gmail.com netflix 5\ncorreo2@gmail.com disneyp 6\ncorreo3@gmail.com hbomax 5 activa"
  );
});

// ===============================
// /ADDM con líneas (lote real)
// ===============================
bot.onText(/^\/addm[\s\S]+/i, async (msg) => {
  if (!(await requireAdmin(msg))) return;
  const chatId = msg.chat.id;

  const text = String(msg.text || "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const payload = lines.slice(1); // quita /addm
  if (payload.length === 0) {
    return bot.sendMessage(chatId, "⚠️ No veo líneas. Ej:\n/addm\ncorreo@gmail.com netflix 5");
  }

  let ok = 0;
  let bad = 0;
  const errors = [];

  const MAX_LINES = 50;
  const useLines = payload.slice(0, MAX_LINES);

  for (const line of useLines) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      bad++;
      errors.push(`❌ Línea inválida: ${line}`);
      continue;
    }

    const correo = parts[0];
    const plataforma = normalizePlatform(parts[1]);
    const disp = parts[2];
    const estado = parts[3] || "activa";

    if (!plataforma) {
      bad++;
      errors.push(`❌ Plataforma inválida: ${parts[1]} (línea: ${line})`);
      continue;
    }

    try {
      await upsertAccount({ chatId, correo, plataforma, disp, estado });
      ok++;
    } catch (e) {
      bad++;
      errors.push(`❌ Error en línea: ${line}`);
      console.error(e);
    }
  }

  let resumen = `📌 Lote procesado\n✅ OK: ${ok}\n⚠️ Fallos: ${bad}`;
  if (payload.length > MAX_LINES) resumen += `\n(Procesé solo ${MAX_LINES} líneas por seguridad)`;

  if (errors.length) {
    resumen += `\n\nErrores (primeros ${Math.min(10, errors.length)}):\n${errors.slice(0, 10).join("\n")}`;
  }

  return bot.sendMessage(chatId, resumen);
});

// ===============================
// SERVER PARA RENDER (mantener vivo)
// ===============================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, "0.0.0.0", () => console.log("🌐 Listening on " + PORT));

setInterval(() => console.log("🟢 Bot activo..."), 60000);
