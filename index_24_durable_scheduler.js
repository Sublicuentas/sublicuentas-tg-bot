/* SUBLICUENTAS — SCHEDULER DURABLE
   - No depende del minuto exacto.
   - Firestore impide dobles ejecuciones entre instancias.
   - Reintenta fallos sin marcar una tarea como completada antes de tiempo.
*/
const { db, admin, TZ } = require('./index_01_core');
const { getLocalParts, dailyScheduleDue, mostRecentWeeklySchedule } = require('./lib_hardening');

const RUNS_COLLECTION = 'bot_scheduler_runs';
const WORKER_ID = `sched_${process.pid}_${Date.now().toString(36)}`;
const LEASE_MS = 10 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
let timer = null;
let running = false;
let jobs = [];

function safeId(v = '') { return String(v || '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 180); }

function resolveOccurrence(job, now = new Date()) {
  const p = getLocalParts(now, TZ);
  if (job.type === 'weekly') {
    const occ = mostRecentWeeklySchedule(p, Number(job.weekday || 0), Number(job.hour || 0), Number(job.minute || 0));
    // Permite recuperar el backup semanal si el servicio estaba caído el domingo.
    const maxCatchupDays = Number.isFinite(Number(job.maxCatchupDays)) ? Number(job.maxCatchupDays) : 6;
    if (occ.daysBack > maxCatchupDays) return null;
    return { key: occ.ymd, dmy: occ.dmy, localParts: p };
  }
  if (!dailyScheduleDue(p, Number(job.hour || 0), Number(job.minute || 0))) return null;
  return { key: p.ymd, dmy: p.dmy, localParts: p };
}

async function claimRun(job, occurrence) {
  const id = safeId(`${job.id}_${occurrence.key}`);
  const ref = db.collection(RUNS_COLLECTION).doc(id);
  const now = Date.now();
  let claimed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? (snap.data() || {}) : {};
    if (d.status === 'done') return;
    if (d.status === 'running' && Number(d.leaseUntilMillis || 0) > now && d.workerId !== WORKER_ID) return;
    if (d.status === 'failed' && Number(d.nextRetryAtMillis || 0) > now) return;
    tx.set(ref, {
      jobId: job.id,
      scheduleKey: occurrence.key,
      scheduledDate: occurrence.dmy,
      status: 'running',
      workerId: WORKER_ID,
      leaseUntilMillis: now + LEASE_MS,
      attempts: Number(d.attempts || 0) + 1,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    claimed = true;
  });
  return claimed ? ref : null;
}

async function executeJob(job, occurrence) {
  const ref = await claimRun(job, occurrence);
  if (!ref) return false;
  try {
    const result = await job.run({ scheduledDateDMY: occurrence.dmy, scheduleKey: occurrence.key, workerId: WORKER_ID });
    if (result === false || result?.ok === false) throw new Error(result?.error || `${job.id}_returned_not_ok`);
    await ref.set({
      status: 'done',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      leaseUntilMillis: 0,
      error: admin.firestore.FieldValue.delete(),
      nextRetryAtMillis: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    console.log(`✅ Scheduler ${job.id} completado (${occurrence.dmy})`);
    return true;
  } catch (e) {
    await ref.set({
      status: 'failed',
      error: String(e?.message || e || '').slice(0, 800),
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      leaseUntilMillis: 0,
      nextRetryAtMillis: Date.now() + RETRY_MS,
    }, { merge: true });
    console.error(`❌ Scheduler ${job.id}:`, e?.stack || e);
    return false;
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    for (const job of jobs) {
      const occurrence = resolveOccurrence(job);
      if (!occurrence) continue;
      await executeJob(job, occurrence);
    }
  } finally {
    running = false;
  }
}

function startDurableScheduler(jobList = []) {
  if (global.__SUBLICUENTAS_DURABLE_SCHEDULER__) return;
  global.__SUBLICUENTAS_DURABLE_SCHEDULER__ = true;
  jobs = (Array.isArray(jobList) ? jobList : []).filter((j) => j && j.id && typeof j.run === 'function');
  const initial = setTimeout(tick, 2500);
  initial.unref?.();
  timer = setInterval(tick, 60 * 1000);
  timer.unref?.();
  console.log(`⏰ Scheduler durable activo (${jobs.map((j) => j.id).join(', ')})`);
}

function getDurableSchedulerHealth() {
  return { workerId: WORKER_ID, jobs: jobs.map((j) => j.id), running, active: !!timer };
}

module.exports = { startDurableScheduler, getDurableSchedulerHealth, resolveOccurrence };
