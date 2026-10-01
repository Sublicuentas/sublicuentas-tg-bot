/* SUBLICUENTAS — ESPEJO EN MEMORIA DE "clientes" E "inventario" (auditoría Firestore, oct-2026)
   CAUSA: el bot hacía db.collection("clientes").get() completo en cada búsqueda, alerta, reporte,
   menú de renovaciones, panel /rev, etc. Cada llamada = 1 lectura POR DOCUMENTO (miles) + descarga
   completa por internet (Render está fuera de Google → egress).
   SOLUCIÓN: un solo listener por colección. Al arrancar lee la colección una vez; después Firestore
   solo envía (y cobra) los documentos que cambian. Las consultas del bot se responden desde memoria
   con los MISMOS DocumentSnapshot de Firestore (doc.id, doc.data(), doc.ref, doc.get() funcionan igual).
   - data() devuelve un objeto nuevo en cada llamada → nadie puede “ensuciar” el espejo.
   - Si el listener falla o aún no está listo, se hace la lectura directa de siempre (nunca se rompe).
   - Las funciones que ESCRIBEN (transacciones, /sincronizar_todo, /fix_duplicados, sincronizar claves)
     siguen leyendo directo de Firestore a propósito.
*/
const { db } = require("./index_01_core");

const MIRRORED = new Set(["clientes", "inventario"]);
const READY_WAIT_MS = 8000;
const RETRY_MS = 30000;
const mirrors = new Map();
const stats = { servedFromMirror: 0, directReads: 0, listenerChanges: 0, restarts: 0 };

function startMirror(name) {
  if (mirrors.has(name) && mirrors.get(name).unsub) return mirrors.get(name);
  const m = mirrors.get(name) || { name, docs: new Map(), ready: false, unsub: null, waiters: [], lastSync: 0 };
  mirrors.set(name, m);
  try {
    m.unsub = db.collection(name).onSnapshot(
      (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === "removed") m.docs.delete(ch.doc.id);
          else m.docs.set(ch.doc.id, ch.doc);
          stats.listenerChanges += 1;
        }
        m.lastSync = Date.now();
        if (!m.ready) {
          m.ready = true;
          console.log(`🪞 Espejo Firestore "${name}" listo: ${m.docs.size} documentos (1 sola lectura inicial).`);
          m.waiters.splice(0).forEach((fn) => fn(true));
        }
      },
      (err) => {
        console.error(`espejo_${name}`, err?.message || err);
        m.ready = false;
        try { m.unsub?.(); } catch (_) {}
        m.unsub = null;
        m.waiters.splice(0).forEach((fn) => fn(false));
        stats.restarts += 1;
        const t = setTimeout(() => startMirror(name), RETRY_MS);
        t.unref?.();
      },
    );
  } catch (e) {
    console.error(`espejo_${name}_init`, e?.message || e);
  }
  return m;
}

function waitReady(m) {
  if (m.ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), READY_WAIT_MS);
    m.waiters.push((ok) => { clearTimeout(t); resolve(ok); });
  });
}

function fakeSnapshot(docsArr) {
  return {
    docs: docsArr,
    size: docsArr.length,
    empty: docsArr.length === 0,
    forEach(fn, thisArg) { docsArr.forEach(fn, thisArg); },
  };
}

// Reemplazo directo de db.collection(name).get() para LECTURAS completas.
async function getColeccion(name) {
  if (!MIRRORED.has(name)) { stats.directReads += 1; return db.collection(name).get(); }
  const m = startMirror(name);
  if (await waitReady(m)) {
    stats.servedFromMirror += 1;
    return fakeSnapshot([...m.docs.values()]);
  }
  stats.directReads += 1;
  return db.collection(name).get();
}

function iniciarEspejos() { for (const name of MIRRORED) startMirror(name); }

function estadoEspejos() {
  const out = { ...stats };
  for (const [name, m] of mirrors) out[name] = { ready: m.ready, docs: m.docs.size, lastSync: m.lastSync ? new Date(m.lastSync).toISOString() : null };
  return out;
}

// Registro diario en los logs de Render para comprobar el ahorro.
const logTimer = setInterval(() => console.log("🪞 Espejo Firestore:", JSON.stringify(estadoEspejos())), 6 * 60 * 60 * 1000);
logTimer.unref?.();

module.exports = { getColeccion, iniciarEspejos, estadoEspejos };
