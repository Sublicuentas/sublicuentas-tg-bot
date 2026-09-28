/* SUBLICUENTAS — TELEGRAM OUTBOX v2
   ---------------------------------------------------------------
   Cola compartida para que servicios secundarios pidan envíos al bot.

   Mejoras v2:
   - Listener Firestore en vez de consultar cada 1.5 segundos.
   - Watchdog liviano cada 60 segundos.
   - Lease para recuperar trabajos atascados en processing.
   - Reintentos con backoff y soporte retry_after de Telegram 429.
   - Máximo de intentos configurable.
*/
const { db, admin, bot, sleep } = require('./index_01_core');
const { retryDelayMs } = require('./lib_hardening');

const COLLECTION = 'telegram_outbox';
const WORKER_ID = `tg_${process.pid}_${Date.now().toString(36)}`;
const MAX_ATTEMPTS = Math.max(1, Number(process.env.TELEGRAM_OUTBOX_MAX_ATTEMPTS || 5));
const LEASE_MS = Math.max(30_000, Number(process.env.TELEGRAM_OUTBOX_LEASE_MS || 120_000));
const WATCHDOG_MS = Math.max(30_000, Number(process.env.TELEGRAM_OUTBOX_WATCHDOG_MS || 120_000));
let watchdogTimer = null;
let unsubscribePending = null;
let running = false;

function clean(v, max = 4000) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
}

function telegramErrorInfo(e) {
  const body = e?.response?.body || e?.response?.data || {};
  const code = Number(body?.error_code || e?.response?.statusCode || e?.statusCode || 0) || 0;
  const description = clean(body?.description || e?.message || e || 'Error desconocido de Telegram', 500);
  const lower = description.toLowerCase();
  const retryAfterSec = Number(body?.parameters?.retry_after || e?.response?.body?.parameters?.retry_after || 0) || 0;
  let kind = 'telegram_error';
  if (code === 401 || lower.includes('unauthorized')) kind = 'bot_token_invalido';
  else if (lower.includes('chat not found')) kind = 'chat_no_encontrado';
  else if (lower.includes('bot was blocked') || lower.includes('blocked by the user')) kind = 'bot_bloqueado';
  else if (lower.includes('forbidden')) kind = 'telegram_prohibido';
  else if (lower.includes('user is deactivated')) kind = 'usuario_desactivado';
  else if (code === 429 || lower.includes('too many requests')) kind = 'rate_limit';
  return { code, description, kind, retryAfterSec };
}

function isUnauthorizedTelegramError(e) {
  return telegramErrorInfo(e).kind === 'bot_token_invalido';
}

function serializeReplyMarkup(value) {
  if (!value || typeof value !== 'object') return '';
  try {
    const json = JSON.stringify(value);
    return json.length <= 20000 ? json : '';
  } catch (_) { return ''; }
}

function deserializeReplyMarkup(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}

async function enqueueTelegramJob(input = {}) {
  const type = input.type === 'photo' ? 'photo' : 'message';
  const chatId = clean(input.chatId, 80).replace(/[^0-9-]/g, '');
  if (!chatId) throw new Error('telegram_chat_id_requerido');
  const text = clean(input.text || input.caption, type === 'photo' ? 1000 : 3900);
  if (!text && type === 'message') throw new Error('telegram_texto_requerido');
  const photoUrl = type === 'photo' ? clean(input.photoUrl, 1800) : '';
  if (type === 'photo' && !photoUrl) throw new Error('telegram_photo_url_requerida');

  const ref = db.collection(COLLECTION).doc();
  await ref.set({
    type, chatId, text, photoUrl,
    parseMode: ['HTML', 'Markdown', 'MarkdownV2'].includes(input.parseMode) ? input.parseMode : '',
    disableWebPreview: input.disableWebPreview !== false,
    replyMarkupJson: serializeReplyMarkup(input.replyMarkup),
    source: clean(input.source || 'panel-api', 120),
    reference: clean(input.reference || '', 180),
    status: 'pending',
    attempts: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { id: ref.id, status: 'pending' };
}

async function waitTelegramJob(id, timeoutMs = 7000) {
  const ref = db.collection(COLLECTION).doc(String(id || ''));
  const until = Date.now() + Math.max(500, Number(timeoutMs || 0));
  while (Date.now() < until) {
    const snap = await ref.get();
    if (!snap.exists) return { status: 'missing' };
    const d = snap.data() || {};
    if (['sent', 'failed'].includes(d.status)) return { id: snap.id, ...d };
    await sleep(350);
  }
  const snap = await ref.get();
  return snap.exists ? { id: snap.id, ...(snap.data() || {}), timeout: true } : { status: 'missing', timeout: true };
}

async function claimJob(ref) {
  let claimed = null;
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data() || {};
    if (d.status !== 'pending') return;
    if (Number(d.nextAttemptAtMillis || 0) > now) return;
    const attempts = Number(d.attempts || 0) + 1;
    tx.update(ref, {
      status: 'processing', attempts,
      claimedBy: WORKER_ID,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      leaseUntilMillis: now + LEASE_MS,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    claimed = { id: snap.id, ...d, attempts };
  });
  return claimed;
}

async function sendJob(job) {
  const opts = {};
  if (job.parseMode) opts.parse_mode = job.parseMode;
  const replyMarkup = deserializeReplyMarkup(job.replyMarkupJson || job.replyMarkup);
  if (replyMarkup) opts.reply_markup = replyMarkup;
  if (job.disableWebPreview !== false) opts.disable_web_page_preview = true;
  if (job.type === 'photo') return bot.sendPhoto(job.chatId, job.photoUrl, { ...opts, caption: clean(job.text, 1000) });
  return bot.sendMessage(job.chatId, clean(job.text, 3900), opts);
}

async function processOne(ref) {
  const job = await claimJob(ref);
  if (!job) return;
  try {
    const msg = await sendJob(job);
    await ref.set({
      status: 'sent',
      messageId: Number(msg?.message_id || 0),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      leaseUntilMillis: 0,
      claimedBy: admin.firestore.FieldValue.delete(),
      error: admin.firestore.FieldValue.delete(),
      errorKind: admin.firestore.FieldValue.delete(),
      errorCode: admin.firestore.FieldValue.delete(),
      nextAttemptAtMillis: admin.firestore.FieldValue.delete(),
    }, { merge: true });
  } catch (e) {
    const info = telegramErrorInfo(e);
    const retryable = (info.code >= 500 || info.kind === 'rate_limit' || info.code === 0) && Number(job.attempts || 0) < MAX_ATTEMPTS;
    const delay = retryDelayMs(job.attempts, info.retryAfterSec);
    await ref.set({
      status: retryable ? 'retry_wait' : 'failed',
      error: info.description,
      errorKind: info.kind,
      errorCode: info.code,
      nextAttemptAtMillis: retryable ? Date.now() + delay : admin.firestore.FieldValue.delete(),
      failedAt: retryable ? admin.firestore.FieldValue.delete() : admin.firestore.FieldValue.serverTimestamp(),
      leaseUntilMillis: 0,
      claimedBy: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function processPendingBatch() {
  if (running) return;
  running = true;
  try {
    const snap = await db.collection(COLLECTION).where('status', '==', 'pending').limit(20).get();
    for (const doc of snap.docs) await processOne(doc.ref);
  } catch (e) {
    console.error('telegram_outbox_worker', e?.message || e);
  } finally { running = false; }
}

async function releaseDueRetries() {
  const now = Date.now();
  try {
    const snap = await db.collection(COLLECTION).where('status', '==', 'retry_wait').limit(50).get();
    const due = snap.docs.filter((d) => Number((d.data() || {}).nextAttemptAtMillis || 0) <= now);
    if (!due.length) return 0;
    const batch = db.batch();
    due.forEach((d) => batch.set(d.ref, {
      status: 'pending',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      nextAttemptAtMillis: admin.firestore.FieldValue.delete(),
    }, { merge: true }));
    await batch.commit();
    return due.length;
  } catch (e) {
    console.error('telegram_outbox_retry_release', e?.message || e);
    return 0;
  }
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis() || 0);
  if (value._seconds != null) return Number(value._seconds) * 1000;
  if (value.seconds != null) return Number(value.seconds) * 1000;
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

async function recoverStuckJobs() {
  const now = Date.now();
  try {
    const snap = await db.collection(COLLECTION).where('status', '==', 'processing').limit(50).get();
    const stuck = snap.docs.filter((doc) => {
      const d = doc.data() || {};
      const lease = Number(d.leaseUntilMillis || 0);
      if (lease > 0) return lease <= now;
      // Compatibilidad con documentos creados por la versión anterior, que
      // no tenían leaseUntilMillis: usar claimedAt/updatedAt como referencia.
      const legacyClaim = timestampMillis(d.claimedAt) || timestampMillis(d.updatedAt);
      return legacyClaim > 0 && legacyClaim <= now - LEASE_MS;
    });
    if (!stuck.length) return 0;
    const batch = db.batch();
    stuck.forEach((d) => batch.set(d.ref, {
      status: 'pending',
      recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      leaseUntilMillis: 0,
      claimedBy: admin.firestore.FieldValue.delete(),
    }, { merge: true }));
    await batch.commit();
    console.warn(`⚠️ Telegram outbox recuperó ${stuck.length} trabajo(s) atascado(s)`);
    return stuck.length;
  } catch (e) {
    console.error('telegram_outbox_recover', e?.message || e);
    return 0;
  }
}

async function watchdog() {
  await recoverStuckJobs();
  await releaseDueRetries();
  await processPendingBatch();
}

function startTelegramOutboxWorker() {
  if (global.__SUBLICUENTAS_TG_OUTBOX_STARTED__) return;
  global.__SUBLICUENTAS_TG_OUTBOX_STARTED__ = true;

  // Listener reactivo: solo despierta cuando cambia la cola pendiente.
  try {
    unsubscribePending = db.collection(COLLECTION).where('status', '==', 'pending').limit(20)
      .onSnapshot((snap) => {
        for (const change of snap.docChanges()) {
          if (change.type === 'added' || change.type === 'modified') {
            processOne(change.doc.ref).catch((e) => console.error('telegram_outbox_snapshot_job', e?.message || e));
          }
        }
      }, (e) => console.error('telegram_outbox_snapshot', e?.message || e));
  } catch (e) {
    console.error('telegram_outbox_snapshot_init', e?.message || e);
  }

  const initial = setTimeout(watchdog, 1000);
  initial.unref?.();
  watchdogTimer = setInterval(watchdog, WATCHDOG_MS);
  watchdogTimer.unref?.();
  console.log(`📨 Telegram outbox v2 activo: ${WORKER_ID} (watchdog ${WATCHDOG_MS}ms)`);
}

function getTelegramOutboxHealth() {
  return {
    workerId: WORKER_ID,
    running,
    listenerActive: typeof unsubscribePending === 'function',
    watchdogActive: !!watchdogTimer,
    maxAttempts: MAX_ATTEMPTS,
    leaseMs: LEASE_MS,
  };
}

module.exports = {
  COLLECTION,
  enqueueTelegramJob,
  waitTelegramJob,
  startTelegramOutboxWorker,
  telegramErrorInfo,
  isUnauthorizedTelegramError,
  getTelegramOutboxHealth,
  recoverStuckJobs,
  releaseDueRetries,
};
