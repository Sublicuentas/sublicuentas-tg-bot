/* SUBLICUENTAS — ACL CENTRAL
   Una sola fuente de verdad para identidad, roles y permisos del Bot TG.
*/
const { db, SUPER_ADMIN, cacheGet, cacheSet, cacheInvalidatePrefix } = require('./index_01_core');
const { normalizeText, permissionsForRole, permissionsForProfile, resolveAccessProfile, roleForProfile, permissionGranted, anyPermissionGranted } = require('./lib_hardening');

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

function identityName(doc = {}) {
  return String(doc.nombre || doc.name || doc.usuario || doc.username || doc.nombre_norm || doc.id || '').trim();
}

function buildContextFromDoc({ uid, doc, source, fallbackRole }) {
  const profile = resolveAccessProfile(doc, fallbackRole);
  const role = roleForProfile(profile, fallbackRole);
  const defaults = permissionsForProfile(profile);
  const permissions = explicitPermissions(doc, defaults.size ? defaults : permissionsForRole(role));
  return {
    userId: uid,
    role,
    profile,
    active: true,
    source,
    docId: doc.id,
    name: identityName(doc),
    permissions: [...permissions],
    doc,
  };
}

async function getAccessContext(userId = '') {
  const uid = String(userId || '').trim();
  if (!uid) return { userId: '', role: 'none', active: false, permissions: new Set(), source: 'none' };
  const cacheKey = `acl:ctx:${uid}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return { ...cached, permissions: new Set(cached.permissions || []) };

  if (superAdminIds().has(uid)) {
    const ctx = { userId: uid, role: 'superadmin', profile: 'sublicuentas', active: true, permissions: ['*'], source: 'env-superadmin', name: 'Sublicuentas' };
    cacheSet(cacheKey, ctx, 5 * 60 * 1000);
    return { ...ctx, permissions: new Set(ctx.permissions) };
  }

  const adminDoc = await findAdminByTelegramId(uid);
  if (adminDoc && adminDoc.activo !== false) {
    const rawRole = normalizeText(adminDoc.rol || adminDoc.role || 'admin').replace(/\s+/g, '');
    const fallbackRole = rawRole === 'superadmin' ? 'superadmin' : 'admin';
    // Algunos documentos de admins sólo contienen {activo:true} y el ID numérico.
    // Si esa misma persona existe en revendedores, usamos su nombre/perfil como
    // identidad sin perder los permisos explícitos guardados en admins.
    let identityDoc = adminDoc;
    try {
      const revIdentity = await findRevendedorByTelegramId(uid);
      if (revIdentity && revIdentity.activo !== false) {
        identityDoc = {
          ...revIdentity,
          ...adminDoc,
          id: adminDoc.id,
          nombre: adminDoc.nombre || adminDoc.name || revIdentity.nombre || revIdentity.name || '',
          nombre_norm: adminDoc.nombre_norm || revIdentity.nombre_norm || '',
          usuario: adminDoc.usuario || revIdentity.usuario || '',
        };
      }
    } catch (_) {}
    const ctx = buildContextFromDoc({ uid, doc: identityDoc, source: 'admins', fallbackRole });
    cacheSet(cacheKey, ctx, 5 * 60 * 1000);
    return { ...ctx, permissions: new Set(ctx.permissions) };
  }

  const rev = await findRevendedorByTelegramId(uid);
  if (rev && rev.activo !== false) {
    const profile = resolveAccessProfile(rev, 'vendedor');
    const promoted = ['relojes', 'geisell', 'magdiel', 'sublicuentas', 'admin'].includes(profile);
    const ctx = buildContextFromDoc({ uid, doc: rev, source: 'revendedores', fallbackRole: promoted ? 'admin' : 'vendedor' });
    cacheSet(cacheKey, ctx, 5 * 60 * 1000);
    return { ...ctx, permissions: new Set(ctx.permissions) };
  }

  const ctx = { userId: uid, role: 'none', profile: 'none', active: false, permissions: [], source: 'none', name: '' };
  cacheSet(cacheKey, ctx, 60 * 1000);
  return { ...ctx, permissions: new Set() };
}

async function hasPermission(userId, permission) {
  const ctx = await getAccessContext(userId);
  return ctx.active && permissionGranted(ctx.permissions, permission);
}

async function hasAnyPermission(userId, permissions = []) {
  const ctx = await getAccessContext(userId);
  return ctx.active && anyPermissionGranted(ctx.permissions, permissions);
}

async function getTelegramIdsForAlias(alias = '') {
  const wanted = normalizeText(alias).replace(/\s+/g, '');
  if (!wanted) return [];
  const cacheKey = `acl:alias:${wanted}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return Array.isArray(cached) ? cached : [];

  const ids = new Set();
  const aliasesByProfile = {
    sublicuentas: ['sublicuentas', 'naara', 'naara blanco'],
    relojes: ['relojes', 'libni', 'daniela'],
    geisell: ['geisell', 'geissel'],
    magdiel: ['magdiel'],
  };
  const aliases = aliasesByProfile[wanted] || [wanted];
  const values = new Set();
  for (const raw of aliases) {
    const clean = String(raw || '').trim();
    if (!clean) continue;
    values.add(clean);
    values.add(clean.toLowerCase());
    values.add(clean.toUpperCase());
    values.add(clean.replace(/\b\w/g, (m) => m.toUpperCase()));
  }

  const take = (d) => {
    const x = { id: d.id, ...(d.data?.() || {}) };
    if (x.activo === false) return;
    const tg = String(x.telegramId || x.telegramID || x.userId || (/^-?\d+$/.test(String(d.id)) ? d.id : '') || '').trim();
    if (tg) ids.add(tg);
  };

  // Consultas puntuales por identidad: evita descargar completas las colecciones
  // admins/revendedores cada vez que un aviso o backup necesita resolver destino.
  const fields = ['nombre_norm', 'nombre', 'name', 'usuario_norm', 'usuario', 'username'];
  for (const col of ['admins', 'revendedores']) {
    for (const value of values) {
      try {
        const direct = await db.collection(col).doc(value).get();
        if (direct.exists) take(direct);
      } catch (_) {}
      for (const field of fields) {
        try {
          const snap = await db.collection(col).where(field, '==', value).limit(5).get();
          snap.forEach(take);
        } catch (_) {}
      }
    }
  }

  if (wanted === 'sublicuentas') superAdminIds().forEach((id) => ids.add(id));
  const result = [...ids].filter(Boolean);
  cacheSet(cacheKey, result, 5 * 60 * 1000);
  return result;
}

async function getSublicuentasRecipientChatIds() {
  const ids = new Set([...superAdminIds()]);
  parseIdList(process.env.TELEGRAM_CHAT_ID_SUBLICUENTAS || process.env.SUBLICUENTAS_CHAT_ID || '').forEach((id) => ids.add(id));
  (await getTelegramIdsForAlias('sublicuentas')).forEach((id) => ids.add(id));
  return [...ids].filter((id) => /^-?\d{5,}$/.test(String(id)));
}

async function getBackupRecipientChatIds() {
  // REGLA FIJA DE NEGOCIO: el backup dominical sólo puede ir a
  // Sublicuentas y Relojes. Ningún admin adicional se agrega por defecto.
  const ids = new Set(await getSublicuentasRecipientChatIds());

  parseIdList(process.env.TELEGRAM_CHAT_ID_RELOJES || process.env.RELOJES_CHAT_ID || '').forEach((id) => ids.add(id));
  (await getTelegramIdsForAlias('relojes')).forEach((id) => ids.add(id));

  return [...ids].filter((id) => /^-?\d{5,}$/.test(String(id)));
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
  hasAnyPermission,
  getTelegramIdsForAlias,
  getSublicuentasRecipientChatIds,
  getBackupRecipientChatIds,
  invalidateAcl,
};
