/* ════════════════════════════════════════════════════════════════
   listar_revendedores_pendientes.js
   ────────────────────────────────────────────────────────────────
   Script de UN SOLO USO, de SOLO LECTURA. No modifica nada en Firestore.

   Te dice exactamente qué revendedores quedan bloqueados con el nuevo
   flujo de PIN (los que nunca reclamaron su cuenta con una clave) para
   que sepas a quiénes correrles /resetpin en el bot.

   CÓMO USARLO
   -----------
   1) Corré esto en el mismo lugar donde corre el bot (Render, o tu
      máquina) — necesita las MISMAS variables de entorno que ya usa
      el bot: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
      No necesita BOT_TOKEN ni JWT_SECRET, así que podés correrlo aparte
      sin tocar el proceso del bot que ya está corriendo.

   2) Desde la carpeta del proyecto (donde está este archivo):
        node listar_revendedores_pendientes.js

      Si corrés esto en Render, podés abrir un "Shell" desde el dashboard
      del servicio y ejecutar el mismo comando ahí (ya tiene las env vars
      cargadas).

   3) El script imprime 3 grupos:
        🔴 BLOQUEADOS      -> nunca entraron y son de ANTES de este fix
                               (sin passwordHash Y sin pinSetupHash).
                               Correles /resetpin Nombre en el bot.
        🟡 PENDIENTES      -> ya tienen un PIN generado (con el bot ya
                               actualizado) pero todavía no lo usaron.
                               No necesitan nada de vos, solo que entren.
        🟢 YA CONFIGURADOS -> ya tienen su clave guardada, no los toca
                               este cambio para nada.
   ════════════════════════════════════════════════════════════════ */

const admin = require("firebase-admin");

// Si las credenciales están mal o no hay red, preferimos un mensaje claro
// en vez de un stack trace crudo de gRPC.
process.on("uncaughtException", (e) => {
  console.error("❌ No pude conectar a Firestore. Revisá FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.");
  console.error("   Detalle:", e.message);
  process.exit(1);
});

function initAdmin() {
  if (admin.apps.length) return admin.app();
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error("❌ Faltan FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY en el entorno.");
    process.exit(1);
  }
  return admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const snap = await db.collection("revendedores").get();

  const bloqueados = [];
  const pendientes = [];
  const configurados = [];

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const row = {
      docId: doc.id,
      nombre: d.nombre || doc.id,
      nombre_norm: d.nombre_norm || doc.id,
      telegramId: d.telegramId || "(sin telegramId)",
      activo: d.activo !== false,
    };
    if (d.passwordHash) {
      configurados.push(row);
    } else if (d.pinSetupHash) {
      pendientes.push(row);
    } else {
      bloqueados.push(row);
    }
  });

  const linea = (r) =>
    `   • ${r.nombre}  (usuario: ${r.nombre_norm})  ${r.activo ? "" : "— INACTIVO — "}TG:${r.telegramId}`;

  console.log(`\nTotal revendedores: ${snap.size}\n`);

  console.log(`🔴 BLOQUEADOS (${bloqueados.length}) — corréles /resetpin en el bot:`);
  if (!bloqueados.length) console.log("   (ninguno)");
  bloqueados.forEach((r) => console.log(linea(r)));
  if (bloqueados.length) {
    console.log("\n   Comandos listos para copiar y pegar en el bot:");
    bloqueados.forEach((r) => console.log(`   /resetpin ${r.nombre}`));
  }

  console.log(`\n🟡 PENDIENTES (${pendientes.length}) — ya tienen PIN generado, solo falta que entren:`);
  if (!pendientes.length) console.log("   (ninguno)");
  pendientes.forEach((r) => console.log(linea(r)));

  console.log(`\n🟢 YA CONFIGURADOS (${configurados.length}) — no se ven afectados por este cambio:`);
  if (!configurados.length) console.log("   (ninguno)");
  configurados.forEach((r) => console.log(linea(r)));

  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
