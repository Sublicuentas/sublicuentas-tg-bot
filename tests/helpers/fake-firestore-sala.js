// Firestore en memoria para pruebas (R167). Soporta lo que usan las APIs nuevas: doc/get/set(merge)/update,
// where('==' | 'array-contains') encadenado, batch y runTransaction. Sin red.
'use strict';
function crearFakeDb() {
  const tablas = new Map(); let n = 0;
  const tabla = (c) => { if (!tablas.has(c)) tablas.set(c, new Map()); return tablas.get(c); };
  const clonar = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  function docRef(c, id) {
    const ref = {
      id, path: `${c}/${id}`, _c: c,
      get: async () => { const d = tabla(c).get(id); return { id, ref, exists: !!d, data: () => clonar(d) }; },
      set: async (data, o = {}) => { const prev = tabla(c).get(id); tabla(c).set(id, o.merge && prev ? { ...prev, ...clonar(data) } : clonar(data)); },
      update: async (data) => { const prev = tabla(c).get(id); if (!prev) throw new Error('not-found'); tabla(c).set(id, { ...prev, ...clonar(data) }); },
    };
    return ref;
  }
  function query(c, filtros = []) {
    return {
      where: (f, op, v) => query(c, [...filtros, [f, op, v]]),
      get: async () => {
        const docs = [...tabla(c).entries()].filter(([, d]) => filtros.every(([f, op, v]) => (op === '==' ? d[f] === v : op === 'array-contains' ? Array.isArray(d[f]) && d[f].includes(v) : op === '<=' ? d[f] <= v : true)))
          .map(([id, d]) => ({ id, ref: docRef(c, id), exists: true, data: () => clonar(d) }));
        return { docs, empty: !docs.length, size: docs.length };
      },
    };
  }
  const db = {
    _tablas: tablas,
    collection: (c) => ({ doc: (id) => docRef(c, id || `auto${++n}x${Math.random().toString(36).slice(2, 8)}`), where: (f, op, v) => query(c, [[f, op, v]]), get: () => query(c).get() }),
    batch: () => { const ops = []; return { set: (r, d, o) => ops.push(() => r.set(d, o)), update: (r, d) => ops.push(() => r.update(d)), commit: async () => { for (const op of ops) await op(); } }; },
    // Transacciones en serie (como Firestore ante escrituras en conflicto: una gana y la otra relee).
    _cola: Promise.resolve(),
    runTransaction(fn) { const r = this._cola.then(() => fn({ get: (x) => x.get(), set: (x, d, o) => x.set(d, o), update: (x, d) => x.update(d) })); this._cola = r.catch(() => {}); return r; },
    todos: (c) => [...tabla(c).entries()].map(([id, d]) => ({ id, ...d })),
  };
  return db;
}
module.exports = { crearFakeDb };
