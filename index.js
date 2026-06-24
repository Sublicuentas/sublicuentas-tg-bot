const { startBotPollingSafe } = require("./index_01_core");

require("./index_02_utils_roles");
require("./index_03_clientes_crm");
require("./index_04_inventario_correos");
require("./index_05_finanzas_menus");
require("./index_06_handlers");
require("./index_07_imap");
require("./index_09_api_auth");  // ✅ NUEVO: Módulo compartido de auth
require("./index_08_api");
require("./index_10_reportes_excel");  // ✅ NUEVO: Generador de reportes Excel
require("./index_11_clientes_excel");  // ✅ NUEVO: Generador de clientes Excel

(async () => {
  await startBotPollingSafe();
})();
