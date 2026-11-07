#!/usr/bin/env node
"use strict";
/*
 * R185 · Regularizar pedidos ANTIGUOS realmente entregados (Portal de Socios). Lo corre Sublicuentas a mano.
 *
 * 1) Simulación (no escribe nada):
 *    node migrar_pedidos_entregados_r185.js --preview --corte=2026-10-30 [--socio=jimena]
 *    → guarda r185_preview_<fecha>.json con cada pedido, su categoría y la evidencia. Revíselo con calma.
 * 2) Aplicar SOLO lo revisado (por defecto: entregas publicadas + ficha armada en Finanzas):
 *    node migrar_pedidos_entregados_r185.js --apply --preview-file=r185_preview_XXXX.json
 *    Para casos que piden visto bueno (cliente_con_servicio, historial_entregado):
 *    node migrar_pedidos_entregados_r185.js --apply --preview-file=… --categorias=cliente_con_servicio --ids=web_a,web_b
 *    → guarda r185_apply_<lote>.json con el respaldo (estado anterior de cada pedido) y el conteo antes/después.
 * 3) Revertir un lote:
 *    node migrar_pedidos_entregados_r185.js --revert --lote=r185_XXXXXXXX
 *
 * Nunca cambia pagos, montos, productos, comprobantes ni fechas de venta. No envía avisos a los socios.
 * Los pedidos posteriores al corte siguen con su estado real. "sin_evidencia" nunca se marca.
 */
const fs = require("fs");

function arg(nombre) { const a = process.argv.find((x) => x.startsWith(`--${nombre}=`)); return a ? a.slice(nombre.length + 3) : ""; }

async function main() {
  const { db } = require("./index_01_core");
  const L = require("./lib_normalizar_pedidos_r185");
  const sello = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  if (process.argv.includes("--preview")) {
    const r = await L.previsualizar(db, { corte: arg("corte"), socio: arg("socio") });
    const f = `r185_preview_${sello}.json`; fs.writeFileSync(f, JSON.stringify(r, null, 2));
    console.log(JSON.stringify({ archivo: f, antes: r.antes, porCategoria: r.porCategoria }, null, 2));
    console.log("\nNo se hizo ningún cambio. Revise el archivo y luego use --apply --preview-file=" + f);
    return;
  }
  if (process.argv.includes("--apply")) {
    const pf = arg("preview-file"); if (!pf) throw new Error("Falta --preview-file=…");
    const preview = JSON.parse(fs.readFileSync(pf, "utf8"));
    const categorias = (arg("categorias") || "entregas_publicadas,ficha_armada").split(",").map((x) => x.trim()).filter(Boolean);
    const ids = arg("ids") ? arg("ids").split(",").map((x) => x.trim()).filter(Boolean) : null;
    const r = await L.aplicar(db, preview, { categorias, ids, actor: arg("actor") || "migracion-r185" });
    const f = `r185_apply_${r.lote}.json`; fs.writeFileSync(f, JSON.stringify(r, null, 2));
    console.log(JSON.stringify({ archivo: f, lote: r.lote, aplicados: r.aplicados, omitidos: r.omitidos.length, antes: r.antes.porEstado, despues: r.despues.porEstado }, null, 2));
    return;
  }
  if (process.argv.includes("--revert")) {
    const r = await L.revertir(db, { lote: arg("lote") });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log("Use --preview, --apply o --revert (vea el encabezado del archivo).");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
