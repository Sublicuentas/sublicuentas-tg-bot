/* SUBLICUENTAS — TELEGRAM OUTBOX
   ---------------------------------------------------------------
   Cola compartida para que servicios secundarios (Panel API) puedan
   pedir envíos al BOT PRINCIPAL sin depender de un BOT_TOKEN duplicado.

   - Panel API: enqueueTelegramJob(...)
   - Bot principal (index.js): startTelegramOutboxWorker()

   Firestore: telegram_outbox
*/
const { db, admin, bot, sleep } = require('./index_01_core');

const COLLECTION = 'telegram_outbox';
const WORKER_ID = `tg_${process.pid}_${Date.now().toString(36)}`;
let timer = null;
let running = false;

function clean(v, max = 4000) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
}

function telegramErrorInfo(e) {
  const body = e?.response?.body || e?.response?.data || {};
  const code = Number(body?.error_code || e?.response?.statusCode || e?.statusCode || 0) || 0;
  const description = clean(body?.description || e?.message || e || 'Error desconocido de Telegram', 500);
  const lower = description.toLowerCase();
  let kind = 'telegram_error';
  if (code === 401 || lower.includes('unauthorized')) kind = 'bot_token_invalido';
  else if (lower.includes('chat not found')) kind = 'chat_no_encontrado';
  else if (lower.includes('bot was blocked') || lower.includes('blocked by the user')) kind = 'bot_bloqueado';
  else if (lower.includes('forbidden')) kind = 'telegram_prohibido';
  else if (lower.includes('user is deactivated')) kind = 'usuario_desactivado';
  else if (code === 429 || lower.includes('too many requests')) kind = 'rate_limit';
  return { code, description, kind };
}

function isUnauthorizedTelegramError(e) {
  const info = telegramErrorInfo(e);
  return info.kind === 'bot_token_invalido';
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
  const payload = {
    type,
    chatId,
    text,
    photoUrl,
    parseMode: ['HTML', 'Markdown', 'MarkdownV2'].includes(input.parseMode) ? input.parseMode : '',
    disableWebPreview: input.disableWebPreview !== false,
    replyMarkup: input.replyMarkup && typeof input.replyMarkup === 'object' ? input.replyMarkup : null,
    source: clean(input.source || 'panel-api', 120),
    reference: clean(input.reference || '', 180),
    status: 'pending',
    attempts: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(payload);
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
    await sleep(250);
  }
  const snap = await ref.get();
  return snap.exists ? { id: snap.id, ...(snap.data() || {}), timeout: true } : { status: 'missing', timeout: true };
}

async function claimJob(ref) {
  let claimed = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data() || {};
    if (d.status !== 'pending') return;
    const attempts = Number(d.attempts || 0) + 1;
    tx.update(ref, {
      status: 'processing',
      attempts,
      claimedBy: WORKER_ID,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    claimed = { id: snap.id, ...d, attempts };
  });
  return claimed;
}

async function sendJob(job) {
  const opts = {};
  if (job.parseMode) opts.parse_mode = job.parseMode;
  if (job.replyMarkup) opts.reply_markup = job.replyMarkup;
  if (job.disableWebPreview !== false) opts.disable_web_page_preview = true;
  if (job.type === 'photo') {
    return bot.sendPhoto(job.chatId, job.photoUrl, { ...opts, caption: clean(job.text, 1000) });
  }
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
      error: admin.firestore.FieldValue.delete(),
      errorKind: admin.firestore.FieldValue.delete(),
      errorCode: admin.firestore.FieldValue.delete(),
    }, { merge: true });
  } catch (e) {
    const info = telegramErrorInfo(e);
    const retryable = (info.code >= 500 || info.kind === 'rate_limit') && Number(job.attempts || 0) < 3;
    await ref.set({
      status: retryable ? 'pending' : 'failed',
      error: info.description,
      errorKind: info.kind,
      errorCode: info.code,
      failedAt: retryable ? admin.firestore.FieldValue.delete() : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function processTelegramOutbox() {
  if (running) return;
  running = true;
  try {
    const snap = await db.collection(COLLECTION).where('status', '==', 'pending').limit(20).get();
    for (const doc of snap.docs) await processOne(doc.ref);
  } catch (e) {
    console.error('telegram_outbox_worker', e?.message || e);
  } finally {
    running = false;
  }
}

function startTelegramOutboxWorker() {
  if (global.__SUBLICUENTAS_TG_OUTBOX_STARTED__) return;
  global.__SUBLICUENTAS_TG_OUTBOX_STARTED__ = true;
  setTimeout(processTelegramOutbox, 1000).unref?.();
  timer = setInterval(processTelegramOutbox, 1500);
  timer.unref?.();
  console.log('📨 Telegram outbox activo:', WORKER_ID);
}

module.exports = {
  COLLECTION,
  enqueueTelegramJob,
  waitTelegramJob,
  startTelegramOutboxWorker,
  telegramErrorInfo,
  isUnauthorizedTelegramError,
};
