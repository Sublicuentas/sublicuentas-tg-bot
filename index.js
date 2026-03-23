const { bootCore } = require("./index_01_core");

require("./index_02_utils_roles");
require("./index_03_clientes_crm");
require("./index_04_inventario_correos");
require("./index_05_finanzas_menus");
require("./index_06_handlers");

bootCore()
  .then(() => console.log("✅ Bot iniciado"))
  .catch((e) => {
    console.error("❌ Error al iniciar:", e?.message || e);
    process.exit(1);
  });
