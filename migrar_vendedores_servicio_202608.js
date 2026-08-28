#!/usr/bin/env node
"use strict";

/*
 * Uso:
 *   node migrar_vendedores_servicio_202608.js --preview
 *   node migrar_vendedores_servicio_202608.js --apply
 */

const { db, admin } = require("./index_01_core");
const {
  previsualizarVendedoresPorServicio,
  aplicarVendedoresPorServicio,
} = require("./index_18_migracion_vendedores_servicio");

async function main() {
  const aplicar = process.argv.includes("--apply");
  const preview = await previsualizarVendedoresPorServicio({ db });
  console.log(JSON.stringify({ modo: aplicar ? "apply" : "preview", ...preview }, null, 2));
  if (!aplicar) {
    console.log("\nNo se hicieron cambios. Use --apply para aplicar con respaldo.");
    return;
  }
  const resultado = await aplicarVendedoresPorServicio({ db, admin });
  console.log("\nResultado:\n" + JSON.stringify(resultado, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
