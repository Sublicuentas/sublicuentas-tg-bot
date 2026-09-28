/* SUBLICUENTAS — ACL CENTRAL
   Una sola fuente de verdad para identidad, roles y permisos del Bot TG.
*/
const { db, SUPER_ADMIN, cacheGet, cacheSet, cacheInvalidatePrefix } = require('./index_01_core');
const { normalizeText, permissionsForRole, permissionGranted } = require('./lib_hardening');

const NULL_SENTINEL = '__acl_null__';

function parseIdList(raw = '') {
  const out = new Set();
  const text = String(raw || '').trim();
  if (!text) return out;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      parsed.forEach((x) => { const v = String(x || '').trim(); if (v) out.add(v); });
      return out;
    }
  } catch (_) {}
  text.split(/[\s,;|]+/).forEach((x) => { const v = String(x || '').trim(); if (v) out.add(v); });
  return out;
}

function superAdminIds() { return parseIdList(SUPER_ADMIN); }

async function firstByField(collection, field, value) {
  const candidates = [value];
  const text = String(value == null ? '' : value).trim();
  if (/^-?\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric)) candidates.push(numeric);
  }
  for (const candidate of candidates) {
    try {
      const snap = await db.collection(collection).where(field, '==', candidate).limit(1).get();
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...(d.data() || {}) };
      }
    } catch (_) {}
  }
  return null;
}

async function findAdminByTelegramId(userId = '') {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const key = `acl:admin:${uid}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached === NULL_SENTINEL ? null : cached;

  let found = null;
  try {
    const direct = await db.collection('admins').doc(uid).get();
    if (direct.exists) found = { id: direct.id, ...(direct.data() || {}) };
  } catch (_) {}

  if (!found) found = await firstByField('admins', 'telegramId', uid);
  if (!found) found = await firstByField('admins', 'userId', uid);
  if (!found) found = await firstByField('admins', 'uid', uid);

  cacheSet(key, found || NULL_SENTINEL, 5 * 60 * 1000);
  return found;
}

async function findRevendedorByTelegramId(userId = '') {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const key = `acl:rev:${uid}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached === NULL_SENTINEL ? null : cached;

  let found = await firstByField('revendedores', 'telegramId', uid);
  if (!found) found = await firstByField('revendedores', 'userId', uid);
  if (!found) found = await firstByField('revendedores', 'uid', uid);
  cacheSet(key, found || NULL_SENTINEL, 5 * 60 * 1000);
  return found;
}

function explicitPermissions(doc = {}, defaults = new Set()) {
  const set = new Set(defaults || []);
  const arr = Array.isArray(doc.permissions) ? doc.permissions : Array.isArray(doc.permisos) ? doc.permisos : [];
  arr.forEach((x) => { const p = String(x || '').trim(); if (p) set.add(p); });
  const obj = (!Array.isArray(doc.permisos) && doc.permisos && typeof doc.permisos === 'object') ? doc.permisos : {};
  for (const [p, enabled] of Object.entries(obj)) {
    if (enabled === true) set.add(String(p));
    if (enabled === false) set.delete(String(p));
  }
  return set;
}

async function getAccessContext(userId = '') {
  const uid = String(userId || '').trim();
  if (!uid) return { userId: '', role: 'none', active: false, permissions: new Set(), source: 'none' };
  const cacheKey = `acl:ctx:${uid}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return { ...cached, permissions: new Set(cached.permissions || []) };

  if (superAdminIds().has(uid)) {
    const ctx = { userId: uid, role: 'superadmin', active: true, permissions: ['*'], source: 'env-superadmin', name: 'Sublicuentas' };
    cacheSet(cacheKey, ctx, 5 * 60 * 1000);
    return { ...ctx, permissions: new Set(ctx.permissions) };
  }

  const adminDoc = await findAdminByTelegramId(uid);
  if (adminDoc && adminDoc.activo !== false) {
    const rawRole = normalizeText(adminDoc.rol || adminDoc.role || 'admin').replace(/\s+/g, '');
    const role = ['superadmin', 'admin'].includes(rawRole) ? rawRole : 'admin';
    const permissions = explicitPermissions(adminDoc, permissionsForRole(role));
    const ctx = {
      userId: uid, role, active: true, source: 'admins', docId: adminDoc.id,
      name: String(adminDoc.nombre || adminDoc.name || adminDoc.usuario || '').trim(),
      permissions: [...permissions], doc: adminDoc,
    };
    cacheSet(cacheKey, ctx, 5 * 60 * 1000);
    return { ...ctx, permissions };
  }

  const rev = await findRevendedorByTelegramId(uid);
  if (rev && rev.activo !== false) {
    const revNameNorm = normalizeText(rev.nombre_norm || rev.nombre || rev.usuario || rev.id);
    // Compatibilidad: Geisell/Geissel conserva el acceso administrativo existente,
    // pero ahora la excepción vive en un solo sitio (ACL), no dispersa en handlers.
    const promotedAdmin = ['geisell', 'geissel'].includes(revNameNorm);
    const role = promotedAdmin ? 'admin' : 'vendedor';
    const permissions = explicitPermissions(rev, permissionsForRole(role));
    const ctx = {
      userId: uid, role, active: true, source: 'revendedores', docId: rev.id,
      name: String(rev.nombre || rev.usuario || rev.id || '').trim(),
      permissions: [...permissions], doc: rev,
    };
    cacheSet(cacheKey, ctx, 5 * 60 * 1000);
    return { ...ctx, permissions };
  }

  const ctx = { userId: uid, role: 'none', active: false, permissions: [], source: 'none', name: '' };
  cacheSet(cacheKey, ctx, 60 * 1000);
  return { ...ctx, permissions: new Set() };
}

async function hasPermission(userId, permission) {
  const ctx = await getAccessContext(userId);
  return ctx.active && permissionGranted(ctx.permissions, permission);
}

async function getBackupRecipientChatIds() {
  const ids = new Set();

  // Sublicuentas: SUPER_ADMIN + variable explícita opcional.
  const superIds = [...superAdminIds()];
  if (superIds[0]) ids.add(superIds[0]);
  parseIdList(process.env.TELEGRAM_CHAT_ID_SUBLICUENTAS || '').forEach((id) => ids.add(id));
  parseIdList(process.env.TELEGRAM_CHAT_ID_RELOJES || '').forEach((id) => ids.add(id));
  parseIdList(process.env.BACKUP_RECIPIENT_IDS || '').forEach((id) => ids.add(id));

  // Relojes puede estar registrado como Relojes o Libni en revendedores/admins.
  const aliasQueries = [
    ['nombre_norm', 'relojes'], ['nombre_norm', 'libni'], ['nombre_norm', 'sublicuentas'],
    ['usuario_norm', 'relojes'], ['usuario_norm', 'libni'], ['usuario_norm', 'sublicuentas'],
    ['nombre', 'Relojes'], ['nombre', 'Libni'], ['nombre', 'Sublicuentas'],
  ];
  for (const [field, alias] of aliasQueries) {
    try {
      const snap = await db.collection('revendedores').where(field, '==', alias).limit(3).get();
      snap.forEach((d) => {
        const x = d.data() || {};
        if (x.activo === false) return;
        const tg = String(x.telegramId || x.userId || '').trim();
        if (tg) ids.add(tg);
      });
    } catch (_) {}
  }

  return [...ids].filter(Boolean);
}

function invalidateAcl(userId = '') {
  const uid = String(userId || '').trim();
  if (uid) {
    cacheInvalidatePrefix(`acl:ctx:${uid}`);
    cacheInvalidatePrefix(`acl:admin:${uid}`);
    cacheInvalidatePrefix(`acl:rev:${uid}`);
  } else {
    cacheInvalidatePrefix('acl:');
  }
}

module.exports = {
  superAdminIds,
  findAdminByTelegramId,
  findRevendedorByTelegramId,
  getAccessContext,
  hasPermission,
  getBackupRecipientChatIds,
  invalidateAcl,
};
