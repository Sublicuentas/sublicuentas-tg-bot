/* SUBLICUENTAS — helpers puros de hardening
   Sin Firebase ni Telegram: se pueden probar de forma aislada.
*/

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactIdentity(value = '') {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function isPrivateTelegramContext(payload = {}) {
  const chat = payload?.chat || payload?.message?.chat || {};
  return String(chat?.type || '').toLowerCase() === 'private';
}

// ACL por rol técnico. Los perfiles nominales de Sublicuentas se aplican encima.
const ROLE_PERMISSIONS = Object.freeze({
  superadmin: ['*'],
  admin: [
    'bot.use',
    'clientes.read', 'clientes.write',
    'inventario.read', 'inventario.write',
    'renovaciones.read', 'renovaciones.write',
    'reportes.read',
    'tickets.own.read', 'tickets.own.write',
    'avisos.own.read',
  ],
  vendedor: [
    'bot.use', 'clientes.own.read', 'clientes.own.write', 'renovaciones.own.read',
    'renovaciones.own.write', 'avisos.own.read', 'tickets.own.read', 'tickets.own.write',
  ],
  none: [],
});

// Perfiles de negocio. "Sublicuentas" es el único perfil con acceso total.
// Los permisos explícitos guardados en Firestore pueden agregar o retirar permisos
// sin volver a desplegar el bot.
const PROFILE_PERMISSIONS = Object.freeze({
  sublicuentas: ['*'],
  relojes: [
    'bot.use',
    'clientes.read', 'clientes.write',
    'inventario.read', 'inventario.write',
    'renovaciones.read', 'renovaciones.write',
    'codigos.read', 'reportes.read', 'sincronizacion.claves',
    'tickets.own.read', 'tickets.own.write', 'avisos.own.read',
    'socios.pagos.own.read', 'socios.compras.own.read', 'socios.compras.own.write',
    'backup.receive',
  ],
  geisell: [
    'bot.use',
    'clientes.read', 'clientes.write',
    'renovaciones.read', 'renovaciones.write',
    'control_maestro.read', 'control_maestro.write',
    'tickets.own.read', 'tickets.own.write', 'avisos.own.read',
  ],
  magdiel: [
    'bot.use',
    'auditoria.read', 'actividad.read', 'reportes.read',
    'control_maestro.read',
  ],
  admin: ROLE_PERMISSIONS.admin,
  vendedor: ROLE_PERMISSIONS.vendedor,
  none: [],
});

const PROFILE_ALIASES = Object.freeze({
  sublicuentas: new Set(['sublicuentas', 'naara', 'naarablanco']),
  relojes: new Set(['relojes', 'libni', 'daniela']),
  geisell: new Set(['geisell', 'geissel']),
  magdiel: new Set(['magdiel']),
});

function permissionsForRole(role = 'none') {
  const key = normalizeText(role).replace(/\s+/g, '');
  return new Set(ROLE_PERMISSIONS[key] || ROLE_PERMISSIONS.none);
}

function permissionsForProfile(profile = 'none') {
  const key = normalizeText(profile).replace(/\s+/g, '');
  return new Set(PROFILE_PERMISSIONS[key] || PROFILE_PERMISSIONS.none);
}

function resolveAccessProfile(doc = {}, fallbackRole = 'none') {
  const explicit = normalizeText(
    doc.accessProfile || doc.perfilAcceso || doc.perfil_acceso || doc.aclProfile || doc.acl_profile || ''
  ).replace(/\s+/g, '');
  if (explicit && Object.prototype.hasOwnProperty.call(PROFILE_PERMISSIONS, explicit)) return explicit;

  const candidates = [
    doc.nombre_norm, doc.nombre, doc.name, doc.usuario_norm, doc.usuario, doc.username, doc.id,
  ].map(compactIdentity).filter(Boolean);
  for (const [profile, aliases] of Object.entries(PROFILE_ALIASES)) {
    if (candidates.some((x) => aliases.has(x))) return profile;
  }

  const roleKey = normalizeText(fallbackRole).replace(/\s+/g, '');
  if (roleKey === 'superadmin') return 'sublicuentas';
  if (roleKey === 'admin') return 'admin';
  if (roleKey === 'vendedor') return 'vendedor';
  return 'none';
}

function roleForProfile(profile = 'none', fallbackRole = 'none') {
  const p = normalizeText(profile).replace(/\s+/g, '');
  if (p === 'sublicuentas') return 'superadmin';
  if (['relojes', 'geisell', 'magdiel', 'admin'].includes(p)) return 'admin';
  if (p === 'vendedor') return 'vendedor';
  return normalizeText(fallbackRole).replace(/\s+/g, '') || 'none';
}

function permissionGranted(permissionSet, permission) {
  const p = String(permission || '').trim();
  if (!p) return false;
  const set = permissionSet instanceof Set ? permissionSet : new Set(permissionSet || []);
  if (set.has('*') || set.has(p)) return true;
  const chunks = p.split('.');
  while (chunks.length > 1) {
    chunks.pop();
    if (set.has(`${chunks.join('.')}.*`)) return true;
  }
  return false;
}

function anyPermissionGranted(permissionSet, permissions = []) {
  return (Array.isArray(permissions) ? permissions : [permissions]).some((p) => permissionGranted(permissionSet, p));
}

function callbackPermission(callbackData = '') {
  const data = String(callbackData || '');
  if (!data || data === 'noop' || data === 'go:inicio') return '';

  if (/^(vend:|ren:mis:|txt:mis$|rec:)/.test(data)) return 'self-service';
  if (data.startsWith('tk:reply:')) return 'tickets.reply';

  if (data === 'menu:revendedores' || data.startsWith('rev:')) return 'equipo.manage';
  if (data === 'menu:dashboard' || data === 'menu:alertas' || data.startsWith('alert:') || data.startsWith('alertas:')) return 'reportes.read';

  if (data === 'menu:pagos') return 'finanzas.read';
  if (data.startsWith('fin:')) {
    if (/^fin:menu:(reportes|resumen_|bancos_|detalle_banco|top_|excel_rango)/.test(data)) return 'finanzas.read';
    if (data === 'fin:menu:cierre' || data === 'fin:menu:cierre:rango') return 'finanzas.read';
    return 'finanzas.write';
  }

  if (data.startsWith('mail_menu_codigos|') || data.startsWith('nf_code|')) return 'codigos.read';
  if (data.startsWith('sync:clave:serv:') || data.startsWith('sync:claves:')) return 'sincronizacion.claves';
  if (data.startsWith('platgrp:')) return 'clientes.write';
  if (data === 'txt:todos:hoy' || data === 'txt:hoy') return 'renovaciones.read';

  if (data === 'menu:inventario' || data.startsWith('menu:inventario:') || data === 'inv:general' || data.startsWith('inv:open:') || /^inv:[^:]+:\d+$/.test(data) || data.startsWith('mail_panel|') || data.startsWith('mail_menu_clientes|') || data.startsWith('mail_ver_clientes|')) return 'inventario.read';
  if (data.startsWith('inv:') || data.startsWith('invf:') || data.startsWith('mail_add_cliente|') || data.startsWith('mail_del_cliente') || data.startsWith('mail_delete') || data.startsWith('mail_edit_') || data.startsWith('mail_move_')) return 'inventario.write';

  if (data === 'menu:clientes' || data === 'menu:buscar' || data.startsWith('cli:view:') || data.startsWith('cli:serv:list:') || data.startsWith('cli:serv:menu:') || data.startsWith('cli:prof:list:') || data.startsWith('cli:prof:menu:') || data.startsWith('cli:ren:list:') || data.startsWith('cli:txt:') || data === 'cli:crm:resumen' || data === 'cli:excel:general') return 'clientes.read';
  if (data.startsWith('cli:') || data.startsWith('wiz:') || data.startsWith('masivo:')) return 'clientes.write';

  if (data === 'menu:renovaciones' || data === 'ren:hoy') return 'renovaciones.read';
  if (data.startsWith('ren:accion:')) return 'renovaciones.write';

  return '';
}

function getLocalParts(date = new Date(), timeZone = 'America/Tegucigalpa') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = p.value;
  let hour = Number(parts.hour || 0);
  if (hour === 24) hour = 0;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour, minute: Number(parts.minute || 0), second: Number(parts.second || 0),
    weekday: weekdayMap[parts.weekday] ?? 0,
    dmy: `${parts.day}/${parts.month}/${parts.year}`,
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function minutesOfDay(parts = {}) {
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

function dailyScheduleDue(parts = {}, hour = 0, minute = 0) {
  return minutesOfDay(parts) >= Number(hour || 0) * 60 + Number(minute || 0);
}

function shiftLocalDate(parts = {}, deltaDays = 0) {
  const dt = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + Number(deltaDays), 12, 0, 0));
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(dt.getUTCFullYear());
  return { dmy: `${dd}/${mm}/${yyyy}`, ymd: `${yyyy}-${mm}-${dd}` };
}

function mostRecentWeeklySchedule(parts = {}, targetWeekday = 0, hour = 0, minute = 0) {
  const nowWeekday = Number(parts.weekday || 0);
  let daysBack = (nowWeekday - Number(targetWeekday) + 7) % 7;
  if (daysBack === 0 && !dailyScheduleDue(parts, hour, minute)) daysBack = 7;
  const date = shiftLocalDate(parts, -daysBack);
  return { ...date, daysBack };
}

function retryDelayMs(attempt = 1, retryAfterSec = 0) {
  const explicit = Number(retryAfterSec || 0);
  if (explicit > 0) return Math.min(Math.max(explicit * 1000, 1000), 15 * 60 * 1000);
  const n = Math.max(1, Number(attempt || 1));
  const steps = [5_000, 15_000, 45_000, 120_000, 300_000];
  return steps[Math.min(n - 1, steps.length - 1)];
}

module.exports = {
  normalizeText,
  compactIdentity,
  isPrivateTelegramContext,
  ROLE_PERMISSIONS,
  PROFILE_PERMISSIONS,
  permissionsForRole,
  permissionsForProfile,
  resolveAccessProfile,
  roleForProfile,
  permissionGranted,
  anyPermissionGranted,
  callbackPermission,
  getLocalParts,
  dailyScheduleDue,
  mostRecentWeeklySchedule,
  retryDelayMs,
};
