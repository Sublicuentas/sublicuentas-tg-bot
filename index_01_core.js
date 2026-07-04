<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>index_01_core.js — Sublicuentas Bot</title>
<style>
:root{--bg:#0b1020;--panel:#111827;--line:#263044;--text:#eef2ff;--muted:#9ca3af;--accent:#e2231a;--code:#0f172a;}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,Helvetica,sans-serif;line-height:1.45}
header{position:sticky;top:0;background:linear-gradient(135deg,#e2231a,#8b1110);padding:18px 22px;border-bottom:1px solid #ffffff22;z-index:5}
h1{font-size:20px;margin:0 0 4px} p{margin:0;color:#ffe4e4}.wrap{max-width:1180px;margin:0 auto;padding:22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 12px 34px #0008}
.card h2{margin:0;padding:14px 16px;border-bottom:1px solid var(--line);font-size:16px;color:#fff;background:#0f172a}
pre{margin:0;padding:18px;overflow:auto;background:var(--code);font-family:Consolas,Monaco,'Courier New',monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.meta{font-size:13px;color:var(--muted);margin-bottom:14px}.copy{float:right;background:#fff;color:#111;border:0;border-radius:10px;padding:8px 12px;font-weight:700;cursor:pointer}
</style>
<script>
function copyCode(){
  const code = document.querySelector('pre').innerText;
  navigator.clipboard.writeText(code).then(()=>alert('Código copiado'));
}
</script>
</head>
<body>
<header><h1>Archivo: index_01_core.js</h1><p>Sublicuentas TG Bot — versión actualizada</p></header>
<div class="wrap">
  <div class="meta">Este HTML es para visualizar/copiar el código. Para usarlo en Render/GitHub, el archivo real debe conservar extensión <b>.js</b>.</div>
  <div class="card">
    <h2>index_01_core.js <button class="copy" onclick="copyCode()">Copiar código</button></h2>
    <pre>/* ✅ SUBLICUENTAS TG BOT — INDEX 01 CORE v2
   CORE / ENV / FIREBASE / BOT SINGLETON / CONSTANTES / POLLING SAFE / CACHÉ
   --------------------------------------------------------------------------
   ✅ OPTIMIZACIONES v2:
   - Sistema de caché en memoria para admins, revendedores y config
   - TTL configurable por tipo de dato
   - Helpers de caché exportados para uso en otras partes
   - Sin cambios en polling ni Firebase init
*/

const TelegramBot = require(&quot;node-telegram-bot-api&quot;);
const admin = require(&quot;firebase-admin&quot;);
const ExcelJS = require(&quot;exceljs&quot;);

// ===============================
// ENV
// ===============================
const BOT_TOKEN = String(process.env.BOT_TOKEN || &quot;&quot;).trim();
const FIREBASE_PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || &quot;&quot;).trim();
const FIREBASE_CLIENT_EMAIL = String(process.env.FIREBASE_CLIENT_EMAIL || &quot;&quot;).trim();
const FIREBASE_PRIVATE_KEY = String(process.env.FIREBASE_PRIVATE_KEY || &quot;&quot;);
const SUPER_ADMIN = String(process.env.SUPER_ADMIN || &quot;&quot;).trim();
const TZ = String(process.env.TZ || &quot;America/Tegucigalpa&quot;).trim();
const PORT = Number(process.env.PORT || 10000);

const ENABLE_NETFLIX_LISTENER =
  String(process.env.ENABLE_NETFLIX_LISTENER || &quot;false&quot;).trim().toLowerCase() === &quot;true&quot;;
const IMAP_ACCOUNTS_JSON = String(process.env.IMAP_ACCOUNTS_JSON || &quot;[]&quot;).trim();

if (!BOT_TOKEN) throw new Error(&quot;Falta BOT_TOKEN&quot;);
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error(&quot;Faltan variables Firebase&quot;);
}

// ===============================
// HELPERS
// ===============================
function safeJsonParse(input, fallback = null) {
  try { return JSON.parse(input); } catch (_) { return fallback; }
}

function toBool(v, defaultValue = false) {
  if (typeof v === &quot;boolean&quot;) return v;
  const s = String(v || &quot;&quot;).trim().toLowerCase();
  if ([&quot;1&quot;, &quot;true&quot;, &quot;yes&quot;, &quot;si&quot;, &quot;sí&quot;, &quot;on&quot;].includes(s)) return true;
  if ([&quot;0&quot;, &quot;false&quot;, &quot;no&quot;, &quot;off&quot;].includes(s)) return false;
  return defaultValue;
}

function sleep(ms = 0) {
  return new Promise((resolve) =&gt; setTimeout(resolve, Number(ms || 0)));
}

function normalizeImapAccount(row = {}) {
  return {
    name: String(row.name || row.alias || row.id || &quot;&quot;).trim(),
    user: String(row.user || row.email || &quot;&quot;).trim(),
    password: String(row.password || row.pass || &quot;&quot;).trim(),
    host: String(row.host || &quot;imap.gmail.com&quot;).trim(),
    port: Number(row.port || 993),
    tls: toBool(row.tls, true),
    label: String(row.label || &quot;&quot;).trim(),
    provider: String(row.provider || &quot;gmail&quot;).trim(),
    enabled: toBool(row.enabled, true),
  };
}

// ===============================
// FIREBASE
// ===============================
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, &quot;\n&quot;),
    }),
  });
}

const db = admin.firestore();
try { db.settings({ ignoreUndefinedProperties: true }); } catch (_) {}

// ===============================
// COLECCIONES
// ===============================
const INVENTARIO_COLLECTION = &quot;inventario&quot;;
const CLIENTES_COLLECTION = &quot;clientes&quot;;
const REVENDEDORES_COLLECTION = &quot;revendedores&quot;;
const ADMINS_COLLECTION = &quot;admins&quot;;
const CONFIG_COLLECTION = &quot;config&quot;;
const FINANZAS_COLLECTION = &quot;finanzas_movimientos&quot;;

// ===============================
// FINANZAS
// ===============================
const FIN_BANCOS = [
  &quot;Efectivo&quot;, &quot;BAC&quot;, &quot;Ficohsa&quot;, &quot;Banpaís&quot;, &quot;Atlántida&quot;, &quot;Lafise&quot;,
  &quot;Occidente&quot;, &quot;Davivienda&quot;, &quot;PayPal&quot;, &quot;Binance&quot;, &quot;Tigo Money&quot;,
  &quot;Transferencia&quot;, &quot;Otro&quot;,
];

const FIN_MOTIVOS_EGRESO = [
  &quot;Compra de cuentas&quot;, &quot;Pago proveedor&quot;, &quot;Publicidad&quot;, &quot;Diseño&quot;,
  &quot;Comisión vendedor&quot;, &quot;Internet&quot;, &quot;Herramientas&quot;, &quot;Reposición&quot;,
  &quot;Reembolso&quot;, &quot;Otros&quot;,
];

// ===============================
// PLATAFORMAS
// ===============================
const PLATAFORMAS = {
  netflix:     { key: &quot;netflix&quot;,     nombre: &quot;Netflix Premium&quot;, categoria: &quot;video&quot;,     acceso: &quot;correo_clave_pin&quot;, capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  vipnetflix:  { key: &quot;vipnetflix&quot;,  nombre: &quot;Netflix VIP&quot;,     categoria: &quot;video&quot;,     acceso: &quot;correo_clave_pin&quot;, capacidadDefault: 1,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  disneyp:     { key: &quot;disneyp&quot;,     nombre: &quot;Disney Premium&quot;,  categoria: &quot;video&quot;,     acceso: &quot;correo_clave_pin&quot;, capacidadDefault: 6,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  disneys:     { key: &quot;disneys&quot;,     nombre: &quot;Disney Standard&quot;, categoria: &quot;video&quot;,     acceso: &quot;correo_clave_pin&quot;, capacidadDefault: 3,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  hbomax:      { key: &quot;hbomax&quot;,      nombre: &quot;HBO Max&quot;,         categoria: &quot;video&quot;,     acceso: &quot;correo_clave_pin&quot;, capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  primevideo:  { key: &quot;primevideo&quot;,  nombre: &quot;Prime Video&quot;,     categoria: &quot;video&quot;,     acceso: &quot;correo_clave_pin&quot;, capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  paramount:   { key: &quot;paramount&quot;,   nombre: &quot;Paramount+&quot;,      categoria: &quot;video&quot;,     acceso: &quot;correo_clave&quot;,     capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  crunchyroll: { key: &quot;crunchyroll&quot;, nombre: &quot;Crunchyroll&quot;,     categoria: &quot;video&quot;,     acceso: &quot;correo_clave_pin&quot;, capacidadDefault: 5,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  vix:         { key: &quot;vix&quot;,         nombre: &quot;Vix&quot;,             categoria: &quot;video&quot;,     acceso: &quot;correo_clave&quot;,     capacidadDefault: 4,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  appletv:     { key: &quot;appletv&quot;,     nombre: &quot;Apple TV&quot;,        categoria: &quot;video&quot;,     acceso: &quot;correo_clave&quot;,     capacidadDefault: 4,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  universal:   { key: &quot;universal&quot;,   nombre: &quot;Universal+&quot;,      categoria: &quot;video&quot;,     acceso: &quot;correo_clave_pin&quot;, capacidadDefault: 4,  requiereCorreo: true,  requiereClave: true,  requierePin: true,  permiteUsuario: false },
  spotify:     { key: &quot;spotify&quot;,     nombre: &quot;Spotify&quot;,         categoria: &quot;musica&quot;,    acceso: &quot;correo_clave&quot;,     capacidadDefault: 1,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  youtube:     { key: &quot;youtube&quot;,     nombre: &quot;YouTube&quot;,         categoria: &quot;musica&quot;,    acceso: &quot;correo_clave&quot;,     capacidadDefault: 1,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  deezer:      { key: &quot;deezer&quot;,      nombre: &quot;Deezer&quot;,          categoria: &quot;musica&quot;,    acceso: &quot;correo_clave&quot;,     capacidadDefault: 1,  requiereCorreo: true,  requiereClave: true,  requierePin: false, permiteUsuario: false },
  oleadatv1:   { key: &quot;oleadatv1&quot;,   nombre: &quot;Oleada 1&quot;,        categoria: &quot;iptv&quot;,      acceso: &quot;usuario_clave&quot;,    capacidadDefault: 1,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  oleadatv3:   { key: &quot;oleadatv3&quot;,   nombre: &quot;Oleada 3&quot;,        categoria: &quot;iptv&quot;,      acceso: &quot;usuario_clave&quot;,    capacidadDefault: 3,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  iptv1:       { key: &quot;iptv1&quot;,       nombre: &quot;IPTV 1&quot;,          categoria: &quot;iptv&quot;,      acceso: &quot;usuario_clave&quot;,    capacidadDefault: 1,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  iptv3:       { key: &quot;iptv3&quot;,       nombre: &quot;IPTV 3&quot;,          categoria: &quot;iptv&quot;,      acceso: &quot;usuario_clave&quot;,    capacidadDefault: 3,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  iptv4:       { key: &quot;iptv4&quot;,       nombre: &quot;IPTV 4&quot;,          categoria: &quot;iptv&quot;,      acceso: &quot;usuario_clave&quot;,    capacidadDefault: 4,  requiereCorreo: false, requiereClave: true,  requierePin: false, permiteUsuario: true  },
  canva:       { key: &quot;canva&quot;,       nombre: &quot;Canva&quot;,           categoria: &quot;diseno_ia&quot;, acceso: &quot;solo_correo&quot;,      capacidadDefault: 1,  requiereCorreo: true,  requiereClave: false, requierePin: false, permiteUsuario: false },
  gemini:      { key: &quot;gemini&quot;,      nombre: &quot;Gemini&quot;,          categoria: &quot;diseno_ia&quot;, acceso: &quot;solo_correo&quot;,      capacidadDefault: 1,  requiereCorreo: true,  requiereClave: false, requierePin: false, permiteUsuario: false },
  chatgpt:     { key: &quot;chatgpt&quot;,     nombre: &quot;ChatGPT&quot;,         categoria: &quot;diseno_ia&quot;, acceso: &quot;solo_correo&quot;,      capacidadDefault: 1,  requiereCorreo: true,  requiereClave: false, requierePin: false, permiteUsuario: false },
  duolingo:    { key: &quot;duolingo&quot;,    nombre: &quot;Duolingo&quot;,        categoria: &quot;diseno_ia&quot;, acceso: &quot;solo_correo&quot;,      capacidadDefault: 1,  requiereCorreo: true,  requiereClave: false, requierePin: false, permiteUsuario: false },
};

const DEFAULT_TOTALS = Object.fromEntries(
  Object.entries(PLATAFORMAS).map(([k, v]) =&gt; [k, Number(v.capacidadDefault || 1)])
);

// ===============================
// IMAP ACCOUNTS
// ===============================
const EMAIL_ACCOUNTS = Array.isArray(safeJsonParse(IMAP_ACCOUNTS_JSON, []))
  ? safeJsonParse(IMAP_ACCOUNTS_JSON, [])
      .map(normalizeImapAccount)
      .filter((x) =&gt; x.enabled &amp;&amp; (x.user || x.name))
  : [];

// ===============================
// BOT SINGLETON
// ===============================
if (!global.__SUBLICUENTAS_BOT__) {
  global.__SUBLICUENTAS_BOT__ = new TelegramBot(BOT_TOKEN, { polling: false });
}

const bot = global.__SUBLICUENTAS_BOT__;
const INSTANCE_ID =
  global.__SUBLICUENTAS_INSTANCE_ID__ ||
  `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
global.__SUBLICUENTAS_INSTANCE_ID__ = INSTANCE_ID;

// ===============================
// CORE STATE GLOBAL
// ===============================
if (!global.__SUBLICUENTAS_CORE_STATE__) {
  global.__SUBLICUENTAS_CORE_STATE__ = {
    runtimeLock: true,
    isBooting: false,
    isPolling: false,
    isStopping: false,
    isRestarting409: false,
    bootCount: 0,
    conflict409Count: 0,
    lastConflictAt: 0,
    lastPollingErrorAt: 0,
    lastPollingError: null,
    lastStartAt: 0,
    startedAt: Date.now(),
  };
}

const CORE_STATE = global.__SUBLICUENTAS_CORE_STATE__;

// ===============================
// ✅ CACHÉ EN MEMORIA
// TTL en milisegundos por tipo de dato:
//   - admins / revendedores: 90 segundos (cambian poco)
//   - clientes resumen: 120 segundos (800+ docs, costoso leer)
//   - config / dailyRun: 60 segundos
// ===============================
if (!global.__SUBLICUENTAS_CACHE__) {
  global.__SUBLICUENTAS_CACHE__ = new Map();
}

const CACHE = global.__SUBLICUENTAS_CACHE__;

// TTL por prefijo de clave
const CACHE_TTL = {
  admins:       600 * 1000,  // 10 minutos — cambian muy poco
  revendedores: 600 * 1000,  // 10 minutos — cambian muy poco
  clientes:     300 * 1000,  // 5 minutos
  inventario:   120 * 1000,  // 2 minutos
  config:       120 * 1000,  // 2 minutos
  default:      120 * 1000,  // 2 minutos
};

function getCacheTTL(key = &quot;&quot;) {
  const prefix = String(key || &quot;&quot;).split(&quot;:&quot;)[0];
  return CACHE_TTL[prefix] || CACHE_TTL.default;
}

/**
 * Lee del caché. Devuelve null si no existe o expiró.
 */
function cacheGet(key = &quot;&quot;) {
  const entry = CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() &gt; entry.expiresAt) {
    CACHE.delete(String(key));
    return null;
  }
  return entry.value;
}

/**
 * Escribe en el caché con TTL automático por prefijo.
 */
function cacheSet(key = &quot;&quot;, value, ttlMs = null) {
  const ttl = ttlMs != null ? Number(ttlMs) : getCacheTTL(key);
  CACHE.set(String(key), {
    value,
    expiresAt: Date.now() + ttl,
    setAt: Date.now(),
  });
}

/**
 * Invalida todas las entradas cuya clave empiece con prefix.
 */
function cacheInvalidatePrefix(prefix = &quot;&quot;) {
  const p = String(prefix);
  for (const key of CACHE.keys()) {
    if (key.startsWith(p)) CACHE.delete(key);
  }
}

/**
 * Invalida una clave exacta.
 */
function cacheDelete(key = &quot;&quot;) {
  CACHE.delete(String(key));
}

/**
 * Limpia todas las entradas expiradas (llamar periódicamente).
 */
function cachePurgeExpired() {
  const now = Date.now();
  for (const [key, entry] of CACHE.entries()) {
    if (now &gt; entry.expiresAt) CACHE.delete(key);
  }
}

// Limpieza automática cada 5 minutos
if (!global.__SUBLICUENTAS_CACHE_PURGE__) {
  global.__SUBLICUENTAS_CACHE_PURGE__ = true;
  setInterval(cachePurgeExpired, 5 * 60 * 1000);
}

// ===============================
// PROCESS HOOKS SOLO 1 VEZ
// ===============================
if (!global.__SUBLICUENTAS_PROCESS_HOOKS__) {
  global.__SUBLICUENTAS_PROCESS_HOOKS__ = true;

  process.on(&quot;unhandledRejection&quot;, (err) =&gt; {
    console.error(&quot;❌ UNHANDLED_REJECTION:&quot;, err?.stack || err);
  });

  process.on(&quot;uncaughtException&quot;, (err) =&gt; {
    console.error(&quot;❌ UNCAUGHT_EXCEPTION:&quot;, err?.stack || err);
  });

  process.on(&quot;SIGINT&quot;, async () =&gt; {
    try { await stopBotPollingSafe(&quot;SIGINT&quot;); } catch (_) {}
    process.exit(0);
  });

  process.on(&quot;SIGTERM&quot;, async () =&gt; {
    try { await stopBotPollingSafe(&quot;SIGTERM&quot;); } catch (_) {}
    process.exit(0);
  });
}

// ===============================
// RUNTIME HELPERS
// ===============================
function hardStopBot() { CORE_STATE.runtimeLock = false; }
function releaseRuntimeLock() { CORE_STATE.runtimeLock = true; }

function getCoreHealth() {
  return {
    ok: true,
    instanceId: INSTANCE_ID,
    runtimeLock: CORE_STATE.runtimeLock,
    isBooting: CORE_STATE.isBooting,
    isPolling: CORE_STATE.isPolling,
    isStopping: CORE_STATE.isStopping,
    isRestarting409: CORE_STATE.isRestarting409,
    bootCount: CORE_STATE.bootCount,
    conflict409Count: CORE_STATE.conflict409Count,
    lastConflictAt: CORE_STATE.lastConflictAt,
    lastPollingErrorAt: CORE_STATE.lastPollingErrorAt,
    lastPollingError: CORE_STATE.lastPollingError,
    lastStartAt: CORE_STATE.lastStartAt,
    startedAt: CORE_STATE.startedAt,
    uptimeSec: Math.floor((Date.now() - CORE_STATE.startedAt) / 1000),
    firebaseProject: FIREBASE_PROJECT_ID,
    tz: TZ,
    imapAccounts: EMAIL_ACCOUNTS.length,
    netflixListener: ENABLE_NETFLIX_LISTENER,
    cacheEntries: CACHE.size,
  };
}

// ===============================
// POLLING SAFE
// ===============================
async function stopBotPollingSafe(reason = &quot;manual&quot;) {
  if (CORE_STATE.isStopping) return;
  CORE_STATE.isStopping = true;
  try {
    try { await bot.stopPolling(); } catch (_) {}
  } finally {
    CORE_STATE.isPolling = false;
    CORE_STATE.isStopping = false;
    console.log(`🛑 Polling detenido (${reason}) [${INSTANCE_ID}]`);
  }
}

async function startBotPollingSafe(reason = &quot;manual&quot;) {
  if (!CORE_STATE.runtimeLock) {
    console.log(`⛔ runtimeLock=false, no se inicia polling (${reason}) [${INSTANCE_ID}]`);
    return;
  }

  if (global.__SUBLICUENTAS_POLLING_START_PROMISE__) {
    return global.__SUBLICUENTAS_POLLING_START_PROMISE__;
  }

  global.__SUBLICUENTAS_POLLING_START_PROMISE__ = (async () =&gt; {
    if (CORE_STATE.isBooting) return;
    CORE_STATE.isBooting = true;
    CORE_STATE.bootCount += 1;

    try {
      await stopBotPollingSafe(`pre-start:${reason}`);
      try { await bot.deleteWebHook({ drop_pending_updates: true }); } catch (_) {}
      await sleep(1200);
      await bot.startPolling({ restart: false, params: { timeout: 30, allowed_updates: [&quot;message&quot;,&quot;callback_query&quot;] } });
      CORE_STATE.isPolling = true;
      CORE_STATE.lastStartAt = Date.now();
      CORE_STATE.lastPollingError = null;
      console.log(`✅ Bot iniciado correctamente (${reason}) [${INSTANCE_ID}]`);
    } catch (err) {
      CORE_STATE.isPolling = false;
      CORE_STATE.lastPollingErrorAt = Date.now();
      CORE_STATE.lastPollingError = String(err?.message || err || &quot;&quot;);
      console.error(`❌ Error iniciando polling (${reason}) [${INSTANCE_ID}]:`, err?.stack || err);
    } finally {
      CORE_STATE.isBooting = false;
      global.__SUBLICUENTAS_POLLING_START_PROMISE__ = null;
    }
  })();

  return global.__SUBLICUENTAS_POLLING_START_PROMISE__;
}

async function restartBotPollingSafe(reason = &quot;manual&quot;, waitMs = 4000) {
  if (CORE_STATE.isRestarting409) return;
  CORE_STATE.isRestarting409 = true;
  try {
    await stopBotPollingSafe(`restart:${reason}`);
    await sleep(waitMs);
    await startBotPollingSafe(`restart:${reason}`);
  } finally {
    CORE_STATE.isRestarting409 = false;
  }
}

// ===============================
// BOT EVENTS SOLO 1 VEZ
// ===============================
if (!global.__SUBLICUENTAS_BOT_EVENTS__) {
  global.__SUBLICUENTAS_BOT_EVENTS__ = true;

  bot.on(&quot;polling_error&quot;, async (err) =&gt; {
    const msg = String(err?.message || err || &quot;&quot;);
    CORE_STATE.lastPollingErrorAt = Date.now();
    CORE_STATE.lastPollingError = msg;
    CORE_STATE.isPolling = false;
    console.error(`❌ polling_error [${INSTANCE_ID}]:`, err?.stack || err);

    if (msg.includes(&quot;409&quot;)) {
      const now = Date.now();
      const elapsed = now - Number(CORE_STATE.lastConflictAt || 0);
      if (elapsed &gt; 60000) CORE_STATE.conflict409Count = 0;
      CORE_STATE.lastConflictAt = now;
      CORE_STATE.conflict409Count += 1;
      const waitMs = CORE_STATE.conflict409Count &gt;= 3 ? 30000 : 15000;
      console.error(`⚠️ Detectado 409 Conflict. Intento ${CORE_STATE.conflict409Count}. Reintento en ${waitMs}ms [${INSTANCE_ID}]`);
      try { await restartBotPollingSafe(&quot;409-conflict&quot;, waitMs); } catch (e) {
        console.error(`❌ Error reintentando polling [${INSTANCE_ID}]:`, e?.stack || e);
      }
    }
  });

  bot.on(&quot;webhook_error&quot;, (err) =&gt; { console.error(`❌ webhook_error [${INSTANCE_ID}]:`, err?.stack || err); });
  bot.on(&quot;error&quot;, (err) =&gt; { console.error(`❌ bot_error [${INSTANCE_ID}]:`, err?.stack || err); });
}

// ===============================
// LOGS DE ARRANQUE
// ===============================
console.log(&quot;✅ ExcelJS cargado&quot;);
console.log(`✅ FIREBASE PROJECT: ${FIREBASE_PROJECT_ID}`);
console.log(`🌐 HTTP KEEPALIVE activo en puerto ${PORT}`);
console.log(`📩 Cuentas IMAP cargadas: ${EMAIL_ACCOUNTS.length}`);
console.log(`🧠 CORE INSTANCE: ${INSTANCE_ID}`);
console.log(`🗄️ Caché en memoria activo (admins:90s, revendedores:90s, clientes:120s)`);

if (ENABLE_NETFLIX_LISTENER) {
  console.log(&quot;🚀 Netflix Codes Listener iniciado...&quot;);
} else {
  console.log(&quot;ℹ️ Netflix listener desactivado&quot;);
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  // core libs
  bot, admin, db, ExcelJS,

  // env
  TZ, PORT, SUPER_ADMIN, ENABLE_NETFLIX_LISTENER,

  // constants
  INVENTARIO_COLLECTION, CLIENTES_COLLECTION, REVENDEDORES_COLLECTION,
  ADMINS_COLLECTION, CONFIG_COLLECTION, FINANZAS_COLLECTION,
  FIN_BANCOS, FIN_MOTIVOS_EGRESO, PLATAFORMAS, DEFAULT_TOTALS, EMAIL_ACCOUNTS,

  // runtime
  CORE_STATE, hardStopBot, releaseRuntimeLock, getCoreHealth,
  startBotPollingSafe, stopBotPollingSafe, restartBotPollingSafe,

  // ✅ caché
  cacheGet, cacheSet, cacheDelete, cacheInvalidatePrefix, cachePurgeExpired,

  // utils
  safeJsonParse, normalizeImapAccount, sleep,
};
</pre>
  </div>
</div>
</body>
</html>
