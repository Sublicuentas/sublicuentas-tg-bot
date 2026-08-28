#!/usr/bin/env node
/* Alternativa de consola al botón de Sublichat.
   Uso:
     node migrar_precios_socios_202608.js --preview
     node migrar_precios_socios_202608.js --apply
*/

const { db, admin } = require("./index_01_core");
const { generarPinSetup } = require("./index_09_api_auth");
const {
  previsualizarActualizacion,
  aplicarActualizacion,
} = require("./index_16_migracion_precios_socios");

async function main() {
  const aplicar = process.argv.includes("--apply");
  const preview = await previsualizarActualizacion({ db });
  console.log(JSON.stringify({ modo: aplicar ? "apply" : "preview", ...preview }, null, 2));
  if (!aplicar) {
    console.log("\nNo se hicieron cambios. Use --apply para aplicar la migración con respaldo.");
    return;
  }
  const resultado = await aplicarActualizacion({ db, admin, generarPinSetup });
  console.log("\nResultado:\n" + JSON.stringify(resultado, null, 2));
  if (resultado.sublicuentas2Pin) {
    console.log(`\nPIN de configuración de Sublicuentas 2 (se muestra una sola vez): ${resultado.sublicuentas2Pin}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
