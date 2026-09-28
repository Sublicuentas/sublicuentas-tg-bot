const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isPrivateTelegramContext,
  permissionsForRole,
  permissionGranted,
  getLocalParts,
  dailyScheduleDue,
  mostRecentWeeklySchedule,
  retryDelayMs,
} = require('../lib_hardening');

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('privacidad: solo acepta chat privado', () => {
  assert.equal(isPrivateTelegramContext({ chat: { type: 'private' } }), true);
  assert.equal(isPrivateTelegramContext({ chat: { type: 'group' } }), false);
  assert.equal(isPrivateTelegramContext({ message: { chat: { type: 'supergroup' } } }), false);
});

test('ACL: vendedor no hereda permisos administrativos', () => {
  const vendor = permissionsForRole('vendedor');
  const admin = permissionsForRole('admin');
  assert.equal(permissionGranted(vendor, 'bot.use'), true);
  assert.equal(permissionGranted(vendor, 'finanzas.write'), false);
  assert.equal(permissionGranted(admin, 'finanzas.write'), true);
  assert.equal(permissionGranted(permissionsForRole('superadmin'), 'cualquier.permiso'), true);
});

test('scheduler diario no depende del minuto exacto', () => {
  assert.equal(dailyScheduleDue({ hour: 6, minute: 59 }, 7, 0), false);
  assert.equal(dailyScheduleDue({ hour: 7, minute: 0 }, 7, 0), true);
  assert.equal(dailyScheduleDue({ hour: 9, minute: 37 }, 7, 0), true);
});

test('scheduler semanal recupera el domingo anterior', () => {
  // Lunes 28/09/2026 00:15 -> último domingo 27/09/2026.
  const parts = { year: 2026, month: 9, day: 28, weekday: 1, hour: 0, minute: 15 };
  const occ = mostRecentWeeklySchedule(parts, 0, 21, 0);
  assert.equal(occ.dmy, '27/09/2026');
  assert.equal(occ.daysBack, 1);
});

test('outbox aplica backoff y respeta retry_after', () => {
  assert.equal(retryDelayMs(1, 0), 5000);
  assert.equal(retryDelayMs(3, 0), 45000);
  assert.equal(retryDelayMs(1, 30), 30000);
});

test('arranque no descarta mensajes pendientes de Telegram', () => {
  const core = read('index_01_core.js');
  assert.equal(core.includes('drop_pending_updates: true'), false);
  assert.equal(core.includes('drop_pending_updates: false'), true);
});

test('migraciones no corren automáticamente en index.js', () => {
  const index = read('index.js');
  assert.equal(index.includes('consolidarClientesDuplicadosPorTelefono({'), false);
  assert.equal(index.includes('migrarNanotechClientes({'), false);
  assert.equal(index.includes('maintenance:migrations'), true);
});

test('scheduler viejo por minuto exacto fue retirado', () => {
  const fin = read('index_05_finanzas_menus.js');
  const handlers = read('index_06_handlers.js');
  assert.equal(/if\s*\(hh\s*===\s*11\s*&&\s*mm\s*===\s*0/.test(fin), false);
  assert.equal(/if\s*\(hh\s*===\s*21\s*&&\s*mm\s*===\s*0/.test(fin), false);
  assert.equal(/if\s*\(hh\s*===\s*7\s*&&\s*mm\s*===\s*0/.test(handlers), false);
});

test('outbox ya no consulta cada 1.5 segundos y tiene recuperación', () => {
  const outbox = read('index_22_telegram_outbox.js');
  assert.equal(outbox.includes('setInterval(processTelegramOutbox, 1500)'), false);
  assert.equal(outbox.includes('recoverStuckJobs'), true);
  assert.equal(outbox.includes("onSnapshot"), true);
  assert.equal(outbox.includes("'retry_wait'"), true);
});

test('backup usa lista ACL restringida', () => {
  const fin = read('index_05_finanzas_menus.js');
  assert.equal(fin.includes('getBackupRecipientChatIds()'), true);
  assert.equal(fin.includes('backup:autorizado:'), true);
});

test('timezone Tegucigalpa genera partes coherentes', () => {
  const p = getLocalParts(new Date('2026-09-28T06:15:00Z'), 'America/Tegucigalpa');
  assert.equal(p.dmy, '28/09/2026');
  assert.equal(p.hour, 0);
  assert.equal(p.minute, 15);
});
