/*
 ✅ SUBLICUENTAS TG BOT — INDEX FINAL (ACTUALIZADO)
 ✅ FIX: TXT General funciona (sin error interno)
 ✅ TXT por vendedor (1 archivo) funciona
 ✅ Quitado: TXT 1 por vendedor
 ✅ Wizard: agregar vendedor
 ✅ Auto diario: envía TXT por vendedor (1 vez al día) al chat configurado
*/

const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

// ===============================
// ENV
// ===============================
const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;

// ✅ SUPER ADMIN (Telegram user id)
const SUPER_ADMIN = String(process.env.SUPER_ADMIN || "").trim(); // ej: "5728675990"

if (!BOT_TOKEN) throw new Error("Falta BOT_TOKEN");
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error("Faltan variables Firebase (PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)");
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

console.log("✅ FIREBASE PROJECT:", admin.app().options.projectId);

// ===============================
// TELEGRAM BOT
// ===============================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("✅ Bot iniciado");

// ===============================
// CONSTANTES
// ===============================
const PLATAFORMAS = ["netflix", "disneyp", "disneys", "hbomax", "primevideo", "paramount", "crunchyroll"];
const PAGE_SIZE = 10;

// ===============================
// HELPERS (NORMALIZACIÓN)
// ===============================
function stripAcentos(str = "") {
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normTxt(str = "") {
  return stripAcentos(String(str || ""))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
function onlyDigits(str = "") {
  return String(str || "").replace(/\D/g, "");
}
function normalizarPlataforma(txt = "") {
  return String(txt).toLowerCase().replace(/\s+/g, "");
}
function esPlataformaValida(p) {
  return PLATAFORMAS.includes(normalizarPlataforma(p));
}
function safeMail(correo) {
  return String(correo).trim().toLowerCase().replace(/[\/#?&]/g, "_");
}
function docIdInventario(correo, plataforma) {
  return `${normalizarPlataforma(plataforma)}__${safeMail(correo)}`;
}
function fmtEstado(estado) {
  const e = String(estado || "").toLowerCase();
  if (e === "bloqueada" || e === "llena") return "LLENA";
  return "ACTIVA";
}
function isFechaDMY(s) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(s || "").trim());
}
function hoyDMY() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}
function esTelefono(txt) {
  const t = onlyDigits(String(txt || "").trim());
  return /^[0-9]{7,15}$/.test(t);
}
function limpiarQuery(txt) {
  return String(txt || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
function isEmailLike(s) {
  const x = String(s || "").trim().toLowerCase();
  return x.includes("@") && x.includes(".");
}

// ✅ parse fecha dd/mm/yyyy para ordenar servicios
function parseDMYtoTS(dmy) {
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return Number.POSITIVE_INFINITY;
  const dd = Number(m[1]),
    mm = Number(m[2]),
    yy = Number(m[3]);
  return new Date(yy, mm - 1, dd).getTime();
}
function serviciosOrdenados(servicios = []) {
  const arr = Array.isArray(servicios) ? servicios.slice() : [];
  arr.sort((a, b) => parseDMYtoTS(a.fechaRenovacion) - parseDMYtoTS(b.fechaRenovacion));
  return arr;
}

// ✅ sumar días a una fecha dd/mm/yyyy
function addDaysDMY(dmy, days) {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = dmy.split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd);
  dt.setDate(dt.get
