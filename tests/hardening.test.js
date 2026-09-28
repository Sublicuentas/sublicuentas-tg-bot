const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isPrivateTelegramContext,
  permissionsForRole,
  permissionsForProfile,
  resolveAccessProfile,
  callbackPermission,
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
  assert.equal(permissionGranted(admin, 'finanzas.write'), false);
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


test('ACL nominal: Sublicuentas total; Relojes/Geisell/Magdiel quedan segmentados', () => {
  const sublicuentas = permissionsForProfile('sublicuentas');
  const relojes = permissionsForProfile('relojes');
  const geisell = permissionsForProfile('geisell');
  const magdiel = permissionsForProfile('magdiel');

  assert.equal(permissionGranted(sublicuentas, 'equipo.manage'), true);
  assert.equal(permissionGranted(relojes, 'codigos.read'), true);
  assert.equal(permissionGranted(relojes, 'finanzas.read'), false);
  assert.equal(permissionGranted(relojes, 'avisos.read'), false);
  assert.equal(permissionGranted(geisell, 'clientes.write'), true);
  assert.equal(permissionGranted(geisell, 'inventario.read'), false);
  assert.equal(permissionGranted(magdiel, 'actividad.read'), true);
  assert.equal(permissionGranted(magdiel, 'clientes.write'), false);
});

test('ACL nominal resuelve aliases conocidos sin depender del documento exacto', () => {
  assert.equal(resolveAccessProfile({ nombre:'Sublicuentas' }, 'admin'), 'sublicuentas');
  assert.equal(resolveAccessProfile({ nombre:'Libni' }, 'admin'), 'relojes');
  assert.equal(resolveAccessProfile({ nombre:'Geissel' }, 'admin'), 'geisell');
  assert.equal(resolveAccessProfile({ nombre:'Magdiel' }, 'admin'), 'magdiel');
  assert.equal(resolveAccessProfile({ nombre:'Yami' }, 'vendedor'), 'vendedor');
});

test('callbacks sensibles requieren el permiso granular correcto', () => {
  assert.equal(callbackPermission('menu:pagos'), 'finanzas.read');
  assert.equal(callbackPermission('fin:edit:monto:abc'), 'finanzas.write');
  assert.equal(callbackPermission('mail_menu_codigos|netflix|correo'), 'codigos.read');
  assert.equal(callbackPermission('inv:menu:borrarok:netflix:x'), 'inventario.write');
  assert.equal(callbackPermission('cli:view:abc'), 'clientes.read');
  assert.equal(callbackPermission('cli:del:ok:abc'), 'clientes.write');
  assert.equal(callbackPermission('menu:revendedores'), 'equipo.manage');
});

test('privacidad de tickets: respuestas ya no se abanican a todos los admins', () => {
  const handlers = read('index_06_handlers.js');
  assert.equal(handlers.includes("ticket:notify-admin"), false);
  assert.equal(handlers.includes("ticket:notify-owner"), true);
  assert.equal(handlers.includes("getSublicuentasRecipientChatIds"), true);
});

test('AutoTXT general queda reservado a Sublicuentas', () => {
  const handlers = read('index_06_handlers.js');
  assert.equal(handlers.includes('const adminIds = new Set(await accessControl.getSublicuentasRecipientChatIds());'), true);
});

test('backup dominical no acepta una lista genérica de admins', () => {
  const acl = read('index_23_access_control.js');
  const backupBlock = acl.slice(acl.indexOf('async function getBackupRecipientChatIds()'), acl.indexOf('function invalidateAcl'));
  assert.equal(backupBlock.includes('BACKUP_RECIPIENT_IDS'), false);
  assert.equal(backupBlock.includes("getTelegramIdsForAlias('relojes')"), true);
  assert.equal(backupBlock.includes('getSublicuentasRecipientChatIds'), true);
});

test('códigos IMAP usan permiso codigos.read y diagnóstico queda administrativo', () => {
  const imap = read('index_07_imap.js');
  assert.equal(imap.includes('imapAllowed(msg,"codigos.read")'), true);
  assert.equal(imap.includes('imapAllowed(msg,"system.admin")'), true);
});

test('ACL fase 2: perfiles nominales aplican mínimo privilegio', () => {
  const relojes = permissionsForProfile('relojes');
  const geisell = permissionsForProfile('geisell');
  const magdiel = permissionsForProfile('magdiel');

  assert.equal(permissionGranted(relojes, 'sincronizacion.claves'), true);
  assert.equal(permissionGranted(relojes, 'backup.receive'), true);
  assert.equal(permissionGranted(relojes, 'finanzas.read'), false);
  assert.equal(permissionGranted(relojes, 'avisos.read'), false);

  assert.equal(permissionGranted(geisell, 'clientes.read'), true);
  assert.equal(permissionGranted(geisell, 'control_maestro.write'), true);
  assert.equal(permissionGranted(geisell, 'codigos.read'), false);
  assert.equal(permissionGranted(geisell, 'sincronizacion.claves'), false);
  assert.equal(permissionGranted(geisell, 'finanzas.read'), false);

  assert.equal(permissionGranted(magdiel, 'auditoria.read'), true);
  assert.equal(permissionGranted(magdiel, 'actividad.read'), true);
  assert.equal(permissionGranted(magdiel, 'clientes.read'), false);
  assert.equal(permissionGranted(magdiel, 'inventario.read'), false);
  assert.equal(permissionGranted(magdiel, 'finanzas.read'), false);
});

test('callbacks fase 2: no deja huecos en rutas sensibles principales', () => {
  assert.equal(callbackPermission('sync:claves:run'), 'sincronizacion.claves');
  assert.equal(callbackPermission('sync:clave:serv:abc:0'), 'sincronizacion.claves');
  assert.equal(callbackPermission('platgrp:set:root'), 'clientes.write');
  assert.equal(callbackPermission('txt:todos:hoy'), 'renovaciones.read');
  assert.equal(callbackPermission('txt:hoy'), 'renovaciones.read');
  assert.equal(callbackPermission('menu:renovaciones'), 'renovaciones.read');
  assert.equal(callbackPermission('ren:accion:abc'), 'renovaciones.write');
  assert.equal(callbackPermission('rec:start:28/09/2026'), 'self-service');
});

test('todos los callbacks exactos del router tienen clasificación ACL o son navegación inocua', () => {
  const handlers = read('index_06_handlers.js');
  const begin = handlers.indexOf('bot.on("callback_query"');
  const end = handlers.indexOf('// ===============================\n// MESSAGE ROUTER', begin);
  const chunk = handlers.slice(begin, end > begin ? end : undefined);
  const exact = [...chunk.matchAll(/data\s*===\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const exempt = new Set(['noop', 'go:inicio']);
  for (const data of exact) {
    if (exempt.has(data)) continue;
    assert.ok(callbackPermission(data), `Callback sin ACL: ${data}`);
  }
});

test('configuración de iconos Premium queda exclusiva a permiso promociones.config', () => {
  const premium = read('index_20_premium_icons.js');
  const roles = read('index_02_utils_roles.js');
  const handlers = read('index_06_handlers.js');
  assert.equal(premium.includes('typeof canConfigure === "function" ? canConfigure : isAdmin'), true);
  assert.equal(roles.includes('accessControl.hasPermission(userId, "promociones.config")'), true);
  assert.equal(handlers.includes('safeHasPermissionLocal(msg.from?.id, "promociones.config")'), true);
  assert.equal(permissionGranted(permissionsForProfile('relojes'), 'promociones.config'), false);
  assert.equal(permissionGranted(permissionsForProfile('sublicuentas'), 'promociones.config'), true);
});

test('exportaciones directas respetan ACL granular', () => {
  const crm = read('index_03_clientes_crm.js');
  const fin = read('index_05_finanzas_menus.js');
  assert.equal(crm.includes('accessControl.hasPermission(userId, "clientes.read")'), true);
  assert.equal(fin.includes('accessControl.hasPermission(userId, "finanzas.read")'), true);
});

test('vinculación de vendedores ya no puede ser reclamada por cualquier usuario', () => {
  const handlers = read('index_06_handlers.js');
  const pos = handlers.indexOf('vincular_vendedor\\s+(\\d+)\\s+(.+)');
  assert.ok(pos >= 0);
  const block = handlers.slice(Math.max(0, pos - 120), pos + 1200);
  assert.equal(block.includes('equipo.manage'), true);
  assert.equal(block.includes('TELEGRAM_ID NOMBRE'), true);
  const fnPos = handlers.indexOf('async function linkRevendedorByNombre');
  const fnEnd = handlers.indexOf('\nfunction textoBtnEliminarMovimiento', fnPos);
  const fnBlock = handlers.slice(fnPos, fnEnd);
  assert.equal(fnBlock.includes('db.collection("revendedores").get()'), false);
  assert.equal(fnBlock.includes('where("nombre_norm", "==", nombreNorm)'), true);
});

test('respuestas de avisos intentan resolver al autor específico antes de fallback Sublicuentas', () => {
  const handlers = read('index_06_handlers.js');
  assert.equal(handlers.includes('const ownerCandidates=[old.creadoPor,old.remitente,old.autor,old.creadoPorRol]'), true);
  assert.equal(handlers.includes("['admin','administrador','usuario','socio'].includes(ownerAlias)"), true);
  assert.equal(handlers.includes('Solo el responsable de esa conversación recibirá la respuesta.'), true);
});
