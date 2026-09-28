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

function isPrivateTelegramContext(payload = {}) {
  const chat = payload?.chat || payload?.message?.chat || {};
  return String(chat?.type || '').toLowerCase() === 'private';
}

const ROLE_PERMISSIONS = Object.freeze({
  superadmin: ['*'],
  admin: [
    'bot.use', 'clientes.read', 'clientes.write', 'inventario.read', 'inventario.write',
    'finanzas.read', 'finanzas.write', 'renovaciones.read', 'renovaciones.write',
    'avisos.read', 'avisos.write', 'tickets.read', 'tickets.write', 'reportes.read',
  ],
  vendedor: [
    'bot.use', 'clientes.own.read', 'clientes.own.write', 'renovaciones.own.read',
    'renovaciones.own.write', 'avisos.own.read', 'tickets.own.read', 'tickets.own.write',
  ],
  none: [],
});

function permissionsForRole(role = 'none') {
  const key = normalizeText(role).replace(/\s+/g, '');
  return new Set(ROLE_PERMISSIONS[key] || ROLE_PERMISSIONS.none);
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
  // Algunos runtimes representan medianoche como 24:xx.
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
  isPrivateTelegramContext,
  ROLE_PERMISSIONS,
  permissionsForRole,
  permissionGranted,
  getLocalParts,
  dailyScheduleDue,
  mostRecentWeeklySchedule,
  retryDelayMs,
};
