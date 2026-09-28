/* Migraciones manuales. NO se ejecuta al arrancar el bot.
   Uso: node run_maintenance_migrations.js
*/
const { db, admin, cacheInvalidatePrefix } = require('./index_01_core');
const { consolidarClientesDuplicadosPorTelefono } = require('./index_19_consolidar_clientes_telefono');
const { migrarNanotechClientes } = require('./index_21_migracion_nanotech');

(async () => {
  try {
    const consolidacion = await consolidarClientesDuplicadosPorTelefono({ db, admin });
    cacheInvalidatePrefix?.('clientes:');
    console.log('✅ Consolidación de teléfonos:', JSON.stringify(consolidacion));

    const nanotech = await migrarNanotechClientes({ db, admin });
    cacheInvalidatePrefix?.('clientes:');
    console.log('✅ Migración Nanotech:', JSON.stringify(nanotech));
    process.exit(0);
  } catch (e) {
    console.error('❌ Migraciones manuales:', e?.stack || e);
    process.exit(1);
  }
})();
