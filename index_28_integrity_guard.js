/* SUBLICUENTAS — FASE 4 · INTEGRIDAD / PAPELERA / IDEMPOTENCIA
   -----------------------------------------------------------------
   Objetivos:
   - Ninguna eliminación importante destruye datos sin copia recuperable.
   - Las operaciones repetidas por doble clic/reintento se reconocen.
   - Renovaciones y mutaciones HTTP pueden usar una clave idempotente común.
   - La papelera conserva actor, origen, snapshot y fecha de expiración sugerida.
*/
const crypto = require('crypto');
const { db, admin } = require('./index_01_core');

const TRASH_COLLECTION = 'papelera_operaciones';
const IDEMPOTENCY_COLLECTION = 'integrity_operations';
const DEFAULT_RETENTION_DAYS = Math.max(7, Math.min(Number(process.env.TRASH_RETENTION_DAYS || 30), 365));
const DEFAULT_OPERATION_STALE_MS = Math.max(30_000, Math.min(Number(process.env.INTEGRITY_OPERATION_STALE_MS || 10 * 60_000), 60 * 60_000));

function cleanText(v = '', max = 500) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}
function stableHash(v = '', len = 48) {
  return crypto.createHash('sha256').update(String(v || '')).digest('hex').slice(0, len);
}
function cleanOperationId(v = '') {
  const x = cleanText(v, 240);
  return x ? stableHash(x, 48) : '';
}
function actorInfo(actor = {}) {
  if (actor == null) actor = {};
  if (typeof actor === 'string' || typeof actor === 'number') actor = { userId: String(actor) };
  return {
    userId: cleanText(actor.userId || actor.id || actor.telegramId || '', 120),
    name: cleanText(actor.name || actor.nombre || actor.username || '', 120),
    profile: cleanText(actor.profile || actor.perfil || actor.role || '', 80),
    source: cleanText(actor.source || actor.origen || '', 100),
  };
}
function expiresTimestamp(days = DEFAULT_RETENTION_DAYS) {
  const safeDays = Math.max(1, Math.min(Number(days || DEFAULT_RETENTION_DAYS), 3650));
  return admin.firestore.Timestamp.fromMillis(Date.now() + safeDays * 86400000);
}
function makeWindowOperationKey(scope = 'op', parts = [], windowMs = 120000, at = Date.now()) {
  const safeWindow = Math.max(10_000, Number(windowMs || 120000));
  const bucket = Math.floor(Number(at || Date.now()) / safeWindow);
  return `${cleanText(scope, 60)}:${stableHash(JSON.stringify([...(Array.isArray(parts) ? parts : [parts]), bucket]), 40)}`;
}
function requestOperationKey(req, scope = 'http', parts = [], windowMs = 120000) {
  const explicit = cleanText(
    req?.headers?.['x-idempotency-key'] || req?.headers?.['x-request-id'] || req?.body?.requestId || req?.body?.operationId || '',
    240
  );
  const actor = req?.admin?.id || req?.admin?.username || req?.rev?.id || req?.rev?.nombre_norm || req?.rev?.nombre || '';
  if (explicit) return `${cleanText(scope, 60)}:${stableHash(`${actor}|${explicit}`, 40)}`;
  return makeWindowOperationKey(scope, [actor, req?.method || '', req?.path || req?.originalUrl || '', ...(Array.isArray(parts) ? parts : [parts])], windowMs);
}
function trashDocId(operationId = '') {
  const op = cleanOperationId(operationId);
  return op ? `op_${op}` : '';
}
function makeTrashRef(operationId = '') {
  const id = trashDocId(operationId);
  return id ? db.collection(TRASH_COLLECTION).doc(id) : db.collection(TRASH_COLLECTION).doc();
}
function baseTrashData({ kind, actor, metadata, operationId, retentionDays }) {
  const now = Date.now();
  return {
    kind: cleanText(kind || 'documento', 80),
    status: 'deleted',
    operationId: cleanText(operationId || '', 240),
    operationHash: cleanOperationId(operationId || ''),
    actor: actorInfo(actor),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    deletedAtMs: now,
    expiresAt: expiresTimestamp(retentionDays),
    restoredAt: null,
    restoredBy: null,
  };
}

async function trashDocument({ ref, kind, actor = {}, metadata = {}, operationId = '', retentionDays = DEFAULT_RETENTION_DAYS }) {
  if (!ref?.path) throw new Error('Referencia inválida para papelera.');
  const trashRef = makeTrashRef(operationId);
  const result = await db.runTransaction(async tx => {
    const [oldTrash, source] = await Promise.all([tx.get(trashRef), tx.get(ref)]);
    if (oldTrash.exists) {
      const d = oldTrash.data() || {};
      return { duplicate: true, trashId: trashRef.id, snapshot: d.snapshot || null, status: d.status || 'deleted' };
    }
    if (!source.exists) {
      const e = new Error('registro_no_existe');
      e.status = 404; e.publicError = 'no_existe';
      throw e;
    }
    const snapshot = source.data() || {};
    tx.set(trashRef, {
      ...baseTrashData({ kind, actor, metadata, operationId, retentionDays }),
      source: { collection: ref.parent.id, id: ref.id, path: ref.path },
      snapshot,
      embedded: false,
    });
    tx.delete(ref);
    return { duplicate: false, trashId: trashRef.id, snapshot, status: 'deleted' };
  });
  return result;
}

async function trashDocumentBundle({ refs = [], kind, actor = {}, metadata = {}, operationId = '', retentionDays = DEFAULT_RETENTION_DAYS }) {
  const valid = (Array.isArray(refs) ? refs : []).filter(r => r?.path);
  if (!valid.length) {
    const e = new Error('registro_no_existe'); e.status = 404; e.publicError = 'no_existe'; throw e;
  }
  const trashRef = makeTrashRef(operationId);
  return db.runTransaction(async tx => {
    const oldTrash = await tx.get(trashRef);
    if (oldTrash.exists) {
      const d = oldTrash.data() || {};
      return { duplicate: true, trashId: trashRef.id, snapshot: d.snapshot || null, status: d.status || 'deleted' };
    }
    const snaps = [];
    for (const ref of valid) snaps.push({ ref, snap: await tx.get(ref) });
    const existing = snaps.filter(x => x.snap.exists);
    if (!existing.length) {
      const e = new Error('registro_no_existe'); e.status = 404; e.publicError = 'no_existe'; throw e;
    }
    const documents = existing.map(({ ref, snap }) => ({
      collection: ref.parent.id, id: ref.id, path: ref.path, data: snap.data() || {},
    }));
    tx.set(trashRef, {
      ...baseTrashData({ kind, actor, metadata, operationId, retentionDays }),
      source: { collection: documents[0].collection, id: documents[0].id, path: documents[0].path },
      snapshot: { documents },
      embedded: false,
      bundle: true,
    });
    for (const { ref } of existing) tx.delete(ref);
    return { duplicate: false, trashId: trashRef.id, snapshot: { documents }, status: 'deleted' };
  });
}

async function embeddedTrashInTransaction(tx, {
  kind, sourceCollection, sourceId, sourcePath = '', snapshot, actor = {}, metadata = {}, operationId = '', retentionDays = DEFAULT_RETENTION_DAYS,
}) {
  const trashRef = makeTrashRef(operationId);
  const old = await tx.get(trashRef);
  if (old.exists) {
    const d = old.data() || {};
    return { duplicate: true, trashId: trashRef.id, snapshot: d.snapshot || null, status: d.status || 'deleted' };
  }
  tx.set(trashRef, {
    ...baseTrashData({ kind, actor, metadata, operationId, retentionDays }),
    source: { collection: cleanText(sourceCollection, 120), id: cleanText(sourceId, 200), path: cleanText(sourcePath, 300) },
    snapshot: snapshot == null ? null : snapshot,
    embedded: true,
  });
  return { duplicate: false, trashId: trashRef.id, snapshot, status: 'deleted' };
}

async function getTrashEntry(id = '') {
  const ref = db.collection(TRASH_COLLECTION).doc(cleanText(id, 160));
  const snap = await ref.get();
  return snap.exists ? { id: snap.id, ...(snap.data() || {}) } : null;
}
async function listTrash({ kind = '', limit = 100, status = 'deleted' } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 250));
  let q = db.collection(TRASH_COLLECTION).where('status', '==', cleanText(status || 'deleted', 40)).limit(Math.max(safeLimit, 100));
  const snap = await q.get();
  let rows = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  if (kind) rows = rows.filter(x => x.kind === cleanText(kind, 80));
  rows.sort((a,b) => Number(b.deletedAtMs || 0) - Number(a.deletedAtMs || 0));
  return rows.slice(0, safeLimit);
}

async function restoreDocumentTrash(id = '', actor = {}) {
  const trashRef = db.collection(TRASH_COLLECTION).doc(cleanText(id, 160));
  return db.runTransaction(async tx => {
    const trashSnap = await tx.get(trashRef);
    if (!trashSnap.exists) { const e = new Error('papelera_no_existe'); e.status = 404; e.publicError = 'papelera_no_existe'; throw e; }
    const t = trashSnap.data() || {};
    if (t.embedded) { const e = new Error('restauracion_embebida_requiere_modulo'); e.status = 409; e.publicError = 'restauracion_especial'; throw e; }
    if (t.status === 'restored') return { duplicate: true, restored: true, trashId: trashRef.id, kind: t.kind };

    if (t.bundle && Array.isArray(t.snapshot?.documents)) {
      const targets = t.snapshot.documents.map(x => ({ x, ref: db.collection(String(x.collection || '')).doc(String(x.id || '')) }));
      for (const { ref } of targets) {
        const existing = await tx.get(ref);
        if (existing.exists) { const e = new Error('destino_ya_existe'); e.status = 409; e.publicError = 'destino_ya_existe'; throw e; }
      }
      for (const { x, ref } of targets) tx.set(ref, x.data || {});
    } else {
      const source = t.source || {};
      if (!source.collection || !source.id) { const e = new Error('papelera_invalida'); e.status = 409; e.publicError = 'papelera_invalida'; throw e; }
      const ref = db.collection(String(source.collection)).doc(String(source.id));
      const existing = await tx.get(ref);
      if (existing.exists) { const e = new Error('destino_ya_existe'); e.status = 409; e.publicError = 'destino_ya_existe'; throw e; }
      tx.set(ref, t.snapshot || {});
    }
    tx.update(trashRef, {
      status: 'restored', restoredAt: admin.firestore.FieldValue.serverTimestamp(), restoredAtMs: Date.now(), restoredBy: actorInfo(actor),
    });
    return { duplicate: false, restored: true, trashId: trashRef.id, kind: t.kind, snapshot: t.snapshot, source: t.source };
  });
}

async function markEmbeddedTrashRestoredInTransaction(tx, trashRef, actor = {}, extra = {}) {
  tx.update(trashRef, {
    status: 'restored', restoredAt: admin.firestore.FieldValue.serverTimestamp(), restoredAtMs: Date.now(), restoredBy: actorInfo(actor), ...extra,
  });
}

function operationDocRef(key = '') {
  const raw = cleanText(key, 300);
  if (!raw) throw new Error('Clave de operación inválida.');
  return db.collection(IDEMPOTENCY_COLLECTION).doc(`op_${stableHash(raw, 48)}`);
}
async function claimOperation(key = '', metadata = {}, staleMs = DEFAULT_OPERATION_STALE_MS) {
  const ref = operationDocRef(key);
  const now = Date.now();
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.status === 'completed') return { acquired: false, duplicate: true, completed: true, result: d.result || null, refId: ref.id };
      if (d.status === 'processing' && now - Number(d.updatedAtMs || d.createdAtMs || 0) < staleMs) {
        return { acquired: false, duplicate: true, processing: true, refId: ref.id };
      }
    }
    tx.set(ref, {
      keyHash: stableHash(key, 64), status: 'processing', metadata: metadata && typeof metadata === 'object' ? metadata : {},
      createdAt: snap.exists ? (snap.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()) : admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: snap.exists ? Number(snap.data()?.createdAtMs || now) : now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtMs: now,
      attempts: admin.firestore.FieldValue.increment(1), lastError: '',
    }, { merge: true });
    return { acquired: true, duplicate: false, refId: ref.id };
  });
}
async function completeOperation(key = '', result = {}) {
  const ref = operationDocRef(key);
  await ref.set({ status: 'completed', result: result && typeof result === 'object' ? result : { value: result }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtMs: Date.now(), completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}
async function failOperation(key = '', error = '') {
  const ref = operationDocRef(key);
  await ref.set({ status: 'failed', lastError: cleanText(error?.message || error || 'error', 500), updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtMs: Date.now() }, { merge: true });
}

module.exports = {
  TRASH_COLLECTION, IDEMPOTENCY_COLLECTION, DEFAULT_RETENTION_DAYS,
  stableHash, makeWindowOperationKey, requestOperationKey, actorInfo, makeTrashRef,
  trashDocument, trashDocumentBundle, embeddedTrashInTransaction,
  getTrashEntry, listTrash, restoreDocumentTrash, markEmbeddedTrashRestoredInTransaction,
  claimOperation, completeOperation, failOperation,
};
