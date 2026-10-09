const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const B = path.join(__dirname, "..");
const R = require("../lib_finanzas_reglas");

function cargar() {
  const store = new Map(); let n = 0;
  const ref = (c, id) => ({ id, _k: `${c}/${id}`, async set(d, o) { store.set(`${c}/${id}`, o && o.merge ? { ...(store.get(`${c}/${id}`) || {}), ...d } : d); }, async get() { const d = store.get(`${c}/${id}`); return { id, exists: !!d, data: () => d }; } });
  const docsDe = (c) => [...store.entries()].filter(([k]) => k.startsWith(`${c}/`) && !k.slice(c.length + 1).includes("/")).map(([k, d]) => ({ id: k.slice(c.length + 1), data: () => d }));
  const q = (c, f = () => true) => ({ get: async () => ({ docs: docsDe(c).filter(f) }), where: (fl, op, v) => q(c, (x) => f(x) && (op === "==" ? x.data()[fl] === v : true)) });
  const db = { collection: (c) => ({ doc: (id) => ref(c, id || `auto${++n}`), ...q(c) }),
    async runTransaction(fn) { const buf = []; const tx = { get: (r) => r.get(), set: (r, d, o) => buf.push([r._k, d, o]) }; const out = await fn(tx); for (const [k, d, o] of buf) store.set(k, o && o.merge ? { ...(store.get(k) || {}), ...d } : d); return out; } };
  const methods = [{ id: "bac", nombre: "BAC Credomatic" }];
  const libro = { bases: { bac: { saldo: 10000, desde: "2026-10-01" } }, cicloInicio: "2026-10-01" };
  store.set("finanzas_config/libro_mayor", libro);
  const movs = () => [...store.entries()].filter(([k]) => k.startsWith("finanzas_movimientos/")).map(([k, d]) => ({ id: k.split("/")[1], ...d }));
  const paneles = [], mensajes = [];
  const stub = (file, exports) => { require.cache[require.resolve(path.join(B, file))] = { id: file, filename: file, loaded: true, exports }; };
  for (const k of Object.keys(require.cache)) if (/index_33_empresa_tg/.test(k)) delete require.cache[k];
  stub("index_01_core", { bot: { sendMessage: async (c, t) => mensajes.push(t) }, db });
  stub("index_02_utils_roles", { pending: new Map(), upsertPanel: async (c, t, kb) => paneles.push({ t, kb }), logErr: (a, e) => { throw e; } });
  stub("index_31_finanzas_libro", { actorDe: async () => ({ usuario: "sublicuentas" }), loadMethods: async () => methods, estadoLibro: async () => ({ saldos: R.bankBalances(movs(), libro, methods) }),
    fechaCampos: (f) => { const [y, m, d] = f.split("-"); return { fecha: `${d}/${m}/${y}`, fechaPago: f, mesKey: `${y}-${m}`, fechaTS: new Date(Date.UTC(+y, +m - 1, +d, 12)) }; },
    leerMovimientosDesde: async () => movs() });
  return { T: require(path.join(B, "index_33_empresa_tg")), store, paneles, mensajes };
}

test("R140: Telegram usa el MISMO manejador que la web (archivo generado, sin diferencias)", () => {
  const web = path.join(B, "..", "..", "hq", "sublichat-hq-main", "api", "_finanzas-empresa.js");
  const bot = fs.readFileSync(path.join(B, "lib_finanzas_empresa.js"), "utf8");
  assert.match(bot, /GENERADO de Sublichat HQ api\/_finanzas-empresa\.js/);
  if (fs.existsSync(web)) { const n = (t) => t.split("\n").filter((l) => /accion === "/.test(l)).join("\n"); assert.equal(n(bot), n(fs.readFileSync(web, "utf8"))); }
});

test("R140: recargar Binance desde Telegram (banco → Lempiras → USDT → confirmar) y ver el tablero conciliado", async () => {
  const { T, store, paneles, mensajes } = cargar();
  await T.callback(1, 7, "fl:emp:rec");
  await T.callback(1, 7, "fl:emp:rb:0");
  const { pending } = require(path.join(B, "index_02_utils_roles"));
  await T.texto(1, 7, "2,820", pending.get("1"));
  await T.texto(1, 7, "100", pending.get("1"));
  assert.match(paneles[paneles.length - 1].t, /Tasa efectiva: L 28\.2000/);
  await T.callback(1, 7, "fl:emp:rok");
  assert.ok(mensajes.some((m) => /Binance \+100 USDT · tasa L 28\.2/.test(m)), mensajes.join(" | "));
  assert.equal(store.get("fin_billeteras/binance").saldo, 100);
  const aud = [...store.entries()].find(([k, v]) => k.startsWith("auditoria_eventos/") && v.accion === "recarga_binance");
  assert.ok(aud); assert.equal(aud[1].origen, "telegram");
  // Retiro de dueños
  await T.callback(1, 7, "fl:emp:ret"); await T.callback(1, 7, "fl:emp:tb:0");
  await T.texto(1, 7, "500", pending.get("1")); await T.texto(1, 7, "Marvin", pending.get("1")); await T.callback(1, 7, "fl:emp:tok");
  assert.ok([...store.values()].some((v) => v.tipo === "retiro" && v.monto === 500 && v.beneficiario === "Marvin"));
  await T.callback(1, 7, "fl:emp");
  const tab = paneles[paneles.length - 1].t;
  assert.match(tab, /RESULTADOS POR VENTA/); assert.match(tab, /Binance 100 USDT/); assert.match(tab, /Conciliación con el libro: ✔ todo cuadra/);
});
