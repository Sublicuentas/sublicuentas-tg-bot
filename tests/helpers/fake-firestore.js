"use strict";
// Firestore en memoria (subconjunto) para probar rutas sin tocar la base real ni crear ventas.
const clone = (v) => (v === undefined ? undefined : v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
let auto = 0;

class Store { constructor() { this.cols = new Map(); } col(path) { if (!this.cols.has(path)) this.cols.set(path, new Map()); return this.cols.get(path); } }

class DocSnap { constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._d = data; } data() { return clone(this._d); } }
class DocRef {
  constructor(db, colPath, id) { this.db = db; this.colPath = colPath; this.id = id; this.path = `${colPath}/${id}`; }
  collection(name) { return new ColRef(this.db, `${this.path}/${name}`); }
  async get() { return new DocSnap(this, this.db.store.col(this.colPath).get(this.id)); }
  _set(data, opts = {}) { const m = this.db.store.col(this.colPath); const prev = m.get(this.id); m.set(this.id, opts.merge && prev ? deepMerge(clone(prev), clone(data)) : clone(data)); }
  async set(data, opts) { this._set(data, opts); }
  async update(data) { if (!this.db.store.col(this.colPath).has(this.id)) throw new Error("NOT_FOUND"); this._set(data, { merge: true }); }
  async create(data) { if (this.db.store.col(this.colPath).has(this.id)) { const e = new Error("already exists"); e.code = 6; throw e; } this._set(data); }
  async delete() { this.db.store.col(this.colPath).delete(this.id); }
}
function deepMerge(a, b) { for (const [k, v] of Object.entries(b)) { if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) a[k] = deepMerge(a[k], v); else a[k] = v; } return a; }
const getF = (o, f) => f.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const cmpV = (v) => (v instanceof Date ? v.getTime() : v);
class Query {
  constructor(db, colPath, filters = [], order = null, lim = 0) { this.db = db; this.colPath = colPath; this.filters = filters; this.order = order; this.lim = lim; }
  where(f, op, v) { return new Query(this.db, this.colPath, [...this.filters, [f, op, v]], this.order, this.lim); }
  orderBy(f, dir = "asc") { return new Query(this.db, this.colPath, this.filters, [f, dir], this.lim); }
  limit(n) { return new Query(this.db, this.colPath, this.filters, this.order, n); }
  async get() {
    let rows = [...this.db.store.col(this.colPath).entries()].filter(([, d]) => this.filters.every(([f, op, v]) => op === "==" ? getF(d, f) === v : op === "in" ? v.includes(getF(d, f)) : true));
    if (this.order) { const [f, dir] = this.order; rows.sort((a, b) => (cmpV(getF(a[1], f)) > cmpV(getF(b[1], f)) ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
    if (this.lim) rows = rows.slice(0, this.lim);
    const docs = rows.map(([id, d]) => new DocSnap(new DocRef(this.db, this.colPath, id), d));
    return { docs, empty: !docs.length, size: docs.length, forEach: (fn) => docs.forEach(fn) };
  }
}
class ColRef extends Query { constructor(db, path) { super(db, path); this.path = path; } doc(id) { return new DocRef(this.db, this.path, id || `auto${++auto}`); } async add(d) { const r = this.doc(); await r.set(d); return r; } }
class FakeDb {
  constructor() { this.store = new Store(); }
  collection(name) { return new ColRef(this, name); }
  batch() { const ops = []; return { set: (r, d, o) => ops.push(() => r._set(d, o)), delete: (r) => ops.push(() => r.delete()), commit: async () => ops.forEach((f) => f()) }; }
  async runTransaction(fn) {
    const ops = [];
    const tx = { get: (r) => r.get(), set: (r, d, o) => ops.push(() => r._set(d, o)), update: (r, d) => ops.push(() => r._set(d, { merge: true })), create: (r, d) => ops.push(() => r._set(d)), delete: (r) => ops.push(() => r.delete()) };
    const out = await fn(tx); ops.forEach((f) => f()); return out;
  }
  dump(col) { return Object.fromEntries(this.store.col(col)); }
}
module.exports = { FakeDb };
