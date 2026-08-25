/* ════════════════════════════════════════════════════════════════
   migrar_precios_catalogo.js
   ────────────────────────────────────────────────────────────────
   Script de UN SOLO USO. Carga en la colección "precios" de Firestore
   los precios que YA estaban hardcodeados en revendedoreschat/index.html
   (la constante PRECIOS), para que la pestaña Revendedores de Sublichat
   arranque con el catálogo real en vez de vacío.

   Es seguro correrlo más de una vez: si el ítem ya existe (mismo
   categoria+nombre+variante), lo actualiza en vez de duplicarlo.

   CÓMO USARLO
   -----------
   1) Corré esto en el mismo lugar donde corre el bot (Render, o tu
      máquina) — necesita las MISMAS variables de entorno que ya usa
      el bot: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.

   2) Desde la carpeta del proyecto:
        node migrar_precios_catalogo.js

      En Render: Shell del servicio (ya tiene las env vars cargadas).

   3) Después de correrlo, revisá la pestaña "Revendedores → Precios" en
      Sublichat — ahí deberías ver estos mismos 22 ítems, editables.
      Si en revendedoreschat.index.html ya cambiaste algún precio desde
      que se escribió este script, editalo desde Sublichat después de
      correr esto (el script no sabe de cambios más nuevos).
   ════════════════════════════════════════════════════════════════ */

const admin = require("firebase-admin");

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

// Copiado tal cual de la constante PRECIOS en revendedoreschat/index.html
// (commit de referencia: la que tenía 5 grupos, 22 ítems).
const PRECIOS = [
  { cat: '📺 Streaming', sub: 'Plan mensual', items: [
    { n: 'Netflix', p: 110, d: '👤 Perfil personal: correo y contraseña\n📺 Reproduce en 1 dispositivo a la vez\n🔐 Más perfiles: sin clave, acceso por código\n🏠 A los 20 días puede pedir código hogar' },
    { n: 'Disney+ Premium', p: 80, d: '🔢 Acceso por código\n👤 PIN de perfil\n📱 1 dispositivo' },
    { n: 'Disney+ Standar', p: 50, d: '🔢 Acceso por código\n👤 PIN de perfil\n📱 1 dispositivo' },
    { n: 'Max', p: 60, d: '📺 En TV: acceso por código\n📱 En celular: se da clave\n👤 PIN de perfil · 1 dispositivo' },
    { n: 'Vix', p: 30, d: '📧 Se entrega correo y contraseña\n📱 1 dispositivo' },
    { n: 'Viki Rakuten', p: 60, d: '📧 Se entrega correo y contraseña\n📱 1 dispositivo' },
    { n: 'Prime Video', p: 60, d: '🔢 Acceso por código\n👤 PIN de perfil · 1 dispositivo' },
    { n: 'Paramount+', p: 60, d: '📧 Se entrega correo y contraseña\n📱 1 dispositivo' },
    { n: 'Crunchyroll', p: 60, d: '👤 PIN de perfil\n📱 1 dispositivo' },
    { n: 'Oleada', s: '1 dispositivo', p: 70, d: '▶️ Reproduce en 1 a la vez\n🤖 Solo dispositivos Android / Web' },
    { n: 'Oleada', s: '3 dispositivos', p: 130, d: '▶️ Reproduce en 1 a la vez\n🤖 Solo dispositivos Android / Web' },
    { n: 'IPTV', s: '1 pantalla', p: 80, d: '📲 Funciona en cualquier dispositivo\n🎁 Prueba gratis de 3 horas' },
    { n: 'IPTV', s: '2 pantallas', p: 110, d: '📲 Funciona en cualquier dispositivo\n🎁 Prueba gratis de 3 horas' },
    { n: 'IPTV', s: '3 pantallas', p: 140, d: '📲 Funciona en cualquier dispositivo\n🎁 Prueba gratis de 3 horas' },
  ]},
  { cat: '🎶 Música', sub: 'Plan mensual', items: [
    { n: 'Spotify Premium', p: 80, d: '📧 Se entrega correo y contraseña' },
    { n: 'Deezer Premium', p: 50, d: '📧 Se entrega correo y contraseña' },
  ]},
  { cat: '💻 Productividad', items: [
    { n: 'Canva Edu Pro', s: '1 mes', p: 20, d: '✉️ Invitación al correo del cliente\n⚠️ Debe estar registrado en Canva' },
    { n: 'Microsoft 365', s: '1 año · correo y clave · 5 disp · 100 GB', p: 200, d: '📧 Se entrega correo y contraseña\n💻 5 dispositivos\n☁️ 100 GB en Drive' },
    { n: 'Microsoft 365', s: '1 año · a correo del cliente · 1 TB', p: 350, d: '📧 Al correo del cliente\n🗓️ Vigencia 1 año\n💻 Nivel 5 dispositivos\n☁️ 1 TB en Drive' },
    { n: 'Office 2021 Pro Plus', s: 'Windows · licencia permanente', p: 200, d: '🪟 Solo para Windows\n🔑 Serial de activación\n♾️ Licencia permanente' },
    { n: 'Office 2024 Pro Plus', s: 'Windows · licencia permanente', p: 250, d: '🪟 Solo para Windows\n🔑 Serial de activación\n♾️ Licencia permanente' },
    { n: 'Antivirus McAfee', s: '1 año · 1 dispositivo', p: 150, d: '🛡️ Protección 1 dispositivo\n🔑 Se entrega key / serial\n🗓️ Vigencia 1 año' },
    { n: 'Antivirus McAfee', s: '1 año · 3 dispositivos', p: 350, d: '🛡️ Protección 3 dispositivos\n🔑 Se entrega serial\n🗓️ Vigencia 1 año' },
  ]},
  { cat: '🤖 Inteligencia Artificial', items: [
    { n: 'Gemini Pro', s: '1 mes', p: 100, d: '✉️ Invitación al Gmail del cliente' },
  ]},
  { cat: '🎮 Recargas de juegos', items: [
    { n: 'Free Fire', s: 'Por comisión', p: null, d: '💬 Consultar precios con su asesor' },
  ]},
];

function slug(v) {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const col = db.collection("precios");

  let creados = 0, actualizados = 0;
  let categoriaOrden = 0;

  for (const grupo of PRECIOS) {
    categoriaOrden += 1;
    let orden = 0;
    for (const it of grupo.items) {
      orden += 1;
      const claveNatural = `${slug(grupo.cat)}__${slug(it.n)}__${slug(it.s || "")}`;

      // Busca si ya existe un ítem con esta misma combinación (para no
      // duplicar si el script se corre más de una vez).
      const existente = await col.where("claveNatural", "==", claveNatural).limit(1).get();

      const doc = {
        claveNatural,
        categoria: grupo.cat,
        categoriaSub: grupo.sub || "",
        categoriaOrden,
        nombre: it.n,
        variante: it.s || "",
        precio: it.p == null ? null : Number(it.p),
        detalle: it.d || "",
        activo: true,
        orden,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: "migracion_inicial",
      };

      if (!existente.empty) {
        await existente.docs[0].ref.set(doc, { merge: true });
        actualizados++;
        console.log(`   ↻ Actualizado: ${grupo.cat} · ${it.n}${it.s ? " · " + it.s : ""}`);
      } else {
        doc.createdAt = admin.firestore.FieldValue.serverTimestamp();
        await col.add(doc);
        creados++;
        console.log(`   + Creado: ${grupo.cat} · ${it.n}${it.s ? " · " + it.s : ""}`);
      }
    }
  }

  console.log(`\n✅ Listo. ${creados} ítems nuevos, ${actualizados} actualizados.`);
  console.log("   Revisá la pestaña Revendedores → Precios en Sublichat.");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
